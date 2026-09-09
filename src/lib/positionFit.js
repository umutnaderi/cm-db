// Position fit -- how naturally a player fits a positional slot.
//
// Extracted verbatim from draft-setup.js (2026-09-04) so Draft's setup
// screen and Match Lab's lineup assignment score the same player the same
// way. Pure and DOM-free: plain player records in, a { score, level, label }
// out. No state, no DOM, no randomness.
//
// The scoring reads a player's own `position_ratings` and handles two very
// different database generations: the older editions rate a position 0-2,
// the modern ones 0-20. `modern` below is detected from the data rather
// than declared, because the same function serves every edition this
// project ships.
//
// Note what this does NOT decide: it scores SUITABILITY for a positional
// slot. It says nothing about tactical role or duty, which are separate
// authored instructions (see matchSetup.js) -- a natural DC is equally
// natural whether you ask them to stop the ball or start the play.

import { rolePrefix } from "./formationTemplates.js";

/** Database-qualified identity. Never a display name. */
export function candidateKey(candidate) {
  return `${candidate?.database_slug}:${candidate?.source_person_id}`;
}

// Which rating label each position token in a `position_text` means. The
// labels are exactly the ones roleRatingLabels() below already looks up, so
// a derived rating and a database-supplied one are indistinguishable to
// every scorer.
const POSITION_TOKEN_LABELS = Object.freeze({
  GK: "goalkeeper",
  SW: "sweeper",
  WB: "wing back",
  DM: "defensive midfielder",
  AM: "attacking midfielder",
  D: "defender",
  M: "midfielder",
  F: "attacker",
  S: "attacker",
});
const SIDE_TOKEN_LABELS = Object.freeze({ L: "left side", R: "right side", C: "central" });

/**
 * Builds rating entries from a `position_text` such as "M/AM C", "D RC" or
 * "D/WB RL".
 *
 * Draft's own candidate feed carries real `position_ratings`, but Match
 * Lab's player search and metrics endpoints do not -- they return only
 * `position_text`. Without this, positionFit() scored every outfielder
 * "Not rated", and deterministic lineup assignment degenerated into
 * ability order: Frank Lampard at left-back, Drogba at centre-half. Derived
 * ratings are only used when no real ones are supplied, so Draft's
 * behaviour is untouched.
 */
export function ratingsFromPositionText(positionText) {
  const text = String(positionText || "").trim().toUpperCase();
  if (!text) return [];
  // "D/WB RL" -> positions "D/WB", sides "RL". A text with no side group
  // (e.g. "GK") simply has none.
  const [positionPart, ...rest] = text.split(/\s+/);
  const sidePart = rest.join("");
  const labels = new Map();
  for (const token of positionPart.split("/")) {
    // Longest token first so "DM" is never read as "D" + "M".
    const key = ["GK", "SW", "WB", "DM", "AM", "D", "M", "F", "S"]
      .find((candidate) => token === candidate);
    const label = key ? POSITION_TOKEN_LABELS[key] : null;
    if (label) labels.set(label, 20);
  }
  if (!labels.size) return [];
  const sides = [...sidePart].map((letter) => SIDE_TOKEN_LABELS[letter]).filter(Boolean);
  // A goalkeeper has no side; anything else with no stated side is central.
  const effectiveSides = sides.length ? sides : (labels.has("goalkeeper") ? [] : ["central"]);
  for (const side of Object.values(SIDE_TOKEN_LABELS)) {
    labels.set(side, effectiveSides.includes(side) ? 20 : 0);
  }
  return [...labels].map(([label, value]) => ({ label, value }));
}

function ratingMap(candidate) {
  const supplied = candidate?.position_ratings;
  const entries = Array.isArray(supplied) && supplied.length
    ? supplied
    : ratingsFromPositionText(candidate?.position_text);
  return new Map(
    entries.map((item) => [
      String(item.label || "").toLowerCase(),
      Number(item.value) || 0,
    ]),
  );
}

function firstRating(ratings, labels) {
  for (const label of labels) {
    if (ratings.has(label)) return ratings.get(label) || 0;
  }
  return 0;
}

function roleRatingLabels(role) {
  const prefix = rolePrefix(role);
  return (
    {
      GK: ["goalkeeper"],
      SW: ["sweeper"],
      D: ["defender", "defence"],
      WB: ["wing back", "defender", "defence"],
      DM: ["defensive midfielder", "def midfielder", "anchor"],
      M: ["midfielder", "midfield"],
      AM: ["attacking midfielder", "att midfielder", "support"],
      F: ["attacker", "attack"],
    }[prefix] || []
  );
}

function sideRatingLabels(role) {
  if (role === "GK" || role === "SW") return [];
  if (role.endsWith("L")) return ["left side", "left sided"];
  if (role.endsWith("R")) return ["right side", "right sided"];
  return ["central"];
}

const SIDE_PREFERENCES = [
  { letter: "L", labels: ["left side", "left sided"] },
  { letter: "C", labels: ["central"] },
  { letter: "R", labels: ["right side", "right sided"] },
];

