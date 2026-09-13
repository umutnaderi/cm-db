import { clamp, playerAttribute } from "./matchEngineCore.js";
import {
  PITCH_LENGTH_YARDS, PITCH_WIDTH_YARDS,
  attackingGoalYForDirection, yardDistance,
} from "./pitchGeometry.js";
import { reachIn, timeToReach, topSpeed } from "./playerKinetics.js";
import { buildOffsideSnapshot } from "./matchOffside.js";
import { classifyTacticalRegion } from "./pitchRegions.js";

// ---------------------------------------------------------------------------
// Joint Passer/Runner Candidate Generation (Stage 3, 2026-09-05)
//
// A pass candidate used to mean exactly one thing: "play the ball from the
// owner to a teammate's current coordinate." Everything about the delivery
// was then derived from that single fact. A run that would MAKE a pass
// possible was invisible to the decision, because the decision only ever
// looked at where people already stood.
//
// A joint candidate means something different:
//
//     this passer attempts this delivery toward this spatial point while
//     this teammate makes a physically reachable run to meet it there.
//
// The passer, the runner, the intended point and the delivery are generated
// and scored as ONE object. That is the whole of Stage 3.
//
// ---------------------------------------------------------------------------
// What this module is not allowed to do
// ---------------------------------------------------------------------------
//
// It is pure and DOM-free. It consumes no randomness, mutates no roster
// entry, no ball state and no motion state, and it decides nothing about
// whether a pass SUCCEEDS. It answers "is this idea worth attempting, and
// how good is it" and nothing else. Execution error, the actual endpoint,
// interception, first contact, control and turnover all stay exactly where
// they already live, in the resolvers.
//
// It is also a leaf. The pass-flight and lane primitives it needs live in
// matchPassFlight.js and spatialDecision.js, which already import from each
// other; importing either here would make this module part of a cycle. They
// are injected instead -- the same discipline the action-pattern registry
// (Stage 1) and ballClaim.js (Stage 2) already use, and the reason there is
// no second speed, acceleration, interception or ball-flight model anywhere
// in this file.
// ---------------------------------------------------------------------------

/**
 * The plausible ways a teammate can be available for a pass. Each names a
 * PICTURE, not a coordinate: the actual point is derived from live geometry
 * every time, and a region is only ever used to describe where a point
 * landed, never to supply one.
 */
export const MEETING_POINT_KINDS = Object.freeze([
  "current-position",
  "short-support",
  "forward-lead",
  "diagonal-lead",
  "run-in-behind",
  "wide-release",
  "pattern-proposed",
]);

/** Why a joint candidate is not worth offering. Closed vocabulary. */
export const REJECTION_REASONS = Object.freeze([
  "runner-cannot-arrive",
  "outside-passer-range",
  "defender-arrives-first",
  "lane-intercepted",
  "runner-offside-at-kick",
  "meeting-point-off-pitch",
  "ground-pass-too-long",
  "pattern-job-conflict",
  "beyond-physical-reach",
]);

// How late the runner may be for their own delivery and still be counted as
// meeting it. Arriving EARLY is unlimited and free -- getting to the space
// first and waiting is ordinary football. Arriving late is not: this is
// zero, because a runner who gets there after the ball has not met the
// pass, they are chasing it.
//
// This was briefly 260ms, and the loosening was measurable and bad: it
// admitted marginally-late meeting points all over a congested cluster,
// which propped up short passes the congestion penalty was trying to kill
// and made the recorded congested-pass-loop bug scenario start looping
// again. Near-misses are still expressed, as the arrival PENALTY in
// scoreJointCandidate() -- as a cost, not as permission.
export const RUNNER_LATE_TOLERANCE_MS = 0;

// A defender who gets there this much earlier than the runner has cut it
// out; between this and zero the candidate is contested and downgraded
// rather than rejected outright.
export const DEFENDER_CUTOUT_MARGIN_MS = 120;

// Ground and driven-ground deliveries stop being credible well before the
// pass-type table's own geometric ceiling. This is not a second ball-flight
// model: selectPassType() still chooses the type, and this only says which
// of its answers are physically silly over real distance.
export const GROUND_FAMILY_MAX_YARDS = 35;

