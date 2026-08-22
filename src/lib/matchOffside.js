import { PITCH_LENGTH_YARDS } from "./pitchGeometry.js";
const DEFAULT_TOLERANCE_YARDS = 0.5;
const DIRECT_RESTART_EXEMPTIONS = new Set(["throw-in", "corner", "goal-kick"]);

function clamp(min, max, value) {
  return Math.max(min, Math.min(max, value));
}

function tolerancePercent(toleranceYards) {
  return (Math.max(0, toleranceYards) / PITCH_LENGTH_YARDS) * 100;
}

function goalLineY(attackingDirection) {
  return attackingDirection === "up" ? 0 : 100;
}

function validPlayers(players) {
  return (players || []).filter((entry) => entry && Number.isFinite(entry.y));
}

/**
 * The opponent nearer their own goal than all but one teammate. Goalkeepers
 * are not special here: callers must pass every defending player, and the
 * geometry decides who the last and second-last opponents actually are.
 * Sparse test setups with fewer than two defenders deliberately fall back to
 * the goal line rather than inventing a phantom defender.
 */
export function secondLastOpponentLine(defenders, attackingDirection) {
  const sorted = validPlayers(defenders).slice().sort((left, right) => (
    attackingDirection === "up" ? left.y - right.y : right.y - left.y
  ));
  const secondLast = sorted[1] || null;
  return {
    lineY: secondLast ? secondLast.y : goalLineY(attackingDirection),
    secondLastDefenderId: secondLast?.id ?? null,
    lastDefenderId: sorted[0]?.id ?? null,
    defenderCount: sorted.length,
  };
}

export function isOffsideRestartExempt(restart) {
  return DIRECT_RESTART_EXEMPTIONS.has(String(restart || "").toLowerCase());
}

/**
 * Captures the law-relevant geometry at the instant a teammate contacts the
 * ball. The snapshot is data, not a renderer decision, and can be stored on
 * the resolved pass/cross event for replay and tests.
 */
export function buildOffsideSnapshot({
  attacker, ballPoint, defenders = [], attackingDirection = "down",
  toleranceYards = DEFAULT_TOLERANCE_YARDS, restart = null,
} = {}) {
  if (!attacker || !ballPoint) throw new Error("Offside snapshots require an attacker and ball point.");
  const direction = attackingDirection === "up" ? "up" : "down";
  const tolerance = tolerancePercent(toleranceYards);
  const line = secondLastOpponentLine(defenders, direction);
  const effectiveLineY = direction === "up"
    ? Math.min(ballPoint.y, line.lineY)
    : Math.max(ballPoint.y, line.lineY);
  const inOppositionHalf = direction === "up"
    ? attacker.y < 50 - tolerance
    : attacker.y > 50 + tolerance;
  const beyondBall = direction === "up"
    ? attacker.y < ballPoint.y - tolerance
    : attacker.y > ballPoint.y + tolerance;
  const beyondSecondLast = direction === "up"
    ? attacker.y < line.lineY - tolerance
    : attacker.y > line.lineY + tolerance;
  const restartExempt = isOffsideRestartExempt(restart);
  return Object.freeze({
    attackingDirection: direction,
    attackerId: attacker.id ?? null,
    attackerY: attacker.y,
    ballYAtKick: ballPoint.y,
    defenderLineY: line.lineY,
    effectiveLineY,
    secondLastDefenderId: line.secondLastDefenderId,
    lastDefenderId: line.lastDefenderId,
    defenderCount: line.defenderCount,
    toleranceYards,
    inOppositionHalf,
    beyondBall,
    beyondSecondLast,
    restartExempt,
    isOffside: !restartExempt && inOppositionHalf && beyondBall && beyondSecondLast,
  });
}

export function isPlayerOffside(context) {
  return buildOffsideSnapshot(context).isOffside;
}

/** A point just onside of the effective ball/second-last-opponent line. */
export function onsideLineTargetY(snapshot, bufferYards = 1.5) {
  const buffer = tolerancePercent(bufferYards);
  return snapshot.attackingDirection === "up"
    ? clamp(0, 100, snapshot.effectiveLineY + buffer)
    : clamp(0, 100, snapshot.effectiveLineY - buffer);
}

export { DEFAULT_TOLERANCE_YARDS };
