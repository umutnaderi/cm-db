// Diagnostic for two reported defects, measured rather than eyeballed.
//
//   node tools/diagnose-keeper-and-stillness.mjs
//
// 1. "Goalkeeper positioning is bad -- unnecessary rushing out leaves the goal
//    open, and he is not on his line even when the trace says he is."
// 2. "Players freeze except the ball chaser."
//
// Reads only. No engine behaviour is changed and no engine RNG is consumed.
import "./match-lab-test-environment.mjs";
import { toYardPoint, PITCH_LENGTH_YARDS } from "../src/lib/pitchGeometry.js";
import { keeperPositioningPoint } from "../src/lib/spatialDecision.js";
import { findHistoricalSquad } from "../src/data/historicalSquads.js";
import { specAliases } from "../src/lib/historicalSquadResolver.js";

const {
  state, runConstructedPossession, applySetup, setupDraft, reassignSetupTeam, pointOf,
} = await import("../match-lab.js");
const { buildMatchLabPlaybackPlan, sampleMatchLabPlaybackPlan } = await import("../src/lib/matchLabPlayback.js");

const POSSESSIONS = Number(process.argv[2]) || 24;
const MAX_ACTIONS = 12;

const SHAPES = [
  ["GK", { goalkeeper: 20 }],
  ["D R", { defender: 20, "right side": 20, central: 12 }],
  ["D C", { defender: 20, central: 20 }],
  ["D C", { defender: 20, central: 20 }],
  ["D L", { defender: 20, "left side": 20, central: 12 }],
  ["DM C", { "defensive midfielder": 20, midfielder: 18, central: 20 }],
  ["M C", { midfielder: 20, central: 20 }],
  ["M L", { midfielder: 20, "left side": 20 }],
  ["M R", { midfielder: 20, "right side": 20 }],
  ["F C", { attacker: 20, central: 20 }],
  ["F C", { attacker: 20, central: 20 }],
];
function seedSquad(team, squadKey) {
  const squad = findHistoricalSquad(squadKey);
  const players = squad.players.map((spec, index) => {
    const [positionText, ratings] = SHAPES[index] ?? SHAPES[10];
    return {
      database_slug: squad.database, source_person_id: `${squadKey}-${index}`,
      canonical_player_name: specAliases(spec)[0] ?? `player-${index}`,
      position_text: positionText, current_ability: 160 - index,
      position_ratings: Object.entries(ratings).map(([label, value]) => ({ label, value })),
    };
  });
  state.resolvedSquads.set(squadKey, { players, squad });
  setupDraft()[team].squadKey = squadKey;
  reassignSetupTeam(team);
}

state.mode = "freeplay";
seedSquad("home", "titan-brazil-2002");
seedSquad("away", "titan-france-2000");
if (await applySetup() === false) throw new Error("could not apply a match setup");

const BASE_ROSTER = structuredClone(state.roster);
const STARTERS = BASE_ROSTER.filter((e) => e.team === "home" && e.role !== "keeper").map((e) => e.id);

/** Yards from a keeper's OWN goal line. Their own goal is the far end. */
function yardsOffLine(point, keeperAttackingDirection) {
  const y = toYardPoint(point).y;
  return keeperAttackingDirection === "up" ? PITCH_LENGTH_YARDS - y : y;
}

const keeperSamples = [];
const keeperActions = {};
const stillness = { frames: 0, movingPlayers: 0, ballMovingFrames: 0, movingWhileBallMoves: 0 };

