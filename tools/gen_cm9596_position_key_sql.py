import sqlite3
import sys


def esc(s):
    return s.replace("'", "''")


def run(db_path, out_path):
    con = sqlite3.connect(db_path)
    rows = con.execute(
        "SELECT source_person_id, database_slug, position_ratings_json FROM player_profile "
        "WHERE database_slug LIKE 'cm9596%' AND position_ratings_json IS NOT NULL"
    ).fetchall()
    with open(out_path, "w", encoding="utf-8") as f:
        for person_id, slug, raw in rows:
            f.write(
                "UPDATE player_profile SET position_ratings_json = '%s' "
                "WHERE source_person_id = '%s' AND database_slug = '%s';\n"
                % (esc(raw), esc(person_id), esc(slug))
            )
    print(f"wrote {len(rows)} statements to {out_path}")


if __name__ == "__main__":
    run(sys.argv[1], sys.argv[2])
