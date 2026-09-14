// Realism Roadmap Stage 0 -- the tactical influence audit harness.
//
//   npm run audit:tactical-influence
//   node tools/measure-tactical-influence.mjs --possessions 80
//   node tools/measure-tactical-influence.mjs --only directness,role
//   node tools/measure-tactical-influence.mjs --json audit/influence/baseline.json
//
// The engine's suites prove a tactical input REACHES behaviour. This asks the
// separate question the observation backlog's Finding 3 leaves open: is the
// effect big enough for a person watching to see it?
//
// Method. Build one real 11v11 setup, then for each tactical input sweep the
// SAME list of (starting owner, seed) pairs under both settings and compare
// the resulting possession-metric distributions. Holding the start fixed and
// varying only the instruction is what makes the attribution clean; rotating
// the starting owner across the sweep is what keeps the sample from being one
// narrow picture repeated.
//
// This harness changes no engine behaviour and consumes no engine RNG of its
// own -- every number it reports is read back off a possession the engine had
// already finished. See src/lib/influenceAudit.js for why the arms are
// compared as unpaired samples even though both sweep the same seeds.
import "./match-lab-test-environment.mjs";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { auditMetrics } from "../src/lib/influenceAudit.js";
import { findHistoricalSquad } from "../src/data/historicalSquads.js";
import { specAliases } from "../src/lib/historicalSquadResolver.js";
import { zoneFromPercent } from "../src/lib/replayHarness.js";

const {
  state, runConstructedPossession, applySetup, setupDraft, reassignSetupTeam, pointOf,
} = await import("../match-lab.js");

// --- arguments -------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 && argv[index + 1] ? argv[index + 1] : fallback;
};
const POSSESSIONS = Math.max(4, Number(flag("possessions", 80)) || 80);
// Left unbounded, a sampled passage runs to the engine's own action cap --
// around forty decisions, most of them deep inside a single sequence that the
// first few choices already determined. Many short independent passages carry
// far more information per second of CPU than a few long dependent ones, and
// a dozen actions is also closer to what a real possession actually is.
const MAX_ACTIONS = Math.max(3, Number(flag("actions", 12)) || 12);
// How far up the pitch the advanced half of the sample starts, in percent of
// pitch length. 22% of 120 yards is about 26 yards -- a settled attacking
// phase rather than a counter already in the box.
const ADVANCE_SHIFT_PERCENT = 22;
const ONLY = flag("only", "").split(",").map((entry) => entry.trim()).filter(Boolean);
const JSON_OUT = flag("json", "");

// --- one real 11v11 setup --------------------------------------------------
// The same fake-resolved-squad convention tools/test-match-lab-setup.mjs uses:
// real historical squad shells with position ratings good enough for
// positionFit() to place everyone, and no network.
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
if (await applySetup() === false) throw new Error("The audit could not apply a match setup.");

// Snapshot the applied roster and tactics so every arm starts from exactly
// the same picture rather than from whatever the previous arm left behind.
const BASE_ROSTER = structuredClone(state.roster);
const BASE_TACTICS = {
  attacking: structuredClone(state.attacking),
  marking: structuredClone(state.marking),
  transition: structuredClone(state.transition),
};

// The outfield home players, in a stable order, used to rotate which part of
// the pitch each sampled possession starts from.
const STARTERS = BASE_ROSTER
  .filter((entry) => entry.team === "home" && entry.role !== "keeper")
  .map((entry) => entry.id);

