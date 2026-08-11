import { getDatabases, getPlayerMetrics, searchPlayers } from "./src/lib/retroballApi.js?v=20260801-65";
import {
  computePressure,
  hashString,
  playerName,
  resolveDelivery,
  resolveEngagement,
  resolveFinishAttempt,
  resolveFoul,
  resolveFreeKickAttempt,
  resolveKeeperSave,
  resolveOneOnOne,
  resolveReceive,
  resolveWall,
  seededRandom,
  selectEngagement,
  selectFinishType,
  selectFreeKickShotType,
  selectReceiver,
} from "./src/lib/matchEngineCore.js?v=20260811-01";

// Match Lab -- a probe for the real match engine (see MATCH_LAB_PLAN.md).
// Every scenario below calls the exact resolver functions draft-run.js
// itself calls; nothing here re-derives or approximates engine logic. The
// pitch is a 12-zone grid because that's genuinely all the engine reasons
// about today -- placement is free-dragged for a natural feel, but every
// marker's engine zone is shown right alongside its visual position rather
// than implying precision the engine doesn't have.

const FIXED_MINUTE = 45;
const ROLE_LABELS = {
  attacker: "Attacker",
  receiver: "Receiver",
  defender: "Defender",
  keeper: "Keeper",
  wall: "Wall defender",
  candidate: "Pass candidate",
};

