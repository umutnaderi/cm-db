#!/usr/bin/env python3
"""Build a compact D1 lookup that propagates club colours through canonical links."""

from __future__ import annotations

import argparse
import json
import sqlite3
import sys
import time
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable


@dataclass(frozen=True)
class ClubLink:
    database_slug: str
    source_club_id: str
    canonical_club_id: str
    canonical_public_id: str
    normalized_name: str
    team_type: str


@dataclass(frozen=True)
class ColourPair:
    background: str
    foreground: str
    source_database_slug: str
    source_club_id: str
    slot: int
    season_order: int
    origin: str


def readonly_uri(path: Path) -> str:
    return f"{path.resolve().as_uri()}?mode=ro&immutable=1"


def read_palette(path: Path) -> list[str]:
    data = path.read_bytes()
    record_size = 58
    if not data or len(data) % record_size:
        raise RuntimeError(f"Unexpected colour.dat size: {len(data)} bytes")

    palette: list[str] = []
    for offset in range(0, len(data), record_size):
        identifier = int.from_bytes(data[offset : offset + 4], "little", signed=True)
        if identifier != len(palette):
            raise RuntimeError(
                f"Unexpected colour.dat identifier {identifier} at record {len(palette)}"
            )
        red, green, blue = data[offset + 55 : offset + 58]
        palette.append(f"#{red:02x}{green:02x}{blue:02x}")
    return palette


def decode_colour(value: object, palette: list[str]) -> str | None:
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    if len(text) == 7 and text.startswith("#"):
        try:
            int(text[1:], 16)
        except ValueError:
            return None
        return text.lower()

    try:
        numeric = int(text)
    except ValueError:
        return None

    if 0 <= numeric < len(palette):
        return palette[numeric]

    packed = numeric & 0xFFFFFFFF
    if packed & 0x00FFFFFF:
        return None
    identifier = packed >> 24
    return palette[identifier] if 0 <= identifier < len(palette) else None


def choose_pair(
    keys: Iterable[tuple[str, str]],
    club_rows: dict[tuple[str, str], sqlite3.Row],
    season_order: dict[str, int],
    palette: list[str],
) -> ColourPair | None:
    # Prefer the primary pair across every linked season before considering
    # alternate kit pairs. Within a slot, use the newest available season.
    for slot in (1, 2, 3):
        candidates: list[ColourPair] = []
        for database_slug, source_club_id in keys:
            row = club_rows.get((database_slug, source_club_id))
            if row is None:
                continue
            # The CM editor labels these explicitly: foreground is the text
            # colour and background is the fill behind it.
            foreground = decode_colour(row[f"fore_colour{slot}"], palette)
            background = decode_colour(row[f"back_colour{slot}"], palette)
            if not background or not foreground or background == foreground:
                continue
            candidates.append(
                ColourPair(
                    background=background,
                    foreground=foreground,
                    source_database_slug=database_slug,
                    source_club_id=source_club_id,
                    slot=slot,
                    season_order=season_order.get(database_slug, 0),
                    origin="seasonal_pair",
                )
            )
        if candidates:
            return max(
                candidates,
                key=lambda item: (
                    item.season_order,
                    item.source_database_slug,
                    item.source_club_id,
                ),
            )
    return None


