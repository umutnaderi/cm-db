# Retroball: Canonical Data to Gameplay Roadmap

Last updated: 2026-07-28

## Goal

Build gameplay on stable canonical identities without waiting for every historical
data ambiguity to be solved. We will first reach a defined **gameplay-ready data
gate**, freeze it as canonical schema v1, and then build a small playable draft
and match-simulation slice.

## Status legend

- [x] Complete
- [~] In progress or usable but still needs verification
- [ ] Not started
- [!] Blocked or requires a decision

## Current baseline

Snapshot from `identity/retroball_identity.sqlite` on 2026-07-28:

| Entity | Source rows | Linked rows | Canonical entities | Current status |
| --- | ---: | ---: | ---: | --- |
| Nations | 1,502 | 1,502 | 240 | Complete |
| Competitions | 996 | 996 | 426 | Linked; ambiguity review remains |
| Clubs | 58,983 | 58,938 | 29,049 | 45 source clubs unresolved |
| Players | 654,170 | 645,893 | 287,687 | 8,277 source players unresolved |

Additional player context:

- 548,155 active player rows currently have a canonical club context.
- Some missing club contexts are legitimate, such as free agents or records with
  no source club. They must be distinguished from failed club resolution.
- Player safety rules currently prevent duplicate people from the same database
  entering one canonical identity and reject unsafe date-of-birth spreads.

## Phase 1: Reach the gameplay-ready data gate

### 1. Canonical identity completion

- [x] Create stable canonical nation IDs.
- [x] Link every active nation source row.
- [x] Create and link canonical competitions.
- [~] Review competition ambiguities and confirm display names.
- [x] Create stable canonical club IDs.
- [~] Resolve the remaining 45 source clubs or explicitly quarantine them.
- [x] Support canonical club display names while preserving raw names.
- [x] Propagate verified club foreground/background colours through canonical links.
- [x] Resolve official and short club-name variants such as `Man Utd`.
- [x] Merge confirmed variants such as:
  - `FC Barcelona` / `F.C. Barcelona`
  - `Real Madrid` / `Real Madrid C.F.`
  - `Inter` / `Internazionale`
  - `Monaco` / `AS Monaco`
- [~] Review the 8,277 unresolved player rows.
- [ ] Classify unresolved players as:
  - safe manual link;
  - intentional singleton;
  - insufficient evidence/quarantined;
  - source-data error.
- [ ] Prioritize gameplay-relevant unresolved players by reputation, ability,
  appearances, and number of seasons.
- [ ] Confirm that every player eligible for the first draft pool has a canonical ID.

### 2. Integrity and regression checks

- [x] Preserve source database slug and source person/club IDs.
- [x] Keep raw source names alongside canonical display names.
- [~] Maintain manual player and club override files.
- [ ] Add one command that runs the complete canonical audit.
- [ ] Require zero unsafe player components.
- [ ] Require zero duplicate source-database members inside one canonical player.
- [ ] Require zero broken canonical foreign-key references.
- [ ] Report missing club context separately from legitimate free agents.
- [ ] Add regression fixtures for important cross-season examples:
  - Ronaldo
  - Kaká
  - Ryan Giggs
  - David Trézéguet
  - Giovanni van Bronckhorst
  - Walter Samuel
- [ ] Add regression fixtures for club colours and orientation:
  - F.C. Barcelona: dark-blue background, red foreground
  - Manchester United: red background, white foreground
  - Internazionale: black background, blue foreground
  - AS Roma: red background, yellow foreground
  - Boca Juniors: blue background, yellow foreground
  - Real Madrid C.F.: white background, blue foreground

### 3. Stable gameplay-facing data contract

- [ ] Define canonical schema v1.
- [ ] Return these identifiers consistently from local API and D1:
  - `canonical_player_id`
  - `canonical_club_id`
  - `canonical_nation_id`
  - `canonical_competition_id`
  - `database_slug`
  - `source_person_id`
- [ ] Define the immutable player reference used by saves:

  ```text
  canonical_player_id + database_slug + source_person_id
  ```

- [ ] Add an identity mapping version to saved games.
- [ ] Decide how a save behaves when a future canonical mapping changes.
- [ ] Add API contract tests comparing local API and the Cloudflare D1 Worker.
- [ ] Document nullable and quarantined identity behavior.

## Gameplay-ready exit criteria

