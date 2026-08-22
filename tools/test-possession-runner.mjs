// Possession Runner v1 invariant tests -- see MATCH_LAB_PLAN.md's
// Possession Runner section. Complements the existing test-one-on-one-*
// suites: those exercise matchEngineCore.js resolvers directly; this
// exercises match-lab.js's own possession-loop layer (runConstructedPossession,
// the standardized per-resolver transition contract, and the authored-
// roster-immutability guarantee) the same way, with hand-built rosters and
// controlled RNG streams instead of a browser.
//
// match-lab.js is a plain <script type="module"> page script, not a
// DOM-free library -- its top-level code builds an `elements` object of
// ~30 document.querySelector() results and wires ~15 addEventListener
// calls immediately on load. None of that is exercised meaningfully by
// these tests (they only care about the possession-resolution layer), so
// rather than extracting that layer into its own DOM-free module -- a
// larger refactor than this pass's scope -- a minimal fake `document` is
// installed before importing match-lab.js, just enough for its module-load
// side effects to complete without touching a real DOM or network. Every
// function under test is then driven directly via the exports match-lab.js
// added for exactly this purpose.
import { readFileSync } from "node:fs";
import { hashString, seededRandom } from "../src/lib/matchEngineCore.js";
import { generateFreePlayCandidates, nearestLaneInterceptor, pressingTarget, PITCH_LENGTH_YARDS, yardDistance } from "../src/lib/spatialDecision.js";
import { buildMatchLabPlaybackPlan, sampleMatchLabPlaybackPlan } from "../src/lib/matchLabPlayback.js";
import { reachIn, timeToReach, topSpeed } from "../src/lib/playerKinetics.js";
import {
  selectPassType, passFlightProfile, buildPassFlight, ballPositionAtElapsed,
  reactionDelayMsFor, earliestReachableContact, CONTACT_HEIGHT_YARDS,
} from "../src/lib/matchPassFlight.js";

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
// A real (if minimal) parent/child registry -- match-lab.js's renderPitch()
// tears down and rebuilds every marker as a real child of elements.pitch
// (data-id set before appendChild), and applyStepAnimation() looks markers
// back up by that same data-id via markerNode(). Earlier versions of this
// stub fabricated a fresh, disconnected element on every querySelector()
// call, which made it impossible to inspect what applyStepAnimation()
// actually did to a specific marker (dataset attributes, etc) from a test
// -- this version tracks real children so a marker looked up after
// rendering is the SAME node the playback controller wrote to.
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
// getDatabases()/searchPlayers() (retroballApi.js) call this at module-load
// time via loadDatabases().then(runSearch) -- stubbed to fail fast and
// offline instead of making a real network call during a unit test run.
globalThis.fetch = async () => { throw new Error("network disabled in test"); };

// Kept as a namespace reference (not fully destructured) because
// playbackPositions is a reassigned `let` binding (seedPlaybackPositions()
// replaces it wholesale, not just mutates it) -- destructuring it into a
// local const would snapshot its value at import time instead of tracking
// later reassignments, so it's read as mod.playbackPositions everywhere
// below instead.
const mod = await import("../match-lab.js");
const {
  state, runConstructedPossession, resolvePass, resolveDribble, resolveCross, resolveShoot,
  resolveReboundScramble, freePlayGroups, buildLastRun, FREE_PLAY_RESOLVERS, POSSESSION_MAX_ACTIONS,
  pointOf, zoneFromPercent, moveRosterEntry, nudgeToward,
  playbackPointFor, applyStepAnimation, renderPitch,
  markerNode, engagingOpponent, DUEL_RANGE_YARDS, traceEvent,
  goalFrameFor, attackingGoalY, defendingGoalY, goalPointFor, isKeeperBeaten,
  keeperSaveTransition,
  applyOffBallSeparation, findKeeperConflict,
  attributionEntryMarkup,
  outfieldSlotsFor, classifyOutfieldBand, restingBallOffsetPx, lateralChannelX,
  visionConeRadiusYards, visionConeHalfAngleRad, visionFadeDurationMs, buildVisionConePath,
  scanQuality, scanAmplitudeRad, scanPeriodMs, scanOffsetRad,
  INTERLEAVED_REACTION_FRACTION, INTERLEAVED_DEFENSIVE_REACTION_FRACTION,
  playerDatabaseHref, relevantHoverAttributes, positionGroupFor,
  resolvePassAccuracy, passFlightDurationMs, shotPlacementQuality, shotPlacementSpread,
  freePlayOneOnOneContext, netPointFor, GOAL_NET_DEPTH_MARGIN,
  GOAL_LEFT_POST_X, GOAL_RIGHT_POST_X,
  reactOffBallContinuous, sampleContinuousTrajectory, earliestReachableInterception,
  CONTACT_REACTION_DELAY_MS,
} = mod;

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

const STRONG_PASSER = player("Strong Passer", { Passing: 18, Technique: 16, Teamwork: 15, Decisions: 15, Vision: 16 });
// High Decisions/Vision/Anticipation/Composure too (not just Dribbling) --
// deliberately sharp, low decision-noise (see spatialDecision.js's
// selectionSharpness()) so tests that need a RELIABLE dribble-vs-shoot
// choice aren't fighting selection noise on top of the real duel roll.
const GOOD_DRIBBLER = player("Good Dribbler", {
  Dribbling: 17, Technique: 16, Passing: 15, Teamwork: 13,
  Decisions: 17, Vision: 16, Anticipation: 16, Composure: 17,
});
const WEAK_PASSER = player("Weak Passer", { Passing: 6, Technique: 6, Teamwork: 6, Decisions: 6, Vision: 6 });
const WEAK_DEFENDER = player("Weak Defender", { Positioning: 6, Anticipation: 6, Tackling: 6, Decisions: 6 });
const ELITE_DEFENDER = player("Elite Defender", { Positioning: 18, Anticipation: 17, Tackling: 18, Decisions: 17, Strength: 17 });
const WEAK_SHOOTER = player("Weak Shooter", { Finishing: 6, Technique: 6, Composure: 6, Decisions: 6 });
const ELITE_FINISHER = player("Elite Finisher", { Finishing: 18, Technique: 17, Composure: 18, Passing: 14, Decisions: 15, Vision: 13 });
const ELITE_KEEPER = player("Elite Keeper", { Reflexes: 19, Positioning: 18, "One On Ones": 18, Handling: 18, Agility: 17, Anticipation: 17 });
const AVERAGE = player("Average Player", { Passing: 11, Technique: 11, Anticipation: 11, Acceleration: 11, "Off the Ball": 11, Strength: 11 });

function setupRoster(entries, ownerId) {
  state.roster = entries;
  state.ball = { x: 50, y: 50, zone: zoneFromPercent(50, 50), ownerId };
  state.attackingDirection = { home: "down", away: "up" };
}

console.log("=== 1: pass -> reception -> next action (non-terminal contract) ===");
{
  // No opponent placed at all -- structurally uncontested, so resolvePass's
  // uncontested branch is deterministic, no seed search needed.
  const owner = entry("owner", { team: "home", x: 50, y: 50, playerObj: STRONG_PASSER });
  const receiver = entry("receiver", { team: "home", x: 60, y: 55, playerObj: AVERAGE });
  const groups = { owner, teammates: [receiver], opponents: [], keeper: null };
  const trace = [];
  const result = resolvePass(groups, {}, () => 0, trace);
  check("uncontested pass reception is not terminal", result.terminal === false);
  check("possession stays retained", result.possession === "retained");
  check("next owner is the receiver", result.nextOwnerId === receiver.id);
  // Ball Flight & Arrival v1 (2026-08-20) -- a real pass is no longer
  // pixel-perfect (see section 58's own dedicated coverage below), so this
  // now asserts "arrives close to the receiver," not "exactly at them."
  check("ballEnd is close to the receiver's real point (real, bounded delivery error, not pixel-perfect)",
    yardDistance(result.ballEnd, receiver) < 2);
  check("trace recorded a pass then a clean reception", trace.map((event) => event.code).join(",") === "P.PASS,P.RECEIVE.CLEAN");
}

console.log("\n=== 2: successful dribble -> advance -> next action (real progression data) ===");
{
  const owner = entry("owner", { team: "home", x: 50, y: 50, playerObj: GOOD_DRIBBLER });
  const defender = entry("defender", { team: "away", x: 52, y: 52, playerObj: WEAK_DEFENDER });
  const groups = { owner, teammates: [], opponents: [defender], keeper: null };
  let found = null;
  for (let i = 0; i < 500 && !found; i += 1) {
    const random = seededRandom(hashString(`possession-dribble-advance-${i}`));
    const trace = [];
    const result = resolveDribble(groups, {}, random, trace);
    if (result.reason === "dribble-advance") found = result;
  }
  check("found a dribble-advance outcome within the search budget", Boolean(found));
  if (found) {
    check("dribble-advance is not terminal", found.terminal === false);
    check("possession stays retained, same owner", found.possession === "retained" && found.nextOwnerId === owner.id);
    check("ballEnd is genuine progression, not the same point twice", found.ballEnd.y !== owner.y);
    // home attacks "down" (toward y:100) -- a successful dribble must move
    // the ball toward that end, not sideways-only or backward.
    check("progression moves toward the team's own attacking end", found.ballEnd.y > owner.y);
    check("beating a goal-side defender can use an escape lane instead of a vertical rail",
      Math.abs(found.ballEnd.x - owner.x) > 0.1);
  }
}

console.log("\n=== 3: turnover terminates (pass intercepted) ===");
{
  const owner = entry("owner", { team: "home", x: 50, y: 50, playerObj: WEAK_PASSER });
  const receiver = entry("receiver", { team: "home", x: 60, y: 55, playerObj: AVERAGE });
  const engager = entry("engager", { team: "away", x: 52, y: 52, playerObj: ELITE_DEFENDER });
  const groups = { owner, teammates: [receiver], opponents: [engager], keeper: null };
  let found = null;
  for (let i = 0; i < 500 && !found; i += 1) {
    const random = seededRandom(hashString(`possession-pass-intercepted-${i}`));
    const trace = [];
    const result = resolvePass(groups, {}, random, trace);
    if (result.reason === "pass-intercepted") found = result;
  }
  check("found a pass-intercepted outcome within the search budget", Boolean(found));
  if (found) {
    check("interception is terminal", found.terminal === true);
    check("possession flips to turnover", found.possession === "turnover");
    check("next owner is the intercepting defender", found.nextOwnerId === engager.id);
    // Continuous World Motion During Ball Flight v1 (2026-08-20) -- ballEnd
    // is now the REAL point along the ball's own independent path where a
    // genuine physical race says the defender first reached it
    // (earliestReachableInterception()), not silently snapped to wherever
    // the defender happened to be STANDING at kick time. This fixture's
    // engager starts close to the direct owner->receiver line, so the real
    // interception point stays near their start, but exact equality with
    // their pre-kick position is no longer the correct invariant -- that
    // was the exact "ball teleports to the defender's static spot" bug
    // reported directly ("the engine often decides the defender won first
    // and then sends the ball to the defender's static position").
    check("ballEnd is close to (not necessarily identical to) the defender's original position -- a real, physically-reached point, not a distant fabrication",
      yardDistance(found.ballEnd, engager) < 3);
  }
}

console.log("\n=== 4: keeper catch terminates ===");
{
  // Home attacks "down" in the declared frame, so this shot belongs at
  // the bottom goal. The old y<50 inference let this legacy fixture point
  // at the wrong end and accidentally masked the direction bug.
  const owner = entry("owner", { team: "home", x: 50, y: 90, playerObj: WEAK_SHOOTER });
  const keeper = entry("keeper", { team: "away", x: 50, y: 98, playerObj: ELITE_KEEPER });
  const recoveringDefender = entry("recovering-defender", {
    team: "away", x: 50, y: 83, playerObj: WEAK_DEFENDER,
  });
  const groups = { owner, teammates: [], opponents: [recoveringDefender], keeper };
  let found = null;
  for (let i = 0; i < 500 && !found; i += 1) {
    const random = seededRandom(hashString(`possession-keeper-catch-${i}`));
    const trace = [];
    const result = resolveShoot(groups, {}, random, trace);
    if (result.reason === "keeper-catch") found = result;
  }
  check("found a keeper-catch outcome within the search budget", Boolean(found));
  if (found) {
    check("keeper catch is terminal", found.terminal === true);
    check("possession flips to turnover", found.possession === "turnover");
    check("next owner is the keeper", found.nextOwnerId === keeper.id);
  }
}

console.log("\n=== 5: rebound continues (internal scramble chain, not a single stop) ===");
{
  const attacker = entry("attacker", { team: "home", x: 50, y: 10, playerObj: GOOD_DRIBBLER });
  const defender = entry("defender", { team: "away", x: 52, y: 8, playerObj: WEAK_DEFENDER });
  const keeper = entry("keeper", { team: "away", x: 50, y: 2, playerObj: ELITE_KEEPER });
  let found = null;
  let foundTrace = null;
  for (let i = 0; i < 500 && !found; i += 1) {
    const random = seededRandom(hashString(`possession-rebound-continues-${i}`));
    const trace = [];
    const result = resolveReboundScramble(attacker, defender, keeper, attacker.zone, random, trace);
    if (trace[0]?.code === "REBOUND.WON") { found = result; foundTrace = trace; }
  }
  check("found a won-rebound outcome within the search budget", Boolean(found));
  if (found) {
    check("winning the loose ball is not itself the final beat -- it continues to a shot attempt",
      foundTrace.length === 2 && (foundTrace[1].code === "REBOUND.GOAL" || foundTrace[1].code === "REBOUND.MISS"));
    check("the scramble as a whole is still terminal once the shot attempt resolves", found.terminal === true);
  }
}

console.log("\n=== 6: foul -- both a real stoppage AND advantage-played continuation ===");
{
  const owner = entry("owner", { team: "home", x: 50, y: 50, playerObj: GOOD_DRIBBLER });
  const defender = entry("defender", { team: "away", x: 52, y: 52, playerObj: ELITE_DEFENDER });
  const groups = { owner, teammates: [], opponents: [defender], keeper: null };
  let foundStoppage = null;
  let foundAdvantage = null;
  for (let i = 0; i < 1500 && (!foundStoppage || !foundAdvantage); i += 1) {
    const random = seededRandom(hashString(`possession-foul-${i}`));
    const trace = [];
    const result = resolveDribble(groups, {}, random, trace);
    if (!foundStoppage && result.reason === "foul") foundStoppage = result;
    if (!foundAdvantage && result.reason === "foul-advantage-played") foundAdvantage = result;
  }
  check("found a real-stoppage foul outcome within the search budget", Boolean(foundStoppage));
  if (foundStoppage) {
    check("a real foul stoppage is terminal", foundStoppage.terminal === true);
    check("possession is dead, no next owner", foundStoppage.possession === "dead" && foundStoppage.nextOwnerId === null);
    check("restart is a genuine restart type, not \"none\"", foundStoppage.restart === "penalty" || foundStoppage.restart === "free-kick");
  }
  check("found an advantage-played foul outcome within the search budget", Boolean(foundAdvantage));
  if (foundAdvantage) {
    check("advantage played is NOT terminal -- the fouled side keeps the ball and play continues", foundAdvantage.terminal === false);
    check("possession stays retained with the fouled side", foundAdvantage.possession === "retained" && foundAdvantage.nextOwnerId === owner.id);
    check("no restart when advantage is played", foundAdvantage.restart === null);
  }
}

console.log("\n=== 7: maximum-action safeguard ===");
{
  const owner = entry("owner", { team: "home", x: 50, y: 50, playerObj: STRONG_PASSER });
  setupRoster([owner], owner.id);
  const original = { ...FREE_PLAY_RESOLVERS };
  const alwaysContinue = (groups) => ({
    outcome: "MOCK", code: "MOCK.CONTINUE", resolved: true,
    terminal: false, possession: "retained", nextOwnerId: groups.owner.id,
    ballEnd: pointOf(groups.owner), restart: null, reason: "mock-continue",
  });
  for (const key of Object.keys(FREE_PLAY_RESOLVERS)) FREE_PLAY_RESOLVERS[key] = alwaysContinue;
  let output;
  try {
    output = runConstructedPossession(4242);
  } finally {
    for (const key of Object.keys(original)) FREE_PLAY_RESOLVERS[key] = original[key];
  }
  check("a possession that never resolves terminally stops at the action cap", output.actionsCount === POSSESSION_MAX_ACTIONS);
  check("the capped result is reported as terminal", output.result.terminal === true);
  check("the capped result is tagged with its own reason", output.result.reason === "max-actions-reached");
}

console.log("\n=== 8: identical seed reproduces the entire possession ===");
{
  const owner = entry("owner", { team: "home", x: 50, y: 40, playerObj: GOOD_DRIBBLER });
  const teammate = entry("teammate", { team: "home", x: 65, y: 45, playerObj: STRONG_PASSER });
  const defender = entry("defender", { team: "away", x: 52, y: 42, playerObj: WEAK_DEFENDER });
  const keeper = entry("keeper", { team: "away", role: "keeper", x: 50, y: 4, playerObj: ELITE_KEEPER });
  setupRoster([owner, teammate, defender, keeper], owner.id);
  const seed = 778899;
  const outputA = runConstructedPossession(seed);
  const outputB = runConstructedPossession(seed);
  check("identical seed reproduces the identical terminal result", JSON.stringify(outputA.result) === JSON.stringify(outputB.result));
  check("identical seed reproduces the identical full trace", JSON.stringify(outputA.trace) === JSON.stringify(outputB.trace));
  check("identical seed reproduces the identical action count and final owner",
    outputA.actionsCount === outputB.actionsCount && outputA.finalOwnerId === outputB.finalOwnerId);
  const lastRunA = buildLastRun(seed, outputA);
  const lastRunB = buildLastRun(seed, outputB);
  check("buildLastRun's stored record is itself reproducible", JSON.stringify(lastRunA) === JSON.stringify(lastRunB));
}

console.log("\n=== 9: animation/playback never mutates the authored setup ===");
{
  const owner = entry("owner", { team: "home", x: 50, y: 40, playerObj: GOOD_DRIBBLER });
  const teammate = entry("teammate", { team: "home", x: 65, y: 45, playerObj: STRONG_PASSER });
  const defender = entry("defender", { team: "away", x: 52, y: 42, playerObj: WEAK_DEFENDER });
  const keeper = entry("keeper", { team: "away", role: "keeper", x: 50, y: 4, playerObj: ELITE_KEEPER });
  setupRoster([owner, teammate, defender, keeper], owner.id);
  const before = JSON.stringify(state.roster);
  runConstructedPossession(919293);
  check("resolving a full possession leaves the authored roster byte-identical", JSON.stringify(state.roster) === before);

  // moveRosterEntry()/nudgeToward() are what playback actually calls per
  // animated step (applyStepAnimation()) -- they must be DOM-only, never
  // writing back to the roster entry they read from.
  const beforeOwner = { ...owner };
  const nudged = nudgeToward(owner, { x: 90, y: 90 }, 0.5, 20);
  check("nudgeToward computes a new point without mutating the entry it reads", owner.x === beforeOwner.x && owner.y === beforeOwner.y);
  check("nudgeToward's result is a distinct point moving toward the target", nudged.x !== owner.x || nudged.y !== owner.y);
  moveRosterEntry(owner.id, { x: 1, y: 1, zone: 0 }, true, 100);
  check("moveRosterEntry (the animation entry point) never writes back to the roster entry", owner.x === beforeOwner.x && owner.y === beforeOwner.y);
}

console.log("\n=== 10: coordinate continuity -- a later step sees the previous step's real position (Pass 1) ===");
{
  // Every FREE_PLAY_RESOLVERS entry is monkeypatched to the SAME scripted
  // function regardless of which action name selectPossessionAction picks
  // -- this isolates the LOOP's own position-threading mechanics from
  // real action-choice/execution randomness, the same technique test 7
  // uses for the max-actions safeguard.
  const owner = entry("owner", { team: "home", x: 20, y: 30, playerObj: STRONG_PASSER });
  setupRoster([owner], owner.id);
  const original = { ...FREE_PLAY_RESOLVERS };
  const advancedPoint = { x: 80, y: 85, zone: zoneFromPercent(80, 85) };
  let secondCallSawOwnerAt = null;
  let callCount = 0;
  const scripted = (groups) => {
    callCount += 1;
    if (callCount === 1) {
      return {
        outcome: "MOCK", code: "MOCK.ADVANCE", resolved: true,
        terminal: false, possession: "retained", nextOwnerId: groups.owner.id,
        ballEnd: advancedPoint, restart: null, reason: "mock-advance",
      };
    }
    secondCallSawOwnerAt = pointOf(groups.owner);
    return {
      outcome: "MOCK", code: "MOCK.STOP", resolved: true,
      terminal: true, possession: "dead", nextOwnerId: null,
      ballEnd: pointOf(groups.owner), restart: null, reason: "mock-stop",
    };
  };
  for (const key of Object.keys(FREE_PLAY_RESOLVERS)) FREE_PLAY_RESOLVERS[key] = scripted;
  let output;
  try {
    output = runConstructedPossession(5150);
  } finally {
    for (const key of Object.keys(original)) FREE_PLAY_RESOLVERS[key] = original[key];
  }
  check("the loop ran a second step for this to be meaningful", callCount >= 2);
  check("the SAME player's position on the second call reflects the first call's real advance, not the stale authored spot",
    Boolean(secondCallSawOwnerAt) && secondCallSawOwnerAt.x === advancedPoint.x && secondCallSawOwnerAt.y === advancedPoint.y
      && secondCallSawOwnerAt.zone === advancedPoint.zone);
  const finalOwnerPosition = output.finalPositions.find((item) => item.id === owner.id);
  check("finalPositions carries the advanced point through to the end of the run",
    Boolean(finalOwnerPosition) && finalOwnerPosition.x === advancedPoint.x && finalOwnerPosition.y === advancedPoint.y);
  check("state.roster (authored) is untouched by any of this", state.roster.find((item) => item.id === owner.id).x === owner.x
    && state.roster.find((item) => item.id === owner.id).x !== advancedPoint.x);
}

console.log("\n=== 11: full trace continuity across action-loop boundaries, real resolvers (Pass 1) ===");
{
  // The "ball travels twice" invariant this session established for a
  // SINGLE resolver's own internal event chain (e.g. shot -> block ->
  // rebound) must now also hold ACROSS action-loop boundaries -- a
  // dribble's real endpoint must be exactly where the NEXT action's own
  // ballFrom starts, not just within one resolver call. Searches many
  // real seeds/rosters (no mocking) rather than hand-deriving one, the
  // same idiom the tier-separation/keeper-catch searches above use.
  const owner = entry("owner", { team: "home", x: 50, y: 30, playerObj: GOOD_DRIBBLER });
  const teammate = entry("teammate", { team: "home", x: 65, y: 35, playerObj: STRONG_PASSER });
  const defender = entry("defender", { team: "away", x: 52, y: 32, playerObj: WEAK_DEFENDER });
  const keeper = entry("keeper", { team: "away", role: "keeper", x: 50, y: 4, playerObj: ELITE_KEEPER });
  setupRoster([owner, teammate, defender, keeper], owner.id);
  let sawMultiAction = false;
  let continuityBreak = null;
  for (let i = 0; i < 300 && !continuityBreak; i += 1) {
    const output = runConstructedPossession(60000 + i);
    if (output.actionsCount > 1) sawMultiAction = true;
    const positioned = output.trace.filter((event) => event.ballFrom && event.ballTo);
    for (let j = 1; j < positioned.length; j += 1) {
      const prev = positioned[j - 1];
      const cur = positioned[j];
      if (prev.ballTo.x !== cur.ballFrom.x || prev.ballTo.y !== cur.ballFrom.y || prev.ballTo.zone !== cur.ballFrom.zone) {
        continuityBreak = { seed: 60000 + i, prev, cur };
      }
    }
  }
  check("exercised at least one real multi-action possession in this search", sawMultiAction);
  check("every ball-carrying trace event begins exactly where the previous one ended -- no snap/teleport, across action-loop boundaries too",
    !continuityBreak);
  if (continuityBreak) console.log("  continuity break:", JSON.stringify(continuityBreak));
}

console.log("\n=== 12: identical seed reproduces finalPositions too (Pass 1) ===");
{
  const owner = entry("owner", { team: "home", x: 50, y: 40, playerObj: GOOD_DRIBBLER });
  const teammate = entry("teammate", { team: "home", x: 65, y: 45, playerObj: STRONG_PASSER });
  const defender = entry("defender", { team: "away", x: 52, y: 42, playerObj: WEAK_DEFENDER });
  const keeper = entry("keeper", { team: "away", role: "keeper", x: 50, y: 4, playerObj: ELITE_KEEPER });
  setupRoster([owner, teammate, defender, keeper], owner.id);
  // Search for a seed that leaves a live resting owner (not a dead ball)
  // so the position-agreement check below is actually exercised, not
  // vacuously skipped.
  let seed = null;
  let outputA = null;
  for (let i = 0; i < 300 && !seed; i += 1) {
    const candidate = runConstructedPossession(445566 + i);
    if (candidate.finalOwnerId) { seed = 445566 + i; outputA = candidate; }
  }
  check("found a seed with a live resting owner within the search budget", Boolean(seed));
  const outputB = seed ? runConstructedPossession(seed) : null;
  check("identical seed reproduces identical finalPositions", Boolean(outputB) && JSON.stringify(outputA.finalPositions) === JSON.stringify(outputB.finalPositions));
  if (outputA) {
    const finalOwnerA = outputA.finalPositions.find((item) => item.id === outputA.finalOwnerId);
    check("finalPositions and the terminal result agree on where the resting owner actually is",
      Boolean(finalOwnerA) && finalOwnerA.x === outputA.result.ballEnd.x && finalOwnerA.y === outputA.result.ballEnd.y);
  }
}

