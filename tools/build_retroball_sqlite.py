import csv
import json
import sqlite3
import unicodedata
import zipfile
from datetime import date, timedelta
from pathlib import Path

from cm4_direct_probe import read_playing_data_from_database

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data" / "converted"
DB_PATH = ROOT / "db" / "retroball.sqlite"

APP_CORE_ZIPS = [
    "cm9697_vanilla_app_core.zip",
    "cm9798_vanilla_app_core.zip",
    "cm9899_vanilla_app_core.zip",
    "cm9900_vanilla_app_core.zip",
    "cm0001_vanilla_app_core.zip",
    "cm0102_vanilla_app_core_v2.zip",
    "cm0203_0304_people_unlocked_app_core.zip",
]

HISTORY_ZIPS = [
    "cm0203_project_import_pack.zip",
    "cm0304_converted_export.zip",
]

DATABASE_LABELS = {
    "cm9697_vanilla_original": "Championship Manager 96/97",
    "cm9798_vanilla_original": "Championship Manager 97/98",
    "cm9899_vanilla_original": "Championship Manager 3 98/99",
    "cm9900_vanilla_original": "Championship Manager 99/00",
    "cm0001_vanilla_original": "Championship Manager 00/01",
    "cm0102_vanilla_original": "Championship Manager 01/02",
    "cm0203_vanilla_original": "Championship Manager 02/03",
    "cm0304_vanilla_original": "Championship Manager 03/04",
}

DATABASE_SLUG_ALIASES = {
    "cm0203": "cm0203_vanilla_original",
    "cm0304": "cm0304_vanilla_original",
}

COMMON_NAME_SCRUB_SLUGS = {
    "cm9899_vanilla_original",
    "cm9900_vanilla_original",
    "cm0001_vanilla_original",
}

CM4_DIRECT_DATABASE_DIRS = {
    "cm0203": ROOT / "02-03 dat",
    "cm0304": ROOT / "03-04 dat",
}

MODERN_POSITION_FIELDS = [
    ("goalkeeper", "Goalkeeper"),
    ("sweeper", "Sweeper"),
    ("defender", "Defender"),
    ("defensive_midfielder", "Def Midfielder"),
    ("midfielder", "Midfielder"),
    ("attacking_midfielder", "Att Midfielder"),
    ("attacker", "Attacker"),
    ("wing_back", "Wing back"),
]

MODERN_SIDE_FIELDS = [
    ("right_side", "Right side"),
    ("left_side", "Left side"),
    ("central", "Central"),
    ("free_role", "Free role"),
]

MODERN_ATTRIBUTE_FIELDS = [
    ("acceleration", "Acceleration"),
    ("aggression", "Aggression"),
    ("agility", "Agility"),
    ("anticipation", "Anticipation"),
    ("balance", "Balance"),
    ("bravery", "Bravery"),
    ("consistency", "Consistency"),
    ("corners", "Corners"),
    ("crossing", "Crossing"),
    ("decisions", "Decisions"),
    ("dirtiness", "Dirtiness"),
    ("dribbling", "Dribbling"),
    ("finishing", "Finishing"),
    ("flair", "Flair"),
    ("free_kicks", "Free Kicks"),
    ("handling", "Handling"),
    ("heading", "Heading"),
    ("important_matches", "Important Matches"),
    ("injury_proneness", "Injury Proneness"),
    ("jumping", "Jumping"),
    ("leadership", "Leadership"),
    ("left_foot", "Left Foot"),
    ("long_shots", "Long Shots"),
    ("marking", "Marking"),
    ("movement", "Off the Ball"),
    ("natural_fitness", "Natural Fitness"),
    ("one_on_ones", "One On Ones"),
    ("pace", "Pace"),
    ("passing", "Passing"),
    ("penalties", "Penalties"),
    ("positioning", "Positioning"),
    ("reflexes", "Reflexes"),
    ("right_foot", "Right Foot"),
    ("stamina", "Stamina"),
    ("strength", "Strength"),
    ("tackling", "Tackling"),
    ("teamwork", "Teamwork"),
    ("technique", "Technique"),
    ("throw_ins", "Throw Ins"),
    ("versatility", "Versatility"),
    ("vision", "Vision"),
    ("work_rate", "Work Rate"),
]

