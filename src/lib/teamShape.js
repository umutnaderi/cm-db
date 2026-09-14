// Team Shape & Phase Intelligence v1 -- coordinated, DOM-free team plans.
//
// Formation anchors are references. This module translates them with the
// ball, phase, tactical role and duty, then reserves complementary team jobs
// before any player is moved. It does not know about animation and never
// writes a roster position: callers must feed its intention targets through
// worldMotion.js.

import { roleBand } from "./formationTemplates.js";
import {
  PITCH_LENGTH_YARDS, PITCH_WIDTH_YARDS, fromYardPoint, toYardPoint, yardDistance,
} from "./pitchGeometry.js";
import {
  classifyTacticalRegion, laneForX, VERTICAL_LANES,
} from "./pitchRegions.js";
import {
  normalizeTeamAttacking, normalizeTeamDefending, normalizeTeamTransition,
  teamHeightTargetYards,
} from "./teamInstructions.js";

// Backward-compatible ownership: pitchRegions.js is now the single source of
// truth, while existing teamShape consumers keep their original imports.
export { laneForX, VERTICAL_LANES } from "./pitchRegions.js";

const DUTY_DEPTH_YARDS = Object.freeze({ defend: -2.5, support: 0, attack: 4.5 });
const PHASE_BAND_DEPTH_YARDS = Object.freeze({
  restart: { GK: 0, D: 0, M: 0, F: 0 },
  "restart-release": { GK: 0, D: -1, M: 0.5, F: 2 },
  "build-up": { GK: 1.5, D: 0, M: -1, F: 1 },
  progression: { GK: 2.5, D: 3, M: 4, F: 5 },
  "final-third": { GK: 4, D: 7, M: 9, F: 11 },
  "attacking-transition": { GK: 2, D: 2, M: 5, F: 8 },
  "defensive-transition": { GK: 0, D: -2, M: -4, F: -3 },
  "defensive-block": { GK: 0, D: -3, M: -4, F: -5 },
});
const PHASE_VERTICAL_COMPRESSION = Object.freeze({
  restart: 0.72,
  "restart-release": 0.70,
  "build-up": 0.68,
  progression: 0.64,
  "final-third": 0.60,
  "attacking-transition": 0.64,
  "defensive-transition": 0.58,
  "defensive-block": 0.50,
});

const SPECIAL_BASE_ACTIONS = new Set([
  "recover-onside", "run-in-behind", "recover", "cover-shadow",
  "arc-overlap", "run-off-pass", "attack-spot", "attack-near",
  "attack-far", "edge-rebound", "check-away", "in-behind",
]);

function isSpecialBaseAction(action) {
  return SPECIAL_BASE_ACTIONS.has(action) || String(action || "").startsWith("coordinate-");
}

const REST_DEFENCE_JOBS = new Set([
  "rest-defence", "defensive-line-holder", "cover-defender", "passing-lane-screen",
]);

const REGION_RUN_JOB = /(run|overlap|attack|support|width|outlet|press|recover)/;

function clamp(minimum, maximum, value) {
  return Math.max(minimum, Math.min(maximum, value));
}

function clonePoint(point) {
  return { x: Number(point?.x) || 0, y: Number(point?.y) || 0, zone: point?.zone ?? null };
}

function candidateId(entry) {
  return String(entry?.id ?? "");
}

function stableSort(entries, score) {
  return entries.slice().sort((left, right) => {
    const delta = score(left) - score(right);
    return Math.abs(delta) > 1e-9 ? delta : candidateId(left).localeCompare(candidateId(right));
  });
}

function forwardSign(attackingDirection) {
  return attackingDirection === "up" ? -1 : 1;
}

function anchorOf(entry) {
  return clonePoint(entry?.formationAnchor ?? entry);
}

/**
 * Optional CM01/02-style WIB/WOB anchors remain part of the same shape
 * model. A zoned or broad authored anchor makes that phase position Manual:
 * it replaces the formation/role/duty target for that ball area, while live
 * team instructions and temporary team jobs can still react around it. An
 * unset phase anchor inherits the formation role and duty.
 */
function ballZoneFor(point) {
  const column = Math.max(0, Math.min(2, Math.floor((Number(point?.x) || 0) / (100 / 3))));
  const row = Math.max(0, Math.min(3, Math.floor((Number(point?.y) || 0) / 25)));
  return row * 3 + column;
}

export function phaseAnchorSelectionFor(entry, {
  inPossession = false, phase = "progression", ballPoint = null,
} = {}) {
  const zone = String(ballZoneFor(ballPoint ?? entry));
  const zonedAnchors = inPossession
    ? (entry?.withBallAnchors ?? entry?.withBallPositions)
    : (entry?.withoutBallAnchors ?? entry?.withoutBallPositions);
  const broadAnchor = inPossession
    ? (entry?.withBallAnchor ?? entry?.withBallPosition)
    : (entry?.withoutBallAnchor ?? entry?.withoutBallPosition);
  const zoned = zonedAnchors?.[zone];
  const authored = phase === "restart" ? null : (zoned ?? broadAnchor);
  return {
    point: clonePoint(authored ?? entry?.formationAnchor ?? entry),
    manual: Boolean(authored),
    source: zoned ? "zone" : authored ? "phase" : "formation",
    zone: Number(zone),
  };
}

export function phaseAnchorFor(entry, context = {}) {
  return phaseAnchorSelectionFor(entry, context).point;
}

function bandOf(entry) {
  if (entry?.role === "keeper") return "GK";
  return roleBand(entry?.positionalSlot ?? "MC");
}

function pointWithYardOffset(point, lateralYards, forwardYards, attackingDirection) {
  const yard = toYardPoint(point);
  return fromYardPoint({
    x: clamp(3, PITCH_WIDTH_YARDS - 3, yard.x + lateralYards),
    y: clamp(2.4, PITCH_LENGTH_YARDS - 2.4, yard.y + forwardSign(attackingDirection) * forwardYards),
  });
}

function blendPoint(left, right, rightWeight) {
  const weight = clamp(0, 1, rightWeight);
  return {
    x: left.x * (1 - weight) + right.x * weight,
    y: left.y * (1 - weight) + right.y * weight,
    zone: right.zone ?? left.zone ?? null,
  };
}

