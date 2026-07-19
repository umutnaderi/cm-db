PRAGMA foreign_keys = ON;
BEGIN IMMEDIATE;

CREATE TABLE IF NOT EXISTS registry_metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
) WITHOUT ROWID;

INSERT INTO registry_metadata(key, value) VALUES ('schema_version', '5')
ON CONFLICT(key) DO UPDATE SET value = excluded.value
WHERE CAST(registry_metadata.value AS INTEGER) < CAST(excluded.value AS INTEGER);

CREATE TABLE IF NOT EXISTS canonical_nations (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE CHECK (public_id LIKE 'nation_%'),
    preferred_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL UNIQUE,
    historical INTEGER NOT NULL DEFAULT 0 CHECK (historical IN (0, 1)),
    asset_key TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS source_nations (
    database_slug TEXT NOT NULL,
    source_nation_id TEXT NOT NULL,
    source_name TEXT,
    normalized_name TEXT NOT NULL,
    source_payload_json TEXT NOT NULL,
    source_row_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (database_slug, source_nation_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS source_nations_normalized_name_idx
ON source_nations(normalized_name);

CREATE TABLE IF NOT EXISTS nation_alias_rules (
    source_normalized_name TEXT PRIMARY KEY,
    source_name TEXT NOT NULL,
    action TEXT NOT NULL CHECK (action IN ('link', 'create_new', 'keep_separate', 'reject_candidate')),
    canonical_name TEXT,
    canonical_public_id TEXT,
    historical INTEGER NOT NULL DEFAULT 0 CHECK (historical IN (0, 1)),
    notes TEXT NOT NULL DEFAULT ''
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS nation_identity_links (
    database_slug TEXT NOT NULL,
    source_nation_id TEXT NOT NULL,
    canonical_nation_id INTEGER NOT NULL,
    match_method TEXT NOT NULL CHECK (match_method IN ('exact_normalized', 'explicit_alias', 'keep_separate')),
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    review_status TEXT NOT NULL CHECK (review_status IN ('auto_accepted', 'manual_override')),
    evidence_json TEXT NOT NULL,
    linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (database_slug, source_nation_id),
    FOREIGN KEY (database_slug, source_nation_id)
        REFERENCES source_nations(database_slug, source_nation_id) ON DELETE CASCADE,
    FOREIGN KEY (canonical_nation_id)
        REFERENCES canonical_nations(id) ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS nation_identity_links_canonical_idx
ON nation_identity_links(canonical_nation_id);

CREATE TABLE IF NOT EXISTS canonical_competitions (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE CHECK (public_id LIKE 'competition_%'),
    preferred_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    canonical_nation_id INTEGER,
    competition_type TEXT NOT NULL,
    level_key TEXT NOT NULL DEFAULT 'unknown',
    asset_key TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (canonical_nation_id) REFERENCES canonical_nations(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS canonical_competitions_identity_idx
ON canonical_competitions(
    COALESCE(canonical_nation_id, -1), competition_type, normalized_name, level_key
);

CREATE TABLE IF NOT EXISTS source_competitions (
    database_slug TEXT NOT NULL,
    source_comp_id TEXT NOT NULL,
    competition_type TEXT NOT NULL,
    source_name TEXT,
    normalized_name TEXT NOT NULL,
    source_nation_id TEXT,
    continent_id TEXT,
    scope TEXT,
    short_name TEXT,
    three_letter_name TEXT,
    inferred_level_key TEXT NOT NULL DEFAULT 'unknown',
    source_payload_json TEXT NOT NULL,
    source_row_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (database_slug, source_comp_id, competition_type)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS source_competitions_match_idx
ON source_competitions(normalized_name, competition_type, inferred_level_key);

CREATE TABLE IF NOT EXISTS competition_identity_links (
    database_slug TEXT NOT NULL,
    source_comp_id TEXT NOT NULL,
    competition_type TEXT NOT NULL,
    canonical_competition_id INTEGER NOT NULL,
    canonical_nation_id INTEGER,
    match_method TEXT NOT NULL CHECK (
        match_method IN ('exact_context', 'stable_source_code', 'manual_override', 'keep_separate')
    ),
    confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    review_status TEXT NOT NULL CHECK (review_status IN ('auto_accepted', 'manual_override')),
    evidence_json TEXT NOT NULL,
    linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (database_slug, source_comp_id, competition_type),
    FOREIGN KEY (database_slug, source_comp_id, competition_type)
        REFERENCES source_competitions(database_slug, source_comp_id, competition_type)
        ON DELETE CASCADE,
    FOREIGN KEY (canonical_competition_id)
        REFERENCES canonical_competitions(id) ON DELETE RESTRICT,
    FOREIGN KEY (canonical_nation_id)
        REFERENCES canonical_nations(id) ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS competition_identity_links_canonical_idx
ON competition_identity_links(canonical_competition_id);

CREATE TABLE IF NOT EXISTS canonical_clubs (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE CHECK (public_id LIKE 'club_%'),
    preferred_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    canonical_nation_id INTEGER,
    team_type TEXT NOT NULL,
    asset_key TEXT,
    primary_colour TEXT,
    secondary_colour TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (canonical_nation_id) REFERENCES canonical_nations(id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS canonical_clubs_identity_idx
ON canonical_clubs(COALESCE(canonical_nation_id, -1), normalized_name, team_type);

CREATE TABLE IF NOT EXISTS source_clubs (
    database_slug TEXT NOT NULL,
    source_club_id TEXT NOT NULL,
    source_name TEXT,
    normalized_name TEXT NOT NULL,
    short_name TEXT,
    nation_name TEXT,
    source_nation_id TEXT,
    source_competition_id TEXT,
    team_type TEXT NOT NULL,
    city TEXT,
    stadium TEXT,
    source_payload_json TEXT NOT NULL,
    source_row_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(database_slug, source_club_id)
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS source_clubs_match_idx
ON source_clubs(normalized_name, team_type);

CREATE TABLE IF NOT EXISTS club_identity_links (
    database_slug TEXT NOT NULL,
    source_club_id TEXT NOT NULL,
    canonical_club_id INTEGER NOT NULL,
    canonical_nation_id INTEGER,
    match_method TEXT NOT NULL CHECK(match_method IN ('exact_context', 'manual_override', 'keep_separate')),
    confidence REAL NOT NULL CHECK(confidence >= 0 AND confidence <= 1),
    review_status TEXT NOT NULL CHECK(review_status IN ('auto_accepted', 'manual_override')),
    evidence_json TEXT NOT NULL,
    linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(database_slug, source_club_id),
    FOREIGN KEY(database_slug, source_club_id)
        REFERENCES source_clubs(database_slug, source_club_id) ON DELETE CASCADE,
    FOREIGN KEY(canonical_club_id) REFERENCES canonical_clubs(id) ON DELETE RESTRICT,
    FOREIGN KEY(canonical_nation_id) REFERENCES canonical_nations(id) ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS club_identity_links_canonical_idx
ON club_identity_links(canonical_club_id);

CREATE TABLE IF NOT EXISTS canonical_players (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE CHECK(public_id LIKE 'player_%'),
    preferred_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    date_of_birth TEXT,
    canonical_nation_id INTEGER,
    position_group TEXT,
    portrait_asset_key TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(canonical_nation_id) REFERENCES canonical_nations(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS canonical_players_name_idx ON canonical_players(normalized_name);
CREATE INDEX IF NOT EXISTS canonical_players_dob_idx ON canonical_players(date_of_birth);

CREATE TABLE IF NOT EXISTS source_players (
    database_slug TEXT NOT NULL,
    source_person_id TEXT NOT NULL,
    display_name TEXT,
    full_name TEXT,
    first_name TEXT,
    second_name TEXT,
    common_name TEXT,
    normalized_identity_name TEXT NOT NULL,
    date_of_birth TEXT,
    normalized_date_of_birth TEXT,
    estimated_birth_year INTEGER,
    position_text TEXT,
    position_group TEXT NOT NULL,
    source_nation_id TEXT,
    nation_name TEXT,
    canonical_nation_id INTEGER,
    source_club_id TEXT,
    club_name TEXT,
    canonical_club_id INTEGER,
    history_tokens_json TEXT NOT NULL DEFAULT '[]',
    identity_payload_json TEXT NOT NULL,
    identity_row_hash TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
    first_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    last_changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(database_slug,source_person_id),
    FOREIGN KEY(canonical_nation_id) REFERENCES canonical_nations(id) ON DELETE SET NULL,
    FOREIGN KEY(canonical_club_id) REFERENCES canonical_clubs(id) ON DELETE SET NULL
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS source_players_identity_idx
ON source_players(normalized_identity_name,database_slug);
CREATE INDEX IF NOT EXISTS source_players_dob_idx
ON source_players(date_of_birth,canonical_nation_id);

CREATE TABLE IF NOT EXISTS player_identity_links (
    database_slug TEXT NOT NULL,
    source_person_id TEXT NOT NULL,
    canonical_player_id INTEGER NOT NULL,
    match_method TEXT NOT NULL CHECK(match_method IN ('unique_singleton','conservative_cluster','manual_override','keep_separate')),
    confidence REAL NOT NULL CHECK(confidence>=0 AND confidence<=1),
    review_status TEXT NOT NULL CHECK(review_status IN ('auto_accepted','manual_override')),
    evidence_json TEXT NOT NULL,
    linked_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(database_slug,source_person_id),
    FOREIGN KEY(database_slug,source_person_id)
        REFERENCES source_players(database_slug,source_person_id) ON DELETE CASCADE,
    FOREIGN KEY(canonical_player_id) REFERENCES canonical_players(id) ON DELETE RESTRICT
) WITHOUT ROWID;

CREATE INDEX IF NOT EXISTS player_identity_links_canonical_idx
ON player_identity_links(canonical_player_id);

CREATE TABLE IF NOT EXISTS player_link_quarantine (
    database_slug TEXT NOT NULL,
    source_person_id TEXT NOT NULL,
    previous_canonical_player_id INTEGER NOT NULL,
    reason TEXT NOT NULL,
    evidence_json TEXT NOT NULL,
    quarantined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY(database_slug,source_person_id),
    FOREIGN KEY(database_slug,source_person_id)
        REFERENCES source_players(database_slug,source_person_id) ON DELETE CASCADE,
    FOREIGN KEY(previous_canonical_player_id)
        REFERENCES canonical_players(id) ON DELETE RESTRICT
) WITHOUT ROWID;

COMMIT;