Gameplay work may begin when all of the following are true:

- [ ] Every player in the initial draft pool has a canonical player ID.
- [ ] Every draftable player's club and nation are resolved or explicitly marked
  as legitimately absent.
- [ ] Nations and competitions have no unexplained unresolved rows.
- [ ] The 45 unresolved clubs are linked or explicitly quarantined.
- [ ] Player safety audit has zero violations.
- [ ] Local API and D1 return the same canonical IDs for the regression fixtures.
- [ ] Canonical schema v1 and its mapping version are documented.
- [ ] A saved player reference can be loaded without name-based matching.

The full historical database does **not** need to be 100% manually resolved before
gameplay. Uncertain rows may remain quarantined as long as they cannot enter the
initial draft pool or silently corrupt a save.

## Phase 2: Draft vertical slice

### 1. Draft rules and domain model

- [ ] Decide draft format:
  - number of teams;
  - human/AI participants;
  - snake or linear order;
  - squad size;
  - position limits;
  - duplicate-player policy;
  - database/season selection.
- [ ] Define draft entities:
  - draft;
  - participant/team;
  - draft slot;
  - pick;
  - roster;
  - draft event log.
- [ ] Store canonical and source-season player references on every pick.
- [ ] Make draft actions deterministic and replayable.

### 2. Draft persistence and API

- [ ] Create a draft.
- [ ] Join or configure participants.
- [ ] Load the eligible player pool.
- [ ] Make and validate a pick.
- [ ] Reject duplicate or illegal picks.
- [ ] Persist draft order, current turn, picks, and rosters.
- [ ] Reload an unfinished draft.
- [ ] Complete and lock a draft.
- [ ] Add save-format versioning.

### 3. Draft UI

- [ ] Reuse the canonical player search/profile interface.
- [ ] Show availability and drafted status.
- [ ] Show current turn and draft order.
- [ ] Show roster composition and positional warnings.
- [ ] Add undo only while the draft rules permit it.
- [ ] Verify desktop and mobile layouts.

## Phase 3: Minimal gameplay vertical slice

### 1. Team and lineup

- [ ] Select a starting lineup from a drafted roster.
- [ ] Validate formation and positional eligibility.
- [ ] Assign substitutes.
- [ ] Store tactics using versioned, deterministic inputs.

### 2. Match simulation v1

- [ ] Define the first small set of player inputs used by the engine.
- [ ] Define team-strength and positional-fit calculations.
- [ ] Use a seeded random number generator.
- [ ] Generate a deterministic match from:

  ```text
  engine_version + seed + teams + lineups + tactics
  ```

- [ ] Produce score, events, player ratings, and basic statistics.
- [ ] Save the simulation inputs and event log.
- [ ] Replay the same match from the saved seed and reproduce the result.

### 3. First playable loop

- [ ] Draft two teams.
- [ ] Choose lineups.
- [ ] Simulate one match.
- [ ] Show the result and event timeline.
- [ ] Save and reload the draft, lineups, and match.

## Phase 4: Expansion after the vertical slice

- [ ] AI drafting strategies.
- [ ] Multiple formations and tactical instructions.
- [ ] Fatigue, injuries, suspensions, and substitutions.
- [ ] Competitions, schedules, tables, and knockout rounds.
- [ ] Player development and aging.
- [ ] Transfers and contracts.
- [ ] Long-term save migrations.
- [ ] Multiplayer or shared drafts.

## Progress log

### 2026-07-28

- [x] Confirmed nations are fully linked.
- [x] Confirmed competitions are fully linked at source-row level.
- [x] Reduced unresolved clubs to 45 source rows.
- [x] Confirmed 645,893 of 654,170 active player rows are canonically linked.
- [x] Implemented canonical club display-name and colour propagation.
- [x] Added official/short-name resolution for early databases.
- [x] Corrected and verified important club colour orientations in local API and D1.
- [x] Chose to finish the gameplay-ready canonical data gate before building the
  draft vertical slice.

## Immediate next tasks

1. Generate a ranked report for the 8,277 unresolved players.
2. Resolve or quarantine the 45 remaining clubs.
3. Define canonical schema v1 and the gameplay-facing player reference.
4. Add local API versus D1 contract tests.
5. Freeze the initial eligible draft pool.
6. Specify the draft rules and implement the smallest persistent draft.
