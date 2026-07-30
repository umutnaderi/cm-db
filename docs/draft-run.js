import {
  getDraftRecords,
  getPlayer,
  getPlayerMetrics,
  saveDraftRecord,
  saveDraftSquad,
  searchPlayers,
} from "./src/lib/retroballApi.js?v=20260730-42";
import {
  createDraftSquad,
  formatDraftSquadText,
} from "./src/lib/draftSquad.js?v=20260730-42";

const TEAM_STORAGE_KEY = "retroball-draft-team-v1";
const OPPONENT_CACHE_KEY = "retroball-ucl-opponents-v1";
const DATABASE = "cm0304_vanilla_original";
const GROUP_TEAMS = ["user", "milan", "ajax", "brugge"];
const CLUBS = {
  bayern: { name: "Bayern Munich" },
  real: { name: "Real Madrid" },
  lokomotiv: { name: "Lokomotiv Moscow" },
  milan: { name: "AC Milan", club: "AC Milan" },
  ajax: { name: "Ajax", club: "AFC Ajax" },
  brugge: { name: "Club Brugge", club: "Club Brugge KV" },
  stuttgart: { name: "VfB Stuttgart" },
  arsenal: { name: "Arsenal", club: "Arsenal" },
  chelsea: { name: "Chelsea", club: "Chelsea" },
  monaco: { name: "Monaco", club: "AS Monaco FC" },
  porto: { name: "Porto", club: "Futebol Clube do Porto" },
  united: { name: "Manchester United" },
  sociedad: { name: "Real Sociedad" },
  lyon: { name: "Lyon" },
  sparta: { name: "Sparta Prague", club: "Sparta Prague" },
  juventus: { name: "Juventus" },
  deportivo: {
    name: "Deportivo La Coruña",
    club: "R.C. Deportivo de La Coruña SAD",
  },
};
const GROUP_ROUNDS = [
  { userOpponent: "milan", hidden: ["ajax", "brugge"] },
  { userOpponent: "ajax", hidden: ["milan", "brugge"] },
  { userOpponent: "brugge", hidden: ["milan", "ajax"] },
];
const KNOCKOUT_PATHS = {
  1: ["sparta", "deportivo", "porto", "monaco"],
  2: ["arsenal", "chelsea", "monaco", "porto"],
};
const KNOCKOUT_STAGES = ["Round of 16", "Quarter-final", "Semi-final", "Final"];

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

