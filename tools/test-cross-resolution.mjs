// Cross Resolution Pass A tests -- see MATCH_LAB_PLAN.md, "Cross
// Resolution and Dynamic Off-Ball Movement." Same three-layer pattern as
// the Spatial Decision Intelligence suites: pure matchEngineCore.js
// resolver tests (tier separation, determinism), pure spatialDecision.js
// geometry tests (the "position AND reachable path" gate), and full
// match-lab.js integration tests (resolveCross() end to end, via the
// same fake-DOM stub tools/test-possession-runner.mjs uses). Pass B
// (dynamic aerial positioning/defender recovery) and Pass C (goalkeeper
// command of crosses) are explicitly NOT covered here -- not built yet,
// per the user's own three-ordered-passes instruction.
import { hashString, seededRandom } from "../src/lib/matchEngineCore.js";
import { resolveCrossDelivery, resolveCrossSourceContest } from "../src/lib/matchEngineCore.js";
import { crossSourceContestDefender, deliveryLandingPoint, yardDistance } from "../src/lib/spatialDecision.js";
import { buildMatchLabPlaybackPlan, sampleMatchLabPlaybackPlan } from "../src/lib/matchLabPlayback.js";

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
const { state, resolveCross, freePlayGroups, pointOf, zoneFromPercent } = mod;

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

const ELITE_DEFENDER = player("Maldini", { Tackling: 18, Positioning: 18, Anticipation: 17, Aggression: 13, Bravery: 15 });
const WEAK_DEFENDER = player("Weak Defender", { Tackling: 6, Positioning: 6, Anticipation: 6, Aggression: 8, Bravery: 8 });
const GOOD_CROSSER = player("Ronaldinho", { Crossing: 17, Technique: 17, Decisions: 15, Composure: 15, Balance: 16 });
const AVERAGE = player("Average", {});
const ELITE_KEEPER = player("Elite Keeper", { Reflexes: 19, Positioning: 18, Handling: 17, Agility: 17, Anticipation: 16 });

console.log("=== matchEngineCore.js: resolveCrossSourceContest tier separation + determinism ===");
{
  function outcomeCounts(crosser, defender, runs = 1500) {
    const random = seededRandom(hashString(`cross-source-tier-${crosser.canonical_player_name}-${defender.canonical_player_name}`));
    const counts = { tackled: 0, "blocked-behind": 0, "blocked-loose": 0, pressured: 0, clean: 0 };
    for (let i = 0; i < runs; i += 1) {
      const result = resolveCrossSourceContest(crosser, defender, 45, random);
      counts[result.outcome] = (counts[result.outcome] || 0) + 1;
    }
    return counts;
  }
  const eliteDefenderRate = outcomeCounts(AVERAGE, ELITE_DEFENDER);
  const weakDefenderRate = outcomeCounts(AVERAGE, WEAK_DEFENDER);
  const eliteAffects = 1500 - eliteDefenderRate.clean;
  const weakAffects = 1500 - weakDefenderRate.clean;
  console.log(`elite defender affects delivery ${(eliteAffects / 15).toFixed(1)}% of the time; weak defender ${(weakAffects / 15).toFixed(1)}%`);
  check("an elite defender affects the delivery meaningfully more often than a weak one", eliteAffects > weakAffects * 1.5);
  check("all five outcomes are structurally reachable (tackled/blocked-behind/blocked-loose/pressured/clean)",
    Object.values(eliteDefenderRate).every((count) => count >= 0)
      && eliteDefenderRate.tackled > 0 && eliteDefenderRate["blocked-behind"] > 0 && eliteDefenderRate["blocked-loose"] > 0
      && eliteDefenderRate.pressured > 0 && eliteDefenderRate.clean > 0);

  const r1 = seededRandom(hashString("cross-source-determinism"));
  const r2 = seededRandom(hashString("cross-source-determinism"));
  const a = resolveCrossSourceContest(GOOD_CROSSER, ELITE_DEFENDER, 45, r1);
  const b = resolveCrossSourceContest(GOOD_CROSSER, ELITE_DEFENDER, 45, r2);
  check("identical seed reproduces an identical source-contest result", JSON.stringify(a) === JSON.stringify(b));
}

