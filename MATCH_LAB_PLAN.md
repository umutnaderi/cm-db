# Match Lab — Playground Page Plan

Status: planned, not started. Captures the design synthesis before any code
changes, so the sequencing survives even if work is picked up in a later
session.

## Goal

A standalone page (`/match-lab`) for observing and probing the match
engine directly — search for real players, place them (and a defender/
keeper) on a pitch, and ask "given this state, what does the engine
decide?" without needing to run a full simulated match to stumble into the
situation. Motivating example: does David Beckham on the right flank
actually cross to Ruud van Nistelrooy in the box, and how does that change
if a defender closes him down?

This was scoped across two rounds of external (ChatGPT) review, each
evaluated critically rather than adopted wholesale — see "Decisions" below
for what was kept, changed, or rejected and why.

## Core semantics (agreed, unchanged across both review rounds)

- **Play** — invokes the real match engine (with a seed), produces an event
  tape, stores it.
- **Replay** — never invokes the engine. Replays the stored tape exactly.
  If Replay ever produced a different result than what was just played,
  that would be a bug, not a feature.
- **Reroll** — same constructed state, new seed, invokes the engine again,
  produces a new tape.
- **Step** — does *not* require a pausable/resumable engine. Run the
  resolution once, get the full trace array (reusing the `traceScenario`/
  `MATCH_TRACE` infrastructure already built for reachability testing —
  see `MATCH_ENGINE_SCENARIOS.md`), then Play/Step/Replay are just
  different playback speeds over that same precomputed array.
- **Run N** — loop the same probe call N times with incrementing seeds,
  tally the outcome distribution. This is not new machinery — it's the
  same pattern already used in `tools/test-draft-game.mjs`'s
  constructed-state tests (e.g. `tallyReceiveCodes`), just exposed
  interactively.

## Two modes

1. **Scenario Probe** (v1, buildable now) — construct only the players
   actually involved (1-4: actor, receiver, defender, keeper), pick a
   scenario family from a dropdown (cross/header via `X1`, reception via
   `resolveReceive`, tackle engagement via `resolveEngagement`/`resolveFoul`,
   set piece via `resolveDelivery`/`resolveWall`, shot resolution via
   `K.SAVE`/`K.ONEONONE`), and invoke the real resolver function(s)
   directly with real attributes. This answers the Beckham/van Nistelrooy
   question today.
2. **Free Play / Auto** (later, not v1) — place a fuller constructed state
   and ask the engine to decide the action itself (cross? pass? dribble?
   shoot?) via `P.SELECT`, starting from that position rather than a
   scenario picked in advance. Needs a new `runConstructedPossession(...)`
   entry point that resolves *one possession* from constructed state —
   deliberately smaller than "run a full match from a custom kickoff,"
   but still real work: the tick loop inside `buildTransitionTimeline` is
   currently one large inline block, not already factored into a callable
   single-possession unit. Design the mode toggle for this now (present,
   disabled, "coming next") so v1's UI doesn't need restructuring later.

## Decisions from review (what was kept vs. changed)

- **Reuse pitch marking CSS, but build a new interactive layer.** The
  existing `.run-mini-pitch` component (live in every match today,
  `draft-run.js` `miniPitchMarkup()`/`setMiniPitchZone()`) is zone-cell
  based, not freely draggable. Free-dragging players with both the raw
  `x%/y%` position *and* the resulting bucketed engine zone shown side by
  side (e.g. "Visual position: x 88%, y 18% → Engine zone: 2") is better
  UX than click-a-cell and is still honest about the fact the engine only
  reasons in 12 zones today (no Action Geometry yet). Reuse the pitch's
  decorative CSS (box/circle/halfway-line) as visual chrome; build the
  drag+bucket interaction fresh.
