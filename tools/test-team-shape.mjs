import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { createTeamSetup, TACTICAL_ROLES_BY_POSITION } from "../src/lib/matchSetup.js";
import { roleBand } from "../src/lib/formationTemplates.js";
import {
  buildRoleOccupancyMap, ROLE_MAP_CELL_LENGTH_YARDS, ROLE_MAP_CELL_WIDTH_YARDS,
  ROLE_MAP_COLUMNS, ROLE_MAP_ROWS,
} from "../src/lib/roleOccupancyMap.js";
import {
  createTeamPhaseState, phaseForTeam, updateTeamPhaseState,
} from "../src/lib/teamPhase.js";
import {
  applyTeamShapeInstructions, coordinateTeamShape, laneForX, phaseAdjustedShapeTarget,
  phaseAnchorSelectionFor, teamShapeMetrics,
} from "../src/lib/teamShape.js";
import { yardDistance } from "../src/lib/pitchGeometry.js";
import { restartPlan } from "../src/lib/restartExecution.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
let failures = 0;
function check(label, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"} -- ${label}${condition || !detail ? "" : `\n       ${detail}`}`);
  if (!condition) failures += 1;
}

function rosterFromSetup(teamSetup, { kickoff = false } = {}) {
  return teamSetup.slots.map((slot) => {
    const ownGoalY = teamSetup.attackingDirection === "down" ? 0 : 100;
    const startY = kickoff && slot.band !== "GK"
      ? (ownGoalY === 0 ? slot.y * 0.5 : 50 + slot.y * 0.5)
      : slot.y;
    return {
      id: `${teamSetup.team}-${slot.slotId}`,
      team: teamSetup.team,
      role: slot.band === "GK" ? "keeper" : "player",
      positionalSlot: slot.positionalSlot,
      tacticalRole: slot.tacticalRole,
      duty: slot.duty,
      formationAnchor: { x: slot.x, y: slot.y },
      withBallAnchor: slot.withBallPosition ? { ...slot.withBallPosition } : null,
      withoutBallAnchor: slot.withoutBallPosition ? { ...slot.withoutBallPosition } : null,
      x: slot.positionalSlot === "FC" && kickoff ? 50 : slot.x,
      y: slot.positionalSlot === "FC" && kickoff ? 50 : startY,
      player: { canonical_player_name: `${teamSetup.team}-${slot.slotId}`, current_ability: 150 },
    };
  });
}

console.log("=== 1: phases use authoritative state and persist with hysteresis ===");
{
  const directions = { home: "down", away: "up" };
  const owner = { id: "owner", team: "home", positionalSlot: "MC", x: 50, y: 50 };
  let phase = createTeamPhaseState({ teams: ["home", "away"], possessionTeam: "home", restartActive: true });
  check("a dead-ball owner starts in restart", phaseForTeam(phase, "home") === "restart");
  check("the opposition starts in its defensive block", phaseForTeam(phase, "away") === "defensive-block");
  phase = updateTeamPhaseState(phase, {
    possessionTeam: "home", owner, ballFrom: owner, ballPoint: owner,
    attackingDirectionByTeam: directions, restartTaken: true,
  }, 0);
  check("the physical first touch starts restart-release", phaseForTeam(phase, "home") === "restart-release");
  phase = updateTeamPhaseState(phase, {
    possessionTeam: "home", owner, ballFrom: owner, ballPoint: { x: 49, y: 47 },
    attackingDirectionByTeam: directions,
  }, 1800);
  check("restart-release persists through the opening movement", phaseForTeam(phase, "home") === "restart-release");
  phase = updateTeamPhaseState(phase, {
    possessionTeam: "home", owner: { ...owner, positionalSlot: "DC", y: 28 },
    ballFrom: { x: 49, y: 47 }, ballPoint: { x: 48, y: 28 },
    attackingDirectionByTeam: directions,
  }, 800);
  check("a short kickoff settles into build-up", phaseForTeam(phase, "home") === "build-up");

  let open = createTeamPhaseState({ teams: ["home", "away"], possessionTeam: "home" });
  open = updateTeamPhaseState(open, {
    possessionTeam: "home", owner, ballFrom: owner, ballPoint: { x: 50, y: 40 }, attackingDirectionByTeam: directions,
  }, 0);
  check("midfield possession is progression", phaseForTeam(open, "home") === "progression");
  open = updateTeamPhaseState(open, {
    possessionTeam: "home", owner, ballFrom: { x: 50, y: 40 }, ballPoint: { x: 50, y: 28 }, attackingDirectionByTeam: directions,
  }, 300);
  check("one boundary sample cannot flip the phase", phaseForTeam(open, "home") === "progression");
  open = updateTeamPhaseState(open, {
    possessionTeam: "away", owner: { ...owner, id: "away-owner", team: "away" },
    ballFrom: { x: 50, y: 28 }, ballPoint: { x: 50, y: 28 }, attackingDirectionByTeam: directions,
  }, 100);
  check("a real possession change creates both transition phases",
    phaseForTeam(open, "away") === "attacking-transition" && phaseForTeam(open, "home") === "defensive-transition");
}

