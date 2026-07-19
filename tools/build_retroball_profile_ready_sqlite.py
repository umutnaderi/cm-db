#!/usr/bin/env python3
"""
Build Retroball SQLite from the profile-ready CSV ZIP packs.

Expected inputs:
  - retroball_audited_v2_profile_ready.zip
  - retroball_cm0203_0304_profile_ready_v2.zip

Usage from repo root:
  python tools/build_retroball_profile_ready_sqlite.py \
    --input-dir data/converted \
    --output db/retroball.sqlite
"""

from __future__ import annotations

import argparse
import csv
import os
import sqlite3
import sys
import time
import zipfile
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple

CSV_ENCODING = "utf-8-sig"
BATCH_SIZE = 5000

EXPECTED_FILES = {
    "cm_databases": "cm_databases.csv",
    "player_search": "player_search.csv",
    "player_profile": "player_profile_trimmed.csv",
    "person_history": "person_history.csv",
    "clubs": "clubs.csv",
    "nations": "nations.csv",
    "competitions": "competitions.csv",
}

PLAYER_CORE_COLUMNS = [
    "database_slug",
    "source_person_id",
    "display_name",
    "full_name",
    "first_name",
    "second_name",
    "common_name",
    "club_id",
    "club_name",
    "league_id",
    "league_name",
    "nation_id",
    "nation_name",
    "position_text",
    "date_of_birth",
    "season_age",
    "current_ability",
    "potential_ability",
    "home_reputation",
    "current_reputation",
    "world_reputation",
    "caps",
    "international_goals",
    "squad_number",
    "value",
    "wage",
    "player_id",
    "non_player_id",
    "is_player",
    "is_non_player",
    "search_blob",
]

PROFILE_COLUMNS = PLAYER_CORE_COLUMNS + [
    "attributes_json",
    "hidden_attributes_json",
    "position_ratings_json",
    "foot_json",
]

HISTORY_COLUMNS = [
    "database_slug",
    "source_person_id",
    "season_year",
    "club_id",
    "club_name",
    "league_name",
    "apps",
    "goals",
    "on_loan",
    "history_id",
]

CLUB_COLUMNS = [
    "database_slug",
    "source_club_id",
    "name",
    "short_name",
    "nation_name",
    "raw_json",
    "nation_id",
    "division_id",
    "last_division_id",
    "reserve_division_id",
    "cash",
    "stadium_id",
    "reputation",
    "fore_colour1",
    "back_colour1",
    "fore_colour2",
    "back_colour2",
    "fore_colour3",
    "back_colour3",
]

NATION_COLUMNS = [
    "database_slug",
    "source_nation_id",
    "name",
    "short_name",
    "nationality",
    "raw_json",
    "three_letter_name",
    "continent_id",
    "capital_city_id",
    "reputation",
]

COMPETITION_COLUMNS = [
    "source_comp_id",
    "name",
    "short_name",
    "three_letter_name",
    "scope",
    "selected",
    "continent_id",
    "nation_id",
    "foreground_colour",
    "background_colour",
    "reputation",
    "database_slug",
    "comp_type",
]

DATABASE_COLUMNS = ["slug", "title", "season_order", "status", "engine"]

INTEGER_COLUMNS = {
    "season_order",
    "season_age",
    "current_ability",
    "potential_ability",
    "home_reputation",
    "current_reputation",
    "world_reputation",
    "caps",
    "international_goals",
    "squad_number",
    "value",
    "wage",
    "player_id",
    "non_player_id",
    "is_player",
    "is_non_player",
    "source_club_id",
    "source_nation_id",
    "nation_id",
    "division_id",
    "last_division_id",
    "reserve_division_id",
    "cash",
    "stadium_id",
    "reputation",
    "season_year",
    "apps",
    "goals",
    "on_loan",
    "history_id",
    "source_comp_id",
    "selected",
    "continent_id",
    "capital_city_id",
    "foreground_colour",
    "background_colour",
}

