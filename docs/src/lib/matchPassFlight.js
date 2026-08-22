import { clamp, playerAttribute } from "./matchEngineCore.js";
import { reachIn } from "./playerKinetics.js";
import { yardDistance, laneObstruction } from "./spatialDecision.js";
import {
  movementDistanceYards, pointAlongMovement, CONTACT_REACTION_DELAY_MS,
} from "./matchMovementTiming.js";

// ---------------------------------------------------------------------------
// Ball Flight v2, Vertical Slice 1 (2026-08-20) -- see MATCH_LAB_PLAN.md's
// "Ball Flight v2 Architecture" section for the full design rationale.
// Retires resolvePass()'s flat, always-ground, always-aimed-at-a-player-ID
// delivery model. A pass now has a real TYPE (ground/driven-ground/lofted/
// driven-aerial), chosen deterministically from distance + lane congestion
// + the passer's own attributes, a real independent flight (an intended
// point the passer aimed at, an actual endpoint the real accuracy-error
// model produces -- the two are never silently reconciled), and a genuine
// physical race where the intended receiver is just one candidate among
// the opponents, not evaluated on a separate privileged path. Through-ball,
// cross, shot, and every other movement type keep their own existing,
// untouched pipelines this slice.
// ---------------------------------------------------------------------------

export const CONTACT_HEIGHT_YARDS = 0.6;

const PASS_TYPE_PROFILE = {
  ground: { speedYardsPerSecond: 20, peakHeightYards: () => 0, accuracyMultiplier: 1.0 },
  "driven-ground": { speedYardsPerSecond: 26, peakHeightYards: () => 0, accuracyMultiplier: 1.25 },
  lofted: { speedYardsPerSecond: 16, peakHeightYards: (distanceYards) => clamp(1.5, 6, distanceYards * 0.09), accuracyMultiplier: 1.15 },
  "driven-aerial": { speedYardsPerSecond: 24, peakHeightYards: (distanceYards) => clamp(0.8, 2.5, distanceYards * 0.035), accuracyMultiplier: 1.35 },
};

const GROUND_MAX_YARDS = 15;
const DRIVEN_GROUND_MAX_YARDS = 35;
const DRIVEN_GROUND_MIN_OBSTRUCTION_CLEARANCE = 0.5;
const LONG_DRIVEN_AERIAL_MAX_OBSTRUCTION = 0.6;
const LONG_DRIVEN_AERIAL_MIN_POWER = 13;
const LONG_GROUND_MAX_OBSTRUCTION = 0.15;
const LONG_GROUND_MIN_POWER = 15;

function powerBlend(passer) {
  return (
    playerAttribute(passer, "Strength")
    + playerAttribute(passer, "Technique")
    + playerAttribute(passer, "Passing")
  ) / 3;
}

// Deterministic -- the passer's own skill and the geometry decide this,
// not a dice roll. See MATCH_LAB_PLAN.md for the full threshold table and
// the reasoning behind each one.
export function selectPassType({ passer, from, to, opponents = [] }) {
  const distanceYards = yardDistance(from, to);
  if (distanceYards <= GROUND_MAX_YARDS) return "ground";
  const obstruction = laneObstruction(from, to, opponents);
  if (distanceYards <= DRIVEN_GROUND_MAX_YARDS) {
    return obstruction < DRIVEN_GROUND_MIN_OBSTRUCTION_CLEARANCE ? "driven-ground" : "lofted";
  }
  const power = powerBlend(passer);
  if (obstruction < LONG_GROUND_MAX_OBSTRUCTION && power >= LONG_GROUND_MIN_POWER) return "driven-ground";
  if (obstruction < LONG_DRIVEN_AERIAL_MAX_OBSTRUCTION && power >= LONG_DRIVEN_AERIAL_MIN_POWER) return "driven-aerial";
  return "lofted";
}

export function passFlightProfile(passType, distanceYards) {
  const profile = PASS_TYPE_PROFILE[passType] ?? PASS_TYPE_PROFILE.ground;
  return {
    speedYardsPerSecond: profile.speedYardsPerSecond,
    peakHeightYards: profile.peakHeightYards(Math.max(0, distanceYards)),
    accuracyMultiplier: profile.accuracyMultiplier,
  };
}

// A pure parabola in progress-space (0 at launch, peak at the midpoint, 0
// at arrival) -- the SAME shape matchBallCore.js's own sampleHeight()
// already uses for cross/shot/clearance arcs (4*peak*p*(1-p)), reused here
// rather than a differently-tuned curve so a later slice migrating cross/
// clearance onto this module inherits identical physics, not a rewrite.
export function ballHeightAtProgress(peakHeightYards, progress) {
  if (peakHeightYards <= 0) return 0;
  const p = clamp(0, 1, progress);
  return Math.max(0, 4 * peakHeightYards * p * (1 - p));
}

