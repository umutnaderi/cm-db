# Retroball identity registry: Phase 1

The identity registry is persistent and separate from the generated game database. The
source database is opened in SQLite read-only/query-only mode; source nation rows are
copied into `source_nations` as complete JSON snapshots after inspecting the live schema
with `PRAGMA table_info(nations)`.

Run the Phase 1 pipeline from the repository root:

```powershell
python tools/identity/create_registry.py
python tools/identity/sync_source_entities.py
python tools/identity/link_nations.py
python tools/identity/audit_links.py
```

Phase 2 competition linking runs after nations:

```powershell
python tools/identity/sync_competitions.py
python tools/identity/link_competitions.py
python tools/identity/audit_competitions.py
```

Competition matching is scoped by canonical nation (or continent/scope for the source
`nation_id = -2` sentinel), competition type, and inferred level. A stable source code
may bridge renamed competitions only when it is unique per database and the name/level
evidence is compatible. Other variants remain separate and appear in the ambiguity audit.

Phases 3 and 4 run in dependency order:

```powershell
python tools/identity/sync_clubs.py
python tools/identity/link_clubs.py
python tools/identity/sync_players.py
python tools/identity/link_players.py
python tools/identity/enforce_player_safety.py
python tools/identity/audit_players.py
```

Player matching preserves raw DOB values and uses a separate normalized DOB. Exact names
only create candidate blocks; canonical nation, canonical club, position, DOB proximity,
adjacent seasons, and career overlap determine whether candidates merge. Components may
never contain two people from one source database or span more than two DOB days. Common
names require stronger evidence. Unsafe components are quarantined and remain unresolved.

Edit `config/identity/nation_aliases.csv` for explicit decisions. Supported actions are
`link`, `create_new`, `keep_separate`, and `reject_candidate`. Canonical rows are never
deleted by these scripts, and an existing canonical `public_id` is rejected rather than
silently changed. Internal integer IDs are deterministic 63-bit hashes of those stable
public IDs, so they do not depend on source IDs or insertion order. Removed source records
are marked inactive instead of being discarded.

Generated reports are written to `audit/identity/`.
