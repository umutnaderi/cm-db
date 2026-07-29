#!/usr/bin/env python3
"""Build targeted D1 upserts for reviewed canonical player-name overrides."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path

from player_canonical_name_overrides import (
    DEFAULT_OVERRIDES,
    load_player_name_overrides,
)


def readonly_uri(path: Path) -> str:
    return f"{path.resolve().as_uri()}?mode=ro&immutable=1"


def sql_text(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def build(
    identity_path: Path,
    overrides_path: Path,
    output_path: Path,
    rows_per_statement: int,
) -> dict[str, object]:
    if output_path.exists():
        raise FileExistsError(f"Output already exists: {output_path}")
    started = time.monotonic()
    overrides = load_player_name_overrides(overrides_path)
    connection = sqlite3.connect(readonly_uri(identity_path), uri=True)
    connection.row_factory = sqlite3.Row
    try:
        rows = []
        for (database_slug, source_person_id), canonical_name in sorted(overrides.items()):
            identity = connection.execute(
                """
                SELECT
                  cast(c.id AS TEXT) AS canonical_player_id,
                  c.public_id AS canonical_player_public_id
                FROM player_identity_links links
                JOIN canonical_players c ON c.id = links.canonical_player_id
                WHERE links.database_slug = ?
                  AND links.source_person_id = ?
                """,
                (database_slug, source_person_id),
            ).fetchone()
            if identity is None:
                raise RuntimeError(
                    f"Canonical player identity not found: {database_slug}:{source_person_id}"
                )
            rows.append(
                (
                    database_slug,
                    source_person_id,
                    str(identity["canonical_player_id"]),
                    str(identity["canonical_player_public_id"]),
                    canonical_name,
                )
            )
    finally:
        connection.close()

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="\n") as output:
        output.write(
            "-- Reviewed canonical player names; raw source names remain unchanged.\n"
        )
        for start in range(0, len(rows), rows_per_statement):
            batch = rows[start : start + rows_per_statement]
            output.write(
                "INSERT INTO canonical_player_names"
                "(database_slug,source_person_id,canonical_player_id,"
                "canonical_player_public_id,canonical_player_name) VALUES\n"
                + ",\n".join(
                    "(" + ",".join(sql_text(value) for value in values) + ")"
                    for values in batch
                )
                + "\nON CONFLICT(database_slug,source_person_id) DO UPDATE SET "
                "canonical_player_id=excluded.canonical_player_id,"
                "canonical_player_public_id=excluded.canonical_player_public_id,"
                "canonical_player_name=excluded.canonical_player_name;\n"
            )
    return {
        "identity_database": str(identity_path.resolve()),
        "overrides": str(overrides_path.resolve()),
        "output": str(output_path.resolve()),
        "rows": len(rows),
        "statements": (len(rows) + rows_per_statement - 1) // rows_per_statement,
        "size_bytes": output_path.stat().st_size,
        "size_mib": round(output_path.stat().st_size / 1024 / 1024, 2),
        "elapsed_seconds": round(time.monotonic() - started, 1),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--identity",
        type=Path,
        default=Path("identity/retroball_identity.sqlite"),
    )
    parser.add_argument("--rows-per-statement", type=int, default=200)
    parser.add_argument(
        "--overrides",
        type=Path,
        default=DEFAULT_OVERRIDES,
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/d1/canonical-player-name-updates.sql"),
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("data/d1/canonical-player-name-updates-manifest.json"),
    )
    args = parser.parse_args()

    if (
        not args.identity.is_file()
        or not args.overrides.is_file()
        or args.rows_per_statement < 1
    ):
        print("Identity database or override CSV is missing", file=sys.stderr)
        return 2
    try:
        manifest = build(
            args.identity.resolve(),
            args.overrides.resolve(),
            args.output.resolve(),
            args.rows_per_statement,
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