MODERN_HIDDEN_ATTRIBUTE_FIELDS = [
    ("adaptability", "Adaptability"),
    ("ambition", "Ambition"),
    ("consistency", "Consistency"),
    ("dirtiness", "Dirtiness"),
    ("determination", "Determination"),
    ("important_matches", "Important Matches"),
    ("injury_proneness", "Injury Proneness"),
    ("loyalty", "Loyalty"),
    ("pressure", "Pressure"),
    ("professionalism", "Professionalism"),
    ("sportsmanship", "Sportsmanship"),
    ("temperament", "Temperament"),
    ("versatility", "Versatility"),
]

CM4_ATTRIBUTE_FIELDS = [
    ("corners", "Corners"),
    ("crossing", "Crossing"),
    ("dribbling", "Dribbling"),
    ("finishing", "Finishing"),
    ("first_touch", "First Touch"),
    ("set_pieces", "Free Kicks"),
    ("heading", "Heading"),
    ("long_shots", "Long Shots"),
    ("marking", "Marking"),
    ("passing", "Passing"),
    ("penalties", "Penalties"),
    ("tackling", "Tackling"),
    ("technique", "Technique"),
    ("throw_ins", "Throw Ins"),
    ("long_throws", "Long Throws"),
    ("aggression", "Aggression"),
    ("anticipation", "Anticipation"),
    ("bravery", "Bravery"),
    ("consistency", "Consistency"),
    ("creativity", "Vision"),
    ("decisions", "Decisions"),
    ("determination", "Determination"),
    ("dirtiness", "Dirtiness"),
    ("flair", "Flair"),
    ("important_matches", "Important Matches"),
    ("influence", "Leadership"),
    ("off_the_ball", "Off the Ball"),
    ("positioning", "Positioning"),
    ("teamwork", "Teamwork"),
    ("work_rate", "Work Rate"),
    ("acceleration", "Acceleration"),
    ("agility", "Agility"),
    ("balance", "Balance"),
    ("handling", "Handling"),
    ("injury_proneness", "Injury Proneness"),
    ("jumping", "Jumping"),
    ("natural_fitness", "Natural Fitness"),
    ("one_on_ones", "One On Ones"),
    ("pace", "Pace"),
    ("reflexes", "Reflexes"),
    ("stamina", "Stamina"),
    ("strength", "Strength"),
    ("aerial_ability", "Aerial Ability"),
    ("command_of_area", "Command Of Area"),
    ("communication", "Communication"),
    ("eccentricity", "Eccentricity"),
    ("kicking", "Kicking"),
    ("rushing_out", "Rushing Out"),
    ("tendency_to_punch", "Tendency To Punch"),
    ("throwing", "Throwing"),
    ("left_foot", "Left Foot"),
    ("right_foot", "Right Foot"),
    ("versatility", "Versatility"),
]

CM4_HIDDEN_ATTRIBUTE_FIELDS = [
    ("consistency", "Consistency"),
    ("dirtiness", "Dirtiness"),
    ("determination", "Determination"),
    ("important_matches", "Important Matches"),
    ("injury_proneness", "Injury Proneness"),
    ("versatility", "Versatility"),
]

LEGACY_POSITION_FIELDS = [
    ("goalkeeper", "Goalkeeper"),
    ("sweeper", "Sweeper"),
    ("defence", "Defender"),
    ("anchor", "Def Midfielder"),
    ("midfield", "Midfielder"),
    ("support", "Att Midfielder"),
    ("attack", "Attacker"),
]

LEGACY_SIDE_FIELDS = [
    ("right_sided", "Right side"),
    ("left_sided", "Left side"),
    ("central", "Central"),
]

LEGACY_ATTRIBUTE_FIELDS = [
    ("adaptability", "Adaptability"),
    ("aggression", "Aggression"),
    ("big_occasion", "Important Matches"),
    ("character", "Character"),
    ("consistency", "Consistency"),
    ("creativity", "Vision"),
    ("determination", "Determination"),
    ("dirtyness", "Dirtiness"),
    ("dribbling", "Dribbling"),
    ("flair", "Flair"),
    ("heading", "Heading"),
    ("influence", "Leadership"),
    ("inj_prone", "Injury Proneness"),
    ("intelligence", "Decisions"),
    ("marking", "Marking"),
    ("off_the_ball", "Off the Ball"),
    ("pace", "Pace"),
    ("passing", "Passing"),
    ("positioning", "Positioning"),
    ("set_pieces", "Set Pieces"),
    ("shooting", "Shooting"),
    ("stamina", "Stamina"),
    ("strength", "Strength"),
    ("tackling", "Tackling"),
    ("technique", "Technique"),
]

