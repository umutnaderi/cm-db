// Restart setup -- the pure, DOM-free model of a dead ball and the
// restart that must put it back into play.
//
// The point of this module: a restart is NOT open play with the ball
// parked somewhere. It is a dead ball plus a REQUIRED FIRST ACTION by a
// nominated taker. A setup built here can never fall straight into a
// generic ACTION.CHOICE -- see requiredFirstAction() and the `deadBall`
// flag both carried on every spec.
//
// Every coordinate comes from pitchGeometry.js (percent-of-pitch space,
// the same frame the engine and playback already use). Layouts are
// authored once for one attacking direction and one side, then mirrored --
// so no unexplained literals get scattered through match-lab.js.

import {
  GOAL_WIDTH_YARDS, PENALTY_AREA, SIX_YARD_BOX, PENALTY_SPOT_DEPTH_PCT,
  PITCH_LENGTH_YARDS, PITCH_WIDTH_YARDS,
  attackingGoalYForDirection, defendingGoalYForDirection,
  fromYardPoint, toYardPoint, yardDistance,
} from "./pitchGeometry.js";

export const RESTART_TYPES = Object.freeze([
  "kickoff", "free-kick", "corner", "goal-kick", "throw-in",
]);

export const RESTART_SIDES = Object.freeze(["left", "right"]);

// Laws-of-the-game distances, in yards, stated once.
export const OPPONENT_DISTANCE_YARDS = Object.freeze({
  // Opponents must be outside the centre circle at kick-off, and outside
  // the 10-yard ring for a free kick or corner.
  kickoff: 10,
  "free-kick": 10,
  corner: 10,
  // A goal kick is only restricted by the penalty area, not a ring.
  "goal-kick": 0,
  // Two yards from the thrower for a throw-in.
  "throw-in": 2,
});

export const CENTRE_CIRCLE_RADIUS_YARDS = 10;

const CORNER_INSET_PCT = 0.5;

/** Variants a taker may choose, per restart type. */
export const RESTART_VARIANTS = Object.freeze({
  kickoff: ["short", "long"],
  "free-kick": ["direct", "cross", "short", "play-out"],
  corner: ["inswinger", "outswinger", "short", "near-post", "far-post"],
  "goal-kick": ["short", "long"],
  "throw-in": ["short", "long"],
});

/**
 * The restart action the engine MUST resolve first. A restart setup never
 * offers the open-play chooser until this has been taken -- that is what
 * keeps a dead ball a dead ball.
 */
export function requiredFirstAction(type) {
  switch (type) {
    case "kickoff": return "RESTART.KICKOFF.TAKE";
    case "free-kick": return "RESTART.FREE_KICK.TAKE";
    case "corner": return "RESTART.CORNER.TAKE";
    case "goal-kick": return "RESTART.GOAL_KICK.TAKE";
    case "throw-in": return "RESTART.THROW_IN.TAKE";
    default: throw new Error(`Unknown restart type "${type}".`);
  }
}

// ---------------------------------------------------------------------------
// Legal ball spots
// ---------------------------------------------------------------------------

/**
 * The legal spot for a restart, in percent-of-pitch coordinates.
 *
 * `attackingDirection` is the TAKING team's own attacking direction, so
 * every spot below mirrors automatically rather than being authored twice.
 * `side` ("left"/"right") is the touchline/corner the restart belongs to.
 * `spot` lets a free kick or throw-in state where the offence actually
 * happened; it is clamped onto the legal position for its type.
 */
