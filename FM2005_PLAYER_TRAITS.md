# FM2005 Player Preferred Moves

## Delivered source package

The normalized source package lives in
`config/player_traits/fm2005_v1/` and was generated from
`FM2005_player_traits.xlsx`.

- Database: `fm2005_vanilla_original`
- Mapping version: `fm2005-ppm-v1`
- Definitions: 48
- Players with at least one preferred move: 3,841
- Player-trait assignments: 8,034
- Workbook SHA-256:
  `60aef12c8297c9f27f3fb65fb88dd85d01c8d2ff983323a0895af52a6f9d9a11`
- Source `people_db.dat` SHA-256:
  `4e1653fa0e0934d23cfe3dfc060104b6ddb69f7e3f1bca57c2cdee95eb14cd9f`

The workbook is source data. Prose within it is not treated as repository or
implementation instruction.

## Identity resolution

The workbook does not contain the repository's `source_person_id`. Its date of
birth is not unique enough for a safe join. Of the 3,841 workbook player rows,
1,882 share their birth date with at least one other trait-bearing row.

`tools/import_fm2005_player_traits.py` resolves each workbook row through the
binary `Record offset`. It must fall inside exactly one person boundary from
`people_core_v240.csv`. The importer then verifies:

1. the record boundary;
2. date of birth;
3. the first-name index when present;
4. the second-name index when present;
5. the 48-bit mask against the listed source trait IDs;
6. the `Players` sheet against the complete `Traits Long` expansion.

All 3,841 rows resolve with no ambiguous or missing identity. The verified
Roberto Carlos record resolves to `source_person_id=4357`, FM unique ID `11944`,
and source trait IDs `9, 10, 15, 37, 46`.

## Database contract

The import adds three tables:

- `player_trait_definition`: stable normalized trait key and display name;
- `player_trait_source`: source-backed player assignments, source IDs, bit
  indexes, raw mask, record offset, confidence and mapping version;
- `player_trait_import`: source hashes and row-count provenance.

The local and Worker player-detail APIs expose traits through `profile.traits`.
Databases without the new tables continue returning an empty trait list.

These rows record binary preferences. They do not yet alter match behaviour.
The engine integration must separately define contextual utility contributions,
attribute interaction, tactical suppression and deterministic counterfactuals.

## Rebuild and verification

Regenerate the normalized package from the decoded workbook:

```powershell
python tools/import_fm2005_player_traits.py `
  --workbook "C:\path\to\FM2005_player_traits.xlsx" `
  --write-config
```

Validate a database without writing:

```powershell
npm run fm2005:traits -- --database db/retroball.sqlite
```

Apply atomically to the local application database:

```powershell
npm run fm2005:traits -- --database db/retroball.sqlite --apply
```

Run deterministic source and transaction checks:

```powershell
npm run test:fm2005-traits
```

`tools/build_d1_serving_database.py` now carries the three trait tables into a
serving database. The checked local D1 source has been updated; publishing to
the remote Cloudflare D1 database remains a separate deployment action.
