// Keeper-save / shot-conversion calibration audit -- built for the
// resolveKeeperSave() recalibration (see MATCH_LAB_PLAN.md, "Shot-conversion
// calibration" section). Scoped to DIRECT FREE KICKS ONLY this pass --
// open-play shots and header paths (open-play cross, corner, FK-cross) are
// untouched and unaudited here; see the WIP branch
// wip/broad-shot-context-multiplier for the broader version reserved for a
// later, separately-scoped pass.
//
// scenario_telemetry.mjs's event-log approach can't answer these questions:
// a clean free-kick save that doesn't produce a corner or a rebound pushes
// NO event onto the match timeline at all (confirmed by reading
// draft-run.js's applyFoulOutcome directly), so on-target/save-rate/
// goals-per-shot can't be reconstructed from the event log for that origin.
// This instruments the resolver functions directly.
//
// Two sections:
//   A. Full-match telemetry -- runs real matches through the real engine,
//      wrapping resolveKeeperSave/resolveFreeKickAttempt/resolveWall to log
//      every call, then reports shots/on-target/saves/goals per shot
//      ORIGIN. Open-play/header buckets are expected to be statistically
//      identical to a pre-change baseline (contextMultiplier only affects
//      the fk-* branch), included as a direct empirical check of that.
//   B. Skill-tier matrix -- bypasses the match engine, calls the free-kick
//      resolver chain (resolveWall -> resolveFreeKickAttempt ->
//      resolveKeeperSave -> rebound scramble if spilled) directly,
//      thousands of trials per tier pairing. Reports the full stage
//      breakdown (wall clearance, on-target, clean keeper-beaten rate,
//      rebound goals, total final conversion) rather than a single number,
//      since "goals/attempt" alone conflates several different causal
//      stages. Total-final-conversion is what should be compared against
//      the real-world reference figures (PL ~5.65%, Messi 8.9%, Ronaldo
//      6.4%, all goals-per-attempt including deflections/rebounds).
//
// Usage: node tools/keeper_save_audit.mjs [matchCount]
//   npm run match:keeper-audit  (defaults to 3000 matches for Section A)

import fs from "node:fs";
import vm from "node:vm";

const matchCount = Number(process.argv[2]) || 3000;

const fakeElement = () => ({
  addEventListener() {},
  append() {},
  appendChild() {},
  classList: { add() {}, remove() {} },
  querySelector() { return fakeElement(); },
  replaceChildren() {},
  setAttribute() {},
  style: {},
});

function player(name, role, line, currentAbility, id) {
  return {
    database_slug: "cm0304_vanilla_original",
    source_person_id: String(id),
    display_name: name,
    role,
    line,
    position_text: role,
    current_ability: currentAbility,
  };
}

const userRoster = [
  player("User Keeper", "GK", "defence", 170, 1),
  player("Left Back", "DL", "defence", 150, 2),
  player("Centre Back One", "DC", "defence", 160, 3),
  player("Centre Back Two", "DC", "defence", 155, 4),
  player("Right Back", "DR", "defence", 150, 5),
  player("Mid One", "MC", "midfield", 170, 6),
  player("Mid Two", "MC", "midfield", 165, 7),
  player("Mid Three", "AMC", "midfield", 175, 8),
  player("Forward One", "FL", "attack", 180, 9),
  player("Forward Two", "FC", "attack", 185, 10),
  player("Forward Three", "FR", "attack", 178, 11),
];
const opponentRoster = [
  player("Opponent Keeper", "GK", "defence", 165, 101),
  ...Array.from({ length: 17 }, (_, index) => player(
    `Opponent ${index + 1}`,
    index < 5 ? "DC" : index < 11 ? "MC" : "FC",
    index < 5 ? "defence" : index < 11 ? "midfield" : "attack",
    145 + index,
    102 + index,
  )),
];
const savedTeam = {
  teamName: "Test XI",
  scenario: "ucl0203",
  captainSlotId: "slot-9",
  overalls: { team: 85, attack: 90, midfield: 84, defence: 78 },
  players: userRoster.map((item, index) => ({
    player: item,
    role: item.role,
    line: item.line,
    overall: Math.round(item.current_ability / 2),
    isCaptain: index === 9,
  })),
};

