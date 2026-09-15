"""Extract non-playing (coach/manager) attributes straight from a CM staff.dat.

    python tools/extract_cm_staff_attributes.py --dat "99-00 dat - vanilla"
    python tools/extract_cm_staff_attributes.py --dat "01-02 dat - vanilla" \
        --slug cm0102_vanilla_original --out data/staff/cm0102_staff.csv

These are the attributes an opponent AI manager needs, and most map straight
onto team instructions the match engine already has: Directness, Pressing,
Marking, Offside, Free roles, Discipline, Patience, Tactics.

This reads the game's own binaries. It deliberately does NOT use the existing
staff.csv exports, which are wrong: for Alex Ferguson in 99-00 that export has
`second_name_id` equal to his own person id (yielding "Alex Giaretta"), club
"AC Horsens" instead of Man Utd, a 1900 date of birth, and a non_player_id of
2654 where the binary says 2757 -- and 2757 is the one that lands on the coach
record whose every value matches the in-game editor.

FILE LAYOUT -- recovered by known-plaintext and verified on three databases.

  staff.dat
    person array   base 1, stride 157
      +3    int32   first_name_id    -> first_names.dat
      +7    int32   second_name_id   -> second_names.dat
      +11   int32   common_name_id   -> common_names.dat (0 when unused)
      +23   uint16  year of birth
      +25   uint16  nation id
      +152  int32   non-playing index, or -1

    non-playing array   base 1 + people*157, stride 68
      +3    uint16 x5   current ability, potential ability,
                        home / current / world reputation
      +13   uint8 x21   the attributes below, in ALPHABETICAL order by the
                        editor's own labels -- which is how the game stores them

  first_names.dat / second_names.dat / common_names.dat
    stride 60; a 55-byte NUL-padded latin-1 string, then 5 bytes of housekeeping

VERIFICATION. Each anchor's five abilities were searched for as consecutive
little-endian uint16 and produced exactly ONE hit in a multi-megabyte file,
with all 21 following bytes matching the editor screenshot exactly:

  Fabio Capello   00-01   190/200/194/192/193   index  8352
  Alex Ferguson   99-00   200/200/200/200/180   index  2757
  Guus Hiddink    01-02   165/180/180/170/150   index 16430

Each index is an exact integer from (offset - 3 - base) / 68, which is what
ties the person array and the non-playing array together.

STILL TO DO: club and job. club.dat is not a fixed-stride array of the names
it contains, so linking a manager to the club he manages is its own decode.
Until then `non_playing_index >= 0` identifies non-playing staff, and current
ability plus the attributes rank them.
"""

from __future__ import annotations

import argparse
import csv
import struct
from pathlib import Path

ATTRIBUTES = [
    "attacking", "business", "coaching", "coaching_goalie", "coaching_technique",
    "directness", "discipline", "free_roles", "interference", "judging_ability",
    "judging_potential", "man_handling", "marking", "motivating", "offside",
    "patience", "physiotherapy", "pressing", "resources", "tactics", "youngsters",
]
ABILITIES = [
    "current_ability", "potential_ability",
    "home_reputation", "current_reputation", "world_reputation",
]
# Confirmed from anchors: Lucescu (Manager) and Mourinho (Coach) sit in the
# same 98-99 file and differ here, and Ferguson is a Manager too. The rest are
# named by their share of the population and are marked unknown rather than
# guessed at.
JOB_LABELS = {5: "Manager", 8: "Coach", 11: "Player"}

# The editor's Traits tab, alphabetical like everything else in this format.
TRAITS = [
    "adaptability", "ambition", "determination", "loyalty",
    "pressure", "professionalism", "sportsmanship", "temperament",
]

PERSON_BASE = 1
PERSON_STRIDE = 157
PERSON_FIRST_NAME = 3
PERSON_SECOND_NAME = 7
PERSON_COMMON_NAME = 11
PERSON_DOB_YEAR = 17      # year inside a full date of birth (1900 when unset)
PERSON_BIRTH_YEAR = 23    # the separate "year of birth" field (0 when a DOB is set)
PERSON_NATION = 25
PERSON_CLUB = 56          # int32; -1 when the person holds no club contract
PERSON_JOB = 60           # uint8; 5 Manager, 8 Coach, 11 Player (see JOB_LABELS)
PERSON_TRAITS = 85        # uint8 x8, alphabetical
PERSON_NONPLAYING = 152

NONPLAYING_STRIDE = 68
NONPLAYING_ABILITIES = 3
NONPLAYING_ATTRIBUTES = 13

NAME_STRIDE = 60
NAME_LENGTH = 55
MAX_ATTRIBUTE = 20
MAX_ABILITY = 200


def load_names(path: Path) -> list[str]:
    if not path.exists():
        return []
    blob = path.read_bytes()
    return [
        blob[index:index + NAME_LENGTH].split(b"\x00")[0].decode("latin-1")
        for index in range(0, len(blob) - NAME_LENGTH, NAME_STRIDE)
    ]


