// Deterministic pass-mix report.
//
//   node tools/report-pass-delivery-mix.mjs
//   node tools/report-pass-delivery-mix.mjs --json audit/pass-mix/current.json
//   node tools/report-pass-delivery-mix.mjs --possessions 120
//
// MEASUREMENT ONLY. This tool tunes nothing: no selector constant, no decision
// weight, no accuracy, interception or completion probability is touched or
// read for modification. It drives seeded possessions through the current
// engine and reports what the pass mix actually was.
//
// Determinism: the setup, the starting owners and the seeds are all fixed, so
// two runs at the same `--possessions` produce byte-identical JSON. Nothing
// here consumes engine RNG of its own.
import "./match-lab-test-environment.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { yardDistance, toYardPoint } from "../src/lib/pitchGeometry.js";
import { playerAttribute } from "../src/lib/matchEngineCore.js";
import { findHistoricalSquad } from "../src/data/historicalSquads.js";
import { specAliases } from "../src/lib/historicalSquadResolver.js";

const {
  state, runConstructedPossession, applySetup, setupDraft, reassignSetupTeam, pointOf,
} = await import("../match-lab.js");

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const POSSESSIONS = Math.max(4, Number(flag("possessions", 80)) || 80);
const MAX_ACTIONS = Math.max(3, Number(flag("actions", 12)) || 12);
const JSON_OUT = flag("json", "");

// --- classification ---------------------------------------------------------

/** Distance bands, as specified. Upper bound exclusive except the last. */
const DISTANCE_BANDS = Object.freeze([
  { label: "0-15", min: 0, max: 15 },
  { label: "15-30", min: 15, max: 30 },
  { label: "30-35", min: 30, max: 35 },
  { label: "35-50", min: 35, max: 50 },
  { label: "50+", min: 50, max: Infinity },
]);
function distanceBand(distanceYards) {
  return DISTANCE_BANDS.find((band) => distanceYards >= band.min && distanceYards < band.max)?.label ?? "50+";
}

/**
 * selectPassType() itself treats exactly two intents as "not into space"
 * (`current-position` and `to-feet`); every other meeting-point kind is an
 * into-space delivery. Mirroring that split here rather than enumerating the
 * kinds keeps this report correct when the candidate vocabulary grows.
 */
const TO_FEET_INTENTS = Object.freeze(new Set(["current-position", "to-feet"]));
const isIntoSpace = (intent) => !TO_FEET_INTENTS.has(String(intent ?? "current-position"));

/** A ball that never leaves the turf. Both of these have zero peak height. */
const GROUND_TYPES = Object.freeze(new Set(["ground", "driven-ground"]));

/**
 * Passer tier from the attributes that decide how a ball can be struck.
 *
 * NOT the engine's own powerBlend() -- that function is internal to
 * matchPassFlight.js and is not exported, and this tool may not edit that
 * file. This is an independent tier over the same raw inputs, reported as
 * such. See the handoff note: exporting powerBlend() would let this column
 * report the engine's real value instead of a parallel one.
 */
function passerTier(player) {
  const blend = (playerAttribute(player, "Passing") * 0.5
    + playerAttribute(player, "Technique") * 0.3
    + playerAttribute(player, "Strength") * 0.2) / 20;
  if (blend >= 0.8) return "elite";
  if (blend >= 0.65) return "strong";
  if (blend >= 0.5) return "average";
  return "limited";
}

/**
 * Opponents genuinely standing in the lane.
 *
 * Also NOT the engine's laneObstruction() -- same reason as above. This counts
 * bodies inside a two-yard corridor between the endpoints, which is a plain,
 * checkable geometric fact rather than an attempt to reproduce the engine's
 * scoring.
 */
const LANE_CORRIDOR_YARDS = 2;
function laneOccupancy(from, to, opponents) {
  const start = toYardPoint(from);
  const end = toYardPoint(to);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const lengthSquared = dx * dx + dy * dy;
  if (!(lengthSquared > 0)) return 0;
  let count = 0;
  for (const opponent of opponents) {
    const point = toYardPoint(opponent);
    const t = ((point.x - start.x) * dx + (point.y - start.y) * dy) / lengthSquared;
    if (t <= 0 || t >= 1) continue;
    const perpendicular = Math.hypot(
      point.x - (start.x + t * dx), point.y - (start.y + t * dy),
    );
    if (perpendicular <= LANE_CORRIDOR_YARDS) count += 1;
  }
  return count;
}
const laneBand = (count) => (count === 0 ? "clear" : count === 1 ? "contested" : "crowded");

// --- setup ------------------------------------------------------------------
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
if (await applySetup() === false) throw new Error("pass-mix report could not apply a match setup");

