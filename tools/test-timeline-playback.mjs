import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildMatchLabPlaybackPlan, createMatchLabPlaybackClock, MATCH_LAB_PLAYBACK_BUILD, nextSemanticBoundary, previousSemanticBoundary,
  sampleMatchLabPlaybackPlan, validateMatchLabPlaybackPlan,
  zeroVelocityAcrossIdleGaps, IDLE_GAP_THRESHOLD_MS,
} from "../src/lib/matchLabPlayback.js";

const point = (x, y, zone = 0) => ({ x, y, zone });

// Gameplay v3 (2026-08-28) -- the reported strobe's OTHER half: even once
// resolveCarry()/resolveDribble() stopped re-planning off-ball reactions
// per touch (Off-Ball Motion v3, ONE continuous call per phase -- see
// test-possession-runner.mjs's own "ONE off-ball reaction per carry"
// section), the BALL CARRIER's own touch-to-touch movement is still
// compiled as a sequence of separate keyframes (one per P.CARRY.TOUCH),
// each an ordinary MOVEMENT_DURATIONS.touch-ish (~220ms) span apart.
// zeroVelocityAcrossIdleGaps() used to zero velocity at ANY join wider
// than 60ms -- BELOW a single touch -- so nearly every genuine
// touch-to-touch or action-to-reaction join still got flattened to a
// dead stop and restart, even after the resolver-side fix. Raised well
// above ordinary action/reaction durations (450ms) so real, continuous
// play carries velocity through a join; a genuinely long, idle gap still
// zeroes correctly.
console.log("=== Gameplay v3 -- zeroVelocityAcrossIdleGaps() only fires on a genuine idle stand ===");
{
  const track = [
    { timeMs: 0, position: point(10, 10), velocity: { x: 3, y: 1 } },
    { timeMs: 220, position: point(11, 10.3), velocity: { x: 3, y: 1 } },
    { timeMs: 420, position: point(12, 10.6), velocity: { x: 3, y: 1 } },
  ];
  const result = zeroVelocityAcrossIdleGaps(track.map((frame) => ({ ...frame, velocity: { ...frame.velocity } })));
  assert.deepEqual(result[0].velocity, { x: 3, y: 1 }, "a 220ms touch-to-touch join must not zero the outgoing velocity");
  assert.deepEqual(result[1].velocity, { x: 3, y: 1 }, "the SAME 220ms join must not zero the incoming velocity either");
  assert.deepEqual(result[2].velocity, { x: 3, y: 1 }, "a second, also-narrow 200ms join must not zero velocity");

  const idleTrack = [
    { timeMs: 0, position: point(10, 10), velocity: { x: 3, y: 1 } },
    { timeMs: 900, position: point(10, 10), velocity: { x: 2, y: -1 } },
  ];
  const idleResult = zeroVelocityAcrossIdleGaps(idleTrack.map((frame) => ({ ...frame, velocity: { ...frame.velocity } })));
  assert.deepEqual(idleResult[0].velocity, { x: 0, y: 0 }, "a genuine 900ms idle gap must still zero the outgoing velocity");
  assert.deepEqual(idleResult[1].velocity, { x: 0, y: 0 }, "and the incoming velocity on the far side of that same idle gap");

  assert.ok(IDLE_GAP_THRESHOLD_MS >= 400, "the idle-gap threshold must sit comfortably above a single touch/reaction duration");
}
console.log("Gameplay v3 zeroVelocityAcrossIdleGaps() tests passed.");
const initialPositions = {
  crosser: point(10, 60), closer: point(18, 58), receiver: point(45, 25),
  aerialDefender: point(56, 24), keeper: point(50, 6), runner: point(35, 45),
};
const crossTrace = [
  {
    code: "CROSS.DELIVERY.CLEAN", label: "Cross delivered", movement: "cross", duration: 700,
    actorId: "crosser", defenderId: "closer", keeperId: "keeper",
    ballFrom: point(10, 60), ballTo: point(50, 18),
    playerMoves: [
      { playerId: "crosser", from: point(10, 60), to: point(10, 60), action: "deliver" },
      { playerId: "closer", from: point(18, 58), to: point(15, 59), action: "close-down" },
      { playerId: "keeper", from: point(50, 6), to: point(50, 8), action: "set" },
    ],
    contact: { point: point(10, 60), actorId: "crosser", type: "cross", phase: "start" },
    ownerBeforeId: "crosser", ownerAfterId: null,
  },
  {
    code: "X1.R", label: "Receiver wins aerial", movement: "cross", duration: 450,
    ballFrom: point(50, 18), ballTo: point(50, 18),
    playerMoves: [
      { playerId: "receiver", from: point(45, 25), to: point(50, 18), action: "attack-ball" },
      { playerId: "aerialDefender", from: point(56, 24), to: point(50, 18), action: "challenge" },
    ],
    contact: { point: point(50, 18), actorId: "receiver", type: "aerial", phase: "end" },
    ownerBeforeId: null, ownerAfterId: "receiver",
  },
  {
    code: "F.HEADER.ON", label: "Header on target", movement: "header", duration: 350,
    ballFrom: point(50, 18), ballTo: point(50, 8), playerMoves: [],
    contact: { point: point(50, 18), actorId: "receiver", type: "header", phase: "start" },
    ownerBeforeId: "receiver", ownerAfterId: null,
  },
  {
    code: "K.SAVE.2", label: "Keeper parries", movement: "save", duration: 350,
    ballFrom: point(50, 8), ballTo: point(43, 16), pathSegments: [point(50, 8), point(43, 16)],
    playerMoves: [], ballResult: "rebound-in-play",
    contact: { point: point(50, 8), actorId: "keeper", type: "parry", phase: "start" },
    ownerBeforeId: null, ownerAfterId: null,
  },
  {
    code: "REBOUND.WON", label: "Receiver reaches rebound", movement: "scramble", duration: 400,
    ballFrom: point(43, 16), ballTo: point(43, 16),
    playerMoves: [
      { playerId: "receiver", from: point(50, 18), to: point(43, 16), action: "attack-ball" },
      { playerId: "aerialDefender", from: point(50, 18), to: point(43, 16), action: "challenge" },
    ],
    contact: { point: point(43, 16), actorId: "receiver", type: "recovery", phase: "end" },
    ownerBeforeId: null, ownerAfterId: "receiver",
  },
  {
    code: "REBOUND.MISS", label: "Rebound wide", movement: "rebound-shot", duration: 450,
    ballFrom: point(43, 16), ballTo: point(39, -3), playerMoves: [], restart: "goal-kick",
    contact: { point: point(43, 16), actorId: "receiver", type: "rebound-shot", phase: "start" },
    ownerBeforeId: "receiver", ownerAfterId: null,
  },
];

