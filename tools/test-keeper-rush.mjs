import assert from "node:assert/strict";
import "./match-lab-test-environment.mjs";
import {
  assessKeeperCloseDown,
  planKeeperResponse,
  chooseGoalCover,
  outfieldPositionAheadOfKeeper,
  GOAL_COVER_MIN_KEEPER_DEPTH_YARDS,
  OUTFIELD_KEEPER_DEPTH_BUFFER_YARDS,
  executeKeeperSweep,
  observeKeeperMotion,
} from "../src/lib/keeperDecision.js";
import { buildPassFlight, simulateFlightUntilContact } from "../src/lib/matchPassFlight.js";
import { advanceMotion, velocityAlong } from "../src/lib/worldMotion.js";
import { movementDistanceYards as distance } from "../src/lib/matchMovementTiming.js";
import { seededRandom } from "../src/lib/matchEngineCore.js";
import { scoreOneOnOneCandidates } from "../src/lib/oneOnOneDecision.js";
import { state, reactOffBallContinuous, FREE_PLAY_RESOLVERS, resolveShoot, isKeeperBeaten,
  simulateShotKeeperEnvelope, shotBlockingDefender, applyOffBallSeparation } from "../match-lab.js";
import { buildMatchLabPlaybackPlan } from "../src/lib/matchLabPlayback.js";
import { transitionBallState } from "../src/lib/matchBallCore.js";
import { heldKeeperStandoffTarget, KEEPER_HELD_OPPONENT_DISTANCE_METERS,
  KEEPER_HELD_OPPONENT_DISTANCE_YARDS } from "../src/lib/spatialDecision.js";

const player = (rating = 16) => ({ attributes: ["Pace", "Acceleration", "Anticipation", "Decisions", "Positioning",
  "Bravery", "Handling", "Kicking", "Technique", "Composure", "Teamwork", "Dribbling", "Finishing", "Reflexes", "Agility"]
  .map(label => ({ label, value: rating })) });
const entry = (id, x, y, team, role = "outfield", rating = 16) => ({ id, x, y, zone: 1, team, role, player: player(rating) });
const keeper = entry("keeper", 50, 5, "away", "keeper");
const attacker = entry("attacker", 50, 23, "home");
const defender = entry("cover", 60, 15, "away");
const ball = { x: 50, y: 20 };
const close = planKeeperResponse({ keeper, ball, attacker, defendingDirection: "down" });
assert.equal(close.action, "keeper-close-down");
assert(close.target.y > keeper.y && close.target.y < ball.y);
const cautiousClose = planKeeperResponse({
  keeper: { ...keeper, goalkeeperSweeping: "cautious" }, ball, attacker,
  defendingDirection: "down",
});
const aggressiveClose = planKeeperResponse({
  keeper: { ...keeper, goalkeeperSweeping: "aggressive" }, ball, attacker,
  defendingDirection: "down",
});
assert.equal(cautiousClose.action, "set-position",
  "a cautious goalkeeper declines a marginal, relatively narrow close-down");
assert.equal(aggressiveClose.action, "keeper-close-down");
assert(aggressiveClose.target.y > close.target.y,
  "an aggressive goalkeeper closes farther when the same rush is viable");
assert.equal(planKeeperResponse({ keeper, ball: {x: 50, y: 2}, attacker }).action, "keeper-recover");
assert.equal(planKeeperResponse({ keeper, ball, attacker, defenders: [entry("screen", 50, 17, "away")] }).action, "set-position");
// Reported wide-right carrier: close enough by the old 28-yard depth-only
// rule, but too wide and too far from the goal mouth to be a one-on-one.
// The keeper keeps the ordinary set position while the defender recovers.
const wideKeeper = entry("wide-keeper", 58, 92, "away", "keeper");
const wideAttacker = entry("wide-attacker", 80, 78, "home");
const wideDefender = entry("wide-cover", 44, 85, "away");
const wideBall = { x: wideAttacker.x, y: wideAttacker.y };
const wideAssessment = assessKeeperCloseDown({ keeper: wideKeeper, ball: wideBall,
  attacker: wideAttacker, defenders: [wideDefender], defendingDirection: "up" });
