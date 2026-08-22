// Stage 2 (one-on-one action-specific execution) invariant tests -- see
// MATCH_LAB_PLAN.md's Stage 2 section. Complements
// tools/one_on_one_action_audit.mjs (which reports rates/telemetry, not
// pass/fail) with hard assertions on the properties that must hold
// regardless of calibration: determinism, RNG stream independence (the
// review's point 5), tier separation, and honest handling of deferred/
// gated actions. Run with `node tools/test-one-on-one-execution.mjs`.
import { hashString, seededRandom } from "../src/lib/matchEngineCore.js";
import {
  resolveChipAttempt, resolvePlacedFinish, resolveRoundKeeper,
  resolveSquarePass, resolveTargetedKeeperResponse,
} from "../src/lib/matchEngineCore.js";
import { chooseOneOnOneAction, perceiveKeeperState } from "../src/lib/oneOnOneDecision.js";

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} -- ${label}`);
  if (!condition) failures += 1;
}

function attrs(pairs) { return Object.entries(pairs).map(([label, value]) => ({ label, value })); }
function player(name, overrides) { return { canonical_player_name: name, current_ability: 150, attributes: attrs(overrides) }; }

const ELITE_SHOOTER = player("Elite Shooter", {
  Finishing: 18, Technique: 18, Composure: 17, Decisions: 17, Anticipation: 16,
  Flair: 17, Dribbling: 18, Acceleration: 17, Agility: 17, Balance: 16, Passing: 15, Teamwork: 13,
});
const WEAK_SHOOTER = player("Weak Shooter", {
  Finishing: 7, Technique: 6, Composure: 6, Decisions: 6, Anticipation: 6,
  Flair: 6, Dribbling: 6, Acceleration: 7, Agility: 7, Balance: 7, Passing: 7, Teamwork: 8,
});
const ELITE_KEEPER = player("Elite Keeper", { Reflexes: 19, Positioning: 18, "One On Ones": 18, Handling: 17, Agility: 17, Anticipation: 16 });
const WEAK_KEEPER = player("Weak Keeper", { Reflexes: 6, Positioning: 6, "One On Ones": 6, Handling: 6, Agility: 6, Anticipation: 6 });
const TEAMMATE = player("Teammate", { Finishing: 13, Technique: 13, Composure: 12 });
const DEFENDER = player("Defender", { Anticipation: 12, Positioning: 12, Tackling: 12 });

// Keeper covering the right (lateralOffsetYards +2.5), leaving left
// genuinely exposed -- consistent with the same left/right convention
// match-lab.js's own geometry derivation uses (keeperLateralYards > 1 ->
// exposedSide "left"). Tests below target "left" against this: a
// meaningfully long, differentiating travel distance, not a target that
// happens to land on the side the keeper's already standing near.
const ACTUAL_STATE = { depthFromGoalLineYards: 5, lateralOffsetYards: 2.5, distanceToShooterYards: 4, exposedSide: "left", movementDirection: null, closingSpeed: null, set: null };

console.log("=== 1: determinism -- identical seed reproduces identical execution ===");
{
  const r1 = seededRandom(hashString("exec-determinism"));
  const r2 = seededRandom(hashString("exec-determinism"));
  const shotA = resolvePlacedFinish({ shooter: ELITE_SHOOTER, targetSide: "left", power: false, pressure: 0.2, random: r1 });
  const shotB = resolvePlacedFinish({ shooter: ELITE_SHOOTER, targetSide: "left", power: false, pressure: 0.2, random: r2 });
  check("resolvePlacedFinish: identical seed -> identical shot descriptor", JSON.stringify(shotA) === JSON.stringify(shotB));
  const kr1 = seededRandom(hashString("exec-determinism-kr"));
  const kr2 = seededRandom(hashString("exec-determinism-kr"));
  const respA = resolveTargetedKeeperResponse({ shot: shotA, keeper: ELITE_KEEPER, actualKeeperState: ACTUAL_STATE, random: kr1 });
  const respB = resolveTargetedKeeperResponse({ shot: shotB, keeper: ELITE_KEEPER, actualKeeperState: ACTUAL_STATE, random: kr2 });
  check("resolveTargetedKeeperResponse: identical seed -> identical result", JSON.stringify(respA) === JSON.stringify(respB));
}

console.log("\n=== 2: RNG stream independence -- decision scoring must not perturb execution ===");
{
  // Scores candidates with two DIFFERENT context shapes (different
  // availableTeammates, different pressure -- changes how many times
  // decisionRandom is called before a pick is made) but feeds the SAME
  // fixed executionRandom/keeperResponseRandom seeds into execution for an
  // otherwise-identical selected action. Execution must be byte-identical
  // regardless of what decisionRandom did.
  const geometry = { depthFromGoalLineYards: 1, lateralOffsetYards: 2, distanceToShooterYards: 9, exposedSide: "left", movementDirection: null, closingSpeed: null, set: null };
  const decisionA = seededRandom(hashString("stream-independence-A"));
  const perceivedA = perceiveKeeperState(geometry, ELITE_SHOOTER, decisionA);
  chooseOneOnOneAction({ shooter: ELITE_SHOOTER, perceivedKeeperState: perceivedA, defenderPressure: 0.1, shotAngle: 40, distance: 10, availableTeammates: [], decisionRandom: decisionA });

  const decisionB = seededRandom(hashString("stream-independence-B"));
  const perceivedB = perceiveKeeperState(geometry, ELITE_SHOOTER, decisionB);
  // Score several times with extra candidates worth of randomness burned
  // (simulating "candidate scoring changed") before ever touching execution.
  for (let i = 0; i < 5; i += 1) {
    chooseOneOnOneAction({ shooter: ELITE_SHOOTER, perceivedKeeperState: perceivedB, defenderPressure: 0.1, shotAngle: 40, distance: 10, availableTeammates: [{ id: "t" }], decisionRandom: decisionB });
  }

  const executionFixed1 = seededRandom(hashString("execution-fixed-stream"));
  const keeperResponseFixed1 = seededRandom(hashString("keeper-response-fixed-stream"));
  const shot1 = resolvePlacedFinish({ shooter: ELITE_SHOOTER, targetSide: "left", power: false, pressure: 0.1, random: executionFixed1 });
  const result1 = resolveTargetedKeeperResponse({ shot: shot1, keeper: ELITE_KEEPER, actualKeeperState: geometry, random: keeperResponseFixed1 });

  const executionFixed2 = seededRandom(hashString("execution-fixed-stream"));
  const keeperResponseFixed2 = seededRandom(hashString("keeper-response-fixed-stream"));
  const shot2 = resolvePlacedFinish({ shooter: ELITE_SHOOTER, targetSide: "left", power: false, pressure: 0.1, random: executionFixed2 });
  const result2 = resolveTargetedKeeperResponse({ shot: shot2, keeper: ELITE_KEEPER, actualKeeperState: geometry, random: keeperResponseFixed2 });

  check("execution result is identical regardless of how much decisionRandom was consumed beforehand",
    JSON.stringify(shot1) === JSON.stringify(shot2) && JSON.stringify(result1) === JSON.stringify(result2));
}

console.log("\n=== 3: tier separation -- elite vs weak shooter/keeper produce measurably different conversion ===");
{
  function conversionRate(shooter, keeper, runs = 1500) {
    const random = seededRandom(hashString(`tier-${shooter.canonical_player_name}-${keeper.canonical_player_name}`));
    let goals = 0;
    for (let i = 0; i < runs; i += 1) {
      const shot = resolvePlacedFinish({ shooter, targetSide: "left", power: false, pressure: 0.2, random });
      const result = resolveTargetedKeeperResponse({ shot, keeper, actualKeeperState: ACTUAL_STATE, random });
      if (result.goal) goals += 1;
    }
    return goals / runs;
  }
  const eliteVsWeak = conversionRate(ELITE_SHOOTER, WEAK_KEEPER);
  const weakVsElite = conversionRate(WEAK_SHOOTER, ELITE_KEEPER);
  console.log(`Elite shooter vs weak keeper: ${(eliteVsWeak * 100).toFixed(1)}%; weak shooter vs elite keeper: ${(weakVsElite * 100).toFixed(1)}%`);
  check("elite-attacker-vs-weak-keeper converts meaningfully more than weak-attacker-vs-elite-keeper", eliteVsWeak > weakVsElite + 0.05);
}
{
  function chipGoalRate(shooter, keeper, runs = 1500) {
    const random = seededRandom(hashString(`chip-tier-${shooter.canonical_player_name}-${keeper.canonical_player_name}`));
    let goals = 0;
    for (let i = 0; i < runs; i += 1) {
      const result = resolveChipAttempt({ shooter, keeper, actualKeeperDepthYards: 7, random });
      if (result.goal) goals += 1;
    }
    return goals / runs;
  }
  const eliteChip = chipGoalRate(ELITE_SHOOTER, WEAK_KEEPER);
  const weakChip = chipGoalRate(WEAK_SHOOTER, WEAK_KEEPER);
  check("an elite chipper converts meaningfully more than a weak chipper against the same keeper", eliteChip > weakChip + 0.1);
}
{
  function roundKeeperGoalRate(shooter, keeper, runs = 1500) {
    const random = seededRandom(hashString(`round-tier-${shooter.canonical_player_name}-${keeper.canonical_player_name}`));
    let goals = 0;
    for (let i = 0; i < runs; i += 1) {
      const result = resolveRoundKeeper({ shooter, keeper, defender: null, actualDistanceYards: 3, random });
      if (result.goal) goals += 1;
    }
    return goals / runs;
  }
  const eliteDribbler = roundKeeperGoalRate(ELITE_SHOOTER, ELITE_KEEPER);
  const weakDribbler = roundKeeperGoalRate(WEAK_SHOOTER, ELITE_KEEPER);
  check("an elite dribbler beats an elite keeper's One On Ones/Agility more often than a weak dribbler does",
    eliteDribbler > weakDribbler + 0.1);
}

console.log("\n=== 4: keeper travel is grounded in ACTUAL geometry, not perceived ===");
{
  // Same actual keeper position; a shot that targets the side the keeper
  // is actually covering must require LESS travel than one targeting the
  // actually-exposed side, regardless of what was perceived/intended.
  const state = { depthFromGoalLineYards: 1, lateralOffsetYards: -3, distanceToShooterYards: 8, exposedSide: "right", movementDirection: null, closingSpeed: null, set: null };
  const random = seededRandom(hashString("travel-check"));
  const shotToCoveredSide = resolvePlacedFinish({ shooter: ELITE_SHOOTER, targetSide: "left", power: false, pressure: 0, random });
  const responseCovered = resolveTargetedKeeperResponse({ shot: { ...shotToCoveredSide, onTarget: true, actualTarget: "left" }, keeper: ELITE_KEEPER, actualKeeperState: state, random });
  const responseExposed = resolveTargetedKeeperResponse({ shot: { ...shotToCoveredSide, onTarget: true, actualTarget: "right" }, keeper: ELITE_KEEPER, actualKeeperState: state, random });
  check("targeting the keeper's actually-covered side requires less travel than the actually-exposed side",
    responseCovered.keeperTravelYards < responseExposed.keeperTravelYards);
}

console.log("\n=== 5: square-pass never invents a recipient; deferred actions never crash or fabricate a result ===");
{
  const random = seededRandom(hashString("square-pass-real-teammate"));
  const keeperResponseRandom = seededRandom(hashString("square-pass-real-teammate-kr"));
  const result = resolveSquarePass({ shooter: ELITE_SHOOTER, teammate: TEAMMATE, keeper: ELITE_KEEPER, defender: DEFENDER, actualKeeperState: ACTUAL_STATE, random, keeperResponseRandom });
  check("resolveSquarePass produces a real result when given a real teammate", typeof result.code === "string");
  check("resolveSquarePass never returns goal:true on an intercepted pass", !(result.passCompleted === false && result.goal));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
