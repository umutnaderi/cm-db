CREATE TABLE IF NOT EXISTS draft_squads (
  seed TEXT PRIMARY KEY,
  team_name TEXT NOT NULL,
  formation TEXT NOT NULL,
  style TEXT NOT NULL,
  squad_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE draft_records ADD COLUMN squad_seed TEXT;

CREATE INDEX IF NOT EXISTS draft_records_squad_seed
  ON draft_records(squad_seed);
