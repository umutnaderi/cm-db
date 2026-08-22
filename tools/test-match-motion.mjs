import assert from "node:assert/strict";
import {
  buildMotionTrajectory, createMotionState, resolveMotionBatch,
} from "../src/lib/matchMotion.js";
import {
  buildMatchLabPlaybackPlan, sampleMatchLabPlaybackPlan,
} from "../src/lib/matchLabPlayback.js";

const point = (x, y, zone = 0) => ({ x, y, zone });
const attrs = (values) => Object.entries(values).map(([label, value]) => ({ label, value }));
const runner = (name, values) => ({ name, attributes: attrs(values), current_ability: 150 });
const quick = runner("Quick", { Pace: 18, Acceleration: 17, Agility: 16 });
const slow = runner("Slow", { Pace: 7, Acceleration: 6, Agility: 7 });

const proposals = [
  {
    id: "runner", from: point(20, 60), target: point(28, 50),
    action: "forward-run", role: "attacker", attackingDirection: "up", player: quick,
  },
  {
    id: "marker", from: point(65, 42), target: point(59, 47),
    action: "cover", role: "defender", player: slow,
  },
];
const pristineProposals = structuredClone(proposals);
const first = resolveMotionBatch(proposals, createMotionState(), { durationMs: 450 });
const repeated = resolveMotionBatch(structuredClone(proposals), createMotionState(), { durationMs: 450 });

assert.deepEqual(first, repeated, "identical motion inputs must produce an identical batch without RNG");
assert.deepEqual(proposals, pristineProposals, "motion planning must not mutate its world-snapshot proposals");
assert.equal(first.moves.length, 2, "all players in the snapshot receive their movement together");
for (const move of first.moves) {
  assert.deepEqual(move.trajectory[0].position, move.from, "a trajectory begins at its authoritative origin");
  assert.deepEqual(move.trajectory.at(-1).position, move.to, "a trajectory ends at its authoritative destination");
  assert(move.trajectory.length > 2, "a movement is represented by several motion samples, not one line segment");
  assert(move.trajectory.every((sample) => sample.position.x >= 0 && sample.position.x <= 100
    && sample.position.y >= 0 && sample.position.y <= 100), "every motion sample remains on the pitch");
}

const secondProposal = [{
  id: "runner", from: point(23, 56), target: point(36, 44),
  action: "forward-run", role: "attacker", attackingDirection: "up", player: quick,
}];
const second = resolveMotionBatch(secondProposal, first.state, { durationMs: 450 });
assert.equal(second.moves[0].intention.retained, true,
  "the same unreached intention remains committed across consecutive reactions");
assert.notDeepEqual(second.moves[0].intention.target, secondProposal[0].target,
  "a committed intention absorbs a changing target gradually instead of snapping to it");
assert(Math.hypot(second.moves[0].trajectory[0].velocity.x, second.moves[0].trajectory[0].velocity.y) > 0,
  "the next trajectory carries velocity instead of restarting from a dead stop");

const recovery = resolveMotionBatch([{
  ...secondProposal[0], action: "recover-onside", target: point(23, 62),
}], second.state, { durationMs: 450 });
assert.equal(recovery.moves[0].intention.retained, false,
  "an offside recovery overrides the previous attacking commitment immediately");
assert.deepEqual(recovery.moves[0].to, point(23, 62),
  "a forced recovery uses the fresh legal target rather than stale intent");

const quickPath = buildMotionTrajectory({ from: point(10, 70), to: point(20, 55), player: quick, durationMs: 450 });
const slowPath = buildMotionTrajectory({ from: point(10, 70), to: point(20, 55), player: slow, durationMs: 450 });
const speed = (velocity) => Math.hypot(velocity.x, velocity.y);
assert(speed(quickPath.endVelocity) > speed(slowPath.endVelocity),
  "Pace affects locomotion texture while leaving the tactical endpoint unchanged");
assert.deepEqual(quickPath.samples.at(-1).position, slowPath.samples.at(-1).position,
  "movement attributes never rewrite the tactical destination");

const curved = buildMotionTrajectory({
  from: point(20, 60), to: point(40, 40), player: quick, durationMs: 500,
  previousVelocity: { x: -0.03, y: -0.01 }, continuing: true,
});
const plan = buildMatchLabPlaybackPlan({
  initialPositions: { runner: point(20, 60) }, initialBall: point(50, 50), finalOwnerId: null,
  trace: [{
    code: "ATT.ADJUST", label: "Runner continues", movement: "reposition", duration: 500,
    overlapWithPrevious: false,
    playerMoves: [{
      playerId: "runner", from: point(20, 60), to: point(40, 40), action: "forward-run",
      trajectory: curved.samples,
      intention: { action: "forward-run", target: point(40, 40), retained: true },
    }],
  }],
});
const midway = sampleMatchLabPlaybackPlan(plan, 250).players.runner;
assert(Math.abs(midway.x - 30) > 0.05 || Math.abs(midway.y - 50) > 0.05,
  "playback consumes the authored curved trajectory instead of replacing it with a rigid straight midpoint");
assert.deepEqual(sampleMatchLabPlaybackPlan(plan, 500).players.runner, point(40, 40),
  "velocity-aware interpolation still lands on the exact authoritative endpoint");
assert(Object.isFrozen(plan), "the compiled motion playback plan remains immutable");

console.log("Motion v1 intention/trajectory/playback tests passed.");
