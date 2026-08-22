import { clamp } from "./matchEngineCore.js";
import {
  reigniteFactor, timeToTopSpeed, topSpeed, turnRetention,
} from "./playerKinetics.js";
import { fromYardPoint, toYardPoint, yardDistance } from "./spatialDecision.js";

const INTENTION_COMMIT_TICKS = 3;
const REACHED_TARGET_YARDS = 1;
const TRAJECTORY_PROGRESS = [0, 0.2, 0.4, 0.6, 0.8, 1];

function clonePoint(point) {
  return { x: Number(point.x), y: Number(point.y), zone: point.zone ?? null };
}

function cloneVelocity(velocity = null) {
  return velocity ? { x: Number(velocity.x) || 0, y: Number(velocity.y) || 0 } : { x: 0, y: 0 };
}

function magnitude(vector) {
  return Math.hypot(vector.x, vector.y);
}

function angleBetween(left, right) {
  const leftLength = magnitude(left);
  const rightLength = magnitude(right);
  if (!leftLength || !rightLength) return 0;
  const cosine = clamp(-1, 1, (left.x * right.x + left.y * right.y) / (leftLength * rightLength));
  return (Math.acos(cosine) * 180) / Math.PI;
}

function limitVector(vector, maximum) {
  const length = magnitude(vector);
  if (!length || length <= maximum) return cloneVelocity(vector);
  const ratio = maximum / length;
  return { x: vector.x * ratio, y: vector.y * ratio };
}

function approachWithin(from, target, maximumYards) {
  const distance = yardDistance(from, target);
  if (!distance || distance <= maximumYards) return clonePoint(target);
  const origin = toYardPoint(from);
  const destination = toYardPoint(target);
  const ratio = maximumYards / distance;
  return {
    ...fromYardPoint({
      x: origin.x + (destination.x - origin.x) * ratio,
      y: origin.y + (destination.y - origin.y) * ratio,
    }),
    zone: target.zone ?? from.zone ?? null,
  };
}

function stabilizeTarget(proposal, previous, tick) {
  const proposed = clonePoint(proposal.intentionTarget ?? proposal.target);
  const sameIntention = previous?.intention?.action === proposal.action
    && previous.intention.role === proposal.role;
  const age = sameIntention ? tick - previous.intention.startedTick : 0;
  const reached = sameIntention
    ? yardDistance(proposal.from, previous.intention.target) <= REACHED_TARGET_YARDS
    : true;
  const forced = proposal.action === "recover-onside";
  const retained = sameIntention && !reached && !forced && age < INTENTION_COMMIT_TICKS;

  if (!retained) {
    return {
      target: proposed,
      intention: {
        action: proposal.action, role: proposal.role,
        target: proposed, startedTick: tick, age: 0, retained: false,
      },
    };
  }

  // Keep most of the committed target while allowing the world snapshot to
  // pull it gradually. An attacking target may never be retained farther
  // goalward than the fresh, offside-safe proposal for this reaction.
  const oldTarget = previous.intention.target;
  const blended = {
    x: oldTarget.x * 0.7 + proposed.x * 0.3,
    y: oldTarget.y * 0.7 + proposed.y * 0.3,
    zone: proposed.zone ?? oldTarget.zone ?? null,
  };
  if (proposal.attackingDirection === "up") blended.y = Math.max(blended.y, proposed.y);
  if (proposal.attackingDirection === "down") blended.y = Math.min(blended.y, proposed.y);

  return {
    target: blended,
    intention: {
      ...previous.intention,
      target: blended,
      age,
      retained: true,
    },
  };
}

function hermitePoint(origin, destination, startVelocity, endVelocity, durationMs, progress) {
  const t = progress;
  const t2 = t * t;
  const t3 = t2 * t;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + t;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return {
    x: h00 * origin.x + h10 * startVelocity.x * durationMs
      + h01 * destination.x + h11 * endVelocity.x * durationMs,
    y: h00 * origin.y + h10 * startVelocity.y * durationMs
      + h01 * destination.y + h11 * endVelocity.y * durationMs,
  };
}

function hermiteVelocity(origin, destination, startVelocity, endVelocity, durationMs, progress) {
  const t = progress;
  const t2 = t * t;
  const dh00 = 6 * t2 - 6 * t;
  const dh10 = 3 * t2 - 4 * t + 1;
  const dh01 = -6 * t2 + 6 * t;
  const dh11 = 3 * t2 - 2 * t;
  return {
    x: (dh00 * origin.x + dh10 * startVelocity.x * durationMs
      + dh01 * destination.x + dh11 * endVelocity.x * durationMs) / durationMs,
    y: (dh00 * origin.y + dh10 * startVelocity.y * durationMs
      + dh01 * destination.y + dh11 * endVelocity.y * durationMs) / durationMs,
  };
}

/**
 * Builds a deterministic, velocity-bearing path between two authoritative
 * endpoints. Attribute data changes acceleration/turning texture only; it
 * never changes the tactical destination or consumes gameplay RNG.
 */
