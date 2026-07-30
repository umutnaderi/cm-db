import { searchPlayers } from "./src/lib/retroballApi.js";

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
const state = {
  phase: "group",
  groupRound: 0,
  groupPlace: 0,
  knockoutIndex: 0,
  knockoutPath: [],
  busy: false,
  completed: false,
  userRecord: { played: 0, wins: 0, draws: 0, losses: 0, gf: 0, ga: 0 },
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
    overall: entry.overall,
    isCaptain: entry.isCaptain,
  }));
}

function weightedPlayer(players, random, preferredLine = "") {
  const weighted = players.flatMap((player) => {
    const lineBoost = !preferredLine || player.line === preferredLine ? 3 : 1;
    const weight = Math.max(1, Math.round((Number(player.overall) || 65) / 20)) * lineBoost;
    return Array.from({ length: weight }, () => player);
  });
  return weighted[Math.floor(random() * weighted.length)] || players[0];
}

function randomMinute(random, occupied) {
  let minute = 4 + Math.floor(random() * 84);
  while (occupied.has(minute) && minute < 90) minute += 1;
  occupied.add(minute);
  return minute;
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
  let userGoals = poisson(userLambda, random);
  let rivalGoals = poisson(rivalLambda, random);
  let shootout = null;

  if (stage !== "Group stage" && userGoals === rivalGoals) {
    const userPenaltyChance = clamp(0.32, 0.68, 0.5 + (userOvr - rivalOvr) / 100);
    const userWon = random() < userPenaltyChance;
    shootout = userWon
      ? [4 + Math.floor(random() * 2), 2 + Math.floor(random() * 2)]
      : [2 + Math.floor(random() * 2), 4 + Math.floor(random() * 2)];
  }

  const occupied = new Set();
  const events = [];
  const ourPlayers = userPlayers();
  for (let index = 0; index < userGoals; index += 1) {
    const scorer = weightedPlayer(ourPlayers, random, "attack");
    const defender = roster[Math.floor(random() * Math.min(11, roster.length))];
    events.push({
      minute: randomMinute(random, occupied),
      side: "user",
      goal: true,
      scorer: playerName(scorer),
      text: `${playerName(scorer)} finishes after beating ${playerName(defender)}.`,
    });
  }
  for (let index = 0; index < rivalGoals; index += 1) {
    const scorer = roster[Math.floor(random() * Math.min(8, roster.length))];
    const defender = weightedPlayer(ourPlayers, random, "defence");
    events.push({
      minute: randomMinute(random, occupied),
      side: "opponent",
      goal: true,
      scorer: playerName(scorer),
      text: `${playerName(scorer)} finds space beyond ${playerName(defender)}.`,
    });
  }

  for (let index = 0; index < 3; index += 1) {
    const ours = random() > 0.45;
    const actor = ours
      ? weightedPlayer(ourPlayers, random, index === 0 ? "midfield" : "")
      : roster[Math.floor(random() * Math.min(11, roster.length))];
    const other = ours
      ? roster[Math.floor(random() * Math.min(11, roster.length))]
      : weightedPlayer(ourPlayers, random, "defence");
    events.push({
      minute: randomMinute(random, occupied),
      side: ours ? "user" : "opponent",
      goal: false,
      scorer: playerName(actor),
      text: `${playerName(actor)} tests ${playerName(other)}, but the move breaks down.`,
    });
  }
  events.sort((left, right) => left.minute - right.minute);

  return {
    opponentKey,
    opponentName: CLUBS[opponentKey].name,
    stage,
    userGoals,
    rivalGoals,
    shootout,
    userWon: shootout ? shootout[0] > shootout[1] : userGoals > rivalGoals,
    events,
    formula: {
      userOvr,
      rivalOvr,
      rngRoll,
      userLambda: userLambda.toFixed(2),
      rivalLambda: rivalLambda.toFixed(2),
    },
  };
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
    const item = document.createElement("li");
    item.innerHTML = `
      <span>${escapeHtml(entry.role)}</span>
      <strong>${escapeHtml(playerName(entry.player))}${entry.isCaptain ? " (C)" : ""}</strong>
      <b>${entry.overall}</b>
    `;
    elements.squadList.append(item);
  });
}

function eventMarkup(event) {
  return `
    <li class="${event.goal ? "is-goal" : ""} ${event.side === "opponent" ? "is-opponent" : ""}">
      <time>${event.minute}'</time>
      <span><strong>${event.goal ? "● " : ""}${escapeHtml(event.scorer)}</strong>${escapeHtml(event.text)}</span>
    </li>
  `;
}

