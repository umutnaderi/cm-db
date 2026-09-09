// Restart participant selection -- who takes a restart, and who fills each
// restart role.
//
// Pure, DOM-free and deterministic. No Math.random: the same squad and the
// same restart always produce the same taker and the same role assignment,
// which is what makes an authored setup reproducible and a saved scenario
// replayable.
//
// This module exists because the first integration filled restart roles by
// walking the prepared entry list in formation order and handing the taker
// role to the first non-goalkeeper it met. That is why France's kick-off
// was taken by Bixente Lizarazu: he is simply the first outfielder in a
// back-four-first ordering. A restart taker is a football decision, not an
// array index.

import { playerAttribute } from "./matchEngineCore.js";
import { roleBand, rolePrefix } from "./formationTemplates.js";
import { candidateKey, positionFit, isSupportedPitchFit } from "./positionFit.js";

/**
 * Attribute panels per restart kind, most important first. Read through
 * playerAttribute()'s own compatibility chain (direct -> alias -> proxy ->
 * CA baseline), so a 1996 database with no "Free Kicks" attribute still
 * ranks its takers sensibly instead of scoring everyone zero.
 */
export const TAKER_ATTRIBUTES = Object.freeze({
  kickoff: ["Decisions", "Technique", "Passing", "Off the Ball"],
  "free-kick-direct": ["Free Kicks", "Free Kick Taking", "Technique", "Finishing", "Long Shots", "Decisions"],
  "free-kick-cross": ["Free Kicks", "Free Kick Taking", "Crossing", "Technique", "Passing"],
  "free-kick-short": ["Passing", "Technique", "Decisions"],
  corner: ["Corners", "Crossing", "Technique"],
  "throw-in": ["Long Throws", "Strength", "Decisions"],
  "goal-kick": ["Kicking", "Passing", "Technique"],
});

// Kick-off: the ball is rolled to a forward or a creative midfielder, never
// walked back to a centre-half. Ranked in tiers -- a tier-1 candidate always
// beats a tier-2 one whatever their attributes, and attributes only order
// players WITHIN a tier.
const KICKOFF_TIERS = [
  ["FC", "FL", "FR"],
  ["AMC", "AML", "AMR"],
  ["MC", "ML", "MR"],
  ["DMC", "DML", "DMR"],
];

function tierOf(positionalSlot) {
  const index = KICKOFF_TIERS.findIndex((tier) => tier.includes(positionalSlot));
  return index < 0 ? KICKOFF_TIERS.length : index;
}

/** Mean of the named attributes, weighted so earlier names matter more. */
export function takerRating(player, labels) {
  // A participant with no player record cannot be rated. Returning 0 keeps
  // role assignment deterministic (identity still breaks the tie) instead
  // of throwing on a partially-built fixture.
  if (!player || !labels?.length) return 0;
  let total = 0;
  let weightTotal = 0;
  labels.forEach((label, index) => {
    const weight = labels.length - index;
    total += playerAttribute(player, label) * weight;
    weightTotal += weight;
  });
  return weightTotal ? total / weightTotal : 0;
}

/** Which attribute panel a restart uses, including the free-kick variants. */
export function takerAttributeKey(type, variant) {
  if (type !== "free-kick") return type;
  if (variant === "cross") return "free-kick-cross";
  if (variant === "short" || variant === "play-out") return "free-kick-short";
  return "free-kick-direct";
}

/**
 * Chooses the restart taker.
 *
 * `participants` are {id, player, positionalSlot, role} entries for ONE
 * team. Returns the chosen participant, or null when the team is empty.
 *
 * Deterministic throughout: tier first, then the weighted attribute
 * rating, then database-qualified identity as the final tie-break, so two
 * equally-rated players always resolve the same way.
 */
export function selectRestartTaker({ type, variant = null, participants, preferredId = null }) {
  const usable = (participants ?? []).filter((entry) => entry?.player);
  if (!usable.length) return null;
  // A valid explicit choice always wins -- "Auto" is a default, not a lock.
  if (preferredId) {
    const chosen = usable.find((entry) => entry.id === preferredId);
    if (chosen) return chosen;
  }
  const labels = TAKER_ATTRIBUTES[takerAttributeKey(type, variant)] ?? TAKER_ATTRIBUTES.kickoff;

  if (type === "goal-kick") {
    // The keeper takes it unless there genuinely is not one.
    const keeper = usable.find((entry) => entry.role === "keeper");
    if (keeper) return keeper;
  }

  const outfield = usable.filter((entry) => entry.role !== "keeper");
  const pool = outfield.length ? outfield : usable;

  if (type === "kickoff") {
    // Tiered: a forward beats any midfielder, a midfielder beats any
    // defender. A defender or goalkeeper is only reachable when no eligible
    // attacking player exists at all.
    const ranked = pool
      .map((entry) => ({ entry, tier: tierOf(entry.positionalSlot), rating: takerRating(entry.player, labels) }))
      .sort((left, right) => left.tier - right.tier
        || right.rating - left.rating
        || candidateKey(left.entry.player).localeCompare(candidateKey(right.entry.player)));
    return ranked[0].entry;
  }

  if (type === "throw-in") {
    // A throw is taken by whoever is positionally suited to be on that
    // touchline -- a full-back or wing-back first, then anyone wide.
    const wideBonus = (entry) => {
      const prefix = rolePrefix(entry.positionalSlot);
      if (prefix === "WB") return 2;
      if (prefix === "D" && /[LR]$/.test(entry.positionalSlot)) return 2;
      return /[LR]$/.test(entry.positionalSlot) ? 1 : 0;
    };
    const ranked = pool
      .map((entry) => ({ entry, bonus: wideBonus(entry), rating: takerRating(entry.player, labels) }))
      .sort((left, right) => right.bonus - left.bonus
        || right.rating - left.rating
        || candidateKey(left.entry.player).localeCompare(candidateKey(right.entry.player)));
    return ranked[0].entry;
  }

  const ranked = pool
    .map((entry) => ({ entry, rating: takerRating(entry.player, labels) }))
    .sort((left, right) => right.rating - left.rating
      || candidateKey(left.entry.player).localeCompare(candidateKey(right.entry.player)));
  return ranked[0].entry;
}