// Slowing a firm delivery down for a receiver waiting at their feet is a
// useful adaptation over ordinary passing range. Beyond this distance the
// adaptation used to turn 30-42 yard passes into plain ground balls, hiding
// the aerial family even when the underlying selector had asked for pace.
export const CONTROLLED_TO_FEET_MAX_YARDS = 28;

// A receiver below this Pace/Acceleration blend is better served by a
// controlled ground ball to their current position than by the quicker,
// less accurate driven-ground delivery selectPassType() normally chooses
// over medium range. This only applies to a pass to feet. A runner attacking
// space still needs the delivery used to evaluate that run, and a blocked
// lane can still require an aerial ball.
export const TO_FEET_DRIVEN_MIN_MOBILITY = 13;

const GROUND_FAMILY = new Set(["ground", "driven-ground"]);
const AERIAL_UPGRADE_MIN_POWER = 13;

/**
 * A teammate who already holds a forward running intention -- a
 * run-in-behind job, or an action-pattern proposal telling them to go -- is
 * NOT standing still when the ball is played. They are already moving, and
 * pretending otherwise is the difference between "a through ball exists"
 * and "a through ball is never physically possible."
 *
 * reachIn() takes a real initial speed for exactly this reason (see its own
 * Momentum Continuity header), so this is fed into the existing kinetics
 * rather than being a second movement model. The fraction is this module's
 * one modelling assumption and is deliberately conservative: a player on a
 * run is somewhere between jogging and flat out, not at top speed.
 */
export const RUNNING_INTENTION_SPEED_FRACTION = 0.6;

const SHORT_SUPPORT_YARDS = 5;
const FORWARD_LEAD_YARDS = 10;
const DIAGONAL_LEAD_FORWARD_YARDS = 12;
const DIAGONAL_LEAD_LATERAL_YARDS = 8;
const WIDE_RELEASE_FORWARD_YARDS = 10;
const WIDE_RELEASE_LATERAL_YARDS = 10;
const RUN_IN_BEHIND_BEYOND_LINE_YARDS = 8;
// Below this a "meeting point" is not distinguishable from the teammate's
// own position, so it is not generated as a separate option at all.
const MIN_LEAD_GAIN_YARDS = 4;

/** Percent-of-pitch offsets for a real yard distance, per axis. */
function yardsToPercentY(yards) { return (yards / PITCH_LENGTH_YARDS) * 100; }
function yardsToPercentX(yards) { return (yards / PITCH_WIDTH_YARDS) * 100; }

function forwardSign(attackingDirection) {
  return attackingDirection === "up" ? -1 : 1;
}

function onPitch(point) {
  return point.x >= 0 && point.x <= 100 && point.y >= 0 && point.y <= 100;
}

function pointOf(entry) {
  return { x: entry.x, y: entry.y };
}

/**
 * The longest delivery this passer can credibly strike, from the SAME
 * attribute blend selectPassType() already reads for its own power test --
 * deliberately not a new attribute model, just the existing one asked a
 * different question.
 */
export function credibleRangeYards(passer) {
  const power = (
    playerAttribute(passer, "Strength")
    + playerAttribute(passer, "Technique")
    + playerAttribute(passer, "Passing")
  ) / 3;
  return 25 + clamp(0, 1, power / 20) * 45;
}

/**
 * Distance from a point to the goal being attacked, in yards. Local because
 * spatialDecision.js's own distanceToGoalYards() cannot be imported here
 * without creating a cycle; identical arithmetic, no second model.
 */
function distanceToAttackingGoalYards(point, attackingDirection) {
  const goalY = attackingGoalYForDirection(attackingDirection);
  return yardDistance(point, { x: 50, y: goalY });
}

/** Ground gained toward the attacking goal, in yards. Negative is backward. */
export function progressionYardsBetween(from, to, attackingDirection) {
  return distanceToAttackingGoalYards(from, attackingDirection)
    - distanceToAttackingGoalYards(to, attackingDirection);
}

/**
 * Seconds for a player to cover a distance, honouring momentum they already
 * have. timeToReach() is exact for a cold start and is used unchanged in
 * that case; with a real initial speed there is no closed-form inverse of
 * reachIn(), so this bisects reachIn() itself -- the same curve, solved the
 * other way round, never a second acceleration model.
 */
