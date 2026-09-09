// Match setup -- the pure, DOM-free model of "what is being set up",
// before any of it is resolved into a running possession.
//
// This is deliberately NOT the engine's own runtime state. It is the
// authored intent: which format, which squads, which shape, who is in,
// where they stand, and what each of them has been ASKED to do. The engine
// consumes it; nothing here simulates anything, reads the DOM, or calls
// out to a database.
//
// ---------------------------------------------------------------------------
// The four fields that must never be conflated
// ---------------------------------------------------------------------------
//
//   positionalSlot   WHERE this shirt stands in the shape ("DC", "AMR").
//                    Owned by formationTemplates.js. Changing the
//                    formation changes this.
//   tacticalRole     WHAT KIND of player they are asked to be in that slot
//                    ("ball-playing-defender", "deep-lying-playmaker").
//                    A role is a standing instruction, not a position.
//   duty             HOW FAR they take that role ("defend", "support",
//                    "attack"). The same role at a different duty is a
//                    genuinely different job.
//   shootingInstruction / tempoInstruction
//                    Optional player overrides. "inherit" follows the
//                    team's instruction; an explicit value replaces it for
//                    this player. Goalkeepers do not expose either control.
//   withBallPosition / withoutBallPosition
//                    Optional phase anchors. A null value follows the base
//                    formation position. These guide the team shape planner;
//                    live jobs and physical motion still decide where a
//                    player can actually get in the available time.
//   engineJob        What the ENGINE currently has them doing this instant
//                    ("recovery-track", "press", "hold-width"). Owned by
//                    the engine, changes several times a possession, and
//                    is never authored here -- it is only carried so a
//                    debugger can show the authored intent beside the live
//                    behaviour. See MATCH_ENGINE_ARCHITECTURE.md.
//
// Collapsing any of these into the others is the mistake this module
// exists to prevent: "AMR" is not a role, "attack" is not a position, and
// what the engine is doing right now is not what the manager asked for.

import {
  MATCH_FORMATS, MATCH_FORMAT_NAMES, FORMATION_NAMES, FORMATION_STYLES,
  orientSlots, projectFormation, roleBand,
} from "./formationTemplates.js";
import { createTeamCornerPlan } from "./cornerSetup.js";
import {
  normalizeTeamAttacking, normalizeTeamDefending, normalizeTeamTransition,
} from "./teamInstructions.js";

export { MATCH_FORMAT_NAMES, FORMATION_NAMES, FORMATION_STYLES };

const freezeRoleMap = (source) => Object.freeze(Object.fromEntries(
  Object.entries(source).map(([position, roles]) => [position, Object.freeze([...roles])]),
));
const NO_TACTICAL_ROLES = Object.freeze([]);

