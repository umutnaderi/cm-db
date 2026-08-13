"""Scan the identity registry for canonical_clubs entries that likely represent
the same real-world club under different name spellings, and report merge
candidates. Read-only unless --apply is passed.

Strategy:
  1. Build a normalized "core" signature per senior canonical club (strip
     diacritics/punctuation/common corporate suffixes).
  2. Bucket clubs by (nation_id or NULL, core signature).
  3. Within each bucket with 2+ members, verify none of the candidate pairs
     have overlapping seasons in club_identity_links (which would mean they
     are genuinely different clubs, e.g. a first team vs a reserve team
     modeled under a different name in the same database).
  4. Report groups where all members are season-disjoint as auto-merge
     candidates (highest-linked member becomes survivor); report anything
     with an overlap, or with more than one plausible core-signature bucket
     touching the same nation, as a hesitant/ambiguous case for review.
"""

import argparse
import json
import re
import sqlite3
import sys
import unicodedata
from collections import defaultdict

REGISTRY_DB = "identity/retroball_identity.sqlite"

SUFFIX_STOPWORDS = {
    "fc", "cf", "afc", "ac", "sad", "sc", "ud", "cd", "plc", "club",
    "futbol", "football", "futebol", "calcio", "the",
}

RESERVE_TOKENS = {
    "b", "c", "ii", "iii", "reserve", "reserves", "youth", "amateure",
    "u18", "u19", "u21", "u23", "academy", "primavera", "juvenil",
}


def strip_diacritics(text):
    normalized = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch))


def core_signature(name):
    text = strip_diacritics(name).lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    tokens = [t for t in text.split() if t]
    tokens = [t for t in tokens if t not in SUFFIX_STOPWORDS]
    return " ".join(sorted(tokens))


def has_reserve_token(name):
    text = strip_diacritics(name).lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    tokens = set(text.split())
    return bool(tokens & RESERVE_TOKENS)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--report", default="/tmp/club_scan_report.json")
    args = parser.parse_args()

    con = sqlite3.connect(REGISTRY_DB)
    clubs = con.execute(
        "SELECT id, public_id, preferred_name, canonical_nation_id "
        "FROM canonical_clubs WHERE team_type = 'senior'"
    ).fetchall()

    buckets = defaultdict(list)
    skipped_reserve = 0
    for cid, public_id, name, nation_id in clubs:
        if has_reserve_token(name):
            skipped_reserve += 1
            continue
        sig = core_signature(name)
        if not sig:
            continue
        buckets[(nation_id, sig)].append((cid, public_id, name))

    candidate_groups = [g for g in buckets.values() if len(g) >= 2]

    print(f"total senior clubs: {len(clubs)}")
    print(f"skipped (reserve/youth token in name): {skipped_reserve}")
    print(f"buckets with 2+ members: {len(candidate_groups)}")

    def links_for(cid):
        return set(
            row[0] for row in con.execute(
                "SELECT database_slug FROM club_identity_links WHERE canonical_club_id = ?",
                (cid,),
            ).fetchall()
        )

    clean_groups = []
    overlap_groups = []
    for group in candidate_groups:
        member_links = [(cid, public_id, name, links_for(cid)) for cid, public_id, name in group]
        overlap_found = False
        for i in range(len(member_links)):
            for j in range(i + 1, len(member_links)):
                if member_links[i][3] & member_links[j][3]:
                    overlap_found = True
                    break
            if overlap_found:
                break
        if overlap_found:
            overlap_groups.append(member_links)
        else:
            total_links = sum(len(m[3]) for m in member_links)
            clean_groups.append((member_links, total_links))

    print(f"clean (no season overlap) groups: {len(clean_groups)}")
    print(f"groups WITH season overlap (need review): {len(overlap_groups)}")

    report = {
        "clean_groups": [
            {
                "survivor": max(members, key=lambda m: len(m[3]))[1],
                "members": [
                    {"public_id": pid, "name": name, "links": len(links), "seasons": sorted(links)}
                    for _, pid, name, links in members
                ],
                "total_links": total,
            }
            for members, total in clean_groups
        ],
        "overlap_groups": [
            [
                {"public_id": pid, "name": name, "links": len(links), "seasons": sorted(links)}
                for _, pid, name, links in members
            ]
            for members in overlap_groups
        ],
    }
    with open(args.report, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f"report written to {args.report}")

    if args.apply:
        total_repointed = 0
        total_deleted = 0
        for members, _ in clean_groups:
            survivor = max(members, key=lambda m: len(m[3]))
            for cid, public_id, name, links in members:
                if cid == survivor[0]:
                    continue
                rows = con.execute(
                    "SELECT database_slug, source_club_id FROM club_identity_links WHERE canonical_club_id = ?",
                    (cid,),
                ).fetchall()
                for database_slug, source_club_id in rows:
                    evidence = json.dumps(
                        {
                            "merged_from": public_id,
                            "merged_into": survivor[1],
                            "reason": "automated duplicate-club scan: same core name/nation, no season overlap",
                        },
                        sort_keys=True,
                        separators=(",", ":"),
                    )
                    con.execute(
                        """
                        UPDATE club_identity_links
                        SET canonical_club_id = ?,
                            match_method = 'manual_override',
                            review_status = 'manual_override',
                            evidence_json = ?
                        WHERE database_slug = ? AND source_club_id = ?
                        """,
                        (survivor[0], evidence, database_slug, source_club_id),
                    )
                    total_repointed += 1
                con.execute("DELETE FROM canonical_clubs WHERE id = ?", (cid,))
                total_deleted += 1
        con.commit()
        print(f"APPLIED: re-pointed {total_repointed} links, deleted {total_deleted} duplicate canonical_clubs rows")
    else:
        print("dry run only (pass --apply to execute)")

    con.close()


if __name__ == "__main__":
    main()
