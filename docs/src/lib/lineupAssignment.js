// Deterministic lineup assignment -- putting resolved players into
// formation slots.
//
// Pure and DOM-free. No Math.random anywhere: the same players and the
// same slots always produce the same XI, which is what makes an authored
// Match Lab setup reproducible and a saved scenario replayable.
//
// What this is NOT:
//   - not a zip of the squad array onto the slot array. A historical squad
//     is listed in a conventional order, but that order is not a formation,
//     and a 4-3-3 and a 3-5-2 want different players in different places.
//   - not Quick Setup's random broad-band placement.
//   - not greedy "give each player their own best slot in turn", which
//     depends on the order players happen to arrive in and can strand the
//     last player in a slot nobody can play.
//
// It is a maximum-weight bipartite assignment over positionFit() scores.
// Eleven players into eleven slots is small enough to solve exactly with a
// Hungarian-style search, so the result is the genuinely best overall
// arrangement rather than a locally good one.

import { positionFit, isSupportedPitchFit, isGoalkeeperCandidate, candidateKey } from "./positionFit.js";
import { roleBand } from "./formationTemplates.js";

// A slot a player simply cannot fill scores this instead of a real fit, so
// the solver will use it only when there is no alternative -- and the
// result reports it rather than hiding it.
const UNPLAYABLE_PENALTY = -1000;
// A goalkeeper in an outfield slot (or an outfielder in goal) is worse
// than merely unplayable: it is the one arrangement that must never happen
// while any alternative exists.
const WRONG_KEEPER_PENALTY = -100000;
// A curated historical lineup is stronger evidence than a database record's
// broad versatility rating. It remains below the keeper safety separation
// and only applies when the requested occurrence key exists in this shape.
const HISTORICAL_SLOT_BONUS = 50000;

/** Stable keys such as DC#0, DC#1 and FC#0 for the supplied shape. */
export function lineupSlotKeys(slots) {
  const occurrences = new Map();
  return (slots ?? []).map((slot) => {
    const role = slot.effectiveRole ?? slot.positionalSlot ?? slot.role;
    const occurrence = occurrences.get(role) ?? 0;
    occurrences.set(role, occurrence + 1);
    return `${role}#${occurrence}`;
  });
}

/**
 * How good is this player in this slot? Higher is better.
 *
 * Ability is a deliberate tie-break only, scaled far below the fit score,
 * so a natural full-back always beats a better player who cannot play
 * there -- but between two natural full-backs the stronger one wins. A
 * curated historical slot is explicit lineup evidence and therefore adds a
 * stronger bonus when that exact position occurrence exists in the shape.
 */
export function assignmentScore(player, slot, {
  slotKey = null,
  preferredSlotKey = null,
} = {}) {
  const role = slot.effectiveRole ?? slot.positionalSlot ?? slot.role;
  const slotIsGoal = roleBand(role) === "GK";
  const playerIsKeeper = isGoalkeeperCandidate(player);
  if (slotIsGoal !== playerIsKeeper) return WRONG_KEEPER_PENALTY;
  const fit = positionFit(player, role);
  const ability = Math.max(0, Number(player.current_ability) || 0);
  const base = isSupportedPitchFit(fit) ? fit.score * 1000 : UNPLAYABLE_PENALTY + fit.score;
  const historical = slotKey && preferredSlotKey === slotKey ? HISTORICAL_SLOT_BONUS : 0;
  return base + historical + ability / 1000;
}

/**
 * Exact maximum-weight assignment, via the O(n^3) Hungarian method with
 * potentials (rows are players, columns are slots, rows <= columns).
 *
 * An earlier version of this was a pruned search over permutations. For a
 * full XI that is 11! arrangements: it blew its node budget, fell back to
 * greedy, and cheerfully put the centre-forward in goal. An exact
 * polynomial solver removes the failure mode rather than raising the
 * budget -- 11x11 is trivial for it, and the answer is genuinely optimal.
 *
 * Deterministic for a given matrix, which is what makes an authored setup
 * reproducible. Minimises internally, so scores are negated on the way in.
 */
function solveAssignment(scores, rowCount, columnCount) {
  if (!rowCount) return { choice: [], exact: true };
  const cost = scores.map((row) => row.map((value) => -value));
  const INFINITE = Infinity;
  const rowPotential = new Array(rowCount + 1).fill(0);
  const columnPotential = new Array(columnCount + 1).fill(0);
  // assignedRow[column] is the row currently matched to that column.
  const assignedRow = new Array(columnCount + 1).fill(0);
  const previousColumn = new Array(columnCount + 1).fill(0);

  for (let row = 1; row <= rowCount; row += 1) {
    assignedRow[0] = row;
    let column = 0;
    const minimumCost = new Array(columnCount + 1).fill(INFINITE);
    const visited = new Array(columnCount + 1).fill(false);
    do {
      visited[column] = true;
      const currentRow = assignedRow[column];
      let delta = INFINITE;
      let nextColumn = 0;
      for (let candidate = 1; candidate <= columnCount; candidate += 1) {
        if (visited[candidate]) continue;
        const reduced = cost[currentRow - 1][candidate - 1]
          - rowPotential[currentRow] - columnPotential[candidate];
        if (reduced < minimumCost[candidate]) {
          minimumCost[candidate] = reduced;
          previousColumn[candidate] = column;
        }
        if (minimumCost[candidate] < delta) {
          delta = minimumCost[candidate];
          nextColumn = candidate;
        }
      }
      for (let candidate = 0; candidate <= columnCount; candidate += 1) {
        if (visited[candidate]) {
          rowPotential[assignedRow[candidate]] += delta;
          columnPotential[candidate] -= delta;
        } else {
          minimumCost[candidate] -= delta;
        }
      }
      column = nextColumn;
    } while (assignedRow[column] !== 0);
    do {
      const previous = previousColumn[column];
      assignedRow[column] = assignedRow[previous];
      column = previous;
    } while (column);
  }

  const choice = new Array(rowCount).fill(-1);
  for (let candidate = 1; candidate <= columnCount; candidate += 1) {
    if (assignedRow[candidate] > 0) choice[assignedRow[candidate] - 1] = candidate - 1;
  }
  return { choice, exact: true };
}

