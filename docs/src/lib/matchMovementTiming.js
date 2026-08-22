import { reachIn, timeToReach, topSpeed } from "./playerKinetics.js";
import { PITCH_LENGTH_YARDS, PITCH_WIDTH_YARDS } from "./pitchGeometry.js";

export const CONTACT_REACTION_DELAY_MS = 120;

export function movementDistanceYards(from, to) {
  if (!from || !to) return 0;
  const dx = ((Number(to.x) || 0) - (Number(from.x) || 0)) * PITCH_WIDTH_YARDS / 100;
  const dy = ((Number(to.y) || 0) - (Number(from.y) || 0)) * PITCH_LENGTH_YARDS / 100;
  return Math.hypot(dx, dy);
}

export function pointAlongMovement(from, to, distanceYards) {
  const total = movementDistanceYards(from, to);
  if (!from || !to || total <= 0) return to ? { ...to } : from ? { ...from } : null;
  const ratio = Math.max(0, Math.min(1, (Number(distanceYards) || 0) / total));
  return {
    x: from.x + (to.x - from.x) * ratio,
    y: from.y + (to.y - from.y) * ratio,
    zone: ratio >= 1 ? (to.zone ?? from.zone ?? null) : (from.zone ?? to.zone ?? null),
  };
}

/**
 * Schedule an arrival against an already-authored ball-flight window.
 * The player waits when nearby, starts earlier when farther away, and is
 * never stretched across the whole flight merely because contact happens at
 * its end. If the target is physically unreachable, reachablePoint is the
 * honest position at the contact whistle; callers must not award control.
 */
export function contactArrivalTiming({
  player,
  from,
  to,
  flightStartMs = 0,
  contactTimeMs = 0,
  reactionDelayMs = CONTACT_REACTION_DELAY_MS,
  reachAllowanceYards = 0,
} = {}) {
  const distanceYards = movementDistanceYards(from, to);
  const appliedReachAllowanceYards = Math.max(
    0,
    Math.min(distanceYards, Number(reachAllowanceYards) || 0),
  );
  const locomotionDistanceYards = Math.max(0, distanceYards - appliedReachAllowanceYards);
  const naturalEtaMs = timeToReach(player, locomotionDistanceYards) * 1000;
  const reactionAtMs = Math.min(contactTimeMs, flightStartMs + Math.max(0, reactionDelayMs));
  const availableMs = Math.max(0, contactTimeMs - reactionAtMs);
  const reachable = naturalEtaMs <= availableMs + 0.5;
  const reachableDistanceYards = reachable
    ? distanceYards
    : Math.min(distanceYards, reachIn(player, availableMs / 1000));
  const moveEndMs = contactTimeMs;
  const moveStartMs = reachable
    ? Math.max(reactionAtMs, contactTimeMs - naturalEtaMs)
    : reactionAtMs;
  const scheduledDurationMs = Math.max(0, moveEndMs - moveStartMs);
  return {
    distanceYards,
    locomotionDistanceYards,
    reachAllowanceYards: appliedReachAllowanceYards,
    naturalEtaMs,
    reactionDelayMs: Math.max(0, reactionDelayMs),
    availableMs,
    reachable,
    reachableDistanceYards,
    reachablePoint: pointAlongMovement(from, to, reachableDistanceYards),
    moveStartMs,
    moveEndMs,
    scheduledDurationMs,
    averageSpeedYardsPerSecond: scheduledDurationMs > 0
      ? reachableDistanceYards / (scheduledDurationMs / 1000)
      : 0,
    topSpeedYardsPerSecond: topSpeed(player),
  };
}

// ---------------------------------------------------------------------------
// Continuous World Motion During Ball Flight v1 (2026-08-20). Replaces the
// old per-reaction-beat model (fixed-duration ATT/DEF/GK.ADJUST events,
// velocity zeroed at every beat boundary, a forced "converge" burst
// afterward) with ONE continuous, physically-limited trajectory per player
// spanning the WHOLE ball-flight interval, and resolves interceptions from
// a genuine physical race against the ball's own independent path instead
// of a static-geometry proximity check followed by an attribute dice roll.
//
// Deliberately NOT a full N-body physics engine: every off-ball player is
// given exactly ONE tactical destination for the whole flight (computed
// once, same as before), and moves toward it in a straight line at
// whatever speed reachIn()/timeToReach() say they're physically capable of
// -- no acceleration curve beyond what those functions already model, no
// steering/avoidance. That's enough to satisfy every acceptance
// requirement (no stop-restart, Pace/Acceleration-driven arrival, a real
// speed ceiling, no sudden reception speed change) without inventing a
// physics library. Mid-flight tactical RETARGETING (a player's own ideal
// spot changing while the ball is still in the air) is explicitly out of
// scope for v1 -- see MATCH_LAB_PLAN.md.
// ---------------------------------------------------------------------------

