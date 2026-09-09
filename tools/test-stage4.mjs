import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import "./match-lab-test-environment.mjs";
import { advanceMotion, continueMotionIntentions, velocityAlong, writeMotionRecord, auditMoveSpeed } from "../src/lib/worldMotion.js";
import { buildMotionTrajectoryLegacy, resolveMotionBatch } from "../src/lib/matchMotion.js";
import { reachIn, topSpeed, decelerationRate, brakingDistance, brakingSeconds,
  speedAfterBraking, diveLaunchSpeedYps, diveReachYards, DIVE_COMMIT_SECONDS,
} from "../src/lib/playerKinetics.js";
import { arrivalBrakeProfile, brakeProfileDistance, sampleContinuousTrajectory,
  movementDistanceYards } from "../src/lib/matchMovementTiming.js";
import { speedYpsFromVelocity } from "../src/lib/worldMotion.js";
import { yardDistance, GOAL_HEIGHT_YARDS } from "../src/lib/pitchGeometry.js";
import { reflectBallVelocity, goalFrameContact, parryBallVelocity, projectRebound, reboundGoalCrossing, FRAME_RESTITUTION } from "../src/lib/ballReboundPhysics.js";
import { rollStopDistanceYards, rollTraveledYards } from "../src/lib/ballRollPhysics.js";
import { claimLooseBall } from "../src/lib/ballClaim.js";
import { buildMatchLabPlaybackPlan } from "../src/lib/matchLabPlayback.js";
import { measurePlaybackFluidity, createRendererGapMonitor } from "../src/lib/matchFluidityDiagnostics.js";
import { state, runConstructedPossession, pointOf, freshBurst01, FREE_PLAY_RESOLVERS,
  simulateShotKeeperEnvelope } from "../match-lab.js";
import { applyScenarioToState } from "../src/lib/replayHarness.js";

const player = (pace, acceleration, more = {}) => ({ current_ability: 100,
  attributes: Object.entries({ Pace: pace, Acceleration: acceleration, Agility: 10, ...more }).map(([label,value])=>({label,value})) });
assert(reboundGoalCrossing({x:50,y:99,height:1},{x:50,y:101,height:1},100));
assert(reboundGoalCrossing({x:50,y:1,height:1},{x:50,y:-1,height:1},0));
assert.equal(reboundGoalCrossing({x:60,y:99,height:1},{x:60,y:101,height:1},100),null);
assert.equal(reboundGoalCrossing({x:50,y:99,height:4},{x:50,y:101,height:4},100),null);
const from = {x:30.12345,y:70.54321,zone:8}, target = {x:30.12345,y:10.98765,zone:2};
const slow = player(5,10), fast = player(20,10);
const move = (p, elapsedMs, extra={}) => advanceMotion({from,intentionTarget:target,player:p,elapsedMs,intention:"chase",...extra});
const measurements=[];
for (const ms of [400,1000,4000]) {
  const a=move(slow,ms),b=move(fast,ms);
  assert(b.distanceYards>a.distanceYards);
  assert(a.withinPhysicalLimit&&b.withinPhysicalLimit);
  measurements.push({windowMs:ms,slowYards:a.distanceYards,fastYards:b.distanceYards});
}
assert(measurements[2].fastYards-measurements[2].slowYards>measurements[0].fastYards-measurements[0].slowYards);
assert(move(player(15,20),400).distanceYards>move(player(15,5),400).distanceYards);
const incomingVelocity=velocityAlong(from,target,5);
assert(move(fast,400,{incomingVelocity}).distanceYards>move(fast,400).distanceYards);
const turned=move(fast,400,{incomingVelocity,intentionTarget:{...target,y:95}});
assert(turned.distanceYards<move(fast,400,{incomingVelocity}).distanceYards);
assert.equal(move(fast,400).position.x,from.x);
assert.deepEqual(move(fast,1000),move(fast,1000));
// Stage 5 has not enabled fatigue in locomotion. Unsanctioned ad hoc fields
// cannot silently change the kinetics or double-count the condition path.
assert.deepEqual(move({...fast,burst01:0,match01:0},400),move(fast,400));

