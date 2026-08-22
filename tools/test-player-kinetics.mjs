import assert from "node:assert/strict";
import {
  kineticsAttribution, reachIn, reigniteFactor, timeToReach, timeToTopSpeed,
  topSpeed, touchError, touchThreshold, turnRetention,
} from "../src/lib/playerKinetics.js";

const player = (values) => ({
  current_ability: 100,
  attributes: Object.entries(values).map(([label, value]) => ({ label, value })),
});
const low = player({ Pace: 1, Acceleration: 1, Agility: 1, Dribbling: 1, Technique: 1 });
const average = player({ Pace: 10, Acceleration: 10, Agility: 10, Dribbling: 10, Technique: 10 });
const high = player({ Pace: 20, Acceleration: 20, Agility: 20, Dribbling: 20, Technique: 20 });

assert(topSpeed(high) > topSpeed(low), "Pace must raise top speed");
assert(timeToTopSpeed(high) < timeToTopSpeed(low), "Acceleration must shorten time to top speed");
assert(reachIn(high, 0.8) > reachIn(low, 0.8), "Acceleration/Pace must change short-range reach");
assert(reachIn(high, 4) > reachIn(low, 4), "Pace must change long-range reach");
assert(timeToReach(high, 5) < timeToReach(low, 5), "Acceleration/Pace must reduce arrival time");
assert(turnRetention(high, 90) > turnRetention(low, 90), "Agility must retain more speed through a turn");
assert(reigniteFactor(high) > reigniteFactor(low), "Agility must improve re-acceleration");
assert(touchThreshold(high, "jog") < touchThreshold(low, "jog"), "Dribbling must tighten touch distance");
assert(touchError(high, 0.8).angleDeg < touchError(low, 0.8).angleDeg,
  "Dribbling/Technique must reduce the touch-error envelope");
assert(touchError(average, 0.8).angleDeg > touchError(average, 0.1).angleDeg,
  "pressure must widen the same player's touch-error envelope");

const attribution = kineticsAttribution(high, { gait: "sprint", pressure: 0.5 });
assert(attribution.every((entry) => Number.isFinite(entry.baseline) && Number.isFinite(entry.actual)),
  "kinetic attribution must carry measurable average and actual values");
assert(attribution.some((entry) => entry.quantity === "touchThreshold(sprint)" && entry.actual < entry.baseline),
  "attribution must expose a high dribbler's tighter-than-average touch threshold");

console.log("Player kinetics unit and attribution tests passed.");