- **Extract resolver functions into a shared module — but this has a real,
  non-obvious cost that must be fixed in the same change.** `draft-run.js`
  already imports from `src/lib/retroballApi.js`, `draftSquad.js`,
  `matchTimeline.js`, `matchPlayback.js`, so a new `src/lib/matchEngineCore.js`
  housing the pure resolver functions (`resolveReceive`, `contestedRace`,
  `computePressure`, `selectReceiver`, `resolveDelivery`, `resolveFoul`,
  `resolveWall`, `resolveKeeperSave`, `resolveOneOnOne`, `selectFinishType`,
  `localizedDuel`, `playerAttribute`, `engineAttributeDetail`,
  `weightedChoice`, `seededRandom`/`hashString`, the zone constants) is not
  a new pattern — confirmed none of them touch `document`/`window`/
  `localStorage` (grepped), so they're clean to move as-is.

  **The landmine:** `tools/test-draft-game.mjs` and `tools/scenario_telemetry.mjs`
  don't run `draft-run.js` as a real ES module — they read it as text,
  strip every *leading* `import ... ;` block with a regex, cut the
  DOM-wiring tail, and `eval` the rest inside `vm.runInNewContext`. That's
  why their sandbox `context` object hand-provides stubs for everything
  those stripped imports would have supplied. A new
  `import {...} from "./src/lib/matchEngineCore.js"` in `draft-run.js`
  gets stripped the same way — and then every sandboxed call to
  `resolveReceive`/`computePressure`/etc. throws `ReferenceError`,
  breaking the entire suite the moment the import line lands.

  **Fix, same change:** both test harnesses need a real Node
  `import * as matchEngineCore from "../src/lib/matchEngineCore.js"` and
  `Object.assign(context, matchEngineCore)` before `vm.runInNewContext`, so
  the sandbox resolves the real functions. This should be a pure
  code-motion refactor — if test/telemetry output shifts at all after the
  move, that's a sign something broke in transit, not a calibration change
  to chase.
- **No sound integration yet**, but scenario/event IDs are already
  designed to carry it later (see `MATCH_ENGINE_SCENARIOS.md` Purpose
  section — "commentary, and later, sound triggers" was already the
  intent before this playground was proposed). Sound work was explicitly
  paused earlier to do the engine redesign; this playground should not
  reopen that scope.
- **Minimum roster claim corrected.** "1 player + ball minimum" is true
  for Scenario Probe (pure functions, explicit params, no roster lookup)
  but not for a full match `Play` — `buildTransitionTimeline` calls
  `goalkeeper(opponents)`, `defenderForColumn()`, and line-based pools
  internally, and always starts from a coin-flip side at a fixed midfield
  zone band (no injection point exists today). This is exactly why Free
  Play is phase 2, not v1.

## Build sequence

1. **Phase 1 — extract `src/lib/matchEngineCore.js`.**
   - Move the pure resolver/heuristic functions, zone constants, RNG
     helpers, and attribute-resolution logic out of `draft-run.js`,
     `export` each.
   - Update `draft-run.js` to import from it (matching the existing
     versioned-query-string import convention already used for the other
     `src/lib` imports).
   - Update `tools/test-draft-game.mjs` and `tools/scenario_telemetry.mjs`
     to real-import the new module and inject its exports into their
     sandbox `context` objects.
   - Verify: `node --check` on every touched file, full suite run 2-3x,
     telemetry snapshot compared against the pre-refactor baseline in
     `MATCH_ENGINE_SCENARIOS.md` — should be byte-identical, since nothing
     about the logic itself is changing, only where it lives.
2. **Phase 2 — build `match-lab.html`/`match-lab.js`.**
   - Player search via the existing `searchPlayers()`/`getPlayerMetrics()`
     (`src/lib/retroballApi.js`) — no new backend work.
   - Drag-and-bucket pitch (reusing existing pitch-marking CSS, new
     interactive layer).
   - Scenario Probe mode: scenario picker, attacker/receiver/defender/
     keeper role slots, Roll/Replay/Reroll/Reset/Step/Run N, live pressure
     number (real `computePressure()`) and receiver-weight breakdown (real
     `selectReceiver()`), full event trace.
   - Free Play mode toggle present but disabled ("coming next").
3. **Deferred, not scheduled:** `runConstructedPossession()` (Free Play's
   engine entry point — needs the tick-loop body factored into a callable
   single-possession unit first), sound trigger wiring.