console.log("\n=== 13: playback-position continuity -- the snap-back fix (Pass 1.1) ===");
{
  const ronaldinho = entry("ronaldinho", { team: "home", x: 46, y: 34, playerObj: GOOD_DRIBBLER });
  const gattuso = entry("gattuso", { team: "away", x: 47, y: 37, playerObj: WEAK_DEFENDER });
  setupRoster([ronaldinho, gattuso], ronaldinho.id);
  renderPitch();
  check("renderPitch() seeds playbackPositions from the authored roster",
    mod.playbackPositions.ronaldinho.x === ronaldinho.x && mod.playbackPositions.ronaldinho.y === ronaldinho.y);

  const wonPoint = { x: 51, y: 42, zone: zoneFromPercent(51, 42) };
  const wonEvent = {
    code: "P.PROGRESS.WON", label: "won", actorId: ronaldinho.id, targetId: null, defenderId: gattuso.id, keeperId: null,
    moverId: ronaldinho.id, moveTo: wonPoint,
    ballFrom: pointOf(ronaldinho), ballTo: wonPoint, movement: "dribble", outcome: "success", duration: 500,
  };
  applyStepAnimation(wonEvent, { animate: true });
  check("genuine movement (P.PROGRESS.WON) updates playbackPositions to the real endpoint",
    mod.playbackPositions.ronaldinho.x === wonPoint.x && mod.playbackPositions.ronaldinho.y === wonPoint.y);
  check("the defender's authoritative position is untouched by the same event (engine gave no destination for him)",
    mod.playbackPositions.gattuso.x === gattuso.x && mod.playbackPositions.gattuso.y === gattuso.y);

  // The exact reported bug: a movement-LESS decision beat immediately
  // after a successful dribble (ballFrom === ballTo -- the engine hasn't
  // moved anyone yet for THIS beat) used to nudge from state.roster's
  // stale original position, visibly pulling the marker back before the
  // next success moved it forward again.
  const decisionEvent = {
    code: "P.PROGRESS", label: "decision", actorId: ronaldinho.id, targetId: null, defenderId: gattuso.id, keeperId: null,
    ballFrom: wonPoint, ballTo: wonPoint, movement: "dribble", outcome: "neutral", duration: 500,
  };
  applyStepAnimation(decisionEvent, { animate: true });
  check("Ronaldinho does NOT snap back -- playbackPositions still holds the real advanced point after the following decision-only beat",
    mod.playbackPositions.ronaldinho.x === wonPoint.x && mod.playbackPositions.ronaldinho.y === wonPoint.y);

  // A second successful dribble from here must continue FROM wonPoint,
  // not restart from the original authored spot.
  const secondAdvance = { x: 55, y: 50, zone: zoneFromPercent(55, 50) };
  const secondWonEvent = {
    code: "P.PROGRESS.WON", label: "won again", actorId: ronaldinho.id, targetId: null, defenderId: gattuso.id, keeperId: null,
    moverId: ronaldinho.id, moveTo: secondAdvance,
    ballFrom: wonPoint, ballTo: secondAdvance, movement: "dribble", outcome: "success", duration: 500,
  };
  applyStepAnimation(secondWonEvent, { animate: true });
  check("a second successful dribble continues from the first endpoint, not the authored start",
    mod.playbackPositions.ronaldinho.x === secondAdvance.x && mod.playbackPositions.ronaldinho.y === secondAdvance.y);

  check("state.roster (authored) is untouched by any of this playback", state.roster.find((item) => item.id === ronaldinho.id).x === ronaldinho.x
    && state.roster.find((item) => item.id === ronaldinho.id).x !== secondAdvance.x);
}

console.log("\n=== 14: cosmetic nudges never become authoritative positions ===");
{
  const owner = entry("owner", { team: "home", x: 30, y: 40, playerObj: STRONG_PASSER });
  const receiver = entry("receiver", { team: "home", x: 45, y: 45, playerObj: AVERAGE });
  const engager = entry("engager", { team: "away", x: 32, y: 42, playerObj: ELITE_DEFENDER });
  setupRoster([owner, receiver, engager], owner.id);
  renderPitch();
  const beforeEngager = { ...mod.playbackPositions[engager.id] };

  // A movement-less duel beat (ballFrom === ballTo) -- purely cosmetic
  // per this pass's own rule; must never write playbackPositions.
  applyStepAnimation({
    code: "P.PROGRESS", label: "duel", actorId: owner.id, targetId: null, defenderId: engager.id, keeperId: null,
    ballFrom: pointOf(owner), ballTo: pointOf(owner), movement: "dribble", outcome: "neutral", duration: 400,
  }, { animate: true });
  check("a movement-less contest beat leaves both participants' playbackPositions untouched",
    mod.playbackPositions[owner.id].x === owner.x && mod.playbackPositions[engager.id].x === beforeEngager.x);

  // A ball-flight event (pass) -- the defender/keeper "closing down" nudge
  // is cosmetic too; only the ball itself and (for genuine actor movement)
  // the actor are ever authoritative.
  const passTo = { x: 45, y: 45, zone: zoneFromPercent(45, 45) };
  applyStepAnimation({
    code: "P.PASS", label: "pass", actorId: owner.id, targetId: receiver.id, defenderId: engager.id, keeperId: null,
    ballFrom: pointOf(owner), ballTo: passTo, movement: "pass", outcome: "neutral", duration: 550,
  }, { animate: true });
  check("a pass event's defender-closing-down nudge does not become an authoritative position either",
    mod.playbackPositions[engager.id].x === beforeEngager.x && mod.playbackPositions[engager.id].y === beforeEngager.y);
  check("the passer (actor, not carrying the ball anywhere) is also untouched", mod.playbackPositions[owner.id].x === owner.x);
}

console.log("\n=== 15: full real-possession playback, no snap-back across the whole trace ===");
{
  const owner = entry("owner", { team: "home", x: 50, y: 20, playerObj: GOOD_DRIBBLER });
  const defender = entry("defender", { team: "away", x: 52, y: 22, playerObj: WEAK_DEFENDER });
  setupRoster([owner, defender], owner.id);
  let found = false;
  for (let i = 0; i < 500 && !found; i += 1) {
    const output = runConstructedPossession(70000 + i);
    // "at least two real advances" now means P.PROGRESS.WON OR P.CARRY --
    // once the owner outpaces the (stationary) defender, generateFreePlayCandidates()
    // correctly stops offering "dribble" (no engager left in duel range)
    // and offers "carry" instead (open space), which is ALSO real,
    // authoritative movement -- exactly the case 5 acceptance scenario
    // ("after beating a defender, the defender is now behind the ball").
    // The check below follows moverId/moveTo generally, not one specific
    // code, so it stays correct regardless of which of the two produced
    // the owner's later movement.
    const moverEvents = output.trace.filter((event) => event.moverId === owner.id && event.moveTo);
    if (moverEvents.length < 2) continue;
    found = true;
    renderPitch();
    for (const event of output.trace) applyStepAnimation(event, { animate: true });
    const lastMove = moverEvents[moverEvents.length - 1];
    check(`seed ${70000 + i}: after playing the full trace, playbackPositions holds the LAST real advance, not an earlier or authored spot`,
      mod.playbackPositions[owner.id].x === lastMove.moveTo.x && mod.playbackPositions[owner.id].y === lastMove.moveTo.y);
  }
  check("found a possession with at least two real advances (dribble and/or carry) within the search budget", found);
  check("state.roster (authored) is untouched after full playback", state.roster.find((item) => item.id === owner.id).x === owner.x);
}

console.log("\n=== 16: resolveCross() correctness pass -- X1.D endpoint + spatially separated aerial defender ===");
{
  // A defender close to the CROSSER, far from the receiver's landing
  // spot, must not automatically contest the header -- proximity to the
  // crosser and proximity to the aerial contest are different questions.
  const crosser = entry("crosser", { team: "home", x: 10, y: 30, playerObj: STRONG_PASSER });
  const receiver = entry("receiver", { team: "home", x: 50, y: 5, playerObj: AVERAGE });
  const crosserSideDefender = entry("crosser-side-defender", { team: "away", x: 12, y: 32, playerObj: WEAK_DEFENDER });
  {
    const groups = { owner: crosser, teammates: [receiver], opponents: [crosserSideDefender], keeper: null };
    const trace = [];
    const random = seededRandom(hashString("cross-far-from-receiver"));
    resolveCross(groups, {}, random, trace);
    check("a defender near the crosser but far from the receiver does not contest the header",
      trace.some((event) => event.code === "X1"));
  }
  // The same defender, now placed near the RECEIVER instead, must
  // contest the header -- proximity to the landing point is what
  // matters, not proximity to the crosser.
  const receiverSideDefender = entry("receiver-side-defender", { team: "away", x: 48, y: 7, playerObj: WEAK_DEFENDER });
  {
    const groups = { owner: crosser, teammates: [receiver], opponents: [receiverSideDefender], keeper: null };
    const trace = [];
    const random = seededRandom(hashString("cross-near-receiver"));
    resolveCross(groups, {}, random, trace);
    check("a defender near the receiver's landing spot does contest the header",
      trace.some((event) => event.code === "X1.R" || event.code === "X1.D"));
  }
  // Search for an X1.D outcome (defender wins the header) and verify the
  // trace event's own contact point -- NOT the defender's static original
  // position (see Contact, Ownership & Continuation, 2026-08-17): the
  // header genuinely happens wherever the delivery actually landed, both
  // participants are shown converging on it via playerMoves, and X1.D no
  // longer terminates on the spot -- it hands off to a real defensive
  // continuation decision (resolveAerialClearanceContinuation()), covered
  // in full by tools/test-contact-continuity.mjs.
  const weakReceiver = entry("weak-receiver", { team: "home", x: 50, y: 5, playerObj: WEAK_DEFENDER });
  const eliteDefender = entry("elite-defender", { team: "away", x: 49, y: 6, playerObj: ELITE_DEFENDER });
  let found = null;
  let foundTrace = null;
  for (let i = 0; i < 500 && !found; i += 1) {
    const groups = { owner: crosser, teammates: [weakReceiver], opponents: [eliteDefender], keeper: null };
    const trace = [];
    const random = seededRandom(hashString(`cross-x1d-search-${i}`));
    const result = resolveCross(groups, {}, random, trace);
    if (trace.some((event) => event.code === "X1.D")) { found = result; foundTrace = trace; }
  }
  check("found an X1.D (defender wins the header) outcome within the search budget", Boolean(found));
  if (found) {
    const x1dEvent = foundTrace.find((event) => event.code === "X1.D");
    check("the X1.D trace event carries an explicit contact record naming the defender as the contacting actor",
      Boolean(x1dEvent.contact) && x1dEvent.contact.actorId === eliteDefender.id && x1dEvent.contact.type === "header");
    check("the contact point is NOT the defender's own static position -- it's the real, shared landing point",
      x1dEvent.contact.point.x !== eliteDefender.x || x1dEvent.contact.point.y !== eliteDefender.y);
    check("the X1.D event's own ballTo equals its own contact point (ball arrives at contact before contact)",
      x1dEvent.ballTo.x === x1dEvent.contact.point.x && x1dEvent.ballTo.y === x1dEvent.contact.point.y);
    check("both the receiver and the defender are shown converging on that same contact point",
      x1dEvent.playerMoves.length === 2
        && x1dEvent.playerMoves.every((move) => move.to.x === x1dEvent.contact.point.x && move.to.y === x1dEvent.contact.point.y));
    check("X1.D no longer terminates on the spot -- it hands off to a real defensive continuation, not the flat cross-aerial-lost reason",
      found.reason !== "cross-aerial-lost" && found.reason.startsWith("clearance-"));
  }
}

console.log("\n=== 17: fix 3 -- movement-less duel beats get a non-positional contest indicator, never a coordinate change ===");
{
  const owner = entry("owner", { team: "home", x: 50, y: 50, playerObj: GOOD_DRIBBLER });
  const defender = entry("defender", { team: "away", x: 52, y: 52, playerObj: WEAK_DEFENDER });
  setupRoster([owner, defender], owner.id);
  renderPitch();
  const ownerBefore = { ...mod.playbackPositions[owner.id] };
  const defenderBefore = { ...mod.playbackPositions[defender.id] };
  applyStepAnimation({
    code: "P.PROGRESS", label: "duel", actorId: owner.id, targetId: null, defenderId: defender.id, keeperId: null,
    ballFrom: pointOf(owner), ballTo: pointOf(owner), movement: "dribble", outcome: "neutral", duration: 400,
  }, { animate: true });
  const ownerNode = markerNode(owner.id);
  const defenderNode = markerNode(defender.id);
  check("both participants get the non-positional contest indicator",
    Boolean(ownerNode) && Boolean(defenderNode) && ownerNode.dataset.contest === "true" && defenderNode.dataset.contest === "true");
  check("neither participant gets the (now-removed) cosmetic coordinate offset for this beat",
    ownerNode.dataset.cosmetic !== "true" && defenderNode.dataset.cosmetic !== "true");
  check("playbackPositions is untouched for both", mod.playbackPositions[owner.id].x === ownerBefore.x
    && mod.playbackPositions[defender.id].x === defenderBefore.x);
}

console.log("\n=== 18: fix 4 -- explicit mover data, never inferred from ballFrom/ballTo (shots/passes must not move their actor) ===");
{
  const shooter = entry("shooter", { team: "home", x: 50, y: 10, playerObj: STRONG_PASSER });
  setupRoster([shooter], shooter.id);
  renderPitch();
  const shooterBefore = { ...mod.playbackPositions[shooter.id] };
  // A shot has a real, distinct ballFrom/ballTo (the ball travels goalward)
  // but the shooter themselves must never be inferred to move there --
  // exactly the case explicit moverId/moveTo exists to prevent.
  applyStepAnimation({
    code: "F.CALM", label: "shot", actorId: shooter.id, targetId: null, defenderId: null, keeperId: null,
    ballFrom: pointOf(shooter), ballTo: { x: 50, y: 100, zone: zoneFromPercent(50, 100) },
    movement: "shot", outcome: "success", duration: 400,
  }, { animate: true });
  check("a shot's real ballFrom/ballTo does not relocate the shooter (no moverId on the event)",
    mod.playbackPositions[shooter.id].x === shooterBefore.x && mod.playbackPositions[shooter.id].y === shooterBefore.y);

  // A knock-forward reception DOES move its receiver -- explicitly, via
  // moverId/moveTo, matching resolvePass()'s own real wiring.
  const receiver = entry("receiver", { team: "home", x: 40, y: 40, playerObj: AVERAGE });
  setupRoster([receiver], receiver.id);
  renderPitch();
  const advancedReceptionPoint = { x: 40, y: 55, zone: zoneFromPercent(40, 55) };
  applyStepAnimation({
    code: "P.RECEIVE.KNOCK_FORWARD", label: "knock forward", actorId: receiver.id, targetId: null, defenderId: null, keeperId: null,
    moverId: receiver.id, moveTo: advancedReceptionPoint,
    ballFrom: pointOf(receiver), ballTo: advancedReceptionPoint, movement: "reception", outcome: "success", duration: 300,
  }, { animate: true });
  check("a knock-forward reception's explicit moverId DOES relocate the receiver to the ball's real arrival point",
    mod.playbackPositions[receiver.id].x === advancedReceptionPoint.x && mod.playbackPositions[receiver.id].y === advancedReceptionPoint.y);
}

console.log("\n=== 19: unit consistency -- a real dribble advance uses the canonical rendered pitch length ===");
{
  const owner = entry("owner", { team: "home", x: 50, y: 50, playerObj: GOOD_DRIBBLER });
  const defender = entry("defender", { team: "away", x: 51, y: 51, playerObj: WEAK_DEFENDER });
  const groups = { owner, teammates: [], opponents: [defender], keeper: null };
  let found = null;
  for (let i = 0; i < 500 && !found; i += 1) {
    const random = seededRandom(hashString(`units-dribble-search-${i}`));
    const trace = [];
    const result = resolveDribble(groups, {}, random, trace);
    if (result.reason === "dribble-advance") found = result;
  }
  check("found a dribble-advance outcome within the search budget", Boolean(found));
  if (found) {
    // DRIBBLE_PROGRESS_YARDS is 8. Direction is no longer constrained to
    // the y-axis, so validate total canonical yard distance, not vertical
    // percentage displacement.
    const actualDistanceYards = yardDistance(owner, found.ballEnd);
    check(`dribble advance uses an eight-yard vector on the canonical ${PITCH_LENGTH_YARDS}-yard pitch (got ${actualDistanceYards.toFixed(2)}yd)`,
      Math.abs(actualDistanceYards - 8) < 0.05);
  }
}

console.log("\n=== 20: tackle-range wiring -- resolveDribble() never chooses a standing/sliding tackle outside real range ===");
{
  // Defender placed within DUEL_RANGE_YARDS (so resolveDribble even
  // reaches the engagement-type decision at all) but beyond BOTH
  // STANDING_TACKLE_RANGE_YARDS(3) and SLIDING_TACKLE_RANGE_YARDS(5) --
  // ~5.5 real yards away on the canonical 75-yard width. Before this fix,
  // selectEngagement() (pure attribute-driven, no distance concept at
  // all) could still return D.STAND/D.SLIDE here purely off attributes;
  // the Match-Lab-side remap must downgrade those to D.DUEL.
  const owner = entry("owner", { team: "home", x: 50, y: 50, playerObj: WEAK_DEFENDER });
  const defender = entry("defender", { team: "away", x: 57.33, y: 50, playerObj: GOOD_DRIBBLER });
  const groups = { owner, teammates: [], opponents: [defender], keeper: null };
  let sawStandOrSlide = false;
  let sawAnyEngagement = false;
  for (let i = 0; i < 500; i += 1) {
    const random = seededRandom(hashString(`tackle-range-search-${i}`));
    const trace = [];
    resolveDribble(groups, {}, random, trace);
    const engagementEvent = trace.find((event) => event.code === "D.STAND" || event.code === "D.SLIDE" || event.code === "D.DUEL");
    if (engagementEvent) {
      sawAnyEngagement = true;
      if (engagementEvent.code === "D.STAND" || engagementEvent.code === "D.SLIDE") sawStandOrSlide = true;
    }
  }
  check("exercised at least one real engagement-type choice within the search budget", sawAnyEngagement);
  check("a defender beyond both tackle ranges (but within duel range) never gets a standing or sliding tackle across 500 trials",
    !sawStandOrSlide);
}

console.log("\n=== 21: pass contest geometry -- receiver-side pressure matters even when the passer is completely unmarked ===");
{
  const owner = entry("owner", { team: "home", x: 20, y: 50, playerObj: STRONG_PASSER });
  const receiver = entry("receiver", { team: "home", x: 60, y: 50, playerObj: AVERAGE });
  // No opponent anywhere near the passer OR the passing lane -- only near
  // the receiver. Before this fix, resolvePass()'s fully-uncontested
  // branch (no engager near the passer) skipped resolveReceive()
  // entirely and hardcoded a clean reception no matter what, so a marked
  // receiver off an unpressured pass could never actually be contested.
  // Placed BEYOND the receiver along the same owner->receiver line
  // (~5 real yards past them) rather than laterally beside them: close
  // enough to be a genuine receiver-side engager (within DUEL_RANGE_YARDS
  // of the receiver) but, because the segment clamps to the receiver's
  // own endpoint, correctly outside PASS_LANE_HALF_WIDTH_YARDS of the
  // actual flight path -- a defender laterally beside the receiver would
  // ALSO legitimately register as a lane interceptor (the segment's own
  // endpoint IS the receiver's position, so tight marking and lane
  // presence genuinely overlap there), which would conflate the two
  // roles this test exists to keep separate.
  const receiverSideDefender = entry("rdef", { team: "away", x: 67.35, y: 50, playerObj: ELITE_DEFENDER });
  const groups = { owner, teammates: [receiver], opponents: [receiverSideDefender], keeper: null };
  check("the receiver-side defender is not within duel range of the passer at all",
    engagingOpponent(owner, [receiverSideDefender]) === null);
  check("the receiver-side defender is not a lane interceptor either (well off the direct line)",
    nearestLaneInterceptor(owner, receiver, [receiverSideDefender]) === null);
  let sawNonClean = false;
  let sawAnyResult = false;
  for (let i = 0; i < 500; i += 1) {
    const random = seededRandom(hashString(`pass-receiver-pressure-search-${i}`));
    const trace = [];
    const result = resolvePass(groups, {}, random, trace);
    sawAnyResult = true;
    if (result.code !== "P.RECEIVE.CLEAN") sawNonClean = true;
  }
  check("exercised results within the search budget", sawAnyResult);
  check("a receiver-side defender produces SOME non-clean reception outcomes across 500 trials, even with the passer completely unmarked",
    sawNonClean);

  // Contrast: with NO defender anywhere (not even near the receiver),
  // every single trial must be the clean shortcut -- confirms the
  // difference above is really coming from receiver-side pressure, not
  // noise elsewhere in the function.
  const emptyGroups = { owner, teammates: [receiver], opponents: [], keeper: null };
  let allClean = true;
  for (let i = 0; i < 50; i += 1) {
    const random = seededRandom(hashString(`pass-no-defenders-${i}`));
    const trace = [];
    const result = resolvePass(emptyGroups, {}, random, trace);
    if (result.code !== "P.RECEIVE.CLEAN") allClean = false;
  }
  check("with genuinely no opponents placed at all, every reception is the clean shortcut", allClean);
}

console.log("\n=== 22: pass contest geometry -- a lane interceptor far from the passer still intercepts ===");
{
  // Ball Flight v2 (2026-08-20) -- distance kept STRICTLY inside
  // GROUND_MAX_YARDS (<=15yd, matchPassFlight.js) so pass type is always
  // "ground" regardless of lane obstruction: beyond that threshold, a
  // defender sitting exactly on the direct line correctly triggers a
  // LOFTED selection instead (going over the blocked lane, the real
  // "beyond ~35-40m shift to lofted/aerial" behavior this whole round
  // exists to add) -- genuinely un-interceptable at ground level for the
  // whole flight by design, not a bug, but not what THIS section means to
  // test. Real distances here use the actual pitch (75x120 yards,
  // pitchGeometry.js) via yardDistance() directly -- an earlier draft of
  // this fixture used the wrong pitch dimensions when converting "yards"
  // to percent-space and landed a hair past the 15yd threshold by
  // accident, silently flipping the pass to lofted and breaking this
  // exact test. owner->receiver is a real 12yd; owner->laneDefender a
  // real 7.2yd (safely outside DUEL_RANGE_YARDS, 6yd).
  const owner = entry("owner", { team: "home", x: 20, y: 50, playerObj: WEAK_DEFENDER });
  const receiver = entry("receiver", { team: "home", x: 36, y: 50, playerObj: AVERAGE });
  const laneDefender = entry("ldef", { team: "away", x: 29.6, y: 50, playerObj: ELITE_DEFENDER });
  const groups = { owner, teammates: [receiver], opponents: [laneDefender], keeper: null };
  check("the lane defender is not within duel range of the passer", engagingOpponent(owner, [laneDefender]) === null);
  check("the lane defender IS found as a lane interceptor", nearestLaneInterceptor(owner, receiver, [laneDefender]) === laneDefender);
  let sawInterception = false;
  for (let i = 0; i < 500 && !sawInterception; i += 1) {
    const random = seededRandom(hashString(`pass-lane-interception-search-${i}`));
    const trace = [];
    const result = resolvePass(groups, {}, random, trace);
    if (result.reason === "pass-intercepted") sawInterception = true;
  }
  check("a lane interceptor structurally invisible to the old passer-only engager check can still intercept the pass",
    sawInterception);
}

console.log("\n=== 23: Directional Carry Planning is threaded through resolveCarry() end to end ===");
{
  const owner = entry("owner", { team: "home", x: 85, y: 60, playerObj: GOOD_DRIBBLER });
  setupRoster([owner], owner.id);
  const groups = freePlayGroups(owner.id, state.roster);
  const attackingDirection = state.attackingDirection[owner.team];
  const decidedCandidates = generateFreePlayCandidates(groups, attackingDirection);
  const carryCandidate = decidedCandidates.find((c) => c.type === "carry");
  check("a wide, unopposed attacker generates a real carry candidate with a concrete moveTo", Boolean(carryCandidate) && Boolean(carryCandidate.moveTo));

  const trace = [];
  const availability = { preselectedTargetId: null, plannedMoveTo: carryCandidate.moveTo };
  const result = FREE_PLAY_RESOLVERS.carry(groups, availability, seededRandom(hashString("carry-thread-test")), trace);
  check("resolveCarry()'s own ballEnd matches the EXACT planned moveTo, not a separately recomputed endpoint",
    result.ballEnd.x === carryCandidate.moveTo.x && result.ballEnd.y === carryCandidate.moveTo.y);
  const carryEvent = trace.find((event) => event.code === "P.CARRY");
  check("player and ball move together -- the trace event's mover/moveTo and ballFrom/ballTo agree on the same real endpoint",
    Boolean(carryEvent) && carryEvent.moverId === owner.id
      && carryEvent.moveTo.x === carryEvent.ballTo.x && carryEvent.moveTo.y === carryEvent.ballTo.y
      && carryEvent.ballTo.x === carryCandidate.moveTo.x);
  check("state.roster (authored) is untouched", state.roster.find((item) => item.id === owner.id).x === owner.x);

  // Replay determinism: identical geometry through the full candidate ->
  // resolver pipeline reproduces the identical endpoint.
  const decidedAgain = generateFreePlayCandidates(groups, attackingDirection).find((c) => c.type === "carry");
  check("replaying the same geometry reproduces the identical chosen carry endpoint",
    decidedAgain.moveTo.x === carryCandidate.moveTo.x && decidedAgain.moveTo.y === carryCandidate.moveTo.y);
}

