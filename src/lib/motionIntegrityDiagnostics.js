// Motion-integrity auditor for immutable player and ball tracks.
//
// Answers one question: does this recorded motion describe something a real
// body and a real ball could have done? It reads finished tracks and reports
// where they do not. It never decides what SHOULD have happened.
//
// Deliberately knows nothing about Match Lab. No engine import, no DOM, no
// global state, no RNG, and -- the constraint that matters most -- **no second
// motion solver**. This file does not integrate, predict, or correct motion;
// it differentiates what it is given and compares the result against
// thresholds the caller supplies. If it ever starts deciding how fast a player
// ought to be able to turn, it has become a competing physics model and the
// engine now has two, which is exactly the failure it exists to detect.
//
// Every threshold is therefore an explicit input. There are no default speed,
// acceleration or turn limits in this file, because inventing them here would
// silently fork playerKinetics.js.
//
// TRACK FORMAT
//
// A track is an ordered array of immutable samples:
//
//   { timeMs, position: { x, y }, height?, velocity?: { x, y }, state?, eventIndex?, action? }
//
// Positions are in whatever planar unit the caller uses; `unitsPerYard` scales
// them into yards so speeds come out in yards per second. Match Lab's playback
// tracks are percent-of-pitch, which is not square, so x and y scale
// separately -- see `yardsPerUnit`.
//
// Velocity is optional. When absent, segment velocity is derived from adjacent
// samples, which is the only derivation this file performs.

/** Every finding kind this auditor can report. */
export const MOTION_FINDING_KINDS = Object.freeze([
  "non-finite",
  "time-order",
  "position-discontinuity",
  "speed-exceeded",
  "acceleration-exceeded",
  "deceleration-exceeded",
  "impossible-turn",
  "ball-velocity-lost",
]);

/** Ball states that describe a ball genuinely in motion of its own. */
export const BALL_MOVING_STATES = Object.freeze(new Set(["rolling", "airborne"]));

const isFiniteNumber = (value) => typeof value === "number" && Number.isFinite(value);

function finitePoint(point) {
  return Boolean(point) && isFiniteNumber(point.x) && isFiniteNumber(point.y);
}

/**
 * Findings are sorted by a fixed key so two runs over the same tracks always
 * produce the same list in the same order. A diagnostic whose output order
 * drifts cannot be diffed between runs, which is most of what it is for.
 */
function sortFindings(findings) {
  return findings.slice().sort((left, right) =>
    left.timeMs - right.timeMs
    || String(left.subjectId).localeCompare(String(right.subjectId))
    || MOTION_FINDING_KINDS.indexOf(left.kind) - MOTION_FINDING_KINDS.indexOf(right.kind)
    || left.index - right.index);
}

/** Separate x/y scaling, because a percent-space pitch is not square. */
function scaleToYards(from, to, yardsPerUnit) {
  return {
    x: (to.x - from.x) * yardsPerUnit.x,
    y: (to.y - from.y) * yardsPerUnit.y,
  };
}

function magnitude(vector) {
  return Math.hypot(vector.x, vector.y);
}

/** Signed angle between two planar vectors, in degrees, 0..180. */
export function turnDegrees(before, after) {
  const beforeMagnitude = magnitude(before);
  const afterMagnitude = magnitude(after);
  if (!(beforeMagnitude > 0) || !(afterMagnitude > 0)) return 0;
  const cosine = (before.x * after.x + before.y * after.y) / (beforeMagnitude * afterMagnitude);
  return (Math.acos(Math.max(-1, Math.min(1, cosine))) * 180) / Math.PI;
}

/**
 * Per-segment kinematics, derived by differencing only.
 *
 * A segment spans two adjacent samples. `speedYps` is its mean speed, not an
 * instantaneous one: a sparse track cannot tell the difference, and claiming
 * otherwise would be inventing detail the data does not carry.
 */
