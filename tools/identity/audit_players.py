#!/usr/bin/env python3
"""Generate Phase 4 player identity audits and safety metrics."""

from __future__ import annotations

import argparse
from pathlib import Path

from common import AUDIT_DIR, REGISTRY_DB, atomic_csv, registry_connection

SENTINELS=("Zinedine Zidane","Figo","Ronaldo","Rivaldo","Francesco Totti")


def audit(registry_path:Path,audit_dir:Path)->dict[str,int]:
    con=registry_connection(registry_path)
    try:
        link_fields=["database_slug","source_person_id","source_display_name","source_full_name","source_date_of_birth","normalized_date_of_birth","source_nation_name","source_club_name","position_group","canonical_player_id","canonical_public_id","canonical_preferred_name","canonical_date_of_birth","canonical_nation_public_id","match_method","confidence","review_status","evidence_json"]
        link_sql="""SELECT s.database_slug,s.source_person_id,s.display_name AS source_display_name,s.full_name AS source_full_name,s.date_of_birth AS source_date_of_birth,s.normalized_date_of_birth,s.nation_name AS source_nation_name,s.club_name AS source_club_name,s.position_group,c.id AS canonical_player_id,c.public_id AS canonical_public_id,c.preferred_name AS canonical_preferred_name,c.date_of_birth AS canonical_date_of_birth,n.public_id AS canonical_nation_public_id,l.match_method,l.confidence,l.review_status,l.evidence_json FROM source_players s JOIN player_identity_links l USING(database_slug,source_person_id) JOIN canonical_players c ON c.id=l.canonical_player_id LEFT JOIN canonical_nations n ON n.id=c.canonical_nation_id WHERE s.active=1 ORDER BY s.database_slug,s.source_person_id"""
        atomic_csv(audit_dir/"player_links.csv",link_fields,(dict(row) for row in con.execute(link_sql)))
        unresolved_fields=["database_slug","source_person_id","display_name","full_name","common_name","date_of_birth","normalized_date_of_birth","nation_name","club_name","position_group","reason","previous_canonical_player_id"]
        unresolved_sql="""SELECT s.database_slug,s.source_person_id,s.display_name,s.full_name,s.common_name,s.date_of_birth,s.normalized_date_of_birth,s.nation_name,s.club_name,s.position_group,COALESCE(q.reason,'insufficient_conservative_evidence') AS reason,q.previous_canonical_player_id FROM source_players s LEFT JOIN player_identity_links l USING(database_slug,source_person_id) LEFT JOIN player_link_quarantine q USING(database_slug,source_person_id) WHERE s.active=1 AND l.canonical_player_id IS NULL ORDER BY s.database_slug,s.source_person_id"""
        atomic_csv(audit_dir/"ambiguous_players.csv",unresolved_fields,(dict(row) for row in con.execute(unresolved_sql)))
        placeholders=",".join("?" for _ in SENTINELS)
        sentinel_rows=[dict(row) for row in con.execute(f"""SELECT s.database_slug,s.source_person_id,s.display_name,s.full_name,s.normalized_date_of_birth,c.public_id AS canonical_public_id,l.match_method FROM source_players s LEFT JOIN player_identity_links l USING(database_slug,source_person_id) LEFT JOIN canonical_players c ON c.id=l.canonical_player_id WHERE s.display_name IN ({placeholders}) ORDER BY s.display_name,s.database_slug,s.source_person_id""",SENTINELS)]
        atomic_csv(audit_dir/"sentinel_player_links.csv",["database_slug","source_person_id","display_name","full_name","normalized_date_of_birth","canonical_public_id","match_method"],sentinel_rows)
        duplicate_database=con.execute("""SELECT COUNT(*) FROM(SELECT l.canonical_player_id,s.database_slug,COUNT(*) n FROM player_identity_links l JOIN source_players s USING(database_slug,source_person_id) GROUP BY l.canonical_player_id,s.database_slug HAVING n>1)""").fetchone()[0]
        dob_spread=con.execute("""SELECT COUNT(*) FROM(SELECT l.canonical_player_id FROM player_identity_links l JOIN source_players s USING(database_slug,source_person_id) WHERE s.normalized_date_of_birth IS NOT NULL GROUP BY l.canonical_player_id HAVING julianday(MAX(s.normalized_date_of_birth))-julianday(MIN(s.normalized_date_of_birth))>2)""").fetchone()[0]
        safety=[{"check":"duplicate_source_database_within_canonical","violations":duplicate_database},{"check":"canonical_dob_spread_over_two_days","violations":dob_spread},{"check":"foreign_key_violations","violations":len(con.execute('PRAGMA foreign_key_check').fetchall())}]
        atomic_csv(audit_dir/"player_safety.csv",["check","violations"],safety)
        source=con.execute("SELECT COUNT(*) FROM source_players WHERE active=1").fetchone()[0];linked=con.execute("SELECT COUNT(*) FROM player_identity_links").fetchone()[0]
        return {"source":source,"canonical_total":con.execute("SELECT COUNT(*) FROM canonical_players").fetchone()[0],"canonical_linked":con.execute("SELECT COUNT(DISTINCT canonical_player_id) FROM player_identity_links").fetchone()[0],"linked":linked,"unresolved":source-linked,"quarantined":con.execute("SELECT COUNT(*) FROM player_link_quarantine").fetchone()[0],"duplicate_database":duplicate_database,"dob_spread":dob_spread}
    finally:con.close()


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--registry",type=Path,default=REGISTRY_DB);p.add_argument("--audit-dir",type=Path,default=AUDIT_DIR);a=p.parse_args();s=audit(a.registry,a.audit_dir);print("source: {source}; canonical total: {canonical_total}; linked canonicals: {canonical_linked}; linked rows: {linked}; unresolved: {unresolved}; quarantined: {quarantined}; duplicate-db violations: {duplicate_database}; DOB-spread violations: {dob_spread}".format(**s))
if __name__=="__main__":main()
