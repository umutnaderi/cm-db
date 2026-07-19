PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_nations (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    preferred_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    iso_alpha2 TEXT,
    iso_alpha3 TEXT,
    fifa_code TEXT,
    historical INTEGER NOT NULL DEFAULT 0,
    successor_nation_id INTEGER,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (successor_nation_id)
        REFERENCES canonical_nations(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_canonical_nations_normalized
ON canonical_nations(normalized_name);


CREATE TABLE IF NOT EXISTS nation_identity_links (
    database_slug TEXT NOT NULL,
    source_nation_id TEXT NOT NULL,
    canonical_nation_id INTEGER NOT NULL,

    source_name TEXT,
    normalized_source_name TEXT,

    match_method TEXT NOT NULL,
    confidence REAL NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'auto_accepted',
    evidence_json TEXT,

    PRIMARY KEY (database_slug, source_nation_id),

    FOREIGN KEY (canonical_nation_id)
        REFERENCES canonical_nations(id)
);

CREATE INDEX IF NOT EXISTS idx_nation_links_canonical
ON nation_identity_links(canonical_nation_id);


CREATE TABLE IF NOT EXISTS canonical_clubs (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,
    preferred_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,

    canonical_nation_id INTEGER,
    city_name TEXT,
    club_type TEXT NOT NULL DEFAULT 'club',
    founded_year INTEGER,

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (canonical_nation_id)
        REFERENCES canonical_nations(id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_clubs_name_nation
ON canonical_clubs(normalized_name, canonical_nation_id);


CREATE TABLE IF NOT EXISTS club_identity_links (
    database_slug TEXT NOT NULL,
    source_club_id TEXT NOT NULL,
    canonical_club_id INTEGER NOT NULL,

    source_name TEXT,
    normalized_source_name TEXT,
    source_nation_id TEXT,
    source_city_name TEXT,
    source_stadium_name TEXT,

    match_method TEXT NOT NULL,
    confidence REAL NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'auto_accepted',
    evidence_json TEXT,

    PRIMARY KEY (database_slug, source_club_id),

    FOREIGN KEY (canonical_club_id)
        REFERENCES canonical_clubs(id)
);

CREATE INDEX IF NOT EXISTS idx_club_links_canonical
ON club_identity_links(canonical_club_id);


CREATE TABLE IF NOT EXISTS canonical_players (
    id INTEGER PRIMARY KEY,
    public_id TEXT NOT NULL UNIQUE,

    preferred_name TEXT NOT NULL,
    normalized_name TEXT NOT NULL,
    canonical_date_of_birth TEXT,
    canonical_nation_id INTEGER,

    identity_status TEXT NOT NULL DEFAULT 'active',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (canonical_nation_id)
        REFERENCES canonical_nations(id)
);

CREATE INDEX IF NOT EXISTS idx_canonical_players_name
ON canonical_players(normalized_name);

CREATE INDEX IF NOT EXISTS idx_canonical_players_dob
ON canonical_players(canonical_date_of_birth);


CREATE TABLE IF NOT EXISTS player_identity_links (
    database_slug TEXT NOT NULL,
    source_person_id TEXT NOT NULL,
    canonical_player_id INTEGER NOT NULL,

    source_name TEXT,
    normalized_source_name TEXT,
    source_date_of_birth TEXT,
    source_nation_id TEXT,
    source_club_id TEXT,

    match_method TEXT NOT NULL,
    confidence REAL NOT NULL,
    review_status TEXT NOT NULL DEFAULT 'auto_accepted',
    evidence_json TEXT,

    PRIMARY KEY (database_slug, source_person_id),

    FOREIGN KEY (canonical_player_id)
        REFERENCES canonical_players(id)
);

CREATE INDEX IF NOT EXISTS idx_player_links_canonical
ON player_identity_links(canonical_player_id);


CREATE TABLE IF NOT EXISTS club_branding (
    id INTEGER PRIMARY KEY,
    canonical_club_id INTEGER NOT NULL,

    valid_from_database_slug TEXT,
    valid_to_database_slug TEXT,

    primary_color TEXT,
    secondary_color TEXT,
    accent_color TEXT,

    logo_asset_key TEXT,
    logo_source TEXT,
    license_status TEXT,

    FOREIGN KEY (canonical_club_id)
        REFERENCES canonical_clubs(id)
);

CREATE INDEX IF NOT EXISTS idx_club_branding_lookup
ON club_branding(canonical_club_id);


CREATE TABLE IF NOT EXISTS nation_assets (
    canonical_nation_id INTEGER PRIMARY KEY,

    flag_asset_key TEXT,
    crest_asset_key TEXT,

    primary_color TEXT,
    secondary_color TEXT,

    asset_source TEXT,
    license_status TEXT,

    FOREIGN KEY (canonical_nation_id)
        REFERENCES canonical_nations(id)
);


CREATE TABLE IF NOT EXISTS player_portraits (
    id INTEGER PRIMARY KEY,
    canonical_player_id INTEGER NOT NULL,

    database_slug TEXT,
    season_label TEXT,

    asset_key TEXT NOT NULL,
    source_url TEXT,
    license_status TEXT,
    is_default INTEGER NOT NULL DEFAULT 0,

    FOREIGN KEY (canonical_player_id)
        REFERENCES canonical_players(id)
);

CREATE INDEX IF NOT EXISTS idx_player_portraits_lookup
ON player_portraits(canonical_player_id, database_slug);