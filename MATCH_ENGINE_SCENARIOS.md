# Match Engine Scenario Design

Last updated: 2026-08-10

## Purpose

`draft-run.js`'s match engine already resolves goals, chances, tackles, and
cards through attribute-weighted RNG (`localizedDuel`, `shotChance`,
`engineAttributeDetail`), but most non-goal outcomes collapse into one
generic `kind: "chance"` or `kind: "tackle"` event with little branching and
thin commentary variety. This document specifies a richer, hierarchical
scenario tree — a small number of **reusable heuristic shapes**, instantiated
many times with different attribute weights and zone-band configuration, so
adding a new scenario is mostly configuration, not a new formula.

Every scenario has a dot-path code (e.g. `X1.D.3`) so a specific branch can be
referenced precisely in code, commentary, and later, sound triggers. A code
identifies *which decision point*; it does not encode zone-band or origin —
those are parameters read at resolution time, so the same code stays reusable
across contexts (see "Zone-band and origin conditioning" below).

## Zone system (already exists)

`draft-run.js` already has a 12-zone grid: `ZONE_CENTERS` (4 rows × 3
columns), `ZONE_TRANSITION_MATRIX`. Row 0 (zones 0–2) is the shooting/box row
— zone 1, its center, is the universal shot-target in `spatialAction()`. Row
3 (zones 9–11) is the deep defensive/build-up row. Rows 1–2 are midfield
bands, and row 2 can "bypass" straight to row 0 (a through-ball skipping
midfield), which is already final-third logic.

For scenario design, band the 4 rows down to 3 for authoring purposes: **own
third** (row 3), **midfield** (rows 1–2), **final third** (row 0). Split
further only if playtesting shows a band feels flat.

## Reusable heuristic shapes

These five are the actual "engine" of the new tree. Every scenario family
below is built from these, differently configured.

### Contested Race

Who reaches the ball/space first — attacker vs. defender.

