// First-time play -- whether a player arriving at a moving ball may release
// it WITHOUT controlling it first, and how well.
//
// The engine currently has no such option. Every possession runs
// receive -> control -> decide -> release, which is the wrong rhythm for a
// large fraction of real football and is a strong candidate cause of the
// monotony recorded as Finding 2 in MATCH_ENGINE_OBSERVATION_BACKLOG.md.
//
// This module is PURE. It imports only geometry and the attribute reader, it
// consumes no RNG, it mutates nothing, and it returns the same result for the
// same inputs. The caller rolls, the caller owns the pitch geometry, and the
// caller decides what to do with the scores. Stage 1b wires it into the
// reception pipeline; nothing here knows that pipeline exists.
//
// THREE SEPARATE QUESTIONS, three separate outputs. Conflating them is the
// usual way this kind of model goes wrong:
//
//   feasibility01  CAN this contact be made cleanly at all -- pure physics
//                  and geometry, blind to who the player is.
//   competence01   Is THIS PLAYER good enough at this particular kind of
//                  contact -- pure attributes, blind to the situation.
//   preference01   Does the player WANT to, given tactics and pressure --
//                  blind to whether they can.
//
// A defender can be perfectly able to play a first-time ball and have no
// reason to; a winger can badly want to and be physically unable. Both cases
// are real football and neither survives a single blended "first-time score".
import { playerAttribute } from "./matchEngineCore.js";

/** The option kinds this module scores. */
export const FIRST_TIME_KINDS = Object.freeze([
  "first-time-pass", "layoff", "flick-on", "first-time-shot",
]);

/**
 * Below this the ball is not really arriving, it is sitting there, and
 * "first time" stops meaning anything -- striking a near-stationary ball is
 * just an ordinary pass taken early.
 */
export const MIN_INCOMING_SPEED_YPS = 3;

/**
 * A layoff is a cushioned contact, not a strike: the foot or chest is
 * presented and the ball rebounds off it. You cannot generate a driven ball
 * that way, which is exactly why a real layoff is always short and soft.
 */
export const LAYOFF_MAX_OUTGOING_YPS = 11;

/** Past this the contact is a return/cushion rather than a redirect. */
export const RETURN_REGIME_MIN_DEGREES = 120;

/** The lateral velocity demand that counts as a fully difficult redirect. */
export const LATERAL_DEMAND_REFERENCE_YPS = 18;

/** Error multipliers applied to the EXISTING pass-accuracy model. */
export const FIRST_TIME_BASE_PENALTY = 0.15;
export const FIRST_TIME_DIFFICULTY_WEIGHT = 1.2;
export const FIRST_TIME_SKILL_WEIGHT = 0.8;

const clamp = (min, max, value) => Math.max(min, Math.min(max, value));
const toRadians = (degrees) => (degrees * Math.PI) / 180;

/** Linear interpolation across sorted control points, flat outside the ends. */
function interpolate(points, at) {
  if (at <= points[0][0]) return points[0][1];
  const last = points[points.length - 1];
  if (at >= last[0]) return last[1];
  for (let index = 1; index < points.length; index += 1) {
    const [x1, y1] = points[index];
    if (at <= x1) {
      const [x0, y0] = points[index - 1];
      return y0 + ((y1 - y0) * (at - x0)) / (x1 - x0);
    }
  }
  return last[1];
}

/**
 * The angle between the ball's incoming TRAVEL direction and the intended
 * outgoing direction, in [0, 180].
 *
 * 0 means the ball carries straight on the way it was already going; 180
 * means it goes back where it came from.
 */
export function deflectionDegrees(incomingDirectionDeg, outgoingDirectionDeg) {
  const signed = ((outgoingDirectionDeg - incomingDirectionDeg) % 360 + 540) % 360 - 180;
  return Math.abs(signed);
}

