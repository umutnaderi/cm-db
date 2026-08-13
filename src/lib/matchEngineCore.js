// Shared match-engine core: the pure, DOM-free scenario resolvers, attribute
// resolution chain, and zone data that drive match outcomes. Extracted from
// draft-run.js so a second consumer (the Match Lab playground, see
// MATCH_LAB_PLAN.md) can call the exact same decision functions the real
// match engine uses -- constructing a handful of players and asking "what
// does the engine decide here?" -- without duplicating or reimplementing any
// of this logic.
//
// Every function here is a pure decision function: given explicit inputs
// (players, zone, pressure, a seeded random), it returns which outcome fired
// -- it does not push timeline events, mutate match state, or touch the DOM.
// Turning an outcome into an event (text, zone change, possession change)
// happens at the call site, in draft-run.js's tick loop. See
// MATCH_ENGINE_SCENARIOS.md for the full scenario-tree design.

// ---------------------------------------------------------------------------
// Zone system -- 12 zones, 4 rows (row 0 = attacking third/box) x 3 columns.
// ---------------------------------------------------------------------------

export const MIRRORED_ZONE = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
export const ZONE_CENTERS = [
  [16.667, 12.5], [50, 12.5], [83.333, 12.5],
  [16.667, 37.5], [50, 37.5], [83.333, 37.5],
  [16.667, 62.5], [50, 62.5], [83.333, 62.5],
  [16.667, 87.5], [50, 87.5], [83.333, 87.5],
];
export const ZONE_TRANSITION_MATRIX = Array.from({ length: 12 }, (_, zone) => {
  const row = Math.floor(zone / 3);
  const column = zone % 3;
  const targetsInRow = (targetRow) => [column, column - 1, column + 1]
    .filter((targetColumn) => targetColumn >= 0 && targetColumn <= 2)
    .map((targetColumn) => targetRow * 3 + targetColumn);
  return {
    adjacent: row > 0 ? targetsInRow(row - 1) : [0, 1, 2],
    bypass: row === 2 ? targetsInRow(0) : [],
  };
});

export function displayZone(zone, side) {
  const validZone = clamp(0, 11, Number(zone) || 0);
  return side === "opponent" ? MIRRORED_ZONE[validZone] : validZone;
}

// ---------------------------------------------------------------------------
// RNG and math utilities.
// ---------------------------------------------------------------------------

export function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

export function clamp(minimum, maximum, value) {
  return Math.max(minimum, Math.min(maximum, value));
}

export function average(values) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

export function weightedChoice(options, random) {
  const total = options.reduce((sum, option) => sum + Math.max(0, option.weight), 0);
  if (!total) return options[0]?.value;
  let roll = random() * total;
  for (const option of options) {
    roll -= Math.max(0, option.weight);
    if (roll < 0) return option.value;
  }
  return options.at(-1)?.value;
}

export function playerName(player) {
  return player?.canonical_player_name
    || player?.display_name
    || player?.full_name
    || "Unknown player";
}

// ---------------------------------------------------------------------------
// MATCH_TRACE -- opt-in dev-mode transition tracing (see
// MATCH_ENGINE_SCENARIOS.md, "Observed Scenario Graph"). Disabled by
// default; enable via MATCH_TRACE=true (Node) or
// globalThis.__MATCH_TRACE__ = true (browser/sandbox) to record every
// scenario resolution's outcome, instead of hand-patching the source to
// debug an unreachable/starved branch -- which is literally how the corner
// and free-kick bugs were found, before this existed as a real feature.
// ---------------------------------------------------------------------------

export const MATCH_TRACE = (typeof process !== "undefined" && process.env && process.env.MATCH_TRACE === "true")
  || Boolean(globalThis.__MATCH_TRACE__);

export function traceScenario(entry) {
  if (!MATCH_TRACE) return;
  if (!globalThis.__matchTrace) globalThis.__matchTrace = [];
  globalThis.__matchTrace.push(entry);
}

// ---------------------------------------------------------------------------
// Position classification -- used by the attribute-resolution baseline and
// by resolvers that need a coarse role check.
// ---------------------------------------------------------------------------

export function isAttacker(player) {
  return player?.line === "attack"
    || /(^|\/|\s)(?:F|S|A)(?:\s|\/|$)/i.test(String(player?.position_text || ""));
}

export function isMidfielder(player) {
  return player?.line === "midfield"
    || /(^|\/|\s)(?:M|DM|AM)(?:\s|\/|$)/i.test(String(player?.position_text || ""));
}

export function isGoalkeeper(player) {
  if (player?.role) return player.role === "GK";
  return /(^|\/|\s)GK($|\/|\s)/i.test(String(player?.position_text || ""));
}

export function isDefender(player) {
  return player?.line === "defence"
    || /(^|\/|\s)(?:D|SW|WB)(?:\s|\/|$)/i.test(String(player?.position_text || ""));
}

export function playerPreferredColumn(player, random) {
  const position = String(player?.role || player?.position_text || "").toUpperCase();
  if (/(?:^|\/|\s)(?:D|DM|M|AM|F|WB)L(?:$|\/|\s)/.test(position)) return 0;
  if (/(?:^|\/|\s)(?:D|DM|M|AM|F|WB)R(?:$|\/|\s)/.test(position)) return 2;
  return random() < 0.72 ? 1 : random() < 0.5 ? 0 : 2;
}

// ---------------------------------------------------------------------------
// Attribute resolution -- direct -> alias -> proxy -> CA-baseline fallback
// chain, edition-aware for legacy databases missing individual attributes.
// ---------------------------------------------------------------------------

export const LEGACY_ATTRIBUTE_DATABASES = new Set([
  "cm9697",
  "cm9697_vanilla_original",
  "cm9798",
  "cm9798_vanilla_original",
]);

