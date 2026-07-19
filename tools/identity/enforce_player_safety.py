#!/usr/bin/env python3
"""Quarantine unsafe player clusters and apply Git-controlled player overrides."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from common import REGISTRY_DB, ROOT, normalize_name, registry_connection
from link_players import load_overrides, stable_id

OVERRIDES=ROOT/"config"/"identity"/"player_overrides.csv"


def enforce(registry_path:Path,overrides_path:Path)->dict[str,int]:
    con=registry_connection(registry_path);rules=load_overrides(overrides_path)
    try:
        con.execute("BEGIN IMMEDIATE")
        unsafe=[row[0] for row in con.execute("""SELECT canonical_player_id FROM player_identity_links l JOIN source_players s USING(database_slug,source_person_id) WHERE s.normalized_date_of_birth IS NOT NULL GROUP BY canonical_player_id HAVING julianday(MAX(s.normalized_date_of_birth))-julianday(MIN(s.normalized_date_of_birth))>2""")]
        quarantined=0
        for canonical_id in unsafe:
            for row in con.execute("SELECT database_slug,source_person_id FROM player_identity_links WHERE canonical_player_id=?",(canonical_id,)):
                evidence=json.dumps({"maximum_allowed_dob_spread_days":2,"previous_canonical_player_id":canonical_id},sort_keys=True,separators=(",",":"))
                con.execute("""INSERT INTO player_link_quarantine(database_slug,source_person_id,previous_canonical_player_id,reason,evidence_json) VALUES(?,?,?,'component_dob_spread_exceeds_two_days',?) ON CONFLICT(database_slug,source_person_id) DO UPDATE SET previous_canonical_player_id=excluded.previous_canonical_player_id,reason=excluded.reason,evidence_json=excluded.evidence_json""",(row["database_slug"],row["source_person_id"],canonical_id,evidence))
            quarantined+=con.execute("DELETE FROM player_identity_links WHERE canonical_player_id=?",(canonical_id,)).rowcount
        applied=0
        for key,rule in rules.items():
            source=con.execute("SELECT * FROM source_players WHERE database_slug=? AND source_person_id=? AND active=1",key).fetchone()
            if source is None:raise RuntimeError(f"Player override source not found: {key}")
            if rule["action"]=="reject_candidate":
                con.execute("DELETE FROM player_identity_links WHERE database_slug=? AND source_person_id=?",key)
                continue
            public=rule["canonical_public_id"]
            if not public:raise RuntimeError(f"Player override requires canonical_public_id: {key}")
            canonical=con.execute("SELECT id FROM canonical_players WHERE public_id=?",(public,)).fetchone()
            if canonical is None:
                integer=stable_id(public);name=rule["canonical_name"] or source["display_name"] or source["full_name"]
                collision=con.execute("SELECT public_id FROM canonical_players WHERE id=?",(integer,)).fetchone()
                if collision:raise RuntimeError(f"Stable player integer collision: {public} / {collision['public_id']}")
                con.execute("INSERT INTO canonical_players(id,public_id,preferred_name,normalized_name,date_of_birth,canonical_nation_id,position_group) VALUES(?,?,?,?,?,?,?)",(integer,public,name,normalize_name(name),source["normalized_date_of_birth"],source["canonical_nation_id"],source["position_group"]))
                canonical_id=integer
            else:canonical_id=canonical["id"]
            duplicate=con.execute("""SELECT source_person_id FROM player_identity_links WHERE canonical_player_id=? AND database_slug=? AND source_person_id<>?""",(canonical_id,key[0],key[1])).fetchone()
            if duplicate:raise RuntimeError(f"Override would merge two people from {key[0]} into {public}")
            evidence=json.dumps({"action":rule["action"],"notes":rule["notes"],"source_name":source["display_name"] or source["full_name"]},ensure_ascii=False,sort_keys=True,separators=(",",":"))
            con.execute("""INSERT INTO player_identity_links(database_slug,source_person_id,canonical_player_id,match_method,confidence,review_status,evidence_json) VALUES(?,?,?,'manual_override',1.0,'manual_override',?) ON CONFLICT(database_slug,source_person_id) DO UPDATE SET canonical_player_id=excluded.canonical_player_id,match_method=excluded.match_method,confidence=excluded.confidence,review_status=excluded.review_status,evidence_json=excluded.evidence_json,linked_at=CASE WHEN player_identity_links.canonical_player_id<>excluded.canonical_player_id OR player_identity_links.evidence_json<>excluded.evidence_json THEN CURRENT_TIMESTAMP ELSE player_identity_links.linked_at END""",(*key,canonical_id,evidence));applied+=1
        con.commit()
        return {"unsafe_components":len(unsafe),"quarantined_rows":quarantined,"overrides_applied":applied,"linked":con.execute("SELECT COUNT(*) FROM player_identity_links").fetchone()[0]}
    except Exception:con.rollback();raise
    finally:con.close()


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--registry",type=Path,default=REGISTRY_DB);p.add_argument("--overrides",type=Path,default=OVERRIDES);a=p.parse_args();s=enforce(a.registry,a.overrides);print("unsafe components quarantined: {unsafe_components}; source rows quarantined: {quarantined_rows}; overrides applied: {overrides_applied}; linked players: {linked}".format(**s))
if __name__=="__main__":main()
