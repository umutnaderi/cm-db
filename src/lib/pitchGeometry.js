// Canonical Match Lab pitch geometry. The rendered pitch is explicitly a
// 75 x 120 yard field (see styles.css and the SVG viewBox), so simulation
// distances must use the same world instead of the previous 68 x 105 values
// (standard metres accidentally labelled as yards).
export const PITCH_WIDTH_YARDS = 75;
export const PITCH_LENGTH_YARDS = 120;
export const GOAL_WIDTH_YARDS = 8;
// Regulation crossbar height (8ft = 2.6667yd) -- Shot As Projectile v1
// (2026-08-27), the vertical axis a shot's own mouth point is checked
// against (GOAL_WIDTH_YARDS already covers the horizontal one). Nothing
// upstream of this constant needs a physical 3D renderer: every consumer
// treats height as one extra scalar on an existing 2D point, the same
// pattern matchPassFlight.js's own ballPositionAtElapsed() already
// established for a pass's own arc.
export const GOAL_HEIGHT_YARDS = 2.6667;

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

// Ball Out of Bounds v1 (2026-09-01) -- pure geometry, no team/attacking-
// direction knowledge at all: given a straight ball segment in this
// project's own percent-space, where (if anywhere) does it first cross a
// touchline (x=0/x=100, "left"/"right") or byline (y=0/y=100, "top"/
// "bottom")? Assumes `from` is itself on the pitch (true at every real
// call site -- the ball's own position is on-pitch right up until the
// exact instant this checks whether the NEXT point takes it off).
// Returns null when `to` is still on the pitch -- a straight segment
// between two in-bounds points can never exit a convex rectangle and
// come back, so that single check is sufficient; never a "grazes the
// line and returns" false positive.
export function findPitchExit(from, to) {
  const fx = Number(from?.x);
  const fy = Number(from?.y);
  const tx = Number(to?.x);
  const ty = Number(to?.y);
  if (![fx, fy, tx, ty].every(Number.isFinite)) return null;
  if (tx >= 0 && tx <= 100 && ty >= 0 && ty <= 100) return null;
  const dx = tx - fx;
  const dy = ty - fy;
  let bestT = null;
  let edge = null;
  const consider = (t, candidateEdge) => {
    if (t === null || !Number.isFinite(t) || t < 0 || t > 1) return;
    if (bestT === null || t < bestT) {
      bestT = t;
      edge = candidateEdge;
    }
  };
  if (dx < 0) consider((0 - fx) / dx, "left");
  else if (dx > 0) consider((100 - fx) / dx, "right");
  if (dy < 0) consider((0 - fy) / dy, "top");
  else if (dy > 0) consider((100 - fy) / dy, "bottom");
  if (bestT === null) return null;
  return {
    edge,
    point: {
      x: Math.max(0, Math.min(100, fx + dx * bestT)),
      y: Math.max(0, Math.min(100, fy + dy * bestT)),
    },
  };
}