// Tactical roles belong to exact positional slots. This is intentionally
// more precise than roleBand(): a DMC and an AMC are both midfielders to the
// formation projector, but asking either one to play the other's role would
// produce incoherent movement and a misleading editor.
export const TACTICAL_ROLES_BY_POSITION = freezeRoleMap({
  GK: [
    "goalkeeper", "sweeper-keeper", "ball-playing-goalkeeper",
    "line-holding-goalkeeper", "no-nonsense-goalkeeper",
  ],
  SW: ["sweeper", "libero", "ball-playing-defender"],
  DC: [
    "central-defender", "ball-playing-defender", "no-nonsense-centre-back",
    "stopper", "covering-defender", "libero",
  ],
  DL: [
    "full-back", "wing-back", "inverted-full-back", "inverted-wing-back",
    "playmaking-wing-back", "no-nonsense-full-back",
  ],
  DR: [
    "full-back", "wing-back", "inverted-full-back", "inverted-wing-back",
    "playmaking-wing-back", "no-nonsense-full-back",
  ],
  WBL: [
    "wing-back", "complete-wing-back", "inverted-wing-back",
    "playmaking-wing-back", "defensive-wing-back",
  ],
  WBR: [
    "wing-back", "complete-wing-back", "inverted-wing-back",
    "playmaking-wing-back", "defensive-wing-back",
  ],
  DMC: [
    "defensive-midfielder", "ball-winning-midfielder", "anchor", "half-back",
    "deep-lying-playmaker", "regista", "segundo-volante",
  ],
  MC: [
    "central-midfielder", "box-to-box", "ball-winning-midfielder",
    "deep-lying-playmaker", "advanced-playmaker", "roaming-playmaker",
    "mezzala", "carrilero", "half-winger",
  ],
  ML: [
    "wide-midfielder", "winger", "inverted-winger", "wide-playmaker",
    "defensive-winger", "wide-target-player",
  ],
  MR: [
    "wide-midfielder", "winger", "inverted-winger", "wide-playmaker",
    "defensive-winger", "wide-target-player",
  ],
  AMC: [
    "attacking-midfielder", "advanced-playmaker", "trequartista", "enganche",
    "shadow-striker", "second-striker", "classic-ten",
  ],
  AML: [
    "winger", "inside-forward", "inverted-winger", "wide-playmaker",
    "advanced-playmaker", "raumdeuter", "wide-forward",
  ],
  AMR: [
    "winger", "inside-forward", "inverted-winger", "wide-playmaker",
    "advanced-playmaker", "raumdeuter", "wide-forward",
  ],
  FC: [
    "advanced-forward", "complete-forward", "deep-lying-forward", "false-nine",
    "poacher", "target-forward", "pressing-forward", "trequartista",
    "channel-forward",
  ],
  FL: ["wide-forward", "inside-forward", "winger", "raumdeuter", "trequartista"],
  FR: ["wide-forward", "inside-forward", "winger", "raumdeuter", "trequartista"],
});

export const TACTICAL_ROLES = Object.freeze([
  ...new Set(Object.values(TACTICAL_ROLES_BY_POSITION).flat()),
]);

export const TACTICAL_ROLE_LABELS = Object.freeze({
  "ball-playing-goalkeeper": "Ball-playing goalkeeper",
  "line-holding-goalkeeper": "Line-holding goalkeeper",
  "no-nonsense-goalkeeper": "No-nonsense goalkeeper",
  "no-nonsense-centre-back": "No-nonsense centre-back",
  "covering-defender": "Covering centre-back",
  "inverted-full-back": "Inverted full-back",
  "inverted-wing-back": "Inverted wing-back",
  "playmaking-wing-back": "Playmaking wing-back",
  "no-nonsense-full-back": "No-nonsense full-back",
  "complete-wing-back": "Complete wing-back",
  "defensive-wing-back": "Defensive wing-back",
  "defensive-midfielder": "Defensive midfielder",
  "ball-winning-midfielder": "Ball-winning midfielder",
  "half-back": "Half-back",
  "deep-lying-playmaker": "Deep-lying playmaker",
  "segundo-volante": "Segundo volante",
  "central-midfielder": "Central midfielder",
  "box-to-box": "Box-to-box midfielder",
  "advanced-playmaker": "Advanced playmaker",
  "roaming-playmaker": "Roaming playmaker",
  "half-winger": "Half-winger",
  "wide-midfielder": "Wide midfielder",
  "inverted-winger": "Inverted winger",
  "wide-playmaker": "Wide playmaker",
  "defensive-winger": "Defensive winger",
  "wide-target-player": "Wide target player",
  "attacking-midfielder": "Attacking midfielder",
  "shadow-striker": "Shadow striker",
  "second-striker": "Second striker",
  "classic-ten": "Classic 10",
  "inside-forward": "Inside forward",
  "wide-forward": "Wide forward",
  "advanced-forward": "Advanced forward",
  "complete-forward": "Complete forward",
  "deep-lying-forward": "Deep-lying forward",
  "false-nine": "False nine",
  "target-forward": "Target forward",
  "pressing-forward": "Pressing forward",
  "channel-forward": "Channel forward",
  "ball-playing-defender": "Ball-playing centre-back",
  "central-defender": "Centre-back",
  "full-back": "Full-back",
  "wing-back": "Wing-back",
  "sweeper-keeper": "Sweeper keeper",
});