const matchEngineCoreSource = fs.readFileSync(new URL("../src/lib/matchEngineCore.js", import.meta.url), "utf8")
  .replace(/^export (function|const)/gm, "$1");

// Instrumentation: reassigning these top-level `function` bindings is legal
// (neither source file has "use strict"; both run as classic vm scripts).
// The wrapper calls random() zero times -- it only observes args/results
// around the real call -- so this cannot shift RNG call order by even one
// tick, regardless of how many resolvers get wrapped.
const instrumentation = `
globalThis.__shotLog = [];
const __origResolveKeeperSave = resolveKeeperSave;
resolveKeeperSave = function (shooter, keeper, finishType, minute, random, zone, contextMultiplier) {
  const result = __origResolveKeeperSave(shooter, keeper, finishType, minute, random, zone, contextMultiplier);
  globalThis.__shotLog.push({ stage: "keeper-save", finishType, result });
  return result;
};
`;

const runSource = matchEngineCoreSource + "\n" + instrumentation + "\n"
  + fs.readFileSync(new URL("../draft-run.js", import.meta.url), "utf8")
  .replace(/^(?:import[\s\S]*?;\r?\n)+/, "")
  .split("elements.nextButton.addEventListener")[0]
  .concat(`
    (async () => {
      const opponentRoster = globalThis.testOpponentRoster;
      for (let index = 0; index < ${matchCount}; index += 1) {
        state.matchNumber = index;
        matchSimulation("milan", opponentRoster, index % 2 ? "Group stage" : "Round of 16");
      }
    })()
  `);

const context = {
  console,
  assert: { equal() {}, ok() {}, match() {}, deepEqual() {} },
  createDraftSquad: () => ({ seed: "", players: [] }),
  formatDraftSquadText: () => "",
  createCanonicalMatchTimeline: () => ({}),
  reduceMatchTimeline: () => ({}),
  createMatchPlaybackController: () => ({}),
  estimateServerClockOffset: () => 0,
  document: { createElement: fakeElement, querySelector: fakeElement },
  localStorage: {
    getItem(key) {
      return key === "retroball-draft-team-v1" ? JSON.stringify(savedTeam) : "";
    },
    setItem() {},
  },
  sessionStorage: { getItem() { return ""; }, setItem() {} },
  testOpponentRoster: opponentRoster,
  URLSearchParams,
  setInterval,
  clearInterval,
  setTimeout,
  saveDraftSquad: async () => ({ ok: true }),
  window: { clearInterval, location: { hash: "" }, setInterval, setTimeout },
};

await vm.runInNewContext(runSource, context);

const shotLog = context.__shotLog;

// --- Section A: origin buckets from the raw call log -------------------
// finishType disambiguates origin: fk-* = direct free kick, calm/blast/
// finesse = open-play shot. "header" is NOT open-play-cross-only -- it's
// every header-flavored resolveKeeperSave call, including corner and
// FK-cross headers (both reach it via resolveDelivery, not wrapped
// separately here since none of those paths are touched this pass). That's
// fine for this bucket's actual purpose: confirming ALL header-flavored
// calls are unaffected, which is true regardless of which specific header
// mechanic produced each one.
const buckets = {
  "open-play shot": { shots: 0, onTarget: 0, saved: 0, goals: 0, rebounds: 0 },
  "all header-flavored saves (open-play/corner/FK-cross)": { shots: 0, onTarget: 0, saved: 0, goals: 0, rebounds: 0 },
  "direct free kick": { shots: 0, onTarget: 0, saved: 0, goals: 0, rebounds: 0 },
};

for (const entry of shotLog) {
  const isFk = String(entry.finishType).startsWith("fk-");
  const bucket = buckets[isFk ? "direct free kick" : entry.finishType === "header" ? "all header-flavored saves (open-play/corner/FK-cross)" : "open-play shot"];
  bucket.shots += 1;
  bucket.onTarget += 1; // resolveKeeperSave only ever runs on an on-target attempt
  if (entry.result.goal) bucket.goals += 1;
  else if (entry.result.rebound) bucket.rebounds += 1;
  else bucket.saved += 1;
}

