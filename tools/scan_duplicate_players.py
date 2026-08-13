"""Scan the identity registry for canonical_players entries that likely
represent the same real person split into multiple canonical identities
(usually due to word-order swaps, diacritic differences, or nation-label
drift breaking the automated linker). Read-only unless --apply is passed.

Strategy mirrors scan_duplicate_clubs.py:
  1. Bucket canonical_players by (sorted normalized name tokens, exact
     date_of_birth). Requires a specific DOB (not just an estimated year)
     to keep false-positive risk low.
  2. Within each bucket with 2+ members, verify none of the candidate pairs
     share a database_slug in player_identity_links (would mean two
     different real people coincidentally sharing name+DOB, or a genuine
     data anomaly - never merge those).
  3. Report season-disjoint groups as auto-merge candidates (most-linked
     member becomes survivor); report anything with a database overlap as
     a hesitant/ambiguous case for review.
"""

import argparse
import json
import re
import sqlite3
import sys
import unicodedata
from collections import defaultdict

REGISTRY_DB = "identity/retroball_identity.sqlite"


def strip_diacritics(text):
    normalized = unicodedata.normalize("NFKD", text)
    return "".join(ch for ch in normalized if not unicodedata.combining(ch))


def core_signature(name):
    text = strip_diacritics(name).lower()
    text = re.sub(r"[^a-z0-9]+", " ", text)
    tokens = sorted(t for t in text.split() if t)
    return " ".join(tokens)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--report", default="/tmp/player_scan_report.json")
    args = parser.parse_args()

    con = sqlite3.connect(REGISTRY_DB)
    players = con.execute(
        "SELECT id, public_id, preferred_name, date_of_birth "
        "FROM canonical_players WHERE date_of_birth IS NOT NULL"
    ).fetchall()

    buckets = defaultdict(list)
    for pid, public_id, name, dob in players:
        sig = core_signature(name)
        if not sig or len(sig.split()) < 2:
            continue
        buckets[(sig, dob)].append((pid, public_id, name))

    candidate_groups = [g for g in buckets.values() if len(g) >= 2]
    print(f"total players with specific DOB: {len(players)}")
    print(f"buckets with 2+ members: {len(candidate_groups)}")

    def dbs_for(pid):
        return set(
            row[0] for row in con.execute(
                "SELECT database_slug FROM player_identity_links WHERE canonical_player_id = ?",
                (pid,),
            ).fetchall()
        )

    clean_groups = []
    overlap_groups = []
    for group in candidate_groups:
        member_dbs = [(pid, public_id, name, dbs_for(pid)) for pid, public_id, name in group]
        overlap_found = False
        for i in range(len(member_dbs)):
            for j in range(i + 1, len(member_dbs)):
                if member_dbs[i][3] & member_dbs[j][3]:
                    overlap_found = True
                    break
            if overlap_found:
                break
        if overlap_found:
            overlap_groups.append(member_dbs)
        else:
            total_links = sum(len(m[3]) for m in member_dbs)
            clean_groups.append((member_dbs, total_links))

    print(f"clean (no database overlap) groups: {len(clean_groups)}")
    print(f"groups WITH database overlap (need review): {len(overlap_groups)}")

    report = {
        "clean_groups": [
            {
                "survivor": max(members, key=lambda m: len(m[3]))[1],
                "members": [
                    {"public_id": pid_, "name": name, "links": len(dbs), "databases": sorted(dbs)}
                    for _, pid_, name, dbs in members
                ],
                "total_links": total,
            }
            for members, total in clean_groups
        ],
        "overlap_groups": [
            [
                {"public_id": pid_, "name": name, "links": len(dbs), "databases": sorted(dbs)}
                for _, pid_, name, dbs in members
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
            for pid, public_id, name, dbs in members:
                if pid == survivor[0]:
                    continue
                rows = con.execute(
                    "SELECT database_slug, source_person_id FROM player_identity_links WHERE canonical_player_id = ?",
                    (pid,),
                ).fetchall()
                for database_slug, source_person_id in rows:
                    con.execute(
                        """
                        UPDATE player_identity_links
                        SET canonical_player_id = ?,
                            match_method = 'manual_override',
                            review_status = 'manual_override'
                        WHERE database_slug = ? AND source_person_id = ?
                        """,
                        (survivor[0], database_slug, source_person_id),
                    )
                    total_repointed += 1
                con.execute("DELETE FROM canonical_players WHERE id = ?", (pid,))
                total_deleted += 1
        con.commit()
        print(f"APPLIED: re-pointed {total_repointed} links, deleted {total_deleted} duplicate canonical_players rows")
    else:
        print("dry run only (pass --apply to execute)")

    con.close()


if __name__ == "__main__":
    main()