export const DUTIES = Object.freeze(["defend", "support", "attack"]);
export const SHOOTING_INSTRUCTIONS = Object.freeze(["inherit", "discourage", "balanced", "encourage"]);
export const TEAM_SHOOTING_INSTRUCTIONS = Object.freeze(["discourage", "balanced", "encourage"]);
export const TEMPO_INSTRUCTIONS = Object.freeze(["inherit", "slow", "balanced", "quick"]);
export const TEAM_TEMPO_INSTRUCTIONS = Object.freeze(["slow", "balanced", "quick"]);
export const GOALKEEPER_DISTRIBUTIONS = Object.freeze(["short", "mixed", "long"]);
export const GOALKEEPER_SWEEPING = Object.freeze(["cautious", "balanced", "aggressive"]);

export const ATTACKING_STYLES = Object.freeze(["possession", "direct", "long-ball", "wing"]);
export const MARKING_SCHEMES = Object.freeze(["man", "zonal"]);

// The default role for a positional slot, so an unauthored setup is still
// a coherent one. A caller may override any of them.
const DEFAULT_ROLE_BY_POSITION = Object.freeze({
  GK: "goalkeeper",
  SW: "sweeper",
  DC: "central-defender",
  DL: "full-back",
  DR: "full-back",
  WBL: "wing-back",
  WBR: "wing-back",
  DMC: "defensive-midfielder",
  MC: "central-midfielder",
  ML: "wide-midfielder",
  MR: "wide-midfielder",
  AMC: "attacking-midfielder",
  AML: "winger",
  AMR: "winger",
  FC: "advanced-forward",
  FL: "wide-forward",
  FR: "wide-forward",
});
const DEFAULT_DUTY_BY_BAND = Object.freeze({
  GK: "defend", D: "defend", M: "support", F: "attack",
});

export function tacticalRolesForPosition(positionalSlot) {
  const position = String(positionalSlot ?? "").toUpperCase();
  return TACTICAL_ROLES_BY_POSITION[position] ?? NO_TACTICAL_ROLES;
}

