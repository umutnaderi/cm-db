// World Motion Contract v1 -- who is allowed to move a player, and when.
//
// See MATCH_ENGINE_ARCHITECTURE.md for the full pipeline. This module is
// the enforcement point for one rule in it:
//
//   A tactical planner may decide WHERE a player wants to be. Only the
//   motion layer may decide WHERE THEY ACTUALLY ARE.
//
// The five distinct things that used to get conflated into a single
// `Object.assign(entry, target)`:
//
//   1. intention          -- what this player is trying to do
//                            ("recovery-track", "support-run", "press").
//   2. intentionTarget    -- the tactical destination that intention
//                            implies. NOT a position anybody is at.
//   3. gait / effort      -- how hard they are willing to run at it
//                            ("full-sprint", "controlled-sprint", "jog").
//   4. trajectory         -- the real, physically-limited path actually
//                            covered during one authored window, from the
//                            player's CURRENT position and CURRENT
//                            velocity (playerKinetics.js reachIn(), via
//                            matchMovementTiming.js).
//   5. authoritative      -- where the trajectory genuinely ended. This,
//      position             and only this, may be written back onto a
//                            roster entry. Every later decision reads it.
//
// Playback interpolation is a SIXTH thing and lives entirely outside the
// engine: matchLabPlayback.js draws frames between authoritative
// positions and must never invent one.
//
// Nothing here reimplements physics. reachIn()/timeToReach()/topSpeed()/
// speedAtElapsed() (playerKinetics.js) remain the only kinematics model;
// sampleContinuousTrajectory() (matchMovementTiming.js) remains the only
// trajectory sampler; matchMotion.js's resolveMotionBatch() remains the
// batch planner with its own intention stickiness. This module is the
// thin, DOM-free contract layer over them: one motion record shape, one
// "advance an intention over elapsed time" entry point, and one audit
// that says whether an authored move was physically honest.

import { PITCH_LENGTH_YARDS, PITCH_WIDTH_YARDS } from "./pitchGeometry.js";
import { reachIn, speedAtElapsed, timeToReach, topSpeed, timeToTopSpeed, turnRetention,
  diveReachYards, diveLaunchSpeedYps, DIVE_COMMIT_SECONDS } from "./playerKinetics.js";
import {
  CONTACT_REACTION_DELAY_MS, movementDistanceYards, sampleContinuousTrajectory,
} from "./matchMovementTiming.js";

// Trajectory sample velocities are expressed in percent-of-pitch per
// millisecond (the coordinate space every position in this engine uses),
// which is deliberately anisotropic: 1% of width is a different number of
// yards from 1% of length. These two helpers are the ONLY place that
// conversion is written down, so a real yd/s speed and a renderable
// velocity vector can never drift apart.
export function speedYpsFromVelocity(velocity) {
  if (!velocity) return 0;
  const dx = (Number(velocity.x) || 0) * (PITCH_WIDTH_YARDS / 100);
  const dy = (Number(velocity.y) || 0) * (PITCH_LENGTH_YARDS / 100);
  return Math.hypot(dx, dy) * 1000;
}

export function velocityAlong(from, to, speedYps) {
  const speed = Math.max(0, Number(speedYps) || 0);
  if (!from || !to || speed <= 0) return { x: 0, y: 0 };
  const dx = (Number(to.x) || 0) - (Number(from.x) || 0);
  const dy = (Number(to.y) || 0) - (Number(from.y) || 0);
  const yardsX = dx * (PITCH_WIDTH_YARDS / 100);
  const yardsY = dy * (PITCH_LENGTH_YARDS / 100);
  const length = Math.hypot(yardsX, yardsY);
  if (!length) return { x: 0, y: 0 };
  // Unit heading in yards, scaled to the requested real speed, converted
  // back into percent-of-pitch per millisecond.
  const yardsPerMsX = (yardsX / length) * speed / 1000;
  const yardsPerMsY = (yardsY / length) * speed / 1000;
  return {
    x: yardsPerMsX / (PITCH_WIDTH_YARDS / 100),
    y: yardsPerMsY / (PITCH_LENGTH_YARDS / 100),
  };
}