TEXT_COLUMNS = {
    "database_slug",
    "source_person_id",
    "display_name",
    "full_name",
    "first_name",
    "second_name",
    "common_name",
    "club_id",
    "club_name",
    "league_id",
    "league_name",
    "nation_name",
    "position_text",
    "date_of_birth",
    "search_blob",
    "attributes_json",
    "hidden_attributes_json",
    "position_ratings_json",
    "foot_json",
    "slug",
    "title",
    "status",
    "engine",
    "name",
    "short_name",
    "nationality",
    "raw_json",
    "three_letter_name",
    "scope",
    "fore_colour1",
    "back_colour1",
    "fore_colour2",
    "back_colour2",
    "fore_colour3",
    "back_colour3",
    "comp_type",
}


def sql_type(column: str) -> str:
    if column in INTEGER_COLUMNS:
        return "INTEGER"
    return "TEXT"


def normalize_value(column: str, value: Optional[str]):
    if value is None:
        return None
    value = value.strip()
    if value == "":
        return None
    if column in INTEGER_COLUMNS:
        try:
            return int(value)
        except ValueError:
            return None
    return value


def find_csv_members(zip_path: Path) -> Dict[str, str]:
    """Return logical table name -> zip member path."""
    found: Dict[str, str] = {}
    with zipfile.ZipFile(zip_path) as zf:
        names = zf.namelist()
        for logical_name, filename in EXPECTED_FILES.items():
            candidates = [name for name in names if name.endswith("/" + filename) or name == filename]
            if candidates:
                # Prefer shortest member path, so root file wins over nested duplicates.
                found[logical_name] = sorted(candidates, key=len)[0]
    return found


def iter_csv_rows(zip_path: Path, member_name: str) -> Iterable[Dict[str, str]]:
    with zipfile.ZipFile(zip_path) as zf:
        with zf.open(member_name, "r") as raw:
            text = (line.decode(CSV_ENCODING, errors="replace") for line in raw)
            reader = csv.DictReader(text)
            for row in reader:
                yield row


def validate_header(zip_path: Path, member_name: str, expected_columns: Sequence[str]) -> None:
    with zipfile.ZipFile(zip_path) as zf:
        with zf.open(member_name, "r") as raw:
            first_line = raw.readline().decode(CSV_ENCODING, errors="replace")
    header = next(csv.reader([first_line]))
    missing = [column for column in expected_columns if column not in header]
    if missing:
        raise RuntimeError(
            f"{zip_path.name}:{member_name} is missing columns: {', '.join(missing)}"
        )


def create_schema(conn: sqlite3.Connection) -> None:
    cur = conn.cursor()
    cur.executescript(
        """
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA temp_store = MEMORY;
        PRAGMA foreign_keys = OFF;

        DROP TABLE IF EXISTS cm_databases;
        DROP TABLE IF EXISTS player_search;
        DROP TABLE IF EXISTS player_profile;
        DROP TABLE IF EXISTS person_history;
        DROP TABLE IF EXISTS clubs;
        DROP TABLE IF EXISTS nations;
        DROP TABLE IF EXISTS competitions;
        DROP TABLE IF EXISTS import_log;
        DROP TABLE IF EXISTS player_search_fts;
        DROP VIEW IF EXISTS player_profile_trimmed;
        """
    )

    def create_table(table: str, columns: Sequence[str], extra: str = "") -> None:
        col_defs = ",\n  ".join(f"{c} {sql_type(c)}" for c in columns)
        cur.execute(f"CREATE TABLE {table} (\n  {col_defs}{extra}\n)")

    create_table(
        "cm_databases",
        DATABASE_COLUMNS,
        ",\n  PRIMARY KEY (slug)",
    )
    create_table(
        "player_search",
        PLAYER_CORE_COLUMNS,
        ",\n  PRIMARY KEY (database_slug, source_person_id)",
    )
    create_table(
        "player_profile",
        PROFILE_COLUMNS,
        ",\n  PRIMARY KEY (database_slug, source_person_id)",
    )
    create_table(
        "person_history",
        HISTORY_COLUMNS,
        "",
    )
    create_table(
        "clubs",
        CLUB_COLUMNS,
        ",\n  PRIMARY KEY (database_slug, source_club_id)",
    )
    create_table(
        "nations",
        NATION_COLUMNS,
        ",\n  PRIMARY KEY (database_slug, source_nation_id)",
    )
    create_table(
        "competitions",
        COMPETITION_COLUMNS,
        ",\n  PRIMARY KEY (database_slug, comp_type, source_comp_id)",
    )

    cur.execute(
        """
        CREATE TABLE import_log (
          source_zip TEXT NOT NULL,
          source_member TEXT NOT NULL,
          target_table TEXT NOT NULL,
          row_count INTEGER NOT NULL,
          imported_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
        """
    )

    conn.commit()


