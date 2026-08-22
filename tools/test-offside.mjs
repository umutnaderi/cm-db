import assert from "node:assert/strict";
import {
  buildOffsideSnapshot, isOffsideRestartExempt, onsideLineTargetY, secondLastOpponentLine,
} from "../src/lib/matchOffside.js";
import { generateFreePlayCandidates, planAttackerRepositioning } from "../src/lib/spatialDecision.js";

const entry = (id, x, y, player = null) => ({ id, x, y, player });
const attrs = (values) => Object.entries(values).map(([label, value]) => ({ label, value }));
const runnerPlayer = (name, quality) => ({
  canonical_player_name: name,
  current_ability: 150,
  attributes: attrs({ "Off the Ball": quality, Anticipation: quality, Decisions: quality, Acceleration: quality }),
});

const keeper = entry("keeper", 50, 4);
const lastOutfielder = entry("last-outfielder", 45, 18);
const deeperMidfielder = entry("deeper-midfielder", 55, 32);
const upLine = secondLastOpponentLine([deeperMidfielder, keeper, lastOutfielder], "up");
assert.equal(upLine.lineY, 18, "upward attack must use the second-lowest defender y");
assert.equal(upLine.secondLastDefenderId, "last-outfielder");
const downLine = secondLastOpponentLine([
  entry("down-keeper", 50, 96), entry("down-last", 45, 82), entry("down-mid", 55, 68),
], "down");
assert.equal(downLine.lineY, 82, "downward attack must use the second-highest defender y");

const defenders = [keeper, lastOutfielder];
const offside = buildOffsideSnapshot({
  attacker: entry("runner", 50, 10), ballPoint: entry("ball", 50, 40), defenders, attackingDirection: "up",
});
assert.equal(offside.isOffside, true, "attacker beyond both ball and second-last opponent must be offside");
assert.equal(offside.effectiveLineY, 18);
assert.equal(onsideLineTargetY(offside) > offside.effectiveLineY, true, "upward onside target must sit behind the line");

assert.equal(buildOffsideSnapshot({
  attacker: entry("own-half", 50, 60), ballPoint: entry("ball", 50, 70), defenders, attackingDirection: "up",
}).isOffside, false, "a player in their own half cannot be offside");
assert.equal(buildOffsideSnapshot({
  attacker: entry("behind-ball", 50, 25), ballPoint: entry("ball", 50, 20), defenders, attackingDirection: "up",
}).isOffside, false, "a player behind the ball cannot be offside");
assert.equal(buildOffsideSnapshot({
  attacker: entry("level", 50, 18), ballPoint: entry("ball", 50, 40), defenders, attackingDirection: "up",
}).isOffside, false, "level with the second-last opponent must be onside");
assert.equal(buildOffsideSnapshot({
  attacker: entry("down-runner", 50, 90), ballPoint: entry("ball", 50, 60),
  defenders: [entry("down-keeper", 50, 96), entry("down-last", 50, 82)], attackingDirection: "down",
}).isOffside, true, "downward attack must mirror upward offside geometry");

for (const restart of ["throw-in", "corner", "goal-kick"]) {
  assert.equal(isOffsideRestartExempt(restart), true);
  assert.equal(buildOffsideSnapshot({
    attacker: entry("runner", 50, 10), ballPoint: entry("ball", 50, 40), defenders,
    attackingDirection: "up", restart,
  }).isOffside, false, `${restart} must be directly exempt`);
}
assert.equal(isOffsideRestartExempt("free-kick"), false);

const owner = entry("owner", 50, 40, runnerPlayer("Owner", 14));
const offsideTarget = entry("offside-target", 35, 10, runnerPlayer("Offside", 16));
const onsideTarget = entry("onside-target", 65, 28, runnerPlayer("Onside", 12));
const candidateGroups = { owner, teammates: [offsideTarget, onsideTarget], opponents: [lastOutfielder], keeper };
const candidates = generateFreePlayCandidates(candidateGroups, "up");
assert.equal(candidates.some((candidate) => candidate.target?.id === "offside-target"), false,
  "offside teammates must not be offered as pass/cross candidates");
assert.equal(candidates.some((candidate) => candidate.type === "pass" && candidate.target?.id === "onside-target"), true,
  "onside teammate must remain a pass candidate");
assert(candidates.filter((candidate) => candidate.target).every((candidate) => candidate.offside && !candidate.offside.isOffside),
  "every offered target must retain its kick-time offside snapshot");

const attackingTeammates = [
  entry("elite-runner", 40, 30, runnerPlayer("Elite", 18)),
  entry("support-runner", 65, 34, runnerPlayer("Support", 11)),
  entry("already-offside", 50, 8, runnerPlayer("Offside", 15)),
];
const pristine = structuredClone(attackingTeammates);
const movementPlan = planAttackerRepositioning(attackingTeammates, [lastOutfielder], "up", {
  ballPoint: owner, keeper,
});
assert.equal(movementPlan.filter((move) => move.action === "run-in-behind").length, 1,
  "team planner must allocate at most one line-breaking run per reaction");
assert.equal(movementPlan.find((move) => move.id === "already-offside").action, "recover-onside",
  "an offside attacker must check back instead of continuing to the goal line");
assert(movementPlan.every((move) => move.target.y > 0), "no attacking target may use the goal line as a tactical destination");
assert.deepEqual(attackingTeammates, pristine, "offside-aware planning must not mutate reusable fixtures");
assert.deepEqual(
  movementPlan,
  planAttackerRepositioning(attackingTeammates, [lastOutfielder], "up", { ballPoint: owner, keeper }),
  "identical geometry must reproduce an identical off-ball plan",
);

console.log("Offside v1 geometry, eligibility and team-run tests passed.");
