#!/usr/bin/env python3
"""Synchronize source nation snapshots into the persistent identity registry."""

from __future__ import annotations

import argparse
from pathlib import Path

from common import (
    REGISTRY_DB,
    SOURCE_DB,
    choose_column,
    normalize_name,
    registry_connection,
    sha256_text,
    source_connection,
    stable_json,
    table_columns,
)
from create_registry import create_registry
from common import SCHEMA_PATH


DATABASE_COLUMNS = ("database_slug", "db_slug", "database")
ID_COLUMNS = ("source_nation_id", "nation_id", "source_id", "id")
NAME_COLUMNS = ("name", "nation_name", "display_name", "short_name")


def read_source_nations(source_path: Path) -> tuple[list[str], list[dict[str, object]]]:
    connection = source_connection(source_path)
    try:
        columns = table_columns(connection, "nations")
        database_column = choose_column(columns, DATABASE_COLUMNS, "database slug")
        id_column = choose_column(columns, ID_COLUMNS, "source nation ID")
        name_column = choose_column(columns, NAME_COLUMNS, "nation name")
        quoted = ", ".join(f'"{column}"' for column in columns)
        order = f'"{database_column}", "{id_column}"'
        rows = [dict(row) for row in connection.execute(f'SELECT {quoted} FROM nations ORDER BY {order}')]
        for row in rows:
            row["_database_slug"] = str(row[database_column])
            row["_source_nation_id"] = str(row[id_column])
            row["_source_name"] = row[name_column]
        return columns, rows
    finally:
        connection.close()


def synchronize(source_path: Path, registry_path: Path) -> dict[str, int]:
    columns, rows = read_source_nations(source_path)
    connection = registry_connection(registry_path)
    inserted = changed = unchanged = 0
    try:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("UPDATE source_nations SET active = 0 WHERE active = 1")
        for row in rows:
            payload = stable_json({column: row[column] for column in columns})
            row_hash = sha256_text(payload)
            key = (row["_database_slug"], row["_source_nation_id"])
            existing = connection.execute(
                "SELECT source_row_hash FROM source_nations WHERE database_slug = ? AND source_nation_id = ?",
                key,
            ).fetchone()
            if existing is None:
                inserted += 1
            elif existing["source_row_hash"] == row_hash:
                unchanged += 1
            else:
                changed += 1
            connection.execute(
                """
                INSERT INTO source_nations(
                    database_slug, source_nation_id, source_name, normalized_name,
                    source_payload_json, source_row_hash, active
                ) VALUES (?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(database_slug, source_nation_id) DO UPDATE SET
                    source_name = excluded.source_name,
                    normalized_name = excluded.normalized_name,
                    source_payload_json = excluded.source_payload_json,
                    source_row_hash = excluded.source_row_hash,
                    active = 1,
                    last_changed_at = CASE
                        WHEN source_nations.source_row_hash <> excluded.source_row_hash THEN CURRENT_TIMESTAMP
                        ELSE source_nations.last_changed_at
                    END
                """,
                (*key, row["_source_name"], normalize_name(row["_source_name"]), payload, row_hash),
            )
        connection.commit()
        inactive = int(connection.execute("SELECT COUNT(*) FROM source_nations WHERE active = 0").fetchone()[0])
        return {"source": len(rows), "inserted": inserted, "changed": changed, "unchanged": unchanged, "inactive": inactive}
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE_DB)
    parser.add_argument("--registry", type=Path, default=REGISTRY_DB)
    arguments = parser.parse_args()
    create_registry(arguments.registry, SCHEMA_PATH)
    stats = synchronize(arguments.source, arguments.registry)
    print("source nation rows: {source}; inserted: {inserted}; changed: {changed}; unchanged: {unchanged}; inactive: {inactive}".format(**stats))


if __name__ == "__main__":
    main()
