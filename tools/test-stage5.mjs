import assert from "node:assert/strict";
import "./match-lab-test-environment.mjs";
import {
  motionEffortCost, motionEffortLoad, motionSpeedLoad, meanSpeedYps, isRecoveryMotion,
  netBurstChange, burstRecoveryRatePerSecond,
  EFFORT_REFERENCE_YARDS, RECOVERY_LOAD_CEILING, RECOVERY_RATE_PER_SECOND,
} from "../src/lib/motionEffort.js";
import { topSpeed } from "../src/lib/playerKinetics.js";
import { advanceMotion } from "../src/lib/worldMotion.js";

const player = (pace, more = {}) => ({ current_ability: 100,
  attributes: Object.entries({ Pace: pace, Acceleration: 12, Agility: 12, ...more })
    .map(([label, value]) => ({ label, value })) });
const quick = player(18), plodder = player(4);

// ---------------------------------------------------------------------------
// 1. Effort follows the motion, not the label.
//
// The whole point of Stage 5. The old model read a job name out of a table,
// so the same distance cost the same no matter how fast it was covered.
const sprinted = { distanceYards: 8, durationMs: 1100, player: quick };
const strolled = { distanceYards: 8, durationMs: 6000, player: quick };
assert(meanSpeedYps(sprinted) > meanSpeedYps(strolled));
assert(motionEffortLoad(sprinted) > motionEffortLoad(strolled),
  "the same distance must cost more when it is covered faster");
assert(motionEffortCost({ ...sprinted, workRate: 12 }) > motionEffortCost({ ...strolled, workRate: 12 }));

// 2. The headline defect: a job that used to be on the refill list, but is
// genuinely sprinted, now costs something. `hold-width` recovered stamina for
// an eight-yard sprint purely because of its name.
assert(!isRecoveryMotion(sprinted), "a real sprint is never recovery, whatever the job is called");
assert(isRecoveryMotion(strolled), "walking it is recovery, whatever the job is called");
assert(isRecoveryMotion({ distanceYards: 0, durationMs: 800, player: quick }),
  "standing still is recovery");

// 3. Load is a fraction of THIS player's own top speed. The same motion is
// a stroll for a quick player and flat out for a slow one, and must price
// differently -- a per-player reading, not a global speed threshold.
const identicalMotion = { distanceYards: 6, durationMs: 1000 };
assert(topSpeed(quick) > topSpeed(plodder));
assert(motionSpeedLoad({ ...identicalMotion, player: plodder })
  > motionSpeedLoad({ ...identicalMotion, player: quick }),
  "the same run is harder for the slower player");
assert(motionEffortCost({ ...identicalMotion, player: plodder, workRate: 12 })
  > motionEffortCost({ ...identicalMotion, player: quick, workRate: 12 }));

// 4. Changing speed is work. Braking is eccentric loading, not rest, so the
// surcharge reads magnitude and not sign.
const cruise = { distanceYards: 8, durationMs: 1100, player: quick, entrySpeedYps: 7.5, exitSpeedYps: 7.5 };
const accelerating = { ...cruise, entrySpeedYps: 0, exitSpeedYps: 7.5 };
const braking = { ...cruise, entrySpeedYps: 7.5, exitSpeedYps: 0 };
assert(motionEffortLoad(accelerating) > motionEffortLoad(cruise),
  "accelerating costs more than holding the same speed");
assert(motionEffortLoad(braking) > motionEffortLoad(cruise),
  "braking is work, not rest");
assert.equal(motionEffortLoad(accelerating), motionEffortLoad(braking));

// 5. Bounds and degenerate inputs. A cost is never negative, never NaN, and a
// zero-distance move is free rather than infinite.
assert.equal(motionEffortCost({ distanceYards: 0, durationMs: 500, player: quick, workRate: 12 }), 0);
assert.equal(motionEffortCost({ distanceYards: 5, durationMs: 0, player: quick, workRate: 12 }) >= 0, true);
for (const bad of [undefined, null, NaN, -5]) {
  const cost = motionEffortCost({ distanceYards: bad, durationMs: bad, player: quick, workRate: bad });
  assert(Number.isFinite(cost) && cost >= 0, "malformed motion must not produce a NaN battery");
}
assert(motionEffortLoad({ distanceYards: 500, durationMs: 100, player: quick }) <= 1,
  "load is bounded even for an impossible move");
