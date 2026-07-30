ALTER TABLE draft_records ADD COLUMN dominator_name TEXT NOT NULL DEFAULT '—';
ALTER TABLE draft_records ADD COLUMN dominator_database TEXT;
ALTER TABLE draft_records ADD COLUMN dominator_source_person_id TEXT;
ALTER TABLE draft_records ADD COLUMN dominator_awards INTEGER NOT NULL DEFAULT 0;