/**
 * The physically demanding part of a first-time contact.
 *
 * The naive model is the magnitude of the required velocity change, and it
 * gets the football exactly backwards: it makes a layoff -- the EASIEST
 * first-time action there is -- the most expensive one, because sending a
 * fast ball back where it came from is a large |dv|.
 *
 * The reason that is wrong is that a layoff does not IMPART that change, it
 * ABSORBS it. The player presents a surface and the ball's own momentum does
 * the work. The same is true in the other direction: a ball flicked on in the
 * direction it was already travelling barely needs touching.
 *
 * What actually demands technique is the component of the outgoing velocity
 * PERPENDICULAR to the ball's line of travel -- the part you have to generate
 * yourself, because the incoming ball contributes nothing to it. That is
 * s_out * sin(deflection): zero at 0 degrees, zero at 180, and maximal at the
 * right angle across the body, which is precisely where real first-time play
 * is hardest.
 */
export function lateralDemandYps(deflectionDeg, outgoingSpeedYps) {
  return Math.abs(outgoingSpeedYps * Math.sin(toRadians(deflectionDeg)));
}

/**
 * Contact-height difficulty for a boot.
 *
 * Peaks just below hip height. That is not an arbitrary curve: a ball at the
 * ankle is an ordinary ground contact, a ball at chest height is a proper
 * volley you can swing through, and the genuinely awkward band is the one in
 * between where you can neither pass along the ground nor strike cleanly.
 */
export function footContactDifficulty01(heightYards) {
  return interpolate([
    [0.0, 0.05], [0.3, 0.15], [0.7, 0.70], [1.0, 0.95],
    [1.4, 0.60], [1.8, 0.85], [2.2, 1.00],
  ], heightYards);
}

/** Contact-height difficulty for a header. Impossible low, natural high. */
export function headContactDifficulty01(heightYards) {
  return interpolate([
    [1.2, 1.00], [1.4, 0.72], [1.7, 0.22], [1.95, 0.10],
    [2.4, 0.38], [3.0, 0.78], [3.4, 1.00],
  ], heightYards);
}

/** Which surface a kind uses. Flick-ons are headed; the rest are struck. */
export function surfaceFor(kind, heightYards) {
  if (kind === "flick-on") return "head";
  return heightYards >= 1.9 ? "head" : "foot";
}

export function contactHeightDifficulty01(heightYards, surface) {
  return surface === "head"
    ? headContactDifficulty01(heightYards)
    : footContactDifficulty01(heightYards);
}

/**
 * How much the player's own body orientation fights the release.
 *
 * `facingDeg` is optional and stays optional until Realism Roadmap Stage 4a
 * makes facing independent state. Until then facing is derived from velocity
 * everywhere in the engine, which cannot express a half-turned receiver, so
 * callers pass null and this term is neutral rather than fabricated.
 */
export function orientationDifficulty01(facingDeg, outgoingDirectionDeg) {
  if (!Number.isFinite(facingDeg)) return 0.25;
  // Releasing where you already face is free; releasing behind you is not.
  return clamp(0, 1, deflectionDegrees(facingDeg, outgoingDirectionDeg) / 180);
}

/**
 * Can this contact be made cleanly, ignoring who is making it.
 *
 * Returns 0 for a physically impossible attempt rather than a small number,
 * so a caller can treat zero as a hard gate.
 */
export function firstTimeFeasibility01({
  kind = "first-time-pass",
  incomingSpeedYps = 0,
  incomingHeightYards = 0,
  deflectionDeg = 0,
  outgoingSpeedYps = 0,
  facingDeg = null,
  outgoingDirectionDeg = 0,
} = {}) {
  if (!FIRST_TIME_KINDS.includes(kind)) return 0;
  // A ball that is not travelling cannot be played first time.
  if (!(incomingSpeedYps >= MIN_INCOMING_SPEED_YPS)) return 0;
  // A flick-on is a headed continuation. Both halves of that are hard gates.
  if (kind === "flick-on") {
    if (incomingHeightYards < 1.2) return 0;
    if (deflectionDeg > 70) return 0;
  }
  // A layoff is a cushion, so it cannot be a driven ball, and it must
  // actually go back rather than across.
  if (kind === "layoff") {
    if (outgoingSpeedYps > LAYOFF_MAX_OUTGOING_YPS) return 0;
    if (deflectionDeg < RETURN_REGIME_MIN_DEGREES) return 0;
  }
  const surface = surfaceFor(kind, incomingHeightYards);
  const heightDifficulty = contactHeightDifficulty01(incomingHeightYards, surface);
  if (heightDifficulty >= 1) return 0;
  const lateral = clamp(0, 1, lateralDemandYps(deflectionDeg, outgoingSpeedYps) / LATERAL_DEMAND_REFERENCE_YPS);
  // A fast ball is harder to meet cleanly, but only mildly so once the
  // deflection and height terms have already been paid -- the pace of the
  // ball is mostly what you are USING, not what you are fighting.
  const pace = clamp(0, 1, (incomingSpeedYps - MIN_INCOMING_SPEED_YPS) / 26) * 0.35;
  const orientation = orientationDifficulty01(facingDeg, outgoingDirectionDeg) * 0.4;
  const difficulty = clamp(0, 1, heightDifficulty * 0.45 + lateral * 0.45 + pace + orientation);
  return clamp(0, 1, 1 - difficulty);
}

