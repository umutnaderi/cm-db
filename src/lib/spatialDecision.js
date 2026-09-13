// Spatial Decision Intelligence v1 -- see MATCH_LAB_PLAN.md, "Spatial
// Decision Intelligence v1". DOM-free, engine-adjacent, in the same spirit
// as matchEngineCore.js and oneOnOneDecision.js: pure functions over plain
// {x,y} points and player objects, no DOM/state/random-outside-what's-
// passed-in. Built so Match Lab's Free Play possession loop can call it
// today, and a real match tick loop could reuse the same primitives later
// (see the file-level goal of a "shared module... the real match runner
// can reuse later" -- nothing here is Match-Lab-specific except the
// caller converting its own 0-100% grid into yards before calling in).
//
// Replaces two things at once, deliberately: (1) engagingOpponent()'s
// mixed-percentage-unit distance check, which could treat a defender
// genuinely 20+ REAL yards away as "engaging" depending on which axis the
// gap was on; (2) the old actionWeights()/selectTeammateTarget() model,
// which scored the generic word "pass" off the passer's own attributes
// and zone, never the specific candidate teammate's pressure/lane/
// progression -- so two very different passes (one open, one into a
// crowd) got the same weight.
//
// Deliberate attribute split (per explicit instruction): Decisions/
// Vision/Anticipation/Composure govern how SHARP a player's selection is
// (chooseCandidate()'s noise scale below) -- never the utility formulas
// themselves. Passing/Technique/Finishing/Dribbling are EXECUTION
// attributes; they already fully determine whether a chosen action
// succeeds via the real resolvers (resolvePlacedFinish/localizedDuel/etc
// in matchEngineCore.js) and are deliberately NOT read here too -- see
// the Stage 2 review's "attribute compounding" concern (MATCH_LAB_PLAN.md)
// for why letting skill double up on both the decision AND the outcome
// would be a real modeling mistake, not a nuance worth adding.
//
// No probability tuning in this module -- the ~10 weight/coefficient
// constants below are reasonable, round, football-literate starting
// points (explicitly not calibrated against real data this pass, per
// instruction), and every acceptance test in
// tools/test-spatial-decision.mjs uses MONOTONIC comparisons (closer
// shots score higher, more pressure scores lower, etc), never an exact
// target rate.
//
// EXPLICIT LIMITATION, not an oversight -- v1's utility functions are
// currently ABILITY-BLIND. Given identical geometry (same positions,
// same pressure, same lane), Roberto Carlos and a technically weak
// player produce essentially the same objective candidate ranking; only
// chooseCandidate()'s perception-noise scale differs between them (a
// sharper player tracks that SAME ranking more closely, a weaker one
// strays from it more often -- see selectionSharpness()). What's missing
// is any sense that a player who is genuinely GOOD at an action should
// rate that action more attractive in the first place, independent of
// noise -- a world-class crosser should find crossing more appealing
// than a poor one would, at the exact same geometry, not just execute it
// better once chosen.
//
// Future direction (NOT built here, per explicit instruction not to tune
// this casually): an "expected-success" or "action-affinity" term --
// e.g. a per-candidate multiplier or additive bonus derived from the
// SAME execution attributes the real resolvers already use (Passing/
// Technique for a pass, Crossing/Technique for a cross, Finishing for a
// shot, Dribbling/Acceleration for a carry/dribble) -- added to the
// UTILITY score itself, so it shapes which candidate WINS the decision.
// The critical constraint on that future work: it must read those
// attributes ONLY to compute this new utility term, and must NEVER touch
// or influence executionRandom or any real resolver's own attribute
// reads -- the actual outcome must keep being decided exactly once, by
// the real resolver, exactly as it is today. Done carelessly, an
// affinity term that's really just execution quality restated would
// silently reintroduce the attribute-compounding problem this file's own
// perception/execution split exists to prevent (a good player would get
// rewarded twice for the same skill: once in which action gets chosen,
// again in whether it succeeds) -- so this needs its own deliberate
// design pass, not a quick addition, when picked up.

import {
  average, clamp, hashString, isAttacker, isDefender, isMidfielder, playerAttribute, playerAttributeEntries,
} from "./matchEngineCore.js";
import { buildOffsideSnapshot, onsideLineTargetY, secondLastOpponentLine } from "./matchOffside.js";
import {
  kineticsAttribution, timeToReach, touchError, runningTouchLaunchSpeedYps, touchThreshold, reachIn,
} from "./playerKinetics.js";
import { rollStopDistanceYards, rollStopDurationMs, rollTraveledYards } from "./ballRollPhysics.js";
import {
  continuousPositionAtElapsed, movementDistanceYards, pointAlongMovement,
} from "./matchMovementTiming.js";
import { advanceMotion, velocityAlong } from "./worldMotion.js";
// Action Pattern Schema v1 (2026-09-05) -- the five special-run pictures
// below are now DECLARED in actionPatternRegistry.js rather than encoded as
// an if-chain here. The geometry stays in this file and is injected into the
// matcher, so the declarations own trigger order, participant binding and the
// "1 special run" cap while every coordinate is still produced by the same
// functions as before.
import { matchActionPatterns } from "./actionPatternRegistry.js";
// Joint Passer/Runner Candidate Generation v1 (Stage 3, 2026-09-05).
// passRunCandidates.js is a LEAF: it deliberately imports nothing from this
// file or from matchPassFlight.js (which already imports from this one), so
// the pass-flight and lane primitives it needs are injected by the caller
// instead. That is why there is no import cycle here and no second
// ball-flight model anywhere in that module.
import {
  generateJointCandidates, bestCandidateForRunner, bestThroughBallCandidate,
} from "./passRunCandidates.js?v=20260913-01";
import {
  fromYardPoint, GOAL_WIDTH_YARDS, PENALTY_AREA_DEPTH_YARDS, PENALTY_AREA_WIDTH_YARDS,
  PITCH_LENGTH_YARDS, PITCH_WIDTH_YARDS, toYardPoint, yardDistance, findPitchExit,
  defendingGoalYForDirection,
} from "./pitchGeometry.js";
import {
  applyTeamInstructionBiases, DEFAULT_TEAM_ATTACKING, normalizeTeamAttacking,
} from "./teamInstructions.js";

// ---------------------------------------------------------------------------
// Yard geometry -- the ONE conversion every distance/radius below is
// evaluated in. A 0-100% grid point is not uniform: 1% of width (75yd) and
// 1% of length (120yd) are different real distances, so comparing raw
// percentage deltas (as engagingOpponent() used to) can wildly overstate
// or understate how far apart two players actually are depending on
// which axis the gap falls on -- literally the bug a real browser round
// caught (a defender 20+ real yards away still counted as "engaging").
// ---------------------------------------------------------------------------

export {
  fromYardPoint, GOAL_WIDTH_YARDS, PITCH_LENGTH_YARDS, PITCH_WIDTH_YARDS,
  toYardPoint, yardDistance, effortScaledAdvance, pointAheadYards,
};

// Perpendicular distance from `point` to the straight segment a->b, in
// yards -- how obstructionScore() and any future pass-lane check measure
// "is this opponent standing in the way," not just "is this opponent
// somewhere between the two ends."
export function yardDistanceToSegment(point, a, b) {
  const py = toYardPoint(point);
  const ay = toYardPoint(a);
  const by = toYardPoint(b);
  const dx = by.x - ay.x;
  const dy = by.y - ay.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared === 0) return Math.hypot(py.x - ay.x, py.y - ay.y);
  const t = clamp(0, 1, ((py.x - ay.x) * dx + (py.y - ay.y) * dy) / lengthSquared);
  const closestX = ay.x + t * dx;
  const closestY = ay.y + t * dy;
  return Math.hypot(py.x - closestX, py.y - closestY);
}

// A real body's own personal space -- close enough that two adults
// standing there would genuinely brush shoulders, not just "somewhere in
// the same patch of grass." Deliberately tighter than DUEL_RANGE_YARDS
// (which gates whether a contest happens at all): this is purely "does a
// straight path walk THROUGH someone," not a contest range of its own.
export const CARRY_BODY_CLEARANCE_YARDS = 1.3;

// A tangent point from external point A to a circle (center C, radius R)
// -- the well-known property that makes this useful here: the straight
// segment from A to a genuine tangent point never comes closer than R to
// C anywhere along its OWN length, not just at one specific point. (An
// earlier version of carrySteeringWaypoint() pushed a point sideways from
// the line's own closest approach instead -- correct exactly there, but
// the bent segment from `from` could still swing closer to the opponent
// at some OTHER point along its own length; a real reported bug.) Returns
// both tangent points (one per side); null when `from` already sits
// inside the circle (nothing a tangent line can do from in there).
function tangentPoints(fromYards, centerYards, radius) {
  const acx = fromYards.x - centerYards.x;
  const acy = fromYards.y - centerYards.y;
  const d = Math.hypot(acx, acy);
  if (d <= radius) return null;
  const ux = acx / d;
  const uy = acy / d;
  const cosAlpha = radius / d;
  const sinAlpha = Math.sqrt(Math.max(0, 1 - cosAlpha * cosAlpha));
  return [
    { x: centerYards.x + radius * (ux * cosAlpha - uy * sinAlpha), y: centerYards.y + radius * (uy * cosAlpha + ux * sinAlpha) },
    { x: centerYards.x + radius * (ux * cosAlpha + uy * sinAlpha), y: centerYards.y + radius * (uy * cosAlpha - ux * sinAlpha) },
  ];
}

// Body Avoidance v1 (2026-08-28) -- a real reported bug: a dribble/carry's
// own path was a straight line in real-world space with no awareness of
// where opponents' bodies actually stand -- the carrier's marker could
// walk straight through a defender directly in the way, "like a ghost."
// Real football: a body steers around a defender even on a genuinely won
// duel -- only a close touch gets the BALL past them, the body still has
// to go around. This finds the SINGLE most-obstructing opponent (if any)
// whose real body radius the straight line from `from` to `to` passes
// through -- reusing yardDistanceToSegment()'s own projection math, not a
// second one -- and returns a genuine tangent point on their clearance
// circle: the [from, waypoint] segment is guaranteed clear along its
// ENTIRE length, not just at one point, by the tangent-line property
// itself. Of the two tangent points (one per side), picks whichever
// keeps the total from->waypoint->to distance shorter -- go around
// whichever side is actually the shorter way round. Returns null when
// the line is already clear, or the closest approach sits essentially at
// `to` itself (arriving almost on top of them is a different, harder
// problem than a mid-path waypoint can solve -- left to the duel-
// resolution layer that already decides who actually gets that spot).
// A real reported bug: a flat clamp(0, max, value) at a pitch boundary
// can cancel an escape step ENTIRELY -- a carrier already standing at
// x=0 whose computed escape direction points further negative clamps
// straight back to their own starting x, a genuine zero-displacement
// "steer" that then repeats identically (same deterministic inputs)
// every single touch until a caller's own safety cap. Reflecting off the
// boundary instead of clamping to it preserves the real displacement
// magnitude -- "there's a touchline in the way" becomes "step the other
// way by the same amount," never "don't move at all."
export function reflectIntoRange(value, min, max) {
  if (value < min) return min + (min - value);
  if (value > max) return max - (value - max);
  return value;
}

export function carrySteeringWaypoint(from, to, opponents = [], clearanceYards = CARRY_BODY_CLEARANCE_YARDS) {
  const fromYards = toYardPoint(from);
  const toYards = toYardPoint(to);
  const dx = toYards.x - fromYards.x;
  const dy = toYards.y - fromYards.y;
  const lengthSquared = dx * dx + dy * dy;
  if (lengthSquared < 0.01) return null;
  let worst = null;
  for (const opponent of opponents) {
    const opponentYards = toYardPoint(opponent);
    const t = clamp(0, 1, ((opponentYards.x - fromYards.x) * dx + (opponentYards.y - fromYards.y) * dy) / lengthSquared);
    if (t >= 0.98) continue;
    const gap = yardDistanceToSegment(opponent, from, to);
    if (gap >= clearanceYards) continue;
    if (!worst || gap < worst.gap) worst = { gap, opponentYards };
  }
  if (!worst) return null;
  // A small margin beyond the bare minimum clearance -- a tangent line
  // that JUST grazes the circle still reads as uncomfortably close.
  const radius = clearanceYards + 0.3;
  const candidates = tangentPoints(fromYards, worst.opponentYards, radius);
  if (!candidates) {
    // `from` is already inside the danger circle (a defender genuinely
    // right on top of the carrier's own current spot -- a real, reported
    // case: a challenger who just contested the SAME loose ball or
    // shielding duel can land at the carrier's own EXACT coordinates). No
    // tangent line exists from in there; step straight away from them
    // instead. When they're close but not perfectly coincident, "away"
    // is a real direction. When they sit at the EXACT same point (the
    // away vector itself is zero -- nothing to normalize), fall back to
    // the same perpendicular-to-the-direction-of-travel this function
    // already uses for an opponent sitting exactly on the line: a real,
    // deterministic sideways step rather than a degenerate zero-distance
    // "steer" that never actually moves the carrier at all.
    const awayX = fromYards.x - worst.opponentYards.x;
    const awayY = fromYards.y - worst.opponentYards.y;
    const awayLength = Math.hypot(awayX, awayY);
    const length = Math.sqrt(lengthSquared);
    const unitX = awayLength > 0.02 ? awayX / awayLength : -dy / length;
    const unitY = awayLength > 0.02 ? awayY / awayLength : dx / length;
    return fromYardPoint({
      x: reflectIntoRange(fromYards.x + unitX * radius, 0, PITCH_WIDTH_YARDS),
      y: reflectIntoRange(fromYards.y + unitY * radius, 0, PITCH_LENGTH_YARDS),
    });
  }
  const totalDistance = (point) => Math.hypot(point.x - fromYards.x, point.y - fromYards.y)
    + Math.hypot(toYards.x - point.x, toYards.y - point.y);
  const chosen = totalDistance(candidates[0]) <= totalDistance(candidates[1]) ? candidates[0] : candidates[1];
  return fromYardPoint({
    x: reflectIntoRange(chosen.x, 0, PITCH_WIDTH_YARDS),
    y: reflectIntoRange(chosen.y, 0, PITCH_LENGTH_YARDS),
  });
}

// ---------------------------------------------------------------------------
// Distinct spatial radii (yards) -- six separate real-football concepts
// that engagingOpponent()'s single ENGAGEMENT_DISTANCE used to collapse
// into one. Round, football-literate, explicitly not calibrated this pass.
// ---------------------------------------------------------------------------

// How far away an opponent still factors into perception/decision-making
// at all (do they exist in the picture) -- the loosest radius.
export const AWARENESS_RADIUS_YARDS = 25;
// Close enough to apply meaningful "pressure" on the ball carrier (rushed
// decisions, harder execution) without necessarily being in physical
// contest range yet.
export const PRESSURE_RADIUS_YARDS = 9;
// Close enough for a genuine physical/progression duel to occur at all --
// what engagingOpponent() itself now means: is there really someone here
// to contest this action, structurally (not just "the nearest of however
// many are placed, however far that happens to be").
export const DUEL_RANGE_YARDS = 6;
// How far goal-side (real yards) an engaging defender must stand before
// this reads as a genuine back-to-goal hold-up duel rather than an
// ordinary dribble engagement -- see generateFreePlayCandidates()'s own
// backToGoal comment for why a smaller margin was too permissive.
const BACK_TO_GOAL_MIN_GOAL_SIDE_YARDS = 3;
// The real, physical limit of a goalkeeper's own hand throw -- a strong
// overarm throw genuinely reaches 30-40 real yards; nowhere close to
// spanning a full pitch. keeperDistributionCandidates()'s own throw-short/
// throw-long options are only ever drawn from teammates within this
// range; a punt (a real kick) is the unbounded-range option instead.
const KEEPER_THROW_MAX_YARDS = 38;
// Tight range for a standing tackle attempt.
export const STANDING_TACKLE_RANGE_YARDS = 3;
// Slightly longer reach via a slide.
export const SLIDING_TACKLE_RANGE_YARDS = 5;
// How close an opponent needs to stand to a straight pass lane to count
// as genuinely obstructing it (not just "somewhere in that half of the
// pitch").
export const PASS_LANE_HALF_WIDTH_YARDS = 3;

function nearestWithin(point, candidates, radiusYards) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = yardDistance(point, candidate);
    if (distance <= radiusYards && distance < nearestDistance) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return nearest;
}

// The corrected engagingOpponent() -- same call shape (point, opponents) ->
// nearest-or-null the existing resolvers already expect, now genuinely
// yard-based and scoped to DUEL_RANGE_YARDS instead of ENGAGEMENT_DISTANCE's
// mixed-unit percentage figure. A player 20+ real yards away can no longer
// be "the nearest opponent" AND "close enough to engage" just because no
// one closer happens to be placed.
export function engagingOpponent(point, opponents) {
  return nearestWithin(point, opponents, DUEL_RANGE_YARDS);
}

export function pressuringOpponent(point, opponents) {
  return nearestWithin(point, opponents, PRESSURE_RADIUS_YARDS);
}

export function awareOpponents(point, opponents) {
  return opponents.filter((opponent) => yardDistance(point, opponent) <= AWARENESS_RADIUS_YARDS);
}

export function canStandingTackle(point, opponent) {
  return yardDistance(point, opponent) <= STANDING_TACKLE_RANGE_YARDS;
}

export function canSlidingTackle(point, opponent) {
  return yardDistance(point, opponent) <= SLIDING_TACKLE_RANGE_YARDS;
}

// 0 (nobody near the ball) .. ~1+ (someone right on top of the carrier) --
// a smooth pressure figure from the single nearest opponent within
// PRESSURE_RADIUS_YARDS, not a binary in-range/out-of-range flag.
export function pressureAt(point, opponents) {
  const nearest = pressuringOpponent(point, opponents);
  if (!nearest) return 0;
  const distance = yardDistance(point, nearest);
  return clamp(0, 1.2, 1 - distance / PRESSURE_RADIUS_YARDS);
}

// While a goalkeeper has the ball in his hands, opponents cannot challenge
// him. Match Lab models the requested 9.15m exclusion as pitch geometry so
// the off-ball planner can retain shape without aiming anybody at the holder.
export const KEEPER_HELD_OPPONENT_DISTANCE_METERS = 9.15;
export const KEEPER_HELD_OPPONENT_DISTANCE_YARDS =
  KEEPER_HELD_OPPONENT_DISTANCE_METERS * 1.0936132983377078;
const KEEPER_HELD_TARGET_BUFFER_YARDS = 0.25;

export function heldKeeperStandoffTarget(
  opponent,
  proposedTarget,
  keeperPoint,
  minimumYards = KEEPER_HELD_OPPONENT_DISTANCE_YARDS,
) {
  const current = toYardPoint(opponent);
  const proposed = toYardPoint(proposedTarget ?? opponent);
  const keeper = toYardPoint(keeperPoint);
  const required = Math.max(0, Number(minimumYards) || 0);
  const desired = required + KEEPER_HELD_TARGET_BUFFER_YARDS;
  const currentVector = { x: current.x - keeper.x, y: current.y - keeper.y };
  let vector = { x: proposed.x - keeper.x, y: proposed.y - keeper.y };
  let length = Math.hypot(vector.x, vector.y);
  const currentLength = Math.hypot(currentVector.x, currentVector.y);

  // Do not let a straight shape run cut through the exclusion circle even
  // when both endpoints happen to be legal. Holding the current position is
  // the honest path until a later shape target stays on the same safe side.
  if (currentLength >= required
    && yardDistanceToSegment(keeperPoint, opponent, proposedTarget ?? opponent) < required) {
    return { x: opponent.x, y: opponent.y, zone: opponent.zone ?? null };
  }
  if (length >= required) return fromYardPoint({ x: keeper.x + vector.x, y: keeper.y + vector.y });

  if (length < 0.001) {
    vector = currentLength >= 0.001
      ? currentVector
      : { x: PITCH_WIDTH_YARDS / 2 - keeper.x, y: PITCH_LENGTH_YARDS / 2 - keeper.y };
    length = Math.hypot(vector.x, vector.y);
  }
  if (length < 0.001) {
    vector = { x: 0, y: keeper.y <= PITCH_LENGTH_YARDS / 2 ? 1 : -1 };
    length = 1;
  }
  let target = {
    x: clamp(0, PITCH_WIDTH_YARDS, keeper.x + vector.x / length * desired),
    y: clamp(0, PITCH_LENGTH_YARDS, keeper.y + vector.y / length * desired),
  };
  if (Math.hypot(target.x - keeper.x, target.y - keeper.y) + 1e-6 < required) {
    const centerVector = {
      x: PITCH_WIDTH_YARDS / 2 - keeper.x,
      y: PITCH_LENGTH_YARDS / 2 - keeper.y,
    };
    const centerLength = Math.hypot(centerVector.x, centerVector.y) || 1;
    target = {
      x: clamp(0, PITCH_WIDTH_YARDS, keeper.x + centerVector.x / centerLength * desired),
      y: clamp(0, PITCH_LENGTH_YARDS, keeper.y + centerVector.y / centerLength * desired),
    };
  }
  return fromYardPoint(target);
}

// How obstructed the straight lane from `from` to `to` is, 0 (clear) to 1
// (an opponent standing right on the line) -- the CLOSEST any opponent
// gets to the segment, converted to a 0-1 score via
// PASS_LANE_HALF_WIDTH_YARDS.
export function laneObstruction(from, to, opponents) {
  let closest = Infinity;
  for (const opponent of opponents) {
    const distance = yardDistanceToSegment(opponent, from, to);
    if (distance < closest) closest = distance;
  }
  if (!Number.isFinite(closest)) return 0;
  return clamp(0, 1, 1 - closest / PASS_LANE_HALF_WIDTH_YARDS);
}

const TEAMMATE_CLUTTER_RADIUS_YARDS = 5;
const TEAMMATE_CLUTTER_WEIGHT = 1.1;

// Bugfix slice (2026-09-02) -- a real reported bug: "plays a ground pass
// into the space ahead of X, but Y gets to it" -- a congested midfield kept
// getting offered a pass INTO its own crowd because nothing here ever
// checked whether another teammate already stood at/near the target.
// Mirrors laneObstruction()'s own shape (closest body, clamped 0-1 over a
// real yard radius) -- just for a TEAMMATE at the destination rather than
// an opponent along the lane. `excludeId` is the receiving teammate
// themselves (never penalized for occupying their own target).
function teammateClutter(target, teammates, excludeId) {
  let closest = Infinity;
  for (const teammate of teammates || []) {
    if (teammate?.id === excludeId) continue;
    const distance = yardDistance(target, teammate);
    if (distance < closest) closest = distance;
  }
  if (!Number.isFinite(closest)) return 0;
  return clamp(0, 1, 1 - closest / TEAMMATE_CLUTTER_RADIUS_YARDS);
}

// The SPECIFIC opponent genuinely positioned to cut a pass out of the
// air mid-flight -- nearest-within-PASS_LANE_HALF_WIDTH_YARDS-of-the-
// segment-or-null, the same "entry-or-null" shape engagingOpponent()
// already uses. Deliberately a DIFFERENT question from engagingOpponent()
// (nearest to the PASSER): a defender harassing the passer isn't
// necessarily anywhere near the ball's actual flight path, and a
// defender genuinely sitting in the lane further away is who actually
// intercepts it -- see resolvePass()'s own comment on why these are two
// separate roles now (passer pressure vs lane interception), mirroring
// the crosser-pressure/aerial-defender split resolveCross() already got.
export function nearestLaneInterceptor(from, to, opponents) {
  let nearest = null;
  let nearestDistance = Infinity;
  for (const opponent of opponents) {
    const distance = yardDistanceToSegment(opponent, from, to);
    if (distance <= PASS_LANE_HALF_WIDTH_YARDS && distance < nearestDistance) {
      nearest = opponent;
      nearestDistance = distance;
    }
  }
  return nearest;
}

// Tight range for genuinely smothering a cross before it's struck --
// closer than a general duel, since this is about a body/leg reaching
// the ball at the crosser's own feet, not a footrace to space.
export const CROSS_SOURCE_CONTEST_RANGE_YARDS = 4;

// The specific opponent positioned AND directionally able to contest a
// cross AT THE SOURCE, before it's struck -- "position and reachable
// path intersect the delivery action," not proximity alone (a real
// browser-round requirement). Two conditions, both required: (1) within
// CROSS_SOURCE_CONTEST_RANGE_YARDS of the crosser -- close enough to
// actually reach the ball, not just "nearby" in the AWARENESS_RADIUS_YARDS
// sense; (2) not meaningfully BEHIND the crosser relative to the
// direction the ball is being struck (toward deliveryTargetPoint) -- a
// defender standing between the crosser and their OWN goal cannot reach
// out and block a ball moving away from them no matter how close they
// stand. The dot-product check below is that directional gate: positive
// means "in front of or beside" the kicking direction, meaningfully
// negative means "behind it."
export function crossSourceContestDefender(crosser, deliveryTargetPoint, opponents) {
  const crosserYard = toYardPoint(crosser);
  const targetYard = toYardPoint(deliveryTargetPoint);
  const deliveryDx = targetYard.x - crosserYard.x;
  const deliveryDy = targetYard.y - crosserYard.y;
  const deliveryLength = Math.hypot(deliveryDx, deliveryDy) || 1;
  let nearest = null;
  let nearestDistance = Infinity;
  for (const opponent of opponents) {
    const distance = yardDistance(crosser, opponent);
    if (distance > CROSS_SOURCE_CONTEST_RANGE_YARDS) continue;
    const opponentYard = toYardPoint(opponent);
    const relX = opponentYard.x - crosserYard.x;
    const relY = opponentYard.y - crosserYard.y;
    const directional = (relX * deliveryDx + relY * deliveryDy) / deliveryLength;
    if (directional < -0.5) continue; // meaningfully behind the kicking direction
    if (distance < nearestDistance) { nearest = opponent; nearestDistance = distance; }
  }
  return nearest;
}

// Turns a delivery's accuracy error (real yards, from resolveCrossDelivery())
// into an actual landing point -- a deterministic angle derived from the
// SAME execution random stream (never a fresh, untracked roll), displaced
// from the intended target by the real error distance. Ball Out of Bounds v1
// (2026-09-01): deliberately UNclamped -- a genuinely wild delivery must be
// allowed to land off-pitch so callers can detect the real exit via
// findPitchExit() instead of the ball silently stopping dead at the edge.
export function deliveryLandingPoint(intendedTarget, accuracyErrorYards, random) {
  if (accuracyErrorYards <= 0) return { x: intendedTarget.x, y: intendedTarget.y };
  const angle = random() * Math.PI * 2;
  const targetYard = toYardPoint(intendedTarget);
  const rawYard = {
    x: targetYard.x + Math.cos(angle) * accuracyErrorYards,
    y: targetYard.y + Math.sin(angle) * accuracyErrorYards,
  };
  return fromYardPoint(rawYard);
}

// ---------------------------------------------------------------------------
// Goal geometry -- attackingDirection is the same "down"/"up" convention
// state.attackingDirection already uses (see match-lab.js): "down" attacks
// toward y:100%, "up" attacks toward y:0%. Mirrored here, not re-invented,
// so a caller's existing setting plugs straight in.
// ---------------------------------------------------------------------------

function attackingGoalYardPoint(attackingDirection) {
  return { x: PITCH_WIDTH_YARDS / 2, y: attackingDirection === "up" ? 0 : PITCH_LENGTH_YARDS };
}

// Exact distance to the center of the goal a player is attacking, in real
// yards -- replaces the old four-coarse-pitch-row zoneFit multiplier.
export function distanceToGoalYards(point, attackingDirection) {
  const goal = attackingGoalYardPoint(attackingDirection);
  const p = toYardPoint(point);
  return Math.hypot(p.x - goal.x, p.y - goal.y);
}

// Ball Out of Bounds v1 (2026-09-01) -- a real, explicit correction: "the
// boundaries are concrete... the ball should be able to go out of
// bounds," classified into the real restart. findPitchExit()
// (pitchGeometry.js) is pure geometry with no idea whose ball it is; this
// is the ONE place that adds the team/attacking-direction knowledge on
// top, matching every other attacking-direction-aware query in this file
// (distanceToGoalYards() just above). A touchline exit is always a
// throw-in for whichever team DIDN'T touch it last. A byline exit is a
// goal-kick when the ATTACKING team put it there themselves (over the
// defense's own byline, wide of the posts -- a shot that's actually ON
// TARGET and net-bound is resolved entirely separately, well before this
// would ever run), or a corner when the DEFENDING team put it behind
// their own line. Returns null whenever no exit is found (or given), or
// the caller can't supply real last-touch/attacking-direction data --
// this never fabricates a restart from a guess.
// `exit` (optional): an ALREADY-KNOWN {edge, point} from a caller that
// did its own boundary detection at the physics layer (simulateOneTouch()'s
// own exitedPitch, for carries/dribbles) -- skips re-deriving it from
// `from`/`to` here, which matters: that caller's own `to` is already the
// CLAMPED exit point sitting exactly ON the line, and findPitchExit()
// correctly reads a point sitting ON (not past) the line as in-bounds, so
// re-running it against an already-clamped point would silently find
// nothing. Callers that haven't already computed the exit (passes,
// crosses, clearances, the loose-ball roll) still just pass `from`/`to`
// and let this derive it via findPitchExit() same as before.
export function classifyPitchExit({ from, to, exit: knownExit, lastTouchTeam, attackingDirectionByTeam }) {
  if (!lastTouchTeam || !attackingDirectionByTeam) return null;
  const exit = knownExit ?? findPitchExit(from, to);
  if (!exit) return null;
  const teams = Object.keys(attackingDirectionByTeam);
  if (exit.edge === "left" || exit.edge === "right") {
    const possessionTeam = teams.find((team) => team !== lastTouchTeam) ?? null;
    return { restart: "throw-in", edge: exit.edge, ballEnd: exit.point, possessionTeam };
  }
  // "top" (y=0) is the goal-line of whichever team attacks "down" (their
  // own goal sits at the OPPOSITE end from where they attack); "bottom"
  // (y=100) is the mirror -- whichever team attacks "up".
  const ownGoalTeam = teams.find(
    (team) => attackingDirectionByTeam[team] === (exit.edge === "top" ? "down" : "up"),
  ) ?? null;
  const attackingTeam = teams.find((team) => team !== ownGoalTeam) ?? null;
  if (lastTouchTeam === ownGoalTeam) {
    return { restart: "corner", edge: exit.edge, ballEnd: exit.point, possessionTeam: attackingTeam };
  }
  return { restart: "goal-kick", edge: exit.edge, ballEnd: exit.point, possessionTeam: ownGoalTeam };
}

// 0 (dead central, the easiest angle) to ~1 (very tight, near the
// goal-line touchline) -- the lateral yard offset from the goal's own
// center line, scaled by how close the shooter is (the same lateral
// offset is a much tighter angle up close than it is from distance).
export function shotAngleTightness(point, attackingDirection) {
  const goal = attackingGoalYardPoint(attackingDirection);
  const p = toYardPoint(point);
  const lateral = Math.abs(p.x - goal.x);
  const depth = Math.max(1, Math.abs(p.y - goal.y));
  return clamp(0, 1, (lateral / (depth + GOAL_WIDTH_YARDS)));
}

// How open the direct shooting lane to goal is -- 1 minus the worst
// obstruction from any OUTFIELD opponent standing between the shooter and
// the goal center. The keeper is deliberately excluded here, not treated
// as an ordinary body in the way: a keeper standing near the center of
// their own goal is doing their job, not a surprise obstruction the way
// a defender blocking a ground pass lane is -- a real browser round
// correctly flagged that treating them identically collapsed lane
// openness to ~0 for almost any normal central shot (the keeper is
// naturally near the direct line to goal most of the time), which reads
// as "the lane is blocked" when the honest situation is just "there's a
// keeper, as there always is." Real keeper-aware shot difficulty (which
// SIDE is exposed, reflexes, etc) is already modeled properly downstream
// by the real resolver (resolveKeeperSave() et al, matchEngineCore.js)
// once a shot is actually taken -- this decision-layer utility isn't
// trying to re-derive that. A genuine target-side-aware model (does the
// keeper's positioning make ONE SIDE of the goal more attractive to aim
// at) is real future work, not built here -- see MATCH_LAB_PLAN.md.
export function shootingLaneOpenness(point, opponents, attackingDirection) {
  const goalPercentPoint = { x: 50, y: attackingDirection === "up" ? 0 : 100 };
  const worstObstruction = opponents.reduce((worst, blocker) => {
    const distance = yardDistanceToSegment(blocker, point, goalPercentPoint);
    const score = clamp(0, 1, 1 - distance / (GOAL_WIDTH_YARDS / 2));
    return Math.max(worst, score);
  }, 0);
  return clamp(0, 1, 1 - worstObstruction);
}

