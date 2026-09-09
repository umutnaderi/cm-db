import { readFileSync } from "node:fs";

import { createTeamSetup } from "../src/lib/matchSetup.js";
import { fromYardPoint } from "../src/lib/pitchGeometry.js";
import {
  DEPTH_BOUNDARIES_YARDS,
  LANE_BOUNDARIES_YARDS,
  TACTICAL_DEPTH_BANDS,
  VERTICAL_LANES,
  classifyTacticalRegion,
  dominantDepthBand,
  laneForX,
  mirrorTacticalPoint,
  mirrorTacticalRegion,
  stabilizeTacticalRegion,
  tacticalRegionMembership,
} from "../src/lib/pitchRegions.js";
import {
  VERTICAL_LANES as TEAM_SHAPE_LANES,
  coordinateTeamShape,
  laneForX as teamShapeLaneForX,
} from "../src/lib/teamShape.js";
import { zoneFromPercent as legacyZoneFromPercent } from "../src/lib/replayHarness.js";

let failures = 0;
function check(label, condition, detail = "") {
  console.log(`${condition ? "PASS" : "FAIL"} -- ${label}${condition || !detail ? "" : `\n       ${detail}`}`);
  if (!condition) failures += 1;
}

function pointAtYards(x, y) {
  return fromYardPoint({ x, y });
}

function rosterFromSetup(teamSetup) {
  return teamSetup.slots.map((slot) => ({
    id: `${teamSetup.team}-${slot.slotId}`,
    team: teamSetup.team,
    role: slot.band === "GK" ? "keeper" : "player",
    positionalSlot: slot.positionalSlot,
    tacticalRole: slot.tacticalRole,
    duty: slot.duty,
    formationAnchor: { x: slot.x, y: slot.y },
    x: slot.x,
    y: slot.y,
    zone: legacyZoneFromPercent(slot.x, slot.y),
    player: { canonical_player_name: slot.slotId, current_ability: 150 },
  }));
}

console.log("=== 1: five lanes have one centralized, pitch-yard-grounded contract ===");
{
  const centres = LANE_BOUNDARIES_YARDS.slice(0, -1).map((minimum, index) =>
    (minimum + LANE_BOUNDARIES_YARDS[index + 1]) / 2);
  const actual = centres.map((x) => laneForX((x / 75) * 100));
  check("all five named lanes classify in physical left-to-right order",
    JSON.stringify(actual) === JSON.stringify(VERTICAL_LANES), actual.join(", "));
  check("teamShape re-exports the exact central lane bindings",
    TEAM_SHAPE_LANES === VERTICAL_LANES && teamShapeLaneForX === laneForX);
  check("the established boundary convention is unchanged",
    laneForX(15.999) === "left-touchline"
    && laneForX(16) === "left-half-space"
    && laneForX(38) === "centre"
    && laneForX(62) === "centre"
    && laneForX(62.001) === "right-half-space"
    && laneForX(84) === "right-half-space"
    && laneForX(84.001) === "right-touchline");
}

console.log("\n=== 2: six bands are relative to attacking direction ===");
{
  const centres = DEPTH_BOUNDARIES_YARDS.slice(0, -1).map((minimum, index) =>
    (minimum + DEPTH_BOUNDARIES_YARDS[index + 1]) / 2);
  const down = centres.map((progress) => dominantDepthBand(pointAtYards(37.5, progress), "down"));
  const up = centres.map((progress) => dominantDepthBand(pointAtYards(37.5, 120 - progress), "up"));
  check("downward attack traverses all six bands",
    JSON.stringify(down) === JSON.stringify(TACTICAL_DEPTH_BANDS), down.join(", "));
  check("upward attack traverses the same semantic order",
    JSON.stringify(up) === JSON.stringify(TACTICAL_DEPTH_BANDS), up.join(", "));
  const physical = pointAtYards(10, 25);
  check("left and right remain pitch-consistent when direction changes",
    classifyTacticalRegion(physical, "down").lane === "left-touchline"
    && classifyTacticalRegion(physical, "up").lane === "left-touchline");
}

console.log("\n=== 3: mirroring preserves semantic region identity ===");
{
  const point = pointAtYards(20, 29);
  const region = classifyTacticalRegion(point, "down");
  const mirroredPoint = mirrorTacticalPoint(point);
  const mirroredClassification = classifyTacticalRegion(mirroredPoint, "up");
  check("mirroring point and direction preserves lane, band and stable id",
    mirroredClassification.id === region.id);
  const samePointOppositeDirection = classifyTacticalRegion(point, "up");
  check("same physical point viewed from the other end maps end-for-end",
    mirrorTacticalRegion(region).id === samePointOppositeDirection.id,
    `${region.id} -> ${samePointOppositeDirection.id}`);
  check("semantic flags expose wide, half-space, centre and penalty context",
    classifyTacticalRegion(pointAtYards(5, 10), "down").flags.wideChannel
    && classifyTacticalRegion(pointAtYards(20, 30), "down").flags.halfSpace
    && classifyTacticalRegion(pointAtYards(37.5, 10), "down").flags.centralCorridor
    && classifyTacticalRegion(pointAtYards(37.5, 10), "down").flags.ownPenaltyArea
    && classifyTacticalRegion(pointAtYards(37.5, 110), "down").flags.attackingPenaltyArea);
}

