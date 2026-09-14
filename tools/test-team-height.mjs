// Team height -- the declared distance from the deepest outfielder to the
// highest, held as a shape instruction the way width already is.
import assert from "node:assert/strict";
import {
  TEAM_HEIGHTS, teamHeightTargetYards, normalizeTeamAttacking, DEFAULT_TEAM_ATTACKING,
} from "../src/lib/teamInstructions.js";
import { applyTeamHeight } from "../src/lib/teamShape.js";
import { PITCH_LENGTH_YARDS } from "../src/lib/pitchGeometry.js";

let passes = 0;
function check(label, condition) {
  assert.equal(condition, true, label);
  passes += 1;
}

const DIR = "down"; // attacking toward y = 100, so depth is y
const pct = (yards) => (yards / PITCH_LENGTH_YARDS) * 100;
const depthOf = (point) => (point.y / 100) * PITCH_LENGTH_YARDS;

/** A block: four defenders, three midfielders, two forwards, plus a keeper. */
function block({ defenders = 15, midfield = 45, forwards = 70 } = {}) {
  const make = (id, slot, band, depthYards, x) => ({
    id,
    entry: { id, positionalSlot: slot, role: band === "GK" ? "keeper" : "player", team: "home" },
    intentionTarget: { x, y: pct(depthYards) },
  });
  return [
    make("gk", "GK", "GK", 2, 50),
    make("dl", "DL", "D", defenders, 20), make("dc1", "DC", "D", defenders, 40),
    make("dc2", "DC", "D", defenders, 60), make("dr", "DR", "D", defenders, 80),
    make("mc1", "MC", "M", midfield, 35), make("mc2", "MC", "M", midfield, 50),
    make("mc3", "MC", "M", midfield, 65),
    make("fc1", "FC", "F", forwards, 44), make("fc2", "FC", "F", forwards, 56),
  ];
}
const lengthOf = (assignments) => {
  const outfield = assignments.filter((a) => a.entry.role !== "keeper").map((a) => depthOf(a.intentionTarget));
  return Math.max(...outfield) - Math.min(...outfield);
};

// --- the instruction --------------------------------------------------------
{
  check("three declared heights", TEAM_HEIGHTS.length === 3);
  check("balanced is the default", DEFAULT_TEAM_ATTACKING.height === "balanced");
  check("normalising keeps a valid height", normalizeTeamAttacking({ height: "compact" }).height === "compact");
  check("normalising rejects an invalid one", normalizeTeamAttacking({ height: "enormous" }).height === "balanced");
  check("an absent height defaults", normalizeTeamAttacking({}).height === "balanced");
  check("compact is shorter than balanced, which is shorter than stretched",
    teamHeightTargetYards("compact") < teamHeightTargetYards("balanced")
    && teamHeightTargetYards("balanced") < teamHeightTargetYards("stretched"));
  check("the targets are real coaching distances",
    teamHeightTargetYards("compact") >= 30 && teamHeightTargetYards("stretched") <= 70);
}

// --- the block is pulled toward its declared length -------------------------
{
  // A 55-yard block asked to be compact must shorten.
  const compact = block();
  const beforeCompact = lengthOf(compact);
  const resultCompact = applyTeamHeight(compact, { attackingDirection: DIR, height: "compact" });
  check("a block longer than its target is squeezed", lengthOf(compact) < beforeCompact);
  check("the squeeze is reported as applied", resultCompact.applied === true);
  check("the squeeze moves toward the target, not past it",
    lengthOf(compact) >= teamHeightTargetYards("compact") - 1e-6);

  const stretched = block();
  const beforeStretched = lengthOf(stretched);
  applyTeamHeight(stretched, { attackingDirection: DIR, height: "stretched" });
  check("a block shorter than its target is stretched", lengthOf(stretched) > beforeStretched);

  // The correction is bounded, so a wildly wrong block cannot teleport.
  const collapsed = block({ defenders: 30, midfield: 32, forwards: 34 });
  const before = lengthOf(collapsed);
  applyTeamHeight(collapsed, { attackingDirection: DIR, height: "stretched" });
  // Two units can each move by the bounded maximum in opposite directions, so
  // the LENGTH can change by twice the per-unit cap and no more.
  check("no unit is teleported by a huge correction", lengthOf(collapsed) - before <= 16 + 1e-6);
}

// --- lines stay lines -------------------------------------------------------
{
  // The defect this caught during development: scaling each player's own depth
  // multiplies the gap between two players who merely differ by a yard, so a
  // back four stops being a line. Real blocks squeeze by unit.
  const uneven = block();
  // Nudge one centre-back a yard deeper than his partner.
  uneven.find((a) => a.id === "dc2").intentionTarget.y = pct(16);
  const gapBefore = Math.abs(depthOf(uneven.find((a) => a.id === "dc1").intentionTarget)
    - depthOf(uneven.find((a) => a.id === "dc2").intentionTarget));
  applyTeamHeight(uneven, { attackingDirection: DIR, height: "stretched" });
  const gapAfter = Math.abs(depthOf(uneven.find((a) => a.id === "dc1").intentionTarget)
    - depthOf(uneven.find((a) => a.id === "dc2").intentionTarget));
  check("stretching does not pull a back line apart", Math.abs(gapAfter - gapBefore) < 1e-6);

  const level = block();
  applyTeamHeight(level, { attackingDirection: DIR, height: "compact" });
  const backLine = ["dl", "dc1", "dc2", "dr"].map((id) => depthOf(level.find((a) => a.id === id).intentionTarget));
  check("a level back line stays level", Math.max(...backLine) - Math.min(...backLine) < 1e-6);
}

// --- what it must not touch -------------------------------------------------
{
  const withKeeper = block();
  const keeperBefore = { ...withKeeper[0].intentionTarget };
  applyTeamHeight(withKeeper, { attackingDirection: DIR, height: "compact" });
  // The keeper's depth is decided by keeperPositioningPoint(), which already
  // caps itself against this same back line. Including him would drag the
  // measured block onto the goal line.
  check("the goalkeeper is never moved by team height",
    withKeeper[0].intentionTarget.y === keeperBefore.y);

  const settled = block({ defenders: 25, midfield: 50, forwards: 74 });
  const result = applyTeamHeight(settled, { attackingDirection: DIR, height: "balanced" });
  check("a block already at its height is left alone",
    result.applied === false && result.reason === "within-deadband");

  check("too few outfielders is refused, not divided by zero",
    applyTeamHeight([block()[0]], { attackingDirection: DIR }).applied === false);
  check("an empty list does not throw", applyTeamHeight([], { attackingDirection: DIR }).applied === false);
}

// --- direction ---------------------------------------------------------------
{
  // Attacking the other way must squeeze the same block by the same amount;
  // height is a property of the team, not of which way the pitch is drawn.
  const down = block();
  applyTeamHeight(down, { attackingDirection: "down", height: "compact" });
  const mirrored = block().map((a) => ({ ...a, intentionTarget: { x: a.intentionTarget.x, y: 100 - a.intentionTarget.y } }));
  applyTeamHeight(mirrored, { attackingDirection: "up", height: "compact" });
  check("the correction is symmetric in attacking direction",
    Math.abs(lengthOf(down) - lengthOf(mirrored)) < 1e-6);
}

console.log(`ALL PASS -- ${passes} team-height assertions`);
