# Goalkeeper rush and goal cover — 2026-09-07

Keepers now propose a sweep, close-down, ordinary set position or recovery.
The shared `keeperDecision.js` module estimates a through-ball race from
visible ball velocity, observed attacker motion, and the keeper's own
kinetics. Anticipation, Decisions and Positioning affect reaction and a
bounded timing error. Bravery affects commitment. The prediction horizon
and distance off the goal line are bounded. Opponent ratings are not read.

An isolated attacker within 24 yards, with at least a 16-degree view of the
goal and no defender able to recover or protect the shooting lane, prompts
the keeper to close along the ball-to-goal line. This is the same structural
test used to route a shot through the one-on-one resolver. A wide carrier no
longer triggers a rush merely by crossing the old 28-yard depth threshold;
the keeper holds the ordinary angle-aware set position instead. Closing
narrows the actual shot cone; it does not add a save probability bonus.
Observed closing velocity affects the striker's urgency and nearby pressure.
A keeper left behind the attacker remains beaten by the existing geometry
check, leaving the real goal exposed.

Sweeps run through `worldMotion` inside the live pass-contact scan. The
same reached body and trajectory are authored into playback, concurrent
with the delivery. A late or optimistic decision cannot award contact.
A clean claim inside the area becomes held possession; spills and poor
clearances become independent loose balls. Outside the area the keeper
clears rather than taking the ball in his hands. Execution has a separate
seeded stream, leaving the existing save-flavor stream and weights intact.

A defender who can observe the advanced keeper can abandon his ordinary
job and recover toward the goal. Selection uses awareness and reachable
travel time. Formation coordination preserves this emergency destination;
the movement layer still decides how much ground is covered. Cover does
not count as a block until the defender actually occupies the shot lane.

The changed possessions exposed an ownership error: carrying after a keeper
released to feet inferred another hand-held possession from his role.
`transitionBallState` now preserves continuing control at the feet unless
an explicit catch says otherwise. All four saved replay fixtures now pass,
including the previously failing action-cap case. The 50-action guard and
replay thresholds are unchanged.

## Validation

- All 31 npm test suites pass. The browser build has been regenerated;
  all 169 mirrored files match source, allowing only the expected API URL
  substitution. `audit/keeper-rush/tests.json` and `mirror-parity.json`
  record the results.
- `test:keeper-rush`: close/hold/recover decisions, the reported wide-angle
  hold in both the pure planner and live motion path, bounded reaction, noisy
  arrival judgments, hidden-rating independence, angle coverage, actual
  goal-line blocks, empty-goal shots, legal handling area, execution errors,
  deterministic movement, and contact/playback agreement. Thirty fixed
  delivery trials exercise thirty rushes and twenty-eight clean claims;
  these are coverage fixtures, not a calibrated match-frequency estimate.
- The existing save-flavor function and `matchEngineCore.js` are unchanged
  against the saved pre-rush engine. Evidence is under `audit/keeper-rush/`.
- Twenty saved-fixture/seed runs: zero physical movement-limit violations,
  zero physical orphan intervals, zero fully frozen intervals over 200 ms;
  longest fully frozen interval 140 ms. Fully static time is 0.2644%.
- Existing tests retain their physical limits. The dive/catch adapter test
  now uses fixed shot geometry rather than depending on a preceding
  possession selecting the same finish. Final-position determinism checks
  every final playback body and the ball, without requiring a capped live
  possession. Carry momentum comparisons reset when possession changes.

## Scope limits

The sweep decision commits to a bounded initial trajectory estimate for
that delivery. It is not a full continuous perception system. Existing
chip/round-keeper execution and shot-time defender movement remain their
older models; goal cover in this change happens during preceding live play.
The inherited global-clock/arbitration and keeper-dive momentum limitations
in `MATCH_ENGINE_ARCHITECTURE.md` still apply. Browser verification in this
session used the headless playback tests; no interactive browser was available.

## Held-ball exclusion (2026-09-07)

During `GK.HOLD`, every opponent's ordinary shape target is constrained to
at least 9.15m (10.0066yd) from the keeper and relabeled
`respect-held-ball`. The constraint is applied after team-shape coordination
and body separation, and refreshed as the keeper walks. A player already
inside the radius retreats through worldMotion rather than teleporting.
Opponent proximity no longer shortens the holding window. As soon as the
keeper releases the ball to his feet, the constraint is removed and the
ordinary `press-ball`/`delay` planner may engage again.
