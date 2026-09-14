// Motion-integrity auditor -- clean tracks, then one focused fixture per
// violation.
//
// Every track here is hand-built. The auditor is supposed to be a check on the
// engine, so testing it against engine output would make a bug in either one
// able to hide a bug in the other.
import assert from "node:assert/strict";
import {
  MOTION_FINDING_KINDS, BALL_MOVING_STATES,
  turnDegrees, describeSegments, auditTrack, auditBallTrack,
  auditMotionIntegrity, summariseFindings,
} from "../src/lib/motionIntegrityDiagnostics.js";

let passes = 0;
function check(label, condition) {
  assert.equal(condition, true, label);
  passes += 1;
}
const near = (actual, expected, tolerance = 1e-9) => Math.abs(actual - expected) <= tolerance;

// One yard per unit keeps the arithmetic in the fixtures readable; the
// separate-axis scaling gets its own test below.
const SQUARE = { x: 1, y: 1 };
const PLAYER_LIMITS = {
  maxSpeedYps: 10,
  maxAccelerationYps2: 8,
  maxDecelerationYps2: 12,
  maxTurnDegreesPerSecond: 240,
  positionDiscontinuityYards: 0.1,
};

/** A straight, steady 6 yd/s run: one yard every 166.67ms. */
function steadyRun(count = 6, speedYps = 6) {
  return Array.from({ length: count }, (unused, index) => ({
    timeMs: Math.round((index * 1000) / speedYps),
    position: { x: index, y: 0 },
    eventIndex: 0,
  }));
}

// --- primitives ------------------------------------------------------------
{
  check("no turn between identical directions", near(turnDegrees({ x: 1, y: 0 }, { x: 1, y: 0 }), 0));
  check("a right-angle turn reads ninety", near(turnDegrees({ x: 1, y: 0 }, { x: 0, y: 1 }), 90, 1e-9));
  check("a reversal reads one hundred and eighty", near(turnDegrees({ x: 1, y: 0 }, { x: -1, y: 0 }), 180, 1e-9));
  check("a zero vector implies no turn", turnDegrees({ x: 0, y: 0 }, { x: 1, y: 0 }) === 0);

  const segments = describeSegments(steadyRun(), { yardsPerUnit: SQUARE });
  check("one segment per adjacent pair", segments.length === 5);
  check("segment speed is distance over elapsed time",
    segments.every((segment) => near(segment.speedYps, 6, 0.05)));
  check("segments carry their own time window",
    segments.every((segment) => segment.toTimeMs > segment.fromTimeMs));
  check("zero-length segments report no direction",
    describeSegments([
      { timeMs: 0, position: { x: 0, y: 0 } }, { timeMs: 100, position: { x: 0, y: 0 } },
    ], { yardsPerUnit: SQUARE })[0].direction === null);
  check("a zero-duration pair is not a segment",
    describeSegments([
      { timeMs: 0, position: { x: 0, y: 0 } }, { timeMs: 0, position: { x: 1, y: 0 } },
    ], { yardsPerUnit: SQUARE }).length === 0);
}

// --- clean tracks ----------------------------------------------------------
{
  check("a steady run is clean", auditTrack(steadyRun(), { limits: PLAYER_LIMITS, yardsPerUnit: SQUARE }).length === 0);
  check("a standing player is clean",
    auditTrack([
      { timeMs: 0, position: { x: 5, y: 5 } },
      { timeMs: 500, position: { x: 5, y: 5 } },
      { timeMs: 1000, position: { x: 5, y: 5 } },
    ], { limits: PLAYER_LIMITS, yardsPerUnit: SQUARE }).length === 0);
  check("an empty track is clean", auditTrack([], { limits: PLAYER_LIMITS }).length === 0);
  check("a single sample is clean", auditTrack([{ timeMs: 0, position: { x: 0, y: 0 } }], { limits: PLAYER_LIMITS }).length === 0);
  // Two samples at the same instant are legal: a contact keyframe and the
  // event that follows it can share a timestamp.
  check("samples sharing an instant are not a time-order fault",
    auditTrack([
      { timeMs: 0, position: { x: 0, y: 0 } },
      { timeMs: 100, position: { x: 0.5, y: 0 } },
      { timeMs: 100, position: { x: 0.5, y: 0 } },
    ], { limits: PLAYER_LIMITS, yardsPerUnit: SQUARE }).length === 0);

  // A player who is genuinely stationary may turn to face anywhere. Scaling
  // the turn allowance by carried speed is what allows that without also
  // allowing a sprinter to pivot.
  const pivot = auditTrack([
    { timeMs: 0, position: { x: 0, y: 0 } },
    { timeMs: 400, position: { x: 0.2, y: 0 } },
    { timeMs: 800, position: { x: 0.2, y: 0.2 } },
  ], { limits: { ...PLAYER_LIMITS, turnSpeedReferenceYps: 6 }, yardsPerUnit: SQUARE });
  check("a near-stationary player may turn sharply", pivot.length === 0);
}