for (const role of ["attacker","defender","keeper"]) {
  const batch=resolveMotionBatch([slow,fast].map((p,i)=>({id:String(i),from,target,action:"adjust",role,player:p})),undefined,{durationMs:400});
  assert(yardDistance(from,batch.moves[1].to)>yardDistance(from,batch.moves[0].to));
  for(const [i,m] of batch.moves.entries()) assert(auditMoveSpeed({player:[slow,fast][i],distanceYards:yardDistance(from,m.to),scheduledDurationMs:400}).withinPhysicalLimit);
  const old=buildMotionTrajectoryLegacy({from,to:target,player:slow,durationMs:400});
  assert.deepEqual(old.samples.at(-1).position,target);
  assert(yardDistance(from,old.samples.at(-1).position)>reachIn(slow,0.4));
}
const entry={id:"runner",...from,player:fast};
const context={state:{tick:0,players:{}}};
writeMotionRecord(context,entry.id,{position:from,velocity:incomingVelocity,intention:"support-run",intentionTarget:target});
const first=continueMotionIntentions([entry],context,400)[0];
const second=continueMotionIntentions([entry],context,400)[0];
assert.deepEqual(second.from,first.to);
assert.deepEqual(second.trajectory[0].velocity,first.trajectory.at(-1).velocity);
assert(second.motion.entrySpeedYps>0);
assert.deepEqual(second.intention.target,target);
assert.deepEqual(continueMotionIntentions([entry],context,400,[entry.id]),[]);

// --- Stage 4: deceleration is part of locomotion, and arrivals come to rest ---
// Braking is expressed against the player's own acceleration rate, so a
// quicker player also stops harder; Agility separates two players who share
// Pace and Acceleration exactly.
const agile = player(15, 15, { Agility: 18 }), lumbering = player(15, 15, { Agility: 4 });
assert(decelerationRate(agile) > decelerationRate(lumbering));
assert(decelerationRate(agile) > topSpeed(agile) / 2.6, "braking must exceed a walk-off");
assert(brakingDistance(agile, 6) < brakingDistance(lumbering, 6));
assert(brakingSeconds(agile, 6) < brakingSeconds(lumbering, 6));
assert.equal(brakingDistance(agile, 0), 0);
assert.equal(speedAfterBraking(agile, 6, 99), 0, "braking floors at rest, never reverses");
assert(Math.abs(speedAfterBraking(agile, 6, brakingSeconds(agile, 6))) < 1e-9);
// v^2 = 2*a*d for the closed form the profile is built on.
assert(Math.abs(brakingDistance(agile, 6) - 36 / (2 * decelerationRate(agile))) < 1e-9);

// The arrival profile stops exactly ON the target, never past it, and is
// monotonic -- a player may not step backwards to bleed speed.
const brakeLeg = arrivalBrakeProfile({ player: agile, totalYards: 8 });
assert(Math.abs(brakeProfileDistance(brakeLeg, brakeLeg.totalSeconds) - 8) < 1e-9);
assert(Math.abs(brakeProfileDistance(brakeLeg, brakeLeg.totalSeconds * 4) - 8) < 1e-9);
assert(brakeLeg.peakSpeedYps <= topSpeed(agile) + 1e-9);
let previousDistance = -1;
for (let t = 0; t <= brakeLeg.totalSeconds + 0.5; t += 0.05) {
  const d = brakeProfileDistance(brakeLeg, t);
  assert(d >= previousDistance - 1e-9, "arrival profile must be monotonic");
  assert(d <= 8 + 1e-9, "arrival profile must never overshoot its target");
  previousDistance = d;
}
// A profile only exists where the player can still stop in the distance left.
assert.equal(arrivalBrakeProfile({ player: agile, totalYards: 0 }), null);
assert.equal(arrivalBrakeProfile({ player: agile, totalYards: 0.05, initialSpeedYps: topSpeed(agile) }), null);