const SCENARIOS = [
  {
    id: "cross-header",
    label: "Cross & Header",
    description: "A delivered ball into the box: aerial race, header, keeper save. Calls resolveDelivery() directly.",
    roles: [
      { key: "receiver", count: 1 },
      { key: "defender", count: 1 },
      { key: "keeper", count: 1 },
    ],
    context: [],
    run(byRole, ctx, random, trace) {
      const receiver = byRole.receiver[0];
      const defender = byRole.defender[0];
      const keeper = byRole.keeper[0];
      const zone = receiver.zone;
      const delivery = resolveDelivery(receiver.player, defender.player, keeper.player, FIXED_MINUTE, random, zone);
      trace.push({
        code: delivery.code,
        label: delivery.goal
          ? `${playerName(receiver.player)} scores from the delivery`
          : delivery.rebound
            ? `${playerName(receiver.player)}'s effort spills loose`
            : `No goal -- ${playerName(defender.player)} or ${playerName(keeper.player)} deal with it`,
      });
      return { outcome: delivery.goal ? "GOAL" : "NO GOAL", code: delivery.code };
    },
  },
  {
    id: "receive",
    label: "Pass Reception (P.RECEIVE)",
    description: "What a successful pass costs the receiver to control. Calls resolveReceive() directly.",
    roles: [
      { key: "receiver", count: 1 },
      { key: "defender", count: 1 },
    ],
    context: [
      { key: "passQuality", label: "Pass quality", type: "range", min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: "pressure", label: "Pressure", type: "range", min: 0, max: 1, step: 0.01, default: 0.3 },
      { key: "bypass", label: "Fast/direct ball (bypass)", type: "checkbox", default: false },
    ],
    run(byRole, ctx, random, trace) {
      const receiver = byRole.receiver[0];
      const defender = byRole.defender[0];
      const zone = receiver.zone;
      const result = resolveReceive(
        receiver.player, defender.player, ctx.passQuality, ctx.pressure, ctx.bypass, zone, FIXED_MINUTE, random,
      );
      trace.push({
        code: result.context.code,
        label: `${playerName(receiver.player)}: ${result.status} (orientation ${result.context.orientation}, possession ${result.possession})`,
      });
      return { outcome: result.status.toUpperCase(), code: result.context.code };
    },
  },
  {
    id: "tackle-foul",
    label: "Tackle Engagement & Foul",
    description: "The defender's engagement choice, and the foul/card roll if it goes to ground. Calls selectEngagement()/resolveEngagement()/resolveFoul().",
    roles: [
      { key: "defender", count: 1 },
    ],
    context: [
      { key: "raceWasClose", label: "The race for the ball was close", type: "checkbox", default: false },
      { key: "isLastMan", label: "Defender is the last man back", type: "checkbox", default: false },
    ],
    run(byRole, ctx, random, trace) {
      const defender = byRole.defender[0];
      const zone = defender.zone;
      const zoneRow = Math.floor(zone / 3);
      const engagementType = selectEngagement(defender.player, ctx.raceWasClose, random);
      trace.push({ code: engagementType, label: `${playerName(defender.player)} chooses ${engagementType}` });
      const engagement = resolveEngagement(engagementType, defender.player, random, zoneRow);
      trace.push({ code: engagement.code, label: `Outcome: ${engagement.outcome}` });
      if (engagement.outcome !== "foul") {
        return { outcome: engagement.outcome.toUpperCase(), code: engagement.code };
      }
      const foul = resolveFoul(defender.player, engagementType, zone, ctx.isLastMan, FIXED_MINUTE, random);
      trace.push({
        code: `CARD.${foul.card.toUpperCase()}`,
        label: `Restart: ${foul.restart}${foul.advantage ? " (advantage played)" : ""}, card: ${foul.card}`,
      });
      return { outcome: `FOUL/${foul.card.toUpperCase()}`, code: `CARD.${foul.card.toUpperCase()}` };
    },
  },
  {
    id: "shot",
    label: "Shot Resolution",
    description: "Finish type, on-target roll, keeper save -- or a breakaway one-on-one. Calls selectFinishType()/resolveFinishAttempt()/resolveKeeperSave() or resolveOneOnOne().",
    roles: [
      { key: "attacker", count: 1 },
      { key: "keeper", count: 1 },
    ],
    context: [
      { key: "pressure", label: "Pressure", type: "range", min: 0, max: 1, step: 0.01, default: 0.3 },
      { key: "breakaway", label: "Breakaway (no defender close)", type: "checkbox", default: false },
    ],
    run(byRole, ctx, random, trace) {
      const shooter = byRole.attacker[0];
      const keeper = byRole.keeper[0];
      const zone = shooter.zone;
      if (ctx.breakaway) {
        const save = resolveOneOnOne(shooter.player, keeper.player, FIXED_MINUTE, random, zone);
        trace.push({
          code: save.code,
          label: save.goal ? `${playerName(shooter.player)} finishes coolly` : `${playerName(keeper.player)} deals with it`,
        });
        return { outcome: save.goal ? "GOAL" : "NO GOAL", code: save.code };
      }
      const finishType = selectFinishType(shooter.player, random, ctx.pressure);
      trace.push({ code: finishType.toUpperCase(), label: `${playerName(shooter.player)} goes for a ${finishType} finish` });
      const attempt = resolveFinishAttempt(finishType, shooter.player, random);
      trace.push({ code: attempt.code, label: attempt.onTarget ? "On target" : "Off target" });
      if (!attempt.onTarget) return { outcome: "NO GOAL", code: attempt.code };
      const save = resolveKeeperSave(shooter.player, keeper.player, finishType, FIXED_MINUTE, random, zone);
      trace.push({
        code: save.code,
        label: save.goal ? `${playerName(shooter.player)} scores` : `${playerName(keeper.player)} saves it`,
      });
      return { outcome: save.goal ? "GOAL" : "NO GOAL", code: save.code };
    },
  },
  {
    id: "free-kick",
    label: "Free Kick",
    description: "Wall contact first, then the shot if it gets past. Calls resolveWall(), then selectFreeKickShotType()/resolveFreeKickAttempt()/resolveKeeperSave().",
    roles: [
      { key: "attacker", count: 1 },
      { key: "keeper", count: 1 },
      { key: "wall", count: 0 },
    ],
    context: [],
    run(byRole, ctx, random, trace) {
      const taker = byRole.attacker[0];
      const keeper = byRole.keeper[0];
      const wallPlayers = (byRole.wall || []).map((entry) => entry.player);
      const wall = resolveWall(taker.player, wallPlayers, random);
      trace.push({
        code: wall.code,
        label: wall.hit ? `Blocked by the wall (${wall.outcome})` : "Clears the wall",
      });
      if (wall.hit) return { outcome: `WALL/${wall.outcome.toUpperCase()}`, code: wall.code };
      const shotType = selectFreeKickShotType(taker.player, random);
      trace.push({ code: shotType.toUpperCase(), label: `${playerName(taker.player)} goes for a ${shotType} strike` });
      const attempt = resolveFreeKickAttempt(shotType, taker.player, random);
      trace.push({ code: attempt.code, label: attempt.onTarget ? "On target" : "Off target" });
      if (!attempt.onTarget) return { outcome: "NO GOAL", code: attempt.code };
      const keeperFinishType = { regular: "calm", hard: "blast", curl: "finesse" }[shotType] || "calm";
      const save = resolveKeeperSave(taker.player, keeper.player, keeperFinishType, FIXED_MINUTE, random, 1);
      trace.push({
        code: save.code,
        label: save.goal ? `${playerName(taker.player)} scores direct` : `${playerName(keeper.player)} saves it`,
      });
      return { outcome: save.goal ? "GOAL" : "NO GOAL", code: save.code };
    },
  },
];

