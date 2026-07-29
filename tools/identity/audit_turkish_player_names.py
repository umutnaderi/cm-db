#!/usr/bin/env python3
"""Compare Turkish CM player identities with Wikidata names and birth dates."""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import sqlite3
import time
import unicodedata
import urllib.parse
import urllib.request
from collections import defaultdict
from pathlib import Path

from common import REGISTRY_DB, ROOT


SERVING_DB = ROOT / "data" / "d1" / "retroball-d1.sqlite"
CACHE_PATH = ROOT / "audit" / "wikidata-turkish-footballers.json"
OUTPUT_PATH = ROOT / "audit" / "turkish-player-name-candidates.csv"
OVERRIDES_PATH = (
    ROOT / "config" / "identity" / "player_canonical_name_overrides.csv"
)
COMPONENTS_PATH = (
    ROOT / "config" / "identity" / "player_component_resolutions.csv"
)
USER_AGENT = "RetroballIdentityAudit/1.0 (canonical football player names)"
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


def normalized_tokens(value: str) -> tuple[str, ...]:
    decomposed = unicodedata.normalize("NFKD", value).lower()
    unaccented = "".join(
        character for character in decomposed if not unicodedata.combining(character)
    ).translate(CHARACTER_FOLDS)
    tokens = "".join(
        character if character.isalnum() else " " for character in unaccented
    ).split()
    return tuple(sorted(tokens))


def parse_date(value: str) -> dt.date | None:
    value = (value or "").strip()
    if not value:
        return None
    try:
        return dt.date.fromisoformat(value[:10])
    except ValueError:
        return None


