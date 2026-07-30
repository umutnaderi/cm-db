import { getPlayer, searchPlayers } from "./src/lib/retroballApi.js";

const TEAM_STORAGE_KEY = "retroball-draft-team-v1";
const OPPONENT_CACHE_KEY = "retroball-ucl-opponents-v1";
const DATABASE = "cm0304_vanilla_original";
const GROUP_TEAMS = ["user", "milan", "ajax", "brugge"];
const CLUBS = {
  milan: { name: "AC Milan", club: "AC Milan" },
  ajax: { name: "Ajax", club: "AFC Ajax" },
  brugge: { name: "Club Brugge", club: "Club Brugge KV" },
  arsenal: { name: "Arsenal", club: "Arsenal" },
  chelsea: { name: "Chelsea", club: "Chelsea" },
  monaco: { name: "Monaco", club: "AS Monaco FC" },
  porto: { name: "Porto", club: "Futebol Clube do Porto" },
  sparta: { name: "Sparta Prague", club: "Sparta Prague" },
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
  clock: document.querySelector("#runClock"),
  clockStatus: document.querySelector("#runClockStatus"),
  tableBody: document.querySelector("#runTableBody"),
  lineRatings: document.querySelector("#runLineRatings"),
  squadList: document.querySelector("#runSquadList"),
  bracketPanel: document.querySelector("#runBracketPanel"),
  bracket: document.querySelector("#runBracket"),
  resultCard: document.querySelector("#runResultCard"),
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
const runSeed = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 5)}`.toUpperCase();
const opponentCache = readJsonStorage(OPPONENT_CACHE_KEY, {});
const rosterMemory = new Map();
const penaltyRatingCache = new Map();
const state = {
  phase: "group",
  groupRound: 0,
  groupPlace: 0,
  knockoutIndex: 0,
  knockoutPath: [],
  busy: false,
  completed: false,
  userRecord: {
    played: 0,
    wins: 0,
    draws: 0,
    losses: 0,
    gf: 0,
    ga: 0,
    scorers: {},
  },
  table: new Map(),
  matchNumber: 0,
};

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

function opponentOverall(roster) {
  return Math.round(average(roster.slice(0, 11).map((player) =>
    Number(player.current_ability) / 2)));
}

function userPlayers() {
  return team.players.map((entry) => ({
    ...entry.player,
    role: entry.role,
    line: entry.line,
    overall: Math.round((Number(entry.player?.current_ability) || 0) / 2),
    isCaptain: entry.isCaptain,
  }));
}

function weightedPlayer(players, random, preferredLine = "") {
  if (!players.length) return null;
  const weighted = players.flatMap((player) => {
    const lineBoost = !preferredLine || player.line === preferredLine ? 3 : 1;
    const weight = Math.max(1, Math.round((Number(player.overall) || 65) / 20)) * lineBoost;
    return Array.from({ length: weight }, () => player);
  });
  return weighted[Math.floor(random() * weighted.length)] || players[0];
}

function playerIdentity(player) {
  return `${player?.database_slug || DATABASE}:${player?.source_person_id || playerName(player)}`;
}

function isGoalkeeper(player) {
  return player?.role === "GK"
    || /(^|\/|\s)GK($|\/|\s)/i.test(String(player?.position_text || ""));
}

function isDefender(player) {
  return player?.line === "defence"
    || /(^|\/|\s)(?:D|SW|WB)(?:\s|\/|$)/i.test(String(player?.position_text || ""));
}

function goalkeeper(players) {
  return players.find(isGoalkeeper) || players[0];
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
      const player = repeatCandidates.length && random() < 0.38
        ? pick(repeatCandidates)
        : pick(cardPool);
      const identity = `${spec.side}:${playerIdentity(player)}`;
      const directRed = random() < 0.1;
      const secondYellow = (yellows.get(identity) || 0) >= 1;
      if (directRed || secondYellow) sentOff.add(identity);
      else yellows.set(identity, 1);
      events.push({
        minute: spec.minute,
        side: spec.side,
        goal: false,
        card: directRed || secondYellow ? "red" : "yellow",
        scorer: playerName(player),
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
        ? weightedPlayer(active("user", "attack"), random)
        : pick(opponentAttackers.length ? opponentAttackers : active("opponent"));
      const keeper = goalkeeper(opponents);
      events.push({
        minute: spec.minute,
        side: spec.side,
        goal: true,
        scorer: playerName(scorer),
        text: `${playerName(scorer)} keeps calm and beats ${playerName(keeper)}.`,
      });
      continue;
    }

    const actor = spec.side === "user"
      ? weightedPlayer(players, random, spec.kind === "counter" ? "attack" : "midfield")
      : pick(players.filter((player) => !isGoalkeeper(player)));
    const other = pick(opponents);
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
      goal: false,
      scorer: playerName(actor),
      text: texts[spec.kind],
    });
  }
  return { events, disciplinary };
}

function matchSimulation(opponentKey, roster, stage, hidden = false) {
  const random = seededRandom(hashString(`${runSeed}:${stage}:${opponentKey}:${state.matchNumber}:${hidden}`));
  const userOvr = Number(team.overalls.team) || 70;
  const rivalOvr = opponentOverall(roster);
  const rngRoll = Math.round(random() * 100);
  const edge = (userOvr - rivalOvr) / 18;
  const swing = (rngRoll - 50) / 45;
  const userLambda = clamp(0.2, 3.8, 1.25 + edge + swing);
  const rivalLambda = clamp(0.2, 3.8, 1.25 - edge - swing * 0.55);
  const regularUserGoals = poisson(userLambda, random);
  const regularRivalGoals = poisson(rivalLambda, random);
  let userGoals = regularUserGoals;
  let rivalGoals = regularRivalGoals;
  const ourPlayers = userPlayers();
  const regularTimeline = buildTimeline({
    random,
    ourPlayers,
    roster,
    userGoals: regularUserGoals,
    rivalGoals: regularRivalGoals,
    start: 3,
    end: 89,
    highlightCount: 8 + Math.floor(random() * 4),
    cardCount: 2 + Math.floor(random() * 4),
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
    userWon: userGoals > rivalGoals,
    events,
    extraTimeEvents,
    sentOffPlayerIds: [...regularTimeline.disciplinary.sentOff],
    formula: {
      userOvr,
      rivalOvr,
      rngRoll,
      userLambda: userLambda.toFixed(2),
      rivalLambda: rivalLambda.toFixed(2),
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
      record.scorers[event.scorer] = (record.scorers[event.scorer] || 0) + 1;
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

function renderSquad() {
  elements.teamName.textContent = team.teamName;
  elements.teamOverall.textContent = `${team.overalls.team} OVR`;
  elements.lineRatings.innerHTML = `
    <span><small>Attack</small><strong>${team.overalls.attack}</strong></span>
    <span><small>Midfield</small><strong>${team.overalls.midfield}</strong></span>
    <span><small>Defence</small><strong>${team.overalls.defence}</strong></span>
  `;
  elements.squadList.replaceChildren();
  team.players.forEach((entry) => {
    const visibleOverall = Math.round(
      (Number(entry.player?.current_ability) || Number(entry.overall) * 2 || 0) / 2,
    );
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
  return `
    <li class="${event.goal ? "is-goal" : ""} ${event.card ? `is-${event.card}-card` : ""} ${event.side === "opponent" ? "is-opponent" : ""}">
      <time>${event.minute}'</time>
      <span><strong>${marker}${escapeHtml(event.scorer)}</strong>${escapeHtml(event.text)}</span>
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
}) {
  return new Promise((resolve) => {
    let minute = start - 1;
    let eventIndex = 0;
    const timer = window.setInterval(() => {
      minute += 1;
      elements.clock.textContent = `${minute}'`;
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
    }, 45);
  });
}