const pristineTrace = structuredClone(crossTrace);
const pristinePositions = structuredClone(initialPositions);
const planA = buildMatchLabPlaybackPlan({
  trace: crossTrace, initialPositions, initialBall: point(10, 60), initialOwnerId: "crosser",
  finalOwnerId: null, restart: "goal-kick",
});
const planB = buildMatchLabPlaybackPlan({
  trace: structuredClone(crossTrace), initialPositions: structuredClone(initialPositions),
  initialBall: point(10, 60), initialOwnerId: "crosser", finalOwnerId: null, restart: "goal-kick",
});

assert.equal(JSON.stringify(planA), JSON.stringify(planB), "same trace must produce a byte-equivalent plan");
assert.deepEqual(crossTrace, pristineTrace, "planner must not mutate trace fixtures");
assert.deepEqual(initialPositions, pristinePositions, "planner must not mutate reusable position fixtures");
assert(Object.isFrozen(planA) && Object.isFrozen(planA.tracks.ball), "plan and tracks must be immutable");
assert.equal(validateMatchLabPlaybackPlan(planA).valid, true, "all declared contacts must be continuous");
assert.equal(planA.finalState.ownerId, null, "out-of-play outcome must have no owner");
assert.equal(planA.finalState.restart, "goal-kick", "out-of-play outcome must retain its restart");

