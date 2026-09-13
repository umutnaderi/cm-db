# Match Engine Roadmap

Staged prompts for the Match Engine initiative, in dependency order. Each
stage is written to be handed over verbatim as a single work instruction.

`MATCH_ENGINE_ARCHITECTURE.md` remains the architectural source of truth;
`MATCH_LAB_PLAN.md` holds the dated history. This file holds the **plan**:
what is done, what is next, and the exact prompt for each remaining stage.

| Stage | Title | Status |
| --- | --- | --- |
| 1 | Action Pattern Schema & Registry v1 | **Built** (2026-09-03) |
| 2 | Dynamic Ball Claim v2 | **Built** (2026-09-04) |
| 3 | Joint Passer/Runner Candidate Generation | **Built** (2026-09-05) |
| 4 | Playback Fluidity & Rebound Realism | Implemented; residual continuity limits in STAGE4_REPORT.md |
| 5 | Stamina from real motion | Built; later effort/recovery revision present |
| 5c | Decision memory and repetitive possession | Next; preserve the failing replay as acceptance coverage |
| 6 | Match-session state machine | Planned |
| 7 | Renderer-neutral playback (Three.js) | Planned |

Stage 4 was originally "stamina from real motion". It has been reordered
behind fluidity because the reported problems — visible freezing during play,
and unrealistic parry and post rebounds — occur in every possession, and
because stamina work changes movement timings underneath any fluidity fix
that lands after it.

The initial orphaned-window diagnosis found empty duel/contest outcomes.
The subsequent audit also found physically unreachable adjustment endpoints,
carry timing defects and mismatched keeper contact/body paths. Current
measurements and residual limits are in STAGE4_REPORT.md.

---

## Standing rules for every stage

These apply to all of the prompts below and are not repeated inside each.

- Continue from the current uncommitted working tree. **Do not commit,
  stash, discard or overwrite unrelated work.**
- Inspect the complete diff and establish the test baseline **before**
  editing. The recorded `repeated-carry-burst-drain` scenario still fails
  `no-low-value-pass-loop` at the 50-action cap. Keep its assertion intact.
  The earlier draft CSS whitespace failure did not reproduce in the
  September 7 refreshed tree. Establish current evidence on every takeover;
  do not conceal failures or casually repair unrelated work.
- Consume no additional RNG, and keep replay deterministic. Any unavoidable
  RNG-contract change must be identified explicitly and tested.
  `chooseCandidate()` draws exactly one `decisionRandom()` value per
  candidate in list order, so changing the length or order of a candidate
  list silently re-keys every later draw.
- Never write a roster coordinate outside the sanctioned path. `worldMotion`
  remains the only system that converts an intention into movement.
- Do not introduce a second speed, acceleration, friction, interception or
  ball-flight model. Reuse `playerKinetics.js`, `ballRollPhysics.js`,
  `matchPassFlight.js` and `matchMovementTiming.js`.
- Migrate rather than rewrite: keep the original code path as a parity
  reference and prove agreement with an A/B sweep.
- Update both architecture documents, and finish with a report covering
  files changed, what was measured before and after, test results, and
  remaining risks.

---

## Stage 1 — Action Pattern Schema & Registry v1 (built)

**Delivered.** `src/lib/actionPatternSchema.js` owns the declaration format,
validation, normalization, mirroring and the frame-annotation format.
`src/lib/actionPatternRegistry.js` owns the declared vocabulary and a
deterministic, RNG-free matcher.

Six behaviours migrated (`vacate-pocket`, `arc-overlap`, `peel-square`,
`show-wide`, `check-decel`, `run-off-pass`) with the original if-chain kept
verbatim as `selectSpecialMoverDirect()` and a 40-fixture A/B sweep proving
agreement. The "1 special run" cap survives as the `special-run` exclusivity
group with capacity 1.

86 checks in `npm run test:action-patterns`.

---

## Stage 2 — Dynamic Ball Claim v2 (built)

**Delivered.** `src/lib/ballClaim.js` projects the real decelerating roll,
races every player against it at 40 ms, and reports intercept / pickup /
abandon with a reason.

