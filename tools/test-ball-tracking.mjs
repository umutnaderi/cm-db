// Ball tracking -- how strongly a player's shape target follows the ball.
//
// Reported as "players freeze except the ball chaser". The measured cause was
// not that players were stuck: during a 2s+ freeze they sat 0.89 yards from
// their own assigned target, against 0.87 during a brief pause. They stood
// still because they were already where the engine wanted them, and the reason
// the engine wanted them there was that the target barely moved.
import assert from "node:assert/strict";
import { phaseAdjustedShapeTarget } from "../src/lib/teamShape.js";
import { PITCH_LENGTH_YARDS, toYardPoint } from "../src/lib/pitchGeometry.js";

let passes = 0;
function check(label, condition) {
  assert.equal(condition, true, label);
  passes += 1;
}

const DIR = "down"; // attacking toward y = 100
const pct = (yards) => (yards / PITCH_LENGTH_YARDS) * 100;
const entryAt = (slot, depthYards) => ({
  id: slot, team: "home", role: slot === "GK" ? "keeper" : "player",
  positionalSlot: slot, x: 50, y: pct(depthYards),
  formationAnchor: { x: 50, y: pct(depthYards) },
});
const depthOf = (point) => toYardPoint(point).y;
const targetDepth = (entry, ballDepthYards, opts = {}) => depthOf(phaseAdjustedShapeTarget(entry, {
  ballPoint: { x: 50, y: pct(ballDepthYards) }, attackingDirection: DIR,
  phase: opts.phase ?? "defensive-block", inPossession: opts.inPossession ?? false,
}));

// --- the block slides with the ball ----------------------------------------
{
  const defender = entryAt("DC", 25);
  const deep = targetDepth(defender, 20);
  const high = targetDepth(defender, 100);
  const slide = high - deep;
  // The old model was a flat 0.12 coefficient clamped to nine yards, so a
  // ball crossing eighty yards of pitch moved a defender's target by at most
  // nine. A side whose back line cannot slide further than that is not a
  // block; it is four players standing near each other.
  check("a defender's target slides a real distance with the ball", slide > 20);
  check("the slide is bounded, not unlimited", slide < 45);
  check("the slide follows the ball, not against it", high > deep);

  check("target depth is monotonic in ball depth",
    [10, 30, 50, 70, 90].every((ball, index, all) =>
      index === 0 || targetDepth(defender, all[index - 1]) < targetDepth(defender, ball)));
}

// --- the units differ ------------------------------------------------------
{
  const slideOf = (slot, depth) => targetDepth(entryAt(slot, depth), 100) - targetDepth(entryAt(slot, depth), 20);
  const back = slideOf("DC", 25);
  const middle = slideOf("MC", 50);
  const front = slideOf("FC", 75);
  // A back line slides hardest -- holding a line relative to the ball is
  // most of its job. Forwards hold their height most; they are the reference
  // the block is measured against, not the part that chases it.
  check("the back line slides more than the midfield", back > middle);
  check("the midfield slides more than the forwards", middle > front);
  check("every unit slides somewhat", front > 5);

  // The goalkeeper's depth belongs to keeperPositioningPoint(), which caps
  // itself against this same back line. He must not be dragged up the pitch
  // by a shape reference.
  const keeper = slideOf("GK", 6);
  check("the goalkeeper barely tracks at all", keeper < back / 3);
}

// --- phase changes how hard the block chases -------------------------------
{
  const defender = entryAt("DC", 25);
  const defending = targetDepth(defender, 90, { phase: "defensive-block" })
    - targetDepth(defender, 30, { phase: "defensive-block" });
  const attacking = targetDepth(defender, 90, { phase: "progression", inPossession: true })
    - targetDepth(defender, 30, { phase: "progression", inPossession: true });
  // A defending side slides with the ball because that is what a block does.
  // A side in possession is occupying space rather than chasing.
  check("a defending block tracks harder than a side in possession", defending > attacking);
  check("a side in possession still tracks", attacking > 0);
}

// --- what it must not do ---------------------------------------------------
{
  const defender = entryAt("DC", 25);
  const all = [0, 20, 40, 60, 80, 100, 120].map((ball) => targetDepth(defender, ball));
  check("no target leaves the pitch", all.every((depth) => depth >= 0 && depth <= PITCH_LENGTH_YARDS));
  check("every target is finite", all.every((depth) => Number.isFinite(depth)));

  // A manual WIB/WOB drag is the manager's complete instruction for that ball
  // area and must not be overridden by tracking.
  const manual = { ...entryAt("DC", 25), manualPhasePosition: true };
  check("a manual phase position is never tracked away from",
    targetDepth(manual, 20) === targetDepth(manual, 100));
}

console.log(`ALL PASS -- ${passes} ball-tracking assertions`);
