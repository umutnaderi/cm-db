// Stage 1 of the one-on-one decision system (see MATCH_LAB_PLAN.md): a
// shared, DOM-free module for how a striker facing an isolated goalkeeper
// perceives the situation and picks a candidate action. Match Lab Free Play
// now calls it for genuine isolated chances and sends the chosen action into
// the Stage 2 resolvers; the production draft-run engine remains untouched.
//
// Module boundary (why this file knows nothing about markers or pixels):
// match-lab.js converts constructed marker positions into pitch-relative
// yards and calls in here; this file only ever sees that already-converted,
// caller-supplied context. It has no idea what a DOM element is, so the
// exact same functions are ready to be called by a real-match integration
// later without any changes here -- only the caller-side conversion differs.
import { clamp, playerAttribute, weightedChoice } from "./matchEngineCore.js";

export const ONE_ON_ONE_ACTIONS = [
  "place-left", "place-right", "blast", "shoot-early", "chip", "round-keeper", "square-pass",
];

// Attributes that drive each action's base "can this player actually pull
// it off" fit -- deliberately never includes anything about the keeper.
// The striker's decision (this file) reads only the striker's own
// attributes and the perceived situation; the keeper's own attributes only
// ever affect execution/reaction (Stage 2), never what the striker "knows."
const CANDIDATE_ATTRIBUTES = {
  "place-left": ["Finishing", "Technique", "Composure", "Decisions"],
  "place-right": ["Finishing", "Technique", "Composure", "Decisions"],
  blast: ["Finishing", "Technique"],
  "shoot-early": ["Decisions", "Anticipation", "Composure"],
  chip: ["Technique", "Flair", "Composure"],
  "round-keeper": ["Dribbling", "Flair", "Acceleration", "Agility", "Balance"],
  "square-pass": ["Decisions", "Teamwork", "Passing"],
};

function avgAttr(player, labels) {
  return labels.reduce((sum, label) => sum + playerAttribute(player, label), 0) / labels.length;
}

// --- Perception --------------------------------------------------------
// Turns a truthful, geometry-only actualKeeperState into what THIS striker
// perceives -- distinct objects on purpose, so a caller can display both
// side by side (see the diagnostic report shape in chooseOneOnOneAction's
// doc comment) and so nothing downstream can accidentally read ground
// truth. Only the fields that are genuinely knowable from a static
// position (depth/lateral offset/exposed side) can be misread; the fields
// that are fundamentally NOT knowable from a marker snapshot at all
// (movementDirection/closingSpeed/set) are never touched here -- they pass
// through exactly as given (null, until a real keeper-behaviour model
// exists to generate them), never inferred or guessed regardless of how
// sharp or dull the perceiving player is. Guessing "rushing" from depth
// alone would be exactly the kind of silent inference this must not do.
export function perceiveKeeperState(actualKeeperState, shooter, decisionRandom) {
  const perceptionSkill = avgAttr(shooter, ["Decisions", "Anticipation", "Composure"]);
  // 13/20 is this database's rough "average pro" center (same convention
  // selectStrikeMechanics() uses elsewhere for its own thresholds) -- misread
  // chance sits at 0 there, rises for weaker perceivers, never goes negative.
  const misreadChance = clamp(0, 0.3, (13 - perceptionSkill) / 30);
  const misread = decisionRandom() < misreadChance;
  // A small baseline imprecision always applies (nobody reads a keeper's
  // exact yardage to the centimeter); a genuine misread widens it a lot.
  const noiseScale = misread ? 3 : 0.6;
  const depthNoise = (decisionRandom() * 2 - 1) * noiseScale;
  const lateralNoise = (decisionRandom() * 2 - 1) * noiseScale;
  const perceivedDepth = actualKeeperState.depthFromGoalLineYards === null
    ? null
    : Math.max(0, actualKeeperState.depthFromGoalLineYards + depthNoise);
  const perceivedLateral = actualKeeperState.lateralOffsetYards === null
    ? null
    : actualKeeperState.lateralOffsetYards + lateralNoise;
  // A genuine misread can flip which side looks open; ordinary reads (even
  // with the small baseline noise above) keep the real side.
  const exposedSide = misread && actualKeeperState.exposedSide !== "balanced"
    ? (actualKeeperState.exposedSide === "left" ? "right" : "left")
    : actualKeeperState.exposedSide;
  return {
    depthFromGoalLineYards: perceivedDepth,
    lateralOffsetYards: perceivedLateral,
    distanceToShooterYards: actualKeeperState.distanceToShooterYards,
    exposedSide,
    movementDirection: actualKeeperState.movementDirection ?? null,
    closingSpeed: actualKeeperState.closingSpeed ?? null,
    set: actualKeeperState.set ?? null,
    misread,
  };
}