const BASE_ROSTER = structuredClone(state.roster);
const STARTERS = BASE_ROSTER.filter((entry) => entry.team === "home" && entry.role !== "keeper").map((entry) => entry.id);

// --- harvest ----------------------------------------------------------------

/**
 * Positions at each event, rebuilt by walking the trace's own authoritative
 * moves forward from the applied roster.
 *
 * This is reading, not simulating: it replays moves the engine already
 * committed, in the order it committed them, which is the same thing
 * commitAuthoritativeMoves() does inside a possession. Opponent geometry at
 * kick time is not otherwise recoverable from a finished trace.
 */
function harvestPasses(run, roster) {
  const live = new Map(roster.map((entry) => [String(entry.id), { ...entry }]));
  const passes = [];
  for (const event of run.trace) {
    if (event.movement === "pass" && event.ballFrom && event.ballTo) {
      const flight = event.metrics?.passFlight;
      const passer = live.get(String(event.actorId));
      if (flight && passer) {
        const opponents = [...live.values()].filter((entry) => entry.team !== passer.team);
        const distanceYards = Number(flight.distanceYards)
          || yardDistance(event.ballFrom, event.ballTo);
        const occupancy = laneOccupancy(event.ballFrom, event.ballTo, opponents);
        passes.push({
          passType: flight.passType,
          intent: flight.deliveryIntent ?? "current-position",
          intoSpace: isIntoSpace(flight.deliveryIntent),
          distanceYards,
          band: distanceBand(distanceYards),
          tier: passerTier(passer.player),
          laneOccupancy: occupancy,
          lane: laneBand(occupancy),
          // Lateral direction of travel across the pitch. Symmetry here is a
          // bias check: a healthy engine has no preferred side.
          side: event.ballTo.x === event.ballFrom.x
            ? "straight" : event.ballTo.x > event.ballFrom.x ? "right" : "left",
          onGround: GROUND_TYPES.has(flight.passType),
          peakHeightYards: Number(flight.peakHeightYards) || 0,
        });
      }
    }
    for (const move of event.playerMoves || []) {
      if (move.authoritative === false || !move.to) continue;
      const entry = live.get(String(move.playerId ?? move.player?.id));
      if (entry) Object.assign(entry, move.to);
    }
  }
  return passes;
}

const passes = [];
for (let index = 0; index < POSSESSIONS; index += 1) {
  state.roster = structuredClone(BASE_ROSTER);
  state.pendingRestart = null;
  state.restartSetupDraft = null;
  const owner = state.roster.find((entry) => entry.id === STARTERS[index % STARTERS.length]);
  state.ball = { ...pointOf(owner), ownerId: owner.id };
  const run = runConstructedPossession(index, { maxActions: MAX_ACTIONS });
  passes.push(...harvestPasses(run, state.roster));
}

// --- invariants -------------------------------------------------------------
// Both are specified as failures, not observations: a long or into-space ball
// drilled along the turf is the defect this report exists to catch.
const INTO_SPACE_GROUND_MIN_YARDS = 30;
const ANY_GROUND_MAX_YARDS = 35;
const violations = passes.filter((pass) => pass.onGround && (
  (pass.intoSpace && pass.distanceYards >= INTO_SPACE_GROUND_MIN_YARDS)
  || pass.distanceYards > ANY_GROUND_MAX_YARDS
)).map((pass) => ({
  rule: pass.distanceYards > ANY_GROUND_MAX_YARDS
    ? `ground pass beyond ${ANY_GROUND_MAX_YARDS} yards`
    : `into-space ground pass at or beyond ${INTO_SPACE_GROUND_MIN_YARDS} yards`,
  passType: pass.passType,
  intent: pass.intent,
  distanceYards: Number(pass.distanceYards.toFixed(2)),
}));

// --- aggregate --------------------------------------------------------------
function tally(rows, key) {
  const counts = {};
  for (const row of rows) counts[String(row[key])] = (counts[String(row[key])] || 0) + 1;
  // Sorted by key so the JSON is stable regardless of encounter order.
  return Object.fromEntries(Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])));
}
function crossTab(rows, rowKey, colKey) {
  const table = {};
  for (const row of rows) {
    const outer = (table[String(row[rowKey])] ??= {});
    outer[String(row[colKey])] = (outer[String(row[colKey])] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(table).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, counts]) => [name, Object.fromEntries(Object.entries(counts).sort((a, b) => a[0].localeCompare(b[0])))]));
}

