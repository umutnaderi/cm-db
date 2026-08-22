import {
  buildBallTrajectory,
  controlledBallPosition,
  createBallState,
  predictBallPosition,
  selectLooseBallRecovery,
  transitionBallState,
} from "../src/lib/matchBallCore.js";
import { buildMatchLabPlaybackPlan, sampleMatchLabPlaybackPlan } from "../src/lib/matchLabPlayback.js";

let failures = 0;
function check(label, condition) {
  if (condition) console.log(`PASS -- ${label}`);
  else { console.error(`FAIL -- ${label}`); failures += 1; }
}
const from = { x: 50, y: 70, zone: 7 };
const to = { x: 50, y: 50, zone: 4 };

console.log("=== Independent Ball Core ===");
const touch = buildBallTrajectory({ from, to, movement: "touch", durationMs: 400 });
check("a ground touch has its own sampled trajectory", touch.length > 2);
check("the ball is nudged ahead of a linearly moving carrier", touch[4].position.y < 60);
check("grass drag reduces horizontal speed toward the next touch", Math.abs(touch[1].velocity.y) > Math.abs(touch.at(-2).velocity.y));
check("resolver-owned contact endpoints remain exact", touch[0].position.y === 70 && touch.at(-1).position.y === 50);

const cross = buildBallTrajectory({ from, to, movement: "cross", durationMs: 700 });
check("a cross is airborne between its contacts", cross[4].mode === "airborne" && cross[4].position.height > 0);
check("an aerial ball lands exactly at ground height", cross.at(-1).position.height === 0);

const rebound = buildBallTrajectory({
  from, to, movement: "save", ballResult: "post-rebound", durationMs: 500,
});
const positiveHeights = rebound.filter((sample) => sample.position.height > 0);
check("a live rebound has a decaying two-hop bounce", rebound[3].position.height > 0
  && rebound[6].position.height > 0 && positiveHeights.length >= 4);

const outfieldDisplay = controlledBallPosition({ playerPoint: from, attackingDirection: "up", ownerRole: "player" });
const keeperDisplay = controlledBallPosition({ playerPoint: from, attackingDirection: "up", ownerRole: "keeper" });
check("an outfielder's resting ball is displayed in front, not inside the marker", outfieldDisplay.y < from.y);
check("a goalkeeper may hold the ball on their marker", keeperDisplay.x === from.x && keeperDisplay.y === from.y);

const initial = createBallState({ position: from, ownerId: "p1", ownerRole: "player" });
const rollingPass = buildBallTrajectory({ from, to, movement: "pass", durationMs: 500 });
const loose = transitionBallState({ previous: initial, endpoint: to, trajectory: rollingPass });
check("an ownerless live ball retains its independent incoming velocity", loose.phase === "loose"
  && Math.hypot(loose.velocity.x, loose.velocity.y) > 0);
const controlled = transitionBallState({ previous: loose, endpoint: to, ownerId: "gk", ownerRole: "keeper", trajectory: touch });
check("a keeper catch changes ball state to held and stops ground velocity", controlled.phase === "held"
  && controlled.velocity.x === 0 && controlled.velocity.y === 0);

const movingLoose = { ...loose, position: { x: 50, y: 50, zone: 4 }, velocity: { x: 0.05, y: 0 } };
const projected = predictBallPosition(movingLoose, 400);
check("players can project a rolling ball from velocity plus turf friction", projected.x > 55 && projected.x < 70);

const near = { id: "near", x: 50, y: 51, player: { Pace: 8, Anticipation: 8 } };
const far = { id: "far", x: 50, y: 80, player: { Pace: 20, Anticipation: 20 } };
check("loose-ball recovery is decided from ball geometry and player attributes", selectLooseBallRecovery([far, near], loose)?.id === "near");

const trace = [{
  code: "TOUCH", label: "touch", duration: 400, movement: "touch",
  ballFrom: from, ballTo: to, ballTrajectory: touch,
  playerMoves: [{ playerId: "p1", from, to, action: "carry" }],
  ownerBeforeId: "p1", ownerAfterId: "p1", ownerAfterAt: "end",
}];
const plan = buildMatchLabPlaybackPlan({
  trace, initialPositions: { p1: from }, initialBall: from, initialOwnerId: "p1", finalOwnerId: "p1",
});
const midpoint = sampleMatchLabPlaybackPlan(plan, 200);
check("playback consumes the authored ball track independently of the player track", midpoint.ball.y < midpoint.players.p1.y);
check("the independent ball/player timeline remains immutable", Object.isFrozen(plan) && Object.isFrozen(plan.tracks.ball));

if (failures) {
  console.error(`\n${failures} FAILURE(S)`);
  process.exitCode = 1;
} else {
  console.log("\nALL PASS");
}