console.log("\n=== 2: tactical role and duty change real target geometry ===");
{
  const context = { ballPoint: { x: 55, y: 45 }, attackingDirection: "down", phase: "progression", inPossession: true };
  const target = (positionalSlot, formationAnchor, tacticalRole, duty = "support") => phaseAdjustedShapeTarget({
    id: `role-${positionalSlot}`, team: "home", role: positionalSlot === "GK" ? "keeper" : "player",
    positionalSlot, formationAnchor, x: formationAnchor.x, y: formationAnchor.y,
    tacticalRole, duty,
  }, context);
  const fullBack = (tacticalRole, duty = "support") => target("DR", { x: 82, y: 24 }, tacticalRole, duty);
  check("wing-back is measurably more advanced than full-back",
    fullBack("wing-back").y > fullBack("full-back").y + 3);
  check("an inverted full-back moves inside while a full-back preserves width",
    Math.abs(fullBack("inverted-full-back").x - 50) < Math.abs(fullBack("full-back").x - 50));
  const defend = fullBack("full-back", "defend");
  const support = fullBack("full-back", "support");
  const attack = fullBack("full-back", "attack");
  check("attack duty is ahead of support, which is ahead of defend", attack.y > support.y && support.y > defend.y);
  check("winger remains wider than inside-forward",
    Math.abs(target("AMR", { x: 82, y: 72 }, "winger").x - 50)
      > Math.abs(target("AMR", { x: 82, y: 72 }, "inside-forward").x - 50));
  check("false-nine drops deeper than poacher",
    target("FC", { x: 50, y: 82 }, "false-nine").y
      < target("FC", { x: 50, y: 82 }, "poacher").y - 8);
  check("a half-back holds deeper than a segundo volante from the same DMC slot",
    target("DMC", { x: 50, y: 38 }, "half-back").y
      < target("DMC", { x: 50, y: 38 }, "segundo-volante").y - 10);
  check("a shadow striker attacks beyond an enganche from the same AMC slot",
    target("AMC", { x: 50, y: 68 }, "shadow-striker").y
      > target("AMC", { x: 50, y: 68 }, "enganche").y + 5);
  check("a sweeper keeper starts farther from goal than a line-holding keeper",
    target("GK", { x: 50, y: 8 }, "sweeper-keeper").y
      > target("GK", { x: 50, y: 8 }, "line-holding-goalkeeper").y + 4.5);
  check("lane names cover touchlines, half-spaces and centre",
    laneForX(5) === "left-touchline" && laneForX(28) === "left-half-space"
    && laneForX(50) === "centre" && laneForX(93) === "right-touchline");
}