// ---------------------------------------------------------------------------
// Role suitability
// ---------------------------------------------------------------------------

// What each restart role actually wants, so roles are filled by football
// suitability rather than by list order. `bands` is the preferred coarse
// band(s); `attributes` order otherwise-equal candidates.
const ROLE_PREFERENCES = Object.freeze({
  "kickoff-support": { bands: ["F", "M"], attributes: ["Off the Ball", "Technique", "Decisions"] },
  "advanced-runner": { bands: ["F", "M"], attributes: ["Off the Ball", "Pace", "Acceleration"] },
  holding: { bands: ["M", "D"], attributes: ["Positioning", "Decisions", "Teamwork"] },
  "centre-circle-edge": { bands: ["M"], attributes: ["Anticipation", "Decisions"] },
  "deep-cover": { bands: ["D"], attributes: ["Positioning", "Anticipation"] },
  "second-taker": { bands: ["M", "F"], attributes: ["Passing", "Technique"] },
  "near-post-runner": { bands: ["F", "M"], attributes: ["Jumping", "Heading", "Off the Ball"] },
  "far-post-runner": { bands: ["F", "D"], attributes: ["Jumping", "Heading", "Strength"] },
  "central-runner": { bands: ["F", "D"], attributes: ["Jumping", "Heading"] },
  "edge-of-area": { bands: ["M"], attributes: ["Long Shots", "Technique", "Anticipation"] },
  "rest-defence": { bands: ["D"], attributes: ["Positioning", "Pace"] },
  wall: { bands: ["D", "M"], attributes: ["Bravery", "Jumping", "Positioning"] },
  "near-post-marker": { bands: ["D"], attributes: ["Marking", "Jumping"] },
  "far-post-marker": { bands: ["D"], attributes: ["Marking", "Jumping"] },
  "near-post-guard": { bands: ["D", "M"], attributes: ["Marking", "Positioning"] },
  "far-post-guard": { bands: ["D", "M"], attributes: ["Marking", "Positioning"] },
  "central-marker": { bands: ["D"], attributes: ["Marking", "Jumping", "Strength"] },
  "zonal-front": { bands: ["M", "D"], attributes: ["Anticipation", "Jumping"] },
  "short-cover": { bands: ["M", "F"], attributes: ["Pace", "Anticipation"] },
  outlet: { bands: ["F", "M"], attributes: ["Pace", "Off the Ball"] },
  sweeper: { bands: ["D"], attributes: ["Positioning", "Anticipation"] },
  "short-option": { bands: ["M", "D"], attributes: ["Passing", "Technique"] },
  "short-option-left": { bands: ["D", "M"], attributes: ["Passing", "Composure"] },
  "short-option-right": { bands: ["D", "M"], attributes: ["Passing", "Composure"] },
  "long-target": { bands: ["F"], attributes: ["Jumping", "Heading", "Strength"] },
  "second-ball": { bands: ["M"], attributes: ["Anticipation", "Work Rate"] },
  "down-the-line": { bands: ["F", "M"], attributes: ["Pace", "Off the Ball"] },
  "inside-option": { bands: ["M"], attributes: ["Technique", "Composure"] },
  recycle: { bands: ["D", "M"], attributes: ["Passing", "Composure"] },
  "press-left": { bands: ["F", "M"], attributes: ["Work Rate", "Pace"] },
  "press-right": { bands: ["F", "M"], attributes: ["Work Rate", "Pace"] },
  "long-ball-contest": { bands: ["D", "F"], attributes: ["Jumping", "Heading", "Strength"] },
  "second-ball-cover": { bands: ["M"], attributes: ["Anticipation", "Positioning"] },
  "thrower-marker": { bands: ["D", "M"], attributes: ["Marking", "Work Rate"] },
  "inside-cover": { bands: ["M", "D"], attributes: ["Positioning", "Marking"] },
  "line-cover": { bands: ["D", "M"], attributes: ["Pace", "Positioning"] },
});