const elements = {
  seed: document.querySelector("#labSeed"),
  databaseSelect: document.querySelector("#labDatabaseSelect"),
  searchInput: document.querySelector("#labSearchInput"),
  searchStatus: document.querySelector("#labSearchStatus"),
  searchResults: document.querySelector("#labSearchResults"),
  pitch: document.querySelector("#labPitch"),
  roster: document.querySelector("#labRoster"),
  scenarioSelect: document.querySelector("#labScenarioSelect"),
  scenarioDescription: document.querySelector("#labScenarioDescription"),
  roleRequirements: document.querySelector("#labRoleRequirements"),
  contextControls: document.querySelector("#labContextControls"),
  playButton: document.querySelector("#labPlayButton"),
  replayButton: document.querySelector("#labReplayButton"),
  rerollButton: document.querySelector("#labRerollButton"),
  stepButton: document.querySelector("#labStepButton"),
  resetButton: document.querySelector("#labResetButton"),
  runCountInput: document.querySelector("#labRunCountInput"),
  runNButton: document.querySelector("#labRunNButton"),
  inspector: document.querySelector("#labInspector"),
  inspectorList: document.querySelector("#labInspectorList"),
  trace: document.querySelector("#labTrace"),
  traceList: document.querySelector("#labTraceList"),
  distribution: document.querySelector("#labDistribution"),
  distributionCount: document.querySelector("#labDistributionCount"),
  distributionList: document.querySelector("#labDistributionList"),
};

const state = {
  database: "",
  roster: [], // { id, role, player, x, y, zone }
  // No scenario's run() consumes ballOwnerId/zone today -- every current
  // probe takes its zone from a placed player instead (see MATCH_LAB_PLAN.md,
  // "not yet reached" gaps). It's placed and draggable now anyway, because
  // that was part of the original ask and it's exactly the piece
  // runConstructedPossession()/Free Play will need next.
  ball: { x: 50, y: 50, zone: zoneFromPercent(50, 50), ownerId: null },
  scenario: SCENARIOS[0],
  context: {},
  seed: Math.floor(Math.random() * 1_000_000),
  lastTrace: null,
  stepIndex: 0,
  markerCounter: 0,
};

function zoneFromPercent(x, y) {
  const column = Math.min(2, Math.max(0, Math.floor(x / (100 / 3))));
  const row = Math.min(3, Math.max(0, Math.floor(y / 25)));
  return row * 3 + column;
}

function rosterByRole() {
  const grouped = {};
  for (const entry of state.roster) {
    (grouped[entry.role] ||= []).push(entry);
  }
  return grouped;
}

function scenarioIsReady() {
  const grouped = rosterByRole();
  // role.count is the real declared minimum, including 0 for genuinely
  // optional roles (e.g. Free Kick's wall) -- do not clamp it to 1, that
  // silently turns "optional" into "required."
  return state.scenario.roles.every((role) => (grouped[role.key] || []).length >= role.count);
}

// --- Player search --------------------------------------------------------

let searchTimer = null;
elements.searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 260);
});
elements.databaseSelect.addEventListener("change", () => {
  state.database = elements.databaseSelect.value;
  runSearch();
});

async function loadDatabases() {
  try {
    const databases = (await getDatabases())
      .slice()
      .sort((left, right) => left.season_order - right.season_order || left.title.localeCompare(right.title));
    if (!databases.length) throw new Error("No converted databases are available.");
    elements.databaseSelect.innerHTML = databases
      .map((database) => `<option value="${database.slug}">${database.title}</option>`)
      .join("");
    const latest = databases.reduce((best, database) => database.season_order > best.season_order ? database : best);
    state.database = latest.slug;
    elements.databaseSelect.value = state.database;
  } catch (error) {
    elements.searchStatus.textContent = `Could not load databases: ${error.message}`;
  }
}

