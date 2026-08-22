import { clamp, playerAttribute } from "./matchEngineCore.js";

// One physical vocabulary for both simulation and authored playback.
// Values are expressed in real pitch yards / seconds; callers convert to
// the rendered 0-100 grid only at their boundary.
export const MAX_SPEED_MIN = 6.4;
export const MAX_SPEED_MAX = 10.2;
export const TIME_TO_TOP_MAX = 2.6;
export const TIME_TO_TOP_MIN = 1.4;
export const TURN_PENALTY = 0.75;

const TOUCH_BASE_YARDS = Object.freeze({ nimble: 1.4, jog: 2.6, sprint: 4.2 });

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

export function reachIn(player, seconds) {
  const elapsed = Math.max(0, Number(seconds) || 0);
  const maximum = topSpeed(player);
  const accelerationTime = timeToTopSpeed(player);
  return elapsed <= accelerationTime
    ? 0.5 * (maximum / accelerationTime) * elapsed * elapsed
    : 0.5 * maximum * accelerationTime + maximum * (elapsed - accelerationTime);
}

export function timeToReach(player, yards) {
  const distance = Math.max(0, Number(yards) || 0);
  const maximum = topSpeed(player);
  const accelerationTime = timeToTopSpeed(player);
  const accelerationDistance = 0.5 * maximum * accelerationTime;
  return distance <= accelerationDistance
    ? Math.sqrt((2 * distance * accelerationTime) / maximum)
    : accelerationTime + (distance - accelerationDistance) / maximum;
}

export function turnRetention(player, angleDegrees) {
  const agility = rating(player, "Agility") / 20;
  const severity = Math.min(1, Math.abs(Number(angleDegrees) || 0) / 180);
  return clamp(0, 1, 1 - severity * (1 - agility) * TURN_PENALTY);
}

export function reigniteFactor(player) {
  return 0.6 + 0.4 * (rating(player, "Agility") / 20);
}

export function touchThreshold(player, gait = "jog") {
  const dribbling = rating(player, "Dribbling") / 20;
  const base = TOUCH_BASE_YARDS[gait] ?? TOUCH_BASE_YARDS.jog;
  return base * (1.35 - 0.5 * dribbling);
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