export const ENGINE_ATTRIBUTE_RULES = {
  "acceleration": [["Pace", 1]],
  "agility": [["Pace", 0.45], ["Technique", 0.35], ["Dribbling", 0.2]],
  "anticipation": [["Positioning", 0.45], ["Consistency", 0.3], ["Creativity", 0.25]],
  "balance": [["Strength", 0.45], ["Technique", 0.3], ["Pace", 0.25]],
  "crossing": [["Passing", 0.5], ["Technique", 0.35], ["Set Pieces", 0.15]],
  "decisions": [["Consistency", 0.4], ["Positioning", 0.3], ["Creativity", 0.3]],
  "first touch": [["Technique", 0.55], ["Dribbling", 0.25], ["Passing", 0.2]],
  "handling": [["Goalkeeper", 0.5], ["Consistency", 0.25], ["Positioning", 0.25]],
  "jumping": [["Heading", 0.55], ["Strength", 0.45]],
  "long shots": [["Shooting", 0.65], ["Finishing", 0.2], ["Technique", 0.15]],
  "one on ones": [["Goalkeeper", 0.45], ["Positioning", 0.3], ["Anticipation", 0.25]],
  "off the ball": [["Positioning", 0.4], ["Creativity", 0.25], ["Flair", 0.2], ["Consistency", 0.15]],
  "reflexes": [["Goalkeeper", 0.5], ["Pace", 0.25], ["Consistency", 0.25]],
  "strength": [["Heading", 0.4], ["Stamina", 0.35], ["Tackling", 0.25]],
  "teamwork": [["Work Rate", 0.35], ["Consistency", 0.3], ["Character", 0.2], ["Determination", 0.15]],
  "vision": [["Creativity", 0.45], ["Passing", 0.3], ["Technique", 0.15], ["Flair", 0.1]],
  "work rate": [["Stamina", 0.35], ["Determination", 0.3], ["Consistency", 0.2], ["Character", 0.15]],
};

export const ENGINE_ATTRIBUTE_ALIASES = {
  "corners": ["Corner", "Set Pieces"],
  "finishing": ["Shooting"],
  "free kicks": ["Free Kick", "Set Pieces"],
  "goalkeeper": ["Goalkeeping"],
  "long shots": ["Shooting"],
  "one on ones": ["One-on-Ones", "One On One"],
  "set pieces": ["Set Pieces"],
};

const engineAttributeCache = new WeakMap();

export function normalizedAttributeLabel(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replaceAll("-", " ")
    .replace(/\s+/g, " ");
}

export function playerAttributeEntries(player) {
  const lists = [
    player?.attributes,
    player?.hiddenAttributes,
    player?.hidden_attributes,
    player?.profile?.attributes,
    player?.profile?.hiddenAttributes,
    player?.profile?.hidden_attributes,
  ];
  return lists.flatMap((list) => Array.isArray(list) ? list : []);
}

export function rawPlayerAttributeMap(player) {
  const values = new Map();
  for (const item of playerAttributeEntries(player)) {
    const label = normalizedAttributeLabel(item?.label);
    const value = Number(item?.value);
    // CM attributes use 1-20. A stored zero represents an unset value.
    if (label && value > 0 && value <= 20 && !values.has(label)) {
      values.set(label, value);
    }
  }
  return values;
}

export function playerCaBaseline(player) {
  return clamp(1, 20, (Number(player?.current_ability) || 100) / 10);
}

export function positionalAttributeBaseline(player, label) {
  const base = playerCaBaseline(player);
  const key = normalizedAttributeLabel(label);
  const goalkeeper = isGoalkeeper(player);
  const defender = isDefender(player);
  const midfielder = isMidfielder(player);
  const attacker = isAttacker(player);
  let adjustment = 0;

  if (["handling", "reflexes", "one on ones"].includes(key)) {
    adjustment = goalkeeper ? 1 : -8;
  } else if (["marking", "tackling", "positioning", "anticipation"].includes(key)) {
    adjustment = defender ? 1 : attacker ? -2 : 0;
  } else if (["passing", "creativity", "vision", "technique", "teamwork"].includes(key)) {
    adjustment = midfielder ? 1 : 0;
  } else if (["finishing", "off the ball", "heading", "long shots"].includes(key)) {
    adjustment = attacker ? 1 : defender ? -1 : 0;
  } else if (key === "crossing") {
    adjustment = /(?:L|R)/i.test(String(player?.position_text || player?.role || ""))
      ? 1
      : 0;
  }
  return clamp(1, 20, base + adjustment);
}

export function directEngineAttribute(raw, label) {
  const key = normalizedAttributeLabel(label);
  if (raw.has(key)) return { value: raw.get(key), source: "direct", confidence: 1 };
  for (const alias of ENGINE_ATTRIBUTE_ALIASES[key] || []) {
    const aliasKey = normalizedAttributeLabel(alias);
    if (raw.has(aliasKey)) {
      return { value: raw.get(aliasKey), source: "alias", confidence: 0.82 };
    }
  }
  return null;
}

export function engineAttributeDetail(player, label) {
  const key = normalizedAttributeLabel(label);
  const cached = player && typeof player === "object"
    ? engineAttributeCache.get(player)?.get(key)
    : null;
  if (cached) return cached;
  const remember = (detail) => {
    if (player && typeof player === "object") {
      if (!engineAttributeCache.has(player)) engineAttributeCache.set(player, new Map());
      engineAttributeCache.get(player).set(key, detail);
    }
    return detail;
  };
  const raw = rawPlayerAttributeMap(player);
  const direct = directEngineAttribute(raw, label);
  if (direct) return remember(direct);

  const proxies = ENGINE_ATTRIBUTE_RULES[key] || [];
  let weightedTotal = 0;
  let availableWeight = 0;
  for (const [proxyLabel, weight] of proxies) {
    const proxy = directEngineAttribute(raw, proxyLabel);
    if (!proxy) continue;
    weightedTotal += proxy.value * weight;
    availableWeight += weight;
  }

  const baseline = positionalAttributeBaseline(player, key);
  if (!availableWeight) {
    return remember({ value: baseline, source: "baseline", confidence: 0.35 });
  }

  const proxyAverage = weightedTotal / availableWeight;
  const database = String(player?.database_slug || "");
  const proxyShare = LEGACY_ATTRIBUTE_DATABASES.has(database) ? 0.62 : 0.72;
  return remember({
    value: clamp(1, 20, proxyAverage * proxyShare + baseline * (1 - proxyShare)),
    source: "inferred",
    confidence: LEGACY_ATTRIBUTE_DATABASES.has(database) ? 0.58 : 0.68,
  });
}

export function engineAttribute(player, label) {
  return engineAttributeDetail(player, label).value;
}