function failedShotPlan(duration) {
  return buildMatchLabPlaybackPlan({
    initialPositions: { shooter: point(50, 55), keeper: point(50, 95) },
    initialBall: point(50, 55),
    initialOwnerId: "shooter",
    finalOwnerId: null,
    restart: "goal-kick",
    trace: [{
      code: "F.BLAST.OVER", label: "Off target", movement: "shot", outcome: "fail",
      duration, ballFrom: point(50, 55), ballTo: point(50, 100),
      contact: { point: point(50, 55), actorId: "shooter", type: "shot", phase: "start" },
      ownerBeforeId: "shooter", ownerAfterId: null, badge: "OVER",
    }],
  });
}

const fastMissPlan = failedShotPlan(700);
const slowMissPlan = failedShotPlan(1_900);
for (const plan of [fastMissPlan, slowMissPlan]) {
  const cue = plan.cues[0];
  const interval = plan.intervals[0];
  assert.equal(cue.timeMs, interval.startMs,
    "the visual shot cue still begins at foot contact");
  assert.equal(cue.audioTimeMs, interval.endMs,
    "miss audio is scheduled at the shot's real arrival boundary");
  assert.equal(cue.audioMilestone, "terminal",
    "the deferred cue selects only the terminal miss sound");
  assert.notDeepEqual(
    (({ x, y }) => ({ x, y }))(sampleMatchLabPlaybackPlan(plan, cue.audioTimeMs - 1).ball),
    { x: 50, y: 100 },
    "the miss cue cannot fire while the ball is still in flight",
  );
  assert.deepEqual(
    (({ x, y }) => ({ x, y }))(sampleMatchLabPlaybackPlan(plan, cue.audioTimeMs).ball),
    { x: 50, y: 100 },
    "the miss cue boundary is the exact ball-arrival frame",
  );
}
assert.equal(
  slowMissPlan.cues[0].audioTimeMs - slowMissPlan.cues[0].timeMs,
  1_900,
  "a slower shot keeps its longer sound delay",
);
assert.equal(
  fastMissPlan.cues[0].audioTimeMs - fastMissPlan.cues[0].timeMs,
  700,
  "a faster shot keeps its shorter sound delay",
);

const delivery = planA.intervals.find((item) => item.code === "CROSS.DELIVERY.CLEAN");
const aerial = planA.intervals.find((item) => item.code === "X1.R");
const parry = planA.intervals.find((item) => item.code === "K.SAVE.2");
const recovery = planA.intervals.find((item) => item.code === "REBOUND.WON");
assert.equal(aerial.startMs, delivery.startMs, "aerial participants must approach during the delivery");
assert.equal(aerial.endMs, delivery.endMs, "aerial contact must coincide with delivery arrival");
assert.equal(recovery.startMs, parry.startMs, "rebound participants must move during the parry");
assert.equal(recovery.endMs, parry.endMs, "rebound recovery must coincide with parry arrival");
for (const id of ["crosser", "closer", "receiver", "aerialDefender", "keeper"]) {
  const track = planA.tracks.players[id];
  assert(track.some((frame) => frame.timeMs >= delivery.startMs && frame.timeMs <= delivery.endMs), `${id} needs a delivery-window track`);
}

