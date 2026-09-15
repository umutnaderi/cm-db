"""Extract non-playing (coach/manager) attributes from a CM staff.dat.

    python tools/extract_cm_staff_attributes.py \
        --dat "C:/Program Files (x86)/Championship Manager 00-01/Data/staff.dat" \
        --identity data/converted/cm0001_vanilla_app_core.zip \
        --member cm0001_export/staff.csv \
        --slug cm0001_vanilla_original \
        --out data/staff/cm0001_staff_attributes.csv

These are the attributes an opponent AI manager needs, and most of them map
straight onto team instructions the match engine already has: Directness,
Pressing, Marking, Offside, Free roles, Discipline, Patience, Tactics.

RECORD LAYOUT, recovered by known-plaintext and verified exactly.

The existing staff.csv export carries identity, personality and a
`non_player_id`, but never followed that pointer -- the coach block was simply
never read. It lives in staff.dat as a fixed 68-byte record:

    +0   uint16   current ability
    +2   uint16   potential ability
    +4   uint16   home reputation
    +6   uint16   current reputation
    +8   uint16   world reputation
    +10  uint8[21] the attributes below, in ALPHABETICAL order by editor label
    +31  ...      references and padding (0xff)

Confirmed against a CM 00/01 editor screenshot of Fabio Capello: searching
staff.dat for his five abilities as consecutive little-endian uint16
(190/200/194/192/193) produced exactly ONE hit in 19.5 MB, and the 21 bytes
following it matched every attribute in the editor, in order, with no
adjustment.

WHAT IS NOT SOLVED: how `non_player_id` from the exported staff.csv locates a
record. Records do sit at a 68-byte stride inside the non-playing region
(observed spacings are all multiples of 68), but the id is NOT a linear index
into it -- every plausible stride from 68 to 157, against every base anchored
on the confirmed Capello record, was swept and none placed more than 20% of
the 14,756 ids on a valid record.

So this tool SCANS. It recovers every non-playing record in the file, which is
correct and complete, but it cannot yet say whose each one is. Joining names
needs the id mapping, and the cheapest way to solve that is two or three more
known records: with several (person, offset) anchors whose non_player_id the
CSV already gives, the mapping falls out. Until then `--identity` refuses
rather than emitting a confident-looking but misaligned join.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import struct
import zipfile
from pathlib import Path

# Alphabetical by the editor's own labels -- which is how the game stores them.
ATTRIBUTES = [
    "attacking", "business", "coaching", "coaching_goalie", "coaching_technique",
    "directness", "discipline", "free_roles", "interference", "judging_ability",
    "judging_potential", "man_handling", "marking", "motivating", "offside",
    "patience", "physiotherapy", "pressing", "resources", "tactics", "youngsters",
]
ABILITIES = [
    "non_playing_current_ability", "non_playing_potential_ability",
    "non_playing_home_reputation", "non_playing_current_reputation",
    "non_playing_world_reputation",
]
RECORD_STRIDE = 68
HEADER_BYTES = 10
MAX_ATTRIBUTE = 20
MAX_ABILITY = 200


def looks_like_record(blob: bytes, offset: int) -> bool:
    """A record is only plausible if every field is in its real range."""
    if offset < 0 or offset + HEADER_BYTES + len(ATTRIBUTES) > len(blob):
        return False
    ca, pa, home, current, world = struct.unpack_from("<5H", blob, offset)
    if not (1 <= ca <= MAX_ABILITY and ca <= pa <= MAX_ABILITY):
        return False
    if any(value > MAX_ABILITY for value in (home, current, world)):
        return False
    attrs = blob[offset + HEADER_BYTES:offset + HEADER_BYTES + len(ATTRIBUTES)]
    return not any(value > MAX_ATTRIBUTE for value in attrs)


def find_base(blob: bytes) -> int:
    """First plausible record, which is index 0 of the non-playing block.

    Derived rather than hard-coded so the same tool can face a different build
    of the same game without being re-tuned. Verified on CM 00/01: the base
    found this way puts `non_player_id` 3 and 5 exactly on valid records.
    """
    for offset in range(len(blob) - RECORD_STRIDE):
        if looks_like_record(blob, offset) and looks_like_record(blob, offset + RECORD_STRIDE):
            return offset
    raise SystemExit("No non-playing record block found in this file.")


def read_record(blob: bytes, base: int, non_player_id: int) -> dict | None:
    offset = base + non_player_id * RECORD_STRIDE
    if not looks_like_record(blob, offset):
        return None
    values = struct.unpack_from("<5H", blob, offset)
    attrs = blob[offset + HEADER_BYTES:offset + HEADER_BYTES + len(ATTRIBUTES)]
    record = dict(zip(ABILITIES, values))
    record.update(zip(ATTRIBUTES, attrs))
    record["record_offset"] = offset
    return record


def read_identity(archive: Path, member: str):
    with zipfile.ZipFile(archive) as bundle:
        with bundle.open(member) as handle:
            text = io.TextIOWrapper(handle, encoding="utf-8-sig", errors="replace")
            for row in csv.DictReader(text):
                yield row


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dat", required=True, help="staff.dat from the game's Data folder")
    parser.add_argument("--identity", help="zip archive holding the exported staff.csv")
    parser.add_argument("--member", default="staff.csv", help="path of staff.csv inside the archive")
    parser.add_argument("--slug", default="", help="database_slug to stamp on every row")
    parser.add_argument("--out", help="CSV to write; omit to only report")
    parser.add_argument("--base", type=int, help="override the detected record base")
    parser.add_argument("--allow-unverified-join", action="store_true",
                        help="join identities anyway; only for a mapping you have confirmed yourself")
    args = parser.parse_args()

    blob = Path(args.dat).read_bytes()
    base = args.base if args.base is not None else find_base(blob)
    print(f"staff.dat: {len(blob):,} bytes")
    print(f"record base: {base}  stride: {RECORD_STRIDE}")

    rows = []
    if args.identity and not args.allow_unverified_join:
        raise SystemExit(
            "Refusing to join identities: the non_player_id -> offset mapping is "
            "not solved (see this file's header). A join would silently attach the "
            "wrong attributes to the wrong person, which is worse than no data. "
            "Run without --identity to scan, or pass --allow-unverified-join if "
            "you have independently confirmed the mapping."
        )
    if args.identity:
        seen = missing = 0
        for person in read_identity(Path(args.identity), args.member):
            raw = (person.get("non_player_id") or "").strip()
            if raw in ("", "-1"):
                continue
            seen += 1
            record = read_record(blob, base, int(raw))
            if record is None:
                missing += 1
                continue
            rows.append({
                "database_slug": args.slug or person.get("database_slug", ""),
                "source_person_id": person.get("id", ""),
                "non_player_id": raw,
                "display_name": person.get("display_name", ""),
                "job_for_club_label": person.get("job_for_club_label", ""),
                "club_name": person.get("club_name", ""),
                "nation_name": person.get("nation_name", ""),
                **record,
            })
        print(f"staff with a non_player_id: {seen:,}")
        print(f"  decoded: {len(rows):,}   unreadable: {missing:,}")
    else:
        # Walk the whole region rather than stopping at the first gap: the
        # non-playing block is sparse -- plenty of slots are unused or hold
        # staff with no coaching data at all -- so an early break finds two
        # records and declares victory.
        index = 0
        while base + index * RECORD_STRIDE + HEADER_BYTES + len(ATTRIBUTES) <= len(blob):
            record = read_record(blob, base, index)
            if record:
                rows.append({"slot": index, **record})
            index += 1
        print(f"scanned {index:,} slots, decoded {len(rows):,} records")

    managers = [r for r in rows if "manager" in str(r.get("job_for_club_label", "")).lower()]
    if managers:
        print(f"  of which managers: {len(managers):,}")
        best = sorted(managers, key=lambda r: -r["non_playing_current_ability"])[:5]
        print("\n  highest-rated managers found:")
        for row in best:
            print(f"    {row['display_name'][:26]:28s} CA {row['non_playing_current_ability']:3d}"
                  f"  tactics {row['tactics']:2d}  directness {row['directness']:2d}"
                  f"  pressing {row['pressing']:2d}  motivating {row['motivating']:2d}")

    if args.out and rows:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
        print(f"\nWrote {out} ({len(rows):,} rows)")
        summary = out.with_suffix(".summary.json")
        summary.write_text(json.dumps({
            "rows": len(rows), "base": base, "stride": RECORD_STRIDE,
            "attributes": ATTRIBUTES, "abilities": ABILITIES,
        }, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