// --- one fixture per violation --------------------------------------------
{
  // speed-exceeded: 3 yards in 100ms is 30 yd/s.
  const fast = auditTrack([
    { timeMs: 0, position: { x: 0, y: 0 } },
    { timeMs: 100, position: { x: 3, y: 0 } },
  ], { limits: PLAYER_LIMITS, yardsPerUnit: SQUARE });
  check("a run above the ceiling is reported", fast.length === 1 && fast[0].kind === "speed-exceeded");
  check("the speed finding carries the measured value and the limit",
    near(fast[0].speedYps, 30, 1e-9) && fast[0].limit === 10);
  check("no speed limit means no speed check",
    auditTrack([
      { timeMs: 0, position: { x: 0, y: 0 } }, { timeMs: 100, position: { x: 3, y: 0 } },
    ], { limits: {}, yardsPerUnit: SQUARE }).length === 0);

  // acceleration-exceeded: 1 yd/s then 9 yd/s across two 500ms segments.
  const accelerating = auditTrack([
    { timeMs: 0, position: { x: 0, y: 0 } },
    { timeMs: 500, position: { x: 0.5, y: 0 } },
    { timeMs: 1000, position: { x: 5, y: 0 } },
  ], { limits: { maxAccelerationYps2: 8 }, yardsPerUnit: SQUARE });
  check("a burst above the acceleration limit is reported",
    accelerating.length === 1 && accelerating[0].kind === "acceleration-exceeded");

  // deceleration-exceeded: 9 yd/s then 1 yd/s, the same change downward.
  const braking = auditTrack([
    { timeMs: 0, position: { x: 0, y: 0 } },
    { timeMs: 500, position: { x: 4.5, y: 0 } },
    { timeMs: 1000, position: { x: 5, y: 0 } },
  ], { limits: { maxDecelerationYps2: 8 }, yardsPerUnit: SQUARE });
  check("a stop above the deceleration limit is reported",
    braking.length === 1 && braking[0].kind === "deceleration-exceeded");
  check("braking is not reported as acceleration",
    auditTrack([
      { timeMs: 0, position: { x: 0, y: 0 } },
      { timeMs: 500, position: { x: 4.5, y: 0 } },
      { timeMs: 1000, position: { x: 5, y: 0 } },
    ], { limits: { maxAccelerationYps2: 1 }, yardsPerUnit: SQUARE }).length === 0);

  // impossible-turn: a full reversal at pace, inside 200ms.
  const reversal = auditTrack([
    { timeMs: 0, position: { x: 0, y: 0 } },
    { timeMs: 100, position: { x: 1, y: 0 } },
    { timeMs: 200, position: { x: 0, y: 0 } },
  ], { limits: { maxTurnDegreesPerSecond: 240 }, yardsPerUnit: SQUARE });
  check("a reversal at pace is reported", reversal.some((finding) => finding.kind === "impossible-turn"));
  check("the turn finding carries the angle and the carried speed",
    near(reversal.find((finding) => finding.kind === "impossible-turn").turnDegrees, 180, 1e-6)
    && reversal.find((finding) => finding.kind === "impossible-turn").carriedSpeedYps > 9);

  // position-discontinuity: a jump with no elapsed time at all.
  const teleport = auditTrack([
    { timeMs: 0, position: { x: 0, y: 0 } },
    { timeMs: 400, position: { x: 2, y: 0 } },
    { timeMs: 400, position: { x: 9, y: 0 } },
  ], { limits: { positionDiscontinuityYards: 0.1 }, yardsPerUnit: SQUARE });
  check("a same-instant jump is a discontinuity",
    teleport.length === 1 && teleport[0].kind === "position-discontinuity");
  check("the discontinuity finding carries the jump distance", near(teleport[0].jumpYards, 7, 1e-9));

  // non-finite
  const broken = auditTrack([
    { timeMs: 0, position: { x: 0, y: 0 } },
    { timeMs: 100, position: { x: Number.NaN, y: 0 } },
    { timeMs: 200, position: { x: 1, y: 0 }, height: Infinity },
  ], { limits: PLAYER_LIMITS, yardsPerUnit: SQUARE });
  check("a non-finite position is reported",
    broken.some((finding) => finding.kind === "non-finite" && finding.fields.includes("position")));
  check("a non-finite height is reported",
    broken.some((finding) => finding.kind === "non-finite" && finding.fields.includes("height")));
  check("a non-finite velocity is reported",
    auditTrack([{ timeMs: 0, position: { x: 0, y: 0 }, velocity: { x: Number.NaN, y: 0 } }], { limits: PLAYER_LIMITS })
      .some((finding) => finding.fields.includes("velocity")));
  // The bad sample is reported once; the segments around it are not
  // differentiated into a cascade of downstream nonsense.
  check("a bad sample does not cascade into derived findings",
    broken.filter((finding) => finding.kind === "non-finite").length === 2
    && broken.every((finding) => finding.kind === "non-finite"));

  // time-order
  const backwards = auditTrack([
    { timeMs: 0, position: { x: 0, y: 0 } },
    { timeMs: 400, position: { x: 1, y: 0 } },
    { timeMs: 200, position: { x: 2, y: 0 } },
  ], { limits: {}, yardsPerUnit: SQUARE });
  check("time running backwards is reported",
    backwards.some((finding) => finding.kind === "time-order"));
}