console.log("\n=== 2b: WIB/WOB anchors guide the same coordinated shape model ===");
{
  const entry = {
    id: "phase-anchor", team: "home", role: "player", positionalSlot: "MC",
    formationAnchor: { x: 50, y: 50 },
    withBallAnchors: { 7: { x: 72, y: 34 } },
    withoutBallAnchors: { 7: { x: 28, y: 66 } },
    x: 50, y: 50, duty: "support", tacticalRole: "box-to-box",
  };
  const plan = (possessionTeam, phase) => coordinateTeamShape({
    entries: [entry], ballPoint: { x: 50, y: 50 }, possessionTeam,
    ownerId: possessionTeam === "home" ? entry.id : null,
    attackingDirection: "down", phase,
  }).assignments[0];
  const withBall = plan("home", "progression");
  const withoutBall = plan("away", "defensive-block");
  const restart = plan("home", "restart");
  const uneditedZone = coordinateTeamShape({
    entries: [entry], ballPoint: { x: 10, y: 10 }, possessionTeam: "home",
    ownerId: entry.id, attackingDirection: "down", phase: "progression",
  }).assignments[0];
  check("in possession uses the authored with-ball anchor as a manual position",
    withBall.formationAnchor.x === 72 && withBall.formationAnchor.y === 34);
  check("out of possession uses the authored without-ball anchor",
    withoutBall.formationAnchor.x === 28 && withoutBall.formationAnchor.y === 66);
  check("a WOB drag prevents role and duty in its ball area too",
    withoutBall.positioningMode === "manual"
      && withoutBall.tacticalRole === null && withoutBall.duty === null);
  check("restart keeps the base formation anchor",
    restart.formationAnchor.x === 50 && restart.formationAnchor.y === 50);
  check("a ball zone with no authored override inherits the formation",
    uneditedZone.formationAnchor.x === 50 && uneditedZone.formationAnchor.y === 50);
  check("the base formation remains available for diagnostics and is never mutated",
    withBall.baseFormationAnchor.x === 50 && entry.formationAnchor.x === 50);
  check("a manual phase position prevents tactical role and duty in that ball area",
    withBall.positioningMode === "manual" && withBall.manualPhasePosition
      && withBall.tacticalRole === null && withBall.duty === null
      && withBall.authoredTacticalRole === "box-to-box"
      && withBall.authoredDuty === "support");
  const conflictingRole = coordinateTeamShape({
    entries: [{ ...entry, tacticalRole: "advanced-playmaker", duty: "attack" }],
    ballPoint: { x: 50, y: 50 }, possessionTeam: "home", ownerId: entry.id,
    attackingDirection: "down", phase: "progression",
  }).assignments[0];
  check("changing the stored role and duty cannot move an active manual position",
    yardDistance(withBall.shapeTarget, conflictingRole.shapeTarget) < 1e-9);
  check("the same authored anchor is detected after loading its saved zoned map",
    phaseAnchorSelectionFor(JSON.parse(JSON.stringify(entry)), {
      inPossession: true, phase: "progression", ballPoint: { x: 50, y: 50 },
    }).manual);
}