// ---------------------------------------------------------------------------
// Goalkeeper positioning -- see MATCH_LAB_PLAN.md, "Off-Ball Goalkeeper
// Awareness & Shot Placement Geometry" (2026-08-18). A real browser round
// caught the concrete failure this fixes: a keeper who never reacts to the
// ball ends up standing BEHIND an attacker who has carried past them --
// "static and unaware where the ball is." This is the standard real-
// football "narrow the angle" heuristic -- stand on the straight line
// between the ball and the center of your own goal -- not an attribute-
// driven model; a keeper-attribute-aware version (better keepers track
// the ball more precisely, react faster) is real future work, not built
// here. Pure geometry, no randomness, same "deterministic, not tuned"
// starting point as Directional Carry Planning.
// ---------------------------------------------------------------------------

const KEEPER_MIN_ADVANCE_YARDS = 2;
const KEEPER_MAX_ADVANCE_YARDS = 12;

// `keeperAttackingDirection` is the direction the KEEPER'S OWN team
// attacks (state.attackingDirection[keeper.team] for their side) -- their
// own goal is therefore the OPPOSITE end, same convention
// clearanceDanger() already uses.
export function keeperPositioningPoint(ballPoint, keeperAttackingDirection) {
  const ownGoalDirection = keeperAttackingDirection === "up" ? "down" : "up";
  const goal = attackingGoalYardPoint(ownGoalDirection);
  const ballYard = toYardPoint(ballPoint);
  const dx = ballYard.x - goal.x;
  const dy = ballYard.y - goal.y;
  const distanceToGoal = Math.hypot(dx, dy) || 1;
  const advance = clamp(KEEPER_MIN_ADVANCE_YARDS, KEEPER_MAX_ADVANCE_YARDS, distanceToGoal * 0.15);
  const ratio = advance / distanceToGoal;
  const rawYard = { x: goal.x + dx * ratio, y: goal.y + dy * ratio };
  const clampedYard = { x: clamp(0, PITCH_WIDTH_YARDS, rawYard.x), y: clamp(0, PITCH_LENGTH_YARDS, rawYard.y) };
  return fromYardPoint(clampedYard);
}

// ---------------------------------------------------------------------------
// Off-Ball Defender Awareness v1 -- see MATCH_LAB_PLAN.md (2026-08-18). A
// browser round asked for real defensive "consciousness": the nearest
// defender presses the ball carrier (closes distance, capped per step,
// stopping a real standoff short of them -- eventually bringing them
// into genuine duel/pressure range, where the EXISTING engagement/
// pressure machinery already takes over honestly; nothing about
// dribbling/tackling/pressure ITSELF changes here, only where a
// defender stands going into the next action). Every OTHER defender
// covers the nearest not-yet-covered attacking teammate, goal-side,
// narrowing the passing lane to them -- the same "narrow the space"
// principle keeperPositioningPoint() already uses, at a much tighter
// mark-tracking distance than a keeper's own goal-line standoff. A
// genuinely lone carrier (no attacking teammates left to cover) gets
// swarmed instead -- every defender presses, per the explicit "if the
// carrier is alone... they may both approach" instruction. Pure
// geometry, no randomness -- same "deterministic, not tuned" starting
// point every other positioning heuristic in this file already uses.
// Attribute-aware defending (a sharper defender reads the situation
// faster, marks tighter) is real future work, not built here -- see this
// file's own header on the perception/execution split.
// ---------------------------------------------------------------------------

const DEFENDER_MAX_ADVANCE_YARDS = 8;
const PRESS_STANDOFF_YARDS = 1.5;
// Real browser rounds reported defenders reading as "too stuck to their
// opponents" -- markers effectively adjacent. 4 real yards (the original
// value) is standing-tackle-adjacent distance, appropriate for someone
// actively jockeying a live threat, not the base "goal-side cover/mark"
// spacing most of a passage of play actually looks like. 7 yards, scaled
// 0.7x-1.3x by markingTightnessQuality() the same as before, gives a real
// ~5-9 yard range -- recognizably "marking," not glued together.
const COVER_STANDOFF_YARDS = 7;
// Progression Contest v1 (2026-08-28) -- cover-shadow's own standoff:
// deliberately between PRESS_STANDOFF_YARDS(1.5, actively jockeying) and
// COVER_STANDOFF_YARDS(7, settled zonal marking) -- a defender closing
// down a carrier who has already beaten the first man is neither of
// those pictures, just genuinely tighter than routine cover.
const COVER_SHADOW_STANDOFF_YARDS = 3.5;
const SCREEN_LANE_FRACTION = 0.58;

// Real position, not proximity to the ball -- matchEngineCore.js's own
// production classifiers (isDefender/isMidfielder/isAttacker), the same
// functions the live match tick loop uses for its own coarse role checks,
// reading each candidate's real position_text. Originally built for Quick
// Setup's own player selection; also the authoritative "who's actually on
// the back line" signal for planDefensiveRepositioning()'s own Defensive
// Shape Discipline below -- a nominal center-back holds a back-line slot
// based on their REAL position, not wherever they currently happen to be
// standing. An unclassifiable candidate (no position data at all) defaults
// to midfielder -- the most "generic utility player" bucket, not a
// fabricated defender or attacker rating.
export function classifyOutfieldBand(candidate) {
  if (isDefender(candidate)) return "defender";
  if (isMidfielder(candidate)) return "midfielder";
  if (isAttacker(candidate)) return "attacker";
  return "midfielder";
}

// Moves up to maxAdvanceYards from `from` toward `to` -- arrives exactly
// at `to` if already within that distance, never overshoots past it.
// General-purpose (reused for both pressing and covering below) -- the
// authoritative twin of match-lab.js's own cosmetic-only nudgeToward().
export function approachPoint(from, to, maxAdvanceYards) {
  const distanceYards = yardDistance(from, to);
  if (distanceYards <= maxAdvanceYards) return { x: to.x, y: to.y };
  const ratio = maxAdvanceYards / distanceYards;
  const fromYard = toYardPoint(from);
  const toYard = toYardPoint(to);
  const rawYard = { x: fromYard.x + (toYard.x - fromYard.x) * ratio, y: fromYard.y + (toYard.y - fromYard.y) * ratio };
  return fromYardPoint(rawYard);
}

// A pressing defender's real per-step target -- closes ground toward the
// ball carrier, capped at DEFENDER_MAX_ADVANCE_YARDS per step, but never
// closer than PRESS_STANDOFF_YARDS to them (a defender who has already
// closed to real range doesn't keep walking onto the carrier -- they
// hold that distance, jockeying, until the NEXT action's own
// engagingOpponent()/pressureAt() reads pick them up for real contest,
// same as any other placed defender).
export function pressingTarget(defenderPoint, ballOwnerPoint, maxAdvanceYards = DEFENDER_MAX_ADVANCE_YARDS) {
  const distance = yardDistance(defenderPoint, ballOwnerPoint);
  const desired = Math.max(0, distance - PRESS_STANDOFF_YARDS);
  const advance = Number.isFinite(maxAdvanceYards)
    ? Math.min(maxAdvanceYards, desired)
    : desired;
  return approachPoint(defenderPoint, ballOwnerPoint, advance);
}

// Goal-side marking position for `subject` (an attacking teammate not
// currently on the ball) -- COVER_STANDOFF_YARDS off them, on the
// straight line toward the covering defender's OWN goal
// (`defendingDirection` is the covering side's own attacking direction,
// same convention keeperPositioningPoint() uses -- their own goal is the
// opposite end). `defenderPlayer` is the marker's OWN player, whose
// Positioning/Marking/Anticipation tighten or loosen how close that
// standoff actually sits -- see markingTightnessQuality()'s own comment.
// Optional (defaults to a neutral, baseline-quality standoff, same as any
// other playerAttribute() call given no/incomplete player data) so
// existing callers that only have a bare point, not a full roster entry,
// still get a sensible result rather than an error.
export function coveringPositionPoint(subjectPoint, defendingDirection, defenderPlayer = null) {
  const ownGoalDirection = defendingDirection === "up" ? "down" : "up";
  const goal = attackingGoalYardPoint(ownGoalDirection);
  const subjectYard = toYardPoint(subjectPoint);
  const dx = goal.x - subjectYard.x;
  const dy = goal.y - subjectYard.y;
  const distanceToGoal = Math.hypot(dx, dy) || 1;
  // A tighter marker (higher quality) plays CLOSER -- standoff shrinks;
  // a loose marker gives more room -- standoff grows. Bounded 0.7x-1.3x,
  // the same range findSpaceTargetForAttack()'s own scaling uses, so
  // neither side of the same contest is structurally favored.
  const standoff = COVER_STANDOFF_YARDS * (1.3 - 0.6 * markingTightnessQuality(defenderPlayer));
  const ratio = Math.min(1, standoff / distanceToGoal);
  const rawYard = { x: subjectYard.x + dx * ratio, y: subjectYard.y + dy * ratio };
  const clampedYard = { x: clamp(0, PITCH_WIDTH_YARDS, rawYard.x), y: clamp(0, PITCH_LENGTH_YARDS, rawYard.y) };
  return fromYardPoint(clampedYard);
}

// Progression Contest v1 (2026-08-28) -- cover-shadow's own target: the
// SAME "stand off on the straight line toward my own goal" geometry
// coveringPositionPoint() already uses for an off-ball attacker, aimed
// at the ball CARRIER instead, at a fixed, tighter standoff (see
// COVER_SHADOW_STANDOFF_YARDS's own comment) rather than a
// quality-scaled marking distance -- this is a reaction to a beaten
// presser, not routine zonal shape.
function coverShadowPoint(ballOwnerPoint, ownGoalDirection) {
  const goal = attackingGoalYardPoint(ownGoalDirection);
  const ballYard = toYardPoint(ballOwnerPoint);
  const dx = goal.x - ballYard.x;
  const dy = goal.y - ballYard.y;
  const distanceToGoal = Math.hypot(dx, dy) || 1;
  const ratio = Math.min(1, COVER_SHADOW_STANDOFF_YARDS / distanceToGoal);
  const rawYard = { x: ballYard.x + dx * ratio, y: ballYard.y + dy * ratio };
  const clampedYard = { x: clamp(0, PITCH_WIDTH_YARDS, rawYard.x), y: clamp(0, PITCH_LENGTH_YARDS, rawYard.y) };
  return fromYardPoint(clampedYard);
}

// A screen is deliberately not a challenge. The defender targets a point on
// the carrier-to-receiver lane and stops there, making the pass less valuable
// without being promoted to the ball presser.
export function screeningPositionPoint(ballOwnerPoint, receiverPoint) {
  const ball = toYardPoint(ballOwnerPoint);
  const receiver = toYardPoint(receiverPoint);
  return fromYardPoint({
    x: ball.x + (receiver.x - ball.x) * SCREEN_LANE_FRACTION,
    y: ball.y + (receiver.y - ball.y) * SCREEN_LANE_FRACTION,
  });
}

// Defensive Shape Discipline v1 (2026-08-19) -- see MATCH_LAB_PLAN.md. A
// real browser round asked directly for back-line SHAPE: most teams hold
// a back four (or back three) as a genuine, evenly-spaced horizontal
// line, not a cluster collapsed onto one point -- and for it to be
// genuinely dependent on the Positioning attribute, a lower-rated
// defender visibly losing their line rather than holding it as precisely
// as a well-drilled one. Scoped to the back line specifically (not also
// the more variable midfield shapes -- flat four, 2-3, 4-plus-two-strikers
// -- the same round described; which shape a midfield actually holds
// depends on tactical decisions this project doesn't model yet, and is
// deliberately left as a documented follow-up rather than guessed at).
const BACK_LINE_WIDTH_YARDS = 50;
const BACK_LINE_MIN_DEPTH_YARDS = 14;
const BACK_LINE_MAX_DEPTH_YARDS = 52;
const BACK_LINE_DRIFT_MAX_FRACTION = 0.55;

function blendToward(from, to, fraction) {
  const fromYard = toYardPoint(from);
  const toYard = toYardPoint(to);
  return fromYardPoint({
    x: fromYard.x + (toYard.x - fromYard.x) * fraction,
    y: fromYard.y + (toYard.y - fromYard.y) * fraction,
  });
}

// The line's OWN depth reacts to the ball -- pushed higher when it's far
// away, dropped deep when danger is close -- clamped to a real, bounded
// band (never all the way to the halfway line, never sat on the goal line
// either; a real offside-trap precision system is real future work, not
// this v1's job).
function backLineDepthYards(ballPoint, defendingDirection) {
  const ownGoalDirection = defendingDirection === "up" ? "down" : "up";
  const ownGoal = attackingGoalYardPoint(ownGoalDirection);
  const ballDepthFromOwnGoal = Math.abs(toYardPoint(ballPoint).y - ownGoal.y);
  return clamp(BACK_LINE_MIN_DEPTH_YARDS, BACK_LINE_MAX_DEPTH_YARDS, ballDepthFromOwnGoal * 0.55);
}

// Positioning ONLY, deliberately not blended with Marking/Anticipation the
// way markingTightnessQuality() is -- the user's own framing named this
// attribute specifically for shape discipline, a distinct concern from the
// man-marking tightness that function already governs.
function positioningDisciplineQuality(player) {
  return clamp(0, 1, playerAttribute(player, "Positioning") / 20);
}

// One evenly-spaced lateral slot per classified back-line defender
// (classifyOutfieldBand() -- their REAL position, not wherever they
// currently happen to be standing), sorted by their own current x so slot
// assignment tracks left-to-right order rather than reshuffling who
// covers which side every tick. A lower-Positioning defender's ACTUAL
// target is then blended away from their correct slot, toward the ball --
// a real, deterministic "losing the line, ball-watching" drift: perfect
// Positioning sits exactly on the slot; poor Positioning is pulled up to
// BACK_LINE_DRIFT_MAX_FRACTION of the way toward the ball instead. Returns
// a Map id -> point, only for the defenders actually classified as the
// back line (everyone else keeps their existing job's own logic).
function backLineSlots(backLineDefenders, ballOwnerPoint, defendingDirection) {
  const depth = backLineDepthYards(ballOwnerPoint, defendingDirection);
  const ownGoalDirection = defendingDirection === "up" ? "down" : "up";
  const ownGoal = attackingGoalYardPoint(ownGoalDirection);
  const awayFromGoalSign = ownGoal.y === 0 ? 1 : -1;
  const slotYYard = ownGoal.y + awayFromGoalSign * depth;
  const centerX = PITCH_WIDTH_YARDS / 2;
  const sorted = [...backLineDefenders].sort((a, b) => a.x - b.x);
  const count = sorted.length;
  const slots = new Map();
  sorted.forEach((defender, index) => {
    const lateralFraction = count <= 1 ? 0.5 : index / (count - 1);
    const slotXYard = clamp(0, PITCH_WIDTH_YARDS, centerX - BACK_LINE_WIDTH_YARDS / 2 + BACK_LINE_WIDTH_YARDS * lateralFraction);
    const correctSpot = fromYardPoint({ x: slotXYard, y: slotYYard });
    const drift = (1 - positioningDisciplineQuality(defender.player)) * BACK_LINE_DRIFT_MAX_FRACTION;
    slots.set(defender.id, blendToward(correctSpot, ballOwnerPoint, drift));
  });
  return slots;
}

// One decision per defender, every step the ball is live. The presser is
// the nearest body -- unless that body is a centre-back who would have to
// abandon the line while a midfielder can close instead. Remaining
// defenders are assigned from the most dangerous attacker down (closest
// to our goal, and still a live threat relative to the ball) rather than
// "whoever happens to stand nearest this defender". Attackers clearly
// behind the ball are not marked unless every live threat already has a
// body; leftover centre-backs hold the back line rather than chasing.
// `target` is still a per-step capped approach (short reaction beats);
// `intentionTarget` is the uncapped ideal -- continuous flight motion
// chases that, so a 3-second pass is a real run, not an 8-yard shuffle.
const PRESSER_HOLD_LINE_YARDS = 8;
const PRESSER_MIDFIELD_SLACK_YARDS = 12;
// How far a leftover defender with no attacker of their own to mark must
// stay from the ball carrier -- the presser is already the one live body
// contesting the ball; nobody else's fallback target may land inside this
// radius of them, which was half of the original Weah Pile-Up bug
// (2026-08-23; leftover defenders defaulting to "cover the ball" itself).
const DEFENSIVE_BALL_CLEARANCE_YARDS = 10;

// ===========================================================================
// Off-Ball v2: Sticky Man/Zonal Marking (2026-08-24). The Weah Pile-Up fix
// above capped the SYMPTOM (an uncapped marker count let the whole back
// line individually shadow every threat) at a flat two markers. This
// replaces that cap with real positional marking: exclusive man-mark
// PAIRS assigned by role (a centre-back on the most advanced attacker, a
// full-back on their own flank's winger, a defensive mid on the
// opposition's #10), sticky across possession steps the same way
// previousSupportId/previousDropId already are (see
// planAttackerRepositioning()'s own comment on why sticky beats
// re-deciding from scratch every reaction), plus zonal strip coverage for
// everyone else. "Four markers on four different men is legal. Four
// markers on Weah is not" -- EXCLUSIVITY, not a headcount cap, is what
// actually prevents the pile-up.
// ===========================================================================

// Tightness is an INSTRUCTION, not a rating -- it sets the STANDOFF
// BRACKET a marker plays at; Marking/Positioning/Anticipation
// (markingTightnessQuality()) only move them within that bracket, never
// outside it. A tightness-1 CB with elite Marking still gives 6-8 yards; a
// tightness-5 CB with poor Marking still tries to play hip-to-hip and can
// be beaten for pace, but the INSTRUCTION itself never loosens.
const TIGHTNESS_STANDOFF_RANGE_YARDS = {
  1: [6, 8],
  2: [4, 6],
  3: [2, 4],
  4: [1, 2],
  5: [0.4, 1],
};
// How far (real yards, from the marker's OWN resting zone -- their back-
// line slot for a CB/full-back, a neutral central spot for a defensive
// mid) a tightness level actually follows before handing off. 1-2 hold a
// real defensive strip; 3 covers the whole back line; 4-5 follow almost
// anywhere short of an emergency last-man recall (never literally
// infinite).
const TIGHTNESS_FOLLOW_RADIUS_YARDS = { 1: 12, 2: 20, 3: 40, 4: 90, 5: 130 };
const ZONAL_MARK_TIGHTNESS = 2;
const MIDFIELD_STRIP_COUNT = 3;
const MIDFIELD_STRIP_FAR_DEPTH_YARDS = PITCH_LENGTH_YARDS * 0.62;
const FAR_SIDE_BALL_YARDS = 25;

function clampTightness(tightness) {
  return clamp(1, 5, Math.round(Number(tightness) || 3));
}

function tightnessStandoffYards(tightness, defenderPlayer) {
  const [min, max] = TIGHTNESS_STANDOFF_RANGE_YARDS[clampTightness(tightness)];
  return max - (max - min) * markingTightnessQuality(defenderPlayer);
}

function tightnessFollowRadiusYards(tightness) {
  return TIGHTNESS_FOLLOW_RADIUS_YARDS[clampTightness(tightness)];
}

// The man-marking twin of coveringPositionPoint(), just driven by the
// tightness instruction's own bracket instead of the fixed
// COVER_STANDOFF_YARDS every other cover job still uses -- same goal-side
// geometry (on the subject-to-own-goal line, never the subject's own
// coordinates).
function manMarkingPoint(subjectPoint, defendingDirection, defenderPlayer, tightness) {
  const ownGoalDirection = defendingDirection === "up" ? "down" : "up";
  const goal = attackingGoalYardPoint(ownGoalDirection);
  const subjectYard = toYardPoint(subjectPoint);
  const dx = goal.x - subjectYard.x;
  const dy = goal.y - subjectYard.y;
  const distanceToGoal = Math.hypot(dx, dy) || 1;
  const standoff = tightnessStandoffYards(tightness, defenderPlayer);
  const ratio = Math.min(1, standoff / distanceToGoal);
  const rawYard = { x: subjectYard.x + dx * ratio, y: subjectYard.y + dy * ratio };
  return fromYardPoint({
    x: clamp(0, PITCH_WIDTH_YARDS, rawYard.x),
    y: clamp(0, PITCH_LENGTH_YARDS, rawYard.y),
  });
}

// Caps a marker's target at tightnessFollowRadiusYards() from their OWN
// resting zone -- a tightness-1/2 CB genuinely does not follow the
// striker to the corner flag; tightness 4-5 follow almost anywhere.
function clampToFollowRadius(idealSpot, restPoint, tightness) {
  return approachPoint(restPoint, idealSpot, tightnessFollowRadiusYards(tightness));
}

function depthFromOwnGoal(point, defendingDirection) {
  const ownGoalDirection = defendingDirection === "up" ? "down" : "up";
  const ownGoal = attackingGoalYardPoint(ownGoalDirection);
  return Math.abs(toYardPoint(point).y - ownGoal.y);
}

// Purely positional role classification for THIS step's fresh default
// marking targets -- band classification (classifyOutfieldBand) plus
// lateral spread within the back line, never a fixed formation slot (this
// project doesn't model one). A back line of 1 has no full-back at all; a
// back line of 2+ gives the widest (up to) two bodies full-back duty, the
// rest are centre-backs.
function defenderMarkingRole(defender, backLineDefenders) {
  const band = classifyOutfieldBand(defender.player);
  if (band === "defender") {
    if (backLineDefenders.length <= 1) return "centreback";
    const fullbackSlots = Math.min(2, backLineDefenders.length - 1);
    const sortedByWidth = [...backLineDefenders].sort((a, b) => Math.abs(b.x - 50) - Math.abs(a.x - 50));
    const isFullback = sortedByWidth.slice(0, fullbackSlots).some((entry) => entry.id === defender.id);
    return isFullback ? "fullback" : "centreback";
  }
  if (band === "midfielder") return "defensive-mid";
  return "cover";
}

function mostAdvancedAttacker(attackingTeammates, ownGoalDirection) {
  if (!attackingTeammates.length) return null;
  return [...attackingTeammates].sort(
    (left, right) => distanceToGoalYards(left, ownGoalDirection) - distanceToGoalYards(right, ownGoalDirection),
  )[0];
}

function theTenAttacker(attackingTeammates, ownGoalDirection) {
  return mostAdvancedAttacker(
    attackingTeammates.filter((entry) => classifyOutfieldBand(entry.player) === "midfielder"),
    ownGoalDirection,
  );
}

function widestAttackers(attackingTeammates) {
  return [...attackingTeammates].sort((left, right) => Math.abs(right.x - 50) - Math.abs(left.x - 50));
}

// Sticky man/zonal assignment, one entry per defender:
// { subjectId, mode: "man"|"zonal", tightness }. Stickiness first (an
// existing valid pairing survives unless its subject is gone or already
// claimed by someone else this step -- same "don't flip on a razor-thin
// margin" principle as pickWithStickiness(), just applied to WHO marks
// WHOM), then fresh role-based defaults fill in anyone left, with
// exclusivity enforced throughout via `claimed` -- once an attacker is
// taken, no other marker may also claim them.
// tightnessOverride (2026-08-24, per-team Marking setup) -- when set (the
// options panel's own strictness dial), it REPLACES every hardcoded
// per-role tightness below (sticky-carried included) rather than blending
// with it; null keeps the original auto-graded defaults (fullback 2,
// marked centreback 3, defensive mid 2, zonal fallback ZONAL_MARK_TIGHTNESS)
// exactly as before this setting existed.
function buildMarkingAssignments(defenders, attackingTeammates, defendingDirection, previousMarking, tightnessOverride = null) {
  const ownGoalDirection = defendingDirection === "up" ? "down" : "up";
  const backLineDefenders = defenders.filter((entry) => classifyOutfieldBand(entry.player) === "defender");
  const advanced = mostAdvancedAttacker(attackingTeammates, ownGoalDirection);
  const ten = theTenAttacker(attackingTeammates, ownGoalDirection);
  const wide = widestAttackers(attackingTeammates);

  const assignments = new Map();
  const claimed = new Set();

  for (const defender of defenders) {
    const previous = previousMarking?.[defender.id];
    if (previous?.mode !== "man" || !previous.subjectId) continue;
    const subject = attackingTeammates.find((entry) => entry.id === previous.subjectId);
    if (!subject || claimed.has(subject.id)) continue;
    const tightness = tightnessOverride ?? clampTightness(previous.tightness);
    assignments.set(defender.id, { subjectId: subject.id, mode: "man", tightness });
    claimed.add(subject.id);
  }

  for (const defender of defenders) {
    if (assignments.has(defender.id)) continue;
    const role = defenderMarkingRole(defender, backLineDefenders);
    let target = null;
    let tightness = tightnessOverride ?? 2;
    if (role === "centreback" && advanced && !claimed.has(advanced.id)) {
      target = advanced;
      tightness = tightnessOverride ?? 3;
    } else if (role === "fullback") {
      const ownFlank = wide.find((entry) => !claimed.has(entry.id)
        && Math.sign(entry.x - 50 || 1) === Math.sign(defender.x - 50 || 1));
      target = ownFlank || wide.find((entry) => !claimed.has(entry.id)) || null;
      tightness = tightnessOverride ?? 2;
    } else if (role === "defensive-mid" && ten && !claimed.has(ten.id)) {
      target = ten;
      tightness = tightnessOverride ?? 2;
    }
    if (target) {
      assignments.set(defender.id, { subjectId: target.id, mode: "man", tightness });
      claimed.add(target.id);
    } else {
      assignments.set(defender.id, { subjectId: null, mode: "zonal", tightness: tightnessOverride ?? ZONAL_MARK_TIGHTNESS });
    }
  }
  return assignments;
}

// A full-back's own flank, judged from where THEY naturally sit (their
// own x), not their winger's current drifted position -- stable across a
// possession even if the winger tucks inside. Genuinely far side only
// (opposite half AND a real distance away), not merely "the ball is
// slightly closer to the other side."
function isFarSideBall(defenderPoint, ballOwnerPoint) {
  const ballYard = toYardPoint(ballOwnerPoint);
  const defenderYard = toYardPoint(defenderPoint);
  const centerYard = PITCH_WIDTH_YARDS / 2;
  // `< centerYard ? -1 : 1` (never 0) -- a ball sitting exactly on the
  // centre line is an unavoidable tie-break either way, but Math.sign()'s
  // real 0 case would otherwise never equal EITHER flank's own +-1 side,
  // making every full-back "far side" the instant the ball was dead
  // central -- the opposite of what this check means to catch.
  const defenderSide = defenderYard.x < centerYard ? -1 : 1;
  const ballSide = ballYard.x < centerYard ? -1 : 1;
  return defenderSide !== ballSide && Math.abs(ballYard.x - defenderYard.x) > FAR_SIDE_BALL_YARDS;
}

// Even strip boundaries between the back line's own real depth
// (backLineDepthYards()) and roughly the halfway line -- a zonal
// defender's own strip is whichever band their CURRENT position falls in,
// recomputed fresh every call from where they actually stand, never a
// fixed formation slot.
function midfieldStripBounds(ballOwnerPoint, defendingDirection) {
  const backDepth = backLineDepthYards(ballOwnerPoint, defendingDirection);
  const bounds = [];
  for (let index = 0; index < MIDFIELD_STRIP_COUNT; index += 1) {
    bounds.push([
      backDepth + ((MIDFIELD_STRIP_FAR_DEPTH_YARDS - backDepth) * index) / MIDFIELD_STRIP_COUNT,
      backDepth + ((MIDFIELD_STRIP_FAR_DEPTH_YARDS - backDepth) * (index + 1)) / MIDFIELD_STRIP_COUNT,
    ]);
  }
  return bounds;
}

function stripIndexFor(point, bounds, defendingDirection) {
  const depth = depthFromOwnGoal(point, defendingDirection);
  for (let index = 0; index < bounds.length; index += 1) {
    if (depth < bounds[index][1] || index === bounds.length - 1) return index;
  }
  return bounds.length - 1;
}

// Zonal coverage for every "zonal"-mode defender: moving strips around
// backLineSlots (the back line proper, handled separately) plus
// MIDFIELD_STRIP_COUNT bands in front of it. Empty zone -> cover-shadow
// (screen the ball-to-own-goal lane, never the ball itself). One attacker
// in the same strip -> goal-side mark at ZONAL_MARK_TIGHTNESS, never
// followed out of the strip. Two or more -> nearest danger takes the
// nearest attacker (repeated per remaining pair), the rest go unmarked in
// that strip -- "hand the other off" with nobody spare to hand off to.
function assignZonalCoverage(zonalDefenders, attackingTeammates, ballOwnerPoint, defendingDirection, tightnessOverride = null) {
  const bounds = midfieldStripBounds(ballOwnerPoint, defendingDirection);
  const stripOf = (point) => stripIndexFor(point, bounds, defendingDirection);
  const defendersByStrip = new Map();
  zonalDefenders.forEach((defender) => {
    const strip = stripOf(defender);
    if (!defendersByStrip.has(strip)) defendersByStrip.set(strip, []);
    defendersByStrip.get(strip).push(defender);
  });
  const attackersByStrip = new Map();
  attackingTeammates.forEach((attacker) => {
    const strip = stripOf(attacker);
    if (!attackersByStrip.has(strip)) attackersByStrip.set(strip, []);
    attackersByStrip.get(strip).push(attacker);
  });

  const results = new Map();
  defendersByStrip.forEach((stripDefenders, strip) => {
    const stripAttackers = [...(attackersByStrip.get(strip) || [])];
    const unusedDefenders = [...stripDefenders];
    while (unusedDefenders.length && stripAttackers.length) {
      let bestDefender = unusedDefenders[0];
      let bestAttacker = stripAttackers[0];
      let bestDistance = Infinity;
      unusedDefenders.forEach((defender) => {
        stripAttackers.forEach((attacker) => {
          const distance = yardDistance(defender, attacker);
          if (distance < bestDistance) {
            bestDistance = distance;
            bestDefender = defender;
            bestAttacker = attacker;
          }
        });
      });
      results.set(bestDefender.id, {
        action: "zone-cover",
        subjectId: bestAttacker.id,
        idealSpot: manMarkingPoint(bestAttacker, defendingDirection, bestDefender.player, tightnessOverride ?? ZONAL_MARK_TIGHTNESS),
      });
      unusedDefenders.splice(unusedDefenders.indexOf(bestDefender), 1);
      stripAttackers.splice(stripAttackers.indexOf(bestAttacker), 1);
    }
    unusedDefenders.forEach((defender) => {
      results.set(defender.id, {
        action: "screen",
        subjectId: null,
        idealSpot: keepClearOfBall(
          midfieldScreenPoint(ballOwnerPoint, defendingDirection),
          ballOwnerPoint,
          DEFENSIVE_BALL_CLEARANCE_YARDS,
        ),
      });
    });
  });
  return results;
}

function pickBallPresser(defenders, ballOwnerPoint) {
  const ranked = [...defenders].sort(
    (left, right) => yardDistance(ballOwnerPoint, left) - yardDistance(ballOwnerPoint, right),
  );
  const nearest = ranked[0];
  const nearestYards = yardDistance(ballOwnerPoint, nearest);
  if (classifyOutfieldBand(nearest.player) !== "defender") return nearest;
  // Already in pressing range -- the centre-back is the press, not a
  // midfielder jogging in from farther away.
  if (nearestYards <= PRESSER_HOLD_LINE_YARDS) return nearest;
  const alternative = ranked.find((entry) => (
    classifyOutfieldBand(entry.player) !== "defender"
    && yardDistance(ballOwnerPoint, entry) <= nearestYards + PRESSER_MIDFIELD_SLACK_YARDS
  ));
  return alternative || nearest;
}

// A genuine, unambiguous beat -- not the ~1yd noise an ordinary settled
// defensive shape produces constantly (the nearest defender is essentially
// never at the EXACT same depth as the ball). Tuned well below
// PRESSER_MIDFIELD_SLACK_YARDS(12)/DEFENSIVE_BALL_CLEARANCE_YARDS(10) --
// this is a "did the ball genuinely get in behind someone" check, not a
// proximity radius.
const LAST_MAN_BEATEN_MARGIN_YARDS = 5;

function ballBeatsADefender(ballOwnerPoint, defenders, ownGoalDirection, marginYards) {
  const ballDepth = distanceToGoalYards(ballOwnerPoint, ownGoalDirection);
  return defenders.some((entry) => distanceToGoalYards(entry, ownGoalDirection) - ballDepth >= marginYards);
}

// Last-Man / Through-Ball Recovery v1 -- the actual nearest defender to
// `targetPoint`, full stop -- never filtered by classifyOutfieldBand (an
// attacker/midfielder-classified defender tracking back, the reported
// Oliveira case, is just as eligible as a nominal CB) and never filtered
// to "still goal-side" candidates only: a leftover defender who has
// ALREADY been beaten but is genuinely closest to the play is a better
// recovery than a technically-still-goal-side body who is miles away and
// uninvolved. This is deliberately pickBallPresser()'s own raw
// nearest-by-distance ranking, MINUS its classifyOutfieldBand-based
// CB-skip -- that skip is exactly the reported bug for a last-man
// emergency, never something to reproduce here.
function nearestDefenderTo(defenders, targetPoint) {
  return [...defenders].sort((left, right) => yardDistance(targetPoint, left) - yardDistance(targetPoint, right))[0];
}

