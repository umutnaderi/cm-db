#!/usr/bin/env python3
"""Synchronize competition snapshots from the generated DB into the identity registry."""

from __future__ import annotations

import argparse
import re
from pathlib import Path

from common import (
    REGISTRY_DB, SCHEMA_PATH, SOURCE_DB, choose_column, normalize_name,
    registry_connection, sha256_text, source_connection, stable_json, table_columns,
)
from create_registry import create_registry


def infer_level(name: object, short_name: object) -> str:
    value = normalize_name(f"{name or ''} {short_name or ''}")
    patterns = (
        (r"\b(premier|premiership|super league|first|1st|1 division|division 1)\b", "1"),
        (r"\b(second|2nd|2 division|division 2)\b", "2"),
        (r"\b(third|3rd|3 division|division 3)\b", "3"),
        (r"\b(fourth|4th|4 division|division 4)\b", "4"),
        (r"\b(fifth|5th|5 division|division 5)\b", "5"),
        (r"\blower division\b", "lower"),
        (r"\b(cup|trophy|shield)\b", "cup"),
    )
    for pattern, level in patterns:
        if re.search(pattern, value):
            return level
    return "unknown"


def read_rows(source_path: Path) -> tuple[list[str], list[dict[str, object]]]:
    connection = source_connection(source_path)
    try:
        columns = table_columns(connection, "competitions")
        db_column = choose_column(columns, ("database_slug", "db_slug", "database"), "database slug")
        id_column = choose_column(columns, ("source_comp_id", "competition_id", "source_id", "id"), "competition ID")
        name_column = choose_column(columns, ("name", "competition_name", "display_name"), "competition name")
        type_column = choose_column(columns, ("comp_type", "competition_type", "type"), "competition type")
        quoted = ", ".join(f'"{column}"' for column in columns)
        rows = [dict(row) for row in connection.execute(
            f'SELECT {quoted} FROM competitions ORDER BY "{db_column}", "{type_column}", "{id_column}"'
        )]
        for row in rows:
            row["_db"] = str(row[db_column]); row["_id"] = str(row[id_column])
            row["_name"] = row[name_column]; row["_type"] = str(row[type_column] or "unknown")
        return columns, rows
    finally:
        connection.close()


def synchronize(source_path: Path, registry_path: Path) -> dict[str, int]:
    columns, rows = read_rows(source_path)
    connection = registry_connection(registry_path)
    inserted = changed = unchanged = 0
    try:
        connection.execute("BEGIN IMMEDIATE")
        connection.execute("UPDATE source_competitions SET active = 0 WHERE active = 1")
        for row in rows:
            payload = stable_json({column: row[column] for column in columns})
            row_hash = sha256_text(payload)
            key = (row["_db"], row["_id"], row["_type"])
            old = connection.execute(
                "SELECT source_row_hash FROM source_competitions WHERE database_slug=? AND source_comp_id=? AND competition_type=?",
                key,
            ).fetchone()
            if old is None: inserted += 1
            elif old["source_row_hash"] == row_hash: unchanged += 1
            else: changed += 1
            short_name = row.get("short_name")
            connection.execute(
                """
                INSERT INTO source_competitions(
                    database_slug, source_comp_id, competition_type, source_name,
                    normalized_name, source_nation_id, continent_id, scope, short_name,
                    three_letter_name, inferred_level_key, source_payload_json,
                    source_row_hash, active
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT(database_slug, source_comp_id, competition_type) DO UPDATE SET
                    source_name=excluded.source_name, normalized_name=excluded.normalized_name,
                    source_nation_id=excluded.source_nation_id, continent_id=excluded.continent_id,
                    scope=excluded.scope, short_name=excluded.short_name,
                    three_letter_name=excluded.three_letter_name,
                    inferred_level_key=excluded.inferred_level_key,
                    source_payload_json=excluded.source_payload_json,
                    source_row_hash=excluded.source_row_hash, active=1,
                    last_changed_at=CASE WHEN source_competitions.source_row_hash<>excluded.source_row_hash
                        THEN CURRENT_TIMESTAMP ELSE source_competitions.last_changed_at END
                """,
                (*key, row["_name"], normalize_name(row["_name"]),
                 None if row.get("nation_id") is None else str(row.get("nation_id")),
                 None if row.get("continent_id") is None else str(row.get("continent_id")),
                 None if row.get("scope") is None else str(row.get("scope")),
                 short_name, row.get("three_letter_name"), infer_level(row["_name"], short_name),
                 payload, row_hash),
            )
        connection.commit()
        inactive = connection.execute("SELECT COUNT(*) FROM source_competitions WHERE active=0").fetchone()[0]
        return {"source": len(rows), "inserted": inserted, "changed": changed, "unchanged": unchanged, "inactive": inactive}
    except Exception:
        connection.rollback(); raise
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=SOURCE_DB)
    parser.add_argument("--registry", type=Path, default=REGISTRY_DB)
    args = parser.parse_args()
    create_registry(args.registry, SCHEMA_PATH)
    stats = synchronize(args.source, args.registry)
    print("source competition rows: {source}; inserted: {inserted}; changed: {changed}; unchanged: {unchanged}; inactive: {inactive}".format(**stats))


if __name__ == "__main__": main()