assert(!wideAssessment.eligible);
assert(wideAssessment.goalDistanceYards > 24);
assert(wideAssessment.shotAngleDegrees < 16);
const wideHoldTarget = { x: 54, y: 95 };
assert.deepEqual(planKeeperResponse({ keeper: wideKeeper, ball: wideBall, attacker: wideAttacker,
  defenders: [wideDefender], defendingDirection: "up", holdTarget: wideHoldTarget }).target, wideHoldTarget);
assert.equal(planKeeperResponse({ keeper: wideKeeper, ball: wideBall, attacker: wideAttacker,
  defenders: [wideDefender], defendingDirection: "up", holdTarget: wideHoldTarget }).action, "set-position");
assert.equal(chooseGoalCover({ keeper, defenders: [defender], ball, keeperAction: close.action }), null,
  "a keeper around the six-yard line is still protecting the goal and must not collapse a centre-back onto it");
const advancedKeeper = { ...keeper, y: GOAL_COVER_MIN_KEEPER_DEPTH_YARDS / 1.2 };
const advancedClose = planKeeperResponse({ keeper: advancedKeeper, ball, attacker, defendingDirection: "down" });
assert.equal(advancedClose.action, "keeper-close-down");
const cover = chooseGoalCover({
  keeper: advancedKeeper, defenders: [defender], ball,
  defendingDirection: "down", keeperAction: advancedClose.action,
});
assert.equal(cover.id, defender.id,
  "goal-line cover remains available after the keeper has genuinely vacated the goal area");
const resettingKeeper = entry("resetting-keeper", 50, 10, "away", "keeper");
const safeUpfieldBall = { x: 50, y: 55 };
const routineRecovery = planKeeperResponse({ keeper: resettingKeeper, ball: safeUpfieldBall,
  attacker, defenders: [defender], defendingDirection: "down" });
assert.equal(routineRecovery.action, "keeper-recover");
assert.equal(chooseGoalCover({ keeper: resettingKeeper, defenders: [defender], ball: safeUpfieldBall,
  defendingDirection: "down", keeperAction: routineRecovery.action }), null,
"an ordinary keeper reset with the ball safely upfield must not drag a centre-back onto the goal line");
const strandedKeeper = entry("stranded-keeper", 50, 15, "away", "keeper");
const goalSideBall = { x: 50, y: 5 };
const emergencyRecovery = planKeeperResponse({ keeper: strandedKeeper, ball: goalSideBall,
  attacker, defenders: [defender], defendingDirection: "down" });
assert.equal(emergencyRecovery.action, "keeper-recover");
assert(chooseGoalCover({ keeper: strandedKeeper, defenders: [defender], ball: goalSideBall,
  defendingDirection: "down", keeperAction: emergencyRecovery.action }),
"a defender can still cover the line when the ball is genuinely goal-side of the recovering keeper");
assert.equal(chooseGoalCover({ keeper, defenders: [entry("far", 90, 80, "away")], ball, keeperAction: close.action }), null);
assert.equal(chooseGoalCover({ keeper: {...keeper, y: 1}, defenders: [defender], ball, keeperAction: close.action }), null);
const ordinaryDefenderTarget = { x: 50, y: 3 };
const advancingKeeperTarget = { x: 50, y: 12 };
const orderedDown = outfieldPositionAheadOfKeeper(
  ordinaryDefenderTarget, keeper, advancingKeeperTarget, "down",
);
assert(orderedDown.y >= advancingKeeperTarget.y
  + OUTFIELD_KEEPER_DEPTH_BUFFER_YARDS / 1.2 - 1e-9,
"an ordinary defender target stays pitch-side of an advancing keeper");
const orderedUp = outfieldPositionAheadOfKeeper(
  { x: 50, y: 97 }, { ...keeper, y: 95 }, { ...keeper, y: 88 }, "up",
);
assert(orderedUp.y <= 88 - OUTFIELD_KEEPER_DEPTH_BUFFER_YARDS / 1.2 + 1e-9,
  "the same keeper-depth order is enforced at the opposite end");
