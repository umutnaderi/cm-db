#!/usr/bin/env python3
"""Apply explicit raw player-club name aliases to the identity registry."""

from __future__ import annotations

import argparse
import csv
from pathlib import Path

from common import REGISTRY_DB, ROOT, registry_connection


ALIASES = ROOT / "config" / "identity" / "player_club_name_aliases.csv"


def load_aliases(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {
            "database_slug",
            "source_club_name",
            "canonical_public_id",
            "notes",
        }
        if reader.fieldnames is None or required - set(reader.fieldnames):
            raise RuntimeError("Player club alias CSV has invalid columns")
        rows = [
            {key: (value or "").strip() for key, value in row.items()}
            for row in reader
        ]
    keys = [(row["database_slug"], row["source_club_name"]) for row in rows]
    if any(not all(key) for key in keys) or len(keys) != len(set(keys)):
        raise RuntimeError("Player club aliases contain an empty or duplicate key")
    return rows


def apply(registry_path: Path, aliases_path: Path) -> dict[str, int]:
    connection = registry_connection(registry_path)
    aliases = load_aliases(aliases_path)
    matched = changed = 0
    try:
        connection.execute("BEGIN IMMEDIATE")
        for alias in aliases:
            canonical = connection.execute(
                "SELECT id FROM canonical_clubs WHERE public_id = ?",
                (alias["canonical_public_id"],),
            ).fetchone()
            if canonical is None:
                raise RuntimeError(
                    f"Canonical club not found: {alias['canonical_public_id']}"
                )
            count = connection.execute(
                """
                SELECT count(*)
                FROM source_players
                WHERE database_slug = ?
                  AND club_name = ?
                  AND active = 1
                """,
                (alias["database_slug"], alias["source_club_name"]),
            ).fetchone()[0]
            matched += count
            changed += connection.execute(
                """
                UPDATE source_players
                   SET canonical_club_id = ?,
                       last_changed_at = CURRENT_TIMESTAMP
                 WHERE database_slug = ?
                   AND club_name = ?
                   AND active = 1
                   AND canonical_club_id IS NOT ?
                """,
                (
                    canonical["id"],
                    alias["database_slug"],
                    alias["source_club_name"],
                    canonical["id"],
                ),
            ).rowcount
        connection.commit()
        return {"aliases": len(aliases), "matched": matched, "changed": changed}
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=REGISTRY_DB)
    parser.add_argument("--aliases", type=Path, default=ALIASES)
    args = parser.parse_args()
    result = apply(args.registry, args.aliases)
    print(
        "aliases: {aliases}; matched player rows: {matched}; "
        "changed player rows: {changed}".format(**result)
    )


if __name__ == "__main__":
    main()
