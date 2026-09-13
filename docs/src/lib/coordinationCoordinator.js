import { playerAttribute } from "./matchEngineCore.js";
import { yardDistance, PITCH_LENGTH_YARDS, PITCH_WIDTH_YARDS } from "./pitchGeometry.js";
import { timeToReach } from "./playerKinetics.js";
import { facingFromVelocity, speedYpsFromVelocity } from "./worldMotion.js";
import { secondLastOpponentLine } from "./matchOffside.js";

export const ATTACKING_COORDINATION_FAMILIES = Object.freeze([
  "REGAIN_QUICK_RELEASE",
  "WIDE_TRANSITION",
  "SHORT_COMBINATION",
  "RECYCLE_AND_SWITCH",
  "PENALTY_AREA_OCCUPATION",
]);

export const DEFENSIVE_COORDINATION_FAMILIES = Object.freeze([
  "LOSS_COUNTERPRESS_WINDOW",
  "TRANSITION_DELAY_AND_RECOVER",
  "PROTECT_DEPTH_AND_HANDOFF",
  "SHIFT_BLOCK_AND_PRESS",
  "DEFEND_WIDE_OVERLOAD",
  "PROTECT_PENALTY_AREA",
]);

export const PRESSURE_SWITCH_ADVANTAGE_MS = 220;
export const TRACKER_SWITCH_ADVANTAGE_MS = 260;
export const RESPONSIBILITY_COMMITMENT_MS = 650;
export const COUNTERPRESS_WINDOW_MS = 3200;
export const PATTERN_MAX_AGE_MS = 6500;
export const COORDINATION_REPLAN_MS = 500;

const clamp = (minimum, maximum, value) => Math.max(minimum, Math.min(maximum, value));
const point = (entry) => ({ x: Number(entry?.x) || 0, y: Number(entry?.y) || 0 });
const idOf = (entry) => String(entry?.id ?? "");
const directionSign = (direction) => direction === "up" ? -1 : 1;
const outfield = (entry) => entry && entry.role !== "keeper"
  && String(entry.positionalSlot || entry.player?.position_text || "").toUpperCase() !== "GK";

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function rating(entry, label) {
  return clamp(1, 20, playerAttribute(entry?.player ?? entry ?? {}, label));
}

function averageRating(entry, labels) {
  return labels.reduce((sum, label) => sum + rating(entry, label), 0) / labels.length;
}

function band(entry) {
  const token = String(entry?.positionalSlot || entry?.player?.position_text || "").toUpperCase();
  if (token === "GK" || entry?.role === "keeper") return "GK";
  if (/^(D|WB)/.test(token)) return "D";
  if (/^(DM|M|AM)/.test(token)) return "M";
  if (/^(F|ST)/.test(token)) return "F";
  return "M";
}

function roleText(entry) {
  return `${entry?.positionalSlot || ""} ${entry?.tacticalRole || ""} ${entry?.duty || ""}`.toLowerCase();
}

function offset(pointValue, lateralYards, forwardYards, direction) {
  return {
    x: clamp(1.5, 98.5, Number(pointValue?.x || 0) + lateralYards / (PITCH_WIDTH_YARDS / 100)),
    y: clamp(1.5, 98.5, Number(pointValue?.y || 0) + directionSign(direction) * forwardYards / (PITCH_LENGTH_YARDS / 100)),
  };
}

function ownGoalPoint(direction) {
  return { x: 50, y: direction === "up" ? 100 : 0 };
}

function attackingGoalDepthYards(pointValue, direction) {
  return (direction === "up" ? Number(pointValue?.y) : 100 - Number(pointValue?.y))
    * PITCH_LENGTH_YARDS / 100;
}

function inAttackingPenaltyArea(pointValue, direction, extraDepthYards = 0) {
  return attackingGoalDepthYards(pointValue, direction) <= 18 + extraDepthYards
    && Math.abs(Number(pointValue?.x) - 50) * PITCH_WIDTH_YARDS / 100 <= 22 + extraDepthYards * 0.25;
}

function onsideTarget(target, ballPoint, defenders, direction, bufferYards = 0.8) {
  if (!target) return target;
  const line = secondLastOpponentLine(defenders, direction);
  const effectiveY = direction === "up"
    ? Math.min(Number(ballPoint.y), Number(line.lineY))
    : Math.max(Number(ballPoint.y), Number(line.lineY));
  const buffer = Math.max(0, bufferYards) / PITCH_LENGTH_YARDS * 100;
  return {
    ...target,
    y: direction === "up"
      ? Math.max(target.y, effectiveY + buffer)
      : Math.min(target.y, effectiveY - buffer),
  };
}

function stableSort(entries, score) {
  return [...entries].sort((left, right) => score(left) - score(right)
    || idOf(left).localeCompare(idOf(right)));
}

function select(entries, score, reserved, predicate = () => true) {
  const available = entries.filter((entry) => predicate(entry) && !reserved.has(idOf(entry)));
  const selected = stableSort(available, score)[0] ?? null;
  if (selected) reserved.add(idOf(selected));
  return selected;
}

function tacticBundle(tacticsByTeam, team) {
  const supplied = tacticsByTeam?.[team] ?? {};
  return {
    attacking: supplied.attacking ?? supplied,
    transition: supplied.transition ?? {},
    defending: supplied.defending ?? supplied.marking ?? {},
  };
}

function addContribution(target, label, value) {
  if (!value) return;
  target.push({ label, value });
}

function mentalityValue(mentality) {
  return ({ defensive: -8, cautious: -4, balanced: 0, positive: 4, attacking: 7 })[mentality] ?? 0;
}

function forwardProgress(from, to, direction) {
  return (Number(to?.y) - Number(from?.y)) * directionSign(direction);
}