function generatedSidePreference(candidate, ratings = ratingMap(candidate)) {
  const values = [...ratings.values()];
  if (!values.length || values.some((value) => value > 2)) return null;
  const hasPositionRating = [
    "defender",
    "defence",
    "wing back",
    "defensive midfielder",
    "def midfielder",
    "anchor",
    "midfielder",
    "midfield",
    "attacking midfielder",
    "att midfielder",
    "support",
    "attacker",
    "attack",
  ].some((label) => firstRating(ratings, [label]) > 0);
  const hasSideRating = SIDE_PREFERENCES.some(
    ({ labels }) => firstRating(ratings, labels) > 0,
  );
  if (!hasPositionRating || hasSideRating) return null;

  const identity = candidateKey(candidate);
  let hash = 2166136261;
  for (let index = 0; index < identity.length; index += 1) {
    hash ^= identity.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return SIDE_PREFERENCES[(hash >>> 0) % SIDE_PREFERENCES.length];
}

function sideRating(candidate, ratings, labels, base) {
  const explicit = firstRating(ratings, labels);
  if (explicit > 0 || base <= 0) return explicit;
  const generated = generatedSidePreference(candidate, ratings);
  return generated && labels.some((label) => generated.labels.includes(label))
    ? base
    : 0;
}

export function positionFit(candidate, role) {
  const ratings = ratingMap(candidate);
  const goalkeeperRating = firstRating(ratings, ["goalkeeper"]);
  const usesTwentyPointRatings = [...ratings.values()].some(
    (value) => value > 2,
  );
  const isGoalkeeper =
    /(?:^|[/\s])G\s*K(?:$|[/\s])/i.test(
      String(candidate.position_text || ""),
    ) || goalkeeperRating >= (usesTwentyPointRatings ? 15 : 2);
  if (isGoalkeeper && role === "GK") {
    return { score: 20, level: "natural", label: "Natural" };
  }
  if (isGoalkeeper) {
    return { score: 2, level: "very-awkward", label: "Very awkward" };
  }
  if (!ratings.size) return { score: 0, level: "none", label: "Not rated" };
  const modern = [...ratings.values()].some((value) => value > 2);
  let base = firstRating(ratings, roleRatingLabels(role));
  const sideLabels = sideRatingLabels(role);
  const side = sideLabels.length
    ? sideRating(candidate, ratings, sideLabels, base)
    : base;

  if (rolePrefix(role) === "WB" && !modern && base <= 0) {
    base = firstRating(ratings, ["defender", "defence"]);
  }

  let score = sideLabels.length ? Math.min(base, side) : base;
  const adjacentWideRole = {
    AML: "FL",
    AMR: "FR",
    FL: "AML",
    FR: "AMR",
  }[role];
  if (adjacentWideRole) {
    const adjacentBase = firstRating(
      ratings,
      roleRatingLabels(adjacentWideRole),
    );
    const adjacentSideLabels = sideRatingLabels(adjacentWideRole);
    const adjacentSide = sideRating(
      candidate,
      ratings,
      adjacentSideLabels,
      adjacentBase,
    );
    const adjacentScore = Math.min(adjacentBase, adjacentSide);
    const secondaryCeiling = modern ? 15 : 1;
    score = Math.max(score, Math.min(adjacentScore, secondaryCeiling));
  }
  const thresholds = modern
    ? [
        [18, "natural", "Natural"],
        [15, "playable", "Playable"],
        [12, "limited", "Limited"],
        [9, "weak", "Weak"],
        [6, "awkward", "Awkward"],
        [2, "very-awkward", "Very awkward"],
      ]
    : [
        [2, "natural", "Natural"],
        [1, "limited", "Limited"],
      ];
  const match = thresholds.find(([minimum]) => score >= minimum);
  return match
    ? { score, level: match[1], label: match[2] }
    : { score, level: "none", label: "Not rated" };
}

export function isSupportedPitchFit(fit) {
  return Boolean(
    fit && fit.score > 0 && !["none", "very-awkward"].includes(fit.level),
  );
}

/**
 * How much of a player's ability actually survives being played out of
 * position. Draft uses this to weight a drafted XI's ratings; the lineup
 * assigner uses the same numbers so both agree on what "playing someone
 * out of position costs".
 */
export function positionAbilityMultiplier(candidate, role) {
  const fit = positionFit(candidate, role);
  return (
    {
      natural: 1,
      playable: 0.92,
      limited: 0.82,
      weak: 0.7,
      awkward: 0.55,
      "very-awkward": 0.35,
    }[fit.level] || 0.25
  );
}

/** Coarse line a positional slot belongs to. */
export function squadLine(role) {
  const prefix = rolePrefix(role);
  if (prefix === "F") return "attack";
  if (["D", "WB", "SW", "GK"].includes(prefix)) return "defence";
  return "midfield";
}

/** Does this record read as a goalkeeper, by position text or rating? */
export function isGoalkeeperCandidate(candidate) {
  const ratings = ratingMap(candidate);
  const goalkeeperRating = firstRating(ratings, ["goalkeeper"]);
  const usesTwentyPointRatings = [...ratings.values()].some((value) => value > 2);
  return /(?:^|[/\s])G\s*K(?:$|[/\s])/i.test(String(candidate?.position_text || ""))
    || goalkeeperRating >= (usesTwentyPointRatings ? 15 : 2);
}