The defect was structural: the claim came from a 320 ms `predictBallPosition()`
look-ahead using an exponential drag constant that is a *different* friction
model from the roll the ball actually performs. At a real through-ball
landing speed of 26 yd/s the prediction saw the ball 5.8 yards away while it
genuinely travelled 91.4 yards over 7 seconds.

The visible half lived in playback: a ball rolling out untouched named the
last toucher as the contact actor at the exit point, and the contact re-pin
then dragged the passer after a ball they never chased. Measured 9 of 9
before, 0 of 9 after.

76 checks in `npm run test:ball-claim`.

---

## Stage 3 — Joint Passer/Runner Candidate Generation (built)

**Delivered.** `src/lib/passRunCandidates.js` generates and scores the
passer, runner, intended point and delivery as one object. Seven
meeting-point kinds, a closed rejection vocabulary, deterministic scoring,
pure and RNG-free, and a leaf module (pass-flight and lane primitives are
injected so it never joins the existing import cycle).

One teammate still yields exactly one pass candidate and there is still
exactly one through-ball candidate, so the RNG contract is unchanged.
`resolveThroughBall()` no longer falls back to the receiver's own
coordinate. Delivery trace events now record `intendedPoint` alongside
`ballTo`.

The chosen endpoint and delivery type now survive the decision/execution
handoff. A safe pass to a receiver below a 13-point Pace/Acceleration blend
is aimed at their feet with the controlled ground profile; the same geometry
for a Pace 17 receiver retains the driven-ground option. A lead remains
available to the slower receiver when the feet option is not viable.

Measured on a 120-fixture sweep: unreached deliveries running out of play
fell from 20 to 14, and the receiver's shortfall fell from 8.20 to 4.10
yards on average.

93 checks in `npm run test:pass-run-candidates`.

Two calibration errors are worth remembering, because both were caught by
recorded bug fixtures rather than by reasoning:

- Scoring arrival and defender contest on a pass to feet double-counts the
  existing utility's lane and pressure terms. Passing collapsed and
  possessions degenerated into hold/dribble streaks.
- Offering a through ball from any forward meeting point, rather than from a
  genuine run-in-behind job, made `congested-pass-loop` start looping again.

---

## Stage 4 — Playback Fluidity & Rebound Realism (built)

### Why this is next

Two reported problems, both visible constantly. Both were measured before
this stage was written; the numbers below are real, not estimates.

#### Compute is not the bottleneck

Averaged over 20 possessions:

| | Measured |
| --- | --- |
| Resolve the trace | 71.3 ms per possession |
| Compile the playback plan | 18.3 ms per possession |
| Playback duration produced | 46.5 s per possession |
| Compute to playback ratio | **1 : 518** |

The engine already resolves first and animates afterwards: it produces a
resolved trace, `matchLabPlayback.js` compiles it into an immutable plan,
and the renderer samples that plan. About 90 ms of work produces 46 seconds
of playback. **Pre-resolving further, or moving simulation into a Web
Worker, cannot fix these freezes** — a 400 ms hole authored *inside* the
plan is still a 400 ms hole no matter how early the plan was built. The fix
is timeline continuity, not calculation speed.

Three distinct problems must be instrumented separately and not confused:
simulation time (measured above, negligible), renderer hitches (real gaps
between animation frames, not yet measured), and **authored stillness**,
which is what follows.

#### Where the stillness actually is

Sampling the plan at 30 fps over a real 37.5 s, 276-event possession:

| Metric | Measured |
| --- | --- |
| Wall clock with **nobody** moving at all | 2.97 s (7.9%) |
| Wall clock with the ball completely still | 8.45 s (22.5%) |
| Total freezes longer than 300 ms | 4 |
| Longest single freeze | 627 ms |

Two natural suspects were checked and **cleared**, so no time should be
spent on them:

- `ACTION.CHOICE` already costs zero wall clock — 40 of 40 intervals are
  0 ms long. The choice itself never freezes anything; what is seen is the
  seam next to it.
- The adjust beats already overlap correctly. `DEF.ADJUST` is
  non-overlapping in 0 of 61 intervals and `ATT.ADJUST` in 0 of 61, and both
  author real movement in the large majority. "Make the adjusts overlap" is
  already done.

