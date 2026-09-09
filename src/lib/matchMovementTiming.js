import { reachIn, timeToReach, topSpeed, decelerationRate, timeToTopSpeed,
} from "./playerKinetics.js";
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
// Momentum Continuity v1 (2026-08-31) -- initialSpeedYps (optional,
// defaults to 0 -- every existing caller keeps identical behavior) is
// reachIn()'s own new starting-speed term, threaded straight through: a
// player already moving at real speed the instant this leg begins
// doesn't re-accelerate from rest just because a new leg/trajectory
// started.
// Stage 4, Playback Fluidity (2026-09-06) -- an arrival that comes to rest.
//
// continuousPositionAtElapsed() below runs a player flat out and then holds
// them on the target for whatever is left of the window. That is right for a
// leg that runs out of window (they are genuinely still mid-stride), but for
// a leg the player COMPLETES it produced an instant stop: the last moving
// playback keyframe still carried real speed and the next one carried none.
// Measured across the 15-fixture sweep, that accounted for 869 of 1172
// velocity seams and 67 of 82 early-finished tracks, concentrated in carries
// and positional adjusts.
//
// This plans the same leg as a real one: accelerate (from whatever speed the
// player already carries), optionally hold top speed, then brake to rest
// exactly ON the target using decelerationRate() -- the player's own
// Pace/Acceleration/Agility, not a new constant.
//
//   vPeak = min(topSpeed, sqrt((2*a*b*D + b*v0^2) / (a + b)))
//
// is the fastest this player may travel and still stop in D yards, from the
// standard pair of SUVAT segments joined at the peak.
//
// Returns null when the leg cannot be planned this way. The caller applies it
// ONLY when the whole profile fits inside the window, so the position at the
// window's end is identical to what the flat-out model already produced --
// the authoritative endpoint never moves, only the shape of the approach.
export function arrivalBrakeProfile({ player, totalYards, initialSpeedYps = 0 } = {}) {
  const distance = Math.max(0, Number(totalYards) || 0);
  if (!(distance > 0)) return null;
  const maximum = topSpeed(player);
  const accelerationRate = maximum / timeToTopSpeed(player);
  const brakeRate = decelerationRate(player);
  if (!(accelerationRate > 0) || !(brakeRate > 0)) return null;
  const start = Math.max(0, Math.min(maximum, Number(initialSpeedYps) || 0));
  const peak = Math.min(maximum, Math.sqrt(
    (2 * accelerationRate * brakeRate * distance + brakeRate * start * start)
    / (accelerationRate + brakeRate),
  ));
  // Already travelling faster than the leg can absorb: braking alone overruns
  // the target, so there is no rest-at-arrival plan to make.
  if (peak < start - 0.001) return null;
  const accelerateSeconds = (peak - start) / accelerationRate;
  const accelerateYards = ((start + peak) / 2) * accelerateSeconds;
  const brakeSeconds = peak / brakeRate;
  const brakeYards = (peak * peak) / (2 * brakeRate);
  const cruiseYards = Math.max(0, distance - accelerateYards - brakeYards);
  const cruiseSeconds = peak > 0 ? cruiseYards / peak : 0;
  return {
    distance, peakSpeedYps: peak, accelerateSeconds, accelerateYards,
    cruiseSeconds, cruiseYards, brakeSeconds, brakeYards,
    totalSeconds: accelerateSeconds + cruiseSeconds + brakeSeconds,
    accelerationRate, brakeRate, startSpeedYps: start,
  };
}

/** Distance covered along an arrivalBrakeProfile() after `seconds`. */
export function brakeProfileDistance(profile, seconds) {
  if (!profile) return 0;
  const elapsed = Math.max(0, Number(seconds) || 0);
  if (elapsed >= profile.totalSeconds) return profile.distance;
  if (elapsed <= profile.accelerateSeconds) {
    return profile.startSpeedYps * elapsed + 0.5 * profile.accelerationRate * elapsed * elapsed;
  }
  const cruising = elapsed - profile.accelerateSeconds;
  if (cruising <= profile.cruiseSeconds) {
    return profile.accelerateYards + profile.peakSpeedYps * cruising;
  }
  const braking = cruising - profile.cruiseSeconds;
  return profile.accelerateYards + profile.cruiseYards
    + profile.peakSpeedYps * braking - 0.5 * profile.brakeRate * braking * braking;
}