export function arrivalSecondsFor(player, distanceYards, initialSpeedYps = 0) {
  const distance = Math.max(0, Number(distanceYards) || 0);
  if (distance === 0) return 0;
  if (!(initialSpeedYps > 0)) return timeToReach(player, distance);
  let low = 0;
  let high = timeToReach(player, distance);
  for (let step = 0; step < 24; step += 1) {
    const mid = (low + high) / 2;
    if (reachIn(player, mid, initialSpeedYps) >= distance) high = mid; else low = mid;
  }
  return high;
}

// ---------------------------------------------------------------------------
// Meeting-point generation
// ---------------------------------------------------------------------------

/**
 * Several plausible points this teammate could be met at, from real
 * geometry only. Nothing here checks whether a point is REACHABLE -- that
 * is evaluateJointCandidate()'s job, because reachability depends on the
 * delivery, which depends on the point.
 *
 * `defenderLineY` (when supplied) is the second-last opponent line, so a
 * run-in-behind point is derived from where the defence actually is rather
 * than from a fixed offset.
 */
export function generateMeetingPoints({
  passer, runner, attackingDirection = "down", defenderLineY = null,
  patternTarget = null, touchlineBias = null, reachBudgetYards = null,
} = {}) {
  if (!passer || !runner) return [];
  const sign = forwardSign(attackingDirection);
  const start = pointOf(runner);
  const points = [{ kind: "current-position", point: { ...start } }];
  // A lead is only worth generating as far as the runner can genuinely
  // cover while the ball is travelling. Without this, every lead point is
  // nominal: a flat 10-yard forward lead needs about 14 yd/s over a short
  // pass's flight, which no player can do, so every forward option was
  // being generated and then thrown straight back out as unreachable --
  // and a through ball simply stopped being offered. The budget comes from
  // reachIn(), the same kinetics everything else uses; `null` means an
  // unbounded caller (a direct unit test) wants the nominal picture.
  const budget = reachBudgetYards === null ? Infinity : Math.max(0, reachBudgetYards);
  const scale = (yards) => Math.min(yards, budget);
  // A "lead" of a yard or two is not a run into space, it is the teammate's
  // own feet with rounding on top. Generating those was actively harmful:
  // in a congested cluster every teammate acquired a slightly-forward aim
  // point worth a small progression reward, which propped up short passes
  // that the congestion penalty was specifically trying to kill, and the
  // recorded congested-pass-loop bug scenario started looping again. A
  // meeting point has to be somewhere the teammate genuinely is not.
  const distinct = (point) => yardDistance(start, point) >= MIN_LEAD_GAIN_YARDS;
  const pushIfDistinct = (entry) => { if (distinct(entry.point)) points.push(entry); };

  const towardPasser = {
    x: start.x + (passer.x - start.x) * (scale(SHORT_SUPPORT_YARDS) / Math.max(1e-6, yardDistance(runner, passer))),
    y: start.y + (passer.y - start.y) * (SHORT_SUPPORT_YARDS / Math.max(1e-6, yardDistance(runner, passer))),
  };
  if (distinct(towardPasser)) points.push({ kind: "short-support", point: towardPasser });

  pushIfDistinct({
    kind: "forward-lead",
    point: { x: start.x, y: start.y + sign * yardsToPercentY(scale(FORWARD_LEAD_YARDS)) },
  });

  // Diagonal releases run toward the middle when the runner is wide and
  // toward the channel when they are central -- the direction is read off
  // the runner's own position, never authored.
  const inwardSign = start.x > 50 ? -1 : 1;
  pushIfDistinct({
    kind: "diagonal-lead",
    point: {
      x: start.x + inwardSign * yardsToPercentX(scale(DIAGONAL_LEAD_LATERAL_YARDS) * 0.6),
      y: start.y + sign * yardsToPercentY(scale(DIAGONAL_LEAD_FORWARD_YARDS) * 0.8),
    },
  });

  // An overlap/wide release goes the other way: outside, toward the nearer
  // touchline, which is what makes it an overlap rather than a cut inside.
  const outwardSign = touchlineBias ?? (start.x > 50 ? 1 : -1);
  pushIfDistinct({
    kind: "wide-release",
    point: {
      x: start.x + outwardSign * yardsToPercentX(scale(WIDE_RELEASE_LATERAL_YARDS) * 0.7),
      y: start.y + sign * yardsToPercentY(scale(WIDE_RELEASE_FORWARD_YARDS) * 0.7),
    },
  });

  if (defenderLineY !== null && Number.isFinite(defenderLineY)) {
    pushIfDistinct({
      kind: "run-in-behind",
      // Beyond the real defensive line, but never further than the runner
      // can actually get: the line is where the defence is, the budget is
      // what the runner can do about it.
      point: (() => {
        const nominalY = defenderLineY + sign * yardsToPercentY(RUN_IN_BEHIND_BEYOND_LINE_YARDS);
        const nominalYards = Math.abs(nominalY - start.y) * PITCH_LENGTH_YARDS / 100;
        const allowed = Math.min(nominalYards, budget);
        return { x: start.x, y: start.y + Math.sign(nominalY - start.y) * yardsToPercentY(allowed) };
      })(),
    });
  }

  if (patternTarget && Number.isFinite(patternTarget.x) && Number.isFinite(patternTarget.y)) {
    pushIfDistinct({ kind: "pattern-proposed", point: { x: patternTarget.x, y: patternTarget.y } });
  }

  return points;
}

