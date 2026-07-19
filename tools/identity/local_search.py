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

rows = connection.execute(
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
    LIMIT ? OFFSET ?
    """,
    (*values, int(page_size), (int(page) - 1) * int(page_size)),
)
# ASCII-safe JSON avoids Windows console encodings corrupting accented names
# when Node captures this helper's stdout as UTF-8.
print(json.dumps([dict(row) for row in rows], ensure_ascii=True, separators=(",", ":")))
