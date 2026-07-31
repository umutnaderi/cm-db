# Retroball D1 migration

This migration keeps the existing Turso-backed Worker version available for
rollback until the D1 database and production API have been verified.

## 1. Build and export the serving database

Run from the repository root:

```powershell
npm run d1:build
npm run d1:export
npm run d1:club-colours
npm run d1:club-names
npm run d1:player-names
npm run d1:player-search
```

Generated artifacts are written below `data/d1/` and are ignored by Git.
The SQL export is split into statement-safe 90 MB chunks. The build refuses
to overwrite an existing database or chunk set. The club-colour build reads
the canonical club registry and the original `colour.dat` palette, then writes
`data/d1/canonical-club-colours.sql`. The name lookups preserve every raw
source value while supplying canonical player/club display names and exact
cross-season player IDs to the API.

## 2. Confirm the D1 database

Run from `worker/`:

```powershell
npx wrangler d1 info retroball-db
```

The database binding is `DB` and is defined in `worker/wrangler.jsonc`.

## 3. Validate with local D1

```powershell
Get-ChildItem ..\data\d1\chunks\*.sql |
  Sort-Object Name |
  ForEach-Object {
    npx wrangler d1 execute retroball-db --local --file $_.FullName
    if ($LASTEXITCODE) { throw "Local D1 import failed: $($_.Name)" }
  }
npx wrangler d1 execute retroball-db --local --file ..\data\d1\canonical-club-colours.sql
npx wrangler d1 execute retroball-db --local --file ..\data\d1\canonical-club-names.sql
Get-ChildItem ..\data\d1\canonical-player-name-chunks\*.sql |
  Sort-Object Name |
  ForEach-Object {
    npx wrangler d1 execute retroball-db --local --file $_.FullName
    if ($LASTEXITCODE) { throw "Local canonical player import failed: $($_.Name)" }
  }
Get-ChildItem ..\data\d1\player-name-search-chunks\*.sql |
  Sort-Object Name |
  ForEach-Object {
    npx wrangler d1 execute retroball-db --local --file $_.FullName
    if ($LASTEXITCODE) { throw "Local player search import failed: $($_.Name)" }
  }
npx wrangler dev
```

For WSL/Linux:

```bash
for file in ../data/d1/chunks/*.sql; do
  npx wrangler d1 execute retroball-db --local --file "$file" || exit 1
done
npx wrangler dev
```

In a second terminal:

```powershell
curl.exe "http://localhost:8787/api/databases"
curl.exe "http://localhost:8787/api/players?database=cm0304_vanilla_original&q=ronaldo&pageSize=5"
```

## 4. Import the remote D1 database

Ensure the Cloudflare account plan supports the generated database size, then
run:

```powershell
Get-ChildItem ..\data\d1\chunks\*.sql |
  Sort-Object Name |
  ForEach-Object {
    npx wrangler d1 execute retroball-db --remote --file $_.FullName
    if ($LASTEXITCODE) { throw "Remote D1 import failed: $($_.Name)" }
  }
npx wrangler d1 execute retroball-db --remote --yes --file ..\data\d1\canonical-club-colours.sql
npx wrangler d1 execute retroball-db --remote --yes --file ..\data\d1\canonical-club-names.sql
Get-ChildItem ..\data\d1\canonical-player-name-chunks\*.sql |
  Sort-Object Name |
  ForEach-Object {
    npx wrangler d1 execute retroball-db --remote --yes --file $_.FullName
    if ($LASTEXITCODE) { throw "Canonical player import failed: $($_.Name)" }
  }
Get-ChildItem ..\data\d1\player-name-search-chunks\*.sql |
  Sort-Object Name |
  ForEach-Object {
    npx wrangler d1 execute retroball-db --remote --yes --file $_.FullName
    if ($LASTEXITCODE) { throw "Player search import failed: $($_.Name)" }
  }
```

Do not interrupt the import. Validate row counts afterward:

```powershell
npx wrangler d1 execute retroball-db --remote --command "SELECT count(*) AS databases FROM cm_databases"
npx wrangler d1 execute retroball-db --remote --command "SELECT count(*) AS players FROM player_search"
npx wrangler d1 execute retroball-db --remote --command "SELECT count(*) AS profiles FROM player_profile"
npx wrangler d1 execute retroball-db --remote --command "SELECT count(*) AS canonical_player_names FROM canonical_player_names"
```

Expected counts:

- `cm_databases`: 8
- `player_search`: 654170
- `player_profile`: 654170

## 5. Deploy and verify

```powershell
npx wrangler deploy
curl.exe -i "https://retroball-api.umutnaderi.workers.dev/api/databases"
```

Verify player search, profile, history, filters, and season badges before
removing Turso.

## 6. Remove the retired Turso secrets

Only after production verification:

```powershell
npx wrangler secret delete TURSO_DATABASE_URL
npx wrangler secret delete TURSO_AUTH_TOKEN
```

If production verification fails, use `npx wrangler rollback` to restore the
previous Worker version.
