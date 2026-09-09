import { clamp } from "./matchEngineCore.js";
import { yardDistance } from "./pitchGeometry.js";
import { timeToReach } from "./playerKinetics.js";
import { pointAlongMovement, CONTACT_REACTION_DELAY_MS } from "./matchMovementTiming.js";
import {
  rollStopDistanceYards,
  rollStopDurationMs,
  rollTraveledYards,
  rollDurationForDistance,
} from "./ballRollPhysics.js";

// ---------------------------------------------------------------------------
// Dynamic Ball Claim v2 (2026-09-04) -- who is actually going for a loose
// ball, decided continuously against the ball's real decelerating roll
// instead of once, at the instant it came loose, against a stationary
// target.
//
// The bug this replaces was structural, not a tuning error. The claim used
// to come from selectLooseBallRecovery(), which asks predictBallPosition()
// where the ball will be in 320 ms under an exponential drag constant that
// is a DIFFERENT friction model from the one the ball then actually rolls
// under (GROUND_FRICTION_YPS2, ballRollPhysics.js). Measured, for a real
// through-ball landing speed of 26 yd/s: the claim-time prediction sees the
// ball 5.8 yards away, while the ball genuinely travels 91 yards over 7
// seconds. So the claim was effectively always awarded to whoever happened
// to be standing nearest the landing spot, and that player then chased a
// ball accelerating away from them for the rest of its roll -- the reported
// "passer chasing a loose ball until it goes out."
//
// Two things follow, and this module owns both:
//
//   1. The race is evaluated across the WHOLE roll. A candidate claims the
//      ball at the earliest instant their own real arrival time (reachIn/
//      timeToReach, the same kinetics everything else uses) is no later
//      than the ball's own arrival at that same point. Nothing is decided
//      from a single horizon.
//
//   2. A candidate who never satisfies that condition before the roll ends
//      -- natural stop, or a genuine pitch exit -- CANNOT win, and is told
//      so explicitly. That is what lets a caller author an abandonment
//      instead of a doomed chase. selectLooseBallRecovery() has no such
//      concept: it always returns the least-bad candidate, however hopeless.
//
// This module is pure. It consumes NO randomness, mutates nothing, reads no
// roster and writes no coordinate. It answers a question; the caller decides
// what to author, and worldMotion remains the only system that turns any of
// this into movement. It is a leaf: it imports only physics, kinetics and
// geometry, never spatialDecision.js or match-lab.js.
// ---------------------------------------------------------------------------

/** Matches the existing loose-roll sampling cadence in match-lab.js. */
export const CLAIM_SAMPLE_MS = 40;

/**
 * Below this the ball is not meaningfully rolling and there is no race to
 * run -- the caller keeps its existing static-point behaviour. Same
 * threshold the loose-ball block already used for "is there real momentum."
 */
export const CLAIM_MIN_ROLL_SPEED_YPS = 0.3;

/**
 * A player does not begin moving the instant the ball comes loose. This is
 * the SAME reaction constant contact timing already uses, not a second
 * competing number.
 */
export const CLAIM_REACTION_MS = CONTACT_REACTION_DELAY_MS;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Projects the real, friction-decelerating roll of a loose ball as a series
 * of sampled points.
 *
 * `from` is where the ball went loose and `aim` is any point along its real
 * heading -- pointAlongMovement() only needs a genuine direction, which is
 * exactly how the existing loose-ball block already builds its own aim
 * point. `deadlineMs`, when given, ends the projection early: a ball that
 * has crossed the touchline cannot be claimed, so the race must not be
 * allowed to search past that instant.
 *
 * `clampPoint` is injected rather than assumed, because clamping a rolling
 * point back inside the pitch is the caller's own pitch-geometry concern
 * (and a genuine exit is a restart, never a silently clamped recovery).
 */
