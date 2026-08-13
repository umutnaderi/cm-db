"""Merge round 2: more duplicate canonical_clubs entities for the same real club.

Same approach as merge_duplicate_clubs.py - verified via per-season overlap
checks that each group's duplicates never coexist within the same database
(confirming they are spelling variants of the same club, not a genuinely
distinct reserve/B-team modeled under a different name).
"""

import json
import sqlite3
import sys

REGISTRY_DB = "identity/retroball_identity.sqlite"

GROUPS = [
    ("club_r_c_d_mallorca", ["club_rcd_mallorca", "club_r_c_d_mallorca_sad", "club_r_c_d_mallorca_s_a_d"]),
    ("club_villarreal_c_f", ["club_villarreal_c_f_sad", "club_villarreal_cf", "club_villarreal_c_f_s_a_d", "club_villarreal"]),
    ("club_besiktas_jk_turkey", ["club_besiktas", "club_besiktas_istanbul", "club_besiktas_jk_unresolved_unknown", "club_besiktas_a_s"]),
    ("club_sport_lisboa_e_benfica_portugal", ["club_sport_lisboa_e_benfica_unresolved_unknown", "club_sl_benfica", "club_benfica"]),
    ("club_real_sociedad_c_f", ["club_real_sociedad", "club_real_sociedad_c_f_sad", "club_real_sociedad_s_a_d"]),
    ("club_real_club_celta_de_vigo", ["club_rc_celta", "club_rc_celta_de_vigo", "club_real_club_celta_de_vigo_s_a_d", "club_r_c_celta_de_vigo_sad", "club_real_club_celta_de_vigo_sad", "club_rc_celta_vigo"]),
    ("club_fiorentina_italy", ["club_fiorentina_unresolved_unknown", "club_fiorentina_fc"]),
    ("club_valencia_c_f", ["club_valencia_cf", "club_valencia_c_f_sad", "club_valencia_c_f_s_a_d"]),
    ("club_juventus_italy", ["club_juventus_unresolved_unknown"]),
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

    if dry_run:
        print(f"\nDRY RUN: would re-point {total_repointed} links and delete {total_deleted} canonical_clubs rows")
        con.rollback()
    else:
        con.commit()
        print(f"\nApplied: re-pointed {total_repointed} links and deleted {total_deleted} canonical_clubs rows")
    con.close()


if __name__ == "__main__":
    main()
