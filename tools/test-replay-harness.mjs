// Saved Scenario Replay Harness -- Node runner.
//
// Loads every scenario JSON file under tools/replay-scenarios/ (or a single
// file/seed given on the command line), replays it through the exact same
// runConstructedPossession() the browser's Match Lab Free Play uses, and
// runs src/lib/replayHarness.js's assertion suite against the result.
// Also verifies each scenario replays byte-identically twice in a row
// (determinism is the whole premise this harness depends on -- see
// replayHarness.js's own header on why a seed alone is sufficient replay
// input).
//
// match-lab.js is a plain <script type="module"> page script, not a
// DOM-free library (~30 document.querySelector() results wired at
// top-level load) -- the minimal fake `document` below is the same
// convention tools/test-possession-runner.mjs already established, just
// enough for its module-load side effects to complete without a real DOM.
//
// Usage:
//   node tools/test-replay-harness.mjs                     # replay every saved scenario
//   node tools/test-replay-harness.mjs path/to/one.json     # replay just one file
//   node tools/test-replay-harness.mjs --seed-search        # regenerate the bundled fixtures
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from "node:fs";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = join(__dirname, "replay-scenarios");

function fakeStyle() {
  const props = {};
  return {
    setProperty(name, value) { props[name] = value; },
    removeProperty(name) { delete props[name]; },
    getPropertyValue(name) { return props[name] ?? ""; },
  };
}
function fakeClassList() {
  const set = new Set();
  return {
    add: (...names) => names.forEach((name) => set.add(name)),
    remove: (...names) => names.forEach((name) => set.delete(name)),
    toggle(name, force) {
      if (force === undefined) { set.has(name) ? set.delete(name) : set.add(name); }
      else if (force) set.add(name);
      else set.delete(name);
    },
    contains: (name) => set.has(name),
  };
}
function fakeElement() {
  const el = {
    className: "", style: fakeStyle(), dataset: {}, classList: fakeClassList(),
    children: [], parentNode: null, value: "", textContent: "", innerHTML: "", hidden: false,
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    removeAttribute() {}, setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; },
    querySelector() { return fakeElement(); },
    querySelectorAll() { return []; },
    appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
    removeChild(child) { const i = el.children.indexOf(child); if (i >= 0) el.children.splice(i, 1); return child; },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); },
    replaceChildren() { el.children = []; },
    focus() {}, click() {},
  };
  return el;
}
globalThis.document = {
  querySelector() { return fakeElement(); },
  querySelectorAll() { return []; },
  createElement() { return fakeElement(); },
  addEventListener() {},
  body: fakeElement(),
};
globalThis.window = globalThis;
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || ((fn) => setTimeout(fn, 0));
globalThis.cancelAnimationFrame = globalThis.cancelAnimationFrame || ((id) => clearTimeout(id));
globalThis.fetch = async () => { throw new Error("network disabled in test"); };