LEGACY_HIDDEN_ATTRIBUTE_FIELDS = [
    ("adaptability", "Adaptability"),
    ("ambition", "Ambition"),
    ("big_occasion", "Important Matches"),
    ("character", "Character"),
    ("consistency", "Consistency"),
    ("determination", "Determination"),
    ("dirtyness", "Dirtiness"),
    ("inj_prone", "Injury Proneness"),
    ("loyalty", "Loyalty"),
    ("pressure", "Pressure"),
    ("professionalism", "Professionalism"),
    ("sportsmanship", "Sportsmanship"),
    ("temperament", "Temperament"),
]

FOOT_FIELDS = [
    ("left_foot", "Left Foot"),
    ("right_foot", "Right Foot"),
]


def read_csv_from_zip(zip_path: Path, wanted_name: str):
    if not zip_path.exists():
        print(f"Missing ZIP: {zip_path.name}")
        return []

    rows = []

    with zipfile.ZipFile(zip_path) as z:
        matches = [
            name for name in z.namelist()
            if name.endswith("/" + wanted_name) or name == wanted_name
        ]

        for name in matches:
            with z.open(name) as f:
                text = f.read().decode("utf-8-sig", errors="replace").splitlines()
                rows.extend(list(csv.DictReader(text)))

    return rows


def as_int(value):
    try:
        if value in (None, ""):
            return None
        return int(float(value))
    except Exception:
        return None


def normalize_potential_ability(database_slug, value):
    potential_ability = as_int(value)
    if database_slug in {
        "cm9697_vanilla_original",
        "cm9798_vanilla_original",
    }:
        return {126: -2, 127: -1}.get(potential_ability, potential_ability)
    return potential_ability


def pick(row, *names):
    for name in names:
        value = row.get(name)
        if value not in (None, ""):
            return value
    return None


def cm4_date_from_row(row):
    year = as_int(pick(row, "dob_year"))
    day_of_year = as_int(pick(row, "dob_days"))
    if year and day_of_year is not None:
        try:
            return (date(year, 1, 1) + timedelta(days=day_of_year)).isoformat()
        except ValueError:
            return None

    return pick(row, "date_of_birth", "birth_date")


def normalize_search_text(value):
    return " ".join(
        "".join(
            char for char in unicodedata.normalize("NFKD", str(value or ""))
            if not unicodedata.combining(char)
        )
        .lower()
        .replace("/", " ")
        .replace("-", " ")
        .split()
    )


def search_terms(value):
    return sorted({token for token in normalize_search_text(value).split() if len(token) >= 2})


def canonical_database_slug(value):
    slug = value or "unknown"
    return DATABASE_SLUG_ALIASES.get(slug, slug)


def normalized_tokens(value):
    return set(normalize_search_text(value).split())


def common_name_is_suspicious(database_slug, full_name, common_name):
    if database_slug not in COMMON_NAME_SCRUB_SLUGS or not common_name:
        return False

    full_tokens = normalized_tokens(full_name)
    common_tokens = normalized_tokens(common_name)

    return len(common_tokens) > 1 and full_tokens and full_tokens.isdisjoint(common_tokens)


def sanitize_names(database_slug, row):
    full_name = pick(row, "full_name", "display_name")
    display_name = pick(row, "display_name", "full_name")
    common_name = pick(row, "common_name")

    if common_name_is_suspicious(database_slug, full_name, common_name):
        if display_name == common_name:
            display_name = full_name
        common_name = None

    return full_name, display_name, common_name


def normalize_player_search(row):
    database_slug = canonical_database_slug(pick(row, "database_slug"))

    source_person_id = pick(
        row,
        "person_id",
        "staff_id",
        "row_id",
        "unique_id",
        "player_id",
        "source_player_id",
    )

    full_name, display_name, common_name = sanitize_names(database_slug, row)

    club_name = pick(row, "club_name", "current_club")
    nation_name = pick(row, "nation_name", "nation")

    ca = pick(row, "current_ability", "ability")
    pa = pick(row, "potential_ability", "potential")

    search_blob = " ".join(
        str(x or "")
        for x in [
            full_name,
            display_name,
            common_name,
            club_name,
            nation_name,
            pick(row, "position_text"),
            ca,
            pa,
        ]
    )

    return {
        "database_slug": database_slug,
        "source_person_id": str(source_person_id or ""),
        "display_name": display_name,
        "full_name": full_name,
        "common_name": common_name,
        "club_id": pick(row, "club_id", "team_id"),
        "club_name": club_name,
        "nation_id": pick(row, "nation_id"),
        "nation_name": nation_name,
        "date_of_birth": cm4_date_from_row(row),
        "age": as_int(pick(row, "age")),
        "position_text": pick(row, "position_text"),
        "current_ability": as_int(ca),
        "potential_ability": normalize_potential_ability(database_slug, pa),
        "value": as_int(pick(row, "value", "estimated_value")),
        "wage": as_int(pick(row, "wage")),
        "person_history_index": as_int(pick(row, "person_history_index")),
        "search_blob": search_blob,
        "normalized_search_blob": normalize_search_text(search_blob),
        "raw_json": json.dumps(row, ensure_ascii=False),
    }