console.log("\n=== 2c: every position-role combination has a detailed occupancy map ===");
{
  const anchors = {
    GK: [50, 92], SW: [50, 84], DC: [50, 78], DL: [18, 76], DR: [82, 76],
    WBL: [14, 66], WBR: [86, 66], DMC: [50, 62], MC: [50, 52],
    ML: [16, 50], MR: [84, 50], AMC: [50, 38], AML: [18, 34], AMR: [82, 34],
    FC: [50, 22], FL: [25, 24], FR: [75, 24],
  };
  const maps = Object.entries(TACTICAL_ROLES_BY_POSITION).flatMap(([positionalSlot, roles]) => {
    const [x, y] = anchors[positionalSlot];
    return roles.map((tacticalRole) => buildRoleOccupancyMap({
      slot: {
        slotId: `${positionalSlot}-${tacticalRole}`, positionalSlot,
        band: roleBand(positionalSlot), x, y, tacticalRole, duty: "support",
      },
      attackingDirection: "up",
    }));
  });
  check("the default grid has 15 by 24 five-yard pixels",
    ROLE_MAP_COLUMNS === 15 && ROLE_MAP_ROWS === 24
      && ROLE_MAP_CELL_WIDTH_YARDS === 5 && ROLE_MAP_CELL_LENGTH_YARDS === 5
      && maps.every((map) => map.cells.length === 360));
  check("every allowed position-role pair produces a finite visible allocation",
    maps.every((map) => map.activeCells > 0
      && Number.isFinite(map.centroid.x) && Number.isFinite(map.centroid.y)));

  const mapFor = (positionalSlot, x, y, tacticalRole) => buildRoleOccupancyMap({
    slot: { slotId: tacticalRole, positionalSlot, band: roleBand(positionalSlot), x, y, tacticalRole, duty: "support" },
    attackingDirection: "up",
  });
  check("a DR full-back map stays wider than an inverted full-back map",
    mapFor("DR", 82, 76, "full-back").centroid.x
      > mapFor("DR", 82, 76, "inverted-full-back").centroid.x + 5);
  check("a DMC half-back map is deeper than a segundo-volante map",
    mapFor("DMC", 50, 62, "half-back").centroid.y
      > mapFor("DMC", 50, 62, "segundo-volante").centroid.y + 7);
  check("a sweeper-keeper map reaches higher than a line-holding keeper map",
    mapFor("GK", 50, 92, "sweeper-keeper").centroid.y
      < mapFor("GK", 50, 92, "line-holding-goalkeeper").centroid.y - 3);
  const supportMap = mapFor("DC", 50, 78, "ball-playing-defender");
  const supportPeak = supportMap.cells.reduce((peak, cell) =>
    cell.intensity > peak.intensity ? cell : peak, supportMap.cells[0]);
  check("a support role's most opaque pixel stays beside its player rectangle",
    yardDistance(supportMap.anchor, supportPeak) <= 3);
  const manualSlot = {
    slotId: "manual-half-winger", positionalSlot: "MC", band: "M",
    x: 50, y: 52, tacticalRole: "half-winger", duty: "support",
    withBallPositions: { 4: { x: 62, y: 45 }, 7: { x: 72, y: 34 } },
  };
  const focusedManualMap = buildRoleOccupancyMap({
    slot: manualSlot, attackingDirection: "up", view: "with-ball", focusZone: 7,
  });
  const manualPeak = focusedManualMap.cells.reduce((peak, cell) =>
    cell.intensity > peak.intensity ? cell : peak, focusedManualMap.cells[0]);
  check("the selected WIB zone moves the role-map peak to its dragged position",
    focusedManualMap.manual
      && yardDistance(focusedManualMap.anchor, { x: 72, y: 34 }) < 1e-9
      && yardDistance(focusedManualMap.anchor, manualPeak) <= 3);
  const averagedManualMap = buildRoleOccupancyMap({
    slot: manualSlot, attackingDirection: "up", view: "with-ball",
  });
  check("an all-zones phase map averages the player's saved manual positions",
    yardDistance(averagedManualMap.manualAnchorAverage, { x: 67, y: 39.5 }) < 1e-9
      && yardDistance(averagedManualMap.anchor, averagedManualMap.manualAnchorAverage) < 1e-9);
}

console.log("\n=== 2d: team instructions change each unit's coordinated target ===");
{
  const ballPoint = { x: 16, y: 55 };
  const wideEntry = { id: "wide", role: "player", positionalSlot: "MR", formationAnchor: { x: 76, y: 50 } };
  const target = { x: 76, y: 50 };
  const attackingContext = {
    ballPoint, attackingDirection: "down", phase: "progression", inPossession: true,
  };
  const wide = applyTeamShapeInstructions(target, wideEntry, {
    ...attackingContext, attacking: { width: "wide" },
  });
  const narrow = applyTeamShapeInstructions(target, wideEntry, {
    ...attackingContext, attacking: { width: "narrow" },
  });
  check("wide possession stretches a wide midfielder farther from centre than narrow possession",
    Math.abs(wide.x - 50) > Math.abs(narrow.x - 50) + 5);

  const defender = { id: "dc", role: "player", positionalSlot: "DC", formationAnchor: { x: 50, y: 30 } };
  const defendingContext = {
    ballPoint, attackingDirection: "down", phase: "defensive-block", inPossession: false,
  };
  const highLine = applyTeamShapeInstructions({ x: 50, y: 30 }, defender, {
    ...defendingContext, defending: { defensiveLine: "high", offsideTrap: true },
  });
  const deepLine = applyTeamShapeInstructions({ x: 50, y: 30 }, defender, {
    ...defendingContext, defending: { defensiveLine: "deep" },
  });
  check("a high offside line steps the centre-back up from a deep block",
    highLine.y > deepLine.y + 10);

  const counter = applyTeamShapeInstructions({ x: 50, y: 52 }, wideEntry, {
    ballPoint, attackingDirection: "down", phase: "attacking-transition", inPossession: true,
    transition: { onGain: "counter" },
  });
  const hold = applyTeamShapeInstructions({ x: 50, y: 52 }, wideEntry, {
    ballPoint, attackingDirection: "down", phase: "attacking-transition", inPossession: true,
    transition: { onGain: "hold-shape" },
  });
  check("counter sends the same player forward while hold shape restrains them",
    counter.y > hold.y + 6);

  const trapInside = applyTeamShapeInstructions({ x: 20, y: 46 }, wideEntry, {
    ...defendingContext, defending: { pressingTrap: "inside" },
  });
  const trapOutside = applyTeamShapeInstructions({ x: 20, y: 46 }, wideEntry, {
    ...defendingContext, defending: { pressingTrap: "outside" },
  });
  check("inside and outside pressing traps move the same player in opposite lateral directions",
    trapInside.x > trapOutside.x);

  const forward = { id: "press-forward", role: "player", positionalSlot: "FC", formationAnchor: { x: 50, y: 56 } };
  const keeperPress = applyTeamShapeInstructions({ x: 50, y: 56 }, forward, {
    ...defendingContext,
    defending: { preventShortGk: true },
    oppositionOwner: { id: "opposition-keeper", role: "keeper", positionalSlot: "GK" },
  });
  const normalKeeperShape = applyTeamShapeInstructions({ x: 50, y: 56 }, forward, {
    ...defendingContext,
    defending: { preventShortGk: false },
    oppositionOwner: { id: "opposition-keeper", role: "keeper", positionalSlot: "GK" },
  });
  check("prevent short goalkeeper distribution sends the forward up to close the keeper",
    keeperPress.y > normalKeeperShape.y + 4);
}

