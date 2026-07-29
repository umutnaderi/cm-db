#!/usr/bin/env python3
"""Conservatively link clubs by canonical nation, team type, and normalized name."""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
from collections import Counter, defaultdict
from pathlib import Path

from common import REGISTRY_DB, ROOT, normalize_name, registry_connection, slug_part

OVERRIDES=ROOT/"config"/"identity"/"club_overrides.csv"


def stable_id(public_id:str)->int:
    return (int.from_bytes(hashlib.sha256(public_id.encode()).digest()[:8],"big")&((1<<63)-1)) or 1


def overrides(path:Path)->dict[tuple[str,str],dict[str,str]]:
    with path.open("r",encoding="utf-8-sig",newline="") as handle:
        reader=csv.DictReader(handle); required={"action","database_slug","source_club_id","canonical_public_id","canonical_name","team_type","notes"}
        if reader.fieldnames is None or required-set(reader.fieldnames): raise RuntimeError("Club override CSV has invalid columns")
        result={}
        for line,raw in enumerate(reader,2):
            row={k:(v or "").strip() for k,v in raw.items()}; key=(row["database_slug"],row["source_club_id"])
            if row["action"] not in {"link","create_new","keep_separate","reject_candidate"} or not all(key) or key in result:
                raise RuntimeError(f"Invalid club override line {line}")
            result[key]=row
        return result


def canonical(connection,name,nation_id,team_type,public_id,identity_cache,id_cache,public_cache,allow_existing_public=False):
    normalized=normalize_name(name)
    public_match=public_cache.get(public_id)
    if public_match and allow_existing_public:
        connection.execute(
            """
            UPDATE canonical_clubs
               SET preferred_name = ?,
                   updated_at = CASE
                     WHEN preferred_name <> ?
                     THEN CURRENT_TIMESTAMP
                     ELSE updated_at
                   END
             WHERE id = ?
            """,
            (name, name, public_match),
        )
        return public_match
    old=identity_cache.get((normalized,nation_id,team_type))
    if old:
        if public_id and public_id!=old[1]: raise RuntimeError(f"Stable club public ID conflict for {name}")
        return old[0]
    integer=stable_id(public_id); collision=id_cache.get(integer) or public_cache.get(public_id)
    if collision: raise RuntimeError(f"Club ID collision: {public_id} / {collision}")
    connection.execute("INSERT INTO canonical_clubs(id,public_id,preferred_name,normalized_name,canonical_nation_id,team_type) VALUES(?,?,?,?,?,?)",(integer,public_id,name,normalized,nation_id,team_type))
    identity_cache[(normalized,nation_id,team_type)]=(integer,public_id)
    id_cache[integer]=public_id;public_cache[public_id]=integer
    return integer