function roleOffsets(entry) {
  const role = entry.tacticalRole ?? (entry.role === "keeper" ? "goalkeeper" : null);
  const anchor = anchorOf(entry);
  const outward = anchor.x < 50 ? -1 : anchor.x > 50 ? 1 : 0;
  switch (role) {
    case "central-defender": return { x: outward * 1.5, y: 0 };
    case "ball-playing-defender": return { x: outward * 3, y: 1.5 };
    case "no-nonsense-centre-back": return { x: outward, y: -1 };
    case "stopper": return { x: 0, y: 3 };
    case "covering-defender": return { x: 0, y: -3 };
    case "sweeper": return { x: 0, y: -2 };
    case "libero": return { x: 0, y: 4 };
    case "full-back": return { x: outward * 4, y: 1 };
    case "wing-back": return { x: outward * 5, y: 6 };
    case "complete-wing-back": return { x: outward * 7, y: 7 };
    case "inverted-full-back": return { x: outward * -4, y: 1 };
    case "inverted-wing-back": return { x: outward * -5, y: 5 };
    case "playmaking-wing-back": return { x: outward * -3, y: 4 };
    case "no-nonsense-full-back": return { x: outward * 4, y: -1 };
    case "defensive-wing-back": return { x: outward * 5, y: -1 };
    case "defensive-midfielder": return { x: 0, y: -2 };
    case "ball-winning-midfielder": return { x: 0, y: 2 };
    case "anchor": return { x: 0, y: -5 };
    case "half-back": return { x: 0, y: -7 };
    case "deep-lying-playmaker": return { x: outward * 1.5, y: -3 };
    case "regista": return { x: outward * 2, y: 1 };
    case "segundo-volante": return { x: outward * 2, y: 6 };
    case "central-midfielder": return { x: 0, y: 0 };
    case "box-to-box": return { x: 0, y: 1.5 };
    case "advanced-playmaker": return { x: outward * 1.5, y: 5 };
    case "roaming-playmaker": return { x: outward * 2, y: 3 };
    case "mezzala": return { x: outward * 5, y: 3 };
    case "carrilero": return { x: outward * 5, y: 0 };
    case "half-winger": return { x: outward * 7, y: 2 };
    case "wide-midfielder": return { x: outward * 5, y: 0 };
    case "winger": return { x: outward * 7, y: 2 };
    case "inverted-winger": return { x: outward * -4, y: 4 };
    case "wide-playmaker": return { x: outward * -3, y: 2 };
    case "defensive-winger": return { x: outward * 6, y: -2 };
    case "wide-target-player": return { x: outward * 5, y: 2 };
    case "attacking-midfielder": return { x: 0, y: 4 };
    case "trequartista": return { x: 0, y: 4 };
    case "enganche": return { x: 0, y: 1 };
    case "shadow-striker": return { x: 0, y: 8 };
    case "second-striker": return { x: 0, y: 7 };
    case "classic-ten": return { x: 0, y: 3 };
    case "inside-forward": return { x: outward * -5, y: 5 };
    case "raumdeuter": return { x: outward * -3, y: 7 };
    case "wide-forward": return { x: outward * 5, y: 6 };
    case "advanced-forward": return { x: (50 - anchor.x) * (PITCH_WIDTH_YARDS / 100) * 0.45, y: 7 };
    case "complete-forward": return { x: (50 - anchor.x) * (PITCH_WIDTH_YARDS / 100) * 0.25, y: 3 };
    case "deep-lying-forward": return { x: (50 - anchor.x) * (PITCH_WIDTH_YARDS / 100) * 0.3, y: -5 };
    case "target-forward": return { x: (50 - anchor.x) * (PITCH_WIDTH_YARDS / 100) * 0.35, y: 3 };
    case "pressing-forward": return { x: (50 - anchor.x) * (PITCH_WIDTH_YARDS / 100) * 0.3, y: 4 };
    case "channel-forward": return { x: outward * 6, y: 5 };
    case "target-man": return { x: (50 - anchor.x) * (PITCH_WIDTH_YARDS / 100) * 0.35, y: 3 };
    case "poacher": return { x: (50 - anchor.x) * (PITCH_WIDTH_YARDS / 100) * 0.55, y: 6 };
    case "false-nine": return { x: (50 - anchor.x) * (PITCH_WIDTH_YARDS / 100) * 0.35, y: -7 };
    case "ball-playing-goalkeeper": return { x: 0, y: 2.5 };
    case "line-holding-goalkeeper": return { x: 0, y: -1 };
    case "no-nonsense-goalkeeper": return { x: 0, y: 0 };
    case "sweeper-keeper": return { x: 0, y: 5 };
    default: return { x: 0, y: 0 };
  }
}

// Per-band ball tracking. The goalkeeper barely tracks at all here because
// keeperPositioningPoint() owns his depth; this only keeps his shape reference
// from drifting away from the ball entirely.
const BALL_TRACKING = Object.freeze({
  GK: Object.freeze({ lateral: 0.10, vertical: 0.10 }),
  // Chosen to sit UNDER the clamp at full pitch length, or the bands could
  // not differentiate: at 0.52 and 0.44 both the back line and the midfield
  // pinned to the same clamped twenty yards and slid identically.
  D: Object.freeze({ lateral: 0.30, vertical: 0.40 }),
  M: Object.freeze({ lateral: 0.34, vertical: 0.32 }),
  F: Object.freeze({ lateral: 0.26, vertical: 0.22 }),
});
const BALL_TRACKING_MAX_LATERAL_YARDS = 10;
const BALL_TRACKING_MAX_VERTICAL_YARDS = 20;