// Completing a leg inside its window now decelerates into the target instead
// of running flat out and having its velocity zeroed at the last keyframe.
const legFrom = { x: 50, y: 50 }, legTo = { x: 50, y: 56 };
const braked = sampleContinuousTrajectory({ from: legFrom, to: legTo, player: agile,
  totalMs: 4000, sampleCount: 40 });
const arrivalIndex = braked.findIndex(sample => movementDistanceYards(sample.position, legTo) < 0.01);
assert(arrivalIndex > 0, "the leg must actually arrive");
const approach = braked.slice(Math.max(0, arrivalIndex - 4), arrivalIndex + 1)
  .map(sample => speedYpsFromVelocity(sample.velocity));
assert(approach[0] > approach[approach.length - 1], "speed must fall into the arrival");
assert(approach.at(-1) < 1.5, "the player must be near rest on arrival, not stopped dead");
// The endpoint itself is unchanged: braking reshapes the approach only.
assert(movementDistanceYards(braked.at(-1).position, legTo) < 0.01);
// A leg that is only a waypoint in a longer run must NOT brake -- asserted
// through advanceMotion(), which is what actually supplies the exit speed a
// continuing leg hands to the next one.
const stopping = advanceMotion({ from: legFrom, intentionTarget: legTo, player: agile,
  elapsedMs: 4000, intention: "chase" });
const waypoint = advanceMotion({ from: legFrom, intentionTarget: legTo, player: agile,
  elapsedMs: 4000, intention: "chase", continuesAfter: true });
assert.equal(speedYpsFromVelocity(stopping.velocity), 0, "a completed leg ends at rest");
assert(speedYpsFromVelocity(waypoint.velocity) > 1,
  "a waypoint leg keeps its momentum for the next leg");
// Both still arrive: braking reshapes the approach, it does not shorten it.
assert(movementDistanceYards(stopping.position, legTo) < 0.01);
assert(movementDistanceYards(waypoint.position, legTo) < 0.01);

// --- Stage 4 follow-up: a dive is a committed action, not locomotion ---
// reachIn() gives a standing start almost no ground in the two or three
// tenths a keeper actually has, so a static arm allowance left them unable to
// reach shots they should save. A dive is an explosive one-off launch with
// its own short window, driven by Agility and Jumping.
const springy = player(10, 10, { Agility: 18, Jumping: 18 });
const flat = player(10, 10, { Agility: 3, Jumping: 3 });
assert(diveLaunchSpeedYps(springy) > diveLaunchSpeedYps(flat));
assert(diveReachYards(springy, 0.25) > diveReachYards(flat, 0.25));
assert.equal(diveReachYards(springy, 0), 0);
// One dive, not continuous travel: past the commit window it stops growing.
assert.equal(diveReachYards(springy, DIVE_COMMIT_SECONDS),
  diveReachYards(springy, DIVE_COMMIT_SECONDS * 50), "a dive may not be sustained");
// It must never masquerade as a faster way to cross the pitch.
assert(diveReachYards(springy, DIVE_COMMIT_SECONDS) < reachIn(springy, 2),
  "a dive must not out-travel running over a real window");

// In the envelope: a short window is where the dive binds, and leg power
// separates two keepers with identical Pace and Acceleration.
const quickShot = { from: { x: 50, y: 88 }, actual: { x: 53, y: 100 }, durationMs: 420, peakHeightYards: 0 };
const springyReach = simulateShotKeeperEnvelope(quickShot, { id: "gk", x: 50, y: 96, player: springy });
const flatReach = simulateShotKeeperEnvelope(quickShot, { id: "gk", x: 50, y: 96, player: flat });
assert(springyReach.reached && flatReach.reached);
assert(springyReach.atMs < flatReach.atMs,
  "leg power must reach a close shot sooner at equal Pace/Acceleration");