def fetch_reference_players(cache_path: Path, refresh: bool) -> list[dict]:
    if cache_path.is_file() and not refresh:
        return json.loads(cache_path.read_text(encoding="utf-8"))

    query = """
SELECT DISTINCT ?item ?dob ?trLabel ?enLabel WHERE {
  ?item wdt:P106/wdt:P279* wd:Q937857;
        wdt:P27 wd:Q43;
        wdt:P569 ?dob.
  FILTER(YEAR(?dob) >= 1950 && YEAR(?dob) <= 1990)
  OPTIONAL {
    ?item rdfs:label ?trLabel.
    FILTER(LANG(?trLabel) = "tr")
  }
  OPTIONAL {
    ?item rdfs:label ?enLabel.
    FILTER(LANG(?enLabel) = "en")
  }
}
""".strip()
    endpoint = (
        "https://query.wikidata.org/sparql?format=json&query="
        + urllib.parse.quote(query)
    )
    request = urllib.request.Request(endpoint, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(request, timeout=180) as response:
        payload = json.load(response)

    players = []
    for binding in payload["results"]["bindings"]:
        item_url = binding["item"]["value"]
        players.append(
            {
                "wikidata_id": item_url.rsplit("/", 1)[-1],
                "date_of_birth": binding["dob"]["value"][:10],
                "tr_label": binding.get("trLabel", {}).get("value", ""),
                "en_label": binding.get("enLabel", {}).get("value", ""),
            }
        )
    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(
        json.dumps(players, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    return players


def audit(
    registry_path: Path,
    serving_path: Path,
    references: list[dict],
) -> list[dict]:
    reference_index: dict[tuple[str, ...], list[dict]] = defaultdict(list)
    for player in references:
        for label in (player["tr_label"], player["en_label"]):
            tokens = normalized_tokens(label)
            if len(tokens) >= 2:
                reference_index[tokens].append(player)

    serving = sqlite3.connect(
        f"{serving_path.resolve().as_uri()}?mode=ro&immutable=1",
        uri=True,
    )
    serving.row_factory = sqlite3.Row
    ability_by_key = {
        (str(row["database_slug"]), str(row["source_person_id"])): (
            int(row["current_ability"] or 0),
            int(row["potential_ability"] or 0),
        )
        for row in serving.execute(
            """
            SELECT database_slug, source_person_id, current_ability, potential_ability
            FROM player_search
            WHERE nation_name = 'Turkey'
            """
        )
    }
    serving.close()

    connection = sqlite3.connect(
        f"{registry_path.resolve().as_uri()}?mode=ro&immutable=1",
        uri=True,
    )
    connection.row_factory = sqlite3.Row
    components: dict[str, list[sqlite3.Row]] = defaultdict(list)
    for row in connection.execute(
        """
        SELECT
          cast(l.canonical_player_id AS TEXT) AS canonical_player_id,
          c.public_id,
          c.preferred_name,
          s.*
        FROM source_players s
        JOIN player_identity_links l
          ON l.database_slug = s.database_slug
         AND l.source_person_id = s.source_person_id
        JOIN canonical_players c ON c.id = l.canonical_player_id
        WHERE s.active = 1
        ORDER BY l.canonical_player_id, s.database_slug, s.source_person_id
        """
    ):
        components[str(row["canonical_player_id"])].append(row)
    connection.close()

    matched_by_item: dict[str, dict] = {}
    for canonical_id, members in components.items():
        variants = {
            normalized_tokens(str(row[column] or ""))
            for row in members
            for column in ("display_name", "full_name", "common_name")
        }
        variants = {tokens for tokens in variants if len(tokens) >= 2}
        local_dates = {
            parsed
            for row in members
            if (parsed := parse_date(str(row["normalized_date_of_birth"] or "")))
        }
        candidates: dict[str, dict] = {}
        for tokens in variants:
            for player in reference_index.get(tokens, []):
                reference_date = parse_date(player["date_of_birth"])
                if reference_date is None or not local_dates:
                    continue
                distance = min(abs((reference_date - local_date).days) for local_date in local_dates)
                if distance <= 1:
                    candidate = candidates.setdefault(
                        player["wikidata_id"],
                        {**player, "matched_tokens": set(), "date_distance": distance},
                    )
                    candidate["matched_tokens"].add(tokens)
                    candidate["date_distance"] = min(
                        int(candidate["date_distance"]),
                        distance,
                    )
        if len(candidates) != 1:
            continue

        player = next(iter(candidates.values()))
        matching_labels = [
            label
            for label in (player["tr_label"], player["en_label"])
            if label and normalized_tokens(label) in player["matched_tokens"]
        ]
        if not matching_labels:
            continue
        canonical_name = matching_labels[0]
        item = matched_by_item.setdefault(
            player["wikidata_id"],
            {
                "wikidata_id": player["wikidata_id"],
                "canonical_name": canonical_name,
                "normalized_date_of_birth": player["date_of_birth"],
                "date_distance": int(player["date_distance"]),
                "components": [],
                "members": [],
            },
        )
        item["date_distance"] = min(
            int(item["date_distance"]),
            int(player["date_distance"]),
        )
        item["components"].append(
            {
                "canonical_player_id": canonical_id,
                "public_id": str(members[0]["public_id"]),
                "preferred_name": str(members[0]["preferred_name"]),
            }
        )
        item["members"].extend(members)

    results = []
    for item in matched_by_item.values():
        members = item["members"]
        databases = [str(row["database_slug"]) for row in members]
        if len(databases) != len(set(databases)):
            continue
        source_keys = [
            f"{row['database_slug']}:{row['source_person_id']}" for row in members
        ]
        abilities = [
            ability_by_key.get(
                (str(row["database_slug"]), str(row["source_person_id"])),
                (0, 0),
            )
            for row in members
        ]
        current_names = sorted(
            {
                str(row[column]).strip()
                for row in members
                for column in ("display_name", "full_name")
                if row[column]
            }
        )
        clubs = sorted({str(row["club_name"]).strip() for row in members if row["club_name"]})
        needs_name_change = any(
            component["preferred_name"] != item["canonical_name"]
            for component in item["components"]
        )
        needs_merge = len(item["components"]) > 1
        if not needs_name_change and not needs_merge:
            continue
        results.append(
            {
                "wikidata_id": item["wikidata_id"],
                "canonical_name": item["canonical_name"],
                "normalized_date_of_birth": item["normalized_date_of_birth"],
                "source_keys": ";".join(sorted(source_keys)),
                "current_names": " | ".join(current_names),
                "clubs": " | ".join(clubs),
                "max_current_ability": max((value[0] for value in abilities), default=0),
                "max_potential_ability": max((value[1] for value in abilities), default=0),
                "component_count": len(item["components"]),
                "public_ids": " | ".join(
                    sorted(component["public_id"] for component in item["components"])
                ),
                "date_distance_days": int(item["date_distance"]),
            }
        )
    return sorted(
        results,
        key=lambda row: (
            -int(row["max_current_ability"]),
            -int(row["max_potential_ability"]),
            str(row["canonical_name"]),
        ),
    )


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--registry", type=Path, default=REGISTRY_DB)
    parser.add_argument("--serving", type=Path, default=SERVING_DB)
    parser.add_argument("--cache", type=Path, default=CACHE_PATH)
    parser.add_argument("--output", type=Path, default=OUTPUT_PATH)
    parser.add_argument(
        "--write-overrides",
        type=Path,
        help="Write source-keyed canonical-name overrides from accepted matches",
    )
    parser.add_argument(
        "--write-reference-components",
        type=Path,
        help="Write exact-DOB multi-component matches for identity relinking",
    )
    parser.add_argument("--component-min-ca", type=int, default=120)
    parser.add_argument("--refresh", action="store_true")
    args = parser.parse_args()

    started = time.monotonic()
    references = fetch_reference_players(args.cache, args.refresh)
    rows = audit(args.registry, args.serving, references)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=(
                "wikidata_id",
                "canonical_name",
                "normalized_date_of_birth",
                "source_keys",
                "current_names",
                "clubs",
                "max_current_ability",
                "max_potential_ability",
                "component_count",
                "public_ids",
                "date_distance_days",
            ),
        )
        writer.writeheader()
        writer.writerows(rows)
    if args.write_overrides:
        override_rows = []
        for row in rows:
            for source_key in str(row["source_keys"]).split(";"):
                database_slug, source_person_id = source_key.split(":", 1)
                override_rows.append(
                    {
                        "database_slug": database_slug,
                        "source_person_id": source_person_id,
                        "canonical_name": row["canonical_name"],
                        "reference_url": (
                            "https://www.wikidata.org/wiki/" + str(row["wikidata_id"])
                        ),
                        "match_basis": (
                            "unique accent/order-insensitive token match; "
                            f"DOB distance {row['date_distance_days']} day(s)"
                        ),
                    }
                )
        override_rows.sort(
            key=lambda row: (row["database_slug"], int(row["source_person_id"]))
        )
        args.write_overrides.parent.mkdir(parents=True, exist_ok=True)
        with args.write_overrides.open(
            "w",
            encoding="utf-8-sig",
            newline="",
        ) as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=(
                    "database_slug",
                    "source_person_id",
                    "canonical_name",
                    "reference_url",
                    "match_basis",
                ),
            )
            writer.writeheader()
            writer.writerows(override_rows)
        print(
            f"Canonical-name overrides: {len(override_rows):,}; "
            f"{args.write_overrides.resolve()}"
        )
    if args.write_reference_components:
        existing_keys: set[str] = set()
        existing_public_ids: set[str] = set()
        with COMPONENTS_PATH.open("r", encoding="utf-8-sig", newline="") as handle:
            for existing in csv.DictReader(handle):
                existing_public_ids.add(existing["canonical_public_id"].strip())
                existing_keys.update(
                    key.strip()
                    for key in existing["source_keys"].split(";")
                    if key.strip()
                )
        component_rows = []
        for row in rows:
            source_keys = str(row["source_keys"]).split(";")
            if (
                int(row["component_count"]) < 2
                or int(row["date_distance_days"]) != 0
                or int(row["max_current_ability"]) < args.component_min_ca
                or any(key in existing_keys for key in source_keys)
            ):
                continue
            available_public_ids = [
                value.strip()
                for value in str(row["public_ids"]).split("|")
                if value.strip() and value.strip() not in existing_public_ids
            ]
            if not available_public_ids:
                continue
            public_id = available_public_ids[0]
            existing_public_ids.add(public_id)
            existing_keys.update(source_keys)
            component_rows.append(
                {
                    "canonical_public_id": public_id,
                    "canonical_name": row["canonical_name"],
                    "normalized_date_of_birth": row["normalized_date_of_birth"],
                    "source_keys": row["source_keys"],
                    "notes": (
                        f"Wikidata {row['wikidata_id']}; unique token and exact-DOB "
                        "match across previously split identity components"
                    ),
                }
            )
        args.write_reference_components.parent.mkdir(parents=True, exist_ok=True)
        with args.write_reference_components.open(
            "w",
            encoding="utf-8-sig",
            newline="",
        ) as handle:
            writer = csv.DictWriter(
                handle,
                fieldnames=(
                    "canonical_public_id",
                    "canonical_name",
                    "normalized_date_of_birth",
                    "source_keys",
                    "notes",
                ),
            )
            writer.writeheader()
            writer.writerows(component_rows)
        print(
            f"Reference identity components: {len(component_rows):,}; "
            f"{args.write_reference_components.resolve()}"
        )
    print(
        f"Reference players: {len(references):,}; "
        f"high-confidence correction candidates: {len(rows):,}; "
        f"elapsed: {time.monotonic() - started:.1f}s"
    )
    print(args.output.resolve())
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