def ratings_from(row, mappings):
    ratings = []

    for field, label in mappings:
        value = as_int(pick(row, field))

        if value is not None:
            ratings.append({"label": label, "value": value})

    return ratings


def json_ratings(row, mappings):
    return json.dumps(ratings_from(row, mappings), ensure_ascii=False)


def profile_payload(row, ratings, extra=None):
    payload = {
        "club_id": pick(row, "club_id", "team_id"),
        "club_name": pick(row, "club_name", "current_club"),
        "nation_id": pick(row, "nation_id"),
        "nation_name": pick(row, "nation_name", "nation"),
        "date_of_birth": cm4_date_from_row(row),
        "age": as_int(pick(row, "age")),
        "position_text": pick(row, "position_text"),
        "value": ratings.get("value"),
        "wage": ratings.get("wage"),
        "ratings": ratings,
    }
    if extra:
        payload.update(extra)
    return payload


def normalize_player_profile(row):
    database_slug = canonical_database_slug(pick(row, "database_slug"))
    source_person_id = pick(
        row,
        "person_id",
        "staff_id",
        "unique_id",
        "row_id",
        "player_id",
        "source_player_id",
        "id",
    )
    source_player_id = pick(row, "player_id", "id", "row_id", "unique_id")
    current_ability = as_int(pick(row, "current_ability", "ability"))
    potential_ability = normalize_potential_ability(
        database_slug,
        pick(row, "potential_ability", "potential"),
    )
    full_name, display_name, common_name = sanitize_names(database_slug, row)

    if "current_ability" in row or "defender" in row:
        position_fields = MODERN_POSITION_FIELDS
        side_fields = MODERN_SIDE_FIELDS
        attribute_fields = MODERN_ATTRIBUTE_FIELDS
        hidden_attribute_fields = MODERN_HIDDEN_ATTRIBUTE_FIELDS
    else:
        position_fields = LEGACY_POSITION_FIELDS
        side_fields = LEGACY_SIDE_FIELDS
        attribute_fields = LEGACY_ATTRIBUTE_FIELDS
        hidden_attribute_fields = LEGACY_HIDDEN_ATTRIBUTE_FIELDS

    ratings = {
        "squad_number": as_int(pick(row, "squad_number")),
        "current_ability": current_ability,
        "potential_ability": potential_ability,
        "home_reputation": as_int(pick(row, "home_reputation", "reputation")),
        "current_reputation": as_int(pick(row, "current_reputation", "reputation")),
        "world_reputation": as_int(pick(row, "world_reputation", "reputation")),
        "caps": as_int(pick(row, "caps", "international_apps")),
        "international_goals": as_int(pick(row, "goals", "international_goals")),
        "value": as_int(pick(row, "value", "estimated_value")),
        "wage": as_int(pick(row, "wage")),
    }
    positions = ratings_from(row, position_fields)
    sides = ratings_from(row, side_fields)
    foot = ratings_from(row, FOOT_FIELDS)
    profile = profile_payload(row, ratings, {
        "positions": positions,
        "sides": sides,
        "foot": foot,
    })

    return {
        "database_slug": database_slug,
        "source_person_id": str(source_person_id or ""),
        "source_player_id": str(source_player_id or ""),
        "display_name": display_name,
        "full_name": full_name,
        "common_name": common_name,
        "club_id": pick(row, "club_id", "team_id"),
        "club_name": pick(row, "club_name", "current_club"),
        "nation_id": pick(row, "nation_id"),
        "nation_name": pick(row, "nation_name", "nation"),
        "date_of_birth": cm4_date_from_row(row),
        "age": as_int(pick(row, "age")),
        "position_text": pick(row, "position_text"),
        "current_ability": current_ability,
        "potential_ability": potential_ability,
        "home_reputation": ratings["home_reputation"],
        "current_reputation": ratings["current_reputation"],
        "world_reputation": ratings["world_reputation"],
        "caps": ratings["caps"],
        "international_goals": ratings["international_goals"],
        "squad_number": ratings["squad_number"],
        "value": ratings["value"],
        "wage": ratings["wage"],
        "attributes_json": json_ratings(row, attribute_fields),
        "hidden_attributes_json": json_ratings(row, hidden_attribute_fields),
        "position_ratings_json": json.dumps(positions + sides, ensure_ascii=False),
        "foot_json": json.dumps(foot, ensure_ascii=False),
        "profile_json": json.dumps(profile, ensure_ascii=False),
        "raw_json": json.dumps(row, ensure_ascii=False),
    }