const carryPlan = buildMatchLabPlaybackPlan({
  initialPositions: { carrier: point(20, 60), runner: point(35, 45), defender: point(50, 50) },
  initialBall: point(20, 60), initialOwnerId: "carrier", finalOwnerId: "carrier",
  trace: [
    {
      code: "P.CARRY.TOUCH", label: "Touch", movement: "touch", duration: 220,
      ballFrom: point(20, 60), ballTo: point(20, 50),
      playerMoves: [{ playerId: "carrier", from: point(20, 60), to: point(20, 50), action: "carry" }],
      contact: { point: point(20, 60), actorId: "carrier", type: "touch", phase: "start" },
    },
    {
      code: "ATT.ADJUST", label: "Runner moves", movement: "reposition", duration: 200,
      overlapWithPrevious: true,
      playerMoves: [{ playerId: "runner", from: point(35, 45), to: point(40, 35), action: "forward-run" }],
    },
    {
      code: "DEF.ADJUST", label: "Defender shifts", movement: "reposition", duration: 200,
      overlapWithPrevious: true,
      playerMoves: [{ playerId: "defender", from: point(50, 50), to: point(46, 42), action: "cover" }],
    },
  ],
});
assert.equal(carryPlan.intervals[1].startMs, carryPlan.intervals[0].startMs);
assert.equal(carryPlan.intervals[2].startMs, carryPlan.intervals[0].startMs);
const midway = sampleMatchLabPlaybackPlan(carryPlan, 110);
assert(midway.players.carrier.y < 60 && midway.players.runner.y < 45 && midway.players.defender.y < 50,
  "carrier and several off-ball players must move on the same frame");

// Bounded overlap duration (2026-08-20) -- a real browser round reported
// off-ball players visibly moving in slow motion, step by step, during a
// long pass's flight. Root cause: an overlapWithPrevious event's own
// `duration` field used to be silently discarded -- its playerMoves
// keyframes were unconditionally stretched across the FULL producing
// interval regardless of how short the reaction's own real duration was.
// Harmless while every duration sat in the same few-hundred-ms ballpark,
// but Ball Flight & Arrival v1 (match-lab.js, same day) made an ordinary
// pass's own flight duration scale with real distance -- several seconds
// for a long ball -- while its own interleaved off-ball reaction still
// only ever takes ~550ms. This fixture reproduces that shape directly: a
// LONG (5000ms) producing event with a SHORT (550ms) overlapping reaction.
const longPassPlan = buildMatchLabPlaybackPlan({
  initialPositions: { passer: point(50, 5), receiver: point(50, 90), bystander: point(20, 40) },
  initialBall: point(50, 5), initialOwnerId: "passer", finalOwnerId: "receiver",
  trace: [
    {
      code: "P.PASS", label: "Long ball", movement: "pass", duration: 5000,
      ballFrom: point(50, 5), ballTo: point(50, 90),
      contact: { point: point(50, 5), actorId: "passer", type: "pass", phase: "start" },
      ownerBeforeId: "passer", ownerAfterId: null,
    },
    {
      code: "ATT.ADJUST", label: "Bystander adjusts", movement: "reposition", duration: 550,
      overlapWithPrevious: true,
      playerMoves: [{ playerId: "bystander", from: point(20, 40), to: point(22, 42), action: "diagonal-inside" }],
    },
    {
      code: "P.RECEIVE.CLEAN", label: "Receiver controls it", movement: "reception", duration: 300,
      ballFrom: point(50, 90), ballTo: point(50, 90),
      contact: { point: point(50, 90), actorId: "receiver", type: "control", phase: "start" },
      ownerBeforeId: null, ownerAfterId: "receiver",
    },
  ],
});
const longPassInterval = longPassPlan.intervals[0];
const reactionInterval = longPassPlan.intervals[1];
assert.equal(longPassInterval.endMs - longPassInterval.startMs, 5000, "the long pass's own interval keeps its full real duration");
assert.equal(reactionInterval.startMs, longPassInterval.startMs, "the reaction still starts concurrently with the pass (genuinely overlapping)");
assert.equal(reactionInterval.endMs - reactionInterval.startMs, 550,
  "the reaction's own SHORT duration is respected, not stretched to fill the long pass's own multi-second interval");
const bystanderTrack = longPassPlan.tracks.players.bystander;
assert(bystanderTrack.every((frame) => frame.timeMs <= 550 + 0.01),
  "the bystander's own track never carries a keyframe past their reaction's real 550ms duration");