for (let index = 0; index < POSSESSIONS; index += 1) {
  state.roster = structuredClone(BASE_ROSTER);
  state.pendingRestart = null;
  state.restartSetupDraft = null;
  const owner = state.roster.find((e) => e.id === STARTERS[index % STARTERS.length]);
  state.ball = { ...pointOf(owner), ownerId: owner.id };
  const run = runConstructedPossession(index, { maxActions: MAX_ACTIONS });

  // What the engine ASKED each keeper to do.
  for (const event of run.trace) {
    for (const move of event.playerMoves || []) {
      const entry = state.roster.find((e) => String(e.id) === String(move.playerId ?? move.player?.id));
      if (entry?.role === "keeper" && move.action) {
        keeperActions[move.action] = (keeperActions[move.action] || 0) + 1;
      }
    }
  }

  // Where each keeper actually STOOD, sampled off the rendered plan.
  let plan;
  try {
    plan = buildMatchLabPlaybackPlan({
      trace: run.trace,
      initialPositions: Object.fromEntries(state.roster.map((e) => [e.id, pointOf(e)])),
      initialBall: { ...state.ball }, initialOwnerId: state.ball.ownerId,
      finalOwnerId: run.finalOwnerId, restart: run.result?.restart,
      playerProfiles: Object.fromEntries(state.roster.map((e) => [String(e.id), e.player])),
    });
  } catch { continue; }

  const keepers = state.roster.filter((e) => e.role === "keeper");
  let previous = sampleMatchLabPlaybackPlan(plan, 0);
  for (let t = 100; t <= plan.durationMs; t += 100) {
    const frame = sampleMatchLabPlaybackPlan(plan, t);
    for (const keeper of keepers) {
      const point = frame.players[keeper.id];
      if (!point) continue;
      // What the engine would ASK for at this instant, so "wrong target" and
      // "never reaches the target" can be told apart.
      const ideal = keeperPositioningPoint(frame.ball, state.attackingDirection[keeper.team], {
        defenders: state.roster.filter((e) => e.team === keeper.team && e.role !== "keeper"),
        sweeping: keeper.goalkeeperSweeping ?? "balanced",
      });
      keeperSamples.push({
        idealOffLine: yardsOffLine(ideal, state.attackingDirection[keeper.team]),
        offLine: yardsOffLine(point, state.attackingDirection[keeper.team]),
        // Distance from the keeper's OWN GOAL, not from the keeper. This is
        // what decides whether he is under threat; distance from the keeper
        // himself conflates "ball is far away" with "keeper has wandered".
        ballFromGoal: yardsOffLine(frame.ball, state.attackingDirection[keeper.team]),
      });
    }
    // Stillness: how many outfielders are genuinely moving while the ball is.
    const ballMoved = Math.hypot(
      (frame.ball.x - previous.ball.x) * 0.75, (frame.ball.y - previous.ball.y) * 1.2,
    ) > 0.05;
    const outfield = state.roster.filter((e) => e.role !== "keeper");
    const moving = outfield.filter((e) => {
      const now = frame.players[e.id];
      const before = previous.players[e.id];
      return now && before && Math.hypot((now.x - before.x) * 0.75, (now.y - before.y) * 1.2) > 0.05;
    }).length;
    stillness.frames += 1;
    stillness.movingPlayers += moving;
    if (ballMoved) { stillness.ballMovingFrames += 1; stillness.movingWhileBallMoves += moving; }
    previous = frame;
  }
}

// --- keeper -----------------------------------------------------------------
// Split by how far the ball is from the keeper's OWN goal. Aggregating across
// both keepers hides the only question that matters: a keeper whose team is
// attacking SHOULD be sweeping high, and a keeper under threat should not be.
const BANDS = [
  ["ball inside 18yd  (under threat)", (s) => s.ballFromGoal <= 18],
  ["ball 18-35yd      (shot range)", (s) => s.ballFromGoal > 18 && s.ballFromGoal <= 35],
  ["ball 35-60yd      (midfield)", (s) => s.ballFromGoal > 35 && s.ballFromGoal <= 60],
  ["ball 60yd+        (team attacking)", (s) => s.ballFromGoal > 60],
];
console.log(`Keeper positioning -- ${keeperSamples.length} samples
`);
for (const [label, predicate] of BANDS) {
  const rows = keeperSamples.filter(predicate).map((s) => s.offLine).sort((a, b) => a - b);
  if (!rows.length) { console.log(`  ${label.padEnd(36)} (no samples)`); continue; }
  const q = (p) => rows[Math.min(rows.length - 1, Math.floor(rows.length * p))];
  const beyond = (y) => `${((rows.filter((v) => v > y).length / rows.length) * 100).toFixed(0)}%`;
  const ideals = keeperSamples.filter(predicate).map((s) => s.idealOffLine).sort((a, b) => a - b);
  const qi = (p) => ideals[Math.min(ideals.length - 1, Math.floor(ideals.length * p))];
  console.log(`  ${label.padEnd(36)} n=${String(rows.length).padStart(5)}`
    + `   actual ${q(0.5).toFixed(1).padStart(5)}   asked ${qi(0.5).toFixed(1).padStart(5)}`
    + `   >6yd ${beyond(6).padStart(4)}   >12yd ${beyond(12).padStart(4)}`);
}
console.log(`
  jobs the engine gave keepers:`);
for (const [action, count] of Object.entries(keeperActions).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${action.padEnd(22)} ${count}`);
}

// --- stillness --------------------------------------------------------------
const outfieldCount = BASE_ROSTER.filter((e) => e.role !== "keeper").length;
console.log(`\nStillness -- ${stillness.frames} sampled frames, ${outfieldCount} outfielders\n`);
console.log(`  mean outfielders moving per frame:              ${(stillness.movingPlayers / stillness.frames).toFixed(2)} of ${outfieldCount}`);
console.log(`  mean moving while the ball is also moving:      ${(stillness.movingWhileBallMoves / Math.max(1, stillness.ballMovingFrames)).toFixed(2)} of ${outfieldCount}`);
console.log(`  share of the squad in motion during live play:  ${((stillness.movingWhileBallMoves / Math.max(1, stillness.ballMovingFrames)) / outfieldCount * 100).toFixed(1)}%`);
