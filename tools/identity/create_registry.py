#!/usr/bin/env python3
"""Create or migrate the persistent Retroball identity registry."""

from __future__ import annotations

import argparse
from pathlib import Path

from common import REGISTRY_DB, SCHEMA_PATH, registry_connection


def create_registry(registry_path: Path, schema_path: Path) -> None:
    sql = schema_path.read_text(encoding="utf-8")
    connection = registry_connection(registry_path)
    try:
        connection.executescript(sql)
        columns = {row[1] for row in connection.execute("PRAGMA table_info(source_players)")}
        if columns and "normalized_date_of_birth" not in columns:
            connection.execute("ALTER TABLE source_players ADD COLUMN normalized_date_of_birth TEXT")
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=REGISTRY_DB)
    parser.add_argument("--schema", type=Path, default=SCHEMA_PATH)
    arguments = parser.parse_args()
    create_registry(arguments.registry, arguments.schema)
    print(f"identity registry ready: {arguments.registry}")


if __name__ == "__main__":
    main()
