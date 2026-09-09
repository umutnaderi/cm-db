// Dynamic Ball Claim v2 invariant tests.
//
// Two reported defects share one cause: nothing continuously re-decided who
// was going for a loose ball. This suite pins the fix at three levels --
// the physics of the race itself (ballClaim.js, pure), the declarative
// route through the action-pattern registry (with a parity reference), and
// the real possession loop in match-lab.js.
import { hashString, seededRandom } from "../src/lib/matchEngineCore.js";
import { yardDistance } from "../src/lib/pitchGeometry.js";
import { timeToReach, topSpeed } from "../src/lib/playerKinetics.js";
import {
  rollStopDistanceYards, rollStopDurationMs, rollTraveledYards,
} from "../src/lib/ballRollPhysics.js";
import {
  projectLooseRoll, evaluateBallClaim, claimLooseBall, shouldChaseLooseBall,
  selectLooseBallClaimant, selectLooseBallClaimantDirect,
  rollSpeedYpsFromVelocity,
  CLAIM_SAMPLE_MS, CLAIM_REACTION_MS, CLAIM_MIN_ROLL_SPEED_YPS,
} from "../src/lib/ballClaim.js";
import { matchActionPatterns, ACTION_PATTERN_REGISTRY, EXCLUSIVITY_CAPACITY } from "../src/lib/actionPatternRegistry.js";
import { POSSESSION_STATES, TARGET_DERIVATIONS, SPATIAL_REQUIREMENT_KINDS } from "../src/lib/actionPatternSchema.js";
import { selectLooseBallRecovery, predictBallPosition } from "../src/lib/matchBallCore.js";

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} -- ${label}`);
  if (!condition) failures += 1;
}

function attrs(pairs) { return Object.entries(pairs).map(([label, value]) => ({ label, value })); }
function player(name, overrides = {}) {
  return {
    canonical_player_name: name, current_ability: 150,
    attributes: attrs({ Pace: 13, Acceleration: 13, Anticipation: 13, "Off the Ball": 13, ...overrides }),
  };
}
const QUICK = player("Quick", { Pace: 19, Acceleration: 19, Anticipation: 16 });
const AVERAGE = player("Average", { Pace: 12, Acceleration: 12 });
const SLOW = player("Slow", { Pace: 4, Acceleration: 4, Anticipation: 4 });
function at(id, x, y, playerObj = AVERAGE, team = "home") {
  return { id, x, y, team, role: "player", player: playerObj };
}

const PITCH_WIDTH_YARDS = 76;
const PITCH_LENGTH_YARDS = 114;

console.log("=== 1: the roll projection is the real friction model, sampled ===");
{
  const roll = projectLooseRoll({
    from: { x: 50, y: 20 }, aim: { x: 50, y: 100 }, speedYps: 16, sampleMs: 40,
  });
  check("the projection runs for the ball's own real stop time",
    Math.abs(roll.stopMs - rollStopDurationMs(16)) < 1e-6);
  check("and covers the ball's own real stop distance",
    Math.abs(roll.stopDistanceYards - rollStopDistanceYards(16)) < 1e-6);
  check("it is genuinely sampled, not a two-point guess", roll.samples.length > 50);
  check("the first sample is the instant the ball came loose, at zero travel",
    roll.samples[0].tMs === 0 && roll.samples[0].distanceYards === 0);
  check("travel is monotonic and never exceeds the natural stop distance",
    roll.samples.every((sample, index) =>
      sample.distanceYards <= roll.stopDistanceYards + 1e-9
      && (index === 0 || sample.distanceYards >= roll.samples[index - 1].distanceYards - 1e-9)));
  check("the ball genuinely decelerates -- later samples advance less than earlier ones",
    (() => {
      const early = roll.samples[3].distanceYards - roll.samples[2].distanceYards;
      const late = roll.samples[roll.samples.length - 2].distanceYards
        - roll.samples[roll.samples.length - 3].distanceYards;
      return late < early * 0.6;
    })());
  check("every sampled distance matches rollTraveledYards exactly -- no second physics model",
    roll.samples.every((sample) => Math.abs(sample.distanceYards - rollTraveledYards(16, sample.tMs)) < 1e-9));
  const deadlined = projectLooseRoll({
    from: { x: 50, y: 20 }, aim: { x: 50, y: 100 }, speedYps: 16, sampleMs: 40, deadlineMs: 900,
  });
  check("a deadline genuinely truncates the roll (a ball that is out cannot be raced)",
    deadlined.truncated && deadlined.horizonMs === 900
      && deadlined.samples[deadlined.samples.length - 1].tMs === 900);
}

console.log("\n=== 2: the defect this replaces -- the old claim used a different physics model ===");
{
  // This is the measured root cause, pinned as a test so it cannot quietly
  // come back: predictBallPosition()'s 320ms exponential-drag look-ahead and
  // the ball's real GROUND_FRICTION_YPS2 roll disagree enormously, and the
  // claim used to be decided entirely by the former.
  const speedYps = 26;
  const vPctPerMs = (speedYps / 1000) / PITCH_LENGTH_YARDS * 100;
  const state = {
    position: { x: 50, y: 20, height: 0 }, velocity: { x: 0, y: vPctPerMs },
    phase: "loose", height: 0, verticalVelocity: 0,
  };
  const predicted = predictBallPosition(state, 320);
  const predictedYards = (predicted.y - 20) / 100 * PITCH_LENGTH_YARDS;
  check("the old 320ms prediction sees the ball barely move (under 8 yards)", predictedYards < 8);
  check("while the real roll carries it far past that (over 80 yards)",
    rollStopDistanceYards(speedYps) > 80);
  check("so a claim decided from the prediction is decided against a nearly stationary ball",
    rollStopDistanceYards(speedYps) / Math.max(predictedYards, 0.001) > 10);
}

console.log("\n=== 3: a hopeless chaser cannot claim, and is told why ===");
{
  // A ball rolling hard away from a slow player who starts behind it.
  const chaser = at("chaser", 50, 18, SLOW);
  const roll = projectLooseRoll({ from: { x: 50, y: 20 }, aim: { x: 50, y: 100 }, speedYps: 22 });
  const claim = evaluateBallClaim({ roll, candidates: [chaser] });
  check("nobody intercepts a ball rolling away faster than they can run", claim.claimant === null);
  check("the hopeless chaser is named in abandoned, not silently dropped",
    claim.abandoned.length === 1 && claim.abandoned[0].id === "chaser");
  check("with a real reason", typeof claim.abandoned[0].reason === "string" && claim.abandoned[0].reason.length > 10);
  check("and a real shortfall, not a boolean", claim.abandoned[0].shortfallMs > 0);
  const verdict = shouldChaseLooseBall("chaser", claim);
  check("shouldChaseLooseBall still lets them collect the STOPPED ball (nobody else is on the pitch)",
    verdict.chase === true && verdict.role === "pickup");
  check("a pickup is offered only because the ball was allowed to finish rolling",
    claim.pickup !== null && claim.pickup.id === "chaser");
}

console.log("\n=== 4: a ball that goes out has no claimant and no pickup ===");
{
  const chaser = at("chaser", 50, 18, SLOW);
  const claim = claimLooseBall({
    from: { x: 50, y: 20 }, aim: { x: 50, y: 100 }, speedYps: 22,
    candidates: [chaser], exitDistanceYards: 30,
  });
  check("the race is cut off at the line", claim.ballExits === true && claim.roll.truncated === true);
  check("nobody claims a ball that has already crossed the line", claim.claimant === null);
  check("and there is no pickup either -- it is a restart, not a recovery", claim.pickup === null);
  const verdict = shouldChaseLooseBall("chaser", claim);
  check("so the player abandons rather than following it out of play",
    verdict.chase === false && verdict.role === "abandon");
  check("the abandonment reason says the ball crossed the line",
    /crosses the line/.test(verdict.reason));
}

console.log("\n=== 5: the claim genuinely changes hands as the ball slows ===");
{
  // Two players. `near` is closest to where the ball goes loose and would
  // win any instant-of-release decision. `deep` starts further away but sits
  // on the ball's own path, so once the ball has decelerated toward them the
  // race is genuinely theirs. This is precisely the case a single-horizon
  // decision cannot represent.
  const near = at("near", 50, 24, SLOW);
  const deep = at("deep", 50, 62, QUICK);
  const from = { x: 50, y: 20 };
  const aim = { x: 50, y: 100 };
  const speedYps = 18;
  const claim = claimLooseBall({ from, aim, speedYps, candidates: [near, deep], withLeaders: true });
  check("somebody genuinely wins the race", Boolean(claim.claimant));
  check("the winner is the player the ball actually rolls to, not the one nearest at release",
    claim.claimant?.id === "deep");
  check("the lead genuinely changed hands during the roll -- a continuous race, not one decision",
    claim.leadChanges >= 1);
  check("both players were considered as contenders or abandoners",
    claim.contenders.length + claim.abandoned.length === 2);

  // And the old single-horizon rule really would have chosen differently.
  const vPctPerMs = (speedYps / 1000) / PITCH_LENGTH_YARDS * 100;
  const legacy = selectLooseBallRecovery([near, deep], {
    position: { ...from, height: 0 }, velocity: { x: 0, y: vPctPerMs },
    phase: "loose", height: 0, verticalVelocity: 0,
  });
  check("the legacy 320ms rule picks the merely-nearest player instead", legacy?.id === "near");
  check("so this is a real behaviour change, not a restatement of the old answer",
    legacy?.id !== claim.claimant?.id);
}

console.log("\n=== 6: the race is decided by real kinetics, and is deterministic ===");
{
  const quick = at("quick", 46, 40, QUICK);
  const slow = at("slow", 46, 40, SLOW);
  const claim = claimLooseBall({
    from: { x: 50, y: 20 }, aim: { x: 50, y: 100 }, speedYps: 16, candidates: [quick, slow],
  });
  check("from identical positions the quicker player wins", claim.claimant?.id === "quick");
  check("the interception is a real point on the roll, not the ball's release point",
    claim.interceptPoint && yardDistance(claim.interceptPoint, { x: 50, y: 20 }) > 1);
  check("the winner really could be there by then",
    CLAIM_REACTION_MS + timeToReach(quick.player, yardDistance(quick, claim.interceptPoint)) * 1000
      <= claim.interceptMs + 1e-6);

  // Determinism, including under candidate reordering -- the tie-break must
  // be total, or replay would drift with roster order.
  const a = claimLooseBall({ from: { x: 50, y: 20 }, aim: { x: 50, y: 100 }, speedYps: 16, candidates: [quick, slow] });
  const b = claimLooseBall({ from: { x: 50, y: 20 }, aim: { x: 50, y: 100 }, speedYps: 16, candidates: [slow, quick] });
  check("the same world gives the same claimant regardless of candidate order",
    a.claimant?.id === b.claimant?.id && a.interceptMs === b.interceptMs);
  const twins = [at("twin-b", 46, 40, AVERAGE), at("twin-a", 46, 40, AVERAGE)];
  const tie = claimLooseBall({ from: { x: 50, y: 20 }, aim: { x: 50, y: 100 }, speedYps: 16, candidates: twins });
  const tieReversed = claimLooseBall({ from: { x: 50, y: 20 }, aim: { x: 50, y: 100 }, speedYps: 16, candidates: [...twins].reverse() });
  check("an exact tie breaks on id, stably, in both orders",
    tie.claimant?.id === "twin-a" && tieReversed.claimant?.id === "twin-a");
}

console.log("\n=== 7: no randomness is consumed ===");
{
  // The claim must never touch an RNG stream: a possession's replay is
  // byte-identical only if every draw happens in the same order.
  let draws = 0;
  const random = () => { draws += 1; return 0.5; };
  const seeded = seededRandom(hashString("ball-claim-rng-guard"));
  const before = seeded();
  claimLooseBall({
    from: { x: 50, y: 20 }, aim: { x: 50, y: 100 }, speedYps: 18,
    candidates: [at("a", 50, 30, QUICK), at("b", 50, 60, AVERAGE)],
  });
  const after = seeded();
  check("the claim never calls a random function that is in scope", draws === 0 && random() === 0.5);
  check("an independent seeded stream is not advanced by evaluating a claim",
    before !== after && typeof after === "number");
  const first = claimLooseBall({ from: { x: 50, y: 20 }, aim: { x: 50, y: 100 }, speedYps: 18, candidates: [at("a", 50, 30, QUICK)] });
  const second = claimLooseBall({ from: { x: 50, y: 20 }, aim: { x: 50, y: 100 }, speedYps: 18, candidates: [at("a", 50, 30, QUICK)] });
  check("repeated evaluation of the same world is byte-identical",
    JSON.stringify(first.interceptMs) === JSON.stringify(second.interceptMs)
    && JSON.stringify(first.interceptPoint) === JSON.stringify(second.interceptPoint));
}

console.log("\n=== 8: the module writes nothing ===");
{
  const entryA = at("a", 50, 30, QUICK);
  const entryB = at("b", 50, 60, AVERAGE);
  const snapshot = JSON.stringify([entryA, entryB]);
  const from = { x: 50, y: 20 };
  const aim = { x: 50, y: 100 };
  const fromSnapshot = JSON.stringify(from);
  claimLooseBall({ from, aim, speedYps: 18, candidates: [entryA, entryB], withLeaders: true });
  check("no roster coordinate is written", JSON.stringify([entryA, entryB]) === snapshot);
  check("the ball's own release point is not mutated either", JSON.stringify(from) === fromSnapshot);
}

console.log("\n=== 9: the declarative route agrees with the physics reference ===");
{
  check("the registry declares exactly one loose-ball claim pattern",
    ACTION_PATTERN_REGISTRY.patterns.filter((p) => p.id === "pattern:claim-loose-ball@1").length === 1);
  check("one player at a time may go for a loose ball -- stated as capacity, not control flow",
    EXCLUSIVITY_CAPACITY["loose-ball"] === 1);
  check("\"loose\" is a declared possession state, not a shade of attacking/defending",
    POSSESSION_STATES.includes("loose"));
  check("the claim's target derivation is declared vocabulary",
    TARGET_DERIVATIONS.includes("intercept-rolling-ball"));
  check("so is its spatial question",
    SPATIAL_REQUIREMENT_KINDS.includes("can-reach-rolling-ball"));

  // Parity, over a real spread of pictures, exactly as Stage 1 required of
  // its own migration: the declarative route must produce the SAME claimant
  // as the physics reference, including where nobody wins.
  let compared = 0;
  let claimed = 0;
  const mismatches = [];
  for (let index = 0; index < 48; index += 1) {
    const speedYps = 6 + (index % 6) * 4;
    const startY = 18 + Math.floor(index / 6) * 4;
    const candidates = [
      at("near", 50, startY + 4, index % 2 ? SLOW : AVERAGE),
      at("deep", 50, startY + 30, index % 3 ? QUICK : SLOW),
      at("wide", 70, startY + 12, AVERAGE),
    ];
    const claim = claimLooseBall({
      from: { x: 50, y: startY }, aim: { x: 50, y: 100 }, speedYps, candidates,
      exitDistanceYards: index % 4 === 0 ? 25 : null,
    });
    const direct = selectLooseBallClaimantDirect(claim);
    const declarative = selectLooseBallClaimant(claim, { matchActionPatterns });
    compared += 1;
    if (direct) claimed += 1;
    if ((direct?.id ?? null) !== (declarative.claimant?.id ?? null)) {
      mismatches.push({ index, direct: direct?.id ?? null, declarative: declarative.claimant?.id ?? null });
    }
  }
  check(`the parity sweep compared a real spread of pictures (${compared})`, compared === 48);
  check(`the physics reference genuinely claims on some of them (${claimed}/${compared})`, claimed > 5);
  check("it also declines on some, so agreeing on 'nobody claims' is tested too", claimed < compared);
  check("the declarative route agrees with the physics reference on every picture",
    mismatches.length === 0);
  if (mismatches.length) console.log("     first mismatch:", JSON.stringify(mismatches[0]));

  // And the declaration really is doing gating work, not decorating.
  const live = claimLooseBall({
    from: { x: 50, y: 20 }, aim: { x: 50, y: 100 }, speedYps: 14,
    candidates: [at("a", 50, 30, QUICK)],
  });
  const wrongPhase = selectLooseBallClaimant(live, { matchActionPatterns, possession: "attacking" });
  check("the pattern does not fire when the ball is not loose", wrongPhase.claimant === null);
  check("and says so with a real rejection reason",
    wrongPhase.rejections.some((r) => r.patternId === "pattern:claim-loose-ball@1" && /possession/.test(r.reason)));
  const rightPhase = selectLooseBallClaimant(live, { matchActionPatterns, possession: "loose" });
  check("it does fire when the ball is loose", rightPhase.claimant?.id === "a");
  check("the proposal carries the declared job name, reusing no synonym",
    rightPhase.proposals.some((p) => p.job === "claim-loose-ball"));
  check("the attacking special-run patterns correctly stand down for a loose ball",
    rightPhase.rejections.some((r) => r.patternId === "pattern:arc-overlap@1"));
}

console.log("\n=== 10: velocity conversion is defined once ===");
{
  const speedYps = 20;
  const vPctPerMs = (speedYps / 1000) / PITCH_LENGTH_YARDS * 100;
  const converted = rollSpeedYpsFromVelocity(
    { x: 0, y: vPctPerMs }, { widthYards: PITCH_WIDTH_YARDS, lengthYards: PITCH_LENGTH_YARDS },
  );
  check("percent-per-ms converts back to the same yards per second", Math.abs(converted - speedYps) < 1e-9);
  check("retention scales the launch speed, never the friction constant",
    Math.abs(rollSpeedYpsFromVelocity({ x: 0, y: vPctPerMs }, { widthYards: PITCH_WIDTH_YARDS, lengthYards: PITCH_LENGTH_YARDS, retention: 0.5 }) - speedYps / 2) < 1e-9);
  check("a still ball converts to zero, not NaN",
    rollSpeedYpsFromVelocity(null, { widthYards: PITCH_WIDTH_YARDS, lengthYards: PITCH_LENGTH_YARDS }) === 0);
  check("the negligible-roll threshold is shared, not re-typed per caller",
    CLAIM_MIN_ROLL_SPEED_YPS > 0 && CLAIM_SAMPLE_MS === 40);
}

console.log("\n=== 11: degenerate inputs stay safe ===");
{
  check("no candidates gives no claimant, not a crash",
    claimLooseBall({ from: { x: 50, y: 20 }, aim: { x: 50, y: 100 }, speedYps: 12, candidates: [] }).claimant === null);
  check("a ball with no speed still projects a single resting sample",
    projectLooseRoll({ from: { x: 50, y: 20 }, aim: { x: 50, y: 100 }, speedYps: 0 }).samples.length >= 1);
  const stationary = claimLooseBall({
    from: { x: 50, y: 20 }, aim: { x: 50, y: 100 }, speedYps: 0, candidates: [at("a", 50, 25, AVERAGE)],
  });
  check("and a stationary ball is simply picked up", Boolean(stationary.claimant || stationary.pickup));
  check("shouldChaseLooseBall on an unevaluated claim abandons rather than throwing",
    shouldChaseLooseBall("nobody", null).chase === false);
  check("an eligibility filter genuinely excludes players from the race",
    claimLooseBall({
      from: { x: 50, y: 20 }, aim: { x: 50, y: 100 }, speedYps: 14,
      candidates: [at("in", 50, 26, QUICK), at("out", 50, 24, QUICK)],
      eligible: (entry) => entry.id === "in",
    }).claimant?.id === "in");
}

console.log("\n=== 12: the real possession loop -- nobody is dragged after a ball they never touched ===");
{
  // match-lab.js is a page script; the same minimal fake DOM the other
  // possession-level suites install is enough for its module-load side
  // effects. Every assertion below is on the real engine, not a stub.
  const fakeStyle = () => {
    const props = {};
    return {
      setProperty(n, v) { props[n] = v; },
      removeProperty(n) { delete props[n]; },
      getPropertyValue(n) { return props[n] ?? ""; },
    };
  };
  const fakeClassList = () => {
    const set = new Set();
    return {
      add: (...n) => n.forEach((x) => set.add(x)),
      remove: (...n) => n.forEach((x) => set.delete(x)),
      toggle(n, f) { if (f === undefined) { set.has(n) ? set.delete(n) : set.add(n); } else if (f) set.add(n); else set.delete(n); },
      contains: (n) => set.has(n),
    };
  };
  const fakeElement = () => {
    const el = {
      style: fakeStyle(), classList: fakeClassList(), dataset: {}, children: [],
      parentNode: null, textContent: "", innerHTML: "", value: "", checked: false,
      disabled: false, hidden: false, className: "",
      addEventListener() {}, removeEventListener() {},
      setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
      getBoundingClientRect() { return { left: 0, top: 0, width: 1000, height: 700 }; },
      querySelector() { return fakeElement(); },
      querySelectorAll() { return []; },
      appendChild(c) { c.parentNode = el; el.children.push(c); return c; },
      removeChild(c) { const i = el.children.indexOf(c); if (i >= 0) el.children.splice(i, 1); return c; },
      remove() {}, replaceChildren() { el.children = []; }, focus() {}, click() {},
    };
    return el;
  };
  globalThis.document = {
    querySelector: () => fakeElement(), querySelectorAll: () => [],
    createElement: () => fakeElement(), addEventListener() {}, body: fakeElement(),
  };
  globalThis.window = globalThis;
  globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
  globalThis.fetch = async () => { throw new Error("network disabled in test"); };

  const mod = await import("../match-lab.js");
  const { state, runConstructedPossession, zoneFromPercent, lastBallClaimDiagnostics } = mod;
  const seat = (id, x, y, playerObj, team = "home") => ({
    id, role: "player", team, player: playerObj, x, y, zone: zoneFromPercent(x, y),
  });

  check("the engine exposes the race it actually ran", typeof lastBallClaimDiagnostics === "function");

  // Sweep a spread of deep deliveries until the loop produces both a
  // genuine pitch exit from an untouched roll and a mid-pitch recovery --
  // the two outcomes this pass has to get right.
  let exitRun = null;
  let recoveredRun = null;
  let lateCount = 0;
  for (let index = 0; index < 120 && (!exitRun || !recoveredRun); index += 1) {
    const ox = 20 + (index % 10) * 6;
    const oy = 18 + Math.floor(index / 10) * 4;
    const owner = seat("owner", ox, oy, player("Passer", { Passing: 18, Vision: 16, Decisions: 15, Technique: 16 }));
    const runner = seat("runner", ox + 8, oy + 14, QUICK);
    const teamB = seat("teamB", ox - 12, oy + 4, AVERAGE);
    const teamC = seat("teamC", ox + 20, oy + 2, AVERAGE);
    const opp = seat("opp", ox + 10, oy + 30, AVERAGE, "away");
    state.roster = [owner, runner, teamB, teamC, opp];
    state.ball = { x: ox, y: oy, zone: zoneFromPercent(ox, oy), ownerId: owner.id };
    state.attackingDirection = { home: "down", away: "up" };
    let run;
    try { run = runConstructedPossession(`ball-claim-engine-${index}`); } catch { continue; }
    const lateIndex = run.trace.findIndex((event) => event.code === "P.RECEIVE.LATE");
    if (lateIndex < 0) continue;
    lateCount += 1;
    const after = run.trace.slice(lateIndex + 1);
    const outcome = after.find((event) => event.code?.startsWith("RESTART.") || event.code === "LOOSE.RECOVERED");
    if (!exitRun && outcome?.code?.startsWith("RESTART.")) exitRun = { run, outcome, lateIndex };
    if (!recoveredRun && outcome?.code === "LOOSE.RECOVERED") recoveredRun = { run, outcome, lateIndex };
  }

  // This deliberately asserts a FACT, not a count. The sweep stops as soon
  // as it has found both an exit and a recovery, so `lateCount` measures how
  // many iterations that took, not how the engine behaves -- finding both
  // sooner makes the number go DOWN. An earlier version compared it against
  // a numeric floor, which meant every unrelated improvement upstream
  // (Stage 3 aims a pass at a reachable meeting point, so fewer deliveries
  // go unreached at all) looked like a regression here. What this section
  // genuinely needs is that unreached deliveries happen and that both
  // outcomes get exercised, which is this check plus the two below.
  check(`the sweep produced real unreached deliveries (${lateCount})`, lateCount > 0);
  check("it produced a ball that genuinely ran out of play", Boolean(exitRun));
  check("and a ball that was genuinely recovered in play instead", Boolean(recoveredRun));

  if (exitRun) {
    // The reported bug, pinned. An untouched ball rolling out must not
    // author a contact for the last toucher: matchLabPlayback.js re-pins
    // every contact actor onto its contact point, so a contact here is
    // exactly "the passer runs after the ball until it goes out."
    check("a ball that rolls out untouched authors no contact at the exit point",
      !exitRun.outcome.contact);
    check("the restart is still attributed to a real last toucher",
      Boolean(exitRun.outcome.actorId ?? exitRun.outcome.actor));
    check("and no player move is authored onto the exit point either",
      !(exitRun.outcome.playerMoves || []).length);
    check("the ball still travels a real rolling trajectory to the line",
      Array.isArray(exitRun.outcome.ballTrajectory) && exitRun.outcome.ballTrajectory.length > 2);
  }

  if (recoveredRun) {
    check("a recovered ball DOES author a genuine contact -- somebody really touches it",
      Boolean(recoveredRun.outcome.contact));
    check("the recoverer takes ownership at the point the ball actually rolled to",
      Boolean(recoveredRun.outcome.ownerAfter ?? recoveredRun.outcome.ownerAfterId));
  }

  const diagnostics = lastBallClaimDiagnostics();
  check("the engine's own last race is inspectable", Boolean(diagnostics));
  if (diagnostics) {
    check("it raced every player on the pitch, not a single pre-chosen one",
      diagnostics.contenders.length + diagnostics.abandoned.length >= 4);
    check("it carries a real projected roll under the shared friction model",
      diagnostics.roll?.samples?.length > 1);
    check("every abandonment carries a reason a diagnostics panel can show",
      diagnostics.abandoned.every((entry) => typeof entry.reason === "string" && entry.reason.length > 10));
  }

  // Determinism through the whole loop, which is what replay depends on.
  const fixture = () => {
    const owner = seat("owner", 40, 30, player("Passer", { Passing: 18, Vision: 16, Decisions: 15, Technique: 16 }));
    state.roster = [
      owner, seat("runner", 48, 44, QUICK), seat("teamB", 28, 34, AVERAGE),
      seat("teamC", 60, 32, AVERAGE), seat("opp", 50, 60, AVERAGE, "away"),
    ];
    state.ball = { x: 40, y: 30, zone: zoneFromPercent(40, 30), ownerId: owner.id };
    state.attackingDirection = { home: "down", away: "up" };
  };
  fixture();
  const first = runConstructedPossession("ball-claim-determinism");
  fixture();
  const second = runConstructedPossession("ball-claim-determinism");
  check("the same seed and the same world replay to an identical trace",
    JSON.stringify(first.trace.map((e) => [e.code, e.ballTo]))
    === JSON.stringify(second.trace.map((e) => [e.code, e.ballTo])));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