/** Formation-relative target before any temporary active job is overlaid. */
export function phaseAdjustedShapeTarget(entry, {
  ballPoint, attackingDirection, phase = "progression", inPossession = false,
} = {}) {
  const anchor = anchorOf(entry);
  // A WIB/WOB drag is the manager's complete position instruction for this
  // phase and ball area. Do not silently reapply the formation compression,
  // tactical role or duty that the manual point replaced.
  if (entry?.manualPhasePosition) return anchor;
  const anchorYards = toYardPoint(anchor);
  const ballYards = toYardPoint(ballPoint ?? anchor);
  const band = bandOf(entry);
  const defensivePhase = phase === "defensive-block" || phase === "defensive-transition";
  // Ball tracking (2026-09-14) -- how strongly a player's shape target follows
  // the ball up and across the pitch.
  //
  // Reported as "players freeze except the ball chaser" and measured:
  // continuous stillness of two seconds or more happened at a mean 37 yards
  // from the ball and clustered on the back line. The decisive number was that
  // during those freezes a player sat 0.89 yards from their own assigned
  // target -- against 0.87 during a brief pause. They were not stuck. They were
  // standing still because they were already where the engine wanted them.
  //
  // The cause was here. Vertical tracking was a flat 0.12 clamped to nine
  // yards, so a ball travelling twenty yards up the pitch moved a defender's
  // target by 2.4, and no ball position anywhere could move it more than nine.
  // A real back four tracks the ball's vertical movement close to one-for-one
  // in open play -- that is what holding a line relative to the ball means --
  // and a side whose block cannot slide further than nine yards is not a block.
  //
  // Now per band and per phase, because the units genuinely differ: a back line
  // slides hardest, forwards hold their height most, and a side in possession
  // is occupying space rather than sliding with the ball.
  const bandTracking = BALL_TRACKING[band] ?? BALL_TRACKING.M;
  const phaseScale = defensivePhase ? 1.15 : (inPossession ? 0.85 : 1);
  const lateralShift = clamp(
    -BALL_TRACKING_MAX_LATERAL_YARDS, BALL_TRACKING_MAX_LATERAL_YARDS,
    (ballYards.x - PITCH_WIDTH_YARDS / 2) * bandTracking.lateral * phaseScale,
  );
  const verticalShift = clamp(
    -BALL_TRACKING_MAX_VERTICAL_YARDS, BALL_TRACKING_MAX_VERTICAL_YARDS,
    (ballYards.y - PITCH_LENGTH_YARDS / 2) * bandTracking.vertical * phaseScale,
  );
  const phaseDepth = PHASE_BAND_DEPTH_YARDS[phase]?.[band] ?? 0;
  const role = roleOffsets(entry);
  const dutyDepth = band === "GK" ? 0 : (DUTY_DEPTH_YARDS[entry.duty] ?? 0);
  const possessionDepth = inPossession && band !== "GK" ? 0.75 : 0;
  const sign = forwardSign(attackingDirection);
  // Formation templates preserve relative line order, but their full-pitch
  // board spread is too long to be a coherent live block. Compress around
  // midfield by phase before applying the ball/role/duty shifts: defensive
  // blocks become the tightest, while release/build-up retain more depth.
  // Goalkeepers keep their authored goal reference and use their own role
  // positioning rather than being pulled toward midfield with the outfield.
  const compression = band === "GK" ? 1 : (PHASE_VERTICAL_COMPRESSION[phase] ?? 0.66);
  const compressedAnchorY = band === "GK"
    ? anchorYards.y
    : PITCH_LENGTH_YARDS / 2 + (anchorYards.y - PITCH_LENGTH_YARDS / 2) * compression;
  return fromYardPoint({
    x: clamp(3, PITCH_WIDTH_YARDS - 3, anchorYards.x + lateralShift + role.x),
    y: clamp(
      2.4,
      PITCH_LENGTH_YARDS - 2.4,
      compressedAnchorY + verticalShift + sign * (phaseDepth + role.y + dutyDepth + possessionDepth),
    ),
  });
}

/**
 * Converts the manager's team instructions into a second, bounded movement
 * layer on top of the role/formation target. It is intentionally geometric:
 * width changes horizontal occupation, line settings move the appropriate
 * units, and transition choices only fire during their named phase.
 */
export function applyTeamShapeInstructions(target, entry, {
  ballPoint, attackingDirection, phase, inPossession, teamJob = "shape-balance",
  attacking = null, transition = null, defending = null, oppositionOwner = null,
} = {}) {
  const attack = normalizeTeamAttacking(attacking ?? {});
  const changeover = normalizeTeamTransition(transition ?? {});
  const defend = normalizeTeamDefending(defending ?? {});
  const band = bandOf(entry);
  let adjusted = clonePoint(target);

  if (inPossession) {
    if (band !== "GK") {
      const mentalityDepth = {
        defensive: -4.5, cautious: -2.25, balanced: 0, positive: 2.5, attacking: 5,
      }[attack.mentality];
      adjusted = pointWithYardOffset(adjusted, 0, mentalityDepth, attackingDirection);
    }
    if (band !== "GK" && attack.width !== "balanced") {
      const yards = toYardPoint(adjusted);
      const widthFactor = attack.width === "wide" ? 1.16 : 0.82;
      adjusted = fromYardPoint({
        x: clamp(3, PITCH_WIDTH_YARDS - 3, PITCH_WIDTH_YARDS / 2 + (yards.x - PITCH_WIDTH_YARDS / 2) * widthFactor),
        y: yards.y,
      });
    }
    if (phase === "attacking-transition" && band !== "GK") {
      const gainDepth = { "hold-shape": -2.5, balanced: 0, counter: 5 }[changeover.onGain];
      adjusted = pointWithYardOffset(adjusted, 0, gainDepth, attackingDirection);
    }
  } else {
    if (band === "D") {
      const lineDepth = { deep: -5, standard: 0, high: 5 }[defend.defensiveLine]
        + (defend.offsideTrap ? 3 : 0);
      adjusted = pointWithYardOffset(adjusted, 0, lineDepth, attackingDirection);
    }
    if (band === "M" || band === "F") {
      const engagementDepth = { low: -4, standard: 0, high: 4 }[defend.engagementLine];
      adjusted = pointWithYardOffset(adjusted, 0, engagementDepth, attackingDirection);
    }
    if (phase === "defensive-transition" && band !== "GK") {
      const lossDepth = { regroup: -5, balanced: 0, "counter-press": 3.5 }[changeover.onLoss];
      adjusted = pointWithYardOffset(adjusted, 0, lossDepth, attackingDirection);
      if (changeover.onLoss === "counter-press") adjusted = blendPoint(adjusted, ballPoint, 0.12);
    }
    const opposingKeeperHasBall = oppositionOwner?.role === "keeper"
      || String(oppositionOwner?.positionalSlot ?? "").toUpperCase() === "GK";
    if (defend.preventShortGk && opposingKeeperHasBall && (band === "M" || band === "F")) {
      adjusted = pointWithYardOffset(adjusted, 0, band === "F" ? 7 : 3.5, attackingDirection);
      adjusted = blendPoint(adjusted, ballPoint, band === "F" ? 0.14 : 0.07);
    }
    if (defend.pressingTrap !== "none" && band !== "GK") {
      const yards = toYardPoint(adjusted);
      const lateral = defend.pressingTrap === "inside"
        ? (PITCH_WIDTH_YARDS / 2 - yards.x) * 0.10
        : (yards.x < PITCH_WIDTH_YARDS / 2 ? -2.2 : 2.2);
      adjusted = fromYardPoint({
        x: clamp(3, PITCH_WIDTH_YARDS - 3, yards.x + lateral),
        y: yards.y,
      });
    }
    const ballWide = Number(ballPoint?.x) < 24 || Number(ballPoint?.x) > 76;
    if (ballWide && band === "D" && defend.crossEngagement !== "normal") {
      adjusted = defend.crossEngagement === "stop"
        ? blendPoint(adjusted, ballPoint, 0.16)
        : blendPoint(adjusted, { x: 50, y: adjusted.y }, 0.12);
    }
  }

  if (teamJob === "primary-presser") {
    if (defend.pressing === "high") adjusted = blendPoint(adjusted, ballPoint, 0.30);
    if (defend.pressing === "low") adjusted = pointWithYardOffset(adjusted, 0, -3, attackingDirection);
  }
  return adjusted;
}

