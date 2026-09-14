// Keeper Depth v2 -- the resting-position curve and its defensive-line cap.
//
// Reported off a browser round as "unnecessary rushing out leaves the goal
// open" and "he is not on his line". These assertions pin the shape the old
// linear formula got wrong.
import assert from "node:assert/strict";
import { keeperPositioningPoint, yardsFromOwnGoalLine } from "../src/lib/spatialDecision.js";

let passes = 0;
function check(label, condition) {
  assert.equal(condition, true, label);
  passes += 1;
}

// The keeper's team attacks "down" (toward y = 100), so their own goal is at
// y = 0 and depth is measured up the pitch from there.
const DIR = "down";
const pitchPercentForYards = (yards) => (yards / 120) * 100;
const depthFor = (ballYards, options) => yardsFromOwnGoalLine(
  keeperPositioningPoint({ x: 50, y: pitchPercentForYards(ballYards) }, DIR, options), DIR,
);
const defenderAt = (yards) => ({ team: "home", role: "player", x: 50, y: pitchPercentForYards(yards) });

// --- the curve is not monotonic in ball distance ---------------------------
{
  // The whole point. The old formula was advance = 0.15 * ballDistance, which
  // is monotonic and therefore wrong at both ends: it left a keeper three
  // yards off his line against a one-on-one, and twelve yards off it whenever
  // the ball was simply a long way away.
  const oneOnOne = depthFor(6);
  const shotRange = depthFor(20);
  const midfield = depthFor(60);

  check("a keeper comes out to narrow a one-on-one", oneOnOne > shotRange);
  check("a keeper stays home against shooting range", shotRange < 3.5);
  check("a keeper pushes up when the ball is far away", midfield > shotRange);
  check("the curve dips in the middle rather than rising throughout",
    shotRange < oneOnOne && shotRange < midfield);

  check("depth rises monotonically once past shooting range",
    [20, 30, 45, 60, 80, 110].every((yards, index, all) =>
      index === 0 || depthFor(all[index - 1]) < depthFor(yards)));
  check("a keeper never leaves his own half", depthFor(110) < 60);
  check("a keeper is never behind his own goal line", depthFor(2) >= 0);
}

// --- the defensive line caps the sweep -------------------------------------
{
  // The "team height" half of the fix: how far a keeper may sweep is a
  // property of the BLOCK, not of the ball. A deep block pins him to his line.
  const free = depthFor(60);
  const deepBlock = depthFor(60, { defenders: [defenderAt(12)] });
  const highLine = depthFor(60, { defenders: [defenderAt(42)] });

  check("a deep block pins the keeper closer to his line", deepBlock < free);
  check("the keeper stays genuinely behind a deep line", deepBlock <= 12 - 6 + 1e-9);
  check("a high line buys the keeper room to sweep", highLine > deepBlock);
  check("a high line does not push him further out than the ball warrants",
    Math.abs(highLine - free) < 1e-9);

  // The deepest outfielder decides, not an average -- it is the man nearest
  // goal who says how much room is behind him.
  check("the deepest defender sets the cap, not the mean",
    Math.abs(depthFor(60, { defenders: [defenderAt(12), defenderAt(50), defenderAt(60)] }) - deepBlock) < 1e-9);
  check("goalkeepers in the defender list are ignored",
    Math.abs(depthFor(60, { defenders: [defenderAt(12), { team: "home", role: "keeper", x: 50, y: 1 }] }) - deepBlock) < 1e-9);
  check("an empty defender list is the same as none",
    Math.abs(depthFor(60, { defenders: [] }) - free) < 1e-9);
}

// --- the sweeping instruction ----------------------------------------------
{
  const cautious = depthFor(60, { sweeping: "cautious" });
  const balanced = depthFor(60, { sweeping: "balanced" });
  const aggressive = depthFor(60, { sweeping: "aggressive" });
  check("a cautious keeper holds a deeper line", cautious < balanced);
  check("an aggressive keeper sweeps higher", aggressive > balanced);
  check("balanced is the default", Math.abs(balanced - depthFor(60)) < 1e-9);
  check("an unknown instruction falls back to balanced",
    Math.abs(depthFor(60, { sweeping: "reckless" }) - balanced) < 1e-9);
  // The instruction is a bias, not an override: it cannot walk a keeper out
  // from behind a deep block.
  check("even an aggressive keeper respects a deep block",
    depthFor(60, { sweeping: "aggressive", defenders: [defenderAt(12)] }) <= 12 - 6 + 1e-9);
}

// --- backwards compatibility ------------------------------------------------
{
  check("the two-argument call still works",
    Number.isFinite(yardsFromOwnGoalLine(keeperPositioningPoint({ x: 50, y: 40 }, DIR), DIR)));
  check("the opposite attacking direction mirrors correctly", (() => {
    const up = keeperPositioningPoint({ x: 50, y: 100 - pitchPercentForYards(60) }, "up");
    return Math.abs(yardsFromOwnGoalLine(up, "up") - depthFor(60)) < 1e-9;
  })());
  check("the keeper stays on the goal-to-ball line", (() => {
    const point = keeperPositioningPoint({ x: 80, y: pitchPercentForYards(60) }, DIR);
    // Ball is right of centre, so the keeper shades right of centre too.
    return point.x > 50 && point.x < 80;
  })());
}

console.log(`ALL PASS -- ${passes} keeper-depth assertions`);
