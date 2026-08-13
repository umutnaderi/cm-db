// Shared FM/CM-style CA attribute weighting table and generation helpers.
// Used by draft-setup.js (rolling a Generative target ability) and
// draft-run.js (filling unset attributes, boosting toward that target).
// Pure functions only — callers supply their own seeded RNG.

const POSITION_COLUMNS = ["GK", "DRL", "DC", "WBRL", "DM", "MRL", "MC", "AMRL", "AMC", "SC"];

function weights(...values) {
  return Object.fromEntries(POSITION_COLUMNS.map((column, index) => [column, values[index]]));
}

function averageWeights(...tables) {
  return Object.fromEntries(POSITION_COLUMNS.map((column) => [
    column,
    tables.reduce((sum, table) => sum + (table[column] || 0), 0) / tables.length,
  ]));
}

export const ATTRIBUTE_WEIGHTS = {
  // Technical                        GK   DRL  DC   WBRL DM   MRL  MC   AMRL AMC  SC
  "corners": weights(0, 1, 1, 1, 1, 1, 1, 1, 1, 1),
  "crossing": weights(0, 2, 1, 3, 1, 3, 1, 5, 3, 5),
  "dribbling": weights(0, 2, 1, 2, 1, 3, 2, 5, 3, 5),
  "finishing": weights(0, 1, 1, 1, 2, 2, 2, 3, 5, 8),
  "first touch": weights(1, 3, 2, 3, 4, 4, 6, 5, 6, 5),
  "free kick taking": weights(0, 1, 1, 1, 1, 1, 1, 1, 1, 1),
  "heading": weights(1, 2, 5, 1, 1, 2, 1, 1, 1, 6),
  "long shots": weights(0, 1, 1, 1, 2, 3, 2, 3, 3, 2),
  "long throws": weights(0, 1, 1, 1, 1, 1, 1, 1, 1, 1),
  "marking": weights(0, 3, 8, 2, 3, 2, 3, 1, 1, 1),
  "passing": weights(3, 2, 2, 3, 4, 3, 6, 2, 4, 2),
  "penalty taking": weights(0, 1, 1, 1, 1, 1, 1, 1, 1, 1),
  "tackling": weights(0, 4, 5, 3, 7, 2, 3, 2, 2, 1),
  "technique": weights(1, 2, 1, 3, 3, 4, 4, 4, 5, 4),
  // Mental
  "aggression": weights(0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
  "anticipation": weights(3, 3, 5, 3, 5, 3, 3, 3, 3, 5),
  "bravery": weights(6, 3, 2, 1, 1, 1, 1, 1, 1, 1),
  "composure": weights(2, 2, 2, 2, 2, 3, 3, 3, 3, 6),
  "concentration": weights(6, 4, 4, 3, 3, 2, 2, 2, 2, 2),
  "decisions": weights(10, 7, 10, 5, 8, 5, 7, 5, 6, 5),
  "determination": weights(0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
  "flair": weights(0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
  "leadership": weights(2, 1, 2, 1, 1, 1, 1, 1, 1, 1),
  "off the ball": weights(0, 1, 0, 2, 1, 3, 1, 3, 3, 6),
  "positioning": weights(5, 4, 8, 3, 5, 1, 3, 1, 2, 2),
  "teamwork": weights(2, 2, 2, 2, 2, 2, 2, 2, 2, 1),
  "vision": weights(1, 1, 1, 4, 3, 6, 6, 3, 6, 2),
  "work rate": weights(1, 2, 2, 2, 4, 3, 3, 3, 3, 2),
  // Physical
  "acceleration": weights(6, 7, 6, 8, 6, 8, 6, 10, 9, 10),
  "agility": weights(8, 6, 5, 6, 6, 6, 6, 6, 6, 6),
  "balance": weights(2, 2, 2, 2, 2, 2, 2, 2, 2, 2),
  "jumping reach": weights(1, 2, 6, 1, 1, 1, 1, 1, 1, 5),
  "natural fitness": weights(0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
  "pace": weights(3, 5, 5, 6, 4, 6, 5, 10, 7, 7),
  "stamina": weights(1, 6, 3, 7, 6, 6, 6, 7, 4, 3),
  "strength": weights(4, 6, 6, 3, 3, 3, 4, 3, 3, 6),
  // Other
  "weaker foot": weights(3, 4, 4.5, 4, 5, 5, 6, 5.5, 7, 7.5),
  // Goalkeeping (only meaningful for the GK column; zero elsewhere)
  "aerial reach": weights(6, 0, 0, 0, 0, 0, 0, 0, 0, 0),
  "command of area": weights(6, 0, 0, 0, 0, 0, 0, 0, 0, 0),
  "communication": weights(6, 0, 0, 0, 0, 0, 0, 0, 0, 0),
  "eccentricity": weights(0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
  "handling": weights(8, 0, 0, 0, 0, 0, 0, 0, 0, 0),
  "kicking": weights(5, 0, 0, 0, 0, 0, 0, 0, 0, 0),
  "one on ones": weights(4, 0, 0, 0, 0, 0, 0, 0, 0, 0),
  "punching tendency": weights(0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
  "reflexes": weights(8, 0, 0, 0, 0, 0, 0, 0, 0, 0),
  "rushing out tendency": weights(0, 0, 0, 0, 0, 0, 0, 0, 0, 0),
  "throwing": weights(3, 0, 0, 0, 0, 0, 0, 0, 0, 0),
};

// Coarse composite keys used by early editions that never split these out
// (e.g. a single "Shooting" instead of Finishing/Long Shots/Penalty Taking).
// Represented as the average of the canonical entries they stand in for, so
// the same weighted-redistribution math applies unchanged to older data.
ATTRIBUTE_WEIGHTS["shooting"] = averageWeights(
  ATTRIBUTE_WEIGHTS["finishing"],
  ATTRIBUTE_WEIGHTS["long shots"],
  ATTRIBUTE_WEIGHTS["penalty taking"],
);
ATTRIBUTE_WEIGHTS["set pieces"] = averageWeights(
  ATTRIBUTE_WEIGHTS["corners"],
  ATTRIBUTE_WEIGHTS["free kick taking"],
  ATTRIBUTE_WEIGHTS["penalty taking"],
);

// Label variance produced across editions (snake_case JSON keys rendered as
// Title Case) that doesn't match the weight table's own vocabulary.
export const ATTRIBUTE_LABEL_ALIASES = {
  "aerial ability": "aerial reach",
  "tendency to punch": "punching tendency",
  "rushing out": "rushing out tendency",
  "jumping": "jumping reach",
  "penalties": "penalty taking",
  "free kicks": "free kick taking",
  "throw ins": "long throws",
  "creativity": "vision",
  "influence": "leadership",
};

const WEIGHT_COLUMN_BY_POSITION_CODE = {
  GK: "GK",
  SW: "DC",
  DL: "DRL",
  DC: "DC",
  DR: "DRL",
  WBL: "WBRL",
  WBR: "WBRL",
  DML: "DM",
  DMC: "DM",
  DMR: "DM",
  ML: "MRL",
  MC: "MC",
  MR: "MRL",
  AML: "AMRL",
  AMC: "AMC",
  AMR: "AMRL",
  FL: "AMRL",
  FC: "SC",
  FR: "AMRL",
};

function clamp(minimum, maximum, value) {
  return Math.max(minimum, Math.min(maximum, value));
}

function normalizedAttributeLabel(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replaceAll("-", " ")
    .replace(/\s+/g, " ");
}

// Ports draft-setup.js's positionsFromText() parser so both files agree on
// how "D/DM C", "SW/D RC", "M/AM C" etc. resolve to fine-grained codes.
function positionsFromText(positionText) {
  const text = String(positionText || "").trim().toUpperCase();
  if (!text) return [];
  if (/\s+\/\s+/.test(text)) {
    return text.split(/\s+\/\s+/).flatMap((position) => positionsFromText(position));
  }
  if (/(?:^|[/\s])G\s*K(?:$|[/\s])/.test(text)) return ["GK"];
  const match = text.match(/^([A-Z/]+)\s*([LRC]+)$/);
  if (!match) return [text.replace(/\s+/g, "")];
  const bases = match[1].split("/");
  const sides = [...match[2]];
  return bases.flatMap((base) => {
    if (base === "SW") return ["SW"];
    const normalizedBase = base === "S" ? "F" : base;
    return sides.map((side) => `${normalizedBase}${side}`);
  });
}

export function primaryWeightColumn(positionText) {
  for (const code of positionsFromText(positionText)) {
    const column = WEIGHT_COLUMN_BY_POSITION_CODE[code];
    if (column) return column;
  }
  return "MC";
}

export function resolveAttributeWeight(label) {
  const key = normalizedAttributeLabel(label);
  if (ATTRIBUTE_WEIGHTS[key]) return ATTRIBUTE_WEIGHTS[key];
  const alias = ATTRIBUTE_LABEL_ALIASES[key];
  return alias ? ATTRIBUTE_WEIGHTS[alias] : null;
}

export function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function mulberry32(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

// Replaces `0`-valued attributes (the CM/FM "randomize on each new game"
// convention) with a plausible value derived from the player's own known
// attributes for their position, plus small jitter. Applies in every mode.
export function fillZeroAttributes(attributes, positionText, currentAbility, rng) {
  if (!Array.isArray(attributes) || !attributes.length) return attributes;
  const column = primaryWeightColumn(positionText);
  const known = [];
  const zeroIndexes = [];
  attributes.forEach((entry, index) => {
    const weight = resolveAttributeWeight(entry?.label)?.[column];
    if (!weight) return;
    const value = Number(entry?.value);
    if (value > 0) known.push({ value, weight });
    else if (value === 0) zeroIndexes.push(index);
  });
  if (!zeroIndexes.length) return attributes;
  const knownWeight = known.reduce((sum, item) => sum + item.weight, 0);
  const knownWeightedAverage = knownWeight > 0
    ? known.reduce((sum, item) => sum + item.value * item.weight, 0) / knownWeight
    : clamp(1, 20, (Number(currentAbility) || 100) / 10);
  const result = attributes.slice();
  for (const index of zeroIndexes) {
    const jitter = (rng() - 0.5) * 4;
    result[index] = {
      ...result[index],
      value: Math.round(clamp(1, 20, knownWeightedAverage + jitter)),
    };
  }
  return result;
}

// Resolves legacy PA sentinels (-1/-2 = "very promising", not used by
// fm2005 which has its own -1..-10 scale) into a concrete PA. Returns the
// current ability unchanged when the sentinel's CA gate isn't met, or for
// any range this convention doesn't cover — i.e. no generative headroom.
export function resolvePotentialAbility(currentAbility, potentialAbility, databaseSlug, rng) {
  const ca = Number(currentAbility) || 0;
  const pa = Number(potentialAbility);
  if (Number.isFinite(pa) && pa > 0) return pa;
  if (/^fm2005/i.test(String(databaseSlug || ""))) return ca;
  if (pa === -1 && ca > 110) {
    const t = Math.pow(rng(), 1.6); // skewed toward the low end
    return Math.round(120 + t * 80);
  }
  if (pa === -2 && ca > 140) {
    const t = Math.pow(rng(), 0.55); // skewed toward the high end
    return Math.round(120 + t * 80);
  }
  return ca;
}

// Uniform roll between current ability and a resolved potential ability.
export function rollGenerativeTargetAbility(currentAbility, resolvedPotentialAbility, rng) {
  const ca = Number(currentAbility) || 0;
  const pa = Number(resolvedPotentialAbility) || ca;
  if (pa <= ca) return ca;
  return Math.round(ca + rng() * (pa - ca));
}

// Redistributes attribute points toward a higher target ability, weighted
// by position relevance, preserving the player's real relative strengths.
// Attributes near the 20 cap absorb little extra; the remainder cascades
// onto attributes with more headroom (matches: a near-maxed Passing stat
// barely moves while a mid Finishing stat jumps further for the same CA
// increase, when both matter for the player's position).
export function boostAttributesTowardAbility(attributes, positionText, currentAbility, targetAbility, rng) {
  const ca = Number(currentAbility) || 0;
  const target = Number(targetAbility) || ca;
  if (!Array.isArray(attributes) || !attributes.length || target <= ca) return attributes;
  const column = primaryWeightColumn(positionText);
  const entries = attributes.map((entry, index) => ({
    index,
    weight: resolveAttributeWeight(entry?.label)?.[column] || 0,
    value: clamp(1, 20, Number(entry?.value) || 1),
  }));
  const weighted = entries.filter((entry) => entry.weight > 0);
  if (!weighted.length) return attributes;
  const currentScore = weighted.reduce((sum, entry) => sum + entry.value * entry.weight, 0);
  const calibration = currentScore > 0 ? ca / currentScore : 0;
  if (!Number.isFinite(calibration) || calibration <= 0) return attributes;
  const targetScore = target / calibration;
  let pool = targetScore - currentScore;
  let active = weighted.filter((entry) => entry.value < 20);
  let guard = 0;
  while (pool > 0.05 && active.length && guard < 20) {
    guard += 1;
    // Raw point increases scale with weight (not weighted-score share), so a
    // weight-6 attribute climbs ~6x faster than a weight-1 one for the same
    // pool — dividing a weight-proportional share back by that same weight
    // would cancel the proportionality out, so the pool is apportioned by
    // weight^2 here and converted to raw points via a single weight factor.
    const jittered = active.map((entry) => entry.weight * (0.85 + rng() * 0.3));
    const sumSquaredWeights = jittered.reduce((sum, weight) => sum + weight * weight, 0);
    let distributed = 0;
    active.forEach((entry, position) => {
      const rawIncrease = sumSquaredWeights > 0
        ? (pool * jittered[position]) / sumSquaredWeights
        : 0;
      const capacity = 20 - entry.value;
      const actualIncrease = Math.min(rawIncrease, capacity);
      entry.value += actualIncrease;
      distributed += actualIncrease * entry.weight;
    });
    pool -= distributed;
    active = active.filter((entry) => entry.value < 19.99);
  }
  const result = attributes.map((entry) => ({ ...entry }));
  for (const entry of weighted) {
    result[entry.index] = { ...result[entry.index], value: Math.round(clamp(1, 20, entry.value)) };
  }
  return result;
}