/** Facing, in degrees, implied by a velocity (null when standing still). */
export function facingFromVelocity(velocity) {
  if (!velocity) return null;
  const dx = (Number(velocity.x) || 0) * (PITCH_WIDTH_YARDS / 100);
  const dy = (Number(velocity.y) || 0) * (PITCH_LENGTH_YARDS / 100);
  if (!dx && !dy) return null;
  return (Math.atan2(dy, dx) * 180) / Math.PI;
}

/**
 * The per-player motion record. A superset of the {velocity, intention,
 * lastPosition} shape matchMotion.js's resolveMotionBatch() already
 * writes into motionContext.state.players[id] -- deliberately the same
 * object, extended, never a second parallel store that could drift.
 */
export function createMotionRecord({
  position = null, velocity = { x: 0, y: 0 }, facing = null,
  intention = null, intentionTarget = null, gait = null, simulationTimeMs = 0,
} = {}) {
  return {
    position: position ? { ...position } : null,
    velocity: { x: Number(velocity?.x) || 0, y: Number(velocity?.y) || 0 },
    facing: facing ?? facingFromVelocity(velocity),
    intention,
    intentionTarget: intentionTarget ? { ...intentionTarget } : null,
    gait,
    simulationTimeMs: Number(simulationTimeMs) || 0,
    // resolveMotionBatch()/reactOffBallContinuous() both read this name.
    lastPosition: position ? { ...position } : null,
  };
}

/** Reads whatever a motionContext already holds for `id` as a full record. */
export function readMotionRecord(motionContext, id, fallbackPosition = null) {
  const stored = motionContext?.state?.players?.[String(id)] ?? null;
  if (!stored) return createMotionRecord({ position: fallbackPosition });
  return createMotionRecord({
    position: stored.lastPosition ?? fallbackPosition,
    velocity: stored.velocity,
    facing: stored.facing ?? facingFromVelocity(stored.velocity),
    intention: stored.intention?.action ?? stored.intention ?? null,
    intentionTarget: stored.intention?.target ?? stored.intentionTarget ?? null,
    gait: stored.gait ?? null,
    simulationTimeMs: stored.simulationTimeMs ?? 0,
  });
}

/**
 * Writes a motion record back, preserving the exact key names
 * resolveMotionBatch()/reactOffBallContinuous() already consume
 * (velocity / intention{action,role,target,startedTick,age,retained} /
 * lastPosition) and adding this contract's own fields alongside them.
 * Bumps the context tick the same way resolveMotionBatch() does.
 */
export function writeMotionRecord(motionContext, id, {
  position, velocity, intention = null, intentionTarget = null, role = null,
  gait = null, simulationTimeMs = null,
} = {}) {
  if (!motionContext) return;
  const key = String(id);
  const tick = (motionContext.state?.tick || 0) + 1;
  const players = { ...(motionContext.state?.players || {}) };
  players[key] = {
    ...(players[key] || {}),
    velocity: { x: Number(velocity?.x) || 0, y: Number(velocity?.y) || 0 },
    intention: intention
      ? {
          action: intention, role,
          target: intentionTarget ? { ...intentionTarget } : null,
          startedTick: tick, age: 0, retained: false,
        }
      : (players[key]?.intention ?? null),
    lastPosition: position ? { ...position } : (players[key]?.lastPosition ?? null),
    facing: facingFromVelocity(velocity),
    gait,
    ...(simulationTimeMs === null ? {} : { simulationTimeMs }),
  };
  motionContext.state = { tick, players };
}

/**
 * THE entry point: turn an intention into real, physically-limited motion
 * over a real elapsed window.
 *
 * Given where a player is now, how fast they are already moving, and
 * where they WANT to get to, returns where they genuinely end up after
 * `elapsedMs` -- plus the trajectory to render it and the velocity they
 * are carrying when the window closes. A window too short to reach the
 * intentionTarget produces a partial advance and a non-zero exit
 * velocity, never a jump to the target: that is the whole point.
 *
 * `reactionDelayMs` models a genuine new stimulus (they have to notice
 * first). A player already running toward the same thing should pass 0 --
 * there is nothing new to react to, and charging them a fresh reaction
 * delay every beat is exactly the stop-start artefact this contract
 * exists to remove.
 */
