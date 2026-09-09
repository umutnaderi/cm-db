// Team instructions are authored once per side and consumed by the same
// decision and shape systems that move the players. This module owns the
// vocabulary and normalization so the editor, setup model and engine cannot
// silently disagree about what a stored value means.

export const TEAM_MENTALITIES = Object.freeze([
  "defensive", "cautious", "balanced", "positive", "attacking",
]);
export const TEAM_WIDTHS = Object.freeze(["narrow", "balanced", "wide"]);
export const TEAM_KICKOFFS = Object.freeze([
  "mixed", "keep-possession", "play-backwards", "build-midfield", "attack-quickly",
  "play-into-space", "go-wide", "switch-flank", "target-forward", "go-long", "territory",
]);
export const TEAM_FOCUS_PLAY = Object.freeze(["mixed", "left", "centre", "right"]);
export const TEAM_DRIBBLING = Object.freeze(["less", "balanced", "more"]);
export const TEAM_CREATIVITY = Object.freeze(["disciplined", "balanced", "expressive"]);
export const TEAM_FINAL_THIRD = Object.freeze([
  "mixed", "work-ball", "shoot-on-sight", "early-crosses",
]);
export const TEAM_TIME_WASTING = Object.freeze(["never", "sometimes", "often"]);
export const TEAM_GAIN_TRANSITIONS = Object.freeze(["hold-shape", "balanced", "counter"]);
export const TEAM_LOSS_TRANSITIONS = Object.freeze(["regroup", "balanced", "counter-press"]);
export const TEAM_PRESSING = Object.freeze(["low", "standard", "high"]);
export const TEAM_TACKLING = Object.freeze(["stay-on-feet", "balanced", "get-stuck-in"]);
export const TEAM_DEFENSIVE_LINES = Object.freeze(["deep", "standard", "high"]);
export const TEAM_ENGAGEMENT_LINES = Object.freeze(["low", "standard", "high"]);
export const TEAM_PRESSING_TRAPS = Object.freeze(["none", "inside", "outside"]);
export const TEAM_CROSS_ENGAGEMENT = Object.freeze(["normal", "stop", "invite"]);

export const DEFAULT_TEAM_ATTACKING = Object.freeze({
  style: "possession",
  kickoff: "mixed",
  mentality: "balanced",
  directness: 2,
  width: "balanced",
  shooting: "balanced",
  tempo: "balanced",
  focusPlay: "mixed",
  dribbling: "balanced",
  creativity: "balanced",
  finalThird: "mixed",
  timeWasting: "never",
  passIntoSpace: false,
  playOutOfDefence: false,
});

export const DEFAULT_TEAM_TRANSITION = Object.freeze({
  onGain: "balanced",
  onLoss: "balanced",
});

export const DEFAULT_TEAM_DEFENDING = Object.freeze({
  scheme: "man",
  strictness: 3,
  pressing: "standard",
  tackling: "balanced",
  defensiveLine: "standard",
  engagementLine: "standard",
  offsideTrap: false,
  preventShortGk: false,
  pressingTrap: "none",
  crossEngagement: "normal",
});

function oneOf(value, options, fallback) {
  return options.includes(value) ? value : fallback;
}

function integer(value, minimum, maximum, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(parsed)));
}

export function normalizeTeamAttacking(value = {}) {
  return {
    style: oneOf(value.style, ["possession", "direct", "long-ball", "wing"], DEFAULT_TEAM_ATTACKING.style),
    kickoff: oneOf(value.kickoff, TEAM_KICKOFFS, "mixed"),
    mentality: oneOf(value.mentality, TEAM_MENTALITIES, DEFAULT_TEAM_ATTACKING.mentality),
    directness: integer(value.directness, 1, 5, DEFAULT_TEAM_ATTACKING.directness),
    width: oneOf(value.width, TEAM_WIDTHS, DEFAULT_TEAM_ATTACKING.width),
    shooting: oneOf(value.shooting, ["discourage", "balanced", "encourage"], DEFAULT_TEAM_ATTACKING.shooting),
    tempo: oneOf(value.tempo, ["slow", "balanced", "quick"], DEFAULT_TEAM_ATTACKING.tempo),
    focusPlay: oneOf(value.focusPlay, TEAM_FOCUS_PLAY, DEFAULT_TEAM_ATTACKING.focusPlay),
    dribbling: oneOf(value.dribbling, TEAM_DRIBBLING, DEFAULT_TEAM_ATTACKING.dribbling),
    creativity: oneOf(value.creativity, TEAM_CREATIVITY, DEFAULT_TEAM_ATTACKING.creativity),
    finalThird: oneOf(value.finalThird, TEAM_FINAL_THIRD, DEFAULT_TEAM_ATTACKING.finalThird),
    timeWasting: oneOf(value.timeWasting, TEAM_TIME_WASTING, DEFAULT_TEAM_ATTACKING.timeWasting),
    passIntoSpace: value.passIntoSpace === true,
    playOutOfDefence: value.playOutOfDefence === true,
  };
}

export function normalizeTeamTransition(value = {}) {
  return {
    onGain: oneOf(value.onGain, TEAM_GAIN_TRANSITIONS, DEFAULT_TEAM_TRANSITION.onGain),
    onLoss: oneOf(value.onLoss, TEAM_LOSS_TRANSITIONS, DEFAULT_TEAM_TRANSITION.onLoss),
  };
}