- Attacker: `Pace`, `Acceleration`, `Anticipation`, `Off the Ball`
- Defender: `Positioning`, `Anticipation`, `Strength` (+ `Marking` specifically
  for aerial/cross contests — distinct from Positioning, which is general
  spatial awareness; Marking is tracking a specific opponent's movement)
- Zone congestion penalty via the existing `CONGESTED_ZONES` mechanic
- Same attribute pairing the engine already uses for its rebound duel
  (`localizedDuel` call, draft-run.js:2542) — this shape isn't new, just
  named and generalized

### Decision Menu

A player picks among tactical options, weighted by their own attribute
profile and situation; each option is then resolved by its own mechanic.
Instantiated as:

- Defender's engagement choice (`D.STAND` / `D.SLIDE` / `D.DUEL`)
- Attacker's finish-type choice (`F.SELECT`)
- Ball-carrier's core choice (`P.SELECT`: dribble / shoot / pass)
- Free-kick taker's choice (`FK.SELECT`: shoot / cross / short)
- Set-piece taker's choice (`DELIVERY.SELECT`: target / short)

### Finish Quality (open play)

- `F.SELECT` — weighted menu: `F.CALM` (Composure+Technique+Finishing bias),
  `F.BLAST` (low-Composure/rushed bias + Finishing), `F.FINESSE`
  (Technique+Flair bias)
- `F.CALM` resolves vs. keeper `Reflexes+Positioning`; failure = saved,
  blocked, or a weak/soft miss
- `F.BLAST` resolves vs. keeper `Reflexes`; failure = parried (→ rebound) or
  over the bar ("row Z") when Technique/Finishing are poor
- `F.FINESSE` resolves vs. keeper `Positioning+Anticipation`; failure = saved
  or curls wide (not over) when Technique/Finishing are poor
- `F.DEFLECT` — cross-cutting modifier, not a fourth type. Triggered by a
  nearby recovering defender or (for free kicks) the wall. Should skew
  *toward* beating the keeper (he was set for the original trajectory),
  distinct outcomes for a committed block vs. a desperate stretching one

Header finishes use the same shape with `Heading` as the primary input
(previously implied, now formalized) and get a power bonus when the
originating delivery was an outswinging cross (see Delivery).

### `K.SAVE` — keeper resolves an on-target shot

| Code | Outcome | Weighted by | Result |
| --- | --- | --- | --- |
| `K.SAVE.0` | No touch, beaten clean | Shot quality vs. `Reflexes+Positioning+Agility` | Goal |
| `K.SAVE.1` | Collects cleanly | High `Handling` | Terminal |
| `K.SAVE.2` | Parries/drops it | Low `Handling`, or high shot power | Rebound duel |
| `K.SAVE.3` | Tips it around/over | High `Reflexes+Positioning` | Terminal, corner |
| `K.SAVE.4` | Fumbles, recovers | Borderline `Handling` | Terminal — same outcome as `.1`, different commentary only |
| `K.SAVE.5` | Fumbles, fails to recover | Low `Handling`, high shot power | Rebound duel |
| `K.SAVE.6` | Save, cannons off post, back in play | Same as `.2` | Rebound duel |
| `K.SAVE.7` | Save, cannons off post, out | Same as `.3` | Terminal, corner |
| `K.SAVE.8` | Save, cannons off post, still goes in | Rare — inverse `Positioning` | Goal despite the save attempt |

Add `Jumping Reach` alongside `Handling` for aerial claims (crosses/corners).
Weights shift with context: inswinging crosses skew toward `.2`/`.5`/`.6`
(messy); power shots skew toward parries over clean catches; post-hits are
more likely off corner-seeking finishes (`F.CALM`, `F.FINESSE`) than `F.BLAST`.

### `K.ONEONONE` — isolated breakaway, no defensive cover

Triggered by a decisive Contested Race win, a successful `P.DRIBBLE`, or a
clean counter-attack break. Composure-driven rather than power/placement.

| Code | Outcome | Driven by | Result |
| --- | --- | --- | --- |
| `K.ONEONONE.1` | Composed finish, slotted past him | Attacker `Composure` | Goal |
| `K.ONEONONE.2` | Rushes it, drags wide/over | Low `Composure` | Terminal |
| `K.ONEONONE.3` | Keeper commits, smothers/blocks | High `One on Ones` | Usually terminal; can spawn a Contested Race if support is arriving |
| `K.ONEONONE.4` | Chip/dink over the advancing keeper | `Technique+Flair+Composure`, high risk | Goal if it lands; loops wide/claimed if under-hit |
| `K.ONEONONE.5` | Keeper narrows the angle, no shot on | High `One on Ones+Positioning` | Chance evaporates — downgrades to a normal `F.*` shot or a square pass |
| `K.ONEONONE.6` | Fouled before finishing | — | Routes into Foul/Discipline — near-automatic last-man red, penalty if in the box |

Inputs: attacker `Composure+Finishing+Technique` (+`Flair` for the chip) vs.
keeper `One on Ones+Positioning` (+`Reflexes` for reaction saves).

## Scenario families

### `P.*` — the core, most-referenced hub

Originally sketched as `CS001`/`CS0010`/`CS0011`/`CS0001`; renamed for
consistency with the rest of the tree (`P` = Possession/player-on-the-ball).

- `P.SELECT` — the Decision Menu itself: dribble / shoot / pass
- `P.DRIBBLE` — Contested Race to beat the marking defender. Success loops
  back to a fresh `P.SELECT` (or `K.ONEONONE` if the last line was beaten);
  failure routes into `D.*`. `Balance` matters here — staying upright under
  a challenge that doesn't quite win the ball. **Not yet fully specced.**
- `P.SHOOT` — straight into `F.SELECT`
- `P.PASS` — `Vision` to spot the pass/run (distinct from `Passing`, which
  executes it), `Teamwork` as a light inclination modifier. Success hands
  off to a teammate who faces a fresh `P.SELECT`; failure is a turnover —
  candidate trigger for the (still unspecced) counter-attack scenario

Almost every other family eventually hands off back into `P.SELECT` — a
defender's composed pass-out, a free kick's short option, a won loose ball.

### `X1` — cross from the right, contested in the box (row 0)

- `X1.R` — Contested Race, heavy congestion penalty (always near
  `CONGESTED_ZONES`)
- `X1.D` (defender wins) — Decision Menu, box-banded:

  | Code | Outcome | Row-0 weight | Spawns |
  | --- | --- | --- | --- |
  | `X1.D.1` | Clears long/behind | 45% | Terminal, resets to row 2/3 |
  | `X1.D.2` | Heads/passes back to keeper | 25% | Terminal, build-out |
  | `X1.D.3` | Composed pass to a teammate | 10% (deliberately rare) | Failure births a *more dangerous* turnover-chance than a rebound |
  | `X1.D.4` | Mishits/fails to clear | 20% | Births `X1.R2` — box scramble, elevated danger |

- `X1.A` (attacker wins) — `F.SELECT`, gated by how the ball arrived (a
  grounded first touch excludes header/diving-header options; low `Jumping
  Reach` shifts weight toward "controls it" over a header attempt)

### `M1` — loose-ball duel in open midfield (row 2)

Same shapes as `X1`, same code structure, deliberately different weights and
different spawned children — this is the concrete proof the shapes actually
generalize by zone-band, not just by re-scaling a single formula:

| Code | Outcome | Row-2 weight | Spawns |
| --- | --- | --- | --- |
| `M1.D.1` | Clears/boots long | 15% | Terminal, loose ball upfield |
| `M1.D.2` | Lays back safe | 15% | Terminal |
| `M1.D.3` | Composed pass to a teammate | 55% (the obvious choice with time/space) | Failure births a **turnover → counter-attack**, not a rebound — structurally different child than `X1.D.3`'s failure |
| `M1.D.4` | Mishits/loses control | 15% | Births a low-danger midfield 50-50 rescramble |

### `D.*` — defender engagement (Stage A of the tackle system)

Decision Menu among three engagement types, each with its own risk profile:

| Code | Engagement | Selection leans on | Risk profile |
| --- | --- | --- | --- |
| `D.STAND` | Standing tackle | Balanced `Tackling+Positioning+Anticipation` | Default, moderate |
| `D.SLIDE` | Sliding tackle | High `Aggression`/`Bravery`+`Tackling`; weighted up when the Contested Race was lost/close | High risk/reward — inherently harsher foul severity, and a failed slide leaves the defender grounded and out of the phase (transient flag, same family as existing `manDownUser`/`manDownOpponent`), giving the attacker meaningfully more space on the follow-up than a failed `D.STAND` would |
| `D.DUEL` | Standing duel/jockey | High `Positioning+Composure+Strength`, low `Aggression` | Conservative — narrow outcome range (delays/shepherds wide, or attacker shakes free), almost never fouls |

Each of `D.STAND`/`D.SLIDE` shares the same three-outcome shape:

1. **Wins it clean** — `D.SLIDE` weighted toward a more decisive dispossession
   (ball out for a throw-in) more often than `D.STAND` (more often deflects
   loose while staying live)
2. **Ball comes loose** — births a Contested Race
3. **Fails to gather** — sub-branches: foul (→ Foul/Discipline), beaten clean
   (attacker retains, phase continues), or "challenge continues" (re-roll the
   Contested Race rather than a hard terminal branch)

Shot-blocking (throwing the body in front of a shot, `Bravery`-driven) is a
related, related but **not yet specced** outcome, distinct from a standard
tackle.

### Foul/Discipline system

Mostly new — no in-play penalty-kick mechanic exists today (only the
end-of-match shootout, `preparePenaltyShootout`/`penaltyTakers`/
`penaltyRating`, which is a good reuse target for the taker-selection and
success-probability math). One existing precedent: `kind: "card"` already
fires for fouls stopping a break/transition, with second-yellow-to-red
already tracked.

1. **Advantage check first** — if the attacking side visibly retains control
   despite contact, play continues; the foul can still be carded
   retroactively once the phase ends, same as real refereeing
2. **If play stops, restart by zone**:
   - Inside the box → **penalty kick** (new — reuse shootout math for a
     single kick)
   - Elsewhere → free kick (feeds directly into `FK.*`)
3. **Card severity**:
   - Last-man foul (denies a clear goalscoring chance, e.g. `K.ONEONONE.6`)
     → automatic red regardless of contact severity
   - Otherwise: weighted by how badly the tackle-selection roll failed (a
     marginal `D.STAND` mistiming leans no-card/soft-yellow; a reckless
     `D.SLIDE` from behind leans hard toward yellow/red), plus the
     defender's own `Aggression`/`Bravery` as a standing bias so habitually
     aggressive players accumulate more cards independent of any single roll

### `FK.*` — direct free kicks

- `FK.SELECT` — Decision Menu: shoot / cross / short, weighted by zone
  (closer+central → shoot) and taker's `Free Kick Taking` (a poor specialist
  shifts weight to the short option even from a good position)
  - `FK.SELECT.SHORT` loops back into `P.SELECT` for the receiving teammate
  - `FK.SELECT.CROSS` merges into `DELIVERY.*`
