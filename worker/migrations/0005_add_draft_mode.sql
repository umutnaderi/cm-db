ALTER TABLE draft_records ADD COLUMN mode TEXT NOT NULL DEFAULT 'Classic';

CREATE INDEX IF NOT EXISTS draft_records_mode_leaderboard
  ON draft_records(mode, champion DESC, stage_rank DESC, wins DESC, goals_for DESC, updated_at ASC);
