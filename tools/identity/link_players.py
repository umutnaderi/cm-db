#!/usr/bin/env python3
"""Conservatively cluster player identities across CM databases."""

from __future__ import annotations

import argparse
import csv
import datetime as dt
import hashlib
import json
from collections import Counter, defaultdict
from itertools import combinations
from pathlib import Path

from common import REGISTRY_DB, ROOT, normalize_name, registry_connection, slug_part

OVERRIDES=ROOT/"config"/"identity"/"player_overrides.csv"
DB_ORDER={"cm9697_vanilla_original":1,"cm9798_vanilla_original":2,"cm9899_vanilla_original":3,"cm9900_vanilla_original":4,"cm0001_vanilla_original":5,"cm0102_vanilla_original":6,"cm0203_vanilla_original":7,"cm0304_vanilla_original":8}


def stable_id(public_id:str)->int:
    return (int.from_bytes(hashlib.sha256(public_id.encode()).digest()[:8],"big")&((1<<63)-1)) or 1


def link_fingerprint(values)->bytes:
    return hashlib.blake2b("\x1f".join(str(value) for value in values).encode("utf-8"),digest_size=16).digest()


def name_keys(row:dict)->set[str]:
    return {value for value in (normalize_name(row.get("full_name")),normalize_name(row.get("display_name")),normalize_name(row.get("common_name"))) if value}


def compatible_position(left:str,right:str)->bool:
    return left==right or "unknown" in {left,right} or (left!="gk" and right!="gk")


class UnionFind:
    def __init__(self):self.parent={};self.rank={};self.databases={};self.dob_bounds={}
    def add(self,key,database,dob=None):
        if key not in self.parent:
            self.parent[key]=key;self.rank[key]=0;self.databases[key]={database}
            ordinal=dt.date.fromisoformat(dob).toordinal() if dob else None
            self.dob_bounds[key]=(ordinal,ordinal)
    def find(self,key):
        parent=self.parent[key]
        if parent!=key:self.parent[key]=self.find(parent)
        return self.parent[key]
    def union(self,left,right)->bool:
        a=self.find(left);b=self.find(right)
        if a==b:return True
        if self.databases[a]&self.databases[b]:return False
        dates=[value for value in (*self.dob_bounds[a],*self.dob_bounds[b]) if value is not None]
        if dates and max(dates)-min(dates)>2:return False
        if self.rank[a]<self.rank[b]:a,b=b,a
        self.parent[b]=a;self.databases[a]|=self.databases[b]
        self.dob_bounds[a]=(min(dates),max(dates)) if dates else (None,None)
        if self.rank[a]==self.rank[b]:self.rank[a]+=1
        return True


def edge_score(left:dict,right:dict,name_strength:float)->tuple[float,dict]|None:
    if left["database_slug"]==right["database_slug"]:return None
    if not compatible_position(left["position_group"],right["position_group"]):return None
    score=name_strength;signals={"name":name_strength}
    ld=left.get("normalized_date_of_birth");rd=right.get("normalized_date_of_birth")
    if ld and rd:
        days=abs((dt.date.fromisoformat(ld)-dt.date.fromisoformat(rd)).days)
        if days>2:return None
        value=5.0 if days==0 else 4.0;score+=value;signals["dob_days"]=days
    elif left.get("estimated_birth_year") and right.get("estimated_birth_year"):
        years=abs(left["estimated_birth_year"]-right["estimated_birth_year"])
        if years<=1:score+=1;signals["estimated_birth_year_delta"]=years
    ln=left.get("canonical_nation_id");rn=right.get("canonical_nation_id")
    if ln and rn:
        if ln!=rn:return None
        score+=2;signals["canonical_nation"]=True
    if left["position_group"]==right["position_group"] and left["position_group"]!="unknown":score+=1;signals["position"]=True
    lc=left.get("canonical_club_id");rc=right.get("canonical_club_id")
    if lc and rc and lc==rc:score+=2;signals["canonical_club"]=True
    lh=set(json.loads(left["history_tokens_json"]));rh=set(json.loads(right["history_tokens_json"]));overlap=lh&rh
    if overlap:score+=4;signals["career_overlap_count"]=len(overlap)
    if abs(DB_ORDER.get(left["database_slug"],0)-DB_ORDER.get(right["database_slug"],0))==1:score+=0.5;signals["adjacent_season"]=True
    return score,signals


def load_overrides(path:Path):
    with path.open("r",encoding="utf-8-sig",newline="") as f:
        reader=csv.DictReader(f);required={"action","database_slug","source_person_id","canonical_public_id","canonical_name","notes"}
        if reader.fieldnames is None or required-set(reader.fieldnames):raise RuntimeError("Player override CSV has invalid columns")
        result={}
        for line,raw in enumerate(reader,2):
            row={k:(v or "").strip() for k,v in raw.items()};key=(row["database_slug"],row["source_person_id"])
            if row["action"] not in {"link","create_new","keep_separate","reject_candidate"} or not all(key) or key in result:raise RuntimeError(f"Invalid player override line {line}")
            result[key]=row
        return result


