// Observed Scenario Graph -- runs a batch of seeded matches through the
// real draft-run.js engine and reports which scenario codes actually fired,
// broken down by zone row (Z0-2 final third / Z3-5 midfield-advanced /
// Z6-8 midfield-deep / Z9-11 own third). This is telemetry, not assertions:
// it's meant to make distribution absurdities visible ("95% of tackles in
// one band", "zero crosses from one flank") before they need a dedicated
// test, the same way manually tracing a live match caught the corner and
// free-kick reachability bugs -- just permanent and reusable instead of
// hand-patched each time. See MATCH_ENGINE_SCENARIOS.md.
//
// Two cadences, same tool, different matchCount:
//   npm run match:telemetry  (400 matches,  ~1 min) -- fast, cheap, everyday dev check.
//   npm run match:audit      (8000 matches, ~20 min) -- occasional, before a
//     release or after touching any probability-heavy system. Rare-event
//     counts (reds, penalties, K.ONEONONE.6, FK.WALL.HIT) are too noisy at
//     400 matches to tell "badly calibrated" from "unlucky sample" apart.
//
// Usage: node tools/scenario_telemetry.mjs [matchCount]

import fs from "node:fs";
import vm from "node:vm";

const matchCount = Number(process.argv[2]) || 400;

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

// See tools/test-draft-game.mjs for why matchEngineCore's source is inlined
// (export-stripped) ahead of draft-run.js's, rather than injected into the
// sandbox context object: same vm-sandbox realm as everything else,
// avoiding cross-realm identity gotchas.
const matchEngineCoreSource = fs.readFileSync(new URL("../src/lib/matchEngineCore.js", import.meta.url), "utf8")
  .replace(/^export (function|const)/gm, "$1");
const runSource = matchEngineCoreSource + "\n"
  + fs.readFileSync(new URL("../draft-run.js", import.meta.url), "utf8")
  .replace(/^(?:import[\s\S]*?;\r?\n)+/, "")
  .split("elements.nextButton.addEventListener")[0]
  .concat(`
    (async () => {
      const opponentRoster = globalThis.testOpponentRoster;
      const rows = [];
      for (let index = 0; index < ${matchCount}; index += 1) {
        state.matchNumber = index;
        const result = matchSimulation("milan", opponentRoster, index % 2 ? "Group stage" : "Round of 16");
        for (const event of [...result.events, ...result.extraTimeEvents]) {
          rows.push({
            scenario: event.scenarioType || event.kind,
            zone: event.zoneFrom,
            outcome: event.card ? \`CARD.\${String(event.card).toUpperCase()}\` : (event.goal ? "GOAL" : event.kind),
          });
        }
      }
      globalThis.__telemetryRows = rows;
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

const rows = context.__telemetryRows;
const ZONE_BANDS = ["Z0-2", "Z3-5", "Z6-8", "Z9-11"];
function bandFor(zone) {
  if (zone === null || zone === undefined || Number.isNaN(Number(zone))) return "n/a";
  return ZONE_BANDS[Math.min(3, Math.floor(Number(zone) / 3))];
}

const table = new Map(); // scenario -> { total, bands: {Z0-2:n, ...} }
for (const row of rows) {
  const key = row.scenario || row.outcome || "unknown";
  if (!table.has(key)) {
    table.set(key, { total: 0, bands: Object.fromEntries(ZONE_BANDS.map((b) => [b, 0])), na: 0 });
  }
  const entry = table.get(key);
  entry.total += 1;
  const band = bandFor(row.zone);
  if (band === "n/a") entry.na += 1;
  else entry.bands[band] += 1;
}

const sorted = [...table.entries()].sort((a, b) => b[1].total - a[1].total);
const nameWidth = Math.max(20, ...sorted.map(([name]) => name.length));
console.log(`Observed Scenario Graph -- ${matchCount} matches, ${rows.length} tagged events\n`);
if (matchCount < 2000) {
  console.log(
    "Note: under ~2000 matches, rare-event counts (reds, penalties, K.ONEONONE.6,\n" +
    "FK.WALL.HIT, etc.) are noisy -- fine for a fast dev/CI check, not a reliable\n" +
    "calibration read. For that, run a larger occasional audit, e.g.\n" +
    "`npm run match:audit` (defaults to 8000 matches) before a release or after\n" +
    "touching probability-heavy systems.\n",
  );
}
console.log(
  "scenario".padEnd(nameWidth),
  ZONE_BANDS.map((b) => b.padStart(7)).join(" "),
  "n/a".padStart(7),
  "total".padStart(8),
  "/match".padStart(8),
);
for (const [name, entry] of sorted) {
  console.log(
    name.padEnd(nameWidth),
    ZONE_BANDS.map((b) => String(entry.bands[b]).padStart(7)).join(" "),
    String(entry.na).padStart(7),
    String(entry.total).padStart(8),
    (entry.total / matchCount).toFixed(3).padStart(8),
  );
}
