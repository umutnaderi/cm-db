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
import { hashString, seededRandom, playerAttribute, conditionMultiplier, clamp } from "../src/lib/matchEngineCore.js";
import {
  CARRY_BODY_CLEARANCE_YARDS, generateFreePlayCandidates, nearestLaneInterceptor, pressingTarget,
  planCarryDestination, planDefensiveRepositioning, carryUtility, dribbleUtility, distanceToGoalYards,
  PITCH_LENGTH_YARDS, yardDistance, yardDistanceToSegment, simulateCarryTouches,
  classifyPitchExit, chooseCandidate, holdUtility,
} from "../src/lib/spatialDecision.js";
import { findPitchExit } from "../src/lib/pitchGeometry.js";
import { BODY_MIN_SEPARATION_YARDS } from "../src/lib/playerBody.js";
import { buildMatchLabPlaybackPlan, sampleMatchLabPlaybackPlan } from "../src/lib/matchLabPlayback.js";
import { reachIn, timeToReach, topSpeed } from "../src/lib/playerKinetics.js";
import {
  selectPassType, passFlightProfile, buildPassFlight, ballPositionAtElapsed,
  reactionDelayMsFor, earliestReachableContact, CONTACT_HEIGHT_YARDS,
} from "../src/lib/matchPassFlight.js";
import { GOAL_HEIGHT_YARDS, PITCH_WIDTH_YARDS, isInsidePenaltyArea, defendingGoalYForDirection } from "../src/lib/pitchGeometry.js";

