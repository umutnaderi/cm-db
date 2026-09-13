import assert from "node:assert/strict";
import {
  planRestartPreparation, planRestartSupportMovement,
  qualifiesForLongThrow, restartSupportReactionDelay, throwInRangeYards,
} from "../src/lib/restartPreparation.js";
import { executeRestart, restartPlan, selectRestartTarget } from "../src/lib/restartExecution.js";
import { passFlightProfile } from "../src/lib/matchPassFlight.js";
import { yardDistance } from "../src/lib/pitchGeometry.js";

const player = (longThrows, extra = {}) => ({
  attributes: [
    { label: "Long Throws", value: longThrows },
    { label: "Strength", value: extra.Strength ?? 12 },
    { label: "Decisions", value: extra.Decisions ?? 14 },
    { label: "Anticipation", value: extra.Anticipation ?? 14 },
    { label: "Off The Ball", value: extra.OffTheBall ?? 12 },
    { label: "Work Rate", value: extra.WorkRate ?? 12 },
    { label: "Positioning", value: extra.Positioning ?? 12 },
    { label: "Marking", value: extra.Marking ?? 12 },
  ],
});
const taker = { id: "t", x: 100, y: 0, zone: 3, player: player(16) };

console.log("=== Restart preparation choreography ===");
const corner = planRestartPreparation({
  restart: { type: "corner", variant: "inswinger", ball: { x: 100, y: 0, zone: 3 }, quick: false },
  taker,
  attackingGoalY: 0,
  random: () => 0.5,
});
assert.deepEqual(corner.phases.map((phase) => phase.code), [
  "RESTART.PLACE_BALL", "RESTART.SET_POSITION", "RESTART.SIGNAL", "RESTART.APPROACH",
]);
assert(yardDistance(corner.setPoint, { x: 100, y: 0 }) >= 2.2);
assert(yardDistance(corner.setPoint, { x: 100, y: 0 }) <= 3.46);
assert.equal(corner.phases.at(-1).target.x, 100);
assert.equal(corner.phases.at(-1).target.y, 0);
console.log("PASS -- a normal corner places, retreats 2-3 steps, scans/signals and approaches");

const throwIn = planRestartPreparation({
  restart: { type: "throw-in", variant: "short", ball: { x: 0, y: 45 }, quick: false },
  taker: { ...taker, x: 0, y: 45 },
  attackingGoalY: 0,
  random: () => 0.5,
});
assert.deepEqual(throwIn.phases.map((phase) => phase.code), [
  "RESTART.THROW_IN.COLLECT", "RESTART.THROW_IN.HOLD",
]);
assert.equal(throwIn.phases[1].ballMode, "held");
assert(throwIn.phases[1].durationMs >= 680);
console.log("PASS -- a normal throw-in has a visible held-ball scan before release");

const quick = planRestartPreparation({
  restart: { type: "free-kick", variant: "short", ball: { x: 40, y: 35 }, quick: true },
  taker,
  attackingGoalY: 0,
});
assert.equal(quick.quick, true);
assert.deepEqual(quick.phases.map((phase) => phase.code), ["RESTART.QUICK"]);
console.log("PASS -- an explicit quick restart skips the ceremonial retreat");

const highUrgency = planRestartPreparation({
  restart: { type: "throw-in", variant: "short", ball: { x: 0, y: 45 } },
  taker: { ...taker, player: player(10, { Decisions: 18, Anticipation: 18 }) },
  attackingGoalY: 0, style: "direct", tempo: "quick", random: () => 0.15,
});
const lowUrgency = planRestartPreparation({
  restart: { type: "throw-in", variant: "short", ball: { x: 0, y: 45 } },
  taker: { ...taker, player: player(10, { Decisions: 8, Anticipation: 8 }) },
  attackingGoalY: 0, style: "possession", tempo: "slow", random: () => 0.15,
});
assert.equal(highUrgency.quick, true);
assert.equal(lowUrgency.quick, false);
assert(highUrgency.evidence.quickChance > lowUrgency.evidence.quickChance);
console.log("PASS -- tempo, style and perception produce a deterministic quick-restart counterfactual");

