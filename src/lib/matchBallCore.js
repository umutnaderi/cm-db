import { clamp, playerAttribute } from "./matchEngineCore.js";
import { timeToReach } from "./playerKinetics.js";
import { yardDistance } from "./spatialDecision.js";

const SAMPLE_PROGRESS = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
const GROUND_MOVEMENTS = new Set(["touch", "dribble", "pass", "reception", "interception", "tackle", "scramble", "deflection"]);
const AIR_MOVEMENTS = new Set(["cross", "shot", "header", "clearance", "rebound-shot"]);

function clonePoint(point) {
  return point ? {
    x: Number(point.x), y: Number(point.y), zone: point.zone ?? null,
    height: Number(point.height) || 0,
  } : null;
}

function cloneVelocity(velocity = null) {
  return velocity ? { x: Number(velocity.x) || 0, y: Number(velocity.y) || 0 } : { x: 0, y: 0 };
}

function cloneLastTouch(lastTouch = null) {
  if (!lastTouch) return null;
  return {
    playerId: lastTouch.playerId ?? null,
    team: lastTouch.team ?? null,
    bodyPart: lastTouch.bodyPart ?? "unknown",
    deliberate: Boolean(lastTouch.deliberate),
    restart: lastTouch.restart ?? null,
  };
}

export function createLastTouch({
  playerId, team, bodyPart = "unknown", deliberate = false, restart = null,
} = {}) {
  if (playerId == null) throw new Error("A last-touch descriptor requires playerId.");
  return cloneLastTouch({ playerId, team, bodyPart, deliberate, restart });
}

function sameXY(left, right) {
  return Boolean(left && right)
    && Math.abs(left.x - right.x) < 0.0001
    && Math.abs(left.y - right.y) < 0.0001;
}

function polylinePoint(path, ratio) {
  if (path.length <= 1) return clonePoint(path[0]);
  const lengths = path.slice(1).map((point, index) => Math.hypot(
    point.x - path[index].x,
    point.y - path[index].y,
  ));
  const total = lengths.reduce((sum, length) => sum + length, 0) || 1;
  let remaining = total * ratio;
  for (let index = 0; index < lengths.length; index += 1) {
    const length = lengths[index];
    if (remaining <= length || index === lengths.length - 1) {
      const local = length > 0 ? clamp(0, 1, remaining / length) : 1;
      return {
        x: path[index].x + (path[index + 1].x - path[index].x) * local,
        y: path[index].y + (path[index + 1].y - path[index].y) * local,
        zone: local >= 1 ? path[index + 1].zone : path[index].zone,
        height: 0,
      };
    }
    remaining -= length;
  }
  return clonePoint(path.at(-1));
}

function movementMode(movement, ballResult, keeperAction) {
  if (ballResult === "held" || keeperAction === "catch") return "held";
  if (ballResult === "rebound-in-play" || ballResult === "post-rebound") return "bouncing";
  if (AIR_MOVEMENTS.has(movement) || movement === "save" || movement === "block") return "airborne";
  if (GROUND_MOVEMENTS.has(movement)) return movement === "touch" || movement === "dribble" ? "controlled-ground" : "rolling";
  return "rolling";
}

function peakHeightFor(movement, mode, heightCue) {
  if (heightCue) return 5;
  if (mode === "held") return 1.1;
  if (mode === "bouncing") return movement === "save" ? 1.4 : 0.9;
  return {
    cross: 4.2,
    clearance: 4.8,
    shot: 2.2,
    header: 2.4,
    "rebound-shot": 1.5,
    save: 1.2,
    block: 0.8,
  }[movement] ?? 0;
}

function travelRatio(progress, mode, movement) {
  if (mode === "controlled-ground") {
    // A football touch jumps ahead of the runner, then grass drag lets the
    // player catch it at the next contact point.
    return 1 - ((1 - progress) ** 1.7);
  }
  if (mode === "rolling") {
    const drag = movement === "pass" ? 1.35 : 1.2;
    return 1 - ((1 - progress) ** drag);
  }
  return progress;
}