// Over a long window the running curve wins, so Acceleration still decides --
// restoring a constant keeper travel speed would silently remove it.
const longShot = { from: { x: 50, y: 75 }, actual: { x: 53, y: 100 }, durationMs: 1600, peakHeightYards: 0 };
const slowLegs = simulateShotKeeperEnvelope(longShot, { id: "gk", x: 50, y: 96, player: player(10, 1, { Agility: 10, Jumping: 10 }) });
const quickLegs = simulateShotKeeperEnvelope(longShot, { id: "gk", x: 50, y: 96, player: player(10, 20, { Agility: 10, Jumping: 10 }) });
assert(slowLegs.reached && quickLegs.reached);
assert.notDeepEqual(slowLegs.atPoint, quickLegs.atPoint,
  "Acceleration must still change keeper travel over a long window");

const normal={x:0,y:1,z:0};
const reflected=reflectBallVelocity({x:6,y:-20,z:2},normal);
assert.equal(reflected.x,6);assert.equal(reflected.z,2);
assert(Math.abs(reflected.y-20*FRAME_RESTITUTION)<1e-10);
assert(reflectBallVelocity({x:6,y:-40,z:2},normal).y>reflected.y);
assert.deepEqual(reflectBallVelocity({x:0,y:5,z:0},normal),{x:0,y:5,z:0});
const bar=goalFrameContact({point:{x:50,y:0,height:GOAL_HEIGHT_YARDS-0.05},goalY:0,incomingVelocity:{x:0,y:-20,z:5}});
assert.equal(bar.kind,"crossbar");
const barBounce=reflectBallVelocity({x:0,y:-20,z:5},bar.normal);
assert.notEqual(barBounce.z,5);
const post=goalFrameContact({point:{x:44.67,y:0,height:1},goalY:0,incomingVelocity:{x:-2,y:-20,z:0}});
assert.equal(post.kind,"post");
const mirrored=goalFrameContact({point:{x:44.67,y:100,height:1},goalY:100,incomingVelocity:{x:-2,y:20,z:0}});
assert.equal(post.normal.y,-mirrored.normal.y);
const parryInput={incomingVelocity:{x:0,y:-25,z:0},point:{x:51,y:2,height:1},keeperPoint:{x:50,y:2},goalY:0};
const wide=parryBallVelocity({...parryInput,handling:18}),dangerous=parryBallVelocity({...parryInput,handling:5});
assert.equal(wide.kind,"parry-wide");assert.equal(dangerous.kind,"parry-dangerous");
assert(Math.abs(wide.velocity.x)>Math.abs(dangerous.velocity.x));
// Stage 4 (2026-09-06) -- which of the two happens follows from the save, not
// from a Handling step. The same keeper steers a comfortable save wide and
// only palms back a shot that overwhelms them, and reach does the same job as
// pace. Measured before this change: 792 parry-wide and 0 parry-dangerous
// across 4000 shots at a Handling-12 keeper, because the branch was a
// `handling >= 12` cut.
const parryKind = (handling, speedYps, lateralYards) => parryBallVelocity({
  incomingVelocity: { x: 0, y: -speedYps, z: 0 },
  point: { x: 50 + lateralYards / 0.75, y: 2, height: 1 },
  keeperPoint: { x: 50, y: 2 }, goalY: 0, handling,
}).kind;
assert.equal(parryKind(18, 22, 0.75), "parry-wide");
assert.equal(parryKind(4, 22, 0.75), "parry-dangerous", "a poor handler cannot steer it");
assert.equal(parryKind(12, 25, 0.75), "parry-wide");
assert.equal(parryKind(12, 44, 0.75), "parry-dangerous", "pace alone can take the direction away");
assert.equal(parryKind(14, 28, 1), "parry-wide");
assert.equal(parryKind(14, 28, 4), "parry-dangerous", "full stretch deflects rather than places");
// Monotonic in Handling at a fixed shot: no keeper is worse for being better.
let sawDangerous = false, sawWide = false;
for (const handling of [2, 6, 10, 14, 18]) {
  const kind = parryKind(handling, 34, 1.5);
  if (kind === "parry-dangerous") {
    assert(!sawWide, "increasing Handling cannot turn a directed parry dangerous");
    sawDangerous = true;
  } else sawWide = true;
}
assert(sawDangerous, "the dangerous branch must be reachable at ordinary shot pace");
assert(sawWide, "the same shot must exercise a directed parry at higher Handling");
// A spill is always dangerous and always slower than a directed parry.
const spill = parryBallVelocity({ ...parryInput, handling: 18, spilled: true });
assert.equal(spill.kind, "spill-dangerous");
assert(spill.restitution < wide.restitution);
const roll=projectRebound({from:{x:50,y:50,height:0},velocity:{x:6,y:8,z:0}});
assert(Math.abs(yardDistance(roll.samples[0].position,roll.endpoint)-rollStopDistanceYards(10))<1e-9);
const halfway=roll.samples.find(s=>s.timeMs>=1000);
assert(Math.abs(yardDistance(roll.samples[0].position,halfway.position)-rollTraveledYards(10,halfway.timeMs))<1e-9);
const airborne=projectRebound({from:bar.point,velocity:barBounce});
assert(airborne.contacts.length>0);
assert(airborne.samples.every(s=>s.position.height>=0&&Number.isFinite(s.position.x)));
assert.equal(airborne.samples.at(-1).verticalVelocity,0);
const claim=claimLooseBall({from:roll.rollFrom,aim:{x:100,y:100},speedYps:roll.speedYps,candidates:[{id:"a",x:51,y:51,player:fast},{id:"b",x:80,y:80,player:slow}]});
assert(claim.claimant||claim.pickup);assert.equal(claim.contenders.length+claim.abandoned.length,2);

