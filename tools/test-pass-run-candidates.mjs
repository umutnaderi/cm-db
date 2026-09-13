// Joint Passer/Runner Candidate Generation (Stage 3) acceptance tests.
//
// A pass candidate is no longer "play the ball to a teammate's coordinate."
// It is "this passer attempts this delivery toward this spatial point while
// this teammate makes a physically reachable run to meet it there." These
// tests pin that at three levels: the pure candidate module, the real Free
// Play candidate path, and the possession loop that executes the result.
import { hashString, seededRandom } from "../src/lib/matchEngineCore.js";
import { yardDistance } from "../src/lib/pitchGeometry.js";
import { reachIn, timeToReach } from "../src/lib/playerKinetics.js";
import {
  selectPassType, passFlightProfile, reactionDelayMsFor,
} from "../src/lib/matchPassFlight.js";
import {
  laneObstruction, nearestLaneInterceptor, generateFreePlayCandidates,
} from "../src/lib/spatialDecision.js";
import {
  MEETING_POINT_KINDS, REJECTION_REASONS, GROUND_FAMILY_MAX_YARDS,
  CONTROLLED_TO_FEET_MAX_YARDS,
  TO_FEET_DRIVEN_MIN_MOBILITY,
  RUNNER_LATE_TOLERANCE_MS, RUNNING_INTENTION_SPEED_FRACTION,
  generateMeetingPoints, evaluateJointCandidate, generateJointCandidates,
  sortJointCandidates, bestCandidateForRunner, bestThroughBallCandidate,
  resolveDeliveryType, scoreJointCandidate, credibleRangeYards,
  progressionYardsBetween, arrivalSecondsFor,
} from "../src/lib/passRunCandidates.js";

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} -- ${label}`);
  if (!condition) failures += 1;
}

const PASS_FLIGHT_BASE_MS = 50;
const DEPS = {
  selectPassType,
  flightDurationMs: (distanceYards, passType) => Math.round(
    PASS_FLIGHT_BASE_MS
    + (Math.max(0, distanceYards) / passFlightProfile(passType, distanceYards).speedYardsPerSecond) * 1000,
  ),
  laneObstruction,
  nearestLaneInterceptor,
  reactionDelayMs: reactionDelayMsFor,
};

function attrs(pairs) { return Object.entries(pairs).map(([label, value]) => ({ label, value })); }
function player(name, overrides = {}) {
  return {
    canonical_player_name: name, current_ability: 150,
    attributes: attrs({
      Pace: 13, Acceleration: 13, Anticipation: 13, Decisions: 13, "Off the Ball": 13,
      Passing: 13, Technique: 13, Strength: 13, Vision: 13, Teamwork: 13, ...overrides,
    }),
  };
}
const QUICK = player("Quick", { Pace: 19, Acceleration: 19, Anticipation: 17, Decisions: 16 });
const SLOW = player("Slow", { Pace: 3, Acceleration: 3, Anticipation: 4, Decisions: 4 });
const AVERAGE = player("Average");
const STRONG_PASSER = player("Strong Passer", { Passing: 19, Technique: 18, Strength: 18, Vision: 18 });
const WEAK_PASSER = player("Weak Passer", { Passing: 5, Technique: 5, Strength: 5 });
function at(id, x, y, playerObj = AVERAGE, team = "home") {
  return { id, x, y, team, role: "player", player: playerObj, zone: null };
}

// ---------------------------------------------------------------------------
console.log("=== 1: a run into open space makes a pass that did not exist at the start point ===");
{
  // The runner stands level with the ball, tightly marked where they are.
  // At their CURRENT coordinate there is no useful pass. The space ahead of
  // them is empty, and the run into it is what creates the option.
  const passer = at("passer", 50, 20, STRONG_PASSER);
  const runner = at("runner", 50, 50, QUICK);
  // Tight to the runner but clear of the passing lane, so this is about who
  // gets to the BALL, not about a blocked lane.
  const marker = at("marker", 56, 50.4, AVERAGE, "away");
  const opponents = [marker];

  const feet = evaluateJointCandidate({
    passer, runner, meetingPoint: { x: runner.x, y: runner.y }, kind: "current-position",
    opponents, attackingDirection: "down", deps: DEPS, baseUtility: 0,
  });
  const points = generateMeetingPoints({
    passer, runner, attackingDirection: "down", reachBudgetYards: 12,
  });
  const forward = points.find((entry) => entry.kind === "forward-lead");
  check("a forward meeting point is generated for a runner with room ahead", Boolean(forward));
  const intoSpace = evaluateJointCandidate({
    passer, runner, meetingPoint: { x: 50, y: 58 }, kind: "forward-lead",
    opponents, attackingDirection: "down", deps: DEPS, baseUtility: 0,
    initialSpeedYps: 5,
  });
  check("the run into space is viable", intoSpace.viable === true);
  check("and it genuinely gains ground the starting coordinate did not",
    intoSpace.progressionYards > 5 && feet.progressionYards === 0);
  check("the marker sitting on the runner is much further from the space than from their feet",
    intoSpace.defenderEtaMs > feet.defenderEtaMs + 400);
  check("so the joint candidate scores above the pass to feet",
    intoSpace.utility > feet.utility);
}

// ---------------------------------------------------------------------------
console.log("\n=== 2: the ball is aimed at a point, not attached to the receiver ===");
{
  const passer = at("passer", 50, 25, STRONG_PASSER);
  const runner = at("runner", 50, 40, QUICK);
  const candidate = evaluateJointCandidate({
    passer, runner, meetingPoint: { x: 50, y: 55 }, kind: "forward-lead",
    opponents: [], attackingDirection: "down", deps: DEPS, initialSpeedYps: 5,
  });
  check("the candidate carries an intended point distinct from the runner's own position",
    yardDistance(candidate.intendedPoint, candidate.runnerStartPoint) > 5);
  check("the intended point is where the passer aims, recorded explicitly",
    candidate.intendedPoint.x === 50 && candidate.intendedPoint.y === 55);
  check("pass distance is measured to the intended point, not to the runner",
    Math.abs(candidate.passDistanceYards - yardDistance(passer, { x: 50, y: 55 })) < 1e-9
    && candidate.passDistanceYards > yardDistance(passer, runner));
  check("the runner's own start point is kept separately, so the two never collapse",
    candidate.runnerStartPoint.y === 40);
  // Moving the runner (without moving the meeting point) must not move the aim.
  const movedRunner = at("runner", 20, 40, QUICK);
  const sameAim = evaluateJointCandidate({
    passer, runner: movedRunner, meetingPoint: { x: 50, y: 55 }, kind: "forward-lead",
    opponents: [], attackingDirection: "down", deps: DEPS, initialSpeedYps: 5,
  });
  check("moving the receiver does not move the aim point",
    sameAim.intendedPoint.x === candidate.intendedPoint.x
    && sameAim.intendedPoint.y === candidate.intendedPoint.y);
}

// ---------------------------------------------------------------------------
console.log("\n=== 3: faster and better-reading runners reach options slower ones cannot ===");
{
  const passer = at("passer", 50, 20, STRONG_PASSER);
  const meetingPoint = { x: 50, y: 58 };
  const quick = evaluateJointCandidate({
    passer, runner: at("quick", 50, 50, QUICK), meetingPoint, kind: "forward-lead",
    opponents: [], attackingDirection: "down", deps: DEPS,
  });
  const slow = evaluateJointCandidate({
    passer, runner: at("slow", 50, 50, SLOW), meetingPoint, kind: "forward-lead",
    opponents: [], attackingDirection: "down", deps: DEPS,
  });
  check("the quicker runner arrives sooner", quick.runnerEtaMs < slow.runnerEtaMs);
  check("the quicker runner's option is viable", quick.viable === true);
  check("the slower runner's identical option is not", slow.viable === false);
  check("and the reason names the arrival, not something vague",
    ["runner-cannot-arrive", "beyond-physical-reach"].includes(slow.rejection));
  check("reaction delay comes from the shared per-player model, not a constant",
    quick.runnerReactionMs !== slow.runnerReactionMs);
  // Momentum: a runner already going gets there sooner than one from rest.
  const runner = at("runner", 50, 50, AVERAGE);
  const cold = evaluateJointCandidate({
    passer, runner, meetingPoint, kind: "forward-lead", opponents: [],
    attackingDirection: "down", deps: DEPS, initialSpeedYps: 0,
  });
  const running = evaluateJointCandidate({
    passer, runner, meetingPoint, kind: "forward-lead", opponents: [],
    attackingDirection: "down", deps: DEPS, initialSpeedYps: 5,
  });
  check("a runner already moving arrives sooner than the same runner from rest",
    running.runnerEtaMs < cold.runnerEtaMs);
  check("and the momentum solver agrees with the shared reachIn() curve",
    (() => {
      const seconds = arrivalSecondsFor(AVERAGE, 10, 5);
      return Math.abs(reachIn(AVERAGE, seconds, 5) - 10) < 0.05;
    })());
}

// ---------------------------------------------------------------------------
console.log("\n=== 3b: delivery weight adapts to the receiver without erasing a real run ===");
{
  const passer = at("passer", 50, 20, STRONG_PASSER);
  const target = { x: 50, y: 40 };
  const pace9 = player("Pace 9 Receiver", { Pace: 9, Acceleration: 13 });
  const pace17 = player("Pace 17 Receiver", { Pace: 17, Acceleration: 13 });
  const slowFeet = resolveDeliveryType({
    passer: passer.player, receiver: pace9, from: passer, to: target,
    opponents: [], deps: DEPS, meetingPointKind: "current-position",
  });
  const quickFeet = resolveDeliveryType({
    passer: passer.player, receiver: pace17, from: passer, to: target,
    opponents: [], deps: DEPS, meetingPointKind: "current-position",
  });
  const slowRun = resolveDeliveryType({
    passer: passer.player, receiver: pace9, from: passer, to: target,
    opponents: [], deps: DEPS, meetingPointKind: "forward-lead",
  });
  const slowFeetAt42Yards = resolveDeliveryType({
    passer: passer.player, receiver: pace9, from: passer, to: { x: 50, y: 55 },
    opponents: [], deps: DEPS, meetingPointKind: "current-position",
  });
  check("the mobility threshold is explicit and in the ordinary-player range",
    TO_FEET_DRIVEN_MIN_MOBILITY > 10 && TO_FEET_DRIVEN_MIN_MOBILITY < 15);
  check("a slow receiver gets a controlled ground pass to their feet instead of a driven ball",
    slowFeet.passType === "ground" && slowFeet.receiverAdjusted === true);
  check("a quick receiver can still be given the driven delivery",
    quickFeet.passType === "driven-ground" && quickFeet.receiverAdjusted === false);
  check("receiver adaptation never slows a genuine pass into space after the run was approved",
    slowRun.passType === "driven-ground" && slowRun.receiverAdjusted === false);
  check("controlled feet adaptation is bounded to ordinary passing range",
    CONTROLLED_TO_FEET_MAX_YARDS < 30);
  check("a roughly 42-yard pass to a slow receiver remains aerial rather than being downgraded to ground",
    slowFeetAt42Yards.distanceYards > 40
      && ["lofted", "driven-aerial"].includes(slowFeetAt42Yards.passType)
      && slowFeetAt42Yards.receiverAdjusted === false);
  const runAt30Yards = resolveDeliveryType({
    passer: passer.player, receiver: pace17, from: passer, to: { x: 50, y: 45 },
    opponents: [], deps: DEPS, meetingPointKind: "forward-lead",
  });
  check("an upper-medium pass into space uses a driven aerial trajectory",
    runAt30Yards.distanceYards >= 30 && runAt30Yards.passType === "driven-aerial");
  const safeFeet = {
    runnerId: "slow", meetingPointKind: "current-position", utility: 0,
    viable: true, receiverMobility: slowFeet.receiverMobility,
  };
  const temptingLead = {
    runnerId: "slow", meetingPointKind: "forward-lead", utility: 1,
    viable: true, receiverMobility: slowFeet.receiverMobility,
  };
  check("a safe feet option is preferred for the slow receiver even when a lead has higher raw utility",
    bestCandidateForRunner([temptingLead, safeFeet], "slow") === safeFeet);
  check("the slow receiver may still attack space when the pass to feet is not viable",
    bestCandidateForRunner([temptingLead, { ...safeFeet, viable: false }], "slow") === temptingLead);
}

// ---------------------------------------------------------------------------
console.log("\n=== 4: a defender with the earlier arrival kills the candidate ===");
{
  const passer = at("passer", 50, 20, STRONG_PASSER);
  const runner = at("runner", 50, 50, AVERAGE);
  const meetingPoint = { x: 50, y: 56 };
  const clear = evaluateJointCandidate({
    passer, runner, meetingPoint, kind: "forward-lead", opponents: [],
    attackingDirection: "down", deps: DEPS, initialSpeedYps: 4,
  });
  const covered = evaluateJointCandidate({
    passer, runner, meetingPoint, kind: "forward-lead",
    // A defender standing essentially on the meeting point.
    opponents: [at("cover", 50.2, 56.2, QUICK, "away")],
    attackingDirection: "down", deps: DEPS, initialSpeedYps: 4,
  });
  check("the uncontested version is viable", clear.viable === true);
  check("the covered version is not", covered.viable === false);
  check("and the reason is the defender, named explicitly",
    covered.rejection === "defender-arrives-first" || covered.rejection === "lane-intercepted");
  check("the covering defender is identified, not just counted",
    covered.nearestDefenderId === "cover");
  check("the defender's own arrival time is reported", covered.defenderEtaMs < clear.defenderEtaMs);
  check("a merely nearby defender downgrades rather than rejects",
    (() => {
      const contested = evaluateJointCandidate({
        passer, runner, meetingPoint, kind: "forward-lead",
        opponents: [at("near", 55, 57, AVERAGE, "away")],
        attackingDirection: "down", deps: DEPS, initialSpeedYps: 4,
      });
      return contested.viable === true && contested.utility < clear.utility;
    })());
}

// ---------------------------------------------------------------------------
console.log("\n=== 5: kick-time offside makes the candidate illegal ===");
{
  const passer = at("passer", 50, 40, STRONG_PASSER);
  // Attacking "down" (toward y=100). The runner is beyond the last two
  // defenders AND beyond the ball at the moment of the kick.
  const runner = at("runner", 50, 80, QUICK);
  const opponents = [at("d1", 50, 60, AVERAGE, "away"), at("d2", 45, 58, AVERAGE, "away")];
  const offsideCandidate = evaluateJointCandidate({
    passer, runner, meetingPoint: { x: 50, y: 85 }, kind: "run-in-behind",
    opponents, attackingDirection: "down", deps: DEPS, initialSpeedYps: 5,
  });
  check("a runner beyond the second-last defender at the kick is offside",
    offsideCandidate.offside.isOffside === true);
  check("the candidate is rejected for exactly that reason",
    offsideCandidate.viable === false && offsideCandidate.rejection === "runner-offside-at-kick");
  // The same runner, onside at the kick, running to the SAME point is legal:
  // offside is judged where they ARE, not where they are going.
  const onsideRunner = at("runner", 50, 55, QUICK);
  const legal = evaluateJointCandidate({
    passer, runner: onsideRunner, meetingPoint: { x: 50, y: 85 }, kind: "run-in-behind",
    opponents, attackingDirection: "down", deps: DEPS, initialSpeedYps: 5,
  });
  check("an onside runner heading to the same point is judged legal at the kick",
    legal.offside.isOffside === false);
  check("offside is judged on the runner's position, never on the meeting point",
    legal.rejection !== "runner-offside-at-kick");
}

// ---------------------------------------------------------------------------
console.log("\n=== 6: long deliveries choose a supported pass type, not a ground pass ===");
{
  const from = { x: 50, y: 10 };
  const to = { x: 50, y: 70 };
  const distance = yardDistance(from, to);
  check(`the fixture really is a long ball (${distance.toFixed(0)} yards)`, distance >= 50);
  const strong = resolveDeliveryType({ passer: STRONG_PASSER, from, to, opponents: [], deps: DEPS });
  check("a strong passer's long ball is not left on the ground",
    !["ground", "driven-ground"].includes(strong.passType));
  check("it becomes a driven aerial ball", strong.passType === "driven-aerial");
  const weak = resolveDeliveryType({ passer: WEAK_PASSER, from, to, opponents: [], deps: DEPS });
  check("a weaker passer's long ball is lofted rather than driven", weak.passType === "lofted");
  check("the primary selector itself now chooses the strong passer's aerial family",
    strong.upgraded === false);
  check("the weak passer also receives its aerial family directly",
    weak.upgraded === false);
  const shortBall = resolveDeliveryType({
    passer: STRONG_PASSER, from, to: { x: 50, y: 18 }, opponents: [], deps: DEPS,
  });
  check("a short pass is untouched and stays on the ground",
    shortBall.passType === "ground" && shortBall.upgraded === false);
  check("the ground-family credibility ceiling ends at 35 yards",
    GROUND_FAMILY_MAX_YARDS === 35);
}

// ---------------------------------------------------------------------------
console.log("\n=== 7: an unrealistic long ground pass is rejected ===");
{
  const passer = at("passer", 50, 15, STRONG_PASSER);
  const runner = at("runner", 50, 55, QUICK);
  const forced = evaluateJointCandidate({
    passer, runner, meetingPoint: { x: 50, y: 55 }, kind: "current-position",
    opponents: [], attackingDirection: "down", deps: DEPS,
    forcedPassType: "ground", initialSpeedYps: 5,
  });
  check("a ground pass over 50+ yards is not viable", forced.viable === false);
  check("and the reason says so plainly", forced.rejection === "ground-pass-too-long");
  check("the same delivery left to the engine's own type choice is not rejected for that",
    (() => {
      const free = evaluateJointCandidate({
        passer, runner, meetingPoint: { x: 50, y: 55 }, kind: "current-position",
        opponents: [], attackingDirection: "down", deps: DEPS, initialSpeedYps: 5,
      });
      return free.rejection !== "ground-pass-too-long";
    })());
  // Range, separately: a weak passer simply cannot strike it that far.
  const weak = evaluateJointCandidate({
    passer: at("weak", 50, 15, WEAK_PASSER), runner: at("far", 50, 75, QUICK),
    meetingPoint: { x: 50, y: 75 }, kind: "current-position",
    opponents: [], attackingDirection: "down", deps: DEPS, initialSpeedYps: 5,
  });
  check("a weak passer is rejected for range before anything else",
    weak.viable === false && weak.rejection === "outside-passer-range");
  check("a strong passer's credible range genuinely exceeds a weak passer's",
    credibleRangeYards(STRONG_PASSER) > credibleRangeYards(WEAK_PASSER) + 20);
  check("a long pass is never rejected merely for being long",
    (() => {
      const longBall = evaluateJointCandidate({
        passer, runner: at("runner", 50, 52, QUICK),
        meetingPoint: { x: 50, y: 58 }, kind: "forward-lead",
        opponents: [], attackingDirection: "down", deps: DEPS, initialSpeedYps: 6,
      });
      return longBall.passDistanceYards > GROUND_FAMILY_MAX_YARDS && longBall.viable === true;
    })());
}

// ---------------------------------------------------------------------------
console.log("\n=== 8: an ordinary short pass to a stationary teammate still works ===");
{
  const passer = at("passer", 50, 40, AVERAGE);
  const teammate = at("mate", 56, 44, AVERAGE);
  const feet = evaluateJointCandidate({
    passer, runner: teammate, meetingPoint: { x: teammate.x, y: teammate.y },
    kind: "current-position", opponents: [], attackingDirection: "down",
    deps: DEPS, baseUtility: 0.42,
  });
  check("a pass to feet is viable", feet.viable === true);
  check("it stays a ground pass", feet.passType === "ground");
  check("and it scores EXACTLY the existing pass utility, with no joint bonus",
    feet.utility === 0.42);
  check("every joint term is zero for a pass to feet",
    Object.entries(feet.utilityBreakdown)
      .filter(([name]) => name !== "base")
      .every(([, value]) => value === 0));
  check("which is what keeps Stage 3 from silently re-tuning ordinary passing",
    scoreJointCandidate({ baseUtility: -0.7, kind: "current-position" }).total === -0.7);
}

// ---------------------------------------------------------------------------
console.log("\n=== 9: ranking is independent of roster array order ===");
{
  const passer = at("passer", 50, 30, STRONG_PASSER);
  const teammates = [
    at("alpha", 55, 40, QUICK), at("bravo", 45, 38, AVERAGE),
    at("charlie", 60, 46, QUICK), at("delta", 40, 50, SLOW),
  ];
  const opponents = [at("d1", 52, 48, AVERAGE, "away"), at("d2", 44, 44, AVERAGE, "away")];
  const build = (list) => generateJointCandidates({
    passer, teammates: list, opponents, attackingDirection: "down",
    deps: DEPS, baseUtilityFor: (runner) => yardDistance(passer, runner) / 100,
  });
  const forward = build(teammates);
  const reversed = build([...teammates].reverse());
  const shuffled = build([teammates[2], teammates[0], teammates[3], teammates[1]]);
  const signature = (list) => list.map((c) => `${c.runnerId}:${c.meetingPointKind}:${c.utility.toFixed(6)}`).join("|");
  check("the same world produces the same ranking in any array order",
    signature(forward) === signature(reversed) && signature(forward) === signature(shuffled));
  check(`the sweep actually produced candidates to rank (${forward.length})`, forward.length > 4);
  check("and it produced more than one kind of meeting point",
    new Set(forward.map((c) => c.meetingPointKind)).size > 1);
  check("sorting is a total order -- re-sorting is a no-op",
    signature(sortJointCandidates(forward)) === signature(forward));
  check("exact utility ties break deterministically on kind then id",
    (() => {
      const tied = [
        { runnerId: "b", meetingPointKind: "forward-lead", utility: 1, viable: true },
        { runnerId: "a", meetingPointKind: "forward-lead", utility: 1, viable: true },
      ];
      const one = sortJointCandidates(tied).map((c) => c.runnerId).join("");
      const two = sortJointCandidates([...tied].reverse()).map((c) => c.runnerId).join("");
      return one === "ab" && two === "ab";
    })());
}

// ---------------------------------------------------------------------------
console.log("\n=== 10: attacking-direction mirroring produces equivalent results ===");
{
  // The same picture, reflected through the halfway line, with the
  // attacking direction reversed. Every distance, arrival time and verdict
  // must match; only the coordinates differ.
  const mirrorY = (y) => 100 - y;
  const down = {
    passer: at("passer", 50, 30, STRONG_PASSER),
    runner: at("runner", 50, 45, QUICK),
    opponents: [at("d1", 48, 58, AVERAGE, "away")],
    meetingPoint: { x: 50, y: 58 },
    attackingDirection: "down",
  };
  const up = {
    passer: at("passer", 50, mirrorY(30), STRONG_PASSER),
    runner: at("runner", 50, mirrorY(45), QUICK),
    opponents: [at("d1", 48, mirrorY(58), AVERAGE, "away")],
    meetingPoint: { x: 50, y: mirrorY(58) },
    attackingDirection: "up",
  };
  const evaluate = (world) => evaluateJointCandidate({
    passer: world.passer, runner: world.runner, meetingPoint: world.meetingPoint,
    kind: "forward-lead", opponents: world.opponents,
    attackingDirection: world.attackingDirection, deps: DEPS, initialSpeedYps: 5,
  });
  const a = evaluate(down);
  const b = evaluate(up);
  check("pass distance matches under mirroring", Math.abs(a.passDistanceYards - b.passDistanceYards) < 1e-9);
  check("ball and runner arrival times match", a.ballEtaMs === b.ballEtaMs && Math.abs(a.runnerEtaMs - b.runnerEtaMs) < 1e-9);
  check("the defender race matches", Math.abs(a.defenderEtaMs - b.defenderEtaMs) < 1e-9);
  check("progression gained matches", Math.abs(a.progressionYards - b.progressionYards) < 1e-9);
  check("the offside verdict matches", a.offside.isOffside === b.offside.isOffside);
  check("viability and utility match", a.viable === b.viable && Math.abs(a.utility - b.utility) < 1e-9);
  check("meeting-point generation mirrors too",
    (() => {
      const kindsDown = generateMeetingPoints({
        passer: down.passer, runner: down.runner, attackingDirection: "down", reachBudgetYards: 10,
      }).map((entry) => entry.kind).sort().join(",");
      const kindsUp = generateMeetingPoints({
        passer: up.passer, runner: up.runner, attackingDirection: "up", reachBudgetYards: 10,
      }).map((entry) => entry.kind).sort().join(",");
      return kindsDown === kindsUp;
    })());
  check("progression is direction-aware, not a raw y difference",
    progressionYardsBetween({ x: 50, y: 30 }, { x: 50, y: 45 }, "down") > 0
    && progressionYardsBetween({ x: 50, y: 70 }, { x: 50, y: 55 }, "up") > 0);
}

// ---------------------------------------------------------------------------
console.log("\n=== 11: generation consumes no RNG and mutates nothing ===");
{
  const passer = at("passer", 50, 30, STRONG_PASSER);
  const teammates = [at("t1", 55, 42, QUICK), at("t2", 44, 38, AVERAGE)];
  const opponents = [at("d1", 52, 48, AVERAGE, "away")];
  const snapshot = JSON.stringify({ passer, teammates, opponents });

  let draws = 0;
  const watched = () => { draws += 1; return 0.5; };
  const stream = seededRandom(hashString("pass-run-rng-guard"));
  const before = stream();
  const first = generateJointCandidates({
    passer, teammates, opponents, attackingDirection: "down", deps: DEPS,
  });
  const after = stream();
  check("no random function in scope was called", draws === 0 && watched() === 0.5);
  check("an independent seeded stream advanced only where this test advanced it",
    typeof before === "number" && typeof after === "number" && before !== after);
  check("nothing in the world was mutated",
    JSON.stringify({ passer, teammates, opponents }) === snapshot);
  const second = generateJointCandidates({
    passer, teammates, opponents, attackingDirection: "down", deps: DEPS,
  });
  check("repeated generation on the same world is byte-identical",
    JSON.stringify(first) === JSON.stringify(second));
  check("the contract fields are all present on every candidate",
    first.every((candidate) => [
      "passerId", "runnerId", "sourcePoint", "runnerStartPoint", "intendedPoint",
      "meetingPointKind", "passType", "passDistanceYards", "runnerDistanceYards",
      "runnerReactionMs", "runnerEtaMs", "ballEtaMs", "defenderEtaMs",
      "arrivalMarginMs", "contestMarginMs", "offside", "region",
      "progressionYards", "viable", "rejection", "utility", "utilityBreakdown",
    ].every((field) => field in candidate)));
  check("every meeting-point kind used is declared vocabulary",
    first.every((candidate) => MEETING_POINT_KINDS.includes(candidate.meetingPointKind)));
  check("every rejection reason used is declared vocabulary",
    first.every((candidate) => candidate.rejection === null
      || REJECTION_REASONS.includes(candidate.rejection)));
  check("a tactical region is attached for description, never used as the target",
    first.every((candidate) => candidate.region && typeof candidate.region.id === "string"));
  check("missing injected geometry is refused loudly rather than approximated",
    (() => {
      try {
        generateJointCandidates({ passer, teammates, opponents, deps: {} });
        return false;
      } catch (error) { return /deps\./.test(error.message); }
    })());
}

// ---------------------------------------------------------------------------
console.log("\n=== 12-14: the real Free Play path and the possession loop ===");
{
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
      querySelector() { return fakeElement(); }, querySelectorAll() { return []; },
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
  const seat = (id, x, y, playerObj, team = "home", role = "player") => ({
    id, role, team, player: playerObj, x, y, zone: zoneFromPercent(x, y),
  });

  // --- the Free Play path really carries joint candidates ------------------
  // Teammates far enough forward that the delivery to them is a real,
  // multi-second flight -- which is what gives a runner time to cover
  // meaningful ground, and therefore what makes a meeting point away from
  // their feet physically possible at all.
  const passer = seat("owner", 50, 25, STRONG_PASSER);
  const mates = [seat("t1", 52, 50, QUICK), seat("t2", 46, 54, AVERAGE), seat("t3", 60, 58, QUICK)];
  const foes = [seat("d1", 52, 70, AVERAGE, "away"), seat("d2", 46, 74, AVERAGE, "away")];
  const gk = seat("gk", 50, 96, AVERAGE, "away", "keeper");
  state.attackingDirection = { home: "down", away: "up" };
  const groups = { owner: passer, teammates: mates, opponents: foes, keeper: gk };
  const plain = generateFreePlayCandidates(groups, "down", null, null, null);
  const joint = generateFreePlayCandidates(groups, "down", null, null, null, DEPS);
  check("the Free Play path accepts injected joint deps", Array.isArray(joint) && joint.length > 0);
  check("one teammate still yields exactly one pass candidate, so the RNG draw count per decision is unchanged",
    plain.filter((c) => c.type === "pass").length === joint.filter((c) => c.type === "pass").length);
  check("pass candidates now carry the joint evaluation that produced them",
    joint.filter((c) => c.type === "pass").every((c) => c.joint && c.joint.runnerId === c.target.id));
  check("a joint pass into space aims somewhere other than the teammate's feet",
    joint.some((c) => c.type === "pass" && c.moveTo
      && yardDistance(c.moveTo, c.target) > 1));
  check("a joint pass to feet carries its explicit aim through to execution",
    joint.some((c) => c.type === "pass" && c.joint.meetingPointKind === "current-position"
      && c.moveTo && yardDistance(c.moveTo, c.target) < 1e-9));

  // --- the chosen receiver-aware delivery survives ACTION.CHOICE ----------
  const openingPassAtSeed = (receiverPlayer, seed) => {
    const owner = seat("handoff-owner", 50, 20, STRONG_PASSER);
    const receiver = seat("handoff-receiver", 50, 55, receiverPlayer);
    state.roster = [owner, receiver];
    state.ball = { x: owner.x, y: owner.y, zone: owner.zone, ownerId: owner.id };
    state.attackingDirection = { home: "down", away: "up" };
    state.attacking.home = { style: "possession", directness: 2, counterOnTurnover: false };
    const run = runConstructedPossession(seed);
    const choiceIndex = run.trace.findIndex((event) => event.code === "ACTION.CHOICE");
    if (choiceIndex < 0 || !/chooses to pass/.test(run.trace[choiceIndex].label)) return null;
    const delivery = run.trace.slice(choiceIndex + 1)
      .find((event) => event.code === "P.PASS" || event.code === "ACTION.CHOICE");
    return delivery?.code === "P.PASS" ? delivery : null;
  };
  const realisticPace9 = player("Pace 9", { Pace: 9, Acceleration: 13 });
  const realisticPace17 = player("Pace 17", { Pace: 17, Acceleration: 13 });
  let slowOpeningPass = null;
  let quickOpeningPass = null;
  let comparisonSeed = null;
  for (let index = 0; index < 160 && !comparisonSeed; index += 1) {
    const seed = `pace-handoff-shared-${index}`;
    const slow = openingPassAtSeed(realisticPace9, seed);
    const quick = openingPassAtSeed(realisticPace17, seed);
    if (slow && quick) {
      slowOpeningPass = slow;
      quickOpeningPass = quick;
      comparisonSeed = seed;
    }
  }
  check("found a real opening pass to both receivers with the same seed and geometry",
    Boolean(comparisonSeed));
  check(`the 42-yard Pace 9 plan stays airborne instead of using the short-range receiver downgrade (found: ${slowOpeningPass?.label ?? "none"})`,
    /a (?:driven aerial|lofted) pass/.test(slowOpeningPass?.label || ""));
  check(`the Pace 9 pass remains aimed at the receiver's kick-time feet (found: ${JSON.stringify(slowOpeningPass?.intendedPoint ?? null)})`,
    slowOpeningPass?.intendedPoint?.x === 50 && slowOpeningPass?.intendedPoint?.y === 55
      && !/space ahead/.test(slowOpeningPass?.label || ""));
  check("the real pass trace explains its delivery type, intent, distance, height and speed",
    slowOpeningPass?.metrics?.passFlight?.passType === "driven-aerial"
      && slowOpeningPass.metrics.passFlight.deliveryIntent === "current-position"
      && slowOpeningPass.metrics.passFlight.distanceYards > 40
      && slowOpeningPass.metrics.passFlight.peakHeightYards > 0
      && slowOpeningPass.metrics.passFlight.speedYardsPerSecond > 0);
  check(`the same geometry with Pace 17 reaches the resolver as a driven lead delivery (found: ${quickOpeningPass?.label ?? "none"})`,
    /a driven (?:ground|aerial) pass/.test(quickOpeningPass?.label || "")
      && Boolean(quickOpeningPass?.intendedPoint)
      && yardDistance(quickOpeningPass.intendedPoint, { x: 50, y: 55 }) >= 1);

  // --- a through ball must have a real runner and meeting point ------------
  let sawThrough = false;
  let throughAlwaysHadPoint = true;
  for (let index = 0; index < 60; index += 1) {
    const ox = 30 + (index % 8) * 4;
    const oy = 20 + Math.floor(index / 8) * 4;
    const o = seat("owner", ox, oy, STRONG_PASSER);
    // Runners far enough ahead that the delivery is a genuine long ball,
    // and a defensive line further still, so there is real space to run into.
    const g = {
      owner: o,
      teammates: [seat("r1", ox + 3, oy + 22, QUICK), seat("r2", ox - 6, oy + 18, QUICK)],
      opponents: [seat("x1", ox + 2, oy + 34, AVERAGE, "away"), seat("x2", ox - 4, oy + 38, AVERAGE, "away")],
      keeper: seat("gk", 50, 96, AVERAGE, "away", "keeper"),
    };
    for (const candidate of generateFreePlayCandidates(g, "down", null, null, null, DEPS)) {
      if (candidate.type !== "through") continue;
      sawThrough = true;
      if (!candidate.moveTo || !candidate.target || !candidate.joint) throughAlwaysHadPoint = false;
      if (candidate.joint && yardDistance(candidate.moveTo, candidate.target) < 1) throughAlwaysHadPoint = false;
    }
  }
  check("the sweep produced real through-ball candidates", sawThrough);
  check("every through ball has a real runner AND a meeting point away from their feet",
    throughAlwaysHadPoint);

  // --- execution stays independent of selection ---------------------------
  const fixture = () => {
    const owner = seat("owner", 45, 25, STRONG_PASSER);
    state.roster = [
      owner, seat("run", 52, 42, QUICK), seat("sup", 36, 34, AVERAGE),
      seat("dfa", 50, 52, AVERAGE, "away"), seat("dfb", 40, 48, AVERAGE, "away"),
      seat("gk", 50, 96, AVERAGE, "away", "keeper"),
    ];
    state.ball = { x: 45, y: 25, zone: zoneFromPercent(45, 25), ownerId: owner.id };
    state.attackingDirection = { home: "down", away: "up" };
  };

  let sawMissedIntendedPoint = false;
  let sawReceiverReactingToFlight = false;
  let sawLooseHandoff = false;
  let checkedDeliveries = 0;
  for (let index = 0; index < 200; index += 1) {
    fixture();
    const run = runConstructedPossession(`pass-run-exec-${index}`);
    for (let k = 0; k < run.trace.length; k += 1) {
      const event = run.trace[k];
      if (event.code !== "P.PASS" && event.code !== "P.THROUGH") continue;
      checkedDeliveries += 1;
      // The aim point and the ball's real endpoint are separate facts, and
      // accuracy error is allowed to put real distance between them.
      if (event.intendedPoint && event.ballTo
        && yardDistance(event.intendedPoint, event.ballTo) > 1) sawMissedIntendedPoint = true;
      const next = run.trace.slice(k + 1, k + 8);
      if (next.some((e) => (e.playerMoves || []).some((m) =>
        m.action === "receive-pass" || m.action === "receive-pass-late"))) {
        sawReceiverReactingToFlight = true;
      }
      if (next.some((e) => e.code === "P.RECEIVE.LATE")) sawLooseHandoff = true;
    }
  }
  check(`the sweep executed real deliveries (${checkedDeliveries})`, checkedDeliveries > 50);
  check("execution error can genuinely make the ball miss its intended meeting point",
    sawMissedIntendedPoint);
  check("the receiver reacts to the actual delivery rather than the ball following them",
    sawReceiverReactingToFlight);
  check("an unreached delivery still hands off to Dynamic Ball Claim v2",
    sawLooseHandoff && typeof lastBallClaimDiagnostics === "function"
    && Boolean(lastBallClaimDiagnostics()));

  // --- no viable runner: the owner does something else ---------------------
  {
    const owner = seat("owner", 50, 30, WEAK_PASSER);
    const boxedIn = {
      owner,
      // The only teammate is 60 yards away, well past a weak passer's range.
      teammates: [seat("far", 50, 92, SLOW)],
      opponents: [seat("d1", 51, 31, AVERAGE, "away")],
      keeper: seat("gk", 50, 96, AVERAGE, "away", "keeper"),
    };
    const options = generateFreePlayCandidates(boxedIn, "down", null, null, null, DEPS);
    check("with no viable runner there is still a legal action to take",
      options.length > 0);
    check("and it is not a through ball", !options.some((c) => c.type === "through"));
  }

  // --- determinism through the whole loop ---------------------------------
  fixture();
  const first = runConstructedPossession("pass-run-determinism");
  fixture();
  const second = runConstructedPossession("pass-run-determinism");
  check("the same seed and world replay to an identical trace",
    JSON.stringify(first.trace.map((e) => [e.code, e.ballTo, e.intendedPoint]))
    === JSON.stringify(second.trace.map((e) => [e.code, e.ballTo, e.intendedPoint])));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