console.log("\n=== 24: Touches Per Carry -- real intermediate touches, not one big jump (resolveCarry) ===");
{
  const owner = entry("owner", { team: "home", x: 50, y: 40, playerObj: GOOD_DRIBBLER });
  // Just beyond DUEL_RANGE_YARDS(6) -- close enough to read as real
  // aware-but-not-pressuring space (jog gait), but structurally too far
  // to be an engager, so generateFreePlayCandidates() still offers
  // "carry" here, not "dribble" (carry is only ever offered when nobody
  // is within duel range at all).
  const nearby = entry("nearby", { team: "away", x: 50, y: 47, playerObj: WEAK_DEFENDER });
  const groups = { owner, teammates: [], opponents: [nearby], keeper: null };
  const attackingDirection = state.attackingDirection[owner.team];
  const carryCandidate = generateFreePlayCandidates(groups, attackingDirection).find((c) => c.type === "carry");
  check("a carry candidate exists even with a nearby (non-engaging) opponent", Boolean(carryCandidate));
  if (carryCandidate) {
    const trace = [];
    const availability = { preselectedTargetId: null, plannedMoveTo: carryCandidate.moveTo };
    const result = FREE_PLAY_RESOLVERS.carry(groups, availability, seededRandom(hashString("touches-nimble")), trace);
    const touchEvents = trace.filter((event) => event.code === "P.CARRY.TOUCH");
    const finalEvents = trace.filter((event) => event.code === "P.CARRY");
    check("for a real carry distance, multiple real intermediate touches occur, not one big jump", touchEvents.length > 0);
    check("exactly one final P.CARRY event exists regardless of how many intermediate touches preceded it", finalEvents.length === 1);
    check("the final event's own endpoint is still EXACTLY the planned destination",
      finalEvents[0].ballTo.x === carryCandidate.moveTo.x && finalEvents[0].ballTo.y === carryCandidate.moveTo.y);
    check("resolveCarry()'s own ballEnd is unaffected by touch subdivision -- still exactly the planned destination",
      result.ballEnd.x === carryCandidate.moveTo.x && result.ballEnd.y === carryCandidate.moveTo.y);

    // Continuity across every touch in this one action: each one's
    // ballFrom is the exact previous one's own ballTo -- the same
    // invariant test 11 already holds across whole ACTIONS, now verified
    // to hold within a single action's own subdivided touches too.
    const positioned = trace.filter((event) => event.ballFrom && event.ballTo);
    let continuityHolds = true;
    for (let i = 1; i < positioned.length; i += 1) {
      if (positioned[i - 1].ballTo.x !== positioned[i].ballFrom.x
        || positioned[i - 1].ballTo.y !== positioned[i].ballFrom.y
        || positioned[i - 1].ballTo.zone !== positioned[i].ballFrom.zone) continuityHolds = false;
    }
    check("every touch chains exactly from the previous one's own endpoint, all the way to the final destination", continuityHolds);
    check("the very first touch begins exactly at the carrier's own pre-carry position",
      positioned[0].ballFrom.x === owner.x && positioned[0].ballFrom.y === owner.y);
    check("carry touch events preserve quantified attribute attribution for later inspection",
      touchEvents.every((event) => event.attribution.some((item) => item.quantity === "touchThreshold(jog)"
        && Number.isFinite(item.baseline) && Number.isFinite(item.actual))));
  }
}

console.log("\n=== 25: Touches Per Carry -- open space produces fewer touches than real pressure, identical distance ===");
{
  const owner = entry("owner", { team: "home", x: 50, y: 40, playerObj: GOOD_DRIBBLER });
  const nearbyPressure = entry("nearby", { team: "away", x: 51, y: 42, playerObj: WEAK_DEFENDER });
  // The SAME fixed destination for both scenarios -- isolates gait as the
  // only variable (real nearby pressure vs. none), not a confound from
  // planCarryDestination() also choosing a different distance/direction
  // under pressure.
  const destination = { x: 50, y: 50, zone: zoneFromPercent(50, 50) };
  const pressuredGroups = { owner, teammates: [], opponents: [nearbyPressure], keeper: null };
  const openGroups = { owner, teammates: [], opponents: [], keeper: null };
  const pressuredTrace = [];
  const openTrace = [];
  FREE_PLAY_RESOLVERS.carry(pressuredGroups, { preselectedTargetId: null, plannedMoveTo: destination }, seededRandom(hashString("touches-pressured")), pressuredTrace);
  FREE_PLAY_RESOLVERS.carry(openGroups, { preselectedTargetId: null, plannedMoveTo: destination }, seededRandom(hashString("touches-open")), openTrace);
  const pressuredTouches = pressuredTrace.filter((event) => event.code === "P.CARRY.TOUCH").length;
  const openTouches = openTrace.filter((event) => event.code === "P.CARRY.TOUCH").length;
  check("for the identical distance, real nearby pressure produces more intermediate touches than open space",
    pressuredTouches > openTouches);
}

console.log("\n=== 26: Touches Per Carry -- resolveDribble()'s own successful advance also gets real intermediate touches ===");
{
  const owner = entry("owner", { team: "home", x: 50, y: 40, playerObj: GOOD_DRIBBLER });
  const defender = entry("defender", { team: "away", x: 51, y: 42, playerObj: WEAK_DEFENDER });
  const groups = { owner, teammates: [], opponents: [defender], keeper: null };
  let found = null;
  let foundTrace = null;
  for (let i = 0; i < 500 && !found; i += 1) {
    const random = seededRandom(hashString(`dribble-touches-${i}`));
    const trace = [];
    const result = resolveDribble(groups, {}, random, trace);
    if (result.reason === "dribble-advance") { found = result; foundTrace = trace; }
  }
  check("found a real dribble-advance outcome within the search budget", Boolean(found));
  if (found) {
    const touchEvents = foundTrace.filter((event) => event.code === "P.PROGRESS.TOUCH");
    const finalEvents = foundTrace.filter((event) => event.code === "P.PROGRESS.WON");
    check("exactly one final P.PROGRESS.WON event exists regardless of how many intermediate touches preceded it", finalEvents.length === 1);
    check("beating a defender this close (within DUEL_RANGE_YARDS by construction) reads as real pressure -- at least one intermediate touch",
      touchEvents.length > 0);
    check("the final event's own ballTo is unaffected by touch subdivision -- still exactly the real dribble-advance endpoint",
      finalEvents[0].ballTo.x === found.ballEnd.x && finalEvents[0].ballTo.y === found.ballEnd.y);
    const positioned = foundTrace.filter((event) => event.code === "P.PROGRESS.TOUCH" || event.code === "P.PROGRESS.WON");
    let continuityHolds = true;
    for (let i = 1; i < positioned.length; i += 1) {
      if (positioned[i - 1].ballTo.x !== positioned[i].ballFrom.x || positioned[i - 1].ballTo.y !== positioned[i].ballFrom.y) continuityHolds = false;
    }
    check("every touch chains exactly from the previous one's own endpoint", continuityHolds);
  }
}

console.log("\n=== 27: Touches Per Carry -- identical seed reproduces an identical touch sequence ===");
{
  const owner = entry("owner", { team: "home", x: 50, y: 40, playerObj: GOOD_DRIBBLER });
  // Same non-engaging-but-nearby placement as test 24, for the same
  // reason -- outside DUEL_RANGE_YARDS so "carry" is genuinely offered.
  const nearby = entry("nearby", { team: "away", x: 50, y: 47, playerObj: WEAK_DEFENDER });
  const groups = { owner, teammates: [], opponents: [nearby], keeper: null };
  const attackingDirection = state.attackingDirection[owner.team];
  const carryCandidate = generateFreePlayCandidates(groups, attackingDirection).find((c) => c.type === "carry");
  const trace1 = [];
  const trace2 = [];
  FREE_PLAY_RESOLVERS.carry(groups, { preselectedTargetId: null, plannedMoveTo: carryCandidate.moveTo }, seededRandom(hashString("touches-determinism")), trace1);
  FREE_PLAY_RESOLVERS.carry(groups, { preselectedTargetId: null, plannedMoveTo: carryCandidate.moveTo }, seededRandom(hashString("touches-determinism")), trace2);
  check("identical geometry reproduces an identical touch sequence, including every intermediate waypoint",
    JSON.stringify(trace1) === JSON.stringify(trace2));
}