- `FK.SHOT` — **does not reuse open-play `F.SELECT` weights** (dead-ball
  shooting is a distinct, practiced skill):

  | Sub-type | Primary (majority) | Secondary |
  | --- | --- | --- |
  | `FK.SHOT.REGULAR` | `Free Kick Taking` | `Technique` |
  | `FK.SHOT.HARD` | `Free Kick Taking` | `Long Shots` |
  | `FK.SHOT.CURL` | `Free Kick Taking` | `Technique` |

  `Free Kick Taking` aliases to the legacy combined `Set Pieces` attribute for
  editions that don't split Corners/Free Kicks/Penalties (cm9596–cm9798) —
  same alias fallback already established in `attributeGeneration.js`.
- `FK.WALL` — new mechanic, structurally the same as `K.SAVE`'s Tier 1 (does
  the obstacle make contact):
  - `FK.WALL.PAST` → proceeds into normal `FK.SHOT` → `K.SAVE` resolution
  - `FK.WALL.HIT` → loose ball (Contested Race reuse), deflects and
    wrongfoots the keeper (`F.DEFLECT` reuse — a wall block is mechanically
    the same as a defender's blocking touch), or deflects out of play

### `DELIVERY.*` — shared by corners and wide free kicks

One mechanism, two attribute configurations by origin:

- `DELIVERY.SELECT` — target menu (front post / back post / penalty spot /
  six-yard box / the arc) or short pass
  - From a **corner**: `Corners` majority, `Technique` secondary
  - From a **wide free kick**: `Crossing` majority, `Technique` secondary
    (mechanically just an open-play cross taken from a dead ball)
- `DELIVERY.SWING` — inswinger vs. outswinger, derived from the taker's
  preferred foot (`foot_json`, already in every player's profile) relative to
  which side the delivery comes from — probabilistic, heavily weighted
  toward the natural pairing, not a hard rule (tactical variety allowed)
  - **Inswinger**: keeper heavily involved but error-prone — `K.SAVE`
    weighted toward messy outcomes (`.2`/`.5`). `DELIVERY.INSWING.GHOST` — a
    new terminal outcome: untouched, keeper fails to claim cleanly, goes
    straight in
  - **Outswinger**: keeper *less* involved at all (ball moving away from
    goal) — resolution weight shifts onto a Contested Race/heading duel
    between outfield players instead of `K.SAVE`. Clean headers get a power
    bonus (attacker moves into the ball's outward curl). Untouched drifts for
    a throw-in, not a goal-kick

## Attribute reference (new/clarified placements)

| Attribute | Node | Note |
| --- | --- | --- |
| `One on Ones` | `K.ONEONONE` | New — distinct scenario, not a `K.SAVE` modifier |
| `Jumping Reach` | `K.SAVE` (aerial claims) | Previously under-weighted (Handling only) |
| `Vision` | `P.PASS` | Spots the pass/run; distinct from `Passing`, which executes it |
| `Work Rate` | Player-selection layer | Not a duel-outcome attribute — determines *who* is contesting a loose ball or arriving late, before any attribute duel happens |
| `Bravery` | `D.SLIDE` selection, shot-blocking (unspecced) | |
| `Marking` | Contested Race (aerial/cross specifically) | Was conflated with `Positioning`; distinct — tracking a specific opponent, not general spatial awareness |
| `Teamwork` | Any "involve a teammate" outcome | Light modifier |
| `Leadership` | Already handled via the existing captain multiplier (`teamModel()`, ×1.1) | No new per-event slot planned |
| `Heading` | Header finishes (`F.*`) | Formalized, was implied but unassigned |
| `Balance` | `P.DRIBBLE`, tackle-recovery | Staying upright under a challenge |
| `Stamina` | Already handled globally via the existing condition/fatigue system | No new per-scenario slot |

## Open items — not yet fully specced

- `P.DRIBBLE` full resolution (Contested Race inputs exist; the "what
  happens after beating him" menu does not)
- Counter-attack scenario (promised by both `M1.D.3` and `P.PASS` failure —
  the engine already has `goalType: "counter"` and a `counterSteps` tracker,
  so this composes from existing plumbing, just needs its own dot-path family)
- Shot-blocking as a distinct `Bravery`-driven outcome, separate from a
  standard tackle

## Implementation plan

1. ~~Build the five reusable heuristic shapes as clean, testable functions
   first — no scenario wiring yet.~~ Done — `contestedRace`, Decision Menu
   (`weightedChoice`, pre-existing), `selectFinishType`/`resolveFinishAttempt`,
   `resolveKeeperSave`, `resolveOneOnOne`.
2. ~~Wire up one complete vertical slice end-to-end: `P.SELECT` → `P.SHOOT` →
   `F.SELECT` → `K.SAVE`/`K.ONEONONE`.~~ Done and calibrated (goal rate,
   outcome-code diversity verified against a live-match harness).
3. ~~`D.*` + Foul/Discipline~~ Done — `selectEngagement`/`resolveEngagement`,
   `resolveFoul`, `resolvePenaltyKick` (new in-play penalty mechanic,
   previously only the end-of-match shootout existed), `K.ONEONONE.6` wired
   in. Calibrated after a real bug (245 red cards/180 matches, traced to an
   over-eager last-man proxy plus second-yellow escalation from too-high a
   base yellow rate) down to realistic rates.

### External review and reprioritization (2026-08-11)

A ChatGPT review of this document (prompted independently, not by us) landed
on the same structural gap we'd already flagged — the counter-attack scenario
— and added a substantial amount of additional design thinking: an Action
Geometry layer under `P.SELECT`, a pressure/space model, receiver selection
before passing, first-touch as an event, body orientation, team tactical
state, score/time-adaptive behavior, zone overload, cutbacks, carry-vs-dribble
distinction, hold-up play, expanded keeper actions (`K.CLAIM`/`K.SWEEP`/
`K.DISTRIBUTE`), emergent (not random-roll) errors, and attributes-as-
distributions instead of deterministic bonuses. Full point-by-point source
review not reproduced here — see conversation history if needed.

Assessment: complementary, not contradictory, but far too much to adopt at
once on top of a system that's only just been stabilized. Three items were
judged high-value *and* buildable as additive layers on the existing,
calibrated shooting/defending pipeline (not a rebuild of it):

- **Pressure as a first-class variable.** We already have pressure-*shaped*
  effects scattered across `CONGESTED_ZONES`/`zonalAttribute`,
  `momentumMultiplier`, `moraleMultiplier` — this consolidates the concept
  rather than adding a parallel one, and gives `counterSteps` a real
  "defense hasn't organized yet" effect instead of just labeling `goalType`.
- **Transition/counter-attack state.** Already owed (see Open items above,
  and `M1.D.3`/`P.PASS` failure both promised this). Naturally shares
  machinery with the pressure work — a fresh turnover is low defensive
  pressure, which is the same signal either way.
- **Receiver selection feeding a real `P.PASS`.** Currently a successful
  advance (`transitionDuel.won`) just moves the ball to `nextZone` with no
  notion of *which* teammate receives it — the next tick's `actor` is
  re-rolled generically. This is the concrete gap behind the "Thomas Müller"
  point: his attribute edge should be appearing as a receiving option more
  often, not a flat stat bonus.

Everything else from the review is real but deferred — captured in the
**Deferred backlog** below rather than dropped, so it survives past this
session.

4. ~~Pressure + transition-relief, then receiver selection / `P.PASS`.~~ Done
   — `computePressure()` (congestion + defender intensity + transition
   relief, folded into the shot on-target gate) and `selectReceiver()`
   (Off the Ball/Anticipation/Work Rate/Pace-weighted, sharpened or flattened
   by passer Vision and pressure, wired via a `pinnedNextActor` the next tick
   prefers over a generic re-roll).
5. ~~`X1`/`M1` (crosses and loose balls).~~ Done. `X1` is a new open-play
   crossing mechanic (reached whenever a wide attacker doesn't successfully
   cut the ball back) — an aerial Contested Race decides the header duel;
   winning attacker goes through a new `header` finish type added to the
   existing `F.SELECT`/`K.SAVE` tables (reuse, not a new pipeline), winning
   defender routes into `resolveEngagement` treated as a standing/aerial
   clearance (no slide tackle for a header). `M1` needed no new trigger point
   at all — it's the same "ball comes loose" path `D.*` already had, now
   genuinely zone-differentiated: `resolveEngagement` takes a `zoneRow` and
   is box-safety-biased (rarer composed "beaten", scrappier loose-ball
   outcomes) at row 0, calmer everywhere else — the concrete proof the
   shapes actually generalize by zone-band rather than needing per-zone
   rewrites.
6. ~~`FK.*`/`DELIVERY.*` (set pieces).~~ Done. `DELIVERY.SELECT`/`SWING`
   built as one shared function (`resolveDelivery`) used by both corners and
   free kicks — inswing/outswing derivation from foot data deferred (not
   currently plumbed into match players), replaced with a coin flip that
   still captures the real gameplay asymmetry (inswing: `DELIVERY.INSWING.GHOST`
   risk + a messiness bump toward rebounds; outswing: keeper pulled out of
   the contest more, header power bonus, unconnected balls drift for a
   throw-in). `FK.SHOT` uses its own Free Kick Taking-dominant weighting
   (`regular`/`hard`/`curl`), deliberately not reusing `F.SELECT`'s weights.
   `FK.WALL` is new — does the shot even clear the wall, reusing Contested
   Race for a loose rebound and the same "deflection favors the attacker"
   idea as `F.DEFLECT` for a wall touch.

   Two real bugs found and fixed in the process, not just new scenarios:
   - The old corner-kick mechanic had gone **completely unreachable** —
     every branch of the earlier `P.SHOOT` rewrite ends in `continue`, and
     the corner code sat right after it in the same tick, so it silently
     never ran. Rebuilt as `awardCorner()`, triggered from the specific
     outcomes that actually mean "ball goes behind" (`K.SAVE.3`/`K.SAVE.7`,
     from both `P.SHOOT` and `X1`) rather than a disconnected random roll —
     corners now arise from the event that actually earned them.
   - The new `FK.*` machinery was correct but **practically unreachable**:
     traced a live match and found fouls essentially never land at row 0/1,
     because those zones almost always resolve through a shot/cross attempt
     first (`wideByline`/`X1`/`lateRunners`/`F.SELECT` all fire and
     `continue` before a duel can ever fail for the attacker there) — a
     pre-existing structural property of the tick order, not something this
     phase introduced. Real fouls overwhelmingly land at row 2. Widened the
     free-kick gate from `row <= 1` to `row <= 2` (a plausible real
     long-range/deep free-kick zone anyway, just weighted away from
     shooting) so the built machinery is actually exercised, confirmed via
     live-match tracing before and after.

7. ~~Shot-blocking.~~ Done — `resolveShotBlock()`, Bravery-driven (aided by
   Positioning/Anticipation), scoped to regular open-play footed shots only
   (`P.SHOOT`): headers already have their own contest (`X1`'s aerial
   Contested Race), a genuine breakaway by definition has no defender close
   enough to block, and free kicks have `FK.WALL` as the analogous obstacle.
   Blast/power shots are easier to get a body in front of than finesse/curl
   attempts, which bend away from a block. Three outcomes reusing existing
   machinery: blocked clean behind (`awardCorner()`), blocked into a loose
   rebound (Contested Race, same poacher-vs-defender pattern used
   everywhere else), or blocked safely straight back with no danger.
   Verified in a live-match run: ~0.7 blocks/match, goal/card rates
   unaffected.

8. Remaining: items from the deferred backlog, in the order listed.

## Status: core scenario tree complete

Every family originally scoped in this document is now implemented and
verified: the five reusable heuristics, `P.*`, `X1`/`M1`, `D.*` +
Foul/Discipline (including in-play penalties, new territory when this
started), `FK.*`/`DELIVERY.*`, and shot-blocking — plus the three
promoted items from the 2026-08-11 external review (pressure,
transition-relief, receiver selection). What remains is entirely the
deferred backlog above: real, but no longer foundational. Two dead/
unreachable-code bugs were found and fixed along the way purely by
verifying each addition against live match traces rather than trusting
that passing tests meant a mechanic was actually being exercised — worth
keeping that verification habit for whatever's built from the backlog next.

## Engineering hygiene: tracing, telemetry, reachability audit (2026-08-11)

The corner and free-kick bugs above were both found by manually patching the
source to log gate evaluations during a live match — effective, but ad hoc
and thrown away afterward. Two further rounds of external (ChatGPT) review of
that incident proposed formalizing this into permanent tooling, up to and
including a full rewrite of the tick loop's control flow into an explicit
transition-contract state machine (`{status, nextScenario, nextZone,
possession, restartType, restartZone, context}` returned from every
scenario handler, instead of the current mix of `continue`/fallthrough/
mutated outer-scope state).

Assessment: the observability half (tracing, telemetry, reachability tests)
is unambiguously worth building now — it's what would have caught both bugs
automatically. The full state-machine rewrite is not: it would touch every
existing, calibrated branch of the tree for a correctness property (explicit
reachability) that the new tests now verify empirically instead. Retrofitting
it risks silently shifting the tuned probability distributions (RNG call
order, selection timing, and mutation order all affect outcomes even under an
"algebraically equivalent" refactor) for a class of bug that observability
now catches directly. The review ultimately converged on the same
sequencing — codified as the **Strangler Fig** convention below rather than
a retrofit.

Built:

- **`traceScenario(entry)`** in `draft-run.js`, gated by `MATCH_TRACE=true`
  (Node) or `globalThis.__MATCH_TRACE__` (browser/sandbox) — zero-cost when
  off. Wired into the three places events actually get recorded (`addGoal`,
  `addDuelEvent`, the card-event push in `applyFoulOutcome`), pushing
  `{minute, side, zone, scenario, outcome}` to `globalThis.__matchTrace`.
  Replaces the need to hand-patch source strings to trace a bug in the future.
- **`tools/scenario_telemetry.mjs`** — permanent CLI tool (`node
  tools/scenario_telemetry.mjs [matchCount]`, default 400), the "Observed
  Scenario Graph": runs N seeded matches through the real engine and prints
  every scenario code that actually fired, broken down by zone band
  (`Z0-2`/`Z3-5`/`Z6-8`/`Z9-11`) and a per-match rate. Telemetry, not
  assertions — meant to make distribution absurdities (a dead branch, a zone
  that never gets exercised) visible before they need a dedicated test.
  Two cadences, same tool: `npm run match:telemetry` (400 matches, ~1 min,
  everyday dev/CI check) and `npm run match:audit` (8000 matches, ~20 min,
  occasional — before a release or after touching any probability-heavy
  system). This distinction was a review amendment: 400 matches is a good
  fast regression baseline but not a sufficient statistical one for rare
  events (reds, penalties, `K.ONEONONE.6`, `FK.WALL.HIT`) — a count like
  "7 in 400" can't distinguish "correctly rare" from "badly calibrated but
  gotten lucky." The tool already took `matchCount` as an argument, so this
  was a cheap addition (rate column + npm scripts + a printed reminder below
  ~2000 matches), not new infrastructure.
- **Tiered reachability assertions** in `tools/test-draft-game.mjs`, reusing
  the existing 180-match loop at zero extra runtime cost (a `scenarioTally`
  Map populated alongside the existing per-event assertions):
  - *Required* (must be common): `K.ONEONONE.1` > 30, keeper saves
    (`K.SAVE.0/1/3/4` combined) > 80, `D.BLOCK` > 10, tackle-engagement
    fouls (`CARD.YELLOW`+`CARD.RED`) > 15.
  - *Rare-but-required* (must occur at least once, not be common):
    `corner-header` > 0 (the exact bug that went unreachable), delivery/
    corner outcomes combined > 20, `K.SAVE.7` (post-and-out) > 0,
    `FK.WALL.HIT` > 0 (the exact bug that was structurally starved).
  - *Conditional* items (`K.ONEONONE.6` fouled-breakaway, specific `FK.SHOT`
    on-target codes) are deliberately **not** asserted against random match
    output — per the review, these should be tested via constructed state
    (calling `resolveFoul`/`resolveFreeKickAttempt` directly with mock
    players) rather than hoped-for in a random sample. One such constructed
    test exists so far: `resolveFoul` called directly at zone rows 0-3 with
    `isLastMan=true` (which removes the RNG-driven "advantage" branch),
    asserting `restart` is `"penalty"` only at row 0 and `"free-kick"`
    elsewhere — this permanently encodes the free-kick-gate fix so the row
    boundary can't silently regress.

  Note on event-keying: a foul event's `scenarioType` (e.g. `foul-D.SLIDE`)
  and its `card` field are mutually exclusive in practice — `applyFoulOutcome`
  only ever pushes an event when `foul.card !== "none"`, so every event
  carrying a `foul-*` scenarioType is also a card event. The test tally keys
  card events as `CARD.YELLOW`/`CARD.RED` (matching `scenario_telemetry.mjs`'s
  `outcome` field), so the reachability assertion for tackle-engagement fouls
  checks the card tally, not the raw `foul-*` codes, which by construction
  never appear as a top-level tally key.

**Baseline snapshot** (`node tools/scenario_telemetry.mjs 400`, 7,367 tagged
events across 400 matches) — for reference, not enforced by a test:

| scenario | total | notes |
|---|---|---|
| `K.ONEONONE.1` | 760 | breakaway goals |
| `through-ball` | 748 | |
| `F.CALM.WEAK` | 564 | |
| `K.SAVE.1`/`.3`/`.0`/`.4` | 327/320/257/8 | keeper saves |
| `D.BLOCK` | 299 | |
| `foul-D.SLIDE`/`.STAND`/`.DUEL`/`last-man` | 151/27/10/7 | ≈195 card events total |
| `corner-header` | 45 | |
| `set-piece-scramble` | 32 | |
| `K.SAVE.7` (post-and-out) | 19 | |
| `FK.WALL.HIT` | 7 | thin but present — rare tier |
| `K.ONEONONE.6` (fouled breakaway) | 2 | conditional tier, not asserted |
| `penalty` | 1 | conditional tier, not asserted |
| `FK.SHOT.*` on-target | 0 | not a bug — `resolveKeeperSave` overwrites the
    tag once the shot is on target, same as `F.SELECT`; only the `.WEAK`/
    `.OVER`/`.WIDE` miss siblings ever appear as a top-level scenarioType |

`Z9-11` (own defensive third) has almost no tagged events across any
scenario — a real, load-bearing property of the current design (the ball
only spends time deep in a team's own third during build-up, which mostly
isn't event-worthy), not a bug, but worth remembering before assuming a
"zero in Z9-11" telemetry row signals a problem.

**Strangler Fig convention** (named for the incremental-migration pattern,
per the review): the existing, calibrated tick loop in `buildTransitionTimeline`
is **not** being retrofitted onto an explicit transition-contract shape.
Instead, any **new** scenario family built from here on (starting with the
deferred backlog below) should return an explicit contract object —
`{status, nextScenario, nextZone, possession, restartType, restartZone,
context}` — from its handler, rather than relying on `continue`/fallthrough/
mutated outer-scope `zone`/`side` state the way the existing families do.
This keeps new code's reachability self-evident from its return type while
leaving working, tuned code alone. Existing families migrate opportunistically
if they're touched for other reasons, never as a dedicated rewrite pass.

## Promoted: `P.RECEIVE` (2026-08-11, review round 4 — built)

A follow-up review, after accepting the engineering-hygiene phase above,
proposed resuming football work with `P.RECEIVE` first: a successful pass
currently hands the receiver clean possession for free, with no first-touch
step at all — the concrete gap is a `Passing 20` passer effectively gifting
every recipient a perfect touch regardless of the recipient's own attributes
or the pressure they receive it under. Proposed shape: `P.PASS` → `P.RECEIVE`
→ `{CLEAN, HEAVY, PROTECT, KNOCK_FORWARD, LOSE}`, driven by First Touch/
Technique/Anticipation/Composure/Balance/Strength plus pass quality,
pressure, and ball height/speed. Also proposed, as natural follow-ons:
widening pressure into more decision points, then body orientation
(`FACING_FORWARD`/`SIDEWAYS`/`BACK_TO_GOAL`), framed as "receive → pressure →
orientation" being the single largest realism gain left for ordinary
possession — explicitly *not* touching the full state-machine migration,
which stays quarantined as a future project per the prior round's agreement.

Assessment: right call on sequencing — this is already our own top backlog
item, for the same reason. Two things worth grounding before treating the
proposal as a spec, found by actually reading the relevant code
(`draft-run.js` around line 3589-3634, the generic pass-advance path used
whenever a possession isn't a shot/cross/through-ball):

- **Pressure is not a new system to build.** `computePressure()` already
  exists, already returns a 0.05-0.95 contextual signal (congestion +
  defender intensity − transition relief), and is already in scope at
  exactly the point a new `P.RECEIVE` call would go (`pressure` is computed
  once per tick, right before the actor is chosen). It currently has exactly
  two consumers: `selectReceiver`'s pick sharpness and the shot on-target
  gate. The proposal to have it "influence receiving, passing execution,
  dribbling, shooting, clearances, composure" is real, but it's *widening an
  existing signal to more call sites*, not building pressure from scratch —
  meaningfully lower risk than it might sound.
- **There's already an exact insertion point.** The `if (transitionDuel.won)`
  branch (draft-run.js:3613-3634) is where a successful pass currently just
  does `zone = nextZone; pinnedNextActor = selectReceiver(...); continue` —
  zero chance of a bad touch. A `resolveReceive()` call slots directly in
  here, called with the *already-selected* receiver, the in-scope `pressure`,
  and the receiver's First Touch/Technique/Composure/Balance/Strength. No
  new state threading required.
- **"Ball height/speed" isn't modeled anywhere today.** Rather than invent a
  new dimension, the existing `bypass` boolean (through-ball vs. normal
  advance, already computed right above this branch) is a reasonable proxy —
  same move already made elsewhere (inswing/outswing standing in for
  unavailable foot data). A bypass pass reads as faster/more direct; a normal
  advance reads as grounded/standard pace.
- **Body orientation should not become new persistent player state.** Nothing
  in the engine currently tracks anything about a player across ticks beyond
  `zone`/`side`/`counterSteps`-style scalars — every scenario resolver so far
  is a pure function called with whatever context it needs, computed fresh.
  Introducing a real `orientation` field that must be set at `P.RECEIVE` and
  read back later at the *next* `P.SELECT` would be the first piece of
  genuine persistent per-possession state in the tree, and is exactly the
  kind of thing that turns into unplanned plumbing later. Recommend deriving
  it transiently instead — computed fresh from context at the moment it's
  needed (e.g., a through-ball/offside-break receipt implies
  `FACING_FORWARD`; a backward/lateral pass under close marking implies
  `BACK_TO_GOAL`) rather than stored. Keeps it a same-tick concern, in one
  function, consistent with the Strangler Fig convention above.

### Round 5 refinements (accepted)

A further review round sharpened the v1 above. Three of its four points are
adopted as proposed; one is adopted with a change grounded in what the code
already provides:

- **Pass quality — adopted, with a simplification.** The review is right
  that a receiver shouldn't face identical difficulty from a `Passing 20`
  passer and a `Passing 8` passer once both clear the existing success roll.
  Its proposed fix was a new static formula (`Passing*0.55 + Technique*0.20
  + Vision*0.15 + Composure*0.10`), but it also flagged the better option
  itself: `transitionDuel` (the existing pass-success duel right above this
  branch, draft-run.js:3594-3602) already returns a continuous `probability`
  — the attacker's Passing/Technique/Decisions/Teamwork (or Vision/Passing/
  Creativity/Decisions when bypassing) weighed against *this specific*
  defender's Positioning/Anticipation/Tackling/Decisions. That's a better
  quality signal than a static per-passer formula (it's already
  situational — it reflects this pass, against this defender, not a
  context-free player rating) and it's free: no new formula, no new RNG
  call. `resolveReceive` takes `transitionDuel.probability` directly as its
  pass-quality input.
- **`PROTECT` must not persist synthetic state — adopted, correcting my own
  proposal.** The "small pressure bump on the following tick" I originally
  proposed would have been the first synthetic cross-tick state in the tree
  — exactly what I'd just argued against for body orientation, so the
  review is right to call it out. Fixed: `PROTECT` retains possession, same
  zone, same pinned receiver, nothing else. The next tick's `computePressure()`
  runs unmodified.
- **`KNOCK_FORWARD` must earn its advance, not grant one — adopted.** "Reduced
  duel risk" was a bespoke discount with no real mechanism behind it.
  Correct fix: it's a Contested Race (Pace/Acceleration/Anticipation/Off the
  Ball vs. the covering defender) — win it, advance a zone; lose it, the
  loose-ball/turnover branch. Reuses the same heuristic shape as everything
  else instead of inventing a one-off formula.
- **`LOSE` is the tail of the same Decision Menu, not a separate roll —
  already the plan, now explicit.** `resolveReceive` is one `weightedChoice`
  across all five outcomes (the existing Decision Menu shape, same as
  `F.SELECT`/`K.SAVE`/tackle engagement), weighted by First Touch/Technique/
  Composure/Anticipation, `transitionDuel.probability`, `pressure`, and
  `bypass` — `LOSE` is simply the worst-weighted branch of that one draw,
  not a bolted-on second check.
- **`Balance` belongs to the `HEAVY` recovery, not the initial menu.** Whether
  a touch is heavy is a First Touch/pressure/pass-quality question; whether a
  heavy touch is *recovered* is a Balance/Strength/Anticipation question. So
  `Balance` is an input to the follow-on Contested Race that `HEAVY` triggers
  (recover vs. lose it outright), not to the menu weights that produced
  `HEAVY` in the first place.

`resolveReceive` will be the **first scenario family built directly against
the Strangler Fig contract** documented above — it returns `{status,
nextScenario, nextZone, possession, restartType, restartZone, context}`
rather than mutating `zone`/`side`/`pinnedNextActor` itself; the call site
applies the mutation. Deliberately the smallest possible test of that
convention before more families depend on it.

Explicitly out of scope for v1 (both already separately deferred, and both
noted by the review as not needed yet): pass-direction-aware receiving
(`BACK`/`SIDE`/`PROGRESSIVE`/`THROUGH`/`LONG` all currently resolve
identically — this becomes the natural consumer of Action Geometry once
that's built, not before) and folding body orientation in as its own
implementation phase (try it as a transient detail inside `resolveReceive`
first; only give it a dedicated phase if it turns out to need one).

Verification plan once built: unit test (`resolveReceive` in isolation) +
a constructed-state test pinning specific input combinations to specific
outcomes (mirroring the `resolveFoul` zone-row test already in the suite) +
a live 400-match `npm run match:telemetry` read, checking the outcome split
actually moves with First Touch (high First Touch receivers should show
much higher `CLEAN`), with `pressure` (high pressure should suppress `CLEAN`
in favor of `PROTECT`/`HEAVY`), and with `bypass` (should raise
`KNOCK_FORWARD`/`HEAVY` — a through ball is a harder ball to control cleanly)
+ one `npm run match:audit` pass once the split looks calibrated, to confirm
the rare tail (`LOSE`) isn't secretly common or secretly impossible at
higher N.

### Built

`resolveReceive()` (draft-run.js, next to `selectReceiver`) implements the
above exactly: one `weightedChoice` Decision Menu using `control` (First
Touch + Technique/Composure/Anticipation) against `strain` (pass quality +
pressure + bypass), `HEAVY`'s Balance/Strength recovery duel, `KNOCK_FORWARD`'s
`contestedRace`, and the full `{status, nextScenario, nextZone, possession,
restartType, restartZone, context}` contract. Wired into the
`transitionDuel.won` branch, called right after `selectReceiver` picks the
receiver, reusing the tick's already-computed `pressure` and covering
`defender` — no new state threading needed, as expected. `CLEAN` stays event-
free by design (today's prior behavior, and the dominant case), so it won't
appear in live telemetry; that's intentional, not a gap — its attribute
sensitivity is verified directly via a constructed-state test instead (see
below), which controls for confounds better than a noisy live-match read
would anyway.

400-match telemetry snapshot: `P.RECEIVE.HEAVY` 0.65/match, `PROTECT`
0.51/match, `KNOCK_FORWARD` 0.34/match, `LOSE` 0.06/match — a plausible
starting split (clean touches still dominant, `LOSE` genuinely rare), not
yet tuned against real shot/goal-rate-style calibration targets the way
finishing was; revisit once more of the possession chain (pressure
consumers, body orientation) exists to judge it against.

**One real finding from building this**, exactly the kind of thing the
tracing/telemetry infrastructure exists for: `resolveReceive` consumes
additional `random()` calls on every successful pass, which shifted the RNG
sequence for the rest of every seeded match — and the existing
`tally("FK.WALL.HIT") > 0` assertion (already a thin 7-9/400 in telemetry)
flipped to zero in this one specific 180-match deterministic test run as a
result, despite the mechanism itself staying fully reachable (confirmed via
`scenario_telemetry.mjs` showing 7-9/400 both before and after). This is
precisely the "RNG call order can shift outcomes even under an
algebraically-equivalent change" risk flagged in the engineering-hygiene
round — except here the change wasn't even algebraically equivalent, it was
a deliberate new feature, and the fragility was in the *test*, not the
engine. Fix: moved `FK.WALL.HIT` reachability out of the live 180-match tally
and into a constructed-state test that calls `resolveWall()` directly
(mirrors the existing `resolveFoul` zone-row test) — deterministic and
immune to unrelated upstream RNG changes. A parallel constructed-state test
for `resolveReceive` itself confirms a favorable pairing (elite receiver,
high pass quality, low pressure) produces meaningfully more `CLEAN` than a
hostile one (weak receiver, poor pass, high pressure, bypass), and that the
hostile pairing produces meaningfully more `LOSE`/`HEAVY` — the attribute-
sensitivity check from the verification plan above, done deterministically
rather than hoped-for in a live match.

## Pressure widened, body orientation tried (2026-08-11)

Per the agreed order after `P.RECEIVE`: widen `pressure` into a couple more
decision points, then try body orientation as a transient `resolveReceive`
detail rather than giving it its own phase.

**Pressure**, two new consumers, both decision-*frequency* changes rather
than touching the shared `localizedDuel` core (deliberately — that function
is called from nearly every duel in the tree, including ones that are
already calibrated and tuned; changing its signature would shift every one
of them at once, the exact blast-radius problem the engineering-hygiene
round warned about):

- `selectFinishType(attacker, random, pressure)` — pressure now erodes the
  `calm` weight and inflates `blast`, independent of the shooter's own
  Composure. A composure-related decision, per the review's own framing:
  which finish a player even reaches for, not just whether it lands
  on target (that's the separate, already-existing `pressureMultiplier` on
  the on-target roll).
- `triesKeeperDribble`'s trigger probability (in the `P.SHOOT` chain) now
  scales down with pressure (`0.22` at zero pressure, floor `0.08`) — rounding
  the keeper is a confident, composed decision a player is less inclined to
  attempt after fighting through heavier pressure to get there. The
  `keeperDuel` itself (whether the dribble succeeds) is untouched.

`passing execution` and `clearances` (the other two items on the review's
consumer list) were considered and deliberately not done this round:
folding pressure into the pass-success duel itself would mean touching
`localizedDuel` or `transitionDuel`, the same core-function risk as above;
clearances would need a defensive-side pressure signal that doesn't exist
yet (`computePressure` is currently computed from the attacking side's
perspective only) rather than a clean reuse. Left as explicitly open rather
than forced.

**Body orientation** — `receiveOrientation(bypass, pressure)`, a small pure
function next to `resolveReceive`, derives `FACING_FORWARD` /
`BACK_TO_GOAL` / `SIDEWAYS` fresh from context already available at the call
site (a through ball implies facing forward; high pressure on a normal pass
implies back-to-goal; otherwise the unmodified default) — no new persistent
state, exactly as scoped. Feeds three weight multipliers inside
`resolveReceive`'s existing Decision Menu: `FACING_FORWARD` boosts `CLEAN`
and sharply boosts `KNOCK_FORWARD` ("progressive options open," the
review's own phrase); `BACK_TO_GOAL` sharply boosts `PROTECT` and
suppresses `KNOCK_FORWARD` (you can't knock the ball forward into space
you're facing away from); `SIDEWAYS` is unmodified. `orientation` also rides
along in `resolveReceive`'s returned `context` for telemetry, and lightly
varies `PROTECT`'s event text (a `BACK_TO_GOAL` shield reads differently
from a `SIDEWAYS` one) — no new scenario codes, no dedicated implementation
phase, exactly per the round-5 agreement to try it this way first.

400-match telemetry after both changes: `PROTECT` rose (0.51 → 0.63/match)
and `KNOCK_FORWARD` fell (0.34 → 0.24/match) relative to the pre-orientation
snapshot above — expected, since `BACK_TO_GOAL` (triggered whenever pressure
> 0.5) pushes weight in exactly that direction and turned out to fire more
often than not. `keeper-dribble` fell too (0.60 → 0.42/match), consistent
with the new pressure-gated trigger. Nothing else moved outside normal
run-to-run noise; goal/card rates held. Worth another look once real
calibration targets exist for this part of the tree (same caveat as
`P.RECEIVE`'s own snapshot above) rather than trusting a first-pass
distribution.

## Deferred backlog (from the 2026-08-11 review, not yet scheduled)

- **Action Geometry under `P.SELECT`**: split `P.PASS` into zone-aware
  sub-types (`P.PASS.BACK`/`.SIDE`/`.FORWARD`/`.DIAGONAL`/`.THROUGH`/
  `.SWITCH`/`.CROSS`/`.LONG`), each a different risk/vision/pressure
  parameterization of the same underlying mechanic, not a new formula per type.
- ~~`P.RECEIVE` and body orientation~~ Built — see "Promoted: `P.RECEIVE`"
  and "Pressure widened, body orientation tried" above. Orientation is
  transient (derived fresh inside `resolveReceive`, not persistent state);
  a dedicated implementation phase for it remains open only if that turns
  out to be insufficient later.
- **Team tactical state** (`tempo`/`width`/`directness`/`risk`/
  `defensiveLine`/`pressing`/`counterAttack`/`timeWasting`) modifying decision
  *weights*, never player attributes directly — tactics change what talent
  attempts, not the talent itself.
- **Score/time-adaptive behavior** (`matchContext`: minute, score
  difference, manpower difference) — a match currently plays identically at
  minute 8 and minute 88 regardless of the scoreline.
- **Zone overload** (`attackersNearby - defendersNearby` per zone) biasing
  combination play/cutbacks/dribbles when positive, backwards/switch/long
  ball when negative — gives 2v1s and packed boxes without simulating all 22
  positions continuously.
- **Cutback as its own attacking action** (`X.CUTBACK`, distinct from
  `X.CROSS`) — heavily under-modeled relative to how often it produces real
  chances in modern football.
- **Carry vs. dribble split** (`P.CARRY`: Acceleration/Pace/Off the Ball/
  Decisions, no immediate defender vs. `P.DRIBBLE`: Dribbling/Technique/
  Agility/Balance/Flair, against a defender) — currently `P.DRIBBLE` is
  always modeled as a duel even when no one is actually contesting it.
- **Hold-up play** (`P.HOLD`) for central attackers, especially
  `BACK_TO_GOAL` — Strength/Balance/First Touch/Technique/Teamwork/Decisions
  vs. Strength/Aggression/Marking/Positioning, resolving to layoff/turn/foul
  won/dispossessed/loose ball.
- **Expanded keeper actions**: `K.CLAIM` (crosses/high balls — Aerial
  Ability/Handling/Jumping Reach/Command of Area/Communication), `K.SWEEP`
  (balls behind a high line — Rushing Out/Anticipation/Acceleration/
  Decisions), `K.DISTRIBUTE` (after a save/claim — throw short/pass short/
  kick long/counter release). Noted as already comparatively strong
  (`K.SAVE`/`K.ONEONONE`) — this is rounding the keeper out, not fixing it.
- **Counterpressing** (`PRESS.RECOVER`/`.FAIL`/`.BYPASSED`/`.FOUL`
  immediately after a turnover) — the natural companion to the transition
  work above once that exists.
- **Emergent errors, not a random mistake roll.** Explicitly avoid
  `if (random() < errorRate) mistake()` — a misplaced pass should emerge from
  low Passing + weak foot + high pressure + an ambitious target, a heavy
  touch from poor First Touch + fast delivery + pressure. Already the
  philosophy behind everything built so far; worth stating as an explicit
  rule so it doesn't erode as the tree grows.
- **Attributes as distributions, not deterministic bonuses**: an attribute
  should affect mean quality, variance, *and* failure type — e.g. Finishing
  20 + Composure 18 → high mean, low variance; Finishing 20 + Composure 7 →
  high ceiling, high variance. Retrofittable into existing heuristics
  (`F.SELECT` etc.) without needing a new layer.
- **Bottleneck attribute interactions**: some pairs should combine as
  `min(a, b)`-weighted rather than averaged — Vision 20 + Passing 7 (sees
  brilliant options, can't execute) should play differently from Vision 7 +
  Passing 20 (technically excellent, rarely finds them), not average to the
  same number. Cheap: `quality = primary*0.6 + secondary*0.25 +
  min(primary,secondary)*0.15` instead of a flat weighted sum. Also
  retrofittable into existing heuristics without a new layer.

**Standing architectural principle** (from the review, worth keeping as a
rule for everything built from here on): a scenario resolution should return
enough structured state to describe what actually changed on the pitch
(possession, ball zone, pressure, next actor), not just enough to print a
commentary line. The heuristics built so far already return small structured
objects (`{code, goal, rebound}` etc.) rather than bare booleans, which is
the right direction — the pressure/transition/receiver-selection work below
is partly about making the *zone and personnel* state persist and evolve
between ticks as richly as the outcome codes already do within one.