const left = passes.filter((pass) => pass.side === "left").length;
const right = passes.filter((pass) => pass.side === "right").length;
const report = {
  possessions: POSSESSIONS,
  maxActions: MAX_ACTIONS,
  passes: passes.length,
  byDistanceBand: tally(passes, "band"),
  byIntent: tally(passes, "intent"),
  byDelivery: tally(passes, "passType"),
  byPasserTier: tally(passes, "tier"),
  byLaneBand: tally(passes, "lane"),
  intoSpaceShare: passes.length ? passes.filter((pass) => pass.intoSpace).length / passes.length : 0,
  deliveryByDistanceBand: crossTab(passes, "band", "passType"),
  deliveryByIntoSpace: crossTab(passes.map((pass) => ({ ...pass, space: pass.intoSpace ? "into-space" : "to-feet" })), "space", "passType"),
  deliveryByLaneBand: crossTab(passes, "lane", "passType"),
  deliveryByPasserTier: crossTab(passes, "tier", "passType"),
  symmetry: {
    left,
    right,
    straight: passes.filter((pass) => pass.side === "straight").length,
    // 0 is perfectly even; +1 is entirely right-sided.
    imbalance: left + right ? Number(((right - left) / (right + left)).toFixed(4)) : 0,
  },
  violations,
};

// --- console ----------------------------------------------------------------
const pct = (count, total) => (total ? `${((count / total) * 100).toFixed(1)}%` : "--");
function printTable(title, table, columns) {
  console.log(`\n${title}`);
  console.log(`  ${"".padEnd(14)}${columns.map((column) => column.padStart(15)).join("")}${"total".padStart(9)}`);
  for (const [name, counts] of Object.entries(table)) {
    const total = Object.values(counts).reduce((sum, value) => sum + value, 0);
    console.log(`  ${name.padEnd(14)}`
      + columns.map((column) => `${counts[column] ?? 0} (${pct(counts[column] ?? 0, total)})`.padStart(15)).join("")
      + String(total).padStart(9));
  }
}

// The four specified deliveries, plus anything else that genuinely occurred --
// a goalkeeper's hand throw is routed past selectPassType() entirely and has
// its own type. Fixing the columns to four would silently drop those rows from
// every cross-tab while still counting them in the totals, which is the kind
// of quiet discrepancy a measurement tool must not introduce.
const SPECIFIED_DELIVERIES = ["ground", "driven-ground", "driven-aerial", "lofted"];
const DELIVERY_COLUMNS = [
  ...SPECIFIED_DELIVERIES,
  ...Object.keys(report.byDelivery).filter((name) => !SPECIFIED_DELIVERIES.includes(name)).sort(),
];
console.log(`Pass delivery mix -- ${passes.length} passes over ${POSSESSIONS} possessions (${MAX_ACTIONS} actions each)`);
console.log(`\nBy delivery:  ${Object.entries(report.byDelivery).map(([name, count]) => `${name} ${count} (${pct(count, passes.length)})`).join("   ")}`);
console.log(`By distance:  ${DISTANCE_BANDS.map((band) => `${band.label} ${report.byDistanceBand[band.label] ?? 0}`).join("   ")}`);
console.log(`By intent:    ${Object.entries(report.byIntent).map(([name, count]) => `${name} ${count}`).join("   ")}`);
console.log(`Into space:   ${pct(passes.filter((pass) => pass.intoSpace).length, passes.length)}`);

printTable("Delivery by distance band", report.deliveryByDistanceBand, DELIVERY_COLUMNS);
printTable("Delivery by intent", report.deliveryByIntoSpace, DELIVERY_COLUMNS);
printTable("Delivery by lane occupancy (local proxy, not the engine's own)", report.deliveryByLaneBand, DELIVERY_COLUMNS);
printTable("Delivery by passer tier (local proxy, not the engine's own)", report.deliveryByPasserTier, DELIVERY_COLUMNS);

console.log(`\nDirection symmetry: left ${report.symmetry.left}  right ${report.symmetry.right}`
  + `  straight ${report.symmetry.straight}  imbalance ${report.symmetry.imbalance}`);

console.log(`\nInvariants`);
if (violations.length) {
  console.log(`  ${violations.length} FAILURE(S)`);
  const grouped = {};
  for (const violation of violations) (grouped[violation.rule] ??= []).push(violation.distanceYards);
  for (const [rule, distances] of Object.entries(grouped).sort()) {
    console.log(`    ${rule}: ${distances.length}`
      + `  (${distances.slice().sort((a, b) => a - b).map((value) => `${value}y`).join(", ")})`);
  }
} else {
  console.log("  PASS -- no into-space ground ball at or beyond 30 yards, no ground ball beyond 35");
}

if (JSON_OUT) {
  mkdirSync(dirname(JSON_OUT), { recursive: true });
  writeFileSync(JSON_OUT, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`\nWrote ${JSON_OUT}`);
}
process.exitCode = violations.length ? 1 : 0;
