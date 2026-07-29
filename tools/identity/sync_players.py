#!/usr/bin/env python3
"""Synchronize player identity fields and compact career evidence into the registry."""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import json
import re
from pathlib import Path

from common import REGISTRY_DB, ROOT, SCHEMA_PATH, SOURCE_DB, choose_column, normalize_name, registry_connection, sha256_text, source_connection, stable_json, table_columns
from create_registry import create_registry
from player_components import (
    COMPONENT_RESOLUTIONS,
    component_field_overrides,
    load_component_resolutions,
)

SEASON_YEAR={"cm9697_vanilla_original":1996,"cm9798_vanilla_original":1997,"cm9899_vanilla_original":1998,"cm9900_vanilla_original":1999,"cm0001_vanilla_original":2000,"cm0102_vanilla_original":2001,"cm0203_vanilla_original":2002,"cm0304_vanilla_original":2003}
CLUB_NAME_ALIASES=ROOT/"config"/"identity"/"player_club_name_aliases.csv"
PLAYER_FIELD_OVERRIDES=ROOT/"config"/"identity"/"player_field_overrides.csv"


def position_group(value:object)->str:
    text=(value or "").upper()
    if "GK" in text:return "gk"
    if re.search(r"(^|[/ ])F([ /]|$)|ST",text):return "forward"
    if "AM" in text:return "attacking_midfield"
    if re.search(r"(^|[/ ])M([ /]|$)|DM",text):return "midfield"
    if re.search(r"(^|[/ ])D([ /]|$)|SW|WB",text):return "defence"
    return "unknown"


def normalized_dob(value:object,season_age:object,season_year:int|None)->str|None:
    if not value:return None
    parts=[int(part) for part in re.findall(r"\d+",str(value))]
    try:
        if len(parts)!=3:return None
        if parts[0]>31:year,month,day=parts
        else:
            day,month,year=parts
            if year<100:
                candidates=(1900+year,2000+year)
                if season_year is not None and season_age is not None:
                    expected=season_year-int(season_age)
                    year=min(candidates,key=lambda candidate:abs(candidate-expected))
                else:year=1900+year
        parsed=dt.date(year,month,day)
        if parsed.year<=1901:return None
        return parsed.isoformat()
    except (ValueError,TypeError):return None


def player_club_aliases(connection,path:Path):
    canonical_ids={row["public_id"]:row["id"] for row in connection.execute("SELECT id,public_id FROM canonical_clubs")}
    result={}
    with path.open("r",encoding="utf-8-sig",newline="") as handle:
        reader=csv.DictReader(handle);required={"database_slug","source_club_name","canonical_public_id","notes"}
        if reader.fieldnames is None or required-set(reader.fieldnames):raise RuntimeError("Player club alias CSV has invalid columns")
        for line,raw in enumerate(reader,2):
            row={key:(value or "").strip() for key,value in raw.items()};key=(row["database_slug"],row["source_club_name"])
            canonical_id=canonical_ids.get(row["canonical_public_id"])
            if not all(key) or canonical_id is None or key in result:raise RuntimeError(f"Invalid player club alias line {line}")
            result[key]=canonical_id
    return result


def player_field_overrides(path:Path):
    result={}
    with path.open("r",encoding="utf-8-sig",newline="") as handle:
        reader=csv.DictReader(handle);required={"database_slug","source_person_id","normalized_date_of_birth","notes"}
        if reader.fieldnames is None or required-set(reader.fieldnames):raise RuntimeError("Player field override CSV has invalid columns")
        for line,raw in enumerate(reader,2):
            row={key:(value or "").strip() for key,value in raw.items()};key=(row["database_slug"],row["source_person_id"])
            try:corrected=dt.date.fromisoformat(row["normalized_date_of_birth"]).isoformat()
            except ValueError as error:raise RuntimeError(f"Invalid player field override line {line}") from error
            if not all(key) or key in result:raise RuntimeError(f"Invalid player field override line {line}")
            result[key]=corrected
    return result


