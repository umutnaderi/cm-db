#!/usr/bin/env python3
"""Stream a SQLite database dump into a Cloudflare D1-compatible SQL file."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from pathlib import Path


SKIP_STATEMENTS = {
    "BEGIN TRANSACTION;",
    "COMMIT;",
    "PRAGMA foreign_keys=OFF;",
}
D1_MAX_STATEMENT_BYTES = 100_000


def export_database(
    database_path: Path,
    output_dir: Path,
    prefix: str,
    chunk_bytes: int,
) -> dict[str, object]:
    existing_chunks = sorted(output_dir.glob(f"{prefix}-*.sql")) if output_dir.exists() else []
    if existing_chunks:
        raise FileExistsError(
            f"Chunk output already exists: {existing_chunks[0]}. "
            "Remove the chunk directory before exporting again."
        )

    output_dir.mkdir(parents=True, exist_ok=True)
    started = time.monotonic()
    connection = sqlite3.connect(
        f"{database_path.resolve().as_uri()}?mode=ro&immutable=1",
        uri=True,
    )
    statements = 0
    max_statement_bytes = 0
    chunks: list[dict[str, object]] = []
    output = None
    chunk_path = None
    chunk_size = 0
    chunk_statements = 0

    def open_chunk() -> None:
        nonlocal output, chunk_path, chunk_size, chunk_statements
        chunk_path = output_dir / f"{prefix}-{len(chunks) + 1:04d}.sql"
        output = chunk_path.open("w", encoding="utf-8", newline="\n")
        header = (
            "-- Retroball D1 serving database\n"
            "PRAGMA defer_foreign_keys = true;\n"
        )
        output.write(header)
        chunk_size = len(header.encode("utf-8"))
        chunk_statements = 0

    def close_chunk() -> None:
        nonlocal output
        if output is None or chunk_path is None:
            return
        output.close()
        chunks.append(
            {
                "path": str(chunk_path.resolve()),
                "size_bytes": chunk_path.stat().st_size,
                "size_mib": round(chunk_path.stat().st_size / 1024 / 1024, 1),
                "statements": chunk_statements,
            }
        )
        output = None

    try:
        open_chunk()
        for statement in connection.iterdump():
            stripped = statement.strip()
            if not stripped or stripped in SKIP_STATEMENTS:
                continue
            encoded_size = len(stripped.encode("utf-8"))
            if encoded_size > D1_MAX_STATEMENT_BYTES:
                raise RuntimeError(
                    "SQL statement exceeds D1's 100 KB limit: "
                    f"{encoded_size} bytes"
                )
            statement_size = encoded_size + 1
            if chunk_statements and chunk_size + statement_size > chunk_bytes:
                close_chunk()
                open_chunk()
            max_statement_bytes = max(max_statement_bytes, encoded_size)
            assert output is not None
            output.write(stripped)
            output.write("\n")
            chunk_size += statement_size
            chunk_statements += 1
            statements += 1
        close_chunk()
    except Exception:
        if output is not None:
            output.close()
        connection.close()
        for path in output_dir.glob(f"{prefix}-*.sql"):
            path.unlink()
        raise
    finally:
        try:
            connection.close()
        except Exception:
            pass

    size_bytes = sum(int(chunk["size_bytes"]) for chunk in chunks)
    return {
        "database": str(database_path.resolve()),
        "output_dir": str(output_dir.resolve()),
        "size_bytes": size_bytes,
        "size_mib": round(size_bytes / 1024 / 1024, 1),
        "statements": statements,
        "max_statement_bytes": max_statement_bytes,
        "elapsed_seconds": round(time.monotonic() - started, 1),
        "chunks": chunks,
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--database",
        type=Path,
        default=Path("data/d1/retroball-d1.sqlite"),
        help="D1-ready SQLite database",
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data/d1/chunks"),
        help="D1-compatible SQL chunk directory",
    )
    parser.add_argument(
        "--prefix",
        default="retroball-d1",
        help="SQL chunk filename prefix",
    )
    parser.add_argument(
        "--chunk-mib",
        type=int,
        default=90,
        help="Maximum SQL chunk size in MiB",
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("data/d1/chunks/manifest.json"),
        help="Export manifest output",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    database_path = args.database.resolve()
    output_dir = args.output_dir.resolve()

    if not database_path.is_file():
        print(f"Database not found: {database_path}", file=sys.stderr)
        return 2
    if args.chunk_mib < 1:
        print("--chunk-mib must be at least 1", file=sys.stderr)
        return 2

    try:
        manifest = export_database(
            database_path,
            output_dir,
            args.prefix,
            args.chunk_mib * 1024 * 1024,
        )
    except Exception as error:
        print(f"Export failed: {error}", file=sys.stderr)
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