async function runSearch() {
  const query = elements.searchInput.value.trim();
  if (query.length < 2 || !state.database) {
    elements.searchStatus.textContent = "Type at least 2 characters.";
    elements.searchResults.innerHTML = "";
    return;
  }
  elements.searchStatus.textContent = "Searching…";
  try {
    const result = await searchPlayers({ database: state.database, q: query, pageSize: 20 });
    elements.searchStatus.textContent = result.items.length ? "" : "No players found.";
    elements.searchResults.innerHTML = result.items.map((item, index) => `
      <li class="match-lab-search-result">
        <span>
          <span class="match-lab-search-result-name">${playerName(item)}</span><br>
          <span class="match-lab-search-result-meta">${item.position_text || item.role || ""} · CA ${item.current_ability ?? "?"}</span>
        </span>
        <button type="button" data-add-index="${index}">Add</button>
      </li>
    `).join("");
    elements.searchResults.querySelectorAll("[data-add-index]").forEach((button) => {
      button.addEventListener("click", () => addPlayer(result.items[Number(button.dataset.addIndex)]));
    });
  } catch (error) {
    elements.searchStatus.textContent = `Search failed: ${error.message}`;
  }
}

async function addPlayer(candidate) {
  let player = candidate;
  try {
    const metrics = await getPlayerMetrics([candidate]);
    const metric = metrics.items?.[0];
    if (metric) player = { ...candidate, ...metric };
  } catch {
    // Falls back to CA-baseline attribute resolution if metrics are unavailable.
  }
  state.markerCounter += 1;
  const grouped = rosterByRole();
  const defaultRole = state.scenario.roles.find((role) => (grouped[role.key] || []).length < role.count);
  const x = 20 + Math.random() * 60;
  const y = 20 + Math.random() * 60;
  state.roster.push({
    id: `marker-${state.markerCounter}`,
    role: defaultRole ? defaultRole.key : "candidate",
    player,
    x,
    y,
    zone: zoneFromPercent(x, y),
  });
  renderRoster();
  renderPitch();
  renderRoleRequirements();
  updateInspector();
}

// --- Pitch + markers --------------------------------------------------------

function renderPitch() {
  elements.pitch.querySelectorAll(".match-lab-marker").forEach((node) => node.remove());
  for (const entry of state.roster) {
    const marker = document.createElement("div");
    marker.className = "match-lab-marker";
    marker.dataset.role = entry.role;
    marker.dataset.id = entry.id;
    marker.style.setProperty("--marker-x", `${entry.x}%`);
    marker.style.setProperty("--marker-y", `${entry.y}%`);
    marker.innerHTML = `
      <span class="match-lab-marker-dot">${initials(playerName(entry.player))}</span>
      <span class="match-lab-marker-label">${playerName(entry.player)} · Z${entry.zone}</span>
    `;
    marker.addEventListener("pointerdown", (event) =>
      startDrag(event, entry, () => `${playerName(entry.player)} · Z${entry.zone}`));
    elements.pitch.appendChild(marker);
  }

  const ballMarker = document.createElement("div");
  ballMarker.className = "match-lab-marker match-lab-marker-ball";
  ballMarker.style.setProperty("--marker-x", `${state.ball.x}%`);
  ballMarker.style.setProperty("--marker-y", `${state.ball.y}%`);
  ballMarker.innerHTML = `
    <span class="match-lab-marker-dot" aria-hidden="true"></span>
    <span class="match-lab-marker-label">Ball · Z${state.ball.zone}</span>
  `;
  ballMarker.addEventListener("pointerdown", (event) =>
    startDrag(event, state.ball, () => `Ball · Z${state.ball.zone}`));
  elements.pitch.appendChild(ballMarker);
}

function initials(name) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function startDrag(event, entry, describeLabel) {
  event.preventDefault();
  const marker = event.currentTarget;
  marker.setPointerCapture(event.pointerId);
  const move = (moveEvent) => {
    const rect = elements.pitch.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((moveEvent.clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((moveEvent.clientY - rect.top) / rect.height) * 100));
    entry.x = x;
    entry.y = y;
    entry.zone = zoneFromPercent(x, y);
    marker.style.setProperty("--marker-x", `${x}%`);
    marker.style.setProperty("--marker-y", `${y}%`);
    marker.querySelector(".match-lab-marker-label").textContent = describeLabel();
    renderRoster();
    updateInspector();
  };
  const up = () => {
    marker.removeEventListener("pointermove", move);
    marker.removeEventListener("pointerup", up);
  };
  marker.addEventListener("pointermove", move);
  marker.addEventListener("pointerup", up);
}

// --- Roster panel -----------------------------------------------------------