def insert_rows(
    conn: sqlite3.Connection,
    table: str,
    columns: Sequence[str],
    zip_path: Path,
    member_name: str,
) -> int:
    validate_header(zip_path, member_name, columns)
    placeholders = ", ".join("?" for _ in columns)
    column_sql = ", ".join(columns)
    sql = f"INSERT OR REPLACE INTO {table} ({column_sql}) VALUES ({placeholders})"

    batch: List[Tuple] = []
    total = 0
    cur = conn.cursor()

    for row in iter_csv_rows(zip_path, member_name):
        values = tuple(normalize_value(column, row.get(column)) for column in columns)
        batch.append(values)
        if len(batch) >= BATCH_SIZE:
            cur.executemany(sql, batch)
            total += len(batch)
            batch.clear()
    if batch:
        cur.executemany(sql, batch)
        total += len(batch)
    cur.execute(
        "INSERT INTO import_log(source_zip, source_member, target_table, row_count) VALUES (?, ?, ?, ?)",
        (zip_path.name, member_name, table, total),
    )
    conn.commit()
    return total


def create_indexes(conn: sqlite3.Connection, build_fts: bool = True) -> None:
    cur = conn.cursor()
    cur.executescript(
        """
        CREATE INDEX IF NOT EXISTS idx_player_search_db_display
          ON player_search(database_slug, display_name);
        CREATE INDEX IF NOT EXISTS idx_player_search_db_full
          ON player_search(database_slug, full_name);
        CREATE INDEX IF NOT EXISTS idx_player_search_db_club
          ON player_search(database_slug, club_name);
        CREATE INDEX IF NOT EXISTS idx_player_search_db_nation
          ON player_search(database_slug, nation_name);
        CREATE INDEX IF NOT EXISTS idx_player_search_db_ca
          ON player_search(database_slug, current_ability DESC);

        CREATE INDEX IF NOT EXISTS idx_player_profile_lookup
          ON player_profile(database_slug, source_person_id);

        CREATE INDEX IF NOT EXISTS idx_person_history_lookup
          ON person_history(database_slug, source_person_id);
        CREATE INDEX IF NOT EXISTS idx_person_history_order
          ON person_history(database_slug, source_person_id, season_year);

        CREATE INDEX IF NOT EXISTS idx_clubs_lookup
          ON clubs(database_slug, source_club_id);
        CREATE INDEX IF NOT EXISTS idx_nations_lookup
          ON nations(database_slug, source_nation_id);

        CREATE VIEW IF NOT EXISTS player_profile_trimmed AS
          SELECT * FROM player_profile;
        """
    )

    if build_fts:
        try:
            cur.executescript(
                """
                CREATE VIRTUAL TABLE IF NOT EXISTS player_search_fts USING fts5(
                  database_slug UNINDEXED,
                  source_person_id UNINDEXED,
                  display_name,
                  full_name,
                  search_blob
                );
                DELETE FROM player_search_fts;
                INSERT INTO player_search_fts(database_slug, source_person_id, display_name, full_name, search_blob)
                SELECT database_slug, source_person_id, display_name, full_name, search_blob
                FROM player_search;
                """
            )
        except sqlite3.OperationalError as exc:
            print(f"[warn] Could not create FTS table: {exc}", file=sys.stderr)

    conn.commit()


