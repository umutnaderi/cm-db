import assert from "node:assert/strict";
import fs from "node:fs";
import {
  PRODUCT_MATCH_INPUT_SCHEMA,
  PRODUCT_MATCH_INPUT_VERSION,
  PRODUCT_MATCH_CONTINUATION_SCHEMA,
  PRODUCT_MATCH_OUTPUT_SCHEMA,
  adaptLegacyDraftTeam,
  createProductMatchContinuation,
  createProductMatchInput,
  createProductMatchOutput,
  createProductPlayerReference,
  createProductTeamFromSetup,
  productContractFingerprint,
  stableContractJson,
  validateProductMatchInput,
} from "../src/lib/productMatchContract.js";
import { assignPlayer, createMatchSetup } from "../src/lib/matchSetup.js";

const fixture = JSON.parse(fs.readFileSync(
  new URL("./fixtures/gameplay/legacy-draft-baseline.json", import.meta.url),
  "utf8",
));
const source = (path) => fs.readFileSync(new URL(path, import.meta.url), "utf8")
  .replaceAll(String.fromCharCode(13, 10), String.fromCharCode(10));

console.log("=== Phase 5.1: the existing draft game is characterized, not rewritten ===");
assert.equal(fixture.completeTeam.version, 3);
assert.equal(fixture.inProgress.version, 1);
assert.equal(fixture.completeTeam.players.length, 11);
assert.equal(fixture.completeTeam.players.filter((entry) => entry.isCaptain).length, 1);
assert.equal(fixture.completeTeam.captainSlotId, "slot-5");
assert.equal(new Set(fixture.completeTeam.players.map((entry) => entry.slotId)).size, 11);

const setupSource = source("../draft-setup.js");
const setupHtml = source("../draft-setup.html");
const runSource = source("../draft-run.js");
assert.ok(setupSource.includes(`const DRAFT_TEAM_STORAGE_KEY = "${fixture.storage.teamKey}"`));
assert.ok(setupSource.includes(`const DRAFT_PROGRESS_STORAGE_KEY = "${fixture.storage.progressKey}"`));
assert.ok(setupSource.includes("version: 3,"));
assert.ok(setupSource.includes("version: 1,"));
for (const mode of fixture.runSurface.modes) assert.ok(setupSource.includes(mode), `missing draft mode ${mode}`);
for (const scenario of fixture.runSurface.scenarios) {
  assert.ok(setupSource.includes(scenario) || setupHtml.includes(scenario), `missing draft scenario ${scenario}`);
}
assert.ok(runSource.includes("function matchSimulation("));
assert.ok(runSource.includes("function finalizeMatchResult("));
for (const field of fixture.runSurface.requiredResultFields) {
  assert.ok(runSource.includes(field), `legacy runner no longer exposes ${field}`);
}
console.log("PASS -- legacy team/progress schemas and run surface match the fixture");

console.log("\n=== Phase 5.2: legacy draft data enters a versioned product contract ===");
const home = adaptLegacyDraftTeam(fixture.completeTeam, { teamId: "home", attackingDirection: "down" });
const awayFixture = structuredClone(fixture.completeTeam);
awayFixture.teamName = "Baseline Opponent";
for (const entry of awayFixture.players) {
  entry.player.canonical_player_public_id += "_away";
  entry.player.source_person_id += "0";
}
const away = adaptLegacyDraftTeam(awayFixture, { teamId: "away", attackingDirection: "up" });

assert.equal(home.lineup.length, 11);
assert.equal(home.squad.length, 11);
assert.equal(home.squad.filter((entry) => entry.captain).length, 1);
assert.equal(home.lineup.find((entry) => entry.slotId === "slot-0").position, "GK");
assert.ok(home.lineup.every((entry) => entry.tacticalRole === null && entry.duty === null));
assert.equal(home.source.kind, "legacy-draft-team");
assert.equal(home.source.scenario, "ucl0304");

const input = createProductMatchInput({
  engineVersion: "match-lab-2026.09.14",
  seed: "product-contract-baseline",
  format: "11v11",
  home,
  away,
  kickoff: { takingTeam: "home", type: "kickoff" },
  metadata: { mode: "draft", sourceFixture: fixture.fixtureVersion },
});
assert.equal(input.schema, PRODUCT_MATCH_INPUT_SCHEMA);
assert.equal(input.version, PRODUCT_MATCH_INPUT_VERSION);
assert.equal(validateProductMatchInput(input).valid, true);
const { fingerprint: inputFingerprint, ...inputBody } = input;
assert.equal(inputFingerprint, productContractFingerprint(inputBody));

const repeated = createProductMatchInput({
  engineVersion: "match-lab-2026.09.14",
  seed: "product-contract-baseline",
  format: "11v11",
  home,
  away,
  kickoff: { takingTeam: "home", type: "kickoff" },
  metadata: { sourceFixture: fixture.fixtureVersion, mode: "draft" },
});
assert.equal(stableContractJson(input), stableContractJson(repeated));
assert.equal(input.fingerprint, repeated.fingerprint);
assert.deepEqual(JSON.parse(JSON.stringify(input)), input);
console.log("PASS -- identical legacy inputs produce a byte-stable match input and fingerprint");

