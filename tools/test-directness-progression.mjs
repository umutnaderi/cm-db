// Realism Roadmap -- Directness v2.
//
// Directness scales what forward progress is WORTH. These assertions pin the
// two properties that make the change safe to ship: a default side's
// arithmetic is untouched, and a caller with no settings bag at all sees its
// original score.
import assert from "node:assert/strict";
import {
  directnessProgressionWeight, passUtility, crossUtility,
  throughBallUtility, carryUtility, DEFAULT_ATTACKING_SETTINGS,
} from "../src/lib/spatialDecision.js";

let passes = 0;
function check(label, condition) {
  assert.equal(condition, true, label);
  passes += 1;
}
const near = (actual, expected, tolerance = 1e-9) => Math.abs(actual - expected) <= tolerance;

const settings = (directness) => ({ ...DEFAULT_ATTACKING_SETTINGS, directness });

// Attacking "down" means toward y = 100, so a larger y is forward.
const OWNER = { id: "owner", team: "home", x: 50, y: 40, player: null };
const AHEAD = { id: "ahead", team: "home", x: 50, y: 62, player: null };
const BEHIND = { id: "behind", team: "home", x: 50, y: 22, player: null };
const OPPONENTS = [
  { id: "d1", team: "away", x: 30, y: 70, player: null },
  { id: "d2", team: "away", x: 70, y: 72, player: null },
];
const DOWN = "down";

// --- the multiplier itself -------------------------------------------------
{
  check("no settings bag means no multiplier", directnessProgressionWeight(null) === 1);
  check("an undefined bag means no multiplier", directnessProgressionWeight(undefined) === 1);
  // The load-bearing one. DEFAULT_TEAM_ATTACKING.directness is 2, so a side
  // that never touched the Attacking UI must be arithmetically unchanged.
  check("the default directness is exactly neutral",
    near(directnessProgressionWeight(settings(2)), 1));
  check("the default bag itself is neutral",
    near(directnessProgressionWeight(DEFAULT_ATTACKING_SETTINGS), 1));

  check("a patient side values progress less", directnessProgressionWeight(settings(1)) < 1);
  check("a direct side values progress more", directnessProgressionWeight(settings(5)) > 1);
  check("the weight rises monotonically with directness",
    [1, 2, 3, 4, 5].every((level, index, all) =>
      index === 0 || directnessProgressionWeight(settings(all[index - 1])) < directnessProgressionWeight(settings(level))));
  check("out-of-range directness is clamped, not dropped",
    directnessProgressionWeight(settings(9)) === directnessProgressionWeight(settings(5))
    && directnessProgressionWeight(settings(-3)) === directnessProgressionWeight(settings(1)));
}

// --- the four progression utilities ---------------------------------------
const UTILITIES = [
  ["passUtility", (context) => passUtility(OWNER, AHEAD, OPPONENTS, DOWN, context)],
  ["crossUtility", (context) => crossUtility(OWNER, AHEAD, OPPONENTS, DOWN, context)],
  ["throughBallUtility", (context) => throughBallUtility(OWNER, { x: 50, y: 70 }, OPPONENTS, DOWN, context)],
  ["carryUtility", (context) => carryUtility(OWNER, { x: 50, y: 52 }, OPPONENTS, DOWN, context)],
];

for (const [name, score] of UTILITIES) {
  // The compatibility guarantee: every pre-existing direct call, including
  // this file's own sibling regression suite, passes no settings bag.
  check(`${name} is unchanged with no settings bag`,
    near(score({}), score({ attackingSettings: null })));
  // NOT "the default bag equals no bag": supplying a settings bag also
  // activates the style-affinity and skipped-simple terms, which is
  // pre-existing behaviour this change does not touch. What must hold is that
  // the DIRECTNESS multiplier is neutral at the default, which
  // directnessProgressionWeight() is asserted on directly above and the
  // parity sweep confirms end-to-end.
  check(`${name} at the default sits between the extremes`,
    score({ attackingSettings: settings(1) }) < score({ attackingSettings: settings(2) })
    && score({ attackingSettings: settings(2) }) < score({ attackingSettings: settings(5) }));
  check(`${name} rates a forward option higher when direct`,
    score({ attackingSettings: settings(5) }) > score({ attackingSettings: settings(1) }));
  check(`${name} moves monotonically with directness`,
    [1, 2, 3, 4, 5].every((level, index, all) =>
      index === 0
      || score({ attackingSettings: settings(all[index - 1]) }) < score({ attackingSettings: settings(level) })));
}

// --- the signed half of it -------------------------------------------------
{
  // The term is signed, so the same multiplier that rewards a direct side for
  // going forward must punish it for going backwards. A patient side is
  // happier to go back. Without this the instruction would only ever be a
  // one-way bonus, which is not what directness means.
  const backward = (directness) => passUtility(OWNER, BEHIND, OPPONENTS, DOWN, { attackingSettings: settings(directness) });
  check("a direct side rates a backward pass lower than a patient side does",
    backward(5) < backward(1));
  check("a backward pass separates by directness in the same order",
    backward(5) < backward(2) && backward(2) < backward(1));

  const forward = (directness) => passUtility(OWNER, AHEAD, OPPONENTS, DOWN, { attackingSettings: settings(directness) });
  // Directness must separate the two directions, not merely shift both.
  check("directness widens the gap between forward and backward",
    (forward(5) - backward(5)) > (forward(1) - backward(1)));
}

// --- it encourages, it never deletes ---------------------------------------
{
  // This file's own standing rule: a style or instruction may encourage, never
  // force, never delete a legal option. A finite score at every setting is
  // what "never deleted" means arithmetically.
  check("every setting still produces a finite, comparable score",
    [1, 2, 3, 4, 5].every((level) => UTILITIES.every(([, score]) =>
      Number.isFinite(score({ attackingSettings: settings(level) })))));
}

console.log(`ALL PASS -- ${passes} directness-progression assertions`);
