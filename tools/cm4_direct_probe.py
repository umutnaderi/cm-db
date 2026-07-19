import argparse
import csv
import json
import struct
from pathlib import Path


PERSON_NONPLAYER = 1
PERSON_PLAYER = 2
PERSON_OFFICIAL = 4
PERSON_RETIRED = 5


PLAYING_DATA_FIELDS = [
    "goalkeeper",
    "sweeper",
    "defender",
    "defensive_midfielder",
    "midfielder",
    "attacking_midfielder",
    "attacker",
    "wing_back",
    "free_role",
    "right_side",
    "left_side",
    "central",
    "crossing",
    "dribbling",
    "finishing",
    "heading",
    "long_shots",
    "marking",
    "off_the_ball",
    "passing",
    "penalties",
    "tackling",
    "creativity",
    "handling",
    "aerial_ability",
    "command_of_area",
    "communication",
    "kicking",
    "throwing",
    "anticipation",
    "decisions",
    "one_on_ones",
    "positioning",
    "reflexes",
    "throw_ins",
    "first_touch",
    "technique",
    "left_foot",
    "right_foot",
    "flair",
    "corners",
    "teamwork",
    "work_rate",
    "long_throws",
    "eccentricity",
    "rushing_out",
    "tendency_to_punch",
    "acceleration",
    "set_pieces",
    "strength",
    "stamina",
    "pace",
    "jumping",
    "influence",
    "dirtiness",
    "balance",
    "bravery",
    "consistency",
    "aggression",
    "agility",
    "important_matches",
    "injury_proneness",
    "versatility",
    "natural_fitness",
    "determination",
]


PERSON_DATA_FIELDS = [
    "adaptability",
    "ambition",
    "loyalty",
    "pressure",
    "professionalism",
    "sportsmanship",
    "temperament",
    "controversy",
]


class Reader:
    def __init__(self, path):
        self.path = Path(path)
        self.file = self.path.open("rb")

    def close(self):
        self.file.close()

    @property
    def pos(self):
        return self.file.tell()

    def read(self, size):
        data = self.file.read(size)
        if len(data) != size:
            raise EOFError(f"{self.path}: wanted {size} bytes at {self.pos}, got {len(data)}")
        return data

    def skip(self, size):
        self.file.seek(size, 1)

    def u8(self):
        return self.read(1)[0]

    def i8(self):
        return struct.unpack("<b", self.read(1))[0]

    def u16(self):
        return struct.unpack("<H", self.read(2))[0]

    def i16(self):
        return struct.unpack("<h", self.read(2))[0]

    def i32(self):
        return struct.unpack("<i", self.read(4))[0]

    def i64(self):
        return struct.unpack("<q", self.read(8))[0]

    def boolean(self):
        return self.u8() != 0

    def wide_string(self):
        length = self.i32()
        if length <= 0:
            return ""
        raw = self.read(length * 2)
        self.skip(2)
        return raw.decode("utf-16le", errors="replace")

    def skip_wide_string(self):
        length = self.i32()
        if length > 0:
            self.skip(length * 2 + 2)


def parse_standard_person_for_resync(reader, file_version):
    start = reader.pos
    leading_id = reader.i32()
    person_type = reader.u8()

    if person_type not in (PERSON_NONPLAYER, PERSON_PLAYER, PERSON_OFFICIAL, PERSON_NONPLAYER | PERSON_PLAYER):
        raise ValueError(f"bad person type {person_type} at {start}")

    if person_type & PERSON_PLAYER:
        read_player(reader, file_version)
    if person_type & PERSON_NONPLAYER:
        skip_nonplayer(reader)
    if person_type & PERSON_OFFICIAL:
        skip_official(reader)

    reader.skip(12)
    reader.skip(4)
    reader.skip(4)
    reader.skip(2)
    if file_version >= 145:
        reader.skip(2)
    reader.skip(4 + 1 + 4 + 4 + 1 + 4 + 1 + 4 + 4 + 1 + 4 + 4)
    read_contracts(reader, file_version)
    reader.skip(1)
    if reader.boolean():
        skip_relationships(reader)
    reader.skip(2)
    if file_version >= 145:
        reader.skip(1)
    reader.skip(1)
    person_id = reader.i32()
    reader.skip(4)
    if file_version >= 145 and (person_type & PERSON_PLAYER) and (person_type & PERSON_NONPLAYER):
        reader.skip(2)

    if person_id != leading_id:
        raise ValueError(f"leading id {leading_id} != person id {person_id} at {start}")