function segmentDistanceYards(pointValue, from, to) {
  const ax = Number(from?.x) * PITCH_WIDTH_YARDS / 100;
  const ay = Number(from?.y) * PITCH_LENGTH_YARDS / 100;
  const bx = Number(to?.x) * PITCH_WIDTH_YARDS / 100;
  const by = Number(to?.y) * PITCH_LENGTH_YARDS / 100;
  const px = Number(pointValue?.x) * PITCH_WIDTH_YARDS / 100;
  const py = Number(pointValue?.y) * PITCH_LENGTH_YARDS / 100;
  const dx = bx - ax;
  const dy = by - ay;
  const denominator = dx * dx + dy * dy;
  const t = denominator ? clamp(0, 1, ((px - ax) * dx + (py - ay) * dy) / denominator) : 0;
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function laneIsClosed(from, to, defenders) {
  return defenders.some((defender) => segmentDistanceYards(defender, from, to) < 2.2
    && yardDistance(from, defender) < yardDistance(from, to));
}

function attackCandidates({ previous, attackers, defenders, owner, ballPoint, direction, tactics, nowMs, flags }) {
  const changedAt = previous?.possessionChangedAtMs;
  const transitionAge = changedAt == null ? Infinity : nowMs - Number(changedAt);
  const transitionLive = flags?.regain === true
    || previous?.lastPossessionTeam && previous.lastPossessionTeam !== owner.team
    || transitionAge <= COUNTERPRESS_WINDOW_MS;
  const closeOptions = attackers.filter((entry) => entry.id !== owner.id && yardDistance(entry, ballPoint) <= 24);
  const wideOptions = attackers.filter((entry) => entry.id !== owner.id && (entry.x <= 30 || entry.x >= 70));
  const centralOptions = attackers.filter((entry) => entry.id !== owner.id && entry.x > 30 && entry.x < 70);
  const pressureDistance = defenders.length ? Math.min(...defenders.map((entry) => yardDistance(entry, owner))) : 99;
  const localDefenders = defenders.filter((entry) => yardDistance(entry, ballPoint) <= 15);
  const weakSideOptions = attackers.filter((entry) => entry.id !== owner.id
    && (ballPoint.x < 50 ? entry.x >= 65 : entry.x <= 35));
  const settledPossession = !transitionLive && !flags?.transition;
  const congestedSide = localDefenders.length >= 3 && weakSideOptions.length > 0;
  const nearPenaltyArea = inAttackingPenaltyArea(ballPoint, direction, 10);
  const recognition = averageRating(owner, ["Decisions", "Anticipation", "Vision"]);
  const attacking = tactics.attacking;
  const transition = tactics.transition;

  const build = (family, eligible, base, reasons, specific) => {
    const tacticalContributions = [];
    const attributeInputs = {
      ownerId: owner.id,
      decisions: rating(owner, "Decisions"),
      anticipation: rating(owner, "Anticipation"),
      vision: rating(owner, "Vision"),
      recognitionDelta: (recognition - 10) * 0.55,
    };
    addContribution(tacticalContributions, `mentality:${attacking.mentality || "balanced"}`, mentalityValue(attacking.mentality));
    specific(tacticalContributions);
    const tacticalDelta = tacticalContributions.reduce((sum, entry) => sum + entry.value, 0);
    return {
      family,
      eligible,
      utility: eligible ? base + tacticalDelta + attributeInputs.recognitionDelta : -Infinity,
      baseUtility: base,
      tacticalContributions,
      attributeInputs,
      reasons,
    };
  };

  return [
    build(
      "REGAIN_QUICK_RELEASE",
      Boolean(!flags?.looseBall && transitionLive && closeOptions.length),
      45,
      transitionLive ? ["recent possession gain"] : ["no recent possession gain"],
      (items) => {
        addContribution(items, `onGain:${transition.onGain || "balanced"}`, transition.onGain === "counter" ? 13 : transition.onGain === "hold-shape" ? -13 : 0);
        addContribution(items, `style:${attacking.style || "possession"}`, ["direct", "long-ball"].includes(attacking.style) ? 5 : 0);
        addContribution(items, "passIntoSpace", attacking.passIntoSpace ? 4 : 0);
      },
    ),
    build(
      "WIDE_TRANSITION",
      Boolean(!flags?.looseBall && (transitionLive || flags?.transition === true) && wideOptions.length && centralOptions.length),
      43 + Math.min(7, pressureDistance * 0.35),
      wideOptions.length ? ["wide outlet available"] : ["no wide outlet"],
      (items) => {
        addContribution(items, `style:${attacking.style || "possession"}`, attacking.style === "wing" ? 15 : ["direct", "long-ball"].includes(attacking.style) ? 6 : 0);
        addContribution(items, `onGain:${transition.onGain || "balanced"}`, transition.onGain === "counter" ? 11 : transition.onGain === "hold-shape" ? -12 : 0);
        addContribution(items, `width:${attacking.width || "balanced"}`, attacking.width === "wide" ? 8 : attacking.width === "narrow" ? -7 : 0);
        const desiredSide = ballPoint.x < 50 ? "left" : "right";
        addContribution(items, `focus:${attacking.focusPlay || "mixed"}`, attacking.focusPlay === desiredSide ? 7 : attacking.focusPlay && attacking.focusPlay !== "mixed" ? -4 : 0);
      },
    ),
    build(
      "SHORT_COMBINATION",
      Boolean(!flags?.looseBall && !nearPenaltyArea && closeOptions.length >= 2 && pressureDistance > 2.2),
      44 + Math.min(5, closeOptions.length),
      closeOptions.length >= 2 ? ["two close passing relationships"] : ["insufficient close support"],
      (items) => {
        addContribution(items, `style:${attacking.style || "possession"}`, attacking.style === "possession" ? 16 : attacking.style === "long-ball" ? -12 : 0);
        addContribution(items, `directness:${attacking.directness ?? 2}`, (3 - Number(attacking.directness ?? 2)) * 3);
        addContribution(items, `tempo:${attacking.tempo || "balanced"}`, attacking.tempo === "slow" ? 4 : attacking.tempo === "quick" ? 2 : 0);
        addContribution(items, "workBall", attacking.finalThird === "work-ball" ? 6 : 0);
      },
    ),
    build(
      "RECYCLE_AND_SWITCH",
      Boolean(!flags?.looseBall && settledPossession && weakSideOptions.length
        && (congestedSide || flags?.recycleNeeded || tactics.attacking?.style === "possession")),
      41 + Math.min(9, localDefenders.length * 2),
      congestedSide ? ["ball-side pressure creates a weak-side release"] : ["settled circulation has a weak-side option"],
      (items) => {
        addContribution(items, `style:${attacking.style || "possession"}`, attacking.style === "possession" ? 13 : attacking.style === "long-ball" ? -8 : 0);
        addContribution(items, `tempo:${attacking.tempo || "balanced"}`, attacking.tempo === "slow" ? 5 : attacking.tempo === "quick" ? -2 : 0);
        addContribution(items, `width:${attacking.width || "balanced"}`, attacking.width === "wide" ? 5 : attacking.width === "narrow" ? -4 : 0);
        addContribution(items, "localCongestion", congestedSide ? 13 : 0);
        addContribution(items, "explicitRecycleNeed", flags?.recycleNeeded ? 12 : 0);
      },
    ),
    build(
      "PENALTY_AREA_OCCUPATION",
      Boolean(!flags?.looseBall && nearPenaltyArea && attackers.filter(outfield).length >= 5),
      57,
      nearPenaltyArea ? ["ball entered the final attacking corridor"] : ["ball outside final attacking corridor"],
      (items) => {
        addContribution(items, `finalThird:${attacking.finalThird || "mixed"}`, attacking.finalThird === "early-crosses" ? 9 : attacking.finalThird === "work-ball" ? 7 : 2);
        addContribution(items, `width:${attacking.width || "balanced"}`, attacking.width === "wide" ? 4 : 0);
        addContribution(items, `mentality:${attacking.mentality || "balanced"}:box`, mentalityValue(attacking.mentality) * 0.5);
      },
    ),
  ];
}

function rolePreference(entry, responsibility) {
  const text = roleText(entry);
  const work = rating(entry, "Work Rate");
  const offBall = rating(entry, "Off the Ball");
  const teamwork = rating(entry, "Teamwork");
  const attackDuty = entry?.duty === "attack" ? 4 : entry?.duty === "defend" ? -4 : 0;
  switch (responsibility) {
    case "immediate-outlet": return -(rating(entry, "Passing") + rating(entry, "Technique") + teamwork) * 0.5;
    case "close-support": return -(teamwork + work + rating(entry, "First Touch")) * 0.5;
    case "central-depth-runner": return -(offBall + rating(entry, "Pace") + rating(entry, "Acceleration") + attackDuty) * 0.55;
    case "curved-channel-runner": return -(offBall + rating(entry, "Pace") + rating(entry, "Agility") + attackDuty) * 0.55;
    case "overlap": return -(work + rating(entry, "Pace") + (/(wing|full-back|wing-back)/.test(text) ? 7 : 0));
    case "underlap": return -(offBall + teamwork + (/(inside|inverted|midfield)/.test(text) ? 6 : 0));
    case "third-man-runner": return -(teamwork + offBall + work + attackDuty) * 0.5;
    case "weak-side-runner": return -(offBall + work + attackDuty) * 0.48;
    case "trailing-arrival": return -(work + rating(entry, "Long Shots") + teamwork) * 0.45;
    case "recycle-outlet": return -(rating(entry, "Passing") + rating(entry, "Vision") + teamwork + (band(entry) === "D" ? 4 : 0)) * 0.5;
    case "switch-receiver": return -(rating(entry, "First Touch") + offBall + rating(entry, "Technique") + rating(entry, "Pace")) * 0.45;
    case "circulation-support": return -(teamwork + work + rating(entry, "Decisions") + rating(entry, "Passing")) * 0.45;
    case "near-post-runner": return -(offBall + rating(entry, "Anticipation") + rating(entry, "Acceleration") + attackDuty) * 0.55;
    case "central-box-target": return -(offBall + rating(entry, "Strength") + rating(entry, "Heading") + attackDuty) * 0.5;
    case "far-post-runner": return -(offBall + rating(entry, "Anticipation") + rating(entry, "Pace") + attackDuty) * 0.5;
    case "cutback-option": return -(rating(entry, "Decisions") + rating(entry, "Technique") + teamwork) * 0.5;
    case "edge-of-box-arrival": return -(work + rating(entry, "Long Shots") + rating(entry, "Anticipation")) * 0.48;
    case "rest-defence": return -(rating(entry, "Positioning") + rating(entry, "Anticipation") + (entry?.duty === "defend" ? 7 : 0));
    default: return 0;
  }
}

function makeIntention(entry, team, family, responsibility, target, relationship, threat = false) {
  if (!entry) return null;
  return {
    playerId: entry.id,
    team,
    family,
    responsibility,
    action: `coordinate-${responsibility}`,
    target,
    relationship,
    threat,
  };
}

function allocateAttack(family, attackers, owner, ballPoint, direction, tactics = {}, previousIntentions = [], defenders = []) {
  const team = owner.team;
  const candidates = attackers.filter((entry) => entry.id !== owner.id && outfield(entry));
  const reserved = new Set([idOf(owner)]);
  const intentions = [makeIntention(owner, team, family, "ball-carrier", point(owner), "owns-ball")];
  const add = (responsibility, entry, target, relationship, threat = false) => {
    const intent = makeIntention(entry, team, family, responsibility, target, relationship, threat);
    if (intent) intentions.push(intent);
  };
  const previousFor = (responsibility) => new Set(previousIntentions
    .filter((entry) => entry.family === family && entry.responsibility === responsibility)
    .map((entry) => String(entry.playerId)));
  const pick = (responsibility, predicate = () => true, extra = () => 0) => {
    const incumbents = previousFor(responsibility);
    return select(
    candidates,
    (entry) => rolePreference(entry, responsibility) + extra(entry)
      - (incumbents.has(idOf(entry)) ? 100 : 0),
    reserved,
    predicate,
    );
  };
  const ownerSide = ballPoint.x < 50 ? -1 : 1;

  if (family === "REGAIN_QUICK_RELEASE") {
    const outlet = pick("immediate-outlet", () => true, (entry) => yardDistance(entry, ballPoint));
    add("immediate-outlet", outlet, outlet ? offset(ballPoint, ownerSide * 7, 5, direction) : null, "show-beyond-first-pressure");
    const support = pick("close-support", () => true, (entry) => yardDistance(entry, ballPoint));
    add("close-support", support, support ? offset(ballPoint, -ownerSide * 6, -4, direction) : null, "support-release-and-return");
    const depth = pick("central-depth-runner", (entry) => band(entry) !== "D", (entry) => Math.abs(entry.x - 50));
    add("central-depth-runner", depth, depth ? offset({ x: clamp(38, 62, depth.x), y: ballPoint.y }, 0, 16, direction) : null, "stretch-after-regain", true);
    const trail = pick("trailing-arrival", (entry) => band(entry) === "M", (entry) => yardDistance(entry, ballPoint));
    add("trailing-arrival", trail, trail ? offset(ballPoint, -ownerSide * 3, -10, direction) : null, "arrive-behind-first-wave", true);
  } else if (family === "WIDE_TRANSITION") {
    const preferredSide = ballPoint.x < 50 ? -1 : 1;
    const channel = pick("curved-channel-runner", (entry) => preferredSide < 0 ? entry.x < 55 : entry.x > 45,
      (entry) => Math.abs(entry.x - (preferredSide < 0 ? 15 : 85)));
    add("curved-channel-runner", channel, channel ? offset({ x: preferredSide < 0 ? 14 : 86, y: ballPoint.y }, 0, 20, direction) : null, "attack-wide-channel", true);
    const depth = pick("central-depth-runner", (entry) => band(entry) !== "D", (entry) => Math.abs(entry.x - 50));
    add("central-depth-runner", depth, depth ? offset({ x: 50, y: ballPoint.y }, 0, 18, direction) : null, "occupy-central-depth", true);
    const preferUnderlap = tactics.attacking?.width === "narrow"
      || tactics.attacking?.focusPlay === "centre";
    const flankSupport = preferUnderlap
      ? pick("underlap", (entry) => preferredSide < 0 ? entry.x < 62 : entry.x > 38,
        (entry) => Math.abs(entry.x - (preferredSide < 0 ? 34 : 66)))
      : pick("overlap", (entry) => preferredSide < 0 ? entry.x < 55 : entry.x > 45,
        (entry) => Math.abs(entry.x - (preferredSide < 0 ? 8 : 92)));
    add(
      preferUnderlap ? "underlap" : "overlap",
      flankSupport,
      flankSupport ? offset({ x: preferredSide < 0 ? (preferUnderlap ? 34 : 6) : (preferUnderlap ? 66 : 94), y: ballPoint.y }, 0, 14, direction) : null,
      preferUnderlap ? "inside-channel-overload" : "outside-channel-overload",
      true,
    );
    const weak = pick("weak-side-runner", (entry) => preferredSide < 0 ? entry.x > 45 : entry.x < 55,
      (entry) => Math.abs(entry.x - (preferredSide < 0 ? 82 : 18)));
    add("weak-side-runner", weak, weak ? offset({ x: preferredSide < 0 ? 82 : 18, y: ballPoint.y }, 0, 10, direction) : null, "preserve-opposite-lane", true);
    const trail = pick("trailing-arrival", (entry) => band(entry) === "M");
    add("trailing-arrival", trail, trail ? offset(ballPoint, -preferredSide * 5, -11, direction) : null, "cutback-support", true);
  } else if (family === "SHORT_COMBINATION") {
    const outlet = pick("immediate-outlet", () => true, (entry) => yardDistance(entry, ballPoint));
    add("immediate-outlet", outlet, outlet ? offset(ballPoint, ownerSide * 6, 3, direction) : null, "first-side-of-triangle");
    const support = pick("close-support", () => true, (entry) => yardDistance(entry, ballPoint));
    add("close-support", support, support ? offset(ballPoint, -ownerSide * 6, -3, direction) : null, "second-side-of-triangle");
    const third = pick("third-man-runner", (entry) => band(entry) !== "D", (entry) => Math.abs(entry.x - 50));
    add("third-man-runner", third, third ? offset({ x: clamp(35, 65, third.x), y: ballPoint.y }, ownerSide * 3, 11, direction) : null, "run-beyond-bounce", true);
    const trail = pick("trailing-arrival", (entry) => band(entry) === "M");
    add("trailing-arrival", trail, trail ? offset(ballPoint, 0, -9, direction) : null, "recycle-behind-combination");
  } else if (family === "RECYCLE_AND_SWITCH") {
    const recycle = pick("recycle-outlet", (entry) => band(entry) !== "F",
      (entry) => yardDistance(entry, offset(ballPoint, 0, -12, direction)));
    add("recycle-outlet", recycle, recycle ? offset(ballPoint, ballPoint.x < 50 ? 7 : -7, -12, direction) : null, "reset-behind-pressure");
    const switchReceiver = pick("switch-receiver", (entry) => ballPoint.x < 50 ? entry.x > 55 : entry.x < 45,
      (entry) => Math.abs(entry.x - (ballPoint.x < 50 ? 86 : 14)));
    add("switch-receiver", switchReceiver, switchReceiver ? {
      x: ballPoint.x < 50 ? 86 : 14,
      y: clamp(8, 92, ballPoint.y + directionSign(direction) * 3),
    } : null, "hold-opposite-width-for-switch", true);
    const circulation = pick("circulation-support", (entry) => band(entry) === "M",
      (entry) => yardDistance(entry, ballPoint));
    add("circulation-support", circulation, circulation ? offset(ballPoint, ballPoint.x < 50 ? 10 : -10, -4, direction) : null, "connect-recycle-to-switch");
    const pin = pick("central-depth-runner", (entry) => band(entry) === "F",
      (entry) => Math.abs(entry.x - 50));
    add("central-depth-runner", pin, pin ? onsideTarget(offset({ x: 50, y: ballPoint.y }, 0, 12, direction), ballPoint, defenders, direction) : null, "pin-line-during-circulation", true);
  } else if (family === "PENALTY_AREA_OCCUPATION") {
    const sign = directionSign(direction);
    const goalY = direction === "up" ? 0 : 100;
    const nearSide = ballPoint.x < 50 ? -1 : 1;
    const boxTarget = (x, depthYards) => onsideTarget({
      x,
      y: clamp(1.5, 98.5, goalY - sign * depthYards / (PITCH_LENGTH_YARDS / 100)),
    }, ballPoint, defenders, direction, 0.9);
    const near = pick("near-post-runner", (entry) => band(entry) !== "D",
      (entry) => Math.abs(entry.x - (nearSide < 0 ? 43 : 57)));
    add("near-post-runner", near, near ? boxTarget(nearSide < 0 ? 43 : 57, 7) : null, "attack-near-post-lane", true);
    const central = pick("central-box-target", (entry) => band(entry) === "F" || /target|forward|striker/.test(roleText(entry)),
      (entry) => Math.abs(entry.x - 50));
    add("central-box-target", central, central ? boxTarget(50, 10.5) : null, "occupy-penalty-spot-lane", true);
    const far = pick("far-post-runner", (entry) => band(entry) !== "D",
      (entry) => Math.abs(entry.x - (nearSide < 0 ? 62 : 38)));
    add("far-post-runner", far, far ? boxTarget(nearSide < 0 ? 62 : 38, 8.5) : null, "arrive-on-far-side-blind-spot", true);
    const cutback = pick("cutback-option", (entry) => band(entry) === "M",
      (entry) => yardDistance(entry, offset(ballPoint, -nearSide * 6, -5, direction)));
    add("cutback-option", cutback, cutback ? offset(ballPoint, -nearSide * 6, -5, direction) : null, "show-behind-box-runs");
    const edge = pick("edge-of-box-arrival", (entry) => band(entry) === "M");
    add("edge-of-box-arrival", edge, edge ? { x: clamp(34, 66, edge.x), y: goalY - sign * 20 / (PITCH_LENGTH_YARDS / 100) } : null, "hold-edge-for-rebound-and-recycle", true);
  }

  // Threat intentions describe positions held before the next contact. Keep
  // every prospective runner on the legal side of the live ball/second-last-
  // opponent line; the eventual pass resolver still takes its own kick-time
  // snapshot and may release the runner after contact.
  for (const intention of intentions) {
    if (intention?.threat) {
      intention.target = onsideTarget(intention.target, ballPoint, defenders, direction);
    }
  }

  const restCandidates = stableSort(candidates.filter((entry) => !reserved.has(idOf(entry))),
    (entry) => rolePreference(entry, "rest-defence") + forwardProgress(entry, ownGoalPoint(direction), direction) * -0.1);
  for (const entry of restCandidates.slice(0, 2)) {
    reserved.add(idOf(entry));
    const anchor = entry.formationAnchor ?? entry;
    add("rest-defence", entry, offset(anchor, 0, -3, direction), "protect-behind-attack");
  }
  return intentions.filter((entry) => entry?.target);
}

function velocityToward(entry, target, velocity) {
  const speed = speedYpsFromVelocity(velocity);
  if (!speed || !velocity) return { speed: 0, facing: null, approachAngle: 0, towardSpeed: 0 };
  const facing = facingFromVelocity(velocity);
  const dx = (target.x - entry.x) * PITCH_WIDTH_YARDS / 100;
  const dy = (target.y - entry.y) * PITCH_LENGTH_YARDS / 100;
  const heading = Math.atan2(dy, dx) * 180 / Math.PI;
  const raw = Math.abs((((heading - facing) % 360) + 540) % 360 - 180);
  return { speed, facing, approachAngle: raw, towardSpeed: speed * Math.max(0, Math.cos(raw * Math.PI / 180)) };
}

function pressureCandidates(defenders, ballPoint, velocities, defending = {}, direction = "down") {
  const goal = ownGoalPoint(direction);
  const pressReactionDelta = defending.pressing === "high" ? -90 : defending.pressing === "low" ? 120 : 0;
  return defenders.filter(outfield).map((entry) => {
    const movement = velocityToward(entry, ballPoint, velocities?.[idOf(entry)]);
    const reaction = 330 - averageRating(entry, ["Decisions", "Anticipation", "Positioning"]) * 9
      + pressReactionDelta;
    const etaMs = reaction + timeToReach(entry.player, yardDistance(entry, ballPoint), movement.towardSpeed) * 1000
      + movement.approachAngle * 2.4;
    const coverCostMs = yardDistance(entry, goal) < 22 ? 180 : 0;
    return {
      id: entry.id,
      entry,
      etaMs: etaMs + coverCostMs,
      rawEtaMs: etaMs,
      approachAngle: movement.approachAngle,
      currentSpeedYps: movement.speed,
      coverCostMs,
      attributes: {
        decisions: rating(entry, "Decisions"), anticipation: rating(entry, "Anticipation"),
        positioning: rating(entry, "Positioning"), pace: rating(entry, "Pace"), acceleration: rating(entry, "Acceleration"),
      },
    };
  }).sort((left, right) => left.etaMs - right.etaMs || String(left.id).localeCompare(String(right.id)));
}

function stickyAssignment(ranked, previous, nowMs, advantageMs) {
  const best = ranked[0] ?? null;
  if (!best) return { selected: null, transfer: null };
  const current = ranked.find((entry) => String(entry.id) === String(previous?.ownerId));
  if (!current) return {
    selected: best,
    transfer: previous?.ownerId ? { fromId: previous.ownerId, toId: best.id, reason: "previous owner unavailable", advantageMs: null } : null,
  };
  if (best.id === current.id) return { selected: current, transfer: null };
  const advantage = current.etaMs - best.etaMs;
  const committedFor = nowMs - Number(previous?.sinceMs ?? -Infinity);
  if (advantage >= advantageMs && committedFor >= RESPONSIBILITY_COMMITMENT_MS) {
    return { selected: best, transfer: { fromId: current.id, toId: best.id, reason: "challenger has a reachable arrival advantage", advantageMs: advantage } };
  }
  return { selected: current, transfer: null };
}

function nearestGoalSideTarget(ballPoint, direction, lateral = 0, depth = 6) {
  return offset(ballPoint, lateral, -depth, direction);
}

function ownGoalDepthYards(pointValue, direction) {
  return (direction === "up" ? 100 - Number(pointValue?.y) : Number(pointValue?.y))
    * PITCH_LENGTH_YARDS / 100;
}

function defensiveLinePlan({ defenders, keeper, ballPoint, direction, tactics, pressureEtaMs }) {
  const nominalDepth = tactics.defensiveLine === "high" ? 28
    : tactics.defensiveLine === "deep" ? 15 : 22;
  const ballDepth = ownGoalDepthYards(ballPoint, direction);
  const keeperDepth = keeper ? ownGoalDepthYards(keeper, direction) : 0;
  const pressureControl = pressureEtaMs <= 900;
  const underUncontrolledPressure = pressureEtaMs >= 1600;
  const trapStep = tactics.offsideTrap && pressureControl ? 3 : 0;
  const safetyDrop = underUncontrolledPressure ? 3 : 0;
  const maximumGoalSideDepth = Math.max(keeperDepth + 2, ballDepth - 3);
  const desiredDepth = clamp(
    keeperDepth + 2,
    Math.max(keeperDepth + 2, maximumGoalSideDepth),
    nominalDepth + trapStep - safetyDrop,
  );
  const lineY = direction === "up"
    ? 100 - desiredDepth / PITCH_LENGTH_YARDS * 100
    : desiredDepth / PITCH_LENGTH_YARDS * 100;
  const members = defenders.filter((entry) => outfield(entry) && band(entry) === "D");
  return {
    lineY: clamp(1.5, 98.5, lineY),
    depthYards: desiredDepth,
    nominalDepthYards: nominalDepth,
    ballDepthYards: ballDepth,
    keeperDepthYards: keeperDepth,
    pressureControlled: pressureControl,
    offsideTrapStep: trapStep > 0,
    safetyDropYards: safetyDrop,
    memberIds: members.map((entry) => entry.id),
  };
}

function defensiveFamily({ attackFamily, transitionLoss, defending, flags }) {
  if (transitionLoss && defending.transition?.onLoss === "counter-press") return "LOSS_COUNTERPRESS_WINDOW";
  if (attackFamily === "WIDE_TRANSITION") return "DEFEND_WIDE_OVERLOAD";
  if (attackFamily === "PENALTY_AREA_OCCUPATION") return "PROTECT_PENALTY_AREA";
  if (attackFamily === "REGAIN_QUICK_RELEASE") return "TRANSITION_DELAY_AND_RECOVER";
  if (flags?.depthThreat) return "PROTECT_DEPTH_AND_HANDOFF";
  return "SHIFT_BLOCK_AND_PRESS";
}

function allocateDefence({ family, defenders, keeper, ballPoint, direction, attackIntentions, previous, nowMs, velocities, tactics }) {
  const rankedPressure = pressureCandidates(defenders, ballPoint, velocities, tactics.defending, direction);
  const pressureSwitchAdvantage = PRESSURE_SWITCH_ADVANTAGE_MS
    + (tactics.defending?.pressing === "low" ? 80 : tactics.defending?.pressing === "high" ? -40 : 0);
  const pressureChoice = stickyAssignment(rankedPressure, previous?.pressure, nowMs, pressureSwitchAdvantage);
  const pressure = pressureChoice.selected?.entry ?? null;
  const linePlan = defensiveLinePlan({
    defenders, keeper, ballPoint, direction, tactics: tactics.defending,
    pressureEtaMs: pressureChoice.selected?.etaMs ?? Infinity,
  });
  const reserved = new Set(pressure ? [idOf(pressure)] : []);
  const priorTrackerEntries = Object.entries(previous?.trackers ?? {});
  const priorTrackerIds = new Set(priorTrackerEntries.map(([, value]) => String(value.defenderId)));
  const intentions = [];
  const team = defenders[0]?.team ?? keeper?.team ?? null;
  const priorIntentions = previous?.latestEvidence?.intentions ?? [];
  const stableSelect = (responsibility, score, predicate = () => true) => {
    const incumbentIds = new Set(priorIntentions
      .filter((entry) => entry.team === team && entry.responsibility === responsibility)
      .map((entry) => String(entry.playerId)));
    return select(defenders, (entry) => score(entry) - (incumbentIds.has(idOf(entry)) ? 100 : 0), reserved, predicate);
  };
  const add = (responsibility, entry, target, relationship, threatId = null) => {
    const intent = makeIntention(entry, team, family, responsibility, target, relationship);
    if (intent) intentions.push({ ...intent, threatId });
  };
  add("primary-pressure", pressure, offset(ballPoint, 0, -1.3, direction), "reachable-angle-to-ball");
  const lineDepth = tactics.defending?.defensiveLine === "deep" ? 10
    : tactics.defending?.defensiveLine === "high" ? 5 : 7;
  const coverTarget = nearestGoalSideTarget(ballPoint, direction, ballPoint.x < 50 ? 4 : -4, lineDepth);
  const insideCover = stableSelect("inside-cover", (entry) => yardDistance(entry, coverTarget)
    - averageRating(entry, ["Positioning", "Anticipation", "Decisions"]) * 0.35, outfield);
  add("inside-cover", insideCover, coverTarget, "protect-goal-side-inside-lane");

  const depthThreats = attackIntentions.filter((intent) => intent.threat
    && ["central-depth-runner", "curved-channel-runner", "overlap", "underlap", "third-man-runner", "weak-side-runner",
      "switch-receiver", "near-post-runner", "central-box-target", "far-post-runner", "edge-of-box-arrival"].includes(intent.responsibility));
  const depthThreat = depthThreats.slice().sort((a, b) => {
    const da = yardDistance(a.target, ownGoalPoint(direction));
    const db = yardDistance(b.target, ownGoalPoint(direction));
    return da - db || String(a.playerId).localeCompare(String(b.playerId));
  })[0] ?? null;
  const depthTarget = depthThreat ? nearestGoalSideTarget(depthThreat.target, direction, 0, family === "PROTECT_PENALTY_AREA" ? 1.8 : 3.5)
    : { x: 50, y: linePlan.lineY };
  const depthProtector = stableSelect("depth-protector", (entry) => yardDistance(entry, depthTarget)
    - averageRating(entry, ["Positioning", "Pace", "Anticipation"]) * 0.3,
  (entry) => outfield(entry) && band(entry) === "D" && !priorTrackerIds.has(idOf(entry)));
  add("depth-protector", depthProtector, depthTarget, "protect-deepest-ranked-threat", depthThreat?.playerId ?? null);

  const trackers = {};
  const transfers = [];
  for (const threat of depthThreats.slice(0, 3)) {
    const threatKey = String(threat.playerId);
    const old = previous?.trackers?.[threatKey] ?? null;
    const otherCommittedTrackerIds = new Set(priorTrackerEntries
      .filter(([runnerId]) => String(runnerId) !== threatKey)
      .map(([, value]) => String(value.defenderId)));
    const available = defenders.filter((entry) => outfield(entry)
      && !reserved.has(idOf(entry))
      && !otherCommittedTrackerIds.has(idOf(entry)));
    const ranked = available.map((entry) => ({
      id: entry.id,
      entry,
      etaMs: timeToReach(entry.player, yardDistance(entry, threat.target), speedYpsFromVelocity(velocities?.[idOf(entry)])) * 1000
        - averageRating(entry, ["Marking", "Positioning", "Anticipation"]) * 12,
    })).sort((a, b) => a.etaMs - b.etaMs || String(a.id).localeCompare(String(b.id)));
    const strictness = clamp(1, 5, Number(tactics.defending?.strictness) || 3);
    const trackerSwitchAdvantage = TRACKER_SWITCH_ADVANTAGE_MS
      + (tactics.defending?.scheme === "man" ? strictness * 24 : -40);
    const choice = stickyAssignment(ranked, old ? { ownerId: old.defenderId, sinceMs: old.sinceMs } : null, nowMs, trackerSwitchAdvantage);
    if (!choice.selected) continue;
    reserved.add(idOf(choice.selected.entry));
    trackers[threatKey] = {
      defenderId: choice.selected.id,
      sinceMs: choice.transfer || !old ? nowMs : old.sinceMs,
      etaMs: choice.selected.etaMs,
    };
    if (choice.transfer) transfers.push({ ...choice.transfer, runnerId: threat.playerId, type: "runner-handoff" });
    add("runner-tracker", choice.selected.entry, nearestGoalSideTarget(threat.target, direction, 0, 2), "goal-side-runner-track", threat.playerId);
  }

  const recovery = stableSelect("recovery-screen", (entry) => yardDistance(entry, nearestGoalSideTarget(ballPoint, direction, 0, 11))
    - averageRating(entry, ["Work Rate", "Positioning", "Stamina"]) * 0.3,
  (entry) => outfield(entry) && band(entry) === "M");
  add("recovery-screen", recovery, nearestGoalSideTarget(ballPoint, direction, 0, 11), "recover-through-central-lane");
  const farX = ballPoint.x < 50 ? 68 : 32;
  const farSide = stableSelect("far-side-balance", (entry) => Math.abs(entry.x - farX) + yardDistance(entry, ballPoint) * 0.08, outfield);
  add("far-side-balance", farSide, { x: farX, y: band(farSide) === "D" ? linePlan.lineY : nearestGoalSideTarget(ballPoint, direction, 0, 12).y }, "narrow-with-weak-side-awareness");
  const line = stableSelect("defensive-line-controller", (entry) => rolePreference(entry, "rest-defence"),
    (entry) => outfield(entry) && band(entry) === "D");
  add("defensive-line-controller", line, line ? { x: line.x, y: linePlan.lineY } : null,
    linePlan.offsideTrapStep ? "step-line-under-controlled-pressure" : linePlan.safetyDropYards ? "drop-line-without-ball-pressure" : "hold-coherent-line");
  for (const member of defenders.filter((entry) => outfield(entry) && band(entry) === "D" && !reserved.has(idOf(entry)))) {
    reserved.add(idOf(member));
    add("defensive-line-member", member, {
      x: clamp(8, 92, Number(member.formationAnchor?.x ?? member.x)),
      y: linePlan.lineY,
    }, "align-with-line-controller");
  }
  if (keeper) add("goalkeeper-cover-sweeper", keeper, point(keeper), "keeper-retains-own-response-model");

  const pressureState = pressure ? {
    ownerId: pressure.id,
    sinceMs: pressureChoice.transfer || !previous?.pressure ? nowMs : previous.pressure.sinceMs,
    etaMs: pressureChoice.selected.etaMs,
  } : null;
  return {
    intentions,
    pressure: pressureState,
    pressureCandidates: rankedPressure.map(({ entry, ...rest }) => rest),
    pressureTransfer: pressureChoice.transfer ? { ...pressureChoice.transfer, type: "pressure-handoff" } : null,
    trackers,
    trackerTransfers: transfers,
    defensiveLine: linePlan,
    tacticalInputs: {
      pressing: tactics.defending?.pressing ?? "standard",
      defensiveLine: tactics.defending?.defensiveLine ?? "standard",
      engagementLine: tactics.defending?.engagementLine ?? "standard",
      scheme: tactics.defending?.scheme ?? "man",
      strictness: tactics.defending?.strictness ?? 3,
      onLoss: tactics.transition?.onLoss ?? "balanced",
    },
  };
}

function defaultState() {
  return {
    version: 1,
    tick: 0,
    lastPossessionTeam: null,
    possessionChangedAtMs: null,
    activeAttack: null,
    activeDefense: null,
    pressure: null,
    trackers: {},
    reservations: {},
    history: [],
    latestEvidence: null,
  };
}

export function createCoordinationState(seed = 0) {
  return { ...defaultState(), seed: Number(seed) || 0 };
}

function historyWith(previous, additions) {
  return [...(previous?.history ?? []), ...additions].slice(-120);
}

function responsibilityAttributeInputs(entry, responsibility) {
  const labels = {
    "ball-carrier": ["Decisions", "Anticipation", "Vision", "Passing", "Technique"],
    "immediate-outlet": ["Decisions", "Teamwork", "Passing", "Technique"],
    "close-support": ["Teamwork", "Work Rate", "First Touch", "Agility"],
    "central-depth-runner": ["Off the Ball", "Anticipation", "Acceleration", "Pace"],
    "curved-channel-runner": ["Off the Ball", "Acceleration", "Pace", "Agility"],
    overlap: ["Work Rate", "Stamina", "Acceleration", "Pace"],
    underlap: ["Off the Ball", "Teamwork", "Agility", "Acceleration"],
    "third-man-runner": ["Teamwork", "Off the Ball", "Work Rate", "Anticipation"],
    "weak-side-runner": ["Off the Ball", "Work Rate", "Anticipation", "Pace"],
    "trailing-arrival": ["Work Rate", "Teamwork", "Anticipation", "Long Shots"],
    "recycle-outlet": ["Passing", "Vision", "Decisions", "Teamwork"],
    "switch-receiver": ["First Touch", "Technique", "Off the Ball", "Pace"],
    "circulation-support": ["Teamwork", "Work Rate", "Decisions", "Passing"],
    "near-post-runner": ["Off the Ball", "Anticipation", "Acceleration", "Finishing"],
    "central-box-target": ["Off the Ball", "Strength", "Heading", "Finishing"],
    "far-post-runner": ["Off the Ball", "Anticipation", "Pace", "Finishing"],
    "cutback-option": ["Decisions", "Technique", "Passing", "Teamwork"],
    "edge-of-box-arrival": ["Work Rate", "Anticipation", "Long Shots", "Technique"],
    "rest-defence": ["Positioning", "Anticipation", "Teamwork", "Stamina"],
    "primary-pressure": ["Decisions", "Anticipation", "Positioning", "Acceleration", "Pace"],
    "inside-cover": ["Positioning", "Anticipation", "Decisions", "Marking"],
    "depth-protector": ["Positioning", "Anticipation", "Acceleration", "Pace"],
    "runner-tracker": ["Marking", "Positioning", "Anticipation", "Acceleration", "Pace"],
    "recovery-screen": ["Work Rate", "Stamina", "Positioning", "Anticipation"],
    "far-side-balance": ["Positioning", "Teamwork", "Anticipation"],
    "defensive-line-controller": ["Positioning", "Decisions", "Anticipation", "Teamwork"],
    "defensive-line-member": ["Positioning", "Decisions", "Anticipation", "Teamwork"],
  }[responsibility] ?? ["Decisions", "Anticipation", "Teamwork"];
  return Object.fromEntries(labels.map((label) => [label, rating(entry, label)]));
}

export function coordinateInteraction({
  previous = null,
  players = [],
  ownerId = null,
  ballPoint = null,
  attackingDirectionByTeam = {},
  tacticsByTeam = {},
  velocities = {},
  nowMs = 0,
  flags = {},
} = {}) {
  const prior = previous ? clone(previous) : createCoordinationState();
  const owner = players.find((entry) => idOf(entry) === String(ownerId)) ?? null;
  if (!owner || !ballPoint) {
    const state = { ...prior, tick: (prior.tick || 0) + 1, activeAttack: null, activeDefense: null };
    return { state, attackCandidates: [], selectedAttack: null, selectedDefense: null, intentions: [], threats: [], evidence: null };
  }
  const possessionChanged = Boolean(prior.lastPossessionTeam && prior.lastPossessionTeam !== owner.team);
  const changedAt = possessionChanged ? nowMs : prior.possessionChangedAtMs;
  const attackDirection = attackingDirectionByTeam[owner.team] ?? owner.attackingDirection ?? "up";
  const attackers = players.filter((entry) => entry.team === owner.team);
  const defendingTeam = players.find((entry) => entry.team !== owner.team)?.team ?? null;
  const defendersAll = players.filter((entry) => entry.team === defendingTeam);
  const defenders = defendersAll.filter(outfield);
  const keeper = defendersAll.find((entry) => !outfield(entry)) ?? null;
  const attackTactics = tacticBundle(tacticsByTeam, owner.team);
  const candidates = attackCandidates({
    previous: { ...prior, possessionChangedAtMs: changedAt }, attackers, defenders, owner,
    ballPoint, direction: attackDirection, tactics: attackTactics, nowMs,
    flags: { ...flags, regain: flags.regain || possessionChanged },
  });
  const eligible = candidates.filter((entry) => entry.eligible && Number.isFinite(entry.utility))
    .sort((left, right) => right.utility - left.utility
      || ATTACKING_COORDINATION_FAMILIES.indexOf(left.family) - ATTACKING_COORDINATION_FAMILIES.indexOf(right.family));
  let selectedAttack = eligible[0]?.utility >= 48 ? eligible[0] : null;
  const additions = [];
  const oldAttack = prior.activeAttack;
  let aborted = null;
  if (oldAttack?.team === owner.team && nowMs - oldAttack.startedAtMs <= PATTERN_MAX_AGE_MS) {
    const oldCandidate = candidates.find((entry) => entry.family === oldAttack.family);
    const oldIntentions = prior.latestEvidence?.intentions ?? [];
    const oldOutlet = oldIntentions.find((entry) => ["immediate-outlet", "close-support", "third-man-runner"].includes(entry.responsibility));
    const blocked = oldAttack.family === "SHORT_COMBINATION"
      && (flags.laneClosed === true || (oldOutlet && laneIsClosed(ballPoint, oldOutlet.target, defenders)));
    if (blocked || flags.pressureWon || flags.restart || flags.looseBall) {
      aborted = {
        family: oldAttack.family,
        atMs: nowMs,
        reason: blocked ? "combination lane closed"
          : flags.restart ? "play stopped"
            : flags.looseBall ? "ball became loose" : "pressure reached the carrier",
      };
      additions.push({ type: "attack-aborted", ...aborted });
      selectedAttack = eligible.find((entry) => entry.family !== oldAttack.family && entry.utility >= 48) ?? null;
    } else if (oldCandidate?.eligible && (!selectedAttack || selectedAttack.utility < oldCandidate.utility + 8)) {
      selectedAttack = { ...oldCandidate, utility: oldCandidate.utility + 6, retainedByHysteresis: true };
    }
  }
  if (flags.completed && oldAttack) additions.push({ type: "attack-completed", family: oldAttack.family, atMs: nowMs, reason: flags.completed });
  const attackFamily = selectedAttack?.family ?? null;
  const attackIntentions = attackFamily ? allocateAttack(
    attackFamily, attackers, owner, ballPoint, attackDirection, attackTactics,
    prior.latestEvidence?.intentions ?? [], defendersAll,
  ) : [];
  if (attackFamily && attackFamily !== oldAttack?.family) additions.push({
    type: "attack-selected", family: attackFamily, atMs: nowMs,
    utility: selectedAttack.utility, previousFamily: oldAttack?.family ?? null,
  });

  const defendingDirection = attackingDirectionByTeam[defendingTeam]
    ?? (attackDirection === "up" ? "down" : "up");
  const defenseTactics = tacticBundle(tacticsByTeam, defendingTeam);
  const transitionLoss = possessionChanged
    && prior.lastPossessionTeam === defendingTeam
    && nowMs - changedAt <= COUNTERPRESS_WINDOW_MS;
  const selectedDefense = defendersAll.length ? defensiveFamily({ attackFamily, transitionLoss, defending: defenseTactics, flags }) : null;
  const defence = selectedDefense ? allocateDefence({
    family: selectedDefense, defenders, keeper, ballPoint, direction: defendingDirection,
    attackIntentions, previous: prior, nowMs, velocities, tactics: defenseTactics,
  }) : { intentions: [], pressure: null, pressureCandidates: [], trackers: {}, trackerTransfers: [], defensiveLine: null, tacticalInputs: {} };
  if (selectedDefense !== prior.activeDefense?.family) additions.push({
    type: "defence-selected", family: selectedDefense, atMs: nowMs,
    previousFamily: prior.activeDefense?.family ?? null,
  });
  if (defence.pressureTransfer) additions.push(defence.pressureTransfer);
  additions.push(...defence.trackerTransfers);

  let intentions = [...attackIntentions, ...defence.intentions];
  const formerClaimantIds = [...new Set([
    ...(flags.formerClaimantIds ?? []),
    ...(flags.formerClaimantId ? [flags.formerClaimantId] : []),
  ].map(String))];
  for (const formerClaimantId of formerClaimantIds) {
    const former = players.find((entry) => String(entry.id) === formerClaimantId);
    if (former && String(former.id) !== String(owner.id)) {
      const sameTeam = former.team === owner.team;
      const replacement = makeIntention(
        former,
        former.team,
        sameTeam ? (attackFamily ?? "REGAIN_QUICK_RELEASE") : (selectedDefense ?? "TRANSITION_DELAY_AND_RECOVER"),
        sameTeam ? "close-support" : "shape-recovery",
        sameTeam ? offset(ballPoint, ballPoint.x < 50 ? 6 : -6, -5, attackDirection)
          : nearestGoalSideTarget(ballPoint, defendingDirection, 0, 10),
        sameTeam ? "former-claimant-supports-new-owner" : "former-claimant-recovers-shape",
      );
      intentions = intentions.filter((entry) => String(entry.playerId) !== String(former.id));
      intentions.push(replacement);
      additions.push({
        type: "claimant-follow-up",
        playerId: former.id,
        responsibility: replacement.responsibility,
        atMs: nowMs,
        reason: flags.claimantTransferReason ?? "loose-ball claim transferred",
      });
    }
  }
  if (flags.activeClaimantId && String(flags.activeClaimantId) !== String(owner.id)) {
    const claimant = players.find((entry) => String(entry.id) === String(flags.activeClaimantId));
    if (claimant) {
      intentions = intentions.filter((entry) => String(entry.playerId) !== String(claimant.id));
      intentions.push(makeIntention(
        claimant,
        claimant.team,
        "LOOSE_BALL_HANDOFF",
        "loose-ball-claimant",
        { x: ballPoint.x, y: ballPoint.y },
        "current physically reachable loose-ball chase owner",
      ));
    }
  }
  const duplicateReservations = intentions.reduce((counts, entry) => {
    const key = String(entry.playerId);
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const reservationConflicts = Object.entries(duplicateReservations)
    .filter(([, count]) => count > 1)
    .map(([playerId, count]) => ({ playerId, count, reason: "participant received incompatible concurrent responsibilities" }));
  const reservations = Object.fromEntries(intentions.map((entry) => [String(entry.playerId), {
    family: entry.family, responsibility: entry.responsibility, team: entry.team,
  }]));
  const threats = attackIntentions.filter((entry) => entry.threat).map((entry) => {
    const runner = players.find((player) => String(player.id) === String(entry.playerId));
    const goalDistance = yardDistance(entry.target, ownGoalPoint(defendingDirection));
    return {
      playerId: entry.playerId,
      responsibility: entry.responsibility,
      target: entry.target,
      danger: clamp(1, 10, 11 - goalDistance / 9
        + averageRating(runner, ["Off the Ball", "Anticipation", "Pace"]) / 10),
    };
  }).sort((left, right) => right.danger - left.danger
    || String(left.playerId).localeCompare(String(right.playerId)))
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
  const activeAttack = selectedAttack ? {
    family: selectedAttack.family,
    team: owner.team,
    startedAtMs: selectedAttack.family === oldAttack?.family ? oldAttack.startedAtMs : nowMs,
    utility: selectedAttack.utility,
    status: "active",
  } : null;
  const evidence = {
    timeMs: nowMs,
    trigger: flags.reason ?? "geometry-replan",
    candidates: candidates.map((entry) => ({ ...entry, utility: Number.isFinite(entry.utility) ? entry.utility : null })),
    selectedAttack: activeAttack,
    selectedDefense: selectedDefense ? { family: selectedDefense, team: defendingTeam, tacticalInputs: defence.tacticalInputs } : null,
    intentions,
    reservations,
    reservationConflicts,
    participantAttributes: Object.fromEntries(intentions.map((intent) => {
      const participant = players.find((entry) => String(entry.id) === String(intent.playerId));
      return [String(intent.playerId), {
        responsibility: intent.responsibility,
        inputs: responsibilityAttributeInputs(participant, intent.responsibility),
      }];
    })),
    threats,
    pressureCandidates: defence.pressureCandidates,
    pressure: defence.pressure,
    trackers: defence.trackers,
    defensiveLine: defence.defensiveLine,
    transfers: [defence.pressureTransfer, ...defence.trackerTransfers].filter(Boolean),
    aborted,
    completed: flags.completed && oldAttack
      ? { family: oldAttack.family, atMs: nowMs, reason: flags.completed }
      : null,
    fallbackReason: selectedAttack ? null
      : aborted?.reason ?? (eligible.length ? "candidate utility below activation threshold" : "no eligible attacking family"),
    world: {
      ball: { x: ballPoint.x, y: ballPoint.y },
      players: Object.fromEntries(players.map((entry) => [String(entry.id), {
        position: point(entry),
        velocity: clone(velocities?.[String(entry.id)] ?? { x: 0, y: 0 }),
        facing: facingFromVelocity(velocities?.[String(entry.id)]),
      }])),
    },
  };
  const state = {
    ...prior,
    tick: (prior.tick || 0) + 1,
    lastPossessionTeam: owner.team,
    possessionChangedAtMs: changedAt,
    activeAttack,
    activeDefense: selectedDefense ? { family: selectedDefense, team: defendingTeam, startedAtMs: selectedDefense === prior.activeDefense?.family ? prior.activeDefense.startedAtMs : nowMs } : null,
    pressure: defence.pressure,
    trackers: defence.trackers,
    reservations,
    history: historyWith(prior, additions),
    latestEvidence: evidence,
  };
  return { state, attackCandidates: candidates, selectedAttack: activeAttack, selectedDefense: evidence.selectedDefense, intentions, threats, evidence };
}

export function applyCoordinationCandidateBiases(candidates = [], coordination = null) {
  const active = coordination?.selectedAttack ?? coordination?.state?.activeAttack ?? null;
  const evidence = coordination?.evidence ?? coordination?.state?.latestEvidence ?? null;
  if (!active || !evidence) return candidates;
  const responsibilities = new Map(evidence.intentions.map((entry) => [String(entry.playerId), entry.responsibility]));
  const pressureEta = Number(evidence.pressure?.etaMs ?? Infinity);
  const insideCover = evidence.intentions.some((entry) => entry.responsibility === "inside-cover"
    && yardDistance(entry.target, evidence.intentions.find((item) => item.responsibility === "ball-carrier")?.target ?? entry.target) < 10);
  for (const candidate of candidates) {
    let delta = 0;
    const reasons = [];
    const targetRole = responsibilities.get(String(candidate.target?.id ?? ""));
    if (active.family === "REGAIN_QUICK_RELEASE") {
      if (candidate.type === "pass" && ["immediate-outlet", "close-support"].includes(targetRole)) { delta += 0.34; reasons.push("quick-release outlet"); }
      if (["carry", "dribble"].includes(candidate.type)) { delta += 0.08; reasons.push("transition space"); }
    } else if (active.family === "WIDE_TRANSITION") {
      if (candidate.type === "pass" && ["curved-channel-runner", "overlap", "weak-side-runner"].includes(targetRole)) { delta += 0.36; reasons.push("allocated wide transition lane"); }
      if (["carry", "cross"].includes(candidate.type)) { delta += 0.18; reasons.push("continue wide progression"); }
      if (insideCover && ["carry", "dribble"].includes(candidate.type)) { delta -= 0.16; reasons.push("inside cover closed"); }
    } else if (active.family === "SHORT_COMBINATION") {
      if (candidate.type === "pass" && ["immediate-outlet", "close-support", "third-man-runner"].includes(targetRole)) { delta += 0.38; reasons.push("combination participant"); }
      if (candidate.type === "hold") { delta += 0.06; reasons.push("retain triangle"); }
    } else if (active.family === "RECYCLE_AND_SWITCH") {
      if (candidate.type === "pass" && targetRole === "recycle-outlet") { delta += 0.34; reasons.push("recycle behind pressure"); }
      if (candidate.type === "pass" && targetRole === "switch-receiver") { delta += 0.42; reasons.push("weak-side switch is available"); }
      if (candidate.type === "pass" && targetRole === "circulation-support") { delta += 0.24; reasons.push("circulation connector"); }
      if (["carry", "dribble", "through"].includes(candidate.type)) { delta -= 0.14; reasons.push("crowded ball-side corridor"); }
    } else if (active.family === "PENALTY_AREA_OCCUPATION") {
      if (candidate.type === "pass" && ["near-post-runner", "central-box-target", "far-post-runner", "cutback-option"].includes(targetRole)) {
        delta += 0.32;
        reasons.push("occupied penalty-area lane");
      }
      if (candidate.type === "cross") { delta += 0.2; reasons.push("multiple box lanes occupied"); }
      if (candidate.type === "hold") { delta -= 0.08; reasons.push("box movement window may close"); }
    }
    if (pressureEta < 550 && ["through", "carry", "dribble"].includes(candidate.type)) {
      delta -= 0.18;
      reasons.push("pressure arrival precedes action window");
    }
    candidate.utility += delta;
    candidate.coordination = { family: active.family, delta, reasons, targetResponsibility: targetRole ?? null };
  }
  return candidates;
}

export function coordinationCounterfactual(result) {
  return {
    selectedAttack: result?.selectedAttack?.family ?? null,
    selectedDefense: result?.selectedDefense?.family ?? null,
    candidateUtilities: Object.fromEntries((result?.attackCandidates ?? []).map((entry) => [entry.family, entry.utility])),
    reservations: result?.state?.reservations ?? {},
  };
}