// --- Candidate utility scoring -------------------------------------------
// tactical fit -- how well THIS action suits the perceived situation.
// Every branch treats an unknown (null) field as neutral (0), never as
// "assume the worst/best case" -- a field this file can't truthfully know
// must not silently bias the decision either direction.
function tacticalFit(action, ctx) {
  const k = ctx.perceivedKeeperState;
  switch (action) {
    case "place-left":
      return k.exposedSide === "left" ? 0.35 : k.exposedSide === "balanced" ? 0.1 : -0.15;
    case "place-right":
      return k.exposedSide === "right" ? 0.35 : k.exposedSide === "balanced" ? 0.1 : -0.15;
    case "chip":
      // The one signal this can honestly lean on: how far off the line the
      // keeper actually looks. Not "is he rushing" (unknowable) -- just
      // "how much room is there over him right now."
      return k.depthFromGoalLineYards === null ? 0 : clamp(-0.2, 0.4, (k.depthFromGoalLineYards - 3) * 0.08);
    case "round-keeper":
      // Physical closeness is the honest proxy for "worth trying to beat
      // him with the ball" -- there's no "is he set/off balance" signal to
      // lean on, and this never reads the keeper's own attributes (whether
      // it actually works is Stage 2's job, not this decision's).
      return k.distanceToShooterYards === null ? 0 : clamp(-0.2, 0.3, (8 - k.distanceToShooterYards) * 0.04);
    case "blast":
      return clamp(0, 0.25, ctx.distance != null ? (12 - Math.min(12, ctx.distance)) * 0.01 : 0)
        + ctx.defenderPressure * 0.15;
    case "shoot-early":
      return ctx.defenderPressure * 0.25;
    case "square-pass":
      return ctx.availableTeammates?.length ? 0.05 : -0.4;
    default:
      return 0;
  }
}

// Slower, more technical actions carry more risk the more pressure's on;
// shoot-early is deliberately excluded -- it's the direct answer to
// pressure, already rewarded in tacticalFit() above, not a victim of it.
function situationalRisk(action, ctx) {
  if (action === "round-keeper" || action === "chip") return ctx.defenderPressure * 0.18;
  if (action === "square-pass") return ctx.defenderPressure * 0.1;
  return 0;
}

// Public so a caller can inspect/test scoring independent of final
// selection. ctx: { shooter, perceivedKeeperState, defenderPressure,
// shotAngle, distance, availableTeammates, decisionRandom }.
// square-pass is only ever a real candidate when a real teammate is
// actually placed and available -- never offered as a scoreable-but-
// nonsensical option with nothing to pass to (per the Stage 2 review: "do
// not invent a recipient"). Excluded from the list entirely, not just
// scored low, so it can never appear in the candidates array at all.
function availableActions(ctx) {
  return ctx.availableTeammates?.length
    ? ONE_ON_ONE_ACTIONS
    : ONE_ON_ONE_ACTIONS.filter((action) => action !== "square-pass");
}

export function scoreOneOnOneCandidates(ctx) {
  return availableActions(ctx).map((action) => {
    const skillFit = avgAttr(ctx.shooter, CANDIDATE_ATTRIBUTES[action]) / 20;
    const fit = tacticalFit(action, ctx);
    const risk = situationalRisk(action, ctx);
    // Small, bounded, and drawn from the caller's own decisionRandom --
    // never Math.random() -- so the top-scoring candidate doesn't
    // mechanically win every single time for identical geometry/attributes.
    const jitter = (ctx.decisionRandom() * 2 - 1) * 0.05;
    const utility = skillFit + fit - risk + jitter;
    return { action, utility: Math.round(utility * 1000) / 1000 };
  });
}

// How sharply the final pick favors the top-scoring candidate -- a
// high-Decisions/Composure player should usually land on the better
// option without being mechanically perfect; a poor one should genuinely
// pick badly sometimes, not just "slightly less optimally."
function decisionSharpness(shooter) {
  const quality = avgAttr(shooter, ["Decisions", "Composure"]);
  return clamp(1, 4.5, 1 + (quality - 6) * 0.25);
}

function reasonsFor(action, ctx) {
  const k = ctx.perceivedKeeperState;
  const reasons = [];
  if (action === "chip" && k.depthFromGoalLineYards !== null && k.depthFromGoalLineYards > 3) reasons.push("keeper-advanced");
  if ((action === "place-left" || action === "place-right") && k.exposedSide !== "balanced") {
    reasons.push(`keeper-exposed-${k.exposedSide}`);
  }
  if (action === "round-keeper" && k.distanceToShooterYards !== null && k.distanceToShooterYards < 6) reasons.push("keeper-close");
  if ((action === "shoot-early" || action === "blast") && ctx.defenderPressure > 0.5) reasons.push("under-pressure");
  const skillLabel = CANDIDATE_ATTRIBUTES[action][0];
  if (avgAttr(ctx.shooter, CANDIDATE_ATTRIBUTES[action]) / 20 > 0.75) reasons.push(`high-${skillLabel.toLowerCase().replace(/\s+/g, "-")}`);
  return reasons;
}

// The main entry point. ctx: { shooter, perceivedKeeperState,
// defenderPressure, shotAngle, distance, availableTeammates, decisionRandom }
// -- deliberately no actualKeeperState parameter: this function can only
// ever see what the striker perceives, never ground truth. A caller
// wanting the full side-by-side diagnostic report merges its own
// actualKeeperState into this function's return value itself (see
// match-lab.js), which keeps that boundary enforced by the type signature,
// not just by convention.
//
// Returns { selectedAction, candidates: [{action, utility}] sorted
// descending, reasons: string[] for the selected action }.
export function chooseOneOnOneAction(ctx) {
  const candidates = scoreOneOnOneCandidates(ctx);
  const sharpness = decisionSharpness(ctx.shooter);
  const minUtility = Math.min(...candidates.map((c) => c.utility));
  // Shift utilities positive before exponentiating (weightedChoice needs
  // non-negative weights); the exponent is what turns "sharpness" into
  // "how much the best-scoring option actually dominates the pick."
  const weighted = candidates.map((c) => ({
    value: c.action,
    weight: Math.max(0.001, (c.utility - minUtility + 0.05) ** sharpness),
  }));
  const selectedAction = weightedChoice(weighted, ctx.decisionRandom);
  return {
    selectedAction,
    candidates: candidates.slice().sort((a, b) => b.utility - a.utility),
    reasons: reasonsFor(selectedAction, ctx),
  };
}
