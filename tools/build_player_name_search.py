#!/usr/bin/env python3
"""Build the D1 FTS5 index for accent-insensitive player-name searches."""

from __future__ import annotations

import argparse
import csv
import json
import sqlite3
import sys
import time
import unicodedata
from pathlib import Path

from player_canonical_name_overrides import (
    DEFAULT_OVERRIDES,
    load_player_name_overrides,
)


CHARACTER_FOLDS = str.maketrans(
    {
        "ı": "i",
        "ł": "l",
        "đ": "d",
        "ð": "d",
        "þ": "th",
        "æ": "ae",
        "œ": "oe",
        "ø": "o",
    }
)


def readonly_uri(path: Path) -> str:
    return f"{path.resolve().as_uri()}?mode=ro&immutable=1"


def normalize_name(value: str) -> str:
    decomposed = unicodedata.normalize("NFKD", value).lower()
    unaccented = "".join(
        character for character in decomposed if not unicodedata.combining(character)
    )
    folded = unaccented.translate(CHARACTER_FOLDS)
    return " ".join(
        "".join(character if character.isalnum() else " " for character in folded).split()
    )


def sql_text(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def load_aliases(path: Path) -> dict[tuple[str, str], list[str]]:
    if not path.is_file():
        return {}
    aliases: dict[tuple[str, str], list[str]] = {}
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {"database_slug", "source_person_id", "search_text"}
        if reader.fieldnames is None or required - set(reader.fieldnames):
            raise RuntimeError(f"Invalid player search-alias CSV: {path}")
        for row in reader:
            key = (
                (row.get("database_slug") or "").strip(),
                (row.get("source_person_id") or "").strip(),
            )
            value = (row.get("search_text") or "").strip()
            if all(key) and value:
                aliases.setdefault(key, []).append(value)
    return aliases


def build(
    serving_path: Path,
    identity_path: Path,
    aliases_path: Path,
    name_overrides_path: Path,
    output_dir: Path,
    prefix: str,
    chunk_bytes: int,
    rows_per_statement: int,
) -> dict[str, object]:
    started = time.monotonic()
    existing = sorted(output_dir.glob(f"{prefix}-*.sql")) if output_dir.exists() else []
    if existing:
        raise FileExistsError(f"Chunk output already exists: {existing[0]}")
    output_dir.mkdir(parents=True, exist_ok=True)
    alias_map = load_aliases(aliases_path)
    name_overrides = load_player_name_overrides(name_overrides_path)

    connection = sqlite3.connect(readonly_uri(serving_path), uri=True)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only = ON")
    connection.execute("ATTACH DATABASE ? AS identity", (readonly_uri(identity_path),))

    chunks: list[dict[str, object]] = []
    chunk_number = 1

    def write_chunk(text: str, statements: int) -> None:
        nonlocal chunk_number
        path = output_dir / f"{prefix}-{chunk_number:04d}.sql"
        path.write_text(text, encoding="utf-8", newline="\n")
        chunks.append(
            {
                "path": str(path.resolve()),
                "size_bytes": path.stat().st_size,
                "size_mib": round(path.stat().st_size / 1024 / 1024, 1),
                "statements": statements,
            }
        )
        chunk_number += 1

    write_chunk(
        """-- Accent-insensitive player-name search; raw player names are unchanged.
DROP TABLE IF EXISTS player_name_search_fts;
CREATE VIRTUAL TABLE player_name_search_fts USING fts5(
  database_slug UNINDEXED,
  source_person_id UNINDEXED,
  search_text,
  tokenize = 'unicode61 remove_diacritics 2',
  detail = none,
  columnsize = 0
);
""",
        2,
    )

    output = None
    output_path = None
    output_size = 0
    output_statements = 0
    row_count = 0
    batch: list[str] = []

    def close_data_chunk() -> None:
        nonlocal output, output_path, output_statements
        if output is None or output_path is None:
            return
        output.close()
        chunks.append(
            {
                "path": str(output_path.resolve()),
                "size_bytes": output_path.stat().st_size,
                "size_mib": round(output_path.stat().st_size / 1024 / 1024, 1),
                "statements": output_statements,
            }
        )
        output = None
        output_path = None
        output_statements = 0

    def open_data_chunk() -> None:
        nonlocal output, output_path, output_size, chunk_number
        output_path = output_dir / f"{prefix}-{chunk_number:04d}.sql"
        output = output_path.open("w", encoding="utf-8", newline="\n")
        output_size = 0
        chunk_number += 1

    def flush_batch() -> None:
        nonlocal output_size, output_statements
        if not batch:
            return
        statement = (
            "INSERT INTO player_name_search_fts"
            "(database_slug,source_person_id,search_text) VALUES\n"
            + ",\n".join(batch)
            + ";\n"
        )
        statement_size = len(statement.encode("utf-8"))
        if output_statements and output_size + statement_size > chunk_bytes:
            close_data_chunk()
            open_data_chunk()
        assert output is not None
        output.write(statement)
        output_size += statement_size
        output_statements += 1
        batch.clear()

    query = """
        SELECT
          ps.database_slug,
          cast(ps.source_person_id AS TEXT) AS source_person_id,
          ps.display_name,
          ps.full_name,
          ps.first_name,
          ps.second_name,
          ps.common_name,
          canonical.preferred_name AS canonical_name
        FROM player_search ps
        LEFT JOIN identity.player_identity_links links
          ON links.database_slug = ps.database_slug
         AND links.source_person_id = cast(ps.source_person_id AS TEXT)
        LEFT JOIN identity.canonical_players canonical
          ON canonical.id = links.canonical_player_id
        ORDER BY ps.database_slug, ps.source_person_id
    """

    open_data_chunk()
    try:
        for row in connection.execute(query):
            key = (str(row["database_slug"]), str(row["source_person_id"]))
            source_values = [
                str(row[column] or "")
                for column in (
                    "display_name",
                    "full_name",
                    "first_name",
                    "second_name",
                    "common_name",
                    "canonical_name",
                )
            ]
            source_values.append(name_overrides.get(key, ""))
            source_values.extend(alias_map.get(key, []))
            normalized_values = list(
                dict.fromkeys(
                    normalized
                    for value in source_values
                    if (normalized := normalize_name(value))
                )
            )
            search_text = " ".join(normalized_values)
            batch.append(
                "("
                + ",".join(
                    (
                        sql_text(key[0]),
                        sql_text(key[1]),
                        sql_text(search_text),
                    )
                )
                + ")"
            )
            row_count += 1
            if len(batch) >= rows_per_statement:
                flush_batch()
            if row_count % 50_000 == 0:
                print(f"player name search: {row_count:,} rows", flush=True)
        flush_batch()
    finally:
        close_data_chunk()
        connection.close()

    total_size = sum(int(chunk["size_bytes"]) for chunk in chunks)
    return {
        "serving_database": str(serving_path.resolve()),
        "identity_database": str(identity_path.resolve()),
        "aliases": str(aliases_path.resolve()),
        "output_dir": str(output_dir.resolve()),
        "lookup_rows": row_count,
        "size_bytes": total_size,
        "size_mib": round(total_size / 1024 / 1024, 1),
        "elapsed_seconds": round(time.monotonic() - started, 1),
        "chunks": chunks,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--serving",
        type=Path,
        default=Path("data/d1/retroball-d1.sqlite"),
    )
    parser.add_argument(
        "--identity",
        type=Path,
        default=Path("identity/retroball_identity.sqlite"),
    )
    parser.add_argument(
        "--aliases",
        type=Path,
        default=Path("config/identity/player_search_aliases.csv"),
    )
    parser.add_argument(
        "--name-overrides",
        type=Path,
        default=DEFAULT_OVERRIDES,
    )
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path("data/d1/player-name-search-chunks"),
    )
    parser.add_argument("--prefix", default="player-name-search")
    parser.add_argument("--chunk-mib", type=int, default=20)
    parser.add_argument("--rows-per-statement", type=int, default=250)
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("data/d1/player-name-search-manifest.json"),
    )
    args = parser.parse_args()

    missing = [
        str(path.resolve())
        for path in (args.serving, args.identity)
        if not path.is_file()
    ]
    if missing:
        print("Required database not found: " + ", ".join(missing), file=sys.stderr)
        return 2
    if args.chunk_mib < 1 or args.rows_per_statement < 1:
        print("Chunk size and rows per statement must be positive", file=sys.stderr)
        return 2

    try:
        manifest = build(
            args.serving.resolve(),
            args.identity.resolve(),
            args.aliases.resolve(),
            args.name_overrides.resolve(),
            args.output_dir.resolve(),
            args.prefix,
            args.chunk_mib * 1024 * 1024,
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