const specialist = player(18, { Strength: 17 });
const ordinary = player(8, { Strength: 10 });
assert(qualifiesForLongThrow(specialist));
assert(!qualifiesForLongThrow(ordinary));
assert(throwInRangeYards(specialist) > throwInRangeYards(ordinary));
assert.deepEqual(restartPlan({ type: "throw-in", variant: "long" }), {
  resolver: "pass", forcedPassType: "long-throw", targetPreference: "throw-long",
});
const longTaker = { id: "long", x: 0, y: 50, role: "player", player: specialist };
const near = { id: "near", x: 10, y: 50, role: "player", player: ordinary };
const forward = { id: "forward", x: 14, y: 36, role: "player", player: ordinary };
const unreachable = { id: "unreachable", x: 45, y: 10, role: "player", player: ordinary };
assert.equal(selectRestartTarget({
  taker: longTaker,
  teammates: [near, forward, unreachable],
  preference: "throw-long",
  attackingGoalY: 0,
})?.id, "forward");
console.log("PASS -- Long Throws and Strength expand a specialist's legal target range");

let forcedType = null;
const executionTrace = [];
const executed = executeRestart({
  restart: {
    type: "throw-in", variant: "short", openingStyle: "direct",
    ball: { x: 0, y: 50 }, requiredFirstAction: "RESTART.THROW_IN.TAKE",
  },
  groups: {
    owner: longTaker,
    teammates: [near, forward, unreachable],
    opponents: [],
    keeper: null,
  },
  resolvers: {
    pass(groups, availability, _random, trace) {
      forcedType = availability.forcedPassType;
      const target = [near, forward, unreachable].find((entry) => entry.id === availability.preselectedTargetId);
      trace.push({
        code: "P.PASS", label: "throw", movement: "pass", duration: 1000,
        ballFrom: { x: groups.owner.x, y: groups.owner.y },
        ballTo: { x: target.x, y: target.y },
        contact: { point: { x: groups.owner.x, y: groups.owner.y }, actorId: groups.owner.id, type: "pass", phase: "start" },
        ownerAfterId: target.id,
      });
      return { nextOwnerId: target.id, ballEnd: { x: target.x, y: target.y }, restart: null };
    },
  },
  random: () => 0.5,
  trace: executionTrace,
  traceEvent: (code, label, opts) => ({
    code, label, ...opts,
    actorId: opts.actor?.id ?? null,
    targetId: opts.target?.id ?? null,
    ownerBeforeId: opts.ownerBefore?.id ?? opts.ownerBefore ?? null,
    ownerAfterId: opts.ownerAfter?.id ?? opts.ownerAfter ?? null,
  }),
  playerName: (entry) => entry.id ?? "player",
  attackingGoalY: 0,
});
assert.equal(forcedType, "long-throw");
assert.equal(executed.restartExecuted.variant, "long");
assert.equal(executionTrace[0].code, "RESTART.THROW_IN.TAKE");
console.log("PASS -- a direct side actually upgrades its specialist's restart to the long-throw resolver");

const hand = passFlightProfile("throw", 20);
const longHand = passFlightProfile("long-throw", 28);
const kick = passFlightProfile("ground", 20);
assert(hand.speedYardsPerSecond < kick.speedYardsPerSecond);
assert(longHand.speedYardsPerSecond < kick.speedYardsPerSecond);
assert(longHand.peakHeightYards > hand.peakHeightYards);
console.log("PASS -- hand releases remain slower than kicks and a long throw uses a higher arc");

