// Contact, Ownership & Continuation tests -- see MATCH_LAB_PLAN.md,
// "Contact, Ownership & Continuation" (2026-08-17). Same three-layer
// pattern as the Cross Resolution / Spatial Decision Intelligence suites:
// pure matchEngineCore.js resolver tests (resolveClearanceAttempt),
// pure spatialDecision.js geometry tests (clearanceDanger,
// generateClearanceCandidates), and full match-lab.js integration tests
// (resolveCross()/resolveReboundScramble() end to end, via the same
// fake-DOM stub every other Match Lab suite uses). Pass B (dynamic aerial
// positioning/defender recovery) and Pass C (goalkeeper command of
// crosses) are still explicitly NOT covered here -- not built yet.
import { hashString, playerAttribute, seededRandom } from "../src/lib/matchEngineCore.js";
import { resolveClearanceAttempt } from "../src/lib/matchEngineCore.js";
import { clearanceDanger, generateClearanceCandidates, yardDistance } from "../src/lib/spatialDecision.js";
import { buildMatchLabPlaybackPlan } from "../src/lib/matchLabPlayback.js";

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
const {
  state, resolveCross, resolveShoot, resolveReboundScramble, resolveAerialClearanceContinuation,
  freePlayGroups, pointOf, zoneFromPercent, playbackPositions, applyStepAnimation, seedPlaybackPositions,
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
function setupRoster(entries, ownerId) {
  state.roster = entries;
  state.ball = { x: 50, y: 50, zone: zoneFromPercent(50, 50), ownerId };
  state.attackingDirection = { home: "down", away: "up" };
}

const ELITE_DEFENDER = player("Ferdinand", { Tackling: 18, Positioning: 18, Anticipation: 17, Aggression: 12, Bravery: 15, Heading: 17, Passing: 15, Technique: 14, Composure: 16, Decisions: 15 });
const WEAK_DEFENDER = player("Weak Defender", { Tackling: 6, Positioning: 6, Anticipation: 6, Aggression: 8, Bravery: 8, Heading: 6, Passing: 6, Technique: 6, Composure: 6, Decisions: 6 });
const GOOD_CROSSER = player("Beckham", { Crossing: 18, Technique: 16, Decisions: 15, Composure: 15, Balance: 15 });
const AVERAGE = player("Cardozo", { Heading: 13, Anticipation: 12, Acceleration: 12, "Off the Ball": 12, Positioning: 11, Strength: 11 });
const ELITE_KEEPER = player("Howard", { Reflexes: 19, Positioning: 18, Handling: 17, Agility: 17, Anticipation: 16 });
const POACHER = player("Gerrard", { Anticipation: 16, Acceleration: 15, "Off the Ball": 16, Finishing: 16, Composure: 15 });

console.log("=== matchEngineCore.js: resolveClearanceAttempt -- tier separation + determinism per action ===");
{
  function cleanRate(action, defender, runs = 800) {
    const random = seededRandom(hashString(`clearance-tier-${action}-${defender.canonical_player_name}`));
    let clean = 0;
    for (let i = 0; i < runs; i += 1) {
      const outcome = resolveClearanceAttempt(defender, action, { pressureFactor: 0.2, distanceYards: 30 }, random);
      if (outcome.clean || outcome.complete || outcome.controlled) clean += 1;
    }
    return clean / runs;
  }
  check("a better header of the ball clears long more reliably than a weak one",
    cleanRate("clear-long", ELITE_DEFENDER) > cleanRate("clear-long", WEAK_DEFENDER) + 0.2);
  check("a better passer completes a pass to a teammate more reliably than a weak one",
    cleanRate("pass-teammate", ELITE_DEFENDER) > cleanRate("pass-teammate", WEAK_DEFENDER) + 0.2);
  check("better technique/composure brings the ball under control more reliably",
    cleanRate("control", ELITE_DEFENDER) > cleanRate("control", WEAK_DEFENDER) + 0.2);
  check("clear-behind always finds touch -- a deliberate, low-risk choice, nothing to roll",
    resolveClearanceAttempt(WEAK_DEFENDER, "clear-behind", {}, () => 0.999).clean === true);

  const r1 = seededRandom(hashString("clearance-determinism"));
  const r2 = seededRandom(hashString("clearance-determinism"));
  const a = resolveClearanceAttempt(ELITE_DEFENDER, "clear-long", { pressureFactor: 0.3, distanceYards: 35 }, r1);
  const b = resolveClearanceAttempt(ELITE_DEFENDER, "clear-long", { pressureFactor: 0.3, distanceYards: 35 }, r2);
  check("identical seed reproduces an identical clearance-attempt result", JSON.stringify(a) === JSON.stringify(b));

  check("more pressure reduces clear-long/touchline quality",
    (() => {
      const random = seededRandom(hashString("clearance-pressure"));
      const low = cleanRateInline(random, "clear-long", ELITE_DEFENDER, 0.05);
      const high = cleanRateInline(random, "clear-long", ELITE_DEFENDER, 0.9);
      return low > high;
    })());
  function cleanRateInline(random, action, defender, pressureFactor) {
    let clean = 0;
    const localRandom = seededRandom(hashString(`clearance-pressure-${pressureFactor}`));
    for (let i = 0; i < 500; i += 1) {
      const outcome = resolveClearanceAttempt(defender, action, { pressureFactor, distanceYards: 30 }, localRandom);
      if (outcome.clean) clean += 1;
    }
    return clean / 500;
  }
}

console.log("\n=== spatialDecision.js: clearanceDanger -- proximity to own goal + attacking pressure ===");
{
  const deepInOwnBox = { x: 50, y: 5 }; // "down"-attacking side defends near y:0
  const midfield = { x: 50, y: 50 };
  check("a contact point deep in the defender's own box reads as more dangerous than one at midfield",
    clearanceDanger(deepInOwnBox, [], "down") > clearanceDanger(midfield, [], "down"));
  const attackerRightThere = [{ x: 50, y: 6 }];
  check("real attacking pressure on the contact point increases danger over the same point with nobody near it",
    clearanceDanger(deepInOwnBox, attackerRightThere, "down") > clearanceDanger(deepInOwnBox, [], "down"));
}

console.log("\n=== spatialDecision.js: generateClearanceCandidates -- availability gates + attribute bias ===");
{
  const contactPoint = { x: 50, y: 8 };
  const base = { attackers: [], defendingDirection: "down", danger: 0.8 };
  const noTeammatesNoKeeper = generateClearanceCandidates(contactPoint, { ...base, teammates: [], keeper: null, defenderPlayer: AVERAGE });
  check("pass-teammate is never offered with no real teammate placed", !noTeammatesNoKeeper.some((c) => c.type === "pass-teammate"));
  check("pass-keeper is never offered with no real keeper placed", !noTeammatesNoKeeper.some((c) => c.type === "pass-keeper"));

  const teammate = { x: 40, y: 20 };
  const keeper = { x: 50, y: 2 };
  const withBoth = generateClearanceCandidates(contactPoint, { ...base, teammates: [teammate], keeper, defenderPlayer: AVERAGE });
  check("pass-teammate is offered once a real teammate is placed", withBoth.some((c) => c.type === "pass-teammate" && c.target === teammate));
  check("pass-keeper is offered once a real keeper is placed", withBoth.some((c) => c.type === "pass-keeper" && c.target === keeper));

  // Same geometry, only the defender's own attributes differ -- a strong
  // header of the ball should rate clear-long more attractive than a weak
  // one does, and a strong passer should rate pass-teammate more
  // attractive than a weak one does (Contact, Ownership & Continuation's
  // own explicit, scoped exception to this file's ability-blind
  // principle).
  const eliteCandidates = generateClearanceCandidates(contactPoint, { ...base, teammates: [teammate], keeper, defenderPlayer: ELITE_DEFENDER });
  const weakCandidates = generateClearanceCandidates(contactPoint, { ...base, teammates: [teammate], keeper, defenderPlayer: WEAK_DEFENDER });
  const utilityOf = (list, type) => list.find((c) => c.type === type).utility;
  check("a better header of the ball rates clearing long more attractive than a weak one, same geometry",
    utilityOf(eliteCandidates, "clear-long") > utilityOf(weakCandidates, "clear-long"));
  check("a better passer rates finding a teammate more attractive than a weak one, same geometry",
    utilityOf(eliteCandidates, "pass-teammate") > utilityOf(weakCandidates, "pass-teammate"));
}

console.log("\n=== match-lab.js integration: header contact continuity (point 2) ===");
{
  // Reported trace #1 -- Cardozo attacking a cross, Ferdinand challenging
  // him, Howard the keeper in goal. The header contest must show BOTH
  // Cardozo and Ferdinand genuinely converging on ONE authoritative
  // contact point, and whichever of them wins, the very next event
  // (header attempt or defensive continuation) must begin exactly there.
  const crosser = entry("crosser", { team: "home", x: 85, y: 60, playerObj: GOOD_CROSSER });
  const cardozo = entry("cardozo", { team: "home", x: 50, y: 6, playerObj: AVERAGE });
  const ferdinand = entry("ferdinand", { team: "away", x: 49, y: 7, playerObj: ELITE_DEFENDER });
  const howard = entry("howard", { role: "keeper", team: "away", x: 50, y: 2, playerObj: ELITE_KEEPER });
  const groups = { owner: crosser, teammates: [cardozo], opponents: [ferdinand], keeper: howard };

  let sawHeaderEvent = false;
  let ballArrivesBeforeContact = true;
  let contactEndpointsAgree = true;
  let bothPlayersConverge = true;
  let winnerNamedCorrectly = true;
  let nextFlightStartsAtContact = true;
  for (let i = 0; i < 200; i += 1) {
    const random = seededRandom(hashString(`contact-continuity-header-${i}`));
    const trace = [];
    resolveCross(groups, {}, random, trace);
    const headerEvent = trace.find((event) => event.code === "X1.R" || event.code === "X1.D");
    if (!headerEvent) continue;
    sawHeaderEvent = true;
    const deliveryEvent = trace.find((event) => event.code === "CROSS.DELIVERY");
    if (!(deliveryEvent.ballTo.x === headerEvent.contact.point.x && deliveryEvent.ballTo.y === headerEvent.contact.point.y)) ballArrivesBeforeContact = false;
    if (!(headerEvent.ballFrom.x === headerEvent.contact.point.x && headerEvent.ballTo.x === headerEvent.contact.point.x)) contactEndpointsAgree = false;
    if (!(headerEvent.playerMoves.length === 2
      && headerEvent.playerMoves.every((m) => m.to.x === headerEvent.contact.point.x && m.to.y === headerEvent.contact.point.y)
      && new Set(headerEvent.playerMoves.map((m) => m.playerId)).size === 2)) bothPlayersConverge = false;
    const expectedWinnerId = headerEvent.code === "X1.R" ? cardozo.id : ferdinand.id;
    if (headerEvent.contact.actorId !== expectedWinnerId) winnerNamedCorrectly = false;
    if (headerEvent.code === "X1.R") {
      const nextEvent = trace[trace.indexOf(headerEvent) + 1];
      if (!(nextEvent.ballFrom.x === headerEvent.contact.point.x && nextEvent.ballFrom.y === headerEvent.contact.point.y)) nextFlightStartsAtContact = false;
    }
  }
  check("exercised at least one real header contest within the search budget", sawHeaderEvent);
  check("across every trial: ball arrives at the contact point BEFORE contact (delivery's ballTo === header event's contact point)", ballArrivesBeforeContact);
  check("across every trial: the header event's own ballFrom/ballTo both equal its contact point", contactEndpointsAgree);
  check("across every trial: playerMoves names exactly Cardozo and Ferdinand, both moving to the SAME contact point", bothPlayersConverge);
  check("across every trial: contact.actorId is the actual winner (X1.R -> Cardozo, X1.D -> Ferdinand)", winnerNamedCorrectly);
  check("across every X1.R trial: the header/shot attempt that follows begins exactly at the contact point", nextFlightStartsAtContact);
}

console.log("\n=== match-lab.js integration: defensive aerial continuation reachability + correctness (point 4) ===");
{
  const crosser = entry("crosser", { team: "home", x: 85, y: 60, playerObj: GOOD_CROSSER });
  const cardozo = entry("cardozo", { team: "home", x: 50, y: 6, playerObj: AVERAGE });
  const ferdinand = entry("ferdinand", { team: "away", x: 49, y: 7, playerObj: ELITE_DEFENDER });
  const ferdinandTeammate = entry("terry", { team: "away", x: 55, y: 20, playerObj: ELITE_DEFENDER });
  const howard = entry("howard", { role: "keeper", team: "away", x: 50, y: 2, playerObj: ELITE_KEEPER });
  const groups = { owner: crosser, teammates: [cardozo], opponents: [ferdinand, ferdinandTeammate], keeper: howard };

  const seenReasons = new Set();
  const allResults = [];
  let realTracePlansContinuous = true;
  for (let i = 0; i < 1500; i += 1) {
    const random = seededRandom(hashString(`defensive-continuation-${i}`));
    const trace = [];
    const result = resolveCross(groups, {}, random, trace);
    if (result.reason && result.reason.startsWith("clearance-")) {
      seenReasons.add(result.reason);
      allResults.push({ result, trace });
      if (allResults.length <= 80) {
        try {
          buildMatchLabPlaybackPlan({
            trace,
            initialPositions: Object.fromEntries([crosser, cardozo, ferdinand, ferdinandTeammate, howard]
              .map((item) => [item.id, pointOf(item)])),
            initialBall: pointOf(crosser), initialOwnerId: crosser.id,
            finalOwnerId: result.nextOwnerId, restart: result.restart,
          });
        } catch {
          realTracePlansContinuous = false;
        }
      }
    }
  }
  check("multiple distinct defensive continuation actions are structurally reachable across trials",
    seenReasons.size >= 3);
  check("resolved cross/aerial/defensive-continuation traces compile into contact-continuous playback plans",
    realTracePlansContinuous);

  // Per-reason invariants, checked across every trial that produced that
  // reason -- aggregated to one PASS/FAIL per invariant rather than one
  // per trial (hundreds of trials would otherwise repeat the identical
  // check hundreds of times).
  const byReason = {};
  for (const { result, trace } of allResults) {
    const clearanceEvent = trace.find((event) => event.contact
      && (event.contact.type === "clearance" || event.contact.type === "control"));
    if (!clearanceEvent) continue;
    const bucket = byReason[result.reason] || (byReason[result.reason] = []);
    bucket.push({ result, clearanceEvent });
  }
  const all = (list, predicate) => list.length > 0 && list.every(predicate);

  if (byReason["clearance-behind"]) {
    check("clearance-behind: every trial is a genuine out-of-play result (no owner, restart: corner)",
      all(byReason["clearance-behind"], ({ result }) => result.nextOwnerId === null && result.restart === "corner"));
    check('clearance-behind: the label genuinely says "clears" -- a real destination/flight exists here',
      all(byReason["clearance-behind"], ({ clearanceEvent }) => /clears/i.test(clearanceEvent.label)
        && Boolean(clearanceEvent.ballFrom) && Boolean(clearanceEvent.ballTo)
        && (clearanceEvent.ballFrom.x !== clearanceEvent.ballTo.x || clearanceEvent.ballFrom.y !== clearanceEvent.ballTo.y)
        && !clearanceEvent.moverId));
  }
  if (byReason["clearance-touchline-out"]) {
    check("clearance-touchline-out: every trial is a genuine out-of-play result (no owner, restart: throw-in)",
      all(byReason["clearance-touchline-out"], ({ result }) => result.nextOwnerId === null && result.restart === "throw-in"));
  }
  const looseClearances = [...(byReason["clearance-clear-long"] || []), ...(byReason["clearance-clear-touchline"] || [])];
  if (looseClearances.length) {
    check("clearance-clear-long/touchline: every trial is a genuinely loose (no recontest modeled) result -- no owner, no restart",
      all(looseClearances, ({ result }) => result.nextOwnerId === null && result.restart === null && result.possession === "loose"));
  }
  if (byReason["clearance-control"]) {
    check("clearance-control: every trial keeps the SAME defender as owner, at the contact point, with no ball flight",
      all(byReason["clearance-control"], ({ result, clearanceEvent }) => result.nextOwnerId === ferdinand.id && result.ballEnd.x === clearanceEvent.contact.point.x));
    check('clearance-control: the label never says "clears" -- no destination/flight exists here',
      all(byReason["clearance-control"], ({ clearanceEvent }) => !/clears/i.test(clearanceEvent.label)
        && clearanceEvent.contact.type === "control"));
  }
  if (byReason["clearance-control-dispossessed"]) {
    check("clearance-control-dispossessed: the dispossessing attacker (Cardozo, genuinely at the contact point) is named, not fabricated",
      all(byReason["clearance-control-dispossessed"], ({ result }) => result.nextOwnerId === cardozo.id));
  }
  const completedPasses = [...(byReason["clearance-pass-teammate-complete"] || []), ...(byReason["clearance-pass-keeper-complete"] || [])];
  if (completedPasses.length) {
    check("clearance-pass-*-complete: every trial hands real possession to the named target, at their own position",
      all(completedPasses, ({ result, clearanceEvent }) => {
        const targetEntry = result.nextOwnerId === ferdinandTeammate.id ? ferdinandTeammate : howard;
        return result.nextOwnerId === clearanceEvent.targetId && result.ballEnd.x === pointOf(targetEntry).x;
      }));
  }
  const interceptedPasses = [...(byReason["clearance-pass-teammate-intercepted"] || []), ...(byReason["clearance-pass-keeper-intercepted"] || [])];
  if (interceptedPasses.length) {
    check("clearance-pass-*-intercepted: every trial reports a genuinely loose ball, no fabricated recipient",
      all(interceptedPasses, ({ result }) => result.nextOwnerId === null && result.possession === "loose"));
  }
  check("every clearance event's contact.actorId is the defender who actually won the header, regardless of which action was chosen",
    all(allResults.map(({ trace }) => trace.find((event) => event.contact && event.contact.type === "clearance")).filter(Boolean),
      (clearanceEvent) => clearanceEvent.contact.actorId === ferdinand.id));
}

console.log("\n=== match-lab.js integration: rebound continuity + named taker (point 3) ===");
{
  // Reported trace #2 -- Gerrard must physically reach a real loose-ball
  // point before hitting the rebound; the follow-up shot must begin
  // exactly where he reached it, and a miss must NEVER leave the keeper
  // owning the ball at that out-of-play point.
  const attacker = entry("gerrard", { team: "home", x: 50, y: 10, playerObj: POACHER });
  const defender = entry("terry", { team: "away", x: 52, y: 8, playerObj: WEAK_DEFENDER });
  const keeper = entry("keeper", { role: "keeper", team: "away", x: 50, y: 2, playerObj: WEAK_DEFENDER });
  const originPoint = { x: 48, y: 4, zone: zoneFromPercent(48, 4) };

  let sawWon = false;
  let sawMiss = false;
  let sawLost = false;
  let bothConverge = true;
  let winnerNamed = true;
  let shotBeginsAtOrigin = true;
  let missNeverOwnedByKeeper = true;
  let lostNeverSaysClears = true;
  for (let i = 0; i < 500; i += 1) {
    const random = seededRandom(hashString(`rebound-continuity-${i}`));
    const trace = [];
    const result = resolveReboundScramble(attacker, defender, keeper, attacker.zone, random, trace, originPoint);
    const wonEvent = trace.find((event) => event.code === "REBOUND.WON");
    if (wonEvent) {
      sawWon = true;
      if (!(wonEvent.playerMoves.length === 2 && wonEvent.playerMoves.every((m) => m.to.x === originPoint.x && m.to.y === originPoint.y))) bothConverge = false;
      if (!(wonEvent.contact.actorId === attacker.id && wonEvent.contact.type === "recovery")) winnerNamed = false;
      const shotEvent = trace[trace.indexOf(wonEvent) + 1];
      if (!(shotEvent.ballFrom.x === originPoint.x && shotEvent.ballFrom.y === originPoint.y)) shotBeginsAtOrigin = false;
      if (shotEvent.code === "REBOUND.MISS") {
        sawMiss = true;
        if (!(result.nextOwnerId === null && result.restart === "goal-kick"
          && !(result.ballEnd.x === keeper.x && result.ballEnd.y === keeper.y))) missNeverOwnedByKeeper = false;
      }
    } else {
      const lostEvent = trace.find((event) => event.code === "REBOUND.LOST");
      if (lostEvent) {
        sawLost = true;
        if (/clears/i.test(lostEvent.label)) lostNeverSaysClears = false;
      }
    }
  }
  check("exercised at least one won rebound within the search budget", sawWon);
  check("exercised at least one missed rebound shot within the search budget", sawMiss);
  check("exercised at least one lost rebound duel within the search budget", sawLost);
  check("across every won-rebound trial: both eligible players are shown converging on the SAME explicit loose-ball point", bothConverge);
  check("across every won-rebound trial: the winner is explicitly named in the contact record", winnerNamed);
  check("across every won-rebound trial: the rebound shot begins exactly where the winner reached the ball", shotBeginsAtOrigin);
  check("across every missed-rebound trial: genuinely out of play -- no owner, a real restart, NEVER the keeper owning the miss point", missNeverOwnedByKeeper);
  check('across every lost-rebound trial: never described as "clearing" it -- no destination/flight was claimed', lostNeverSaysClears);
}

console.log("\n=== match-lab.js integration: uncontested rebound scorer genuinely moves to meet the ball (reported bug) ===");
{
  // A browser round reported a scored uncontested rebound where the ball
  // visibly stayed in the keeper's hands -- the "contact" record already
  // named the scorer as the contacting actor, but nothing ever moved
  // their own MARKER to the rebound spot before the goal. No opponent
  // placed at all (the uncontested branch, distinct from
  // resolveReboundScramble()'s own already-fixed contested path).
  // Keep the shooter just outside the dedicated <=24yd one-on-one gate:
  // this regression is specifically about the generic shot resolver's
  // uncontested-rebound continuation, not isolated-chance routing.
  const shooter = entry("shooter", { team: "home", x: 50, y: 75, playerObj: POACHER });
  const keeper = entry("keeper", { role: "keeper", team: "away", x: 50, y: 97, playerObj: WEAK_DEFENDER });
  const shootGroups = { owner: shooter, teammates: [], opponents: [], keeper };
  let sawShootGoal = false;
  let shootMoverCorrect = true;
  for (let i = 0; i < 800 && !sawShootGoal; i += 1) {
    const random = seededRandom(hashString(`uncontested-rebound-shoot-${i}`));
    const trace = [];
    const result = resolveShoot(shootGroups, {}, random, trace);
    if (result.reason === "rebound-goal-uncontested") {
      sawShootGoal = true;
      const goalEvent = trace.find((event) => event.code === "REBOUND.GOAL");
      if (!(goalEvent.moverId === shooter.id && goalEvent.moveTo.x === goalEvent.ballFrom.x && goalEvent.moveTo.y === goalEvent.ballFrom.y)) shootMoverCorrect = false;
    }
  }
  check("exercised a scored uncontested rebound (resolveShoot) within the search budget", sawShootGoal);
  check("the scorer's own marker genuinely moves to the rebound spot before the goal -- not left behind at the keeper", shootMoverCorrect);

  const crosser = entry("rc-crosser", { team: "home", x: 85, y: 60, playerObj: GOOD_CROSSER });
  const receiver = entry("rc-receiver", { team: "home", x: 50, y: 90, playerObj: POACHER });
  const rcKeeper = entry("rc-keeper", { role: "keeper", team: "away", x: 50, y: 97, playerObj: WEAK_DEFENDER });
  const crossGroups = { owner: crosser, teammates: [receiver], opponents: [], keeper: rcKeeper };
  let sawCrossGoal = false;
  let crossMoverCorrect = true;
  for (let i = 0; i < 800 && !sawCrossGoal; i += 1) {
    const random = seededRandom(hashString(`uncontested-rebound-cross-${i}`));
    const trace = [];
    const result = resolveCross(crossGroups, {}, random, trace);
    if (result.reason === "rebound-goal-uncontested") {
      sawCrossGoal = true;
      const goalEvent = trace.find((event) => event.code === "REBOUND.GOAL");
      if (!(goalEvent.moverId === receiver.id && goalEvent.moveTo.x === goalEvent.ballFrom.x && goalEvent.moveTo.y === goalEvent.ballFrom.y)) crossMoverCorrect = false;
    }
  }
  check("exercised a scored uncontested rebound (resolveCross) within the search budget", sawCrossGoal);
  check("the receiver's own marker genuinely moves to the rebound spot before the goal -- not left behind at the keeper", crossMoverCorrect);
}

console.log("\n=== match-lab.js integration: Replay/Step produce identical geometry ===");
{
  const crosser = entry("crosser", { team: "home", x: 85, y: 60, playerObj: GOOD_CROSSER });
  const cardozo = entry("cardozo", { team: "home", x: 50, y: 6, playerObj: AVERAGE });
  const ferdinand = entry("ferdinand", { team: "away", x: 49, y: 7, playerObj: ELITE_DEFENDER });
  const howard = entry("howard", { role: "keeper", team: "away", x: 50, y: 2, playerObj: ELITE_KEEPER });
  setupRoster([crosser, cardozo, ferdinand, howard], crosser.id);
  const groups = freePlayGroups(crosser.id, state.roster);
  const random1 = seededRandom(hashString("replay-geometry-identical"));
  const random2 = seededRandom(hashString("replay-geometry-identical"));
  const trace1 = [];
  const trace2 = [];
  const result1 = resolveCross(groups, {}, random1, trace1);
  const result2 = resolveCross(groups, {}, random2, trace2);
  check("identical seed reproduces an identical result end to end (Replay's own guarantee)",
    JSON.stringify(result1) === JSON.stringify(result2));
  check("identical seed reproduces an identical trace, including every playerMoves/contact record",
    JSON.stringify(trace1) === JSON.stringify(trace2));

  // Step drives the SAME stored trace through applyStepAnimation() twice
  // (once per "replay") and must resolve every playerMoves entry to the
  // identical playbackPositions both times -- Step/Replay never re-run a
  // resolver, only play back what's already stored.
  seedPlaybackPositions();
  for (const event of trace1) applyStepAnimation(event, { animate: false });
  const firstPass = { ...playbackPositions };
  seedPlaybackPositions();
  for (const event of trace1) applyStepAnimation(event, { animate: false });
  const secondPass = { ...playbackPositions };
  check("Step/Replay playback of the identical stored trace produces identical playbackPositions both times",
    JSON.stringify(firstPass) === JSON.stringify(secondPass));
}

console.log("\n=== Reported trace #3: a full defensive clearance decision, constructed end to end ===");
{
  // Ferdinand wins a header at a fixed contact point deep in his own box,
  // under real attacking pressure, with a teammate and his own keeper
  // both placed -- exercises resolveAerialClearanceContinuation() directly
  // (bypassing the aerial race's own randomness) so every one of the six
  // action types' own contract can be checked deterministically-enough
  // across a real search budget.
  const crosser = entry("crosser", { team: "home", x: 85, y: 60, playerObj: GOOD_CROSSER });
  const cardozo = entry("cardozo", { team: "home", x: 50, y: 6, playerObj: AVERAGE });
  const ferdinand = entry("ferdinand", { team: "away", x: 49, y: 7, playerObj: ELITE_DEFENDER });
  const terry = entry("terry", { team: "away", x: 55, y: 20, playerObj: ELITE_DEFENDER });
  const howard = entry("howard", { role: "keeper", team: "away", x: 50, y: 2, playerObj: ELITE_KEEPER });
  setupRoster([crosser, cardozo, ferdinand, terry, howard], crosser.id);
  const groups = { owner: crosser, teammates: [cardozo], opponents: [ferdinand, terry], keeper: howard };
  const contactPoint = { x: 49, y: 7, zone: zoneFromPercent(49, 7) };

  const seenTypes = new Set();
  let contactPointMatches = true;
  let flightStartsAtContact = true;
  let outOfPlayHasNoOwner = true;
  let outOfPlayHasRealRestart = true;
  for (let i = 0; i < 1500; i += 1) {
    const random = seededRandom(hashString(`reported-trace-3-${i}`));
    const trace = [];
    const result = resolveAerialClearanceContinuation(ferdinand, contactPoint, groups, cardozo, random, trace);
    seenTypes.add(result.reason);
    // Universal invariants, every single trial regardless of which
    // action fired:
    if (!(trace[0].contact.point.x === contactPoint.x && trace[0].contact.point.y === contactPoint.y)) contactPointMatches = false;
    if (!(trace[0].ballFrom.x === contactPoint.x && trace[0].ballFrom.y === contactPoint.y)) flightStartsAtContact = false;
    if (result.restart !== null) {
      if (result.nextOwnerId !== null) outOfPlayHasNoOwner = false;
      if (!["goal-kick", "corner", "throw-in", "kickoff"].includes(result.restart)) outOfPlayHasRealRestart = false;
    }
  }
  console.log(`  reachable continuation reasons across 1500 trials: ${[...seenTypes].sort().join(", ")}`);
  check("at least four distinct continuation decisions are structurally reachable from one fixed geometry", seenTypes.size >= 4);
  check("across every trial: the clearance event's own contact point IS the contact point it was resolved at", contactPointMatches);
  check("across every trial: the ball flight (if any) STARTS at the contact point -- never re-derived from elsewhere", flightStartsAtContact);
  check("across every out-of-play trial: no owner is assigned", outOfPlayHasNoOwner);
  check("across every out-of-play trial: restart is a genuine declared type", outOfPlayHasRealRestart);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