const matchLab = await import("../match-lab.js");
const { state, runConstructedPossession, pointOf, freshBurst01 } = matchLab;
const { buildMatchLabPlaybackPlan } = await import("../src/lib/matchLabPlayback.js");
const {
  applyScenarioToState, validateScenario, runAssertions, captureScenario, REPLAY_SCHEMA_VERSION,
  assertNoLowValuePassLoop,
} = await import("../src/lib/replayHarness.js");
const { hashString, seededRandom } = await import("../src/lib/matchEngineCore.js");

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} -- ${label}`);
  if (!condition) failures += 1;
}

const cappedResult = { reason: "max-actions-reached" };
const trappedMetrics = Array.from({ length: 50 }, (_, index) => ({
  ownerId: `cluster-${index % 3}`,
  selectedAction: index % 4 === 0 ? "hold" : "pass",
}));
const trappedTrace = Array.from({ length: 50 }, (_, index) => ({
  ballFrom: { x: 50 + (index % 2), y: 50 },
  ballTo: { x: 50, y: 50 + (index % 2) },
}));
check(
  "low-value-loop assertion still rejects a capped short-pass/hold cluster",
  !assertNoLowValuePassLoop(cappedResult, trappedMetrics, trappedTrace).pass,
);
const variedMetrics = Array.from({ length: 50 }, (_, index) => ({
  ownerId: `player-${index % 5}`,
  selectedAction: index % 4 === 0 ? "carry" : "pass",
}));
const variedTrace = [
  { ballFrom: { x: 50, y: 50 }, ballTo: { x: 50, y: 50 } },
  { ballFrom: { x: 50, y: 50 }, ballTo: { x: 50, y: 25 } },
];
check(
  "low-value-loop assertion does not mislabel varied play that leaves the cluster",
  assertNoLowValuePassLoop(cappedResult, variedMetrics, variedTrace).pass,
);

// Mirrors match-lab.js's own private buildPlaybackPlan() wrapper (Free
// Play branch only -- Scenario Probe has no possession concept and this
// harness never exercises it): builds the matchLabPlayback plan a
// checkpoint list is derived from, using the SAME initial-position/burst
// formulas the real page uses (pointOf()/freshBurst01(), both exported by
// match-lab.js for exactly this purpose -- see test-possession-runner.mjs's
// own precedent for driving match-lab.js's internals from Node).
function buildPlanFromRunOutput(runOutput) {
  const initialPositions = Object.fromEntries(state.roster.map((entry) => [entry.id, pointOf(entry)]));
  const initialOwner = state.roster.find((entry) => entry.id === state.ball.ownerId);
  const initialBall = initialOwner ? pointOf(initialOwner) : { ...state.ball };
  const initialBurst = Object.fromEntries(state.roster.map((entry) => [String(entry.id), freshBurst01(entry.player)]));
  return buildMatchLabPlaybackPlan({
    trace: runOutput.trace,
    initialPositions,
    initialBall,
    initialOwnerId: state.ball.ownerId,
    finalOwnerId: runOutput.finalOwnerId,
    restart: runOutput.result?.restart,
    playerProfiles: Object.fromEntries(state.roster.map((entry) => [String(entry.id), entry.player])),
    initialBurst,
  });
}

/** Replays one captured scenario. Returns { runOutput, plan, assertions }. */
function replayScenario(scenario) {
  const { valid, errors } = validateScenario(scenario);
  if (!valid) throw new Error(`Invalid scenario: ${errors.join("; ")}`);
  state.mode = "freeplay";
  const seed = applyScenarioToState(state, scenario);
  const runOutput = runConstructedPossession(seed);
  const plan = buildPlanFromRunOutput(runOutput);
  const assertions = runAssertions(runOutput, plan);
  return { runOutput, plan, assertions };
}

function runOne(filePath) {
  const scenario = JSON.parse(readFileSync(filePath, "utf8"));
  console.log(`\n=== ${filePath} ===`);
  if (scenario.reason) console.log(`  reason: ${scenario.reason}`);
  if (scenario.tags?.length) console.log(`  tags: ${scenario.tags.join(", ")}`);

  const first = replayScenario(scenario);
  const second = replayScenario(scenario);
  check(
    "replay is deterministic (identical trace on a second run of the same scenario)",
    JSON.stringify(first.runOutput.trace) === JSON.stringify(second.runOutput.trace),
  );

  for (const finding of first.assertions.findings) {
    check(finding.name, finding.pass);
    if (!finding.pass) console.log(`       ${finding.detail}`);
  }
  return first;
}

const args = process.argv.slice(2);

if (args[0] === "--seed-search") {
  await import("./build-replay-fixtures.mjs");
} else if (args.length && !args[0].startsWith("--")) {
  runOne(resolve(args[0]));
} else {
  let files = [];
  try {
    files = readdirSync(SCENARIOS_DIR).filter((name) => name.endsWith(".json")).sort();
  } catch {
    mkdirSync(SCENARIOS_DIR, { recursive: true });
  }
  if (!files.length) {
    console.log(`No saved scenarios found under ${SCENARIOS_DIR}. Run "node tools/test-replay-harness.mjs --seed-search" to generate the bundled regression fixtures.`);
  }
  for (const file of files) runOne(join(SCENARIOS_DIR, file));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);

export { replayScenario, buildPlanFromRunOutput };