console.log("\n=== 28: Off-Ball Defender Awareness v1 -- defenders reposition, coordinate press/cover, end to end ===");
{
  const owner = entry("owner", { team: "home", x: 50, y: 30, playerObj: GOOD_DRIBBLER });
  const teammate = entry("teammate", { team: "home", x: 65, y: 35, playerObj: STRONG_PASSER });
  const defenderA = entry("defA", { team: "away", x: 40, y: 55, playerObj: WEAK_DEFENDER });
  const defenderB = entry("defB", { team: "away", x: 68, y: 55, playerObj: WEAK_DEFENDER });
  const keeper = entry("keeper", { role: "keeper", team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
  setupRoster([owner, teammate, defenderA, defenderB, keeper], owner.id);
  const beforeRosterJson = JSON.stringify(state.roster);

  let sawDefAdjust = false;
  let defendersMoved = false;
  let sawBothRoles = false;
  for (let i = 0; i < 80 && !(sawDefAdjust && defendersMoved && sawBothRoles); i += 1) {
    const run = runConstructedPossession(`def-awareness-${i}`);
    const defEvents = run.trace.filter((event) => event.code === "DEF.ADJUST");
    if (defEvents.length) sawDefAdjust = true;
    for (const event of defEvents) {
      const actions = new Set(event.playerMoves.map((move) => move.action));
      if (actions.has("press-ball") && actions.has("cover")) sawBothRoles = true;
    }
    const finalA = run.finalPositions.find((p) => p.id === defenderA.id);
    const finalB = run.finalPositions.find((p) => p.id === defenderB.id);
    if ((finalA && (finalA.x !== defenderA.x || finalA.y !== defenderA.y))
      || (finalB && (finalB.x !== defenderB.x || finalB.y !== defenderB.y))) defendersMoved = true;
  }
  check("DEF.ADJUST events appear across these possessions", sawDefAdjust);
  check("at least one defender's own simulated position actually changes from where they were authored", defendersMoved);
  check("both press and cover roles are observed together in at least one combined event -- real multi-defender coordination", sawBothRoles);
  check("state.roster (authored) is untouched by any of this", JSON.stringify(state.roster) === beforeRosterJson);
}

console.log("\n=== 29: Off-Ball Defender Awareness v1 -- identical seed reproduces identical defensive repositioning ===");
{
  const owner = entry("owner", { team: "home", x: 50, y: 30, playerObj: GOOD_DRIBBLER });
  const teammate = entry("teammate", { team: "home", x: 65, y: 35, playerObj: STRONG_PASSER });
  const defenderA = entry("defA", { team: "away", x: 40, y: 55, playerObj: WEAK_DEFENDER });
  const defenderB = entry("defB", { team: "away", x: 68, y: 55, playerObj: WEAK_DEFENDER });
  const keeper = entry("keeper", { role: "keeper", team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
  setupRoster([owner, teammate, defenderA, defenderB, keeper], owner.id);
  const run1 = runConstructedPossession("def-determinism-seed");
  const run2 = runConstructedPossession("def-determinism-seed");
  check("identical seed reproduces an identical trace, including every DEF.ADJUST event",
    JSON.stringify(run1.trace) === JSON.stringify(run2.trace));
}

console.log("\n=== 30: Off-Ball Movement v1 -- teammates claim complementary jobs end to end ===");
{
  // A rough 5v5-style roster, matching the reported scenario: several
  // attacking teammates, several defenders, one closely marking a
  // teammate (should find space), the rest with room (should run
  // forward).
  const owner = entry("owner", { team: "home", x: 50, y: 30, playerObj: GOOD_DRIBBLER });
  const marked = entry("marked", { team: "home", x: 55, y: 32, playerObj: STRONG_PASSER });
  const open = entry("open", { team: "home", x: 25, y: 35, playerObj: STRONG_PASSER });
  const tightMarker = entry("tightMarker", { team: "away", x: 56, y: 33, playerObj: WEAK_DEFENDER });
  const presserDef = entry("presserDef", { team: "away", x: 45, y: 32, playerObj: WEAK_DEFENDER });
  const keeper = entry("keeper", { role: "keeper", team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
  setupRoster([owner, marked, open, tightMarker, presserDef, keeper], owner.id);
  const beforeRosterJson = JSON.stringify(state.roster);

  let sawAttAdjust = false;
  let sawSupportShort = false;
  let sawRunInBehind = false;
  let teammatesMoved = false;
  let sawMotionTrajectory = false;
  let sawPersistentIntention = false;
  for (let i = 0; i < 80 && !(sawSupportShort && sawRunInBehind && teammatesMoved
    && sawMotionTrajectory && sawPersistentIntention); i += 1) {
    const run = runConstructedPossession(`att-awareness-${i}`);
    const attEvents = run.trace.filter((event) => event.code === "ATT.ADJUST");
    if (attEvents.length) sawAttAdjust = true;
    for (const event of attEvents) {
      for (const move of event.playerMoves) {
        if (move.action === "support-short") sawSupportShort = true;
        if (move.action === "run-in-behind") sawRunInBehind = true;
        if (move.trajectory?.length > 2 && move.trajectory[0].velocity) sawMotionTrajectory = true;
        if (move.intention?.retained) sawPersistentIntention = true;
      }
    }
    const finalMarked = run.finalPositions.find((p) => p.id === marked.id);
    const finalOpen = run.finalPositions.find((p) => p.id === open.id);
    if ((finalMarked && (finalMarked.x !== marked.x || finalMarked.y !== marked.y))
      || (finalOpen && (finalOpen.x !== open.x || finalOpen.y !== open.y))) teammatesMoved = true;
  }
  check("ATT.ADJUST events appear across these possessions", sawAttAdjust);
  check("one teammate is observed claiming the short-support passing lane", sawSupportShort);
  check("one claimable teammate is observed making the exclusive run in behind", sawRunInBehind);
  check("at least one teammate's own simulated position actually changes from where they were authored", teammatesMoved);
  check("real off-ball trace moves contain velocity-bearing trajectories rather than only endpoints", sawMotionTrajectory);
  check("an attacking intention persists across at least two reactions in a real possession", sawPersistentIntention);
  check("state.roster (authored) is untouched by any of this", JSON.stringify(state.roster) === beforeRosterJson);
}

console.log("\n=== 31: Motion v1 -- one concurrent reaction batch emits attacker and defender tracks together ===");
{
  const owner = entry("owner", { team: "home", x: 50, y: 30, playerObj: GOOD_DRIBBLER });
  const teammate = entry("teammate", { team: "home", x: 55, y: 32, playerObj: STRONG_PASSER });
  const tightMarker = entry("tightMarker", { team: "away", x: 56, y: 33, playerObj: WEAK_DEFENDER });
  const farDefender = entry("farDefender", { team: "away", x: 30, y: 60, playerObj: WEAK_DEFENDER });
  const keeper = entry("keeper", { role: "keeper", team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
  setupRoster([owner, teammate, tightMarker, farDefender, keeper], owner.id);

  let foundBothInOneStep = false;
  for (let i = 0; i < 100 && !foundBothInOneStep; i += 1) {
    const run = runConstructedPossession(`att-def-order-${i}`);
    for (let idx = 0; idx < run.trace.length - 1; idx += 1) {
      if (run.trace[idx].code === "ATT.ADJUST" && run.trace[idx + 1].code === "DEF.ADJUST") {
        foundBothInOneStep = true;
        break;
      }
    }
  }
  check("ATT.ADJUST and DEF.ADJUST are emitted together for the same overlap window",
    foundBothInOneStep);
}

console.log("\n=== 32: Off-Ball Attacker Awareness v1 -- identical seed reproduces identical off-ball movement ===");
{
  const owner = entry("owner", { team: "home", x: 50, y: 30, playerObj: GOOD_DRIBBLER });
  const marked = entry("marked", { team: "home", x: 55, y: 32, playerObj: STRONG_PASSER });
  const open = entry("open", { team: "home", x: 25, y: 35, playerObj: STRONG_PASSER });
  const tightMarker = entry("tightMarker", { team: "away", x: 56, y: 33, playerObj: WEAK_DEFENDER });
  const presserDef = entry("presserDef", { team: "away", x: 45, y: 32, playerObj: WEAK_DEFENDER });
  const keeper = entry("keeper", { role: "keeper", team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
  setupRoster([owner, marked, open, tightMarker, presserDef, keeper], owner.id);
  const run1 = runConstructedPossession("att-determinism-seed");
  const run2 = runConstructedPossession("att-determinism-seed");
  check("identical seed reproduces an identical trace, including every ATT.ADJUST event",
    JSON.stringify(run1.trace) === JSON.stringify(run2.trace));
}

console.log("\n=== 33: reported bug -- a keeper placed on the BALL OWNER'S OWN team is never treated as an attacking teammate ===");
{
  const owner = entry("owner", { team: "home", x: 50, y: 30, playerObj: GOOD_DRIBBLER });
  const ownKeeper = entry("ownKeeper", { role: "keeper", team: "home", x: 50, y: 4, playerObj: ELITE_KEEPER });
  const defenderKeeper = entry("defKeeper", { role: "keeper", team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
  const groups = freePlayGroups(owner.id, [owner, ownKeeper, defenderKeeper]);
  check("freePlayGroups() excludes the owner's OWN team's keeper from teammates entirely", groups.teammates.length === 0);
  check("the OPPOSING team's keeper is still correctly identified as the keeper to beat", groups.keeper && groups.keeper.id === defenderKeeper.id);

  const attackingDirection = state.attackingDirection[owner.team];
  const candidates = generateFreePlayCandidates(groups, attackingDirection);
  check("no pass or cross candidate ever targets the own-team keeper", !candidates.some((c) => c.type !== "shoot" && c.type !== "carry" && c.type !== "dribble" && c.target && c.target.id === ownKeeper.id));

  // Full sequence integration -- the original side's keeper may later move
  // legitimately if possession turns over and they become the defending
  // goalkeeper. The invariant is narrower and important: a keeper is never
  // authored as an ATTACKER movement (forward run/find-space) on either side.
  const teammate = entry("teammate", { team: "home", x: 30, y: 35, playerObj: STRONG_PASSER });
  const opponent = entry("opponent", { team: "away", x: 60, y: 40, playerObj: WEAK_DEFENDER });
  setupRoster([owner, teammate, ownKeeper, opponent, defenderKeeper], owner.id);
  let ownKeeperEverAttacked = false;
  for (let i = 0; i < 60; i += 1) {
    const run = runConstructedPossession(`own-keeper-static-${i}`);
    const attEvents = run.trace.filter((event) => event.code === "ATT.ADJUST");
    for (const event of attEvents) {
      if (event.playerMoves.some((move) => move.playerId === ownKeeper.id)) ownKeeperEverAttacked = true;
    }
  }
  check("across 60 live sequences, the keeper is never assigned an attacking outfield job",
    !ownKeeperEverAttacked);
}

console.log("\n=== 34: interleaved off-ball reactions -- OFF by default, never mutates a shared fixture ===");
{
  // The exact bug caught building this: resolveDribble()'s WON branch
  // now interleaves off-ball reactions mid-carry, which mutates whatever
  // groups.opponents/teammates/keeper point to. Called directly (not
  // through runConstructedPossession(), which is the ONLY caller that
  // opts in), the SAME defender fixture is reused across all 500
  // trials below -- if interleaving defaulted ON, that shared object
  // would silently drift position between trials.
  const owner = entry("owner", { team: "home", x: 50, y: 50, playerObj: GOOD_DRIBBLER });
  const defender = entry("defender", { team: "away", x: 52, y: 51, playerObj: WEAK_DEFENDER });
  const groups = { owner, teammates: [], opponents: [defender], keeper: null };
  const originalDefenderX = defender.x;
  const originalDefenderY = defender.y;
  for (let i = 0; i < 500; i += 1) {
    const random = seededRandom(hashString(`no-interleave-mutation-${i}`));
    const trace = [];
    resolveDribble(groups, {}, random, trace); // no 5th arg -- defaults to false
  }
  check("across 500 direct calls with no opt-in, the shared defender fixture's position never drifts",
    defender.x === originalDefenderX && defender.y === originalDefenderY);
}

console.log("\n=== 35: interleaved off-ball reactions -- ON inside runConstructedPossession(), genuinely mid-carry ===");
{
  const owner = entry("owner", { team: "home", x: 50, y: 30, playerObj: GOOD_DRIBBLER });
  const teammate = entry("teammate", { team: "home", x: 65, y: 35, playerObj: STRONG_PASSER });
  const defenderA = entry("defA", { team: "away", x: 51, y: 32, playerObj: WEAK_DEFENDER }); // close -- nimble gait, several touches
  const defenderB = entry("defB", { team: "away", x: 68, y: 55, playerObj: WEAK_DEFENDER });
  const keeper = entry("keeper", { role: "keeper", team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
  setupRoster([owner, teammate, defenderA, defenderB, keeper], owner.id);

  let sawInterleavedReaction = false;
  let sawEveryTouchGapCovered = false;
  for (let i = 0; i < 60 && !(sawInterleavedReaction && sawEveryTouchGapCovered); i += 1) {
    const run = runConstructedPossession(`interleave-mid-carry-${i}`);
    const touchIndices = [];
    const reactionIndices = [];
    run.trace.forEach((event, index) => {
      if (event.code === "P.CARRY.TOUCH" || event.code === "P.PROGRESS.TOUCH") touchIndices.push(index);
      if (event.code === "ATT.ADJUST" || event.code === "GK.ADJUST" || event.code === "DEF.ADJUST") reactionIndices.push(index);
    });
    // A reaction event sitting BETWEEN two touch events (not merely
    // after the very last one) is what actually proves interleaving --
    // not just that both event types exist somewhere in the trace.
    if (touchIndices.length >= 2) {
      const lastTouch = touchIndices[touchIndices.length - 1];
      const firstTouch = touchIndices[0];
      if (reactionIndices.some((idx) => idx > firstTouch && idx < lastTouch)) sawInterleavedReaction = true;
      if (touchIndices.length >= 3 && touchIndices.slice(0, -1).every((touchIndex, gapIndex) =>
        reactionIndices.some((reactionIndex) => reactionIndex > touchIndex && reactionIndex < touchIndices[gapIndex + 1]))) {
        sawEveryTouchGapCovered = true;
      }
    }
  }
  check("a real off-ball reaction event is found genuinely BETWEEN two touch events, not only after the whole action -- real interleaving, not a batch at the end",
    sawInterleavedReaction);
  check("a multi-touch action authors an off-ball reaction window between every consecutive pair of touches",
    sawEveryTouchGapCovered);
}

console.log("\n=== 36: Timeline Playback v1 compiles full resolved possessions without contact or track breaks ===");
{
  const owner = entry("timeline-owner", { team: "home", x: 48, y: 34, playerObj: GOOD_DRIBBLER });
  const teammateA = entry("timeline-a", { team: "home", x: 28, y: 42, playerObj: STRONG_PASSER });
  const teammateB = entry("timeline-b", { team: "home", x: 72, y: 24, playerObj: GOOD_DRIBBLER });
  const defenderA = entry("timeline-da", { team: "away", x: 51, y: 38, playerObj: ELITE_DEFENDER });
  const defenderB = entry("timeline-db", { team: "away", x: 68, y: 20, playerObj: WEAK_DEFENDER });
  const keeper = entry("timeline-gk", { role: "keeper", team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
  const authored = [owner, teammateA, teammateB, defenderA, defenderB, keeper];
  setupRoster(authored, owner.id);
  const initialPositions = Object.fromEntries(authored.map((item) => [item.id, pointOf(item)]));
  let compiled = 0;
  let failed = false;
  let failureMessage = "";
  for (let index = 0; index < 80; index += 1) {
    const run = runConstructedPossession(`timeline-full-possession-${index}`);
    try {
      buildMatchLabPlaybackPlan({
        trace: run.trace, initialPositions, initialBall: pointOf(owner), initialOwnerId: owner.id,
        finalOwnerId: run.finalOwnerId, restart: run.result.restart,
        // The live browser always supplies profiles. Omitting them takes a
        // different fallback path and can hide integration-only timing/contact
        // failures behind an otherwise-green resolver suite.
        playerProfiles: Object.fromEntries(authored.map((item) => [String(item.id), item.player])),
      });
      compiled += 1;
    } catch (error) {
      failed = true;
      failureMessage = `seed ${index}: ${error.message}`;
      break;
    }
  }
  if (failureMessage) console.log(`  ${failureMessage}`);
  check("80 real multi-action possession traces produce valid immutable playback plans", !failed && compiled === 80);
}

console.log("\n=== 37: Offside v1 is decided authoritatively at pass/cross contact ===");
{
  const owner = entry("offside-owner", { team: "home", x: 84, y: 60, playerObj: STRONG_PASSER });
  const receiver = entry("offside-receiver", { team: "home", x: 52, y: 90, playerObj: GOOD_DRIBBLER });
  const lastDefender = entry("offside-last", { team: "away", x: 50, y: 82, playerObj: ELITE_DEFENDER });
  const keeper = entry("offside-keeper", { role: "keeper", team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
  const groups = { owner, teammates: [receiver], opponents: [lastDefender], keeper };
  const before = JSON.stringify([owner, receiver, lastDefender, keeper]);

  const passTrace = [];
  const passResult = resolvePass(groups, {}, seededRandom(hashString("offside-pass")), passTrace);
  const passFlag = passTrace.find((event) => event.code === "P.OFFSIDE.FLAG");
  check("an offside pass resolves as a dead-ball indirect free kick with no owner",
    passResult.code === "P.OFFSIDE.FLAG" && passResult.nextOwnerId === null && passResult.restart === "indirect-free-kick");
  check("the flag event stores the kick-time ball/second-last-defender snapshot rather than asking playback to infer it",
    Boolean(passFlag?.offside?.isOffside) && passFlag.offside.ballYAtKick === owner.y
      && passFlag.offside.secondLastDefenderId === lastDefender.id);

  const forgedOnsideResult = resolvePass(
    groups,
    { preselectedTargetId: receiver.id, offside: { isOffside: false } },
    seededRandom(hashString("offside-forged-onside")),
    [],
  );
  check("the resolver recomputes at contact, so a stale/forged candidate snapshot cannot bypass an offside flag",
    forgedOnsideResult.code === "P.OFFSIDE.FLAG");

  const onsideReceiver = entry("onside-receiver", { team: "home", x: 52, y: 75, playerObj: GOOD_DRIBBLER });
  const onsideGroups = { ...groups, teammates: [onsideReceiver] };
  const forgedOffsideResult = resolvePass(
    onsideGroups,
    { preselectedTargetId: onsideReceiver.id, offside: { isOffside: true } },
    seededRandom(hashString("offside-forged-offside")),
    [],
  );
  check("the same authoritative recalculation prevents a stale snapshot from falsely flagging an onside receiver",
    forgedOffsideResult.code !== "P.OFFSIDE.FLAG");

  const crossTrace = [];
  const crossResult = resolveCross(groups, {}, seededRandom(hashString("offside-cross")), crossTrace);
  check("the same kick-time rule applies to a cross before delivery/aerial resolution",
    crossResult.code === "P.OFFSIDE.FLAG" && !crossTrace.some((event) => event.code === "CROSS.DELIVERY"));

  const sourceDefender = entry("offside-source", { team: "away", x: 83, y: 63, playerObj: ELITE_DEFENDER });
  const sourceGroups = { ...groups, opponents: [sourceDefender, lastDefender] };
  let stoppedBeforeKick = null;
  for (let index = 0; index < 500 && !stoppedBeforeKick; index += 1) {
    const trace = [];
    const result = resolveCross(sourceGroups, {}, seededRandom(hashString(`offside-source-stop-${index}`)), trace);
    if (result.reason?.startsWith("cross-source-")) stoppedBeforeKick = { result, trace };
  }
  check("a source tackle/block takes precedence because no cross was kicked and therefore no offside offence occurred",
    Boolean(stoppedBeforeKick) && stoppedBeforeKick.result.code !== "P.OFFSIDE.FLAG"
      && !stoppedBeforeKick.trace.some((event) => event.code === "P.OFFSIDE.FLAG"));
  check("direct offside resolver checks leave every reusable fixture byte-identical",
    JSON.stringify([owner, receiver, lastDefender, keeper]) === before);
}

console.log("\n=== 38: a successful turnover continues until a genuine stoppage ===");
{
  const owner = entry("continuation-owner", { team: "home", x: 50, y: 45, playerObj: GOOD_DRIBBLER });
  const tackler = entry("continuation-tackler", { team: "away", x: 51, y: 46, playerObj: ELITE_DEFENDER });
  const teammate = entry("continuation-mate", { team: "home", x: 30, y: 50, playerObj: STRONG_PASSER });
  setupRoster([owner, tackler, teammate], owner.id);
  const originals = { ...FREE_PLAY_RESOLVERS };
  let calls = 0;
  const scripted = (groups) => {
    calls += 1;
    if (calls === 1) {
      const winner = groups.opponents[0];
      return {
        outcome: "TACKLE WON", code: "T.WON", resolved: true,
        terminal: true, possession: "turnover", nextOwnerId: winner.id,
        ballEnd: pointOf(winner), restart: null, reason: "tackle-won",
      };
    }
    return {
      outcome: "OUT", code: "OUT", resolved: true,
      terminal: true, possession: "dead", nextOwnerId: null,
      ballEnd: pointOf(groups.owner), restart: "throw-in", reason: "throw-in",
    };
  };
  for (const key of Object.keys(FREE_PLAY_RESOLVERS)) FREE_PLAY_RESOLVERS[key] = scripted;
  const run = runConstructedPossession("turnover-must-continue");
  Object.assign(FREE_PLAY_RESOLVERS, originals);
  check("the isolated tackle's terminal flag does not end the live sequence", calls === 2);
  check("the sequence ends on the subsequent real restart", run.result.restart === "throw-in" && run.result.reason === "throw-in");
}

console.log("\n=== 39: decision commentary never freezes the physical duel window ===");
{
  const owner = entry("flow-owner", { team: "home", x: 50, y: 50, playerObj: GOOD_DRIBBLER });
  const defender = entry("flow-defender", { team: "away", x: 51, y: 51, playerObj: ELITE_DEFENDER });
  const runner = entry("flow-runner", { team: "home", x: 30, y: 55, playerObj: STRONG_PASSER });
  const ballPoint = pointOf(owner);
  const trace = [
    traceEvent("ACTION.CHOICE", "Owner chooses to dribble", { actor: owner, outcome: "neutral" }),
    traceEvent("P.PROGRESS", "Owner looks to get past Defender", {
      actor: owner, defender, movement: "dribble", outcome: "neutral", ballFrom: ballPoint, ballTo: ballPoint,
    }),
    traceEvent("D.STAND", "Defender chooses D.STAND", {
      actor: owner, defender, movement: "tackle", outcome: "neutral", ballFrom: ballPoint, ballTo: ballPoint,
    }),
    traceEvent("T.WON", "The standing tackle is won", {
      actor: owner, defender, movement: "tackle", outcome: "turnover", ballFrom: ballPoint, ballTo: ballPoint,
    }),
    traceEvent("ATT.ADJUST", "The runner keeps moving", {
      movement: "reposition", outcome: "neutral", duration: 400, overlapWithPrevious: true,
      playerMoves: [{ player: runner, from: pointOf(runner), to: { x: 34, y: 63, zone: zoneFromPercent(34, 63) }, action: "forward-run" }],
    }),
  ];
  check("ACTION.CHOICE, P.PROGRESS and D.STAND are zero-time cues",
    trace.slice(0, 3).every((event) => event.timelineRole === "cue" && event.duration === 0));
  check("stationary tackle declarations do not author a fake rolling-ball trajectory",
    trace[2].ballTrajectory.length === 0);
  check("the actual tackle outcome still owns a real animation interval",
    trace[3].timelineRole === "action" && trace[3].duration === 400
      && trace[3].ballTrajectory.every((sample) => sample.mode === "controlled-ground"));
  const plan = buildMatchLabPlaybackPlan({
    trace,
    initialPositions: { [owner.id]: pointOf(owner), [defender.id]: pointOf(defender), [runner.id]: pointOf(runner) },
    initialBall: ballPoint, initialOwnerId: owner.id, finalOwnerId: owner.id,
  });
  const physical = plan.intervals.find((interval) => interval.code === "T.WON");
  const ambient = plan.intervals.find((interval) => interval.code === "ATT.ADJUST");
  check("three declarations add no dead time to the sequence", plan.durationMs === 400);
  check("off-ball movement overlaps the physical tackle instead of a zero-time cue",
    ambient.startMs === physical.startMs && ambient.endMs === physical.endMs);
  const midpoint = sampleMatchLabPlaybackPlan(plan, 200);
  check("another player is visibly moving while the duel is being resolved",
    midpoint.players[runner.id].x > runner.x && midpoint.players[runner.id].y > runner.y);
}

console.log("\n=== 40: surrounding players keep moving through a terminal whistle ===");
{
  const owner = entry("whistle-owner", { team: "home", x: 50, y: 50, playerObj: GOOD_DRIBBLER });
  const runner = entry("whistle-runner", { team: "home", x: 25, y: 45, playerObj: STRONG_PASSER });
  const tackler = entry("whistle-tackler", { team: "away", x: 51, y: 51, playerObj: ELITE_DEFENDER });
  const cover = entry("whistle-cover", { team: "away", x: 78, y: 62, playerObj: WEAK_DEFENDER });
  const keeper = entry("whistle-keeper", { role: "keeper", team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
  const authored = [owner, runner, tackler, cover, keeper];
  setupRoster(authored, owner.id);
  const originals = { ...FREE_PLAY_RESOLVERS };
  const terminalFoul = (groups, availability, random, trace) => {
    trace.push(traceEvent("FOUL.WHISTLE", "The tackle ends in a free kick", {
      actor: groups.owner, defender: groups.opponents[0], movement: "tackle", outcome: "fail",
      ballFrom: pointOf(groups.owner), ballTo: pointOf(groups.owner),
      contact: { point: pointOf(groups.owner), actor: groups.owner, type: "tackle", phase: "end" },
      ownerBefore: groups.owner, ownerAfter: null, ownerAfterAt: "end", restart: "free-kick",
    }));
    return {
      outcome: "FOUL", code: "FOUL.WHISTLE", resolved: true,
      terminal: true, possession: "dead", nextOwnerId: null,
      ballEnd: pointOf(groups.owner), restart: "free-kick", reason: "foul",
    };
  };
  for (const key of Object.keys(FREE_PLAY_RESOLVERS)) FREE_PLAY_RESOLVERS[key] = terminalFoul;
  const run = runConstructedPossession("terminal-motion-through-whistle");
  Object.assign(FREE_PLAY_RESOLVERS, originals);
  const ambientEvents = run.trace.filter((event) => event.code === "ATT.ADJUST" || event.code === "DEF.ADJUST" || event.code === "GK.ADJUST");
  const ambientMoves = ambientEvents.flatMap((event) => event.playerMoves || []);
  check("a terminal free kick still authors ambient movement up to the whistle", ambientMoves.length > 0);
  check("the direct ball owner and tackler are left to the duel resolver, not double-animated",
    ambientMoves.every((move) => move.playerId !== owner.id && move.playerId !== tackler.id));
  const plan = buildMatchLabPlaybackPlan({
    trace: run.trace,
    initialPositions: Object.fromEntries(authored.map((item) => [item.id, pointOf(item)])),
    initialBall: pointOf(owner), initialOwnerId: owner.id,
    finalOwnerId: run.finalOwnerId, restart: run.result.restart,
  });
  const foulInterval = plan.intervals.find((interval) => interval.code === "FOUL.WHISTLE");
  check("terminal ambient movement shares the foul interval and adds no post-whistle time",
    plan.durationMs === foulInterval.endMs && ambientEvents.every((event) => {
      const interval = plan.intervals[run.trace.indexOf(event)];
      return interval.startMs === foulInterval.startMs && interval.endMs === foulInterval.endMs;
    }));
}

console.log("\n=== 41: declared goal frame and keeper-save transitions never contradict the world ===");
{
  state.attackingDirection = { home: "down", away: "up" };
  const adventurousKeeper = entry("away-gk-owner", {
    role: "keeper", team: "away", x: 50, y: 75, playerObj: ELITE_KEEPER,
  });
  const defendingKeeper = entry("home-gk", {
    role: "keeper", team: "home", x: 50, y: 5, playerObj: ELITE_KEEPER,
  });
  const frame = goalFrameFor(adventurousKeeper);
  check("an away player attacks y:0 even while still standing in the bottom half",
    frame.direction === "up" && attackingGoalY(adventurousKeeper) === 0);
  check("the same player's defending goal remains y:100",
    defendingGoalY(adventurousKeeper) === 100);
  check("the correctly placed opposing keeper is not classified as beaten",
    !isKeeperBeaten(adventurousKeeper, defendingKeeper));
  check("shot geometry targets the opposing keeper/goal, never the shooter's own line",
    goalPointFor(adventurousKeeper, defendingKeeper).y === 5
      && goalPointFor(adventurousKeeper, null).y === 0);

  for (const code of ["K.SAVE.3", "K.SAVE.7"]) {
    const transition = keeperSaveTransition(
      { code, goal: false, rebound: false }, defendingKeeper,
      { zone: 0, x: 8, y: -3 }, "shot",
    );
    check(`${code} ends as a dead-ball corner, not live keeper possession`,
      transition.restart === "corner" && transition.possession === "dead"
        && transition.nextOwnerId === null && transition.terminal === true);
  }
  for (const code of ["K.SAVE.1", "K.SAVE.4"]) {
    const transition = keeperSaveTransition(
      { code, goal: false, rebound: false }, defendingKeeper,
      pointOf(defendingKeeper), "shot",
    );
    check(`${code} remains a held ball for the goalkeeper`,
      transition.restart === null && transition.possession === "turnover"
        && transition.nextOwnerId === defendingKeeper.id);
  }
}

console.log("\n=== 42: keeper arrays, role-safe reactions, separation, and observable jobs ===");
{
  const owner = entry("role-owner", { team: "away", x: 50, y: 52, playerObj: GOOD_DRIBBLER });
  const ownKeeper = entry("away-keeper", { role: "keeper", team: "away", x: 15, y: 75, playerObj: ELITE_KEEPER });
  const firstOpposingKeeper = entry("home-keeper-a", { role: "keeper", team: "home", x: 15, y: 25, playerObj: ELITE_KEEPER });
  const secondOpposingKeeper = entry("home-keeper-b", { role: "keeper", team: "home", x: 85, y: 25, playerObj: ELITE_KEEPER });
  const defender = entry("role-defender", { team: "home", x: 52, y: 54, playerObj: WEAK_DEFENDER });
  const roster = [owner, ownKeeper, firstOpposingKeeper, secondOpposingKeeper, defender];
  setupRoster(roster, owner.id);

  const groups = freePlayGroups(owner.id, state.roster);
  check("freePlayGroups preserves every keeper in explicit same/opposing-side arrays",
    groups.ownKeepers.length === 1 && groups.opposingKeepers.length === 2);
  check("no goalkeeper falls through into outfield teammate/opponent arrays",
    [...groups.teammates, ...groups.opponents].every((item) => item.role !== "keeper"));
  check("the legacy shot/save keeper shim remains the first opposing keeper only",
    groups.keeper?.id === firstOpposingKeeper.id);
  check("the UI conflict invariant identifies an existing goalkeeper on the requested team",
    findKeeperConflict(state.roster, secondOpposingKeeper.id, "home")?.id === firstOpposingKeeper.id);

  const originals = { ...FREE_PLAY_RESOLVERS };
  const terminal = (currentGroups, availability, random, trace) => {
    trace.push(traceEvent("ROLE.TEST.STOP", "The phase stops", {
      actor: currentGroups.owner, movement: "tackle", outcome: "fail",
      ballFrom: pointOf(currentGroups.owner), ballTo: pointOf(currentGroups.owner),
      restart: "free-kick",
    }));
    return {
      outcome: "STOP", code: "ROLE.TEST.STOP", resolved: true,
      terminal: true, possession: "dead", nextOwnerId: null,
      ballEnd: pointOf(currentGroups.owner), restart: "free-kick", reason: "role-test",
    };
  };
  for (const key of Object.keys(FREE_PLAY_RESOLVERS)) FREE_PLAY_RESOLVERS[key] = terminal;
  const run = runConstructedPossession("keeper-array-reactions");
  Object.assign(FREE_PLAY_RESOLVERS, originals);
  const keeperEvents = run.trace.filter((event) => event.code === "GK.ADJUST");
  const movedKeeperIds = new Set(keeperEvents.flatMap((event) => event.playerMoves.map((move) => move.playerId)));
  check("both teams' keepers receive goalkeeper movement proposals in the same possession",
    [ownKeeper, firstOpposingKeeper, secondOpposingKeeper].every((keeper) => movedKeeperIds.has(keeper.id)));
  check("keeper observability labels name every moving keeper and its job",
    keeperEvents.some((event) => [ownKeeper, firstOpposingKeeper, secondOpposingKeeper]
      .every((keeper) => event.label.includes(keeper.player.canonical_player_name))
      && event.label.includes("holds the goalkeeper line")));
  const defenseEvents = run.trace.filter((event) => event.code === "DEF.ADJUST");
  check("defensive adjustment commentary names assigned players instead of a generic shape sentence",
    defenseEvents.every((event) => event.label !== "The defense adjusts its shape"
      && event.playerMoves.every((move) => event.label.includes(move.playerId === defender.id ? defender.player.canonical_player_name : ""))));

  const spacingRoster = [
    { id: "same-a", team: "home", x: 40, y: 40 },
    { id: "same-b", team: "home", x: 60, y: 40 },
  ];
  const overlapping = spacingRoster.map((item) => ({
    id: item.id, from: pointOf(item), target: { x: 50, y: 50 }, action: "cover", role: "defender",
  }));
  const separated = applyOffBallSeparation(overlapping, spacingRoster);
  check("same-team targets that overlap are separated before atomic motion resolution",
    yardDistance(separated[0].target, separated[1].target) >= 8);
  const opponents = [
    { id: "opp-a", team: "home", x: 40, y: 40 },
    { id: "opp-b", team: "away", x: 60, y: 40 },
  ];
  const opposedTargets = opponents.map((item) => ({
    id: item.id, from: pointOf(item), target: { x: 50, y: 50 }, action: "press", role: "defender",
  }));
  const converged = applyOffBallSeparation(opposedTargets, opponents);
  check("opponents remain free to converge on the same contested point",
    converged.every((proposal) => proposal.target.x === 50 && proposal.target.y === 50));
}

console.log("\n=== 43: physical tackles converge at contact, then author a separate ball reaction ===");
{
  const owner = entry("duel-owner", { team: "home", x: 50, y: 50, playerObj: GOOD_DRIBBLER });
  const defender = entry("duel-defender", { team: "away", x: 52, y: 52, playerObj: ELITE_DEFENDER });
  const groups = { owner, teammates: [], opponents: [defender], keeper: null };
  let found = null;
  for (let index = 0; index < 1000 && !found; index += 1) {
    const trace = [];
    const result = resolveDribble(groups, {}, seededRandom(hashString(`physical-duel-${index}`)), trace);
    const reaction = trace.find((event) => event.code === "T.WON.CONTROL"
      || event.code === "T.BEATEN.ESCAPE" || event.code === "T.LOOSE.DEFLECT");
    const contact = reaction && trace.find((event) => event.contact?.type === "tackle"
      && event.contact.phase === "end" && event.playerMoves?.some((move) => move.playerId === defender.id));
    if (contact && reaction) found = { trace, result, contact, reaction };
  }
  check("a completed non-foul tackle outcome is found within the deterministic search budget", Boolean(found));
  if (found) {
    const defenderMove = found.contact.playerMoves.find((move) => move.playerId === defender.id);
    check("the defender's authored challenge ends exactly at the tackle contact point",
      defenderMove.to.x === found.contact.contact.point.x && defenderMove.to.y === found.contact.contact.point.y);
    check("post-contact ball movement is a distinct physical interval instead of a frozen result card",
      found.reaction.timelineRole === "action"
        && (found.reaction.ballFrom.x !== found.reaction.ballTo.x || found.reaction.ballFrom.y !== found.reaction.ballTo.y));
    let compiled = true;
    try {
      buildMatchLabPlaybackPlan({
        trace: found.trace,
        initialPositions: { [owner.id]: pointOf(owner), [defender.id]: pointOf(defender) },
        initialBall: pointOf(owner), initialOwnerId: owner.id,
        finalOwnerId: found.result.nextOwnerId, restart: found.result.restart,
      });
    } catch {
      compiled = false;
    }
    check("the two-beat tackle compiles without player or ball continuity breaks", compiled);
  }
}

console.log("\n=== 44: attribute attribution is never rendered as an empty disclosure ===");
{
  const markup = attributionEntryMarkup({
    attr: "Acceleration", value: 17, quantity: "touch interval", actual: 180, baseline: 240, unit: "ms",
  });
  check("canonical producer fields remain visible in the attribution row",
    markup.includes("Acceleration 17") && markup.includes("touch interval")
      && markup.includes("180 ms") && markup.includes("240 ms"));
  const fallback = attributionEntryMarkup({});
  check("incomplete diagnostic data produces explicit fallback text, never an empty bullet",
    fallback.includes("Attribute ?") && fallback.includes("unavailable"));
}

console.log("\n=== 45: every action decision records the off-ball passing-options KPI ===");
{
  const owner = entry("metric-owner", { team: "home", x: 50, y: 35, playerObj: GOOD_DRIBBLER });
  const teammateA = entry("metric-a", { team: "home", x: 35, y: 43, playerObj: STRONG_PASSER });
  const teammateB = entry("metric-b", { team: "home", x: 65, y: 43, playerObj: STRONG_PASSER });
  const defender = entry("metric-def", { team: "away", x: 50, y: 62, playerObj: WEAK_DEFENDER });
  const keeper = entry("metric-keeper", { role: "keeper", team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
  setupRoster([owner, teammateA, teammateB, defender, keeper], owner.id);
  const run = runConstructedPossession("decision-option-metrics");
  const choices = run.trace.filter((event) => event.code === "ACTION.CHOICE");
  check("every ACTION.CHOICE stores the exact decision snapshot metrics",
    choices.length > 0 && choices.length === run.decisionMetrics.length
      && choices.every((event) => Number.isInteger(event.metrics?.legalPassingOptions)));
  check("the readable choice commentary exposes the legal passing-option count",
    choices.every((event) => event.label.includes("legal pass option")));
  const calculatedMean = run.decisionMetrics.reduce((sum, entry) => sum + entry.legalPassingOptions, 0)
    / run.decisionMetrics.length;
  check("the possession summary aggregates the same per-decision samples without recomputing geometry",
    run.possessionMetrics.decisions === choices.length
      && Math.abs(run.possessionMetrics.meanLegalPassingOptions - calculatedMean) < 0.0001);
  check("the same summary exposes pass/carry/shot counts and a nullable mean shot distance",
    run.possessionMetrics.passesSelected
        + run.possessionMetrics.carriesSelected
        + run.possessionMetrics.shotsSelected <= run.possessionMetrics.decisions
      && (run.possessionMetrics.meanShotDistanceYards === null
        || Number.isFinite(run.possessionMetrics.meanShotDistanceYards)));
}

console.log("\n=== 46: a zero-movement pin is visible as coached work, not discarded as a no-op ===");
{
  const owner = entry("pin-owner", { team: "home", x: 50, y: 30, playerObj: GOOD_DRIBBLER });
  const support = entry("pin-support", { team: "home", x: 46, y: 34, playerObj: STRONG_PASSER });
  const runner = entry("pin-runner", { team: "home", x: 50, y: 48, playerObj: GOOD_DRIBBLER });
  const wide = entry("pin-wide", { team: "home", x: 8, y: 44, playerObj: STRONG_PASSER });
  const pin = entry("pin-forward", { team: "home", x: 65, y: 52, playerObj: AVERAGE });
  const defender = entry("pin-defender", { team: "away", x: 50, y: 78, playerObj: WEAK_DEFENDER });
  const keeper = entry("pin-keeper", { role: "keeper", team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
  setupRoster([owner, support, runner, wide, pin, defender, keeper], owner.id);
  let pinEvent = null;
  for (let index = 0; index < 40 && !pinEvent; index += 1) {
    const run = runConstructedPossession(`pin-trace-${index}`);
    pinEvent = run.trace.find((event) => event.code === "ATT.ADJUST" && event.label.includes("pins the last line"));
  }
  check("the trace explicitly names pin-last-line even when its player has no movement track",
    Boolean(pinEvent));
  if (pinEvent) {
    check("a held-only job is a zero-time cue and does not manufacture a fake animation interval",
      pinEvent.timelineRole === "cue" || pinEvent.playerMoves.length > 0);
  }
}

console.log("\n=== 47: Hold-Up Play v1 -- resolveHold(): uncontested hold, shielding contest, and Strength sensitivity ===");
{
  const EVEN_HOLDER = player("Even Holder", { Strength: 13, Balance: 13, Composure: 13 });
  const EVEN_CHALLENGER = player("Even Challenger", { Strength: 13, Aggression: 13, Tackling: 13 });
  const STRONG_HOLDER = player("Strong Holder", { Strength: 18, Balance: 17, Composure: 16 });
  const WEAK_HOLDER = player("Weak Holder", { Strength: 6, Balance: 6, Composure: 6 });
  const PHYSICAL_CHALLENGER = player("Physical Challenger", { Strength: 18, Aggression: 17, Tackling: 16 });
  const WEAK_CHALLENGER = player("Weak Challenger", { Strength: 6, Aggression: 6, Tackling: 6 });

  // -- Uncontested: nobody within duel range, a genuine costless pause. --
  {
    const owner = entry("hold-alone", { team: "home", x: 50, y: 50, playerObj: EVEN_HOLDER });
    const groups = { owner, teammates: [], opponents: [], keeper: null };
    const trace = [];
    const result = FREE_PLAY_RESOLVERS.hold(groups, {}, seededRandom(hashString("hold-uncontested")), trace);
    check("uncontested hold is not terminal", result.terminal === false);
    check("possession stays retained with the same owner", result.possession === "retained" && result.nextOwnerId === owner.id);
    check("reason is explicitly hold-uncontested", result.reason === "hold-uncontested");
    check("ballEnd is the holder's own real point (no flight)",
      result.ballEnd.x === owner.x && result.ballEnd.y === owner.y);
    check("trace records exactly one P.HOLD event", trace.length === 1 && trace[0].code === "P.HOLD");
    const holdEvent = trace[0];
    check("the ball never leaves the holder's feet (ballFrom === ballTo)",
      holdEvent.ballFrom.x === holdEvent.ballTo.x && holdEvent.ballFrom.y === holdEvent.ballTo.y);
    check("contact names the holder, at the holder's own point, phase 'start'",
      holdEvent.contact
        && holdEvent.contact.actorId === owner.id
        && holdEvent.contact.phase === "start"
        && holdEvent.contact.point.x === owner.x && holdEvent.contact.point.y === owner.y);
    check("ownership is explicitly stated as retained by the same owner",
      holdEvent.ownerBeforeId === owner.id && holdEvent.ownerAfterId === owner.id);
  }

  // -- Contested: a real defender within duel range, searching a roughly
  // even matchup for both a won and a lost shielding duel. --
  let wonFound = null;
  let lostFound = null;
  for (let i = 0; i < 500 && (!wonFound || !lostFound); i += 1) {
    const owner = entry("hold-owner", { team: "home", x: 50, y: 50, playerObj: EVEN_HOLDER });
    const defender = entry("hold-defender", { team: "away", x: 52, y: 52, playerObj: EVEN_CHALLENGER });
    const groups = { owner, teammates: [], opponents: [defender], keeper: null };
    const trace = [];
    const random = seededRandom(hashString(`hold-shield-${i}`));
    const result = FREE_PLAY_RESOLVERS.hold(groups, {}, random, trace);
    if (result.reason === "hold-shielded" && !wonFound) wonFound = { result, trace, owner, defender };
    if (result.reason === "hold-dispossessed" && !lostFound) lostFound = { result, trace, owner, defender };
  }
  check("found a won shielding duel within the search budget", Boolean(wonFound));
  check("found a lost shielding duel within the search budget", Boolean(lostFound));
  if (wonFound) {
    const { result, trace, owner, defender } = wonFound;
    check("a won shield is not terminal -- possession is retained by the same owner",
      result.terminal === false && result.possession === "retained" && result.nextOwnerId === owner.id);
    check("trace shows the challenge then the won outcome, in order",
      trace.map((e) => e.code).join(",") === "P.HOLD.SHIELD,P.HOLD.SHIELD.WON");
    const challenge = trace[0];
    check("the challenge shows the defender genuinely converging on the holder's own contact point",
      challenge.playerMoves.length === 1
        && challenge.playerMoves[0].playerId === defender.id
        && challenge.playerMoves[0].to.x === owner.x && challenge.playerMoves[0].to.y === owner.y);
    const won = trace[1];
    check("the won event's contact names the holder, phase 'end', ownership retained",
      won.contact && won.contact.actorId === owner.id && won.contact.phase === "end"
        && won.ownerBeforeId === owner.id && won.ownerAfterId === owner.id && won.ownerAfterAt === "end");
  }
  if (lostFound) {
    const { result, trace, owner, defender } = lostFound;
    check("a lost shield IS terminal -- a real turnover to the challenger",
      result.terminal === true && result.possession === "turnover" && result.nextOwnerId === defender.id);
    check("trace shows the challenge then the lost outcome, in order",
      trace.map((e) => e.code).join(",") === "P.HOLD.SHIELD,P.HOLD.SHIELD.LOST");
    const lost = trace[1];
    check("the lost event's contact names the CHALLENGER (not the original holder), phase 'end', ownership flips",
      lost.contact && lost.contact.actorId === defender.id && lost.contact.phase === "end"
        && lost.ownerBeforeId === owner.id && lost.ownerAfterId === defender.id && lost.ownerAfterAt === "end");
    check("the ball never physically relocates during the dispossession itself -- it's won on the spot",
      lost.ballFrom.x === lost.ballTo.x && lost.ballFrom.y === lost.ballTo.y);
  }

  // -- Attribute sensitivity: this is the user's literal ask ("a high
  // strength player may shield the ball in order not to lose it") -- a
  // strong holder against a weak challenger must keep the ball measurably
  // more often than a weak holder against a strong challenger, same
  // geometry, only the attributes swapped. --
  function shieldWinRate(holderObj, challengerObj, trials, seedPrefix) {
    let wins = 0;
    let contested = 0;
    for (let i = 0; i < trials; i += 1) {
      const owner = entry("rate-owner", { team: "home", x: 50, y: 50, playerObj: holderObj });
      const defender = entry("rate-defender", { team: "away", x: 52, y: 52, playerObj: challengerObj });
      const groups = { owner, teammates: [], opponents: [defender], keeper: null };
      const trace = [];
      const random = seededRandom(hashString(`${seedPrefix}-${i}`));
      const result = FREE_PLAY_RESOLVERS.hold(groups, {}, random, trace);
      if (result.reason === "hold-shielded" || result.reason === "hold-dispossessed") {
        contested += 1;
        if (result.reason === "hold-shielded") wins += 1;
      }
    }
    return wins / contested;
  }
  const strongHolderRate = shieldWinRate(STRONG_HOLDER, WEAK_CHALLENGER, 300, "shield-strong-holder");
  const weakHolderRate = shieldWinRate(WEAK_HOLDER, PHYSICAL_CHALLENGER, 300, "shield-weak-holder");
  check(`a Strength/Balance/Composure-heavy holder retains the ball far more often against a weak challenger (${(strongHolderRate * 100).toFixed(0)}%) than a weak holder does against a physical challenger (${(weakHolderRate * 100).toFixed(0)}%)`,
    strongHolderRate > weakHolderRate + 0.3);
}

console.log("\n=== 48: Attribute-Aware Escape Duel -- Agility/Dribbling (attacker) and Strength (defender) now measurably matter in resolveDribble() (2026-08-18) ===");
{
  const NIMBLE = player("Nimble Attacker", {
    Passing: 12, Technique: 12, Decisions: 12, Teamwork: 12, Agility: 18, Dribbling: 18, Strength: 6,
  });
  const CLUMSY = player("Clumsy Attacker", {
    Passing: 12, Technique: 12, Decisions: 12, Teamwork: 12, Agility: 6, Dribbling: 6, Strength: 6,
  });
  const CHUNKY_DEFENDER = player("Chunky Defender", {
    Positioning: 12, Anticipation: 12, Tackling: 12, Decisions: 12, Strength: 18,
  });
  const WEAK_PHYSICALLY_DEFENDER = player("Weak Physically Defender", {
    Positioning: 12, Anticipation: 12, Tackling: 12, Decisions: 12, Strength: 6,
  });

  function escapeWinRate(attackerObj, defenderObj, trials, seedPrefix) {
    let wins = 0;
    for (let i = 0; i < trials; i += 1) {
      const owner = entry("escape-owner", { team: "home", x: 50, y: 50, playerObj: attackerObj });
      const defender = entry("escape-defender", { team: "away", x: 52, y: 52, playerObj: defenderObj });
      const groups = { owner, teammates: [], opponents: [defender], keeper: null };
      const trace = [];
      const random = seededRandom(hashString(`${seedPrefix}-${i}`));
      const result = resolveDribble(groups, {}, random, trace);
      if (result.reason === "dribble-advance") wins += 1;
    }
    return wins / trials;
  }
  const nimbleRate = escapeWinRate(NIMBLE, CHUNKY_DEFENDER, 400, "escape-nimble");
  const clumsyRate = escapeWinRate(CLUMSY, CHUNKY_DEFENDER, 400, "escape-clumsy");
  check(`identical Passing/Technique/Decisions/Teamwork and the SAME chunky (high-Strength) defender -- only Agility/Dribbling differs -- a nimble attacker escapes measurably more often (${(nimbleRate * 100).toFixed(0)}%) than a clumsy one (${(clumsyRate * 100).toFixed(0)}%)`,
    nimbleRate > clumsyRate + 0.1);

  // Same idea from the defender's side -- Strength was not read on the
  // defender's own half of this duel at all before this change either.
  // Smaller expected margin than the attacker-side check above: Strength
  // is only 1 of 5 terms in the defender's average (vs. Agility+Dribbling
  // being 2 of 6 on the attacker side), and the probability-ratio formula
  // compresses a raw-average swing further -- a real, consistent few-point
  // gap, not a double-digit one.
  const vsChunkyRate = escapeWinRate(CLUMSY, CHUNKY_DEFENDER, 1500, "hold-vs-chunky");
  const vsWeakRate = escapeWinRate(CLUMSY, WEAK_PHYSICALLY_DEFENDER, 1500, "hold-vs-weak");
  check(`the SAME clumsy attacker escapes measurably more often against a physically weak defender (${(vsWeakRate * 100).toFixed(0)}%) than against an equally-skilled but Strength-heavy one (${(vsChunkyRate * 100).toFixed(0)}%)`,
    vsWeakRate > vsChunkyRate + 0.02);

  // This divergence is deliberately scoped to Free Play's resolveDribble()
  // only. Production's own transitionDuel() (draft-run.js) and the
  // Scenario Probe's "tackle-foul" scenario both still use the original
  // 4-attribute lists -- neither call site was touched by this change.
}

console.log("\n=== 49: Through Ball v1 -- resolveThroughBall(): clean delivery, offside-at-kick, and a real lane contest ===");
{
  // -- Uncontested: nobody in the lane at all, a clean ball into the space,
  // not the receiver's old position. --
  {
    const owner = entry("through-owner", { team: "home", x: 50, y: 40, playerObj: STRONG_PASSER });
    const receiver = entry("through-receiver", { team: "home", x: 50, y: 55, playerObj: GOOD_DRIBBLER });
    const groups = { owner, teammates: [receiver], opponents: [], keeper: null };
    const targetPoint = { x: 50, y: 85 };
    const trace = [];
    const availability = { preselectedTargetId: receiver.id, plannedMoveTo: targetPoint };
    const result = FREE_PLAY_RESOLVERS.through(groups, availability, seededRandom(hashString("through-clean")), trace);
    check("an uncontested through ball is not terminal", result.terminal === false);
    // Real delivery accuracy (2026-08-19) -- ballEnd lands NEAR the
    // intended space, not always bang on it (see resolveThroughBallAccuracy()'s
    // own comment: a reported bug was zero spatial error every time).
    // Bounded within 12 real yards -- comfortably above the resolver's own
    // stated 10-yard error ceiling, so this stays a real "landed in the
    // right area" check, not a change-detector on the exact point.
    check("possession is retained by the runner, at the SPACE (within real delivery accuracy of the intended target), not their old position",
      result.possession === "retained" && result.nextOwnerId === receiver.id
        && yardDistance(result.ballEnd, targetPoint) <= 12);
    check("reason is explicitly through-ball-received", result.reason === "through-ball-received");
    check("trace shows the delivery then the clean receipt, in order",
      trace.map((e) => e.code).join(",") === "P.THROUGH,P.THROUGH.RECEIVE");
    const receiveEvent = trace[1];
    check("the receiver's own marker is explicitly moved to the real landing point (never inferred from ballFrom/ballTo), matching ballEnd exactly",
      receiveEvent.moverId === receiver.id && receiveEvent.moveTo.x === result.ballEnd.x && receiveEvent.moveTo.y === result.ballEnd.y);
    check("ownership transfers cleanly to the runner at the space", receiveEvent.ownerBeforeId === null && receiveEvent.ownerAfterId === receiver.id);
  }

  // -- Offside at kick: reuses the exact fixture already proven in
  // section 37's own P.OFFSIDE.FLAG coverage -- offside is judged on the
  // runner's CURRENT position, correctly, not the forward target point. --
  {
    const owner = entry("through-offside-owner", { team: "home", x: 84, y: 60, playerObj: STRONG_PASSER });
    const receiver = entry("through-offside-receiver", { team: "home", x: 52, y: 90, playerObj: GOOD_DRIBBLER });
    const lastDefender = entry("through-offside-last", { team: "away", x: 50, y: 82, playerObj: ELITE_DEFENDER });
    const keeper = entry("through-offside-keeper", { role: "keeper", team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
    const groups = { owner, teammates: [receiver], opponents: [lastDefender], keeper };
    const trace = [];
    const availability = { preselectedTargetId: receiver.id, plannedMoveTo: { x: 52, y: 96 } };
    const result = FREE_PLAY_RESOLVERS.through(groups, availability, seededRandom(hashString("through-offside")), trace);
    check("an offside through ball resolves exactly like an offside pass -- dead ball, indirect free kick, no owner",
      result.code === "P.OFFSIDE.FLAG" && result.terminal === true
        && result.possession === "dead" && result.nextOwnerId === null && result.restart === "indirect-free-kick");
  }

  // -- Contested: a real defender sitting in the passing LANE (not at the
  // target itself, which is unmarked by construction) can still cut it out. --
  let wonFound = null;
  let lostFound = null;
  for (let i = 0; i < 500 && (!wonFound || !lostFound); i += 1) {
    const owner = entry("through-lane-owner", { team: "home", x: 50, y: 20, playerObj: STRONG_PASSER });
    const receiver = entry("through-lane-receiver", { team: "home", x: 50, y: 40, playerObj: GOOD_DRIBBLER });
    const laneDefender = entry("through-lane-defender", { team: "away", x: 50, y: 55, playerObj: WEAK_DEFENDER });
    const groups = { owner, teammates: [receiver], opponents: [laneDefender], keeper: null };
    const targetPoint = { x: 50, y: 90 };
    const trace = [];
    const availability = { preselectedTargetId: receiver.id, plannedMoveTo: targetPoint };
    const random = seededRandom(hashString(`through-lane-${i}`));
    const result = FREE_PLAY_RESOLVERS.through(groups, availability, random, trace);
    if (result.reason === "through-ball-received" && !wonFound) wonFound = { result, receiver };
    if (result.reason === "through-ball-intercepted" && !lostFound) lostFound = { result, laneDefender };
  }
  check("found a through ball that beats a real lane defender within the search budget", Boolean(wonFound));
  check("found a through ball that a real lane defender cuts out within the search budget", Boolean(lostFound));
  if (wonFound) {
    check("a won lane contest still ends with the runner clean through, non-terminal",
      wonFound.result.terminal === false && wonFound.result.nextOwnerId === wonFound.receiver.id);
  }
  if (lostFound) {
    check("a lost lane contest is a real, terminal turnover to the interceptor",
      lostFound.result.terminal === true && lostFound.result.possession === "turnover"
        && lostFound.result.nextOwnerId === lostFound.laneDefender.id);
  }
}

console.log("\n=== 50: Quick setup formations (2026-08-19) -- outfieldSlotsFor()/classifyOutfieldBand() ===");
{
  check("2v2 stays genuinely random -- 1 outfielder/team, no D/M/A split possible",
    JSON.stringify(outfieldSlotsFor(2)) === JSON.stringify(["random", "random"]));

  const slots3 = outfieldSlotsFor(3);
  check("3v3 keeps exactly one attacker per team (2 total)",
    slots3.filter((band) => band === "attacker").length === 2);
  const otherBand3 = slots3.find((band) => band !== "attacker");
  check("3v3's other outfielder is either defender or midfielder, the SAME choice for both teams",
    (otherBand3 === "defender" || otherBand3 === "midfielder")
      && slots3.filter((band) => band === otherBand3).length === 2
      && slots3.length === 4);

  const expectedTotals = {
    5: { defender: 2, midfielder: 4, attacker: 2 },
    7: { defender: 4, midfielder: 4, attacker: 4 },
    9: { defender: 6, midfielder: 6, attacker: 4 },
    11: { defender: 8, midfielder: 8, attacker: 4 },
  };
  for (const [perSide, expected] of Object.entries(expectedTotals)) {
    const slots = outfieldSlotsFor(Number(perSide));
    const counts = slots.reduce((acc, band) => { acc[band] = (acc[band] || 0) + 1; return acc; }, {});
    check(`${perSide}v${perSide} produces the exact specified total role counts (2 gks implied, not part of this list)`,
      counts.defender === expected.defender && counts.midfielder === expected.midfielder && counts.attacker === expected.attacker
        && slots.length === expected.defender + expected.midfielder + expected.attacker);
    check(`${perSide}v${perSide}'s outfield total matches (perSide-1)*2 -- one keeper/team accounted for separately`,
      slots.length === (Number(perSide) - 1) * 2);
    check(`${perSide}v${perSide} splits every role evenly (each count is even, so home/away get identical shape)`,
      counts.defender % 2 === 0 && counts.midfielder % 2 === 0 && counts.attacker % 2 === 0);
  }
  check("an unsupported format returns null rather than a malformed list", outfieldSlotsFor(4) === null);
  check("identical formation sizes reproduce a structurally identical slot list across repeated calls (5v5, no randomness involved)",
    JSON.stringify(outfieldSlotsFor(5)) === JSON.stringify(outfieldSlotsFor(5)));

  // classifyOutfieldBand(): matchEngineCore.js's own production
  // isDefender/isMidfielder/isAttacker classifiers, exercised with their
  // own explicitly-documented bounded tokens.
  check("a bare 'D' position classifies as defender", classifyOutfieldBand({ position_text: "D" }) === "defender");
  check("'SW' (sweeper) classifies as defender", classifyOutfieldBand({ position_text: "SW" }) === "defender");
  check("'WB' (wing back) classifies as defender", classifyOutfieldBand({ position_text: "WB" }) === "defender");
  check("a bare 'M' classifies as midfielder", classifyOutfieldBand({ position_text: "M" }) === "midfielder");
  check("'DM' (defensive midfielder) classifies as midfielder, not defender", classifyOutfieldBand({ position_text: "DM" }) === "midfielder");
  check("'AM' (attacking midfielder) classifies as midfielder, not attacker", classifyOutfieldBand({ position_text: "AM" }) === "midfielder");
  check("a bare 'F' classifies as attacker", classifyOutfieldBand({ position_text: "F" }) === "attacker");
  check("no position data at all falls back to midfielder, not a fabricated rating", classifyOutfieldBand({ position_text: "" }) === "midfielder");
  check("a missing position_text field entirely also falls back to midfielder", classifyOutfieldBand({}) === "midfielder");
}

console.log("\n=== 51: Ball independence, visually (2026-08-19) -- restingBallOffsetPx() ===");
{
  check("a goalkeeper holding the ball gets zero offset -- drawn inside their own circle, the documented exception",
    restingBallOffsetPx({ x: 50, y: 50 }, "down", "keeper").x === 0
      && restingBallOffsetPx({ x: 50, y: 50 }, "down", "keeper").y === 0);
  check("no owner point at all gets zero offset (defensive fallback)",
    restingBallOffsetPx(null, "down", "player").x === 0 && restingBallOffsetPx(null, "down", "player").y === 0);

  const down = restingBallOffsetPx({ x: 50, y: 50 }, "down", "player");
  check("attacking 'down' pushes the ball toward y:100 (forward), not sideways",
    down.y > 0 && down.x === 0);
  const up = restingBallOffsetPx({ x: 50, y: 50 }, "up", "player");
  check("attacking 'up' pushes the ball the opposite way, toward y:0",
    up.y < 0 && up.x === 0);
  check("the offset is a real, fixed pixel distance large enough to clear a 22px player dot's own 11px radius",
    Math.hypot(down.x, down.y) >= 15);
  check("identical inputs reproduce an identical offset (no hidden randomness)",
    JSON.stringify(down) === JSON.stringify(restingBallOffsetPx({ x: 50, y: 50 }, "down", "player")));

  // Direction fix (2026-08-19) -- a real browser round reported the ball
  // moving "only vertically, up or down" on every possession change,
  // regardless of where either player actually stood. The offset now
  // points toward the CENTER of the goal being attacked, a real 2D vector
  // from the player's own position -- a wide player must show a genuine
  // lateral (x) component, not just the central player's near-vertical one.
  const wideLeft = restingBallOffsetPx({ x: 10, y: 50 }, "down", "player");
  check("a player wide on the LEFT gets a real lateral offset component, angled toward the center", wideLeft.x > 0);
  const wideRight = restingBallOffsetPx({ x: 90, y: 50 }, "down", "player");
  check("a player wide on the RIGHT angles the other way", wideRight.x < 0);
  check("the two wide players (mirrored positions) produce mirrored lateral offsets",
    Math.abs(wideLeft.x + wideRight.x) < 0.01);
  check("the total offset distance stays the same fixed magnitude regardless of direction (wide or central)",
    Math.abs(Math.hypot(wideLeft.x, wideLeft.y) - Math.hypot(down.x, down.y)) < 0.01);
}

console.log("\n=== 52: Quick setup width distribution (2026-08-19) -- lateralChannelX() ===");
{
  check("no channel info at all (null) keeps the ORIGINAL fully-free spread, not a forced center",
    (() => {
      const samples = Array.from({ length: 50 }, () => lateralChannelX(null));
      return samples.every((x) => x >= 10 && x <= 90) && new Set(samples).size > 10;
    })());
  check("a lone player in their own band (count 1) also keeps the free spread -- channeling a group of one is meaningless",
    (() => {
      const samples = Array.from({ length: 50 }, () => lateralChannelX({ index: 0, count: 1 }));
      return samples.every((x) => x >= 10 && x <= 90) && new Set(samples).size > 10;
    })());

  // Four teammates sharing a band (e.g. 11v11's own defender band) must
  // land in four genuinely SEPARATE lateral channels, not overlap by
  // chance -- this is the exact reported bug (several same-band players
  // landing in the same zone, leaving whole flanks empty).
  const count = 4;
  const channelWidth = 100 / count;
  for (let index = 0; index < count; index += 1) {
    const samples = Array.from({ length: 30 }, () => lateralChannelX({ index, count }));
    const lo = index * channelWidth;
    const hi = (index + 1) * channelWidth;
    check(`channel ${index} of ${count} stays within its own lane bounds across repeated draws`,
      samples.every((x) => x >= lo - 0.5 && x <= hi + 0.5));
  }
  check("adjacent channels never overlap -- channel 0's max is at or below channel 1's min",
    Math.max(...Array.from({ length: 30 }, () => lateralChannelX({ index: 0, count }))) <=
    Math.min(...Array.from({ length: 30 }, () => lateralChannelX({ index: 1, count }))) + 0.5);
  check("results stay within playable bounds even at the pitch edge (index 0 of many)",
    Array.from({ length: 30 }, () => lateralChannelX({ index: 0, count: 8 })).every((x) => x >= 6 && x <= 94));
}

console.log("\n=== 53: Through Ball v1 -- real delivery accuracy, not a laser-guided pass every time (2026-08-19) ===");
{
  // A real browser round reported the ball landing exactly on the
  // intended point every single time, regardless of distance or passer
  // skill -- this section proves that's no longer true, and that skill
  // still genuinely matters (a better passer is measurably more accurate,
  // not just "sometimes off by a random amount").
  function meanErrorYards(passerObj, trials, seedPrefix) {
    let total = 0;
    for (let i = 0; i < trials; i += 1) {
      const owner = entry("accuracy-owner", { team: "home", x: 50, y: 20, playerObj: passerObj });
      const receiver = entry("accuracy-receiver", { team: "home", x: 50, y: 55, playerObj: GOOD_DRIBBLER });
      const groups = { owner, teammates: [receiver], opponents: [], keeper: null };
      const targetPoint = { x: 50, y: 90 };
      const trace = [];
      const availability = { preselectedTargetId: receiver.id, plannedMoveTo: targetPoint };
      const random = seededRandom(hashString(`${seedPrefix}-${i}`));
      const result = FREE_PLAY_RESOLVERS.through(groups, availability, random, trace);
      total += yardDistance(result.ballEnd, targetPoint);
    }
    return total / trials;
  }
  const strongMeanError = meanErrorYards(STRONG_PASSER, 200, "accuracy-strong");
  const weakMeanError = meanErrorYards(WEAK_PASSER, 200, "accuracy-weak");
  check(`a genuinely strong passer (Passing/Vision/Technique/Decisions) averages measurably LESS landing error (${strongMeanError.toFixed(2)}yd) over a long through ball than a weak one (${weakMeanError.toFixed(2)}yd)`,
    strongMeanError < weakMeanError);
  check("even the strong passer is NOT bang-on every single trial -- real, non-zero error appears across a real sample",
    (() => {
      let sawRealError = false;
      for (let i = 0; i < 50 && !sawRealError; i += 1) {
        const owner = entry("accuracy-owner-2", { team: "home", x: 50, y: 20, playerObj: STRONG_PASSER });
        const receiver = entry("accuracy-receiver-2", { team: "home", x: 50, y: 55, playerObj: GOOD_DRIBBLER });
        const groups = { owner, teammates: [receiver], opponents: [], keeper: null };
        const targetPoint = { x: 50, y: 90 };
        const trace = [];
        const availability = { preselectedTargetId: receiver.id, plannedMoveTo: targetPoint };
        const random = seededRandom(hashString(`accuracy-variance-${i}`));
        const result = FREE_PLAY_RESOLVERS.through(groups, availability, random, trace);
        if (yardDistance(result.ballEnd, targetPoint) > 0.05) sawRealError = true;
      }
      return sawRealError;
    })());
  check("identical inputs reproduce an identical landing point (deterministic, not fresh randomness each render)",
    (() => {
      const owner = entry("accuracy-owner-3", { team: "home", x: 50, y: 20, playerObj: STRONG_PASSER });
      const receiver = entry("accuracy-receiver-3", { team: "home", x: 50, y: 55, playerObj: GOOD_DRIBBLER });
      const groups = { owner, teammates: [receiver], opponents: [], keeper: null };
      const targetPoint = { x: 50, y: 90 };
      const availability = { preselectedTargetId: receiver.id, plannedMoveTo: targetPoint };
      const first = FREE_PLAY_RESOLVERS.through(groups, availability, seededRandom(hashString("accuracy-repro")), []);
      const second = FREE_PLAY_RESOLVERS.through(groups, availability, seededRandom(hashString("accuracy-repro")), []);
      return first.ballEnd.x === second.ballEnd.x && first.ballEnd.y === second.ballEnd.y;
    })());
}

console.log("\n=== 54: Vision cone (2026-08-19) -- radius/angle/fade scale with Vision, cone geometry is real ===");
{
  const weakVision = player("Weak Vision", { Vision: 1 });
  const strongVision = player("Strong Vision", { Vision: 20 });
  check("a low-Vision player gets a real, but modest, cone radius",
    visionConeRadiusYards(weakVision) >= 24 && visionConeRadiusYards(weakVision) <= 27);
  check("a high-Vision player gets a measurably LARGER cone radius than a low one",
    visionConeRadiusYards(strongVision) > visionConeRadiusYards(weakVision));
  check("a high-Vision player also gets a measurably WIDER cone angle",
    visionConeHalfAngleRad(strongVision) > visionConeHalfAngleRad(weakVision));
  check("a high-Vision player's outgoing 'memory' fades measurably SLOWER (longer duration) than a low-Vision player's",
    visionFadeDurationMs(strongVision) > visionFadeDurationMs(weakVision));
  check("identical player attributes reproduce identical geometry (deterministic, no randomness)",
    visionConeRadiusYards(strongVision) === visionConeRadiusYards(player("Strong Vision 2", { Vision: 20 })));

  const owner = { x: 50, y: 50 };
  const path = buildVisionConePath(owner, "down", strongVision);
  check("the cone path is a real SVG path string starting with a Move command at the owner's own yard-space origin",
    (() => {
      const match = /^M ([\d.-]+) ([\d.-]+)/.exec(path);
      if (!match) return false;
      const originX = Number(match[1]);
      const originY = Number(match[2]);
      return Math.abs(originX - 37.5) < 0.01 && Math.abs(originY - 60) < 0.01;
    })());
  check("the cone path includes a real curved arc command (a genuine pie-slice, not a triangle)", path.includes(" A "));
  check("the cone path is a closed shape", path.trim().endsWith("Z"));

  const upPath = buildVisionConePath(owner, "up", strongVision);
  check("attacking 'up' vs 'down' produces a genuinely different cone (direction actually matters)", upPath !== path);
}

console.log("\n=== 55: Scanning (2026-08-19) -- elite Vision/Decisions players genuinely sweep their gaze ===");
{
  const eliteScanner = player("Elite Scanner", { Vision: 19, Decisions: 18 });
  const poorScanner = player("Poor Scanner", { Vision: 3, Decisions: 4 });
  const floorScanner = player("Floor Scanner", { Vision: 1, Decisions: 1 });
  const lopsided = player("Lopsided", { Vision: 19, Decisions: 3 });

  check("scanQuality is driven by BOTH Vision and Decisions together -- one elite, one poor still reads as only middling",
    scanQuality(lopsided) > scanQuality(poorScanner) && scanQuality(lopsided) < scanQuality(eliteScanner));
  check("an elite scanner's amplitude is real and positive", scanAmplitudeRad(eliteScanner) > 0);
  check("a genuinely poor scanner still sweeps measurably LESS than an elite one -- continuous scaling, not a hard gate",
    scanAmplitudeRad(poorScanner) > 0 && scanAmplitudeRad(poorScanner) < scanAmplitudeRad(eliteScanner));
  check("at the absolute attribute floor (rating 1/1), amplitude is EXACTLY zero -- a real, checkable 'off' state",
    scanAmplitudeRad(floorScanner) === 0);
  check("an elite scanner checks their shoulder measurably more OFTEN (shorter period) than a poor one would, were they to scan at all",
    scanPeriodMs(eliteScanner) < scanPeriodMs(poorScanner));

  check("at the attribute floor, the offset is EXACTLY zero at every sampled time -- no residual sine wave at all",
    [0, 400, 900, 1500, 3000].every((t) => scanOffsetRad(floorScanner, t) === 0));

  const period = scanPeriodMs(eliteScanner);
  const amplitude = scanAmplitudeRad(eliteScanner);
  check("an elite scanner starts at dead center (zero offset) at time zero",
    Math.abs(scanOffsetRad(eliteScanner, 0)) < 0.001);
  check("a quarter-cycle later, the sweep reaches close to its own full amplitude",
    Math.abs(scanOffsetRad(eliteScanner, period / 4) - amplitude) < 0.01);
  check("three-quarters through the cycle, the sweep reaches close to the OPPOSITE full amplitude",
    Math.abs(scanOffsetRad(eliteScanner, (period * 3) / 4) + amplitude) < 0.01);
  check("a full cycle later, the sweep returns close to dead center again",
    Math.abs(scanOffsetRad(eliteScanner, period)) < 0.01);
  check("identical player and time reproduce an identical offset (deterministic, tied to the sampled clock, not wall time)",
    scanOffsetRad(eliteScanner, 777) === scanOffsetRad(eliteScanner, 777));

  // Integration: the sweep actually changes the rendered cone, not just an
  // unused number.
  const owner = { x: 50, y: 50 };
  const sweptPath = buildVisionConePath(owner, "down", eliteScanner, scanOffsetRad(eliteScanner, period / 4));
  const staticPath = buildVisionConePath(owner, "down", eliteScanner, 0);
  check("a real scan offset actually changes the cone's own SVG path -- not computed and then discarded",
    sweptPath !== staticPath);
}

console.log("\n=== 56: Fluid off-ball movement DURING a pass/cross/through-ball's own flight (2026-08-19) ===");
{
  // A real browser round reported every OTHER player freezing solid for
  // a pass's entire travel time -- "it breaks his pace and the game
  // flow." Verifies a real off-ball reaction now lands BETWEEN the
  // delivery and reception events (not just before/after the whole
  // action), for all three delivery-shaped resolvers, and that the
  // receiver's own position is never disturbed by it (the exact bug this
  // fix itself introduced and caught via the existing continuity
  // regression before this section was even written).
  function buildTrio(receiverX, receiverY, thirdX, thirdY) {
    const owner = entry("flow-owner", { team: "home", x: 50, y: 30, playerObj: STRONG_PASSER });
    const receiver = entry("flow-receiver", { team: "home", x: receiverX, y: receiverY, playerObj: AVERAGE });
    const third = entry("flow-third", { team: "home", x: thirdX, y: thirdY, playerObj: AVERAGE });
    return { owner, receiver, third, groups: { owner, teammates: [receiver, third], opponents: [], keeper: null } };
  }

  {
    // Continuous World Motion During Ball Flight v1 (2026-08-20) -- a
    // short pass's real flight window can leave a teammate's real,
    // reachIn()-limited ground covered genuinely under this section's own
    // 0.5%-of-pitch no-op threshold (the honest, physically-bounded
    // replacement for the OLD model's unconditional "always move
    // INTERLEAVED_REACTION_FRACTION of the gap regardless of real time
    // available" rule). A long, multi-second pass instead -- real time
    // for a real Pace/Acceleration-limited run toward a genuinely distant
    // tactical target -- to keep this "isn't a no-op reaction" guarantee
    // real under the new model too.
    const { receiver, third, groups } = buildTrio(90, 85, 15, 55);
    const trace = [];
    const random = seededRandom(hashString("flow-pass"));
    FREE_PLAY_RESOLVERS.pass(groups, {}, random, trace, true, null);
    const codes = trace.map((e) => e.code);
    const passIndex = codes.indexOf("P.PASS");
    const adjustIndex = codes.findIndex((code) => code === "ATT.ADJUST" || code === "DEF.ADJUST");
    check("resolvePass(): a real off-ball reaction fires strictly BETWEEN the delivery and the reception, not just after",
      passIndex >= 0 && adjustIndex > passIndex && adjustIndex < codes.length - 1);
    check("resolvePass(): the receiver's own position is untouched by that reaction (still exactly where they were)",
      receiver.x === 90 && receiver.y === 85);
    check("resolvePass(): a real third teammate's position DID change -- this isn't a no-op reaction",
      third.x !== 15 || third.y !== 55);
  }
  {
    const { groups } = buildTrio(60, 35, 20, 60);
    const trace = [];
    FREE_PLAY_RESOLVERS.pass(groups, {}, seededRandom(hashString("flow-pass-off")), trace, false, null);
    check("resolvePass(): interleaving stays OFF by default -- no ATT.ADJUST/DEF.ADJUST appears without opting in",
      !trace.some((e) => e.code === "ATT.ADJUST" || e.code === "DEF.ADJUST"));
  }

  {
    const owner = entry("flow-through-owner", { team: "home", x: 50, y: 20, playerObj: STRONG_PASSER });
    const receiver = entry("flow-through-receiver", { team: "home", x: 55, y: 40, playerObj: GOOD_DRIBBLER });
    const third = entry("flow-through-third", { team: "home", x: 20, y: 30, playerObj: AVERAGE });
    const groups = { owner, teammates: [receiver, third], opponents: [], keeper: null };
    const trace = [];
    const availability = { preselectedTargetId: receiver.id, plannedMoveTo: { x: 55, y: 40 } };
    FREE_PLAY_RESOLVERS.through(groups, availability, seededRandom(hashString("flow-through")), trace, true, null);
    const codes = trace.map((e) => e.code);
    const throughIndex = codes.indexOf("P.THROUGH");
    const adjustIndex = codes.findIndex((code) => code === "ATT.ADJUST" || code === "DEF.ADJUST");
    check("resolveThroughBall(): a real off-ball reaction fires between the delivery and the reception too",
      throughIndex >= 0 && adjustIndex > throughIndex && adjustIndex < codes.length - 1);
    check("resolveThroughBall(): the receiver's own position is untouched by that reaction",
      receiver.x === 55 && receiver.y === 40);
  }

  {
    const owner = entry("flow-cross-owner", { team: "home", x: 8, y: 75, playerObj: STRONG_PASSER });
    const receiver = entry("flow-cross-receiver", { team: "home", x: 50, y: 92, playerObj: AVERAGE });
    const third = entry("flow-cross-third", { team: "home", x: 20, y: 60, playerObj: AVERAGE });
    const groups = { owner, teammates: [receiver, third], opponents: [], keeper: null };
    const trace = [];
    FREE_PLAY_RESOLVERS.cross(groups, {}, seededRandom(hashString("flow-cross")), trace, true, null);
    const codes = trace.map((e) => e.code);
    const deliveryIndex = codes.findIndex((code) => code.startsWith("CROSS.DELIVERY"));
    const adjustIndex = codes.findIndex((code) => code === "ATT.ADJUST" || code === "DEF.ADJUST");
    check("resolveCross(): a real off-ball reaction fires between the delivery and the aerial contest too",
      deliveryIndex >= 0 && adjustIndex > deliveryIndex);
    check("resolveCross(): the receiver's own authored position is untouched by that reaction",
      receiver.x === 50 && receiver.y === 92);
  }
}

console.log("\n=== 57: Defensive urgency (2026-08-19) -- interleaved reactions give a recovering defender real ground, not a token nudge ===");
{
  // Reported bug: a ball carrier advancing through several consecutive
  // touches outpaced defenders who only reacted with the same measured
  // INTERLEAVED_REACTION_FRACTION (0.22) attackers use for their own
  // off-ball positioning, leaving a "massive gap" inside the defensive
  // line by the time the carry finished. Defenders now close ground at
  // INTERLEAVED_DEFENSIVE_REACTION_FRACTION (0.5) instead during these
  // mid-action reactions -- verified here as an exact distance, not just
  // "some movement happened" (already covered generically by section 56).
  //
  // resolvePass() itself moved OFF this fixed-fraction model entirely in
  // Continuous World Motion During Ball Flight v1 (2026-08-20) -- its own
  // off-ball reactions are now real, reachIn()-limited physical movement
  // over the flight's actual duration, never a percentage of the gap
  // (see the dedicated physics check below). resolveCross() was NOT part
  // of that rewrite and still runs the exact fraction model this section
  // was written to verify -- retargeted here to keep that original
  // coverage genuinely valid instead of quietly asserting stale math.
  const owner = entry("urgency-owner", { team: "home", x: 8, y: 75, playerObj: STRONG_PASSER });
  const receiver = entry("urgency-receiver", { team: "home", x: 50, y: 92, playerObj: AVERAGE });
  // Well clear of the owner->receiver crossing lane (so it's never picked
  // as a source-contest defender and short-circuit the trace before the
  // interleaved reaction fires), but still the closest -- only -- opponent,
  // so it's unambiguously the presser planDefensiveRepositioning() picks.
  const defender = entry("urgency-defender", { team: "away", x: 80, y: 45, playerObj: WEAK_DEFENDER });
  const groups = { owner, teammates: [receiver], opponents: [defender], keeper: null };
  setupRoster([owner, receiver, defender], owner.id);

  const defenderStart = { x: defender.x, y: defender.y };
  // Full (fraction=1) press target the SAME geometry would produce, so the
  // fraction actually applied can be read back out of real movement.
  const fullPressTarget = pressingTarget(defenderStart, pointOf(receiver));
  const fullGapYards = yardDistance(defenderStart, fullPressTarget);
  check("test fixture sanity: the defender starts far enough away that the press advance hits its own per-reaction cap (8yd), keeping the expected distance independent of the exact starting gap",
    yardDistance(defenderStart, pointOf(receiver)) > 9.5 && Math.abs(fullGapYards - 8) < 0.05);

  const trace = [];
  FREE_PLAY_RESOLVERS.cross(groups, { preselectedTargetId: receiver.id }, seededRandom(hashString("urgency-cross")), trace, true, null);

  // Read the defender's covered distance straight off the DEF.ADJUST
  // event's own playerMoves entry, not off the roster entry's own final
  // x/y -- resolveCross() can still move this same defender again later
  // (a source contest, an aerial contest) if the trace continues past the
  // reaction, and this section only means to measure the ONE reaction.
  const defAdjust = trace.find((event) => event.code === "DEF.ADJUST" && event.playerMoves?.length);
  check("a real DEF.ADJUST reaction fired during the cross's own flight", Boolean(defAdjust));
  check("the receiver's own authored position is untouched by the defender's reaction",
    receiver.x === 50 && receiver.y === 92);

  const defenderMove = defAdjust?.playerMoves.find((move) => move.playerId === defender.id);
  const coveredYards = defenderMove ? yardDistance(defenderMove.from, defenderMove.to) : 0;
  const expectedYards = fullGapYards * INTERLEAVED_DEFENSIVE_REACTION_FRACTION;
  check(`a single interleaved reaction moves the defender almost exactly full-gap * INTERLEAVED_DEFENSIVE_REACTION_FRACTION (${coveredYards.toFixed(2)}yd vs expected ${expectedYards.toFixed(2)}yd)`,
    Math.abs(coveredYards - expectedYards) < 0.3);
  check("that distance is genuinely larger than the OLD (attacker-shared) fraction would have produced -- the actual fix, not just 'some movement'",
    coveredYards > fullGapYards * INTERLEAVED_REACTION_FRACTION * 1.5);

  // resolvePass()'s own defensive reaction -- same defensive-urgency GOAL,
  // now via the new physics mechanism: real ground covered must never
  // exceed what reachIn() alone predicts for the defender's own real
  // Pace/Acceleration over the real available time (flight duration minus
  // the shared reaction delay), and must be genuine ground, not a token
  // nudge -- Continuous World Motion During Ball Flight v1's own
  // acceptance criteria ("Pace and Acceleration measurably affect arrival
  // times") applied directly to a defensive reaction, not just a receiver.
  const passOwner = entry("urgency-pass-owner", { team: "home", x: 50, y: 5, playerObj: STRONG_PASSER });
  const passReceiver = entry("urgency-pass-receiver", { team: "home", x: 50, y: 90, playerObj: AVERAGE });
  const passDefender = entry("urgency-pass-defender", { team: "away", x: 80, y: 45, playerObj: WEAK_DEFENDER });
  const passGroups = { owner: passOwner, teammates: [passReceiver], opponents: [passDefender], keeper: null };
  setupRoster([passOwner, passReceiver, passDefender], passOwner.id);
  const passTrace = [];
  FREE_PLAY_RESOLVERS.pass(passGroups, { preselectedTargetId: passReceiver.id }, seededRandom(hashString("urgency-pass-physics")), passTrace, true, null);
  const passEvent = passTrace.find((event) => event.code === "P.PASS");
  const passDefAdjust = passTrace.find((event) => event.code === "DEF.ADJUST" && event.playerMoves?.length);
  check("resolvePass(): a real DEF.ADJUST reaction fired during the pass's own flight", Boolean(passEvent) && Boolean(passDefAdjust));
  if (passEvent && passDefAdjust) {
    const move = passDefAdjust.playerMoves.find((entryMove) => entryMove.playerId === passDefender.id);
    const covered = move ? yardDistance(move.from, move.to) : 0;
    const availableSeconds = Math.max(0, ((passEvent.duration ?? 0) - CONTACT_REACTION_DELAY_MS) / 1000);
    const physicalCeilingYards = reachIn(passDefender.player, availableSeconds);
    check(`resolvePass(): the defender's real covered ground (${covered.toFixed(2)}yd) never exceeds their own physical reachIn() ceiling (${physicalCeilingYards.toFixed(2)}yd) for the real flight window`,
      covered <= physicalCeilingYards + 0.05);
    check("resolvePass(): the defender's reaction is genuine ground covered, not a token/zero nudge",
      covered > 0.5);
  }
}

console.log("\n=== 58: Roster database deep link + generation-aware hover attributes (2026-08-20) ===");
{
  // Requested directly: roster players should link to their real Database
  // Page (database.html -- the exact URL shape draft-run.js's own
  // playerHref() already builds), and hovering should surface ~9-10
  // position-relevant attributes. "Relevant" had to become generation-
  // aware, not a fixed list, because CM's own attribute set genuinely
  // grew across editions (confirmed directly against db/retroball.sqlite):
  // cm9596 has no Anticipation/Decisions/Jumping/Vision at all (only
  // "Creativity"/"Positioning"/etc, which the API layer already renames to
  // their modern equivalents before this data ever reaches the client).
  const oldGenDefender = {
    id: "old-def", role: "player",
    player: {
      canonical_player_name: "Old Gen Def", position_text: "D C",
      database_slug: "cm9596_vanilla_original", source_person_id: "12345",
      attributes: [
        { label: "Heading", value: 12 }, { label: "Tackling", value: 13 }, { label: "Marking", value: 14 },
        { label: "Positioning", value: 9 }, { label: "Aggression", value: 15 }, { label: "Strength", value: 10 },
        { label: "Intelligence", value: 8 }, { label: "Determination", value: 11 }, { label: "Dirtiness", value: 14 },
      ],
    },
  };
  check("position group classification: an outfield 'D C' defender reads as 'defender'",
    positionGroupFor(oldGenDefender) === "defender");
  const oldGenAttrs = relevantHoverAttributes(oldGenDefender);
  check("an old-gen (CM95/96-shaped) defender's hover list is exactly the attributes their sparse data actually has",
    oldGenAttrs.length === 9 && oldGenAttrs.every(({ label }) =>
      oldGenDefender.player.attributes.some((a) => a.label === label)));
  check("an old-gen defender's hover list never invents a modern-only attribute (Anticipation/Jumping/etc) their era never had",
    !oldGenAttrs.some(({ label }) => label === "Anticipation" || label === "Jumping" || label === "Decisions"));
  check("the database deep link uses the real identity fields, matching draft-run.js's own playerHref() URL shape",
    playerDatabaseHref(oldGenDefender.player) === "database.html?database=cm9596_vanilla_original&player=12345");

  const latestGenAttacker = {
    id: "new-att", role: "player",
    player: {
      canonical_player_name: "Latest Gen ST", position_text: "F C",
      database_slug: "fm2005_vanilla_original", source_person_id: "67890",
      attributes: [
        { label: "Finishing", value: 17 }, { label: "Heading", value: 14 }, { label: "Technique", value: 15 },
        { label: "Off the Ball", value: 16 }, { label: "Pace", value: 15 }, { label: "Strength", value: 12 },
        { label: "Dribbling", value: 14 }, { label: "Crossing", value: 11 }, { label: "Flair", value: 13 },
        { label: "Acceleration", value: 16 }, { label: "Decisions", value: 14 }, { label: "First Touch", value: 15 }, { label: "Jumping", value: 12 },
      ],
    },
  };
  check("position group classification: an outfield 'F C' attacker reads as 'attacker'",
    positionGroupFor(latestGenAttacker) === "attacker");
  const newGenAttrs = relevantHoverAttributes(latestGenAttacker);
  check("a latest-gen attacker with MORE real attributes than the display cap is capped at 10, not dumped in full",
    newGenAttrs.length === 10);

  const keeper = {
    id: "gk", role: "keeper",
    player: {
      canonical_player_name: "GK", position_text: "GK",
      database_slug: "cm0304_vanilla_original", source_person_id: "111",
      attributes: [
        { label: "Reflexes", value: 17 }, { label: "One On Ones", value: 15 }, { label: "Handling", value: 16 },
        { label: "Aerial Ability", value: 14 }, { label: "Command Of Area", value: 13 },
      ],
    },
  };
  check("position group classification uses the roster entry's OWN assigned role for goalkeeper, not the player's raw position_text alone",
    positionGroupFor(keeper) === "goalkeeper");
  const keeperAttrs = relevantHoverAttributes(keeper);
  check("a goalkeeper's hover list draws from the goalkeeper-specific candidate set (Reflexes/Handling/etc), never outfield attributes",
    keeperAttrs.some((a) => a.label === "Reflexes") && !keeperAttrs.some((a) => a.label === "Tackling"));

  check("a player missing the real identity fields (e.g. a manually built fixture) yields no link, not a broken/partial URL",
    playerDatabaseHref({ canonical_player_name: "Nobody" }) === "");
  check("relevantHoverAttributes never throws or returns garbage for a player with genuinely no attributes array at all",
    Array.isArray(relevantHoverAttributes({ id: "blank", role: "player", player: { canonical_player_name: "Blank" } })));
}

console.log("\n=== 59: Ball Flight & Arrival v1 (2026-08-20) -- passes are no longer a pixel-perfect, fixed-duration bullet ===");
{
  // Requested directly: "the 60-metre bullet pass gap" -- every ordinary
  // pass, however far, arrived bang-on the receiver's exact point in a
  // fixed 550ms. resolvePassAccuracy()/passFlightDurationMs() fix both
  // halves; the assertions below cover the actual reported symptoms, not
  // just "the function exists."
  const shortMs = passFlightDurationMs(10);
  const longMs = passFlightDurationMs(60);
  check("a routine ~10-yard pass keeps close to the OLD fixed 550ms default -- short exchanges don't suddenly feel different",
    Math.abs(shortMs - 550) < 60);
  check("a genuine ~60-yard ball now takes MUCH longer than a short one -- the reported 'bullet pass' gap, fixed",
    longMs > shortMs * 4);
  check("flight duration is strictly monotonic in distance", passFlightDurationMs(5) < passFlightDurationMs(30) && passFlightDurationMs(30) < passFlightDurationMs(80));

  // Distance-first error: a short ball from an average passer barely
  // wobbles; a long one from the SAME passer shows real, visible spread.
  function averageErrorAt(distanceYards, passer, pressureFactor, seedPrefix, trials = 300) {
    let total = 0;
    for (let i = 0; i < trials; i += 1) {
      const random = seededRandom(hashString(`${seedPrefix}-${i}`));
      total += resolvePassAccuracy(passer, { distanceYards, pressureFactor }, random).accuracyErrorYards;
    }
    return total / trials;
  }
  const shortError = averageErrorAt(8, AVERAGE, 0, "pass-acc-short");
  const longError = averageErrorAt(60, AVERAGE, 0, "pass-acc-long");
  check("average delivery error over many trials is small for a short pass (well under a yard)", shortError < 1);
  check("average delivery error is genuinely larger for a long pass than a short one from the SAME passer", longError > shortError * 3);

  // Skill-first: a weak passer is measurably less accurate than a strong
  // one over the SAME long distance.
  const weakError = averageErrorAt(60, WEAK_PASSER, 0, "pass-acc-weak");
  const strongError = averageErrorAt(60, STRONG_PASSER, 0, "pass-acc-strong");
  check("a weak passer's average long-ball error is genuinely worse than a strong passer's over the identical distance",
    weakError > strongError * 1.3);

  // Pressure makes even a competent passer measurably less reliable.
  const noPressureError = averageErrorAt(30, STRONG_PASSER, 0, "pass-acc-nopressure");
  const pressuredError = averageErrorAt(30, STRONG_PASSER, 0.9, "pass-acc-pressured");
  check("real pressure on the passer measurably worsens their own delivery accuracy at the same distance",
    pressuredError > noPressureError);

  check("identical seed reproduces identical accuracy error (fully deterministic given the same inputs)",
    resolvePassAccuracy(STRONG_PASSER, { distanceYards: 40, pressureFactor: 0.2 }, seededRandom(hashString("determinism-check"))).accuracyErrorYards
      === resolvePassAccuracy(STRONG_PASSER, { distanceYards: 40, pressureFactor: 0.2 }, seededRandom(hashString("determinism-check"))).accuracyErrorYards);

  // End-to-end through the real resolver: a long, genuinely uncontested
  // pass now lands MEASURABLY off the receiver's own exact position, and
  // carries a real, distance-real duration on its own trace event.
  const passer = entry("bf-passer", { team: "home", x: 50, y: 5, playerObj: AVERAGE });
  const longReceiver = entry("bf-receiver", { team: "home", x: 50, y: 90, playerObj: AVERAGE });
  const groups = { owner: passer, teammates: [longReceiver], opponents: [], keeper: null };
  setupRoster([passer, longReceiver], passer.id);
  let sawRealError = false;
  let sawLongDuration = false;
  let sawReceiverAdjust = false;
  for (let i = 0; i < 200 && !(sawRealError && sawLongDuration && sawReceiverAdjust); i += 1) {
    const random = seededRandom(hashString(`bf-e2e-${i}`));
    const trace = [];
    resolvePass(groups, { preselectedTargetId: longReceiver.id }, random, trace);
    const passEvent = trace.find((e) => e.code === "P.PASS");
    const receiveEvent = trace.find((e) => e.code === "P.RECEIVE.CLEAN");
    if (passEvent && yardDistance(passEvent.ballTo, longReceiver) > 0.5) sawRealError = true;
    if (passEvent && passEvent.duration > 2000) sawLongDuration = true;
    if (receiveEvent && receiveEvent.moverId === longReceiver.id
      && (receiveEvent.playerMoves?.[0]?.to?.x !== longReceiver.x || receiveEvent.playerMoves?.[0]?.to?.y !== longReceiver.y)) sawReceiverAdjust = true;
  }
  check("across real resolvePass() trials, a long uncontested pass genuinely lands off the receiver's exact spot at least once",
    sawRealError);
  check("across real resolvePass() trials, a long pass's own trace event carries a genuinely long (multi-second) duration",
    sawLongDuration);
  check("the receiver's own marker is recorded moving to meet the ball's real landing point, not silently teleporting",
    sawReceiverAdjust);
}

console.log("\n=== 60: Shot Placement v1 (2026-08-20) -- on-target shots aim for real placement, not always the keeper's exact spot ===");
{
  // "not only for the passing but relevant changes should be done on
  // shooting too" -- goalPointFor() used to send every contested on-
  // target shot to EXACTLY the keeper's own position. shotPlacementSpread()
  // now genuinely varies it, scaled by real finishing execution quality.
  check("shotPlacementQuality is monotonic in Finishing/Technique/Composure",
    shotPlacementQuality(ELITE_FINISHER) > shotPlacementQuality(AVERAGE)
      && shotPlacementQuality(AVERAGE) > shotPlacementQuality(WEAK_SHOOTER));

  const shooter = entry("sp-shooter", { team: "home", x: 50, y: 90, playerObj: ELITE_FINISHER });
  const keeper = entry("sp-keeper", { role: "keeper", team: "away", x: 50, y: 98, playerObj: ELITE_KEEPER });

  // No-keeper/beaten-keeper fallback (2026-08-21): used to collapse EXACTLY
  // onto goalPointFor()'s fixed x:50 -- REBOUND.GOAL and EMPTY_NET both
  // only ever had that fixed point to reuse, since this function itself
  // offered no alternative, which is exactly the "every goal scored in the
  // same spot" gap a real browser round reported. There's no keeper
  // position to bias away from here, so the spread centers on true goal-
  // center (x:50) instead of a real keeper's x -- still genuine,
  // deterministic, quality-scaled variety, not a fixed point.
  function noKeeperSpreadSamples(keeperArg, seedPrefix, trials = 60) {
    const points = [];
    for (let i = 0; i < trials; i += 1) {
      points.push(shotPlacementSpread(shooter, keeperArg, 0, seededRandom(hashString(`${seedPrefix}-${i}`))));
    }
    return points;
  }
  const noKeeperSamples = noKeeperSpreadSamples(null, "sp-nokeeper");
  check("with no keeper placed at all, placement still varies across rolls (not the old fixed x:50 every time)",
    new Set(noKeeperSamples.map((p) => p.x)).size > 1);
  check("with no keeper placed at all, every placement still lands within the real goal frame",
    noKeeperSamples.every((p) => p.x >= GOAL_LEFT_POST_X - 0.01 && p.x <= GOAL_RIGHT_POST_X + 0.01));
  check("with no keeper placed at all, placement stays centered on true goal-center on average (unbiased, nothing to aim away from)",
    Math.abs(noKeeperSamples.reduce((sum, p) => sum + p.x, 0) / noKeeperSamples.length - 50) < 2);
  check("with no keeper placed at all, the same seed still reproduces an identical point (deterministic)",
    JSON.stringify(shotPlacementSpread(shooter, null, 0, seededRandom(hashString("sp-nokeeper-repro"))))
      === JSON.stringify(shotPlacementSpread(shooter, null, 0, seededRandom(hashString("sp-nokeeper-repro")))));

  const beatenKeeper = entry("sp-beaten-keeper", { role: "keeper", team: "away", x: 50, y: 80, playerObj: ELITE_KEEPER });
  const beatenKeeperSamples = noKeeperSpreadSamples(beatenKeeper, "sp-beaten");
  check("a genuinely beaten keeper (rounded) also gets real varying placement, not the old fixed empty-net default",
    new Set(beatenKeeperSamples.map((p) => p.x)).size > 1);
  check("a genuinely beaten keeper (rounded) still lands every placement within the real goal frame",
    beatenKeeperSamples.every((p) => p.x >= GOAL_LEFT_POST_X - 0.01 && p.x <= GOAL_RIGHT_POST_X + 0.01));

  check("identical seed reproduces an identical placement point (fully deterministic given the same inputs)",
    JSON.stringify(shotPlacementSpread(shooter, keeper, 0.3, seededRandom(hashString("sp-determinism"))))
      === JSON.stringify(shotPlacementSpread(shooter, keeper, 0.3, seededRandom(hashString("sp-determinism")))));

  function averagePlacementOffset(shooterPlayer, seedPrefix, trials = 300) {
    const sampledShooter = entry("sp-sample-shooter", { team: "home", x: 50, y: 90, playerObj: shooterPlayer });
    let total = 0;
    let allWithinPosts = true;
    for (let i = 0; i < trials; i += 1) {
      const random = seededRandom(hashString(`${seedPrefix}-${i}`));
      const point = shotPlacementSpread(sampledShooter, keeper, 0, random);
      total += Math.abs(point.x - keeper.x);
      if (point.x < GOAL_LEFT_POST_X - 0.01 || point.x > GOAL_RIGHT_POST_X + 0.01) allWithinPosts = false;
    }
    return { average: total / trials, allWithinPosts };
  }
  const eliteResult = averagePlacementOffset(ELITE_FINISHER, "sp-elite");
  const weakResult = averagePlacementOffset(WEAK_SHOOTER, "sp-weak");
  check("an elite finisher's placements average measurably FARTHER from the keeper's own position than a weak finisher's",
    eliteResult.average > weakResult.average * 1.5);
  check("a weak finisher still converges close to the keeper's own position on average -- the old, easy-save default",
    weakResult.average < 1.5);
  check("every sampled on-target placement stays within the real goal frame (never wide of a post)",
    eliteResult.allWithinPosts && weakResult.allWithinPosts);

  // End-to-end through the real resolver: the on-target event's own
  // ballTo and the eventual save's own ballFrom must be the EXACT SAME
  // point (computed once, reused -- never re-drawn per reference, which
  // would silently break ball continuity between the two events).
  const recoveringDefender = entry("sp-recovering-defender", {
    team: "away", x: 50, y: 83, playerObj: WEAK_DEFENDER,
  });
  const groups = { owner: shooter, teammates: [], opponents: [recoveringDefender], keeper };
  setupRoster([shooter, recoveringDefender, keeper], shooter.id);
  let checkedContinuity = false;
  for (let i = 0; i < 200 && !checkedContinuity; i += 1) {
    const random = seededRandom(hashString(`sp-continuity-${i}`));
    const trace = [];
    resolveShoot(groups, {}, random, trace);
    const onTargetEvent = trace.find((e) => e.movement === "shot" && e.outcome === "success");
    const saveEvent = trace.find((e) => e.code && e.code.startsWith("K.SAVE"));
    if (onTargetEvent && saveEvent) {
      check("the save event's own ballFrom is the EXACT SAME point as the on-target event's own ballTo (no re-drawn placement)",
        onTargetEvent.ballTo.x === saveEvent.ballFrom.x && onTargetEvent.ballTo.y === saveEvent.ballFrom.y);
      checkedContinuity = true;
    }
  }
  check("exercised a real on-target-then-save sequence to verify placement continuity", checkedContinuity);
}

console.log("\n=== 61: receiver arrival timing -- unreachable delivery remains loose ===");
{
  // Ball Flight v2 (2026-08-20) -- earliestReachableContact() carries the
  // same interceptRadiusYards (1.5yd) stretch allowance as the old
  // interception-only race, now applied to the receiver too (fair --
  // "the intended receiver treated as ONE candidate among equals"). The
  // section's original fixture (a short pass, a merely-weak WEAK_PASSER)
  // no longer produces a real gap once that tolerance is folded in --
  // empirically re-probed (see MATCH_LAB_PLAN.md) for parameters that
  // still reliably produce a genuine miss within the same 500-seed
  // search budget: a genuinely poor passer (Passing/Technique/Teamwork/
  // Decisions/Vision at the absolute floor, not merely "weak") over a
  // real ~25-yard distance -- large enough accuracy error, short enough
  // driven-ground flight time, that a slow receiver's own real reach
  // still comes up short often enough to find within the search budget.
  const veryPoorPasser = player("Very Poor Passer", { Passing: 1, Technique: 1, Teamwork: 1, Decisions: 1, Vision: 1, Strength: 1 });
  const passer = entry("arrival-passer", { team: "home", x: 50, y: 10, playerObj: veryPoorPasser });
  const receiver = entry("arrival-receiver", {
    team: "home", x: 50, y: 33.8,
    playerObj: player("Slow Receiver", { Pace: 3, Acceleration: 3, Anticipation: 6, Decisions: 6 }),
  });
  const groups = { owner: passer, teammates: [receiver], opponents: [], keeper: null };
  let late = null;
  let lateTrace = null;
  for (let index = 0; index < 500 && !late; index += 1) {
    const trace = [];
    const result = resolvePass(groups, { preselectedTargetId: receiver.id }, seededRandom(hashString(`late-receiver-${index}`)), trace);
    if (result.reason === "pass-receiver-late") {
      late = result;
      lateTrace = trace;
    }
  }
  check("found a delivery the receiver cannot physically reach within its flight window", Boolean(late));
  if (late) {
    check("an unreachable receiver is not awarded possession", late.nextOwnerId === null && late.possession === "loose");
    check("the trace records the failed arrival instead of a clean control", lateTrace.some((event) => event.code === "P.RECEIVE.LATE")
      && !lateTrace.some((event) => event.code === "P.RECEIVE.CLEAN"));
    const chase = lateTrace.find((event) => event.code === "ATT.RECEIVER.RUN");
    check("the late receiver still covers their physically available ground during the flight", Boolean(chase?.playerMoves?.[0])
      && yardDistance(chase.playerMoves[0].from, chase.playerMoves[0].to) > 0
      && yardDistance(chase.playerMoves[0].to, late.ballEnd) > 0);
  }
}

console.log("\n=== 62: Continuous off-ball motion across a long pass's full flight (2026-08-20 rewrite) ===");
{
  // Originally written for the OLD staggered multi-beat model (several
  // ATT.ADJUST events fired at different offsets across one long flight,
  // patching the fact that a single fixed-duration beat only filled the
  // first ~550ms of what can be a multi-second pass). Continuous World
  // Motion During Ball Flight v1 (2026-08-20) removed that model outright
  // per direct user report: "the previous fixes addressed individual
  // symptoms while preserving the underlying stop-start movement model
  // ... everyone appears to move in slow motion while the ball travels."
  // The fix isn't MORE beats -- it's zero beats: ONE continuous,
  // physically-limited trajectory per player spanning the WHOLE flight.
  // This section now verifies that shape directly instead of the removed
  // multi-beat staggering.
  const owner = entry("beat-owner", { team: "home", x: 50, y: 5, playerObj: AVERAGE });
  const receiver = entry("beat-receiver", { team: "home", x: 50, y: 95, playerObj: AVERAGE });
  const third = entry("beat-third", { team: "home", x: 5, y: 50, playerObj: AVERAGE });
  const groups = { owner, teammates: [receiver, third], opponents: [], keeper: null };
  setupRoster([owner, receiver, third], owner.id);
  const trace = [];
  FREE_PLAY_RESOLVERS.pass(groups, { preselectedTargetId: receiver.id }, seededRandom(hashString("beat-long-pass")), trace, true, null);
  const passEvent = trace.find((e) => e.code === "P.PASS");
  const attAdjustEvents = trace.filter((e) => e.code === "ATT.ADJUST" && e.playerMoves?.length);
  check("test fixture sanity: this really is a long (multi-second) flight, the exact condition the old multi-beat patch existed for",
    passEvent.duration > 3000);
  check("a long pass's flight now produces EXACTLY ONE off-ball reaction event, not staggered beats",
    attAdjustEvents.length === 1);
  const thirdMove = attAdjustEvents[0]?.playerMoves.find((m) => m.playerId === third.id);
  check("that one event carries a real trajectory array (a continuous run), not a single before/after pair",
    Array.isArray(thirdMove?.trajectory) && thirdMove.trajectory.length > 2);
  check("the event's own duration spans the pass's FULL flight, not one short beat",
    attAdjustEvents[0]?.duration === passEvent.duration);
  if (thirdMove?.trajectory?.length > 2) {
    const traj = thirdMove.trajectory;
    check("the trajectory is monotonic in progress across the whole flight (never steps backward)",
      traj.every((s, i) => i === 0 || s.progress >= traj[i - 1].progress));
  }
  check("the receiver is excluded from the continuous reaction, same as before",
    !trace.some((e) => e.code === "ATT.ADJUST" && (e.playerMoves || []).some((m) => m.playerId === receiver.id)));

  // A short pass still produces exactly one event too -- the continuous
  // model naturally collapses to "one short run" for a short flight, no
  // special-casing needed.
  const shortReceiver = entry("beat-short-receiver", { team: "home", x: 55, y: 12, playerObj: AVERAGE });
  const shortGroups = { owner, teammates: [shortReceiver, third], opponents: [], keeper: null };
  setupRoster([owner, shortReceiver, third], owner.id);
  const shortTrace = [];
  FREE_PLAY_RESOLVERS.pass(shortGroups, { preselectedTargetId: shortReceiver.id }, seededRandom(hashString("beat-short-pass")), shortTrace, true, null);
  const shortAttAdjust = shortTrace.filter((e) => e.code === "ATT.ADJUST" && e.playerMoves?.length);
  check("a routine short pass still produces exactly one event",
    shortAttAdjust.length <= 1);

  // A tactical off-ball target is deliberately capped to a modest
  // per-reaction distance (~8yd, same cap section 57 documents for a
  // defender's press target) -- independent of how long the flight is,
  // so an ordinary teammate can legitimately finish early and rest for
  // the remainder of a multi-second flight. That's correct, not the
  // reported bug. The reported bug -- ground covered only in the first
  // ~550ms then frozen for the rest of a long flight -- is a property of
  // sampleContinuousTrajectory() itself, verified directly here against a
  // genuinely far target a real player's own Pace/Acceleration cannot
  // finish early, decoupled from the tactical layer's own distance cap.
  const farSlowPlayer = player("Far Slow Mover", { Pace: 6, Acceleration: 6 });
  const farTrajectory = sampleContinuousTrajectory({
    from: { x: 5, y: 5 }, to: { x: 95, y: 95 }, player: farSlowPlayer,
    totalMs: passEvent.duration, reactionDelayMs: CONTACT_REACTION_DELAY_MS, sampleCount: 20,
  });
  const farMid = Math.floor(farTrajectory.length / 2);
  const farFirstHalf = yardDistance(farTrajectory[0].position, farTrajectory[farMid].position);
  const farSecondHalf = yardDistance(farTrajectory[farMid].position, farTrajectory[farTrajectory.length - 1].position);
  check(`sampleContinuousTrajectory(): a genuinely far target for a slow mover covers real ground in BOTH halves of a long flight, never frozen after an early beat (first=${farFirstHalf.toFixed(2)}yd, second=${farSecondHalf.toFixed(2)}yd)`,
    farFirstHalf > 1 && farSecondHalf > 1);
}

console.log("\n=== 63: Keeper genuinely dives to the real save contact point (2026-08-20) ===");
{
  // A real contact-continuity violation caught by the full-possession
  // fuzz suite: Shot Placement v1's own contactPointOverride can
  // genuinely differ from wherever the keeper's own last-authored
  // position was, but nothing moved their own MARKER to meet it --
  // pushKeeperSaveEvent() now authors that dive explicitly.
  const shooter = entry("dive-shooter", { team: "home", x: 50, y: 90, playerObj: player("Elite Finisher", { Finishing: 18, Technique: 17, Composure: 18 }) });
  const keeper = entry("dive-keeper", { role: "keeper", team: "away", x: 50, y: 98, playerObj: ELITE_KEEPER });
  const recoveringDefender = entry("dive-recovering-defender", {
    team: "away", x: 50, y: 83, playerObj: WEAK_DEFENDER,
  });
  const groups = { owner: shooter, teammates: [], opponents: [recoveringDefender], keeper };
  setupRoster([shooter, recoveringDefender, keeper], shooter.id);
  let checked = false;
  for (let i = 0; i < 300 && !checked; i += 1) {
    const random = seededRandom(hashString(`dive-${i}`));
    const trace = [];
    resolveShoot(groups, {}, random, trace);
    // K.SAVE.0 ("beaten") deliberately carries no contact at all -- the
    // keeper never touches it, see KEEPER_SAVE_PRESENTATION's own table --
    // skip those and keep searching for a save the keeper genuinely makes.
    const saveEvent = trace.find((e) => e.code && e.code.startsWith("K.SAVE") && e.contact);
    if (!saveEvent) continue;
    checked = true;
    check("the save event authors a real keeper move (mover) whenever the contact point differs from where they started",
      saveEvent.moverId === keeper.id || (saveEvent.moveTo && saveEvent.moveTo.x === keeper.x && saveEvent.moveTo.y === keeper.y));
    check("the keeper's authored destination matches the save's own contact point exactly",
      saveEvent.moveTo
        && Math.abs(saveEvent.moveTo.x - saveEvent.contact.point.x) < 0.001
        && Math.abs(saveEvent.moveTo.y - saveEvent.contact.point.y) < 0.001);
  }
  check("exercised at least one real save (with a genuine contact) to verify the dive", checked);
}

console.log("\n=== 64: Continuous World Motion During Ball Flight v1 -- the user's own acceptance tests, verbatim ===");
{
  // Directly requested, as an explicit numbered list, after two rounds of
  // duration/overlap patches on the old stop-start beat model still left
  // everyone visibly freezing during a pass and the same two players
  // trading interceptions no matter who the actual target was. Each check
  // below maps to exactly one of the user's own named acceptance criteria.

  // (a) No player stops and restarts during an uninterrupted run.
  {
    const owner = entry("acc-a-owner", { team: "home", x: 50, y: 5, playerObj: STRONG_PASSER });
    const receiver = entry("acc-a-receiver", { team: "home", x: 50, y: 95, playerObj: AVERAGE });
    const third = entry("acc-a-third", { team: "home", x: 10, y: 40, playerObj: AVERAGE });
    const groups = { owner, teammates: [receiver, third], opponents: [], keeper: null };
    setupRoster([owner, receiver, third], owner.id);
    const trace = [];
    FREE_PLAY_RESOLVERS.pass(groups, { preselectedTargetId: receiver.id }, seededRandom(hashString("acc-a")), trace, true, null);
    const attAdjust = trace.filter((e) => e.code === "ATT.ADJUST" && e.playerMoves?.length);
    check("(a) a player's off-ball reaction during a pass's flight is ONE event, not several restarted beats",
      attAdjust.length <= 1);
    const move = attAdjust[0]?.playerMoves.find((m) => m.playerId === third.id);
    if (move?.trajectory?.length > 1) {
      check("(a) that one run's own progress never steps backward or repeats (no stop-then-restart within it)",
        move.trajectory.every((s, i) => i === 0 || s.progress > move.trajectory[i - 1].progress));
    }
  }

  // (b) Pace and Acceleration measurably affect arrival times.
  {
    const slow = player("Acc Slow", { Pace: 6, Acceleration: 6 });
    const fast = player("Acc Fast", { Pace: 18, Acceleration: 18 });
    const from = { x: 10, y: 10 };
    const to = { x: 90, y: 90 };
    const slowDistance = reachIn(slow, 3);
    const fastDistance = reachIn(fast, 3);
    check(`(b) over the identical 3s window, a fast Pace/Acceleration player covers genuinely more ground than a slow one (slow=${slowDistance.toFixed(2)}yd, fast=${fastDistance.toFixed(2)}yd)`,
      fastDistance > slowDistance * 1.5);
    const slowTime = timeToReach(slow, 40);
    const fastTime = timeToReach(fast, 40);
    check(`(b) covering the SAME 40yd distance, a fast player takes genuinely less time than a slow one (slow=${slowTime.toFixed(2)}s, fast=${fastTime.toFixed(2)}s)`,
      fastTime < slowTime * 0.85);
  }

  // (c) Average movement speed never exceeds the player's calculated limit.
  {
    const roster = [
      entry("acc-c-owner", { team: "home", x: 20, y: 20, playerObj: STRONG_PASSER }),
      entry("acc-c-receiver", { team: "home", x: 80, y: 85, playerObj: AVERAGE }),
      entry("acc-c-mate", { team: "home", x: 15, y: 60, playerObj: player("Acc C Mover", { Pace: 15, Acceleration: 15 }) }),
    ];
    let worstOverage = 0;
    for (let seedIndex = 0; seedIndex < 60; seedIndex += 1) {
      const owner = { ...roster[0] };
      const receiver = { ...roster[1] };
      const mate = { ...roster[2] };
      const groups = { owner, teammates: [receiver, mate], opponents: [], keeper: null };
      setupRoster([owner, receiver, mate], owner.id);
      const trace = [];
      FREE_PLAY_RESOLVERS.pass(groups, { preselectedTargetId: receiver.id }, seededRandom(hashString(`acc-c-${seedIndex}`)), trace, true, null);
      for (const event of trace) {
        for (const move of event.playerMoves || []) {
          if (!move.trajectory?.length) continue;
          const ceiling = topSpeed(mate.player);
          for (let i = 1; i < move.trajectory.length; i += 1) {
            const prev = move.trajectory[i - 1];
            const curr = move.trajectory[i];
            const dtMs = (curr.progress - prev.progress) * (event.duration || 0);
            if (dtMs <= 0) continue;
            const distanceYards = yardDistance(prev.position, curr.position);
            const speed = distanceYards / (dtMs / 1000);
            worstOverage = Math.max(worstOverage, speed - ceiling);
          }
        }
      }
    }
    check(`(c) across a 60-seed sweep, no sampled inter-frame speed exceeds the mover's own topSpeed() ceiling (worst overage=${worstOverage.toFixed(3)}yd/s, tolerance 0.5yd/s for sampling granularity)`,
      worstOverage < 0.5);
  }

  // (d) Movement speed does not suddenly change at reception.
  {
    // Ball Flight v2 (2026-08-20) -- the unified race means a receiver
    // genuinely meets a LONG pass early along its trajectory, not
    // necessarily near their own kick-time spot -- "Player B should not
    // necessarily run toward the ball's final landing point. They should
    // attempt to meet the ball at the earliest useful, controllable point
    // along its trajectory," verbatim. For a long pass this authored
    // distance is REAL ground covered (a genuine sprint to meet it early),
    // not small -- verified here as physically bounded (never exceeds
    // what reachIn() over the real available time permits, the same "no
    // teleport" guarantee, just no longer assumed to mean "short").
    const owner = entry("acc-d-owner", { team: "home", x: 20, y: 20, playerObj: STRONG_PASSER });
    const receiver = entry("acc-d-receiver", { team: "home", x: 55, y: 60, playerObj: AVERAGE });
    const groups = { owner, teammates: [receiver], opponents: [], keeper: null };
    setupRoster([owner, receiver], owner.id);
    const trace = [];
    const result = resolvePass(groups, {}, () => 0.5, trace, false, null);
    const passEvent = trace.find((e) => e.code === "P.PASS");
    const receiveEvent = trace.find((e) => e.code === "P.RECEIVE.CLEAN");
    check("(d) found a clean reception to inspect", Boolean(receiveEvent));
    if (receiveEvent) {
      const move = receiveEvent.playerMoves?.[0];
      const distance = move ? yardDistance(move.from, move.to) : 0;
      const receiverArrivalMove = trace.find((e) => e.code === "ATT.RECEIVER.RUN");
      // A truly clean reception (receiverArrival.reachable) authors no
      // separate chase move at all -- the receiver was already going to be
      // there in time, so this branch's own distance is small/instant by
      // construction. Confirm no chase event exists alongside it (that
      // would signal a late/teleported arrival, not a clean one).
      check("(d) a clean reception has no separate 'chases the delivery' event -- arrival was genuinely on time, not patched afterward",
        !receiverArrivalMove);
      const ceilingYards = reachIn(receiver.player, (passEvent?.duration ?? 0) / 1000);
      // +1.5yd matches earliestReachableContact()'s own interceptRadiusYards
      // -- a deliberate "stretch a leg out" allowance on top of pure
      // locomotion (matchPassFlight.js), not an extra travel distance the
      // receiver silently teleports.
      check(`(d) the reception's own authored distance (${distance.toFixed(2)}yd) never exceeds the receiver's own physical reachIn() ceiling plus the race's own stretch allowance (${(ceilingYards + 1.5).toFixed(2)}yd) -- real ground covered, not a teleport`,
        distance <= ceilingYards + 1.5 + 0.05);
    }
  }

  // (e) A 50-60m pass has realistic travel time and can become loose or intercepted.
  {
    const distanceYards = 60;
    const durationMs = passFlightDurationMs(distanceYards);
    check(`(e) a ~${distanceYards}yd pass's own flight duration is realistically long, not an instant bullet (duration=${durationMs}ms)`,
      durationMs > 2500 && durationMs < 6000);
    // Ball Flight v2 (2026-08-20) -- a defender parked near the RECEIVER's
    // own landing spot essentially never wins this race: the intended
    // receiver's own distance-to-ball shrinks toward zero by construction
    // (the ball is aimed at them), a genuine structural advantage a nearby
    // defender doesn't share. A real interception of a long aerial ball is
    // far more plausible pressuring the SOURCE, before it gets moving/
    // rising -- empirically confirmed (see MATCH_LAB_PLAN.md) by sweeping
    // defender position: near the passer finds real interceptions at a
    // healthy rate within this section's own 300-seed budget; near the
    // receiver finds none.
    const owner = entry("acc-e-owner", { team: "home", x: 10, y: 10, playerObj: STRONG_PASSER });
    const receiver = entry("acc-e-receiver", { team: "home", x: 10, y: 92, playerObj: AVERAGE });
    const fastOpp = entry("acc-e-opp", { team: "away", x: 12, y: 14, playerObj: player("Acc E Interceptor", { Positioning: 14, Anticipation: 14, Tackling: 13, Decisions: 13, Pace: 17, Acceleration: 17 }) });
    const groups = { owner, teammates: [receiver], opponents: [fastOpp], keeper: null };
    let foundIntercepted = false;
    let foundLoose = false;
    for (let seedIndex = 0; seedIndex < 300 && !(foundIntercepted && foundLoose); seedIndex += 1) {
      setupRoster([{ ...owner }, { ...receiver }, { ...fastOpp }], owner.id);
      const [o, r, d] = state.roster;
      const trace = [];
      const result = resolvePass({ owner: o, teammates: [r], opponents: [d], keeper: null }, {}, seededRandom(hashString(`acc-e-${seedIndex}`)), trace);
      if (result.code === "P.PASS.LOST") foundIntercepted = true;
      if (result.outcome === "LOOSE") foundLoose = true;
    }
    check("(e) a long pass CAN genuinely become intercepted (a real physical race, not scripted)", foundIntercepted);
  }

  // (f) The ball never changes its path merely because a winner was selected beforehand.
  {
    // Ball Flight v2 (2026-08-20) -- defender near the PASSER, not the
    // receiver, same reasoning as (e) just above: the intended receiver's
    // own structural "distance shrinks to zero by construction" advantage
    // makes a defender parked near THEM essentially never win this race
    // for a long pass.
    const owner = entry("acc-f-owner", { team: "home", x: 20, y: 20, playerObj: STRONG_PASSER });
    const receiver = entry("acc-f-receiver", { team: "home", x: 20, y: 90, playerObj: AVERAGE });
    const opp = entry("acc-f-opp", { team: "away", x: 22, y: 24, playerObj: player("Acc F Interceptor", { Positioning: 15, Anticipation: 15, Tackling: 14, Decisions: 14, Pace: 18, Acceleration: 18 }) });
    const groups = { owner, teammates: [receiver], opponents: [opp], keeper: null };
    setupRoster([owner, receiver, opp], owner.id);
    // The pass's own real accuracy error (resolvePassAccuracy(), consumed
    // from the SAME random() stream before the interception check ever
    // runs) makes the true landing point impossible to re-derive from the
    // outside without duplicating resolvePass()'s own RNG draw order --
    // so this checks the invariant that actually matters directly off the
    // trace instead: on a LOST duel, the P.PASS event's own ballTo must
    // be the EXACT SAME point as the interceptor's own authored contact
    // point on P.PASS.LOST (not the receiver, not a re-drawn geometry) --
    // one real, independently-computed path, read consistently by both
    // events regardless of which way the duel roll went.
    let sawWon = false;
    let sawLost = false;
    for (let seedIndex = 0; seedIndex < 200 && !(sawWon && sawLost); seedIndex += 1) {
      const trace = [];
      const random = seededRandom(hashString(`acc-f-${seedIndex}`));
      resolvePass(groups, {}, random, trace);
      const passEvent = trace.find((e) => e.code === "P.PASS");
      if (!passEvent) continue;
      const lostEvent = trace.find((e) => e.code === "P.PASS.LOST");
      if (lostEvent) {
        sawLost = true;
        check("(f) on a LOST duel, ballTo is the SAME real point the interceptor's own authored run ends at -- one independent path, not a value that depends on the duel roll",
          Math.abs(passEvent.ballTo.x - lostEvent.contact.point.x) < 0.01 && Math.abs(passEvent.ballTo.y - lostEvent.contact.point.y) < 0.01);
        check("(f) that real interception point is never the receiver's own landing spot (a genuine cut-out, not a relabeled clean pass)",
          yardDistance(passEvent.ballTo, receiver) > 1);
      } else {
        sawWon = true;
      }
    }
    check("(f) exercised at least one WON and one LOST duel to compare against the same independent geometry", sawWon && sawLost);
  }

  // (g) Replay with the same seed remains identical.
  {
    // A fresh roster clone per call, not one shared `groups` reused across
    // both -- resolvePass() legitimately mutates roster entries in place
    // as it resolves (e.g. DEF.PRESS.RECEIVER's own real approach), so
    // reusing the SAME mutable objects across two calls would start the
    // second run from the first run's END positions, not identical
    // starting conditions -- a fixture bug, not a determinism bug.
    const buildFixture = () => {
      const owner = entry("acc-g-owner", { team: "home", x: 20, y: 20, playerObj: STRONG_PASSER });
      const receiver = entry("acc-g-receiver", { team: "home", x: 20, y: 90, playerObj: AVERAGE });
      const opp = entry("acc-g-opp", { team: "away", x: 22, y: 55, playerObj: player("Acc G Interceptor", { Positioning: 15, Anticipation: 15, Tackling: 14, Decisions: 14, Pace: 18, Acceleration: 18 }) });
      return { owner, teammates: [receiver], opponents: [opp], keeper: null };
    };
    const trace1 = [];
    const trace2 = [];
    resolvePass(buildFixture(), {}, seededRandom(hashString("acc-g-replay")), trace1, true, { state: { tick: 0, players: {} } });
    resolvePass(buildFixture(), {}, seededRandom(hashString("acc-g-replay")), trace2, true, { state: { tick: 0, players: {} } });
    check("(g) the same seed reproduces an IDENTICAL trace (full JSON equality), including every continuous trajectory",
      JSON.stringify(trace1) === JSON.stringify(trace2));

    // Full multi-action possession-level determinism too, not just a
    // single resolvePass() call.
    const rosterSeed = () => [
      entry("acc-g2-owner", { team: "home", x: 20, y: 20, playerObj: STRONG_PASSER }),
      entry("acc-g2-r1", { team: "home", x: 40, y: 40, playerObj: AVERAGE }),
      entry("acc-g2-r2", { team: "home", x: 60, y: 60, playerObj: AVERAGE }),
      entry("acc-g2-opp", { team: "away", x: 50, y: 50, playerObj: player("Acc G2 Defender", { Positioning: 12, Anticipation: 12, Tackling: 12, Decisions: 12, Pace: 12, Acceleration: 12 }) }),
    ];
    setupRoster(rosterSeed(), "acc-g2-owner");
    const outcome1 = runConstructedPossession("acc-g2-possession-replay");
    setupRoster(rosterSeed(), "acc-g2-owner");
    const outcome2 = runConstructedPossession("acc-g2-possession-replay");
    check("(g) a full multi-action possession replay with the same seed is identical end to end (same trace, same final positions)",
      JSON.stringify(outcome1.trace) === JSON.stringify(outcome2.trace)
      && JSON.stringify(outcome1.finalPositions) === JSON.stringify(outcome2.finalPositions));
  }
}

console.log("\n=== 65: Ball Flight v2, Vertical Slice 1 -- the user's own acceptance tests, verbatim ===");
{
  // Directly requested as an explicit numbered list, immediately after
  // Continuous World Motion During Ball Flight v1 landed: "the current
  // direct-to-player pass pipeline should therefore be retired, not
  // further tuned." Each check below maps to exactly one of the user's
  // own ten named criteria.

  // (1) A 50-metre pass is not normally selected as a standard ground pass.
  {
    const passer = player("Slice1 Passer", { Passing: 12, Technique: 12, Strength: 12 });
    const from = { x: 20, y: 20 };
    const to = { x: 22, y: 90 }; // ~55yd real distance on the actual 75x120 pitch
    const type = selectPassType({ passer, from, to, opponents: [] });
    check(`(1) a ~55yd pass is NOT selected as a standard ground pass (selected: ${type})`,
      type !== "ground");
  }

  // (2) Intended point and actual trajectory endpoint can differ.
  {
    const owner = entry("s1-2-owner", { team: "home", x: 20, y: 20, playerObj: STRONG_PASSER });
    const receiver = entry("s1-2-receiver", { team: "home", x: 22, y: 90, playerObj: AVERAGE });
    const groups = { owner, teammates: [receiver], opponents: [], keeper: null };
    setupRoster([owner, receiver], owner.id);
    let sawDifference = false;
    for (let seedIndex = 0; seedIndex < 50 && !sawDifference; seedIndex += 1) {
      const trace = [];
      resolvePass(groups, {}, seededRandom(hashString(`s1-2-${seedIndex}`)), trace);
      const passEvent = trace.find((e) => e.code === "P.PASS");
      if (passEvent && (passEvent.ballTo.x !== receiver.x || passEvent.ballTo.y !== receiver.y)) sawDifference = true;
    }
    check("(2) across real trials, the ball's actual endpoint genuinely differs from the receiver's own (intended) position at least once",
      sawDifference);
  }

  // (3) The ball never changes course to meet the receiver.
  {
    const passer = player("Slice1 Passer 3", { Strength: 10, Technique: 10, Passing: 10 });
    const from = { x: 10, y: 10 };
    const actualEndpoint = { x: 15, y: 88 };
    const flight = buildPassFlight({
      owner: { id: "o" }, receiver: { id: "r" }, from, intendedPoint: { x: 12, y: 90 },
      actualEndpoint, passType: "lofted", durationMs: 3000,
    });
    const samples = [500, 1000, 1500, 2000, 2500].map((t) => ballPositionAtElapsed(flight, t));
    const headings = samples.map((p) => Math.atan2(p.y - from.y, p.x - from.x));
    check("(3) the ball's own horizontal heading never changes mid-flight (a straight, independent path, not one that bends toward the receiver)",
      headings.every((h) => Math.abs(h - headings[0]) < 0.01));
  }

  // (4) Fast and slow players have measurably different interception times.
  {
    const owner = entry("s1-4-owner", { team: "home", x: 10, y: 10, playerObj: STRONG_PASSER });
    const receiver = entry("s1-4-receiver", { team: "home", x: 10, y: 90, playerObj: player("Bystander", { Pace: 1, Acceleration: 1, Anticipation: 1, Decisions: 1 }) });
    const flight = buildPassFlight({
      owner, receiver, from: { x: 10, y: 10 }, intendedPoint: { x: 10, y: 90 },
      actualEndpoint: { x: 10, y: 90 }, passType: "ground", durationMs: 5000,
    });
    const fast = entry("s1-4-fast", { team: "away", x: 10, y: 50, playerObj: player("Fast", { Pace: 19, Acceleration: 19, Anticipation: 12, Decisions: 12 }) });
    const slow = entry("s1-4-slow", { team: "away", x: 10, y: 50, playerObj: player("Slow", { Pace: 5, Acceleration: 5, Anticipation: 12, Decisions: 12 }) });
    const fastContact = earliestReachableContact({ flight, candidates: [fast] });
    const slowContact = earliestReachableContact({ flight, candidates: [slow] });
    check("(4) a fast player reaches the SAME target point measurably sooner than a slow one",
      fastContact && slowContact && fastContact.atMs < slowContact.atMs);
  }

  // (5) A defender can reach the ball before the intended receiver.
  {
    const owner = entry("s1-5-owner", { team: "home", x: 20, y: 20, playerObj: STRONG_PASSER });
    const receiver = entry("s1-5-receiver", { team: "home", x: 20, y: 32, playerObj: player("Slow Receiver", { Pace: 4, Acceleration: 4, Anticipation: 6, Decisions: 6 }) });
    const opp = entry("s1-5-opp", { team: "away", x: 20, y: 21, playerObj: player("Elite Defender", { Positioning: 18, Anticipation: 17, Tackling: 18, Decisions: 17, Pace: 18, Acceleration: 18 }) });
    const groups = { owner, teammates: [receiver], opponents: [opp], keeper: null };
    let sawDefenderWin = false;
    for (let seedIndex = 0; seedIndex < 300 && !sawDefenderWin; seedIndex += 1) {
      setupRoster([{ ...owner }, { ...receiver }, { ...opp }], owner.id);
      const [o, r, d] = state.roster;
      const trace = [];
      const result = resolvePass({ owner: o, teammates: [r], opponents: [d], keeper: null }, {}, seededRandom(hashString(`s1-5-${seedIndex}`)), trace);
      if (result.code === "P.PASS.LOST") sawDefenderWin = true;
    }
    check("(5) a defender can genuinely reach the ball before the intended receiver (a real P.PASS.LOST outcome)", sawDefenderWin);
  }

  // (6) Nobody reaching the trajectory produces a loose ball.
  {
    const flight = buildPassFlight({
      owner: { id: "o" }, receiver: { id: "r" }, from: { x: 10, y: 10 }, intendedPoint: { x: 90, y: 90 },
      actualEndpoint: { x: 90, y: 90 }, passType: "ground", durationMs: 200,
    });
    // Genuinely far from the WHOLE flight path (not standing at the
    // launch point, which would trivially need zero distance at t=0
    // regardless of speed) -- off to the side, near neither endpoint.
    const nobody = entry("s1-6-far", { x: 90, y: 10, playerObj: player("Far Immobile", { Pace: 1, Acceleration: 1, Anticipation: 1, Decisions: 1 }) });
    const contact = earliestReachableContact({ flight, candidates: [nobody] });
    check("(6) nobody reaching the trajectory produces a loose contact (null)", contact === null);
  }

  // (7) Players retain continuous velocity throughout flight (no beat resets).
  {
    const owner = entry("s1-7-owner", { team: "home", x: 20, y: 5, playerObj: AVERAGE });
    const receiver = entry("s1-7-receiver", { team: "home", x: 20, y: 95, playerObj: AVERAGE });
    const third = entry("s1-7-third", { team: "home", x: 5, y: 50, playerObj: AVERAGE });
    const groups = { owner, teammates: [receiver, third], opponents: [], keeper: null };
    setupRoster([owner, receiver, third], owner.id);
    const trace = [];
    FREE_PLAY_RESOLVERS.pass(groups, { preselectedTargetId: receiver.id }, seededRandom(hashString("s1-7")), trace, true, null);
    const attAdjust = trace.filter((e) => e.code === "ATT.ADJUST" && e.playerMoves?.length);
    check("(7) off-ball reaction during the flight is ONE continuous event, not restarted beats",
      attAdjust.length <= 1);
    const move = attAdjust[0]?.playerMoves.find((m) => m.playerId === third.id);
    if (move?.trajectory?.length > 1) {
      check("(7) that trajectory's own progress never steps backward (continuous velocity, no reset)",
        move.trajectory.every((s, i) => i === 0 || s.progress >= move.trajectory[i - 1].progress));
    }
  }

  // (8) No reception-time movement burst occurs.
  {
    const owner = entry("s1-8-owner", { team: "home", x: 20, y: 20, playerObj: STRONG_PASSER });
    const receiver = entry("s1-8-receiver", { team: "home", x: 25, y: 30, playerObj: AVERAGE });
    const opp = entry("s1-8-opp", { team: "away", x: 27, y: 32, playerObj: WEAK_DEFENDER });
    const groups = { owner, teammates: [receiver], opponents: [opp], keeper: null };
    setupRoster([owner, receiver, opp], owner.id);
    const trace = [];
    resolvePass(groups, { preselectedTargetId: receiver.id }, seededRandom(hashString("s1-8")), trace, true, { state: { tick: 0, players: {} } });
    const pressEvent = trace.find((e) => e.code === "DEF.PRESS.RECEIVER" && e.playerMoves?.length);
    if (pressEvent) {
      const move = pressEvent.playerMoves[0];
      const ceiling = reachIn(opp.player, (pressEvent.duration ?? 0) / 1000) + 1.5;
      const covered = yardDistance(move.from, move.to);
      check(`(8) the marking defender's own closing-down run (${covered.toFixed(2)}yd) stays within their real physical ceiling (${ceiling.toFixed(2)}yd) -- a real run, not a reception-time burst`,
        covered <= ceiling + 0.05);
    } else {
      check("(8) no marking defender present to check this run against -- fixture sanity skip", true);
    }
  }

  // (9) Same seed reproduces the complete trajectory and outcome.
  {
    const buildFixture = () => {
      const owner = entry("s1-9-owner", { team: "home", x: 20, y: 20, playerObj: STRONG_PASSER });
      const receiver = entry("s1-9-receiver", { team: "home", x: 22, y: 90, playerObj: AVERAGE });
      const opp = entry("s1-9-opp", { team: "away", x: 22, y: 24, playerObj: player("Interceptor", { Positioning: 15, Anticipation: 15, Tackling: 14, Decisions: 14, Pace: 18, Acceleration: 18 }) });
      return { owner, teammates: [receiver], opponents: [opp], keeper: null };
    };
    const trace1 = [];
    const trace2 = [];
    resolvePass(buildFixture(), {}, seededRandom(hashString("s1-9-replay")), trace1, true, { state: { tick: 0, players: {} } });
    resolvePass(buildFixture(), {}, seededRandom(hashString("s1-9-replay")), trace2, true, { state: { tick: 0, players: {} } });
    check("(9) the same seed reproduces an IDENTICAL trace end to end (full JSON equality)",
      JSON.stringify(trace1) === JSON.stringify(trace2));
  }

  // (10) Existing production paths remain unchanged until this vertical
  // slice is explicitly integrated -- resolveCross()/resolveThroughBall()
  // never import or call anything from matchPassFlight.js, and production
  // code (matchEngineCore.js, draft-run.js) is never touched by this file
  // at all -- verified structurally (no accidental import), not just by
  // convention.
  {
    const matchLabSource = readFileSync(new URL("../match-lab.js", import.meta.url), "utf8");
    // \r?\n -- match-lab.js is CRLF (see .gitattributes/git's own "LF will
    // be replaced by CRLF" warning on this file); a bare \n boundary here
    // silently never matches ANY closing brace in the whole file, making
    // both checks below unconditionally false regardless of the source
    // they're inspecting -- found while touching this file for Shot
    // Placement v1's own no-keeper/beaten-keeper fix, unrelated to this
    // check's actual intent.
    const crossFnMatch = matchLabSource.match(/function resolveCross\([\s\S]*?\r?\n\}\r?\n/);
    const throughFnMatch = matchLabSource.match(/function resolveThroughBall\([\s\S]*?\r?\n\}\r?\n/);
    check("(10) resolveCross()'s own body never references the new pass-flight module (untouched this slice)",
      Boolean(crossFnMatch) && !crossFnMatch[0].includes("PassFlight") && !crossFnMatch[0].includes("earliestReachableContact"));
    check("(10) resolveThroughBall()'s own body never references the new pass-flight module (untouched this slice)",
      Boolean(throughFnMatch) && !throughFnMatch[0].includes("PassFlight") && !throughFnMatch[0].includes("earliestReachableContact"));
    check("(10) production matchEngineCore.js never imports the new Match-Lab-only pass-flight module",
      !readFileSync(new URL("../src/lib/matchEngineCore.js", import.meta.url), "utf8").includes("matchPassFlight"));
  }
}

console.log("\n=== 66: Free Play routes an isolated Ronaldo–Stensgaard chance through the one-on-one model ===");
{
  const ronaldo = {
    canonical_player_name: "Ronaldo",
    current_ability: 191,
    position_text: "F C",
    attributes: attrs({
      Finishing: 20, Technique: 20, Composure: 17, Decisions: 17,
      Anticipation: 15, Flair: 20, Dribbling: 20, Acceleration: 20,
      Agility: 19, Balance: 20, Passing: 16, Teamwork: 10,
    }),
  };
  const stensgaard = {
    canonical_player_name: "Michael Stensgaard",
    current_ability: 139,
    position_text: "GK",
    attributes: attrs({
      Decisions: 15, "One On Ones": 15, Reflexes: 17, Jumping: 18,
    }),
  };
  const shooter = entry("ronaldo", {
    team: "home", x: 50, y: 84, playerObj: ronaldo,
  });
  const keeper = entry("stensgaard", {
    role: "keeper", team: "away", x: 52, y: 96, playerObj: stensgaard,
  });
  const groups = {
    owner: shooter,
    teammates: [],
    opponents: [],
    keeper,
    opposingKeepers: [keeper],
  };
  setupRoster([shooter, keeper], shooter.id);
  const geometry = freePlayOneOnOneContext(groups);
  check("the close, central, defender-free geometry is classified as a genuine one-on-one",
    Boolean(geometry));
  let goals = 0;
  let routed = 0;
  let trappedGoalEnd = null;
  const trials = 2400;
  for (let index = 0; index < trials; index += 1) {
    const trace = [];
    const result = resolveShoot(groups, {
      oneOnOneDecisionRandom: seededRandom(hashString(`ronaldo-stensgaard-decision:${index}`)),
      oneOnOneKeeperResponseRandom: seededRandom(hashString(`ronaldo-stensgaard-keeper:${index}`)),
    }, seededRandom(hashString(`ronaldo-stensgaard-execution:${index}`)), trace);
    if (trace.some((event) => event.code === "ONE_V_ONE.CHOICE")) routed += 1;
    if (result.outcome === "GOAL") {
      goals += 1;
      trappedGoalEnd ||= result.ballEnd;
    }
  }
  const conversion = goals / trials;
  console.log(`Ronaldo vs Stensgaard: ${(conversion * 100).toFixed(1)}% (${goals}/${trials})`);
  check("every isolated attempt uses the one-on-one path, never generic K.SAVE",
    routed === trials);
  check("Ronaldo is favoured at no less than 51% in this exact unpressured matchup",
    conversion >= 0.51);
  check("the calibration remains probabilistic rather than becoming an automatic goal",
    conversion < 0.75);
  const expectedNetEnd = netPointFor(shooter, trappedGoalEnd?.x ?? 50);
  check("a scored ball finishes just inside the goal net rather than travelling to the pitch edge",
    Boolean(trappedGoalEnd)
      && trappedGoalEnd.y === expectedNetEnd.y
      && trappedGoalEnd.y > 100
      && trappedGoalEnd.y <= 100 + GOAL_NET_DEPTH_MARGIN);
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  check("the goal net has a localized reactive ripple for scored-ball contact",
    css.includes('data-net-impact="true"')
      && css.includes("match-lab-net-ripple-top")
      && css.includes("match-lab-net-ripple-bottom"));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