// ---------------------------------------------------------------------------
// Delivery selection
// ---------------------------------------------------------------------------

/**
 * Which delivery actually gets struck toward this point.
 *
 * selectPassType() supplies the geometric baseline from distance, lane
 * congestion and the passer. The joint model can then weight a clear,
 * medium-range driven ball down to a controlled ground pass when the chosen
 * idea is explicitly to meet a slow receiver at their feet. It also upgrades
 * a ground-family answer over real distance to a supported aerial delivery.
 * A forced type is never adapted in either direction.
 */
export function resolveDeliveryType({
  passer, receiver = null, from, to, opponents = [], deps,
  forcedPassType = null, meetingPointKind = null,
}) {
  const distanceYards = yardDistance(from, to);
  if (forcedPassType) {
    return {
      passType: forcedPassType, distanceYards, upgraded: false,
      receiverAdjusted: false, receiverMobility: null,
    };
  }
  let selected = deps.selectPassType({
    passer, from, to, opponents, deliveryIntent: meetingPointKind ?? "current-position",
  });
  const receiverMobility = receiver
    ? playerAttribute(receiver, "Pace") * 0.7 + playerAttribute(receiver, "Acceleration") * 0.3
    : null;
  const receiverAdjusted = selected === "driven-ground"
    && distanceYards <= CONTROLLED_TO_FEET_MAX_YARDS
    && meetingPointKind === "current-position"
    && receiverMobility !== null
    && receiverMobility < TO_FEET_DRIVEN_MIN_MOBILITY;
  if (receiverAdjusted) selected = "ground";
  if (!GROUND_FAMILY.has(selected) || distanceYards <= GROUND_FAMILY_MAX_YARDS) {
    return {
      passType: selected, distanceYards, upgraded: false,
      receiverAdjusted, receiverMobility,
    };
  }
  const power = (
    playerAttribute(passer, "Strength")
    + playerAttribute(passer, "Technique")
    + playerAttribute(passer, "Passing")
  ) / 3;
  return {
    passType: power >= AERIAL_UPGRADE_MIN_POWER ? "driven-aerial" : "lofted",
    distanceYards,
    upgraded: true,
    receiverAdjusted: false,
    receiverMobility,
  };
}

// ---------------------------------------------------------------------------
// One joint candidate
// ---------------------------------------------------------------------------

/**
 * Evaluates one (passer, runner, meeting point, delivery) idea completely.
 *
 * Every arrival time in here comes from an existing authoritative system:
 * the ball's from the pass-flight profile, the runner's and every
 * defender's from playerKinetics. They are all expressed in milliseconds
 * from the kick so they can be compared directly, which is the only reason
 * this module exists as one place rather than three.
 *
 * Returns the full candidate contract, viable or not. A rejected candidate
 * is still returned, with its reason, because "why was this not offered" is
 * exactly what the diagnostics panel has to be able to answer.
 */