export function normalizedEngineRatings(player) {
  const labels = [
    "Passing", "Creativity", "Vision", "Technique", "First Touch",
    "Dribbling", "Crossing", "Off the Ball", "Finishing", "Long Shots",
    "Heading", "Marking", "Tackling", "Positioning", "Anticipation",
    "Pace", "Acceleration", "Agility", "Balance", "Strength", "Stamina",
    "Work Rate", "Teamwork", "Decisions", "Handling", "Reflexes",
    "One On Ones", "Jumping", "Corners", "Free Kicks", "Set Pieces",
  ];
  const ratings = Object.fromEntries(labels.map((label) => [
    label,
    engineAttributeDetail(player, label),
  ]));
  return {
    ratings,
    confidence: average(Object.values(ratings).map((rating) => rating.confidence)),
    legacy: LEGACY_ATTRIBUTE_DATABASES.has(String(player?.database_slug || "")),
  };
}

export function playerAttribute(player, ...labels) {
  for (const label of labels) {
    const detail = engineAttributeDetail(player, label);
    if (detail.source !== "baseline") return detail.value;
  }
  return engineAttribute(player, labels[0]);
}

// ---------------------------------------------------------------------------
// Duel system -- localizedDuel is the base ratio-based probability formula;
// contestedRace is its "footrace to a loose ball/space" instantiation.
// zone-band congestion (CONGESTED_ZONES) adds attribute-confidence-weighted
// variance so unreliable (inferred/baseline) attributes wobble more under
// pressure than direct ones.
// ---------------------------------------------------------------------------

export function conditionMultiplier(player, minute) {
  const stamina = playerAttribute(player, "Stamina");
  const workRate = playerAttribute(player, "Work Rate");
  const endurance = clamp(0.05, 1, (stamina * 0.68 + workRate * 0.32) / 20);
  const fatigueProgress = clamp(0, 1, (Number(minute) - 20) / 100);
  const fatigueCost = (0.07 + (1 - endurance) * 0.34) * fatigueProgress ** 1.15;
  return clamp(0.58, 1, 1 - fatigueCost);
}

export const CONGESTED_ZONES = new Set([4, 5, 7, 8]);

export function zonalAttribute(player, label, zone, random) {
  const detail = engineAttributeDetail(player, label);
  if (!CONGESTED_ZONES.has(zone)) return detail.value;
  const uncertainty = 1 - detail.confidence;
  const reliabilityPenalty = uncertainty * 0.14;
  const variance = (random() - 0.5) * uncertainty * 0.34;
  return detail.value * clamp(0.68, 1.08, 1 - reliabilityPenalty + variance);
}

export function duelAttribute(player, labels, zone, random) {
  return average(labels.map((label) => zonalAttribute(player, label, zone, random))) / 20;
}

export function localizedDuel(attacker, defender, attackLabels, defenceLabels, minute, random, zone = -1) {
  const attackerCondition = conditionMultiplier(attacker, minute);
  const defenderCondition = conditionMultiplier(defender, minute);
  const auraMultiplier = (player) => clamp(
    1,
    1.14,
    1 + Math.max(0, Number(player?.current_ability || 0) - 180) / 90,
  );
  const attackPower = duelAttribute(attacker, attackLabels, zone, random)
    * attackerCondition * auraMultiplier(attacker);
  const defencePower = duelAttribute(defender, defenceLabels, zone, random)
    * defenderCondition * auraMultiplier(defender);
  const probability = attackPower + defencePower > 0
    ? attackPower / (attackPower + defencePower)
    : 0.5;
  return {
    probability,
    won: random() < probability,
    attackerCondition,
    defenderCondition,
  };
}

// ---------------------------------------------------------------------------
// Scenario heuristics — see MATCH_ENGINE_SCENARIOS.md for the full design.
// Five reusable resolution shapes, each instantiated many times with
// different attribute weights/context rather than one bespoke formula per
// scenario code. These are pure decision functions: they return which
// outcome code fired, not a timeline event — turning a code into an actual
// event (text, zone, possession change) happens at the call site, once a
// scenario is wired into the live match flow.
//
// "Decision Menu" has no wrapper of its own — it's exactly what the
// existing weightedChoice(options, random) already does, so every menu
// below (finish type, tackle engagement, etc.) calls it directly.
// ---------------------------------------------------------------------------

export function contestedRace(attacker, defender, minute, random, zone = -1, { aerial = false } = {}) {
  return localizedDuel(
    attacker,
    defender,
    ["Pace", "Acceleration", "Anticipation", "Off the Ball"],
    aerial
      ? ["Positioning", "Anticipation", "Marking"]
      : ["Positioning", "Anticipation", "Strength"],
    minute,
    random,
    zone,
  );
}

// Pressure widened into this decision (see MATCH_ENGINE_SCENARIOS.md,
// "Promoted: P.RECEIVE" -> pressure consumers) -- which finish a player
// even reaches for is a composure-related decision, not just whether it
// lands on target (that's already handled downstream by pressureMultiplier
// on the on-target roll). A rushed shot under pressure is more likely to
// just be smashed at goal than calmly placed, independent of the shooter's
// own composure -- pressure erodes the "calm" option and inflates "blast"
// symmetrically, same shape as the composure term it's added alongside.
export function selectFinishType(attacker, random, pressure = 0) {
  const composure = playerAttribute(attacker, "Composure");
  const technique = playerAttribute(attacker, "Technique");
  const finishing = playerAttribute(attacker, "Finishing");
  const flair = playerAttribute(attacker, "Flair");
  return weightedChoice([
    { value: "calm", weight: Math.max(1, (composure + technique + finishing) * (1 - pressure * 0.3)) },
    { value: "blast", weight: Math.max(1, 20 - composure) + finishing + pressure * 10 },
    { value: "finesse", weight: technique + flair },
  ], random);
}

// Floor/ceiling are calibrated against real shot-accuracy rates (~35-55% of
// shots on target), not just "does it look competent" — blast sacrifices
// accuracy for power, so it sits lowest.
export const FINISH_TYPE_LABELS = {
  calm: { attack: ["Composure", "Technique", "Finishing"], floor: 0.28, ceiling: 0.62 },
  blast: { attack: ["Finishing", "Technique"], floor: 0.18, ceiling: 0.5 },
  finesse: { attack: ["Technique", "Finishing"], floor: 0.22, ceiling: 0.56 },
  // X1.A -- a contested aerial header is moderately hard to direct
  // accurately, closer to finesse than calm placement.
  header: { attack: ["Heading", "Jumping", "Off the Ball"], floor: 0.22, ceiling: 0.54 },
};