The real cause is **orphaned contest windows**: duel and contest outcome
events that occupy a fixed `MOVEMENT_DURATIONS` slot, author no player
movement of their own, and have nothing overlapping them. Across 25
possessions:

| Event | Count | Total | Each |
| --- | --- | --- | --- |
| `P.HOLD.SHIELD.LOST` | 28 | 11.20 s | 400 ms |
| `P.HOLD.SHIELD` | 7 | 2.80 s | 400 ms |
| `T.LOOSE.DEFLECT` | 4 | 1.04 s | 260 ms |
| `F.CALM` / `F.BLAST` / `F.FINESSE` | 4 | 1.60 s | 400 ms |
| `D.SLIDE.1` / `D.STAND.1` / `D.DUEL.1` | 4 | 1.60 s | 400 ms |
| `CLEAR.LONG` | 1 | 0.50 s | 500 ms |

Every one of these is a contest being *resolved* while all 22 players stand
still. That is the freeze, and it is a narrow, well-located defect rather
than a general architectural failure.

#### Parries and post rebounds are not physical

`K.SAVE.6` (`post-rebound`) and `K.SAVE.2` (`parry`) both resolve to an
*authored* endpoint offset by a flat `REBOUND_INSET = 7`, travelling at a
flat `LOOSE_BALL_SPEED_YARDS_PER_SECOND = 12` regardless of how hard the
shot was struck. There is no angle of incidence, no reflection off the
frame, no crossbar in the vocabulary at all (`GOAL_LEFT_POST_X` /
`GOAL_RIGHT_POST_X` only), and `ballRollPhysics.js` is never consulted even
though every other loose ball already rolls under it.

### The prompt