console.log("\n=== 4: soft membership and hysteresis are stable and deterministic ===");
{
  const boundary = pointAtYards(12, 18);
  const first = tacticalRegionMembership(boundary, "down");
  const second = tacticalRegionMembership(boundary, "down");
  const total = first.regions.reduce((sum, entry) => sum + entry.weight, 0);
  check("a two-axis boundary produces four normalized soft memberships",
    first.regions.length === 4 && Math.abs(total - 1) < 1e-12,
    JSON.stringify(first.regions));
  check("soft memberships are byte-deterministic", JSON.stringify(first) === JSON.stringify(second));

  const before = classifyTacticalRegion(pointAtYards(11.8, 30), "down");
  const justAcross = pointAtYards(12.5, 30);
  const rawAcross = classifyTacticalRegion(justAcross, "down");
  const held = stabilizeTacticalRegion(before, justAcross, "down");
  const released = stabilizeTacticalRegion(before, pointAtYards(13.2, 30), "down");
  check("raw classification changes immediately at the lane edge",
    rawAcross.lane === "left-half-space");
  check("hysteresis retains the previous lane inside its real-yard margin",
    held.lane === "left-touchline" && held.stabilized);
  check("hysteresis releases after the margin is crossed",
    released.lane === "left-half-space" && !released.stabilized);
}

console.log("\n=== 5: classification cannot mutate or quantize continuous coordinates ===");
{
  const point = { x: 37.123456, y: 64.987654, zone: 7, note: "authoritative" };
  const before = JSON.stringify(point);
  const region = classifyTacticalRegion(point, "down");
  tacticalRegionMembership(point, "down");
  stabilizeTacticalRegion(region, point, "down");
  check("the input point is byte-unchanged", JSON.stringify(point) === before);
  check("region ids are non-numeric and cannot enter a legacy zone arithmetic path",
    region.id.startsWith("tactical:") && Number.isNaN(Number(region.id)) && !("zone" in region));

  const setup = createTeamSetup({
    team: "home", formation: "4-3-3", style: "Balanced", attackingDirection: "down",
  });
  const entries = rosterFromSetup(setup);
  const rosterBefore = JSON.stringify(entries);
  const owner = entries.find((entry) => entry.positionalSlot === "FC");
  const planned = coordinateTeamShape({
    entries, ballPoint: owner, possessionTeam: "home", ownerId: owner.id,
    attackingDirection: "down", phase: "progression", style: "possession",
  });
  check("team-shape coordination does not mutate its roster input",
    JSON.stringify(entries) === rosterBefore);
  check("every precise target is retained and merely classified",
    planned.assignments.every((assignment) =>
      assignment.intendedRegion.id === classifyTacticalRegion(assignment.intentionTarget, "down").id
      && Number.isFinite(assignment.intentionTarget.x)
      && Number.isFinite(assignment.intentionTarget.y)));
  check("team diagnostics expose lane, band, width/half-space, jobs and region runs",
    planned.metrics.occupiedLanes >= 3
    && planned.metrics.occupiedDepthBands >= 2
    && Array.isArray(planned.metrics.widthAndHalfSpaceOccupation.halfSpaces)
    && planned.metrics.complementaryJobRegions.length === planned.assignments.length
    && planned.assignments.every((assignment) => ["held", "open", "occupied"].includes(assignment.regionMove)));
}

console.log("\n=== 6: the legacy 12-zone mapping is unchanged and isolated ===");
{
  const centres = [];
  for (let row = 0; row < 4; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      centres.push(legacyZoneFromPercent((column + 0.5) * (100 / 3), (row + 0.5) * 25));
    }
  }
  check("legacy 3x4 centres still produce zones 0 through 11",
    JSON.stringify(centres) === JSON.stringify([...Array(12).keys()]), centres.join(", "));
  check("legacy boundary clamping remains unchanged",
    legacyZoneFromPercent(-5, -5) === 0 && legacyZoneFromPercent(105, 105) === 11);
  const source = readFileSync(new URL("../src/lib/pitchRegions.js", import.meta.url), "utf8");
  check("the tactical module does not import or implement legacy zone arithmetic",
    !source.includes("zoneFromPercent") && !source.includes("Math.floor(zone / 3)"));
}

console.log("\n=== 7: Match Lab exposes an optional, pointer-transparent 5x6 lens ===");
{
  const html = readFileSync(new URL("../match-lab.html", import.meta.url), "utf8");
  const js = readFileSync(new URL("../match-lab.js", import.meta.url), "utf8");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  check("the tactical-region toggle and dedicated SVG/HUD are present",
    html.includes('id="labShowTacticalRegionsCheckbox"')
    && html.includes('id="labTacticalRegionsLayer"')
    && html.includes('id="labTacticalRegionsHud"'));
  check("the overlay iterates the centralized five lanes and six bands",
    js.includes("laneIndex < VERTICAL_LANES.length")
    && js.includes("bandIndex < TACTICAL_DEPTH_BANDS.length")
    && js.includes("tacticalRegionId(lane, depthBand)"));
  check("the region overlay is interaction-safe and keeps possession orientation during flight",
    css.includes(".ml-pitch-tactical-regions")
    && css.includes("pointer-events: none;")
    && js.includes("function lastKnownOwnerIdAt(timeMs)")
    && js.includes("ownerId ?? lastKnownOwnerIdAt(timeMs)"));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
