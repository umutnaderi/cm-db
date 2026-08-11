# Match Lab — Playground Page Plan

Status: Phase 1 (shared match-engine core extraction) done. Phase 2
(`match-lab.html`/`.js`) not started.

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

1. ~~**Phase 1 — extract `src/lib/matchEngineCore.js`.**~~ Done. Moved 50
   pure resolver/heuristic functions, zone constants, RNG helpers, and the
   full attribute-resolution chain into `src/lib/matchEngineCore.js`,
   `export`ed each; `draft-run.js` now imports them (matching the existing
   versioned-query-string convention already used for the other `src/lib`
   imports). Verified with a real Node `import()` that every name
   `draft-run.js` imports actually resolves as a real export (`node --check`
   alone can't catch a missing/misspelled export — real ESM import
   resolution can).

   **Two real problems found and fixed, not just code motion:**
   - The planned fix ("real-import the module in both test harnesses and
     inject its exports into their sandbox `context` objects") turned out
     to be wrong. `vm.runInNewContext` creates a separate realm with its
     own `Object.prototype`; a function injected from the *outer* realm
     still builds its return objects using the *outer* `Object.prototype`,
     while object literals written in the sandboxed test source use the
     *sandbox's*. Any `assert.deepEqual`/`deepStrictEqual` comparing the
     two then fails with "same structure but not reference-equal" — a
     cross-realm identity mismatch, not an actual behavior difference.
     Fixed by inlining `matchEngineCore.js`'s source (with `export`
     stripped) directly into the sandboxed script ahead of `draft-run.js`'s
     own stripped source in both `tools/test-draft-game.mjs` and
     `tools/scenario_telemetry.mjs`, so every function/constant lives in
     the *same* realm as the rest of the evaluated code — matching how it
     actually behaved before the extraction.
   - A raw Node script used to delete a large (587-line) block from
     `draft-run.js` rewrote the *entire* file using `\r\n` line endings,
     silently flipping it from LF to CRLF. This broke an unrelated,
     pre-existing test that hardcoded a `\n`-based substring match against
     the raw file text. Fixed by normalizing the file back to LF (matching
     every other file in the repo) — worth remembering next time a
     line-based script edit (rather than the `Edit` tool) touches a large
     chunk of a file: it can silently renormalize line endings for the
     *whole* file, not just the edited region.

   Verified: `node --check` on every touched file, full suite run 3x clean,
   `scenario_telemetry.mjs` output compared against the pre-refactor
   snapshot in `MATCH_ENGINE_SCENARIOS.md` — same shape, same order of
   magnitude per code (exact counts differ slightly, as expected, since the
   pressure-widening/orientation work already shifted the RNG stream before
   this refactor started; this refactor itself doesn't touch RNG order at
   all, only where the code lives). Also added a standalone test
   (`tools/test-draft-game.mjs`, top of file) that imports
   `matchEngineCore.js` as an ordinary ES module — not through the VM
   sandbox at all — and calls a couple of its functions directly, since
   that's exactly how `match-lab.js` will consume it; the sandbox-inlining
   route proves the sandbox realm works, not that the exported module
   works normally on its own.

   **Phase 1 baseline** (`node tools/scenario_telemetry.mjs 400`, frozen
   here as the reference point for Phase 2 — if Match Lab's interactive
   probes ever disagree with these orders of magnitude for the same
   inputs, that's a signal to check the adapter, not the engine):

   ```
   K.ONEONONE.1              753   1.883/match
   through-ball               662   1.655/match
   chip                       441   1.103/match
   F.CALM.WEAK                416   1.040/match
   late-box-run               370   0.925/match
   F.FINESSE.WIDE             368   0.920/match
   diagonal-switch            297   0.743/match
   F.BLAST.OVER               293   0.733/match
   D.BLOCK                    273   0.682/match
   K.SAVE.0/1/3                748   (0.640+0.627+0.603)/match combined
   P.RECEIVE.PROTECT          252   0.630/match
   K.ONEONONE.5               234   0.585/match
   P.RECEIVE.HEAVY            232   0.580/match
   keeper-dribble              146   0.365/match
   DELIVERY.CLEARED           128   0.320/match
   foul-D.SLIDE/STAND/DUEL/last-man  174 combined (~0.44/match)
   corner-header                38   0.095/match
   P.RECEIVE.KNOCK_FORWARD      92   0.230/match
   P.RECEIVE.LOSE                15   0.037/match
   FK.WALL.HIT                   11   0.028/match
   K.ONEONONE.6                   1   0.003/match (conditional tier)
   penalty                        1   0.003/match (conditional tier)
   ```
2. ~~**Phase 2 — build `match-lab.html`/`match-lab.js`.**~~ v1 done (Scenario
   Probe mode only; Free Play deferred as planned).

   - Genuinely standalone page (`match-lab.html`/`match-lab.js`), styled on
     its own (`.match-lab-*`), no dependency on `draft-run.html`'s DOM.
     Imports `matchEngineCore.js` and `retroballApi.js` directly — nothing
     re-derived or duplicated.
   - Player search via the real `getDatabases()`/`searchPlayers()`/
     `getPlayerMetrics()` — same production API every other page hits
     (confirmed: `API_BASE` resolves from the same `<meta
     name="retroball-api-url">` tag as `draft-run.html`/`database.html`,
     so this isn't a new backend integration, it's the existing one).
   - A large standalone pitch, freely draggable markers (pointer-based,
     not HTML5 drag/drop), each showing its raw `x%/y%` position and its
     bucketed engine zone together — the "don't overstate precision"
     framing from the review, made concrete: the marker label always
     reads `Name · Z<n>`.
   - Six roster roles (attacker/receiver/defender/keeper/wall/candidate);
     a "candidate" role (2+ players) drives a live receiver-weight panel
     independent of the selected scenario — matches the review's own
     Beckham/Ruud/Scholes worked example. Deliberately **not** implemented
     by re-deriving `selectReceiver`'s internal weight formula (an earlier
     draft did exactly that and was caught in review before verification —
     see "One correction made during review" below) — it samples the real
     `selectReceiver()` 300 times per update and reports the empirical
     pick share instead.
   - Five Scenario Probes, each a thin sequence of real, unmodified
     `matchEngineCore` calls in the same order the real tick loop calls
     them (verified against the actual `draft-run.js` call sites, not
     assumed — e.g. the free-kick shot-type-to-finish-type mapping
     `{regular:"calm", hard:"blast", curl:"finesse"}` was copied from
     `draft-run.js`'s own FK.SHOT chain, not guessed):
     - **Cross & Header** — `resolveDelivery()`
     - **Pass Reception** — `resolveReceive()` — what it costs the
       receiver to control a pass that's already arrived, *not* whether
       the passer chooses/finds them in the first place (that's
       `selectReceiver`, a different function, currently only exercised
       by the live receiver-weight panel below, not by its own probe)
     - **Tackle Engagement & Foul** — `selectEngagement()` →
       `resolveEngagement()` → `resolveFoul()` if it goes to ground
     - **Shot Resolution** — `selectFinishType()` → `resolveFinishAttempt()`
       → `resolveKeeperSave()`, or `resolveOneOnOne()` on a breakaway toggle
     - **Free Kick** — `resolveWall()`, then the shot chain if it clears
   - Roll/Replay/Reroll/Reset/Step/Run N, matching the agreed semantics
     exactly: Replay never calls the engine (redraws the stored trace);
     Reroll increments the seed and calls it again; Step reveals the
     already-computed trace one entry at a time rather than pausing live
     computation; Run N repeats the same constructed roster across N
     seeds and reports an outcome distribution.
   - Live pressure panel: real `computePressure()` against whichever
     player is tagged "defender."
   - No sound, no `runConstructedPossession`/Free Play, no new 2D
     animation system — all explicitly out of v1 scope, as planned.

   **One correction made during review, before it shipped:** an early
   draft of the receiver-weight panel reimplemented `selectReceiver`'s
   internal suitability formula by hand instead of calling the function —
   exactly the "duplicate the engine" mistake this whole design was meant
   to avoid. Caught and fixed before verification by switching to
   empirical sampling of the real function (above).

   **Verification, and its limit:** `node --check` on both new files; a
   real `import()` confirming every one of the 17 `matchEngineCore` names
   and 3 `retroballApi` names this page imports actually resolves; a
   cross-check confirming every DOM id referenced in `match-lab.js` exists
   in `match-lab.html` and vice versa; a cross-check confirming every
   `match-lab-*` CSS class referenced in the JS/HTML exists in
   `styles.css` (caught and removed three dead classes and one
   never-rendered `.match-lab-zone-cell` overlay this way); a local
   server smoke test confirming `/match-lab.html`, `/match-lab.js`, and
   its two module imports all serve 200. Full `tools/test-draft-game.mjs`
   suite re-run clean, confirming this work didn't touch the engine at
   all. **What this does not verify: actual browser behavior** — the
   search flow, drag interaction, and live panels have not been exercised
   in a real browser, since this environment has no browser to drive.
   That's a real gap, not a formality — say so rather than claiming a
   working UI. Needs a manual pass before relying on it.

   **Two more real problems found on a second review pass, both fixed:**
   - `scenarioIsReady()`/`renderRoleRequirements()`/the default-role
     auto-assigner all wrapped a role's declared minimum in
     `Math.max(1, role.count)` -- harmless for every role except Free
     Kick's `wall` (deliberately declared `count: 0`, genuinely optional),
     which this silently turned into a *required* wall defender, blocking
     the "Roll" button on a scenario that should work with zero. Fixed by
     using `role.count` directly everywhere (it's already the real
     minimum, explicitly declared per role -- the `Math.max` was
     unnecessary even before it was wrong).
   - The original ask ("we put the ball, somewhere we desire") was never
     actually implemented -- `state` had no ball object at all, only the
     player roster. Added: a draggable ball marker (reusing the existing
     drag logic, generalized to accept any `{x, y, zone}` entry rather
     than only roster ones), reset alongside the roster on Reset. No
     current scenario probe consumes `state.ball` yet (all five take
     their zone from a placed player) -- it's there because it was asked
     for and because `runConstructedPossession`/Free Play will need ball
     position/ownership next regardless, not because any v1 probe needs
     it today.

   **Framing correction:** nothing above changed, but the write-up did
   overstate the "Cross & Header" and "Pass Reception" probes as directly
   answering "does Beckham choose to cross to Van Nistelrooy" -- they
   don't. Both assume the action (a cross, a completed pass) has already
   happened and resolve its outcome; *whether* the engine would choose to
   attempt that cross in the first place is a `P.SELECT`-level decision
   none of the five probes touch. Added an explicit note to this effect
   in the Match Lab UI itself (above the scenario picker), not just here,
   so the gap is visible to whoever uses the page next, not just whoever
   reads this doc.

   **Not committed yet.** The reviewer's own sequencing ties committing
   "Match Lab v1: Scenario Probe" to a manual browser pass, which this
   environment cannot perform -- that gate stands until a human checks it
   in an actual browser.

### Next up (per review, in this exact order -- no more scenario probes first)

1. Ball -- done above.
2. A real passer/crosser role, so the live receiver-weight panel (and,
   later, Cross & Header) can use a placed player's actual Vision/
   Crossing/Technique instead of the current hardcoded `passerVision = 14`
   placeholder.
3. `runConstructedPossession()` -- **one possession, not a full match** --
   as the actual entry point for an `AUTO`/Free Play mode: given a
   constructed roster + ball state, let `P.SELECT` (and whatever it
   chooses -- pass, cross, dribble, shoot) decide the action itself,
   instead of the user picking a Scenario Probe in advance. This is the
   piece that turns "test this resolver" into "given this football
   situation, what does the engine decide" -- the actual original ask.
   Real, separate engineering work: the tick loop inside
   `buildTransitionTimeline` is still one large inline block, not already
   factored into a callable single-possession unit (unchanged from the
   Phase 2 planning note above).
4. Store the full run as `lastRun = { seed, setupSnapshot, result, trace }`
   rather than only `lastTrace`, once Free Play exists -- cleaner grounds
   for any future 2D playback than the current trace-only shape.