def can_parse_standard_people_sequence(path, file_version, start, rows=2):
    reader = Reader(path)
    try:
        reader.file.seek(start)
        for _ in range(rows):
            parse_standard_person_for_resync(reader, file_version)
        return True
    except Exception:
        return False
    finally:
        reader.close()


def skip_type5_person(reader, file_version, row_start):
    after_type = reader.pos

    try:
        length = reader.i32()
        if length < 0 or length > 256:
            raise ValueError("implausible first retired-person string length")
        reader.skip(length * 2 + (2 if length > 0 else 0))
        length = reader.i32()
        if length < 0 or length > 256:
            raise ValueError("implausible second retired-person string length")
        reader.skip(length * 2 + (2 if length > 0 else 0))
        reader.skip(2)
        reader.i32()
        reader.i32()
        return
    except Exception:
        reader.file.seek(after_type)

    for candidate in range(row_start + 5, row_start + 20000):
        if can_parse_standard_people_sequence(reader.path, file_version, candidate):
            reader.file.seek(candidate)
            return

    raise ValueError(f"could not resync after type-5 person row at {row_start}")


def read_header(reader):
    prefix = reader.u8()
    header_version = reader.i16()
    file_type = reader.read(6).decode("utf-16le", errors="replace")
    file_version = reader.i16()
    postfix = reader.u8()
    return {
        "prefix": prefix,
        "header_version": header_version,
        "file_type": file_type,
        "file_version": file_version,
        "postfix": postfix,
    }


def read_date(reader):
    return {"days": reader.u16(), "year": reader.u16()}


def skip_career_stats(reader):
    reader.skip(16)


def read_player(reader, file_version):
    player = {
        "home_reputation": reader.i16(),
        "current_reputation": reader.i16(),
        "world_reputation": reader.i16(),
        "current_ability": reader.i16(),
        "potential_ability": reader.i16(),
        "playing_data_id": reader.i32(),
        "playing_history_id": reader.i32(),
        "estimated_value": reader.i32(),
        "morale": reader.u8(),
        "nation_choice_factor": reader.u8(),
        "fitness": reader.i16(),
        "jadedness": reader.i16(),
        "condition": reader.i16(),
        "shortlisted_by_count": reader.u8(),
        "nation_games_mask": reader.i16(),
        "last_national_game_index": reader.i16(),
        "national_apps_when_joined_club": reader.u8(),
        "declared_for_nation": reader.boolean(),
        "weight": reader.i16(),
        "height": reader.i16(),
        "ability_offset": reader.u8(),
        "sale_value": reader.i32(),
    }
    has_career_stats = reader.boolean()
    if has_career_stats:
        skip_career_stats(reader)
    player["starting_club_id"] = reader.i32()
    extra_playing_data = reader.boolean()
    player["extra_playing_data"] = extra_playing_data
    player["booking_count"] = reader.u8()
    reader.skip(28)
    player["human_controlled"] = reader.boolean()
    player["training_schedule"] = reader.i32()
    player["last_update_week"] = reader.i32()
    player["awol"] = reader.u8()
    if file_version >= 145:
        player["unknown"] = reader.i8()
    return player


def skip_nonplayer(reader):
    reader.skip(15)


def skip_official(reader):
    reader.skip(23)


def read_contract(reader, file_version):
    contract = {
        "contract_type": reader.u8(),
        "full_time": reader.u8(),
        "leaving_on_bosman": reader.u8(),
        "games_since_joined": reader.i16(),
        "appearance_bonus": reader.i32(),
        "goal_bonus": reader.i32(),
        "assist_bonus": reader.i32(),
        "clean_sheet_bonus": reader.i32(),
    }
    clause_count = reader.u8()
    contract["clause_count"] = clause_count
    contract["signing_on_fee"] = reader.i32()
    contract["contract_length"] = reader.u8()
    contract["job"] = reader.u8()
    reader.skip(5 * clause_count)
    if file_version >= 145:
        contract["co_ownership"] = reader.boolean()
    contract["is_national_team"] = reader.boolean()
    contract["team_contracted_id"] = reader.i32()
    contract["estimated_wage"] = reader.i32()
    contract["contract_expires"] = read_date(reader)
    contract["squad_status"] = reader.u8()
    contract["transfer_status"] = reader.u8()
    contract["happiness"] = reader.i64()
    if file_version >= 145:
        contract["start_date"] = read_date(reader)
    contract["happiness_level"] = reader.u8()
    contract["perceived_squad_status"] = reader.u8()
    contract["club_choice_factor"] = reader.u8()
    contract["squad_number"] = reader.i8()
    contract["transfer_offer_options"] = reader.u8()
    if file_version >= 145:
        contract["unknown2"] = reader.u16()
    return contract