function renderRoster() {
  elements.roster.innerHTML = state.roster.map((entry) => `
    <li class="match-lab-roster-item">
      <span>${playerName(entry.player)} <span class="match-lab-roster-zone">Zone ${entry.zone}</span></span>
      <select data-roster-role="${entry.id}">
        ${Object.entries(ROLE_LABELS).map(([key, label]) =>
          `<option value="${key}"${entry.role === key ? " selected" : ""}>${label}</option>`).join("")}
      </select>
      <button type="button" data-roster-remove="${entry.id}">✕</button>
    </li>
  `).join("");
  elements.roster.querySelectorAll("[data-roster-role]").forEach((select) => {
    select.addEventListener("change", () => {
      const entry = state.roster.find((item) => item.id === select.dataset.rosterRole);
      if (entry) entry.role = select.value;
      renderPitch();
      renderRoleRequirements();
      updateInspector();
    });
  });
  elements.roster.querySelectorAll("[data-roster-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      state.roster = state.roster.filter((item) => item.id !== button.dataset.rosterRemove);
      renderRoster();
      renderPitch();
      renderRoleRequirements();
      updateInspector();
    });
  });
}

// --- Scenario + context controls --------------------------------------------

function renderScenarioOptions() {
  elements.scenarioSelect.innerHTML = SCENARIOS.map((scenario) =>
    `<option value="${scenario.id}">${scenario.label}</option>`).join("");
  elements.scenarioSelect.value = state.scenario.id;
}

elements.scenarioSelect.addEventListener("change", () => {
  state.scenario = SCENARIOS.find((scenario) => scenario.id === elements.scenarioSelect.value) || SCENARIOS[0];
  state.context = {};
  for (const field of state.scenario.context) state.context[field.key] = field.default;
  renderScenarioDetails();
  clearResults();
});

function renderScenarioDetails() {
  elements.scenarioDescription.textContent = state.scenario.description;
  renderRoleRequirements();
  renderContextControls();
}

function renderRoleRequirements() {
  const grouped = rosterByRole();
  elements.roleRequirements.innerHTML = state.scenario.roles.map((role) => {
    const have = (grouped[role.key] || []).length;
    const filled = have >= role.count;
    const countLabel = role.count === 0 ? `${have} (optional)` : `${have}/${role.count}`;
    return `<span class="match-lab-role-chip" data-filled="${filled}">${ROLE_LABELS[role.key]} ${countLabel}</span>`;
  }).join("");
  elements.playButton.disabled = !scenarioIsReady();
  elements.rerollButton.disabled = !scenarioIsReady();
}

function renderContextControls() {
  elements.contextControls.innerHTML = state.scenario.context.map((field) => {
    if (field.type === "checkbox") {
      return `
        <label class="match-lab-checkbox">
          <input type="checkbox" data-context-key="${field.key}"${state.context[field.key] ? " checked" : ""}>
          ${field.label}
        </label>
      `;
    }
    return `
      <label>
        ${field.label}
        <input type="range" data-context-key="${field.key}" min="${field.min}" max="${field.max}" step="${field.step}" value="${state.context[field.key]}">
        <output data-context-output="${field.key}">${Number(state.context[field.key]).toFixed(2)}</output>
      </label>
    `;
  }).join("");
  elements.contextControls.querySelectorAll("[data-context-key]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.contextKey;
      state.context[key] = input.type === "checkbox" ? input.checked : Number(input.value);
      const output = elements.contextControls.querySelector(`[data-context-output="${key}"]`);
      if (output) output.textContent = Number(input.value).toFixed(2);
    });
  });
}

// --- Live inspector (pressure / receiver weights) ---------------------------

function updateInspector() {
  const rows = [];
  const grouped = rosterByRole();
  const defender = (grouped.defender || [])[0];
  if (defender) {
    const pressure = computePressure(defender.player, defender.zone, 0);
    rows.push(["Pressure near " + playerName(defender.player), pressure.toFixed(2)]);
  }
  const candidates = grouped.candidate || [];
  if (candidates.length >= 2) {
    // Empirical, not analytic: samples the real selectReceiver() many times
    // rather than re-deriving its internal weight formula here, so this
    // panel can never silently drift from what the engine actually does.
    const random = seededRandom(hashString(`inspector-receiver-weights:${state.seed}`));
    const targetZone = candidates[0].zone;
    const passerVision = 14; // no "passer" role in this tool -- a representative mid value
    const pressureValue = state.context.pressure ?? 0.3;
    const pool = candidates.map((entry) => entry.player);
    const hits = new Map();
    const sampleCount = 300;
    for (let index = 0; index < sampleCount; index += 1) {
      const picked = selectReceiver(pool, targetZone, passerVision, pressureValue, random);
      hits.set(picked, (hits.get(picked) || 0) + 1);
    }
    for (const entry of candidates) {
      const share = Math.round(((hits.get(entry.player) || 0) / sampleCount) * 100);
      // Labeled "suitability sample," not e.g. "passing options": there's no
      // real passer role yet (see MATCH_LAB_PLAN.md, "Next up"), so this
      // uses a fixed placeholder Vision value, not any placed player's
      // actual attributes -- calling it a specific passer's choice would
      // claim the engine is evaluating something it isn't yet.
      rows.push([`Receiver suitability sample: ${playerName(entry.player)}`, `${share}%`]);
    }
  }
  elements.inspector.hidden = rows.length === 0;
  elements.inspectorList.innerHTML = rows.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join("");
}

