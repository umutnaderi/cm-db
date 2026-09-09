import { clamp } from "./matchEngineCore.js";

// ---------------------------------------------------------------------------
// Ground Roll v1 (2026-08-28) -- the ball is its own particle: a real
// position, a real velocity, and real turf friction. A touch/knock imparts
// an initial launch speed (the impulse); friction decelerates it from
// there, closed-form, until it naturally stops -- distance is never
// authored directly by a resolver, it's what the physics produces from
// however hard the touch was struck. A standalone leaf module (no imports
// from spatialDecision.js/matchPassFlight.js, which already import from
// each other) so both can pull in the SAME friction model without a
// circular dependency: today spatialDecision.js's own planCarryTouches()
// (a dribble's short self-pass-and-chase touches); designed to be reused
// later for a loose-ball deflection/rebound roll-out without inventing a
// second friction model.
// ---------------------------------------------------------------------------

// Real turf rolling deceleration for a struck football (~3.4-3.8 m/s^2 on
// grass at typical pitch pace), expressed in this project's own
// yards/second vocabulary.
export const GROUND_FRICTION_YPS2 = 3.7;

/** How far a ball travels before friction alone brings it to a stop. */
export function rollStopDistanceYards(launchSpeedYps) {
  const v0 = Math.max(0, Number(launchSpeedYps) || 0);
  return (v0 * v0) / (2 * GROUND_FRICTION_YPS2);
}

/** How long a ball rolls before friction alone brings it to a stop. */
export function rollStopDurationMs(launchSpeedYps) {
  const v0 = Math.max(0, Number(launchSpeedYps) || 0);
  return (v0 / GROUND_FRICTION_YPS2) * 1000;
}

/**
 * The launch speed a touch needs to travel exactly this far before
 * naturally stopping -- how a caller that already knows the real target
 * distance (a touch shortened to close a carry at its own decided
 * endpoint, rather than overshooting past it) asks for the speed that
 * physically produces it. Exact inverse of rollStopDistanceYards().
 */
export function rollLaunchSpeedForDistance(distanceYards) {
  return Math.sqrt(2 * GROUND_FRICTION_YPS2 * Math.max(0, Number(distanceYards) || 0));
}

/**
 * Real, closed-form time for a friction-decelerating roll to cover a given
 * distance -- the smaller (earlier) root of the SUVAT quadratic
 * (d = v0*t - 0.5*a*t^2), clamped at the roll's own natural stop. Used
 * when a touch is deliberately shortened (capped short of its own full
 * rollStopDistanceYards() reach), so its duration still reflects real
 * deceleration over that shorter distance rather than the full-roll time.
 */
export function rollDurationForDistance(launchSpeedYps, distanceYards) {
  const v0 = Math.max(0, Number(launchSpeedYps) || 0);
  if (v0 <= 0) return 0;
  const d = clamp(0, rollStopDistanceYards(v0), Number(distanceYards) || 0);
  const discriminant = Math.max(0, v0 * v0 - 2 * GROUND_FRICTION_YPS2 * d);
  return Math.max(0, ((v0 - Math.sqrt(discriminant)) / GROUND_FRICTION_YPS2) * 1000);
}

/** Distance covered by a friction-decelerating roll at an elapsed time. */
export function rollTraveledYards(launchSpeedYps, elapsedMs) {
  const v0 = Math.max(0, Number(launchSpeedYps) || 0);
  const tSec = Math.min(Math.max(0, Number(elapsedMs) || 0), rollStopDurationMs(v0)) / 1000;
  return Math.max(0, v0 * tSec - 0.5 * GROUND_FRICTION_YPS2 * tSec * tSec);
}