function roleScore(entry, restartRole) {
  // A real wall is several bodies, so restartSetup.js expands the single
  // authored "wall" marker into wall-1..wall-N. They all want the same kind
  // of player, so they share the one preference entry -- without this they
  // matched nothing, scored zero for everybody, and a striker ended up in
  // the wall on a name tie-break.
  const key = /^wall-\d+$/.test(restartRole) ? "wall" : restartRole;
  const preference = ROLE_PREFERENCES[key];
  if (!preference) return 0;
  const band = roleBand(entry.positionalSlot);
  const bandIndex = preference.bands.indexOf(band);
  // A preferred band is worth far more than any attribute difference, so a
  // centre-half never becomes the near-post runner while a striker is free.
  const bandScore = bandIndex < 0 ? 0 : (preference.bands.length - bandIndex) * 1000;
  return bandScore + takerRating(entry.player, preference.attributes);
}

/**
 * Assigns every restart role to exactly one participant, by suitability.
 *
 * `layout` is a restartSetup layout array ({restartRole, required, wall,
 * anchoredToGoal, keeper, x, y}). `participants` are one team's entries.
 * `takerId` is the already-chosen taker, which is honoured for whichever
 * role carries `required`.
 *
 * Returns { assignments, unassigned } where assignments is a Map from
 * participant id to its layout spot. No participant is ever given two
 * roles, and no role is ever given two participants.
 */
export function assignRestartRoles({ layout, participants, takerId = null }) {
  const remaining = new Map((participants ?? []).map((entry) => [entry.id, entry]));
  const assignments = new Map();
  const take = (id) => {
    const entry = remaining.get(id);
    if (entry) remaining.delete(id);
    return entry ?? null;
  };

  // Fixed roles first: the keeper's, then the taker's. Both are decisions
  // already made elsewhere, and letting suitability scoring re-open them
  // is how an outfielder ends up in goal.
  const ordered = [...layout];
  const keeperSpots = ordered.filter((spot) => spot.anchoredToGoal || spot.keeper);
  const takerSpots = ordered.filter((spot) => spot.required && !keeperSpots.includes(spot));
  const openSpots = ordered.filter((spot) => !keeperSpots.includes(spot) && !takerSpots.includes(spot));

  for (const spot of keeperSpots) {
    const keeper = [...remaining.values()].find((entry) => entry.role === "keeper");
    const entry = keeper ? take(keeper.id) : null;
    if (entry) assignments.set(entry.id, { ...spot, entry });
  }
  for (const spot of takerSpots) {
    const entry = (takerId ? take(takerId) : null)
      ?? take([...remaining.values()].find((candidate) => candidate.role !== "keeper")?.id);
    if (entry) assignments.set(entry.id, { ...spot, entry });
  }
  // Everything else by suitability. Roles are filled in layout order and
  // each takes the best remaining outfielder for it, so the ordering is
  // stable and no role can steal a player another has already been given.
  for (const spot of openSpots) {
    const wallRole = spot.wall || /^wall(?:-\d+)?$/.test(spot.restartRole ?? "");
    const candidates = [...remaining.values()].filter((entry) =>
      entry.role !== "keeper" && (!wallRole || isWallCandidate(entry)));
    if (!candidates.length) continue;
    const best = candidates
      .map((entry) => ({ entry, score: roleScore(entry, spot.restartRole) }))
      .sort((left, right) => right.score - left.score
        || candidateKey(left.entry.player).localeCompare(candidateKey(right.entry.player)))[0];
    const entry = take(best.entry.id);
    if (entry) assignments.set(entry.id, { ...spot, entry });
  }
  return { assignments, unassigned: [...remaining.values()] };
}

// ---------------------------------------------------------------------------
// Free-kick wall
// ---------------------------------------------------------------------------

/**
 * How many defenders a free kick warrants.
 *
 * Close and central is the dangerous case and gets the biggest wall; wide
 * or distant kicks get fewer bodies because the direct shot is less of a
 * threat than the delivery. Deterministic, and clamped to a sane range.
 */
export function wallSizeFor({ distanceYards, angleTightness }) {
  const distance = Math.max(0, Number(distanceYards) || 0);
  if (distance > 38) return 2;
  const tight = Math.max(0, Math.min(1, Number(angleTightness) || 0));
  // Central (tightness near 0) and close is worth four or five; a wide kick
  // from the same distance needs fewer.
  let size = distance <= 22 ? 5 : distance <= 30 ? 4 : 3;
  if (tight > 0.55) size -= 1;
  if (tight > 0.8) size -= 1;
  return Math.max(2, Math.min(5, size));
}

/** Is this participant a sensible body for a wall? Never the goalkeeper. */
export function isWallCandidate(entry) {
  if (!entry || entry.role === "keeper") return false;
  const band = roleBand(entry.positionalSlot);
  return band === "D" || band === "M";
}

export { candidateKey, positionFit, isSupportedPitchFit };
