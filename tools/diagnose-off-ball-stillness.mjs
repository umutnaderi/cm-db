// "Players freeze except the ball chaser" -- where the stillness comes from.
//
//   node tools/diagnose-off-ball-stillness.mjs [possessions]
//
// Separates the two possible causes, which need different fixes:
//
//   AUTHORED  the engine gave the player a target equal to where they already
//             stand, so there was never any movement to render;
//   UNRENDERED the engine gave them somewhere to go and the rendered track
//             does not take them there.
//
// Reads only. Changes no engine behaviour and consumes no engine RNG.
import "./match-lab-test-environment.mjs";
import { findHistoricalSquad } from "../src/data/historicalSquads.js";
import { specAliases } from "../src/lib/historicalSquadResolver.js";

const { state, runConstructedPossession, applySetup, setupDraft, reassignSetupTeam, pointOf } =
  await import("../match-lab.js");
const { buildMatchLabPlaybackPlan, sampleMatchLabPlaybackPlan } =
  await import("../src/lib/matchLabPlayback.js");

const POSSESSIONS = Number(process.argv[2]) || 24;
const MAX_ACTIONS = 12;
const STILL_YARDS = 0.25;

const SHAPES = [
  ["GK", { goalkeeper: 20 }], ["D R", { defender: 20, "right side": 20, central: 12 }],
  ["D C", { defender: 20, central: 20 }], ["D C", { defender: 20, central: 20 }],
  ["D L", { defender: 20, "left side": 20, central: 12 }],
  ["DM C", { "defensive midfielder": 20, midfielder: 18, central: 20 }],
  ["M C", { midfielder: 20, central: 20 }], ["M L", { midfielder: 20, "left side": 20 }],
  ["M R", { midfielder: 20, "right side": 20 }], ["F C", { attacker: 20, central: 20 }],
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
const yards = (a, b) => Math.hypot((b.x - a.x) * 0.75, (b.y - a.y) * 1.2);

const byAction = {};
// Per-player continuous stillness, in rendered time.
const stillRuns = [];

for (let index = 0; index < POSSESSIONS; index += 1) {
  state.roster = structuredClone(BASE_ROSTER);
  state.pendingRestart = null;
  state.restartSetupDraft = null;
  const owner = state.roster.find((e) => e.id === STARTERS[index % STARTERS.length]);
  state.ball = { ...pointOf(owner), ownerId: owner.id };
  const run = runConstructedPossession(index, { maxActions: MAX_ACTIONS });

  // --- what the engine AUTHORED ---
  for (const event of run.trace) {
    for (const move of event.playerMoves || []) {
      if (!move.from || !move.to) continue;
      const action = move.action || "(none)";
      const row = (byAction[action] ??= { moves: 0, still: 0, distance: 0, intended: 0, intendedStill: 0 });
      const moved = yards(move.from, move.to);
      row.moves += 1;
      row.distance += moved;
      if (moved < STILL_YARDS) row.still += 1;
      // intentionTarget is where the engine WANTED them, before any
      // per-beat fraction was applied. A target equal to the current spot is
      // an authored stand-still; a distant one that produced no movement is
      // something else entirely.
      const intention = move.intentionTarget ?? event.intentionTargets?.[move.playerId];
      if (intention) {
        const wanted = yards(move.from, intention);
        row.intended += wanted;
        if (wanted < STILL_YARDS) row.intendedStill += 1;
      }
    }
  }

  // --- what the renderer SHOWED ---
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
  const outfield = state.roster.filter((e) => e.role !== "keeper");
  const openRun = new Map();
  let previous = sampleMatchLabPlaybackPlan(plan, 0);
  for (let t = 100; t <= plan.durationMs; t += 100) {
    const frame = sampleMatchLabPlaybackPlan(plan, t);
    for (const entry of outfield) {
      const now = frame.players[entry.id];
      const before = previous.players[entry.id];
      if (!now || !before) continue;
      // 0.08 yards per 100ms is 0.8 yd/s -- below a walk. Anything under this
      // is standing still however the numbers wobble.
      if (yards(before, now) < 0.08) {
        const held = openRun.get(entry.id) ?? { ms: 0, ballDistance: 0, samples: 0, slot: entry.positionalSlot };
        held.ms += 100;
        held.ballDistance += yards(now, frame.ball);
        held.samples += 1;
        openRun.set(entry.id, held);
      } else if (openRun.has(entry.id)) {
        stillRuns.push(openRun.get(entry.id));
        openRun.delete(entry.id);
      }
    }
    previous = frame;
  }
  for (const held of openRun.values()) stillRuns.push(held);
}

console.log("Authored off-ball movement, by job\n");
console.log(`  ${"action".padEnd(24)}${"moves".padStart(7)}${"still".padStart(8)}${"mean yd".padStart(9)}${"wanted yd".padStart(11)}${"asked to stand".padStart(16)}`);
const rows = Object.entries(byAction).sort((a, b) => b[1].moves - a[1].moves);
let totalMoves = 0; let totalStill = 0;
for (const [action, row] of rows) {
  totalMoves += row.moves; totalStill += row.still;
  console.log(`  ${action.padEnd(24)}${String(row.moves).padStart(7)}`
    + `${`${((row.still / row.moves) * 100).toFixed(0)}%`.padStart(8)}`
    + `${(row.distance / row.moves).toFixed(2).padStart(9)}`
    + `${(row.intended / Math.max(1, row.moves)).toFixed(2).padStart(11)}`
    + `${`${((row.intendedStill / Math.max(1, row.moves)) * 100).toFixed(0)}%`.padStart(16)}`);
}
console.log(`\n  overall: ${totalStill} of ${totalMoves} authored moves (${((totalStill / totalMoves) * 100).toFixed(1)}%) go nowhere`);

stillRuns.sort((a, b) => a.ms - b.ms);
const lengths = stillRuns.map((r) => r.ms);
const q = (p) => lengths[Math.min(lengths.length - 1, Math.floor(lengths.length * p))] ?? 0;
const over = (ms) => `${((lengths.filter((v) => v >= ms).length / lengths.length) * 100).toFixed(0)}%`;
console.log(`
Rendered stillness -- ${stillRuns.length} continuous still stretches
`);
console.log(`  median ${q(0.5)}ms   p90 ${q(0.9)}ms   longest ${lengths[lengths.length - 1] ?? 0}ms`);
console.log(`  1s+ ${over(1000)}   2s+ ${over(2000)}   3s+ ${over(3000)}`);
console.log(`  total still time: ${(lengths.reduce((s, v) => s + v, 0) / 1000).toFixed(0)}s across all players`);

// Where do the LONG freezes happen? If they cluster far from the ball, the
// cause is players outside the reacting set rather than a rendering fault.
const long = stillRuns.filter((r) => r.ms >= 2000);
if (long.length) {
  const meanBall = long.reduce((sum, r) => sum + r.ballDistance / Math.max(1, r.samples), 0) / long.length;
  const shortOnes = stillRuns.filter((r) => r.ms < 1000);
  const meanBallShort = shortOnes.length
    ? shortOnes.reduce((sum, r) => sum + r.ballDistance / Math.max(1, r.samples), 0) / shortOnes.length : 0;
  console.log(`
  mean distance from the ball during a 2s+ freeze: ${meanBall.toFixed(1)} yd`);
  console.log(`  mean distance from the ball during a sub-1s pause:  ${meanBallShort.toFixed(1)} yd`);
  const bySlot = {};
  for (const r of long) bySlot[r.slot ?? "?"] = (bySlot[r.slot ?? "?"] || 0) + 1;
  console.log(`  2s+ freezes by position: ${Object.entries(bySlot).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join("   ")}`);
}