// Where a leftover defender with nobody of their own to mark sits: on the
// lane between the ball and OUR OWN goal, exactly screeningPositionPoint()'s
// own ball-to-target lane math, just aimed at the goal mouth instead of a
// specific receiver -- screening the danger rather than chasing the ball.
function midfieldScreenPoint(ballOwnerPoint, defendingDirection) {
  const ownGoalDirection = defendingDirection === "up" ? "down" : "up";
  const goal = attackingGoalYardPoint(ownGoalDirection);
  const ballYard = toYardPoint(ballOwnerPoint);
  return fromYardPoint({
    x: ballYard.x + (goal.x - ballYard.x) * SCREEN_LANE_FRACTION,
    y: ballYard.y + (goal.y - ballYard.y) * SCREEN_LANE_FRACTION,
  });
}

// Pushes `idealSpot` out to at least `minYards` from the ball if it isn't
// already -- the presser is exempt (closing distance IS their job); this is
// only ever applied to a leftover defender's own fallback target, so it
// never fights a genuine marking job (an attacker who happens to be close
// to the ball is still legitimately marked there).
function keepClearOfBall(idealSpot, ballOwnerPoint, minYards) {
  const distance = yardDistance(idealSpot, ballOwnerPoint);
  if (distance >= minYards) return idealSpot;
  const ballYard = toYardPoint(ballOwnerPoint);
  const spotYard = toYardPoint(idealSpot);
  const dx = spotYard.x - ballYard.x;
  // A degenerate zero-length vector (idealSpot sits exactly on the ball)
  // falls back to a straight push along the y-axis rather than dividing by
  // zero -- an arbitrary but stable escape direction.
  const dy = spotYard.y - ballYard.y || 1;
  const length = Math.hypot(dx, dy) || 1;
  const rawYard = {
    x: ballYard.x + (dx / length) * minYards,
    y: ballYard.y + (dy / length) * minYards,
  };
  return fromYardPoint({
    x: clamp(0, PITCH_WIDTH_YARDS, rawYard.x),
    y: clamp(0, PITCH_LENGTH_YARDS, rawYard.y),
  });
}

// `previousMarking` / `ownerId` (2026-08-24, Off-Ball v2) are both
// optional and additive -- every existing caller that omits them gets a
// fresh (non-sticky) assignment computed from this one snapshot, same as
// before. `ownerId` is the CURRENT ball owner's id, needed only for the
// tightness-5 hand-off rule below (the owner themselves is never IN
// `attackingTeammates` -- see freePlayGroups()'s own owner/teammates
// split -- so detecting "the marked man just received it" needs their id
// explicitly, not a lookup into this call's own attacker list).
// scheme ("auto" | "man" | "zonal") and tightness (1-5 or null, 2026-08-24
// per-team Marking setup) are both optional and additive, same contract as
// previousMarking/ownerId above -- every existing caller that omits them
// gets the original auto-graded behaviour unchanged. "auto" keeps
// buildMarkingAssignments()'s own role-based man/zonal split and the
// far-side-fullback-tucks-in exception below exactly as before this
// setting existed. "man" keeps that same split (there is still nobody to
// man-mark a spare defender when the attack is numbers-down) but drops the
// far-side tuck-in -- a team told to play strict man-marking follows their
// assigned man across the pitch rather than handing off to zonal cover.
// "zonal" overrides the split outright: every non-presser defender plays
// zonal regardless of what buildMarkingAssignments would have picked,
// producing the classic holding-shape look. tightness, when set, replaces
// every hardcoded per-role/zonal tightness value uniformly (see
// buildMarkingAssignments()'s and assignZonalCoverage()'s own comments).
export function planDefensiveRepositioning(
  ballOwnerPoint, attackingTeammates, defenders, defendingDirection,
  {
    previousMarking = {}, ownerId = null, scheme = "auto", tightness = null,
    // Last-Man / Through-Ball Recovery v1 (2026-08-26, Off-Ball Motion v3)
    // -- optional and additive, same contract as every other option above.
    // The id of a teammate the CALLER already knows is making a real
    // line-breaking run (identifyLineBreakingRunnerId(), computed from the
    // SAME attacker-planning pass this function's own results feed back
    // into) -- see the recovery override just below `presser` for what it
    // does.
    runnerId = null,
    // Progression Contest v1 (2026-08-28) -- optional and additive, same
    // contract as runnerId above. The id of a defender the CALLER already
    // knows was just beaten by the CURRENT ball owner (SHIELD.WON,
    // T.BEATEN.ESCAPE, or a completed carry/poke that left them behind by
    // a real margin -- match-lab.js's own possession loop tracks this,
    // never derived here from pure geometry). See the cover-shadow block
    // below for what it does.
    beatenPresserId = null,
  } = {},
) {
  if (!defenders.length) return [];
  const tightnessOverride = tightness == null ? null : clampTightness(tightness);
  const ownGoalDirection = defendingDirection === "up" ? "down" : "up";

  // Tightness-5 hand-off: "when the marked man receives, the marker goes
  // with him" -- checked directly against the STICKY record (the owner
  // isn't in attackingTeammates this step to rebuild the pairing from),
  // ahead of the ordinary nearest-body/CB-holds-the-line presser logic.
  const stickyOwnerMarkerId = ownerId
    ? Object.entries(previousMarking).find(([, value]) => (
        value?.mode === "man" && value.subjectId === ownerId && clampTightness(value.tightness) >= 5
      ))?.[0]
    : null;
  const stickyOwnerMarker = stickyOwnerMarkerId
    ? defenders.find((entry) => entry.id === stickyOwnerMarkerId)
    : null;
  let presser = stickyOwnerMarker || pickBallPresser(defenders, ballOwnerPoint);

  // Last-Man / Through-Ball Recovery v1 (2026-08-26, Off-Ball Motion v3) --
  // a real reported bug: pickBallPresser() lets a midfielder within
  // PRESSER_MIDFIELD_SLACK_YARDS steal the presser job from a nearby CB --
  // a reasonable "shift the unit" rule for a settled midfield carrier, but
  // exactly backwards for the last defender between a through-runner and
  // goal, who must recover onto them directly, never hand off to a
  // midfielder jogging in from farther away. `ballOwnerPoint` is the one
  // point this function ever sees the ball at -- the live carrier's own
  // spot for a carry, or a pass/through-ball's own landing point for a
  // flight -- so a single "has it genuinely beaten a defender" check
  // covers both a beaten-the-line carrier and a through ball travelling in
  // behind part of the back line with the same code. A real margin (not
  // "closer by half a yard," which any routine defensive shape produces
  // constantly and would turn this into a permanent swarm trigger) --
  // LAST_MAN_BEATEN_MARGIN_YARDS is a genuine, unambiguous beat.
  const ballThroughLine = !stickyOwnerMarker
    && ballBeatsADefender(ballOwnerPoint, defenders, ownGoalDirection, LAST_MAN_BEATEN_MARGIN_YARDS);
  if (ballThroughLine) {
    presser = nearestDefenderTo(defenders, ballOwnerPoint) || presser;
  }

  // A SEPARATE named runner (identifyLineBreakingRunnerId(), threaded in
  // via `runnerId` -- see planAttackerRepositioning()'s own
  // selectLineBreakingRunner()) who is making a real line-breaking run
  // toward a DIFFERENT point than wherever `ballOwnerPoint` already is
  // (still a live pass in flight, not yet resolved to them) gets their own
  // recoverer -- the presser above, already covering the ball itself, is
  // untouched. Skipped when ballThroughLine already fired for this same
  // situation (the ball's own landing point IS the runner's point) -- the
  // presser above is already the recovery in that case; a second body here
  // would be exactly the swarm this feature must not reintroduce.
  const runner = (!ballThroughLine && runnerId)
    ? attackingTeammates.find((entry) => entry.id === runnerId)
    : null;
  const runnerThroughLine = runner
    && ballBeatsADefender(runner, defenders, ownGoalDirection, LAST_MAN_BEATEN_MARGIN_YARDS);
  const recoverer = runnerThroughLine ? nearestDefenderTo(defenders, runner) : null;
  // "If that defender is already the presser, do not add a second body."
  const recoveryIsExtraBody = recoverer && recoverer.id !== presser.id;

  const idealPress = pressingTarget(presser, ballOwnerPoint, Infinity);
  const cappedPress = pressingTarget(presser, ballOwnerPoint);
  // Pattern Vocabulary V1, Step 1 (2026-09-02), L5/V5 "delay" -- a real
  // label split, not new selection logic: still closing but not yet
  // within real challenge range reads as "delay" (close the gap, hold the
  // lane, don't dive), while already inside DUEL_RANGE_YARDS is the
  // existing "press-ball." Target/selection/subjectId are all unchanged --
  // whether a tackle is actually ATTEMPTED lives entirely in the separate
  // on-ball duel resolvers (resolveDribble/resolveCarry), never decided by
  // off-ball job assignment.
  const pressAction = yardDistance(presser, ballOwnerPoint) > DUEL_RANGE_YARDS ? "delay" : "press-ball";
  const results = [{
    id: presser.id, action: pressAction, target: cappedPress, intentionTarget: idealPress,
    // The follower's OWN pairing persists through pressing them too, so it
    // resumes untouched once the ball moves on again.
    ...(stickyOwnerMarker ? { subjectId: ownerId, mode: "man", tightness: 5 } : {}),
  }];
  if (recoveryIsExtraBody) {
    // Uncapped both ways ("target = same" as intentionTarget) -- a last-man
    // recovery sprint is not a per-step 8-yard shuffle; this job beats
    // screen, shift-unit, far-side tuck, and zonal strip outright by never
    // entering the `others` pool those are chosen from.
    const recoveryTarget = pressingTarget(recoverer, runner, Infinity);
    results.push({
      id: recoverer.id, action: "recover", subjectId: runner.id,
      target: recoveryTarget, intentionTarget: recoveryTarget,
    });
  }

  const cappedApproach = (defender, idealSpot) =>
    approachPoint(defender, idealSpot, effortScaledAdvance(DEFENDER_MAX_ADVANCE_YARDS, defender.player, defender.burst01));

  // Progression Contest v1 (2026-08-28) -- a real reported bug:
  // "cover... exactly one body. When that one is shielded, the next CB
  // waits for the following ADJUST -- after another 10-yard carry." The
  // specific defender the caller says was just beaten (see
  // beatenPresserId's own header) recovers uncapped onto the ball
  // itself, same treatment as a genuine last-man recovery -- they are
  // BEHIND the play now, not level with it, and an ordinary capped
  // press-ball/mark/zonal job would leave them permanently a step short.
  // If pickBallPresser() already independently picked this SAME body
  // back as `presser` above (the common case: still nearest, just no
  // longer goal-side), this OVERWRITES that entry rather than adding a
  // duplicate one for the same id.
  const beatenPresser = (beatenPresserId && !(recoveryIsExtraBody && beatenPresserId === recoverer.id))
    ? defenders.find((entry) => entry.id === beatenPresserId)
    : null;
  if (beatenPresser) {
    const recoveryTarget = pressingTarget(beatenPresser, ballOwnerPoint, Infinity);
    const recoverEntry = {
      id: beatenPresser.id, action: "recover", subjectId: null,
      target: recoveryTarget, intentionTarget: recoveryTarget,
    };
    const existingIndex = results.findIndex((entry) => entry.id === beatenPresser.id);
    if (existingIndex !== -1) results[existingIndex] = recoverEntry;
    else results.push(recoverEntry);
  }

  // Cover-shadow (2026-08-28) -- one extra body, never a third on top of
  // an existing last-man recovery: the nearest OTHER defender who is
  // still goal-side of the carrier closes to a real cover distance
  // (COVER_SHADOW_STANDOFF_YARDS -- tighter than an ordinary zonal
  // COVER_STANDOFF_YARDS, looser than the presser's own
  // PRESS_STANDOFF_YARDS) instead of waiting for their own next ordinary
  // ADJUST beat to react to someone who has already gone past the first
  // line. Only fires alongside a genuine beaten presser -- an untroubled
  // defensive shape (nobody beaten) is exactly the ordinary man/zonal
  // coverage below, unchanged.
  const claimedIds = new Set([
    presser.id,
    ...(recoveryIsExtraBody ? [recoverer.id] : []),
    ...(beatenPresser ? [beatenPresser.id] : []),
  ]);
  let coverShadow = null;
  if (beatenPresser) {
    const carrierGoalDistance = distanceToGoalYards(ballOwnerPoint, ownGoalDirection);
    const goalSideCandidates = defenders.filter((entry) =>
      !claimedIds.has(entry.id) && distanceToGoalYards(entry, ownGoalDirection) <= carrierGoalDistance);
    coverShadow = nearestDefenderTo(goalSideCandidates, ballOwnerPoint);
  }
  if (coverShadow) {
    claimedIds.add(coverShadow.id);
    const idealSpot = coverShadowPoint(ballOwnerPoint, ownGoalDirection);
    results.push({
      id: coverShadow.id, action: "cover-shadow", subjectId: null,
      target: cappedApproach(coverShadow, idealSpot), intentionTarget: idealSpot,
    });
  }

  const others = defenders.filter((entry) => !claimedIds.has(entry.id));
  const backLine = defenders.filter((defender) => classifyOutfieldBand(defender.player) === "defender");
  const slots = backLineSlots(backLine, ballOwnerPoint, defendingDirection);
  const assignments = buildMarkingAssignments(others, attackingTeammates, defendingDirection, previousMarking, tightnessOverride);

  const manDefenders = [];
  const zonalDefenders = [];
  others.forEach((defender) => {
    const assignment = assignments.get(defender.id);
    // "zonal" scheme forces every non-presser body into zonal cover even
    // when buildMarkingAssignments() found them a man to mark -- the
    // explicit team-wide override this setting exists for.
    if (assignment?.mode === "man" && scheme !== "zonal") manDefenders.push(defender);
    else zonalDefenders.push(defender);
  });

  // Goal-side, not on top of them (manMarkingPoint() stands off on the
  // subject-to-goal line), clamped to how far this tightness level
  // actually follows (clampToFollowRadius()) from the marker's own
  // resting zone -- their back-line slot for a CB/full-back, their
  // current spot for a defensive mid (no sticky "resting zone" tracked for
  // midfield jobs yet, so their own current position stands in). A
  // full-back whose winger is genuinely on the far side of the ball tucks
  // in as zonal cover for this step instead of chasing box to box -- the
  // underlying sticky PAIRING is untouched; next time the ball swings back
  // their way this resumes as man-marking, not a re-decided target.
  manDefenders.forEach((defender) => {
    const assignment = assignments.get(defender.id);
    const subject = attackingTeammates.find((entry) => entry.id === assignment.subjectId);
    if (!subject) {
      zonalDefenders.push(defender);
      return;
    }
    const role = defenderMarkingRole(defender, backLine);
    // "man" scheme drops this tuck-in -- strict man-marking follows the
    // assigned subject across the pitch rather than handing off to zonal
    // cover just because the ball swung to the far flank.
    if (scheme === "auto" && role === "fullback" && isFarSideBall(defender, ballOwnerPoint)) {
      zonalDefenders.push(defender);
      return;
    }
    const restPoint = slots.get(defender.id) || defender;
    const idealSpot = clampToFollowRadius(
      manMarkingPoint(subject, defendingDirection, defender.player, assignment.tightness),
      restPoint,
      assignment.tightness,
    );
    results.push({
      id: defender.id, action: "mark", subjectId: subject.id,
      mode: "man", tightness: assignment.tightness, markerRole: role,
      target: cappedApproach(defender, idealSpot),
      intentionTarget: idealSpot,
    });
  });

  // Everyone zonal: a classified back-line CB (including a far-side
  // full-back tucking in this step) holds their real slot; everyone else
  // gets real zonal strip coverage (assignZonalCoverage() -- empty
  // zone/one attacker/two attacker rules, never defaulting to the ball
  // itself).
  const zonalBackLine = zonalDefenders.filter((defender) => slots.has(defender.id));
  const zonalOthers = zonalDefenders.filter((defender) => !slots.has(defender.id));
  const zonalTightness = tightnessOverride ?? ZONAL_MARK_TIGHTNESS;
  zonalBackLine.forEach((defender) => {
    const idealSpot = slots.get(defender.id);
    results.push({
      id: defender.id, action: "shift-unit", mode: "zonal", tightness: zonalTightness,
      target: cappedApproach(defender, idealSpot),
      intentionTarget: idealSpot,
    });
  });
  // Exclusivity across BOTH systems, not just within man-marking's own
  // `claimed` Set (2026-08-26 fix -- a real reported bug: two defenders,
  // one man-marking and one "zone-covering," both converging on the SAME
  // attacker in midfield). assignZonalCoverage() picks the nearest
  // attacker in each defender's own strip with no idea who
  // buildMarkingAssignments() already gave to a man-marker just above --
  // the two systems never cross-checked each other. An attacker already
  // claimed by a real man-marking assignment is removed from the pool
  // zonal coverage can pick from; a leftover zonal defender in a strip
  // whose only attacker is already spoken for correctly falls back to
  // screening the space (assignZonalCoverage()'s own existing
  // unusedDefenders handling) instead of piling onto someone already
  // marked.
  const manMarkedSubjectIds = new Set(
    results.filter((entry) => entry.mode === "man" && entry.subjectId).map((entry) => entry.subjectId),
  );
  const zonalCandidateAttackers = attackingTeammates.filter((entry) => !manMarkedSubjectIds.has(entry.id));
  const zonalCoverage = assignZonalCoverage(zonalOthers, zonalCandidateAttackers, ballOwnerPoint, defendingDirection, tightnessOverride);
  zonalOthers.forEach((defender) => {
    const coverage = zonalCoverage.get(defender.id);
    const idealSpot = coverage?.idealSpot || keepClearOfBall(
      midfieldScreenPoint(ballOwnerPoint, defendingDirection), ballOwnerPoint, DEFENSIVE_BALL_CLEARANCE_YARDS,
    );
    results.push({
      id: defender.id,
      action: coverage?.action || "screen",
      subjectId: coverage?.subjectId ?? null,
      mode: "zonal", tightness: zonalTightness,
      target: cappedApproach(defender, idealSpot),
      intentionTarget: idealSpot,
    });
  });
  return results;
}

// ---------------------------------------------------------------------------
// Off-Ball Attacker Awareness v1 -- see MATCH_LAB_PLAN.md (2026-08-18). The
// direct offensive counterpart to Off-Ball Defender Awareness v1. The
// planner now allocates named team jobs rather than asking every teammate
// the same independent "where should I go?" question: one claimable runner,
// one short support, width, diagonal release, and an explicit last-line pin.
// Motion v1 evaluates this and defensive
// repositioning from the same immutable snapshot, applies both atomically,
// then lets the next reaction observe the completed movement. Pure geometry,
// no randomness -- same "deterministic, not tuned" principle every
// positioning heuristic in this file already follows.
// ---------------------------------------------------------------------------

const ATTACKER_MARKED_RADIUS_YARDS = 7;
const ATTACKER_MAX_ADVANCE_YARDS = 8;
const FIND_SPACE_YARDS = 6;
const FORWARD_RUN_YARDS = 10;
const FORWARD_RUN_INWARD_YARDS = 4;
const GOAL_LINE_RUN_BUFFER_YARDS = 6;
const MAX_LINE_BREAK_RUNNERS = 1;
const ONSIDE_LINE_BUFFER_YARDS = 1.5;
const SUPPORT_DISTANCE_YARDS = 10;
const WIDTH_INSET_YARDS = 6;
const CLAIM_LEAD_SECONDS = 0.4;

function goalLineSafetyY(attackingDirection) {
  const percent = (GOAL_LINE_RUN_BUFFER_YARDS / PITCH_LENGTH_YARDS) * 100;
  return attackingDirection === "up" ? percent : 100 - percent;
}

function defendingPlayers(defenders, keeper) {
  const entries = [...(defenders || [])];
  if (keeper && !entries.some((entry) => entry.id === keeper.id)) entries.push(keeper);
  return entries;
}

function clampRunTarget(target, attackingDirection, offsideSnapshot = null) {
  const safetyY = goalLineSafetyY(attackingDirection);
  const legalLineY = offsideSnapshot ? onsideLineTargetY(offsideSnapshot, ONSIDE_LINE_BUFFER_YARDS) : safetyY;
  return {
    ...target,
    y: attackingDirection === "up"
      ? Math.max(target.y, safetyY, legalLineY)
      : Math.min(target.y, safetyY, legalLineY),
  };
}

function lineBreakingScore(attacker, attackingDirection) {
  const player = attacker.player || null;
  const ability = player
    ? playerAttribute(player, "Off the Ball") * 0.4
      + playerAttribute(player, "Anticipation") * 0.25
      + playerAttribute(player, "Decisions") * 0.2
      + playerAttribute(player, "Acceleration") * 0.15
    : 10;
  const progress = attackingDirection === "up" ? 100 - attacker.y : attacker.y;
  return ability + progress * 0.04;
}

function attackingHeadStartSeconds(entry) {
  // Off the Ball/Anticipation/Decisions -- reading the play early enough to
  // start the run before it's obvious, the same three "reading" attributes
  // lineBreakingScore() already ranks candidate runners by, applied here to
  // the arrival RACE itself, not just who gets picked to attempt it.
  const offBall = playerAttribute(entry?.player, "Off the Ball");
  const anticipation = playerAttribute(entry?.player, "Anticipation");
  const decisions = playerAttribute(entry?.player, "Decisions");
  return clamp(0, 0.7, (average([offBall, anticipation, decisions]) - 8) * (0.7 / 12));
}

function defendingHeadStartSeconds(entry) {
  // Anticipation only -- reading the run early enough to react before it's
  // obvious, a cognitive head start distinct from the STEADY-STATE marking
  // quality Positioning/Marking already govern via markingTightnessQuality()
  // (coveringPositionPoint()'s own standoff). Deliberately not folded in
  // here too: unrated Positioning/Marking fall back to a moderate CA-based
  // baseline proxy that can read as a stronger defender than one with a
  // real, deliberately low Anticipation rating -- the same two attributes
  // would then be fighting each other across two different mechanics
  // rather than each covering its own distinct one.
  const anticipation = playerAttribute(entry?.player, "Anticipation");
  return clamp(0, 0.5, (anticipation - 8) * (0.5 / 12));
}

// Off-Ball Attribute Awareness v1 (2026-08-19) -- see MATCH_LAB_PLAN.md. A
// real browser round asked directly for these specific attributes to
// determine "how accurate the player positions" are, and for a genuinely
// better off-the-ball attacker to break free more easily than an average
// one. claimable()'s own head-start functions above already covered part
// of this (whether a run-in-behind job gets OFFERED at all); these three
// "quality" functions cover the rest -- the geometry ITSELF, not just
// eligibility. All three follow the same shape: average the relevant
// attributes, normalize to 0-1, and use that to scale an existing pure-
// geometry constant within a bounded, football-sensible range -- never an
// unbounded multiplier, and never replacing the underlying geometry with
// something attribute-only (see this file's own header on why execution
// quality must never be read twice).
//
// A good attacking off-the-ball player finds MORE separation from a
// marker (findSpaceTargetForAttack's own search radius scales up); a good
// defensive marker gives LESS of it (coveringPositionPoint's own standoff
// scales down) -- the same contest, from both sides, using the exact
// attributes named: Off the Ball/Anticipation/Decisions for the attacker,
// Positioning/Marking/Anticipation for the defender.
function offBallReadingQuality(player) {
  return average([
    playerAttribute(player, "Off the Ball"),
    playerAttribute(player, "Anticipation"),
    playerAttribute(player, "Decisions"),
  ]) / 20;
}

function markingTightnessQuality(player) {
  return average([
    playerAttribute(player, "Positioning"),
    playerAttribute(player, "Marking"),
    playerAttribute(player, "Anticipation"),
  ]) / 20;
}

// Work Rate/Stamina -- physical capacity to keep making the right
// recovery/support run, not the cognitive "read it early" quality above.
// Scales the real per-step advance cap both attacking and defensive
// repositioning already use (ATTACKER_MAX_ADVANCE_YARDS/
// DEFENDER_MAX_ADVANCE_YARDS) -- a low work-rate/stamina player physically
// covers less ground on the same reaction, not a different DESTINATION,
// just less progress toward it per step (the following reaction picks up
// from wherever they actually got to, same as any other capped advance).
function effortQuality(player) {
  return average([
    playerAttribute(player, "Work Rate"),
    playerAttribute(player, "Stamina"),
  ]) / 20;
}
// Burst Stamina v1 (2026-08-31) -- "effortScaledAdvance: multiply by
// (0.70 + 0.30 * burst01) so a gassed recovery run covers less ground
// this step." Optional and additive -- burst01 defaults to 1 (full
// tank), so every existing caller that doesn't pass one (a direct unit
// test, effortQuality()'s own general Work-Rate/Stamina read above)
// keeps its exact original behavior. Multiplies ON TOP of effortQuality()'s
// own scaling, never replaces it -- a low-Work-Rate player is
// permanently a bit short per step regardless of burst; a gassed one is
// ADDITIONALLY short this exact possession, on top of that.
function effortScaledAdvance(baseYards, player, burst01 = 1) {
  const burst = clamp(0, 1, Number(burst01 ?? 1));
  return baseYards * (0.75 + 0.5 * effortQuality(player)) * (0.70 + 0.30 * burst);
}

// A forward target is actionable only when the runner can establish a real
// arrival lead. Off the Ball/Anticipation buy an earlier start; Pace and
// Acceleration determine the subsequent travel time through timeToReach().
export function claimable(mover, target, opponents, leadSeconds = CLAIM_LEAD_SECONDS) {
  const mine = Math.max(0, timeToReach(mover?.player, yardDistance(mover, target)) - attackingHeadStartSeconds(mover));
  if (!opponents?.length) return true;
  const theirs = Math.min(...opponents.map((opponent) => Math.max(
    0,
    timeToReach(opponent?.player, yardDistance(opponent, target)) - defendingHeadStartSeconds(opponent),
  )));
  return mine + Math.max(0, leadSeconds) < theirs;
}

function supportShortTarget(attacker, ballPoint) {
  const ball = toYardPoint(ballPoint);
  const current = toYardPoint(attacker);
  const dx = current.x - ball.x;
  const dy = current.y - ball.y;
  const distance = Math.hypot(dx, dy);
  // Bugfix slice -- a real (if narrow) degenerate case: a supporting player
  // standing exactly ON the ball's own spot has no real direction to derive
  // a unit vector from. The old `|| 1` fallback made dx/dy both evaluate to
  // 0, collapsing the "support" target onto ballPoint itself -- the exact
  // "stacked on the owner" picture this fix exists to rule out. A stable,
  // arbitrary-but-deterministic escape direction (same "no coin-flip"
  // convention vacatePocketTarget()/keepClearOfBall() already use for their
  // own zero-length-vector cases) still produces a genuine, real
  // SUPPORT_DISTANCE_YARDS gap instead.
  const unit = distance > 1e-6 ? { x: dx / distance, y: dy / distance } : { x: 0, y: 1 };
  return fromYardPoint({
    x: clamp(0, PITCH_WIDTH_YARDS, ball.x + unit.x * SUPPORT_DISTANCE_YARDS),
    y: clamp(0, PITCH_LENGTH_YARDS, ball.y + unit.y * SUPPORT_DISTANCE_YARDS),
  });
}

// ballPoint (2026-08-19) -- a real browser round caught a wide player
// visibly stuck deep, never joining the attack across several consecutive
// frames while the rest of the team advanced well up the pitch. Root
// cause: this used to keep `y: current.y` unconditionally -- "hold width"
// meant "hold LATERAL position," but literally froze the player's own
// DEPTH at whatever it happened to be when they were last given this job,
// with no mechanism to ever catch up as the ball moved forward. A real
// winger holding width still tracks the ball's own depth to stay a live
// out-ball, only ever advancing toward it (never retreating INTO their
// own half chasing a ball that's already moved past them behind-ward,
// which would be a different job entirely) -- `ballPoint` optional,
// defaulting to the attacker's own current spot (the exact old behavior)
// for any caller that doesn't pass one.
function holdWidthTarget(attacker, ballPoint, attackingDirection) {
  const current = toYardPoint(attacker);
  const x = current.x <= PITCH_WIDTH_YARDS / 2 ? WIDTH_INSET_YARDS : PITCH_WIDTH_YARDS - WIDTH_INSET_YARDS;
  if (!ballPoint) return fromYardPoint({ x, y: current.y });
  const ball = toYardPoint(ballPoint);
  const y = attackingDirection === "up" ? Math.min(current.y, ball.y) : Math.max(current.y, ball.y);
  return fromYardPoint({ x, y });
}

// Directly away from the nearest marker, capped/clamped inside the
// pitch -- a real "check away, lose your man" move, not a run toward
// goal (that's forwardRunTarget()'s own job, only used when nobody's
// marking them closely enough to need shaking off first).
export function findSpaceTarget(attackerPoint, nearestDefenderPoint) {
  const attackerYard = toYardPoint(attackerPoint);
  const defenderYard = toYardPoint(nearestDefenderPoint);
  const dx = attackerYard.x - defenderYard.x;
  const dy = attackerYard.y - defenderYard.y;
  const distance = Math.hypot(dx, dy) || 1;
  const rawYard = {
    x: attackerYard.x + (dx / distance) * FIND_SPACE_YARDS,
    y: attackerYard.y + (dy / distance) * FIND_SPACE_YARDS,
  };
  const clampedYard = { x: clamp(0, PITCH_WIDTH_YARDS, rawYard.x), y: clamp(0, PITCH_LENGTH_YARDS, rawYard.y) };
  return fromYardPoint(clampedYard);
}

// Goal-aware alternative to the original single "directly away" vector.
// A marked attacker considers both channels, a forward check and two short
// retreating diagonals, then balances separation from EVERY defender against
// progression. Backward movement remains possible when genuinely necessary,
// but it is no longer the automatic answer merely because a marker happens to
// stand goal-side -- the exact behaviour that sent wide attackers retreating
// upfield in a browser round.
// `attackerPlayer` (optional -- defaults to a neutral, baseline-quality
// search, same as any other playerAttribute() call given no player data)
// is the RUNNER'S OWN player: a genuinely good off-the-ball attacker
// (Off the Ball/Anticipation/Decisions) searches a wider radius and so
// finds real separation a weaker one, searching the same fixed radius
// every time regardless of skill, would miss -- see offBallReadingQuality()'s
// own comment. Bounded 0.7x-1.3x, never an unbounded escape.
export function findSpaceTargetForAttack(attackerPoint, defenders, attackingDirection, attackerPlayer = null) {
  if (!defenders.length) return forwardRunTarget(attackerPoint, attackingDirection);
  const attacker = toYardPoint(attackerPoint);
  const forward = attackingDirection === "up" ? -1 : 1;
  const radius = FIND_SPACE_YARDS * (0.7 + 0.6 * offBallReadingQuality(attackerPlayer));
  const vectors = [
    { x: 0, y: forward * radius, name: "forward-check" },
    { x: -radius * 0.72, y: forward * radius * 0.7, name: "left-channel" },
    { x: radius * 0.72, y: forward * radius * 0.7, name: "right-channel" },
    { x: -radius, y: 0, name: "left-release" },
    { x: radius, y: 0, name: "right-release" },
    { x: -radius * 0.65, y: -forward * radius * 0.4, name: "left-check-short" },
    { x: radius * 0.65, y: -forward * radius * 0.4, name: "right-check-short" },
  ];
  const candidates = vectors.map((vector, index) => {
    const yardPoint = {
      x: clamp(0, PITCH_WIDTH_YARDS, attacker.x + vector.x),
      y: clamp(0, PITCH_LENGTH_YARDS, attacker.y + vector.y),
    };
    const point = fromYardPoint(yardPoint);
    const separation = Math.min(...defenders.map((defender) => yardDistance(point, defender)));
    const progression = progressionYards(attackerPoint, point, attackingDirection);
    const boundaryLoss = Math.hypot(yardPoint.x - (attacker.x + vector.x), yardPoint.y - (attacker.y + vector.y));
    return {
      point, index,
      score: separation * 1.2 + progression * 0.9
        - Math.max(0, -progression) * 1.5 - boundaryLoss * 2,
    };
  });
  candidates.sort((left, right) => right.score - left.score || left.index - right.index);
  return candidates[0].point;
}

// Forward, with a real diagonal bias toward the center (a run "into the
// channel," not a straight sprint up the touchline) -- `attackingDirection`
// is the RUNNER'S OWN team's attacking direction.
export function forwardRunTarget(attackerPoint, attackingDirection) {
  const forwardSign = attackingDirection === "up" ? -1 : 1;
  const attackerYard = toYardPoint(attackerPoint);
  const centerX = PITCH_WIDTH_YARDS / 2;
  const inwardSign = attackerYard.x < centerX ? 1 : (attackerYard.x > centerX ? -1 : 0);
  const rawYard = {
    x: clamp(0, PITCH_WIDTH_YARDS, attackerYard.x + inwardSign * FORWARD_RUN_INWARD_YARDS),
    y: clamp(0, PITCH_LENGTH_YARDS, attackerYard.y + forwardSign * FORWARD_RUN_YARDS),
  };
  return fromYardPoint(rawYard);
}