state.attackingDirection = { home: "up", away: "down" };
const integratedOrder = applyOffBallSeparation([
  {
    id: keeper.id, role: "keeper", action: "keeper-close-down",
    from: keeper, target: advancingKeeperTarget,
  },
  {
    id: defender.id, role: "defender", action: "shift-unit",
    from: defender, target: ordinaryDefenderTarget,
  },
], [keeper, defender]);
assert(integratedOrder.find((proposal) => proposal.id === defender.id).target.y
  >= advancingKeeperTarget.y + OUTFIELD_KEEPER_DEPTH_BUFFER_YARDS / 1.2 - 1e-9,
"the live off-ball spacing pass cannot push an ordinary defender behind his keeper");
const earlyCover = advanceMotion({from: defender, intentionTarget: cover.target, player: defender.player,
  elapsedMs: 200, reactionDelayMs: cover.reactionDelayMs, intention: cover.action});
assert(distance(earlyCover.position, cover.target) > 5, "cover intent does not instantly occupy the goal");
const motion = observeKeeperMotion(keeper, attacker, velocityAlong(keeper, attacker, 7));
assert(motion.closingSpeed > 6.9 && !motion.set);
const nearer = observeKeeperMotion({...keeper, y: 18}, attacker, velocityAlong(keeper, attacker, 7));
assert(nearer.pressure > 0);
const cornerShot={from:{x:50,y:20},actual:{x:55.3,y:0},peakHeightYards:.4,durationMs:400};
assert(simulateShotKeeperEnvelope(cornerShot,{...keeper,y:12}).reached);
assert(!simulateShotKeeperEnvelope(cornerShot,{...keeper,y:1}).reached,
  "closing the angle must cover a corner through actual geometry");
assert.equal(shotBlockingDefender(cornerShot,defender),null);
assert(shotBlockingDefender(cornerShot,{...defender,x:55,y:1}),
  "a defender who actually reaches the shot lane can protect the exposed goal");
const candidateContext = { shooter: attacker.player, defenderPressure: 0, distance: 15, decisionRandom: () => .5 };
const score = (closingSpeed) => scoreOneOnOneCandidates({...candidateContext,
  perceivedKeeperState: {closingSpeed, exposedSide: "balanced", depthFromGoalLineYards: 6, distanceToShooterYards: 8}})
  .find(c => c.action === "shoot-early").utility;
assert(score(7) > score(null));

const flight = buildPassFlight({owner: entry("passer",50,45,"home"), receiver: attacker,
  from:{x:50,y:45}, intendedPoint:{x:50,y:7}, actualEndpoint:{x:50,y:7}, passType:"ground", durationMs:3000});
const velocity = {x:0,y:(7-45)/3000};
const sweeper = planKeeperResponse({keeper, ball:flight.from, attacker:{...attacker,x:65,y:32},
  ballVelocity:velocity, random:()=>.5});
assert.equal(sweeper.action,"keeper-sweep");
const visibleRead={keeper,ball:flight.from,attacker:{...attacker,x:65,y:32},ballVelocity:velocity};
assert.deepEqual(planKeeperResponse({...visibleRead,attacker:{...visibleRead.attacker,player:player(1)}}),
  planKeeperResponse({...visibleRead,attacker:{...visibleRead.attacker,player:player(20)}}),
  "a keeper cannot read the attacker's hidden ratings");
const jobTargetFor = (id) => id === keeper.id ? {point:sweeper.target, action:sweeper.action,
  authoritativeMotion:true,reactionDelayMs:sweeper.reactionDelayMs} : null;