console.log("\n=== 3: one global pass reserves complementary possession and defensive jobs ===");
{
  const homeSetup = createTeamSetup({ team: "home", formation: "4-3-3", style: "Balanced", attackingDirection: "down" });
  const awaySetup = createTeamSetup({ team: "away", formation: "4-4-2", style: "Balanced", attackingDirection: "up" });
  const home = rosterFromSetup(homeSetup, { kickoff: true });
  const away = rosterFromSetup(awaySetup, { kickoff: true });
  const owner = home.find((entry) => entry.positionalSlot === "FC");
  const attack = coordinateTeamShape({
    entries: home, ballPoint: owner, possessionTeam: "home", ownerId: owner.id,
    attackingDirection: "down", phase: "restart-release", style: "possession",
  });
  const defend = coordinateTeamShape({
    entries: away, ballPoint: owner, possessionTeam: "home", ownerId: null,
    attackingDirection: "up", phase: "defensive-block", marking: { scheme: "zonal", strictness: 3 },
  });
  const attackJobs = attack.assignments.map((entry) => entry.teamJob);
  const defenceJobs = defend.assignments.map((entry) => entry.teamJob);
  check("the owner and every teammate receive exactly one job",
    attack.assignments.length === home.length && new Set(attack.assignments.map((entry) => entry.id)).size === home.length);
  check("build-up reserves two distinct support options",
    attackJobs.includes("first-support") && attackJobs.includes("second-support"));
  const supports = attack.assignments.filter((entry) => entry.teamJob === "first-support" || entry.teamJob === "second-support");
  check("the two support options do not share a point", supports.length === 2 && yardDistance(supports[0].intentionTarget, supports[1].intentionTarget) >= 4);
  check("both widths and a recycle pivot are reserved",
    attackJobs.includes("width-left") && attackJobs.includes("width-right") && attackJobs.includes("pivot-recycle"));
  check("at least two bodies preserve rest defence", attack.metrics.restDefenceCount >= 2);
  check("the possessing side expands across at least three lanes", attack.metrics.occupiedLanes >= 3);
  const centreBacks = attack.assignments.filter((entry) => entry.positionalSlot === "DC");
  check("centre-backs split instead of stacking",
    centreBacks.length >= 2 && yardDistance(centreBacks[0].intentionTarget, centreBacks[1].intentionTarget) >= 10);
  check("one primary presser is selected -- never mass convergence",
    defenceJobs.filter((job) => job === "primary-presser").length === 1);
  check("the press also reserves cover and screens",
    defenceJobs.includes("cover-defender") && defenceJobs.includes("passing-lane-screen"));
  check("minimum target separation prevents a central pile",
    attack.metrics.minimumTeammateSeparationYards >= 4 && attack.metrics.clusteredPlayers <= 2,
    JSON.stringify(attack.metrics));
  check("the same snapshot produces byte-identical assignments",
    JSON.stringify(attack) === JSON.stringify(coordinateTeamShape({
      entries: home, ballPoint: owner, possessionTeam: "home", ownerId: owner.id,
      attackingDirection: "down", phase: "restart-release", style: "possession",
    })));
}

