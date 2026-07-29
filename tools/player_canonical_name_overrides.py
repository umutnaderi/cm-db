"""Load source-keyed canonical player display-name overrides."""

from __future__ import annotations

import csv
from pathlib import Path


DEFAULT_OVERRIDES = (
    Path(__file__).resolve().parents[1]
    / "config"
    / "identity"
    / "player_canonical_name_overrides.csv"
)
DEFAULT_MANUAL_OVERRIDES = (
    Path(__file__).resolve().parents[1]
    / "config"
    / "identity"
    / "player_manual_canonical_name_overrides.csv"
)


def _load_file(path: Path) -> dict[tuple[str, str], str]:
    if not path.is_file():
        return {}
    overrides: dict[tuple[str, str], str] = {}
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {
            "database_slug",
            "source_person_id",
            "canonical_name",
            "reference_url",
            "match_basis",
        }
        if reader.fieldnames is None or required - set(reader.fieldnames):
            raise RuntimeError(f"Invalid canonical player-name override CSV: {path}")
        for line_number, row in enumerate(reader, 2):
            key = (
                (row.get("database_slug") or "").strip(),
                (row.get("source_person_id") or "").strip(),
            )
            canonical_name = (row.get("canonical_name") or "").strip()
            if not all(key) or not canonical_name:
                raise RuntimeError(
                    f"Empty canonical player-name override on line {line_number}"
                )
            existing = overrides.get(key)
            if existing and existing != canonical_name:
                raise RuntimeError(
                    f"Conflicting canonical player-name override for {key}"
                )
            overrides[key] = canonical_name
    return overrides


def load_player_name_overrides(
    path: Path = DEFAULT_OVERRIDES,
    manual_path: Path = DEFAULT_MANUAL_OVERRIDES,
) -> dict[tuple[str, str], str]:
    overrides = _load_file(path)
    for key, canonical_name in _load_file(manual_path).items():
        existing = overrides.get(key)
        if existing and existing != canonical_name:
            raise RuntimeError(f"Conflicting automatic/manual name override for {key}")
        overrides[key] = canonical_name
    return overrides
