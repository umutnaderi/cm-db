import {
  API_BASE,
  getDraftRecords,
  getPlayer,
  getPlayerMetrics,
  saveDraftRecord,
  saveDraftSquad,
  searchPlayers,
} from "./src/lib/retroballApi.js?v=20260801-65";
import {
  average,
  clamp,
  computePressure,
  conditionedScore,
  conditionMultiplier,
  CONGESTED_ZONES,
  contestedRace,
  displayZone,
  ENGINE_ATTRIBUTE_ALIASES,
  ENGINE_ATTRIBUTE_RULES,
  engineAttribute,
  engineAttributeDetail,
  FINISH_TYPE_LABELS,
  FREE_KICK_SHOT_LABELS,
  goalkeeperScore,
  hashString,
  headerScore,
  isAttacker,
  isDefender,
  isGoalkeeper,
  isMidfielder,
  KEEPER_DUEL_LABELS,
  LEGACY_ATTRIBUTE_DATABASES,
  localizedDuel,
  MATCH_TRACE,
  MIRRORED_ZONE,
  normalizedAttributeLabel,
  normalizedEngineRatings,
  playerAbility,
  playerAttribute,
  playerName,
  playerPreferredColumn,
  poacherScore,
  receiveOrientation,
  resolveDelivery,
  resolveEngagement,
  resolveFinishAttempt,
  resolveFoul,
  resolveFreeKickAttempt,
  resolveKeeperSave,
  resolveOneOnOne,
  resolvePenaltyKick,
  resolveReceive,
  resolveShotBlock,
  resolveWall,
  seededRandom,
  selectDeliveryChoice,
  selectEngagement,
  selectFinishType,
  selectFreeKickShotType,
  selectReceiver,
  traceScenario,
  transitionShotChance,
  weightedChoice,
  weightedPlayer,
  ZONE_CENTERS,
  ZONE_TRANSITION_MATRIX,
} from "./src/lib/matchEngineCore.js?v=20260811-01";
import {
  createDraftSquad,
  formatDraftSquadText,
} from "./src/lib/draftSquad.js?v=20260730-47";
import {
  createCanonicalMatchTimeline,
} from "./src/lib/matchTimeline.js?v=20260803-01";
import {
  createMatchPlaybackController,
  estimateServerClockOffset,
} from "./src/lib/matchPlayback.js?v=20260801-01";
import {
  boostAttributesTowardAbility,
  fillZeroAttributes,
} from "./src/lib/attributeGeneration.js?v=20260809-01";

const TEAM_STORAGE_KEY = "retroball-draft-team-v1";
const OPPONENT_CACHE_KEY = "retroball-ucl-opponents-v1";
const MATCH_PACE_KEY = "retroball-match-commentary-pace-v1";
const FRIEND_SESSION_KEY = "retroball-friend-session-v1";
const MATCH_PACES = {
  fast: { label: "Fast", multiplier: 0.58 },
  normal: { label: "Normal", multiplier: 1 },
  slow: { label: "Slow", multiplier: 1.65 },
};
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

// Nation values match the `nation_name` field returned by the players API exactly
// (verified against cm0102_vanilla_original) — a mismatch here silently empties a roster.
const NATIONS = {
  argentina: { name: "Argentina", nation: "Argentina" },
  belgium: { name: "Belgium", nation: "Belgium" },
  brazil: { name: "Brazil", nation: "Brazil" },
  cameroon: { name: "Cameroon", nation: "Cameroon" },
  china: { name: "China PR", nation: "China PR" },
  costarica: { name: "Costa Rica", nation: "Costa Rica" },
  croatia: { name: "Croatia", nation: "Croatia" },
  denmark: { name: "Denmark", nation: "Denmark" },
  ecuador: { name: "Ecuador", nation: "Ecuador" },
  england: { name: "England", nation: "England" },
  france: { name: "France", nation: "France" },
  germany: { name: "Germany", nation: "Germany" },
  ireland: { name: "Republic of Ireland", nation: "Republic of Ireland" },
  italy: { name: "Italy", nation: "Italy" },
  japan: { name: "Japan", nation: "Japan" },
  mexico: { name: "Mexico", nation: "Mexico" },
  nigeria: { name: "Nigeria", nation: "Nigeria" },
  paraguay: { name: "Paraguay", nation: "Paraguay" },
  poland: { name: "Poland", nation: "Poland" },
  portugal: { name: "Portugal", nation: "Portugal" },
  russia: { name: "Russia", nation: "Russia" },
  saudiarabia: { name: "Saudi Arabia", nation: "Saudi Arabia" },
  senegal: { name: "Senegal", nation: "Senegal" },
  slovenia: { name: "Slovenia", nation: "Slovenia" },
  southafrica: { name: "South Africa", nation: "South Africa" },
  southkorea: { name: "South Korea", nation: "South Korea" },
  spain: { name: "Spain", nation: "Spain" },
  sweden: { name: "Sweden", nation: "Sweden" },
  tunisia: { name: "Tunisia", nation: "Tunisia" },
  turkey: { name: "Turkey", nation: "Turkey" },
  unitedstates: { name: "United States", nation: "United States" },
  uruguay: { name: "Uruguay", nation: "Uruguay" },
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
  wc2002: {
    key: "wc2002",
    label: "2002 FIFA World Cup",
    shortLabel: "World Cup 02",
    database: "cm0102_vanilla_original",
    replacementLabel: {
      A: "France", B: "Slovenia", C: "China PR", D: "Poland",
      E: "Saudi Arabia", F: "Nigeria", G: "Ecuador", H: "Tunisia",
    },
    groups: {
      A: { replace: "france", teams: ["denmark", "senegal", "uruguay", "france"] },
      B: { replace: "slovenia", teams: ["spain", "paraguay", "southafrica", "slovenia"] },
      C: { replace: "china", teams: ["brazil", "turkey", "costarica", "china"] },
      D: { replace: "poland", teams: ["southkorea", "unitedstates", "portugal", "poland"] },
      E: { replace: "saudiarabia", teams: ["germany", "ireland", "cameroon", "saudiarabia"] },
      F: { replace: "nigeria", teams: ["sweden", "england", "argentina", "nigeria"] },
      G: { replace: "ecuador", teams: ["mexico", "italy", "croatia", "ecuador"] },
      H: { replace: "tunisia", teams: ["japan", "belgium", "russia", "tunisia"] },
    },
    seeds: {
      A1: "denmark", A2: "senegal", B1: "spain", B2: "paraguay",
      C1: "brazil", C2: "turkey", D1: "southkorea", D2: "unitedstates",
      E1: "germany", E2: "ireland", F1: "sweden", F2: "england",
      G1: "mexico", G2: "italy", H1: "japan", H2: "belgium",
    },
    entryPairs: [
      ["E1", "B2"], ["G1", "D2"], ["B1", "E2"], ["D1", "G2"],
      ["A1", "F2"], ["C1", "H2"], ["F1", "A2"], ["H1", "C2"],
    ],
    stages: ["Round of 16", "Quarter-final", "Semi-final", "Final"],
    finalVenue: "Yokohama",
  },
};

const TITAN_OPPONENTS = [
  {
    key: "titan-brazil-2002",
    name: "2002 Brazil NT",
    shortName: "Brazil 2002",
    database: "cm0102_vanilla_original",
    filter: { nation: "Brazil" },
    players: [
      ["marcos"],
      ["lucio"],
      ["edmilson"],
      ["roque junior"],
      ["cafu"],
      ["gilberto silva", "gilberto"],
      {
        legacyCanonicalId: "23678",
        canonicalPublicId: "player_kleberson_brazil_1979",
        aliases: ["Kléberson", "kleberson"],
      },
      ["roberto carlos"],
      ["ronaldinho"],
      ["rivaldo"],
      ["ronaldo"],
    ],
  },
  {
    key: "titan-france-2000",
    name: "2000 France NT",
    shortName: "France 2000",
    database: "cm0001_vanilla_original",
    filter: { nation: "France" },
    players: [
      ["fabien barthez", "barthez"],
      ["lilian thuram", "thuram"],
      ["marcel desailly", "desailly"],
      ["laurent blanc", "blanc"],
      ["bixente lizarazu", "lizarazu"],
      ["patrick vieira", "vieira"],
      ["didier deschamps", "deschamps"],
      ["youri djorkaeff", "djorkaeff"],
      ["zinedine zidane", "zidane"],
      ["thierry henry", "henry"],
      ["christophe dugarry", "dugarry"],
    ],
  },
  {
    key: "titan-real-2000",
    name: "2000 Real Madrid",
    shortName: "Real Madrid 2000",
    database: "cm9900_vanilla_original",
    filter: { club: "Real Madrid C.F." },
    players: [
      ["iker casillas", "casillas"],
      ["michel salgado", "salgado"],
      ["aitor karanka", "karanka"],
      ["ivan helguera", "helguera"],
      ["roberto carlos"],
      ["steve mcmanaman", "mcmanaman"],
      ["fernando redondo", "redondo"],
      ["ivan campo", "campo"],
      ["raul"],
      ["fernando morientes", "morientes"],
      ["nicolas anelka", "anelka"],
    ],
  },
  {
    key: "titan-united-1999",
    name: "1999 Manchester United",
    shortName: "Manchester United 1999",
    database: "cm9899_vanilla_original",
    filter: { club: "Manchester United" },
    players: [
      ["peter schmeichel", "schmeichel"],
      ["gary neville"],
      ["ronny johnsen"],
      ["jaap stam", "stam"],
      ["denis irwin", "irwin"],
      ["ryan giggs", "giggs"],
      ["david beckham", "beckham"],
      ["nicky butt", "butt"],
      ["jesper blomqvist", "blomqvist"],
      ["dwight yorke", "yorke"],
      ["andy cole"],
    ],
  },
  {
    key: "titan-real-2002",
    name: "2002 Real Madrid",
    shortName: "Real Madrid 2002",
    database: "cm0102_vanilla_original",
    filter: { club: "Real Madrid C.F." },
    players: [
      ["cesar"],
      ["michel salgado", "salgado"],
      ["fernando hierro", "hierro"],
      ["ivan helguera", "helguera"],
      ["roberto carlos"],
      ["claude makelele", "makelele"],
      ["luis figo", "figo"],
      ["santiago solari", "solari"],
      ["zinedine zidane", "zidane"],
      ["raul"],
      ["fernando morientes", "morientes"],
    ],
  },
  {
    key: "titan-portugal-2004",
    name: "2004 Portugal NT",
    shortName: "Portugal 2004",
    database: "cm0304_vanilla_original",
    filter: { nation: "Portugal" },
    players: [
      ["ricardo"],
      ["miguel"],
      ["jorge andrade"],
      ["ricardo carvalho"],
      ["nuno valente"],
      ["maniche"],
      ["costinha"],
      ["cristiano ronaldo"],
      ["deco"],
      ["luis figo", "figo"],
      ["pauleta"],
    ],
  },
  {
    key: "titan-liverpool-2001",
    name: "2001 Liverpool",
    shortName: "Liverpool 2001",
    database: "cm0102_vanilla_original",
    filter: { club: "Liverpool" },
    players: [
      ["sander westerveld", "westerveld"],
      ["markus babbel", "babbel"],
      ["sami hyypia", "hyypia"],
      ["stephane henchoz", "henchoz"],
      ["jamie carragher", "carragher"],
      ["gary mcallister", "mcallister"],
      ["steven gerrard", "gerrard"],
      ["dietmar hamann", "hamann"],
      ["john arne riise", "riise"],
      ["emile heskey", "heskey"],
      ["michael owen", "owen"],
    ],
  },
  {
    key: "titan-lazio-1999",
    name: "1999 Lazio",
    shortName: "Lazio 1999",
    database: "cm9900_vanilla_original",
    filter: { club: "Lazio" },
    players: [
      ["luca marchegiani", "marchegiani"],
      ["paolo negro", "negro"],
      ["alessandro nesta", "nesta"],
      ["sinisa mihajlovic", "mihajlovic"],
      ["giuseppe pancaro", "pancaro"],
      ["dejan stankovic", "stankovic"],
      {
        legacyCanonicalId: "81217",
        canonicalPublicId: "player_juan_sebastian_veron_argentina_1975",
        aliases: ["Juan Sebastián Verón", "veron"],
      },
      ["matias almeyda", "almeyda"],
      ["pavel nedved", "nedved"],
      ["roberto mancini", "mancini"],
      ["simone inzaghi", "inzaghi"],
    ],
  },
];
const TITAN_BY_KEY = new Map(
  TITAN_OPPONENTS.map((opponent) => [opponent.key, opponent]),
);

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
  tablePanel: document.querySelector("#runTablePanel"),
  resultCard: document.querySelector("#runResultCard"),
  recordsPanel: document.querySelector("#runRecordsPanel"),
  recordsClose: document.querySelector("#runRecordsClose"),
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

