import { clamp, playerAttribute } from "./matchEngineCore.js";
import { GOAL_WIDTH_YARDS, PITCH_WIDTH_YARDS, PITCH_LENGTH_YARDS } from "./pitchGeometry.js";
import { movementDistanceYards } from "./matchMovementTiming.js";
import { timeToReach } from "./playerKinetics.js";
import { speedYpsFromVelocity } from "./worldMotion.js";

const skill = (player, ...labels) => labels.reduce((n, label) => n + playerAttribute(player, label), 0) / labels.length;
const depth = (point, direction) => (direction === "up" ? 100 - point.y : point.y) * PITCH_LENGTH_YARDS / 100;
const goal = (direction) => ({ x: 50, y: direction === "up" ? 100 : 0 });

// A nearby defender only supplies cover while still goal-side of the ball;
// a beaten pursuer cannot justify leaving the keeper on his line. That
// pursuer may still pressure the finish, so shot isolation is a separate fact.
export const KEEPER_CLOSE_DOWN_MAX_GOAL_DISTANCE_YARDS = 24;
export const KEEPER_CLOSE_DOWN_MIN_GOAL_ANGLE_DEGREES = 16;
export const KEEPER_CLOSE_DOWN_DEFENDER_RECOVERY_YARDS = 9;
// A keeper standing around the six-yard line is still protecting the goal;
// that routine angle-closing position must not pull a centre-back onto the
// goal line and destroy the defensive/offside line. Goal-line cover becomes
// available only once the keeper has genuinely vacated the goal area, or when
// the ball is already goal-side of a stranded keeper.
export const GOAL_COVER_MIN_KEEPER_DEPTH_YARDS = 10;
export const OUTFIELD_KEEPER_DEPTH_BUFFER_YARDS = 2;
const KEEPER_CLOSE_DOWN_LANE_HALF_WIDTH_YARDS = 3;

const yardPoint = (point) => ({
  x: point.x * PITCH_WIDTH_YARDS / 100,
  y: point.y * PITCH_LENGTH_YARDS / 100,
});

const distanceToSegmentYards = (point, from, to) => {
  const p = yardPoint(point);
  const a = yardPoint(from);
  const b = yardPoint(to);
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!lengthSquared) return Math.hypot(p.x - a.x, p.y - a.y);
  const t = clamp(0, 1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lengthSquared);
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
};

export function keeperGoalMouthAngleDegrees(point, defendingDirection = "down") {
  const p = yardPoint(point);
  const goalPoint = yardPoint(goal(defendingDirection));
  const vertical = Math.max(0.01, Math.abs(p.y - goalPoint.y));
  const halfGoal = GOAL_WIDTH_YARDS / 2;
  return Math.abs(
    Math.atan2(goalPoint.x + halfGoal - p.x, vertical)
      - Math.atan2(goalPoint.x - halfGoal - p.x, vertical),
  ) * 180 / Math.PI;
}

/**
 * Builds the keeper's set/close-down point from the two post-to-ball rays.
 * The target only describes where the keeper wants to set. worldMotion still
 * decides how much ground is reachable before the next contact, and this
 * calculation never changes shot or save probability.
 */
