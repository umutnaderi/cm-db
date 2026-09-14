// Team height -- does the instruction do what it claims, in a real match?
//
//   node tools/measure-team-height.mjs [possessions]
//
// Two claims to check, both made when the feature was requested:
//
//   1. the declared height actually governs the block's length;
//   2. a lower height costs less, because the side travels as a unit and each
//      player covers less ground of their own.
//
// The second must EMERGE from the movement rather than being asserted:
// motionEffort.js already prices distance actually covered, so if compact play
// does not reduce distance covered then it does not reduce drain either, and
// the claim is wrong.
//
// Reads only. Changes no engine behaviour and consumes no engine RNG.
import "./match-lab-test-environment.mjs";
import { PITCH_LENGTH_YARDS, toYardPoint } from "../src/lib/pitchGeometry.js";
import { findHistoricalSquad } from "../src/data/historicalSquads.js";
import { specAliases } from "../src/lib/historicalSquadResolver.js";

const { state, runConstructedPossession, applySetup, setupDraft, reassignSetupTeam, pointOf } =
  await import("../match-lab.js");
const { buildMatchLabPlaybackPlan, sampleMatchLabPlaybackPlan } =
  await import("../src/lib/matchLabPlayback.js");

const POSSESSIONS = Number(process.argv[2]) || 30;
const MAX_ACTIONS = 12;

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
const BASE_ATTACKING = structuredClone(state.attacking);
const STARTERS = BASE_ROSTER.filter((e) => e.team === "home" && e.role !== "keeper").map((e) => e.id);
const yards = (a, b) => Math.hypot((b.x - a.x) * 0.75, (b.y - a.y) * 1.2);
const depth = (point, direction) => (direction === "up"
  ? PITCH_LENGTH_YARDS - toYardPoint(point).y : toYardPoint(point).y);

function armFor(height) {
  state.roster = structuredClone(BASE_ROSTER);
  state.attacking = structuredClone(BASE_ATTACKING);
  state.attacking.home.height = height;
  state.attacking.away.height = height;
  state.pendingRestart = null;
  state.restartSetupDraft = null;
}

function runArm(height) {
  const lengths = [];
  const distance = { home: 0, away: 0 };
  let players = 0;
  for (let index = 0; index < POSSESSIONS; index += 1) {
    armFor(height);
    const owner = state.roster.find((e) => e.id === STARTERS[index % STARTERS.length]);
    state.ball = { ...pointOf(owner), ownerId: owner.id };
    const run = runConstructedPossession(index, { maxActions: MAX_ACTIONS });
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
    players += outfield.length;
    let previous = sampleMatchLabPlaybackPlan(plan, 0);
    for (let t = 100; t <= plan.durationMs; t += 100) {
      const frame = sampleMatchLabPlaybackPlan(plan, t);
      for (const team of ["home", "away"]) {
        const side = outfield.filter((e) => e.team === team);
        const depths = side.map((e) => frame.players[e.id]).filter(Boolean)
          .map((p) => depth(p, state.attackingDirection[team]));
        if (depths.length > 1) lengths.push(Math.max(...depths) - Math.min(...depths));
        for (const entry of side) {
          const now = frame.players[entry.id];
          const before = previous.players[entry.id];
          if (now && before) distance[team] += yards(before, now);
        }
      }
      previous = frame;
    }
  }
  lengths.sort((a, b) => a - b);
  return {
    medianLength: lengths[Math.floor(lengths.length / 2)] ?? 0,
    meanLength: lengths.reduce((s, v) => s + v, 0) / Math.max(1, lengths.length),
    distancePerPlayer: (distance.home + distance.away) / Math.max(1, players),
    samples: lengths.length,
  };
}

console.log(`Team height -- ${POSSESSIONS} possessions per arm\n`);
console.log(`  ${"height".padEnd(12)}${"target yd".padStart(11)}${"median block".padStart(14)}${"mean block".padStart(12)}${"yd covered / player".padStart(21)}`);
const TARGETS = { compact: 40, balanced: 50, stretched: 62 };
const results = {};
for (const height of ["compact", "balanced", "stretched"]) {
  const row = runArm(height);
  results[height] = row;
  console.log(`  ${height.padEnd(12)}${String(TARGETS[height]).padStart(11)}`
    + `${row.medianLength.toFixed(1).padStart(14)}${row.meanLength.toFixed(1).padStart(12)}`
    + `${row.distancePerPlayer.toFixed(1).padStart(21)}`);
}

console.log("\nClaims\n");
const lengthOrdered = results.compact.medianLength < results.balanced.medianLength
  && results.balanced.medianLength < results.stretched.medianLength;
console.log(`  1. the declared height governs the block length:   ${lengthOrdered ? "HOLDS" : "DOES NOT HOLD"}`);
const cheaper = results.compact.distancePerPlayer < results.stretched.distancePerPlayer;
const delta = ((results.stretched.distancePerPlayer - results.compact.distancePerPlayer)
  / Math.max(1e-9, results.compact.distancePerPlayer)) * 100;
console.log(`  2. a compact block costs less ground per player:   ${cheaper ? "HOLDS" : "DOES NOT HOLD"}`
  + `   (stretched is ${delta.toFixed(1)}% ${delta >= 0 ? "more" : "less"})`);
