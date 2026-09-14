// Versioned, renderer-neutral boundary between a game mode and the match
// engine. A draft, a future career save and Match Lab may all author this
// contract; none of them may smuggle DOM state or private simulation rules
// through it.

import {
  normalizeTeamAttacking,
  normalizeTeamDefending,
  normalizeTeamTransition,
} from "./teamInstructions.js";
import { MATCH_FORMATS } from "./formationTemplates.js";

export const PRODUCT_MATCH_INPUT_SCHEMA = "retroball.match-input";
export const PRODUCT_MATCH_INPUT_VERSION = 1;
export const PRODUCT_MATCH_CONTINUATION_SCHEMA = "retroball.match-continuation";
export const PRODUCT_MATCH_CONTINUATION_VERSION = 1;
export const PRODUCT_MATCH_OUTPUT_SCHEMA = "retroball.match-output";
export const PRODUCT_MATCH_OUTPUT_VERSION = 1;
export const LEGACY_DRAFT_TEAM_VERSION = 3;

const PERIODS = new Set([
  "pre-match", "first-half", "half-time", "second-half", "extra-time",
  "penalties", "complete",
]);
const OUTPUT_STATUSES = new Set(["running", "paused", "complete", "abandoned"]);

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function text(value, fallback = "") {
  const resolved = String(value ?? "").trim();
  return resolved || fallback;
}

function finite(value, fallback = 0) {
  const resolved = Number(value);
  return Number.isFinite(resolved) ? resolved : fallback;
}