// A moving ball is physical evolution even when every player chooses to stand.
const planFor=trace=>buildMatchLabPlaybackPlan({initialPositions:{a:{x:50,y:50}},initialBall:{x:50,y:50},trace});
const staticPlan=planFor([{code:"BAD",duration:800}]);
assert(measurePlaybackFluidity(staticPlan).longestFreezeMs>=780);
assert.equal(measurePlaybackFluidity(staticPlan).orphanedIntervals.length,1);
const ballPlan=planFor([{code:"FLIGHT",duration:800,ballFrom:{x:50,y:50},ballTo:{x:70,y:50}}]);
assert.equal(measurePlaybackFluidity(ballPlan).fullyStaticMs,0);
assert.equal(measurePlaybackFluidity(ballPlan).orphanedIntervals.length,0);
const partialPlan=planFor([{code:"GAP",duration:800},{code:"MOVE",duration:200,overlapWithPrevious:true,ballFrom:{x:50,y:50},ballTo:{x:70,y:50}}]);
assert(measurePlaybackFluidity(partialPlan).orphanedIntervals.some(i=>i.durationMs>=600));
const monitor=createRendererGapMonitor();monitor.sample(0,true);monitor.sample(200,true);monitor.sample(201,false);monitor.sample(5000,true);
assert.equal(monitor.snapshot().length,1);

const held={id:"keeper",role:"keeper",team:"home",x:50,y:10,zone:1,player:fast};
const dropTrace=[];
FREE_PLAY_RESOLVERS["release-to-feet"]({owner:held}, {},()=>{throw Error("RNG not needed for drop")},dropTrace);
assert(dropTrace[0].ballTrajectory[0].position.height>1);
assert.equal(dropTrace[0].ballTrajectory.at(-1).position.height,0);
assert(dropTrace[0].duration>300);
console.log("Stage 4 physical motion, rebound, roll, claim and diagnostic contracts passed.");
console.log(JSON.stringify(measurements,null,2));