export function projectLooseRoll({
  from,
  aim,
  speedYps,
  sampleMs = CLAIM_SAMPLE_MS,
  deadlineMs = null,
  clampPoint = null,
} = {}) {
  const speed = Math.max(0, finite(speedYps));
  const stopMs = rollStopDurationMs(speed);
  const stopDistanceYards = rollStopDistanceYards(speed);
  const horizonMs = deadlineMs === null
    ? stopMs
    : Math.min(stopMs, Math.max(0, finite(deadlineMs)));
  const step = Math.max(1, finite(sampleMs, CLAIM_SAMPLE_MS));
  const at = (tMs) => {
    const traveled = rollTraveledYards(speed, tMs);
    const point = pointAlongMovement(from, aim, traveled);
    return clampPoint ? clampPoint(point) : point;
  };
  const samples = [];
  for (let tMs = 0; tMs <= horizonMs; tMs += step) {
    samples.push({ tMs, distanceYards: rollTraveledYards(speed, tMs), point: at(tMs) });
  }
  // Always include the exact horizon, so a race is never decided by where
  // the sampling grid happened to land.
  if (!samples.length || samples[samples.length - 1].tMs < horizonMs) {
    samples.push({ tMs: horizonMs, distanceYards: rollTraveledYards(speed, horizonMs), point: at(horizonMs) });
  }
  return {
    from: from ? { ...from } : null,
    speedYps: speed,
    stopMs,
    stopDistanceYards,
    horizonMs,
    truncated: horizonMs < stopMs - 1e-9,
    samples,
    restPoint: samples[samples.length - 1]?.point ?? (from ? { ...from } : null),
    /** Real closed-form time for the roll to cover a given distance. */
    timeToTravel: (distanceYards) => rollDurationForDistance(speed, distanceYards),
  };
}

/**
 * When a candidate could arrive at a point, in ms from the moment the ball
 * came loose. Anticipation shaves reaction, exactly as the previous
 * selectLooseBallRecovery() tie-break intended, but it is applied to the
 * REACTION rather than fabricated as negative travel time.
 */
function arrivalMsAt(candidate, point, reactionMs) {
  const distance = yardDistance(candidate.entry ?? candidate, point);
  return reactionMs + timeToReach((candidate.entry ?? candidate).player, distance) * 1000;
}

/**
 * The full loose-ball race.
 *
 * For every candidate, walks the roll and finds the earliest sampled instant
 * at which they genuinely get there: arrival <= the ball's own time at that
 * point. That is a real interception of a moving ball, not a comparison
 * against a frozen one.
 *
 * Returns, deterministically:
 *   claimant       the winner, or null when nobody genuinely wins the race
 *   interceptMs    when the winner meets the moving ball
 *   pickup         when NOBODY intercepts: whoever then walks to the ball
 *                  where it actually came to rest (only when the roll was
 *                  allowed to finish -- a ball that went out has no pickup)
 *   contenders     every candidate who could have won, in race order
 *   abandoned      every candidate who provably could not, with a reason
 *   leadChanges    how many times the best-placed racer changed identity as
 *                  the ball slowed -- the observable evidence that this is
 *                  a continuous race and not a single up-front decision
 *
 * Ties break on (interceptMs, then distance at that instant, then id), all
 * total and all independent of candidate array order. No randomness.
 */