export function keeperAngleManagementPlan({
  keeper, ball, defendingDirection = "down", attackerVelocity = null,
  defenders = [], instruction = "balanced",
} = {}) {
  const ballDepth = depth(ball, defendingDirection);
  const keeperDepth = depth(keeper, defendingDirection);
  const positioning = skill(keeper.player, "Positioning", "Decisions", "Anticipation") / 20;
  const bravery = skill(keeper.player, "Bravery", "Decisions") / 20;
  const attackerSpeed = speedYpsFromVelocity(attackerVelocity);
  const goalSideCover = defenders.some((entry) => depth(entry, defendingDirection) < ballDepth
    && movementDistanceYards(entry, ball) <= 6);
  const instructionDelta = instruction === "aggressive" ? 1.5 : instruction === "cautious" ? -1 : 0;
  const movingThreatDelta = clamp(0, 1.5, attackerSpeed * 0.16);
  const coverDelta = goalSideCover ? -0.8 : 0;
  const desiredDepth = clamp(
    1.5,
    Math.max(1.5, ballDepth - 0.85),
    ballDepth * (0.42 + positioning * 0.11 + bravery * 0.05)
      + instructionDelta + movingThreatDelta + coverDelta,
  );
  const ballYards = yardPoint(ball);
  const leftPostX = (PITCH_WIDTH_YARDS - GOAL_WIDTH_YARDS) / 2;
  const rightPostX = (PITCH_WIDTH_YARDS + GOAL_WIDTH_YARDS) / 2;
  const leftDistance = Math.hypot(ballYards.x - leftPostX, Math.max(0.01, ballDepth));
  const rightDistance = Math.hypot(ballYards.x - rightPostX, Math.max(0.01, ballDepth));
  const bisectorGoalX = (leftPostX * rightDistance + rightPostX * leftDistance)
    / Math.max(0.01, leftDistance + rightDistance);
  const ratio = desiredDepth / Math.max(ballDepth, 0.1);
  const targetYards = {
    x: bisectorGoalX + (ballYards.x - bisectorGoalX) * ratio,
    y: defendingDirection === "up" ? PITCH_LENGTH_YARDS - desiredDepth : desiredDepth,
  };
  const coneWidthAtTarget = GOAL_WIDTH_YARDS * Math.max(0.05, 1 - ratio);
  const bodyCoverageYards = 2.1 + positioning * 0.65;
  return {
    target: {
      x: clamp(0, 100, targetYards.x / PITCH_WIDTH_YARDS * 100),
      y: clamp(0, 100, targetYards.y / PITCH_LENGTH_YARDS * 100),
    },
    ballDepthYards: ballDepth,
    keeperDepthYards: keeperDepth,
    desiredDepthYards: desiredDepth,
    shotAngleDegrees: keeperGoalMouthAngleDegrees(ball, defendingDirection),
    coneWidthAtTargetYards: coneWidthAtTarget,
    estimatedCoverageRatio: clamp(0, 1, bodyCoverageYards / Math.max(0.1, coneWidthAtTarget)),
    goalSideCover,
    lobExposureYards: Math.max(0, desiredDepth - 8),
  };
}

export function assessKeeperCloseDown({ keeper, ball, attacker = null, defenders = [],
  defendingDirection = "down" }) {
  const goalPoint = goal(defendingDirection);
  const goalDistanceYards = movementDistanceYards(ball, goalPoint);
  const shotAngleDegrees = keeperGoalMouthAngleDegrees(ball, defendingDirection);
  const keeperBetween = depth(keeper, defendingDirection) < depth(ball, defendingDirection);
  const nearbyDefender = defenders.find(defender =>
    movementDistanceYards(defender, ball) <= KEEPER_CLOSE_DOWN_DEFENDER_RECOVERY_YARDS);
  const goalSideDefenders = defenders.filter(defender =>
    depth(defender, defendingDirection) < depth(ball, defendingDirection));
  const recoveryDefender = goalSideDefenders.find((defender) =>
    movementDistanceYards(defender, ball) <= KEEPER_CLOSE_DOWN_DEFENDER_RECOVERY_YARDS) ?? null;
  const laneDefender = goalSideDefenders.find((defender) =>
    distanceToSegmentYards(defender, ball, goalPoint) <= KEEPER_CLOSE_DOWN_LANE_HALF_WIDTH_YARDS) ?? null;
  const eligible = Boolean(attacker) && keeperBetween
    && goalDistanceYards <= KEEPER_CLOSE_DOWN_MAX_GOAL_DISTANCE_YARDS
    && shotAngleDegrees >= KEEPER_CLOSE_DOWN_MIN_GOAL_ANGLE_DEGREES
    && !recoveryDefender && !laneDefender;
  return {
    eligible,
    isolated: eligible && !nearbyDefender,
    goalDistanceYards,
    shotAngleDegrees,
    keeperBetween,
    recoveryDefenderId: recoveryDefender?.id ?? null,
    laneDefenderId: laneDefender?.id ?? null,
  };
}

