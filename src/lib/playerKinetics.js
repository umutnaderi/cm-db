import { clamp, playerAttribute } from "./matchEngineCore.js";
import { rollLaunchSpeedForDistance, rollStopDistanceYards, GROUND_FRICTION_YPS2 } from "./ballRollPhysics.js";

// One physical vocabulary for both simulation and authored playback.
// Values are expressed in real pitch yards / seconds; callers convert to
// the rendered 0-100 grid only at their boundary.
export const MAX_SPEED_MIN = 6.4;
export const MAX_SPEED_MAX = 10.2;
export const TIME_TO_TOP_MAX = 2.6;
export const TIME_TO_TOP_MIN = 1.4;
export const TURN_PENALTY = 0.75;

// On-ball gait + possession stamina v1 (2026-08-31) -- the old
// nimble/jog/sprint ternary named a real thing (touch spacing) but not
// the real football question underneath it (why is this player taking
// short touches right now: crowded, or a deliberate lateral shield?).
// Four proper gaits now, keyed by what's actually driving the choice
// (determineCarryGait(), spatialDecision.js): close-control (tight to
// the foot, the final-third default), controlled-sprint (a real lane,
// pushed but recoverable), full-sprint (nobody in front, a genuine
// counter), lateral-control (hugging a touchline, along the line rather
// than through traffic). Old names kept as aliases -- any caller that
// still passes "nimble"/"jog"/"sprint" directly (a raw touchThreshold()/
// touchLaunchSpeedYps() call, an existing test) gets the IDENTICAL
// distance it always did; only full-sprint's own base actually changed
// (4.2 -> 5.5yd, pushed further away -- see determineCarryGait()'s own
// header for why the old ternary let a "sprint" fire in a packed half).
const TOUCH_BASE_YARDS = Object.freeze({
  "close-control": 1.4, "controlled-sprint": 2.6, "full-sprint": 5.5, "lateral-control": 2.0,
  nimble: 1.4, jog: 2.6, sprint: 4.2,
});

// Ground Roll v2 (2026-08-28) -- the speed a touch is struck AT, never
// derived from where it needs to end up. TOUCH_BASE_YARDS above stays the
// single reference for "how far does an average touch at this gait
// naturally travel" -- rollLaunchSpeedForDistance() (ballRollPhysics.js)
// just asks "what launch speed, under real turf friction, produces that
// distance for an average player," a fixed constant computed once at
// module load, not a per-touch inversion of an already-decided waypoint.
const TOUCH_LAUNCH_BASE_YPS = Object.freeze(
  Object.fromEntries(Object.entries(TOUCH_BASE_YARDS)
    .map(([gait, yards]) => [gait, rollLaunchSpeedForDistance(yards)])),
);

function rating(player, label) {
  return clamp(1, 20, playerAttribute(player, label));
}

export function topSpeed(player) {
  return MAX_SPEED_MIN + (rating(player, "Pace") / 20) * (MAX_SPEED_MAX - MAX_SPEED_MIN);
}

export function timeToTopSpeed(player) {
  return TIME_TO_TOP_MAX
    - (rating(player, "Acceleration") / 20) * (TIME_TO_TOP_MAX - TIME_TO_TOP_MIN);
}

// Momentum Continuity v1 (2026-08-31) -- user, a real correction: "a
// player who is already running will be faster than a player who just
// started... acceleration takes time." reachIn() always modeled a cold
// start from a dead stop, for every leg, no matter how fast the player
// was ACTUALLY moving a moment before -- the existing incomingVelocity
// field elsewhere in this project only ever smoothed the RENDERED
// tangent, it never fed back into how much real ground got covered.
// initialSpeedYps (optional, defaults to 0) is the SAME constant-
// acceleration model, just starting from a real speed instead of rest --
// a genuine SUVAT distance (d = v0*t + 0.5*a*t^2) up to however long is
// left to reach topSpeed from THERE, then topSpeed*t beyond that.
// initialSpeedYps=0 reduces to the exact original formula (verified: the
// old accelerationTime IS timeToTop when startSpeed=0) -- every existing
// caller that omits the new parameter keeps byte-identical behavior.
export function reachIn(player, seconds, initialSpeedYps = 0) {
  const elapsed = Math.max(0, Number(seconds) || 0);
  const maximum = topSpeed(player);
  const accelerationTime = timeToTopSpeed(player);
  const accelerationRate = maximum / accelerationTime;
  const startSpeed = clamp(0, maximum, Number(initialSpeedYps) || 0);
  const timeToTop = accelerationRate > 0 ? (maximum - startSpeed) / accelerationRate : 0;
  return elapsed <= timeToTop
    ? startSpeed * elapsed + 0.5 * accelerationRate * elapsed * elapsed
    : startSpeed * timeToTop + 0.5 * accelerationRate * timeToTop * timeToTop
      + maximum * (elapsed - timeToTop);
}