// Does the attempt even threaten the goal, before the keeper gets involved.
// Miss flavor differs deliberately by finish type: a bad calm attempt dies
// weakly, a bad blast sails over ("row Z"), a bad finesse drifts wide.
export function resolveFinishAttempt(finishType, shooter, random, contextMultiplier = 1) {
  const config = FINISH_TYPE_LABELS[finishType] || FINISH_TYPE_LABELS.calm;
  const skill = average(config.attack.map((label) => playerAttribute(shooter, label))) / 20;
  const chance = clamp(
    config.floor * 0.5,
    config.ceiling,
    (config.floor + skill * (config.ceiling - config.floor)) * contextMultiplier,
  );
  if (random() < chance) return { onTarget: true, code: `F.${finishType.toUpperCase()}` };
  const missCode = {
    calm: "F.CALM.WEAK",
    blast: "F.BLAST.OVER",
    finesse: "F.FINESSE.WIDE",
    header: "F.HEADER.OFF",
  }[finishType] || "F.CALM.WEAK";
  return { onTarget: false, code: missCode };
}

export const KEEPER_DUEL_LABELS = {
  calm: { attack: ["Composure", "Technique", "Finishing"], keeper: ["Reflexes", "Positioning"] },
  blast: { attack: ["Finishing", "Technique"], keeper: ["Reflexes"] },
  finesse: { attack: ["Technique", "Finishing"], keeper: ["Positioning", "Anticipation"] },
  header: { attack: ["Heading", "Jumping", "Off the Ball"], keeper: ["Jumping", "Positioning", "Reflexes"] },
};

// K.SAVE — keeper resolves an on-target shot. `finishType` shapes both the
// shooter/keeper duel labels and the outcome weighting (power shots skew
// toward parries over clean catches; corner-seeking finishes — calm/finesse
// — are the only ones that can clip the frame).
export function resolveKeeperSave(shooter, keeper, finishType, minute, random, zone = 1) {
  const labels = KEEPER_DUEL_LABELS[finishType] || KEEPER_DUEL_LABELS.calm;
  const duel = localizedDuel(shooter, keeper, labels.attack, labels.keeper, minute, random, zone);
  // duel.probability is a 0-1 ratio centered near 0.5 for evenly matched
  // players -- right for a contested tackle, far too generous for "beaten
  // with no save attempt at all," which is rare even against a weak keeper.
  // Dampened with a power curve rather than used as a direct coin flip.
  const beatenCleanChance = clamp(0.02, 0.32, duel.probability ** 2.6 * 0.55);
  if (random() < beatenCleanChance) return { code: "K.SAVE.0", goal: true, rebound: false };

  const handling = playerAttribute(keeper, "Handling");
  const reflexes = playerAttribute(keeper, "Reflexes");
  const positioning = playerAttribute(keeper, "Positioning");
  const power = finishType === "blast" ? 1.4 : 1;
  const postProne = finishType !== "blast"; // corner-seeking finishes clip the frame more often

  const options = [
    { value: "K.SAVE.1", weight: handling * 2 },
    { value: "K.SAVE.2", weight: Math.max(1, 20 - handling) * power },
    { value: "K.SAVE.3", weight: reflexes + positioning },
    { value: "K.SAVE.4", weight: Math.max(1, 20 - handling) * 0.6 },
    { value: "K.SAVE.5", weight: Math.max(1, 20 - handling) * 0.5 * power },
  ];
  if (postProne) {
    options.push(
      { value: "K.SAVE.6", weight: Math.max(0.5, 8 - positioning * 0.3) },
      { value: "K.SAVE.7", weight: Math.max(0.5, 6 - positioning * 0.2) },
      { value: "K.SAVE.8", weight: Math.max(0.1, 2 - positioning * 0.15) },
    );
  }
  const code = weightedChoice(options, random);
  const rebound = code === "K.SAVE.2" || code === "K.SAVE.5" || code === "K.SAVE.6";
  const goal = code === "K.SAVE.8";
  return { code, goal, rebound };
}

// K.ONEONONE — isolated breakaway, no defensive cover. Composure-driven
// rather than power/placement-driven, since this is a mental contest more
// than a technical one: keep your head vs. don't commit early.
export function resolveOneOnOne(shooter, keeper, minute, random, zone = 1) {
  const composure = playerAttribute(shooter, "Composure");
  const duel = localizedDuel(
    shooter,
    keeper,
    ["Composure", "Finishing", "Technique"],
    ["One On Ones", "Positioning"],
    minute,
    random,
    zone,
  );
  // Same dampening idea as K.SAVE, but gentler -- a genuine breakaway
  // realistically converts far more often than a contested shot, since the
  // keeper is isolated rather than protected by a crowded box.
  const composedGoalChance = clamp(0.08, 0.55, duel.probability ** 1.6 * 0.7);
  if (random() < composedGoalChance) return { code: "K.ONEONONE.1", goal: true, rebound: false };

  const oneOnOnes = playerAttribute(keeper, "One On Ones");
  const positioning = playerAttribute(keeper, "Positioning");
  const flair = playerAttribute(shooter, "Flair");
  const code = weightedChoice([
    { value: "K.ONEONONE.2", weight: Math.max(1, 20 - composure) },
    { value: "K.ONEONONE.3", weight: oneOnOnes },
    { value: "K.ONEONONE.4", weight: Math.max(1, (flair + composure) / 2 - 6) },
    { value: "K.ONEONONE.5", weight: oneOnOnes + positioning },
    { value: "K.ONEONONE.6", weight: 0.15 }, // brought down before he can finish -- rare, but real
  ], random);
  return { code, goal: false, rebound: code === "K.ONEONONE.3" };
}