def resolution_maps(connection,club_aliases_path:Path):
    nation_direct={(r["database_slug"],r["source_nation_id"]):r["canonical_nation_id"] for r in connection.execute("SELECT database_slug,source_nation_id,canonical_nation_id FROM nation_identity_links")}
    nation_names={}
    for r in connection.execute("SELECT s.normalized_name,l.canonical_nation_id FROM source_nations s JOIN nation_identity_links l USING(database_slug,source_nation_id) WHERE s.active=1"):
        nation_names.setdefault(r["normalized_name"],set()).add(r["canonical_nation_id"])
    nation_names={key:next(iter(values)) for key,values in nation_names.items() if len(values)==1}
    club_direct={
        (r["database_slug"],r["source_club_id"]):(
            r["canonical_club_id"],
            r["normalized_name"],
        )
        for r in connection.execute(
            """
            SELECT l.database_slug,l.source_club_id,l.canonical_club_id,s.normalized_name
            FROM club_identity_links l
            JOIN source_clubs s USING(database_slug,source_club_id)
            """
        )
    }
    club_names={}
    for r in connection.execute("SELECT s.database_slug,s.normalized_name,s.short_name,l.canonical_club_id FROM source_clubs s JOIN club_identity_links l USING(database_slug,source_club_id) WHERE s.active=1"):
        names={r["normalized_name"],normalize_name(r["short_name"])}
        for name in names:
            if name:
                club_names.setdefault((r["database_slug"],name),set()).add(r["canonical_club_id"])
    club_names={key:next(iter(values)) for key,values in club_names.items() if len(values)==1}
    return nation_direct,nation_names,club_direct,club_names,player_club_aliases(connection,club_aliases_path)