export function describeSegments(samples, { yardsPerUnit }) {
  const segments = [];
  for (let index = 1; index < samples.length; index += 1) {
    const from = samples[index - 1];
    const to = samples[index];
    const elapsedMs = to.timeMs - from.timeMs;
    if (!(elapsedMs > 0) || !finitePoint(from.position) || !finitePoint(to.position)) continue;
    const displacement = scaleToYards(from.position, to.position, yardsPerUnit);
    const distanceYards = magnitude(displacement);
    const seconds = elapsedMs / 1000;
    segments.push({
      index,
      fromTimeMs: from.timeMs,
      toTimeMs: to.timeMs,
      elapsedMs,
      distanceYards,
      speedYps: distanceYards / seconds,
      direction: distanceYards > 0
        ? { x: displacement.x / distanceYards, y: displacement.y / distanceYards }
        : null,
    });
  }
  return segments;
}

function checkSampleValidity(samples, subjectId, subjectKind, findings) {
  let previousTime = -Infinity;
  samples.forEach((sample, index) => {
    const badFields = [];
    if (!isFiniteNumber(sample?.timeMs)) badFields.push("timeMs");
    if (!finitePoint(sample?.position)) badFields.push("position");
    if (sample?.height !== undefined && !isFiniteNumber(sample.height)) badFields.push("height");
    if (sample?.velocity !== undefined && sample.velocity !== null && !finitePoint(sample.velocity)) {
      badFields.push("velocity");
    }
    if (badFields.length) {
      findings.push({
        kind: "non-finite", subjectKind, subjectId, index,
        timeMs: isFiniteNumber(sample?.timeMs) ? sample.timeMs : 0,
        eventIndex: sample?.eventIndex ?? null,
        detail: `non-finite ${badFields.join(", ")}`,
        fields: badFields,
      });
      return;
    }
    // Strictly non-decreasing. Equal timestamps are legal -- two keyframes can
    // share an instant at a contact -- but time never runs backwards.
    if (sample.timeMs < previousTime) {
      findings.push({
        kind: "time-order", subjectKind, subjectId, index, timeMs: sample.timeMs,
        eventIndex: sample?.eventIndex ?? null,
        detail: `time runs backwards: ${previousTime}ms -> ${sample.timeMs}ms`,
        previousTimeMs: previousTime,
      });
    }
    previousTime = Math.max(previousTime, sample.timeMs);
  });
}

/**
 * Audit one subject's track.
 *
 * `limits` is required and explicit:
 *   { maxSpeedYps, maxAccelerationYps2, maxDecelerationYps2, maxTurnDegreesPerSecond,
 *     positionDiscontinuityYards }
 *
 * Any limit left undefined is simply not checked, which is deliberate: a
 * caller that does not know a player's real ceiling should get silence rather
 * than a fabricated default.
 */