/** Attribute weights per kind. Everything reads on the engine's 1-20 scale. */
const COMPETENCE_WEIGHTS = Object.freeze({
  "first-time-pass": Object.freeze([
    ["Technique", 0.35], ["Passing", 0.3], ["Composure", 0.15],
    ["Decisions", 0.1], ["Anticipation", 0.1],
  ]),
  // Cushioning a ball into a runner's path is a touch skill before it is a
  // passing one, which is why First Touch appears here and nowhere else.
  layoff: Object.freeze([
    ["Technique", 0.3], ["Passing", 0.25], ["Anticipation", 0.2],
    ["First Touch", 0.15], ["Composure", 0.1],
  ]),
  "flick-on": Object.freeze([
    ["Heading", 0.4], ["Anticipation", 0.25], ["Jumping", 0.2], ["Technique", 0.15],
  ]),
  "first-time-shot": Object.freeze([
    ["Technique", 0.35], ["Finishing", 0.3], ["Composure", 0.2], ["Anticipation", 0.15],
  ]),
});

/** How good this player is at this specific kind of contact, 0..1. */
export function firstTimeCompetence01(player, kind) {
  const weights = COMPETENCE_WEIGHTS[kind];
  if (!weights) return 0;
  const total = weights.reduce((sum, [label, weight]) => sum + playerAttribute(player, label) * weight, 0);
  return clamp(0, 1, total / 20);
}

const TEMPO_APPETITE = Object.freeze({ quick: 0.22, balanced: 0, slow: -0.18 });
const CREATIVITY_APPETITE = Object.freeze({ expressive: 0.12, balanced: 0, disciplined: -0.12 });
const SHOOTING_APPETITE = Object.freeze({ encourage: 0.2, balanced: 0, discourage: -0.22 });

/**
 * Does the player want to release first time, given tactics and the picture.
 *
 * Pressure belongs HERE and not in feasibility, and the distinction matters:
 * being closed down does not make a first-time ball easier to strike, it
 * makes controlling first a worse idea. That is why real players play quicker
 * under pressure while also playing worse under pressure.
 */
export function firstTimePreference01({
  kind = "first-time-pass",
  pressure01 = 0,
  attackingSettings = null,
  shootingInstruction = "balanced",
  targetIsAdvanced = false,
} = {}) {
  const style = attackingSettings?.style ?? "possession";
  const tempo = attackingSettings?.tempo ?? "balanced";
  const creativity = attackingSettings?.creativity ?? "balanced";
  let appetite = 0.35;
  appetite += clamp(0, 1, pressure01) * 0.4;
  appetite += TEMPO_APPETITE[tempo] ?? 0;
  appetite += CREATIVITY_APPETITE[creativity] ?? 0;
  if (style === "direct" || style === "long-ball") {
    // A direct side wants the ball moved on, and a flick-on is the signature
    // action of that style rather than an incidental one.
    appetite += kind === "flick-on" ? 0.25 : 0.1;
  } else if (style === "possession" && kind === "flick-on") {
    appetite -= 0.15;
  }
  if (kind === "first-time-shot") appetite += SHOOTING_APPETITE[shootingInstruction] ?? 0;
  if (targetIsAdvanced) appetite += 0.12;
  return clamp(0, 1, appetite);
}

