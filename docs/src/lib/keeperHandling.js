import { isInsideOwnPenaltyArea } from "./pitchGeometry.js";

export const KEEPER_POSSESSION_PHASE = Object.freeze({
  HOLDING: "keeper-holding",
  AT_FEET: "keeper-at-feet",
});

export const KEEPER_HOLDING_ACTIONS = Object.freeze([
  "throw-short", "roll-out", "throw-long", "punt", "hold", "release-to-feet",
]);

export const KEEPER_AT_FEET_ACTIONS = Object.freeze([
  "pass-short", "pass-long", "clear",
]);

export function keeperPossessionPhase(keeper, ball) {
  if (!keeper || keeper.role !== "keeper" || ball?.ownerId !== keeper.id) return null;
  return ball.phase === "held"
    ? KEEPER_POSSESSION_PHASE.HOLDING
    : KEEPER_POSSESSION_PHASE.AT_FEET;
}

// Law-level eligibility only. It does not resolve a catch or distribution;
// the caller still owns that transition. An opponent touch, or an accidental
// teammate deflection, restores handling rights. A deliberate foot backpass,
// teammate throw-in, or the keeper collecting their own release does not.
export function canKeeperHandle({ keeper, ball, attackingDirection } = {}) {
  if (!keeper || keeper.role !== "keeper" || !ball?.position) return false;
  if (!isInsideOwnPenaltyArea(keeper, ball.position, attackingDirection)) return false;
  if (ball.phase === "held" && ball.ownerId === keeper.id) return true;

  const last = ball.lastTouch;
  if (!last) return true;
  if (last.team !== keeper.team) return true;
  if (last.playerId === keeper.id) return false;
  if (last.restart === "throw-in") return false;
  return !(last.bodyPart === "foot" && last.deliberate === true);
}
