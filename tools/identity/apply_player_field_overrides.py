#!/usr/bin/env python3
"""Apply reviewed derived-field corrections without changing raw player data."""

from __future__ import annotations

import argparse
import csv
import datetime as dt
from pathlib import Path

from common import REGISTRY_DB, ROOT, registry_connection


OVERRIDES = ROOT / "config" / "identity" / "player_field_overrides.csv"


def load(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {
            "database_slug",
            "source_person_id",
            "normalized_date_of_birth",
            "notes",
        }
        if reader.fieldnames is None or required - set(reader.fieldnames):
            raise RuntimeError("Player field override CSV has invalid columns")
        rows = []
        seen = set()
        for line, raw in enumerate(reader, 2):
            row = {key: (value or "").strip() for key, value in raw.items()}
            key = (row["database_slug"], row["source_person_id"])
            try:
                row["normalized_date_of_birth"] = dt.date.fromisoformat(
                    row["normalized_date_of_birth"]
                ).isoformat()
            except ValueError as error:
                raise RuntimeError(
                    f"Invalid normalized DOB on player field override line {line}"
                ) from error
            if not all(key) or key in seen:
                raise RuntimeError(f"Invalid player field override line {line}")
            seen.add(key)
            rows.append(row)
        return rows


def apply(registry_path: Path, overrides_path: Path) -> dict[str, int]:
    connection = registry_connection(registry_path)
    rows = load(overrides_path)
    matched = changed = 0
    try:
        connection.execute("BEGIN IMMEDIATE")
        for row in rows:
            key = (row["database_slug"], row["source_person_id"])
            source = connection.execute(
                """
                SELECT normalized_date_of_birth
                FROM source_players
                WHERE database_slug = ? AND source_person_id = ? AND active = 1
                """,
                key,
            ).fetchone()
            if source is None:
                raise RuntimeError(f"Player field override source not found: {key}")
            matched += 1
            corrected = row["normalized_date_of_birth"]
            if source["normalized_date_of_birth"] == corrected:
                continue
            connection.execute(
                """
                UPDATE source_players
                   SET normalized_date_of_birth = ?,
                       estimated_birth_year = ?,
                       last_changed_at = CURRENT_TIMESTAMP
                 WHERE database_slug = ? AND source_person_id = ?
                """,
                (corrected, int(corrected[:4]), *key),
            )
            changed += 1
        connection.commit()
        return {"overrides": len(rows), "matched": matched, "changed": changed}
    except Exception:
        connection.rollback()
        raise
    finally:
        connection.close()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=REGISTRY_DB)
    parser.add_argument("--overrides", type=Path, default=OVERRIDES)
    args = parser.parse_args()
    result = apply(args.registry, args.overrides)
    print(
        "field overrides: {overrides}; matched: {matched}; changed: {changed}".format(
            **result
        )
    )


if __name__ == "__main__":
    main()