function jobCandidateScore(entry, job, ballPoint, previousJobs) {
  const anchor = anchorOf(entry);
  const band = bandOf(entry);
  const role = entry.tacticalRole ?? "";
  const sticky = previousJobs?.[entry.id] === job ? -5 : 0;
  let roleFit = 0;
  if (job === "pivot-recycle") roleFit = [
    "anchor", "half-back", "defensive-midfielder", "deep-lying-playmaker",
    "regista", "ball-playing-defender", "libero",
  ].includes(role) ? -7 : 0;
  if (job.startsWith("width")) roleFit = [
    "winger", "wing-back", "complete-wing-back", "full-back",
    "wide-midfielder", "wide-forward", "wide-target-player",
  ].includes(role) ? -6 : 0;
  if (job === "line-pinner" || job === "aerial-target") roleFit = [
    "target-man", "target-forward", "poacher", "advanced-forward",
    "complete-forward", "pressing-forward",
  ].includes(role) || band === "F" ? -6 : 0;
  if (job === "depth-runner") roleFit = entry.duty === "attack" || [
    "inside-forward", "raumdeuter", "shadow-striker", "second-striker",
    "advanced-forward", "wing-back", "complete-wing-back", "box-to-box",
    "segundo-volante",
  ].includes(role) ? -5 : 0;
  if (job === "rest-defence") roleFit = band === "D" || entry.duty === "defend" ? -7 : 2;
  if (job === "passing-lane-screen") roleFit = [
    "anchor", "half-back", "defensive-midfielder", "ball-winning-midfielder",
    "deep-lying-playmaker",
  ].includes(role) || band === "M" ? -6 : 1;
  return yardDistance(entry, ballPoint) * 0.15 + Math.abs(anchor.x - 50) * 0.01 + roleFit + sticky;
}

function makeClaimer(entries, previousJobs) {
  const claimed = new Set();
  const jobs = new Map();
  const claim = (job, candidates, score, count = 1) => {
    const available = candidates.filter((entry) => !claimed.has(entry.id));
    const winners = stableSort(available, (entry) => score(entry) + (previousJobs?.[entry.id] === job ? -5 : 0)).slice(0, count);
    for (const winner of winners) {
      claimed.add(winner.id);
      jobs.set(winner.id, job);
    }
    return winners;
  };
  return { claimed, jobs, claim };
}

function possessionJobs(entries, { ownerId, ballPoint, attackingDirection, previousJobs, style }) {
  const owner = entries.find((entry) => String(entry.id) === String(ownerId)) ?? null;
  const keepers = entries.filter((entry) => bandOf(entry) === "GK");
  const outfield = entries.filter((entry) => bandOf(entry) !== "GK" && entry !== owner);
  const { claimed, jobs, claim } = makeClaimer(entries, previousJobs);
  if (owner) { claimed.add(owner.id); jobs.set(owner.id, "ball-owner"); }
  claim("goalkeeper-outlet", keepers, (entry) => jobCandidateScore(entry, "goalkeeper-outlet", ballPoint, previousJobs));

  const defenders = outfield.filter((entry) => bandOf(entry) === "D");
  claim("rest-defence", defenders, (entry) => jobCandidateScore(entry, "rest-defence", ballPoint, previousJobs), Math.min(2, defenders.length));

  if (style === "direct" || style === "long-ball") {
    const target = claim("aerial-target", outfield, (entry) =>
      jobCandidateScore(entry, "aerial-target", ballPoint, previousJobs)
      - (forwardSign(attackingDirection) * entry.y) * 0.12)[0];
    claim("second-ball", outfield, (entry) => yardDistance(entry, target ?? ballPoint) + jobCandidateScore(entry, "second-ball", ballPoint, previousJobs));
  }

  const left = outfield.filter((entry) => anchorOf(entry).x < 50);
  const right = outfield.filter((entry) => anchorOf(entry).x >= 50);
  claim(style === "wing" ? "wide-outlet-left" : "width-left", left,
    (entry) => anchorOf(entry).x + jobCandidateScore(entry, "width-left", ballPoint, previousJobs));
  claim(style === "wing" ? "wide-outlet-right" : "width-right", right,
    (entry) => -anchorOf(entry).x + jobCandidateScore(entry, "width-right", ballPoint, previousJobs));

  claim("pivot-recycle", outfield, (entry) => jobCandidateScore(entry, "pivot-recycle", ballPoint, previousJobs));
  claim("first-support", outfield, (entry) => yardDistance(entry, ballPoint) + jobCandidateScore(entry, "first-support", ballPoint, previousJobs));
  claim("second-support", outfield, (entry) => yardDistance(entry, ballPoint) + jobCandidateScore(entry, "second-support", ballPoint, previousJobs));
  claim("line-pinner", outfield, (entry) =>
    jobCandidateScore(entry, "line-pinner", ballPoint, previousJobs)
    - forwardSign(attackingDirection) * entry.y * 0.1);
  claim("depth-runner", outfield, (entry) => jobCandidateScore(entry, "depth-runner", ballPoint, previousJobs));
  for (const entry of entries) if (!claimed.has(entry.id)) jobs.set(entry.id, "shape-balance");
  return jobs;
}