// ---------------------------------------------------------------------------
// Box Runs v1 (2026-08-26) -- see MATCH_LAB_PLAN.md. A real reported gap:
// nobody ever ran INTO the box, so a wide/advanced carry had no cross
// target to aim at (isCrossTargetZone() only ever fires for a teammate
// ALREADY standing there) and no support -- forcing a shot from whatever
// angle the carrier happened to reach the byline at. Once the team is
// genuinely in the final third, the striker(s), the most advanced
// midfielder, and the winger on the side AWAY from the ball now make a
// real run into the box -- claimed from the "otherwise idle"
// pin-last-line/drop-deep bucket only, same claimable()/clampRunTarget()
// safety run-in-behind already uses (never fabricates an offside or
// unwinnable run), never overriding a genuine tight-mark reaction or the
// support-short/hold-width/drop-deep/run-in-behind jobs above it.
// ---------------------------------------------------------------------------

const BOX_RUN_TRIGGER_MAX_DISTANCE_YARDS = 35;
const BOX_RUN_CENTRAL_DEPTH_YARDS = 11;
const BOX_RUN_POST_DEPTH_YARDS = 8;
const BOX_RUN_POST_LATERAL_YARDS = 7;
const BOX_RUN_EDGE_DEPTH_YARDS = 16;
// Pattern Vocabulary V1, Step 1 (2026-09-02) -- each box-run slot now gets
// its own real action string (a broadcast-still box meet names near-post/
// penalty-spot/far-post/edge-of-box runs separately) instead of every
// claimant sharing the single generic "attack-box" label.
const BOX_RUN_SLOT_ACTION = {
  central: "attack-spot", nearPost: "attack-near", farPost: "attack-far", edgeOfBox: "edge-rebound",
};
// A real, physical cap on the RUNNER's own distance from their target --
// claimable() alone isn't enough on its own: with no opponents to race
// against at all (a real, common fixture shape -- an uncontested wide
// area), claimable() trivially passes regardless of distance. A player
// still deep in their own half when the ball is already in the final
// third genuinely cannot crash the box in one action; they advance
// through hold-width/support first, same as before this feature existed.
const BOX_RUN_MAX_RUNNER_DISTANCE_YARDS = 40;

// Four real, distinct arrival points -- never the same spot for two
// runners. nearPost/farPost are relative to the BALL's own side (a real
// cross's near/far post), not a fixed left/right.
function boxRunTargetSlots(ballPoint, attackingDirection) {
  const goal = attackingGoalYardPoint(attackingDirection);
  const depthSign = attackingDirection === "up" ? 1 : -1;
  const ballSideSign = toYardPoint(ballPoint).x < PITCH_WIDTH_YARDS / 2 ? -1 : 1;
  const at = (lateralYards, depthYards) => fromYardPoint({
    x: clamp(0, PITCH_WIDTH_YARDS, goal.x + lateralYards),
    y: clamp(0, PITCH_LENGTH_YARDS, goal.y + depthSign * depthYards),
  });
  return {
    central: at(0, BOX_RUN_CENTRAL_DEPTH_YARDS),
    nearPost: at(ballSideSign * BOX_RUN_POST_LATERAL_YARDS, BOX_RUN_POST_DEPTH_YARDS),
    farPost: at(-ballSideSign * BOX_RUN_POST_LATERAL_YARDS, BOX_RUN_POST_DEPTH_YARDS),
    edgeOfBox: at(0, BOX_RUN_EDGE_DEPTH_YARDS),
  };
}

// One team-level decision per attacking teammate (never the ball owner --
// callers only pass the owner's OWN teammates), every step the ball is live:
// an offside player recovers, at most one eligible player breaks the line,
// and the remaining players claim complementary support/width/pin jobs.
// `defenders` are the OPPOSING outfield players; `keeper` is included only
// in the second-last-opponent calculation, not treated as a marker. Returns
// one immutable-input movement instruction per teammate, capped to a real
// per-step advance and constrained to an onside, goal-line-safe target.
//
// previousSupportId/previousDropId (2026-08-19) -- a real browser round
// caught two teammates visibly swapping places over and over, reaction
// after reaction, with no defender or ball movement that would explain
// it. Root cause: `supportId`/`dropId` were both picked by pure nearest-
// to-the-ball distance, re-decided from absolute zero on every single
// call -- when two teammates sit at nearly the same distance (common --
// midfielders naturally cluster), the tiniest geometry change (a fraction
// of a yard from the PREVIOUS reaction's own movement) is enough to flip
// which one is nominally closer, and each flip swaps their entire job
// (support-short's forward-ish target vs. pin-last-line's hold-still) --
// the exact same "re-decide from scratch every touch" shape as
// planCarryDestination()'s own zig-zag bug (see CARRY_CONTINUITY_BONUS
// above), just one layer up, on WHO gets a job rather than WHICH DIRECTION
// one player goes. Optional and additive: omitting these two (every
// existing caller) reproduces the exact old pure-nearest behavior.
const ROLE_STICKINESS_MARGIN_YARDS = 3;
function pickWithStickiness(candidates, referencePoint, previousId, marginYards) {
  if (!candidates.length) return null;
  const sorted = [...candidates].sort((left, right) => yardDistance(left, referencePoint) - yardDistance(right, referencePoint));
  const nearest = sorted[0];
  if (!previousId) return nearest.id;
  const previous = candidates.find((candidate) => candidate.id === previousId);
  if (!previous || previous.id === nearest.id) return nearest.id;
  const gap = yardDistance(previous, referencePoint) - yardDistance(nearest, referencePoint);
  // Only a MEANINGFULLY closer rival takes the job over -- a razor-thin
  // margin (the exact case that used to flip every reaction) keeps the
  // incumbent instead.
  return gap > marginYards ? nearest.id : previous.id;
}

// Off-Ball v2 (2026-08-24) -- how tightly marked an attacker needs to be
// (per the reverse `markingLookup` built from planDefensiveRepositioning()'s
// own results) before they react to the MARKER specifically, rather than
// the old proximity-only nearestWithin() branch below.
const TIGHT_MARK_THRESHOLD = 4;