const movementRoster = [
  { id: "t", team: "home", role: "player", restartRole: "taker", x: 100, y: 0, player: ordinary },
  { id: "near-run", team: "home", role: "player", restartRole: "near-post-runner", x: 57, y: 6, player: ordinary },
  { id: "central-run", team: "home", role: "player", restartRole: "central-runner", x: 51, y: 9, player: ordinary },
  { id: "far-run", team: "home", role: "player", restartRole: "far-post-runner", x: 43, y: 6, player: ordinary },
  { id: "short", team: "home", role: "player", restartRole: "short-option", x: 93, y: 5, player: ordinary },
  { id: "near-mark", team: "away", role: "player", restartRole: "near-post-guard", restartSubjectId: "near-run", x: 57, y: 4, player: ordinary },
  { id: "far-mark", team: "away", role: "player", restartRole: "far-post-guard", x: 43, y: 4, player: ordinary },
  { id: "wall", team: "away", role: "player", restartRole: "wall-1", x: 85, y: 0, player: ordinary },
];
const coordinatedCorner = planRestartSupportMovement({
  restart: {
    type: "corner", ball: { x: 100, y: 0 },
    corner: { delivery: { target: "near-post", x: 57, y: 4.6 } },
  },
  roster: movementRoster,
  takerId: "t",
  takingTeam: "home",
  attackingGoalY: 0,
  phase: { action: "restart-approach" },
});
const cornerAttackers = coordinatedCorner.filter((item) => item.movementKind !== "defensive-track");
const cornerMarkers = coordinatedCorner.filter((item) => item.movementKind === "defensive-track");
assert.equal(cornerAttackers.length, 4);
assert.equal(cornerMarkers.length, 2);
assert.equal(new Set(cornerMarkers.map((item) => item.subjectId)).size, 2);
assert(!coordinatedCorner.some((item) => item.playerId === "wall"));
assert(cornerMarkers.every((item) => yardDistance(item.target, { x: 100, y: 0 }) >= 9.99));
assert.equal(coordinatedCorner.find((item) => item.playerId === "near-run")?.responsibility, "primary-restart-run");
assert.equal(coordinatedCorner.find((item) => item.playerId === "far-run")?.responsibility, "decoy-restart-run");
assert.equal(coordinatedCorner.find((item) => item.playerId === "near-mark")?.subjectId, "near-run");
console.log("PASS -- the selected corner lane gets a primary run while decoys move and assigned legal markers track");

const mirroredRoster = movementRoster.map((entry) => ({ ...entry, x: 100 - entry.x }));
const mirroredCorner = planRestartSupportMovement({
  restart: {
    type: "corner", ball: { x: 0, y: 0 },
    corner: { delivery: { target: "near-post", x: 43, y: 4.6 } },
  },
  roster: mirroredRoster,
  takerId: "t",
  takingTeam: "home",
  attackingGoalY: 0,
  phase: { action: "restart-approach" },
});
for (const id of ["near-run", "central-run", "far-run", "short"]) {
  const right = coordinatedCorner.find((item) => item.playerId === id);
  const left = mirroredCorner.find((item) => item.playerId === id);
  assert(Math.abs((right.target.x + left.target.x) - 100) < 1e-9);
  assert(Math.abs(right.target.y - left.target.y) < 1e-9);
}
console.log("PASS -- the same corner routine mirrors exactly on the opposite side");

const shortCorner = planRestartSupportMovement({
  restart: {
    type: "corner", variant: "short", ball: { x: 100, y: 0 },
    corner: { delivery: { target: "short", x: 93, y: 4.2 } },
  },
  roster: movementRoster,
  takerId: "t",
  takingTeam: "home",
  attackingGoalY: 0,
  phase: { action: "restart-approach" },
});
assert.equal(shortCorner.find((item) => item.playerId === "short")?.responsibility, "show-for-restart");
assert.equal(shortCorner.find((item) => item.playerId === "near-run")?.responsibility, "decoy-restart-run");
console.log("PASS -- a short corner shows to the taker while box runners make decoy movements");