> Implement Roadmap Stage 4: Playback Fluidity & Rebound Realism.
>
> Read completely: `MATCH_ENGINE_ARCHITECTURE.md`, `MATCH_LAB_PLAN.md`,
> `MATCH_ENGINE_ROADMAP.md`, `src/lib/matchLabPlayback.js`,
> `src/lib/matchMovementTiming.js`, `src/lib/worldMotion.js`,
> `src/lib/matchTimeline.js`, `src/lib/matchPlayback.js`,
> `src/lib/ballRollPhysics.js`, `src/lib/matchBallCore.js`,
> `src/lib/keeperHandling.js`, `src/lib/pitchGeometry.js`,
> `src/lib/replayHarness.js`, and in `match-lab.js` the shot, save and
> rebound paths (`resolveShoot`, `resolveKeeperSave`,
> `resolveReboundScramble`, `postPointFor`, `missPointFor`,
> `looseBallFlightMs`, `MOVEMENT_DURATIONS`, `POST_ACTION_CONVERGENCE_MS`,
> `reactOffBall`, `reactOffBallContinuous`, `interleaveFlightOffBall`), plus
> the relevant tests and `package.json`.
>
> **Part A — fluidity.**
>
> Compute is not the problem and must not be treated as one: resolving a
> possession and compiling its plan costs about 90 ms and produces about
> 46 seconds of playback, a ratio of 1:518. Do not pre-resolve further, do
> not add a Web Worker, and do not touch the resolve-then-compile-then-sample
> architecture. A hole authored inside the plan survives any amount of
> precomputation.
>
> Two suspects have already been checked and cleared — do not spend time on
> them. `ACTION.CHOICE` already occupies zero wall clock (40 of 40 intervals
> are 0 ms). `DEF.ADJUST` and `ATT.ADJUST` already overlap correctly (0 of 61
> non-overlapping each) and already author real movement in most intervals.
>
> The actual defect is **orphaned contest windows**. A duel or contest
> outcome event takes a fixed `MOVEMENT_DURATIONS` slot, authors no player
> movement of its own, and has nothing overlapping it, so all 22 players
> stand still while the contest resolves. Across 25 possessions the worst
> offenders are `P.HOLD.SHIELD.LOST` (28 windows, 400 ms each, 11.20 s
> total), `P.HOLD.SHIELD` (7, 2.80 s), `T.LOOSE.DEFLECT` (4, 260 ms each),
> the foul outcomes `F.CALM`/`F.BLAST`/`F.FINESSE`, the tackle outcomes
> `D.SLIDE.1`/`D.STAND.1`/`D.DUEL.1`, and `CLEAR.LONG`.
>
> **Do not simply set these durations to zero.** A shield battle, a tackle
> and a finish genuinely take time, and deleting the window would replace a
> freeze with a teleport. Fill the time with real movement, or merge the
> outcome into the physical interval that produced it.
>
> Fix that class of event, not the adjusts. A contest beat must either carry
> the contesting players' own real movement — a shield being lost is two
> bodies moving apart, not a caption — or carry an overlapping off-ball
> reaction for everyone else through the existing
> `reactOffBallContinuous()` contract, or both. Prefer both. Use the
> existing mechanism and overlap the beat rather than inserting a new
> sequential window.
>
> Also close the seams. Where a segment's authored movement completes before
> its interval ends, or the next segment's movement starts late behind a
> reaction delay, the player's existing intention must continue to be
> integrated rather than truncated. A run still in progress does not stop
> because the event that authored it ended.
>
> Do not fix any of this in the renderer. The timeline must be genuinely
> continuous; smoothing a frozen timeline with interpolation or easing is
> explicitly not acceptable and would violate the World Motion Contract.
> `worldMotion` stays the only system converting an intention into movement,
> and playback stays a consumer of the authoritative timeline.
>
> Add two diagnostics to `replayHarness.js` in the style of the existing
> ones. First, no live interval may leave every player static for longer
> than a stated threshold. Second, no interval may be *orphaned* — authoring
> no movement while nothing overlaps it. Report the measured before and
> after on the numbers in this stage's diagnosis.
>
> **Part B — rebound realism.**
>
> A parry, a post rebound and a crossbar rebound are currently the same
> authored mechanic: an endpoint offset by a flat `REBOUND_INSET`, reached
> at a flat 12 yd/s regardless of how the shot was struck.
>
> Make a rebound a real physical event. The ball leaves the frame or the
> keeper's hands along a genuine direction derived from the incoming shot —
> angle of incidence off a post, deflected pace off a parry — with a real
> speed derived from the shot's own pace and what it struck, then rolls
> under `ballRollPhysics.js` like every other loose ball. A parry should be
> directional: a keeper pushing a ball wide is a different outcome from one
> palming it straight back into play, and which of those happens should
> follow from the save, not from a fixed table entry.
>
> Add the crossbar. The goal frame currently has two posts and no bar, so a
> shot that should come back off the underside cannot.
>
> Once the rebound is loose, hand it to Dynamic Ball Claim v2 rather than
> pre-selecting who reaches it.
>
> Keep `K.SAVE.*` outcome selection and its probabilities exactly as they
> are. This stage changes what a rebound *looks like and does physically*,
> not how often each save outcome occurs. Any change to the shot or save
> probability model is out of scope.
>
> **Explicitly out of scope:** motion-derived stamina, the match-session
> state machine, Three.js, renderer-authored movement, broad probability or
> shooting tuning, a global simulation clock, and any change to passing,
> claim or candidate scoring.
>
> Add deterministic tests proving: no live interval leaves the pitch fully
> static beyond the threshold; no interval is orphaned; a contest outcome
> beat authors real movement for its own participants; an off-ball runner's
> motion continues across a beat boundary instead of restarting; a post rebound leaves at a reflected angle related to the incoming
> shot rather than a fixed inset; rebound speed scales with the shot that
> caused it; a rebound decelerates under the shared friction model; a
> crossbar rebound exists and behaves; a parry can go wide or back into play
> and the two are distinguishable; a loose rebound is handed to
> `ballClaim.js`; replay stays deterministic; and the existing pass-flight,
> spatial, action-pattern, ball-claim, pass-run-candidate, team-shape,
> world-motion, motion-arbitration, timeline-playback and possession-runner
> suites remain green.
>
> Finish by reporting files changed, the freeze numbers before and after,
> the rebound model and its inputs, test results, remaining risks, and a
> recommended prompt for Stage 5 (stamina from real motion).

---

### Delivered (2026-09-06)

Reconciled on 2026-09-07: the earlier table compared different definitions
of stillness. The original player-only 6.97% / 50-freeze figures must not be
presented as a before measurement of the new ball-inclusive metric.

