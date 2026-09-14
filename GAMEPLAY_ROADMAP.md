# Retroball: Canonical Data to Gameplay Roadmap

Last updated: 2026-09-14

## Goal

Build a football-management game whose matches, tactical choices and long-term
consequences resemble real football. Stable canonical identities remain the save
foundation. The existing `draft-setup` / `draft-run` game is now a useful,
playable prototype, while Match Lab is the proving environment for the richer,
authoritative match engine. The next product slice joins those strengths without
destabilising the existing draft game; career mode follows only after that new
single-match loop is proven.

## Status legend

- [x] Complete
- [~] In progress or usable but still needs verification
- [ ] Not started
- [!] Blocked or requires a decision

## Product direction update (2026-09-14)

| Product slice | Status | Purpose |
| --- | --- | --- |
| Existing `draft-setup` / `draft-run` | **Built and preserved** | Keep the current short game playable and available as a regression baseline |
| Match Lab engine | **Active proving ground** | Establish authoritative tactics, decisions, motion, ball physics, restarts, full-match sessions and replay evidence |
| Player behavioural traits | Planned | Give each player persistent, source-backed tendencies that bias suitable actions and movement without overriding tactics, attributes or live geometry |
| Engine-backed draft game | Planned | Add a separate draft match setup and match runner powered by the proven Match Lab engine |
| Human in-match management | Planned | Let the user prepare tactics and apply changes whenever play is stopped without restarting the match |
| Adaptive opponent manager | Planned | Let the opponent diagnose the match and make legal, explainable tactical changes in pursuit of a result |
| Career mode | Future | Build the persistent club, competition and season loop around the proven engine-backed match |

### Product boundary

Do not rewrite `draft-setup` or `draft-run` in place. They are a good compact
game and provide a stable comparison target. Build the richer version through
new entry points with a similar setup flow and a separate match runner. Both
Match Lab and the new game runner must consume shared, renderer-neutral engine
modules; neither page may own a private copy of football logic.

The existing draft game remains usable throughout development. Promotion of the
new runner happens only after saved-seed replay, laws, match duration, tactics,
performance and browser acceptance gates pass.

Real-match footage is an ongoing design input for this track. Submit and review
cases through [`FOOTAGE_REVIEW_TEMPLATE.md`](./FOOTAGE_REVIEW_TEMPLATE.md) so
each clip becomes a reusable observation, trace requirement and deterministic
acceptance case rather than a scripted recreation of one match.

## Phase 5: Engine-backed draft game

This phase starts from the already working draft experience rather than from a
blank product. The implementation should reuse its successful flow and visual
shape while replacing its match simulation through an isolated route.

### 5.1 Freeze and characterize the existing draft game

- [x] Preserve representative `draft-setup` and `draft-run` scenarios as
  deterministic regression fixtures.
- [x] Record the current setup inputs, draft rules, progression, results,
  statistics, navigation and save/reload behaviour.
- [x] Define which presentation and game-flow behaviours the new version must
  retain, and which simplified match outcomes it intentionally replaces.
- [~] Keep the old pages runnable until the new game passes its promotion gate.

Delivered in the first migration slice: see
[`DRAFT_ENGINE_MIGRATION_BASELINE.md`](./DRAFT_ENGINE_MIGRATION_BASELINE.md),
the executable legacy fixture and `npm run test:product-match-contract`. The
existing draft pages were not edited.

### 5.2 Define the shared match input and output contracts

- [x] Define a versioned match input containing engine version, seed, teams,
  squads, lineups, substitutes, formations, roles, duties and team/player
  instructions.
- [x] Define a versioned continuation state containing clock, score, possession,
  authoritative player and ball state, stamina, cards, injuries, substitutions,
  tactics, decision memory and RNG state.
- [x] Define renderer-neutral outputs for the timeline, commentary, statistics,
  heat maps, disciplinary events, injuries, substitutions and final result.
- [ ] Extract or expose the Match Lab orchestration through shared engine APIs;
  the product runner must not call Match Lab DOM functions.
- [ ] Prove that Match Lab and the product runner reproduce the same match from
  the same versioned input and seed.

The v1 envelopes and legacy/current-setup adapters now live in
`src/lib/productMatchContract.js`. Extraction of the Match Lab chunk simulator
is deliberately the next step; declaring a contract alone does not establish
consumer parity.

### 5.3 Build the player-trait data and engine contract

Player traits represent recurring personal tendencies, not extra ability points
or guaranteed actions. Attributes describe whether and how well a player can
execute an action; roles, duties and instructions describe the manager's request;
traits bias what that player prefers when several physically and tactically valid
options remain.

- [~] Define a versioned, engine-neutral trait vocabulary for the first useful
  behaviours: pass risk and range, carrying and dribbling, shot selection,
  crossing, off-ball movement, pressing, tackling and set-piece tendencies.
- [x] Extract the initial trait data supplied from the FM 2005 database. Preserve
  each raw source value and map it to a normalized trait ID, strength or
  confidence, source database, source person ID and mapping-version provenance.