def canonical(public_id,name,dob,nation,position,cache,id_cache,pending):
    existing=cache.get(public_id)
    if existing:return existing
    integer=stable_id(public_id);collision=id_cache.get(integer)
    if collision:raise RuntimeError(f"Player ID collision: {public_id} / {collision}")
    pending.append((integer,public_id,name,normalize_name(name),dob,nation,position))
    cache[public_id]=integer;id_cache[integer]=public_id;return integer


def player_public_id(name:str,dob:str|None,nation_public:str|None,position:str,career_tokens:list[str],used:set[str])->str|None:
    base=f"player_{slug_part(name)}"
    suffix=[]
    if nation_public:suffix.append(nation_public.removeprefix("nation_"))
    if dob:suffix.append(dob[:4])
    elif position and position!="unknown":suffix.append(position)
    candidate=f"{base}_{'_'.join(slug_part(value) for value in suffix)}" if suffix else base
    if candidate in used:
        evidence="|".join([normalize_name(name),dob or "",nation_public or "",position,*sorted(career_tokens)])
        if not career_tokens and not dob:return None
        candidate=f"{candidate}_{hashlib.sha256(evidence.encode()).hexdigest()[:8]}"
    return None if candidate in used else candidate


def link(registry_path:Path,overrides_path:Path)->dict[str,int]:
    con=registry_connection(registry_path);rules=load_overrides(overrides_path);uf=UnionFind()
    override_keys=set(rules)
    quarantine_keys={(row["database_slug"],row["source_person_id"]) for row in con.execute("SELECT database_slug,source_person_id FROM player_link_quarantine")}
    automatic_exclusions=override_keys|quarantine_keys
    try:
        # Pass 1: valid DOB blocks by nation/year, with alternate full/display/common names.
        query="""SELECT * FROM source_players WHERE active=1 AND normalized_date_of_birth IS NOT NULL ORDER BY COALESCE(canonical_nation_id,-1),estimated_birth_year,database_slug,source_person_id"""
        current=None;block=[]
        def process_dob(rows):
            key_rows=defaultdict(list);token_rows=defaultdict(list)
            for row in rows:
                if (row["database_slug"],row["source_person_id"]) in automatic_exclusions:continue
                keys=name_keys(row)
                for key in keys:key_rows[key].append(row)
                for token in {token for key in keys for token in key.split() if len(token)>=4}:token_rows[token].append(row)
            candidates={}
            for key,members in key_rows.items():
                strength=2.0 if len(key.split())>1 else 1.0
                for left,right in combinations(members,2):candidates[(left["database_slug"],left["source_person_id"],right["database_slug"],right["source_person_id"])]=(left,right,strength)
            for token,members in token_rows.items():
                if len(members)>16:continue
                for left,right in combinations(members,2):
                    left_common=normalize_name(left.get("display_name"))==token or normalize_name(left.get("common_name"))==token
                    right_common=normalize_name(right.get("display_name"))==token or normalize_name(right.get("common_name"))==token
                    if left_common or right_common:
                        candidates.setdefault((left["database_slug"],left["source_person_id"],right["database_slug"],right["source_person_id"]),(left,right,0.5))
            scored=[]
            for left,right,strength in candidates.values():
                result=edge_score(left,right,strength)
                if not result:continue
                score,signals=result;common=strength<=1 and (len(normalize_name(left.get("display_name")).split())==1 or len(normalize_name(right.get("display_name")).split())==1)
                if score >= (9.0 if common else 7.5):scored.append((score,left,right,signals))
            for score,left,right,signals in sorted(scored,key=lambda item:-item[0]):
                lk=(left["database_slug"],left["source_person_id"]);rk=(right["database_slug"],right["source_person_id"])
                uf.add(lk,left["database_slug"],left.get("normalized_date_of_birth"));uf.add(rk,right["database_slug"],right.get("normalized_date_of_birth"))
                uf.union(lk,rk)
        for raw in con.execute(query):
            row=dict(raw);key=(row["canonical_nation_id"],row["estimated_birth_year"])
            if current is not None and key!=current:process_dob(block);block=[]
            current=key;block.append(row)
        if block:process_dob(block)

        # Pass 2: missing/placeholder DOB, where club or career evidence must compensate.
        current=None;block=[]
        def process_missing(rows):
            scored=[]
            for left,right in combinations(rows,2):
                result=edge_score(left,right,2.0)
                if result and result[0]>=(9.0 if len(left["normalized_identity_name"].split())==1 else 5.5):scored.append((result[0],left,right,result[1]))
            for score,left,right,signals in sorted(scored,key=lambda item:-item[0]):
                lk=(left["database_slug"],left["source_person_id"]);rk=(right["database_slug"],right["source_person_id"])
                uf.add(lk,left["database_slug"],left.get("normalized_date_of_birth"));uf.add(rk,right["database_slug"],right.get("normalized_date_of_birth"))
                uf.union(lk,rk)
        for raw in con.execute("SELECT * FROM source_players WHERE active=1 AND normalized_date_of_birth IS NULL ORDER BY normalized_identity_name,database_slug,source_person_id"):
            row=dict(raw);key=row["normalized_identity_name"]
            if (row["database_slug"],row["source_person_id"]) in automatic_exclusions:continue
            if current is not None and key!=current:process_missing(block);block=[]
            current=key;block.append(row)
        if block:process_missing(block)

        con.execute("DROP TABLE IF EXISTS temp.player_clusters");con.execute("CREATE TEMP TABLE player_clusters(database_slug TEXT,source_person_id TEXT,cluster_key TEXT,PRIMARY KEY(database_slug,source_person_id)) WITHOUT ROWID")
        con.executemany("INSERT INTO player_clusters VALUES(?,?,?)",((*key,f"{uf.find(key)[0]}\x1f{uf.find(key)[1]}") for key in uf.parent))

        con.commit()
        con.execute("BEGIN IMMEDIATE")
        con.execute("""DELETE FROM player_identity_links WHERE NOT EXISTS(SELECT 1 FROM source_players s WHERE s.database_slug=player_identity_links.database_slug AND s.source_person_id=player_identity_links.source_person_id AND s.active=1)""")
        existing_rows=list(con.execute("SELECT id,public_id FROM canonical_players"));existing={r["public_id"]:r["id"] for r in existing_rows};id_cache={r["id"]:r["public_id"] for r in existing_rows};used=set(existing)
        existing_link_hashes={(r["database_slug"],r["source_person_id"]):link_fingerprint((r["canonical_player_id"],r["match_method"],r["confidence"],r["review_status"],r["evidence_json"])) for r in con.execute("SELECT database_slug,source_person_id,canonical_player_id,match_method,confidence,review_status,evidence_json FROM player_identity_links")}
        pending_canonicals=[];pending_links=[]
        link_sql="""INSERT INTO player_identity_links(database_slug,source_person_id,canonical_player_id,match_method,confidence,review_status,evidence_json) VALUES(?,?,?,?,?,?,?) ON CONFLICT(database_slug,source_person_id) DO UPDATE SET canonical_player_id=excluded.canonical_player_id,match_method=excluded.match_method,confidence=excluded.confidence,review_status=excluded.review_status,evidence_json=excluded.evidence_json,linked_at=CURRENT_TIMESTAMP WHERE player_identity_links.canonical_player_id<>excluded.canonical_player_id OR player_identity_links.match_method<>excluded.match_method OR player_identity_links.confidence<>excluded.confidence OR player_identity_links.review_status<>excluded.review_status OR player_identity_links.evidence_json<>excluded.evidence_json"""
        def flush_pending():
            if pending_canonicals:
                con.executemany("INSERT INTO canonical_players(id,public_id,preferred_name,normalized_name,date_of_birth,canonical_nation_id,position_group) VALUES(?,?,?,?,?,?,?)",pending_canonicals);pending_canonicals.clear()
            if pending_links:
                con.executemany(link_sql,pending_links);pending_links.clear()
        linked_keys=set();cluster_count=0
        query="""SELECT s.*,c.cluster_key,n.public_id AS nation_public_id FROM source_players s JOIN player_clusters c USING(database_slug,source_person_id) LEFT JOIN canonical_nations n ON n.id=s.canonical_nation_id ORDER BY c.cluster_key,s.database_slug,s.source_person_id"""
        current=None;members=[]
        def persist_cluster(rows,method="conservative_cluster",manual_public="",manual_name=""):
            nonlocal cluster_count
            names=[row["display_name"] or row["full_name"] for row in rows];counts=Counter(names);name=manual_name or sorted(counts,key=lambda value:(-counts[value],len(value),normalize_name(value)))[0]
            dobs=[row["normalized_date_of_birth"] for row in rows if row["normalized_date_of_birth"]];dob=Counter(dobs).most_common(1)[0][0] if dobs else None
            nations={row["canonical_nation_id"] for row in rows if row["canonical_nation_id"] is not None};nation=next(iter(nations)) if len(nations)==1 else None
            nation_public=next((row["nation_public_id"] for row in rows if row["canonical_nation_id"]==nation),None)
            positions=[row["position_group"] for row in rows if row["position_group"]!="unknown"];position=Counter(positions).most_common(1)[0][0] if positions else "unknown"
            history=sorted({token for row in rows for token in json.loads(row["history_tokens_json"])})
            public=manual_public or player_public_id(name,dob,nation_public,position,history,used)
            if not public:return False
            target=canonical(public,name,dob,nation,position,existing,id_cache,pending_canonicals);used.add(public);cluster_count+=1
            evidence=json.dumps({"component_size":len(rows),"dob_values":sorted(set(dobs)),"canonical_nation_id":nation,"canonical_club_ids":sorted({row["canonical_club_id"] for row in rows if row["canonical_club_id"]}),"position_group":position},sort_keys=True,separators=(",",":"))
            for row in rows:
                key=(row["database_slug"],row["source_person_id"]);linked_keys.add(key)
                values=(target,method,1.0 if method!="conservative_cluster" else 0.9,"manual_override" if method!="conservative_cluster" else "auto_accepted",evidence)
                fingerprint=link_fingerprint(values)
                if existing_link_hashes.get(key)!=fingerprint:
                    pending_links.append((*key,*values));existing_link_hashes[key]=fingerprint
            if len(pending_links)>=5000:flush_pending()
            return True
        for raw in con.execute(query):
            row=dict(raw);key=row["cluster_key"]
            if current is not None and key!=current:persist_cluster(members);members=[]
            current=key;members.append(row)
        if members:persist_cluster(members)

        # Safe singleton: its normalized name+DOB+nation signature occurs only once.
        con.execute("DROP TABLE IF EXISTS temp.player_signature_counts")
        con.execute("""CREATE TEMP TABLE player_signature_counts AS SELECT normalized_identity_name,COALESCE(normalized_date_of_birth,'' ) dob,COALESCE(canonical_nation_id,-1) nation,COUNT(*) n FROM source_players WHERE active=1 GROUP BY normalized_identity_name,COALESCE(normalized_date_of_birth,''),COALESCE(canonical_nation_id,-1)""")
        singleton_query="""SELECT s.*,n.public_id AS nation_public_id FROM source_players s LEFT JOIN player_clusters c USING(database_slug,source_person_id) JOIN player_signature_counts x ON x.normalized_identity_name=s.normalized_identity_name AND x.dob=COALESCE(s.normalized_date_of_birth,'') AND x.nation=COALESCE(s.canonical_nation_id,-1) LEFT JOIN canonical_nations n ON n.id=s.canonical_nation_id WHERE s.active=1 AND c.cluster_key IS NULL AND x.n=1 AND s.normalized_identity_name<>'' ORDER BY s.database_slug,s.source_person_id"""
        singleton_count=0
        for raw in con.execute(singleton_query):
            row=dict(raw);key=(row["database_slug"],row["source_person_id"])
            if key in automatic_exclusions:continue
            if persist_cluster([row],"unique_singleton"):singleton_count+=1

        for key,rule in rules.items():
            con.execute("DELETE FROM player_identity_links WHERE database_slug=? AND source_person_id=?",key)
            if rule["action"]=="reject_candidate":continue
            row=con.execute("SELECT s.*,n.public_id AS nation_public_id FROM source_players s LEFT JOIN canonical_nations n ON n.id=s.canonical_nation_id WHERE s.database_slug=? AND s.source_person_id=?",key).fetchone()
            if not row:raise RuntimeError(f"Player override source not found: {key}")
            if not rule["canonical_public_id"]:raise RuntimeError(f"Player override requires canonical_public_id: {key}")
            persist_cluster([dict(row)],"keep_separate" if rule["action"]=="keep_separate" else "manual_override",rule["canonical_public_id"],rule["canonical_name"])

        flush_pending()

        # Remove stale automatic links that are no longer supported by this run.
        for row in list(con.execute("SELECT database_slug,source_person_id FROM player_identity_links")):
            key=(row[0],row[1])
            if key not in linked_keys:con.execute("DELETE FROM player_identity_links WHERE database_slug=? AND source_person_id=?",key)
        con.commit()
        total=con.execute("SELECT COUNT(*) FROM source_players WHERE active=1").fetchone()[0];linked=con.execute("SELECT COUNT(*) FROM player_identity_links").fetchone()[0]
        return {"source":total,"canonical":con.execute("SELECT COUNT(*) FROM canonical_players").fetchone()[0],"linked":linked,"unresolved":total-linked,"clusters":cluster_count,"singletons":singleton_count}
    except Exception:con.rollback();raise
    finally:con.close()


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument("--registry",type=Path,default=REGISTRY_DB);p.add_argument("--overrides",type=Path,default=OVERRIDES);a=p.parse_args();s=link(a.registry,a.overrides);print("source players: {source}; canonical: {canonical}; linked: {linked}; unresolved: {unresolved}; clusters written: {clusters}; safe singletons: {singletons}".format(**s))
if __name__=="__main__":main()