The current comparison uses the preserved pre-change engine and the same
four scenarios at five seeds each, including the new keeper-hold fixture.
Both sides use the same 20 ms / 0.001-yard physical diagnostic.

| Metric | Preserved baseline | Reviewed current tree |
| --- | --- | --- |
| Fully static live play | 1.228% | 0.253% |
| Physical freezes > 200 / > 300 ms | 26 / 6 | 0 / 0 |
| Longest fully static interval | 400 ms | 140 ms |
| Orphaned physical intervals | 28 | 0 |
| Endpoint reach audit violations | 259 | 0 |
| Longest mass-player freeze (ball may move) | 660 ms | 1040 ms |
| Player tracks finishing early | 257 | 42 |
| Velocity seams | 2045 | 1469 |

The player-only measure worsened: 9.201% to 10.089% by the old 33 ms /
0.02%-pitch method. Eliminating fully static windows is not proof that all
mass stillness or velocity discontinuities are resolved. See
`STAGE4_REPORT.md` for provenance, limitations, tests and promotion status.

The following records the September 6 implementation findings; its smaller
sweep and intermediate seam counts are historical, not current totals.

Two defects were found and fixed in this pass, both artificial rather than
football:

1. **Arrivals stopped dead.** There was no deceleration model at all, so a
   completed leg had its velocity assigned zero. `decelerationRate()` and
   `arrivalBrakeProfile()` now brake a completed leg to rest *on* its target.
   Early-finished tracks fell 82 → 21 (67 → 17 of them under `P.CARRY.START`).
   The endpoint is unchanged by construction — the profile is only applied
   when it fits inside the window — so no authoritative coordinate moved and
   the sweep is byte-identical on every other metric.
2. **Contact pins erased momentum.** The contact-pin keyframe
   (`matchLabPlayback.js`) carried no velocity, which stores as null, and a
   null tangent makes hermite decelerate into the pin and re-accelerate out
   of it. Every carry touch declares a contact, so a five-touch carry planted
   the carrier five times. The pin now samples the player's real momentum
   before pinning — the same technique `arbitrateSegment()` already uses when
   one intention supersedes another. The pinned position is unchanged.

The 1093 remaining seams are no longer fabricated. Classified: 828 are
direction changes at speed (a carrier turning between committed legs), 245
are genuine braking now that arrivals decelerate, 20 are launches from rest.
The residual honest defect is carry path continuity — the last touch and the
final carry leg can point in materially different directions — which is a
*behavioural* question about carry geometry, not a timeline artefact. It is
in the backlog rather than rushed here, because changing carry geometry moves
simulation coordinates and this stage is explicitly barred from that.

**Part B — rebounds are collisions.** See "Rebounds are collisions" in
`MATCH_ENGINE_ARCHITECTURE.md`. Measured over 4000 shots at a Handling-12
keeper:

| | Before | Now |
| --- | --- | --- |
| Rebound speed | flat 12 yd/s | correlates with impact speed, r = **0.686** |
| Restitution | none | 0.38 parry / 0.72 frame / 0.18 spill |
| Crossbar | not in the vocabulary | 46 of 857 rebound events |
| `parry-wide` / `parry-dangerous` | 792 / **0** | 432 / **360** |
| Rebound roll | never consulted `ballRollPhysics.js` | shared roll, 23 yd average |

No `K.SAVE.*` selection weight changed; goals over the same 4000 shots are
unchanged at 766.

---

## Stage 5 — Stamina from real motion (built)

