#!/usr/bin/env python3
"""Link competitions using canonical nation, type, level, name, and stable code evidence."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from difflib import SequenceMatcher
from itertools import combinations
from pathlib import Path

from common import REGISTRY_DB, ROOT, normalize_name, registry_connection, slug_part


OVERRIDES = ROOT / "config" / "identity" / "competition_overrides.csv"
VALID_ACTIONS = {"link", "create_new", "keep_separate", "reject_candidate"}


def stable_id(public_id: str) -> int:
    value = int.from_bytes(hashlib.sha256(public_id.encode("utf-8")).digest()[:8], "big") & ((1 << 63) - 1)
    return value or 1


def load_overrides(path: Path) -> dict[tuple[str, str, str], dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"action", "database_slug", "source_comp_id", "competition_type", "canonical_public_id", "canonical_name", "level_key", "notes"}
        if reader.fieldnames is None or required - set(reader.fieldnames):
            raise RuntimeError(f"Competition override CSV missing columns: {', '.join(sorted(required - set(reader.fieldnames or [])))}")
        result = {}
        for line, raw in enumerate(reader, start=2):
            row = {key: (value or "").strip() for key, value in raw.items()}
            if row["action"] not in VALID_ACTIONS:
                raise RuntimeError(f"Invalid competition override action on line {line}: {row['action']}")
            key = (row["database_slug"], row["source_comp_id"], row["competition_type"])
            if not all(key) or key in result:
                raise RuntimeError(f"Invalid or duplicate competition source key on line {line}")
            if row["action"] in {"link", "create_new"} and not row["canonical_name"]:
                raise RuntimeError(f"Missing canonical_name on competition override line {line}")
            result[key] = row
        return result


def similarity(values: list[str]) -> float:
    normalized = sorted({normalize_name(value) for value in values if normalize_name(value)})
    if len(normalized) < 2:
        return 1.0
    return min(SequenceMatcher(None, left, right).ratio() for left, right in combinations(normalized, 2))


def preferred(values: list[str]) -> str:
    counts = Counter(value for value in values if value)
    return sorted(counts, key=lambda value: (-counts[value], len(value), normalize_name(value)))[0]


def canonical_competition(
    connection,
    name: str,
    nation_id: int | None,
    competition_type: str,
    level_key: str,
    context_slug: str,
    configured_public_id: str = "",
) -> int:
    normalized = normalize_name(name)
    existing = connection.execute(
        """
        SELECT id, public_id FROM canonical_competitions
        WHERE normalized_name=? AND competition_type=? AND level_key=?
          AND canonical_nation_id IS ?
        """,
        (normalized, competition_type, level_key, nation_id),
    ).fetchone()
    if existing:
        if configured_public_id and existing["public_id"] != configured_public_id:
            raise RuntimeError(f"Configured public ID conflicts with stable {existing['public_id']} for {name}")
        return int(existing["id"])
    level_suffix = "" if level_key == "unknown" else f"_{slug_part(level_key)}"
    public_id = configured_public_id or f"competition_{context_slug}_{slug_part(name)}{level_suffix}"
    if not public_id.startswith("competition_"):
        raise RuntimeError(f"Invalid competition public ID: {public_id}")
    integer_id = stable_id(public_id)
    collision = connection.execute(
        "SELECT public_id FROM canonical_competitions WHERE id=? OR public_id=?", (integer_id, public_id)
    ).fetchone()
    if collision:
        raise RuntimeError(f"Competition ID collision: {public_id} conflicts with {collision['public_id']}")
    connection.execute(
        """
        INSERT INTO canonical_competitions(
            id, public_id, preferred_name, normalized_name, canonical_nation_id,
            competition_type, level_key
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        """,
        (integer_id, public_id, name, normalized, nation_id, competition_type, level_key),
    )
    return integer_id


def link(registry_path: Path, overrides_path: Path) -> dict[str, int]:
    overrides = load_overrides(overrides_path)
    connection = registry_connection(registry_path)
    try:
        rows = [dict(row) for row in connection.execute(
            """
            SELECT sc.*, cn.id AS canonical_nation_id, cn.public_id AS nation_public_id
            FROM source_competitions sc
            LEFT JOIN nation_identity_links nl
              ON nl.database_slug=sc.database_slug
             AND nl.source_nation_id=sc.source_nation_id
            LEFT JOIN canonical_nations cn ON cn.id=nl.canonical_nation_id
            WHERE sc.active=1
            ORDER BY sc.database_slug, sc.competition_type, sc.source_comp_id
            """
        )]
        for row in rows:
            if row["canonical_nation_id"] is not None:
                row["context_key"] = f"nation:{row['canonical_nation_id']}"
                row["context_slug"] = row["nation_public_id"].removeprefix("nation_")
            else:
                row["context_key"] = f"continental:{row['continent_id'] or 'unknown'}:{row['scope'] or 'unknown'}"
                row["context_slug"] = f"continental_{slug_part(row['continent_id'] or 'unknown')}_{slug_part(row['scope'] or 'unknown')}"

        code_groups: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
        for row in rows:
            code = normalize_name(row["three_letter_name"])
            if code:
                code_groups[(row["context_key"], row["competition_type"], code)].append(row)
        strong_group_target: dict[tuple[str, str, str], tuple[str, str, float]] = {}
        for key, members in code_groups.items():
            databases = [row["database_slug"] for row in members]
            if len(set(databases)) < 2 or len(databases) != len(set(databases)):
                continue
            levels = {row["inferred_level_key"] for row in members if row["inferred_level_key"] != "unknown"}
            name_score = similarity([row["source_name"] for row in members])
            short_score = similarity([row["short_name"] for row in members])
            if len(levels) > 1 or max(name_score, short_score) < 0.55:
                continue
            level = next(iter(levels), "unknown")
            strong_group_target[key] = (preferred([row["source_name"] for row in members]), level, max(name_score, short_score))

        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            """DELETE FROM competition_identity_links WHERE NOT EXISTS (
                SELECT 1 FROM source_competitions sc
                WHERE sc.database_slug=competition_identity_links.database_slug
                  AND sc.source_comp_id=competition_identity_links.source_comp_id
                  AND sc.competition_type=competition_identity_links.competition_type
                  AND sc.active=1)"""
        )
        unresolved = 0
        for row in rows:
            key = (row["database_slug"], row["source_comp_id"], row["competition_type"])
            override = overrides.get(key)
            if not row["normalized_name"] or (override and override["action"] == "reject_candidate"):
                connection.execute(
                    "DELETE FROM competition_identity_links WHERE database_slug=? AND source_comp_id=? AND competition_type=?", key
                )
                unresolved += 1
                continue
            code_key = (row["context_key"], row["competition_type"], normalize_name(row["three_letter_name"]))
            if override:
                target_name = override["canonical_name"] or row["source_name"]
                level = override["level_key"] or row["inferred_level_key"]
                method = "keep_separate" if override["action"] == "keep_separate" else "manual_override"
                confidence = 1.0; review = "manual_override"
                public_id = override["canonical_public_id"]
            elif code_key in strong_group_target:
                target_name, level, score = strong_group_target[code_key]
                method = "stable_source_code"; confidence = round(0.9 + score * 0.09, 4)
                review = "auto_accepted"; public_id = ""
            else:
                target_name = row["source_name"]; level = row["inferred_level_key"]
                method = "exact_context"; confidence = 1.0
                review = "auto_accepted"; public_id = ""
            target_id = canonical_competition(
                connection, target_name, row["canonical_nation_id"], row["competition_type"],
                level, row["context_slug"], public_id,
            )
            evidence = json.dumps({
                "canonical_nation_id": row["canonical_nation_id"], "context": row["context_key"],
                "inferred_level": row["inferred_level_key"], "source_code": row["three_letter_name"],
                "source_name": row["source_name"], "target_name": target_name,
            }, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
            connection.execute(
                """
                INSERT INTO competition_identity_links(
                    database_slug, source_comp_id, competition_type,
                    canonical_competition_id, canonical_nation_id, match_method,
                    confidence, review_status, evidence_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(database_slug, source_comp_id, competition_type) DO UPDATE SET
                    canonical_competition_id=excluded.canonical_competition_id,
                    canonical_nation_id=excluded.canonical_nation_id,
                    match_method=excluded.match_method, confidence=excluded.confidence,
                    review_status=excluded.review_status, evidence_json=excluded.evidence_json,
                    linked_at=CASE WHEN
                        competition_identity_links.canonical_competition_id<>excluded.canonical_competition_id OR
                        competition_identity_links.match_method<>excluded.match_method OR
                        competition_identity_links.confidence<>excluded.confidence OR
                        competition_identity_links.review_status<>excluded.review_status OR
                        competition_identity_links.evidence_json<>excluded.evidence_json
                        THEN CURRENT_TIMESTAMP ELSE competition_identity_links.linked_at END
                """,
                (*key, target_id, row["canonical_nation_id"], method, confidence, review, evidence),
            )
        connection.commit()
        return {
            "source": len(rows), "canonical": connection.execute("SELECT COUNT(*) FROM canonical_competitions").fetchone()[0],
            "linked": connection.execute("SELECT COUNT(*) FROM competition_identity_links").fetchone()[0],
            "unresolved": unresolved,
            "code_groups": len(strong_group_target),
        }
    except Exception:
        connection.rollback(); raise
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=REGISTRY_DB)
    parser.add_argument("--overrides", type=Path, default=OVERRIDES)
    args = parser.parse_args(); stats = link(args.registry, args.overrides)
    print("source competitions: {source}; canonical: {canonical}; linked: {linked}; unresolved: {unresolved}; strong code groups: {code_groups}".format(**stats))


if __name__ == "__main__": main()