def load_cm4_playing_data(raw_database_slug):
    database_path = CM4_DIRECT_DATABASE_DIRS.get(raw_database_slug)
    if not database_path or not database_path.exists():
        return {}

    _, _, _, _, rows = read_playing_data_from_database(database_path)
    return rows


def normalize_cm4_player_profile(row, playing_data_rows):
    raw_database_slug = pick(row, "database_slug")
    database_slug = canonical_database_slug(raw_database_slug)
    playing_data_id = as_int(pick(row, "playing_data_id"))
    playing_data = playing_data_rows.get(playing_data_id, {}) if playing_data_id is not None else {}
    source_person_id = pick(
        row,
        "person_id",
        "staff_id",
        "unique_id",
        "row_id",
        "player_id",
        "source_player_id",
        "id",
    )
    current_ability = as_int(pick(row, "current_ability", "ability"))
    potential_ability = as_int(pick(row, "potential_ability", "potential"))
    full_name, display_name, common_name = sanitize_names(database_slug, row)

    ratings = {
        "squad_number": as_int(pick(row, "squad_number")),
        "current_ability": current_ability,
        "potential_ability": potential_ability,
        "home_reputation": as_int(pick(row, "home_reputation", "reputation")),
        "current_reputation": as_int(pick(row, "current_reputation", "reputation")),
        "world_reputation": as_int(pick(row, "world_reputation", "reputation")),
        "caps": as_int(pick(row, "caps", "international_apps")),
        "international_goals": as_int(pick(row, "goals", "international_goals")),
        "value": as_int(pick(row, "value", "estimated_value")),
        "wage": as_int(pick(row, "wage")),
    }
    positions = ratings_from(playing_data, MODERN_POSITION_FIELDS)
    sides = ratings_from(playing_data, MODERN_SIDE_FIELDS)
    foot = ratings_from(playing_data, FOOT_FIELDS)
    profile = profile_payload(row, ratings, {
        "playing_data_id": playing_data_id,
        "positions": positions,
        "sides": sides,
        "foot": foot,
    })
    raw_payload = {"player": row, "playing_data": playing_data}

    return {
        "database_slug": database_slug,
        "source_person_id": str(source_person_id or ""),
        "source_player_id": str(playing_data_id if playing_data_id is not None else ""),
        "display_name": display_name,
        "full_name": full_name,
        "common_name": common_name,
        "club_id": pick(row, "club_id", "team_id"),
        "club_name": pick(row, "club_name", "current_club"),
        "nation_id": pick(row, "nation_id"),
        "nation_name": pick(row, "nation_name", "nation"),
        "date_of_birth": cm4_date_from_row(row),
        "age": as_int(pick(row, "age")),
        "position_text": pick(row, "position_text"),
        "current_ability": current_ability,
        "potential_ability": potential_ability,
        "home_reputation": ratings["home_reputation"],
        "current_reputation": ratings["current_reputation"],
        "world_reputation": ratings["world_reputation"],
        "caps": ratings["caps"],
        "international_goals": ratings["international_goals"],
        "squad_number": ratings["squad_number"],
        "value": ratings["value"],
        "wage": ratings["wage"],
        "attributes_json": json_ratings(playing_data, CM4_ATTRIBUTE_FIELDS),
        "hidden_attributes_json": json_ratings(playing_data, CM4_HIDDEN_ATTRIBUTE_FIELDS),
        "position_ratings_json": json.dumps(positions + sides, ensure_ascii=False),
        "foot_json": json.dumps(foot, ensure_ascii=False),
        "profile_json": json.dumps(profile, ensure_ascii=False),
        "raw_json": json.dumps(raw_payload, ensure_ascii=False),
    }


