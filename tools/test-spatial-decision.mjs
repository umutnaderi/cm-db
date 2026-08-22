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
  carryUtility, classifyOutfieldBand, coveringPositionPoint, crossUtility, determineCarryGait, distanceToGoalYards, dribbleUtility, DUEL_RANGE_YARDS, engagingOpponent,
  decisionOptionMetrics, findSpaceTarget, findSpaceTargetForAttack, forwardRunTarget, generateFreePlayCandidates, holdUtility, isCrossTargetZone, laneObstruction, nearestLaneInterceptor,
  passUtility, PITCH_LENGTH_YARDS, PITCH_WIDTH_YARDS, planAttackerRepositioning, planCarryDestination,
  planCarryTouches, planDefensiveRepositioning, PRESSURE_RADIUS_YARDS, pressingTarget, pressureAt, screeningPositionPoint,
  selectionSharpness, shootUtility, shootingLaneOpenness, SLIDING_TACKLE_RANGE_YARDS,
  STANDING_TACKLE_RANGE_YARDS, throughBallUtility, toYardPoint, yardDistance,
} from "../src/lib/spatialDecision.js";

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

console.log("\n=== Touches Per Carry: determineCarryGait -- nimble under pressure, sprint in open space ===");
{
  const carrier = { x: 50, y: 50 };
  const rightOnTopOfThem = [{ x: 51, y: 51 }];
  check("real pressure right on top of the carrier reads as nimble", determineCarryGait(carrier, rightOnTopOfThem) === "nimble");

  const distantButAware = [{ x: 50, y: 65 }]; // ~15.75yd away -- within AWARENESS_RADIUS_YARDS(25), outside PRESSURE_RADIUS_YARDS(9)
  check("someone aware-but-not-pressuring reads as jog", determineCarryGait(carrier, distantButAware) === "jog");

  const genuinelyAlone = [];
  check("nobody within awareness range at all reads as sprint", determineCarryGait(carrier, genuinelyAlone) === "sprint");

  const farAway = [{ x: 50, y: 95 }]; // well beyond AWARENESS_RADIUS_YARDS
  check("an opponent far beyond awareness range also reads as sprint", determineCarryGait(carrier, farAway) === "sprint");
}

