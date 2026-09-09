# Stage 4 review and implementation report

Reviewed 2026-09-07. The physical movement/rebound changes and keeper-contact
fix are implemented. The saved scenarios have no fully static live interval
over 200 ms and no orphaned physical interval. This is a bounded result:
player-only stillness, velocity seams, legacy motion paths and the recorded
short-pass loop still prevent an unconditional declaration of complete
continuous-world behavior.

## Changes reviewed and corrected

The intervening work added braking, keeper dives, parry control, motion-based
stamina/recovery, corner setup and held-ball trajectories. Those changes were
preserved. Earlier body separation was retained as a tactical target helper,
but removed from playback/checkpoint sampling and idle contact scans: it
relocated bodies without elapsed movement and concealed overlaps. Genuine
close blocks now become legal immediately after release; the departing
kicker is excluded from the incoming contact race. A shortened or reversed
keeper carry is scored at its actual target.

The latest keeper defect was a mismatch between an envelope that included a
dive and an authored body that only ran. `keeperSaveTravel()` and
`advanceKeeperSaveMotion()` in worldMotion now supply the same action to both.
The shot authors the keeper motion. A catch then records the reached body and
hand contact, returning the ball to the body over 120 ms without a second
dive. Trace serialization preserves the motion model for reach/ETA audits.
The saved keeper-hold replay exercises this contract, including the adapter.
A parry monotonicity test containing always-true expressions was strengthened.

## Files and movement paths

| Files | Role in this Stage 4 work |
| --- | --- |
| `src/lib/worldMotion.js`, `matchMotion.js`, `playerKinetics.js`, `matchMovementTiming.js` | Actual reached endpoints, attribute/momentum bounds, intention continuation; existing braking and new shared keeper action |
| `src/lib/spatialDecision.js` | Physical carry touches, executed impulse/roll consistency, bounded keeper-route scoring |
| `src/lib/matchPassFlight.js`, `playerBody.js` | Honest release contact and body-target proposals |
| `src/lib/ballReboundPhysics.js` | Frame reflection, parry direction, gravity/bounces and shared roll handoff |
| `src/lib/matchLabPlayback.js`, `matchFluidityDiagnostics.js`, `replayHarness.js` | Authored timing, body/contact distinction, inspectable movement and separate stillness/renderer metrics |
| `match-lab.js`, `match-lab.html` | Resolver integration, continuations, shot/rebound/keeper paths and developer diagnostics |
| `tools/test-stage4.mjs`, `test-stage4-review.mjs`, `measure-stage4.mjs`, `match-lab-test-environment.mjs` | Deterministic regression tests and reproducible measurement |
| `tools/test-match-motion.mjs`, `test-contact-continuity.mjs`, `test-possession-runner.mjs`, `package.json` | Updated physical contracts and test commands |
| Architecture, roadmap, history and this report | Current state, corrected comparisons and remaining work |
| `docs/` | Generated deployment mirror, not separately edited engine logic |

ATT/DEF/GK adjustments commit worldMotion's reached point rather than the
planner's ideal target. Continuing support, press, cover, track and recovery
jobs reuse their committed intention and velocity without a fresh P.HOLD
replan. Carry pursuit, successful-poke continuation, shield approach/escape,
standing/sliding challenge, back-to-goal turns, loose-ball recovery, shot
keeper movement and release-to-feet were audited and corrected. Restart and
shape targets continue through the shared movement contract. Pass live-contact
scans still use shared kinetics directly; not every legacy caller is yet
centralized through worldMotion, and old contact pins/arbitration need the
limitations below.

Movement diagnostics expose identity, attributes, job, start, intended target,
reached point, distance, duration, ETA, reaction, velocities, acceleration and
reach audit. The developer view also separates renderer gaps from simulation
stillness. The dive model is explicitly identified instead of being judged
against a running-only bound.

## Attribute evidence

Same precise start/target, Acceleration 10, no initial momentum:

| Shared window | Pace 5 distance | Pace 20 distance |
| --- | --- | --- |
| 400 ms | 0.294 yd | 0.408 yd |
| 1000 ms | 1.838 yd | 2.550 yd |
| 4000 ms | 22.050 yd | 30.600 yd |

At Pace 15, a 400 ms window gives Acceleration 5 approximately 0.322 yd and
Acceleration 20 approximately 0.529 yd. Deterministic tests also prove that
incoming momentum increases reach, a sharp turn retains less momentum, and
ATT/DEF/GK adjustment batches preserve these differences. Precise continuous
coordinates are retained. Raw `burst01`/`match01` fields do not silently alter
kinetics; the intervening Stage 5 work has not opened condition feedback.

A dive spends time rather than adding free distance to a full run:
`max(reachIn(t), reachIn(t-d) + diveReach(d))`, with `d = min(t, 0.52 s)` after
reaction. The selected run/dive schedule is fixed for its authored interval.
Launch uses the existing Agility/Jumping model; ordinary running uses
Pace/Acceleration. This review preserves the calibrated reach calculation
and makes the body actually follow it. Ronaldo?Stensgaard remains **1565 /
2400 goals, 65.2%**, inside the unchanged 51?75% test bracket.

## Matched before/after measurement

Commands:

```
node tools/measure-stage4.mjs audit/stage4/baseline-current-fixtures.json --baseline
node tools/measure-stage4.mjs audit/stage4/final.json
```

Both run the same four saved fixtures at five seeds each. The baseline engine
is the preserved pre-change mirror in `audit/stage4/baseline-engine/`, with
its source manifest; rebuilding docs does not replace it. Current results
include the intervening braking, stamina, corner and keeper work, so these
are cumulative measurements, not an isolated effect estimate for this turn.

