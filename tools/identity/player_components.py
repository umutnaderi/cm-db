#!/usr/bin/env python3
"""Load and apply reviewed multi-season player identity components."""

from __future__ import annotations

import csv
import datetime as dt
from pathlib import Path

from common import ROOT


COMPONENT_RESOLUTIONS = (
    ROOT / "config" / "identity" / "player_component_resolutions.csv"
)
REFERENCE_COMPONENT_RESOLUTIONS = (
    ROOT / "config" / "identity" / "player_reference_component_resolutions.csv"
)


def load_component_resolutions(path: Path = COMPONENT_RESOLUTIONS) -> list[dict]:
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle)
        required = {
            "canonical_public_id",
            "canonical_name",
            "normalized_date_of_birth",
            "source_keys",
            "notes",
        }
        if reader.fieldnames is None or required - set(reader.fieldnames):
            raise RuntimeError("Player component resolution CSV has invalid columns")

        resolutions = []
        seen_public_ids: set[str] = set()
        seen_source_keys: set[tuple[str, str]] = set()
        for line, raw in enumerate(reader, 2):
            row = {key: (value or "").strip() for key, value in raw.items()}
            public_id = row["canonical_public_id"]
            canonical_name = row["canonical_name"]
            try:
                corrected_dob = dt.date.fromisoformat(
                    row["normalized_date_of_birth"]
                ).isoformat()
            except ValueError as error:
                raise RuntimeError(
                    f"Invalid normalized DOB on component resolution line {line}"
                ) from error

            source_keys = []
            databases = set()
            for encoded in row["source_keys"].split(";"):
                encoded = encoded.strip()
                if not encoded or ":" not in encoded:
                    raise RuntimeError(
                        f"Invalid source key on component resolution line {line}"
                    )
                database_slug, source_person_id = encoded.split(":", 1)
                key = (database_slug.strip(), source_person_id.strip())
                if not all(key) or key in seen_source_keys:
                    raise RuntimeError(
                        f"Duplicate or empty source key on component resolution line {line}"
                    )
                if key[0] in databases:
                    raise RuntimeError(
                        f"Component resolution line {line} contains two players "
                        f"from {key[0]}"
                    )
                databases.add(key[0])
                seen_source_keys.add(key)
                source_keys.append(key)

            if (
                not public_id
                or not canonical_name
                or len(source_keys) < 2
                or public_id in seen_public_ids
            ):
                raise RuntimeError(f"Invalid player component resolution line {line}")
            seen_public_ids.add(public_id)
            resolutions.append(
                {
                    "canonical_public_id": public_id,
                    "canonical_name": canonical_name,
                    "normalized_date_of_birth": corrected_dob,
                    "source_keys": tuple(source_keys),
                    "notes": row["notes"],
                }
            )
        return resolutions


def load_all_component_resolutions(
    primary_path: Path = COMPONENT_RESOLUTIONS,
    reference_path: Path = REFERENCE_COMPONENT_RESOLUTIONS,
) -> list[dict]:
    resolutions = load_component_resolutions(primary_path)
    if reference_path.is_file():
        resolutions.extend(load_component_resolutions(reference_path))
    seen_public_ids: set[str] = set()
    seen_source_keys: set[tuple[str, str]] = set()
    for resolution in resolutions:
        public_id = resolution["canonical_public_id"]
        if public_id in seen_public_ids:
            raise RuntimeError(f"Duplicate component public ID across files: {public_id}")
        seen_public_ids.add(public_id)
        for key in resolution["source_keys"]:
            if key in seen_source_keys:
                raise RuntimeError(f"Duplicate component source key across files: {key}")
            seen_source_keys.add(key)
    return resolutions


def component_field_overrides(
    resolutions: list[dict],
) -> dict[tuple[str, str], str]:
    return {
        key: resolution["normalized_date_of_birth"]
        for resolution in resolutions
        for key in resolution["source_keys"]
    }


def apply_component_fields(
    connection,
    resolutions: list[dict],
    *,
    clear_quarantine: bool = False,
) -> dict[str, int]:
    """Correct derived DOBs for reviewed members while retaining raw source DOBs."""
    matched = changed = quarantine_cleared = 0
    for resolution in resolutions:
        corrected = resolution["normalized_date_of_birth"]
        for key in resolution["source_keys"]:
            source = connection.execute(
                """
                SELECT normalized_date_of_birth
                FROM source_players
                WHERE database_slug = ? AND source_person_id = ? AND active = 1
                """,
                key,
            ).fetchone()
            if source is None:
                raise RuntimeError(f"Player component source not found: {key}")
            matched += 1
            if source["normalized_date_of_birth"] != corrected:
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
            if clear_quarantine:
                quarantine_cleared += connection.execute(
                    """
                    DELETE FROM player_link_quarantine
                    WHERE database_slug = ? AND source_person_id = ?
                    """,
                    key,
                ).rowcount
        if clear_quarantine:
            # A prior automatic component may have accidentally reused this
            # reviewed public ID and pulled unrelated rows into its quarantine.
            # Release the whole prior component so non-members can be safely
            # reconsidered after public IDs are reserved by the linker.
            quarantine_cleared += connection.execute(
                """
                DELETE FROM player_link_quarantine
                WHERE previous_canonical_player_id = (
                    SELECT id FROM canonical_players WHERE public_id = ?
                )
                """,
                (resolution["canonical_public_id"],),
            ).rowcount
    return {
        "components": len(resolutions),
        "members": matched,
        "changed": changed,
        "quarantine_cleared": quarantine_cleared,
    }