// --- Roll / Replay / Reroll / Step / Reset / Run N --------------------------

function runScenarioOnce(seed) {
  const random = seededRandom(hashString(`match-lab:${seed}`));
  const trace = [];
  const grouped = rosterByRole();
  const result = state.scenario.run(grouped, state.context, random, trace);
  return { result, trace };
}

function renderTrace(upToIndex) {
  const trace = state.lastTrace || [];
  const visible = trace.slice(0, upToIndex);
  elements.trace.hidden = visible.length === 0;
  elements.traceList.innerHTML = visible.map((step) =>
    `<li><span class="match-lab-trace-code">${step.code}</span> — ${step.label}</li>`).join("");
}

elements.playButton.addEventListener("click", () => {
  if (!scenarioIsReady()) return;
  elements.seed.textContent = String(state.seed);
  const { trace } = runScenarioOnce(state.seed);
  state.lastTrace = trace;
  state.stepIndex = trace.length;
  renderTrace(state.stepIndex);
  elements.distribution.hidden = true;
});

elements.replayButton.addEventListener("click", () => {
  if (!state.lastTrace) return;
  state.stepIndex = state.lastTrace.length;
  renderTrace(state.stepIndex);
});

elements.rerollButton.addEventListener("click", () => {
  if (!scenarioIsReady()) return;
  state.seed += 1;
  elements.seed.textContent = String(state.seed);
  const { trace } = runScenarioOnce(state.seed);
  state.lastTrace = trace;
  state.stepIndex = trace.length;
  renderTrace(state.stepIndex);
  elements.distribution.hidden = true;
});

elements.stepButton.addEventListener("click", () => {
  if (!state.lastTrace) return;
  if (state.stepIndex >= state.lastTrace.length) state.stepIndex = 0;
  else state.stepIndex += 1;
  renderTrace(state.stepIndex);
});

elements.resetButton.addEventListener("click", () => {
  state.roster = [];
  state.ball = { x: 50, y: 50, zone: zoneFromPercent(50, 50), ownerId: null };
  state.lastTrace = null;
  state.stepIndex = 0;
  renderRoster();
  renderPitch();
  renderRoleRequirements();
  clearResults();
});

elements.runNButton.addEventListener("click", () => {
  if (!scenarioIsReady()) return;
  const count = Math.max(2, Math.min(2000, Number(elements.runCountInput.value) || 200));
  const tally = new Map();
  for (let index = 0; index < count; index += 1) {
    const { result } = runScenarioOnce(`${state.seed}:run:${index}`);
    tally.set(result.outcome, (tally.get(result.outcome) || 0) + 1);
  }
  const sorted = [...tally.entries()].sort((left, right) => right[1] - left[1]);
  elements.distributionCount.textContent = String(count);
  elements.distribution.hidden = false;
  elements.distributionList.innerHTML = sorted.map(([outcome, hits]) => {
    const percent = Math.round((hits / count) * 100);
    return `
      <li>
        <span>${outcome}</span>
        <span class="match-lab-distribution-bar" style="width:${Math.max(4, percent)}px"></span>
        <span>${percent}% (${hits})</span>
      </li>
    `;
  }).join("");
});

function clearResults() {
  state.lastTrace = null;
  state.stepIndex = 0;
  elements.trace.hidden = true;
  elements.distribution.hidden = true;
}

// --- Init ---------------------------------------------------------------

elements.seed.textContent = String(state.seed);
renderScenarioOptions();
renderScenarioDetails();
renderRoster();
renderPitch();
updateInspector();
loadDatabases().then(runSearch);
