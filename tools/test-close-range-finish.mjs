import assert from 'node:assert/strict';
import './match-lab-test-environment.mjs';
import { state, resolveDribble, resolveShoot, reactOffBallContinuous, applyOffBallSeparation, pointOf } from '../match-lab.js';
import { seededRandom } from '../src/lib/matchEngineCore.js';
import { assessKeeperCloseDown, planKeeperResponse } from '../src/lib/keeperDecision.js';
import { buildMatchLabPlaybackPlan, sampleMatchLabPlaybackPlan } from '../src/lib/matchLabPlayback.js';
import { yardDistance, PITCH_WIDTH_YARDS, PITCH_LENGTH_YARDS, GOAL_WIDTH_YARDS } from '../src/lib/pitchGeometry.js';
import { velocityAlong } from '../src/lib/worldMotion.js';

const profile = (rating) => ({ attributes: ['Pace', 'Acceleration', 'Agility', 'Dribbling', 'Technique',
  'Anticipation', 'Decisions', 'Positioning', 'Tackling', 'Balance', 'Strength', 'Bravery',
  'Composure', 'Finishing', 'Handling', 'Reflexes', 'Teamwork'].map(label => ({ label, value: rating })) });
const entry = (id, x, y, team, role = 'outfield', rating = 16) => ({ id, x, y, team, role, zone: 1, player: profile(rating) });
const context = () => ({ seed: 9, state: { players: {} }, marking: {}, teamShapeJobs: {}, shapeSnapshots: [], simulationTimeMs: 0 });
const failures = [];
const check = (label, fn) => { try { fn(); console.log(`PASS ${label}`); } catch (error) { failures.push(error); console.error(`FAIL ${label}: ${error.message}`); } };

for (const direction of ['down', 'up']) {
  const y = value => direction === 'down' ? value : 100 - value;
  const keeper = entry('keeper', 50, y(1), 'away', 'keeper');
  const attacker = entry('owen', 50, y(5), 'home');
  const trailing = entry('beaten', 51, y(6.5), 'away');
  const args = { keeper, ball: attacker, attacker, defenders: [trailing], defendingDirection: direction };
  check(`${direction}: a beaten defender behind the striker does not prevent closing`, () => {
    const assessment = assessKeeperCloseDown(args);
    assert(assessment.eligible);
    assert.equal(assessment.isolated, false, 'the pursuer can still pressure the shot without covering the goal');
    assert.equal(assessment.recoveryDefenderId, null);
    assert.equal(assessment.laneDefenderId, null);
  });
  check(`${direction}: close-range target covers the narrowing cone`, () => {
    const response = planKeeperResponse({ ...args, defenders: [] });
    assert.equal(response.action, 'keeper-close-down');
    assert(yardDistance(response.target, attacker) < 3, 'keeper should set within three yards at a six-yard shot');
    assert(yardDistance(response.target, attacker) > 1, 'the target must leave space to set, not overlap the ball');
    assert(y(response.target.y) > 2 && y(response.target.y) < 5);
  });
  check(`${direction}: a defender still between ball and goal remains cover`, () => {
    assert(!assessKeeperCloseDown({ ...args, defenders: [entry('screen', 50, y(3), 'away')] }).eligible);
  });
  check(`${direction}: an off-centre close-down bisects the angle to both posts`, () => {
    const ball = { ...attacker, x: 58, y: y(8) };
    const response = planKeeperResponse({ ...args, ball, attacker: ball, defenders: [] });
    assert.equal(response.action, 'keeper-close-down');
    const vector = point => [(point.x - ball.x) * PITCH_WIDTH_YARDS / 100,
      (point.y - ball.y) * PITCH_LENGTH_YARDS / 100];
    const toKeeper = vector(response.target);
    const angle = post => {
      const ray = vector(post);
      return Math.acos((ray[0] * toKeeper[0] + ray[1] * toKeeper[1]) / (Math.hypot(...ray) * Math.hypot(...toKeeper)));
    };
    const halfGoalPct = GOAL_WIDTH_YARDS / PITCH_WIDTH_YARDS * 50;
    assert(Math.abs(angle({ x: 50 - halfGoalPct, y: y(0) })
      - angle({ x: 50 + halfGoalPct, y: y(0) })) < 1e-7);
  });
}

