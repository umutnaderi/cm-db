"""Pass 2: find canonical_players singletons (linked to exactly one database)
whose exact normalized name matches an established multi-database canonical
player cluster elsewhere, regardless of DOB (catches badly corrupted source
DOBs like a single legacy database being off by a year or more - a case
same-DOB matching in pass 1 cannot catch). Read-only unless --apply.

This is a weaker signal than pass 1 (no DOB corroboration), so it is more
conservative: only merges a *singleton* into an *established* cluster, never
merges two multi-database clusters together, and still requires zero
database overlap.
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
    parser.add_argument("--report", default="/tmp/player_scan_pass2_report.json")
    args = parser.parse_args()

    con = sqlite3.connect(REGISTRY_DB)
    players = con.execute(
        "SELECT id, public_id, preferred_name FROM canonical_players"
    ).fetchall()

    buckets = defaultdict(list)
    for pid, public_id, name in players:
        sig = core_signature(name)
        if not sig or len(sig.split()) < 2:
            continue
        buckets[sig].append((pid, public_id, name))

    candidate_groups = [g for g in buckets.values() if len(g) >= 2]
    print(f"total canonical players: {len(players)}")
    print(f"exact-name buckets with 2+ members: {len(candidate_groups)}")

    def dbs_for(pid):
        return set(
            row[0] for row in con.execute(
                "SELECT database_slug FROM player_identity_links WHERE canonical_player_id = ?",
                (pid,),
            ).fetchall()
        )

    singleton_into_cluster = []
    other_groups = []
    for group in candidate_groups:
        member_dbs = [(pid, public_id, name, dbs_for(pid)) for pid, public_id, name in group]
        singletons = [m for m in member_dbs if len(m[3]) == 1]
        clusters = [m for m in member_dbs if len(m[3]) >= 2]

        if len(clusters) > 1:
            other_groups.append(("multiple_clusters", member_dbs))
            continue
        if len(clusters) == 1 and singletons:
            cluster = clusters[0]
            overlap_found = any(s[3] & cluster[3] for s in singletons)
            singleton_overlap = False
            for i in range(len(singletons)):
                for j in range(i + 1, len(singletons)):
                    if singletons[i][3] & singletons[j][3]:
                        singleton_overlap = True
            if overlap_found or singleton_overlap:
                other_groups.append(("overlap", member_dbs))
            else:
                singleton_into_cluster.append((cluster, singletons))
        elif len(clusters) == 0 and len(singletons) >= 2:
            overlap_found = False
            for i in range(len(singletons)):
                for j in range(i + 1, len(singletons)):
                    if singletons[i][3] & singletons[j][3]:
                        overlap_found = True
            other_groups.append(("all_singletons_overlap" if overlap_found else "all_singletons_clean", member_dbs))

    print(f"singleton-into-established-cluster groups: {len(singleton_into_cluster)}")
    print(f"other (multiple clusters / overlap / all-singleton) groups: {len(other_groups)}")

    report = {
        "singleton_into_cluster": [
            {
                "survivor": cluster[1],
                "survivor_name": cluster[2],
                "survivor_databases": sorted(cluster[3]),
                "singletons": [
                    {"public_id": s[1], "name": s[2], "database": sorted(s[3])[0]}
                    for s in singletons
                ],
            }
            for cluster, singletons in singleton_into_cluster
        ],
        "other_groups": [
            {
                "kind": kind,
                "members": [
                    {"public_id": pid_, "name": name, "links": len(dbs), "databases": sorted(dbs)}
                    for _, pid_, name, dbs in members
                ],
            }
            for kind, members in other_groups
        ],
    }
    with open(args.report, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    print(f"report written to {args.report}")

    if args.apply:
        total_repointed = 0
        total_deleted = 0
        for cluster, singletons in singleton_into_cluster:
            for s in singletons:
                pid = s[0]
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
                        (cluster[0], database_slug, source_person_id),
                    )
                    total_repointed += 1
                con.execute("DELETE FROM canonical_players WHERE id = ?", (pid,))
                total_deleted += 1
        con.commit()
        print(f"APPLIED: re-pointed {total_repointed} links, deleted {total_deleted} singleton canonical_players rows")
    else:
        print("dry run only (pass --apply to execute)")

    con.close()


if __name__ == "__main__":
    main()