export function evaluateJointCandidate({
  passer, runner, meetingPoint, kind = "current-position",
  opponents = [], keeper = null, attackingDirection = "down",
  deps, forcedPassType = null, patternJob = null, reservedJobs = null,
  baseUtility = 0, restart = null, initialSpeedYps = 0, runnerIsRunning = false,
} = {}) {
  assertDeps(deps);
  const source = pointOf(passer);
  const runnerStart = pointOf(runner);
  const point = { x: meetingPoint.x, y: meetingPoint.y };

  const {
    passType, distanceYards: passDistanceYards, upgraded,
    receiverAdjusted, receiverMobility,
  } = resolveDeliveryType({
    passer: passer.player, receiver: runner.player, from: source, to: point,
    opponents, deps, forcedPassType, meetingPointKind: kind,
  });
  const ballEtaMs = deps.flightDurationMs(passDistanceYards, passType);

  const runnerDistanceYards = yardDistance(runner, point);
  const runnerReactionMs = deps.reactionDelayMs
    ? deps.reactionDelayMs(runner.player, { isIntendedReceiver: true })
    : 0;
  // timeToReach() models a cold start. A runner already carrying momentum
  // covers the same ground sooner, so their arrival is solved against the
  // SAME reachIn() curve everything else uses rather than a second formula.
  const runnerEtaMs = runnerReactionMs
    + arrivalSecondsFor(runner.player, runnerDistanceYards, initialSpeedYps) * 1000;

  // Every defender races the same point from their own real pose. The
  // keeper is included when supplied: a ball played in behind is very often
  // the keeper's to claim, and pretending otherwise is how a through ball
  // gets scored as safe when it is not.
  const defenders = keeper ? [...opponents, keeper] : opponents;
  let defenderEtaMs = Infinity;
  let nearestDefenderId = null;
  for (const defender of defenders) {
    if (!defender?.player) continue;
    const reaction = deps.reactionDelayMs
      ? deps.reactionDelayMs(defender.player, { isIntendedReceiver: false })
      : 0;
    const eta = reaction + timeToReach(defender.player, yardDistance(defender, point)) * 1000;
    if (eta < defenderEtaMs) { defenderEtaMs = eta; nearestDefenderId = defender.id; }
  }

  // Arrival margin is the runner against the ball: negative means they are
  // there waiting, positive means the ball beats them.
  const arrivalMarginMs = runnerEtaMs - ballEtaMs;
  // Contest margin is the runner against the quickest defender.
  const contestMarginMs = Number.isFinite(defenderEtaMs) ? defenderEtaMs - runnerEtaMs : Infinity;

  const laneInterceptor = deps.nearestLaneInterceptor(source, point, opponents);
  const laneObstruction = deps.laneObstruction(source, point, opponents);
  let laneInterceptEtaMs = Infinity;
  if (laneInterceptor) {
    const reaction = deps.reactionDelayMs
      ? deps.reactionDelayMs(laneInterceptor.player, { isIntendedReceiver: false })
      : 0;
    // The lane is only genuinely cut out if the interceptor reaches the
    // ball's own path before the ball has passed them, so this is judged
    // against the ball's time to THEIR point on the lane, not to the
    // meeting point.
    const alongYards = yardDistance(source, laneInterceptor);
    const ballAtInterceptorMs = deps.flightDurationMs(alongYards, passType);
    laneInterceptEtaMs = reaction + timeToReach(laneInterceptor.player, yardDistance(laneInterceptor, point)) * 1000;
    laneInterceptEtaMs = Math.min(laneInterceptEtaMs, ballAtInterceptorMs + reaction);
  }

  // Kick-time legality is judged on where the runner ACTUALLY IS when the
  // ball is played, never on the point they are running to. That is Law 11,
  // and it is also what makes a run in behind legal at all.
  const offside = buildOffsideSnapshot({
    attacker: runner,
    ballPoint: source,
    defenders: keeper ? [...opponents, keeper] : opponents,
    attackingDirection,
    restart,
  });

  const region = classifyTacticalRegion(point, attackingDirection);
  const progressionYards = progressionYardsBetween(runnerStart, point, attackingDirection);
  const range = credibleRangeYards(passer.player);

  // ---- viability, in a fixed order so the reported reason is stable -----
  let rejection = null;
  if (!onPitch(point)) {
    rejection = "meeting-point-off-pitch";
  } else if (offside.isOffside) {
    rejection = "runner-offside-at-kick";
  } else if (passDistanceYards > range) {
    rejection = "outside-passer-range";
  } else if (GROUND_FAMILY.has(passType) && passDistanceYards > GROUND_FAMILY_MAX_YARDS) {
    rejection = "ground-pass-too-long";
  } else if (reservedJobs && patternJob && reservedJobs.has(patternJob)) {
    rejection = "pattern-job-conflict";
  } else if (
    runnerDistanceYards
    > topSpeed(runner.player) * Math.max(0, ballEtaMs + RUNNER_LATE_TOLERANCE_MS - runnerReactionMs) / 1000
  ) {
    // Genuinely impossible: the runner could not cover this ground even at
    // flat-out top speed for the whole flight, with no acceleration cost at
    // all. This is the teleport guard, and it is deliberately weaker than
    // the arrival test below rather than a duplicate of it -- an earlier
    // version compared against reachIn() over the same window, which is
    // algebraically the SAME condition as "arrives late" and silently made
    // RUNNER_LATE_TOLERANCE_MS dead code: every marginally-late runner was
    // reported as a teleport, and no candidate could ever use the tolerance.
    rejection = "beyond-physical-reach";
  } else if (arrivalMarginMs > RUNNER_LATE_TOLERANCE_MS) {
    // Reachable in principle, but the ball gets there too far ahead of them.
    rejection = "runner-cannot-arrive";
  } else if (Number.isFinite(laneInterceptEtaMs) && laneInterceptEtaMs + DEFENDER_CUTOUT_MARGIN_MS < ballEtaMs) {
    rejection = "lane-intercepted";
  } else if (contestMarginMs < -DEFENDER_CUTOUT_MARGIN_MS) {
    rejection = "defender-arrives-first";
  }

  const utility = scoreJointCandidate({
    baseUtility, kind, arrivalMarginMs, contestMarginMs, laneObstruction,
    progressionYards, passDistanceYards, range, upgraded,
  });

  return {
    passerId: passer.id,
    runnerId: runner.id,
    sourcePoint: source,
    runnerStartPoint: runnerStart,
    intendedPoint: point,
    meetingPointKind: kind,
    patternJob,
    runnerIsRunning,
    passType,
    passTypeUpgraded: upgraded,
    passTypeReceiverAdjusted: receiverAdjusted,
    receiverMobility,
    passDistanceYards,
    runnerDistanceYards,
    runnerReactionMs,
    runnerEtaMs,
    ballEtaMs,
    defenderEtaMs,
    nearestDefenderId,
    arrivalMarginMs,
    contestMarginMs,
    laneObstruction,
    laneInterceptorId: laneInterceptor?.id ?? null,
    laneInterceptEtaMs,
    offside,
    region,
    progressionYards,
    credibleRangeYards: range,
    viable: rejection === null,
    rejection,
    utility: utility.total,
    utilityBreakdown: utility.terms,
  };
}

