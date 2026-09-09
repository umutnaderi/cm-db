import assert from "node:assert/strict";
import {
  kineticsAttribution, reachIn, reigniteFactor, timeToReach, timeToTopSpeed,
  topSpeed, touchError, touchThreshold, turnRetention, speedAtElapsed,
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

// Momentum Continuity v1 (2026-08-31) -- user: "a player who is already
// running will be faster than a player who just started... acceleration
// takes time." reachIn()'s own new initialSpeedYps term (defaults to 0)
// must reduce to the EXACT original formula when omitted, and must let an
// already-moving player cover strictly more ground than a cold start over
// the identical elapsed time.
assert.equal(reachIn(average, 0.8), reachIn(average, 0.8, 0),
  "omitting initialSpeedYps must be byte-identical to the original 2-arg call");
assert(reachIn(average, 0.8, 3) > reachIn(average, 0.8, 0),
  "a real starting speed must cover strictly more ground than a cold start over the same elapsed time");
assert(reachIn(average, 0.05, topSpeed(average)) > reachIn(average, 0.05, 0),
  "already AT top speed must gain real ground immediately, not spend time re-accelerating from rest");
assert(reachIn(average, 3, 1000) <= topSpeed(average) * 3 + 1e-9,
  "an absurd starting speed is clamped at the player's own real topSpeed, never exceeding it");

// speedAtElapsed() -- the companion query reachIn() itself never needed:
// carrying the REAL reached speed from one leg into the next leg's own
// initialSpeedYps, instead of silently resetting to rest.
assert.equal(speedAtElapsed(average, 0, 4), 4,
  "at zero elapsed time, speed is exactly whatever it started at");
assert(speedAtElapsed(average, 0.05, 0) > 0,
  "a cold start still accelerates -- speed genuinely rises from rest");
assert.equal(speedAtElapsed(average, 100, 0), topSpeed(average),
  "speed never exceeds the player's own real topSpeed, however long they run");
assert(speedAtElapsed(high, 0.3, 0) > speedAtElapsed(low, 0.3, 0),
  "higher Acceleration reaches a higher speed over the identical short window");

console.log("Player kinetics unit and attribution tests passed.");
