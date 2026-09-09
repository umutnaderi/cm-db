import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './match-lab-test-environment.mjs';
import { sampleMatchLabPlaybackPlan, buildMatchLabPlaybackPlan } from '../src/lib/matchLabPlayback.js';
import { deriveCheckpoints, applyScenarioToState } from '../src/lib/replayHarness.js';
import { buildPassFlight, earliestReachableContact, simulateFlightUntilContact, reactionDelayMsFor } from '../src/lib/matchPassFlight.js';
import { movementDistanceYards } from '../src/lib/matchMovementTiming.js';
import { resolveBodyOverlaps } from '../src/lib/playerBody.js';
import { advanceMotion, advanceKeeperSaveMotion, auditMoveSpeed } from '../src/lib/worldMotion.js';
import { generateFreePlayCandidates } from '../src/lib/spatialDecision.js';
import { simulateShotKeeperEnvelope, state, resolveShoot, pointOf } from '../match-lab.js';
import { seededRandom } from '../src/lib/matchEngineCore.js';
const player = acceleration => ({ attributes: Object.entries({Pace:10,Acceleration:acceleration,Jumping:10,Anticipation:10,Decisions:10}).map(([label,value])=>({label,value})) });
const profile = player(10);
const origin={x:50,y:50,zone:null};
const plan={durationMs:100,tracks:{players:{a:[{timeMs:0,position:origin}],b:[{timeMs:0,position:origin}]},ball:[{timeMs:0,position:origin}],owner:[{timeMs:0,ownerId:null,restart:null}]},cues:[{timeMs:0,eventIndex:0,code:'ATT.RECEIVER.RUN'}]};
for (const time of [0,50,100]) assert.deepEqual(sampleMatchLabPlaybackPlan(plan,time).players.a,origin,'sampling must not invent body displacement');
assert.deepEqual(deriveCheckpoints(plan)[0].players.a.position,origin,'collision assertions must see the authoritative overlap');
const owner={id:'owner',...origin,player:profile};
const defender={id:'blocker',x:50.4,y:50,player:profile,team:'away'};
const flight=buildPassFlight({owner,receiver:null,from:origin,intendedPoint:{x:70,y:50},actualEndpoint:{x:70,y:50},passType:'ground',durationMs:1000});
for (const contact of [earliestReachableContact({flight,candidates:[defender],sampleIntervalMs:20}),simulateFlightUntilContact({flight,players:[defender],sampleIntervalMs:20})]) {
  assert.equal(contact.candidate.id,'blocker');
  assert.equal(contact.atMs,20,'a real block is legal at the first post-release tick');
}
assert.equal(earliestReachableContact({flight,candidates:[owner]}),null,'the kicker cannot receive their own departing pass');
const far=buildPassFlight({owner,receiver:null,from:{x:0,y:0},intendedPoint:{x:0,y:1},actualEndpoint:{x:0,y:1},passType:'ground',durationMs:1});
const bodies=[{id:'a',...origin,player:profile},{id:'b',...origin,player:profile}];
const result=simulateFlightUntilContact({flight:far,players:bodies});
assert.equal(movementDistanceYards(origin,result.positions.a),0,'an idle body cannot be relocated by a contact scan');
const targets=resolveBodyOverlaps(bodies);
assert(movementDistanceYards(targets[0],targets[1])>=0.9);
assert.deepEqual(bodies[0],{id:'a',...origin,player:profile});
const limited=advanceMotion({from:origin,intentionTarget:targets[0],player:profile,elapsedMs:1,intention:'yield'});
assert(limited.distanceYards<0.00001&&limited.withinPhysicalLimit,'a separation target still requires physical travel');
const keeperOwner={id:'gk',role:'keeper',team:'home',x:50,y:33.2,zone:4,player:profile};
const keeperCarry=generateFreePlayCandidates({owner:keeperOwner,teammates:[],opponents:[],keeper:null,ballState:{phase:'controlled-ground'}},'down').find(c=>c.type==='carry');
assert(keeperCarry.moveTo.y<keeperOwner.y,'the bounded keeper route turns back at the third');
assert(keeperCarry.utility<0,'retreat must not inherit the original forward route reward');
const shot={from:{x:50,y:75},actual:{x:53,y:100},durationMs:1600,peakHeightYards:0};
const slow=simulateShotKeeperEnvelope(shot,{id:'gk',x:50,y:96,player:player(1)});
const fast=simulateShotKeeperEnvelope(shot,{id:'gk',x:50,y:96,player:player(20)});
assert(slow.reached&&fast.reached);
assert.notDeepEqual(slow.atPoint,fast.atPoint,'equal Pace and different Acceleration must change keeper travel');
// The save race and the authored body must agree, including explosive dives.
// Exercise short and long flights, both goals and both lateral directions.
let diveCases = 0;
for (const goalY of [0,100]) for (const side of [-1,1]) for (const durationMs of [350,600,1000,1600]) {
  const keeper = {id:'gk',x:50,y:goalY === 0 ? 4 : 96,player:profile};
  const flight = {from:{x:50,y:goalY === 0 ? 25 : 75},actual:{x:50+side*3,y:goalY},durationMs,peakHeightYards:0};
  const envelope = simulateShotKeeperEnvelope(flight,keeper);
  if (!envelope.reached) continue;
  const actual = advanceKeeperSaveMotion({from:keeper,intentionTarget:flight.actual,player:profile,
    elapsedMs:envelope.atMs,reactionDelayMs:reactionDelayMsFor(profile)});
  assert(movementDistanceYards(actual.position,envelope.atPoint)<1e-9,'saved contact must use the authored body');
  assert.deepEqual(actual.trajectory.at(-1).position,actual.position);
  assert(auditMoveSpeed({player:profile,distanceYards:actual.distanceYards,
    scheduledDurationMs:envelope.atMs,reactionDelayMs:actual.reactionDelayMs,
    motionModel:actual.motionModel,toleranceYards:0}).withinPhysicalLimit);
  assert(actual.trajectory.every((sample,index)=> index===0 || sample.timeMs>=actual.trajectory[index-1].timeMs));
  if(actual.motionModel==='keeper-dive') diveCases++;
}
assert(diveCases>0,'the body/contact parity assertion must exercise a dive');
// Cross the adapter boundary as well: traceEvent must retain the motion model
// and the following catch must not author a second journey to the ball.
const fixture=JSON.parse(readFileSync(new URL('./replay-scenarios/keeper-hold-walk.json',import.meta.url),'utf8'));
// Fix the shot geometry itself. Earlier carry/rush decisions must not decide
// whether this adapter/contact regression happens to exercise a catch.
state.mode='freeplay';
applyScenarioToState(state,fixture);
const shotOwner={...state.roster[0],x:50,y:70};
const shotKeeper={...state.roster.find(entry=>entry.role==='keeper'),x:50,y:96};
const run={trace:[]};
const shotResult=resolveShoot({owner:shotOwner,keeper:shotKeeper,teammates:[],opponents:[]},{},seededRandom(1),run.trace);
const savedPlan=buildMatchLabPlaybackPlan({trace:run.trace,
  initialPositions:Object.fromEntries([shotOwner,shotKeeper].map(e=>[e.id,pointOf(e)])),
  initialBall:pointOf(shotOwner),initialOwnerId:shotOwner.id,finalOwnerId:shotResult.nextOwnerId,restart:shotResult.restart,
  playerProfiles:Object.fromEntries(state.roster.map(e=>[e.id,e.player]))});
const authoredDives=run.trace.flatMap(event=>event.playerMoves??[]).filter(move=>move.motionModel==='keeper-dive');
assert(authoredDives.length>0,'the saved fixture must author an actual dive');
const diveDiagnostics=savedPlan.intervals.flatMap(interval=>interval.moveDiagnostics??[]).filter(move=>move.motionModel==='keeper-dive');
assert.equal(diveDiagnostics.length,authoredDives.length,'the dive model must survive into playback diagnostics');
assert(diveDiagnostics.every(move=>move.withinPhysicalLimit));
const catches=run.trace.filter(event=>event.code.startsWith('K.SAVE.')&&event.ballResult==='held');
assert(catches.length>0,'the fixture must exercise the contact-to-hold transition');
for(const caught of catches){
  assert.equal(caught.playerMoves.length,0,'a keeper who already made contact must not dive again');
  assert(caught.contact.bodyPoint,'the hand contact must retain the actual keeper body point');
  assert(movementDistanceYards(caught.ballTo,caught.contact.bodyPoint)<1e-9,'a catch returns the ball to its holder');
}
console.log('Stage 4 review regressions passed: sampled parity, honest collision checks, bounded separation, close blocks, keeper route scoring and Acceleration.');