function jsonClone(value, label = "contract value") {
  const seen = new Set();
  const visit = (item, path) => {
    if (item === null || typeof item === "string" || typeof item === "boolean") return;
    if (typeof item === "number") {
      if (!Number.isFinite(item)) throw new Error(`${path} contains a non-finite number.`);
      return;
    }
    if (typeof item !== "object") throw new Error(`${path} is not JSON serializable.`);
    if (seen.has(item)) throw new Error(`${path} contains a circular reference.`);
    seen.add(item);
    if (Array.isArray(item)) item.forEach((entry, index) => visit(entry, `${path}[${index}]`));
    else Object.entries(item).forEach(([key, entry]) => visit(entry, `${path}.${key}`));
    seen.delete(item);
  };
  visit(value, label);
  return JSON.parse(JSON.stringify(value));
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!isRecord(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

/** Stable JSON for save fingerprints and byte-identical replay fixtures. */
export function stableContractJson(value) {
  return JSON.stringify(canonicalValue(jsonClone(value)));
}

/** Small deterministic identifier; integrity marker, not a security hash. */
export function productContractFingerprint(value) {
  const source = stableContractJson(value);
  let hash = 2166136261;
  for (const character of source) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `pmc1-${(hash >>> 0).toString(36).padStart(7, "0")}`;
}

export function createProductPlayerReference(player = {}) {
  const canonicalPlayerId = text(
    player.canonical_player_public_id ?? player.canonical_player_id,
  ) || null;
  const databaseSlug = text(player.database_slug ?? player.database) || null;
  const sourcePersonId = text(player.source_person_id ?? player.sourcePersonId) || null;
  if (!canonicalPlayerId && !(databaseSlug && sourcePersonId)) {
    throw new Error("A match player needs a canonical id or a database/source-person pair.");
  }
  return {
    key: canonicalPlayerId
      ? `canonical:${canonicalPlayerId}`
      : `source:${databaseSlug}:${sourcePersonId}`,
    canonicalPlayerId,
    databaseSlug,
    sourcePersonId,
  };
}

function productPlayer({ playerId, player, captain = false }) {
  return {
    playerId: text(playerId),
    reference: createProductPlayerReference(player),
    profile: jsonClone(player, `player ${playerId}`),
    captain: Boolean(captain),
  };
}

function defaultTactics() {
  return {
    attacking: normalizeTeamAttacking(),
    transition: normalizeTeamTransition(),
    defending: normalizeTeamDefending(),
    setPieces: {},
  };
}

/**
 * Read the existing draft-team-v3 snapshot without changing it. This adapter
 * is the explicit bridge from the preserved short game to the new product
 * contract; missing roles/duties remain null rather than being invented.
 */
export function adaptLegacyDraftTeam(team, {
  teamId = "home", attackingDirection = "down",
} = {}) {
  if (!isRecord(team) || Number(team.version) !== LEGACY_DRAFT_TEAM_VERSION) {
    throw new Error(`Expected legacy draft team version ${LEGACY_DRAFT_TEAM_VERSION}.`);
  }
  if (!Array.isArray(team.players) || !team.players.length) {
    throw new Error("A legacy draft team needs at least one player.");
  }
  const squad = [];
  const lineup = [];
  const seenSlots = new Set();
  for (const [index, entry] of team.players.entries()) {
    const slotId = text(entry?.slotId, `slot-${index}`);
    if (seenSlots.has(slotId)) throw new Error(`Legacy draft team repeats slot ${slotId}.`);
    seenSlots.add(slotId);
    const playerId = `${teamId}:${slotId}`;
    squad.push(productPlayer({
      playerId,
      player: entry?.player ?? {},
      captain: entry?.isCaptain === true || slotId === team.captainSlotId,
    }));
    lineup.push({
      playerId,
      slotId,
      position: text(entry?.role, "UNKNOWN"),
      tacticalRole: null,
      duty: null,
      anchor: null,
      instructions: {},
    });
  }
  return {
    teamId: text(teamId),
    name: text(team.teamName, teamId === "away" ? "Away team" : "Home team"),
    attackingDirection: attackingDirection === "up" ? "up" : "down",
    formation: {
      name: text(team.formation, "unknown"),
      style: text(team.style, "Balanced"),
    },
    squad,
    lineup,
    substitutes: [],
    tactics: defaultTactics(),
    source: {
      kind: "legacy-draft-team",
      version: LEGACY_DRAFT_TEAM_VERSION,
      mode: text(team.mode) || null,
      scenario: text(team.scenario) || null,
    },
  };
}

function playerEntries(players) {
  if (players instanceof Map) return [...players.entries()].map(([id, player]) => ({ id, player }));
  if (Array.isArray(players)) return players.map((entry) => ({
    id: entry?.id ?? entry?.playerId,
    player: entry?.player ?? entry?.profile ?? entry,
  }));
  if (isRecord(players)) return Object.entries(players).map(([id, player]) => ({ id, player }));
  return [];
}

/** Converts the current DOM-free matchSetup model into the same product team. */
export function createProductTeamFromSetup({
  teamSetup, players = [], substitutes = [], name = null,
} = {}) {
  if (!isRecord(teamSetup) || !Array.isArray(teamSetup.slots)) {
    throw new Error("createProductTeamFromSetup() requires a match team setup.");
  }
  const teamId = text(teamSetup.team);
  const available = new Map(playerEntries(players).map((entry) => [String(entry.id), entry.player]));
  const activeSlots = teamSetup.slots.filter((slot) => slot.included !== false);
  const lineup = [];
  const squad = [];
  const used = new Set();
  for (const slot of activeSlots) {
    const source = available.get(String(slot.playerId));
    if (!source) throw new Error(`${teamId} slot ${slot.slotId} has no supplied player profile.`);
    const playerId = `${teamId}:${slot.playerId}`;
    if (used.has(playerId)) throw new Error(`${teamId} assigns ${slot.playerId} more than once.`);
    used.add(playerId);
    squad.push(productPlayer({ playerId, player: source, captain: slot.isCaptain === true }));
    lineup.push({
      playerId,
      slotId: text(slot.slotId),
      position: text(slot.positionalSlot),
      tacticalRole: text(slot.tacticalRole) || null,
      duty: text(slot.duty) || null,
      anchor: { x: finite(slot.x), y: finite(slot.y) },
      instructions: {
        shooting: slot.shootingInstruction ?? "inherit",
        tempo: slot.tempoInstruction ?? "inherit",
        goalkeeperDistribution: slot.goalkeeperDistribution ?? null,
        goalkeeperSweeping: slot.goalkeeperSweeping ?? null,
        withBallPositions: jsonClone(slot.withBallPositions ?? {}),
        withoutBallPositions: jsonClone(slot.withoutBallPositions ?? {}),
      },
    });
  }
  const substituteIds = [];
  for (const requested of substitutes) {
    const rawId = typeof requested === "object" ? requested.id ?? requested.playerId : requested;
    const source = typeof requested === "object" && (requested.player || requested.profile)
      ? requested.player ?? requested.profile
      : available.get(String(rawId));
    if (!source) throw new Error(`${teamId} substitute ${rawId} has no supplied player profile.`);
    const playerId = `${teamId}:${rawId}`;
    if (used.has(playerId)) throw new Error(`${teamId} lists ${rawId} in both lineup and substitutes.`);
    used.add(playerId);
    squad.push(productPlayer({ playerId, player: source }));
    substituteIds.push(playerId);
  }
  return {
    teamId,
    name: text(name, teamId === "away" ? "Away team" : "Home team"),
    attackingDirection: teamSetup.attackingDirection === "up" ? "up" : "down",
    formation: { name: text(teamSetup.formation), style: text(teamSetup.style, "Balanced") },
    squad,
    lineup,
    substitutes: substituteIds,
    tactics: {
      attacking: normalizeTeamAttacking(teamSetup.attacking),
      transition: normalizeTeamTransition(teamSetup.transition),
      defending: normalizeTeamDefending(teamSetup.marking),
      setPieces: { cornerPlan: jsonClone(teamSetup.cornerPlan ?? {}) },
    },
    source: { kind: "match-setup", version: 1, squadKey: teamSetup.squadKey ?? null },
  };
}

function validateProductTeam(team, expectedId, expectedPlayers, errors) {
  const prefix = `teams.${expectedId}`;
  if (!isRecord(team)) { errors.push(`${prefix} is missing`); return; }
  if (team.teamId !== expectedId) errors.push(`${prefix}.teamId must be ${expectedId}`);
  if (!["up", "down"].includes(team.attackingDirection)) errors.push(`${prefix} has an invalid attacking direction`);
  if (!Array.isArray(team.squad) || !team.squad.length) errors.push(`${prefix}.squad is empty`);
  if (!Array.isArray(team.lineup) || !team.lineup.length) errors.push(`${prefix}.lineup is empty`);
  if (expectedPlayers && team.lineup?.length !== expectedPlayers) {
    errors.push(`${prefix}.lineup has ${team.lineup?.length ?? 0} players, expected ${expectedPlayers}`);
  }
  const squadIds = new Set();
  for (const player of team.squad ?? []) {
    if (!text(player?.playerId)) errors.push(`${prefix}.squad contains a player without playerId`);
    if (squadIds.has(player?.playerId)) errors.push(`${prefix}.squad repeats ${player?.playerId}`);
    squadIds.add(player?.playerId);
    if (!text(player?.reference?.key)) errors.push(`${prefix}.squad ${player?.playerId} has no stable reference`);
  }
  const lineupIds = new Set();
  for (const slot of team.lineup ?? []) {
    if (!squadIds.has(slot?.playerId)) errors.push(`${prefix}.lineup references unknown ${slot?.playerId}`);
    if (lineupIds.has(slot?.playerId)) errors.push(`${prefix}.lineup repeats ${slot?.playerId}`);
    lineupIds.add(slot?.playerId);
  }
  const substituteIds = new Set();
  for (const playerId of team.substitutes ?? []) {
    if (!squadIds.has(playerId)) errors.push(`${prefix}.substitutes references unknown ${playerId}`);
    if (lineupIds.has(playerId)) errors.push(`${prefix} lists ${playerId} in lineup and substitutes`);
    if (substituteIds.has(playerId)) errors.push(`${prefix}.substitutes repeats ${playerId}`);
    substituteIds.add(playerId);
  }
}

export function validateProductMatchInput(input) {
  const errors = [];
  if (!isRecord(input)) return { valid: false, errors: ["match input is missing"] };
  if (input.schema !== PRODUCT_MATCH_INPUT_SCHEMA) errors.push("match input schema is invalid");
  if (input.version !== PRODUCT_MATCH_INPUT_VERSION) errors.push("match input version is unsupported");
  if (!text(input.engineVersion)) errors.push("engineVersion is required");
  if (!text(input.seed)) errors.push("seed is required");
  const expectedPlayers = MATCH_FORMATS[input.format]?.players ?? null;
  if (!expectedPlayers) errors.push(`unknown match format ${input.format}`);
  validateProductTeam(input.teams?.home, "home", expectedPlayers, errors);
  validateProductTeam(input.teams?.away, "away", expectedPlayers, errors);
  if (input.teams?.home?.attackingDirection === input.teams?.away?.attackingDirection) {
    errors.push("the teams must attack opposite ends");
  }
  const homeReferences = new Set((input.teams?.home?.squad ?? [])
    .map((player) => player?.reference?.key).filter(Boolean));
  for (const player of input.teams?.away?.squad ?? []) {
    if (homeReferences.has(player?.reference?.key)) {
      errors.push(`the same player reference appears for both teams: ${player.reference.key}`);
    }
  }
  if (input.fingerprint) {
    const { fingerprint, ...body } = input;
    if (fingerprint !== productContractFingerprint(body)) errors.push("match input fingerprint does not match its contents");
  }
  try { jsonClone(input, "match input"); } catch (error) { errors.push(error.message); }
  return { valid: errors.length === 0, errors };
}

export function createProductMatchInput({
  engineVersion, seed, format = "11v11", home, away, kickoff = {}, metadata = {},
} = {}) {
  const body = {
    schema: PRODUCT_MATCH_INPUT_SCHEMA,
    version: PRODUCT_MATCH_INPUT_VERSION,
    engineVersion: text(engineVersion),
    seed: text(seed),
    format: text(format, "11v11"),
    teams: { home: jsonClone(home, "home team"), away: jsonClone(away, "away team") },
    kickoff: jsonClone(kickoff),
    metadata: jsonClone(metadata),
  };
  const input = { ...body, fingerprint: productContractFingerprint(body) };
  const validation = validateProductMatchInput(input);
  if (!validation.valid) throw new Error(validation.errors.join("; "));
  return input;
}

export function createProductMatchContinuation({
  inputFingerprint, elapsedMs = 0, period = "first-half", score = {},
  possession = {}, world = {}, tactics = {}, discipline = [], injuries = [],
  substitutions = [], decisionMemory = {}, rng = {},
} = {}) {
  if (!text(inputFingerprint)) throw new Error("A continuation needs its match input fingerprint.");
  if (!PERIODS.has(period)) throw new Error(`Unknown match period ${period}.`);
  const body = {
    schema: PRODUCT_MATCH_CONTINUATION_SCHEMA,
    version: PRODUCT_MATCH_CONTINUATION_VERSION,
    inputFingerprint: text(inputFingerprint),
    elapsedMs: Math.max(0, finite(elapsedMs)),
    period,
    score: { home: Math.max(0, Math.trunc(finite(score.home))), away: Math.max(0, Math.trunc(finite(score.away))) },
    possession: jsonClone(possession),
    world: jsonClone(world),
    tactics: jsonClone(tactics),
    discipline: jsonClone(discipline),
    injuries: jsonClone(injuries),
    substitutions: jsonClone(substitutions),
    decisionMemory: jsonClone(decisionMemory),
    rng: jsonClone(rng),
  };
  return { ...body, fingerprint: productContractFingerprint(body) };
}

export function createProductMatchOutput({
  inputFingerprint, status = "complete", elapsedMs = 0, score = {}, timeline = [],
  commentary = [], statistics = {}, heatMaps = {}, discipline = [], injuries = [],
  substitutions = [], finalContinuation = null, metadata = {},
} = {}) {
  if (!text(inputFingerprint)) throw new Error("A match output needs its match input fingerprint.");
  if (!OUTPUT_STATUSES.has(status)) throw new Error(`Unknown match output status ${status}.`);
  if (finalContinuation && finalContinuation.inputFingerprint !== inputFingerprint) {
    throw new Error("The final continuation belongs to a different match input.");
  }
  const body = {
    schema: PRODUCT_MATCH_OUTPUT_SCHEMA,
    version: PRODUCT_MATCH_OUTPUT_VERSION,
    inputFingerprint: text(inputFingerprint),
    status,
    elapsedMs: Math.max(0, finite(elapsedMs)),
    score: { home: Math.max(0, Math.trunc(finite(score.home))), away: Math.max(0, Math.trunc(finite(score.away))) },
    timeline: jsonClone(timeline),
    commentary: jsonClone(commentary),
    statistics: jsonClone(statistics),
    heatMaps: jsonClone(heatMaps),
    discipline: jsonClone(discipline),
    injuries: jsonClone(injuries),
    substitutions: jsonClone(substitutions),
    finalContinuation: finalContinuation ? jsonClone(finalContinuation) : null,
    metadata: jsonClone(metadata),
  };
  return { ...body, fingerprint: productContractFingerprint(body) };
}
