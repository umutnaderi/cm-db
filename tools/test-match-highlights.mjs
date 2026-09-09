import assert from "node:assert/strict";
import { buildHighlightWindows, advanceHighlightTime, highlightImportance } from "../src/lib/matchHighlights.js";
import { createMatchSession } from "../src/lib/matchSession.js";
import { applyKickoffInstructions, KICKOFF_OPTIONS } from "../src/lib/kickoffInstructions.js";
import { normalizeTeamAttacking } from "../src/lib/teamInstructions.js";
import { restartPlan, selectRestartTarget } from "../src/lib/restartExecution.js";

const trace = [
  { code: "P.PASS" }, { code: "P.SHOT", movement: "shot", metrics: { distanceToGoalMetres: 35 } },
  { code: "P.SHOT", movement: "shot", metrics: { distanceToGoalMetres: 12 } },
  { code: "EMPTY_NET", outcome: "goal" },
];
const plan = { durationMs: 100000, intervals: trace.map((event, eventIndex) => ({ eventIndex, startMs: eventIndex * 25000, endMs: eventIndex * 25000 + 2000 })) };
assert.deepEqual(buildHighlightWindows(trace, plan, "full"), [{ startMs: 0, endMs: 100000 }]);
assert.deepEqual(buildHighlightWindows(trace, plan, "commentary"), []);
const key = buildHighlightWindows(trace, plan, "key");
assert.equal(key.length, 2);
assert.equal(key[0].startMs, 43000);
assert.equal(buildHighlightWindows(trace, plan, "extended").length, 3);
assert.equal(highlightImportance({ code: "RESTART.GOAL_KICK.TAKE" }), 1);
assert.equal(highlightImportance({ code: "CARD.RED" }), 3);
assert.equal(advanceHighlightTime(0, 3000, 100000, [{ startMs: 40000, endMs: 50000 }], 1, 20), 41000);
assert.equal(advanceHighlightTime(49000, 2000, 100000, [{ startMs: 40000, endMs: 50000 }], 1, 20), 70000);

const owner = { id: "a", team: "home", x: 50, y: 50, player: {} };
const back = { id: "b", team: "home", x: 50, y: 65, positionalSlot: "DC", player: {} };
const mid = { id: "c", team: "home", x: 52, y: 45, positionalSlot: "MC", player: {} };
const wing = { id: "d", team: "home", x: 10, y: 40, positionalSlot: "ML", player: {} };
const forward = { id: "e", team: "home", x: 50, y: 20, positionalSlot: "FC", player: {} };
const groups = { owner, teammates: [back, mid, wing, forward], opponents: [{ x: 52, y: 28 }] };
const candidates = () => [back, mid, wing, forward].map((target) => ({ type: "pass", target, utility: 0.5 }));
for (const [instruction] of KICKOFF_OPTIONS) assert.equal(normalizeTeamAttacking({ kickoff: instruction }).kickoff, instruction);
assert.equal(normalizeTeamAttacking({ kickoff: "bad" }).kickoff, "mixed");
function pick(instruction) {
  return applyKickoffInstructions(candidates(), groups, "up", { team: "home", instruction, remaining: 3 }).sort((a, b) => b.utility - a.utility)[0];
}
assert.equal(pick("play-backwards").target.id, back.id);
assert.equal(pick("build-midfield").target.id, mid.id);
assert.equal(pick("go-wide").target.id, wing.id);
assert.equal(pick("target-forward").target.id, forward.id);
assert.equal(pick("go-long").forcedPassType, "lofted");
assert.ok(pick("territory").moveTo.x < 0);
const untouched = candidates();
applyKickoffInstructions(untouched, groups, "up", { team: "away", instruction: "play-backwards", remaining: 3 });
assert.ok(untouched.every((candidate) => candidate.utility === 0.5));
assert.equal(restartPlan({ type: "kickoff", kickoffInstruction: "keep-possession", openingStyle: "long-ball" }).targetPreference, "short");
assert.equal(selectRestartTarget({ taker: owner, teammates: groups.teammates, preference: "backwards", attackingGoalY: 0 }).id, back.id);
const unsafeCarry = { type: "carry", moveTo: { x: 100, y: 0 }, utility: 1 };
applyKickoffInstructions([unsafeCarry, ...candidates()], groups, "up", { team: "home", instruction: "mixed", remaining: 3 });
assert.ok(unsafeCarry.utility < 0.5);

// A scheduled producer advances without any frame callback or animation.
const jobs = new Map(); let nextId = 0;
const schedule = (fn) => { jobs.set(++nextId, fn); return nextId; };
const cancel = (id) => jobs.delete(id);
const flush = () => { const [id, fn] = jobs.entries().next().value; jobs.delete(id); fn(); };
const received = [];
const session = createMatchSession({ durationMs: 90000, maxBuffered: 3, schedule, cancel,
  simulate: ({ index, continuation }) => { assert.equal(continuation?.step ?? 0, index); return { durationMs: 30000, continuation: { step: index + 1 }, result: index }; },
});
session.start(); flush(); flush(); flush();
assert.equal(session.getState().elapsedMs, 90000);
assert.equal(session.getState().complete, true);
while (session.getState().buffered) received.push(session.take().result);
assert.deepEqual(received, [0, 1, 2]);
const cancelled = createMatchSession({ schedule, cancel, simulate: () => { throw new Error("must not run"); } });
cancelled.start(); cancelled.stop(); assert.equal(jobs.size, 0);
console.log("PASS: kickoff choices, highlight windows, speed boundaries, independent match producer and cancellation");