def read_contracts(reader, file_version):
    count = reader.u8()
    return [read_contract(reader, file_version) for _ in range(count)]


def skip_relationships(reader):
    count = reader.u8()
    reader.skip(count * 8)


def read_people_table(reader, file_version, max_rows=None):
    table_start = reader.pos
    total_rows = reader.i32()
    reader.skip(12)
    people = []
    retired_rows = 0

    rows_to_read = total_rows if max_rows is None else min(total_rows, max_rows)

    for row_index in range(rows_to_read):
        row_start = reader.pos
        try:
            leading_id = reader.i32()
            person_type = reader.u8()

            if person_type == PERSON_RETIRED:
                skip_type5_person(reader, file_version, row_start)
                retired_rows += 1
                continue

            person = {
                "row_index": row_index,
                "row_start": row_start,
                "leading_id": leading_id,
                "person_type": person_type,
                "is_player": bool(person_type & PERSON_PLAYER),
                "is_nonplayer": bool(person_type & PERSON_NONPLAYER),
                "is_official": bool(person_type & PERSON_OFFICIAL),
            }

            if person["is_player"]:
                person["player"] = read_player(reader, file_version)
            if person["is_nonplayer"]:
                skip_nonplayer(reader)
            if person["is_official"]:
                skip_official(reader)

            person.update({
                "first_name_id": reader.i32(),
                "second_name_id": reader.i32(),
                "common_name_id": reader.i32(),
                "date_of_birth": read_date(reader),
                "nation_id": reader.i32(),
                "international_apps": reader.u8(),
                "international_goals": reader.u8(),
            })
            if file_version >= 145:
                person["u21_apps"] = reader.u8()
                person["u21_goals"] = reader.u8()

            person.update({
                "national_team_id": reader.i32(),
                "national_team_job": reader.u8(),
                "date_joined_national_team": read_date(reader),
                "club_team_id": reader.i32(),
                "club_job": reader.u8(),
                "date_joined_club": read_date(reader),
                "speaks_current_language": reader.u8(),
                "person_data_id": reader.i32(),
                "city_of_birth_id": reader.i32(),
                "transfer_offer_count": reader.u8(),
                "contract_offer_decision_date_unique_id": reader.i32(),
                "person_history_index": reader.i32(),
            })
            person["contracts"] = read_contracts(reader, file_version)
            person["contract_offer_count"] = reader.u8()
            if reader.boolean():
                skip_relationships(reader)
                person["has_relationships"] = True
            else:
                person["has_relationships"] = False
            person["interested_club_count"] = reader.i16()
            if file_version >= 145:
                person["unknown1"] = reader.u8()
            person["person_flags"] = reader.u8()
            person["id"] = reader.i32()
            person["unique_id"] = reader.i32()
            if file_version >= 145 and person["is_player"] and person["is_nonplayer"]:
                person["unknown2"] = reader.u16()
            people.append(person)
        except Exception as error:
            raise RuntimeError(
                f"Failed reading people row {row_index} at {row_start}, "
                f"current offset {reader.pos}, leading_id={locals().get('leading_id')}, "
                f"person_type={locals().get('person_type')}"
            ) from error

    return {
        "table_start": table_start,
        "total_rows": total_rows,
        "active_rows": len(people),
        "retired_rows": retired_rows,
        "people": people,
    }


def read_person_data_table(reader):
    count = reader.i32()
    rows = {}
    for _ in range(count):
        record_type = reader.u8()
        values = {field: reader.i8() for field in PERSON_DATA_FIELDS}
        row_id = reader.i32()
        unique_id = reader.i32()
        values.update({"record_type": record_type, "id": row_id, "unique_id": unique_id})
        rows[row_id] = values
    return rows


def read_playing_data_table(reader, file_version):
    count = reader.i32()
    rows = {}
    fields = PLAYING_DATA_FIELDS + (["unknown"] if file_version >= 145 else [])
    for _ in range(count):
        record_type = reader.u8()
        values = {field: reader.i8() for field in fields}
        row_id = reader.i32()
        unique_id = reader.i32()
        values.update({"record_type": record_type, "id": row_id, "unique_id": unique_id})
        rows[row_id] = values
    return rows


def read_nonplaying_data_table(reader):
    count = reader.i32()
    row_size = 1 + 28 + 4 + 4
    reader.skip(count * row_size)
    return count