/**
 * Deterministic scoring. `baseUtility` is whatever the caller's existing,
 * already-tuned pass utility says about playing the ball to this point --
 * this function never replaces that judgement, it only adds what the old
 * one structurally could not see, because the old one had no runner and no
 * arrival times.
 *
 * A current-position candidate with a comfortable arrival and a clear lane
 * scores exactly its base utility. That is deliberate: an ordinary short
 * pass to a stationary teammate must keep behaving as it always did.
 */
export function scoreJointCandidate({
  baseUtility = 0, kind = "current-position", arrivalMarginMs = 0, contestMarginMs = Infinity,
  laneObstruction = 0, progressionYards = 0, passDistanceYards = 0, range = 60, upgraded = false,
} = {}) {
  const terms = {};
  terms.base = baseUtility;

  // A pass to a teammate's own feet is a case the existing pass utility
  // already describes COMPLETELY: distance, lane, receiver pressure, result
  // position, congestion, style. It scores exactly what it always scored,
  // and every joint term stays zero.
  //
  // This is not a shortcut, it is the whole reason the integration is safe.
  // Scoring arrival and contest here as well would double-count the base
  // utility's own lane and pressure terms, which is precisely what made an
  // early version of this module quietly re-tune every passing decision in
  // the game: marked teammates were penalised twice, passing collapsed, and
  // possessions degenerated into hold/dribble streaks. The joint model is
  // only allowed to speak about what the old model structurally could not
  // see, which is a RUN to somewhere the teammate is not yet standing.
  if (kind === "current-position") {
    terms.arrival = 0;
    terms.contest = 0;
    terms.lane = 0;
    terms.runProgression = 0;
    terms.range = 0;
    terms.delivery = 0;
    return { total: baseUtility, terms };
  }

  // Every joint term below is a PENALTY or a reward for ground the run
  // itself gains. None of them is a blanket bonus, and that is deliberate:
  // an ordinary pass to a stationary, unmarked teammate must score exactly
  // what it always scored, or Stage 3 would silently re-tune every passing
  // decision in the game under cover of adding a feature. The joint model
  // is allowed to make a pass look WORSE than the old model thought (it can
  // see arrival times the old one could not) and it is allowed to reward a
  // run that gains ground. It is not allowed to inflate passing generally.

  // Being late for your own delivery is a real cost even inside tolerance.
  // Being early is simply normal and earns nothing.
  terms.arrival = arrivalMarginMs > 0 ? -clamp(0, 0.6, arrivalMarginMs / 600) : 0;

  // A defender arriving around the same time is the difference between a
  // pass into space and a pass into a tackle. Only ever a cost: a defender
  // being comfortably far away is what the base utility's own pressure term
  // already describes.
  terms.contest = Number.isFinite(contestMarginMs)
    ? -clamp(0, 0.9, (400 - contestMarginMs) / 900)
    : 0;

  // Lane obstruction is deliberately NOT scored here. passUtility() already
  // subtracts it, and counting it twice would penalise exactly the tight
  // through-ball lanes this stage exists to make possible.
  terms.lane = 0;

  // Ground genuinely gained by the RUN itself, over and above where the
  // teammate already stood. A current-position meeting point gains nothing
  // by definition, which is what keeps an ordinary pass at its base.
  terms.runProgression = clamp(-0.4, 0.7, progressionYards / 25);

  // Approaching the edge of what this passer can strike is a real risk even
  // before the pass type is chosen.
  terms.range = -clamp(0, 0.5, Math.max(0, passDistanceYards - range * 0.75) / Math.max(1, range * 0.25)) * 0.5;

  // A delivery that had to be upgraded off the ground to be credible is a
  // harder ball to play well.
  terms.delivery = upgraded ? -0.15 : 0;

  const total = Object.values(terms).reduce((sum, value) => sum + value, 0);
  return { total, terms };
}

