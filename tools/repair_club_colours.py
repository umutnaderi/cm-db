#!/usr/bin/env python3
"""Repair club colour columns from an original Retroball club export archive."""

from __future__ import annotations

import argparse
import csv
import sqlite3
import zipfile
from pathlib import Path


SOURCE_COLUMNS = {
    "fore_colour1": "fore_colour_1_id",
    "back_colour1": "back_colour_1_id",
    "fore_colour2": "fore_colour_2_id",
    "back_colour2": "back_colour_2_id",
    "fore_colour3": "fore_colour_3_id",
    "back_colour3": "back_colour_3_id",
}


def find_clubs_member(archive: zipfile.ZipFile) -> str:
    candidates = [
        name
        for name in archive.namelist()
        if name == "clubs.csv" or name.endswith("/clubs.csv")
    ]
    if not candidates:
        raise RuntimeError("Archive does not contain clubs.csv")
    return min(candidates, key=len)


def repair(database: Path, source_archive: Path) -> dict[str, object]:
    with zipfile.ZipFile(source_archive) as archive:
        member = find_clubs_member(archive)
        with archive.open(member) as raw:
            rows = list(
                csv.DictReader(
                    (line.decode("utf-8-sig", errors="replace") for line in raw)
                )
            )

    if not rows:
        raise RuntimeError(f"{source_archive} contains no club rows")

    required = {"database_slug", "id", *SOURCE_COLUMNS.values()}
    missing = required.difference(rows[0])
    if missing:
        raise RuntimeError(
            f"{source_archive}:{member} is missing columns: {', '.join(sorted(missing))}"
        )

    database_slugs = {row["database_slug"].strip() for row in rows}
    if len(database_slugs) != 1:
        raise RuntimeError(
            f"Expected one database_slug in {source_archive}, found {sorted(database_slugs)}"
        )
    database_slug = next(iter(database_slugs))

    values = [
        (
            *(int(row[source]) for source in SOURCE_COLUMNS.values()),
            database_slug,
            row["id"].strip(),
        )
        for row in rows
    ]

    connection = sqlite3.connect(database)
    try:
        before = connection.total_changes
        connection.executemany(
            """
            UPDATE clubs
               SET fore_colour1 = ?,
                   back_colour1 = ?,
                   fore_colour2 = ?,
                   back_colour2 = ?,
                   fore_colour3 = ?,
                   back_colour3 = ?
             WHERE database_slug = ?
               AND source_club_id = ?
            """,
            values,
        )
        updated = connection.total_changes - before
        if updated != len(values):
            connection.rollback()
            raise RuntimeError(
                f"Matched {updated:,} of {len(values):,} source clubs in {database}"
            )
        connection.commit()
    finally:
        connection.close()

    return {
        "database": str(database.resolve()),
        "source_archive": str(source_archive.resolve()),
        "source_member": member,
        "database_slug": database_slug,
        "updated_clubs": updated,
    }


def sql_text(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def write_repair_sql(source_archive: Path, output: Path) -> int:
    with zipfile.ZipFile(source_archive) as archive:
        member = find_clubs_member(archive)
        with archive.open(member) as raw:
            rows = list(
                csv.DictReader(
                    (line.decode("utf-8-sig", errors="replace") for line in raw)
                )
            )

    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", encoding="utf-8", newline="\n") as sql:
        sql.write("-- Repair club colours from the original CM export\n")
        for row in rows:
            assignments = ",".join(
                f"{target}={int(row[source])}"
                for target, source in SOURCE_COLUMNS.items()
            )
            sql.write(
                f"UPDATE clubs SET {assignments}"
                f" WHERE database_slug={sql_text(row['database_slug'].strip())}"
                f" AND source_club_id={sql_text(row['id'].strip())};\n"
            )
    return len(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument(
        "--source",
        type=Path,
        default=Path("data/old/cm0102_vanilla_app_core_v2.zip"),
    )
    parser.add_argument(
        "--sql-output",
        type=Path,
        help="Also write equivalent SQL for repairing a remote D1 database.",
    )
    args = parser.parse_args()

    if not args.database.is_file():
        parser.error(f"Database not found: {args.database.resolve()}")
    if not args.source.is_file():
        parser.error(f"Source archive not found: {args.source.resolve()}")

    result = repair(args.database.resolve(), args.source.resolve())
    if args.sql_output:
        result["sql_output"] = str(args.sql_output.resolve())
        result["sql_rows"] = write_repair_sql(
            args.source.resolve(),
            args.sql_output.resolve(),
        )
    for key, value in result.items():
        print(f"{key}: {value}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