assert(motionSpeedLoad({ distanceYards: 500, durationMs: 100, player: quick }) <= 1);

// 6. The reference scale is preserved from the label-based model, so this
// stage changes where intensity comes from without silently re-pricing
// everything: a full-effort move of EFFORT_REFERENCE_YARDS still costs about
// one tank.
const fullTank = motionEffortCost({
  distanceYards: EFFORT_REFERENCE_YARDS, durationMs: EFFORT_REFERENCE_YARDS / topSpeed(quick) * 1000,
  player: quick, workRate: 12,
});
assert(fullTank > 0.6 && fullTank <= 1.0, `a full-effort reference run should cost about a tank, got ${fullTank}`);

// 7. Recovery ceiling is a real fraction of top speed, not a fixed yardage.
const ceilingSpeed = RECOVERY_LOAD_CEILING * topSpeed(quick);
assert(isRecoveryMotion({ distanceYards: ceilingSpeed * 0.9, durationMs: 1000, player: quick }));
assert(!isRecoveryMotion({ distanceYards: ceilingSpeed * 1.2, durationMs: 1000, player: quick }));

// ---------------------------------------------------------------------------
// 8. Stage 5 drains from motion; it does not yet feed condition BACK into
// locomotion. That feedback is the next step and must be opened deliberately,
// through one sanctioned path, rather than by an ad hoc field appearing on an
// entry. Until then this assertion is what keeps it honest -- it mirrors the
// one in test-stage4.mjs.
const from = { x: 30, y: 70 }, target = { x: 30, y: 20 };
const leg = (extra) => advanceMotion({ from, intentionTarget: target,
  player: { ...quick, ...extra }, elapsedMs: 900, intention: "chase" });
assert.deepEqual(leg({ burst01: 0, match01: 0 }), leg({}),
  "condition must not reach locomotion except through a sanctioned path");

// 9. Real motion out of advanceMotion() prices without any extra plumbing --
// the numbers the effort model needs are the ones the motion layer already
// returns.
const real = advanceMotion({ from, intentionTarget: target, player: quick,
  elapsedMs: 1500, intention: "chase" });
const realCost = motionEffortCost({
  distanceYards: real.distanceYards, durationMs: real.availableDurationMs,
  player: quick, entrySpeedYps: real.entrySpeedYps, exitSpeedYps: real.exitSpeedYps, workRate: 12,
});
assert(realCost > 0 && realCost < 1);
assert(real.withinPhysicalLimit);