export function evaluateBallClaim({
  roll,
  candidates = [],
  reactionMs = CLAIM_REACTION_MS,
  eligible = null,
  ballExits = false,
  // Pure instrumentation: `leaders`/`leadChanges` are an extra full
  // pool x sample sweep that no outcome depends on, so the engine's own hot
  // path leaves them off and tests/diagnostics ask for them explicitly.
  withLeaders = false,
} = {}) {
  const pool = candidates.filter(Boolean).filter((entry) => (eligible ? eligible(entry) : true));
  const empty = {
    claimant: null, interceptMs: null, interceptPoint: null, pickup: null,
    contenders: [], abandoned: [], leadChanges: 0, leaders: [],
  };
  if (!roll?.samples?.length || !pool.length) return empty;

  const contenders = [];
  const abandoned = [];
  for (const entry of pool) {
    let hit = null;
    let closestGapYards = Infinity;
    for (const sample of roll.samples) {
      const arrival = arrivalMsAt(entry, sample.point, reactionMs);
      const gap = yardDistance(entry, sample.point);
      if (gap < closestGapYards) closestGapYards = gap;
      if (arrival <= sample.tMs) {
        hit = { tMs: sample.tMs, point: sample.point, marginMs: sample.tMs - arrival, gapYards: gap };
        break;
      }
    }
    if (hit) {
      contenders.push({
        id: entry.id,
        entry,
        interceptMs: hit.tMs,
        interceptPoint: hit.point,
        marginMs: hit.marginMs,
        gapYards: hit.gapYards,
      });
    } else {
      const last = roll.samples[roll.samples.length - 1];
      abandoned.push({
        id: entry.id,
        entry,
        closestGapYards,
        reason: ballExits
          ? "the ball crosses the line before this player can reach it"
          : "this player cannot reach the ball at any point during its roll",
        shortfallMs: Math.max(0, arrivalMsAt(entry, last.point, reactionMs) - last.tMs),
      });
    }
  }

  contenders.sort((left, right) =>
    left.interceptMs - right.interceptMs
    || left.gapYards - right.gapYards
    || String(left.id).localeCompare(String(right.id)));

  // Who is winning the race at each instant. A change of identity here is a
  // claim genuinely changing hands as the ball slows -- the thing the old
  // single-horizon decision could not represent at all.
  const leaders = [];
  for (const sample of (withLeaders ? roll.samples : [])) {
    let best = null;
    for (const entry of pool) {
      const deficitMs = arrivalMsAt(entry, sample.point, reactionMs) - sample.tMs;
      if (!best || deficitMs < best.deficitMs
        || (deficitMs === best.deficitMs && String(entry.id).localeCompare(String(best.id)) < 0)) {
        best = { id: entry.id, deficitMs };
      }
    }
    if (best) leaders.push({ tMs: sample.tMs, id: best.id, deficitMs: best.deficitMs });
  }
  let leadChanges = 0;
  for (let index = 1; index < leaders.length; index += 1) {
    if (leaders[index].id !== leaders[index - 1].id) leadChanges += 1;
  }

  const winner = contenders[0] ?? null;

  // Nobody meets the moving ball. If it was allowed to finish rolling it is
  // now sitting on the grass, and whoever is nearest walks to it -- a real
  // outcome, and the one the previous code already produced for this case.
  // If instead it crossed the line, there is no pickup: it is a restart.
  let pickup = null;
  if (!winner && !ballExits) {
    const rest = roll.restPoint;
    let best = null;
    for (const entry of pool) {
      const arrival = arrivalMsAt(entry, rest, reactionMs);
      if (!best || arrival < best.arrivalMs
        || (arrival === best.arrivalMs && String(entry.id).localeCompare(String(best.id)) < 0)) {
        best = { id: entry.id, entry, arrivalMs: arrival, point: rest };
      }
    }
    pickup = best;
  }

  return {
    claimant: winner?.entry ?? null,
    interceptMs: winner?.interceptMs ?? null,
    interceptPoint: winner?.interceptPoint ?? null,
    pickup,
    contenders,
    abandoned,
    leadChanges,
    leaders,
  };
}

/**
 * Should this player keep going for this ball?
 *
 * The narrow question a caller asks about ONE player -- typically the
 * intended receiver of a delivery that ran away from them. A player chases
 * only when they genuinely win the race, or when nobody does and they are
 * the one who reaches the stopped ball first. Otherwise they pull up.
 *
 * Returns { chase, role, reason }. `role` is "intercept" | "pickup" |
 * "abandon", which is what distinguishes a real sprint onto a moving ball
 * from a jog to a ball that has already stopped.
 */
export function shouldChaseLooseBall(playerId, claim) {
  if (!claim) return { chase: false, role: "abandon", reason: "no claim was evaluated" };
  const id = String(playerId);
  if (claim.claimant && String(claim.claimant.id) === id) {
    return { chase: true, role: "intercept", reason: "wins the race to the moving ball" };
  }
  if (!claim.claimant && claim.pickup && String(claim.pickup.id) === id) {
    return { chase: true, role: "pickup", reason: "nobody intercepts it; first to the ball once it stops" };
  }
  const abandonedEntry = claim.abandoned.find((entry) => String(entry.id) === id);
  if (abandonedEntry) return { chase: false, role: "abandon", reason: abandonedEntry.reason };
  if (claim.claimant) {
    return { chase: false, role: "abandon", reason: `${claim.claimant.id} reaches it first` };
  }
  return { chase: false, role: "abandon", reason: "another player reaches the stopped ball first" };
}

/**
 * Convenience wrapper: project the roll and race it in one call, which is
 * the shape every caller in match-lab.js actually wants.
 *
 * `exitDistanceYards`, when supplied, is how far along the roll the ball
 * would cross a line. The race is cut off there, because a ball that is out
 * of play cannot be claimed by anybody.
 */