> Implement Roadmap Stage 5: Stamina from real motion.
>
> Read completely: `MATCH_ENGINE_ARCHITECTURE.md`, `MATCH_LAB_PLAN.md`,
> `MATCH_ENGINE_ROADMAP.md`, `src/lib/playerKinetics.js`,
> `src/lib/worldMotion.js`, `src/lib/matchMovementTiming.js`,
> `src/lib/matchLabPlayback.js`, `src/lib/replayHarness.js`,
> `src/lib/passRunCandidates.js`, `src/lib/ballClaim.js`, the burst
> functions in `match-lab.js` (`freshBurst01`, `drainOnBallAction`,
> `burstEffortCost`, `burstRecoveryTick`, `burstJobIntensity`,
> `applyBurstOffBallJob`, `maybeAssignTurnoverStaminaJobs`), and the
> relevant tests plus `package.json`.
>
> Stamina is currently driven by event labels and job names: an action type
> costs a fixed amount and an off-ball job drains by its category. Replace
> that with drain computed from what the player actually did — real speed,
> acceleration, distance covered and elapsed time — read from the
> authoritative movement the engine already authors.
>
> This addresses the reported "full speed denied" issue in `new-issues.md`,
> where a carrier loses most of their burst within a few touches. The
> recorded scenario is `tools/replay-scenarios/repeated-carry-burst-drain.json`
> and `assertNoUnrealisticBurstCrash` in `replayHarness.js` already measures
> it. Report the measured before and after on that fixture.
>
> Requirements: derive drain from quantities that already exist in
> `worldMotion`/`playerKinetics`, and introduce no second speed or
> acceleration model. Cost must scale with real effort, so a sprint costs
> more than a jog over the same distance and standing still costs nothing
> beyond baseline. Recovery must be a function of elapsed time at low
> intensity, not of action count. Preserve the existing burst display
> contract (`burst01` on `playerMoves`, the stamina bars) and the
> possession-runner invariants.
>
> Fatigue may influence `topSpeed`/`reachIn` outputs only through the
> existing `conditionMultiplier` path. If it does, say so explicitly and
> test it — a change there affects every arrival race in the engine,
> including joint pass/run candidates and ball claims.
>
> **Explicitly out of scope:** the match-session state machine, Three.js,
> renderer-authored movement, broad probability tuning, new ball physics,
> and any change to passing or claim scoring.
>
> Add deterministic tests proving drain tracks real distance and speed
> rather than event labels, that an identical action at different
> intensities costs differently, that recovery depends on elapsed
> low-intensity time, that a carrier is no longer denied full sprint within
> a few touches, that replay stays deterministic, and that the
> possession-runner, spatial, pass-run-candidate, ball-claim, world-motion,
> motion-arbitration and replay suites remain green.
>
> Finish by reporting files changed, the model and its inputs, measured
> before and after on the burst fixture, test results, remaining risks, and
> a recommended prompt for Stage 6.

---

### Delivered (2026-09-06)

`src/lib/motionEffort.js` prices effort from the motion that happened rather
than from the job's name. See "Effort follows motion, not labels" in
`MATCH_ENGINE_ARCHITECTURE.md` for the model.

The first revision retained `EFFORT_REFERENCE_YARDS = 40`. The subsequent
effort/recovery revision changed it to **250** and blended elapsed-time
recovery continuously. Current code and the later dated history supersede
the first revision; condition still does not feed back into locomotion.

Measured on the recorded `repeated-carry-burst-drain` fixture — captured for
the reported "full sprint gets denied a few touches in" bug:

| | Before | Now |
| --- | --- | --- |
| Carry actions before full sprint is refused | ~4 (burst 6%) | **26, never refused** |
| Full-sprint denials in the possession | several | **0** |

Side effect on Stage 4's own numbers, from the same sweep: velocity seams
1093 -> **878** and early-finished tracks 21 -> **19**, because players are no
longer being drained or refilled against what the motion actually was.
Physical freezes over 300 ms and orphaned intervals both stay at 0.

`congested-pass-loop` — the scenario that broke the last time simulation
coordinates moved — still passes every assertion.

**Deliberately not done: condition does not feed back into locomotion.** That
is the second half of the stamina story and it is a much larger behavioural
change (a fatigued player being slower changes every arrival race, every
claim and every decision downstream). It must be opened through one sanctioned
path with its own measurement pass. Until then `test-stage4.mjs` and
`test-stage5.mjs` both assert that an ad hoc `burst01`/`match01` field cannot
silently alter kinetics, which is what keeps the boundary honest.

### Next prompt — Stage 5b, condition into locomotion