console.log("\n=== Touches Per Carry: planCarryTouches -- real spacing, never reaching the destination itself ===");
{
  const from = { x: 50, y: 50 };
  const to = { x: 50, y: 60 }; // 12 real yards at this x (10% of 120yd)
  const nimbleTouches = planCarryTouches(from, to, "nimble");
  const sprintTouches = planCarryTouches(from, to, "sprint");
  check("a real distance produces at least one intermediate touch at nimble spacing", nimbleTouches.length > 0);
  check("the same distance produces fewer intermediate touches at sprint spacing than at nimble spacing",
    sprintTouches.length < nimbleTouches.length);
  check("every intermediate waypoint stays strictly between from and to (never reaching the destination itself)",
    nimbleTouches.every((point) => point.y > from.y && point.y < to.y));
  check("waypoints progress monotonically from origin toward destination, not scattered",
    nimbleTouches.every((point, index) => index === 0 || point.y > nimbleTouches[index - 1].y));

  const veryShort = { x: 50, y: 50.3 }; // well under one gait interval at any spacing
  check("a carry shorter than one gait interval produces zero intermediate touches -- the previous single-touch behavior, not a regression",
    planCarryTouches(from, veryShort, "sprint").length === 0);

  // Deterministic -- no RNG parameter at all, identical inputs always
  // produce an identical result.
  const again = planCarryTouches(from, to, "nimble");
  check("identical inputs reproduce identical waypoints (no hidden randomness)",
    JSON.stringify(nimbleTouches) === JSON.stringify(again));

  const lowControl = player("Low control", { Dribbling: 3, Technique: 3 });
  const highControl = player("High control", { Dribbling: 19, Technique: 19 });
  const lowTouches = planCarryTouches(from, to, "jog", {
    player: lowControl, pressure: 0.6, seed: "attribute-touch-test",
  });
  const highTouches = planCarryTouches(from, to, "jog", {
    player: highControl, pressure: 0.6, seed: "attribute-touch-test",
  });
  check("higher Dribbling produces more frequent, tighter contacts over the identical tactical path",
    highTouches.length > lowTouches.length);
  check("higher Dribbling + Technique records a smaller touch-error envelope",
    highTouches[0].kinetics.attribution.find((item) => item.quantity === "touchErrorEnvelope").actual
      < lowTouches[0].kinetics.attribution.find((item) => item.quantity === "touchErrorEnvelope").actual);
  const segments = nimbleTouches.map((point, index) => yardDistance(index ? nimbleTouches[index - 1] : from, point));
  check("touch spacing is deterministic but non-uniform rather than metronomic",
    new Set(segments.map((value) => value.toFixed(3))).size > 1);
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

console.log("\n=== Off-Ball Defender Awareness v1: planDefensiveRepositioning -- press/cover roles + multi-defender coordination ===");
{
  const ball = { x: 50, y: 50 };
  const attackingTeammate = { id: "teammate", x: 60, y: 55 };
  const nearDefender = { id: "near", x: 51, y: 51 };
  const farDefender = { id: "far", x: 30, y: 40 };

  check("no defenders placed at all returns an empty plan", planDefensiveRepositioning(ball, [attackingTeammate], [], "down").length === 0);

  const withTeammate = planDefensiveRepositioning(ball, [attackingTeammate], [nearDefender, farDefender], "down");
  const presser = withTeammate.find((step) => step.id === "near");
  const coverer = withTeammate.find((step) => step.id === "far");
  check("the NEAREST defender to the ball exclusively claims press-ball", Boolean(presser) && presser.action === "press-ball");
  check("the other defender is assigned to cover the attacking teammate, not also press", Boolean(coverer) && coverer.action === "cover");

  const lonely = planDefensiveRepositioning(ball, [], [nearDefender, farDefender], "down");
  check("with no attacking teammates, exactly one defender presses while the other protects shape",
    lonely.filter((step) => step.action === "press-ball").length === 1
      && lonely.some((step) => step.action === "cover"));

  const receiverB = { id: "receiver-b", x: 35, y: 62 };
  const thirdDefender = { id: "third", x: 65, y: 44 };
  const coordinated = planDefensiveRepositioning(
    ball, [attackingTeammate, receiverB], [nearDefender, farDefender, thirdDefender], "down",
  );
  const screen = coordinated.find((step) => step.action === "screen-lane");
  check("a third defender is assigned to screen a specific receiver lane instead of joining the press",
    Boolean(screen?.subjectId));
  if (screen) {
    const receiver = [attackingTeammate, receiverB].find((entry) => entry.id === screen.subjectId);
    const idealScreen = screeningPositionPoint(ball, receiver);
    check("the screen intention lies on the carrier-to-receiver lane",
      yardDistance(screen.intentionTarget, idealScreen) < 0.01);
  }

  // Determinism -- no RNG parameter at all.
  const again = planDefensiveRepositioning(ball, [attackingTeammate], [nearDefender, farDefender], "down");
  check("identical inputs reproduce an identical plan", JSON.stringify(withTeammate) === JSON.stringify(again));
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
  const teammate = { id: "target", role: "player", x: 42, y: 72, player: AVERAGE };
  const keeperOwner = { id: "keeper-owner", role: "keeper", x: 50, y: 95, player: SHARP };
  const keeperCandidates = generateFreePlayCandidates({
    owner: keeperOwner, teammates: [teammate], opponents: [], keeper: null,
  }, "up");
  check("a goalkeeper in possession receives distribution candidates",
    keeperCandidates.some((candidate) => candidate.type === "pass"));
  check("a goalkeeper never receives generic shoot, carry, dribble, or cross candidates",
    keeperCandidates.every((candidate) => candidate.type === "pass"));

  const outfieldOwner = { id: "outfield-owner", role: "player", x: 50, y: 50, player: SHARP };
  const malformedKeeperOpponent = { id: "misgrouped-gk", role: "keeper", x: 51, y: 51, player: AVERAGE };
  const guardedCandidates = generateFreePlayCandidates({
    owner: outfieldOwner, teammates: [], opponents: [malformedKeeperOpponent], keeper: malformedKeeperOpponent,
  }, "down");
  check("even malformed input cannot turn a goalkeeper into a generic dribble/duel target",
    !guardedCandidates.some((candidate) => candidate.type === "dribble" || candidate.target?.id === malformedKeeperOpponent.id));

  const ordinaryFar = { id: "ordinary-far", role: "player", x: 50, y: 22, player: AVERAGE };
  const eliteFar = {
    id: "elite-far", role: "player", x: 50, y: 55,
    player: player("Long-shot specialist", { "Long Shots": 18, Shooting: 18, Technique: 17 }),
  };
  check("an ordinary player cannot choose a speculative shot from their own half",
    !canAttemptShot(ordinaryFar, "down"));
  check("a qualified long-shot specialist may shoot from ambitious but plausible range",
    canAttemptShot(eliteFar, "down"));
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

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