// --- ball-specific: a moving ball does not simply stop ---------------------
{
  // Rolling at 6 yd/s, then dead still, with nothing to explain it.
  const stalling = [
    { timeMs: 0, position: { x: 0, y: 0 }, state: "rolling" },
    { timeMs: 500, position: { x: 3, y: 0 }, state: "rolling" },
    { timeMs: 1000, position: { x: 3, y: 0 }, state: "rolling" },
    { timeMs: 1500, position: { x: 3, y: 0 }, state: "rolling" },
  ];
  const unexplained = auditBallTrack(stalling, { yardsPerUnit: SQUARE });
  check("a rolling ball that stops for no reason is reported",
    unexplained.length === 1 && unexplained[0].kind === "ball-velocity-lost");
  check("the stop finding carries the state and the speed it lost",
    unexplained[0].state === "rolling" && unexplained[0].priorSpeedYps > 0);

  check("the same stop at a sanctioned contact is legal",
    auditBallTrack(stalling, { yardsPerUnit: SQUARE, sanctionedStopTimesMs: [500] }).length === 0);
  check("the tolerance window is honoured",
    auditBallTrack(stalling, { yardsPerUnit: SQUARE, sanctionedStopTimesMs: [540], stopToleranceMs: 50 }).length === 0);
  check("a stop outside the tolerance window is still reported",
    auditBallTrack(stalling, { yardsPerUnit: SQUARE, sanctionedStopTimesMs: [700], stopToleranceMs: 50 }).length === 1);

  check("an airborne ball is held to the same rule",
    auditBallTrack(stalling.map((sample) => ({ ...sample, state: "airborne" })), { yardsPerUnit: SQUARE }).length === 1);
  // A held or resting ball is not in motion of its own and is meant to sit
  // still; reporting it would be noise on every single possession.
  check("a held ball may sit still",
    auditBallTrack(stalling.map((sample) => ({ ...sample, state: "held" })), { yardsPerUnit: SQUARE }).length === 0);
  check("a resting ball may sit still",
    auditBallTrack(stalling.map((sample) => ({ ...sample, state: "resting" })), { yardsPerUnit: SQUARE }).length === 0);
  check("only rolling and airborne count as moving under their own momentum",
    BALL_MOVING_STATES.has("rolling") && BALL_MOVING_STATES.has("airborne")
    && !BALL_MOVING_STATES.has("held") && !BALL_MOVING_STATES.has("resting"));
  // The track simply ending is not the ball stopping.
  check("a track that ends while moving is not a stop",
    auditBallTrack([
      { timeMs: 0, position: { x: 0, y: 0 }, state: "rolling" },
      { timeMs: 500, position: { x: 3, y: 0 }, state: "rolling" },
    ], { yardsPerUnit: SQUARE }).length === 0);
}

