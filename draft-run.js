import {
  getDraftRecords,
  getPlayer,
  getPlayerMetrics,
  saveDraftRecord,
  saveDraftSquad,
  searchPlayers,
} from "./src/lib/retroballApi.js?v=20260730-47";
import {
  createDraftSquad,
  formatDraftSquadText,
} from "./src/lib/draftSquad.js?v=20260730-47";

const TEAM_STORAGE_KEY = "retroball-draft-team-v1";
const OPPONENT_CACHE_KEY = "retroball-ucl-opponents-v1";
const MATCH_PACE_KEY = "retroball-match-commentary-pace-v1";
const MATCH_PACES = {
  fast: { label: "Fast", multiplier: 0.58 },
  normal: { label: "Normal", multiplier: 1 },
  slow: { label: "Slow", multiplier: 1.65 },
};
const MIRRORED_ZONE = [11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0];
const ZONE_CENTERS = [
  [16.667, 12.5], [50, 12.5], [83.333, 12.5],
  [16.667, 37.5], [50, 37.5], [83.333, 37.5],
  [16.667, 62.5], [50, 62.5], [83.333, 62.5],
  [16.667, 87.5], [50, 87.5], [83.333, 87.5],
];
const ZONE_TRANSITION_MATRIX = Array.from({ length: 12 }, (_, zone) => {
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
const CLUBS = {
  aek: { name: "AEK Athens", club: "AEK Athens" },
  ajax: { name: "Ajax", club: "AFC Ajax" },
  anderlecht: { name: "Anderlecht", club: "RSC Anderlecht" },
  arsenal: { name: "Arsenal", club: "Arsenal" },
  barcelona: { name: "Barcelona", club: "F.C. Barcelona" },
  basel: { name: "Basel", club: "FC Basel" },
  bayern: { name: "Bayern Munich", club: "FC Bayern München" },
  besiktas: { name: "Beşiktaş", club: "Besiktas JK", club0203: "Besiktas A.S." },
  brugge: { name: "Club Brugge", club: "Club Brugge KV" },
  celta: { name: "Celta Vigo", club: "R.C. Celta de Vigo SAD", club0203: "Real Club Celta de Vigo SAD" },
  celtic: { name: "Celtic", club: "Celtic" },
  chelsea: { name: "Chelsea", club: "Chelsea" },
  deportivo: { name: "Deportivo La Coruña", club: "R.C. Deportivo de La Coruña SAD" },
  dortmund: { name: "Borussia Dortmund", club: "Borussia Dortmund" },
  dynamo: { name: "Dynamo Kyiv", club: "Dinamo Kiev" },
  galatasaray: { name: "Galatasaray", club: "Galatasaray SK" },
  inter: { name: "Internazionale", club: "Internazionale" },
  juventus: { name: "Juventus", club: "Juventus" },
  lazio: { name: "Lazio", club: "Lazio" },
  leverkusen: { name: "Bayer Leverkusen", club: "Bayer 04 Leverkusen" },
  lokomotiv: { name: "Lokomotiv Moscow", club: "Lokomotiv Moscow" },
  lyon: { name: "Lyon", club: "Olympique Lyonnais" },
  marseille: { name: "Marseille", club: "Olympique de Marseille", club0203: "Olympique Marseille" },
  milan: { name: "AC Milan", club: "AC Milan" },
  monaco: { name: "Monaco", club: "AS Monaco FC" },
  newcastle: { name: "Newcastle United", club: "Newcastle United" },
  olympiacos: { name: "Olympiacos", club: "Olympiakos SF Piraeus", club0203: "Olympiakos Piraeus" },
  panathinaikos: { name: "Panathinaikos", club: "Panathinaikos AO", club0203: "Panathinaikos" },
  partizan: { name: "Partizan", club: "FK Partizan Beograd", club0203: "FC Partizan Belgrade" },
  porto: { name: "Porto", club: "Futebol Clube do Porto" },
  psv: { name: "PSV Eindhoven", club: "PSV" },
  rangers: { name: "Rangers", club: "Rangers FC" },
  real: { name: "Real Madrid", club: "Real Madrid C.F." },
  roma: { name: "Roma", club: "AS Roma" },
  sociedad: { name: "Real Sociedad", club: "Real Sociedad C.F. SAD" },
  sparta: { name: "Sparta Prague", club: "Sparta Prague" },
  stuttgart: { name: "VfB Stuttgart", club: "VfB Stuttgart" },
  united: { name: "Manchester United", club: "Manchester United" },
  valencia: { name: "Valencia", club: "Valencia C.F. SAD" },
};

const SCENARIOS = {
  ucl0203: {
    key: "ucl0203",
    label: "Champions League 02–03",
    shortLabel: "UCL 02/03",
    database: "cm0203_vanilla_original",
    replacementLabel: { A: "Newcastle United", B: "Roma", C: "Lokomotiv Moscow", D: "Basel" },
    groups: {
      A: { replace: "newcastle", teams: ["barcelona", "inter", "newcastle", "leverkusen"] },
      B: { replace: "roma", teams: ["valencia", "ajax", "arsenal", "roma"] },
      C: { replace: "lokomotiv", teams: ["milan", "real", "dortmund", "lokomotiv"] },
      D: { replace: "basel", teams: ["united", "juventus", "basel", "deportivo"] },
    },
    seeds: {
      A1: "barcelona", A2: "inter", B1: "valencia", B2: "ajax",
      C1: "milan", C2: "real", D1: "united", D2: "juventus",
    },
    entryPairs: [["C2", "D1"], ["D2", "A1"], ["B2", "C1"], ["A2", "B1"]],
    stages: ["Quarter-final", "Semi-final", "Final"],
    finalVenue: "Manchester",
  },
  ucl0304: {
    key: "ucl0304",
    label: "Champions League 03–04",
    shortLabel: "UCL 03/04",
    database: "cm0304_vanilla_original",
    replacementLabel: {
      A: "Anderlecht", B: "Dynamo Kyiv", C: "AEK Athens", D: "Olympiacos",
      E: "Rangers", F: "Partizan", G: "Lazio", H: "Celta Vigo",
    },
    groups: {
      A: { replace: "anderlecht", teams: ["lyon", "bayern", "celtic", "anderlecht"] },
      B: { replace: "dynamo", teams: ["arsenal", "lokomotiv", "inter", "dynamo"] },
      C: { replace: "aek", teams: ["monaco", "deportivo", "psv", "aek"] },
      D: { replace: "olympiacos", teams: ["juventus", "sociedad", "galatasaray", "olympiacos"] },
      E: { replace: "rangers", teams: ["united", "stuttgart", "panathinaikos", "rangers"] },
      F: { replace: "partizan", teams: ["real", "porto", "marseille", "partizan"] },
      G: { replace: "lazio", teams: ["chelsea", "sparta", "besiktas", "lazio"] },
      H: { replace: "celta", teams: ["milan", "celta", "brugge", "ajax"] },
    },
    seeds: {
      A1: "lyon", A2: "bayern", B1: "arsenal", B2: "lokomotiv",
      C1: "monaco", C2: "deportivo", D1: "juventus", D2: "sociedad",
      E1: "united", E2: "stuttgart", F1: "real", F2: "porto",
      G1: "chelsea", G2: "sparta", H1: "milan", H2: "celta",
    },
    entryPairs: [
      ["A2", "F1"], ["B2", "C1"], ["E2", "G1"], ["H2", "B1"],
      ["F2", "E1"], ["D2", "A1"], ["G2", "H1"], ["C2", "D1"],
    ],
    stages: ["Round of 16", "Quarter-final", "Semi-final", "Final"],
    finalVenue: "Gelsenkirchen",
  },
};

const elements = {
  seed: document.querySelector("#runSeed"),
  teamName: document.querySelector("#runTeamName"),
  teamOverall: document.querySelector("#runTeamOverall"),
  stageKicker: document.querySelector("#runStageKicker"),
  stageTitle: document.querySelector("#runStageTitle"),
  stageDescription: document.querySelector("#runStageDescription"),
  nextButton: document.querySelector("#runNextButton"),
  matches: document.querySelector("#runMatches"),
  tableBody: document.querySelector("#runTableBody"),
  groupHeading: document.querySelector("#runGroupHeading"),
  lineRatings: document.querySelector("#runLineRatings"),
  squadList: document.querySelector("#runSquadList"),
  bracketPanel: document.querySelector("#runBracketPanel"),
  bracket: document.querySelector("#runBracket"),
  resultCard: document.querySelector("#runResultCard"),
  recordsPanel: document.querySelector("#runRecordsPanel"),
  recordForm: document.querySelector("#runRecordForm"),
  recordUsername: document.querySelector("#runRecordUsername"),
  recordStatus: document.querySelector("#runRecordStatus"),
  recordRows: document.querySelector("#runRecordRows"),
};

function readJsonStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key) || "") || fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // A run can continue without persistent cache access.
  }
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let result = value;
    result = Math.imul(result ^ result >>> 15, result | 1);
    result ^= result + Math.imul(result ^ result >>> 7, result | 61);
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
}

function clamp(minimum, maximum, value) {
  return Math.max(minimum, Math.min(maximum, value));
}

function poisson(lambda, random) {
  const limit = Math.exp(-lambda);
  let product = 1;
  let count = 0;
  do {
    count += 1;
    product *= random();
  } while (product > limit && count < 9);
  return count - 1;
}

function average(values) {
  return values.length
    ? values.reduce((total, value) => total + value, 0) / values.length
    : 0;
}

function playerName(player) {
  return player?.canonical_player_name
    || player?.display_name
    || player?.full_name
    || "Unknown player";
}

const LEGACY_ATTRIBUTE_DATABASES = new Set([
  "cm9697",
  "cm9697_vanilla_original",
  "cm9798",
  "cm9798_vanilla_original",
]);