export function buildMotionTrajectory({
  from, to, player = null, previousVelocity = null, durationMs = 450,
  continuing = false,
} = {}) {
  const origin = clonePoint(from);
  const destination = clonePoint(to);
  const duration = Math.max(1, Number(durationMs) || 450);
  const dx = destination.x - origin.x;
  const dy = destination.y - origin.y;
  const distance = Math.hypot(dx, dy);
  if (distance < 0.0001) {
    const velocity = { x: 0, y: 0 };
    return {
      samples: [
        { progress: 0, position: origin, velocity },
        { progress: 1, position: destination, velocity },
      ],
      endVelocity: velocity,
    };
  }

  const direction = { x: dx / distance, y: dy / distance };
  const baselinePlayer = { current_ability: 100 };
  const kineticPlayer = player || baselinePlayer;
  const speedRatio = topSpeed(kineticPlayer) / topSpeed(baselinePlayer);
  const accelerationRatio = timeToTopSpeed(baselinePlayer) / timeToTopSpeed(kineticPlayer);
  const averageSpeed = distance / duration;
  const maximumTangentSpeed = averageSpeed * 1.8;
  const carried = limitVector(cloneVelocity(previousVelocity), maximumTangentSpeed);
  const turnAngle = angleBetween(carried, direction);
  const retainedThroughTurn = turnRetention(kineticPlayer, turnAngle);
  const carryFactor = continuing ? 0.72 * retainedThroughTurn : 0.18 * retainedThroughTurn;
  const launchSpeed = averageSpeed * 0.43 * accelerationRatio * reigniteFactor(kineticPlayer);
  const startVelocity = magnitude(carried) > 0.00001
    ? {
        x: carried.x * carryFactor + direction.x * launchSpeed * (1 - carryFactor),
        y: carried.y * carryFactor + direction.y * launchSpeed * (1 - carryFactor),
      }
    : { x: direction.x * launchSpeed, y: direction.y * launchSpeed };
  const arrivalSpeed = averageSpeed * 0.48 * speedRatio;
  const endVelocity = { x: direction.x * arrivalSpeed, y: direction.y * arrivalSpeed };

  const samples = TRAJECTORY_PROGRESS.map((progress) => {
    const raw = hermitePoint(origin, destination, startVelocity, endVelocity, duration, progress);
    const position = progress === 0
      ? origin
      : progress === 1
        ? destination
        : { x: clamp(0, 100, raw.x), y: clamp(0, 100, raw.y), zone: origin.zone };
    return {
      progress,
      position,
      velocity: hermiteVelocity(origin, destination, startVelocity, endVelocity, duration, progress),
    };
  });
  return { samples, endVelocity };
}

export function createMotionState() {
  return { tick: 0, players: {} };
}

/**
 * Resolves every proposed movement from the same world snapshot. Inputs and
 * prior state are left untouched; the returned state becomes the sole memory
 * carried into the next reaction.
 */
export function resolveMotionBatch(proposals = [], previousState = createMotionState(), {
  durationMs = 450,
} = {}) {
  const tick = (previousState.tick || 0) + 1;
  const proposalIds = new Set(proposals.map((proposal) => proposal.id));
  const nextPlayers = Object.fromEntries(Object.entries(previousState.players || {}).map(([id, value]) => [id, {
    ...value,
    velocity: proposalIds.has(id) ? cloneVelocity(value.velocity) : { x: 0, y: 0 },
    intention: value.intention
      ? { ...value.intention, target: clonePoint(value.intention.target) }
      : null,
    lastPosition: value.lastPosition ? clonePoint(value.lastPosition) : null,
  }]));
  const moves = proposals.map((proposal) => {
    const previous = previousState.players?.[proposal.id] || null;
    const stabilized = stabilizeTarget(proposal, previous, tick);
    const maximumAdvance = Math.max(0, yardDistance(proposal.from, proposal.target));
    const target = approachWithin(proposal.from, stabilized.target, maximumAdvance);
    const continuing = Boolean(previous && previous.intention?.action === stabilized.intention.action);
    const trajectory = buildMotionTrajectory({
      from: proposal.from,
      to: target,
      player: proposal.player,
      previousVelocity: previous?.velocity,
      durationMs,
      continuing,
    });
    const intention = { ...stabilized.intention, target: clonePoint(stabilized.intention.target) };
    nextPlayers[proposal.id] = {
      velocity: cloneVelocity(trajectory.endVelocity),
      intention,
      lastPosition: clonePoint(target),
    };
    return {
      id: proposal.id,
      from: clonePoint(proposal.from),
      to: clonePoint(target),
      action: proposal.action,
      role: proposal.role,
      trajectory: trajectory.samples,
      intention,
    };
  });
  return { moves, state: { tick, players: nextPlayers } };
}

export { INTENTION_COMMIT_TICKS };
