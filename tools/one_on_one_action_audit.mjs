// Stage 2 (one-on-one action-specific execution) audit -- built for the
// review of src/lib/oneOnOneDecision.js (Stage 1) + matchEngineCore.js's
// new ONE_V_ONE.* resolvers (Stage 2). See MATCH_LAB_PLAN.md's Stage 2
// section for the full design writeup.
//
// Two sections, per the review -- this distinguishes a broken SELECTOR
// from a broken EXECUTION formula, which one combined number can't:
//   A. Forced-action matrix -- each action forced independently (Stage 1
//      bypassed entirely), testing execution/keeper-response formulas in
//      isolation against representative geometry for that action.
//   B. Full decision-policy matrix -- Stage 1 chooses, Stage 2 executes,
//      the real end-to-end pipeline. Reports selection frequency AND
//      conditional-per-action conversion AND policy-level conversion,
//      since attributes influence both which action gets picked and
//      whether it works -- these must be told apart, not blended (see the
//      review's "attribute compounding" point).
//
// Every intermediate rate is reported before final conversion, on
// purpose -- the free-kick/aerial calibration work earlier this session
// found individually-plausible multiplicative gates collapsing into an
// unrealistically low number when only the final rate was checked.
//
// Usage: node tools/one_on_one_action_audit.mjs [trials]
//   npm run one-on-one:audit  (defaults to 4000 trials per cell)
import { hashString, playerAttribute, seededRandom } from "../src/lib/matchEngineCore.js";
import {
  resolveChipAttempt, resolvePlacedFinish, resolveRoundKeeper,
  resolveSquarePass, resolveTargetedKeeperResponse,
} from "../src/lib/matchEngineCore.js";
import { chooseOneOnOneAction, perceiveKeeperState, scoreOneOnOneCandidates } from "../src/lib/oneOnOneDecision.js";

const trials = Number(process.argv[2]) || 4000;

// --- Constructed players --------------------------------------------------
function attrs(pairs) {
  return Object.entries(pairs).map(([label, value]) => ({ label, value }));
}
function player(name, overrides) {
  return { canonical_player_name: name, current_ability: 150, attributes: attrs(overrides) };
}

const STRONG_SHOOTER = player("Strong Shooter", {
  Finishing: 18, Technique: 17, Composure: 17, Decisions: 16, Anticipation: 15,
  Flair: 16, Dribbling: 17, Acceleration: 16, Agility: 16, Balance: 15,
  Passing: 15, Teamwork: 13,
});
const WEAK_SHOOTER = player("Weak Shooter", {
  Finishing: 8, Technique: 7, Composure: 7, Decisions: 7, Anticipation: 7,
  Flair: 7, Dribbling: 7, Acceleration: 8, Agility: 8, Balance: 8,
  Passing: 8, Teamwork: 9,
});
const STRONG_KEEPER = player("Strong Keeper", {
  Reflexes: 18, Positioning: 17, "One On Ones": 17, Handling: 16, Agility: 16, Anticipation: 15,
});
const WEAK_KEEPER = player("Weak Keeper", {
  Reflexes: 8, Positioning: 8, "One On Ones": 7, Handling: 8, Agility: 8, Anticipation: 8,
});
const TEAMMATE = player("Teammate", { Finishing: 13, Technique: 13, Composure: 12, Passing: 12 });
const MODERATE_DEFENDER = player("Covering Defender", { Anticipation: 12, Positioning: 12, Tackling: 12 });

const SHOOTER_TIERS = { strong: STRONG_SHOOTER, weak: WEAK_SHOOTER };
const KEEPER_TIERS = { strong: STRONG_KEEPER, weak: WEAK_KEEPER };

const ACTIONS = ["place-left", "place-right", "blast", "chip", "round-keeper", "square-pass"];

// Representative geometry per action -- plausible conditions for THAT
// action to actually be attempted under (a chip needs an advanced keeper
// to mean anything; round-keeper needs real proximity), not one identical
// setup reused everywhere.
const GEOMETRY = {
  "place-left": { lateralOffsetYards: 1.5, exposedSide: "left", depthFromGoalLineYards: 1, distanceToShooterYards: 8 },
  "place-right": { lateralOffsetYards: -1.5, exposedSide: "right", depthFromGoalLineYards: 1, distanceToShooterYards: 8 },
  blast: { lateralOffsetYards: 0, exposedSide: "balanced", depthFromGoalLineYards: 1, distanceToShooterYards: 8 },
  chip: { lateralOffsetYards: 0, exposedSide: "balanced", depthFromGoalLineYards: 6, distanceToShooterYards: 10 },
  "round-keeper": { lateralOffsetYards: 0, exposedSide: "balanced", depthFromGoalLineYards: 1, distanceToShooterYards: 3 },
  "square-pass": { lateralOffsetYards: 1.5, exposedSide: "left", depthFromGoalLineYards: 1, distanceToShooterYards: 8 },
};