- [~] Add the normalized trait payload to the immutable gameplay player and
  shared match-input contracts while keeping saves without traits loadable.
- [ ] Define explicit interaction rules between traits, attributes, position,
  role, duty, team and individual instructions, match context and physical
  feasibility. Laws, authoritative geometry and kinetics remain hard constraints.
- [ ] Integrate a narrow first trait slice into action-candidate utility and
  coordinated movement selection. A trait may raise or lower a valid candidate's
  utility, but may not create an illegal option, teleport a player or guarantee
  execution or success.
- [ ] Record material trait contributions in replay diagnostics, including the
  candidates affected, contribution size, contextual suppressors and final
  selection, while keeping normal commentary concise.
- [ ] Add deterministic counterfactual fixtures where identical players, tactics,
  geometry and seeds with materially different traits produce explainable
  differences. Include negative cases where a trait is irrelevant, contradicted
  by the situation or cannot overcome physical reachability.
- [ ] After the FM 2005 mapping is proven, build a separate FC 26 source adapter
  into the same normalized vocabulary. Keep source meanings and mapping versions
  explicit rather than merging raw trait names or scales directly.
- [ ] Define conflict and precedence rules for players represented by multiple
  databases or seasons so updates are deliberate, auditable and save-compatible.
- [ ] Calibrate trait effects from saved Match Lab scenarios and footage-derived
  cases, then audit distributions over many seeds to prevent exaggerated or
  repetitive signature behaviour.

The FM 2005 source layer is now delivered in
[`FM2005_PLAYER_TRAITS.md`](./FM2005_PLAYER_TRAITS.md): 48 definitions and 8,034
assignments for 3,841 players, joined through exact binary record containment
with zero ambiguous identities. Traits are available from the player-detail API;
the in-progress items remain open until the match contract explicitly validates
them and candidate utility uses the normalized vocabulary.

### 5.4 Build a separate draft match setup

- [ ] Create a new setup entry point using the current draft setup as the UX
  reference without changing the existing page.
- [ ] Carry drafted squads and canonical player references into the shared match
  input contract.
- [ ] Let the user choose the starting XI, bench, formation, positions, roles,
  duties and compatible individual instructions.
- [ ] Expose team instructions for possession, transition and defending before
  kickoff.
- [ ] Validate goalkeeper, lineup, bench, role/position compatibility and legal
  squad constraints before starting.
- [ ] Save and reload the complete pre-match setup.

### 5.5 Build the engine-backed draft match runner

- [ ] Create a separate match page that consumes the shared authoritative match
  session used by Match Lab.
- [ ] Run kickoff through full time with lawful restarts, score, cards, fatigue,
  substitutions, statistics, commentary and replayable highlights.
- [ ] Keep the renderer a consumer of timeline state; it must not decide
  movement, contacts, possession or outcomes.
- [ ] Support pause, playback speed, tactical requests and match resumption from
  the preserved clock and continuation state.
- [ ] Persist the input, seed, event log and final state so the match can be
  reopened and reproduced.

### 5.6 Human tactical management before and during play

- [ ] Use one tactics model for pre-match setup, Match Lab and the product game.
- [ ] Allow formation and position changes, player swaps, roles, duties, team
  instructions, individual instructions and substitutions.
- [ ] During live play, treat edits as a tactical draft. Queue the request until
  play next stops unless the match is already stopped. Eligible moments include
  a foul or other whistle, any ball-out restart, a goal, an injury stoppage,
  half-time and the interval before a new period begins.
- [ ] Show the pending changes and require confirmation before applying them.
- [ ] Apply the confirmed changes to both the live roster and continuation state,
  then provide a clear **Resume match** action without resetting the clock,
  score, statistics, stamina, cards or RNG history.
- [ ] Reject illegal substitutions or formations with an actionable reason.
- [ ] Record every confirmed managerial change in the match timeline and replay.
- [ ] Demonstrate with same-seed counterfactuals that meaningful tactical changes
  produce measurable, football-coherent differences rather than cosmetic labels.

### 5.7 Adaptive opponent manager

- [ ] Give the opponent manager the same legal tactical vocabulary and physical
  engine constraints as the user. It may not receive hidden probability boosts,
  teleport players or directly force an outcome.
- [ ] Build an observation snapshot from information a real manager could use:
  score, clock, cards, injuries, fatigue, recent possession, territory, chances,
  shot quality, passing routes, pressure success, width, line gaps and recurring
  opposition threats.
- [ ] Separate diagnosis from response: identify a problem, rank compatible
  tactical responses, choose one deterministically, then apply it when play is
  stopped under the same rules used for the human manager.
- [ ] Support match-context objectives such as protecting a lead, seeking an
  equaliser, managing a dismissal, exploiting a weak flank, resisting a press,
  increasing pressure late, or conserving tired players.
- [ ] Add commitment time, cooldowns and minimum evidence thresholds so the AI
  does not reverse its shape or instructions after every event.
- [ ] Let manager ability, risk preference, club style and available personnel
  affect recognition, response quality and willingness without granting
  impossible knowledge.