const changed = structuredClone(input);
changed.teams.home.formation.name = "4-3-3";
const changedValidation = validateProductMatchInput(changed);
assert.equal(changedValidation.valid, false);
assert.ok(changedValidation.errors.includes("match input fingerprint does not match its contents"));
assert.throws(() => createProductPlayerReference({ display_name: "No identity" }), /canonical id|database/);
assert.throws(() => createProductMatchInput({
  engineVersion: "v1", seed: "same-end", home, away: { ...away, attackingDirection: "down" },
}), /opposite ends/);
assert.throws(() => createProductMatchInput({
  engineVersion: "v1", seed: "duplicate-player", home,
  away: { ...home, teamId: "away", attackingDirection: "up" },
}), /same player reference/);
assert.throws(() => createProductMatchInput({
  engineVersion: "v1", seed: "wrong-count", format: "5v5", home, away,
}), /expected 5/);
assert.throws(() => createProductMatchInput({
  engineVersion: "v1", seed: "unknown-format", format: "13v13", home, away,
}), /unknown match format/);
console.log("PASS -- identity, direction and tamper errors are explicit");

console.log("\n=== Phase 5.2: the current Match Lab setup maps without DOM state ===");
let setup = createMatchSetup({
  format: "3v3",
  home: { formation: "4-3-3", attackingDirection: "down", attacking: { mentality: "positive", width: "wide" } },
  away: { formation: "4-4-2", attacking: { mentality: "cautious" } },
});
const setupPlayers = { home: [], away: [] };
for (const teamId of ["home", "away"]) {
  for (const [index, slot] of setup[teamId].slots.entries()) {
    const playerId = `${teamId}-setup-${index}`;
    setup[teamId] = assignPlayer(setup[teamId], slot.slotId, playerId);
    setupPlayers[teamId].push({
      id: playerId,
      player: {
        canonical_player_public_id: `${playerId}-canonical`,
        database_slug: "cm0304",
        source_person_id: `${teamId}-${index}`,
        display_name: `${teamId} setup player ${index}`,
      },
    });
  }
}
const setupHome = createProductTeamFromSetup({ teamSetup: setup.home, players: setupPlayers.home, name: "Setup Home" });
const setupAway = createProductTeamFromSetup({ teamSetup: setup.away, players: setupPlayers.away, name: "Setup Away" });
assert.equal(setupHome.lineup.length, 3);
assert.equal(setupHome.tactics.attacking.mentality, "positive");
assert.equal(setupHome.tactics.attacking.width, "wide");
assert.ok(setupHome.lineup.every((slot) => slot.anchor && slot.tacticalRole && slot.duty));
assert.equal(createProductMatchInput({
  engineVersion: "match-lab-2026.09.14", seed: "setup-adapter", format: "3v3",
  home: setupHome, away: setupAway,
}).teams.home.source.kind, "match-setup");
console.log("PASS -- formation, assignments, roles, duties, anchors and tactics survive the setup adapter");

console.log("\n=== Phase 5.2: continuation and output stay bound to the input ===");
const continuation = createProductMatchContinuation({
  inputFingerprint: input.fingerprint,
  elapsedMs: 23 * 60 * 1000 + 4120,
  period: "first-half",
  score: { home: 1, away: 0 },
  possession: { team: "away", ownerId: "away:slot-6", phase: "controlled-ground" },
  world: {
    ball: { x: 44, y: 52, height: 0, velocity: { x: 0.01, y: -0.02 } },
    players: { "home:slot-0": { x: 50, y: 96, velocity: { x: 0, y: 0 } } },
  },
  tactics: { home: input.teams.home.tactics, away: input.teams.away.tactics },
  discipline: [{ playerId: "away:slot-2", card: "yellow" }],
  substitutions: [],
  decisionMemory: { recentActions: ["pass", "carry"] },
  rng: { rootSeed: input.seed, chunkIndex: 31 },
});
assert.equal(continuation.schema, PRODUCT_MATCH_CONTINUATION_SCHEMA);
assert.equal(continuation.inputFingerprint, input.fingerprint);
assert.equal(continuation.score.home, 1);

const output = createProductMatchOutput({
  inputFingerprint: input.fingerprint,
  status: "paused",
  elapsedMs: continuation.elapsedMs,
  score: continuation.score,
  timeline: [{ code: "RESTART.THROW_IN", atMs: continuation.elapsedMs }],
  commentary: [{ minute: 24, text: "The ball goes out for a throw-in." }],
  statistics: { teams: { home: { possession: 48 }, away: { possession: 52 } }, players: {} },
  heatMaps: { home: [], away: [] },
  discipline: continuation.discipline,
  finalContinuation: continuation,
});
assert.equal(output.schema, PRODUCT_MATCH_OUTPUT_SCHEMA);
assert.equal(output.inputFingerprint, input.fingerprint);
assert.equal(output.finalContinuation.fingerprint, continuation.fingerprint);
assert.deepEqual(JSON.parse(JSON.stringify(output)), output);
assert.throws(() => createProductMatchOutput({
  inputFingerprint: "another-match", finalContinuation: continuation,
}), /different match input/);
console.log("PASS -- pause/resume state and renderer-neutral output remain tied to one match");

console.log("\n=== Contract module boundary ===");
const contractSource = source("../src/lib/productMatchContract.js");
assert.ok(!/\b(document|window|localStorage|sessionStorage)\b/.test(contractSource));
assert.ok(!contractSource.includes("Math.random"));
assert.ok(!contractSource.includes("match-lab.js"));
console.log("PASS -- the contract is DOM-free, deterministic and independent of Match Lab");

console.log("\nALL PASS");