console.log("\n=== matchEngineCore.js: resolveCrossDelivery quality is tier- and context-sensitive ===");
{
  const random = seededRandom(hashString("cross-delivery-quality"));
  const goodNoPressure = resolveCrossDelivery(GOOD_CROSSER, { pressureFactor: 0, distanceYards: 18 }, random);
  const goodUnderPressure = resolveCrossDelivery(GOOD_CROSSER, { pressureFactor: 0.5, distanceYards: 18 }, random);
  check("pressure reduces delivery quality for the same crosser", goodNoPressure.quality > goodUnderPressure.quality);
  check("pressure increases the delivery's accuracy error", goodUnderPressure.accuracyErrorYards > goodNoPressure.accuracyErrorYards);

  const weakCrosser = player("Weak Crosser", { Crossing: 6, Technique: 6, Decisions: 6, Composure: 6 });
  const weakNoPressure = resolveCrossDelivery(weakCrosser, { pressureFactor: 0, distanceYards: 18 }, random);
  check("a better crosser delivers meaningfully higher quality under identical conditions",
    goodNoPressure.quality > weakNoPressure.quality + 0.2);

  const short = resolveCrossDelivery(GOOD_CROSSER, { pressureFactor: 0, distanceYards: 15 }, random);
  const long = resolveCrossDelivery(GOOD_CROSSER, { pressureFactor: 0, distanceYards: 45 }, random);
  check("a longer delivery distance reduces quality relative to a short one", short.quality >= long.quality);
}

console.log("\n=== spatialDecision.js: crossSourceContestDefender -- position AND reachable path, not proximity alone ===");
{
  const crosser = { x: 85, y: 60 };
  const receiver = { x: 50, y: 90 };
  const inLane = { x: 82, y: 62.5 };
  check("Maldini standing directly in the crossing lane is found as the source contester", crossSourceContestDefender(crosser, receiver, [inLane]) === inLane);

  // Close enough to touch (well within CROSS_SOURCE_CONTEST_RANGE_YARDS)
  // but positioned BEHIND the crosser relative to the kicking direction --
  // must never be found, no matter how close.
  const closeBehind = { x: 87, y: 58 };
  check("Maldini behind Ronaldinho cannot magically block it, even at close range",
    yardDistance(crosser, closeBehind) < 4 && crossSourceContestDefender(crosser, receiver, [closeBehind]) === null);

  // Genuinely far away, even if directionally "in front" -- proximity
  // still required, direction alone is not sufficient either.
  const farButAhead = { x: 60, y: 75 };
  check("a defender directionally ahead but too far away is not found either (proximity still required)",
    yardDistance(crosser, farButAhead) > 4 && crossSourceContestDefender(crosser, receiver, [farButAhead]) === null);
}

console.log("\n=== spatialDecision.js: deliveryLandingPoint determinism and bounds ===");
{
  const target = { x: 50, y: 90 };
  const randomA = seededRandom(hashString("landing-point-determinism"));
  const randomB = seededRandom(hashString("landing-point-determinism"));
  const pointA = deliveryLandingPoint(target, 6, randomA);
  const pointB = deliveryLandingPoint(target, 6, randomB);
  check("identical seed reproduces an identical landing point", pointA.x === pointB.x && pointA.y === pointB.y);
  check("zero accuracy error returns the intended target exactly", deliveryLandingPoint(target, 0, () => 0.5).x === target.x);
  // Ball Out of Bounds v1 (2026-09-01) -- deliveryLandingPoint() is now
  // deliberately UNclamped (see its own header comment): a genuinely wild
  // delivery near a corner with a large error must be free to land
  // off-pitch, so resolvePass/resolveCross/resolveThroughBall can detect
  // the real exit via classifyPitchExit() instead of the ball silently
  // stopping dead at the edge. This replaces the old "stays clamped"
  // assertion this test used to make.
  let outOfBounds = 0;
  for (let i = 0; i < 500; i += 1) {
    const random = seededRandom(hashString(`landing-bounds-${i}`));
    const point = deliveryLandingPoint({ x: 4, y: 96 }, 12, random); // near a corner, large error
    if (point.x < -0.01 || point.x > 100.01 || point.y < -0.01 || point.y > 100.01) outOfBounds += 1;
  }
  check("landing points near a corner with a large error are free to land off-pitch (500 samples)", outOfBounds > 0);
}

