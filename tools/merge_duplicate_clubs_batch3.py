"""Merge round 3: more duplicate canonical_clubs entities for the same real club."""

import json
import sqlite3
import sys

REGISTRY_DB = "identity/retroball_identity.sqlite"

GROUPS = [
    ("club_chelsea_england", ["club_chelsea_unresolved_unknown"]),
    ("club_as_monaco", ["club_as_monaco_fc"]),
    ("club_manchester_city_england", ["club_manchester_city_unresolved_unknown"]),
    ("club_newcastle_united_england", ["club_newcastle_united_unresolved_unknown"]),
    ("club_real_zaragoza", ["club_real_zaragoza_sad", "club_real_zaragoza_s_a_d"]),
    ("club_everton_england", ["club_everton_unresolved_unknown"]),
    ("club_leeds_united_england", ["club_leeds_united_unresolved_unknown"]),
    ("club_aston_villa_england", ["club_aston_villa_unresolved_unknown"]),
    ("club_tottenham_hotspur_england", ["club_tottenham_hotspur_unresolved_unknown"]),
    ("club_athletic_club_de_bilbao_spain", ["club_athletic_club_de_bilbao_unresolved_unknown", "club_athletic_bilbao"]),
    ("club_lazio_italy", ["club_lazio_unresolved_unknown"]),
    ("club_bologna_1909", ["club_bologna_italy"]),
    ("club_brescia_italy", ["club_brescia_unresolved_unknown"]),
]

ORPHANS = [
    "club_bologna_unresolved_unknown",
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