export function restartBallSpot({ type, attackingDirection, side = "right", spot = null }) {
  const attackingGoalY = attackingGoalYForDirection(attackingDirection);
  const ownGoalY = defendingGoalYForDirection(attackingDirection);
  switch (type) {
    case "kickoff":
      // Always the centre mark, whichever way you are attacking.
      return { x: 50, y: 50 };
    case "corner": {
      // The corner arc at the end the taking team is attacking.
      const x = side === "left" ? CORNER_INSET_PCT : 100 - CORNER_INSET_PCT;
      const y = attackingGoalY === 0 ? CORNER_INSET_PCT : 100 - CORNER_INSET_PCT;
      return { x, y };
    }
    case "goal-kick": {
      // Inside your OWN six-yard box, on the side the ball went out.
      const depth = SIX_YARD_BOX.depthPct;
      const y = ownGoalY === 0 ? depth : 100 - depth;
      const x = side === "left" ? 50 - SIX_YARD_BOX.halfWidthPct : 50 + SIX_YARD_BOX.halfWidthPct;
      return { x, y };
    }
    case "throw-in": {
      // Exactly on the touchline, at the height the ball left play.
      const x = side === "left" ? 0 : 100;
      const y = clampPercent(spot?.y ?? 50);
      return { x, y };
    }
    case "free-kick": {
      // Wherever the offence was, clamped onto the pitch. A free kick has
      // no fixed spot -- location is the whole point of it.
      return { x: clampPercent(spot?.x ?? 50), y: clampPercent(spot?.y ?? 50) };
    }
    default:
      throw new Error(`Unknown restart type "${type}".`);
  }
}

function clampPercent(value) {
  return Math.max(0, Math.min(100, Number(value) || 0));
}

/**
 * Is this ball spot legal for its restart type? Returns { legal, reason }
 * so a caller can report WHY rather than silently relocating the ball.
 */
export function validateBallSpot({ type, point, attackingDirection, side = "right" }) {
  if (!point || !Number.isFinite(point.x) || !Number.isFinite(point.y)) {
    return { legal: false, reason: "ball spot is not a point" };
  }
  if (point.x < -0.001 || point.x > 100.001 || point.y < -0.001 || point.y > 100.001) {
    return { legal: false, reason: "ball spot is off the pitch" };
  }
  const attackingGoalY = attackingGoalYForDirection(attackingDirection);
  const ownGoalY = defendingGoalYForDirection(attackingDirection);
  switch (type) {
    case "kickoff":
      return Math.abs(point.x - 50) < 0.001 && Math.abs(point.y - 50) < 0.001
        ? { legal: true, reason: null }
        : { legal: false, reason: "a kick-off must be taken from the centre mark" };
    case "corner": {
      const expectedY = attackingGoalY === 0 ? 0 : 100;
      const nearGoalLine = Math.abs(point.y - expectedY) <= CORNER_INSET_PCT + 0.001;
      const nearTouchline = Math.min(point.x, 100 - point.x) <= CORNER_INSET_PCT + 0.001;
      return nearGoalLine && nearTouchline
        ? { legal: true, reason: null }
        : { legal: false, reason: "a corner must be taken from the corner arc at the attacking end" };
    }
    case "goal-kick": {
      const withinDepth = Math.abs(point.y - ownGoalY) <= SIX_YARD_BOX.depthPct + 0.001;
      const withinWidth = Math.abs(point.x - 50) <= SIX_YARD_BOX.halfWidthPct + 0.001;
      return withinDepth && withinWidth
        ? { legal: true, reason: null }
        : { legal: false, reason: "a goal kick must be taken from inside the six-yard box" };
    }
    case "throw-in": {
      const onTouchline = Math.min(point.x, 100 - point.x) <= 0.001;
      if (!onTouchline) return { legal: false, reason: "a throw-in must be taken from the touchline" };
      const expectedX = side === "left" ? 0 : 100;
      return Math.abs(point.x - expectedX) <= 0.001
        ? { legal: true, reason: null }
        : { legal: false, reason: `a ${side}-side throw-in must be taken from the ${side} touchline` };
    }
    case "free-kick":
      return { legal: true, reason: null };
    default:
      return { legal: false, reason: `unknown restart type "${type}"` };
  }
}

// ---------------------------------------------------------------------------
// Free-kick location bands -- the "attacking"/"defending" UI presets
// ---------------------------------------------------------------------------

// Both presets are the SAME restart type with different location bands.
// There is no separate "attacking free kick" mechanic; there is a free
// kick, taken somewhere. Bands are expressed as a fraction of the distance
// from your own goal line to the opponent's, so they mirror for free.
export const FREE_KICK_BANDS = Object.freeze({
  defending: { fromOwnGoal: [0.05, 0.35], label: "Defending third" },
  middle: { fromOwnGoal: [0.35, 0.65], label: "Middle third" },
  attacking: { fromOwnGoal: [0.65, 0.95], label: "Attacking third" },
});

