#!/usr/bin/env python3
"""Generate deterministic Phase 1 nation identity audit reports."""

from __future__ import annotations

import argparse
from collections import defaultdict
from pathlib import Path

from common import AUDIT_DIR, REGISTRY_DB, atomic_csv, registry_connection


HISTORICAL_SEPARATION_GROUPS = (
    ("Yugoslavia", "Serbia and Montenegro", "Serbia"),
    ("Czechoslovakia", "Czech Republic", "Slovakia"),
    ("Soviet Union", "Russia"),
    ("East Germany", "West Germany", "Germany"),
)


def audit(registry_path: Path, audit_dir: Path) -> dict[str, int]:
    connection = registry_connection(registry_path)
    try:
        link_rows = [dict(row) for row in connection.execute(
            """
            SELECT s.database_slug, s.source_nation_id, s.source_name,
                   s.normalized_name AS normalized_source_name,
                   c.id AS canonical_nation_id, c.public_id AS canonical_public_id,
                   c.preferred_name AS canonical_name, c.historical,
                   l.match_method, l.confidence, l.review_status, l.evidence_json
            FROM source_nations s
            JOIN nation_identity_links l USING (database_slug, source_nation_id)
            JOIN canonical_nations c ON c.id = l.canonical_nation_id
            WHERE s.active = 1
            ORDER BY s.database_slug, s.source_nation_id
            """
        )]
        unresolved_rows = [dict(row) for row in connection.execute(
            """
            SELECT s.database_slug, s.source_nation_id, s.source_name,
                   s.normalized_name AS normalized_source_name,
                   CASE
                     WHEN r.action = 'reject_candidate' THEN 'rejected_by_explicit_rule'
                     WHEN s.normalized_name = '' THEN 'empty_normalized_name'
                     ELSE 'not_linked'
                   END AS reason
            FROM source_nations s
            LEFT JOIN nation_identity_links l USING (database_slug, source_nation_id)
            LEFT JOIN nation_alias_rules r ON r.source_normalized_name = s.normalized_name
            WHERE s.active = 1 AND l.canonical_nation_id IS NULL
            ORDER BY s.database_slug, s.source_nation_id
            """
        )]

        names_by_normalized: dict[str, set[str]] = defaultdict(set)
        rows_by_normalized: dict[str, int] = defaultdict(int)
        for row in connection.execute(
            "SELECT source_name, normalized_name FROM source_nations WHERE active = 1"
        ):
            names_by_normalized[row["normalized_name"]].add(row["source_name"] or "")
            rows_by_normalized[row["normalized_name"]] += 1
        collision_rows = [
            {
                "normalized_name": normalized,
                "source_names": " | ".join(sorted(names)),
                "distinct_spelling_count": len(names),
                "source_row_count": rows_by_normalized[normalized],
            }
            for normalized, names in sorted(names_by_normalized.items())
            if normalized and len(names) > 1
        ]

        canonical_by_name = {
            row["preferred_name"]: dict(row)
            for row in connection.execute(
                "SELECT id, public_id, preferred_name, historical FROM canonical_nations"
            )
        }
        separation_rows = []
        preserved_groups = 0
        for group_number, names in enumerate(HISTORICAL_SEPARATION_GROUPS, start=1):
            ids = [canonical_by_name.get(name, {}).get("id") for name in names]
            preserved = all(value is not None for value in ids) and len(set(ids)) == len(ids)
            preserved_groups += int(preserved)
            for name in names:
                canonical = canonical_by_name.get(name, {})
                separation_rows.append({
                    "group": group_number,
                    "canonical_name": name,
                    "canonical_nation_id": canonical.get("id", ""),
                    "canonical_public_id": canonical.get("public_id", ""),
                    "historical": canonical.get("historical", ""),
                    "group_preserved_separately": int(preserved),
                })

        atomic_csv(audit_dir / "nation_links.csv", list(link_rows[0]) if link_rows else [
            "database_slug", "source_nation_id", "source_name", "normalized_source_name",
            "canonical_nation_id", "canonical_public_id", "canonical_name", "historical",
            "match_method", "confidence", "review_status", "evidence_json",
        ], link_rows)
        atomic_csv(audit_dir / "unresolved_nations.csv", [
            "database_slug", "source_nation_id", "source_name", "normalized_source_name", "reason"
        ], unresolved_rows)
        atomic_csv(audit_dir / "nation_name_collisions.csv", [
            "normalized_name", "source_names", "distinct_spelling_count", "source_row_count"
        ], collision_rows)
        atomic_csv(audit_dir / "historical_nations.csv", [
            "group", "canonical_name", "canonical_nation_id", "canonical_public_id",
            "historical", "group_preserved_separately"
        ], separation_rows)

        return {
            "source": int(connection.execute("SELECT COUNT(*) FROM source_nations WHERE active = 1").fetchone()[0]),
            "canonical": len(canonical_by_name),
            "linked": len(link_rows),
            "unresolved": len(unresolved_rows),
            "collisions": len(collision_rows),
            "historical_groups": preserved_groups,
            "historical_groups_total": len(HISTORICAL_SEPARATION_GROUPS),
        }
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=REGISTRY_DB)
    parser.add_argument("--audit-dir", type=Path, default=AUDIT_DIR)
    arguments = parser.parse_args()
    stats = audit(arguments.registry, arguments.audit_dir)
    print("source: {source}; canonical: {canonical}; linked: {linked}; unresolved: {unresolved}; normalized-name collisions: {collisions}; historical separation groups: {historical_groups}/{historical_groups_total}".format(**stats))


if __name__ == "__main__":
    main()
