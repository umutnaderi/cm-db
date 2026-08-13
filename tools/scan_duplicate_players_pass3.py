"""Pass 3: resolve overlap groups from pass 1 (scan_duplicate_players.py)
where the overlap is explained by a player having multiple rows within the
SAME database edition (e.g. a mid-season transfer creating two distinct
source_person_id records) rather than by two different real people sharing
a name+DOB.

Safe pattern: within an exact-name+DOB bucket, one member's database set is
a subset of another member's database set (the "small" member never has a
database the "big" member lacks). This means every apparent "overlap" is
just the small member's row(s) being extra records inside a database the
big member also covers - never a case of two members disagreeing about
which era they belong to. Genuinely conflicting groups (neither member's
databases are a subset of the other) are left untouched.
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
    parser.add_argument("--report", default="/tmp/player_scan_pass3_report.json")
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

    def dbs_for(pid):
        return set(
            row[0] for row in con.execute(
                "SELECT database_slug FROM player_identity_links WHERE canonical_player_id = ?",
                (pid,),
            ).fetchall()
        )

    subset_groups = []
    other_overlap = []
    for group in candidate_groups:
        member_dbs = [(pid, public_id, name, dbs_for(pid)) for pid, public_id, name in group]
        has_true_overlap = False
        for i in range(len(member_dbs)):
            for j in range(len(member_dbs)):
                if i == j:
                    continue
                if member_dbs[i][3] & member_dbs[j][3]:
                    has_true_overlap = True
        if not has_true_overlap:
            continue  # not an overlap group at all (already handled by pass 1)

        # Check: is every member's database set a subset of the union covered
        # by some strictly-bigger member (i.e. no two members have databases
        # that are both exclusive to themselves)?
        member_dbs.sort(key=lambda m: -len(m[3]))
        biggest = member_dbs[0]
        safe = True
        for m in member_dbs[1:]:
            if not (m[3] <= biggest[3]):
                safe = False
                break
        if safe and len(member_dbs) >= 2 and len(member_dbs[1:]) >= 1:
            subset_groups.append(member_dbs)
        else:
            other_overlap.append(member_dbs)

    print(f"subset (safe) overlap groups: {len(subset_groups)}")
    print(f"other (genuinely conflicting) overlap groups: {len(other_overlap)}")

    report = {
        "subset_groups": [
            {
                "survivor": members[0][1],
                "survivor_name": members[0][2],
                "survivor_databases": sorted(members[0][3]),
                "members": [
                    {"public_id": pid_, "name": name, "databases": sorted(dbs)}
                    for pid_, name, dbs in [(m[1], m[2], m[3]) for m in members[1:]]
                ],
            }
            for members in subset_groups
        ],
        "other_overlap": [
            [
                {"public_id": pid_, "name": name, "databases": sorted(dbs)}
                for _, pid_, name, dbs in members
            ]
            for members in other_overlap
        ],
    }
    with open(args.report, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f"report written to {args.report}")

    if args.apply:
        total_repointed = 0
        total_deleted = 0
        for members in subset_groups:
            survivor = members[0]
            for m in members[1:]:
                pid = m[0]
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
        print(f"APPLIED: re-pointed {total_repointed} links, deleted {total_deleted} canonical_players rows")
    else:
        print("dry run only (pass --apply to execute)")

    con.close()


if __name__ == "__main__":
    main()