function defendingJobs(entries, { ballPoint, attackingDirection, previousJobs }) {
  const keepers = entries.filter((entry) => bandOf(entry) === "GK");
  const outfield = entries.filter((entry) => bandOf(entry) !== "GK");
  const { claimed, jobs, claim } = makeClaimer(entries, previousJobs);
  claim("keeper-cover", keepers, (entry) => yardDistance(entry, ballPoint));
  const presser = claim("primary-presser", outfield, (entry) =>
    yardDistance(entry, ballPoint) + (bandOf(entry) === "D" ? 2.5 : 0))[0] ?? null;
  const ownGoal = pointWithYardOffset(ballPoint, 0, -PITCH_LENGTH_YARDS, attackingDirection);
  claim("cover-defender", outfield, (entry) =>
    yardDistance(entry, ballPoint) + yardDistance(entry, ownGoal) * 0.08
    + (presser && entry.id === presser.id ? 1000 : 0));
  const defenders = outfield.filter((entry) => bandOf(entry) === "D");
  claim("defensive-line-holder", defenders, (entry) =>
    jobCandidateScore(entry, "defensive-line-holder", ballPoint, previousJobs), Math.min(3, defenders.length));
  const midfielders = outfield.filter((entry) => bandOf(entry) === "M");
  claim("passing-lane-screen", midfielders, (entry) =>
    jobCandidateScore(entry, "passing-lane-screen", ballPoint, previousJobs), Math.min(2, midfielders.length));
  claim("far-side-balance", outfield, (entry) => -Math.abs(entry.x - ballPoint.x));
  const forwards = outfield.filter((entry) => bandOf(entry) === "F");
  claim("recovery-outlet", forwards, (entry) => yardDistance(entry, ballPoint));
  for (const entry of entries) if (!claimed.has(entry.id)) jobs.set(entry.id, "compact-block");
  return jobs;
}

function teamJobTarget(entry, job, shapeTarget, { ballPoint, attackingDirection }) {
  const anchor = anchorOf(entry);
  const side = anchor.x < 50 ? -1 : 1;
  switch (job) {
    case "first-support":
      return blendPoint(shapeTarget, pointWithYardOffset(ballPoint, side * 6, -8, attackingDirection), 0.68);
    case "second-support":
      return blendPoint(shapeTarget, pointWithYardOffset(ballPoint, side * -8, 10, attackingDirection), 0.62);
    case "pivot-recycle":
      return blendPoint(shapeTarget, pointWithYardOffset(ballPoint, side * 4, -12, attackingDirection), 0.55);
    case "width-left":
    case "wide-outlet-left":
      return { ...shapeTarget, x: Math.min(shapeTarget.x, 8) };
    case "width-right":
    case "wide-outlet-right":
      return { ...shapeTarget, x: Math.max(shapeTarget.x, 92) };
    case "depth-runner": return pointWithYardOffset(shapeTarget, 0, 8, attackingDirection);
    case "line-pinner": return pointWithYardOffset(shapeTarget, 0, 4, attackingDirection);
    case "aerial-target": return pointWithYardOffset(shapeTarget, 0, 5, attackingDirection);
    case "second-ball": return blendPoint(shapeTarget, pointWithYardOffset(ballPoint, side * 5, -8, attackingDirection), 0.6);
    case "primary-presser": return pointWithYardOffset(ballPoint, 0, -1.5, attackingDirection);
    case "cover-defender": return pointWithYardOffset(ballPoint, side * 4, -7, attackingDirection);
    case "passing-lane-screen": return blendPoint(shapeTarget, pointWithYardOffset(ballPoint, side * 5, -12, attackingDirection), 0.5);
    case "recovery-outlet": return pointWithYardOffset(shapeTarget, 0, 2, attackingDirection);
    default: return shapeTarget;
  }
}

function applyBasePlan(target, basePlan, marking) {
  if (!basePlan?.intentionTarget) return target;
  if (basePlan.action === "coordinate-loose-ball-claimant") return clonePoint(basePlan.intentionTarget);
  if (["coordinate-defensive-line-controller", "coordinate-defensive-line-member"].includes(basePlan.action)) {
    const blended = blendPoint(target, basePlan.intentionTarget, 0.68);
    return { ...blended, y: basePlan.intentionTarget.y };
  }
  if (isSpecialBaseAction(basePlan.action)) return blendPoint(target, basePlan.intentionTarget, 0.68);
  if (basePlan.action === "mark" && marking?.scheme === "man") {
    const strictness = clamp(1, 5, Number(marking.strictness ?? marking.tightness) || 3);
    return blendPoint(target, basePlan.intentionTarget, 0.18 + strictness * 0.07);
  }
  return target;
}

function separateTargets(assignments, minimumYards = 4.25) {
  const ordered = assignments.slice().sort((left, right) => {
    const priority = (entry) => entry.teamJob === "ball-owner" ? 0
      : entry.teamJob === "primary-presser" ? 1
        : entry.teamJob.includes("support") ? 2
          : entry.teamJob.startsWith("width") || entry.teamJob.startsWith("wide-outlet") ? 3 : 4;
    return priority(left) - priority(right) || candidateId(left).localeCompare(candidateId(right));
  });
  const placed = [];
  for (const assignment of ordered) {
    let point = clonePoint(assignment.intentionTarget);
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const collision = placed.find((other) => yardDistance(point, other.intentionTarget) < minimumYards);
      if (!collision) break;
      const sign = anchorOf(assignment.entry).x < anchorOf(collision.entry).x ? -1 : 1;
      point = pointWithYardOffset(point, sign * (minimumYards * 0.75), attempt % 2 ? -1.5 : 1.5, assignment.attackingDirection);
    }
    assignment.intentionTarget = point;
    assignment.occupiedLane = laneForX(point.x);
    placed.push(assignment);
  }
  return assignments;
}