def normalize_club(row):
    database_slug = canonical_database_slug(pick(row, "database_slug"))
    return {
        "database_slug": database_slug,
        "source_club_id": str(pick(row, "id", "unique_id", "original_club_id", "row_id") or ""),
        "name": pick(row, "name", "club_name"),
        "short_name": pick(row, "short_name"),
        "nation_name": pick(row, "nation_name", "nation"),
        "stadium_name": pick(row, "stadium_name"),
        "reputation": as_int(pick(row, "reputation")),
        "raw_json": json.dumps(row, ensure_ascii=False),
    }


def normalize_nation(row):
    database_slug = canonical_database_slug(pick(row, "database_slug"))
    return {
        "database_slug": database_slug,
        "source_nation_id": str(pick(row, "id", "unique_id", "original_nation_id", "row_id") or ""),
        "name": pick(row, "name", "nation"),
        "short_name": pick(row, "short_name"),
        "nationality": pick(row, "nationality"),
        "continent_name": pick(row, "continent_name"),
        "raw_json": json.dumps(row, ensure_ascii=False),
    }


def normalize_staff_history(row, history_index_to_person=None):
    database_slug = canonical_database_slug(pick(row, "database_slug") or (
        "cm0304" if pick(row, "person_key") is not None else None
    ))
    source_person_id = pick(row, "staff_id")
    if not source_person_id and history_index_to_person:
        history_id = as_int(pick(row, "history_list_id", "history_index", "person_history_index"))
        source_person_id = history_index_to_person.get((database_slug, history_id))

    return {
        "database_slug": database_slug,
        "source_person_id": str(source_person_id or ""),
        "season_year": as_int(pick(row, "year")),
        "club_id": str(pick(row, "club_id", "club_id_raw") or ""),
        "club_name": pick(row, "club_name"),
        "league_name": pick(row, "league_name", "division_name"),
        "apps": as_int(pick(row, "apps", "league_apps")),
        "goals": as_int(pick(row, "goals", "league_goals")),
        "on_loan": as_int(pick(row, "on_loan_raw", "unknown_byte")),
        "source_table": "staff_history",
        "raw_json": json.dumps(row, ensure_ascii=False),
    }


