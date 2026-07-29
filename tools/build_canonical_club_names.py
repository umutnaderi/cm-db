#!/usr/bin/env python3
"""Build the D1 lookup used to display canonical club names."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path


def readonly_uri(path: Path) -> str:
    return f"{path.resolve().as_uri()}?mode=ro&immutable=1"


def sql_text(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def build(identity_path: Path, output_path: Path) -> dict[str, object]:
    started = time.monotonic()
    connection = sqlite3.connect(readonly_uri(identity_path), uri=True)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA query_only = ON")
        rows = list(
            connection.execute(
                """
                SELECT
                  s.database_slug,
                  s.club_name AS source_club_name,
                  c.id AS canonical_club_id,
                  c.public_id AS canonical_club_public_id,
                  c.preferred_name AS canonical_club_name
                FROM source_players s
                JOIN canonical_clubs c ON c.id = s.canonical_club_id
                WHERE s.active = 1
                  AND s.club_name IS NOT NULL
                  AND s.club_name <> ''
                GROUP BY s.database_slug, s.club_name
                HAVING count(DISTINCT s.canonical_club_id) = 1
                ORDER BY s.database_slug, s.club_name
                """
            )
        )
    finally:
        connection.close()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="\n") as output:
        output.write("-- Canonical club display names; raw source names remain unchanged\n")
        output.write("DROP TABLE IF EXISTS canonical_club_names;\n")
        output.write(
            """
CREATE TABLE canonical_club_names (
  database_slug TEXT NOT NULL,
  source_club_name TEXT NOT NULL,
  canonical_club_id TEXT NOT NULL,
  canonical_club_public_id TEXT NOT NULL,
  canonical_club_name TEXT NOT NULL,
  PRIMARY KEY (database_slug, source_club_name)
) WITHOUT ROWID;
""".lstrip()
        )
        for row in rows:
            values = (
                str(row["database_slug"]),
                str(row["source_club_name"]),
                str(row["canonical_club_id"]),
                str(row["canonical_club_public_id"]),
                str(row["canonical_club_name"]),
            )
            output.write(
                "INSERT INTO canonical_club_names VALUES("
                + ",".join(sql_text(value) for value in values)
                + ");\n"
            )

    size = output_path.stat().st_size
    return {
        "identity_database": str(identity_path.resolve()),
        "output": str(output_path.resolve()),
        "lookup_rows": len(rows),
        "size_bytes": size,
        "size_mib": round(size / 1024 / 1024, 1),
        "elapsed_seconds": round(time.monotonic() - started, 1),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--identity",
        type=Path,
        default=Path("identity/retroball_identity.sqlite"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/d1/canonical-club-names.sql"),
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("data/d1/canonical-club-names-manifest.json"),
    )
    args = parser.parse_args()

    if not args.identity.is_file():
        print(f"Identity database not found: {args.identity.resolve()}", file=sys.stderr)
        return 2
    if args.output.exists():
        print(
            f"Output already exists: {args.output.resolve()}. Remove or rename it first.",
            file=sys.stderr,
        )
        return 2

    try:
        manifest = build(args.identity.resolve(), args.output.resolve())
    except Exception as error:
        if args.output.exists():
            args.output.unlink()
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