// ---------------------------------------------------------------------------
// Generation across a whole team
// ---------------------------------------------------------------------------

/**
 * Every joint candidate worth considering for one ball owner.
 *
 * `baseUtilityFor(runner, point)` is injected: it is the caller's existing
 * pass utility, evaluated with the meeting point as the target, so a
 * migrated decision keeps every tuned term it already had.
 *
 * Ordering is by utility then by a total id tie-break, so the result never
 * depends on the order teammates happened to arrive in the roster array.
 */
export function generateJointCandidates({
  passer, teammates = [], opponents = [], keeper = null, attackingDirection = "down",
  deps, baseUtilityFor = null, patternTargets = null, reservedJobs = null,
  defenderLineY = null, restart = null,
} = {}) {
  assertDeps(deps);
  const candidates = [];
  for (const runner of teammates) {
    if (!runner?.player || runner.id === passer.id) continue;
    const pattern = patternTargets?.get?.(runner.id) ?? null;
    // How far this runner can genuinely travel while the ball is in the
    // air, measured against the delivery this passer would actually play to
    // where the runner already stands. One bounded estimate, not a solver:
    // a lead point that shortens the pass only makes the budget more
    // generous, never less, so this never over-promises.
    const toRunnerYards = yardDistance(passer, runner);
    const nominalType = deps.selectPassType({
      passer: passer.player, from: pointOf(passer), to: pointOf(runner), opponents,
      deliveryIntent: "current-position",
    });
    const nominalFlightMs = deps.flightDurationMs(toRunnerYards, nominalType);
    const nominalReactionMs = deps.reactionDelayMs
      ? deps.reactionDelayMs(runner.player, { isIntendedReceiver: true })
      : 0;
    // A runner who already holds a forward intention carries real momentum
    // into the flight window; one standing in shape starts from rest.
    const initialSpeedYps = pattern?.running
      ? topSpeed(runner.player) * RUNNING_INTENTION_SPEED_FRACTION
      : 0;
    const reachBudgetYards = reachIn(
      runner.player, Math.max(0, nominalFlightMs - nominalReactionMs) / 1000, initialSpeedYps,
    );
    const points = generateMeetingPoints({
      passer, runner, attackingDirection, defenderLineY, reachBudgetYards,
      patternTarget: pattern?.point ?? null,
    });
    for (const { kind, point } of points) {
      candidates.push(evaluateJointCandidate({
        passer, runner, meetingPoint: point, kind,
        opponents, keeper, attackingDirection, deps, initialSpeedYps,
        runnerIsRunning: Boolean(pattern?.running),
        patternJob: kind === "pattern-proposed" ? (pattern?.job ?? null) : null,
        reservedJobs, restart,
        baseUtility: baseUtilityFor ? baseUtilityFor(runner, point) : 0,
      }));
    }
  }
  return sortJointCandidates(candidates);
}

