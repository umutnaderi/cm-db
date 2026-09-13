import { clamp, playerAttribute } from "./matchEngineCore.js";
import { reachIn } from "./playerKinetics.js";
import { advanceMotion } from "./worldMotion.js";
import { yardDistance, laneObstruction, yardDistanceToSegment } from "./spatialDecision.js";
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

// ---------------------------------------------------------------------------
// Passing v3, height-eligible contact (2026-08-26) -- see MATCH_LAB_PLAN.md.
// A real reported bug: earliestReachableContact() only ever let a touch
// happen while ball.height <= CONTACT_HEIGHT_YARDS (0.6yd, ankle height).
// A lofted/driven-aerial parabola spends most of its flight well above
// that, so nobody -- not even a defender standing right under it -- was
// EVER contact-eligible during the climb/descent; every ordinary lofted
// pass read as "uncontested" by construction, regardless of Jumping or
// positioning. Real height bands replace the single flat gate: which part
// of the body could plausibly reach the ball at THIS height, for THIS
// player, given their own standing + jump reach.
// ---------------------------------------------------------------------------

const STANDING_REACH_YARDS = 2.1;

// choice-of-whether-they-can-contest ONLY (the file header's own "no
// second success roll" rule) -- a real range of extra reach from a real
// jump, scaled by Jumping, never a probability of winning the contest
// itself (contestedRace()/localizedDuel() in match-lab.js decide THAT).
// Exported (2026-08-27, Shot As Projectile v1) -- a keeper's own dive
// envelope reuses this exact term (1.2yd arm + jumpReachYards) rather
// than inventing a second jump-height formula.
export function jumpReachYards(player) {
  const jumping = clamp(1, 20, playerAttribute(player, "Jumping"));
  return 0.3 + (jumping / 20) * 0.7;
}

export function playerMaxReachYards(player) {
  return STANDING_REACH_YARDS + jumpReachYards(player);
}

const HEIGHT_BAND_THRESHOLDS = [
  { band: "foot", max: 0.6 },
  { band: "thigh", max: 1.3 },
  { band: "chest", max: 1.9 },
];

// The band a ball AT this height would need to be played with -- standing
// reach/jump only decide WHETHER a given player can get a body part up
// there at all (playerMaxReachYards()), not which band it falls in.
export function contactBandForHeight(heightYards) {
  const height = Math.max(0, Number(heightYards) || 0);
  for (const { band, max } of HEIGHT_BAND_THRESHOLDS) {
    if (height <= max) return band;
  }
  return "head";
}

const PASS_TYPE_PROFILE = {
  ground: { speedYardsPerSecond: 20, peakHeightYards: () => 0, accuracyMultiplier: 1.0 },
  "driven-ground": { speedYardsPerSecond: 26, peakHeightYards: () => 0, accuracyMultiplier: 1.25 },
  lofted: { speedYardsPerSecond: 16, peakHeightYards: (distanceYards) => clamp(1.5, 6, distanceYards * 0.09), accuracyMultiplier: 1.15 },
  "driven-aerial": { speedYardsPerSecond: 24, peakHeightYards: (distanceYards) => clamp(0.8, 2.5, distanceYards * 0.035), accuracyMultiplier: 1.35 },
  // A goalkeeper's own hand throw (2026-08-25) -- a real browser round
  // reported a keeper's "throw" reaching a teammate the length of the
  // pitch at driven-aerial's own kicked-ball pace, because keeper
  // distribution routed through this SAME selectPassType()/
  // PASS_TYPE_PROFILE table with no throw-specific entry -- a hand throw
  // got booted like a driven kick. An arm throw is genuinely slower than
  // any kicked ball and arcs more than a flat driven pass; KEEPER_THROW_MAX_YARDS
  // (match-lab.js, keeperDistributionCandidates()) is what keeps the
  // TARGET itself realistic -- this only fixes how a throw at any legal
  // target actually looks once selected.
  throw: { speedYardsPerSecond: 14, peakHeightYards: (distanceYards) => clamp(0.8, 3, distanceYards * 0.06), accuracyMultiplier: 1.1 },
  // A specialist long throw uses a run-up and more shoulder force, while
  // remaining slower than a lofted kick and visibly more arced.
  "long-throw": { speedYardsPerSecond: 15.25, peakHeightYards: (distanceYards) => clamp(1.4, 4.2, distanceYards * 0.085), accuracyMultiplier: 1.2 },
};

