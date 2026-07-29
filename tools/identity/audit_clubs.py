#!/usr/bin/env python3
"""Generate canonical club link, unresolved, and safety audit reports."""

from __future__ import annotations

import argparse
from pathlib import Path

from common import AUDIT_DIR, REGISTRY_DB, atomic_csv, registry_connection


def audit(registry_path: Path, audit_dir: Path) -> dict[str, int]:
    connection = registry_connection(registry_path)
    try:
        links = [dict(row) for row in connection.execute(
            """
            SELECT
              s.database_slug,
              s.source_club_id,
              s.source_name,
              s.short_name,
              s.nation_name,
              s.team_type,
              c.id AS canonical_club_id,
              c.public_id AS canonical_public_id,
              c.preferred_name AS canonical_name,
              n.public_id AS canonical_nation_public_id,
              l.match_method,
              l.confidence,
              l.review_status,
              l.evidence_json
            FROM source_clubs s
            JOIN club_identity_links l USING(database_slug,source_club_id)
            JOIN canonical_clubs c ON c.id=l.canonical_club_id
            LEFT JOIN canonical_nations n ON n.id=c.canonical_nation_id
            WHERE s.active=1
            ORDER BY s.database_slug,s.source_club_id
            """
        )]
        unresolved = [dict(row) for row in connection.execute(
            """
            SELECT
              s.database_slug,
              s.source_club_id,
              s.source_name,
              s.short_name,
              s.nation_name,
              s.team_type,
              'insufficient_conservative_evidence' AS reason
            FROM source_clubs s
            LEFT JOIN club_identity_links l USING(database_slug,source_club_id)
            WHERE s.active=1 AND l.canonical_club_id IS NULL
            ORDER BY s.normalized_name,s.database_slug,s.source_club_id
            """
        )]
        duplicate_database = int(connection.execute(
            """
            SELECT COUNT(*) FROM(
              SELECT l.canonical_club_id,s.database_slug,COUNT(*) AS n
              FROM club_identity_links l
              JOIN source_clubs s USING(database_slug,source_club_id)
              WHERE s.active=1
              GROUP BY l.canonical_club_id,s.database_slug
              HAVING n>1
            )
            """
        ).fetchone()[0])
        mixed_team_type = int(connection.execute(
            """
            SELECT COUNT(*) FROM(
              SELECT l.canonical_club_id
              FROM club_identity_links l
              JOIN source_clubs s USING(database_slug,source_club_id)
              WHERE s.active=1
              GROUP BY l.canonical_club_id
              HAVING COUNT(DISTINCT s.team_type)>1
            )
            """
        ).fetchone()[0])
        mixed_nation = int(connection.execute(
            """
            SELECT COUNT(*) FROM(
              SELECT l.canonical_club_id
              FROM club_identity_links l
              JOIN source_clubs s USING(database_slug,source_club_id)
              WHERE s.active=1 AND s.nation_name IS NOT NULL AND s.nation_name<>''
              GROUP BY l.canonical_club_id
              HAVING COUNT(DISTINCT s.nation_name)>1
            )
            """
        ).fetchone()[0])
        foreign_keys = len(connection.execute("PRAGMA foreign_key_check").fetchall())

        atomic_csv(
            audit_dir/"club_links.csv",
            list(links[0]) if links else [
                "database_slug","source_club_id","source_name","short_name",
                "nation_name","team_type","canonical_club_id","canonical_public_id",
                "canonical_name","canonical_nation_public_id","match_method",
                "confidence","review_status","evidence_json",
            ],
            links,
        )
        atomic_csv(
            audit_dir/"unresolved_clubs.csv",
            [
                "database_slug","source_club_id","source_name","short_name",
                "nation_name","team_type","reason",
            ],
            unresolved,
        )
        atomic_csv(
            audit_dir/"club_safety.csv",
            ["check","violations"],
            [
                {"check":"duplicate_source_database_within_canonical","violations":duplicate_database},
                {"check":"mixed_team_type_within_canonical","violations":mixed_team_type},
                {"check":"mixed_source_nation_name_within_canonical","violations":mixed_nation},
                {"check":"foreign_key_violations","violations":foreign_keys},
            ],
        )
        source = int(connection.execute(
            "SELECT COUNT(*) FROM source_clubs WHERE active=1"
        ).fetchone()[0])
        return {
            "source":source,
            "canonical":int(connection.execute(
                "SELECT COUNT(*) FROM canonical_clubs"
            ).fetchone()[0]),
            "linked":len(links),
            "unresolved":len(unresolved),
            "duplicate_database":duplicate_database,
            "mixed_team_type":mixed_team_type,
            "mixed_nation":mixed_nation,
            "foreign_keys":foreign_keys,
        }
    finally:
        connection.close()


def main() -> None:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry",type=Path,default=REGISTRY_DB)
    parser.add_argument("--audit-dir",type=Path,default=AUDIT_DIR)
    arguments=parser.parse_args()
    stats=audit(arguments.registry,arguments.audit_dir)
    print(
        "source: {source}; canonical: {canonical}; linked: {linked}; "
        "unresolved: {unresolved}; duplicate-db: {duplicate_database}; "
        "mixed-team-type: {mixed_team_type}; mixed-nation: {mixed_nation}; "
        "foreign-key violations: {foreign_keys}".format(**stats)
    )


if __name__=="__main__":
    main()
