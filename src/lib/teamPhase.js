// Team Shape & Phase Intelligence v1 -- persistent, authoritative phase state.
//
// A phase is derived from football facts only: who owns the ball, where it
// is, how it is moving, the owner's positional band, restart state, elapsed
// simulation time and the teams' attacking directions. UI/playback state is
// intentionally absent. The returned object is plain serializable data so a
// replay can inspect the same transitions without a DOM.

import { roleBand } from "./formationTemplates.js";
import { yardDistance } from "./pitchGeometry.js";

export const TEAM_PHASES = Object.freeze([
  "restart",
  "restart-release",
  "build-up",
  "progression",
  "final-third",
  "attacking-transition",
  "defensive-transition",
  "defensive-block",
]);

export const RESTART_RELEASE_HOLD_MS = 2400;
export const POST_RESTART_BUILD_UP_HOLD_MS = 1600;
export const TRANSITION_HOLD_MS = 1800;
export const PHASE_CONFIRM_MS = 700;

function cloneTeamState(value = {}) {
  return {
    phase: value.phase ?? null,
    phaseSinceMs: Number(value.phaseSinceMs) || 0,
    candidatePhase: value.candidatePhase ?? null,
    candidateSinceMs: Number(value.candidateSinceMs) || 0,
  };
}

function ownerBand(owner) {
  if (!owner) return null;
  if (owner.role === "keeper") return "GK";
  return owner.positionalSlot ? roleBand(owner.positionalSlot) : null;
}

/** Progress from own goal (0) to the goal being attacked (1). */
export function attackingProgress(point, attackingDirection) {
  const y = Math.max(0, Math.min(100, Number(point?.y) || 0));
  return attackingDirection === "up" ? (100 - y) / 100 : y / 100;
}

function attackingPhaseFor({ ballPoint, ballFrom, owner, attackingDirection, currentPhase }) {
  const progress = attackingProgress(ballPoint, attackingDirection);
  const band = ownerBand(owner);
  const movementYards = ballFrom && ballPoint ? yardDistance(ballFrom, ballPoint) : 0;
  const directAdvance = movementYards >= 25
    && attackingProgress(ballPoint, attackingDirection)
      - attackingProgress(ballFrom, attackingDirection) >= 0.18;

  // Boundary hysteresis: the current phase gets a wider exit band than a
  // fresh classification gets as an entry band. A one-yard recycle across
  // a nominal third boundary therefore cannot make the side flicker.
  if (currentPhase === "build-up" && progress < 0.43 && !directAdvance) return "build-up";
  if (currentPhase === "progression" && progress >= 0.29 && progress < 0.76) return "progression";
  if (currentPhase === "final-third" && progress >= 0.67) return "final-third";

  if (progress >= 0.72) return "final-third";
  if (directAdvance || progress >= 0.36) return "progression";
  if ((band === "GK" || band === "D") && progress < 0.54) return "build-up";
  return progress < 0.34 ? "build-up" : "progression";
}

function requestedPhase(team, state, facts) {
  const possessionTeam = facts.possessionTeam ?? null;
  const ownsBall = team === possessionTeam;
  const current = state.teams?.[team]?.phase ?? null;
  if (facts.restartActive) return ownsBall ? "restart" : "defensive-block";

  const sinceRestart = state.restartReleasedAtMs == null
    ? Infinity
    : state.clockMs - state.restartReleasedAtMs;
  if (sinceRestart < RESTART_RELEASE_HOLD_MS) {
    if (ownsBall) {
      const progress = attackingProgress(facts.ballPoint, facts.attackingDirectionByTeam?.[team]);
      if (facts.directRestart && progress >= 0.68) return "final-third";
      if (facts.directRestart && progress >= 0.43) return "progression";
      return "restart-release";
    }
    return "defensive-block";
  }
  // A deliberately short/non-direct restart has just released the static
  // shape into its first circulation. Preserve that opening build-up long
  // enough for the receiver and nearby options to establish themselves;
  // classifying solely from the centre-line geometry can otherwise skip
  // straight from restart-release to progression on the very first sample.
  if (!facts.directRestart
    && sinceRestart < RESTART_RELEASE_HOLD_MS + POST_RESTART_BUILD_UP_HOLD_MS) {
    return ownsBall ? "build-up" : "defensive-block";
  }

  const sinceChange = state.possessionChangedAtMs == null
    ? Infinity
    : state.clockMs - state.possessionChangedAtMs;
  if (sinceChange < TRANSITION_HOLD_MS) {
    return ownsBall ? "attacking-transition" : "defensive-transition";
  }
  if (!ownsBall) return "defensive-block";
  return attackingPhaseFor({
    ballPoint: facts.ballPoint,
    ballFrom: facts.ballFrom,
    owner: facts.owner,
    attackingDirection: facts.attackingDirectionByTeam?.[team],
    currentPhase: current,
  });
}