def find_data_dir(path):
    root = Path(path)
    nested = root / "db"
    if (nested / "people_db.dat").exists():
        return nested
    return root


def read_people_db_preamble(data_dir):
    people_path = data_dir / "people_db.dat"
    reader = Reader(people_path)
    try:
        header = read_header(reader)
        counts = {
            "people": reader.i32(),
            "person_data": reader.i32(),
            "playing_data": reader.i32(),
            "nonplaying_data": reader.i32(),
        }
    finally:
        reader.close()
    return header, counts


def find_playing_data_offset(data_dir, file_version, playing_data_count):
    people_path = data_dir / "people_db.dat"
    data = people_path.read_bytes()
    needle = struct.pack("<i", playing_data_count) + b"\x00"
    fields = len(PLAYING_DATA_FIELDS) + (1 if file_version >= 145 else 0)
    start = 0

    while True:
        offset = data.find(needle, start)
        if offset < 0:
            raise ValueError(f"Could not find playing data table in {people_path}")

        row_id_offset = offset + 4 + 1 + fields
        if row_id_offset + 8 <= len(data):
            row_id = struct.unpack_from("<i", data, row_id_offset)[0]
            if row_id == 0:
                return offset

        start = offset + 1


def read_playing_data_from_database(database_dir):
    data_dir = find_data_dir(database_dir)
    header, counts = read_people_db_preamble(data_dir)
    offset = find_playing_data_offset(data_dir, header["file_version"], counts["playing_data"])
    reader = Reader(data_dir / "people_db.dat")
    try:
        reader.file.seek(offset)
        rows = read_playing_data_table(reader, header["file_version"])
    finally:
        reader.close()

    return data_dir, header, counts, offset, rows


def write_playing_data_csv(database_dir, output_path):
    data_dir, header, counts, offset, rows = read_playing_data_from_database(database_dir)
    fields = ["id", "unique_id", *PLAYING_DATA_FIELDS]
    if header["file_version"] >= 145:
        fields.append("unknown")

    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row_id in sorted(rows):
            row = rows[row_id]
            writer.writerow({field: row.get(field, "") for field in fields})

    return {
        "data_dir": str(data_dir),
        "header": header,
        "counts": counts,
        "playing_data_offset": offset,
        "playing_data_rows": len(rows),
        "output": str(output),
    }


def playing_data_summary(database_dir):
    data_dir, header, counts, offset, rows = read_playing_data_from_database(database_dir)
    sample_ids = sorted(rows)[:3]
    return {
        "data_dir": str(data_dir),
        "header": header,
        "counts": counts,
        "playing_data_offset": offset,
        "playing_data_rows": len(rows),
        "sample_rows": {
            str(row_id): {
                key: rows[row_id].get(key)
                for key in [
                    "crossing",
                    "dribbling",
                    "finishing",
                    "passing",
                    "technique",
                    "flair",
                    "acceleration",
                    "pace",
                    "stamina",
                    "determination",
                ]
            }
            for row_id in sample_ids
        },
    }


def probe(database_dir):
    data_dir = find_data_dir(database_dir)
    people_path = data_dir / "people_db.dat"
    if not people_path.exists():
        raise FileNotFoundError(people_path)

    reader = Reader(people_path)
    try:
        header = read_header(reader)
        file_version = header["file_version"]
        people_table = read_people_table(reader, file_version)
        person_data = read_person_data_table(reader)
        playing_data = read_playing_data_table(reader, file_version)
        nonplaying_data_count = read_nonplaying_data_table(reader)
        last_count = reader.i32()
    finally:
        reader.close()

    players = [person for person in people_table["people"] if person["is_player"]]
    linked_players = [
        person
        for person in players
        if person.get("player", {}).get("playing_data_id") in playing_data
    ]
    high_ca = sorted(
        linked_players,
        key=lambda item: item["player"]["current_ability"],
        reverse=True,
    )[:10]

    return {
        "data_dir": str(data_dir),
        "header": header,
        "people_total_rows": people_table["total_rows"],
        "people_active_rows": people_table["active_rows"],
        "people_retired_rows": people_table["retired_rows"],
        "players": len(players),
        "players_with_playing_data": len(linked_players),
        "person_data_rows": len(person_data),
        "playing_data_rows": len(playing_data),
        "nonplaying_data_rows": nonplaying_data_count,
        "last_count": last_count,
        "top_players_by_ca": [
            {
                "id": person["id"],
                "unique_id": person["unique_id"],
                "name_ids": [
                    person["first_name_id"],
                    person["second_name_id"],
                    person["common_name_id"],
                ],
                "nation_id": person["nation_id"],
                "club_team_id": person["club_team_id"],
                "current_ability": person["player"]["current_ability"],
                "potential_ability": person["player"]["potential_ability"],
                "playing_data_id": person["player"]["playing_data_id"],
                "sample_attributes": {
                    key: playing_data[person["player"]["playing_data_id"]][key]
                    for key in [
                        "finishing",
                        "passing",
                        "technique",
                        "flair",
                        "acceleration",
                        "pace",
                        "stamina",
                    ]
                },
            }
            for person in high_ca
        ],
    }


