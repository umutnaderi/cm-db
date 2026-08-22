// Off-Ball Goalkeeper Awareness & Shot Placement Geometry tests -- see
// MATCH_LAB_PLAN.md, "Off-Ball Goalkeeper Awareness & Shot Placement
// Geometry" (2026-08-18). A real browser round reported a striker who had
// clearly dribbled past a static keeper still "shooting backward" at the
// keeper's stale position, then getting saved -- rooted in two separate
// gaps: the keeper never reacted to the ball at all during Free Play
// possession progression, and goalPointFor()/the keeper-save call both
// blindly trusted the keeper's raw (possibly nonsensical) position
// regardless of whether they were actually still between the shooter and
// goal. Same three-layer pattern as every other suite here: pure
// spatialDecision.js geometry tests, then full match-lab.js integration
// tests, including the exact reported scenario reconstructed end to end.
// Carry-gait (nimble/jog/sprint) differentiation and general outfield
// (non-keeper) off-ball awareness are explicitly NOT covered here -- not
// built this pass, per the same scoping discipline every prior pass used.
import { hashString, seededRandom } from "../src/lib/matchEngineCore.js";
import { keeperPositioningPoint, PITCH_LENGTH_YARDS, PITCH_WIDTH_YARDS, toYardPoint, yardDistance } from "../src/lib/spatialDecision.js";

function fakeStyle() {
  return { setProperty() {}, removeProperty() {}, getPropertyValue() { return ""; } };
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
    className: "",
    style: fakeStyle(),
    dataset: {},
    classList: fakeClassList(),
    children: [],
    parentNode: null,
    value: "",
    textContent: "",
    innerHTML: "",
    hidden: false,
    addEventListener() {},
    removeEventListener() {},
    setAttribute() {},
    getAttribute() { return null; },
    removeAttribute() {},
    setPointerCapture() {},
    releasePointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; },
    querySelector(selector) {
      const idMatch = /\[data-id="([^"]+)"\]/.exec(selector || "");
      if (idMatch) return el.children.find((child) => child.dataset && child.dataset.id === idMatch[1]) || null;
      return fakeElement();
    },
    querySelectorAll(selector) {
      const classMatch = /^\.([\w-]+)$/.exec(selector || "");
      if (classMatch) return el.children.filter((child) => (child.className || "").split(/\s+/).includes(classMatch[1]));
      return [];
    },
    appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
    removeChild(child) {
      const index = el.children.indexOf(child);
      if (index >= 0) el.children.splice(index, 1);
      return child;
    },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); },
    replaceChildren() { el.children = []; },
    focus() {},
    click() {},
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