function isImmediatePhase(phase) {
  return phase === "restart" || phase === "restart-release"
    || phase === "attacking-transition" || phase === "defensive-transition"
    || phase === "defensive-block";
}

export function createTeamPhaseState({
  teams = ["home", "away"], possessionTeam = null, restartActive = false,
} = {}) {
  const teamState = {};
  for (const team of teams) {
    teamState[team] = cloneTeamState({
      phase: restartActive
        ? (team === possessionTeam ? "restart" : "defensive-block")
        : null,
    });
  }
  return {
    clockMs: 0,
    lastPossessionTeam: possessionTeam,
    possessionChangedAtMs: null,
    restartReleasedAtMs: null,
    teams: teamState,
    transitions: [],
  };
}

/**
 * Advances phase state without mutating the previous value.
 *
 * `elapsedMs` is engine time covered by the window being planned. Callers
 * must not pass CSS/playback time. `restartTaken` is an authoritative event,
 * not an animation milestone, and begins the restart-release hold.
 */
export function updateTeamPhaseState(previous, facts = {}, elapsedMs = 0) {
  const state = previous
    ? {
        ...previous,
        clockMs: (Number(previous.clockMs) || 0) + Math.max(0, Number(elapsedMs) || 0),
        teams: Object.fromEntries(Object.entries(previous.teams || {}).map(
          ([team, value]) => [team, cloneTeamState(value)],
        )),
        transitions: [...(previous.transitions || [])],
      }
    : createTeamPhaseState({
        teams: Object.keys(facts.attackingDirectionByTeam || {}),
        possessionTeam: facts.possessionTeam,
        restartActive: facts.restartActive,
      });

  const teams = Object.keys(facts.attackingDirectionByTeam || state.teams || {});
  for (const team of teams) state.teams[team] ||= cloneTeamState();

  // Every restart begins its own release window. Keeping the timestamp from
  // the first restart made a later throw-in/corner skip straight past the
  // restart-release phase as though play had never stopped again.
  if (facts.restartTaken) {
    state.restartReleasedAtMs = state.clockMs;
  }
  if (facts.possessionTeam !== state.lastPossessionTeam) {
    if (state.lastPossessionTeam != null && facts.possessionTeam != null) {
      state.possessionChangedAtMs = state.clockMs;
    }
    state.lastPossessionTeam = facts.possessionTeam ?? null;
  }

  for (const team of teams) {
    const teamState = state.teams[team];
    const requested = requestedPhase(team, state, facts);
    if (!teamState.phase || requested === teamState.phase) {
      if (!teamState.phase) teamState.phaseSinceMs = state.clockMs;
      teamState.phase = requested;
      teamState.candidatePhase = null;
      teamState.candidateSinceMs = state.clockMs;
      continue;
    }

    const leavingRelease = teamState.phase === "restart-release"
      && state.restartReleasedAtMs != null
      && state.clockMs - state.restartReleasedAtMs >= RESTART_RELEASE_HOLD_MS;
    const immediate = isImmediatePhase(requested) || leavingRelease;
    if (!immediate) {
      if (teamState.candidatePhase !== requested) {
        teamState.candidatePhase = requested;
        teamState.candidateSinceMs = state.clockMs;
        continue;
      }
      if (state.clockMs - teamState.candidateSinceMs < PHASE_CONFIRM_MS) continue;
    }

    const from = teamState.phase;
    teamState.phase = requested;
    teamState.phaseSinceMs = state.clockMs;
    teamState.candidatePhase = null;
    teamState.candidateSinceMs = state.clockMs;
    state.transitions.push({ team, from, to: requested, atMs: state.clockMs });
  }
  return state;
}

export function phaseForTeam(phaseState, team) {
  return phaseState?.teams?.[team]?.phase ?? null;
}