// Momentum Continuity v1 -- the companion query reachIn() itself never
// needed before: not "how far," but "how fast is he going NOW," so a
// caller chaining multiple real legs (simulateCarryTouches()'s own
// touch-to-touch chase, the concrete case this fixes) can carry the
// REAL reached speed from one leg into the next leg's own initialSpeedYps,
// instead of silently resetting to rest every time. Same SUVAT model as
// reachIn() above, just v = v0 + a*t clamped at topSpeed instead of the
// integrated distance.
export function speedAtElapsed(player, seconds, initialSpeedYps = 0) {
  const elapsed = Math.max(0, Number(seconds) || 0);
  const maximum = topSpeed(player);
  const accelerationTime = timeToTopSpeed(player);
  const accelerationRate = maximum / accelerationTime;
  const startSpeed = clamp(0, maximum, Number(initialSpeedYps) || 0);
  const timeToTop = accelerationRate > 0 ? (maximum - startSpeed) / accelerationRate : 0;
  return elapsed >= timeToTop ? maximum : startSpeed + accelerationRate * elapsed;
}

export function timeToReach(player, yards, initialSpeedYps = 0) {
  const distance = Math.max(0, Number(yards) || 0);
  const maximum = topSpeed(player);
  const accelerationTime = timeToTopSpeed(player);
  const acceleration = maximum / accelerationTime;
  const initial = clamp(0, maximum, Number(initialSpeedYps) || 0);
  const remainingAccelerationTime = (maximum - initial) / acceleration;
  const accelerationDistance = (initial + maximum) * remainingAccelerationTime / 2;
  return distance <= accelerationDistance
    ? (Math.sqrt(initial * initial + 2 * acceleration * distance) - initial) / acceleration
    : remainingAccelerationTime + (distance - accelerationDistance) / maximum;
}

// Stage 4, Playback Fluidity (2026-09-06) -- the missing half of the
// locomotion model. reachIn()/speedAtElapsed() describe how a player gets
// UP to speed; nothing described how they come off it, so a leg that
// reached its target simply had its velocity set to zero. Measured on the
// real fixture sweep, that is a genuine discontinuity, not a rounding
// artefact: a defender covering across during a DEF.ADJUST window was
// still travelling 3.7 yd/s at one playback keyframe and 0 at the next,
// with the position track showing a constant approach speed and then a
// dead stop.
//
// Braking is not acceleration run backwards. A human decelerates
// appreciably harder than they accelerate -- planting and absorbing load
// through the legs is a stronger action than driving out of a standstill
// -- so this is expressed as a multiple of the player's OWN acceleration
// rate rather than as an independent constant, which keeps it inside the
// existing Pace/Acceleration vocabulary instead of introducing a second,
// competing speed model. Agility scales it, exactly as it already scales
// turnRetention() and reigniteFactor(): checking your momentum and
// planting is the same physical quality as changing direction on it.
export const BRAKING_ADVANTAGE_MIN = 1.25;
export const BRAKING_ADVANTAGE_MAX = 1.9;

/** Yards per second squared, always positive. */
export function decelerationRate(player) {
  const accelerationRate = topSpeed(player) / timeToTopSpeed(player);
  const agility = rating(player, "Agility") / 20;
  return accelerationRate
    * (BRAKING_ADVANTAGE_MIN + agility * (BRAKING_ADVANTAGE_MAX - BRAKING_ADVANTAGE_MIN));
}