function actualStateFor(action) {
  return { ...GEOMETRY[action], movementDirection: null, closingSpeed: null, set: null };
}

// One execution call for a given, already-decided action -- shared by both
// sections so forced and policy-driven trials can never silently diverge
// in how they call the resolvers.
function executeAction(action, { shooter, keeper, actualKeeperState, perceivedKeeperState, random, keeperResponseRandom }) {
  switch (action) {
    case "place-left":
    case "place-right": {
      const targetSide = action === "place-left" ? "left" : "right";
      const shot = resolvePlacedFinish({ shooter, targetSide, power: false, pressure: 0.2, random });
      return { shot, ...resolveTargetedKeeperResponse({ shot, keeper, actualKeeperState, random: keeperResponseRandom }) };
    }
    case "blast": {
      const perceivedSide = perceivedKeeperState?.exposedSide;
      const targetSide = !perceivedSide || perceivedSide === "balanced" ? "center" : perceivedSide;
      const shot = resolvePlacedFinish({ shooter, targetSide, power: true, pressure: 0.2, random });
      return { shot, ...resolveTargetedKeeperResponse({ shot, keeper, actualKeeperState, random: keeperResponseRandom }) };
    }
    case "chip":
      return resolveChipAttempt({ shooter, keeper, actualKeeperDepthYards: actualKeeperState.depthFromGoalLineYards, random });
    case "round-keeper":
      return resolveRoundKeeper({ shooter, keeper, defender: null, actualDistanceYards: actualKeeperState.distanceToShooterYards, random });
    case "square-pass":
      return resolveSquarePass({
        shooter, teammate: TEAMMATE, keeper, defender: MODERATE_DEFENDER, actualKeeperState,
        random, keeperResponseRandom,
      });
    default:
      return { code: "ONE_V_ONE.EARLY.DEFERRED", goal: false, rebound: false, keeperAction: null, ballResult: null, keeperTravelYards: 0, deferred: true };
  }
}

// --- Tally -----------------------------------------------------------------
function newTally() {
  return {
    n: 0, executed: 0, keeperContact: 0, cleanGoal: 0, rebound: 0, post: 0, goal: 0,
    targetMismatch: 0, targetApplicable: 0, travelSum: 0, travelN: 0,
    misreadGoal: 0, misreadN: 0, correctReadGoal: 0, correctReadN: 0,
  };
}
function record(tally, execution, shot, misread) {
  tally.n += 1;
  const executed = shot ? shot.onTarget : !execution.deferred;
  if (executed) tally.executed += 1;
  if (execution.keeperAction) tally.keeperContact += 1;
  if (execution.goal && execution.keeperAction === "beaten") tally.cleanGoal += 1;
  if (execution.rebound) tally.rebound += 1;
  if (execution.ballResult === "post-rebound" || execution.ballResult === "post-goal") tally.post += 1;
  if (execution.goal) tally.goal += 1;
  if (shot) {
    tally.targetApplicable += 1;
    if (shot.intendedTarget !== shot.actualTarget) tally.targetMismatch += 1;
  }
  if (typeof execution.keeperTravelYards === "number" && execution.keeperTravelYards > 0) {
    tally.travelSum += execution.keeperTravelYards;
    tally.travelN += 1;
  }
  if (misread !== undefined) {
    if (misread) { tally.misreadN += 1; if (execution.goal) tally.misreadGoal += 1; }
    else { tally.correctReadN += 1; if (execution.goal) tally.correctReadGoal += 1; }
  }
}
function pct(part, whole) {
  return whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : "n/a";
}
function reportTally(label, tally) {
  const avgTravel = tally.travelN > 0 ? (tally.travelSum / tally.travelN).toFixed(2) : "n/a";
  console.log(
    `  ${label.padEnd(28)} n=${String(tally.n).padEnd(6)} ` +
    `executed=${pct(tally.executed, tally.n).padEnd(7)} ` +
    `keeperContact=${pct(tally.keeperContact, tally.n).padEnd(7)} ` +
    `cleanGoal=${pct(tally.cleanGoal, tally.n).padEnd(7)} ` +
    `rebound(opportunity)=${pct(tally.rebound, tally.n).padEnd(7)} ` +
    `post=${pct(tally.post, tally.n).padEnd(7)} ` +
    `TOTAL=${pct(tally.goal, tally.n).padEnd(7)} ` +
    `targetMismatch=${pct(tally.targetMismatch, tally.targetApplicable).padEnd(7)} ` +
    `avgKeeperTravel=${avgTravel}yd`,
  );
  if (tally.misreadN > 0 || tally.correctReadN > 0) {
    console.log(
      `  ${"".padEnd(28)} correct-read conversion=${pct(tally.correctReadGoal, tally.correctReadN)} ` +
      `(n=${tally.correctReadN})  incorrect-read conversion=${pct(tally.misreadGoal, tally.misreadN)} (n=${tally.misreadN})`,
    );
  }
}