def sanity_checks(conn: sqlite3.Connection) -> None:
    checks = [
        ("player_search", "SELECT COUNT(*) FROM player_search"),
        ("player_profile", "SELECT COUNT(*) FROM player_profile"),
        ("person_history", "SELECT COUNT(*) FROM person_history"),
        ("clubs", "SELECT COUNT(*) FROM clubs"),
        ("nations", "SELECT COUNT(*) FROM nations"),
        ("cm_databases", "SELECT COUNT(*) FROM cm_databases"),
    ]
    cur = conn.cursor()
    print("\nCounts:")
    for label, sql in checks:
        print(f"  {label:16s} {cur.execute(sql).fetchone()[0]:>10}")

    print("\nHard sanity lookups:")
    lookups = [
        ("cm0001_vanilla_original", "Zinedine Zidane"),
        ("cm0102_vanilla_original", "Zinedine Zidane"),
        ("cm0203_vanilla_original", "Zinedine Zidane"),
        ("cm0304_vanilla_original", "Cristiano Ronaldo"),
    ]
    for db, name in lookups:
        rows = cur.execute(
            """
            SELECT display_name, club_name, nation_name, current_ability, potential_ability
            FROM player_search
            WHERE database_slug = ? AND search_blob LIKE ?
            ORDER BY current_ability DESC NULLS LAST
            LIMIT 3
            """,
            (db, f"%{name}%"),
        ).fetchall()
        if rows:
            best = rows[0]
            print(f"  {db:24s} {name:20s} -> {best}")
        else:
            print(f"  {db:24s} {name:20s} -> MISSING")


def import_all(input_dir: Path, output: Path, no_fts: bool = False) -> None:
    zip_paths = sorted(input_dir.glob("*.zip"))
    if not zip_paths:
        raise RuntimeError(f"No zip files found in {input_dir}")

    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        output.unlink()

    conn = sqlite3.connect(str(output))
    try:
        create_schema(conn)
        table_specs = [
            ("cm_databases", DATABASE_COLUMNS),
            ("player_search", PLAYER_CORE_COLUMNS),
            ("player_profile", PROFILE_COLUMNS),
            ("person_history", HISTORY_COLUMNS),
            ("clubs", CLUB_COLUMNS),
            ("nations", NATION_COLUMNS),
            ("competitions", COMPETITION_COLUMNS),
        ]

        for zip_path in zip_paths:
            members = find_csv_members(zip_path)
            if not members:
                print(f"[skip] {zip_path.name}: no recognized CSV files")
                continue
            print(f"\nImporting {zip_path.name}")
            for table, columns in table_specs:
                member = members.get(table)
                if not member:
                    continue
                started = time.time()
                rows = insert_rows(conn, table, columns, zip_path, member)
                print(f"  {table:16s} {rows:10d} rows  ({time.time() - started:.1f}s)")

        print("\nCreating indexes...")
        create_indexes(conn, build_fts=not no_fts)
        sanity_checks(conn)
        conn.execute("PRAGMA optimize")
        conn.commit()
    finally:
        conn.close()

    print(f"\nBuilt SQLite: {output}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input-dir", default="data/converted", help="Folder containing profile-ready ZIP packs")
    parser.add_argument("--output", default="db/retroball.sqlite", help="Output SQLite path")
    parser.add_argument("--no-fts", action="store_true", help="Skip building player_search_fts")
    args = parser.parse_args()

    import_all(Path(args.input_dir), Path(args.output), no_fts=args.no_fts)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