async function animatePenaltyShootout(result, article, scoreDisplay) {
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
  elements.clock.textContent = "PEN";
  elements.clockStatus.textContent = "Penalty shootout";

  for (const attempt of result.penaltyEvents) {
    await delay(260);
    if (attempt.userScored) ours += 1;
    if (attempt.opponentScored) theirs += 1;
    penaltyScore.textContent = `${ours} – ${theirs}`;
    list.insertAdjacentHTML("beforeend", `
      <li><b>${attempt.round}</b><span class="${attempt.userScored ? "is-scored" : "is-missed"}">${escapeHtml(attempt.userText)}</span><span class="${attempt.opponentScored ? "is-scored" : "is-missed"}">${escapeHtml(attempt.opponentText)}</span></li>
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
        <b data-live-score>0 – 0</b>
        <strong>${escapeHtml(result.opponentName)}</strong>
      </div>
    </header>
    <div class="run-formula">
      <span>Team OVR <b>${result.formula.userOvr}</b></span>
      <span>Opponent OVR <b>${result.formula.rivalOvr}</b></span>
      <span>Attack model <b>${result.formula.userLambda}–${result.formula.rivalLambda}</b></span>
      <span>RNG <b>${result.formula.rngRoll}/100</b></span>
    </div>
    <ol class="run-event-list" data-live-events></ol>
  `;
  shell.append(article);
  elements.matches.append(shell);
  const scoreDisplay = article.querySelector("[data-live-score]");
  const eventList = article.querySelector("[data-live-events]");
  const summaryScore = shell.querySelector("[data-summary-score]");
  const score = { user: 0, opponent: 0 };
  elements.clockStatus.textContent = `${team.teamName} vs ${result.opponentName}`;

  await animatePeriod({
    start: 1,
    end: 90,
    events: result.events,
    eventList,
    score,
    scoreDisplay,
  });

  if (result.hasExtraTime) {
    const extra = document.createElement("section");
    extra.className = "run-extra-time-section";
    extra.innerHTML = '<h3>Extra time</h3><ol class="run-event-list" data-extra-events></ol>';
    article.append(extra);
    elements.clockStatus.textContent = "Extra time";
    await animatePeriod({
      start: 91,
      end: 120,
      events: result.extraTimeEvents,
      eventList: extra.querySelector("[data-extra-events]"),
      score,
      scoreDisplay,
    });
  }

  if (result.shootout) await animatePenaltyShootout(result, article, scoreDisplay);
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
  elements.clockStatus.textContent = "Full time";
  await delay(500);
  shell.open = false;
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

function renderBracket() {
  elements.bracket.replaceChildren();
  const opponentKey = state.knockoutPath[state.knockoutIndex];
  if (!opponentKey || state.completed) return;
  const node = document.createElement("div");
  node.className = "run-bracket-node is-current";
  node.innerHTML = `
    <span>${KNOCKOUT_STAGES[state.knockoutIndex]}</span>
    <strong>${escapeHtml(team.teamName)}</strong>
    <small>vs ${escapeHtml(CLUBS[opponentKey].name)}</small>
  `;
  elements.bracket.append(node);
}

function showResult({ champion = false, eliminatedBy = "", eliminatedStage = "" } = {}) {
  state.completed = true;
  elements.nextButton.disabled = true;
  elements.nextButton.hidden = true;
  const record = state.userRecord;
  const [topScorer = "—", topGoals = 0] = Object.entries(record.scorers)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))[0] || [];
  const captain = team.players.find((entry) => entry.isCaptain);
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
      <span><small>Captain</small><strong>${escapeHtml(playerName(captain?.player))}</strong></span>
      <span><small>Top scorer</small><strong>${escapeHtml(topScorer)} · ${topGoals} goal${topGoals === 1 ? "" : "s"}</strong></span>
      <span><small>Exit stage</small><strong>${escapeHtml(champion ? "Winner" : eliminatedStage || "Group stage")}</strong></span>
    </div>
    <div class="run-result-actions">
      <button type="button" data-replay>Replay run</button>
      <a href="draft-setup.html">Edit team</a>
    </div>
  `;
  elements.resultCard.querySelector("[data-replay]").addEventListener("click", () => window.location.reload());
  elements.resultCard.scrollIntoView({ behavior: "smooth", block: "center" });
}

async function playGroupRound() {
  const round = GROUP_ROUNDS[state.groupRound];
  elements.nextButton.disabled = true;
  elements.stageDescription.textContent = "Loading both 03/04 squads and calculating the match model…";
  const [opponent, hiddenLeft, hiddenRight] = await Promise.all([
    opponentRoster(round.userOpponent),
    opponentRoster(round.hidden[0]),
    opponentRoster(round.hidden[1]),
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
  const roster = await opponentRoster(opponentKey);
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
  renderBracket();
  if (state.knockoutIndex >= state.knockoutPath.length) {
    elements.stageTitle.textContent = "Champions of Europe";
    elements.stageDescription.textContent = "The final whistle confirms the title.";
    showResult({ champion: true });
    return;
  }

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
elements.seed.textContent = `Offline UCL 03/04 · Seed #${runSeed}`;

if (!team?.players || team.players.length !== 11 || !team.captainSlotId) {
  showMissingTeam();
} else {
  renderSquad();
  renderTable();
  renderPendingFixture();
}
