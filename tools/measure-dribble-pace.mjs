import './match-lab-test-environment.mjs';
import { writeFileSync, mkdirSync } from 'node:fs';
const baseline=process.argv.includes('--baseline');
const root=baseline?'../audit/dribble-pace/baseline-engine/':'../';
const {simulateCarryTouches,yardDistance}=await import(root+'src/lib/spatialDecision.js');
const {topSpeed}=await import(root+'src/lib/playerKinetics.js');
const {buildMatchLabPlaybackPlan,sampleMatchLabPlaybackPlan}=await import(root+'src/lib/matchLabPlayback.js');
const {state,resolveCarry,pointOf}=await import(root+'match-lab.js');
const profile=pace=>({attributes:Object.entries({Pace:pace,Acceleration:15,Agility:15,Dribbling:20,
  Technique:19,Stamina:15,WorkRate:15,Anticipation:15,Decisions:15}).map(([label,value])=>({label,value}))});
const anderson=profile(17),sensini=profile(12),from={x:40,y:40},to={x:40,y:60};
const gaits=['close-control','controlled-sprint','full-sprint'].map(gait=>{
  const touches=simulateCarryTouches(from,to,gait,{player:anderson,seed:'anderson'});
  const durationMs=touches.reduce((s,t)=>s+t.durationMs,0);
  const distanceYards=touches.reduce((s,t)=>s+yardDistance(t.ballFrom,t.ballTo),0);
  const late=touches.filter(t=>t.startOffsetMs>2000);
  return {gait,touches:touches.length,durationMs,distanceYards,averageSpeedYps:distanceYards/(durationMs/1000),
    lateAverageSpeedYps:late.reduce((s,t)=>s+yardDistance(t.ballFrom,t.ballTo),0)/(late.reduce((s,t)=>s+t.durationMs,0)/1000)};
});
state.attackingDirection={home:'down',away:'up'};
const owner={id:'anderson',team:'home',role:'outfield',...from,player:anderson,burst01:1};
const pursuer={id:'sensini',team:'away',role:'outfield',x:40,y:35,player:sensini};
const initialPositions={anderson:pointOf(owner),sensini:pointOf(pursuer)},trace=[];
resolveCarry({owner,teammates:[],opponents:[pursuer],keeper:null},{plannedMoveTo:to},()=>0.5,
  trace,true,{state:{players:{}},marking:{}});
const plan=buildMatchLabPlaybackPlan({trace,initialPositions,initialBall:from,initialOwnerId:owner.id,playerProfiles:{anderson,sensini}});
const end=sampleMatchLabPlaybackPlan(plan,plan.durationMs);
const output={baseline,assumptions:'Screenshot Pace 17 vs 12; equal Acceleration 15. Controlled reproduction, not a recovered screenshot seed.',
  topSpeedYps:{anderson:topSpeed(anderson),sensini:topSpeed(sensini)},gaits,
  authoredPursuit:{durationMs:plan.durationMs,carrierDistanceYards:yardDistance(from,end.players.anderson),
    initialGapYards:6,finalGapYards:yardDistance(end.players.anderson,end.players.sensini)}};
mkdirSync('audit/dribble-pace',{recursive:true});
writeFileSync(`audit/dribble-pace/${baseline?'before':'after'}.json`,JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify(output,null,2));