// Adds a region lens only after target separation has finished. This reads
// the already-decided coordinates; it never changes a target or roster entry.
// Occupancy is team-relative and based on intended regions, which makes a run
// toward an already claimed cell explicit without forcing anybody to its
// centre or changing the separation behavior above.
function annotateTacticalRegions(assignments) {
  const occupancy = new Map();
  for (const assignment of assignments) {
    assignment.currentRegion = classifyTacticalRegion(
      assignment.entry, assignment.attackingDirection,
    );
    assignment.shapeRegion = classifyTacticalRegion(
      assignment.shapeTarget, assignment.attackingDirection,
    );
    assignment.intendedRegion = classifyTacticalRegion(
      assignment.intentionTarget, assignment.attackingDirection,
    );
    assignment.occupiedLane = assignment.intendedRegion.lane;
    assignment.occupiedDepthBand = assignment.intendedRegion.depthBand;
    occupancy.set(
      assignment.intendedRegion.id,
      (occupancy.get(assignment.intendedRegion.id) || 0) + 1,
    );
  }
  for (const assignment of assignments) {
    const movedRegion = assignment.currentRegion.id !== assignment.intendedRegion.id;
    const count = occupancy.get(assignment.intendedRegion.id) || 0;
    const regionRun = REGION_RUN_JOB.test(
      `${assignment.teamJob} ${assignment.intentionAction}`,
    );
    assignment.targetRegionOccupancy = count;
    assignment.regionMove = movedRegion ? (count > 1 ? "occupied" : "open") : "held";
    assignment.movesIntoOccupiedRegion = movedRegion && count > 1;
    assignment.movesIntoOpenRegion = movedRegion && count === 1;
    assignment.runIntoOccupiedRegion = regionRun && assignment.movesIntoOccupiedRegion;
    assignment.runIntoOpenRegion = regionRun && assignment.movesIntoOpenRegion;
  }
  return assignments;
}

/**
 * One deterministic assignment pass for a whole team.
 *
 * `basePlans` are the existing duel/offside-aware local proposals. Special
 * active jobs may leave the formation temporarily; ordinary local support
 * points are replaced by reserved team spaces.
 */
export function coordinateTeamShape({
  entries = [], ballPoint, possessionTeam, ownerId = null,
  attackingDirection, phase, previousJobs = {}, style = "possession",
  attacking = null, transition = null, marking = null, oppositionOwner = null, basePlans = [],
} = {}) {
  if (!entries.length) return { assignments: [], jobs: {}, metrics: teamShapeMetrics([]) };
  const team = entries[0].team;
  const inPossession = team === possessionTeam;
  // Work on phase-anchored views so every downstream role/job selector uses
  // the same WIB/WOB reference. Runtime entries and their base formation
  // anchors remain untouched.
  const baseEntries = entries;
  entries = entries.map((entry) => {
    const selection = phaseAnchorSelectionFor(entry, { inPossession, phase, ballPoint });
    return {
      ...entry,
      baseFormationAnchor: clonePoint(entry?.formationAnchor ?? entry),
      authoredTacticalRole: entry?.tacticalRole ?? null,
      authoredDuty: entry?.duty ?? null,
      formationAnchor: selection.point,
      manualPhasePosition: selection.manual,
      manualPhaseSource: selection.source,
      // Nulling these on the phase-local copy prevents role/duty geometry
      // and role-weighted team-job selection. The roster keeps both fields.
      tacticalRole: selection.manual ? null : entry?.tacticalRole,
      duty: selection.manual ? null : entry?.duty,
    };
  });
  const baseById = new Map(basePlans.map((plan) => [String(plan.id), plan]));
  const jobMap = inPossession
    ? possessionJobs(entries, { ownerId, ballPoint, attackingDirection, previousJobs, style })
    : defendingJobs(entries, { ballPoint, attackingDirection, previousJobs });
  const assignments = entries.map((entry) => {
    const teamJob = jobMap.get(entry.id) ?? "shape-balance";
    const shapeTarget = phaseAdjustedShapeTarget(entry, {
      ballPoint, attackingDirection, phase, inPossession,
    });
    const instructedShapeTarget = applyTeamShapeInstructions(shapeTarget, entry, {
      ballPoint, attackingDirection, phase, inPossession, teamJob: "shape-balance",
      attacking, transition, defending: marking, oppositionOwner,
    });
    const rawJobTarget = teamJobTarget(entry, teamJob, instructedShapeTarget, { ballPoint, attackingDirection });
    const jobTarget = applyTeamShapeInstructions(rawJobTarget, entry, {
      ballPoint, attackingDirection, phase, inPossession, teamJob,
      attacking: { ...normalizeTeamAttacking(attacking ?? {}), mentality: "balanced", width: "balanced" },
      transition: { onGain: "balanced", onLoss: "balanced" },
      defending: {
        ...normalizeTeamDefending(marking ?? {}),
        defensiveLine: "standard", engagementLine: "standard", offsideTrap: false,
        pressingTrap: "none", crossEngagement: "normal", preventShortGk: false,
      },
      oppositionOwner,
    });
    const basePlan = baseById.get(String(entry.id));
    return {
      id: entry.id,
      entry,
      team,
      teamPhase: phase,
      teamJob,
      positionalSlot: entry.positionalSlot ?? null,
      tacticalRole: entry.tacticalRole ?? null,
      duty: entry.duty ?? null,
      positioningMode: entry.manualPhasePosition ? "manual" : "role",
      manualPhasePosition: Boolean(entry.manualPhasePosition),
      authoredTacticalRole: entry.authoredTacticalRole,
      authoredDuty: entry.authoredDuty,
      baseFormationAnchor: { ...entry.baseFormationAnchor },
      formationAnchor: anchorOf(entry),
      shapeTarget: instructedShapeTarget,
      intentionAction: basePlan?.action ?? teamJob,
      intentionTarget: applyBasePlan(jobTarget, basePlan, marking),
      occupiedLane: laneForX(jobTarget.x),
      attackingDirection,
    };
  });

  // A special runner can vacate their normal lane. The nearest uncommitted
  // shape holder shades toward that anchor, rather than leaving a hole.
  const vacancies = assignments.filter((assignment) => {
    const base = baseById.get(String(assignment.id));
    return isSpecialBaseAction(base?.action)
      && yardDistance(assignment.shapeTarget, assignment.intentionTarget) > 8;
  });
  for (const vacancy of vacancies) {
    const holders = assignments.filter((assignment) => assignment.id !== vacancy.id
      && !isSpecialBaseAction(baseById.get(String(assignment.id))?.action)
      && assignment.teamJob !== "ball-owner" && assignment.teamJob !== "primary-presser");
    const holder = stableSort(holders, (assignment) => yardDistance(assignment.shapeTarget, vacancy.shapeTarget))[0];
    if (holder) holder.intentionTarget = blendPoint(holder.intentionTarget, vacancy.shapeTarget, 0.15);
  }

  // Restart release and first build-up targets must dissolve the compact
  // restart cluster. Keep a small margin above the five-yard telemetry
  // radius so floating-point conversion cannot leave the same pair counted
  // as clustered after the shape has supposedly opened.
  // Held before separateTargets() so body spacing still has the final word:
  // a compact block must never be compact enough to overlap.
  // Not during a restart. A kickoff or set-piece shape is authored
  // deliberately by restartSetup, and a deliberately tight kickoff cluster is
  // not a block that has drifted from its height -- correcting it breaks the
  // authored opening, which test-match-lab-setup.mjs's "the opening removes the
  // kickoff cluster" check caught. Team height is an open-play property, the
  // same way a real side does not hold its block length while lining up a
  // corner.
  if (phase !== "restart" && phase !== "restart-release") {
    applyTeamHeight(assignments, {
      attackingDirection,
      height: normalizeTeamAttacking(attacking ?? {}).height,
    });
  }
  separateTargets(assignments, phase === "restart-release" || phase === "build-up" ? 5.1 : 4.25);
  annotateTacticalRegions(assignments);
  const jobs = Object.fromEntries(assignments.map((assignment) => [assignment.id, assignment.teamJob]));
  return {
    assignments,
    jobs,
    metrics: teamShapeMetrics(baseEntries, { assignments, ballPoint, ownerId, attackingDirection }),
  };
}