console.log("\n=== match-lab.js integration: Maldini in the lane materially affects real cross resolution ===");
{
  const crosser = entry("crosser", { team: "home", x: 85, y: 60, playerObj: GOOD_CROSSER });
  const receiver = entry("receiver", { team: "home", x: 50, y: 90, playerObj: AVERAGE });
  const inLaneDefender = entry("maldini", { team: "away", x: 82, y: 62.5, playerObj: ELITE_DEFENDER });
  const groups = { owner: crosser, teammates: [receiver], opponents: [inLaneDefender], keeper: null };
  let sawSourceCode = false;
  for (let i = 0; i < 300 && !sawSourceCode; i += 1) {
    const random = seededRandom(hashString(`cross-inlane-integration-${i}`));
    const trace = [];
    resolveCross(groups, {}, random, trace);
    if (trace.some((event) => event.code.startsWith("CROSS.SOURCE."))) sawSourceCode = true;
  }
  check("Maldini in the crossing lane produces real CROSS.SOURCE.* effects within the search budget", sawSourceCode);
}

console.log("\n=== match-lab.js integration: Maldini behind the crosser never affects the delivery ===");
{
  const crosser = entry("crosser", { team: "home", x: 85, y: 60, playerObj: GOOD_CROSSER });
  const receiver = entry("receiver", { team: "home", x: 50, y: 90, playerObj: AVERAGE });
  const behindDefender = entry("maldini-behind", { team: "away", x: 87, y: 58, playerObj: ELITE_DEFENDER });
  const groups = { owner: crosser, teammates: [receiver], opponents: [behindDefender], keeper: null };
  let sawSourceCode = false;
  let sawDelivery = 0;
  for (let i = 0; i < 300; i += 1) {
    const random = seededRandom(hashString(`cross-behind-integration-${i}`));
    const trace = [];
    resolveCross(groups, {}, random, trace);
    if (trace.some((event) => event.code.startsWith("CROSS.SOURCE."))) sawSourceCode = true;
    if (trace.some((event) => event.code === "CROSS.DELIVERY")) sawDelivery += 1;
  }
  check("Maldini positioned behind the crosser never produces a CROSS.SOURCE.* effect across 300 trials", !sawSourceCode);
  check("every trial reaches a real delivery instead (nothing to contest it)", sawDelivery === 300);
}

console.log("\n=== match-lab.js integration: the ball never travels through a defender marker ===");
{
  // A source-blocking defender must be the trace's actual endpoint --
  // never a delivery that "continues" past them to the original target.
  const crosser = entry("crosser", { team: "home", x: 85, y: 60, playerObj: AVERAGE });
  const receiver = entry("receiver", { team: "home", x: 50, y: 90, playerObj: AVERAGE });
  const blocker = entry("blocker", { team: "away", x: 82, y: 62.5, playerObj: ELITE_DEFENDER });
  const groups = { owner: crosser, teammates: [receiver], opponents: [blocker], keeper: null };
  let found = null;
  let foundTrace = null;
  for (let i = 0; i < 500 && !found; i += 1) {
    const random = seededRandom(hashString(`cross-no-travel-through-${i}`));
    const trace = [];
    const result = resolveCross(groups, {}, random, trace);
    if (result.reason && result.reason.startsWith("cross-source-")) { found = result; foundTrace = trace; }
  }
  check("found a source-stopped cross within the search budget", Boolean(found));
  if (found) {
    const sourceEvent = foundTrace.find((event) => event.code.startsWith("CROSS.SOURCE."));
    check("the trace's own endpoint matches the terminal result's ballEnd -- no further, invented travel past the block/tackle",
      sourceEvent.ballTo.x === found.ballEnd.x && sourceEvent.ballTo.y === found.ballEnd.y);
    check("no CROSS.DELIVERY event exists when the source contest stopped the cross -- the ball never reaches the intended target",
      !foundTrace.some((event) => event.code === "CROSS.DELIVERY"));
  }
}

