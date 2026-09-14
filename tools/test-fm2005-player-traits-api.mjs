import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { handleLocalApi } from "./identity/localApi.js";

const DATABASE = "fm2005_vanilla_original";

console.log("=== Local player-detail API ===");
const result = handleLocalApi(new URL(
  `http://localhost/local-api/api/players/${DATABASE}/4357`,
));
assert.equal(result.profile?.display_name, "Roberto Carlos");
assert.deepEqual(
  result.profile?.traits?.map((trait) => trait.sourceTraitId),
  [9, 10, 15, 37, 46],
);
assert.ok(result.profile.traits.every((trait) =>
  trait.key
  && trait.name
  && trait.sourceDatabaseSlug === DATABASE
  && trait.mappingVersion === "fm2005-ppm-v1"
));
console.log("PASS -- Roberto Carlos exposes five source-backed traits");

const noTrait = handleLocalApi(new URL(
  `http://localhost/local-api/api/players/${DATABASE}/1`,
));
assert.ok(Array.isArray(noTrait.profile?.traits));
console.log("PASS -- profiles without assignments expose an empty trait list");

console.log("=== Browser and Worker consumers ===");
const [browser, browserMirror, apiContract, apiMirror, worker] = await Promise.all([
  readFile("src/databaseSearch.js", "utf8"),
  readFile("docs/src/databaseSearch.js", "utf8"),
  readFile("src/lib/retroballApi.js", "utf8"),
  readFile("docs/src/lib/retroballApi.js", "utf8"),
  readFile("worker/src/index.ts", "utf8"),
]);
assert.equal(browser, browserMirror);
assert.equal(apiContract, apiMirror);
assert.match(browser, /function renderTraits\(profile\)/);
assert.match(worker, /FROM player_trait_source traits/);
assert.match(worker, /no such table: player_trait_\(source\|definition\)/);
console.log("PASS -- player traits are rendered and browser mirrors are current");
console.log("PASS -- the Worker queries traits and tolerates an unmigrated database");

console.log("\nALL PASS");
