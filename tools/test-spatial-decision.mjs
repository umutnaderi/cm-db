// Spatial Decision Intelligence v1 tests -- see MATCH_LAB_PLAN.md. Pure
// DOM-free logic (src/lib/spatialDecision.js), same style as
// tools/test-one-on-one-decision.mjs: hand-built fixtures, controlled RNG
// streams, no fake DOM needed since this module never touches one.
// Complements tools/test-possession-runner.mjs, which covers the same
// system through the FULL match-lab.js integration (resolveCarry, the
// possession loop, X1.D's own endpoint fix) -- this file is the direct
// unit-level coverage of spatialDecision.js's own exported functions.
import {
  approachPoint, AWARENESS_RADIUS_YARDS, canAttemptShot, canSlidingTackle, canStandingTackle, chooseCandidate, claimable,
  carryUtility, classifyOutfieldBand, coveringPositionPoint, crossUtility, determineCarryGait, effectiveCarryPressure, distanceToGoalYards, dribbleUtility, DUEL_RANGE_YARDS, engagingOpponent,
  decisionOptionMetrics, findSpaceTarget, findSpaceTargetForAttack, forwardRunTarget, generateFreePlayCandidates, hasSimpleOption, holdUtility, identifyLineBreakingRunnerId, isCrossTargetZone, keeperDistributionCandidates, laneObstruction, nearestLaneInterceptor,
  passUtility, PITCH_LENGTH_YARDS, PITCH_WIDTH_YARDS, planAttackerRepositioning, planCarryDestination,
  carrySteeringWaypoint, CARRY_BODY_CLEARANCE_YARDS, yardDistanceToSegment,
  simulateCarryTouches, planDefensiveRepositioning, PRESSURE_RADIUS_YARDS, pressingTarget, pressureAt, screeningPositionPoint,
  longRangeShotConfidence, selectionSharpness, shootUtility, shootingInstructionFor, shootingLaneOpenness, shotAngleTightness, SLIDING_TACKLE_RANGE_YARDS,
  STANDING_TACKLE_RANGE_YARDS, throughBallUtility, toYardPoint, yardDistance, fromYardPoint,
} from "../src/lib/spatialDecision.js";
import { selectFinishType } from "../src/lib/matchEngineCore.js";
import {
  applyTacklingInstruction, applyTeamInstructionBiases,
} from "../src/lib/teamInstructions.js";

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} -- ${label}`);
  if (!condition) failures += 1;
}

function attrs(pairs) { return Object.entries(pairs).map(([label, value]) => ({ label, value })); }
function player(name, overrides) { return { canonical_player_name: name, current_ability: 150, attributes: attrs(overrides) }; }

const SHARP = player("Sharp", { Decisions: 18, Vision: 17, Anticipation: 17, Composure: 17 });
const WEAK = player("Weak", { Decisions: 6, Vision: 6, Anticipation: 6, Composure: 6 });
const AVERAGE = player("Average", {});

function makeRandom(seed) {
  let s = seed || 1;
  return () => { s = (s * 48271 + 12345) % 2147483647; return (s % 1000000) / 1000000; };
}

console.log("=== Acceptance case 1: a defender far from the carrier cannot tackle ===");
{
  const carrier = { x: 50, y: 50 };
  const nearDefender = { x: 51, y: 51 };
  const farDefender = { x: 90, y: 90 };
  check("a defender 20+ real yards away is never DUEL_RANGE-eligible",
    yardDistance(carrier, farDefender) > 20 && engagingOpponent(carrier, [farDefender]) === null);
  check("a genuinely close defender IS duel-eligible", engagingOpponent(carrier, [nearDefender]) === nearDefender);
  check("standing tackle requires real proximity", !canStandingTackle(carrier, farDefender) && canStandingTackle(carrier, nearDefender));
  check("sliding tackle range is real but still excludes a far-away defender",
    !canSlidingTackle(carrier, farDefender) && SLIDING_TACKLE_RANGE_YARDS > STANDING_TACKLE_RANGE_YARDS);
  check("DUEL_RANGE_YARDS itself is a real, small yard figure, not a mixed-percentage-unit number that could span 20+ yards",
    DUEL_RANGE_YARDS < 10);
}

console.log("\n=== Acceptance case 2 (structural half): carry and dribble candidates are mutually exclusive ===");
{
  const owner = { id: "owner", x: 50, y: 50, player: SHARP };
  const openGroups = { owner, teammates: [], opponents: [{ id: "far", x: 90, y: 90, player: AVERAGE }], keeper: null };
  const contestedGroups = { owner, teammates: [], opponents: [{ id: "near", x: 51, y: 51, player: AVERAGE }], keeper: null };
  const openCandidates = generateFreePlayCandidates(openGroups, "down");
  const contestedCandidates = generateFreePlayCandidates(contestedGroups, "down");
  check("open space (no opponent in duel range) offers carry, never dribble",
    openCandidates.some((c) => c.type === "carry") && !openCandidates.some((c) => c.type === "dribble"));
  check("a genuinely nearby opponent offers dribble, never carry",
    contestedCandidates.some((c) => c.type === "dribble") && !contestedCandidates.some((c) => c.type === "carry"));
}

console.log("\n=== Acceptance case 4: a striker clear on goal prefers shooting/carrying over a backward pass into a crowd ===");
{
  const striker = { id: "striker", x: 50, y: 92, player: SHARP };
  const crowdedTeammate = { id: "teammate", x: 55, y: 80, player: AVERAGE };
  const defender1 = { id: "d1", x: 54, y: 79, player: AVERAGE };
  const defender2 = { id: "d2", x: 56, y: 81, player: AVERAGE };
  const groups = { owner: striker, teammates: [crowdedTeammate], opponents: [defender1, defender2], keeper: null };
  const candidates = generateFreePlayCandidates(groups, "down");
  const passCandidate = candidates.find((c) => c.type === "pass");
  const shootCandidate = candidates.find((c) => c.type === "shoot");
  check("the backward pass into a crowd scores lower than shooting from close range",
    Boolean(passCandidate) && Boolean(shootCandidate) && shootCandidate.utility > passCandidate.utility);
  let nonPassPicks = 0;
  for (let i = 1; i <= 300; i += 1) {
    const chosen = chooseCandidate(candidates, striker.player, makeRandom(i));
    if (chosen.type !== "pass") nonPassPicks += 1;
  }
  check("a sharp striker picks shoot/carry over the backward pass in the clear majority of trials",
    nonPassPicks / 300 > 0.85);
}

console.log("\n=== Acceptance case 5: after beating a defender, improved geometry is recognized on the next decision ===");
{
  const stationaryDefender = { id: "d", x: 50, y: 30, player: AVERAGE };
  const beforeOwner = { id: "owner", x: 50, y: 28, player: SHARP };
  const afterOwner = { id: "owner", x: 50, y: 45, player: SHARP }; // advanced well past the defender
  const beforeGroups = { owner: beforeOwner, teammates: [], opponents: [stationaryDefender], keeper: null };
  const afterGroups = { owner: afterOwner, teammates: [], opponents: [stationaryDefender], keeper: null };
  check("before advancing, the stationary defender is a real engager (dribble offered)",
    generateFreePlayCandidates(beforeGroups, "down").some((c) => c.type === "dribble"));
  check("after advancing past them, the SAME stationary defender is no longer in duel range (carry offered instead)",
    generateFreePlayCandidates(afterGroups, "down").some((c) => c.type === "carry")
      && !generateFreePlayCandidates(afterGroups, "down").some((c) => c.type === "dribble"));
  const beforeShoot = shootUtility(beforeOwner, [stationaryDefender], null, "down");
  const afterShoot = shootUtility(afterOwner, [stationaryDefender], null, "down");
  check("the improved (closer) position also reads as a more attractive shot than before",
    afterShoot > beforeShoot);
}

console.log("\n=== Monotonic: shot utility ===");
{
  const opponents = [];
  const closeCentral = { x: 50, y: 96 };
  const closeWide = { x: 75, y: 96 };
  const far = { x: 50, y: 40 };
  check("a closer shot is more attractive than a farther one (same angle)",
    shootUtility(closeCentral, opponents, null, "down") > shootUtility(far, opponents, null, "down"));
  check("a better-angled (central) shot beats a wider one at the SAME realistic distance",
    shootUtility(closeCentral, opponents, null, "down") > shootUtility(closeWide, opponents, null, "down"));
  const pressured = [{ x: 50, y: 95, player: AVERAGE }];
  check("more pressure on the shooter reduces shot utility",
    shootUtility(closeCentral, [], null, "down") > shootUtility(closeCentral, pressured, null, "down"));
}

console.log("\n=== Monotonic: pass utility ===");
{
  const owner = { x: 40, y: 50 };
  const openReceiver = { x: 40, y: 65 };
  const clearLane = { x: 70, y: 65 };
  const lightPressure = [{ x: 40, y: 90, player: AVERAGE }]; // far from the receiver
  const heavyPressure = [{ x: 40, y: 66, player: AVERAGE }]; // right on top of the receiver
  check("more receiver pressure reduces pass utility (same target point, same team)",
    passUtility(owner, openReceiver, lightPressure, "down") > passUtility(owner, openReceiver, heavyPressure, "down"));

  const backward = { x: 40, y: 35 };
  const forward = { x: 40, y: 70 };
  check("greater forward progression increases pass utility versus a backward option to a similarly open target",
    passUtility(owner, forward, [], "down") > passUtility(owner, backward, [], "down"));

  const laneBlocker = [{ x: 55, y: 58, player: AVERAGE }]; // sits almost exactly on the direct line to clearLane
  check("an obstructed lane reduces pass utility relative to a clear one",
    passUtility(owner, clearLane, [], "down") > passUtility(owner, clearLane, laneBlocker, "down"));
  check("laneObstruction() itself is genuinely higher for the blocker positioned on the line than for empty opponents",
    laneObstruction(owner, clearLane, laneBlocker) > laneObstruction(owner, clearLane, []));
}

console.log("\n=== Monotonic: cross utility rewards genuinely wide positions ===");
{
  const central = { x: 50, y: 70 };
  const wide = { x: 85, y: 70 };
  const receiver = { x: 50, y: 92 };
  check("a delivery from a genuinely wide position scores higher than an equivalent one from a central position",
    crossUtility(wide, receiver, [], "down") > crossUtility(central, receiver, [], "down"));
}

console.log("\n=== Backward passes are penalized, not forbidden -- allowed when forward options are worse ===");
{
  // Every forward option is heavily pressured/lane-blocked; the backward
  // option is wide open. The backward penalty is real but must not be an
  // unconditional veto -- relative merit still decides.
  const owner = { x: 40, y: 60 };
  const forwardTeammate = { x: 42, y: 75 };
  const backwardTeammate = { x: 40, y: 45 };
  const forwardCrowd = [
    { x: 41, y: 68, player: AVERAGE }, { x: 42, y: 72, player: AVERAGE }, { x: 40, y: 76, player: AVERAGE },
  ];
  const forwardUtility = passUtility(owner, forwardTeammate, forwardCrowd, "down");
  const backwardUtility = passUtility(owner, backwardTeammate, [], "down");
  check("a wide-open backward pass can genuinely outscore a heavily obstructed forward one",
    backwardUtility > forwardUtility);
}

console.log("\n=== Pass pressureRelief (2026-08-19) -- passing under real personal danger has real, distinct value ===");
{
  // Reported bug: two players traded the ball back and forth in tight 1v1
  // duels turn after turn instead of ever recycling it to a free teammate
  // -- "if a player is facing his own goal, he'd pass it to his teammate
  // because losing the ball would be costly... these players do not think
  // pass as a viable option most of the time." Root cause: passUtility()
  // scored the RESULT of a pass (progression/receiver pressure/lane) but
  // had no notion of the OWNER's own current danger, so even a genuinely
  // SAFE backward/square pass scored deeply negative purely from
  // geometry and could never compete with dribbleUtility/holdUtility,
  // whose own danger penalties are far smaller in scale.
  const owner = { x: 50, y: 50 };
  const teammate = { x: 20, y: 50 }; // due west -- wide open, not remotely near goal
  // Well off THIS pass's own lane (>3yd perpendicular -- laneObstruction
  // stays exactly 0 either way) but close enough to the OWNER to apply
  // real pressure -- isolates the new term from the lane/receiver terms,
  // which are deliberately left untouched by this fix.
  const closeMarker = { x: 50, y: 44 };
  check("test fixture sanity: the close marker adds zero lane obstruction to this specific pass",
    laneObstruction(owner, teammate, [closeMarker]) === 0);
  const unpressured = passUtility(owner, teammate, [], "down");
  const pressured = passUtility(owner, teammate, [closeMarker], "down");
  check("the exact same pass scores measurably HIGHER when the owner is personally under real pressure than when they are not",
    pressured > unpressured + 0.2);

  // The full scenario from the reported trace: a direct marker inside
  // duel range (forcing a real 'dribble' candidate to exist at all),
  // several realistic pass options fanning out from the owner, and one
  // genuinely blocked backward option with an opponent sitting right on
  // the direct line.
  const engager = { x: 50, y: 48 }; // ~2.4yd -- inside DUEL_RANGE_YARDS
  const opponents = [engager, { x: 65, y: 60 }, { x: 30, y: 45 }];
  const wideOpenPass = { x: 20, y: 50 };
  const blockedBackwardPass = { x: 50, y: 30 }; // opponent sits directly on this line
  const du = dribbleUtility(owner, engager, "down");
  check("test fixture sanity: this really is the kind of tight, forced 1v1 the report described (dribble utility near zero, not a free run)",
    du > -0.3 && du < 0.3);
  check("a genuinely safe, wide-open pass now beats continuing to dribble straight into the live duel",
    passUtility(owner, wideOpenPass, opponents, "down") > du);
  check("a pass straight through the marking defender is still correctly rejected -- this fix helps safe options, not every option",
    passUtility(owner, blockedBackwardPass, opponents, "down") < du);

  // End-to-end: with realistic selection noise, an average player facing
  // this exact duel now chooses to pass a clear majority of the time,
  // not the near-never it was before this fix.
  const teammates = [
    { id: "a", x: 35, y: 35 }, { id: "b", x: 65, y: 35 }, { id: "c", x: 50, y: 30 },
    { id: "e", x: 20, y: 50 },
  ];
  const groups = { owner: { id: "owner", ...owner }, teammates, opponents: opponents.map((o, i) => ({ id: `o${i}`, ...o })), keeper: null };
  const candidates = generateFreePlayCandidates(groups, "down");
  let passPicks = 0;
  for (let i = 1; i <= 500; i += 1) {
    if (chooseCandidate(candidates, AVERAGE, makeRandom(i)).type === "pass") passPicks += 1;
  }
  check("an average-decision player facing this exact live duel now chooses to pass in a clear majority of trials",
    passPicks / 500 > 0.5);
}

console.log("\n=== Selection sharpness (Decisions/Vision/Anticipation/Composure) drives selection noise, not utility itself ===");
{
  const marginalCandidates = [{ type: "A", utility: 0.50 }, { type: "B", utility: 0.56 }];
  function pickRate(p, targetType) {
    let hits = 0;
    for (let i = 1; i <= 800; i += 1) {
      if (chooseCandidate(marginalCandidates, p, makeRandom(i)).type === targetType) hits += 1;
    }
    return hits / 800;
  }
  const sharpRate = pickRate(SHARP, "B");
  const weakRate = pickRate(WEAK, "B");
  check("a sharper player tracks the objectively-better marginal option more closely than a weaker one",
    sharpRate > weakRate);
  check("selectionSharpness reads meaningfully higher for the sharp profile than the weak one",
    selectionSharpness(SHARP) > selectionSharpness(WEAK));
}

console.log("\n=== RNG stream discipline ===");
{
  // chooseCandidate() must be a pure function of (candidates, player,
  // decisionRandom) -- calling it never depends on anything beyond its
  // own arguments (no hidden shared/module-level mutable random state).
  const candidates = [{ type: "A", utility: 0.2 }, { type: "B", utility: 0.8 }];
  const a = chooseCandidate(candidates, SHARP, makeRandom(777));
  const b = chooseCandidate(candidates, SHARP, makeRandom(777));
  check("identical seed reproduces an identical choice", a.type === b.type);
}

console.log("\n=== Unit consistency: PITCH_LENGTH_YARDS/PITCH_WIDTH_YARDS are the ONE shared pitch geometry ===");
{
  // The rendered pitch is explicitly 75 x 120 yards. The previous 68 x 105
  // values were standard metres accidentally labelled as yards, so the
  // simulator and its CSS/SVG consumer described different physical fields.
  check("PITCH_LENGTH_YARDS matches the rendered 120-yard pitch", PITCH_LENGTH_YARDS === 120);
  check("PITCH_WIDTH_YARDS matches the rendered 75-yard pitch", PITCH_WIDTH_YARDS === 75);
}

console.log("\n=== shootingLaneOpenness(): the keeper no longer collapses lane openness for a routine central shot ===");
{
  const shooter = { x: 50, y: 95 };
  const openness = shootingLaneOpenness(shooter, [], "down");
  check("an unobstructed lane with no outfield opponents reads as fully open", openness === 1);
  const outfieldBlocker = [{ x: 50, y: 97 }];
  const blockedOpenness = shootingLaneOpenness(shooter, outfieldBlocker, "down");
  check("an outfield opponent genuinely on the line still correctly obstructs it", blockedOpenness < 0.5);
  // shootUtility() itself must be keeper-position-blind at the decision
  // layer -- an ordinarily-positioned keeper must not suppress a routine
  // central shot's utility at all (the real save probability is still
  // handled correctly downstream by the real resolver, not here).
  const withKeeper = shootUtility(shooter, [], { x: 50, y: 98 }, "down");
  const withoutKeeper = shootUtility(shooter, [], null, "down");
  check("shootUtility with a normally-positioned keeper equals shootUtility with none", withKeeper === withoutKeeper);
}

console.log("\n=== Tackle-range plausibility (feeds match-lab.js's resolveDribble() remap) ===");
{
  const carrier = { x: 50, y: 50 };
  const withinStanding = { x: 51.5, y: 50 };
  const withinSlidingOnly = { x: 55.33, y: 50 }; // ~4yd -- beyond standing range, within sliding range
  const withinDuelOnly = { x: 57.33, y: 50 }; // ~5.5yd -- beyond sliding range, within duel range
  check("a defender within standing-tackle range can also slide (wider range)", canStandingTackle(carrier, withinStanding) && canSlidingTackle(carrier, withinStanding));
  check("a defender beyond standing range but within sliding range can slide but not stand-tackle",
    !canStandingTackle(carrier, withinSlidingOnly) && canSlidingTackle(carrier, withinSlidingOnly));
  check("a defender within duel range but beyond both tackle ranges can do neither",
    yardDistance(carrier, withinDuelOnly) <= DUEL_RANGE_YARDS
      && !canStandingTackle(carrier, withinDuelOnly) && !canSlidingTackle(carrier, withinDuelOnly));
}

console.log("\n=== Pass contest geometry: three separate roles (mirrors the cross fix) ===");
{
  const passer = { x: 20, y: 50 };
  const receiver = { x: 60, y: 50 };
  // A defender right next to the PASSER but far from the straight
  // passer->receiver line must not be found as a lane interceptor.
  const passerSideOnly = { x: 22, y: 20 };
  check("a defender near the passer but off the passing lane is not a lane interceptor",
    nearestLaneInterceptor(passer, receiver, [passerSideOnly]) === null);
  // A defender sitting ON the direct line, far from the passer, must be
  // found regardless of passer-distance.
  const onLaneFarFromPasser = { x: 55, y: 50 };
  check("a defender sitting on the direct line, far from the passer, IS a lane interceptor",
    nearestLaneInterceptor(passer, receiver, [onLaneFarFromPasser]) === onLaneFarFromPasser);
  // A defender near the RECEIVER (not on the passer-side, not on the
  // lane) must still be found via engagingOpponent(receiver, ...) --
  // "must matter even when nobody is within duel range of the passer."
  const receiverSideOnly = { x: 61, y: 51 };
  check("a defender near the receiver (nowhere near the passer) is a real receiver-side engager",
    engagingOpponent(receiver, [receiverSideOnly]) === receiverSideOnly);
  check("that same defender is NOT within duel range of the passer at all",
    engagingOpponent(passer, [receiverSideOnly]) === null);
}

console.log("\n=== Directional Carry Planning acceptance cases ===");
{
  // 1. A wide, unopposed attacker cuts toward a better shooting lane
  // instead of running to the byline.
  const wide = { x: 85, y: 60 };
  const widePlan = planCarryDestination(wide, [], "down");
  check("a wide attacker's chosen destination is a diagonal cut, not straight to the byline", widePlan.label.startsWith("diagonal"));
  const wideOriginAngle = shootUtility(wide, [], null, "down");
  const wideDestAngle = shootUtility(widePlan.point, [], null, "down");
  check("the chosen destination is a genuinely better (or at least not worse) shooting position than the start",
    wideDestAngle >= wideOriginAngle);

  // 2. A central attacker may continue straight when that is genuinely best.
  const central = { x: 50, y: 55 };
  const centralPlan = planCarryDestination(central, [], "down");
  check("a central attacker's chosen destination is the straight-forward option", centralPlan.label === "forward");

  // 3. Carrying never ends on the goal line and never repeats a
  // zero-distance carry -- stress-tested across many sampled positions,
  // not just these two hand-picked ones.
  let bylineOrZero = 0;
  for (let i = 0; i < 500; i += 1) {
    const point = { x: 2 + ((i * 41) % 96), y: 2 + ((i * 59) % 96) };
    const plan = planCarryDestination(point, [], "down");
    const displacement = yardDistance(point, plan.point);
    const yard = toYardPoint(plan.point);
    if (displacement < 0.5 || yard.y <= 0.01 || yard.y >= PITCH_LENGTH_YARDS - 0.01) bylineOrZero += 1;
  }
  check("no sampled carry plan ends on the goal line or produces negligible movement (500 samples)", bylineOrZero === 0);

  // 4. Selected carry endpoints improve total attacking utility over the
  // starting point (progression and/or shot quality genuinely better,
  // not merely different).
  const strugglingOwner = { x: 78, y: 55 };
  const strugglingPlan = planCarryDestination(strugglingOwner, [], "down");
  const originCombined = shootUtility(strugglingOwner, [], null, "down");
  const destCombined = shootUtility(strugglingPlan.point, [], null, "down");
  check("the chosen carry destination improves (or holds) shot quality over the starting point, never quietly worse",
    destCombined >= originCombined - 0.05);

  // 5. When already in a strong shooting position, shooting outranks
  // carrying farther.
  const closeToGoal = { x: 50, y: 96 };
  const closeShoot = shootUtility(closeToGoal, [], null, "down");
  const closeCarry = planCarryDestination(closeToGoal, [], "down");
  check("already close to goal, shootUtility outranks the best available carry utility",
    closeShoot > closeCarry.utility);

  // 6. Replay reproduces the identical chosen lane and endpoint --
  // planCarryDestination() is fully deterministic (no RNG parameter at
  // all), so identical geometry must always produce an identical result.
  const replayA = planCarryDestination(wide, [], "down");
  const replayB = planCarryDestination(wide, [], "down");
  check("identical geometry reproduces the identical chosen lane and endpoint",
    replayA.label === replayB.label && replayA.point.x === replayB.point.x && replayA.point.y === replayB.point.y);
}

console.log("\n=== Directional carry continuity (2026-08-19) -- consecutive touches keep a chosen lane instead of zig-zagging ===");
{
  // Reported bug: a carrier's touch trail zig-zagged sharply left-right-
  // left across open, roughly symmetric space. planCarryDestination() only
  // ever looked at the current geometry, re-evaluating a fresh set of
  // candidate lanes from scratch on every single touch -- with two
  // near-mirror-image candidates (diagonal-left vs diagonal-right) scoring
  // almost identically in symmetric space, tiny geometry differences
  // between touches were enough to flip the winner back and forth. The
  // fix reads the owner's OWN last carry direction (lastCarryDirectionX/Y,
  // written by recordCarryDirection() in match-lab.js after every real
  // carry touch) and adds CARRY_CONTINUITY_BONUS toward whichever
  // candidate keeps moving the same way -- a real player runs a line, they
  // don't re-decide their direction from zero on every stride.
  const owner = { x: 50, y: 50 };
  // A blocker directly ahead forces the straight "forward" lane out of
  // contention, so the plan must choose between the two symmetric diagonal
  // lanes -- exactly the situation that used to flip-flop.
  const forwardBlocker = { x: 50, y: 62 };

  const noPriorPlan = planCarryDestination(owner, [forwardBlocker], "down");
  check("with no carry history yet, a symmetric blocked-forward situation falls back to the neutral short option",
    noPriorPlan.label === "short");

  const leftPriorOwner = { ...owner, lastCarryDirectionX: -1, lastCarryDirectionY: 0 };
  const leftPriorPlan = planCarryDestination(leftPriorOwner, [forwardBlocker], "down");
  check("a carrier who was just running left keeps running left through the next symmetric touch",
    leftPriorPlan.label === "diagonal-left");

  const rightPriorOwner = { ...owner, lastCarryDirectionX: 1, lastCarryDirectionY: 0 };
  const rightPriorPlan = planCarryDestination(rightPriorOwner, [forwardBlocker], "down");
  check("a carrier who was just running right keeps running right through the next symmetric touch",
    rightPriorPlan.label === "diagonal-right");

  // Continuity is a tiebreaker, never a mandate -- a genuinely blocked lane
  // still loses even when it matches the carrier's own prior direction.
  const leftBlocker = { x: 35, y: 58 };
  const bothBlockedPlan = planCarryDestination(leftPriorOwner, [forwardBlocker, leftBlocker], "down");
  check("continuity never overrides a genuinely blocked lane -- forward AND left blocked still falls back to short, despite a left-running history",
    bothBlockedPlan.label === "short");
}

console.log("\n=== Decision balance: carrying has opportunity cost and clean passes beat routine transport ===");
{
  const owner = { id: "balance-owner", role: "player", x: 50, y: 45, player: SHARP };
  const pressuredDestination = { x: 50, y: 55 };
  const destinationBlocker = { id: "balance-blocker", x: 50, y: 54, player: AVERAGE };
  check("a carry into pressure and an obstructed path can have negative utility",
    carryUtility(owner, pressuredDestination, [destinationBlocker], "down") < 0);

  const teammateA = { id: "balance-a", x: 35, y: 60, player: AVERAGE };
  const teammateB = { id: "balance-b", x: 65, y: 60, player: AVERAGE };
  const defenders = [
    { id: "balance-d1", x: 45, y: 70, player: AVERAGE },
    { id: "balance-d2", x: 70, y: 70, player: AVERAGE },
  ];
  const candidates = generateFreePlayCandidates({
    owner, teammates: [teammateA, teammateB], opponents: defenders, keeper: null,
  }, "down");
  let passSelections = 0;
  let carrySelections = 0;
  for (let index = 0; index < 1000; index += 1) {
    const choice = chooseCandidate(candidates, owner.player, makeRandom(index + 1));
    if (choice.type === "pass") passSelections += 1;
    if (choice.type === "carry") carrySelections += 1;
  }
  check("clean forward passes beat a routine open-space carry for a sharp midfielder in most decisions",
    passSelections / (passSelections + carrySelections) > 0.7);
}

console.log("\n=== Shot range: an empty sparse-roster lane is not a free long-shot bonus ===");
{
  const ambitiousDistance = { x: 50, y: 65, player: SHARP }; // 42 yards from y:100
  check("a clear central lane at 42 yards remains low-value after distance gating",
    shootUtility(ambitiousDistance, [], null, "down") < 0.3);
}

console.log("\n=== On-ball gait + possession stamina v1: determineCarryGait -- four geometry-driven gaits, not a pressure ternary ===");
{
  const ATTACKER = player("Attacker", { current_ability: 150 });
  ATTACKER.position_text = "F";
  const WING_BACK = player("Wing Back", { current_ability: 150 });
  WING_BACK.position_text = "WB";
  check("test fixture sanity: WB really does classify as defender in this engine (the lateral-control 'or a lateral destination' branch exists for exactly this case)",
    classifyOutfieldBand(WING_BACK) === "defender");

  // 1. Nobody ahead, full stamina, middle third -> full-sprint.
  const openCarrier = { x: 50, y: 30, player: ATTACKER };
  check("nobody ahead, full stamina, middle third -> full-sprint",
    determineCarryGait(openCarrier, [], "down", 1) === "full-sprint");

  // 2. A real opponent 10 real yards goal-side (well within
  // GAIT_AHEAD_RADIUS_YARDS(18)) -> full-sprint is never legal, no matter
  // how much stamina is left.
  const aheadOpponent = { x: 50, y: 38.3 }; // ~10yd more goal-side than y:30
  check("test fixture sanity: this opponent really is ~10yd more goal-side",
    Math.abs((distanceToGoalYards(openCarrier, "down") - distanceToGoalYards(aheadOpponent, "down")) - 10) < 0.5);
  check("an opponent genuinely goal-side and close never reads as full-sprint",
    determineCarryGait(openCarrier, [aheadOpponent], "down", 1) !== "full-sprint");

  // 3. A wide player on the touchline prefers lateral-control over
  // controlled-sprint -- controlled-sprint is structurally disabled on
  // the wing anyway (determineCarryGait()'s own "not wing-hugging"
  // clause), so the real competing choice with someone genuinely ahead
  // (full-sprint disqualified, same as test 2) is lateral vs close-control.
  // A blocker offset well clear of the straight-ahead lane still counts
  // as "ahead" (yardDistance+goal-side alone) without also killing
  // controlled-sprint's own lane check -- proving lateral wins on
  // PRIORITY, not just "it was the only thing left standing."
  const leftWingYard = { x: 5, y: 60 };
  const leftWingPoint = { ...fromYardPoint(leftWingYard), player: ATTACKER };
  check("test fixture sanity: x=5yd is genuinely within the wing margin",
    leftWingYard.x <= 12);
  const leftBlocker = fromYardPoint({ x: 16, y: 66 }); // ~12.5yd away, goal-side, well off the straight-ahead lane
  check("test fixture sanity: this blocker is genuinely 'ahead' (closer to goal, within range)",
    determineCarryGait(leftWingPoint, [leftBlocker], "down", 1) !== "full-sprint");
  check("an attacker hugging the LEFT touchline with someone ahead gets lateral-control, not controlled-sprint",
    determineCarryGait(leftWingPoint, [leftBlocker], "down", 1) === "lateral-control");

  const rightWingYard = { x: 70, y: 60 };
  const rightWingPoint = { ...fromYardPoint(rightWingYard), player: ATTACKER };
  const rightBlocker = fromYardPoint({ x: 59, y: 66 });
  check("the same is true hugging the RIGHT touchline",
    determineCarryGait(rightWingPoint, [rightBlocker], "down", 1) === "lateral-control");

  // A defender-classified wing-back only gets lateral-control when the
  // actual planned destination is genuinely more along the line than
  // toward goal -- classifyOutfieldBand() alone doesn't hand it to them.
  const wbPoint = { ...fromYardPoint(leftWingYard), player: WING_BACK };
  const alongLineDestination = fromYardPoint({ x: 15, y: 62 }); // +10yd lateral, +2yd forward
  const throughTrafficDestination = fromYardPoint({ x: 6, y: 75 }); // +1yd lateral, +15yd forward
  check("a wing-back with someone ahead but no destination given at all does not default to lateral-control",
    determineCarryGait(wbPoint, [leftBlocker], "down", 1) !== "lateral-control");
  check("the SAME wing-back with a genuinely along-the-line destination does get lateral-control",
    determineCarryGait(wbPoint, [leftBlocker], "down", 1, alongLineDestination) === "lateral-control");
  check("...but not with a destination that actually cuts through the middle instead",
    determineCarryGait(wbPoint, [leftBlocker], "down", 1, throughTrafficDestination) !== "lateral-control");

  // 4. Final third + close-control floors touchError/poke pressure, even
  // with nobody standing right on the ball -- Composure shaves the floor.
  const finalThirdOwner = { x: 50, y: 92, player: player("Composed 8", { Composure: 8 }) }; // ~9.6yd from goal
  const middleThirdOwner = { x: 50, y: 50, player: player("Composed 8", { Composure: 8 }) };
  check("test fixture sanity: this really is inside the final third",
    distanceToGoalYards(finalThirdOwner, "down") <= 40);
  const finalThirdPressure = effectiveCarryPressure(0, finalThirdOwner, "close-control", "down");
  const middleThirdPressure = effectiveCarryPressure(0, middleThirdOwner, "close-control", "down");
  check("close-control in the final third floors pressure well above zero even with nobody close",
    finalThirdPressure > 0.3);
  check("the SAME geometry in the middle third stays at the real (here: zero) pressure -- no floor outside the final third",
    middleThirdPressure === 0);
  check("a real pressure signal already above the floor is never LOWERED by this",
    effectiveCarryPressure(0.9, finalThirdOwner, "close-control", "down") === 0.9);
  check("only close-control gets the floor -- a full-sprint reading in the final third (hypothetically) is untouched",
    effectiveCarryPressure(0, finalThirdOwner, "full-sprint", "down") === 0);
  const composedFloor = effectiveCarryPressure(0, finalThirdOwner, "close-control", "down");
  const unComposedOwner = { x: 50, y: 92, player: player("Uncomposed 2", { Composure: 2 }) };
  const unComposedFloor = effectiveCarryPressure(0, unComposedOwner, "close-control", "down");
  check("higher Composure shaves the final-third floor down -- a rattled, low-Composure player gets the fuller floor",
    unComposedFloor > composedFloor);

  // 5. Final-Third Situational Gait v1 -- user's own correction: "it
  // shouldn't be a fact that we set here. These should be situational
  // things." The final third must NOT collapse to controlled-sprint/
  // close-control unconditionally anymore -- a genuinely open final
  // third (a real breakaway, nobody within GAIT_AHEAD_RADIUS_YARDS ahead)
  // stays a real full-sprint, decided by the SAME geometry check that
  // already governs every other third of the pitch.
  const openFinalThirdCarrier = { x: 50, y: 90, player: ATTACKER }; // ~12yd from goal, "down"
  check("test fixture sanity: this really is inside the final third",
    distanceToGoalYards(openFinalThirdCarrier, "down") <= 40);
  check("a genuinely open final third (a real breakaway) is still a real full-sprint, not a forced downgrade",
    determineCarryGait(openFinalThirdCarrier, [], "down", 1) === "full-sprint");
  const finalThirdBlocker = { x: 50, y: 96 }; // genuinely goal-side and close
  check("...but a real opponent actually in the way inside the final third disqualifies it exactly like anywhere else",
    determineCarryGait(openFinalThirdCarrier, [finalThirdBlocker], "down", 1) !== "full-sprint");
}

console.log("\n=== Ground Roll v2: simulateCarryTouches -- a live impulse + roll + chase, never a pre-beaded line ===");
{
  const from = { x: 50, y: 50 };
  const to = { x: 50, y: 60 }; // 12 real yards at this x (10% of 120yd)
  const nimbleTouches = simulateCarryTouches(from, to, "nimble", { player: AVERAGE });
  const sprintTouches = simulateCarryTouches(from, to, "sprint", { player: AVERAGE });
  check("a real distance produces at least one touch at nimble pace", nimbleTouches.length > 0);
  check("the same distance produces fewer touches at sprint pace than at nimble pace (each covers more ground)",
    sprintTouches.length < nimbleTouches.length);
  check("every touch's own contact point gets strictly closer to the destination, never overshooting or scattering",
    nimbleTouches.every((touch, index) => yardDistance(touch.ballTo, to)
      < yardDistance(index ? nimbleTouches[index - 1].ballTo : from, to)));
  check("every touch's own ball trajectory reports mode 'rolling' throughout -- never 'controlled-ground' "
    + "(the ball has left the foot; it is not parented to the owner until the next contact)",
    nimbleTouches.every((touch) => touch.ballTrajectory.every((sample) => sample.mode === "rolling")));
  check("each touch starts exactly where the PREVIOUS one made real contact -- chained from the live meet point, "
    + "never a pre-beaded line to the destination",
    nimbleTouches.every((touch, index) => index === 0
      || (touch.ballFrom.x === nimbleTouches[index - 1].ballTo.x && touch.ballFrom.y === nimbleTouches[index - 1].ballTo.y)));

  const veryShort = { x: 50, y: 50.3 }; // well under one gait interval at any spacing
  check("a carry shorter than one gait interval produces zero touches -- the previous single-touch behavior, not a regression",
    simulateCarryTouches(from, veryShort, "sprint", { player: AVERAGE }).length === 0);

  // Deterministic -- no gameplay RNG parameter at all, identical inputs
  // always reproduce an identical simulated sequence.
  const again = simulateCarryTouches(from, to, "nimble", { player: AVERAGE });
  check("identical inputs reproduce an identical simulated touch sequence (no hidden randomness)",
    JSON.stringify(nimbleTouches) === JSON.stringify(again));

  // Ball vs owner at mid-roll: the ball is measurably AHEAD, not glued to
  // the chasing owner -- both trajectories share the same sample count/
  // progress values, so index-matching them directly compares "where's
  // the ball" against "where's the owner" at the identical instant.
  const midIndex = Math.floor(nimbleTouches[0].ballTrajectory.length / 2);
  const ballMid = nimbleTouches[0].ballTrajectory[midIndex].position;
  const chaserMid = nimbleTouches[0].chaseTrajectory[midIndex].position;
  check("mid-roll, the ball's own position and the chasing owner's own position are NOT the same point",
    yardDistance(ballMid, chaserMid) > 0.1);

  const lowControl = player("Low control", { Dribbling: 3, Technique: 3 });
  const highControl = player("High control", { Dribbling: 19, Technique: 19 });
  const lowTouches = simulateCarryTouches(from, to, "jog", {
    player: lowControl, pressure: 0.6, seed: "attribute-touch-test",
  });
  const highTouches = simulateCarryTouches(from, to, "jog", {
    player: highControl, pressure: 0.6, seed: "attribute-touch-test",
  });
  check("higher Dribbling + Technique produces more frequent, tighter contacts over the identical tactical path",
    highTouches.length > lowTouches.length);
  check("higher Dribbling + Technique records a smaller touch-error envelope",
    highTouches[0].kinetics.attribution.find((item) => item.quantity === "touchErrorEnvelope").actual
      < lowTouches[0].kinetics.attribution.find((item) => item.quantity === "touchErrorEnvelope").actual);
  const segments = nimbleTouches.map((touch) => yardDistance(touch.ballFrom, touch.ballTo));
  check("touch spacing is deterministic but non-uniform rather than metronomic",
    new Set(segments.map((value) => value.toFixed(3))).size > 1);

  // Launch speed is a function of the player/gait/pressure impulse, NEVER
  // of how far the carry needs to go -- the same first touch, same seed,
  // same player, at two wildly different carry lengths must strike the
  // ball with the same real force and travel essentially the same real
  // distance. This is the actual bug this whole slice replaces: the old
  // planCarryTouches() pre-beaded a line to the destination and solved
  // BACKWARD for whatever speed would land exactly on each bead.
  const shortCarryFirstTouch = simulateCarryTouches(from, { x: 50, y: 65 }, "jog", {
    player: AVERAGE, seed: "speed-independence",
  })[0];
  const longCarryFirstTouch = simulateCarryTouches(from, { x: 50, y: 95 }, "jog", {
    player: AVERAGE, seed: "speed-independence",
  })[0];
  check("the first touch's own real stop distance is (near-)identical regardless of how far the overall carry is",
    Math.abs(
      yardDistance(shortCarryFirstTouch.ballFrom, shortCarryFirstTouch.ballTo)
      - yardDistance(longCarryFirstTouch.ballFrom, longCarryFirstTouch.ballTo),
    ) < 0.05);

  // A genuinely heavy touch, under pressure, from a player with poor
  // control AND poor pace/acceleration: the ball can legitimately outrun
  // its own owner. Dropped from the returned list entirely (never a
  // fabricated catch) -- an honest LOOSE result at the physics layer,
  // same as a real heavy touch that gets away from you.
  const heavyTouchPlayer = player("Heavy Touch", { Dribbling: 1, Technique: 1, Pace: 1, Acceleration: 1 });
  const heavyTouches = simulateCarryTouches(from, { x: 50, y: 99 }, "sprint", {
    player: heavyTouchPlayer, pressure: 1, seed: "heavy-touch",
  });
  check("an extreme heavy touch under pressure can genuinely go loose -- the ball outruns its own owner",
    heavyTouches.length === 0);

  // Momentum Continuity v1 (2026-08-31) -- user: "a player who is
  // already running will be faster than a player who just started...
  // acceleration takes time." A real (if extreme) Acceleration-1 player
  // needs a genuinely long time to reach real speed from a cold stop --
  // under the OLD model, every touch's own chase re-accelerated from
  // rest, so this player could never sustain a long full-sprint carry at
  // all (falls behind almost immediately, every single touch). Carrying
  // the real reached speed forward from one touch into the next now lets
  // them build up over the course of the carry, exactly like a real
  // sprinter -- a long, open, straight run should genuinely sustain more
  // than a couple of touches.
  const slowStarter = player("Slow Starter", {
    Dribbling: 14, Technique: 14, Pace: 15, Acceleration: 1,
  });
  const longOpenCarry = simulateCarryTouches(
    { x: 50, y: 10 }, { x: 50, y: 90 }, "sprint",
    { player: slowStarter, seed: "momentum-continuity" },
  );
  check(`an Acceleration-1 player sustains a genuinely LONG full-sprint carry once moving, not just the first touch or two (found ${longOpenCarry.length} touches)`,
    longOpenCarry.length >= 4);
}

console.log("\n=== Body Avoidance v1: carrySteeringWaypoint -- a carrier's own path never walks through a body ===");
{
  const from = { x: 50, y: 30 };
  const to = { x: 50, y: 60 }; // due north, 36yd
  const onTheLine = { x: 50, y: 45 }; // dead center of the segment
  const wayOffToTheSide = { x: 80, y: 45 }; // ~22.5yd off the x-axis at this y -- nowhere near the line

  check("an opponent standing directly on the line produces a real steering waypoint",
    Boolean(carrySteeringWaypoint(from, to, [onTheLine])));
  check("that waypoint clears the opponent by at least CARRY_BODY_CLEARANCE_YARDS on EACH new leg",
    (() => {
      const via = carrySteeringWaypoint(from, to, [onTheLine]);
      return yardDistanceToSegment(onTheLine, from, via) >= CARRY_BODY_CLEARANCE_YARDS - 0.01
        && yardDistanceToSegment(onTheLine, via, to) >= CARRY_BODY_CLEARANCE_YARDS - 0.01;
    })());
  check("an opponent nowhere near the direct line produces no steering at all -- never a needless detour",
    carrySteeringWaypoint(from, to, [wayOffToTheSide]) === null);
  check("with nobody placed at all, there is nothing to steer around", carrySteeringWaypoint(from, to, []) === null);

  const nearOrigin = { x: 50, y: 30.3 };
  const nearDestination = { x: 50, y: 59.7 };
  check("an opponent standing essentially at the DESTINATION is a different, harder problem than a mid-path waypoint can solve -- no steering offered",
    carrySteeringWaypoint(from, to, [nearDestination]) === null);
  check("an opponent standing essentially at the ORIGIN -- right in front of the carrier as they set off -- is the single MOST urgent case, not one to wave through",
    Boolean(carrySteeringWaypoint(from, to, [nearOrigin])));

  const exactlyOnTheLine = { x: 50, y: 45 };
  const again = carrySteeringWaypoint(from, to, [exactlyOnTheLine]);
  const again2 = carrySteeringWaypoint(from, to, [exactlyOnTheLine]);
  check("identical inputs reproduce an identical steering waypoint (no hidden randomness, no side flip)",
    JSON.stringify(again) === JSON.stringify(again2));

  // simulateCarryTouches() end to end: a defender planted directly between
  // the carrier and the destination must be given real, physical
  // clearance by every touch's own contact point, not walked through.
  const carrier = player("Carrier", { Dribbling: 15, Technique: 14 });
  const blocker = { x: 50, y: 42 };
  const touchesPastABody = simulateCarryTouches(from, to, "jog", {
    player: carrier, seed: "body-avoidance", opponents: [blocker],
  });
  check("a defender is genuinely planted on the direct line for this fixture",
    yardDistanceToSegment(blocker, from, to) < 0.5);
  check("simulateCarryTouches() produces at least one real touch even with a body in the way",
    touchesPastABody.length > 0);
  check("every touch's own path (foot to contact point) clears the blocker's real body radius -- the carrier steers around them, not through them",
    touchesPastABody.every((touch) => yardDistanceToSegment(blocker, touch.ballFrom, touch.ballTo) >= CARRY_BODY_CLEARANCE_YARDS - 0.05));
}

console.log("\n=== Off-Ball Defender Awareness v1: approachPoint -- capped per-step advance, never overshoots ===");
{
  const from = { x: 50, y: 50 };
  const farTo = { x: 50, y: 90 }; // 42yd away
  const capped = approachPoint(from, farTo, 8);
  check("a target far beyond the cap moves exactly the capped distance, not further", Math.abs(yardDistance(from, capped) - 8) < 0.01);
  const closeTo = { x: 50, y: 51 }; // ~1.05yd away, well under the cap
  const arrived = approachPoint(from, closeTo, 8);
  check("a target already within the cap is reached exactly, not overshot", arrived.x === closeTo.x && arrived.y === closeTo.y);
}

console.log("\n=== Off-Ball Defender Awareness v1: pressingTarget -- closes down but holds a real standoff ===");
{
  const defender = { x: 50, y: 30 };
  const farBall = { x: 50, y: 60 }; // ~31.5yd away
  const step1 = pressingTarget(defender, farBall);
  check("a defender far from the ball closes ground but does not teleport onto it", yardDistance(defender, step1) > 0 && yardDistance(step1, farBall) > 1);
  const closeBall = { x: 50, y: 30.5 }; // well under the standoff distance already
  const alreadyClose = pressingTarget(defender, closeBall);
  check("a defender already within standoff range does not keep walking onto the ball carrier",
    yardDistance(defender, alreadyClose) < 0.5);
}

console.log("\n=== Off-Ball Defender Awareness v1: coveringPositionPoint -- goal-side of the covered player ===");
{
  const subject = { x: 50, y: 50 };
  const spot = coveringPositionPoint(subject, "down"); // covering defender's own goal is at y:0
  check("the covering position sits on the goal side of the subject (closer to y:0 than the subject itself)", spot.y < subject.y);
  const distanceFromSubject = yardDistance(subject, spot);
  // Real yard range (2026-08-19): COVER_STANDOFF_YARDS(7) scaled 0.7x-1.3x
  // by markingTightnessQuality() -- a real browser round reported
  // defenders reading as "too stuck to their opponents" at the previous,
  // tighter base value.
  check("the covering position holds a real, non-zero standoff distance from the subject", distanceFromSubject > 3 && distanceFromSubject < 10);
}

console.log("\n=== Off-Ball Defender Awareness v1: planDefensiveRepositioning -- press/mark roles + the Weah pile-up cap ===");
{
  const ball = { x: 50, y: 50 };
  const attackingTeammate = { id: "teammate", x: 60, y: 55 };
  const nearDefender = { id: "near", x: 51, y: 51 };
  const farDefender = { id: "far", x: 30, y: 40 };

  check("no defenders placed at all returns an empty plan", planDefensiveRepositioning(ball, [attackingTeammate], [], "down").length === 0);

  const withTeammate = planDefensiveRepositioning(ball, [attackingTeammate], [nearDefender, farDefender], "down");
  const presser = withTeammate.find((step) => step.id === "near");
  const marker = withTeammate.find((step) => step.id === "far");
  check("the NEAREST defender to the ball exclusively claims press-ball", Boolean(presser) && presser.action === "press-ball");
  check("the other defender is assigned to mark the attacking teammate, not also press", Boolean(marker) && marker.action === "mark");

  const lonely = planDefensiveRepositioning(ball, [], [nearDefender, farDefender], "down");
  check("with no attacking teammates, exactly one defender presses while the other screens instead of joining the press",
    lonely.filter((step) => step.action === "press-ball").length === 1
      && lonely.some((step) => step.action === "screen"));
  const lonelyScreen = lonely.find((step) => step.action === "screen");
  check("the Weah pile-up fix: a leftover defender with nobody to mark never defaults to covering the ball itself -- their target clears a real radius of it",
    Boolean(lonelyScreen) && yardDistance(lonelyScreen.intentionTarget, ball) >= 10 - 0.01);

  // The Weah pile-up cap: three real, live attacking threats but only ever
  // AT MOST two dedicated markers -- the rest hold a real defensive job
  // instead of every remaining defender individually shadowing a threat.
  const receiverB = { id: "receiver-b", x: 35, y: 62 };
  const receiverC = { id: "receiver-c", x: 62, y: 58 };
  const thirdDefender = { id: "third", x: 65, y: 44 };
  const coordinated = planDefensiveRepositioning(
    ball, [attackingTeammate, receiverB, receiverC], [nearDefender, farDefender, thirdDefender], "down",
  );
  const markers = coordinated.filter((step) => step.action === "mark");
  check("at most two defenders are ever assigned a dedicated marker, however many live threats exist",
    markers.length > 0 && markers.length <= 2);
  check("every marker targets a real, distinct attacking threat", markers.every((step) => Boolean(step.subjectId)));
  const screeners = coordinated.filter((step) => step.action === "screen");
  screeners.forEach((step) => {
    check("a leftover (unmarked) defender's screen target still clears the required radius of the ball",
      yardDistance(step.intentionTarget, ball) >= 10 - 0.01);
  });

  // Determinism -- no RNG parameter at all.
  const again = planDefensiveRepositioning(ball, [attackingTeammate], [nearDefender, farDefender], "down");
  check("identical inputs reproduce an identical plan", JSON.stringify(withTeammate) === JSON.stringify(again));
}

console.log("\n=== Off-Ball Motion v3, Section A: last-man / through-ball recovery ===");
{
  // A reported bug: pickBallPresser() let a midfielder within
  // PRESSER_MIDFIELD_SLACK_YARDS steal the presser job from a nearby CB --
  // the last man between a through-runner and goal was told to shift-unit
  // instead of recover. "down" attacks toward y:100, so a defending side
  // passed "down" here defends the y:0 end -- CB/MF depths below are real,
  // unambiguous margins (computed via distanceToGoalYards, not eyeballed
  // percent offsets).
  const landing = { x: 50, y: 8 };
  const cb = { id: "cb", x: 50, y: 4 };
  const mf = { id: "mf", x: 50, y: 16.5 }; // ~15 real yards deeper than cb
  const throughBallPlan = planDefensiveRepositioning(landing, [], [cb, mf], "down");
  const cbStep = throughBallPlan.find((step) => step.id === "cb");
  const mfStep = throughBallPlan.find((step) => step.id === "mf");
  check("a through ball landing in the box: the CB (between landing and goal) presses/recovers it",
    Boolean(cbStep) && (cbStep.action === "press-ball" || cbStep.action === "recover"));
  check("the CB's action is never shift-unit -- the last man is not told to hold a zonal slot instead",
    cbStep?.action !== "shift-unit");
  check("the midfielder (15yd further out) is NOT the presser -- pickBallPresser's own CB-skip is gone for a genuine through ball",
    mfStep?.action !== "press-ball");

  // A CARRYING owner who has already beaten a leftover, midfielder/
  // attacker-classified defender by a real margin (6yd) -- that defender
  // must recover, not fall back to screening the danger from a standoff.
  const owner = { x: 50, y: 30 };
  const farCb = { id: "far-cb", x: 50, y: 2 };
  const leftover = { id: "leftover", x: 52, y: 36.4 }; // ~6 real yards beaten, ~6yd from owner
  const carryPlan = planDefensiveRepositioning(owner, [], [farCb, leftover], "down");
  const leftoverStep = carryPlan.find((step) => step.id === "leftover");
  check("the beaten leftover defender recovers onto the owner, not screen, even though a far-off CB is technically still goal-side",
    Boolean(leftoverStep)
      && (leftoverStep.action === "press-ball" || leftoverStep.action === "recover" || leftoverStep.action === "delay")
      && leftoverStep.action !== "screen");

  // Settled midfield carry, nobody genuinely through -- still exactly one
  // press-ball, no second closer, and the anti-swarm/pair-exclusivity
  // shape from the existing suite above is untouched.
  const settledBall = { x: 50, y: 50 };
  const settledNear = { id: "settled-near", x: 51, y: 51 };
  const settledFar = { id: "settled-far", x: 40, y: 45 };
  const settledPlan = planDefensiveRepositioning(settledBall, [], [settledNear, settledFar], "down");
  check("a settled midfield carry with nobody through still produces exactly one press-ball",
    settledPlan.filter((step) => step.action === "press-ball").length === 1);
  check("no second body is drawn in closer -- the leftover defender screens as before",
    settledPlan.some((step) => step.action === "screen"));

  // identifyLineBreakingRunnerId() -- the extracted selection, exercised
  // directly (same fixture shape planAttackerRepositioning's own existing
  // run-in-behind test above already uses).
  const markedAttacker = { id: "marked", x: 50, y: 40 };
  const unmarkedAttacker = { id: "unmarked", x: 20, y: 40 };
  const closeDefender = { id: "close-def", x: 51, y: 41 };
  const runnerId = identifyLineBreakingRunnerId([markedAttacker, unmarkedAttacker], [closeDefender], "down", { x: 50, y: 40 }, null);
  check("identifyLineBreakingRunnerId() names the SAME runner planAttackerRepositioning()'s own run-in-behind job selects",
    runnerId === "unmarked");
}

console.log("\n=== Off-Ball Attacker Awareness v1: findSpaceTarget -- genuinely moves away from the marker ===");
{
  const attacker = { x: 50, y: 50 };
  const marker = { x: 52, y: 51 };
  const spot = findSpaceTarget(attacker, marker);
  check("the resulting spot is further from the marker than the attacker's own current position",
    yardDistance(marker, spot) > yardDistance(marker, attacker));
  check("the resulting spot stays inside playable bounds", spot.x >= 0 && spot.x <= 100 && spot.y >= 0 && spot.y <= 100);

  // Near a touchline/corner, the escape direction still can't leave the pitch.
  const cornerAttacker = { x: 2, y: 2 };
  const cornerMarker = { x: 4, y: 4 };
  const cornerSpot = findSpaceTarget(cornerAttacker, cornerMarker);
  check("escaping near a corner still clamps inside playable bounds", cornerSpot.x >= 0 && cornerSpot.y >= 0);

  const goalAwareDown = findSpaceTargetForAttack(
    { x: 50, y: 50 }, [{ x: 50, y: 54 }], "down",
  );
  check("a goal-side marker does not automatically make a down-attacking player retreat from goal",
    goalAwareDown.y >= 50);
  const goalAwareUp = findSpaceTargetForAttack(
    { x: 50, y: 50 }, [{ x: 50, y: 46 }], "up",
  );
  check("the same goal-aware escape scoring mirrors correctly for an up-attacking player",
    goalAwareUp.y <= 50);
}

console.log("\n=== Off-Ball Attacker Awareness v1: forwardRunTarget -- real forward progress with an inward bias ===");
{
  const central = { x: 50, y: 40 };
  const runDown = forwardRunTarget(central, "down");
  check("attacking 'down' means the run genuinely advances toward y:100", runDown.y > central.y);
  const runUp = forwardRunTarget(central, "up");
  check("attacking 'up' means the run genuinely advances toward y:0", runUp.y < central.y);

  const wideLeft = { x: 15, y: 40 };
  const wideRun = forwardRunTarget(wideLeft, "down");
  check("a wide starting run angles inward toward the center, not straight up the touchline", wideRun.x > wideLeft.x);
}

console.log("\n=== Off-Ball Movement v1: planAttackerRepositioning -- coordinated attacking jobs ===");
{
  const markedAttacker = { id: "marked", x: 50, y: 40 };
  const unmarkedAttacker = { id: "unmarked", x: 20, y: 40 };
  const closeDefender = { id: "close-def", x: 51, y: 41 }; // well within ATTACKER_MARKED_RADIUS_YARDS(7)
  const plan = planAttackerRepositioning([markedAttacker, unmarkedAttacker], [closeDefender], "down");
  const markedStep = plan.find((step) => step.id === "marked");
  const unmarkedStep = plan.find((step) => step.id === "unmarked");
  check("a teammate with a real defender nearby receives a diagonal-inside job", Boolean(markedStep) && markedStep.action === "diagonal-inside");
  check("a teammate who can win the arrival race exclusively claims run-in-behind", Boolean(unmarkedStep) && unmarkedStep.action === "run-in-behind");
  check("no attacking teammates at all returns an empty plan", planAttackerRepositioning([], [closeDefender], "down").length === 0);

  const again = planAttackerRepositioning([markedAttacker, unmarkedAttacker], [closeDefender], "down");
  check("identical inputs reproduce an identical plan (no hidden randomness)", JSON.stringify(plan) === JSON.stringify(again));

  const jobRoster = [
    { id: "job-support", x: 46, y: 34, player: SHARP },
    { id: "job-runner", x: 50, y: 48, player: SHARP },
    { id: "job-wide", x: 8, y: 44, player: SHARP },
    { id: "job-pin", x: 65, y: 52, player: AVERAGE },
  ];
  const jobs = planAttackerRepositioning(jobRoster, [], "down", { ballPoint: { x: 50, y: 30 } });
  check("team assignment claims at most one runner and one short-support job",
    jobs.filter((step) => step.action === "run-in-behind").length === 1
      && jobs.filter((step) => step.action === "support-short").length === 1);
  const pin = jobs.find((step) => step.action === "pin-last-line");
  const pinnedPlayer = pin && jobRoster.find((entry) => entry.id === pin.id);
  check("pin-last-line is represented as an explicit valuable zero-movement job",
    Boolean(pin?.held) && yardDistance(pin.target, pinnedPlayer) < 0.01);
}

console.log("\n=== Motion v1 snapshot contract: partial writes would change a defender's decision ===");
{
  // Feeding a defender a teammate position already mutated by the same
  // reaction produces a materially different target. Motion v1 therefore
  // gives both planners the same snapshot, commits all movement atomically,
  // and lets the defender observe the completed run on the following tick.
  const ball = { x: 50, y: 20 };
  const attacker = { id: "runner", x: 50, y: 40 };
  const presser = { id: "presser", x: 48, y: 22 };
  const cover = { id: "cover", x: 70, y: 60 }; // far from the attacker's ORIGINAL spot
  const attackerPlan = planAttackerRepositioning([attacker], [presser, cover], "down");
  const runnerStep = attackerPlan.find((step) => step.id === "runner");
  check("the runner (unmarked -- neither presser nor cover is within the marked radius) is assigned run-in-behind",
    Boolean(runnerStep) && runnerStep.action === "run-in-behind");
  const movedAttacker = { id: "runner", x: runnerStep.target.x, y: runnerStep.target.y };

  const defensePlanBefore = planDefensiveRepositioning(ball, [attacker], [presser, cover], "up");
  const defensePlanAfter = planDefensiveRepositioning(ball, [movedAttacker], [presser, cover], "up");
  const coverBefore = defensePlanBefore.find((step) => step.id === "cover");
  const coverAfter = defensePlanAfter.find((step) => step.id === "cover");
  check("feeding a partial attacker write into the same tick would change the covering defender's target",
    coverBefore.target.x !== coverAfter.target.x || coverBefore.target.y !== coverAfter.target.y);
  // The ideal (uncapped) goal-side mark for each position is what
  // ultimately drives that difference -- confirms it's a real function
  // of the runner's own new spot, not incidental noise.
  const idealBefore = coveringPositionPoint(attacker, "up");
  const idealAfter = coveringPositionPoint(movedAttacker, "up");
  check("on the following snapshot, the ideal covering mark shifts in the direction of the completed run",
    Math.sign(idealAfter.y - idealBefore.y) === Math.sign(movedAttacker.y - attacker.y));
}

console.log("\n=== Off-Ball Movement v1: arrival races combine anticipation head-start with physical travel ===");
{
  const cleverSlow = {
    id: "clever-slow", x: 50, y: 50,
    player: player("Clever Slow", { "Off the Ball": 20, Anticipation: 20, Decisions: 20, Pace: 8, Acceleration: 8 }),
  };
  const unawareFast = {
    id: "unaware-fast", x: 50, y: 50,
    player: player("Unaware Fast", { "Off the Ball": 5, Anticipation: 5, Decisions: 5, Pace: 18, Acceleration: 18 }),
  };
  const defender = {
    id: "race-defender", x: 50, y: 70,
    player: player("Race Defender", { Anticipation: 10, Pace: 10, Acceleration: 10 }),
  };
  const target = { x: 50, y: 60 };
  check("a clever runner can claim space by leaving early despite modest pace",
    claimable(cleverSlow, target, [defender]));
  check("raw pace does not rescue a late-reading runner from the same arrival race",
    !claimable(unawareFast, target, [defender]));
}

console.log("\n=== Off-Ball Movement v1: legal passing options are measured from the gated candidate list ===");
{
  const owner = { id: "metric-owner", role: "player", x: 50, y: 50, player: SHARP };
  const targetA = { id: "metric-a", role: "player", x: 35, y: 58, player: AVERAGE };
  const targetB = { id: "metric-b", role: "player", x: 65, y: 58, player: AVERAGE };
  const opponent = { id: "metric-def", role: "player", x: 50, y: 60, player: AVERAGE };
  const groups = { owner, teammates: [targetA, targetB], opponents: [opponent], keeper: null };
  const candidates = generateFreePlayCandidates(groups, "down");
  const metrics = decisionOptionMetrics(candidates, groups);
  check("the KPI counts distinct legal pass recipients, not cross/carry/shot candidates",
    metrics.legalPassingOptions === 2);
  check("the same snapshot reports local overload and pressure inputs",
    metrics.localFriendlyCount === 3 && metrics.localOpponentCount === 1
      && Number.isFinite(metrics.pressureAtDecision));
}

console.log("\n=== Explicit role and range gates: keepers distribute; only qualified players shoot long ===");
{
  // Keeper Catch & Distribution v1 (2026-08-23) -- with no ballState at
  // all (this fixture doesn't model one), generateFreePlayCandidates()
  // defaults to the safer "holding" assumption: only the four real ways a
  // keeper puts a caught ball back into play, never a generic pass.
  const teammate = { id: "target", role: "player", x: 42, y: 72, player: AVERAGE };
  const keeperOwner = { id: "keeper-owner", role: "keeper", x: 50, y: 95, player: SHARP };
  const keeperCandidates = generateFreePlayCandidates({
    owner: keeperOwner, teammates: [teammate], opponents: [], keeper: null,
  }, "up");
  const KEEPER_DISTRIBUTION_TYPES = new Set(["throw-short", "throw-long", "punt", "release-to-feet"]);
  check("a goalkeeper holding the ball receives real distribution candidates",
    keeperCandidates.some((candidate) => KEEPER_DISTRIBUTION_TYPES.has(candidate.type)));
  check("release-to-feet is always offered as a legal option",
    keeperCandidates.some((candidate) => candidate.type === "release-to-feet"));
  check("a goalkeeper never receives a generic pass, shoot, carry, dribble, or cross candidate while holding",
    keeperCandidates.every((candidate) => KEEPER_DISTRIBUTION_TYPES.has(candidate.type)));

  // Released to feet (ballState explicitly says so): real pass/carry
  // options unlock, but still never a cross/through/shot/dribble-duel.
  const releasedCandidates = generateFreePlayCandidates({
    owner: keeperOwner, teammates: [teammate], opponents: [], keeper: null,
    ballState: { phase: "controlled-ground" },
  }, "up");
  check("a goalkeeper released to feet receives a genuine pass option",
    releasedCandidates.some((candidate) => candidate.type === "pass"));
  check("a goalkeeper released to feet receives a genuine carry option",
    releasedCandidates.some((candidate) => candidate.type === "carry"));
  check("a goalkeeper released to feet still never receives cross, through, shoot, or dribble-duel candidates",
    releasedCandidates.every((candidate) => !["cross", "through", "shoot", "dribble"].includes(candidate.type)));

  const outfieldOwner = { id: "outfield-owner", role: "player", x: 50, y: 50, player: SHARP };
  const malformedKeeperOpponent = { id: "misgrouped-gk", role: "keeper", x: 51, y: 51, player: AVERAGE };
  const guardedCandidates = generateFreePlayCandidates({
    owner: outfieldOwner, teammates: [], opponents: [malformedKeeperOpponent], keeper: malformedKeeperOpponent,
  }, "down");
  check("even malformed input cannot turn a goalkeeper into a generic dribble/duel target",
    !guardedCandidates.some((candidate) => candidate.type === "dribble" || candidate.target?.id === malformedKeeperOpponent.id));

  const ordinaryFar = { id: "ordinary-far", role: "player", x: 50, y: 22, player: AVERAGE };
  const elitePlayer = player("Long-shot specialist", {
    "Long Shots": 18, Shooting: 18, Technique: 17, Composure: 17,
    Decisions: 18, Vision: 17, Anticipation: 17,
  });
  const eliteFar = {
    id: "elite-far", role: "player", x: 50, y: 55,
    player: elitePlayer,
  };
  const setKeeper = { id: "set-keeper", role: "keeper", x: 50, y: 98, player: AVERAGE };
  const advancedKeeper = { id: "advanced-keeper", role: "keeper", x: 50, y: 75, player: AVERAGE };
  check("an ordinary player cannot choose a speculative shot from their own half",
    !canAttemptShot(ordinaryFar, "down"));
  check("a qualified long-shot specialist may exploit an empty net from about 49m",
    canAttemptShot(eliteFar, "down"));
  check("attributes alone do not make the same roughly 49m shot viable against a set keeper",
    !canAttemptShot(eliteFar, "down", setKeeper));
  check("the same specialist may exploit a keeper who is genuinely far off the line",
    canAttemptShot(eliteFar, "down", advancedKeeper));

  const fortyMetrePoint = fromYardPoint({
    x: PITCH_WIDTH_YARDS / 2,
    y: PITCH_LENGTH_YARDS - (40 / 0.9144),
  });
  const fortyMetreSpecialist = {
    id: "forty-metre-specialist", role: "player", ...fortyMetrePoint,
    player: elitePlayer, shootingInstruction: "balanced",
  };
  const fortyMetreOrdinary = {
    ...fortyMetreSpecialist,
    id: "forty-metre-ordinary",
    player: player("Ordinary shooter", {
      "Long Shots": 11, Shooting: 11, Technique: 12, Composure: 12,
      Decisions: 15, Vision: 15, Anticipation: 15,
    }),
  };
  check("fixture sanity: the new boundary is exactly 40m from goal",
    Math.abs(distanceToGoalYards(fortyMetreSpecialist, "down") * 0.9144 - 40) < 0.001);
  check("a confident long-range specialist retains a legal 40m attempt against a set keeper",
    canAttemptShot(fortyMetreSpecialist, "down", setKeeper));
  check("an ordinary shooter does not mistake the 40m boundary for normal shooting range",
    !canAttemptShot(fortyMetreOrdinary, "down", setKeeper));
  check("the specialist's long-range confidence is materially higher than the ordinary shooter's",
    longRangeShotConfidence(elitePlayer) > longRangeShotConfidence(fortyMetreOrdinary.player) + 0.2);

  const recentShield = {
    consecutiveHoldOwnerId: fortyMetreSpecialist.id,
    recentPairs: [{ aId: fortyMetreSpecialist.id, bId: "close-marker", actionsAgo: 0 }],
  };
  const closeMarker = {
    id: "close-marker", role: "player", x: fortyMetreSpecialist.x,
    y: fortyMetreSpecialist.y + 2.5, player: AVERAGE,
  };
  const candidatesForInstruction = (shootingInstruction) => generateFreePlayCandidates({
    owner: { ...fortyMetreSpecialist, shootingInstruction },
    teammates: [], opponents: [closeMarker], keeper: setKeeper,
  }, "down", undefined, recentShield);
  const discouraged = candidatesForInstruction("discourage");
  const balanced = candidatesForInstruction("balanced");
  const encouraged = candidatesForInstruction("encourage");
  check("the 40m specialist has both a speculative shot and a safety carry after the shield",
    balanced.some((candidate) => candidate.type === "shoot")
      && balanced.some((candidate) => candidate.type === "carry"));
  const shotUtilityOf = (candidates) => candidates.find((candidate) => candidate.type === "shoot")?.utility;
  check("Shoot more raises the same player's identical 40m shot ranking",
    shotUtilityOf(encouraged) > shotUtilityOf(balanced));
  check("Shoot less lowers the same player's identical 40m shot ranking",
    shotUtilityOf(discouraged) < shotUtilityOf(balanced));

  function selectedShotRate(candidates, seed, trials = 4_000) {
    const random = makeRandom(seed);
    let shots = 0;
    for (let index = 0; index < trials; index += 1) {
      if (chooseCandidate(candidates, elitePlayer, random)?.type === "shoot") shots += 1;
    }
    return shots / trials;
  }
  const discouragedRate = selectedShotRate(discouraged, 901);
  const balancedRate = selectedShotRate(balanced, 902);
  const encouragedRate = selectedShotRate(encouraged, 903);
  check(`a balanced 40m shot is possible but highly unlikely (${Math.round(balancedRate * 100)}%; shot utility ${shotUtilityOf(balanced)?.toFixed(2)}, carry ${balanced.find((candidate) => candidate.type === "carry")?.utility.toFixed(2)})`,
    balancedRate > 0 && balancedRate < 0.15);
  check(`Shoot more makes the 40m attempt materially more likely (${Math.round(encouragedRate * 100)}% vs ${Math.round(balancedRate * 100)}%)`,
    encouragedRate > balancedRate + 0.15);
  check(`Shoot less makes it rarer still (${Math.round(discouragedRate * 100)}% vs ${Math.round(balancedRate * 100)}%)`,
    discouragedRate < balancedRate);
}

console.log("\n=== dribbleUtility(): danger-sensitive (2026-08-18 fix -- a real bug had this ignore the defender entirely) ===");
{
  // Same owner/direction throughout -- only the defender's own distance
  // changes, isolating the danger term from the (unrelated) progression
  // term the old code already computed correctly.
  const owner = { x: 50, y: 50 };
  const farDefender = { x: 50, y: 90 };
  const closeDefender = { x: 50, y: 51 };
  const pointBlankDefender = { x: 50, y: 50 };
  const progression = clampLikeUtility((PITCH_LENGTH_YARDS - distanceToGoalYards(owner, "down")) / PITCH_LENGTH_YARDS);
  check("a defender far outside pressure range applies zero danger penalty -- matches the pure progression formula",
    Math.abs(dribbleUtility(owner, farDefender, "down") - (0.2 + progression * 0.5)) < 1e-9);
  check("a genuinely close defender measurably LOWERS utility relative to a far one -- the fixed bug's own symptom",
    dribbleUtility(owner, closeDefender, "down") < dribbleUtility(owner, farDefender, "down"));
  check("a defender right on top of the carrier drives utility below the old unconditional floor (was always >= ~0.2 regardless of the defender)",
    dribbleUtility(owner, pointBlankDefender, "down") < 0.2);
  check("danger is monotonic -- point-blank is worse than merely close",
    dribbleUtility(owner, pointBlankDefender, "down") < dribbleUtility(owner, closeDefender, "down"));
}

function clampLikeUtility(value) { return Math.max(0, Math.min(1, value)); }

console.log("\n=== holdUtility(): support-sensitive and pressure-sensitive, fully deterministic (no RNG consumed) ===");
{
  const owner = { x: 50, y: 50 };
  const nearTeammate = { x: 55, y: 52 };
  const farTeammate = { x: 50, y: 95 };
  const closeOpponent = { x: 50, y: 50 };
  const baseline = holdUtility(owner, [], []);
  check("identical inputs reproduce an identical value -- no hidden randomness",
    holdUtility(owner, [], []) === baseline);
  check("a teammate genuinely within support range makes holding measurably more attractive",
    holdUtility(owner, [nearTeammate], []) > baseline);
  check("a teammate far outside support range gives no bonus -- same as no teammate at all",
    holdUtility(owner, [farTeammate], []) === baseline);
  check("real pressure from an opponent makes holding measurably less attractive",
    holdUtility(owner, [], [closeOpponent]) < baseline);
  check("support and pressure combine rather than one silently overriding the other",
    holdUtility(owner, [nearTeammate], [closeOpponent]) !== holdUtility(owner, [nearTeammate], []));
}

console.log("\n=== Hold-Up Play v1: 'hold' is now an unconditional Free Play candidate, open space or contested ===");
{
  const owner = { id: "hold-owner", role: "player", x: 50, y: 50, player: SHARP };
  const openGroups = { owner, teammates: [], opponents: [{ id: "far", x: 90, y: 90, player: AVERAGE }], keeper: null };
  const contestedGroups = { owner, teammates: [], opponents: [{ id: "near", x: 51, y: 51, player: AVERAGE }], keeper: null };
  check("hold is offered in open space alongside carry, not only when contested",
    generateFreePlayCandidates(openGroups, "down").some((c) => c.type === "hold"));
  check("hold is also offered when a defender is close enough to engage (dribble is on the table too)",
    generateFreePlayCandidates(contestedGroups, "down").some((c) => c.type === "hold"));
  check("a goalkeeper still never receives a generic hold candidate (role gate holds)",
    !generateFreePlayCandidates(
      { owner: { id: "gk", role: "keeper", x: 50, y: 95, player: SHARP }, teammates: [], opponents: [], keeper: null }, "up",
    ).some((c) => c.type === "hold"));
}

console.log("\n=== Cross geometry fix (2026-08-18): a cross is a delivery INTO the box, not to any teammate ===");
{
  // isCrossTargetZone: real box geometry, not distance-to-goal-center.
  const inBox = { x: 50, y: 96 }; // attacking "down", goal at y:100 -- deep in the box
  const edgeOfBox = { x: 50, y: 82 }; // just inside the 18-yard line + margin
  const midfieldWide = { x: 80, y: 40 }; // reported-bug shape: wide, but zone 4/5 depth
  check("a point deep in the box is a legal cross target", isCrossTargetZone(inBox, "down"));
  check("a point just inside the box (plus margin) is still a legal cross target", isCrossTargetZone(edgeOfBox, "down"));
  check("a wide but genuinely midfield-deep point is NOT a legal cross target -- the reported bug's own shape",
    !isCrossTargetZone(midfieldWide, "down"));

  // Structural: generateFreePlayCandidates() must gate on the RECEIVER's
  // own position, not just the crosser's. The crosser is placed in a
  // genuinely realistic crossing position (wide AND close enough to the
  // byline) so this isolates the RECEIVER-side gate specifically, not the
  // (separately tested) crosser-side depth gate.
  const crosser = { id: "crosser", role: "player", x: 70, y: 85, player: SHARP };
  const midfieldTeammate = { id: "deep-teammate", role: "player", x: 40, y: 42, player: AVERAGE };
  const boxTeammate = { id: "box-teammate", role: "player", x: 45, y: 94, player: AVERAGE };
  const noCrossCandidates = generateFreePlayCandidates(
    { owner: crosser, teammates: [midfieldTeammate], opponents: [], keeper: null }, "down",
  );
  check("no cross is offered to a teammate standing in the same wide-midfield band as the crosser (reported bug: zone 5 to zone 4)",
    !noCrossCandidates.some((c) => c.type === "cross"));
  const crossCandidates = generateFreePlayCandidates(
    { owner: crosser, teammates: [boxTeammate], opponents: [], keeper: null }, "down",
  );
  check("a cross IS offered to a teammate genuinely in the box", crossCandidates.some((c) => c.type === "cross"));
}

console.log("\n=== Through Ball v1 (2026-08-18): recognizing a live run-in-behind job as a real passing option ===");
{
  // Known-good run-in-behind geometry, reused from the existing
  // planAttackerRepositioning acceptance coverage above (job-runner wins
  // the arrival race and claims run-in-behind with zero opponents placed).
  const owner = { id: "through-owner", role: "player", x: 50, y: 30, player: SHARP };
  const jobRoster = [
    { id: "job-support", x: 46, y: 34, player: SHARP },
    { id: "job-runner", x: 50, y: 48, player: SHARP },
    { id: "job-wide", x: 8, y: 44, player: SHARP },
    { id: "job-pin", x: 65, y: 52, player: AVERAGE },
  ];
  const candidates = generateFreePlayCandidates({ owner, teammates: jobRoster, opponents: [], keeper: null }, "down");
  const throughCandidate = candidates.find((c) => c.type === "through");
  check("a through-ball candidate is offered, targeting the exact runner planAttackerRepositioning assigned run-in-behind",
    Boolean(throughCandidate) && throughCandidate.target.id === "job-runner");
  check("its moveTo is the runner's forward INTENTION point, not their current position",
    Boolean(throughCandidate) && throughCandidate.moveTo.y > 48);

  // Negative: a marked attacker with no clean run offers no through ball.
  const noRunOwner = { id: "no-run-owner", role: "player", x: 50, y: 40, player: SHARP };
  const markedTeammate = { id: "marked-teammate", x: 52, y: 42, player: SHARP };
  const closeDefender = { id: "close-def", x: 52, y: 41, player: AVERAGE };
  const noRunCandidates = generateFreePlayCandidates(
    { owner: noRunOwner, teammates: [markedTeammate], opponents: [closeDefender], keeper: null }, "down",
  );
  check("no through-ball candidate exists when nobody qualifies for a real run-in-behind",
    !noRunCandidates.some((c) => c.type === "through"));

  // A goalkeeper never receives one either (same role gate as every other
  // outfield-only candidate type).
  const keeperCandidates = generateFreePlayCandidates(
    { owner: { id: "gk-through", role: "keeper", x: 50, y: 95, player: SHARP }, teammates: jobRoster, opponents: [], keeper: null }, "up",
  );
  check("a goalkeeper never receives a through-ball candidate", !keeperCandidates.some((c) => c.type === "through"));

  // throughBallUtility() itself: real geometric sensitivity.
  const passer = { x: 50, y: 30 };
  const deepTarget = { x: 50, y: 90 };
  const shallowTarget = { x: 50, y: 45 };
  check("a target deep in behind (much closer to goal) scores higher than a shallow one on the same line",
    throughBallUtility(passer, deepTarget, [], "down") > throughBallUtility(passer, shallowTarget, [], "down"));
  const cover = { x: 50, y: 90 };
  check("real pressure right on the target point reduces through-ball utility",
    throughBallUtility(passer, deepTarget, [cover], "down") < throughBallUtility(passer, deepTarget, [], "down"));
}

console.log("\n=== Off-Ball Attribute Awareness v1 (2026-08-19): a good off-the-ball attacker breaks free more easily ===");
{
  const goodOffBall = player("Good Off-the-Ball", { "Off the Ball": 18, Anticipation: 17, Decisions: 17 });
  const poorOffBall = player("Poor Off-the-Ball", { "Off the Ball": 6, Anticipation: 6, Decisions: 6 });
  const attackerPoint = { x: 50, y: 50 };
  const marker = { x: 50, y: 52 };
  const goodEscape = findSpaceTargetForAttack(attackerPoint, [marker], "down", goodOffBall);
  const poorEscape = findSpaceTargetForAttack(attackerPoint, [marker], "down", poorOffBall);
  check("a genuinely good off-the-ball attacker (Off the Ball/Anticipation/Decisions) finds MORE separation from the same marker, same starting spot, than a poor one",
    yardDistance(goodEscape, marker) > yardDistance(poorEscape, marker));
  check("omitting the attacker's player entirely still returns a real, in-bounds escape point (defensive default)",
    Boolean(findSpaceTargetForAttack(attackerPoint, [marker], "down")));
}

console.log("\n=== Off-Ball Attribute Awareness v1: a good marker plays tighter than a poor one ===");
{
  const subject = { x: 50, y: 50 };
  const goodMarker = player("Good Marker", { Positioning: 18, Marking: 17, Anticipation: 17 });
  const poorMarker = player("Poor Marker", { Positioning: 6, Marking: 6, Anticipation: 6 });
  const tight = coveringPositionPoint(subject, "down", goodMarker);
  const loose = coveringPositionPoint(subject, "down", poorMarker);
  check("a genuinely good marker (Positioning/Marking/Anticipation) stands measurably CLOSER to the subject than a poor one",
    yardDistance(tight, subject) < yardDistance(loose, subject));
  check("omitting the defender's player entirely still returns a real, sensible covering point (defensive default)",
    Boolean(coveringPositionPoint(subject, "down")));
}

console.log("\n=== Off-Ball Attribute Awareness v1: Work Rate/Stamina scale real per-step ground covered, both sides ===");
{
  const ballPoint = { x: 50, y: 95 };
  const presser = { id: "effort-presser", x: 50, y: 90 };
  const highEffortDefender = { id: "high-effort-def", x: 50, y: 10, player: player("High Effort Def", { "Work Rate": 18, Stamina: 18 }) };
  const lowEffortDefender = { id: "low-effort-def", x: 50, y: 10, player: player("Low Effort Def", { "Work Rate": 6, Stamina: 6 }) };
  const highDefPlan = planDefensiveRepositioning(ballPoint, [], [presser, highEffortDefender], "up");
  const lowDefPlan = planDefensiveRepositioning(ballPoint, [], [presser, lowEffortDefender], "up");
  const highDefStep = highDefPlan.find((step) => step.id === "high-effort-def");
  const lowDefStep = lowDefPlan.find((step) => step.id === "low-effort-def");
  check("both defenders are chasing the identical far-away recovery target (isolates the advance CAP, not a different destination)",
    JSON.stringify(highDefStep.intentionTarget) === JSON.stringify(lowDefStep.intentionTarget));
  check("a high work-rate/stamina defender covers measurably more ground on the identical recovery run than a low one",
    yardDistance(highEffortDefender, highDefStep.target) > yardDistance(lowEffortDefender, lowDefStep.target));

  const attackerBallPoint = { x: 50, y: 95 };
  const highEffortAttacker = { id: "high-effort-att", x: 10, y: 5, player: player("High Effort Att", { "Work Rate": 18, Stamina: 18 }) };
  const lowEffortAttacker = { id: "low-effort-att", x: 10, y: 5, player: player("Low Effort Att", { "Work Rate": 6, Stamina: 6 }) };
  const highAttPlan = planAttackerRepositioning([highEffortAttacker], [], "down", { ballPoint: attackerBallPoint });
  const lowAttPlan = planAttackerRepositioning([lowEffortAttacker], [], "down", { ballPoint: attackerBallPoint });
  check("both attackers are chasing the identical far-away target too",
    JSON.stringify(highAttPlan[0].intentionTarget) === JSON.stringify(lowAttPlan[0].intentionTarget));
  check("a high work-rate/stamina attacker covers measurably more ground on the identical run than a low one",
    yardDistance(highEffortAttacker, highAttPlan[0].target) > yardDistance(lowEffortAttacker, lowAttPlan[0].target));
}

console.log("\n=== Defensive Shape Discipline v1 (2026-08-19): a classified back line spreads into real, distinct slots ===");
{
  function defenderPlayer(name, positioning) {
    return { canonical_player_name: name, current_ability: 150, position_text: "D", attributes: attrs({ Positioning: positioning, "Work Rate": 12, Stamina: 12 }) };
  }
  check("classifyOutfieldBand() reads a bare 'D' position_text as a real defender", classifyOutfieldBand({ position_text: "D" }) === "defender");

  const ballPoint = { x: 50, y: 60 };
  const defenders = [
    { id: "d1", x: 50, y: 55, player: defenderPlayer("D1", 14) },
    { id: "d2", x: 30, y: 10, player: defenderPlayer("D2", 14) },
    { id: "d3", x: 40, y: 10, player: defenderPlayer("D3", 14) },
    { id: "d4", x: 60, y: 10, player: defenderPlayer("D4", 14) },
    { id: "d5", x: 70, y: 10, player: defenderPlayer("D5", 14) },
  ];
  const plan = planDefensiveRepositioning(ballPoint, [], defenders, "up");
  const shiftUnits = plan.filter((step) => step.action === "shift-unit");
  check("with five real defenders and no attacking threat, at least two land on shift-unit (spread duty)", shiftUnits.length >= 2);
  const xs = shiftUnits.map((step) => step.intentionTarget.x);
  check("every shift-unit defender's own ideal slot is laterally DISTINCT -- a real spread, not everyone collapsing onto the same point",
    new Set(xs.map((x) => Math.round(x * 10))).size === xs.length);
  check("state stays a plain, immutable-input computation -- the same authored fixture reproduces an identical plan",
    JSON.stringify(plan) === JSON.stringify(planDefensiveRepositioning(ballPoint, [], defenders, "up")));
}

console.log("\n=== Defensive Shape Discipline v1: Positioning attribute drives real line discipline ===");
{
  function defenderPlayer(name, positioning) {
    return { canonical_player_name: name, current_ability: 150, position_text: "D", attributes: attrs({ Positioning: positioning, "Work Rate": 12, Stamina: 12 }) };
  }
  const ballPoint = { x: 50, y: 95 };
  function build(positioning) {
    return [
      { id: "presser", x: 50, y: 90, player: defenderPlayer("Presser", positioning) },
      { id: "far1", x: 20, y: 10, player: defenderPlayer("Far1", positioning) },
      { id: "far2", x: 80, y: 10, player: defenderPlayer("Far2", positioning) },
    ];
  }
  const highPlan = planDefensiveRepositioning(ballPoint, [], build(19), "up");
  const lowPlan = planDefensiveRepositioning(ballPoint, [], build(4), "up");
  const highShift = highPlan.find((step) => step.action === "shift-unit");
  const lowShift = lowPlan.find((step) => step.action === "shift-unit");
  check("found a real shift-unit defender in both the high- and low-Positioning plans", Boolean(highShift) && Boolean(lowShift));
  check("a genuinely well-drilled (high Positioning) defender holds their own line slot, FAR from the ball",
    yardDistance(highShift.intentionTarget, ballPoint) > yardDistance(lowShift.intentionTarget, ballPoint));
  check("a genuinely poor (low Positioning) defender is measurably dragged toward the ball -- real, deterministic drift, not noise",
    yardDistance(lowShift.intentionTarget, ballPoint) < yardDistance(highShift.intentionTarget, ballPoint) - 5);
}

console.log("\n=== Through Ball v1 distance cap (2026-08-19): no full-pitch launch, a realistic one still offered ===");
{
  const sharpRunner = player("Sharp Runner", { "Off the Ball": 18, Anticipation: 18, Pace: 18, Acceleration: 18 });
  const farOwner = { id: "far-owner", role: "player", x: 50, y: 5, player: SHARP };
  const farRunner = { id: "far-runner", x: 50, y: 90, player: sharpRunner };
  const farCandidates = generateFreePlayCandidates(
    { owner: farOwner, teammates: [farRunner], opponents: [], keeper: null }, "down",
  );
  check("a run-in-behind job nearly the FULL length of the pitch away (~100+ yards) is NOT offered as a through ball -- the reported full-pitch-launch bug",
    !farCandidates.some((c) => c.type === "through"));

  const nearOwner = { id: "near-owner", role: "player", x: 50, y: 40, player: SHARP };
  const nearRunner = { id: "near-runner", x: 50, y: 65, player: sharpRunner };
  const nearCandidates = generateFreePlayCandidates(
    { owner: nearOwner, teammates: [nearRunner], opponents: [], keeper: null }, "down",
  );
  check("a realistic ~30-yard run-in-behind job is still offered as a through ball -- the cap doesn't remove the feature entirely",
    nearCandidates.some((c) => c.type === "through"));
}

console.log("\n=== Forward Pairing v1 (2026-08-19): two advanced attackers no longer BOTH just stand still ===");
{
  // A real browser round asked for exactly this: when two forwards are
  // both advanced and near each other, one should drop deep to offer a
  // link while the other holds the line -- not both just pinning in
  // place. Three forward-band attackers here (not two) so that AFTER the
  // single global run-in-behind slot is claimed by the sharpest of them,
  // the remaining two are both still genuinely pin-eligible -- exactly
  // the scenario this feature targets.
  const midfielder = { id: "mid", x: 50, y: 55 };
  const closeForward = { id: "close-fwd", x: 60, y: 84 }; // closer to the ball of the two remaining
  const farForward = { id: "far-fwd", x: 40, y: 85 };
  const runnerForward = { id: "runner-fwd", x: 50, y: 87 };
  const ballPoint = { x: 50, y: 50 };
  const plan = planAttackerRepositioning(
    [midfielder, closeForward, farForward, runnerForward], [], "down", { ballPoint },
  );
  const runnerStep = plan.find((step) => step.id === "runner-fwd");
  const closeStep = plan.find((step) => step.id === "close-fwd");
  const farStep = plan.find((step) => step.id === "far-fwd");
  check("exactly one of the three forward-band attackers wins the single global run-in-behind slot",
    runnerStep.action === "run-in-behind");
  check("of the two REMAINING pin-eligible forwards, the one closer to the ball drops deep instead of standing still",
    closeStep.action === "drop-deep");
  check("its target is a real move toward the ball, not the same zero-movement pin",
    yardDistance(closeStep.intentionTarget, ballPoint) < yardDistance({ x: closeForward.x, y: closeForward.y }, ballPoint));
  check("the farther of the two remaining forwards still holds the line -- not everyone drops at once",
    farStep.action === "pin-last-line");
  check("identical inputs reproduce an identical plan (no hidden randomness)",
    JSON.stringify(plan) === JSON.stringify(planAttackerRepositioning(
      [midfielder, closeForward, farForward, runnerForward], [], "down", { ballPoint },
    )));

  // A LONE advanced forward (no nearby pin-eligible peer at all) must
  // keep the ORIGINAL behavior -- pairing off a group of one is
  // meaningless, and this must not regress the existing pin-last-line
  // contract for a genuinely isolated forward. Reuses the same
  // three-attacker shape (one wins run-in-behind, freeing exactly one
  // OTHER genuinely pin-eligible attacker) but keeps that remaining
  // forward far enough away (beyond FORWARD_PAIR_RADIUS_YARDS) to have no
  // real partner, and central enough to avoid the separate hold-width gate.
  const loneMidfielder = { id: "lone-mid", x: 50, y: 55 };
  const loneRunner = { id: "lone-runner", x: 50, y: 87 };
  const isolatedForward = { id: "isolated-fwd", x: 48, y: 68 };
  const lonePlan = planAttackerRepositioning([loneMidfielder, loneRunner, isolatedForward], [], "down", { ballPoint });
  const runnerCheck = lonePlan.find((step) => step.id === "lone-runner");
  const loneStep = lonePlan.find((step) => step.id === "isolated-fwd");
  check("the setup's own runner still wins run-in-behind as expected (sanity check on the fixture itself)",
    runnerCheck.action === "run-in-behind");
  check("a lone advanced forward with no nearby peer still just pins the line, unchanged (never drop-deep)",
    loneStep.action === "pin-last-line");
}

console.log("\n=== Role stickiness (2026-08-19): two near-tied teammates no longer swap jobs on razor-thin noise ===");
{
  // Reported directly, with screenshots across several consecutive
  // frames: two teammates (roughly the same distance from the ball)
  // visibly swapping positions over and over. Root cause: supportId/
  // dropId were both chosen by pure nearest-to-the-ball distance,
  // re-decided from zero on every call -- when two players are nearly
  // tied, the tiniest geometry drift between reactions is enough to flip
  // who is nominally closer, and the flip swaps their ENTIRE job (and
  // therefore their target point). previousSupportId/previousDropId let
  // the CURRENT holder keep their job unless a rival is closer by more
  // than ROLE_STICKINESS_MARGIN_YARDS -- omitting them (every pre-
  // existing caller) reproduces the exact old pure-nearest behavior, so
  // this is additive, not a change to any existing call site's contract.
  const ballPoint = { x: 20, y: 20 };
  const others = [{ id: "AL", x: 70, y: 55 }, { id: "HH", x: 55, y: 45 }];
  const iz = { id: "IZ", x: 42, y: 38 };
  // JC edges very slightly closer than IZ on this next reaction -- a
  // sub-1-yard lead, the exact kind of noise the report caught.
  const jc = { id: "JC", x: 41.5, y: 37.7 };
  check("test fixture sanity: JC really is nominally closer to the ball than IZ here, but only by a razor-thin margin",
    yardDistance(jc, ballPoint) < yardDistance(iz, ballPoint)
      && yardDistance(iz, ballPoint) - yardDistance(jc, ballPoint) < 1);

  const withoutHint = planAttackerRepositioning([iz, jc, ...others], [], "down", { ballPoint });
  check("without the previous-holder hint (the old behavior), the razor-thin lead flips the job to the new nominal nearest",
    withoutHint.find((s) => s.id === "JC").action === "support-short"
      && withoutHint.find((s) => s.id === "IZ").action !== "support-short");

  const withHint = planAttackerRepositioning([iz, jc, ...others], [], "down", { ballPoint, previousSupportId: "IZ" });
  check("WITH the previous-holder hint, IZ keeps support-short -- JC's lead doesn't clear the stickiness margin",
    withHint.find((s) => s.id === "IZ").action === "support-short");
  check("JC correspondingly does NOT inherit support-short this time",
    withHint.find((s) => s.id === "JC").action !== "support-short");

  // A genuinely large, real lead must still win outright -- stickiness is
  // a tiebreaker for noise, never a permanent lock on the incumbent.
  const jcFarCloser = { id: "JC", x: 22, y: 22 }; // now unambiguously the closer player
  const withHintButRealLead = planAttackerRepositioning(
    [iz, jcFarCloser, ...others], [], "down", { ballPoint, previousSupportId: "IZ" },
  );
  check("a genuinely large lead from a rival still overrides the incumbent -- stickiness never becomes a permanent lock",
    withHintButRealLead.find((s) => s.id === "JC").action === "support-short");

  // A stale previousSupportId (that player no longer exists among this
  // call's teammates -- substituted off, or simply not passed in) must
  // never throw or silently break -- falls straight back to nearest.
  const withStaleHint = planAttackerRepositioning([iz, jc, ...others], [], "down", { ballPoint, previousSupportId: "no-longer-on-pitch" });
  check("a previousSupportId that doesn't match any current teammate falls back to the plain nearest pick, no error",
    withStaleHint.find((s) => s.id === "JC").action === "support-short");
}

console.log("\n=== Hold-width tracks the ball's own depth (2026-08-19): a winger no longer freezes while the attack advances ===");
{
  // Reported directly with screenshots across several frames: a wide
  // player (Attilio Lombardo) stuck deep near the halfway line while the
  // rest of the attack progressed well into the final third. Root cause:
  // holdWidthTarget() kept `y: current.y` unconditionally -- "hold width"
  // meant hold LATERAL position, but literally froze the player's own
  // DEPTH forever at whatever it happened to be, with nothing to ever
  // pull them forward as the ball advanced.
  const jc = { id: "JC", x: 30, y: 88 };
  const iz = { id: "IZ", x: 42, y: 90 };
  const hh = { id: "HH", x: 48, y: 92 };
  const wideDeepPlayer = { id: "AL", x: 78, y: 55 };
  const ballPoint = { x: 40, y: 88 };
  const plan = planAttackerRepositioning([jc, iz, hh, wideDeepPlayer], [], "down", { ballPoint });
  const wideStep = plan.find((s) => s.id === "AL");
  check("test fixture sanity: the wide player really is assigned hold-width here",
    wideStep.action === "hold-width");
  check("the wide player's ideal spot now tracks the ball's own depth, not their own stale starting depth",
    Math.abs(wideStep.intentionTarget.y - ballPoint.y) < 0.5);
  check("their ACTUAL per-reaction target (capped advance) genuinely moves them forward this reaction, not a teleport",
    wideStep.target.y > wideDeepPlayer.y && wideStep.target.y < ballPoint.y);
  check("lateral (width) positioning is unaffected by this fix -- still inset from the near touchline",
    wideStep.intentionTarget.x > 50);

  // A winger already AHEAD of the ball must not be yanked backward to
  // meet it -- only ever advance toward the ball's depth, never retreat.
  const advancedWinger = { id: "AL2", x: 78, y: 95 };
  const planAhead = planAttackerRepositioning([jc, iz, hh, advancedWinger], [], "down", { ballPoint });
  const aheadStep = planAhead.find((s) => s.id === "AL2");
  check("a wide player already ahead of the ball keeps their own more advanced depth, never pulled backward",
    aheadStep.intentionTarget.y === advancedWinger.y);

  // Every pre-existing caller (no ballPoint at all) must reproduce the
  // exact old behavior -- purely lateral, depth genuinely untouched.
  const noBallPlan = planAttackerRepositioning([jc, iz, hh, wideDeepPlayer], [], "down", {});
  const noBallStep = noBallPlan.find((s) => s.id === "AL");
  check("with no ballPoint at all (the old call shape), depth is still left completely untouched",
    Math.abs(noBallStep.intentionTarget.y - wideDeepPlayer.y) < 0.01);
}

// ---------------------------------------------------------------------------
// Off-Ball v2 (2026-08-24) -- sticky man/zonal marking, tightness geometry,
// the tight-mark attacker reaction, and the build-up phase. Position-aware
// fixtures (classifyOutfieldBand() reads position_text -- see the "reads a
// bare 'D'" acceptance case above), distinct from this file's own
// position_text-less player() default (existing tests never needed a real
// band).
// ---------------------------------------------------------------------------
function posPlayer(name, positionText, overrides = {}) {
  return { canonical_player_name: name, current_ability: 150, position_text: positionText, attributes: attrs(overrides) };
}

console.log("\n=== Off-Ball v2: swarm still illegal -- one presser, no other defender inside DEFENSIVE_BALL_CLEARANCE_YARDS of the ball ===");
{
  const ball = { x: 50, y: 40 };
  const cb1 = { id: "cb1", x: 48, y: 20, player: posPlayer("CB1", "D") };
  const cb2 = { id: "cb2", x: 52, y: 20, player: posPlayer("CB2", "D") };
  const fb1 = { id: "fb1", x: 10, y: 22, player: posPlayer("FB1", "D") };
  const fb2 = { id: "fb2", x: 90, y: 22, player: posPlayer("FB2", "D") };
  const dm = { id: "dm", x: 50, y: 38, player: posPlayer("DM", "M") };
  const defenders = [cb1, cb2, fb1, fb2, dm];
  // Attackers kept well clear of the ball itself, so no defender's own
  // legitimate marking job coincidentally lands near it -- isolating the
  // pure "leftover defenders never default to covering the ball" rule.
  const striker = { id: "striker", x: 50, y: 15, player: posPlayer("STRIKER", "F") };
  const wingerL = { id: "wingerL", x: 10, y: 25, player: posPlayer("WL", "F") };
  const wingerR = { id: "wingerR", x: 90, y: 25, player: posPlayer("WR", "F") };
  const plan = planDefensiveRepositioning(ball, [striker, wingerL, wingerR], defenders, "down", {});
  const pressers = plan.filter((s) => s.action === "press-ball");
  check("exactly one presser", pressers.length === 1);
  const nonPressers = plan.filter((s) => s.action !== "press-ball");
  check("every non-presser defender's own target clears DEFENSIVE_BALL_CLEARANCE_YARDS (10yd) of the ball",
    nonPressers.every((s) => yardDistance(s.intentionTarget, ball) >= 10 - 0.01));
}

console.log("\n=== Off-Ball v2: pair exclusivity -- two CBs never share one striker ===");
{
  const ball = { x: 50, y: 40 };
  const cb1 = { id: "cb1", x: 45, y: 20, player: posPlayer("CB1", "D") };
  const cb2 = { id: "cb2", x: 55, y: 20, player: posPlayer("CB2", "D") };
  const dm = { id: "dm", x: 50, y: 38, player: posPlayer("DM", "M") };
  const defenders = [cb1, cb2, dm];
  const striker = { id: "striker", x: 50, y: 15, player: posPlayer("STRIKER", "F") };
  const plan = planDefensiveRepositioning(ball, [striker], defenders, "down", {});
  const markers = plan.filter((s) => s.subjectId === striker.id);
  check("only one defender is ever assigned to mark the lone striker -- four markers on four different men is legal, four on Weah is not",
    markers.length === 1);
}

console.log("\n=== Off-Ball v2: pair exclusivity ACROSS man-marking and zonal cover (2026-08-26) ===");
{
  // A real reported bug -- two defenders, one man-marking, one "zone-
  // covering," both converging on the same midfielder. Root cause:
  // assignZonalCoverage() picked the nearest attacker in each zonal
  // defender's own strip with no idea buildMarkingAssignments() had
  // already given that SAME attacker to a man-marker just above --
  // the two systems never cross-checked each other. Two midfield-band
  // defenders here: only the first can claim "the ten" via man-marking's
  // own exclusivity; the second must fall back to zonal cover -- and
  // must NOT then zone-cover the very attacker who's already spoken for.
  const ball = { x: 50, y: 40 };
  const cb1 = { id: "cb1", x: 48, y: 20, player: posPlayer("CB1", "D") };
  const cb2 = { id: "cb2", x: 52, y: 20, player: posPlayer("CB2", "D") };
  const dm1 = { id: "dm1", x: 48, y: 42, player: posPlayer("DM1", "M") };
  const dm2 = { id: "dm2", x: 52, y: 42, player: posPlayer("DM2", "M") };
  const defenders = [cb1, cb2, dm1, dm2];
  const ten = { id: "ten", x: 50, y: 45, player: posPlayer("TEN", "M") };
  const striker = { id: "striker", x: 50, y: 15, player: posPlayer("STRIKER", "F") };
  const plan = planDefensiveRepositioning(ball, [ten, striker], defenders, "down", {});
  const markersOnTen = plan.filter((s) => s.subjectId === "ten");
  check("only one defender is ever assigned to 'ten', even when one arrives via man-marking and another would otherwise zone-cover the same strip",
    markersOnTen.length === 1);
  check("the leftover defender screens space instead of doubling up on an already-marked attacker",
    plan.some((s) => s.mode === "zonal" && s.subjectId === null && s.action === "screen"));
}

console.log("\n=== Off-Ball v2: tightness 1 does not follow the striker to the corner flag ===");
{
  const ball = { x: 50, y: 40 };
  const cb1 = { id: "cb1", x: 45, y: 20, player: posPlayer("CB1", "D") };
  const dm = { id: "dm", x: 50, y: 38, player: posPlayer("DM", "M") };
  const other = { id: "other", x: 60, y: 60, player: posPlayer("OTH", "M") };
  const defenders = [cb1, dm, other];
  const strikerNearCorner = { id: "striker", x: 5, y: 5, player: posPlayer("STRIKER", "F") };
  const previousMarking = { cb1: { subjectId: "striker", mode: "man", tightness: 1 } };
  const plan = planDefensiveRepositioning(ball, [strikerNearCorner], defenders, "down", { previousMarking });
  const cb1Step = plan.find((s) => s.id === "cb1");
  check("tightness-1 CB stays sticky-marking the striker (not silently dropped)",
    Boolean(cb1Step) && cb1Step.subjectId === "striker" && cb1Step.mode === "man");
  check("but their own target stays far from the corner flag -- capped by the follow radius, never the ideal goal-side mark itself",
    Boolean(cb1Step) && yardDistance(cb1Step.intentionTarget, strikerNearCorner) > 20);
}

console.log("\n=== Off-Ball v2: tightness 5 follows into the channel; the OTHER CB holds the line ===");
{
  const ball = { x: 60, y: 35 };
  const cb1 = { id: "cb1", x: 45, y: 20, player: posPlayer("CB1", "D") };
  const cb2 = { id: "cb2", x: 55, y: 20, player: posPlayer("CB2", "D") };
  const dm = { id: "dm", x: 60, y: 33, player: posPlayer("DM", "M") };
  const defenders = [cb1, cb2, dm];
  const runner = { id: "runner", x: 75, y: 55, player: posPlayer("RUNNER", "F") };
  const previousMarking = { cb1: { subjectId: "runner", mode: "man", tightness: 5 } };
  const plan = planDefensiveRepositioning(ball, [runner], defenders, "down", { previousMarking });
  const cb1Step = plan.find((s) => s.id === "cb1");
  const cb2Step = plan.find((s) => s.id === "cb2");
  check("tightness-5 CB genuinely follows into the channel -- much closer to the runner than tightness-1 would ever allow",
    Boolean(cb1Step) && yardDistance(cb1Step.intentionTarget, runner) < 10);
  check("the other CB holds the back line instead of also being dragged out",
    Boolean(cb2Step) && (cb2Step.action === "shift-unit" || cb2Step.action === "screen"));
}

console.log("\n=== Off-Ball v2: high Off the Ball beats a tightness-4 check, not automatically tightness-5 ===");
{
  const sharpAttacker = posPlayer("Sharp Mover", "F", { "Off the Ball": 18, Acceleration: 16, Agility: 16, Anticipation: 16 });
  const averageMarker = posPlayer("Marker", "D", { Anticipation: 10, Aggression: 10, Marking: 10 });
  const attacker = { id: "att", x: 50, y: 50, player: sharpAttacker };
  // A decoy teammate, right on the ball -- claims support-short itself
  // (closest to ballPoint) so the marked attacker isn't automatically
  // handed that job as the only remaining candidate. Also marked by their
  // OWN nearby defender, disqualifying THEM from run-in-behind too (a
  // single unmarked decoy would just win that job instead and leave "att"
  // as the sole remaining candidate for support-short right back again).
  const decoy = { id: "decoy", x: 20, y: 40, player: posPlayer("Decoy", "M") };
  const decoyMarker = { id: "decoy-mkr", x: 21, y: 41, player: posPlayer("Decoy Marker", "M") };
  // Each marker sits at roughly the REAL standoff manMarkingPoint() itself
  // would already have placed them at for that tightness bracket (1-2yd
  // for 4, hip-to-hip for 5) -- the same geometry the full pipeline feeds
  // this reaction from, not an arbitrary distance.
  const marker4 = { id: "mkr", x: 50, y: 51.5, player: averageMarker };
  const step4 = planAttackerRepositioning([attacker, decoy], [marker4, decoyMarker], "down", {
    ballPoint: { x: 20, y: 40 },
    markingLookup: { att: { tightness: 4, markerRole: "centreback" } },
  }).find((s) => s.id === "att");
  check("a genuinely sharp attacker's reaction to a tightness-4 marker finds a real check/break, not the old generic diagonal-inside",
    Boolean(step4) && ["check-away", "in-behind", "drop-short"].includes(step4.action));

  const marker5 = { id: "mkr", x: 50, y: 50.7, player: averageMarker };
  const step5 = planAttackerRepositioning([attacker, decoy], [marker5, decoyMarker], "down", {
    ballPoint: { x: 20, y: 40 },
    markingLookup: { att: { tightness: 5, markerRole: "centreback" } },
  }).find((s) => s.id === "att");
  // A tightness-5 marker doesn't automatically WIN either -- the spec's
  // own example is explicit that a poor-Marking tightness-5 CB "still
  // tries to follow and CAN be dropped." What tightness genuinely buys is
  // less room conceded, not an unbeatable wall: the SAME sharp attacker's
  // own real separation from their marker afterward is measurably smaller
  // against hip-to-hip (5) than against a real 1-2yd standoff (4).
  check("the same sharp attacker achieves LESS separation from a hip-to-hip tightness-5 marker than from a tightness-4 one -- tightness genuinely buys ground, even when the attacker still gets a reaction off",
    Boolean(step4) && Boolean(step5)
      && yardDistance(step5.intentionTarget, marker5) < yardDistance(step4.intentionTarget, marker4));
}

console.log("\n=== Off-Ball v2: build-up phase -- a CB in possession gets a real show-to-feet mid, never a mid pinning the last line ===");
{
  const mid1 = { id: "mid1", x: 40, y: 45, player: posPlayer("Mid1", "M") };
  const mid2 = { id: "mid2", x: 60, y: 45, player: posPlayer("Mid2", "M") };
  const fwd = { id: "fwd", x: 50, y: 80, player: posPlayer("Fwd", "F") };
  const plan = planAttackerRepositioning([mid1, mid2, fwd], [], "down", {
    ballPoint: { x: 50, y: 20 },
    ownerBand: "defender",
  });
  const midSteps = plan.filter((s) => s.id === "mid1" || s.id === "mid2");
  check("at least one midfielder shows to feet during build-up",
    midSteps.some((s) => s.action === "show-to-feet"));
  check("no midfielder pins the last line during build-up",
    !midSteps.some((s) => s.action === "pin-last-line"));
}

console.log("\n=== Off-Ball v2: an unreachable check/drop is never offered -- timeToReach beyond the window means they don't meet it ===");
{
  const slowAttacker = posPlayer("Slow Mover", "F", { "Off the Ball": 6, Acceleration: 4, Pace: 4, Agility: 6, Anticipation: 6 });
  const fastMarker = posPlayer("Fast Marker", "D", { Anticipation: 16, Aggression: 14, Marking: 14, Pace: 18, Acceleration: 18 });
  const attacker = { id: "att", x: 50, y: 50, player: slowAttacker };
  const marker = { id: "mkr", x: 50, y: 50.7, player: fastMarker };
  const step = planAttackerRepositioning([attacker], [marker], "down", {
    ballPoint: { x: 50, y: 40 },
    markingLookup: { att: { tightness: 5, markerRole: "centreback" } },
  }).find((s) => s.id === "att");
  check("a slow attacker marked hip-to-hip by a fast defender is never offered check-away/in-behind -- claimable() correctly gates an unreachable destination",
    Boolean(step) && !["check-away", "in-behind"].includes(step.action));
}

console.log("\n=== Attacking-on-the-Ball v2, slices 1+2 (2026-08-25) -- the actual bug fix: build-up keeper distribution ===");
{
  // The reported screenshot's own scenario: a keeper with a genuinely
  // free, close (14.5yd), onside centre-back AND a striker standing alone
  // 108yd away in the opposite half. No settings bag touched beyond the
  // default (possession/directness 2) this function falls back to on its
  // own -- "the team plays simple football by default" is the whole
  // point. Both calls are pure functions (no RNG anywhere in candidate
  // generation), so this is deterministic/seed-stable by construction.
  const keeper = { id: "gk", role: "keeper", x: 50, y: 5, player: AVERAGE };
  const cb = { id: "cb", x: 58, y: 16, player: AVERAGE };
  const nine = { id: "nine", x: 50, y: 95, player: AVERAGE };
  const d1 = { id: "d1", x: 45, y: 97, player: AVERAGE };
  const d2 = { id: "d2", x: 55, y: 98, player: AVERAGE };
  const groups = { owner: keeper, teammates: [cb, nine], opponents: [d1, d2], keeper: null };
  const candidates = generateFreePlayCandidates(groups, "down");
  const bestOf = (types) => Math.max(
    ...candidates.filter((c) => types.includes(c.type)).map((c) => c.utility), -Infinity,
  );
  const simpleBest = bestOf(["throw-short", "release-to-feet"]);
  const ambitiousBest = bestOf(["punt", "throw-long"]);
  check("a short throw or release-to-feet outranks punt/throw-long when a free onside teammate is right there -- the keeper-to-striker default no longer wins",
    Number.isFinite(simpleBest) && simpleBest > ambitiousBest);
  check("the far striker was actually offered as SOME candidate (this isn't just an offside exclusion in disguise)",
    candidates.some((c) => c.target?.id === "nine"));

  console.log("\n=== Offside striker is never a legal punt or throw target ===");
  // Same shape, but the striker now stands well beyond the last defender
  // -- genuinely offside, not just far away.
  const offsideNine = { id: "nine", x: 50, y: 99, player: AVERAGE };
  const nd1 = { id: "d1", x: 45, y: 60, player: AVERAGE };
  const nd2 = { id: "d2", x: 55, y: 62, player: AVERAGE };
  const offsideGroups = { owner: keeper, teammates: [cb, offsideNine], opponents: [nd1, nd2], keeper: null };
  const offsideCandidates = generateFreePlayCandidates(offsideGroups, "down");
  check("an offside striker is never the target of a punt, throw-short, or throw-long",
    !offsideCandidates.some((c) => ["punt", "throw-short", "throw-long"].includes(c.type) && c.target?.id === "nine"));
}

console.log("\n=== Attacking-on-the-Ball v2: distance term keeps costing well past the old 50yd saturation point ===");
{
  // Both owners face the exact SAME fixed target (so progression/
  // resultDistance/resultAngle are identical in both calls, and both
  // clamp their progression term to the same ceiling since both are
  // 30+yd forward) -- isolating the comparison to the distance term
  // itself, the actual thing being fixed. The OLD (d-15)/35 formula
  // saturated at exactly 1.0 by 50yd, so a 55yd and a 90yd ball scored
  // identically on distance alone; the new term keeps differentiating.
  const target = { id: "t", x: 50, y: 100, player: AVERAGE };
  const owner55 = { id: "o55", x: 50, y: 100 - (55 / 120) * 100, player: AVERAGE };
  const owner90 = { id: "o90", x: 50, y: 100 - (90 / 120) * 100, player: AVERAGE };
  check("fixture sanity: the two owners really are ~55yd and ~90yd from the same target",
    Math.abs(yardDistance(owner55, target) - 55) < 0.5 && Math.abs(yardDistance(owner90, target) - 90) < 0.5);
  const u55 = passUtility(owner55, target, [], "down");
  const u90 = passUtility(owner90, target, [], "down");
  check("a 90-yard pass scores strictly worse than a 55-yard one to the same target -- monotonic past the old saturation point",
    u90 < u55);

  // The classic 40-vs-70 comparison the spec names directly.
  const owner40 = { id: "o40", x: 50, y: 100 - (40 / 120) * 100, player: AVERAGE };
  const owner70 = { id: "o70", x: 50, y: 100 - (70 / 120) * 100, player: AVERAGE };
  check("a 70-yard pass scores strictly worse than a 40-yard one to the same target",
    passUtility(owner70, target, [], "down") < passUtility(owner40, target, [], "down"));
}

console.log("\n=== Attacking-on-the-Ball v2: skipped-simple penalty -- a real nearby option makes an ambitious ball a worse choice ===");
{
  const owner = { id: "o", x: 50, y: 50, player: AVERAGE };
  const short = { id: "s", x: 50, y: 60, player: AVERAGE }; // 12yd, free
  const long = { id: "l", x: 50, y: 100, player: AVERAGE }; // 60yd, ambitious
  const simple = hasSimpleOption(owner, [short, long], [], "down", null);
  check("fixture sanity: a genuinely simple option exists (close, unpressured, clear lane, onside)",
    simple === true);
  const possession2 = { attackingSettings: { style: "possession", directness: 2 }, hasSimpleOption: simple, isBuildUp: false };
  check("directness 2, possession: the 60yd ball scores lower than the free 12yd option sitting right there",
    passUtility(owner, long, [], "down", possession2) < passUtility(owner, short, [], "down", possession2));

  // Press the short man hard enough that he no longer qualifies as a
  // genuinely simple option -- at directness 5, long-ball, with every
  // close outlet actually pressed, the long option is allowed to win.
  const closeMarker = { id: "m", x: 50, y: 61, player: AVERAGE };
  const simplePressed = hasSimpleOption(owner, [short, long], [closeMarker], "down", null);
  check("fixture sanity: a marker tight enough on the short man removes it from the simple-option pool",
    simplePressed === false);
  const longBall5 = { attackingSettings: { style: "long-ball", directness: 5 }, hasSimpleOption: simplePressed, isBuildUp: false };
  check("directness 5, long-ball, short man pressed: the long option may now win",
    passUtility(owner, long, [closeMarker], "down", longBall5)
      > passUtility(owner, short, [closeMarker], "down", longBall5));
}

console.log("\n=== Attacking-on-the-Ball v2: style is a bias, never a filter ===");
{
  const owner = { id: "o", role: "player", x: 50, y: 50, player: AVERAGE };
  const short = { id: "s", x: 55, y: 55, player: AVERAGE };
  const groups = { owner, teammates: [short], opponents: [], keeper: null };
  let everyComboKeptThePass = true;
  for (const style of ["possession", "direct", "long-ball", "wing"]) {
    for (let directness = 1; directness <= 5; directness += 1) {
      const candidates = generateFreePlayCandidates(groups, "down", { style, directness });
      if (!candidates.some((c) => c.type === "pass" && c.target?.id === "s")) everyComboKeptThePass = false;
    }
  }
  check("a legal short pass survives every style x directness combination -- style encourages, it never deletes",
    everyComboKeptThePass);

  // Possession/1 specifically must not delete shoot or through -- only
  // rank them lower than a more direct style would.
  const shooter = { id: "o2", role: "player", x: 50, y: 75, player: AVERAGE };
  const shootGroups = { owner: shooter, teammates: [], opponents: [], keeper: null };
  const possession1 = generateFreePlayCandidates(shootGroups, "down", { style: "possession", directness: 1 });
  const direct1 = generateFreePlayCandidates(shootGroups, "down", { style: "direct", directness: 1 });
  const possessionShoot = possession1.find((c) => c.type === "shoot");
  const directShoot = direct1.find((c) => c.type === "shoot");
  check("possession/1 still offers a real shoot candidate from ~30yd, same as direct",
    Boolean(possessionShoot) && Boolean(directShoot));
  check("possession/1 ranks that shot measurably lower than direct does -- a bias, not a deletion",
    possessionShoot.utility < directShoot.utility);
}

console.log("\n=== Box Runs v1 (2026-08-26) -- strikers, the most advanced midfielder, and the opposite winger populate the box ===");
{
  // Mirrors a real reported screenshot: the ball is wide left near the
  // byline, well inside the final third, direction "down" (attacking
  // toward y=100). No defenders placed -- isolates whether these jobs get
  // OFFERED at all from the claimable()/arrival-race question, which
  // run-in-behind's own existing tests already cover.
  const ballPoint = { x: 8, y: 88 };
  const striker = { id: "striker", x: 50, y: 75, player: posPlayer("Striker", "F") };
  const am = { id: "am", x: 45, y: 65, player: posPlayer("AM", "M") };
  const oppositeWinger = { id: "winger", x: 90, y: 70, player: posPlayer("Winger", "F") };
  const holdingMid = { id: "cm", x: 40, y: 45, player: posPlayer("CM", "M") };
  const fullback = { id: "fb", x: 15, y: 60, player: posPlayer("FB", "D") };
  const attackers = [striker, am, oppositeWinger, holdingMid, fullback];
  const plan = planAttackerRepositioning(attackers, [], "down", { ballPoint, keeper: null });

  // Pattern Vocabulary V1, Step 1 (2026-09-02) -- every box-run slot now
  // gets its own real action string (attack-near/attack-spot/attack-far/
  // edge-rebound) instead of the old shared "attack-box" label.
  const BOX_MEET_ACTIONS = new Set(["attack-near", "attack-spot", "attack-far", "edge-rebound"]);
  const forwardJobs = new Set([...BOX_MEET_ACTIONS, "run-in-behind"]);
  check("the striker gets a real forward job (a box meet or run-in-behind), never just standing still",
    forwardJobs.has(plan.find((s) => s.id === "striker")?.action));
  check("the most advanced midfielder gets a real box run (the edge-of-box rebound slot)",
    plan.find((s) => s.id === "am")?.action === "edge-rebound");
  check("the winger on the side AWAY from the ball gets a real box run (crashes the far post, doesn't hold width over there)",
    plan.find((s) => s.id === "winger")?.action === "attack-far");
  check("a deeper holding midfielder, not advanced enough for any role, still just holds position",
    plan.find((s) => s.id === "cm")?.action === "pin-last-line");
  check("a defender-band player never gets a box run, even if otherwise idle",
    !BOX_MEET_ACTIONS.has(plan.find((s) => s.id === "fb")?.action));

  const boxRunTargets = plan.filter((s) => BOX_MEET_ACTIONS.has(s.action)).map((s) => s.intentionTarget);
  check("every box run's own full destination genuinely lands inside the real cross target zone",
    boxRunTargets.length >= 2 && boxRunTargets.every((point) => isCrossTargetZone(point, "down")));

  // Deep in their own half: no box run should ever be offered regardless
  // of role -- populating the box only makes sense once the team is
  // actually threatening it.
  const deepBallPoint = { x: 50, y: 20 };
  const deepPlan = planAttackerRepositioning(attackers, [], "down", { ballPoint: deepBallPoint, keeper: null });
  check("deep in the defending team's own half, nobody gets a box run",
    !deepPlan.some((s) => BOX_MEET_ACTIONS.has(s.action)));
}

console.log("\n=== Pattern Vocabulary V1, Step 1: vacate-pocket (V1) -- a teammate in the carrier's own forward cone clears it ===");
{
  const ballPoint = { x: 50, y: 50 };
  // Marked (excludes them from run-in-behind's own eligibility outright,
  // so this genuinely isolates vacate-pocket -- selectedRunners is empty
  // here, never masking the result the way the combined-cap test below
  // deliberately does).
  const pocket = { id: "pocket", x: 50, y: 56, player: posPlayer("Pocket", "M", { Acceleration: 12, Pace: 12 }) };
  const marker = { id: "pocket-mkr", x: 52, y: 58, player: posPlayer("Marker", "D", { Pace: 8, Acceleration: 8 }) };
  const plan = planAttackerRepositioning([pocket], [marker], "down", { ballPoint, keeper: null });
  const pocketStep = plan.find((s) => s.id === "pocket");
  check("the teammate sitting in the ball's own forward cone vacates it", pocketStep?.action === "vacate-pocket");
  check("the vacate target is a real, measurable push away from their own starting spot",
    Boolean(pocketStep) && yardDistance(pocket, pocketStep.intentionTarget) > 3);
}

console.log("\n=== Pattern Vocabulary V1, Step 1: arc-overlap (V4) -- an unmarked runner in the OPPOSITE channel, blocked centrally but not wide ===");
{
  const ballPoint = { x: 25, y: 50 };
  const overlapper = { id: "overlapper", x: 70, y: 45, player: posPlayer("Overlapper", "D", { Pace: 20, Acceleration: 20, "Off the Ball": 20 }) };
  // Sits almost exactly on overlapper's own forwardRunTarget() (the
  // INWARD-biased point run-in-behind's own claimable() check uses) but
  // nowhere near their genuinely WIDE arcOverlapTarget() -- proves the two
  // jobs read real, distinct geometry, not the same target twice.
  const centralBlocker = { id: "blocker", x: 64.67, y: 53.33, player: posPlayer("Blocker", "D", { Pace: 1, Acceleration: 1 }) };
  const plan = planAttackerRepositioning([overlapper], [centralBlocker], "down", { ballPoint, keeper: null });
  check("blocked centrally, the overlapper is never handed run-in-behind instead",
    plan.find((s) => s.id === "overlapper")?.action !== "run-in-behind");
  check("the opposite-channel runner still gets a real overlapping run",
    plan.find((s) => s.id === "overlapper")?.action === "arc-overlap");
}

console.log("\n=== Pattern Vocabulary V1, Step 1: peel-square (V5) -- a merely-nearby-marked attacker close to the ball peels away ===");
{
  const ballPoint = { x: 50, y: 50 };
  const peeler = { id: "peeler", x: 58, y: 52, player: posPlayer("Peeler", "F", { Pace: 18, Acceleration: 17, Agility: 17, "Off the Ball": 16 }) };
  const marker = { id: "marker", x: 62, y: 56, player: posPlayer("Marker", "D", { Pace: 6, Acceleration: 6 }) };
  const plan = planAttackerRepositioning([peeler], [marker], "down", { ballPoint, keeper: null });
  check("a nearby-marked attacker close to the ball peels square instead of the old generic diagonal-inside",
    plan.find((s) => s.id === "peeler")?.action === "peel-square");

  // The SAME picture, but the marker is now a FORMALLY tracked tight (4+)
  // mark -- tightMarkReactionTarget()'s own, more specific answer owns this
  // picture instead; peel-square must never compete with a real marking
  // assignment. (A single isolated teammate always claims support-short
  // ahead of the marked-reaction branch regardless -- see the existing
  // "Off the Ball beats a tightness-4 check" test for that separate,
  // already-covered assertion; what's new and load-bearing here is simply
  // that peel-square/check-decel never fire once formally tight-marked.)
  const tightPlan = planAttackerRepositioning([peeler], [marker], "down", {
    ballPoint, keeper: null, markingLookup: { peeler: { tightness: 4, markerRole: "centreback" } },
  });
  check("a FORMALLY tight-marked attacker is never swept into peel-square or check-decel",
    !["peel-square", "check-decel"].includes(tightPlan.find((s) => s.id === "peeler")?.action));
}

console.log("\n=== Pattern Vocabulary V1, Step 1: show-wide (V7) -- a clogged inside lane makes the wide teammate the valve ===");
{
  const ballPoint = { x: 50, y: 50 };
  const wide = { id: "wide", x: 5, y: 20, player: posPlayer("Wide", "F", { Pace: 12 }) };
  const wideMarker = { id: "wide-mkr", x: 6, y: 21, player: posPlayer("Wide Marker", "D", {}) };
  const clogger = { id: "clog", x: 50, y: 56, player: posPlayer("Clogger", "D", {}) };
  const plan = planAttackerRepositioning([wide], [wideMarker, clogger], "down", { ballPoint, keeper: null });
  check("a marked, far-off wide teammate is not swept into peel-square just for being marked",
    plan.find((s) => s.id === "wide")?.action !== "peel-square");
  check("with the inside lane genuinely clogged, the wide teammate becomes the pressure valve",
    plan.find((s) => s.id === "wide")?.action === "show-wide");

  // Same wide teammate, but the inside lane is genuinely open this time --
  // show-wide must not fire just because someone happens to be wide.
  const openPlan = planAttackerRepositioning([wide], [wideMarker], "down", { ballPoint, keeper: null });
  check("an open inside lane never manufactures a show-wide job", openPlan.find((s) => s.id === "wide")?.action !== "show-wide");
}

console.log("\n=== Pattern Vocabulary V1, Step 1: check-decel (V7) -- a marked attacker far from the ball still gets a real pocket run ===");
{
  const ballPoint = { x: 50, y: 10 };
  const decelSharp = posPlayer("Decel Sharp", "F", { "Off the Ball": 17, Anticipation: 16, Acceleration: 16, Agility: 16 });
  const decel = { id: "decel", x: 50, y: 60, player: decelSharp };
  const marker = { id: "decel-mkr", x: 51, y: 61, player: posPlayer("Decel Marker", "D", { Pace: 8, Acceleration: 8, Anticipation: 8 }) };
  const plan = planAttackerRepositioning([decel], [marker], "down", { ballPoint, keeper: null });
  check("too far from the ball for peel-square, a marked attacker still gets a real dart into space",
    plan.find((s) => s.id === "decel")?.action === "check-decel");
}

console.log("\n=== Pattern Vocabulary V1, Step 1: combined \"1 special run\" cap (L3) -- run-in-behind already spent it, nobody else gets a second one ===");
{
  const ballPoint = { x: 50, y: 50 };
  const runner = { id: "runner", x: 70, y: 70, player: posPlayer("Runner", "F", { "Off the Ball": 18, Anticipation: 17, Acceleration: 17, Decisions: 17 }) };
  const pocket = { id: "pocket", x: 50, y: 56, player: posPlayer("Pocket", "M", { Acceleration: 10, Pace: 10 }) };
  // Identical fixture to the vacate-pocket test above -- the ONLY
  // difference the cap itself should ever explain is whether run-in-behind
  // already claimed this call's one allowed special mover elsewhere.
  const capPlan = planAttackerRepositioning([runner, pocket], [], "down", { ballPoint, keeper: null });
  check("run-in-behind still wins its own slot", capPlan.find((s) => s.id === "runner")?.action === "run-in-behind");
  check("with the cap already spent, the pocket teammate is never ALSO handed a special-mover job",
    capPlan.find((s) => s.id === "pocket")?.action !== "vacate-pocket");
}

console.log("\n=== Pattern Vocabulary V1, Step 1: box-meet slots stay capped even when a special mover is also live ===");
{
  // Reuses the existing Box Runs v1 fixture geometry (final third, wide
  // left) with an ADDITIONAL teammate sitting in the ball's own forward
  // cone -- confirms the two mechanisms (box meets + the new special-mover
  // cap) coexist without either silently swallowing the other's slot.
  const ballPoint = { x: 8, y: 88 };
  const striker = { id: "striker", x: 50, y: 75, player: posPlayer("Striker", "F") };
  const am = { id: "am", x: 45, y: 65, player: posPlayer("AM", "M") };
  const oppositeWinger = { id: "winger", x: 90, y: 70, player: posPlayer("Winger", "F") };
  const pocket = { id: "pocket", x: 8, y: 91, player: posPlayer("Pocket", "M", { Acceleration: 8, Pace: 8 }) };
  const attackers = [striker, am, oppositeWinger, pocket];
  const plan = planAttackerRepositioning(attackers, [], "down", { ballPoint, keeper: null });
  const BOX_MEET_ACTIONS = new Set(["attack-near", "attack-spot", "attack-far", "edge-rebound"]);
  const boxMeetCount = attackers.filter((a) => BOX_MEET_ACTIONS.has(plan.find((s) => s.id === a.id)?.action)).length;
  check("box meets still populate normally alongside a live special mover", boxMeetCount >= 2);
}

console.log("\n=== Pattern Vocabulary V1, Step 1: planDefensiveRepositioning() -- delay vs press-ball is a real distance split ===");
{
  const ballOwnerPoint = { x: 50, y: 50 };
  const closePresser = { id: "close", x: 51, y: 51, player: posPlayer("Close", "D") };
  const closePlan = planDefensiveRepositioning(ballOwnerPoint, [], [closePresser], "down");
  check("a presser already within real challenge range still presses the ball",
    closePlan.find((s) => s.id === "close")?.action === "press-ball");

  const farPresser = { id: "far", x: 60, y: 62, player: posPlayer("Far", "D") };
  check("sanity: this presser really is farther than DUEL_RANGE_YARDS away",
    yardDistance(ballOwnerPoint, farPresser) > DUEL_RANGE_YARDS);
  const farPlan = planDefensiveRepositioning(ballOwnerPoint, [], [farPresser], "down");
  check("still closing from outside real challenge range reads as delay, not press-ball",
    farPlan.find((s) => s.id === "far")?.action === "delay");
  check("delay is still a genuine 'go get this ball' target -- same pressingTarget() geometry as press-ball, just labeled by distance",
    Boolean(farPlan.find((s) => s.id === "far")?.intentionTarget));
}

console.log("\n=== Bugfix slice: determineCarryGait() relaxes the full-sprint floor on a genuinely empty pitch ===");
{
  const openCarrier = { x: 50, y: 50, player: SHARP };
  // Real hasOpponentAhead()/laneObstruction() geometry is irrelevant here --
  // zero opponents means `ahead` is vacuously false regardless -- so
  // `stamina01` alone decides every one of these.
  check("burst below even the relaxed empty-pitch floor (0.20) still denies full-sprint, empty pitch or not",
    determineCarryGait(openCarrier, [], "down", 0.15) !== "full-sprint");
  check("burst at 0.25 -- above the relaxed empty-pitch floor but below the old 0.35 -- now legally sprints when nobody is left to contest it",
    determineCarryGait(openCarrier, [], "down", 0.25) === "full-sprint");
  check("the exact reported trace's own burst reading (0.34) is legal full-sprint on a genuinely empty pitch",
    determineCarryGait(openCarrier, [], "down", 0.34) === "full-sprint");

  // The SAME 0.25 burst reading, but with a real opponent ahead -- the old,
  // stricter 0.35 floor must still apply unchanged; this fix only ever
  // relaxes the empty-pitch case, never a genuinely contested one.
  const aheadOpponent = { x: 50, y: 60, player: AVERAGE };
  check("the SAME burst (0.25) is still correctly denied full-sprint once a real opponent is ahead -- the contested floor (0.35) is untouched",
    determineCarryGait(openCarrier, [aheadOpponent], "down", 0.25) !== "full-sprint");
}

console.log("\n=== Bugfix slice: passUtility() penalizes a pass target crowded by another teammate ===");
{
  const owner = { id: "clutter-owner", x: 50, y: 50, player: SHARP };
  const openTarget = { id: "open", x: 50, y: 65, player: AVERAGE };
  const crowdedTarget = { id: "crowded", x: 30, y: 65, player: AVERAGE };
  const crowder = { id: "crowder", x: 31, y: 66, player: AVERAGE };
  const teammates = [owner, openTarget, crowdedTarget, crowder];
  const openUtility = passUtility(owner, openTarget, [], "down", { teammates });
  const crowdedUtility = passUtility(owner, crowdedTarget, [], "down", { teammates });
  check("an identical-distance pass into a crowded spot scores measurably lower than one into open space",
    crowdedUtility < openUtility - 0.5);

  const withoutContext = passUtility(owner, crowdedTarget, [], "down", {});
  check("omitting context.teammates entirely reproduces the exact old (uncrowded) behavior -- purely additive",
    withoutContext > crowdedUtility);
  check("the receiving teammate is never penalized for occupying their OWN target",
    passUtility(owner, openTarget, [], "down", { teammates: [owner, openTarget] }) === openUtility);
}

console.log("\n=== Bugfix: wide-angle 'calm' shot -- a box-corner/byline attempt is never a legal, calmly-taken shot ===");
{
  // Real reported picture: owner on the corner of the box / byline, a
  // covering defender holding the lane (outside DUEL_RANGE_YARDS, so
  // pressure reads near-zero), two free infield teammates, nobody in the
  // six. attacking "down" -- own goal at y=100%/120yd.
  const wideOwner = { id: "wide", x: 79, y: 85, player: SHARP };
  check("sanity: this really is a tight angle, well past the wide-angle threshold",
    shotAngleTightness(wideOwner, "down") > 0.65);
  check("sanity: this is genuinely deep -- well past the near-post-slash byline allowance (7.3m)",
    Math.abs(toYardPoint(wideOwner).y - PITCH_LENGTH_YARDS) > 8);
  check("canAttemptShot() structurally refuses a hopeless box-corner angle, even well under the ordinary 32m distance cap",
    !canAttemptShot(wideOwner, "down"));

  const teammateA = { id: "infield-a", x: 45, y: 78, player: AVERAGE };
  const teammateB = { id: "infield-b", x: 55, y: 75, player: AVERAGE };
  const groups = { owner: wideOwner, teammates: [teammateA, teammateB], opponents: [], keeper: null };
  const candidates = generateFreePlayCandidates(groups, "down");
  check("shoot never even appears as a candidate from this picture", !candidates.some((c) => c.type === "shoot"));
  const decision = chooseCandidate(candidates, wideOwner.player, makeRandom(101));
  check("chooseCandidate() is NOT shoot", decision?.type !== "shoot");

  // A genuine close-range near-post slash (inside the six, same tight
  // angle) must stay LEGAL -- this fix only removes a hopeless, far
  // wide-angle attempt, never a real one.
  const nearPostOwner = { id: "near-post", x: 79, y: 96, player: SHARP };
  check("sanity: still a tight angle", shotAngleTightness(nearPostOwner, "down") > 0.65);
  check("sanity: genuinely inside the 7.3m close-range allowance", Math.abs(toYardPoint(nearPostOwner).y - PITCH_LENGTH_YARDS) <= 8);
  check("a real near-post slash from inside the six stays a legal shot even at a tight angle",
    canAttemptShot(nearPostOwner, "down"));

  // The existing central 20m finish (already covered by "Monotonic:
  // shot utility" above) must stay fully legal -- a real regression guard.
  const centralOwner = { id: "central", x: 50, y: 82, player: SHARP };
  check("a genuine central 20m finish is still a legal, offered shot candidate",
    canAttemptShot(centralOwner, "down")
      && generateFreePlayCandidates({ owner: centralOwner, teammates: [], opponents: [], keeper: null }, "down")
        .some((c) => c.type === "shoot"));
}

console.log("\n=== Bugfix: shootUtility() treats a tight angle as a real cost, not a shrinking bonus ===");
{
  // Legal but tight (angle just under the hard cutoff) -- shootUtility's
  // own cost term must still meaningfully suppress it relative to a
  // central shot at the same real distance, never merely shrink toward a
  // smaller-but-still-positive bonus.
  const central = { x: 50, y: 90 };
  const tightButLegal = { x: 68, y: 90 };
  check("sanity: tightButLegal is a real, meaningfully tighter angle than central",
    shotAngleTightness(tightButLegal, "down") > shotAngleTightness(central, "down") + 0.2);
  check("a tighter angle costs real utility relative to central, at the identical distance-from-goal-line",
    shootUtility(tightButLegal, [], null, "down") < shootUtility(central, [], null, "down") - 0.5);

  // An empty shooting lane (nobody stands on the near-touchline ray) no
  // longer buys a wide-angle attempt a free bonus for the wrong reason.
  const veryWide = { x: 78, y: 92 };
  check("sanity: an empty pitch really does leave the ray to goal-center empty",
    shootingLaneOpenness(veryWide, [], "down") > 0.9);
  check("a hopeless-angle attempt scores negatively even with a totally empty lane",
    shootUtility(veryWide, [], null, "down") < 0);
}

console.log("\n=== Bugfix: selectFinishType() -- CALM requires a real, playable angle ===");
{
  const composed = player("Composed Finisher", { Composure: 18, Technique: 16, Finishing: 17, Flair: 8 });
  let sawCalmAtGoodAngle = false;
  let sawCalmAtTightAngle = false;
  for (let i = 0; i < 300; i += 1) {
    if (selectFinishType(composed, makeRandom(i + 1), 0.1, 0.1) === "calm") sawCalmAtGoodAngle = true;
    if (selectFinishType(composed, makeRandom(i + 10000), 0.1, 0.8) === "calm") sawCalmAtTightAngle = true;
  }
  check("a composed finisher at a genuinely good angle does pick calm at least sometimes", sawCalmAtGoodAngle);
  check("the SAME composed finisher at a genuinely tight angle NEVER picks calm -- structurally unavailable, not just disfavored",
    !sawCalmAtTightAngle);
  check("omitting angleTightness entirely reproduces the exact old (angle-blind) behavior",
    ["calm", "blast", "finesse"].includes(selectFinishType(composed, makeRandom(42), 0.1)));
}

console.log("\n=== Team defaults, player overrides, and goalkeeper-specific tactics ===");
{
  const owner = {
    id: "instruction-owner", role: "player", team: "home", x: 50, y: 75,
    player: player("Instruction Owner", { Shooting: 16, "Long Shots": 16, Technique: 16, Composure: 16 }),
    shootingInstruction: "inherit", tempoInstruction: "inherit",
  };
  check("an inherited shooting instruction resolves from the team plan",
    shootingInstructionFor(owner, { shooting: "encourage" }) === "encourage");
  check("an explicit player shooting instruction replaces the team plan",
    shootingInstructionFor({ ...owner, shootingInstruction: "discourage" }, { shooting: "encourage" }) === "discourage");
  const teammate = { id: "support", role: "player", team: "home", x: 55, y: 70, player: AVERAGE };
  const quick = generateFreePlayCandidates(
    { owner, teammates: [teammate], opponents: [], keeper: null }, "down",
    { style: "possession", directness: 2, shooting: "balanced", tempo: "quick" },
  );
  const slow = generateFreePlayCandidates(
    { owner, teammates: [teammate], opponents: [], keeper: null }, "down",
    { style: "possession", directness: 2, shooting: "balanced", tempo: "slow" },
  );
  check("quick tempo lowers the relative value of holding the ball",
    quick.find((item) => item.type === "hold").utility
      < slow.find((item) => item.type === "hold").utility);

  const keeper = {
    id: "keeper", role: "keeper", team: "home", x: 50, y: 5,
    player: player("Keeper", { Passing: 14, Technique: 14, Decisions: 14 }),
  };
  const outlets = [
    { id: "short", role: "player", team: "home", x: 50, y: 15, player: AVERAGE },
    { id: "long", role: "player", team: "home", x: 50, y: 55, player: AVERAGE },
  ];
  const shortPlan = keeperDistributionCandidates(
    { ...keeper, goalkeeperDistribution: "short" }, outlets, [], "down",
  );
  const longPlan = keeperDistributionCandidates(
    { ...keeper, goalkeeperDistribution: "long" }, outlets, [], "down",
  );
  check("short goalkeeper distribution raises a short release relative to the same long instruction",
    shortPlan.find((item) => item.type === "release-to-feet").utility
      > longPlan.find((item) => item.type === "release-to-feet").utility);
  check("long goalkeeper distribution raises the punt relative to the same short instruction",
    longPlan.find((item) => item.type === "punt").utility
      > shortPlan.find((item) => item.type === "punt").utility);
}

console.log("\n=== Team instructions change legal player choices without changing availability ===");
{
  const owner = { id: "ti-owner", x: 50, y: 50, positionalSlot: "MC" };
  const base = [
    { type: "pass", target: { id: "left", x: 75, y: 58 }, moveTo: null, utility: 1 },
    { type: "pass", target: { id: "right", x: 25, y: 58 }, moveTo: null, utility: 1 },
    { type: "through", target: { id: "runner", x: 50, y: 76 }, moveTo: { x: 50, y: 82 }, utility: 1 },
    { type: "dribble", target: null, moveTo: { x: 52, y: 62 }, utility: 1 },
    { type: "shoot", target: null, moveTo: null, utility: 1 },
    { type: "hold", target: null, moveTo: null, utility: 1 },
  ];
  const adjusted = (settings) => applyTeamInstructionBiases(
    base.map((candidate) => ({ ...candidate })), owner, "down", settings,
  );
  const left = adjusted({ focusPlay: "left" });
  check("focus left follows the team's perspective when it attacks down",
    left[0].utility > left[1].utility);
  const space = adjusted({ passIntoSpace: true });
  check("pass into space raises the through-ball candidate",
    space.find((candidate) => candidate.type === "through").utility > 1);
  const dribbleMore = adjusted({ dribbling: "more" });
  const dribbleLess = adjusted({ dribbling: "less" });
  check("run at defence makes the same legal dribble more attractive",
    dribbleMore.find((candidate) => candidate.type === "dribble").utility
      > dribbleLess.find((candidate) => candidate.type === "dribble").utility);
  const sight = adjusted({ finalThird: "shoot-on-sight" });
  const work = adjusted({ finalThird: "work-ball" });
  check("shoot on sight and work ball into box pull shot choice in opposite directions",
    sight.find((candidate) => candidate.type === "shoot").utility
      > work.find((candidate) => candidate.type === "shoot").utility);
  check("instructions never add, remove or reorder legal candidates",
    adjusted({ mentality: "attacking", creativity: "expressive" })
      .map((candidate) => candidate.type).join(",") === base.map((candidate) => candidate.type).join(","));
  check("stay on feet converts a feasible slide to a standing tackle",
    applyTacklingInstruction("D.SLIDE", "stay-on-feet", { canStand: true, canSlide: true }) === "D.STAND");
  check("get stuck in selects a feasible sliding tackle",
    applyTacklingInstruction("D.DUEL", "get-stuck-in", { canStand: true, canSlide: true }) === "D.SLIDE");
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