export function tacticalRoleLabel(role) {
  if (!role) return "";
  return TACTICAL_ROLE_LABELS[role]
    ?? String(role).replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function isTacticalRoleAllowed(positionalSlot, tacticalRole) {
  return tacticalRolesForPosition(positionalSlot).includes(tacticalRole);
}

function defaultRoleFor(positionalSlot) {
  const position = String(positionalSlot ?? "").toUpperCase();
  return DEFAULT_ROLE_BY_POSITION[position]
    ?? tacticalRolesForPosition(position)[0]
    ?? null;
}

/** One authored place in the shape, with its player (or none yet). */
export function createSlotAssignment({
  slotId, positionalSlot, x, y,
  playerId = null, included = true,
  tacticalRole = null, duty = null,
  shootingInstruction = "inherit", tempoInstruction = "inherit",
  goalkeeperDistribution = "mixed", goalkeeperSweeping = "balanced",
  withBallPosition = null, withoutBallPosition = null,
  withBallPositions = {}, withoutBallPositions = {},
} = {}) {
  const band = roleBand(positionalSlot);
  const resolvedTacticalRole = tacticalRole ?? defaultRoleFor(positionalSlot);
  if (!isTacticalRoleAllowed(positionalSlot, resolvedTacticalRole)) {
    throw new Error(`Tactical role "${resolvedTacticalRole}" is not available for ${positionalSlot}.`);
  }
  return {
    slotId,
    positionalSlot,
    x, y,
    band,
    playerId,
    // An excluded slot stays in the shape (so the formation still reads
    // correctly) but contributes no player -- distinct from an empty slot
    // nobody has been assigned to yet.
    included: Boolean(included),
    tacticalRole: resolvedTacticalRole,
    duty: duty ?? DEFAULT_DUTY_BY_BAND[band],
    shootingInstruction: SHOOTING_INSTRUCTIONS.includes(shootingInstruction)
      ? shootingInstruction
      : "inherit",
    tempoInstruction: TEMPO_INSTRUCTIONS.includes(tempoInstruction)
      ? tempoInstruction
      : "inherit",
    goalkeeperDistribution: GOALKEEPER_DISTRIBUTIONS.includes(goalkeeperDistribution)
      ? goalkeeperDistribution
      : "mixed",
    goalkeeperSweeping: GOALKEEPER_SWEEPING.includes(goalkeeperSweeping)
      ? goalkeeperSweeping
      : "balanced",
    withBallPosition: normalizePhasePosition(withBallPosition),
    withoutBallPosition: normalizePhasePosition(withoutBallPosition),
    withBallPositions: normalizePhasePositions(withBallPositions),
    withoutBallPositions: normalizePhasePositions(withoutBallPositions),
    // Owned by the engine at runtime, never authored. Present so a
    // diagnostic can show authored intent beside live behaviour.
    engineJob: null,
  };
}

export function createTeamSetup({
  team, squadKey = null, formation = "4-3-3", style = "Balanced",
  format = "11v11", attackingDirection = "up",
  attacking = {},
  transition = {},
  marking = { scheme: "man", strictness: 3 },
  // The team's standing corner routine, set once alongside formation and
  // marking. A single corner may override any part of it (see
  // resolveCornerPlan()), but this is what the side plays by default.
  cornerPlan = undefined,
} = {}) {
  if (!MATCH_FORMATS[format]) throw new Error(`Unknown match format "${format}".`);
  if (!FORMATION_NAMES.includes(formation)) throw new Error(`Unknown formation "${formation}".`);
  if (!FORMATION_STYLES.includes(style)) throw new Error(`Unknown formation style "${style}".`);
  const attackingStyle = attacking.style ?? "possession";
  const teamShooting = attacking.shooting ?? "balanced";
  const teamTempo = attacking.tempo ?? "balanced";
  if (!ATTACKING_STYLES.includes(attackingStyle)) throw new Error(`Unknown attacking style "${attackingStyle}".`);
  if (!TEAM_SHOOTING_INSTRUCTIONS.includes(teamShooting)) throw new Error(`Unknown team shooting instruction "${teamShooting}".`);
  if (!TEAM_TEMPO_INSTRUCTIONS.includes(teamTempo)) throw new Error(`Unknown team tempo instruction "${teamTempo}".`);
  if (!MARKING_SCHEMES.includes(marking.scheme)) throw new Error(`Unknown marking scheme "${marking.scheme}".`);
  // Formation templates are authored in ONE frame (attacking "up" the
  // page, own goal at y=94). A team attacking the other way must not be
  // handed those same coordinates -- createMatchSetup() records opposite
  // attacking directions, so without this both sides' goalkeepers and
  // defensive lines sat at the same end of the pitch. orientSlots() is the
  // single place that conversion is written down.
  const slots = orientSlots(projectFormation(formation, style, format), { attackingDirection })
    .map((item) => createSlotAssignment({
      slotId: item.id, positionalSlot: item.effectiveRole, x: item.x, y: item.y,
    }));
  return {
    team,
    squadKey,
    format,
    formation,
    style,
    attackingDirection,
    attacking: normalizeTeamAttacking({
      ...attacking,
      style: attackingStyle,
      directness: clampInteger(attacking.directness, 1, 5, 2),
      shooting: teamShooting,
      tempo: teamTempo,
    }),
    transition: normalizeTeamTransition(transition),
    marking: normalizeTeamDefending({
      ...marking,
      strictness: clampInteger(marking.strictness, 1, 5, 3),
    }),
    cornerPlan: createTeamCornerPlan(cornerPlan ?? {}),
    slots,
  };
}

function clampInteger(value, minimum, maximum, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(minimum, Math.min(maximum, Math.round(number)));
}

function normalizePhasePosition(value) {
  if (!value || !Number.isFinite(Number(value.x)) || !Number.isFinite(Number(value.y))) return null;
  return {
    x: Math.max(0, Math.min(100, Number(value.x))),
    y: Math.max(0, Math.min(100, Number(value.y))),
  };
}

function normalizePhasePositions(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).flatMap(([zone, point]) => {
    const zoneNumber = Number(zone);
    const normalized = normalizePhasePosition(point);
    return Number.isInteger(zoneNumber) && zoneNumber >= 0 && zoneNumber < 12 && normalized
      ? [[String(zoneNumber), normalized]] : [];
  }));
}

