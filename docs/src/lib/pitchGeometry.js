// Canonical Match Lab pitch geometry. The rendered pitch is explicitly a
// 75 x 120 yard field (see styles.css and the SVG viewBox), so simulation
// distances must use the same world instead of the previous 68 x 105 values
// (standard metres accidentally labelled as yards).
export const PITCH_WIDTH_YARDS = 75;
export const PITCH_LENGTH_YARDS = 120;
export const GOAL_WIDTH_YARDS = 8;

export const PENALTY_AREA_DEPTH_YARDS = 18;
export const PENALTY_AREA_WIDTH_YARDS = 44;
export const SIX_YARD_BOX_DEPTH_YARDS = 6;
export const SIX_YARD_BOX_WIDTH_YARDS = 20;
export const PENALTY_SPOT_DEPTH_YARDS = 12;

export const PENALTY_AREA = Object.freeze({
  depthPct: (PENALTY_AREA_DEPTH_YARDS / PITCH_LENGTH_YARDS) * 100,
  halfWidthPct: ((PENALTY_AREA_WIDTH_YARDS / 2) / PITCH_WIDTH_YARDS) * 100,
});

export const SIX_YARD_BOX = Object.freeze({
  depthPct: (SIX_YARD_BOX_DEPTH_YARDS / PITCH_LENGTH_YARDS) * 100,
  halfWidthPct: ((SIX_YARD_BOX_WIDTH_YARDS / 2) / PITCH_WIDTH_YARDS) * 100,
});

export const PENALTY_SPOT_DEPTH_PCT = (PENALTY_SPOT_DEPTH_YARDS / PITCH_LENGTH_YARDS) * 100;

export function toYardPoint(point) {
  return {
    x: (Number(point?.x) / 100) * PITCH_WIDTH_YARDS,
    y: (Number(point?.y) / 100) * PITCH_LENGTH_YARDS,
  };
}

export function fromYardPoint(point) {
  return {
    x: (Number(point?.x) / PITCH_WIDTH_YARDS) * 100,
    y: (Number(point?.y) / PITCH_LENGTH_YARDS) * 100,
  };
}

export function yardDistance(a, b) {
  const left = toYardPoint(a);
  const right = toYardPoint(b);
  return Math.hypot(left.x - right.x, left.y - right.y);
}

export function attackingGoalYForDirection(attackingDirection) {
  return attackingDirection === "up" ? 0 : 100;
}

export function defendingGoalYForDirection(attackingDirection) {
  return attackingGoalYForDirection(attackingDirection) === 0 ? 100 : 0;
}

export function isInsidePenaltyArea(point, goalY) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  return Math.abs(point.y - goalY) <= PENALTY_AREA.depthPct
    && Math.abs(point.x - 50) <= PENALTY_AREA.halfWidthPct;
}

export function isInsideSixYardBox(point, goalY) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  return Math.abs(point.y - goalY) <= SIX_YARD_BOX.depthPct
    && Math.abs(point.x - 50) <= SIX_YARD_BOX.halfWidthPct;
}

export function isInsideOwnPenaltyArea(entry, point = entry, attackingDirection = null) {
  const direction = attackingDirection ?? entry?.attackingDirection;
  if (direction !== "up" && direction !== "down") {
    throw new Error("Own-penalty-area geometry requires an explicit attacking direction.");
  }
  return isInsidePenaltyArea(point, defendingGoalYForDirection(direction));
}