function sampleHeight(progress, peak, mode) {
  if (mode === "held") return peak;
  if (peak <= 0) return 0;
  if (mode === "airborne") return Math.max(0, 4 * peak * progress * (1 - progress));
  if (mode === "bouncing") {
    // A parry/post rebound lands, then makes a smaller second hop. This is
    // presentation physics only: the resolver still owns the exact contact
    // and resting endpoints.
    if (progress <= 0.58) {
      const local = progress / 0.58;
      return Math.max(0, 4 * peak * local * (1 - local));
    }
    const local = (progress - 0.58) / 0.42;
    return Math.max(0, 4 * peak * 0.42 * local * (1 - local));
  }
  return 0;
}

/**
 * Resting display point for a controlled ball. An outfielder keeps it just
 * ahead of the marker; only a goalkeeper may visually hold it on their body.
 * This never changes the resolver-owned player position.
 */
export function controlledBallPosition({
  playerPoint, attackingDirection = "down", ownerRole = null, velocity = null,
  touchDistance = 1.55,
} = {}) {
  const point = clonePoint(playerPoint);
  if (!point || ownerRole === "keeper") return point;
  const speed = Math.hypot(Number(velocity?.x) || 0, Number(velocity?.y) || 0);
  const direction = speed > 0.0001
    ? { x: velocity.x / speed, y: velocity.y / speed }
    : { x: 0, y: attackingDirection === "up" ? -1 : 1 };
  return {
    ...point,
    x: clamp(0, 100, point.x + direction.x * touchDistance),
    y: clamp(0, 100, point.y + direction.y * touchDistance),
    height: 0,
  };
}

/**
 * Produces an explicit ball-only trajectory. Horizontal drag makes ground
 * touches and passes move quickly off the foot and decelerate over grass;
 * aerial actions receive a z-height arc. Endpoints remain resolver-owned.
 */
export function buildBallTrajectory({
  from, to, movement = null, durationMs = 400, pathSegments = [],
  ballResult = null, keeperAction = null, heightCue = false,
} = {}) {
  if (!from || !to) return [];
  const duration = Math.max(1, Number(durationMs) || 400);
  const baseMode = movementMode(movement, ballResult, keeperAction);
  // A tackle/reception declaration with identical endpoints is not a ball
  // rolling loose into the player's body. Until an outcome transfers or
  // releases ownership it remains controlled at the player's feet.
  const mode = sameXY(from, to) && baseMode === "rolling"
    ? "controlled-ground"
    : baseMode;
  const peak = peakHeightFor(movement, mode, heightCue);
  const path = pathSegments.length >= 2
    ? pathSegments.map(clonePoint)
    : [clonePoint(from), clonePoint(to)];
  if (sameXY(from, to) && path.every((point) => sameXY(point, from))) {
    return [
      { progress: 0, position: { ...clonePoint(from), height: sampleHeight(0, peak, mode) }, velocity: { x: 0, y: 0 }, verticalVelocity: 0, mode },
      { progress: 1, position: { ...clonePoint(to), height: sampleHeight(1, peak, mode) }, velocity: { x: 0, y: 0 }, verticalVelocity: 0, mode },
    ];
  }
  const samples = SAMPLE_PROGRESS.map((progress) => {
    const position = polylinePoint(path, travelRatio(progress, mode, movement));
    position.height = sampleHeight(progress, peak, mode);
    return { progress, position, velocity: { x: 0, y: 0 }, verticalVelocity: 0, mode };
  });
  // Contacts and restarts depend on exact resolver endpoints. Apply them
  // before deriving velocity so x/y/z and their tangents agree.
  samples[0].position = { ...clonePoint(from), height: mode === "held" ? peak : 0 };
  samples.at(-1).position = { ...clonePoint(to), height: mode === "held" ? peak : 0 };
  for (let index = 0; index < samples.length; index += 1) {
    const previous = samples[Math.max(0, index - 1)];
    const next = samples[Math.min(samples.length - 1, index + 1)];
    const elapsed = Math.max(1, (next.progress - previous.progress) * duration);
    samples[index].velocity = {
      x: (next.position.x - previous.position.x) / elapsed,
      y: (next.position.y - previous.position.y) / elapsed,
    };
    samples[index].verticalVelocity = (next.position.height - previous.position.height) / elapsed;
  }
  if (mode === "controlled-ground") {
    samples.at(-1).velocity = { x: 0, y: 0 };
    samples.at(-1).verticalVelocity = 0;
  }
  if (mode === "held") {
    for (const sample of samples) {
      sample.velocity = { x: 0, y: 0 };
      sample.verticalVelocity = 0;
    }
  }
  return samples;
}