// Decisions propose destinations only. Motion and contact decide whether a
// player gets there. Opponents' hidden Pace/Acceleration are never consulted.
export function planKeeperResponse({ keeper, ball, attacker = null, defenders = [],
  defendingDirection = "down", velocity = null, ballVelocity = null,
  attackerVelocity = null, random = () => 0.5, holdTarget = goal(defendingDirection) }) {
  const awareness = skill(keeper.player, "Anticipation", "Decisions", "Positioning");
  const reactionDelayMs = 100 + (20 - awareness) * 16;
  const errorSeconds = (random() * 2 - 1) * (21 - awareness) * 0.055;
  const ownDepth = depth(keeper, defendingDirection);
  const ballDepth = depth(ball, defendingDirection);
  const base = { action: "set-position", target: { ...holdTarget }, reactionDelayMs,
    perceivedMarginSeconds: null, errorSeconds };
  if (ballDepth < ownDepth - 1 || (!ballVelocity && (ballDepth > 40 || Math.abs(ball.x - 50) > 38))) {
    return { ...base, action: ownDepth > 5 ? "keeper-recover" : "set-position" };
  }
  const attackSpeed = speedYpsFromVelocity(attackerVelocity) || 7;
  const ownSpeed = speedYpsFromVelocity(velocity);
  const boldness = skill(keeper.player, "Bravery", "Decisions") / 20;
  const sweepingInstruction = ["cautious", "balanced", "aggressive"].includes(keeper?.goalkeeperSweeping)
    ? keeper.goalkeeperSweeping
    : "balanced";
  // This is a decision bias only. The ball/attacker arrival race and the
  // physical run still have to succeed, so "aggressive" cannot manufacture
  // a claim and "cautious" does not chain the keeper to the goal line.
  const sweepMarginBias = sweepingInstruction === "aggressive" ? -0.18
    : sweepingInstruction === "cautious" ? 0.2 : 0;
  const angleManagement = keeperAngleManagementPlan({
    keeper, ball, defendingDirection, attackerVelocity, defenders,
    instruction: sweepingInstruction,
  });
  if (ballDepth <= KEEPER_CLOSE_DOWN_MAX_GOAL_DISTANCE_YARDS + 6 && ballDepth >= ownDepth - 1) {
    base.angleManagement = angleManagement;
  }
  if (ballVelocity && Math.abs(ballVelocity.y) > 0.0001) {
    // A bounded extrapolation of the visible ball velocity, not access to
    // the passer's intended receiver or an opponent's true arrival time.
    for (let ms = 200; ms <= 3000; ms += 100) {
      const point = { x: ball.x + ballVelocity.x * ms, y: ball.y + ballVelocity.y * ms };
      const pointDepth = depth(point, defendingDirection);
      if (pointDepth < 0 || pointDepth > 30 || point.x < 0 || point.x > 100) continue;
      const ownEta = reactionDelayMs / 1000 + timeToReach(keeper.player,
        Math.max(0, movementDistanceYards(keeper, point) - 1), ownSpeed);
      const attackerEta = attacker ? movementDistanceYards(attacker, point) / attackSpeed : Infinity;
      const margin = attackerEta - ownEta + errorSeconds;
      if (ownEta <= ms / 1000 + errorSeconds
        && margin > 0.15 - boldness * 0.3 + sweepMarginBias) {
        return { ...base, action: "keeper-sweep", target: point, perceivedMarginSeconds: margin };
      }
    }
    return base;
  }
  const closeDown = assessKeeperCloseDown({ keeper, ball, attacker, defenders, defendingDirection });
  if (!closeDown.eligible) return base;
  if (sweepingInstruction === "cautious"
    && (closeDown.goalDistanceYards > 18 || closeDown.shotAngleDegrees < 20)) return base;
  return { ...base, action: "keeper-close-down", target: angleManagement.target,
    angleManagement };
}

