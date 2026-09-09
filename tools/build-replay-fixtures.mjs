// Regenerates the bundled Saved Scenario Replay Harness regression
// fixtures under tools/replay-scenarios/ -- one small, real, deterministic
// roster per failure pattern reported in new-issues.md, locked onto a
// specific seed via the same "search N seeds, keep the first one that
// reproduces the target trace pattern" convention every other tools/test-*
// suite in this repo already uses (see e.g. test-possession-runner.mjs's
// own dribble-advance/pass-intercepted searches).
//
// This intentionally does NOT hand-tune exact geometry to force a
// particular outcome -- it builds a plausible roster for the reported
// situation and lets the real engine decide what happens, over as many
// seeds as it takes to hit the target trace pattern. Whatever
// src/lib/replayHarness.js's assertions say about the result (pass or
// fail) is recorded as-is: a fixture that currently PASSES is a real
// regression guard; one that currently FAILS is a real, reproducible bug
// report that a future fix can point at directly, instead of hand-copied
// browser trace text.
//
// Run standalone: node tools/build-replay-fixtures.mjs
// Or via:         node tools/test-replay-harness.mjs --seed-search
import { writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SCENARIOS_DIR = join(__dirname, "replay-scenarios");

if (!globalThis.document) {
  const fakeStyle = () => {
    const props = {};
    return {
      setProperty(name, value) { props[name] = value; },
      removeProperty(name) { delete props[name]; },
      getPropertyValue(name) { return props[name] ?? ""; },
    };
  };
  const fakeClassList = () => {
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
  };
  const fakeElement = () => {
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
  };
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
}

const { state, runConstructedPossession, zoneFromPercent } = await import("../match-lab.js");
const { captureScenario } = await import("../src/lib/replayHarness.js");

function attrs(pairs) { return Object.entries(pairs).map(([label, value]) => ({ label, value })); }
function player(name, overrides) { return { canonical_player_name: name, current_ability: 150, attributes: attrs(overrides) }; }
function entry(id, { role = "player", team = "home", x, y, playerObj }) {
  return { id, role, team, player: playerObj, x, y, zone: zoneFromPercent(x, y) };
}

function search(label, buildRoster, ownerId, targetPredicate, { trials = 3000 } = {}) {
  for (let seed = 0; seed < trials; seed += 1) {
    state.mode = "freeplay";
    state.roster = buildRoster();
    state.ball = { x: 50, y: 50, zone: zoneFromPercent(50, 50), ownerId };
    const runOutput = runConstructedPossession(seed);
    if (targetPredicate(runOutput)) {
      console.log(`  found seed ${seed} for "${label}" after ${seed + 1} tr${seed === 0 ? "y" : "ies"}`);
      return { seed, runOutput };
    }
  }
  throw new Error(`Could not find a seed reproducing "${label}" within ${trials} trials.`);
}

function save(fileName, scenario) {
  if (!existsSync(SCENARIOS_DIR)) mkdirSync(SCENARIOS_DIR, { recursive: true });
  writeFileSync(join(SCENARIOS_DIR, fileName), `${JSON.stringify(scenario, null, 2)}\n`);
  console.log(`  saved ${fileName}`);
}

// --- Fixture 1: through ball nobody reaches -------------------------------
// new-issues.md, "through ball - passer chasing a loose ball issue": a
// through ball into space for a forward run resolves P.RECEIVE.LATE (the
// receiver can't get there before it runs loose) -- reported as always
// ending the possession by running out of play rather than settling or
// being recovered.
console.log("Fixture 1: through-ball-unreached");
{
  const PASSER = player("Through Passer", { Passing: 17, Technique: 16, Vision: 17, Decisions: 15, Teamwork: 14 });
  const RUNNER = player("Deep Runner", { Pace: 11, Acceleration: 11, "Off the Ball": 14, Decisions: 12 });
  const DEFENDER = player("Covering Defender", { Positioning: 13, Anticipation: 12, Pace: 14, Tackling: 12 });
  const KEEPER = player("Away Keeper", { Reflexes: 13, Handling: 12, Positioning: 13, "One On Ones": 12 });
  state.attackingDirection = { home: "down", away: "up" };
  const buildRoster = () => [
    entry("passer", { team: "home", x: 50, y: 45, playerObj: PASSER }),
    entry("runner", { team: "home", x: 55, y: 68, playerObj: RUNNER }),
    entry("defender", { team: "away", x: 52, y: 74, playerObj: DEFENDER }),
    entry("keeper", { team: "away", role: "keeper", x: 50, y: 97, playerObj: KEEPER }),
  ];
  const { seed, runOutput } = search(
    "through-ball-unreached",
    buildRoster,
    "passer",
    (runOutput) => runOutput.trace.some((event) => event.code === "P.RECEIVE.LATE"),
  );
  state.roster = buildRoster();
  state.ball = { x: 50, y: 45, zone: zoneFromPercent(50, 45), ownerId: "passer" };
  const scenario = captureScenario({
    state,
    seed,
    capturedAt: new Date().toISOString(),
    reason: "Through ball into space for a forward run resolves P.RECEIVE.LATE; reported as always exiting play rather than settling/being recovered (new-issues.md, \"through ball - passer chasing a loose ball issue\").",
    tags: ["through-ball", "loose-ball", "reported-bug"],
  });
  save("through-ball-unreached.json", scenario);
}

// --- Fixture 2: repeated carries draining burst quickly -------------------
// new-issues.md, "full speed denied issue": an attacker on an open pitch
// (11 home vs 0 away in the original report) is denied full sprint a few
// carries into a breakaway ("full-sprint denied (burst 34%)"). Reduced to
// a single attacker + goalkeeper here -- the reported mechanism is the
// PER-PLAYER burst drain across consecutive carries, which an 11-a-side
// roster doesn't change.
console.log("\nFixture 2: repeated-carry-burst-drain");
{
  const ATTACKER = player("Breakaway Attacker", {
    Pace: 15, Acceleration: 15, Dribbling: 14, Technique: 13, Stamina: 12,
    Decisions: 14, Vision: 12, Anticipation: 12, Composure: 13, "Off the Ball": 13,
  });
  const KEEPER = player("Away Keeper", { Reflexes: 13, Handling: 12, Positioning: 13, "One On Ones": 12 });
  state.attackingDirection = { home: "down", away: "up" };
  const buildRoster = () => [
    entry("attacker", { team: "home", x: 50, y: 30, playerObj: ATTACKER }),
    entry("keeper", { team: "away", role: "keeper", x: 50, y: 97, playerObj: KEEPER }),
  ];
  const { seed, runOutput } = search(
    "repeated-carry-burst-drain",
    buildRoster,
    "attacker",
    (runOutput) => {
      const carries = runOutput.decisionMetrics.filter((m) => m.ownerId === "attacker" && m.selectedAction === "carry");
      return carries.length >= 3;
    },
  );
  state.roster = buildRoster();
  state.ball = { x: 50, y: 30, zone: zoneFromPercent(50, 30), ownerId: "attacker" };
  const scenario = captureScenario({
    state,
    seed,
    capturedAt: new Date().toISOString(),
    reason: "An attacker on an open pitch carries the ball forward repeatedly; reported that full sprint gets denied a few touches in (\"full-sprint denied (burst 34%)\") faster than feels realistic (new-issues.md, \"full speed denied issue\").",
    tags: ["burst-stamina", "carry", "reported-bug"],
  });
  save("repeated-carry-burst-drain.json", scenario);
}

// --- Fixture 3: congested low-value pass loop ------------------------------
// new-issues.md, "congested play" issue: a tight cluster of teammates
// hot-potato short passes/holds among themselves without ever progressing,
// eventually hitting the POSSESSION_MAX_ACTIONS(50) cap without the
// possession ever organically resolving.
console.log("\nFixture 3: congested-pass-loop");
{
  const A = player("Cluster Player A", { Passing: 12, Technique: 12, Teamwork: 14, Decisions: 10, Vision: 10 });
  const B = player("Cluster Player B", { Passing: 12, Technique: 12, Teamwork: 14, Decisions: 10, Vision: 10 });
  const C = player("Cluster Player C", { Passing: 12, Technique: 12, Teamwork: 14, Decisions: 10, Vision: 10 });
  const D1 = player("Marking Defender 1", { Positioning: 13, Anticipation: 12, Tackling: 12, Decisions: 12 });
  const D2 = player("Marking Defender 2", { Positioning: 13, Anticipation: 12, Tackling: 12, Decisions: 12 });
  const KEEPER = player("Away Keeper", { Reflexes: 13, Handling: 12, Positioning: 13, "One On Ones": 12 });
  state.attackingDirection = { home: "down", away: "up" };
  const buildRoster = () => [
    entry("a", { team: "home", x: 48, y: 50, playerObj: A }),
    entry("b", { team: "home", x: 52, y: 48, playerObj: B }),
    entry("c", { team: "home", x: 50, y: 54, playerObj: C }),
    entry("d1", { team: "away", x: 47, y: 55, playerObj: D1 }),
    entry("d2", { team: "away", x: 53, y: 55, playerObj: D2 }),
    entry("keeper", { team: "away", role: "keeper", x: 50, y: 97, playerObj: KEEPER }),
  ];
  const { seed, runOutput } = search(
    "congested-pass-loop",
    buildRoster,
    "a",
    (runOutput) => runOutput.result.reason === "max-actions-reached",
  );
  state.roster = buildRoster();
  state.ball = { x: 48, y: 50, zone: zoneFromPercent(48, 50), ownerId: "a" };
  const scenario = captureScenario({
    state,
    seed,
    capturedAt: new Date().toISOString(),
    reason: "Three teammates clustered tightly together circulate short passes/holds among themselves without progressing until the possession hits the 50-action cap without ever organically resolving (new-issues.md, \"congested play, results a short pass loop\").",
    tags: ["congestion", "pass-loop", "reported-bug"],
  });
  save("congested-pass-loop.json", scenario);
}

console.log("\nDone.");