console.log("\n=== 3b: coordinated line jobs preserve a shared authoritative depth ===");
{
  const setup = createTeamSetup({ team: "away", formation: "4-4-2", style: "Balanced", attackingDirection: "up" });
  const entries = rosterFromSetup(setup, { kickoff: true });
  const centreBacks = entries.filter((entry) => entry.positionalSlot === "DC");
  const basePlans = centreBacks.map((entry, index) => ({
    id: entry.id,
    action: index === 0 ? "coordinate-defensive-line-controller" : "coordinate-defensive-line-member",
    intentionTarget: { x: entry.x, y: 42 },
  }));
  const planned = coordinateTeamShape({
    entries, ballPoint: { x: 50, y: 58 }, possessionTeam: "home", ownerId: null,
    attackingDirection: "up", phase: "defensive-block", basePlans,
  });
  const aligned = planned.assignments.filter((entry) => centreBacks.some((defender) => defender.id === entry.id));
  check("controller and member keep one line depth after formation blending",
    aligned.length === centreBacks.length && aligned.every((entry) => Math.abs(entry.intentionTarget.y - 42) < 1e-9));
}

console.log("\n=== 4: deterministic saved kickoff reference fixtures ===");
{
  const fixturesDir = join(__dirname, "kickoff-fixtures");
  const names = readdirSync(fixturesDir).filter((name) => name.endsWith(".json")).sort();
  check("three kickoff styles are saved", names.length === 3);
  for (const name of names) {
    const fixture = JSON.parse(readFileSync(join(fixturesDir, name), "utf8"));
    const setup = createTeamSetup({
      team: "home", formation: fixture.formation, style: fixture.formationStyle,
      attackingDirection: fixture.attackingDirection,
    });
    const entries = rosterFromSetup(setup, { kickoff: true });
    const owner = entries.find((entry) => entry.positionalSlot === "FC")
      ?? entries.find((entry) => roleBand(entry.positionalSlot) === "F");
    const planned = coordinateTeamShape({
      entries, ballPoint: owner, possessionTeam: "home", ownerId: owner.id,
      attackingDirection: fixture.attackingDirection, phase: "restart-release",
      style: fixture.openingStyle,
    });
    const jobs = planned.assignments.map((entry) => entry.teamJob);
    check(`${fixture.name}: kickoff dispatch matches the saved opening style`,
      JSON.stringify(restartPlan({ ...fixture.restart, openingStyle: fixture.openingStyle }))
        === JSON.stringify(fixture.expectedRestartPlan));
    check(`${fixture.name}: deterministic`, JSON.stringify(planned) === JSON.stringify(coordinateTeamShape({
      entries, ballPoint: owner, possessionTeam: "home", ownerId: owner.id,
      attackingDirection: fixture.attackingDirection, phase: "restart-release",
      style: fixture.openingStyle,
    })));
    check(`${fixture.name}: occupies the expected opening jobs`,
      fixture.expectedJobs.every((job) => jobs.includes(job)), jobs.join(", "));
    check(`${fixture.name}: spreads across at least three lanes`, planned.metrics.occupiedLanes >= 3);
  }
}

console.log("\n=== 5: telemetry is expressed in pitch yards ===");
{
  const entries = [
    { id: "l", team: "home", positionalSlot: "DL", x: 10, y: 25 },
    { id: "c", team: "home", positionalSlot: "MC", x: 50, y: 50 },
    { id: "r", team: "home", positionalSlot: "FR", x: 90, y: 75 },
  ];
  const metrics = teamShapeMetrics(entries, { attackingDirection: "down" });
  check("width converts 80 pitch-percent to 60 real yards", Math.abs(metrics.widthYards - 60) < 0.001);
  check("length converts 50 pitch-percent to 60 real yards", Math.abs(metrics.lengthYards - 60) < 0.001);
  check("three separated columns occupy three lanes", metrics.occupiedLanes === 3);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