/** A representative spot inside a band, for a given attacking direction. */
export function freeKickBandSpot({ band, attackingDirection, lateral = 50, depthRatio = 0.5 }) {
  const definition = FREE_KICK_BANDS[band];
  if (!definition) throw new Error(`Unknown free-kick band "${band}".`);
  const [near, far] = definition.fromOwnGoal;
  const progress = near + (far - near) * Math.max(0, Math.min(1, depthRatio));
  const ownGoalY = defendingGoalYForDirection(attackingDirection);
  // progress 0 = own goal line, 1 = opponent goal line.
  const y = ownGoalY === 0 ? progress * 100 : 100 - progress * 100;
  return { x: clampPercent(lateral), y: clampPercent(y) };
}

/** Which band a free-kick spot falls in, for a given attacking direction. */
export function freeKickBandOf(point, attackingDirection) {
  const ownGoalY = defendingGoalYForDirection(attackingDirection);
  const progress = ownGoalY === 0 ? point.y / 100 : (100 - point.y) / 100;
  for (const [name, definition] of Object.entries(FREE_KICK_BANDS)) {
    const [near, far] = definition.fromOwnGoal;
    if (progress >= near && progress <= far) return name;
  }
  return progress < FREE_KICK_BANDS.defending.fromOwnGoal[0] ? "defending" : "attacking";
}

// ---------------------------------------------------------------------------
// Layout templates
// ---------------------------------------------------------------------------

// Layouts are authored ONCE, in yards, relative to the ball, in a frame
// where the taking team attacks "up" (toward y=0) and the restart is on
// the RIGHT side. mirrorLayout() produces every other case, so a corner on
// the left attacking down is the same authored template reflected twice --
// never a second hand-written coordinate set that can drift.
//
// offsetYards: { alongGoalAxis, acrossPitch } from the ball.
//   alongGoalAxis  positive = toward the goal the taking team attacks.
//   acrossPitch    positive = toward the right touchline.
function role(restartRole, alongGoalAxis, acrossPitch, options = {}) {
  return { restartRole, offsetYards: { alongGoalAxis, acrossPitch }, ...options };
}

// A goalkeeper is the one restart participant who is NOT placed relative to
// the ball. They stand on their own goal, wherever the ball happens to be
// -- so a corner keeper belongs on the six-yard line, not on the corner
// flag, and a free-kick keeper belongs on their line, not on the free-kick
// spot. `anchoredToGoal` used to be recorded on the layout and then ignored
// by layoutPositions(), which is exactly the bug this fixes: the keeper
// inherited the (0,0) ball-relative offset and stood on the ball.
//
// goalAnchor options, all optional:
//   depthYards          how far off their own goal line they start.
//   lateralYards        a fixed shift from the goal's centre, in the
//                       authored frame (mirrors with `side` like any other
//                       lateral offset).
//   ballShadeFraction   how much of the ball's own lateral offset from the
//                       goal centre the keeper covers. POSITIVE shades
//                       toward the ball's side, NEGATIVE shades away from
//                       it, 0 keeps them dead central. Negative is the
//                       right answer at a free kick: the wall is set to
//                       cover the near half of the goal, so the keeper
//                       takes the open half.
const DEFAULT_GOAL_ANCHOR = Object.freeze({
  depthYards: 2.5,
  lateralYards: 0,
  ballShadeFraction: 0.3,
});

// How far outside each post a keeper may drift while shading toward the
// ball. Beyond this they would be standing outside their own goal frame.
const KEEPER_LATERAL_LIMIT_YARDS = GOAL_WIDTH_YARDS / 2 + 2;