// D.* -- defender's engagement choice (see MATCH_ENGINE_SCENARIOS.md). Called
// only once the ball carrier's broader progression duel has already gone the
// defender's way; this decides the *flavor* of that win, not whether it
// happens -- a clean tackle, a loose ball, or (rarely) a foul/beaten-clean
// miss despite the aggregate outcome favoring the defense.
export function selectEngagement(defender, raceWasClose, random) {
  const tackling = playerAttribute(defender, "Tackling");
  const positioning = playerAttribute(defender, "Positioning");
  const anticipation = playerAttribute(defender, "Anticipation");
  const aggression = playerAttribute(defender, "Aggression");
  const bravery = playerAttribute(defender, "Bravery");
  const composure = playerAttribute(defender, "Composure");
  const strength = playerAttribute(defender, "Strength");
  const slideBoost = raceWasClose ? 1.5 : 1;
  return weightedChoice([
    { value: "D.STAND", weight: tackling + positioning + anticipation },
    { value: "D.SLIDE", weight: (aggression + bravery + tackling) * slideBoost },
    { value: "D.DUEL", weight: Math.max(1, positioning + composure + strength - aggression * 0.4) },
  ], random);
}

// zoneRow gives the same shape (won/loose/foul/beaten) real X1-vs-M1
// zone-band differentiation instead of one flat weighting everywhere: the
// box (row 0) is safety-biased -- a composed, unhurried "beaten" is rarer
// (defenders panic more under direct goal threat) and loose/scrambly
// outcomes are more common, matching X1.D's table; midfield (elsewhere)
// keeps the calmer M1.D-style weighting.
export function resolveEngagement(engagementType, defender, random, zoneRow = 2) {
  const aggression = playerAttribute(defender, "Aggression");
  const bravery = playerAttribute(defender, "Bravery");
  const inBox = zoneRow === 0;
  const foulWeight = clamp(0.005, 0.25, (aggression + bravery) / 20 * (
    engagementType === "D.SLIDE" ? 0.06 : engagementType === "D.STAND" ? 0.025 : 0.008
  ) * (inBox ? 1.4 : 1));
  const beatenChance = (engagementType === "D.DUEL" ? 0.1 : 0.05) * (inBox ? 0.5 : 1);
  const looseChance = (engagementType === "D.SLIDE" ? 0.3 : engagementType === "D.DUEL" ? 0.1 : 0.2)
    * (inBox ? 1.3 : 1);
  const roll = random();
  if (roll < foulWeight) return { code: `${engagementType}.3`, outcome: "foul" };
  if (roll < foulWeight + beatenChance) return { code: `${engagementType}.3`, outcome: "beaten" };
  if (roll < foulWeight + beatenChance + looseChance) return { code: `${engagementType}.2`, outcome: "loose" };
  return { code: `${engagementType}.1`, outcome: "won" };
}

// Foul/Discipline -- advantage first, then restart by zone, then card
// severity. Last-man fouls (denying a clear goalscoring chance) are an
// automatic red regardless of contact severity.
export function resolveFoul(defender, engagementType, zone, isLastMan, minute, random) {
  const composure = playerAttribute(defender, "Composure");
  const advantage = !isLastMan && random() < clamp(0.15, 0.4, 0.25 + composure / 200);
  const row = Math.floor(zone / 3);
  const restart = advantage ? "none" : row === 0 ? "penalty" : "free-kick";
  if (isLastMan) return { advantage, restart, card: "red" };

  const aggression = playerAttribute(defender, "Aggression");
  const bravery = playerAttribute(defender, "Bravery");
  const severity = (engagementType === "D.SLIDE" ? 1.5 : 1)
    * clamp(0.3, 2.2, (aggression + bravery) / 22);
  const card = weightedChoice([
    { value: "none", weight: Math.max(1, 14 - severity * 3.2) },
    { value: "yellow", weight: severity * 3.2 },
    { value: "red", weight: Math.max(0, severity - 2.1) * 0.6 },
  ], random);
  return { advantage, restart, card };
}

// In-play penalty kick -- a specialized, even more composure-dominant
// one-on-one from a fixed, high-quality position. Real conversion rates are
// high (~75-80%), so this is calibrated well above a normal shot or even a
// normal breakaway.
export function resolvePenaltyKick(taker, keeper, minute, random) {
  const duel = localizedDuel(
    taker,
    keeper,
    ["Composure", "Penalty Taking", "Technique"],
    ["One On Ones", "Reflexes"],
    minute,
    random,
    1,
  );
  return { goal: random() < clamp(0.55, 0.92, duel.probability ** 0.7) };
}

// DELIVERY.SELECT -- shared by corners and wide free kicks (see
// MATCH_ENGINE_SCENARIOS.md). Cross vs. short, weighted by the taker's
// delivery attribute (majority) against a flat "go short" baseline.
// `primaryLabel` is "Corners" for an actual corner, "Crossing" for a wide
// free kick -- same mechanism, different attribute per origin.
export function selectDeliveryChoice(taker, primaryLabel, random) {
  const specialist = playerAttribute(taker, primaryLabel, "Set Pieces");
  const technique = playerAttribute(taker, "Technique");
  return weightedChoice([
    { value: "cross", weight: specialist * 2 + technique },
    { value: "short", weight: 8 },
  ], random);
}

// DELIVERY.SWING -- inswinger vs. outswinger. Real derivation is from the
// taker's preferred foot relative to which side the delivery comes from,
// but foot preference isn't currently plumbed into match players (deferred
// to the backlog); a coin flip captures the *gameplay* asymmetry, which is
// the part that actually matters here, without needing that data first.
//
// Inswingers put the keeper heavily in the game but he's more error-prone
// (small direct chance nobody touches it and it just goes in, plus a
// messiness bump that can turn what would've been a clean stop into a
// fumble/rebound instead). Outswingers pull the keeper out of the contest
// almost entirely -- the danger shifts onto the aerial duel itself, with a
// clean-contact header getting a power bonus (moving into the ball's
// outward curl), and an unconnected one drifting through for a throw-in
// rather than creating danger.
export function resolveDelivery(target, marker, keeper, minute, random, zone = 1) {
  const inswing = random() < 0.55;
  if (inswing && random() < 0.03) {
    return { code: "DELIVERY.INSWING.GHOST", goal: true, rebound: false, inswing };
  }
  if (!inswing && random() < 0.14) {
    return { code: "DELIVERY.OUTSWING.THROUGH", goal: false, rebound: false, inswing, throughUntouched: true };
  }
  const race = contestedRace(target, marker, minute, random, zone, { aerial: true });
  if (!race.won) {
    return { code: "DELIVERY.CLEARED", goal: false, rebound: false, inswing, defended: true };
  }
  const headerAttempt = resolveFinishAttempt("header", target, random, inswing ? 1 : 1.15);
  if (!headerAttempt.onTarget) {
    return { code: headerAttempt.code, goal: false, rebound: false, inswing };
  }
  const save = resolveKeeperSave(target, keeper, "header", minute, random, zone);
  if (inswing && !save.goal && !save.rebound && random() < 0.25) {
    return { code: save.code, goal: false, rebound: true, inswing };
  }
  return { ...save, inswing };
}