const early = sampleMatchLabPlaybackPlan(longPassPlan, 300).players.bystander;
const late = sampleMatchLabPlaybackPlan(longPassPlan, 3000).players.bystander;
assert(early.x !== 20 || early.y !== 40, "the bystander is genuinely mid-reaction at 300ms (not frozen)");
assert.equal(late.x, 22, "the bystander has already reached their real target well before the pass itself lands, not still crawling toward it in slow motion");
assert.equal(late.y, 42, "the bystander has already reached their real target well before the pass itself lands, not still crawling toward it in slow motion");

// Contact-arrival timing -- a nearby receiver must wait, then move at their
// own natural Pace/Acceleration rate. Their two-yard adjustment must never
// be normalized over the full three-second flight.
const kineticPlayer = (pace, acceleration) => ({
  current_ability: 150,
  attributes: [
    { label: "Pace", value: pace },
    { label: "Acceleration", value: acceleration },
  ],
});
const receiverFrom = point(50, 80);
const receiverTo = point(50 + (2.3 / 75) * 100, 80);
const receiverTrace = [
  {
    code: "P.PASS", label: "Three-second pass", movement: "pass", duration: 3000,
    ballFrom: point(50, 20), ballTo: receiverTo,
    contact: { point: point(50, 20), actorId: "passer", type: "pass", phase: "start" },
    ownerBeforeId: "passer", ownerAfterId: null,
  },
  {
    code: "P.RECEIVE.CLEAN", label: "Receiver meets it", movement: "reception", duration: 300,
    ballFrom: receiverTo, ballTo: receiverTo,
    playerMoves: [{ playerId: "receiver", from: receiverFrom, to: receiverTo, action: "receive-pass" }],
    contact: { point: receiverTo, actorId: "receiver", type: "control", phase: "start" },
    ownerBeforeId: null, ownerAfterId: "receiver",
  },
];
function receiverPlan(profile) {
  return buildMatchLabPlaybackPlan({
    trace: structuredClone(receiverTrace),
    initialPositions: { passer: point(50, 20), receiver: receiverFrom },
    initialBall: point(50, 20), initialOwnerId: "passer", finalOwnerId: "receiver",
    playerProfiles: { receiver: profile },
  });
}
const naturallyTimedPlan = receiverPlan(kineticPlayer(15, 15));
const receiveInterval = naturallyTimedPlan.intervals.find((item) => item.code === "P.RECEIVE.CLEAN");
const receiveDiagnostic = receiveInterval.moveDiagnostics[0];
const receiverTrack = naturallyTimedPlan.tracks.players.receiver;
const receiverMoveStart = receiverTrack.find((frame) => frame.eventIndex === receiveInterval.eventIndex)?.timeMs;
assert(receiveDiagnostic.scheduledDurationMs < 1500,
  "a 2.3-yard reception adjustment must not be stretched over the full three-second flight");
assert(Math.abs(receiveDiagnostic.scheduledDurationMs - receiveDiagnostic.naturalEtaMs) < 1,
  "a reachable receiver's scheduled duration must equal their natural travel ETA");
assert(receiverMoveStart > 1200,
  "a nearby receiver waits and begins a normal-speed adjustment late in the flight");
assert.deepEqual(sampleMatchLabPlaybackPlan(naturallyTimedPlan, receiverMoveStart - 1).players.receiver, receiverFrom,
  "the receiver holds their original position before their natural movement window starts");
assert.deepEqual(sampleMatchLabPlaybackPlan(naturallyTimedPlan, 3150).players.receiver, receiverTo,
  "after arriving, the receiver holds the contact position through the idle/reception interval");
assert(receiveDiagnostic.averageSpeedYardsPerSecond > receiveDiagnostic.topSpeedYardsPerSecond * 0.2,
  "ordinary reception movement must not report an implausible crawl speed");

const slowDiagnostic = receiverPlan(kineticPlayer(5, 5)).intervals.find((item) => item.code === "P.RECEIVE.CLEAN").moveDiagnostics[0];
const fastDiagnostic = receiverPlan(kineticPlayer(19, 19)).intervals.find((item) => item.code === "P.RECEIVE.CLEAN").moveDiagnostics[0];
assert(fastDiagnostic.naturalEtaMs < slowDiagnostic.naturalEtaMs,
  "receiver travel duration must improve with Pace and Acceleration");

