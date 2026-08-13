"""Merge duplicate canonical_clubs entities that represent the same real club.

Each group below was found to have the same real-world club split across
multiple canonical_clubs rows (usually a resolved-nation entry plus a legacy
"unresolved_unknown" entry, or genuinely different historical name spellings
that automatic normalized-name linking never matched together).

For each group: re-point every club_identity_links row referencing a
duplicate canonical_club_id to the survivor's id, then delete the now-orphan
canonical_clubs rows.
"""

import json
import sqlite3
import sys

REGISTRY_DB = "identity/retroball_identity.sqlite"

# (survivor public_id, [duplicate public_ids to fold into the survivor])
GROUPS = [
    ("club_f_c_barcelona_spain", ["club_fc_barcelona", "club_f_c_barcelona_unresolved_unknown"]),
    ("club_internazionale_italy", ["club_internazionale_unresolved_unknown"]),
    ("club_real_madrid_c_f_spain", ["club_real_madrid_c_f_unresolved_unknown"]),
    ("club_fenerbahce_sk_turkey", ["club_fenerbahce", "club_fenerbahce_istanbul", "club_fenerbahce_sk_unresolved_unknown"]),
    ("club_galatasaray_sk_turkey", ["club_galatasaray_istanbul"]),
    ("club_parma_italy", ["club_parma_unresolved_unknown"]),
    ("club_arsenal_england", ["club_arsenal_unresolved_unknown"]),
    ("club_as_roma_italy", ["club_as_roma_unresolved_unknown"]),
    ("club_deportivo_de_la_coruna", ["club_deportivo_la_coruna", "club_r_c_deportivo_de_la_coruna_s_a_d", "club_r_c_deportivo_de_la_coruna_sad"]),
    ("club_real_betis_balompie", ["club_real_betis_balompie_s_a_d", "club_real_betis_balompie_sad"]),
    ("club_fc_bayern_munchen_germany", ["club_bayern_munich", "club_fc_bayern_munich", "club_fc_bayern_munchen_unresolved_unknown"]),
    ("club_liverpool_england", ["club_liverpool_unresolved_unknown"]),
    ("club_atletico_de_madrid", ["club_atletico_madrid", "club_club_atletico_de_madrid", "club_club_atletico_de_madrid_s_a_d", "club_club_atletico_de_madrid_sad"]),
    ("club_manchester_united_england", ["club_manchester_united_unresolved_unknown"]),
]

# Orphaned canonical_clubs rows found during investigation with zero linked
# rows - safe to delete outright, no re-pointing needed.
ORPHANS = [
    "club_ac_milan_unresolved_unknown",
    "club_galatasaray",
    "club_galatasaray_sk_unresolved_unknown",
]


def club_id(con, public_id):
    row = con.execute("SELECT id FROM canonical_clubs WHERE public_id = ?", (public_id,)).fetchone()
    if row is None:
        raise SystemExit(f"public_id not found: {public_id}")
    return row[0]


def main():
    dry_run = "--dry-run" in sys.argv
    con = sqlite3.connect(REGISTRY_DB)
    con.execute("PRAGMA foreign_keys = ON")

    total_repointed = 0
    total_deleted = 0

    for survivor_public_id, duplicate_public_ids in GROUPS:
        survivor_id = club_id(con, survivor_public_id)
        for dup_public_id in duplicate_public_ids:
            dup_id = club_id(con, dup_public_id)
            links = con.execute(
                "SELECT database_slug, source_club_id FROM club_identity_links WHERE canonical_club_id = ?",
                (dup_id,),
            ).fetchall()
            print(f"{dup_public_id} ({dup_id}) -> {survivor_public_id} ({survivor_id}): {len(links)} links")
            total_repointed += len(links)
            if not dry_run:
                for database_slug, source_club_id in links:
                    evidence = json.dumps(
                        {
                            "merged_from": dup_public_id,
                            "merged_into": survivor_public_id,
                            "reason": "duplicate canonical club entity for the same real-world club",
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
                        (survivor_id, evidence, database_slug, source_club_id),
                    )
                con.execute("DELETE FROM canonical_clubs WHERE id = ?", (dup_id,))
            total_deleted += 1

    for orphan_public_id in ORPHANS:
        row = con.execute("SELECT id FROM canonical_clubs WHERE public_id = ?", (orphan_public_id,)).fetchone()
        if row is None:
            print(f"orphan {orphan_public_id}: not found, skipping")
            continue
        orphan_id = row[0]
        remaining = con.execute(
            "SELECT COUNT(*) FROM club_identity_links WHERE canonical_club_id = ?", (orphan_id,)
        ).fetchone()[0]
        if remaining:
            print(f"orphan {orphan_public_id} ({orphan_id}) actually has {remaining} links - NOT deleting")
            continue
        print(f"orphan {orphan_public_id} ({orphan_id}): 0 links, deleting")
        if not dry_run:
            con.execute("DELETE FROM canonical_clubs WHERE id = ?", (orphan_id,))
        total_deleted += 1

    if dry_run:
        print(f"\nDRY RUN: would re-point {total_repointed} links and delete {total_deleted} canonical_clubs rows")
        con.rollback()
    else:
        con.commit()
        print(f"\nApplied: re-pointed {total_repointed} links and deleted {total_deleted} canonical_clubs rows")
    con.close()


if __name__ == "__main__":
    main()
