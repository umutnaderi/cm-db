#!/usr/bin/env python3
"""Synchronize source club snapshots into the persistent identity registry."""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

from common import REGISTRY_DB, SCHEMA_PATH, SOURCE_DB, choose_column, normalize_name, registry_connection, sha256_text, source_connection, stable_json, table_columns
from create_registry import create_registry


def team_type(name: object, short_name: object) -> str:
    value = normalize_name(f"{name or ''} {short_name or ''}")
    if re.search(r"\b(u ?1[6789]|under ?1[6789]|youth)\b", value): return "youth"
    if re.search(r"\b(reserve|reserves|res)\b", value): return "reserve"
    if re.search(r"\bb team\b", value) or re.search(r"\bii\b", value): return "b"
    return "senior"


def raw_detail(raw: object, keys: tuple[str, ...]) -> object:
    if not raw: return None
    try: payload = json.loads(str(raw))
    except (TypeError, ValueError): return None
    for key in keys:
        if payload.get(key) not in (None, ""): return payload[key]
    return None


def synchronize(source_path: Path, registry_path: Path) -> dict[str, int]:
    source = source_connection(source_path)
    try:
        columns = table_columns(source, "clubs")
        db_col = choose_column(columns, ("database_slug", "db_slug", "database"), "database slug")
        id_col = choose_column(columns, ("source_club_id", "club_id", "source_id", "id"), "club ID")
        name_col = choose_column(columns, ("name", "club_name", "display_name"), "club name")
        quoted = ", ".join(f'"{column}"' for column in columns)
        rows = [dict(row) for row in source.execute(f'SELECT {quoted} FROM clubs ORDER BY "{db_col}", "{id_col}"')]
    finally: source.close()
    connection = registry_connection(registry_path); inserted=changed=unchanged=0
    try:
        connection.execute("BEGIN IMMEDIATE"); connection.execute("UPDATE source_clubs SET active=0 WHERE active=1")
        for row in rows:
            db=str(row[db_col]); source_id=str(row[id_col]); name=row[name_col]
            payload=stable_json({column:row[column] for column in columns}); digest=sha256_text(payload)
            old=connection.execute("SELECT source_row_hash FROM source_clubs WHERE database_slug=? AND source_club_id=?",(db,source_id)).fetchone()
            if old is None: inserted+=1
            elif old[0]==digest: unchanged+=1
            else: changed+=1
            short=row.get("short_name") or raw_detail(row.get("raw_json"),("Short Name","short_name"))
            city=raw_detail(row.get("raw_json"),("City","city")); stadium=raw_detail(row.get("raw_json"),("Stadium","stadium"))
            connection.execute("""
                INSERT INTO source_clubs(database_slug,source_club_id,source_name,normalized_name,
                    short_name,nation_name,source_nation_id,source_competition_id,team_type,city,stadium,
                    source_payload_json,source_row_hash,active)
                VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,1)
                ON CONFLICT(database_slug,source_club_id) DO UPDATE SET
                    source_name=excluded.source_name,normalized_name=excluded.normalized_name,
                    short_name=excluded.short_name,nation_name=excluded.nation_name,
                    source_nation_id=excluded.source_nation_id,source_competition_id=excluded.source_competition_id,
                    team_type=excluded.team_type,city=excluded.city,stadium=excluded.stadium,
                    source_payload_json=excluded.source_payload_json,source_row_hash=excluded.source_row_hash,active=1,
                    last_changed_at=CASE WHEN source_clubs.source_row_hash<>excluded.source_row_hash
                        THEN CURRENT_TIMESTAMP ELSE source_clubs.last_changed_at END
            """,(db,source_id,name,normalize_name(name),short,row.get("nation_name"),
                  None if row.get("nation_id") is None else str(row.get("nation_id")),
                  None if row.get("division_id") is None else str(row.get("division_id")),
                  team_type(name,short),city,stadium,payload,digest))
        connection.commit()
        return {"source":len(rows),"inserted":inserted,"changed":changed,"unchanged":unchanged,
                "inactive":connection.execute("SELECT COUNT(*) FROM source_clubs WHERE active=0").fetchone()[0]}
    except Exception: connection.rollback(); raise
    finally: connection.close()


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--source",type=Path,default=SOURCE_DB);p.add_argument("--registry",type=Path,default=REGISTRY_DB);a=p.parse_args()
    create_registry(a.registry,SCHEMA_PATH);s=synchronize(a.source,a.registry)
    print("source clubs: {source}; inserted: {inserted}; changed: {changed}; unchanged: {unchanged}; inactive: {inactive}".format(**s))
if __name__=="__main__":main()