// FK.SHOT -- dead-ball shooting is a distinct, practiced skill from
// open-play finishing (see MATCH_ENGINE_SCENARIOS.md), so this does *not*
// reuse F.SELECT's weights -- only its shape (regular/hard/curled). Free
// Kick Taking dominates every sub-type (aliases to the legacy combined "Set
// Pieces" attribute for editions that don't split it out); the secondary
// attribute is what differentiates why a taker leans toward one over
// another.
export const FREE_KICK_SHOT_LABELS = {
  regular: { attack: ["Free Kick Taking", "Technique"], floor: 0.3, ceiling: 0.64 },
  hard: { attack: ["Free Kick Taking", "Long Shots"], floor: 0.2, ceiling: 0.52 },
  curl: { attack: ["Free Kick Taking", "Technique"], floor: 0.24, ceiling: 0.58 },
};

export function selectFreeKickShotType(taker, random) {
  const freeKickTaking = playerAttribute(taker, "Free Kick Taking", "Set Pieces");
  const technique = playerAttribute(taker, "Technique");
  const longShots = playerAttribute(taker, "Long Shots");
  return weightedChoice([
    { value: "regular", weight: freeKickTaking + technique * 0.5 },
    { value: "hard", weight: freeKickTaking * 0.6 + longShots },
    { value: "curl", weight: freeKickTaking + technique * 0.7 },
  ], random);
}

export function resolveFreeKickAttempt(shotType, taker, random, contextMultiplier = 1) {
  const config = FREE_KICK_SHOT_LABELS[shotType] || FREE_KICK_SHOT_LABELS.regular;
  const skill = average(config.attack.map((label) => playerAttribute(taker, label))) / 20;
  const chance = clamp(
    config.floor * 0.5,
    config.ceiling,
    (config.floor + skill * (config.ceiling - config.floor)) * contextMultiplier,
  );
  if (random() < chance) return { onTarget: true, code: `FK.SHOT.${shotType.toUpperCase()}` };
  const missCode = {
    regular: "FK.SHOT.REGULAR.WEAK",
    hard: "FK.SHOT.HARD.OVER",
    curl: "FK.SHOT.CURL.WIDE",
  }[shotType] || "FK.SHOT.REGULAR.WEAK";
  return { onTarget: false, code: missCode };
}

// FK.WALL -- does the free kick even get past the defensive wall, before
// reaching the keeper at all. Structurally the same shape as K.SAVE's Tier
// 1 (an obstacle either lets it through or doesn't). A blocked attempt
// reuses existing machinery: a loose ball becomes a Contested Race, a
// deflection is the same idea as F.DEFLECT (a wall block is mechanically
// the same as a defender's blocking touch on an open-play shot).
export function resolveWall(taker, wallDefenders, random) {
  // No wall means no wall contact -- there's nothing there to hit. The old
  // formula gave an explicitly empty wall a flat 0.3 "phantom" coverage
  // (confirmed via browser testing: ~18% of attempts hit a wall that
  // wasn't there), which this replaces with the only coherent answer.
  if (!wallDefenders.length) return { hit: false, code: "FK.WALL.NONE" };
  const takerSkill = (
    playerAttribute(taker, "Free Kick Taking", "Set Pieces") + playerAttribute(taker, "Technique")
  ) / 40;
  // Average quality still matters (a wall of tall, well-positioned
  // defenders covers more of the frame than a wall of the same size with
  // poor ones), but average() alone made wall SIZE invisible -- a 1-man and
  // a 5-man wall of identical players produced identical coverage
  // (confirmed via browser testing: ~55-57% for both). sizeFactor adds a
  // diminishing-returns boost for each additional body (a second/third
  // defender covers meaningfully more frame; a sixth barely does, since
  // there's only so much goal a wall can physically block).
  const avgQuality = average(wallDefenders.map((defender) =>
    playerAttribute(defender, "Jumping") + playerAttribute(defender, "Positioning"))) / 40;
  const sizeFactor = 1 - Math.exp(-wallDefenders.length / 2);
  const wallCoverage = avgQuality * sizeFactor;
  // Taker skill's weight and the ceiling both moved: the old 0.55 ceiling
  // was reached by almost any single decent defender regardless of taker
  // quality (Roberto Carlos vs. one CB: ~56%, a mediocre taker vs. the same
  // CB: ~57%), so elite technique could barely escape a modest wall. A
  // stronger coefficient lets a genuinely elite taker cut hit chance close
  // to zero against a small wall, while a raised ceiling lets a large,
  // well-composed wall meaningfully punish a poor taker -- both were
  // structurally impossible before.
  const hitChance = clamp(0, 0.65, wallCoverage - takerSkill * 0.45 + 0.12);
  if (random() >= hitChance) return { hit: false, code: "FK.WALL.PAST" };
  const outcome = weightedChoice([
    { value: "loose", weight: 3 },
    { value: "deflect", weight: 2 },
    { value: "out", weight: 3 },
  ], random);
  return { hit: true, code: "FK.WALL.HIT", outcome };
}

// Shot-blocking (see MATCH_ENGINE_SCENARIOS.md open items) -- a nearby
// defender throws their body in front of the shot before it even reaches
// the keeper. Bravery-driven (the willingness to commit to it), aided by
// Positioning/Anticipation (already standing in the lane) and Strength.
// Blast/power shots are easier to get a body in front of (straight-line,
// predictable) than finesse/curl attempts, which bend away from a block --
// scoped to regular open-play footed shots only: headers already have
// their own contest (the aerial Contested Race in X1), a genuine breakaway
// by definition has no defender close enough to block, and free kicks have
// the analogous FK.WALL instead.
export function resolveShotBlock(defender, finishType, minute, random) {
  const bravery = playerAttribute(defender, "Bravery");
  const positioning = playerAttribute(defender, "Positioning");
  const anticipation = playerAttribute(defender, "Anticipation");
  const blockability = finishType === "blast" ? 1.15 : 0.85;
  const blockChance = clamp(0.02, 0.22,
    ((bravery * 0.5 + positioning * 0.3 + anticipation * 0.2) / 20) * 0.28 * blockability);
  if (random() >= blockChance) return { blocked: false };
  const outcome = weightedChoice([
    { value: "behind", weight: 3 }, // clean block, ball goes out for a corner
    { value: "loose", weight: 3 },  // deflects into a contestable rebound
    { value: "safe", weight: 2 },   // blocked straight back, no danger
  ], random);
  return { blocked: true, outcome, code: "D.BLOCK" };
}

