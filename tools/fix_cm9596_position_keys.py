import sqlite3
import json
import sys

KEY_MAP = {
    "defence": "defender",
    "anchor": "defensive_midfielder",
    "midfield": "midfielder",
    "support": "attacking_midfielder",
    "attack": "attacker",
    "right_sided": "right_side",
    "left_sided": "left_side",
}


def remap(raw):
    data = json.loads(raw)
    out = {}
    changed = False
    for k, v in data.items():
        nk = KEY_MAP.get(k, k)
        if nk != k:
            changed = True
        out[nk] = v
    return json.dumps(out, separators=(",", ":")), changed


def run(db_path, slug_pattern, dry_run):
    con = sqlite3.connect(db_path)
    rows = con.execute(
        "SELECT source_person_id, database_slug, position_ratings_json FROM player_profile "
        "WHERE database_slug LIKE ? AND position_ratings_json IS NOT NULL",
        (slug_pattern,),
    ).fetchall()
    print(f"{db_path}: found {len(rows)} rows matching {slug_pattern!r}")

    updates = []
    unchanged = 0
    for person_id, slug, raw in rows:
        new_raw, changed = remap(raw)
        if changed:
            updates.append((new_raw, person_id, slug))
        else:
            unchanged += 1

    print(f"  {len(updates)} rows need key remap, {unchanged} already fine")

    if dry_run:
        if updates:
            print("  sample:", updates[0])
        con.close()
        return

    con.executemany(
        "UPDATE player_profile SET position_ratings_json = ? WHERE source_person_id = ? AND database_slug = ?",
        updates,
    )
    con.commit()
    con.close()
    print(f"  applied {len(updates)} updates")


if __name__ == "__main__":
    db_path = sys.argv[1]
    dry_run = "--dry-run" in sys.argv
    run(db_path, "cm9596%", dry_run)
