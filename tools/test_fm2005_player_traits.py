#!/usr/bin/env python3
"""Deterministic checks for the normalized FM2005 preferred-move import."""

from __future__ import annotations

import sqlite3
import tempfile
from collections import defaultdict
from pathlib import Path

from import_fm2005_player_traits import (
    DATABASE_SLUG,
    import_database,
    load_config,
)


ROOT = Path(__file__).resolve().parents[1]
CONFIG_DIR = ROOT / "config" / "player_traits" / "fm2005_v1"


def check(condition: bool, message: str) -> None:
    if not condition:
        raise AssertionError(message)
    print(f"PASS -- {message}")


def create_fixture_database(path: Path, player_dobs: dict[str, str]) -> None:
    connection = sqlite3.connect(path)
    try:
        connection.execute(
            """
            CREATE TABLE player_profile (
              database_slug TEXT NOT NULL,
              source_person_id TEXT NOT NULL,
              date_of_birth TEXT,
              PRIMARY KEY (database_slug, source_person_id)
            )
            """
        )
        connection.executemany(
            "INSERT INTO player_profile VALUES (?, ?, ?)",
            [
                (DATABASE_SLUG, person_id, dob)
                for person_id, dob in sorted(player_dobs.items())
            ],
        )
        connection.commit()
    finally:
        connection.close()


def main() -> None:
    definitions, assignments, manifest = load_config(CONFIG_DIR)
    print("=== Normalized source package ===")
    check(len(definitions) == 48, "all 48 FM2005 PPM definitions are present")
    check(len(assignments) == 8034, "all 8,034 source assignments are present")
    check(
        len({row["source_person_id"] for row in assignments}) == 3841,
        "all 3,841 trait-bearing players have unique source identities",
    )
    check(
        manifest["identity_join"]["unmatched_players"] == 0
        and manifest["identity_join"]["ambiguous_players"] == 0,
        "the source-offset identity join has no unmatched or ambiguous players",
    )

    by_player: dict[str, list[dict[str, str]]] = defaultdict(list)
    for row in assignments:
        by_player[row["source_person_id"]].append(row)
        offset = int(row["source_record_offset"])
        check_boundary = (
            int(row["source_person_record_offset"])
            <= offset
            < int(row["source_person_record_end_offset"])
        )
        if not check_boundary:
            raise AssertionError(
                f"source offset escaped person record for {row['source_person_id']}"
            )
    check(True, "every PPM offset remains inside its mapped person record")

    for person_id, rows in by_player.items():
        mask = int(rows[0]["source_bitmask_hex"], 16)
        expected = sum(1 << int(row["source_bit_index"]) for row in rows)
        if mask != expected:
            raise AssertionError(f"bitmask mismatch for person {person_id}")
    check(True, "every player's source bitmask reproduces its normalized trait rows")
    check(
        [int(row["source_trait_id"]) for row in by_player["4357"]]
        == [9, 10, 15, 37, 46],
        "Roberto Carlos maps to the five independently verified PPMs",
    )

    player_dobs = {
        person_id: rows[0]["date_of_birth"]
        for person_id, rows in by_player.items()
    }
    temporary_root = ROOT / ".tmp-tests"
    temporary_root.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix="retroball-fm2005-traits-", dir=temporary_root
    ) as directory:
        database_path = Path(directory) / "fixture.sqlite"
        create_fixture_database(database_path, player_dobs)
        print("=== Transactional database import ===")
        first = import_database(database_path, definitions, assignments, manifest, True)
        check(first["assignments"] == 8034, "the complete assignment set imports")
        check(first["integrity"] == "ok", "the imported trait table passes integrity_check")
        second = import_database(database_path, definitions, assignments, manifest, True)
        check(second["assignments"] == 8034, "re-import is idempotent")

        connection = sqlite3.connect(database_path)
        try:
            counts = connection.execute(
                """
                SELECT count(*), count(DISTINCT source_person_id)
                FROM player_trait_source
                WHERE database_slug = ?
                """,
                (DATABASE_SLUG,),
            ).fetchone()
            check(counts == (8034, 3841), "database counts match the source manifest")
            connection.execute(
                """
                UPDATE player_profile SET date_of_birth = '1973-04-11'
                WHERE database_slug = ? AND source_person_id = '4357'
                """,
                (DATABASE_SLUG,),
            )
            connection.commit()
        finally:
            connection.close()
        try:
            import_database(database_path, definitions, assignments, manifest, False)
        except ValueError as error:
            check(
                "birth date mismatch" in str(error),
                "a mismatched player identity blocks the import",
            )
        else:
            raise AssertionError("mismatched player identity was accepted")

    print("\nALL PASS")


if __name__ == "__main__":
    main()
