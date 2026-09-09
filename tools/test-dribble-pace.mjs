import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import './match-lab-test-environment.mjs';
import { simulateCarryTouches, yardDistance } from '../src/lib/spatialDecision.js';
import { topSpeed, reachIn } from '../src/lib/playerKinetics.js';
import { advanceMotion, velocityAlong, speedYpsFromVelocity } from '../src/lib/worldMotion.js';
import { buildMatchLabPlaybackPlan, sampleMatchLabPlaybackPlan } from '../src/lib/matchLabPlayback.js';
import { state, resolveCarry, pointOf, runConstructedPossession } from '../match-lab.js';
import { applyScenarioToState } from '../src/lib/replayHarness.js';

// Screenshot ratings: Anderson Pace 17 / Dribbling 20 / Technique 19,
// Sensini Pace 12. Acceleration was not shown: hold it equal at 15 so that
// the test isolates the dribble penalty rather than inventing a player rating.
const profile=(pace,acceleration=15,control=20)=>({attributes:Object.entries({
  Pace:pace,Acceleration:acceleration,Agility:15,Dribbling:control,Technique:control===20?19:control,
  Stamina:15,WorkRate:15,Anticipation:15,Decisions:15,
}).map(([label,value])=>({label,value}))});
const anderson=profile(17),sensini=profile(12);
const from={x:40,y:40},to={x:40,y:60};
const speed=topSpeed(anderson);
for(const gait of ['close-control','controlled-sprint','full-sprint']) {
  const touches=simulateCarryTouches(from,to,gait,{player:anderson,seed:'anderson'});
  assert(touches.length>=3);
  const late=touches.filter(t=>t.startOffsetMs>2000);
  assert(late.length>0);
  for(const touch of late) {
    const average=yardDistance(touch.ballFrom,touch.ballTo)/(touch.durationMs/1000);
    assert(average>speed*0.95,`${gait}: real ground covered must agree with the running speed (${average})`);
    assert(average<=speed+0.001);
  }
  for(const touch of touches) {
    assert(yardDistance(touch.chaseTrajectory.at(-1).position,touch.ballTo)<0.001,'contact must be physically reached');
    assert(yardDistance(touch.chaseTrajectory[0].position,touch.ballFrom)<0.001);
  }
  const last=touches.at(-1),duration=last.startOffsetMs+last.durationMs;
  const runnerGround=yardDistance(from,last.ballTo);
  const slowerGround=reachIn(sensini,duration/1000);
  assert(runnerGround>slowerGround,'a slower equal-Acceleration pursuer cannot erase the speed advantage');
  assert.deepEqual(touches,simulateCarryTouches(from,to,gait,{player:anderson,seed:'anderson'}));
}

const fresh=simulateCarryTouches(from,to,'full-sprint',{player:anderson,seed:'momentum'});
const moving=simulateCarryTouches(from,to,'full-sprint',{player:anderson,seed:'momentum',incomingVelocity:velocityAlong(from,to,8)});
assert(moving[0].durationMs<fresh[0].durationMs,'a fresh carry must inherit the incoming stride');
const turning=simulateCarryTouches(from,{x:40,y:20},'full-sprint',{player:anderson,seed:'momentum',incomingVelocity:velocityAlong(from,to,8)});
assert(speedYpsFromVelocity(turning[0].chaseTrajectory.at(-1).velocity)>0);
assert(turning[0].durationMs>moving[0].durationMs,'a reversal must retain less momentum');

state.attackingDirection={home:'down',away:'up'};
const owner={id:'anderson',team:'home',role:'outfield',...from,player:anderson,burst01:1};
const pursuer={id:'sensini',team:'away',role:'outfield',x:40,y:35,player:sensini};
const initialPositions={anderson:pointOf(owner),sensini:pointOf(pursuer)};
const context={state:{players:{}},marking:{}};
const trace=[];
resolveCarry({owner,teammates:[],opponents:[pursuer],keeper:null},
  {plannedMoveTo:to},()=>0.5,trace,true,context);
const plan=buildMatchLabPlaybackPlan({trace,initialPositions,initialBall:from,initialOwnerId:owner.id,
  playerProfiles:{anderson,sensini}});
const start=sampleMatchLabPlaybackPlan(plan,0),end=sampleMatchLabPlaybackPlan(plan,plan.durationMs);
assert(yardDistance(end.players.anderson,end.players.sensini)>yardDistance(start.players.anderson,start.players.sensini),
  'the actual authored carry/pursuit must let the faster carrier pull away');
const fasterPursuer=advanceMotion({from:{x:40,y:35},intentionTarget:{x:40,y:90},player:profile(20),
  elapsedMs:plan.durationMs,intention:'chase',paceToArrival:false});
assert(fasterPursuer.distanceYards>yardDistance(from,end.players.anderson),
  'a genuinely faster pursuer can still gain ground; this is not a defender penalty');
const final=trace.find(e=>e.code==='P.CARRY');
assert(speedYpsFromVelocity(final.playerMoves[0].trajectory.at(-1).velocity)>speed*0.95,
  'the final carry leg must preserve the stride into the next decision');
const allDiagnostics=plan.intervals.flatMap(i=>i.moveDiagnostics??[]);
assert(allDiagnostics.every(d=>d.withinPhysicalLimit!==false));
// A defender already in the running lane remains a legitimate contact.
const obstruction=simulateCarryTouches(from,to,'controlled-sprint',{player:anderson,seed:'contact',
  opponents:[{id:'blocker',x:40,y:41,player:sensini}]});
assert(obstruction.some(t=>t.pokeAttempt),'speed must not confer immunity to a placed defender');
// Verify the possession runner's commit/read boundary, not just two direct
// calls supplied with a manually constructed velocity.
const fixture=JSON.parse(readFileSync(new URL('./replay-scenarios/repeated-carry-burst-drain.json',import.meta.url),'utf8'));
state.mode='freeplay';
const possession=runConstructedPossession(applyScenarioToState(state,fixture));
let previousCarry=null,continuedCarries=0;
for(const event of possession.trace){
  if(event.code==='ACTION.CHOICE'&&(!event.label.includes('chooses to carry')
    || (previousCarry && event.actorId!==previousCarry.actorId)))previousCarry=null;
  if(event.code==='P.CARRY.TOUCH'&&previousCarry){
    assert.equal(event.actorId,previousCarry.actorId);
    assert.deepEqual(event.playerMoves[0].trajectory[0].velocity,previousCarry.playerMoves[0].trajectory.at(-1).velocity);
    continuedCarries++;
    previousCarry=null;
  }
  if(event.code==='P.CARRY')previousCarry=event;
}
assert(continuedCarries>=2,'the saved possession must exercise consecutive carries');
console.log('Dribble pace contracts passed: stride speed, momentum, turns, physical touches, pursuit and contact.');
console.log(JSON.stringify({durationMs:plan.durationMs,startGapYards:yardDistance(start.players.anderson,start.players.sensini),
  finalGapYards:yardDistance(end.players.anderson,end.players.sensini)},null,2));
