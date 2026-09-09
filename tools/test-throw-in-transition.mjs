import assert from 'node:assert/strict';
import './match-lab-test-environment.mjs';
import { state, runConstructedPossession, FREE_PLAY_RESOLVERS, traceEvent, pointOf, zoneFromPercent } from '../match-lab.js';
import { buildMatchLabPlaybackPlan, sampleMatchLabPlaybackPlan } from '../src/lib/matchLabPlayback.js';
import { yardDistance } from '../src/lib/pitchGeometry.js';

const player = { current_ability: 130, attributes: ['Pace', 'Acceleration', 'Anticipation', 'Decisions', 'Technique', 'Passing']
  .map(label => ({ label, value: 13 })) };
const entry = (id, team, positionalSlot, x, y) => ({ id, team, positionalSlot, player,
  role: positionalSlot === 'GK' ? 'keeper' : 'player', x, y, zone: zoneFromPercent(x, y) });

for (const side of ['left', 'right']) {
  const owner = entry('passer', 'home', 'MC', 50, 52);
  const roster = [owner, entry('home-gk', 'home', 'GK', 50, 5), entry('home-d', 'home', 'DC', 45, 28),
    entry('home-f', 'home', 'FC', 55, 76), entry('away-gk', 'away', 'GK', 50, 95),
    entry('away-d', 'away', 'DC', 45, 72), entry('away-m', 'away', 'MC', 52, 58), entry('away-f', 'away', 'FC', 52, 24)];
  state.roster = roster;
  state.ball = { ...pointOf(owner), ownerId: owner.id };
  state.attackingDirection = { home: 'down', away: 'up' };
  const initialPositions = Object.fromEntries(roster.map(p => [p.id, pointOf(p)]));
  const initialRoster = JSON.stringify(roster);
  const originals = { ...FREE_PLAY_RESOLVERS };
  let calls = 0;
  const scripted = (groups, availability, _random, trace) => {
    calls++;
    if (calls === 1) {
      const landing = { x: side === 'left' ? 4 : 96, y: 54, zone: zoneFromPercent(side === 'left' ? 4 : 96, 54) };
      trace.push(traceEvent('P.PASS', 'The delivery runs loose near the touchline', {
        actor: groups.owner, movement: 'pass', outcome: 'neutral', duration: 600,
        ballFrom: pointOf(groups.owner), ballTo: landing, ownerBefore: groups.owner, ownerAfter: null,
        contact: { point: pointOf(groups.owner), actor: groups.owner, type: 'pass', phase: 'start' },
      }));
      return { outcome: 'LOOSE', code: 'P.RECEIVE.LATE', resolved: true, terminal: false, possession: 'loose',
        nextOwnerId: null, ballEnd: landing, ballVelocity: { x: side === 'left' ? -0.012 : 0.012, y: 0 },
        ballVelocityPhase: 'rolling', restart: null, reason: 'unreachable-delivery' };
    }
    if (calls === 2) {
      const target = groups.teammates.find(p => p.id === availability.preselectedTargetId) ?? groups.teammates[0];
      trace.push(traceEvent('P.PASS', 'The throw finds a teammate', {
        actor: groups.owner, movement: 'pass', outcome: 'success', duration: 400,
        ballFrom: pointOf(groups.owner), ballTo: pointOf(target), ownerBefore: groups.owner, ownerAfter: target,
        ownerAfterAt: 'end', contact: { point: pointOf(groups.owner), actor: groups.owner, type: 'pass', phase: 'start' },
      }));
      return { outcome: 'RETAINED', code: 'P.PASS', resolved: true, terminal: false, possession: 'retained',
        nextOwnerId: target.id, ballEnd: pointOf(target), restart: null };
    }
    trace.push(traceEvent('TEST.STOP', 'Later stoppage', { actor: groups.owner, outcome: 'neutral',
      duration: 0, ownerBefore: groups.owner, ownerAfter: null, restart: 'indirect-free-kick' }));
    return { outcome: 'STOP', code: 'TEST.STOP', resolved: true, terminal: true, possession: 'dead',
      nextOwnerId: null, ballEnd: pointOf(groups.owner), restart: 'indirect-free-kick' };
  };
  let run;
  try {
    for (const key of Object.keys(FREE_PLAY_RESOLVERS)) FREE_PLAY_RESOLVERS[key] = scripted;
    run = runConstructedPossession(`throw-in-transition-${side}`);
  } finally { Object.assign(FREE_PLAY_RESOLVERS, originals); }
  const plan = buildMatchLabPlaybackPlan({ trace: run.trace, initialPositions, initialBall: pointOf(owner),
    initialOwnerId: owner.id, finalOwnerId: run.finalOwnerId, restart: run.result.restart,
    playerProfiles: Object.fromEntries(roster.map(p => [p.id, p.player])) });
  const exit = plan.intervals.find(i => i.code === 'RESTART.THROW_IN');
  const setup = plan.intervals.find(i => i.code === 'RESTART.SETUP');
  const take = plan.intervals.find(i => i.code === 'RESTART.THROW_IN.TAKE');
  assert(exit && setup && take, 'the live loose-ball race must lead to a real throw-in');
  assert(setup.startMs - exit.endMs >= 900, 'restart setup must wait after the ball reaches the boundary');
  const out = sampleMatchLabPlaybackPlan(plan, setup.startMs - 100);
  assert(side === 'left' ? out.ball.x < -0.3 : out.ball.x > 100.3, 'the ball must visibly cross the touchline');
  assert.equal(out.ownerId, null);
  assert.equal(out.restart, 'throw-in');
  const beforeExit = sampleMatchLabPlaybackPlan(plan, exit.endMs - 1);
  for (const p of roster) assert(yardDistance(beforeExit.players[p.id], initialPositions[p.id]) < 0.01,
    'a player with no committed job must not anticipate a restart layout before the ball leaves');
  assert(!run.trace.slice(exit.eventIndex + 1, setup.eventIndex).some(e => ['ATT.ADJUST', 'DEF.ADJUST', 'GK.ADJUST'].includes(e.code)),
    'the stoppage must not generate an open-play reshuffle');
  assert(take.startMs >= setup.endMs);
  const placement = run.trace[setup.eventIndex], throwEvent = run.trace[take.eventIndex];
  assert.equal(placement.ballTo.x, side === 'left' ? 0 : 100, 'the throw still belongs at the legal boundary spot');
  assert.equal(placement.ballTo.x, throwEvent.ballFrom.x);
  assert.equal(placement.ballTo.y, throwEvent.ballFrom.y);
  assert(plan.intervals.flatMap(i => i.moveDiagnostics ?? []).every(d => d.withinPhysicalLimit !== false));
  assert.equal(JSON.stringify(roster), initialRoster);
  console.log(`PASS ${side}: ball crosses, setup waits ${setup.startMs - exit.endMs} ms, legal throw follows`);
}