function friendSessionFromPage() {
  const read = (params) => {
    const session = {
      code: String(params?.get("room") || "").toUpperCase(),
      token: params?.get("token") || "",
      role: params?.get("role") === "host" ? "host" : "guest",
      name: sessionStorage.getItem("retroball-friend-name") || "Manager",
    };
    return /^[A-HJ-NP-Z2-9]{6}$/.test(session.code) &&
      /^[A-Za-z0-9_-]{32}$/.test(session.token) ? session : null;
  };
  const fromHash = read(new URLSearchParams(window.location.hash.replace(/^#/, "")));
  if (fromHash) return fromHash;
  try {
    const stored = JSON.parse(sessionStorage.getItem(FRIEND_SESSION_KEY) || "null");
    return stored ? read(new URLSearchParams(stored)) : null;
  } catch {
    return null;
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

function seededShuffle(items, seed) {
  const random = seededRandom(seed);
  const shuffled = items.slice();
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
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

const friendSession = friendSessionFromPage();
const isFriendMatch = Boolean(friendSession);
const draftedTeam = readJsonStorage(TEAM_STORAGE_KEY, null);
let team = draftedTeam;
let sharedSquad = createDraftSquad(team);
let runSeed = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const isTitanFight = !isFriendMatch && team?.mode === "Titan Fight";
let friendOpponentName = "Opponent XI";
const scenario = SCENARIOS[team?.scenario] || SCENARIOS.ucl0304;
const titanOrder = isTitanFight
  ? seededShuffle(
      TITAN_OPPONENTS.map((opponent) => opponent.key),
      hashString(`${runSeed}:titan-order`),
    )
  : [];
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
  phase: isTitanFight ? "titan" : "group",
  titanIndex: 0,
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
  return key === "user"
    ? team.teamName
    : key === "friend-guest"
      ? friendOpponentName
      : TITAN_BY_KEY.get(key)?.name || CLUBS[key]?.name || NATIONS[key]?.name || key;
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
  const titan = TITAN_BY_KEY.get(key);
  const database = titan?.database || scenario.database;
  const cacheKey = `${database}:${key}`;
  if (rosterMemory.has(cacheKey)) return rosterMemory.get(cacheKey);
  if (Array.isArray(opponentCache[cacheKey]) && opponentCache[cacheKey].length) {
    const cached = validRoster(opponentCache[cacheKey]);
    rosterMemory.set(cacheKey, cached);
    return cached;
  }

  if (titan) {
    const response = await searchPlayers({
      database,
      q: "",
      ...titan.filter,
      pageSize: 100,
    });
    const available = response.items.slice();
    const selected = [];
    const normalize = (value) =>
      String(value || "")
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLocaleLowerCase("en-US")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();
    const matchesPlayerSpec = (player, playerSpec) => {
      const aliases = Array.isArray(playerSpec)
        ? playerSpec
        : playerSpec.aliases;
      const canonicalPublicId = Array.isArray(playerSpec)
        ? ""
        : String(playerSpec.canonicalPublicId || "");
      const returnedCanonicalPublicId = String(
        player.canonical_player_public_id || "",
      );
      if (canonicalPublicId && returnedCanonicalPublicId) {
        return returnedCanonicalPublicId === canonicalPublicId;
      }
      const normalizedAliases = aliases.map(normalize);
      const names = [
        playerName(player),
        player.display_name,
        player.full_name,
        player.common_name,
        player.canonical_player_name,
      ]
        .map(normalize)
        .filter(Boolean);
      return normalizedAliases.some((alias) =>
        names.some((name) => name === alias || name.endsWith(` ${alias}`)),
      );
    };
    for (const playerSpec of titan.players) {
      const aliases = Array.isArray(playerSpec)
        ? playerSpec
        : playerSpec.aliases;
      let index = available.findIndex((player) =>
        matchesPlayerSpec(player, playerSpec),
      );
      if (index >= 0) {
        selected.push(available.splice(index, 1)[0]);
        continue;
      }
      const used = new Set(selected.map(playerIdentity));
      const fallbackDatabases = [
        database,
        "cm0304_vanilla_original",
        "cm0203_vanilla_original",
        "cm0102_vanilla_original",
        "cm0001_vanilla_original",
        "cm9900_vanilla_original",
        "cm9899_vanilla_original",
      ].filter(
        (item, databaseIndex, items) => items.indexOf(item) === databaseIndex,
      );
      let player = null;
      for (const fallbackDatabase of fallbackDatabases) {
        const fallback = await searchPlayers({
          database: fallbackDatabase,
          q: aliases[0],
          pageSize: 12,
        });
        player = fallback.items.find(
          (item) =>
            matchesPlayerSpec(item, playerSpec) &&
            !used.has(playerIdentity(item)),
        );
        if (player) break;
      }
      if (!player) {
        throw new Error(
          `Could not load ${titan.shortName}: ${aliases[0]} is missing from the database set.`,
        );
      }
      selected.push(player);
    }
    const roster = validRoster(selected);
    rosterMemory.set(cacheKey, roster);
    opponentCache[cacheKey] = roster;
    writeJsonStorage(OPPONENT_CACHE_KEY, opponentCache);
    return roster;
  }

  const club = CLUBS[key];
  const nation = NATIONS[key];
  if (!club && !nation) throw new Error(`Unknown opponent: ${key}.`);
  const response = club
    ? await searchPlayers({
        database: scenario.database,
        q: "",
        club: scenario.key === "ucl0203" && club.club0203 ? club.club0203 : club.club,
        pageSize: 60,
      })
    : await searchPlayers({
        database: scenario.database,
        q: "",
        nation: nation.nation,
        pageSize: 50,
      });
  const roster = validRoster(response.items);
  if (!roster.length) {
    throw new Error(`No ${scenario.shortLabel} players found for ${(club || nation).name}.`);
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
  return players.map((player) => {
    const merged = {
      ...player,
      ...(playerMetricCache.get(playerIdentity(player)) || {}),
      role: player.role,
      line: player.line,
      overall: player.overall,
      isCaptain: player.isCaptain,
    };
    const rng = seededRandom(hashString(`${runSeed}:attr-gen:${playerIdentity(player)}`));
    merged.attributes = fillZeroAttributes(
      merged.attributes,
      merged.position_text,
      merged.current_ability,
      rng,
    );
    const targetAbility = Number(merged.generatedTargetAbility);
    if (Number.isFinite(targetAbility) && targetAbility > Number(merged.current_ability)) {
      merged.attributes = boostAttributesTowardAbility(
        merged.attributes,
        merged.position_text,
        merged.current_ability,
        targetAbility,
        rng,
      );
      merged.current_ability = Math.round(targetAbility);
    }
    return merged;
  });
}

function opponentOverall(roster) {
  return Math.round(teamModel(roster).overall);
}

function playersForTeam(sourceTeam) {
  return sourceTeam.players.map((entry) => {
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

function userPlayers() {
  return playersForTeam(team);
}

function visibleSquadRatings(sourceTeam = team) {
  const entries = sourceTeam.players.map((entry) => ({
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

function finesseLongShotScore(player) {
  const attributes = average([
    playerAttribute(player, "Technique"),
    playerAttribute(player, "Long Shots", "Shooting"),
    playerAttribute(player, "Finishing", "Shooting"),
    playerAttribute(player, "Composure"),
  ]) * 5;
  return clamp(25, 99, attributes * 0.82 + playerAbility(player) * 0.18);
}

function deliveryScore(player) {
  const attributes = average([
    playerAttribute(player, "Passing"),
    playerAttribute(player, "Vision"),
    playerAttribute(player, "Creativity"),
    playerAttribute(player, "Technique"),
    playerAttribute(player, "Decisions"),
  ]) * 5;
  return clamp(25, 99, attributes * 0.82 + playerAbility(player) * 0.18);
}

function offBallRunScore(player) {
  const attributes = average([
    playerAttribute(player, "Off the Ball"),
    playerAttribute(player, "Anticipation"),
    playerAttribute(player, "Acceleration"),
    playerAttribute(player, "First Touch"),
    playerAttribute(player, "Finishing", "Shooting"),
  ]) * 5;
  return clamp(25, 99, attributes * 0.84 + playerAbility(player) * 0.16);
}

function keeperDribbleScore(player) {
  const attributes = average([
    playerAttribute(player, "Dribbling"),
    playerAttribute(player, "Technique"),
    playerAttribute(player, "Flair"),
    playerAttribute(player, "Composure"),
    playerAttribute(player, "Acceleration"),
  ]) * 5;
  return clamp(25, 99, attributes * 0.84 + playerAbility(player) * 0.16);
}

function chipScore(player) {
  const attributes = average([
    playerAttribute(player, "Technique"),
    playerAttribute(player, "Composure"),
    playerAttribute(player, "Vision"),
    playerAttribute(player, "First Touch"),
  ]) * 5;
  return clamp(25, 99, attributes * 0.82 + playerAbility(player) * 0.18);
}

function switchPlayScore(player) {
  const attributes = average([
    playerAttribute(player, "Passing"),
    playerAttribute(player, "Vision"),
    playerAttribute(player, "Technique"),
    playerAttribute(player, "Creativity"),
    playerAttribute(player, "Decisions"),
  ]) * 5;
  return clamp(25, 99, attributes * 0.86 + playerAbility(player) * 0.14);
}

function lateBoxRunScore(player) {
  const attributes = average([
    playerAttribute(player, "Off the Ball"),
    playerAttribute(player, "Anticipation"),
    playerAttribute(player, "Finishing", "Shooting"),
    playerAttribute(player, "Long Shots", "Shooting"),
    playerAttribute(player, "Stamina"),
  ]) * 5;
  return clamp(25, 99, attributes * 0.84 + playerAbility(player) * 0.16);
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

function spatialAction(kind, actor, random, goalType = "") {
  const column = playerPreferredColumn(actor, random);
  const adjacentCenter = column === 1 ? (random() < 0.5 ? 0 : 2) : 1;
  if (kind === "goal") {
    if (["long-range", "finesse-long-range"].includes(goalType)) {
      return { from: 3 + column, to: 1, action: "shot", turnover: false };
    }
    if (["off-ball-run", "offside-break"].includes(goalType)) {
      return { from: 6 + column, to: 1, action: "through-ball", turnover: false };
    }
    if (goalType === "round-keeper") {
      return { from: 3 + column, to: 1, action: "dribble", turnover: false };
    }
    if (goalType === "chip") {
      return { from: 3 + column, to: 1, action: "chip", turnover: false };
    }
    if (goalType === "late-run") {
      return { from: 3 + column, to: 1, action: "late-run", turnover: false };
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
    "switch-play": { from: 6 + column, to: 3 + adjacentCenter, action: "switch-play", turnover: false },
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
    "switch-play": 1.18,
    tackle: 0.9,
    card: 1.25,
  }[kind] || 1;
}

function withSpatialMetadata(event, actor, random) {
  const spatial = spatialAction(event.kind, actor, random, event.goalType);
  const ability = Number(actor?.current_ability || 0);
  const signatureEligible = ability >= 180 && (
    event.goal || event.duelWon === true || ["chance", "through-ball", "counter"].includes(event.kind)
  );
  const signatureMoment = signatureEligible &&
    hashString(`${playerIdentity(actor)}:${event.matchSecond}:${event.kind}`) % 100 < 72;
  const signatureText = signatureMoment
    ? event.goal
      ? `${event.text} ${playerName(actor)} turns elite ability into an inevitable finish.`
      : `${event.text} ${playerName(actor)} bends the match to elite technique.`
    : event.text;
  return {
    ...event,
    text: signatureText,
    signatureMoment,
    starAbility: signatureMoment ? ability : null,
    zoneFrom: event.zoneFrom ?? spatial.from,
    zoneTo: event.zoneTo ?? spatial.to,
    action: event.action || spatial.action,
    possessionAfter: event.possessionAfter || (spatial.turnover
      ? event.side === "user" ? "opponent" : "user"
      : event.side),
    actionSeconds: Math.round(4 + random() * 8 * presentationWeight(event.kind)),
    presentationWeight: presentationWeight(event.kind) + (signatureMoment ? 0.35 : 0),
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
  } else if (["long-range", "finesse-long-range"].includes(goalType)) {
    const finesse = goalType === "finesse-long-range";
    scorer = context.scorer || pickScorer(
      finesse ? finesseLongShotScore : longRangeScore,
      "midfield",
    );
    const descriptions = [
      `lets fly from distance and gives ${playerName(keeper)} no chance`,
      `finds the top corner with a fierce long-range strike`,
      `takes aim from outside the box and rifles the ball past ${playerName(keeper)}`,
    ];
    text = finesse
      ? `${playerName(scorer)} opens the body outside the box and bends a sumptuous finesse shot beyond ${playerName(keeper)} into the far corner.`
      : `${playerName(scorer)} ${descriptions[Math.floor(random() * descriptions.length)]}.`;
  } else if (["off-ball-run", "offside-break"].includes(goalType)) {
    provider = context.provider || weightedPlayer(pool, random, "midfield", deliveryScore);
    scorer = context.scorer || pickScorer(offBallRunScore, "attack");
    const lineBreaker = context.defender ? playerName(context.defender) : "A defender";
    text = goalType === "offside-break"
      ? `${lineBreaker} breaks the defensive line, ${playerName(scorer)} anticipates it and races onto ${playerName(provider)}'s perfectly weighted pass before beating ${playerName(keeper)} one-on-one.`
      : `${playerName(scorer)} times an intelligent run beyond the defence and converts ${playerName(provider)}'s incisive delivery past ${playerName(keeper)}.`;
  } else if (goalType === "round-keeper") {
    provider = context.provider || null;
    scorer = context.scorer || pickScorer(keeperDribbleScore, "attack");
    text = `${playerName(scorer)} keeps the ball glued to the boot, commits ${playerName(keeper)}, dribbles around the goalkeeper and rolls it into the empty net.`;
  } else if (goalType === "chip") {
    provider = context.provider || null;
    scorer = context.scorer || pickScorer(chipScore, "attack");
    text = `${playerName(scorer)} sees ${playerName(keeper)} stray off his line and dinks a delicate chip over him, the ball dropping just under the bar.`;
  } else if (goalType === "late-run") {
    provider = context.provider || weightedPlayer(pool, random, "midfield", deliveryScore);
    scorer = context.scorer || pickScorer(lateBoxRunScore, "midfield");
    text = `${playerName(scorer)} arrives late and unseen in the box to meet ${playerName(provider)}'s delivery, steering the finish beyond ${playerName(keeper)}.`;
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
    text = context.reboundSource === "post"
      ? `The effort cannons back off the post, but ${playerName(scorer)} reacts faster than anyone to poke home the rebound.`
      : `A thunderous strike is parried by ${playerName(keeper)}, but ${playerName(scorer)} reacts faster than anyone to poke home the rebound.`;
  } else if (goalType === "cut-back") {
    provider = context.provider || weightedPlayer(pool, random, "", counterRunnerScore);
    scorer = context.scorer || weightedPlayer(pool, random, "attack", firstTouchFinishScore);
    text = `Brilliant pace down the flank! ${playerName(provider)} hits the byline, pulls it back across goal, and ${playerName(scorer)} arrives perfectly to sweep it in.`;
  } else if (goalType === "set-piece-scramble") {
    scorer = context.defender || weightedPlayer(opponentPool, random, "defence", defenderScore);
    actorSide = spec.side === "user" ? "opponent" : "user";
    goalCredit = false;
    text = `Absolute chaos in the six-yard box—${playerName(scorer)} inadvertently deflects the set piece past ${playerName(keeper)} under immense pressure.`;
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
    moraleUser: spec.moraleUser,
    moraleOpponent: spec.moraleOpponent,
    manDownUser: spec.manDownUser,
    manDownOpponent: spec.manDownOpponent,
    scorer: playerName(scorer),
    scorerPlayer: playerReference(scorer),
    provider: provider ? playerName(provider) : "",
    providerPlayer: provider ? playerReference(provider) : null,
    defender: context.defender ? playerName(context.defender) : "",
    defenderPlayer: context.defender ? playerReference(context.defender) : null,
    scenarioType: context.scenarioType || goalType,
    defensiveError: context.defensiveError || "",
    zoneFrom: context.zoneFrom,
    zoneTo: context.zoneTo,
    action: context.action,
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
  let pinnedNextActor = null;
  let allInSide = "";
  let pressureSide = side;
  let pressureTicks = 0;
  const morale = { user: 0, opponent: 0 };
  const manDown = { user: false, opponent: false };
  const moraleMultiplier = (moraleSide) =>
    clamp(0.85, 1.15, 1 + morale[moraleSide] * 0.035);

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
    moraleUser: morale.user,
    moraleOpponent: morale.opponent,
    manDownUser: manDown.user,
    manDownOpponent: manDown.opponent,
  });
  const resetFromKickoff = (kickoffSide) => {
    side = kickoffSide;
    zone = 6 + Math.floor(random() * 3);
    counterSteps = 0;
    pinnedNextActor = null;
  };
  const addGoal = (goalType, players, opponents, context = {}) => {
    const goal = goalEvent(
      { ...moment(), kind: "goal" },
      players,
      opponents,
      random,
      goalType,
      context,
    );
    if (allInSide) {
      goal.allIn = true;
      goal.tacticalRiskSide = allInSide;
      goal.text += side === allInSide
        ? " The trailing side's all-out attack finally breaks through."
        : " The all-out attack is punished by a ruthless counter.";
    }
    events.push(goal);
    traceScenario({
      minute: goal.minute, side: goal.side, zone: context.zoneFrom ?? null,
      scenario: context.scenarioType || goalType, outcome: "GOAL",
    });
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
    provider = null,
    scenarioType = "",
    defensiveError = "",
  }) => {
    const event = withSpatialMetadata({
      ...moment(),
      kind,
      goal: false,
      duelWon: duel?.won ?? null,
      duelProbability: duel ? Number(duel.probability.toFixed(3)) : null,
      actorCondition: duel ? Number(duel.attackerCondition.toFixed(3)) : null,
      defenderCondition: duel ? Number(duel.defenderCondition.toFixed(3)) : null,
      defender: defender ? playerName(defender) : "",
      defenderPlayer: defender ? playerReference(defender) : null,
      provider: provider ? playerName(provider) : "",
      providerPlayer: provider ? playerReference(provider) : null,
      scenarioType,
      defensiveError,
      zoneFrom: from,
      zoneTo: to,
      bypassedZone,
      action,
      possessionAfter: possession,
      scorer: playerName(actor),
      scorerPlayer: playerReference(actor),
      text,
    }, actor, random);
    events.push(event);
    highlightCount += 1;
    traceScenario({
      minute: event.minute, side: event.side, zone: from ?? null,
      scenario: scenarioType || kind, outcome: kind,
    });
  };

  for (let tick = 0; tick < maxTicks && matchSecond < lastSecond; tick += 1) {
    matchSecond = Math.min(lastSecond, matchSecond + 28 + Math.floor(random() * 58));
    const minute = matchSecond / 60;
    if (minute >= 85) {
      const userGoals = events.filter((event) => event.goal && event.side === "user").length;
      const opponentGoals = events.filter((event) => event.goal && event.side === "opponent").length;
      allInSide = userGoals === opponentGoals
        ? ""
        : userGoals < opponentGoals ? "user" : "opponent";
      if (allInSide && side !== allInSide && random() < 0.42) {
        side = allInSide;
        zone = 3 + Math.floor(random() * 3);
        counterSteps = 0;
      }
    } else {
      allInSide = "";
    }
    if (side === pressureSide) pressureTicks += 1;
    else {
      pressureSide = side;
      pressureTicks = 1;
    }
    const players = active(side);
    const opponents = active(opposite(side));
    if (!players.length || !opponents.length) break;
    const attackingPool = outfield(players).length ? outfield(players) : players;
    const defendingPool = outfield(opponents).length ? outfield(opponents) : opponents;
    const row = Math.floor(zone / 3);
    const column = zone % 3;
    const preferredLine = row >= 3 ? "defence" : row === 2 ? "midfield" : "attack";
    const transitionScore = row >= 2
      ? bypassScore
      : row === 1 || (row === 0 && column !== 1)
        ? counterRunnerScore
        : attackerScore;
    // A receiver picked at the end of the previous tick (see the
    // transitionDuel.won branch below) takes priority over a fresh generic
    // roll -- this is what makes a good off-ball mover actually show up as
    // the next ball carrier more often, rather than every tick re-rolling
    // from scratch with no memory of who the pass just found.
    const actor = (pinnedNextActor && attackingPool.includes(pinnedNextActor))
      ? pinnedNextActor
      : weightedPlayer(attackingPool, random, preferredLine, (player) =>
          conditionedScore(player, transitionScore, minute));
    pinnedNextActor = null;
    const defender = defenderForColumn(defendingPool, column, minute, random);
    const keeper = goalkeeper(opponents);
    const pressure = computePressure(defender, zone, counterSteps);
    const shotChance = (shooter, targetKeeper, atMinute, baseChance, score = attackerScore) => {
      const tacticalMultiplier = !allInSide
        ? 1
        : side === allInSide ? 1.4 : 1.28;
      const momentumMultiplier = pressureTicks >= 3
        ? 1 + Math.min(0.2, (pressureTicks - 2) * 0.045)
        : 1;
      const manDownMultiplier = manDown[opposite(side)]
        ? 1.16
        : manDown[side] ? 0.92 : 1;
      return clamp(
        0.008,
        0.46,
        transitionShotChance(shooter, targetKeeper, atMinute, baseChance, score)
          * tacticalMultiplier * momentumMultiplier * manDownMultiplier * moraleMultiplier(side),
      );
    };

    // Foul/Discipline (see MATCH_ENGINE_SCENARIOS.md). Shared by both the
    // D.* tackle-engagement tail below and K.ONEONONE.6 in the shot
    // resolution -- a fouled breakaway is treated as an automatic last-man
    // situation via forcedLastMan, same as the design doc specifies.
    const applyFoulOutcome = (fouler, engagementLabel, forcedLastMan = false) => {
      // A genuine last-man situation -- clear run at goal, this defender is
      // the only cover left -- should be rare, not "any foul during a
      // decent spell of momentum." Gated by zone and an extra roll on top
      // of the momentum proxy so it doesn't fire on most counterSteps>=2 fouls.
      const isLastMan = forcedLastMan
        || (Math.floor(zone / 3) === 0 && counterSteps >= 3 && random() < 0.08);
      const foul = resolveFoul(fouler, engagementLabel, zone, isLastMan, minute, random);
      const cardedSide = opposite(side);

      if (foul.card !== "none") {
        const identity = `${cardedSide}:${playerIdentity(fouler)}`;
        const previousYellow = yellows.get(identity) || 0;
        const finalCard = foul.card === "yellow" && previousYellow === 1 ? "red" : foul.card;
        if (finalCard === "red") {
          sentOff.add(identity);
          manDown[cardedSide] = true;
          morale[cardedSide] = clamp(-5, 5, morale[cardedSide] - 3);
        } else {
          yellows.set(identity, 1);
        }
        const cardEvent = withSpatialMetadata({
          ...moment(),
          side: cardedSide,
          actorSide: cardedSide,
          kind: "card",
          goal: false,
          card: finalCard,
          manDown: finalCard === "red",
          zoneFrom: MIRRORED_ZONE[zone],
          zoneTo: MIRRORED_ZONE[zone],
          possessionAfter: side,
          scorer: playerName(fouler),
          scorerPlayer: playerReference(fouler),
          scenarioType: isLastMan ? "foul-last-man" : `foul-${engagementLabel}`,
          text: isLastMan
            ? `${playerName(fouler)} is shown a straight red card for denying a clear goalscoring chance.`
            : finalCard === "red"
              ? (previousYellow === 1
                ? `${playerName(fouler)} receives a second yellow and is sent off.`
                : `${playerName(fouler)} is shown a straight red card for a reckless challenge.`)
              : `${playerName(fouler)} is booked for the foul.`,
        }, fouler, random);
        if (finalCard === "red") {
          cardEvent.text += ` Down to ten men, the side drops deeper and looks to hold its shape.`;
        }
        events.push(cardEvent);
        traceScenario({
          minute: cardEvent.minute, side: cardEvent.side, zone: MIRRORED_ZONE[zone] ?? null,
          scenario: cardEvent.scenarioType, outcome: `CARD.${finalCard.toUpperCase()}`,
        });
      }

      if (foul.restart === "penalty") {
        const taker = strongest(attackingPool, (player) => playerAttribute(player, "Penalty Taking"), 1)[0]
          || attackingPool[0];
        const penalty = resolvePenaltyKick(taker, keeper, minute, random);
        if (penalty.goal) {
          addGoal("penalty", players, opponents, {
            scorer: taker, zoneFrom: 1, zoneTo: 1, action: "penalty",
          });
          return;
        }
        if (highlightCount < highlightLimit) {
          addDuelEvent({
            kind: "chance", actor: taker, defender: keeper, duel: null,
            from: 1, to: 1, action: "penalty", possession: opposite(side),
            text: `${playerName(taker)} steps up to take the penalty, but ${playerName(keeper)} guesses right and keeps it out.`,
          });
        }
        side = opposite(side);
        zone = 7;
        counterSteps = 0;
        return;
      }

      // row<=1 possessions almost always resolve through a shot/cross
      // attempt before a duel can even fail for the attacker (wideByline/
      // X1/lateRunners/F.SELECT all fire first and continue), so most real
      // fouls actually land at row 2 -- widened from the original row<=1
      // free-kick gate so this machinery is actually reachable, not just
      // correct in isolation. Row 2 is a plausible real long-range/deep
      // free-kick zone anyway, just weighted away from shooting.
      if (foul.restart === "free-kick" && row <= 2 && random() < 0.46) {
        // FK.SELECT -- shoot / cross / short (see MATCH_ENGINE_SCENARIOS.md),
        // weighted by zone (closer+central favors shooting) and the taker's
        // Free Kick Taking (a poor specialist shifts weight to the short
        // option even from a good position).
        const taker = setPieceTaker(players, "free-kick");
        const freeKickTaking = playerAttribute(taker, "Free Kick Taking", "Set Pieces");
        const zoneShootBias = row === 2 ? 0.35 : column === 1 ? (row === 0 ? 3 : 1.5) : 0.4;
        const selection = weightedChoice([
          { value: "shoot", weight: freeKickTaking * zoneShootBias },
          { value: "cross", weight: column !== 1 ? 10 : 4 },
          { value: "short", weight: 6 },
        ], random);

        if (selection === "short") {
          const receivers = attackingPool.filter((player) => player !== taker);
          pinnedNextActor = selectReceiver(
            receivers, zone, playerAttribute(taker, "Vision"), 0.2, random,
          ) || taker;
          return;
        }

        if (selection === "cross") {
          // FK.SELECT.CROSS merges into DELIVERY.* -- same mechanism as a
          // corner, just weighted toward Crossing rather than Corners since
          // it's mechanically an open-play cross taken from a dead ball.
          const deliveryTarget = weightedPlayer(attackingPool, random, "attack", (player) =>
            conditionedScore(player, headerScore, minute));
          const marker = defenderForColumn(defendingPool, 1, minute, random);
          const delivery = resolveDelivery(deliveryTarget, marker, keeper, minute, random, 1);
          if (delivery.goal) {
            addGoal(delivery.code === "DELIVERY.INSWING.GHOST" ? "set-piece-scramble" : "free-kick-cross", players, opponents, {
              provider: taker, scorer: deliveryTarget, zoneFrom: 1, zoneTo: 1, action: "free-kick",
            });
            return;
          }
          if (!delivery.rebound) {
            if (delivery.code === "K.SAVE.3" || delivery.code === "K.SAVE.7") {
              awardCorner();
              return;
            }
            side = opposite(side);
            zone = delivery.throughUntouched ? 6 + Math.floor(random() * 3) : 7;
            return;
          }
          const poacher = weightedPlayer(attackingPool, random, "attack", (player) =>
            conditionedScore(player, poacherScore, minute));
          const reboundDefender = defenderForColumn(defendingPool, 1, minute, random);
          const reboundDuel = localizedDuel(
            poacher, reboundDefender,
            ["Anticipation", "Acceleration", "Off the Ball"],
            ["Positioning", "Anticipation", "Strength"],
            minute, random, 1,
          );
          if (reboundDuel.won && random() < shotChance(poacher, keeper, minute, 0.32, poacherScore)) {
            addGoal("rebound", players, opponents, {
              scorer: poacher, reboundSource: delivery.code === "K.SAVE.6" ? "post" : "save",
            });
            return;
          }
          side = opposite(side);
          zone = 7;
          return;
        }

        // FK.SHOT -- dead-ball shooting uses its own attribute weighting,
        // not F.SELECT's, plus FK.WALL, a new mechanic: does it even get
        // past the wall before the keeper is involved at all.
        const wallDefenders = defendingPool.filter((player) => !isGoalkeeper(player)).slice(0, 3);
        const wall = resolveWall(taker, wallDefenders, random);
        if (wall.hit) {
          if (wall.outcome === "out") {
            if (highlightCount < highlightLimit) {
              addDuelEvent({
                kind: "chance", actor: taker, defender: null, duel: null,
                from: 1, to: 1, action: "free-kick", possession: opposite(side),
                scenarioType: wall.code,
                text: `${playerName(taker)}'s effort cannons off the wall and away for a corner.`,
              });
            }
            awardCorner();
            return;
          }
          if (wall.outcome === "deflect") {
            if (random() < 0.55) {
              addGoal("direct-free-kick", players, opponents, { scorer: taker, scenarioType: "FK.WALL.HIT" });
              return;
            }
            if (highlightCount < highlightLimit) {
              addDuelEvent({
                kind: "chance", actor: taker, defender: null, duel: null,
                from: 1, to: 1, action: "free-kick", possession: opposite(side),
                scenarioType: wall.code,
                text: `The effort takes a wicked deflection off the wall, wrongfooting everyone, but it drifts just wide.`,
              });
            }
            side = opposite(side);
            zone = 7;
            return;
          }
          // "loose"
          const poacher = weightedPlayer(attackingPool, random, "attack", (player) =>
            conditionedScore(player, poacherScore, minute));
          const wallDefender = wallDefenders[0] || defenderForColumn(defendingPool, 1, minute, random);
          const looseDuel = contestedRace(poacher, wallDefender, minute, random, 1);
          if (highlightCount < highlightLimit) {
            addDuelEvent({
              kind: "chance", actor: poacher, defender: wallDefender, duel: looseDuel,
              from: 1, to: 1, action: "free-kick", possession: looseDuel.won ? side : opposite(side),
              scenarioType: wall.code,
              text: looseDuel.won
                ? `${playerName(taker)}'s effort cannons off the wall and ${playerName(poacher)} pounces on the loose ball.`
                : `${playerName(taker)}'s effort cannons off the wall, but ${playerName(wallDefender)} clears the danger.`,
            });
          }
          if (!looseDuel.won) {
            side = opposite(side);
            zone = 7;
          }
          return;
        }

        const shotType = selectFreeKickShotType(taker, random);
        const attempt = resolveFreeKickAttempt(shotType, taker, random);
        if (!attempt.onTarget) {
          if (highlightCount < highlightLimit) {
            addDuelEvent({
              kind: "chance", actor: taker, defender: null, duel: null,
              from: 1, to: 1, action: "free-kick", possession: opposite(side),
              scenarioType: attempt.code,
              text: `${playerName(taker)}'s free kick doesn't trouble ${playerName(keeper)}.`,
            });
          }
          side = opposite(side);
          zone = 7;
          return;
        }
        const keeperFinishType = { regular: "calm", hard: "blast", curl: "finesse" }[shotType] || "calm";
        const save = resolveKeeperSave(taker, keeper, keeperFinishType, minute, random, 1);
        if (save.goal) {
          addGoal("direct-free-kick", players, opponents, { scorer: taker, scenarioType: save.code });
          return;
        }
        if (!save.rebound) {
          if (save.code === "K.SAVE.3" || save.code === "K.SAVE.7") {
            awardCorner();
            return;
          }
          side = opposite(side);
          zone = 7;
          return;
        }
        const poacher = weightedPlayer(attackingPool, random, "attack", (player) =>
          conditionedScore(player, poacherScore, minute));
        const reboundDefender = defenderForColumn(defendingPool, 1, minute, random);
        const reboundDuel = localizedDuel(
          poacher, reboundDefender,
          ["Anticipation", "Acceleration", "Off the Ball"],
          ["Positioning", "Anticipation", "Strength"],
          minute, random, 1,
        );
        if (reboundDuel.won && random() < shotChance(poacher, keeper, minute, 0.32, poacherScore)) {
          addGoal("rebound", players, opponents, {
            scorer: poacher, reboundSource: save.code === "K.SAVE.6" ? "post" : "save",
          });
          return;
        }
        side = opposite(side);
        zone = 7;
        return;
      }
      // Advantage played, or a free kick that didn't produce a direct
      // chance -- the attacking side simply keeps the ball from here.
    };

    // Corner-kick delivery (see MATCH_ENGINE_SCENARIOS.md, DELIVERY.*).
    // Called from wherever a shot/header ends up "tipped behind" or "off
    // the post and out" (K.SAVE.3/.7) instead of just resetting possession
    // -- the attacking side actually gets the corner it just earned, rather
    // than that outcome being cosmetic text with no real follow-up.
    const awardCorner = () => {
      const taker = setPieceTaker(players, "corner");
      if (selectDeliveryChoice(taker, "Corners", random) === "short") {
        const receivers = attackingPool.filter((player) => player !== taker);
        pinnedNextActor = selectReceiver(
          receivers, 1, playerAttribute(taker, "Vision"), 0.3, random,
        ) || taker;
        zone = 1;
        return;
      }
      const target = weightedPlayer(attackingPool, random, "attack", (player) =>
        conditionedScore(player, headerScore, minute));
      const marker = defenderForColumn(defendingPool, 1, minute, random);
      const delivery = resolveDelivery(target, marker, keeper, minute, random, 1);
      if (delivery.goal) {
        addGoal(delivery.code === "DELIVERY.INSWING.GHOST" ? "set-piece-scramble" : "corner-header", players, opponents, {
          provider: taker, scorer: target, zoneFrom: 1, zoneTo: 1, action: "corner",
        });
        return;
      }
      const cornerText = {
        "DELIVERY.OUTSWING.THROUGH": `${playerName(taker)}'s outswinging corner drifts through everyone and away for a throw-in.`,
        "DELIVERY.CLEARED": `${playerName(marker)} climbs highest and heads ${playerName(taker)}'s corner clear.`,
        "F.HEADER.OFF": `${playerName(target)} gets up well, but the header drifts off target.`,
        "K.SAVE.1": `${playerName(target)}'s header is well struck, but ${playerName(keeper)} claims it.`,
        "K.SAVE.3": `${playerName(target)} glances it goalward and ${playerName(keeper)} tips it behind for another corner.`,
        "K.SAVE.4": `${playerName(keeper)} fumbles the header under pressure but recovers before anyone reacts.`,
        "K.SAVE.7": `${playerName(target)}'s header cannons off the post and away.`,
      }[delivery.code];
      if (!delivery.rebound) {
        if (highlightCount < highlightLimit) {
          addDuelEvent({
            kind: "cross", actor: taker, defender: marker, duel: null,
            from: column === 2 ? 2 : 0, to: 1, action: "corner", possession: opposite(side),
            scenarioType: delivery.code,
            text: cornerText || `${playerName(marker)} deals with the danger from the corner.`,
          });
        }
        side = opposite(side);
        zone = delivery.throughUntouched ? 6 + Math.floor(random() * 3) : 7;
        return;
      }
      const poacher = weightedPlayer(attackingPool, random, "attack", (player) =>
        conditionedScore(player, poacherScore, minute));
      const reboundDefender = defenderForColumn(defendingPool, 1, minute, random);
      const reboundDuel = localizedDuel(
        poacher, reboundDefender,
        ["Anticipation", "Acceleration", "Off the Ball"],
        ["Positioning", "Anticipation", "Strength"],
        minute, random, 1,
      );
      if (reboundDuel.won && random() < shotChance(poacher, keeper, minute, 0.32, poacherScore)) {
        addGoal("rebound", players, opponents, {
          scorer: poacher, reboundSource: delivery.code === "K.SAVE.6" ? "post" : "save",
        });
        return;
      }
      if (highlightCount < highlightLimit) {
        addDuelEvent({
          kind: "chance", actor: poacher, defender: reboundDefender, duel: reboundDuel,
          from: 1, to: 1, action: "rebound", possession: opposite(side),
          text: reboundDuel.won
            ? `${playerName(poacher)} reacts fastest from the corner but can't direct it goalward.`
            : `${playerName(reboundDefender)} reacts first and clears the corner-kick scramble.`,
        });
      }
      side = opposite(side);
      zone = 7;
    };

    // A side down to ten men holds its shape rather than committing men forward.
    const forwardRiskMultiplier = manDown[side] ? 0.5 : 1;

    if (row >= 2 && highlightCount < highlightLimit) {
      const switchCandidates = attackingPool.filter((player) =>
        isMidfielder(player) || isDefender(player));
      const switcher = weightedPlayer(
        switchCandidates.length ? switchCandidates : attackingPool,
        random,
        "midfield",
        (player) => conditionedScore(player, switchPlayScore, minute),
      );
      const switchQuality = switchPlayScore(switcher);
      const switchChance = clamp(0, 0.13, (switchQuality - 68) / 180) * forwardRiskMultiplier;
      if (switchQuality >= 74 && random() < switchChance) {
        const targetColumn = column === 0 ? 2 : column === 2 ? 0 : random() < 0.5 ? 0 : 2;
        const targetZone = Math.max(1, row - 1) * 3 + targetColumn;
        addDuelEvent({
          kind: "switch-play",
          actor: switcher,
          defender,
          duel: null,
          from: zone,
          to: targetZone,
          action: "switch-play",
          possession: side,
          scenarioType: "diagonal-switch",
          text: `${playerName(switcher)} looks one way and drills a diagonal switch into the opposite channel, suddenly turning the defence toward its own goal.`,
        });
        zone = targetZone;
        continue;
      }
    }

    if (row >= 2) {
      const runners = attackingPool.filter((player) =>
        !isDefender(player)
        && playerAttribute(player, "Off the Ball") > 15
        && playerAttribute(player, "Anticipation") >= 14);
      const runner = weightedPlayer(runners, random, "attack", (player) =>
        conditionedScore(player, offBallRunScore, minute));
      const providers = attackingPool.filter((player) => player !== runner);
      const provider = weightedPlayer(
        providers.length ? providers : attackingPool,
        random,
        "midfield",
        (player) => conditionedScore(player, deliveryScore, minute),
      );
      const lineDefenders = defendingPool.filter(isDefender);
      const lineDefender = (lineDefenders.length ? lineDefenders : defendingPool)
        .slice()
        .sort((left, right) =>
          playerAttribute(left, "Positioning") - playerAttribute(right, "Positioning"))[0];
      const providerQuality = deliveryScore(provider);
      const defenderPositioning = playerAttribute(lineDefender, "Positioning");
      const brokenLine = defenderPositioning < 14;
      const runChance = runner && provider && providerQuality >= 70
        ? clamp(
            0.008,
            0.11,
            0.012
              + Math.max(0, playerAttribute(runner, "Off the Ball") - 15) * 0.012
              + Math.max(0, providerQuality - 70) * 0.0022
              + Math.max(0, 14 - defenderPositioning) * 0.012,
          ) * forwardRiskMultiplier
        : 0;
      if (runner && lineDefender && random() < runChance) {
        const deliveryDuel = localizedDuel(
          provider,
          lineDefender,
          ["Passing", "Vision", "Creativity", "Technique", "Decisions"],
          ["Positioning", "Anticipation", "Decisions"],
          minute,
          random,
          zone,
        );
        if (deliveryDuel.won) {
          const dribbleKeeper = playerAttribute(runner, "Dribbling") >= 16
            && playerAttribute(runner, "Technique") >= 15
            && random() < 0.28;
          if (dribbleKeeper) {
            const keeperDuel = localizedDuel(
              runner,
              keeper,
              ["Dribbling", "Technique", "Flair", "Composure", "Acceleration"],
              ["One On Ones", "Reflexes", "Agility", "Anticipation"],
              minute,
              random,
              1,
            );
            if (keeperDuel.won
              && random() < shotChance(runner, keeper, minute, 0.42, keeperDribbleScore)) {
              addGoal("round-keeper", players, opponents, {
                provider,
                scorer: runner,
                defender: lineDefender,
                scenarioType: brokenLine ? "offside-break-keeper-dribble" : "off-ball-keeper-dribble",
                defensiveError: brokenLine ? "broken-offside-line" : "",
                zoneFrom: zone,
                zoneTo: 1,
                action: "dribble",
              });
              continue;
            }
          }
          const finishChance = shotChance(
            runner,
            keeper,
            minute,
            brokenLine ? 0.36 : 0.28,
            offBallRunScore,
          );
          if (random() < finishChance) {
            addGoal(brokenLine ? "offside-break" : "off-ball-run", players, opponents, {
              provider,
              scorer: runner,
              defender: lineDefender,
              scenarioType: brokenLine ? "offside-break" : "off-ball-run",
              defensiveError: brokenLine ? "broken-offside-line" : "",
              zoneFrom: zone,
              zoneTo: 1,
              action: "through-ball",
            });
            continue;
          }
          if (highlightCount < highlightLimit) {
            addDuelEvent({
              kind: "chance",
              actor: runner,
              defender: lineDefender,
              duel: deliveryDuel,
              provider,
              from: zone,
              to: 1,
              action: "one-on-one",
              possession: opposite(side),
              scenarioType: brokenLine ? "offside-break" : "off-ball-run",
              defensiveError: brokenLine ? "broken-offside-line" : "",
              text: brokenLine
                ? `${playerName(lineDefender)} steps out and breaks the offside line. ${playerName(provider)} finds ${playerName(runner)} racing clear, but ${playerName(keeper)} rescues the defence in the one-on-one.`
                : `${playerName(runner)} loses the marker with an elite off-ball run and meets ${playerName(provider)}'s delivery, but ${playerName(keeper)} smothers the serious chance.`,
            });
          }
          side = opposite(side);
          zone = 7;
          counterSteps = 0;
          continue;
        }
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
          if (random() < shotChance(receiver, keeper, minute, 0.3, firstTouchFinishScore)) {
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

      // X1 -- open-play cross into the box (see MATCH_ENGINE_SCENARIOS.md).
      // Reached whenever the wide player didn't successfully cut it back
      // above (wideByline's own condition/roll/duel didn't produce a
      // continue). X1.R is an aerial Contested Race between the arriving
      // attacker and their marker; the winning attacker goes into a
      // header-flavored F.SELECT/K.SAVE, the winning defender routes into
      // the same zone-aware engagement menu used everywhere else, treated
      // as a standing/aerial clearance (no sliding tackle for a header).
      const crossOpportunity = column !== 1 && isWidePlayer(actor);
      if (crossOpportunity && random() < 0.38) {
        const target = weightedPlayer(attackingPool, random, "attack", (player) =>
          conditionedScore(player, headerScore, minute));
        const marker = defenderForColumn(defendingPool, 1, minute, random);
        const race = contestedRace(target, marker, minute, random, 1, { aerial: true });

        if (race.won) {
          const headerAttempt = resolveFinishAttempt("header", target, random, 1);
          if (!headerAttempt.onTarget) {
            if (highlightCount < highlightLimit) {
              addDuelEvent({
                kind: "chance", actor: target, defender: marker, duel: null,
                from: zone, to: 1, action: "cross", possession: opposite(side),
                scenarioType: headerAttempt.code,
                text: `${playerName(actor)} whips in a cross and ${playerName(target)} rises above ${playerName(marker)}, but the header drifts off target.`,
              });
            }
            side = opposite(side);
            zone = 7;
            continue;
          }
          const headerSave = resolveKeeperSave(target, keeper, "header", minute, random, 1);
          if (headerSave.goal) {
            addGoal(headerSave.code === "K.SAVE.8" ? "rebound" : "corner-header", players, opponents, {
              provider: actor, scorer: target, zoneFrom: zone, zoneTo: 1, action: "cross",
              ...(headerSave.code === "K.SAVE.8" ? { reboundSource: "post" } : {}),
            });
            continue;
          }
          const headerSaveText = {
            "K.SAVE.1": `${playerName(target)} powers the header goalward, but ${playerName(keeper)} claims it well.`,
            "K.SAVE.3": `${playerName(target)} glances the header on target, and ${playerName(keeper)} tips it behind for a corner.`,
            "K.SAVE.4": `${playerName(keeper)} fumbles the header under pressure but recovers before anyone reacts.`,
            "K.SAVE.7": `${playerName(target)}'s header cannons back off the post and away for a corner.`,
          }[headerSave.code];
          if (!headerSave.rebound) {
            if (headerSave.code === "K.SAVE.3" || headerSave.code === "K.SAVE.7") {
              if (highlightCount < highlightLimit) {
                addDuelEvent({
                  kind: "chance", actor: target, defender: keeper, duel: null,
                  from: zone, to: 1, action: "cross", possession: opposite(side),
                  scenarioType: headerSave.code,
                  text: headerSaveText,
                });
              }
              awardCorner();
              continue;
            }
            if (highlightCount < highlightLimit) {
              addDuelEvent({
                kind: "chance", actor: target, defender: keeper, duel: null,
                from: zone, to: 1, action: "cross", possession: opposite(side),
                scenarioType: headerSave.code,
                text: headerSaveText || `${playerName(keeper)} deals with ${playerName(target)}'s header.`,
              });
            }
            side = opposite(side);
            zone = 7;
            continue;
          }
          const poacher = weightedPlayer(attackingPool, random, "attack", (player) =>
            conditionedScore(player, poacherScore, minute));
          const reboundDefender = defenderForColumn(defendingPool, 1, minute, random);
          const reboundDuel = localizedDuel(
            poacher, reboundDefender,
            ["Anticipation", "Acceleration", "Off the Ball"],
            ["Positioning", "Anticipation", "Strength"],
            minute, random, 1,
          );
          if (reboundDuel.won
            && random() < shotChance(poacher, keeper, minute, 0.35, poacherScore)) {
            addGoal("rebound", players, opponents, {
              scorer: poacher, reboundSource: headerSave.code === "K.SAVE.6" ? "post" : "save",
            });
            continue;
          }
          if (highlightCount < highlightLimit) {
            addDuelEvent({
              kind: "chance", actor: poacher, defender: reboundDefender, duel: reboundDuel,
              from: 1, to: 1, action: "rebound", possession: opposite(side),
              text: reboundDuel.won
                ? `${playerName(poacher)} reacts fastest to the loose ball but can't quite direct it goalward.`
                : `${playerName(reboundDefender)} reads the rebound and clears the danger.`,
            });
          }
          side = opposite(side);
          zone = 7;
          continue;
        }

        // X1.D -- defender wins the header.
        const crossEngagement = resolveEngagement("D.STAND", marker, random, 0);
        if (crossEngagement.outcome === "won") {
          if (highlightCount < highlightLimit && random() < 0.3) {
            addDuelEvent({
              kind: "tackle", actor: marker, defender: null, duel: race,
              from: 1, to: 1, action: "clearance", possession: opposite(side),
              scenarioType: crossEngagement.code,
              text: `${playerName(marker)} climbs above ${playerName(target)} and heads the cross clear.`,
            });
          }
          side = opposite(side);
          zone = 7;
          continue;
        }
        if (crossEngagement.outcome === "loose") {
          const looseBall = contestedRace(actor, marker, minute, random, 1);
          if (highlightCount < highlightLimit) {
            addDuelEvent({
              kind: "chance", actor, defender: marker, duel: looseBall,
              from: 1, to: 1, action: "cross", possession: looseBall.won ? side : opposite(side),
              text: looseBall.won
                ? `The header is only half-cleared and ${playerName(actor)}'s side keeps the scramble alive.`
                : `The header is only half-cleared, but ${playerName(marker)}'s side reacts first and clears the box.`,
            });
          }
          if (looseBall.won) {
            zone = 1;
          } else {
            side = opposite(side);
            zone = 7;
          }
          continue;
        }
        if (crossEngagement.outcome === "foul") {
          applyFoulOutcome(marker, "D.STAND", false);
          continue;
        }
        // "beaten" -- the marker misjudges the cross entirely; the attack
        // keeps a live chance in the box without a shot having been forced.
        zone = 1;
        continue;
      }

      const lateRunners = attackingPool.filter((player) =>
        isMidfielder(player)
        && playerAttribute(player, "Off the Ball") >= 14
        && playerAttribute(player, "Anticipation") >= 14);
      const lateRunner = weightedPlayer(lateRunners, random, "midfield", (player) =>
        conditionedScore(player, lateBoxRunScore, minute));
      const lateProviders = attackingPool.filter((player) => player !== lateRunner);
      const lateProvider = weightedPlayer(
        lateProviders.length ? lateProviders : attackingPool,
        random,
        "midfield",
        (player) => conditionedScore(player, deliveryScore, minute),
      );
      const lateRunChance = lateRunner && deliveryScore(lateProvider) >= 68
        ? clamp(0, 0.095,
            (lateBoxRunScore(lateRunner) - 68) / 290
            + (deliveryScore(lateProvider) - 68) / 420) * forwardRiskMultiplier
        : 0;
      if (lateRunner && random() < lateRunChance) {
        if (random() < shotChance(lateRunner, keeper, minute, 0.29, lateBoxRunScore)) {
          addGoal("late-run", players, opponents, {
            provider: lateProvider,
            scorer: lateRunner,
            scenarioType: "late-box-run",
            zoneFrom: zone,
            zoneTo: 1,
            action: "late-run",
          });
          continue;
        }
        if (highlightCount < highlightLimit) {
          addDuelEvent({
            kind: "chance",
            actor: lateRunner,
            defender,
            duel: null,
            provider: lateProvider,
            from: zone,
            to: 1,
            action: "late-run",
            possession: opposite(side),
            scenarioType: "late-box-run",
            text: `${playerName(lateRunner)} delays the run and arrives untracked onto ${playerName(lateProvider)}'s delivery, but the late finish whistles past the post.`,
          });
        }
        side = opposite(side);
        zone = 7;
        continue;
      }

      const finesseCandidates = attackingPool.filter((player) =>
        playerAttribute(player, "Technique") >= 15
        && Math.max(
          playerAttribute(player, "Long Shots", "Shooting"),
          playerAttribute(player, "Finishing", "Shooting"),
        ) >= 15);
      const finesseAttempt = [3, 5].includes(zone)
        && finesseCandidates.length > 0
        && random() < 0.42;
      const longRange = row === 1 && (finesseAttempt || random() < 0.34);
      const shotScore = finesseAttempt
        ? finesseLongShotScore
        : longRange ? longRangeScore : attackerScore;
      const shooter = weightedPlayer(
        finesseAttempt ? finesseCandidates : attackingPool,
        random,
        longRange ? "midfield" : "attack",
        (player) => conditionedScore(player, shotScore, minute),
      );
      const baseChance = finesseAttempt ? 0.09 : longRange ? 0.075 : column === 1 ? 0.19 : 0.11;

      const triesChip = !longRange
        && playerAttribute(shooter, "Composure") >= 15
        && playerAttribute(shooter, "Technique") >= 14
        && random() < 0.16;
      if (triesChip) {
        if (random() < shotChance(shooter, keeper, minute, 0.34, chipScore)) {
          addGoal("chip", players, opponents, {
            provider: actor === shooter ? null : actor,
            scorer: shooter,
            scenarioType: "chip",
            zoneFrom: zone,
            zoneTo: 1,
            action: "chip",
          });
          continue;
        }
        if (highlightCount < highlightLimit) {
          addDuelEvent({
            kind: "chance",
            actor: shooter,
            defender: keeper,
            duel: null,
            from: zone,
            to: 1,
            action: "chip",
            possession: opposite(side),
            scenarioType: "chip",
            text: `${playerName(shooter)} sees ${playerName(keeper)} off his line and dinks a delicate chip, but it drifts just over the crossbar.`,
          });
        }
        side = opposite(side);
        zone = 7;
        continue;
      }

      // Pressure widened into this decision too (see MATCH_ENGINE_SCENARIOS.md,
      // "Promoted: P.RECEIVE" -> pressure consumers) -- rounding the keeper
      // is an audacious, composed decision; a player who's had to fight
      // through heavier pressure to get here is less inclined to attempt
      // it, independent of whether they'd actually pull it off (that's
      // still keeperDuel below, untouched).
      const triesKeeperDribble = !longRange
        && playerAttribute(shooter, "Dribbling") >= 16
        && playerAttribute(shooter, "Technique") >= 15
        && random() < clamp(0.08, 0.22, 0.22 - pressure * 0.15);
      if (triesKeeperDribble) {
        const keeperDuel = localizedDuel(
          shooter,
          keeper,
          ["Dribbling", "Technique", "Flair", "Composure", "Acceleration"],
          ["One On Ones", "Reflexes", "Agility", "Anticipation"],
          minute,
          random,
          1,
        );
        if (keeperDuel.won
          && random() < shotChance(shooter, keeper, minute, 0.4, keeperDribbleScore)) {
          addGoal("round-keeper", players, opponents, {
            provider: actor === shooter ? null : actor,
            scorer: shooter,
            scenarioType: "keeper-dribble",
            zoneFrom: zone,
            zoneTo: 1,
            action: "dribble",
          });
          continue;
        }
        if (highlightCount < highlightLimit) {
          addDuelEvent({
            kind: "chance",
            actor: shooter,
            defender: keeper,
            duel: keeperDuel,
            provider: actor === shooter ? null : actor,
            from: zone,
            to: 1,
            action: "dribble",
            possession: opposite(side),
            scenarioType: "keeper-dribble",
            text: keeperDuel.won
              ? `${playerName(shooter)} dribbles around ${playerName(keeper)}, but the angle closes and the finish rolls wide.`
              : `${playerName(shooter)} tries to take the ball around ${playerName(keeper)}, who stays big and wins the one-on-one.`,
          });
        }
        side = opposite(side);
        zone = 7;
        continue;
      }

      // P.SHOOT -> F.SELECT -> K.SAVE/K.ONEONONE (see MATCH_ENGINE_SCENARIOS.md).
      // Replaces the old single shotChance() gate + ad-hoc hitPost/parried
      // fallback with the richer finish-type/keeper-save tree. The existing
      // contextual multipliers (comeback tactics, momentum, man-down, morale)
      // are preserved as a scalar on the new on-target roll so match-state
      // tuning isn't lost.
      const finishType = selectFinishType(shooter, random, pressure);
      const tacticalMultiplier = !allInSide ? 1 : side === allInSide ? 1.4 : 1.28;
      const momentumMultiplier = pressureTicks >= 3
        ? 1 + Math.min(0.2, (pressureTicks - 2) * 0.045)
        : 1;
      const manDownMultiplier = manDown[opposite(side)] ? 1.16 : manDown[side] ? 0.92 : 1;
      // Pressure folded in here too -- a shot attempted under a well-set
      // defense (or simply a congested zone) is less likely to even be
      // clean and on target, same signal that already relieves during a
      // fresh transition via computePressure()'s transitionRelief term.
      const pressureMultiplier = clamp(0.6, 1.15, 1.25 - pressure * 0.5);
      const finishContextMultiplier = tacticalMultiplier * momentumMultiplier
        * manDownMultiplier * moraleMultiplier(side) * pressureMultiplier;

      // A genuine breakaway (isBreakaway, computed here so shot-blocking can
      // skip it too) by definition has no defender close enough to block --
      // that's the whole premise of the one-on-one. Everywhere else, the
      // marking defender gets a chance to throw a body in front of it
      // before the shot is even resolved as on-target or not.
      const isBreakaway = counterSteps >= 2 && column === 1;
      if (!isBreakaway) {
        const block = resolveShotBlock(defender, finishType, minute, random);
        if (block.blocked) {
          if (block.outcome === "safe") {
            if (highlightCount < highlightLimit) {
              addDuelEvent({
                kind: "chance", actor: shooter, defender, duel: null,
                from: zone, to: 1, action: "block", possession: opposite(side),
                scenarioType: block.code,
                text: `${playerName(defender)} throws a body in the way and blocks ${playerName(shooter)}'s effort.`,
              });
            }
            side = opposite(side);
            zone = 7;
            continue;
          }
          if (block.outcome === "behind") {
            if (highlightCount < highlightLimit) {
              addDuelEvent({
                kind: "chance", actor: shooter, defender, duel: null,
                from: zone, to: 1, action: "block", possession: opposite(side),
                scenarioType: block.code,
                text: `${playerName(defender)} bravely blocks ${playerName(shooter)}'s shot behind for a corner.`,
              });
            }
            awardCorner();
            continue;
          }
          // "loose" -- deflects into a contestable rebound, same
          // poacher-vs-defender pattern used everywhere else.
          const poacher = weightedPlayer(attackingPool, random, "attack", (player) =>
            conditionedScore(player, poacherScore, minute));
          const reboundDefender = defenderForColumn(defendingPool, 1, minute, random);
          const reboundDuel = localizedDuel(
            poacher, reboundDefender,
            ["Anticipation", "Acceleration", "Off the Ball"],
            ["Positioning", "Anticipation", "Strength"],
            minute, random, 1,
          );
          if (highlightCount < highlightLimit) {
            addDuelEvent({
              kind: "chance", actor: defender, defender: null, duel: null,
              from: zone, to: 1, action: "block", possession: side,
              scenarioType: block.code,
              text: `${playerName(defender)} gets a vital block in, but the ball spills loose in the box.`,
            });
          }
          if (reboundDuel.won && random() < shotChance(poacher, keeper, minute, 0.32, poacherScore)) {
            addGoal("rebound", players, opponents, { scorer: poacher, reboundSource: "save" });
            continue;
          }
          if (!reboundDuel.won) {
            side = opposite(side);
            zone = 7;
          }
          continue;
        }
      }

      const attempt = resolveFinishAttempt(finishType, shooter, random, finishContextMultiplier);

      if (!attempt.onTarget) {
        const missText = {
          "F.CALM.WEAK": `${playerName(shooter)} tries to place it low into the corner, but the effort lacks conviction and rolls tamely wide.`,
          "F.BLAST.OVER": `${playerName(shooter)} strikes it with everything, but the effort balloons well over the bar.`,
          "F.FINESSE.WIDE": `${playerName(shooter)} tries to bend it into the far corner, but it curls just wide of the post.`,
        }[attempt.code];
        if (highlightCount < highlightLimit) {
          addDuelEvent({
            kind: "chance", actor: shooter, defender, duel: null,
            from: zone, to: 1, action: "shot", possession: opposite(side),
            scenarioType: attempt.code,
            text: missText,
          });
        }
        side = opposite(side);
        zone = 7;
        continue;
      }

      const save = isBreakaway
        ? resolveOneOnOne(shooter, keeper, minute, random, 1)
        : resolveKeeperSave(shooter, keeper, finishType, minute, random, 1);

      if (save.goal) {
        const route = save.code === "K.ONEONONE.4"
          ? "chip"
          : save.code === "K.SAVE.8"
            ? "rebound"
            : finesseAttempt
              ? "finesse-long-range"
              : longRange
                ? "long-range"
                : counterSteps > 0
                  ? "counter"
                  : "open-play";
        addGoal(route, players, opponents, {
          provider: actor,
          scorer: shooter,
          scenarioType: save.code,
          zoneFrom: zone,
          zoneTo: 1,
          action: "shot",
          ...(route === "rebound" ? { reboundSource: "post" } : {}),
        });
        continue;
      }

      const saveText = {
        "K.SAVE.1": `${playerName(shooter)}'s effort is well struck, but ${playerName(keeper)} gets down well to collect.`,
        "K.SAVE.3": `${playerName(shooter)} forces a good save — ${playerName(keeper)} tips it away for a corner.`,
        "K.SAVE.4": `${playerName(keeper)} spills ${playerName(shooter)}'s effort but recovers to smother it at the second attempt.`,
        "K.SAVE.7": `${playerName(shooter)}'s shot cannons back off the post and away for a corner.`,
        "K.ONEONONE.2": `${playerName(shooter)} rushes the finish through on goal and drags it wide of ${playerName(keeper)}'s post.`,
        "K.ONEONONE.5": `${playerName(keeper)} advances quickly and narrows the angle — ${playerName(shooter)} can't find a way past him.`,
      }[save.code];
      if (save.code === "K.ONEONONE.6") {
        if (highlightCount < highlightLimit) {
          addDuelEvent({
            kind: "chance", actor: shooter, defender, duel: null,
            from: zone, to: 1, action: "shot", possession: side,
            scenarioType: save.code,
            text: `${playerName(defender)} has no other way to stop ${playerName(shooter)} clean through on goal and brings him down.`,
          });
        }
        applyFoulOutcome(defender, "breakaway", true);
        continue;
      }
      if (!save.rebound) {
        if (save.code === "K.SAVE.3" || save.code === "K.SAVE.7") {
          if (highlightCount < highlightLimit) {
            addDuelEvent({
              kind: "chance", actor: shooter, defender: keeper, duel: null,
              from: zone, to: 1, action: "shot", possession: opposite(side),
              scenarioType: save.code,
              text: saveText,
            });
          }
          awardCorner();
          continue;
        }
        if (highlightCount < highlightLimit) {
          addDuelEvent({
            kind: "chance", actor: shooter, defender: keeper, duel: null,
            from: zone, to: 1, action: "shot", possession: opposite(side),
            scenarioType: save.code,
            text: saveText || `${playerName(keeper)} keeps ${playerName(shooter)} out.`,
          });
        }
        side = opposite(side);
        zone = 7;
        continue;
      }

      if (save.rebound) {
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
          && random() < shotChance(poacher, keeper, minute, 0.35, poacherScore)) {
          addGoal("rebound", players, opponents, {
            scorer: poacher,
            reboundSource: save.code === "K.SAVE.6" ? "post" : "save",
          });
          continue;
        }
        if (highlightCount < highlightLimit) {
          addDuelEvent({
            kind: "chance", actor: poacher, defender: reboundDefender, duel: reboundDuel,
            from: 1, to: 1, action: "rebound", possession: opposite(side),
            text: reboundDuel.won
              ? `${playerName(poacher)} reacts fastest to the loose ball but can't quite direct it goalward.`
              : `${playerName(reboundDefender)} reads the rebound and clears the danger.`,
          });
        }
        morale[side] = clamp(-5, 5, morale[side] - 1);
        side = opposite(side);
        zone = 7;
        continue;
      }
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
      // Receiver selection (see MATCH_ENGINE_SCENARIOS.md) -- who the ball
      // actually finds in nextZone, not just that progression succeeded.
      pinnedNextActor = selectReceiver(
        attackingPool.filter((player) => player !== actor),
        nextZone,
        playerAttribute(actor, "Vision"),
        pressure,
        random,
      );
      // P.RECEIVE (see MATCH_ENGINE_SCENARIOS.md, "Promoted: P.RECEIVE") --
      // what that successful pass actually costs the receiver to control.
      // CLEAN is the silent default (prior behavior, no event); the other
      // four outcomes get their own event and telemetry tag. Reuses this
      // tick's covering defender as the challenge -- the same one
      // transitionDuel and selectReceiver already worked with.
      const receiver = pinnedNextActor || actor;
      const receiveResult = resolveReceive(
        receiver, defender, transitionDuel.probability, pressure, bypass, zone, minute, random,
      );
      if (receiveResult.context.code !== "P.RECEIVE.CLEAN" && highlightCount < highlightLimit) {
        const receiveText = {
          "P.RECEIVE.PROTECT": receiveResult.context.orientation === "BACK_TO_GOAL"
            ? `${playerName(receiver)} takes it with his back to goal and shields it from ${playerName(defender)}, killing the tempo but keeping possession.`
            : `${playerName(receiver)} shields the ball under pressure from ${playerName(defender)}, killing the tempo but keeping possession.`,
          "P.RECEIVE.HEAVY": receiveResult.context.recovered
            ? `${playerName(receiver)} takes a heavy touch under pressure but scrambles to retain it ahead of ${playerName(defender)}.`
            : `${playerName(receiver)} takes a heavy touch under pressure and ${playerName(defender)} nips in to win the ball back.`,
          "P.RECEIVE.KNOCK_FORWARD": receiveResult.context.won
            ? `${playerName(receiver)} knocks the ball into space and wins the race ahead of ${playerName(defender)}.`
            : `${playerName(receiver)} knocks the ball into space but ${playerName(defender)} gets there first.`,
          "P.RECEIVE.LOSE": `${playerName(receiver)} can't control the pass and ${playerName(defender)} pounces on the loose ball.`,
        }[receiveResult.context.code];
        addDuelEvent({
          kind: "receive", actor: receiver, defender, duel: receiveResult.context.duel,
          from: zone, to: receiveResult.nextZone,
          action: receiveResult.possession === "opponent" ? "turnover" : "control",
          possession: receiveResult.possession === "opponent" ? opposite(side) : side,
          scenarioType: receiveResult.context.code,
          text: receiveText,
        });
      }
      zone = receiveResult.nextZone;
      if (receiveResult.possession === "opponent") {
        side = opposite(side);
        pinnedNextActor = null;
        counterSteps = 3;
      } else if (counterSteps > 0) {
        counterSteps -= 1;
      }
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
        && random() < shotChance(presser, keeper, minute, 0.29, pressingScore)) {
        addGoal("high-press", players, opponents, { scorer: presser });
        continue;
      }
    }

    if (!bypass) {
      // D.* -- defender's engagement choice (see MATCH_ENGINE_SCENARIOS.md).
      // The broader progression duel has already gone the defender's way
      // (transitionDuel is lost for the attacker); this decides the flavor
      // of that win: a clean tackle, a loose ball, or -- despite the
      // aggregate favoring the defense -- a mistimed engagement that fouls
      // or lets the attacker straight through.
      const raceWasClose = transitionDuel.probability > 0.4;
      const engagementType = selectEngagement(defender, raceWasClose, random);
      const engagement = resolveEngagement(engagementType, defender, random, row);

      if (engagement.outcome === "won") {
        if (highlightCount < highlightLimit && random() < 0.2) {
          const tackleText = {
            "D.STAND": `${playerName(defender)} times the standing tackle well and wins the ball from ${playerName(actor)}.`,
            "D.SLIDE": `${playerName(defender)} slides in and comes away with the ball cleanly.`,
            "D.DUEL": `${playerName(defender)} shepherds ${playerName(actor)} away from goal and forces the turnover.`,
          }[engagementType];
          addDuelEvent({
            kind: "tackle", actor, defender, duel: transitionDuel,
            from: zone, to: zone, action: "turnover", possession: opposite(side),
            scenarioType: engagement.code,
            text: tackleText,
          });
        }
        side = opposite(side);
        zone = MIRRORED_ZONE[zone];
        counterSteps = 3;
        continue;
      }

      if (engagement.outcome === "loose") {
        const loose = contestedRace(actor, defender, minute, random, zone);
        if (highlightCount < highlightLimit) {
          addDuelEvent({
            kind: "tackle", actor, defender, duel: loose,
            from: zone, to: zone, action: "turnover", possession: loose.won ? side : opposite(side),
            scenarioType: engagement.code,
            text: loose.won
              ? `The ball breaks loose in the challenge and ${playerName(actor)} reacts fastest to retain it.`
              : `The ball breaks loose in the challenge and ${playerName(defender)} is first to react, clearing the danger.`,
          });
        }
        if (!loose.won) {
          side = opposite(side);
          zone = MIRRORED_ZONE[zone];
          counterSteps = 3;
        }
        continue;
      }

      if (engagement.outcome === "foul") {
        applyFoulOutcome(defender, engagementType, false);
        continue;
      }

      // "beaten" -- the attacker retains the ball despite the aggregate
      // duel favoring the defense. A missed slide tackle leaves the
      // defender grounded and briefly out of the phase, so the attack gets
      // a small zone nudge forward that a missed standing tackle doesn't.
      if (engagementType === "D.SLIDE") {
        zone = Math.max(0, row - 1) * 3 + column;
      }
      continue;
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

function annotatePressureWaves(events) {
  let streakSide = "";
  let streakCount = 0;
  let previousSecond = -Infinity;
  for (const event of events.slice().sort((left, right) => left.matchSecond - right.matchSecond)) {
    if (event.card) continue;
    const controlSide = event.side;
    const continuesWave = controlSide === streakSide &&
      Number(event.matchSecond) - previousSecond <= 8 * 60;
    streakCount = continuesWave ? streakCount + 1 : 1;
    streakSide = controlSide;
    previousSecond = Number(event.matchSecond);
    if (streakCount < 3) continue;
    event.pressureWave = true;
    event.momentumLevel = Math.min(5, streakCount);
    event.presentationWeight = Number(event.presentationWeight || 1) + 0.22;
    if (streakCount === 3) {
      event.text = `Pressure wave! ${event.text}`;
    }
  }
  return events;
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
  annotatePressureWaves(regularTimeline.events);
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
    annotatePressureWaves(extraTimeline.events);
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
    opponentName: teamLabel(opponentKey),
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

function finalizeMatchResult(result) {
  result.timeline = createCanonicalMatchTimeline(result);
  return result;
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
  if (state.champion) {
    return {
      label: "Champion",
      rank: isTitanFight
        ? TITAN_OPPONENTS.length + 1
        : scenario.stages.length + 4,
    };
  }
  if (isTitanFight) {
    return {
      label: `${state.userRecord.played}/${TITAN_OPPONENTS.length}`,
      rank: state.userRecord.played,
    };
  }
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
    runId: `${isTitanFight ? "titan" : scenario.key}:${groupName}:${runSeed}:${team.teamName}`,
    squadSeed: sharedSquad.seed,
    username,
    mode: isTitanFight ? "Titan Fight" : team.mode || "Classic",
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
    elements.recordRows.innerHTML =
      '<tr><td colspan="7">No saved runs yet.</td></tr>';
    return;
  }
  items.forEach((item) => {
    const storedStage = String(item.stage || "");
    const titanStage = storedStage.match(/(?:Titan\s*)?(\d+\/8)/i)?.[1] || "";
    const mode = item.mode === "Titan Fight" || titanStage
      ? "Titan Fight"
      : "Classic";
    const stage = item.champion ? "Champion" : titanStage || storedStage;
    const row = document.createElement("tr");
    row.innerHTML = `
      <th>${escapeHtml(item.username)}</th>
      <td>${escapeHtml(mode)}</td>
      <td>${escapeHtml(stage)}</td>
      <td>${linkedRecordPlayer(item.captain_name, item.captain_database, item.captain_source_person_id)}</td>
      <td>${linkedRecordPlayer(item.top_scorer_name, item.top_scorer_database, item.top_scorer_source_person_id, ` · ${item.top_scorer_goals}`)}</td>
      <td>${linkedRecordPlayer(item.dominator_name, item.dominator_database, item.dominator_source_person_id, ` · ${item.dominator_awards}`)}</td>
      <td>${
        item.squad_seed
          ? `<a href="draft-squad.html?seed=${encodeURIComponent(item.squad_seed)}">View XI</a>`
          : "—"
      }</td>
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

function openHallOfFame() {
  void persistSharedSquad().catch(() => {});
  elements.recordsPanel.hidden = false;
  document.body.classList.add("is-hall-of-fame-open");
  void loadRecordTable();
  elements.recordsClose.focus();
}

function closeHallOfFame() {
  elements.recordsPanel.hidden = true;
  document.body.classList.remove("is-hall-of-fame-open");
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
    openHallOfFame();
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

function renderSquad(sourceTeam = team) {
  const ratings = visibleSquadRatings(sourceTeam);
  elements.teamName.textContent = sourceTeam.teamName;
  elements.teamOverall.textContent = `${ratings.team} OVR`;
  elements.lineRatings.innerHTML = `
    <span><small>Attack</small><strong>${ratings.attack}</strong></span>
    <span><small>Midfield</small><strong>${ratings.midfield}</strong></span>
    <span><small>Defence</small><strong>${ratings.defence}</strong></span>
  `;
  elements.squadList.replaceChildren();
  sourceTeam.players.forEach((entry) => {
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
  const badges = [
    event.signatureMoment ? '<b class="run-event-badge is-signature">Titan moment</b>' : "",
    event.pressureWave ? '<b class="run-event-badge is-pressure">Pressure wave</b>' : "",
    event.allIn ? '<b class="run-event-badge is-all-in">All in</b>' : "",
  ].join("");
  return `
    <li class="${event.goal ? "is-goal" : ""} ${event.card ? `is-${event.card}-card` : ""} ${event.side === "opponent" ? "is-opponent" : ""} ${event.signatureMoment ? "is-signature" : ""} ${event.pressureWave ? "is-pressure-wave" : ""}">
      <span class="run-event-team run-event-team-user">${event.side === "user" ? actor : ""}</span>
      <span class="run-event-commentary"><time>${event.minute}'</time><span>${badges}${escapeHtml(event.text)}</span></span>
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

function setMiniPitchZone(pitch, event, endpoint = "to", opponentName = "Opponent") {
  if (!pitch || !event) return;
  const semanticZone = endpoint === "from" ? event.zoneFrom : event.zoneTo;
  const zone = displayZone(semanticZone, event.side);
  const [x, y] = ZONE_CENTERS[zone];
  if (endpoint === "from") {
    pitch.style.setProperty("--trail-x", `${x}%`);
    pitch.style.setProperty("--trail-y", `${y}%`);
    const trail = pitch.querySelector(".run-mini-trail");
    if (trail) {
      trail.classList.remove("is-animating");
      void trail.offsetWidth;
      trail.classList.add("is-animating");
    }
  }
  pitch.style.setProperty("--ball-x", `${x}%`);
  pitch.style.setProperty("--ball-y", `${y}%`);
  const possession = endpoint === "to" && event.possessionAfter
    ? event.possessionAfter
    : event.side;
  pitch.dataset.possession = possession;
  pitch.dataset.action = event.action || event.kind || "pass";
  pitch.dataset.goal = event.goal ? "true" : "false";
  pitch.dataset.signature = event.signatureMoment ? "true" : "false";
  pitch.dataset.pressure = event.pressureWave ? event.side : "";
  pitch.querySelectorAll("[data-zone]").forEach((cell) => {
    cell.classList.toggle("is-active", Number(cell.dataset.zone) === zone);
  });
  const status = pitch.parentElement?.querySelector("[data-pitch-status]");
  if (status) {
    status.textContent = possession === "user"
      ? `${team.teamName} · ${event.action || event.kind}`
      : `${opponentName} · ${event.action || event.kind}`;
  }
  const moraleTrack = pitch.parentElement?.querySelector("[data-morale-track]");
  if (moraleTrack) {
    const net = clamp(-5, 5, Number(event.moraleUser || 0) - Number(event.moraleOpponent || 0));
    moraleTrack.style.setProperty("--morale-pos", `${50 + (net / 5) * 45}%`);
  }
  const manDownLabel = pitch.parentElement?.querySelector("[data-mandown]");
  if (manDownLabel) {
    const text = event.manDownUser
      ? `${team.teamName} down to 10 men`
      : event.manDownOpponent
        ? `${opponentName} down to 10 men`
        : "";
    manDownLabel.hidden = !text;
    manDownLabel.textContent = text;
  }
}

function miniPitchMarkup() {
  const zones = Array.from({ length: 12 }, (_, index) =>
    `<span class="run-mini-zone" data-zone="${index}"></span>`).join("");
  return `
    <aside class="run-mini-pitch-wrap" aria-label="Live ball position">
      <div class="run-mini-pitch" data-mini-pitch data-possession="user" data-goal="false">
        ${zones}
        <span class="run-mini-halfway" aria-hidden="true"></span>
        <span class="run-mini-centre-circle" aria-hidden="true"></span>
        <span class="run-mini-box run-mini-box-top" aria-hidden="true"></span>
        <span class="run-mini-box run-mini-box-bottom" aria-hidden="true"></span>
        <span class="run-mini-trail" aria-hidden="true"></span>
        <span class="run-mini-ball" aria-hidden="true"></span>
      </div>
      <div class="run-mini-morale" data-morale-track aria-hidden="true">
        <span class="run-mini-morale-marker"></span>
      </div>
      <span class="run-mini-pitch-status" data-pitch-status>Kick-off</span>
      <span class="run-mini-mandown" data-mandown hidden></span>
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

function renderEventSnapshot(list, events, latestTimelineId = "") {
  if (!list) return;
  const mobile = window.matchMedia("(max-width: 720px)").matches;
  const visibleEvents = mobile
    ? events.filter((event) => event.goal || event.timelineId === latestTimelineId)
    : events;
  const signature = `${mobile ? "mobile" : "desktop"}:${visibleEvents
    .map((event) => event.timelineId || `${event.minute}:${event.text}`)
    .join("|")}`;
  if (list.dataset.renderSignature === signature) return;
  list.innerHTML = visibleEvents.map(eventMarkup).join("");
  list.dataset.renderSignature = signature;
  if (!mobile) {
    list.lastElementChild?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function renderPenaltySnapshot(section, snapshot) {
  if (!section) return;
  const attempts = snapshot.penalties;
  section.hidden = attempts.length === 0 && snapshot.phase !== "penalties" && !snapshot.completed;
  const list = section.querySelector("[data-penalty-events]");
  if (Number(list.dataset.renderedCount || -1) !== attempts.length) {
    list.innerHTML = attempts.map((attempt) => `
      <li>
        <span class="${attempt.userScored ? "is-scored" : "is-missed"}">${escapeHtml(attempt.userTaker)} <b aria-label="${attempt.userScored ? "scored" : "missed"}">${attempt.userScored ? "○" : "×"}</b></span>
        <span class="${attempt.opponentScored ? "is-scored" : "is-missed"}"><b aria-label="${attempt.opponentScored ? "scored" : "missed"}">${attempt.opponentScored ? "○" : "×"}</b> ${escapeHtml(attempt.opponentTaker)}</span>
      </li>
    `).join("");
    list.dataset.renderedCount = String(attempts.length);
  }
  section.querySelector("[data-penalty-score]").textContent =
    `${snapshot.penaltyUserGoals} – ${snapshot.penaltyRivalGoals}`;
}

function renderCanonicalMatchSnapshot(view, snapshot) {
  const regulationEvents = snapshot.commentary.filter((event) =>
    event.timelinePhase === "regulation");
  const extraTimeEvents = snapshot.commentary.filter((event) =>
    event.timelinePhase === "extra-time");
  renderEventSnapshot(view.eventList, regulationEvents, snapshot.latestEvent?.timelineId);
  renderEventSnapshot(view.extraEventList, extraTimeEvents, snapshot.latestEvent?.timelineId);
  if (view.extraSection) {
    view.extraSection.hidden = extraTimeEvents.length === 0 &&
      !["extra-time", "penalties", "complete"].includes(snapshot.phase);
  }
  renderPenaltySnapshot(view.penaltySection, snapshot);

  const possession = snapshot.possession || { user: 50, opponent: 50, windowMinutes: 10 };
  view.possessionBar.style.setProperty("--home-possession", `${possession.user}%`);
  view.possessionBar.setAttribute(
    "aria-label",
    `${view.homeName} ${possession.user}% possession, ${view.opponentName} ${possession.opponent}% over the last ${possession.windowMinutes} minutes`,
  );
  view.possessionHome.textContent = `${possession.user}%`;
  view.possessionAway.textContent = `${possession.opponent}%`;
  view.possessionWrap.dataset.dominant = possession.dominantSide || "";
  const emphasis = snapshot.suspense;
  const goalEmphasis = emphasis?.kind === "goal";
  view.suspense.hidden = !emphasis;
  view.suspense.classList.toggle("is-goal", goalEmphasis);
  view.suspense.querySelector("span").textContent = goalEmphasis ? "Scored" : "Danger";
  view.suspense.querySelector("strong").textContent = emphasis?.label || "CHANCE!";
  view.article.classList.toggle("is-suspense", Boolean(emphasis));
  view.article.classList.toggle("is-goal-emphasis", goalEmphasis);

  view.clockDisplay.textContent = snapshot.phase === "penalties"
    ? "PEN"
    : formatMatchClock(snapshot.matchSecond, snapshot.stoppageBase);
  view.scoreDisplay.textContent = snapshot.penalties.length
    ? `${snapshot.userGoals} – ${snapshot.rivalGoals} (${snapshot.penaltyUserGoals}–${snapshot.penaltyRivalGoals} pens)`
    : `${snapshot.userGoals} – ${snapshot.rivalGoals}`;

  const latest = snapshot.latestEvent;
  if (latest && latest.timelineId !== view.latestTimelineId) {
    view.latestTimelineId = latest.timelineId;
    const isLiveArrival = snapshot.elapsedMs - latest.timelineAtMs < 350;
    if (isLiveArrival) {
      setMiniPitchZone(view.pitch, latest, "from", view.opponentName);
      window.requestAnimationFrame(() => {
        if (view.latestTimelineId === latest.timelineId) {
          setMiniPitchZone(view.pitch, latest, "to", view.opponentName);
        }
      });
    } else {
      setMiniPitchZone(view.pitch, latest, "to", view.opponentName);
    }
  }
}

async function animateMatch(result, {
  startAt = Date.now() + 150,
  offsetMs = 0,
  lockPace = false,
} = {}) {
  const timeline = result.timeline || createCanonicalMatchTimeline(result);
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
    <section class="run-possession" data-match-possession>
      <div class="run-possession-heading">
        <span>${escapeHtml(team.teamName)} <b data-possession-home>50%</b></span>
        <small>Possession · last 10 minutes</small>
        <span><b data-possession-away>50%</b> ${escapeHtml(result.opponentName)}</span>
      </div>
      <div class="run-possession-bar" data-possession-bar role="img" aria-label="Possession is even at 50 percent">
        <i class="run-possession-home"></i><i class="run-possession-away"></i>
      </div>
    </section>
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
    <div class="run-match-suspense" data-match-suspense hidden><span>Danger</span><strong>CHANCE!</strong></div>
  `;
  shell.append(article);
  elements.matches.append(shell);
  const scoreDisplay = article.querySelector("[data-live-score]");
  const clockDisplay = article.querySelector("[data-match-clock]");
  const eventList = article.querySelector("[data-live-events]");
  const paceSelect = article.querySelector("[data-match-pace]");
  const pitch = article.querySelector("[data-mini-pitch]");
  const summaryScore = shell.querySelector("[data-summary-score]");
  const possessionWrap = article.querySelector("[data-match-possession]");
  const possessionBar = article.querySelector("[data-possession-bar]");
  const possessionHome = article.querySelector("[data-possession-home]");
  const possessionAway = article.querySelector("[data-possession-away]");
  const suspense = article.querySelector("[data-match-suspense]");
  const extraSection = result.hasExtraTime ? document.createElement("section") : null;
  if (extraSection) {
    extraSection.className = "run-extra-time-section";
    extraSection.hidden = true;
    extraSection.innerHTML = '<h3>Extra time</h3><ol class="run-event-list" data-extra-events></ol>';
    article.append(extraSection);
  }
  const penaltySection = result.shootout ? document.createElement("section") : null;
  if (penaltySection) {
    penaltySection.className = "run-penalty-section";
    penaltySection.hidden = true;
    penaltySection.innerHTML = `
      <h3>Penalty shootout</h3>
      <div class="run-penalty-score"><span>${escapeHtml(team.teamName)}</span><b data-penalty-score>0 – 0</b><span>${escapeHtml(result.opponentName)}</span></div>
      <ol class="run-penalty-list" data-penalty-events></ol>
    `;
    article.append(penaltySection);
  }

  const view = {
    article,
    scoreDisplay,
    clockDisplay,
    eventList,
    extraSection,
    extraEventList: extraSection?.querySelector("[data-extra-events]") || null,
    penaltySection,
    pitch,
    possessionWrap,
    possessionBar,
    possessionHome,
    possessionAway,
    suspense,
    homeName: team.teamName,
    opponentName: result.opponentName,
    latestTimelineId: "",
  };
  if (lockPace) {
    paceSelect.value = "normal";
    paceSelect.disabled = true;
    paceSelect.closest("label").hidden = true;
  }
  const playback = createMatchPlaybackController({
    timeline,
    rate: lockPace ? 1 : 1 / matchPaceMultiplier(paceSelect),
    onState: (snapshot) => renderCanonicalMatchSnapshot(view, snapshot),
  });
  paceSelect.addEventListener("change", () => {
    writeJsonStorage(MATCH_PACE_KEY, paceSelect.value);
    playback.setRate(1 / matchPaceMultiplier(paceSelect));
  });
  const resyncVisibleMatch = () => {
    if (!document.hidden) playback.resync();
  };
  document.addEventListener("visibilitychange", resyncVisibleMatch);
  try {
    await playback.start({ startAt, offsetMs });
  } finally {
    document.removeEventListener("visibilitychange", resyncVisibleMatch);
    playback.stop();
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
  if (state.phase === "titan") {
    const opponentKey = titanOrder[state.titanIndex];
    return opponentKey
      ? { stage: `Titan Fight · Battle ${state.titanIndex + 1}/8`, opponentKey }
      : null;
  }
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
      <strong>${escapeHtml(team.teamName)} vs ${escapeHtml(teamLabel(fixture.opponentKey))}</strong>
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

const TEAM_STRENGTH = {
  real: 94, milan: 93, juventus: 91, arsenal: 90, united: 89,
  barcelona: 89, inter: 88, chelsea: 87, porto: 87, bayern: 86,
  valencia: 85, monaco: 84, deportivo: 84, ajax: 83, lyon: 82,
  sociedad: 80, stuttgart: 80, lokomotiv: 78, sparta: 77,
  brazil: 95, germany: 89, france: 88, argentina: 88, italy: 87,
  spain: 86, portugal: 85, england: 84, sweden: 81, turkey: 81,
  southkorea: 79, mexico: 79, denmark: 78, unitedstates: 77,
  belgium: 77, ireland: 77, japan: 76, croatia: 76, nigeria: 75,
  cameroon: 75, senegal: 75, russia: 75, uruguay: 74, paraguay: 74,
  poland: 74,
};

function simulatedBracketWinner([left, right], roundIndex, fixtureIndex) {
  const random = seededRandom(hashString(
    `${runSeed}:${scenario.key}:bracket:${roundIndex}:${fixtureIndex}:${left}:${right}`,
  ));
  const leftScore = (TEAM_STRENGTH[left] || 74) + random() * 18;
  const rightScore = (TEAM_STRENGTH[right] || 74) + random() * 18;
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
  const championKicker = isTitanFight
    ? "Titans conquered"
    : "Champions of Europe";
  const championSummary = isTitanFight
    ? `The drafted XI defeated all ${TITAN_OPPONENTS.length} legendary teams and won Titan Fight.`
    : `The drafted XI complete the ${escapeHtml(scenario.label)} route and lift the trophy in ${escapeHtml(scenario.finalVenue)}.`;
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
    <span class="draft-panel-kicker">${champion ? championKicker : "Run complete"}</span>
    <h2>${champion ? `${escapeHtml(team.teamName)} ${isTitanFight ? "conquer the Titans!" : "win the cup!"}` : `${escapeHtml(team.teamName)} are eliminated`}</h2>
    <p>${
      champion
        ? championSummary
        : eliminatedBy
          ? `Eliminated in the ${escapeHtml(eliminatedStage)} by ${escapeHtml(eliminatedBy)}.`
          : `Finished ${state.groupPlace}${state.groupPlace === 3 ? "rd" : "th"} in Group ${escapeHtml(groupName)}.`
    }</p>
    <div class="run-result-stats">
      <span><strong>${record.gf}</strong><small>Goals for</small></span>
      <span><strong>${record.ga}</strong><small>Against</small></span>
      <span><strong>${record.wins}</strong><small>Wins</small></span>
      <span><strong>${record.draws}</strong><small>Draws</small></span>
      <span><strong>${record.losses}</strong><small>Losses</small></span>
      <span><strong>${isTitanFight ? state.userRecord.played : state.groupPlace || "—"}</strong><small>${isTitanFight ? "Titans faced" : "Group place"}</small></span>
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
        <div data-record-form-slot></div>
      </div>
    </div>
    <div class="run-result-actions">
      <button type="button" data-replay>Replay run</button>
      <a href="draft-setup.html">Edit team</a>
    </div>
  `;
  const recordFormSlot = elements.resultCard.querySelector("[data-record-form-slot]");
  recordFormSlot.append(elements.recordForm);
  elements.recordForm.hidden = false;
  elements.recordStatus.textContent = "Save this finished run to the Hall of Fame.";
  void persistSharedSquad().catch(() => {});
  if (state.savedUsername) {
    void saveDraftRecord(recordPayload(state.savedUsername)).then(loadRecordTable).catch(() => {});
  }
  elements.resultCard.querySelector("[data-replay]").addEventListener("click", () => window.location.reload());
  const shareButton = elements.resultCard.querySelector("[data-share-squad]");
  const shareStatus = elements.resultCard.querySelector("[data-share-status]");
  shareButton.addEventListener("click", () => shareFinishedSquad(shareButton, shareStatus));
  elements.resultCard.scrollIntoView({ behavior: "smooth", block: "center" });
  openHallOfFame();
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
  finalizeMatchResult(result);
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

// Knockout and Titan Fight rounds share the exact same shape (load one opponent roster,
// simulate, penalties if needed, then a win/loss branch) — only the labels and the
// advance-to-next-opponent bookkeeping differ, which this config supplies per kind.
const ELIMINATION_ROUNDS = {
  knockout: {
    opponentKey: () => currentKnockoutOpponent(),
    opponent: (key) => CLUBS[key],
    stage: () => scenario.stages[state.knockoutIndex],
    loadingText: () => "Loading the opponent squad and calculating the tie…",
    penaltyText: () => "The tie may require penalties. Selecting the strongest available takers…",
    lossText: () => "The European run ends here.",
    onAdvance: (opponent) => {
      if (!advanceKnockoutBracket()) {
        elements.stageTitle.textContent = "Champions of Europe";
        elements.stageDescription.textContent = "The final whistle confirms the title.";
        showResult({ champion: true });
        return false;
      }
      renderBracket();
      const nextOpponent = currentKnockoutOpponent();
      elements.stageKicker.textContent = scenario.stages[state.knockoutIndex];
      elements.stageTitle.textContent = `${scenario.stages[state.knockoutIndex]} · ${CLUBS[nextOpponent].name}`;
      elements.stageDescription.textContent = `${opponent.name} eliminated. The next tie is ready.`;
      elements.nextButton.textContent = `Play ${CLUBS[nextOpponent].name} →`;
      return true;
    },
  },
  titan: {
    opponentKey: () => titanOrder[state.titanIndex],
    opponent: (key) => TITAN_BY_KEY.get(key),
    stage: () => `Titan Fight · Battle ${state.titanIndex + 1}/8`,
    loadingText: (opponent) => `Loading the ${opponent.shortName} starting XI and calculating the battle…`,
    penaltyText: () => "The battle requires penalties. Selecting the strongest available takers…",
    lossText: (opponent) => `${opponent.shortName} end the Titan Fight run.`,
    onAdvance: (opponent) => {
      state.titanIndex += 1;
      if (state.titanIndex >= titanOrder.length) {
        elements.stageTitle.textContent = "Titan Fight conquered";
        elements.stageDescription.textContent = "All eight legendary teams have fallen.";
        showResult({ champion: true });
        return false;
      }
      const next = TITAN_BY_KEY.get(titanOrder[state.titanIndex]);
      elements.stageKicker.textContent = `Titan ${state.titanIndex + 1} of 8`;
      elements.stageTitle.textContent = `${opponent.shortName} defeated`;
      elements.stageDescription.textContent = `Next: ${next.name}.`;
      elements.nextButton.textContent = `Face ${next.shortName} →`;
      return true;
    },
  },
};

async function playEliminationRound(kind) {
  const config = ELIMINATION_ROUNDS[kind];
  const opponentKey = config.opponentKey();
  const opponent = config.opponent(opponentKey);
  const stage = config.stage();
  elements.nextButton.disabled = true;
  elements.stageTitle.textContent = `${stage} · ${team.teamName} vs ${opponent.name}`;
  elements.stageDescription.textContent = config.loadingText(opponent);
  const rosterBase = await opponentRoster(opponentKey);
  const [roster] = await Promise.all([
    hydratePlayers(rosterBase),
    hydratePlayers(userPlayers()),
  ]);
  state.matchNumber += 1;
  const result = matchSimulation(opponentKey, roster, stage);
  if (result.needsPenalties) {
    elements.stageDescription.textContent = config.penaltyText();
    await preparePenaltyShootout(result, roster);
  }
  finalizeMatchResult(result);
  await animateMatch(result);
  updateUserRecord(result);

  if (!result.userWon) {
    elements.stageDescription.textContent = config.lossText(opponent);
    showResult({ eliminatedBy: opponent.name, eliminatedStage: stage });
    return;
  }

  if (!config.onAdvance(opponent)) return;
  elements.nextButton.disabled = false;
  renderPendingFixture();
}

// Group stage keeps its own function: it plays two matches per round (the user's fixture
// plus a hidden simulated one) and drives table standings rather than bracket advancement,
// so folding it into playEliminationRound's shape would do more harm than good.
async function playRound(kind) {
  if (kind === "group") return playGroupRound();
  return playEliminationRound(kind);
}

async function playNext() {
  if (state.busy || state.completed) return;
  state.busy = true;
  try {
    await playRound(state.phase);
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

function friendWebSocketUrl(session) {
  const url = new URL(API_BASE);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = `/api/friend-rooms/${encodeURIComponent(session.code)}/websocket`;
  url.search = new URLSearchParams({ token: session.token, name: session.name });
  return url.href;
}

function showFriendlyResult(result) {
  const viewerWon = result.userGoals === result.rivalGoals
    ? null
    : friendSession.role === "host" ? result.userWon : !result.userWon;
  const verdict = result.userGoals === result.rivalGoals
    ? "Draw"
    : result.userWon ? `${team.teamName} win` : `${result.opponentName} win`;
  elements.stageKicker.textContent = "Full time";
  elements.stageTitle.textContent = `${team.teamName} ${result.userGoals}–${result.rivalGoals} ${result.opponentName}`;
  elements.stageDescription.textContent = "Both managers watched the same authoritative match timeline.";
  elements.resultCard.hidden = false;
  elements.resultCard.className = `run-result-card ${viewerWon === false ? "is-eliminated" : "is-champion"}`;
  elements.resultCard.innerHTML = `
    <span class="draft-panel-kicker">Friendly match complete</span>
    <h2>${escapeHtml(verdict)}</h2>
    <p>${escapeHtml(team.teamName)} ${result.userGoals}–${result.rivalGoals} ${escapeHtml(result.opponentName)}</p>
    <div class="run-result-actions">
      <a href="draft.html">Create another room</a>
      <a href="draft-setup.html">Draft another XI</a>
    </div>
  `;
  elements.resultCard.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function playFriendlyMatch(match, offsetMs) {
  if (!match?.hostTeam?.players || !match?.guestTeam?.players) {
    throw new Error("The room did not provide both completed squads.");
  }
  runSeed = String(match.seed || friendSession.code);
  team = match.hostTeam;
  sharedSquad = createDraftSquad(team);
  friendOpponentName = String(match.guestTeam.teamName || "Guest XI");
  elements.tablePanel.hidden = true;
  elements.bracketPanel.hidden = true;
  elements.nextButton.hidden = true;
  elements.seed.textContent = `Live room ${friendSession.code} · Seed #${runSeed}`;
  elements.stageKicker.textContent = "Play with Friends";
  elements.stageTitle.textContent = `${team.teamName} vs ${friendOpponentName}`;
  elements.stageDescription.textContent = "Both squads are locked. Preparing the shared match timeline…";
  renderSquad(draftedTeam);

  await hydratePlayers(playersForTeam(team));
  const rivalRoster = await hydratePlayers(playersForTeam(match.guestTeam));
  state.matchNumber = 1;
  const result = matchSimulation("friend-guest", rivalRoster, "Friendly match");
  result.opponentName = friendOpponentName;
  if (result.needsPenalties) await preparePenaltyShootout(result, rivalRoster);
  finalizeMatchResult(result);
  await animateMatch(result, {
    startAt: Number(match.startAt) || Date.now() + 150,
    offsetMs,
    lockPace: true,
  });
  showFriendlyResult(result);
}

function startFriendlyRoom() {
  elements.tablePanel.hidden = true;
  elements.bracketPanel.hidden = true;
  elements.nextButton.hidden = true;
  elements.seed.textContent = `Live room ${friendSession.code}`;
  elements.stageKicker.textContent = "Squad submitted";
  elements.stageTitle.textContent = "Waiting for your opponent";
  elements.stageDescription.textContent = "This match starts automatically when both completed XIs arrive.";
  elements.matches.innerHTML = '<div class="run-empty">Connecting to the private room…</div>';
  renderSquad(draftedTeam);

  const MAX_RECONNECT_ATTEMPTS = 6;
  const RECONNECT_DELAYS_MS = [1000, 2000, 4000, 8000, 8000, 8000];
  let clockSamples = [];
  let serverOffsetMs = 0;
  let pendingMatch = null;
  let matchStarted = false;
  let fallbackTimer = null;
  let reconnectAttempts = 0;
  let reconnectTimer = null;

  const begin = () => {
    if (matchStarted || !pendingMatch) return;
    if (clockSamples.length < 3 && !fallbackTimer) {
      fallbackTimer = window.setTimeout(begin, 900);
      return;
    }
    matchStarted = true;
    clearTimeout(fallbackTimer);
    void playFriendlyMatch(pendingMatch, serverOffsetMs).catch((error) => {
      elements.stageDescription.textContent = error.message || "The friendly match could not be simulated.";
    });
  };

  const scheduleReconnect = () => {
    if (matchStarted || reconnectTimer) return;
    if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
      elements.stageDescription.textContent =
        "Room connection lost. Return to the invitation link to reconnect.";
      return;
    }
    const delay = RECONNECT_DELAYS_MS[Math.min(reconnectAttempts, RECONNECT_DELAYS_MS.length - 1)];
    reconnectAttempts += 1;
    elements.stageDescription.textContent =
      `Room connection lost. Reconnecting… (attempt ${reconnectAttempts} of ${MAX_RECONNECT_ATTEMPTS})`;
    reconnectTimer = window.setTimeout(() => {
      reconnectTimer = null;
      connect();
    }, delay);
  };

  function connect() {
    clockSamples = [];
    const socket = new WebSocket(friendWebSocketUrl(friendSession));
    socket.addEventListener("open", () => {
      reconnectAttempts = 0;
      elements.matches.innerHTML = '<div class="run-empty">Your XI is locked. Waiting for the other manager…</div>';
      [0, 140, 280, 420, 560].forEach((delayMs) => {
        window.setTimeout(() => socket.send(JSON.stringify({ type: "ping", sentAt: Date.now() })), delayMs);
      });
      socket.send(JSON.stringify({ type: "submit-squad", squad: draftedTeam }));
    });
    socket.addEventListener("message", (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (message.type === "pong") {
        clockSamples.push({
          sentAt: Number(message.sentAt),
          serverNow: Number(message.serverNow),
          receivedAt: Date.now(),
        });
        serverOffsetMs = estimateServerClockOffset(clockSamples);
        if (clockSamples.length >= 3) begin();
        return;
      }
      if (message.type === "room-error") {
        elements.stageDescription.textContent = message.message || "The room rejected this squad.";
        return;
      }
      if (message.type !== "room-state") return;
      const hostReady = Boolean(message.players?.host?.squadReady);
      const guestReady = Boolean(message.players?.guest?.squadReady);
      elements.stageDescription.textContent = hostReady && guestReady
        ? "Both squads are locked. Synchronizing kickoff…"
        : `Waiting for ${hostReady ? "the guest" : guestReady ? "the host" : "both squads"}…`;
      if (message.match) {
        pendingMatch = message.match;
        begin();
      }
    });
    socket.addEventListener("close", scheduleReconnect);
    socket.addEventListener("error", scheduleReconnect);
  }

  connect();
}

elements.nextButton.addEventListener("click", playNext);
elements.recordForm.addEventListener("submit", saveCurrentRecord);
elements.recordsClose.addEventListener("click", closeHallOfFame);
elements.recordsPanel.addEventListener("click", (event) => {
  if (event.target === elements.recordsPanel) closeHallOfFame();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !elements.recordsPanel.hidden) closeHallOfFame();
});
if (isFriendMatch) {
  elements.seed.textContent = `Live room ${friendSession.code}`;
  elements.tablePanel.hidden = true;
  elements.bracketPanel.hidden = true;
  elements.stageKicker.textContent = "Play with Friends";
  elements.stageTitle.textContent = "Submitting your XI";
  elements.stageDescription.textContent = "Connecting to the authoritative private room.";
} else if (isTitanFight) {
  const firstTitan = TITAN_BY_KEY.get(titanOrder[0]);
  elements.seed.textContent = `Titan Fight · Seed #${runSeed}`;
  elements.tablePanel.hidden = true;
  elements.stageKicker.textContent = "Titan 1 of 8";
  elements.stageTitle.textContent = `First battle · ${firstTitan.name}`;
  elements.stageDescription.textContent =
    "The eight legendary opponents have been shuffled. Win to reveal the next Titan.";
  elements.nextButton.textContent = `Face ${firstTitan.shortName} →`;
} else {
  elements.seed.textContent = `Offline ${scenario.shortLabel} · Seed #${runSeed}`;
  elements.groupHeading.textContent = `Group ${groupName}`;
  elements.stageTitle.textContent = `Group ${groupName} · Matchday 1`;
  elements.stageDescription.textContent = `The group draw replaces ${scenario.replacementLabel[groupName]} with ${team?.teamName || "your XI"}.`;
  elements.nextButton.textContent = "Play Matchday 1 →";
}

if (!team?.players || team.players.length !== 11 || !team.captainSlotId) {
  showMissingTeam();
} else if (isFriendMatch) {
  startFriendlyRoom();
} else {
  renderSquad();
  if (!isTitanFight) renderTable();
  renderPendingFixture();
}