const contact = simulateFlightUntilContact({flight,players:[{...attacker,x:65,y:32},keeper],jobTargetFor});
assert.equal(contact.candidate?.id,keeper.id);
assert(distance(contact.positions.keeper,contact.atPoint)<=contact.reachAllowanceYards);
assert.deepEqual(contact.jobMotions.keeper.position,contact.positions.keeper);
const slowLate = simulateFlightUntilContact({flight:{...flight,durationMs:700},players:[{...keeper,x:80,player:player(1)}],jobTargetFor});
assert.equal(slowLate.candidate,null,"intent never awards an unreachable contact");
// A poor read changes a marginal decision; it never changes physical reach.
let misreadFound=false;
for(let x=50;x<=70;x+=2) for(let y=10;y<=34;y+=2) {
  const args={keeper:{...keeper,player:player(3)},ball:flight.from,attacker:{...attacker,x,y},ballVelocity:velocity};
  if(planKeeperResponse({...args,random:()=>0}).action!==planKeeperResponse({...args,random:()=>1}).action)misreadFound=true;
}
assert(misreadFound);
const clean=executeKeeperSweep({keeper,point:{x:50,y:8},defendingDirection:"down",random:()=>.1});
assert.equal(clean.action,"claim");
assert.equal(executeKeeperSweep({keeper:defender,point:{x:50,y:2},defendingDirection:"down",random:()=>.1}).action,"clearance",
  "a covering defender must clear, never claim with his hands");
const atFeet=transitionBallState({ownerId:keeper.id,ownerRole:"keeper",endpoint:keeper,heldOverride:false});
assert.equal(transitionBallState({previous:atFeet,ownerId:keeper.id,ownerRole:"keeper",endpoint:ball}).phase,"controlled-ground");
assert.equal(transitionBallState({previous:atFeet,ownerId:keeper.id,ownerRole:"keeper",endpoint:ball,heldOverride:true}).phase,"held");
const mishit=executeKeeperSweep({keeper,point:{x:50,y:22},defendingDirection:"down",random:()=>.999});
assert(mishit.error && mishit.action==="clearance" && mishit.velocity.y>0);
assert.equal(executeKeeperSweep({keeper,point:{x:50,y:22},defendingDirection:"down",random:()=>.1}).action,"clearance",
  "a keeper outside the area cannot claim with his hands");

state.attackingDirection={home:"up",away:"down"};
const context=()=>({seed:9,state:{players:{}},marking:{},teamShapeJobs:{},shapeSnapshots:[],simulationTimeMs:0});

assert.equal(KEEPER_HELD_OPPONENT_DISTANCE_METERS,9.15);
assert(Math.abs(KEEPER_HELD_OPPONENT_DISTANCE_YARDS-10.00656167979)<1e-9);
const heldKeeper=entry("held-keeper",50,96,"away","keeper");
const closeAttacker=entry("held-presser",50,92,"home");
const legalTarget=heldKeeperStandoffTarget(closeAttacker,heldKeeper,heldKeeper);
assert(distance(legalTarget,heldKeeper)>=KEEPER_HELD_OPPONENT_DISTANCE_YARDS);
const heldGroups={owner:heldKeeper,teammates:[],opponents:[closeAttacker],ownKeepers:[],opposingKeepers:[],keeper:null};
const heldTrace=[];
const heldContext=context();
reactOffBallContinuous(heldGroups,heldKeeper,heldKeeper,6000,heldTrace,
  {motionContext:heldContext,keeperHolding:true});
const retreat=heldTrace.flatMap(event=>event.playerMoves??[])
  .find(move=>move.playerId===closeAttacker.id);
assert(retreat && retreat.action==="respect-held-ball");
assert(distance(retreat.to,heldKeeper)>=KEEPER_HELD_OPPONENT_DISTANCE_YARDS);
assert(!heldTrace.some(event=>(event.playerMoves??[]).some(move=>
  move.playerId===closeAttacker.id && ["press-ball","delay"].includes(move.action))));
const distanceAtRelease=distance(closeAttacker,heldKeeper);
const releasedTrace=[];
reactOffBallContinuous(heldGroups,heldKeeper,heldKeeper,1200,releasedTrace,{motionContext:heldContext});
assert(releasedTrace.some(event=>(event.playerMoves??[]).some(move=>
  move.playerId===closeAttacker.id && ["press-ball","delay"].includes(move.action))));
assert(distance(closeAttacker,heldKeeper)<distanceAtRelease,
  "ordinary pressure may resume only after the keeper drops the ball");