/** Ground needed to come to rest from a given speed: v^2 / 2a. */
export function brakingDistance(player, fromSpeedYps) {
  const speed = Math.max(0, Number(fromSpeedYps) || 0);
  const rate = decelerationRate(player);
  return rate > 0 ? (speed * speed) / (2 * rate) : 0;
}

/** Time to come to rest from a given speed: v / a. */
export function brakingSeconds(player, fromSpeedYps) {
  const speed = Math.max(0, Number(fromSpeedYps) || 0);
  const rate = decelerationRate(player);
  return rate > 0 ? speed / rate : 0;
}

/** Speed remaining after braking for `seconds`, floored at rest. */
export function speedAfterBraking(player, fromSpeedYps, seconds) {
  const speed = Math.max(0, Number(fromSpeedYps) || 0);
  const elapsed = Math.max(0, Number(seconds) || 0);
  return Math.max(0, speed - decelerationRate(player) * elapsed);
}

export function turnRetention(player, angleDegrees) {
  const agility = rating(player, "Agility") / 20;
  const severity = Math.min(1, Math.abs(Number(angleDegrees) || 0) / 180);
  return clamp(0, 1, 1 - severity * (1 - agility) * TURN_PENALTY);
}

// A dive is not locomotion (2026-09-06).
//
// reachIn() models a runner building speed from a standstill, which over the
// two or three tenths of a second a keeper actually has is almost no ground
// at all -- measured, an elite keeper covered 0.15 yd in the first 250 ms. A
// dive is the opposite kind of action: a single explosive push off one leg
// that launches the body sideways at close to its full speed immediately.
// Modelling it with the running curve is what left keepers unable to reach
// shots they should comfortably save.
//
// This is deliberately NOT a second locomotion model and must never be used
// as one. It is a distinct, committed, one-off action with its own short
// window: a player cannot dive continuously, and after DIVE_COMMIT_SECONDS
// they are on the ground, not travelling. Leg power comes from Agility and
// Jumping together -- the same two attributes that already decide how well a
// player changes direction on their momentum and how high they get off the
// floor.
// Calibrated against the recorded Ronaldo-vs-Stensgaard one-on-one fixture
// (tools/test-possession-runner.mjs, 2400 trials), which brackets an elite
// striker clean through on a mid keeper at 51-75%. Before a dive existed the
// keeper never arrived and it converted 87.3%; these values put it at 65.2%,
// mid-band rather than on either edge. The resulting envelope is a 3.9 yard
// full-stretch reach for an elite keeper and 2.8 for a poor one, against a
// flat 2.1 and 1.7 when reach was static.
export const DIVE_LAUNCH_MIN_YPS = 1.8;
export const DIVE_LAUNCH_MAX_YPS = 3.6;
export const DIVE_COMMIT_SECONDS = 0.52;

/** Sideways launch speed of a committed dive, yards per second. */
export function diveLaunchSpeedYps(player) {
  const power = (rating(player, "Agility") + rating(player, "Jumping")) / 2 / 20;
  return DIVE_LAUNCH_MIN_YPS + power * (DIVE_LAUNCH_MAX_YPS - DIVE_LAUNCH_MIN_YPS);
}

/** Ground a committed dive covers in the time available, capped at one dive. */
export function diveReachYards(player, seconds) {
  const committed = Math.min(Math.max(0, Number(seconds) || 0), DIVE_COMMIT_SECONDS);
  return diveLaunchSpeedYps(player) * committed;
}

export function reigniteFactor(player) {
  return 0.6 + 0.4 * (rating(player, "Agility") / 20);
}

export function touchThreshold(player, gait = "jog") {
  const dribbling = rating(player, "Dribbling") / 20;
  const base = TOUCH_BASE_YARDS[gait] ?? TOUCH_BASE_YARDS.jog;
  return base * (1.35 - 0.5 * dribbling);
}