export function createMatchSetup({ format = "11v11", home = {}, away = {} } = {}) {
  if (!MATCH_FORMATS[format]) throw new Error(`Unknown match format "${format}".`);
  // One pitch, two ends: a team's attacking direction always implies the
  // other's, exactly as match-lab.js's own state.attackingDirection does.
  const homeDirection = home.attackingDirection ?? "down";
  return {
    format,
    home: createTeamSetup({ ...home, team: "home", format, attackingDirection: homeDirection }),
    away: createTeamSetup({ ...away, team: "away", format, attackingDirection: homeDirection === "up" ? "down" : "up" }),
  };
}

/** Assigns a player to a slot, leaving every other field untouched. */
export function assignPlayer(teamSetup, slotId, playerId) {
  return {
    ...teamSetup,
    slots: teamSetup.slots.map((slot) =>
      slot.slotId === slotId ? { ...slot, playerId } : slot),
  };
}

export function setSlotInstruction(teamSetup, slotId, {
  tacticalRole, duty, shootingInstruction, tempoInstruction,
  goalkeeperDistribution, goalkeeperSweeping,
  withBallPosition, withoutBallPosition, withBallPositions, withoutBallPositions, included,
}) {
  const targetSlot = teamSetup.slots.find((slot) => slot.slotId === slotId) ?? null;
  if (tacticalRole !== undefined && !TACTICAL_ROLES.includes(tacticalRole)) {
    throw new Error(`Unknown tactical role "${tacticalRole}".`);
  }
  if (tacticalRole !== undefined && targetSlot
    && !isTacticalRoleAllowed(targetSlot.positionalSlot, tacticalRole)) {
    throw new Error(`Tactical role "${tacticalRole}" is not available for ${targetSlot.positionalSlot}.`);
  }
  if (duty !== undefined && !DUTIES.includes(duty)) {
    throw new Error(`Unknown duty "${duty}".`);
  }
  if (shootingInstruction !== undefined && !SHOOTING_INSTRUCTIONS.includes(shootingInstruction)) {
    throw new Error(`Unknown shooting instruction "${shootingInstruction}".`);
  }
  if (tempoInstruction !== undefined && !TEMPO_INSTRUCTIONS.includes(tempoInstruction)) {
    throw new Error(`Unknown tempo instruction "${tempoInstruction}".`);
  }
  if (goalkeeperDistribution !== undefined && !GOALKEEPER_DISTRIBUTIONS.includes(goalkeeperDistribution)) {
    throw new Error(`Unknown goalkeeper distribution "${goalkeeperDistribution}".`);
  }
  if (goalkeeperSweeping !== undefined && !GOALKEEPER_SWEEPING.includes(goalkeeperSweeping)) {
    throw new Error(`Unknown goalkeeper sweeping instruction "${goalkeeperSweeping}".`);
  }
  if (targetSlot?.band === "GK"
    && ((shootingInstruction !== undefined && shootingInstruction !== "inherit")
      || (tempoInstruction !== undefined && tempoInstruction !== "inherit"))) {
    throw new Error("Goalkeepers do not accept shooting or tempo instructions.");
  }
  if (targetSlot?.band !== "GK"
    && (goalkeeperDistribution !== undefined || goalkeeperSweeping !== undefined)) {
    throw new Error("Goalkeeper instructions only apply to goalkeeper slots.");
  }
  return {
    ...teamSetup,
    slots: teamSetup.slots.map((slot) => slot.slotId !== slotId ? slot : {
      ...slot,
      ...(tacticalRole === undefined ? {} : { tacticalRole }),
      ...(duty === undefined ? {} : { duty }),
      ...(shootingInstruction === undefined ? {} : { shootingInstruction }),
      ...(tempoInstruction === undefined ? {} : { tempoInstruction }),
      ...(goalkeeperDistribution === undefined ? {} : { goalkeeperDistribution }),
      ...(goalkeeperSweeping === undefined ? {} : { goalkeeperSweeping }),
      ...(withBallPosition === undefined ? {} : { withBallPosition: normalizePhasePosition(withBallPosition) }),
      ...(withoutBallPosition === undefined ? {} : { withoutBallPosition: normalizePhasePosition(withoutBallPosition) }),
      ...(withBallPositions === undefined ? {} : { withBallPositions: normalizePhasePositions(withBallPositions) }),
      ...(withoutBallPositions === undefined ? {} : { withoutBallPositions: normalizePhasePositions(withoutBallPositions) }),
      ...(included === undefined ? {} : { included: Boolean(included) }),
    }),
  };
}