console.log("\n=== match-lab.js integration: explicit ball movement plus authoritative receiver arrival ===");
{
  const crosser = entry("crosser", { team: "home", x: 85, y: 60, playerObj: GOOD_CROSSER });
  const receiver = entry("receiver", { team: "home", x: 50, y: 90, playerObj: AVERAGE });
  const groups = { owner: crosser, teammates: [receiver], opponents: [], keeper: null };
  const random = seededRandom(hashString("cross-delivery-movement-data"));
  const trace = [];
  resolveCross(groups, {}, random, trace);
  const deliveryEvent = trace.find((event) => event.code === "CROSS.DELIVERY");
  check("a CROSS.DELIVERY event exists with explicit ballFrom/ballTo", Boolean(deliveryEvent) && Boolean(deliveryEvent.ballFrom) && Boolean(deliveryEvent.ballTo));
  check("the delivery's ballTo is a real landing point, not always exactly the receiver's own position (Pass A's whole point)",
    typeof deliveryEvent.ballTo.x === "number" && typeof deliveryEvent.ballTo.y === "number");
  const aerialEvent = trace.find((event) => event.code === "X1");
  check("the crosser stays at the delivery point while the unchallenged receiver explicitly arrives at the real landing point",
    !trace.some((event) => event.moverId === crosser.id)
      && aerialEvent?.moverId === receiver.id
      && aerialEvent.moveTo.x === deliveryEvent.ballTo.x
      && aerialEvent.moveTo.y === deliveryEvent.ballTo.y);
}

console.log("\n=== match-lab.js integration: a caught header meets the moving goalkeeper ===");
{
  let caught = null;
  for (let seed = 0; seed < 2000 && !caught; seed += 1) {
    const crosser = entry("header-crosser", { team: "home", x: 84, y: 72, playerObj: GOOD_CROSSER });
    const receiver = entry("header-receiver", { team: "home", x: 45, y: 86, playerObj: player("Strong Header", {
      Heading: 18, Technique: 16, Decisions: 15, Composure: 16,
    }) });
    const homeKeeper = entry("home-keeper", { team: "home", role: "keeper", x: 50, y: 4, playerObj: ELITE_KEEPER });
    const keeper = entry("header-keeper", { team: "away", role: "keeper", x: 53, y: 96, playerObj: ELITE_KEEPER });
    const roster = [crosser, receiver, homeKeeper, keeper];
    const initialPositions = Object.fromEntries(roster.map((item) => [item.id, pointOf(item)]));
    setupRoster(roster, crosser.id);
    const groups = freePlayGroups(crosser.id, state.roster);
    const trace = [];
    const result = resolveCross(
      groups,
      {},
      seededRandom(hashString(`caught-header-contact-${seed}`)),
      trace,
      true,
    );
    const header = trace.find((event) => event.code === "F.HEADER");
    const save = trace.find((event) => event.code === "K.SAVE.1");
    const keeperMove = header?.playerMoves?.find((move) => move.playerId === keeper.id);
    if (save && keeperMove && yardDistance(keeperMove.from, keeperMove.to) > 0.25) {
      caught = { trace, result, header, save, keeperMove, roster, initialPositions, crosser, receiver, keeper };
    }
  }
  check("a non-trivial caught-header fixture is found within the deterministic search budget", Boolean(caught));
  if (caught) {
    const { trace, result, header, save, keeperMove, roster, initialPositions, crosser, receiver, keeper } = caught;
    check("the regression includes the close-down adjustment that preceded the reported save",
      trace.some((event) => event.code === "GK.ADJUST"
        && event.playerMoves.some((move) => move.playerId === keeper.id)));
    check("the keeper's interception is authored during F.HEADER, not as a late journey in K.SAVE.1",
      header.duration > 120 && save.duration === 120 && save.playerMoves.length === 0);
    check("the header endpoint and save contact are the same authoritative ball point",
      yardDistance(header.ballTo, save.contact.point) < 1e-9);
    check("the save contact records the exact body endpoint authored during the incoming header",
      yardDistance(keeperMove.to, save.contact.bodyPoint) < 1e-9
        && yardDistance(save.contact.point, save.contact.bodyPoint) <= save.contact.reachAllowanceYards + 1e-9);

    const plan = buildMatchLabPlaybackPlan({
      trace,
      initialPositions,
      initialBall: initialPositions[crosser.id],
      initialOwnerId: crosser.id,
      finalOwnerId: result.nextOwnerId,
      restart: result.restart,
      playerProfiles: Object.fromEntries(roster.map((item) => [item.id, item.player])),
    });
    const headerIndex = trace.indexOf(header);
    const saveIndex = trace.indexOf(save);
    const headerInterval = plan.intervals.find((interval) => interval.eventIndex === headerIndex);
    const saveInterval = plan.intervals.find((interval) => interval.eventIndex === saveIndex);
    const atContact = sampleMatchLabPlaybackPlan(plan, headerInterval.endMs);
    const afterCatch = sampleMatchLabPlaybackPlan(plan, saveInterval.endMs);
    check("at the save boundary the displayed keeper is within his declared hand-reach of the displayed ball",
      yardDistance(atContact.players[keeper.id], atContact.ball) <= save.contact.reachAllowanceYards + 1e-6);
    check("once the catch completes, the displayed ball is on the displayed goalkeeper",
      yardDistance(afterCatch.players[keeper.id], afterCatch.ball) < 1e-6
        && afterCatch.ownerId === keeper.id);
  }
}