/**
 * Total ordering: best utility first, then meeting-point kind, then runner
 * id. Every tie-break is total and none of them reads array position, which
 * is what makes ranking independent of roster order.
 */
export function sortJointCandidates(candidates) {
  return [...candidates].sort((left, right) =>
    right.utility - left.utility
    || String(left.meetingPointKind).localeCompare(String(right.meetingPointKind))
    || String(left.runnerId).localeCompare(String(right.runnerId)));
}

/** The best viable candidate for one specific runner, or null. */
export function bestCandidateForRunner(candidates, runnerId) {
  const id = String(runnerId);
  const viable = sortJointCandidates(candidates)
    .filter((candidate) => String(candidate.runnerId) === id && candidate.viable);
  if (!viable.length) return null;

  // If receiving at their current position is genuinely safe, a player who
  // lacks the mobility for a driven lead gets that simpler ball. A lead can
  // still win when the feet option is not viable (marked, intercepted or
  // otherwise rejected), so this does not ban slow players from making a
  // useful run into open space.
  const toFeet = viable.find((candidate) => candidate.meetingPointKind === "current-position");
  if (toFeet && Number.isFinite(toFeet.receiverMobility)
    && toFeet.receiverMobility < TO_FEET_DRIVEN_MIN_MOBILITY) return toFeet;
  return viable[0];
}

/**
 * The best viable candidate whose meeting point is genuinely a run into
 * space rather than a pass to feet -- what a through ball actually is.
 */
export function bestThroughBallCandidate(candidates, {
  minProgressionYards = 8, requireRunningIntention = true,
} = {}) {
  for (const candidate of sortJointCandidates(candidates)) {
    if (!candidate.viable) continue;
    if (candidate.meetingPointKind === "current-position") continue;
    if (candidate.progressionYards < minProgressionYards) continue;
    // A through ball is not "any forward pass." It requires a teammate who
    // is genuinely running INTO space, which the off-ball planner already
    // decides authoritatively (its run-in-behind job, gated on the runner
    // actually winning their own arrival race). Dropping that gate is what
    // made a congested cluster start offering itself a through ball on
    // every decision -- the recorded congested-pass-loop bug scenario began
    // looping again. Stage 3's contribution here is that the delivery is
    // now JOINTLY evaluated (real meeting point, real arrival race, real
    // defender ETA, real kick-time offside), not that the gate is looser.
    if (requireRunningIntention && !candidate.runnerIsRunning) continue;
    return candidate;
  }
  return null;
}

function assertDeps(deps) {
  for (const name of ["selectPassType", "flightDurationMs", "laneObstruction", "nearestLaneInterceptor"]) {
    if (typeof deps?.[name] !== "function") {
      throw new Error(`passRunCandidates requires deps.${name}() to be injected.`);
    }
  }
}