// Position after `elapsedSeconds` of continuous movement from `from`
// toward `to`, honoring a real reaction delay (no ground covered at all
// until it elapses) and a real physical speed ceiling (reachIn() is a
// closed-form accelerate-then-cap function -- never exceeds the player's
// own topSpeed()). Monotonic in elapsedSeconds by construction: calling
// this at two different times for the same player/from/to can never
// produce a "step backward," the exact no-stop-restart guarantee this
// whole model exists for.
export function continuousPositionAtElapsed({
  from, to, player, elapsedSeconds, reactionDelaySeconds = 0,
} = {}) {
  const availableSeconds = Math.max(0, (Number(elapsedSeconds) || 0) - Math.max(0, Number(reactionDelaySeconds) || 0));
  const distanceYards = reachIn(player, availableSeconds);
  return pointAlongMovement(from, to, distanceYards);
}

// A dense, uniformly-time-spaced sample list of the same curve above, in
// the exact {progress, position} shape traceEvent()'s own playerMoves[].trajectory
// already accepts (buildMatchLabPlaybackPlan() linearly interpolates
// BETWEEN consecutive samples via sampleTrack()'s existing lerp fallback
// -- no velocity field needed here, and none is supplied, deliberately:
// supplying one would flip that fallback into hermite blending, designed
// for a DIFFERENT, curved-trajectory use case this straight-line model
// doesn't need). sampleCount=10 is dense enough that even a fast player
// covering real ground over a multi-second flight looks smooth once
// linearly interpolated; higher would cost more trace/track size for no
// visible benefit.
export function sampleContinuousTrajectory({
  from, to, player, totalMs, reactionDelayMs = 0, sampleCount = 10,
} = {}) {
  const duration = Math.max(0, Number(totalMs) || 0);
  const samples = [];
  for (let index = 0; index <= sampleCount; index += 1) {
    const progress = index / sampleCount;
    const position = continuousPositionAtElapsed({
      from, to, player,
      elapsedSeconds: (progress * duration) / 1000,
      reactionDelaySeconds: reactionDelayMs / 1000,
    });
    samples.push({ progress, position });
  }
  return samples;
}

// The earliest instant (if any) at which ANY of `defenders` can PHYSICALLY
// have covered enough ground -- from their own real starting position,
// after their own reaction delay, at their own reachIn()-limited pace --
// to be standing where the ball itself genuinely is. The ball's own path
// (ballFrom -> ballTo over totalMs, constant pace -- the same straight-
// line ground-pass model resolvePass() already computes) is walked
// forward in fine time steps; at each step, every defender is checked
// against the SAME closed-form reachIn() this whole file already uses
// for the receiver. The first (x, defender) match wins -- a genuine
// race against an independently-computed path, never a proximity check
// against a STATIC point followed by an unrelated dice roll. Returns
// null when nobody can reach it before the ball arrives (a genuinely
// clean delivery) -- never fabricates a contest that isn't physically
// real. No randomness of any kind; identical inputs always produce an
// identical result, the same "replay reproduces identically" guarantee
// every other decision in this project already carries.
export function earliestReachableInterception({
  ballFrom, ballTo, totalMs, defenders = [],
  reactionDelayMs = CONTACT_REACTION_DELAY_MS,
  interceptRadiusYards = 1.5, sampleIntervalMs = 40,
} = {}) {
  const duration = Math.max(0, Number(totalMs) || 0);
  if (!defenders.length || duration <= 0) return null;
  const totalBallDistance = movementDistanceYards(ballFrom, ballTo);
  const steps = Math.max(1, Math.ceil(duration / Math.max(1, sampleIntervalMs)));
  for (let step = 0; step <= steps; step += 1) {
    const tMs = Math.min(duration, step * sampleIntervalMs);
    const ballPoint = pointAlongMovement(ballFrom, ballTo, (totalBallDistance * tMs) / duration);
    for (const defender of defenders) {
      const availableSeconds = Math.max(0, (tMs - reactionDelayMs) / 1000);
      const neededYards = movementDistanceYards(defender, ballPoint);
      const reachableYards = reachIn(defender.player, availableSeconds);
      if (reachableYards + interceptRadiusYards >= neededYards) {
        return { interceptor: defender, atMs: tMs, atPoint: ballPoint };
      }
    }
    if (tMs >= duration) break;
  }
  return null;
}