console.log(`Keeper-save audit -- ${matchCount} matches, Section A (full-match, by origin)\n`);
console.log(
  "origin".padEnd(26),
  "shots".padStart(7),
  "/match".padStart(8),
  "save%".padStart(8),
  "goals".padStart(7),
  "g/shot".padStart(8),
  "rebounds".padStart(9),
);
for (const [name, b] of Object.entries(buckets)) {
  const savePct = b.onTarget ? (b.saved / b.onTarget * 100).toFixed(1) : "0.0";
  const goalsPerShot = b.shots ? (b.goals / b.shots * 100).toFixed(2) : "0.00";
  console.log(
    name.padEnd(26),
    String(b.shots).padStart(7),
    (b.shots / matchCount).toFixed(3).padStart(8),
    `${savePct}%`.padStart(8),
    String(b.goals).padStart(7),
    `${goalsPerShot}%`.padStart(8),
    String(b.rebounds).padStart(9),
  );
}
console.log("\nopen-play shot and header rows are the empirical check that contextMultiplier's");
console.log("free-kick-only branch left them alone -- compare against a pre-change baseline run");
console.log("(git stash the free-kick edits, re-run) to confirm.");

// --- Section B: skill-tier matrix, direct free-kick chain, full stages --
// Bypasses the match engine entirely -- calls resolveWall ->
// resolveFreeKickAttempt -> resolveKeeperSave -> (if spilled) a rebound
// scramble, matching the exact production call shape (draft-run.js's
// applyFoulOutcome), against a realistic 3-man wall by default. Reports
// every stage separately: wall clearance, on-target, clean keeper-beaten
// rate, rebound goals, and total final conversion (the number comparable
// to real-world goals-per-attempt figures).
console.log("\n\nSection B -- direct free-kick skill-tier matrix, full stage breakdown (5000 attempts each)\n");

const runSectionB = `
(() => {
  function attrs(pairs) { return Object.entries(pairs).map(([label, value]) => ({ label, value })); }
  function mkPlayer(name, ca, overrides) { return { canonical_player_name: name, current_ability: ca, attributes: attrs(overrides) }; }

  const takerTiers = {
    "weak/non-specialist":   mkPlayer("Weak Taker", 110, { "Free Kick Taking": 8, Technique: 11, "Long Shots": 9 }),
    "ordinary taker":        mkPlayer("Ordinary Taker", 140, { "Free Kick Taking": 13, Technique: 13, "Long Shots": 12 }),
    "strong specialist":     mkPlayer("Strong Specialist", 155, { "Free Kick Taking": 16, Technique: 15, "Long Shots": 14 }),
    "elite specialist (Roberto Carlos-tier)": mkPlayer("Roberto Carlos", 177, { "Free Kick Taking": 19, Technique: 17, "Long Shots": 16 }),
    "exceptional (peak)":    mkPlayer("Exceptional", 185, { "Free Kick Taking": 20, Technique: 19, "Long Shots": 18 }),
  };
  const keeperTiers = {
    "weak keeper": mkPlayer("Weak Keeper", 110, { Handling: 8, Reflexes: 8, Positioning: 8, "One On Ones": 8, Agility: 8, Jumping: 8 }),
    "ordinary keeper": mkPlayer("Ordinary Keeper", 145, { Handling: 12, Reflexes: 13, Positioning: 12, "One On Ones": 12, Agility: 12, Jumping: 12 }),
    "elite keeper (Barthez-tier)": mkPlayer("Fabien Barthez", 168, { Handling: 16, Reflexes: 17, Positioning: 16, "One On Ones": 15, Agility: 16, Jumping: 14 }),
  };
  const wallSizes = { "0 (no wall)": 0, "1": 1, "3": 3, "5": 5 };
  const wallDefender = mkPlayer("Wall Defender", 140, { Jumping: 14, Positioning: 14 });

  function runChain(taker, keeper, wallSize, runs) {
    const wall = Array(wallSize).fill(wallDefender);
    const random = seededRandom(hashString("keeper-audit:" + taker.canonical_player_name + ":" + keeper.canonical_player_name + ":" + wallSize));
    let wallHit = 0, onTarget = 0, cleanGoals = 0, reboundGoals = 0;
    for (let i = 0; i < runs; i++) {
      const w = resolveWall(taker, wall, random);
      if (w.hit) { wallHit += 1; continue; }
      const shotType = selectFreeKickShotType(taker, random);
      const attempt = resolveFreeKickAttempt(shotType, taker, random);
      if (!attempt.onTarget) continue;
      onTarget += 1;
      const keeperFinishType = { regular: "fk-regular", hard: "fk-hard", curl: "fk-curl" }[shotType] || "fk-regular";
      // zone 4 = row 1 (edge-of-box/long-range band) -- the classic
      // "wall + direct shot" free-kick position; zone 1 itself is the
      // box, where a foul is a penalty, not a free kick.
      const save = resolveKeeperSave(taker, keeper, keeperFinishType, 45, random, 1, freeKickContextMultiplier(4));
      if (save.goal) { cleanGoals += 1; continue; }
      if (!save.rebound) continue;
      // Matches the real tick loop's free-kick rebound scramble
      // (draft-run.js's applyFoulOutcome): a poacher duel for the loose
      // ball, then a shot chance if won. No separate poacher pool exists
      // in this isolated harness, so the taker stands in for the poacher
      // and a wall defender (if any placed) for the contesting defender --
      // same "real players, not fabricated" rule Match Lab itself follows.
      const reboundDefender = wall[0] || keeper;
      const reboundDuel = localizedDuel(
        taker, reboundDefender,
        ["Anticipation", "Acceleration", "Off the Ball"],
        ["Positioning", "Anticipation", "Strength"],
        45, random, 1,
      );
      if (reboundDuel.won && random() < transitionShotChance(taker, keeper, 45, 0.32, poacherScore)) {
        reboundGoals += 1;
      }
    }
    return { runs, wallHit, onTarget, cleanGoals, reboundGoals };
  }

  const rows = [];
  for (const [takerName, taker] of Object.entries(takerTiers)) {
    for (const [keeperName, keeper] of Object.entries(keeperTiers)) {
      rows.push({ takerName, keeperName, wallSize: 3, ...runChain(taker, keeper, 3, 5000) });
    }
  }
  // Wall-size sweep, fixed at the Roberto Carlos-tier vs Barthez-tier
  // pairing, per the requested 0/1/3/5 comparison.
  const rcTaker = takerTiers["elite specialist (Roberto Carlos-tier)"];
  const barthez = keeperTiers["elite keeper (Barthez-tier)"];
  const wallRows = [];
  for (const [label, size] of Object.entries(wallSizes)) {
    wallRows.push({ takerName: "Roberto Carlos-tier", keeperName: "Barthez-tier", wallSize: label, ...runChain(rcTaker, barthez, size, 5000) });
  }
  globalThis.__tierMatrix = rows;
  globalThis.__wallSweep = wallRows;
})();
`;