- [ ] Record the observation, alternatives, selected adjustment, expected effect,
  application time and later evaluation in expandable diagnostics.
- [ ] Test identical seeds for determinism and controlled tactical
  counterfactuals for coherent differences. Include negative cases where the AI
  waits, chooses poorly, or cannot make the desired change with its squad.

### 5.8 Promotion gate for the new draft game

- [ ] Existing `draft-setup` / `draft-run` remains operational and unchanged in
  behaviour outside explicitly accepted fixes.
- [ ] A complete drafted match can be configured, played, tactically changed,
  finished, saved, loaded and replayed.
- [ ] User and opponent changes use the same tactics contract and only take
  effect at valid times.
- [ ] Same version, seed and inputs reproduce identical responsibility, action,
  motion, event and result history.
- [ ] Match-level audits show that tactics and attributes materially influence
  decisions while geometry, kinetics and the Laws remain authoritative.
- [ ] Full-match performance is acceptable for the target browser and does not
  degrade beyond an explicitly agreed budget.
- [ ] The new runner becomes the default only after comparison testing and a
  deliberate promotion decision; the old runner remains available until saved
  games and critical flows have migrated.

## Phase 6: Career-mode foundation

Career mode begins after the engine-backed draft match passes Phase 5. It should
reuse the same team, player, tactics and match contracts rather than create a
second simulation path.

### 6.1 Versioned career save

- [ ] Define club, manager, squad, competition, season and world-state schemas.
- [ ] Store canonical and source player identities, database version, identity
  mapping version, engine version and save-format version.
- [ ] Add atomic save/load, autosave, migration and corruption-recovery tests.
- [ ] Make every scheduled match retain enough input and seed data for replay and
  investigation.

### 6.2 Season and competition loop

- [ ] Implement the calendar, fixtures, league tables, cup rounds, draws,
  postponements and season transitions.
- [ ] Apply suspensions, injuries, registration and eligibility rules.
- [ ] Simulate non-user matches through a documented faster path whose aggregate
  results are calibrated against the authoritative engine.
- [ ] Add AI lineup and tactical selection for every managed club.

### 6.3 Club and squad management

- [ ] Add contracts, wages, budgets, transfers, loans and squad registration.
- [ ] Add scouting and imperfect player knowledge.
- [ ] Add training, development, aging, condition, morale, form and injuries with
  effects that reach the shared match inputs.
- [ ] Add staff and facilities only where they produce measurable changes in the
  supported systems.

### 6.4 Career management and world behaviour

- [ ] Add board expectations, objectives, reputation, job security and manager
  movement between clubs.
- [ ] Give AI clubs persistent sporting and financial plans rather than isolated
  per-match choices.
- [ ] Add inbox, news, reports and decision deadlines around real world-state
  changes.
- [ ] Ensure long-term AI decisions remain explainable and reproducible enough
  to diagnose a save without requiring every season to be globally identical.

### 6.5 Career promotion gate

- [ ] Complete at least one multi-season deterministic soak test without broken
  identities, impossible schedules, invalid squads or save corruption.
- [ ] Prove that career state changes reach matches through versioned inputs and
  match results return through versioned outputs.
- [ ] Establish performance budgets for daily processing, match simulation,
  autosave size and save migration.
- [ ] Keep the standalone draft game as the fast-play mode using the same engine.

## Current baseline

The figures and unchecked items in the original Phases 1-4 below are retained
as the July 2026 data and prototype baseline. Their implementation status must
be refreshed before using them as a current task list: `draft-setup`,
`draft-run`, the Match Lab full-match session and several tactical systems have
advanced substantially since this snapshot. The Phase 5 and Phase 6 track above
is the current product direction.

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

1. Extract the Match Lab chunk simulator behind renderer-neutral match-session
   engine APIs.
2. Make Match Lab consume that API and preserve its current seeded behaviour.
3. Add a headless parity fixture proving the extracted engine reproduces the
   same timeline and responsibility history for the same input and seed.
4. Define the normalized player-trait vocabulary and map the first FM 2005
   source traits with raw-value and mapping-version provenance.
5. Integrate a small, traceable trait slice into candidate selection and prove
   its influence with deterministic counterfactuals.
6. Build the separate engine-backed draft setup and runner behind new entry
   points.
7. Integrate pre-match tactics and confirmed changes whenever play stops,
   including fouls, ball-out restarts, goals, injuries and half-time, alongside
   substitutions and lossless match resumption.
8. Add the first adaptive opponent-manager slice: match diagnosis, one ranked
   response, application while play is stopped, cooldown and trace evidence.
9. Pass the new draft game's determinism, laws, tactics, performance and
   save/replay promotion gate before making it the default.
10. Begin the versioned career save and season loop only after that promotion.

In parallel, complete the data foundations that career saves depend on: define
canonical schema v1 and the immutable gameplay player reference, reconcile the
remaining high-priority identities and clubs, add local API versus D1 contract
tests, and freeze an eligible initial player pool.