def create_schema(conn):
    conn.executescript("""
    PRAGMA journal_mode = WAL;

    DROP TABLE IF EXISTS cm_databases;
    DROP TABLE IF EXISTS player_search;
    DROP VIEW IF EXISTS player_profiles;
    DROP TABLE IF EXISTS player_profiles;
    DROP TABLE IF EXISTS player_profile;
    DROP TABLE IF EXISTS player_search_terms;
    DROP TABLE IF EXISTS clubs;
    DROP TABLE IF EXISTS nations;
    DROP TABLE IF EXISTS person_history;
    DROP TABLE IF EXISTS player_search_fts;

    CREATE TABLE cm_databases (
      slug TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      season_order INTEGER,
      status TEXT NOT NULL DEFAULT 'converted'
    );

    CREATE TABLE player_search (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      database_slug TEXT NOT NULL,
      source_person_id TEXT NOT NULL,
      display_name TEXT,
      full_name TEXT,
      common_name TEXT,
      club_id TEXT,
      club_name TEXT,
      nation_id TEXT,
      nation_name TEXT,
      date_of_birth TEXT,
      age INTEGER,
      position_text TEXT,
      current_ability INTEGER,
      potential_ability INTEGER,
      value INTEGER,
      wage INTEGER,
      person_history_index INTEGER,
      search_blob TEXT,
      normalized_search_blob TEXT,
      raw_json TEXT
    );

    CREATE TABLE clubs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      database_slug TEXT NOT NULL,
      source_club_id TEXT,
      name TEXT,
      short_name TEXT,
      nation_name TEXT,
      stadium_name TEXT,
      reputation INTEGER,
      raw_json TEXT
    );

    CREATE TABLE player_profile (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      database_slug TEXT NOT NULL,
      source_person_id TEXT NOT NULL,
      source_player_id TEXT,
      display_name TEXT,
      full_name TEXT,
      common_name TEXT,
      club_id TEXT,
      club_name TEXT,
      nation_id TEXT,
      nation_name TEXT,
      date_of_birth TEXT,
      age INTEGER,
      position_text TEXT,
      current_ability INTEGER,
      potential_ability INTEGER,
      home_reputation INTEGER,
      current_reputation INTEGER,
      world_reputation INTEGER,
      caps INTEGER,
      international_goals INTEGER,
      squad_number INTEGER,
      value INTEGER,
      wage INTEGER,
      attributes_json TEXT,
      hidden_attributes_json TEXT,
      position_ratings_json TEXT,
      foot_json TEXT,
      profile_json TEXT,
      raw_json TEXT,
      UNIQUE(database_slug, source_person_id)
    );

    CREATE VIEW player_profiles AS
      SELECT
        id,
        database_slug,
        source_person_id,
        source_player_id,
        display_name,
        full_name,
        common_name,
        club_id,
        club_name,
        nation_id,
        nation_name,
        date_of_birth,
        age,
        position_text,
        current_ability,
        potential_ability,
        profile_json AS ratings_json,
        position_ratings_json AS positions_json,
        '[]' AS sides_json,
        attributes_json,
        raw_json
      FROM player_profile;

    CREATE TABLE player_search_terms (
      database_slug TEXT NOT NULL,
      term TEXT NOT NULL,
      player_search_id INTEGER NOT NULL
    );

    CREATE TABLE nations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      database_slug TEXT NOT NULL,
      source_nation_id TEXT,
      name TEXT,
      short_name TEXT,
      nationality TEXT,
      continent_name TEXT,
      raw_json TEXT
    );

    CREATE TABLE person_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      database_slug TEXT NOT NULL,
      source_person_id TEXT,
      season_year INTEGER,
      club_id TEXT,
      club_name TEXT,
      league_name TEXT,
      apps INTEGER,
      goals INTEGER,
      on_loan INTEGER,
      source_table TEXT,
      raw_json TEXT
    );

    CREATE INDEX idx_player_search_db ON player_search(database_slug);
    CREATE INDEX idx_player_search_player ON player_search(database_slug, source_person_id);
    CREATE INDEX idx_player_search_name ON player_search(database_slug, full_name COLLATE NOCASE);
    CREATE INDEX idx_player_search_club ON player_search(database_slug, club_name);
    CREATE INDEX idx_player_search_nation ON player_search(database_slug, nation_name);
    CREATE INDEX idx_player_search_normalized ON player_search(database_slug, normalized_search_blob);
    CREATE INDEX idx_player_profile_lookup ON player_profile(database_slug, source_person_id);
    CREATE INDEX idx_player_search_terms_lookup ON player_search_terms(database_slug, term, player_search_id);
    CREATE INDEX idx_person_history_lookup ON person_history(database_slug, source_person_id);
    CREATE INDEX idx_person_history_order ON person_history(database_slug, source_person_id, season_year);
    CREATE INDEX idx_clubs_db_name ON clubs(database_slug, name);
    CREATE INDEX idx_nations_db_name ON nations(database_slug, name);

    CREATE VIRTUAL TABLE player_search_fts USING fts5(
      database_slug UNINDEXED,
      full_name,
      display_name,
      club_name,
      nation_name,
      position_text,
      search_blob,
      content='player_search',
      content_rowid='id'
    );
    """)


def insert_rows(conn, table, rows):
    rows = [row for row in rows if row]
    if not rows:
        return

    keys = list(rows[0].keys())
    sql = f"""
      INSERT INTO {table} ({", ".join(keys)})
      VALUES ({", ".join(["?"] * len(keys))})
    """

    conn.executemany(sql, [[row.get(key) for key in keys] for row in rows])


def insert_player_search_terms(conn):
    batch = []

    for row_id, database_slug, normalized_blob in conn.execute(
        "SELECT id, database_slug, normalized_search_blob FROM player_search"
    ):
        for term in search_terms(normalized_blob):
            batch.append((database_slug, term, row_id))

        if len(batch) >= 100_000:
            conn.executemany(
                """
                  INSERT INTO player_search_terms (database_slug, term, player_search_id)
                  VALUES (?, ?, ?)
                """,
                batch,
            )
            batch.clear()

    if batch:
        conn.executemany(
            """
              INSERT INTO player_search_terms (database_slug, term, player_search_id)
              VALUES (?, ?, ?)
            """,
            batch,
        )


def profile_richness(row):
    return sum(
        len(str(row.get(field) or ""))
        for field in [
            "attributes_json",
            "hidden_attributes_json",
            "position_ratings_json",
            "foot_json",
            "profile_json",
            "raw_json",
        ]
    )


def dedupe_player_profiles(rows):
    best = {}

    for row in rows:
        key = (row.get("database_slug"), row.get("source_person_id"))
        if not key[0] or not key[1]:
            continue

        previous = best.get(key)
        if previous is None or profile_richness(row) > profile_richness(previous):
            best[key] = row

    return list(best.values())