const GROUND_MAX_YARDS = 15;
const CONTROLLED_DRIVEN_MAX_YARDS = 30;
const EXCEPTIONAL_DRIVEN_GROUND_MAX_YARDS = 35;
const DRIVEN_GROUND_MIN_OBSTRUCTION_CLEARANCE = 0.5;
const LONG_DRIVEN_AERIAL_MAX_OBSTRUCTION = 0.6;
const LONG_DRIVEN_AERIAL_MIN_POWER = 13;
const EXCEPTIONAL_GROUND_MAX_OBSTRUCTION = 0.12;
const EXCEPTIONAL_GROUND_MIN_POWER = 17;

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
export function selectPassType({
  passer, from, to, opponents = [], deliveryIntent = "current-position",
}) {
  const distanceYards = yardDistance(from, to);
  if (distanceYards <= GROUND_MAX_YARDS) return "ground";
  const obstruction = laneObstruction(from, to, opponents);
  if (distanceYards < CONTROLLED_DRIVEN_MAX_YARDS) {
    return obstruction < DRIVEN_GROUND_MIN_OBSTRUCTION_CLEARANCE ? "driven-ground" : "lofted";
  }
  const power = powerBlend(passer);
  const intoSpace = deliveryIntent !== "current-position" && deliveryIntent !== "to-feet";
  // A firm low diagonal remains possible over upper-medium range, but only
  // to a stationary feet target, through an exceptionally clear lane, from
  // a passer with the technique and power to keep it skimming accurately.
  // This used to remain the default clear-lane answer beyond 35 yards,
  // which is why visually long passes were repeatedly drilled on the turf.
  if (!intoSpace
    && distanceYards <= EXCEPTIONAL_DRIVEN_GROUND_MAX_YARDS
    && obstruction < EXCEPTIONAL_GROUND_MAX_OBSTRUCTION
    && power >= EXCEPTIONAL_GROUND_MIN_POWER) return "driven-ground";
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
// per PLAYER (playerMaxReachYards()) rather than one flat cutoff for
// everyone (2026-08-26, Passing v3 -- see this file's own header on the
// bug this fixes: a flat CONTACT_HEIGHT_YARDS meant nobody was EVER
// contact-eligible for most of a lofted/driven-aerial parabola's own
// flight, so an ordinary lofted pass always read as uncontested no matter
// who was standing under it). First sample where ANYONE qualifies wins;
// when TWO OR MORE candidates qualify at that SAME sample, all of them
// come back as `contestants` (plus `band`, the height class the contact
// happened at) -- match-lab.js decides who actually wins the header/
// chest/foot duel, this function only ever decides WHO and WHEN a body
// part could physically be there, same "choice of whether, not a second
// success roll" boundary the rest of this file already keeps. Returns
// null when nobody qualifies before the flight completes -- a genuinely
// clean, uncontested arrival, or (if the intended receiver also fails to
// reach it) a loose ball -- both real outcomes, reached through one
// shared mechanism.
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
// ---------------------------------------------------------------------------
// Ball Release Clearance v1 (2026-09-06) -- a real reported bug: an endless
// two-man possession loop ("A plays a ground pass toward C, but B gets to
// it", then B plays the same pass back to A, forever, with neither player
// nor the ball ever moving).
//
// Both contact scans below sample from tMs = 0, and at tMs = 0 the ball is
// still EXACTLY at flight.from -- the kicker's own foot. Anyone standing
// within interceptRadiusYards of the kick point therefore qualified for
// contact before the ball had travelled a single yard, so a teammate a yard
// away "got to" every pass at 0 ms. Two such players beside each other trade
// the ball at zero distance until POSSESSION_MAX_ACTIONS cuts the possession
// off.
//
// Skip the launch instant, not a contact-free radius around the passer.
// A defender can block immediately after release and a short pass is legal.
// The last toucher is excluded separately from this incoming-contact race.
function ballHasCleared(flight, ballPoint) {
  return movementDistanceYards(flight.from, ballPoint) > 1e-6;
}

// Whoever's body is genuinely closest to the ball at the winning sample --
// never whichever candidate the caller happened to list first. With two
// candidates equally able to touch it, array order is not a football fact,
// and letting it decide is what made the loop above alternate stably instead
// of breaking itself.
function closestEligible(eligible) {
  return eligible.reduce(
    (best, item) => (item.neededYards < best.neededYards ? item : best),
    eligible[0],
  );
}

export function earliestReachableContact({
  flight, candidates = [], sampleIntervalMs = 40, interceptRadiusYards = 1.5,
}) {
  const duration = flight.durationMs;
  if (!candidates.length || duration <= 0) return null;
  const steps = Math.max(1, Math.ceil(duration / Math.max(1, sampleIntervalMs)));
  for (let step = 0; step <= steps; step += 1) {
    const tMs = Math.min(duration, step * sampleIntervalMs);
    const ballPoint = ballPositionAtElapsed(flight, tMs);
    const band = contactBandForHeight(ballPoint.height);
    // See Ball Release Clearance v1 above: nobody meets a ball that is still
    // sitting on the kicker's foot.
    if (!ballHasCleared(flight, ballPoint, interceptRadiusYards)) {
      if (tMs >= duration) break;
      continue;
    }
    const eligible = [];
    for (const candidate of candidates) {
      if (candidate.id === flight.lastTouchPlayerId) continue;
      // Not "in the air at all" for THIS candidate -- literally out of
      // reach even with a full jump, regardless of how close they stand.
      if (ballPoint.height > playerMaxReachYards(candidate.player)) continue;
      const isIntendedReceiver = candidate.id === flight.intendedReceiverId;
      const reactionDelayMs = reactionDelayMsFor(candidate.player, { isIntendedReceiver });
      const availableSeconds = Math.max(0, (tMs - reactionDelayMs) / 1000);
      const neededYards = movementDistanceYards(candidate, ballPoint);
      const reachableYards = reachIn(candidate.player, availableSeconds);
      if (reachableYards + interceptRadiusYards >= neededYards) {
        eligible.push({
          candidate, isIntendedReceiver, reactionDelayMs,
          reachAllowanceYards: interceptRadiusYards, neededYards, reachableYards,
        });
      }
    }
    if (eligible.length) {
      const first = closestEligible(eligible);
      return {
        candidate: first.candidate,
        isIntendedReceiver: first.isIntendedReceiver,
        atMs: tMs,
        atPoint: ballPoint,
        reactionDelayMs: first.reactionDelayMs,
        reachAllowanceYards: interceptRadiusYards,
        neededYards: first.neededYards,
        reachableYards: first.reachableYards,
        band,
        contestants: eligible,
      };
    }
    if (tMs >= duration) break;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Kick As Projectile v1 (2026-08-27) -- see match-lab.js's own resolvePass()
// comment for the full reported-bug rationale: earliestReachableContact()
// above races every candidate from their FROZEN kick-time pose, which is
// what let "the ball would meet player X" get decided before anyone
// actually moved -- a receiver could be credited with reaching a point 20
// real yards from their kick-time spot purely because the frozen-pose
// arithmetic said they COULD, never checking where their body genuinely
// was tick by tick. This is the live equivalent: every candidate's
// position is re-derived every sampleIntervalMs from where they ACTUALLY
// were the tick before -- chasing the ball's own live sample when their
// job says to, or their ordinary tactical job target otherwise (jobs
// persist; only contact goes live). earliestReachableContact() itself is
// UNCHANGED and stays available as a pure "frozen-pose" oracle (tests,
// or any caller that genuinely wants that question answered) -- this is
// the one match-lab.js's own resolvePass()/resolveThroughBall() call for
// real contact resolution.
// ---------------------------------------------------------------------------

// How close (real yards) to the flight's own straight-line corridor
// (kick point to actualEndpoint) counts as "close enough to reasonably
// notice and react to this ball," regardless of tactical job -- the
// anti-Weah-swarm boundary: nobody more than this far from the corridor,
// not already the aimed-at player, and not on a job that itself says
// "go get the ball" (press/track/recover) ever abandons their tactical
// job to chase a pass that was never near them.
const CHASE_CORRIDOR_YARDS = 8;
// Same "stretch out a leg/foot" allowance earliestReachableContact() already
// uses -- both for "is this even worth trying to chase" (the remaining-time
// check) and for what counts as genuine contact once someone's close.
const CHASE_INTERCEPT_ALLOWANCE_YARDS = 1.5;
// Once a chaser is already this close to the ball's own live position,
// track it precisely for the real touch rather than the flight's fixed
// endpoint -- close enough that "run to where it's going" and "run to
// where it is" are basically the same instruction anyway, and precise
// tracking is what actually lands the final contact.
const CLOSE_TRACKING_YARDS = 5;

function cloneTickPositions(positions) {
  const snapshot = {};
  for (const [id, point] of Object.entries(positions)) snapshot[id] = { ...point };
  return snapshot;
}

// ALL of: height reachable, and a real chance of physically arriving before
// the flight ends (a generous, frozen-pose-style "is this worth it at all"
// estimate over whatever time remains -- the actual tick-by-tick movement
// below is what decides the real outcome, this only gates who bothers
// trying). Plus AT LEAST ONE of: genuinely near the flight's own corridor,
// the aimed-at player, or a live tactical job that itself means "go get the
// ball" (press-ball/track/last-man recover) -- never everyone within reach
// sprinting at it regardless of what they were actually doing.
function shouldChaseBall(candidate, currentPosition, ball, remainingSeconds, flight, mayChaseByJob, interceptRadiusYards) {
  if (ball.height > playerMaxReachYards(candidate.player)) return false;
  // "Can physically arrive" is judged against where the flight is actually
  // HEADED (actualEndpoint), never the ball's own live sample -- early in
  // a flight the ball still sits at the kicker's own foot, genuinely far
  // from anyone it's being delivered TO; gating on "can you sprint to
  // where the ball IS right now" would fail the aimed-at receiver simply
  // for not already standing next to the passer. This is "is it plausible
  // I can get INTO POSITION before the flight arrives," not "can I catch
  // up to it this instant" -- the tick-by-tick movement below still
  // chases the ball's own real live position once chasing is true.
  const neededYards = movementDistanceYards(currentPosition, flight.actualEndpoint);
  const remainingReach = reachIn(candidate.player, Math.max(0, remainingSeconds));
  if (remainingReach + interceptRadiusYards < neededYards) return false;
  if (candidate.id === flight.intendedReceiverId) return true;
  if (mayChaseByJob) return true;
  return yardDistanceToSegment(currentPosition, flight.from, flight.actualEndpoint) <= CHASE_CORRIDOR_YARDS;
}

// The live tick itself. `players` is every candidate who could plausibly
// touch this ball (both sides, keepers included if they can reach) --
// treated as equals; the aimed-at teammate is a label and a small chase
// bias (via shouldChaseBall() above), never a privileged path.
// `jobTargetFor(playerId)` returns `{ point, mayChase }` for whoever isn't
// currently chasing the ball: `point` is their ordinary tactical
// destination for this phase of play (mark/screen/hold width/pin the last
// line/press-ball/recover -- computed ONCE by the caller, same "jobs
// persist" contract as the rest of this project's off-ball motion), and
// `mayChase` tells this function whether THAT job already means "your job
// is to go get the ball" (press-ball, track, last-man recover), which
// waives the corridor-distance requirement above. A missing/null return
// leaves that candidate standing still -- a safe, inert default for a
// minimal caller (a unit test) that hasn't wired real jobs at all.
//
// Reuses reachIn()/movementDistanceYards()/pointAlongMovement() exactly as
// every other continuous-motion primitive in this project already does --
// no second locomotion model. Each candidate's own cumulative reach
// (reachIn(player, elapsedSeconds), the SAME closed-form accelerate-then-
// cap curve continuousPositionAtElapsed() uses) grows from kick-time, so a
// player who only starts angling toward the ball once it's already in
// flight is still genuinely accelerating, not teleporting to a "could
// technically get there" point.
export function simulateFlightUntilContact({
  flight, players = [], jobTargetFor = () => null,
  sampleIntervalMs = 40, interceptRadiusYards = CHASE_INTERCEPT_ALLOWANCE_YARDS,
}) {
  const duration = flight.durationMs;
  const positions = {};
  const traveledYards = {};
  const jobMotions = {};
  for (const entry of players) {
    positions[entry.id] = { x: entry.x, y: entry.y, zone: entry.zone ?? null };
    traveledYards[entry.id] = 0;
  }
  const loosePoint = () => {
    const ball = ballPositionAtElapsed(flight, duration);
    return {
      candidate: null,
      isIntendedReceiver: false,
      atMs: duration,
      atPoint: { ...flight.actualEndpoint, height: ball.height },
      band: contactBandForHeight(ball.height),
      contestants: [],
      positions: cloneTickPositions(positions),
      jobMotions,
    };
  };
  if (!players.length || duration <= 0) return loosePoint();

  const steps = Math.max(1, Math.ceil(duration / Math.max(1, sampleIntervalMs)));
  for (let step = 0; step <= steps; step += 1) {
    const tMs = Math.min(duration, step * sampleIntervalMs);
    const elapsedSeconds = tMs / 1000;
    const remainingSeconds = (duration - tMs) / 1000;
    const ball = ballPositionAtElapsed(flight, tMs);
    const band = contactBandForHeight(ball.height);

    for (const entry of players) {
      const currentPosition = positions[entry.id];
      const job = jobTargetFor(entry.id);
      if (job?.authoritativeMotion) {
        const motion = advanceMotion({ from: entry, intentionTarget: job.point,
          player: entry.player, elapsedMs: tMs, incomingVelocity: job.velocity,
          reactionDelayMs: job.reactionDelayMs ?? 0, intention: job.action,
          paceToArrival: false, sampleCount: Math.max(4, Math.ceil(tMs / 40)) });
        positions[entry.id] = motion.position;
        traveledYards[entry.id] = movementDistanceYards(entry, motion.position);
        jobMotions[entry.id] = { ...motion, action: job.action };
        continue;
      }
      const mayChaseByJob = Boolean(job?.mayChase);
      const chasing = shouldChaseBall(
        entry, currentPosition, ball, remainingSeconds, flight, mayChaseByJob, interceptRadiusYards,
      );
      // Run to where the flight is actually HEADED, not the ball's own
      // live sample, UNLESS already close enough to track it precisely
      // for the real touch. A real reported bug: chasing the live ball
      // from the first tick means chasing the passer's own foot early in
      // the flight (the ball starts there) -- a receiver who barely needs
      // to move at all would waste their tiny early reachIn() budget
      // angling toward the KICKER before the ball ever gets close, then
      // have nothing left once it actually arrived. actualEndpoint sits
      // on the SAME straight line the ball travels, so heading there
      // still crosses the ball's own path -- a genuine mid-flight
      // interception still works once CLOSE_TRACKING_YARDS puts someone
      // on the corridor within precise range of the ball's real position.
      const distanceToLiveBall = movementDistanceYards(currentPosition, ball);
      const target = chasing
        ? (distanceToLiveBall <= CLOSE_TRACKING_YARDS ? ball : flight.actualEndpoint)
        : (job?.point ?? currentPosition);
      // Cumulative reach from kick-time (elapsedSeconds), not a per-tick
      // reachIn() call -- the SAME distinction continuousPositionAtElapsed()
      // already draws: querying reachIn() fresh every 40ms would restart
      // the acceleration curve from a dead stop every single tick, capping
      // everyone at their very first stride's worth of ground forever.
      const totalReachable = reachIn(entry.player, elapsedSeconds);
      const deltaYards = Math.max(0, totalReachable - traveledYards[entry.id]);
      traveledYards[entry.id] = totalReachable;
      const distanceToTarget = movementDistanceYards(currentPosition, target);
      const advance = Math.min(deltaYards, distanceToTarget);
      positions[entry.id] = pointAlongMovement(currentPosition, target, advance);
    }
    const eligible = [];
    // See Ball Release Clearance v1 above. The tick loop that moves everyone
    // still runs at tMs = 0 (a player's own reaction and first stride start
    // the instant the ball is struck) -- only CONTACT is withheld until the
    // ball has genuinely left the kicker's foot.
    const cleared = ballHasCleared(flight, ball, interceptRadiusYards);
    for (const entry of cleared ? players : []) {
      if (entry.id === flight.lastTouchPlayerId) continue;
      if (ball.height > playerMaxReachYards(entry.player)) continue;
      const neededYards = movementDistanceYards(positions[entry.id], ball);
      if (neededYards <= interceptRadiusYards) {
        eligible.push({
          candidate: entry,
          isIntendedReceiver: entry.id === flight.intendedReceiverId,
          reactionDelayMs: 0,
          reachAllowanceYards: interceptRadiusYards,
          neededYards,
          reachableYards: traveledYards[entry.id],
        });
      }
    }
    if (eligible.length) {
      const first = closestEligible(eligible);
      return {
        candidate: first.candidate,
        isIntendedReceiver: first.isIntendedReceiver,
        atMs: tMs,
        atPoint: ball,
        reactionDelayMs: first.reactionDelayMs,
        reachAllowanceYards: interceptRadiusYards,
        neededYards: first.neededYards,
        reachableYards: first.reachableYards,
        band,
        contestants: eligible,
        positions: cloneTickPositions(positions),
        jobMotions,
      };
    }
    if (tMs >= duration) break;
  }
  return loosePoint();
}