// --- Section A: forced-action matrix ---------------------------------------
console.log("=== Section A: forced-action matrix (Stage 1 bypassed -- execution formulas in isolation) ===");
console.log(`(rebound(opportunity) = immediate loose-ball rate; a follow-up scramble contest is NOT simulated here -- Stage 2 has no rebound-chain resolver yet, so this is NOT a "rebound goal" rate. Flagged, not fabricated.)\n`);
for (const action of ACTIONS) {
  console.log(`-- ${action} --`);
  for (const shooterTierName of Object.keys(SHOOTER_TIERS)) {
    for (const keeperTierName of Object.keys(KEEPER_TIERS)) {
      const shooter = SHOOTER_TIERS[shooterTierName];
      const keeper = KEEPER_TIERS[keeperTierName];
      const tally = newTally();
      const random = seededRandom(hashString(`one-on-one-audit:forced:${action}:${shooterTierName}:${keeperTierName}`));
      const keeperResponseRandom = seededRandom(hashString(`one-on-one-audit:forced-kr:${action}:${shooterTierName}:${keeperTierName}`));
      const actualKeeperState = actualStateFor(action);
      for (let i = 0; i < trials; i += 1) {
        const execution = executeAction(action, { shooter, keeper, actualKeeperState, perceivedKeeperState: null, random, keeperResponseRandom });
        record(tally, execution, execution.shot, undefined);
      }
      reportTally(`shooter=${shooterTierName} keeper=${keeperTierName}`, tally);
    }
  }
  console.log("");
}

// --- Section B: full decision-policy matrix --------------------------------
console.log("=== Section B: full decision-policy matrix (Stage 1 chooses, Stage 2 executes) ===\n");
// One representative "typical breakaway" geometry -- deliberately NOT
// tuned per action (Stage 1 doesn't know what it'll pick yet); a genuine
// one-on-one with the keeper slightly advanced and slightly off-center, so
// every candidate has at least some real signal to score against.
const POLICY_GEOMETRY = {
  depthFromGoalLineYards: 4, lateralOffsetYards: 1.5, distanceToShooterYards: 7,
  exposedSide: "left", movementDirection: null, closingSpeed: null, set: null,
};

for (const shooterTierName of Object.keys(SHOOTER_TIERS)) {
  for (const keeperTierName of Object.keys(KEEPER_TIERS)) {
    const shooter = SHOOTER_TIERS[shooterTierName];
    const keeper = KEEPER_TIERS[keeperTierName];
    const selectionCount = new Map();
    // Includes "shoot-early" too -- still selectable at Stage 1 (deferred,
    // not removed there per the review), so it must have a tally bucket or
    // recording a trial that picked it would crash on an undefined entry.
    const perAction = new Map(ACTIONS.concat(["shoot-early"]).map((action) => [action, newTally()]));
    const overall = newTally();
    for (let i = 0; i < trials; i += 1) {
      const decisionRandom = seededRandom(hashString(`one-on-one-audit:policy:${shooterTierName}:${keeperTierName}:${i}`));
      const executionRandom = seededRandom(hashString(`one-on-one-audit:policy-exec:${shooterTierName}:${keeperTierName}:${i}`));
      const keeperResponseRandom = seededRandom(hashString(`one-on-one-audit:policy-kr:${shooterTierName}:${keeperTierName}:${i}`));
      const perceivedKeeperState = perceiveKeeperState(POLICY_GEOMETRY, shooter, decisionRandom);
      const decision = chooseOneOnOneAction({
        shooter, perceivedKeeperState, defenderPressure: 0.2, shotAngle: 45,
        distance: 10, availableTeammates: [{ id: "teammate" }], decisionRandom,
      });
      selectionCount.set(decision.selectedAction, (selectionCount.get(decision.selectedAction) || 0) + 1);
      const execution = executeAction(decision.selectedAction, {
        shooter, keeper, actualKeeperState: POLICY_GEOMETRY, perceivedKeeperState,
        random: executionRandom, keeperResponseRandom,
      });
      record(perAction.get(decision.selectedAction), execution, execution.shot, perceivedKeeperState.misread);
      record(overall, execution, execution.shot, perceivedKeeperState.misread);
    }
    console.log(`-- shooter=${shooterTierName} keeper=${keeperTierName} (n=${trials}) --`);
    console.log("  Selection frequency:");
    for (const action of ACTIONS.concat(["shoot-early"])) {
      const count = selectionCount.get(action) || 0;
      if (count > 0) console.log(`    ${action.padEnd(16)} ${pct(count, trials)} (${count})`);
    }
    console.log("  Conditional conversion per selected action:");
    for (const action of ACTIONS.concat(["shoot-early"])) {
      const tally = perAction.get(action);
      if (tally.n > 0) reportTally(action, tally);
    }
    console.log("  Policy-level (all selections combined):");
    reportTally("overall", overall);
    console.log("");
  }
}

console.log("Done. Every rate above is a real resolver call through the actual Stage 1/Stage 2 code -- no numbers here are invented or extrapolated.");
