#!/usr/bin/env python3
"""Conservatively link synchronized source nations to stable canonical nations."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
from pathlib import Path

from common import ALIAS_PATH, REGISTRY_DB, load_alias_rules, normalize_name, registry_connection, slug_part


def truthy(value: str) -> int:
    return 1 if value.casefold() in {"1", "true", "yes", "y"} else 0


def desired_public_id(name: str, configured: str) -> str:
    public_id = configured or f"nation_{slug_part(name)}"
    if not re.fullmatch(r"nation_[a-z0-9_]+", public_id):
        raise RuntimeError(f"Invalid canonical nation public_id: {public_id}")
    return public_id


def stable_integer_id(public_id: str) -> int:
    """Return a positive signed 63-bit ID that does not depend on insertion order."""
    digest = hashlib.sha256(public_id.encode("utf-8")).digest()
    value = int.from_bytes(digest[:8], "big") & ((1 << 63) - 1)
    return value or 1


def canonical_id(
    connection,
    name: str,
    public_id: str = "",
    historical: int = 0,
) -> int:
    normalized = normalize_name(name)
    if not normalized:
        raise RuntimeError("Cannot create a canonical nation with an empty name")
    existing = connection.execute(
        "SELECT id, public_id FROM canonical_nations WHERE normalized_name = ?", (normalized,)
    ).fetchone()
    if existing is not None:
        if public_id and existing["public_id"] != public_id:
            raise RuntimeError(
                f"Configured public_id {public_id} conflicts with stable existing ID {existing['public_id']} for {name}"
            )
        if historical:
            connection.execute(
                "UPDATE canonical_nations SET historical = 1, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND historical = 0",
                (existing["id"],),
            )
        return int(existing["id"])

    generated = desired_public_id(name, public_id)
    collision = connection.execute(
        "SELECT preferred_name FROM canonical_nations WHERE public_id = ?", (generated,)
    ).fetchone()
    if collision is not None:
        raise RuntimeError(
            f"Public ID collision: {generated} is already assigned to {collision['preferred_name']}"
        )
    integer_id = stable_integer_id(generated)
    integer_collision = connection.execute(
        "SELECT public_id FROM canonical_nations WHERE id = ?", (integer_id,)
    ).fetchone()
    if integer_collision is not None:
        raise RuntimeError(
            f"Stable integer ID collision between {generated} and {integer_collision['public_id']}"
        )
    connection.execute(
        """
        INSERT INTO canonical_nations(id, public_id, preferred_name, normalized_name, historical)
        VALUES (?, ?, ?, ?, ?)
        """,
        (integer_id, generated, name, normalized, historical),
    )
    return integer_id


def link(registry_path: Path, alias_path: Path) -> dict[str, int]:
    rules = load_alias_rules(alias_path)
    rules_by_name = {normalize_name(row["source_name"]): row for row in rules}
    connection = registry_connection(registry_path)
    unresolved = 0
    try:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("DELETE FROM nation_alias_rules")
        for rule in rules:
            normalized = normalize_name(rule["source_name"] or rule["canonical_name"])
            connection.execute(
                """
                INSERT INTO nation_alias_rules(
                    source_normalized_name, source_name, action, canonical_name,
                    canonical_public_id, historical, notes
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    normalized,
                    rule["source_name"] or rule["canonical_name"],
                    rule["action"],
                    rule["canonical_name"] or None,
                    rule["public_id"] or None,
                    truthy(rule["historical"]),
                    rule["notes"],
                ),
            )
            if rule["action"] == "create_new":
                canonical_id(
                    connection,
                    rule["canonical_name"],
                    rule["public_id"],
                    truthy(rule["historical"]),
                )

        connection.execute(
            """
            DELETE FROM nation_identity_links
            WHERE NOT EXISTS (
                SELECT 1 FROM source_nations s
                WHERE s.database_slug = nation_identity_links.database_slug
                  AND s.source_nation_id = nation_identity_links.source_nation_id
                  AND s.active = 1
            )
            """
        )
        sources = list(
            connection.execute(
                """
                SELECT database_slug, source_nation_id, source_name, normalized_name
                FROM source_nations WHERE active = 1
                ORDER BY database_slug, source_nation_id
                """
            )
        )
        for source in sources:
            normalized = source["normalized_name"]
            rule = rules_by_name.get(normalized)
            if not normalized:
                connection.execute(
                    "DELETE FROM nation_identity_links WHERE database_slug = ? AND source_nation_id = ?",
                    (source["database_slug"], source["source_nation_id"]),
                )
                unresolved += 1
                continue
            if rule and rule["action"] == "reject_candidate":
                connection.execute(
                    "DELETE FROM nation_identity_links WHERE database_slug = ? AND source_nation_id = ?",
                    (source["database_slug"], source["source_nation_id"]),
                )
                unresolved += 1
                continue

            if rule and rule["action"] in {"link", "create_new"}:
                target_name = rule["canonical_name"]
                method = "explicit_alias" if rule["action"] == "link" else "keep_separate"
                confidence = 1.0
                review_status = "manual_override"
                configured_public_id = rule["public_id"]
                historical = truthy(rule["historical"])
            elif rule and rule["action"] == "keep_separate":
                target_name = source["source_name"]
                method = "keep_separate"
                confidence = 1.0
                review_status = "manual_override"
                configured_public_id = rule["public_id"]
                historical = truthy(rule["historical"])
            else:
                target_name = source["source_name"]
                method = "exact_normalized"
                confidence = 1.0
                review_status = "auto_accepted"
                configured_public_id = ""
                historical = 0

            target_id = canonical_id(
                connection, target_name, configured_public_id, historical
            )
            evidence = json.dumps(
                {
                    "normalized_source_name": normalized,
                    "rule_action": rule["action"] if rule else None,
                    "source_name": source["source_name"],
                    "target_name": target_name,
                },
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            )
            connection.execute(
                """
                INSERT INTO nation_identity_links(
                    database_slug, source_nation_id, canonical_nation_id,
                    match_method, confidence, review_status, evidence_json
                ) VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(database_slug, source_nation_id) DO UPDATE SET
                    canonical_nation_id = excluded.canonical_nation_id,
                    match_method = excluded.match_method,
                    confidence = excluded.confidence,
                    review_status = excluded.review_status,
                    evidence_json = excluded.evidence_json,
                    linked_at = CASE
                        WHEN nation_identity_links.canonical_nation_id <> excluded.canonical_nation_id
                          OR nation_identity_links.match_method <> excluded.match_method
                          OR nation_identity_links.confidence <> excluded.confidence
                          OR nation_identity_links.review_status <> excluded.review_status
                          OR nation_identity_links.evidence_json <> excluded.evidence_json
                        THEN CURRENT_TIMESTAMP
                        ELSE nation_identity_links.linked_at
                    END
                """,
                (
                    source["database_slug"], source["source_nation_id"], target_id,
                    method, confidence, review_status, evidence,
                ),
            )
        connection.commit()
        return {
            "source": len(sources),
            "canonical": int(connection.execute("SELECT COUNT(*) FROM canonical_nations").fetchone()[0]),
            "linked": int(connection.execute("SELECT COUNT(*) FROM nation_identity_links").fetchone()[0]),
            "unresolved": unresolved,
        }
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=REGISTRY_DB)
    parser.add_argument("--aliases", type=Path, default=ALIAS_PATH)
    arguments = parser.parse_args()
    stats = link(arguments.registry, arguments.aliases)
    print("source nation rows: {source}; canonical nations: {canonical}; linked: {linked}; unresolved: {unresolved}".format(**stats))


if __name__ == "__main__":
    main()