def sql_text(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def build_lookup(
    serving_path: Path,
    identity_path: Path,
    palette_path: Path,
    overrides_path: Path,
    output_path: Path,
) -> dict[str, object]:
    started = time.monotonic()
    palette = read_palette(palette_path)
    overrides = json.loads(overrides_path.read_text(encoding="utf-8"))
    serving = sqlite3.connect(readonly_uri(serving_path), uri=True)
    identity = sqlite3.connect(readonly_uri(identity_path), uri=True)
    serving.row_factory = sqlite3.Row
    identity.row_factory = sqlite3.Row

    try:
        serving.execute("PRAGMA query_only = ON")
        identity.execute("PRAGMA query_only = ON")

        season_order = {
            str(row["slug"]): int(row["season_order"])
            for row in serving.execute(
                "SELECT slug, season_order FROM cm_databases"
            )
        }
        club_rows = {
            (str(row["database_slug"]), str(row["source_club_id"])): row
            for row in serving.execute(
                """
                SELECT
                  database_slug,
                  source_club_id,
                  fore_colour1,
                  back_colour1,
                  fore_colour2,
                  back_colour2,
                  fore_colour3,
                  back_colour3
                FROM clubs
                """
            )
        }
        links = [
            ClubLink(
                database_slug=str(row["database_slug"]),
                source_club_id=str(row["source_club_id"]),
                canonical_club_id=str(row["canonical_club_id"]),
                canonical_public_id=str(row["canonical_public_id"]),
                normalized_name=str(row["normalized_name"]),
                team_type=str(row["team_type"]),
            )
            for row in identity.execute(
                """
                SELECT
                  l.database_slug,
                  l.source_club_id,
                  l.canonical_club_id,
                  c.public_id AS canonical_public_id,
                  s.normalized_name,
                  s.team_type
                FROM club_identity_links l
                JOIN canonical_clubs c
                  ON c.id = l.canonical_club_id
                JOIN source_clubs s
                  ON s.database_slug = l.database_slug
                 AND s.source_club_id = l.source_club_id
                WHERE s.active = 1
                """
            )
        ]
    finally:
        serving.close()
        identity.close()

    links_by_canonical: dict[str, list[ClubLink]] = defaultdict(list)
    for link in links:
        links_by_canonical[link.canonical_club_id].append(link)

    exact_pairs: dict[str, ColourPair] = {}
    for canonical_club_id, canonical_links in links_by_canonical.items():
        pair = choose_pair(
            (
                (link.database_slug, link.source_club_id)
                for link in canonical_links
            ),
            club_rows,
            season_order,
            palette,
        )
        if pair:
            exact_pairs[canonical_club_id] = pair

    canonical_public_ids = {
        link.canonical_club_id: link.canonical_public_id
        for link in links
    }
    applied_override_groups = 0
    for canonical_club_id, public_id in canonical_public_ids.items():
        override = overrides.get(public_id)
        if not override:
            continue
        background = decode_colour(override.get("background"), palette)
        foreground = decode_colour(override.get("foreground"), palette)
        if not background or not foreground or background == foreground:
            raise RuntimeError(f"Invalid club colour override for {public_id}")
        exact_pairs[canonical_club_id] = ColourPair(
            background=background,
            foreground=foreground,
            source_database_slug="canonical_override",
            source_club_id=public_id,
            slot=0,
            season_order=1_000_000,
            origin="canonical_override",
        )
        applied_override_groups += 1

    coloured_groups_by_signature: dict[tuple[str, str], set[str]] = defaultdict(set)
    for link in links:
        if link.canonical_club_id in exact_pairs:
            coloured_groups_by_signature[
                (link.normalized_name, link.team_type)
            ].add(link.canonical_club_id)

    rows: list[tuple[str, ...]] = []
    exact_links = 0
    unique_name_fallback_links = 0
    for link in links:
        colour_canonical_id = link.canonical_club_id
        pair = exact_pairs.get(colour_canonical_id)
        resolution_method = (
            "canonical_override"
            if pair and pair.origin == "canonical_override"
            else "canonical_link"
        )

        if pair is None:
            candidates = coloured_groups_by_signature.get(
                (link.normalized_name, link.team_type),
                set(),
            )
            if len(candidates) == 1:
                colour_canonical_id = next(iter(candidates))
                pair = exact_pairs[colour_canonical_id]
                resolution_method = "unique_normalized_name"

        if pair is None:
            continue
        if resolution_method in {"canonical_link", "canonical_override"}:
            exact_links += 1
        else:
            unique_name_fallback_links += 1
        rows.append(
            (
                link.database_slug,
                link.source_club_id,
                link.canonical_club_id,
                colour_canonical_id,
                pair.background,
                pair.foreground,
                pair.source_database_slug,
                pair.source_club_id,
                str(pair.slot),
                resolution_method,
            )
        )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", encoding="utf-8", newline="\n") as output:
        output.write("-- Canonically resolved Retroball club colours\n")
        output.write("PRAGMA defer_foreign_keys = true;\n")
        output.write("DROP TABLE IF EXISTS canonical_club_colours;\n")
        output.write(
            """
CREATE TABLE canonical_club_colours (
  database_slug TEXT NOT NULL,
  source_club_id TEXT NOT NULL,
  canonical_club_id TEXT NOT NULL,
  colour_canonical_club_id TEXT NOT NULL,
  background_colour TEXT NOT NULL,
  foreground_colour TEXT NOT NULL,
  colour_source_database_slug TEXT NOT NULL,
  colour_source_club_id TEXT NOT NULL,
  colour_slot INTEGER NOT NULL,
  resolution_method TEXT NOT NULL,
  PRIMARY KEY (database_slug, source_club_id)
) WITHOUT ROWID;
""".lstrip()
        )
        for row in rows:
            # Keep the slot numeric while all identifiers remain lossless text.
            prefix = ",".join(sql_text(value) for value in row[:8])
            suffix = sql_text(row[9])
            output.write(
                "INSERT INTO canonical_club_colours VALUES("
                f"{prefix},{int(row[8])},{suffix});\n"
            )
        output.write(
            "CREATE INDEX canonical_club_colours_canonical_idx\n"
            "ON canonical_club_colours(canonical_club_id);\n"
        )

    size_bytes = output_path.stat().st_size
    return {
        "serving_database": str(serving_path.resolve()),
        "identity_database": str(identity_path.resolve()),
        "palette": str(palette_path.resolve()),
        "overrides": str(overrides_path.resolve()),
        "output": str(output_path.resolve()),
        "size_bytes": size_bytes,
        "size_mib": round(size_bytes / 1024 / 1024, 1),
        "canonical_links": len(links),
        "canonical_groups_with_colours": len(exact_pairs),
        "canonical_override_groups": applied_override_groups,
        "lookup_rows": len(rows),
        "exact_links": exact_links,
        "unique_normalized_name_fallback_links": unique_name_fallback_links,
        "elapsed_seconds": round(time.monotonic() - started, 1),
    }


def parse_args() -> argparse.Namespace:
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
        "--palette",
        type=Path,
        default=Path("01-02 dat/colour.dat"),
    )
    parser.add_argument(
        "--overrides",
        type=Path,
        default=Path("config/identity/club_colour_overrides.json"),
    )
    parser.add_argument(
        "--output",
        type=Path,
        default=Path("data/d1/canonical-club-colours.sql"),
    )
    parser.add_argument(
        "--manifest",
        type=Path,
        default=Path("data/d1/canonical-club-colours-manifest.json"),
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    for label, path in (
        ("Serving database", args.serving),
        ("Identity database", args.identity),
        ("Colour palette", args.palette),
        ("Club colour overrides", args.overrides),
    ):
        if not path.is_file():
            print(f"{label} not found: {path.resolve()}", file=sys.stderr)
            return 2
    if args.output.exists():
        print(
            f"Output already exists: {args.output.resolve()}. Remove or rename it first.",
            file=sys.stderr,
        )
        return 2

    try:
        manifest = build_lookup(
            args.serving.resolve(),
            args.identity.resolve(),
            args.palette.resolve(),
            args.overrides.resolve(),
            args.output.resolve(),
        )
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