/**
 * Intentions that mean "get there as fast as you can". These are never
 * paced: a player going for the ball who could arrive early SHOULD arrive
 * early, and every one of these is an arrival race something else depends
 * on. Everything not listed here is positional -- taking up a shape, a
 * lane, a line -- and is paced across its window instead of sprinting and
 * standing.
 */
export const CHASE_INTENTIONS = Object.freeze(new Set([
  "run-in-behind", "press-ball", "recover", "delay", "track", "challenge",
  "chase", "receive-pass", "receive-pass-late", "escape", "beaten",
  "claim-loose-ball", "scramble", "close-down", "intercept",
  "keeper-sweep", "keeper-close-down", "keeper-recover", "cover-goal",
  "respect-held-ball",
]));

export function advanceMotion({
  from, intentionTarget, player, elapsedMs,
  incomingVelocity = null, reactionDelayMs = 0, sampleCount = 12,
  intention = null, gait = null, role = null,
  paceToArrival = undefined, continuesAfter = false,
}) {
  const windowMs = Math.max(0, Number(elapsedMs) || 0);
  const incomingSpeedYps = Math.min(topSpeed(player), speedYpsFromVelocity(incomingVelocity));
  const desiredVelocity = velocityAlong(from, intentionTarget, 1);
  const dx = desiredVelocity.x * PITCH_WIDTH_YARDS;
  const dy = desiredVelocity.y * PITCH_LENGTH_YARDS;
  const vx = (incomingVelocity?.x || 0) * PITCH_WIDTH_YARDS;
  const vy = (incomingVelocity?.y || 0) * PITCH_LENGTH_YARDS;
  const denominator = Math.hypot(dx, dy) * Math.hypot(vx, vy);
  const turnAngleDegrees = denominator ? Math.acos(Math.max(-1, Math.min(1, (dx * vx + dy * vy) / denominator))) * 180 / Math.PI : 0;
  const initialSpeedYps = incomingSpeedYps * turnRetention(player, turnAngleDegrees);
  const totalYards = movementDistanceYards(from, intentionTarget);
  const usableSeconds = Math.max(0, (windowMs - Math.max(0, reactionDelayMs)) / 1000);
  const coverableYards = reachIn(player, usableSeconds, initialSpeedYps);
  const reachedTarget = coverableYards >= totalYards - 0.001;
  // Playback Fluidity v1 (2026-09-05) -- a real reported bug: "players
  // freeze". A positional job given a long window (an off-ball reshape
  // during a six-second keeper hold, say) used to be run FLAT OUT: the
  // player covered their seven yards in about two seconds and then stood
  // perfectly still for the remaining four. The physics inside that window
  // were individually correct and the result was still wrong, because a
  // player adjusting their position over six seconds jogs it -- they do not
  // sprint and freeze.
  //
  // paceToArrival stretches reachIn()'s OWN curve to arrive exactly as the
  // window closes; it does not invent a speed, and it never applies when the
  // target is genuinely out of reach, where arriving late is the honest
  // answer and must stand.
  //
  // Deliberately NOT applied to chasing intentions. Going for the ball,
  // pressing, tracking a runner or recovering as the last man are all
  // maximum-effort actions where arriving early is the entire point, and
  // pacing them would be a real behavioural regression, not a smoother one.
  const pacing = reachedTarget && (paceToArrival ?? !CHASE_INTENTIONS.has(String(intention ?? "")));
  const trajectory = sampleContinuousTrajectory({
    from, to: intentionTarget, player, totalMs: windowMs,
    reactionDelayMs, sampleCount,
    incomingVelocity,
    initialSpeedYps,
    paceToArrival: pacing,
    // An advance that ran out of window has NOT arrived anywhere -- it is
    // a player mid-stride, and the next window must continue that stride
    // rather than restart it from rest.
    continuesAfter: continuesAfter || !reachedTarget,
    exitSpeedYps: reachedTarget && !continuesAfter ? null : speedAtElapsed(player, usableSeconds, initialSpeedYps),
  });
  const position = trajectory.length
    ? { ...trajectory[trajectory.length - 1].position, zone: intentionTarget?.zone ?? from?.zone ?? null }
    : { ...from };
  const exitSpeedYps = reachedTarget && !continuesAfter
    ? 0
    : speedAtElapsed(player, usableSeconds, initialSpeedYps);
  const velocity = reachedTarget && !continuesAfter
    ? { x: 0, y: 0 }
    : velocityAlong(from, intentionTarget, exitSpeedYps);
  if (trajectory.length) trajectory[trajectory.length - 1].velocity = { ...velocity };
  return {
    position,
    velocity,
    trajectory,
    distanceYards: movementDistanceYards(from, position),
    remainingYards: Math.max(0, totalYards - movementDistanceYards(from, position)),
    reachedTarget,
    entrySpeedYps: initialSpeedYps,
    incomingSpeedYps,
    turnAngleDegrees,
    requestedDistanceYards: totalYards,
    availableDurationMs: windowMs,
    reactionDelayMs,
    accelerationYps2: topSpeed(player) / timeToTopSpeed(player),
    withinPhysicalLimit: movementDistanceYards(from, position) <= coverableYards + 0.001,
    exitSpeedYps,
    intention,
    intentionTarget: intentionTarget ? { ...intentionTarget } : null,
    gait,
    role,
  };
}

