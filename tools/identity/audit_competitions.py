#!/usr/bin/env python3
"""Generate deterministic Phase 2 competition identity audit reports."""

from __future__ import annotations

import argparse
from collections import defaultdict
from pathlib import Path

from common import AUDIT_DIR, REGISTRY_DB, atomic_csv, normalize_name, registry_connection


def audit(registry_path: Path, audit_dir: Path) -> dict[str, int]:
    connection = registry_connection(registry_path)
    try:
        links = [dict(row) for row in connection.execute(
            """
            SELECT sc.database_slug, sc.source_comp_id, sc.competition_type,
                   sc.source_name, sc.short_name, sc.three_letter_name,
                   sc.source_nation_id, sc.continent_id, sc.scope,
                   sc.inferred_level_key, cn.public_id AS canonical_nation_public_id,
                   cc.id AS canonical_competition_id,
                   cc.public_id AS canonical_competition_public_id,
                   cc.preferred_name AS canonical_name, cc.level_key,
                   l.match_method, l.confidence, l.review_status, l.evidence_json
            FROM source_competitions sc
            JOIN competition_identity_links l USING(database_slug, source_comp_id, competition_type)
            JOIN canonical_competitions cc ON cc.id=l.canonical_competition_id
            LEFT JOIN canonical_nations cn ON cn.id=l.canonical_nation_id
            WHERE sc.active=1
            ORDER BY sc.database_slug, sc.competition_type, sc.source_comp_id
            """
        )]
        unresolved = [dict(row) for row in connection.execute(
            """
            SELECT sc.database_slug, sc.source_comp_id, sc.competition_type,
                   sc.source_name, sc.normalized_name, sc.source_nation_id,
                   sc.inferred_level_key, 'not_linked' AS reason
            FROM source_competitions sc
            LEFT JOIN competition_identity_links l USING(database_slug, source_comp_id, competition_type)
            WHERE sc.active=1 AND l.canonical_competition_id IS NULL
            ORDER BY sc.database_slug, sc.competition_type, sc.source_comp_id
            """
        )]

        groups: dict[tuple[str, str, str], list[dict]] = defaultdict(list)
        for row in links:
            context = row["canonical_nation_public_id"] or f"continent:{row['continent_id']}:scope:{row['scope']}"
            code = normalize_name(row["three_letter_name"])
            if code:
                groups[(context, row["competition_type"], code)].append(row)
        ambiguous = []
        for (context, comp_type, code), members in sorted(groups.items()):
            names = sorted({row["source_name"] for row in members})
            canonical_ids = {row["canonical_competition_id"] for row in members}
            databases = [row["database_slug"] for row in members]
            same_database_code_collision = len(databases) != len(set(databases))
            if len(names) > 1 and (len(canonical_ids) > 1 or same_database_code_collision):
                ambiguous.append({
                    "context": context, "competition_type": comp_type, "source_code": code,
                    "source_names": " | ".join(names),
                    "canonical_public_ids": " | ".join(sorted({row["canonical_competition_public_id"] for row in members})),
                    "source_row_count": len(members),
                    "reason": "same_database_code_collision" if same_database_code_collision else "variant_names_not_auto_merged",
                })

        link_fields = list(links[0]) if links else [
            "database_slug", "source_comp_id", "competition_type", "source_name",
            "canonical_competition_id", "canonical_competition_public_id", "match_method",
        ]
        atomic_csv(audit_dir / "competition_links.csv", link_fields, links)
        atomic_csv(audit_dir / "unresolved_competitions.csv", [
            "database_slug", "source_comp_id", "competition_type", "source_name",
            "normalized_name", "source_nation_id", "inferred_level_key", "reason",
        ], unresolved)
        atomic_csv(audit_dir / "ambiguous_competitions.csv", [
            "context", "competition_type", "source_code", "source_names",
            "canonical_public_ids", "source_row_count", "reason",
        ], ambiguous)
        return {
            "source": connection.execute("SELECT COUNT(*) FROM source_competitions WHERE active=1").fetchone()[0],
            "canonical": connection.execute("SELECT COUNT(*) FROM canonical_competitions").fetchone()[0],
            "linked": len(links), "unresolved": len(unresolved), "ambiguous": len(ambiguous),
        }
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=REGISTRY_DB)
    parser.add_argument("--audit-dir", type=Path, default=AUDIT_DIR)
    args = parser.parse_args(); stats = audit(args.registry, args.audit_dir)
    print("source: {source}; canonical: {canonical}; linked: {linked}; unresolved: {unresolved}; ambiguous candidates: {ambiguous}".format(**stats))


if __name__ == "__main__": main()