const ENGINE_ATTRIBUTE_RULES = {
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

const ENGINE_ATTRIBUTE_ALIASES = {
  "corners": ["Corner", "Set Pieces"],
  "finishing": ["Shooting"],
  "free kicks": ["Free Kick", "Set Pieces"],
  "goalkeeper": ["Goalkeeping"],
  "long shots": ["Shooting"],
  "one on ones": ["One-on-Ones", "One On One"],
  "set pieces": ["Set Pieces"],
};

const engineAttributeCache = new WeakMap();

function normalizedAttributeLabel(label) {
  return String(label || "")
    .trim()
    .toLowerCase()
    .replaceAll("-", " ")
    .replace(/\s+/g, " ");
}

function playerAttributeEntries(player) {
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

function rawPlayerAttributeMap(player) {
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

function playerCaBaseline(player) {
  return clamp(1, 20, (Number(player?.current_ability) || 100) / 10);
}

function positionalAttributeBaseline(player, label) {
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

function directEngineAttribute(raw, label) {
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

function engineAttributeDetail(player, label) {
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

function engineAttribute(player, label) {
  return engineAttributeDetail(player, label).value;
}

function normalizedEngineRatings(player) {
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

const team = readJsonStorage(TEAM_STORAGE_KEY, null);
const sharedSquad = createDraftSquad(team);
const runSeed = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const scenario = SCENARIOS[team?.scenario] || SCENARIOS.ucl0304;
const groupKeys = Object.keys(scenario.groups);
const groupRandom = seededRandom(hashString(`${runSeed}:${scenario.key}:group-draw`));
const groupName = groupKeys[Math.floor(groupRandom() * groupKeys.length)];
const drawnGroup = scenario.groups[groupName];
const groupTeams = drawnGroup.teams.map((key) => key === drawnGroup.replace ? "user" : key);
const groupOpponents = groupTeams.filter((key) => key !== "user");
const groupRounds = groupOpponents.map((userOpponent) => ({
  userOpponent,
  hidden: groupOpponents.filter((key) => key !== userOpponent),
}));
const opponentCache = readJsonStorage(OPPONENT_CACHE_KEY, {});
const rosterMemory = new Map();
const penaltyRatingCache = new Map();
const playerMetricCache = new Map();
const state = {
  phase: "group",
  groupRound: 0,
  groupPlace: 0,
  groupCompanion: groupOpponents[0],
  knockoutIndex: 0,
  knockoutRounds: [],
  busy: false,
  completed: false,
  champion: false,
  outcomeStage: "",
  savedUsername: "",
  userRecord: {
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    gf: 0,
    ga: 0,
    scorers: {},
    dominators: {},
    matches: [],
  },
  table: new Map(),
  matchNumber: 0,
};
let squadSavePromise = null;

function emptyStanding(key) {
  return {
    key,
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    gf: 0,
    ga: 0,
    points: 0,
  };
}

for (const key of groupTeams) state.table.set(key, emptyStanding(key));

function teamLabel(key) {
  return key === "user" ? team.teamName : CLUBS[key]?.name || key;
}

function validRoster(players) {
  return players
    .filter((player) => {
      const ability = Number(player.current_ability);
      return ability > 0 && ability <= 200;
    })
    .sort((left, right) =>
      Number(right.current_ability) - Number(left.current_ability)
      || playerName(left).localeCompare(playerName(right)))
    .slice(0, 22);
}

async function opponentRoster(key) {
  const cacheKey = `${scenario.database}:${key}`;
  if (rosterMemory.has(cacheKey)) return rosterMemory.get(cacheKey);
  if (Array.isArray(opponentCache[cacheKey]) && opponentCache[cacheKey].length) {
    const cached = validRoster(opponentCache[cacheKey]);
    rosterMemory.set(cacheKey, cached);
    return cached;
  }

  const club = CLUBS[key];
  if (!club) throw new Error(`Unknown opponent: ${key}.`);
  const clubName = scenario.key === "ucl0203" && club.club0203
    ? club.club0203
    : club.club;
  const response = await searchPlayers({
    database: scenario.database,
    q: "",
    club: clubName,
    pageSize: 60,
  });
  const roster = validRoster(response.items);
  if (!roster.length) {
    throw new Error(`No ${scenario.shortLabel} players found for ${club.name}.`);
  }
  rosterMemory.set(cacheKey, roster);
  opponentCache[cacheKey] = roster;
  writeJsonStorage(OPPONENT_CACHE_KEY, opponentCache);
  return roster;
}

async function hydratePlayers(players) {
  const missing = players.filter((player) => !playerMetricCache.has(playerIdentity(player)));
  if (missing.length) {
    try {
      const payload = await getPlayerMetrics(missing);
      for (const metric of payload.items || []) {
        playerMetricCache.set(playerIdentity(metric), metric);
      }
    } catch {
      // CA-derived fallbacks keep the match playable if detailed metrics are unavailable.
    }
  }
  return players.map((player) => ({
    ...player,
    ...(playerMetricCache.get(playerIdentity(player)) || {}),
    role: player.role,
    line: player.line,
    overall: player.overall,
    isCaptain: player.isCaptain,
  }));
}

function opponentOverall(roster) {
  return Math.round(teamModel(roster).overall);
}

function userPlayers() {
  return team.players.map((entry) => {
    const metric = playerMetricCache.get(playerIdentity(entry.player)) || {};
    return {
      ...entry.player,
      ...metric,
      current_ability:
        Number(entry.gameplay_current_ability)
        || Number(metric.current_ability)
        || Number(entry.player?.current_ability)
        || 0,
      role: entry.role,
      line: entry.line,
      overall: clamp(0, 99, Math.round(
        Number(entry.gameplayOverall)
        || Number(entry.gameplay_current_ability) / 2
        || Number(metric.current_ability) / 2
        || Number(entry.player?.current_ability) / 2
        || 0,
      )),
      isCaptain: entry.isCaptain,
    };
  });
}

function visibleSquadRatings() {
  const entries = team.players.map((entry) => ({
    line: entry.line,
    overall: clamp(0, 99, Math.round(
      (Number(entry.player?.current_ability) || Number(entry.overall) * 2 || 0) / 2,
    )),
  }));
  const lineAverage = (line) => Math.round(average(
    entries.filter((entry) => entry.line === line).map((entry) => entry.overall),
  ));
  return {
    attack: lineAverage("attack"),
    midfield: lineAverage("midfield"),
    defence: lineAverage("defence"),
    team: Math.round(average(entries.map((entry) => entry.overall))),
  };
}

function boostedSquadOverall() {
  if (Number(team.boostedOveralls?.team)) return Number(team.boostedOveralls.team);
  return Math.round(average(team.players.map((entry) => {
    const overall = Math.round(
      (Number(entry.player?.current_ability) || Number(entry.overall) * 2 || 0) / 2,
    );
    return overall * (entry.isCaptain ? 2 : 1);
  })));
}

function playerAttribute(player, ...labels) {
  for (const label of labels) {
    const detail = engineAttributeDetail(player, label);
    if (detail.source !== "baseline") return detail.value;
  }
  return engineAttribute(player, labels[0]);
}

function playerAbility(player) {
  return clamp(30, 99, (Number(player?.current_ability) || 100) / 2);
}

function isAttacker(player) {
  return player?.line === "attack"
    || /(^|\/|\s)(?:F|S|A)(?:\s|\/|$)/i.test(String(player?.position_text || ""));
}

function isMidfielder(player) {
  return player?.line === "midfield"
    || /(^|\/|\s)(?:M|DM|AM)(?:\s|\/|$)/i.test(String(player?.position_text || ""));
}

function attackerScore(player) {
  const technique = average([
    playerAttribute(player, "Finishing", "Shooting"),
    playerAttribute(player, "Off the Ball"),
    playerAttribute(player, "Heading"),
    playerAttribute(player, "Technique"),
  ]) * 5;
  const support = average([
    playerAttribute(player, "Pace"),
    playerAttribute(player, "Creativity"),
    playerAttribute(player, "Passing"),
  ]) * 5;
  return clamp(30, 99,
    playerAbility(player) * 0.42 + technique * 0.43 + support * 0.15);
}

function midfielderScore(player) {
  const attributes = average([
    playerAttribute(player, "Passing"),
    playerAttribute(player, "Creativity"),
    playerAttribute(player, "Vision"),
    playerAttribute(player, "Technique"),
    playerAttribute(player, "Teamwork"),
    playerAttribute(player, "Work Rate"),
  ]) * 5;
  return clamp(30, 99, playerAbility(player) * 0.42 + attributes * 0.58);
}

function defenderScore(player) {
  const attributes = average([
    playerAttribute(player, "Marking"),
    playerAttribute(player, "Tackling"),
    playerAttribute(player, "Positioning"),
    playerAttribute(player, "Anticipation"),
    playerAttribute(player, "Heading"),
    playerAttribute(player, "Strength"),
  ]) * 5;
  return clamp(30, 99, playerAbility(player) * 0.44 + attributes * 0.56);
}

function goalkeeperScore(player) {
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

function strongest(players, score, count) {
  return players.slice().sort((left, right) => score(right) - score(left)).slice(0, count);
}

function startingEleven(players) {
  if (players.length <= 11) return players;
  const selected = [];
  const add = (items) => items.forEach((player) => {
    if (!selected.includes(player) && selected.length < 11) selected.push(player);
  });
  add(strongest(players.filter(isGoalkeeper), goalkeeperScore, 1));
  add(strongest(players.filter((player) => isDefender(player) && !isGoalkeeper(player)), defenderScore, 4));
  add(strongest(players.filter((player) => isMidfielder(player) && !isDefender(player)), midfielderScore, 3));
  add(strongest(players.filter((player) => isAttacker(player) && !isGoalkeeper(player)), attackerScore, 3));
  add(strongest(
    players.filter((player) => !selected.includes(player) && !isGoalkeeper(player)),
    playerAbility,
    11 - selected.length,
  ));
  add(strongest(
    players.filter((player) => !selected.includes(player)),
    playerAbility,
    11 - selected.length,
  ));
  return selected.slice(0, 11);
}

function teamModel(players) {
  const lineup = startingEleven(players);
  const outfield = lineup.filter((player) => !isGoalkeeper(player));
  const attackers = outfield.filter(isAttacker);
  const midfielders = outfield.filter(isMidfielder);
  const defenders = outfield.filter(isDefender);
  const keeper = lineup.find(isGoalkeeper);
  const captainContribution = (player, score) => score * (player?.isCaptain ? 1.1 : 1);
  const scoredAverage = (items, scorer, fallback) => {
    const source = items.length ? items : fallback;
    return average(source.map((player) => captainContribution(player, scorer(player))));
  };
  const attack = scoredAverage(strongest(attackers, attackerScore, 4), attackerScore, outfield);
  const midfield = scoredAverage(strongest(midfielders, midfielderScore, 5), midfielderScore, outfield);
  const defence = scoredAverage(strongest(defenders, defenderScore, 5), defenderScore, outfield);
  const goalkeeping = keeper
    ? captainContribution(keeper, goalkeeperScore(keeper))
    : Math.max(30, average(lineup.map(playerAbility)) - 24);
  const overall = attack * 0.3 + midfield * 0.22 + defence * 0.3 + goalkeeping * 0.18;
  return { lineup, attack, midfield, defence, goalkeeping, overall };
}

function teamConditionAt(model, minute) {
  const outfield = model.lineup.filter((player) => !isGoalkeeper(player));
  return average((outfield.length ? outfield : model.lineup)
    .map((player) => conditionMultiplier(player, minute)));
}

function weightedPlayer(players, random, preferredLine = "", score = attackerScore) {
  if (!players.length) return null;
  const weighted = players.flatMap((player) => {
    const lineBoost = !preferredLine || player.line === preferredLine ? 3 : 1;
    const weight = clamp(1, 18, Math.round((score(player) - 38) / 4)) * lineBoost;
    return Array.from({ length: weight }, () => player);
  });
  return weighted[Math.floor(random() * weighted.length)] || players[0];
}

function weightedChoice(options, random) {
  const total = options.reduce((sum, option) => sum + Math.max(0, option.weight), 0);
  if (!total) return options[0]?.value;
  let roll = random() * total;
  for (const option of options) {
    roll -= Math.max(0, option.weight);
    if (roll < 0) return option.value;
  }
  return options.at(-1)?.value;
}

function setPieceScore(player, delivery = "corner") {
  const specialist = delivery === "corner"
    ? playerAttribute(player, "Corners", "Set Pieces")
    : playerAttribute(player, "Free Kicks", "Set Pieces");
  return Math.max(specialist, playerAttribute(player, "Set Pieces"));
}

function setPieceTaker(players, delivery = "corner") {
  const outfield = players.filter((player) => !isGoalkeeper(player));
  return strongest(outfield.length ? outfield : players, (player) =>
    setPieceScore(player, delivery), 1)[0] || players[0];
}

function headerScore(player) {
  const attributes = average([
    playerAttribute(player, "Heading"),
    playerAttribute(player, "Jumping"),
    playerAttribute(player, "Off the Ball"),
    playerAttribute(player, "Strength"),
    playerAttribute(player, "Anticipation"),
  ]) * 5;
  return clamp(25, 99, attributes * 0.78 + playerAbility(player) * 0.22);
}

function volleyScore(player) {
  const attributes = average([
    playerAttribute(player, "Technique"),
    playerAttribute(player, "Finishing", "Shooting"),
    playerAttribute(player, "First Touch"),
    playerAttribute(player, "Anticipation"),
  ]) * 5;
  return clamp(25, 99, attributes * 0.75 + playerAbility(player) * 0.25);
}

function longRangeScore(player) {
  const attributes = average([
    playerAttribute(player, "Long Shots", "Shooting"),
    playerAttribute(player, "Technique"),
    playerAttribute(player, "Finishing", "Shooting"),
    playerAttribute(player, "Creativity"),
  ]) * 5;
  return clamp(25, 99, attributes * 0.76 + playerAbility(player) * 0.24);
}

function isWidePlayer(player) {
  return /(?:^|\/|\s)(?:D|DM|M|AM|F|WB)[LR](?:$|\/|\s)/i
    .test(String(player?.role || player?.position_text || ""));
}

function counterRunnerScore(player) {
  const attributes = average([
    playerAttribute(player, "Pace"),
    playerAttribute(player, "Acceleration"),
    playerAttribute(player, "Dribbling"),
    playerAttribute(player, "Off the Ball"),
    playerAttribute(player, "Crossing"),
  ]) * 5;
  const wideBonus = isWidePlayer(player) ? 5 : 0;
  return clamp(25, 99, attributes * 0.74 + playerAbility(player) * 0.26 + wideBonus);
}

function conditionMultiplier(player, minute) {
  const stamina = playerAttribute(player, "Stamina");
  const workRate = playerAttribute(player, "Work Rate");
  const endurance = clamp(0.05, 1, (stamina * 0.68 + workRate * 0.32) / 20);
  const fatigueProgress = clamp(0, 1, (Number(minute) - 20) / 100);
  const fatigueCost = (0.07 + (1 - endurance) * 0.34) * fatigueProgress ** 1.15;
  return clamp(0.58, 1, 1 - fatigueCost);
}

function conditionedScore(player, score, minute) {
  return score(player) * conditionMultiplier(player, minute);
}

const CONGESTED_ZONES = new Set([4, 5, 7, 8]);

function zonalAttribute(player, label, zone, random) {
  const detail = engineAttributeDetail(player, label);
  if (!CONGESTED_ZONES.has(zone)) return detail.value;
  const uncertainty = 1 - detail.confidence;
  const reliabilityPenalty = uncertainty * 0.14;
  const variance = (random() - 0.5) * uncertainty * 0.34;
  return detail.value * clamp(0.68, 1.08, 1 - reliabilityPenalty + variance);
}

function duelAttribute(player, labels, zone, random) {
  return average(labels.map((label) => zonalAttribute(player, label, zone, random))) / 20;
}

function localizedDuel(attacker, defender, attackLabels, defenceLabels, minute, random, zone = -1) {
  const attackerCondition = conditionMultiplier(attacker, minute);
  const defenderCondition = conditionMultiplier(defender, minute);
  const attackPower = duelAttribute(attacker, attackLabels, zone, random) * attackerCondition;
  const defencePower = duelAttribute(defender, defenceLabels, zone, random) * defenderCondition;
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

function defenderForColumn(opponents, column, minute, random) {
  const defenders = opponents.filter((player) => !isGoalkeeper(player) && isDefender(player));
  const source = defenders.length
    ? defenders
    : opponents.filter((player) => !isGoalkeeper(player));
  const rolePattern = column === 0
    ? /(?:^|\/|\s)(?:D|WB)R(?:$|\/|\s)/i
    : column === 2
      ? /(?:^|\/|\s)(?:D|WB)L(?:$|\/|\s)/i
      : /(?:^|\/|\s)(?:D|DM)C(?:$|\/|\s)/i;
  const mapped = source.filter((player) =>
    rolePattern.test(String(player?.role || player?.position_text || "")));
  return weightedPlayer(mapped.length ? mapped : source, random, "defence", (player) =>
    conditionedScore(player, defenderScore, minute));
}

function bypassScore(player) {
  const attributes = average([
    playerAttribute(player, "Vision"),
    playerAttribute(player, "Passing"),
    playerAttribute(player, "Creativity"),
    playerAttribute(player, "Decisions"),
  ]) * 5;
  return clamp(25, 99, attributes * 0.8 + playerAbility(player) * 0.2);
}

function pressingScore(player) {
  const attributes = average([
    playerAttribute(player, "Work Rate"),
    playerAttribute(player, "Stamina"),
    playerAttribute(player, "Anticipation"),
    playerAttribute(player, "Tackling"),
    playerAttribute(player, "Acceleration"),
  ]) * 5;
  return clamp(25, 99, attributes * 0.8 + playerAbility(player) * 0.2);
}

function poacherScore(player) {
  const attributes = average([
    playerAttribute(player, "Anticipation"),
    playerAttribute(player, "Acceleration"),
    playerAttribute(player, "Off the Ball"),
    playerAttribute(player, "Finishing", "Shooting"),
  ]) * 5;
  return clamp(25, 99, attributes * 0.8 + playerAbility(player) * 0.2);
}

function firstTouchFinishScore(player) {
  const attributes = average([
    playerAttribute(player, "First Touch"),
    playerAttribute(player, "Finishing", "Shooting"),
    playerAttribute(player, "Off the Ball"),
    playerAttribute(player, "Technique"),
  ]) * 5;
  return clamp(25, 99, attributes * 0.8 + playerAbility(player) * 0.2);
}

function playerIdentity(player) {
  return `${player?.database_slug || scenario.database}:${player?.source_person_id || playerName(player)}`;
}

function playerReference(player) {
  return {
    name: playerName(player),
    database: player?.database_slug || scenario.database,
    sourcePersonId: String(player?.source_person_id || ""),
  };
}

function isGoalkeeper(player) {
  if (player?.role) return player.role === "GK";
  return /(^|\/|\s)GK($|\/|\s)/i.test(String(player?.position_text || ""));
}

function isDefender(player) {
  return player?.line === "defence"
    || /(^|\/|\s)(?:D|SW|WB)(?:\s|\/|$)/i.test(String(player?.position_text || ""));
}

function goalkeeper(players) {
  return strongest(players.filter(isGoalkeeper), goalkeeperScore, 1)[0] || players[0];
}

function randomEventMoment(random, occupied, start = 4, end = 88) {
  const firstSecond = start * 60;
  const lastSecond = end * 60 + 59;
  let matchSecond = firstSecond
    + Math.floor(random() * Math.max(1, lastSecond - firstSecond + 1));
  while (occupied.has(matchSecond) && matchSecond < lastSecond) matchSecond += 1;
  occupied.add(matchSecond);
  return {
    matchSecond,
    minute: Math.floor(matchSecond / 60),
  };
}

function playerPreferredColumn(player, random) {
  const position = String(player?.role || player?.position_text || "").toUpperCase();
  if (/(?:^|\/|\s)(?:D|DM|M|AM|F|WB)L(?:$|\/|\s)/.test(position)) return 0;
  if (/(?:^|\/|\s)(?:D|DM|M|AM|F|WB)R(?:$|\/|\s)/.test(position)) return 2;
  return random() < 0.72 ? 1 : random() < 0.5 ? 0 : 2;
}

function spatialAction(kind, actor, random, goalType = "") {
  const column = playerPreferredColumn(actor, random);
  const adjacentCenter = column === 1 ? (random() < 0.5 ? 0 : 2) : 1;
  if (kind === "goal") {
    if (goalType === "long-range") {
      return { from: 6 + column, to: 1, action: "shot", turnover: false };
    }
    if (goalType === "counter") {
      return { from: 9 + (column === 1 ? adjacentCenter : column), to: 1, action: "counter", turnover: false };
    }
    if (goalType === "high-press") {
      return { from: 3 + column, to: 1, action: "press", turnover: false };
    }
    if (goalType === "rebound") {
      return { from: 1, to: 1, action: "rebound", turnover: false };
    }
    if (goalType === "cut-back") {
      return { from: column === 2 ? 2 : 0, to: 1, action: "cut-back", turnover: false };
    }
    if (goalType === "set-piece-scramble") {
      return { from: column === 2 ? 2 : 0, to: 1, action: "scramble", turnover: false };
    }
    if (["corner-header", "corner-volley"].includes(goalType)) {
      return { from: column === 2 ? 2 : 0, to: 1, action: "cross", turnover: false };
    }
    if (goalType === "free-kick-cross") {
      return { from: 3 + (column === 1 ? adjacentCenter : column), to: 1, action: "cross", turnover: false };
    }
  }
  const zones = {
    goal: { from: 3 + column, to: 1, action: "shot", turnover: false },
    chance: { from: 3 + column, to: 1, action: "shot", turnover: true },
    cross: { from: 3 + column, to: 1, action: "cross", turnover: true },
    counter: { from: 6 + column, to: 3 + adjacentCenter, action: "counter", turnover: true },
    "through-ball": { from: 6 + column, to: column, action: "through-ball", turnover: false },
    tackle: { from: 3 + column, to: 3 + column, action: "turnover", turnover: true },
    card: {
      from: (isDefender(actor) ? 6 : isAttacker(actor) ? 3 : 6) + column,
      to: (isDefender(actor) ? 6 : isAttacker(actor) ? 3 : 6) + column,
      action: "card",
    },
  };
  return zones[kind] || { from: 6 + column, to: 3 + column, action: "pass" };
}

function presentationWeight(kind) {
  return {
    goal: 1.65,
    chance: 1.25,
    cross: 1.05,
    counter: 1.1,
    "through-ball": 1.3,
    tackle: 0.9,
    card: 1.25,
  }[kind] || 1;
}

function withSpatialMetadata(event, actor, random) {
  const spatial = spatialAction(event.kind, actor, random, event.goalType);
  return {
    ...event,
    zoneFrom: event.zoneFrom ?? spatial.from,
    zoneTo: event.zoneTo ?? spatial.to,
    action: event.action || spatial.action,
    possessionAfter: event.possessionAfter || (spatial.turnover
      ? event.side === "user" ? "opponent" : "user"
      : event.side),
    actionSeconds: Math.round(4 + random() * 8 * presentationWeight(event.kind)),
    presentationWeight: presentationWeight(event.kind),
  };
}

function calculateStoppageSeconds(events, random, maximum = 360) {
  const seconds = events.reduce((total, event) => {
    if (event.goal) return total + 25;
    if (event.card === "red") return total + 45;
    if (event.card === "yellow") return total + 18;
    return total;
  }, 0);
  const variance = Math.floor(random() * 45);
  return clamp(0, maximum, seconds + variance);
}

function goalTypeFor(players, random) {
  const outfield = players.filter((player) => !isGoalkeeper(player));
  const best = (score) => strongest(outfield, score, 1)[0];
  const specialist = setPieceTaker(outfield, "free-kick");
  const qualityBoost = (player, score) => player
    ? clamp(0.72, 1.35, score(player) / 70)
    : 1;
  return weightedChoice([
    { value: "open-play", weight: 39 },
    { value: "corner-header", weight: 13 * qualityBoost(best(headerScore), headerScore) },
    { value: "corner-volley", weight: 4 * qualityBoost(best(volleyScore), volleyScore) },
    { value: "direct-free-kick", weight: 8 * qualityBoost(specialist, (player) => setPieceScore(player, "free-kick") * 5) },
    { value: "free-kick-cross", weight: 7 * qualityBoost(best(headerScore), headerScore) },
    { value: "long-range", weight: 15 * qualityBoost(best(longRangeScore), longRangeScore) },
    { value: "counter", weight: 11 * qualityBoost(best(counterRunnerScore), counterRunnerScore) },
  ], random);
}

function goalEvent(spec, players, opponents, random, forcedGoalType = "", context = {}) {
  const outfield = players.filter((player) => !isGoalkeeper(player));
  const oppositionOutfield = opponents.filter((player) => !isGoalkeeper(player));
  const pool = outfield.length ? outfield : players;
  const opponentPool = oppositionOutfield.length ? oppositionOutfield : opponents;
  const keeper = goalkeeper(opponents);
  const goalType = forcedGoalType || goalTypeFor(players, random);
  const eventMinute = Number(spec.matchSecond) / 60 || Number(spec.minute) || 0;
  const pickScorer = (score, preferredLine = "") =>
    weightedPlayer(pool, random, preferredLine, (player) =>
      conditionedScore(player, score, eventMinute));
  const headerScorer = () => pickScorer(headerScore);
  const volleyScorer = () => pickScorer(volleyScore);
  let scorer = context.scorer || pickScorer(attackerScore, "attack");
  let provider = context.provider || null;
  let actorSide = spec.side;
  let goalCredit = true;
  let text = "";

  if (goalType === "corner-header") {
    provider = context.provider || setPieceTaker(players, "corner");
    scorer = context.scorer || headerScorer();
    text = `${playerName(provider)} swings in the corner and ${playerName(scorer)} powers a header beyond ${playerName(keeper)}.`;
  } else if (goalType === "corner-volley") {
    provider = context.provider || setPieceTaker(players, "corner");
    scorer = context.scorer || volleyScorer();
    text = `${playerName(provider)} delivers the corner, the clearance drops loose, and ${playerName(scorer)} volleys it home.`;
  } else if (goalType === "direct-free-kick") {
    scorer = context.scorer || setPieceTaker(players, "free-kick");
    text = `${playerName(scorer)} curls the free-kick over the wall and beyond ${playerName(keeper)}.`;
  } else if (goalType === "free-kick-cross") {
    provider = context.provider || setPieceTaker(players, "free-kick");
    const headedFinish = random() < 0.78;
    scorer = context.scorer || (headedFinish ? headerScorer() : volleyScorer());
    text = `${playerName(provider)} clips in the free-kick and ${playerName(scorer)} meets it ${headedFinish ? "with a thumping header" : "on the volley"}.`;
  } else if (goalType === "long-range") {
    scorer = context.scorer || pickScorer(longRangeScore, "midfield");
    const descriptions = [
      `lets fly from distance and gives ${playerName(keeper)} no chance`,
      `finds the top corner with a fierce long-range strike`,
      `takes aim from outside the box and rifles the ball past ${playerName(keeper)}`,
    ];
    text = `${playerName(scorer)} ${descriptions[Math.floor(random() * descriptions.length)]}.`;
  } else if (goalType === "counter") {
    provider = context.provider || weightedPlayer(pool, random, "", (player) =>
      conditionedScore(player, counterRunnerScore, eventMinute));
    scorer = context.scorer || (random() < 0.46 ? provider : pickScorer(attackerScore, "attack"));
    text = scorer === provider
      ? `${playerName(scorer)} races down the flank, cuts inside and finishes a devastating counter-attack.`
      : `${playerName(provider)} bursts down the flank on the counter and squares for ${playerName(scorer)} to finish.`;
  } else if (goalType === "high-press") {
    scorer = context.scorer || weightedPlayer(pool, random, "", (player) =>
      conditionedScore(player, pressingScore, eventMinute));
    text = `Disaster at the back! ${playerName(scorer)} presses relentlessly, steals the ball on the edge of the area, and punishes the error with a clinical finish.`;
  } else if (goalType === "rebound") {
    scorer = context.scorer || weightedPlayer(pool, random, "attack", (player) =>
      conditionedScore(player, poacherScore, eventMinute));
    text = `A thunderous strike is parried by ${playerName(keeper)}, but ${playerName(scorer)} reacts faster than anyone to poke home the rebound.`;
  } else if (goalType === "cut-back") {
    provider = context.provider || weightedPlayer(pool, random, "", counterRunnerScore);
    scorer = context.scorer || weightedPlayer(pool, random, "attack", firstTouchFinishScore);
    text = `Brilliant pace down the flank! ${playerName(provider)} hits the byline, pulls it back across goal, and ${playerName(scorer)} arrives perfectly to sweep it in.`;
  } else if (goalType === "set-piece-scramble") {
    scorer = context.defender || weightedPlayer(opponentPool, random, "defence", defenderScore);
    actorSide = spec.side === "user" ? "opponent" : "user";
    goalCredit = false;
    text = `Absolute chaos in the six-yard boxâ€”${playerName(scorer)} inadvertently deflects the set piece past ${playerName(keeper)} under immense pressure.`;
  } else if (goalType === "own-goal") {
    scorer = weightedPlayer(opponentPool, random, "defence", defenderScore);
    actorSide = spec.side === "user" ? "opponent" : "user";
    goalCredit = false;
    text = `${playerName(scorer)} turns a dangerous ball into the wrong net under pressure—an own goal.`;
  } else {
    const descriptions = [
      `keeps calm and beats ${playerName(keeper)}`,
      `finds space in the area and drives the finish past ${playerName(keeper)}`,
      `latches onto a through ball and slots it into the corner`,
      `reacts first to a loose ball and finishes from close range`,
    ];
    text = `${playerName(scorer)} ${descriptions[Math.floor(random() * descriptions.length)]}.`;
  }

  return withSpatialMetadata({
    minute: spec.minute,
    matchSecond: spec.matchSecond,
    side: spec.side,
    actorSide,
    kind: spec.kind,
    goal: true,
    goalType,
    goalCredit,
    scorer: playerName(scorer),
    scorerPlayer: playerReference(scorer),
    provider: provider ? playerName(provider) : "",
    providerPlayer: provider ? playerReference(provider) : null,
    text,
  }, scorer, random);
}

function buildTimeline({
  random,
  ourPlayers,
  roster,
  userGoals,
  rivalGoals,
  start,
  end,
  highlightCount,
  cardCount,
  disciplinary = { sentOff: new Set(), yellows: new Map() },
}) {
  const occupied = new Set();
  const specs = [];
  for (let index = 0; index < userGoals; index += 1) {
    specs.push({ ...randomEventMoment(random, occupied, start, end), side: "user", kind: "goal" });
  }
  for (let index = 0; index < rivalGoals; index += 1) {
    specs.push({ ...randomEventMoment(random, occupied, start, end), side: "opponent", kind: "goal" });
  }
  for (let index = 0; index < highlightCount; index += 1) {
    specs.push({
      ...randomEventMoment(random, occupied, start, end),
      side: random() > 0.48 ? "user" : "opponent",
      kind: ["chance", "tackle", "cross", "counter", "through-ball"][Math.floor(random() * 5)],
    });
  }
  for (let index = 0; index < cardCount; index += 1) {
    specs.push({
      ...randomEventMoment(random, occupied, start, end),
      side: random() > 0.5 ? "user" : "opponent",
      kind: "card",
    });
  }
  specs.sort((left, right) => left.matchSecond - right.matchSecond);

  const { sentOff, yellows } = disciplinary;
  const active = (side, preferredLine = "") => {
    const source = side === "user" ? ourPlayers : roster;
    const available = source.filter((player) => !sentOff.has(`${side}:${playerIdentity(player)}`));
    const preferred = preferredLine
      ? available.filter((player) => player.line === preferredLine)
      : available;
    return preferred.length ? preferred : available;
  };
  const pick = (players) => players[Math.floor(random() * players.length)] || players[0];
  const events = [];

  for (const spec of specs) {
    const players = active(spec.side);
    if (!players.length) continue;
    const opponents = active(spec.side === "user" ? "opponent" : "user");
    if (!opponents.length) continue;

    if (spec.kind === "card") {
      const cardEligible = players.filter((player) => !isGoalkeeper(player));
      const cardPool = cardEligible.length ? cardEligible : players;
      const repeatCandidates = cardPool.filter((player) =>
        yellows.get(`${spec.side}:${playerIdentity(player)}`) === 1);
      const unbookedCandidates = cardPool.filter((player) =>
        !yellows.has(`${spec.side}:${playerIdentity(player)}`));
      const secondYellowIncident = repeatCandidates.length > 0 && random() < 0.025;
      const player = secondYellowIncident
        ? pick(repeatCandidates)
        : pick(unbookedCandidates.length ? unbookedCandidates : cardPool);
      const identity = `${spec.side}:${playerIdentity(player)}`;
      const directRed = random() < 0.005;
      const secondYellow = secondYellowIncident && (yellows.get(identity) || 0) >= 1;
      if (directRed || secondYellow) sentOff.add(identity);
      else yellows.set(identity, 1);
      events.push(withSpatialMetadata({
        minute: spec.minute,
        matchSecond: spec.matchSecond,
        side: spec.side,
        kind: spec.kind,
        goal: false,
        card: directRed || secondYellow ? "red" : "yellow",
        scorer: playerName(player),
        scorerPlayer: playerReference(player),
        text: directRed
          ? `${playerName(player)} is shown a straight red card after a reckless challenge.`
          : secondYellow
            ? `${playerName(player)} receives a second yellow and is sent off.`
            : `${playerName(player)} goes into the book for a late challenge.`,
      }, player, random));
      continue;
    }

    if (spec.kind === "goal") {
      events.push(goalEvent(spec, players, opponents, random));
      continue;
    }

    const actorPool = players.filter((player) => !isGoalkeeper(player));
    const eventMinute = Number(spec.matchSecond) / 60 || Number(spec.minute) || 0;
    const actorScore = spec.kind === "chance"
      ? attackerScore
      : spec.kind === "counter"
        ? counterRunnerScore
        : spec.kind === "through-ball"
          ? bypassScore
          : midfielderScore;
    const actor = weightedPlayer(
      actorPool.length ? actorPool : players,
      random,
      spec.kind === "counter" ? "attack" : "midfield",
      (player) => conditionedScore(player, actorScore, eventMinute),
    );
    const column = playerPreferredColumn(actor, random);
    const other = defenderForColumn(opponents, column, eventMinute, random);
    const keeper = goalkeeper(opponents);
    const duelAttributes = spec.kind === "through-ball"
      ? [["Vision", "Passing", "Creativity", "Decisions"], ["Positioning", "Anticipation", "Decisions"]]
      : spec.kind === "cross"
        ? [["Crossing", "Technique", "Passing"], ["Positioning", "Anticipation", "Pace"]]
        : spec.kind === "counter"
          ? [["Pace", "Acceleration", "Dribbling"], ["Pace", "Positioning", "Tackling"]]
          : [["Dribbling", "Technique", "Agility"], ["Tackling", "Positioning", "Strength"]];
    const duel = localizedDuel(
      actor,
      other,
      duelAttributes[0],
      duelAttributes[1],
      eventMinute,
      random,
    );
    const oppositeSide = spec.side === "user" ? "opponent" : "user";
    let text;
    let zoneFrom;
    let zoneTo;
    let action;
    let possessionAfter;
    if (spec.kind === "chance") {
      text = `${playerName(actor)} tests ${playerName(keeper)}, who makes the save.`;
      possessionAfter = oppositeSide;
    } else if (spec.kind === "through-ball") {
      zoneFrom = 6 + column;
      zoneTo = duel.won ? column : 3 + column;
      action = "through-ball";
      possessionAfter = duel.won ? spec.side : oppositeSide;
      text = duel.won
        ? `${playerName(actor)} sees the run early and threads a pass beyond ${playerName(other)}, bypassing midfield completely.`
        : `${playerName(actor)} tries to split the lines, but ${playerName(other)} reads the pass in the bypassed zone.`;
    } else if (spec.kind === "tackle") {
      action = "dribble";
      possessionAfter = duel.won ? spec.side : oppositeSide;
      text = duel.won
        ? `${playerName(actor)} takes on ${playerName(other)} and wins the one-on-one duel.`
        : `${playerName(actor)} attempts the dribble, but ${playerName(other)} wins the duel and takes possession.`;
    } else if (spec.kind === "cross") {
      possessionAfter = duel.won ? spec.side : oppositeSide;
      text = duel.won
        ? `${playerName(actor)} beats ${playerName(other)} and bends a dangerous cross into the area.`
        : `${playerName(other)} closes down ${playerName(actor)} and blocks the cross.`;
    } else {
      possessionAfter = duel.won ? spec.side : oppositeSide;
      text = duel.won
        ? `${playerName(actor)} surges past ${playerName(other)} and keeps the counter-attack racing forward.`
        : `${playerName(other)} matches ${playerName(actor)} for pace and stops the counter.`;
    }
    events.push(withSpatialMetadata({
      minute: spec.minute,
      matchSecond: spec.matchSecond,
      side: spec.side,
      kind: spec.kind,
      goal: false,
      duelWon: spec.kind === "chance" ? null : duel.won,
      duelProbability: Number(duel.probability.toFixed(3)),
      actorCondition: Number(duel.attackerCondition.toFixed(3)),
      defenderCondition: Number(duel.defenderCondition.toFixed(3)),
      defender: playerName(other),
      defenderPlayer: playerReference(other),
      zoneFrom,
      zoneTo,
      bypassedZone: spec.kind === "through-ball" ? 3 + column : null,
      action,
      possessionAfter,
      scorer: playerName(actor),
      scorerPlayer: playerReference(actor),
      text,
    }, actor, random));
  }
  return { events, disciplinary };
}

function transitionShotChance(shooter, keeper, minute, baseChance, score = attackerScore) {
  const attackPower = conditionedScore(shooter, score, minute) / 100;
  const keeperPower = conditionedScore(keeper, goalkeeperScore, minute) / 100;
  const share = attackPower / Math.max(0.01, attackPower + keeperPower);
  return clamp(0.008, 0.32, baseChance * (0.45 + share * 1.1) * 0.4);
}

function buildTransitionTimeline({
  random,
  ourPlayers,
  roster,
  start,
  end,
  intensity = 1,
  disciplinary = { sentOff: new Set(), yellows: new Map() },
}) {
  const events = [];
  const { sentOff, yellows } = disciplinary;
  const firstSecond = start * 60;
  const lastSecond = end * 60 + 59;
  const maxTicks = Math.max(18, Math.round((end - start) * 1.08 * intensity));
  const highlightLimit = Math.max(4, Math.round((end - start) / 6.5));
  let highlightCount = 0;
  let matchSecond = firstSecond;
  let side = random() < 0.5 ? "user" : "opponent";
  let zone = 6 + Math.floor(random() * 3);
  let counterSteps = 0;

  const opposite = (value) => value === "user" ? "opponent" : "user";
  const active = (activeSide) => {
    const source = activeSide === "user" ? ourPlayers : roster;
    return source.filter((player) =>
      !sentOff.has(`${activeSide}:${playerIdentity(player)}`));
  };
  const outfield = (players) => players.filter((player) => !isGoalkeeper(player));
  const moment = () => ({
    minute: Math.floor(matchSecond / 60),
    matchSecond,
    side,
    kind: "transition",
  });
  const resetFromKickoff = (kickoffSide) => {
    side = kickoffSide;
    zone = 6 + Math.floor(random() * 3);
    counterSteps = 0;
  };
  const addGoal = (goalType, players, opponents, context = {}) => {
    events.push(goalEvent(
      { ...moment(), kind: "goal" },
      players,
      opponents,
      random,
      goalType,
      context,
    ));
    resetFromKickoff(opposite(side));
  };
  const addDuelEvent = ({
    kind,
    actor,
    defender,
    duel,
    from,
    to,
    action,
    text,
    possession,
    bypassedZone = null,
  }) => {
    events.push(withSpatialMetadata({
      ...moment(),
      kind,
      goal: false,
      duelWon: duel?.won ?? null,
      duelProbability: duel ? Number(duel.probability.toFixed(3)) : null,
      actorCondition: duel ? Number(duel.attackerCondition.toFixed(3)) : null,
      defenderCondition: duel ? Number(duel.defenderCondition.toFixed(3)) : null,
      defender: defender ? playerName(defender) : "",
      defenderPlayer: defender ? playerReference(defender) : null,
      zoneFrom: from,
      zoneTo: to,
      bypassedZone,
      action,
      possessionAfter: possession,
      scorer: playerName(actor),
      scorerPlayer: playerReference(actor),
      text,
    }, actor, random));
    highlightCount += 1;
  };

  for (let tick = 0; tick < maxTicks && matchSecond < lastSecond; tick += 1) {
    matchSecond = Math.min(lastSecond, matchSecond + 28 + Math.floor(random() * 58));
    const players = active(side);
    const opponents = active(opposite(side));
    if (!players.length || !opponents.length) break;
    const attackingPool = outfield(players).length ? outfield(players) : players;
    const defendingPool = outfield(opponents).length ? outfield(opponents) : opponents;
    const minute = matchSecond / 60;
    const row = Math.floor(zone / 3);
    const column = zone % 3;
    const preferredLine = row >= 3 ? "defence" : row === 2 ? "midfield" : "attack";
    const transitionScore = row >= 2
      ? bypassScore
      : row === 1 || (row === 0 && column !== 1)
        ? counterRunnerScore
        : attackerScore;
    const actor = weightedPlayer(attackingPool, random, preferredLine, (player) =>
      conditionedScore(player, transitionScore, minute));
    const defender = defenderForColumn(defendingPool, column, minute, random);
    const keeper = goalkeeper(opponents);

    if (random() < 0.014) {
      const identity = `${opposite(side)}:${playerIdentity(defender)}`;
      const previousYellow = yellows.get(identity) || 0;
      const directRed = random() < 0.018;
      const secondYellow = previousYellow === 1 && random() < 0.18;
      const card = directRed || secondYellow ? "red" : "yellow";
      if (card === "red") sentOff.add(identity);
      else yellows.set(identity, 1);
      events.push(withSpatialMetadata({
        ...moment(),
        side: opposite(side),
        actorSide: opposite(side),
        kind: "card",
        goal: false,
        card,
        zoneFrom: MIRRORED_ZONE[zone],
        zoneTo: MIRRORED_ZONE[zone],
        possessionAfter: side,
        scorer: playerName(defender),
        scorerPlayer: playerReference(defender),
        text: directRed
          ? `${playerName(defender)} is shown a straight red card for stopping the transition recklessly.`
          : secondYellow
            ? `${playerName(defender)} receives a second yellow and is sent off.`
            : `${playerName(defender)} is booked for halting ${playerName(actor)}'s progress.`,
      }, defender, random));
      if (row <= 1 && random() < 0.46) {
        const taker = setPieceTaker(players, "free-kick");
        const direct = column === 1 && random() < 0.58;
        if (direct) {
          const freeKickChance = transitionShotChance(
            taker,
            keeper,
            minute,
            0.13,
            (player) => setPieceScore(player, "free-kick") * 5,
          );
          if (random() < freeKickChance) {
            addGoal("direct-free-kick", players, opponents, { scorer: taker });
            continue;
          }
        } else {
          const target = weightedPlayer(attackingPool, random, "", (player) =>
            conditionedScore(player, headerScore, minute));
          const marker = defenderForColumn(defendingPool, 1, minute, random);
          const freeKickDuel = localizedDuel(
            target,
            marker,
            ["Heading", "Jumping", "Strength", "Off the Ball"],
            ["Heading", "Jumping", "Strength", "Positioning"],
            minute,
            random,
            1,
          );
          if (freeKickDuel.won
            && random() < transitionShotChance(target, keeper, minute, 0.14, headerScore)) {
            addGoal("free-kick-cross", players, opponents, { provider: taker, scorer: target });
            continue;
          }
        }
        side = opposite(side);
        zone = 7;
        counterSteps = 0;
        continue;
      }
    }

    if (row <= 1) {
      const wideByline = row === 0 && column !== 1 && isWidePlayer(actor);
      if (wideByline && random() < 0.42) {
        const bylineDuel = localizedDuel(
          actor,
          defender,
          ["Pace", "Acceleration", "Dribbling"],
          ["Pace", "Positioning", "Tackling"],
          minute,
          random,
          zone,
        );
        if (bylineDuel.won) {
          const receiver = weightedPlayer(attackingPool, random, "attack", (player) =>
            conditionedScore(player, firstTouchFinishScore, minute));
          if (random() < transitionShotChance(receiver, keeper, minute, 0.3, firstTouchFinishScore)) {
            addGoal("cut-back", players, opponents, { provider: actor, scorer: receiver });
            continue;
          }
          if (highlightCount < highlightLimit) {
            addDuelEvent({
              kind: "chance", actor: receiver, defender, duel: bylineDuel,
              from: zone, to: 1, action: "cut-back", possession: opposite(side),
              text: `${playerName(actor)} reaches the byline and cuts it back, but ${playerName(receiver)} sends the first-time finish wide.`,
            });
          }
          side = opposite(side);
          zone = 7;
          continue;
        }
      }

      const longRange = row === 1 && random() < 0.34;
      const shooter = weightedPlayer(attackingPool, random, longRange ? "midfield" : "attack", (player) =>
        conditionedScore(player, longRange ? longRangeScore : attackerScore, minute));
      const baseChance = longRange ? 0.075 : column === 1 ? 0.19 : 0.11;
      if (random() < transitionShotChance(
        shooter,
        keeper,
        minute,
        baseChance,
        longRange ? longRangeScore : attackerScore,
      )) {
        const route = longRange
          ? "long-range"
          : counterSteps > 0
            ? "counter"
            : "open-play";
        addGoal(route, players, opponents, { provider: actor, scorer: shooter });
        continue;
      }

      const parried = random() < clamp(0.08, 0.28,
        0.2 - playerAttribute(keeper, "Handling") / 180);
      if (parried) {
        const poacher = weightedPlayer(attackingPool, random, "attack", (player) =>
          conditionedScore(player, poacherScore, minute));
        const reboundDefender = defenderForColumn(defendingPool, 1, minute, random);
        const reboundDuel = localizedDuel(
          poacher,
          reboundDefender,
          ["Anticipation", "Acceleration", "Off the Ball"],
          ["Positioning", "Anticipation", "Strength"],
          minute,
          random,
          1,
        );
        if (reboundDuel.won
          && random() < transitionShotChance(poacher, keeper, minute, 0.36, poacherScore)) {
          addGoal("rebound", players, opponents, { scorer: poacher });
          continue;
        }
      }

      const corner = random() < 0.16;
      if (corner) {
        const taker = setPieceTaker(players, "corner");
        const volley = random() < 0.22;
        const finishScore = volley ? volleyScore : headerScore;
        const target = weightedPlayer(attackingPool, random, "", (player) =>
          conditionedScore(player, finishScore, minute));
        const marker = defenderForColumn(defendingPool, 1, minute, random);
        const aerialDuel = localizedDuel(
          target,
          marker,
          volley
            ? ["Technique", "Finishing", "First Touch", "Anticipation"]
            : ["Heading", "Jumping", "Strength", "Off the Ball"],
          ["Heading", "Jumping", "Strength", "Positioning"],
          minute,
          random,
          1,
        );
        const attackPressure = average(strongest(attackingPool, headerScore, 3).map(headerScore));
        const defencePressure = average(strongest(defendingPool, headerScore, 3).map(headerScore));
        const scrambleChance = clamp(0.008, 0.085,
          0.018 + Math.max(0, attackPressure - defencePressure) / 420);
        if (aerialDuel.won && random() < scrambleChance) {
          addGoal("set-piece-scramble", players, opponents, { provider: taker, defender: marker });
          continue;
        }
        if (aerialDuel.won
          && random() < transitionShotChance(target, keeper, minute, volley ? 0.12 : 0.15, finishScore)) {
          addGoal(volley ? "corner-volley" : "corner-header", players, opponents, { provider: taker, scorer: target });
          continue;
        }
        if (highlightCount < highlightLimit && random() < 0.45) {
          addDuelEvent({
            kind: "cross", actor: taker, defender: marker, duel: aerialDuel,
            from: column === 2 ? 2 : 0, to: 1, action: "corner", possession: opposite(side),
            text: aerialDuel.won
              ? `${playerName(taker)} finds ${playerName(target)} from the corner, but the header flashes wide.`
              : `${playerName(marker)} rises above ${playerName(target)} and clears ${playerName(taker)}'s corner.`,
          });
        }
      } else if (highlightCount < highlightLimit && random() < 0.55) {
        addDuelEvent({
          kind: "chance", actor: shooter, defender, duel: null,
          from: zone, to: 1, action: "shot", possession: opposite(side),
          text: longRange
            ? `${playerName(shooter)} drives one from distance and ${playerName(keeper)} pushes it away.`
            : `${playerName(shooter)} gets a sight of goal, but ${playerName(keeper)} makes the save.`,
        });
      }
      side = opposite(side);
      zone = 6 + Math.floor(random() * 3);
      counterSteps = 0;
      continue;
    }

    const bypass = row === 2
      && random() < clamp(0.04, 0.3, (bypassScore(actor) - 45) / 180);
    const attackLabels = bypass
      ? ["Vision", "Passing", "Creativity", "Decisions"]
      : ["Passing", "Technique", "Decisions", "Teamwork"];
    const transitionDuel = localizedDuel(
      actor,
      defender,
      attackLabels,
      ["Positioning", "Anticipation", "Tackling", "Decisions"],
      minute,
      random,
      zone,
    );
    const matrixTargets = bypass
      ? ZONE_TRANSITION_MATRIX[zone].bypass
      : ZONE_TRANSITION_MATRIX[zone].adjacent;
    const preferredColumn = playerPreferredColumn(actor, random);
    const nextZone = weightedChoice(matrixTargets.map((target) => ({
      value: target,
      weight: target % 3 === preferredColumn ? 3 : target % 3 === column ? 2 : 1,
    })), random);
    const intermediateZone = Math.max(0, row - 1) * 3 + column;

    if (transitionDuel.won) {
      if (bypass && highlightCount < highlightLimit) {
        addDuelEvent({
          kind: "through-ball", actor, defender, duel: transitionDuel,
          from: zone, to: nextZone, action: "through-ball", possession: side,
          bypassedZone: intermediateZone,
          text: `${playerName(actor)} sees the run early and threads a pass beyond ${playerName(defender)}, bypassing midfield completely.`,
        });
      }
      zone = nextZone;
      if (counterSteps > 0) counterSteps -= 1;
      continue;
    }

    if (bypass && highlightCount < highlightLimit) {
      addDuelEvent({
        kind: "through-ball", actor, defender, duel: transitionDuel,
        from: zone, to: intermediateZone, action: "interception", possession: opposite(side),
        bypassedZone: intermediateZone,
        text: `${playerName(actor)} tries to split the lines, but ${playerName(defender)} reads the pass in the bypassed zone.`,
      });
    }

    const highPressZone = [3, 5].includes(zone);
    if (highPressZone) {
      const presser = weightedPlayer(attackingPool, random, "", (player) =>
        conditionedScore(player, pressingScore, minute));
      const pressDuel = localizedDuel(
        presser,
        defender,
        ["Work Rate", "Stamina", "Anticipation", "Tackling"],
        ["Passing", "Decisions", "Technique", "Composure"],
        minute,
        random,
        zone,
      );
      if (pressDuel.won
        && random() < transitionShotChance(presser, keeper, minute, 0.29, pressingScore)) {
        addGoal("high-press", players, opponents, { scorer: presser });
        continue;
      }
    }

    if (!bypass && highlightCount < highlightLimit && random() < 0.2) {
      addDuelEvent({
        kind: "tackle", actor, defender, duel: transitionDuel,
        from: zone, to: zone, action: "turnover", possession: opposite(side),
        text: `${playerName(defender)} wins the localized duel against ${playerName(actor)} and takes possession.`,
      });
    }
    side = opposite(side);
    zone = MIRRORED_ZONE[zone];
    counterSteps = 3;
  }

  return {
    events: events.sort((left, right) => left.matchSecond - right.matchSecond),
    disciplinary,
    userGoals: events.filter((event) => event.goal && event.side === "user").length,
    rivalGoals: events.filter((event) => event.goal && event.side === "opponent").length,
    ticks: maxTicks,
  };
}

function manOfTheMatch(events, userModel, rivalModel, random, winnerSide) {
  const candidates = [
    ...userModel.lineup.map((player) => ({ side: "user", player })),
    ...rivalModel.lineup.map((player) => ({ side: "opponent", player })),
  ];
  const scores = new Map();
  for (const candidate of candidates) {
    const key = `${candidate.side}:${playerIdentity(candidate.player)}`;
    const roleScore = isGoalkeeper(candidate.player)
      ? goalkeeperScore(candidate.player)
      : isDefender(candidate.player)
        ? defenderScore(candidate.player)
        : isMidfielder(candidate.player)
          ? midfielderScore(candidate.player)
          : attackerScore(candidate.player);
    scores.set(key, {
      ...candidate,
      score: roleScore / 28 + random() * 0.7 + (candidate.player.isCaptain ? 0.2 : 0),
    });
  }
  for (const event of events) {
    const actorSide = event.actorSide || event.side;
    const key = `${actorSide}:${event.scorerPlayer?.database || scenario.database}:${event.scorerPlayer?.sourcePersonId || event.scorer}`;
    const entry = scores.get(key);
    if (!entry) continue;
    if (event.goal && event.goalCredit === false) entry.score -= 1.4;
    else if (event.goal) entry.score += 4.4;
    else if (event.duelWon === true) entry.score += 0.9;
    else if (event.kind === "chance") entry.score += 0.72;
    if (event.card === "yellow") entry.score -= 0.45;
    if (event.card === "red") entry.score -= 2.2;
    if (event.providerPlayer) {
      const providerKey = `${event.side}:${event.providerPlayer.database || scenario.database}:${event.providerPlayer.sourcePersonId || event.provider}`;
      const providerEntry = scores.get(providerKey);
      if (providerEntry && providerEntry !== entry) providerEntry.score += 0.85;
    }
    if (event.duelWon === false && event.defenderPlayer) {
      const defenderSide = event.side === "user" ? "opponent" : "user";
      const defenderKey = `${defenderSide}:${event.defenderPlayer.database || scenario.database}:${event.defenderPlayer.sourcePersonId || event.defender}`;
      const defenderEntry = scores.get(defenderKey);
      if (defenderEntry) defenderEntry.score += 0.9;
    }
  }
  for (const entry of scores.values()) {
    if (winnerSide && entry.side === winnerSide) entry.score += 0.45;
  }
  const winner = [...scores.values()].sort((left, right) =>
    right.score - left.score || playerName(left.player).localeCompare(playerName(right.player)))[0];
  if (!winner) return null;
  return {
    ...playerReference(winner.player),
    side: winner.side,
    rating: clamp(6.5, 10, 6.1 + winner.score * 0.58).toFixed(1),
  };
}

function matchSimulation(opponentKey, roster, stage, hidden = false) {
  const random = seededRandom(hashString(`${runSeed}:${stage}:${opponentKey}:${state.matchNumber}:${hidden}`));
  const userOvr = visibleSquadRatings().team || 70;
  const ourPlayers = userPlayers();
  const userModel = teamModel(ourPlayers);
  const rivalModel = teamModel(roster);
  const rivalOvr = Math.round(rivalModel.overall);
  const rngRoll = Math.round(random() * 100);
  const userLateCondition = teamConditionAt(userModel, 85);
  const rivalLateCondition = teamConditionAt(rivalModel, 85);
  const regularTimeline = buildTransitionTimeline({
    random,
    ourPlayers,
    roster,
    start: 3,
    end: 89,
  });
  const events = regularTimeline.events;
  let userGoals = regularTimeline.userGoals;
  let rivalGoals = regularTimeline.rivalGoals;
  const regulationStoppageSeconds = calculateStoppageSeconds(events, random, 360);
  let extraTimeEvents = [];
  let extraTimeStoppageSeconds = 0;
  const hasExtraTime = stage !== "Group stage" && userGoals === rivalGoals;
  if (hasExtraTime) {
    const extraTimeline = buildTransitionTimeline({
      random,
      ourPlayers,
      roster,
      start: 91,
      end: 120,
      intensity: 1.08,
      disciplinary: regularTimeline.disciplinary,
    });
    userGoals += extraTimeline.userGoals;
    rivalGoals += extraTimeline.rivalGoals;
    extraTimeEvents = extraTimeline.events;
    extraTimeStoppageSeconds = calculateStoppageSeconds(extraTimeEvents, random, 120);
  }

  const userWon = userGoals > rivalGoals;
  const winnerSide = userGoals === rivalGoals ? "" : userWon ? "user" : "opponent";
  const allEvents = [...events, ...extraTimeEvents];
  const manOfMatch = manOfTheMatch(allEvents, userModel, rivalModel, random, winnerSide);
  const closeness = Math.abs(userModel.overall - rivalModel.overall) < 6 ? 35 : 0;
  const minuteDelay = 110 + Math.floor(random() * 91) + closeness;

  return {
    opponentKey,
    opponentName: CLUBS[opponentKey].name,
    stage,
    userGoals,
    rivalGoals,
    shootout: null,
    penaltyEvents: [],
    needsPenalties: hasExtraTime && userGoals === rivalGoals,
    hasExtraTime,
    userWon,
    manOfMatch,
    minuteDelay,
    regulationStoppageSeconds,
    extraTimeStoppageSeconds,
    regulationEndSecond: 90 * 60 + regulationStoppageSeconds,
    extraTimeEndSecond: 120 * 60 + extraTimeStoppageSeconds,
    events,
    extraTimeEvents,
    sentOffPlayerIds: [...regularTimeline.disciplinary.sentOff],
    formula: {
      userOvr,
      rivalOvr,
      rngRoll,
      transitionTicks: regularTimeline.ticks,
      userAttack: Math.round(userModel.attack),
      rivalAttack: Math.round(rivalModel.attack),
      userDefence: Math.round(userModel.defence),
      rivalDefence: Math.round(rivalModel.defence),
      userGoalkeeping: Math.round(userModel.goalkeeping),
      rivalGoalkeeping: Math.round(rivalModel.goalkeeping),
      userLateCondition: userLateCondition.toFixed(2),
      rivalLateCondition: rivalLateCondition.toFixed(2),
    },
  };
}

function attributeValue(profile, label) {
  const match = (profile?.attributes || []).find((item) =>
    String(item.label || "").toLowerCase() === label.toLowerCase());
  return Number(match?.value) || 0;
}

async function penaltyRating(player) {
  const key = playerIdentity(player);
  if (penaltyRatingCache.has(key)) return penaltyRatingCache.get(key);
  let rating = Math.max(1, Math.round((Number(player.current_ability) || 100) / 20));
  try {
    const response = await getPlayer(
      player.database_slug || scenario.database,
      String(player.source_person_id),
    );
    rating = attributeValue(response.profile, "Penalties") || rating;
  } catch {
    // The ability-derived fallback keeps the shootout playable offline.
  }
  penaltyRatingCache.set(key, rating);
  return rating;
}

async function penaltyTakers(players, excluded = new Set(), side = "user") {
  const eligible = players
    .filter((player) =>
      !isGoalkeeper(player) && !excluded.has(`${side}:${playerIdentity(player)}`))
    .sort((left, right) => {
      const lineOrder = (player) => isDefender(player) ? 1 : 0;
      return lineOrder(left) - lineOrder(right)
        || Number(right.current_ability) - Number(left.current_ability);
    })
    .slice(0, 12);
  const rated = await Promise.all(eligible.map(async (player) => ({
    player,
    rating: await penaltyRating(player),
    defender: isDefender(player),
  })));
  return rated.sort((left, right) =>
    Number(left.defender) - Number(right.defender)
    || right.rating - left.rating
    || Number(right.player.current_ability) - Number(left.player.current_ability));
}

async function preparePenaltyShootout(result, roster) {
  if (!result.needsPenalties) return result;
  const random = seededRandom(hashString(`${runSeed}:penalties:${result.opponentKey}:${state.matchNumber}`));
  const excluded = new Set(result.sentOffPlayerIds);
  const [ours, theirs] = await Promise.all([
    penaltyTakers(userPlayers(), excluded, "user"),
    penaltyTakers(roster.slice(0, 18), excluded, "opponent"),
  ]);
  if (!ours.length || !theirs.length) {
    throw new Error("A penalty shootout needs at least one eligible outfield player per team.");
  }
  const ourKeeper = goalkeeper(userPlayers());
  const theirKeeper = goalkeeper(roster);
  let userScore = 0;
  let rivalScore = 0;
  const attempts = [];
  let round = 0;

  while (round < 10) {
    const ourTaker = ours[round % ours.length];
    const theirTaker = theirs[round % theirs.length];
    const ourChance = clamp(0.55, 0.94, 0.56 + ourTaker.rating / 50);
    const theirChance = clamp(0.55, 0.94, 0.56 + theirTaker.rating / 50);
    const userScored = random() < ourChance;
    const rivalScored = random() < theirChance;
    if (userScored) userScore += 1;
    if (rivalScored) rivalScore += 1;
    attempts.push({
      round: round + 1,
      userTaker: playerName(ourTaker.player),
      opponentTaker: playerName(theirTaker.player),
      userScored,
      opponentScored: rivalScored,
      userText: userScored
        ? `${playerName(ourTaker.player)} scores.`
        : `${playerName(theirKeeper)} saves from ${playerName(ourTaker.player)}.`,
      opponentText: rivalScored
        ? `${playerName(theirTaker.player)} scores.`
        : `${playerName(ourKeeper)} saves from ${playerName(theirTaker.player)}.`,
    });
    round += 1;

    if (round < 5) {
      const remaining = 5 - round;
      if (Math.abs(userScore - rivalScore) > remaining) break;
    } else if (userScore !== rivalScore) {
      break;
    }
  }

  result.shootout = [userScore, rivalScore];
  result.penaltyEvents = attempts;
  result.userWon = userScore > rivalScore;
  return result;
}

function hiddenSimulation(leftKey, rightKey, leftRoster, rightRoster, round) {
  const random = seededRandom(hashString(`${runSeed}:hidden:${round}:${leftKey}:${rightKey}`));
  const leftOvr = opponentOverall(leftRoster);
  const rightOvr = opponentOverall(rightRoster);
  const edge = (leftOvr - rightOvr) / 20;
  return {
    leftKey,
    rightKey,
    leftGoals: poisson(clamp(0.25, 3.4, 1.2 + edge + (random() - 0.5)), random),
    rightGoals: poisson(clamp(0.25, 3.4, 1.2 - edge + (random() - 0.5)), random),
  };
}

function applyStanding(leftKey, rightKey, leftGoals, rightGoals) {
  const left = state.table.get(leftKey);
  const right = state.table.get(rightKey);
  left.played += 1;
  right.played += 1;
  left.gf += leftGoals;
  left.ga += rightGoals;
  right.gf += rightGoals;
  right.ga += leftGoals;
  if (leftGoals > rightGoals) {
    left.wins += 1;
    right.losses += 1;
    left.points += 3;
  } else if (leftGoals < rightGoals) {
    right.wins += 1;
    left.losses += 1;
    right.points += 3;
  } else {
    left.draws += 1;
    right.draws += 1;
    left.points += 1;
    right.points += 1;
  }
}

function playerHref(player) {
  const database = player?.database || player?.database_slug;
  const sourcePersonId = player?.sourcePersonId || player?.source_person_id;
  if (!database || !sourcePersonId) return "";
  const params = new URLSearchParams({
    database: String(database),
    player: String(sourcePersonId),
  });
  return `database.html?${params}`;
}

function topScorerSummary() {
  const [name = "—", entry = { goals: 0, player: null }] = Object.entries(state.userRecord.scorers)
    .sort((left, right) =>
      Number(right[1]?.goals || 0) - Number(left[1]?.goals || 0)
      || left[0].localeCompare(right[0]))[0] || [];
  return { name, goals: Number(entry.goals || 0), player: entry.player || null };
}

function dominatorSummary() {
  const winner = Object.values(state.userRecord.dominators)
    .sort((left, right) =>
      right.awards - left.awards
      || right.ratingTotal - left.ratingTotal
      || left.player.name.localeCompare(right.player.name))[0];
  return winner || {
    awards: 0,
    ratingTotal: 0,
    player: { name: "—", database: "", sourcePersonId: "" },
  };
}

function currentRecordStage() {
  if (state.champion) return { label: "Champion", rank: scenario.stages.length + 4 };
  if (state.outcomeStage) {
    const rank = Math.max(1, scenario.stages.indexOf(state.outcomeStage) + 4);
    return { label: state.outcomeStage, rank };
  }
  const latest = state.userRecord.matches.at(-1)?.stage || "Group stage";
  const knockoutRank = scenario.stages.indexOf(latest);
  return {
    label: latest.startsWith("Group") ? `Group · ${state.userRecord.played}/3` : latest,
    rank: knockoutRank >= 0 ? knockoutRank + 4 : Math.min(3, state.userRecord.played),
  };
}

function recordPayload(username) {
  const captain = team.players.find((entry) => entry.isCaptain)?.player;
  const top = topScorerSummary();
  const dominator = dominatorSummary();
  const stage = currentRecordStage();
  return {
    runId: `${scenario.key}:${groupName}:${runSeed}:${team.teamName}`,
    squadSeed: sharedSquad.seed,
    username,
    teamName: team.teamName,
    stage: stage.label,
    stageRank: stage.rank,
    champion: state.champion ? 1 : 0,
    captainName: playerName(captain),
    captainDatabase: captain?.database_slug || "",
    captainSourcePersonId: String(captain?.source_person_id || ""),
    topScorerName: top.name,
    topScorerDatabase: top.player?.database || "",
    topScorerSourcePersonId: top.player?.sourcePersonId || "",
    topScorerGoals: top.goals,
    dominatorName: dominator.player.name,
    dominatorDatabase: dominator.player.database || "",
    dominatorSourcePersonId: dominator.player.sourcePersonId || "",
    dominatorAwards: dominator.awards,
    played: state.userRecord.played,
    wins: state.userRecord.wins,
    draws: state.userRecord.draws,
    losses: state.userRecord.losses,
    goalsFor: state.userRecord.gf,
    goalsAgainst: state.userRecord.ga,
  };
}

function linkedRecordPlayer(name, database, sourcePersonId, suffix = "") {
  const href = playerHref({ database, sourcePersonId });
  const label = `${name || "—"}${suffix}`;
  return href
    ? `<a href="${escapeHtml(href)}">${escapeHtml(label)}</a>`
    : escapeHtml(label);
}

function renderRecordRows(items = []) {
  elements.recordRows.replaceChildren();
  if (!items.length) {
    elements.recordRows.innerHTML = '<tr><td colspan="6">No saved runs yet.</td></tr>';
    return;
  }
  items.forEach((item) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <th>${escapeHtml(item.username)}</th>
      <td>${escapeHtml(item.champion ? "Champion" : item.stage)}</td>
      <td>${linkedRecordPlayer(item.captain_name, item.captain_database, item.captain_source_person_id)}</td>
      <td>${linkedRecordPlayer(item.top_scorer_name, item.top_scorer_database, item.top_scorer_source_person_id, ` · ${item.top_scorer_goals}`)}</td>
      <td>${linkedRecordPlayer(item.dominator_name, item.dominator_database, item.dominator_source_person_id, ` · ${item.dominator_awards}`)}</td>
      <td>${item.squad_seed
        ? `<a href="draft-squad.html?seed=${encodeURIComponent(item.squad_seed)}">View XI</a>`
        : "—"}</td>
    `;
    elements.recordRows.append(row);
  });
}

function squadShareUrl() {
  const url = new URL("draft-squad.html", window.location.href);
  url.searchParams.set("seed", sharedSquad.seed);
  return url.href;
}

function persistSharedSquad() {
  if (!squadSavePromise) {
    squadSavePromise = saveDraftSquad(sharedSquad).catch((error) => {
      squadSavePromise = null;
      throw error;
    });
  }
  return squadSavePromise;
}

async function shareFinishedSquad(button, status) {
  button.disabled = true;
  status.textContent = "Preparing squad link…";
  let url = "";
  try {
    await persistSharedSquad();
    url = squadShareUrl();
  } catch {
    status.textContent = "The public link is unavailable; sharing the squad list instead.";
  }
  try {
    const text = formatDraftSquadText(sharedSquad);
    if (navigator.share) {
      const shareData = {
        title: `${sharedSquad.teamName} · Ultimate Draft`,
        text,
      };
      if (url) shareData.url = url;
      await navigator.share(shareData);
      status.textContent = "Squad shared.";
    } else if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText([text, url].filter(Boolean).join("\n\n"));
      status.textContent = url ? "Squad list and link copied." : "Squad list copied.";
    } else {
      status.textContent = url || "Sharing is not supported by this browser.";
    }
  } catch (error) {
    if (error?.name !== "AbortError") {
      status.textContent = error.message || "Could not prepare the squad link.";
    }
  } finally {
    button.disabled = false;
  }
}

async function loadRecordTable() {
  try {
    const payload = await getDraftRecords();
    renderRecordRows(Array.isArray(payload.items) ? payload.items : []);
  } catch {
    renderRecordRows([]);
    elements.recordStatus.textContent = "Records are temporarily unavailable.";
  }
}

function renderRecordOpportunity() {
  if (!state.userRecord.played) return;
  void persistSharedSquad().catch(() => {});
  elements.recordsPanel.hidden = false;
  const stage = currentRecordStage();
  elements.recordStatus.textContent = `Save your current ${stage.label.toLowerCase()} record.`;
  void loadRecordTable();
}

async function saveCurrentRecord(event) {
  event.preventDefault();
  const username = elements.recordUsername.value.trim();
  if (username.length < 2) {
    elements.recordStatus.textContent = "Enter at least two characters.";
    return;
  }
  const button = elements.recordForm.querySelector("button");
  button.disabled = true;
  elements.recordStatus.textContent = "Saving record…";
  try {
    await saveDraftRecord(recordPayload(username));
    state.savedUsername = username;
    elements.recordStatus.textContent = "Record saved. Saving again updates this run.";
    await loadRecordTable();
  } catch (error) {
    elements.recordStatus.textContent = error.message || "Could not save this record.";
  } finally {
    button.disabled = false;
  }
}

function updateUserRecord(result) {
  const record = state.userRecord;
  record.played += 1;
  record.gf += result.userGoals;
  record.ga += result.rivalGoals;
  if (result.userGoals === result.rivalGoals && !result.shootout) record.draws += 1;
  else if (result.userWon) record.wins += 1;
  else record.losses += 1;
  [...result.events, ...result.extraTimeEvents]
    .filter((event) => event.goal && event.side === "user" && event.goalCredit !== false)
    .forEach((event) => {
      const existing = record.scorers[event.scorer] || {
        goals: 0,
        player: event.scorerPlayer || null,
      };
      existing.goals += 1;
      if (!existing.player && event.scorerPlayer) existing.player = event.scorerPlayer;
      record.scorers[event.scorer] = existing;
    });
  if (result.manOfMatch) {
    const key = `${result.manOfMatch.database}:${result.manOfMatch.sourcePersonId || result.manOfMatch.name}`;
    const existing = record.dominators[key] || {
      awards: 0,
      ratingTotal: 0,
      player: result.manOfMatch,
    };
    existing.awards += 1;
    existing.ratingTotal += Number(result.manOfMatch.rating) || 0;
    record.dominators[key] = existing;
  }
  record.matches.push({
    stage: result.stage,
    opponent: result.opponentName,
    userGoals: result.userGoals,
    rivalGoals: result.rivalGoals,
    shootout: result.shootout || null,
    manOfMatch: result.manOfMatch || null,
  });
  renderRecordOpportunity();
}

function sortedTable() {
  return [...state.table.values()].sort((left, right) =>
    right.points - left.points
    || (right.gf - right.ga) - (left.gf - left.ga)
    || right.gf - left.gf
    || teamLabel(left.key).localeCompare(teamLabel(right.key)));
}

function renderTable() {
  elements.tableBody.replaceChildren();
  sortedTable().forEach((standing, index) => {
    const row = document.createElement("tr");
    if (standing.key === "user") row.classList.add("is-user");
    if (index < 2) row.classList.add("is-qualification");
    const goalDifference = standing.gf - standing.ga;
    row.innerHTML = `
      <td>${index + 1}</td>
      <th>${escapeHtml(teamLabel(standing.key))}</th>
      <td>${standing.played}</td>
      <td>${standing.wins}</td>
      <td>${standing.draws}</td>
      <td>${standing.losses}</td>
      <td>${goalDifference > 0 ? "+" : ""}${goalDifference}</td>
      <td><strong>${standing.points}</strong></td>
    `;
    elements.tableBody.append(row);
  });
}

function renderSquad() {
  const ratings = visibleSquadRatings();
  elements.teamName.textContent = team.teamName;
  elements.teamOverall.textContent = `${ratings.team} OVR`;
  elements.lineRatings.innerHTML = `
    <span><small>Attack</small><strong>${ratings.attack}</strong></span>
    <span><small>Midfield</small><strong>${ratings.midfield}</strong></span>
    <span><small>Defence</small><strong>${ratings.defence}</strong></span>
  `;
  elements.squadList.replaceChildren();
  team.players.forEach((entry) => {
    const visibleOverall = clamp(0, 99, Math.round(
      (Number(entry.player?.current_ability) || Number(entry.overall) * 2 || 0) / 2,
    ));
    const item = document.createElement("li");
    item.innerHTML = `
      <span>${escapeHtml(entry.role)}</span>
      <strong>${escapeHtml(playerName(entry.player))}${entry.isCaptain ? " (C)" : ""}</strong>
      <b>${visibleOverall}</b>
    `;
    elements.squadList.append(item);
  });
}

function eventMarkup(event) {
  const marker = event.card === "yellow"
    ? "■ "
    : event.card === "red"
      ? "■ "
      : event.goal
        ? "● "
        : "";
  const actor = `<strong>${marker}${escapeHtml(event.scorer)}</strong>`;
  return `
    <li class="${event.goal ? "is-goal" : ""} ${event.card ? `is-${event.card}-card` : ""} ${event.side === "opponent" ? "is-opponent" : ""}">
      <span class="run-event-team run-event-team-user">${event.side === "user" ? actor : ""}</span>
      <span class="run-event-commentary"><time>${event.minute}'</time><span>${escapeHtml(event.text)}</span></span>
      <span class="run-event-team run-event-team-opponent">${event.side === "opponent" ? actor : ""}</span>
    </li>
  `;
}

function delay(milliseconds) {
  return new Promise((resolve) => window.setTimeout(resolve, milliseconds));
}

function currentMatchPace() {
  const stored = readJsonStorage(MATCH_PACE_KEY, "normal");
  return MATCH_PACES[stored] ? stored : "normal";
}

function matchPaceMultiplier(paceSelect) {
  return MATCH_PACES[paceSelect?.value]?.multiplier || MATCH_PACES.normal.multiplier;
}

function formatMatchClock(matchSecond, stoppageBase = 0) {
  const second = Math.max(0, Math.floor(matchSecond));
  if (stoppageBase && second > stoppageBase) {
    return `${stoppageBase / 60}+${Math.ceil((second - stoppageBase) / 60)}'`;
  }
  return `${Math.floor(second / 60)}'`;
}

async function animateClockRange(
  clockDisplay,
  fromSecond,
  toSecond,
  durationMs,
  stoppageBase = 0,
) {
  const distance = Math.max(0, toSecond - fromSecond);
  if (!distance) {
    clockDisplay.textContent = formatMatchClock(toSecond, stoppageBase);
    return;
  }
  const steps = clamp(2, 12, Math.ceil(durationMs / 45));
  const stepDelay = Math.max(16, durationMs / steps);
  for (let step = 1; step <= steps; step += 1) {
    const progress = step / steps;
    const eased = 1 - (1 - progress) ** 2;
    clockDisplay.textContent = formatMatchClock(
      fromSecond + distance * eased,
      stoppageBase,
    );
    await delay(stepDelay);
  }
}

function displayZone(zone, side) {
  const validZone = clamp(0, 11, Number(zone) || 0);
  return side === "opponent" ? MIRRORED_ZONE[validZone] : validZone;
}

function setMiniPitchZone(pitch, event, endpoint = "to", opponentName = "Opponent") {
  if (!pitch || !event) return;
  const semanticZone = endpoint === "from" ? event.zoneFrom : event.zoneTo;
  const zone = displayZone(semanticZone, event.side);
  const [x, y] = ZONE_CENTERS[zone];
  pitch.style.setProperty("--ball-x", `${x}%`);
  pitch.style.setProperty("--ball-y", `${y}%`);
  const possession = endpoint === "to" && event.possessionAfter
    ? event.possessionAfter
    : event.side;
  pitch.dataset.possession = possession;
  pitch.dataset.action = event.action || event.kind || "pass";
  pitch.querySelectorAll("[data-zone]").forEach((cell) => {
    cell.classList.toggle("is-active", Number(cell.dataset.zone) === zone);
  });
  const status = pitch.parentElement?.querySelector("[data-pitch-status]");
  if (status) {
    status.textContent = possession === "user"
      ? `${team.teamName} · ${event.action || event.kind}`
      : `${opponentName} · ${event.action || event.kind}`;
  }
}

function miniPitchMarkup() {
  const zones = Array.from({ length: 12 }, (_, index) =>
    `<span class="run-mini-zone" data-zone="${index}"></span>`).join("");
  return `
    <aside class="run-mini-pitch-wrap" aria-label="Live ball position">
      <div class="run-mini-pitch" data-mini-pitch data-possession="user">
        ${zones}
        <span class="run-mini-halfway" aria-hidden="true"></span>
        <span class="run-mini-centre-circle" aria-hidden="true"></span>
        <span class="run-mini-box run-mini-box-top" aria-hidden="true"></span>
        <span class="run-mini-box run-mini-box-bottom" aria-hidden="true"></span>
        <span class="run-mini-ball" aria-hidden="true"></span>
      </div>
      <span class="run-mini-pitch-status" data-pitch-status>Kick-off</span>
    </aside>
  `;
}

async function animatePeriod({
  startSecond,
  endSecond,
  events,
  eventList,
  score,
  scoreDisplay,
  clockDisplay,
  paceSelect,
  pitch,
  opponentName,
  stoppageBase,
}) {
  let currentSecond = startSecond;
  const orderedEvents = events.slice().sort((left, right) =>
    Number(left.matchSecond) - Number(right.matchSecond));

  for (const event of orderedEvents) {
    const fallbackSecond = Number(event.minute || 0) * 60;
    const eventSecond = clamp(currentSecond, endSecond, Number(event.matchSecond) || fallbackSecond);
    const quietGap = Math.max(0, eventSecond - currentSecond);
    if (quietGap) {
      const quietDuration = clamp(90, 760, 95 + Math.sqrt(quietGap) * 18)
        * matchPaceMultiplier(paceSelect);
      await animateClockRange(
        clockDisplay,
        currentSecond,
        eventSecond,
        quietDuration,
        stoppageBase,
      );
    }

    const actionDuration = (440 + 390 * Number(event.presentationWeight || 1))
      * matchPaceMultiplier(paceSelect);
    pitch?.style.setProperty("--ball-duration", `${Math.max(180, actionDuration * 0.72)}ms`);
    setMiniPitchZone(pitch, event, "from", opponentName);
    await delay(35 * matchPaceMultiplier(paceSelect));
    setMiniPitchZone(pitch, event, "to", opponentName);

    if (event.goal) {
      if (event.side === "user") score.user += 1;
      else score.opponent += 1;
      scoreDisplay.textContent = `${score.user} – ${score.opponent}`;
    }
    eventList.insertAdjacentHTML("beforeend", eventMarkup(event));

    const actionEnd = Math.min(
      endSecond,
      Math.max(eventSecond, eventSecond + Number(event.actionSeconds || 6)),
    );
    await animateClockRange(
      clockDisplay,
      eventSecond,
      actionEnd,
      actionDuration,
      stoppageBase,
    );
    currentSecond = actionEnd;
  }

  if (currentSecond < endSecond) {
    const finalGap = endSecond - currentSecond;
    const finalDuration = clamp(120, 850, 110 + Math.sqrt(finalGap) * 18)
      * matchPaceMultiplier(paceSelect);
    await animateClockRange(
      clockDisplay,
      currentSecond,
      endSecond,
      finalDuration,
      stoppageBase,
    );
  }
}

async function animatePenaltyShootout(result, article, scoreDisplay, clockDisplay) {
  const section = document.createElement("section");
  section.className = "run-penalty-section";
  section.innerHTML = `
    <h3>Penalty shootout</h3>
    <div class="run-penalty-score"><span>${escapeHtml(team.teamName)}</span><b data-penalty-score>0 – 0</b><span>${escapeHtml(result.opponentName)}</span></div>
    <ol class="run-penalty-list" data-penalty-events></ol>
  `;
  article.append(section);
  const list = section.querySelector("[data-penalty-events]");
  const penaltyScore = section.querySelector("[data-penalty-score]");
  let ours = 0;
  let theirs = 0;
  clockDisplay.textContent = "PEN";

  for (const attempt of result.penaltyEvents) {
    await delay(260);
    if (attempt.userScored) ours += 1;
    if (attempt.opponentScored) theirs += 1;
    penaltyScore.textContent = `${ours} – ${theirs}`;
    list.insertAdjacentHTML("beforeend", `
      <li>
        <span class="${attempt.userScored ? "is-scored" : "is-missed"}">${escapeHtml(attempt.userTaker)} <b aria-label="${attempt.userScored ? "scored" : "missed"}">${attempt.userScored ? "○" : "×"}</b></span>
        <span class="${attempt.opponentScored ? "is-scored" : "is-missed"}"><b aria-label="${attempt.opponentScored ? "scored" : "missed"}">${attempt.opponentScored ? "○" : "×"}</b> ${escapeHtml(attempt.opponentTaker)}</span>
      </li>
    `);
  }
  scoreDisplay.textContent = `${result.userGoals} – ${result.rivalGoals} (${ours}–${theirs} pens)`;
}

async function animateMatch(result) {
  elements.matches.querySelector(".run-empty")?.remove();
  elements.matches.querySelector(".run-pending-shell")?.remove();
  const shell = document.createElement("details");
  shell.className = "run-match-shell";
  shell.open = true;
  shell.innerHTML = `
    <summary>
      <span>${escapeHtml(result.stage)}</span>
      <strong>${escapeHtml(team.teamName)} vs ${escapeHtml(result.opponentName)}</strong>
      <b data-summary-score>Live</b>
    </summary>
  `;
  const article = document.createElement("article");
  article.className = "run-match-card is-live";
  article.dataset.opponent = result.opponentName;
  const selectedPace = currentMatchPace();
  const paceOptions = Object.entries(MATCH_PACES).map(([value, option]) =>
    `<option value="${value}"${value === selectedPace ? " selected" : ""}>${option.label}</option>`
  ).join("");
  article.innerHTML = `
    <header>
      <span>${escapeHtml(result.stage)}</span>
      <div class="run-match-teams">
        <strong>${escapeHtml(team.teamName)}</strong>
        <span class="run-live-scoreboard">
          <b data-live-score>0 – 0</b>
          <span class="run-match-clock" data-match-clock aria-label="Match clock">0'</span>
          <label class="run-match-pace">
            <span>Pace</span>
            <select data-match-pace aria-label="Commentary pace">${paceOptions}</select>
          </label>
        </span>
        <strong>${escapeHtml(result.opponentName)}</strong>
      </div>
    </header>
    <div class="run-formula">
      <span>Team OVR <b>${result.formula.userOvr}</b></span>
      <span>Opponent OVR <b>${result.formula.rivalOvr}</b></span>
      <span>Attack <b>${result.formula.userAttack}–${result.formula.rivalAttack}</b></span>
      <span>Defence <b>${result.formula.userDefence}–${result.formula.rivalDefence}</b></span>
      <span>Goalkeeping <b>${result.formula.userGoalkeeping}–${result.formula.rivalGoalkeeping}</b></span>
      <span>Match variance <b>${result.formula.rngRoll}/100</b></span>
    </div>
    <div class="run-match-visual">
      ${miniPitchMarkup()}
      <ol class="run-event-list" data-live-events></ol>
    </div>
  `;
  shell.append(article);
  elements.matches.append(shell);
  const scoreDisplay = article.querySelector("[data-live-score]");
  const clockDisplay = article.querySelector("[data-match-clock]");
  const eventList = article.querySelector("[data-live-events]");
  const paceSelect = article.querySelector("[data-match-pace]");
  const pitch = article.querySelector("[data-mini-pitch]");
  const summaryScore = shell.querySelector("[data-summary-score]");
  const score = { user: 0, opponent: 0 };
  paceSelect.addEventListener("change", () => {
    writeJsonStorage(MATCH_PACE_KEY, paceSelect.value);
  });

  await animatePeriod({
    startSecond: 0,
    endSecond: result.regulationEndSecond || 90 * 60,
    events: result.events,
    eventList,
    score,
    scoreDisplay,
    clockDisplay,
    paceSelect,
    pitch,
    opponentName: result.opponentName,
    stoppageBase: 90 * 60,
  });

  if (result.hasExtraTime) {
    const extra = document.createElement("section");
    extra.className = "run-extra-time-section";
    extra.innerHTML = '<h3>Extra time</h3><ol class="run-event-list" data-extra-events></ol>';
    article.append(extra);
    await animatePeriod({
      startSecond: 90 * 60,
      endSecond: result.extraTimeEndSecond || 120 * 60,
      events: result.extraTimeEvents,
      eventList: extra.querySelector("[data-extra-events]"),
      score,
      scoreDisplay,
      clockDisplay,
      paceSelect,
      pitch,
      opponentName: result.opponentName,
      stoppageBase: 120 * 60,
    });
  }

  if (result.shootout) {
    await animatePenaltyShootout(result, article, scoreDisplay, clockDisplay);
  }
  if (result.manOfMatch) {
    const href = playerHref(result.manOfMatch);
    article.insertAdjacentHTML("beforeend", `
      <section class="run-man-of-match">
        <span>Man of the Match</span>
        <strong>${href
          ? `<a href="${escapeHtml(href)}">${escapeHtml(result.manOfMatch.name)}</a>`
          : escapeHtml(result.manOfMatch.name)}</strong>
        <b>${escapeHtml(result.manOfMatch.rating)}</b>
      </section>
    `);
  }
  article.classList.remove("is-live");
  article.classList.add(result.userWon
    ? "is-win"
    : result.userGoals === result.rivalGoals && !result.shootout
      ? "is-draw"
      : "is-loss");
  const finalScore = result.shootout
    ? `${result.userGoals}–${result.rivalGoals}, pens ${result.shootout[0]}–${result.shootout[1]}`
    : `${result.userGoals}–${result.rivalGoals}`;
  summaryScore.textContent = finalScore;
  shell.classList.add("is-score-docking");
  clockDisplay.hidden = true;
  await delay(850);
  shell.classList.remove("is-score-docking");
  shell.classList.add("is-finished");
  await delay(850);
  shell.classList.add("is-collapsing");
  await delay(800);
  shell.open = false;
  shell.classList.remove("is-collapsing");
}

function currentFixture() {
  if (state.phase === "group") {
    const round = groupRounds[state.groupRound];
    return round
      ? { stage: `Group stage · Matchday ${state.groupRound + 1}`, opponentKey: round.userOpponent }
      : null;
  }
  const opponentKey = currentKnockoutOpponent();
  return opponentKey
    ? { stage: scenario.stages[state.knockoutIndex], opponentKey }
    : null;
}

function renderPendingFixture() {
  if (state.completed) return;
  const fixture = currentFixture();
  if (!fixture) return;
  elements.matches.querySelector(".run-empty")?.remove();
  elements.matches.querySelector(".run-pending-shell")?.remove();
  const shell = document.createElement("details");
  shell.className = "run-match-shell run-pending-shell";
  shell.open = true;
  shell.innerHTML = `
    <summary>
      <span>${escapeHtml(fixture.stage)}</span>
      <strong>${escapeHtml(team.teamName)} vs ${escapeHtml(CLUBS[fixture.opponentKey].name)}</strong>
      <b>Ready</b>
    </summary>
    <div class="run-pending-body"><p>Squads are ready. Start this match when you are ready to watch it.</p></div>
  `;
  shell.querySelector(".run-pending-body").append(elements.nextButton);
  elements.nextButton.hidden = false;
  elements.matches.append(shell);
}

function initializeKnockoutBracket() {
  const seeds = { ...scenario.seeds };
  seeds[`${groupName}${state.groupPlace}`] = "user";
  seeds[`${groupName}${state.groupPlace === 1 ? 2 : 1}`] = state.groupCompanion;
  state.knockoutIndex = 0;
  state.knockoutRounds = [
    scenario.entryPairs.map(([left, right]) => [seeds[left], seeds[right]]),
  ];
}

function currentRoundFixtures() {
  return state.knockoutRounds[state.knockoutIndex] || [];
}

function currentKnockoutOpponent() {
  const fixture = currentRoundFixtures().find(([left, right]) =>
    left === "user" || right === "user");
  return fixture?.find((key) => key !== "user") || "";
}

const CLUB_STRENGTH = {
  real: 94, milan: 93, juventus: 91, arsenal: 90, united: 89,
  barcelona: 89, inter: 88, chelsea: 87, porto: 87, bayern: 86,
  valencia: 85, monaco: 84, deportivo: 84, ajax: 83, lyon: 82,
  sociedad: 80, stuttgart: 80, lokomotiv: 78, sparta: 77,
};

function simulatedBracketWinner([left, right], roundIndex, fixtureIndex) {
  const random = seededRandom(hashString(
    `${runSeed}:${scenario.key}:bracket:${roundIndex}:${fixtureIndex}:${left}:${right}`,
  ));
  const leftScore = (CLUB_STRENGTH[left] || 74) + random() * 18;
  const rightScore = (CLUB_STRENGTH[right] || 74) + random() * 18;
  return leftScore >= rightScore ? left : right;
}

function advanceKnockoutBracket() {
  const fixtures = currentRoundFixtures();
  const winners = fixtures.map((fixture, index) =>
    fixture.includes("user")
      ? "user"
      : simulatedBracketWinner(fixture, state.knockoutIndex, index));
  if (winners.length === 1) return false;
  const nextRound = [];
  for (let index = 0; index < winners.length; index += 2) {
    nextRound.push([winners[index], winners[index + 1]]);
  }
  state.knockoutRounds.push(nextRound);
  state.knockoutIndex += 1;
  return true;
}

function renderBracket() {
  elements.bracket.replaceChildren();
  if (state.completed) return;
  const stage = scenario.stages[state.knockoutIndex];
  const round = document.createElement("section");
  round.className = "run-bracket-round";
  round.innerHTML = `
    <header>
      <span>${escapeHtml(stage)}</span>
      <small>${currentRoundFixtures().length * 2} teams remain</small>
    </header>
    <div class="run-bracket-fixtures"></div>
  `;
  const fixtures = round.querySelector(".run-bracket-fixtures");
  currentRoundFixtures().forEach(([left, right]) => {
    const match = document.createElement("article");
    match.className = "run-bracket-match";
    if (left === "user" || right === "user") match.classList.add("is-current");
    match.innerHTML = `
      <span>${escapeHtml(teamLabel(left))}</span>
      <b>vs</b>
      <span>${escapeHtml(teamLabel(right))}</span>
    `;
    fixtures.append(match);
  });
  elements.bracket.append(round);
}

function showResult({ champion = false, eliminatedBy = "", eliminatedStage = "" } = {}) {
  state.completed = true;
  state.champion = champion;
  state.outcomeStage = champion ? "Champion" : eliminatedStage || "Group stage";
  elements.nextButton.disabled = true;
  elements.nextButton.hidden = true;
  const record = state.userRecord;
  const top = topScorerSummary();
  const dominator = dominatorSummary();
  const captain = team.players.find((entry) => entry.isCaptain);
  const captainLink = playerHref(captain?.player);
  const topScorerLink = playerHref(top.player);
  const dominatorLink = playerHref(dominator.player);
  const matchSummary = champion
    ? `<div class="run-result-matches">
        <h3>Road to the trophy</h3>
        <ol>${record.matches.map((match) => `
          <li>
            <span>${escapeHtml(match.stage)} · ${escapeHtml(match.opponent)}${match.manOfMatch ? ` · MOTM ${escapeHtml(match.manOfMatch.name)}` : ""}</span>
            <strong>${match.userGoals}–${match.rivalGoals}${match.shootout ? ` (${match.shootout[0]}–${match.shootout[1]} pens)` : ""}</strong>
          </li>`).join("")}
        </ol>
      </div>`
    : "";
  const squadList = sharedSquad.players.map((player) => `
    <li>
      <span>${escapeHtml(player.role)}</span>
      <strong>${escapeHtml(player.name)}${player.captain ? " <b>C</b>" : ""}</strong>
      <small>${escapeHtml(player.season || "—")}</small>
      <em>${player.overall}</em>
    </li>
  `).join("");
  elements.resultCard.hidden = false;
  elements.resultCard.className = `run-result-card ${champion ? "is-champion" : "is-eliminated"}`;
  elements.resultCard.innerHTML = `
    <span class="draft-panel-kicker">${champion ? "Champions of Europe" : "Run complete"}</span>
    <h2>${champion ? `${escapeHtml(team.teamName)} win the cup!` : `${escapeHtml(team.teamName)} are eliminated`}</h2>
    <p>${champion
      ? `The drafted XI complete the ${escapeHtml(scenario.label)} route and lift the trophy in ${escapeHtml(scenario.finalVenue)}.`
      : eliminatedBy
        ? `Eliminated in the ${escapeHtml(eliminatedStage)} by ${escapeHtml(eliminatedBy)}.`
        : `Finished ${state.groupPlace}${state.groupPlace === 3 ? "rd" : "th"} in Group ${escapeHtml(groupName)}.`}</p>
    <div class="run-result-stats">
      <span><strong>${record.gf}</strong><small>Goals for</small></span>
      <span><strong>${record.ga}</strong><small>Against</small></span>
      <span><strong>${record.wins}</strong><small>Wins</small></span>
      <span><strong>${record.draws}</strong><small>Draws</small></span>
      <span><strong>${record.losses}</strong><small>Losses</small></span>
      <span><strong>${state.groupPlace || "—"}</strong><small>Group place</small></span>
    </div>
    <div class="run-result-honours">
      <span><small>Captain</small><strong>${captainLink ? `<a href="${escapeHtml(captainLink)}">${escapeHtml(playerName(captain?.player))}</a>` : escapeHtml(playerName(captain?.player))}</strong></span>
      <span><small>Top scorer</small><strong>${topScorerLink ? `<a href="${escapeHtml(topScorerLink)}">${escapeHtml(top.name)}</a>` : escapeHtml(top.name)} · ${top.goals} goal${top.goals === 1 ? "" : "s"}</strong></span>
      <span><small>Dominator</small><strong>${dominatorLink ? `<a href="${escapeHtml(dominatorLink)}">${escapeHtml(dominator.player.name)}</a>` : escapeHtml(dominator.player.name)} · ${dominator.awards} award${dominator.awards === 1 ? "" : "s"}</strong></span>
      <span><small>Exit stage</small><strong>${escapeHtml(champion ? "Winner" : eliminatedStage || "Group stage")}</strong></span>
    </div>
    ${matchSummary}
    <div class="run-result-squad">
      <div>
        <span class="draft-panel-kicker">Share your XI</span>
        <h3>${escapeHtml(sharedSquad.teamName)}</h3>
        <code>${escapeHtml(sharedSquad.seed)}</code>
      </div>
      <ol>${squadList}</ol>
      <div class="run-result-share">
        <button type="button" data-share-squad>Share squad</button>
        <small data-share-status>Your exact XI will open as a public list.</small>
      </div>
    </div>
    <div class="run-result-actions">
      <button type="button" data-replay>Replay run</button>
      <a href="draft-setup.html">Edit team</a>
    </div>
  `;
  void persistSharedSquad().catch(() => {});
  renderRecordOpportunity();
  if (state.savedUsername) {
    void saveDraftRecord(recordPayload(state.savedUsername)).then(loadRecordTable).catch(() => {});
  }
  elements.resultCard.querySelector("[data-replay]").addEventListener("click", () => window.location.reload());
  const shareButton = elements.resultCard.querySelector("[data-share-squad]");
  const shareStatus = elements.resultCard.querySelector("[data-share-status]");
  shareButton.addEventListener("click", () => shareFinishedSquad(shareButton, shareStatus));
  elements.resultCard.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function playGroupRound() {
  const round = groupRounds[state.groupRound];
  elements.nextButton.disabled = true;
  elements.stageDescription.textContent = `Loading both ${scenario.shortLabel} squads and calculating the match model…`;
  const [opponentBase, hiddenLeft, hiddenRight] = await Promise.all([
    opponentRoster(round.userOpponent),
    opponentRoster(round.hidden[0]),
    opponentRoster(round.hidden[1]),
  ]);
  const [opponent] = await Promise.all([
    hydratePlayers(opponentBase),
    hydratePlayers(userPlayers()),
  ]);
  state.matchNumber += 1;
  const result = matchSimulation(round.userOpponent, opponent, "Group stage");
  const hidden = hiddenSimulation(
    round.hidden[0],
    round.hidden[1],
    hiddenLeft,
    hiddenRight,
    state.groupRound,
  );
  await animateMatch(result);
  applyStanding("user", round.userOpponent, result.userGoals, result.rivalGoals);
  applyStanding(hidden.leftKey, hidden.rightKey, hidden.leftGoals, hidden.rightGoals);
  updateUserRecord(result);
  state.groupRound += 1;
  renderTable();

  if (state.groupRound < groupRounds.length) {
    elements.stageTitle.textContent = `Group ${groupName} · Matchday ${state.groupRound + 1}`;
    elements.stageDescription.textContent = "Standings updated. The next opponent is ready.";
    elements.nextButton.textContent = `Play Matchday ${state.groupRound + 1} →`;
    elements.nextButton.disabled = false;
    renderPendingFixture();
    return;
  }

  const standings = sortedTable();
  state.groupPlace = standings.findIndex((item) => item.key === "user") + 1;
  if (state.groupPlace > 2) {
    elements.stageTitle.textContent = `Finished ${state.groupPlace}${state.groupPlace === 3 ? "rd" : "th"} in Group ${groupName}`;
    elements.stageDescription.textContent = "The knockout places are out of reach.";
    showResult({ eliminatedStage: "Group stage" });
    return;
  }

  state.groupCompanion = standings
    .slice(0, 2)
    .find((item) => item.key !== "user")?.key || groupOpponents[0];
  state.phase = "knockout";
  initializeKnockoutBracket();
  const nextOpponent = currentKnockoutOpponent();
  const openingStage = scenario.stages[0];
  elements.bracketPanel.hidden = false;
  elements.stageKicker.textContent = "Qualified";
  elements.stageTitle.textContent = `${state.groupPlace === 1 ? "Group winners" : "Group runners-up"} · ${openingStage}`;
  elements.stageDescription.textContent = `Next: ${CLUBS[nextOpponent].name}. Future opponents remain hidden.`;
  elements.nextButton.textContent = `Play ${CLUBS[nextOpponent].name} →`;
  elements.nextButton.disabled = false;
  renderBracket();
  renderPendingFixture();
}

async function playKnockoutRound() {
  const opponentKey = currentKnockoutOpponent();
  const stage = scenario.stages[state.knockoutIndex];
  elements.nextButton.disabled = true;
  elements.stageTitle.textContent = `${stage} · ${team.teamName} vs ${CLUBS[opponentKey].name}`;
  elements.stageDescription.textContent = "Loading the opponent squad and calculating the tie…";
  const rosterBase = await opponentRoster(opponentKey);
  const [roster] = await Promise.all([
    hydratePlayers(rosterBase),
    hydratePlayers(userPlayers()),
  ]);
  state.matchNumber += 1;
  const result = matchSimulation(opponentKey, roster, stage);
  if (result.needsPenalties) {
    elements.stageDescription.textContent = "The tie may require penalties. Selecting the strongest available takers…";
    await preparePenaltyShootout(result, roster);
  }
  await animateMatch(result);
  updateUserRecord(result);

  if (!result.userWon) {
    elements.stageDescription.textContent = "The European run ends here.";
    showResult({ eliminatedBy: CLUBS[opponentKey].name, eliminatedStage: stage });
    return;
  }

  if (!advanceKnockoutBracket()) {
    elements.stageTitle.textContent = "Champions of Europe";
    elements.stageDescription.textContent = "The final whistle confirms the title.";
    showResult({ champion: true });
    return;
  }

  renderBracket();
  const nextOpponent = currentKnockoutOpponent();
  elements.stageKicker.textContent = scenario.stages[state.knockoutIndex];
  elements.stageTitle.textContent = `${scenario.stages[state.knockoutIndex]} · ${CLUBS[nextOpponent].name}`;
  elements.stageDescription.textContent = `${CLUBS[opponentKey].name} eliminated. The next tie is ready.`;
  elements.nextButton.textContent = `Play ${CLUBS[nextOpponent].name} →`;
  elements.nextButton.disabled = false;
  renderPendingFixture();
}

async function playNext() {
  if (state.busy || state.completed) return;
  state.busy = true;
  try {
    if (state.phase === "group") await playGroupRound();
    else await playKnockoutRound();
  } catch (error) {
    elements.stageDescription.textContent = error.message || "The match could not be simulated.";
    elements.nextButton.disabled = false;
    renderPendingFixture();
  } finally {
    state.busy = false;
  }
}

function showMissingTeam() {
  elements.nextButton.hidden = true;
  elements.stageKicker.textContent = "No completed XI";
  elements.stageTitle.textContent = "Return to team selection";
  elements.stageDescription.textContent = "Complete the eleven and appoint a captain before starting the championship.";
  elements.matches.innerHTML = '<a class="run-return-button" href="draft-setup.html">Build your team →</a>';
}

elements.nextButton.addEventListener("click", playNext);
elements.recordForm.addEventListener("submit", saveCurrentRecord);
elements.seed.textContent = `Offline ${scenario.shortLabel} · Seed #${runSeed}`;
elements.groupHeading.textContent = `Group ${groupName}`;
elements.stageTitle.textContent = `Group ${groupName} · Matchday 1`;
elements.stageDescription.textContent =
  `The group draw replaces ${scenario.replacementLabel[groupName]} with ${team?.teamName || "your XI"}.`;
elements.nextButton.textContent = "Play Matchday 1 →";

if (!team?.players || team.players.length !== 11 || !team.captainSlotId) {
  showMissingTeam();
} else {
  renderSquad();
  renderTable();
  renderPendingFixture();
}