const freeKickMovement = planRestartSupportMovement({
  restart: { type: "free-kick", ball: { x: 70, y: 40 } },
  roster: movementRoster.map((entry) => ({ ...entry, x: entry.x - 30, y: entry.y + 40 })),
  takerId: "t",
  takingTeam: "home",
  attackingGoalY: 0,
  phase: { action: "restart-approach" },
});
for (const movement of freeKickMovement.filter((item) => item.movementKind !== "defensive-track")) {
  const original = movementRoster.find((entry) => entry.id === movement.playerId);
  assert.equal(movement.target.y, original.y + 40);
}
console.log("PASS -- free-kick checks remain lateral before contact and cannot create a hidden offside run");

const crossedFreeKick = planRestartSupportMovement({
  restart: { type: "free-kick", variant: "cross", ball: { x: 70, y: 40 } },
  roster: movementRoster.map((entry) => ({ ...entry, x: entry.x - 30, y: entry.y + 40 })),
  takerId: "t",
  takingTeam: "home",
  attackingGoalY: 0,
  phase: { action: "restart-approach" },
});
assert.equal(crossedFreeKick.find((item) => item.playerId === "near-run")?.responsibility, "primary-restart-run");
assert.equal(crossedFreeKick.find((item) => item.playerId === "far-run")?.responsibility, "decoy-restart-run");
console.log("PASS -- crossed free kicks distinguish the lead run from the decoy without crossing the offside line");

const roleTargets = [
  { id: "nearest", x: 92, y: 5, role: "player", restartRole: "short-option", player: ordinary },
  { id: "near-post", x: 58, y: 5, role: "player", restartRole: "near-post-runner", player: ordinary },
  { id: "far-post", x: 42, y: 6, role: "player", restartRole: "far-post-runner", player: ordinary },
];
let selectedCornerTarget = null;
executeRestart({
  restart: {
    type: "corner", variant: "inswinger", ball: { x: 100, y: 0 },
    corner: { delivery: { target: "far-post", x: 43, y: 5.4 } },
    requiredFirstAction: "RESTART.CORNER.TAKE",
  },
  groups: { owner: taker, teammates: roleTargets, opponents: [], keeper: null },
  resolvers: {
    cross(_groups, availability, _random, trace) {
      selectedCornerTarget = availability.preselectedTargetId;
      const target = roleTargets.find((entry) => entry.id === selectedCornerTarget);
      trace.push({ code: "CROSS", duration: 500, ballFrom: taker, ballTo: target, ownerAfterId: null });
      return { nextOwnerId: null, ballEnd: target, restart: null };
    },
  },
  random: () => 0.5,
  trace: [],
  traceEvent: (code, label, opts) => ({ code, label, ...opts }),
  playerName: (entry) => entry.id ?? "player",
  attackingGoalY: 0,
});
assert.equal(selectedCornerTarget, "far-post");
console.log("PASS -- the resolved delivery plan biases the real corner resolver toward its matching role");

const earlyRunner = restartSupportReactionDelay(player(8, {
  Anticipation: 19, OffTheBall: 19, WorkRate: 19,
}), { isAttacker: true, movementKind: "primary" });
const lateRunner = restartSupportReactionDelay(player(8, {
  Anticipation: 7, OffTheBall: 7, WorkRate: 7,
}), { isAttacker: true, movementKind: "primary" });
const earlyMarker = restartSupportReactionDelay(player(8, {
  Anticipation: 18, Positioning: 18, Marking: 18,
}), { isAttacker: false, movementKind: "defensive-track" });
const lateMarker = restartSupportReactionDelay(player(8, {
  Anticipation: 8, Positioning: 8, Marking: 8,
}), { isAttacker: false, movementKind: "defensive-track" });
assert(earlyRunner.delayMs < lateRunner.delayMs);
assert(earlyMarker.delayMs < lateMarker.delayMs);
assert.equal(earlyRunner.values.workRate, 19);
console.log("PASS -- Work Rate/off-ball reading and marking/positioning produce measurable reaction-time differences");

console.log("\nALL PASS");