function animateMatch(result) {
  return new Promise((resolve) => {
    if (elements.matches.querySelector(".run-empty")) elements.matches.replaceChildren();
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
    elements.matches.append(article);
    const score = article.querySelector("[data-live-score]");
    const eventList = article.querySelector("[data-live-events]");
    let minute = 0;
    let userScore = 0;
    let rivalScore = 0;
    let eventIndex = 0;
    elements.clockStatus.textContent = `${team.teamName} vs ${result.opponentName}`;

    const timer = window.setInterval(() => {
      minute += 1;
      elements.clock.textContent = `${minute}'`;
      while (result.events[eventIndex]?.minute === minute) {
        const event = result.events[eventIndex];
        if (event.goal) {
          if (event.side === "user") userScore += 1;
          else rivalScore += 1;
          score.textContent = `${userScore} – ${rivalScore}`;
        }
        eventList.insertAdjacentHTML("beforeend", eventMarkup(event));
        eventIndex += 1;
      }
      if (minute < 90) return;
      window.clearInterval(timer);
      article.classList.remove("is-live");
      article.classList.add(result.userWon ? "is-win" : result.userGoals === result.rivalGoals && !result.shootout ? "is-draw" : "is-loss");
      score.textContent = `${result.userGoals} – ${result.rivalGoals}`;
      if (result.shootout) {
        const shootout = document.createElement("p");
        shootout.className = "run-shootout";
        shootout.textContent = `Penalties: ${team.teamName} ${result.shootout[0]}–${result.shootout[1]} ${result.opponentName}`;
        article.append(shootout);
      }
      elements.clockStatus.textContent = "Full time";
      window.setTimeout(resolve, 350);
    }, 45);
  });
}

function renderBracket() {
  elements.bracket.replaceChildren();
  state.knockoutPath.forEach((opponentKey, index) => {
    const node = document.createElement("div");
    node.className = "run-bracket-node";
    if (index < state.knockoutIndex) node.classList.add("is-complete");
    if (index === state.knockoutIndex && !state.completed) node.classList.add("is-current");
    node.innerHTML = `
      <span>${KNOCKOUT_STAGES[index]}</span>
      <strong>${escapeHtml(team.teamName)}</strong>
      <small>vs ${escapeHtml(CLUBS[opponentKey].name)}</small>
    `;
    elements.bracket.append(node);
  });
}

function showResult({ champion = false, eliminatedBy = "" } = {}) {
  state.completed = true;
  elements.nextButton.disabled = true;
  elements.nextButton.hidden = true;
  const record = state.userRecord;
  elements.resultCard.hidden = false;
  elements.resultCard.className = `run-result-card ${champion ? "is-champion" : "is-eliminated"}`;
  elements.resultCard.innerHTML = `
    <span class="draft-panel-kicker">${champion ? "Champions of Europe" : "Run complete"}</span>
    <h2>${champion ? `${escapeHtml(team.teamName)} win the cup!` : `${escapeHtml(team.teamName)} are eliminated`}</h2>
    <p>${champion
      ? "The drafted XI complete the 2003–04 route and lift the trophy in Gelsenkirchen."
      : eliminatedBy
        ? `Eliminated by ${escapeHtml(eliminatedBy)}.`
        : `Finished ${state.groupPlace}${state.groupPlace === 3 ? "rd" : "th"} in Group H.`}</p>
    <div class="run-result-stats">
      <span><strong>${record.gf}</strong><small>Goals for</small></span>
      <span><strong>${record.ga}</strong><small>Against</small></span>
      <span><strong>${record.wins}</strong><small>Wins</small></span>
      <span><strong>${record.draws}</strong><small>Draws</small></span>
      <span><strong>${record.losses}</strong><small>Losses</small></span>
      <span><strong>${state.groupPlace || "—"}</strong><small>Group place</small></span>
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
    return;
  }

  const standings = sortedTable();
  state.groupPlace = standings.findIndex((item) => item.key === "user") + 1;
  if (state.groupPlace > 2) {
    elements.stageTitle.textContent = `Finished ${state.groupPlace}${state.groupPlace === 3 ? "rd" : "th"} in Group H`;
    elements.stageDescription.textContent = "The knockout places are out of reach.";
    showResult();
    return;
  }

  state.phase = "knockout";
  state.knockoutPath = KNOCKOUT_PATHS[state.groupPlace];
  elements.bracketPanel.hidden = false;
  elements.stageKicker.textContent = "Qualified";
  elements.stageTitle.textContent = `${state.groupPlace === 1 ? "Group winners" : "Group runners-up"} · Round of 16`;
  elements.stageDescription.textContent = `The ${state.groupPlace === 1 ? "first-place" : "second-place"} route is now locked.`;
  elements.nextButton.textContent = `Play ${CLUBS[state.knockoutPath[0]].name} →`;
  elements.nextButton.disabled = false;
  renderBracket();
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
  await animateMatch(result);
  updateUserRecord(result);

  if (!result.userWon) {
    elements.stageDescription.textContent = "The European run ends here.";
    showResult({ eliminatedBy: CLUBS[opponentKey].name });
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
}
