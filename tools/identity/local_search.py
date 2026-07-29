#!/usr/bin/env python3
"""FTS5 player search used by the local development server."""

import json
import sqlite3
import sys
import unicodedata
import re
from pathlib import Path


root = Path(__file__).resolve().parents[2]
connection = sqlite3.connect(f"file:{(root / 'db' / 'retroball.sqlite').as_posix()}?mode=ro", uri=True)
connection.row_factory = sqlite3.Row
connection.execute("PRAGMA query_only = ON")
identity = sqlite3.connect(
    f"file:{(root / 'identity' / 'retroball_identity.sqlite').as_posix()}?mode=ro",
    uri=True,
)
identity.row_factory = sqlite3.Row
identity.execute("PRAGMA query_only = ON")

arguments = sys.argv[1:8]
arguments.extend([""] * (7 - len(arguments)))
database, query, page, page_size, club, league, nation = arguments
normalized = unicodedata.normalize("NFKD", query)
tokens = re.findall(r"[\w]+", "".join(c for c in normalized if not unicodedata.combining(c)).lower())
match = " AND ".join(f'"{token}"*' for token in tokens[:10])
clauses = ["ps.database_slug = ?", "player_search_fts MATCH ?"]
values = [database, match]
for column, value in (("club_name", club), ("league_name", league), ("nation_name", nation)):
    if value:
        clauses.append(f"ps.{column} = ?")
        values.append(value)

requested_page = max(1, int(page))
requested_page_size = max(1, int(page_size))
merge_limit = min(requested_page * requested_page_size + 100, 1_000)
rows = list(connection.execute(
    f"""
    SELECT ps.database_slug, ps.source_person_id, ps.display_name, ps.full_name,
           ps.common_name, ps.club_name, ps.nation_name, ps.date_of_birth,
           ps.season_age AS age, ps.position_text, ps.current_ability,
           ps.potential_ability, ps.value, ps.wage
    FROM player_search ps
    JOIN player_search_fts f
      ON f.database_slug = ps.database_slug AND f.source_person_id = ps.source_person_id
    WHERE {' AND '.join(clauses)}
    ORDER BY coalesce(ps.current_ability, 0) DESC, ps.display_name, ps.source_person_id
    LIMIT ?
    """,
    (*values, merge_limit),
))

canonical_clauses = ["l.database_slug = ?"]
canonical_values = [database]
for token in tokens[:10]:
    canonical_clauses.append("c.normalized_name LIKE ?")
    canonical_values.append(f"%{token}%")
canonical_ids = [
    str(row["source_person_id"])
    for row in identity.execute(
        f"""
        SELECT l.source_person_id
        FROM player_identity_links l
        JOIN canonical_players c ON c.id = l.canonical_player_id
        WHERE {' AND '.join(canonical_clauses)}
        LIMIT ?
        """,
        (*canonical_values, merge_limit),
    )
]

if canonical_ids:
    source_clauses = ["ps.database_slug = ?"]
    source_values = [database]
    for column, value in (("club_name", club), ("league_name", league), ("nation_name", nation)):
        if value:
            source_clauses.append(f"ps.{column} = ?")
            source_values.append(value)
    source_clauses.append(
        f"cast(ps.source_person_id AS TEXT) IN ({','.join('?' for _ in canonical_ids)})"
    )
    rows.extend(
        connection.execute(
            f"""
            SELECT ps.database_slug, ps.source_person_id, ps.display_name, ps.full_name,
                   ps.common_name, ps.club_name, ps.nation_name, ps.date_of_birth,
                   ps.season_age AS age, ps.position_text, ps.current_ability,
                   ps.potential_ability, ps.value, ps.wage
            FROM player_search ps
            WHERE {' AND '.join(source_clauses)}
            """,
            (*source_values, *canonical_ids),
        )
    )

unique_rows = {
    (str(row["database_slug"]), str(row["source_person_id"])): dict(row)
    for row in rows
}
ordered_rows = sorted(
    unique_rows.values(),
    key=lambda row: (
        -(int(row["current_ability"]) if row["current_ability"] is not None else 0),
        str(row["display_name"] or ""),
        str(row["source_person_id"]),
    ),
)
offset = (requested_page - 1) * requested_page_size
page_rows = ordered_rows[offset : offset + requested_page_size]
# ASCII-safe JSON avoids Windows console encodings corrupting accented names
# when Node captures this helper's stdout as UTF-8.
print(json.dumps(page_rows, ensure_ascii=True, separators=(",", ":")))