// --- what a possession is worth reading ------------------------------------
function possessionSample(run) {
  const metrics = run.possessionMetrics ?? {};
  const decisions = metrics.decisions || 0;
  const passEvents = (run.trace || []).filter((event) => event.movement === "pass" && event.ballFrom && event.ballTo);
  const passYards = passEvents.map((event) => Math.hypot(
    (event.ballTo.x - event.ballFrom.x) * 0.8, (event.ballTo.y - event.ballFrom.y) * 1.15,
  ));
  const sample = {
    decisions,
    actions: run.actionsCount || 0,
    // Shares rather than counts: a possession that simply lasted longer is
    // not the same finding as one that chose differently, and only the
    // second is evidence that an instruction is working.
    passShare: decisions ? (metrics.passesSelected || 0) / decisions : null,
    carryShare: decisions ? (metrics.carriesSelected || 0) / decisions : null,
    shotsSelected: metrics.shotsSelected || 0,
    meanLegalPassingOptions: metrics.meanLegalPassingOptions ?? null,
    meanPressureAtDecision: metrics.meanPressureAtDecision ?? null,
    meanShotDistanceYards: metrics.meanShotDistanceYards ?? null,
    meanPassDistanceYards: passYards.length
      ? passYards.reduce((sum, value) => sum + value, 0) / passYards.length
      : null,
    longestPassYards: passYards.length ? Math.max(...passYards) : null,
  };
  // A null means "this possession had nothing to say about that metric" --
  // no shot, no pass -- and must be dropped rather than counted as zero,
  // which would be a different and false claim.
  return Object.fromEntries(Object.entries(sample).filter(([, value]) => Number.isFinite(value)));
}

/**
 * Push both teams up the pitch, preserving relative shape.
 *
 * The original sweep started every possession from the authored formation,
 * which put almost every sample in the middle third and produced roughly 0.13
 * shots per possession -- about ten shots per arm. Measured across the first
 * three sweeps, `meanShotDistanceYards` for the same tactical input came back
 * at d = 0.742, then 0.061, then 0.207: the metric was reporting sampling
 * noise, and any verdict resting on it was worthless.
 *
 * Shifting BOTH sides together keeps the defensive structure coherent -- it is
 * the picture of a possession that has already progressed, not a team teleported
 * past its opponents. Half the sample stays at the formation start so build-up
 * behaviour is still represented.
 */
function advanceFormation(roster, attackingTeam, shiftPercent) {
  const forward = state.attackingDirection[attackingTeam] === "up" ? -1 : 1;
  for (const entry of roster) {
    // The defending keeper stays on their line; a keeper dragged up the pitch
    // by a shape shift is not a picture that occurs.
    if (entry.role === "keeper") continue;
    entry.y = Math.max(2, Math.min(98, entry.y + forward * shiftPercent));
    entry.zone = zoneFromPercent(entry.x, entry.y);
  }
}

function collectSamples(applyArm) {
  const samples = {};
  for (let index = 0; index < POSSESSIONS; index += 1) {
    // Rebuild the exact authored picture, then let the arm change one thing.
    state.roster = structuredClone(BASE_ROSTER);
    state.attacking = structuredClone(BASE_TACTICS.attacking);
    state.marking = structuredClone(BASE_TACTICS.marking);
    state.transition = structuredClone(BASE_TACTICS.transition);
    state.pendingRestart = null;
    state.restartSetupDraft = null;
    applyArm();
    // Alternate build-up and advanced pictures so the sweep carries enough
    // shots for the shot metrics to mean anything. Deterministic on index, so
    // both arms see exactly the same sequence of pictures.
    if (index % 2 === 1) advanceFormation(state.roster, "home", ADVANCE_SHIFT_PERCENT);
    const owner = state.roster.find((entry) => entry.id === STARTERS[index % STARTERS.length]);
    state.ball = { ...pointOf(owner), ownerId: owner.id };
    const run = runConstructedPossession(index, { maxActions: MAX_ACTIONS });
    for (const [name, value] of Object.entries(possessionSample(run))) {
      (samples[name] ??= []).push(value);
    }
  }
  return samples;
}

// --- the tactical inputs under audit ---------------------------------------
const setAttacking = (field, value) => () => { state.attacking.home[field] = value; };
const setMarking = (field, value) => () => { state.marking.away[field] = value; };
const setHomeRole = (slotPattern, role) => () => {
  for (const entry of state.roster) {
    if (entry.team === "home" && slotPattern.test(entry.positionalSlot ?? "")) entry.tacticalRole = role;
  }
};