def link(registry_path:Path,overrides_path:Path)->dict[str,int]:
    rules=overrides(overrides_path); con=registry_connection(registry_path)
    try:
        direct={(r["database_slug"],r["source_nation_id"]):(r["canonical_nation_id"],r["public_id"])
                for r in con.execute("SELECT l.database_slug,l.source_nation_id,l.canonical_nation_id,c.public_id FROM nation_identity_links l JOIN canonical_nations c ON c.id=l.canonical_nation_id")}
        by_name=defaultdict(set)
        for r in con.execute("SELECT s.normalized_name,l.canonical_nation_id,c.public_id FROM source_nations s JOIN nation_identity_links l USING(database_slug,source_nation_id) JOIN canonical_nations c ON c.id=l.canonical_nation_id WHERE s.active=1"):
            by_name[r["normalized_name"]].add((r["canonical_nation_id"],r["public_id"]))
        rows=[dict(r) for r in con.execute("SELECT * FROM source_clubs WHERE active=1 ORDER BY database_slug,source_club_id")]
        for row in rows:
            nation=direct.get((row["database_slug"],row["source_nation_id"]))
            if nation is None:
                candidates=by_name.get(normalize_name(row["nation_name"]),set())
                nation=next(iter(candidates)) if len(candidates)==1 else None
            row["canonical_nation_id"]=nation[0] if nation else None;row["nation_public_id"]=nation[1] if nation else None
            row["context"] = row["nation_public_id"] or f"unresolved_{slug_part(row['nation_name'] or 'unknown')}"
        unknown_groups=defaultdict(list)
        for row in rows:
            row["identity_signature"]=(row["normalized_name"],row["canonical_nation_id"],row["team_type"])
            if row["canonical_nation_id"] is None and not normalize_name(row["nation_name"]):
                unknown_groups[(row["normalized_name"],row["team_type"])].append(row)
        ambiguous_unknown=set()
        for group_rows in unknown_groups.values():
            counts=Counter(row["database_slug"] for row in group_rows)
            if any(count>1 for count in counts.values()):
                ambiguous_unknown.update((row["database_slug"],row["source_club_id"]) for row in group_rows)

        identity_rows=defaultdict(list)
        for row in rows:
            if (row["database_slug"],row["source_club_id"]) not in ambiguous_unknown:
                identity_rows[row["identity_signature"]].append(row)
        identity_names={}
        initial_bases={}
        for signature,members in identity_rows.items():
            counts=Counter(row["source_name"] for row in members)
            chosen=sorted(counts,key=lambda value:(-counts[value],len(value),normalize_name(value)))[0]
            identity_names[signature]=chosen
            type_suffix="" if signature[2]=="senior" else f"_{slug_part(signature[2])}"
            initial_bases[signature]=f"club_{slug_part(chosen)}{type_suffix}"
        base_groups=defaultdict(list)
        for signature,base in initial_bases.items(): base_groups[base].append(signature)
        candidate_public={}
        for signature,base in initial_bases.items():
            if len(base_groups[base])>1:
                member=identity_rows[signature][0]
                context=member["nation_public_id"] or member["context"]
                base=f"{base}_{slug_part(context.removeprefix('nation_'))}"
            candidate_public[signature]=base
        final_groups=defaultdict(list)
        for signature,base in candidate_public.items(): final_groups[base].append(signature)
        identity_public={}
        for signature,base in candidate_public.items():
            if len(final_groups[base])>1:
                encoded="|".join("" if value is None else str(value) for value in signature)
                base=f"{base}_{hashlib.sha256(encoded.encode()).hexdigest()[:8]}"
            identity_public[signature]=base
        for row in rows:
            row["ambiguous_unknown"]=(row["database_slug"],row["source_club_id"]) in ambiguous_unknown
            row["auto_public_id"]=identity_public.get(row["identity_signature"])

        existing=list(con.execute("SELECT id,public_id,normalized_name,canonical_nation_id,team_type FROM canonical_clubs"))
        identity_cache={(r["normalized_name"],r["canonical_nation_id"],r["team_type"]):(int(r["id"]),r["public_id"]) for r in existing}
        id_cache={int(r["id"]):r["public_id"] for r in existing};public_cache={r["public_id"]:int(r["id"]) for r in existing}

        con.execute("BEGIN IMMEDIATE")
        con.execute("""DELETE FROM club_identity_links WHERE NOT EXISTS(SELECT 1 FROM source_clubs s WHERE s.database_slug=club_identity_links.database_slug AND s.source_club_id=club_identity_links.source_club_id AND s.active=1)""")
        unresolved=0
        for row in rows:
            key=(row["database_slug"],row["source_club_id"]);rule=rules.get(key)
            if not row["normalized_name"] or (row["ambiguous_unknown"] and not rule) or (rule and rule["action"]=="reject_candidate"):
                con.execute("DELETE FROM club_identity_links WHERE database_slug=? AND source_club_id=?",key);unresolved+=1;continue
            name=(rule.get("canonical_name") if rule else "") or identity_names.get(row["identity_signature"],row["source_name"])
            kind=(rule.get("team_type") if rule else "") or row["team_type"]
            if rule and rule["canonical_public_id"]: public=rule["canonical_public_id"]
            else: public=row["auto_public_id"]
            if not public:
                raise RuntimeError(f"Ambiguous club override requires canonical_public_id: {key}")
            target=canonical(
                con,
                name,
                row["canonical_nation_id"],
                kind,
                public,
                identity_cache,
                id_cache,
                public_cache,
                bool(rule and rule["canonical_public_id"]),
            )
            method="exact_context" if not rule else ("keep_separate" if rule["action"]=="keep_separate" else "manual_override")
            review="auto_accepted" if not rule else "manual_override"
            evidence=json.dumps({"canonical_nation_id":row["canonical_nation_id"],"city":row["city"],"source_name":row["source_name"],"stadium":row["stadium"],"team_type":kind},ensure_ascii=False,sort_keys=True,separators=(",",":"))
            con.execute("""INSERT INTO club_identity_links(database_slug,source_club_id,canonical_club_id,canonical_nation_id,match_method,confidence,review_status,evidence_json)
                VALUES(?,?,?,?,?,1.0,?,?) ON CONFLICT(database_slug,source_club_id) DO UPDATE SET canonical_club_id=excluded.canonical_club_id,canonical_nation_id=excluded.canonical_nation_id,match_method=excluded.match_method,confidence=excluded.confidence,review_status=excluded.review_status,evidence_json=excluded.evidence_json,
                linked_at=CASE WHEN club_identity_links.canonical_club_id<>excluded.canonical_club_id OR club_identity_links.evidence_json<>excluded.evidence_json THEN CURRENT_TIMESTAMP ELSE club_identity_links.linked_at END""",(*key,target,row["canonical_nation_id"],method,review,evidence))
        con.commit()
        return {"source":len(rows),"canonical":con.execute("SELECT COUNT(*) FROM canonical_clubs").fetchone()[0],"linked":con.execute("SELECT COUNT(*) FROM club_identity_links").fetchone()[0],"unresolved":unresolved,"nation_resolved":sum(r["canonical_nation_id"] is not None for r in rows)}
    except Exception: con.rollback();raise
    finally:con.close()


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--registry",type=Path,default=REGISTRY_DB);p.add_argument("--overrides",type=Path,default=OVERRIDES);a=p.parse_args();s=link(a.registry,a.overrides)
    print("source clubs: {source}; canonical: {canonical}; linked: {linked}; unresolved: {unresolved}; canonical nation resolved: {nation_resolved}".format(**s))
if __name__=="__main__":main()