export function createBallState({
  position, ownerId = null, ownerRole = null, lastTouchId = ownerId, lastTouch = null,
} = {}) {
  const held = ownerId && ownerRole === "keeper";
  const touch = cloneLastTouch(lastTouch);
  return {
    position: clonePoint(position),
    velocity: { x: 0, y: 0 },
    incomingVelocity: { x: 0, y: 0 },
    height: held ? 1.1 : 0,
    verticalVelocity: 0,
    phase: held ? "held" : ownerId ? "controlled-ground" : "loose",
    ownerId: ownerId ?? null,
    lastTouchId: touch?.playerId ?? lastTouchId ?? null,
    lastTouch: touch,
  };
}

export function transitionBallState({
  previous = null, endpoint, ownerId = null, ownerRole = null,
  restart = null, trajectory = [], lastTouchId = null, lastTouch = null,
} = {}) {
  const lastSample = trajectory.at(-1) || null;
  const incomingVelocity = cloneVelocity(lastSample?.velocity ?? previous?.velocity);
  const held = ownerId && ownerRole === "keeper";
  const controlled = Boolean(ownerId);
  const touch = cloneLastTouch(lastTouch);
  const resolvedLastTouchId = touch?.playerId ?? lastTouchId ?? previous?.lastTouchId ?? null;
  const resolvedLastTouch = touch
    ?? (resolvedLastTouchId === previous?.lastTouchId ? cloneLastTouch(previous?.lastTouch) : null);
  return {
    position: clonePoint(endpoint ?? previous?.position),
    velocity: controlled || restart ? { x: 0, y: 0 } : incomingVelocity,
    incomingVelocity,
    height: held ? 1.1 : Number(lastSample?.position?.height) || 0,
    verticalVelocity: controlled || restart ? 0 : Number(lastSample?.verticalVelocity) || 0,
    phase: restart ? "dead" : held ? "held" : controlled ? "controlled-ground" : "loose",
    ownerId: ownerId ?? null,
    lastTouchId: resolvedLastTouchId,
    lastTouch: resolvedLastTouch,
  };
}

/** Friction-projected location used by players deciding where to meet it. */
export function predictBallPosition(ballState = null, horizonMs = 320) {
  if (!ballState?.position) return null;
  const duration = clamp(0, 900, Number(horizonMs) || 0);
  if (ballState.phase !== "loose" || duration === 0) return clonePoint(ballState.position);
  // Exponential turf drag integrated over the look-ahead interval. Velocity
  // is percentage-pitch units/ms, matching authored ball trajectories.
  const dragPerMs = 0.0024;
  const travelMs = (1 - Math.exp(-dragPerMs * duration)) / dragPerMs;
  return {
    ...clonePoint(ballState.position),
    x: clamp(0, 100, ballState.position.x + (ballState.velocity?.x || 0) * travelMs),
    y: clamp(0, 100, ballState.position.y + (ballState.velocity?.y || 0) * travelMs),
    height: Math.max(0, Number(ballState.height) + (Number(ballState.verticalVelocity) || 0) * travelMs),
  };
}

/** Deterministic loose-ball race: real acceleration/top-speed reach, then anticipation. */
export function selectLooseBallRecovery(players = [], ballState = null) {
  if (!ballState?.position || !players.length) return null;
  const interceptPoint = predictBallPosition(ballState, 320);
  return players
    .filter(Boolean)
    .map((entry) => {
      const anticipation = playerAttribute(entry.player, "Anticipation");
      const distance = yardDistance(entry, interceptPoint);
      return { entry, arrival: timeToReach(entry.player, distance) - anticipation * 0.012 };
    })
    .sort((left, right) => left.arrival - right.arrival || String(left.entry.id).localeCompare(String(right.entry.id)))[0]?.entry ?? null;
}