/** Resolves inherited player instructions without mutating the authored slot. */
export function effectivePlayerInstructions(slot, teamSetup) {
  const goalkeeper = slot?.band === "GK" || roleBand(slot?.positionalSlot ?? "") === "GK";
  return {
    shooting: goalkeeper ? null : slot?.shootingInstruction === "inherit"
      ? (teamSetup?.attacking?.shooting ?? "balanced")
      : (slot?.shootingInstruction ?? teamSetup?.attacking?.shooting ?? "balanced"),
    tempo: goalkeeper ? null : slot?.tempoInstruction === "inherit"
      ? (teamSetup?.attacking?.tempo ?? "balanced")
      : (slot?.tempoInstruction ?? teamSetup?.attacking?.tempo ?? "balanced"),
    goalkeeperDistribution: goalkeeper ? (slot?.goalkeeperDistribution ?? "mixed") : null,
    goalkeeperSweeping: goalkeeper ? (slot?.goalkeeperSweeping ?? "balanced") : null,
  };
}

/**
 * Structural validation of an authored team: right number of players for
 * the format, exactly one goalkeeper, no player in two slots.
 */
export function validateTeamSetup(teamSetup) {
  const errors = [];
  const expected = MATCH_FORMATS[teamSetup.format]?.players;
  const active = teamSetup.slots.filter((slot) => slot.included);
  if (active.length !== expected) {
    errors.push(`${teamSetup.team} has ${active.length} included slots, expected ${expected} for ${teamSetup.format}`);
  }
  const keepers = active.filter((slot) => slot.band === "GK");
  if (keepers.length !== 1) {
    errors.push(`${teamSetup.team} has ${keepers.length} goalkeepers, expected exactly 1`);
  }
  const assigned = active.filter((slot) => slot.playerId != null);
  const seen = new Set();
  for (const slot of active) {
    if (!isTacticalRoleAllowed(slot.positionalSlot, slot.tacticalRole)) {
      errors.push(`${teamSetup.team} assigns role ${slot.tacticalRole} to incompatible position ${slot.positionalSlot}`);
    }
  }
  for (const slot of assigned) {
    if (seen.has(slot.playerId)) errors.push(`${teamSetup.team} assigns player ${slot.playerId} to more than one slot`);
    seen.add(slot.playerId);
  }
  const unassigned = active.length - assigned.length;
  return {
    valid: errors.length === 0,
    errors,
    warnings: unassigned ? [`${teamSetup.team} has ${unassigned} unassigned slot(s)`] : [],
  };
}

export function validateMatchSetup(setup) {
  const home = validateTeamSetup(setup.home);
  const away = validateTeamSetup(setup.away);
  if (setup.home.attackingDirection === setup.away.attackingDirection) {
    home.errors.push("both teams attack the same end");
  }
  return {
    valid: home.valid && away.valid && setup.home.attackingDirection !== setup.away.attackingDirection,
    errors: [...home.errors, ...away.errors],
    warnings: [...home.warnings, ...away.warnings],
  };
}

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

/**
 * "Random XI" is a PRESET, never a fallback. Reduced-sided projection
 * (formationTemplates.js) is deterministic by construction; if a caller
 * genuinely wants a random selection they must ask for it here, with an
 * explicit seed, so the result is still reproducible.
 */
export function randomXiPreset(teamSetup, playerIds, seed) {
  if (!Number.isFinite(seed)) throw new Error("randomXiPreset() requires a numeric seed.");
  // Small deterministic PRNG, same convention as the rest of the engine:
  // an identical seed always produces an identical XI.
  let value = seed >>> 0;
  const random = () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
  const pool = playerIds.slice();
  for (let index = pool.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [pool[index], pool[target]] = [pool[target], pool[index]];
  }
  return {
    ...teamSetup,
    slots: teamSetup.slots.map((slot, index) => ({ ...slot, playerId: pool[index] ?? null })),
  };
}
