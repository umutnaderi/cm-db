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

import { average, clamp, hashString, isAttacker, isDefender, isMidfielder, playerAttribute } from "./matchEngineCore.js";
import { buildOffsideSnapshot, onsideLineTargetY } from "./matchOffside.js";
import { kineticsAttribution, timeToReach, touchError, touchThreshold } from "./playerKinetics.js";
import {
  fromYardPoint, GOAL_WIDTH_YARDS, PENALTY_AREA_DEPTH_YARDS, PENALTY_AREA_WIDTH_YARDS,
  PITCH_LENGTH_YARDS, PITCH_WIDTH_YARDS, toYardPoint, yardDistance,
} from "./pitchGeometry.js";

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
  toYardPoint, yardDistance,
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
// from the intended target by the real error distance. Clamped to
// playable bounds like every other yard-space destination in this file.
export function deliveryLandingPoint(intendedTarget, accuracyErrorYards, random) {
  if (accuracyErrorYards <= 0) return { x: intendedTarget.x, y: intendedTarget.y };
  const angle = random() * Math.PI * 2;
  const targetYard = toYardPoint(intendedTarget);
  const rawYard = {
    x: targetYard.x + Math.cos(angle) * accuracyErrorYards,
    y: targetYard.y + Math.sin(angle) * accuracyErrorYards,
  };
  const clampedYard = { x: clamp(0, PITCH_WIDTH_YARDS, rawYard.x), y: clamp(0, PITCH_LENGTH_YARDS, rawYard.y) };
  return fromYardPoint(clampedYard);
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
export function pressingTarget(defenderPoint, ballOwnerPoint) {
  const distance = yardDistance(defenderPoint, ballOwnerPoint);
  const advance = Math.min(DEFENDER_MAX_ADVANCE_YARDS, Math.max(0, distance - PRESS_STANDOFF_YARDS));
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
const BACK_LINE_MIN_DEPTH_YARDS = 12;
const BACK_LINE_MAX_DEPTH_YARDS = 28;
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
  return clamp(BACK_LINE_MIN_DEPTH_YARDS, BACK_LINE_MAX_DEPTH_YARDS, ballDepthFromOwnGoal * 0.35);
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

// One decision per defender, every step the ball is live: the SINGLE
// nearest defender to the ball always presses; every other defender
// covers the nearest not-yet-covered attacking teammate -- unless there
// isn't one (a genuinely lone carrier, or simply more defenders than
// attackers left to mark), in which case they press too.
// `attackingTeammates`/`defenders` are plain {id,x,y}-shaped entries;
// returns [{ id, action: "press"|"cover", target: {x,y} }], one per
// defender, already capped to a real per-step advance -- never a
// teleport.
export function planDefensiveRepositioning(ballOwnerPoint, attackingTeammates, defenders, defendingDirection) {
  if (!defenders.length) return [];
  const sorted = [...defenders].sort((a, b) => yardDistance(ballOwnerPoint, a) - yardDistance(ballOwnerPoint, b));
  const [presser, ...others] = sorted;
  const pressingSpot = pressingTarget(presser, ballOwnerPoint);
  const results = [{ id: presser.id, action: "press-ball", target: pressingSpot, intentionTarget: pressingSpot }];
  const uncovered = [...attackingTeammates];
  const backLine = defenders.filter((defender) => classifyOutfieldBand(defender.player) === "defender");
  const slots = backLineSlots(backLine, ballOwnerPoint, defendingDirection);
  for (let index = 0; index < others.length; index += 1) {
    const defender = others[index];
    if (!uncovered.length) {
      // One presser is enough. The first spare compacts goal-side around
      // the ball (a real, active covering job); the rest, if they're
      // genuinely part of the back line, hold their own shape slot
      // instead of also flocking toward the ball -- see backLineSlots()'s
      // own comment.
      const idealSpot = index > 0 && slots.has(defender.id)
        ? slots.get(defender.id)
        : coveringPositionPoint(ballOwnerPoint, defendingDirection, defender.player);
      const target = approachPoint(defender, idealSpot, effortScaledAdvance(DEFENDER_MAX_ADVANCE_YARDS, defender.player));
      results.push({
        id: defender.id, action: index === 0 ? "cover" : "shift-unit",
        target, intentionTarget: idealSpot,
      });
      continue;
    }
    let nearestIndex = 0;
    let nearestDistance = Infinity;
    uncovered.forEach((teammate, index) => {
      const distance = yardDistance(defender, teammate);
      if (distance < nearestDistance) { nearestDistance = distance; nearestIndex = index; }
    });
    const covered = uncovered.splice(nearestIndex, 1)[0];
    // The first supporting defender supplies goal-side cover. The next one
    // screens an actual receiver lane. Remaining defenders mark unique
    // attackers, so no two independent planners unknowingly claim the same
    // job/subject.
    const action = index === 0 ? "cover" : index === 1 ? "screen-lane" : "mark";
    const idealSpot = action === "screen-lane"
      ? screeningPositionPoint(ballOwnerPoint, covered)
      : coveringPositionPoint(covered, defendingDirection, defender.player);
    results.push({
      id: defender.id, action, subjectId: covered.id,
      target: approachPoint(defender, idealSpot, effortScaledAdvance(DEFENDER_MAX_ADVANCE_YARDS, defender.player)),
      intentionTarget: idealSpot,
    });
  }
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
function effortScaledAdvance(baseYards, player) {
  return baseYards * (0.75 + 0.5 * effortQuality(player));
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
  const distance = Math.hypot(dx, dy) || 1;
  return fromYardPoint({
    x: clamp(0, PITCH_WIDTH_YARDS, ball.x + (dx / distance) * SUPPORT_DISTANCE_YARDS),
    y: clamp(0, PITCH_LENGTH_YARDS, ball.y + (dy / distance) * SUPPORT_DISTANCE_YARDS),
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

export function planAttackerRepositioning(attackingTeammates, defenders, attackingDirection, {
  ballPoint = null, keeper = null, previousSupportId = null, previousDropId = null,
} = {}) {
  if (!attackingTeammates.length) return [];
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
  const selectedRunners = new Set(unmarkedOnside.slice(0, MAX_LINE_BREAK_RUNNERS).map((entry) => entry.id));

  const remainingOnside = attackingTeammates.filter((attacker) =>
    !contexts.get(attacker.id)?.isOffside && !selectedRunners.has(attacker.id));
  const supportId = ballPoint && remainingOnside.length
    ? pickWithStickiness(remainingOnside, ballPoint, previousSupportId, ROLE_STICKINESS_MARGIN_YARDS)
    : null;
  const widthId = remainingOnside
    .filter((attacker) => attacker.id !== supportId)
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
  const pinEligible = attackingTeammates.filter((attacker) => {
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

  return attackingTeammates.map((attacker) => {
    const nearestDefender = nearestWithin(attacker, defenders, ATTACKER_MARKED_RADIUS_YARDS);
    const offside = contexts.get(attacker.id);
    let action;
    let idealSpot;
    if (offside?.isOffside) {
      action = "recover-onside";
      idealSpot = { x: attacker.x, y: onsideLineTargetY(offside, ONSIDE_LINE_BUFFER_YARDS) };
    } else if (selectedRunners.has(attacker.id)) {
      action = "run-in-behind";
      idealSpot = clampRunTarget(forwardRunTarget(attacker, attackingDirection), attackingDirection, offside);
    } else if (attacker.id === supportId) {
      action = "support-short";
      idealSpot = supportShortTarget(attacker, ballPoint);
    } else if (attacker.id === widthId && Math.abs(attacker.x - 50) >= 18) {
      action = "hold-width";
      idealSpot = holdWidthTarget(attacker, ballPoint, attackingDirection);
    } else if (nearestDefender) {
      action = "diagonal-inside";
      idealSpot = clampRunTarget(
        findSpaceTargetForAttack(attacker, defenders, attackingDirection, attacker.player), attackingDirection, offside,
      );
    } else if (attacker.id === dropId) {
      action = "drop-deep";
      idealSpot = supportShortTarget(attacker, ballPoint);
    } else {
      action = "pin-last-line";
      idealSpot = clampRunTarget({ x: attacker.x, y: attacker.y }, attackingDirection, offside);
    }
    return {
      id: attacker.id,
      action,
      target: approachPoint(attacker, idealSpot, effortScaledAdvance(ATTACKER_MAX_ADVANCE_YARDS, attacker.player)),
      intentionTarget: idealSpot,
      offside,
      held: action === "pin-last-line" && yardDistance(attacker, idealSpot) < 0.25,
    };
  });
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

export function passUtility(owner, teammate, opponents, attackingDirection) {
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
  utility -= clamp(0, 1, (distanceYards - 15) / 35) * w.distance;
  utility -= lane * w.lane;
  utility += clamp(0, 1, 1 - resultDistance / 60) * w.resultDistance;
  utility -= resultAngle * w.resultAngle;
  utility += ownerPressure * w.pressureRelief;
  return utility;
}

// A cross is structurally a delivery INTO an aerial contest, not a
// ground pass -- no lane-obstruction term (a cross goes over defenders,
// not through a ground lane between them), but a bonus for genuinely
// wide starting positions (a "cross" from a central position isn't a
// real delivery) and the receiver's aerial pressure still matters.
export function crossUtility(owner, teammate, opponents, attackingDirection) {
  const progression = progressionYards(owner, teammate, attackingDirection);
  const receiverPressure = pressureAt(teammate, opponents);
  const resultDistance = distanceToGoalYards(teammate, attackingDirection);
  const wideness = clamp(0, 1, Math.abs(toYardPoint(owner).x - PITCH_WIDTH_YARDS / 2) / (PITCH_WIDTH_YARDS / 2));
  let utility = 0;
  utility += clamp(-1, 1, progression / 30) * 1.0;
  utility -= receiverPressure * 0.7;
  utility += clamp(0, 1, 1 - resultDistance / 40) * 0.6;
  utility += wideness * 0.5;
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
export function throughBallUtility(owner, targetPoint, opponents, attackingDirection) {
  const progression = progressionYards(owner, targetPoint, attackingDirection);
  const targetPressure = pressureAt(targetPoint, opponents);
  const lane = laneObstruction(owner, targetPoint, opponents);
  const resultDistance = distanceToGoalYards(targetPoint, attackingDirection);
  const resultAngle = shotAngleTightness(targetPoint, attackingDirection);
  const w = THROUGH_BALL_UTILITY_WEIGHTS;
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
  utility += clamp(0, 1, 1 - resultDistance / 45) * w.resultDistance;
  utility -= resultAngle * w.resultAngle;
  return utility;
}

// `keeper` is still accepted (and still what makes a placed keeper matter
// for the REAL resolveShoot() outcome downstream) but deliberately unused
// by this DECISION-layer utility itself -- see shootingLaneOpenness()'s
// own comment on why. Kept as a parameter, not dropped, so a future
// target-side-aware model has an obvious place to read it from.
export function shootUtility(owner, opponents, keeper, attackingDirection) {
  void keeper;
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
  utility += clamp(0, 1, 1 - angle) * rangeRelevance * 1.0;
  utility -= pressure * 0.9;
  // An empty lane is only valuable while the goal is realistically in
  // range. Sparse rosters otherwise handed every 40-yard attempt a free
  // +0.8 merely because no marker occupied a very narrow goal ray.
  utility += laneOpen * 0.8 * rangeRelevance;
  return utility;
}

// Carry is a transition between two concrete world states, never a reward for
// merely standing in open space. It can now be negative: little progression,
// destination pressure, an obstructed route, and the time spent transporting
// the ball are real opportunity costs. The fixed 6.5 yd/s pace is deliberately
// decision-layer neutral; execution attributes remain in the physical layer.
export function carryUtility(owner, destination, opponents, attackingDirection) {
  const gained = progressionYards(owner, destination, attackingDirection);
  const originPressure = pressureAt(owner, opponents);
  const destinationPressure = pressureAt(destination, opponents);
  const obstruction = laneObstruction(owner, destination, opponents);
  const distance = yardDistance(owner, destination);
  const carrySeconds = distance / 6.5;
  const pressureRelief = Math.max(0, originPressure - destinationPressure);
  return clamp(-1, 1, gained / 15) * 1.05
    + pressureRelief * 0.8
    - destinationPressure * 1.3
    - obstruction * 1.15
    - carrySeconds * 0.18;
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
function evaluateCarryCandidate(destination, ownerPoint, opponents, attackingDirection) {
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
  const destinationCarryValue = carryUtility(ownerPoint, destination, opponents, attackingDirection);

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
export function planCarryDestination(owner, opponents, attackingDirection) {
  const evaluated = carryDestinationCandidates(owner, attackingDirection).map((candidate) => ({
    ...candidate,
    ...evaluateCarryCandidate(candidate.point, owner, opponents, attackingDirection),
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
  const pool = viable.length ? viable : (movable.length ? movable : evaluated);
  let best = pool[0];
  for (const candidate of pool) if (candidate.score > best.score) best = candidate;
  return { point: keepOffByline(best.point), label: best.label, utility: best.score };
}

// ---------------------------------------------------------------------------
// Touch subdivision -- see MATCH_LAB_PLAN.md, "Touches Per Carry"
// (2026-08-18). A carry/dribble-advance previously reached its destination
// in ONE resolved touch regardless of distance -- a real player touches
// the ball repeatedly while running with it: small, frequent touches
// under real pressure (close control), fewer, bigger touches in open
// space at pace. Fully deterministic, no randomness -- same "geometry
// question, not a stochastic one" principle Directional Carry Planning's
// own header comment already establishes; the ONLY thing this decides is
// how many real waypoints lie between an already-planned origin and
// destination, never a new destination of its own.
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

// Nimble (short, controlled touches) under real pressure; sprint (long,
// space-covering touches) in genuinely open space; jog in between.
// Reuses pressureAt()/AWARENESS_RADIUS_YARDS exactly as every other
// pressure/space read in this file already does -- no new concept, no
// new radius.
export function determineCarryGait(fromPoint, opponents) {
  const pressure = pressureAt(fromPoint, opponents);
  if (pressure > 0.35) return "nimble";
  const nearest = nearestWithin(fromPoint, opponents, AWARENESS_RADIUS_YARDS);
  return nearest ? "jog" : "sprint";
}

// Attribute-aware INTERMEDIATE contacts. The tactical endpoint remains the
// carry planner's decision, but the physical path to it now belongs to the
// carrier: Dribbling controls how close the touches are, Dribbling +
// Technique control the error envelope, and pressure widens that envelope.
// Spacing varies deterministically by seed/index, so it looks human without
// consuming or perturbing the resolver's gameplay RNG stream.
export function planCarryTouches(from, to, gait, {
  player = AVERAGE_KINETICS_PLAYER, pressure = 0, seed = "carry",
} = {}) {
  const spacing = touchThreshold(player, gait);
  const distance = yardDistance(from, to);
  if (distance < spacing) return [];
  const touchCount = Math.max(1, Math.round(yardDistance(from, to) / spacing));
  if (touchCount <= 1) return [];
  const segmentWeights = Array.from({ length: touchCount }, (_, index) => {
    const variation = deterministicSignedUnit(seed, index, "spacing");
    return 1 + variation * 0.22;
  });
  const weightTotal = segmentWeights.reduce((sum, weight) => sum + weight, 0);
  const originYards = toYardPoint(from);
  const destinationYards = toYardPoint(to);
  const direction = {
    x: (destinationYards.x - originYards.x) / distance,
    y: (destinationYards.y - originYards.y) / distance,
  };
  const perpendicular = { x: -direction.y, y: direction.x };
  const envelope = touchError(player, pressure);
  const attribution = kineticsAttribution(player, { gait, pressure });
  const waypoints = [];
  let traversedWeight = 0;
  for (let i = 1; i < touchCount; i += 1) {
    traversedWeight += segmentWeights[i - 1];
    const progress = traversedWeight / weightTotal;
    const along = distance * progress;
    const signedError = deterministicSignedUnit(seed, i, "error");
    const localSegment = distance * (segmentWeights[i - 1] / weightTotal);
    const lateralErrorYards = Math.tan((envelope.angleDeg * signedError * Math.PI) / 180)
      * Math.min(spacing, localSegment) * 0.45;
    const yardPoint = {
      x: originYards.x + direction.x * along + perpendicular.x * lateralErrorYards,
      y: originYards.y + direction.y * along + perpendicular.y * lateralErrorYards,
    };
    const point = fromYardPoint(yardPoint);
    waypoints.push({
      x: clamp(0, 100, point.x),
      y: clamp(0, 100, point.y),
      kinetics: {
        touchIndex: i,
        touchCount,
        thresholdYards: spacing,
        lateralErrorYards,
        attribution,
      },
    });
  }
  return waypoints;
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
// lose to a safer pass/carry -- still ability-blind (no attribute reads
// here; WHICH specific defender/attacker attributes decide the actual
// duel lives in resolveDribble()'s own progressionDuel, not this
// decision-layer utility).
export function dribbleUtility(owner, defender, attackingDirection) {
  const progression = clamp(0, 1, Math.min(1, (PITCH_LENGTH_YARDS - distanceToGoalYards(owner, attackingDirection)) / PITCH_LENGTH_YARDS));
  const danger = pressureAt(owner, [defender]);
  return 0.2 + progression * 0.5 - danger * 0.6;
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

export function holdUtility(owner, teammates, opponents) {
  const pressure = pressureAt(owner, opponents);
  const supportArriving = teammates.some((teammate) => yardDistance(owner, teammate) <= HOLD_SUPPORT_RADIUS_YARDS);
  let utility = HOLD_BASE_UTILITY;
  if (supportArriving) utility += HOLD_SUPPORT_BONUS;
  utility -= pressure * HOLD_PRESSURE_PENALTY;
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

// Candidate availability is a role/phase fact, not a utility preference.
// A goalkeeper in possession may distribute to a teammate, but must never
// enter the generic outfield carry/dribble/shoot tree. Long shots are also
// gated structurally: ordinary players can shoot from normal range, while
// genuinely ambitious distance attempts require both range and technique.
export function canAttemptShot(owner, attackingDirection) {
  if (owner?.role === "keeper") return false;
  const distance = distanceToGoalYards(owner, attackingDirection);
  if (distance <= 42) return true;
  const longShot = Math.max(
    playerAttribute(owner?.player, "Long Shots"),
    playerAttribute(owner?.player, "Shooting"),
  );
  const technique = playerAttribute(owner?.player, "Technique");
  return distance <= 55 && longShot >= 16 && technique >= 13;
}

export function generateFreePlayCandidates(groups, attackingDirection) {
  const { owner, teammates, opponents, keeper } = groups;
  // Role is authoritative even when a malformed/external caller supplies a
  // keeper in `opponents`. A goalkeeper engagement needs its own one-on-one
  // model; it must never silently become the generic midfield dribble duel.
  const outfieldOpponents = opponents.filter((entry) => entry?.role !== "keeper");
  const candidateGroups = outfieldOpponents === opponents
    ? groups
    : { ...groups, opponents: outfieldOpponents };
  const goalkeeperInPossession = owner?.role === "keeper";
  const candidates = [];
  for (const teammate of teammates) {
    const offside = offsideSnapshotForTarget(candidateGroups, teammate, attackingDirection);
    if (offside.isOffside) continue;
    candidates.push({
      type: "pass", target: teammate, moveTo: null,
      utility: passUtility(owner, teammate, outfieldOpponents, attackingDirection),
      offside,
    });
    if (!goalkeeperInPossession && isCrossPosition(owner, attackingDirection)
      && isCrossTargetZone(teammate, attackingDirection)) {
      candidates.push({
        type: "cross", target: teammate, moveTo: null,
        utility: crossUtility(owner, teammate, outfieldOpponents, attackingDirection),
        offside,
      });
    }
  }
  if (goalkeeperInPossession) return candidates;
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
  if (runner && yardDistance(owner, runInBehindJob.intentionTarget) <= THROUGH_BALL_MAX_DISTANCE_YARDS) {
    candidates.push({
      type: "through", target: runner, moveTo: runInBehindJob.intentionTarget,
      utility: throughBallUtility(owner, runInBehindJob.intentionTarget, outfieldOpponents, attackingDirection),
      offside: runInBehindJob.offside,
    });
  }
  if (canAttemptShot(owner, attackingDirection)) {
    candidates.push({
      type: "shoot", target: null, moveTo: null,
      utility: shootUtility(owner, outfieldOpponents, keeper, attackingDirection),
    });
  }
  // Hold-Up Play v1 (2026-08-18) -- always a real, legal option (no
  // structural gate the way carry/dribble split on engager presence);
  // holdUtility() alone decides whether it's ever actually attractive.
  candidates.push({
    type: "hold", target: null, moveTo: null,
    utility: holdUtility(owner, teammates, outfieldOpponents),
  });
  const engager = engagingOpponent(owner, outfieldOpponents);
  if (engager) {
    candidates.push({
      type: "dribble", target: engager, moveTo: null,
      utility: dribbleUtility(owner, engager, attackingDirection),
    });
  } else {
    // moveTo is the EXACT destination Directional Carry Planning chose --
    // the candidate that wins here carries this point all the way through
    // to resolveCarry(), which must thread it through verbatim rather
    // than recomputing its own endpoint (see that function's own comment).
    const plan = planCarryDestination(owner, outfieldOpponents, attackingDirection);
    candidates.push({
      type: "carry", target: null, moveTo: plan.point,
      utility: plan.utility,
    });
  }
  return candidates;
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
function clearanceDestinationPoint(contactPoint, defendingDirection, forwardYards, behind) {
  const forwardSign = (defendingDirection === "up" ? -1 : 1) * (behind ? -1 : 1);
  const contactYard = toYardPoint(contactPoint);
  const centerX = PITCH_WIDTH_YARDS / 2;
  const towardTouchSign = contactYard.x < centerX ? -1 : 1;
  const rawYard = {
    x: clamp(0, PITCH_WIDTH_YARDS, contactYard.x + towardTouchSign * (forwardYards * 0.3)),
    y: clamp(0, PITCH_LENGTH_YARDS, contactYard.y + forwardSign * forwardYards),
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
