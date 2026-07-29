#!/usr/bin/env python3
"""Resolve player club names through unique official and short club names."""

from __future__ import annotations

import argparse
from collections import defaultdict
from pathlib import Path

from common import REGISTRY_DB, registry_connection


def apply(registry_path: Path) -> dict[str, int]:
    connection = registry_connection(registry_path)
    candidates: dict[tuple[str, str], set[int]] = defaultdict(set)
    try:
        for row in connection.execute(
            """
            SELECT
              s.database_slug,
              s.source_name,
              s.short_name,
              l.canonical_club_id
            FROM source_clubs s
            JOIN club_identity_links l
              USING(database_slug, source_club_id)
            WHERE s.active = 1
            """
        ):
            for source_name in {row["source_name"], row["short_name"]}:
                if source_name:
                    candidates[(row["database_slug"], source_name)].add(
                        row["canonical_club_id"]
                    )

        unique = {
            key: next(iter(canonical_ids))
            for key, canonical_ids in candidates.items()
            if len(canonical_ids) == 1
        }

        connection.execute("BEGIN IMMEDIATE")
        connection.execute(
            """
            CREATE TEMP TABLE short_name_club_map (
              database_slug TEXT NOT NULL,
              club_name TEXT NOT NULL,
              canonical_club_id INTEGER NOT NULL,
              PRIMARY KEY(database_slug, club_name)
            ) WITHOUT ROWID
            """
        )
        connection.executemany(
            "INSERT INTO short_name_club_map VALUES(?, ?, ?)",
            (
                (key[0], key[1], canonical_club_id)
                for key, canonical_club_id in unique.items()
            ),
        )
        matched = connection.execute(
            """
            SELECT count(*)
            FROM source_players p
            JOIN short_name_club_map m
              ON m.database_slug = p.database_slug
             AND m.club_name = p.club_name
            WHERE p.active = 1
            """
        ).fetchone()[0]
        changed = connection.execute(
            """
            UPDATE source_players
               SET canonical_club_id = (
                     SELECT m.canonical_club_id
                     FROM short_name_club_map m
                     WHERE m.database_slug = source_players.database_slug
                       AND m.club_name = source_players.club_name
                   ),
                   last_changed_at = CURRENT_TIMESTAMP
             WHERE active = 1
               AND EXISTS (
                     SELECT 1
                     FROM short_name_club_map m
                     WHERE m.database_slug = source_players.database_slug
                       AND m.club_name = source_players.club_name
                       AND m.canonical_club_id IS NOT source_players.canonical_club_id
                   )
            """
        ).rowcount
        connection.commit()
        return {
            "unique_club_names": len(unique),
            "matched_player_rows": matched,
            "changed_player_rows": changed,
        }
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=REGISTRY_DB)
    args = parser.parse_args()
    result = apply(args.registry)
    print(
        "unique club names: {unique_club_names}; "
        "matched player rows: {matched_player_rows}; "
        "changed player rows: {changed_player_rows}".format(**result)
    )


if __name__ == "__main__":
    main()
