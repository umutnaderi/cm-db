#!/usr/bin/env python3
"""Build the D1 lookup used for canonical player names and season links."""

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
    output_dir: Path,
    prefix: str,
    chunk_bytes: int,
) -> dict[str, object]:
    started = time.monotonic()
    name_overrides = load_player_name_overrides(overrides_path)
    connection = sqlite3.connect(readonly_uri(identity_path), uri=True)
    connection.row_factory = sqlite3.Row
    try:
        connection.execute("PRAGMA query_only = ON")
        rows = connection.execute(
            """
            SELECT
              l.database_slug,
              l.source_person_id,
              c.id AS canonical_player_id,
              c.public_id AS canonical_player_public_id,
              c.preferred_name AS canonical_player_name
            FROM player_identity_links l
            JOIN canonical_players c ON c.id = l.canonical_player_id
            JOIN source_players s
              ON s.database_slug = l.database_slug
             AND s.source_person_id = l.source_person_id
            WHERE s.active = 1
            ORDER BY l.database_slug, l.source_person_id
            """
        )

        existing = sorted(output_dir.glob(f"{prefix}-*.sql")) if output_dir.exists() else []
        if existing:
            raise FileExistsError(f"Chunk output already exists: {existing[0]}")
        output_dir.mkdir(parents=True, exist_ok=True)
        count = 0
        chunks: list[dict[str, object]] = []
        chunk_number = 1

        def write_chunk(text: str, statements: int) -> None:
            nonlocal chunk_number
            path = output_dir / f"{prefix}-{chunk_number:04d}.sql"
            path.write_text(text, encoding="utf-8", newline="\n")
            chunks.append({
                "path": str(path.resolve()),
                "size_bytes": path.stat().st_size,
                "size_mib": round(path.stat().st_size / 1024 / 1024, 1),
                "statements": statements,
            })
            chunk_number += 1

        write_chunk(
            (
                "-- Canonical player display names and exact season links; "
                "raw source names remain unchanged\n"
                "DROP TABLE IF EXISTS canonical_player_names;\n"
                """
CREATE TABLE canonical_player_names (
  database_slug TEXT NOT NULL,
  source_person_id TEXT NOT NULL,
  canonical_player_id TEXT NOT NULL,
  canonical_player_public_id TEXT NOT NULL,
  canonical_player_name TEXT NOT NULL,
  PRIMARY KEY (database_slug, source_person_id)
) WITHOUT ROWID;
""".lstrip()
            ),
            2,
        )
        output = None
        path = None
        chunk_size = 0
        chunk_statements = 0

        def close_data_chunk() -> None:
            nonlocal output, path, chunk_statements
            if output is None or path is None:return
            output.close()
            chunks.append({
                "path": str(path.resolve()),
                "size_bytes": path.stat().st_size,
                "size_mib": round(path.stat().st_size / 1024 / 1024, 1),
                "statements": chunk_statements,
            })
            output=None;path=None;chunk_statements=0

        def open_data_chunk() -> None:
            nonlocal output, path, chunk_size, chunk_number
            path=output_dir/f"{prefix}-{chunk_number:04d}.sql"
            output=path.open("w",encoding="utf-8",newline="\n")
            chunk_size=0;chunk_number+=1

        open_data_chunk()
        try:
            for row in rows:
                values = (
                    str(row["database_slug"]),
                    str(row["source_person_id"]),
                    str(row["canonical_player_id"]),
                    str(row["canonical_player_public_id"]),
                    name_overrides.get(
                        (str(row["database_slug"]), str(row["source_person_id"])),
                        str(row["canonical_player_name"]),
                    ),
                )
                statement=(
                    "INSERT INTO canonical_player_names VALUES("
                    + ",".join(sql_text(value) for value in values)
                    + ");\n"
                )
                statement_size=len(statement.encode("utf-8"))
                if chunk_statements and chunk_size+statement_size>chunk_bytes:
                    close_data_chunk();open_data_chunk()
                assert output is not None
                output.write(statement);chunk_size+=statement_size;chunk_statements+=1
                count += 1
                if count % 50_000 == 0:
                    print(f"canonical player lookup: {count:,} rows", flush=True)
        finally:
            close_data_chunk()
        write_chunk(
            (
                "CREATE INDEX canonical_player_names_canonical_idx\n"
                "ON canonical_player_names(canonical_player_id);\n"
                "CREATE INDEX canonical_player_names_database_name_idx\n"
                "ON canonical_player_names(database_slug, canonical_player_name);\n"
            ),
            2,
        )
    finally:
        connection.close()

    size = sum(int(chunk["size_bytes"]) for chunk in chunks)
    return {
        "identity_database": str(identity_path.resolve()),
        "output_dir": str(output_dir.resolve()),
        "lookup_rows": count,
        "size_bytes": size,
        "size_mib": round(size / 1024 / 1024, 1),
        "elapsed_seconds": round(time.monotonic() - started, 1),
        "chunks": chunks,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--identity",
        type=Path,
        default=Path("identity/retroball_identity.sqlite"),
    )
    parser.add_argument(
        "--name-overrides",
        type=Path,
        default=DEFAULT_OVERRIDES,
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data/d1/canonical-player-name-chunks"),
    )
    parser.add_argument(
        "--prefix",
        default="canonical-player-names",
    )
    parser.add_argument(
        "--chunk-mib",
        type=int,
        default=90,
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("data/d1/canonical-player-names-manifest.json"),
    )
    args = parser.parse_args()

    if not args.identity.is_file():
        print(f"Identity database not found: {args.identity.resolve()}", file=sys.stderr)
        return 2
    if args.chunk_mib < 1:
        print("--chunk-mib must be at least 1", file=sys.stderr)
        return 2

    try:
        manifest = build(
            args.identity.resolve(),
            args.name_overrides.resolve(),
            args.output_dir.resolve(),
            args.prefix,
            args.chunk_mib * 1024 * 1024,
        )
    except Exception as error:
        if args.output_dir.exists():
            for path in args.output_dir.glob(f"{args.prefix}-*.sql"):
                path.unlink()
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