export function normalizeTeamDefending(value = {}) {
  return {
    scheme: oneOf(value.scheme, ["man", "zonal"], DEFAULT_TEAM_DEFENDING.scheme),
    strictness: integer(value.strictness ?? value.tightness, 1, 5, DEFAULT_TEAM_DEFENDING.strictness),
    pressing: oneOf(value.pressing, TEAM_PRESSING, DEFAULT_TEAM_DEFENDING.pressing),
    tackling: oneOf(value.tackling, TEAM_TACKLING, DEFAULT_TEAM_DEFENDING.tackling),
    defensiveLine: oneOf(value.defensiveLine, TEAM_DEFENSIVE_LINES, DEFAULT_TEAM_DEFENDING.defensiveLine),
    engagementLine: oneOf(value.engagementLine, TEAM_ENGAGEMENT_LINES, DEFAULT_TEAM_DEFENDING.engagementLine),
    offsideTrap: value.offsideTrap === true,
    preventShortGk: value.preventShortGk === true,
    pressingTrap: oneOf(value.pressingTrap, TEAM_PRESSING_TRAPS, DEFAULT_TEAM_DEFENDING.pressingTrap),
    crossEngagement: oneOf(value.crossEngagement, TEAM_CROSS_ENGAGEMENT, DEFAULT_TEAM_DEFENDING.crossEngagement),
  };
}

function forwardProgression(from, to, attackingDirection) {
  if (!to) return 0;
  const direction = attackingDirection === "up" ? -1 : 1;
  return Math.max(-1, Math.min(1, ((Number(to.y) - Number(from?.y)) * direction) / 25));
}

function targetPoint(candidate) {
  return candidate?.moveTo ?? candidate?.target ?? null;
}

function isLeftForTeam(point, attackingDirection) {
  if (!point) return false;
  return attackingDirection === "up" ? Number(point.x) < 42 : Number(point.x) > 58;
}

function isRightForTeam(point, attackingDirection) {
  if (!point) return false;
  return attackingDirection === "up" ? Number(point.x) > 58 : Number(point.x) < 42;
}

/**
 * Applies team instructions as additive choice biases. Candidate legality and
 * execution remain owned by the existing engine: instructions can encourage
 * a legal action, but cannot invent a pass, shot, run or dribble.
 */
export function applyTeamInstructionBiases(candidates, owner, attackingDirection, rawSettings = {}) {
  const settings = normalizeTeamAttacking(rawSettings);
  const ambitious = new Set(["through", "cross", "shoot", "dribble"]);
  const releases = new Set(["pass", "through", "cross", "throw-short", "throw-long", "punt"]);
  const carries = new Set(["carry", "dribble", "back-to-goal"]);
  const buildUpOwner = owner?.role === "keeper"
    || ["GK", "SW", "DC", "DL", "DR", "WBL", "WBR", "DMC"].includes(String(owner?.positionalSlot ?? "").toUpperCase());
  const mentalityBias = {
    defensive: -0.22, cautious: -0.10, balanced: 0, positive: 0.10, attacking: 0.22,
  }[settings.mentality];

  for (const candidate of candidates) {
    const point = targetPoint(candidate);
    const progression = forwardProgression(owner, point, attackingDirection);
    let bias = progression * mentalityBias;
    if (candidate.type === "hold") bias -= mentalityBias * 0.9;
    if (ambitious.has(candidate.type)) bias += mentalityBias * 0.55;

    if (settings.focusPlay !== "mixed" && point) {
      const matches = settings.focusPlay === "centre"
        ? Math.abs(Number(point.x) - 50) <= 16
        : settings.focusPlay === "left"
          ? isLeftForTeam(point, attackingDirection)
          : isRightForTeam(point, attackingDirection);
      bias += matches ? 0.20 : -0.08;
    }

    if (settings.passIntoSpace && candidate.type === "through") bias += 0.30;
    if (settings.passIntoSpace && candidate.type === "pass" && candidate.moveTo) bias += 0.16;

    if (settings.dribbling === "more") bias += carries.has(candidate.type) ? 0.24 : 0;
    if (settings.dribbling === "less") bias += carries.has(candidate.type) ? -0.30 : releases.has(candidate.type) ? 0.06 : 0;

    if (settings.creativity === "expressive") bias += ambitious.has(candidate.type) ? 0.14 : 0;
    if (settings.creativity === "disciplined") bias += ambitious.has(candidate.type) ? -0.16 : candidate.type === "pass" ? 0.08 : 0;

    if (settings.finalThird === "work-ball") bias += candidate.type === "pass" ? 0.12 : ["shoot", "cross"].includes(candidate.type) ? -0.24 : 0;
    if (settings.finalThird === "shoot-on-sight" && candidate.type === "shoot") bias += 0.32;
    if (settings.finalThird === "early-crosses" && candidate.type === "cross") bias += 0.32;

    if (settings.timeWasting === "sometimes" && candidate.type === "hold") bias += 0.20;
    if (settings.timeWasting === "often") bias += candidate.type === "hold" ? 0.42 : ambitious.has(candidate.type) ? -0.10 : 0;

    if (settings.playOutOfDefence && buildUpOwner) {
      const shortRelease = ["pass", "throw-short", "release-to-feet"].includes(candidate.type)
        && (!point || Math.abs(Number(point.y) - Number(owner?.y)) < 24);
      bias += shortRelease ? 0.22 : ["punt", "throw-long", "through"].includes(candidate.type) ? -0.22 : 0;
    }

    candidate.utility += bias;
    candidate.teamInstructionBias = (candidate.teamInstructionBias ?? 0) + bias;
  }
  return candidates;
}

/** Applies the selected tackling approach after distance feasibility. */
export function applyTacklingInstruction(engagementType, tackling, {
  canStand = true, canSlide = true,
} = {}) {
  if (tackling === "stay-on-feet") {
    if (engagementType === "D.SLIDE") return canStand ? "D.STAND" : "D.DUEL";
    return engagementType;
  }
  if (tackling === "get-stuck-in") {
    if (canSlide) return "D.SLIDE";
    if (canStand) return "D.STAND";
  }
  return engagementType;
}