// --- non-square units ------------------------------------------------------
{
  // Match Lab's playback tracks are percent-of-pitch on a 75x120 field, so one
  // percent of x is 0.75 yards and one percent of y is 1.2. Auditing them as
  // if the axes matched would misjudge every diagonal speed.
  const pitch = { x: 0.75, y: 1.2 };
  const diagonal = [
    { timeMs: 0, position: { x: 0, y: 0 } },
    { timeMs: 1000, position: { x: 10, y: 10 } },
  ];
  const segment = describeSegments(diagonal, { yardsPerUnit: pitch })[0];
  check("the axes scale independently", near(segment.distanceYards, Math.hypot(7.5, 12), 1e-9));
  check("a percent-space move is judged in real yards",
    auditTrack(diagonal, { limits: { maxSpeedYps: 10 }, yardsPerUnit: pitch }).length === 1);
  check("the same move is clean against a ceiling that allows it",
    auditTrack(diagonal, { limits: { maxSpeedYps: 20 }, yardsPerUnit: pitch }).length === 0);
}

// --- whole-set audit and determinism --------------------------------------
{
  const audit = auditMotionIntegrity({
    players: {
      zed: [{ timeMs: 0, position: { x: 0, y: 0 } }, { timeMs: 100, position: { x: 3, y: 0 } }],
      alpha: steadyRun(),
      beta: [{ timeMs: 0, position: { x: 0, y: 0 } }, { timeMs: 100, position: { x: 5, y: 0 } }],
    },
    ball: [
      { timeMs: 0, position: { x: 0, y: 0 }, state: "rolling" },
      { timeMs: 500, position: { x: 3, y: 0 }, state: "rolling" },
      { timeMs: 1000, position: { x: 3, y: 0 }, state: "rolling" },
      { timeMs: 1500, position: { x: 3, y: 0 }, state: "rolling" },
    ],
    defaultPlayerLimits: { maxSpeedYps: 10 },
    // A genuinely player-specific ceiling: beta is quick enough that the move
    // which convicts zed is legal for them.
    playerLimits: { beta: { maxSpeedYps: 60 } },
    yardsPerUnit: SQUARE,
  });
  check("the whole-set audit reports a summary", audit.ok === false && audit.summary.total >= 2);
  check("a clean player contributes nothing",
    !audit.findings.some((finding) => finding.subjectId === "alpha"));
  check("per-player limits override the default",
    !audit.findings.some((finding) => finding.subjectId === "beta"));
  check("the offending player is reported", audit.findings.some((finding) => finding.subjectId === "zed"));
  check("the ball is audited alongside the players",
    audit.findings.some((finding) => finding.kind === "ball-velocity-lost"));
  check("findings are ordered by time", audit.findings.every((finding, index) =>
    index === 0 || audit.findings[index - 1].timeMs <= finding.timeMs));
  check("the summary counts by kind", Object.keys(audit.summary.byKind).length >= 2);
  check("the summary names the worst subjects", audit.summary.worstSubjects.length >= 1);
  check("every reported kind is a declared kind",
    audit.findings.every((finding) => MOTION_FINDING_KINDS.includes(finding.kind)));

  // Object key order must not reach the output.
  const shuffled = auditMotionIntegrity({
    players: {
      beta: [{ timeMs: 0, position: { x: 0, y: 0 } }, { timeMs: 100, position: { x: 5, y: 0 } }],
      alpha: steadyRun(),
      zed: [{ timeMs: 0, position: { x: 0, y: 0 } }, { timeMs: 100, position: { x: 3, y: 0 } }],
    },
    ball: [
      { timeMs: 0, position: { x: 0, y: 0 }, state: "rolling" },
      { timeMs: 500, position: { x: 3, y: 0 }, state: "rolling" },
      { timeMs: 1000, position: { x: 3, y: 0 }, state: "rolling" },
      { timeMs: 1500, position: { x: 3, y: 0 }, state: "rolling" },
    ],
    defaultPlayerLimits: { maxSpeedYps: 10 },
    playerLimits: { beta: { maxSpeedYps: 60 } },
    yardsPerUnit: SQUARE,
  });
  check("the audit is independent of object key order",
    JSON.stringify(shuffled) === JSON.stringify(audit));

  const clean = auditMotionIntegrity({
    players: { alpha: steadyRun() }, defaultPlayerLimits: PLAYER_LIMITS, yardsPerUnit: SQUARE,
  });
  check("a clean set reports ok", clean.ok === true && clean.summary.total === 0);
  check("a clean summary has no first finding time", clean.summary.firstTimeMs === null);
  check("summarising nothing is ok", summariseFindings([]).ok === true);
  check("an empty audit does not throw", auditMotionIntegrity({}).ok === true);
}

console.log(`ALL PASS -- ${passes} motion-integrity assertions`);