// ---------------------------------------------------------------------------
// Team height (2026-09-14) -- the distance from the deepest outfielder to the
// highest, held as a declared shape the way width already is.
//
// This is a TEAM correction and cannot live in applyTeamShapeInstructions()
// beside width, because width scales every player about a fixed reference (the
// halfway line of the pitch) while height is measured against the squad
// itself. It therefore runs once per team, after every individual target is
// known.
//
// It also answers a measured defect. Sampled over 24 possessions, continuous
// stillness of two seconds or more happened at a mean 36.6 yards from the ball
// against 27.2 yards for brief pauses, and clustered on the back line
// (centre-backs 96 stretches, the most of any position). Players far from the
// ball were standing still because a zone-quantised shape target does not move
// until the ball crosses a boundary. A declared height is a reason to move
// that is continuous in where the ball is: when the block's length drifts, the
// whole block corrects, whether or not the ball is near you.
//
// Deliberately a bounded correction rather than a hard constraint. A team does
// not snap to its height -- it tends toward it, and a genuine run in behind or
// a full-back bombing on must still be able to stretch the side temporarily.
const TEAM_HEIGHT_MAX_CORRECTION_YARDS = 8;
// Below this the block is close enough to its declared length that correcting
// would be jitter rather than shape.
const TEAM_HEIGHT_DEADBAND_YARDS = 2.5;

/** Depth along the attacking axis, in yards, larger being further forward. */
function attackingDepthYards(point, attackingDirection) {
  const y = toYardPoint(point).y;
  return attackingDirection === "up" ? PITCH_LENGTH_YARDS - y : y;
}

/**
 * Pull a team's shape toward its declared height.
 *
 * Scales each outfielder's depth about the block's own midpoint, so the side
 * squeezes or stretches as one rather than the extremes being dragged onto the
 * rest. Goalkeepers are excluded: the keeper's depth is decided by
 * keeperPositioningPoint(), which already caps itself against this same back
 * line, and including him would drag the measured block onto the goal line.
 *
 * Mutates `intentionTarget` on the assignments, which is the same field the
 * vacancy and separation passes below already adjust.
 */
export function applyTeamHeight(assignments, { attackingDirection, height = "balanced" } = {}) {
  const outfield = assignments.filter((assignment) => bandOf(assignment.entry) !== "GK");
  if (outfield.length < 2) return { applied: false, reason: "too-few-outfielders" };
  const depths = outfield.map((assignment) => attackingDepthYards(assignment.intentionTarget, attackingDirection));
  const deepest = Math.min(...depths);
  const highest = Math.max(...depths);
  const currentLength = highest - deepest;
  const targetLength = teamHeightTargetYards(height);
  const error = targetLength - currentLength;
  if (!(currentLength > 0) || Math.abs(error) < TEAM_HEIGHT_DEADBAND_YARDS) {
    return { applied: false, currentLength, targetLength, reason: "within-deadband" };
  }
  const midpoint = (deepest + highest) / 2;
  const scale = targetLength / currentLength;

  // Squeeze by UNIT, not by individual.
  //
  // Scaling each player's own depth is the obvious implementation and it is
  // wrong: any stretch multiplies the gap between two players who merely
  // happen to differ by a yard, so a back four stops being a line. Real blocks
  // do not work that way -- the units move relative to each other and each
  // line keeps its own shape. Caught by test-team-shape.mjs's "controller and
  // member keep one line depth" check, which is exactly the right assertion.
  const bandDepths = new Map();
  outfield.forEach((assignment, index) => {
    const band = bandOf(assignment.entry);
    const bucket = bandDepths.get(band) ?? { total: 0, count: 0 };
    bucket.total += depths[index];
    bucket.count += 1;
    bandDepths.set(band, bucket);
  });
  const shiftByBand = new Map();
  for (const [band, bucket] of bandDepths) {
    const bandDepth = bucket.total / bucket.count;
    const wanted = midpoint + (bandDepth - midpoint) * scale;
    // Bound every correction. A large error must not translate into a unit
    // being teleported the length of the block.
    shiftByBand.set(band, clamp(
      -TEAM_HEIGHT_MAX_CORRECTION_YARDS, TEAM_HEIGHT_MAX_CORRECTION_YARDS, wanted - bandDepth,
    ));
  }
  for (const assignment of outfield) {
    const shift = shiftByBand.get(bandOf(assignment.entry)) ?? 0;
    if (!shift) continue;
    assignment.intentionTarget = pointWithYardOffset(
      assignment.intentionTarget, 0, shift, attackingDirection,
    );
  }
  return { applied: true, currentLength, targetLength, correctionYards: error };
}