function goalAnchoredPoint(entry, { ball, defendedGoalY, sideSign }) {
  const anchor = { ...DEFAULT_GOAL_ANCHOR, ...(entry.goalAnchor ?? {}) };
  const goalCentreXYards = PITCH_WIDTH_YARDS / 2;
  const ballYards = toYardPoint(ball);
  const shade = Math.max(-1, Math.min(1, Number(anchor.ballShadeFraction) || 0));
  const shadedX = goalCentreXYards
    + (ballYards.x - goalCentreXYards) * shade
    + (Number(anchor.lateralYards) || 0) * sideSign;
  const x = Math.max(
    goalCentreXYards - KEEPER_LATERAL_LIMIT_YARDS,
    Math.min(goalCentreXYards + KEEPER_LATERAL_LIMIT_YARDS, shadedX),
  );
  // Depth is measured INTO the field of play from their own goal line,
  // whichever end that is.
  const goalLineYYards = (defendedGoalY / 100) * PITCH_LENGTH_YARDS;
  const depth = Math.max(0, Number(anchor.depthYards) || 0);
  const y = defendedGoalY === 0 ? goalLineYYards + depth : goalLineYYards - depth;
  return fromYardPoint({ x, y });
}

export const RESTART_LAYOUTS = Object.freeze({
  // Law 8: at a kick-off every player except the taker starts in their OWN
  // half, and the defending team additionally stays outside the centre
  // circle until the ball is in play.
  //
  // The ball is on the centre mark, so "own half" is purely a matter of
  // which sign each offset carries. Both sets below are authored in the
  // taking team's frame, where +alongGoalAxis points at the goal the taking
  // team attacks. That means:
  //   taking team   -> their own half is NEGATIVE along that axis
  //   defending team-> their own half is POSITIVE along it (the goal the
  //                    taking team attacks is the goal they defend)
  // The defending entries previously carried negative offsets, which put
  // the whole defending line in the TAKING team's half; the taking team's
  // "advanced runner" carried +8, which started them across halfway. Both
  // were illegal, and the validator shared the same reversed assumption so
  // nothing caught it.
  kickoff: {
    taking: [
      role("taker", 0, 0, { required: true }),
      role("kickoff-support", -2, -4),
      // Was +8 (across halfway). A runner poised to break forward still has
      // to start behind the line.
      role("advanced-runner", -3, 10),
      role("holding", -12, 0),
    ],
    defending: [
      // Just outside the centre circle (radius 10yd), in their own half.
      role("centre-circle-edge", 11, 4),
      role("holding", 18, -6),
      role("deep-cover", 30, 0),
    ],
  },
  "free-kick": {
    taking: [
      role("taker", 0, 0, { required: true }),
      role("second-taker", -1, -3),
      role("near-post-runner", 14, 6),
      role("far-post-runner", 14, -8),
      role("edge-of-area", 6, 0),
      role("rest-defence", -18, 2),
    ],
    defending: [
      role("wall", 10, 0, { wall: true }),
      // Off the line and shaded toward the ball's side, because the wall
      // covers the near half of the goal and the keeper covers the rest.
      role("keeper", 0, 0, {
        anchoredToGoal: true,
        goalAnchor: { depthYards: 1.5, ballShadeFraction: -0.3 },
      }),
      role("near-post-marker", 16, 5),
      role("far-post-marker", 16, -6),
      role("sweeper", 12, 0),
    ],
  },
  // A corner's ball sits ON the goal line at the flag, so "toward the
  // attacked goal" is not a usable axis here -- a positive alongGoalAxis
  // just pushes a player off the pitch, and the original offsets (a
  // "near-post runner" 8 yards from the flag) were written as though they
  // were relative to the GOAL. From the flag, the near post is ~33 yards
  // across the pitch, not 8. Corrected below, in real yards from the flag:
  //   acrossPitch    negative = toward the goal's centre
  //   alongGoalAxis  negative = out of the goal line, into the field
  // The 10-yard opponent ring is measured from the flag too, which is why
  // every defending body except the short-corner cover is a long way
  // across -- and the short cover sits just outside it.
  corner: {
    taking: [
      role("taker", 0, 0, { required: true }),
      role("short-option", -4, -3),
      role("near-post-runner", -4, -31),
      role("central-runner", -8, -36),
      role("far-post-runner", -4, -42),
      role("edge-of-area", -20, -36),
      role("rest-defence", -60, -30),
    ],
    defending: [
      // A corner keeper starts off their line toward the middle of the
      // goal, barely shaded toward the corner the ball is coming from --
      // never at the flag itself, which is where the un-anchored (0,0)
      // ball-relative offset used to put them.
      role("keeper", 0, 0, {
        anchoredToGoal: true,
        goalAnchor: { depthYards: 2.5, lateralYards: -1.5, ballShadeFraction: 0.05 },
      }),
      role("near-post-guard", -2, -33),
      role("far-post-guard", -2, -41),
      role("central-marker", -6, -37),
      role("zonal-front", -11, -35),
      // The one defender who stays near the flag to cover a short corner:
      // just outside the 10-yard ring, not inside it.
      role("short-cover", -11, -4),
      role("outlet", -35, -20),
    ],
  },
  "goal-kick": {
    taking: [
      role("taker", 0, 0, { required: true, keeper: true }),
      role("short-option-left", 6, -12),
      role("short-option-right", 6, 12),
      role("long-target", 45, 0),
      role("second-ball", 38, -6),
    ],
    defending: [
      role("press-left", 12, -10),
      role("press-right", 12, 10),
      role("long-ball-contest", 46, 1),
      role("second-ball-cover", 39, 7),
    ],
  },
  "throw-in": {
    taking: [
      role("taker", 0, 0, { required: true, offPitch: true }),
      role("short-option", 4, -4),
      role("down-the-line", 12, -1),
      role("inside-option", -2, -10),
      role("recycle", -8, -6),
    ],
    defending: [
      role("thrower-marker", 3, -3),
      role("inside-cover", 0, -9),
      role("line-cover", 10, -3),
    ],
  },
});