export function chooseGoalCover({ keeper, defenders = [], ball, defendingDirection = "down", keeperAction }) {
  const keeperDepth = depth(keeper, defendingDirection);
  const ballDepth = depth(ball, defendingDirection);
  // `keeper-recover` covers two very different situations: an emergency in
  // which the ball is already goal-side of the keeper, and an ordinary reset
  // because play has moved safely upfield. Only the first exposes the goal.
  // Treating both alike sent a centre-back all the way onto his own goal line
  // whenever the keeper merely returned to position after a harmless phase.
  const urgentRecovery = keeperAction === "keeper-recover"
    && ballDepth < keeperDepth - 1;
  const committedAwayFromGoal = ["keeper-sweep", "keeper-close-down"].includes(keeperAction)
    && keeperDepth >= GOAL_COVER_MIN_KEEPER_DEPTH_YARDS;
  const goalIsExposed = committedAwayFromGoal || urgentRecovery;
  if (!goalIsExposed) return null;
  const goalPoint = goal(defendingDirection);
  const target = { x: clamp(46, 54, 50 + (ball.x - keeper.x) * 0.15),
    y: goalPoint.y + (defendingDirection === "up" ? -1 : 1) * 1.5 / PITCH_LENGTH_YARDS * 100 };
  const candidates = defenders.flatMap((entry) => {
    const awareness = skill(entry.player, "Anticipation", "Decisions", "Teamwork");
    if (movementDistanceYards(entry, keeper) > 12 + awareness * 1.5) return [];
    const reactionDelayMs = 180 + (20 - awareness) * 22;
    const eta = reactionDelayMs / 1000 + timeToReach(entry.player, movementDistanceYards(entry, target));
    // An attainable recovery opportunity, not a guarantee of beating a shot.
    if (eta > 6) return [];
    return [{ id: entry.id, action: "cover-goal", target, reactionDelayMs, arrivalSeconds: eta }];
  });
  candidates.sort((a, b) => a.arrivalSeconds - b.arrivalSeconds || String(a.id).localeCompare(String(b.id)));
  return candidates[0] ?? null;
}

/**
 * Keeps an ordinary outfield destination pitch-side of its own goalkeeper.
 * Emergency `cover-goal` movement deliberately bypasses this rule. Using the
 * farther-forward of the keeper's current and proposed points also stops a
 * defender being stranded behind a keeper who is in the act of advancing.
 */
export function outfieldPositionAheadOfKeeper(
  target,
  keeper,
  keeperTarget = keeper,
  defendingDirection = "down",
  bufferYards = OUTFIELD_KEEPER_DEPTH_BUFFER_YARDS,
) {
  if (!target || !keeper) return target;
  const requiredDepth = Math.max(
    depth(keeper, defendingDirection),
    depth(keeperTarget ?? keeper, defendingDirection),
  ) + Math.max(0, bufferYards);
  if (depth(target, defendingDirection) >= requiredDepth) return target;
  const depthPercent = Math.min(PITCH_LENGTH_YARDS, requiredDepth) / PITCH_LENGTH_YARDS * 100;
  return {
    ...target,
    y: defendingDirection === "up" ? 100 - depthPercent : depthPercent,
  };
}

export function observeKeeperMotion(keeper, attacker, velocity) {
  if (!velocity) return { movementDirection: null, closingSpeed: null, set: null, pressure: 0 };
  const dx = (attacker.x - keeper.x) * PITCH_WIDTH_YARDS / 100;
  const dy = (attacker.y - keeper.y) * PITCH_LENGTH_YARDS / 100;
  const distance = Math.hypot(dx, dy);
  const closingSpeed = distance ? (dx * velocity.x * PITCH_WIDTH_YARDS * 10
    + dy * velocity.y * PITCH_LENGTH_YARDS * 10) / distance : 0;
  return { closingSpeed, movementDirection: closingSpeed > 0.5 ? "closing" : closingSpeed < -0.5 ? "retreating" : "stationary",
    set: speedYpsFromVelocity(velocity) < 0.6,
    pressure: clamp(0, 0.65, (12 - distance) / 12 * Math.max(0, closingSpeed) / 8) };
}

// Execution after a real contact. A poor clearance is a different ball
// impulse, not a retrospective change to who won the race.
export function executeKeeperSweep({ keeper, point, defendingDirection, random = () => 0.5 }) {
  const inBox = keeper.role === "keeper" && depth(point, defendingDirection) >= 0 && depth(point, defendingDirection) <= 18
    && Math.abs(point.x - 50) * PITCH_WIDTH_YARDS / 100 <= 22;
  const control = skill(keeper.player, ...(inBox ? ["Handling", "Composure"] : ["Kicking", "Technique", "Composure"])) / 20;
  const error = random() > clamp(0.55, 0.98, 0.58 + control * 0.4);
  if (inBox && !error) return { action: "claim", error: false };
  const angle = (random() * 2 - 1) * (error ? 1.45 : 0.65);
  const speed = error ? 2 + random() * 5 : 15 + control * 10;
  return { action: inBox ? "spill" : "clearance", error, velocity: {
    x: Math.sin(angle) * speed / PITCH_WIDTH_YARDS / 10,
    y: (defendingDirection === "up" ? -1 : 1) * Math.cos(angle) * speed / PITCH_LENGTH_YARDS / 10,
  } };
}