export function claimLooseBall({
  from,
  aim,
  speedYps,
  candidates = [],
  exitDistanceYards = null,
  sampleMs = CLAIM_SAMPLE_MS,
  reactionMs = CLAIM_REACTION_MS,
  eligible = null,
  clampPoint = null,
  withLeaders = false,
} = {}) {
  const speed = Math.max(0, finite(speedYps));
  const stopDistance = rollStopDistanceYards(speed);
  const exits = exitDistanceYards !== null
    && Number.isFinite(Number(exitDistanceYards))
    && Number(exitDistanceYards) <= stopDistance;
  const deadlineMs = exits ? rollDurationForDistance(speed, Number(exitDistanceYards)) : null;
  const roll = projectLooseRoll({ from, aim, speedYps: speed, sampleMs, deadlineMs, clampPoint });
  const claim = evaluateBallClaim({ roll, candidates, reactionMs, eligible, ballExits: exits, withLeaders });
  return { roll, ballExits: exits, exitTimeMs: deadlineMs, ...claim };
}

// ---------------------------------------------------------------------------
// The declarative route
// ---------------------------------------------------------------------------
//
// Same discipline Stage 1 established for selectSpecialMover(): the physics
// answer is kept verbatim as the parity reference, and the declarative route
// produces the SAME answer while adding what a declaration is actually good
// for -- a trigger the world has to satisfy, an exclusivity rule ("exactly
// one player goes for this ball") stated once instead of re-implemented per
// caller, and a rejection reason for everybody who did not get it.
//
// The registry never computes geometry. It names `intercept-rolling-ball`
// and this module injects evaluateBallClaim()'s own result, which is the
// same race the direct path runs.

/**
 * The one job this module proposes. There was no existing engine name to
 * reuse: going for a loose ball used to be implicit in whoever
 * selectLooseBallRecovery() happened to return, and was never named at all.
 * Defined here, where the behaviour lives, rather than existing only as a
 * literal inside a declaration.
 */
export const LOOSE_BALL_CLAIM_JOB = "claim-loose-ball";

/** The physics answer, unmediated. The parity reference. */
export function selectLooseBallClaimantDirect(claim) {
  if (!claim) return null;
  return claim.claimant ?? claim.pickup?.entry ?? null;
}

/**
 * The declarative route. Returns { claimant, proposals, rejections } so a
 * caller can show WHY a player is or is not going for the ball.
 *
 * `matchActionPatterns` is passed in rather than imported, so this leaf
 * module stays a leaf and a test can drive it with its own registry.
 */
export function selectLooseBallClaimant(claim, { matchActionPatterns, registry, possession = "loose" } = {}) {
  if (typeof matchActionPatterns !== "function") {
    // No registry supplied: the physics answer is still the answer.
    return { claimant: selectLooseBallClaimantDirect(claim), proposals: [], rejections: [] };
  }
  const winner = selectLooseBallClaimantDirect(claim);
  const { proposals, rejections } = matchActionPatterns(
    { possession, ballRegion: null, teamPhase: null },
    {
      findParticipant: (pattern, participant) => {
        if (pattern.id !== "pattern:claim-loose-ball@1") return null;
        if (participant.slot !== "secondBallPlayer") return null;
        // "can-reach-rolling-ball" is answered by the race that already
        // ran -- never re-derived here with a second, drifting model.
        return winner;
      },
      deriveTarget: (pattern, actor) =>
        (pattern.id === "pattern:claim-loose-ball@1" && actor
          ? (claim?.interceptPoint ?? claim?.pickup?.point ?? null)
          : null),
    },
    registry ? { registry } : undefined,
  );
  const claimed = proposals.find((proposal) => proposal.job === LOOSE_BALL_CLAIM_JOB);
  return {
    claimant: claimed ? winner : null,
    proposals,
    rejections,
  };
}

/**
 * Ball-state velocity is carried in percent-of-pitch per millisecond; the
 * roll physics speak yards per second. One conversion, in one place, so a
 * caller never re-derives it slightly differently.
 */
export function rollSpeedYpsFromVelocity(velocity, { widthYards, lengthYards, retention = 1 } = {}) {
  const vx = finite(velocity?.x) * (finite(widthYards) / 100);
  const vy = finite(velocity?.y) * (finite(lengthYards) / 100);
  return Math.hypot(vx, vy) * 1000 * clamp(0, 1, finite(retention, 1));
}