/** Stable ordering so an identical squad always yields an identical XI. */
function stableOrder(players) {
  return players
    .map((player, index) => ({ player, index }))
    .sort((left, right) =>
      (Number(right.player.current_ability) || 0) - (Number(left.player.current_ability) || 0)
      || candidateKey(left.player).localeCompare(candidateKey(right.player))
      || left.index - right.index)
    .map((entry) => entry.player);
}

/**
 * Chooses which players make a reduced-sided squad, keeping the shape's own
 * band balance rather than simply taking the best N.
 *
 * The goalkeeper is always kept. Each remaining band takes its strongest
 * available players by fit for that band's own slots, so a 5v5 that wants
 * two defenders gets the two best defenders rather than four midfielders.
 */
function selectForSlots(players, slots) {
  const keeperSlots = slots.filter((slot) => roleBand(slot.effectiveRole ?? slot.positionalSlot) === "GK");
  const keepers = players.filter(isGoalkeeperCandidate);
  const outfield = players.filter((player) => !isGoalkeeperCandidate(player));
  const chosen = [];
  const takenKeys = new Set();
  for (const slot of keeperSlots) {
    const keeper = stableOrder(keepers).find((player) => !takenKeys.has(candidateKey(player)));
    if (!keeper) break;
    takenKeys.add(candidateKey(keeper));
    chosen.push(keeper);
  }
  const outfieldSlots = slots.filter((slot) => roleBand(slot.effectiveRole ?? slot.positionalSlot) !== "GK");
  // Fill band by band, strongest fit first, so the shape keeps its balance.
  for (const slot of outfieldSlots) {
    const role = slot.effectiveRole ?? slot.positionalSlot;
    const ranked = stableOrder(outfield)
      .filter((player) => !takenKeys.has(candidateKey(player)))
      .map((player) => ({ player, score: assignmentScore(player, { effectiveRole: role }) }))
      .sort((left, right) => right.score - left.score
        || candidateKey(left.player).localeCompare(candidateKey(right.player)));
    const pick = ranked[0]?.player;
    if (!pick) break;
    takenKeys.add(candidateKey(pick));
    chosen.push(pick);
  }
  return chosen;
}

/**
 * Assigns players to formation slots.
 *
 * `players`  resolved player records (database-qualified; never names).
 * `slots`    projected formation slots, already oriented for the team's
 *            attacking direction.
 * `preferredSlotByPlayer` optionally maps candidate identities to stable
 *            occurrence keys such as DC#0 or FC#1.
 *
 * Returns { assignments, unplaced, benched, exact }:
 *   assignments  [{ slot, player, fit, score, supported }] -- one per slot,
 *                player null only when there were not enough players.
 *   unplaced     players placed in a slot they cannot properly play, with
 *                the fit that says so. Reported, never hidden.
 *   benched      players not selected at all (reduced-sided formats).
 */
export function assignLineup(players, slots, { preferredSlotByPlayer = null } = {}) {
  const usable = (players ?? []).filter(Boolean);
  const selected = usable.length > slots.length ? selectForSlots(usable, slots) : stableOrder(usable);
  const rows = selected.slice(0, slots.length);
  const slotKeys = lineupSlotKeys(slots);
  const preferredSlotFor = (player) => preferredSlotByPlayer instanceof Map
    ? preferredSlotByPlayer.get(candidateKey(player))
    : preferredSlotByPlayer?.[candidateKey(player)];
  const scores = rows.map((player) => slots.map((slot, column) => assignmentScore(player, slot, {
    slotKey: slotKeys[column],
    preferredSlotKey: preferredSlotFor(player) ?? null,
  })));
  const { choice, exact } = rows.length
    ? solveAssignment(scores, rows.length, slots.length)
    : { choice: [], exact: true };

  const assignments = slots.map((slot) => ({ slot, player: null, fit: null, score: null, supported: false }));
  const unplaced = [];
  rows.forEach((player, row) => {
    const column = choice[row];
    if (column === undefined || column < 0) {
      unplaced.push({ player, reason: "no slot available", fit: null });
      return;
    }
    const slot = slots[column];
    const role = slot.effectiveRole ?? slot.positionalSlot;
    const fit = positionFit(player, role);
    const supported = isSupportedPitchFit(fit);
    assignments[column] = { slot, player, fit, score: scores[row][column], supported };
    if (!supported) {
      unplaced.push({
        player, slot, fit,
        reason: `${fit.label} in ${role}`,
      });
    }
  });
  const usedKeys = new Set(rows.map(candidateKey));
  return {
    assignments,
    unplaced,
    benched: usable.filter((player) => !usedKeys.has(candidateKey(player))),
    exact,
  };
}

/**
 * Convenience: which player id fills each slot id. The values are
 * database-qualified identities, never display names.
 */
export function lineupBySlot(result) {
  return Object.fromEntries(result.assignments
    .filter((entry) => entry.player)
    .map((entry) => [entry.slot.id ?? entry.slot.slotId, candidateKey(entry.player)]));
}