/**
 * Places one authored layout on the pitch.
 *
 * `attackingDirection` is the TAKING team's. `side` mirrors the template
 * across the pitch's centre line. `forTeam` selects the taking or the
 * defending layout; a defending layout is authored in the SAME frame (the
 * taking team's attacking direction), which is why both mirror together.
 */
export function layoutPositions({
  type, attackingDirection, side = "right", ball, forTeam = "taking", goalY = null,
}) {
  const layout = RESTART_LAYOUTS[type];
  if (!layout) throw new Error(`Unknown restart type "${type}".`);
  const entries = layout[forTeam];
  if (!entries) throw new Error(`Unknown restart layout side "${forTeam}".`);
  const attackingGoalY = goalY ?? attackingGoalYForDirection(attackingDirection);
  // "Toward the attacked goal" is -y when that goal is at y=0.
  const goalAxisSign = attackingGoalY === 0 ? -1 : 1;
  const sideSign = side === "left" ? -1 : 1;
  const ballYards = toYardPoint(ball);
  // Which goal does THIS layout's team defend? The defending team defends
  // the goal the taking team is attacking; the taking team defends the
  // other one. Only goal-anchored roles (keepers) use it.
  const defendedGoalY = forTeam === "defending"
    ? attackingGoalY
    : (attackingGoalY === 0 ? 100 : 0);
  return entries.map((entry) => {
    const anchored = Boolean(entry.anchoredToGoal);
    const raw = anchored
      ? goalAnchoredPoint(entry, { ball, defendedGoalY, sideSign })
      : fromYardPoint({
          x: ballYards.x + entry.offsetYards.acrossPitch * sideSign,
          y: ballYards.y + entry.offsetYards.alongGoalAxis * goalAxisSign,
        });
    return {
      restartRole: entry.restartRole,
      required: Boolean(entry.required),
      wall: Boolean(entry.wall),
      keeper: Boolean(entry.keeper),
      anchoredToGoal: anchored,
      // A thrower stands OFF the pitch; everyone else is clamped on.
      x: entry.offPitch ? raw.x : clampPercent(raw.x),
      y: entry.offPitch ? raw.y : clampPercent(raw.y),
    };
  });
}

// ---------------------------------------------------------------------------
// Free-kick wall geometry
// ---------------------------------------------------------------------------

export const WALL_DISTANCE_YARDS = 10;
export const WALL_PLAYER_SPACING_YARDS = 0.8;