// Pressure -- a unified 0..1 signal consolidating what used to be several
// separate ad-hoc effects (zone congestion, momentum). The new piece is
// transition relief: a fresh turnover means the defense hasn't organized
// yet, so pressure is genuinely lower even in an otherwise congested zone --
// this is what gives counterSteps a real effect on execution, not just a
// goalType label.
export function computePressure(defender, zone, counterSteps) {
  const defenderIntensity = clamp(0, 1, (
    playerAttribute(defender, "Work Rate")
    + playerAttribute(defender, "Aggression")
    + playerAttribute(defender, "Positioning")
  ) / 60);
  const congestionBase = CONGESTED_ZONES.has(zone) ? 0.3 : 0.12;
  const transitionRelief = counterSteps >= 2 ? 0.24 : counterSteps === 1 ? 0.1 : 0;
  return clamp(0.05, 0.95, congestionBase + defenderIntensity * 0.55 - transitionRelief);
}

// Receiver selection (see MATCH_ENGINE_SCENARIOS.md, "Deferred backlog" ->
// promoted). A successful pass previously just moved the ball to the next
// zone with no notion of *which* teammate receives it -- this is the
// concrete Thomas Muller point: a good off-ball mover should show up as a
// receiving option more often, not just carry a flat stat bonus. Passer
// Vision and pressure jointly control how sharply the pick favors the
// single best-suited candidate vs. a broader, more random one -- a
// high-Vision passer under low pressure reliably finds the best option; a
// low-Vision passer under pressure is closer to a coin flip among them.
export function selectReceiver(candidates, targetZone, passerVision, pressure, random) {
  if (!candidates.length) return null;
  const targetColumn = targetZone % 3;
  const sharpness = clamp(0.4, 2.4, (passerVision / 20) * 1.8 * (1 - pressure * 0.5) + 0.3);
  const options = candidates.map((player) => {
    const suitability = playerAttribute(player, "Off the Ball")
      + playerAttribute(player, "Anticipation")
      + playerAttribute(player, "Work Rate") * 0.6
      + playerAttribute(player, "Pace") * 0.6
      + (playerPreferredColumn(player, random) === targetColumn ? 6 : 0);
    return { value: player, weight: Math.max(0.1, suitability) ** sharpness };
  });
  return weightedChoice(options, random);
}

// Body orientation, tried first as a transient detail of P.RECEIVE rather
// than persistent per-player state (see MATCH_ENGINE_SCENARIOS.md, "Round 5
// refinements" -- nothing else in this tree survives across ticks beyond
// zone/side/counterSteps-style scalars, and orientation doesn't need to
// either: it's fully determined by *this* pass, not by anything before it).
// A through ball is received on the run, facing goal; everything else is
// either a tight-marked lay-off (back to goal) or the routine sideways
// default -- no geometric modeling beyond that, per the review's own "no
// need for geometric obsession."
export function receiveOrientation(bypass, pressure) {
  if (bypass) return "FACING_FORWARD";
  return pressure > 0.5 ? "BACK_TO_GOAL" : "SIDEWAYS";
}

