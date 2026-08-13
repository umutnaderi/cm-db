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

### Next up, in order

1. Ball -- done (Phase 2 v1).
2. Real passer/ball-owner role -- done (Phase 3).
3. Action-choice + partial-resolution + `runConstructedPossession()` --
   done (Phase 3).
4. Free Play as default mode, Scenario Probe demoted, Step hidden for
   single-event traces -- done (Phase 3).
5. Rebound-scramble follow-up (the missing phase found via actual use) --
   done (post-Phase-3 fix).
6. Spatial Intelligence Lite (engagement threshold, real target selection,
   zone/pressure weighting) -- done (Phase 4).
7. Store the full run as `lastRun = { seed, setupSnapshot, result, trace }`
   rather than only `lastTrace` -- cleaner grounds for any future 2D
   playback than the current trace-only shape. Not started.
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