const mod = await import("../match-lab.js");
const { state, resolveCross, resolveShoot, runConstructedPossession, freePlayGroups, zoneFromPercent } = mod;

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} -- ${label}`);
  if (!condition) failures += 1;
}

function attrs(pairs) { return Object.entries(pairs).map(([label, value]) => ({ label, value })); }
function player(name, overrides) { return { canonical_player_name: name, current_ability: 150, attributes: attrs(overrides) }; }
function entry(id, { role = "player", team = "home", x, y, playerObj }) {
  return { id, role, team, player: playerObj, x, y, zone: zoneFromPercent(x, y) };
}
function setupRoster(entries, ownerId) {
  state.roster = entries;
  state.ball = { x: 50, y: 50, zone: zoneFromPercent(50, 50), ownerId };
  state.attackingDirection = { home: "down", away: "up" };
}

const GOOD_DRIBBLER = player("Ronaldinho", { Passing: 15, Technique: 18, Decisions: 15, Teamwork: 12, Dribbling: 18, Flair: 18, Acceleration: 16, Balance: 17, Vision: 16, Anticipation: 14, Composure: 15 });
const ELITE_KEEPER = player("Dida", { Reflexes: 17, Positioning: 16, Handling: 16, Agility: 15, Anticipation: 15 });
const AVERAGE = player("Average", {});

console.log("=== spatialDecision.js: keeperPositioningPoint -- narrows the angle, stays bounded ===");
{
  // keeperAttackingDirection "down" means the KEEPER'S team attacks
  // toward y:100 -- so their OWN goal (what this function positions them
  // in front of) is at y:0, not y:100. Every reference point below uses
  // that same convention.
  const ballDeep = { x: 50, y: 50 }; // far from the own goal at y:0
  const ballClose = { x: 50, y: 10 }; // close to it
  const farPoint = keeperPositioningPoint(ballDeep, "down");
  const closePoint = keeperPositioningPoint(ballClose, "down");
  check("keeper stays inside playable bounds for a deep ball", farPoint.x >= 0 && farPoint.x <= 100 && farPoint.y >= 0 && farPoint.y <= 100);
  check("keeper stays inside playable bounds for a close ball", closePoint.x >= 0 && closePoint.x <= 100 && closePoint.y >= 0 && closePoint.y <= 100);
  // Determinism -- pure geometry, no randomness consumed at all.
  const again = keeperPositioningPoint(ballDeep, "down");
  check("identical input reproduces an identical point (no hidden randomness)", farPoint.x === again.x && farPoint.y === again.y);

  // The keeper's advance off their own goal line is capped, never
  // wandering out past a realistic distance even for a ball at the
  // opposite end of the pitch (near y:100, far from the own goal at y:0).
  const veryFarBall = { x: 50, y: 98 };
  const veryFarPoint = keeperPositioningPoint(veryFarBall, "down");
  const advanceYards = toYardPoint(veryFarPoint).y; // distance FROM the own goal line at y:0
  check("advance off the goal line stays within a realistic bound even for a ball at the far end", advanceYards <= 12.01);

  // Colinearity -- the keeper's positioning point lies on (or extremely
  // close to) the straight line from the ball to their own goal center,
  // the real "narrow the angle" heuristic this implements.
  const ownGoalCenter = { x: 50, y: 0 };
  const wideBall = { x: 10, y: 40 };
  const widePoint = keeperPositioningPoint(wideBall, "down");
  const expectedSlope = (wideBall.x - ownGoalCenter.x) / (wideBall.y - ownGoalCenter.y);
  const actualSlope = (widePoint.x - ownGoalCenter.x) / (widePoint.y - ownGoalCenter.y);
  check("the keeper's point lies on the straight line between the ball and their own goal center",
    Math.abs(expectedSlope - actualSlope) < 0.01);

  // Monotonic -- a ball further from goal pulls the keeper further off
  // their own line (up to the cap), not a flat constant regardless of
  // distance.
  const nearGoal = keeperPositioningPoint({ x: 50, y: 8 }, "down");
  const midfield = keeperPositioningPoint({ x: 50, y: 40 }, "down");
  const nearAdvance = toYardPoint(nearGoal).y;
  const midAdvance = toYardPoint(midfield).y;
  check("a ball further from goal pulls the keeper further off their own line", midAdvance > nearAdvance);
}

console.log("\n=== match-lab.js integration: goalPointFor()/isKeeperBeaten() -- shot aims at the real open goal, not a beaten keeper's stale spot ===");
{
  // Reconstructs the reported screenshot's own geometry: Ronaldinho has
  // dribbled past Dida (Ronaldinho closer to the goal line than Dida is).
  const ronaldinho = entry("ronaldinho", { team: "home", x: 50, y: 95, playerObj: GOOD_DRIBBLER });
  const dida = entry("dida", { role: "keeper", team: "away", x: 48, y: 85, playerObj: ELITE_KEEPER });
  const groups = { owner: ronaldinho, teammates: [], opponents: [], keeper: dida };
  let sawEmptyNet = false;
  let sawSave = false;
  let aimsAtRealGoal = true;
  for (let i = 0; i < 300; i += 1) {
    const random = seededRandom(hashString(`beaten-keeper-shot-${i}`));
    const trace = [];
    const result = resolveShoot(groups, {}, random, trace);
    if (result.reason === "keeper-beaten-goal") {
      sawEmptyNet = true;
      const onTargetEvent = trace.find((event) => event.movement === "shot" && event.outcome === "success");
      if (!(onTargetEvent && !(onTargetEvent.ballTo.x === dida.x && onTargetEvent.ballTo.y === dida.y))) aimsAtRealGoal = false;
    }
    if (result.code && result.code.startsWith("K.SAVE")) sawSave = true;
  }
  check("a shooter who has genuinely rounded the keeper never gets saved -- always resolves as an open finish when on target", sawEmptyNet);
  check("resolveKeeperSave() is never called at all once the keeper is structurally beaten (no K.SAVE.* code appears)", !sawSave);
  check("across every such trial: the on-target shot's own ballTo is the real open goal, never Dida's stale position", aimsAtRealGoal);
}

console.log("\n=== match-lab.js integration: a keeper who IS still between the shooter and goal behaves exactly as before (no regression) ===");
{
  const shooter = entry("shooter", { team: "home", x: 50, y: 60, playerObj: GOOD_DRIBBLER });
  const keeper = entry("keeper", { role: "keeper", team: "away", x: 50, y: 92, playerObj: ELITE_KEEPER });
  const groups = { owner: shooter, teammates: [], opponents: [], keeper };
  let sawSave = false;
  let sawEmptyNet = false;
  for (let i = 0; i < 300; i += 1) {
    const random = seededRandom(hashString(`unbeaten-keeper-shot-${i}`));
    const trace = [];
    const result = resolveShoot(groups, {}, random, trace);
    if (result.code && result.code.startsWith("K.SAVE")) sawSave = true;
    if (result.reason === "keeper-beaten-goal" || result.reason === "empty-net-goal") sawEmptyNet = true;
  }
  check("a keeper genuinely positioned between the shooter and goal still gets to make real saves", sawSave);
  check("that same keeper never gets bypassed as 'beaten'", !sawEmptyNet);
}

console.log("\n=== match-lab.js integration: cross/header shares the identical beaten-keeper fix ===");
{
  const crosser = entry("crosser", { team: "home", x: 85, y: 60, playerObj: GOOD_DRIBBLER });
  const receiver = entry("receiver", { team: "home", x: 50, y: 97, playerObj: AVERAGE });
  const keeper = entry("keeper", { role: "keeper", team: "away", x: 48, y: 85, playerObj: ELITE_KEEPER });
  const groups = { owner: crosser, teammates: [receiver], opponents: [], keeper };
  let sawBeatenGoal = false;
  for (let i = 0; i < 300 && !sawBeatenGoal; i += 1) {
    const random = seededRandom(hashString(`cross-beaten-keeper-${i}`));
    const trace = [];
    const result = resolveCross(groups, {}, random, trace);
    if (result.reason === "keeper-beaten-goal") sawBeatenGoal = true;
  }
  check("a receiver who has arrived past the keeper's own position finishes into an open net, same as resolveShoot()", sawBeatenGoal);
}

console.log("\n=== match-lab.js integration: runConstructedPossession() -- the keeper genuinely reacts as the ball advances (the reported bug's own repro) ===");
{
  // The exact reported shape: a lone dribbler in open space against a
  // static keeper, several carries in a row toward goal.
  const ronaldinho = entry("ronaldinho", { team: "home", x: 50, y: 40, playerObj: GOOD_DRIBBLER });
  const dida = entry("dida", { role: "keeper", team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
  setupRoster([ronaldinho, dida], ronaldinho.id);
  const authoredKeeperPoint = { x: dida.x, y: dida.y };

  let sawAdjust = false;
  let keeperMovedTowardBall = false;
  let stateRosterUntouched = true;
  const beforeRosterJson = JSON.stringify(state.roster);
  for (let i = 0; i < 50 && !(sawAdjust && keeperMovedTowardBall); i += 1) {
    const run = runConstructedPossession(`gk-reacts-${i}`);
    if (run.trace.some((event) => event.code === "GK.ADJUST")) sawAdjust = true;
    const finalKeeper = run.finalPositions.find((p) => p.id === dida.id);
    if (finalKeeper && (finalKeeper.x !== authoredKeeperPoint.x || finalKeeper.y !== authoredKeeperPoint.y)) {
      keeperMovedTowardBall = true;
    }
    if (JSON.stringify(state.roster) !== beforeRosterJson) stateRosterUntouched = false;
  }
  check("the keeper genuinely moves at least once across these possessions (GK.ADJUST appears in the trace)", sawAdjust);
  check("the keeper's own simulated position actually changes from where they were authored, reacting to the ball", keeperMovedTowardBall);
  check("state.roster (authored) is untouched by any of this -- only the simulated clone moves", stateRosterUntouched);
}

console.log("\n=== match-lab.js integration: identical seed reproduces an identical keeper trajectory ===");
{
  const ronaldinho = entry("ronaldinho", { team: "home", x: 50, y: 40, playerObj: GOOD_DRIBBLER });
  const dida = entry("dida", { role: "keeper", team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
  setupRoster([ronaldinho, dida], ronaldinho.id);
  const run1 = runConstructedPossession("gk-determinism-seed");
  const run2 = runConstructedPossession("gk-determinism-seed");
  check("identical seed reproduces an identical trace, including every GK.ADJUST event",
    JSON.stringify(run1.trace) === JSON.stringify(run2.trace));
  check("identical seed reproduces identical finalPositions for the keeper too",
    JSON.stringify(run1.finalPositions) === JSON.stringify(run2.finalPositions));
}

console.log("\n=== match-lab.js integration: no keeper placed at all -- unaffected, no crash, same empty-net behavior ===");
{
  const ronaldinho = entry("ronaldinho", { team: "home", x: 50, y: 40, playerObj: GOOD_DRIBBLER });
  setupRoster([ronaldinho], ronaldinho.id);
  let ranWithoutError = true;
  let sawGoal = false;
  for (let i = 0; i < 30; i += 1) {
    try {
      const run = runConstructedPossession(`gk-none-placed-${i}`);
      if (run.result.reason === "empty-net-goal") sawGoal = true;
    } catch {
      ranWithoutError = false;
    }
  }
  check("no keeper placed at all -- the possession loop runs without error (no GK.ADJUST logic crashes on a missing keeper)", ranWithoutError);
  check("an on-target effort with no keeper anywhere still resolves as a genuine empty net", sawGoal);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
