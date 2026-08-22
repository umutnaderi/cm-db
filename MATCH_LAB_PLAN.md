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

   **Committed** as `feat: add Match Lab scenario probe` once the page was
   confirmed rendering and interactive (search, placement, and scenario
   selection all reached in the browser -- the friction the user hit next
   was a real scope boundary, not a rendering/console error, so treated as
   the gate being satisfied).

## Phase 3 -- Free Play (2026-08-11, review round 5)

User feedback after using v1: "can't I just put one attacker with the ball
and see what he does? Why do I always need a defender? What does Step even
do? Are these all the scenarios?" -- confirms the real-world friction
predicted when Scenario Probe was scoped as a stepping stone, not the
answer to the original ask. Review response: make Free Play the primary
mode, Scenario Probe secondary/debug; actors other than the ball owner
should be optional, with missing actors making specific actions
*unavailable* (and saying why) rather than blocking Play or getting
fabricated to satisfy a resolver's argument list; hide Step for
single-event traces; ball ownership (`ball.ownerId`) should be the actual
mechanic, not decorative.

Agreed, with one correction grounded in the real code rather than assumed:
**there is no existing `P.SELECT` function to wire up.** Grepped
`buildTransitionTimeline` -- the "what does the ball carrier attempt"
decision isn't a resolver sitting off to the side, it's woven through
roughly 1,200 lines of the tick loop's control flow (row/column gates,
`weightedPlayer(attackingPool, ...)` picking secondary actors -- poacher,
target, receiver, presser -- from the full squad pool at a dozen-plus
separate points). "A narrow entry point that orchestrates the
already-extracted resolvers" accurately describes the *outcome* layer
(genuinely just calling `resolveDelivery`/`resolveReceive`/
`resolveEngagement`/etc., already extracted in Phase 1). It does not
describe the *choice* layer -- pass vs. cross vs. dribble vs. shoot --
which doesn't exist as a callable, roster-agnostic function anywhere.
It's inseparable from the calibrated tree everyone already agreed not to
touch (see "Engineering hygiene" in `MATCH_ENGINE_SCENARIOS.md`).

**Resolution:** `runConstructedPossession()` needs a genuinely **new**
action-choice function -- not extracted from the tick loop (impossible
without the exact refactor everyone's avoided all session), not a
duplicate of it either, since it answers a different question than the
tick loop does (what's structurally available given a *sparse,
user-built* roster, vs. the tick loop's standing assumption of a full
squad).

**Refined once more (review round 6): separate "can this state exist"
from "can this chosen action fully resolve."** The former is always yes,
even for one player and a ball -- that's not a degraded case to apologize
for, it's genuinely useful diagnostic output on its own. The latter can
legitimately be "no, and here's exactly why" without blocking anything or
fabricating an opponent to make a resolver's argument list happy. Worked
out action by action, grounded in which real functions need which actors:

| Action | Structural availability | With full cast | With actors missing |
|---|---|---|---|
| **Pass** | Needs a receiver placed | `localizedDuel` with the *exact* labels the tick loop uses (`Passing/Technique/Decisions/Teamwork` vs `Positioning/Anticipation/Tackling/Decisions`) -- same formula, called directly, not reimplemented | No defender placed → uncontested (genuinely true, not fabricated); no receiver → unavailable, not attempted |
| **Cross** | Needs a receiver placed | Existing `resolveDelivery()` chain, unchanged | No defender → skip the aerial contest (nobody to contest it), call `resolveFinishAttempt("header", ...)` directly; on target with no keeper → `unresolved: no goalkeeper placed`, not a fabricated keeper |
| **Dribble** | Needs a defender placed -- structurally meaningless without one, not partially resolvable | Same `selectEngagement`→`resolveEngagement`→`resolveFoul` chain the Tackle & Foul probe already uses | Unavailable: "no opponent engaging" |
| **Shoot** | Always available (shooter + ball only) | `selectFinishType`→`resolveFinishAttempt` need nobody else; a placed defender adds a real `resolveShotBlock` step first, matching the actual engine's chain | On target with no keeper → `unresolved: no goalkeeper placed` |
| **Carry** | Always unavailable | -- | Reason: "not implemented in the engine yet" -- a real gap surfaced by this exercise (the engine's only "dribble" concept is fundamentally a duel against a defender; there's no move-into-open-space mechanic), not invented ahead of time. Goes on the deferred backlog in `MATCH_ENGINE_SCENARIOS.md` alongside the other `P.SELECT`-adjacent items. |

The one genuinely new piece is the *weighting* among whichever actions
are available -- no unified "which action" function exists anywhere to
call, so this is new, Match-Lab-specific logic using the ball owner's
real attributes (Passing/Crossing/Dribbling/Finishing/Composure) and
pressure. Every place this shows up -- code comments and the UI itself --
labels it explicitly as illustrative weighting, not a calibrated engine
formula, split visibly from the outcome layer:
- **ACTION CHOICE** -- Match Lab sparse-roster model (new, illustrative)
- **ACTION RESOLUTION** -- production match engine (real, unmodified)

**Phase 3B (aspirational, not scheduled):** if the action-choice
interface proves useful, the production engine could eventually converge
toward the *same* shared chooser (`selectPossessionAction(context,
random)`) rather than permanently maintaining two independent football
decision models -- migrated incrementally, one portion of the tree at a
time, each step validated against a telemetry baseline before/after
(same discipline as every other change to the calibrated tree this
session). Not started; recorded here so the destination isn't lost.

### Built

All of items 1-4 below are done. Free Play is now the default mode;
Scenario Probe is a secondary tab. Ball ownership (`ball.ownerId`) drives
Free Play -- clicking "⚽" on a placed player assigns it (snapping the ball
to them), dragging a ball-owner carries the ball along, manually dragging
the ball away detaches it (loose ball, `ownerId = null`). Roster entries
gained a `team` (home/away) field alongside their existing role, so Free
Play can derive teammates/opponents/keeper relative to the ball owner
without needing scenario-specific role names.

`actionAvailability()`/`actionWeight()`/`selectPossessionAction()`
implement the structural-availability-always-computable design from the
table above, using `weightedChoice()` (real, reused) for the actual draw.
`resolvePass()`/`resolveCross()`/`resolveDribble()`/`resolveShoot()`
implement the per-action partial-resolution logic exactly as scoped --
notably, Cross deliberately does *not* call `resolveDelivery()` (the
corner/set-piece wrapper with inswing/outswing texture); it decomposes
into `contestedRace()` (aerial, skipped if no defender) →
`resolveFinishAttempt("header")` → `resolveKeeperSave()` (reported
`unresolved` if no keeper), matching the real engine's open-play X1
mechanic more faithfully than the wrapper would have. The receiver-weight
inspector panel now uses the real ball owner's Vision once one's assigned,
falling back to the placeholder only when nobody has the ball yet.

**Verification:** all the same static checks as Phase 2 v1 (syntax,
real-import resolution for the 21 `matchEngineCore` names now in use,
DOM-id/CSS-class cross-checks, server smoke test, full engine-suite
regression, clean). Additionally, since this round's logic is genuinely
new (not just wiring), extracted the pure Free Play functions into a
scratchpad script and ran them against the real `matchEngineCore` module
directly in Node (not the browser, not the VM sandbox) across four cases:
a lone ball owner (only Shoot available, reported correctly, resolves to
`unresolved: no goalkeeper placed` rather than fabricating one), a ball
owner plus one teammate and nothing else (Pass/Cross available and
correctly uncontested, Dribble correctly unavailable), a full cast
(real duels/engagements/fouls/saves firing, all recognizable engine
codes), and a 500-run distribution off the full-cast case (plausible
shape -- NO GOAL dominant, GOAL a small single-digit percentage, sensible
spread across TURNOVER/WON/ADVANCE/LOOSE/HOLD/FOUL/BLOCKED variants). No
exceptions in any case.

**What this still does not verify: actual browser behavior**, same
caveat as Phase 2 v1 and for the same reason -- no browser in this
environment. The mode toggle, ball-ownership clicking/dragging, team
selection, and the action table's live updates are all unverified beyond
static analysis and the logic-only dry run above. Not committed yet.

### Bug found via actual use: the rebound-scramble phase was missing entirely

User report: placed a strong receiver, a weak wing-back as the defender,
and a genuinely bad outfielder as the keeper, and the attacker still could
not score no matter how many rerolls -- exactly the kind of thing this
tool exists to surface, and it worked.

**Diagnosis, grounded in the real tick loop, not assumed:** `resolveDelivery()`/
`resolveKeeperSave()` flag certain outcomes (`K.SAVE.2`/`.5`/`.6`,
`K.ONEONONE.3`) with `rebound: true`. In the real engine, that flag is
never the end of the phase -- `buildTransitionTimeline` always continues
into a second contested race for the loose ball (`localizedDuel` with
`Anticipation`/`Acceleration`/`Off the Ball` vs. `Positioning`/
`Anticipation`/`Strength`) plus a shot-chance roll (`transitionShotChance`
with `poacherScore`), confirmed by reading the actual corner/delivery/shot
handling in `draft-run.js` directly (three separate call sites, all the
same pattern). Both the Cross & Header probe and Free Play's cross/shoot
resolution stopped the moment they saw a rebound-flagged result and
reported "no goal" -- silently discarding a real share of how the engine
actually produces goals from crosses and shots. A weak keeper's main
effect is producing *more rebounds*, not more direct "beaten clean"
goals, so this gap disproportionately hid exactly the case the user was
testing.

**Fix:** exported `playerAbility`, `goalkeeperScore`, `poacherScore`,
`conditionedScore`, and `transitionShotChance` from `matchEngineCore.js`
(pure code motion from `draft-run.js`, same discipline as Phase 1 --
verified behavior-identical via the regression suite and a telemetry
spot-check) so Match Lab could call the exact same rebound-resolution
formula the tick loop uses, instead of approximating it. Added a shared
`resolveReboundScramble()` helper (Match Lab-side, since there's no
attacking/defending *pool* here to reuse `weightedPlayer`/
`defenderForColumn` from -- reuses the same attacker/defender already
placed, a simplification, not a fabrication) and wired it into the Cross
& Header probe, Shot Resolution probe (which gained an optional `defender`
role it didn't need before, for exactly this), Free Play's cross, and
Free Play's shoot. When no defender is placed at all, the rebound is
correctly treated as uncontested rather than fabricating one.

**Verified the fix actually closes the gap, not just that it runs:**
extended the scratchpad dry-run with the user's exact matchup (strong
receiver, weak defender, weak-baseline keeper) and ran it 1000 times.
Every single scored goal came via the rebound path -- confirming that
before this fix, this exact matchup would have scored zero goals no
matter how many times it was rolled, regardless of how weak the keeper
was, which is precisely the symptom reported. Full regression suite
clean across 3 runs; telemetry spot-check confirms the underlying
function relocation didn't shift live-match rates.

### Phase 4 -- Spatial Intelligence Lite (2026-08-12, review round 7)

Free Play's action weights had no zone/pressure/distance term at all, pass
and cross both targeted `teammates[0]` regardless of who else was placed,
and the "engaging defender" was just whoever was nearest -- with only one
opponent placed, that opponent counted as engaging no matter how far away
they actually were. All three confirmed real by reading the actual code,
not assumed.

One claim in the review was wrong and worth correcting rather than quietly
acting on: it said `selectReceiver()` was "already preserved" for pass
targeting. Checked -- it wasn't. `selectReceiver()` was only ever used in
the unrelated receiver-suitability inspector panel; `actionAvailability()`'s
real pass/cross targeting was genuinely `teammates[0]`, nothing more. Fixed
now, not previously.

Also found a better fix than what was proposed for cross targeting: rather
than inventing a new poacher-weighted formula, the real tick loop already
has a target-selection function for exactly this -- `weightedPlayer(pool,
random, "attack", (player) => conditionedScore(player, headerScore, minute))`,
used for real corner/delivery targets. Both `weightedPlayer` and
`headerScore` were pure and easily exportable (same pattern as every prior
extraction), so cross targeting reuses the *real* mechanism instead of a
bespoke one -- pass targeting uses `selectReceiver()` (also real, now
actually wired in), a deliberately different real function, since who
you'd lay a short pass off to and who you'd aim a cross at are different
questions in the real engine too.

**Built:**
- `ENGAGEMENT_DISTANCE = 22` (pitch-percentage radius) + `engagingOpponent()`:
  the nearest opponent only counts as able to contest anything if actually
  within range; beyond it, treated identically to no opponent being placed
  (uncontested pass/cross, Dribble unavailable, lower Shoot pressure) --
  not fabricated, genuinely absent from the contest.
- `selectTeammateTarget()`: when 2+ teammates are placed, pass targeting
  calls real `selectReceiver()`, cross targeting calls real
  `weightedPlayer()` + `headerScore()`. With exactly one teammate, no
  selection is needed at all.
- Zone/pressure multipliers on `actionWeight()` -- wide final-third zones
  favor Cross, deep zones sharply dampen Shoot, pressure dampens Cross/
  Dribble. Still explicitly labeled Match-Lab-only/illustrative in the code
  comments, same discipline as the base weights already had; a real
  geometric model (Action Geometry, still on the deferred backlog) is the
  eventual proper fix, not this.

**Verified with a dedicated dry-run** (`test-freeplay-phase4.mjs`, real
`matchEngineCore` functions, not approximated): an opponent 5.4 units away
correctly engages, one 63.6 units away correctly doesn't -- the exact bug:
pass-target selection over 300 draws skewed 258/42 toward the
better-off-the-ball teammate rather than a flat split; cross-target
selection skewed 283/17 toward the stronger header; shoot weight came out
~48x higher in the box than deep in the own third, cross weight ~3x higher
wide than central. Full regression suite clean across 3 runs (one via a
backgrounded run after a local timeout, still exit 0 both passes). Not
committed -- same browser-verification gate as every round since Phase 2.

### Bugs and questions found via actual browser use (2026-08-12)

First real browser session. Four things came back, three real findings and
one honest "not built yet."

**Bug: "no goalkeeper" resolved as `UNRESOLVED` instead of an empty net.**
A lone 181 CA player with the ball and nobody else placed showed a
51%/49% `UNRESOLVED`/`NO GOAL` split -- zero goals, no matter how good the
player. Diagnosis: `resolveShoot()`/`resolveCross()` treated "no keeper
placed" as an ambiguous state needing more information. It isn't -- if the
user chooses not to place a keeper, that's a complete, valid state (an
actually empty net), and an on-target, unblocked effort against an empty
net is a goal, not something left hanging. Fixed both call sites: on
target + no keeper now resolves `GOAL` (`EMPTY_NET` code) directly, no
`resolveKeeperSave()` call at all (there's nothing for it to resolve
against). Verified: an 181 CA player finishes on target into an empty net
~49% of the time -- matches the calibrated on-target rate for a "calm"
finish (0.28-0.62 floor/ceiling), which already accounts for scuffed/
wayward efforts that would miss regardless of a keeper. Not "always a
goal" by design -- an on-target roll already represents "would this
particular effort trouble the goal at all," and misses stay misses.

**Not a bug, exactly the gap this tool is designed to surface: "he should
be able to dribble or carry it too."** With no opponent placed at all,
Dribble is correctly unavailable ("no opponent engaging") -- Dribble
specifically means beating a defender, which needs one to exist. What the
user actually wants there is `P.CARRY` (advancing into open space, no
engagement) -- already identified as a real engine gap during Phase 3
(the real engine's only "dribble" concept is a duel against a defender,
full stop) and already on the deferred backlog. Match Lab reporting
"Carry: not implemented in the engine yet" here is the tool working
correctly, not a bug to quietly patch around.

**Real finding, not a bug, but worth stating plainly: Cross & Header's ~5%
conversion for a 140 CA forward vs. 135 CA defender vs. 95 CA keeper is
what the calibrated formula actually produces, and the reason is
non-obvious.** Broke it down with a dedicated scratchpad test
(`test-header-conversion.mjs`) using CA-appropriate attribute sets and
`resolveDelivery()`/`contestedRace()`/`resolveFinishAttempt()`/
`resolveKeeperSave()` directly: aerial race won 46.9% of the time, 48.9%
of those on target, 19.8% of those beat the keeper cleanly -- 0.469 x
0.489 x 0.198 ≈ 4.5% direct, landing at 5.8% once rebound-scramble goals
are included, matching what was observed almost exactly.

The non-obvious part: `contestedRace()`'s *attacker* labels are
`Pace`/`Acceleration`/`Anticipation`/`Off the Ball` even when
`aerial: true` -- only the *defender's* labels swap in `Marking` for
aerial contests. A receiver's Heading/Jumping do nothing to help them win
the aerial position battle; they only matter afterward, for the header's
on-target accuracy (`resolveFinishAttempt`'s config). A "target man" type
forward with strong heading but ordinary pace, like the one tested, wins
the race close to a coin flip regardless of how good their heading is.
This is pre-existing calibrated behavior from the X1 mechanic built
earlier this session, not something Match Lab introduced or changed --
flagging it here because it's the kind of thing this tool exists to
surface, but a deliberate recalibration of `contestedRace`'s aerial labels
is real engine-tuning work, not a Match Lab fix, and not started.

**Honest answer, not yet built: ball position currently has no mechanical
effect beyond who owns it.** `state.ball.x/y` drives the marker's visual
position and, via the "⚽" button, which player is the current owner --
nothing currently checks proximity to determine anything else. Dragging
the ball closer to a player only matters once you explicitly give it to
them; a loose ball (`ownerId: null`) has no "who reaches it first"
mechanic at all. Real, sensible gap, not a bug -- a genuine "race to a
loose ball" mechanic (reusing `contestedRace()` again, real function, not
new logic) is a reasonable next addition but wasn't asked for yet and
isn't started.

### Second browser round + external review (2026-08-13)

More real browser testing (Hagi empty-net, Jardel/Stam/Barthez Cross &
Header, Pass Reception, two Tackle Engagement & Foul runs, two free-kick
wall runs with Roberto Carlos), followed by an external review of the
results. Four real findings, one corrected mid-stream, one deferred.

**Bug, fixed: Tackle Engagement & Foul and Free Play's Dribble skipped the
real engine's upstream progression duel, which is where defender skill
actually differentiates outcomes.** First pass at this (isolated
`selectEngagement()`/`resolveEngagement()` testing, `test-engagement-skill.mjs`)
found a 175 CA defender and a 90 CA scrub produced statistically
indistinguishable win rates (~67-70% both) and concluded this was a raw
engine calibration gap. That conclusion was wrong, or at least incomplete
— `resolveEngagement`'s own comment in `matchEngineCore.js` (line 555) says
plainly it's "called only once the ball carrier's broader progression duel
has already gone the defender's way; this decides the *flavor* of that
win, not whether it happens." Reading `draft-run.js`'s tick loop (line
2833) confirmed it: `selectEngagement`/`resolveEngagement` never fire on
their own — a `localizedDuel()` call (`transitionDuel`, attacker labels
`Passing`/`Technique`/`Decisions`/`Teamwork`, defender labels
`Positioning`/`Anticipation`/`Tackling`/`Decisions`) has to be lost by the
attacker first. Both Match Lab's Dribble action and the Tackle & Foul
probe called `selectEngagement`/`resolveEngagement` directly, meaning the
elite-vs-scrub test above was really testing "given the defender has
already won the broader duel, how skill-sensitive is the *flavor* of that
win" — a narrower, and correctly less skill-sensitive, question than "does
a bad defender concede more." Fixed both call sites to run the real
`localizedDuel()` first (same labels, same `raceWasClose = probability >
0.4` the tick loop uses), only falling through to engagement when the
attacker loses it; the probe gained a required `attacker` role and lost
its manual "race was close" checkbox (now a real computed value). The
Tackle & Foul probe now answers "can this player beat this defender," not
just "given a beaten defender, how does the tackle look." Verified with a
fresh scratchpad test (`test-dribble-upstream-duel.mjs`): the same
attacker now advances past a scrub defender 69.5% of the time vs. 44.3%
against an elite defender — a 25-point swing where the old isolated
formula showed none.

**Real, confirmed, not fixed: `resolveWall()`'s coverage formula ignores
wall size entirely, and gives an empty wall a flat "phantom" baseline
coverage.** `wallCoverage` is `average(wallDefenders.map(...))` — the
average of N identical defenders equals one defender's value regardless of
N, so a 1-man wall and a 5-man wall of identical players produce exactly
the same hit chance. Separately, `wallDefenders.length === 0` doesn't give
0 coverage, it gives a flat `0.3` (`resolveWall`, `matchEngineCore.js` line
740-743) — not derived from any placed entity. Combined with the
already-confirmed taker-skill ceiling (`test-wall-blockrate.mjs`: Roberto
Carlos vs. a mediocre taker against the same single defender, 56% vs.
57.4% wall-contact — the `takerSkill * 0.3` term isn't strong enough to
escape the formula's 0.55 clamp once a decent single defender's coverage
already nears it), this is a real, two-part calibration problem in an
already-live, already-shared formula (`matchEngineCore.js`, used by the
actual match engine, not Match-Lab-only code). Deliberately **not**
touched yet — recalibrating it needs the full discipline already used for
every other shared-engine change this session (constructed tests,
telemetry before/after, confirming it doesn't shift live free-kick goal
rates), not a quick Match Lab-driven tweak. Flagged as its own piece of
work, not started.

**Clarified, not a bug: Scenario Probe's Cross & Header never reads ball
ownership, a crosser, or any delivery-quality attribute at all.** Its
`roles` are only `receiver`/`defender`/`keeper`; `run()` calls
`resolveDelivery()` directly with no fourth "who delivered this" argument.
This is accurate to what `resolveDelivery()` itself does — the real X1/
set-piece delivery mechanic doesn't have a separate "crossing accuracy"
gate to be missing; delivery quality isn't modeled as its own duel
anywhere in the real engine, only the aerial contest and finish are. So
the probe is a faithful match for what `resolveDelivery()` computes, but
the earlier framing ("ball is tied to Jardel") overstated what that
means: in Scenario Probe, ball ownership is decorative — every probe
derives its working zone from the placed roles' own positions, never from
`state.ball`. That's Free-Play-only. Worth being explicit about in the UI
at some point (a hint under the scenario description) so placing the ball
on a specific player doesn't imply it does anything for Scenario Probe —
not done yet, low priority since it's a documentation gap, not a logic
one.

**Deferred, legitimate future idea: empty-net accuracy could eventually be
context-boosted rather than left at the plain on-target ceiling.** The
current empty-net fix (previous round) is mechanically correct — an
on-target effort with no keeper is a goal — but a real player facing an
open net would reasonably convert a higher fraction of their efforts than
the same on-target roll used against a keeper, since "on target" already
represents everything that would miss regardless. Implementing this
honestly needs new logic (a genuinely separate, higher ceiling for the
empty-net case specifically, since `resolveFinishAttempt`'s existing
`contextMultiplier` is capped by the same ceiling it would need to
exceed), not a tweak to the existing formula. Not started; flagged as a
distinct, smaller follow-up from the wall/duel work above.

**Two caveats on the upstream-duel fix itself, both real, one fixed.**

Bug, fixed: the Tackle & Foul probe sourced its working zone from
`defender.zone`. Harmless before the probe had an attacker (nothing else
to source it from), but inconsistent once it did -- every other probe in
this file (Cross & Header, Pass Reception, Shot Resolution) canonically
uses the *attacking*-side actor's zone, and so does Free Play's
`resolveDribble` (`owner.zone`). Fixed to `attacker.zone`, matching that
convention -- also the more meaningful choice for the in-box foul-severity
modifier, since a foul in the box benefits the attacker who's fouled, not
the defender who commits it.

Not a bug, an honest limitation worth stating plainly: the upstream duel
reuses the real engine's only generic progression contest
(`Passing`/`Technique`/`Decisions`/`Teamwork` vs defensive attributes) --
faithful to production, but the live engine has no dribble-specific
contest at all, so `Dribbling`/`Flair`/`Acceleration`/`Balance` are never
read by the resolution. They ARE read by `actionWeight()`'s "dribble" case
in Free Play, which decides whether the action gets *chosen* -- so
choosing to dribble is skill-weighted, but the resolution of that choice
isn't. That mismatch is real, in the live engine as much as in Match Lab,
and not something to paper over by inventing a formula the production
engine doesn't have. The 69.5%/44.3% verification proves defender quality
now matters in the upstream duel; it doesn't prove "Dribble" resolves as a
dribbling-skill contest, because in production it never did.

**Two more real bugs, fixed (Live Signals inspector, pitch markers), one
correct design confirmed via code reading, not by trusting the retest.**
A follow-up browser round reported "Pressure near Jaap Stam" while action
availability said "no opponent engaging" for the same setup. Confirmed:
`updateInspector()` read `grouped.defender[0]` -- the first roster entry
with role "defender," full stop, ignoring team and engagement distance --
while Free Play's own `actionAvailability()` correctly filters both via
`engagingOpponent()`. A later retest reported these agreeing again, but
that was because the specific retest's defender happened to satisfy both
the naive and the correct filter, not because the code had changed; fixed
properly by making the inspector reuse `engagingOpponent()` in Free Play
mode. Also confirmed and fixed: pitch markers had zero visual team
distinction (`marker.dataset.role` drove the dot's fill color; nothing
drove team), so a same-team "Defender" looked identical to an away one on
the pitch itself -- only the roster list's off-pitch Home/Away dropdown
showed it. Added `marker.dataset.team` and a border-color cue for away
markers. Scenario Probe also gained an explicit hint that assigned roles
are forced participants regardless of marker distance/team, unlike Free
Play -- documentation only, confirmed as intentional probe behavior, not
a bug to fix.

### Free-kick chain audit (2026-08-13)

User-reported: 13 goals from 1,000 direct free kicks with Roberto Carlos
against a single wall defender and Barthez in goal -- implausibly low for
an elite specialist. Traced the complete chain
(`resolveWall`→`selectFreeKickShotType`→`resolveFreeKickAttempt`→
`resolveKeeperSave`) stage by stage before changing anything.

**Fixed, shared/live formula: `resolveWall()`'s wall-size blindness and
empty-wall phantom coverage (already confirmed the previous round), plus a
taker-skill ceiling too low to let elite technique matter.** Redesigned:
an empty wall (`wallDefenders.length === 0`) now returns `{ hit: false,
code: "FK.WALL.NONE" }` directly -- zero coverage, not a flat 0.3 baseline.
A non-empty wall's coverage is `avgQuality * sizeFactor`, where
`sizeFactor = 1 - Math.exp(-wallDefenders.length / 2)` gives each
additional body diminishing-returns coverage (a 1-man wall barely covers
anything; a 5-man wall covers most of what it's going to). The taker-skill
coefficient moved from `0.3` to `0.45` and the ceiling from `0.55` to
`0.65`, so an elite taker can meaningfully escape a thin wall and a large,
well-composed wall can meaningfully punish a poor one -- both were
structurally impossible under the old formula regardless of skill,
confirmed via the review's own required comparison matrix
(`test-wall-recalibration.mjs`): elite taker vs. a 3-man decent wall gives
1/3/5-defender rates of 0.8%/30.9%/40.8% (clear size effect, diminishing
returns); the same 3-man wall against elite/average/weak takers gives
30.2%/44.2%/56.6% (clear taker-skill effect); weak/decent/elite 3-man
walls against an average taker give 15.3%/45.2%/55.0% (clear wall-quality
effect); every taker against an empty wall gives exactly 0.00%.

**Fixed, Match-Lab-only: the Free Kick probe never modeled the
rebound-scramble phase.** Same gap already fixed elsewhere (Cross &
Header, Free Play's cross/shoot) but missed here -- `resolveKeeperSave()`
returning `rebound: true` (codes K.SAVE.2/5/6) was treated as a flat "no
goal," when the real tick loop picks a poacher from the whole attacking
pool and runs a second contested race plus a shot chance. Fixed by reusing
the same `resolveReboundScramble()` helper, with the taker standing in for
the poacher (Match Lab has no separate poacher pool for a free kick) and a
placed wall defender standing in for the contesting defender when one
exists, uncontested otherwise -- same "real players, not fabricated" rule
as everywhere else in this file. Matches the real tick loop's own free-kick
rebound duel exactly, including its hardcoded zone `1`.

**Confirmed, deliberately NOT fixed: neither `resolveWall()` nor
`resolveFreeKickAttempt()` take a distance/angle input at all, and
`resolveKeeperSave()`'s free-kick call hardcodes zone `1`.** Verified this
is not a Match Lab gap -- `draft-run.js`'s real tick loop calls all three
functions with the exact same shape (no zone args on the first two,
literal `1` on the third), so Match Lab's Free Kick probe is faithful to
production, not incomplete relative to it. A taker's Zone 4 placement on
the pitch has never affected a free kick's outcome in the live match
engine, only in the sense that farther-out free kicks were never modeled
as harder to begin with. Fixing this for real means threading a genuine
distance/angle concept through the live tick loop and all three functions
-- new engine design work, not a calibration pass, and explicitly out of
scope for this round. Documented rather than silently built around.

Stage-by-stage verification, Roberto Carlos vs. Barthez, 1,000 runs each
(`test-freekick-pipeline.mjs` before, `test-freekick-after.mjs` after):

| | 1 wall defender, before | 1 wall defender, after | empty wall, after | 5 identical defenders, after |
|---|---|---|---|---|
| Wall hit | 559 (55.9%) | 12 (1.2%) | 0 (0.0%) | 399 (39.9%) |
| On target (of cleared) | 245/441 (55.6%) | 535/988 (54.2%) | 536/1000 (53.6%) | 328/601 (54.6%) |
| Direct goal | 20 | 48 | 51 | 38 |
| Rebound goal | 0 (not modeled) | 8 | 0 | 2 |
| **Total goals** | **20 (2.0%)** | **56 (5.6%)** | **51 (5.1%)** | **40 (4.0%)** |

Live-match telemetry (`scenario_telemetry.mjs`, 400 matches) after the
change: `FK.WALL.HIT` at 9/400 (0.022/match), identical to the
already-documented pre-existing baseline (`test-draft-game.mjs`'s own
comment: "~9/400") -- realistic matches mostly use 3-5 man walls rather
than the 1-defender edge case above, so overall match balance is
unaffected even though behavior at the extremes changed substantially.
Full regression suite (`test-draft-game.mjs`) passes.

### Shot-conversion calibration -- direct free kicks only, 2026-08-14

Follow-up to the free-kick chain audit: the isolated keeper-beating rate
(~9-10% for literally any taker) turned out to be a symptom of two real,
separable defects. Planned via `EnterPlanMode` given the blast radius
(`resolveKeeperSave` runs for every on-target shot in the live engine, not
just free kicks) -- an Explore agent mapped every call site, a Plan agent
produced the formula/wiring design, both verified against the actual code
before implementing anything. A first implementation pass applied the fix
broadly (open-play shots and every header path too); external review
correctly flagged that as exceeding the agreed first-pass scope and asked
for it to be isolated to direct free kicks only, with the broader version
preserved separately for a later, independently-audited pass. That broader
version is intact on `wip/broad-shot-context-multiplier`, not merged.

**What's in this pass, and nowhere else:**
- `resolveKeeperSave()` gained a 7th `contextMultiplier` parameter,
  structured so it can only ever affect the free-kick branch --
  `beatenCleanChance` is a hard `if (isFreeKick) { ...uses
  contextMultiplier... } else { ...exact original formula, no
  contextMultiplier reference at all... }`. Every non-fk `finishType`
  (calm/blast/finesse/header) is byte-for-byte the original regardless of
  what's passed, not just "nobody currently passes anything else" --
  verified directly with a dedicated test:
  `resolveKeeperSave(shooter, keeper, "calm", ..., contextMultiplier: 1)`
  and `contextMultiplier: 2.5` produce `assert.deepEqual` identical results
  (`tools/test-draft-game.mjs`).
- Three new `KEEPER_DUEL_LABELS` entries (`fk-regular`/`fk-hard`/`fk-curl`)
  keep Free Kick Taking load-bearing at the keeper-beating stage, instead
  of free kicks remapping onto the same generic Composure/Technique/
  Finishing labels a regular shot uses. Free kicks get their own curve
  (`duel.probability ** 2.0 * 0.5 * contextMultiplier`, clamp
  `[0.015, 0.22]`) instead of open play's untouched `** 2.6 * 0.55`.
- `freeKickContextMultiplier(zone)` -- a coarse dead-ball-distance proxy
  from the existing 12-zone grid, using the zone the foul was actually
  awarded in (the same zone `resolveFoul` uses). `zone=1` (the box, where
  a foul is a penalty, not a free kick) stays hardcoded at every
  `resolveKeeperSave` call site, confirmed via
  `localizedDuel`/`duelAttribute`/`zonalAttribute` to only gate
  `CONGESTED_ZONES` (a central-midfield variance term unrelated to
  distance) -- not a defect to fix, just not the free kick's own location.
- `draft-run.js`/`match-lab.js`: exactly one `resolveKeeperSave` call site
  each (the direct-free-kick shot). Open-play shot, open-play cross header
  (X1), corner header, and FK-cross header call sites are untouched --
  same signature, same arguments, as before this pass.
- `tools/keeper_save_audit.mjs` rebuilt to match: Section A reports
  open-play shot / all-header-flavored-saves / direct-free-kick buckets
  (headers from open-play, corners, and FK-crosses are indistinguishable
  in this bucket since none of those call sites changed -- fine for its
  actual purpose, confirming header-flavored saves overall are
  unaffected). Section B reports the **full stage breakdown** per skill-tier
  pairing -- wall clearance, on-target rate, clean keeper-beaten rate,
  rebound-scramble goals, and total final conversion -- instead of a single
  collapsed number, plus a dedicated Roberto Carlos-tier/Barthez-tier
  wall-size (0/1/3/5) sweep.

**Verified, both empirically and structurally, before committing:**
Section A before -> after (3000 matches): open-play shot g/shot 8.63% ->
8.40%, header-flavored g/shot 9.29% -> 9.31% -- both within normal
match-to-match sampling noise, not a formula effect (confirmed
structurally by the deepEqual test above, not just inferred from this
aggregate). Direct free kick went from **invisible** (0 shots logged,
silently folded into other buckets since free kicks previously shared
their labels) to a real, separately-measurable 123 shots.

Section B, 3-man wall, 5000 attempts/pairing -- every requested monotonic
relationship holds cleanly: stronger taker -> higher conversion at every
keeper tier (vs. ordinary keeper: weak 2.34% -> ordinary 4.38% -> strong
6.24% -> elite 7.60% -> exceptional 9.40%); stronger keeper -> lower
conversion at every taker tier (elite specialist: 10.18% vs. weak keeper
-> 7.60% vs. ordinary -> 5.96% vs. elite); larger/better wall -> lower
conversion (Roberto Carlos-tier vs. Barthez-tier: 7.62% no wall -> 7.52%
1-man -> 5.96% 3-man -> 4.96% 5-man); zero wall -> exactly zero
wall-labeled outcomes (100.0% clearance at wall size 0, structural per
`resolveWall`'s own design, not just this pairing). No sudden jumps
between adjacent tiers anywhere in the matrix.

**The Roberto Carlos-tier vs. Barthez-tier scenario (3-man wall) lands at
5.96% total conversion** -- inside the "5.6-6.6%, treat as a plausible
scenario target not a universal elite-specialist rate" band the review
itself proposed for this exact matchup -- achieved purely by correctly
counting rebound-scramble goals (previously excluded from this specific
report), not by touching the reserved `0.50 -> 0.55` coefficient, which
was never applied. Elite specialist vs. weak/ordinary keepers (10.18%,
7.60%) and exceptional vs. weak/ordinary keepers (10.46%, 9.40%) land at
or near their reference bands too; exceptional vs. an elite keeper
specifically (6.18%, target 12-15%) remains the one case still short --
flagged, not chased further this round.

Full regression suite passes, including the new deterministic
open-play-unaffected assertion and relative skill-tier-ordering
assertions (not pinned absolute rates, so future constant nudges don't
make the tests themselves brittle).

### Animation v0 (2026-08-14)

Event-tape animatic/diagnostic renderer, planned via `EnterPlanMode` (Explore
agent mapped `renderPitch()`'s CSS-custom-property positioning mechanism and
the full `trace.push()` call-site inventory; Plan agent produced the
data-model/rendering/playback design) before implementation. Not a full
22-player match sim -- the engine resolves the complete possession first
(unchanged, still zero `random()` calls in anything animation-related); the
renderer only plays that immutable result back visually.

**Data model.** New `traceEvent(code, label, opts)` helper enriches every
`trace.push({code, label})` call (all ~40, now `trace.push(traceEvent(...))`)
with `actorId/targetId/defenderId/keeperId/ballFrom/ballTo/movement/outcome/
duration`, reading `.id/.x/.y/.zone` off roster entries already in scope at
each site -- confirmed via direct code reading that this needed zero new
plumbing anywhere; every site already had the relevant actors as local
variables. `movement` (14 values) and `outcome` (7 values, closed set)
vocabularies are fixed; `resolveEngagement()`'s real 4-value outcome enum
(`won/beaten/loose/foul`, `matchEngineCore.js`) is mapped precisely, not
guessed, via a new `engagementOutcomeLabel()` helper shared by Free Play's
`resolveDribble()` and Scenario Probe's `tackle-foul`.

**Rendering.** Reuses the existing `--marker-x`/`--marker-y` CSS-custom-
property positioning `renderPitch()`/`startDrag()` already used --
`transition: left/top` on a new `[data-animating="true"]` modifier makes
writing new custom-property values interpolate for free, no manual
JS/`requestAnimationFrame` interpolation loop, no `@property` registration
needed. New `setMarkerPosition()`/`markerNode()` generalize what
`startDrag()` already did (targeted mutation of an existing node); the ball
marker gained `dataset.id = "ball"` so it uses the same lookup as every
other marker. One arithmetic rule, `nudgeToward(entry, point, fraction,
cap)`, drives every marker move -- travel is capped and always toward an
existing real point (another entry's position, a midpoint, or a
`ZONE_CENTERS` lookup), never extrapolated past it. This is the concrete
mechanism keeping the explicitly-excluded scope out: duel/dribble/tackle/
foul events never move the ball marker at all (`ballFrom === ballTo ===`
the possessor's own position -- no Carry), and only markers named in the
current event get touched (no 22-player AI).

**Playback.** One function, `applyStepAnimation(event, {animate})`, drives
Step, Play's `setTimeout`-chained auto-advance, and Replay's restart-then-
autoplay identically. Roll/Reroll now snapshot pre-resolution positions
(new `state.setupSnapshot`) and auto-play from step 0 instead of jumping
straight to full reveal. Two real behavior changes, both deliberate and
flagged before building: Reset now restores positions from the snapshot
(keeping the roster) instead of always wiping it, matching the spec's
literal "restores the constructed setup"; Step now animates instead of
being instant, for visual consistency with Play.

**Coverage.** All 6 `SCENARIOS` entries, all 4 Free Play resolvers, and the
shared `resolveReboundScramble()` helper (5 reuse points) are enriched --
the full call-site inventory the Explore/Plan agents produced, not a subset.
Scenario Probe's "cross-header" gets one collapsed event, not a 4-beat
sequence -- `resolveDelivery()` is monolithic in `matchEngineCore.js`
(aerial race + header + save all inside one function call), so this probe
structurally cannot show the intermediate beats Free Play's granular
`resolveCross()` can. Not a gap, a firm scoping conclusion.

**Verified without a browser** (none available this session, same
constraint as every other Match Lab round): `node --check` on every touched
file; real `import()` resolution (fails at the expected `document is not
defined` DOM boundary, confirming every named import -- including the new
`ZONE_CENTERS` -- resolves); a dedicated scratchpad script exercising the
vertical slice (`resolveReboundScramble`'s enrichment) across 20 seeds,
checking every `ballFrom`/`ballTo`/id field for `NaN`/`undefined` --
0 problems found; full regression suite (`test-draft-game.mjs`) unaffected
(nothing here touches `draft-run.js`/`matchEngineCore.js`). The actual
animation *feel* -- timing, nudge distances, whether it reads as intuitive
rather than jittery -- has NOT been checked and needs a real browser pass
before this is committed.

### Pitch visual accuracy (2026-08-14)

Replaced the shared `.pitch-halfway`/`.pitch-box`/`.pitch-circle` chrome
(reused from the live match's mini-pitch component, which conflates the
center circle and penalty-arc into one shared diameter variable -- not
accurate to either) with a fresh, Match-Lab-scoped set of `.ml-pitch-*`
elements, computed directly from real pitch dimensions (75yd wide x 120yd
long; 18x44yd penalty area; 6x20yd goal area; 10yd center-circle radius;
12yd penalty-arc radius; 8yd goal width; 1yd corner-arc radius) via
`calc(<yards>/75*100%)` for width and `calc(<yards>/120*100%)` for height
-- using the same percentage for both would draw an ellipse, not a circle,
since the pitch box itself isn't square. Doesn't touch the shared classes
at all, so the live match's own mini-pitch is unaffected.

Added goal frames at both ends (`.ml-pitch-goal-top`/`-bottom`, 8yd
regulation width, centered) specifically so Animation v0's `goalPointFor()`
fallback (used whenever no keeper is placed) now aims at a real, visible
marker instead of an implied pitch edge -- no logic change there, just a
visual target that now actually exists on the pitch. Also added: 6-yard
goal boxes, penalty arcs (clipped to just the portion outside the 18-yard
box), penalty spots, and 1-yard corner arcs, none of which existed before.

Not verified in a browser yet -- CSS `calc()`/`clip-path` percentage math
checked by hand, not rendered.

**Follow-up round, same day: margin + two-layer restructure.** First
browser look showed the touchlines sitting flush against the panel edge
(only a 10px offset) and asked for real breathing room, matching a
reference pitch graphic with a clear margin around the white lines. Fixing
this without breaking marker-to-pitch-line alignment needed restructuring,
not just a CSS tweak: `.match-lab-pitch` is now purely the outer "stand"
background; a new inner `.ml-pitch-field` (given `id="labPitch"`, moved
off the outer div) is the actual 75x120yd surface, inset 4% inside it, and
is now the sole positioning context for both the line markings and the
player/ball markers. Since `renderPitch()`/`startDrag()`/every other
marker-related call in match-lab.js already targets `elements.pitch`
(`#labPitch`) rather than a hardcoded class, moving the id onto the inner
field was a zero-JS-logic-change fix -- drag math and drawn lines stay
perfectly aligned automatically. One thing that DID need updating: the
goal-flash effect's CSS selector was keyed to `.match-lab-pitch`, which
after this change is the wrong (outer) element -- moved to
`.ml-pitch-field` to match where `elements.pitch` actually points.

**Real bug, fixed: penalty arc radius was 12yd, should be 10yd.** User
supplied a proper FIFA Laws of the Game dimension diagram. Everything else
checked out against it (18x44yd penalty area, 6x20yd goal area, 12yd
penalty-spot distance, 8yd goal width, 1yd corner arc, 10yd center-circle
radius) -- but the penalty arc's radius is 9.15m/10yd, the *same* radius as
the center circle, not 12yd. The earlier value conflated two different
12-yard figures from the first reference image: the penalty spot's
distance from the goal line (correctly 12yd, unchanged) and the arc's own
radius (actually 10yd). Recomputed the clip-path accordingly: a 20yd
(not 24yd) diameter circle centered at the 12yd spot spans 2-22yd from the
goal line; the 18yd box eats 2-18yd of that span, so 16 of the circle's 20
yards get clipped (80%, not the previous 75%) -- coincidentally very close
to the *original* shared `.pitch-arc-top`'s hardcoded 80% clip value,
which was apparently right all along for a real 10yd arc.

**Two more real fixes from the same browser look: outer margin should be
green, and goals should sit outside the lines.** The margin area
(`.match-lab-pitch`) was dark, not green -- changed to a muted green
(`#123a20`), distinct from but consistent with the field's own green.
Goals were drawn just inside the goal line rather than outside it (behind
the line, in the margin, like a real goal net) -- fixing this needed more
than a position tweak: `.ml-pitch-field` had `overflow:hidden` (kept its
own rounded corners clean), which would have clipped anything positioned
outside its 0-100% bounds invisible. Moved that `overflow:hidden` to the
outer `.match-lab-pitch` instead (which still needs it, for its own
corners) and repositioned the goal frames with `bottom:100%`/`top:100%` so
their fixed 10px height extends past the touchline into the margin.
Corner arcs needed no change -- confirmed their visible (rounded) portion
was already geometrically inside the field regardless of which element
clips overflow.

**Correction to that last claim: real browser look showed corner-arc
content bleeding outside the touchline after all.** The "should be
geometrically confined to the inward quadrant" reasoning didn't account
for border-radius rendering at mixed border widths (2px on two sides, 0px
on the other two) -- browsers don't strictly guarantee the curve stays
inside that quadrant in that configuration. Fixed properly this time with
an explicit `clip-path: inset(...)` on each corner element, masking it to
exactly its own inward quadrant regardless of how the border/radius paints
-- a guarantee, not an inference. Also: corner-arc box size bumped from
2yd to 3yd (user-specified, larger than the real 1yd radius for visibility
at this render scale) and `.ml-pitch-field`'s border-radius set to 0 (a
real pitch has sharp corners, not rounded ones -- the rounding was only
ever meant for the outer margin wrapper).

### Curved shot trails (2026-08-14)

The ball previously moved in a straight line for every event (a CSS
transition on `--marker-x`/`--marker-y`). Asked for actual bend on
finesse/curl shots, direction tied to the striker's preferred foot. This
is a real architecture change, not a tuning pass: CSS transitions can't
follow a curved path via `left`/`top` alone, so shot events now animate via
`requestAnimationFrame` computing points along a quadratic bezier, while
every other movement (pass, cross, tackle, etc.) keeps the simpler
CSS-transition straight-line move.

**Critical constraint from the review, and the one that shaped the whole
design: the animation must visualize an engine decision, not invent one
after the outcome is known.** `selectStrikeMechanics(shooterEntry,
finishType, pressure, random)` -- a new, clearly-labeled Match-Lab-only
function -- runs at the exact point `finishType`/`shotType` is already
selected (inside `resolveShoot()`, Scenario Probe's "shot", and "free-kick"),
consuming the SAME seeded `random()` already resolving the rest of that
event. The result (`strikingFoot`/`contactType`/`footSource`) is stored on
the trace event itself, same as every other field. Replay never
re-invokes any resolver, so it always reproduces the identical
foot/contact/curve by reading it back from the stored event -- confirmed
directly: `curveControlPoint()`/`quadraticBezierPoint()`/
`animateBallAlongCurve()` contain zero `random()` calls between them.

Confirmed via direct code reading before building anything: the real
production engine has no concept of foot or contact type at all
(`matchEngineCore.js`'s own comment on `DELIVERY.SWING` says foot
preference "isn't currently plumbed into match players"). This stays
entirely Match-Lab-side. "Left Foot"/"Right Foot" attributes themselves
ARE real, already-available data though (verified directly: `playerAttribute(player,
"Left Foot")` resolves as `source: "direct"` for any player carrying
standard CM/FM attribute data) -- reading them needed no new plumbing.

**Decision rules** (full spec from the review, implemented as given):
stronger foot by default; a weaker-foot strike is gated by a usable
rating threshold (>=11) and situational pull (pressure, the closest real
signal Match Lab has to "shooting angle/body position" -- not a flat
chance rolled on every shot); outside-foot contact only offered on the
PRIMARY foot for placed (non-power) attempts, gated on technique/flair
(this database has no PPM data like "Avoids Using Weaker Foot" to gate on
directly, so technique/flair is the honest available proxy, not "reverse
curl would look nice"); power finishes (blast/fk-hard) default to laces
contact with minimal curl magnitude; placed finishes default to inside
contact with a pronounced curve. No real (non-baseline) foot data on a
player -> documented fallback (primary foot, conventional contact,
`footSource: "fallback"`), not a crash or an invented nuance.

**Curve geometry:** the control point for the shot's quadratic bezier is
offset perpendicular to the shot's own direction (not a fixed screen
axis, so it reads correctly whichever way a shot is aimed) by a signed
fraction of the shot's own distance -- direction from `strikingFoot`
(mirrored for `right` vs `left`), sign flipped for `outside` contact
(reverses the inside-contact bend for the same foot, exactly as
specified), magnitude near-zero for `laces`. Verified against the review's
own worked example (Roberto Carlos, left-footed, curling from wide right
in toward the left post) by direct calculation, not assumption -- a
left-footed inside strike bends toward the striker's own left, matching
that example exactly -- and confirmed correct against 7 required test
cases (see below) before considering this done.

**Visible trail:** a new `<svg viewBox="0 0 75 120">` layer inside
`.ml-pitch-field`, sized to the field's real yard dimensions rather than
the 0-100 percentage grid every other marking uses -- a square viewBox
would have stretched the stroke non-uniformly on this non-square field.
match-lab.js converts percentage coordinates to yards when drawing into
it. Fades in when a curved shot starts, fades out ~350ms after the ball
arrives.

Also fixed while building this: the ball marker's label span was removed
(no more "Ball · Z##" tag); a player marker dragged while holding the ball
now keeps the ball's own DOM position in sync (it used to lag until the
next full re-render); `.match-lab-marker` no longer uses flex-column
layout to center itself, since that centered the whole dot+label stack
and the ball (no label) ended up centered differently from a player's dot
(label pushed the anchor) -- the label is now `position:absolute` and
fully out of the centering calculation; and Reroll now restores from the
existing `state.setupSnapshot` before re-resolving instead of capturing a
fresh snapshot from wherever the previous roll's animation had already
left things, which was letting positions drift further from the
constructed setup on every successive reroll.

**Verified** (`test-strike-mechanics.mjs`, 7 cases matching the review's
own required test list exactly): left/right-foot inside curls mirror
correctly; outside contact reverses the inside-contact bend for the same
foot (both directions); laces shots curve meaningfully less than
inside/outside; a genuinely two-footed player's weaker-foot strikes are
reachable but stay a clear minority (25.1% in a 3000-run sample, gated,
not a coinflip); a one-footed player (weak foot rating 6, below the
usable-11 threshold) never uses it in 3000 runs; the no-foot-data fallback
returns `footSource: "fallback"` with sensible contact defaults for both
placed and power finishes; identical seeds reproduce byte-identical
strike-mechanics output. Full regression suite unaffected (nothing here
touches `draft-run.js`/`matchEngineCore.js`). Not verified in an actual
browser -- the curve math and gating logic are confirmed correct, but
whether it *looks* right (curve magnitude, trail timing, whether 0.22
reads as "pronounced" without looking silly) needs a real look.

### Ball-flow chaining + miss destination fix (2026-08-14)

Two bugs found via actual browser use of the curved-trail feature above.

**"Ball travels twice."** Reported on a free kick: the ball flew from the
taker to goal for `FK.WALL.NONE` (clearing the wall), then flew from the
taker to goal *again* for `FK.SHOT.HARD`. Root cause, confirmed by
re-reading every multi-event sequence in the file (35 `ballFrom: pointOf(`
sites audited): each chained event independently set `ballFrom:
pointOf(<the original actor>)` instead of continuing from wherever the
*previous* event's `ballTo` had actually left the ball -- so every
sequence with more than one ball-flight event snapped back to the start
and re-flew. This wasn't unique to free kicks; it recurred anywhere a
shot/pass/header event was followed by a save, block, or interception
event.

Fixed by two complementary rules applied at every chained site:
- If an event's `ballTo` in the previous step already equals where this
  step's ball conceptually is (e.g. `goalPointFor(shooter, keeper)` IS
  `pointOf(keeper)` whenever a keeper's placed -- confirmed by reading
  `goalPointFor()` itself, not assumed), the later event (the save) drops
  `ballFrom`/`ballTo` entirely. The ball simply stays where it visually
  already arrived; the keeper-dive/pulse effects still fire off
  `actorId`/`keeperId`, which don't depend on ball movement.
- Where an event does something genuinely new to the ball's position (a
  wall block redirecting it to a defender, a rebound continuing from the
  keeper rather than the original shooter), `ballFrom` now reads from the
  prior event's real endpoint instead of resetting to the original actor.

Fixed at: free kick's wall-clear (no flight of its own now -- clearing
isn't a ball movement, the strike below is), wall-hit, on-target roll,
and save; `resolveShoot()`'s on-target roll, `D.BLOCK` (now redirects from
`goalPointFor()` to the defender instead of resetting to the shooter),
save, and uncontested rebound-shot; `resolveCross()`'s header-attempt,
save, and uncontested rebound-shot; Scenario Probe "shot"'s on-target
roll, save, and uncontested rebound-shot; `resolveReboundScramble()`'s
first event (now starts from `pointOf(keeper)`, not a zone-center
approximation -- it's only ever called right after a save, so that's
genuinely where the loose ball is); and `resolvePass()`'s contested
branch, where an interception was resetting back to the passer instead of
the pass event just flying straight to the interceptor in the first place
(`duel.won` is already known before that event is pushed, so this needed
no restructuring, just using the fact already in scope).

**"Off-target and the goal animation go to the same place."** Every
on-target/off-target roll unconditionally used `goalPointFor(...)` for
`ballTo` regardless of `attempt.onTarget` -- a miss and a goal flew to the
identical point. New `missPointFor(shooterEntry, keeperEntry, curveHint)`
(placed right after `goalPointFor()`) offsets from that same goal point
(wide and slightly long) rather than inventing an unrelated trajectory --
reusing the shot's own `strikingFoot`/`contactType` curve direction when
available, so a miss leans the same way the shot's own curl would, and a
neutral away-from-center lean when there's no foot data (headers, rebound
scrambles). Clamped to stay a plausible near-miss. Wired into every
on-target/off-target and goal/no-goal roll: free kick, `resolveShoot()`,
`resolveCross()`'s header, Scenario Probe "shot", and both
`resolveReboundScramble()` and the uncontested rebound-shot branches
(scored vs. not).

**Verified:** `node --check match-lab.js` after every edit; full
`resolveReboundScramble`/free-kick/`resolveShoot`/`resolveCross`/
`resolvePass` call sites re-read end to end to confirm each event's
`ballFrom` now matches the literal previous event's `ballTo` (not just
"close," exact object-shape equality via the shared `pointOf()`/
`goalPointFor()` helpers); `node tools/test-draft-game.mjs` still green
(match-lab.js isn't exercised by that suite -- a smoke check that nothing
else broke, same as every other round this session). Not verified in an
actual browser yet -- whether the now-continuous flights and the offset
miss destination *read* right needs a real look, same caveat as every
other animation round.

### Outcome-presentation adapter (2026-08-14)

The chaining fix above stopped the ball from re-traveling, but every
keeper result still collapsed onto one generic `movement:"save"` event --
a clean catch, a fingertip tip round the post, and a fumble all rendered
identically (ball to the keeper's spot, same dive flourish). Found via the
user's own browser use, same as the two bugs above. This is a genuinely
new layer, not a tuning pass: **no probability anywhere changed** --
`resolveKeeperSave()`/`resolveFinishAttempt()`/`resolveFreeKickAttempt()`
are untouched; this only decides how an already-decided `K.SAVE.*`/miss
code is drawn.

**Centralized mapping, not per-caller logic.** `KEEPER_SAVE_PRESENTATION`
maps all 9 `K.SAVE.0-8` codes to `{keeperAction, ballResult, restart,
badge}`, read directly off `resolveKeeperSave()`'s own code table
(`matchEngineCore.js:503-552`: rebound `true` only for .2/.5/.6, goal
`true` only for .8, .0 a separate clean-beaten early return) --
`keeperAction` collapses to 6 values across 9 codes by design (`catch` is
only .1; `tip` covers .3/.6/.7/.8, the four codes where the keeper gets a
hand/glove on it without securing it; `fumble` covers .4/.5, distinguished
from each other by `ballResult`/`restart` rather than a 7th keeperAction
value). One new function, `pushKeeperSaveEvent(trace, {shooterEntry,
keeperEntry, save, strikeMechanics, movement, label})`, is the only place
in the file that builds a keeper-save trace event -- `resolveShoot()`,
`resolveCross()`'s header, Scenario Probe "shot", and the free-kick
scenario all call it instead of hand-building their own, so the same code
always ends the same visible way everywhere it can happen. Deliberately
**out of scope**: `resolveOneOnOne()`'s breakaway `K.ONEONONE.*` codes (a
different resolver, no post/corner distinction modeled at all -- extending
the same badge/path treatment there would mean inventing semantics the
engine doesn't support) and the "Cross & Header" Scenario Probe's
single collapsed `resolveDelivery()` event (already documented as
structurally unable to show intermediate beats, unchanged from the
curved-trail round). Both were left exactly as the previous chaining-fix
round left them -- correctly chained, generic presentation.

**Geometry, separated as asked.** `goalPointFor()` used to double as
"the keeper's position" for every purpose; now split into distinct
concepts: `postPointFor()` (regulation 8yd goal width on the existing
0-100 grid -- posts at x=44.67/55.33, per the dimensions already used for
`.ml-pitch-goal-top/-bottom`), `netPointFor()` (same x, just past the
goal line, offset to stay inside `.ml-pitch-field`'s 4% margin so it's
still visible, not clipped by `.match-lab-pitch`'s own
`overflow:hidden`), `outsideCornerPointFor()` (wide of a post AND past the
line -- a real corner-kick situation), `reboundInBoxPointFor()` (inside
the box, clamped to the goal-mouth width, in front of goal). `postPointFor`'s
LEFT/RIGHT choice (`choosePostSide()`) is deterministic, never a fresh
`random()` call: it reuses the *exact* perpendicular-bend formula
`curveControlPoint()` already draws a visible curve with (same
`rightX`/`rightY`, same `strikingFoot`/`contactType` direction sign), so a
save's post always agrees with whichever way that shot's own trail is
already bending. No curve data at all (a header) falls back to the
shooter's own side of the pitch -- the single most common real near-post
situation, not a coin flip.

**9 distinct paths, spelled out per-code in `buildKeeperSaveSegments()`**
rather than derived from `ballResult` (K.SAVE.2 and .5 share a
`ballResult` but not a `keeperAction`; .6/.7/.8 share a post contact but
diverge completely after it, so a shared branch would have needed as much
per-code special-casing as just writing all 9 out):
```
K.SAVE.0 (beaten, no touch):    contact -> net                    [GOAL]
K.SAVE.1 (clean catch):         contact                           [CAUGHT, held]
K.SAVE.2 (parry/drop):          contact -> rebound (in box)       [PARRIED]
K.SAVE.3 (fingertip):           contact -> outside (past line)    [CORNER]
K.SAVE.4 (fumble, recovers):    contact                           [SPILLED, held]
K.SAVE.5 (fumble, loose):       contact -> rebound (in box)       [SPILLED]
K.SAVE.6 (post -> in):          contact -> post -> rebound        [POST]
K.SAVE.7 (post -> out):         contact -> post -> outside        [POST]
K.SAVE.8 (post -> goal):        contact -> post -> net            [GOAL]
```
`contact` is always `pointOf(keeperEntry)` -- the shot event pushed just
before this one already delivered the ball there (`goalPointFor(shooter,
keeper)` IS `pointOf(keeper)` whenever a keeper's placed, same invariant
the chaining-fix round established), so `pushKeeperSaveEvent()` never
re-travels that leg, only whatever happens after contact.
`pushKeeperSaveEvent()` returns the real final endpoint, and every
downstream consumer (`resolveReboundScramble()`, now taking an explicit
`originPoint` parameter instead of always deriving from `pointOf(keeper)`;
every uncontested rebound-shot's own `ballFrom`) uses that returned value
-- not `pointOf(keeper)`, which is flatly wrong the moment the outcome is
a parry or a post rebound and the ball is actually sitting somewhere else
in the box.

**Misses, code-aware.** `missPointFor()` now takes the actual finish/
attempt code and looks it up in `MISS_BADGE`: `F.BLAST.OVER`/
`FK.SHOT.HARD.OVER` go out centrally with `heightCue:true`; every other
miss code (`F.CALM.WEAK`, `FK.SHOT.REGULAR.WEAK`, `F.FINESSE.WIDE`,
`FK.SHOT.CURL.WIDE`, `F.HEADER.OFF`) goes out wide of a post, side chosen
the same deterministic way a save's post is. No post-only "hits the post"
miss code exists for an unsaved attempt (only `K.SAVE.6/.7/.8` model post
contact at all), so none was fabricated here -- an ordinary miss only ever
gets a WIDE or OVER badge, never POST.

**Height cue.** A top-down view has no z-axis, so x/y alone can't tell an
over-the-bar miss apart from one heading into the net -- `heightCue:true`
now also sets `data-height="over"` on the ball marker, which scales it up
and fades it out over the event's own duration (`match-lab-ball-over`
keyframes in styles.css) in addition to the OVER badge.

**Multi-leg playback.** `pathSegments` (contact -> post -> outcome, etc.)
animates via a new `animateBallAlongSegments()` -- plain chained CSS
transitions per leg via the existing `setMarkerPosition()`, deliberately
NOT the curved bezier `animateBallAlongCurve()` uses: the curve belongs to
the shot's own foot-struck flight (already drawn by the preceding shot
event), a post deflection afterward isn't a curl and shouldn't look like
one. `applyStepAnimation()` picks curved-bezier / multi-leg-segments /
straight-CSS-transition in that priority order per event, so the two
mechanisms never conflict (a save event never carries
`strikingFoot`/`contactType` itself, so it can never trigger the curved
path).

**Result badge + held/attach.** New `#labResultBadge` element (inside
`.ml-pitch-field`, so it's positioned relative to the pitch, not the
whole page) shows CAUGHT/PARRIED/SPILLED/POST/CORNER/WIDE/OVER/GOAL,
synchronized with the event exactly like the pulse/dive/celebrate
flourishes -- cleared and re-shown every step, same "CSS animations don't
restart on the same attribute value" discipline. `ballResult==="held"`
(caught or a recovered fumble) sets `data-held="true"` on the ball marker,
scaling it down against the keeper it's already sitting exactly on top
of, instead of leaving a live-ball-sized dot floating there.

**Verified** (`test-keeper-outcome-adapter.mjs`, mirrors the geometry/
presentation logic the same way `test-strike-mechanics.mjs` mirrors the
curl logic, since match-lab.js can't be imported directly): every
`K.SAVE.0-8` code's path starts at the real contact point (no re-travel);
catches/recoveries (.1/.4) report `restart:"keeper-possession"` with zero
further ball movement; corner outcomes (.3/.7) report `restart:"corner"`
and land both wide of the frame AND past the goal line; a post appears in
the path ONLY for .6/.7/.8, never fabricated elsewhere; the goal flash
condition (mirrored from `resolveKeeperSave()`'s own `goal` flag, run
4000 times against the REAL imported function, not reimplemented) fires
for exactly .0 and .8 and nothing else; `choosePostSide()` is a pure,
deterministic function (same inputs -> same output, verified directly,
not just assumed); every one of the 7 off-target codes gets a distinct
endpoint from the on-target one (closing the original "goal and miss go
to the same place" bug for every miss flavor, not just the generic case);
identical stored save data reproduces byte-identical segments across two
independent builds (the Replay guarantee). All 9 K.SAVE codes and all 7
off-target codes were exercised directly in this fixture script -- a test
gallery, per the instruction -- never by adjusting
`resolveKeeperSave()`'s weights or any Scenario Probe distribution; none
of those were touched. `node --check match-lab.js` and
`node tools/test-draft-game.mjs` both green. Not verified in an actual
browser -- whether the badge timing, the held/scale-down treatment, and
the OVER height cue read clearly at real animation speed needs a real
look, same caveat as every other animation round this session.

Not built this round, left for a follow-up if wanted: an in-app forced-
code preview panel (pick any `K.SAVE.*`/miss code directly from the UI and
play just that animation, instead of hunting for a seed that rolls it) --
today's verification was a Node fixture script, not an in-browser gallery.

### Shared sample-based audio system (2026-08-14/15/16)

`src/lib/matchSound.js` -- previously an unwired synthesized-sound
prototype, never imported anywhere -- rebuilt into the shared audio
director both Match Lab and `draft-run.js` (the actual match) import
identically: `unlock()/setEnabled()/setMasterVolume()/preloadCore()/
playCue()/playEvent()/stopAll()`. Web Audio buffers (`fetch` +
`decodeAudioData()`, not `<audio>` tags) since some outcomes layer several
precisely-timed sounds (a keeper touch immediately followed by a post
clang). Four gain buses (effects/crowd/commentary/master).

**Asset pipeline.** `sounds/` holds 146 raw WAVs (~155MB, mostly
uncompressed PCM, several exact duplicates by MD5). None of that is
deployed. `tools/convert-sounds.mjs` transcodes a curated ~20-cue subset
via ffmpeg (silence-trimmed, loudness-normalized, hard duration caps --
short for contact SFX, longer for crowd/whistle ambience) into
`sounds/v1/*.mp3` -- currently 22 files, 3.3MB total. Raw WAVs are
excluded from every deploy path (`.vercelignore`, `.gitignore`,
`tools/build-pages.mjs` copies only `sounds/v1/`), MIME types added to
`server.js`, immutable Vercel caching added for `/sounds/(.*)` (filenames
are versioned, e.g. `ball-kick-v1.mp3`).

**Shared code -> cue mapping.** `resolveCueSequence(code, context)` is the
one function both callers read from -- keyed on the same engine code
strings both Match Lab's trace events and draft-run.js's `scenarioType`
field already carry (both call the identical `matchEngineCore.js`
resolvers, so this needed no new data plumbing). `KEEPER_SAVE_PRESENTATION`-
style logic reused: kick fires once, at shot-selection, never re-fired on
the following `K.SAVE.*` event; K.SAVE.6/7/8 fire keeper-contact -> post ->
net/reaction in that order; misses get a restrained reaction, never a
kick repeat. Deterministic variant selection via a local FNV-1a
`stableHash(playbackId, eventId, cue) % variants.length` -- never
`Math.random()`, so Replay reproduces the identical sample.

**Match Lab integration.** `unlock()`/`preloadCore()` fire synchronously
inside Roll/Play/Replay/Reroll's own click handlers (never after an
`await`, satisfying the autoplay-gesture requirement). Sound is tied to
real animation milestones, not event-render time: keeper-contact fires at
t=0, post fires exactly when `animateBallAlongSegments()`'s new
`onLegArrive` callback reaches the post waypoint, net/reaction fires on
final arrival -- all driven by the same waypoint data the outcome-
presentation adapter above already computes, not a guessed delay.
`stopAll()` folded into the existing `clearStepEffects()`, so every
existing Reset/Reroll/Replay call site stops stale audio for free. Run N
never plays anything, structurally -- it never calls
`applyStepAnimation()`, the only place sound is triggered from.

**Training-ground framing (added after browser feedback).** Match Lab
rolls the same isolated scenario over and over, so a full crowd
goal-reaction cheer or a "missed chance" groan firing on every repeated
test roll read as noise. `setTrainingMode(true)`, called once at Match
Lab's init, makes `playCue()` drop every crowd-bus cue there entirely
(centralized in matchSound.js, not a per-cue blocklist in match-lab.js) --
physical contact sounds are unaffected. A second mechanism,
`TRAINING_EXCLUDED_VARIANTS`, excludes individual samples that are fine
for a live match but wrong for training specifically (`cross-v2.mp3` has
live-match background noise baked in) from Match Lab's variant pool only
-- the sample itself stays in `SOUND_BANK`/`sounds/v1` for the real match.
Two samples (`shotBlocked.wav`, the `longPass_2/_3.wav` takes) were judged
outright unrealistic on review and removed everywhere, reusing `clearance`/
`groundPass` instead of shipping a bad-sounding dedicated cue.

**Actual-match integration.** `draft-run.js` has no per-event animation
timeline at all (it's a periodic-snapshot renderer over
`reduceMatchTimeline()`, not a frame-by-frame pitch animation), so
`playEvent()` -- the fixed-approximating-delay scheduler, the same
function `resolveCueSequence()` was designed to support for exactly this
case -- drives it instead of fine-grained waypoint callbacks. Gated on
`isLiveArrival` (an existing dedup flag) so a tab-resync catch-up after
being backgrounded stays silent rather than firing a stacked burst for
events that "happened" off-screen. `unlock()` fires synchronously inside
`playNext()`, the single click handler behind Start/Continue/Play across
group/knockout/Titan modes. The friend-room flow is a known gap: a match
there starts automatically over a websocket once both squads arrive, with
no click at the exact trigger moment, so autoplay can't be unlocked there
by design -- the always-visible header Sound button is the one available
unlock point for that flow.

**Verified:** `node --check` on every touched file; `node tools/
test-draft-game.mjs` green; the pages build regenerates `docs/sounds/v1`
correctly and excludes the raw WAV directory (confirmed by running it).
**Not yet done:** a dedicated Node test suite for matchSound.js itself
(disabled -> zero calls, Run N silent, replay reproduces variants, etc --
the behavioral guarantees above are verified by code construction/reading,
not an automated suite yet) and real browser listening/timing verification,
same caveat as every other animation round this session.

### Post-action convergence budget shortened: "freeze time shortened but still existing" (2026-08-21)

Fifth report on this thread. The concurrent-reactions fix immediately
below (same day) was real and user-confirmed ("the freeze time
shortened"), but not sufficient ("still existing. And I can feel it.").
That fix collapsed N stacked sequential 450ms beats into one shared
450ms beat -- it never questioned whether 450ms was the right size for
that ONE remaining beat, only that there should be one instead of two or
three.

**Investigated first, before touching anything:** re-exposed
`window.__debugHook` and measured, directly, what that 450ms was
actually buying. Hypothesis A -- the post-carry reaction target is
usually close, so cap the window at how long the SLOWEST real mover
genuinely needs (`timeToReach()`, the same acceleration-aware physics
`reachIn()` already uses, inverted) rather than always spending the
caller's flat `totalMs`. Implemented as `effectiveTotalMs` inside
`reactOffBallContinuous()` (`Math.min(totalMs, Math.max(150,
slowestNaturalMs))`, applied only to the `overlapWithPrevious:false`
case). Measured its actual effect with an 800-seed sweep sampling every
post-`P.CARRY` reaction: **0% of 1,127 sampled events dropped below
450ms.** Root cause of the null result: `CONTACT_REACTION_DELAY_MS`
(120ms) plus `reachIn()`'s realistic acceleration ramp already consumes
almost the entire 450ms even for the ~0.3-yard targets this call
actually produces (`movingEntries`' own >0.5yd filter guarantees a real
target, but "real" here still means small) -- the natural time and the
flat budget were already coincidentally the same number, so capping
against the natural time capped against itself.

**Correct fix:** the 450ms figure was never a physical requirement in
the first place -- it's `MOVEMENT_DURATIONS.reposition`, a constant
shared with unrelated, genuinely-450ms-scale UI reformation, reused here
by convenience rather than derived from what THIS call needs. And what
this call needs, per the measurement above, is never actually "450ms of
real convergence" -- it's a bounded acceleration ramp that plateaus
almost immediately regardless of the window handed to it, while the
ball carrier (the entire visual focus) has zero movement scheduled
anywhere in the same window. Introduced `POST_ACTION_CONVERGENCE_MS =
200` (near `INTERLEAVED_REACTION_FRACTION`/`_DURATION`, the existing
thematically-similar per-touch constants) and pass it instead of
`MOVEMENT_DURATIONS.reposition` at the post-action call site only
(`runConstructedPossession`'s `continuesLive` branch). The pass-flight
call site (`resolvePass`, `overlapWithPrevious:true` by default) is
untouched -- there `totalMs` is the ball's own real flight duration, a
different, already-correct case. `effectiveTotalMs`/`timeToReach()`
capping stays in place underneath as a safety net for genuinely slow
movers or genuinely distant targets; it simply isn't what does the work
for the common case.

**Verified:** re-ran the same measurement methodology against the new
code -- of 1,895 sampled post-`P.CARRY` reaction events, **100% now
measure exactly 200ms** (was 100% at 450ms). A full-cycle timeline
reconstruction (`P.HOLD` -> `GK.ADJUST` -> `P.CARRY.TOUCH` x3 ->
`P.CARRY` -> `GK.ADJUST`) confirms the shortened reaction lands as a
PRIMARY sequential interval in the real playback timeline, not merely a
display artifact. Full 14-suite regression green (`test-draft-game.mjs`
red-card-frequency failure reproduced in isolation on an unrelated
retry -- pre-existing statistical flakiness in `matchEngineCore.js`
disciplinary logic, zero code overlap with this change -- confirmed
passing on its own retry). A real-UI Playwright smoke test (Resolve &
Play, then five real Reroll clicks, zero use of any debug hook) captured
zero console/page errors. `match-lab.js` cache-bust bumped to
`?v=20260821-02`. All debug instrumentation (`window.__debugHook`) and
temporary measurement scripts removed after verification.

### The REAL "stop and play" cause, finally: sequential instead of concurrent post-action reactions (2026-08-21)

Fourth report on this thread, this time with a full event log AND a
precise, fully-verified diagnosis. The previous "freeze" fix (Reroll's
missing try/catch) was real but addressed a DIFFERENT failure mode (a
dead clock after a rare validation throw); this report -- 4 freezes
across one continuously-watched possession, matching 4 `ACTION.CHOICE`
"chooses to carry" cycles exactly -- was something else entirely, and
this time the investigation nailed it with reproducible, quantified
evidence instead of a plausible-sounding guess.

**Method, this time:** exposed a temporary `window.__debugHook` (`runOnce`,
`state`, `installPlaybackPlan`, `startPlayback` -- removed again once done)
so thousands of seeds could be searched IN-BROWSER, synchronously, in
milliseconds -- reproducing the user's exact "4+ carry cycles" trace
shape took 100+ real Reroll-button clicks to fail at (never succeeded),
versus 1 seed out of the first few tried once search was in-process.
Instrumented `applyPlaybackCue()` to log every fired cue's code + exact
`performance.now()` timestamp + its own synchronous execution time, and
watched full playback with both `requestAnimationFrame` gap tracking AND
a `PerformanceObserver({entryTypes:['longtask']})` (catches ANY main-
thread block >=50ms -- layout/paint/composite included, not just JS --
unlike a CPU-sample-only profile).

**Result: zero technical stalls** (0 RAF gaps >60ms, 0 longtasks) but a
PERFECTLY REGULAR ~1620ms-per-cycle rhythm, and the cue timestamps
showed exactly where that time went: `P.CARRY.TOUCH` (223ms) + `P.CARRY`
(501ms) = ~724ms of actual carrier movement, then `GK.ADJUST` (450ms)
immediately followed by `DEF.ADJUST` (450ms, SEQUENTIALLY, not
concurrently) = ~900ms where the ball carrier -- the entire visual focus
-- has nothing scheduled and does not move at all, before the next
`ACTION.CHOICE`. 900 of 1620ms (56%) was dead time, once per cycle.

**Root cause:** this is the post-action "everyone's actually arrived"
convergence step (`runConstructedPossession`'s `continuesLive` branch),
which already correctly uses the modern `reactOffBallContinuous()` (the
system explicitly built 2026-08-20 to KILL exactly this "stop and play"
model for pass flight -- see that function's own header comment, which
even says other resolvers "weren't reported broken" at the time, i.e.
this was a known, accepted gap, not an oversight). But
`reactOffBallContinuous()` can push up to three real events from ONE
call -- `ATT.ADJUST`/`GK.ADJUST`/`DEF.ADJUST`, one per role that has a
move -- and was passing its OWN `overlapWithPrevious` parameter
unchanged to all three. That's harmless when it's `true` (the pass-
flight case, where all three already correctly share the producer's own
window) but a real bug when it's `false` (the post-action case, which
deliberately wants "its own interval" separate from the JUST-CONCLUDED
action -- see the parameter's own comment): `buildMatchLabPlaybackPlan()`
gives an `overlapWithPrevious:false` event its own PRIMARY, sequential
interval, so 2 real pushes from one call became 2 back-to-back 450ms
intervals (keeper, THEN defender) instead of one shared one -- verified
directly: `GK.ADJUST`/`DEF.ADJUST` from the SAME call showed
`overlapWithPrevious:false`/`false` (both anchoring their OWN interval)
in the raw trace, not `false`/`true`. Would scale to 3x450ms=1350ms
whenever a teammate also needs repositioning in the same reaction.

**Fix:** only the FIRST real (non-cueOnly) push from one
`reactOffBallContinuous()` call now uses the caller's own
`overlapWithPrevious`; every push after that is forced to `true`
regardless -- joining the first one's window rather than starting its
own. Correct either way: a `true`-calling caller (pass flight) already
wanted every push concurrent with the SAME preceding window, so forcing
`true` on pushes 2/3 changes nothing there; a `false`-calling caller
(post-action) gets exactly one shared interval instead of N sequential
ones.

**Verified, precisely, not just "tests still pass":** re-ran the exact
seed that reproduced the bug -- raw trace now shows `GK.ADJUST`
`overlapWithPrevious:false` (still correctly anchoring, unchanged) and
`DEF.ADJUST` `overlapWithPrevious:true` (now correctly joining, was
`false`); the SAME cue-timestamp instrumentation now shows `GK.ADJUST`/
`DEF.ADJUST` firing at the identical millisecond every time (concurrent),
and per-cycle time dropped from ~1620ms to ~1183ms -- a ~440ms reduction
matching the eliminated second sequential beat almost exactly. Separately
verified the 3-role case (attacker + keeper + defender all reacting from
one call): `ATT.ADJUST overlapWithPrevious:false`, `GK.ADJUST`/
`DEF.ADJUST` both `true` -- confirmed collapsing to one window there too,
not just the 2-role case actually tested end-to-end. Full existing suite
(14 suites) still green. All temporary instrumentation (`__debugHook`,
`applyPlaybackCue`'s cue-trace logging) removed before finishing.

**Not fully eliminated, by design:** the post-action convergence itself
(now correctly ~450ms instead of ~900-1350ms) is real, intended behavior,
not a bug -- the world genuinely needs a moment to reposition after an
action concludes. What was fixed is the ACCIDENTAL multiplication of
that one intended beat into several stacked ones, not the beat's own
existence.

### Actual root cause of "the pitch freezes" found: an uncaught throw on Reroll (2026-08-21)

Third report of freezing, this time with exact repro data (a full event
log + 3 screenshots at the freeze points). The log showed 4 `ACTION.CHOICE`
decision cycles; the user reported 3 freezes -- exactly matching the 3
transitions between cycles. That pattern held up under direct
investigation, but not for the reason first suspected.

**Ruled out:** re-profiled a real multi-cycle carry trace end to end
(RAF-gap tracking + a CPU profile across the WHOLE playback, not a fixed
window this time) -- clean throughout, no real rendering stall. Also
directly A/B tested whether the earlier off-ball velocity-smoothing fix
(`IDLE_GAP_THRESHOLD_MS`) was the cause, by toggling it back to
"always zero" and re-sampling 50 rolls each way: 2/50 errors with the old
behavior, 3/50 with the fix -- statistically indistinguishable, so that
fix is NOT the driver (a real relief, since it otherwise measurably fixed
the reported stutter).

**Actual cause:** while sampling many real rolls looking for the above,
found a genuinely pre-existing bug (present even with the old, more
conservative velocity behavior): `validateMatchLabPlaybackPlan()`'s
contact-point check throws on a small fraction of rolls (~4-8% in
sampling) -- a real, still-unexplained precision drift between where a
player's own track says they are at a given `contact.timeMs` and the
`contact.point` a later event expects (steady, compounding, same actor,
same nominal point across several consecutive events -- looks like a
`matchMotion.js` `stabilizeTarget()`-style blended-target-vs-stated-
contact mismatch, not confirmed). That part is NOT fixed this pass --
flagged for separate investigation.

What WAS actually broken: `elements.playButton`'s click handler wraps its
`installPlaybackPlan()` call in try/catch, showing a clear "Could not
build playback" message on failure (`showPlaybackError()`). But
`elements.rerollButton`'s handler -- "New Outcome," used for every roll
after the first -- had NO try/catch at all. `installPlaybackPlan()`'s
own first line was `playbackClock?.destroy()`, BEFORE the (occasionally
throwing) `buildPlaybackPlan()` call -- so a validation failure on
Reroll destroyed the old clock, then aborted before creating a new one
or calling `startPlayback()`. `state.lastTrace`/`renderTrace(0)` (a few
lines earlier in the SAME handler, before the throw) had already updated
the visible log/inspector to the new roll's real content. Net result:
the event log visibly advances to genuine, correct text -- exactly what
the user pasted -- while the pitch itself has no clock running at all
and never animates again. No error, no console message the user would
notice, nothing to explain it. That's "the game froze," precisely.

**Fix, two parts:**
1. `installPlaybackPlan()` now builds the new plan BEFORE touching
   anything about the current one (`playbackClock?.destroy()` moved
   after a successful `buildPlaybackPlan()` call) -- a failure now
   leaves the PREVIOUS roll's plan/clock fully intact and still playable,
   not destroyed-and-replaced-with-nothing, regardless of whether the
   caller has its own try/catch.
2. `rerollButton`'s handler wrapped in the same try/catch
   `playButton`'s already had, showing the same visible error on failure.

**Verified two ways:** (a) sampled 60 real rolls post-fix, zero uncaught
`pageerror`s (previously several per 40-60 rolls); (b) forced a
deterministic failure (monkey-patched `Object.freeze` to throw once,
simulating the validation throw without waiting for the rare real
condition) and confirmed the error message displays correctly AND a
subsequent normal Reroll immediately recovers -- full round-trip proof,
not just absence-of-error-in-a-lucky-sample. Full existing suite (14
suites) still green.

### "Every goal in the same spot" -- shot placement reaches REBOUND.GOAL/EMPTY_NET (2026-08-21)

User report: goals always land in roughly the same part of the goal
frame despite it being a wide box. Root cause: Shot Placement v1
(2026-08-20) gave the PRIMARY on-target shot event genuine placement
variety (`shotPlacementSpread()`, biased away from the keeper, scaled by
Finishing/Technique/Composure) -- but that was the only path wired up to
it. Every REBOUND.GOAL site (4 of them: open-play, free-kick, header,
regular-shot rebounds) and the header's own EMPTY_NET path all still
called `netPointFor(shooter, 50)` -- literally hardcoded dead center,
unconditionally, every single time.

Extended `shotPlacementSpread()` itself first: its no-keeper/beaten-
keeper branch used to fall straight back to `goalPointFor()`'s fixed
x:50 (no variety at all in an empty net). Now it spreads around true
goal-center instead of a real keeper's x when there's nobody to aim away
from -- still genuine, quality-scaled, deterministic variety. Then wired
all 5 previously-hardcoded sites to it: the 4 REBOUND.GOAL sites get a
new `REBOUND_SHOT_PRESSURE` (0.5 -- a scrambled, instinctive finish, less
composed than a set shot) and reuse each site's own `keeper`/`random`
already in scope; the header's EMPTY_NET path needed a real fix, not a
reuse, since headers never got Shot Placement v1 treatment in the first
place (still used raw `goalPointFor()` for their own on-target `ballTo`).

**Two real bugs found and fixed along the way, both the "never re-derive
a placement point, compute once and reuse" class of bug this codebase
already has hard-won scar tissue over** (see `shotAimPoint`'s own
existing header comment predating this pass): a first attempt gave
EMPTY_NET's `ballFrom` a FRESH `shotPlacementSpread()` call instead of
reusing the shot's own already-computed aim point -- caught immediately
by `tools/test-possession-runner.mjs`'s "80 real multi-action possession
traces produce valid immutable playback plans" check (a genuine ball
discontinuity: the shot's own `ballTo` and the next event's `ballFrom`
landed at two DIFFERENT random draws). Fixed for the regular-shot path by
reusing the pre-existing `shotAimPoint`; for headers, by giving the
on-target header event ITS OWN placement variety (`headerAimPoint`,
pressure scaled by whether an aerial defender contests it) computed once
and threaded through to both the header's own `ballTo` and the
subsequent EMPTY_NET's `ballFrom`.

**Test fallout, all pre-existing/unrelated, all fixed while verifying
this specific change:** two `test-possession-runner.mjs` assertions
explicitly asserted the OLD "falls back exactly to goalPointFor()"
behavior for the no-keeper/beaten-keeper case -- updated to assert the
NEW behavior instead (genuine variety, still bounded within the posts,
still deterministic per seed, unbiased around true center). Separately,
an unrelated check ("resolveCross()/resolveThroughBall() never reference
the new Ball-Flight-v2 pass-flight module") turned out to have been
silently broken this entire time by a bare `\n` in its function-boundary
regex against a CRLF-encoded file (`\n}\n` cannot match `\r\n}\r\n`) --
made CRLF-tolerant; confirmed by direct regex test that neither function
actually references the pass-flight module, so the check's own intent
still holds.

Full existing suite (14 suites) green throughout.

**Not investigated this pass, discovered while spot-checking in a real
browser session (40 Free Play 5v5 rolls):** roughly 1 in 8 rolls threw an
uncaught `pageerror` matching `validateMatchLabPlaybackPlan()`'s own
contact-point-mismatch message, at scattered points deep into long
possessions (multiple different marker IDs, timestamps from ~5s to
~100s+ into a possession's own internal timeline), yet the Play/Pause
button still enabled normally every time (0/40 "never became ready"
failures) -- meaning whatever throws isn't blocking the visible resolve/
render path, it's happening somewhere else (a background/speculative
recompute is the leading guess, unconfirmed). `test-possession-runner.mjs`'s
own 80-seed sweep uses one fixed hand-built roster and stays green, so
this is specific to the real, varied rosters Quick Setup draws -- not
reproduced with a hand-built fixture yet. Flagged, not chased -- a
separate investigation, not part of what was asked this pass.

### Off-ball "stop and play" stutter fix (2026-08-21)

User report: continuous playback's off-ball motion (defenders/keeper
readjusting during a multi-touch carry) looked like a constant stutter --
stop, go, stop, go -- rather than one fluid run. Root-caused to
`matchLabPlayback.js`'s hermite keyframe builder: it forced velocity to
`{0,0}` at EVERY trajectory segment's start/end unconditionally (comment:
"Tactical moves start and finish at rest"). `GK.ADJUST`/`DEF.ADJUST`/
`ATT.ADJUST` fire as their own short, `overlapWithPrevious` segment on
EVERY producing event (each `P.CARRY.TOUCH` of a multi-touch carry gets
its own concurrent reaction) -- so a defender shadowing across a 5-touch
carry got 5 independent segments, each easing from a dead stop to a dead
stop, every ~220ms. Confirmed `matchMotion.js`'s `resolveMotionBatch()`/
`buildMotionTrajectory()` already computes exactly the right thing for
this -- a `carried`/`carryFactor` momentum-blend keyed on whether the
action is `continuing` (72% retained) vs fresh (18%) -- but
`matchLabPlayback.js` was discarding that computed boundary velocity and
overwriting it with a hard zero at the CONSUMPTION layer, undoing the
work `matchMotion.js` had already done correctly.

Confirmed the zero-forcing was NOT pure dead code, though: `sampleTrack()`
interpolates hermite-style between ANY two adjacent keyframes regardless
of how much real time separates them, and `hermiteTrackPoint()`'s
`h10`/`h11` terms scale by the segment's own span (`spanMs`) -- a nonzero
velocity carried across a genuine idle gap (hundreds of ms+) produces a
real, visible overshoot/"drift" even when both endpoints share the exact
same position (the original bug this zeroing was written to prevent, per
the removed comment). So the fix isn't "never zero" -- it's "zero only
across a genuine gap, not at every junction":
- `matchLabPlayback.js`: the trajectory-sample append no longer forces
  `{0,0}`; it trusts the generator's own `sample.velocity` always.
- New `zeroVelocityAcrossIdleGaps()`, run per-player after
  `normalizeTrack()`: walks consecutive keyframe pairs, zeroing velocity
  on both sides only when the real gap between them exceeds
  `IDLE_GAP_THRESHOLD_MS` (60ms -- comfortably above a single touch's own
  ~220ms cadence when back-to-back, comfortably below any genuine skipped-
  reaction gap).

Verified with a hand-built multi-touch fixture (4 back-to-back reactions,
then a real ~440ms gap, then one more): internal junctions between
back-to-back segments now carry small but genuinely nonzero velocity and
`sampleMatchLabPlaybackPlan()` shows smooth, monotonic position movement
straight through each boundary (no stop-start); the genuine gap's own
both-sides velocity still lands at exactly `{0,0}`, preserving the
original anti-drift behavior. Full existing suite (14 suites, including
`test:timeline-playback` and `test:motion`) still green -- contact-point
validation is unaffected by construction (hermite position at ratio 0/1
reduces to the exact endpoint regardless of velocity, only the curve
SHAPE between endpoints changes). Ball track untouched -- it never had
this zero-forcing to begin with (`addBallTrajectory()` already just uses
each sample's own velocity directly), so it was never subject to this
bug.

**Not done this pass:** `tools/test-draft-game.mjs` had unrelated
hard-coded assertions against the OLD `/api/draft-candidates` SQL text
from the previous session's Worker rewrite (`qualityQueries`, `"BETWEEN
140 AND 200"`, raw `"LIMIT 4"`) -- caught and updated to match the new
implementation while verifying this fix; not a regression from this
specific change, just a test that hadn't been re-run since the Worker
edit landed.

### Sample-based audio: v2 pack integration (2026-08-21)

`sounds/v2/` (61 files) added directly -- not run through `tools/
convert-sounds.mjs` (no raw-WAV source under `sounds/*.wav`) and, unlike
v1, not individually ear-reviewed; every mapping below is inferred from
the sample's own filename, not verified by listening. `matchSound.js`'s
`SOUND_BASE_URL` moved from `/sounds/v1/` to `/sounds/`, and every
`SOUND_BANK` filename now carries its pack prefix (`"v1/..."`/`"v2/..."`)
since a bare-filename map can't tell the two packs' samples apart once
both are in play.

**Existing cues, given more variety.** `kick` (+2 v2 regular-strike
takes), `keeperCatch`/`keeperParry`/`keeperPowerSave` (+3/+5/+4 v2 takes,
split across catch/dive-ground+hand/grab-direct by filename), `post`
(+2), `net` (+6 corner/hard/light/normal takes), `whistleStart` (+2),
`whistleEnd` (+1).

**New circumstances, previously unsonified.** These engine codes already
reached `resolveCueSequence()` via the existing generic `playEvent()`
fallback (same path `D.BLOCK`/`K.SAVE.*` use) -- no match-lab.js or
draft-run.js changes needed, just new `resolveCueSequence()` branches:
- `HEADER`/`BLAST`/`HARD` (the shot-start codes) now get `headerHit`/
  `kickHard` instead of the flat `kick` every shot type shared before.
- `D.SLIDE.*` (any outcome) -> `slideTackle` (`v2/slide.mp3`).
- `P.RECEIVE.CLEAN`/`PROTECT` -> `firstTouch`; `HEAVY` -> `heavyTouch`
  (`first-touch-outside-foot.mp3`, the closest filename match for a
  scuffed touch); `ADVANCE`/`KNOCK_FORWARD` -> `carryTouch` (a single
  knock-it-forward touch, not a multi-touch dribble animation --
  match-lab.js has no per-touch timeline to hang repeated footstep cues
  off yet); `LATE`/`LOSE` -> `looseBall`.
- `REBOUND.GOAL`/`REBOUND.MISS` gained a `looseBall` "bounce" milestone
  ahead of their existing net/miss reaction -- a rebound is definitionally
  a loose ball coming free.
- Training ground's `missedChance` (crowd bus, unconditionally dropped in
  training -- see `setTrainingMode()`) now substitutes `trainingMiss`
  (`v2/training-miss.mp3`, effects bus) instead of firing nothing, closing
  the "a training miss is pure silence" gap `training-miss.mp3` was
  evidently made for.

**Deliberately not wired.** `v2/chest-control.mp3` -- no engine code
distinguishes an aerial/chest reception from any other `P.RECEIVE.*`
outcome to hang it off. `v2/background-wind-low.mp3` -- a looping ambience
bed; `playCue()`'s bus model is one-shot only, so wiring it up is a
separate feature (loop lifecycle, its own volume control, live-match vs.
training-ground scope), not a mapping.

**Verified:** `node --check` on `matchSound.js`; every `SOUND_BANK`
filename confirmed to exist on disk; `resolveCueSequence()` smoke-tested
across the new/changed codes; the full existing Node test suite (draft
game, one-on-one, spatial decision, cross resolution, contact continuity,
keeper awareness/handling, timeline playback, offside, motion, ball core,
player kinetics) still green, since none of this touches engine logic --
only the sound-mapping layer. `npm run pages:build` re-run to land
`docs/sounds/v2` and re-sync `docs/src/lib/matchSound.js`. **Not yet
done:** real browser listening -- every new pool's actual character
(loudness match against v1, whether `heavyTouch`/`chest-control`-style
inferences actually sound right) needs an ear pass before shipping wider,
same caveat as v1's own pre-review state before its curation pass.

**Follow-up (2026-08-21, same day): stale cache, preload stampede, full
v2 migration.** User-reported: kick and carryTouch produced no sound, and
actions felt slow. Root causes:
- `match-lab.js`/`draft-run.js` import `matchSound.js` with a cache-
  busting `?v=YYYYMMDD-NN` query string (this codebase's standing
  convention, applied to every module import -- see the top of either
  file). The above pass edited `matchSound.js` without bumping it, still
  reading `?v=20260814-01` -- a week stale. Any browser that had already
  loaded Match Lab was serving its cached PRE-v2 copy the entire time,
  which explains `carryTouch` cleanly (the cue didn't exist yet in that
  cached version) and is the leading suspect for the rest. Bumped to
  `?v=20260821-01` in both files (+ the `docs/` mirror).
- Separately, a real perf bug: `preloadCore()` isn't a one-time startup
  call, it fires on every Roll/Play/Reroll/Replay click
  (`unlockAndPreload()`). It used to eager-fetch + `decodeAudioData()`
  every "effects"-bus file unconditionally; after the pass above that was
  ~80+ files (carryTouch alone has 12 variants, looseBall 8) on EVERY
  click, most of them for situational cues a given roll may never use.
  Introduced `EAGER_PRELOAD_CUES` -- an explicit allowlist of the cues
  nearly every roll actually touches (kick/pass/cross/keeper/post/net/
  blocked/clearance, back to roughly v1's original footprint) -- and
  moved everything else (the v2-only situational additions, same
  treatment the crowd bus already had) to lazy-load on first real use.
- Then, on request ("remove the mapping sounds of v1, go full on v2"):
  every `SOUND_BANK` cue with any usable v2 content dropped its v1
  entries -- `groundPass`/`longPass`/`cross`/`blocked`/`clearance` picked
  up v2 substitutes by filename semantics (e.g. `ball-roll-ground` for
  `groundPass`, `ball-kick-launch` for `longPass`/`cross`, previously
  reused/shared v1 samples). One deliberate exception, flagged rather
  than silently kept: `missedChance`/`goalFor`/`goalAgainst` (the crowd-
  reaction bus, shared with the live match, not Match-Lab-only) stayed on
  v1 -- v2 is a foley-only pack with no cheer/groan/roar content at all,
  and dropping these to silence would mean no goal celebration or missed-
  chance reaction anywhere in the app, not just a Match-Lab gap.
- **Not resolved this pass:** a reported "teleport bug" (a player marker
  snapping instead of animating) -- no repro scenario/player given yet,
  and this session's environment has no working browser-automation tool
  to reproduce it directly (`chromium-cli` not installed; `playwright`
  not a project dependency). Needs a specific scenario to chase down, or
  a working browser driver added to this environment. Not chased on
  spec -- `match-lab.js`'s two separate player-movement dispatch paths
  (`applyStepAnimation()`'s step renderer vs. the continuous
  `playbackClock`/`buildMatchLabPlaybackPlan()` timeline) both exist and
  a mismatch between them is a plausible direction, but unconfirmed.

**Follow-up 2 (2026-08-21, same day): root-caused "mostly silent" with a real
headless browser.** The stale-cache/preload fixes above were real but
insufficient -- user report after those landed: "some sounds available but
mostly silent," and "actions still too long." Installed Playwright
locally (`npm install --no-save playwright` + `npx playwright install
chromium` -- not a project dependency, gitignored via `node_modules/`,
not added to `package.json`) to get ground truth instead of guessing
further from source reading alone.

**"Too long" was a measurement artifact, not a real bug.** Naive
Playwright timing (`click` -> `waitForFunction` + a padded
`waitForTimeout`) showed 1.2-2.7s per Reroll/Replay -- looked damning,
matched the user's "3-4 seconds." A CPU profile of that exact window
showed 726ms of 927ms sampled as `(idle)` -- the padding itself, not real
work. Removing the padding and timing ONLY `click` -> `trace-ready`
directly: Reroll 46-72ms, Replay 42-53ms, Step ~60-76ms, Scenario-select
60-70ms -- genuinely milliseconds, as expected. The one real, bounded
network cost is Quick Setup's one-time roster fetch (`retroball-api.
umutnaderi.workers.dev/api/draft-candidates`, ~1s per call, traced into
`worker/src/index.ts`'s per-database `ORDER BY abs(...)` query -- can't
use an index, and its own 300s response cache never hits because the
client sends a fresh random seed every call) -- real, but a one-time
Quick-Setup cost, not a recurring per-action one, and out of scope for
this pass (flagged to the user as separate Worker/D1 work, not taken on
yet).

**"Mostly silent" was real -- root-caused to `clearStepEffects()`.**
Ground-truth instrumentation (injecting a log line directly into
`playCue()`/`playEvent()`, editing the real served file rather than
routing/mocking it, since an earlier `page.route()`-based attempt
produced suspicious all-zero results not reproducible against the real
file) showed `resolveCueSequence()` resolving correctly (non-empty
sequences for real shot/save codes) but `playCue()` almost never actually
running. Traced to `clearStepEffects()`: it calls `stopAllSound()`
unconditionally, and that function's own doc comment already listed its
legitimate callers (Roll/Reroll/Replay/Reset/`applyStepAnimation()`'s own
top) -- but `applyPlaybackCue()`, the continuous-playback per-EVENT
renderer added later (called once per `state.lastPlan.cues` entry, often
several times in the same synchronous batch since adjacent zero-duration
events like `GK.ADJUST`/`DEF.ADJUST`/`P.CARRY.TOUCH` are common), also
called it -- and was never in that enumerated list. Every event's
`playEvent()` schedules its cue via `setTimeout`; the very next event's
cleanup (often the same JS tick) cancelled it via `stopAllSound()`
clearing `pendingTimers` before the timer macrotask ever ran -- even
`atMs:0` steps. Only a cue whose event happened to be last in its
synchronous batch (no following neighbor to race against before the
browser yielded) ever survived, matching "some sounds work, mostly
silent" exactly.

**Fix:** split `clearStepEffects()` into `clearStepVisualEffects()`
(marker attrs, goal flash, badge, trail -- no sound) and
`clearStepEffects()` (`= clearStepVisualEffects() + stopAllSound()`,
unchanged for its other 7 call sites). `applyPlaybackCue()` now calls
only the visual-only variant. Verified with the same instrumentation
before/after: pre-fix, sound-bearing sequences existed but `playCue()`
fired essentially never; post-fix, 17/20 Free Play rolls produced a
sound-bearing event and 33 real `AudioBufferSourceNode.start()` calls
landed across them (a ~94% cue-to-playback conversion rate, accounting
for the trainingMiss-redirect's extra internal `playCue()` call). Bumped
`match-lab.js?v=` (content changed) and `matchSound.js?v=` (all three
importers, kept in sync) accordingly; updated
`tools/test-timeline-playback.mjs`'s own hardcoded version-string
assertion to match (it exists specifically to catch an un-bumped
cache-buster -- exactly this class of bug -- so it correctly failed until
updated). Full existing test suite (14 suites) still green -- this only
touched match-lab.js's own playback-cue plumbing, no engine files.

### One-on-one decision system, Stage 1 (2026-08-16)

Requested addition: give the striker in a one-on-one genuine situational
awareness (an exposed side, a keeper off the line, a keeper close enough
to dribble past) instead of the existing `resolveOneOnOne()`'s flat
attribute-duel roll. Scoped explicitly as an engine decision system, not
animation intelligence, and explicitly diagnostic-only until action-
specific execution (Stage 2) exists -- a "chosen" action has nothing real
to execute against yet, so animating one now would be fiction wearing a
diagnostic's clothes.

**`src/lib/oneOnOneDecision.js`** -- new, DOM-free, engine-adjacent shared
module (same "leaf module, no marker/pixel knowledge" discipline as
`matchSound.js`): `perceiveKeeperState()`, `scoreOneOnOneCandidates()`,
`chooseOneOnOneAction()`. `match-lab.js` is the only place that converts
constructed marker positions into the shared context (a new Scenario
Probe entry, `one-on-one-decision`, converts x/y percentages into
pitch-relative yards using the same 75x120 grid/post-position constants
the outcome-presentation adapter already established) -- the module
itself never sees a marker or a percentage coordinate, so the exact same
functions are ready for a real-match caller later without changes here.

**Hidden-information boundary, enforced structurally, not just by
convention:** `chooseOneOnOneAction()`'s context has no keeper-attribute
field at all -- the keeper's own attributes (Positioning, One On Ones,
etc) are never read by the decision, only by whatever generates the
keeper's *position* in the first place (today: literal marker placement;
later: a real keeper-behaviour model). Verified directly (test 8): an
elite dribbler's candidate scores are byte-identical regardless of
whether the keeper object has elite or terrible attributes, given
identical geometry.

**Perception, not omniscience.** `perceiveKeeperState()` takes a
geometry-only `actualKeeperState` and the shooter's own Decisions/
Anticipation/Composure and produces a `perceivedKeeperState` that can be
subtly wrong (misread chance -> the exposed side can flip, depth/lateral
reads get noisier) -- but only for the fields that are genuinely knowable
from a static position at all. `movementDirection`/`closingSpeed`/`set`
pass through unconditionally as `null`: Match Lab's marker snapshot has no
velocity data, so these are never truthfully derivable regardless of how
sharp the perceiving player is, and are never inferred from depth or
proximity as a stand-in for "rushing" (verified directly, test 11).

**Scoring and selection.** `utility = skillFit + tacticalFit -
situationalRisk + smallDeterministicJitter` per the 7 candidate actions
(`place-left/right`, `blast`, `shoot-early`, `chip`, `round-keeper`,
`square-pass`), each keyed to its own attribute set and to whichever
perceived-state fields actually apply to it (chip leans on depth, place-
left/right on exposed side, round-keeper on proximity -- never on a field
that isn't truthfully knowable). Final pick is a softmax-style weighted
choice (`weightedChoice()`, reused from `matchEngineCore.js`) whose
sharpness scales with the shooter's own Decisions/Composure -- a strong
decision-maker usually lands on the best option without being
mechanically perfect; a weak one is measurably worse but not helpless
(verified directly, test 6: elite hit the top option ~60% of 400 runs,
weak ~23%, neither 0% nor 100%). Preferred Moves/PPM-style modifiers
("Likes To Lob Keeper" etc) were in the original spec's suggested
influences but are NOT implemented -- this database has no PPM flag data
to gate on, the exact same gap already documented for weaker-foot/outside-
foot detection earlier this session.

**Determinism.** A separate, independently-seeded `decisionRandom`
(`seededRandom(hashString('match-lab:one-on-one-decision:' + state.seed))`)
-- never the `random` the scenario's own `run()` receives, so this
consumes zero calls from the existing sequential stream (the scenario
doesn't call any real resolver at all yet, so there's nothing to perturb
today, but the discipline is load-bearing once Stage 2 exists in the same
resolver call chain other scenarios use). Verified directly (test 9):
identical seed reproduces byte-identical perception AND decision.

**Match Lab UI.** A new, deliberately visually-distinct (amber border,
"⚠ Experimental" heading) diagnostic panel -- selected action, all 7
candidates with utility bars, the reasons list, and actual vs. perceived
keeper state side by side. The scenario's own trace event carries no
`movement`/`ballFrom`/`ballTo` at all, so it can never trigger ball
animation; Run N clears and hides the panel (a 200-run distribution would
otherwise leave whichever of the 200 runs happened to go last, stale and
unlabeled as such).

**Verified** (`tools/test-one-on-one-decision.mjs`, `npm run
test:one-on-one`, all 11 required constructed cases from the review):
central/advanced/left/right/close keeper geometry all move the expected
candidates in the expected direction; elite vs. weak decision-makers and
elite vs. weak chippers separate correctly; the hidden-attribute boundary
holds; identical seeds reproduce identical output; the module has no
animation-timing parameters to be affected by; unknown fields never
silently become "rushing." `node --check` on every touched file; `node
tools/test-draft-game.mjs` still green (nothing here touches the real
engine). Not verified in an actual browser -- whether the diagnostic
panel reads clearly and whether the utility weights *feel* right for a
range of constructed geometries needs a real look.

**Explicitly not done, per the review's own staging:** Stage 2 (action-
specific execution --  `resolvePlacedFinish()`/`resolveChipAttempt()`/
`resolveRoundKeeper()`/`resolveEarlyShot()`/`resolveSquarePass()`) and any
production (`draft-run.js`) integration, which stays on hold until a real
keeper-behaviour model exists to generate `actualKeeperState` there (today
it only exists for Match Lab, derived from real marker positions -- there
is nothing equivalent to derive it from in production yet).

### One-on-one decision system, Stage 2 (2026-08-16)

Approved in principle with 8 specific adjustments before implementation
(full review preserved in conversation history; summarized inline below
at each design decision it drove). Built and tested against the
constructed Match Lab path only -- `resolveOneOnOne()`/`K.ONEONONE.*`
stay completely untouched; a new `ONE_V_ONE.*` namespace throughout.

**Two layers, not one outcome table per action** (the review's point 1).
`resolvePlacedFinish({shooter, targetSide, power, pressure, random})`
(placed left/right AND blast -- same function, `power:true` for blast)
produces a shot DESCRIPTOR (`onTarget`, `intendedTarget`, `actualTarget`,
`targetHeight`, `elevation`, `executionQuality`, `speed`) -- it does not
decide the ending. One shared `resolveTargetedKeeperResponse({shot,
keeper, actualKeeperState, random})` turns any on-target descriptor into
the actual goal/catch/parry/post/corner ending, reusing the exact
keeperAction/ballResult vocabulary
(beaten/catch/parry/tip, goal/held/rebound-in-play/corner/post-rebound/
post-goal) the outcome-presentation adapter already established for
`K.SAVE.*`, so the two systems read consistently even though this one now
lives in the engine. `resolveSquarePass()`'s completed-pass follow-up
reuses this exact same pair (per the review's point 4: "reuse an
existing/shared finishing resolver, not another inline goal formula") --
not a bespoke tap-in formula. Chip and round-keeper deliberately do NOT
use the shared layer (a mishit chip fails in the air, not to a dive; round-
keeper is a dribble duel, not a shot) -- each keeps its own self-contained
resolver.

**Ground truth, not perceived, for the save difficulty.**
`resolveTargetedKeeperResponse()` computes `keeperTravelYards` from
`actualKeeperState.lateralOffsetYards` vs. the shot's real `actualTarget`
(post positions at ±4yd from center) -- the mechanism that makes a wrong
Stage 1 read cost something real: a shot aimed at what the striker
perceived as the open side, when the keeper was actually covering it,
travels almost nowhere and gets stopped easily, regardless of how good
the read looked in the diagnostic panel. Verified directly (execution
test 4): targeting the keeper's actually-covered side requires
measurably less travel than the actually-exposed side.

**shoot-early deferred, per the review's stated preference** (point 2):
still selectable at Stage 1 (unchanged there), but its execution always
returns `{code: "ONE_V_ONE.EARLY.DEFERRED", deferred: true}` rather than
inventing a mechanic on top of the `movementDirection`/`closingSpeed`/
`set` fields that Match Lab's static marker snapshot genuinely cannot
provide. Held until a real keeper-behaviour model exists.

**Blast has an explicit target** (point 3): carries Stage 1's own
PERCEIVED exposed side into execution (`perceivedKeeperState.exposedSide`,
defaulting to "center" when balanced) rather than implicitly always
central. Power trades placement accuracy for pace: a wider drift-to-center
chance and a real "sail over the bar" failure mode a placed effort
doesn't have (`resolvePlacedFinish`'s `floor`/`ceiling`/`driftChance` are
both explicitly harsher when `power:true`).

**square-pass requires a real teammate** (point 4). `oneOnOneDecision.js`'s
`scoreOneOnOneCandidates()` now excludes "square-pass" from the candidate
list ENTIRELY (not just scored low) whenever `availableTeammates` is
empty -- verified directly (Stage 1 test 12): absent with no teammate,
present once one's placed, never the selected action without one. Match
Lab's own dispatch never invents a recipient either -- if this branch is
somehow still reached with none placed, it returns an honest
`ONE_V_ONE.SQUARE.NO_TEAMMATE` result rather than fabricating one. The
existing "candidate" role (already declared in `ROLE_LABELS`, unused
until now) is what supplies the real teammate.

**Three independently-seeded streams** (point 5): `decisionRandom`
(Stage 1, unchanged from before), `executionRandom` (the striker's own
shot-creation/technique/duel/pass-completion roll), `keeperResponseRandom`
(the keeper's reaction specifically -- shared by a direct attempt and a
square-pass's follow-up alike). All three derived fresh from the per-call
`seed` with distinct suffixes -- never one continuing another's sequence.
Verified directly (execution test 2): scoring candidates with a
completely different context shape (extra candidates, several repeated
scoring calls burning arbitrary amounts of decisionRandom) has zero effect
on a fixed-seed execution/keeper-response result for an otherwise-
identical selected action.

**Attribute compounding, addressed via a two-section audit, not a single
number** (points 6-8): `tools/one_on_one_action_audit.mjs` --
  - **Section A, forced-action matrix**: each of the 6 built actions
    forced directly (Stage 1 bypassed), strong/weak shooter x strong/weak
    keeper, against representative geometry for that specific action.
    Isolates execution-formula behavior from selection behavior.
  - **Section B, full decision-policy matrix**: Stage 1 chooses, Stage 2
    executes, the real pipeline, against one fixed "typical breakaway"
    geometry. Reports selection frequency per action, CONDITIONAL
    conversion per selected action, POLICY-level conversion (all
    selections blended), and correct-read vs. incorrect-read conversion
    (split on `perceivedKeeperState.misread`) -- so a compounding
    elite-selects-well-AND-executes-well effect is visible as itself,
    not hidden inside one blended number.
  - Every intermediate rate reported before the final one (executed %,
    keeper-contact %, clean-goal %, rebound-opportunity %, post %,
    target-mismatch %, avg keeper travel), per the explicit instruction to
    avoid a repeat of the free-kick/aerial multiplicative-gate collapse.
  - `rebound(opportunity)` is explicitly labeled as such, NOT "rebound
    goal rate" -- Stage 2 has no follow-up rebound-scramble resolver yet,
    so a live-ball opportunity rate is reported honestly rather than a
    fabricated conversion-through-the-rebound number.

**What the audit actually found, run at 3000 trials/cell** (full output
in the tool itself, `npm run one-on-one:audit`): selection sharpness
works as designed -- a strong-Decisions/Composure shooter picks the
objectively-best-scored option (place-left, in the fixed policy geometry)
83% of the time, a weak one spreads nearly uniformly across all 7
candidates (28-15% each). Policy-level final conversion lands around
9-15% across the four tier pairings. **That's lower than typical real-
world one-on-one/breakaway conversion benchmarks (commonly cited well
above 30%)**, and the per-stage breakdown shows why:
`resolveTargetedKeeperResponse`'s CAUGHT weight (`handling * 2 *
(1 - difficulty)`) dominates the non-beaten weighted-choice heavily,
meaning even a well-placed shot to the exposed side gets cleanly caught
far more often than parried/post/beaten. This is a calibration question,
not a determinism or architecture problem -- flagged explicitly rather
than tuned unilaterally, exactly per the review's own methodology
("report every intermediate rate before accepting final conversion").
Also visible: correct-read vs. incorrect-read conversion shows a real but
inconsistent signal across actions at this single fixed geometry/sample
size (clearly favors correct reads for blast, e.g. 7.1% vs 1.3% for the
weak/strong pairing; nearly a wash for chip/round-keeper) -- worth
re-checking against a wider spread of constructed geometries before
treating it as settled.

**Verified:** `tools/test-one-on-one-execution.mjs` (determinism, RNG
stream independence, tier separation across placed/chip/round-keeper,
actual-vs-perceived travel grounding, square-pass honesty) -- all pass.
`tools/test-one-on-one-decision.mjs` (Stage 1, now including the
square-pass gating case) -- all 12 pass. `node --check` on every touched
file; `node tools/test-draft-game.mjs` still green (nothing here touches
`resolveOneOnOne()`/any production call path). Not verified in an actual
browser.

**Deliberately not built this pass:** ball-flight animation/visualization
for `ONE_V_ONE.*` results (would mean extending the pathSegments/badge
system built for `K.SAVE.*` to a new namespace -- a real, separate piece
of work; the diagnostic panel shows the full Stage 1 decision + Stage 2
result as data/text for now, not a pitch animation) and any calibration
adjustment to the conversion rates the audit surfaced as low (flagged for
a decision, not silently tuned).

### Match Lab truth-and-controls stabilization pass (2026-08-16)

Browser testing of Stage 2 surfaced three genuine presentation/state bugs
-- none of them resolver errors. Fixed all three, paused new Stage 2 work
(no calibration, no broader attacker/defender AI) per the explicit
instruction to stabilize the contract first.

**1. Scenario Probe was displaying Free Play's ball ownership, which no
scenario actually reads.** Every scenario's `run()` reads its own declared
roles directly (`byRole.attacker[0]`, etc) -- confirmed by reading all 7
`run()` functions again, none touch `state.ball.ownerId`. The UI still
showed the ⚽ ownership button and let a player's role drift out of sync
with whichever scenario was selected (the exact bug: a player left with
role "Receiver" after switching to a scenario that only declares
"attacker", with no visual sign that role was now meaningless). Fixed:
the ⚽ button is hidden entirely in Probe (not just disabled -- it's not
merely unused, it's actively misleading there); `scenarioPrimaryRoleKey()`
picks whichever of "attacker"/"receiver"/the scenario's first declared
role is its real first mover; the ball marker is drawn at that entry's
position instead of `state.ball.x/y` (hidden if that role isn't filled
yet, never guessed); a placed player whose role isn't one of the current
scenario's own declared roles is dimmed (40% opacity) and tagged "Unused"
in both the pitch marker and the roster list; a new "Shooter: `<name>`"
(or "Receiver:", matching the scenario) status line makes the active
participant explicit before running. Refreshed on every point that can
change it: mode switch, scenario switch, role-dropdown change, adding a
player.

**2. Reroll was restoring a stale snapshot because animation was
corrupting the authored setup in the first place.** `moveRosterEntry()`
was writing nudge-driven movement (dribble/tackle duels, a receiver
drifting toward a cross) directly into `state.roster[entry].x/y/zone` --
the SAME fields `entry.x/y` that represent what the user actually placed.
That's what made a snapshot-capture-and-restore dance necessary at all:
Reroll needed something to restore FROM, because the live positions had
already been mutated by playback. Fixed at the root instead of patching
the symptom: `moveRosterEntry()` now only ever writes to the DOM
(`setMarkerPosition()`), never to the roster entry itself. The ball side
of the animation system (`animateBallAlongCurve`/`animateBallAlongSegments`)
was already architecturally correct this way (confirmed by re-reading
both) -- only the player-nudge path had the bug. `state.setupSnapshot`
and `restoreSetupPositions()` are deleted entirely -- nothing to
snapshot/restore anymore, since nothing mutates the authored positions
except a direct drag. A drag now calls `clearResults()` on release,
since it changes the authored setup and the previously-resolved trace no
longer honestly corresponds to it (this also exposed and fixed a real
ordering bug in `clearResults()`: `updatePlayPauseButton()` was running,
via `stopPlayback()`, BEFORE `state.lastTrace` was nulled out, so
Play/Pause's disabled state was one cycle stale).

**3. Controls renamed/redefined to match the new authored/playback
split** (DOM ids unchanged, only labels/behavior): **Resolve & Play**
(was Roll) -- resolve the current authored setup, autoplay a new result.
**Play/Pause** -- unchanged, controls the current trace. **Replay** --
same seed/result, `renderPitch()` puts markers back at their authored
spot before re-playing (previously `restoreSetupPositions()`). **New
Outcome** (was Reroll) -- new seed, current authored setup; the entire
snapshot-restore-or-capture branch is gone, replaced by one `renderPitch()`
call, because the authored setup no longer needs restoring from anywhere.
**Step** -- unchanged, wrap-to-start now calls `renderPitch()` instead of
the deleted restore function. **Back to Setup** (was Reset) -- stop
playback, show the authored setup, clear the result; no longer has a
"wipe the whole roster" fallback branch (that only ever fired when
nothing had been rolled yet, and doesn't fit the new mental model where
the authored setup and the roster are simply the same thing at all
times) -- clearing the pitch entirely still works via the existing
per-row ✕ remove button, just not through this control anymore.

**4. Wide-miss endpoints were reusing the corner-outcome geometry.**
`missPointFor()`'s WIDE badge case called `outsideCornerPointFor()` --
correct for a genuine corner-bound save outcome (`K.SAVE.3`/`.7`), wrong
for an ordinary missed shot, which was animating almost to the corner arc
(x=8/92) for every miss regardless of severity. New `narrowMissPointFor()`
lands just outside the relevant post instead (a fixed 4-point margin
beyond `GOAL_LEFT_POST_X`/`GOAL_RIGHT_POST_X`) -- an immediate,
deterministic presentation fix using data that already exists, not a new
random roll. `outsideCornerPointFor()` itself is untouched and still
correctly used for actual corner outcomes. The real fix -- an
`aimErrorYards`/`missSeverity`-style field on the shot descriptor so
execution quality and pressure can drive how far a miss actually lands,
with severe mishits genuinely rare rather than a fixed distance every
time -- is explicitly deferred, per the instruction that animation must
consume resolver data and never invent its own randomness; that data
doesn't exist on any shot descriptor yet (Stage 2's `resolvePlacedFinish()`
included).

**Calibration finding, logged and NOT acted on this pass** (per explicit
instruction): catch-weight dominance in `resolveTargetedKeeperResponse()`
is only part of why policy-level conversion audited low (9-15%, see the
Stage 2 section above). The deeper issue: conditional on reaching the
keeper-response stage at all, the function currently has no way to see
the REALIZED quality of the finish -- it reads `keeperTravelYards`
(geometry), `shot.speed` (placed vs. power), and the keeper's own
attributes, but never `shot.executionQuality` (already computed and
returned by `resolvePlacedFinish()`, just not threaded through). A
well-executed shot and a barely-on-target one currently have identical
odds of beating the keeper once both happen to be "on target." Re-audit
this specifically (not just the catch-weight question) once the shot-
endpoint/miss-severity work above lands and the animation contract is
trustworthy enough to verify results against.

### Possession Runner v1 (2026-08-16)

Browser testing after the stabilization pass surfaced the next real gap,
independently diagnosed by the user and (relayed, endorsed) a ChatGPT
technical read of the code: `runConstructedPossession()` resolved exactly
one action and stopped. A successful pass or dribble had nowhere to go --
unlike Cross/Shoot, which already contain their own internal chains
(aerial race -> header -> save, or shot -> block/save -> rebound scramble),
so those two specifically never felt like a complete attack. Free Play was
one action, not one possession.

**1. Standardized transition contract on every Free Play resolver.**
`resolvePass()`, `resolveDribble()`, `resolveCross()`, `resolveShoot()`,
and the shared `resolveReboundScramble()` helper now return `{ terminal,
possession, nextOwnerId, ballEnd, restart, reason }` alongside the
pre-existing `{ outcome, code, resolved }` (kept for backward
compatibility -- `resolved` never meant "the attack ended," only that this
one action was). `possession` is one of `"retained"|"turnover"|"loose"|
"dead"`. Found and fixed while wiring this: `resolvePass()` was comparing
`received.status === "lose"`, a value `resolveReceive()` never actually
returns (its real vocabulary is `"advance"|"hold"|"turnover"`) -- every
genuinely lost reception was silently reported as a success. The new
`receptionLost = received.status === "turnover"` check is correct against
the real function.

**2. `runConstructedPossession()` rewritten as a bounded action loop.**
Loops through `FREE_PLAY_RESOLVERS` via a `simulated = { ownerId,
ballPoint }` that advances step to step off each resolver's own
`nextOwnerId`/`ballEnd` -- the authored roster (`state.roster`) is never
written to during resolution, only read (see point 5). Stops on the first
terminal result or a hard `POSSESSION_MAX_ACTIONS = 8` safeguard (tagged
`reason: "max-actions-reached"` when hit). `freePlayGroups()` now takes an
optional `ownerId` parameter (defaults to `state.ball.ownerId`, the
authored starting point) so the loop can re-derive teammates/opponents/
keeper against whoever currently holds the ball mid-possession.

**3. Independently-keyed RNG streams, per step.** `decisionRandom`
(which action gets chosen) and `executionRandom` (resolving it) are each
seeded off `` `match-lab:freeplay:{decision|execution}:${seed}:${actionsCount}` ``
-- never sharing a sequence, and never reusing a previous step's stream.
Changing candidate scoring can't perturb an otherwise-identical execution
roll, and an identical top-level seed reproduces the entire possession
(every step, not just the first), not only the first action -- verified
directly (`tools/test-possession-runner.mjs`, case 8).

**4. Dribble now returns genuine progression data.** `P.PROGRESS.WON`
previously used the same point for `ballFrom` and `ballTo`, so a
"successful" dribble had literally nowhere for animation to move the ball
-- the exact bug the user's own browser testing caught ("most of the
actions other than Cross and Header/Volley do not end the attack" was one
symptom of this; "nowhere to go" was the deeper cause). New
`advanceTowardGoal(fromPoint, team, yards)` advances a fixed
`DRIBBLE_PROGRESS_YARDS = 8` toward whichever end `state.attackingDirection`
says that player's team attacks -- a fixed distance, not tuned or
randomized this pass, per the explicit instruction not to calibrate
probabilities in this round.

**5. Explicit attacking-direction setting.** `state.attackingDirection =
{ home: "down", away: "up" }`, with a small `#labAttackingDirectionSelect`
control next to the sound button. Deliberately never re-inferred from a
player's current half -- that inference stops being trustworthy the
moment a possession can cross zones over several steps, which is exactly
what this feature does. Currently wired into dribble progression only
(see "Deliberately not built this pass" below for the shot/cross-geometry
gap this leaves open).

**6. `lastRun` -- a complete, replayable record of the possession.**
`buildLastRun(seed, runOutput)` builds `{ seed, authoredSetup: { roster,
ball } (a snapshot, not a live reference), result, finalOwnerId,
actionsCount, trace }`, stored on `state.lastRun` and populated by both
Resolve & Play and New Outcome. Distinct from `lastTrace`/`lastMode`
(which still drive animation playback unchanged) -- this is the item 7
"Next up" entry below, now done: a `lastRun` shape any future 2D/richer
playback can read from, rather than only the flat trace.

**7. Authored-roster immutability, verified not just asserted.** Audited
every write site: the only place `entry.x/y/zone` are ever assigned is
`startDrag()`'s own move handler -- a direct user drag, which correctly
*is* the authored-setup edit (see the stabilization pass above). Neither
resolution (`runConstructedPossession()` and all five resolvers) nor
playback (`moveRosterEntry()` -> `setMarkerPosition()`, CSS custom
properties only; `nudgeToward()` computes and returns a new point without
touching the entry it reads) ever write back to `state.roster`. Confirmed
both by direct code audit and by test (`tools/test-possession-runner.mjs`,
case 9: a full possession resolves, then `JSON.stringify(state.roster)`
is asserted byte-identical to before).

**Deliberately not built this pass** (documented so it isn't mistaken for
an oversight, and flagged honestly against the original request's item 3
-- "continue after completed passes, successful receptions, successful
dribbles, loose balls, rebounds, parries and in-play blocks"):

- **Loose balls, rebounds, parries, and in-play blocks do NOT hand back to
  the outer possession loop.** Cross/Shoot's own internal chains
  (aerial/shot -> block/save -> `resolveReboundScramble()`) still always
  end in a terminal result once they're done -- `resolveReboundScramble()`
  itself genuinely continues internally (a won loose ball goes on to a
  real second shot attempt, not an immediate stop -- verified in test
  case 5), but that continuation is invisible to
  `runConstructedPossession()`, which just sees one terminal resolver
  return either way. So today only completed passes/receptions and
  successful dribbles actually loop the outer possession forward; a block
  that stays loose near a defender, or a keeper parry that's recovered by
  the defense, ends the possession rather than becoming a genuinely new
  action for whoever's nearest. This is the real remaining gap against
  item 3 of the original request, not a hidden one.
- Blocked shots that stay `"loose"`/`"safe"` (not `"behind"`) are treated
  as an immediate turnover to the blocking defender rather than a
  contestable loose-ball re-contest -- same simplification as dribble's
  `"loose"` tackle outcome (`possession: "loose", nextOwnerId: null`, left
  terminal/unresolved-owner rather than a full recontest model).
- Shot/cross target-selection geometry (`goalLineY()` and friends in
  `goalPointFor()`/`missPointFor()`) still uses the pre-existing
  position-based heuristic, not threaded through the new explicit
  `state.attackingDirection` override -- only dribble progression consumes
  it so far. Threading it through the whole outcome-presentation adapter
  is a larger, separate change than this pass's scope.
- No probability tuning, no training-ground obstacles/cones/rondo/
  secondary-free-kick routines -- per the explicit instruction for this
  pass.

**Verified:** `tools/test-possession-runner.mjs` (new -- 9 cases per the
request: pass -> reception -> next action; successful dribble -> advance
-> next action; turnover terminates; keeper catch terminates; rebound
continues internally; foul terminates with a real restart AND advantage-
played continues; max-action safeguard; identical seed reproduces the
whole possession; animation/playback never mutates the authored setup),
run via `npm run test:possession-runner`. Exercises match-lab.js's own
resolvers/loop directly (not just matchEngineCore.js) by installing a
minimal fake `document`/`localStorage`/`fetch` before importing it --
match-lab.js is a page script with real DOM side effects at module-load
time, not a DOM-free library, so this is a stub sufficient to let module
load complete, not a browser replacement. A small test-only `export`
block was added at the bottom of match-lab.js for exactly this (inert in
the browser -- the page loads it via a plain `<script type="module">`
with no importer, so the exports have no runtime effect there). Also
green: `node --check match-lab.js`, `npm run test:draft`, `npm run
test:one-on-one`, `npm run test:one-on-one-execution`. Not verified in an
actual browser -- pending the user's own pass, same as every round this
session.

**Future direction, documented not built (per explicit instruction):** a
Training Drills mode -- goal-target zones, cones/mannequins for dribbling,
El Rondo, and secondary free-kick takers with fake runs/lay-offs -- would
reuse this possession/sequence infrastructure directly: the bounded
action loop, the standardized per-resolver transition contract, the
explicit attacking-direction setting, and the independently-keyed
per-step RNG streams are all generic to "a sequence of resolved actions
against a constructed setup," not specific to open-play Free Play. The
loose-ball/rebound/block outer-loop gap above would likely need closing
first, since drills built around cones/rondos are essentially chains of
"loose ball, next player acts" by design.

### Possession Runner v1 -- Pass 1: simulated coordinates + animation dispatch (2026-08-16)

Browser testing of v1 surfaced three symptoms, all traced to the same
underlying gap and one independent one:

1. **A shot sometimes visibly starts from a spot no player is standing
   at.** Root cause: `runConstructedPossession()`'s `simulated` only ever
   tracked `{ownerId, ballPoint}` -- the ball's conceptual position
   advanced step to step, but no player's did. Every resolver still
   called `freePlayGroups(simulated.ownerId)`, which re-read the owner
   fresh from `state.roster` -- the authored, correctly-immutable
   positions. So after a successful dribble, the ball's conceptual point
   moved forward but the dribbler's OWN `x/y` used for the next action's
   `pointOf(owner)` (zone, engagement distance, `ballFrom`, everything)
   was still their original placed spot.
2. **A player who "beats" a defender and advances doesn't visibly travel
   much.** Independent second cause, in `applyStepAnimation()`: `const
   MUTUAL_NUDGE_MOVEMENTS = new Set(["dribble", "tackle", "foul"])`
   routed *every* dribble event through the small (~8%-capped) mutual
   toward-the-defender contest nudge, including the new `P.PROGRESS.WON`
   case Pass 1 (of Possession Runner v1) gave a real, distinct
   `ballFrom`/`ballTo`. That dispatch predates real dribble movement
   existing at all -- before this session's rewrite, every dribble/
   tackle/foul beat had `ballFrom === ballTo` (nothing had actually moved
   yet), so the small converge-toward-each-other duel visual was the
   right call for all of them. It was never revisited once `P.PROGRESS.WON`
   started carrying a genuine advance.
3. **A backward pass into a crowded, worse position than the ball
   carrier's own spot.** A real, separate gap in the Match-Lab-only
   action-choice heuristic (`actionWeight()`/`selectTeammateTarget()`),
   which scores a pass purely off the passer's own attributes/zone, never
   the receiving teammate's pressure or how progressive the pass actually
   is. **Deliberately not touched this pass**, per explicit instruction:
   spatial pass/receiver scoring built on top of the coordinate bug above
   would only be correct for the authored first frame and silently stale
   after the first action -- it has to consume Pass 1's simulated
   coordinates, so it's scoped as Pass 2, after Pass 1 is browser-verified.

**Fix 1: a real per-possession simulated position map, not just a ball
point.** `runConstructedPossession()` now clones the authored roster once
per possession (`simulatedRoster = state.roster.map((entry) => ({
...entry }))` -- own `x/y/zone` per entry, `player` reference shared
since attributes are never written to). `freePlayGroups()` takes a new
second `roster` parameter (defaults to `state.roster`, so every existing
caller -- the action table, the live inspector -- is unaffected) that the
possession loop passes `simulatedRoster` into. After each resolver call,
an atomic update moves whichever entry now controls the ball
(`result.nextOwnerId`) to the resolver's own `result.ballEnd` via
`Object.assign`, and updates `simulated.ownerId`/`simulated.ballPoint` --
every step, terminal or not (previously `simulated` only updated on
non-terminal steps, so `finalOwnerId` on a terminal result like a keeper
catch was stale -- whoever had the ball going INTO that action, not the
keeper who ended up with it; fixed as part of this). `state.roster`
itself is never touched by any of this -- only the fresh clone is, so the
already-verified authored-immutability guarantee (Pass 1 of the original
Possession Runner v1, and the stabilization pass before it) is untouched
by this change.

**Fix 2: `applyStepAnimation()`'s player-marker dispatch now bypasses the
duel-nudge whenever an event carries real movement.** A new
`actorHasRealMovement` check (`ballFrom`/`ballTo` both present and
genuinely distinct) short-circuits `MUTUAL_NUDGE_MOVEMENTS` -- when true,
the actor's marker moves directly to `event.ballTo` (`moveRosterEntry
(event.actorId, event.ballTo, animate, duration)`) instead of the small
converge-toward-the-defender nudge. The ball marker itself was already
correct (the FIRST if/else chain in `applyStepAnimation()` moves it to
`event.ballTo` whenever both are present, regardless of movement type --
only the SECOND chain, which moves player markers, had the stale
dispatch). Movement-less contest beats (the "looks to get past"/"chooses
tackle"/foul-card beats, which still always push `ballFrom === ballTo`)
are unaffected and keep the original mutual-nudge duel visual.

**Known adjacent gap, not fixed this pass (flagged, not hidden):** a pass
reception with a genuine knock-forward advance (`received.nextZone !==
receiver.zone` in `resolvePass()`) also produces a real, distinct
`ballFrom`/`ballTo` for its `movement: "reception"` trace event -- but
`"reception"` was never in `MUTUAL_NUDGE_MOVEMENTS` to begin with, so this
event already falls into the ball-flight nudge branch, which moves
`targetId`/`defenderId`/`keeperId` toward the midpoint but never the
actor. The RESOLVER-level fix (Fix 1 above) already makes the *next*
action correctly begin from the receiver's real advanced position -- this
gap is purely the receiver's own marker not visibly sliding there first.
Not part of the user's Pass 1 checklist (scoped to the
`MUTUAL_NUDGE_MOVEMENTS` bypass specifically); noted here rather than
silently folded in, since it's the same category of bug and easy to miss
later.

**Verified:** `tools/test-possession-runner.mjs` extended with 3 new
cases (12 total, all pass): #10 proves a later possession step sees the
previous step's REAL position via the loop mechanics directly (mocked
resolvers, deterministic); #11 runs 300 real seeds against a real 4-
player roster and asserts full ball-carrying trace continuity ACROSS
action-loop boundaries, not just within one resolver's own internal
chain (extends this session's original "ball travels twice" invariant to
the new multi-action loop); #12 confirms `finalPositions` is itself
seed-reproducible and agrees with the terminal result's own `ballEnd`.
Also green: `node --check match-lab.js`, `npm run test:draft`, `npm run
test:one-on-one`, `npm run test:one-on-one-execution`. The animation
dispatch fix itself (Fix 2) is validated at the DATA level only (the
trace events feeding it carry the right `ballFrom`/`ballTo`/`movement`) --
the actual visual/CSS result is explicitly left for the user's own
browser pass, per their stated verification plan (does Aimar visibly
travel with the ball; does the next action begin from that new spot; does
a second dribble continue from the first endpoint; does a shot originate
exactly where its shooter/ball are; does Replay reproduce it; does Back
to Setup restore the authored positions).

**Next, once Pass 1 is browser-verified:** Pass 2 -- spatial action and
receiver utility (receiver pressure, progression value, goal distance/
angle, pass distance, passing-lane obstruction, continuation quality) --
scoped explicitly to consume Pass 1's simulated coordinates rather than
the authored roster, so it stays correct after the first action of a
possession, not just on the authored first frame.

### Possession Runner v1 -- Pass 1.1: playback-position continuity (2026-08-16)

The user's own browser round on Pass 1 (relaying a second independent
technical diagnosis they endorsed) caught a real regression Pass 1
itself introduced, plus two smaller adjacent observations, before Pass 2
was scoped:

1. **A player who advanced across successive dribbles visibly snapped
   back toward their start between each one.** Root cause, confirmed by
   direct code reading: Pass 1's Fix 2 only updated the case where an
   event carried genuine movement (`actorHasRealMovement`); the
   movement-LESS decision beat that immediately follows a successful
   dribble (`ballFrom === ballTo` -- nothing has moved yet for THAT beat)
   still fell into the old branch, which read `state.roster.find(...)` --
   the stale AUTHORED position -- as its nudge basis. Since the actor's
   marker had just been moved to the real advanced point by the previous
   event, the next nudge computed a target near the ORIGINAL spot and
   visibly animated the marker back toward it before the following
   success moved it forward again.
2. `traceEvent()` only carries one `ballFrom`/`ballTo` pair (the ball's
   own path), not a distinct movement record per participant -- accurate,
   unaffected by this pass (see the "known adjacent gap" note below).
3. `P.PROGRESS.WON` gives the attacker a real destination but the
   defender none at all -- also accurate; addressed here with a cosmetic
   (not authoritative) reaction, see Fix 2 below.

The user's own instruction, after agreeing Pass 1's diagnosis but
explicitly declining a larger "continuous duel choreography" build
(velocity/facing/intent, recovery windows, wrong-footed states): those
belong to a **separately scoped match-engine-awareness system**, not
something invented inside Match Lab's animation layer. This pass fixes
the actual regression and gives the defender an honest, data-grounded
reaction -- nothing that invents new engine state.

**Fix 1: `playbackPositions` -- the rendering layer's own authoritative
position map**, seeded from `state.roster` every time `renderPitch()`
runs (which already happens at every real reset point: Resolve & Play,
New Outcome, Replay, Back to Setup, and every roster edit -- one hook
covers all of them). This is deliberately the RENDERING-layer twin of
`runConstructedPossession()`'s `simulatedRoster` (Pass 1): that one is
resolution's memory, computed once, ahead of any rendering; this one is
playback's memory, advancing incrementally in step with the visible
marker across Step/Play/Replay. Every nudge-basis lookup in
`applyStepAnimation()` reads `playbackPointFor(id)` instead of
`state.roster` now.

**Fix 2: a strict authoritative/cosmetic split**, per explicit
instruction -- `playbackPositions` is updated ONLY when a trace event
carries genuine, resolver-produced movement for its own actor (today
only `P.PROGRESS.WON`'s real advance); every other marker move in
`applyStepAnimation()` (the movement-less duel lean, the pass/cross/shot
"closing down" nudge toward the ball-flight midpoint, and the beaten
defender's reaction below) is now a transient, cosmetic-only offset via
a new `applyCosmeticOffset()` helper -- reuses `nudgeToward()`'s exact
same math, but applies the result as a CSS `translate` on the marker's
inner dot (a new `data-cosmetic` keyframe in styles.css) instead of
writing to the marker's own logical `--marker-x`/`--marker-y`. It plays
out and explicitly returns to `(0, 0)` before the animation ends -- there
is nothing to "reset," since the authoritative position was never
touched. This means a beaten defender in `P.PROGRESS.WON` now gets a
deterministic, direction-grounded lunge toward the attacker's real
advance (using only data already in hand: both players' real positions)
-- visible reaction, zero invented state, and it cannot leak into any
later engagement calculation, since nothing about it is ever written to
`playbackPositions`.

**Explicitly documented, not fixed by this pass (per the user's own
closing instruction):** repeated immediate re-engagement and defender
recovery are still match-engine-awareness limitations. A defender who is
beaten in one dribble duel is, today, exactly as eligible to contest the
very next action as if nothing had happened -- there is no `recoveryUntil`,
no "wrong-footed" penalty, no concept of a defender being temporarily
worse after losing a challenge, because `resolveEngagement()` in
`matchEngineCore.js` has no such state at all. Building that is real,
separate match-engine work (it would need to matter for actual matches
too, not just Match Lab's visualization), not a rider on this playback
fix -- and would need its own scoping/review before any implementation.
The `MATCH_LAB_PLAN.md` "player AI awareness" item (documented since the
Possession Runner arc began) is exactly this.

**Known adjacent gap, still not fixed (carried over from Pass 1's own
note):** a pass reception with a genuine knock-forward advance produces
real, distinct `ballFrom`/`ballTo` for its `movement: "reception"` event,
but `"reception"` was never routed through the authoritative-movement
branch (deliberately -- see Pass 1's note on why generalizing that
branch without care would risk moving the WRONG entity for a lost
reception, where the ball ends up with the interceptor, not the
receiver). The receiver's own marker still doesn't visibly travel to a
knock-forward's real endpoint. Not in the user's Pass 1.1 checklist
either; still flagged rather than silently folded in.

**Verified:** `tools/test-possession-runner.mjs` extended to 15 groups
(62 assertions total, all pass) with 3 new cases built specifically
against this fix: #13 reproduces the exact reported bug end-to-end with
Ronaldinho/Gattuso-shaped fixtures -- seeds `playbackPositions`, plays a
real advance, then a movement-less decision beat, and asserts the
position holds (does NOT revert), then plays a SECOND advance and
asserts it continues from the first endpoint, not the authored start;
#14 asserts cosmetic nudges (a movement-less duel beat, a pass event's
defender-closing-down nudge) never write `playbackPositions` for anyone
involved; #15 runs a real, unscripted `runConstructedPossession()` trace
with at least two successful dribble advances (searched across seeds)
through the full playback controller and asserts the final
`playbackPositions` matches the LAST real advance, not an earlier or
authored spot. `state.roster` immutability re-verified through all of
this (a new assertion in every new test group). Also green: `node
--check match-lab.js`, `npm run test:draft`, `npm run test:one-on-one`,
`npm run test:one-on-one-execution`. As with Pass 1, the CSS
`translate`-based visual result itself is left for the user's own
browser pass; the tests verify the underlying `playbackPositions` state
machine directly (a stronger, more precise signal for this specific bug
than trying to assert on rendered CSS transforms from a headless
fake-DOM harness would be).

### Possession Runner v1 -- narrow correctness pass (2026-08-16)

The user's browser round confirmed playback-position continuity (Pass
1.1) but flagged that further tuning of the cosmetic duel nudge was the
wrong direction, and identified four concrete, separate correctness
issues to fix FIRST, before scoping Spatial Decision Intelligence v1
(below): don't build spatial scoring on top of geometry/animation that's
still wrong underneath it.

**1. `resolveCross()`'s `X1.D` trace endpoint always said the ball
arrived at the receiver, even when the defender won the header.** The
delivery event's `ballTo` was hardcoded to `pointOf(receiver)` before the
aerial race's outcome was even known; the terminal RESULT correctly used
`pointOf(defender)` on a loss, so the trace visibly disagreed with its
own result. Fixed: the event's endpoint is now `race.won ?
pointOf(receiver) : pointOf(aerialDefender)` -- the actual winner, always.

**2. The crosser's own pressure defender and the aerial contest defender
were the same variable -- two different spatial questions collapsed into
one.** `engagingOpponent(owner, opponents)` (near the crosser, out wide)
was reused unchanged for the header contest at the RECEIVER's landing
spot (near the goal) -- a defender closing down the crosser could
"automatically" contest a header they were never physically near. Fixed:
`crosserPressureDefender` (still `engagingOpponent(owner, ...)`, used
only for the crossing-pressure calc feeding target selection) and
`aerialDefender` (`engagingOpponent(receiver, ...)`, used for the actual
header contest and every downstream rebound/loose-ball step) are now
separate values -- genuinely can be different opponents, or one present
and not the other.

**3. The movement-less duel/contest beat's mutual coordinate nudge was
removed entirely, not just made cosmetic.** Pass 1.1 had already made it
non-authoritative (a transient offset, never written to
`playbackPositions`), but per explicit instruction that still wasn't
enough -- it visually read as real engagement (two markers closing
distance) for something the engine hadn't resolved. Replaced with a
non-positional `data-contest` indicator (styles.css: a distinct red
double-ring pulse, separate from the generic amber involvement pulse) on
both participants -- honest until the engine actually supplies duel
movement (see the "known limitation" note in Pass 1.1 -- still true,
still not invented here).

**4. Reception-advance presentation now uses EXPLICIT participant-
movement data, not an inferred rule.** `traceEvent()` gained `mover`/
`moveTo` fields (an entry + its real destination, stated directly by the
call site that knows a relocation happened), and
`applyStepAnimation()`'s authoritative-movement branch now keys off
`event.moverId`/`event.moveTo` instead of re-deriving "did the actor
move" from `ballFrom !== ballTo` + movement-type membership. This is a
deliberately different design from Pass 1.1's `actorHasRealMovement`
heuristic, which the user correctly flagged as unsafe to generalize: a
shot's or pass's `ballFrom`/`ballTo` describes the BALL leaving an actor
who stays put, so inferring "real ballFrom/ballTo change means the actor
moved" would be actively wrong for those. `resolveDribble()`'s
`P.PROGRESS.WON` sets `mover: owner, moveTo: advanced` (unchanged
behavior, now explicit); `resolvePass()`'s reception push sets `mover:
receiver, moveTo: receptionEnd` ONLY when `received.nextZone !==
receiver.zone` and the reception wasn't lost -- CLEAN/PROTECT/a
recovered HEAVY touch, and a lost reception, correctly get no mover.

**Verified:** `tools/test-possession-runner.mjs` extended to 18 groups
(73 assertions total, all pass). New cases: #16 (fix 1+2) constructs a
defender near the crosser but far from the receiver (no header contest
results) and the reverse (contest DOES result), then searches for a real
X1.D outcome and asserts the trace endpoint, terminal `ballEnd`, and
`nextOwnerId` all agree on the actual winner; #17 (fix 3) asserts a
movement-less duel beat sets `data-contest` on both participants and
never sets the old `data-cosmetic` offset or touches `playbackPositions`;
#18 (fix 4) asserts a shot's real ballFrom/ballTo does NOT relocate its
shooter (no moverId present) while an explicit knock-forward reception
DOES relocate its receiver. The test harness itself was upgraded
alongside this: the fake DOM's `querySelector`/`querySelectorAll`/
`appendChild`/`remove` now track real parent/child state (previously
every lookup fabricated a fresh, disconnected element), which is what
makes asserting on a specific marker's `dataset` after playback possible
at all -- needed for #17's `data-contest` check, and useful going
forward for the animation-facing side of Spatial Decision Intelligence
v1's own tests. Also green: `node --check match-lab.js`, `npm run
test:draft`, `npm run test:one-on-one`, `npm run test:one-on-one-execution`.

### Spatial Decision Intelligence v1 (2026-08-17)

Scoped and built exactly as instructed: AFTER the narrow correctness pass
above landed and was verified, since building spatial scoring on top of
still-wrong geometry/engagement-range would only have been correct for
the authored first frame. New module: `src/lib/spatialDecision.js` --
DOM-free, engine-adjacent (same spirit as `matchEngineCore.js`/
`oneOnOneDecision.js`), built so Match Lab can call it now and a real
match tick loop could reuse the same primitives later.

**Replaces two things at once.** (1) `engagingOpponent()`'s old mixed-
percentage-unit distance check (`ENGAGEMENT_DISTANCE = 22` compared
against raw `Math.hypot` of x/y percentage deltas -- 1% of the pitch's
68-yard width and 1% of its 105-yard length are different real
distances, so a defender genuinely 20+ real yards away could still count
as "the nearest, therefore engaging" depending which axis the gap fell
on -- the exact bug a real browser round caught). (2) the old
`actionWeights()`/`selectTeammateTarget()` model, which scored the
generic word "pass" off the passer's own attributes and a 4-row zoneFit
table, never the SPECIFIC candidate teammate's pressure/lane/
progression -- so a genuinely open pass and one into a crowd got the
same weight.

**Yard geometry, the one conversion every distance below is evaluated
in:** `toYardPoint()`/`yardDistance()`/`yardDistanceToSegment()`
(`PITCH_WIDTH_YARDS=68`, `PITCH_LENGTH_YARDS=105`, matching the pitch's
own existing `aspect-ratio:68/105`). Six distinct real-football radii,
explicitly separated per instruction (all yards, all reasonable round
numbers, explicitly NOT calibrated this pass): `AWARENESS_RADIUS_YARDS=25`,
`PRESSURE_RADIUS_YARDS=9`, `DUEL_RANGE_YARDS=6` (what `engagingOpponent()`
itself now means), `STANDING_TACKLE_RANGE_YARDS=3`,
`SLIDING_TACKLE_RANGE_YARDS=5`, `PASS_LANE_HALF_WIDTH_YARDS=3`.
`engagingOpponent(point, opponents)` kept the EXACT same call shape
every existing resolver already used, so swapping match-lab.js's local
implementation for an import was a drop-in change, not a call-site
rewrite (8 call sites, zero changed).

**Concrete candidates, not a generic per-type weight.**
`generateFreePlayCandidates(groups, attackingDirection)` builds one
scored candidate PER OPTION -- pass to player A, pass to player B, cross
to player C (only from a genuinely wide, reasonably advanced position),
shoot, and EITHER dribble-past-defender-X (a real engager in
`DUEL_RANGE_YARDS`) OR carry (open space, no engager) -- carry and
dribble are structurally mutually exclusive, never both offered.
`chooseCandidate(candidates, player, decisionRandom)` picks via
noisy-argmax: real utility plus attribute-scaled noise, then take the
max. Consumes ONLY `decisionRandom` -- `executionRandom` (resolving
whatever gets chosen) is untouched, preserving the existing independent-
stream guarantee.

**Utility factors, exactly as specified:**
- `passUtility()`: progression (`progressionYards()`, real yards toward
  the attacking goal), receiver pressure (`pressureAt()`), pass distance,
  lane obstruction (`laneObstruction()` -- true perpendicular distance
  from every opponent to the straight pass segment, not "somewhere in
  that half of the pitch"), resulting distance/angle to goal, and a
  continuation-quality proxy via that resulting position. Backward
  passes are penalized proportionally to how much ground they give up
  (not a flat toggle), and CAN still be genuinely the best-scoring option
  when forward alternatives are pressured/lane-blocked enough -- verified
  directly, not just asserted (see tests below).
- `shootUtility()`: exact distance (`distanceToGoalYards()`), angle
  (`shotAngleTightness()`), pressure, and open shooting lane
  (`shootingLaneOpenness()` -- keeper AND outfield opponents, real
  perpendicular distance to the direct line to goal), replacing the old
  four-coarse-pitch-row `zoneFit` multiplier entirely.
- `carryUtility()`/`dribbleUtility()`: structurally distinct (see
  candidate generation above), not blended into one "dribble" score --
  carry rewards real open space and progression; dribble reflects that
  it's a genuine (not free) option, with the actual risk carried by the
  real `resolveDribble()` duel roll, not re-modeled here.

**Attribute split, strictly enforced:** `selectionSharpness()` reads
ONLY Decisions/Vision/Anticipation/Composure, feeding `chooseCandidate()`'s
noise scale -- sharper players track the true utility ranking more
closely; weaker ones are noisier, which is where "a low-Decisions player
makes a mistake" (occasionally picking a lower-utility option, including
a backward pass) comes from as an EMERGENT property, not a hand-coded
exception. No execution attribute (Passing/Technique/Finishing/
Dribbling) is read anywhere in the utility formulas -- deliberately:
those already fully determine whether the CHOSEN action succeeds, via
the real resolvers downstream. Letting skill double up on both the
decision and the outcome would be exactly the "attribute compounding"
mistake flagged during the one-on-one Stage 2 review.

**Found and fixed while building this, not a pre-existing bug:**
`shootUtility()`'s angle term initially read 0 (dead-central, maximally
attractive) for ANY point on the goal's own center line regardless of
distance -- meaning a hopeless 70+-yard "shot" from dead center scored
ABOVE a genuine, close-range dribble option in one of the very first
integration tests. Fixed with a `rangeRelevance` factor
(`clamp(0,1,1-distanceYards/45)`) that suppresses the angle bonus
alongside the distance term itself, so both correctly fall toward
irrelevant together past realistic shooting range -- verified via the
monotonic "a better-angled shot beats a wider one at the SAME realistic
distance" test, not just the isolated distance comparison, which would
have passed even with the bug.

**Integration into match-lab.js:** `resolveCarry()` (new resolver --
open-space progression, unconditionally successful since by construction
nothing is in duel range to contest it, real `mover`/`moveTo` via
`advanceTowardGoal()`) added to `FREE_PLAY_RESOLVERS`. `selectTeammateTarget()`
gained an optional `preselectedId` (the candidate the possession loop
already picked a SPECIFIC teammate for wins outright, no second random()
roll, no re-deriving); threaded through `resolvePass()`/`resolveCross()`
via a `preselectedTargetId` field on the existing `availability`
parameter both already receive -- no resolver's own core logic changed.
`runConstructedPossession()`'s decision step now calls
`generateFreePlayCandidates()`/`chooseCandidate()` directly instead of
the old `selectPossessionAction()` (deleted, along with
`actionWeights()`/`actionWeight()`/`actionAvailability()` -- all now
genuinely dead code, not left unused). `renderActionTable()` (the Free
Play UI panel) rewritten to display the SAME real candidates the
possession loop decides from (best-per-type via softmax-normalized
display percentages, explicitly labeled as a readable approximation, not
`chooseCandidate()`'s literal selection probability, which noisy-argmax
has no simple closed form for) -- deliberately not left showing the old,
now-disconnected weighting model, which would have silently drifted from
what the engine actually does.

**Verified:** new `tools/test-spatial-decision.mjs` (24 assertions, all
pass; `npm run test:spatial-decision`) -- direct unit coverage of
`spatialDecision.js` itself: all 5 requested acceptance cases (a
far-away defender can't standing/sliding-tackle; carry/dribble are
structurally exclusive; a striker clear on goal prefers shoot/carry over
a backward pass into a crowd, both by raw utility AND across 300
noisy-selection trials; after beating a defender the SAME stationary
opponent is no longer duel-eligible and the resulting position reads as
a better shot; X1.D's endpoint agreement -- already covered by the
correctness pass's own test #16, not duplicated here), plus monotonic
comparisons for every required factor (closer shots more attractive,
better angle at equal realistic distance more attractive, more pressure
less attractive on both shots and passes, greater progression more
attractive, an obstructed lane less attractive, a genuinely wide position
more attractive for a cross, sharper players track true utility more
closely than weaker ones, identical seed reproduces an identical choice).
`tools/test-possession-runner.mjs` re-verified at 73 assertions, all
still passing after the integration (one real behavior change surfaced
and was fixed correctly, not worked around: test 15's fixture used to
assume the LAST movement in a trace would always be a `P.PROGRESS.WON`
event; with `carry` now real, a possession that outpaces its defender
correctly switches to `P.CARRY` for its later steps -- exactly the case
5 acceptance scenario -- so the test now follows `moverId`/`moveTo`
generally rather than one specific code). Also green: `node --check`
on both touched files, `npm run test:draft`, `npm run test:one-on-one`,
`npm run test:one-on-one-execution`.

**Deliberately not built this pass, per explicit instruction:** no
probability/percentage tuning of final match outcomes (the ~10 weight
constants in `spatialDecision.js` are reasonable, round, football-
literate starting points, not calibrated against real data or target
rates -- the one exception, rebalancing `PASS_UTILITY_WEIGHTS.pressure`/
`.lane` upward during this same pass, was fixing the internal DECISION-
FACTOR balance so the "backward passes allowed when forward options are
worse" acceptance criterion was actually reachable, not calibrating
match outcome rates -- a real distinction, not a loophole: verified by
the dedicated "a wide-open backward pass can genuinely outscore a
heavily obstructed forward one" test, which failed before the rebalance
and passes now). Continuous perception/intent/velocity/facing, defender
recovery windows, and wrong-footed states remain a separately-scoped
match-engine-awareness system, per the same instruction that scoped this
pass in the first place (see Pass 1.1's own note above) -- not
approximated here even implicitly.

### Spatial Decision Intelligence v1 -- integration audit (2026-08-17)

Before accepting v1, the user audited its integration boundaries directly
(not just its unit tests) and found five real, separate gaps. All five
were genuine correctness issues, not calibration -- fixed in that order,
kept explicitly separate from any percentage/coefficient tuning per
instruction, and re-verified against all five existing suites plus new
coverage after each one.

**1. Pitch-unit inconsistency.** `advanceTowardGoal()` (match-lab.js, used
by every dribble/carry advance) divided by a bare `120`, while every
yard-based radius/utility in `spatialDecision.js` used the real pitch
length, `PITCH_LENGTH_YARDS = 105` -- two different, silently
incompatible definitions of "yard" for the exact same y-axis (a >12%
error). Fixed: `advanceTowardGoal()` now imports and uses the SAME
`PITCH_LENGTH_YARDS` constant. Verified directly (`tools/test-possession-runner.mjs`
#19): a real dribble advance's y-delta matches the 105-yard-derived
figure (~7.62%) and explicitly does NOT match the old 120-yard one
(~6.67%).

**2. The six spatial radii were exported and unit-tested but never
actually consulted by any resolver.** `engagingOpponent()`/`DUEL_RANGE_YARDS`
WAS wired in (Pass 1's own fix), but `STANDING_TACKLE_RANGE_YARDS`/
`SLIDING_TACKLE_RANGE_YARDS` were not: `selectEngagement()` (the real,
shared engine function matchEngineCore.js and the live match tick loop
both call) picks D.STAND/D.SLIDE/D.DUEL purely off attributes -- no
distance concept exists in it at all -- so a defender within
`DUEL_RANGE_YARDS` but genuinely too far for a specific tackle type could
still get one. Fixed Match-Lab-side ONLY, never touching the shared
production function: `resolveDribble()` now downgrades the engine's own
attribute-driven choice to whatever's actually plausible from the real
distance (`canStandingTackle()`/`canSlidingTackle()`), falling back to
`D.DUEL` (always plausible, since `engagingOpponent()` already guarantees
the defender is within the largest of the three radii). Verified
(`tools/test-possession-runner.mjs` #20): a defender placed beyond both
tackle ranges but within duel range never produces `D.STAND`/`D.SLIDE`
across 500 trials.

**3. `resolvePass()`'s contest geometry rebuilt into three separate
roles**, mirroring the crosser/aerial-defender split `resolveCross()`
already got: `passerPressureDefender` (near the passer, affects target
selection only, unchanged), `laneInterceptor` (new --
`nearestLaneInterceptor()`, found by proximity to the actual
passer-to-receiver flight path, contests the interception duel),
`receiverPressureDefender` (near the receiver, affects reception
quality). Real bug fixed as a consequence: the OLD fully-uncontested
branch (no defender near the passer) skipped `resolveReceive()` entirely
and hardcoded a clean reception no matter what -- so a heavily marked
receiver off an unpressured pass could never actually be contested. Now
`resolveReceive()` is called whenever a REAL receiver-side defender
exists, independent of whether a lane interceptor exists, with `passQuality`
correctly reflecting whether the ball was actually contested in flight
(the lane duel's own probability) or genuinely uncontested (1). Verified
(`tools/test-possession-runner.mjs` #21-22): a receiver-side defender
produces real non-clean outcomes even with the passer completely
unmarked; a lane interceptor structurally invisible to the old
passer-only check (well outside the passer's own duel range, but sitting
directly on the flight path) can still intercept.

**4. Directional Carry Planning** -- the largest fix, and the one an
actual browser round caught directly: `generateFreePlayCandidates()`'s
single generic "carry" candidate (`target: null`) always resolved via
`advanceTowardGoal()`, a straight vertical line toward the byline;
`carryUtility()` only ever evaluated the CURRENT position, never a
proposed endpoint. A wide attacker in open space just kept running to
the byline, destroying their own shooting angle, because nothing ever
considered cutting inside. New `planCarryDestination()`
(`spatialDecision.js`) generates four concrete destinations in shared
yard space -- forward, a diagonal cut inward, a diagonal run outward
(mirrored for whichever side of the pitch the carrier is actually on;
symmetric left/right diagonals for a dead-central carrier instead, where
inward/outward has no real meaning), and a shorter controlled advance --
each individually rejected/scored against the position it would actually
produce (progression, resulting distance/angle to goal, `shootUtility()`
IMPROVEMENT over the current position, pressure/open space at the
destination via `carryUtility()` called AT the endpoint, path
obstruction, a byline penalty), then returns the single best one, fully
deterministically (no RNG -- direction planning is a geometry question,
not a stochastic one; `chooseCandidate()`'s own noise, keyed off
`decisionRandom`, is untouched). The winning candidate's exact `moveTo`
is threaded all the way through `runConstructedPossession()` (via a new
`availability.plannedMoveTo` field, the same mechanism `preselectedTargetId`
already used for pass/cross targets) into `resolveCarry()`, which no
longer calls `advanceTowardGoal()` at all.

Two real scale bugs were found and fixed WHILE building this, not
pre-existing: (a) the destination's raw `shootUtility()` was used
directly in carry's scoring, which climbs steeply as distance-to-goal
shrinks, so scoring the ABSOLUTE destination value kept rewarding
"carry even closer" for its own sake all the way to the byline, never
naturally yielding to "you're already in a great spot, just shoot" --
fixed by using the IMPROVEMENT (destination `shootUtility()` minus
origin `shootUtility()`) instead; (b) `progression` was applied as a raw
yard figure (up to ~12 for a 10-yard carry) while every OTHER utility
in the file normalizes its own distance terms into a bounded ratio
before weighting (see `passUtility()`'s own `progression/30` pattern) --
a real scale mismatch that let carry's score dwarf shoot's entire normal
range regardless of position, caught by (and only visible through) the
"shooting outranks carrying farther when already close" acceptance test
specifically, not by any test that only checked carry's behavior in
isolation.

**5. `shootingLaneOpenness()`'s keeper treatment.** The keeper was
treated as an ordinary blocker on the segment to goal center, identical
to an outfield defender in a passing lane -- since a keeper is naturally
near that line most of the time (that's their job), this collapsed lane
openness to ~0 for almost any normal central shot, which both understated
routine shooting chances and (compounding with Directional Carry
Planning's own `shootUtility()`-based scoring) risked pushing decisions
toward excessive carrying instead of shooting. Fixed: the keeper is
excluded from this specific lane-obstruction check entirely (outfield
opponents still correctly obstruct it); real keeper-aware shot
difficulty (which side is exposed, reflexes) is already modeled properly
downstream by the real resolver (`resolveKeeperSave()` et al) once a shot
is actually taken, and this decision-layer utility was never trying to
re-derive that. `shootUtility()` keeps accepting `keeper` as a parameter
(now explicitly `void`-marked unused) so a genuine future target-side-
aware model has an obvious place to read it from.

**Explicitly documented, not built (per instruction): v1 is
ability-blind.** Given identical geometry, a world-class player and a
technically weak one produce essentially the same objective candidate
ranking today -- only `chooseCandidate()`'s perception-noise scale
differs between them. A future "expected-success"/"action-affinity" term
(scoped in `spatialDecision.js`'s own header comment, not built) would
let real execution attributes (Passing/Technique for a pass, Crossing for
a cross, Finishing for a shot, Dribbling for a carry) shape which
candidate WINS, on top of noise -- with the explicit constraint that it
must read those attributes only to build this new utility term, never
touch `executionRandom` or any real resolver's own attribute reads, or it
would silently reintroduce the exact attribute-compounding problem the
perception/execution split exists to prevent.

**Next flagged item, explicitly NOT fixed this pass (per instruction):**
`resolveDribble()`'s successful-dribble advance (`P.PROGRESS.WON`) still
uses the same vertical-only `advanceTowardGoal()` Directional Carry
Planning just replaced for carry -- the identical defect (a dribbling
player can't cut inside either), left in place deliberately so this
pass could land and be verified before extending the same treatment to
dribble. Genuinely straightforward to extend once picked up: `resolveDribble()`'s
WON branch would call the same `planCarryDestination()`-shaped machinery
(likely factoring in the beaten defender's own position, which carry's
planning doesn't need to consider) instead of `advanceTowardGoal()`
directly.

**Verified:** `tools/test-spatial-decision.mjs` extended with unit
consistency, `shootingLaneOpenness()`/keeper, tackle-range plausibility,
pass-geometry-primitive, and Directional Carry Planning acceptance
sections (all pass). `tools/test-possession-runner.mjs` extended with 5
new integration-level groups (#19-23, all pass) exercising the REAL
resolvers end to end: unit consistency via a real dribble advance,
tackle-range wiring via 500 real `resolveDribble()` trials, receiver-side
pass pressure mattering with a completely unmarked passer, a lane
interceptor structurally invisible to the old model still intercepting,
and carry's planned `moveTo` threaded verbatim through `resolveCarry()`
(including a Replay-style determinism check and authored-roster
immutability). All five suites green: `node --check` on both touched
files, `npm run test:draft`, `npm run test:one-on-one`, `npm run
test:one-on-one-execution`, `npm run test:possession-runner` (91
assertions), `npm run test:spatial-decision`.

### Cross Resolution and Dynamic Off-Ball Movement -- Pass A (2026-08-18)

The next browser round surfaced a genuinely missing ENGINE LAYER, not an
animation gap -- the user scoped it as three ordered passes (A: source
contest and delivery; B: dynamic aerial positioning and defender
recovery; C: goalkeeper command of crosses) and asked for Pass A only
this round, explicitly deferring B and C. Same discipline as every
recent pass: kept separate from goal-conversion calibration, full
conditional-rate telemetry before any tuning, real resolver-level
mechanics (not Match-Lab-only heuristics) for anything meant to
eventually generalize to the live match engine.

**New `matchEngineCore.js` resolvers**, same template as the existing
`resolveShotBlock()` (a nearby defender's own attributes decide whether
they affect the action before a specific outcome is rolled), under a
NEW `CROSS.SOURCE.*`/`CROSS.DELIVERY` namespace -- deliberately separate
from the existing `X1`/`X1.D`/`X1.R` codes (the AERIAL contest at the
receiving end, untouched by Pass A) and from `DELIVERY.*` (the
structurally different set-piece corner/wide-free-kick wrapper):

- `resolveCrossSourceContest(crosser, defender, minute, random)` -- FIVE
  real outcomes, not a binary blocked/not: `CROSS.SOURCE.TACKLED` (a
  clean turnover, the cross never happens), `CROSS.SOURCE.BLOCKED_BEHIND`
  / `CROSS.SOURCE.BLOCKED_LOOSE` (a body/leg gets to it after it's
  struck), `CROSS.SOURCE.PRESSURED` (the delivery still escapes, but
  under duress -- feeds delivery quality below), `CROSS.SOURCE.CLEAN` (a
  real contester was close enough to try and still didn't affect it --
  the same honest "proximity isn't destiny" property `resolveShotBlock()`
  already has). Defender side: Tackling/Positioning/Anticipation/
  Aggression/Bravery. Crosser's resistance: Technique/Balance/Composure/
  Crossing.
- `resolveCrossDelivery(crosser, {pressureFactor, distanceYards}, random)`
  -- delivery quality (0-1) and a real accuracy-error distance (yards),
  from Crossing/Technique/Decisions/Composure, the source contest's own
  pressure (if any), and delivery distance. "Foot used" deliberately
  NOT read as a real input here -- same reasoning `resolveDelivery()`'s
  own `DELIVERY.SWING` comment already gives: foot preference isn't
  currently plumbed into match players at all, so there's no honest data
  to read for it (match-lab.js may still pick a foot/curl direction for
  PRESENTATION, same as it already does for shots via
  `selectStrikeMechanics()`, but that's never treated as a real quality
  input).

**New `spatialDecision.js` geometry**, since "position and reachable path
intersect the delivery action" (explicit instruction: proximity alone is
insufficient) is a spatial question, not an attribute one:

- `crossSourceContestDefender(crosser, deliveryTargetPoint, opponents)`
  -- TWO conditions, both required: within `CROSS_SOURCE_CONTEST_RANGE_YARDS`
  (4yd -- tight, smothering-the-kick range, not a general duel) of the
  crosser, AND not meaningfully BEHIND the crosser relative to the
  delivery direction (a dot-product gate against the crosser-to-target
  vector). A defender standing between the crosser and their own goal
  cannot reach out and block a ball moving away from them no matter how
  close they stand -- verified directly: "Maldini behind Ronaldinho
  cannot magically block it" holds even at 2.5 real yards, purely off
  the directional gate, not the distance one.
- `deliveryLandingPoint(intendedTarget, accuracyErrorYards, random)` --
  turns the delivery's real accuracy error into an actual landing point
  (a deterministic angle off the SAME execution random stream, never a
  fresh untracked roll), clamped to playable bounds.

**`resolveCross()` rewired** (match-lab.js) to run the source contest
BEFORE any delivery happens, using its own new
`crossSourceContestDefender()` -- a THIRD spatial role alongside the
pre-existing `crosserPressureDefender` (target-selection pressure only)
and `aerialDefender` (the receiving-end contest, unchanged). A blocked/
tackled cross now returns its real terminal contract immediately (the
ball's own trace endpoint is the defender's actual position -- never a
delivery that "continues" past them to the original target, the explicit
"must not automatically travel through a defender marker" requirement).
A delivered cross gets a REAL landing point threaded through the rest of
the chain (the aerial contest, still attribute-only for now, resolves AT
that landing point rather than always exactly `pointOf(receiver)`; the
header's own `ballFrom` chains from it too). Pass A deliberately does
NOT move the receiver or crosser themselves -- only the ball gets a real
computed destination; "Ronaldo and Stam visibly attacking the landing
point" is Pass B's own explicit scope, not approximated here even
implicitly (verified directly: no trace event in a Pass-A-only cross
carries a `moverId` for the crosser or receiver).

**Found and fixed while touching this function, unrelated to Pass A
itself:** `resolveCross()`'s `EMPTY_NET` branch re-derived
`pointOf(receiver)` as its `ballFrom` instead of chaining from the
on-target header event's own real endpoint (`goalPointFor(receiver,
null)`) -- the same "ball travels twice" pattern this whole session has
been fixing everywhere else, just never caught in this specific branch
before now. `resolveShoot()`'s own `EMPTY_NET` never had this bug (it
omits `ballFrom`/`ballTo` entirely instead) -- confirmed by reading it
directly before assuming the fix applied there too.

**Verified:** new `tools/test-cross-resolution.mjs` (22 assertions, all
pass; `npm run test:cross-resolution`) -- three layers, same pattern as
Spatial Decision Intelligence's own suite: pure `matchEngineCore.js`
resolver tests (tier separation for both new functions, determinism),
pure `spatialDecision.js` geometry tests (Maldini-in-lane vs
Maldini-behind vs too-far-even-when-directionally-ahead), and full
`match-lab.js` integration tests (the two named acceptance cases
verbatim, no-travel-through-a-defender-marker, explicit ball-only
movement data, authored-roster immutability, Replay determinism). All
six suites green: `node --check` on every touched file, `npm run
test:draft`, `npm run test:one-on-one`, `npm run test:one-on-one-execution`,
`npm run test:possession-runner`, `npm run test:spatial-decision`, `npm
run test:cross-resolution`.

**Telemetry, not calibration:** new `tools/cross_resolution_audit.mjs`
(`npm run cross:audit`) -- a skill-tier matrix (source-defender tier x
crosser tier, same idiom `keeper_save_audit.mjs`/`one_on_one_action_audit.mjs`
already established for this codebase), reporting every conditional rate
separately per the explicit instruction: cross attempts, source
block/tackle/pressure/clean rates, deliveries reaching a landing point,
an illustrative "accurate delivery" rate (quality >= 60%, not a
calibrated threshold), attacker-vs-defender first contact, header/shot
attempts and on-target rate, keeper catches, rebound chances, and final
goals-per-attempt -- with every Pass B/C-only metric (keeper claim
decisions, clean claims, punches, mishandles, attacker/defender arrival
quality) explicitly listed as `N/A -- Pass B/C not built` rather than
silently omitted, so the report's own shape already matches where those
numbers need to go once those passes land. One real, unforced finding
from a smoke run, reported here (not acted on): average/weak crossers
essentially never clear the illustrative 60%-quality bar under any
source-defender tier -- a genuine "which stage is suppressing this"
signal the report exists to surface, explicitly not something to tune in
this pass.

**Deliberately not built this pass, per the user's own three-ordered-
passes instruction:**
- **Pass B -- dynamic aerial positioning and defender recovery.** The
  aerial contest is still `engagingOpponent(receiver, ...)` against the
  receiver's own static authored position, still a flat attribute-only
  `contestedRace(..., {aerial:true})` -- no arrival-time model (projected
  landing point vs. attacker/defender arrival time), no real
  `playerMoves` for the receiver/defender attacking the landing point,
  no beaten-defender recovery/chase state. Explicitly scoped next.
- **Pass C -- goalkeeper command of crosses.** No stay/claim/punch/
  uncertain decision exists before the aerial contest at all; the keeper
  only ever appears downstream via the EXISTING `resolveKeeperSave()`
  call once a header is already on target, unchanged by Pass A.
- No goal-conversion tuning of any kind -- the telemetry tool above
  exists specifically to make that decision informed once B and C exist,
  not to be read as a calibration target now.

### Contact, Ownership & Continuation (2026-08-18)

A follow-up browser round on top of Cross Resolution Pass A surfaced a
genuinely missing part of the EVENT CONTRACT, not a new engine stage: the
renderer had no way to express two participants moving at once (a
Cardozo-attacks/Ferdinand-challenges header duel could only ever carry one
`moverId`), several "contact" moments (a header win, a rebound pickup, a
defensive clearance) had no single authoritative point tying the ball's
arrival, the contacting player's position, and the next ball flight's
origin together, and X1.D still ended the possession flat -- the defender
who won a header was simply credited with the ball at their own STATIC
pre-contest position, never asked to do anything with it. The user scoped
this narrowly and explicitly: fix the data/geometry first, no
cross/header/save/rebound probability recalibration, no new rendering
library.

**Built, in full:**

1. **`playerMoves[]` + `contact`, the new general movement/contact
   contract.** `traceEvent()` (`match-lab.js`) gained two new opts:
   `playerMoves` (`[{ player, to, action }]`, resolved to
   `[{ playerId, from, to, action }]` on the pushed event -- `from` is
   read the same way `ballFrom` already is, off whichever roster the
   caller is resolving against) and `contact` (`{ point, actor, type }`,
   resolved to `{ point, actorId, type }`). The pre-existing single-mover
   `mover`/`moveTo` shorthand is UNCHANGED and still works exactly as
   before (dribble advances, carry, knock-forward receptions all still
   use it, zero call-site changes) -- when `playerMoves` isn't given but
   `mover`/`moveTo` are, `traceEvent()` derives a one-entry `playerMoves`
   array from them internally, so every event has one consistent shape to
   read regardless of which the call site used, and the two representations
   can never disagree with each other.
2. **`applyStepAnimation()`** gained one new branch, checked BEFORE the
   existing single-mover branch: `event.playerMoves.length > 1` moves
   every named participant to their own real destination and writes
   `playbackPositions` for each, with NOTHING inferred for anyone not
   listed (the keeper's own positioning during a cross, for instance,
   still isn't modeled -- an honest gap, not a guess). The existing
   single-mover branch, the `DUEL_CONTEST_MOVEMENTS` contest-indicator
   branch, and the ball-flight cosmetic-nudge branch are all completely
   untouched.
3. **Cross/header continuity (`resolveCross()`).** The aerial contest now
   pushes `playerMoves` for BOTH the receiver and the aerial defender,
   converging on the SAME point -- the delivery's own real landing point
   (Pass A's `landingPoint`), not either player's static pre-contest spot.
   `contact: { point: landingPoint, actor: <the actual winner>, type:
   "header" }` names the winner explicitly. The header/shot attempt that
   follows a won header, and the defensive continuation that follows a
   lost one, both begin their own `ballFrom` at that exact point --
   verified directly, not assumed (`tools/test-contact-continuity.mjs`'s
   "header contact continuity" suite: 200 trials, ball-arrives-before-
   contact, contact-endpoints-agree, both-players-converge, winner-named-
   correctly, next-flight-starts-at-contact, all held across every trial).
4. **X1.D replaced with a real defensive continuation decision.** A
   defender who wins the header no longer just owns the ball on the spot
   -- `resolveAerialClearanceContinuation()` (new, `match-lab.js`) runs a
   real six-option decision: clear long, clear toward the touchline, clear
   behind for a corner, find a teammate, head back to the keeper, or bring
   it under control. New geometry in `spatialDecision.js`:
   `clearanceDanger()` (proximity to the DEFENDER's OWN goal plus real
   attacking pressure on the contact point) and
   `generateClearanceCandidates()` (six candidates, gated on real
   teammate/keeper placement -- pass-teammate/pass-keeper are never
   offered without one, same "never invent a recipient" rule
   `selectTeammateTarget()` already follows -- reusing the EXISTING
   `chooseCandidate()` noisy-argmax selector, not a second mechanism). New
   `resolveClearanceAttempt()` in `matchEngineCore.js` resolves whichever
   action was chosen: quality/completion driven by Heading (clearances),
   Passing/Technique (the two pass options), Technique/Composure
   (control), all under real pressure/distance context, one shared random
   roll each. **Deliberate, explicit exception to Spatial Decision
   Intelligence v1's own ability-blindness principle** (backlog item 25) --
   the user's own spec for this ONE decision names specific execution
   attributes (Heading, Passing, Technique) alongside the usual perception
   ones (Decisions, Composure, Anticipation); scoped to only this
   decision, not a silent widening of the pass/cross/shoot/carry/dribble
   utilities, which stay exactly as ability-blind as they were.
5. **Rebound continuity (`resolveReboundScramble()` + both `resolveCross()`/
   `resolveShoot()` uncontested-rebound branches).** The loose-ball point
   (`originPoint`, already explicit) now gets real `playerMoves` for BOTH
   the attacker and the defender converging on it (not just the ball
   teleporting to whichever one wins), a `contact` record naming the
   winner (`type: "recovery"`), and the follow-up rebound shot's own
   `ballFrom` begins exactly there instead of re-reading the attacker's
   stale pre-scramble position.
6. **Two real bugs found and fixed while building this, not scope creep:**
   - **Keeper credited with owning the ball at an out-of-play miss point.**
     `REBOUND.MISS`/`rebound-scramble-miss` (three call sites:
     `resolveReboundScramble()`, `resolveCross()`'s and `resolveShoot()`'s
     own uncontested-rebound branches) all set `nextOwnerId: keeper.id`
     unconditionally, even on a MISS -- meaning `ballEnd` was a wide/over
     miss point nobody, keeper included, was actually standing at, and
     the Possession Runner's own atomic roster update would have moved
     the keeper's simulated marker there. Fixed: a miss is now
     `nextOwnerId: null`, `possession: "dead"`, `restart: "goal-kick"` --
     the ball genuinely left play, exactly like every other off-target
     attempt.
   - **"Clears the danger" mislabeling a bare loose-ball pickup.**
     `REBOUND.LOST`'s label claimed a clearance ("clears the danger")
     for a defender who had merely reached the loose ball first, with no
     destination or flight ever recorded for that beat. Relabeled to
     "reaches the loose ball first" -- "clears" is now genuinely reserved
     for events that carry a real destination and ball flight (verified:
     `clearance-behind`/`clearance-clear-long`/`clearance-clear-touchline`
     labels DO say "clears" and DO carry a `moveTo`; `clearance-control`
     and the rebound-pickup label never do).
7. **Restart vocabulary for genuinely out-of-play results.** Every
   terminal result where the ball leaves play now declares a real restart
   type instead of a bare `null`: `shot-off-target`/`header-off-target`/
   `rebound-*-miss*` -> `"goal-kick"`; `shot-blocked-behind`/`cross-source-
   blocked-behind`/`clearance-behind` -> `"corner"`; a clean
   `clear-touchline` that genuinely goes out -> `"throw-in"`. In-play
   turnovers (a keeper catch, a loose ball recovered by a named defender,
   a clean interception) are deliberately UNCHANGED -- those aren't
   dead-ball restarts, the ball is just honestly still live with someone
   holding/near it.
8. **Semantic correctness, closed the loop.** "Ferdinand merely receives
   the ball" (the `control` clearance action) is labeled "brings it under
   control"/"is dispossessed," never "clears" -- no destination or flight
   exists for that beat. A completed clearance pass says "finds
   [teammate]"/"plays it back to [keeper]," not "clears." Out-of-play
   results all carry `nextOwnerId: null` plus one of `"goal-kick"`/
   `"corner"`/`"throw-in"` (see point 7).

**Verified:** new `tools/test-contact-continuity.mjs` (`npm run
test:contact-continuity`) -- same three-layer pattern as every other
suite this project (pure `matchEngineCore.js` resolver tests for
`resolveClearanceAttempt`'s tier separation/determinism, pure
`spatialDecision.js` geometry tests for `clearanceDanger`/
`generateClearanceCandidates`' availability gating and attribute bias, full
`match-lab.js` integration tests), PLUS three constructed end-to-end
traces matching the reported scenario's own cast (Cardozo attacking a
cross, Ferdinand challenging/clearing, Howard in goal, Gerrard scrambling
a rebound): header contact continuity, defensive-continuation reachability
and per-action-type correctness (all six action types individually
checked: ownership, restart, and "clears"-vs-"secures" wording), rebound
continuity and the keeper-ownership bug fix, Replay/Step producing
identical `playbackPositions` from the identical stored trace, and a
dedicated 1500-trial sweep exercising `resolveAerialClearanceContinuation()`
directly to confirm every one of its universal invariants (contact point
consistency, ball-flight-starts-at-contact, out-of-play results always
owner-less with a real restart) holds regardless of which of the six
actions fires. All 7 suites green: `node --check` on every touched file,
`npm run test:draft`, `test:one-on-one`, `test:one-on-one-execution`,
`test:possession-runner`, `test:spatial-decision`, `test:cross-resolution`,
`test:contact-continuity`. `tools/test-possession-runner.mjs`'s own X1.D
test (group 16, written for the earlier correctness pass) was updated in
place to assert the NEW contract (contact point, both players converging,
hand-off to a real continuation) instead of the flat terminal behavior it
intentionally supersedes -- not worked around.

**No calibration touched** -- every new formula in
`resolveClearanceAttempt()`/`clearanceDanger()`/`generateClearanceCandidates()`
is new code (there was no clearance mechanic to recalibrate), and every
existing cross/header/save/rebound probability is byte-for-byte unchanged;
only the DATA those events carry and what happens after an aerial loss
changed. Nothing is committed -- this is over to the user's own browser
check, same as every prior round.

**Backlog item 26 (Cross Resolution Pass B) narrows as a result:** this
pass already delivers real `playerMoves` for the receiver/defender
converging on the landing point during the aerial contest -- what Pass B
still owns is the ARRIVAL-TIME model itself (a projected landing point and
attacker/defender arrival times that can genuinely differ by player speed,
rather than both simply converging on the delivery's already-fixed
landing point) and the beaten-defender recovery/chase state feeding the
following decision. See the updated item 26 below.

### Off-Ball Goalkeeper Awareness & Shot Placement Geometry (2026-08-18)

A browser round reported a striker (Ronaldinho) who had clearly carried
past a static keeper (Dida) five times in a row still "shooting backward"
at the keeper's own stale position on the sixth action, getting saved
despite having no keeper genuinely between him and goal. Traced to two
compounding gaps, not one: (1) the keeper never reacted to the ball at
all during Free Play possession progression -- exactly "non-ball owner
players are still static and unaware of the situations," called out
explicitly -- so after several carries he was simply left standing behind
the actual play; (2) `goalPointFor()` (and by extension every finishing
moment that calls it) blindly trusted the keeper's raw position as the
aim point regardless of whether they were actually still between the
shooter and goal, so even a keeper who WAS badly out of position still
"received" the shot and got a save roll.

**Scoped narrowly to the reported bug's own root cause**, deferring two
separate, larger asks from the same message (see below) rather than
folding them in:

1. **Keeper positioning during Free Play possession
   (`keeperPositioningPoint()`, new in `spatialDecision.js`).** The
   standard real-football "narrow the angle" heuristic: stand on the
   straight line between the ball and the center of your own goal, at a
   distance off the line that grows with how far away the ball is
   (capped 2-12 yards). Pure geometry, no attributes, no randomness --
   same "deterministic, not tuned" starting point Directional Carry
   Planning used. Wired into `runConstructedPossession()`'s own loop: after
   every NON-terminal step (the possession continues), the defending
   keeper's simulated position is updated toward the ideal spot and a new
   `GK.ADJUST` trace event is pushed (reusing the EXISTING single-mover
   `mover`/`moveTo` mechanism -- no renderer changes needed at all), with
   a small movement threshold so a barely-changed ideal spot doesn't spam
   near-identical events every step. This is what actually stops a
   keeper from being left behind the play across a multi-carry sequence.
2. **Shot placement geometry (`isKeeperBeaten()`, new in `match-lab.js`).**
   A keeper further from their own goal line than the shooter is has
   genuinely been rounded, not just "shot near" -- `goalPointFor()` now
   redirects to the real open-goal aim point in that case instead of
   `pointOf(keeperEntry)`, and `resolveShoot()`/`resolveCross()`'s own
   `EMPTY_NET` branches now trigger on `!keeper || isKeeperBeaten(...)`,
   not just `!keeper` -- skipping `resolveKeeperSave()` entirely rather
   than rolling a save against a keeper who is structurally not there to
   make it. This is a WIRING fix (deciding WHEN it's honest to even call
   the save resolver, the exact same principle the pre-existing no-keeper
   branch already used), not a new probability formula -- `resolveKeeperSave()`
   itself is untouched.

Together these two fixes are complementary, not redundant: (1) makes the
degenerate case rarer by keeping the keeper's baseline positioning
sane; (2) is the honest fallback for when a shooter genuinely earns a
one-on-one anyway (a fast dribble in one step can still outrun the
keeper's own incremental adjustment, which is realistic -- a keeper isn't
supposed to be un-beatable).

**Verified:** new `tools/test-keeper-awareness.mjs` (`npm run
test:keeper-awareness`) -- pure `keeperPositioningPoint()` geometry
(bounds, determinism, colinearity with the ball-to-goal line, monotonic
advance-vs-distance, the realistic advance cap), full `match-lab.js`
integration (the beaten-keeper bypass in both `resolveShoot()` and
`resolveCross()`, confirming `resolveKeeperSave()` is never even called
once beaten; an UNBEATEN keeper still saves shots exactly as before -- no
regression; no keeper placed at all still resolves as a genuine empty net
without error), and the reported bug's own repro through
`runConstructedPossession()` -- a lone dribbler against a static keeper
genuinely produces `GK.ADJUST` events and a keeper whose simulated
position visibly changes from where they were authored, with `state.roster`
(the authored setup) confirmed untouched and Replay determinism confirmed
(`identical seed reproduces an identical keeper trajectory`). All 8
suites green: `node --check` on every touched file, `npm run test:draft`,
`test:one-on-one`, `test:one-on-one-execution`, `test:possession-runner`,
`test:spatial-decision`, `test:cross-resolution`, `test:contact-continuity`,
`test:keeper-awareness`.

**No calibration touched** -- `resolveKeeperSave()`'s own formula is
byte-for-byte unchanged; this only changes WHEN it's called and WHERE the
animation aims. Nothing is committed -- over to the user's own browser
check.

**Deliberately NOT built this pass, from the same reported message --
two separate, larger asks, not silently folded in:**
- **Carry "gait" differentiation (nimble/small-step vs. jog vs. sprint/
  full-speed run)** -- currently every carry uses the same fixed
  `CARRY_FORWARD_YARDS`/`CARRY_SHORT_YARDS` distances (10/5 yards)
  regardless of context; the request was for genuinely different
  movement styles/distances-per-action, chosen situationally (open space
  favors covering more ground; tight quarters favor a smaller, more
  controlled touch). A real, self-contained extension to Directional
  Carry Planning's own candidate generation, not started -- flagged as
  backlog item 28.
- **General outfield (non-keeper) off-ball awareness** -- defenders
  repositioning/marking/tracking runs dynamically as the ball moves is a
  substantially larger undertaking than keeper positioning (a full
  defensive-shape model, not one narrow geometric heuristic) and was
  explicitly the SECOND half of "non-ball owner players are still static"
  even though the keeper was singled out as the worst offender ("especially
  the goalkeeper"). Not started -- flagged as backlog item 29, and likely
  needs its own scoped design pass rather than a quick addition, the same
  way Cross Resolution Pass B/C were separated out from Pass A.

### Free Play role simplification, touch-path visualization, quick setup (2026-08-18)

Three UI-layer requests in one message, all about how the roster is
built and inspected rather than engine correctness:

1. **Free Play's role dropdown no longer offers Attacker/Receiver/
   Defender/Pass-candidate.** Confirmed by reading `freePlayGroups()`
   directly: it already never reads `entry.role` for anything except
   `"keeper"` -- who's a pass/cross candidate is entirely a function of
   who's on the ball owner's OWN team and isn't the owner themselves (see
   `generateFreePlayCandidates()`), so those role labels were always
   cosmetic noise inherited from sharing one dropdown with Scenario Probe
   (which genuinely needs typed slots -- every scenario's own `run()`
   reads `byRole.attacker[0]`/`byRole.defender`/`byRole.wall`/etc
   directly, so `ROLE_LABELS` keeps every one of those keys, untouched).
   A new `"player"` role (generic outfield, not the keeper) is Free
   Play's other option; `renderRoster()`'s role `<select>` now renders
   only `["player", "keeper"]` in Free Play mode (Probe's dropdown is
   completely unchanged), and `addPlayer()` defaults new Free Play
   players to `"player"` instead of whatever scenario-role slot happened
   to be emptiest.
2. **Ball-owner touch path -- `#labShowTouchesCheckbox`.** A new,
   separate SVG layer (`.ml-pitch-touch-layer`, same 75x120yd viewBox
   convention as the existing curved-shot-trail layer, but ACCUMULATING
   across a whole possession instead of being cleared per event) draws a
   yellow line connecting every real touch on the ball plus a yellow X at
   each one. A "touch" is read honestly off the trace exactly as the
   engine already produces it -- any event carrying a real `ballFrom` --
   no invented intermediate touches. This is deliberately NOT a fix to
   touch frequency (a single carry/dribble action is genuinely one
   resolved touch today, even though a real player would take several);
   it's a diagnostic that makes that gap visible, matching this tool's
   whole reason for existing. Recording is wired into `applyStepAnimation()`
   itself (accumulates correctly across Step/Play/Replay), reset only at
   the four genuine "fresh playback" points -- Play, Reroll, Replay,
   Reset -- never inside `clearStepEffects()` itself, which runs on every
   single step and would otherwise wipe it every time.
3. **Quick setup -- 2v2/3v3/5v5.** Three new buttons fetch a genuinely
   random matchup via `getDraftCandidates()` (the SAME seeded random pool
   the draft flow itself already uses, not a fixed/curated list, fresh
   seed every click) -- one real goalkeeper per side (`positions:["GK"]`,
   so the keeper slot is filled by an actual keeper, not an outfielder
   standing in) plus the rest as outfield `"player"`s, enriched via the
   same `getPlayerMetrics()` batch call `addPlayer()` already uses
   (matched back to each candidate by `database_slug:source_person_id`
   identity, the same composite key `draft-run.js`'s own `hydratePlayers()`
   uses). Placement is a simple two-band spread derived from the CURRENT
   `state.attackingDirection` (correct even after the user flips it), not
   an authored tactical formation. Forces Free Play mode (this feature
   has no meaning in Scenario Probe) and gives the ball to a home
   outfield player so the possession runner is immediately ready.

**Verified:** `node --check` on every touched file; all 8 existing test
suites re-run and confirmed green (`test:draft` through
`test:keeper-awareness`) -- none of them exercise this DOM/network-heavy
UI layer, so this is a smoke check that nothing else broke, not direct
coverage of the new behavior itself. **No automated test coverage was
added for this pass** -- unlike every resolver-level change in this
project, none of these three features are pure functions over plain data
(role rendering is DOM-select construction, the touch path is SVG
`innerHTML` built from live playback state, quick setup is a live network
call to `getDraftCandidates()`/`getPlayerMetrics()`) -- the existing
fake-DOM harness (built for exercising resolvers, not for asserting
rendered `<option>`/`<path>` markup) isn't the right tool for this, and a
real one would need its own dedicated setup. Verified instead by tracing
the logic directly against the actual call sites (`freePlayGroups()`,
`renderPitch()`'s marker-only DOM writes, `clearResults()`'s own reset
scope) rather than assumed. Needs the user's own browser pass -- same as
every prior round, but doubly true here since nothing automated
exercises it at all.

### Touches Per Carry (2026-08-18)

The new ball-touch visualization immediately did its job: the very first
real browser round using it showed a 5-carry possession with exactly 5
touches total (one per action), which the user correctly flagged as
unrealistic -- a real player touches the ball repeatedly while running
with it, not once per several yards. Scoped as backlog item 28 (carry
"gait" differentiation) since the prior pass, picked up now.

**Built:** `resolveCarry()` and `resolveDribble()`'s successful-advance
(`P.PROGRESS.WON`) branch both now subdivide their already-planned
straight-line run into real intermediate touches instead of covering the
whole distance in one resolved touch. Two new, fully deterministic
functions in `spatialDecision.js` (no RNG parameter at all -- consumes no
`random()` call, so this never perturbs the existing RNG stream sequence
either resolver already relies on for its own duel/engagement rolls):
- **`determineCarryGait(fromPoint, opponents)`** -- `"nimble"` (short,
  controlled touches) under real pressure (`pressureAt() > 0.35`),
  `"sprint"` (long, space-covering touches) when nobody is even within
  `AWARENESS_RADIUS_YARDS`, `"jog"` in between. Reuses `pressureAt()`
  exactly as every other pressure read in this file already does -- no
  new radius, no new concept.
- **`planCarryTouches(from, to, gait)`** -- evenly-spaced intermediate
  waypoints at the gait's real spacing (nimble 1.5yd / jog 3yd / sprint
  5.5yd), excluding the destination itself (the caller already owns and
  pushes that as its own final event). Empty for a carry shorter than one
  gait interval -- the previous single-touch behavior exactly, not a
  regression.

Both resolvers push one `P.CARRY.TOUCH`/`P.PROGRESS.TOUCH` event per
intermediate waypoint (each chaining `ballFrom`/`ballTo` exactly from the
previous one, the same continuity invariant every other multi-event
resolver in this file already holds), then the SAME final `P.CARRY`/
`P.PROGRESS.WON` event as before, byte-identical in shape -- the
DESTINATION itself is completely unchanged (still exactly
`availability.plannedMoveTo` / `advanceTowardGoal()`'s own result, still
`ballEnd`), this only decides how many genuine touches lie along the way
there. A real, interesting emergent property found while building this:
`resolveDribble()`'s WON branch (beating a defender who is, by
construction, within `DUEL_RANGE_YARDS`) reads as real pressure almost
every time, so it comes out "nimble" far more often than not -- several
close touches to actually beat someone, not one long stride, without
that being hand-coded anywhere. `resolveCarry()` (only ever offered when
NO defender is within duel range at all) structurally can never quite
reach the nimble threshold for the SAME reason in reverse -- open-space
carrying skews jog/sprint, which reads as correct: tiny nimble touches
belong to a contested 1v1 skill move, not a clean run into space.
Touch-event animation is deliberately snappy (`movement: "touch"`, a new
220ms duration -- the existing flat 500ms "dribble" duration would make
a 5-6-touch nimble carry crawl on screen).

**Verified:** new pure-geometry tests in `tools/test-spatial-decision.mjs`
(gait determination across all three bands, touch spacing/monotonicity/
never-reaching-the-destination, the sub-one-interval empty-array case,
determinism) and four new integration groups in
`tools/test-possession-runner.mjs` (real intermediate touches for both
`resolveCarry()` and `resolveDribble()`'s WON branch, exactly one final
`P.CARRY`/`P.PROGRESS.WON` event regardless of touch count, the
destination itself unaffected by subdivision, full ballFrom/ballTo
continuity across every touch within one action, open space producing
fewer touches than real pressure at an IDENTICAL distance -- isolating
gait as the only variable rather than letting `planCarryDestination()`'s
own pressure-sensitive destination choice confound the comparison,
Replay determinism of the whole touch sequence). All 8 suites green,
including every pre-existing test that exercises `resolveCarry()`/
`resolveDribble()` -- none of them needed changes, since the final event
each one finds by code (`"P.CARRY"`/`"P.PROGRESS.WON"`) is still exactly
where it always was, unchanged in shape.

**No calibration touched** -- gait thresholds and touch spacing are new,
reasonable, round starting points (same "not tuned against real data
this pass" convention every other spatialDecision.js constant already
follows), and neither `resolveCarry()`/`resolveDribble()`'s own
DESTINATION nor any duel/engagement probability changed at all. Nothing
is committed -- over to the user's own browser check to see whether the
touch count now reads as realistic.

### Off-Ball Defender Awareness v1 + a real rebound-movement bug (2026-08-18)

A browser round on Touches Per Carry surfaced two separate things: a
concrete animation bug (a scored uncontested rebound where the ball
visibly stayed in the keeper's hands), and a large, explicit ask for real
defensive "consciousness" -- backlog item 29, picked up now. Three
genuinely separate asks arrived in the same message (ball-momentum/
independent-asset carry animation, and a general "animations are rigid,
not fluid" architecture complaint); both are explicitly scoped OUT of
this pass, below.

**Bug fixed: the uncontested-rebound scorer never moved to meet the
ball.** `resolveShoot()`'s and `resolveCross()`'s own uncontested-rebound
branches (no defender to contest the loose ball) already named the
scorer as the `contact` record's actor, but never actually moved their
MARKER there via `mover`/`moveTo` -- so a scored rebound visually read as
the ball never leaving the keeper's hands, exactly as reported. Both now
carry `mover: <scorer>, moveTo: saveEndpoint`, reusing the exact
`applyStepAnimation()` single-mover mechanism every other fix in this
project already relies on -- zero renderer changes needed.

**Off-Ball Defender Awareness v1, built to the user's own explicit
spec:** "a good defender needs to read the situation... make it harder
to score or pass to a teammate... chase and catch, or as a last resort
slide... if there are multiple defenders, they combine -- one covering,
other approaching the carrier... if the carrier is alone, they may both
approach." Three new, fully deterministic functions in
`spatialDecision.js` (no RNG, consumes no `random()` call -- same
"deterministic, not tuned" principle every positioning heuristic in this
file already follows):
- **`pressingTarget(defenderPoint, ballOwnerPoint)`** -- the nearest
  defender to the ball always presses: closes ground capped at
  `DEFENDER_MAX_ADVANCE_YARDS` (8yd) per step, but holds
  `PRESS_STANDOFF_YARDS` (1.5yd) short of the carrier rather than walking
  onto them -- once genuinely close, the EXISTING
  `engagingOpponent()`/`pressureAt()` reads pick them up for real
  contest on the next action; nothing about dribbling, tackling, or
  pressure itself changes here, only where a defender stands going into
  it. Reuses a new general-purpose `approachPoint()` (capped per-step
  advance toward any target, never overshoots -- the authoritative twin
  of `nudgeToward()`'s own cosmetic-only version in `match-lab.js`).
- **`coveringPositionPoint(subjectPoint, defendingDirection)`** -- every
  OTHER defender marks the nearest not-yet-covered attacking teammate,
  standing `COVER_STANDOFF_YARDS` (4yd) off them on the goal side -- the
  same "narrow the space" principle `keeperPositioningPoint()` already
  uses, at real mark-tracking distance instead of a keeper's own
  goal-line standoff.
- **`planDefensiveRepositioning(ballOwnerPoint, attackingTeammates,
  defenders, defendingDirection)`** -- the one decision per defender,
  every step: nearest presses, others cover the nearest uncovered
  attacking teammate each -- UNLESS there isn't one (a genuinely lone
  carrier, or simply more defenders than attackers to mark), in which
  case they press too, exactly the explicit "both approach" instruction.

Wired into `runConstructedPossession()`'s own loop, in the SAME
"only while the possession continues" step the keeper's own `GK.ADJUST`
already uses (`freePlayGroups()`'s `.teammates`/`.opponents` already give
exactly the right shapes -- no new query needed). One combined
`DEF.ADJUST` event per step, not one per defender -- `playerMoves[]`
(Contact, Ownership & Continuation) already supports this, each entry's
own `action` field distinguishing `"press"` from `"cover"` so the trace
itself shows which role fired, not just that something moved.

**Verified:** new pure-geometry tests in `tools/test-spatial-decision.mjs`
(`approachPoint`'s cap/no-overshoot, `pressingTarget`'s standoff,
`coveringPositionPoint`'s goal-side placement, `planDefensiveRepositioning`'s
nearest-presses/others-cover assignment and the lone-carrier swarm case,
determinism) and two new integration groups in
`tools/test-possession-runner.mjs` (defenders genuinely reposition across
real possessions, press AND cover roles observed together in the SAME
combined event -- real multi-defender coordination, not just parallel
individual reactions -- authored-roster immutability, Replay determinism).
A dedicated regression test for the rebound-movement bug fix in
`tools/test-contact-continuity.mjs` (both `resolveShoot()`'s and
`resolveCross()`'s own uncontested-rebound branches). All 8 suites green.

**No calibration touched** -- every new constant is a reasonable, round,
not-tuned-against-real-data starting point (same convention as every
other spatialDecision.js constant), and no duel/engagement/pressure
probability changed at all; defenders only reposition BETWEEN actions,
never during one. Nothing is committed -- over to the user's own browser
check.

**Deliberately NOT built this pass -- two more separate, large asks from
the same message:**
- **Ball as an independent physical asset during carry/dribble** -- each
  touch giving the ball its own small momentum/travel-ahead-of-the-player
  animation (the player then moving TO the ball to touch it again,
  repeating), plus the carrier sometimes stopping to change direction or
  pass, versus passing on the run. This is a rendering-animation feature
  layered on top of Touches Per Carry's now-real touch DATA, not a data/
  geometry gap -- the underlying touch points already exist for this to
  consume. Not started; needs its own scoped pass.
- **General animation fluidity** -- "animations look rigid, based on
  action tokens... need to be fluid, not cut between actions." This is
  the CSS-transition, discrete-event architecture Animation v0 itself
  established (JS sequences discrete steps, CSS interpolates each one) --
  a real, structural concern, not a quick tweak, and the one this
  session's very first Animation v0 plan already flagged as later-stage
  work ("Improve timing with GSAP or the existing animation system...
  Later replace the renderer with PixiJS without changing the
  simulation"). Not started; likely needs its own dedicated design/
  scoping conversation given the size (potentially a real rendering
  library, not just tuning constants), not something to fold in as a
  side effect of an off-ball AI pass.

### Off-Ball Attacker Awareness v1 (2026-08-18)

Direct follow-up after a 5v5 browser test of Off-Ball Defender Awareness
v1: the defenders now moved, but "none of the ball carrier's teammates
move, they are static." The user's own explicit spec: a marked teammate
should move to find open space; an unmarked one may make a forward run
for a through ball; the run itself should alert the covering defender,
who then chases to stay covered. Built as the direct offensive
counterpart to last round's defensive work, reusing the identical
architecture.

**Built:** two new, fully deterministic functions in `spatialDecision.js`
(no RNG, no `random()` consumed -- same principle every positioning
heuristic in this file already follows):
- **`findSpaceTarget(attackerPoint, nearestDefenderPoint)`** -- a real
  "check away, lose your marker" move: travels `FIND_SPACE_YARDS` (6yd)
  directly away from whoever's marking them, clamped inside the pitch.
- **`forwardRunTarget(attackerPoint, attackingDirection)`** -- a real run
  in behind (`FORWARD_RUN_YARDS`=10yd forward) with a diagonal inward
  bias (`FORWARD_RUN_INWARD_YARDS`=4yd toward the center) so a wide run
  angles into the channel rather than sprinting straight up the
  touchline.
- **`planAttackerRepositioning(attackingTeammates, defenders,
  attackingDirection)`** -- the one decision per teammate, every step:
  marked (a real defender within `ATTACKER_MARKED_RADIUS_YARDS`=7yd) ->
  find space; unmarked -> forward run.

Wired into `runConstructedPossession()`'s own loop, deliberately BEFORE
Off-Ball Defender Awareness's own reposition step (both inside the same
`if (!result.terminal && result.nextOwnerId)` block that already hosts
`GK.ADJUST`/`DEF.ADJUST`) -- this ordering is the entire mechanism behind
"the run alerts the defender": `planDefensiveRepositioning()`'s own cover
target is recomputed fresh from whatever `simulatedRoster` says a
teammate's position is AT THE MOMENT it runs, so a teammate who just
moved is covered against their NEW spot within the very same step,
without anything separately built for "defender reacts to attacker." One
combined `ATT.ADJUST` event per step (not one per teammate --
`playerMoves[]` already supports this), each entry's own `action` field
distinguishing `"find-space"` from `"forward-run"`.

**Verified:** new pure-geometry tests in `tools/test-spatial-decision.mjs`
(`findSpaceTarget` genuinely increases distance from the marker and stays
in-bounds even from a corner, `forwardRunTarget`'s direction/inward bias,
`planAttackerRepositioning`'s marked-vs-unmarked branching and
determinism, and a direct sequential-consistency check reproducing
match-lab.js's own call order -- feeding a defender's cover step the
runner's STALE position vs. their FRESH one produces genuinely different
plans, and the underlying ideal mark shifts in the same direction the
runner actually moved) and three new integration groups in
`tools/test-possession-runner.mjs` (a roughly 5v5 roster produces both
`find-space` and `forward-run` actions across real possessions, teammates'
simulated positions genuinely change, an `ATT.ADJUST` event is confirmed
pushed immediately before that SAME step's own `DEF.ADJUST` -- not merely
present somewhere in the trace, proving the wiring order itself rather
than just its side effect -- authored-roster immutability, Replay
determinism). All 8 suites green.

**No calibration touched** -- every new constant is a reasonable, round,
not-tuned starting point, and no duel/engagement/pass-selection
probability changed; teammates only reposition between actions, same
scope boundary Off-Ball Defender Awareness already established. Nothing
is committed -- over to the user's own browser check.

**Deliberately NOT built this pass** -- attribute-aware movement (a
sharper/faster attacker finding space more effectively), persisted
run-tracking (v1 recomputes marked/unmarked fresh every step rather than
committing to and following through on one specific run), and actually
threading a completed run into pass/cross TARGET SELECTION as a
deliberate through-ball trigger (today a run only helps indirectly, by
changing the geometry `passUtility`/`crossUtility` already read) are all
real future refinements, not started.

### A real keeper-as-teammate bug, and interleaved off-ball reactions (2026-08-18)

A 5v5 browser round on Off-Ball Attacker Awareness v1 surfaced a genuine
bug ("teammate goalkeeper goes out to the midfield?") plus a sharp,
correct architectural observation: "while the ball carrier carries
multiple times, it looks like non-ball-carriers wait for their turn to
move... by this animation logic, game looks like a turn-based game
rather than a fluid game."

**Bug fixed: `freePlayGroups()` never excluded the ball owner's OWN
team's keeper from `teammates`.** Only the OPPOSING keeper was ever
pulled out into its own `.keeper` field; a keeper placed on the
ATTACKING side (any 5v5+ roster) fell straight into the generic
`teammates` bucket -- eligible as an ordinary pass/cross TARGET
(`generateFreePlayCandidates()` reads `groups.teammates` directly, a
PRE-EXISTING bug this exposed as a side effect, not something this pass
introduced) and, once Off-Ball Attacker Awareness existed, sent on
literal forward runs into midfield. Fixed at the source
(`entry.role !== "keeper"` added to the `teammates` filter, mirroring how
`opponents` already excludes the opposing one) so every consumer --
pass/cross selection, Off-Ball Attacker Awareness, Off-Ball Defender
Awareness's own cover logic -- is fixed at once, not patched three times.

**Interleaved off-ball reactions -- the root cause of "turn-based."**
Touches Per Carry gave the ball carrier several real, sequential touch
events per action; Off-Ball Attacker/Defender/Goalkeeper Awareness only
ever reacted ONCE, in a single batch, after the WHOLE action concluded --
the exact mismatch in granularity the user's own diagnosis names
correctly. Fixed by factoring the existing full reposition logic into one
shared `reactOffBall(defendingGroups, ballPoint, trace, { fraction,
duration })` (same `ATT.ADJUST`/`GK.ADJUST`/`DEF.ADJUST` codes, same
`playerMoves[]` shape -- every existing consumer/test keyed off those
codes is unaffected) and calling it TWICE now for a multi-touch carry/
dribble-advance: once, small and fast, interleaved at the rough midpoint
of the touch sequence (`fraction: 0.5`, a 200ms duration matching a
single touch's own pace, not the slower 450ms full-reposition default);
once, full and unconditional, still after the whole action concludes
exactly as before (`fraction: 1`) -- guaranteeing real convergence by the
time the action ends rather than leaving everyone only "approximately"
in position. Deliberately only ONE interleaved nudge per multi-touch
action (not one per touch) -- keeps the added animation time modest
instead of multiplying the event count by touch count.

**A real mutation-safety bug caught building this, fixed before it ever
shipped.** `reactOffBall()` mutates whichever roster entries
`groups.teammates`/`.opponents`/`.keeper` actually point to -- correct
for `runConstructedPossession()`'s own disposable per-possession
`simulatedRoster` clone, but calling it unconditionally from INSIDE
`resolveCarry()`/`resolveDribble()` would have made those resolvers
mutate whatever roster objects ANY caller passed in as a side effect --
including every test in this project that calls them directly against a
hand-built, REUSED fixture (many search loops call these hundreds of
times against the SAME owner/defender objects). Caught immediately by
the existing regression suite (a tackle-range test's shared defender
fixture started silently drifting position across trials). Fixed with an
explicit opt-in: both resolvers take a new `interleaveOffBall` parameter,
defaulting `false` -- interleaving only ever happens for
`runConstructedPossession()`'s own call, which passes `true` because its
`groups` genuinely IS built from a disposable clone meant to be mutated.
Every other existing call site (all of Scenario Probe, every direct test)
is completely unaffected, unchanged in behavior.

**Verified:** all 8 existing suites re-run and confirmed green (a
tackle-range-wiring test briefly caught the mutation bug above before the
opt-in fix landed -- exactly the kind of thing this project's search-loop
test idiom exists to catch). Two new dedicated tests in
`tools/test-possession-runner.mjs`: 500 direct `resolveDribble()` calls
against a shared fixture confirm zero position drift with the default
(no opt-in), and a real `runConstructedPossession()` search confirms an
`ATT.ADJUST`/`GK.ADJUST`/`DEF.ADJUST` event is found genuinely BETWEEN
two touch events in the trace (not merely present somewhere after the
action) -- proving actual interleaving, not just that both event types
coexist. A new test also confirms the own-team-keeper bug fix directly:
`freePlayGroups()` excludes them from `teammates`, no pass/cross
candidate ever targets them, and across 60 real possessions their
simulated position never changes at all.

**No calibration touched.** Nothing is committed -- over to the user's
own browser check to see whether this reads as meaningfully less
turn-based. Full parallel motion (the ball carrier's touches and every
off-ball reaction rendering truly simultaneously, not sequentially with
a short wait between each) is still out of reach within the current
CSS-transition/discrete-event architecture -- that's still backlog item
31's own scope (general animation fluidity), not something this
interleaving pass claims to solve completely, only to measurably improve
within the existing architecture's real constraints.

### Next up, in order

1. Ball -- done (Phase 2 v1).
2. Real passer/ball-owner role -- done (Phase 3).
3. Action-choice + partial-resolution + `runConstructedPossession()` --
   done (Phase 3; possession loop rebuilt into a real bounded multi-action
   runner, 2026-08-16 -- see "Possession Runner v1" above).
4. Free Play as default mode, Scenario Probe demoted, Step hidden for
   single-event traces -- done (Phase 3).
5. Rebound-scramble follow-up (the missing phase found via actual use) --
   done (post-Phase-3 fix).
6. Spatial Intelligence Lite (engagement threshold, real target selection,
   zone/pressure weighting) -- done (Phase 4).
7. Store the full run as `lastRun = { seed, setupSnapshot, result, trace }`
   rather than only `lastTrace` -- done (Possession Runner v1, 2026-08-16).
8. Upstream progression duel for Dribble / Tackle & Foul -- done
   (second browser round, 2026-08-13).
9. `resolveWall()` recalibration (wall-size blindness, empty-wall phantom
   0.3 baseline, taker-skill ceiling) -- done (free-kick chain audit,
   2026-08-13).
10. Free Kick probe's missing rebound-scramble phase -- done (free-kick
    chain audit, 2026-08-13).
11. Live Signals inspector team/distance filter, pitch marker team color --
    done (second browser round, 2026-08-13).
12. Empty-net accuracy context boost (separate, higher ceiling for a
    genuinely open net, not just guaranteeing on-target = goal) -- real,
    smaller follow-up. Not started.
13. Scenario Probe UI hint clarifying ball position/ownership has no effect
    outside Free Play -- done (second browser round, 2026-08-13).
14. Real distance/angle modeling for free kicks (resolveWall,
    resolveFreeKickAttempt, resolveKeeperSave's hardcoded zone 1) --
    confirmed genuine, but new engine design work spanning the live tick
    loop and all three functions, not a calibration pass. Not started; not
    yet asked for.
15. `resolveKeeperSave()` free-kick-specific contextMultiplier + KEEPER_
    DUEL_LABELS (fk-regular/fk-hard/fk-curl) -- done (shot-conversion
    calibration, 2026-08-14), scoped to direct free kicks only per review.
    `tools/keeper_save_audit.mjs` rebuilt as permanent tooling
    (`npm run match:keeper-audit`) with a full stage breakdown (wall
    clearance, on-target, clean keeper-beaten, rebound goals, total
    conversion) per skill-tier pairing.
16. Broader contextMultiplier for open-play shots and all header paths
    (open-play cross, corner, FK-cross) -- built, verified (open-play
    stayed flat in that pass' audit too), but deliberately NOT merged this
    round per review: a first pass should isolate free kicks only so
    cause-and-effect stays provable by construction, not just by
    after-the-fact audit. Preserved intact on branch
    `wip/broad-shot-context-multiplier`. Ready to resume as its own
    separately-audited pass if wanted.
17. Exceptional-tier taker vs. an elite keeper specifically still lands
    below its real-world reference band (6.18% vs. target 12-15%) even
    after correctly counting rebound goals -- every other tier/pairing in
    the matrix now lands at or near band. Root cause not yet
    re-investigated after the rebound-counting fix (the earlier
    coefficient-vs-ceiling analysis was against the clean-only numbers, so
    it may no longer be the accurate diagnosis). Not started; not chased
    this round per the user's own instruction not to tune toward a
    predetermined percentage.
18. Hand the outer possession loop a real next action after a loose ball,
    a keeper parry, or an in-play block, instead of ending the possession
    there -- the gap flagged in "Possession Runner v1" above (2026-08-16).
    Not started; needed before Training Drills-style loose-ball drills
    (rondo, cone recoveries) can sit on top of this infrastructure
    honestly.
19. Thread `state.attackingDirection` through shot/cross target-selection
    geometry (`goalPointFor()`/`missPointFor()`), not just dribble
    progression -- flagged in "Possession Runner v1" above (2026-08-16) as
    out of this pass's scope. Not started.
20. Re-audit shot-conversion calibration once the animation/trace contract
    is fully trustworthy -- two findings logged and explicitly not acted
    on so far: catch-weight dominance plus `executionQuality` not being
    threaded into `resolveTargetedKeeperResponse()` (stabilization pass,
    2026-08-16 section above), and the exceptional-vs-elite-keeper gap
    (item 17). Not started; two separate, still-open calibration questions
    to fold into the same re-audit rather than tuning either in isolation.
21. Training Drills mode (goal-target zones, cones/mannequins, El Rondo,
    secondary free-kick takers with fake runs/lay-offs) -- documented as
    reusing the Possession Runner's bounded-loop/transition-contract/
    attacking-direction/per-step-RNG infrastructure directly (see
    "Possession Runner v1" above). Not started; not yet asked for as an
    implementation task, only flagged as the intended next consumer of
    this infrastructure.
22. A real match-engine-awareness system: defender recovery time / being
    wrong-footed after losing a duel, so a beaten defender isn't
    immediately as eligible to re-engage as if nothing happened --
    flagged explicitly in "Possession Runner v1 -- Pass 1.1" above
    (2026-08-16) as real engine-level work (would need to apply to actual
    matches too), deliberately NOT invented inside Match Lab's animation
    layer. Not started; not yet scoped -- needs its own design pass before
    implementation, likely alongside the wider "player AI awareness"
    direction already noted for Training Drills.
23. A pass reception's own marker doesn't visibly travel to a genuine
    knock-forward advance (only the ball does) -- done (narrow
    correctness pass, 2026-08-16, fix 4: explicit `mover`/`moveTo` on
    `traceEvent()`, set only for the genuine-advance case, never for a
    lost reception).
24. `resolveDribble()`'s successful-dribble advance (`P.PROGRESS.WON`)
    still uses `advanceTowardGoal()` -- the same vertical-only-toward-the-
    byline defect Directional Carry Planning (2026-08-17) just fixed for
    carry, left in place deliberately per explicit instruction so that
    pass could land and be verified first. Not started; flagged as the
    next related item -- likely reuses `planCarryDestination()`-shaped
    machinery (progression/angle/pressure/path-obstruction/byline
    scoring), probably extended to also factor in the beaten defender's
    own position (which carry's planning doesn't need to, since carry is
    only ever offered when nobody is in duel range at all).
25. An "expected-success"/"action-affinity" utility term so real
    execution attributes (Passing/Technique, Crossing, Finishing,
    Dribbling) can shape WHICH candidate wins a Spatial Decision
    Intelligence v1 choice, not just how well it executes once chosen --
    scoped in `spatialDecision.js`'s own header comment (2026-08-17) as
    v1's explicit ability-blindness limitation. Not started; needs its
    own deliberate design pass (the constraint: read those attributes
    only to build this new term, never let it touch `executionRandom` or
    a real resolver's own attribute reads, or it silently reintroduces
    the attribute-compounding problem the perception/execution split
    exists to prevent).
26. Cross Resolution Pass B -- dynamic aerial positioning and defender
    recovery (2026-08-18 scope; NARROWED by Contact, Ownership &
    Continuation, 2026-08-18 -- see that section). Authoritative
    `playerMoves` for the receiver/defender converging on the delivery's
    landing point is now DONE (both shown genuinely moving there, contact
    resolved exactly at that point, the following header/continuation
    beginning from it). What's still missing: replace the static aerial
    boolean with a real ARRIVAL-TIME model -- a projected landing point
    and attacker/defender arrival times that can genuinely differ by
    player speed (Off the Ball/Anticipation/Decisions/Acceleration/Pace/
    Agility/Balance/Jumping/Heading for the attacker; Positioning/
    Marking/Anticipation/Decisions/Acceleration/Pace/Agility/Strength/
    Bravery/Jumping for the defender) rather than both simply converging
    on a point neither of them had to race for; and a real beaten-
    defender recovery/chase action (Pace/Acceleration/Agility/
    Anticipation/Work Rate/Determination) whose result feeds the
    FOLLOWING decision (now that a following decision genuinely exists --
    `resolveAerialClearanceContinuation()` -- this has a real consumer for
    the first time). Not started; depends on Pass A's real landing point
    (done) as its own input.
27. Cross Resolution Pass C -- goalkeeper command of crosses (2026-08-18
    scope). A real stay/claim/punch/uncertain decision inserted BEFORE
    the attacker/defender header contest, using cross height/pace/curl/
    landing point/keeper distance/traffic/interception time alongside
    Aerial Ability/Command Of Area/Communication/Handling/Rushing
    Out/Tendency To Punch/Decisions/Anticipation/Positioning/Bravery/
    Jumping/Eccentricity; new `GK.CROSS.*` outcome codes (STAY/
    CLAIM.CLEAN/CLAIM.FUMBLE/PUNCH.CLEAR/PUNCH.LOOSE/MISS/FLICK, COLLISION
    later if fouls are supported); catch/punch/miss must move the keeper
    to the real contact point. Not started; depends on Pass B's own
    arrival-time model (landing point plus attacker/defender arrival) as
    an input to the keeper's own decision.
28. Carry "gait" differentiation -- PARTIALLY done (Touches Per Carry,
    2026-08-18): `determineCarryGait()`/`planCarryTouches()` now break an
    already-planned carry/dribble-advance into real nimble/jog/sprint
    touches along its OWN path, with real, visibly different spacing per
    gait. What's still NOT done: the DESTINATION distance itself is still
    the same fixed `CARRY_FORWARD_YARDS`/`CARRY_SHORT_YARDS` (10/5 yards)
    regardless of gait -- a genuinely open, sprinting carry doesn't yet
    cover more total ground than a nimble one, only more/fewer touches
    over the SAME distance. A self-contained extension to Directional
    Carry Planning's own candidate generation (`spatialDecision.js`'s
    `carryDestinationCandidates()`/`planCarryDestination()`) would close
    this -- likely crossing gait with the existing forward/short/diagonal
    directions so open space also plans a LONGER run, not just a
    differently-touched one. Not started.
29. General outfield (non-keeper) off-ball awareness -- v1 DONE (Off-Ball
    Defender Awareness v1, 2026-08-18): `planDefensiveRepositioning()`
    gives the nearest defender a real press role and every other
    defender a real cover role (goal-side of the nearest uncovered
    attacking teammate), with a genuine lone-carrier swarm case, wired
    into the possession loop exactly like the keeper's own `GK.ADJUST`.
    What's still NOT built: any of this is ATTRIBUTE-aware (a sharper/
    faster defender reading the situation quicker or marking tighter --
    deliberately deferred, same ability-blind v1 principle Spatial
    Decision Intelligence's own utilities use); "jockeying" as its own
    distinct behavior (v1's presser always closes ground, never holds
    off at a controlled distance to delay without committing); tracking
    a specific attacking RUN (v1 assigns cover by nearest-uncovered-
    teammate each step, not a persisted marking assignment that follows
    one specific player); and true team-shape concepts (compactness,
    offside line, a covering defender BEHIND the presser rather than
    just goal-side of whoever they're marking). Real future work if the
    v1 heuristic doesn't read well enough in practice.
30. Ball as an independent physical asset during carry/dribble
    (2026-08-18 report). Each real touch (Touches Per Carry) should give
    the ball its own small momentum -- travels ahead of the player in the
    touch's own direction, the carrier then visibly moves TO the ball to
    touch it again, repeating per touch -- plus real branching the
    carrier can take mid-carry: stop and change direction, stop and pass,
    or pass while still moving. A rendering-animation feature layered on
    top of already-real touch DATA (this pass's own `P.CARRY.TOUCH`/
    `P.PROGRESS.TOUCH` waypoints already exist for it to consume), not a
    data/geometry gap. Not started; needs its own scoped pass.
31. General animation fluidity (2026-08-18 report) -- "animations look
    rigid, based on action tokens... need to be fluid, not cut between
    actions." The CSS-transition, discrete-event architecture Animation
    v0 itself established (JS sequences discrete steps, CSS interpolates
    each one) is a real, structural constraint here, not a quick tweak --
    this session's very first Animation v0 plan already flagged
    "Improve timing with GSAP or the existing animation system... Later
    replace the renderer with PixiJS without changing the simulation" as
    later-stage work, after contact/ownership correctness (now done).
    Not started; likely needs its own dedicated design/scoping
    conversation given the size (potentially a real rendering library),
    not something to fold into an off-ball AI or ball-physics pass.
32. Off-Ball Attacker Awareness refinements (2026-08-18) -- v1 DONE (see
    that section above: find-space vs. forward-run, wired to genuinely
    alert the covering defender within the same step). What's still NOT
    built: attribute-aware movement (a sharper/faster attacker finding
    space more effectively -- deliberately deferred, same ability-blind
    v1 principle as everywhere else); persisted run-tracking (v1
    recomputes marked/unmarked fresh every step rather than committing
    to and following through on one specific run before re-evaluating);
    and actually threading a completed run into pass/cross TARGET
    SELECTION as a deliberate through-ball trigger (today a run only
    helps indirectly, via the geometry `passUtility`/`crossUtility`
    already read). Real future work if v1 doesn't read well enough in
    practice.

## Timeline Playback v1 (2026-08-18)

### Root cause and contract audit

- The previous browser controller advanced one resolved trace event at a
  time with an independent `setTimeout`, then asked CSS transitions (and a
  separate ball `requestAnimationFrame` path) to animate that one event.
  This made valid `playerMoves[]` data look turn-based: a carrier completed
  a touch before off-ball reactions began, aerial players started moving
  only after the cross arrived, and rebound runners waited for the parry.
- The trace already had authoritative ball endpoints and multi-player
  movement for carries, aerial contests and rebound races, but it did not
  state contact phase or ownership transitions consistently. Contact phase
  (`start` for an outgoing kick/header/save/clearance, `end` for an incoming
  aerial/recovery/block) and optional `ownerBeforeId`/`ownerAfterId` fields
  now come from resolver call sites. The playback planner does not parse
  labels or use visual proximity to manufacture either fact.
- Two producing-logic contradictions were corrected. A clearance no longer
  moves the defender marker to the clearance endpoint; only the ball takes
  that path. Bringing an aerial ball down is now a `control` contact, not a
  `clearance`. Consecutive carry/dribble touches now record each mover's
  real previous waypoint (`moveFrom`) instead of repeatedly claiming the
  authored starting spot. Existing rebound misses already end ownerless with the
  declared `goal-kick`, and the new plan validator enforces ownerless
  restarted final states.

### Renderer-independent plan

- `src/lib/matchLabPlayback.js` converts a resolved trace plus authored
  starting positions into a deeply frozen plan containing ball/player/
  ownership tracks, contacts, cues, event intervals, semantic boundaries,
  duration and final owner/restart state. It is DOM-free and consumes no
  RNG.
- Explicit `overlapWithPrevious` producer metadata lets interleaved
  attacker/keeper/defender repositioning share the carrier's touch window.
  An end-phase stationary contact aligns its participant approaches with
  the preceding delivery/parry window, so receiver and aerial defender run
  during the cross and eligible rebound participants run during the parry.
- Ball paths are continuous across event boundaries. Multi-leg save/post
  paths remain multi-leg, and foot/contact-authored shot curl is sampled
  deterministically into the ball track. The planner rejects disconnected
  ball segments, disconnected player origins, actor/ball contact mismatch,
  or a restarted final state that still names an owner.

### Shared-clock browser playback

- Match Lab now creates one plan after `Resolve & Play`/`New Outcome` and
  samples every player and the ball from one `requestAnimationFrame` clock.
  The authored `state.roster` remains immutable; only DOM marker custom
  properties and the separate `playbackPositions` view are updated.
- `Play/Pause` freezes/resumes plan time, `Replay` seeks the same plan to
  zero without resolving or rolling again, `New Outcome` is the only
  control here that changes the seed, `Step` seeks exactly to the next
  contact/event boundary, and `Back to Setup` destroys the clock and
  rebuilds the authored setup.
- Positional tracks are authoritative because every destination is supplied
  by the resolved trace. Pulses, badges, trail drawing, sound and linear/
  Bezier interpolation are cosmetic presentation only and never change
  ownership, contacts, restarts or results.

### Verification and bounded limitations

- `tools/test-timeline-playback.mjs` covers byte-equivalent deterministic
  plans, fixture immutability, replay-without-RNG, pause isolation, exact
  semantic stepping, simultaneous carry/off-ball and cross/parry movement,
  contact continuity, defensive control labeling and out-of-play ownership.
- `tools/test-contact-continuity.mjs` additionally compiles real resolved
  cross/aerial/defensive-continuation traces into validated playback plans.
  The existing resolver/distribution suites remain the guard against result
  code or probability drift.
- This is visually concurrent playback of an already-resolved discrete
  simulation, not a simultaneous tactical simulation. It does not add an
  aerial arrival-time contest, keeper claim/punch decisions, a beaten-
  defender recovery state, persisted marking/runs, or new gameplay
  randomness. A crosser/closer/keeper without a resolver-authorized
  positional destination may receive a cosmetic cue but is not moved to an
  invented point. Those gameplay additions remain separate future passes.

## Offside & Off-Ball Intelligence v1 (2026-08-17)

### Why attackers reached the goal line

- The first off-ball pass independently classified every unmarked attacker as
  a forward runner after every live action. `forwardRunTarget()` only respected
  the pitch boundary, so repeated reactions inevitably walked several players
  to `y = 0` or `y = 100` even when the defensive line and ball made that run
  illegal or tactically pointless.
- Off-ball movement is now allocated at team level. At most one eligible
  attacker breaks the line in a reaction; the others hold it, marked players
  find space, and players already beyond the legal line recover onside. Targets
  are constrained by the ball/second-last-opponent line and retain a six-yard
  goal-line safety margin as a final geometry guard.

### Pure offside geometry

- `src/lib/matchOffside.js` owns the DOM-free rule calculation. It derives the
  second-last-opponent line in either attacking direction, treating the keeper
  as an ordinary opponent for this calculation rather than assuming the keeper
  must be the last defender.
- A player is in an offside position only when in the opponents' half and,
  within a 0.5-yard tolerance, nearer the goal line than both the ball and the
  second-last opponent. Level, behind-the-ball and own-half positions remain
  onside. Throw-ins, corners and goal kicks are represented as direct-restart
  exemptions; other restarts are not exempt.
- The result is a frozen kick-time snapshot containing attacker, ball and
  defender-line coordinates plus the relevant IDs. The renderer never derives
  a ruling from where an animation happens to be when it paints a frame.

### Decision and resolution contract

- Free-play candidate generation removes an offside intended receiver from
  pass/cross choices and attaches the snapshot to every eligible offered
  delivery. This prevents the action selector from deliberately choosing a
  known-illegal target.
- Direct resolver calls remain authoritative and defensive: `resolvePass()` and
  `resolveCross()` validate the intended receiver at the moment of contact. A
  violation emits `P.OFFSIDE.FLAG`, ends ownerless and awards an indirect free
  kick. A cross stopped by a source tackle/block never reaches that kick-time
  check and therefore cannot manufacture an offside offence.
- An intended receiver on a directed pass/cross is treated as becoming involved
  in active play. This bounded v1 does not flag uninvolved teammates merely for
  standing in an offside position.

### Verification and intentionally deferred phases

- `tools/test-offside.mjs` covers both attacking directions, keeper-inclusive
  second-last lines, own-half/behind-ball/level positions, restart exemptions,
  candidate filtering, single-runner allocation, hold/recover targets,
  determinism and fixture immutability.
- `tools/test-possession-runner.mjs` exercises authoritative pass/cross flags,
  frozen kick-time evidence and source-contest precedence through the real
  resolvers. The spatial, possession, cross, continuity and timeline suites
  remain regression coverage around the change.
- Deferred work is explicit: persistent run intentions and arrival timing,
  coordinated through balls, a defender line/trap controller, passive-player
  interference, rebounds or deliberate-defender-play phase resets, delayed
  whistle/advantage handling and VAR-style review. Those need their own state
  contracts rather than being inferred cosmetically during playback.

## Motion v1 (2026-08-18)

### Producer-side cause of rigid movement

- Timeline Playback v1 had already separated resolution from rendering and
  sampled an immutable plan from one `requestAnimationFrame` clock. The
  remaining rigidity was upstream: every off-ball reaction discarded its
  previous intention, moved between only two endpoints, and planned attackers
  before mutating the shared roster that defenders subsequently read. Smooth
  rendering faithfully exposed those discrete producer decisions.
- `reactOffBall()` now captures one immutable world snapshot, calculates
  attacker, keeper and defender proposals against that same snapshot, then
  commits every accepted destination atomically. A defender observes a run on
  the next reaction rather than reading a partially-written same-tick world.

### Persistent intentions and locomotion texture

- `src/lib/matchMotion.js` owns a per-possession motion state separate from the
  authored roster. Each player carries an intention (action, role, tactical
  target, start tick and age) plus their previous velocity. Compatible,
  unreached intentions remain committed for a short three-reaction horizon and
  absorb target changes gradually; `recover-onside` always interrupts them.
  A player omitted from a reaction loses stale velocity rather than resuming a
  sprint after standing still.
- Tactical intent and immediate movement are distinct. Spatial planners now
  expose an uncapped `intentionTarget` plus the existing safe per-reaction
  endpoint. Motion may retain the former but can never advance farther in one
  reaction than the fresh spatial plan authorized.
- Every accepted move produces six deterministic position/velocity samples.
  Pace, Acceleration and Agility alter acceleration, arrival speed and turning
  texture only; they cannot change the tactical endpoint, consume RNG or alter
  an action resolver's success roll.

### Goal-aware escape and velocity-aware playback

- A marked attacker no longer has only one direction-blind "directly away"
  answer. `findSpaceTargetForAttack()` scores forward, channel, lateral and
  check-short candidates against separation from every defender, progression
  and pitch-boundary loss. Retreat remains possible when it genuinely creates
  the best space, but a goal-side marker does not automatically drive the
  attacker away from goal.
- Trace `playerMoves[]` may now carry the motion samples and intention evidence.
  `matchLabPlayback.js` maps those samples into the immutable player tracks and
  uses cubic Hermite interpolation only where both adjacent frames provide
  velocities. Ball/carrier tracks without authored motion data retain their
  existing interpolation, preventing cosmetic easing from separating a player
  from a controlled ball. Authoritative endpoints and contact validation are
  unchanged.

### Verification and scope boundary

- `tools/test-match-motion.mjs` covers deterministic batches, input
  immutability, persistent/interruptible intentions, multi-sample in-bounds
  trajectories, attribute-dependent texture with identical endpoints, carried
  velocity, curved playback and exact final arrival.
- Spatial tests cover the mirrored goal-aware escape rule and explain the new
  same-snapshot contract. The real possession integration suite confirms that
  authored traces contain velocity-bearing trajectories, retain an intention
  across reactions, compile 80 complete possessions and leave the authored
  setup unchanged.
- This is a bounded bridge over the existing event resolver, not yet a full
  22-player fixed-tick simulation. Ball-carrier locomotion, collision avoidance,
  formation/role anchors, arrival-time interceptions, long-lived coordinated
  runs, a rolling interruption buffer, tactical checkpoints and Worker
  extraction remain later phases. None should be inferred by the renderer.

## Independent Ball Core v1 (2026-08-18)

- `src/lib/matchBallCore.js` gives the ball its own position, horizontal and
  vertical velocity, height, ownership phase and last-touch identity. Player
  markers are no longer the source of ball coordinates during playback.
- Every ball-carrying trace event now authors an explicit ball trajectory.
  Ground touches jump ahead of the carrier and decelerate under grass drag;
  passes roll independently; shots, crosses, headers and clearances use aerial
  arcs; live parry/post rebounds receive a smaller second bounce. Resolver
  contact and restart endpoints remain authoritative.
- An outfielder's controlled ball rests just ahead of their marker, while a
  goalkeeper may hold it on the marker. The visual ball is now 8px, matching
  its role as a separate object rather than a second player badge.
- `ballState` is passed into free-play spatial groups, so kick-time offside and
  later decision layers can read the ball's real location instead of assuming
  it is the owner's body position. Ownerless outcomes run a deterministic
  distance/Pace/Anticipation recovery race toward a velocity- and turf-drag-
  projected interception point rather than the ball's stale current point.
- A successful tackle, interception or keeper collection no longer ends the
  constructed sequence merely because the isolated resolver returns
  `terminal: true`. A real next owner starts the next action; the sequence ends
  on an actual restart (throw-in, corner, goal kick, free kick/kickoff), no
  available action, or the 16-action safety cap. Any new owner's travel to the
  contact point is explicitly traced rather than silently teleported.
- Playback now zeros player velocity at tactical movement boundaries. This
  prevents Hermite interpolation from drifting a stationary player away from
  a later ball contact during the idle interval between actions.
- `tools/test-ball-core.mjs` covers drag, touch lead, aerial height, bounce,
  held/loose state, recovery and independent playback sampling. The possession
  suite additionally proves that a tackle turnover continues until a genuine
  restart and that 80 complete real traces retain contact continuity.

This is an independent event-trajectory core, not yet a continuous rigid-body
solver. Spin, player-ball collision impulses, wind, exact turf coefficients
and a fixed-tick 22-player simulation remain later work; they belong in this
producer layer, never as renderer guesses.

## Continuous duel flow correction (2026-08-18)

- Declarative trace entries with no physical change (`ACTION.CHOICE`,
  `P.PROGRESS`, `D.STAND`/`D.SLIDE`, finish-type announcements and equivalent
  neutral cues) are now explicitly tagged `timelineRole: "cue"` with zero
  duration. They remain in commentary but add no frozen 400-500ms interval.
- A zero-time cue never replaces the timeline's last real physical interval.
  Post-action attacker, defender and goalkeeper adjustments therefore overlap
  the actual touch/tackle/pass window, not a zero-length declaration after it.
- The resolved tackle remains a real interval and reveals its contact and
  possession transition at the end. A winning defender converges on that
  contact point while surrounding players continue their simultaneous motion.
- Ambient authored motion now continues through terminal physical intervals as
  well. A foul, corner, goal kick or goal stops players at the whistle/ball-out
  instant, not at the beginning of the preceding tackle or flight. Direct
  resolver participants are excluded from this ambient batch so a keeper,
  tackler or ball carrier is never double-animated.
- A stationary tackle/reception ball is classified as controlled at the feet,
  not rolling loose. This removes the visible snap from the outfielder's
  in-front ball position back into the center of their marker while a defender
  merely announces an engagement choice.
- Possession-runner sections 39-40 fix the reported sequence as invariants:
  three decision lines add no dead time, the physical duel still lasts 400ms,
  ambient movement shares that window, the ball remains controlled, and even a
  terminal free-kick whistle adds no frozen or post-whistle interval.

## Explicit world frame and restart contract (2026-08-18)

- Shot geometry no longer infers a player's attacking goal from `entry.y`.
  `goalFrameFor()` resolves attacking and defending goal lines from the team's
  declared `state.attackingDirection`; goal, post, net, miss, rebound and
  keeper-beaten helpers all inherit that one frame. A goalkeeper or defender
  standing in their own half therefore cannot accidentally aim at their own
  goal.
- `keeperSaveTransition()` makes `KEEPER_SAVE_PRESENTATION` authoritative for
  both presentation and play state. `K.SAVE.3` and `K.SAVE.7` now produce a
  dead-ball corner with no owner; `K.SAVE.1` and `K.SAVE.4` remain held keeper
  possession; rebound and goal outcomes retain their distinct contracts. The
  four previous hand-written save branches now use this shared adapter.
- Candidate generation now has an explicit goalkeeper role gate: a keeper in
  possession receives teammate-distribution candidates only, never the generic
  outfield shoot/carry/dribble/cross tree. Outfield shots beyond normal range
  are also structurally unavailable unless Long Shots/Shooting and Technique
  support an ambitious attempt.
- Spatial tests cover the role/range gates. Possession-runner section 41
  reproduces the reported keeper-in-own-half geometry and checks every held vs
  corner-producing save transition. This is the first bounded perception/world
  frame; attribute-scaled perceived-vs-actual snapshots and a fully shared
  candidate-scoring library remain the next architectural phase.

## Canonical pitch geometry and Goalkeeper Handling foundation (2026-08-18)

- `src/lib/pitchGeometry.js` is now the single simulation source for the
  rendered 75 x 120 yard pitch. The previous `68 x 105` constants were
  standard metre dimensions accidentally labelled as yards. Spatial distance,
  offside tolerance, goal width and forward movement now share the same world
  as the CSS markings and SVG tracks. A regression proves ten yards across and
  ten yards lengthwise both measure exactly ten world yards.
- The same module makes the 18 x 44 yard penalty area, six-yard box and penalty
  spot expressible in engine code. `isInsideOwnPenaltyArea()` requires an
  explicit attacking direction and therefore never infers a keeper's own goal
  from the half in which their marker happens to stand.
- `src/lib/keeperHandling.js` adds the law-level `canKeeperHandle()` contract:
  opponent touches and accidental teammate deflections permit handling;
  deliberate teammate foot passes, teammate throw-ins and collecting the
  keeper's own release do not; handling is impossible outside the keeper's own
  box. It also names the `keeper-holding` and `keeper-at-feet` phases and the
  future action vocabulary for each.
- Ball state now carries a structured last touch (`playerId`, `team`, body
  part, deliberate/deflection and restart) alongside legacy `lastTouchId`.
  Trace contacts normalize this once in the producer layer, and possession
  transitions read the latest contact-bearing event rather than assuming the
  last event with a visible ball flight was also the last touch.
- The existing goalkeeper candidate role gate remains the currently supported
  runtime action set: distribution passes only, never generic outfield
  shoot/carry/dribble/cross. Dedicated throw/roll/punt/hold/release and
  pass-long/clear resolvers are intentionally not fabricated before their
  execution and transition contracts exist.

`tools/test-keeper-handling.mjs` covers pitch isotropy, box boundaries,
backpass/throw-in/deflection/own-release law cases, phase classification and
last-touch persistence. Player posture/recovery and active goalkeeper rushing
remain later simulation phases; neither belongs in the renderer.

## Keeper identity and off-ball separation (2026-08-18)

- `freePlayGroups()` now returns `ownKeepers[]` and `opposingKeepers[]`.
  `teammates[]` and `opponents[]` are strictly outfield players; the legacy
  singular `keeper` remains only as the first opposing shot/save target while
  resolver signatures migrate. A second goalkeeper can no longer be silently
  demoted into defensive planning or selected as a generic dribble opponent.
- Every off-ball goalkeeper on both teams is passed through
  `keeperPositioningPoint()` during the same atomic reaction. The possession
  side's keeper therefore adjusts relative to their own goal rather than
  disappearing from all groups, and malformed historical multi-keeper setups
  preserve every keeper's role. Free Play's role/team controls now refuse a
  second goalkeeper on one team with a named validation message.
- `applyOffBallSeparation()` operates on proposed targets immediately before
  `resolveMotionBatch()`. Targets are compared in canonical yard space;
  same-team players inside an eight-yard floor receive deterministic
  equal-and-opposite corrections, including a stable exact-overlap rule.
  Opposing teams are never separated, so genuine tackles and contested-ball
  convergence remain possible. Stationary teammates also repel a proposal,
  preventing a runner from targeting an occupied spot.
- `ATT.ADJUST`, `DEF.ADJUST` and `GK.ADJUST` commentary now names every moving
  player and their authored job (`runs in behind`, `presses the ball`, `drops
  into cover`, `holds the goalkeeper line`, etc.). Multi-player atomic batches
  remain one simultaneous trace interval, but no longer hide behind generic
  statements such as “The defense adjusts its shape.”
- Possession-runner section 42 covers keeper arrays on both teams, malformed
  duplicate-keeper safety, UI conflict detection, all-keeper movement,
  role-safe candidate generation, named jobs, same-team separation and
  opponent convergence. Spatial tests independently prove that even malformed
  input cannot expose a keeper as a generic duel/dribble target.

Formation anchors, joint exclusive job assignment, and posture-based beaten-
defender/slide recovery remain the next tactical-state phases. Separation is
the immediate anti-flocking constraint, not a substitute for those systems.
## Player kinetics and attribute-wired carry geometry (2026-08-18)

Claude's "Ball independence, attribute wiring, and attribution logging"
review was checked against the current code before changing it. The pre-change
baseline was genuinely flat: Dribbling ratings 1/5/10/15/20 all produced the
same eight carry waypoints byte-for-byte. The ball core already authored a
decelerating independent trajectory between each pair of contacts, however;
the remaining immediate defect was the uniform, player-blind contact plan and
the fixed controlled-ball fallback, not a total absence of ball trajectories.

This pass adds `src/lib/playerKinetics.js` as the one pure physical vocabulary:
`topSpeed`, `timeToTopSpeed`, `timeToReach`, `reachIn`, `turnRetention`,
`reigniteFactor`, `touchThreshold`, and `touchError`. Motion authoring and
loose-ball recovery read these functions rather than maintaining their own
Pace/Acceleration formula. Resolver success probabilities remain untouched.

`planCarryTouches()` now accepts the actual carrier, pressure, and a stable
possession-derived seed. Dribbling changes contact distance; Dribbling plus
Technique changes the lateral error envelope; pressure widens it. Segment
lengths use deterministic per-index variation, so contacts are no longer a
metronome while replay remains byte-identical and consumes no gameplay RNG.
The carry planner's tactical destination is still authoritative and unchanged.
Each touch carries rating-10 baseline/actual attribution records, shown behind
an "Attribute influence" disclosure in the event trace.

`npm run attr:sweep -- --runs 2000 --attr Dribbling` (npm 11 on Windows may
print argument-rewrite warnings; the harness accepts the rewritten positional
form too) measures fixed-seed Pace, Acceleration, Agility, Dribbling, and
Technique responses and fails if the relevant physical response is not
monotonic. Unit/integration coverage lives in
`tools/test-player-kinetics.mjs`, `tools/test-spatial-decision.mjs`,
`tools/test-ball-core.mjs`, `tools/test-match-motion.mjs`, and
`tools/test-possession-runner.mjs`.

Not claimed by this pass: the idle controlled-ball fallback is still a fixed
front-of-player display offset after a trajectory finishes, and tackle/duel
ownership still resolves at a discrete boundary. A genuine timed contest
interval with null ownership and overlapping convergence remains the next,
larger state-contract change; it should not be simulated cosmetically in the
renderer.

## Duel contact and per-touch motion audit (2026-08-18)

The “Aldair slid from ten yards / off-ball stutter / nobody passes” review was
checked against runtime code rather than applied wholesale.

- A real defect was confirmed in tackle presentation: the resolver selected a
  defender and declared an engagement without authoring that defender's path to
  the ball. A tackle now has two physical intervals. First, the defender moves
  from their current coordinate to the carrier's contact point. Then a distinct
  `T.WON.CONTROL`, `T.BEATEN.ESCAPE`, or `T.LOOSE.DEFLECT` interval moves the
  player/ball away from contact according to the resolved outcome. Fouls remain
  at the contact point.
- Explicit `playerMoves` are now committed to the possession's simulated roster
  after every resolver. They were previously consumed by playback but not
  consistently by the next simulation decision, allowing the picture and the
  engine to disagree about where a challenger or aerial contestant stood.
- Off-ball reactions now run after every authored carry/dribble touch and share
  that touch's duration. This replaces sparse midpoint-only reactions without
  renderer extrapolation: the renderer still interpolates only between
  authoritative endpoints and never invents a future tactical position.
- The reported square/back-pass offside failure was not present. The shared
  offside snapshot already requires a receiver to be beyond both the ball and
  the second-last opponent; `tools/test-offside.mjs` proves a receiver behind
  the ball remains a legal generated pass candidate. That correct rule was left
  unchanged.
- Attribute-disclosure rendering now accepts the canonical producer keys plus
  diagnostic aliases and supplies visible fallback values for incomplete data,
  so a malformed attribution record cannot create an empty list item. Asset
  versions were advanced to prevent a stale browser module from hiding the
  change.

Possession-runner sections 35 and 43-44 cover reaction windows between every
touch, defender-to-contact convergence, a separate non-stationary post-contact
ball reaction, playback continuity, and attribution rendering. The full
timeline, contact, ball-core, motion, spatial, kinetics and offside suites pass.

Time-normalized candidate utility remains a valid future direction, but is not
silently approximated here. Candidate scoring currently lacks one common,
calibrated success-probability/threat contract across pass, carry, dribble and
shot; dividing today's unrelated heuristic scores by guessed durations would
change football decisions without making them more truthful. Build that shared
contract first, measure candidate distributions, then tune value per second.

## Off-Ball Movement v1 — coached jobs and observability (2026-08-18)

The SIA/Soccer Interaction coaching model has been translated into the current
authoritative movement pipeline in three bounded layers.

### Joint job assignment

`planAttackerRepositioning()` no longer gives every teammate the same binary
marked/find-space vs unmarked/run question. From one immutable world snapshot it
allocates complementary jobs:

- at most one `run-in-behind`, selected only from onside runners who can win the
  projected arrival race;
- one `support-short`, selected by distance to the carrier;
- a wide player may claim `hold-width`;
- a marked player can claim `diagonal-inside`;
- remaining advanced players `pin-last-line` without being forced to move.

`planDefensiveRepositioning()` likewise allocates exactly one `press-ball`.
Supporting defenders claim `cover`, `screen-lane`, and unique `mark` subjects;
surplus defenders `shift-unit` instead of flocking onto a lone carrier. A lane
screen targets a real point on a named carrier-to-receiver lane and is not
silently treated as a tackle attempt.

Trace commentary uses these coaching names. A zero-distance `pin-last-line` is
retained as a zero-time `ATT.ADJUST` cue, making positional discipline visible
without manufacturing a movement track or extending the timeline.

### Projected arrival

`claimable()` consumes the shared `timeToReach()` kinetics function. Pace and
Acceleration determine travel time; Off the Ball and Anticipation provide the
runner's start-time advantage; defenders receive their own Anticipation-scaled
read time. A run is offered only if the attacker establishes the configured
0.4-second arrival lead. This changes target eligibility, not resolver outcome
RNG, and remains deterministic for Replay.

### Passing-option KPI

Every `ACTION.CHOICE` now records `decisionOptionMetrics()` from the exact legal
candidate list consumed by the chooser:

- distinct legal passing options;
- pressure at the carrier;
- friendly/opponent counts inside 15 yards;
- resulting local overload.

The readable trace includes the legal-pass count. `runConstructedPossession()`
returns every sample plus possession-level mean/minimum passing options and mean
decision pressure; `lastRun` preserves both structures for future Match Lab UI
and aggregate tooling. No geometry is reconstructed from playback markers.

Unit coverage verifies exclusive press/run/support assignments, lane-screen
geometry, the anticipation-vs-pace arrival distinction, held pins, and legal
option counting. Possession-runner sections 45-46 verify trace/aggregate KPI
identity and explicit zero-movement job commentary.

Not claimed yet: `drag-away`, `clear-the-zone`, and altruistic overload scoring
require the proposed team-value surface with a projected defensive response.
Adding those labels to a self-destination heuristic would preserve the original
modeling error under better vocabulary. The grid/control/threat contract should
be built and measured as its own phase. The 5v2 rondo is likewise the next
isolated harness once that shared surface can score support movement; it should
not be faked by disabling all existing actions and choosing an arbitrary pass
target.

## Pass/carry/shot decision correction (2026-08-18)

A follow-up review identified four claims. Two were current defects, while two
described older code and were not applied blindly.

- Confirmed: successful `P.PROGRESS.WON` used `advanceTowardGoal()`, which copied
  x verbatim and could only move vertically. It now asks
  `planCarryDestination()` for the best adjacent escape lane, then caps that
  vector at the dribble-specific eight yards. A straight exit remains possible
  when it is genuinely best; it is no longer mechanically compulsory.
- Confirmed: although directional carry planning already evaluated concrete
  destinations, its score included large absolute open-space/destination
  rewards. On a representative open-midfield snapshot with two clean forward
  passes, the sharp-player chooser selected carry 1000/1000 seeded trials.
  `carryUtility(owner, destination, ...)` now scores the change between two
  world states: forward yards and pressure relief minus destination pressure,
  lane obstruction, and a fixed-rate ball-transport time cost. It can be
  negative. The same frozen sample now selects pass 849/1000 and carry 151/1000.
- Confirmed: `shootUtility()` gave a full lane bonus at any distance. Lane value
  now decays with the existing range relevance, so an empty sparse-roster ray
  does not turn a central 42-yard attempt into a good shot.
- Already fixed before this review: square/backward passes are not rejected by
  offside; the receiver must be beyond the ball. Carry destination pressure,
  path obstruction, angle change, and concrete `moveTo` feedback were also
  already present. The correction removed their competing absolute rewards
  rather than reimplementing those terms.

Decision telemetry now aggregates selected pass/carry/shot counts and mean shot
distance in addition to legal-option and pressure samples. Spatial regressions
require a pressured/obstructed carry to become negative, clean forward passes to
win at least 70% of the representative seeded decisions, and a clear 42-yard
lane to remain low-value. Possession regression verifies a successful dribble
can leave the vertical axis while retaining its exact eight-yard canonical
distance.

The 12-zone execution boundary remains real but is not the cause of the
pass/carry chooser defect: `spatialDecision.js` already makes that choice from
exact 75x120-yard coordinates. `localizedDuel()`, `resolveKeeperSave()`, fouls,
and parts of reception still consume coarse zone context after an action has
been selected. Replacing that production resolver contract requires a separate
coordinate-context API plus before/after outcome telemetry; changing zone ids or
quietly multiplying save odds in Match Lab would only create a divergent second
engine.

## Hold-Up Play, Shielding & Attribute-Aware Ball Retention (2026-08-18)

A browser round reported that off-ball attackers still made no forward runs,
passing felt underused, and — the round's central complaint — several
attributes appeared to have no effect at all: "there is no such thing as
holding the ball," "there is no shielding the ball," "a low strength but high
agility and dribbling player is nimble," and "I do not know if any of the
attributes matter in these scenarios." A large amount of Timeline Playback,
offside, ball-physics, and off-ball-awareness infrastructure had landed
concurrently from a separate tool invocation (Codex CLI, on the same user's
instruction) in the interim; the first step was auditing that work directly
rather than assuming any of it was the cause. It was not — the off-ball
run/pass gates it built (`MAX_LINE_BREAK_RUNNERS`, `claimable()`'s arrival-race
gate, `PASS_UTILITY_WEIGHTS`) are real, already-identified, deliberately tight
defaults, not regressions, and are left untouched here as a separate,
not-yet-scoped calibration pass. What follows closes the two structural gaps
that were genuinely missing.

- **Fixed: `dribbleUtility()` ignored the defender entirely.** The function
  took a `defender` parameter it never read (`void defender`), so a carrier's
  decision to attempt a dribble was blind to how dangerous the defender
  actually was — only geometry (progression toward goal) mattered. It now adds
  a real danger term from `pressureAt(owner, [defender])`:
  `0.2 + progression * 0.5 - danger * 0.6`. A defender standing on top of the
  carrier can now drive this below zero, where before the same position was
  indistinguishable from an empty pitch. Ability-blind by design, matching
  every other utility in this file — this is a geometry bug fix, not backlog
  item 25's larger "does the CHOICE itself weigh attributes" question, which
  remains open (see below).
- **New: an explicit, scoped attribute-wired escape duel.** `resolveDribble()`
  in `match-lab.js` (Free Play's own resolver, not production) now calls
  `localizedDuel()` with `["Passing", "Technique", "Decisions", "Teamwork",
  "Agility", "Dribbling"]` for the attacker and `["Positioning",
  "Anticipation", "Tackling", "Decisions", "Strength"]` for the defender —
  deliberately asymmetric (Agility/Dribbling only help the attacker escape;
  Strength only helps the defender hold the challenge), matching the user's
  own framing of a nimble player against a chunkier opponent. This is a real,
  flagged divergence from production, verified safe two ways: `localizedDuel`/
  `duelAttribute` (`matchEngineCore.js`) are already attribute-list-agnostic
  (they just average whichever labels are passed), and `draft-run.js`'s own
  `transitionDuel` call site — the actual production tick loop — was read
  directly and is untouched, still using the original four-attribute lists.
  The Scenario Probe's "tackle-foul" scenario also intentionally stays on the
  original lists, since its own stated purpose is mirroring production, not
  Free Play's decision layer.
- **New: Hold-Up Play v1 + Shielding v1.** Free Play previously forced every
  decision into pass/cross/dribble/carry/shoot — there was no "stop and wait
  for support" option at all. `holdUtility(owner, teammates, opponents)`
  (`spatialDecision.js`) scores a new `"hold"` candidate that
  `generateFreePlayCandidates()` now always offers (subject to the same
  goalkeeper role gate as every other candidate): a support bonus when a
  teammate is within 15 yards, a pressure penalty otherwise, ability-blind
  like `dribbleUtility()`. `resolveHold()` (`match-lab.js`) is the execution
  half: uncontested when nobody is within duel range (a real, costless
  `P.HOLD` pause, ball never leaves the holder's feet), or — when a defender
  is close enough to challenge — a genuinely new Strength/Balance/Composure
  vs. Strength/Aggression/Tackling `localizedDuel()` contest
  (`P.HOLD.SHIELD` → `P.HOLD.SHIELD.WON`/`P.HOLD.SHIELD.LOST`), with no
  equivalent in production to stay faithful to since this is genuinely new
  Match-Lab-only ground. A lost shield is a real, terminal turnover to the
  challenger, contact/ownership fields populated the same way every other
  two-player contact event in this file already is (`phase: "end"`, explicit
  `ownerBefore`/`ownerAfter`/`ownerAfterAt`).
- **Test coverage added**, all passing alongside the full existing 14-suite
  regression: `tools/test-spatial-decision.mjs` gets direct, deterministic
  unit coverage of `dribbleUtility()`'s danger sensitivity (including that a
  point-blank defender now drops utility below the old unconditional floor)
  and `holdUtility()`'s support/pressure sensitivity (no RNG involved, so
  every assertion is exact-value, not distributional), plus a structural
  check that `"hold"` is now always offered except to goalkeepers.
  `tools/test-possession-runner.mjs` adds end-to-end coverage of
  `resolveHold()` (uncontested / won-shield / lost-shield paths, searched by
  seed, asserting exact contact/ownership/trace-code shape for each) and a
  win-rate comparison proving the attribute-wired duel actually changes
  outcomes: a nimble attacker (high Agility/Dribbling, low Strength) escapes
  a fixed chunky defender measurably more often than an otherwise-identical
  clumsy one (57% vs. 45% over 400 seeded trials), and a fixed clumsy
  attacker escapes a physically weak defender measurably more often than an
  equally-skilled but Strength-heavy one (49% vs. 42% over 1500 seeded
  trials — a real but smaller margin, since Strength is only one of five
  terms on the defender's side of the average).

**Deliberately not touched in this pass** (scoped out, not overlooked):

- **Passing feels underused.** `PASS_UTILITY_WEIGHTS` is a real, separate
  calibration question flagged directly above (2026-08-18 pass/carry/shot
  section) and is its own rebalancing pass, not a wiring bug.
- **Off-ball attackers still rarely make forward runs.** Traced to
  `planAttackerRepositioning()`'s own tight, deliberate gates
  (`MAX_LINE_BREAK_RUNNERS = 1`, the `claimable()` arrival-race requirement) —
  working as designed, not broken, but a real candidate for loosening in a
  future, separately-scoped round.
- **Per-touch ball momentum during an ongoing carry.** Already Codex's own
  documented backlog item — `matchBallCore.js` is explicitly "not yet a
  continuous rigid-body solver."
- **Backlog item 25 ("action-affinity"/"expected-success").** The larger,
  still-open question of whether execution attributes (Passing, Technique,
  Dribbling, Finishing) should influence which ACTION gets chosen, not just
  how it resolves once chosen. This pass wired attributes into two EXECUTION
  duels (the escape, the shield); it deliberately left the ability-blind
  DECISION layer (`dribbleUtility`, `holdUtility`, every other `*Utility()`
  function) untouched, to avoid conflating a scoped bug fix with that larger,
  already-named architectural change.

## Cross geometry fix + Through Ball v1 (2026-08-18)

Two further browser reports, both root-caused directly.

**Bug: crosses weren't bounded to real crossing geometry.** A cross was
delivered from a wide-midfield position (zone 5) to a teammate standing in
the same wide-midfield band (zone 4) — nowhere near the box — who then headed
it at goal from ~35+ real yards out. Two independent defects compounded:

- `isCrossPosition()` (the crosser's own gate) measured straight-line
  distance to the goal's CENTER, capped at 45 yards. That metric conflates
  width and depth: a player standing right on the byline, wide, is ALREADY
  ~30-38 yards from goal-center purely from the lateral offset, so a 45-yard
  cap left 10-15 yards of pure DEPTH slack — a player 40+ yards up the pitch
  from the byline could still pass the check as long as they were also wide.
  Fixed to measure real DEPTH from the goal line (`Math.abs(p.y - goal.y)`),
  capped at 35 yards, independent of the lateral gate.
- The RECEIVER's own position was never checked at all — `generateFreePlayCandidates()`
  offered "cross" to every teammate once the crosser's own position passed
  `isCrossPosition()`, regardless of where that teammate stood. New exported
  `isCrossTargetZone(point, attackingDirection)` (`spatialDecision.js`) gates
  on the real 18x44-yard penalty area (`pitchGeometry.js`'s own
  `PENALTY_AREA_DEPTH_YARDS`/`PENALTY_AREA_WIDTH_YARDS`, not a re-invented
  number) plus a small 4-yard margin for a runner arriving just as the ball
  does. A cross candidate now requires both gates: a real crosser position
  AND a real, in-the-box target.
- Defense in depth: `resolveCross()` itself now re-checks
  `isCrossTargetZone()` at the actual landing point before calling
  `resolveFinishAttempt("header", ...)`. If a won aerial happens beyond
  realistic heading range (reachable from Scenario Probe or any caller that
  stages its own geometry, not just Free Play), the receiver now controls the
  ball (`X1.CONTROL`, non-terminal, possession retained) instead of
  attempting a header at goal — the same behavior the reporting round asked
  for directly ("Rodolfo should have controlled the ball and gone for a
  run... or try his chances on goal").

**New: Through Ball v1.** A separate report: a defender who intercepted a
pass immediately shot from distance, while a teammate was already making a
central, onside run in behind that would have put them one-on-one with the
keeper — "Alen Boksic could've waited for him... and delivered it as a
through ball." Investigation found there was no through-ball CONCEPT: `passUtility()`
only ever scores a teammate's CURRENT position, never the space they're
running into, so the decision layer had no way to recognize "feed the run"
as a distinct option from "pass to where they already are" (which correctly
scores low — marked, behind the play).

- `generateFreePlayCandidates()` now calls `planAttackerRepositioning()`
  directly — the SAME vetted, tested arrival-race job assignment
  (`claimable()`, `MAX_LINE_BREAK_RUNNERS`, onside-at-kick) that already
  drives `ATT.ADJUST` off-ball movement, not a second, parallel heuristic —
  and if any teammate is assigned `"run-in-behind"`, offers exactly one
  `"through"` candidate targeting that job's own `intentionTarget` (the real
  forward destination of the run, not the capped per-step animation point).
  Since the underlying job is only ever assigned to a real, onside,
  race-winning runner, the candidate is only ever offered when the
  opportunity is genuine.
- New `throughBallUtility(owner, targetPoint, opponents, attackingDirection)`
  scores delivery to the SPACE, weighting progression heavily — a genuine
  line-breaking ball produces a much bigger forward gain than a routine pass,
  and should read as such against a mediocre long-range shot.
- New `resolveThroughBall()` (`match-lab.js`, registered as `FREE_PLAY_RESOLVERS.through`):
  offside is judged at the kick, against the runner's CURRENT position (correct in
  law, and consistent with every other resolver's own "recalculate rather
  than trust candidate-generation state" contract) — never the forward
  target. A defender sitting in the passing LANE (not at the target, which
  is unmarked by construction) can still cut the ball out via a real
  `localizedDuel()`. Because the arrival race was already won structurally
  by `claimable()` at candidate-generation time, a clean delivery is a clean
  first touch — no second race is re-run at the target point. A successful
  through ball hands non-terminal possession to the runner at the space
  (`P.THROUGH.RECEIVE`), which naturally re-enters the same Free Play
  decision loop for their very next touch — deliberately not a bespoke
  "shoot or dribble" sub-decision bolted onto this resolver, since the
  existing shoot/carry/pass scoring already handles "what to do from here"
  correctly once the geometry has genuinely improved.

Both fixes verified with zero regressions across the full 14-suite
regression, plus new dedicated coverage: `tools/test-spatial-decision.mjs`
covers `isCrossTargetZone()`'s real box geometry, the reported "same-band"
cross bug directly reproduced and confirmed fixed, `throughBallUtility()`'s
progression/pressure sensitivity, and that a `"through"` candidate is offered
exactly when (and only when) a real run-in-behind job exists.
`tools/test-possession-runner.mjs` covers `resolveThroughBall()`'s three
paths end to end (clean delivery with explicit mover/ownership fields,
offside-at-kick reusing the same fixture as the existing pass-offside
coverage, and a searched lane-interceptor contest with both outcomes) using
`FREE_PLAY_RESOLVERS.through` directly.

Not addressed here: `holdUtility()` was deliberately left unchanged. With a
real through-ball option now available, the ball owner can feed a live run
the instant the lane opens rather than needing to "hold and wait" for it —
the reported scenario is resolved by the new candidate itself, not by making
holding more attractive. A future round could still consider a "hold to let
a deeper, not-yet-live run develop" refinement, but that's a distinct
mechanic from what either report actually asked for.

## Ball independence (visual) + Quick Setup formations (2026-08-19)

Three further browser reports.

**Ball marker offset.** The ball was drawn essentially inside the
controlling player's own circle -- most visible right at a possession
change, which read as "too bad looking" (a tackle won at close range moved
the ball marker only a few PERCENT of pitch width/length, invisible next to
a fixed 22px player dot). Root cause: the existing `controlledBallPosition()`
(`matchBallCore.js`) nudge is real, physically-grounded ball-physics data
(~1.5 real yards, i.e. ~1.55% of pitch dimensions) used elsewhere for
trajectory/loose-ball geometry -- deliberately NOT something to inflate
globally just to look right on screen, since that would quietly change real
gameplay distances other engine code depends on. Fixed with a strictly
cosmetic, PIXEL-based offset instead: `restingBallOffsetPx()` (`match-lab.js`)
reuses `controlledBallPosition()`'s own DIRECTION only (velocity-based in
motion, attackingDirection-based at rest), discards its percent-space
magnitude, and rescales to a fixed 18px -- large enough to clear a 22px
player dot's own 11px radius plus the ball's own 4px radius on any screen
size, since it's expressed in real pixels, not a percentage of a variable-
width container. Applied via a new `--ball-rest-x/y` CSS custom property on
the standalone `translate` property (not folded into `.match-lab-marker-ball`'s
existing `transform`, so it composes cleanly -- the same technique
`[data-cosmetic="true"]` already used for exactly this reason), at all three
places the ball is drawn resting on a player: the static `renderPitch()`
view, `startDrag()`'s owner-follow-while-dragging logic, and
`renderPlaybackFrame()` (the ACTIVE Timeline Playback v1 renderer --
confirmed directly, by finding zero live call sites, that the older
`applyStepAnimation()`/`animateBallAlongCurve()`/`animateBallAlongSegments()`
system is dead code, fully superseded but left in place and still covered by
its own pre-existing tests, so intentionally left untouched here). Two
exceptions, both already true for free: a goalkeeper holding it (`ownerRole
=== "keeper"` returns zero offset, both in `controlledBallPosition()` itself
and redundantly in `restingBallOffsetPx()`) and a ball genuinely in the air
(a header is contested at head height, directly on the player -- the offset
only ever applies when `snapshot.ball.mode === "controlled-ground"`, which a
real aerial/flight mode never is). A future round could add a throw-in
hand-hold exception the same way, once throw-ins exist at all.

**Quick Setup formations.** `quickSetupMatch()` previously filled every
outfield slot from one undifferentiated random pool -- no defender/
midfielder/attacker distinction existed anywhere in it. Rebuilt around an
explicit, user-specified per-format role table (`outfieldSlotsFor()`):
2v2 stays genuinely random (1 outfielder/team, no room for a split); 3v3
keeps one attacker/team fixed and a single shared coin flip decides whether
the other outfielder/team is a defender or midfielder (one flip, not one
per team, so both sides get the same shape); 5v5/7v7/9v9/11v11 use the
exact specified totals (e.g. 11v11: 8 defenders + 8 midfielders + 4
attackers across both teams, split evenly). Real position data drives
selection, not another random draw: `classifyOutfieldBand()` reuses
`matchEngineCore.js`'s own production `isDefender`/`isMidfielder`/
`isAttacker` classifiers (the same functions the live match tick loop
already trusts for coarse role checks, reading each candidate's real
`position_text`) rather than guessing at the retroball API's own `positions`
query-parameter vocabulary beyond the already-proven `"GK"` value. Outfield
candidates are also now filtered against `isGoalkeeper()` before being
eligible for any outfield slot -- the other half of "do not put outfielders
as GKs or vice versa," tightening a latent gap the previous unfiltered pool
had. Placement gained real per-band depth ranges (`OUTFIELD_BAND_DEPTH_RANGES`:
defenders deep, midfielders central, attackers advanced, mirrored correctly
for either attacking direction) layered onto the existing simple two-band
spread -- still "a reasonable starting shape for a possession runner," not
an authored tactical formation with real width/channel assignments. Two new
buttons added (`match-lab.html`): 7v7 and 9v9 and 11v11.

Both features verified with zero regressions across the full 14-suite
regression, plus new dedicated coverage in `tools/test-possession-runner.mjs`:
`outfieldSlotsFor()`'s exact role counts and even home/away split for every
format, `classifyOutfieldBand()`'s dispatch against `matchEngineCore.js`'s
own documented bounded tokens (with a safe "midfielder" fallback for
unclassifiable input asserted explicitly), and `restingBallOffsetPx()`'s
keeper/null exceptions, direction sensitivity, and minimum real-pixel
magnitude. `quickSetupMatch()` itself remains untested end-to-end (as
before this change) -- it depends on a live `fetch()` to the retroball API,
which every test file in this project explicitly stubs to fail fast and
offline; this was already true of the pre-existing 2v2/3v3/5v5 behavior.

## Ball-transition smoothing, formation width, and Off-Ball Attribute Awareness v1 (2026-08-19)

A same-day follow-up round, three further reports against the work above.

**Possession-change ball transition still looked instant.** The 18px rest
offset (above) fixed the ball reading as "inside the player circle," but a
possession change still looked like an instant teleport between one
player's circle edge and the other's. Root cause: `--ball-rest-x/y`'s
`translate` transition had been added conditionally, under
`[data-animating="true"]` -- but nothing in the currently-active Timeline
Playback v1 render path (`renderPlaybackFrame`) ever sets that attribute
(confirmed: it's exclusively written by the dead `applyStepAnimation`
system). The rest-offset therefore snapped every frame with zero
interpolation. Fixed by making the `translate` transition on
`.match-lab-marker-ball` unconditional instead -- safe specifically because
`--ball-rest-x/y` only actually changes value at the rare, discrete instant
possession changes hands (it holds bit-for-bit steady across ordinary
frames, since its direction depends only on team/attacking-direction, not
on anything that changes continuously), unlike `--marker-x/y` itself, which
updates every rAF frame from the continuously-sampled ball track and must
stay transition-free to avoid visibly lagging the true sampled position.

**Quick Setup formations clustered instead of spreading.** Every
outfielder's lateral (x) position was drawn fully independently at random,
regardless of how many teammates shared their depth band -- for the larger
formats (7v7/9v9/11v11) this had a real, reported chance of several
same-band players landing in the same zone by pure chance while whole
flanks sat empty. Fixed with `lateralChannelX()`: each player within a band
now claims a distinct lateral channel (the pitch width divided evenly by
how many teammates share that band), with jitter inside the channel so it
still reads as organic placement rather than a rigid grid. A lone player in
their band (2v2's single random outfielder, or any band with just one per
team) keeps the original fully-free spread -- channeling a group of one is
meaningless.

**Off-Ball Attribute Awareness v1.** Directly requested: Off the Ball,
Positioning, Marking, Anticipation, Work Rate, Stamina, and Decisions
should determine "how accurate the player positions" are, with a genuinely
good off-the-ball attacker breaking free more easily than an average one.
Investigation found `claimable()` (the run-in-behind arrival race) and
`lineBreakingScore()` (which candidate runner gets picked) already read
Off the Ball/Anticipation/Decisions in part -- real, pre-existing coverage,
not something to duplicate. The genuine gap was the GEOMETRY itself:
`findSpaceTargetForAttack()` (a marked attacker's escape run) and
`coveringPositionPoint()` (a defender's marking standoff) were both 100%
ability-blind, fixed-radius constants regardless of who was involved.

- `attackingHeadStartSeconds()` (claimable()'s own attacker-side head
  start) extended from a 2-attribute (Off the Ball/Anticipation) to a
  3-attribute average adding Decisions, matching lineBreakingScore()'s own
  attribute set.
- New `offBallReadingQuality(player)` (Off the Ball/Anticipation/Decisions)
  scales `findSpaceTargetForAttack()`'s own search radius 0.7x-1.3x -- a
  genuinely good off-the-ball attacker searches wider and finds real
  separation a weaker one, searching the same fixed radius every time,
  would miss.
- New `markingTightnessQuality(player)` (Positioning/Marking/Anticipation)
  scales `coveringPositionPoint()`'s own standoff distance 1.3x-0.7x
  (inverted -- a better marker plays TIGHTER, not wider) -- the direct
  defensive counterpart to the same contest.
- New `effortQuality(player)`/`effortScaledAdvance()` (Work Rate/Stamina)
  scales the real per-step advance cap both `planAttackerRepositioning()`
  and `planDefensiveRepositioning()` already use (0.75x-1.25x) -- physical
  capacity to keep making the right recovery/support run, distinct from
  the cognitive "read it early" quality above.
- Deliberately NOT extended: `defendingHeadStartSeconds()` (the arrival-
  race defender side) stays Anticipation-only. A first attempt folded in
  Positioning/Marking there too and broke an existing test -- unrated
  Positioning/Marking fall back to a moderate CA-based baseline proxy that
  read as a STRONGER defender than one with a real, deliberately low
  Anticipation rating, fighting `markingTightnessQuality()` for the same
  two attributes across two different mechanics. Anticipation alone
  (recognizing danger early -- a cognitive head start) and
  Positioning/Marking (the steady-state quality of the mark itself, via
  `coveringPositionPoint()`) now each own a single, distinct mechanic
  instead of double-counting.

All three verified against the full 14-suite regression (one existing
fixture -- the arrival-race acceptance test's own "clever" archetype --
needed an explicit Decisions rating added to stay internally consistent
with its own "clever runner" framing, once Decisions became part of the
race calculation), plus new dedicated coverage in
`tools/test-spatial-decision.mjs`: `findSpaceTargetForAttack()`'s and
`coveringPositionPoint()`'s attribute sensitivity (both directions of the
same contest), and `effortScaledAdvance()`'s real per-step ground-covered
difference on an identical, far-away target (isolating the CAP, not a
different destination) for both attacking and defensive repositioning.

## Ball-transition direction, label decluttering, Defensive Shape Discipline v1 (2026-08-19)

A same-day follow-up round, three further reports.

**Possession-change ball transition moved only vertically.** The 18px rest
offset's direction had been borrowed from `controlledBallPosition()`'s own
static fallback -- deliberately axis-only for ITS purpose (a single dribble
touch's forward nudge), but reused for the rest-offset's direction it made
every possession change move the ball along a single fixed axis regardless
of where either player actually stood, reported directly as feeling buggy.
`restingBallOffsetPx()` now computes its own real 2D vector -- from the
player's own position toward the CENTER of the goal they're attacking --
varying meaningfully by lateral position (a wide player's vector angles
sharply inward; a central player's stays close to vertical), not just by
team. `controlledBallPosition` is no longer imported into `match-lab.js`
at all -- this was its only remaining use there.

**Label decluttering.** New `#labShowLabelsCheckbox` (`match-lab.html`),
off by default: only the current ball owner's own name label stays
visible; every other player's fades out over a real CSS opacity
transition (`--data-label-visible`, `styles.css`), never `hidden`/
`display:none`, which can't transition. `updateLabelVisibility()`
(`match-lab.js`) is the one function that ever writes the attribute --
called from `renderPitch()` (static setup), every `renderPlaybackFrame()`
tick (so a possession change during playback fades the OLD owner's label
out and the new one in, live), and the checkbox's own change handler
(reading a small tracked `currentLabelOwnerId`, so toggling mid-playback
reflects the truth regardless of whether playback is running, paused, or
hasn't started -- deliberately never calls `renderPitch()` to refresh,
since that tears down and rebuilds every marker mid-animation).

**Defensive Shape Discipline v1.** Directly requested: most real teams
hold a back four (or back three) as a genuine horizontal line; defensive
positioning should be attribute-dependent, with a lower-Positioning
defender visibly losing their line. Scoped to the back line specifically
-- the more variable midfield shapes the same report described (a flat
four; 2 deep + 3 forward; 4 flat + two strikers) are deliberately NOT
built here, since which shape a midfield actually holds depends on
tactical decisions this project doesn't model at all yet (formation/
instructions), and guessing at that mapping would be worse than leaving it
documented as real, scoped-out follow-up work.

- `classifyOutfieldBand()` moved from `match-lab.js` (where Quick Setup
  built it) into `spatialDecision.js` and exported -- it's now the
  authoritative "who's actually a defender" signal for
  `planDefensiveRepositioning()` too, reading each player's REAL position
  (`position_text` via `matchEngineCore.js`'s own `isDefender`), not
  wherever they currently happen to be standing. `match-lab.js` now
  imports it instead of keeping a second copy.
- New `backLineSlots()`: every defender classified as the back line gets
  one evenly-spaced lateral slot across a real back-four/back-three width
  (`BACK_LINE_WIDTH_YARDS`), at a shared depth that reacts to the ball
  (`backLineDepthYards()` -- pushed higher when it's far away, dropped
  deep when danger is close, clamped to a real, bounded band). Only wired
  into the `"shift-unit"` job (a spare defender with nobody left to press,
  cover, or mark) -- `"cover"`/`"screen-lane"`/`"mark"` stay exactly as
  they were, since actively stepping out of the line to contest a real
  threat is correct defending, not a bug to fix.
- New `positioningDisciplineQuality(player)` -- Positioning ONLY,
  deliberately not blended with Marking/Anticipation the way
  `markingTightnessQuality()` is (a distinct mechanic per the user's own
  naming: shape discipline vs. man-marking tightness). A defender's actual
  target is blended away from their correct slot, toward the ball, by
  `(1 - positioningDisciplineQuality) * BACK_LINE_DRIFT_MAX_FRACTION` --
  perfect Positioning sits exactly on the slot; poor Positioning is
  measurably dragged out of the line. Deterministic, not noise -- matches
  every other positioning heuristic in this file's own "no randomness"
  principle.

All three verified against the full 14-suite regression (zero
regressions, including through the `classifyOutfieldBand()` relocation),
plus new dedicated coverage: `tools/test-possession-runner.mjs` covers
`restingBallOffsetPx()`'s new lateral sensitivity (mirrored wide-left/
wide-right positions, constant total magnitude); `tools/test-spatial-decision.mjs`
covers a real five-defender back line spreading into distinct, non-
overlapping slots, and a direct high- vs. low-Positioning comparison
proving the drift is real and measurable, not cosmetic.

## Through Ball v1: real delivery accuracy (2026-08-19)

A follow-up report: Resolve & Play's first action was almost always a
through ball, landing exactly on the intended point every single time
regardless of distance or passer skill, with the receiver then arriving at
that exact same point too -- reported directly as unrealistic ("it should
not be on point every time").

Root cause: Through Ball v1 (above) delivered straight to
`availability.plannedMoveTo` with zero spatial error, and the receiver
simply met the ball at that same exact coordinate -- there was no accuracy
model at all for this new pass shape, unlike crosses (which already run
through `resolveCrossDelivery()` + `deliveryLandingPoint()`).

- New `resolveThroughBallAccuracy(passer, { distanceYards, pressureFactor }, random)`
  (`match-lab.js`) -- mirrors `resolveCrossDelivery()`'s own shape (skill
  vs. distance/pressure penalties -> a bounded accuracy error) but with
  passing-appropriate attributes (Passing/Vision/Technique/Decisions, not
  Crossing -- a through ball is a driven/lofted pass, not an aerial
  delivery into the box). Match-Lab-only, same as Through Ball itself (no
  production twin to stay faithful to).
- `resolveThroughBall()` now runs the intended target through the already-
  proven `deliveryLandingPoint()` (`spatialDecision.js`, the same function
  crosses already use) to get a real landing point, and the receiver
  adjusts their run to meet the ball wherever it ACTUALLY lands, not the
  originally-planned space. The lane-interceptor geometry deliberately
  still reads off the ORIGINAL intended target -- a defender reacts to
  where the ball is aimed as it's struck, not to a resting spot that
  doesn't exist yet.
- Deliberately NOT built here: re-running `claimable()`'s own arrival-race
  check against the corrected (post-error) landing point. The error is
  bounded (0-10 yards, scaled down further by real passer skill) and
  `claimable()` already required a genuine arrival-time margin against the
  original target before this candidate was ever offered at all -- a
  proper "does the error erase that margin" model is real, scoped-out
  follow-up work, not something to improvise into this pass.

Verified against the full 14-suite regression -- one existing test
("possession is retained... at the SPACE") had asserted the landing point
exactly equalled the intended target, which is no longer true by design;
updated to assert the landing stays within 12 real yards of the target
(comfortably above the resolver's own 10-yard error ceiling) instead of an
exact match. New dedicated coverage: a genuinely strong passer (Passing/
Vision/Technique/Decisions) averages measurably less landing error than a
weak one over 200 seeded trials each; even the strong passer produces real,
non-zero error across a real sample (the reported bug's own symptom,
directly disproven); identical seeds still reproduce identical landing
points (deterministic, not fresh randomness per render).

## Marking distance realism + Vision cone overlay v1 (2026-08-19)

**Defenders reading as "too stuck to their opponents."** `COVER_STANDOFF_YARDS`
(the base distance `coveringPositionPoint()` uses for both `"cover"` and
`"mark"` jobs) was 4 real yards -- standing-tackle-adjacent distance,
appropriate for someone actively jockeying a live threat, not the base
spacing most of a passage of play actually looks like. Bumped to 7 yards
(still scaled 0.7x-1.3x by `markingTightnessQuality()` exactly as before),
giving a real ~5-9 yard range instead of ~3-5. One existing test's own
assumed bounds were calibrated to the old, tighter value and needed
updating to match.

**Vision cone overlay v1.** Directly requested: a toggled field-of-view
overlay for the current ball owner, scaled by their real Vision rating
(1-20), with a "forgetting" mechanic when possession moves on -- the
outgoing owner's own picture of the pitch should fade away over time
rather than vanish instantly, more slowly for a sharper player. This is a
diagnostic/explanatory overlay only: nothing it computes is ever read by a
resolver or decision function, and it has no effect on which pass gets
chosen or how anything resolves -- purely a browser-side "why did/didn't
the engine see that pass" visualization.

- New `#labShowVisionCheckbox` (`match-lab.html`), off by default, gating
  a new `.ml-pitch-vision-layer` SVG layer (same 75x120-yard viewBox
  convention as the existing touch/trail layers, so angles drawn into it
  are geometrically undistorted by the pitch's non-square aspect ratio).
- `buildVisionConePath()` draws a real SVG pie-slice (`M` to the origin,
  `L` to one edge, an `A` arc across to the other edge, `Z` to close) --
  direction is the same "toward the center of the goal being attacked"
  convention the ball-rest-offset fix (above) already established, kept
  consistent across both features. `visionConeRadiusYards()`/
  `visionConeHalfAngleRad()` scale the cone's reach and width together
  (25-60 yards, 20-60 degree half-angle) from a single `visionQuality()`
  read of the Vision attribute -- "higher value covers higher area,"
  exactly as specified.
- Two path elements, not one: `#labVisionConeCurrent` always sits exactly
  on the present ball owner, no fade. The instant possession changes
  hands, `updateVisionCone()` parks the CURRENT cone's own last shape
  (frozen, exactly where and how it was) into `#labVisionConeFading`, then
  fades it out over `visionFadeDurationMs()` -- scaled by the OUTGOING
  owner's own Vision, never the incoming one's, so a sharper player's
  mental picture measurably lingers longer (500-3000ms range). The
  snap-to-1-then-fade-to-0 sequencing uses a `requestAnimationFrame` deferral
  (a CSS transition can't animate a change written in the same tick it's
  observed).
- Wired into all three places ownership-driven visuals already update
  this session (`renderPitch()`, `renderPlaybackFrame()`'s own per-frame
  sampling, and the checkbox's own toggle) -- the cone tracks the owner's
  live position during playback, not just their authored starting spot.

Verified against the full 14-suite regression (one existing
`coveringPositionPoint()` test's bounds updated for the new standoff
value, as above). New dedicated coverage: `visionConeRadiusYards()`/
`visionConeHalfAngleRad()`/`visionFadeDurationMs()`'s Vision sensitivity
and determinism, and `buildVisionConePath()`'s real SVG shape (a genuine
arc command, a closed path, the correct yard-space origin, and a
genuinely different path for the two attacking directions).

## Scanning v1 (2026-08-19)

Directly requested, naming Riquelme/Ronaldinho/Pirlo: elite Vision/
Decisions players don't hold one fixed gaze -- they check their shoulder
before the ball even arrives, and keep sweeping their head while they're
on it, reading support runs, runs in behind, and an approaching opponent.
Builds directly on the vision cone (above).

- New `scanQuality(player)` -- Vision AND Decisions together (named
  together explicitly), not Vision alone, matching how
  `lineBreakingScore()`/`attackingHeadStartSeconds()` already pair the
  same two attributes elsewhere in this project for a comparable
  "reads the game early" trait.
- **On-ball sweep**: `scanAmplitudeRad()`/`scanPeriodMs()`/`scanOffsetRad()`
  drive a real back-and-forth sweep of the CURRENT cone's own direction,
  layered on top of the existing "toward goal" base angle. Amplitude
  scales continuously with quality (0 exactly at the attribute floor, up
  to 45 degrees at the ceiling) rather than a hard on/off gate, matching
  every other attribute-scaled heuristic this session; period scales the
  other way (a sharper player checks MORE often, 900-2600ms per full
  cycle). Driven by the sampled playback clock (`snapshot.timeMs`), not
  wall-clock time -- pausing genuinely pauses the sweep, Replay reproduces
  an identical one.
- **Anticipatory scan ("before the ball comes to them")**: a new third
  cone, `#labVisionConeAnticipating` (a distinct dashed/amber style),
  shown for a pass/cross/through-ball's own named receiver while the
  ball is genuinely still in flight toward them -- found by reading the
  currently-visible trace event's own `targetId` against
  `snapshot.ownerId` (still `null` throughout a delivery's flight, since
  `ownerAfter` isn't asserted until the reception event -- exactly the
  signal that makes "not yet received" cheap and correct to detect).
  Unlike the on-ball sweep, this DOES gate entirely
  (`ANTICIPATION_SCAN_THRESHOLD`) -- "scans before it even arrives" reads
  as a genuinely distinctive trait of the named caliber of player, not a
  universal one every receiver does.
- A real bug caught before it shipped: `scanQuality()`'s first draft
  called a module-level `average()` helper that was never imported into
  `match-lab.js` at all -- `node --check` (syntax-only) didn't catch it;
  only actually running the test suite did. Fixed by inlining the
  two-value average directly rather than adding an import for one call
  site. Flagged here as a reminder that syntax-checking alone doesn't
  prove new code runs -- this project's own test suites are what actually
  exercise it.

Verified against the full 14-suite regression, plus new dedicated
coverage: `scanQuality()`'s dependence on BOTH attributes together (a
lopsided elite-Vision/poor-Decisions player reads as merely middling, not
elite), `scanAmplitudeRad()`/`scanPeriodMs()`'s continuous scaling and
exact-zero floor behavior, `scanOffsetRad()`'s actual sine-wave shape
(zero at t=0, +amplitude at a quarter cycle, -amplitude at three-quarters,
back to zero after a full cycle) and determinism, and confirmation that a
real scan offset actually changes the rendered cone path, not a computed-
and-discarded number.

## Forward Pairing v1, through-ball distance cap, and fluid delivery flow (2026-08-19)

Three further reports, two marked "Major issue" directly.

**Forward Pairing v1.** Directly requested: when two advanced attackers
are near each other, one should drop deep to offer a link while the other
holds the line -- not both just standing still. Root cause traced via a
dedicated research pass: `planAttackerRepositioning()`'s `pin-last-line`
fallback had zero awareness of a nearby TEAMMATE's own job -- every
attacker's action was chosen from only its own relationship to the ball/
nearest defender/pitch width, so two nearby unmarked forwards could both
independently land on the same zero-movement job whenever some other,
closer teammate had already claimed the single global `supportId`.

- New `pinEligible` set -- exactly `pin-last-line`'s own eligibility test
  (not offside, not the runner, not `supportId`, not width-qualifying,
  unmarked), computed once ahead of the main loop so both places agree by
  construction.
- New `dropId`: among each pin-eligible attacker's own nearby
  (`FORWARD_PAIR_RADIUS_YARDS = 18`) pin-eligible peers, the one closest
  to the ball becomes `"drop-deep"` (target: the existing
  `supportShortTarget()`, reused rather than reinvented); everyone else
  keeps `pin-last-line`. A lone advanced attacker with no such peer at all
  is unaffected -- pairing off a group of one is meaningless, verified
  directly.
- Every more urgent job (`run-in-behind`/`support-short`/`hold-width`/
  `diagonal-inside`) still wins outright; this never overrides one of
  those, only the residual zero-movement fallback.

**Through-ball distance cap ("Major issue").** A through ball was
reported threaded the ENTIRE length of the pitch, from one player's own
defensive third to a teammate arriving at the opposite box. Root cause:
`planAttackerRepositioning()`'s `"run-in-behind"` job is (correctly)
about whether the RUNNER can win their own arrival race -- it has no
concept of whether the CURRENT ball owner could plausibly hit a ball that
far at all, and Through Ball v1's own candidate gate never checked.
Fixed with `THROUGH_BALL_MAX_DISTANCE_YARDS = 45` in
`generateFreePlayCandidates()`'s own through-ball gate -- a real,
generous-but-bounded cap, the same "reasonable, round" philosophy as
`canAttemptShot()`'s own long-range cap. A genuinely long-but-realistic
(~30 yard) through ball is unaffected.

**Fluid delivery flow ("Major issue").** Reported directly: "while a pass
happens... everybody freezes... it breaks his pace and the game flow."
Root cause: Touches Per Carry (an earlier round) added interleaved
off-ball reactions DURING a carry/dribble's own touch-by-touch flight,
but `resolvePass()`/`resolveCross()`/`resolveThroughBall()` never got the
same treatment -- each is a single-beat delivery with zero off-ball
movement authored for its own flight window, only before (the previous
action's reaction) and after (the full post-action reposition). For a
long cross-pitch ball specifically, that "everyone else freezes" window
could last the delivery's entire travel time.

- All three resolvers gained the same `interleaveOffBall = false,
  motionContext = null` opt-in parameters `resolveDribble()`/
  `resolveCarry()` already use (same mutation-safety default: off by
  default so direct-call test fixtures are never silently mutated;
  `runConstructedPossession()`'s own existing call already passes `true`
  for every resolver, so this activated automatically with zero call-site
  changes there).
- One `reactOffBall()` call each, right after the delivery's own trace
  event, timed to the delivery's own duration (`MOVEMENT_DURATIONS.pass`/
  `.cross`) rather than a shorter touch-sized burst -- there's only one
  beat here, not several like a carry.
- A real bug caught by this project's OWN existing continuity regression
  test (not just theorized): the interleaved reaction could reposition
  the RECEIVER themselves (they're a normal member of `groups.teammates`)
  before the reception event read their position, breaking real ball-
  continuity (`ballFrom` no longer matching the delivery's own `ballTo`).
  Fixed with `reactOffBall()`'s own existing `excludedIds` option --
  `resolvePass()` additionally excludes the receiver-pressure defender
  (selected before the call, read again after); `resolveCross()`
  excludes the receiver for the same reason `engagingOpponent(receiver,
  ...)` reads their position again immediately after.

All three verified against the full 14-suite regression (the two
continuity-test failures from the receiver-repositioning bug above were
caught and fixed before this was considered done, not shipped with a
known regression), plus new dedicated coverage: Forward Pairing's own
three-attacker scenario (the runner, the drop, the one who still holds,
and a genuinely isolated lone forward that must stay unaffected) with a
determinism check; the through-ball cap's own full-pitch-vs-realistic
comparison; and a real-time trace-ordering check confirming an ATT.ADJUST/
DEF.ADJUST event now lands strictly BETWEEN the delivery and reception
codes for all three resolvers, with the receiver's own position asserted
unchanged by it.

## Deferred: pass/shot execution realism (2026-08-19, not yet started)

A separate, large request from the same round, investigated via a
dedicated research pass but not yet implemented -- flagged here so it
isn't lost, and so the scope is on record before starting it.

**What was asked**: shots and passes are currently too pinpoint. Technique/
Passing should directly govern execution; pressure/Balance/Stamina should
affect it indirectly (situational, not fixed ratings); the gap between an
elite and an average player should show up specifically UNDER PRESSURE,
not in a no-pressure vacuum where anyone can finish cleanly; genuine
"bullet passes" (fast, perfectly flat, perfectly accurate over real
distance) should be rare, not the default. Ball pace should visibly decay
over distance rather than traveling at one fixed animation speed
regardless of how far it's hit.

**What the research pass confirmed already exists**: `resolveThroughBallAccuracy()`
(this same day, above) already proves the exact target pattern -- skill
vs. distance/pressure penalties -> a bounded, never-quite-zero accuracy
error -- but only for through balls. `resolveCrossDelivery()`
(matchEngineCore.js, production) does the same for crosses.
`selectFinishType()`/`resolvePlacedFinish()` genuinely read pressure for
*which* finish gets attempted, and `resolvePlacedFinish()` even computes
real within-frame shot placement -- but that function is walled off
inside the still-experimental, non-animating "One-on-One Decision"
scenario and never touches the live shot flow.

**What's actually missing, precisely**:
- `resolvePass()`'s clean/uncontested branch (match-lab.js, NOT
  production) delivers bang-on to the receiver's exact point 100% of the
  time -- zero distance- or pressure-based variance, the same gap Through
  Ball v1 already fixed for its own delivery type.
- `resolveFinishAttempt()` (matchEngineCore.js, production -- must not be
  modified) is a binary on/off-target roll with no placement math at all,
  and reads no Balance/Stamina anywhere. `goalPointFor()` (match-lab.js,
  NOT production) always sends an on-target shot to exactly one of two
  fixed points -- the keeper's own marker, or dead-center goal -- never a
  real placed corner. This is the safe, Match-Lab-only lever: WHERE an
  already-on-target shot lands within the frame, not WHETHER it's on
  target (that gate stays production-faithful, untouched).
- `buildBallTrajectory()`'s animated duration is driven entirely by a
  fixed `MOVEMENT_DURATIONS[movement]` lookup -- a 5-yard pass and a
  55-yard pass both currently take 550ms. No distance-proportional pace
  loss exists at all, which is the concrete mechanism behind "current
  long balls go like bullets."
- Morale, as the user means it (a per-player, situational state), does
  not exist ANYWHERE in `src/lib/*.js` or `match-lab.js` -- confirmed by
  an exhaustive grep. It exists only inside `draft-run.js` (off-limits)
  as a team-level, not per-player, +-15% momentum scalar driven by red
  cards and missed rebounds, with no analog on the Match Lab testing
  surface. Wiring in a genuine per-player morale concept would mean
  inventing a new state model this project doesn't have, not extending an
  existing one -- scoped out for that reason, pending a direct decision
  on whether that's wanted at all.

**Proposed next-round shape** (not yet built): extend
`resolveThroughBallAccuracy()`'s own pattern to `resolvePass()`'s clean
branch (Technique/Passing direct, pressure indirect, Balance folded in
alongside Technique/Passing as a situational-adjacent read since it's
already precedented in `resolveHold()`'s shielding duel); a new
Match-Lab-only shot-placement spread inside `goalPointFor()` scaled by
the shooter's own execution attributes and pressure, corner-vs-center
rather than always-center-or-always-keeper; and a distance-proportional
duration term for `buildBallTrajectory()`'s ground-pass case
specifically. Deliberately not attempted in the same round as the two
"Major issue" fixes above, to keep each round's own regression surface
reviewable on its own.

## Directional carry continuity + defensive urgency (2026-08-19)

A screenshot round: a carrier's own touch trail zig-zagged sharply across
open, roughly symmetric space, and a wide gap sat inside the defensive
line with nobody visibly closing it -- "why does Pinto have the massive
gap inside the defensive line, why no defenders cover the area... this
kind of vertical movement is not likely in real life. it feels weird."
Two separate root causes, both fixed; two further points from the same
report scoped out below rather than silently dropped.

**Directional carry continuity (the zig-zag).** `planCarryDestination()`
(`spatialDecision.js`) re-evaluates a fresh set of candidate lanes from
absolute zero on every single touch, with no memory of which way the
carrier was already running. In open, roughly symmetric space the two
diagonal candidates (`diagonal-left`/`diagonal-right`) score almost
identically, so tiny geometry differences between consecutive touches
were enough to flip the winner back and forth -- a real player runs a
line; this was re-deciding direction from scratch every stride.

- New `CARRY_CONTINUITY_BONUS = 0.45` scoring bonus: if the owner carries
  a `lastCarryDirectionX/Y` unit vector (yard-space), every evaluated
  candidate gets `max(0, alignment) * CARRY_CONTINUITY_BONUS` added to its
  score, where `alignment` is that vector's dot product with the
  candidate's own direction. A candidate that continues the prior line is
  favored; one that reverses it gets zero bonus, never a penalty -- a
  genuinely better lane (e.g. escaping a defender) can still win outright.
- New `recordCarryDirection(owner, origin, destination)` (`match-lab.js`)
  writes that vector after every real carry touch, wired into both
  `resolveCarry()`'s and `resolveDribble()`'s WON branches, gated behind
  the existing `interleaveOffBall` opt-in (consistent with every other
  mutation those two resolvers make to shared roster entries).
- Verified directly: with a blocker forcing a choice between the two
  diagonal lanes, no prior direction falls back to the neutral `short`
  option; a left-running prior keeps choosing `diagonal-left`; a
  right-running prior keeps choosing `diagonal-right`; and continuity is
  confirmed to never override a genuinely blocked lane (both forward AND
  left blocked still falls back to `short` even with a left-running
  history) -- all four cases now covered by a dedicated
  `test-spatial-decision.mjs` section.

**Defensive urgency (the gap).** The back-line shape/slot logic itself
was already verified correct in an earlier round -- this was a pacing
problem, not a positioning-target problem. Fluid delivery flow (previous
round, above) gave defenders the same `INTERLEAVED_REACTION_FRACTION`
(0.22) share of their per-reaction movement cap that attackers use for
their own measured tactical positioning. A carrier covering real ground
over several consecutive touches was outpacing defenders reacting at that
same unhurried rate, so by the time a carry finished the back line had
visibly fallen behind -- the "massive gap." A recovering defender chasing
a live, moving carrier is a different situation from an attacker easing
into a support position and was tuned identically by accident.

- `reactOffBall()` (`match-lab.js`) gained a `defensiveFraction = fraction`
  parameter, defaulting to the existing `fraction` so every non-interleaved
  call (`fraction = 1`, the full post-action reposition) is unaffected;
  only the defender blend (`partialPoint(defender, step.target,
  defensiveFraction)`) reads it.
- New `INTERLEAVED_DEFENSIVE_REACTION_FRACTION = 0.5`, passed at all five
  interleaved `reactOffBall()` call sites (`resolvePass`,
  `resolveThroughBall`, `resolveCross`, `resolveDribble`, `resolveCarry`)
  alongside the existing `INTERLEAVED_REACTION_FRACTION` for attackers --
  defenders now close a bit more than double the ground per reaction that
  attackers do, without touching attacker pacing or the full
  post-action reposition.
- Verified with an exact-distance regression (not just "some movement
  happened," already covered generically by an earlier round): a defender
  placed far enough away that their press advance hits its own per-reaction
  cap (8yd) moves almost exactly `8 * 0.5 = 4.0` yards in one interleaved
  reaction, measurably more than the old shared 0.22 fraction would have
  produced, with the receiver's own position confirmed untouched by it.

**Scoped out, not silently dropped -- two further points from the same
report:**
- *"Why does Pinto not pass to his teammates?"* No dedicated passing-
  utility change was made. Reasoned (not yet re-verified in a browser) to
  be a likely side effect of the gap bug above: with defenders visibly
  behind the play, carrying/dribbling utility can outscore a genuinely
  available pass more often than it should. Worth a fresh look once the
  defensive-urgency fix has had a real browser round, before assuming a
  separate passing-weight fix is still needed.
- *"Players should be able to play one-twos"* (pass to a stationary
  teammate, then run into space to receive the return pass). Explicitly
  scoped OUT of this round -- this is a new combination-play mechanic, not
  a tuning fix. It needs new state this project doesn't have yet: a
  concept of a "give-and-go partner" for the passer to keep running
  toward, a trigger for when that partner should actually release the
  return pass (immediately vs. under pressure vs. never, if the moment
  passed), and a way for the runner's own off-ball job system to
  recognize "I am the return-pass target" as its own distinct job
  alongside `run-in-behind`/`drop-deep`/etc. Flagged here as a real
  candidate for its own dedicated round, not attempted inline.

Verified against the full 14-suite regression (all green) plus the new
dedicated coverage above.

## Pass pressure-relief, role stickiness, and hold-width depth tracking (2026-08-19)

A follow-up round on the same trace/screenshot thread. Three separate,
concrete reports, all traced to real root causes with numbers, not
guessed.

**"Possession changes too often" -- two players trading the ball in tight
1v1 duels instead of ever recycling it.** A full match-lab trace was
pasted showing the same two players dribbling past each other, losing it,
re-winning it, and dribbling again, action after action, despite "5 legal
pass options" being listed every single time. "In real life, if a player
is facing his own goal, he'd pass it to his teammate because losing the
ball would be costly... these players do not think pass as a viable
option most of the time."

Root cause, found by printing real utility numbers for a reconstructed
version of the exact scenario: `passUtility()` (`spatialDecision.js`)
scores the RESULT of a pass -- progression, the receiver's own pressure,
lane obstruction -- but had no notion of the OWNER's own current danger
at all. Confirmed directly: a routine backward/square pass scored -1.5 to
-1.9 with literally NO opponents anywhere on the pitch, purely from
geometry -- structurally incapable of ever competing with
`dribbleUtility`/`holdUtility`, whose own danger penalties are an order
of magnitude smaller (roughly -0.6 and -0.35 at their worst). Compare
`carryUtility()`, which already has exactly this concept (its own
`pressureRelief` term, rewarding a destination safer than where you
started) -- `passUtility()` never got the equivalent.

- New `pressureRelief` term/weight (1.5): reads `pressureAt(owner,
  opponents)` -- the OWNER's own current danger, independent of which
  teammate is being evaluated -- and rewards passing proportionally to
  how urgently the ball actually needs to leave. A pass into a genuinely
  blocked lane or a heavily-marked receiver still loses on its own
  separate, unaffected merits (`lane`/`pressure` keep full weight).
- Removed the separate flat `backward` penalty, which was double-counting
  the exact same signal the `progression` term (already ranging -1.4 to
  +1.4) fully captures on its own -- a real scale bug once traced, not
  merely a redundant safety margin.
- Verified with real numbers from the exact reported scenario (a direct
  marker ~2.4yd away, 5 pass options fanning out, one genuinely blocked
  by an opponent standing right on the line): before, every pass option
  scored between -0.9 and -3.9, versus dribble's ~0.01 -- passing could
  structurally never win. After, a genuinely safe, wide-open option now
  clearly beats continuing to dribble into the live duel, the genuinely
  blocked option correctly still loses, and an average-decision player
  facing this exact duel now chooses to pass in a clear majority of
  simulated trials (previously near-never).

**Two teammates visibly swapping places every reaction.** Reported with
five consecutive screenshots: Iván Zamorano and Júlio César's markers
trading positions frame after frame with no defender or ball movement
that would explain it -- the same "no memory between reactions" shape as
the carry zig-zag bug fixed earlier this round, just one layer up.

Root cause: `supportId`/`dropId` (`planAttackerRepositioning()`) are both
chosen by pure nearest-to-the-ball distance, re-decided from zero on
every single call. When two teammates sit at nearly the same distance
(common -- midfielders naturally cluster around the ball), the tiniest
geometry drift from the PREVIOUS reaction's own movement is enough to
flip who is nominally closer -- and each flip swaps their entire job
(`support-short`'s forward-leaning target vs. `pin-last-line`'s hold-
still), which reads on screen as the two players trading places.
Reproduced directly: a sub-1-yard lead was enough to flip both players'
whole assignment between two consecutive calls.

- New optional `previousSupportId`/`previousDropId` parameters on
  `planAttackerRepositioning()`, and a `pickWithStickiness()` helper: the
  CURRENT holder of a job keeps it unless a rival is closer by more than
  `ROLE_STICKINESS_MARGIN_YARDS` (3) -- a real, meaningfully better
  option still wins outright, only razor-thin noise gets absorbed.
  Omitting both (every pre-existing caller) reproduces the exact old
  pure-nearest behavior -- purely additive.
- `reactOffBall()` (`match-lab.js`) supplies both from `motionContext`'s
  own already-carried-forward per-player intention record (the SAME
  state `resolveMotionBatch()`'s own target-smoothing already
  maintains across the whole possession) -- no new state was invented,
  an existing "what were they just doing" record just got read from a
  second place.
- Verified with a stale-id case (a `previousSupportId` for a player no
  longer among the current teammates falls back to the plain nearest
  pick, no error) and a real-lead case (a genuinely large lead from a
  rival still overrides the incumbent) alongside the core flip-vs-hold
  comparison.

**A winger stuck deep while the rest of the attack advanced.** Reported
directly against a screenshot: Attilio Lombardo held out wide near the
halfway line across several frames while teammates progressed well into
the final third -- "why isn't Attilio Lombardo join his teammate in this
attack?"

Root cause: `holdWidthTarget()` kept `y: current.y` unconditionally --
"hold width" meant hold LATERAL position, but literally froze the
player's own DEPTH forever at whatever it happened to be when they were
last given the job, with nothing to ever pull them forward as the ball
advanced. Confirmed directly: with the rest of the attack up around
y=88-92 and the wide player still at y=55, their own computed ideal spot
stayed at y=55 -- unchanged regardless of how far the ball had moved.

- `holdWidthTarget()` gained an optional `ballPoint`/`attackingDirection`
  pair: when supplied, the target's depth tracks the ball's own depth
  (only ever ADVANCING to meet it, never retreating if the wide player is
  already ahead of the ball -- a real winger already making a forward run
  doesn't get yanked backward), capped through the same per-reaction
  advance every other job already goes through (a gradual catch-up over
  several reactions, not a teleport). Omitting both (the one pre-existing
  call site, now updated) reproduces the exact old frozen-depth behavior.
- Verified: the wide player's ideal spot now tracks the ball's depth;
  their actual (capped) per-reaction target genuinely advances toward it
  without teleporting; lateral positioning is untouched; a winger already
  ahead of the ball keeps their own more advanced depth; and the old
  no-`ballPoint` call shape is confirmed byte-for-byte unchanged.

**Scoped out, not silently dropped -- two further requests from the same
round, each a real new feature rather than a tuning fix:**
- *Passing into space for a run, including lofted/lobbed through balls*
  (screenshots: Gary Neville recycling the ball while Heiko Herrlich
  makes a diagonal run, or Demetrio Albertini makes a forward run,
  neither currently recognized as a through-ball target). The engine
  already has ONE such mechanism -- `generateFreePlayCandidates()`'s
  `through` candidate, tied to whichever single teammate wins
  `planAttackerRepositioning()`'s `run-in-behind` job
  (`MAX_LINE_BREAK_RUNNERS` caps that at one runner at a time). What's
  missing: (1) `run-in-behind` itself is scoped to beating the last
  defensive line near goal, not any generic forward run into open space
  from a deeper build-up position, so a deep, calm moment like the
  screenshots' never offers it at all; (2) even if it did, only ONE
  runner is ever considered per decision, so two simultaneous good runs
  can't both be weighed; (3) there is no LOFTED/lobbed delivery as a
  distinct pass type at all -- only a ground through-ball and a cross
  exist today, no "long raking ball over the top" resolver or candidate.
  A real next-round shape: loosen `run-in-behind`'s eligibility to cover
  genuine progressive space, not just in-behind-the-last-line; lift
  `MAX_LINE_BREAK_RUNNERS` (or evaluate multiple through-style candidates
  per decision, one per qualifying runner); and add a lofted-delivery
  variant (own resolver or a flag on the existing one, since
  `throughBallUtility()`/`resolveThroughBallAccuracy()` already model
  distance/pressure-scaled accuracy that a lofted ball could reuse).
- *"Goal-scoring instinct" -- a striker making an unprompted forward
  support run when a nearby teammate is on the ball* ("Ruben Sosa or
  Stoichkov needs to make a support run forwards... a good scorer gets
  the smell of it, the scent of goal"). No such job exists in
  `planAttackerRepositioning()` today -- the closest is `run-in-behind`
  (also last-line-beating, not "sense a teammate is about to create a
  chance and arrive late into the box") and `drop-deep` (the opposite
  direction). This would be a genuinely new job, most naturally gated on
  Off the Ball/Anticipation/Finishing (the "instinct" the report is
  literally describing) and triggered by a nearby teammate's own
  advancing possession rather than the ball owner's own position --
  structurally closer to Off-Ball Attribute Awareness's existing
  attribute-scaling pattern than to anything currently in
  `planAttackerRepositioning()`'s job list. Flagged as a real candidate
  for its own dedicated round, not attempted inline.

Verified against the full 14-suite regression (all green) plus new
dedicated coverage for all three fixes above.

## Roster database deep link + generation-aware hover attributes (2026-08-20)

Requested directly: the roster panel's players (`#labRoster`, where
Home/Away/role/ball-ownership are set) should link to their real Database
Page, and hovering should surface ~9-10 position-relevant attributes.

**Database deep link.** `draft-run.js` already has exactly this link
shape -- `playerHref()` building `database.html?database=...&player=...`
from `player.database_slug`/`player.source_person_id` (the same identity
pair `database.html`'s own `src/databaseSearch.js` reads back out via
`playerDeepLink()`). Rather than importing draft-run.js (off-limits, see
this file's own header), match-lab.js gets a small independent
`playerDatabaseHref()` built from the identical identity fields Match
Lab's own roster players already carry (confirmed directly: search
results/added players flow through the same `database_slug`/
`source_person_id` shape `getPlayerMetrics()` keys player identity by
elsewhere in this file). Opens in a new tab (`target="_blank"`) --
navigating away from a constructed Match Lab setup in the same tab would
lose it. A player missing either identity field (e.g. a hand-built test
fixture) renders as plain text, not a broken link.

**Generation-aware hover attributes.** The request came with three full
attribute lists per position (GK/DEF/MID/ATT), explicitly split "old
gen"/"newer gen"/"latest gens." Checked directly against
`db/retroball.sqlite` rather than guessed: the ten converted databases
span cm9596 through cm0304 plus fm2005, and their raw attribute sets
genuinely differ -- cm9596 has no Anticipation/Decisions/Jumping/Bravery/
Balance/First Touch at all, only the older attribute names ("Creativity,"
"Positioning," etc); cm0304/fm2005 add all of those plus GK tendency
stats (Rushing Out, Tendency To Punch, Command Of Area). Also confirmed
via `worker/src/index.ts`'s own `RATING_LABELS` table: the API layer
already renames historical synonyms server-side ("Creativity"->"Vision,"
"Influence"->"Leadership") before this data ever reaches the client, and
gave the exact canonical label spellings used below (`humanRatingLabel()`
falls back to a generic snake_case->Title Case split otherwise, e.g.
"rushing_out"->"Rushing Out").

Rather than hardcoding which SEASON counts as "old"/"newer"/"latest" (a
boundary this project doesn't actually track anywhere, and would be
fragile against any future database added), `relevantHoverAttributes()`
takes a different, more robust approach: `POSITION_HOVER_ATTRIBUTES`
holds one merged, priority-ordered candidate list per position group
(the union of the user's three tiers, old-first), and at render time the
list is filtered down to whichever of those candidates the SPECIFIC
player's own data genuinely has a real value for (via
`rawPlayerAttributeMap()`/`normalizedAttributeLabel()`, already exported
from matchEngineCore.js -- no separate alias table needed since the API
layer's own renaming already normalized the historical synonyms), capped
at `HOVER_ATTRIBUTE_COUNT` (10). This naturally adapts per-player based
on real data availability instead of a guessed era cutoff, and reuses the
user's own curated priority ordering (including GK tendency stats, which
a pure CA-contribution weighting would have excluded -- they carry zero
weight in `attributeGeneration.js`'s own `ATTRIBUTE_WEIGHTS` table since
tendencies don't raise Current Ability, but they're genuinely useful
context for a keeper's own style, which is exactly why the user asked for
them specifically).

- `positionGroupFor(entry)`: `"goalkeeper"` when the roster entry's own
  assigned role is `"keeper"` (Free Play's own authoritative flag, not
  re-derived from the player's raw position text), else
  `classifyOutfieldBand(entry.player)` (already-exported, already used
  elsewhere in this file) for defender/midfielder/attacker.
- Native `title` attribute on the roster name for the actual tooltip
  (not a custom floating overlay) -- reliable, zero extra CSS/positioning
  logic, and avoids clipping/z-index risk inside the roster's own
  scrollable list container.
- New `.match-lab-roster-item a` CSS rule (styles.css) so the now-
  clickable name reads as a real link against the existing dark theme's
  `--surface-2` background, rather than looking identical to the
  surrounding plain-text label.

Verified with realistic old-gen (CM95/96-shaped, 9 sparse attributes) and
latest-gen (FM2005-shaped, 13+ attributes) player fixtures built directly
from the confirmed real label spellings: the old-gen defender's hover
list is exactly their 9 genuinely-present attributes and never invents a
modern-only one their era never had; the latest-gen attacker's larger
real set is correctly capped at 10, not dumped in full; goalkeeper
classification uses the roster's own role flag; and a fixture missing
identity fields or an attributes array entirely degrades gracefully (no
link, no throw) -- plus the full 14-suite regression (all green).

## Ball Flight & Arrival v1 (passes) + Shot Placement v1 (2026-08-20)

The deferred "pass/shot execution realism" work (2026-08-19, above) finally
built, after a separate planning session (pasted in as reference, not
implemented directly) proposed a much larger physics rearchitecture --
intended target/execution/trajectory/arrival-race/control/possession as
fully separate simulation stages, a developer diagnostics panel, generic
Pace/Acceleration-driven `reachIn()`/`timeToReach()` movement for every
action type. Read directly against the real code before building anything
(`buildBallTrajectory()`, `traceEvent()`'s own duration resolution,
`resolveThroughBallAccuracy()`/`resolveCrossDelivery()`'s already-proven
shape, `resolvePlacedFinish()`) rather than assumed from that pasted plan,
because this project already has a DELIBERATE, established architecture
that plan doesn't operate within: the resolver computes the real outcome
first (including, now, a real landing point and a real duration), and the
renderer only ever visualizes an already-decided value
(`buildBallTrajectory()` derives velocity from position+duration for
PRESENTATION; it does not drive them). Rearchitecting that backward into a
forward physics simulation would have fought the codebase's own grain for
a v1 that ships in one round -- so this build reuses and extends the
EXISTING proven pattern (skill vs. distance/pressure -> a bounded, seeded
error, already shipped for through balls and crosses) rather than
replacing it, and explicitly scopes out the diagnostics panel and the
generic pace-driven-duration-for-every-action-type work as separate,
larger asks (see "Explicitly not built this round" below).

**Pass accuracy (`resolvePassAccuracy()`, match-lab.js).** Same shape as
`resolveThroughBallAccuracy()` (skill vs. distance/pressure -> a bounded
error) but a deliberately different SCALE, reasoned through explicitly:
a through ball is an ambitious ball into space where skill dominates even
at short range; an ordinary pass to a teammate who's already standing
there should stay close to automatic at 5-10 yards for anyone, and only
really test technique once it gets genuinely long. So error here is
DISTANCE-FIRST (`baseErrorYards = distanceYards * 0.05`, capped at 6yd)
with skill (Passing 0.4/Technique 0.25/Decisions 0.15/Composure 0.1/
Vision 0.1) and pressure acting as a MULTIPLIER on that base, not the
dominant term throughout. Verified directly: a ~10-yard pass from an
average passer wobbles well under a yard on average across 300 trials; a
~60-yard ball from the SAME passer wobbles more than 3x that; a weak
passer is measurably worse than a strong one at the identical long
distance; real pressure on the passer measurably worsens accuracy at a
fixed distance.

**Pass flight duration (`passFlightDurationMs()`, match-lab.js).** The
concrete "60-metre bullet pass in 550ms" gap, fixed directly:
`MOVEMENT_DURATIONS.pass` was a flat 550ms regardless of real distance.
Replaced with `50ms + (distanceYards / 20yd-per-second) * 1000` --
calibrated so a routine ~10-yard pass lands almost exactly where the OLD
fixed default already did (550 ≈ 50 + 10/20*1000), so short exchanges
keep their existing feel; only genuinely long balls now take meaningfully
longer. No per-player Pace read here (deliberately, see "Explicitly not
built this round" below) -- a real next-round extension, not built this
pass to keep this round's own regression surface reviewable.

**Wiring into `resolvePass()`.** `passLandingPoint`/`passDuration` are
computed ONCE, up front, and reused by both the lane-contested and
uncontested branches (a driven ball through a contested lane is just as
subject to real execution error as an uncontested one -- only the
interception risk differs). The receiver's own marker now genuinely
ADJUSTS to meet the ball at its real landing point (`mover`/`moveTo`,
mirroring `resolveThroughBall()`'s own `P.THROUGH.RECEIVE` pattern)
instead of the ball silently snapping to wherever they already stood --
covers both the clean-reception shortcut and the contested-reception path
(the latter's own `receptionEnd` fallback changed from the receiver's
un-adjusted original position to the real landing point). A genuine
contact-continuity bug was caught and fixed before this was considered
done: the contested reception's own `contact.point` still referenced the
receiver's un-adjusted position while `ballFrom` now read the landing
point, a real position mismatch the project's own Timeline Playback
continuity test (section 36) caught immediately -- fixed by using
`passLandingPoint` for both.

**Shot placement (`shotPlacementSpread()`/`shotPlacementQuality()`,
match-lab.js).** "Not only for the passing but relevant changes should be
done on shooting too." `goalPointFor()`'s own header comment already
named this exact gap when it was written: "the real fix is giving the
shot descriptor its own aimErrorYards/missSeverity... not built yet."
Every contested, on-target shot aimed at EXACTLY the keeper's own
standing position -- a scuffed tap and a screamer looked pixel-identical
until a save's own presentation chain took over. Because `goalPointFor()`
is a single choke point called from 14+ sites across shots/rebounds/
free-kicks/headers, `contactPoint.x` already propagates correctly into
every downstream presentation helper (a goal's own net entry point, a
post/corner save's own exit point all derive their x FROM the initial
contact point) -- so upgrading the shot's own initial aim point ripples
correctly through the WHOLE existing presentation chain for free, no
downstream call site needed touching.

- Offset biased AWAY from the keeper's own current x (the side that's
  actually hard to save, not a coin-flip aimed at their body), magnitude
  scaled by `shotPlacementQuality()` (Finishing/Technique/Composure, the
  same skill shape `resolvePlacedFinish()` -- the walled-off One-on-One
  scenario's own placement roll -- already uses) and reduced under
  pressure. A weak, rushed effort still converges back toward the
  keeper's own position (the OLD default, an honestly easy save); a
  composed, technical finisher genuinely picks a corner. Clamped inside
  the real goal posts (`GOAL_LEFT_POST_X`/`GOAL_RIGHT_POST_X`) -- an
  on-target shot must stay on target by definition.
- Computed ONCE per shot attempt (`shotAimPoint`, right where
  `resolveFinishAttempt()` confirms on-target) and threaded through every
  reference to "where this shot is actually going" within the same
  attempt: the on-target event's own `ballTo`, a block's own `ballFrom`,
  and (new) `pushKeeperSaveEvent()`'s own `contactPoint` override
  parameter. A real bug avoided by reasoning through this BEFORE writing
  the resolver code, not caught after: calling `shotPlacementSpread()`
  again inside `pushKeeperSaveEvent()` would have consumed `random()` a
  second time, silently drawing a DIFFERENT point than the one already
  shown in the on-target event and shifting every subsequent `random()`
  call in the trace -- the exact same class of bug this project's own
  contact-continuity regression suite exists to catch, avoided here by
  computing the point once and passing it down instead.
- Scoped to `resolveShoot()`'s own primary open-play on-target/block/save
  path only -- the empty-net/beaten-keeper branch (`shotPlacementSpread()`
  itself already falls back to `goalPointFor()`'s exact old value there,
  verified directly) and the rebound/header/free-kick/One-on-One-probe
  shot paths keep the OLD exact-keeper-position behavior this round,
  documented here as the explicit boundary rather than silently left
  inconsistent.
- Verified: `shotPlacementQuality()` is monotonic in the three attributes;
  an elite finisher's on-target placements average measurably farther
  from the keeper's own position than a weak finisher's over 300 trials,
  while every sampled placement still stays within the real posts; the
  no-keeper and beaten-keeper fallbacks are confirmed byte-identical to
  the OLD `goalPointFor()` output; and the save event's own `ballFrom` is
  confirmed to be the EXACT SAME point object value as the on-target
  event's own `ballTo` (the single-random-draw continuity guarantee
  above, proven end-to-end through a real `resolveShoot()` sequence, not
  just asserted against the two helper functions in isolation).

**RNG-sequence safety, checked explicitly before writing any of this.**
Both new pieces insert additional `random()` draws into `resolvePass()`/
`resolveShoot()`'s existing sequence -- a real risk in a project with this
many seed-keyed regression tests. Checked every existing test call site
for both resolvers directly before starting: all of them search across
many seeds for a qualitative outcome (a keeper-catch occurs at least once
in 500 trials, a save occurs at some rate across 300) rather than
asserting an exact value for one hardcoded seed, so shifting which
`random()` draws land where a given seed no longer breaks anything --
confirmed correct by the full 14-suite regression passing unchanged
afterward, not merely assumed safe going in.

**Explicitly not built this round (real scope, not silently dropped):**
- Per-player Pace/Acceleration driving pass/shot FLIGHT SPEED itself
  (only the landing-error side reads player skill this round; the flight-
  duration side uses one constant pace for every player and pass type).
- A genuine arrival-race for the RECEIVER against the ball's real landing
  point (whether a nearby opponent could beat them to a sufficiently
  off-target ball and turn it over) -- accuracy error is deliberately
  bounded small enough that the receiver's own existing arrival margin
  isn't erased, the same simplification `resolveThroughBall()` already
  documents and relies on, not a new gap introduced here.
- Distinct pass TYPES (short ground/driven/lofted/through) with their own
  physics -- through balls already have their own resolver; ordinary
  passes are still one uniform ground-pass model, not yet split further.
- The developer diagnostics panel (Pace/Acceleration/pressure/ETA read-
  outs for the ball owner, receiver, and nearest defender) -- a real,
  separately-scoped UI feature, not attempted alongside a resolver-level
  change this large in the same round.
- Rebound/header/free-kick/One-on-One-probe shot placement -- still the
  OLD exact-keeper-position default, per the explicit scope note above.

Verified against the full 14-suite regression (all green) plus 20 new
dedicated assertions across both features (distance/skill/pressure
monotonicity, determinism, real end-to-end resolver behavior, and the
placement-continuity guarantee).

### Fix: off-ball reactions animating in slow motion during a long pass

Reported immediately after the above shipped: "during pass travel player
speeds and upon release speeds are different so like during travel it
feels like game entered a slow motion and then after receive it
continues normal." Root cause, found directly: `resolvePass()`'s
interleaved off-ball reaction (Fluid Delivery Flow, 2026-08-19) reused
`passDuration` -- the BALL's own new distance-real flight duration -- as
the ANIMATION duration for off-ball players' own reactive adjustment too.
Those are two unrelated motions that happen to overlap in time: the ball
now legitimately takes several seconds to cross the pitch on a long ball,
but an off-ball player's own interleaved reaction still only covers its
own small, capped `INTERLEAVED_REACTION_FRACTION` share of ground --
covering that same small distance over several seconds instead of ~550ms
reads as slow motion, then normal pace resumes the instant the next
(normal-duration) reaction fires post-reception.

Fixed by decoupling them: the off-ball reaction now stays timed to the
fixed `MOVEMENT_DURATIONS.pass` beat (matching `resolveCross()`/
`resolveThroughBall()`'s own interleaved reactions, which were never
touched by the distance-duration change and were never affected by this
bug) while the ball's own flight keeps using `passDuration`. A long
pass's off-ball reaction now finishes well before the ball itself
arrives -- a brief, natural-paced adjustment followed by a hold, not
slow, continuous motion for the whole flight -- the same accepted
simplification the cross/through-ball paths already carry, not a new gap.
Verified directly: a ~13-yard pass's reaction duration and a ~70-yard
pass's reaction duration are now identical (550ms each) even though the
ball's own flight duration correctly still differs (679ms vs. 5273ms).
Full 14-suite regression stayed green.

### Correction: the real root cause was one level deeper (matchLabPlayback.js)

Reported again immediately after the fix above shipped: "issue still
persists, during pass travel every player on the field moves step by
step and slow motion." The fix above was real but incomplete -- it
corrected the reaction event's own `duration` field, but never checked
whether the TIMELINE PLANNER actually reads that field for an overlapping
event. It doesn't. Read directly in `buildMatchLabPlaybackPlan()`
(`src/lib/matchLabPlayback.js`): any event with `overlapWithPrevious:
true` had its `playerMoves` keyframe window unconditionally set to
`[lastPrimaryInterval.startMs, lastPrimaryInterval.endMs]` -- the FULL
span of whatever event it's overlapping -- with the overlapping event's
own `duration` field computed and then silently discarded. So the earlier
fix's `duration: MOVEMENT_DURATIONS.pass` never had any effect on the
actual rendered timing at all: the reaction's keyframes were being
stretched across the pass's full (now multi-second) flight both before
and after that change. Confirmed directly by building a real playback
plan and sampling it: an off-ball teammate's own reaction kept emitting
non-zero frame-to-frame movement more than 1.5 seconds into a 5-second
pass, when their real reaction (a few capped yards) should have finished
in well under a second.

This also explains "step by step" specifically, not just "slow": a
reaction's own hermite trajectory samples (a handful of points meant to
cover ~550ms) were being spread across the pass's full multi-second
window, far enough apart in real time to read as distinct eased bursts
with pauses between them, rather than one continuous stride.

**Fix** (`buildMatchLabPlaybackPlan()`, `src/lib/matchLabPlayback.js`):
split the single `(overlapsProducerWindow || stationaryContact)` branch
into two. `stationaryContact` (an arrival at the end of an already-
authored incoming flight -- a rebound taker meeting a parry, etc.) keeps
its exact original behavior, spanning the full producing interval --
that one is deliberately tied to when the producing flight actually
ends, not to its own short duration. `overlapsProducerWindow` (the
interleaved off-ball reactions this bug is actually about) now starts
at the same instant as the producing interval (still genuinely
concurrent) but ends at `min(producingInterval.endMs, startMs +
event.duration)` -- bounded by its OWN real duration, only clamped
short if the producing interval itself happens to be even shorter (the
original carry-touch case, where a reaction's ~200ms and a touch's
~220ms were already close enough that this was never visible before).

Also fixes a second, previously-unnoticed instance of the identical
class of bug: `CONTROL.CONVERGE` (match-lab.js, a defender/interceptor
converging on the ball after previously repositioning) also uses
`overlapWithPrevious: true` with an implicit `MOVEMENT_DURATIONS.
interception` (400ms) duration -- it was equally vulnerable to being
stretched across an arbitrarily long producing interval, now equally
bounded.

Verified directly: rebuilding the exact long-pass scenario and sampling
the resulting plan confirms the off-ball reaction's own interval is now
exactly 550ms (not 5000ms), its track carries no keyframe past 550ms,
and sampling the bystander's position shows them already at rest at
their real target by 3000ms into a 5000ms pass -- not still crawling
toward it. New dedicated `test-timeline-playback.mjs` coverage
reproduces this exact shape (a long primary event with a short
overlapping reaction) directly, plus the full 14-suite regression
(all green, including the pre-existing carry/touch overlap test, whose
own reaction/touch durations were already close enough that the bound
introduced here changes nothing for it).

### Correction #2: single-beat reactions were never enough for a long flight

Reported a third time, after the single-beat fix (correction #1, above)
shipped: "still an issue. When the ball travels everybody freezes." The
single-beat fix was correct as far as it went, but incomplete: a
correctly-timed 550ms reaction only fills the FIRST ~550ms of what can
now be a multi-second flight -- everyone genuinely held still for the
rest, a narrower version of the original bug.

**Multi-beat interleaved reactions (`resolvePass()`, match-lab.js).**
Mirrors Touches Per Carry's own shape (several short reactions across
one longer action) rather than inventing a new mechanic. One beat per
`PASS_REACTION_BEAT_INTERVAL_MS` (700ms) of real flight time, capped at
`PASS_REACTION_BEAT_MAX_COUNT` (8), each aimed at the ball's own
INTERPOLATED position at that instant along its flight (not always the
final landing point). `reactOffBall()` gained an `overlapStartOffsetMs`
parameter (threaded through `traceEvent()`, which already had the field
plumbed) so each beat can be placed at its own instant within the pass's
timeline interval instead of collapsing onto the same starting instant.
A short pass still produces exactly one beat, unchanged.

**A real, deeper bug found investigating this: `buildMatchLabPlaybackPlan()`
silently discarded an overlapping event's own `duration` entirely**,
unconditionally stretching its `playerMoves` keyframes across the FULL
window of whatever primary event it overlapped. Harmless while every
duration sat in the same few-hundred-ms range (a reaction and the
delivery it overlapped were interchangeable in length); broken the
moment they could diverge by 10x. Fixed by giving the overlapping branch
its own bounded window: starts at `lastPrimaryInterval.startMs +
overlapStartOffsetMs`, ends at `min(lastPrimaryInterval.endMs, startMs +
event.duration)` -- respects its own real duration, only clamped short
if the producing interval is itself shorter (the original carry-touch
case, unaffected).

**Two further, real contact-continuity bugs found via fuzzing, not
guessed.** Verifying the above with the SAME 80-seed fuzz sweep this
project already runs (`test-possession-runner.mjs` section 36) surfaced
two more genuine bugs, neither caused by the multi-beat change itself:

1. `pushKeeperSaveEvent()`'s new `contactPointOverride` (Shot Placement
   v1) could genuinely differ from the keeper's own last-authored
   position, but nothing moved their own MARKER to meet it -- the save's
   own `contact` field claimed they were somewhere their own track never
   reached. Fixed: the keeper now genuinely dives/reaches to the real
   contact point (`mover: keeperEntry, moveTo: contactPoint`), a no-op
   for every pre-existing caller that doesn't override it.
2. A contested reception's own `playerMoves[].from` (correctly the
   receiver's real tracked position) and its `contact.point`
   (`passLandingPoint`, Ball Flight & Arrival v1) could genuinely differ,
   with no authored movement connecting them. An advancing
   (KNOCK_FORWARD) reception additionally needs the ball to keep moving
   AFTER contact -- a real intermediate waypoint `contact.phase`
   (start/end only) cannot express within one event. Fixed by splitting
   into two events: "control it at the real landing point" (contact
   declared here) then, only when advancing, "knock it forward" (a plain
   following move, no contact of its own).

**A fix that had to be reverted after checking the user's own reception-
timing test.** An early version of fix #2 also changed `contact.phase`
from `"start"` to `"end"`, reasoning that contact happens when the
receiver's own arrival movement ends, not begins. Checking against the
user's own `test-timeline-playback.mjs` coverage (added alongside
`contactArrivalTiming()`/`matchMovementTiming.js`, this same day) showed
this was wrong: `buildMatchLabPlaybackPlan()` already has two dedicated
mechanisms for exactly this shape, BOTH of which require
`contact.phase === "start"` -- a kinetics-timed arrival via
`contactArrivalTiming()` when `playerProfiles` is supplied (the real
live app always supplies it), and a simpler "reuse the preceding
interval's own window" fallback when it isn't (what the 80-seed fuzz
test exercises, since it doesn't supply profiles). Changing the phase to
"end" would have silently defeated the kinetics path in the live app
while only fixing the profile-less fallback. Reverted back to "start" --
the pre-existing fallback mechanism already resolves the contact-
continuity requirement correctly, no phase change needed after all. Also
added (and kept, as a defensive measure, though no longer strictly
required after the revert): `buildMatchLabPlaybackPlan()`'s
`stationaryContact` shortcut now explicitly excludes `movement:
"reception"` -- that shortcut is for arrivals at the end of an ALREADY-
AUTHORED incoming flight (a rebound taker meeting a parry), a
structurally different case from a reception's own genuine, independent
action, and the two could otherwise interact unpredictably.

Verified: full 14-suite regression green, plus new dedicated coverage
(multi-beat staggering and offset bounds, the keeper's dive-to-contact,
a 3000-seed fuzz sweep with the SAME shape the standard suite already
uses -- zero failures, confirming the fixes above rather than just
hoping the 80-seed sample happened to miss something).

**A real, DISTINCT bug found by fuzzing further than the standard suite
does, explicitly NOT fixed this round -- flagged, not silently
dropped.** Re-running that same 3000-seed sweep WITH `playerProfiles`
supplied (matching the real live app's own call shape, which the
standard 80-seed suite does not exercise) surfaced 54/3000 failures,
all a different root cause: `contactArrivalTiming()`'s own
`reachablePoint` can be CLIPPED short of the intended target when a
receiver genuinely can't reach it in time -- correct and intentional
(section 61's own "unreachable delivery remains loose" coverage exists
for exactly this). But `runConstructedPossession()`'s own roster-sync
(`Object.assign(movedEntry, move.to)`) reads the trace event's `move.to`
directly -- the FULL intended landing point, not the clipped reachable
one -- because the simulation layer has no concept of kinematic
reachability at all; that concept currently exists ONLY inside
`buildMatchLabPlaybackPlan()`, a separate, later, presentation-only step.
When a reception is genuinely borderline-reachable, the SIMULATION
commits the receiver to having fully arrived while the KINEMATICALLY-
HONEST timeline would show them still short of it -- a real divergence
between what the game state says happened and what the timeline can
truthfully render, not a bug in either piece alone. Fixing this properly
means teaching the SIMULATION layer about reachability too (or at
minimum keeping the two in sync), a real architecture question this
round didn't have the scope to make unilaterally. Not built this round;
flagged here as a concrete next-round candidate with the exact
reproduction shape (playerProfiles + a genuinely marginal reception)
already known.

## Continuous World Motion During Ball Flight v1 (2026-08-20)

**The architectural correction, not another duration patch.** Reported
directly, twice, in the same session: first "when the ball travels
everybody freezes," then a real match trace showing the SAME two players
(Zola/Effenberg) trading interceptions no matter who the actual pass
target was -- "the ball is getting intercepted on the same occasion
repeatedly... ball should have its own independence." Diagnosis, stated
explicitly by the user and confirmed by reading the code: two rounds of
duration/overlap patches on the multi-beat off-ball model (several
fixed-duration `ATT.ADJUST`/`DEF.ADJUST`/`GK.ADJUST` events per flight,
velocity reset to zero at every beat boundary, then a forced full-
strength "converge to position" burst after the action concluded) never
addressed the root cause: the model itself was stop-start by
construction, no matter how the beats were spaced. Separately,
`nearestLaneInterceptor()` picked a winner by static-geometry proximity
to the passing LINE at kick time, blind to real arrival speed, and only
THEN sent the ball to that defender's own static starting position --
"decides the defender won first and then sends the ball to the
defender's static position," never asking who could physically reach
the moving ball first.

**The fix, per the user's own explicit architecture.** Every off-ball
player now gets exactly ONE continuous, physically-limited trajectory
spanning the pass's WHOLE flight interval, computed from real Pace/
Acceleration via `playerKinetics.js`'s existing `reachIn()` -- no beat
boundaries, no velocity reset mid-flight, ground covered strictly
monotonically. Interceptions are resolved by racing every opponent's own
real reach against the ball's own independent, already-decided straight-
line path, sampled in fine time steps -- the first (defender, instant)
pair where a real physical arrival is possible wins; nobody with a
static-proximity advantage but no real chance is ever credited. The
post-action full-strength convergence burst is gone too: the SAME
continuous mechanism now drives the "settle into the next tactical
shape" step once an action concludes, not a separate fixed-duration
hermite snap.

New primitives, `src/lib/matchMovementTiming.js` (extends the user's own
`contactArrivalTiming()` neighborhood, not a new file):
- `continuousPositionAtElapsed({from, to, player, elapsedSeconds,
  reactionDelaySeconds})` -- a percent-space point via `reachIn()` fed
  into the existing `pointAlongMovement()`. Monotonic by construction.
- `sampleContinuousTrajectory({from, to, player, totalMs,
  reactionDelayMs, sampleCount})` -- a dense, evenly time-spaced
  `{progress, position}` array in the exact shape `traceEvent()`'s
  `playerMoves[].trajectory` already accepts. Deliberately carries no
  `velocity` field -- `matchLabPlayback.js`'s own `sampleTrack()`
  requires velocity truthy on BOTH endpoints of a segment to blend via
  hermite, so an absent (normalized to `null` by `traceEvent()`) velocity
  correctly forces its existing linear-lerp fallback instead, with zero
  changes needed to `matchLabPlayback.js` itself.
- `earliestReachableInterception({ballFrom, ballTo, totalMs, defenders,
  reactionDelayMs, interceptRadiusYards, sampleIntervalMs})` -- walks the
  ball's own straight-line path in 40ms steps; at each step, checks every
  defender's real `reachIn()`-limited reach after their own reaction
  delay against the ball's position at that instant. First match (across
  ALL defenders, not just the closest one at kick time) wins. Returns
  `null` when nobody can genuinely get there -- never fabricates a
  contest. No randomness anywhere in the geometry; identical inputs
  always produce an identical result.

`match-lab.js` changes:
- New `reactOffBallContinuous(defendingGroups, ballFrom, ballTo, totalMs,
  trace, {motionContext, excludedIds})`, placed beside the existing
  `reactOffBall()` (kept, unmodified, still correct for every OTHER
  resolver's own interleaved reactions -- cross, dribble, carry, through-
  ball -- none of which were reported broken). Same target-planning calls
  (`planAttackerRepositioning()`/`planDefensiveRepositioning()`/
  `keeperPositioningPoint()`), same role-stickiness read from
  `motionContext`, same off-ball separation on final destinations -- the
  only difference is HOW players get from here to there: one
  `sampleContinuousTrajectory()` run per player instead of
  `resolveMotionBatch()`'s hermite beat. Used at TWO call sites:
  off-ball movement during a pass's own flight (`resolvePass()`), and the
  formerly-unconditional post-action convergence in
  `runConstructedPossession()` (`ballFrom`/`ballTo` unused by either
  caller -- both pass the same single point since there's no "flight" for
  a settle-into-shape step, just a bounded time window).
- `resolvePass()` restructured: `passDistanceYards`/`accuracyErrorYards`/
  `passLandingPoint`/`passDuration` now compute BEFORE any interception
  check (the ball's real path exists before anyone can be checked against
  it -- directly satisfies "the ball never changes its path merely
  because a winner was selected beforehand"). `nearestLaneInterceptor()`
  replaced with `earliestReachableInterception()`. `localizedDuel()` kept
  as a skill-based outcome layer ON TOP of the new physical-reachability
  gate -- physics decides WHO can contest it, the existing attribute-
  based duel decides what happens once they do; lower risk (reuses an
  already-tuned probability model) and still directly fixes the reported
  bug (the ball no longer goes to a static, physics-blind position). A
  WON duel still reaches the full landing point over the full
  `passDuration` (the contest happened but didn't meaningfully redirect a
  ball that got through); a LOST duel's flight genuinely ends at
  `interception.atPoint`/`atMs` -- a real, moving point along the ball's
  own path. The interceptor's own `P.PASS.LOST` event carries its own
  `sampleContinuousTrajectory()`-authored run, `contact.phase: "end"`
  (their run completes, THEN contact happens -- same principle already
  established for receptions), excluded from the generic
  `reactOffBallContinuous()` call alongside the receiver and their own
  pressure defender so nobody's position gets authored twice.
- The old `PASS_REACTION_BEAT_INTERVAL_MS`/`PASS_REACTION_BEAT_MAX_COUNT`
  constants (the staggered-beat spacing this round removes) deleted as
  dead code.

**A real bug caught by this round's own testing discipline, not by
inspection.** `reactOffBallContinuous()`'s `moves` array construction
initially reused `entry.player` (the physics-facing attributes object
`sampleContinuousTrajectory()` reads Pace/Acceleration off) as the
`player` field handed to `traceEvent()` and to the function's own final
`Object.assign(move.player, move.to)` commit -- both of which need the
ROSTER ENTRY (the object with `.id`, `.x`, `.y`), not the attributes
blob. `reactOffBall()`'s own `byRole()` helper already resolves this
correctly via `originals.get(move.id)`; the new function skipped that
lookup. Effect: every `playerId` on every `reactOffBallContinuous()`-
authored trace event was silently `undefined` (a probe script printing
raw `playerMoves` ids caught it directly -- earlier verification had
only checked physics/geometry correctness, never round-tripped
`playerId`), and the final position commit was mutating the wrong
object, so a multi-action possession would make its NEXT decision from a
stale, unmoved position for anyone this function had just relocated.
Fixed by resolving `player: originals.get(entry.id)` at move-construction
time, same pattern as `reactOffBall()`.

**Test suite updated for the new architecture, not just re-run.** Three
existing `test-possession-runner.mjs` sections encoded assumptions from
the model this round replaced and needed rewriting, not just re-passing:
- Section 56's "a real third teammate's position DID change" used a
  short pass where the real, `reachIn()`-bound distance covered in the
  real available time now legitimately rounds to zero (correct under the
  new model -- a player genuinely can't cover much ground in a sub-second
  window) -- switched to a genuinely long flight.
- Section 57's exact-fraction math (`INTERLEAVED_DEFENSIVE_REACTION_FRACTION`)
  no longer applies to `resolvePass()` at all (physics-bound now, not a
  fixed percentage of the gap) -- retargeted at `resolveCross()`, which
  still runs the unchanged fractional model, to keep that coverage
  genuinely valid; a new physics-consistency check (covered distance
  never exceeds the defender's own `reachIn()` ceiling for the real
  window) added for `resolvePass()`'s own reaction.
- Section 62 ("Multi-beat off-ball reactions during a long pass's
  flight") tested the exact staggered-beat behavior this round
  eliminates by design -- rewritten to assert the opposite: a long
  flight produces EXACTLY ONE continuous event, not multiple beats, plus
  a dedicated `sampleContinuousTrajectory()`-level check (a genuinely far
  target for a slow mover) that ground is covered throughout a long
  window, decoupled from the tactical layer's own independent per-
  reaction distance cap (~8yd, unrelated to this round).
- Section 3's "ballEnd is the defender's real point" asserted EXACT
  equality with the defender's pre-kick static position -- the literal
  bug being fixed. Updated to a proximity check (the real interception
  point stays close to, but is no longer required to exactly equal,
  where the defender started).

New section 64 encodes the user's own seven acceptance criteria
verbatim, each as a named, verified check: no stop-restart within a run,
Pace/Acceleration measurably affecting arrival time and covered
distance, a real `topSpeed()` speed ceiling never exceeded (checked
across a 60-seed sweep of actual inter-sample speeds), no separate
"chases the delivery" event on a genuinely clean reception, a 50-60yd
pass with realistic (2.5-6s) flight duration that can genuinely become
loose or intercepted, the ball's path (`P.PASS.ballTo`) matching the
interceptor's own authored contact point identically regardless of which
way the duel roll went, and full determinism (both a single `resolvePass()`
call and a complete multi-action possession replay byte-identically from
the same seed).

Verified: full 14-suite regression green (including `test-draft-game.mjs`
-- production code, `draft-run.js`/`matchEngineCore.js`, untouched this
round, confirmed still passing), the new section 64's 15 checks green, a
500-seed fuzz sweep across randomized roster sizes/positions/attributes
through complete multi-action possessions (zero crashes, zero NaN/out-
of-range coordinates, zero `playerId` failures, zero speed-ceiling
violations across every continuous trajectory sample). `match-lab.js`
cache-bust bumped to `?v=20260820-07` in `match-lab.html` (and
`test-timeline-playback.mjs`'s matching assertion); its own import of
`matchMovementTiming.js` bumped to `?v=20260820-02` for the new exports.

Not built this round (explicitly out of scope, matching the user's own
"do not alter final calibration until movement telemetry and full-
sequence tests are available"): mid-flight tactical retargeting (a
player's own ideal spot is fixed for the whole flight, same as the ball
itself); the same continuous-motion treatment for cross/dribble/carry/
through-ball's own interleaved reactions (none were reported broken);
any change to the actual duration constants, reaction-delay values, or
duel probability tuning.

**Follow-up, same day: the marking defender was still frozen.** Reported
directly after the above landed: "Off-ball movement during a pass's
flight freeze somehow persists as well." `receiverPressureDefender`
(`engagingOpponent(receiver, ...)`, computed at the top of `resolvePass()`)
was excluded from `reactOffBallContinuous()` -- correctly, so a generic
tactical nudge couldn't override their own engaging role -- but nothing
else ever authored them a movement either. The reception outcome event
gave `receiver` a `playerMoves` entry on success and NOBODY a
`playerMoves` entry on failure, using `pointOf(receiverPressureDefender)`
(their untouched kick-time position) as the win contact point -- the
exact same "decide the winner, then snap to a static position" flaw
already fixed for lane interceptions, just still present for the
reception-contest defender. Confirmed via a probe script before touching
any code: across a full contested-pass trace, the marker's roster x/y
were bit-identical from kickoff through possession, `false` for "any
authored marker movement across the whole trace."

Fixed with a dedicated `DEF.PRESS.RECEIVER` event (mirroring
`P.PASS.LOST`'s own pattern: the OTHER participant's real approach lives
on its own event, not folded into the reception event) -- one
`sampleContinuousTrajectory()` run toward `passLandingPoint` over the
full `passDuration`, `overlapWithPrevious: true` so it shares the
P.PASS's own flight window rather than running sequentially after it.
The roster entry is mutated atomically right after (`Object.assign`),
so every later read of `receiverPressureDefender`'s position -- the
reception event's own `ballTo`/`contact.point`/`ballEnd` on a lost
contest -- automatically reflects where they REALLY ended up, with zero
changes needed to that event's own code.

**Why this couldn't reuse the reception event itself.** The receiver's
own `receive-pass` move on that SAME event depends on a fragile,
already-once-reverted special case in `buildMatchLabPlaybackPlan()`
(`contactArrivalTiming()`, keyed to finding the true "producer" flight
interval by searching `intervals` for one whose `endMs` lines up with
this event's own `startMs`). Setting `duration`/`overlapWithPrevious` on
that event to give the DEFENDER a correctly-timed window would have
changed the event's own `startMs` out from under that lookup, silently
breaking the receiver's arrival timing for exactly the reason the
existing code comments warn about. Verified directly: built a full
`buildMatchLabPlaybackPlan()` plan (with real `playerProfiles`, matching
the live app) for a contested-reception trace and confirmed the
receiver's own `receive-pass` keyframes still span their own short,
kinetics-timed window (1184ms, not the full 3655ms flight) while
`DEF.PRESS.RECEIVER`'s interval correctly shares the P.PASS interval's
`[0, 3655]` window -- the marking defender visibly closes down
throughout the flight, the receiver's arrival timing is provably
untouched.

Verified: full 14-suite regression green, 500-seed fuzz sweep green
(unchanged from before this fix). `match-lab.js` cache-bust bumped again
to `?v=20260820-08`.

## Ball Flight v2 Architecture (2026-08-20)

**Why another round, immediately after "v1" shipped.** Continuous World
Motion During Ball Flight v1 fixed HOW players move during a pass
(continuous, physically-limited, no beat resets) and made interceptions
a genuine physical race instead of a static-position snap. It did not
touch WHAT the ball itself is: `resolvePass()` still always produces a
single, unconditional straight-line ground delivery aimed directly at a
player ID, with one flat accuracy-error model regardless of distance.
The user's own diagnosis, agreed with in full: "passes may look
smoother but will still fundamentally be predetermined deliveries
between player IDs" unless the ball gets a genuinely independent flight
(intended point vs. actual endpoint, a real pass-type decision, height)
and reception/interception both race that SAME independent trajectory
rather than the receiver being evaluated on a separate, privileged path.

**Scope discipline for this round, per explicit instruction: plan the
complete v2 architecture, but implement only Vertical Slice 1 (one
complete ordinary-pass pipeline, kick to reception) this round.** Later
slices -- spin, real bounce physics, headers, crosses, clearances, richer
aerial contests -- are designed for (interfaces reserved) but NOT built
now. `resolveCross()`, `resolveThroughBall()`, `resolveDribble()`,
`resolveCarry()`, `resolveShoot()`, keeper logic, offside logic, and all
production code remain untouched this round.

### What already existed and is being reused, not reinvented

Reading `src/lib/matchBallCore.js` (Codex-built Match Lab infrastructure,
confirmed safe to extend) before designing anything turned up most of
the "ball has its own state" concept already built, just not yet wired
into `resolvePass()`'s own internal reasoning:
- `createBallState()`/`transitionBallState()` already carry `position`
  (with a `height` field), `velocity`, `incomingVelocity`,
  `verticalVelocity`, `phase` (`"held"|"controlled-ground"|"loose"|"dead"`),
  `ownerId`, `lastTouchId`/`lastTouch` -- `ownerId: null` while a ball is
  "loose" is already the exact "ball becomes unowned" concept requested.
  This object already exists at the `runConstructedPossession()` level
  (`simulated.ballState`) but `resolvePass()` itself doesn't consult or
  update it while reasoning about interception/reception -- it works
  directly off raw roster points instead. Slice 1 does not change this
  seam (a real integration -- making `resolvePass()` read/write
  `simulated.ballState` mid-resolution -- is flagged as later-slice work
  below, not attempted now, to avoid widening this round's blast radius
  into `runConstructedPossession()`'s own bookkeeping).
- `buildBallTrajectory()` already gives every OTHER movement type
  (cross, shot, header, clearance, save, block) a real height arc via
  `peakHeightFor(movement, mode, heightCue)` and `sampleHeight()` --
  passes are the one movement type with no entry in that map, so
  `peakHeightFor("pass", ...)` silently falls back to `?? 0` today
  (confirmed by reading the function directly): passes have always been
  height-0 by omission, not by a deliberate "ground only" design
  decision. This is the concrete gap Vertical Slice 1 fills, using the
  SAME height-profile vocabulary and conventions this file already
  established for every other movement type, not a parallel one.
- `selectLooseBallRecovery()` already implements "deterministic
  loose-ball race: real acceleration/top-speed reach, then anticipation"
  -- the closest existing thing to "receiver and defenders race the same
  trajectory," just scoped to a ball that has ALREADY gone loose after a
  turnover, evaluated once at a single predicted point
  (`predictBallPosition()`), not sampled continuously along an in-flight
  path. The new unified race (below) generalizes this same idea --
  real Pace/Acceleration-limited reach, real Anticipation -- to a ball
  still genuinely in flight, sampled at many points along its real path,
  exactly as `earliestReachableInterception()` (Continuous World Motion
  v1) already does for defenders alone. `matchBallCore.js` itself is not
  modified for this slice; its functions are reused as-is.
- `resolveReceive()` (production, `matchEngineCore.js`, never modified)
  already IS the First Touch/Technique/Composure/Anticipation contact-
  resolution model the user asked for -- `firstTouch + technique*0.6 +
  composure*0.4 + anticipation*0.4` against a "strain" score (pass
  quality, pressure), producing CLEAN/PROTECT/HEAVY/KNOCK_FORWARD/LOSE,
  with a genuine Balance/Strength/First-Touch recovery duel
  (`localizedDuel`) inside the HEAVY branch and a real contested race
  inside KNOCK_FORWARD. `resolvePass()` already calls this exactly once
  a receiver is confirmed to have reached the ball -- Slice 1 does not
  replace this function or its call, only what feeds it (see "Contact
  resolution" below).

### New ball-flight state (Vertical Slice 1)

Not a mutable, tick-updated simulation object (nothing else in this
codebase runs on a tick loop -- match-lab.js is event/trace-driven
throughout, and `matchMovementTiming.js`'s own primitives are already
pure functions of elapsed time, not accumulated state). Modeled the same
way instead: an immutable **flight descriptor**, fixed at the instant of
the kick, plus pure sampling functions of elapsed time -- observably
identical to the user's requested shape (`position`/`velocity` queryable
at any instant, `ownerId: null` for the whole flight, deterministic,
replayable) without introducing a tick-based engine concept the rest of
the file doesn't have:

```js
// src/lib/matchPassFlight.js (new file)
{
  passType,                    // "ground" | "driven-ground" | "lofted" | "driven-aerial"
  from,                        // {x, y} percent-space, kick point
  intendedPoint,               // {x, y} percent-space -- where the passer AIMED (receiver's position at kick time)
  actualEndpoint,              // {x, y} percent-space -- real endpoint after accuracy error; NEVER equals intendedPoint by construction unless error rolled exactly zero
  durationMs,                  // real flight time for this type+distance
  peakHeightYards,             // 0 for ground/driven-ground; a real arc for lofted/driven-aerial
  launchedAt: 0,                // ms, relative to this event's own clock (matches how every other continuous-motion primitive this session already treats elapsed time)
  lastTouchPlayerId: owner.id,
  intendedReceiverId: receiver.id,
  spin: null,                  // RESERVED for a later slice -- always null this round, never read
}
```
`ballHeightAtProgress(flight, progress)` and `ballPositionAtElapsed(flight,
elapsedMs)` are pure functions (no stored velocity vector to keep in
sync) -- `position` is `pointAlongMovement(from, actualEndpoint, ...)`
(reused from `matchMovementTiming.js`, unmodified) plus a height
component using the SAME parabolic `sampleHeight()`-style shape
`matchBallCore.js` already uses for cross/clearance/shot arcs, just
parameterized per pass type instead of per movement-outcome. `velocity`
at any instant is the derivative of that same closed form, needed once,
for two things only this slice: (a) reception-difficulty input alongside
First Touch (a fast, low, driven ball is harder to control cleanly than
a gentle rolling one -- feeds into the SAME `strain` calculation
`resolveReceive()` already exposes via its `pressure`/`bypass`
parameters, not a new one), and (b) a future slice's spin/curl hook.

`buildBallTrajectory()` itself is still what ultimately produces the
RENDERED ball path once the outcome is decided (unmodified, reused
exactly as every other movement type already uses it) -- the flight
descriptor above is the PHYSICS-DECIDING layer, matching the two-layer
separation this whole project already established: physics decides what
happens, rendering redraws it afterward from the resolver's own
authoritative endpoints. Slice 1 does not plumb real height into the
VISUAL 2D ball path rendering (the pitch is drawn flat; z stays an
internal, contact-eligibility-only quantity) -- flagged explicitly as a
later-slice visual enhancement, not required by any of the ten
acceptance tests below.

### Pass-type selection

`selectPassType({ passer, from, to, opponents })` -- deterministic
(no RNG; the passer's own skill and the geometry decide this, not a
dice roll), returns one of the four Slice-1 types. Through-ball stays
on its own existing, untouched `resolveThroughBall()` pipeline this
round (already has its own distinct "aimed at space, not a player" model
predating this initiative -- unifying it under `matchPassFlight.js` is
explicitly a later-slice task, not attempted now, matching "identify
which existing paths will be replaced or temporarily adapted").

Lane congestion reuses `laneObstruction(from, to, opponents)`
(`spatialDecision.js`, already exported, already used elsewhere) rather
than a new function: 0 (clear) to 1 (an opponent standing right on the
line), the closest any opponent's real position gets to the `from -> to`
segment (`yardDistanceToSegment()`, already handles "not counted if
genuinely behind the passer or past the receiver" via its own clamped
projection), normalized against the existing `PASS_LANE_HALF_WIDTH_YARDS`
(3 yards -- an opponent needs to be within roughly a body's-width-and-a-
half of the DIRECT line to register real obstruction; this is already
the codebase's own established "is this lane genuinely blocked" scale,
used elsewhere, not a new one invented for this feature). Pass-type
selection uses `1 - laneObstruction(...)` as its own openness figure,
thresholds calibrated against that real 3-yard reference below (not the
12-yard figure an earlier draft of this doc used before checking what
already existed in the codebase).

Concrete thresholds (documented here so recalibration later is a data
change, not an archaeology exercise):
- `distance <= 15yd`: **ground**, always -- a short pass doesn't need
  power or a lane judgment.
- `15yd < distance <= 35yd`: **driven-ground** if `laneObstruction < 0.5`
  (nobody within ~1.5yd of the direct line), else **lofted** (a blocked
  medium-range lane calls for going over the top, not forcing it
  through).
- `distance > 35yd`: **lofted** by default (the safe long-range option);
  **driven-aerial** instead when the passer's own power+technique blend
  (`(Strength + Technique + Passing) / 3 >= 13`) supports a firm, flatter
  diagonal AND the lane isn't badly congested (`laneObstruction < 0.6`)
  -- a skill-gated upgrade, not the default. A genuinely clear, long
  lane (`laneObstruction < 0.15`) with an elite passer (`>= 15` on the
  same blend) keeps **driven-ground** viable even beyond 35yd -- "a
  50-metre ground pass can remain possible... [with] an unusually open
  lane, enough power and suitable technique" verbatim -- deliberately
  rare (all three conditions must hold at once) and, being ground-height
  for its entire flight, exposed to the reachability race along its
  ENTIRE path length, not just at the reception point, which is what
  makes it "highly exposed to interception" a natural consequence of the
  model rather than a separate penalty bolted on.

Per-type flight profile (ground speed component + peak height + an
accuracy-error multiplier applied ON TOP of the EXISTING, unmodified
`resolvePassAccuracy()` -- extending it with a new dimension via a
multiplier, not editing its own already-tested internals):

| Type          | Speed (yd/s) | Peak height (yd)              | Accuracy multiplier |
|---------------|-------------:|--------------------------------|---------------------:|
| ground        | 20 (unchanged, `PASS_FLIGHT_PACE_YARDS_PER_SECOND`) | 0            | 1.00 |
| driven-ground | 26           | 0 (contact-eligible throughout) | 1.25 |
| lofted        | 16           | `clamp(1.5, 6, distance * 0.09)` | 1.15 |
| driven-aerial | 24           | `clamp(0.8, 2.5, distance * 0.035)` | 1.35 |

`CONTACT_HEIGHT_YARDS = 0.6` -- below this, a foot-based touch or
interception is physically possible; at or above it, NOBODY is contact-
eligible yet this slice (the ball is genuinely in the air, out of
reach). This is the explicit, load-bearing boundary that keeps headers
out of Slice 1 without needing a separate "headers not implemented"
special case anywhere else -- a later slice adds header eligibility by
checking the SAME `height` value against a much higher, jump-reach-based
threshold instead of introducing a new mechanism.

### Unified reachable-contact race

`earliestReachableContact({ flight, candidates, sampleIntervalMs })` --
generalizes `earliestReachableInterception()` (Continuous World Motion
v1): walks the flight's OWN independent path (position AND height) in
fine time steps (40ms, unchanged default); at each step where
`height(t) <= CONTACT_HEIGHT_YARDS`, checks EVERY candidate -- the
intended receiver treated as ONE candidate among equals, not evaluated
on a separate privileged path the way today's `contactArrivalTiming()`-
driven receiver check is -- via the same closed-form `reachIn()` this
whole project already uses, each with their OWN reaction delay. First
(candidate, instant, point) match across the WHOLE candidate set wins.
Returns `null` when nobody qualifies before the flight completes -- a
genuinely clean, uncontested arrival (or, if the intended receiver also
fails to reach it, a loose ball -- both already-real outcomes in
`resolvePass()` today, now reached via one shared mechanism instead of
two separate checks that don't know about each other).

This single change is what makes "meet the ball at the earliest useful,
controllable point along its trajectory" TRUE FOR FREE, no separate
logic needed: because the receiver is sampled at every 40ms step exactly
like a defender, the FIRST point they qualify for -- which may be well
before the ball's final landing spot, if they're quick and central to
the early flight path -- is what the race returns, not the endpoint.

**Reaction delay, generalized.** `CONTACT_REACTION_DELAY_MS` (120ms) was
a flat constant for every candidate in Continuous World Motion v1. Per
the user's explicit ask ("Anticipation and Decisions: how quickly and
correctly they read the pass"), Slice 1 adds
`reactionDelayMsFor(player, { isIntendedReceiver })`:
```js
const readingScore = (playerAttribute(player, "Anticipation") + playerAttribute(player, "Decisions")) / 2;
const delta = (10 - readingScore) * 8;           // roughly +-72ms across a 1..20 range
const headStart = isIntendedReceiver ? 60 : 0;   // they called the pass; a defender has to react to someone else's decision
return clamp(40, 260, CONTACT_REACTION_DELAY_MS + delta - headStart);
```
A bounded generalization of the existing constant (still centers on
120ms for an average 10/20 reader), not a reinvention -- every other
caller of `CONTACT_REACTION_DELAY_MS` (P.PASS.LOST's interceptor,
`reactOffBallContinuous()`, `DEF.PRESS.RECEIVER`) is unrelated to this
race and stays on the flat constant this round; only the new unified
race uses the per-player version.

### Contact resolution

Once the race returns a winner:
- **Nobody qualifies before the flight ends**: clean, uncontested
  arrival -- unchanged shape from today's `P.RECEIVE.CLEAN` shortcut.
- **The intended receiver wins outright** (no opponent within a short
  window behind them): proceeds into the EXISTING, unmodified
  `resolveReceive()` call, pressure computed as it is today
  (`computePressure` against whichever opponent is nearest at THAT real
  moment, not at kick time).
- **The intended receiver wins, but an opponent arrives within a short
  contest window behind them**: same `resolveReceive()` call, now with
  genuine pressure/strain reflecting a real near-simultaneous arrival --
  this is what CAN produce HEAVY/LOSE outcomes exactly as it does today,
  just driven by a real race result instead of a kick-time proximity
  guess.
- **An opponent wins outright**: the SAME two-layer principle already
  established and tested for lane interceptions -- physics decided WHO
  can contest it (this race), `localizedDuel(owner, interceptor,
  ["Passing","Technique","Decisions","Teamwork"],
  ["Positioning","Anticipation","Tackling","Decisions"])` decides
  whether that physical win becomes a clean interception or the ball
  still somehow gets through. Reused exactly as Continuous World Motion
  v1 built it -- not new logic, just fed by the new race instead of
  `earliestReachableInterception()`'s ground-only, defender-only one.

### Interfaces explicitly reserved for later slices (not built now)

- `spin`: field always `null` on the flight descriptor this round; a
  later slice can add curl/dip to `ballPositionAtElapsed()`'s lateral
  component without changing the descriptor's own shape.
- Real bounce physics: ground-height passes never go negative this
  slice (no overshoot-then-bounce state machine); a later slice adds one
  when a firm pass's real distance would overshoot its intended point.
- Headers: `height(t) > CONTACT_HEIGHT_YARDS` is a hard "not contact-
  eligible yet" gate this slice, not "nobody can ever touch it there" --
  a later slice adds a SECOND, much higher jump-reach threshold and a
  header-specific contact branch, reusing the same `height(t)` sampling.
- Crosses/clearances/aerial contests: `resolveCross()` keeps its own
  existing delivery/aerial-duel pipeline entirely untouched this round;
  migrating it onto `matchPassFlight.js`'s shared primitives once Slice
  1 is proven in the live app is explicitly a later-slice task.
- `simulated.ballState` integration: `resolvePass()` still reasons off
  raw roster points this slice, same as today, rather than reading/
  writing `runConstructedPossession()`'s own `ballState` object
  mid-resolution -- a real integration is worth doing once Slice 1 is
  stable, not bundled into this already-large round.

### What Slice 1 replaces vs. leaves untouched

**Replaced inside `resolvePass()`:** the flat, always-ground delivery
model and its single accuracy-error curve; `earliestReachableInterception()`'s
defender-only, ground-only race (replaced by the unified
`earliestReachableContact()`); the receiver's separate `contactArrivalTiming()`-
driven arrival check (folded into the SAME unified race instead of a
second, independent check).

**Unchanged:** `resolveReceive()` (production, called exactly as today);
`localizedDuel()`'s own interception-outcome layering (reused, not
rewritten); `reactOffBallContinuous()` and the `DEF.PRESS.RECEIVER`
pattern (still drive everyone NOT in the contact race); `resolveCross()`,
`resolveThroughBall()`, `resolveDribble()`, `resolveCarry()`,
`resolveShoot()`, all keeper/offside logic, and all production code
(`draft-run.js`, `matchEngineCore.js`).

### Required Slice-1 acceptance tests (verbatim from the request)

1. A 50-metre pass is not normally selected as a standard ground pass.
2. Intended point and actual trajectory endpoint can differ.
3. The ball never changes course to meet the receiver.
4. Fast and slow players have measurably different interception times.
5. A defender can reach the ball before the intended receiver.
6. Nobody reaching the trajectory produces a loose ball.
7. Players retain continuous velocity throughout flight.
8. No reception-time movement burst occurs.
9. Same seed reproduces the complete trajectory and outcome.
10. Existing production paths remain unchanged until this vertical
    slice is explicitly integrated.

(Implementation and verification of these follows this doc entry --
see the dated addendum below once Slice 1 lands.)

### Implementation addendum (2026-08-20) -- Slice 1 landed

Built as designed above: new `src/lib/matchPassFlight.js`
(`selectPassType`, `laneObstruction`-based lane congestion reuse,
`passFlightProfile`, `buildPassFlight`, `ballPositionAtElapsed`,
`ballHeightAtProgress`, `reactionDelayMsFor`, `earliestReachableContact`),
`passFlightDurationMsForType()` alongside the existing (unmodified)
`passFlightDurationMs()` in `match-lab.js`, and `resolvePass()`
restructured around the unified race exactly per the "what Slice 1
replaces vs. leaves untouched" section above. `resolveCross()`,
`resolveThroughBall()`, and production code confirmed untouched both by
inspection and by a structural test (criterion 10) that greps their own
function bodies for any reference to the new module.

**A real, load-bearing bug caught before ever reaching a live test: the
missing stretch-tolerance.** The design doc's own `earliestReachableContact()`
sketch checked `reachableYards >= neededYards` -- pure locomotion, no
allowance for closing the last step with an outstretched leg. Verified
directly with a real fixture (a defender starting *right next to* the
passer, roughly on the direct line to a nearby receiver -- the kind of
textbook interception this project's own earlier "same two players
trading interceptions" bug report was about): the defender's own
distance-to-ball never dropped much below ~1 yard even at their closest
approach, and a 120-260ms reaction delay plus `reachIn()`'s
accelerate-from-a-dead-stop physics meant they could never close even
that 1 yard in time -- ZERO interceptions found across 500 seeds on a
fixture that should produce them routinely. `earliestReachableInterception()`
(Continuous World Motion v1) already carried exactly this allowance
(`interceptRadiusYards = 1.5`, matchMovementTiming.js) for the identical
reason; `earliestReachableContact()` was missing it entirely. Added with
the same default, applied symmetrically to every candidate (receiver
included, not just defenders) -- fixed the interception-search test
outright and is now load-bearing for realistic short-range contests
generally.

**A genuine structural discovery, not a bug: the intended receiver has a
built-in advantage a nearby defender doesn't share.** Because the ball's
own `actualEndpoint` is always aimed AT the receiver (intended point +
accuracy error), the receiver's own distance-to-ball shrinks
monotonically toward zero as the flight progresses -- a defender
positioned near the receiver's landing area, even a fast one, was found
to essentially never win the unified race for a long pass (0/300 across
a dedicated sweep), while the SAME defender positioned near the PASSER
instead -- pressuring the release, before the ball gets moving or
(for a lofted/aerial type) rises out of reach -- found real interceptions
at a healthy rate (44-75/300, sweep in the test file's own history).
This matches real football intuition (closing down the source beats
anticipating the landing spot for a genuinely long ball) and several
acceptance-test fixtures were positioned accordingly rather than treated
as a defect to route around.

**A unit-conversion bug in test fixtures, not in the library.** Several
scratch verification scripts (and one committed test fixture, section 22)
computed "yards to percent-space" using PITCH_WIDTH=68/PITCH_LENGTH=105 --
the ACTUAL constants (`pitchGeometry.js`) are 75 and 120. `matchPassFlight.js`
itself only ever calls the real `yardDistance()`/`toYardPoint()` functions
and was never affected; a fixture intended to land at ~14 real yards
(safely "ground") actually landed at 15.45yd, tipping `selectPassType()`
into "lofted" and silently defeating the test's own premise (a defender
on the direct line, now correctly un-interceptable while the ball arcs
over them -- see the structural point above). Fixed by computing fixture
coordinates from the real constants directly instead of assumed values.

**Test suite updated for the new architecture, several sections
retired/rewritten, not just re-run:**
- Section 3 ("ballEnd is the defender's real point") asserted exact
  equality with the defender's PRE-KICK static position -- the literal
  "sends the ball to the defender's static position" bug this whole
  initiative exists to remove. Changed to a proximity check.
- Section 22's lane-defender fixture re-derived at the correct real
  distance (see the unit-conversion bug above).
- Section 61's "unreachable delivery" fixture no longer produced a real
  gap once the interceptRadius tolerance applied to the receiver too --
  re-probed empirically for parameters (a genuinely poor passer, not
  merely weak, over a real ~25yd distance) that still reliably find a
  real miss within the same 500-seed search budget.
- Section 64 (Continuous World Motion v1's own acceptance tests, written
  before this round) needed four fixes: (d) discovered the new "meet the
  ball early" behavior means a long-pass reception's own authored
  distance is now REAL ground covered, not small -- assertion changed
  from an arbitrary small-distance threshold to a physical-plausibility
  bound (`reachIn()` ceiling + the race's own stretch tolerance); (e) and
  (f) repositioned their interceptor fixtures near the passer per the
  structural discovery above; (g) reused the SAME mutable roster-entry
  objects across two "replay" calls, so the second call silently started
  from the first call's END positions (`resolvePass()` now genuinely
  mutates positions via `DEF.PRESS.RECEIVER`) -- fixed by cloning a fresh
  fixture per call, a test bug, not a determinism bug in the resolver.
- New section 65 encodes the ten Ball Flight v2 acceptance criteria
  verbatim as thirteen named checks, mixing direct primitive-level
  verification (`matchPassFlight.js` functions imported and exercised
  directly, no DOM stub needed) with full `resolvePass()` end-to-end
  checks where the criterion is about resolver behavior specifically.

Verified: full 14-suite regression green (`test-draft-game.mjs` --
production -- confirmed still passing, untouched); the new section 65's
13 checks green; an 800-seed direct `resolvePass()` fuzz sweep (0-5
randomly placed/attributed opponents, fully random positions across the
whole pitch) -- zero crashes, zero bad coordinates, zero contract
violations, a plausible outcome distribution (568 clean, 63 contested,
8 lost-on-contest, 3 intercepted, 158 offside across 800 fully random
placements); the existing 500-seed `runConstructedPossession()` sweep
still green unchanged. `match-lab.js` cache-bust bumped to
`?v=20260820-09`; its own import of the new `matchPassFlight.js` bumped
to `?v=20260820-02` after the interceptRadius fix.

Not built this round (unchanged from the original scope list above):
spin, real bounce physics, headers, migrating cross/clearance/through-
ball onto these shared primitives, visual height rendering, and
`runConstructedPossession()`'s own `ballState` integration.

## Free Play one-on-one routing and reactive goal net — 2026-08-20

The reported Ronaldo–Michael Stensgaard fixture exposed a routing defect,
not ordinary variance. `resolveShoot()` sent every Free Play shot through
the generic defended-box save curve. Around an even duel, its
`probability ** 2.6 * 0.55` conversion is roughly nine percent, even when
no defender exists. The action-specific `ONE_V_ONE.*` system was present
but Free Play never called it.

Free Play now classifies a genuine one-on-one from explicit geometry:
the keeper must be between the attacker and the attacking goal, the chance
must be within 24 yards with a usable angle, and no defender may occupy the
shot lane or a nine-yard recovery radius. Real defender pressure is passed
through unchanged; an empty fixture is exactly zero, never a fabricated
minimum. Eligible chances use independently seeded decision, execution,
and keeper-response streams and resolve place, blast, chip, round-keeper,
square-pass, and early-shot choices through the existing action-specific
resolvers.

The targeted keeper response is calibrated from shot execution quality,
actual keeper travel, distance, angle, defender pressure, relevant keeper
attributes, and CA matchup. It does not install a Ronaldo-only floor. In
the exact central fixture (Ronaldo CA 191 at x50/y84 against Stensgaard CA
139 at x52/y96, no defender), 2,400 deterministic trials now produce
1,263 goals: **52.6%**, with all 2,400 attempts confirmed on the one-on-one
route.

Goal presentation now has a separate terminal geometry. A scored ball
continues only 1.15 pitch-percent units beyond the line, inside the drawn
goal, while misses/corners retain the wider out-of-play endpoint. The
appropriate top/bottom CSS net mesh receives a localized left/center/right
impact plus placed/power depth, ripples once, springs back, and renders in
front of the resting ball so the ball reads as caught by the net. This is
presentation-only: the resolver still declares the goal first.

Regression coverage verifies the exact matchup stays at or above 51% but
below 75%, never falls back to generic `K.SAVE`, the goal endpoint is
inside the net, and both top/bottom ripple definitions remain present.

### Playback contact collision fix — 2026-08-20

A sparse-roster run exposed two contacts at 7,994ms whose actor marker was
about 0.28 yards from the authoritative ball point. The contact resolver was
not wrong: the later, post-action tactical reshaping event was incorrectly
tagged `overlapWithPrevious:true`. Playback consequently placed that later
movement's endpoint on the preceding action's end timestamp, replacing the
contact keyframe during track normalization.

`reactOffBallContinuous()` now distinguishes its two uses explicitly.
Movement genuinely occurring during a pass keeps the concurrent default;
the full tactical reshape called after a completed action passes
`overlapWithPrevious:false` and receives its own sequential interval. A
focused timeline regression authors a delivery, contact, and post-contact
reshape and verifies the actor is exactly at the ball at contact time, then
reaches the new tactical position only afterward. Playback build `-05` and
the browser entry cache keys were bumped with the fix.
