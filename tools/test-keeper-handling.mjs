import { createBallState, createLastTouch, transitionBallState } from "../src/lib/matchBallCore.js";
import {
  canKeeperHandle, keeperPossessionPhase, KEEPER_POSSESSION_PHASE,
} from "../src/lib/keeperHandling.js";
import {
  isInsideOwnPenaltyArea, PENALTY_AREA, PITCH_LENGTH_YARDS, PITCH_WIDTH_YARDS,
  yardDistance,
} from "../src/lib/pitchGeometry.js";

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} -- ${label}`);
  if (!condition) failures += 1;
}

console.log("=== Canonical pitch geometry ===");
check("simulation uses the rendered 75 x 120 yard pitch",
  PITCH_WIDTH_YARDS === 75 && PITCH_LENGTH_YARDS === 120);
check("ten horizontal and ten vertical yards resolve to the same world distance",
  Math.abs(yardDistance({ x: 50, y: 50 }, { x: 50 + (10 / 75) * 100, y: 50 }) - 10) < 1e-9
    && Math.abs(yardDistance({ x: 50, y: 50 }, { x: 50, y: 50 + (10 / 120) * 100 }) - 10) < 1e-9);
check("the modeled penalty area matches the rendered 18 x 44 yard box",
  PENALTY_AREA.depthPct === 15 && Math.abs(PENALTY_AREA.halfWidthPct - 29.3333333333) < 1e-6);

const keeper = { id: "gk", team: "home", role: "keeper", x: 50, y: 5 };
const inside = { x: 50, y: 10 };
const outsideDepth = { x: 50, y: 20 };
const outsideWidth = { x: 85, y: 8 };

console.log("\n=== Penalty-area and handling law ===");
check("a home keeper defending y:0 recognizes a point inside their own box",
  isInsideOwnPenaltyArea(keeper, inside, "down"));
check("depth and width boundaries both reject points outside the box",
  !isInsideOwnPenaltyArea(keeper, outsideDepth, "down")
    && !isInsideOwnPenaltyArea(keeper, outsideWidth, "down"));

function ball(lastTouch, position = inside) {
  return createBallState({ position, ownerId: null, lastTouch });
}
const opponentShot = createLastTouch({
  playerId: "opponent", team: "away", bodyPart: "foot", deliberate: true,
});
const teammateBackpass = createLastTouch({
  playerId: "defender", team: "home", bodyPart: "foot", deliberate: true,
});
const teammateDeflection = createLastTouch({
  playerId: "defender", team: "home", bodyPart: "foot", deliberate: false,
});
const teammateHeader = createLastTouch({
  playerId: "defender", team: "home", bodyPart: "head", deliberate: true,
});
const teammateThrow = createLastTouch({
  playerId: "defender", team: "home", bodyPart: "hand", deliberate: true, restart: "throw-in",
});
const ownRelease = createLastTouch({
  playerId: "gk", team: "home", bodyPart: "foot", deliberate: true,
});

check("an opponent touch permits handling inside the box",
  canKeeperHandle({ keeper, ball: ball(opponentShot), attackingDirection: "down" }));
check("a deliberate teammate foot backpass forbids handling",
  !canKeeperHandle({ keeper, ball: ball(teammateBackpass), attackingDirection: "down" }));
check("an accidental teammate deflection permits handling",
  canKeeperHandle({ keeper, ball: ball(teammateDeflection), attackingDirection: "down" }));
check("a deliberate teammate header permits handling",
  canKeeperHandle({ keeper, ball: ball(teammateHeader), attackingDirection: "down" }));
check("a teammate throw-in forbids handling",
  !canKeeperHandle({ keeper, ball: ball(teammateThrow), attackingDirection: "down" }));
check("the keeper cannot re-handle their own release before another touch",
  !canKeeperHandle({ keeper, ball: ball(ownRelease), attackingDirection: "down" }));
check("no keeper may handle outside their own penalty area",
  !canKeeperHandle({ keeper, ball: ball(opponentShot, outsideDepth), attackingDirection: "down" }));

console.log("\n=== Ball-state touch and keeper phase contracts ===");
const loose = ball(teammateBackpass);
const atFeet = transitionBallState({
  previous: loose, endpoint: inside, ownerId: keeper.id, ownerRole: "player",
});
check("a prohibited backpass remains a controlled ball at the keeper's feet",
  atFeet.phase === "controlled-ground"
    && keeperPossessionPhase(keeper, atFeet) === KEEPER_POSSESSION_PHASE.AT_FEET);
const held = transitionBallState({
  previous: ball(opponentShot), endpoint: inside, ownerId: keeper.id, ownerRole: "keeper",
});
check("a legal collection enters the explicit keeper-holding phase",
  held.phase === "held"
    && keeperPossessionPhase(keeper, held) === KEEPER_POSSESSION_PHASE.HOLDING);
check("last-touch law data survives ball-state transitions",
  atFeet.lastTouch.playerId === "defender" && atFeet.lastTouch.deliberate === true);

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