/**
 * Concrete positions for a free-kick wall of `size` players.
 *
 * The wall stands the required ten yards from the ball, on the line
 * between ball and goal, aligned PERPENDICULAR to that line, with the
 * players spaced along it. Returned in near-post-to-far-post order so a
 * caller can hand the outermost slot to the tallest defender.
 *
 * Deliberately geometric rather than a single authored "wall" offset: a
 * real wall is several bodies covering an angle, and one marker cannot
 * show whether the near post is actually protected.
 */
export function wallPositions({ ball, attackingGoalY, size = 4 }) {
  const count = Math.max(1, Math.round(Number(size) || 1));
  const ballYards = toYardPoint(ball);
  const goalYards = toYardPoint({ x: 50, y: attackingGoalY });
  const dx = goalYards.x - ballYards.x;
  const dy = goalYards.y - ballYards.y;
  const length = Math.hypot(dx, dy) || 1;
  // Unit vector ball -> goal, and its perpendicular.
  const forward = { x: dx / length, y: dy / length };
  const lateral = { x: -forward.y, y: forward.x };
  const centre = {
    x: ballYards.x + forward.x * WALL_DISTANCE_YARDS,
    y: ballYards.y + forward.y * WALL_DISTANCE_YARDS,
  };
  // Shifted so the wall covers the near-post side of the goal rather than
  // being centred on the ball-goal line: that is what a wall is for.
  const span = (count - 1) * WALL_PLAYER_SPACING_YARDS;
  const nearPostBias = WALL_PLAYER_SPACING_YARDS * 0.5;
  return Array.from({ length: count }, (_, index) => {
    const offset = index * WALL_PLAYER_SPACING_YARDS - span / 2 + nearPostBias;
    return fromYardPoint({
      x: centre.x + lateral.x * offset,
      y: centre.y + lateral.y * offset,
    });
  });
}

// ---------------------------------------------------------------------------
// The restart specification
// ---------------------------------------------------------------------------

/**
 * Builds a complete restart specification: who takes it, from where, which
 * variant, where both teams stand, and the first action that MUST happen.
 *
 * The returned spec always carries `deadBall: true` and a
 * `requiredFirstAction`. A consumer that skips straight to open play is
 * violating the contract, not exercising an option.
 */
export function createRestartSetup({
  type,
  takingTeam,
  attackingDirectionByTeam,
  side = "right",
  spot = null,
  takerId = null,
  variant = null,
  freeKickBand = null,
  // Per-corner override of the taking/defending teams' standing corner
  // plans. Partial by design -- see resolveCornerPlan() in cornerSetup.js.
  // Carried, never merged here: this module knows the restart, not the
  // squads, and the merge needs both.
  cornerOverride = null,
}) {
  if (!RESTART_TYPES.includes(type)) throw new Error(`Unknown restart type "${type}".`);
  if (!takingTeam) throw new Error("createRestartSetup() requires a taking team.");
  const attackingDirection = attackingDirectionByTeam?.[takingTeam];
  if (attackingDirection !== "up" && attackingDirection !== "down") {
    throw new Error("createRestartSetup() requires an explicit attacking direction for the taking team.");
  }
  if (type !== "free-kick" && type !== "throw-in" && !RESTART_SIDES.includes(side)) {
    throw new Error(`Unknown restart side "${side}".`);
  }
  const variants = RESTART_VARIANTS[type];
  const resolvedVariant = variant ?? variants[0];
  if (!variants.includes(resolvedVariant)) {
    throw new Error(`Variant "${resolvedVariant}" is not valid for a ${type}.`);
  }
  const resolvedSpot = type === "free-kick" && freeKickBand
    ? freeKickBandSpot({ band: freeKickBand, attackingDirection, lateral: spot?.x ?? 50 })
    : spot;
  const ball = restartBallSpot({ type, attackingDirection, side, spot: resolvedSpot });
  const legality = validateBallSpot({ type, point: ball, attackingDirection, side });
  const defendingTeam = Object.keys(attackingDirectionByTeam).find((team) => team !== takingTeam) ?? null;
  return {
    type,
    deadBall: true,
    requiredFirstAction: requiredFirstAction(type),
    takingTeam,
    defendingTeam,
    attackingDirection,
    side: type === "free-kick" ? null : side,
    ball,
    ballLegal: legality.legal,
    ballIllegalReason: legality.reason,
    takerId,
    variant: resolvedVariant,
    freeKickBand: type === "free-kick"
      ? (freeKickBand ?? freeKickBandOf(ball, attackingDirection))
      : null,
    opponentDistanceYards: OPPONENT_DISTANCE_YARDS[type],
    cornerOverride: type === "corner" ? (cornerOverride ?? null) : null,
    layout: {
      taking: layoutPositions({ type, attackingDirection, side, ball, forTeam: "taking" }),
      defending: layoutPositions({ type, attackingDirection, side, ball, forTeam: "defending" }),
    },
  };
}