// A tightly marked attacker's own reaction, checked in order: check away
// from the marker's cover-shadow, run in behind if the line is playable,
// or -- specifically against a centre-back, tempting them out of the back
// line is a real tactic; doing the same to a covering midfielder isn't --
// drop short instead. Each of the first two is gated by claimable() (the
// SAME arrival-race gate run-in-behind already uses): the marker's own
// REAL position already reflects their tightness (manMarkingPoint()'s own
// standoff, clampToFollowRadius()'s own leash), so a tight (4) vs
// hip-to-hip (5) marker is already harder to escape through this same
// geometry, without needing a second, parallel attribute formula here.
// Returns null when none of the three apply -- callers fall back to the
// original diagonal-inside reaction.
function tightMarkReactionTarget(attacker, markerInfo, defenders, attackingDirection, offside, ballPoint) {
  const checkTarget = clampRunTarget(
    findSpaceTargetForAttack(attacker, defenders, attackingDirection, attacker.player), attackingDirection, offside,
  );
  if (!offside?.isOffside && claimable(attacker, checkTarget, defenders)) {
    return { action: "check-away", idealSpot: checkTarget };
  }
  const behindTarget = clampRunTarget(forwardRunTarget(attacker, attackingDirection), attackingDirection, offside);
  if (!offside?.isOffside && claimable(attacker, behindTarget, defenders)) {
    return { action: "in-behind", idealSpot: behindTarget };
  }
  if (markerInfo?.markerRole === "centreback" && ballPoint) {
    return { action: "drop-short", idealSpot: supportShortTarget(attacker, ballPoint) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Pattern Vocabulary V1, Step 1 (2026-09-02) -- off-ball job vocabulary from
// broadcast-still patterns V1/V4/V5/V7. Every new job here follows this
// file's own established shape: a deterministic geometric trigger +
// claimable() (the same arrival-race gate run-in-behind/box-runs already
// use), never the on-ball utility-scoring system. L3's "1 special run"
// (open play: overlap/peel/corridor -- run-off-pass is a separate,
// always-eligible job for the PASSER specifically, see runOffPassTarget()'s
// own header) caps vacate-pocket/arc-overlap/peel-square/show-wide/
// check-decel at a combined MAX of 1 per call, via selectSpecialMover()
// below -- exactly MAX_LINE_BREAK_RUNNERS's own shape, generalized across
// job TYPES instead of one type.
// ---------------------------------------------------------------------------

const VACATE_POCKET_AHEAD_YARDS = 15;
const VACATE_POCKET_RADIUS_YARDS = 5;
const VACATE_POCKET_PUSH_YARDS = 8;
const ARC_OVERLAP_FORWARD_YARDS = 12;
const ARC_OVERLAP_OUTWARD_YARDS = 4;
const PEEL_SQUARE_BALL_RADIUS_YARDS = 15;
const SHOW_WIDE_AHEAD_YARDS = 15;
const SHOW_WIDE_CLOG_THRESHOLD = 0.5;
const RUN_OFF_PASS_BASE_YARDS = 8;

// V1 -- a teammate standing in the cone directly ahead of the ball gets
// pushed 6-10yd out of it (perpendicular to the cone's own line, toward
// whichever side they're already leaning -- never a coin-flip escape
// direction), clearing the lane the carrier would otherwise have to
// dribble straight through.
function vacatePocketTarget(attacker, ballPoint, conePoint) {
  const from = toYardPoint(ballPoint);
  const to = toYardPoint(conePoint);
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const perp = { x: -dy / length, y: dx / length };
  const attackerYard = toYardPoint(attacker);
  const side = (attackerYard.x - from.x) * perp.x + (attackerYard.y - from.y) * perp.y >= 0 ? 1 : -1;
  const rawYard = {
    x: attackerYard.x + perp.x * side * VACATE_POCKET_PUSH_YARDS,
    y: attackerYard.y + perp.y * side * VACATE_POCKET_PUSH_YARDS,
  };
  return fromYardPoint({
    x: clamp(0, PITCH_WIDTH_YARDS, rawYard.x),
    y: clamp(0, PITCH_LENGTH_YARDS, rawYard.y),
  });
}

// V4 -- an overlapping run stays in ITS OWN wide channel (toward the
// touchline), never cutting inside -- deliberately NOT forwardRunTarget()
// (which biases inward, toward the center, exactly run-in-behind's own
// eligibility check): reusing that same target/claimable pair here would
// make arc-overlap strictly redundant with run-in-behind's own selection
// (an unmarked candidate who clears forwardRunTarget()'s claim check
// always wins the run-in-behind slot FIRST, since selectedRunners is
// resolved before this function ever runs), never actually reachable. A
// genuinely wide target gives it its own real footballing shape and its
// own real claimability profile.
function arcOverlapTarget(attacker, attackingDirection) {
  const forwardSign = attackingDirection === "up" ? -1 : 1;
  const yard = toYardPoint(attacker);
  const centerX = PITCH_WIDTH_YARDS / 2;
  const outwardSign = yard.x < centerX ? -1 : 1;
  const rawYard = {
    x: yard.x + outwardSign * ARC_OVERLAP_OUTWARD_YARDS,
    y: yard.y + forwardSign * ARC_OVERLAP_FORWARD_YARDS,
  };
  return fromYardPoint({
    x: clamp(0, PITCH_WIDTH_YARDS, rawYard.x),
    y: clamp(0, PITCH_LENGTH_YARDS, rawYard.y),
  });
}

// Checked in a fixed priority order -- each picture is genuinely distinct
// (a body in the cone vs. a switch-of-play overlap vs. a marked attacker
// peeling vs. a clogged inside vs. a marked attacker with a real pocket),
// first eligible one wins, and nothing else in `pool` gets a second look
// once one fires -- the combined "1 special run" cap. `pool` is already
// onside and excludes the run-in-behind runner (callers pass
// `remainingOnside`); returns null when nothing in the pool qualifies for
// any of the five pictures.
// A markingLookup entry at/above TIGHT_MARK_THRESHOLD already has a more
// specific, existing answer (tightMarkReactionTarget()'s own check-away/
// in-behind/drop-short, driven by the REAL manMarkingPoint() standoff) --
// peel-square/check-decel are the vocabulary for a merely-nearby defender
// with no formal tight tracking assignment, never a second, competing
// answer for the same formally-marked picture.
function isFormallyTightMarked(attacker, markingLookup) {
  const markerInfo = markingLookup[attacker.id];
  return Boolean(markerInfo) && clampTightness(markerInfo.tightness) >= TIGHT_MARK_THRESHOLD;
}

// The original hard-coded if-chain, preserved verbatim under a new name. It
// is the PARITY REFERENCE for the declarative path -- the spatial-decision
// suite asserts the two agree on trigger and target across a fixture sweep,
// which is what makes this a migration rather than a rewrite -- and it stays
// the fallback for any picture the declarations do not cover.
export function selectSpecialMoverDirect(pool, defenders, allDefenders, attackingDirection, ballPoint, contexts, markingLookup) {
  if (!ballPoint || !pool.length) return null;

  const conePoint = pointAheadYards(ballPoint, attackingDirection, VACATE_POCKET_AHEAD_YARDS);
  const inCone = pool.find((attacker) =>
    yardDistanceToSegment(attacker, ballPoint, conePoint) < VACATE_POCKET_RADIUS_YARDS);
  if (inCone) {
    const idealSpot = clampRunTarget(vacatePocketTarget(inCone, ballPoint, conePoint), attackingDirection, contexts.get(inCone.id));
    if (claimable(inCone, idealSpot, allDefenders)) {
      return { id: inCone.id, action: "vacate-pocket", idealSpot };
    }
  }

  // arc-overlap is an UNMARKED runner exploiting a different channel --
  // a marked attacker escaping their own marker is squarely
  // tightMarkReactionTarget()'s (or peel-square's) job, never this one.
  const ballSide = toYardPoint(ballPoint).x < PITCH_WIDTH_YARDS / 2 ? "left" : "right";
  const overlapCandidate = pool.find((attacker) => {
    if (nearestWithin(attacker, defenders, ATTACKER_MARKED_RADIUS_YARDS)) return false;
    const side = toYardPoint(attacker).x < PITCH_WIDTH_YARDS / 2 ? "left" : "right";
    if (side === ballSide) return false;
    const target = clampRunTarget(arcOverlapTarget(attacker, attackingDirection), attackingDirection, contexts.get(attacker.id));
    return claimable(attacker, target, allDefenders);
  });
  if (overlapCandidate) {
    const idealSpot = clampRunTarget(arcOverlapTarget(overlapCandidate, attackingDirection), attackingDirection, contexts.get(overlapCandidate.id));
    return { id: overlapCandidate.id, action: "arc-overlap", idealSpot };
  }

  const peelCandidate = pool.find((attacker) =>
    !isFormallyTightMarked(attacker, markingLookup)
    && nearestWithin(attacker, defenders, ATTACKER_MARKED_RADIUS_YARDS)
    && yardDistance(attacker, ballPoint) <= PEEL_SQUARE_BALL_RADIUS_YARDS);
  if (peelCandidate) {
    const idealSpot = clampRunTarget(
      findSpaceTargetForAttack(peelCandidate, defenders, attackingDirection, peelCandidate.player), attackingDirection, contexts.get(peelCandidate.id),
    );
    if (claimable(peelCandidate, idealSpot, allDefenders)) {
      return { id: peelCandidate.id, action: "peel-square", idealSpot };
    }
  }

  const insideClog = laneObstruction(ballPoint, pointAheadYards(ballPoint, attackingDirection, SHOW_WIDE_AHEAD_YARDS), defenders);
  if (insideClog >= SHOW_WIDE_CLOG_THRESHOLD) {
    const wideCandidate = pool.find((attacker) => isOnWing(attacker));
    if (wideCandidate) {
      return { id: wideCandidate.id, action: "show-wide", idealSpot: holdWidthTarget(wideCandidate, ballPoint, attackingDirection) };
    }
  }

  // check-decel -- real two-phase decel-then-burst timing isn't built here
  // yet (static intention-target jobs don't carry phase timing); this ships
  // as a single delayed-onset dart into a genuine pocket, documented v1
  // simplification, same as this file's other honestly-flagged shortcuts.
  const decelCandidate = pool.find((attacker) =>
    !isFormallyTightMarked(attacker, markingLookup)
    && nearestWithin(attacker, defenders, ATTACKER_MARKED_RADIUS_YARDS));
  if (decelCandidate) {
    const idealSpot = clampRunTarget(
      findSpaceTargetForAttack(decelCandidate, defenders, attackingDirection, decelCandidate.player), attackingDirection, contexts.get(decelCandidate.id),
    );
    if (claimable(decelCandidate, idealSpot, allDefenders)) {
      return { id: decelCandidate.id, action: "check-decel", idealSpot };
    }
  }

  return null;
}

/**
 * Declarative special-mover selection.
 *
 * Routes the same five pictures through actionPatternRegistry.js. The
 * registry decides WHICH picture fires and WHO fills each abstract slot;
 * every predicate and every coordinate below is the existing function,
 * injected -- there is no second geometry model here, and nothing in this
 * path writes a position.
 *
 * Falls back to the original chain whenever the declarative path proposes
 * nothing, so any picture the declarations do not cover behaves exactly as
 * it did before.
 */
export function selectSpecialMover(pool, defenders, allDefenders, attackingDirection, ballPoint, contexts, markingLookup) {
  if (!ballPoint || !pool.length) return null;
  const context = {
    possession: "attacking",
    pool, defenders, allDefenders, attackingDirection, ballPoint, contexts, markingLookup,
  };

  // Every predicate below is exactly the condition the matching arm of
  // selectSpecialMoverDirect() tests, lifted unchanged.
  const conePoint = pointAheadYards(ballPoint, attackingDirection, VACATE_POCKET_AHEAD_YARDS);
  const ballSide = toYardPoint(ballPoint).x < PITCH_WIDTH_YARDS / 2 ? "left" : "right";
  const insideClog = laneObstruction(
    ballPoint, pointAheadYards(ballPoint, attackingDirection, SHOW_WIDE_AHEAD_YARDS), defenders,
  );

  const targetFor = (patternId, attacker) => {
    switch (patternId) {
      case "pattern:vacate-pocket@1":
        return clampRunTarget(
          vacatePocketTarget(attacker, ballPoint, conePoint),
          attackingDirection, contexts.get(attacker.id),
        );
      case "pattern:arc-overlap@1":
        return clampRunTarget(
          arcOverlapTarget(attacker, attackingDirection),
          attackingDirection, contexts.get(attacker.id),
        );
      case "pattern:peel-square@1":
      case "pattern:check-decel@1":
        return clampRunTarget(
          findSpaceTargetForAttack(attacker, defenders, attackingDirection, attacker.player),
          attackingDirection, contexts.get(attacker.id),
        );
      case "pattern:show-wide@1":
        return holdWidthTarget(attacker, ballPoint, attackingDirection);
      default:
        return null;
    }
  };

  const findParticipant = (pattern, participant) => {
    if (participant.slot === "ballOwner") {
      // The carrier is CONTEXT for these pictures, not a claimable
      // participant: binding them would let one pattern's context block
      // another pattern's actor for no footballing reason.
      return { id: "__ball-owner__", player: null };
    }
    switch (pattern.id) {
      case "pattern:vacate-pocket@1": {
        const inCone = pool.find((attacker) =>
          yardDistanceToSegment(attacker, ballPoint, conePoint) < VACATE_POCKET_RADIUS_YARDS);
        if (!inCone) return null;
        return claimable(inCone, targetFor(pattern.id, inCone), allDefenders) ? inCone : null;
      }
      case "pattern:arc-overlap@1":
        return pool.find((attacker) => {
          if (nearestWithin(attacker, defenders, ATTACKER_MARKED_RADIUS_YARDS)) return false;
          const side = toYardPoint(attacker).x < PITCH_WIDTH_YARDS / 2 ? "left" : "right";
          if (side === ballSide) return false;
          return claimable(attacker, targetFor(pattern.id, attacker), allDefenders);
        }) ?? null;
      case "pattern:peel-square@1": {
        const peel = pool.find((attacker) =>
          !isFormallyTightMarked(attacker, markingLookup)
          && nearestWithin(attacker, defenders, ATTACKER_MARKED_RADIUS_YARDS)
          && yardDistance(attacker, ballPoint) <= PEEL_SQUARE_BALL_RADIUS_YARDS);
        if (!peel) return null;
        return claimable(peel, targetFor(pattern.id, peel), allDefenders) ? peel : null;
      }
      case "pattern:show-wide@1":
        if (insideClog < SHOW_WIDE_CLOG_THRESHOLD) return null;
        return pool.find((attacker) => isOnWing(attacker)) ?? null;
      case "pattern:check-decel@1": {
        const decel = pool.find((attacker) =>
          !isFormallyTightMarked(attacker, markingLookup)
          && nearestWithin(attacker, defenders, ATTACKER_MARKED_RADIUS_YARDS));
        if (!decel) return null;
        return claimable(decel, targetFor(pattern.id, decel), allDefenders) ? decel : null;
      }
      default:
        return null;
    }
  };

  const matched = matchActionPatterns(context, {
    findParticipant,
    deriveTarget: (pattern, actor) => targetFor(pattern.id, actor),
  });
  // run-off-pass is the passer's own always-eligible job, planned separately
  // by runOffPassTarget(); it is declared for vocabulary completeness and is
  // deliberately outside the special-run group, so it never competes here.
  const chosen = matched.proposals.find((proposal) => proposal.exclusivityGroup === "special-run");
  lastSpecialMoverDiagnostics = matched;
  if (!chosen) return null;
  const attacker = pool.find((entry) => entry.id === chosen.actorId);
  if (!attacker) return null;
  return { id: attacker.id, action: chosen.job, idealSpot: chosen.target };
}

// Development diagnostics only: the last match/rejection set, so Match Lab
// can show which patterns fired and why the others did not. Never read by
// any decision, never affects RNG (there is none here), and overwritten on
// every call.
let lastSpecialMoverDiagnostics = null;

export function lastActionPatternDiagnostics() {
  return lastSpecialMoverDiagnostics;
}

// V4/V9/V10 -- "whoever just passed gets run-off-pass from the KICK."
// Relative to where the BALL is going (`passDestination`), not the
// passer's own current spot -- a real "support the ball I just played"
// line, continued past the destination. Falls back to a straight forward
// run when the pass barely moved the ball (a near-zero vector, e.g. a
// backward recycle) so this never degenerates to a zero-length target.
// Distance scales with Work Rate; direction may legally end up horizontal
// or even a touch backward (a recycle option), never mandated forward.
function runOffPassTarget(passer, passDestination, attackingDirection, workRate01) {
  const distance = RUN_OFF_PASS_BASE_YARDS * (0.5 + 0.5 * clamp(0, 1, workRate01));
  const passerYard = toYardPoint(passer);
  const destYard = toYardPoint(passDestination ?? passer);
  const forwardSign = attackingDirection === "up" ? -1 : 1;
  const dx = destYard.x - passerYard.x;
  const dy = destYard.y - passerYard.y;
  const length = Math.hypot(dx, dy);
  const unit = length > 1 ? { x: dx / length, y: dy / length } : { x: 0, y: forwardSign };
  const rawYard = {
    x: passerYard.x + unit.x * distance,
    y: passerYard.y + unit.y * distance,
  };
  // No offside snapshot is computed for the passer (they were just onside
  // holding the ball) -- clampRunTarget()'s own byline-safety floor alone
  // is enough for this short a run; a real per-attacker offside check
  // would need threading the passer through selectLineBreakingRunner()'s
  // own context-building for no real benefit at this range.
  return clampRunTarget(
    fromYardPoint({
      x: clamp(0, PITCH_WIDTH_YARDS, rawYard.x),
      y: clamp(0, PITCH_LENGTH_YARDS, rawYard.y),
    }),
    attackingDirection,
  );
}

// Extracted (2026-08-26, Off-Ball Motion v3) so planDefensiveRepositioning()'s
// own last-man recovery override (see its own header comment) can know WHO
// is about to break the line -- and recover onto THEM specifically, during
// the ball's own flight, not only after the reception -- without running
// this file's full attacker-planning pipeline (box runs, build-up phase,
// tight-mark reactions, none of which affect who wins this selection).
// Returns both the per-attacker offside snapshot map (reused by the rest of
// planAttackerRepositioning's own body below) and the single selected
// runner's id (MAX_LINE_BREAK_RUNNERS is 1) so there is exactly one source
// of truth for "who is the line-breaking run," never two independently
// tuned copies that could drift apart.
function selectLineBreakingRunner(attackingTeammates, defenders, attackingDirection, ballPoint, keeper) {
  const allDefenders = defendingPlayers(defenders, keeper);
  const contexts = new Map(attackingTeammates.map((attacker) => [
    attacker.id,
    ballPoint ? buildOffsideSnapshot({
      attacker, ballPoint, defenders: allDefenders, attackingDirection,
    }) : null,
  ]));
  const unmarkedOnside = attackingTeammates.filter((attacker) => {
    const nearestDefender = nearestWithin(attacker, defenders, ATTACKER_MARKED_RADIUS_YARDS);
    const target = clampRunTarget(forwardRunTarget(attacker, attackingDirection), attackingDirection, contexts.get(attacker.id));
    return !nearestDefender && !contexts.get(attacker.id)?.isOffside
      && claimable(attacker, target, allDefenders);
  }).sort((left, right) => lineBreakingScore(right, attackingDirection) - lineBreakingScore(left, attackingDirection));
  return { contexts, runnerId: unmarkedOnside.slice(0, MAX_LINE_BREAK_RUNNERS)[0]?.id ?? null };
}

// Public, minimal wrapper for callers (match-lab.js's own reactOffBall()/
// reactOffBallContinuous()) that only need the id, computed BEFORE
// planDefensiveRepositioning() so its own recovery override can thread it
// straight in -- see planDefensiveRepositioning()'s own `runnerId` option.
export function identifyLineBreakingRunnerId(attackingTeammates, defenders, attackingDirection, ballPoint, keeper) {
  if (!attackingTeammates.length) return null;
  return selectLineBreakingRunner(attackingTeammates, defenders, attackingDirection, ballPoint, keeper).runnerId;
}

export function planAttackerRepositioning(attackingTeammates, defenders, attackingDirection, {
  ballPoint = null, keeper = null, previousSupportId = null, previousDropId = null,
  // Off-Ball v2 (2026-08-24) -- both optional and additive; every existing
  // caller that omits them gets exactly the old behavior.
  markingLookup = {}, ownerBand = null, previousShowId = null,
  // Pattern Vocabulary V1, Step 1 (2026-09-02) -- optional and additive,
  // same convention. When passerId names a member of attackingTeammates,
  // they're planned SEPARATELY (run-off-pass, see runOffPassTarget()'s own
  // header) instead of competing for the ordinary off-ball jobs below --
  // callers include the passer in attackingTeammates specifically so their
  // own flight-duration reaction gets planned at all (see resolvePass()'s
  // own matching comment: before this, the passer was never in the pool
  // being planned for during their own pass's flight -- "standing still
  // after a pass" was a real, reported bug).
  passerId = null, passDestination = null,
} = {}) {
  if (!attackingTeammates.length) return [];
  const passer = passerId ? attackingTeammates.find((attacker) => attacker.id === passerId) ?? null : null;
  const planningPool = passer ? attackingTeammates.filter((attacker) => attacker.id !== passerId) : attackingTeammates;
  const allDefenders = defendingPlayers(defenders, keeper);
  const { contexts, runnerId } = planningPool.length
    ? selectLineBreakingRunner(planningPool, defenders, attackingDirection, ballPoint, keeper)
    : { contexts: new Map(), runnerId: null };
  const selectedRunners = new Set(runnerId ? [runnerId] : []);

  const remainingOnside = planningPool.filter((attacker) =>
    !contexts.get(attacker.id)?.isOffside && !selectedRunners.has(attacker.id));

  // Pattern Vocabulary V1, Step 1 -- combined with run-in-behind's own cap
  // (L3, "1 special run"): skip special-mover selection entirely once a
  // line-breaking runner already claimed this call's one allowed slot.
  const specialMover = selectedRunners.size > 0
    ? null
    : selectSpecialMover(remainingOnside, defenders, allDefenders, attackingDirection, ballPoint, contexts, markingLookup);

  // Box Runs v1 (2026-08-26) -- see boxRunTargetSlots()'s own header
  // comment above. The opposite winger is claimed HERE, before support/
  // width, because "holds the width" on the flank the ball ISN'T being
  // played toward is a low-value job a real winger doesn't actually do
  // once their own team is threatening from the other side -- they tuck
  // in and crash the far post instead. Every OTHER box run (the
  // striker(s), the most advanced midfielder) still only claims from the
  // leftover pin-last-line bucket further down, after support/width/drop
  // have already had first pick -- immediate support for whoever's
  // actually closest to the ball right now is more urgent than the
  // eventual box run.
  const boxRunTriggered = Boolean(ballPoint)
    && distanceToGoalYards(ballPoint, attackingDirection) <= BOX_RUN_TRIGGER_MAX_DISTANCE_YARDS;
  const boxRunSlots = boxRunTriggered ? boxRunTargetSlots(ballPoint, attackingDirection) : null;
  const boxRunAssignments = new Map();
  let oppositeWingerBoxRunId = null;
  if (boxRunTriggered) {
    const ballSide = toYardPoint(ballPoint).x < PITCH_WIDTH_YARDS / 2 ? "left" : "right";
    const oppositeWingerCandidate = remainingOnside
      .filter((attacker) => classifyOutfieldBand(attacker.player) !== "defender")
      .filter((attacker) => (toYardPoint(attacker).x < PITCH_WIDTH_YARDS / 2 ? "left" : "right") !== ballSide)
      .sort((left, right) => Math.abs(toYardPoint(right).x - PITCH_WIDTH_YARDS / 2) - Math.abs(toYardPoint(left).x - PITCH_WIDTH_YARDS / 2))[0];
    if (oppositeWingerCandidate) {
      const idealSpot = clampRunTarget(boxRunSlots.farPost, attackingDirection, contexts.get(oppositeWingerCandidate.id));
      if (yardDistance(oppositeWingerCandidate, idealSpot) <= BOX_RUN_MAX_RUNNER_DISTANCE_YARDS
        && claimable(oppositeWingerCandidate, idealSpot, allDefenders)) {
        boxRunAssignments.set(oppositeWingerCandidate.id, { point: idealSpot, slotKey: "farPost" });
        oppositeWingerBoxRunId = oppositeWingerCandidate.id;
      }
    }
  }

  const supportId = ballPoint && remainingOnside.length
    ? pickWithStickiness(
        remainingOnside.filter((attacker) => attacker.id !== oppositeWingerBoxRunId),
        ballPoint, previousSupportId, ROLE_STICKINESS_MARGIN_YARDS,
      )
    : null;
  const widthId = remainingOnside
    .filter((attacker) => attacker.id !== supportId && attacker.id !== oppositeWingerBoxRunId)
    .sort((left, right) => Math.abs(right.x - 50) - Math.abs(left.x - 50))[0]?.id ?? null;

  // Forward Pairing v1 (2026-08-19) -- see MATCH_LAB_PLAN.md. Without
  // this, two advanced, unmarked attackers near each other could BOTH
  // land on pin-last-line (zero movement) whenever some other, closer
  // teammate had already claimed the single global supportId above --
  // real strikers pair up instead: one drops short to offer a link, the
  // other holds the line stretching it. Scoped ONLY to attackers who'd
  // otherwise get pin-last-line -- every more urgent job (run-in-behind/
  // support-short/hold-width/diagonal-inside) still wins outright, this
  // never overrides one of those. `pinEligible` is exactly
  // pin-last-line's own eligibility test, computed once, ahead of the
  // main loop, so both places agree by construction. Among each such
  // attacker's own nearby (FORWARD_PAIR_RADIUS_YARDS) pin-eligible
  // peers, the one closest to the ball becomes the drop; a LONE advanced
  // attacker with no such peer at all still just holds position exactly
  // as before -- pairing off a group of one is meaningless.
  const FORWARD_PAIR_RADIUS_YARDS = 18;
  const pinEligible = planningPool.filter((attacker) => {
    if (contexts.get(attacker.id)?.isOffside) return false;
    if (selectedRunners.has(attacker.id)) return false;
    if (attacker.id === supportId) return false;
    if (attacker.id === widthId && Math.abs(attacker.x - 50) >= 18) return false;
    return !nearestWithin(attacker, defenders, ATTACKER_MARKED_RADIUS_YARDS);
  });
  const dropCandidates = pinEligible.filter((attacker) => pinEligible.some((peer) =>
    peer.id !== attacker.id && yardDistance(attacker, peer) <= FORWARD_PAIR_RADIUS_YARDS));
  const dropId = ballPoint
    ? pickWithStickiness(dropCandidates, ballPoint, previousDropId, ROLE_STICKINESS_MARGIN_YARDS)
    : null;

  // Box Runs v1 continued -- the striker(s) and the most advanced
  // midfielder, claimed here from pinEligible (exactly the "would
  // otherwise stand still" pool Forward Pairing already computed), minus
  // whoever Forward Pairing already claimed as the drop, minus the
  // opposite winger already claimed above, and never a defender-band
  // player (a fullback holding shape is not a box-crashing run).
  if (boxRunTriggered) {
    const boxRunPool = pinEligible.filter((attacker) =>
      attacker.id !== dropId && attacker.id !== oppositeWingerBoxRunId
      && classifyOutfieldBand(attacker.player) !== "defender");
    const claimedSlots = new Set(oppositeWingerBoxRunId ? ["farPost"] : []);
    const claimSlot = (candidate, slotKey) => {
      if (!candidate || boxRunAssignments.has(candidate.id) || claimedSlots.has(slotKey)) return;
      const idealSpot = clampRunTarget(boxRunSlots[slotKey], attackingDirection, contexts.get(candidate.id));
      if (yardDistance(candidate, idealSpot) > BOX_RUN_MAX_RUNNER_DISTANCE_YARDS) return;
      if (!claimable(candidate, idealSpot, allDefenders)) return;
      boxRunAssignments.set(candidate.id, { point: idealSpot, slotKey });
      claimedSlots.add(slotKey);
    };
    // Striker(s): most advanced first, central slot (the real danger
    // area) then the two post slots as fallback for a front two/three.
    const strikerSlotOrder = ["central", "nearPost", "farPost"];
    boxRunPool
      .filter((attacker) => classifyOutfieldBand(attacker.player) === "attacker")
      .sort((left, right) => distanceToGoalYards(left, attackingDirection) - distanceToGoalYards(right, attackingDirection))
      .forEach((striker, index) => claimSlot(striker, strikerSlotOrder[Math.min(index, strikerSlotOrder.length - 1)]));
    // The most advanced midfielder arrives late at the edge of the box.
    const boxRunMidfielders = boxRunPool.filter((attacker) => classifyOutfieldBand(attacker.player) === "midfielder");
    claimSlot(mostAdvancedAttacker(boxRunMidfielders, attackingDirection), "edgeOfBox");
  }

  // Build-up phase (2026-08-24, Off-Ball v2) -- the ball owner is THIS
  // side's own classified defender, calmly in possession, not a live
  // attacking phase with defenders scrambling. Midfield jobs change shape
  // entirely: one sticky show-to-feet outlet (a genuine passing option
  // close to the CB), one check-to-space (already the most separated from
  // any opponent -- a real hittable lane, not whoever's nearest), the rest
  // hold between the lines. Never pin-last-line in this phase -- a mid
  // freezing on the last line while their own CB is still on the ball is
  // the wrong picture entirely. Forwards are untouched -- this only
  // reshapes MIDFIELDER-band jobs, and only once they've already cleared
  // the offside/run-in-behind checks above (a genuine line-breaking chance
  // still wins outright even during build-up).
  const buildUpPhase = ownerBand === "defender";
  const buildUpMidfielders = buildUpPhase
    ? planningPool.filter((attacker) =>
        !contexts.get(attacker.id)?.isOffside
        && !selectedRunners.has(attacker.id)
        && classifyOutfieldBand(attacker.player) === "midfielder")
    : [];
  const showToFeetId = buildUpMidfielders.length && ballPoint
    ? pickWithStickiness(buildUpMidfielders, ballPoint, previousShowId, ROLE_STICKINESS_MARGIN_YARDS)
    : null;
  const checkToSpaceId = buildUpMidfielders
    .filter((attacker) => attacker.id !== showToFeetId)
    .sort((left, right) => {
      const leftGap = defenders.length ? Math.min(...defenders.map((entry) => yardDistance(left, entry))) : Infinity;
      const rightGap = defenders.length ? Math.min(...defenders.map((entry) => yardDistance(right, entry))) : Infinity;
      return rightGap - leftGap;
    })[0]?.id ?? null;

  const results = planningPool.map((attacker) => {
    const nearestDefender = nearestWithin(attacker, defenders, ATTACKER_MARKED_RADIUS_YARDS);
    const offside = contexts.get(attacker.id);
    const isBuildUpMidfielder = buildUpPhase
      && !offside?.isOffside && !selectedRunners.has(attacker.id)
      && classifyOutfieldBand(attacker.player) === "midfielder";
    let action;
    let idealSpot;
    if (offside?.isOffside) {
      action = "recover-onside";
      idealSpot = { x: attacker.x, y: onsideLineTargetY(offside, ONSIDE_LINE_BUFFER_YARDS) };
    } else if (selectedRunners.has(attacker.id)) {
      action = "run-in-behind";
      idealSpot = clampRunTarget(forwardRunTarget(attacker, attackingDirection), attackingDirection, offside);
    } else if (isBuildUpMidfielder && attacker.id === showToFeetId) {
      action = "show-to-feet";
      idealSpot = supportShortTarget(attacker, ballPoint);
    } else if (isBuildUpMidfielder && attacker.id === checkToSpaceId) {
      action = "check-to-space";
      idealSpot = clampRunTarget(
        findSpaceTargetForAttack(attacker, defenders, attackingDirection, attacker.player), attackingDirection, offside,
      );
    } else if (isBuildUpMidfielder) {
      action = "hold-between-lines";
      idealSpot = clampRunTarget({ x: attacker.x, y: attacker.y }, attackingDirection, offside);
    } else if (specialMover && attacker.id === specialMover.id) {
      action = specialMover.action;
      idealSpot = specialMover.idealSpot;
    } else if (attacker.id === supportId) {
      action = "support-short";
      idealSpot = supportShortTarget(attacker, ballPoint);
    } else if (attacker.id === widthId && Math.abs(attacker.x - 50) >= 18) {
      action = "hold-width";
      idealSpot = holdWidthTarget(attacker, ballPoint, attackingDirection);
    } else if (nearestDefender) {
      const markerInfo = markingLookup[attacker.id];
      const tightReaction = markerInfo && clampTightness(markerInfo.tightness) >= TIGHT_MARK_THRESHOLD
        ? tightMarkReactionTarget(attacker, markerInfo, defenders, attackingDirection, offside, ballPoint)
        : null;
      action = tightReaction?.action ?? "diagonal-inside";
      idealSpot = tightReaction?.idealSpot ?? clampRunTarget(
        findSpaceTargetForAttack(attacker, defenders, attackingDirection, attacker.player), attackingDirection, offside,
      );
    } else if (attacker.id === dropId) {
      action = "drop-deep";
      idealSpot = supportShortTarget(attacker, ballPoint);
    } else if (boxRunAssignments.has(attacker.id)) {
      const claim = boxRunAssignments.get(attacker.id);
      action = BOX_RUN_SLOT_ACTION[claim.slotKey];
      idealSpot = claim.point;
    } else {
      action = "pin-last-line";
      idealSpot = clampRunTarget({ x: attacker.x, y: attacker.y }, attackingDirection, offside);
    }
    return {
      id: attacker.id,
      action,
      target: approachPoint(attacker, idealSpot, effortScaledAdvance(ATTACKER_MAX_ADVANCE_YARDS, attacker.player, attacker.burst01)),
      intentionTarget: idealSpot,
      offside,
      held: action === "pin-last-line" && yardDistance(attacker, idealSpot) < 0.25,
    };
  });
  if (!passer) return results;
  // V4/V9/V10, Acceptance A -- "unless Work Rate and burst are empty" is
  // the one carve-out where the passer does NOT get run-off-pass; they
  // genuinely don't have the legs for it and hold position instead.
  const passerWorkRate01 = clamp(0, 1, playerAttribute(passer.player, "Work Rate") / 20);
  const passerBurst01 = clamp(0, 1, Number(passer.burst01 ?? 1));
  const passerFit = !(passerWorkRate01 < 0.15 && passerBurst01 < 0.15);
  const passerIdealSpot = passerFit
    ? runOffPassTarget(passer, passDestination, attackingDirection, passerWorkRate01)
    : { x: passer.x, y: passer.y };
  const passerAction = passerFit ? "run-off-pass" : "pin-last-line";
  results.push({
    id: passer.id,
    action: passerAction,
    target: approachPoint(passer, passerIdealSpot, effortScaledAdvance(ATTACKER_MAX_ADVANCE_YARDS, passer.player, passer.burst01)),
    intentionTarget: passerIdealSpot,
    offside: null,
    held: passerAction === "pin-last-line" && yardDistance(passer, passerIdealSpot) < 0.25,
  });
  return results;
}

// ---------------------------------------------------------------------------
// Progression -- real yard advance a point would make toward its own
// attacking goal, used by pass/carry/dribble utility alike. Positive =
// forward, negative = backward.
// ---------------------------------------------------------------------------

export function progressionYards(from, to, attackingDirection) {
  const fromDistance = distanceToGoalYards(from, attackingDirection);
  const toDistance = distanceToGoalYards(to, attackingDirection);
  return fromDistance - toDistance;
}

// ---------------------------------------------------------------------------
// Perception/selection sharpness -- Decisions/Vision/Anticipation/
// Composure ONLY (see file header). Higher sharpness -> less noise added
// in chooseCandidate() -> selection tracks the true utility ranking more
// closely. This is deliberately where "a low-Decisions player makes a
// mistake" comes from -- an emergent property of noisy selection, not a
// hand-coded backward-pass exception.
// ---------------------------------------------------------------------------

export function selectionSharpness(player) {
  const decisions = playerAttribute(player, "Decisions");
  const vision = playerAttribute(player, "Vision");
  const anticipation = playerAttribute(player, "Anticipation");
  const composure = playerAttribute(player, "Composure");
  return average([decisions, vision, anticipation, composure]) / 20;
}

function noiseScaleFor(player) {
  const sharpness = selectionSharpness(player);
  // Sharpest realistic players (~1.0) still get a little noise (real
  // decision-making is never perfectly optimal); the weakest (~0.05
  // floor, since playerAttribute never returns below ~1) get noise wide
  // enough to occasionally overturn a close-run utility ranking, but not
  // wide enough to make a clearly-best option a coin flip.
  return clamp(0.15, 1.5, 1.65 - sharpness * 1.4);
}

// ---------------------------------------------------------------------------
// Utility scoring -- each returns a plain number (higher = more
// attractive), all on a roughly comparable scale so candidates of
// DIFFERENT types (a pass vs a shot vs a carry) can be compared directly.
// No execution attributes read here (see file header); geometry/pressure/
// context only.
// ---------------------------------------------------------------------------

// pressure/lane weighted high enough, relative to progression, that a
// genuinely bad forward option (heavily marked receiver, an opponent
// sitting right in the lane) CAN lose to a clean, wide-open backward
// pass -- not just occasionally through selection noise, but on real
// utility merit. Confirmed directly by
// tools/test-spatial-decision.mjs's own "allowed when forward options
// are worse" case, not just asserted here.
//
// pressureRelief (2026-08-19) -- a real browser round reported two
// players trading the ball back and forth in tight 1v1 duels instead of
// ever recycling it to a free teammate: "if a player is facing his own
// goal, he'd pass it to his teammate because losing the ball would be
// costly." Root cause traced with real numbers, not guessed: this
// function had NO concept of the OWNER's own current danger at all --
// every term here scores the RESULT of the pass (progression, the
// receiver's pressure, the lane), never the independent value of simply
// getting the ball off your own foot right now. carryUtility() already has this
// exact concept (its own `pressureRelief` term, rewarding a destination
// that's safer than where you started) -- passUtility() never got the
// equivalent, so even a genuinely SAFE backward/square pass under heavy
// direct marking scored deeply negative (confirmed directly: -1.5 to
// -1.9 for a routine backward pass with NO opponents anywhere on the
// pitch at all, purely from geometry) and could never compete with
// dribbleUtility/holdUtility, whose own danger penalties are an order of
// magnitude smaller. `pressureRelief` reads the OWNER's own current
// pressure (independent of which teammate is being evaluated -- the
// relief of releasing the ball is the same regardless of the target) and
// rewards passing proportionally to how urgently the ball actually needs
// to leave. A pass into a genuinely blocked lane or a heavily-marked
// receiver still loses on its own separate, unaffected merits (`lane`/
// `pressure` keep their full weight) -- this only helps otherwise-viable
// options that were previously scored as if the owner were standing
// alone in an empty stadium.
const PASS_UTILITY_WEIGHTS = {
  progression: 1.4, pressure: 1.6, distance: 0.6, lane: 2.0, resultDistance: 0.5, resultAngle: 0.3,
  pressureRelief: 1.5,
};

// ---------------------------------------------------------------------------
// Attacking-on-the-Ball v2, slices 1+2 (2026-08-25) -- see MATCH_LAB_PLAN.md.
// Two independent, additive mechanics layered on top of the utility scores
// below, both driven by a settings bag ({ style, directness }) threaded
// through exactly the way markingSettingsFor() already reaches
// planDefensiveRepositioning() -- a bag passed explicitly by the caller,
// never a hidden module-level global, and NEVER a filter: neither mechanic
// ever removes a legal candidate or invents one that wasn't already
// structurally offered.
//
// skippedSimplePenalty() is the actual bug fix (a keeper-to-striker 80-yard
// first ball winning the argmax by default, reported directly against a
// live screenshot): whenever a genuinely simple, low-risk option exists
// (isSimpleOption() below), any AMBITIOUS option (a long pass/through/punt)
// takes a real utility hit, scaled by directness and style, and NEVER
// fully zero during build-up. This fires the instant
// generateFreePlayCandidates()/keeperDistributionCandidates() compute it,
// using DEFAULT_ATTACKING_SETTINGS the moment their own caller hasn't
// supplied a real settings bag -- "the team plays simple football by
// default" is not conditional on anyone touching the Attacking UI.
//
// The separate, much smaller STYLE-AFFINITY bias further down (see each
// utility's own `context.attackingSettings` block) is gated behind an
// EXPLICITLY supplied attackingSettings object and stays entirely inert
// otherwise -- every pre-existing direct call to passUtility()/
// holdUtility()/etc. (this file's own regression suite included, none of
// which know this feature exists) keeps its exact original score.
// ---------------------------------------------------------------------------
export const DEFAULT_ATTACKING_SETTINGS = DEFAULT_TEAM_ATTACKING;

const SIMPLE_OPTION_MAX_YARDS = 18;
const SIMPLE_OPTION_MAX_PRESSURE = 0.35;
const SIMPLE_OPTION_MAX_LANE = 0.3;
const AMBITIOUS_MIN_DISTANCE_YARDS = 35;
const CORRIDOR_RADIUS_YARDS = 8;
// Brutal at directness 1-2 (skip the ambitious ball, take the free man),
// tapering toward directness 5 (look furthest first) -- but this NEVER
// hits zero; an ambitious option is discouraged at every setting, never
// deleted (see generateFreePlayCandidates()'s own file header: styles
// "encourage, never force, never delete a legal option").
const DIRECTNESS_SKIP_PENALTY = { 1: 1.6, 2: 1.3, 3: 0.9, 4: 0.55, 5: 0.3 };
const STYLE_SKIP_MULTIPLIER = { possession: 1.3, direct: 1.0, "long-ball": 0.55, wing: 1.0 };

function clampDirectness(directness) {
  return clamp(1, 5, Math.round(Number(directness) || DEFAULT_ATTACKING_SETTINGS.directness));
}

export function normalizeAttackingSettings(attackingSettings) {
  return normalizeTeamAttacking({
    ...attackingSettings,
    directness: clampDirectness(attackingSettings?.directness),
  });
}

// A teammate is a SIMPLE option: onside, close, unpressured, and in a
// genuinely clear lane. `offsideGroups` is whatever offsideSnapshotForTarget()
// itself needs (the same groups object generateFreePlayCandidates() already
// builds); a missing/incomplete groups object degrades to "never excluded
// by offside" (buildOffsideSnapshot()'s own fallback-ballPoint contract),
// never a crash.
function isSimpleOption(owner, teammate, opponents, attackingDirection, offsideGroups) {
  if (offsideGroups) {
    const offside = offsideSnapshotForTarget(offsideGroups, teammate, attackingDirection);
    if (offside.isOffside) return false;
  }
  if (yardDistance(owner, teammate) > SIMPLE_OPTION_MAX_YARDS) return false;
  if (pressureAt(teammate, opponents) >= SIMPLE_OPTION_MAX_PRESSURE) return false;
  if (laneObstruction(owner, teammate, opponents) >= SIMPLE_OPTION_MAX_LANE) return false;
  return true;
}

export function hasSimpleOption(owner, teammates, opponents, attackingDirection, offsideGroups) {
  return teammates.some((teammate) => isSimpleOption(owner, teammate, opponents, attackingDirection, offsideGroups));
}

export function isBuildUpPhase(owner) {
  return owner?.role === "keeper" || classifyOutfieldBand(owner?.player) === "defender";
}

function isAmbitiousOption(type, distanceYards, ownHalfThrough) {
  if (type === "punt") return true;
  if (distanceYards >= AMBITIOUS_MIN_DISTANCE_YARDS) return true;
  if (type === "through" && ownHalfThrough) return true;
  return false;
}

// The actual "simple game" mechanic. Zero whenever no simple option
// exists anywhere (an ambitious ball is the ONLY option -- never punished
// for that) or the candidate being scored isn't itself ambitious.
function skippedSimplePenalty(type, distanceYards, ownHalfThrough, hasSimple, attackingSettings, buildUp) {
  if (!hasSimple || !isAmbitiousOption(type, distanceYards, ownHalfThrough)) return 0;
  const settings = normalizeAttackingSettings(attackingSettings);
  let base = DIRECTNESS_SKIP_PENALTY[settings.directness];
  if (buildUp) base = Math.max(base, DIRECTNESS_SKIP_PENALTY[2]);
  return base * (STYLE_SKIP_MULTIPLIER[settings.style] ?? 1);
}

// A queue of bodies loosely strung along a pass segment -- not necessarily
// right on the tight 3-yd laser laneObstruction() already penalizes -- is
// still not a clear lane for a genuinely long ball. Only ever weighted on
// long balls (see each call site) so a busy midfield doesn't kill ordinary
// short combination play.
function corridorCongestion(from, to, opponents) {
  const count = opponents.filter(
    (opponent) => yardDistanceToSegment(opponent, from, to) <= CORRIDOR_RADIUS_YARDS,
  ).length;
  return clamp(0, 1, Math.max(0, count - 1) / 3);
}

function isOwnHalf(point, attackingDirection) {
  const y = toYardPoint(point).y;
  const half = PITCH_LENGTH_YARDS / 2;
  return attackingDirection === "up" ? y > half : y < half;
}

// (Passing+Technique)/40 -- a real skill-range scaling so a genuinely weak
// passer's own long/raking-ball bonus stays small ("an 8 does not pick the
// Hollywood ball"). CHOICE weight only, same "attribute reads decide which
// option looks attractive, never how well it's executed" rule this file's
// header already documents for canAttemptShot() -- this never touches
// execution (resolvePass's own accuracy roll is untouched).
function longBallCapability(ownerPlayer) {
  return clamp(0, 1.2, (playerAttribute(ownerPlayer, "Passing") + playerAttribute(ownerPlayer, "Technique")) / 40);
}

// `context` (2026-08-25, Attacking-on-the-Ball v2): an optional
// { attackingSettings, hasSimpleOption, isBuildUp } bag -- see this file's
// own "Attacking-on-the-Ball v2" header above. Every existing bare 4-arg
// call (this file's own regression suite included) gets `context = {}`,
// under which both the skipped-simple penalty and the style bias are
// fully inert; only generateFreePlayCandidates()/keeperDistributionCandidates()
// build and pass a real one.
export function passUtility(owner, teammate, opponents, attackingDirection, context = {}) {
  const progression = progressionYards(owner, teammate, attackingDirection);
  const receiverPressure = pressureAt(teammate, opponents);
  const ownerPressure = pressureAt(owner, opponents);
  const distanceYards = yardDistance(owner, teammate);
  const lane = laneObstruction(owner, teammate, opponents);
  const resultDistance = distanceToGoalYards(teammate, attackingDirection);
  const resultAngle = shotAngleTightness(teammate, attackingDirection);
  const w = PASS_UTILITY_WEIGHTS;
  let utility = 0;
  // The progression term alone already scores a backward pass all the
  // way down to its own -1 floor for any real loss of ground -- a
  // separate flat "backward" penalty used to also apply on top of that,
  // double-counting the exact same signal (removed 2026-08-19, alongside
  // pressureRelief above; see that comment for the full reasoning).
  utility += clamp(-1, 1, progression / 30) * w.progression;
  utility -= receiverPressure * w.pressure;
  // Distance term (2026-08-25 fix): the old (d-15)/35 fully saturated by
  // 50 yd, so a 55-yard ball and a 90-yard one scored IDENTICALLY on
  // distance alone -- part of why an 80-yard keeper punt could tie a far
  // more reasonable 50-yard ball. (d-12)/55 keeps costing well past 50yd.
  utility -= clamp(0, 1, (distanceYards - 12) / 55) * w.distance;
  utility -= lane * w.lane;
  // Corridor congestion (2026-08-25): a queue of bodies loosely strung
  // along the lane, not necessarily right on the tight 3-yd laser above --
  // only weighted on genuinely long balls so short combination play isn't
  // penalized for a normally busy midfield.
  if (distanceYards >= AMBITIOUS_MIN_DISTANCE_YARDS) {
    utility -= corridorCongestion(owner, teammate, opponents) * 0.9;
  }
  // Bugfix slice -- see teammateClutter()'s own header. Applies at every
  // distance (unlike corridorCongestion above, which only fires long) --
  // exactly the short-combination-play range where a crowded pile is the
  // real, reported problem.
  if (context.teammates) {
    utility -= teammateClutter(teammate, context.teammates, teammate.id) * TEAMMATE_CLUTTER_WEIGHT;
  }
  if (distanceYards < CONGESTION_SHORT_PASS_YARDS && (context.congestionStreak ?? 0) >= CONGESTION_STREAK_THRESHOLD) {
    utility -= CONGESTION_CRUSH_PENALTY;
  }
  utility += clamp(0, 1, 1 - resultDistance / 60) * w.resultDistance;
  utility -= resultAngle * w.resultAngle;
  utility += ownerPressure * w.pressureRelief;

  utility -= skippedSimplePenalty(
    "pass", distanceYards, false, context.hasSimpleOption, context.attackingSettings, context.isBuildUp,
  );
  if (context.attackingSettings) {
    const settings = normalizeAttackingSettings(context.attackingSettings);
    if (settings.style === "possession") {
      if (distanceYards <= 20) utility += 0.18;
      if (distanceYards >= AMBITIOUS_MIN_DISTANCE_YARDS) utility -= 0.25;
    } else if (settings.style === "direct") {
      if (progression >= 20 && progression <= 40) utility += 0.22;
    } else if (settings.style === "long-ball") {
      if (distanceYards >= AMBITIOUS_MIN_DISTANCE_YARDS) {
        utility += 0.3 * longBallCapability(owner?.player);
      }
    } else if (settings.style === "wing") {
      const lateral = Math.abs(toYardPoint(teammate).x - PITCH_WIDTH_YARDS / 2);
      if (lateral >= 18) utility += 0.2;
    }
  }
  return utility;
}

// A cross is structurally a delivery INTO an aerial contest, not a
// ground pass -- no lane-obstruction term (a cross goes over defenders,
// not through a ground lane between them), but a bonus for genuinely
// wide starting positions (a "cross" from a central position isn't a
// real delivery) and the receiver's aerial pressure still matters.
export function crossUtility(owner, teammate, opponents, attackingDirection, context = {}) {
  const progression = progressionYards(owner, teammate, attackingDirection);
  const receiverPressure = pressureAt(teammate, opponents);
  const resultDistance = distanceToGoalYards(teammate, attackingDirection);
  const wideness = clamp(0, 1, Math.abs(toYardPoint(owner).x - PITCH_WIDTH_YARDS / 2) / (PITCH_WIDTH_YARDS / 2));
  let utility = 0;
  utility += clamp(-1, 1, progression / 30) * 1.0;
  utility -= receiverPressure * 0.7;
  utility += clamp(0, 1, 1 - resultDistance / 40) * 0.6;
  utility += wideness * 0.5;

  const distanceYards = yardDistance(owner, teammate);
  utility -= skippedSimplePenalty(
    "cross", distanceYards, false, context.hasSimpleOption, context.attackingSettings, context.isBuildUp,
  );
  if (context.attackingSettings) {
    const settings = normalizeAttackingSettings(context.attackingSettings);
    if (settings.style === "wing") utility += 0.25;
  }
  return utility;
}

// Through Ball v1 (2026-08-18) -- see MATCH_LAB_PLAN.md. A real browser
// round reported a teammate breaking forward on a central, onside run
// while the ball owner shot from distance instead of feeding them --
// "Alen Boksic could've waited for him... and delivered it as a through
// ball." Investigating found there was no through-ball CONCEPT at all:
// passUtility() only ever evaluates a teammate's CURRENT position, never
// the space they're running into, so the decision layer had no way to
// recognize "feeding the run" as an option distinct from "passing to
// where they already are" (which would just find them marked/behind the
// play, and correctly scores low). This scores delivery to `targetPoint`
// -- the runner's own intended destination (planAttackerRepositioning()'s
// "run-in-behind" job, generateFreePlayCandidates()'s own only caller) --
// not the runner's current spot. Progression is weighted heavily on
// purpose: a genuine line-breaking ball produces a MUCH bigger forward
// gain than a routine pass, and should read as such.
const THROUGH_BALL_UTILITY_WEIGHTS = {
  progression: 1.8, pressure: 1.2, lane: 1.6, resultDistance: 0.8, resultAngle: 0.4,
};
export function throughBallUtility(owner, targetPoint, opponents, attackingDirection, context = {}) {
  const progression = progressionYards(owner, targetPoint, attackingDirection);
  const targetPressure = pressureAt(targetPoint, opponents);
  const lane = laneObstruction(owner, targetPoint, opponents);
  const resultDistance = distanceToGoalYards(targetPoint, attackingDirection);
  const resultAngle = shotAngleTightness(targetPoint, attackingDirection);
  const w = THROUGH_BALL_UTILITY_WEIGHTS;
  const distanceYards = yardDistance(owner, targetPoint);
  // A genuine line-breaking ball is inherently a good option once it's
  // structurally on the table at all (generateFreePlayCandidates() only
  // ever offers this when planAttackerRepositioning() has independently
  // confirmed a real, onside, race-winning run -- see that function's own
  // claimable() gate) -- a small positive base, not zero, matching
  // holdUtility()'s same "start from a real, non-neutral baseline" shape.
  let utility = 0.15;
  utility += clamp(-1, 1, progression / 30) * w.progression;
  utility -= targetPressure * w.pressure;
  utility -= lane * w.lane;
  if (distanceYards >= AMBITIOUS_MIN_DISTANCE_YARDS) {
    utility -= corridorCongestion(owner, targetPoint, opponents) * 0.7;
  }
  utility += clamp(0, 1, 1 - resultDistance / 45) * w.resultDistance;
  utility -= resultAngle * w.resultAngle;

  const ownHalfThrough = isOwnHalf(owner, attackingDirection);
  utility -= skippedSimplePenalty(
    "through", distanceYards, ownHalfThrough, context.hasSimpleOption, context.attackingSettings, context.isBuildUp,
  );
  if (context.attackingSettings) {
    const settings = normalizeAttackingSettings(context.attackingSettings);
    if (settings.style === "direct") utility += 0.3;
    else if (settings.style === "possession" && ownHalfThrough) utility -= 0.25;
  }
  return utility;
}

// Shot As Projectile v1 (2026-08-27) -- the "genuine target-side-aware
// model" shootingLaneOpenness()'s own comment above flagged as real
// future work, not built there. Deliberately NOT folded into that
// function -- shootingLaneOpenness() stays a pure "is a BODY in my way"
// obstruction check with the keeper excluded (still correct: a keeper
// centered on their own line is doing their job, not a surprise
// obstruction). This answers a genuinely different question: is the
// keeper's OWN positioning, right now, leaving a real side of the frame
// open. Perpendicular distance from the keeper to the shooter's own
// straight line to goal center, normalized by the goal's own half-width
// -- 0 for a keeper sitting dead on that line (perfectly set), up toward
// 1 for one displaced by half the goal's own width or more (a real gap
// to aim at, off their line or genuinely wrong-sided).
function keeperExposureBonus(shooterPoint, keeper, attackingDirection) {
  if (!keeper) return 0;
  const goal = attackingGoalYardPoint(attackingDirection);
  const shooterYard = toYardPoint(shooterPoint);
  const keeperYard = toYardPoint(keeper);
  const dx = goal.x - shooterYard.x;
  const dy = goal.y - shooterYard.y;
  const axisLength = Math.hypot(dx, dy) || 1;
  const lateralYards = Math.abs(
    (keeperYard.x - shooterYard.x) * dy - (keeperYard.y - shooterYard.y) * dx,
  ) / axisLength;
  return clamp(0, 1, lateralYards / (GOAL_WIDTH_YARDS / 2));
}

// `keeper` now genuinely read (Shot As Projectile v1 above) -- see
// shootingLaneOpenness()'s own comment for why it stays excluded from
// THAT specific obstruction check; this is the separate "is their own
// positioning exposed" signal that check was never meant to answer.
export function shootUtility(owner, opponents, keeper, attackingDirection, context = {}) {
  const distanceYards = distanceToGoalYards(owner, attackingDirection);
  const angle = shotAngleTightness(owner, attackingDirection);
  const pressure = pressureAt(owner, opponents);
  const laneOpen = shootingLaneOpenness(owner, opponents, attackingDirection);
  // shotAngleTightness() reads 0 (dead central) for ANY point on the
  // goal's own center line, regardless of how far away it is -- a real
  // 70-yard "shot" from dead center is not actually a good chance just
  // because the angle looks perfect; distance has to suppress the angle
  // bonus too, not only its own term, or a hopeless long-range effort
  // reads as more attractive than it has any business being purely
  // because it happens to be central. rangeRelevance scales the angle
  // term down alongside distance's own -- both fall toward irrelevant
  // together past realistic shooting range.
  const rangeRelevance = clamp(0, 1, 1 - distanceYards / 45);
  let utility = 0;
  utility += clamp(0, 1, 1 - distanceYards / 40) * 1.6;
  // Bugfix (2026-09-03) -- a real reported bug: this used to be
  // `+= (1 - angle) * rangeRelevance * 1.0`, a bonus that merely SHRANK
  // toward zero for a bad angle instead of ever costing anything -- a
  // byline "shot" with a postcard-width goal still scored positively on
  // this term alone. Tightness is now a genuine, real cost.
  utility -= angle * 1.6 * rangeRelevance;
  utility -= pressure * 0.9;
  // An empty lane is only valuable while the goal is realistically in
  // range AND the angle is genuinely playable -- an empty ray to x=50 from
  // the byline is trivially "open" (nobody stands on the touchline), which
  // used to hand a hopeless wide-angle attempt a free bonus for exactly
  // the wrong reason. Sparse rosters otherwise handed every 40-yard
  // attempt a free +0.8 merely because no marker occupied a very narrow
  // goal ray.
  if (angle <= 0.55) {
    utility += laneOpen * 0.8 * rangeRelevance;
  }
  // A small additive term, not a dominant one -- a keeper off their line
  // makes shooting NOW more attractive, it doesn't override distance or
  // real outfield pressure.
  utility += keeperExposureBonus(owner, keeper, attackingDirection) * 0.5 * rangeRelevance;

  // Long-range shooting is a decision affinity, not only an execution
  // attribute. From 22m outward, a player who trusts this part of their
  // game rates the attempt higher; a limited shooter rates it lower. The
  // manager's individual instruction then shifts that same ranking without
  // inventing or deleting a legal shot. At 40m even an elite specialist's
  // balanced score remains below a normal carry, making the attempt rare;
  // "Shoot more" can make it a live choice and "Shoot less" suppresses it.
  const distanceMetres = distanceYards * METRES_PER_YARD;
  const longRangeFactor = clamp(0, 1, (distanceMetres - 22) / 18);
  const speculativeDistance = clamp(
    0,
    1,
    (distanceMetres - ORDINARY_SHOT_RANGE_METRES)
      / (SPECIALIST_SHOT_RANGE_METRES - ORDINARY_SHOT_RANGE_METRES),
  );
  const confidence = longRangeShotConfidence(owner?.player);
  utility -= speculativeDistance * 0.45;
  utility += (confidence - 0.65) * 1.2 * longRangeFactor;
  utility += SHOOTING_INSTRUCTION_BIAS[shootingInstructionFor(owner, context.attackingSettings)]
    * (0.45 + longRangeFactor * 0.55);

  // Style bias (2026-08-25): possession discourages a speculative effort
  // beyond ~25yd, UNLESS canAttemptShot()'s own generous long-range gate
  // already applies (a real specialist) AND the shooter is under real
  // pressure right now -- a rushed release valve under a genuine
  // challenge is not against the possession ethos, a casual pot-shot is.
  if (context.attackingSettings) {
    const settings = normalizeAttackingSettings(context.attackingSettings);
    if (settings.style === "possession" && distanceYards > 25) {
      const ownerPlayer = owner?.player;
      const longShotGenerous = Boolean(ownerPlayer)
        && distanceYards <= 55
        && Math.max(playerAttribute(ownerPlayer, "Long Shots"), playerAttribute(ownerPlayer, "Shooting")) >= 16
        && playerAttribute(ownerPlayer, "Technique") >= 13;
      if (!(longShotGenerous && pressure >= 0.5)) utility -= 0.3;
    }
  }
  return utility;
}

// Progression Contest v1 (2026-08-28) -- a real reported bug: neither
// carryUtility() nor dribbleUtility() ever read Dribbling/Technique, so
// a Dribbling-10 forward with 9 legal passes ranked running with the
// ball identically to a genuine dribbler in the same spot -- there was
// no decision-layer reason for a limited ball-carrier to ever prefer
// the simple pass. This stays a DECISION-layer affinity only: it never
// touches resolveCarry()/resolveDribble() (their own execution-layer
// attribute reads -- Dribbling/Technique/Agility vs the defender's
// Tackling/Strength in the real duel -- are untouched and still decide
// what actually happens once carry/dribble is chosen). 20 is the
// practical attribute ceiling elsewhere in this file (see
// noiseScaleFor()); a maxed Dribbling/Technique player reads ~0 risk, a
// genuine 8-10 rates roughly half.
function progressionRiskFor(player) {
  // No player object at all means no real attribute data to read -- the
  // honest answer is "no adjustment," never an assumed below-average
  // baseline (playerAttribute()'s own fallback for a genuinely missing
  // player reads as a plain 10, which is BELOW a realistic average
  // outfield rating in this project's own scale and silently penalized
  // every attribute-blind geometry caller that never supplied one, a
  // real regression a bare-point spatial-decision fixture caught).
  if (!player) return 0;
  const dribblingRisk = (20 - playerAttribute(player, "Dribbling")) / 20;
  const techniqueRisk = (20 - playerAttribute(player, "Technique")) / 20;
  return clamp(0, 1, dribblingRisk * 0.75 + techniqueRisk * 0.25);
}

// Carry is a transition between two concrete world states, never a reward for
// merely standing in open space. It can now be negative: little progression,
// destination pressure, an obstructed route, and the time spent transporting
// the ball are real opportunity costs. The fixed 6.5 yd/s pace is deliberately
// decision-layer neutral; execution attributes remain in the physical layer.
export function carryUtility(owner, destination, opponents, attackingDirection, context = {}) {
  const gained = progressionYards(owner, destination, attackingDirection);
  const originPressure = pressureAt(owner, opponents);
  const destinationPressure = pressureAt(destination, opponents);
  const obstruction = laneObstruction(owner, destination, opponents);
  const distance = yardDistance(owner, destination);
  const carrySeconds = distance / 6.5;
  const pressureRelief = Math.max(0, originPressure - destinationPressure);
  let utility = clamp(-1, 1, gained / 15) * 1.05
    + pressureRelief * 0.8
    - destinationPressure * 1.3
    - obstruction * 1.15
    - carrySeconds * 0.18;
  const settings = context.attackingSettings ? normalizeAttackingSettings(context.attackingSettings) : null;
  if (settings) {
    if (settings.style === "possession" && pressureRelief > 0) utility += 0.15;
    else if (settings.style === "wing") {
      const lateral = Math.abs(toYardPoint(destination).x - PITCH_WIDTH_YARDS / 2);
      if (lateral >= 20) utility += 0.15;
    }
  }
  // Progression Contest v1 -- see progressionRiskFor()'s own comment. A
  // limited carrier finds running with the ball measurably uglier under
  // real pressure right now (originPressure, not the destination they're
  // hoping to reach); with a genuinely simple pass on, that discomfort
  // is sharper still -- the first thought with 9 outlets is a pass, not
  // a run.
  const risk = progressionRiskFor(owner?.player);
  utility -= risk * (0.4 + 0.8 * originPressure);
  if (context.hasSimpleOption) utility -= 0.45 * risk;
  // On-ball gait + possession stamina v1 (2026-08-31) -- choice-layer
  // affinity ONLY, mirroring (never dictating) determineCarryGait()'s own
  // resolver-side legality reads (hasOpponentAhead()/isOnWing(), that
  // function's own header) -- the RESOLVER still independently decides
  // the real gait once this candidate is chosen. A carry into genuinely
  // open grass should outrank one the defense has already recovered
  // into; a limited dribbler in the final third with a real pass on lays
  // it off rather than trying to shepherd it through traffic alone; a
  // wide player already hugging the touchline gets a nudge toward
  // staying there -- UNLESS the team's own attacking style is already
  // "wing" (that style's own destination bonus just above already covers
  // it; this would double it).
  utility += hasOpponentAhead(owner, opponents, attackingDirection) ? -0.5 : 0.2;
  if (distanceToGoalYards(owner, attackingDirection) <= GAIT_FINAL_THIRD_YARDS && context.hasSimpleOption) {
    utility -= 0.25 * risk;
  }
  if (isOnWing(owner) && settings?.style !== "wing") utility += 0.15;
  // Burst Stamina v1 (2026-08-31) -- choice-layer only, never a resolver
  // RNG change: a genuinely gassed carrier looks up and passes rather
  // than trying to run with it. owner.burst01 is possession-local state
  // (runConstructedPossession()'s own init/drain); absent for a direct
  // resolver/decision call against a hand-built fixture, which correctly
  // reads as a full tank (no penalty).
  if (typeof owner?.burst01 === "number" && owner.burst01 < 0.25) utility -= 0.35;
  return utility;
}

// ---------------------------------------------------------------------------
// Directional Carry Planning -- generateFreePlayCandidates() used to
// offer exactly one "carry" option, always a fixed-distance straight line
// toward the byline (the ORIGINAL carry implementation simply reused
// dribble's own straight-ahead advance function). A real browser round
// caught the direct consequence: a wide attacker in open space just kept
// running to the byline, destroying their own shooting angle, because
// nothing ever considered cutting inside. This evaluates several concrete
// candidate DESTINATIONS -- forward, a diagonal cut inward, a diagonal
// run outward (where the pitch actually allows it), and a shorter
// controlled advance -- each individually scored against the position it
// would actually produce, and returns the single best one.
//
// Fully deterministic, no RNG: carry-DIRECTION planning is a geometry
// question (given this exact setup, which of these concrete destinations
// is objectively best), not a stochastic one -- the noise that makes
// selection imperfect belongs entirely to chooseCandidate()'s top-level
// pass/shoot/carry/dribble choice, keyed off the SAME decisionRandom
// stream already required to stay independent of executionRandom. Adding
// a second, separate random draw in here would both violate that
// boundary and make "identical seed reproduces the identical chosen lane
// and endpoint" (a real acceptance requirement) harder to reason about
// for no benefit -- the direction choice is exactly as reproducible as
// the geometry it's computed from either way.
// ---------------------------------------------------------------------------

const CARRY_FORWARD_YARDS = 10;
const CARRY_SHORT_YARDS = 5;
const CARRY_DIAGONAL_ANGLE_DEGREES = 35;
const CARRY_MIN_MOVEMENT_YARDS = 2;
const CARRY_BYLINE_MARGIN_YARDS = 4;
// A real, reported "shuffling side to side" zigzag -- see
// planCarryDestination()'s own comment on CARRY_CONTINUITY_BONUS below
// for the full explanation.
const CARRY_CONTINUITY_BONUS = 0.45;

// Four concrete destinations in yard space, converted back to the
// caller's 0-100% grid and clamped inside playable bounds (never off the
// edge of the pitch). "Inward"/"outward" are relative to which HALF of
// the pitch the carrier is actually in -- inward always means toward the
// center, outward always means toward the nearer touchline, regardless
// of which side that happens to be. Dead-central positions (no
// meaningful inward/outward distinction) get symmetric left/right
// diagonals instead, so a central carrier can still consider cutting
// either way.
function carryDestinationCandidates(owner, attackingDirection) {
  const ownerYard = toYardPoint(owner);
  const goalSign = attackingDirection === "up" ? -1 : 1;
  const centerX = PITCH_WIDTH_YARDS / 2;
  const nearCenter = Math.abs(ownerYard.x - centerX) < 4;
  const inwardSign = ownerYard.x < centerX ? 1 : -1;

  function destinationFor(angleDegrees, lateralSign, distanceYards, label) {
    const angleRadians = (angleDegrees * Math.PI) / 180;
    const forwardYards = distanceYards * Math.cos(angleRadians);
    const lateralYards = distanceYards * Math.sin(angleRadians) * lateralSign;
    const rawYard = { x: ownerYard.x + lateralYards, y: ownerYard.y + goalSign * forwardYards };
    const clampedYard = { x: clamp(0, PITCH_WIDTH_YARDS, rawYard.x), y: clamp(0, PITCH_LENGTH_YARDS, rawYard.y) };
    return { label, point: fromYardPoint(clampedYard) };
  }

  const candidates = [
    destinationFor(0, 1, CARRY_FORWARD_YARDS, "forward"),
    destinationFor(0, 1, CARRY_SHORT_YARDS, "short"),
  ];
  if (nearCenter) {
    candidates.push(destinationFor(CARRY_DIAGONAL_ANGLE_DEGREES, 1, CARRY_FORWARD_YARDS, "diagonal-right"));
    candidates.push(destinationFor(CARRY_DIAGONAL_ANGLE_DEGREES, -1, CARRY_FORWARD_YARDS, "diagonal-left"));
  } else {
    candidates.push(destinationFor(CARRY_DIAGONAL_ANGLE_DEGREES, inwardSign, CARRY_FORWARD_YARDS, "diagonal-inward"));
    candidates.push(destinationFor(CARRY_DIAGONAL_ANGLE_DEGREES, -inwardSign, CARRY_FORWARD_YARDS, "diagonal-outward"));
  }
  return candidates;
}

// Never let a chosen destination land exactly ON the goal line -- a
// carry that reaches the byline has nowhere left to go and isn't a real
// destination to "carry to," it's just where clamping stopped it.
function keepOffByline(point) {
  const EPSILON_YARDS = 1;
  const yard = toYardPoint(point);
  const adjustedY = clamp(EPSILON_YARDS, PITCH_LENGTH_YARDS - EPSILON_YARDS, yard.y);
  if (adjustedY === yard.y) return point;
  return fromYardPoint({ x: yard.x, y: adjustedY });
}

// Reject criteria and scoring for one candidate destination, evaluated
// against the position it would actually produce -- not the carrier's
// current position (see this section's own header on why that was the
// bug). Reuses shootUtility()/carryUtility()/pressureAt()/laneObstruction()
// AT the destination directly rather than re-deriving equivalent logic,
// so "is this a good place to end up" stays answered by the SAME
// functions everywhere else in this file already answer it with.
function evaluateCarryCandidate(
  destination, ownerPoint, opponents, attackingDirection, attackingSettings, bannedOpponent = null, hasSimpleOption = false,
) {
  const displacementYards = yardDistance(ownerPoint, destination);
  const originAngle = shotAngleTightness(ownerPoint, attackingDirection);
  const destAngle = shotAngleTightness(destination, attackingDirection);
  const angleChange = destAngle - originAngle; // positive = worse (tighter)
  const originDistance = distanceToGoalYards(ownerPoint, attackingDirection);
  const destDistance = distanceToGoalYards(destination, attackingDirection);
  const progression = originDistance - destDistance;
  const originPressure = pressureAt(ownerPoint, opponents);
  const destPressure = pressureAt(destination, opponents);
  const pathObstruction = laneObstruction(ownerPoint, destination, opponents);
  const destYard = toYardPoint(destination);
  const bylineDistanceYards = Math.min(destYard.y, PITCH_LENGTH_YARDS - destYard.y);
  // The IMPROVEMENT in shot quality this carry would buy, not the
  // destination's raw shootUtility() in isolation -- shootUtility()
  // climbs steeply as distance-to-goal shrinks, so scoring the raw
  // destination value would keep rewarding "carry even closer" for its
  // own sake all the way to the byline, never naturally yielding to
  // "you're already in a great spot, just shoot" (a real acceptance
  // requirement, and a real bug caught testing this exact formula: a
  // central attacker a few yards out still scored carrying above
  // shooting, because the destination's absolute shot value alone was
  // large regardless of how much better than NOW it actually was).
  const shootImprovement = shootUtility(destination, opponents, null, attackingDirection)
    - shootUtility(ownerPoint, opponents, null, attackingDirection);
  const destinationCarryValue = carryUtility(
    ownerPoint, destination, opponents, attackingDirection,
    { attackingSettings, hasSimpleOption },
  );

  let rejected = false;
  // Negligible movement -- not a real advance.
  if (displacementYards < CARRY_MIN_MOVEMENT_YARDS) rejected = true;
  // Reaches the byline without enough real progression to justify it.
  if (bylineDistanceYards < CARRY_BYLINE_MARGIN_YARDS && progression < CARRY_MIN_MOVEMENT_YARDS) rejected = true;
  // Materially worsens the shooting angle without compensating space or
  // progression -- an angle-tightness increase this large only survives
  // if it bought real forward ground or genuinely reduced pressure.
  if (angleChange > 0.12 && progression < 4 && (destPressure - originPressure) > -0.1) rejected = true;
  // Moves toward pressure rather than away from or level with it.
  if (destPressure > originPressure + 0.15) rejected = true;
  // Runs through a heavily obstructed path (an opponent essentially on
  // the direct line between here and there).
  if (pathObstruction > 0.7) rejected = true;
  // Progression Contest v1 (2026-08-28) -- pairBanned's own carry
  // fallback must not become a free 10-yard run through/past the exact
  // opponent this owner is banned from re-engaging (see
  // generateFreePlayCandidates()'s own comment: beating a presser was
  // silently unlocking an uncontested carry that just replayed the same
  // progression the pair-ban exists to stop). Legal leftover is carry
  // AWAY from them -- a genuinely obstructed lane through bannedOpponent
  // specifically, or a destination that has actually gone past them
  // toward goal, is rejected; a sideways/backward destination that never
  // engages them again is untouched.
  if (bannedOpponent) {
    const throughBanned = laneObstruction(ownerPoint, destination, [bannedOpponent]) > 0.4;
    const pastBanned = distanceToGoalYards(destination, attackingDirection)
      < distanceToGoalYards(bannedOpponent, attackingDirection);
    if (throughBanned || pastBanned) rejected = true;
  }

  // progression is normalized the same way every other utility in this
  // file normalizes a raw-yard distance term (clamp to a bounded ratio
  // BEFORE applying a weight -- see passUtility()'s own progression
  // term). Using the raw yard figure directly was a real scale bug, not
  // a calibration nuance: a 10-yard carry produced a progression term of
  // 12 on its own, dwarfing shootUtility()'s entire normal range (~0-3.5)
  // -- meaning carry could never lose to shoot regardless of how good
  // the shooting position already was, which is exactly the acceptance
  // failure ("shooting outranks carrying farther") this was caught by.
  const score = destinationCarryValue
    - Math.max(0, angleChange) * 0.9
    + shootImprovement * 0.65
    - clamp(0, 1, 1 - bylineDistanceYards / CARRY_BYLINE_MARGIN_YARDS) * 1.2;

  return { rejected, score, displacementYards };
}

// The single exported entry point -- evaluates every candidate
// destination and returns the best one. Rejected candidates are only
// ever used as a last resort (so a real destination -- never a
// zero-distance stall -- is always returned even from an unusually
// constrained starting position), and the final point is always nudged
// off the goal line if clamping happened to land it exactly there.
// How far a goalkeeper who has released the ball to their own feet will
// actually carry it. A keeper does dribble out of their box -- they do not
// go on a run -- so this is deliberately short: one touch's worth, not the
// 10-yard stride an outfield carrier takes.
const KEEPER_CARRY_MAX_YARDS = 4;

/**
 * Keeps a released keeper's carry short and inside their own defensive
 * third. Two separate limits, because they answer different questions:
 * distance stops a single carry becoming a run, and the third stops a
 * sequence of legal short carries adding up to one anyway.
 *
 * Pure geometry on a point the caller already has -- it does not re-plan,
 * re-score, or veto the carry. A keeper hard against the third's edge
 * simply carries nowhere, and the ordinary utility comparison against
 * their passes then decides what they really do.
 */
function clampKeeperCarry(owner, point, attackingDirection) {
  const ownerYard = toYardPoint(owner);
  const targetYard = toYardPoint(point);
  const dx = targetYard.x - ownerYard.x;
  const dy = targetYard.y - ownerYard.y;
  const distance = Math.hypot(dx, dy);
  let clamped = targetYard;
  if (distance > KEEPER_CARRY_MAX_YARDS) {
    const scale = KEEPER_CARRY_MAX_YARDS / distance;
    clamped = { x: ownerYard.x + dx * scale, y: ownerYard.y + dy * scale };
  }
  // Own defensive third, measured from the goal this player defends.
  const ownGoalYard = defendingGoalYForDirection(attackingDirection) === 0 ? 0 : PITCH_LENGTH_YARDS;
  const thirdEdge = ownGoalYard === 0 ? PITCH_LENGTH_YARDS / 3 : PITCH_LENGTH_YARDS * (2 / 3);
  const beyondThird = ownGoalYard === 0 ? clamped.y > thirdEdge : clamped.y < thirdEdge;
  if (beyondThird) {
    // Turn back, rather than stop dead on the line.
    //
    // Simply clamping y to the edge was the first attempt and it was worse
    // than the bug: a keeper pinned there proposes a carry to where they
    // already stand, over and over -- real wall clock, no movement, which
    // is precisely an orphaned interval (replayHarness.js's own
    // no-orphaned-intervals assertion caught it). A keeper who has run out
    // of room forward turns and takes it back toward their own goal, which
    // is both what actually happens and a real move to author. The lateral
    // component is kept as planned; only the forward one is reversed.
    const forward = clamped.y - ownerYard.y;
    clamped = { x: clamped.x, y: ownerYard.y - forward };
  }
  return fromYardPoint({
    x: clamp(0, PITCH_WIDTH_YARDS, clamped.x),
    y: clamp(0, PITCH_LENGTH_YARDS, clamped.y),
  });
}

export function planCarryDestination(
  owner, opponents, attackingDirection, attackingSettings, bannedOpponent = null, hasSimpleOption = false,
) {
  const evaluated = carryDestinationCandidates(owner, attackingDirection).map((candidate) => ({
    ...candidate,
    ...evaluateCarryCandidate(
      candidate.point, owner, opponents, attackingDirection, attackingSettings, bannedOpponent, hasSimpleOption,
    ),
  }));
  // Directional continuity (2026-08-19) -- a real browser round reported
  // a long run visibly shuffling side to side instead of committing to a
  // direction. Root cause: every SEPARATE carry action re-picks its own
  // direction from scratch (this function has no memory of the last
  // one), and in open, roughly symmetric space -- no opponents nearby to
  // meaningfully break a tie via pressure/obstruction -- two near-
  // mirror-image diagonal candidates can score close enough that a tiny
  // positional delta between consecutive carries flips which one "wins."
  // `owner.lastCarryDirectionX/Y` (a real unit vector, set by the
  // resolver after each successful carry/dribble-advance -- see
  // resolveCarry()'s own comment; absent for a first carry, or for any
  // direct call that isn't the real possession loop) gets read here,
  // never written -- this function stays a pure read, same as every
  // other geometry function in this file. A candidate whose OWN
  // direction closely matches the previous one gets a modest scoring
  // bonus -- enough to break a near-tie in favor of continuing the same
  // run, never enough to override a genuinely better option (a real
  // defender closing the previous lane already lowers that candidate's
  // own score directly, through the normal pressure/obstruction terms
  // above).
  if (Number.isFinite(owner.lastCarryDirectionX) && Number.isFinite(owner.lastCarryDirectionY)) {
    const ownerYard = toYardPoint(owner);
    for (const candidate of evaluated) {
      const destYard = toYardPoint(candidate.point);
      const dx = destYard.x - ownerYard.x;
      const dy = destYard.y - ownerYard.y;
      const length = Math.hypot(dx, dy) || 1;
      const alignment = (dx / length) * owner.lastCarryDirectionX + (dy / length) * owner.lastCarryDirectionY;
      candidate.score += Math.max(0, alignment) * CARRY_CONTINUITY_BONUS;
    }
  }
  const viable = evaluated.filter((candidate) => !candidate.rejected);
  const movable = evaluated.filter((candidate) => candidate.displacementYards >= CARRY_MIN_MOVEMENT_YARDS);
  // While banned from a specific opponent, an unusually constrained
  // starting position no longer falls back to "the least-bad rejected
  // destination" -- that fallback is exactly how a through/past-the-
  // banned-opponent carry used to sneak back in as "the only option
  // left." No legal destination away from them means no carry candidate
  // at all this decision (generateFreePlayCandidates() drops it and
  // leans on the pass/shoot options that already exist instead).
  const pool = viable.length ? viable : (bannedOpponent ? [] : (movable.length ? movable : evaluated));
  if (!pool.length) return null;
  let best = pool[0];
  for (const candidate of pool) if (candidate.score > best.score) best = candidate;
  return { point: keepOffByline(best.point), label: best.label, utility: best.score };
}

// ---------------------------------------------------------------------------
// Touch subdivision -- see MATCH_LAB_PLAN.md, "Touches Per Carry"
// (2026-08-18), replaced by Ground Roll v2 (2026-08-28). A carry/dribble
// previously reached its destination in ONE resolved touch regardless of
// distance -- a real player touches the ball repeatedly while running
// with it.
//
// Ground Roll v1 got the CAUSALITY backwards: it pre-beaded a straight
// line to the already-decided carry destination, THEN solved BACKWARD for
// the launch speed that would land exactly on each bead -- friction only
// ever explained a distance that was already chosen some other way, and
// the ball's own trajectory was never anything but the same segment the
// player's own moveFrom/moveTo already walked, so the renderer's
// atFeet/controlled-ground path always parented it to the player's own
// dot. v2 (simulateCarryTouches(), below) runs the causality the other
// way, same as a struck pass: an impulse is decided FIRST (gait +
// Dribbling + Technique + pressure, touchLaunchSpeedYps() --
// playerKinetics.js), the ball ROLLS independently under real turf
// friction (ballRollPhysics.js), and the carrier chases it tick by tick
// (same 40ms cadence earliestReachableInterception() already uses)
// until they physically close the gap -- or, for a genuinely heavy touch
// under pressure, don't. Touch 2 is only ever simulated from touch 1's
// own REAL meet point, never a pre-planned line. planCarryDestination()
// still owns the carry's own tactical endpoint -- that's the PLAYER's
// running job, never the ball's itinerary.
// ---------------------------------------------------------------------------

const AVERAGE_KINETICS_PLAYER = Object.freeze({
  current_ability: 100,
  attributes: Object.freeze([
    Object.freeze({ label: "Dribbling", value: 10 }),
    Object.freeze({ label: "Technique", value: 10 }),
  ]),
});

function deterministicSignedUnit(seed, index, channel) {
  return (hashString(`${seed}:${channel}:${index}`) / 0xffffffff) * 2 - 1;
}

// On-ball gait + possession stamina v1 (2026-08-31) -- a real reported
// bug: the old ternary (pressure>0.35 -> nimble, else anyone within
// AWARENESS_RADIUS_YARDS(25) -> jog, else sprint) named "sprint" for
// ANY open moment, including a packed defensive half where nobody
// happened to be within 25 real yards -- a striker deep in his own
// third with the play elsewhere "sprinted" exactly like a genuine
// break in behind. Four geometry-driven gaits now, not a pressure
// dice roll: full-sprint is legal ONLY with real grass ahead (nobody
// goal-side within GAIT_AHEAD_RADIUS_YARDS) AND real stamina AND not
// already in the final third (a box sprint into a packed area is not
// a counter-attack); controlled-sprint needs a genuinely open lane
// forward; lateral-control is the touchline-hugging read a pressure
// number alone could never express; close-control is the ever-legal
// default, and what the final third collapses to even when nobody is
// close (see effectiveCarryPressure()'s own header for why that's
// still genuinely hard).
const GAIT_AHEAD_RADIUS_YARDS = 18;
const GAIT_WING_MARGIN_YARDS = 12;
const GAIT_FINAL_THIRD_YARDS = 40;
const GAIT_LANE_AHEAD_YARDS = 10;
const GAIT_LANE_OBSTRUCTION_MAX = 0.45;
const GAIT_FULL_SPRINT_STAMINA_MIN = 0.35;
// Bugfix slice (2026-09-02) -- a real reported bug: on a genuinely empty pitch
// (an 11v0 breakaway, or just nobody left between the carrier and goal),
// hasOpponentAhead() is vacuously false forever, so the ONLY thing standing
// between a fast player and full-sprint is this floor -- and the on-ball
// burst economy (drainOnBallAction(), match-lab.js) never refills between a
// player's own consecutive carries, so two full-sprint carries alone can
// legitimately burn a striker from ~85% to ~34% with nobody actually
// contesting him. Deliberately still ABOVE GAIT_CONTROLLED_SPRINT_STAMINA_MIN
// (0.18) -- full-sprint keeps needing a little more gas than
// controlled-sprint even with the whole pitch clear, preserving the existing
// gait ladder's own ordering; this only relaxes the floor, never removes it
// (a genuinely exhausted player, burst below even this, still gets denied).
const GAIT_FULL_SPRINT_STAMINA_MIN_EMPTY = 0.20;
const GAIT_CONTROLLED_SPRINT_STAMINA_MIN = 0.18;

// A point GAIT_LANE_AHEAD_YARDS in front of `point`, toward the goal
// `attackingDirection` attacks -- the same goalSign convention every
// other forward-point helper in this file already uses (see
// carryDestinationCandidates()'s own destinationFor()).
function pointAheadYards(point, attackingDirection, yards) {
  const yard = toYardPoint(point);
  const goalSign = attackingDirection === "up" ? -1 : 1;
  return fromYardPoint({
    x: yard.x,
    y: clamp(0, PITCH_LENGTH_YARDS, yard.y + goalSign * yards),
  });
}

// "More along the touchline than toward goal" -- a real, if coarse,
// lateral-vs-forward split for a chosen destination, used only as the
// lateral-control fallback for a defender on the wing (an
// attacker/midfielder there is legal regardless, see determineCarryGait()).
function isMoreLateralThanForward(from, to) {
  const fromYard = toYardPoint(from);
  const toYard = toYardPoint(to);
  return Math.abs(toYard.x - fromYard.x) > Math.abs(toYard.y - fromYard.y);
}

// Shared by determineCarryGait() and the choice-layer gait affinity
// terms in carryUtility()/dribbleUtility() below -- "is anyone genuinely
// goal-side of the owner, close enough to matter" and "is the owner
// hugging a touchline" are the SAME two geometric questions in both
// places; computing them once here keeps the resolver's actual gait
// pick and the decision layer's own expectation of it from silently
// drifting apart.
function hasOpponentAhead(owner, opponents, attackingDirection) {
  const outfieldOpponents = (opponents || []).filter((opponent) => opponent?.role !== "keeper");
  const ownerGoalDistance = distanceToGoalYards(owner, attackingDirection);
  return outfieldOpponents.some((opponent) =>
    yardDistance(owner, opponent) <= GAIT_AHEAD_RADIUS_YARDS
    && distanceToGoalYards(opponent, attackingDirection) < ownerGoalDistance);
}
function isOnWing(point) {
  const yard = toYardPoint(point);
  return yard.x <= GAIT_WING_MARGIN_YARDS || yard.x >= PITCH_WIDTH_YARDS - GAIT_WING_MARGIN_YARDS;
}

// `destination` is optional -- every existing caller that omits it (a
// direct unit test, a call with no planned destination yet) still gets
// a real answer; it only ever WIDENS lateral-control's own legality for
// a defender specifically (see isMoreLateralThanForward()'s own
// comment), never narrows anything else. `stamina01` defaults to 1 (full
// tank) so a caller that hasn't wired up the possession stamina battery
// (most direct tests) sees the same "stamina never limits anything"
// behavior the old ternary always had.
export function determineCarryGait(owner, opponents, attackingDirection, stamina01 = 1, destination = null) {
  const outfieldOpponents = (opponents || []).filter((opponent) => opponent?.role !== "keeper");
  const ahead = hasOpponentAhead(owner, opponents, attackingDirection);
  const wing = isOnWing(owner);
  const stamina = clamp(0, 1, Number(stamina01));

  const laneAhead = laneObstruction(owner, pointAheadYards(owner, attackingDirection, GAIT_LANE_AHEAD_YARDS), outfieldOpponents)
    < GAIT_LANE_OBSTRUCTION_MAX;
  const controlledSprintLegal = laneAhead && stamina >= GAIT_CONTROLLED_SPRINT_STAMINA_MIN && !wing;

  // Final-Third Situational Gait v1 (2026-08-31) -- user, a real
  // correction to this file's own prior "final third always collapses"
  // rule: "it shouldn't be a fact that we set here. These should be
  // situational things." A box sprint into a genuinely packed area was
  // never realistic, but the OLD fix baked that in as a blanket distance
  // check that fired even when the picture was actually wide open (a
  // clean breakaway with only the keeper back). hasOpponentAhead()/
  // laneObstruction() below already answer the real question directly --
  // is there a genuine body between here and goal -- and in practice
  // defenders cluster near their own goal anyway, so a crowded box still
  // reads as crowded without a separate hardcoded distance rule; a
  // genuinely empty final third now correctly stays legal for a real
  // sprint. effectiveCarryPressure()'s own final-third floor (below,
  // unchanged) still makes an ACTUAL close-control touch genuinely harder
  // to pull off under real pressure there -- that mechanism was always
  // situational (gated on the chosen gait AND real pressure), never a
  // blanket override, and stays exactly as it was.
  // Bugfix slice -- outfieldOpponents is already built above for the lane
  // check; a genuinely empty pitch (nobody left to contest this carry at
  // all, not just nobody within the ahead-radius) gets the relaxed floor.
  const fullSprintFloor = outfieldOpponents.length === 0 ? GAIT_FULL_SPRINT_STAMINA_MIN_EMPTY : GAIT_FULL_SPRINT_STAMINA_MIN;
  const fullSprintLegal = !ahead && stamina >= fullSprintFloor;
  if (fullSprintLegal) return "full-sprint";
  if (controlledSprintLegal) return "controlled-sprint";

  const lateralLegal = wing
    && (classifyOutfieldBand(owner?.player) !== "defender"
      || (destination && isMoreLateralThanForward(owner, destination)));
  if (lateralLegal) return "lateral-control";

  return "close-control";
}

// Final-Third Close Control v1 (2026-08-31) -- user: "close control may
// happen anywhere, but it will take pressure to pull a successful
// control off in the final third." A 10-dribbler alone in the box with
// nobody within real pressure range used to touch as cleanly as one in
// the middle third with the same emptiness around them -- the area
// itself (crowded box, covering markers just out of PRESSURE_RADIUS_YARDS,
// a keeper sweeping the space) is genuinely hostile even when nobody
// happens to be standing right on top of the ball THIS instant. Floors
// (never lowers) the pressure fed into touchError()/touchLaunchSpeedYps()
// -- Composure shaves the floor down (a composed finisher is less
// rattled by the moment itself), Dribbling/Technique still own the
// actual touch envelope entirely unchanged. Deliberately NOT a second
// success roll (the spec's own explicit instruction) -- the existing
// poke/uncaught-touch paths already are the failure mode; a wilder,
// pressure-inflated touch is simply more likely to trigger either.
const FINAL_THIRD_CLOSE_CONTROL_PRESSURE_FLOOR = 0.45;
export function effectiveCarryPressure(rawPressure, owner, gait, attackingDirection) {
  if (gait !== "close-control") return rawPressure;
  if (distanceToGoalYards(owner, attackingDirection) > GAIT_FINAL_THIRD_YARDS) return rawPressure;
  const composure = playerAttribute(owner?.player, "Composure");
  const floor = FINAL_THIRD_CLOSE_CONTROL_PRESSURE_FLOOR * (1 - composure / 40);
  return Math.max(rawPressure, floor);
}

// Burst Stamina v1 (2026-08-31) -- "topSpeed for THAT player this
// possession: * (0.80 + 0.20 * burst01)." topSpeed()/reachIn()/
// timeToReach() (playerKinetics.js) all read Pace straight off the
// player object -- the ONLY way to fade a single carrier's own physical
// ceiling for the rest of this possession without touching the shared
// roster/database player object (an explicit requirement -- this is
// possession-LOCAL state, same as lastCarryDirectionX/Y) is a real,
// deliberate clone with Pace itself scaled down, used ONLY at the
// specific call sites that build THIS carrier's own movement
// trajectory. playerAttributeEntries() flattens every attribute source
// (attributes/hiddenAttributes/profile.*) into one real array first, so
// the clone's own single `attributes` list is still a complete, correct
// picture for every OTHER attribute read (Dribbling/Technique/Agility/...
// all pass through unchanged) -- only Pace itself is overridden. A full
// tank (burst01>=1) returns the SAME player object, no clone at all --
// the common case (an unfatigued carrier, or any direct test that never
// wired up the battery) costs nothing extra.
const BURST_TOP_SPEED_FLOOR = 0.80;
const BURST_TOP_SPEED_RANGE = 0.20;
export function staminaScaledPlayer(player, burst01) {
  const burst = clamp(0, 1, Number(burst01 ?? 1));
  if (burst >= 1) return player;
  const entries = playerAttributeEntries(player).filter((entry) => entry?.label !== "Pace");
  const scaledPace = playerAttribute(player, "Pace") * (BURST_TOP_SPEED_FLOOR + BURST_TOP_SPEED_RANGE * burst);
  return { ...player, attributes: [...entries, { label: "Pace", value: scaledPace }], hiddenAttributes: [], profile: undefined };
}

// A real body-in-radius contact requires the chaser to have physically
// closed the gap, not just "roughly nearby" -- tighter while the ball is
// still moving (they have to intercept a live target), more forgiving
// once it's already stopped (walking the last stride onto a dead ball).
const CARRY_WALK_ON_RADIUS_YARDS = 2;
const CARRY_TICK_MS = 40;
// A safety bound on the simulation loop itself (a genuinely long, nimble,
// close-control carry can realistically need well over a dozen small
// touches), not a tuned "how many touches should a dribble have" number.
const CARRY_MAX_TOUCHES = 20;
const CARRY_TRAJECTORY_SAMPLES = 6;

// The live race for ONE touch: the ball rolls from `from` toward `aimPoint`
// (the direction the touch was struck in, at full natural reach) under
// GROUND_FRICTION_YPS2, decelerating; the carrier chases along the SAME
// line via reachIn()'s own real accelerate-then-cap curve
// (continuousPositionAtElapsed(), matchMovementTiming.js -- the identical
// primitive every other live race in this project already uses).
//
// Both start together. A positive forward impulse separates the ball and
// the first later zero of signed ball-minus-runner distance is a real touch.
// Do not require a 0.6-yard separation: a skilled runner may keep the ball
// closer while still taking genuine touches at speed. A stopped ball can be
// met later through the runner's physical ETA; nobody is snapped onto it.
// Progression Contest v1 (2026-08-28) -- a real reported bug: a carry's
// ball genuinely rolls independently of its own carrier (that's the
// entire point of Ground Roll v2 above), but nothing ever asked whether
// some OTHER outfield body was standing close enough to that live roll
// to touch it first -- "10 yards of immune rolling," a beaten presser or
// a planted CB simply couldn't contest a carry at all. Checked BEFORE
// the carrier's own catch below: a defender already within real
// standing-tackle range of where the ball ACTUALLY IS gets first look,
// regardless of how close the carrier's own chase happens to be. Purely
// a geometric fact reported back on the touch -- resolveCarry() (match-
// lab.js, which owns random()) is the ONLY place that actually rolls the
// contest itself; this stays exactly as attribute/RNG-free as every
// other geometry helper in this file.
function pokeOpportunity(ballPoint, opponents) {
  if (!opponents || !opponents.length) return null;
  const opponent = nearestWithin(ballPoint, opponents, STANDING_TACKLE_RANGE_YARDS);
  return opponent ? { opponent, point: ballPoint } : null;
}

function simulateOneTouch({ from, aimPoint, player, launchSpeedYps, pokeCandidates = [], initialSpeedYps = 0 }) {
  const naturalStopMs = rollStopDurationMs(launchSpeedYps);
  const steps = Math.max(1, Math.ceil(naturalStopMs / CARRY_TICK_MS));
  // Ball Out of Bounds v1 (2026-09-01) -- computed ONCE, pure geometry:
  // does THIS touch's own straight aim direction cross a touchline/byline
  // at all, and if so, how far (real yards) from `from` until it does.
  // pointAlongMovement()'s own ratio clamp means the roll can never
  // travel past `aimPoint` itself regardless of speed -- so when
  // `aimPoint` sits beyond the pitch edge (a real touch aimed near the
  // line, with the gait's own natural stop distance genuinely reaching
  // it), the roll would otherwise silently continue into that
  // out-of-bounds space. Never team/attacking-direction-aware here (this
  // file stays ability-blind) -- just "does the ball run out"; the
  // caller (resolveCarry()/resolveDribble(), match-lab.js, which DOES
  // know the team) turns exitedPitch into the real restart.
  const exit = findPitchExit(from, aimPoint);
  const exitDistanceYards = exit ? yardDistance(from, exit.point) : null;
  for (let step = 1; step <= steps; step += 1) {
    let tMs = Math.min(naturalStopMs, step * CARRY_TICK_MS);
    // Signed distance is essential: a runner who has passed the ball is
    // not still chasing it. The old absolute gap plus a 0.6-yard separation
    // gate missed close running touches and waited for the roll to stop.
    const gapAt = ms => rollTraveledYards(launchSpeedYps, ms) - reachIn(player, ms / 1000, initialSpeedYps);
    const intercepted = launchSpeedYps > initialSpeedYps && gapAt(tMs) <= 0;
    if (intercepted) {
      let low = 0, high = tMs;
      for (let iteration = 0; iteration < 40; iteration++) {
        const middle = (low + high) / 2;
        if (gapAt(middle) > 0) low = middle; else high = middle;
      }
      tMs = high;
    }
    const traveledYards = rollTraveledYards(launchSpeedYps, tMs);
    if (exitDistanceYards !== null && traveledYards >= exitDistanceYards) {
      return { point: exit.point, atMs: tMs, caught: true, naturalStopMs, exitedPitch: exit };
    }
    const ballPoint = pointAlongMovement(from, aimPoint, traveledYards);
    const poke = pokeOpportunity(ballPoint, pokeCandidates);
    if (poke) {
      return { point: ballPoint, atMs: tMs, caught: true, naturalStopMs, pokeAttempt: { ...poke, atMs: tMs } };
    }
    if (intercepted) return { point: ballPoint, atMs: tMs, caught: true, naturalStopMs };
    // Momentum Continuity v1 -- the carrier's own catch-up race against
    // THIS touch's ball used to always assume a cold start, even mid
    // full-sprint carrying real speed forward from the previous touch --
    // a real, already-running player keeps pace with a touch a fresh
    // sprinter would fall behind on.
    const chaserPoint = continuousPositionAtElapsed({
      from, to: aimPoint, player, elapsedSeconds: tMs / 1000, initialSpeedYps,
    });
    const gapYards = movementDistanceYards(chaserPoint, ballPoint);
    const stopped = tMs >= naturalStopMs - 0.01;
    if (stopped) {
      return { point: ballPoint,
        atMs: Math.max(tMs, timeToReach(player, movementDistanceYards(from, ballPoint), initialSpeedYps) * 1000),
        caught: gapYards <= CARRY_WALK_ON_RADIUS_YARDS, naturalStopMs };
    }

  }
  return {
    point: pointAlongMovement(from, aimPoint, rollStopDistanceYards(launchSpeedYps)),
    atMs: naturalStopMs, caught: false, naturalStopMs,
  };
}

// A real, independent ground-roll trajectory for the ball's own track
// (matchLabPlayback.js's addBallTrajectory()) -- decelerating under
// friction, mode "rolling" throughout (never "controlled-ground": this
// ball has left the foot and is not parented to anyone until the next
// contact). First/last samples are pinned to the exact from/contact
// points (not re-derived from the rounded durationMs), the same
// "endpoints are resolver-owned" discipline buildBallTrajectory()
// (matchBallCore.js) already follows, so a chained multi-touch sequence
// never throws a ball-discontinuity error over floating-point drift.
function buildRollTrajectory(fromPoint, contactPoint, aimPoint, launchSpeedYps, durationMs) {
  const raw = [];
  for (let index = 0; index <= CARRY_TRAJECTORY_SAMPLES; index += 1) {
    const progress = index / CARRY_TRAJECTORY_SAMPLES;
    const traveledYards = rollTraveledYards(launchSpeedYps, durationMs * progress);
    raw.push(pointAlongMovement(fromPoint, aimPoint, traveledYards));
  }
  raw[0] = { ...fromPoint };
  raw[raw.length - 1] = { ...contactPoint };
  const samples = raw.map((position, index) => {
    const progress = index / CARRY_TRAJECTORY_SAMPLES;
    const previous = raw[Math.max(0, index - 1)];
    const next = raw[Math.min(raw.length - 1, index + 1)];
    const elapsedMs = Math.max(1, ((Math.min(raw.length - 1, index + 1)
      - Math.max(0, index - 1)) / CARRY_TRAJECTORY_SAMPLES) * durationMs);
    return {
      progress,
      position: { ...position, height: 0 },
      velocity: { x: (next.x - previous.x) / elapsedMs, y: (next.y - previous.y) / elapsedMs },
      verticalVelocity: 0,
      mode: "rolling",
    };
  });
  return samples;
}

// Attribute-aware INTERMEDIATE contacts, live-simulated one touch at a
// time. Direction is a fresh heading toward `to` recomputed from wherever
// the carrier actually is (a real dribbler continuously corrects toward
// where they're going, rather than compounding drift off a single
// initial line), perturbed by touchError()'s own lateral-error envelope.
// Speed starts with gait + Dribbling + Technique + pressure, bounded by
// the intended touch distance before execution error. The executed impulse
// determines how far each touch travels through rollStopDistanceYards() (or an
// earlier live contact) produces from that speed. Stops when: within one
// touchThreshold() of `to` (close enough to look up), CARRY_MAX_TOUCHES
// is reached, or a touch genuinely goes loose (the ball outran the
// carrier) -- that last case is dropped from the returned list entirely
// rather than reported as a fabricated contact, so a caller that doesn't
// yet consume a mid-carry turnover never receives a physically dishonest
// waypoint.
export function simulateCarryTouches(from, to, gait, {
  player = AVERAGE_KINETICS_PLAYER, pressure = 0, seed = "carry", opponents = [], ignorePokes = false, incomingVelocity = null,
} = {}) {
  const spacing = touchThreshold(player, gait);
  const attribution = kineticsAttribution(player, { gait, pressure });
  const touches = [];
  let cursor = { x: Number(from.x), y: Number(from.y) };
  // Carry the actual direction/speed between touches; the first one reads
  // the incoming authoritative motion record supplied by the resolver.
  let previousCursor = null;
  let startOffsetMs = 0;
  let carrierSpeedYps = 0;
  // Cap: one poke ATTEMPT per carry (this file's own header comment) --
  // once any touch has already surfaced one, later touches stop
  // offering a second look even if the same (or another) opponent is
  // still sitting right on the roll line. A won poke means the carrier
  // genuinely rode the challenge; that shouldn't turn every remaining
  // touch of the same carry into another free roll of the dice.
  let pokeClaimed = false;
  for (let touchIndex = 1; touchIndex <= CARRY_MAX_TOUCHES; touchIndex += 1) {
    if (yardDistance(cursor, to) < spacing) break;
    // Body Avoidance v1 -- aim toward a steering point that clears any
    // opponent standing on the direct line to `to`, not `to` itself, when
    // one is genuinely in the way. Recomputed fresh every touch (same
    // self-correcting convention as the heading itself), so the carrier
    // keeps steering around a defender who's still there, and stops
    // steering the moment the direct line is clear again.
    const aimTarget = carrySteeringWaypoint(cursor, to, opponents) ?? to;
    const cursorYards = toYardPoint(cursor);
    const targetYards = toYardPoint(aimTarget);
    const baseAngle = Math.atan2(targetYards.y - cursorYards.y, targetYards.x - cursorYards.x);
    const envelope = touchError(player, pressure);
    const signedError = deterministicSignedUnit(seed, touchIndex, "angle");
    const angle = baseAngle + (envelope.angleDeg * signedError * Math.PI) / 180;
    // No real strike is ever struck with perfectly identical force twice
    // in a row -- a small, deterministic per-touch variation (seeded, not
    // gameplay RNG) on the impulse itself, same spirit as the angle
    // wobble above, so touch spacing looks human rather than metronomic.
    const forceVariation = deterministicSignedUnit(seed, touchIndex, "force");
    const entryVelocity = previousCursor
      ? velocityAlong(previousCursor, cursor, carrierSpeedYps) : incomingVelocity;
    const headingPoint = fromYardPoint({x:cursorYards.x + Math.cos(angle),y:cursorYards.y + Math.sin(angle)});
    const initialSpeedYps = advanceMotion({from:cursor,intentionTarget:headingPoint,
      player,elapsedMs:0,incomingVelocity:entryVelocity}).entrySpeedYps;
    const nominalLaunch = runningTouchLaunchSpeedYps(player, gait, pressure,
      initialSpeedYps, yardDistance(cursor, aimTarget));
    // Execution changes the forward impulse, not the momentum the player
    // already carries. A high-control player takes shorter touches sooner,
    // rather than being forced to jog behind a cold-start ball every time.
    const launchSpeedYps = initialSpeedYps + (nominalLaunch - initialSpeedYps)
      * envelope.distanceMul * (1 + forceVariation * 0.15);
    const stopDistanceYards = rollStopDistanceYards(launchSpeedYps);
    // Integrate the executed impulse all the way to its natural stop;
    // execution error may carry it beyond the intended steering point.
    const aimDistanceYards = stopDistanceYards;
    const aimPoint = fromYardPoint({
      x: cursorYards.x + Math.cos(angle) * aimDistanceYards,
      y: cursorYards.y + Math.sin(angle) * aimDistanceYards,
    });
    const result = simulateOneTouch({
      from: cursor, aimPoint, player, launchSpeedYps,
      pokeCandidates: pokeClaimed || ignorePokes ? [] : opponents,
      initialSpeedYps,
    });
    if (!result.caught) break;
    if (result.pokeAttempt) pokeClaimed = true;
    // Ball Out of Bounds v1 -- an exiting touch's own point is already the
    // real boundary crossing (findPitchExit()'s own clamp, simulateOneTouch()'s
    // header) -- never re-clamped back onto the pitch here.
    const contactPoint = result.exitedPitch
      ? result.point
      : { x: clamp(0, 100, result.point.x), y: clamp(0, 100, result.point.y) };
    const durationMs = Math.max(40, Math.ceil(result.atMs));
    const ballTrajectory = buildRollTrajectory(cursor, contactPoint, aimPoint, launchSpeedYps, durationMs);
    const chaseMotion = advanceMotion({
      from: cursor, intentionTarget: contactPoint, player, elapsedMs: durationMs, sampleCount: CARRY_TRAJECTORY_SAMPLES,
      incomingVelocity: entryVelocity,
      // A touch point is a waypoint in one continuous run, never a
      // destination the carrier stops at.
      continuesAfter: true,
      // Contact time was solved against this same locomotion curve.
      paceToArrival: false,
    });
    const chaseTrajectory = chaseMotion.trajectory;
    const exitSpeedYps = chaseMotion.exitSpeedYps;
    carrierSpeedYps = exitSpeedYps;
    touches.push({
      ballFrom: { ...cursor },
      ballTo: contactPoint,
      ballTrajectory,
      chaseTrajectory,
      durationMs,
      startOffsetMs,
      // Handed to resolveCarry()/resolveDribble() so the FINAL leg of the
      // same carry starts at the speed this touch genuinely left off at,
      // instead of re-accelerating from rest behind a fresh reaction
      // delay (the other half of the same go-stop-go report).
      entryVelocity,
      exitSpeedYps,
      kinetics: {
        touchIndex, launchSpeedYps, stopDistanceYards,
        naturalStopMs: result.naturalStopMs, attribution,
      },
      pokeAttempt: result.pokeAttempt || null,
      // Ball Out of Bounds v1 -- present only when THIS touch's own real
      // roll crossed a touchline/byline; resolveCarry()/resolveDribble()
      // (match-lab.js) check the LAST touch for this and, when present,
      // classify + terminate instead of continuing the carry.
      exitedPitch: result.exitedPitch || null,
    });
    startOffsetMs += durationMs;
    previousCursor = cursor;
    cursor = contactPoint;
    // Completing the intended advance ends this action even when an errant
    // touch overshoots it. Do not spend twenty touches oscillating around a
    // tactical coordinate that the independent ball has already passed.
    const startYards = toYardPoint(from), destinationYards = toYardPoint(to), currentYards = toYardPoint(cursor);
    const intendedX = destinationYards.x - startYards.x, intendedY = destinationYards.y - startYards.y;
    const progressYardsSquared = (currentYards.x - startYards.x) * intendedX + (currentYards.y - startYards.y) * intendedY;
    if (progressYardsSquared >= intendedX * intendedX + intendedY * intendedY) break;
    // The ball is gone -- no further touches once it's genuinely left
    // the pitch this carry.
    if (result.exitedPitch) break;
  }
  return touches;
}

// Confronting a real defender in duel range -- the resolver's own
// localizedDuel()/resolveEngagement() carry the actual risk; this utility
// only needs to reflect that it's a genuine (not free) progression
// option, modestly valued relative to a clean carry or a good pass.
//
// Fixed a real structural bug (2026-08-18): this previously ignored
// `defender` entirely (`void defender`) and had a GUARANTEED floor of
// 0.25 regardless of how dangerous the actual challenge was -- a
// dribble past a genuinely close, pressing defender scored no worse than
// one past a defender barely inside duel range. Now reads real
// geometric danger (pressureAt(), the same signal every other utility in
// this file already uses) so a tight, high-pressure duel can genuinely
// lose to a safer pass/carry.
//
// Progression Contest v1 (2026-08-28) -- no longer fully ability-blind:
// the SAME progressionRiskFor()/hasSimpleOption affinity carryUtility()
// now applies (see its own header) applies here too -- a limited
// dribbler should rate GOING AT a marker lower, not just carrying past
// open space. WHICH specific defender/attacker attributes decide the
// actual duel outcome still lives entirely in resolveDribble()'s own
// progressionDuel, never here -- this only changes whether going at
// someone looks like a good IDEA in the first place.
export function dribbleUtility(owner, defender, attackingDirection, context = {}) {
  const progression = clamp(0, 1, Math.min(1, (PITCH_LENGTH_YARDS - distanceToGoalYards(owner, attackingDirection)) / PITCH_LENGTH_YARDS));
  const danger = pressureAt(owner, [defender]);
  let utility = 0.2 + progression * 0.5 - danger * 0.6;
  const risk = progressionRiskFor(owner?.player);
  utility -= risk * (0.4 + 0.8 * danger);
  if (context.hasSimpleOption) utility -= 0.45 * risk;
  // On-ball gait + possession stamina v1 -- see carryUtility()'s own
  // matching comment. No full-sprint/ahead term here -- a dribble duel is
  // by definition a marked defender at close range, never the open-grass
  // picture that term is about, and this signature only ever sees that
  // ONE defender, never the full opponents list hasOpponentAhead() needs.
  if (distanceToGoalYards(owner, attackingDirection) <= GAIT_FINAL_THIRD_YARDS && context.hasSimpleOption) {
    utility -= 0.25 * risk;
  }
  const settings = context.attackingSettings ? normalizeAttackingSettings(context.attackingSettings) : null;
  if (isOnWing(owner) && settings?.style !== "wing") utility += 0.15;
  // Burst Stamina v1 -- see carryUtility()'s own matching comment.
  if (typeof owner?.burst01 === "number" && owner.burst01 < 0.25) utility -= 0.35;
  return utility;
}

// ---------------------------------------------------------------------------
// Hold-Up Play v1 -- see MATCH_LAB_PLAN.md (2026-08-18). A real browser
// round asked directly why there's "no such thing as holding the ball
// (stopping and waiting for your teammates to support you there)" -- every
// Free Play decision forced a choice among pass/cross/shoot/dribble/carry,
// with no zero-advance "assess and wait" option at all. `holdUtility()`
// is the decision-layer half of that; resolveHold() (match-lab.js) is the
// execution half, including a genuine Strength-driven shielding contest
// (the user's separately-named "no shielding the ball" request) for when
// holding is actually challenged. Deliberately modest in scale and
// ability-blind here (no attribute reads) -- same v1 principle as every
// other utility in this file: holding is only a SENSIBLE choice to
// consider when real support is genuinely nearby, never a free escape
// from pressure on its own (the actual risk of holding under a real
// challenge lives in resolveHold()'s own shielding duel, not in this
// utility).
// ---------------------------------------------------------------------------

const HOLD_SUPPORT_RADIUS_YARDS = 15;
const HOLD_BASE_UTILITY = -0.25;
const HOLD_SUPPORT_BONUS = 0.55;
const HOLD_PRESSURE_PENALTY = 0.35;
// Engagement Breaker v1 (2026-08-28) -- how close counts as "this specific
// opponent is still right on me," for the repeat-engagement crush below.
const HOLD_REPEAT_ENGAGER_RADIUS_YARDS = 3;
const HOLD_REPEAT_ENGAGER_PENALTY = 9;
// Bugfix slice (2026-09-02) -- see match-lab.js's own congestionTracker
// header: a real reported congested-pile bug (short pass -> hold -> short
// pass -> hold among the same few nearby teammates, engagementHistory's own
// per-player/per-pair bans never catching it since a DIFFERENT player holds
// each time). Once 2+ consecutive short-pass-or-hold actions in a row have
// gone nowhere (net progression under CONGESTION_MIN_PROGRESSION_YARDS),
// crush hold and short-pass utility specifically -- the SAME "penalize the
// convenient option so something else wins by comparison" pattern
// skippedSimplePenalty() already uses, never a fabricated bonus elsewhere.
const CONGESTION_STREAK_THRESHOLD = 2;
// Exported so match-lab.js's own congestionTracker update (the "did this
// decision genuinely count as a short-pass-or-hold stall" question) uses
// the EXACT same thresholds this file's own utility-crush reads, never two
// independently-tuned copies that could drift apart.
export const CONGESTION_SHORT_PASS_YARDS = 12;
export const CONGESTION_MIN_PROGRESSION_YARDS = 8;
const CONGESTION_CRUSH_PENALTY = 6;

// A real reported bug: engagementHistory.lastPair used to be recorded as
// "who made the last hold/dribble/back-to-goal decision" (ownerId) plus
// "who they engaged" (opponentId) -- an ORDERED pair. That correctly
// banned the SAME decision-maker from immediately re-engaging, but a lost
// shield/duel swaps who owns the ball: the winner's very next decision
// has THEM as owner and the original holder as engager, the reverse
// order, which the ordered check never matched -- the exact "roles
// reversed, same two bodies, immediate re-shield" gap a real fuzz test
// caught. A pair is the same contest regardless of which side currently
// has the ball.
function isSamePair(pair, idA, idB) {
  if (!pair) return false;
  return (pair.aId === idA && pair.bId === idB) || (pair.aId === idB && pair.bId === idA);
}

// A real reported bug (2nd fuzz catch): tracking a SINGLE "last pair"
// meant engaging a DIFFERENT opponent in between (a legal back-to-goal
// against someone else, say) overwrote it, silently discarding the
// original pair's own still-active 4-action ban -- an immediate re-
// shield against the FIRST opponent became legal again the moment a
// second, unrelated engagement happened. Each pair now ages out of
// engagementHistory.recentPairs independently; this just asks "is (idA,
// idB) anywhere in the still-active list," regardless of what else has
// been engaged since.
function pairRecentlyEngaged(recentPairs, idA, idB) {
  return Boolean(recentPairs?.some((pair) => isSamePair(pair, idA, idB)));
}

export function holdUtility(owner, teammates, opponents, context = {}) {
  const pressure = pressureAt(owner, opponents);
  const supportArriving = teammates.some((teammate) => yardDistance(owner, teammate) <= HOLD_SUPPORT_RADIUS_YARDS);
  let utility = HOLD_BASE_UTILITY;
  if (supportArriving) utility += HOLD_SUPPORT_BONUS;
  utility -= pressure * HOLD_PRESSURE_PENALTY;
  if (context.attackingSettings) {
    const settings = normalizeAttackingSettings(context.attackingSettings);
    if (settings.style === "possession") utility += 0.15;
  }
  // Engagement Breaker v1 -- a real reported bug: holding against a
  // defender you JUST shielded/dueled, who's still right on top of you,
  // is how the shield/hold wrestling loop kept re-forming even when
  // "hold" wasn't literally chosen twice by the same owner (e.g.
  // ownership just changed hands via a won duel, straight into the same
  // opponent). Holding a guy who is already on you is a genuine last
  // resort once, never a repeatable tactic -- crush it rather than let
  // noisy-argmax roll the dice on it again.
  const recentPairs = context.engagementHistory?.recentPairs;
  if (recentPairs?.length) {
    const stillThere = opponents.find((opponent) => opponent?.id
      && pairRecentlyEngaged(recentPairs, owner.id, opponent.id)
      && yardDistance(owner, opponent) <= HOLD_REPEAT_ENGAGER_RADIUS_YARDS);
    if (stillThere) utility -= HOLD_REPEAT_ENGAGER_PENALTY;
  }
  if ((context.congestionStreak ?? 0) >= CONGESTION_STREAK_THRESHOLD) {
    utility -= CONGESTION_CRUSH_PENALTY;
  }
  return utility;
}

// ---------------------------------------------------------------------------
// Candidate generation -- concrete, individually-scored options (pass to
// player A, pass to player B, shoot, carry, dribble past defender X,
// cross to player Z), never a single generic "pass" weight.
// ---------------------------------------------------------------------------

// A cross only makes sense from a genuinely wide, reasonably advanced
// position -- structural gating (like dribble/carry's engager check),
// not something the utility score alone should have to suppress from an
// unbounded position.
//
// Bug fixed 2026-08-18: this used to gate on distanceToGoalYards() --
// straight-line distance to the GOAL CENTER -- capped at 45 yards. That
// metric conflates width and depth: a genuinely wide player is ALREADY
// 30-38 yards from goal-center purely from the lateral offset, even
// standing right on the byline, so a 45-yard cap left ~10-15 yards of
// pure DEPTH slack unaccounted for. A player 40+ real yards up the pitch
// from the byline (reported bug: Julio Cesar, zone 5, roughly
// midfield-wide, not byline-wide) still passed this check and was offered
// "cross" as a candidate. Real crossing positions are bounded by DEPTH
// from the byline, not distance from the goal's center point.
const CROSS_SOURCE_MAX_DEPTH_YARDS = 35;
function isCrossPosition(owner, attackingDirection) {
  const p = toYardPoint(owner);
  const goal = attackingGoalYardPoint(attackingDirection);
  const lateral = Math.abs(p.x - PITCH_WIDTH_YARDS / 2);
  const depth = Math.abs(p.y - goal.y);
  return lateral > 12 && depth < CROSS_SOURCE_MAX_DEPTH_YARDS;
}

// A cross is a delivery INTO the box, not to a teammate standing
// anywhere on the pitch -- see MATCH_LAB_PLAN.md (2026-08-18). Before this
// fix, "cross" was offered to every teammate regardless of their own
// position (only the crosser's position was checked at all), which is how
// a cross to a teammate standing in the same wide-midfield band as the
// crosser (reported bug: cross from zone 5 to zone 4) was ever generated
// in the first place. A small margin beyond the literal 18x44-yard box is
// kept deliberately -- real crossing targets often arrive just as the ball
// does, a stride or two outside the box, not frozen exactly on its line.
const CROSS_TARGET_BOX_MARGIN_YARDS = 4;
export function isCrossTargetZone(point, attackingDirection) {
  const p = toYardPoint(point);
  const goal = attackingGoalYardPoint(attackingDirection);
  const depth = Math.abs(p.y - goal.y);
  const lateral = Math.abs(p.x - goal.x);
  return depth <= PENALTY_AREA_DEPTH_YARDS + CROSS_TARGET_BOX_MARGIN_YARDS
    && lateral <= (PENALTY_AREA_WIDTH_YARDS / 2) + CROSS_TARGET_BOX_MARGIN_YARDS;
}

export function offsideSnapshotForTarget(groups, target, attackingDirection, restart = null) {
  return buildOffsideSnapshot({
    attacker: target,
    ballPoint: groups.ballState?.position ?? groups.ballPoint ?? groups.owner,
    defenders: defendingPlayers(groups.opponents, groups.keeper),
    attackingDirection,
    restart,
  });
}

// Bugfix (2026-09-03) -- a real reported bug: a byline/box-corner "shot"
// (~28yd, comfortably under the 42yd cap below) was structurally legal with
// zero angle awareness -- the goal was a postcard slit, but distance alone
// waved it through. shootUtility() itself only ever shrinks the angle
// bonus (never treats a bad angle as a real cost -- see its own header),
// so a genuinely hopeless angle could still outscore a sensible cut-back.
// A near-post slash from inside the six (WIDE_ANGLE_BYLINE_DEPTH_YARDS) is
// still a real, legal attempt even at a tight angle -- this only removes a
// genuinely hopeless, FAR-from-goal-line wide-angle attempt from the menu
// outright, never a real close-range one.
const WIDE_ANGLE_TIGHTNESS_THRESHOLD = 0.65;
const WIDE_ANGLE_BYLINE_DEPTH_YARDS = 8;
const METRES_PER_YARD = 0.9144;
const ORDINARY_SHOT_RANGE_METRES = 32;
const SPECIALIST_SHOT_RANGE_METRES = 40;
const EXPOSED_GOAL_SHOT_RANGE_METRES = 50;
const AMBITIOUS_SHOT_KEEPER_ADVANCE_YARDS = 18;
const AMBITIOUS_SHOT_KEEPER_EXPOSURE = 0.65;

const SHOOTING_INSTRUCTION_BIAS = Object.freeze({
  discourage: -0.25,
  balanced: 0,
  encourage: 0.25,
});

export function longRangeShotConfidence(player) {
  if (!player) return 0.5;
  const longShots = Math.max(
    playerAttribute(player, "Long Shots"),
    playerAttribute(player, "Shooting"),
  );
  const technique = playerAttribute(player, "Technique");
  const composure = playerAttribute(player, "Composure");
  return clamp(0, 1, (longShots * 0.65 + technique * 0.2 + composure * 0.15) / 20);
}

export function shootingInstructionFor(owner, attackingSettings = null) {
  if (Object.hasOwn(SHOOTING_INSTRUCTION_BIAS, owner?.shootingInstruction)) {
    return owner.shootingInstruction;
  }
  return normalizeAttackingSettings(attackingSettings).shooting;
}

export function tempoInstructionFor(owner, attackingSettings = null) {
  if (owner?.role === "keeper") return "balanced";
  return ["slow", "balanced", "quick"].includes(owner?.tempoInstruction)
    ? owner.tempoInstruction
    : normalizeAttackingSettings(attackingSettings).tempo;
}

function applyTempoInstruction(candidates, owner, attackingSettings) {
  const tempo = tempoInstructionFor(owner, attackingSettings);
  if (tempo === "balanced") return candidates;
  for (const candidate of candidates) {
    if (tempo === "quick") {
      if (["pass", "through", "cross", "carry", "dribble"].includes(candidate.type)) candidate.utility += 0.08;
      if (candidate.type === "hold") candidate.utility -= 0.24;
    } else {
      if (candidate.type === "hold") candidate.utility += 0.24;
      if (["shoot", "through", "cross", "dribble"].includes(candidate.type)) candidate.utility -= 0.08;
    }
  }
  return candidates;
}

function ambitiousShotHasReward(owner, keeper, attackingDirection) {
  // No placed keeper is a real empty net in Free Play. Otherwise an
  // extreme-range attempt needs something concrete to exploit: a keeper
  // well off the line (including one already rounded), or badly displaced
  // from the shooter's line to goal. Attributes alone do not create that
  // opportunity.
  if (!keeper) return true;
  const goal = attackingGoalYardPoint(attackingDirection);
  const keeperPoint = toYardPoint(keeper);
  const keeperAdvanceYards = Math.abs(keeperPoint.y - goal.y);
  return keeperAdvanceYards >= AMBITIOUS_SHOT_KEEPER_ADVANCE_YARDS
    || keeperExposureBonus(owner, keeper, attackingDirection) >= AMBITIOUS_SHOT_KEEPER_EXPOSURE;
}

// Candidate availability is a role/phase fact, not a utility preference.
// A goalkeeper in possession may distribute to a teammate, but must never
// enter the generic outfield carry/dribble/shoot tree. Long shots are also
// gated structurally in metric football distances: ordinary attempts reach
// 32m, a proven long-range shooter reaches 40m, and only an exposed goal can
// justify asking the same specialist to try from 40-50m.
export function canAttemptShot(owner, attackingDirection, keeper = null) {
  if (owner?.role === "keeper") return false;
  const angle = shotAngleTightness(owner, attackingDirection);
  if (angle > WIDE_ANGLE_TIGHTNESS_THRESHOLD) {
    const goal = attackingGoalYardPoint(attackingDirection);
    const depthToByline = Math.abs(toYardPoint(owner).y - goal.y);
    if (depthToByline > WIDE_ANGLE_BYLINE_DEPTH_YARDS) return false;
  }
  const distanceMetres = distanceToGoalYards(owner, attackingDirection) * METRES_PER_YARD;
  if (distanceMetres <= ORDINARY_SHOT_RANGE_METRES) return true;
  const longShot = Math.max(
    playerAttribute(owner?.player, "Long Shots"),
    playerAttribute(owner?.player, "Shooting"),
  );
  const technique = playerAttribute(owner?.player, "Technique");
  const specialist = longShot >= 16 && technique >= 13;
  if (!specialist) return false;
  if (distanceMetres <= SPECIALIST_SHOT_RANGE_METRES) return true;
  return distanceMetres <= EXPOSED_GOAL_SHOT_RANGE_METRES
    && ambitiousShotHasReward(owner, keeper, attackingDirection);
}

// Real space/pressure, Heading (choice ranking only -- see this file's
// "Attacking-on-the-Ball v2" header), and progression -- what actually
// makes a punt target a good one, none of which is "stands furthest
// forward" on its own.
function puntTargetScore(teammate, owner, opponents, attackingDirection) {
  const pressure = pressureAt(teammate, opponents);
  const heading = playerAttribute(teammate.player, "Heading") / 20;
  const progression = distanceToGoalYards(owner, attackingDirection) - distanceToGoalYards(teammate, attackingDirection);
  return (1 - pressure) * 0.5 + heading * 0.3 + clamp(0, 1, progression / 70) * 0.4;
}

// Keeper Catch & Distribution v1 (2026-08-23) -- while the ball is genuinely
// HELD (in the hands, not merely owned -- see ballState.phase), the only
// legal options are the four real ways a keeper puts a caught ball back
// into play: a short hand throw, a longer hand throw, a punt, or taking a
// touch and releasing it to their own feet. Never a shot, a cross, a
// through ball, or a dribble out of the hands.
//
// `groups`/`attackingSettings` (2026-08-25, Attacking-on-the-Ball v2) --
// see generateFreePlayCandidates()'s own comment on the settings-bag
// contract; `groups` is only ever used for offside filtering here (the
// same buildOffsideSnapshot() plumbing passes already go through), never
// mutated.
export function keeperDistributionCandidates(
  owner, teammates, outfieldOpponents, attackingDirection, groups = null, attackingSettings,
) {
  const candidates = [];
  const settings = normalizeAttackingSettings(attackingSettings);
  const distribution = ["short", "mixed", "long"].includes(owner?.goalkeeperDistribution)
    ? owner.goalkeeperDistribution
    : "mixed";
  // Offside teammates are never legal distribution targets -- hand throw
  // or punt alike (2026-08-25 fix: a real reported screenshot had an
  // offside striker, alone in the opposite half, as the WINNING punt
  // target -- passes already filter this via offsideSnapshotForTarget() in
  // generateFreePlayCandidates(), keeper distribution never did).
  const onsideTeammates = groups
    ? teammates.filter((entry) => !offsideSnapshotForTarget(groups, entry, attackingDirection).isOffside)
    : teammates;
  // A hand throw has a genuinely bounded real range (2026-08-25 -- a real
  // browser round reported a keeper's own "throw" reaching a teammate the
  // length of the pitch, resolved through the same driven-kick pass
  // physics an outfield long ball uses). Both throw candidates below are
  // only ever drawn from teammates actually within KEEPER_THROW_MAX_YARDS
  // -- a punt is the real, unbounded-range option, same as a goal kick.
  const withinThrowRange = onsideTeammates.filter(
    (entry) => yardDistance(owner, entry) <= KEEPER_THROW_MAX_YARDS,
  );
  const simple = hasSimpleOption(owner, onsideTeammates, outfieldOpponents, attackingDirection, groups);
  const context = { attackingSettings: settings, hasSimpleOption: simple, isBuildUp: true };
  const byDistance = [...withinThrowRange].sort(
    (left, right) => yardDistance(owner, left) - yardDistance(owner, right),
  );
  const nearest = byDistance[0];
  if (nearest) {
    candidates.push({
      type: "throw-short", target: nearest, moveTo: null,
      forcedPassType: "throw",
      utility: passUtility(owner, nearest, outfieldOpponents, attackingDirection, context),
    });
  }
  // The most advanced teammate STILL WITHIN THROW RANGE (closest to the
  // goal this side is attacking, not simply whoever stands farthest away)
  // -- a real outlet a keeper could actually reach by hand, not distance
  // for its own sake.
  const advancedInThrowRange = [...withinThrowRange].sort(
    (left, right) => distanceToGoalYards(left, attackingDirection) - distanceToGoalYards(right, attackingDirection),
  )[0];
  if (advancedInThrowRange && advancedInThrowRange.id !== nearest?.id) {
    candidates.push({
      type: "throw-long", target: advancedInThrowRange, moveTo: null,
      forcedPassType: "throw",
      utility: passUtility(owner, advancedInThrowRange, outfieldOpponents, attackingDirection, context),
    });
  }
  // Punt target selection (2026-08-25 rewrite) -- no longer simply
  // "furthest forward" (the reported screenshot's own bug). Ranked by
  // puntTargetScore() -- space/pressure, Heading, progression -- and drawn
  // from the FULL onside teammate list, never just the throw-range pool
  // (a punt is a real kick, unbounded range, same as a goal kick).
  const puntTarget = [...onsideTeammates].sort(
    (left, right) => puntTargetScore(right, owner, outfieldOpponents, attackingDirection)
      - puntTargetScore(left, owner, outfieldOpponents, attackingDirection),
  )[0];
  if (puntTarget) {
    const distanceYards = yardDistance(owner, puntTarget);
    // Genuinely less precise than a throw to the same kind of target --
    // discounted, not forbidden.
    let utility = passUtility(owner, puntTarget, outfieldOpponents, attackingDirection) * 0.85;
    // Build-up's own skipped-simple floor is skipped only in the one exact
    // case the spec calls out: a genuinely maxed-out Long Ball team with
    // every throw-range outlet actually pressed -- otherwise this crush is
    // exactly what stops the keeper-to-striker default.
    const allThrowRangePressed = withinThrowRange.length > 0
      && withinThrowRange.every((entry) => pressureAt(entry, outfieldOpponents) >= SIMPLE_OPTION_MAX_PRESSURE);
    const crushExempt = settings.style === "long-ball" && settings.directness === 5 && allThrowRangePressed;
    if (!crushExempt) {
      utility -= skippedSimplePenalty("punt", distanceYards, false, simple, settings, true);
    }
    if (settings.style === "possession") utility -= 0.35;
    if (settings.style === "long-ball") {
      const platformOk = pressureAt(owner, outfieldOpponents) >= 0.5 || settings.directness >= 4;
      if (platformOk) {
        const heading = playerAttribute(puntTarget.player, "Heading") / 20;
        utility += 0.35 * heading * longBallCapability(owner?.player);
      }
    }
    candidates.push({ type: "punt", target: puntTarget, moveTo: null, utility });
  }
  // Taking a touch and building out from the back is always legal --
  // scores higher with no immediate pressure, lower when an opponent is
  // already closing the keeper down (a real reason to get rid of it
  // instead).
  const pressure = pressureAt(owner, outfieldOpponents);
  candidates.push({
    type: "release-to-feet", target: null, moveTo: null,
    utility: clamp(0, 1, 0.55 - pressure * 0.35),
  });
  for (const candidate of candidates) {
    const short = candidate.type === "throw-short" || candidate.type === "release-to-feet";
    const long = candidate.type === "throw-long" || candidate.type === "punt";
    if (distribution === "short") candidate.utility += short ? 0.28 : long ? -0.2 : 0;
    if (distribution === "long") candidate.utility += long ? 0.28 : short ? -0.2 : 0;
  }
  return candidates;
}

// attackingSettings (2026-08-25, Attacking-on-the-Ball v2) -- an optional
// { style, directness } bag, threaded through to every utility call below
// exactly the way markingSettingsFor() already reaches
// planDefensiveRepositioning() (match-lab.js's own attackingSettingsFor()).
// Also readable off `groups.attackingSettings` for a caller that prefers to
// carry it on the groups object itself. Either omitted: behaves as
// DEFAULT_ATTACKING_SETTINGS (possession, directness 2) -- see this file's
// own "Attacking-on-the-Ball v2" header on why that default is still an
// ACTIVE bug fix (skippedSimplePenalty), not an inert placeholder.
// Joint Passer/Runner Candidate Generation v1 (Stage 3) -- `jointDeps` is
// optional and additive, the same convention every other context argument
// here already uses. Omit it and this function behaves EXACTLY as it did:
// a pass candidate aimed at a teammate's current coordinate. Supply it (the
// real Free Play path in match-lab.js does) and each teammate's single pass
// candidate becomes the best joint (passer, runner, meeting point, delivery)
// idea available for that teammate instead.
//
// Crucially this changes NO candidate's position in the list and adds no
// candidate to it. chooseCandidate() draws exactly one decisionRandom()
// value per candidate, in list order, so a list of a different length or a
// different shape would silently re-key every later draw and break replay.
// One teammate still yields one pass candidate.
export function generateFreePlayCandidates(groups, attackingDirection, attackingSettings, engagementHistory = null, congestionTracker = null, jointDeps = null) {
  const { owner, teammates, opponents, keeper } = groups;
  // Role is authoritative even when a malformed/external caller supplies a
  // keeper in `opponents`. A goalkeeper engagement needs its own one-on-one
  // model; it must never silently become the generic midfield dribble duel.
  const outfieldOpponents = opponents.filter((entry) => entry?.role !== "keeper");
  const candidateGroups = outfieldOpponents === opponents
    ? groups
    : { ...groups, opponents: outfieldOpponents };
  const goalkeeperInPossession = owner?.role === "keeper";
  const settings = normalizeAttackingSettings(attackingSettings || groups.attackingSettings);
  const buildUp = isBuildUpPhase(owner);
  const simple = hasSimpleOption(owner, teammates, outfieldOpponents, attackingDirection, candidateGroups);
  // Bugfix slice (2026-09-02) -- see teammateClutter()'s own header: passing
  // decisions had zero awareness that another teammate stood at/near the
  // intended target. Optional and additive, same convention as every other
  // context field here -- a caller that omits it (every existing direct
  // unit-test call to passUtility()/throughBallUtility()) sees the exact
  // old behavior.
  const context = {
    attackingSettings: settings, hasSimpleOption: simple, isBuildUp: buildUp, engagementHistory, teammates,
    congestionStreak: congestionTracker?.lowProgressionStreak ?? 0,
  };
  // Defaults to holding (distribution-only) when ballState isn't supplied
  // at all -- the safer, historically-correct assumption for any caller
  // that doesn't model hold-state. Only a ballState that EXPLICITLY says
  // otherwise (phase !== "held", set by resolveKeeperReleaseToFeet()'s own
  // heldOverride) unlocks pass/carry.
  const keeperHolding = goalkeeperInPossession
    && (!groups.ballState || groups.ballState.phase === "held");
  if (keeperHolding) {
    return applyTeamInstructionBiases(
      keeperDistributionCandidates(owner, teammates, outfieldOpponents, attackingDirection, candidateGroups, settings),
      owner,
      attackingDirection,
      settings,
    );
  }
  const candidates = [];
  // The joint candidate pool is computed ONCE for the whole decision, not
  // per teammate: meeting points, deliveries, arrival races and offside are
  // all evaluated together so a pass and the run that would make it possible
  // are chosen as one idea. Deterministic and RNG-free -- see
  // passRunCandidates.js's own header.
  // Compatible runner intentions. planAttackerRepositioning() is the SAME
  // vetted off-ball planner that already drives ATT.ADJUST, and the through
  // ball used to be built directly from its run-in-behind job. It is still
  // the source of truth for "who is already running and where," which the
  // joint model needs for two reasons: the pattern-proposed meeting point,
  // and the fact that a player already on a forward run is not standing
  // still when the ball is played.
  const jointAttackerPlan = jointDeps
    ? planAttackerRepositioning(teammates, outfieldOpponents, attackingDirection, {
      ballPoint: { x: owner.x, y: owner.y }, keeper,
    })
    : [];
  const RUNNING_JOBS = new Set(["run-in-behind", "arc-overlap", "run-off-pass", "vacate-pocket"]);
  const runnerIntentions = new Map();
  for (const step of jointAttackerPlan) {
    if (!step?.intentionTarget) continue;
    runnerIntentions.set(step.id, {
      job: step.action,
      point: step.intentionTarget,
      running: RUNNING_JOBS.has(step.action),
    });
  }
  const jointPool = jointDeps
    ? generateJointCandidates({
      patternTargets: runnerIntentions,
      passer: owner,
      teammates,
      opponents: outfieldOpponents,
      keeper: keeper,
      attackingDirection,
      deps: jointDeps,
      defenderLineY: secondLastOpponentLine(
        defendingPlayers(outfieldOpponents, keeper), attackingDirection,
      ).lineY,
      // The existing, already-tuned pass utility, asked about the MEETING
      // POINT rather than the teammate's feet. Nothing tuned is discarded:
      // a current-position meeting point reproduces the old score exactly.
      baseUtilityFor: (runner, point) => passUtility(
        owner, { ...runner, x: point.x, y: point.y, zone: runner.zone },
        outfieldOpponents, attackingDirection, context,
      ),
    })
    : [];
  for (const teammate of teammates) {
    const offside = offsideSnapshotForTarget(candidateGroups, teammate, attackingDirection);
    if (offside.isOffside) continue;
    // One teammate, one pass candidate -- either the best joint idea for
    // them, or (no deps supplied) the historical pass-to-feet.
    const joint = jointPool.length ? bestCandidateForRunner(jointPool, teammate.id) : null;
    candidates.push(joint
      ? {
        type: "pass", target: teammate,
        // moveTo is always the point this candidate evaluated and the
        // passer must actually aim at. That includes current-position: a
        // pass to feet is an explicit football decision, not permission
        // for resolvePass() to replace it with a generic lead point.
        moveTo: joint.intendedPoint,
        utility: joint.utility,
        offside,
        joint,
      }
      : {
        type: "pass", target: teammate, moveTo: null,
        utility: passUtility(owner, teammate, outfieldOpponents, attackingDirection, context),
        offside,
      });
    if (!goalkeeperInPossession && isCrossPosition(owner, attackingDirection)
      && isCrossTargetZone(teammate, attackingDirection)) {
      candidates.push({
        type: "cross", target: teammate, moveTo: null,
        utility: crossUtility(owner, teammate, outfieldOpponents, attackingDirection, context),
        offside,
      });
    }
  }
  if (goalkeeperInPossession) {
    // Released to feet (not held): a real touch is on the ball, so a short
    // carry is a real option alongside the passes just collected above --
    // still never a cross/through/shot/dribble-duel, which stay
    // exclusively an outfield-role option.
    //
    // "Short" was stated here but never enforced (2026-09-06 bugfix). The
    // plan came back from the same unbounded planCarryDestination() an
    // outfield carrier uses, so nothing stopped a released keeper simply
    // choosing carry again every action and running the ball up the pitch.
    // Measured on tools/replay-scenarios/repeated-carry-burst-drain.json: a
    // keeper who claimed the ball on their own goal line dribbled it to
    // y=17.8 -- 89 yards, almost the full length of the pitch -- and the
    // possession never resolved. clampKeeperCarry() below is what actually
    // makes the carry short, and keeps it inside the keeper's own third.
    const plan = planCarryDestination(owner, outfieldOpponents, attackingDirection, settings);
    const keeperTarget = clampKeeperCarry(owner, plan.point, attackingDirection);
    candidates.push({
      type: "carry", target: null,
      moveTo: keeperTarget,
      // A shortened or reversed route must be judged at its actual target.
      // The old forward route's utility otherwise rewards retreat as progress.
      utility: evaluateCarryCandidate(keeperTarget, owner, outfieldOpponents, attackingDirection, settings).score,
    });
    return candidates;
  }
  // Through Ball v1 (2026-08-18) -- reuses planAttackerRepositioning()'s
  // OWN "run-in-behind" job assignment (the same vetted, tested
  // arrival-race gate that already drives ATT.ADJUST off-ball movement)
  // rather than a second, parallel heuristic for "is a teammate genuinely
  // clean through." At most one teammate is ever assigned that job
  // (MAX_LINE_BREAK_RUNNERS), so at most one through-ball candidate is
  // ever offered.
  const attackerPlan = planAttackerRepositioning(teammates, outfieldOpponents, attackingDirection, {
    ballPoint: { x: owner.x, y: owner.y }, keeper,
  });
  const runInBehindJob = attackerPlan.find((step) => step.action === "run-in-behind");
  const runner = runInBehindJob && teammates.find((entry) => entry.id === runInBehindJob.id);
  // Distance cap (2026-08-19) -- a real browser round reported a through
  // ball threaded from one player's own defensive third the ENTIRE length
  // of the pitch to a teammate arriving at the opposite box -- planAttackerRepositioning()'s
  // own run-in-behind job is (correctly) about whether the RUNNER can win
  // their own arrival race, with no concept of whether the CURRENT ball
  // owner could plausibly hit a ball that far at all. A genuine raking
  // through ball is an ambitious, high-skill pass, not a cross-pitch
  // launch -- capped at a real, generous-but-bounded yard figure, the same
  // "reasonable, round, not clinically calibrated" philosophy as
  // canAttemptShot()'s own long-range cap.
  const THROUGH_BALL_MAX_DISTANCE_YARDS = 45;
  // Joint Passer/Runner Candidate Generation v1 (Stage 3) -- a through ball
  // now REQUIRES a real runner and a real meeting point, jointly evaluated.
  // The joint pool has already raced the runner, every defender and the
  // keeper to each candidate meeting point, checked kick-time offside and
  // chosen a credible delivery, so this picks the best genuine run into
  // space rather than trusting the off-ball job alone. Still exactly ONE
  // through candidate, in the same list position as before.
  const jointThrough = jointPool.length ? bestThroughBallCandidate(jointPool) : null;
  if (jointThrough && jointThrough.passDistanceYards <= THROUGH_BALL_MAX_DISTANCE_YARDS) {
    const throughRunner = teammates.find((entry) => entry.id === jointThrough.runnerId) ?? null;
    if (throughRunner) {
      candidates.push({
        type: "through", target: throughRunner, moveTo: jointThrough.intendedPoint,
        utility: throughBallUtility(owner, jointThrough.intendedPoint, outfieldOpponents, attackingDirection, context),
        offside: jointThrough.offside,
        joint: jointThrough,
      });
    }
  } else if (!jointPool.length
    && runner && yardDistance(owner, runInBehindJob.intentionTarget) <= THROUGH_BALL_MAX_DISTANCE_YARDS) {
    // No joint deps supplied (a direct unit-test call): the historical
    // run-in-behind path, unchanged.
    candidates.push({
      type: "through", target: runner, moveTo: runInBehindJob.intentionTarget,
      utility: throughBallUtility(owner, runInBehindJob.intentionTarget, outfieldOpponents, attackingDirection, context),
      offside: runInBehindJob.offside,
    });
  }
  if (canAttemptShot(owner, attackingDirection, keeper)) {
    candidates.push({
      type: "shoot", target: null, moveTo: null,
      utility: shootUtility(owner, outfieldOpponents, keeper, attackingDirection, context),
    });
  }
  // Engagement Breaker v1 (2026-08-28) -- a real reported bug: "hold" was
  // always a legal candidate with no memory of what just happened, so a
  // shield contest (P.HOLD.SHIELD, resolveHold()) that left the SAME two
  // players still close could immediately re-offer "hold" -> another
  // shield -> "hold" again, indefinitely -- "wrestling, not football,"
  // never forced into an actual pass/carry/dribble/shoot. The SAME owner
  // never gets to choose hold twice in a row (deleted outright, not just
  // penalized -- see resolveHold()/duelReaction()'s own separation fix,
  // which is the OTHER half of this: a real contest now also moves both
  // bodies apart, so even a re-offered dribble/hold against the identical
  // opponent is against someone genuinely further away, not the same
  // shared pixel).
  const engager = engagingOpponent(owner, outfieldOpponents);
  // Same pair just contested (shield/duel/back-to-goal) cannot
  // immediately re-engage each other via ANOTHER dribble/back-to-goal --
  // the SAME "no repeat engagement" principle as the hold ban above,
  // scoped to this specific opponent rather than every opponent. A
  // dribble/back-to-goal against a DIFFERENT engager (or once this pair
  // has genuinely separated and someone else has closed in) is unaffected.
  const pairBanned = Boolean(engager) && pairRecentlyEngaged(engagementHistory?.recentPairs, owner.id, engager.id);
  // Progression Contest v1 (2026-08-28) -- a real reported bug: holdUtility()'s
  // own -9 crush only fires within HOLD_REPEAT_ENGAGER_RADIUS_YARDS(3) --
  // deliberately tight, per spec, so it never punishes a genuinely
  // separated pair. But a short carry/dribble-advance can easily leave
  // the SAME recently-beaten opponent between 3 and DUEL_RANGE_YARDS(6)
  // away -- too far to crush, yet still close enough for engagingOpponent()
  // to hand them straight back as `engager`, right back into another
  // P.HOLD.SHIELD with nothing genuinely resolved in between. "hold"
  // against that SAME recently-contested pair is deleted outright here,
  // same treatment as the dribble/back-to-goal ban just below -- a hold
  // against a genuinely different (or no) engager is unaffected.
  const holdBanned = engagementHistory?.consecutiveHoldOwnerId === owner.id || pairBanned;
  if (!holdBanned) {
    // Hold-Up Play v1 (2026-08-18) -- always a real, legal option (no
    // structural gate the way carry/dribble split on engager presence);
    // holdUtility() alone decides whether it's ever actually attractive.
    candidates.push({
      type: "hold", target: null, moveTo: null,
      utility: holdUtility(owner, teammates, outfieldOpponents, context),
    });
  }
  // Back-to-Goal Contest v1 (2026-08-24, Off-Ball v2) -- when the engaging
  // defender sits SQUARELY goal-side of the owner (between them and the
  // goal they're attacking, by a real margin -- not just marginally
  // ahead, which describes almost any ordinary defensive engagement by
  // definition), this is the real geometry of a player holding the ball
  // up with his back to goal -- pin/half-turn/turned, not a generic
  // dribble duel. BACK_TO_GOAL_MIN_GOAL_SIDE_YARDS is what keeps this
  // narrowly scoped to that specific picture; a defender only a yard or
  // two in front (the common case) is still an ordinary dribble duel.
  const backToGoal = engager
    && distanceToGoalYards(owner, attackingDirection) - distanceToGoalYards(engager, attackingDirection)
      >= BACK_TO_GOAL_MIN_GOAL_SIDE_YARDS;
  if (backToGoal && !pairBanned) {
    candidates.push({
      type: "back-to-goal", target: engager, moveTo: null,
      utility: dribbleUtility(owner, engager, attackingDirection, context),
    });
  } else if (engager && !pairBanned) {
    candidates.push({
      type: "dribble", target: engager, moveTo: null,
      utility: dribbleUtility(owner, engager, attackingDirection, context),
    });
  } else {
    // No engager at all, OR the only engager is the SAME pair banned
    // above -- either way, a genuine carry into space (Directional Carry
    // Planning already routes around opponents generally) is the real
    // "play away from the pile" option, not a forced re-engagement.
    // moveTo is the EXACT destination Directional Carry Planning chose --
    // the candidate that wins here carries this point all the way through
    // to resolveCarry(), which must thread it through verbatim rather
    // than recomputing its own endpoint (see that function's own comment).
    //
    // Progression Contest v1 -- pairBanned's own carry is NOT the same
    // free option as "no engager at all": planCarryDestination() is
    // handed the banned opponent explicitly, so a destination that runs
    // through/past THEM specifically is rejected outright (see that
    // function's own comment) rather than quietly substituting an
    // uncontested run for the dribble the pair-ban just took away. If
    // nothing legal survives that, `plan` is null and carry is dropped
    // from this decision entirely -- the real remaining options
    // (pass/shoot) are what's left to choose from, exactly as a real 9-
    // outlet situation demands.
    const plan = planCarryDestination(
      owner, outfieldOpponents, attackingDirection, settings, pairBanned ? engager : null, simple,
    );
    // Never let the pair-ban's own stricter carry search leave a decision
    // with literally nothing legal to choose (chooseCandidate() returns
    // null on an empty list, which the possession loop cannot resolve).
    // hold+pair bans genuinely can collide on the SAME opponent (holding
    // against them records the pair, same as dribble/back-to-goal does --
    // see the write-side comment in runConstructedPossession()), and with
    // no teammates on the pitch at all (a real fixture: two markers, no
    // support) that leaves no pass/shoot/through either. Only in that
    // fully-boxed-in case does an unrestricted carry return as the
    // genuine last resort. A shot beyond the ordinary 32m range does not
    // block this fallback by itself: that made a legal-but-speculative
    // 40m attempt the forced action after a shield. Keep both candidates
    // and let confidence, manager instruction and decision noise decide.
    const shotDistanceMetres = distanceToGoalYards(owner, attackingDirection) * METRES_PER_YARD;
    const onlySpeculativeShots = candidates.length > 0
      && candidates.every((candidate) => (
        candidate.type === "shoot" && shotDistanceMetres > ORDINARY_SHOT_RANGE_METRES
      ));
    const finalPlan = plan
      || ((!candidates.length || onlySpeculativeShots)
        ? planCarryDestination(owner, outfieldOpponents, attackingDirection, settings, null, simple)
        : null);
    if (finalPlan) {
      candidates.push({
        type: "carry", target: null, moveTo: finalPlan.point,
        utility: finalPlan.utility,
      });
    }
  }
  applyTempoInstruction(candidates, owner, settings);
  return applyTeamInstructionBiases(candidates, owner, attackingDirection, settings);
}

// Decision-level KPI for Off-Ball Movement v1. Candidate generation has
// already applied offside and role gates, so each distinct pass target here is
// a genuinely legal option available to the carrier at this exact snapshot.
export function decisionOptionMetrics(candidates, groups, radiusYards = 15) {
  const passTargets = new Set(candidates
    .filter((candidate) => candidate.type === "pass" && candidate.target)
    .map((candidate) => String(candidate.target.id)));
  const nearbyTeammates = groups.teammates.filter((entry) => yardDistance(groups.owner, entry) <= radiusYards).length;
  const nearbyOpponents = groups.opponents
    .filter((entry) => entry?.role !== "keeper" && yardDistance(groups.owner, entry) <= radiusYards).length;
  return {
    legalPassingOptions: passTargets.size,
    pressureAtDecision: pressureAt(groups.owner, groups.opponents),
    localFriendlyCount: 1 + nearbyTeammates,
    localOpponentCount: nearbyOpponents,
    localOverload: 1 + nearbyTeammates - nearbyOpponents,
    radiusYards,
  };
}

// Noisy-argmax selection: real utility plus attribute-scaled noise, then
// pick the highest -- sharper players (high Decisions/Vision/
// Anticipation/Composure) track the true ranking closely; weaker ones
// occasionally pick a lower-utility option (a backward pass into
// pressure, a rushed low-value shot), an emergent "mistake" rather than a
// hand-coded exception. Consumes ONLY decisionRandom -- execution's own
// RNG stream (resolving whatever gets chosen) is untouched, kept
// independently keyed per MATCH_LAB_PLAN.md's existing requirement.
export function chooseCandidate(candidates, player, decisionRandom) {
  if (!candidates.length) return null;
  const noiseScale = noiseScaleFor(player);
  let best = null;
  let bestScore = -Infinity;
  for (const candidate of candidates) {
    const noise = (decisionRandom() - 0.5) * 2 * noiseScale;
    const score = candidate.utility + noise;
    if (score > bestScore) { bestScore = score; best = candidate; }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Defensive Aerial Continuation -- see MATCH_LAB_PLAN.md, "Contact,
// Ownership & Continuation" (2026-08-18). What a defender who has just won
// a header actually does with it: clear long, clear toward the touchline,
// clear behind for a corner, find a teammate, head back to the keeper, or
// bring it under control. Reuses chooseCandidate() above verbatim -- same
// candidate-list-plus-noisy-argmax shape Free Play's own pass/cross/shoot/
// carry/dribble choice already uses, not a second selection mechanism.
//
// Deliberate, EXPLICIT exception to this file's own ability-blind
// principle (see file header): the instruction scoping this decision
// names specific execution attributes (Heading, Passing, Technique)
// alongside the usual perception ones, so the utility terms below read
// them directly. Scoped to ONLY this decision -- not a silent widening of
// the pass/cross/shoot/carry/dribble utilities above, which stay exactly
// as ability-blind as they were.
// ---------------------------------------------------------------------------

const CLEARANCE_LONG_YARDS = 35;
const CLEARANCE_TOUCHLINE_YARDS = 22;
const CLEARANCE_BEHIND_YARDS = 10;

// 0 (no danger) .. 1 (maximum danger) -- how urgent it is for the
// defending side to get rid of the ball right now: real proximity to
// their OWN goal (not the goal the ball's current possessor is attacking
// -- the opposite end) plus real attacking pressure already on the
// contact point. `attackers` is the attacking side's own players;
// `defendingDirection` is the direction the CONTESTING DEFENDER's team
// attacks (state.attackingDirection[team] for their own side) -- their
// own goal is therefore the opposite end.
export function clearanceDanger(contactPoint, attackers, defendingDirection) {
  const ownGoalDirection = defendingDirection === "up" ? "down" : "up";
  const proximity = clamp(0, 1, 1 - distanceToGoalYards(contactPoint, ownGoalDirection) / 40);
  const pressure = pressureAt(contactPoint, attackers);
  return clamp(0, 1, proximity * 0.7 + pressure * 0.5);
}

// Geometric destination for a long/touchline clearance -- forward relative
// to the DEFENDER's own attacking direction (away from their own goal),
// angled toward whichever touchline is nearer. "Behind" flips the forward
// sign entirely (back toward their own goal line -- the ball is being
// deliberately put out of play behind it, not carried anywhere useful).
// Ball Out of Bounds v1 (2026-09-01): deliberately UNclamped -- a genuine
// touchline/behind clearance must be free to actually cross the boundary so
// callers can classify the real exit via classifyPitchExit() instead of an
// assumption baked into which candidate type was chosen.
function clearanceDestinationPoint(contactPoint, defendingDirection, forwardYards, behind) {
  const forwardSign = (defendingDirection === "up" ? -1 : 1) * (behind ? -1 : 1);
  const contactYard = toYardPoint(contactPoint);
  const centerX = PITCH_WIDTH_YARDS / 2;
  const towardTouchSign = contactYard.x < centerX ? -1 : 1;
  const rawYard = {
    x: contactYard.x + towardTouchSign * (forwardYards * 0.3),
    y: contactYard.y + forwardSign * forwardYards,
  };
  return fromYardPoint(rawYard);
}

// Six concrete candidates -- geometry/availability gates which even exist
// (pass-teammate/pass-keeper only offered when a real teammate/keeper is
// actually placed, same "never invent a recipient" rule
// selectTeammateTarget() already follows elsewhere in this file), utility
// blends danger/pressure against the defender's own attributes exactly as
// scoped: Heading favors the two clearance types, Passing/Technique favor
// the two pass options, Technique/Composure favor bringing it under
// control, and Decisions/Composure/Anticipation additionally shape
// chooseCandidate()'s own noise scale (unchanged, read from the SAME
// defenderPlayer passed to it by the caller).
export function generateClearanceCandidates(contactPoint, { attackers, teammates, keeper, defenderPlayer, defendingDirection, danger }) {
  const pressure = pressureAt(contactPoint, attackers);
  const heading = playerAttribute(defenderPlayer, "Heading") / 20;
  const passing = playerAttribute(defenderPlayer, "Passing") / 20;
  const technique = playerAttribute(defenderPlayer, "Technique") / 20;
  const composure = playerAttribute(defenderPlayer, "Composure") / 20;
  const decisions = playerAttribute(defenderPlayer, "Decisions") / 20;

  const candidates = [
    {
      type: "clear-long", target: null,
      moveTo: clearanceDestinationPoint(contactPoint, defendingDirection, CLEARANCE_LONG_YARDS, false),
      utility: 1.0 + danger * 1.3 - pressure * 0.2 + heading * 0.6,
    },
    {
      type: "clear-touchline", target: null,
      moveTo: clearanceDestinationPoint(contactPoint, defendingDirection, CLEARANCE_TOUCHLINE_YARDS, false),
      utility: 0.8 + danger * 1.1 + pressure * 0.1 + heading * 0.4,
    },
    {
      type: "clear-behind", target: null,
      moveTo: clearanceDestinationPoint(contactPoint, defendingDirection, CLEARANCE_BEHIND_YARDS, true),
      utility: 0.3 + danger * 1.6 + pressure * 0.6,
    },
    {
      type: "control", target: null, moveTo: null,
      utility: 0.8 - danger * 1.0 - pressure * 1.1 + technique * 0.9 + composure * 0.5,
    },
  ];
  if (teammates.length) {
    const target = nearestWithin(contactPoint, teammates, AWARENESS_RADIUS_YARDS) || teammates[0];
    candidates.push({
      type: "pass-teammate", target, moveTo: null,
      utility: 1.1 - danger * 0.9 - pressure * 0.7 + passing * 0.8 + decisions * 0.4,
    });
  }
  if (keeper) {
    candidates.push({
      type: "pass-keeper", target: keeper, moveTo: null,
      utility: 0.5 - danger * 0.5 - pressure * 0.6 + passing * 0.4,
    });
  }
  return candidates;
}