state.attackingDirection = { home: 'up', away: 'down' };
check('tactical spacing cannot displace the keeper from a closing angle', () => {
  const keeper = entry('keeper', 50, 1, 'away', 'keeper');
  const defender = entry('defender', 55, 12, 'away');
  const target = { x: 50, y: 6 };
  const spaced = applyOffBallSeparation([
    { id: keeper.id, role: 'keeper', action: 'keeper-close-down', from: keeper, target },
    { id: defender.id, role: 'defender', action: 'recovery-track', from: defender, target: { x: 52, y: 6 } },
  ], [keeper, defender]);
  assert(yardDistance(spaced.find(p => p.id === keeper.id).target, target) < 0.01);
});
check('live carry: the keeper leaves the line while a beaten defender pursues', () => {
  const owner = entry('owen', 50, 15, 'home');
  const keeper = entry('cesar', 50, 1, 'away', 'keeper');
  const groups = { owner, keeper, teammates: [], opponents: [entry('beaten', 52, 18, 'away')] };
  const initial = pointOf(keeper), trace = [];
  reactOffBallContinuous(groups, owner, { x: 50, y: 7 }, 1500, trace, { motionContext: context() });
  const moves = trace.flatMap(event => event.playerMoves ?? []).filter(move => move.playerId === keeper.id);
  assert(moves.some(move => move.action === 'keeper-close-down'));
  assert(keeper.y > initial.y + 2, 'closing intent must produce real forward movement');
});

check('dribble-to-shot: the strike starts when the actual run ends', () => {
  const owner = entry('owen', 48, 12, 'home', 'outfield', 19);
  const defender = entry('helguera', 50, 10, 'away', 'outfield', 8);
  const keeper = entry('cesar', 50, 1, 'away', 'keeper');
  const groups = { owner, keeper, teammates: [], opponents: [defender] };
  const roster = [owner, defender, keeper];
  const initialPositions = Object.fromEntries(roster.map(p => [p.id, pointOf(p)]));
  const playerProfiles = Object.fromEntries(roster.map(p => [p.id, p.player]));
  const motionContext = context();
  motionContext.state.players[owner.id] = { velocity: velocityAlong(owner, { x: 48, y: 0 }, 7), lastPosition: pointOf(owner) };
  const trace = [];
  const result = resolveDribble(groups, {}, () => 0, trace, true, motionContext);
  assert.equal(result.code, 'P.PROGRESS.WON');
  Object.assign(owner, result.ballEnd);
  resolveShoot(groups, {}, seededRandom(7), trace);
  const plan = buildMatchLabPlaybackPlan({ trace, initialPositions, playerProfiles,
    initialBall: initialPositions.owen, initialOwnerId: owner.id });
  const run = plan.intervals.find(i => i.code === 'P.PROGRESS.WON');
  const strike = plan.intervals.find(i => trace[i.eventIndex].contact?.type === 'shot');
  assert(run && strike);
  console.log(JSON.stringify({ runEndMs: run.endMs, strikeMs: strike.startMs, idleMs: strike.startMs - run.endMs }));
  assert.equal(strike.startMs, run.endMs, 'no reserved idle time between beating the defender and striking');
  const before = sampleMatchLabPlaybackPlan(plan, Math.max(0, strike.startMs - 100));
  const atStrike = sampleMatchLabPlaybackPlan(plan, strike.startMs);
  assert(yardDistance(before.players.owen, atStrike.players.owen) > 0.1, 'Owen must still move in the final 100 ms before striking');
  assert(yardDistance(atStrike.players.owen, trace[strike.eventIndex].contact.point) < 0.01);
  assert(plan.intervals.flatMap(i => i.moveDiagnostics ?? []).every(d => d.withinPhysicalLimit !== false));
});

assert.equal(failures.length, 0, `${failures.length} close-range finish regressions failed`);
