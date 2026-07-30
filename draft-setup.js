import { getDraftCandidates } from "./src/lib/retroballApi.js";

const PITCH_ROWS = {
  F: 14,
  AM: 30,
  M: 46,
  DM: 62,
  WB: 68,
  D: 78,
  SW: 86,
  GK: 94,
};

const STYLE_ROLE_PREFIX = {
  Defensive: "DM",
  Balanced: "M",
  Attacking: "AM",
};

function slot(role, x, options = {}) {
  return { role, x, ...options };
}

const formations = {
  "4-3-3": [
    slot("GK", 50), slot("DL", 17), slot("DC", 39), slot("DC", 61), slot("DR", 83),
    slot("MC", 28, { styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "MC" } }),
    slot("MC", 50, { styleRoles: { Defensive: "MC", Balanced: "MC", Attacking: "AMC" } }),
    slot("MC", 74, { styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "MC" } }),
    slot("FL", 17), slot("FC", 50), slot("FR", 83),
  ],
  "4-4-2": [
    slot("GK", 50), slot("DL", 17), slot("DC", 39), slot("DC", 61), slot("DR", 83),
    slot("ML", 17, { styleRoles: { Defensive: "ML", Balanced: "ML", Attacking: "AML" } }),
    slot("MC", 40, { styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "MC" } }),
    slot("MC", 60, { styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "MC" } }),
    slot("MR", 83, { styleRoles: { Defensive: "MR", Balanced: "MR", Attacking: "AMR" } }),
    slot("FC", 39), slot("FC", 61),
  ],
  "4-2-3-1": [
    slot("GK", 50), slot("DL", 17), slot("DC", 39), slot("DC", 61), slot("DR", 83),
    slot("DMC", 39),
    slot("DMC", 61, { styleRoles: { Defensive: "DMC", Balanced: "DMC", Attacking: "MC" } }),
    slot("AML", 17, { styleRoles: { Defensive: "ML", Balanced: "ML", Attacking: "AML" } }),
    slot("AMC", 50, { styleRoles: { Defensive: "MC", Balanced: "AMC", Attacking: "AMC" } }),
    slot("AMR", 83, { styleRoles: { Defensive: "MR", Balanced: "MR", Attacking: "AMR" } }),
    slot("FC", 50),
  ],
  "4-1-2-1-2": [
    slot("GK", 50), slot("DL", 17), slot("DC", 39), slot("DC", 61), slot("DR", 83),
    slot("DMC", 50), slot("MC", 34, { flexible: true }), slot("MC", 66, { flexible: true }),
    slot("AMC", 50), slot("FC", 39), slot("FC", 61),
  ],
  "4-2-2-2": [
    slot("GK", 50), slot("DL", 17), slot("DC", 39), slot("DC", 61), slot("DR", 83),
    slot("DMC", 39), slot("DMC", 61), slot("AML", 25), slot("AMR", 75),
    slot("FC", 39), slot("FC", 61),
  ],
  "4-5-1": [
    slot("GK", 50), slot("DL", 17), slot("DC", 39), slot("DC", 61), slot("DR", 83),
    slot("ML", 14, { flexible: true }), slot("MC", 32, { flexible: true }),
    slot("MC", 50, { flexible: true }), slot("MC", 68, { flexible: true }),
    slot("MR", 86, { flexible: true }), slot("FC", 50),
  ],
  "3-5-2": [
    slot("GK", 50), slot("DC", 28), slot("DC", 50), slot("DC", 72),
    slot("WBL", 8), slot("MC", 35, { flexible: true }), slot("MC", 50, { flexible: true }),
    slot("MC", 65, { flexible: true }), slot("WBR", 92), slot("FC", 39), slot("FC", 61),
  ],
  "3-4-1-2": [
    slot("GK", 50), slot("DC", 28), slot("DC", 50), slot("DC", 72),
    slot("ML", 15),
    slot("MC", 40, { styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "MC" } }),
    slot("MC", 60, { styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "AMC" } }),
    slot("MR", 85),
    slot("AMC", 50, { styleRoles: { Defensive: "MC", Balanced: "AMC", Attacking: "AMC" } }),
    slot("FC", 39), slot("FC", 61),
  ],
  "3-4-3": [
    slot("GK", 50), slot("DC", 28), slot("DC", 50), slot("DC", 72),
    slot("ML", 15, { styleRoles: { Defensive: "DML", Balanced: "ML", Attacking: "ML" } }),
    slot("MC", 40, { styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "MC" } }),
    slot("MC", 60, { styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "AMC" } }),
    slot("MR", 85, { styleRoles: { Defensive: "DMR", Balanced: "MR", Attacking: "MR" } }),
    slot("FL", 17), slot("FC", 50), slot("FR", 83),
  ],
  "5-2-1-2": [
    slot("GK", 50), slot("WBL", 8), slot("DC", 31), slot("DC", 50), slot("DC", 69),
    slot("WBR", 92), slot("MC", 39, { flexible: true }), slot("MC", 61, { flexible: true }),
    slot("AMC", 50), slot("FC", 39), slot("FC", 61),
  ],
  "5-2-3": [
    slot("GK", 50), slot("WBL", 8), slot("DC", 31), slot("DC", 50), slot("DC", 69),
    slot("WBR", 92), slot("MC", 39, { flexible: true }), slot("MC", 61, { flexible: true }),
    slot("FL", 17), slot("FC", 50), slot("FR", 83),
  ],
  "5-3-2": [
    slot("GK", 50), slot("WBL", 8), slot("DC", 31), slot("DC", 50), slot("DC", 69),
    slot("WBR", 92), slot("MC", 30, { flexible: true }), slot("MC", 50, { flexible: true }),
    slot("MC", 70, { flexible: true }), slot("FC", 39), slot("FC", 61),
  ],
};