const VARIANTS = [
  { key: "directness", label: "attacking.directness 1 vs 5",
    a: setAttacking("directness", 5), b: setAttacking("directness", 1) },
  { key: "style", label: "attacking.style long-ball vs possession",
    a: setAttacking("style", "long-ball"), b: setAttacking("style", "possession") },
  { key: "tempo", label: "attacking.tempo quick vs slow",
    a: setAttacking("tempo", "quick"), b: setAttacking("tempo", "slow") },
  { key: "shooting", label: "attacking.shooting encourage vs discourage",
    a: setAttacking("shooting", "encourage"), b: setAttacking("shooting", "discourage") },
  { key: "dribbling", label: "attacking.dribbling more vs less",
    a: setAttacking("dribbling", "more"), b: setAttacking("dribbling", "less") },
  { key: "passIntoSpace", label: "attacking.passIntoSpace on vs off",
    a: setAttacking("passIntoSpace", true), b: setAttacking("passIntoSpace", false) },
  { key: "pressing", label: "opponent marking.pressing high vs low",
    a: setMarking("pressing", "high"), b: setMarking("pressing", "low") },
  // The Stage 2 question, asked directly: two central-midfield roles a
  // manager would consider completely different players.
  { key: "role", label: "central role regista vs ball-winning-midfielder",
    a: setHomeRole(/^(MC|DMC)$/, "regista"), b: setHomeRole(/^(MC|DMC)$/, "ball-winning-midfielder") },
];

// --- run -------------------------------------------------------------------
const selected = ONLY.length ? VARIANTS.filter((variant) => ONLY.includes(variant.key)) : VARIANTS;
if (!selected.length) throw new Error(`No variant matched --only ${ONLY.join(",")}`);

const started = Date.now();
console.log(`Tactical influence audit -- ${POSSESSIONS} possessions per arm, ${selected.length} input${selected.length === 1 ? "" : "s"}\n`);

const results = [];
for (const variant of selected) {
  const audit = auditMetrics(collectSamples(variant.a), collectSamples(variant.b));
  results.push({ key: variant.key, label: variant.label, audit });

  console.log(`${variant.label}`);
  console.log(`  verdict: ${audit.verdict.toUpperCase()}${audit.strongest ? ` (${audit.strongest.label})` : ""}`);
  const rows = audit.metrics
    .filter((metric) => !metric.insufficient)
    .sort((left, right) => Math.abs(right.effectSize) - Math.abs(left.effectSize));
  for (const metric of rows) {
    const pValue = metric.pValue < 0.0001 ? "<0.0001" : metric.pValue.toFixed(4);
    console.log(
      `    ${metric.label.padEnd(26)}`
      + ` A ${metric.a.mean.toFixed(3).padStart(8)}`
      + `  B ${metric.b.mean.toFixed(3).padStart(8)}`
      + `  d ${metric.effectSize.toFixed(3).padStart(7)}`
      + `  p ${pValue.padStart(8)}`
      + `  ${metric.verdict}`,
    );
  }
  console.log("");
}

// --- summary ---------------------------------------------------------------
console.log("=".repeat(78));
console.log("Summary -- inputs a player can currently see\n");
for (const result of results) {
  console.log(`  ${result.audit.verdict.toUpperCase().padEnd(12)} ${result.label}`);
}
const invisible = results.filter((result) => result.audit.verdict === "none");
console.log(`\n${results.length - invisible.length} of ${results.length} inputs reach at least "weak" separation.`);
if (invisible.length) {
  console.log(`Currently invisible: ${invisible.map((result) => result.key).join(", ")}`);
}
console.log(`\nCompleted in ${((Date.now() - started) / 1000).toFixed(1)}s`);

if (JSON_OUT) {
  mkdirSync(dirname(JSON_OUT), { recursive: true });
  writeFileSync(JSON_OUT, JSON.stringify({
    possessionsPerArm: POSSESSIONS, capturedAt: new Date().toISOString(), results,
  }, null, 2));
  console.log(`Wrote ${JSON_OUT}`);
}
