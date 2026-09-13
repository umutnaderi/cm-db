// Realism Roadmap Stage 1b -- the parity reference.
//
//   node tools/measure-possession-parity.mjs audit/parity/before.json
//   node tools/measure-possession-parity.mjs audit/parity/after.json --compare audit/parity/before.json
//
// "Migrate rather than rewrite: keep the original code path as a parity
// reference and prove agreement with an A/B sweep" is a standing rule of the
// engine roadmap. This is that sweep, for any change that is supposed to
// leave existing play alone: it hashes the full trace of a fixed set of
// possessions so a single altered event anywhere shows up as a changed digest.
//
// It drives the engine and reads what comes back. It changes nothing.
import "./match-lab-test-environment.mjs";
import { createHash } from "node:crypto";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { findHistoricalSquad } from "../src/data/historicalSquads.js";
import { specAliases } from "../src/lib/historicalSquadResolver.js";

const {
  state, runConstructedPossession, applySetup, setupDraft, reassignSetupTeam, pointOf,
} = await import("../match-lab.js");

const OUT = process.argv[2] || "";
const compareIndex = process.argv.indexOf("--compare");
const COMPARE = compareIndex >= 0 ? process.argv[compareIndex + 1] : "";
const POSSESSIONS = 40;
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
      database_slug: squad.database,
      source_person_id: `${squadKey}-${index}`,
      canonical_player_name: specAliases(spec)[0] ?? `player-${index}`,
      position_text: positionText,
      current_ability: 160 - index,
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
if (await applySetup() === false) throw new Error("parity sweep could not apply a match setup");

const BASE_ROSTER = structuredClone(state.roster);
const STARTERS = BASE_ROSTER.filter((entry) => entry.team === "home" && entry.role !== "keeper").map((entry) => entry.id);

/**
 * Only the fields that describe what HAPPENED. Diagnostics, evidence blobs
 * and coordination snapshots are deliberately excluded: they change whenever
 * observability improves, which is not a behavioural change and should not
 * fail a parity sweep.
 */
function digestTrace(trace) {
  return (trace || []).map((event) => [
    event.code, event.outcome, event.movement,
    event.ballFrom && `${event.ballFrom.x.toFixed(4)},${event.ballFrom.y.toFixed(4)}`,
    event.ballTo && `${event.ballTo.x.toFixed(4)},${event.ballTo.y.toFixed(4)}`,
    event.ownerAfterId ?? event.ownerAfter?.id ?? "",
    Number(event.duration) || 0,
    (event.playerMoves || []).map((move) =>
      `${move.playerId ?? move.player?.id}:${move.action}:${move.to ? `${move.to.x.toFixed(4)},${move.to.y.toFixed(4)}` : ""}`).join("|"),
  ].join("~")).join("\n");
}

const rows = [];
for (let index = 0; index < POSSESSIONS; index += 1) {
  state.roster = structuredClone(BASE_ROSTER);
  state.pendingRestart = null;
  state.restartSetupDraft = null;
  const owner = state.roster.find((entry) => entry.id === STARTERS[index % STARTERS.length]);
  state.ball = { ...pointOf(owner), ownerId: owner.id };
  const run = runConstructedPossession(index, { maxActions: MAX_ACTIONS });
  const body = digestTrace(run.trace);
  rows.push({
    index,
    events: run.trace.length,
    actions: run.actionsCount,
    outcome: run.result?.outcome ?? null,
    finalOwnerId: run.finalOwnerId ?? null,
    digest: createHash("sha256").update(body).digest("hex").slice(0, 16),
    firstTimeEvents: run.trace.filter((event) => String(event.code || "").includes("FIRSTTIME")).length,
  });
}

// --- where and when releases actually happen -------------------------------
// The acceptance question Stage 1b names: real football plays a substantial
// share of balls first time in build-up and the final third, and a much
// smaller share in unpressured midfield. A flat distribution would mean the
// preference terms are not doing their job even if the rate looks plausible.
const releases = [];
for (let index = 0; index < POSSESSIONS; index += 1) {
  state.roster = structuredClone(BASE_ROSTER);
  state.pendingRestart = null;
  state.restartSetupDraft = null;
  const owner = state.roster.find((entry) => entry.id === STARTERS[index % STARTERS.length]);
  state.ball = { ...pointOf(owner), ownerId: owner.id };
  const run = runConstructedPossession(index, { maxActions: MAX_ACTIONS });
  for (const event of run.trace) {
    if (event.code !== "P.RECEIVE.FIRSTTIME") continue;
    const metrics = event.metrics.firstTime;
    // Progress toward the goal being attacked, 0 (own goal line) to 1.
    const progress = metrics.attackingDirection === "up"
      ? (100 - event.ballFrom.y) / 100
      : event.ballFrom.y / 100;
    releases.push({
      kind: metrics.kind,
      third: progress < 1 / 3 ? "defensive" : progress < 2 / 3 ? "middle" : "final",
      pressure: metrics.pressure01 < 0.2 ? "free" : metrics.pressure01 < 0.5 ? "contested" : "tight",
    });
  }
}
if (releases.length) {
  const tally = (key) => releases.reduce((counts, release) => {
    counts[release[key]] = (counts[release[key]] || 0) + 1;
    return counts;
  }, {});
  const show = (label, counts) => console.log(`  ${label.padEnd(10)} `
    + Object.entries(counts).sort((a, b) => b[1] - a[1])
      .map(([name, count]) => `${name} ${count} (${Math.round((count / releases.length) * 100)}%)`).join("   "));
  console.log(`\nFirst-time releases: ${releases.length}`);
  show("by third", tally("third"));
  show("by pressure", tally("pressure"));
  show("by kind", tally("kind"));
}

const summary = {
  possessions: rows.length,
  totalEvents: rows.reduce((sum, row) => sum + row.events, 0),
  totalFirstTime: rows.reduce((sum, row) => sum + row.firstTimeEvents, 0),
  overall: createHash("sha256").update(rows.map((row) => row.digest).join("")).digest("hex").slice(0, 16),
  rows,
};

console.log(`possessions ${summary.possessions}  events ${summary.totalEvents}  first-time ${summary.totalFirstTime}  overall ${summary.overall}`);

if (COMPARE) {
  const before = JSON.parse(readFileSync(COMPARE, "utf8"));
  const changed = summary.rows.filter((row, index) => row.digest !== before.rows[index]?.digest);
  console.log(`\nParity vs ${COMPARE}`);
  console.log(`  identical possessions: ${summary.rows.length - changed.length} / ${summary.rows.length}`);
  console.log(`  first-time events:     ${before.totalFirstTime} -> ${summary.totalFirstTime}`);
  if (changed.length) {
    console.log(`  changed: ${changed.map((row) => `#${row.index}(ft=${row.firstTimeEvents})`).join(" ")}`);
    const withoutFirstTime = changed.filter((row) => row.firstTimeEvents === 0);
    console.log(withoutFirstTime.length
      ? `  UNEXPLAINED (changed with no first-time event): ${withoutFirstTime.map((row) => `#${row.index}`).join(" ")}`
      : "  every changed possession contains a first-time release -- no unexplained drift");
  }
}

if (OUT) {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(summary, null, 2));
  console.log(`Wrote ${OUT}`);
}