/**
 * The multiplier a first-time release applies to the EXISTING pass-accuracy
 * error term.
 *
 * Deliberately a multiplier on `resolvePassAccuracy`'s own output rather than
 * a second accuracy model: first-time error then has one tuning surface, and
 * every improvement to the shared model reaches first-time play for free.
 * The floor is above 1 because even a perfectly struck first-time ball is
 * less precise than the same ball after a settling touch.
 */
export function firstTimeAccuracyPenalty({ feasibility01 = 0, competence01 = 0 } = {}) {
  return 1 + FIRST_TIME_BASE_PENALTY
    + (1 - clamp(0, 1, feasibility01)) * FIRST_TIME_DIFFICULTY_WEIGHT
    + (1 - clamp(0, 1, competence01)) * FIRST_TIME_SKILL_WEIGHT;
}

/**
 * Score every candidate release the caller has proposed.
 *
 * The caller owns the geometry: it supplies each candidate's outgoing
 * direction, speed and target, because only the caller knows where the
 * teammates and the goal actually are. This module supplies the physics, the
 * competence and the appetite.
 *
 * `options` comes back sorted best-first and already filtered to the
 * genuinely possible, so `available` is a straight answer to "may this
 * player release without controlling".
 */
export function evaluateFirstTimeOptions({
  player = null,
  incoming = null,
  candidates = [],
  pressure01 = 0,
  facingDeg = null,
  attackingSettings = null,
  shootingInstruction = "balanced",
  minimumFeasibility = 0.2,
} = {}) {
  const incomingSpeedYps = Number(incoming?.speedYps) || 0;
  const incomingHeightYards = Math.max(0, Number(incoming?.heightYards) || 0);
  const incomingDirectionDeg = Number(incoming?.directionDeg) || 0;
  if (incomingSpeedYps < MIN_INCOMING_SPEED_YPS) {
    return { available: false, options: [], best: null, reason: "ball-not-travelling" };
  }
  const options = [];
  for (const candidate of candidates) {
    const kind = candidate?.kind;
    if (!FIRST_TIME_KINDS.includes(kind)) continue;
    const outgoingDirectionDeg = Number(candidate.outgoingDirectionDeg) || 0;
    const outgoingSpeedYps = Math.max(0, Number(candidate.outgoingSpeedYps) || 0);
    const deflectionDeg = deflectionDegrees(incomingDirectionDeg, outgoingDirectionDeg);
    const feasibility01 = firstTimeFeasibility01({
      kind, incomingSpeedYps, incomingHeightYards, deflectionDeg,
      outgoingSpeedYps, facingDeg, outgoingDirectionDeg,
    });
    if (feasibility01 < minimumFeasibility) continue;
    const competence01 = firstTimeCompetence01(player, kind);
    const preference01 = firstTimePreference01({
      kind, pressure01, attackingSettings, shootingInstruction,
      targetIsAdvanced: candidate.targetIsAdvanced === true,
    });
    options.push({
      kind,
      targetId: candidate.targetId ?? null,
      surface: surfaceFor(kind, incomingHeightYards),
      deflectionDeg,
      outgoingDirectionDeg,
      outgoingSpeedYps,
      feasibility01,
      competence01,
      preference01,
      accuracyPenalty: firstTimeAccuracyPenalty({ feasibility01, competence01 }),
      // A single ordering number for callers that want one. It is a product,
      // not a sum, so a zero in any of the three genuinely rules the option
      // out instead of being averaged away by the other two.
      score: feasibility01 * competence01 * preference01,
    });
  }
  options.sort((left, right) => right.score - left.score
    || right.feasibility01 - left.feasibility01
    // Kind order is the last tie-break so that equal scores resolve the same
    // way on every run -- an unstable order here would re-key the caller's
    // RNG for no reason.
    || FIRST_TIME_KINDS.indexOf(left.kind) - FIRST_TIME_KINDS.indexOf(right.kind));
  return {
    available: options.length > 0,
    options,
    best: options[0] ?? null,
    reason: options.length ? "available" : "no-feasible-option",
  };
}