export function auditTrack(samples, {
  subjectId = "unknown",
  subjectKind = "player",
  limits = {},
  yardsPerUnit = { x: 1, y: 1 },
} = {}) {
  const findings = [];
  const ordered = Array.isArray(samples) ? samples : [];
  checkSampleValidity(ordered, subjectId, subjectKind, findings);
  // Only well-formed samples can be differentiated. Auditing kinematics across
  // a non-finite sample would report a cascade of downstream nonsense whose
  // real cause is the one bad sample already reported above.
  const usable = ordered.filter((sample) =>
    isFiniteNumber(sample?.timeMs) && finitePoint(sample?.position));
  const segments = describeSegments(usable, { yardsPerUnit });

  segments.forEach((segment, position) => {
    const sample = usable[segment.index];
    const base = {
      subjectKind, subjectId, index: segment.index, timeMs: segment.toTimeMs,
      eventIndex: sample?.eventIndex ?? null,
    };
    if (isFiniteNumber(limits.maxSpeedYps) && segment.speedYps > limits.maxSpeedYps) {
      findings.push({
        ...base, kind: "speed-exceeded",
        detail: `${segment.speedYps.toFixed(2)} yd/s over ${segment.elapsedMs}ms exceeds ${limits.maxSpeedYps}`,
        speedYps: segment.speedYps, limit: limits.maxSpeedYps,
      });
    }
    if (position === 0) return;
    const previous = segments[position - 1];
    // Adjacent segments must actually be adjacent in time for a change
    // between them to mean anything. A gap is a discontinuity question, not
    // an acceleration one.
    const gapMs = segment.fromTimeMs - previous.toTimeMs;
    if (gapMs > 0) return;
    const seconds = (segment.elapsedMs + previous.elapsedMs) / 2000;
    if (!(seconds > 0)) return;
    const deltaSpeed = segment.speedYps - previous.speedYps;
    const rate = deltaSpeed / seconds;
    if (deltaSpeed > 0 && isFiniteNumber(limits.maxAccelerationYps2) && rate > limits.maxAccelerationYps2) {
      findings.push({
        ...base, kind: "acceleration-exceeded",
        detail: `${rate.toFixed(2)} yd/s^2 exceeds ${limits.maxAccelerationYps2}`,
        rateYps2: rate, limit: limits.maxAccelerationYps2,
      });
    }
    if (deltaSpeed < 0 && isFiniteNumber(limits.maxDecelerationYps2) && -rate > limits.maxDecelerationYps2) {
      findings.push({
        ...base, kind: "deceleration-exceeded",
        detail: `${(-rate).toFixed(2)} yd/s^2 exceeds ${limits.maxDecelerationYps2}`,
        rateYps2: -rate, limit: limits.maxDecelerationYps2,
      });
    }
    // A turn is only impossible relative to how long it took AND how fast the
    // body was going. Pivoting on the spot is free; the same angle at sprint
    // pace is not. Scaling the allowance by speed is what keeps a stationary
    // player from being reported for turning to face a new run.
    if (isFiniteNumber(limits.maxTurnDegreesPerSecond) && previous.direction && segment.direction) {
      const degrees = turnDegrees(previous.direction, segment.direction);
      const turnSeconds = (segment.elapsedMs + previous.elapsedMs) / 2000;
      const rateDegPerSecond = degrees / turnSeconds;
      const carriedSpeed = Math.min(previous.speedYps, segment.speedYps);
      const allowance = isFiniteNumber(limits.turnSpeedReferenceYps) && limits.turnSpeedReferenceYps > 0
        ? limits.maxTurnDegreesPerSecond
          * Math.max(1, limits.turnSpeedReferenceYps / Math.max(carriedSpeed, 1e-6))
        : limits.maxTurnDegreesPerSecond;
      if (rateDegPerSecond > allowance) {
        findings.push({
          ...base, kind: "impossible-turn",
          detail: `${degrees.toFixed(1)} degrees in ${Math.round(turnSeconds * 1000)}ms `
            + `(${rateDegPerSecond.toFixed(0)} deg/s) at ${carriedSpeed.toFixed(2)} yd/s exceeds ${allowance.toFixed(0)} deg/s`,
          turnDegrees: degrees, rateDegPerSecond, carriedSpeedYps: carriedSpeed, limit: allowance,
        });
      }
    }
  });

  // Position discontinuity is checked on RAW adjacency, including across
  // equal-time samples, because a teleport that happens to be recorded at one
  // instant is still a teleport.
  if (isFiniteNumber(limits.positionDiscontinuityYards)) {
    for (let index = 1; index < usable.length; index += 1) {
      const from = usable[index - 1];
      const to = usable[index];
      if (to.timeMs - from.timeMs > 0) continue;
      const jump = magnitude(scaleToYards(from.position, to.position, yardsPerUnit));
      if (jump > limits.positionDiscontinuityYards) {
        findings.push({
          kind: "position-discontinuity", subjectKind, subjectId, index, timeMs: to.timeMs,
          eventIndex: to?.eventIndex ?? null,
          detail: `${jump.toFixed(3)} yards with no elapsed time`,
          jumpYards: jump, limit: limits.positionDiscontinuityYards,
        });
      }
    }
  }
  return sortFindings(findings);
}

/**
 * Audit a ball track, including the rule a player track has no equivalent of:
 * a moving ball does not simply stop.
 *
 * A rolling or airborne ball losing all of its velocity is only legal where
 * something took it away. `sanctionedStopTimesMs` is that list -- contacts,
 * boundary crossings, bounces and explicit stops -- supplied by the caller,
 * because only the caller knows what happened. `stopToleranceMs` is how close
 * to one of those the stop must be.
 */