def synchronize(
    source_path: Path,
    registry_path: Path,
    club_aliases_path: Path = CLUB_NAME_ALIASES,
    field_overrides_path: Path = PLAYER_FIELD_OVERRIDES,
    component_resolutions_path: Path = COMPONENT_RESOLUTIONS,
) -> dict[str, int]:
    source=source_connection(source_path); con=registry_connection(registry_path)
    nation_direct,nation_names,club_direct,club_names,club_aliases=resolution_maps(con,club_aliases_path)
    field_overrides=component_field_overrides(
        load_component_resolutions(component_resolutions_path)
    )
    for key, corrected in player_field_overrides(field_overrides_path).items():
        existing = field_overrides.get(key)
        if existing is not None and existing != corrected:
            raise RuntimeError(
                f"Conflicting player DOB corrections for {key}: "
                f"{existing} / {corrected}"
            )
        field_overrides[key] = corrected
    columns=table_columns(source,"player_search")
    db_col=choose_column(columns,("database_slug","db_slug","database"),"database slug");id_col=choose_column(columns,("source_person_id","person_id","source_id","id"),"person ID")
    selected=[name for name in (db_col,id_col,"display_name","full_name","first_name","second_name","common_name","date_of_birth","season_age","position_text","nation_id","nation_name","club_id","club_name") if name in columns]
    quoted=", ".join(f'"{name}"' for name in selected)
    inserted=changed=unchanged=0
    try:
        existing_hashes={(r["database_slug"],r["source_person_id"]):r["identity_row_hash"] for r in con.execute("SELECT database_slug,source_person_id,identity_row_hash FROM source_players")}
        con.execute("BEGIN IMMEDIATE")
        con.execute("CREATE TEMP TABLE seen_players(database_slug TEXT NOT NULL,source_person_id TEXT NOT NULL,PRIMARY KEY(database_slug,source_person_id)) WITHOUT ROWID")
        cursor=source.execute(f'SELECT {quoted} FROM player_search ORDER BY "{db_col}","{id_col}"')
        batch=[]
        def flush():
            nonlocal inserted,changed,unchanged
            if not batch:return
            # Initial-run performance matters; ON CONFLICT keeps subsequent runs idempotent.
            for values in batch:
                old=existing_hashes.get(values[:2])
                if old is None:inserted+=1
                elif old==values[-1]:unchanged+=1
                else:changed+=1
                existing_hashes[values[:2]]=values[-1]
            con.executemany("""INSERT INTO source_players(database_slug,source_person_id,display_name,full_name,first_name,second_name,common_name,normalized_identity_name,date_of_birth,normalized_date_of_birth,estimated_birth_year,position_text,position_group,source_nation_id,nation_name,canonical_nation_id,source_club_id,club_name,canonical_club_id,identity_payload_json,identity_row_hash,active)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,1)
                ON CONFLICT(database_slug,source_person_id) DO UPDATE SET display_name=excluded.display_name,full_name=excluded.full_name,first_name=excluded.first_name,second_name=excluded.second_name,common_name=excluded.common_name,normalized_identity_name=excluded.normalized_identity_name,date_of_birth=excluded.date_of_birth,normalized_date_of_birth=excluded.normalized_date_of_birth,estimated_birth_year=excluded.estimated_birth_year,position_text=excluded.position_text,position_group=excluded.position_group,source_nation_id=excluded.source_nation_id,nation_name=excluded.nation_name,canonical_nation_id=excluded.canonical_nation_id,source_club_id=excluded.source_club_id,club_name=excluded.club_name,canonical_club_id=excluded.canonical_club_id,identity_payload_json=excluded.identity_payload_json,identity_row_hash=excluded.identity_row_hash,active=1,last_changed_at=CASE WHEN source_players.identity_row_hash<>excluded.identity_row_hash THEN CURRENT_TIMESTAMP ELSE source_players.last_changed_at END
                WHERE source_players.identity_row_hash<>excluded.identity_row_hash OR source_players.active=0""",batch)
            con.executemany("INSERT OR IGNORE INTO seen_players(database_slug,source_person_id) VALUES(?,?)",(values[:2] for values in batch))
            batch.clear()
        for raw in cursor:
            row=dict(raw);db=str(row[db_col]);pid=str(row[id_col]);identity=row.get("full_name") or row.get("display_name") or row.get("common_name") or ""
            nation_id=None if row.get("nation_id") is None else str(row.get("nation_id"));club_id=None if row.get("club_id") in (None,"") else str(row.get("club_id"))
            canonical_nation=nation_direct.get((db,nation_id)) or nation_names.get(normalize_name(row.get("nation_name")))
            normalized_club_name=normalize_name(row.get("club_name"))
            direct_club=club_direct.get((db,club_id))
            named_club=club_names.get((db,normalized_club_name))
            explicit_club=club_aliases.get((db,row.get("club_name") or ""))
            if explicit_club:
                canonical_club=explicit_club
            elif direct_club and (
                not normalized_club_name
                or direct_club[1] == normalized_club_name
            ):
                canonical_club=direct_club[0]
            else:
                # Some converted databases contain player club IDs from a
                # different namespace. Never let a conflicting ID attach the
                # player to an unrelated club; use the unique name match.
                canonical_club=named_club
            age=row.get("season_age");parsed_dob=field_overrides.get((db,pid)) or normalized_dob(row.get("date_of_birth"),age,SEASON_YEAR.get(db))
            estimated=int(parsed_dob[:4]) if parsed_dob else ((SEASON_YEAR.get(db)-int(age)) if age is not None and db in SEASON_YEAR else None)
            payload=stable_json(row);derived=stable_json({"canonical_club_id":canonical_club,"canonical_nation_id":canonical_nation,"normalized_date_of_birth":parsed_dob,"position_group":position_group(row.get("position_text")),"source":json.loads(payload)})
            digest=sha256_text(derived)
            batch.append((db,pid,row.get("display_name"),row.get("full_name"),row.get("first_name"),row.get("second_name"),row.get("common_name"),normalize_name(identity),row.get("date_of_birth"),parsed_dob,estimated,row.get("position_text"),position_group(row.get("position_text")),nation_id,row.get("nation_name"),canonical_nation,club_id,row.get("club_name"),canonical_club,payload,digest))
            if len(batch)>=5000:flush()
        flush()
        # Career evidence is compacted per source person instead of duplicating full histories.
        current=None;tokens=[];updates=[]
        for r in source.execute("SELECT database_slug,source_person_id,season_year,club_name FROM person_history ORDER BY database_slug,source_person_id,season_year,club_name"):
            key=(str(r[0]),str(r[1]))
            if current is not None and key!=current:
                updates.append((json.dumps(sorted(set(tokens)),separators=(",",":")),*current));tokens=[]
                if len(updates)>=5000:
                    con.executemany("UPDATE source_players SET history_tokens_json=? WHERE database_slug=? AND source_person_id=? AND history_tokens_json<>?",((value,db,pid,value) for value,db,pid in updates));updates.clear()
            current=key;tokens.append(f"{r[2]}:{normalize_name(r[3])}")
        if current is not None:updates.append((json.dumps(sorted(set(tokens)),separators=(",",":")),*current))
        if updates:con.executemany("UPDATE source_players SET history_tokens_json=? WHERE database_slug=? AND source_person_id=? AND history_tokens_json<>?",((value,db,pid,value) for value,db,pid in updates))
        con.execute("UPDATE source_players SET active=0 WHERE active=1 AND NOT EXISTS(SELECT 1 FROM seen_players s WHERE s.database_slug=source_players.database_slug AND s.source_person_id=source_players.source_person_id)")
        con.commit();inactive=con.execute("SELECT COUNT(*) FROM source_players WHERE active=0").fetchone()[0]
        return {"source":inserted+changed+unchanged,"inserted":inserted,"changed":changed,"unchanged":unchanged,"inactive":inactive}
    except Exception:con.rollback();raise
    finally:source.close();con.close()


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--source",type=Path,default=SOURCE_DB);p.add_argument("--registry",type=Path,default=REGISTRY_DB);p.add_argument("--club-aliases",type=Path,default=CLUB_NAME_ALIASES);p.add_argument("--field-overrides",type=Path,default=PLAYER_FIELD_OVERRIDES);p.add_argument("--component-resolutions",type=Path,default=COMPONENT_RESOLUTIONS);a=p.parse_args();create_registry(a.registry,SCHEMA_PATH);s=synchronize(a.source,a.registry,a.club_aliases,a.field_overrides,a.component_resolutions);print("source players: {source}; inserted: {inserted}; changed: {changed}; unchanged: {unchanged}; inactive: {inactive}".format(**s))
if __name__=="__main__":main()
