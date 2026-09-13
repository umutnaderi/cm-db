import {
  keeperAngleManagementPlan,
  planKeeperResponse,
} from "../src/lib/keeperDecision.js";
import { advanceMotion } from "../src/lib/worldMotion.js";

let failures = 0;
const check = (label, condition) => {
  console.log(`${condition ? "PASS" : "FAIL"} -- ${label}`);
  if (!condition) failures += 1;
};
const attributes = (values) => Object.entries(values).map(([label, value]) => ({ label, value }));
const player = (name, values = {}) => ({
  canonical_player_name: name,
  current_ability: 150,
  attributes: attributes({ Positioning: 15, Decisions: 15, Anticipation: 15, Bravery: 14, Agility: 14, Acceleration: 13, Pace: 13, ...values }),
});
const keeper = { id: "gk", team: "away", role: "keeper", positionalSlot: "GK", x: 50, y: 1, player: player("Keeper") };
const attacker = { id: "att", team: "home", x: 50, y: 5, player: player("Attacker") };

console.log("=== 1: close-range cone management advances and reduces exposed width ===");
const close = keeperAngleManagementPlan({ keeper, ball: attacker, attackerVelocity: { x: 0, y: -0.006 }, defendingDirection: "down" });
check("the keeper advances from the line while staying short of the ball",
  close.desiredDepthYards > close.keeperDepthYards && close.desiredDepthYards < close.ballDepthYards);
check("advancing makes the visible cone narrower than the eight-yard goal",
  close.coneWidthAtTargetYards < 8 && close.estimatedCoverageRatio > 0.5);

console.log("\n=== 2: off-centre positioning bisects the post rays and responds to instruction ===");
const wideBall = { ...attacker, x: 68, y: 9 };
const cautious = keeperAngleManagementPlan({ keeper, ball: wideBall, defendingDirection: "down", instruction: "cautious" });
const aggressive = keeperAngleManagementPlan({ keeper, ball: wideBall, defendingDirection: "down", instruction: "aggressive" });
check("an off-centre threat moves the set point toward the threatened side", aggressive.target.x > keeper.x);
check("aggressive sweeping closes farther than cautious sweeping", aggressive.desiredDepthYards > cautious.desiredDepthYards);

console.log("\n=== 3: cover and lob exposure constrain the advance ===");
const cover = { id: "cb", x: 65, y: 6, player: player("Cover", { Positioning: 17 }) };
const covered = keeperAngleManagementPlan({ keeper, ball: wideBall, defenders: [cover], defendingDirection: "down" });
const uncovered = keeperAngleManagementPlan({ keeper, ball: wideBall, defenders: [], defendingDirection: "down" });
check("real goal-side cover reduces the keeper's required advance", covered.desiredDepthYards < uncovered.desiredDepthYards);
check("the plan records the remaining lob exposure", Number.isFinite(uncovered.lobExposureYards));

console.log("\n=== 4: the live response exposes diagnostics and movement remains kinetic ===");
const response = planKeeperResponse({
  keeper, ball: attacker, attacker, defenders: [], defendingDirection: "down",
  attackerVelocity: { x: 0, y: -0.006 }, random: () => 0.5,
});
check("the response carries cone and coverage evidence", response.angleManagement?.estimatedCoverageRatio > 0);
check("the close threat triggers an angle-closing destination", response.action === "keeper-close-down" && response.target.y > keeper.y);
const motion = advanceMotion({
  from: keeper, intentionTarget: response.target, player: keeper.player,
  elapsedMs: 250, intention: response.action, continuesAfter: true,
});
check("a short window advances only as far as the keeper can physically travel",
  motion.withinPhysicalLimit && motion.distanceYards > 0 && (!motion.reachedTarget || motion.distanceYards <= 3));

console.log("\n=== 5: the same state is deterministic and does not contain outcome probability ===");
const again = planKeeperResponse({
  keeper, ball: attacker, attacker, defenders: [], defendingDirection: "down",
  attackerVelocity: { x: 0, y: -0.006 }, random: () => 0.5,
});
check("identical inputs reproduce the identical response", JSON.stringify(response) === JSON.stringify(again));
check("positioning evidence contains no save or scoring chance", !Object.keys(response.angleManagement).some((key) => /chance|probability|save/i.test(key)));

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