// Ground Roll v2 (2026-08-28) -- the impulse a touch imparts to the ball:
// a real launch speed from gait + Dribbling + Technique + pressure, NEVER
// from how far the touch needs to travel. How far it actually goes is
// whatever rollStopDistanceYards() (ballRollPhysics.js) says that speed
// produces under real turf friction -- physics decides the distance,
// this only decides how hard the ball was struck. Weaker control /
// heavier pressure = a firmer, less precise strike that carries further
// before friction catches it; better control keeps it close.
export function touchLaunchSpeedYps(player, gait = "jog", pressure = 0) {
  const control = (rating(player, "Dribbling") + rating(player, "Technique")) / 40;
  const base = TOUCH_LAUNCH_BASE_YPS[gait] ?? TOUCH_LAUNCH_BASE_YPS.jog;
  const pressureFactor = 1 + clamp(0, 1, Number(pressure) || 0) * 0.35;
  return base * (1.35 - 0.5 * control) * pressureFactor;
}

// A running touch must put the ball ahead of the runner's CURRENT stride.
// Gait/control choose the intended spacing; the existing locomotion and roll
// equations choose the impulse that can meet that stride. Execution error is
// applied by the caller to the added impulse, never to the carried body speed.
export function runningTouchLaunchSpeedYps(player, gait, pressure, initialSpeedYps = 0, distanceLimitYards = Infinity) {
  const initial = clamp(0, topSpeed(player), Number(initialSpeedYps) || 0);
  const distance = Math.min(Math.max(0, distanceLimitYards),
    rollStopDistanceYards(touchLaunchSpeedYps(player, gait, pressure)));
  if (!(distance > 0)) return initial;
  const arrivalSeconds = timeToReach(player, distance, initial);
  // A cold, slow starter may meet a touch after it stops. Do not invent
  // negative roll velocity just to stretch the ball's flight to that ETA.
  const rollSeconds = Math.min(arrivalSeconds, Math.sqrt(2 * distance / GROUND_FRICTION_YPS2));
  return distance / rollSeconds + 0.5 * GROUND_FRICTION_YPS2 * rollSeconds;
}

// Maximum error envelope for a touch. Sampling that envelope is kept in the
// carry planner because only that caller owns a possession seed and a touch
// index. No gameplay RNG is consumed here.
export function touchError(player, pressure = 0) {
  const control = (rating(player, "Dribbling") + rating(player, "Technique")) / 40;
  const pressureFactor = 1 + clamp(0, 1, Number(pressure) || 0);
  return {
    angleDeg: (1 - control) * 12 * pressureFactor,
    distanceMul: 1 + (1 - control) * 0.35 * pressureFactor,
  };
}

export function kineticsAttribution(player, {
  gait = "jog", pressure = 0, seconds = 0.8, turnAngle = 90,
} = {}) {
  const averagePlayer = {
    current_ability: 100,
    attributes: ["Pace", "Acceleration", "Agility", "Dribbling", "Technique"]
      .map((label) => ({ label, value: 10 })),
  };
  return [
    {
      attr: "Pace + Acceleration",
      value: `${Math.round(rating(player, "Pace"))}/${Math.round(rating(player, "Acceleration"))}`,
      quantity: `reachIn(${seconds}s)`,
      baseline: reachIn(averagePlayer, seconds), actual: reachIn(player, seconds), unit: "yd",
    },
    {
      attr: "Agility",
      value: Math.round(rating(player, "Agility")),
      quantity: `turnRetention(${turnAngle}deg)`,
      baseline: turnRetention(averagePlayer, turnAngle), actual: turnRetention(player, turnAngle), unit: "ratio",
    },
    {
      attr: "Dribbling",
      value: Math.round(rating(player, "Dribbling")),
      quantity: `touchThreshold(${gait})`,
      baseline: touchThreshold(averagePlayer, gait), actual: touchThreshold(player, gait), unit: "yd",
    },
    {
      attr: "Dribbling + Technique",
      value: `${Math.round(rating(player, "Dribbling"))}/${Math.round(rating(player, "Technique"))}`,
      quantity: "touchErrorEnvelope",
      baseline: touchError(averagePlayer, pressure).angleDeg,
      actual: touchError(player, pressure).angleDeg,
      unit: "deg",
    },
  ];
}