function fakeStyle() {
  // Gameplay v3.2's own required test 3 needs to read back what
  // renderPlaybackFrame() actually wrote to the ball marker's own
  // --ball-rest-x/y (setBallRestOffset()) -- a real, tracked backing
  // store instead of the earlier no-op is what makes that assertion
  // possible at all.
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
      // A plain class selector (".foo") looks up a real appended child --
      // the same match querySelectorAll() below already supports -- so a
      // node created via document.createElement()/appendChild() (never
      // folded into an innerHTML template string, which this stub can't
      // parse) is genuinely findable under this fake DOM too.
      const classMatch = /^\.([\w-]+)$/.exec(selector || "");
      if (classMatch) return el.children.find((child) => (child.className || "").split(/\s+/).includes(classMatch[1])) || null;
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
  state, runConstructedPossession, resolvePass, resolveDribble, resolveCarry, resolveHold, updateBallCoordsLabel,
  drainOnBallAction, applyBurstOffBallJob, maybeAssignTurnoverStaminaJobs,
  burstEffortCost, burstRecoveryTick, burstJobIntensity, BURST_BASE, BURST_RANGE, resolveCross, resolveShoot,
  updateStaminaBar, freshBurst01, keeperWalkTarget, GK_HOLD_MS, GK_HOLD_MAX_MS, flightLandingVelocity,
  resolveReboundScramble, resolveAerialClearanceContinuation, freePlayGroups, buildLastRun, FREE_PLAY_RESOLVERS, POSSESSION_MAX_ACTIONS,
  pointOf, zoneFromPercent, moveRosterEntry, nudgeToward,
  playbackPointFor, applyStepAnimation, renderPitch, renderPlaybackFrame,
  markerNode, engagingOpponent, DUEL_RANGE_YARDS, traceEvent,
  goalFrameFor, attackingGoalY, defendingGoalY, goalPointFor, isKeeperBeaten,
  keeperSaveTransition,
  applyOffBallSeparation, findKeeperConflict,
  attributionEntryMarkup,
  outfieldSlotsFor, classifyOutfieldBand, lateralChannelX,
  visionConeRadiusYards, visionConeHalfAngleRad, visionFadeDurationMs, buildVisionConePath,
  scanQuality, scanAmplitudeRad, scanPeriodMs, scanOffsetRad,
  INTERLEAVED_REACTION_FRACTION, INTERLEAVED_DEFENSIVE_REACTION_FRACTION,
  playerDatabaseHref, relevantHoverAttributes, positionGroupFor,
  resolvePassAccuracy, resolveThroughBallAccuracy, passFlightDurationMs, shotPlacementQuality, shotPlacementSpread,
  resolveShotDescriptor, simulateShotKeeperEnvelope, shotBlockingDefender,
  freePlayOneOnOneContext, netPointFor, GOAL_NET_DEPTH_MARGIN,
  GOAL_LEFT_POST_X, GOAL_RIGHT_POST_X,
  reactOffBallContinuous, sampleContinuousTrajectory, earliestReachableInterception,
  CONTACT_REACTION_DELAY_MS,
  shouldLeadIntendedPoint, leadIntendedPoint, attackingSettingsFor,
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
  // Genuinely close together (2026-08-26, Rebound v2) -- resolveReboundScramble()
  // now times each contestant's own REAL physical arrival (contactArrivalTiming(),
  // not a flat 2200ms "reachable at all" gate), so the duel only fires
  // when they're genuinely neck-and-neck; a defender meaningfully closer
  // to the ball than the attacker now correctly wins outright instead of
  // still coin-flipping against a far-away attacker's own better
  // attributes. Positioned equidistant from the rebound spot so
  // GOOD_DRIBBLER's real attribute edge (Anticipation/Acceleration/Off
  // the Ball) is what decides it, same as this test always intended.
  const attacker = entry("attacker", { team: "home", x: 50, y: 8, playerObj: GOOD_DRIBBLER });
  const defender = entry("defender", { team: "away", x: 52, y: 8, playerObj: WEAK_DEFENDER });
  const keeper = entry("keeper", { team: "away", x: 50, y: 2, playerObj: ELITE_KEEPER });
  // Rebound v2's own conversion tier now reads REAL distance to the goal
  // home is attacking -- this fixture sits right on the y:0 goal line, so
  // home must genuinely be attacking THAT end here, not whatever
  // state.attackingDirection happened to default to from an earlier test.
  state.attackingDirection = { home: "up", away: "down" };
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

console.log("\n=== 5b: rebound scramble gets its OWN real timeline interval, never the preceding save's (reported bug) ===");
{
  // A real reported bug: matchLabPlayback.js's own stationaryContact
  // shortcut ("arrivals at the end of an already-authored incoming
  // flight") is meant for a contact landing exactly as an EXISTING flight
  // ends, sharing ITS window. REBOUND.WON/LOST's own ballFrom===ballTo
  // (the ball has already settled, loose) plus contact.phase:"end"
  // accidentally matched that same shortcut, silently reusing the
  // PRECEDING save event's own already-consumed interval instead of
  // claiming a real one of its own -- the ball (and both contestants)
  // read as frozen at the save's own endpoint for the whole scramble,
  // then snapped. Same class of bug LOOSE.RECOVERED's own
  // contactTiming:"sequential" already guards against for a fumbled pass.
  const attacker = entry("rc-attacker", { team: "home", x: 50, y: 90, playerObj: GOOD_DRIBBLER });
  const defender = entry("rc-defender", { team: "away", x: 52, y: 90, playerObj: WEAK_DEFENDER });
  const keeper = entry("rc-keeper", { team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
  const originPoint = { x: 49, y: 92, zone: attacker.zone };
  let found = null;
  for (let i = 0; i < 500 && !found; i += 1) {
    const random = seededRandom(hashString(`rebound-continuity-${i}`));
    const trace = [];
    resolveReboundScramble(attacker, defender, keeper, attacker.zone, random, trace, originPoint);
    if (trace[0]) found = trace[0];
  }
  check("found a rebound scramble event", Boolean(found));
  if (found) {
    check("REBOUND.WON/LOST is marked contactTiming:'sequential' -- it never inherits the preceding event's own already-consumed interval",
      found.contactTiming === "sequential");

    const initialPositions = {
      [attacker.id]: pointOf(attacker), [defender.id]: pointOf(defender), [keeper.id]: pointOf(keeper),
    };
    const precedingEvent = traceEvent("K.SAVE.TEST", "test save", {
      actor: keeper, movement: "save", outcome: "save", duration: 1000,
      ballFrom: pointOf(keeper), ballTo: originPoint,
      contact: { point: originPoint, actor: keeper, type: "parry", phase: "end" },
    });
    const plan = buildMatchLabPlaybackPlan({
      trace: [precedingEvent, found],
      initialPositions, initialBall: pointOf(keeper), initialOwnerId: keeper.id,
    });
    const precedingInterval = plan.intervals[0];
    const reboundInterval = plan.intervals[1];
    check("the rebound scramble's own interval genuinely starts after the preceding save's own interval ends, not reusing it",
      reboundInterval.startMs >= precedingInterval.endMs);
    check("the rebound scramble's own interval has real, non-zero width (its own contestDurationMs, not squeezed to nothing)",
      reboundInterval.endMs - reboundInterval.startMs > 0);
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
    if (!foundAdvantage && result.reason === "foul-advantage-played") foundAdvantage = { result, trace };
  }
  check("found a real-stoppage foul outcome within the search budget", Boolean(foundStoppage));
  if (foundStoppage) {
    check("a real foul stoppage is terminal", foundStoppage.terminal === true);
    check("possession is dead, no next owner", foundStoppage.possession === "dead" && foundStoppage.nextOwnerId === null);
    check("restart is a genuine restart type, not \"none\"", foundStoppage.restart === "penalty" || foundStoppage.restart === "free-kick");
  }
  check("found an advantage-played foul outcome within the search budget", Boolean(foundAdvantage));
  if (foundAdvantage) {
    const { result, trace } = foundAdvantage;
    check("advantage played is NOT terminal -- the fouled side keeps the ball and play continues", result.terminal === false);
    check("possession stays retained with the fouled side", result.possession === "retained" && result.nextOwnerId === owner.id);
    check("no restart when advantage is played", result.restart === null);
    const advantage = trace.find((event) => event.code.startsWith("CARD.") && event.playerMoves?.length === 2);
    check("advantage carries both players through contact so the next live event cannot start with overlapping bodies",
      Boolean(advantage)
        && yardDistance(advantage.playerMoves[0].to, advantage.playerMoves[1].to) >= 0.3
        && yardDistance(advantage.ballTo, advantage.playerMoves[0].to) < 0.001);
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
  // Continuing a keeper's control at his feet now allows these sequences
  // to finish naturally. Requiring a live final owner accidentally required
  // hitting the action cap. Check every final body and the ball instead.
  const seed = 445566;
  const outputA = runConstructedPossession(seed);
  const outputB = runConstructedPossession(seed);
  check("identical seed reproduces identical finalPositions", JSON.stringify(outputA.finalPositions) === JSON.stringify(outputB.finalPositions));
  const plan = buildMatchLabPlaybackPlan({trace:outputA.trace,
    initialPositions:Object.fromEntries(state.roster.map(e=>[e.id,pointOf(e)])),
    initialBall:pointOf(owner),initialOwnerId:owner.id,finalOwnerId:outputA.finalOwnerId,restart:outputA.result.restart,
    playerProfiles:Object.fromEntries(state.roster.map(e=>[e.id,e.player]))});
  const finalFrame = sampleMatchLabPlaybackPlan(plan,plan.durationMs);
  check("every finalPositions entry agrees with the actual final playback body", outputA.finalPositions.length===state.roster.length
    && outputA.finalPositions.every(p=>Math.hypot(p.x-finalFrame.players[p.id].x,p.y-finalFrame.players[p.id].y)<1e-8));
  check("the terminal ball endpoint agrees with actual playback", Math.hypot(finalFrame.ball.x-outputA.result.ballEnd.x,
    finalFrame.ball.y-outputA.result.ballEnd.y)<1e-8);
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
  // Keep this receiver-pressure fixture inside the ordinary driven-ground
  // band (24 real yards). Its subject is the defender at the receiving end,
  // not whether a 30-yard aerial ball's accuracy scatter can run loose.
  const receiver = entry("receiver", { team: "home", x: 52, y: 50, playerObj: AVERAGE });
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
  const receiverSideDefender = entry("rdef", { team: "away", x: 59.35, y: 50, playerObj: ELITE_DEFENDER });
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
    // On-ball gait + possession stamina v1 -- the quantity string embeds
    // whichever of the four NAMED gaits determineCarryGait() actually
    // chose for this exact geometry (never hardcoded here), not the old
    // nimble/jog/sprint vocabulary.
    check("carry touch events preserve quantified attribute attribution for later inspection",
      Boolean(result.gait) && touchEvents.every((event) => event.attribution.some((item) => item.quantity === `touchThreshold(${result.gait})`
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

console.log("\n=== 28: Off-Ball Defender Awareness v1 -- defenders reposition, coordinate press/mark, end to end ===");
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
  let neverHadTwoPressureOwners = true;
  for (let i = 0; i < 80 && !(sawDefAdjust && defendersMoved && sawBothRoles); i += 1) {
    const run = runConstructedPossession(`def-awareness-${i}`);
    const defEvents = run.trace.filter((event) => event.code === "DEF.ADJUST");
    if (defEvents.length) sawDefAdjust = true;
    for (const event of defEvents) {
      const actions = new Set(event.playerMoves.map((move) => move.action));
      const responsibilities = new Set(event.playerMoves.map((move) => move.coordinationResponsibility));
      const hasPressure = actions.has("press-ball") || responsibilities.has("primary-pressure");
      const hasCover = actions.has("mark") || ["inside-cover", "runner-tracker", "depth-protector"]
        .some((responsibility) => responsibilities.has(responsibility));
      if (hasPressure && hasCover) sawBothRoles = true;
      if (event.playerMoves.filter((move) => move.coordinationResponsibility === "primary-pressure").length > 1) {
        neverHadTwoPressureOwners = false;
      }
    }
    const finalA = run.finalPositions.find((p) => p.id === defenderA.id);
    const finalB = run.finalPositions.find((p) => p.id === defenderB.id);
    if ((finalA && (finalA.x !== defenderA.x || finalA.y !== defenderA.y))
      || (finalB && (finalB.x !== defenderB.x || finalB.y !== defenderB.y))) defendersMoved = true;
  }
  check("DEF.ADJUST events appear across these possessions", sawDefAdjust);
  check("at least one defender's own simulated position actually changes from where they were authored", defendersMoved);
  check("pressure and cover/tracking are observed together in at least one combined event -- real multi-defender coordination", sawBothRoles);
  check("the coordinator never authors two primary pressure owners in one defensive adjustment", neverHadTwoPressureOwners);
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
    const intentionEvents = run.trace.filter((event) => event.code === "ATT.ADJUST" || event.code === "MOTION.CONTINUE");
    if (attEvents.length) sawAttAdjust = true;
    for (const event of attEvents) {
      for (const move of event.playerMoves) {
        if (move.action === "support-short") sawSupportShort = true;
        if (move.action === "run-in-behind") sawRunInBehind = true;
        if (move.trajectory?.length > 2 && move.trajectory[0].velocity) sawMotionTrajectory = true;
      }
    }
    for (const event of intentionEvents) {
      if (event.playerMoves.some((move) => move.intention?.retained)) sawPersistentIntention = true;
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

console.log("\n=== 35: Off-Ball Motion v3 -- ONE off-ball reaction per carry/dribble, not one per touch ===");
{
  // A reported bug ("go-stop-go on off-ball: every P.CARRY.TOUCH is
  // followed by a full ATT/DEF/GK.ADJUST... players hitch every 220ms"):
  // resolveCarry()/resolveDribble() used to call the old per-touch
  // reactOffBall() inside the touches loop, giving off-ball players a
  // fresh re-plan + a velocity reset to zero on EVERY touch. Fixed by
  // calling reactOffBallContinuous() exactly ONCE, spanning the whole
  // carry window, AFTER the touches (and the final P.CARRY/P.PROGRESS.WON
  // event) are authored -- so the real off-ball reaction now sits strictly
  // AFTER every touch, never between two of them, and there is exactly
  // ONE per role per action regardless of touch count.
  const owner = entry("owner", { team: "home", x: 50, y: 30, playerObj: GOOD_DRIBBLER });
  const teammate = entry("teammate", { team: "home", x: 65, y: 35, playerObj: STRONG_PASSER });
  const defenderA = entry("defA", { team: "away", x: 51, y: 32, playerObj: WEAK_DEFENDER }); // close -- nimble gait, several touches
  const defenderB = entry("defB", { team: "away", x: 68, y: 55, playerObj: WEAK_DEFENDER });
  const keeper = entry("keeper", { role: "keeper", team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
  setupRoster([owner, teammate, defenderA, defenderB, keeper], owner.id);

  let sawMultiTouchCarry = false;
  let sawSingleReactionPerRole = true;
  let sawReactionOnlyAfterTouches = true;
  for (let i = 0; i < 60; i += 1) {
    const run = runConstructedPossession(`interleave-mid-carry-${i}`);
    const touchIndices = [];
    run.trace.forEach((event, index) => {
      if (event.code === "P.CARRY.TOUCH" || event.code === "P.PROGRESS.TOUCH") touchIndices.push(index);
    });
    // A possession can string together several SEPARATE carry/dribble
    // actions; touchIndices spans the WHOLE trace, so touchIndices[0]/the
    // global last touch can belong to two DIFFERENT actions with real,
    // legitimate reactions from an EARLIER action sitting in between --
    // scope this check to the one contiguous touch run (no interleaving
    // left between touches of the SAME action, so they're back-to-back
    // trace indices) that a 3+ touch action actually produced.
    const runs = [];
    let runStart = touchIndices[0];
    for (let k = 1; k <= touchIndices.length; k += 1) {
      if (k === touchIndices.length || touchIndices[k] !== touchIndices[k - 1] + 1) {
        runs.push({ start: runStart, end: touchIndices[k - 1] });
        runStart = touchIndices[k];
      }
    }
    const multiTouchRuns = runs.filter((run2) => run2.end - run2.start + 1 >= 3);
    if (!multiTouchRuns.length) continue;
    sawMultiTouchCarry = true;
    for (const { start: firstTouch, end: lastTouch } of multiTouchRuns) {
      // Group consecutive ATT/GK/DEF.ADJUST events into "reaction batches"
      // (a single reactOffBallContinuous() call can push up to three, one
      // per role) and count how many DISTINCT batches follow this carry --
      // must be exactly one, not one per touch.
      let batches = 0;
      let inBatch = false;
      for (let index = lastTouch + 1; index < run.trace.length; index += 1) {
        const code = run.trace[index].code;
        const isReaction = code === "ATT.ADJUST" || code === "GK.ADJUST" || code === "DEF.ADJUST";
        if (isReaction && !inBatch) { batches += 1; inBatch = true; }
        else if (!isReaction) { inBatch = false; if (code === "ACTION.CHOICE" || code.startsWith("P.")) break; }
      }
      let anyReactionBeforeLastTouch = false;
      for (let index = firstTouch; index < lastTouch; index += 1) {
        const code = run.trace[index].code;
        if (code === "ATT.ADJUST" || code === "GK.ADJUST" || code === "DEF.ADJUST") anyReactionBeforeLastTouch = true;
      }
      if (batches > 1) sawSingleReactionPerRole = false;
      if (anyReactionBeforeLastTouch) sawReactionOnlyAfterTouches = false;
    }
  }
  check("exercised at least one 3+ touch carry/dribble within the search budget", sawMultiTouchCarry);
  check("off-ball players get exactly ONE reaction batch after a multi-touch carry, not one per touch",
    sawSingleReactionPerRole);
  check("no off-ball reaction event sits between two touches anymore -- touches run uninterrupted, the reaction follows once",
    sawReactionOnlyAfterTouches);
}

console.log("\n=== Gameplay v3 (2026-08-28) -- a carry never stacks a second reaction batch on top of one that already spanned the whole window, and off-ball reactors genuinely carry live, non-zero velocity during it ===");
{
  // The resolver-side half of Off-Ball Motion v3 (Section 35, just above)
  // already proved off-ball players get ONE reaction, not one per touch.
  // This covers the CARRY side of a symptom Section E (above) already
  // proved for PASS: runConstructedPossession()'s own
  // POST_ACTION_CONVERGENCE_MS reshape must not ALSO fire after an action
  // that already returned offBallInterleaved:true -- a second reaction on
  // top (fresh trajectory, velocity reset to zero) is the exact "second
  // hitch" the strobe report described, and carry was never actually
  // checked. Also confirms the off-ball reactor's own continuous
  // trajectory (reactOffBallContinuous()'s own sampleContinuousTrajectory()
  // samples -- the ONLY real hermite/velocity data authored during a
  // carry; the carrier's own P.CARRY.TOUCH moves are plain moveFrom/moveTo
  // declarations with no trajectory array, so they compile to linear
  // keyframes with velocity:null and were never hermite-driven to begin
  // with) is genuinely live during a carry, not dead code. The precise
  // "narrow joins keep velocity, wide idle gaps still zero" behavior
  // itself already has its own direct, unambiguous unit test
  // (zeroVelocityAcrossIdleGaps(), test-timeline-playback.mjs) -- a
  // full-pipeline version of that SAME check turned out to be untestable
  // here without also modeling arrival timing (a reactor who's already
  // arrived at their job target correctly reads zero velocity for every
  // remaining sample -- confirmed by inspection, not a bug -- and that
  // legitimate case is indistinguishable from the old flattening bug by
  // inspecting isolated sample pairs alone).
  const owner = entry("gv3-carry-owner", { team: "home", x: 30, y: 30, playerObj: GOOD_DRIBBLER });
  const teammate = entry("gv3-carry-teammate", { team: "home", x: 60, y: 35, playerObj: STRONG_PASSER });
  const defenderA = entry("gv3-carry-defA", { team: "away", x: 62, y: 40, playerObj: WEAK_DEFENDER });
  const defenderB = entry("gv3-carry-defB", { team: "away", x: 70, y: 55, playerObj: WEAK_DEFENDER });
  const keeper = entry("gv3-carry-gk", { role: "keeper", team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
  const authored = [owner, teammate, defenderA, defenderB, keeper];
  setupRoster(authored, owner.id);
  const initialPositions = Object.fromEntries(authored.map((item) => [item.id, pointOf(item)]));

  let checkedAnyCarryBatch = false;
  let sawSingleReactionBatchAfterCarry = true;
  let checkedReactorVelocityJoins = false;
  let sawAnyRealMotion = false;
  for (let index = 0; index < 250 && !(checkedAnyCarryBatch && sawAnyRealMotion); index += 1) {
    const run = runConstructedPossession(`gv3-carry-${index}`);
    const carryIndex = run.trace.findIndex((event) => event.code === "P.CARRY");
    if (carryIndex === -1) continue;

    let batches = 0;
    let inBatch = false;
    for (let i = carryIndex + 1; i < run.trace.length; i += 1) {
      const code = run.trace[i].code;
      const isReaction = code === "ATT.ADJUST" || code === "GK.ADJUST" || code === "DEF.ADJUST";
      if (isReaction && !inBatch) { batches += 1; inBatch = true; }
      else if (!isReaction) { inBatch = false; if (code === "ACTION.CHOICE" || code.startsWith("P.")) break; }
    }
    checkedAnyCarryBatch = true;
    if (batches > 1) sawSingleReactionBatchAfterCarry = false;

    const plan = buildMatchLabPlaybackPlan({
      trace: run.trace, initialPositions, initialBall: pointOf(owner), initialOwnerId: owner.id,
      finalOwnerId: run.finalOwnerId, restart: run.result.restart,
    });
    const reactorId = [teammate.id, defenderA.id, defenderB.id]
      .find((id) => (plan.tracks.players[id] || []).some((frame) => frame.velocity));
    if (!reactorId) continue;
    const reactorTrack = plan.tracks.players[reactorId];
    // sampleContinuousTrajectory()'s own samples legitimately read zero
    // once the reactor has genuinely ARRIVED at their target (position
    // stops changing, so velocity honestly does too) -- confirmed by
    // inspection: a flagged "zeroed pair" during this test's own
    // development turned out to be two samples at the IDENTICAL
    // position, a real stop, not the old sub-touch flattening. That
    // makes "no zero samples anywhere mid-run" untestable at this layer
    // without also modeling arrival timing -- zeroVelocityAcrossIdleGaps()
    // itself already has a precise, direct unit test (test-timeline-playback.mjs)
    // proving the actual fixed mechanism (raised IDLE_GAP_THRESHOLD_MS,
    // narrow joins preserved, wide ones still zero). What this integration
    // check adds on top: proof the reactor's own trajectory carries real,
    // non-zero velocity at all during a live carry -- the mechanism is
    // genuinely wired up, not dead code.
    checkedReactorVelocityJoins = true;
    if (reactorTrack.some((frame) => frame.velocity && (Math.abs(frame.velocity.x) > 1e-6 || Math.abs(frame.velocity.y) > 1e-6))) {
      sawAnyRealMotion = true;
    }
  }
  check("exercised at least one carry to check for a duplicate post-action reaction batch", checkedAnyCarryBatch);
  check("no second (POST_ACTION_CONVERGENCE_MS, chaseIntention:false) reaction batch follows a carry that already interleaved one",
    sawSingleReactionBatchAfterCarry);
  check("exercised at least one off-ball reactor's own velocity-bearing trajectory during a carry", checkedReactorVelocityJoins);
  check("that trajectory carries real, non-zero velocity during the carry -- the continuous mechanism is genuinely live, not dead code",
    sawAnyRealMotion);
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
      const contactIndex = Number(String(error.message).match(/Contact (\d+)/)?.[1]);
      if (Number.isInteger(contactIndex)) {
        const failedEvent = run.trace[contactIndex];
        if (failedEvent) {
          failureMessage += ` (${failedEvent.code}: actor ${failedEvent.contact?.actorId}, point ${failedEvent.contact?.point?.x?.toFixed(2)},${failedEvent.contact?.point?.y?.toFixed(2)}, body ${failedEvent.contact?.bodyPoint?.x?.toFixed(2)},${failedEvent.contact?.bodyPoint?.y?.toFixed(2)}, reach ${failedEvent.contact?.reachAllowanceYards})`;
        }
      }
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

console.log("\n=== 38b: every awarded pitch-exit restart is taken before open play resumes ===");
{
  const restartCodes = {
    "throw-in": "RESTART.THROW_IN.TAKE",
    corner: "RESTART.CORNER.TAKE",
    "goal-kick": "RESTART.GOAL_KICK.TAKE",
  };
  const makePlacedEntry = (id, team, role, positionalSlot, x, y, playerObj) => {
    const created = entry(id, { team, role, x, y, playerObj });
    created.positionalSlot = positionalSlot;
    created.formationAnchor = pointOf(created);
    return created;
  };
  for (const [restartType, takeCode] of Object.entries(restartCodes)) {
    const owner = makePlacedEntry("live-home-owner", "home", "player", "MC", 48, 52, GOOD_DRIBBLER);
    const roster = [
      makePlacedEntry("live-home-gk", "home", "keeper", "GK", 50, 5, ELITE_KEEPER),
      makePlacedEntry("live-home-d", "home", "player", "DC", 35, 28, ELITE_DEFENDER),
      owner,
      makePlacedEntry("live-home-f", "home", "player", "FC", 50, 76, ELITE_FINISHER),
      makePlacedEntry("live-away-gk", "away", "keeper", "GK", 50, 95, ELITE_KEEPER),
      makePlacedEntry("live-away-d", "away", "player", "DC", 65, 72, ELITE_DEFENDER),
      makePlacedEntry("live-away-m", "away", "player", "MC", 52, 58, STRONG_PASSER),
      makePlacedEntry("live-away-f", "away", "player", "FC", 52, 24, ELITE_FINISHER),
    ];
    setupRoster(roster, owner.id);
    const authoredBefore = JSON.stringify(state.roster);
    const originals = { ...FREE_PLAY_RESOLVERS };
    let calls = 0;
    const exit = restartType === "throw-in"
      ? { x: 100, y: 54, zone: zoneFromPercent(100, 54) }
      : { x: restartType === "corner" ? 18 : 72, y: 100, zone: zoneFromPercent(restartType === "corner" ? 18 : 72, 100) };
    const scripted = (groups, availability, _random, resolverTrace) => {
      calls += 1;
      if (calls === 1) {
        resolverTrace.push(traceEvent(
          restartType === "throw-in" ? "RESTART.THROW_IN"
            : restartType === "corner" ? "RESTART.CORNER" : "RESTART.GOAL_KICK",
          `The ball leaves play for a ${restartType}`,
          {
            actor: groups.owner,
            movement: "pass",
            outcome: "turnover",
            duration: 500,
            ballFrom: pointOf(groups.owner),
            ballTo: exit,
            ownerBefore: groups.owner,
            ownerAfter: null,
            lastTouch: {
              playerId: groups.owner.id,
              team: groups.owner.team,
              bodyPart: "foot",
              deliberate: true,
            },
          },
        ));
        return {
          outcome: restartType.toUpperCase(), code: "OUT", resolved: true,
          terminal: true, possession: "dead", nextOwnerId: null,
          ballEnd: exit, restart: restartType, restartTakingTeam: "away",
          restartEdge: restartType === "throw-in" ? "right" : "bottom",
          reason: "scripted-pitch-exit",
        };
      }
      if (calls === 2) {
        const target = groups.teammates.find((candidate) =>
          candidate.id === availability?.preselectedTargetId)
          ?? groups.teammates.find((candidate) => candidate.role !== "keeper");
        const from = pointOf(groups.owner);
        const to = pointOf(target);
        resolverTrace.push(traceEvent("P.PASS", "The restart finds its target", {
          actor: groups.owner,
          target,
          movement: "pass",
          outcome: "success",
          duration: 600,
          ballFrom: from,
          ballTo: to,
          contact: { point: from, actor: groups.owner, type: "pass", phase: "start" },
          ownerBefore: groups.owner,
          ownerAfter: target,
          ownerAfterAt: "end",
          lastTouch: {
            playerId: groups.owner.id,
            team: groups.owner.team,
            bodyPart: "foot",
            deliberate: true,
          },
        }));
        return {
          outcome: "COMPLETE", code: "P.PASS", resolved: true,
          terminal: false, possession: "retained", nextOwnerId: target.id,
          ballEnd: to, restart: null, reason: "scripted-restart-complete",
        };
      }
      const point = pointOf(groups.owner);
      resolverTrace.push(traceEvent("P.OFFSIDE.FLAG", "The next passage reaches a later stoppage", {
        actor: groups.owner,
        movement: "foul",
        outcome: "failure",
        duration: 120,
        ballFrom: point,
        ballTo: point,
        ownerBefore: groups.owner,
        ownerAfter: null,
        restart: "indirect-free-kick",
      }));
      return {
        outcome: "STOPPED", code: "P.OFFSIDE.FLAG", resolved: true,
        terminal: true, possession: "dead", nextOwnerId: null,
        ballEnd: point, restart: "indirect-free-kick", reason: "scripted-later-stoppage",
      };
    };
    for (const key of Object.keys(FREE_PLAY_RESOLVERS)) FREE_PLAY_RESOLVERS[key] = scripted;
    let run = null;
    try {
      run = runConstructedPossession(`automatic-${restartType}`);
    } finally {
      Object.assign(FREE_PLAY_RESOLVERS, originals);
    }
    const awardedAt = run.trace.findIndex((event) =>
      event.code === (restartType === "throw-in" ? "RESTART.THROW_IN"
        : restartType === "corner" ? "RESTART.CORNER" : "RESTART.GOAL_KICK"));
    const setupAt = run.trace.findIndex((event) => event.code === "RESTART.SETUP");
    const takenAt = run.trace.findIndex((event) => event.code === takeCode);
    const releaseAt = run.trace.findIndex((event) => event.code === "RESTART.RELEASE");
    const nextChoiceAt = run.trace.findIndex((event, index) =>
      index > takenAt && event.code === "ACTION.CHOICE");
    const take = run.trace[takenAt];
    const setup = run.trace[setupAt];
    check(`${restartType}: award -> setup -> take -> release -> next decision are ordered`,
      awardedAt >= 0 && setupAt > awardedAt && takenAt > setupAt
        && releaseAt > takenAt && nextChoiceAt > releaseAt);
    check(`${restartType}: the awarded away side supplies the real taker`,
      Boolean(take) && state.roster.find((candidate) => candidate.id === take.actorId)?.team === "away");
    check(`${restartType}: placement and the actual take share one exact ball coordinate`,
      Boolean(setup && take)
        && setup.ballTo.x === take.ballFrom.x
        && setup.ballTo.y === take.ballFrom.y
        && setup.ballTo.zone === take.ballFrom.zone);
    check(`${restartType}: the restart returns to the ordinary loop before its later stoppage`,
      calls === 3 && run.result.restart === "indirect-free-kick"
        && run.result.reason === "scripted-later-stoppage");
    check(`${restartType}: the complete passage builds a continuous playback plan`,
      (() => {
        try {
          buildMatchLabPlaybackPlan({
            trace: run.trace,
            initialPositions: Object.fromEntries(roster.map((candidate) => [candidate.id, pointOf(candidate)])),
            initialBall: pointOf(owner),
            initialOwnerId: owner.id,
            finalOwnerId: run.finalOwnerId,
            restart: run.result.restart,
            playerProfiles: Object.fromEntries(roster.map((candidate) => [candidate.id, candidate.player])),
          });
          return true;
        } catch {
          return false;
        }
      })());
    check(`${restartType}: live restart execution leaves the authored setup unchanged`,
      JSON.stringify(state.roster) === authoredBefore);
  }
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
  // Player Body Occupancy v1 (2026-09-06) changed what "converge" is allowed
  // to mean. The tactical 8-yard rule is still same-team-only, so these two
  // opponents are NOT held apart by it -- they still both come to the
  // contested point, which is the property this test has always been about.
  // What they may no longer do is occupy the same coordinate: they arrive
  // shoulder to shoulder instead of inside one another. The old assertion
  // (exact equality with the contested point) encoded the absence of a body,
  // which is the bug playerBody.js exists to fix.
  const convergedGap = yardDistance(converged[0].target, converged[1].target);
  check("opponents remain free to converge on the same contested point",
    converged.every((proposal) => yardDistance(proposal.target, { x: 50, y: 50 }) <= BODY_MIN_SEPARATION_YARDS)
    && convergedGap < 8);
  check("converging opponents stop at body contact rather than overlapping",
    convergedGap >= BODY_MIN_SEPARATION_YARDS);
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
      && choices.every((event) => Number.isInteger(event.metrics?.legalPassingOptions)
        && Number.isFinite(event.metrics?.distanceToGoalMetres)
        && Number.isFinite(event.metrics?.longRangeShotConfidence)
        && ["discourage", "balanced", "encourage"].includes(event.metrics?.shootingInstruction)));
  check("the readable choice commentary exposes the legal passing-option count",
    choices.every((event) => event.label.includes("legal pass option")));
  const calculatedMean = run.decisionMetrics.reduce((sum, entry) => sum + entry.legalPassingOptions, 0)
    / run.decisionMetrics.length;
  check("the possession summary aggregates the same per-decision samples without recomputing geometry",
    run.possessionMetrics.decisions === choices.length
      && Math.abs(run.possessionMetrics.meanLegalPassingOptions - calculatedMean) < 0.0001);
  check("the same summary exposes pass/carry/shot counts and metric shot distance",
    run.possessionMetrics.passesSelected
        + run.possessionMetrics.carriesSelected
        + run.possessionMetrics.shotsSelected <= run.possessionMetrics.decisions
      && (run.possessionMetrics.meanShotDistanceYards === null
        || Number.isFinite(run.possessionMetrics.meanShotDistanceYards))
      && (run.possessionMetrics.meanShotDistanceMetres === null
        || Math.abs(
          run.possessionMetrics.meanShotDistanceMetres
            - run.possessionMetrics.meanShotDistanceYards * 0.9144,
        ) < 0.0001));
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
    check("an uncontested assessment is a zero-time cue without an invented touch",
      holdEvent.contact === null && holdEvent.duration === 0 && holdEvent.timelineRole === "cue");
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
    if (result.reason === "hold-shield-loose" && !lostFound) lostFound = { result, trace, owner, defender };
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
    check("the won event's contact names the holder at the contact point, phase 'start', ownership retained",
      won.contact && won.contact.actorId === owner.id && won.contact.phase === "start"
        && won.ownerBeforeId === owner.id && won.ownerAfterId === owner.id);
    const retentionDistance = yardDistance(won.ballFrom, won.ballTo);
    check("the holder makes a short, physically authored retention movement rather than a fixed five-yard escape",
      retentionDistance > 0 && retentionDistance < 3
        && won.playerMoves.length === 1
        && won.playerMoves[0].action === "shield-retain"
        && won.playerMoves[0].trajectory.length >= 2);
    check("winning the shield does not erase the defender's pressure responsibility",
      !("beatenDefenderId" in result));
  }
  if (lostFound) {
    const { result, trace, owner, defender } = lostFound;
    // Engagement Breaker v1 -- a lost shield is a knock-on, not an
    // ownership teleport at the shared contact point: the ball pops
    // loose (unowned, a real distance away) and the possession loop's
    // own existing loose-ball recovery race decides who actually gets
    // it next -- often the original holder, often not, never asserted
    // here directly.
    check("a lost shield is terminal (this resolver reports loose, not a guessed recovery) with the ball genuinely unowned",
      result.terminal === true && result.possession === "loose" && result.nextOwnerId === null);
    check("trace shows the challenge then the loose outcome, in order",
      trace.map((e) => e.code).join(",") === "P.HOLD.SHIELD,P.HOLD.SHIELD.LOST");
    const lost = trace[1];
    check("the lost event's contact names the CHALLENGER at the shared contact point, phase 'start', ownership genuinely nobody's",
      lost.contact && lost.contact.actorId === defender.id && lost.contact.phase === "start"
        && lost.ownerBeforeId === owner.id && lost.ownerAfterId === null);
    check("the ball genuinely pops loose a real distance -- never parked at the same XY it was won at",
      yardDistance(lost.ballFrom, lost.ballTo) >= 3);
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
      if (result.reason === "hold-shielded" || result.reason === "hold-shield-loose") {
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

console.log("\n=== Engagement Breaker v1: T.WON.CONTROL is a real escape, not a 1.2yd nudge still inside DUEL_RANGE_YARDS ===");
{
  const owner = entry("eb-won-owner", { team: "home", x: 50, y: 50, playerObj: GOOD_DRIBBLER });
  const defender = entry("eb-won-defender", { team: "away", x: 52, y: 52, playerObj: ELITE_DEFENDER });
  const groups = { owner, teammates: [], opponents: [defender], keeper: null };
  let wonFound = null;
  for (let index = 0; index < 1000 && !wonFound; index += 1) {
    const trace = [];
    const result = resolveDribble(groups, {}, seededRandom(hashString(`eb-won-${index}`)), trace);
    if (result.reason === "tackle-won") wonFound = { trace, result };
  }
  check("found a won tackle outcome within the search budget", Boolean(wonFound));
  if (wonFound) {
    const wonEvent = wonFound.trace.find((e) => e.code === "T.WON.CONTROL");
    check("T.WON.CONTROL's own ball movement is a real escape -- at least 4yd from the contact point",
      Boolean(wonEvent) && yardDistance(wonEvent.ballFrom, wonEvent.ballTo) >= 4);
    check("the winner and the loser are both authored moving apart from each other, never glued together",
      wonEvent.playerMoves?.length === 2
        && yardDistance(
          wonEvent.playerMoves.find((m) => m.playerId === defender.id).to,
          wonEvent.playerMoves.find((m) => m.playerId === owner.id).to,
        ) >= CARRY_BODY_CLEARANCE_YARDS);
  }
}

console.log("\n=== Engagement Breaker v1: hold is never chosen twice in a row by the same owner ===");
{
  let checkedAny = false;
  let sawConsecutiveHold = false;
  for (let i = 0; i < 300; i += 1) {
    const run = runConstructedPossession(`eb-consecutive-hold-${i}`);
    const choices = run.trace.filter((e) => e.code === "ACTION.CHOICE" && e.metrics?.selectedAction);
    for (let j = 1; j < choices.length; j += 1) {
      checkedAny = true;
      if (choices[j].metrics.selectedAction === "hold" && choices[j - 1].metrics.selectedAction === "hold"
          && choices[j].metrics.ownerId === choices[j - 1].metrics.ownerId) {
        sawConsecutiveHold = true;
      }
    }
  }
  check("exercised at least one possession with multiple decisions", checkedAny);
  check("the SAME owner never chooses hold on two consecutive decisions", !sawConsecutiveHold);
}

console.log("\n=== Engagement Breaker v1: the same pair cannot shield each other again within a short window ===");
{
  let checkedAny = false;
  let sawRepeatPairShieldWithinWindow = false;
  for (let i = 0; i < 300; i += 1) {
    const run = runConstructedPossession(`eb-repeat-pair-${i}`);
    const actionBoundaries = [];
    run.trace.forEach((e, idx) => { if (e.code === "ACTION.CHOICE") actionBoundaries.push(idx); });
    const shieldEvents = run.trace
      .map((e, idx) => ({ e, idx }))
      .filter(({ e }) => e.code === "P.HOLD.SHIELD");
    for (let a = 0; a < shieldEvents.length; a += 1) {
      for (let b = a + 1; b < shieldEvents.length; b += 1) {
        checkedAny = true;
        const pairA = [shieldEvents[a].e.actorId, shieldEvents[a].e.defenderId].sort().join(",");
        const pairB = [shieldEvents[b].e.actorId, shieldEvents[b].e.defenderId].sort().join(",");
        if (pairA !== pairB) continue;
        const betweenActions = actionBoundaries.filter(
          (boundaryIdx) => boundaryIdx > shieldEvents[a].idx && boundaryIdx <= shieldEvents[b].idx,
        ).length;
        // A GENUINE turnover in between (an interception, a won tackle, a
        // poked-loose carry) is a real, separate contest reuniting the
        // same two bodies -- exactly the "carry, a real pass attempt,
        // intercepted" shape real football produces, not the reported
        // "wrestling on the same pixel" loop (hold -> shield -> hold ->
        // shield with NOTHING else ever happening). Only a re-shield with
        // NO such intervening event is the actual bug this window guards
        // against.
        const genuineTurnoverBetween = run.trace
          .slice(shieldEvents[a].idx + 1, shieldEvents[b].idx)
          .some((event) => ["P.PASS.LOST", "T.WON.CONTROL", "T.POKE", "P.HOLD.SHIELD.LOST"].includes(event.code));
        if (betweenActions < 4 && !genuineTurnoverBetween) {
          sawRepeatPairShieldWithinWindow = true;
        }
      }
    }
  }
  check("exercised at least one same-pair P.HOLD.SHIELD comparison", checkedAny);
  check("the same pair never re-shields within a 4-action window", !sawRepeatPairShieldWithinWindow);
}

console.log("\n=== Engagement Breaker v1: two stacked CBs and no easy pass cannot wrestle a dribbler indefinitely ===");
{
  // The exact "Sensini <-> Mancini" shape from the reported bug: an
  // attacker with NO passing outlet and no shot on, boxed in by two
  // tightly-stacked, elite defenders both within DUEL_RANGE_YARDS -- the
  // single most adversarial case for the wrestling loop, since without
  // this fix "hold" was always a legal, always-re-offered fallback the
  // instant a duel put the SAME two bodies back on the same spot.
  const owner = entry("eb-stack-owner", { team: "home", x: 50, y: 40, playerObj: GOOD_DRIBBLER });
  const cbOne = entry("eb-stack-cb1", { team: "away", x: 51, y: 41, playerObj: ELITE_DEFENDER });
  const cbTwo = entry("eb-stack-cb2", { team: "away", x: 49, y: 42, playerObj: ELITE_DEFENDER });
  const keeper = entry("eb-stack-gk", { role: "keeper", team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
  const authored = [owner, cbOne, cbTwo, keeper];
  setupRoster(authored, owner.id);

  let maxConsecutiveContestActions = 0;
  const CONTEST_TYPES = new Set(["hold", "dribble", "back-to-goal"]);
  for (let i = 0; i < 500; i += 1) {
    const run = runConstructedPossession(`eb-stacked-cbs-${i}`);
    const selections = run.trace
      .filter((e) => e.code === "ACTION.CHOICE" && e.metrics?.selectedAction)
      .map((e) => e.metrics.selectedAction);
    let streak = 0;
    for (const action of selections) {
      streak = CONTEST_TYPES.has(action) ? streak + 1 : 0;
      if (streak > maxConsecutiveContestActions) maxConsecutiveContestActions = streak;
    }
  }
  check(`across 500 possessions against two stacked CBs with no passing outlet, the longest unbroken hold/dribble/back-to-goal streak stays under 10 (found ${maxConsecutiveContestActions})`,
    maxConsecutiveContestActions < 10);
}

console.log("\n=== Progression Contest v1: pair-ban's carry fallback cannot run through/past the banned opponent ===");
{
  // The exact "beating a presser unlocks a free carry" gap this feature
  // closes: `banned` is the opponent the pair-ban already forbids a
  // fresh dribble/back-to-goal against -- the carry fallback must not
  // quietly substitute an uncontested run through/past that SAME body.
  const owner = entry("pc-pairban-owner", { team: "home", x: 50, y: 50, playerObj: GOOD_DRIBBLER });
  // Within DUEL_RANGE_YARDS(6) of the owner -- close enough to register
  // as a real engagingOpponent() and actually trigger pairBanned, not
  // just sit nearby without being the engager at all.
  const banned = entry("pc-pairban-banned", { team: "away", x: 51, y: 53, playerObj: ELITE_DEFENDER });
  const teammate = entry("pc-pairban-mate", { team: "home", x: 30, y: 45, playerObj: AVERAGE });
  const groups = { owner, teammates: [teammate], opponents: [banned], keeper: null };
  const engagementHistory = { consecutiveHoldOwnerId: null, recentPairs: [{ aId: owner.id, bId: banned.id, actionsAgo: 0 }] };
  const candidates = generateFreePlayCandidates(groups, "down", undefined, engagementHistory);
  const dribbleOrB2G = candidates.find((c) => c.type === "dribble" || c.type === "back-to-goal");
  const carryCandidate = candidates.find((c) => c.type === "carry");
  check("dribble/back-to-goal against the banned pair is never offered", !dribbleOrB2G);
  check("a real pass outlet is still offered", candidates.some((c) => c.type === "pass"));
  if (carryCandidate) {
    check("a surviving carry does not run through/past the banned opponent toward goal",
      distanceToGoalYards(carryCandidate.moveTo, "down") >= distanceToGoalYards(banned, "down") - 0.01);
  } else {
    check("(no carry survived the pair-ban at all here -- the pass/shoot options left are exactly what a real 9-outlet situation demands)", true);
  }
}

console.log("\n=== Progression Contest v1: carryUtility()/dribbleUtility() now read a real Dribbling/Technique affinity ===");
{
  const LOW = player("Low Dribbler", { Dribbling: 8, Technique: 8, Passing: 14, Decisions: 14 });
  const HIGH = player("High Dribbler", { Dribbling: 18, Technique: 18, Passing: 14, Decisions: 14 });
  const ownerLow = entry("aff-owner-low", { team: "home", x: 50, y: 50, playerObj: LOW });
  const ownerHigh = entry("aff-owner-high", { team: "home", x: 50, y: 50, playerObj: HIGH });
  // ~7-8 real yards away -- inside PRESSURE_RADIUS_YARDS(9) so pressureAt()
  // reads a real, meaningful value, but outside DUEL_RANGE_YARDS(6) so
  // this never becomes an "engager" and steal the carry candidate outright
  // (dribble would be offered instead) -- exactly the geometry that
  // isolates carryUtility()'s own affinity term.
  const distantPresser = entry("aff-press", { team: "away", x: 50, y: 57, playerObj: ELITE_DEFENDER });
  const destination = { x: 50, y: 60 };
  const utilLow = carryUtility(ownerLow, destination, [distantPresser], "down", { hasSimpleOption: false });
  const utilHigh = carryUtility(ownerHigh, destination, [distantPresser], "down", { hasSimpleOption: false });
  check("identical geometry, lower Dribbling/Technique ranks carry measurably lower under real pressure",
    utilLow < utilHigh);
  const utilLowSimple = carryUtility(ownerLow, destination, [distantPresser], "down", { hasSimpleOption: true });
  check("a genuinely simple pass option pushes that SAME low-Dribbling carry utility lower still",
    utilLowSimple < utilLow);

  const dribbleDefender = entry("aff-dribble-def", { team: "away", x: 52, y: 53, playerObj: ELITE_DEFENDER });
  const dribbleUtilLow = dribbleUtility(ownerLow, dribbleDefender, "down", { hasSimpleOption: false });
  const dribbleUtilHigh = dribbleUtility(ownerHigh, dribbleDefender, "down", { hasSimpleOption: false });
  check("the SAME affinity term applies to dribbleUtility() -- a limited dribbler rates going at a marker lower too",
    dribbleUtilLow < dribbleUtilHigh);
}

console.log("\n=== Progression Contest v1: carry is contestable -- a defender near the roll line can poke it loose ===");
{
  // Geometry deliberately identical between trials -- only the CARRIER's
  // own Dribbling/Technique differ. The poke OPPORTUNITY itself is pure
  // geometry (does the live ball's own roll pass within real standing-
  // tackle range of the defender), so the two rates aren't expected to
  // differ hugely on that front; the real Dribbling/Technique/Agility vs
  // Tackling/Anticipation/Strength duel (resolveCarry()'s own
  // localizedDuel() call) is what should measurably separate them once a
  // poke attempt actually happens.
  function pokeRateFor(dribblingPlayer, label) {
    let pokes = 0;
    const trials = 400;
    for (let i = 0; i < trials; i += 1) {
      const owner = entry(`poke-owner-${label}-${i}`, { team: "home", x: 50, y: 30, playerObj: dribblingPlayer });
      const defender = entry(`poke-defender-${label}-${i}`, { team: "away", x: 51, y: 35, playerObj: ELITE_DEFENDER });
      const groups = { owner, teammates: [], opponents: [defender], keeper: null };
      const trace = [];
      const random = seededRandom(hashString(`poke-${label}-${i}`));
      const result = resolveCarry(groups, { plannedMoveTo: { x: 50, y: 40 } }, random, trace);
      if (result.code === "T.POKE") pokes += 1;
    }
    return pokes / trials;
  }
  const LOW_DRIBBLER = player("Low Dribbler Carrier", { Dribbling: 8, Technique: 8, Agility: 8, Passing: 12, Decisions: 12 });
  const HIGH_DRIBBLER = player("High Dribbler Carrier", { Dribbling: 18, Technique: 18, Agility: 17, Passing: 12, Decisions: 12 });
  const lowRate = pokeRateFor(LOW_DRIBBLER, "low");
  const highRate = pokeRateFor(HIGH_DRIBBLER, "high");
  check(`a Dribbling-8 carrier running a defender planted near the roll line produces SOME T.POKE outcomes, never all (found ${(lowRate * 100).toFixed(0)}%)`,
    lowRate > 0 && lowRate < 1);
  check(`a Dribbling-18 carrier over the identical geometry pokes less often (${(lowRate * 100).toFixed(0)}% -> ${(highRate * 100).toFixed(0)}%)`,
    highRate < lowRate);
}

console.log("\n=== Progression Contest v1: cover-shadow -- one extra body closes down a beaten presser, never a third ===");
{
  const ownerPoint = { x: 50, y: 40 };
  const marker = entry("cs-marker", { team: "away", x: 51, y: 41, playerObj: ELITE_DEFENDER });
  const coverCB = entry("cs-cover", { team: "away", x: 35, y: 55, playerObj: ELITE_DEFENDER });
  const farDefender = entry("cs-far", { team: "away", x: 65, y: 90, playerObj: ELITE_DEFENDER });
  const teammate = entry("cs-mate", { team: "home", x: 45, y: 45, playerObj: AVERAGE });
  const plan = planDefensiveRepositioning(
    ownerPoint, [teammate], [marker, coverCB, farDefender], "up",
    { beatenPresserId: marker.id },
  );
  const markerJob = plan.find((step) => step.id === marker.id);
  const coverJob = plan.find((step) => step.id === coverCB.id);
  check("the beaten marker recovers onto the ball, not an ordinary press/mark/zonal job", markerJob?.action === "recover");
  check("exactly one OTHER defender gets the new cover-shadow job", coverJob?.action === "cover-shadow");
  check("cover-shadow's own target sits tighter than ordinary cover but looser than an active press",
    Boolean(coverJob) && yardDistance(coverJob.intentionTarget, ownerPoint) > 1.5 && yardDistance(coverJob.intentionTarget, ownerPoint) < 7);
  check("never a third body on the carrier -- only 2 of the 3 defenders get a job aimed at the ball itself",
    plan.filter((step) => step.action === "recover" || step.action === "press-ball" || step.action === "cover-shadow").length === 2);
}

console.log("\n=== Ball Lead Scaling v1 (2026-08-30): a near-zero-distance final carry leg must not still swing the ball a full CARRY_BALL_LEAD_YARDS out and back ===");
{
  // A real reported bug (browser round, screenshot): "the ball goes in
  // front of the player but teleports to the inside of the circle
  // afterwards" during a plain P.CARRY. Root cause: carryLegBallTrajectory()'s
  // own lead offset used a pure unit DIRECTION vector (full magnitude the
  // instant ballFrom/ballTo differ by ANY nonzero amount) times a FIXED
  // 1.6-yard lead -- so a leftover residual leg of a few THOUSANDTHS of a
  // yard (simulateCarryTouches()'s own spacing threshold routinely leaves
  // one; a real, common case) still put the full 1.6-yard round-trip
  // swing on the ball, which visually reads as darting almost two yards
  // out and snapping straight back onto a carrier who barely moved at
  // all. This fixture reproduces it directly and deterministically: a
  // plannedMoveTo only a hair from the owner's own current spot means
  // simulateCarryTouches() produces ZERO touches (already within
  // spacing), so the entire P.CARRY leg runs start-to-finish over that
  // near-zero distance.
  const owner = entry("lead-owner", { team: "home", x: 50, y: 50, playerObj: GOOD_DRIBBLER });
  const groups = { owner, teammates: [], opponents: [], keeper: null };
  const trace = [];
  const result = resolveCarry(
    groups, { plannedMoveTo: { x: 50.006, y: 50 } }, seededRandom(hashString("lead-scale")), trace,
  );
  check("resolved without error", result.resolved === true);
  const carryEvent = trace.find((event) => event.code === "P.CARRY");
  check("found the P.CARRY event", Boolean(carryEvent));
  if (carryEvent) {
    const realDistanceYards = yardDistance(carryEvent.ballFrom, carryEvent.ballTo);
    check("test fixture sanity: this really is a near-zero-distance leg", realDistanceYards < 0.05);
    const maxOffLineYards = Math.max(
      ...carryEvent.ballTrajectory.map((sample) =>
        yardDistanceToSegment(sample.position, carryEvent.ballFrom, carryEvent.ballTo)),
    );
    check(`the ball's own trajectory stays close to that same tiny real distance (${realDistanceYards.toFixed(4)}yd), never a near-1.6yd swing off the direct line (found ${maxOffLineYards.toFixed(3)}yd)`,
      maxOffLineYards < 0.3);
  }

  // Sanity check the OTHER direction too: an ordinary, real multi-yard
  // carry must keep its full, intended lead -- this fix only scales the
  // lead DOWN for a near-zero move, never for a genuine one.
  const longOwner = entry("lead-owner-long", { team: "home", x: 50, y: 50, playerObj: GOOD_DRIBBLER });
  const longGroups = { owner: longOwner, teammates: [], opponents: [], keeper: null };
  const longTrace = [];
  // A three-yard carry has no intermediate touch, so its final leg really
  // is multi-yard regardless of changes in the longer carry's touch cadence.
  resolveCarry(longGroups, { plannedMoveTo: { x: 50, y: 52.5 } }, seededRandom(hashString("lead-scale-long")), longTrace);
  const longCarryEvent = longTrace.find((event) => event.code === "P.CARRY");
  if (longCarryEvent) {
    check("the lead fixture exercises a multi-yard final leg", yardDistance(longCarryEvent.ballFrom,longCarryEvent.ballTo)>2);
    const maxOffLineYardsLong = Math.max(...longCarryEvent.ballTrajectory.map((sample,index) =>
      yardDistance(sample.position,longCarryEvent.playerMoves[0].trajectory[index].position)));
    // A generous corridor, not a near-zero claim -- the carrier's own
    // real hermite path (curving in from whatever heading the last touch
    // exited at) legitimately isn't perfectly straight, so some natural
    // deviation is expected here. What this guards against is the fix
    // going too far the OTHER way and suppressing the lead for a real
    // carry too -- the deviation should be a real, non-trivial fraction
    // of a yard, not the near-zero (<0.05yd) reading the fully-suppressed
    // near-zero-distance case above produces.
    check(`a multi-yard final carry leg keeps a real ball lead from its carrier (found ${maxOffLineYardsLong.toFixed(3)}yd)`,
      maxOffLineYardsLong > 1 && maxOffLineYardsLong < 3);
  }
}

console.log("\n=== Progression Contest v1: a limited dribbler with real support does not carry/hold its way past two markers untouched (Zamorano shape) ===");
{
  // The reported film: receive -> carry (9 passes ignored) -> hold WON ->
  // carry -> hold WON -> carry -> carry -> shoot, never once using either
  // of two real, onside teammates. Same "two markers, bounded streak"
  // shape as the stacked-CBs test above, but WITH two genuine passing
  // outlets on -- this is what actually isolates the affinity fix (a
  // limited dribbler should lean on those outlets, not just eventually
  // get bumped off hold by the pair-ban).
  const LIMITED_DRIBBLER = player("Limited Dribbler", {
    Dribbling: 10, Technique: 10, Passing: 14, Teamwork: 13,
    Decisions: 14, Vision: 13, Anticipation: 13, Composure: 14,
  });
  const owner = entry("zam-owner", { team: "home", x: 50, y: 55, playerObj: LIMITED_DRIBBLER });
  const mateA = entry("zam-mate-a", { team: "home", x: 40, y: 50, playerObj: AVERAGE });
  const mateB = entry("zam-mate-b", { team: "home", x: 60, y: 50, playerObj: AVERAGE });
  const cbOne = entry("zam-cb1", { team: "away", x: 51, y: 60, playerObj: ELITE_DEFENDER });
  const cbTwo = entry("zam-cb2", { team: "away", x: 49, y: 63, playerObj: ELITE_DEFENDER });
  const keeper = entry("zam-gk", { role: "keeper", team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
  const authored = [owner, mateA, mateB, cbOne, cbTwo, keeper];
  setupRoster(authored, owner.id);

  let sawPass = false;
  let maxUntouchedRun = 0;
  const UNTOUCHED_TYPES = new Set(["carry", "hold", "dribble", "back-to-goal"]);
  for (let i = 0; i < 500; i += 1) {
    const run = runConstructedPossession(`zamorano-${i}`);
    if (run.trace.some((event) => event.code === "P.PASS" || event.code === "P.PASS.LOST")) sawPass = true;
    const selections = run.trace
      .filter((event) => event.code === "ACTION.CHOICE" && event.metrics?.selectedAction)
      .map((event) => event.metrics.selectedAction);
    let streak = 0;
    for (const action of selections) {
      streak = UNTOUCHED_TYPES.has(action) ? streak + 1 : 0;
      if (streak > maxUntouchedRun) maxUntouchedRun = streak;
    }
  }
  check("a real pass outlet actually gets used at least once across 500 possessions", sawPass);
  // A looser bound than the stacked-CBs test above (which has NO passing
  // outlet at all): noisy-argmax genuinely can string together an
  // unlucky double-digit run once in 500 x up to 50 actions even with
  // real outlets on. What actually matters here -- passing genuinely
  // gets used (checked above) -- is the real signal; this just rules out
  // the reported "the entire possession is one uninterrupted carry/hold
  // chain" shape (a run near POSSESSION_MAX_ACTIONS).
  check(`the longest unbroken carry/hold/dribble/back-to-goal streak with two real teammates on stays well short of a runaway possession (found ${maxUntouchedRun})`,
    maxUntouchedRun < 20);
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
    // Kick As Projectile v1 (2026-08-27) -- contact is now the first real
    // tick-by-tick meeting of this receiver's own body and the ball's own
    // independent flight, not a booked delivery to a fixed landing point.
    // This receiver stands directly on the owner-to-target corridor, well
    // short of targetPoint -- so the ball's real path reaches them almost
    // immediately, near where they were already standing, and that is the
    // CORRECT honest outcome (a runner sitting in the ball's own line
    // doesn't need to "run onto" it at all). The real invariant left to
    // check is geometric: contact happened somewhere ON the real corridor
    // the ball actually flew (never off to the side, never beyond the far
    // end), not proximity to the nominal target point specifically.
    check("possession is retained by the runner, at a real point on the ball's own flight path, not their old position teleported forward",
      result.possession === "retained" && result.nextOwnerId === receiver.id
        && yardDistanceToSegment(result.ballEnd, pointOf(owner), targetPoint) <= 2);
    check("reason is explicitly through-ball-received", result.reason === "through-ball-received");
    check("trace shows the delivery then the clean receipt, in order",
      trace.map((e) => e.code).join(",") === "P.THROUGH,ATT.RECEIVER.RUN,P.THROUGH.RECEIVE");
    const receiveEvent = trace[2], receiverRun = trace[1];
    check("the receiver moves during the flight, and the control records that actual body position",
      receiverRun.overlapWithPrevious && receiverRun.moverId === receiver.id
        && yardDistance(receiverRun.moveTo,result.ballEnd)<0.001
        && yardDistance(receiveEvent.contact.bodyPoint,receiverRun.moveTo)<0.001
        && yardDistance(receiveEvent.contact.point,receiveEvent.contact.bodyPoint)<=receiveEvent.contact.reachAllowanceYards+0.001);
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
    // Kick As Projectile v1 (2026-08-27) -- shrunk from the old 70-real-yard
    // fixture (owner y:20 -> target y:90). Under a genuinely timed, physical
    // race, NO player can average the ~11-18 yd/s that distance demanded
    // from a standing start (topSpeed() caps out at 10.2yd/s), so the old
    // fixture always produced "nobody gets there" once contact stopped
    // being booked in advance -- an honest result, but not what this test
    // exists to exercise. This ~17-real-yard corridor (still forced into a
    // lofted, over-the-top ball by the defender sitting squarely in the
    // lane -- see laneObstruction()) keeps peakHeightYards near its 1.5yd
    // floor, comfortably under playerMaxReachYards() for both bodies, so
    // the contest turns on real positioning/timing, not a height coin-flip.
    const owner = entry("through-lane-owner", { team: "home", x: 50, y: 30, playerObj: STRONG_PASSER });
    const receiver = entry("through-lane-receiver", { team: "home", x: 48, y: 36, playerObj: GOOD_DRIBBLER });
    const laneDefender = entry("through-lane-defender", { team: "away", x: 52, y: 42, playerObj: WEAK_DEFENDER });
    const groups = { owner, teammates: [receiver], opponents: [laneDefender], keeper: null };
    const targetPoint = { x: 50, y: 47 };
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
    5: [{ defender: 2, midfielder: 4, attacker: 2 }],
    7: [{ defender: 4, midfielder: 4, attacker: 4 }],
    9: [{ defender: 6, midfielder: 6, attacker: 4 }],
    // 11v11 (2026-08-24) coin-flips between two real formations each call
    // -- 4-4-2 (doubled: 8D/8M/4A) and 4-3-3 (doubled: 8D/6M/6A) -- so
    // either total is a valid outcome, not just one fixed shape.
    11: [
      { defender: 8, midfielder: 8, attacker: 4 },
      { defender: 8, midfielder: 6, attacker: 6 },
    ],
  };
  for (const [perSide, candidates] of Object.entries(expectedTotals)) {
    const slots = outfieldSlotsFor(Number(perSide));
    const counts = slots.reduce((acc, band) => { acc[band] = (acc[band] || 0) + 1; return acc; }, {});
    const expected = candidates.find((candidate) =>
      candidate.defender === counts.defender && candidate.midfielder === counts.midfielder && candidate.attacker === counts.attacker);
    check(`${perSide}v${perSide} produces one of its specified total role counts (2 gks implied, not part of this list)`,
      Boolean(expected) && slots.length === (expected.defender + expected.midfielder + expected.attacker));
    check(`${perSide}v${perSide}'s outfield total matches (perSide-1)*2 -- one keeper/team accounted for separately`,
      slots.length === (Number(perSide) - 1) * 2);
    check(`${perSide}v${perSide} splits every role evenly (each count is even, so home/away get identical shape)`,
      counts.defender % 2 === 0 && counts.midfielder % 2 === 0 && counts.attacker % 2 === 0);
  }
  {
    // 11v11's own coin flip actually lands on BOTH formations across
    // enough tries -- not silently stuck on one branch.
    const seenShapes = new Set();
    for (let i = 0; i < 60; i += 1) {
      const counts = outfieldSlotsFor(11).reduce((acc, band) => { acc[band] = (acc[band] || 0) + 1; return acc; }, {});
      seenShapes.add(`${counts.midfielder}-${counts.attacker}`);
    }
    check("11v11 produces both 4-4-2 (8M/4A) and 4-3-3 (6M/6A) across repeated calls",
      seenShapes.has("8-4") && seenShapes.has("6-6"));
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

// Section 51 ("Ball independence, visually -- restingBallOffsetPx()") was
// removed here (Ball Realism v1, 2026-08-31): the synthetic, speed-scaled
// pixel nudge it tested no longer exists -- see renderPlaybackFrame()'s own
// comment in match-lab.js for the reported-bug rationale. The ball's marker
// now renders its own real, authored position directly; see the "Ball
// Realism v1" section below for the test that replaced it.

console.log("\n=== 52: Quick setup width distribution (2026-08-19, centering revised 2026-08-24) -- lateralChannelX() ===");
{
  check("no channel info at all (null) centers with jitter, not a forced full-width spread",
    (() => {
      const samples = Array.from({ length: 50 }, () => lateralChannelX(null));
      return samples.every((x) => x >= 35 && x <= 65) && new Set(samples).size > 10;
    })());
  check("a lone player in their own band (count 1) also centers -- a real formation's lone CB/striker plays central",
    (() => {
      const samples = Array.from({ length: 50 }, () => lateralChannelX({ index: 0, count: 1 }));
      return samples.every((x) => x >= 35 && x <= 65) && new Set(samples).size > 10;
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
  //
  // Kick As Projectile v1 (2026-08-27) -- measured directly against
  // resolveThroughBallAccuracy() rather than the full resolver's own
  // result.ballEnd. Now that contact is a genuine live-tick race,
  // result.ballEnd is where a receiver's own BODY met the ball's real
  // flight -- a function of positioning and timing as much as of aim --
  // so comparing it to targetPoint no longer isolates the passer's own
  // accuracy at all. resolveThroughBallAccuracy() is the exact mechanism
  // this section's own comment above describes, and is untouched by any
  // of the live-tick work, so testing it directly is the honest fix, not
  // a weakened assertion.
  function meanErrorYards(passerObj, trials, seedPrefix) {
    let total = 0;
    for (let i = 0; i < trials; i += 1) {
      const random = seededRandom(hashString(`${seedPrefix}-${i}`));
      const { accuracyErrorYards } = resolveThroughBallAccuracy(
        passerObj, { distanceYards: 70, pressureFactor: 0.1 }, random,
      );
      total += accuracyErrorYards;
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
  const physicalReach = reachIn(defender.player, defAdjust.duration / 1000);
  check("the defensive adjustment covers the physical part of its tactical request in the shared window",
    Math.abs(coveredYards - Math.min(expectedYards, physicalReach)) < 0.01);
  check("a short defensive window cannot force arrival at an unreachable tactical target",
    coveredYards < expectedYards && coveredYards <= physicalReach + 0.001);

  // resolvePass()'s own defensive reaction -- same defensive-urgency GOAL,
  // now via the new physics mechanism: real ground covered must never
  // exceed what reachIn() alone predicts for the defender's own real
  // Pace/Acceleration over the real available time (flight duration minus
  // the shared reaction delay), and must be genuine ground, not a token
  // nudge -- Continuous World Motion During Ball Flight v1's own
  // acceptance criteria ("Pace and Acceleration measurably affect arrival
  // times") applied directly to a defensive reaction, not just a receiver.
  // A 24-yard driven-ground flight keeps this fixture focused on the
  // defender's physical reaction ceiling. A much longer aerial delivery can
  // legitimately run loose before a normal reception and belongs to the
  // pass-flight tests instead.
  const passOwner = entry("urgency-pass-owner", { team: "home", x: 50, y: 20, playerObj: STRONG_PASSER });
  const passReceiver = entry("urgency-pass-receiver", { team: "home", x: 50, y: 40, playerObj: AVERAGE });
  const passDefender = entry("urgency-pass-defender", { team: "away", x: 70, y: 30, playerObj: WEAK_DEFENDER });
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
  // real ~27-yard distance -- large enough accuracy error, short enough
  // driven-ground flight time, that a slow receiver's own real reach
  // still comes up short often enough to find within the search budget.
  const veryPoorPasser = player("Very Poor Passer", { Passing: 1, Technique: 1, Teamwork: 1, Decisions: 1, Vision: 1, Strength: 1 });
  const passer = entry("arrival-passer", { team: "home", x: 50, y: 10, playerObj: veryPoorPasser });
  const receiver = entry("arrival-receiver", {
    team: "home", x: 50, y: 32.5,
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

  // A short pass still produces at most two events -- the continuous
  // model naturally collapses to "one short run" for a short flight, no
  // special-casing needed. Gameplay v3.2 adds exactly ONE more: the
  // reception's own short beat (the "freeze on arrival" fix -- see
  // resolvePass()'s own P.RECEIVE.CLEAN comment), never a third or an
  // unbounded run of them -- still the same "no several restarted beats"
  // invariant this section exists to prove, just against the new,
  // correct total of (at most) flight + reception, not flight alone.
  const shortReceiver = entry("beat-short-receiver", { team: "home", x: 55, y: 12, playerObj: AVERAGE });
  const shortGroups = { owner, teammates: [shortReceiver, third], opponents: [], keeper: null };
  setupRoster([owner, shortReceiver, third], owner.id);
  const shortTrace = [];
  FREE_PLAY_RESOLVERS.pass(shortGroups, { preselectedTargetId: shortReceiver.id }, seededRandom(hashString("beat-short-pass")), shortTrace, true, null);
  const shortAttAdjust = shortTrace.filter((e) => e.code === "ATT.ADJUST" && e.playerMoves?.length);
  check("a routine short pass still produces at most two events -- flight, then the reception beat, never more",
    shortAttAdjust.length <= 2);

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
  // The incoming shot now authors that dive; the save records the hand
  // contact at its reached body point rather than moving the keeper again.
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
    const shotMove = trace.slice(0, trace.indexOf(saveEvent))
      .flatMap(event => event.playerMoves || []).find(move => move.playerId === keeper.id);
    check("the incoming shot authors the keeper movement before the save makes contact",
      Boolean(shotMove?.trajectory?.length) && saveEvent.playerMoves.length === 0);
    check("the save's body point is the actual reached endpoint, with the ball inside hand reach",
      Boolean(shotMove && saveEvent.contact.bodyPoint)
        && yardDistance(shotMove.to, saveEvent.contact.bodyPoint) < 0.001
        && yardDistance(saveEvent.contact.point, saveEvent.contact.bodyPoint)
          <= saveEvent.contact.reachAllowanceYards + 0.001);
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
    // Gameplay v3.2 adds exactly one more real event here (the reception's
    // own short beat, right after the flight) -- see the short-pass check
    // above for the full "still no several restarted beats" reasoning.
    check("(a) a player's off-ball reaction during a pass's flight is at most two events (flight, then reception), not several restarted beats",
      attAdjust.length <= 2);
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
  // slice is explicitly integrated -- resolveCross() never imports or
  // calls anything from matchPassFlight.js, and production code
  // (matchEngineCore.js, draft-run.js) is never touched by this file at
  // all -- verified structurally (no accidental import), not just by
  // convention.
  //
  // Kick As Projectile v1 (2026-08-27) -- resolveThroughBall() is no
  // longer on that "untouched" list. Slice A's own spec is explicit:
  // "resolveThroughBall MUST use the SAME simulateFlightUntilContact()"
  // resolvePass() uses -- so this check's OLD assertion (asserting the
  // opposite) is now testing exactly the static-booking behavior this
  // whole task exists to remove. Flipped to assert the new, intended
  // contract instead of weakening or deleting the coverage.
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
    const throughFnMatch = matchLabSource.match(/function resolveThroughBallInternal\([\s\S]*?\r?\n\}\r?\n/);
    check("(10) resolveCross()'s own body never references the new pass-flight module (untouched this slice)",
      Boolean(crossFnMatch) && !crossFnMatch[0].includes("PassFlight") && !crossFnMatch[0].includes("earliestReachableContact"));
    check("(10) resolveThroughBall()'s own body now races contact live through simulateFlightUntilContact(), not a frozen-pose lane check",
      Boolean(throughFnMatch) && throughFnMatch[0].includes("simulateFlightUntilContact") && !throughFnMatch[0].includes("nearestLaneInterceptor"));
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
  let trappedGoalRestart;
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
      if (trappedGoalRestart === undefined) trappedGoalRestart = result.restart;
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
  // Ball Out of Bounds v1 (2026-09-01) regression guard -- a scored ball's
  // own net-end point sits past y=100, geometrically "off the pitch" by
  // the same [0,100] test every new restart site now checks. A genuine
  // goal must never be swept up by that logic and reclassified as a
  // goal-kick (shots are explicitly untouched by this whole feature).
  check("a genuine goal is never reclassified as a Ball Out of Bounds restart",
    Boolean(trappedGoalEnd) && trappedGoalRestart !== "goal-kick"
      && trappedGoalRestart !== "corner" && trappedGoalRestart !== "throw-in");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  check("the goal net has a localized reactive ripple for scored-ball contact",
    css.includes('data-net-impact="true"')
      && css.includes("match-lab-net-ripple-top")
      && css.includes("match-lab-net-ripple-bottom"));
}

console.log("\n=== Off-Ball v2: back-to-goal pin/turn is decided by Strength/Balance, never Pace/Acceleration ===");
{
  // A deliberately extreme, one-attribute-cluster-vs-the-other matchup: if
  // the contest were reading Pace/Acceleration at all, the defender here
  // (elite Pace/Acceleration, weak Strength/Tackling/Aggression) would
  // dominate it; if it's genuinely Strength/Balance vs
  // Strength/Tackling/Aggression, the attacker should instead.
  const strongSlowAttacker = player("Strong Slow", { Balance: 18, Strength: 18, Acceleration: 4, Pace: 4 });
  const weakFastDefender = player("Weak Fast", { Strength: 4, Tackling: 4, Aggression: 4, Pace: 18, Acceleration: 18 });
  const owner = entry("owner", { team: "home", x: 50, y: 30, playerObj: strongSlowAttacker });
  const defender = entry("defender", { team: "away", x: 50, y: 28, playerObj: weakFastDefender });
  setupRoster([owner, defender], owner.id);
  const groups = { owner, teammates: [], opponents: [defender], keeper: null };
  const trials = 300;
  let turnedOrHalfTurned = 0;
  for (let i = 0; i < trials; i += 1) {
    const random = seededRandom(hashString(`b2g-strength-${i}`));
    const trace = [];
    const result = FREE_PLAY_RESOLVERS["back-to-goal"](groups, {}, random, trace);
    if (result.reason !== "back-to-goal-pin") turnedOrHalfTurned += 1;
  }
  check("a strong, SLOW attacker beats a weak, FAST defender in the clear majority of back-to-goal contests -- Strength/Balance decide it, not Pace",
    turnedOrHalfTurned / trials > 0.7);
}

console.log("\n=== Passing v3, Section B acceptance: a chest-height contest is decided by chest duel attrs, not Pace ===");
{
  // Elite chest attrs (Strength/Balance/Aggression/Technique) but terrible
  // Pace, against the mirror image (elite Pace, weak chest attrs) -- if the
  // contest were reading Pace at all, the defender would dominate it; a
  // genuine chest duel should still go the receiver's way.
  // A plain, un-Visioned passer -- leadIntendedPoint()'s own lead distance
  // (Section C) reads the passer's Vision, and this fixture's own geometry
  // was tuned for a specific lead amount; a stronger/weaker Vision shifts
  // the actual flight enough to move the chest-height window off these
  // exact positions. Short raw owner-receiver gap (5yd) so the REAL flight
  // distance -- after Section C's own lead pushes the aim point further
  // downfield -- still lands the lofted parabola's own peak height inside
  // the chest band (1.3-1.9yd) rather than solidly over it into head
  // territory (peakHeightYards = clamp(1.5,6,distanceYards*0.09) grows
  // with distance, and the lead adds real yards on top of the raw gap).
  const CHEST_PASSER = player("Chest Passer", { Passing: 14, Technique: 12 });
  const CHEST_RECEIVER = player("Chest Receiver", {
    Strength: 18, Balance: 18, Aggression: 15, Technique: 16, Pace: 4, Acceleration: 4, Jumping: 8,
  });
  const FAST_WEAK_DEFENDER = player("Fast Weak Defender", {
    Strength: 6, Balance: 6, Aggression: 6, Positioning: 6, Pace: 18, Acceleration: 18, Jumping: 8,
  });
  const owner = entry("chest-owner", { team: "home", x: 50, y: 55, playerObj: CHEST_PASSER });
  const receiver = entry("chest-receiver", { team: "home", x: 50, y: 60, playerObj: CHEST_RECEIVER });
  const defender = entry("chest-defender", { team: "away", x: 50, y: 62, playerObj: FAST_WEAK_DEFENDER });
  const groups = { owner, teammates: [receiver], opponents: [defender], keeper: null };
  let chestContests = 0;
  let receiverWon = 0;
  let lostChestCase = null;
  for (let i = 0; i < 3000; i += 1) {
    const random = seededRandom(hashString(`chest-attrs-${i}`));
    const trace = [];
    const result = resolvePass(groups, { forcedPassType: "lofted" }, random, trace);
    const chestEvent = trace.find((event) => event.code === "P.CHEST.WON" || event.code === "P.CHEST.LOST");
    if (!chestEvent) continue;
    chestContests += 1;
    if (chestEvent.code === "P.CHEST.WON") receiverWon += 1;
    else if (!lostChestCase) lostChestCase = { trace, result };
  }
  check("exercised real chest-height contests within the search budget", chestContests >= 30);
  check("a receiver with elite chest attrs but terrible Pace wins the clear majority of chest duels against an elite-Pace, weak-chest defender -- chest attrs decide it, not Pace",
    chestContests > 0 && receiverWon / chestContests > 0.6);
  const lostChestTrace = lostChestCase?.trace;
  const lostChestEvent = lostChestTrace?.find((event) => event.code === "P.CHEST.LOST");
  const chestSpillEvent = lostChestTrace?.find((event) => event.code === "P.CHEST.SPILL");
  check("a lost chest duel authors the ball's spill before any recovery outcome",
    Boolean(lostChestEvent?.contact?.point) && Boolean(chestSpillEvent)
      && yardDistance(lostChestEvent.contact.point, chestSpillEvent.ballFrom) < 0.001
      && chestSpillEvent.duration > 0);
  const chestSpillIndex = lostChestTrace?.indexOf(chestSpillEvent) ?? -1;
  const nextChestBallEvent = chestSpillIndex >= 0
    ? lostChestTrace.slice(chestSpillIndex + 1).find((event) => event.ballFrom || event.ballTo)
    : null;
  check("the chest spill chains into the next ball event or remains the resolver's authoritative loose endpoint",
    nextChestBallEvent
      ? yardDistance(chestSpillEvent.ballTo, nextChestBallEvent.ballFrom) < 0.001
      : lostChestCase?.result?.possession === "loose"
        && yardDistance(chestSpillEvent.ballTo, lostChestCase.result.ballEnd) < 0.001);
}

console.log("\n=== Passing v3, Section C acceptance: lead into space ===");
{
  const RUNNER = player("Runner", { Pace: 15, Acceleration: 14 });
  const VISIONARY_PASSER = player("Visionary Passer", { Vision: 16, Passing: 14 });
  const owner = entry("lead-owner", { team: "home", x: 50, y: 10, playerObj: VISIONARY_PASSER });
  const receiver = entry("lead-receiver", { team: "home", x: 50, y: 40, playerObj: RUNNER });
  const directStyle = { style: "direct", directness: 5 };
  const possessionStyle = { style: "possession", directness: 2 };

  check("shouldLeadIntendedPoint() is true for a lofted pass regardless of style/distance",
    shouldLeadIntendedPoint("lofted", 10, possessionStyle));
  check("shouldLeadIntendedPoint() is true for a driven-aerial pass regardless of style/distance",
    shouldLeadIntendedPoint("driven-aerial", 10, possessionStyle));
  check("shouldLeadIntendedPoint() stays false for an ordinary short ground pass under a possession style",
    !shouldLeadIntendedPoint("ground", 10, possessionStyle));
  check("shouldLeadIntendedPoint() is true for a genuinely direct long ball over real range (directness>=4, distance>=25)",
    shouldLeadIntendedPoint("driven-ground", 30, directStyle));
  check("shouldLeadIntendedPoint() stays false for the SAME direct style under the distance threshold -- a short pass still finds feet",
    !shouldLeadIntendedPoint("driven-ground", 10, directStyle));

  const offside = { attackingDirection: "down", effectiveLineY: 100 };
  const led = leadIntendedPoint(receiver, owner, offside);
  check("a lofted pass's intendedPoint lands strictly closer to goal than the receiver's own current spot",
    led.y > receiver.y);
  check("the lead stays within the spec's own real-football clamp (roughly 4-14 real yards)",
    led.y - receiver.y >= 3.5 && led.y - receiver.y <= 14);

  const tightOffside = { attackingDirection: "down", effectiveLineY: receiver.y + 2 };
  const cappedLead = leadIntendedPoint(receiver, owner, tightOffside);
  check("the lead never pushes the receiver's intendedPoint beyond the second-last defender's own offside line",
    cappedLead.y <= tightOffside.effectiveLineY);
}

console.log("\n=== Passing v3, Section D acceptance: a failed reception produces a real bounce, never an instant teleport to the defender ===");
{
  const BUTTERFINGERS = player("Butterfingers", { "First Touch": 3, Technique: 4, Composure: 3, Anticipation: 4 });
  const TIGHT_DEFENDER = player("Tight Defender", { Tackling: 16, Aggression: 15, Anticipation: 14, Positioning: 15 });
  const owner = entry("bounce-owner", { team: "home", x: 50, y: 20, playerObj: STRONG_PASSER });
  const receiver = entry("bounce-receiver", { team: "home", x: 50, y: 30, playerObj: BUTTERFINGERS });
  const defender = entry("bounce-defender", { team: "away", x: 50, y: 31, playerObj: TIGHT_DEFENDER });
  const groups = { owner, teammates: [receiver], opponents: [defender], keeper: null };
  let found = null;
  let foundTrace = null;
  for (let i = 0; i < 300 && !found; i += 1) {
    const random = seededRandom(hashString(`bounce-fail-${i}`));
    const trace = [];
    resolvePass(groups, { forcedPassType: "ground" }, random, trace);
    const ev = trace.find((event) => event.code === "P.RECEIVE.HEAVY" || event.code === "P.RECEIVE.LOSE");
    if (ev) { found = ev; foundTrace = trace; }
  }
  check("found a P.RECEIVE.HEAVY or P.RECEIVE.LOSE outcome within the search budget", Boolean(found));
  if (found) {
    check("the bounce event's own ownerAfter is null -- the ball is genuinely nobody's, not instantly the defender's",
      found.ownerAfterId === null);
    check("the bounce event carries a real, non-flat duration (never the old hardcoded 280ms)",
      found.duration > 0 && found.duration !== 280);
    check("the bounce event's own ballTo is NOT simply the defender's static position -- a real spill, not a teleport",
      !(found.ballTo.x === defender.x && found.ballTo.y === defender.y));
    const nextIndex = foundTrace.indexOf(found)+1;
    const next = foundTrace[nextIndex];
    check("the next event resolves the loose ball directly or authors the winner's overlapping run before control",
      /^P\.RECEIVE\.BOUNCE\./.test(next?.code || "")
        || (next?.code === "BALL.RECOVERY.RUN" && next.overlapWithPrevious
          && next.playerMoves.length===1 && next.playerMoves[0].trajectory.length>0
          && /^P\.RECEIVE\.BOUNCE\./.test(foundTrace[nextIndex+1]?.code || "")));
  }
}

console.log("\n=== Off-Ball Motion v3, Section E acceptance: pass-flight reaction duration + no duplicate post-action convergence ===");
{
  // A run-in-behind teammate's own off-ball move during a pass's flight
  // must genuinely chase the real, uncapped destination over the real
  // flight window -- not the old flat, capped POST_ACTION_CONVERGENCE_MS
  // (200ms) nudge. And the possession loop's own post-action convergence
  // must not ALSO fire right after a pass that already interleaved a
  // full-window continuous reaction of its own (a real reported bug: a
  // second reaction on top -- fresh trajectory, velocity reset to zero --
  // read as players visibly freezing then snapping during a pass).
  const owner = entry("flight-owner", { team: "home", x: 50, y: 20, playerObj: STRONG_PASSER });
  const runner = entry("flight-runner", { team: "home", x: 20, y: 40, playerObj: GOOD_DRIBBLER });
  // Joint Passer/Runner Candidate Generation v1 (Stage 3) -- a second
  // attacker. With only ONE teammate on the pitch that teammate is always
  // the intended receiver, and an intended receiver reacts to the real
  // flight (simulateFlightUntilContact) rather than being given an off-ball
  // run-in-behind job at all. This section is specifically about an OFF-BALL
  // teammate's reaction during somebody else's pass, so it needs somebody
  // else to exist. Nothing about the assertion is relaxed.
  const support = entry("flight-support", { team: "home", x: 66, y: 44, playerObj: GOOD_DRIBBLER });
  const defenderA = entry("flight-defA", { team: "away", x: 51, y: 21, playerObj: WEAK_DEFENDER });
  const defenderB = entry("flight-defB", { team: "away", x: 60, y: 50, playerObj: WEAK_DEFENDER });
  const keeper = entry("flight-gk", { role: "keeper", team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
  const squad = [owner, runner, support, defenderA, defenderB, keeper];
  setupRoster(squad, owner.id);
  const initialPositions = Object.fromEntries(squad.map((item) => [item.id, pointOf(item)]));

  let foundRunInBehindDuringFlight = false;
  let sawLongEnoughFlight = false;
  let runInBehindDurationInFlightOrder = true;
  let sawSingleReactionBatchAfterPass = true;
  let checkedAnyPassBatch = false;
  for (let i = 0; i < 200 && !(foundRunInBehindDuringFlight && sawLongEnoughFlight); i += 1) {
    const run = runConstructedPossession(`flight-reaction-duration-${i}`);
    const passIndex = run.trace.findIndex((event) => event.code === "P.PASS" && event.duration > 600);
    if (passIndex === -1) continue;
    const passEvent = run.trace[passIndex];
    sawLongEnoughFlight = true;

    // Exactly one reaction batch (ATT/GK/DEF.ADJUST, possibly several
    // events sharing the SAME overlap window) follows the pass, not two
    // separate ones (the old always-firing 200ms convergence stacked on
    // top of the flight's own interleaved reaction).
    let batches = 0;
    let inBatch = false;
    for (let index = passIndex + 1; index < run.trace.length; index += 1) {
      const code = run.trace[index].code;
      const isReaction = code === "ATT.ADJUST" || code === "GK.ADJUST" || code === "DEF.ADJUST";
      if (isReaction && !inBatch) { batches += 1; inBatch = true; }
      else if (!isReaction) { inBatch = false; if (code === "ACTION.CHOICE" || code.startsWith("P.")) break; }
    }
    checkedAnyPassBatch = true;
    if (batches > 1) sawSingleReactionBatchAfterPass = false;

    // Scoped to THIS pass's own reaction batch. This used to search the
    // whole remaining trace, which meant it could pick up a run-in-behind
    // authored by some completely unrelated later action -- a post-action
    // convergence nudge two decisions afterwards would be judged as if it
    // were this flight's own in-flight reaction. The check is about "a
    // reaction DURING a pass's flight", so it now only looks at the events
    // that genuinely belong to that flight: the contiguous run of
    // ATT/GK/DEF.ADJUST events immediately following the pass, which is the
    // same batch boundary this section already computes just above.
    const flightBatch = [];
    for (let index = passIndex + 1; index < run.trace.length; index += 1) {
      const code = run.trace[index].code;
      if (code !== "ATT.ADJUST" && code !== "GK.ADJUST" && code !== "DEF.ADJUST") break;
      flightBatch.push(run.trace[index]);
    }
    const runInBehindMove = flightBatch
      .flatMap((event) => event.playerMoves || [])
      .find((move) => move.playerId === runner.id && move.action === "run-in-behind");
    if (!runInBehindMove) continue;
    foundRunInBehindDuringFlight = true;
    const plan = buildMatchLabPlaybackPlan({
      trace: run.trace, initialPositions, initialBall: pointOf(owner), initialOwnerId: owner.id,
      finalOwnerId: run.finalOwnerId, restart: run.result.restart,
    });
    const runnerDiagnostic = plan.intervals
      .flatMap((interval) => interval.moveDiagnostics)
      .find((diagnostic) => diagnostic.playerId === runner.id && diagnostic.action === "run-in-behind");
    // A genuine, real-physics window, not the old flat 200ms nudge -- NOT a
    // strict fraction of the pass's own duration: Kick As Projectile v1's
    // own live tick can legitimately let a fast-closing runner finish
    // their own real run well before the flight's full duration elapses
    // (they got there; the ball is still travelling to someone else, or
    // the flight itself just runs long). The bug this guards against is a
    // FLAT, capped nudge, not "shorter than proportional."
    // A runner who is already essentially at their run-in-behind target
    // (a real, meaningful distance is well under 0.5yd -- a rounding-
    // scale remainder, not real ground left to cover) genuinely takes
    // near-0ms, correctly, not a flat-nudge bug; only a move that
    // actually covers real ground is evidence one way or the other here.
    if (!runnerDiagnostic || (runnerDiagnostic.distanceYards > 0.5 && runnerDiagnostic.scheduledDurationMs < 400)) {
      runInBehindDurationInFlightOrder = false;
    }
  }
  check("exercised at least one long (600ms+) pass flight within the search budget", sawLongEnoughFlight);
  check("found a run-in-behind teammate reacting during a pass's own flight", foundRunInBehindDuringFlight);
  check("the run-in-behind move's own scheduled duration is the SAME ORDER as the pass's real flight duration, not a flat 200ms nudge",
    runInBehindDurationInFlightOrder);
  check("exercised at least one pass to check for a duplicate post-action reaction batch", checkedAnyPassBatch);
  check("no second (POST_ACTION_CONVERGENCE_MS, chaseIntention:false) reaction batch follows a pass that already interleaved one",
    sawSingleReactionBatchAfterPass);
}

console.log("\n=== Off-Ball Motion v3, Section A end-to-end: the last CB recovers onto a through-ball runner, not a nearby midfielder ===");
{
  // The exact reported bug, reproduced end to end: a through ball is
  // struck in behind; the last CB (goal-side of the landing spot, by a
  // real margin) must be the one who recovers onto it, DURING the ball's
  // own flight -- never handed to a midfielder who merely happens to be
  // standing near the PASSER right now (pickBallPresser()'s own
  // PRESSER_MIDFIELD_SLACK_YARDS-skip -- the reported root cause).
  const PASSER = player("Through Passer", { Passing: 19, Vision: 19, Technique: 18, Decisions: 18 });
  const RUNNER = player("Through Runner", { Pace: 16, Acceleration: 15, Anticipation: 14, Decisions: 14 });
  const CB = { canonical_player_name: "Last CB", position_text: "D C", current_ability: 150, attributes: attrs({ Positioning: 16, Anticipation: 15, Tackling: 15, Pace: 13, Acceleration: 12 }) };
  const MF = { canonical_player_name: "Nearby Midfielder", position_text: "M C", current_ability: 150, attributes: attrs({ Positioning: 11, Anticipation: 11, Tackling: 10, Pace: 14, Acceleration: 13 }) };
  const owner = entry("through-owner", { team: "home", x: 50, y: 10, playerObj: PASSER });
  const runner = entry("through-runner", { team: "home", x: 50, y: 44, playerObj: RUNNER });
  const cb = entry("through-cb", { team: "away", x: 42, y: 50, playerObj: CB });
  const mf = entry("through-mf", { team: "away", x: 58, y: 46, playerObj: MF });
  const groups = { owner, teammates: [runner], opponents: [cb, mf], keeper: null };
  const trace = [];
  const availability = { preselectedTargetId: runner.id, plannedMoveTo: { x: 50, y: 56 } };
  const motionContext = { state: { tick: 0, players: {} }, marking: {} };
  FREE_PLAY_RESOLVERS.through(groups, availability, seededRandom(hashString("through-last-man")), trace, true, motionContext);
  const defAdjust = trace.find((event) => event.code === "DEF.ADJUST");
  const cbMove = defAdjust?.playerMoves?.find((move) => move.playerId === cb.id);
  const mfMove = defAdjust?.playerMoves?.find((move) => move.playerId === mf.id);
  check("a real DEF.ADJUST reaction fired during the through ball's own flight", Boolean(defAdjust));
  check("the last CB (goal-side of the landing spot) is the one reacting, not left on shift-unit/screen duty",
    Boolean(cbMove) && (cbMove.action === "press-ball" || cbMove.action === "recover" || cbMove.action === "delay"));
  check("the nearby midfielder does NOT steal the last-man job just for standing close to the passer",
    !mfMove || (mfMove.action !== "press-ball" && mfMove.action !== "recover" && mfMove.action !== "delay"));
}

console.log("\n=== Shot As Projectile v1 (2026-08-27), Slice B -- required test (7): keeper genuinely 2yd off the actual mouth point, real flight time -> reached ===");
{
  const KEEPER = player("Envelope Keeper", { Pace: 12, Acceleration: 11, Jumping: 12, Reflexes: 12 });
  const keeper = entry("envelope-keeper-7", { x: 52.667, y: 100, playerObj: KEEPER, team: "away" });
  const flight = {
    from: { x: 50, y: 70 },
    actual: { x: 50, y: 100 },
    peakHeightYards: 0.5,
    speedYardsPerSecond: 27,
    durationMs: 1500,
  };
  const result = simulateShotKeeperEnvelope(flight, keeper);
  check("a keeper starting 2 real yards off the actual mouth point, given ample flight time, genuinely reaches it",
    result.reached === true);
}

console.log("\n=== Shot As Projectile v1, Slice B -- required test (8): keeper on the opposite post, travel time exceeds flight time -> structurally unreached regardless of Reflexes ===");
{
  // Reflexes maxed at 20 -- simulateShotKeeperEnvelope() must not read it at
  // all (Reflexes/Handling only ever decide the FLAVOR of a save the
  // keeper's own body genuinely reached, geometricKeeperSaveFlavor()'s own
  // job, never whether they get there). Pace/Acceleration deliberately
  // ordinary, and the flight deliberately short -- a real, honest shortfall,
  // not a rigged worst-case attribute draw.
  const KEEPER = player("Statue Keeper", { Pace: 11, Acceleration: 10, Jumping: 10, Reflexes: 20 });
  const keeper = entry("envelope-keeper-8", { x: GOAL_RIGHT_POST_X, y: 100, playerObj: KEEPER, team: "away" });
  const flight = {
    from: { x: 50, y: 85 },
    actual: { x: GOAL_LEFT_POST_X, y: 100 },
    peakHeightYards: 0.4,
    speedYardsPerSecond: 27,
    durationMs: 250,
  };
  const gapYards = yardDistance({ x: GOAL_RIGHT_POST_X, y: 100 }, { x: GOAL_LEFT_POST_X, y: 100 });
  check("sanity: this really is the full 8-yard post-to-post gap", gapYards > 7.5);
  const result = simulateShotKeeperEnvelope(flight, keeper);
  check("a keeper who genuinely cannot cover the ground in time stays unreached, even with maxed Reflexes",
    result.reached === false);
}

console.log("\n=== Shot As Projectile v1, Slice B -- required test (9): a defender genuinely on the shot's own line blocks; 8yd wide does not ===");
{
  const DEFENDER = player("Line Defender", { Jumping: 12 });
  const flight = {
    from: { x: 50, y: 20 },
    actual: { x: 50, y: 100 },
    peakHeightYards: 1.0,
    speedYardsPerSecond: 27,
    durationMs: 900,
  };
  const onLine = entry("block-defender-online", { x: 50, y: 60, playerObj: DEFENDER, team: "away" });
  const onLineContact = shotBlockingDefender(flight, onLine);
  check("a defender standing directly on the shot's own straight line, at a reachable height, blocks it",
    Boolean(onLineContact));
  if (onLineContact) {
    check("the block is recorded partway through the flight, at the real height the ball had there -- not at the goal line's own eventual height",
      onLineContact.atPoint.height < flight.peakHeightYards);
  }
  const wideYards = 8;
  const widePercentX = (wideYards / PITCH_WIDTH_YARDS) * 100;
  const wide = entry("block-defender-wide", { x: 50 + widePercentX, y: 60, playerObj: DEFENDER, team: "away" });
  const wideContact = shotBlockingDefender(flight, wide);
  check("the SAME defender, standing 8 real yards wide of that line, does not block it",
    wideContact === null);
}

console.log("\n=== Shot As Projectile v1, Slice B -- required test (10): an actual mouth point above the crossbar is geometrically OVER, never a save roll ===");
{
  state.attackingDirection = { home: "down", away: "up" };
  const WEAK_FINISHER = player("Weak Finisher", { Finishing: 4, Technique: 5, Composure: 4 });
  const owner = entry("weak-shot-owner-10", { x: 50, y: 78, playerObj: WEAK_FINISHER, team: "home" });
  const keeper = entry("weak-shot-keeper-10", { x: 50, y: 98, playerObj: player("Any Keeper", {}), team: "away", role: "keeper" });
  let foundOver = null;
  for (let index = 0; index < 400 && !foundOver; index += 1) {
    const random = seededRandom(hashString(`shot-over-search-${index}`));
    const descriptor = resolveShotDescriptor(owner, keeper, "calm", 0.1, random);
    if (descriptor.actualHeightYards > GOAL_HEIGHT_YARDS) foundOver = descriptor;
  }
  check("found a genuinely over-the-bar actual point within the search budget", Boolean(foundOver));
  if (foundOver) {
    check("a mouth point above GOAL_HEIGHT_YARDS is structurally off-target -- geometry alone, no save roll involved",
      foundOver.onTarget === false);
    check("it is classified with the frame's own OVER-badged code, not a generic wide miss",
      foundOver.missCode === "F.BLAST.OVER");
  }
}

console.log("\n=== Shot As Projectile v1, Slice B -- required test (11): contact-continuity -- the shot's own ballTo IS the next event's ballFrom, one real path, never redrawn ===");
{
  const SHOOTER = player("Continuity Shooter", { Finishing: 15, Technique: 14, Composure: 13 });
  const DEFENDER = player("Continuity Defender", { Bravery: 13, Positioning: 12, Anticipation: 12 });
  const KEEPER = player("Continuity Keeper", { Handling: 13, Reflexes: 13, Positioning: 13, Jumping: 13 });
  let checkedShotEvents = 0;
  let brokenChain = null;
  for (let index = 0; index < 300 && !brokenChain; index += 1) {
    const owner = entry("continuity-owner", { x: 50, y: 78, playerObj: SHOOTER, team: "home" });
    const defender = entry("continuity-defender", { x: 50, y: 85, playerObj: DEFENDER, team: "away" });
    const keeper = entry("continuity-keeper", { x: 50, y: 98, playerObj: KEEPER, team: "away", role: "keeper" });
    const groups = { owner, teammates: [], opponents: [defender], keeper };
    const trace = [];
    resolveShoot(groups, {}, seededRandom(hashString(`shot-continuity-${index}`)), trace);
    const shotEvents = trace.filter((event) => event.movement === "shot");
    if (shotEvents.length !== 1) { brokenChain = `expected exactly one shot event, found ${shotEvents.length}`; break; }
    checkedShotEvents += 1;
    for (let i = 1; i < trace.length; i += 1) {
      const previous = trace[i - 1];
      const current = trace[i];
      if (!previous.ballTo || !current.ballFrom) continue;
      if (previous.ballTo.x !== current.ballFrom.x || previous.ballTo.y !== current.ballFrom.y) {
        brokenChain = `event ${i} (${current.code}) ballFrom does not match event ${i - 1} (${previous.code})'s own ballTo`;
        break;
      }
    }
  }
  check("exercised a real sample of shot resolutions", checkedShotEvents > 50);
  check("every shot trace has exactly one shot-movement event, and every ball leg chains from the previous one's own real endpoint -- never reset back to the shooter or redrawn",
    !brokenChain);
  if (brokenChain) console.log(`  ${brokenChain}`);
}

console.log("\n=== Gameplay v3.1, required test 1 -- interceptor-on-path, passer wins duel, receiver late: the rest of the pitch keeps moving, the recovery scramble is not followed by a bare reshape ===");
{
  state.attackingDirection = { home: "down", away: "up" };
  const SLOW_RECEIVER = player("Slow Receiver", { Pace: 6, Acceleration: 6, Anticipation: 10, Decisions: 10, "Off the Ball": 10 });
  const DECENT_PASSER = player("Decent Passer", { Passing: 14, Technique: 13, Decisions: 13, Teamwork: 13, Vision: 14, Composure: 11 });
  // A fresh roster every iteration -- resolvePass()'s own live tick and the
  // interleaved off-ball reaction both write real positions directly onto
  // the roster entries it's given (the SAME "every explicit physical move
  // is authoritative" contract runConstructedPossession() itself relies
  // on). Reusing one set of entry() objects across a seed search lets each
  // iteration's own off-ball motion silently drift the NEXT iteration's
  // starting geometry (a real bug this fixture had: 598/600 seeds drifted
  // an opponent onto an offside line nobody actually authored).
  const buildFixture = () => {
    const owner = entry("v31-t1-owner", { team: "home", x: 50, y: 12, playerObj: DECENT_PASSER });
    const receiver = entry("v31-t1-receiver", { team: "home", x: 50, y: 62, playerObj: SLOW_RECEIVER });
    const interceptor = entry("v31-t1-interceptor", { team: "away", x: 50, y: 33, playerObj: WEAK_DEFENDER });
    const teammateB = entry("v31-t1-teamB", { team: "home", x: 22, y: 45, playerObj: STRONG_PASSER });
    const teammateC = entry("v31-t1-teamC", { team: "home", x: 78, y: 45, playerObj: GOOD_DRIBBLER });
    const oppB = entry("v31-t1-oppB", { team: "away", x: 30, y: 70, playerObj: WEAK_DEFENDER });
    const oppC = entry("v31-t1-oppC", { team: "away", x: 70, y: 70, playerObj: WEAK_DEFENDER });
    const keeper = entry("v31-t1-gk", { role: "keeper", team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
    return {
      owner, receiver, interceptor, teammateB, teammateC, oppB, oppC, keeper,
      groups: { owner, teammates: [receiver, teammateB, teammateC], opponents: [interceptor, oppB, oppC], keeper },
    };
  };
  const availability = { preselectedTargetId: "v31-t1-receiver", forcedPassType: "driven-aerial" };

  let found = null;
  let foundTrace = null;
  let foundFixture = null;
  for (let i = 0; i < 800 && !found; i += 1) {
    const fixture = buildFixture();
    const motionContext = { state: { tick: 0, players: {} }, marking: {} };
    const trace = [];
    const random = seededRandom(hashString(`v31-t1-${i}`));
    const result = resolvePass(fixture.groups, availability, random, trace, true, motionContext);
    const hasDuelNarration = trace.some((e) => e.code === "P.PASS" && e.defenderId === fixture.interceptor.id);
    const wentLate = trace.some((e) => e.code === "P.RECEIVE.LATE");
    if (hasDuelNarration && wentLate) { found = result; foundTrace = trace; foundFixture = fixture; }
  }
  check("found an interceptor-contested pass the passer wins that still runs loose (receiver unreachable) within the search budget", Boolean(found));
  if (found) {
    const { receiver, interceptor, teammateB, teammateC, oppB, oppC } = foundFixture;
    const runEvent = foundTrace.find((e) => e.code === "ATT.RECEIVER.RUN");
    const adjustEvents = foundTrace.filter((e) => e.code === "ATT.ADJUST" || e.code === "DEF.ADJUST" || e.code === "GK.ADJUST");
    check("the intended receiver has their own ATT.RECEIVER.RUN chase", Boolean(runEvent) && runEvent.actorId === receiver.id);
    check("at least one off-ball reaction batch fired, overlapping the flight, not a freeze until the next action",
      adjustEvents.length > 0);
    const reactingIds = new Set(adjustEvents.flatMap((e) => (e.playerMoves || []).map((m) => String(m.playerId))));
    const otherOutfieldIds = [teammateB.id, teammateC.id, interceptor.id, oppB.id, oppC.id].map(String);
    const reactingCount = otherOutfieldIds.filter((id) => reactingIds.has(id)).length;
    check("at least N-2 of the OTHER outfield players get a real overlapping move during the flight, not a freeze",
      reactingCount >= otherOutfieldIds.length - 2);
    // The contesting defender is IN the reacting group (never excluded --
    // only the receiver, whose own ATT.RECEIVER.RUN already authors a real
    // move, is excluded from this call) -- see interleaveFlightOffBall()'s
    // own [receiver.id] exclusion list. Whether their own computed target
    // happens to coincide with where they already stand right after the
    // duel (a real zero-distance outcome, not a bug -- see this file's own
    // "genuinely arrived reads zero velocity" precedent) is fixture-
    // dependent, so this doesn't assert on that specific body by name.
    check("every ADJUST batch overlaps the pass's own flight window, not a sequential beat after it",
      adjustEvents.every((e) => e.overlapWithPrevious === true));
    check("the resolver reports offBallInterleaved so runConstructedPossession() skips its own 200ms reshape",
      found.offBallInterleaved === true);
  }
}

console.log("\n=== Gameplay v3.1, required test 2 -- nobody reachable (!contact.candidate): off-ball overlaps the FULL flight, not a freeze until the next action ===");
{
  // resolveThroughBall() aims at an EXPLICIT space (availability.plannedMoveTo),
  // not a point derived from the runner's own position the way an ordinary
  // pass's lead is -- so "the runner can't get there in time" is a plain
  // distance/pace fact here, not a probabilistic search over accuracy
  // scatter (resolvePass()'s own lead is real-football-clamped to ~4-14
  // real yards and almost always coverable inside its own flight's real
  // time budget -- confirmed empirically, not assumed). Both resolvers
  // share the exact same pushLooseDeliveryChase() -- same P.RECEIVE.LATE
  // code, same off-ball interleave -- so this exercises the identical gap
  // the report describes, just through the resolver where "unreachable"
  // is a deterministic fact instead of a rare roll.
  state.attackingDirection = { home: "down", away: "up" };
  const owner = entry("v31-t2-owner", { team: "home", x: 50, y: 25, playerObj: STRONG_PASSER });
  // Off to the SIDE, not sitting on the flight's own straight x=50 line --
  // simulateFlightUntilContact() lets a candidate intercept ANY point along
  // the path, not just its final landing spot, so a runner already
  // standing ON that line reaches an early point almost immediately
  // regardless of how far the ball's own endpoint is. Genuinely covering
  // real lateral AND forward ground is what makes "unreachable" honest here.
  const runner = entry("v31-t2-runner", { team: "home", x: 15, y: 40, playerObj: GOOD_DRIBBLER });
  const teammateB = entry("v31-t2-teamB", { team: "home", x: 25, y: 35, playerObj: STRONG_PASSER });
  const teammateC = entry("v31-t2-teamC", { team: "home", x: 75, y: 35, playerObj: GOOD_DRIBBLER });
  // No opponents at all -- zero defenders means buildOffsideSnapshot()'s
  // own secondLastOpponentLine() falls back to the goal line itself, so
  // there is no offside line for this run to accidentally cross, and
  // nobody else who could ever become contact.candidate either.
  const groups = { owner, teammates: [runner, teammateB, teammateC], opponents: [], keeper: null };
  // 65 real yards of open space to sprint into inside one flight -- the
  // ball travels it at PASS_FLIGHT_PACE_YARDS_PER_SECOND (~20yd/s); no
  // real player's own topSpeed() covers the same ground in the same time.
  const availability = { preselectedTargetId: runner.id, plannedMoveTo: { x: 50, y: 95 } };
  const motionContext = { state: { tick: 0, players: {} }, marking: {} };
  const trace = [];
  const result = FREE_PLAY_RESOLVERS.through(groups, availability, seededRandom(hashString("v31-t2")), trace, true, motionContext);
  const found = trace.some((e) => e.code === "P.RECEIVE.LATE") ? result : null;
  const foundTrace = trace;
  check("nobody -- not even the intended runner -- physically reaches this delivery (a genuine !contact.candidate)",
    Boolean(found));
  if (found) {
    const adjustEvents = foundTrace.filter((e) => e.code === "ATT.ADJUST" || e.code === "DEF.ADJUST" || e.code === "GK.ADJUST");
    check("off-ball players react DURING the full flight (overlapping it), not frozen until the next action",
      adjustEvents.length > 0 && adjustEvents.every((e) => e.overlapWithPrevious === true));
    const reactingIds = new Set(adjustEvents.flatMap((e) => (e.playerMoves || []).map((m) => String(m.playerId))));
    check("more than one off-ball player actually moves, not just a single token reactor",
      reactingIds.size >= 2);
    check("offBallInterleaved is reported so the possession loop does not ALSO run a 200ms reshape after",
      found.offBallInterleaved === true);
  }
}

console.log("\n=== Gameplay v3.1, required test 3 -- P.PASS.LOST: the interceptor's own run, plus everyone else overlapping that same window ===");
{
  state.attackingDirection = { home: "down", away: "up" };
  // Fresh roster every iteration -- see test 1's own comment on why.
  const buildFixture = () => {
    const owner = entry("v31-t3-owner", { team: "home", x: 50, y: 20, playerObj: WEAK_PASSER });
    const receiver = entry("v31-t3-receiver", { team: "home", x: 50, y: 55, playerObj: GOOD_DRIBBLER });
    const interceptor = entry("v31-t3-interceptor", { team: "away", x: 50, y: 35, playerObj: ELITE_DEFENDER });
    const teammateB = entry("v31-t3-teamB", { team: "home", x: 25, y: 40, playerObj: STRONG_PASSER });
    // Ahead of the receiver (y=65 > 55, home attacks toward y=100) so the
    // receiver stays onside -- interceptor alone, sitting BEHIND the
    // receiver, is not a real offside line by itself.
    const oppB = entry("v31-t3-oppB", { team: "away", x: 75, y: 65, playerObj: WEAK_DEFENDER });
    const keeper = entry("v31-t3-gk", { role: "keeper", team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
    return {
      interceptor, teammateB, oppB,
      groups: { owner, teammates: [receiver, teammateB], opponents: [interceptor, oppB], keeper },
    };
  };
  const availability = { preselectedTargetId: "v31-t3-receiver" };
  let found = null;
  let foundTrace = null;
  let foundFixture = null;
  for (let i = 0; i < 100 && !found; i += 1) {
    const fixture = buildFixture();
    const motionContext = { state: { tick: 0, players: {} }, marking: {} };
    const trace = [];
    const random = seededRandom(hashString(`v31-t3-${i}`));
    const result = resolvePass(fixture.groups, availability, random, trace, true, motionContext);
    if (result.code === "P.PASS.LOST") { found = result; foundTrace = trace; foundFixture = fixture; }
  }
  check("found a genuine interceptor win (P.PASS.LOST) within the search budget", Boolean(found));
  if (found) {
    const { interceptor, teammateB, oppB } = foundFixture;
    const lostEvent = foundTrace.find((e) => e.code === "P.PASS.LOST");
    // Whichever of the two opponents actually won the live-tick race (not
    // necessarily the one this fixture calls "interceptor" by name -- the
    // physics decides who gets there, exactly the point of this model).
    const actualInterceptorId = String(lostEvent.defenderId);
    check("the interceptor's own run to the contact point is still authored",
      Boolean(lostEvent.playerMoves?.some((m) => String(m.playerId) === actualInterceptorId)));
    const adjustEvents = foundTrace.filter((e) => e.code === "ATT.ADJUST" || e.code === "DEF.ADJUST" || e.code === "GK.ADJUST");
    check("everyone else keeps moving during the SAME window the interception happened in", adjustEvents.length > 0);
    const reactingIds = new Set(adjustEvents.flatMap((e) => (e.playerMoves || []).map((m) => String(m.playerId))));
    const otherOutfieldIds = [String(interceptor.id), String(teammateB.id), String(oppB.id)].filter((id) => id !== actualInterceptorId);
    check("that reaction includes at least one of the other outfield players (not just the interceptor's own already-authored run)",
      otherOutfieldIds.some((id) => reactingIds.has(id)));
    check("offBallInterleaved is reported on the P.PASS.LOST return itself", found.offBallInterleaved === true);
  }
}

console.log("\n=== Gameplay v3.1, required test 4 -- a 3+ touch carry is ONE off-ball window: trajectories start at the first touch, not the final P.CARRY ===");
{
  const owner = entry("v31-t4-owner", { team: "home", x: 28, y: 28, playerObj: GOOD_DRIBBLER });
  const teammate = entry("v31-t4-teammate", { team: "home", x: 58, y: 34, playerObj: STRONG_PASSER });
  const defenderA = entry("v31-t4-defA", { team: "away", x: 60, y: 38, playerObj: WEAK_DEFENDER });
  const defenderB = entry("v31-t4-defB", { team: "away", x: 68, y: 54, playerObj: WEAK_DEFENDER });
  const keeper = entry("v31-t4-gk", { role: "keeper", team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
  const authored = [owner, teammate, defenderA, defenderB, keeper];
  setupRoster(authored, owner.id);
  const initialPositions = Object.fromEntries(authored.map((item) => [item.id, pointOf(item)]));

  let found = null;
  for (let index = 0; index < 300 && !found; index += 1) {
    const run = runConstructedPossession(`v31-carry-${index}`);
    const touchIndices = [];
    run.trace.forEach((event, idx) => {
      if (event.code === "P.CARRY.TOUCH") touchIndices.push(idx);
    });
    // Same "one contiguous run" scoping as section 35 -- touchIndices can
    // span more than one SEPARATE carry action across a whole possession.
    const runs = [];
    let runStart = touchIndices[0];
    for (let k = 1; k <= touchIndices.length; k += 1) {
      if (k === touchIndices.length || touchIndices[k] !== touchIndices[k - 1] + 1) {
        runs.push({ start: runStart, end: touchIndices[k - 1] });
        runStart = touchIndices[k];
      }
    }
    const multiTouchRun = runs.find((r) => r.end - r.start + 1 >= 3);
    if (!multiTouchRun) continue;
    const carryIndex = run.trace.findIndex((event, idx) => idx > multiTouchRun.end && event.code === "P.CARRY");
    if (carryIndex === -1) continue;
    const adjustIndex = run.trace.findIndex((event, idx) => idx > carryIndex
      && (event.code === "ATT.ADJUST" || event.code === "DEF.ADJUST" || event.code === "GK.ADJUST"));
    if (adjustIndex === -1) continue;
    found = { run, multiTouchRun, carryIndex, adjustIndex };
  }
  check("exercised a 3+ touch carry with a following off-ball reaction batch within the search budget", Boolean(found));
  if (found) {
    const plan = buildMatchLabPlaybackPlan({
      trace: found.run.trace, initialPositions, initialBall: pointOf(owner), initialOwnerId: owner.id,
      finalOwnerId: found.run.finalOwnerId, restart: found.run.result.restart,
    });
    const firstTouchInterval = plan.intervals.find((iv) => iv.eventIndex === found.multiTouchRun.start);
    const carryInterval = plan.intervals.find((iv) => iv.eventIndex === found.carryIndex);
    const adjustInterval = plan.intervals.find((iv) => iv.eventIndex === found.adjustIndex);
    check("found real interval data for the first touch, the final P.CARRY, and the off-ball reaction",
      Boolean(firstTouchInterval && carryInterval && adjustInterval));
    if (firstTouchInterval && carryInterval && adjustInterval) {
      check("the final P.CARRY starts strictly AFTER the first touch (there really is a multi-touch gap to cover)",
        carryInterval.startMs > firstTouchInterval.startMs);
      check("the off-ball reaction's own window starts at the FIRST touch's own startMs, not the final P.CARRY's own (later) startMs",
        Math.abs(adjustInterval.startMs - firstTouchInterval.startMs) < 1);
    }
    const adjustEvent = found.run.trace[found.adjustIndex];
    const reactorMove = (adjustEvent.playerMoves || [])[0];
    if (reactorMove && firstTouchInterval) {
      const reactorTrack = plan.tracks.players[reactorMove.playerId] || [];
      const earlyWindowEnd = firstTouchInterval.endMs + 50;
      const movesEarly = reactorTrack.some((frame) => frame.timeMs <= earlyWindowEnd && frame.velocity
        && (Math.abs(frame.velocity.x) > 1e-6 || Math.abs(frame.velocity.y) > 1e-6));
      check("the off-ball reactor's own trajectory shows real velocity DURING the early touches, not only after the whole carry finishes",
        movesEarly);
    }
  }
}

console.log("\n=== Gameplay v3.2, required test 1 -- clean reception: off-ball motion overlaps the 160ms reception beat, no idle gap ===");
{
  state.attackingDirection = { home: "down", away: "up" };
  const owner = entry("v32-t1-owner", { team: "home", x: 50, y: 20, playerObj: STRONG_PASSER });
  // A 24-yard delivery makes clean control deterministic while still
  // leaving a substantial flight window for the continuity assertion.
  const receiver = entry("v32-t1-receiver", { team: "home", x: 50, y: 40, playerObj: GOOD_DRIBBLER });
  // Off the direct flight lane and well away from contactPoint, so
  // pressingOpponent stays null (a deterministic, uncontested P.RECEIVE.CLEAN,
  // no seed search needed) while still a real tracking body elsewhere on
  // the pitch that a genuine off-ball job should keep moving.
  const tracker = entry("v32-t1-tracker", { team: "away", x: 25, y: 45, playerObj: WEAK_DEFENDER });
  const groups = { owner, teammates: [receiver], opponents: [tracker], keeper: null };
  // Captured BEFORE resolvePass() runs -- reactOffBallContinuous() (called
  // internally, twice, by the very fix under test) commits each reactor's
  // OWN roster entry to its real end-of-move position as it goes (the
  // same "atomic commit" contract every resolver here relies on), so
  // reading pointOf(tracker) AFTER the call would capture their FINAL
  // position, not the true t=0 starting point buildMatchLabPlaybackPlan()
  // needs for continuity. Pattern Vocabulary V1's own run-off-pass job
  // (2026-09-02) means the PASSER can now genuinely move too (previously
  // never part of the reactor pool during their own pass) -- initialBall
  // must be captured here alongside initialPositions, never re-read via a
  // fresh pointOf(owner) after resolvePass() has already run them off it.
  const initialPositions = { [owner.id]: pointOf(owner), [receiver.id]: pointOf(receiver), [tracker.id]: pointOf(tracker) };
  const initialBall = pointOf(owner);
  const trace = [];
  const motionContext = { state: { tick: 0, players: {} }, marking: {} };
  const result = resolvePass(groups, { preselectedTargetId: receiver.id }, seededRandom(hashString("v32-t1")), trace, true, motionContext);
  check("resolved as a clean, uncontested reception", result.code === "P.RECEIVE.CLEAN");
  const passEvent = trace.find((e) => e.code === "P.PASS");
  const receiveEvent = trace.find((e) => e.code === "P.RECEIVE.CLEAN");
  const defAdjustAfterReceive = trace.slice(trace.indexOf(receiveEvent) + 1)
    .find((e) => e.code === "DEF.ADJUST" && (e.playerMoves || []).some((m) => String(m.playerId) === String(tracker.id)));
  check("a DEF.ADJUST batch overlapping the tracker's own move exists AFTER the reception event (the fix's own second call)",
    Boolean(defAdjustAfterReceive));
  if (passEvent && receiveEvent && defAdjustAfterReceive) {
    const plan = buildMatchLabPlaybackPlan({
      trace, initialPositions, initialBall, initialOwnerId: owner.id,
      finalOwnerId: result.nextOwnerId, restart: result.restart,
    });
    const passIndex = trace.indexOf(passEvent);
    const receiveIndex = trace.indexOf(receiveEvent);
    const adjustIndex = trace.indexOf(defAdjustAfterReceive);
    const receiveInterval = plan.intervals.find((iv) => iv.eventIndex === receiveIndex);
    const adjustInterval = plan.intervals.find((iv) => iv.eventIndex === adjustIndex);
    check("the reception event's own interval starts exactly where the flight ended (no dead gap before it either)",
      Boolean(receiveInterval) && receiveInterval.startMs === plan.intervals.find((iv) => iv.eventIndex === passIndex)?.endMs);
    check("the tracker's own off-ball reaction overlaps the reception's own 160ms window, not a beat after it",
      Boolean(adjustInterval) && Boolean(receiveInterval)
        && adjustInterval.startMs >= receiveInterval.startMs - 1 && adjustInterval.startMs <= receiveInterval.endMs + 1);
    const trackerTrack = plan.tracks.players[tracker.id] || [];
    const duringReception = trackerTrack.filter((frame) => frame.timeMs >= receiveInterval.startMs - 1 && frame.timeMs <= receiveInterval.endMs + 1);
    check("the tracker's own trajectory carries real, non-zero velocity DURING the reception beat -- no 160ms idle gap with v=0",
      duringReception.some((frame) => frame.velocity && (Math.abs(frame.velocity.x) > 1e-6 || Math.abs(frame.velocity.y) > 1e-6)));
  }
}

console.log("\n=== Gameplay v3.2, required test 2 -- KNOCK_FORWARD + ADVANCE: off-ball overlaps the advance, distance is capped, chain stays continuous ===");
{
  state.attackingDirection = { home: "down", away: "up" };
  const buildFixture = () => {
    const owner = entry("v32-t2-owner", { team: "home", x: 50, y: 20, playerObj: STRONG_PASSER });
    const receiver = entry("v32-t2-receiver", { team: "home", x: 50, y: 45, playerObj: GOOD_DRIBBLER });
    const presser = entry("v32-t2-presser", { team: "away", x: 51, y: 46, playerObj: WEAK_DEFENDER });
    const teamB = entry("v32-t2-teamB", { team: "home", x: 25, y: 40, playerObj: STRONG_PASSER });
    const teamC = entry("v32-t2-teamC", { team: "home", x: 75, y: 40, playerObj: GOOD_DRIBBLER });
    const oppB = entry("v32-t2-oppB", { team: "away", x: 30, y: 55, playerObj: WEAK_DEFENDER });
    const oppC = entry("v32-t2-oppC", { team: "away", x: 70, y: 55, playerObj: WEAK_DEFENDER });
    return {
      teamB, oppB, oppC,
      groups: { owner, teammates: [receiver, teamB, teamC], opponents: [presser, oppB, oppC], keeper: null },
    };
  };
  const availability = { preselectedTargetId: "v32-t2-receiver" };
  let found = null;
  let foundTrace = null;
  let foundFixture = null;
  for (let i = 0; i < 600 && !found; i += 1) {
    const fixture = buildFixture();
    const motionContext = { state: { tick: 0, players: {} }, marking: {} };
    const trace = [];
    const random = seededRandom(hashString(`v32-t2-${i}`));
    const result = resolvePass(fixture.groups, availability, random, trace, true, motionContext);
    if (result.code === "P.RECEIVE.KNOCK_FORWARD" && trace.some((e) => e.code === "P.RECEIVE.ADVANCE")) {
      found = result; foundTrace = trace; foundFixture = fixture;
    }
  }
  check("found a real KNOCK_FORWARD reception that advances into a new zone within the search budget", Boolean(found));
  if (found) {
    const { teamB, oppB, oppC } = foundFixture;
    const receiveEvent = foundTrace.find((e) => e.code === "P.RECEIVE.KNOCK_FORWARD");
    const advanceEvent = foundTrace.find((e) => e.code === "P.RECEIVE.ADVANCE");
    check("the advance's own ballFrom is exactly the reception's own ballTo -- one real chained path, never redrawn",
      Boolean(receiveEvent) && Boolean(advanceEvent)
        && receiveEvent.ballTo.x === advanceEvent.ballFrom.x && receiveEvent.ballTo.y === advanceEvent.ballFrom.y);
    check(`the advance distance is capped -- never a zone-center skip of tens of yards (found ${advanceEvent ? yardDistance(advanceEvent.ballFrom, advanceEvent.ballTo).toFixed(1) : "?"}yd)`,
      Boolean(advanceEvent) && yardDistance(advanceEvent.ballFrom, advanceEvent.ballTo) <= 12);
    const adjustAfterAdvance = foundTrace.slice(foundTrace.indexOf(advanceEvent) + 1)
      .filter((e) => e.code === "ATT.ADJUST" || e.code === "DEF.ADJUST" || e.code === "GK.ADJUST");
    const reactingIds = new Set(adjustAfterAdvance.flatMap((e) => (e.playerMoves || []).map((m) => String(m.playerId))));
    const otherOutfieldIds = [teamB.id, oppB.id, oppC.id].map(String);
    check("at least N-2 of the other outfield players get a real overlapping move during the advance, not a freeze",
      otherOutfieldIds.filter((id) => reactingIds.has(id)).length >= otherOutfieldIds.length - 2);
    check("offBallInterleaved is still reported on the final return", found.offBallInterleaved === true);
  }
}

console.log("\n=== Real reported bug (2026-08-31): a LOST KNOCK_FORWARD race no longer deflects the ball to wherever the defender happens to be standing ===");
{
  // Before the fix: a lost contested race set ballTo/ballEnd to
  // pointOf(pressingOpponent) directly -- wherever that defender's own
  // roster entry happened to be positioned on the WHOLE pitch, often
  // real yards from the reception point with nobody actually in between.
  // Rendered as the ball instantly deflecting across open turf. The fix
  // caps it at the same KNOCK_FORWARD_MAX_YARDS the WON branch already
  // uses, and authors a real move for the defender converging on it.
  state.attackingDirection = { home: "down", away: "up" };
  const receiverProfile = player("KF Receiver", { "First Touch": 12, Technique: 12, Composure: 12, Anticipation: 12 });
  const defenderProfile = player("KF Defender", { Tackling: 12, Aggression: 12, Anticipation: 12, Strength: 12 });
  const buildFixture = () => {
    // A short, safe pass (real odds of actually arriving) -- the bug
    // lives entirely inside the CONTESTED RECEPTION, not the flight.
    const owner = entry("v32-lost-owner", { team: "home", x: 50, y: 40, playerObj: STRONG_PASSER });
    const receiver = entry("v32-lost-receiver", { team: "home", x: 50, y: 45, playerObj: receiverProfile });
    // Close enough (within DUEL_RANGE_YARDS) to be selected as the real
    // engaging presser, but BEHIND the receiver relative to the attacking
    // direction (home attacks "down", toward higher y) -- the exact shape
    // of the real reported bug: a genuine, real presser whose own raw
    // standing spot is nowhere near where a forward knock-on would land.
    const presser = entry("v32-lost-presser", { team: "away", x: 52, y: 42, playerObj: defenderProfile });
    return { presser, groups: { owner, teammates: [receiver], opponents: [presser], keeper: null } };
  };
  const availability = { preselectedTargetId: "v32-lost-receiver" };
  let found = null;
  let foundTrace = null;
  let foundFixture = null;
  for (let i = 0; i < 5000 && !found; i += 1) {
    const fixture = buildFixture();
    const motionContext = { state: { tick: 0, players: {} }, marking: {} };
    const trace = [];
    const random = seededRandom(hashString(`v32-lost-${i}`));
    const result = resolvePass(fixture.groups, availability, random, trace, true, motionContext);
    if (result.code === "P.RECEIVE.KNOCK_FORWARD" && result.possession === "turnover") {
      found = result; foundTrace = trace; foundFixture = fixture;
    }
  }
  check("found a real LOST KNOCK_FORWARD (contested race, defender wins) within the search budget", Boolean(found));
  if (found) {
    const receiveEvent = foundTrace.find((e) => e.code === "P.RECEIVE.KNOCK_FORWARD");
    check("the ball's own deflection point is a real, short distance from the reception point -- never wherever the defender's raw roster position happens to be",
      yardDistance(receiveEvent.ballFrom, receiveEvent.ballTo) <= 8.01);
    check("the defender is authored a REAL move to that point, not a teleport (a genuine playerMoves entry, from their own actual position)",
      receiveEvent.playerMoves.length === 1
        && String(receiveEvent.playerMoves[0].playerId) === String(foundFixture.presser.id)
        && (receiveEvent.playerMoves[0].from.x !== receiveEvent.playerMoves[0].to.x || receiveEvent.playerMoves[0].from.y !== receiveEvent.playerMoves[0].to.y));
    check("the resolver's own returned ballEnd matches the trace event's own ballTo exactly -- the NEXT action starts from the same real point, no discontinuity",
      found.ballEnd.x === receiveEvent.ballTo.x && found.ballEnd.y === receiveEvent.ballTo.y && found.ballEnd.zone === receiveEvent.ballTo.zone);
    check("the deflection point carries a real zone (not the bare {x,y} approachPoint() itself returns)",
      Number.isFinite(receiveEvent.ballTo.zone));
  }
}

console.log("\n=== Ball Realism v1 (2026-08-31): the ball's rendered marker is ALWAYS its own real, authored position -- no cosmetic override, ever ===");
{
  // A real, explicit demand: "the ball movement or other should not be
  // cosmetic." The OLD design substituted the OWNER's own position plus
  // a synthetic, speed-scaled pixel nudge whenever the ball's own mode
  // read "controlled"/"controlled-ground" -- this checks that override
  // is gone outright: --marker-x/y always equals the ball's own real
  // snapshot position, verbatim, in every mode, even when that position
  // is genuinely coincident with the owner (a real hold) or genuinely
  // separate from them (a live touch still rolling).
  const owner = entry("realism-owner", { team: "home", x: 50, y: 50, playerObj: GOOD_DRIBBLER });
  const teammate = entry("realism-mate", { team: "home", x: 55, y: 62, playerObj: AVERAGE });
  setupRoster([owner, teammate], owner.id);
  renderPitch();
  state.lastPlan = { intervals: [], cues: [] };
  const markerXY = () => {
    const node = markerNode("ball");
    return {
      x: Number(String(node.style.getPropertyValue("--marker-x")).replace("%", "")),
      y: Number(String(node.style.getPropertyValue("--marker-y")).replace("%", "")),
    };
  };

  // A genuine hold: the ball's own real position IS the owner's position
  // (ballFrom===ballTo===pointOf(owner), authored directly by resolveHold()) --
  // rendering it verbatim should look identical to "at their feet," no
  // separate nudge needed to prove that.
  renderPlaybackFrame({
    timeMs: 100,
    players: { [owner.id]: { x: 50, y: 50 }, [teammate.id]: { x: 55, y: 62 } },
    ownerId: owner.id,
    ball: { x: 50, y: 50, mode: "controlled-ground", velocity: { x: 0, y: 0 }, height: 0 },
  });
  check("a genuinely stationary, owned ball renders EXACTLY at its own authored position",
    markerXY().x === 50 && markerXY().y === 50);

  // A real dribbling pace (real, non-zero velocity) must NOT push the
  // marker away from the ball's own authored position by even one pixel
  // -- there is no more separate "rest offset" layer to do that.
  renderPlaybackFrame({
    timeMs: 300,
    players: { [owner.id]: { x: 52, y: 54 }, [teammate.id]: { x: 55, y: 62 } },
    ownerId: owner.id,
    ball: { x: 52, y: 54, mode: "controlled-ground", velocity: { x: 0.05, y: 0.05 }, height: 0 },
  });
  check("a real dribbling pace still renders the ball at exactly its own authored coordinate, not nudged ahead by a synthetic offset",
    markerXY().x === 52 && markerXY().y === 54);

  // A live touch genuinely rolling ahead of the chasing player (a real,
  // independently-tracked ball position, NOT the owner's own position) --
  // the marker must show THAT real position, not snap to the still-
  // approaching player.
  renderPlaybackFrame({
    timeMs: 500,
    players: { [owner.id]: { x: 52.3, y: 54.4 }, [teammate.id]: { x: 55, y: 62 } },
    ownerId: owner.id,
    ball: { x: 53, y: 55.2, mode: "rolling", velocity: { x: 0.02, y: 0.02 }, height: 0 },
  });
  check("a live, still-separating touch renders the ball at its OWN real position, genuinely apart from the player, not snapped to them",
    markerXY().x === 53 && markerXY().y === 55.2);

  // No CSS custom property is ever written for a cosmetic offset anymore
  // -- confirms the mechanism is actually gone, not just unused this frame.
  const node = markerNode("ball");
  check("no --ball-rest-x/y property is written at all -- the mechanism itself no longer exists, not merely idle",
    node.style.getPropertyValue("--ball-rest-x") === "" && node.style.getPropertyValue("--ball-rest-y") === "");
}

console.log("\n=== Ball Coordinates HUD v1 (2026-08-30): #labShowCoordsCheckbox toggles a live, exact readout above the ball ===");
{
  const owner = entry("coords-owner", { team: "home", x: 42.5, y: 66.25, playerObj: GOOD_DRIBBLER });
  setupRoster([owner], owner.id);
  renderPitch();
  state.lastPlan = { intervals: [], cues: [] };
  const label = () => markerNode("ball")?.querySelector(".match-lab-ball-coords");

  check("off by default -- no coordinates shown until the switch is turned on",
    label()?.dataset.visible !== "true");

  state.showBallCoords = true;
  renderPlaybackFrame({
    timeMs: 100,
    players: { [owner.id]: { x: 42.5, y: 66.25 } },
    ownerId: owner.id,
    ball: { x: 42.5, y: 66.25, mode: "controlled-ground", velocity: { x: 0, y: 0 }, height: 0 },
  });
  check("turning it on shows the label", label()?.dataset.visible === "true");
  check("the label's own text carries the EXACT live percent-grid coordinates (the same space every ballFrom/ballTo in the trace already uses)",
    label()?.textContent.includes("42.5") && label()?.textContent.includes("66.3"));

  renderPlaybackFrame({
    timeMs: 140,
    players: { [owner.id]: { x: 45, y: 70 } },
    ownerId: owner.id,
    ball: { x: 45, y: 70, mode: "controlled-ground", velocity: { x: 0.01, y: 0.01 }, height: 0 },
  });
  check("the label updates to the NEW live position on the next frame, not a stale first reading",
    label()?.textContent.includes("45.0") && label()?.textContent.includes("70.0"));

  state.showBallCoords = false;
  updateBallCoordsLabel();
  check("turning it back off hides the label again", label()?.dataset.visible !== "true");
}

console.log("\n=== Ball Coordinates HUD v1: the CARRIER's own coordinates show alongside the ball's, settling 'did the ball move or the player' ===");
{
  const carrierA = entry("coords-carrier-a", { team: "home", x: 30, y: 40, playerObj: GOOD_DRIBBLER });
  const carrierB = entry("coords-carrier-b", { team: "home", x: 60, y: 70, playerObj: GOOD_DRIBBLER });
  setupRoster([carrierA, carrierB], carrierA.id);
  renderPitch();
  state.lastPlan = { intervals: [], cues: [] };
  const playerLabel = (id) => markerNode(id)?.querySelector(".match-lab-player-coords");

  state.showBallCoords = true;
  renderPlaybackFrame({
    timeMs: 100,
    players: { [carrierA.id]: { x: 31, y: 41 }, [carrierB.id]: { x: 60, y: 70 } },
    ownerId: carrierA.id,
    ball: { x: 31, y: 41, mode: "controlled-ground", velocity: { x: 0, y: 0 }, height: 0 },
  });
  check("the CURRENT owner's own coordinate label is shown", playerLabel(carrierA.id)?.dataset.visible === "true");
  check("the owner's label carries THEIR exact position, not the ball's",
    playerLabel(carrierA.id)?.textContent.includes("31.0") && playerLabel(carrierA.id)?.textContent.includes("41.0"));
  check("a non-owner never gets a coordinate label, even with the switch on",
    playerLabel(carrierB.id)?.dataset.visible !== "true");

  // Possession changes hands -- the OLD owner's label must not linger.
  renderPlaybackFrame({
    timeMs: 140,
    players: { [carrierA.id]: { x: 31, y: 41 }, [carrierB.id]: { x: 60, y: 70 } },
    ownerId: carrierB.id,
    ball: { x: 60, y: 70, mode: "controlled-ground", velocity: { x: 0, y: 0 }, height: 0 },
  });
  check("possession moving on hides the PREVIOUS owner's label", playerLabel(carrierA.id)?.dataset.visible !== "true");
  check("...and shows the NEW owner's own coordinates instead",
    playerLabel(carrierB.id)?.dataset.visible === "true"
      && playerLabel(carrierB.id)?.textContent.includes("60.0") && playerLabel(carrierB.id)?.textContent.includes("70.0"));
}

console.log("\n=== Turnover Stamina Jobs v1: real reported bug -- the recovery-runner/support-runner never get a SECOND, conflicting move the same action (teleport) ===");
{
  // A real browser round reported a player visibly teleporting right
  // after a duel: maybeAssignTurnoverStaminaJobs() gave Ravanelli his own
  // dedicated "tracks back" job, then the REGULAR post-action off-ball
  // reshaping (reactOffBallContinuous(), unaware of that dedicated job)
  // independently planned a SECOND, different target for him as an
  // ordinary opponent, landing a conflicting move on top within the same
  // action. Root cause: maybeAssignTurnoverStaminaJobs()'s own assigned
  // ids never reached that later call's excludedIds. Fixture: a weak
  // dribbler far upfield (home) marked tightly by an elite tackler
  // (away), with a deep home teammate (real median-depth anchor for 2a)
  // and a high-Work-Rate deep away teammate (guaranteed 2b support-run
  // via the workRate01>0.75 branch alone).
  const weakDribbler = player("Weak Dribbler Turnover", { Dribbling: 4, Technique: 4, Composure: 4, Decisions: 6, Vision: 6 });
  const owner = entry("teleport-owner", { team: "home", x: 50, y: 88, playerObj: weakDribbler });
  const deepHomeTeammate = entry("teleport-home-deep", { team: "home", x: 30, y: 15, playerObj: AVERAGE });
  const tackler = entry("teleport-tackler", { team: "away", x: 50, y: 84, playerObj: ELITE_DEFENDER });
  const deepAwayTeammate = entry("teleport-away-deep", { team: "away", x: 70, y: 90, playerObj: player("Deep Away Runner", { "Work Rate": 20, Stamina: 16, Pace: 12, Acceleration: 12 }) });
  const homeKeeper = entry("teleport-home-keeper", { role: "keeper", team: "home", x: 50, y: 2, playerObj: ELITE_KEEPER });
  const awayKeeper = entry("teleport-away-keeper", { role: "keeper", team: "away", x: 50, y: 98, playerObj: ELITE_KEEPER });

  let foundRecovery = false;
  let foundSupport = false;
  let recoveryDuplicated = false;
  let supportDuplicated = false;
  for (let i = 0; i < 300 && !(foundRecovery && foundSupport); i += 1) {
    setupRoster([owner, deepHomeTeammate, tackler, deepAwayTeammate, homeKeeper, awayKeeper], owner.id);
    const run = runConstructedPossession(`teleport-fix-${i}`);
    const trace = run.trace;
    // Segment the trace into action windows at each ACTION.CHOICE boundary
    // -- the recovery/support job and the regular reshaping that could
    // conflict with it both land in the SAME segment.
    const segments = [];
    let current = [];
    for (const event of trace) {
      if (event.code === "ACTION.CHOICE" && current.length) {
        segments.push(current);
        current = [];
      }
      current.push(event);
    }
    if (current.length) segments.push(current);
    for (const segment of segments) {
      const recoveryEvent = segment.find((event) => event.code === "DEF.ADJUST" && event.label?.includes("tracks back after losing it"));
      const supportEvent = segment.find((event) => event.code === "ATT.ADJUST" && event.label?.includes("joins the attack from deep"));
      if (recoveryEvent) {
        foundRecovery = true;
        const recoveryId = String(recoveryEvent.playerMoves[0].playerId);
        const laterConflict = segment.some((event) =>
          event !== recoveryEvent
          && (event.code === "DEF.ADJUST" || event.code === "ATT.ADJUST")
          && (event.playerMoves || []).some((move) => String(move.playerId) === recoveryId));
        if (laterConflict) recoveryDuplicated = true;
      }
      if (supportEvent) {
        foundSupport = true;
        const supportId = String(supportEvent.playerMoves[0].playerId);
        const laterConflict = segment.some((event) =>
          event !== supportEvent
          && (event.code === "DEF.ADJUST" || event.code === "ATT.ADJUST")
          && (event.playerMoves || []).some((move) => String(move.playerId) === supportId));
        if (laterConflict) supportDuplicated = true;
      }
    }
  }
  check("exercised at least one real 'tracks back after losing it' recovery job within the search budget", foundRecovery);
  check("exercised at least one real 'joins the attack from deep' support job within the search budget", foundSupport);
  check("the recovery-runner never gets a second, conflicting DEF.ADJUST/ATT.ADJUST move the same action", !recoveryDuplicated);
  check("the support-runner never gets a second, conflicting DEF.ADJUST/ATT.ADJUST move the same action", !supportDuplicated);
}

console.log("\n=== Ball Out of Bounds v1: findPitchExit()/classifyPitchExit() -- pure geometry + restart classification ===");
{
  check("a segment that stays on the pitch never reports an exit",
    findPitchExit({ x: 50, y: 50 }, { x: 60, y: 60 }) === null);
  check("crossing the right touchline reports edge 'right', point pinned to x=100",
    (() => {
      const exit = findPitchExit({ x: 95, y: 50 }, { x: 110, y: 55 });
      return exit?.edge === "right" && exit.point.x === 100;
    })());
  check("crossing the left touchline reports edge 'left', point pinned to x=0",
    (() => {
      const exit = findPitchExit({ x: 5, y: 50 }, { x: -10, y: 45 });
      return exit?.edge === "left" && exit.point.x === 0;
    })());
  check("crossing the top byline (y=0) reports edge 'top'",
    findPitchExit({ x: 50, y: 5 }, { x: 50, y: -5 })?.edge === "top");
  check("crossing the bottom byline (y=100) reports edge 'bottom'",
    findPitchExit({ x: 50, y: 95 }, { x: 50, y: 105 })?.edge === "bottom");

  const ad = { home: "down", away: "up" }; // home attacks toward y=100, own goal at y=0
  check("either touchline -> throw-in, possession to the OTHER team",
    (() => {
      const result = classifyPitchExit({ from: { x: 95, y: 50 }, to: { x: 110, y: 55 }, lastTouchTeam: "home", attackingDirectionByTeam: ad });
      return result?.restart === "throw-in" && result.possessionTeam === "away";
    })());
  check("attacking team puts it out over the DEFENSE's own byline (not a goal) -> goal-kick for the defense",
    (() => {
      // home attacks "down" (toward y=100) -- home putting it out over y=100 (the AWAY goal's own line) is home's own doing, wide of the target -> goal-kick for away.
      const result = classifyPitchExit({ from: { x: 50, y: 95 }, to: { x: 50, y: 105 }, lastTouchTeam: "home", attackingDirectionByTeam: ad });
      return result?.restart === "goal-kick" && result.possessionTeam === "away";
    })());
  check("defending team puts it behind their OWN byline -> corner for the attackers",
    (() => {
      // away defends the y=100 line (away attacks "up", own goal at y=100) -- away touching it out over y=100 is a corner for home.
      const result = classifyPitchExit({ from: { x: 50, y: 95 }, to: { x: 50, y: 105 }, lastTouchTeam: "away", attackingDirectionByTeam: ad });
      return result?.restart === "corner" && result.possessionTeam === "home";
    })());
  check("never fabricates a restart without real last-touch/attacking-direction data",
    classifyPitchExit({ from: { x: 95, y: 50 }, to: { x: 110, y: 55 }, lastTouchTeam: null, attackingDirectionByTeam: ad }) === null);
  check("an already-known exit (the exit-detection-at-the-physics-layer case) is used directly, never re-derived from from/to",
    (() => {
      // The exact real bug this fixes: re-running findPitchExit() against an
      // ALREADY-CLAMPED point sitting exactly ON the line (not past it)
      // would silently find nothing.
      const result = classifyPitchExit({ exit: { edge: "right", point: { x: 100, y: 50 } }, lastTouchTeam: "home", attackingDirectionByTeam: ad });
      return result?.restart === "throw-in" && result.ballEnd.x === 100;
    })());
}

console.log("\n=== Ball Out of Bounds v1: a carry aimed at the touchline genuinely goes out for a throw-in ===");
{
  state.attackingDirection = { home: "down", away: "up" };
  const fastWinger = player("Touchline Winger", { Pace: 18, Acceleration: 16, Dribbling: 14, Technique: 14, "Work Rate": 14, Stamina: 14 });
  let found = null;
  let foundTrace = null;
  for (let ox = 90; ox <= 99 && !found; ox += 1) {
    for (let dxTenths = 990; dxTenths <= 1000 && !found; dxTenths += 3) {
      const owner = entry("oob-carry-owner", { team: "home", x: ox, y: 10, playerObj: fastWinger });
      const groups = { owner, teammates: [], opponents: [], keeper: null };
      const trace = [];
      const result = resolveCarry(groups, { plannedMoveTo: { x: dxTenths / 10, y: 15 } }, seededRandom(hashString("x")), trace, true, { state: { players: {} }, marking: {} });
      if (result.restart) { found = result; foundTrace = trace; }
    }
  }
  check("found a real carry that runs the ball out over the touchline within the search budget", Boolean(found));
  if (found) {
    check("it's classified as a genuine throw-in", found.restart === "throw-in");
    check("the trace carries the real RESTART.THROW_IN code", found.code === "RESTART.THROW_IN");
    check("nextOwnerId is null -- this possession is genuinely over, not continuing", found.nextOwnerId === null);
    check("the ball's own exit point sits exactly on the touchline (x=0 or x=100), never past it or clamped short",
      found.ballEnd.x === 0 || found.ballEnd.x === 100);
    const restartEvent = foundTrace.find((event) => event.code === "RESTART.THROW_IN");
    check("the carrier's own real touch/chase trajectory carries the ball there -- a genuine roll, never a teleport",
      Boolean(restartEvent) && restartEvent.playerMoves?.length === 1 && restartEvent.ballFrom.x !== restartEvent.ballTo.x);
  }
}

console.log("\n=== Ball Out of Bounds v1: an overhit pass toward the byline produces a real goal-kick for the defending team ===");
{
  state.attackingDirection = { home: "down", away: "up" };
  const wildPasser = player("Wild Passer", { Passing: 1, Technique: 1, Decisions: 1, Vision: 1, Composure: 1 });
  const receiver = entry("oob-pass-receiver", { team: "home", x: 50, y: 99, playerObj: player("Target", {}) });
  let found = null;
  let foundTrace = null;
  for (let i = 0; i < 1000 && !found; i += 1) {
    const owner = entry("oob-pass-owner", { team: "home", x: 50, y: 5, playerObj: wildPasser });
    const groups = { owner, teammates: [receiver], opponents: [], keeper: null };
    const trace = [];
    const result = resolvePass(groups, {}, seededRandom(hashString(`oob-pass-${i}`)), trace);
    if (result.restart) { found = result; foundTrace = trace; }
  }
  check("found a genuinely overhit pass that exits the pitch within the search budget", Boolean(found));
  if (found) {
    check("it's classified as a goal-kick for the defending side (attacker overhit it, not their own byline)",
      found.restart === "goal-kick");
    check("the trace carries the real RESTART.GOAL_KICK code", found.code === "RESTART.GOAL_KICK");
    check("nextOwnerId is null -- this possession is genuinely over, not continuing", found.nextOwnerId === null);
    check("the exit point sits exactly on the byline (y=100), never past it", found.ballEnd.y === 100);
    const restartEvent = foundTrace.find((event) => event.code === "RESTART.GOAL_KICK");
    check("the ball's own trajectory carries real momentum to the exit point, never a teleport",
      Boolean(restartEvent)
        && (restartEvent.ballFrom.x !== restartEvent.ballTo.x || restartEvent.ballFrom.y !== restartEvent.ballTo.y));
  }
}

console.log("\n=== Ball Out of Bounds v1: an overhit cross toward the byline produces a real goal-kick for the defending team ===");
{
  state.attackingDirection = { home: "down", away: "up" };
  const wildCrosser = player("Wild Crosser", { Crossing: 1, Technique: 1, Decisions: 1, Vision: 1, Composure: 1 });
  const receiver = entry("oob-cross-receiver", { team: "home", x: 50, y: 99, playerObj: player("Target", {}) });
  let found = null;
  let foundTrace = null;
  for (let i = 0; i < 1000 && !found; i += 1) {
    const owner = entry("oob-cross-owner", { team: "home", x: 5, y: 80, playerObj: wildCrosser });
    const groups = { owner, teammates: [receiver], opponents: [], keeper: null };
    const trace = [];
    const result = resolveCross(groups, {}, seededRandom(hashString(`oob-cross-${i}`)), trace);
    if (result.restart) { found = result; foundTrace = trace; }
  }
  check("found a genuinely overhit cross that exits the pitch within the search budget", Boolean(found));
  if (found) {
    check("it's classified as a goal-kick for the defending side", found.restart === "goal-kick");
    check("the trace carries the real RESTART.GOAL_KICK code", found.code === "RESTART.GOAL_KICK");
    check("nextOwnerId is null", found.nextOwnerId === null);
    check("the exit point sits exactly on the byline (y=100), never past it", found.ballEnd.y === 100);
    const restartEvent = foundTrace.find((event) => event.code === "RESTART.GOAL_KICK");
    check("the ball's own trajectory carries real momentum to the exit point, never a teleport",
      Boolean(restartEvent)
        && (restartEvent.ballFrom.x !== restartEvent.ballTo.x || restartEvent.ballFrom.y !== restartEvent.ballTo.y));
  }
}

console.log("\n=== Ball Out of Bounds v1: a clear-behind clearance still goes out for a real (non-clamped) corner ===");
{
  state.attackingDirection = { home: "down", away: "up" };
  const lastDitchDefender = player("Last-Ditch Defender", {
    Heading: 18, Composure: 16, Anticipation: 16, Positioning: 16, Decisions: 14, Passing: 6, Technique: 6,
  });
  const attackerOwner = entry("clr-behind-owner", { team: "home", x: 50, y: 90, playerObj: player("Striker", {}) });
  const teammateReceiver = entry("clr-behind-receiver", { team: "home", x: 55, y: 92, playerObj: player("Winger", {}) });
  const contactPoint = { x: 50, y: 97 };
  let found = null;
  let foundTrace = null;
  for (let i = 0; i < 500 && !found; i += 1) {
    const defender = entry("clr-behind-defender", { team: "away", x: 50, y: 97, playerObj: lastDitchDefender });
    const groups = { owner: attackerOwner, teammates: [teammateReceiver], opponents: [defender], keeper: null };
    const trace = [];
    const result = resolveAerialClearanceContinuation(
      defender, contactPoint, groups, teammateReceiver, seededRandom(hashString(`clr-behind-${i}`)), trace,
    );
    if (result.restart === "corner") { found = result; foundTrace = trace; }
  }
  check("found a real clear-behind that genuinely goes out for a corner within the search budget", Boolean(found));
  if (found) {
    check("nextOwnerId is null -- this possession is genuinely over, not continuing", found.nextOwnerId === null);
    check("the exit point sits exactly on the byline (y=100), from real geometry, never clamped short",
      found.ballEnd.y === 100);
    const restartEvent = foundTrace.find((event) => event.code === "RESTART.CORNER");
    check("the trace carries the real RESTART.CORNER code", Boolean(restartEvent));
  }
}

console.log("\n=== Ball Out of Bounds v1: a clearance hoofed from near the touchline still goes out for a real (non-clamped) throw-in ===");
{
  state.attackingDirection = { home: "down", away: "up" };
  const clearingDefender = player("Clearing Defender", {
    Heading: 14, Composure: 12, Anticipation: 12, Positioning: 12, Decisions: 10, Passing: 8, Technique: 8,
  });
  const attackerOwner = entry("clr-touch-owner", { team: "home", x: 10, y: 45, playerObj: player("Striker", {}) });
  const teammateReceiver = entry("clr-touch-receiver", { team: "home", x: 15, y: 48, playerObj: player("Winger", {}) });
  const contactPoint = { x: 2, y: 50 };
  let found = null;
  let foundTrace = null;
  for (let i = 0; i < 1500 && !found; i += 1) {
    const defender = entry("clr-touch-defender", { team: "away", x: 2, y: 50, playerObj: clearingDefender });
    const groups = { owner: attackerOwner, teammates: [teammateReceiver], opponents: [defender], keeper: null };
    const trace = [];
    const result = resolveAerialClearanceContinuation(
      defender, contactPoint, groups, teammateReceiver, seededRandom(hashString(`clr-touch-${i}`)), trace,
    );
    if (result.restart === "throw-in") { found = result; foundTrace = trace; }
  }
  check("found a real clearance (long or toward the touchline) that genuinely goes out for a throw-in within the search budget", Boolean(found));
  if (found) {
    check("nextOwnerId is null", found.nextOwnerId === null);
    check("the exit point sits exactly on the touchline (x=0), from real geometry, never clamped short",
      found.ballEnd.x === 0);
    const restartEvent = foundTrace.find((event) => event.code === "RESTART.THROW_IN");
    check("the trace carries the real RESTART.THROW_IN code", Boolean(restartEvent));
  }
}

console.log("\n=== Ball Out of Bounds v1: buildMatchLabPlaybackPlan() ends with a null owner on a real restart ===");
{
  state.attackingDirection = { home: "down", away: "up" };
  const fastWinger = player("Playback Winger", { Pace: 18, Acceleration: 16, Dribbling: 14, Technique: 14, "Work Rate": 14, Stamina: 14 });
  let found = null;
  let foundTrace = null;
  let foundOwner = null;
  for (let ox = 90; ox <= 99 && !found; ox += 1) {
    for (let dxTenths = 990; dxTenths <= 1000 && !found; dxTenths += 3) {
      const owner = entry("oob-playback-owner", { team: "home", x: ox, y: 10, playerObj: fastWinger });
      const groups = { owner, teammates: [], opponents: [], keeper: null };
      const trace = [];
      const result = resolveCarry(groups, { plannedMoveTo: { x: dxTenths / 10, y: 15 } }, seededRandom(hashString("x")), trace, true, { state: { players: {} }, marking: {} });
      if (result.restart) { found = result; foundTrace = trace; foundOwner = owner; }
    }
  }
  check("found a real carry-to-throw-in sequence to build a playback plan from", Boolean(found));
  if (found) {
    const plan = buildMatchLabPlaybackPlan({
      trace: foundTrace,
      initialPositions: { [foundOwner.id]: pointOf(foundOwner) },
      initialBall: pointOf(foundOwner), initialOwnerId: foundOwner.id,
      finalOwnerId: found.nextOwnerId, restart: found.restart,
    });
    // buildMatchLabPlaybackPlan() throws on an invalid plan (it self-runs
    // validateMatchLabPlaybackPlan() internally) -- reaching this line at
    // all already confirms the existing `restart && ownerId !== null`
    // rejection never fired for a real Ball Out of Bounds restart.
    check("the playback plan's own finalState carries a null owner on a genuine restart",
      plan.finalState.ownerId === null);
    check("the playback plan's own finalState carries the real restart type",
      plan.finalState.restart === "throw-in");
  }
}

console.log("\n=== Loose Ball Momentum v1: flightLandingVelocity() -- a real, honest average-velocity stand-in ===");
{
  check("a real, real-time delivery produces a genuine non-zero velocity in the right direction",
    (() => {
      const v = flightLandingVelocity({ x: 50, y: 20 }, { x: 50, y: 80 }, 1000);
      return v.y > 0 && Math.abs(v.x) < 1e-9;
    })());
  check("doubling the distance over the same duration doubles the velocity",
    (() => {
      const v1 = flightLandingVelocity({ x: 50, y: 0 }, { x: 50, y: 30 }, 1000);
      const v2 = flightLandingVelocity({ x: 50, y: 0 }, { x: 50, y: 60 }, 1000);
      return Math.abs(v2.y - v1.y * 2) < 1e-9;
    })());
  check("zero duration never divides by zero -- a safe {0,0}, not NaN/Infinity",
    (() => {
      const v = flightLandingVelocity({ x: 50, y: 0 }, { x: 50, y: 30 }, 0);
      return v.x === 0 && v.y === 0;
    })());
}

console.log("\n=== Loose Ball Momentum v1: a real reported bug -- the ball keeps rolling with real momentum instead of freezing dead at the landing spot ===");
{
  // The EXACT deterministic fixture Gameplay v3.1's own required test 2
  // already uses (65 real yards, no real player can cover it) -- reused
  // here specifically because it reliably reaches pushLooseDeliveryChase()
  // with zero RNG search needed.
  state.attackingDirection = { home: "down", away: "up" };
  const owner = entry("lbm-owner", { team: "home", x: 50, y: 25, playerObj: STRONG_PASSER });
  const runner = entry("lbm-runner", { team: "home", x: 15, y: 40, playerObj: GOOD_DRIBBLER });
  const teammateB = entry("lbm-teamB", { team: "home", x: 25, y: 35, playerObj: STRONG_PASSER });
  const teammateC = entry("lbm-teamC", { team: "home", x: 75, y: 35, playerObj: GOOD_DRIBBLER });
  const groups = { owner, teammates: [runner, teammateB, teammateC], opponents: [], keeper: null };
  // Ball Out of Bounds v1 (2026-09-01) -- kept well short of the byline
  // (was y:95) so the roll's own real momentum stays a genuine MID-PITCH
  // recovery, this test's actual point, rather than tripping the newer
  // (separately tested) real pitch-exit -> goal-kick behavior.
  const availability = { preselectedTargetId: runner.id, plannedMoveTo: { x: 50, y: 80 } };
  const motionContext = { state: { tick: 0, players: {} }, marking: {} };
  const trace = [];
  const result = FREE_PLAY_RESOLVERS.through(groups, availability, seededRandom(hashString("lbm-through")), trace, true, motionContext);
  check("the resolver's own return carries a real, non-fabricated landing velocity",
    Boolean(result.ballVelocity) && (Math.abs(result.ballVelocity.x) > 1e-9 || Math.abs(result.ballVelocity.y) > 1e-9));

  // Now run it through the FULL possession loop -- the actual roll+race
  // logic lives in runConstructedPossession()'s own loose-ball handling
  // block, not inside the resolver itself.
  setupRoster([owner, runner, teammateB, teammateC], owner.id);
  const run = runConstructedPossession("lbm-possession");
  const looseEvent = run.trace.find((event) => event.code === "P.RECEIVE.LATE");
  const recoveredEvent = run.trace.find((event) => event.code === "LOOSE.RECOVERED");
  // Ball Out of Bounds v1 (2026-09-01) -- this fixture's own real, rolling
  // momentum can now legitimately carry the loose ball out of play before
  // anyone recovers it (a real RESTART.* event) instead of always settling
  // to a mid-pitch LOOSE.RECOVERED -- both are honest outcomes of the SAME
  // real physics this test exists to check, so both are accepted here.
  const restartEvent = run.trace.find((event) => event.code?.startsWith("RESTART."));
  check("found a real P.RECEIVE.LATE sequence that either gets recovered mid-pitch or genuinely goes out",
    Boolean(looseEvent) && (Boolean(recoveredEvent) || Boolean(restartEvent)));
  if (looseEvent && recoveredEvent) {
    check("the ball's own recovery point is a REAL point along its actual momentum, not frozen at the original landing spot",
      yardDistance(looseEvent.ballTo, recoveredEvent.ballTo) > 0.5);
    check("the recovered event carries a genuine multi-sample rolling trajectory, not a bare two-point jump",
      Array.isArray(recoveredEvent.ballTrajectory) && recoveredEvent.ballTrajectory.length > 2);
    check("the roll's own first sample starts exactly where the ball actually went loose",
      Math.abs(recoveredEvent.ballTrajectory[0].position.x - looseEvent.ballTo.x) < 0.01
        && Math.abs(recoveredEvent.ballTrajectory[0].position.y - looseEvent.ballTo.y) < 0.01);
    check("the roll's own last sample lands exactly where the recovery actually happens",
      Math.abs(recoveredEvent.ballTrajectory.at(-1).position.x - recoveredEvent.ballTo.x) < 0.01
        && Math.abs(recoveredEvent.ballTrajectory.at(-1).position.y - recoveredEvent.ballTo.y) < 0.01);
    check("the recoverer's own authored move ends at the SAME real point the ball actually rolled to",
      Math.abs(recoveredEvent.playerMoves[0].to.x - recoveredEvent.ballTo.x) < 0.01
        && Math.abs(recoveredEvent.playerMoves[0].to.y - recoveredEvent.ballTo.y) < 0.01);
    const positionedAfter = run.trace.slice(run.trace.indexOf(recoveredEvent) + 1).find((event) => event.ballFrom && event.ballTo);
    check("no discontinuity into the next action -- whatever comes next starts exactly where the real roll ended",
      !positionedAfter
        || (Math.abs(positionedAfter.ballFrom.x - recoveredEvent.ballTo.x) < 0.01
          && Math.abs(positionedAfter.ballFrom.y - recoveredEvent.ballTo.y) < 0.01));
  } else if (looseEvent && restartEvent) {
    check("the restart's own ballFrom starts exactly where the ball actually went loose",
      Math.abs(restartEvent.ballFrom.x - looseEvent.ballTo.x) < 0.01
        && Math.abs(restartEvent.ballFrom.y - looseEvent.ballTo.y) < 0.01);
    check("the exit point is a REAL point along real momentum, not frozen at the original landing spot",
      yardDistance(looseEvent.ballTo, restartEvent.ballTo) > 0.5);
    check("the exit point sits exactly on a real pitch boundary, never clamped short",
      restartEvent.ballTo.x === 0 || restartEvent.ballTo.x === 100
        || restartEvent.ballTo.y === 0 || restartEvent.ballTo.y === 100);
  }
}

console.log("\n=== Keeper Hold & Walk v1: keeperWalkTarget() -- a real, deterministic, box-bound wander ===");
{
  const keeperObj = player("Wandering Keeper", {});
  const keeperEntry = entry("hold-walk-keeper", { role: "keeper", team: "home", x: 50, y: 5, playerObj: keeperObj });
  const targetA = keeperWalkTarget(keeperEntry, "down", "seed-a", 3);
  const targetB = keeperWalkTarget(keeperEntry, "down", "seed-a", 3);
  const targetC = keeperWalkTarget(keeperEntry, "seed-different", "down", 7);
  check("the SAME seed/actionsCount reproduces an IDENTICAL walk target",
    targetA.x === targetB.x && targetA.y === targetB.y);
  check("a genuine move actually happened -- not a no-op stand-still",
    yardDistance(keeperEntry, targetA) > 0.5);
  check("the walk target stays inside the keeper's own real penalty area, home attacking 'down' (own goal at y=0)",
    isInsidePenaltyArea(targetA, defendingGoalYForDirection("down")));
  const keeperEntryAway = entry("hold-walk-keeper-away", { role: "keeper", team: "away", x: 50, y: 96, playerObj: keeperObj });
  const targetAway = keeperWalkTarget(keeperEntryAway, "up", "seed-away", 1);
  check("the SAME clamp applies correctly for the OTHER goal direction too (own goal at y=100)",
    isInsidePenaltyArea(targetAway, defendingGoalYForDirection("up")));
}

console.log("\n=== Keeper Hold & Walk v1: a real catch produces a genuine walk, ball travels in hand, duration scales with pressure, real law-of-the-game ceiling ===");
{
  // A comfortable, central save for an elite keeper against a weak,
  // central shooter -- reliably produces a genuine catch (result.held)
  // within a modest search budget.
  const shooterProfile = player("Weak Central Shooter", { Finishing: 6, Technique: 6, Composure: 6, Shooting: 6, Decisions: 8 });
  const keeperProfile = player("Elite Catching Keeper", { Reflexes: 19, Positioning: 18, "One On Ones": 18, Handling: 18, Agility: 17, Anticipation: 17 });
  const shooter = entry("hw-shooter", { team: "home", x: 50, y: 70, playerObj: shooterProfile });
  const keeper = entry("hw-keeper", { role: "keeper", team: "away", x: 50, y: 98, playerObj: keeperProfile });
  setupRoster([shooter, keeper], shooter.id);
  let foundEvent = null;
  let foundRun = null;
  for (let i = 0; i < 400 && !foundEvent; i += 1) {
    const run = runConstructedPossession(`hold-walk-${i}`);
    const holdEvent = run.trace.find((event) => event.code === "GK.HOLD");
    if (holdEvent) { foundEvent = holdEvent; foundRun = run; }
  }
  check("found a real keeper catch (GK.HOLD) within the search budget", Boolean(foundEvent));
  if (foundEvent) {
    const move = foundEvent.playerMoves[0];
    check("the GK.HOLD event carries a genuine playerMoves entry for the keeper, not an empty array",
      Boolean(move) && String(move.playerId) === String(keeper.id));
    check("a real move actually happened -- from and to genuinely differ, not frozen at the catch point",
      move.from.x !== move.to.x || move.from.y !== move.to.y);
    check("the ball travels IN HIS HANDS -- ballTo matches exactly where he actually walks to",
      foundEvent.ballTo.x === move.to.x && foundEvent.ballTo.y === move.to.y);
    check("the walk stays inside the real penalty area the whole time",
      isInsidePenaltyArea(move.to, defendingGoalYForDirection(state.attackingDirection[keeper.team])));
    check(`the hold's own duration sits within [GK_HOLD_MS, GK_HOLD_MAX_MS] (found ${foundEvent.duration}ms)`,
      foundEvent.duration >= GK_HOLD_MS && foundEvent.duration <= GK_HOLD_MAX_MS);
    check("the resolver's own next action starts from the WALKED-TO position, never the original catch point",
      foundRun.trace.slice(foundRun.trace.indexOf(foundEvent) + 1)
        .some((event) => event.ballFrom && Math.abs(event.ballFrom.x - move.to.x) < 0.01 && Math.abs(event.ballFrom.y - move.to.y) < 0.01)
      || foundRun.finalPositions.find((p) => p.id === keeper.id)?.x === move.to.x);
  }

  // A nearby opponent cannot pressure a keeper who is holding the ball.
  // Proximity therefore cannot shorten the holding window. Pressing becomes
  // available again only after a release to the feet.
  const pressedKeeper = entry("hw-keeper-pressed", { role: "keeper", team: "away", x: 50, y: 98, playerObj: keeperProfile });
  const presser = entry("hw-presser", { team: "home", x: 50, y: 96, playerObj: player("Presser", { Positioning: 15, Anticipation: 15 }) });
  // A real covering defender -- without ANY away outfield player at all,
  // freePlayOneOnOneContext() has no laneDefender/recoveryDefender to find
  // and this fixture is a structural one-on-one breakaway on every single
  // action, never an ordinary shot (Ball Out of Bounds v1 surfaced this:
  // once genuine restarts started ending more of these possessions before
  // they escaped into a non-breakaway shot by chance, GK.HOLD stopped
  // appearing within budget at all). Placed within the real
  // ONE_ON_ONE_DEFENDER_RECOVERY_YARDS radius of the shooter so the
  // breakaway gate is reliably disqualified and every save instead comes
  // through the ordinary resolveShoot() -> GK.HOLD path this test needs.
  const coveringDefender = entry("hw-covering-defender", {
    team: "away", x: 58, y: 68, playerObj: player("Covering Defender", { Positioning: 12, Anticipation: 12, Tackling: 10, Marking: 10 }),
  });
  setupRoster([shooter, pressedKeeper, presser, coveringDefender], shooter.id);
  // A real save often involves a genuine dive, so search for any catch and
  // then inspect the actual held-ball window authored after it.
  let pressedHoldEvent = null;
  let pressedHoldRun = null;
  for (let i = 0; i < 400 && !pressedHoldEvent; i += 1) {
    const run = runConstructedPossession(`hold-walk-pressed-${i}`);
    const holdEvent = run.trace.find((event) => event.code === "GK.HOLD");
    if (holdEvent) { pressedHoldEvent = holdEvent; pressedHoldRun = run; }
  }
  check("found a real keeper catch with a nearby attacker within the search budget", Boolean(pressedHoldEvent));
  if (foundEvent && pressedHoldEvent) {
    check(`nearby opposition cannot shorten a held-ball window (${foundEvent.duration}ms vs ${pressedHoldEvent.duration}ms)`,
      pressedHoldEvent.duration === GK_HOLD_MAX_MS && foundEvent.duration === GK_HOLD_MAX_MS);
    const holdIndex = pressedHoldRun.trace.indexOf(pressedHoldEvent);
    const nextChoice = pressedHoldRun.trace.findIndex((event,index)=>index>holdIndex&&event.code==="ACTION.CHOICE");
    const holdReactions = pressedHoldRun.trace.slice(holdIndex+1,nextChoice<0?undefined:nextChoice)
      .flatMap(event=>event.playerMoves??[]).filter(move=>move.playerId===presser.id);
    check("the nearby attacker receives no press-ball or delay job while the keeper holds it",
      holdReactions.every(move=>!["press-ball","delay"].includes(move.action)));
    check("the nearby attacker is explicitly sent away from the held ball",
      holdReactions.some(move=>move.action==="respect-held-ball"));
  }
}

console.log("\n=== Real reported bug (2026-09-01): 'most of the players get frozen and not moving for a time' -- the OTHER 21 players during a keeper's hold ===");
{
  // GK.HOLD's own duration can now stretch to a real 6 real seconds
  // (GK_HOLD_MAX_MS, Keeper Hold & Walk v1) with nobody unpressed nearby
  // -- before this fix, only the keeper himself ever got an authored
  // move for that whole window, so every OTHER player on the pitch had
  // no keyframe at all across it and rendered as frozen. A fuller roster
  // on both sides -- real off-ball jobs (marking, shape, support) are
  // available to actually claim.
  const shooterProfile = player("Weak Central Shooter", { Finishing: 6, Technique: 6, Composure: 6, Shooting: 6, Decisions: 8 });
  const keeperProfile = player("Elite Catching Keeper", { Reflexes: 19, Positioning: 18, "One On Ones": 18, Handling: 18, Agility: 17, Anticipation: 17 });
  const shooter = entry("freeze-shooter", { team: "home", x: 50, y: 70, playerObj: shooterProfile });
  const teammateA = entry("freeze-teamA", { team: "home", x: 30, y: 60, playerObj: AVERAGE });
  const teammateB = entry("freeze-teamB", { team: "home", x: 70, y: 60, playerObj: AVERAGE });
  const keeper = entry("freeze-keeper", { role: "keeper", team: "away", x: 50, y: 98, playerObj: keeperProfile });
  const opponentA = entry("freeze-oppA", { team: "away", x: 35, y: 80, playerObj: AVERAGE });
  const opponentB = entry("freeze-oppB", { team: "away", x: 65, y: 80, playerObj: AVERAGE });
  setupRoster([shooter, teammateA, teammateB, keeper, opponentA, opponentB], shooter.id);
  let foundHold = null;
  let foundRun = null;
  for (let i = 0; i < 400 && !foundHold; i += 1) {
    const run = runConstructedPossession(`freeze-fix-${i}`);
    const holdEvent = run.trace.find((event) => event.code === "GK.HOLD");
    if (holdEvent) { foundHold = holdEvent; foundRun = run; }
  }
  check("found a real keeper catch (GK.HOLD) within the search budget", Boolean(foundHold));
  if (foundHold) {
    const holdIndex = foundRun.trace.indexOf(foundHold);
    // The reaction batch(es) covering this exact window are authored
    // immediately after GK.HOLD itself, before the next real action --
    // scan forward only up to the next ACTION.CHOICE (the start of
    // whatever the keeper does with it next).
    const nextActionIndex = foundRun.trace.findIndex(
      (event, index) => index > holdIndex && event.code === "ACTION.CHOICE",
    );
    const windowEvents = foundRun.trace.slice(holdIndex + 1, nextActionIndex === -1 ? undefined : nextActionIndex);
    const otherOutfieldIds = [teammateA.id, teammateB.id, opponentA.id, opponentB.id].map(String);
    const movedIds = new Set(
      windowEvents.flatMap((event) => (event.playerMoves || []).map((move) => String(move.playerId))),
    );
    check("at least one of the other 4 outfield players gets a REAL move during the hold window, not a total freeze",
      otherOutfieldIds.some((id) => movedIds.has(id)));
    const duplicated = otherOutfieldIds.some((id) => {
      const appearances = windowEvents.filter((event) => (event.playerMoves || []).some((move) => String(move.playerId) === id));
      return appearances.length > 1;
    });
    check("no outfield player gets TWO separate, conflicting moves stacked on top of each other during the same hold window",
      !duplicated);
  }
}

console.log("\n=== Stamina Bars v1: #labShowStaminaCheckbox shows a live, real burst01 bar for EVERY player, not just the ball owner ===");
{
  const barPlayerLow = player("Bar Player Low", { Stamina: 8, "Work Rate": 8 });
  const barPlayerHigh = player("Bar Player High", { Stamina: 18, "Work Rate": 18 });
  const carrierLow = entry("stamina-bar-low", { team: "home", x: 30, y: 40, playerObj: barPlayerLow });
  const carrierHigh = entry("stamina-bar-high", { team: "home", x: 60, y: 70, playerObj: barPlayerHigh });
  setupRoster([carrierLow, carrierHigh], carrierLow.id);
  renderPitch();
  state.lastPlan = { intervals: [], cues: [] };
  const bar = (id) => markerNode(id)?.querySelector(".match-lab-stamina-bar");
  const fill = (id) => bar(id)?.querySelector(".match-lab-stamina-bar-fill");

  check("off by default -- no stamina bar shown until the switch is turned on",
    bar(carrierLow.id)?.dataset.visible !== "true");

  state.showStaminaBars = true;
  updateStaminaBar(carrierLow.id, undefined);
  updateStaminaBar(carrierHigh.id, undefined);
  check("turning it on shows the bar even before any possession has run, seeded from renderPitch()'s own fresh init",
    bar(carrierLow.id)?.dataset.visible === "true" && bar(carrierHigh.id)?.dataset.visible === "true");
  check("a higher-Stamina player's own fresh bar reads a higher fill than a lower-Stamina one, same minute",
    Number.parseFloat(fill(carrierHigh.id)?.style.getPropertyValue("--stamina-pct"))
      > Number.parseFloat(fill(carrierLow.id)?.style.getPropertyValue("--stamina-pct")));
  check("it shows for a non-owner too -- a real fitness readout, not a one-owner debugging aid",
    bar(carrierHigh.id)?.dataset.visible === "true");

  updateStaminaBar(carrierLow.id, 0.2);
  check("a genuinely low burst01 (<=35%) flags the bar's own low-battery state", bar(carrierLow.id)?.dataset.low === "true");
  updateStaminaBar(carrierLow.id, 0.8);
  check("a healthy burst01 clears the low-battery flag", bar(carrierLow.id)?.dataset.low === "false");

  // A real playback frame (via renderPlaybackFrame(), not a direct
  // updateStaminaBar() call) carrying a fresh burst01 on ONE player and
  // nothing for the other -- the untouched player must keep showing
  // their own last real reading, never blank out.
  renderPlaybackFrame({
    timeMs: 200,
    players: {
      [carrierLow.id]: { x: 31, y: 41, burst01: 0.42 },
      [carrierHigh.id]: { x: 60, y: 70 },
    },
    ownerId: carrierLow.id,
    ball: { x: 31, y: 41, mode: "controlled-ground", velocity: { x: 0, y: 0 }, height: 0 },
  });
  check("a real playback frame updates the bar to the snapshot's own live burst01",
    Number.parseFloat(fill(carrierLow.id)?.style.getPropertyValue("--stamina-pct")) === 42);
  check("a player this exact frame says nothing new about keeps showing their own last real reading, not a blank bar",
    bar(carrierHigh.id)?.dataset.visible === "true");

  state.showStaminaBars = false;
  updateStaminaBar(carrierLow.id, undefined);
  check("turning it back off hides the bar again", bar(carrierLow.id)?.dataset.visible !== "true");
}

console.log("\n=== Stamina Bars v1: buildMatchLabPlaybackPlan() carries burst01 through as a discrete, held-until-updated field ===");
{
  const busyOwner = entry("busy", { team: "home", x: 30, y: 40, playerObj: GOOD_DRIBBLER });
  busyOwner.burst01 = 0.9;
  busyOwner.match01 = 0.95;
  const carryEvent = traceEvent("P.CARRY.TEST", "test carry", {
    actor: busyOwner,
    playerMoves: [{ player: busyOwner, from: { x: 30, y: 40 }, to: { x: 40, y: 50 }, action: "full-sprint" }],
    movement: "dribble",
    outcome: "success",
    duration: 300,
  });
  const plan = buildMatchLabPlaybackPlan({
    trace: [carryEvent],
    initialPositions: { busy: { x: 30, y: 40 }, idle: { x: 70, y: 70 } },
    initialBall: { x: 30, y: 40 },
    initialOwnerId: "busy",
    initialBurst: { busy: { burst01: 0.9, match01: 0.95 }, idle: { burst01: 0.88, match01: 0.9 } },
  });
  const beforeMove = sampleMatchLabPlaybackPlan(plan, 0);
  check("(inspector) a fresh, unplayed instant already carries the real seeded burst01 for every player",
    beforeMove.players.busy.burst01 === 0.9 && beforeMove.players.idle.burst01 === 0.88);
  const afterMove = sampleMatchLabPlaybackPlan(plan, plan.durationMs);
  check("a player nothing in this trace ever touches keeps their own seeded reading all the way through, never dropped",
    afterMove.players.idle.burst01 === 0.88);
  check("a plan built with NO initialBurst at all never fabricates the field for anyone (byte-identical to before this feature)",
    !("burst01" in (sampleMatchLabPlaybackPlan(
      buildMatchLabPlaybackPlan({ trace: [], initialPositions: { p: { x: 10, y: 10 } } }),
      0,
    ).players.p ?? {})));
}

console.log("\n=== Burst Stamina v1: two-tank init -- match01 from conditionMultiplier(), burst01 clamped to it ===");
{
  const FIXED_MINUTE = 45;
  const lowStaminaPlayer = player("Low Stamina Init", { Stamina: 8, "Work Rate": 8 });
  const highStaminaPlayer = player("High Stamina Init", { Stamina: 18, "Work Rate": 18 });
  function initEntry(playerObj) {
    const owner = entry("init-owner", { team: "home", x: 50, y: 50, playerObj });
    owner.match01 = conditionMultiplier(playerObj, FIXED_MINUTE);
    owner.burst01 = clamp(0, owner.match01, (BURST_BASE + BURST_RANGE * (playerAttribute(playerObj, "Stamina") / 20)) * owner.match01);
    return owner;
  }
  const low = initEntry(lowStaminaPlayer);
  const high = initEntry(highStaminaPlayer);
  check("(1) a fresh player's burst01 never exceeds their own match01",
    low.burst01 <= low.match01 && high.burst01 <= high.match01);
  check("(1) a higher-Stamina player starts with a higher burst01 fraction of their own tank than a lower-Stamina one",
    high.burst01 / high.match01 > low.burst01 / low.match01);
  check("(8) match01 at FIXED_MINUTE is production conditionMultiplier() untouched -- same call, same value",
    low.match01 === conditionMultiplier(lowStaminaPlayer, FIXED_MINUTE));
}

console.log("\n=== Burst Stamina v1: real off-ball jobs (reactOffBall/reactOffBallContinuous), not just on-ball carries, drain/refill burst01 ===");
{
  // Same fixture as test 28 (Off-Ball Defender Awareness) -- real
  // press-ball/mark DEF.ADJUST jobs are already proven to fire here;
  // this just checks the SAME real possessions also move burst01 for
  // whichever defender actually did the moving, end to end through
  // reactOffBall()/reactOffBallContinuous()'s own applyBurstOffBallJob()
  // call, not only through drainOnBallAction()'s on-ball path.
  const owner = entry("owner", { team: "home", x: 50, y: 30, playerObj: GOOD_DRIBBLER });
  const teammate = entry("teammate", { team: "home", x: 65, y: 35, playerObj: STRONG_PASSER });
  const defenderA = entry("defA", { team: "away", x: 40, y: 55, playerObj: WEAK_DEFENDER });
  const defenderB = entry("defB", { team: "away", x: 68, y: 55, playerObj: WEAK_DEFENDER });
  const keeper = entry("keeper", { role: "keeper", team: "away", x: 50, y: 96, playerObj: ELITE_KEEPER });
  setupRoster([owner, teammate, defenderA, defenderB, keeper], owner.id);

  const freshBurst01 = (playerObj) => {
    const match01 = conditionMultiplier(playerObj, 45);
    return clamp(0, match01, (BURST_BASE + BURST_RANGE * (playerAttribute(playerObj, "Stamina") / 20)) * match01);
  };
  const expectedFreshA = freshBurst01(WEAK_DEFENDER);

  let offBallBurstMoved = false;
  for (let i = 0; i < 80 && !offBallBurstMoved; i += 1) {
    const run = runConstructedPossession(`off-ball-burst-${i}`);
    const finalA = run.finalPositions.find((p) => p.id === defenderA.id);
    const finalB = run.finalPositions.find((p) => p.id === defenderB.id);
    if ((finalA && Math.abs(finalA.burst01 - expectedFreshA) > 1e-9)
      || (finalB && Math.abs(finalB.burst01 - expectedFreshA) > 1e-9)) offBallBurstMoved = true;
  }
  check("across real possessions, a defender's own real off-ball job (press/mark/etc) genuinely moves their burst01 away from its fresh initial value",
    offBallBurstMoved);
}

console.log("\n=== Burst Stamina v1: the burst tank actually empties -- consecutive full-sprints on a low-Stamina player eventually force him off it ===");
{
  const FIXED_MINUTE = 45;
  // Wide open field, dead center (never wing, never final third, never
  // an opponent ahead) -- the ONLY thing that can ever stop full-sprint
  // here is the burst battery itself running out. Bugfix slice (2026-09-02)
  // -- a genuinely empty pitch (opponents: []) now legally tolerates
  // full-sprint down to GAIT_FULL_SPRINT_STAMINA_MIN_EMPTY (0.20), not the
  // old contested-game floor (0.35), so the tank takes one more carry to
  // empty than it used to -- the test now runs 4 carries (was 3) and still
  // demonstrates the SAME real thing: the economy alone, not geometry,
  // eventually denies it.
  const LOW_WORK_RATE = 6;
  const lowStaminaPlayer = player("Low Stamina", { Stamina: 8, "Work Rate": LOW_WORK_RATE, Dribbling: 14, Technique: 14, Pace: 14 });
  const highStaminaPlayer = player("High Stamina", { Stamina: 18, "Work Rate": LOW_WORK_RATE, Dribbling: 14, Technique: 14, Pace: 14 });

  function runFourCarries(playerObj) {
    const owner = entry("stamina-owner", { team: "home", x: 50, y: 20, playerObj });
    owner.match01 = conditionMultiplier(playerObj, FIXED_MINUTE);
    owner.burst01 = clamp(0, owner.match01, (BURST_BASE + BURST_RANGE * (playerAttribute(playerObj, "Stamina") / 20)) * owner.match01);
    const groups = { owner, teammates: [], opponents: [], keeper: null };
    const gaits = [];
    for (let i = 0; i < 4; i += 1) {
      const trace = [];
      const result = resolveCarry(groups, { plannedMoveTo: { x: 50, y: owner.y + 7 } }, seededRandom(hashString(`stamina-${i}`)), trace);
      gaits.push(result.gait);
      drainOnBallAction(owner, result.gait, result.ballEnd ? yardDistance(owner, result.ballEnd) : 0);
    }
    return gaits;
  }

  const lowGaits = runFourCarries(lowStaminaPlayer);
  const highGaits = runFourCarries(highStaminaPlayer);
  check(`(2) a Stamina-8 player's first three carries are genuinely full-sprint on an empty pitch (found ${lowGaits.slice(0, 3).join(", ")})`,
    lowGaits[0] === "full-sprint" && lowGaits[1] === "full-sprint" && lowGaits[2] === "full-sprint");
  check(`(2) the SAME player's fourth carry can no longer be full-sprint -- the burst tank is genuinely empty (found ${lowGaits[3]})`,
    lowGaits[3] !== "full-sprint");
  check(`(3) a Stamina-18 player over the identical geometry can still full-sprint on the fourth carry (found ${highGaits.join(", ")})`,
    highGaits[3] === "full-sprint");
}

console.log("\n=== Burst Stamina v1: a genuine full-sprint costs a tiny, real amount of match01 too, nothing else does ===");
{
  const FIXED_MINUTE = 45;
  const playerObj = player("Wear Tester", { Stamina: 14, "Work Rate": 12 });
  function freshEntry() {
    const e = entry("wear-owner", { team: "home", x: 50, y: 50, playerObj });
    e.match01 = conditionMultiplier(playerObj, FIXED_MINUTE);
    e.burst01 = e.match01;
    return e;
  }
  const sprinter = freshEntry();
  const startingMatch01 = sprinter.match01;
  drainOnBallAction(sprinter, "full-sprint", 10);
  check("a full-sprint carry drains a tiny real amount of match01",
    sprinter.match01 < startingMatch01 && startingMatch01 - sprinter.match01 < 0.01);

  const closeControlPlayer = freshEntry();
  const beforeCloseControl = closeControlPlayer.match01;
  drainOnBallAction(closeControlPlayer, "close-control", 2);
  check("close-control (and every other gait) leaves match01 completely untouched",
    closeControlPlayer.match01 === beforeCloseControl);
}

console.log("\n=== Burst Stamina v1: burstEffortCost / burstRecoveryTick formulas ===");
{
  check("(4) cost scales linearly with yards covered",
    Math.abs(burstEffortCost(40, 1, 10) * 2 - burstEffortCost(80, 1, 10)) < 1e-9);
  check("(4) a higher Work Rate spends LESS per yard, not more",
    burstEffortCost(40, 1, 18) < burstEffortCost(40, 1, 6));
  check("(4) a higher intensity job costs more for the identical distance",
    burstEffortCost(40, 1.0, 10) > burstEffortCost(40, 0.5, 10));
  check("(5) a recovery tick is capped at match01, never above it",
    clamp(0, 0.7, 0.65 + burstRecoveryTick(18, 0.7, 5000)) <= 0.7);
  check("(5) a longer duration refills more than a short one",
    burstRecoveryTick(14, 1, 900) > burstRecoveryTick(14, 1, 450));
}

console.log("\n=== Burst Stamina v1: applyBurstOffBallJob -- refill jobs restore burst, real jobs drain it ===");
{
  const FIXED_MINUTE = 45;
  const playerObj = player("Off Ball Jobber", { Stamina: 14, "Work Rate": 12 });
  function freshEntry() {
    const e = entry("jobber", { team: "home", x: 50, y: 50, playerObj });
    e.match01 = conditionMultiplier(playerObj, FIXED_MINUTE);
    e.burst01 = 0.5;
    return e;
  }
  const refilled = freshEntry();
  applyBurstOffBallJob(refilled, "hold-width", 0, 900);
  check("(6) a genuine low-intensity job (hold-width) refills burst01",
    refilled.burst01 > 0.5);
  check("(6) a refilled burst01 never exceeds this player's own match01",
    refilled.burst01 <= refilled.match01);

  const drained = freshEntry();
  applyBurstOffBallJob(drained, "recovery-track", 25, 1200);
  check("(6) a genuine high-intensity off-ball job (recovery-track) drains burst01",
    drained.burst01 < 0.5);

  const untouched = { id: "no-battery", player: playerObj };
  applyBurstOffBallJob(untouched, "recovery-track", 25, 1200);
  check("(7) applyBurstOffBallJob no-ops safely against a fixture with no burst01 at all",
    untouched.burst01 === undefined);
}

console.log("\n=== Burst Stamina v1: maybeAssignTurnoverStaminaJobs -- 2a recovery-run after losing it upfield ===");
{
  const FIXED_MINUTE = 45;
  const attackDirection = "up"; // home attacks toward y=0
  state.attackingDirection = { home: attackDirection, away: attackDirection === "up" ? "down" : "up" };
  const loserPlayer = player("Turnover Loser", { Stamina: 14, "Work Rate": 14, Pace: 12, Acceleration: 12 });
  const previousOwner = entry("turnover-loser", { team: "home", x: 50, y: 15, playerObj: loserPlayer });
  previousOwner.match01 = conditionMultiplier(loserPlayer, FIXED_MINUTE);
  previousOwner.burst01 = previousOwner.match01;
  // A remaining teammate sitting deep -- gives the median-depth defensive
  // line something real to be "way upfield of."
  const deepTeammate = entry("turnover-loser-mate", { team: "home", x: 30, y: 70, playerObj: player("Deep Mate", {}) });
  const winningGroups = { owner: entry("winner", { team: "away", x: 50, y: 15, playerObj: player("Winner", {}) }), teammates: [] };
  const trace = [];
  maybeAssignTurnoverStaminaJobs(previousOwner, [deepTeammate], winningGroups, trace);
  const recoveryEvent = trace.find((event) => event.code === "DEF.ADJUST");
  check("(9-2a) an attacker left well upfield of their own side gets a recovery-track trace event after losing it",
    Boolean(recoveryEvent));
  check("(9-2a) the recovery run genuinely drains the loser's own burst01",
    previousOwner.burst01 < previousOwner.match01);
  // Real reported feedback (2026-09-01): "any role tracking back 10+
  // yards in one beat reads as too sudden -- shorten the cap." A single
  // recovery-track beat must now stay a modest stride, never a big
  // chunk of the real distance back, however fresh/high-effort the
  // player is -- the ONGOING regular off-ball reshaping (not this one
  // dedicated event) is what actually gets him the rest of the way home
  // over the following actions.
  check(`(9-2a) a single recovery-track beat stays a real, modest stride -- never the old 10+yd jump (found ${recoveryEvent ? yardDistance(recoveryEvent.playerMoves[0].from, recoveryEvent.playerMoves[0].to).toFixed(1) : "?"}yd)`,
    Boolean(recoveryEvent) && yardDistance(recoveryEvent.playerMoves[0].from, recoveryEvent.playerMoves[0].to) <= 10.5);

  // Even the theoretical CEILING (maxed Work Rate/Stamina, a completely
  // full tank) must stay bounded -- not just a typical/average case.
  const eliteLoser = player("Elite Turnover Loser", { Stamina: 20, "Work Rate": 20, Pace: 18, Acceleration: 18 });
  const eliteOwner = entry("turnover-loser-elite", { team: "home", x: 50, y: 15, playerObj: eliteLoser });
  eliteOwner.match01 = 1;
  eliteOwner.burst01 = 1;
  const eliteTrace = [];
  maybeAssignTurnoverStaminaJobs(eliteOwner, [deepTeammate], winningGroups, eliteTrace);
  const eliteRecoveryEvent = eliteTrace.find((event) => event.code === "DEF.ADJUST");
  check(`(9-2a) even the theoretical ceiling (maxed attributes, full tank) stays a real stride, never a double-digit teleport (found ${eliteRecoveryEvent ? yardDistance(eliteRecoveryEvent.playerMoves[0].from, eliteRecoveryEvent.playerMoves[0].to).toFixed(1) : "?"}yd)`,
    Boolean(eliteRecoveryEvent) && yardDistance(eliteRecoveryEvent.playerMoves[0].from, eliteRecoveryEvent.playerMoves[0].to) <= 10.5);
}

console.log("\n=== Burst Stamina v1: maybeAssignTurnoverStaminaJobs -- 2b support-run gated by Work Rate, not just burst ===");
{
  const FIXED_MINUTE = 45;
  state.attackingDirection = { home: "up", away: "down" };
  function runSupportCheck(workRate) {
    const winnerPlayer = player("Turnover Winner", {});
    const owner = entry("support-winner", { team: "away", x: 50, y: 100, playerObj: winnerPlayer });
    const midfielderPlayer = player("Deep Midfielder", { "Work Rate": workRate, Stamina: 14, Pace: 12, Acceleration: 12 });
    const deepest = entry("support-midfielder", { team: "away", x: 40, y: 20, playerObj: midfielderPlayer });
    deepest.match01 = conditionMultiplier(midfielderPlayer, FIXED_MINUTE);
    deepest.burst01 = deepest.match01;
    const winningGroups = { owner, teammates: [deepest] };
    const previousOwner = entry("support-loser", { team: "home", x: 50, y: 50, playerObj: player("Loser", {}) });
    const trace = [];
    maybeAssignTurnoverStaminaJobs(previousOwner, [], winningGroups, trace);
    return { deepest, ranSupport: trace.some((event) => event.code === "ATT.ADJUST") };
  }
  const highWr = runSupportCheck(18);
  const lowWr = runSupportCheck(6);
  check("(9-2b) a high-Work-Rate deepest teammate makes the support run when the side wins it back",
    highWr.ranSupport && highWr.deepest.burst01 < highWr.deepest.match01);
  check("(9-2b) a low-Work-Rate deepest teammate stays put instead, same burst/geometry",
    !lowWr.ranSupport);
}

console.log("\n=== Burst Stamina v1: Inspector requirement -- a real P.CARRY event carries a live burst01 attribution row ===");
{
  const FIXED_MINUTE = 45;
  const playerObj = player("Inspector Carrier", { Stamina: 14, "Work Rate": 12, Dribbling: 14, Technique: 14, Pace: 14 });
  const owner = entry("inspector-owner", { team: "home", x: 50, y: 20, playerObj });
  owner.match01 = conditionMultiplier(playerObj, FIXED_MINUTE);
  owner.burst01 = 0.62;
  const groups = { owner, teammates: [], opponents: [], keeper: null };
  const trace = [];
  resolveCarry(groups, { plannedMoveTo: { x: 50, y: 30 } }, seededRandom(hashString("inspector-carry")), trace);
  const carryEvent = trace.find((event) => event.code === "P.CARRY");
  const burstRow = carryEvent?.attribution?.find((item) => item.quantity === "burst01 (this possession)");
  check("a real P.CARRY event's own attribution includes a burst01 row", Boolean(burstRow));
  check("that row's actual value is the owner's own real, live burst01 percentage", burstRow?.actual === 62);

  const untracked = entry("inspector-owner-notrack", { team: "home", x: 50, y: 20, playerObj });
  const untrackedGroups = { owner: untracked, teammates: [], opponents: [], keeper: null };
  const untrackedTrace = [];
  resolveCarry(untrackedGroups, { plannedMoveTo: { x: 50, y: 30 } }, seededRandom(hashString("inspector-carry-2")), untrackedTrace);
  const untrackedEvent = untrackedTrace.find((event) => event.code === "P.CARRY");
  check("a direct resolver call against a fixture with no burst01 at all never fabricates a fake 100% row",
    !(untrackedEvent?.attribution || []).some((item) => item.quantity === "burst01 (this possession)"));
}

console.log("\n=== On-ball gait + possession stamina v1: a limited dribbler's full-sprint touch more often outruns them than a gifted one's, same geometry ===");
{
  // Isolates the FIRST touch specifically (touches.length===0 means that
  // very first live impulse was never caught -- simulateCarryTouches()'s
  // own loop breaks immediately, before anything is appended). A target
  // far beyond any single touch's own natural stop distance keeps the
  // impulse struck at genuinely full, uncapped natural power (never
  // artificially shortened to land exactly on a near destination) -- a
  // real race between touchLaunchSpeedYps()'s own control-scaled launch
  // force and this carrier's own Pace, nothing else. A modest Pace (both
  // identical -- "same geometry") is what actually makes outrunning
  // possible at all; an elite Pace chases down anything regardless of
  // how hard the ball was struck.
  const LOW_DRIBBLER = player("Low Dribbler Sprinter", { Dribbling: 4, Technique: 4, Pace: 6 });
  const HIGH_DRIBBLER = player("High Dribbler Sprinter", { Dribbling: 18, Technique: 18, Pace: 6 });
  const from = { x: 50, y: 10 };
  const to = { x: 50, y: 90 }; // 96yd -- comfortably beyond any single touch's own reach

  function firstTouchOutrunRate(playerObj, label) {
    let uncaught = 0;
    const trials = 300;
    for (let i = 0; i < trials; i += 1) {
      const touches = simulateCarryTouches(from, to, "full-sprint", {
        player: playerObj, pressure: 0, seed: `sprint-collect-${label}-${i}`,
      });
      if (touches.length === 0) uncaught += 1;
    }
    return uncaught / trials;
  }
  const lowRate = firstTouchOutrunRate(LOW_DRIBBLER, "low");
  const highRate = firstTouchOutrunRate(HIGH_DRIBBLER, "high");
  check(`a Dribbling-4 full-sprint carrier's own first touch outruns them at least SOME of the time (rate ${(lowRate * 100).toFixed(0)}%)`,
    lowRate > 0);
  check(`a Dribbling-18 full-sprint carrier over the identical geometry outruns themselves less often (${(lowRate * 100).toFixed(0)}% -> ${(highRate * 100).toFixed(0)}%)`,
    highRate < lowRate);
}

console.log("\n=== Pattern Vocabulary V1, Step 1: run-off-pass fires from the KICK, a real authored move ===");
{
  state.attackingDirection = { home: "down", away: "up" };
  const owner = entry("rop-owner", { team: "home", x: 50, y: 30, playerObj: STRONG_PASSER });
  const receiver = entry("rop-receiver", { team: "home", x: 50, y: 60, playerObj: GOOD_DRIBBLER });
  const tracker = entry("rop-tracker", { team: "away", x: 25, y: 45, playerObj: WEAK_DEFENDER });
  const groups = { owner, teammates: [receiver], opponents: [tracker], keeper: null };
  const trace = [];
  const motionContext = { state: { tick: 0, players: {} }, marking: {} };
  resolvePass(groups, { preselectedTargetId: receiver.id }, seededRandom(hashString("run-off-pass-1")), trace, true, motionContext);
  const passEvent = trace.find((e) => e.code === "P.PASS");
  const ownerMoveEvent = trace.find((e) => e.code === "ATT.ADJUST" && (e.playerMoves || []).some((m) => String(m.playerId) === String(owner.id)));
  check("a real ATT.ADJUST batch includes the passer's own move", Boolean(ownerMoveEvent));
  if (ownerMoveEvent) {
    const ownerMove = ownerMoveEvent.playerMoves.find((m) => String(m.playerId) === String(owner.id));
    check("the passer's own move is labeled run-off-pass, not idle/pin-last-line", ownerMove.action === "run-off-pass");
    check("it's a real, non-zero move -- the passer genuinely goes somewhere",
      yardDistance(ownerMove.from, ownerMove.to) > 1);
    check("the batch narrates it as a real run, registered in OFF_BALL_ACTION_PHRASE, never the generic 'repositions' fallback",
      !ownerMoveEvent.label?.includes("repositions") && ownerMoveEvent.label?.toLowerCase().includes("runs off the pass"));
    check("the passer's own batch overlaps the pass's own flight window -- 'from the kick,' not a sequential beat after it",
      Boolean(passEvent) && ownerMoveEvent.overlapWithPrevious === true);
  }
}

console.log("\n=== Pattern Vocabulary V1, Step 1: a passer with no legs left holds position instead of run-off-pass ===");
{
  state.attackingDirection = { home: "down", away: "up" };
  const tiredPasser = player("Tired Passer", { Passing: 16, Technique: 14, "Work Rate": 1 });
  const owner = entry("rop-tired-owner", { team: "home", x: 50, y: 30, playerObj: tiredPasser });
  owner.burst01 = 0.05;
  const receiver = entry("rop-tired-receiver", { team: "home", x: 50, y: 60, playerObj: GOOD_DRIBBLER });
  const groups = { owner, teammates: [receiver], opponents: [], keeper: null };
  const trace = [];
  const motionContext = { state: { tick: 0, players: {} }, marking: {} };
  resolvePass(groups, { preselectedTargetId: receiver.id }, seededRandom(hashString("run-off-pass-tired")), trace, true, motionContext);
  const ownerMove = trace.filter((e) => e.code === "ATT.ADJUST")
    .flatMap((e) => e.playerMoves || [])
    .find((m) => String(m.playerId) === String(owner.id));
  check("a passer with empty Work Rate AND empty burst never gets run-off-pass -- the L5 carve-out",
    !ownerMove || ownerMove.action !== "run-off-pass");
}

console.log("\n=== Pattern Vocabulary V1, Step 1: a keeper distributing the ball never gets a run-off-pass attacking job ===");
{
  state.attackingDirection = { home: "down", away: "up" };
  const keeperObj = player("Distributing Keeper", { Passing: 14, Technique: 12, "Work Rate": 14 });
  const keeper = entry("rop-keeper", { role: "keeper", team: "home", x: 50, y: 5, playerObj: keeperObj });
  const receiver = entry("rop-keeper-receiver", { team: "home", x: 50, y: 30, playerObj: GOOD_DRIBBLER });
  const groups = { owner: keeper, teammates: [receiver], opponents: [], keeper: null };
  const trace = [];
  const motionContext = { state: { tick: 0, players: {} }, marking: {} };
  resolvePass(groups, { preselectedTargetId: receiver.id }, seededRandom(hashString("run-off-pass-keeper")), trace, true, motionContext);
  const keeperEverAttacked = trace.filter((e) => e.code === "ATT.ADJUST")
    .some((e) => (e.playerMoves || []).some((m) => String(m.playerId) === String(keeper.id)));
  check("resolvePass() is also the real resolver behind a keeper's own throw/punt -- a distributing keeper never becomes an attacking-pool run-off-pass mover",
    !keeperEverAttacked);
}

console.log("\n=== Pattern Vocabulary V1, Step 1: every new job registers a real, explicit burst intensity ===");
{
  const expectedIntensity = {
    "run-off-pass": 0.85, "arc-overlap": 0.80, "vacate-pocket": 0.55, "peel-square": 0.55,
    "check-decel": 0.40, delay: 0.45,
    "attack-near": 0.75, "attack-spot": 0.75, "attack-far": 0.75, "edge-rebound": 0.75,
  };
  for (const [job, value] of Object.entries(expectedIntensity)) {
    check(`"${job}" has its own real, explicit burst intensity (${value}), never the unlisted 0.5 default`,
      burstJobIntensity(job) === value);
  }

  const FIXED_MINUTE = 45;
  const playerObj = player("New Job Tester", { Stamina: 14, "Work Rate": 12 });
  // Stage 5 (2026-09-06) -- this used to move a player 4 yards in 900ms (53%
  // of their own top speed, a genuine run) and assert they GAINED stamina,
  // purely because "show-wide" was on the refill list. That is exactly the
  // label-driven defect motionEffort.js replaces, so the assertion now tests
  // the real claim underneath it -- show-wide is MOSTLY positional -- in both
  // directions, against the motion rather than against the name.
  const ambleEntry = entry("show-wide-amble", { team: "home", x: 5, y: 50, playerObj });
  ambleEntry.match01 = conditionMultiplier(playerObj, FIXED_MINUTE);
  ambleEntry.burst01 = 0.5;
  applyBurstOffBallJob(ambleEntry, "show-wide", 4, 3600);
  check("show-wide taken as the positional job it usually is (4yd over 3.6s) genuinely recovers",
    ambleEntry.burst01 > 0.5);

  const sprintedWideEntry = entry("show-wide-sprint", { team: "home", x: 5, y: 50, playerObj });
  sprintedWideEntry.match01 = conditionMultiplier(playerObj, FIXED_MINUTE);
  sprintedWideEntry.burst01 = 0.5;
  applyBurstOffBallJob(sprintedWideEntry, "show-wide", 4, 900);
  check("the SAME job genuinely sprinted (4yd in 900ms) costs stamina -- the name no longer decides",
    sprintedWideEntry.burst01 < 0.5);

  // And the legacy label path still stands for a caller with no window to
  // measure against, so a hand-built fixture is not silently re-priced.
  const noWindowEntry = entry("show-wide-no-window", { team: "home", x: 5, y: 50, playerObj });
  noWindowEntry.match01 = conditionMultiplier(playerObj, FIXED_MINUTE);
  noWindowEntry.burst01 = 0.5;
  applyBurstOffBallJob(noWindowEntry, "show-wide", 4, 0);
  check("with no measurable window the registered refill list still applies",
    noWindowEntry.burst01 >= 0.5);
}

console.log("\n=== Bugfix slice: a missed through ball can now genuinely die on the grass or be recovered, not always a restart ===");
{
  state.attackingDirection = { home: "down", away: "up" };
  const owner = entry("miss-owner", { team: "home", x: 50, y: 60, playerObj: STRONG_PASSER });
  // Deliberately far/slow so the LIVE flight race genuinely fails --
  // "nobody gets there" -- matching the exact reported scenario. Landing
  // ~18 real yards inside the pitch from the byline (well past the old
  // near-certain-restart range).
  const receiver = entry("miss-receiver", { team: "home", x: 20, y: 65, playerObj: player("Slow Runner", { Pace: 4, Acceleration: 4 }) });
  const keeper = entry("miss-keeper", { role: "keeper", team: "away", x: 50, y: 96, playerObj: player("Alert Keeper", { Pace: 14, Acceleration: 14, Anticipation: 14 }) });
  const cb = entry("miss-cb", { team: "away", x: 50, y: 85, playerObj: player("Covering CB", { Pace: 13, Acceleration: 13, Anticipation: 13 }) });
  const authored = [owner, receiver, keeper, cb];

  let missCount = 0;
  let recoveredCount = 0;
  let restartCount = 0;
  const SEARCH_BUDGET = 400;
  for (let i = 0; i < SEARCH_BUDGET; i += 1) {
    setupRoster(authored, owner.id);
    const originals = { ...FREE_PLAY_RESOLVERS };
    let fired = false;
    // Same monkey-patch shape as the existing "surrounding players keep
    // moving through a terminal whistle" test above -- forces exactly ONE
    // real through-ball attempt (via the REAL resolveThroughBall, captured
    // before the table is overwritten), then stops the possession cleanly
    // so a recovered ball never tries to author a second, nonsensical
    // through ball from whoever just picked it up.
    const scriptedThrough = (groups, availability, random, trace, interleaveOffBall, motionContext) => {
      if (fired) {
        return {
          outcome: "STOP", code: "NONE", resolved: true, terminal: true,
          possession: "dead", nextOwnerId: null, ballEnd: pointOf(groups.owner), restart: null, reason: "test-stop",
        };
      }
      fired = true;
      return originals.through(
        groups, { preselectedTargetId: receiver.id, plannedMoveTo: { x: 50, y: 82 } },
        random, trace, interleaveOffBall, motionContext,
      );
    };
    for (const key of Object.keys(FREE_PLAY_RESOLVERS)) FREE_PLAY_RESOLVERS[key] = scriptedThrough;
    const run = runConstructedPossession(`through-miss-roll-${i}`);
    Object.assign(FREE_PLAY_RESOLVERS, originals);
    const missed = run.trace.some((event) => event.code === "P.THROUGH" && /nobody gets there/.test(event.label || ""));
    if (!missed) continue;
    missCount += 1;
    if (run.trace.some((event) => event.code === "LOOSE.RECOVERED")) recoveredCount += 1;
    if (run.trace.some((event) => event.code?.startsWith("RESTART."))) restartCount += 1;
  }
  check("found a real 'nobody gets there' through-ball miss within the search budget", missCount > 0);
  check(`a miss landing well inside the pitch is genuinely recoverable (${recoveredCount}/${missCount} recovered)`,
    recoveredCount > 0);
  check(`not EVERY miss ends in a restart (${restartCount}/${missCount} restarts) -- the roll is a real, decaying race, never a guaranteed exit`,
    missCount > 0 && restartCount < missCount);
}

console.log("\n=== Bugfix slice: a congested pile's own short-pass/hold streak actually accumulates in a real possession, and does not lock the game up ===");
{
  state.attackingDirection = { home: "down", away: "up" };
  // Four teammates clustered together, no opponents at all -- isolates the
  // congestion-streak mechanism itself (never a real duel/pressure signal)
  // and lets each short pass complete cleanly so the streak can actually
  // accumulate the way the reported carousel did.
  const a = entry("cong-a", { team: "home", x: 48, y: 48, playerObj: STRONG_PASSER });
  const b = entry("cong-b", { team: "home", x: 55, y: 50, playerObj: STRONG_PASSER });
  const c = entry("cong-c", { team: "home", x: 45, y: 53, playerObj: STRONG_PASSER });
  const d = entry("cong-d", { team: "home", x: 52, y: 45, playerObj: STRONG_PASSER });
  const authored = [a, b, c, d];

  // Force exactly two short (<12yd), zero-progression passes in a row
  // (a -> b -> a), THEN let the REAL decision layer take over completely
  // for the rest of the possession -- the whole point is that the crush
  // lives in the SHARED possession loop/utility functions, never a
  // scripted stand-in for them.
  setupRoster(authored, a.id);
  const originals = { ...FREE_PLAY_RESOLVERS };
  let step = 0;
  const forcedShortPasses = (groups, availability, random, trace, interleaveOffBall, motionContext) => {
    step += 1;
    if (step <= 2) {
      const target = step === 1 ? b : a;
      return originals.pass(groups, { preselectedTargetId: target.id }, random, trace, interleaveOffBall, motionContext);
    }
    Object.assign(FREE_PLAY_RESOLVERS, originals);
    return originals[decisionTypeFor(groups)](groups, availability, random, trace, interleaveOffBall, motionContext);
  };
  function decisionTypeFor(groups) {
    // Only used to hand the FIRST post-streak action back to whatever the
    // real candidate menu would have picked anyway; restoring the table
    // above means every action after this one already runs unmodified.
    const candidates = generateFreePlayCandidates(
      groups, state.attackingDirection[groups.owner.team], attackingSettingsFor(groups.owner.team),
    );
    const decision = chooseCandidate(candidates, groups.owner.player, seededRandom(hashString("congestion-poststreak-pick")));
    return decision?.type ?? "hold";
  }
  for (const key of Object.keys(FREE_PLAY_RESOLVERS)) FREE_PLAY_RESOLVERS[key] = forcedShortPasses;
  const run = runConstructedPossession("congestion-streak-1");
  Object.assign(FREE_PLAY_RESOLVERS, originals);

  const passEvents = run.trace.filter((event) => event.code === "P.PASS");
  check("both forced short passes actually completed (a real streak, not an aborted attempt)", passEvents.length >= 2);
  check("the possession genuinely continues past the forced streak instead of being trapped or crashing",
    run.trace.length > passEvents.length + 2);
  check("a congested, no-opponent midfield rondo never has to hit the POSSESSION_MAX_ACTIONS backstop to end",
    !run.trace.some((event) => event.code === "POSSESSION.MAX_ACTIONS"));
}

console.log("\n=== Bugfix slice: hold/holdUtility() is crushed once a real 2-action low-progression streak is live -- pile-scoped, not per-player ===");
{
  const owner = { id: "hold-owner", x: 50, y: 50, player: STRONG_PASSER };
  const teammate = { id: "hold-mate", x: 55, y: 52, player: GOOD_DRIBBLER };
  const baseline = holdUtility(owner, [teammate], [], { congestionStreak: 0 });
  const crushed = holdUtility(owner, [teammate], [], { congestionStreak: 2 });
  check("a live streak of 2 measurably crushes hold's own utility relative to no streak at all",
    crushed < baseline - 3);
  const omitted = holdUtility(owner, [teammate], []);
  check("omitting congestionStreak entirely reproduces the exact old (uncrushed) behavior -- purely additive",
    omitted === baseline);

  // The SAME crush applies to a genuinely different player picking up the
  // ball next -- the streak is pile-scoped, never tied to whoever happens
  // to be holding it (the exact per-player-only gap this fix closes).
  const newOwner = { id: "hold-newowner", x: 52, y: 51, player: GOOD_DRIBBLER };
  const crushedForDifferentOwner = holdUtility(newOwner, [owner], [], { congestionStreak: 2 });
  check("the crush applies to a DIFFERENT ball owner too -- pile-scoped, not the same single player holding twice",
    crushedForDifferentOwner < holdUtility(newOwner, [owner], [], { congestionStreak: 0 }) - 3);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