def main():
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    if DB_PATH.exists():
        DB_PATH.unlink()

    conn = sqlite3.connect(DB_PATH)
    create_schema(conn)

    db_rows = [
        {
            "slug": slug,
            "title": title,
            "season_order": index,
            "status": "converted",
        }
        for index, (slug, title) in enumerate(DATABASE_LABELS.items(), start=1)
    ]

    insert_rows(conn, "cm_databases", db_rows)

    all_player_search = []
    all_player_profiles = []
    all_clubs = []
    all_nations = []
    all_history = []
    history_index_to_person = {}

    for zip_name in APP_CORE_ZIPS:
        zip_path = DATA_DIR / zip_name

        player_rows = read_csv_from_zip(zip_path, "player_search.csv")
        player_rows += read_csv_from_zip(zip_path, "player_search_unlocked.csv")
        all_player_search.extend(normalize_player_search(row) for row in player_rows)

        for row in player_rows:
            database_slug = canonical_database_slug(pick(row, "database_slug"))
            history_index = as_int(pick(row, "person_history_index"))
            source_person_id = pick(
                row,
                "person_id",
                "staff_id",
                "row_id",
                "unique_id",
                "player_id",
                "source_player_id",
            )
            if history_index is not None and history_index >= 0 and source_person_id:
                history_index_to_person[(database_slug, history_index)] = str(source_person_id)

        cm4_player_rows_by_slug = {}
        for row in player_rows:
            raw_database_slug = pick(row, "database_slug")
            if raw_database_slug in CM4_DIRECT_DATABASE_DIRS:
                cm4_player_rows_by_slug.setdefault(raw_database_slug, []).append(row)

        for raw_database_slug, cm4_player_rows in cm4_player_rows_by_slug.items():
            playing_data_rows = load_cm4_playing_data(raw_database_slug)
            all_player_profiles.extend(
                normalize_cm4_player_profile(row, playing_data_rows)
                for row in cm4_player_rows
            )

        staff_rows = read_csv_from_zip(zip_path, "staff.csv")
        staff_by_player_id = {}
        for row in staff_rows:
            database_slug = canonical_database_slug(pick(row, "database_slug"))
            player_id = pick(row, "player_id")
            if player_id not in (None, "", "-1"):
                staff_by_player_id[(database_slug, str(player_id))] = row

        profile_rows = []
        for row in read_csv_from_zip(zip_path, "players.csv"):
            database_slug = canonical_database_slug(pick(row, "database_slug"))
            player_id = pick(row, "id", "player_id", "source_player_id")
            staff_row = staff_by_player_id.get((database_slug, str(player_id)))
            if staff_row:
                merged = {**staff_row, **row}
                merged["staff_id"] = pick(row, "staff_id") or pick(staff_row, "id")
                profile_rows.append(merged)
            else:
                profile_rows.append(row)

        all_player_profiles.extend(
            normalize_player_profile(row)
            for row in profile_rows
        )

        all_clubs.extend(normalize_club(row) for row in read_csv_from_zip(zip_path, "clubs.csv"))
        all_nations.extend(normalize_nation(row) for row in read_csv_from_zip(zip_path, "nations.csv"))

        all_history.extend(
            normalize_staff_history(row, history_index_to_person)
            for row in read_csv_from_zip(zip_path, "staff_history.csv")
        )

    for zip_name in HISTORY_ZIPS:
        zip_path = DATA_DIR / zip_name
        all_history.extend(
            normalize_staff_history(row, history_index_to_person)
            for row in read_csv_from_zip(zip_path, "player_history_records.csv")
        )

    all_player_profiles = dedupe_player_profiles(all_player_profiles)

    insert_rows(conn, "player_search", all_player_search)
    insert_rows(conn, "player_profile", all_player_profiles)
    insert_player_search_terms(conn)
    insert_rows(conn, "clubs", all_clubs)
    insert_rows(conn, "nations", all_nations)
    insert_rows(conn, "person_history", all_history)

    conn.execute("""
      INSERT INTO player_search_fts(
        rowid,
        database_slug,
        full_name,
        display_name,
        club_name,
        nation_name,
        position_text,
        search_blob
      )
      SELECT
        id,
        database_slug,
        coalesce(full_name, ''),
        coalesce(display_name, ''),
        coalesce(club_name, ''),
        coalesce(nation_name, ''),
        coalesce(position_text, ''),
        coalesce(search_blob, '')
      FROM player_search
    """)

    conn.commit()

    for table in ["cm_databases", "player_search", "player_profile", "player_search_terms", "clubs", "nations", "person_history"]:
        count = conn.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        print(f"{table}: {count:,}")

    conn.close()
    print(f"Created {DB_PATH}")


if __name__ == "__main__":
    main()