const groups=()=>({owner:{...attacker},teammates:[],opponents:[{...defender}],keeper:{...keeper}});
const g=groups(),trace=[];
reactOffBallContinuous(g,ball,ball,1200,trace,{motionContext:context()});
assert(g.keeper.y>keeper.y,"live keeper must actually advance");
assert(!trace.some(e=>e.playerMoves?.some(m=>m.action==="cover-goal")),
  "a routine close-down beginning around the six-yard line must preserve the outfield defensive line");
assert(trace.some(e=>e.playerMoves?.some(m=>m.action==="keeper-close-down")));
assert(g.keeper.keeperVelocity.y>0);
const repeat=groups(),repeatTrace=[];
reactOffBallContinuous(repeat,ball,ball,1200,repeatTrace,{motionContext:context()});
assert.deepEqual(trace,repeatTrace);
const liveWideKeeper=entry("live-wide-keeper",58,8,"away","keeper");
const liveWideAttacker=entry("live-wide-attacker",80,22,"home");
const liveWideDefender=entry("live-wide-cover",44,15,"away");
const liveWideGroups={owner:liveWideAttacker,teammates:[],opponents:[liveWideDefender],keeper:liveWideKeeper};
const liveWideTrace=[];
reactOffBallContinuous(liveWideGroups,liveWideAttacker,liveWideAttacker,1200,liveWideTrace,
  {motionContext:context()});
const liveWideActions=liveWideTrace.flatMap(event=>event.playerMoves??[]).map(move=>move.action);
assert(!liveWideActions.includes("keeper-close-down"),
  "a wide carrier must not turn ordinary keeper positioning into a close-down");
assert(!liveWideActions.includes("cover-goal"),
  "the defender must not abandon the play to cover a goal the keeper has not exposed");
assert(liveWideKeeper.y<=8,"the keeper holds or recovers toward the set position instead of rushing out");
// The player's actual position determines the empty goal after being rounded.
const rounded={...attacker,y:3};
assert(isKeeperBeaten(rounded,g.keeper));
for(let seed=1;seed<=20;seed++) {
  const shots=[];
  resolveShoot({owner:rounded,teammates:[],opponents:[],keeper:g.keeper},{},seededRandom(seed),shots);
  assert(!shots.some(e=>e.code.startsWith("K.SAVE")));
}

// Drive the real delivery resolver, then verify authored motion/contact agree.
let rushes=0,claims=0;
for(let seed=1;seed<=30;seed++) {
  const k={...keeper},owner=entry("passer",50,45,"home"),receiver=entry("runner",65,35,"home");
  const d=entry("onside",75,30,"away");
  const t=[],initialPositions={keeper:{x:k.x,y:k.y},passer:{x:owner.x,y:owner.y},runner:{x:receiver.x,y:receiver.y},onside:{x:d.x,y:d.y}};
  const result=FREE_PLAY_RESOLVERS.through({owner,teammates:[receiver],opponents:[d],keeper:k},
    {plannedMoveTo:{x:50,y:7},preselectedTargetId:receiver.id,forcedPassType:"ground"},seededRandom(seed),t,true,context());
  const rush=t.find(e=>e.code==="GK.RUSH");
  if(!rush)continue;
  rushes++;
  const plan=buildMatchLabPlaybackPlan({trace:t,initialPositions,initialBall:owner,initialOwnerId:owner.id,
    playerProfiles:{keeper:k.player,passer:owner.player,runner:receiver.player,onside:d.player}});
  assert(plan.intervals.flatMap(i=>i.moveDiagnostics??[]).every(d=>d.withinPhysicalLimit!==false));
  const claim=t.find(e=>e.code==="GK.SWEEP.CLAIM");
  if(claim){
    claims++;
    const move=rush.playerMoves.find(m=>m.playerId===k.id);
    assert(distance(move.to,claim.contact.point)<=1.5);
    assert.deepEqual(result.ballEnd,move.to);
  }
}
assert(rushes>0 && claims>0,`real resolver must exercise rush and claim: ${rushes}/${claims}`);
console.log(`Keeper rush contracts passed, including ${rushes} live rushes and ${claims} claims.`);