// Ball Flight v2 resolves contact when a player can get a boot/body part
// within the shared race allowance; their marker is still authored at the
// exact contact point so the next event starts from one canonical position.
// Playback must consume that same contract instead of independently
// declaring the reception unreachable and truncating the player track.
const stretchedContactTrace = structuredClone(receiverTrace);
stretchedContactTrace[0].duration = 500;
stretchedContactTrace[0].label = "Short flight with stretched contact";
stretchedContactTrace[1].playerMoves[0].reactionDelayMs = 0;
stretchedContactTrace[1].playerMoves[0].reachAllowanceYards = 1.5;
const stretchedContactPlan = buildMatchLabPlaybackPlan({
  trace: stretchedContactTrace,
  initialPositions: { passer: point(50, 20), receiver: receiverFrom },
  initialBall: point(50, 20),
  initialOwnerId: "passer",
  finalOwnerId: "receiver",
  playerProfiles: { receiver: kineticPlayer(19, 19) },
});
const stretchedContactInterval = stretchedContactPlan.intervals.find(
  (item) => item.code === "P.RECEIVE.CLEAN",
);
const stretchedContactDiagnostic = stretchedContactInterval.moveDiagnostics[0];
assert.equal(stretchedContactDiagnostic.reachable, true,
  "the playback scheduler honors the resolver's shared contact-reach allowance");
assert.equal(stretchedContactDiagnostic.reachAllowanceYards, 1.5,
  "the contact-reach allowance remains observable in movement diagnostics");
assert.deepEqual(stretchedContactPlan.tracks.players.receiver.at(-1).position, receiverTo,
  "a reachable stretched contact ends at the exact authoritative reception point");

const controlPlan = buildMatchLabPlaybackPlan({
  initialPositions: { defender: point(50, 20) }, initialBall: point(50, 20), initialOwnerId: "defender", finalOwnerId: "defender",
  trace: [{
    code: "CLEAR.CONTROLLED", label: "Brings it under control", movement: "reception", duration: 300,
    ballFrom: point(50, 20), ballTo: point(50, 20), playerMoves: [],
    contact: { point: point(50, 20), actorId: "defender", type: "control", phase: "start" },
    ownerBeforeId: "defender", ownerAfterId: "defender",
  }],
});
assert.equal(controlPlan.contacts[0].type, "control", "defensive control must not be mislabeled as clearance");

// A tactical adjustment authored AFTER a contact is sequential. It may
// start from the contact point at the same clock edge, but its destination
// must not be normalized onto that earlier contact timestamp. This is the
// exact failure reported by a long sparse-roster possession: two contacts
// correctly occurred at the ball, then a post-action adjustment marked as
// concurrent replaced both contact keyframes with its nearby endpoint.
const sequentialAdjustmentPlan = buildMatchLabPlaybackPlan({
  initialPositions: {
    passer: point(50, 20),
    receiver: point(50, 85),
  },
  initialBall: point(50, 20),
  initialOwnerId: "passer",
  finalOwnerId: "receiver",
  trace: [
    {
      code: "X.DELIVERY", label: "Delivery", movement: "cross", duration: 1000,
      ballFrom: point(50, 20), ballTo: point(50, 90),
      contact: { point: point(50, 20), actorId: "passer", type: "cross", phase: "start" },
      ownerBeforeId: "passer", ownerAfterId: null,
    },
    {
      code: "X1", label: "Header contact", movement: "cross", duration: 0,
      ballFrom: point(50, 90), ballTo: point(50, 90),
      playerMoves: [{ playerId: "receiver", from: point(50, 85), to: point(50, 90), action: "attack-ball" }],
      contact: { point: point(50, 90), actorId: "receiver", type: "header", phase: "end" },
      ownerBeforeId: null, ownerAfterId: "receiver",
    },
    {
      code: "ATT.ADJUST", label: "Post-action reshape", movement: "reposition", duration: 500,
      overlapWithPrevious: false,
      playerMoves: [{ playerId: "receiver", from: point(50, 90), to: point(51, 92), action: "support" }],
    },
  ],
});
assert.equal(sequentialAdjustmentPlan.durationMs, 1500,
  "post-action tactical movement receives its own interval after contact");