// P.RECEIVE (see MATCH_ENGINE_SCENARIOS.md, "Promoted: P.RECEIVE") -- what a
// successful pass actually costs the receiver to control, instead of
// handing possession over for free. The first scenario family built
// directly against the Strangler Fig transition contract: this returns
// intent (status/nextScenario/nextZone/possession/restartType/restartZone/
// context), it does not mutate any tick state itself -- the call site
// applies it, same as every other resolver in this file, but with an
// explicit return shape instead of relying on the caller to know which
// fields matter. `possession` is relative ("retained"/"opponent"), not an
// absolute side, so this function stays pure and side-agnostic.
export function resolveReceive(receiver, defender, passQuality, pressure, bypass, zone, minute, random) {
  const firstTouch = playerAttribute(receiver, "First Touch");
  const technique = playerAttribute(receiver, "Technique");
  const composure = playerAttribute(receiver, "Composure");
  const anticipation = playerAttribute(receiver, "Anticipation");
  // "Strain" is how hard this specific ball is to control: a poor pass
  // (low passQuality, reused from the transitionDuel that just succeeded --
  // no separate formula/roll needed), heavy pressure, or a fast/direct
  // through ball (bypass) all make it harder regardless of the receiver's
  // own quality.
  const control = firstTouch + technique * 0.6 + composure * 0.4 + anticipation * 0.4;
  const strain = (1 - passQuality) * 12 + pressure * 14 + (bypass ? 5 : 0);
  const orientation = receiveOrientation(bypass, pressure);
  // Orientation shifts which options are even sensible, not just their
  // odds in the abstract: facing forward opens up progressive options
  // (more CLEAN, much more KNOCK_FORWARD); back-to-goal is the classic
  // shield-it picture (much more PROTECT, far less KNOCK_FORWARD -- you
  // can't knock the ball forward into space you're facing away from);
  // sideways is the unmodified default.
  const cleanMultiplier = orientation === "FACING_FORWARD" ? 1.15 : orientation === "BACK_TO_GOAL" ? 0.9 : 1;
  const protectMultiplier = orientation === "BACK_TO_GOAL" ? 1.5 : orientation === "FACING_FORWARD" ? 0.8 : 1;
  const knockForwardMultiplier = orientation === "FACING_FORWARD" ? 1.4 : orientation === "BACK_TO_GOAL" ? 0.5 : 1;
  const code = weightedChoice([
    { value: "P.RECEIVE.CLEAN", weight: Math.max(2, control * 1.6 - strain) * cleanMultiplier },
    { value: "P.RECEIVE.PROTECT", weight: Math.max(1, strain * 0.6) * protectMultiplier },
    { value: "P.RECEIVE.HEAVY", weight: Math.max(1, strain - firstTouch * 0.3) },
    {
      value: "P.RECEIVE.KNOCK_FORWARD",
      weight: Math.max(0.5, (firstTouch + anticipation) * 0.3 - pressure * 8) * knockForwardMultiplier,
    },
    { value: "P.RECEIVE.LOSE", weight: Math.max(0.2, strain * 0.4 - firstTouch * 0.35) },
  ], random);

  if (code === "P.RECEIVE.CLEAN" || code === "P.RECEIVE.PROTECT") {
    return {
      status: code === "P.RECEIVE.CLEAN" ? "advance" : "hold",
      nextScenario: "P.SELECT", nextZone: zone, possession: "retained",
      restartType: null, restartZone: null, context: { code, duel: null, orientation },
    };
  }

  if (code === "P.RECEIVE.LOSE") {
    return {
      status: "turnover", nextScenario: "P.SELECT", nextZone: MIRRORED_ZONE[zone],
      possession: "opponent", restartType: null, restartZone: null,
      context: { code, duel: null, orientation },
    };
  }

  if (code === "P.RECEIVE.HEAVY") {
    // Whether the touch is heavy was already decided above by First
    // Touch/pressure/pass quality. Whether it's *recovered* is a different
    // question -- Balance/Strength shielding it from the challenging
    // defender -- so it gets its own duel rather than folding into the menu
    // weights that produced HEAVY in the first place.
    const recovery = localizedDuel(
      receiver, defender,
      ["Balance", "Strength", "First Touch"],
      ["Tackling", "Aggression", "Anticipation"],
      minute, random, zone,
    );
    return recovery.won
      ? {
          status: "hold", nextScenario: "P.SELECT", nextZone: zone, possession: "retained",
          restartType: null, restartZone: null,
          context: { code, duel: recovery, recovered: true, orientation },
        }
      : {
          status: "turnover", nextScenario: "P.SELECT", nextZone: MIRRORED_ZONE[zone],
          possession: "opponent", restartType: null, restartZone: null,
          context: { code, duel: recovery, recovered: false, orientation },
        };
  }

  // P.RECEIVE.KNOCK_FORWARD -- earns the extra zone with a genuine
  // Contested Race (the same footrace-to-space shape used everywhere else),
  // not a free advance or a discount on the next duel.
  const race = contestedRace(receiver, defender, minute, random, zone);
  const row = Math.floor(zone / 3);
  const advancedZone = Math.max(0, row - 1) * 3 + (zone % 3);
  return race.won
    ? {
        status: "advance", nextScenario: "P.SELECT", nextZone: advancedZone, possession: "retained",
        restartType: null, restartZone: null, context: { code, duel: race, won: true, orientation },
      }
    : {
        status: "turnover", nextScenario: "P.SELECT", nextZone: MIRRORED_ZONE[zone],
        possession: "opponent", restartType: null, restartZone: null,
        context: { code, duel: race, won: false, orientation },
      };
}

// ---------------------------------------------------------------------------
// Player scoring -- used by the tick loop to weight *which* player takes an
// action, and (added later, see MATCH_LAB_PLAN.md) by Match Lab's rebound-
// scramble follow-up after a rebound-flagged delivery/keeper save. A
// resolveDelivery()/resolveKeeperSave() call with `rebound: true` is not the
// end of the phase in the real engine -- the tick loop always continues into
// a second contested race for the loose ball plus a shot chance, which is
// where a real share of "eventual goals from a cross" actually come from.
// Match Lab's Scenario Probe and Free Play both missed this at first
// (reported "no goal" the moment a delivery came back rebound-flagged),
// which is exactly the kind of gap this tool exists to surface.
// ---------------------------------------------------------------------------

export function playerAbility(player) {
  return clamp(30, 99, (Number(player?.current_ability) || 100) / 2);
}

export function goalkeeperScore(player) {
  const attributes = average([
    playerAttribute(player, "Handling"),
    playerAttribute(player, "Reflexes"),
    playerAttribute(player, "One On Ones"),
    playerAttribute(player, "Positioning"),
    playerAttribute(player, "Agility"),
    playerAttribute(player, "Jumping"),
  ]) * 5;
  return clamp(25, 99, playerAbility(player) * 0.38 + attributes * 0.62);
}

export function poacherScore(player) {
  const attributes = average([
    playerAttribute(player, "Anticipation"),
    playerAttribute(player, "Acceleration"),
    playerAttribute(player, "Off the Ball"),
    playerAttribute(player, "Finishing", "Shooting"),
  ]) * 5;
  return clamp(25, 99, attributes * 0.8 + playerAbility(player) * 0.2);
}

export function conditionedScore(player, score, minute) {
  return score(player) * conditionMultiplier(player, minute);
}

export function transitionShotChance(shooter, keeper, minute, baseChance, score) {
  const attackPower = conditionedScore(shooter, score, minute) / 100;
  const keeperPower = conditionedScore(keeper, goalkeeperScore, minute) / 100;
  const share = attackPower / Math.max(0.01, attackPower + keeperPower);
  return clamp(0.008, 0.32, baseChance * (0.45 + share * 1.1) * 0.4);
}

// Generic weighted player selection from a pool -- used by the tick loop to
// pick *which* player takes an action (added here, see MATCH_LAB_PLAN.md
// Phase 4, so Match Lab can reuse the exact same delivery/cross-target
// selection the real engine uses instead of a bespoke formula).
export function weightedPlayer(players, random, preferredLine, score) {
  if (!players.length) return null;
  const weighted = players.flatMap((player) => {
    const lineBoost = !preferredLine || player.line === preferredLine ? 3 : 1;
    const weight = clamp(1, 18, Math.round((score(player) - 38) / 4)) * lineBoost;
    return Array.from({ length: weight }, () => player);
  });
  return weighted[Math.floor(random() * weighted.length)] || players[0];
}

export function headerScore(player) {
  const attributes = average([
    playerAttribute(player, "Heading"),
    playerAttribute(player, "Jumping"),
    playerAttribute(player, "Off the Ball"),
    playerAttribute(player, "Strength"),
    playerAttribute(player, "Anticipation"),
  ]) * 5;
  return clamp(25, 99, attributes * 0.78 + playerAbility(player) * 0.22);
}
