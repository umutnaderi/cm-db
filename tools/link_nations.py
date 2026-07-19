#!/usr/bin/env python3
"""Build canonical nation identities and source-row links for Retroball.

This script is intentionally conservative:
- source rows in `nations` are never modified;
- empty and ambiguous names are not linked;
- exact normalized matches and explicit aliases are the only automatic links.
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import sqlite3
import sys
import unicodedata
from collections import defaultdict
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_DB = ROOT / "db" / "retroball.sqlite"
DEFAULT_ALIAS_PATH = ROOT / "config" / "nation_aliases.json"
AUDIT_DIR = ROOT / "audit"

SOURCE_TABLE = "nations"
CANONICAL_TABLE = "canonical_nations"
LINK_TABLE = "nation_identity_links"

DATABASE_COLUMN_CANDIDATES = ("database_slug", "db_slug", "database")
SOURCE_ID_COLUMN_CANDIDATES = ("source_nation_id", "nation_id", "source_id", "row_id", "id")
SOURCE_NAME_COLUMN_CANDIDATES = ("name", "nation_name", "display_name", "short_name")


def normalize_name(value: Any) -> str:
    """Normalize a nation name for deterministic matching."""
    if value is None:
        return ""

    text = unicodedata.normalize("NFKD", str(value))
    text = "".join(char for char in text if not unicodedata.combining(char))
    text = text.casefold()
    text = text.replace("&", " and ")
    text = re.sub(r"[^\w\s]", " ", text, flags=re.UNICODE)
    text = re.sub(r"_+", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text


def public_id_for(preferred_name: str) -> str:
    normalized = normalize_name(preferred_name)
    slug = re.sub(r"[^a-z0-9]+", "_", normalized).strip("_")
    return f"nat_{slug or 'unknown'}"


def read_json(path: Path) -> dict[str, Any]:
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def table_info(conn: sqlite3.Connection, table: str) -> list[sqlite3.Row]:
    rows = list(conn.execute(f"PRAGMA table_info({table})"))
    if not rows:
        raise RuntimeError(f"Required table does not exist or has no columns: {table}")
    return rows


def column_names(conn: sqlite3.Connection, table: str) -> set[str]:
    return {str(row["name"]) for row in table_info(conn, table)}


def choose_column(columns: set[str], candidates: tuple[str, ...], label: str) -> str:
    for candidate in candidates:
        if candidate in columns:
            return candidate
    raise RuntimeError(
        f"Could not identify {label} column. Available columns: {', '.join(sorted(columns))}"
    )


def inspect_source_columns(conn: sqlite3.Connection) -> tuple[str, str, str]:
    columns = column_names(conn, SOURCE_TABLE)
    database_column = choose_column(columns, DATABASE_COLUMN_CANDIDATES, "database slug")
    source_id_column = choose_column(columns, SOURCE_ID_COLUMN_CANDIDATES, "source nation ID")
    source_name_column = choose_column(columns, SOURCE_NAME_COLUMN_CANDIDATES, "source nation name")
    return database_column, source_id_column, source_name_column


def ensure_required_target_columns(conn: sqlite3.Connection) -> None:
    required_canonical = {
        "id",
        "public_id",
        "preferred_name",
        "normalized_name",
        "historical",
    }
    required_links = {
        "database_slug",
        "source_nation_id",
        "canonical_nation_id",
        "source_name",
        "normalized_source_name",
        "match_method",
        "confidence",
        "review_status",
        "evidence_json",
    }

    canonical_columns = column_names(conn, CANONICAL_TABLE)
    link_columns = column_names(conn, LINK_TABLE)
    missing_canonical = required_canonical - canonical_columns
    missing_links = required_links - link_columns

    if missing_canonical:
        raise RuntimeError(
            f"{CANONICAL_TABLE} is missing columns: {', '.join(sorted(missing_canonical))}"
        )
    if missing_links:
        raise RuntimeError(f"{LINK_TABLE} is missing columns: {', '.join(sorted(missing_links))}")


def load_aliases(path: Path) -> tuple[dict[str, str], dict[str, str], set[str], list[str]]:
    config = read_json(path)
    aliases = {
        normalize_name(source): str(target).strip()
        for source, target in dict(config.get("aliases", {})).items()
        if normalize_name(source) and str(target).strip()
    }
    ambiguous = {
        normalize_name(source): str(reason).strip()
        for source, reason in dict(config.get("ambiguous", {})).items()
        if normalize_name(source)
    }
    historical = {normalize_name(name) for name in config.get("historical", []) if normalize_name(name)}
    seed_canonicals = [
        str(name).strip()
        for name in config.get("seed_canonicals", [])
        if str(name).strip() and normalize_name(name)
    ]
    return aliases, ambiguous, historical, seed_canonicals


def fetch_source_rows(
    conn: sqlite3.Connection,
    database_column: str,
    source_id_column: str,
    source_name_column: str,
) -> list[dict[str, Any]]:
    sql = f"""
        SELECT
          {database_column} AS database_slug,
          {source_id_column} AS source_nation_id,
          {source_name_column} AS source_name
        FROM {SOURCE_TABLE}
        ORDER BY {database_column}, {source_id_column}
    """
    return [dict(row) for row in conn.execute(sql)]


def upsert_canonical(
    conn: sqlite3.Connection,
    preferred_name: str,
    historical_names: set[str],
) -> int:
    normalized = normalize_name(preferred_name)
    public_id = public_id_for(preferred_name)
    historical = 1 if normalized in historical_names else 0

    conn.execute(
        f"""
        INSERT INTO {CANONICAL_TABLE}
          (public_id, preferred_name, normalized_name, historical)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(normalized_name) DO UPDATE SET
          public_id = excluded.public_id,
          preferred_name = excluded.preferred_name,
          historical = excluded.historical
        """,
        (public_id, preferred_name, normalized, historical),
    )
    row = conn.execute(
        f"SELECT id FROM {CANONICAL_TABLE} WHERE normalized_name = ?",
        (normalized,),
    ).fetchone()
    if row is None:
        raise RuntimeError(f"Failed to upsert canonical nation: {preferred_name}")
    return int(row["id"])


def upsert_link(
    conn: sqlite3.Connection,
    source_row: dict[str, Any],
    canonical_id: int,
    normalized_source_name: str,
    match_method: str,
    confidence: float,
    evidence: dict[str, Any],
) -> None:
    conn.execute(
        f"""
        INSERT INTO {LINK_TABLE}
          (
            database_slug,
            source_nation_id,
            canonical_nation_id,
            source_name,
            normalized_source_name,
            match_method,
            confidence,
            review_status,
            evidence_json
          )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(database_slug, source_nation_id) DO UPDATE SET
          canonical_nation_id = excluded.canonical_nation_id,
          source_name = excluded.source_name,
          normalized_source_name = excluded.normalized_source_name,
          match_method = excluded.match_method,
          confidence = excluded.confidence,
          review_status = excluded.review_status,
          evidence_json = excluded.evidence_json
        """,
        (
            str(source_row["database_slug"]),
            str(source_row["source_nation_id"]),
            canonical_id,
            source_row["source_name"],
            normalized_source_name,
            match_method,
            confidence,
            "auto_accepted",
            json.dumps(evidence, ensure_ascii=False, sort_keys=True),
        ),
    )


def write_csv(path: Path, rows: list[dict[str, Any]], fieldnames: list[str]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)


def build_name_collisions(
    source_rows: list[dict[str, Any]],
    link_rows: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    raw_by_normalized: dict[str, set[str]] = defaultdict(set)
    count_by_normalized: dict[str, int] = defaultdict(int)
    for row in source_rows:
        normalized = normalize_name(row["source_name"])
        if not normalized:
            continue
        raw_by_normalized[normalized].add(str(row["source_name"]))
        count_by_normalized[normalized] += 1

    source_collision_rows = [
        {
            "collision_type": "source_normalized_name",
            "key": normalized,
            "source_names": " | ".join(sorted(names)),
            "canonical_public_id": "",
            "canonical_preferred_name": "",
            "source_row_count": count_by_normalized[normalized],
        }
        for normalized, names in raw_by_normalized.items()
        if len(names) > 1
    ]

    aliases_by_canonical: dict[str, set[str]] = defaultdict(set)
    canonical_name_by_public_id: dict[str, str] = {}
    count_by_public_id: dict[str, int] = defaultdict(int)
    for row in link_rows:
        aliases_by_canonical[str(row["canonical_public_id"])].add(str(row["source_name"]))
        canonical_name_by_public_id[str(row["canonical_public_id"])] = str(row["canonical_preferred_name"])
        count_by_public_id[str(row["canonical_public_id"])] += 1

    alias_collision_rows = [
        {
            "collision_type": "canonical_alias_group",
            "key": public_id,
            "source_names": " | ".join(sorted(names)),
            "canonical_public_id": public_id,
            "canonical_preferred_name": canonical_name_by_public_id[public_id],
            "source_row_count": count_by_public_id[public_id],
        }
        for public_id, names in aliases_by_canonical.items()
        if len(names) > 1
    ]

    return sorted(
        source_collision_rows + alias_collision_rows,
        key=lambda row: (str(row["collision_type"]), str(row["key"])),
    )


def reset_targets(conn: sqlite3.Connection) -> None:
    conn.execute(f"DELETE FROM {LINK_TABLE}")
    conn.execute(f"DELETE FROM {CANONICAL_TABLE}")


def link_nations(db_path: Path, alias_path: Path, reset: bool) -> dict[str, int]:
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")

    unresolved_rows: list[dict[str, Any]] = []
    link_audit_rows: list[dict[str, Any]] = []

    try:
        database_column, source_id_column, source_name_column = inspect_source_columns(conn)
        ensure_required_target_columns(conn)
        aliases, ambiguous, historical_names, seed_canonicals = load_aliases(alias_path)
        source_rows = fetch_source_rows(conn, database_column, source_id_column, source_name_column)

        with conn:
            if reset:
                reset_targets(conn)

            for preferred_name in seed_canonicals:
                upsert_canonical(conn, preferred_name, historical_names)

            for source_row in source_rows:
                source_name = str(source_row["source_name"] or "").strip()
                normalized_source = normalize_name(source_name)
                base_audit = {
                    "database_slug": source_row["database_slug"],
                    "source_nation_id": source_row["source_nation_id"],
                    "source_name": source_name,
                    "normalized_source_name": normalized_source,
                }

                if not normalized_source:
                    unresolved_rows.append({**base_audit, "reason": "empty_name"})
                    continue

                if normalized_source in ambiguous:
                    unresolved_rows.append(
                        {**base_audit, "reason": f"ambiguous: {ambiguous[normalized_source]}"}
                    )
                    continue

                if normalized_source in aliases:
                    preferred_name = aliases[normalized_source]
                    match_method = "alias"
                    confidence = 0.98
                else:
                    preferred_name = source_name
                    match_method = "exact_normalized"
                    confidence = 1.0

                canonical_id = upsert_canonical(conn, preferred_name, historical_names)
                canonical = conn.execute(
                    f"""
                    SELECT id, public_id, preferred_name, normalized_name, historical
                    FROM {CANONICAL_TABLE}
                    WHERE id = ?
                    """,
                    (canonical_id,),
                ).fetchone()
                evidence = {
                    "source_table": SOURCE_TABLE,
                    "database_slug": source_row["database_slug"],
                    "source_nation_id": str(source_row["source_nation_id"]),
                    "source_name": source_name,
                    "normalized_source_name": normalized_source,
                    "canonical_normalized_name": canonical["normalized_name"],
                    "alias_target": preferred_name if match_method == "alias" else None,
                }
                upsert_link(
                    conn,
                    source_row,
                    canonical_id,
                    normalized_source,
                    match_method,
                    confidence,
                    evidence,
                )
                link_audit_rows.append(
                    {
                        **base_audit,
                        "canonical_nation_id": canonical_id,
                        "canonical_public_id": canonical["public_id"],
                        "canonical_preferred_name": canonical["preferred_name"],
                        "canonical_normalized_name": canonical["normalized_name"],
                        "match_method": match_method,
                        "confidence": confidence,
                        "review_status": "auto_accepted",
                        "historical": canonical["historical"],
                        "evidence_json": json.dumps(evidence, ensure_ascii=False, sort_keys=True),
                    }
                )

        canonical_count = int(conn.execute(f"SELECT COUNT(*) FROM {CANONICAL_TABLE}").fetchone()[0])
        linked_count = int(conn.execute(f"SELECT COUNT(*) FROM {LINK_TABLE}").fetchone()[0])
        source_count = len(source_rows)

        collision_rows = build_name_collisions(source_rows, link_audit_rows)

        write_csv(
            AUDIT_DIR / "nation_links.csv",
            link_audit_rows,
            [
                "database_slug",
                "source_nation_id",
                "source_name",
                "normalized_source_name",
                "canonical_nation_id",
                "canonical_public_id",
                "canonical_preferred_name",
                "canonical_normalized_name",
                "match_method",
                "confidence",
                "review_status",
                "historical",
                "evidence_json",
            ],
        )
        write_csv(
            AUDIT_DIR / "unresolved_nations.csv",
            unresolved_rows,
            [
                "database_slug",
                "source_nation_id",
                "source_name",
                "normalized_source_name",
                "reason",
            ],
        )
        write_csv(
            AUDIT_DIR / "nation_name_collisions.csv",
            collision_rows,
            [
                "collision_type",
                "key",
                "source_names",
                "canonical_public_id",
                "canonical_preferred_name",
                "source_row_count",
            ],
        )

        return {
            "source_nation_rows": source_count,
            "canonical_nations": canonical_count,
            "linked_source_rows": linked_count,
            "unresolved_rows": len(unresolved_rows),
            "collisions": len(collision_rows),
        }
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Link source nations to canonical Retroball nations.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB, help=f"SQLite DB path (default: {DEFAULT_DB})")
    parser.add_argument(
        "--aliases",
        type=Path,
        default=DEFAULT_ALIAS_PATH,
        help=f"Nation alias config path (default: {DEFAULT_ALIAS_PATH})",
    )
    parser.add_argument(
        "--reset",
        action="store_true",
        help="Clear only canonical_nations and nation_identity_links before rebuilding.",
    )
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    try:
        stats = link_nations(args.db, args.aliases, args.reset)
    except Exception as error:
        print(f"ERROR: {error}", file=sys.stderr)
        return 1

    print(f"source nation rows: {stats['source_nation_rows']}")
    print(f"canonical nations: {stats['canonical_nations']}")
    print(f"linked source rows: {stats['linked_source_rows']}")
    print(f"unresolved rows: {stats['unresolved_rows']}")
    print(f"collisions: {stats['collisions']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
