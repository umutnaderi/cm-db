#!/usr/bin/env python3
"""Build a compact, D1-ready SQLite database for the public Retroball API."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path


SERVING_TABLES = (
    "cm_databases",
    "player_search",
    "player_profile",
    "clubs",
    "nations",
    "person_history",
)


def source_uri(path: Path) -> str:
    return f"{path.resolve().as_uri()}?mode=ro&immutable=1"


def scalar(connection: sqlite3.Connection, sql: str, args: tuple[object, ...] = ()) -> object:
    row = connection.execute(sql, args).fetchone()
    return row[0] if row else None


def table_sql(source: sqlite3.Connection, table: str) -> str:
    row = source.execute(
        "SELECT sql FROM sqlite_schema WHERE type = 'table' AND name = ?",
        (table,),
    ).fetchone()
    if not row or not row[0]:
        raise RuntimeError(f"Required source table is missing: {table}")
    return str(row[0])


def index_sql(source: sqlite3.Connection, table: str) -> list[str]:
    return [
        str(row[0])
        for row in source.execute(
            """
            SELECT sql
            FROM sqlite_schema
            WHERE type = 'index'
              AND tbl_name = ?
              AND sql IS NOT NULL
            ORDER BY name
            """,
            (table,),
        )
        if row[0]
    ]


def build_database(
    source_path: Path,
    output_path: Path,
    sample_per_database: int = 0,
) -> dict[str, object]:
    if output_path.exists():
        raise FileExistsError(
            f"Output already exists: {output_path}. Remove or rename it before rebuilding."
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    source = sqlite3.connect(source_uri(source_path), uri=True)
    destination = sqlite3.connect(output_path, uri=True)

    try:
        source.execute("PRAGMA query_only = ON")
        if sample_per_database:
            print(
                "Smoke build: skipping the full source quick_check "
                "(run separately before the production build).",
                flush=True,
            )
        else:
            print("Checking source database integrity...", flush=True)
            if scalar(source, "PRAGMA quick_check") != "ok":
                raise RuntimeError("Source database failed PRAGMA quick_check")

        destination.executescript(
            """
            PRAGMA journal_mode = OFF;
            PRAGMA synchronous = OFF;
            PRAGMA temp_store = MEMORY;
            PRAGMA foreign_keys = OFF;
            """
        )
        destination.execute("ATTACH DATABASE ? AS source", (source_uri(source_path),))
        if sample_per_database:
            destination.execute(
                """
                CREATE TEMP TABLE selected_players (
                  database_slug TEXT NOT NULL,
                  source_person_id INTEGER NOT NULL,
                  PRIMARY KEY (database_slug, source_person_id)
                ) WITHOUT ROWID
                """,
            )
            database_slugs = [
                str(row[0])
                for row in destination.execute(
                    "SELECT slug FROM source.cm_databases ORDER BY season_order"
                )
            ]
            for database_slug in database_slugs:
                print(f"Selecting smoke players for {database_slug}...", flush=True)
                destination.execute(
                    """
                    INSERT OR IGNORE INTO selected_players
                    SELECT database_slug, source_person_id
                    FROM source.player_search
                    WHERE database_slug = ?
                    ORDER BY coalesce(current_ability, 0) DESC, source_person_id
                    LIMIT ?
                    """,
                    (database_slug, sample_per_database),
                )
            print("Adding named smoke-test players...", flush=True)
            destination.execute(
                """
                INSERT OR IGNORE INTO selected_players
                SELECT database_slug, source_person_id
                FROM source.player_search
                WHERE lower(coalesce(display_name, '')) LIKE '%ronaldo%'
                   OR lower(coalesce(full_name, '')) LIKE '%ronaldo%'
                   OR lower(coalesce(common_name, '')) LIKE '%ronaldo%'
                """
            )

        sample_selects = {
            "cm_databases": 'SELECT * FROM source."cm_databases"',
            "player_search": """
                SELECT p.*
                FROM source.player_search p
                JOIN selected_players s
                  ON s.database_slug = p.database_slug
                 AND s.source_person_id = p.source_person_id
            """,
            "player_profile": """
                SELECT p.*
                FROM source.player_profile p
                JOIN selected_players s
                  ON s.database_slug = p.database_slug
                 AND s.source_person_id = p.source_person_id
            """,
            "clubs": """
                SELECT DISTINCT c.*
                FROM source.clubs c
                WHERE EXISTS (
                  SELECT 1
                  FROM source.player_search p
                  JOIN selected_players s
                    ON s.database_slug = p.database_slug
                   AND s.source_person_id = p.source_person_id
                  WHERE p.database_slug = c.database_slug
                    AND (
                      cast(c.source_club_id AS TEXT) = p.club_id
                      OR (p.club_name <> '' AND c.name = p.club_name)
                    )
                )
            """,
            "nations": """
                SELECT DISTINCT n.*
                FROM source.nations n
                WHERE EXISTS (
                  SELECT 1
                  FROM source.player_search p
                  JOIN selected_players s
                    ON s.database_slug = p.database_slug
                   AND s.source_person_id = p.source_person_id
                  WHERE p.database_slug = n.database_slug
                    AND (
                      n.name = p.nation_name
                      OR n.source_nation_id = p.nation_id
                    )
                )
            """,
            "person_history": """
                SELECT h.*
                FROM source.person_history h
                JOIN selected_players s
                  ON s.database_slug = h.database_slug
                 AND s.source_person_id = h.source_person_id
            """,
        }

        counts: dict[str, int] = {}
        for table in SERVING_TABLES:
            print(f"Copying {table}...", flush=True)
            destination.execute(table_sql(source, table))
            select_sql = (
                sample_selects[table]
                if sample_per_database
                else f'SELECT * FROM source."{table}"'
            )
            destination.execute(f'INSERT INTO "{table}" {select_sql}')
            count = int(scalar(destination, f'SELECT count(*) FROM "{table}"') or 0)
            if not sample_per_database:
                source_count = int(scalar(source, f'SELECT count(*) FROM "{table}"') or 0)
                if count != source_count:
                    raise RuntimeError(
                        f"Row-count mismatch for {table}: source={source_count}, output={count}"
                    )
            counts[table] = count
            destination.commit()

        print("Creating indexes...", flush=True)
        for table in SERVING_TABLES:
            for statement in index_sql(source, table):
                destination.execute(statement)
        destination.commit()

        destination.execute(
            """
            CREATE VIEW player_profiles AS
            SELECT
              database_slug,
              source_person_id,
              display_name,
              full_name,
              common_name,
              club_id,
              club_name,
              nation_name,
              date_of_birth,
              season_age AS age,
              position_text,
              current_ability,
              potential_ability,
              home_reputation,
              current_reputation,
              world_reputation,
              caps,
              international_goals,
              squad_number,
              value,
              wage,
              player_id AS source_player_id,
              position_ratings_json AS positions_json,
              attributes_json,
              hidden_attributes_json,
              foot_json,
              '{}' AS ratings_json,
              '{}' AS profile_json
            FROM player_profile
            """
        )
        destination.commit()
        destination.execute("DETACH DATABASE source")

        if scalar(destination, "PRAGMA integrity_check") != "ok":
            raise RuntimeError("Output database failed PRAGMA integrity_check")

        size_bytes = output_path.stat().st_size
        return {
            "source": str(source_path.resolve()),
            "output": str(output_path.resolve()),
            "size_bytes": size_bytes,
            "size_mib": round(size_bytes / 1024 / 1024, 1),
            "elapsed_seconds": round(time.monotonic() - started, 1),
            "sample_per_database": sample_per_database,
            "tables": counts,
        }
    except Exception:
        destination.close()
        source.close()
        if output_path.exists():
            output_path.unlink()
        raise
    finally:
        try:
            destination.close()
        except Exception:
            pass
        try:
            source.close()
        except Exception:
            pass


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("db/retroball.sqlite"),
        help="Source Retroball SQLite database",
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/d1/retroball-d1.sqlite"),
        help="D1-ready output SQLite database",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("data/d1/manifest.json"),
        help="Build manifest output",
    )
    parser.add_argument(
        "--sample-per-database",
        type=int,
        default=0,
        help="Build a smoke-test database with this many top players per season",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    source_path = args.source.resolve()
    output_path = args.output.resolve()

    if not source_path.is_file():
        print(f"Source database not found: {source_path}", file=sys.stderr)
        return 2
    if args.sample_per_database < 0:
        print("--sample-per-database cannot be negative", file=sys.stderr)
        return 2

    try:
        manifest = build_database(
            source_path,
            output_path,
            args.sample_per_database,
        )
    except Exception as error:
        print(f"Build failed: {error}", file=sys.stderr)
        return 1

    args.manifest.parent.mkdir(parents=True, exist_ok=True)
    args.manifest.write_text(
        json.dumps(manifest, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(manifest, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
