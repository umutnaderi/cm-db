CREATE TABLE IF NOT EXISTS draft_records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  username TEXT NOT NULL,
  username_key TEXT NOT NULL,
  team_name TEXT NOT NULL,
  stage TEXT NOT NULL,
  stage_rank INTEGER NOT NULL DEFAULT 0,
  champion INTEGER NOT NULL DEFAULT 0,
  captain_name TEXT NOT NULL,
  captain_database TEXT,
  captain_source_person_id TEXT,
  top_scorer_name TEXT NOT NULL,
  top_scorer_database TEXT,
  top_scorer_source_person_id TEXT,
  top_scorer_goals INTEGER NOT NULL DEFAULT 0,
  played INTEGER NOT NULL DEFAULT 0,
  wins INTEGER NOT NULL DEFAULT 0,
  draws INTEGER NOT NULL DEFAULT 0,
  losses INTEGER NOT NULL DEFAULT 0,
  goals_for INTEGER NOT NULL DEFAULT 0,
  goals_against INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(run_id, username_key)
);

CREATE INDEX IF NOT EXISTS draft_records_leaderboard
  ON draft_records(champion DESC, stage_rank DESC, wins DESC, goals_for DESC, updated_at ASC);