const sectionBContext = { console };
await vm.runInNewContext(matchEngineCoreSource + "\n" + runSectionB, sectionBContext);

function printStageTable(rows) {
  const nameWidth = 40;
  console.log(
    "taker".padEnd(nameWidth), "keeper".padEnd(20), "wall".padStart(5),
    "clear%".padStart(8), "on-tgt%".padStart(9), "clean%".padStart(8),
    "rebound-g".padStart(10), "TOTAL%".padStart(9),
  );
  for (const row of rows) {
    const clearPct = ((row.runs - row.wallHit) / row.runs * 100).toFixed(1);
    const onTargetPct = (row.onTarget / row.runs * 100).toFixed(1);
    const cleanPct = (row.cleanGoals / row.runs * 100).toFixed(2);
    const totalGoals = row.cleanGoals + row.reboundGoals;
    const totalPct = (totalGoals / row.runs * 100).toFixed(2);
    console.log(
      row.takerName.padEnd(nameWidth),
      row.keeperName.padEnd(20),
      String(row.wallSize).padStart(5),
      `${clearPct}%`.padStart(8),
      `${onTargetPct}%`.padStart(9),
      `${cleanPct}%`.padStart(8),
      String(row.reboundGoals).padStart(10),
      `${totalPct}%`.padStart(9),
    );
  }
}

console.log("Skill-tier matrix (3-man wall, 5000 attempts each):");
printStageTable(sectionBContext.__tierMatrix);

console.log("\nRoberto Carlos-tier vs Barthez-tier, wall-size sweep (5000 attempts each):");
printStageTable(sectionBContext.__wallSweep);

console.log("\nTOTAL% = clean keeper-beaten + rebound-scramble goals, as a share of all attempts --");
console.log("this is the number comparable to real-world goals-per-attempt figures (PL ~5.65%,");
console.log("Messi 8.9%, Ronaldo 6.4%).");