def plausible_nonplaying(blob: bytes, offset: int) -> bool:
    if offset < 0 or offset + NONPLAYING_ATTRIBUTES + len(ATTRIBUTES) > len(blob):
        return False
    values = struct.unpack_from("<5H", blob, offset + NONPLAYING_ABILITIES)
    current, potential = values[0], values[1]
    if not (1 <= current <= MAX_ABILITY and current <= potential <= MAX_ABILITY):
        return False
    if any(value > MAX_ABILITY for value in values[2:]):
        return False
    start = offset + NONPLAYING_ATTRIBUTES
    return not any(value > MAX_ATTRIBUTE for value in blob[start:start + len(ATTRIBUTES)])


def solve_person_count(blob: bytes) -> int:
    """How many people precede the non-playing array.

    The two arrays are adjacent and neither length is stored anywhere this tool
    reads, so the boundary is solved rather than assumed: the right count is the
    one whose non-playing base makes the most referenced indices land on a
    record that is actually shaped like one.
    """
    best = (0, -1.0)
    ceiling = (len(blob) - PERSON_BASE) // PERSON_STRIDE
    for people in range(ceiling, max(0, ceiling - 120_000), -1):
        base = PERSON_BASE + people * PERSON_STRIDE
        if base + NONPLAYING_STRIDE > len(blob) or not plausible_nonplaying(blob, base):
            continue
        # Score on what the boundary is actually FOR: how often an index taken
        # from a person record lands on a record shaped like one. Scoring the
        # first N slots instead only asks whether the array starts here, which
        # several wrong boundaries also satisfy -- it picked 56,702 for a file
        # the editor says holds 54,254, and halved the yield.
        referenced = decoded = 0
        for person in range(0, people, max(1, people // 3000)):
            offset = PERSON_BASE + person * PERSON_STRIDE
            if offset + PERSON_STRIDE > len(blob):
                break
            index = struct.unpack_from("<i", blob, offset + PERSON_NONPLAYING)[0]
            if index < 0:
                continue
            referenced += 1
            if plausible_nonplaying(blob, base + index * NONPLAYING_STRIDE):
                decoded += 1
        if referenced < 20:
            continue
        score = decoded / referenced
        if score > best[1]:
            best = (people, score)
    if not best[0]:
        raise SystemExit("Could not locate the non-playing array in this staff.dat")
    return best[0]


def solve_nonplaying_base(blob: bytes, people: int, anchor, names) -> int:
    """Where the non-playing array starts, solved exactly from one known person.

    It is not reliably derivable. The array is NOT always flush against the end
    of the person array -- 99-00 has them adjacent, 98-99 leaves a 120-byte gap
    -- and it does not always run to the end of the file either, so neither
    adjacency nor EOF gives it. Scoring candidate bases on how many referenced
    indices "look like" records does not discriminate: for 98-99 the true base
    came 51st, because a file full of 0xff and small integers produces
    plausible-looking records almost anywhere.

    So one anchor per database is taken as input -- a named person plus the five
    abilities the in-game editor shows for them. Those five as consecutive
    little-endian uint16 have been a UNIQUE hit in every file tried, which fixes
    the record's offset; the person's own record gives the index; and the base
    is then simple arithmetic with no search and no ambiguity.
    """
    first_name, second_name, abilities = anchor
    first_names, second_names, _ = names
    pattern = struct.pack("<5H", *abilities)
    hits = []
    cursor = blob.find(pattern)
    while cursor >= 0:
        hits.append(cursor)
        cursor = blob.find(pattern, cursor + 1)
    if not hits:
        raise SystemExit(f"Anchor abilities {abilities} appear nowhere in this staff.dat")

    wanted = None
    for person in range(people):
        offset = PERSON_BASE + person * PERSON_STRIDE
        if offset + PERSON_STRIDE > len(blob):
            break
        first = struct.unpack_from("<i", blob, offset + PERSON_FIRST_NAME)[0]
        second = struct.unpack_from("<i", blob, offset + PERSON_SECOND_NAME)[0]
        if (0 <= first < len(first_names) and 0 <= second < len(second_names)
                and first_names[first] == first_name and second_names[second] == second_name):
            index = struct.unpack_from("<i", blob, offset + PERSON_NONPLAYING)[0]
            if index >= 0:
                wanted = index
                break
    if wanted is None:
        raise SystemExit(f"Anchor {first_name} {second_name} not found among {people:,} people")

    for hit in hits:
        base = hit - NONPLAYING_ABILITIES - wanted * NONPLAYING_STRIDE
        if base > PERSON_BASE + people * PERSON_STRIDE - NONPLAYING_STRIDE:
            return base
    raise SystemExit("Anchor abilities found, but no hit yields a base past the person array")


def extract(folder: Path, slug: str, people: int, anchor):
    blob = (folder / "staff.dat").read_bytes()
    first = load_names(folder / "first_names.dat")
    second = load_names(folder / "second_names.dat")
    common = load_names(folder / "common_names.dat")
    base = solve_nonplaying_base(blob, people, anchor, (first, second, common))

    def name_at(table, index):
        return table[index] if 0 <= index < len(table) else ""

    rows = []
    for person in range(people):
        offset = PERSON_BASE + person * PERSON_STRIDE
        if offset + PERSON_STRIDE > len(blob):
            break
        index = struct.unpack_from("<i", blob, offset + PERSON_NONPLAYING)[0]
        if index < 0:
            continue
        record = base + index * NONPLAYING_STRIDE
        if not plausible_nonplaying(blob, record):
            continue
        values = struct.unpack_from("<5H", blob, record + NONPLAYING_ABILITIES)
        start = record + NONPLAYING_ATTRIBUTES
        attrs = blob[start:start + len(ATTRIBUTES)]
        row = {
            "database_slug": slug,
            "source_person_id": person,
            "non_playing_index": index,
            "first_name": name_at(first, struct.unpack_from("<i", blob, offset + PERSON_FIRST_NAME)[0]),
            "second_name": name_at(second, struct.unpack_from("<i", blob, offset + PERSON_SECOND_NAME)[0]),
            "common_name": name_at(common, struct.unpack_from("<i", blob, offset + PERSON_COMMON_NAME)[0]),
            # Two different fields, and which one carries the truth depends on
            # whether the person has a full date of birth. Ferguson has a blank
            # DOB and 1947 in the year field; Hiddink has a 1946 DOB and 0 in
            # the year field. Prefer whichever is actually populated.
            "year_of_birth": (
                struct.unpack_from("<H", blob, offset + PERSON_BIRTH_YEAR)[0]
                or struct.unpack_from("<H", blob, offset + PERSON_DOB_YEAR)[0]
            ),
            "nation_id": struct.unpack_from("<H", blob, offset + PERSON_NATION)[0],
            "club_id": struct.unpack_from("<i", blob, offset + PERSON_CLUB)[0],
            "job_code": blob[offset + PERSON_JOB],
            "job": JOB_LABELS.get(blob[offset + PERSON_JOB], ""),
        }
        row.update(zip(TRAITS, blob[offset + PERSON_TRAITS:offset + PERSON_TRAITS + len(TRAITS)]))
        row.update(zip(ABILITIES, values))
        row.update(zip(ATTRIBUTES, attrs))
        rows.append(row)
    return people, rows


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract CM coach/manager attributes")
    parser.add_argument("--dat", required=True, help="folder holding staff.dat and the name files")
    parser.add_argument("--slug", default="", help="database_slug to stamp on every row")
    parser.add_argument("--anchor", required=True, help=(
        "one known person and their five editor abilities, as "
        "\"First,Second,CA,PA,Home,Current,World\" -- e.g. "
        "\"Alex,Ferguson,200,200,200,200,180\". This fixes the non-playing "
        "array base exactly; see solve_nonplaying_base for why it cannot be "
        "derived."))
    parser.add_argument("--people", type=int, required=True, help=(
        "number of person records, which the editor shows in its status bar "
        "(\"1 of 54254 selected\"). Auto-detection is unreliable -- it is a "
        "search for an array boundary that several wrong answers also satisfy "
        "-- so prefer passing the real figure."))
    parser.add_argument("--out", help="CSV to write")
    parser.add_argument("--top", type=int, default=8, help="how many top-rated staff to print")
    args = parser.parse_args()

    folder = Path(args.dat)
    parts = [piece.strip() for piece in args.anchor.split(",")]
    if len(parts) != 7:
        raise SystemExit('--anchor must be "First,Second,CA,PA,Home,Current,World"')
    anchor = (parts[0], parts[1], tuple(int(value) for value in parts[2:]))
    people, rows = extract(folder, args.slug or folder.name, args.people, anchor)
    print(f"{folder}")
    print(f"  people: {people:,}   decoded: {len(rows):,}")
    if rows:
        best = sorted(rows, key=lambda row: -row["current_ability"])[:args.top]
        print(f"  highest-rated:")
        for row in best:
            label = (f"{row['first_name']} {row['second_name']}").strip() or row["common_name"]
            print(f"    {label[:26]:28s} CA{row['current_ability']:4d}"
                  f"  tac{row['tactics']:3d} dir{row['directness']:3d} prs{row['pressing']:3d}"
                  f"  mot{row['motivating']:3d} jdg{row['judging_ability']:3d}")
    if args.out and rows:
        out = Path(args.out)
        out.parent.mkdir(parents=True, exist_ok=True)
        with out.open("w", encoding="utf-8", newline="") as handle:
            writer = csv.DictWriter(handle, fieldnames=list(rows[0].keys()))
            writer.writeheader()
            writer.writerows(rows)
        print(f"  wrote {out} ({len(rows):,} rows)")


if __name__ == "__main__":
    main()