| Metric | Preserved baseline | Reviewed tree |
| --- | --- | --- |
| Live duration | 1151.394 s | 1069.491 s |
| Fully static live time | 14.138 s / 1.228% | 2.702 s / 0.253% |
| Fully static runs > 200 / > 300 ms | 26 / 6 | 0 / 0 |
| Longest fully static interval | 400 ms | 140 ms |
| Orphaned physical intervals | 28 | 0 |
| Endpoint reach audit violations | 259 | 0 |
| All-player static time, ball excluded | 39.138 s | 49.499 s |
| Longest mass-player freeze | 660 ms | 1040 ms |
| Velocity seams | 2045 | 1469 |
| Early-finished tracks | 257 | 42 |

The physical sampler uses 20 ms intervals and a 0.001-yard movement threshold;
endpoint audits retain their 0.35-yard tolerance. These are not instantaneous
acceleration proofs. The older player-only 33 ms / 0.02%-pitch method worsens
from **9.201% to 10.089%**. Its longest run rises from 1980 to 3564 ms. A moving
ball prevents full-world stillness but does not explain why a whole team is
standing. Earlier 6.97%/50-freeze figures used another definition and cannot
be placed in the same before/after column as the new physical metric.

## Rebound model

In yard/second coordinates, normalize contact normal `n` and apply
`v_out = v_in - (1 + e) min(0, v_in ? n) n`. Normal velocity reflects with
restitution; tangential velocity survives, and an outward-moving ball gets
no new impulse. Frame restitution is 0.72, turf 0.32, directed parry 0.38,
and spill 0.18. The frame includes both posts and the crossbar. Gravity is
`9.80665 / 0.9144` yd/s?; after diminishing bounces, the same
`ballRollPhysics.js` friction supplies rolling deceleration and stop time.

The retained parry revision discounts Handling by shot-speed and lateral
reach loads, choosing a controlled wide direction or dangerous return into
play. A loose rebound carries its actual roll velocity to Dynamic Ball Claim
v2; no rebound shooter or follow-up goal is preselected. Physical goal-plane
crossings use the engine's current centre-plane convention.

Both `geometricKeeperSaveFlavor` and `geometricOneOnOneSaveFlavor` match the
preserved baseline source exactly after line-ending normalization. Selection
weights are unchanged. Changed contact geometry can change whether a save
is reached; physical follow-ups can also change subsequent possession
branches. Deterministic replay passes; this does not claim identical old and
new whole-match RNG consumption or identical goals after all movement changes.

## Validation and remaining work

**28 of 29 npm test suites pass**, including possession-runner, Stage 4 plus
review regressions, Stage 5, corners, motion/arbitration, kinetics, timeline,
contact, passes, ball claims, one-on-ones, setup, team shape and draft tests.
The sole failing suite is replay-harness: `repeated-carry-burst-drain` still
hits the existing 50-action cap. Its assertion and threshold remain intact.
The keeper calibration passes. The old test demanding movement on the save
beat was stale after moving the dive into the shot: it now requires the
preceding trajectory, exact reached body point and bounded hand contact.
No calibration or physical diagnostic threshold was relaxed. The earlier
CSS whitespace failure no longer reproduces in the refreshed tree.

`npm run pages:build` succeeds. All **168** generated files match their root
sources, allowing only the build's documented API-meta rewrite. No files
existed only in docs before rebuilding. Save-selection hashes, test logs and
measurement JSON are retained under ignored `audit/stage4/`. No browser is
connected, so actual visual inspection and observed renderer-hitch statistics
remain unverified; the renderer-gap diagnostic has deterministic unit coverage.

Residual limits are explicit: no global clock; future endpoints may still be
committed before an overlapping action finishes; legacy contact pins and
arbitration remain; positional pacing and abrupt turns are not a complete
bounded steering model. Dive landing/recovery and incoming keeper momentum
need richer action state. The nearest-frame tip model is not a full ray/frame
collision solver; aerial rebound claims begin at the rolling handoff, and
whole-ball goal laws remain future session work. Collision-free continuous
paths are not guaranteed. Stamina partition invariance is only demonstrated
for constant-load intervals, not arbitrary varying-speed subdivisions.

The pure shared modules and renderer-neutral trace contract remain suitable
for reuse by the game. **Unconditional promotion is not yet warranted**:
resolve the listed physical limits and replay failure, then prove parity in
the actual game's adapter. Stage 4's measured freeze/rebound slice is present;
the broader continuous-world acceptance criterion still has open work.

## Next prompt and decision-memory placement

Stage 5 was implemented by the intervening changes; do not restart it from
an event-label model. Recommended continuation:

> Review motion-derived effort against real sampled distance, speed change
> and elapsed time. Prove no duplicate charging across overlapping tracks and
> test subdivision of varying-speed motion, braking and turns. Keep condition
> feedback behind one separately measured sanctioned path. Preserve the
> burst display and deterministic replay. Use the current four fixtures and
> report effort, arrival-race, freeze and claim effects without changing save
> probabilities or weakening the existing loop assertion.

Place decision memory immediately after motion-derived stamina and before
the match-session/3D stages. Use progression, pressure relief, created space,
repeated pairs/regions and tactical intention; add time/score/manager context
when session state exists. Preserve legitimate short passes and use the
recorded 50-action failure as acceptance coverage. Finish the remaining
motion-authority limits alongside this work before promoting the engine.