const state = {
  formation: "4-3-3",
  style: "Balanced",
  mode: "Classic",
  suggestions: [],
  selectedCandidateKey: "",
  drafted: new Map(),
  captainSlotId: "",
  rolling: false,
  rollNumber: 0,
};

const formationChoices = document.querySelector("#formationChoices");
const styleChoices = document.querySelector("#styleChoices");
const modeChoices = document.querySelector("#modeChoices");
const pitch = document.querySelector("#formationPitch");
const caption = document.querySelector("#formationCaption");
const summary = document.querySelector("#draftSetupSummary");
const rollIntro = document.querySelector("#draftRollIntro");
const rollButton = document.querySelector("#draftRollButton");
const suggestions = document.querySelector("#draftSuggestions");
const suggestionHelp = document.querySelector("#draftSuggestionHelp");
const progress = document.querySelector("#draftProgress");
const squadList = document.querySelector("#draftSquadList");
const teamNameInput = document.querySelector("#draftTeamName");
const teamOverall = document.querySelector("#draftTeamOverall");
const attackOverall = document.querySelector("#draftAttackOverall");
const midfieldOverall = document.querySelector("#draftMidfieldOverall");
const defenceOverall = document.querySelector("#draftDefenceOverall");
const simulateButton = document.querySelector("#draftSimulateButton");
const DRAFT_TEAM_STORAGE_KEY = "retroball-draft-team-v1";

function effectiveRole(item) {
  if (item.styleRoles) return item.styleRoles[state.style] || item.role;
  if (!item.flexible) return item.role;
  const side = item.role.endsWith("L") ? "L" : item.role.endsWith("R") ? "R" : "C";
  return `${STYLE_ROLE_PREFIX[state.style]}${side}`;
}

function rolePrefix(role) {
  return ["GK", "SW", "WB", "DM", "AM", "D", "M", "F"]
    .find((prefix) => role.startsWith(prefix)) || role;
}

function pitchRow(role) {
  return PITCH_ROWS[rolePrefix(role)] || 50;
}