> Open exactly one sanctioned path from condition into locomotion.
>
> Stage 5 made drain follow real motion; a tired player is now genuinely
> tired, and nothing yet reads it. Decide where condition belongs -- top
> speed, acceleration, braking, or the willingness gate -- and apply it in
> ONE place, once. It must not be counted twice: `conditionMultiplier()`
> already exists and already reads Stamina and Work Rate over the match
> clock, so establish which of the two is authoritative before adding a
> second reader.
>
> Replace the two assertions that currently forbid the feedback (in
> `test-stage4.mjs` and `test-stage5.mjs`) with assertions that it flows
> through the sanctioned path and nowhere else. Measure the effect on arrival
> races, ball claims and the recorded scenarios before and after -- a
> fatigued player being slower re-keys every contest downstream, so
> `congested-pass-loop` and `through-ball-unreached` are the regression
> canaries.


## Stage 6 — Match-session state machine (planned)

Play continuing through throw-ins, corners, goal kicks, free kicks, goals
and kickoffs until the user stops it, instead of one possession at a time.

This is the stage that can close the "no global simulation clock" limitation
documented in `MATCH_ENGINE_ARCHITECTURE.md`. It depends on Stage 4: a
session that runs continuously makes every remaining playback stall visible
back to back, and on Stage 5, because drain and recovery only mean anything
across a period longer than a single possession.

A full prompt should be written when Stages 4 and 5 land, since the restart
execution and fluidity work will change what this needs to coordinate.

---

## Stage 7 — Renderer-neutral playback (planned)

A Three.js renderer consuming the same authoritative timeline the 2D
renderer does, with no engine changes. Deliberately last: it is only a
faithful test of the timeline contract once the timeline is continuous
(Stage 4) and runs for a whole session (Stage 6).


## Review follow-up (2026-09-07)

Keeper contact reach and playback now share `advanceKeeperSaveMotion()` /
`keeperSaveTravel()` in worldMotion. The shot authors the run or committed
dive; a catch records the hand/body separation and returns the ball to the
body over 120 ms, without a second dive. Selection-function source is
unchanged against the preserved baseline. See `STAGE4_REPORT.md`.

Decision memory belongs after motion-derived stamina and before the full
session/3D work. Keep the existing repeated-carry replay failure visible.
Use bounded progression, pressure relief, space creation, repeated pairs
and regions; add match time, score and manager intent when session state
exists. Do not ban short passes or force a shot after an arbitrary count.
The condition-feedback experiment is separate and must not be used to
hide this decision defect. Remaining Stage 4 trajectory limits can proceed
alongside that work but must block unconditional game promotion.


## Dribble pace follow-up (2026-09-07)

The Anderson/Sensini report is fixed at the carry producer: running impulses,
contact timing and cross-action momentum now match actual ground covered.
See DRIBBLE_PACE_REPORT.md for the controlled before/after comparison. The
current replay failure is the congested fixture at the 50-action guard; the
previous repeated-carry fixture now resolves. Keep the guard and the decision
memory/session backlog visible. The earlier Stage 4 measurements remain dated
snapshots and should not be quoted as the current dribbling behavior.

## Keeper decision follow-up (2026-09-07)

Through-ball sweeps, close-downs and exposed-goal cover now have physical
intentions and deterministic execution. Continuing control at a keeper's
feet no longer turns into a fresh hand-held possession. All four saved
replay scenarios now pass; retain the action guard and longer-term decision
memory work. Future keeper work includes continuous perception during a
committed rush, physical chip/round execution, and full shot-time defender
movement. See KEEPER_RUSH_REPORT.md.

Held-ball behavior now suspends pressure and keeps opponents 9.15m away
through the keeper's walk. Normal pressing resumes from controlled-ground
possession after release; retain this phase boundary in future press work.

## Crossed-header save follow-up (2026-09-07)

Crossed headers now share the ordinary shot path's physical goalkeeper reach
contract. The goalkeeper moves during `F.HEADER`; `K.SAVE.*` starts only once
the ball and the reachable hand envelope meet. The existing header and save
weighting remains in place after reach, while geometry vetoes impossible
saves. The cross regression suite covers an interleaved close-down followed by
a catch, exact ball/body contact continuity, settled held possession, and a
distant goalkeeper who cannot be awarded a save.

## Footage coordination vertical slice (delivered 2026-09-11)