/**
 * Was this authored move physically honest? A move that covers more
 * ground than the player could possibly cover in the window it was
 * scheduled into is a teleport, however smoothly it is drawn.
 *
 * Returns the measured numbers either way so callers can show them
 * (Match Lab's Movement timing panel) as well as assert on them (tests).
 * `initialSpeedYps` matters: a player already at full pace legitimately
 * covers more ground in the same window than one starting from rest.
 */
// A keeper may commit one dive instead of running through the whole window.
// This query is shared by the contact race, authored motion and its audit.
export function keeperSaveTravel(player, seconds) {
  const elapsed = Math.max(0, Number(seconds) || 0);
  const diveSeconds = Math.min(elapsed, DIVE_COMMIT_SECONDS);
  const runSeconds = elapsed - diveSeconds;
  const runningYards = reachIn(player, elapsed);
  const divingYards = reachIn(player, runSeconds) + diveReachYards(player, diveSeconds);
  return divingYards > runningYards
    ? { distanceYards: divingYards, runSeconds, diveSeconds, motionModel: "keeper-dive" }
    : { distanceYards: runningYards, runSeconds: elapsed, diveSeconds: 0, motionModel: "running" };
}

/** Author the SAME committed action used to decide a keeper's shot contact. */
export function advanceKeeperSaveMotion({ from, intentionTarget, player, elapsedMs,
  reactionDelayMs = 0, sampleCount = 12 }) {
  const windowMs = Math.max(0, Number(elapsedMs) || 0);
  const reactionMs = Math.max(0, reactionDelayMs);
  const usableSeconds = Math.max(0, (windowMs - reactionMs) / 1000);
  const travel = keeperSaveTravel(player, usableSeconds);
  const requestedDistanceYards = movementDistanceYards(from, intentionTarget);
  const distanceAt = seconds => seconds <= travel.runSeconds
    ? reachIn(player, seconds)
    : reachIn(player, travel.runSeconds) + diveReachYards(player, seconds - travel.runSeconds);
  // Preserve the launch instant as a physical boundary, not a renderer ease.
  const times = new Set([0, windowMs, Math.min(windowMs, reactionMs),
    Math.min(windowMs, reactionMs + travel.runSeconds * 1000)]);
  for (let i = 1; i < sampleCount; i++) times.add(windowMs * i / sampleCount);
  const trajectory = [...times].sort((a, b) => a - b).map(timeMs => {
    const seconds = Math.max(0, (timeMs - reactionMs) / 1000);
    const distance = Math.min(requestedDistanceYards, distanceAt(seconds));
    const ratio = requestedDistanceYards > 0 ? distance / requestedDistanceYards : 0;
    const speed = timeMs <= reactionMs || distance >= requestedDistanceYards ? 0
      : travel.diveSeconds > 0 && seconds >= travel.runSeconds
        ? diveLaunchSpeedYps(player) : speedAtElapsed(player, seconds);
    return { progress: windowMs ? timeMs / windowMs : 0, timeMs,
      position: { ...from, x: from.x + (intentionTarget.x - from.x) * ratio,
        y: from.y + (intentionTarget.y - from.y) * ratio },
      velocity: velocityAlong(from, intentionTarget, speed) };
  });
  const last = trajectory.at(-1);
  return { position: last.position, velocity: last.velocity, trajectory,
    ...travel, distanceYards: Math.min(requestedDistanceYards, travel.distanceYards),
    requestedDistanceYards, availableDurationMs: windowMs, reactionDelayMs: reactionMs,
    reachedTarget: travel.distanceYards >= requestedDistanceYards,
    entrySpeedYps: 0, exitSpeedYps: speedYpsFromVelocity(last.velocity),
    intention: "intercept", intentionTarget, withinPhysicalLimit: true };
}