function currentSlots() {
  return formations[state.formation].map((item, index) => ({
    ...item,
    id: `slot-${index}`,
    effectiveRole: effectiveRole(item),
    y: item.y ?? pitchRow(effectiveRole(item)),
  }));
}

function candidateKey(candidate) {
  return `${candidate.database_slug}:${candidate.source_person_id}`;
}

function playerName(candidate) {
  return candidate.canonical_player_name
    || candidate.display_name
    || candidate.full_name
    || "Unknown player";
}

function clubTheme(candidate) {
  const colours = candidate.club_colors || {};
  const background = String(colours.background_colour || "");
  const foreground = String(colours.foreground_colour || "");
  return {
    background: /^#[0-9a-f]{6}$/i.test(background) ? background : "#0d1310",
    foreground: /^#[0-9a-f]{6}$/i.test(foreground) ? foreground : "#ffffff",
  };
}

function seasonLabel(candidate) {
  const match = String(candidate.database_title || "").match(/(\d{2})\/(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : candidate.database_title || candidate.database_slug;
}

function squadLine(role) {
  const prefix = rolePrefix(role);
  if (prefix === "F") return "attack";
  if (["D", "WB", "SW", "GK"].includes(prefix)) return "defence";
  return "midfield";
}

function draftedOverall(candidate, slotId) {
  const captainMultiplier = state.captainSlotId === slotId ? 2 : 1;
  return Math.round(((Number(candidate.current_ability) || 0) * captainMultiplier) / 2);
}

function averageOverall(values) {
  return values.length
    ? Math.round(values.reduce((total, value) => total + value, 0) / values.length)
    : 0;
}

function squadSnapshot() {
  const slots = currentSlots();
  const players = slots
    .filter((item) => state.drafted.has(item.id))
    .map((item) => {
      const candidate = state.drafted.get(item.id);
      const isCaptain = item.id === state.captainSlotId;
      return {
        slotId: item.id,
        role: item.effectiveRole,
        line: squadLine(item.effectiveRole),
        isCaptain,
        overall: draftedOverall(candidate, item.id),
        effective_current_ability:
          (Number(candidate.current_ability) || 0) * (isCaptain ? 2 : 1),
        player: candidate,
      };
    });
  const lineValues = (line) => players
    .filter((item) => item.line === line)
    .map((item) => item.overall);
  return {
    version: 1,
    teamName: teamNameInput.value.trim() || "Ultimate XI",
    formation: state.formation,
    style: state.style,
    captainSlotId: state.captainSlotId,
    players,
    overalls: {
      attack: averageOverall(lineValues("attack")),
      midfield: averageOverall(lineValues("midfield")),
      defence: averageOverall(lineValues("defence")),
      team: averageOverall(players.map((item) => item.overall)),
    },
  };
}

function persistSquad() {
  if (state.drafted.size !== 11 || !state.captainSlotId) return;
  try {
    localStorage.setItem(DRAFT_TEAM_STORAGE_KEY, JSON.stringify(squadSnapshot()));
  } catch {
    // The run remains usable in-memory when browser storage is unavailable.
  }
}

function clearPersistedSquad() {
  try {
    localStorage.removeItem(DRAFT_TEAM_STORAGE_KEY);
  } catch {
    // Ignore storage restrictions.
  }
}

function renderSquadSummary() {
  const snapshot = squadSnapshot();
  teamOverall.textContent = snapshot.players.length ? snapshot.overalls.team : "--";
  attackOverall.textContent = snapshot.overalls.attack || "--";
  midfieldOverall.textContent = snapshot.overalls.midfield || "--";
  defenceOverall.textContent = snapshot.overalls.defence || "--";
  squadList.replaceChildren();

  if (!snapshot.players.length) {
    const empty = document.createElement("li");
    empty.textContent = "No players selected.";
    squadList.append(empty);
  } else {
    snapshot.players
      .slice()
      .sort((left, right) => {
        const order = { attack: 0, midfield: 1, defence: 2 };
        return order[left.line] - order[right.line] || left.role.localeCompare(right.role);
      })
      .forEach((item) => {
        const row = document.createElement("li");
        if (item.isCaptain) row.classList.add("is-captain");
        const role = document.createElement("span");
        role.textContent = item.role;
        const name = document.createElement("strong");
        name.textContent = `${playerName(item.player)}${item.isCaptain ? " (C)" : ""}`;
        const overall = document.createElement("b");
        overall.textContent = item.overall;
        row.append(role, name, overall);
        squadList.append(row);
      });
  }

  simulateButton.disabled = snapshot.players.length !== 11 || !state.captainSlotId;
  if (!simulateButton.disabled) persistSquad();
}

function ratingMap(candidate) {
  return new Map(
    (candidate.position_ratings || []).map((item) => [
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
  return {
    GK: ["goalkeeper"],
    SW: ["sweeper"],
    D: ["defender", "defence"],
    WB: ["wing back", "defender", "defence"],
    DM: ["defensive midfielder", "def midfielder", "anchor"],
    M: ["midfielder", "midfield"],
    AM: ["attacking midfielder", "att midfielder", "support"],
    F: ["attacker", "attack"],
  }[prefix] || [];
}

function sideRatingLabels(role) {
  if (role === "GK" || role === "SW") return [];
  if (role.endsWith("L")) return ["left side", "left sided"];
  if (role.endsWith("R")) return ["right side", "right sided"];
  return ["central"];
}

function positionFit(candidate, role) {
  const ratings = ratingMap(candidate);
  if (!ratings.size) return { score: 0, level: "none", label: "Not rated" };
  const modern = [...ratings.values()].some((value) => value > 2);
  let base = firstRating(ratings, roleRatingLabels(role));
  const sideLabels = sideRatingLabels(role);
  const side = sideLabels.length ? firstRating(ratings, sideLabels) : base;

  if (rolePrefix(role) === "WB" && !modern && base <= 0) {
    base = firstRating(ratings, ["defender", "defence"]);
  }

  const score = sideLabels.length ? Math.min(base, side) : base;
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

function remainingSlots() {
  return currentSlots().filter((item) => !state.drafted.has(item.id));
}

function bestFit(candidate, slots = remainingSlots()) {
  return slots
    .map((item) => ({ slot: item, ...positionFit(candidate, item.effectiveRole) }))
    .sort((left, right) => right.score - left.score)[0]
    || { slot: null, score: 0, level: "none", label: "Not rated" };
}

function draftedCanonicalIds() {
  return new Set(
    [...state.drafted.values()]
      .map((candidate) => candidate.canonical_player_public_id || candidateKey(candidate)),
  );
}

function seededShuffle(items, seed) {
  let value = seed || 1;
  const random = () => {
    value |= 0;
    value = value + 0x6d2b79f5 | 0;
    let result = Math.imul(value ^ value >>> 15, 1 | value);
    result = result + Math.imul(result ^ result >>> 7, 61 | result) ^ result;
    return ((result ^ result >>> 14) >>> 0) / 4294967296;
  };
  const shuffled = items.slice();
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]];
  }
  return shuffled;
}

function chooseSuggestions(pool, seed) {
  const openSlots = remainingSlots();
  const draftedIds = draftedCanonicalIds();
  const eligible = seededShuffle(pool, seed).filter((candidate) => {
    const identity = candidate.canonical_player_public_id || candidateKey(candidate);
    return !draftedIds.has(identity) && bestFit(candidate, openSlots).score > 0;
  });
  const targetRoles = [...new Set(openSlots.map((item) => item.effectiveRole))];
  const rotatedRoles = targetRoles.length
    ? targetRoles.map((_, index) => targetRoles[(index + state.rollNumber) % targetRoles.length])
    : [];
  const selected = [];
  const usedDatabases = new Set();
  const usedPlayers = new Set();

  const takeBest = (role = "") => {
    const candidates = eligible
      .filter((candidate) => {
        const identity = candidate.canonical_player_public_id || candidateKey(candidate);
        return !usedDatabases.has(candidate.database_slug)
          && !usedPlayers.has(identity)
          && (!role || positionFit(candidate, role).score > 0);
      })
      .sort((left, right) => {
        const leftFit = role ? positionFit(left, role).score : bestFit(left, openSlots).score;
        const rightFit = role ? positionFit(right, role).score : bestFit(right, openSlots).score;
        return rightFit - leftFit;
      });
    const candidate = candidates[0];
    if (!candidate) return;
    selected.push(candidate);
    usedDatabases.add(candidate.database_slug);
    usedPlayers.add(candidate.canonical_player_public_id || candidateKey(candidate));
  };

  for (const role of rotatedRoles) {
    if (selected.length >= 6) break;
    takeBest(role);
  }
  while (selected.length < 6) {
    const before = selected.length;
    takeBest();
    if (selected.length === before) break;
  }
  return selected;
}

function pitchMarkings() {
  const fragment = document.createDocumentFragment();
  for (const className of [
    "draft-pitch-halfway",
    "draft-pitch-circle",
    "draft-pitch-box draft-pitch-box-top",
    "draft-pitch-box draft-pitch-box-bottom",
    "draft-pitch-goal draft-pitch-goal-top",
    "draft-pitch-goal draft-pitch-goal-bottom",
    "draft-pitch-arc draft-pitch-arc-top",
    "draft-pitch-arc draft-pitch-arc-bottom",
    "draft-pitch-spot draft-pitch-spot-top",
    "draft-pitch-spot draft-pitch-spot-bottom",
  ]) {
    const element = document.createElement("span");
    element.className = className;
    element.setAttribute("aria-hidden", "true");
    fragment.append(element);
  }
  return fragment;
}

function renderPitch() {
  pitch.replaceChildren(pitchMarkings());
  pitch.dataset.style = state.style.toLowerCase();
  const selected = state.suggestions.find(
    (candidate) => candidateKey(candidate) === state.selectedCandidateKey,
  );

  for (const item of currentSlots()) {
    const drafted = state.drafted.get(item.id);
    const fit = selected ? positionFit(selected, item.effectiveRole) : null;
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "formation-player";
    marker.dataset.slotId = item.id;
    marker.style.left = `${item.x}%`;
    marker.style.top = `${item.y}%`;
    marker.title = drafted
      ? state.drafted.size >= 11
        ? `${playerName(drafted)} · click to select as captain`
        : `${playerName(drafted)} · click to remove`
      : selected
        ? `${fit.label} at ${item.effectiveRole}`
        : `Empty ${item.effectiveRole} position`;

    if (drafted) {
      const draftedFit = positionFit(drafted, item.effectiveRole);
      const theme = clubTheme(drafted);
      const isCaptain = state.captainSlotId === item.id;
      marker.classList.add("is-filled", `fit-${draftedFit.level}`);
      if (draftedFit.level !== "natural") marker.classList.add("is-out-of-position");
      if (isCaptain) marker.classList.add("is-captain");
      marker.style.setProperty("--club-bg", theme.background);
      marker.style.setProperty("--club-fg", theme.foreground);
      const role = document.createElement("span");
      role.className = "formation-player-role";
      role.textContent = `${item.effectiveRole}${isCaptain ? " · C" : ""}`;
      const name = document.createElement("span");
      name.className = "formation-player-name";
      name.textContent = playerName(drafted);
      const ability = document.createElement("span");
      ability.className = "formation-player-ability";
      ability.textContent = `CA ${(Number(drafted.current_ability) || 0) * (isCaptain ? 2 : 1)}`;
      marker.append(role, name, ability);
    } else {
      marker.textContent = item.effectiveRole;
      if (fit && fit.score > 0) {
        marker.classList.add("is-fit-target", `fit-${fit.level}`);
      } else if (selected) {
        marker.classList.add("is-no-fit");
      }
    }
    pitch.append(marker);
  }

  caption.textContent = `${state.formation} · ${state.style}`;
  summary.textContent = `${state.formation} · ${state.style} · ${state.mode}`;
  progress.textContent = state.drafted.size < 11
    ? `${state.drafted.size} / 11`
    : state.captainSlotId
      ? `11 / 11 · ${playerName(state.drafted.get(state.captainSlotId))} (C)`
      : "11 / 11 · Choose captain";
  rollButton.disabled = state.rolling || state.mode !== "Classic" || state.drafted.size >= 11;
  renderSquadSummary();
}

function renderSuggestions(message = "") {
  suggestions.replaceChildren();
  if (message || !state.suggestions.length) {
    const empty = document.createElement("div");
    empty.className = "draft-suggestions-empty";
    empty.textContent = message || "No players rolled yet.";
    suggestions.append(empty);
    return;
  }

  for (const candidate of state.suggestions) {
    const fit = bestFit(candidate);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `draft-suggestion-card fit-${fit.level}`;
    button.dataset.candidateKey = candidateKey(candidate);
    button.classList.toggle("is-selected", button.dataset.candidateKey === state.selectedCandidateKey);
    const theme = clubTheme(candidate);
    button.style.setProperty("--club-bg", theme.background);
    button.style.setProperty("--club-fg", theme.foreground);

    const heading = document.createElement("span");
    heading.className = "draft-suggestion-name";
    heading.textContent = playerName(candidate);
    const season = document.createElement("span");
    season.className = "draft-suggestion-season";
    season.textContent = seasonLabel(candidate);
    const meta = document.createElement("span");
    meta.className = "draft-suggestion-meta";
    meta.textContent = [candidate.canonical_club_name || candidate.club_name, candidate.nation_name]
      .filter(Boolean)
      .join(" · ");
    const ratings = document.createElement("span");
    ratings.className = "draft-suggestion-ratings";
    ratings.innerHTML = `<span>CA <strong>${Number(candidate.current_ability) || 0}</strong></span><span>PA <strong>${Number(candidate.potential_ability) || 0}</strong></span>`;
    const fitBadge = document.createElement("span");
    fitBadge.className = "draft-fit-badge";
    fitBadge.textContent = `${fit.label} · ${fit.slot?.effectiveRole || "No fit"}`;
    button.append(heading, season, meta, ratings, fitBadge);
    suggestions.append(button);
  }
}

function resetDraft(message) {
  clearPersistedSquad();
  state.drafted.clear();
  state.captainSlotId = "";
  state.suggestions = [];
  state.selectedCandidateKey = "";
  state.rollNumber = 0;
  rollIntro.textContent = message;
  suggestionHelp.textContent = "Roll the dice for six database-backed choices.";
  renderSuggestions();
  renderPitch();
}

async function rollPlayers() {
  if (state.mode !== "Classic" || state.rolling || state.drafted.size >= 11) return;
  state.rolling = true;
  state.selectedCandidateKey = "";
  rollIntro.textContent = "Rolling through eight classic databases…";
  suggestionHelp.textContent = "Finding choices that fit your unfilled positions.";
  renderSuggestions("Loading player choices…");
  renderPitch();

  try {
    const seed = Math.floor(Date.now() / 300000) * 100 + state.rollNumber;
    const payload = await getDraftCandidates({ seed, perDatabase: 28 });
    state.suggestions = chooseSuggestions(payload.items, seed);
    state.rollNumber += 1;
    if (!state.suggestions.length) {
      throw new Error("No suitable players were found for the remaining positions.");
    }
    rollIntro.textContent = `${state.suggestions.length} players rolled from different seasons.`;
    suggestionHelp.textContent = "Select a player, then choose one of the highlighted pitch positions.";
    renderSuggestions();
  } catch (error) {
    state.suggestions = [];
    rollIntro.textContent = "The database roll failed.";
    suggestionHelp.textContent = error.message || "Please try rolling again.";
    renderSuggestions("Could not load player choices.");
  } finally {
    state.rolling = false;
    renderPitch();
  }
}

Object.keys(formations).forEach((formation) => {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.value = formation;
  button.textContent = formation;
  button.classList.toggle("is-selected", formation === state.formation);
  formationChoices.append(button);
});

function bindChoiceGroup(container, key) {
  container.addEventListener("click", (event) => {
    const button = event.target.closest("button[data-value]");
    if (!button || state[key] === button.dataset.value) return;
    state[key] = button.dataset.value;
    container.querySelectorAll("button").forEach((item) => {
      item.classList.toggle("is-selected", item === button);
    });

    if (key === "mode" && state.mode === "From memory") {
      resetDraft("From-memory drafting will use manual player entry; Classic mode uses the database.");
      suggestionHelp.textContent = "Switch back to Classic to roll database players.";
      return;
    }
    resetDraft(`${key === "formation" ? "Formation" : key === "style" ? "Style" : "Mode"} changed. Roll a fresh set of players.`);
  });
}

bindChoiceGroup(formationChoices, "formation");
bindChoiceGroup(styleChoices, "style");
bindChoiceGroup(modeChoices, "mode");

suggestions.addEventListener("click", (event) => {
  const card = event.target.closest("[data-candidate-key]");
  if (!card) return;
  state.selectedCandidateKey = card.dataset.candidateKey;
  const candidate = state.suggestions.find(
    (item) => candidateKey(item) === state.selectedCandidateKey,
  );
  const fit = candidate ? bestFit(candidate) : null;
  suggestionHelp.textContent = fit?.slot
    ? `${playerName(candidate)} is ${fit.label.toLowerCase()} at ${fit.slot.effectiveRole}. Choose a highlighted position.`
    : "This player has no recognised fit in the current formation.";
  renderSuggestions();
  renderPitch();
});

pitch.addEventListener("click", (event) => {
  const marker = event.target.closest("[data-slot-id]");
  if (!marker) return;
  const slotId = marker.dataset.slotId;

  if (state.drafted.has(slotId) && !state.selectedCandidateKey) {
    const drafted = state.drafted.get(slotId);
    if (state.drafted.size >= 11) {
      state.captainSlotId = slotId;
      rollIntro.textContent = `${playerName(drafted)} selected as captain. Captain CA is doubled to ${(Number(drafted.current_ability) || 0) * 2}.`;
      suggestionHelp.textContent = "Click another player to change the captain.";
      renderPitch();
      return;
    }
    const removed = drafted;
    state.drafted.delete(slotId);
    clearPersistedSquad();
    if (state.captainSlotId === slotId) state.captainSlotId = "";
    rollIntro.textContent = `${playerName(removed)} removed from the draft.`;
    renderPitch();
    return;
  }

  const candidate = state.suggestions.find(
    (item) => candidateKey(item) === state.selectedCandidateKey,
  );
  const target = currentSlots().find((item) => item.id === slotId);
  if (!candidate || !target || state.drafted.has(slotId)) return;
  const fit = positionFit(candidate, target.effectiveRole);
  if (fit.score <= 0) {
    suggestionHelp.textContent = `${playerName(candidate)} is not rated for ${target.effectiveRole}.`;
    return;
  }

  state.drafted.set(slotId, candidate);
  state.suggestions = [];
  state.selectedCandidateKey = "";
  rollIntro.textContent = `${playerName(candidate)} drafted at ${target.effectiveRole} (${fit.label.toLowerCase()}).`;
  suggestionHelp.textContent = state.drafted.size >= 11
    ? "Starting XI complete. Click one of the eleven players to select the captain and double his CA."
    : "Signing complete for this roll. Roll again for six fresh choices.";
  renderSuggestions(
    state.drafted.size >= 11
      ? "Choose your captain on the pitch."
      : "Roll again to sign the next player.",
  );
  renderPitch();
});

rollButton.addEventListener("click", rollPlayers);
teamNameInput.addEventListener("input", persistSquad);
simulateButton.addEventListener("click", () => {
  persistSquad();
  window.location.href = "draft-run.html";
});

renderSuggestions();
renderPitch();