function average(values) {
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

/** Quantitative shape telemetry in real pitch yards. */
export function teamShapeMetrics(entries = [], {
  assignments = null, ballPoint = null, ownerId = null, attackingDirection = "down",
  clusterRadiusYards = 5,
} = {}) {
  if (!entries.length) {
    return {
      centroid: null, widthYards: 0, lengthYards: 0, defensiveLineHeightYards: null,
      midfieldLineHeightYards: null, forwardLineHeightYards: null, gapsBetweenLinesYards: [],
      occupiedLanes: 0, laneNames: [], minimumTeammateSeparationYards: null,
      clusteredPlayers: 0, viablePassingSupportOptions: 0, restDefenceCount: 0,
      meanDistanceToShapeTargetYards: null, occupiedDepthBands: 0, depthBandNames: [],
      occupiedRegions: 0, regionIds: [], regionOccupancy: {}, depthBandOccupancy: {},
      wideChannelPlayers: 0, halfSpacePlayers: 0, centralCorridorPlayers: 0,
      occupiesBothWideChannels: false, occupiesBothHalfSpaces: false,
      widthAndHalfSpaceOccupation: { wideChannels: [], halfSpaces: [] },
      complementaryJobRegions: [], runsIntoOccupiedRegions: 0, runsIntoOpenRegions: 0,
    };
  }
  const byId = new Map((assignments || []).map((assignment) => [String(assignment.id), assignment]));
  const points = entries.map((entry) => byId.get(String(entry.id))?.intentionTarget ?? entry);
  const outfield = entries.map((entry, index) => ({ entry, point: points[index] }))
    .filter(({ entry }) => bandOf(entry) !== "GK");
  const measured = outfield.length ? outfield : entries.map((entry, index) => ({ entry, point: points[index] }));
  const yards = measured.map(({ point }) => toYardPoint(point));
  const centroidYards = {
    x: average(yards.map((point) => point.x)),
    y: average(yards.map((point) => point.y)),
  };
  const lineHeights = { D: [], M: [], F: [] };
  for (const { entry, point } of outfield) {
    const band = bandOf(entry);
    if (!lineHeights[band]) continue;
    const yard = toYardPoint(point);
    lineHeights[band].push(attackingDirection === "up" ? PITCH_LENGTH_YARDS - yard.y : yard.y);
  }
  const defensive = average(lineHeights.D);
  const midfield = average(lineHeights.M);
  const forward = average(lineHeights.F);
  const lines = [defensive, midfield, forward].filter((value) => value != null);
  const gaps = lines.slice(1).map((value, index) => Math.abs(value - lines[index]));
  const laneNames = [...new Set(outfield.map(({ point }) => laneForX(point.x)))];
  const assignmentRegions = assignments
    ? assignments.map((assignment) => assignment.intendedRegion
      ?? classifyTacticalRegion(assignment.intentionTarget, attackingDirection))
    : entries.map((entry) => classifyTacticalRegion(entry, attackingDirection));
  const depthBandNames = [...new Set(assignmentRegions.map((region) => region.depthBand))];
  const regionIds = [...new Set(assignmentRegions.map((region) => region.id))];
  const regionOccupancy = {};
  const depthBandOccupancy = {};
  for (const region of assignmentRegions) {
    regionOccupancy[region.id] = (regionOccupancy[region.id] || 0) + 1;
    depthBandOccupancy[region.depthBand] = (depthBandOccupancy[region.depthBand] || 0) + 1;
  }
  const wideChannels = [...new Set(assignmentRegions
    .filter((region) => region.flags.wideChannel).map((region) => region.lane))];
  const halfSpaces = [...new Set(assignmentRegions
    .filter((region) => region.flags.halfSpace).map((region) => region.lane))];
  let minimumSeparation = Infinity;
  const clustered = new Set();
  for (let left = 0; left < measured.length; left += 1) {
    for (let right = left + 1; right < measured.length; right += 1) {
      const distance = yardDistance(measured[left].point, measured[right].point);
      minimumSeparation = Math.min(minimumSeparation, distance);
      if (distance < clusterRadiusYards) {
        clustered.add(measured[left].entry.id);
        clustered.add(measured[right].entry.id);
      }
    }
  }
  const owner = entries.find((entry) => String(entry.id) === String(ownerId));
  const supportOptions = owner && ballPoint
    ? entries.filter((entry) => entry.id !== owner.id && bandOf(entry) !== "GK")
      .filter((entry) => {
        const point = byId.get(String(entry.id))?.intentionTarget ?? entry;
        const distance = yardDistance(ballPoint, point);
        return distance >= 5 && distance <= 25;
      }).length
    : 0;
  const distancesToShape = assignments
    ? assignments.map((assignment) => yardDistance(assignment.entry, assignment.shapeTarget))
    : [];
  return {
    centroid: fromYardPoint(centroidYards),
    widthYards: yards.length ? Math.max(...yards.map((point) => point.x)) - Math.min(...yards.map((point) => point.x)) : 0,
    lengthYards: yards.length ? Math.max(...yards.map((point) => point.y)) - Math.min(...yards.map((point) => point.y)) : 0,
    defensiveLineHeightYards: defensive,
    midfieldLineHeightYards: midfield,
    forwardLineHeightYards: forward,
    gapsBetweenLinesYards: gaps,
    occupiedLanes: laneNames.length,
    laneNames,
    minimumTeammateSeparationYards: Number.isFinite(minimumSeparation) ? minimumSeparation : null,
    clusteredPlayers: clustered.size,
    viablePassingSupportOptions: supportOptions,
    restDefenceCount: assignments
      ? assignments.filter((assignment) => REST_DEFENCE_JOBS.has(assignment.teamJob)).length
      : 0,
    meanDistanceToShapeTargetYards: distancesToShape.length ? average(distancesToShape) : null,
    occupiedDepthBands: depthBandNames.length,
    depthBandNames,
    occupiedRegions: regionIds.length,
    regionIds,
    regionOccupancy,
    depthBandOccupancy,
    wideChannelPlayers: assignmentRegions.filter((region) => region.flags.wideChannel).length,
    halfSpacePlayers: assignmentRegions.filter((region) => region.flags.halfSpace).length,
    centralCorridorPlayers: assignmentRegions.filter((region) => region.flags.centralCorridor).length,
    occupiesBothWideChannels: wideChannels.includes("left-touchline") && wideChannels.includes("right-touchline"),
    occupiesBothHalfSpaces: halfSpaces.includes("left-half-space") && halfSpaces.includes("right-half-space"),
    widthAndHalfSpaceOccupation: { wideChannels, halfSpaces },
    complementaryJobRegions: assignments
      ? assignments.map((assignment) => ({
          id: assignment.id,
          job: assignment.teamJob,
          regionId: assignment.intendedRegion?.id
            ?? classifyTacticalRegion(assignment.intentionTarget, attackingDirection).id,
        }))
      : [],
    runsIntoOccupiedRegions: assignments
      ? assignments.filter((assignment) => assignment.runIntoOccupiedRegion).length
      : 0,
    runsIntoOpenRegions: assignments
      ? assignments.filter((assignment) => assignment.runIntoOpenRegion).length
      : 0,
  };
}