export function auditMoveSpeed({
  player, distanceYards, scheduledDurationMs,
  initialSpeedYps = 0, reactionDelayMs = 0, toleranceYards = 0.35, motionModel = "running",
}) {
  const distance = Math.max(0, Number(distanceYards) || 0);
  const windowMs = Math.max(0, Number(scheduledDurationMs) || 0);
  const usableSeconds = Math.max(0, (windowMs - Math.max(0, reactionDelayMs)) / 1000);
  const reachableYards = motionModel === "keeper-dive"
    ? keeperSaveTravel(player, usableSeconds).distanceYards
    : reachIn(player, usableSeconds, initialSpeedYps);
  let naturalEtaMs = timeToReach(player, distance, initialSpeedYps) * 1000;
  if (motionModel === "keeper-dive" && distance > 0) {
    let low = 0, high = timeToReach(player, distance);
    for (let i = 0; i < 40; i++) {
      const middle = (low + high) / 2;
      if (keeperSaveTravel(player, middle).distanceYards < distance) low = middle;
      else high = middle;
    }
    naturalEtaMs = high * 1000;
  }
  const averageSpeedYps = windowMs > 0 ? distance / (windowMs / 1000) : 0;
  return {
    distanceYards: distance,
    scheduledDurationMs: windowMs,
    reachableYards,
    naturalEtaMs,
    averageSpeedYps,
    topSpeedYps: topSpeed(player),
    // Judged on DISTANCE, not on average speed: a move that begins at
    // real pace can legitimately average more than a from-rest player
    // would manage, and reachIn() already accounts for exactly that.
    withinPhysicalLimit: distance <= reachableYards + toleranceYards,
    overrunYards: Math.max(0, distance - reachableYards - toleranceYards),
  };
}

export { CONTACT_REACTION_DELAY_MS };

/** Continue committed jobs through a physical window. No new tactical decision. */
export function continueMotionIntentions(entries, motionContext, elapsedMs, excludedIds = []) {
  const excluded = new Set(excludedIds.filter(id => id != null).map(String));
  const moves = [];
  for (const entry of entries) {
    if (excluded.has(String(entry.id))) continue;
    const from = { x: entry.x, y: entry.y, zone: entry.zone ?? null };
    const record = readMotionRecord(motionContext, entry.id, from);
    if (!record.intentionTarget || !record.intention || movementDistanceYards(from, record.intentionTarget) < 0.001) continue;
    const motion = advanceMotion({ from, intentionTarget: record.intentionTarget,
      player: entry.player, elapsedMs, incomingVelocity: record.velocity,
      intention: record.intention, gait: record.gait, reactionDelayMs: 0 });
    moves.push({ player: entry, from, to: motion.position, trajectory: motion.trajectory,
      action: record.intention, intention: { action: record.intention, target: record.intentionTarget, retained: true },
      reactionDelayMs: 0, motion });
    writeMotionRecord(motionContext, entry.id, { position: motion.position, velocity: motion.velocity,
      intention: record.intention, intentionTarget: record.intentionTarget, gait: record.gait });
    Object.assign(entry, motion.position);
  }
  return moves;
}
