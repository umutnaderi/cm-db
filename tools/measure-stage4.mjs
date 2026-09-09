// Identical fixture/seed sweep for Stage 4. The saved baseline is captured
// from the untouched docs mirror before pages:build; never use the new mirror
// as if it were the pre-change engine.
// node tools/measure-stage4.mjs audit/stage4/after.json
// node tools/measure-stage4.mjs audit/stage4/before.json --baseline
import './match-lab-test-environment.mjs';
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { applyScenarioToState, runAssertions } from '../src/lib/replayHarness.js';
import { measurePlaybackFluidity } from '../src/lib/matchFluidityDiagnostics.js';
const baseline = process.argv.includes('--baseline');
const engineRoot = baseline ? '../audit/stage4/baseline-engine/' : '../';
const { state, runConstructedPossession, pointOf, freshBurst01 } = await import(engineRoot+'match-lab.js');
const { buildMatchLabPlaybackPlan, sampleMatchLabPlaybackPlan } = await import(engineRoot+'src/lib/matchLabPlayback.js');
const scenarioDir = new URL('./replay-scenarios/',import.meta.url);
const measurements=[];
for(const name of readdirSync(scenarioDir).filter(n=>n.endsWith('.json')).sort()) {
  const scenario=JSON.parse(readFileSync(new URL(name,scenarioDir),'utf8'));
  for(let offset=0;offset<5;offset++) {
    const fixture=structuredClone(scenario);fixture.seed=Number(scenario.seed)+offset;
    state.mode='freeplay';
    const seed=applyScenarioToState(state,fixture), run=runConstructedPossession(seed);
    const initialOwner=state.roster.find(e=>e.id===state.ball.ownerId);
    const plan=buildMatchLabPlaybackPlan({trace:run.trace,
      initialPositions:Object.fromEntries(state.roster.map(e=>[e.id,pointOf(e)])),
      initialBall:initialOwner?pointOf(initialOwner):{...state.ball},initialOwnerId:state.ball.ownerId,
      finalOwnerId:run.finalOwnerId,restart:run.result?.restart,
      playerProfiles:Object.fromEntries(state.roster.map(e=>[String(e.id),e.player])),
      initialBurst:Object.fromEntries(state.roster.map(e=>[String(e.id),freshBurst01(e.player)])),
    });
    // Preserve the earlier player-only 33ms/0.02%-pitch method alongside
    // real-yard world stillness. These measure different things.
    let previous=sampleMatchLabPlaybackPlan(plan,0),open=null,staticMs=0;
    const freezes=[];
    const close=t=>{if(open!==null)freezes.push({startMs:open,durationMs:t-open});open=null;};
    for(let t=33;t<plan.durationMs+33;t+=33){
      const time=Math.min(t,plan.durationMs),frame=sampleMatchLabPlaybackPlan(plan,time);
      const moving=Object.keys(frame.players).some(id=>Math.hypot(frame.players[id].x-previous.players[id].x,frame.players[id].y-previous.players[id].y)>.02);
      if(!moving){staticMs+=time-previous.timeMs;if(open===null)open=previous.timeMs;}else close(previous.timeMs);
      previous=frame;
    }
    close(plan.durationMs);
    const moves=i=>(i.moveDiagnostics||[]).some(d=>d.distanceYards>.05);
    const orphans=plan.intervals.filter(i=>i.endMs-i.startMs>200&&!moves(i)&&!plan.intervals.some(o=>o!==i&&o.startMs<i.endMs&&o.endMs>i.startMs&&moves(o))).map(i=>({code:i.code,startMs:i.startMs,durationMs:i.endMs-i.startMs}));
    const fluidity=measurePlaybackFluidity(plan);
    measurements.push({name,seed:fixture.seed,durationMs:plan.durationMs,staticMs,staticPercent:100*staticMs/plan.durationMs,
      freezes,over200:freezes.filter(f=>f.durationMs>200).length,over300:freezes.filter(f=>f.durationMs>300).length,
      longestMs:Math.max(0,...freezes.map(f=>f.durationMs)),orphans,violations:fluidity.movementViolations,fluidity,
      rebounds:run.trace.filter(e=>e.metrics?.rebound).map(e=>({code:e.code,...e.metrics.rebound})),
      failures:runAssertions(run,plan).findings.filter(f=>!f.pass),
    });
  }
}
const sum=fn=>measurements.reduce((s,m)=>s+fn(m),0),max=fn=>Math.max(0,...measurements.map(fn));
const summary={fixtures:measurements.length,durationMs:sum(m=>m.durationMs),staticMs:sum(m=>m.staticMs),
  over200:sum(m=>m.over200),over300:sum(m=>m.over300),longestMs:max(m=>m.longestMs),
  orphans:sum(m=>m.orphans.length),violations:sum(m=>m.violations.length),
  fullyStaticMs:sum(m=>m.fluidity.fullyStaticMs),liveMs:sum(m=>m.fluidity.liveMs),
  physicalOver200:sum(m=>m.fluidity.freezesOver200Ms),physicalOver300:sum(m=>m.fluidity.freezesOver300Ms),
  physicalLongestMs:max(m=>m.fluidity.longestFreezeMs),physicalOrphans:sum(m=>m.fluidity.orphanedIntervals.length),
  playerStaticMs:sum(m=>m.fluidity.playerStaticMs),longestMassFreezeMs:max(m=>m.fluidity.longestMassFreezeMs),
  velocitySeams:sum(m=>m.fluidity.velocitySeams.length),earlyFinishes:sum(m=>m.fluidity.earlyFinishes.length),
  rebounds:sum(m=>m.rebounds.length)};
summary.fullyStaticPercent=100*summary.fullyStaticMs/summary.liveMs;
summary.staticPercent=100*summary.staticMs/summary.durationMs;
const output=process.argv[2];
if(output&&!output.startsWith('--')){mkdirSync(dirname(output),{recursive:true});writeFileSync(output,JSON.stringify({baseline,summary,measurements},null,2)+'\n');}
console.log(JSON.stringify(summary,null,2));