export function auditBallTrack(samples, {
  subjectId = "ball",
  limits = {},
  yardsPerUnit = { x: 1, y: 1 },
  sanctionedStopTimesMs = [],
  stopToleranceMs = 0,
  movingStates = BALL_MOVING_STATES,
} = {}) {
  const findings = auditTrack(samples, { subjectId, subjectKind: "ball", limits, yardsPerUnit });
  const ordered = (Array.isArray(samples) ? samples : []).filter((sample) =>
    isFiniteNumber(sample?.timeMs) && finitePoint(sample?.position));
  const sanctioned = sanctionedStopTimesMs.filter(isFiniteNumber);
  const segments = describeSegments(ordered, { yardsPerUnit });
  const speedAt = new Map(segments.map((segment) => [segment.index, segment.speedYps]));

  for (let index = 1; index < ordered.length; index += 1) {
    const previousSpeed = speedAt.get(index);
    const nextSpeed = speedAt.get(index + 1);
    // "Was moving, then is not." A final sample has no following segment and
    // cannot be judged -- the track simply ended.
    if (!isFiniteNumber(previousSpeed) || !isFiniteNumber(nextSpeed)) continue;
    if (!(previousSpeed > 0) || nextSpeed > 0) continue;
    const sample = ordered[index];
    const state = sample?.state ?? ordered[index - 1]?.state;
    if (!movingStates.has(state)) continue;
    const stopTimeMs = sample.timeMs;
    if (sanctioned.some((time) => Math.abs(time - stopTimeMs) <= stopToleranceMs)) continue;
    findings.push({
      kind: "ball-velocity-lost", subjectKind: "ball", subjectId, index, timeMs: stopTimeMs,
      eventIndex: sample?.eventIndex ?? null,
      detail: `${state} ball at ${previousSpeed.toFixed(2)} yd/s stops with no contact, bounce, boundary or explicit stop within ${stopToleranceMs}ms`,
      state, priorSpeedYps: previousSpeed,
    });
  }
  return sortFindings(findings);
}

/**
 * Audit a whole set of tracks at once.
 *
 * `players` is `{ [id]: samples }` with per-id limits in `playerLimits`, which
 * is what makes the speed ceiling genuinely player-specific rather than one
 * squad-wide guess.
 */
export function auditMotionIntegrity({
  players = {},
  ball = null,
  playerLimits = {},
  defaultPlayerLimits = {},
  ballLimits = {},
  yardsPerUnit = { x: 1, y: 1 },
  sanctionedStopTimesMs = [],
  stopToleranceMs = 0,
} = {}) {
  const findings = [];
  // Sorted ids so the pre-sort order never depends on object insertion order.
  for (const id of Object.keys(players).sort()) {
    findings.push(...auditTrack(players[id], {
      subjectId: id,
      subjectKind: "player",
      limits: { ...defaultPlayerLimits, ...(playerLimits[id] ?? {}) },
      yardsPerUnit,
    }));
  }
  if (ball) {
    findings.push(...auditBallTrack(ball, {
      limits: ballLimits, yardsPerUnit, sanctionedStopTimesMs, stopToleranceMs,
    }));
  }
  return summariseFindings(sortFindings(findings));
}

/** Structured findings plus a concise, stable summary. */
export function summariseFindings(findings) {
  const byKind = {};
  const bySubject = {};
  for (const finding of findings) {
    byKind[finding.kind] = (byKind[finding.kind] || 0) + 1;
    bySubject[finding.subjectId] = (bySubject[finding.subjectId] || 0) + 1;
  }
  return {
    ok: findings.length === 0,
    findings,
    summary: {
      total: findings.length,
      byKind,
      // Sorted by count then id so the worst offender is first and ties are
      // still deterministic.
      worstSubjects: Object.entries(bySubject)
        .sort((left, right) => right[1] - left[1] || String(left[0]).localeCompare(String(right[0])))
        .slice(0, 5)
        .map(([subjectId, count]) => ({ subjectId, count })),
      firstTimeMs: findings.length ? findings[0].timeMs : null,
    },
  };
}