// Immutable flight descriptor, fixed at the instant of the kick -- see
// MATCH_LAB_PLAN.md on why this is a pure-function descriptor rather than
// a tick-updated simulation object (nothing else in this codebase runs on
// a tick loop). intendedPoint and actualEndpoint are deliberately BOTH
// carried and never reconciled -- the ball's own path is fixed at launch
// and does not bend toward the receiver afterward, however the reception/
// interception race turns out.
export function buildPassFlight({
  owner, receiver, from, intendedPoint, actualEndpoint, passType, durationMs,
} = {}) {
  const distanceYards = movementDistanceYards(from, actualEndpoint);
  const { peakHeightYards } = passFlightProfile(passType, distanceYards);
  return {
    passType,
    from: { ...from },
    intendedPoint: { ...intendedPoint },
    actualEndpoint: { ...actualEndpoint },
    durationMs: Math.max(0, Number(durationMs) || 0),
    peakHeightYards,
    lastTouchPlayerId: owner?.id ?? null,
    intendedReceiverId: receiver?.id ?? null,
    spin: null,
  };
}

// Pure function of elapsed time -- position via the same closed-form
// pointAlongMovement() every other continuous-motion primitive this
// project already uses, height via the parabola above. No stored
// velocity vector to keep in sync; there is nothing to desynchronize.
export function ballPositionAtElapsed(flight, elapsedMs) {
  const progress = flight.durationMs > 0 ? clamp(0, 1, elapsedMs / flight.durationMs) : 1;
  const point = pointAlongMovement(
    flight.from, flight.actualEndpoint,
    movementDistanceYards(flight.from, flight.actualEndpoint) * progress,
  );
  return { ...point, height: ballHeightAtProgress(flight.peakHeightYards, progress) };
}

// Anticipation/Decisions-driven generalization of the flat
// CONTACT_REACTION_DELAY_MS constant every OTHER continuous-motion call
// site in this project still uses unmodified (P.PASS.LOST's interceptor,
// reactOffBallContinuous(), DEF.PRESS.RECEIVER) -- only this slice's own
// unified race uses the per-player version. A better reader reacts
// faster; the intended receiver gets a real head start (they called the
// pass), a defender has to react to someone else's decision.
export function reactionDelayMsFor(player, { isIntendedReceiver = false } = {}) {
  const readingScore = (
    playerAttribute(player, "Anticipation") + playerAttribute(player, "Decisions")
  ) / 2;
  const delta = (10 - readingScore) * 8;
  const headStartMs = isIntendedReceiver ? 60 : 0;
  return clamp(40, 260, CONTACT_REACTION_DELAY_MS + delta - headStartMs);
}

// The unified race: every candidate -- the intended receiver treated as
// ONE candidate among equals, not evaluated on a separate privileged
// path -- checked against the SAME independent trajectory, height-gated
// (nobody is contact-eligible while the ball is genuinely in the air --
// see CONTACT_HEIGHT_YARDS's own comment on why that's a deliberate v1
// boundary, not an oversight). First (candidate, instant, point) match
// across the whole set wins. Returns null when nobody qualifies before
// the flight completes -- a genuinely clean, uncontested arrival, or (if
// the intended receiver also fails to reach it) a loose ball -- both
// real outcomes, now reached through one shared mechanism.
//
// interceptRadiusYards mirrors earliestReachableInterception()'s own
// default (matchMovementTiming.js) -- a real "stretch out a leg/foot"
// allowance on top of pure locomotion, not an extra travel distance.
// Without it, a defender already standing almost exactly on the ball's
// path still can't touch it: reachIn() models acceleration FROM A DEAD
// STOP, so even someone 1 yard off the line, with a real reaction delay,
// physically cannot cover that yard in the ~100-200ms the ball spends
// near them during a brisk ground pass -- true to life for a genuine
// darting interception, but it would make the tightest, most textbook
// interceptions (a defender already positioned right in the lane)
// impossible without this small allowance for redirecting a body part
// that's already close, not sprinting.
export function earliestReachableContact({
  flight, candidates = [], sampleIntervalMs = 40, interceptRadiusYards = 1.5,
}) {
  const duration = flight.durationMs;
  if (!candidates.length || duration <= 0) return null;
  const steps = Math.max(1, Math.ceil(duration / Math.max(1, sampleIntervalMs)));
  for (let step = 0; step <= steps; step += 1) {
    const tMs = Math.min(duration, step * sampleIntervalMs);
    const ballPoint = ballPositionAtElapsed(flight, tMs);
    if (ballPoint.height <= CONTACT_HEIGHT_YARDS) {
      for (const candidate of candidates) {
        const isIntendedReceiver = candidate.id === flight.intendedReceiverId;
        const reactionDelayMs = reactionDelayMsFor(candidate.player, { isIntendedReceiver });
        const availableSeconds = Math.max(0, (tMs - reactionDelayMs) / 1000);
        const neededYards = movementDistanceYards(candidate, ballPoint);
        const reachableYards = reachIn(candidate.player, availableSeconds);
        if (reachableYards + interceptRadiusYards >= neededYards) {
          return {
            candidate,
            isIntendedReceiver,
            atMs: tMs,
            atPoint: ballPoint,
            reactionDelayMs,
            reachAllowanceYards: interceptRadiusYards,
            neededYards,
            reachableYards,
          };
        }
      }
    }
    if (tMs >= duration) break;
  }
  return null;
}