const team = readJsonStorage(TEAM_STORAGE_KEY, null);
const sharedSquad = createDraftSquad(team);
const runSeed = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const opponentCache = readJsonStorage(OPPONENT_CACHE_KEY, {});
const rosterMemory = new Map();
const penaltyRatingCache = new Map();
const playerMetricCache = new Map();
const state = {
  phase: "group",
  groupRound: 0,
  groupPlace: 0,
  groupCompanion: "milan",
  knockoutIndex: 0,
  knockoutPath: [],
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

for (const key of GROUP_TEAMS) state.table.set(key, emptyStanding(key));

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
  if (rosterMemory.has(key)) return rosterMemory.get(key);
  if (Array.isArray(opponentCache[key]) && opponentCache[key].length) {
    const cached = validRoster(opponentCache[key]);
    rosterMemory.set(key, cached);
    return cached;
  }

  const club = CLUBS[key];
  const response = await searchPlayers({
    database: DATABASE,
    q: "",
    club: club.club,
    pageSize: 60,
  });
  const roster = validRoster(response.items);
  if (!roster.length) throw new Error(`No 03/04 players found for ${club.name}.`);
  rosterMemory.set(key, roster);
  opponentCache[key] = roster;
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
  return team.players.map((entry) => ({
    ...entry.player,
    current_ability:
      Number(entry.gameplay_current_ability)
      || Number(entry.player?.current_ability)
      || 0,
    role: entry.role,
    line: entry.line,
    overall: clamp(0, 99, Math.round(
      Number(entry.gameplayOverall)
      || Number(entry.gameplay_current_ability) / 2
      || Number(entry.player?.current_ability) / 2
      || 0,
    )),
    isCaptain: entry.isCaptain,
  }));
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
  const attributes = Array.isArray(player?.attributes)
    ? player.attributes
    : Array.isArray(player?.profile?.attributes)
      ? player.profile.attributes
      : [];
  for (const label of labels) {
    const match = attributes.find((item) =>
      String(item.label || "").toLowerCase() === label.toLowerCase());
    const value = Number(match?.value);
    if (value > 0) return value;
  }
  return clamp(5, 18, (Number(player?.current_ability) || 100) / 10);
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
  const captainAdjustment = (player) => player?.isCaptain ? 2.5 : 0;
  const scoredAverage = (items, scorer, fallback) => {
    const source = items.length ? items : fallback;
    return average(source.map((player) => scorer(player) + captainAdjustment(player)));
  };
  const attack = scoredAverage(strongest(attackers, attackerScore, 4), attackerScore, outfield);
  const midfield = scoredAverage(strongest(midfielders, midfielderScore, 5), midfielderScore, outfield);
  const defence = scoredAverage(strongest(defenders, defenderScore, 5), defenderScore, outfield);
  const goalkeeping = keeper
    ? goalkeeperScore(keeper) + captainAdjustment(keeper)
    : Math.max(30, average(lineup.map(playerAbility)) - 24);
  const overall = attack * 0.3 + midfield * 0.22 + defence * 0.3 + goalkeeping * 0.18;
  return { lineup, attack, midfield, defence, goalkeeping, overall };
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

function playerIdentity(player) {
  return `${player?.database_slug || DATABASE}:${player?.source_person_id || playerName(player)}`;
}

function playerReference(player) {
  return {
    name: playerName(player),
    database: player?.database_slug || DATABASE,
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

function randomMinute(random, occupied, start = 4, end = 88) {
  let minute = start + Math.floor(random() * Math.max(1, end - start + 1));
  while (occupied.has(minute) && minute < end) minute += 1;
  occupied.add(minute);
  return minute;
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
    specs.push({ minute: randomMinute(random, occupied, start, end), side: "user", kind: "goal" });
  }
  for (let index = 0; index < rivalGoals; index += 1) {
    specs.push({ minute: randomMinute(random, occupied, start, end), side: "opponent", kind: "goal" });
  }
  for (let index = 0; index < highlightCount; index += 1) {
    specs.push({
      minute: randomMinute(random, occupied, start, end),
      side: random() > 0.48 ? "user" : "opponent",
      kind: ["chance", "tackle", "cross", "counter"][Math.floor(random() * 4)],
    });
  }
  for (let index = 0; index < cardCount; index += 1) {
    specs.push({
      minute: randomMinute(random, occupied, start, end),
      side: random() > 0.5 ? "user" : "opponent",
      kind: "card",
    });
  }
  specs.sort((left, right) => left.minute - right.minute);

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
      events.push({
        minute: spec.minute,
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
      });
      continue;
    }

    if (spec.kind === "goal") {
      const opponentAttackers = active("opponent")
        .filter((player) => !isGoalkeeper(player));
      const scorer = spec.side === "user"
        ? weightedPlayer(active("user", "attack"), random, "attack", attackerScore)
        : weightedPlayer(
            opponentAttackers.length ? opponentAttackers : active("opponent"),
            random,
            "",
            attackerScore,
          );
      const keeper = goalkeeper(opponents);
      events.push({
        minute: spec.minute,
        side: spec.side,
        kind: spec.kind,
        goal: true,
        scorer: playerName(scorer),
        scorerPlayer: playerReference(scorer),
        text: `${playerName(scorer)} keeps calm and beats ${playerName(keeper)}.`,
      });
      continue;
    }

    const actorPool = players.filter((player) => !isGoalkeeper(player));
    const actorScore = spec.kind === "tackle"
      ? defenderScore
      : spec.kind === "chance"
        ? attackerScore
        : midfielderScore;
    const actor = weightedPlayer(
      actorPool.length ? actorPool : players,
      random,
      spec.kind === "counter" ? "attack" : "midfield",
      actorScore,
    );
    const defensiveOpponents = opponents.filter((player) => !isGoalkeeper(player));
    const other = weightedPlayer(
      defensiveOpponents.length ? defensiveOpponents : opponents,
      random,
      "defence",
      defenderScore,
    );
    const keeper = goalkeeper(opponents);
    const texts = {
      chance: `${playerName(actor)} tests ${playerName(keeper)}, who makes the save.`,
      tackle: `${playerName(actor)} drives forward, but ${playerName(other)} times the tackle perfectly.`,
      cross: `${playerName(actor)} bends in a dangerous cross and ${playerName(keeper)} claims it under pressure.`,
      counter: `${playerName(actor)} leads a rapid counter before ${playerName(other)} blocks the final pass.`,
    };
    events.push({
      minute: spec.minute,
      side: spec.side,
      kind: spec.kind,
      goal: false,
      scorer: playerName(actor),
      scorerPlayer: playerReference(actor),
      text: texts[spec.kind],
    });
  }
  return { events, disciplinary };
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
    const key = `${event.side}:${event.scorerPlayer?.database || DATABASE}:${event.scorerPlayer?.sourcePersonId || event.scorer}`;
    const entry = scores.get(key);
    if (!entry) continue;
    if (event.goal) entry.score += 4.4;
    else if (event.kind === "tackle") entry.score += 1.15;
    else if (["chance", "counter", "cross"].includes(event.kind)) entry.score += 0.72;
    if (event.card === "yellow") entry.score -= 0.45;
    if (event.card === "red") entry.score -= 2.2;
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
  const rngSwing = (random() + random() - 1) * 0.72;
  const userAttackEdge = (userModel.attack - rivalModel.defence) / 28;
  const rivalAttackEdge = (rivalModel.attack - userModel.defence) / 28;
  const midfieldEdge = (userModel.midfield - rivalModel.midfield) / 72;
  const userKeeperEffect = (72 - userModel.goalkeeping) / 62;
  const rivalKeeperEffect = (72 - rivalModel.goalkeeping) / 62;
  const userLambda = clamp(
    0.18,
    3.65,
    1.18 + userAttackEdge + midfieldEdge + rivalKeeperEffect + rngSwing,
  );
  const rivalLambda = clamp(
    0.18,
    3.65,
    1.18 + rivalAttackEdge - midfieldEdge + userKeeperEffect - rngSwing * 0.72,
  );
  const regularUserGoals = poisson(userLambda, random);
  const regularRivalGoals = poisson(rivalLambda, random);
  let userGoals = regularUserGoals;
  let rivalGoals = regularRivalGoals;
  const regularTimeline = buildTimeline({
    random,
    ourPlayers,
    roster,
    userGoals: regularUserGoals,
    rivalGoals: regularRivalGoals,
    start: 3,
    end: 89,
    highlightCount: 8 + Math.floor(random() * 4),
    cardCount: 1 + Math.floor(random() * 3),
  });
  const events = regularTimeline.events;
  let extraTimeEvents = [];
  const hasExtraTime = stage !== "Group stage" && userGoals === rivalGoals;
  if (hasExtraTime) {
    const extraUserGoals = poisson(userLambda * 0.28, random);
    const extraRivalGoals = poisson(rivalLambda * 0.28, random);
    userGoals += extraUserGoals;
    rivalGoals += extraRivalGoals;
    extraTimeEvents = buildTimeline({
      random,
      ourPlayers,
      roster,
      userGoals: extraUserGoals,
      rivalGoals: extraRivalGoals,
      start: 91,
      end: 120,
      highlightCount: 4,
      cardCount: random() < 0.5 ? 1 : 0,
      disciplinary: regularTimeline.disciplinary,
    }).events;
  }

  const userWon = userGoals > rivalGoals;
  const winnerSide = userGoals === rivalGoals ? "" : userWon ? "user" : "opponent";
  const allEvents = [...events, ...extraTimeEvents];
  const manOfMatch = manOfTheMatch(allEvents, userModel, rivalModel, random, winnerSide);
  const closeness = Math.abs(userLambda - rivalLambda) < 0.38 ? 35 : 0;
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
    events,
    extraTimeEvents,
    sentOffPlayerIds: [...regularTimeline.disciplinary.sentOff],
    formula: {
      userOvr,
      rivalOvr,
      rngRoll,
      userLambda: userLambda.toFixed(2),
      rivalLambda: rivalLambda.toFixed(2),
      userAttack: Math.round(userModel.attack),
      rivalAttack: Math.round(rivalModel.attack),
      userDefence: Math.round(userModel.defence),
      rivalDefence: Math.round(rivalModel.defence),
      userGoalkeeping: Math.round(userModel.goalkeeping),
      rivalGoalkeeping: Math.round(rivalModel.goalkeeping),
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
      player.database_slug || DATABASE,
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
  if (state.champion) return { label: "Champion", rank: 8 };
  if (state.outcomeStage) {
    const rank = Math.max(1, KNOCKOUT_STAGES.indexOf(state.outcomeStage) + 4);
    return { label: state.outcomeStage, rank };
  }
  const latest = state.userRecord.matches.at(-1)?.stage || "Group stage";
  const knockoutRank = KNOCKOUT_STAGES.indexOf(latest);
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
    runId: `${runSeed}:${team.teamName}`,
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
    .filter((event) => event.goal && event.side === "user")
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

function animatePeriod({
  start,
  end,
  events,
  eventList,
  score,
  scoreDisplay,
  clockDisplay,
  intervalMs = 100,
}) {
  return new Promise((resolve) => {
    let minute = start - 1;
    let eventIndex = 0;
    const timer = window.setInterval(() => {
      minute += 1;
      clockDisplay.textContent = `${minute}'`;
      while (events[eventIndex]?.minute <= minute) {
        const event = events[eventIndex];
        if (event.goal) {
          if (event.side === "user") score.user += 1;
          else score.opponent += 1;
          scoreDisplay.textContent = `${score.user} – ${score.opponent}`;
        }
        eventList.insertAdjacentHTML("beforeend", eventMarkup(event));
        eventIndex += 1;
      }
      if (minute < end) return;
      window.clearInterval(timer);
      resolve();
    }, intervalMs);
  });
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
  article.innerHTML = `
    <header>
      <span>${escapeHtml(result.stage)}</span>
      <div class="run-match-teams">
        <strong>${escapeHtml(team.teamName)}</strong>
        <span class="run-live-scoreboard">
          <b data-live-score>0 – 0</b>
          <span class="run-match-clock" data-match-clock aria-label="Match clock">0'</span>
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
    <ol class="run-event-list" data-live-events></ol>
  `;
  shell.append(article);
  elements.matches.append(shell);
  const scoreDisplay = article.querySelector("[data-live-score]");
  const clockDisplay = article.querySelector("[data-match-clock]");
  const eventList = article.querySelector("[data-live-events]");
  const summaryScore = shell.querySelector("[data-summary-score]");
  const score = { user: 0, opponent: 0 };

  await animatePeriod({
    start: 1,
    end: 90,
    events: result.events,
    eventList,
    score,
    scoreDisplay,
    clockDisplay,
    intervalMs: result.minuteDelay,
  });

  if (result.hasExtraTime) {
    const extra = document.createElement("section");
    extra.className = "run-extra-time-section";
    extra.innerHTML = '<h3>Extra time</h3><ol class="run-event-list" data-extra-events></ol>';
    article.append(extra);
    await animatePeriod({
      start: 91,
      end: 120,
      events: result.extraTimeEvents,
      eventList: extra.querySelector("[data-extra-events]"),
      score,
      scoreDisplay,
      clockDisplay,
      intervalMs: Math.max(70, result.minuteDelay - 15),
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
    const round = GROUP_ROUNDS[state.groupRound];
    return round
      ? { stage: `Group stage · Matchday ${state.groupRound + 1}`, opponentKey: round.userOpponent }
      : null;
  }
  const opponentKey = state.knockoutPath[state.knockoutIndex];
  return opponentKey
    ? { stage: KNOCKOUT_STAGES[state.knockoutIndex], opponentKey }
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

function currentRoundFixtures() {
  const groupWinner = state.groupPlace === 1 ? "user" : state.groupCompanion;
  const groupRunnerUp = state.groupPlace === 2 ? "user" : state.groupCompanion;
  if (state.knockoutIndex === 0) {
    return [
      ["bayern", "real"],
      ["lokomotiv", "monaco"],
      ["stuttgart", "chelsea"],
      [groupRunnerUp, "arsenal"],
      ["porto", "united"],
      ["sociedad", "lyon"],
      ["sparta", groupWinner],
      ["deportivo", "juventus"],
    ];
  }
  if (state.knockoutIndex === 1) {
    return state.groupPlace === 1
      ? [["real", "monaco"], ["chelsea", "arsenal"], ["porto", "lyon"], ["user", "deportivo"]]
      : [["real", "monaco"], ["user", "chelsea"], ["porto", "lyon"], [state.groupCompanion, "deportivo"]];
  }
  if (state.knockoutIndex === 2) {
    return state.groupPlace === 1
      ? [["monaco", "chelsea"], ["porto", "user"]]
      : [["monaco", "user"], ["porto", "deportivo"]];
  }
  return state.groupPlace === 1
    ? [["user", "monaco"]]
    : [["user", "porto"]];
}

function renderBracket() {
  elements.bracket.replaceChildren();
  if (state.completed) return;
  const stage = KNOCKOUT_STAGES[state.knockoutIndex];
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
      ? "The drafted XI complete the 2003–04 route and lift the trophy in Gelsenkirchen."
      : eliminatedBy
        ? `Eliminated in the ${escapeHtml(eliminatedStage)} by ${escapeHtml(eliminatedBy)}.`
        : `Finished ${state.groupPlace}${state.groupPlace === 3 ? "rd" : "th"} in Group H.`}</p>
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
  const round = GROUP_ROUNDS[state.groupRound];
  elements.nextButton.disabled = true;
  elements.stageDescription.textContent = "Loading both 03/04 squads and calculating the match model…";
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

  if (state.groupRound < GROUP_ROUNDS.length) {
    elements.stageTitle.textContent = `Group H · Matchday ${state.groupRound + 1}`;
    elements.stageDescription.textContent = "Standings updated. The next opponent is ready.";
    elements.nextButton.textContent = `Play Matchday ${state.groupRound + 1} →`;
    elements.nextButton.disabled = false;
    renderPendingFixture();
    return;
  }

  const standings = sortedTable();
  state.groupPlace = standings.findIndex((item) => item.key === "user") + 1;
  if (state.groupPlace > 2) {
    elements.stageTitle.textContent = `Finished ${state.groupPlace}${state.groupPlace === 3 ? "rd" : "th"} in Group H`;
    elements.stageDescription.textContent = "The knockout places are out of reach.";
    showResult({ eliminatedStage: "Group stage" });
    return;
  }

  state.groupCompanion = standings
    .slice(0, 2)
    .find((item) => item.key !== "user")?.key || "milan";
  state.phase = "knockout";
  state.knockoutPath = KNOCKOUT_PATHS[state.groupPlace];
  elements.bracketPanel.hidden = false;
  elements.stageKicker.textContent = "Qualified";
  elements.stageTitle.textContent = `${state.groupPlace === 1 ? "Group winners" : "Group runners-up"} · Round of 16`;
  elements.stageDescription.textContent = `Next: ${CLUBS[state.knockoutPath[0]].name}. Future opponents remain hidden.`;
  elements.nextButton.textContent = `Play ${CLUBS[state.knockoutPath[0]].name} →`;
  elements.nextButton.disabled = false;
  renderBracket();
  renderPendingFixture();
}

async function playKnockoutRound() {
  const opponentKey = state.knockoutPath[state.knockoutIndex];
  const stage = KNOCKOUT_STAGES[state.knockoutIndex];
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

  state.knockoutIndex += 1;
  if (state.knockoutIndex >= state.knockoutPath.length) {
    elements.stageTitle.textContent = "Champions of Europe";
    elements.stageDescription.textContent = "The final whistle confirms the title.";
    showResult({ champion: true });
    return;
  }

  renderBracket();
  const nextOpponent = state.knockoutPath[state.knockoutIndex];
  elements.stageKicker.textContent = KNOCKOUT_STAGES[state.knockoutIndex];
  elements.stageTitle.textContent = `${KNOCKOUT_STAGES[state.knockoutIndex]} · ${CLUBS[nextOpponent].name}`;
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
elements.seed.textContent = `Offline UCL 03/04 · Seed #${runSeed}`;

if (!team?.players || team.players.length !== 11 || !team.captainSlotId) {
  showMissingTeam();
} else {
  renderSquad();
  renderTable();
  renderPendingFixture();
}