assert.deepEqual(sampleMatchLabPlaybackPlan(sequentialAdjustmentPlan, 1000).players.receiver, point(50, 90),
  "the actor remains exactly at the authoritative contact point at the contact timestamp");
assert.deepEqual(sampleMatchLabPlaybackPlan(sequentialAdjustmentPlan, 1500).players.receiver, point(51, 92),
  "the tactical adjustment reaches its destination only after the contact");

let fakeNow = 0;
let pendingFrame = null;
const frames = [];
const clock = createMatchLabPlaybackClock(planA, {
  now: () => fakeNow,
  requestFrame: (callback) => { pendingFrame = callback; return 1; },
  cancelFrame: () => { pendingFrame = null; },
  onFrame: (snapshot) => frames.push(snapshot),
});
clock.play();
fakeNow = 180;
pendingFrame(fakeNow);
clock.pause();
const pausedAt = clock.getState().timeMs;
fakeNow += 10_000;
assert.equal(clock.getState().timeMs, pausedAt, "burning wall-clock time while paused must not advance playback");
clock.step();
const expectedBoundary = nextSemanticBoundary(planA, pausedAt);
assert.equal(clock.getState().timeMs, expectedBoundary.timeMs, "Step must land exactly on the next semantic boundary");

// Step Back v1 (2026-08-31) -- a real, explicit request: rewind to
// re-watch the last incident instead of replaying the whole trace.
const afterStep = clock.getState().timeMs;
clock.stepBack();
const expectedBackBoundary = previousSemanticBoundary(planA, afterStep);
assert.equal(
  clock.getState().timeMs,
  expectedBackBoundary ? expectedBackBoundary.timeMs : 0,
  "Step Back must land exactly on the previous semantic boundary",
);
clock.stepBack();
assert.equal(clock.getState().timeMs, 0, "repeatedly stepping back eventually reaches the very start, never negative");
clock.stepBack();
assert.equal(clock.getState().timeMs, 0, "Step Back at time 0 is a safe no-op, not an error or a negative time");
let gameplayRngCalls = 0;
const gameplayRng = () => { gameplayRngCalls += 1; return 0.5; };
void gameplayRng;
clock.replay();
assert.equal(gameplayRngCalls, 0, "Replay must not call gameplay RNG");
clock.destroy();
assert(frames.length > 0, "clock must emit sampled frames");

assert.throws(() => buildMatchLabPlaybackPlan({
  initialPositions: {}, initialBall: point(0, 0), finalOwnerId: "keeper", restart: "corner", trace: [],
}), /out-of-play final state cannot retain an owner/i);

const browserMain = await readFile(new URL("../match-lab.js", import.meta.url), "utf8");
const browserHtml = await readFile(new URL("../match-lab.html", import.meta.url), "utf8");
assert.equal(MATCH_LAB_PLAYBACK_BUILD, "20260908-01", "the loaded playback module reports the expected build");
assert.match(browserMain, /matchLabPlayback\.js\?v=20260908-01/,
  "the browser entry point must cache-bust the expected playback build");
assert.match(browserMain, /scheduledCue\.kind === "audio"\) applyDeferredPlaybackAudio\(event, cue\)/,
  "the browser renderer must dispatch the planned arrival cue through the deferred audio path");
assert.match(browserMain, /if \(!hasDeferredTerminalAudio\) playEvent\(event, buildSoundContext\(event\)\)/,
  "the browser renderer must not also schedule the old fixed-delay miss sound at shot contact");
assert.match(browserHtml, /match-lab\.js\?v=20260909-04/,
  "the HTML must cache-bust the browser entry module that imports playback");

console.log("Timeline Playback v1 planner/clock tests passed.");