console.log("\n=== Stage 5b: burst follows distance and time, not event count ===");
{
  const mover = player(14, { Stamina: 14 });
  const net = (distanceYards, durationMs) => netBurstChange({ distanceYards, durationMs, player: mover, workRate: 14 });

  // 1. Continuous. The first model branched on a hard threshold that an
  // ordinary jog sits almost exactly on, so the same player drained or
  // recovered depending on nothing but how their running was chopped into
  // events -- the reported "stamina drains randomly". Sweeping load across
  // the boundary must produce no jump.
  const ceilingSpeed = RECOVERY_LOAD_CEILING * topSpeed(mover);
  const below = net(ceilingSpeed * 0.98, 1000);
  const above = net(ceilingSpeed * 1.02, 1000);
  assert(Math.abs(below - above) < 0.01, "no cliff at the recovery boundary");
  let previous = Infinity;
  for (let speed = 0; speed <= topSpeed(mover); speed += topSpeed(mover) / 40) {
    const value = net(speed, 1000);
    assert(value <= previous + 1e-9, "working harder can never recover more");
    previous = value;
  }

  // 2. Partition invariant. Splitting an interval and applying it twice must
  // equal applying it once, or the answer depends on how the timeline was
  // cut, which is not a football fact.
  for (const [d, ms] of [[12, 2000], [4, 3000], [30, 4000]]) {
    assert(Math.abs(net(d, ms) - 2 * net(d / 2, ms / 2)) < 1e-12,
      `splitting ${d}yd/${ms}ms must not change the cost`);
    assert(Math.abs(net(d, ms) - 4 * net(d / 4, ms / 4)) < 1e-12, "nor quartering it");
  }

  // 3. Sign is football, not bookkeeping.
  assert(net(0, 2000) > 0, "standing still recovers");
  assert(net(2, 2000) > 0, "a walk recovers");
  assert(net(40, 4500) < 0, "a sprint costs");
  assert(net(0, 2000) > net(2, 2000), "resting recovers faster than walking");

  // 4. Re-priced against repeated-sprint capacity rather than the label
  // model's 40 yards, which measured four and a half tanks for one minute of
  // ordinary football.
  assert.equal(EFFORT_REFERENCE_YARDS, 250);
  const sprints = 1 / Math.abs(net(40, 4500));
  assert(sprints > 5 && sprints < 10, `a tank should be about seven hard sprints, got ${sprints}`);
  const restSeconds = 1 / burstRecoveryRatePerSecond(mover);
  assert(restSeconds > 25 && restSeconds < 60, `a tank should refill in well under a minute, got ${restSeconds}`);

  // 5. Stamina scales recovery, not the tank.
  const fit = player(14, { Stamina: 19 }), unfit = player(14, { Stamina: 3 });
  assert(burstRecoveryRatePerSecond(fit) > burstRecoveryRatePerSecond(unfit));
  assert(netBurstChange({ distanceYards: 0, durationMs: 1000, player: fit, workRate: 14 })
    > netBurstChange({ distanceYards: 0, durationMs: 1000, player: unfit, workRate: 14 }),
    "a fitter player gets their breath back faster");
  assert(RECOVERY_RATE_PER_SECOND > 0);
}

console.log("\n=== Stage 5b: distance covered is real, tracked match state ===");
{
  const { readFileSync } = await import("node:fs");
  const { applyScenarioToState } = await import("../src/lib/replayHarness.js");
  const { state, runConstructedPossession, freshBurst01 } = await import("../match-lab.js");
  const scenario = JSON.parse(readFileSync(
    new URL("./replay-scenarios/congested-pass-loop.json", import.meta.url), "utf8"));
  state.mode = "freeplay";
  const seed = applyScenarioToState(state, scenario);
  const run = runConstructedPossession(seed);
  const spanMs = run.trace.reduce((total, event) =>
    total + (event.overlapWithPrevious ? 0 : (Number(event.duration) || 0)), 0);
  const movers = (run.finalPositions ?? []).filter((entry) => (entry.distanceCoveredYards ?? 0) > 0);

  assert(movers.length >= 4, "players must accumulate real distance");
  for (const entry of movers) {
    assert(entry.distanceCoveredYards > 0 && Number.isFinite(entry.distanceCoveredYards));
    assert(entry.activeMs > 0, "time spent covering it is tracked alongside");
    // Nobody covers ground faster than they can run.
    const meanSpeed = entry.distanceCoveredYards / (entry.activeMs / 1000);
    assert(meanSpeed <= topSpeed(entry.player) + 1e-6,
      `${entry.id} averaged ${meanSpeed} yd/s, above their own top speed`);
  }

  // The headline symptom: a minute of ordinary football used to cost several
  // whole tanks. Outfield players really do cover 9-12 km in 90 minutes, so
  // that rate of running must be affordable.
  const outfield = movers.filter((entry) => entry.role !== "keeper");
  for (const entry of outfield) {
    const km90 = entry.distanceCoveredYards * (5400000 / spanMs) * 0.0009144;
    assert(km90 > 3 && km90 < 16, `${entry.id} extrapolates to ${km90} km per 90, which is not football`);
    const start = freshBurst01(entry.player).burst01;
    assert(Math.abs(entry.burst01 - start) < 0.35,
      `${entry.id} moved ${entry.burst01 - start} of a tank in ${Math.round(spanMs / 1000)}s of ordinary play`);
    assert(entry.burst01 > 0.3, `${entry.id} should not be exhausted by one possession`);
  }
}

console.log("Stage 5 motion-derived effort contracts passed.");