export function continuousPositionAtElapsed({
  from, to, player, elapsedSeconds, reactionDelaySeconds = 0, initialSpeedYps = 0,
} = {}) {
  const availableSeconds = Math.max(0, (Number(elapsedSeconds) || 0) - Math.max(0, Number(reactionDelaySeconds) || 0));
  const distanceYards = reachIn(player, availableSeconds, initialSpeedYps);
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
// Off-Ball Motion v3 (2026-08-26) -- a real reported bug: this always
// forced samples[0].velocity to {0,0}, regardless of whatever the player
// was ACTUALLY doing the instant before. Combined with a fresh reaction
// re-plan every ~220ms (see resolveCarry()/resolveDribble()'s own fix),
// that read as a hard stop-then-relaunch on every single beat, even for a
// player who was genuinely still running toward the same job. `incomingVelocity`
// (optional, defaults to null -- every existing caller that omits it keeps
// today's exact zero-start behavior) lets a caller that tracked the
// player's own real velocity a moment ago (motionContext.state, the SAME
// per-player record resolveMotionBatch()'s own target-smoothing already
// keeps) hand it in instead -- samples[0] then CONTINUES that motion
// rather than restarting it. Only ever used when the player was genuinely
// moving; a caller with no tracked velocity (or one who was truly idle)
// still gets the honest {0,0} start.
// Momentum Continuity v1 (2026-08-31) -- initialSpeedYps (optional,
// defaults to 0) is the scalar REAL-SPEED counterpart to incomingVelocity
// above: incomingVelocity only ever shaped the rendered tangent at
// samples[0]; this actually feeds continuousPositionAtElapsed()'s own
// reachIn() call, so a player already at real speed genuinely covers
// more ground this leg instead of re-accelerating from rest. Every
// existing caller that omits it keeps identical behavior.
export function sampleContinuousTrajectory({
  from, to, player, totalMs, reactionDelayMs = 0, sampleCount = 10, incomingVelocity = null,
  initialSpeedYps = 0, continuesAfter = false, exitSpeedYps = null, paceToArrival = false,
} = {}) {
  const duration = Math.max(0, Number(totalMs) || 0);
  // World Motion Contract v1 (2026-09-03) -- `paceToArrival` (opt-in,
  // default false: every existing caller is untouched) fixes a real
  // artefact of the max-effort model for legs the player can comfortably
  // make: reachIn() runs them there flat out, they arrive early, and then
  // they STAND STILL for the rest of the window. A carry chase hits this
  // on every touch (the ball's own roll sets the window; the carrier only
  // needs ~0.7yd of it), so every touch ended at a genuine dead stop --
  // which is what hermite then drew as the reported go-stop-go carry.
  // A real player paces a ball they are comfortably going to reach.
  // The acceleration SHAPE is preserved (this is reachIn()'s own curve,
  // normalized), only stretched to arrive exactly as the window closes --
  // never applied when the target is genuinely out of reach, where
  // arriving early is not the question and the honest short-fall must
  // stand.
  const paceSpan = Math.max(0, duration - Math.max(0, reactionDelayMs)) / 1000;
  const paceCeilingYards = reachIn(player, paceSpan, initialSpeedYps);
  const paceTotalYards = movementDistanceYards(from, to);
  const pacing = paceToArrival
    && paceTotalYards > 0
    && paceCeilingYards >= paceTotalYards
    && paceCeilingYards > 0;
  // Stage 4 -- see arrivalBrakeProfile()'s own header. Applied ONLY to a leg
  // the player both completes and genuinely stops on, and only when the whole
  // accelerate-cruise-brake plan fits inside the window. Both conditions
  // matter: `continuesAfter` marks a leg that is only a waypoint in a longer
  // run (a carry's per-touch chase), where braking to rest would be exactly
  // the go-stop-go bug pacing exists to remove; and requiring the profile to
  // fit means the position at the window's end is still the target, so no
  // authoritative coordinate moves -- only the approach stops being a dead
  // stop from full speed.
  const brakeProfile = !pacing && !continuesAfter && paceTotalYards > 0
    && paceCeilingYards >= paceTotalYards
    ? arrivalBrakeProfile({ player, totalYards: paceTotalYards, initialSpeedYps })
    : null;
  const braking = Boolean(brakeProfile) && brakeProfile.totalSeconds <= paceSpan + 1e-9;
  const samples = [];
  for (let index = 0; index <= sampleCount; index += 1) {
    const progress = index / sampleCount;
    const position = braking
      ? pointAlongMovement(
          from, to,
          brakeProfileDistance(
            brakeProfile,
            Math.max(0, (progress * duration - Math.max(0, reactionDelayMs)) / 1000),
          ),
        )
      : pacing
      ? pointAlongMovement(
          from, to,
          paceTotalYards * (reachIn(
            player,
            Math.max(0, (progress * duration - Math.max(0, reactionDelayMs)) / 1000),
            initialSpeedYps,
          ) / paceCeilingYards),
        )
      : continuousPositionAtElapsed({
          from, to, player,
          elapsedSeconds: (progress * duration) / 1000,
          reactionDelaySeconds: reactionDelayMs / 1000,
          initialSpeedYps,
        });
    samples.push({ progress, position });
  }
  const dtMs = duration / Math.max(1, sampleCount);
  for (let index = 0; index < samples.length; index += 1) {
    const previous = samples[Math.max(0, index - 1)];
    const next = samples[Math.min(samples.length - 1, index + 1)];
    const span = Math.max(1, (next.progress - previous.progress) * duration || dtMs);
    samples[index].velocity = {
      x: (next.position.x - previous.position.x) / span,
      y: (next.position.y - previous.position.y) / span,
    };
  }
  if (samples.length) {
    samples[0].velocity = incomingVelocity
      ? { x: Number(incomingVelocity.x) || 0, y: Number(incomingVelocity.y) || 0 }
      : { x: 0, y: 0 };
    const last = samples[samples.length - 1];
    const arrived = movementDistanceYards(last.position, to) < 0.35;
    // World Motion Contract v1 (2026-09-03) -- `arrived` zeroes the exit
    // velocity because a player who genuinely reached where they were
    // going has genuinely stopped, which is right for a reception or a
    // completed off-ball job. It is WRONG for a leg that is only a
    // waypoint in a longer continuous run: a carry's own per-touch chase
    // "arrives" at every single touch point, so this forced every touch
    // boundary to a dead stop and hermite playback then eased in and out
    // of each one -- the reported go-stop-go carry. `continuesAfter`
    // (opt-in, default false: every existing caller keeps today's exact
    // behavior) says this leg is a waypoint, not a destination.
    // `exitSpeedYps` optionally states the REAL speed being carried out
    // of it, in yd/s, when the caller tracked it (simulateCarryTouches()'s
    // own chained carrierSpeedYps) -- otherwise the honest finite
    // difference the loop above already computed is kept as-is.
    if (arrived && !continuesAfter) {
      last.velocity = { x: 0, y: 0 };
    } else if (continuesAfter && Number.isFinite(exitSpeedYps) && exitSpeedYps > 0) {
      const headingFrom = samples.length > 1 ? samples[samples.length - 2].position : from;
      const dx = ((last.position.x - headingFrom.x) * PITCH_WIDTH_YARDS) / 100;
      const dy = ((last.position.y - headingFrom.y) * PITCH_LENGTH_YARDS) / 100;
      const heading = Math.hypot(dx, dy);
      if (heading > 0) {
        // Scaled to the stated real speed, in the same percent-of-pitch
        // per millisecond units every other velocity in a trajectory uses.
        const scale = (exitSpeedYps / 1000) / heading;
        last.velocity = {
          x: ((dx * scale) / PITCH_WIDTH_YARDS) * 100,
          y: ((dy * scale) / PITCH_LENGTH_YARDS) * 100,
        };
      }
    }
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