/**
 * Checks a built restart against the laws it must satisfy: the ball is on
 * a legal spot, a taker is nominated, and no opponent stands closer than
 * the restart's own required distance.
 */
/** Is `point` in the half defended by a team whose own goal is at `ownGoalY`? */
function isInOwnHalf(point, ownGoalY) {
  return ownGoalY === 0 ? point.y < 50 : point.y > 50;
}

function describe(participant, fallback) {
  return participant?.id ?? participant?.restartRole ?? fallback;
}

/**
 * Checks a built restart against the laws it must satisfy.
 *
 * `defending` (formerly `opponents`, still accepted under that name) are
 * the participants of the team NOT taking the restart. `taking` are the
 * restarting team's own players, which matters for a kick-off: Law 8 puts
 * BOTH teams in their own half, not just the opposition. Passing the
 * generated layouts straight back in is the intended use -- a setup this
 * module produces should validate as legal without hand-tuning.
 *
 * A `taking` participant may opt out of the own-half rule by carrying
 * `required: true` (the taker, who stands on the centre mark itself) --
 * which is exactly the flag layoutPositions() already puts on them.
 */
export function validateRestartSetup(spec, { taking = [], defending = [], opponents = [] } = {}) {
  const errors = [];
  if (!spec?.deadBall) errors.push("a restart setup must represent a dead ball");
  if (!spec?.requiredFirstAction) errors.push("a restart setup must name a required first action");
  if (!spec?.ballLegal) errors.push(`illegal ball spot: ${spec?.ballIllegalReason ?? "unknown"}`);
  if (!spec?.takerId) errors.push("no taker nominated");
  // `opponents` kept as an alias so existing callers keep working.
  const defenders = defending.length ? defending : opponents;

  const minimum = spec?.opponentDistanceYards ?? 0;
  if (minimum > 0) {
    for (const defender of defenders) {
      const distance = yardDistance(spec.ball, defender);
      if (distance + 0.001 < minimum) {
        errors.push(
          `${describe(defender, "an opponent")} stands ${distance.toFixed(1)}yd from a ${spec.type}, `
          + `inside the required ${minimum}yd`,
        );
      }
    }
  }

  if (spec?.type === "kickoff") {
    // The taking team's own goal is the one they are NOT attacking; the
    // defending team's own goal is the one the taking team attacks. Getting
    // this the wrong way round is what previously let an illegal layout
    // validate cleanly.
    const takingOwnGoalY = defendingGoalYForDirection(spec.attackingDirection);
    const defendingOwnGoalY = attackingGoalYForDirection(spec.attackingDirection);
    for (const player of taking) {
      // The taker stands on the centre mark, on the halfway line itself.
      if (player.required) continue;
      if (!isInOwnHalf(player, takingOwnGoalY)) {
        errors.push(`${describe(player, "a kicking-team player")} starts across halfway at kick-off`);
      }
    }
    for (const defender of defenders) {
      if (!isInOwnHalf(defender, defendingOwnGoalY)) {
        errors.push(`${describe(defender, "an opponent")} is not in their own half at kick-off`);
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/**
 * Convenience: validate a spec against its OWN generated layouts. This is
 * the check that matters -- a setup this module builds must be legal
 * without anybody hand-placing players first.
 */
export function validateGeneratedRestartSetup(spec) {
  return validateRestartSetup(spec, {
    taking: spec?.layout?.taking ?? [],
    defending: spec?.layout?.defending ?? [],
  });
}

export { PITCH_LENGTH_YARDS, PITCH_WIDTH_YARDS, PENALTY_AREA, PENALTY_SPOT_DEPTH_PCT };