def write_players_csv(database_dir, output_path):
    data = probe(database_dir)
    data_dir = find_data_dir(database_dir)
    people_path = data_dir / "people_db.dat"
    reader = Reader(people_path)
    try:
        header = read_header(reader)
        file_version = header["file_version"]
        people_table = read_people_table(reader, file_version)
        person_data = read_person_data_table(reader)
        playing_data = read_playing_data_table(reader, file_version)
    finally:
        reader.close()

    fields = [
        "id",
        "unique_id",
        "person_type",
        "first_name_id",
        "second_name_id",
        "common_name_id",
        "nation_id",
        "club_team_id",
        "person_data_id",
        "playing_data_id",
        "current_ability",
        "potential_ability",
        "home_reputation",
        "current_reputation",
        "world_reputation",
        "estimated_value",
        "wage",
        "squad_number",
        *PERSON_DATA_FIELDS,
        *PLAYING_DATA_FIELDS,
    ]
    if file_version >= 145:
        fields.append("unknown")

    output = Path(output_path)
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for person in people_table["people"]:
            if not person["is_player"]:
                continue
            player = person["player"]
            playing = playing_data.get(player["playing_data_id"], {})
            hidden = person_data.get(person["person_data_id"], {})
            club_contract = next(
                (contract for contract in person["contracts"] if not contract["is_national_team"]),
                {},
            )
            row = {
                "id": person["id"],
                "unique_id": person["unique_id"],
                "person_type": person["person_type"],
                "first_name_id": person["first_name_id"],
                "second_name_id": person["second_name_id"],
                "common_name_id": person["common_name_id"],
                "nation_id": person["nation_id"],
                "club_team_id": person["club_team_id"],
                "person_data_id": person["person_data_id"],
                "playing_data_id": player["playing_data_id"],
                "current_ability": player["current_ability"],
                "potential_ability": player["potential_ability"],
                "home_reputation": player["home_reputation"],
                "current_reputation": player["current_reputation"],
                "world_reputation": player["world_reputation"],
                "estimated_value": player["estimated_value"],
                "wage": club_contract.get("estimated_wage", 0),
                "squad_number": club_contract.get("squad_number", -1),
            }
            row.update({field: hidden.get(field, "") for field in PERSON_DATA_FIELDS})
            row.update({field: playing.get(field, "") for field in PLAYING_DATA_FIELDS})
            if file_version >= 145:
                row["unknown"] = playing.get("unknown", "")
            writer.writerow(row)
    return data


def main():
    parser = argparse.ArgumentParser(description="Probe CM 02/03 and CM 03/04 people_db.dat directly.")
    parser.add_argument("database_dir")
    parser.add_argument("--players-csv")
    parser.add_argument("--max-people", type=int)
    parser.add_argument("--playing-data-summary", action="store_true")
    parser.add_argument("--playing-data-csv")
    args = parser.parse_args()

    if args.playing_data_csv:
        summary = write_playing_data_csv(args.database_dir, args.playing_data_csv)
    elif args.playing_data_summary:
        summary = playing_data_summary(args.database_dir)
    elif args.max_people is not None:
        data_dir = find_data_dir(args.database_dir)
        reader = Reader(data_dir / "people_db.dat")
        try:
            header = read_header(reader)
            people_table = read_people_table(reader, header["file_version"], args.max_people)
            summary = {
                "data_dir": str(data_dir),
                "header": header,
                "people_total_rows": people_table["total_rows"],
                "people_rows_read": people_table["active_rows"],
                "retired_rows_read": people_table["retired_rows"],
                "position_after_people_subset": reader.pos,
                "players_read": sum(1 for person in people_table["people"] if person["is_player"]),
            }
        finally:
            reader.close()
    elif args.players_csv:
        summary = write_players_csv(args.database_dir, args.players_csv)
    else:
        summary = probe(args.database_dir)
    print(json.dumps(summary, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    main()