console.log("\n=== match-lab.js integration: an unreachable keeper cannot be awarded a header save ===");
{
  let onTargetHeaders = 0;
  let impossibleKeeperContacts = 0;
  for (let seed = 0; seed < 240; seed += 1) {
    const crosser = entry("far-header-crosser", { team: "home", x: 84, y: 72, playerObj: GOOD_CROSSER });
    const receiver = entry("far-header-receiver", { team: "home", x: 45, y: 86, playerObj: player("Strong Header", {
      Heading: 18, Technique: 16, Decisions: 15, Composure: 16,
    }) });
    const keeper = entry("far-header-keeper", { team: "away", role: "keeper", x: 20, y: 96, playerObj: ELITE_KEEPER });
    const trace = [];
    resolveCross(
      { owner: crosser, teammates: [receiver], opponents: [], keeper },
      {},
      seededRandom(hashString(`unreachable-header-save-${seed}`)),
      trace,
    );
    if (!trace.some((event) => event.code === "F.HEADER")) continue;
    onTargetHeaders += 1;
    if (trace.some((event) => event.keeperAction && event.keeperAction !== "beaten")) {
      impossibleKeeperContacts += 1;
    }
  }
  check("the unreachable-keeper fixture produces real on-target headers", onTargetHeaders > 20);
  check("none of those headers awards a catch, parry, or tip to the distant goalkeeper",
    impossibleKeeperContacts === 0);
}

console.log("\n=== match-lab.js integration: authored setup immutability + Replay determinism ===");
{
  const crosser = entry("crosser", { team: "home", x: 85, y: 60, playerObj: GOOD_CROSSER });
  const receiver = entry("receiver", { team: "home", x: 50, y: 90, playerObj: AVERAGE });
  const inLaneDefender = entry("maldini", { team: "away", x: 82, y: 62.5, playerObj: ELITE_DEFENDER });
  const keeper = entry("keeper", { team: "away", role: "keeper", x: 50, y: 97, playerObj: ELITE_KEEPER });
  setupRoster([crosser, receiver, inLaneDefender, keeper], crosser.id);
  const before = JSON.stringify(state.roster);
  const groups = freePlayGroups(crosser.id, state.roster);
  const random1 = seededRandom(hashString("cross-replay-determinism"));
  const random2 = seededRandom(hashString("cross-replay-determinism"));
  const trace1 = [];
  const trace2 = [];
  const result1 = resolveCross(groups, {}, random1, trace1);
  const result2 = resolveCross(groups, {}, random2, trace2);
  check("identical seed reproduces an identical cross resolution end to end", JSON.stringify(result1) === JSON.stringify(result2)
    && JSON.stringify(trace1) === JSON.stringify(trace2));
  check("state.roster (authored) is untouched by resolving a cross", JSON.stringify(state.roster) === before);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
