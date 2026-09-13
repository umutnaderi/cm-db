# Claude Code concurrent tasks

These tasks are intentionally isolated from the active pass-delivery change.
Work from the current dirty tree, preserve every unrelated change, and do not
commit. Run the focused command named by each task and report exact results.

## Files reserved by the active Codex task

Do not edit these files while the pass-delivery slice is in progress:

- `src/lib/matchPassFlight.js`
- `src/lib/passRunCandidates.js`
- `src/lib/spatialDecision.js`
- `match-lab.js`
- `match-lab.html`
- `styles.css`
- their copies under `docs/`
- `tools/test-pass-flight.mjs`
- `tools/test-pass-run-candidates.mjs`
- `tools/test-possession-runner.mjs`
- `tools/test-timeline-playback.mjs`
- `MATCH_ENGINE_ARCHITECTURE.md`
- `MATCH_ENGINE_ROADMAP.md`
- `MATCH_LAB_PLAN.md`

## Task A: motion-integrity audit utility

Own only these new files:

- `src/lib/motionIntegrityDiagnostics.js`
- `tools/test-motion-integrity-diagnostics.mjs`

Build a pure, DOM-free auditor for immutable player and ball tracks. It should
report, with player/event/time identifiers:

- discontinuous positions at adjacent segment boundaries;
- speed above the supplied player-specific physical ceiling;
- acceleration or deceleration above supplied limits;
- direction changes that imply an impossible instantaneous turn;
- a rolling or airborne ball losing all velocity away from a recorded contact,
  boundary crossing, bounce, or explicit stop;
- non-finite coordinates, velocities, height, or time.

Inputs must be plain tracks and explicit thresholds; do not import Match Lab
state or invent a second motion solver. Keep deterministic ordering and return
structured findings plus a concise summary. Tests must include clean tracks
and one focused fixture per violation. Do not weaken existing assertions or
change gameplay code. Add one package script only if required:
`test:motion-integrity-diagnostics`.

## Task B: deterministic pass-mix reporting tool

Own only these new files:

- `tools/report-pass-delivery-mix.mjs`
- optionally `tools/fixtures/pass-delivery-mix.json`

Use current exported engine functions and seeded fixtures to report pass mix by:

- distance bands: 0-15, 15-30, 30-35, 35-50, and 50+ yards;
- intent: current-position/to-feet versus every into-space meeting-point kind;
- delivery: ground, driven-ground, driven-aerial, and lofted;
- passer power/technique tier and lane-obstruction band;
- left/right direction symmetry.

Emit stable JSON plus a readable console table. Include invariant failures when
an into-space pass at or above 30 yards or any pass above 35 yards is on the
ground.
This is measurement only: do not tune selector constants, decision weights,
accuracy, interception, or completion probabilities. A repeated run with the
same seed must be byte-identical.

## Task C: footage-review intake template

Own only this new file:

- `FOOTAGE_REVIEW_TEMPLATE.md`

Create a compact template for turning a clip into a reproducible engine case.
Capture match clock, phase, restart/open-play state, camera limits, ball state,
all visible player positions and motion, tactical context, the decision point,
contact and outcome timestamps, and the specific current-engine discrepancy.
Require at least five seconds before and after the incident when available.
Add a case taxonomy for pass height, receiving body shape, pressure/handoffs,
keeper angle, restarts, loose balls, second balls, offside interference,
collisions, and momentum continuity. End with acceptance evidence: saved seed,
counterfactual, expected invariant, trace fields, and renderer observation.

## Handoff

For each completed task, return:

1. files changed;
2. behavior added;
3. test command and result;
4. assumptions or integration points the active task must review.