The first coupled attacking/defensive coordinator is active in Match Lab.
Delivered attacking families are `REGAIN_QUICK_RELEASE`, `WIDE_TRANSITION`
and `SHORT_COMBINATION`; delivered defensive responses are
`LOSS_COUNTERPRESS_WINDOW`, `TRANSITION_DELAY_AND_RECOVER`,
`PROTECT_DEPTH_AND_HANDOFF`, `SHIFT_BLOCK_AND_PRESS` and
`DEFEND_WIDE_OVERLOAD`.

The slice includes live replanning during ball travel, exclusive pressure and
tracking responsibilities with hysteresis, role reservations, overlap versus
underlap support selection, dynamic loose-ball claimant transfer, saved replay
evidence and deterministic tactical counterfactual fixtures. It retains Team
Shape and worldMotion as the shape and kinetics authorities. It does not add a
renderer or alter finish, goalkeeper or scoring probabilities.

Hard retargets now brake and turn through the shared world-motion path instead
of switching to a full lateral/opposite velocity in one beat. Late control
convergence uses a reachable sequential trajectory, so it cannot overlap the
carry that created the gap or commit an endpoint before the player arrives.

The next smallest coordination step is richer receiving and engagement state:
select body orientation, first-time release, cushion, let-run and jockey/delay
responses from the same authoritative contact and motion data.

## Sustained possession and final-third coordination (delivered 2026-09-11)

`RECYCLE_AND_SWITCH` responds to ball-side congestion with three distinct
relationships: a safe outlet behind pressure, a circulation connector, and a
receiver holding the weak-side width. It biases only existing legal pass/hold
candidates and preserves rest defence.

`PENALTY_AREA_OCCUPATION` allocates near-post, central, far-post, cutback and
edge-of-box responsibilities to separate participants. Pre-contact targets are
clamped behind the effective offside line. `PROTECT_PENALTY_AREA` ranks and
tracks those threats through the existing pressure/cover/handoff contract.

Defensive line control now exposes a shared depth derived from line-height
tactics, pressure arrival and the goalkeeper's position. Keeper close-downs
use a post-ray angle bisector and expose cone width and coverage diagnostics.
No finish, save or scoring probability was changed.

## Restart choreography and roll continuity (delivered 2026-09-11)

Normal corners, free kicks and goal kicks now proceed through placement,
retreat, scan/signal and run-up before the existing take resolver. Throw-ins
hold the ball before release. Quick restarts remain a seeded tactical option
and do not perturb resolver RNG. Long Throws and Strength expand specialist
throw-in range, with a distinct hand-flight profile below kicked-ball speed.

Loose ground travel now records velocity from the same friction equation as
its position. A moving ball cannot acquire a zero-velocity sample before its
natural stop unless a real contact, boundary or dead-ball transition ends the
motion.

Restart runners and distinct defensive markers now move during the taker's
scan and approach. Corner delivery targets now produce a primary run, separate
decoys and a short-option show; crossed free kicks separate their lead and
decoy checks without advancing anyone beyond the kick-time offside line.
Resolved marker ownership travels into the live preparation, and the chosen
corner target biases the existing resolver rather than pre-resolving its
outcome. The next small restart step is an editable Match Lab corner/free-kick
routine panel with ordered taker fallbacks.

## Intent-aware pass delivery variety (delivered 2026-09-13)

Pass height now follows both distance and intent. Clear controlled deliveries
can remain driven on the ground below 30 yards; the 30-to-35-yard band keeps
that option only for an exceptional clear pass to feet. Passes into space
from 30 yards and all passes beyond 35 yards select driven-aerial or lofted
flight from passer power and live lane obstruction. The slow-receiver
to-feet adaptation is capped at 28 yards and cannot flatten a long pass.

The meeting-point kind survives the choice/execution handoff, and every
executed pass exposes its type, intent, distance, peak height and launch speed
in trace diagnostics. Match Lab renders the existing authoritative ball
height more clearly. Completion, interception and accuracy probabilities are
unchanged; the next smallest calibration step is a deterministic pass-mix
report over representative tactical fixtures before changing any selector
threshold.

The new aerial frequency exposed a missing failed-chest-control leg. A lost
chest duel now emits `P.CHEST.SPILL` from the aerial contact to the loose-ball
race point, with the actual last toucher and concurrent surrounding movement.
Full-match playback therefore keeps both the ball and the recovering players
continuous through that second-ball phase.
