import { getDraftCandidates } from "./src/lib/retroballApi.js?v=20260801-68";

const FRIEND_SESSION_KEY = "retroball-friend-session-v1";

function friendSessionFromPage() {
  const parse = (value) => {
    try {
      const source = String(value || "");
      const params = new URLSearchParams(source.startsWith("#") ? source.slice(1) : source);
      const session = {
        code: String(params.get("room") || "").toUpperCase(),
        token: params.get("token") || "",
        role: params.get("role") === "host" ? "host" : "guest",
        name: sessionStorage.getItem("retroball-friend-name") || "Manager",
      };
      return /^[A-HJ-NP-Z2-9]{6}$/.test(session.code) &&
        /^[A-Za-z0-9_-]{32}$/.test(session.token) ? session : null;
    } catch {
      return null;
    }
  };
  const fromHash = parse(window.location.hash);
  if (fromHash) {
    sessionStorage.setItem(FRIEND_SESSION_KEY, JSON.stringify(fromHash));
    return fromHash;
  }
  try {
    const stored = JSON.parse(sessionStorage.getItem(FRIEND_SESSION_KEY) || "null");
    return parse(new URLSearchParams(stored || {}).toString());
  } catch {
    return null;
  }
}

const friendSession = friendSessionFromPage();

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
    slot("GK", 50),
    slot("DL", 17),
    slot("DC", 39),
    slot("DC", 61),
    slot("DR", 83),
    slot("MC", 28, {
      styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "MC" },
    }),
    slot("MC", 50, {
      styleRoles: { Defensive: "MC", Balanced: "MC", Attacking: "AMC" },
    }),
    slot("MC", 74, {
      styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "MC" },
    }),
    slot("FL", 17),
    slot("FC", 50),
    slot("FR", 83),
  ],
  "4-4-2": [
    slot("GK", 50),
    slot("DL", 17),
    slot("DC", 39),
    slot("DC", 61),
    slot("DR", 83),
    slot("ML", 17, {
      styleRoles: { Defensive: "ML", Balanced: "ML", Attacking: "AML" },
    }),
    slot("MC", 40, {
      styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "MC" },
    }),
    slot("MC", 60, {
      styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "MC" },
    }),
    slot("MR", 83, {
      styleRoles: { Defensive: "MR", Balanced: "MR", Attacking: "AMR" },
    }),
    slot("FC", 39),
    slot("FC", 61),
  ],
  "4-2-3-1": [
    slot("GK", 50),
    slot("DL", 17),
    slot("DC", 39),
    slot("DC", 61),
    slot("DR", 83),
    slot("DMC", 39),
    slot("DMC", 61, {
      styleRoles: { Defensive: "DMC", Balanced: "DMC", Attacking: "MC" },
    }),
    slot("AML", 17, {
      styleRoles: { Defensive: "ML", Balanced: "ML", Attacking: "AML" },
    }),
    slot("AMC", 50, {
      styleRoles: { Defensive: "MC", Balanced: "AMC", Attacking: "AMC" },
    }),
    slot("AMR", 83, {
      styleRoles: { Defensive: "MR", Balanced: "MR", Attacking: "AMR" },
    }),
    slot("FC", 50),
  ],
  "4-1-2-1-2": [
    slot("GK", 50),
    slot("DL", 17),
    slot("DC", 39),
    slot("DC", 61),
    slot("DR", 83),
    slot("DMC", 50),
    slot("MC", 34, { flexible: true }),
    slot("MC", 66, { flexible: true }),
    slot("AMC", 50),
    slot("FC", 39),
    slot("FC", 61),
  ],
  "4-2-2-2": [
    slot("GK", 50),
    slot("DL", 17),
    slot("DC", 39),
    slot("DC", 61),
    slot("DR", 83),
    slot("DMC", 39, {
      styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "MC" },
    }),
    slot("DMC", 61, {
      styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "MC" },
    }),
    slot("AML", 25, {
      styleRoles: { Defensive: "ML", Balanced: "AML", Attacking: "FL" },
    }),
    slot("AMR", 75, {
      styleRoles: { Defensive: "MR", Balanced: "AMR", Attacking: "FR" },
    }),
    slot("FC", 39),
    slot("FC", 61),
  ],
  "4-5-1": [
    slot("GK", 50),
    slot("DL", 17),
    slot("DC", 39),
    slot("DC", 61),
    slot("DR", 83),
    slot("ML", 14),
    slot("MC", 32),
    slot("MC", 50, {
      styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "AMC" },
    }),
    slot("MC", 68),
    slot("MR", 86),
    slot("FC", 50),
  ],
  "3-5-2": [
    slot("GK", 50),
    slot("DC", 28),
    slot("DC", 50),
    slot("DC", 72),
    slot("ML", 10),
    slot("MC", 35),
    slot("MC", 50, {
      styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "AMC" },
    }),
    slot("MC", 65),
    slot("MR", 90),
    slot("FC", 39),
    slot("FC", 61),
  ],
  "3-4-1-2": [
    slot("GK", 50),
    slot("DC", 28),
    slot("DC", 50),
    slot("DC", 72),
    slot("ML", 15, {
      styleRoles: { Defensive: "ML", Balanced: "ML", Attacking: "AML" },
    }),
    slot("MC", 40, {
      styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "MC" },
    }),
    slot("MC", 60, {
      styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "MC" },
    }),
    slot("MR", 85, {
      styleRoles: { Defensive: "MR", Balanced: "MR", Attacking: "AMR" },
    }),
    slot("AMC", 50),
    slot("FC", 39),
    slot("FC", 61),
  ],
  "3-4-3": [
    slot("GK", 50),
    slot("DC", 28),
    slot("DC", 50),
    slot("DC", 72),
    slot("ML", 15),
    slot("MC", 40, {
      styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "MC" },
    }),
    slot("MC", 60, {
      styleRoles: { Defensive: "MC", Balanced: "MC", Attacking: "AMC" },
    }),
    slot("MR", 85),
    slot("FL", 17),
    slot("FC", 50),
    slot("FR", 83),
  ],
  "5-2-1-2": [
    slot("GK", 50),
    slot("WBL", 8),
    slot("DC", 31),
    slot("DC", 50),
    slot("DC", 69),
    slot("WBR", 92),
    slot("MC", 39, { flexible: true }),
    slot("MC", 61, { flexible: true }),
    slot("AMC", 50),
    slot("FC", 39),
    slot("FC", 61),
  ],
  "5-2-3": [
    slot("GK", 50),
    slot("WBL", 8),
    slot("DC", 31),
    slot("DC", 50),
    slot("DC", 69),
    slot("WBR", 92),
    slot("MC", 39, { flexible: true }),
    slot("MC", 61, { flexible: true }),
    slot("FL", 17),
    slot("FC", 50),
    slot("FR", 83),
  ],
  "5-3-2": [
    slot("GK", 50),
    slot("WBL", 8),
    slot("DC", 31),
    slot("DC", 50),
    slot("DC", 69),
    slot("WBR", 92),
    slot("MC", 30, { flexible: true }),
    slot("MC", 50, { flexible: true }),
    slot("MC", 70, { flexible: true }),
    slot("FC", 39),
    slot("FC", 61),
  ],
};

const state = {
  formation: "4-3-3",
  style: "Balanced",
  mode: "Classic",
  suggestions: [],
  selectedCandidateKey: "",
  selectedDraftSlotId: "",
  drafted: new Map(),
  captainSlotId: "",
  rolling: false,
  rollNumber: 0,
  rerollsRemaining: 3,
  qualityDrought: 0,
  premiumDrought: 0,
  offeredPlayerIds: new Set(),
  databasesUsedForCurrentPick: new Set(),
  scenario: "ucl0304",
  classicScenario: "ucl0304",
};

const formationChoices = document.querySelector("#formationChoices");
const styleChoices = document.querySelector("#styleChoices");
const modeChoices = document.querySelector("#modeChoices");
const pitch = document.querySelector("#formationPitch");
const caption = document.querySelector("#formationCaption");
const summary = document.querySelector("#draftSetupSummary");
const rollIntro = document.querySelector("#draftRollIntro");
const rollButton = document.querySelector("#draftRollButton");
const mobileRollButton = document.querySelector("#draftMobileRollButton");
const suggestions = document.querySelector("#draftSuggestions");
const suggestionsPanel = document.querySelector(".draft-suggestions-panel");
const captainPrompt = document.querySelector("#draftCaptainPrompt");
const suggestionHelp = document.querySelector("#draftSuggestionHelp");
const modeKicker = document.querySelector("#draftModeKicker");
const progress = document.querySelector("#draftProgress");
const squadList = document.querySelector("#draftSquadList");
const teamNameInput = document.querySelector("#draftTeamName");
const teamOverall = document.querySelector("#draftTeamOverall");
const attackOverall = document.querySelector("#draftAttackOverall");
const midfieldOverall = document.querySelector("#draftMidfieldOverall");
const defenceOverall = document.querySelector("#draftDefenceOverall");
const simulateButton = document.querySelector("#draftSimulateButton");
const squadPanel = document.querySelector(".draft-squad-panel");
const scenarioChoices = document.querySelector("#draftScenarioChoices");
const scenarioPicker = document.querySelector("#draftScenarioPicker");
const scenarioLegend = document.querySelector("#draftScenarioLegend");
const scenarioDescription = document.querySelector("#draftScenarioDescription");
const DRAFT_TEAM_STORAGE_KEY = "retroball-draft-team-v1";
const MOBILE_DRAFT_MEDIA = "(max-width: 760px)";

function scrollMobileDraftTo(target, block = "start") {
  if (!target || !window.matchMedia(MOBILE_DRAFT_MEDIA).matches) return;
  window.requestAnimationFrame(() => {
    target.scrollIntoView({ behavior: "smooth", block });
  });
}

function isDatabaseDraftMode() {
  return state.mode === "Classic" || state.mode === "Titan Fight";
}

function minimumDraftAbility() {
  return state.mode === "Titan Fight" ? 165 : 100;
}

function effectiveRole(item) {
  if (item.styleRoles) return item.styleRoles[state.style] || item.role;
  if (!item.flexible) return item.role;
  const side = item.role.endsWith("L")
    ? "L"
    : item.role.endsWith("R")
      ? "R"
      : "C";
  return `${STYLE_ROLE_PREFIX[state.style]}${side}`;
}

function rolePrefix(role) {
  return (
    ["GK", "SW", "WB", "DM", "AM", "D", "M", "F"].find((prefix) =>
      role.startsWith(prefix),
    ) || role
  );
}

function pitchRow(role) {
  if (role === "FL" || role === "FR") return 18;
  return PITCH_ROWS[rolePrefix(role)] || 50;
}

function currentSlots() {
  const slots = formations[state.formation].map((item, index) => ({
    ...item,
    id: `slot-${index}`,
    effectiveRole: effectiveRole(item),
    y: item.y ?? pitchRow(effectiveRole(item)),
  }));
  const central = slots.filter((item) =>
    ["DMC", "MC", "AMC"].includes(item.effectiveRole),
  );
  if (central.length === 2) {
    const roles = new Set(central.map((item) => item.effectiveRole));
    const isMixedPair =
      (roles.has("AMC") && roles.has("MC")) ||
      (roles.has("DMC") && roles.has("MC"));
    if (isMixedPair) {
      const sharedY = Math.round(averageOverall(central.map((item) => item.y)));
      central
        .sort((left, right) => left.x - right.x)
        .forEach((item, index) => {
          item.x = index === 0 ? 42 : 58;
          item.y = sharedY;
        });
    }
  }
  return slots;
}

function candidateKey(candidate) {
  return `${candidate.database_slug}:${candidate.source_person_id}`;
}

function candidateIdentity(candidate) {
  return candidate.canonical_player_public_id || candidateKey(candidate);
}

function playerName(candidate) {
  return (
    candidate.canonical_player_name ||
    candidate.display_name ||
    candidate.full_name ||
    "Unknown player"
  );
}

function shortPlayerName(candidate) {
  const name = playerName(candidate).trim();
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts.at(-1) : name;
}

function normalizedClubName(candidate) {
  return String(candidate.canonical_club_name || candidate.club_name || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function readableClubText(background, secondary) {
  const luminance = (hex) => {
    const channels =
      hex
        .match(/[0-9a-f]{2}/gi)
        ?.map((value) => Number.parseInt(value, 16) / 255) || [];
    return channels.length === 3
      ? channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722
      : 0;
  };
  return (luminance(background) + luminance(secondary)) / 2 > 0.62
    ? "#071008"
    : "#ffffff";
}

function clubTheme(candidate) {
  const colours = candidate.club_colors || {};
  const club = normalizedClubName(candidate);
  const override = /(^| )fenerbahce( sk| istanbul|$)/.test(club)
    ? { background: "#ffd000", secondary: "#0030a0" }
    : ["barcelona", "f c barcelona"].includes(club)
      ? { background: "#0030a0", secondary: "#a50044" }
      : null;
  const sourceBackground = String(colours.background_colour || "");
  const sourceSecondary = String(colours.foreground_colour || "");
  const background =
    override?.background ||
    (/^#[0-9a-f]{6}$/i.test(sourceBackground) ? sourceBackground : "#0d1310");
  const secondary =
    override?.secondary ||
    (/^#[0-9a-f]{6}$/i.test(sourceSecondary) ? sourceSecondary : background);
  return {
    background,
    secondary,
    foreground:
      secondary !== background
        ? secondary
        : readableClubText(background, secondary),
  };
}

function playerCardTier(candidate) {
  const ability = Number(candidate.current_ability) || 0;
  if (ability >= 185) return "card-tier-god";
  if (ability >= 170) return "card-tier-gold card-tier-animated";
  if (ability >= 150) return "card-tier-gold";
  if (ability >= 140) return "card-tier-silver card-tier-animated";
  if (ability >= 130) return "card-tier-silver";
  if (ability >= 115) return "card-tier-bronze";
  return "card-tier-base";
}

function seasonLabel(candidate) {
  const match = String(candidate.database_title || "").match(
    /(\d{2})\/(\d{2})/,
  );
  return match
    ? `${match[1]}-${match[2]}`
    : candidate.database_title || candidate.database_slug;
}

function squadLine(role) {
  const prefix = rolePrefix(role);
  if (prefix === "F") return "attack";
  if (["D", "WB", "SW", "GK"].includes(prefix)) return "defence";
  return "midfield";
}

function draftedOverall(candidate) {
  return Math.min(
    99,
    Math.max(0, Math.round((Number(candidate.current_ability) || 0) / 2)),
  );
}

function positionAbilityMultiplier(candidate, role) {
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

function averageOverall(values) {
  return values.length
    ? Math.round(
        values.reduce((total, value) => total + value, 0) / values.length,
      )
    : 0;
}

function squadSnapshot() {
  const slots = currentSlots();
  const players = slots
    .filter((item) => state.drafted.has(item.id))
    .map((item) => {
      const candidate = state.drafted.get(item.id);
      const isCaptain = item.id === state.captainSlotId;
      const overall = draftedOverall(candidate);
      const positionMultiplier = positionAbilityMultiplier(
        candidate,
        item.effectiveRole,
      );
      const gameplayOverall = Math.round(overall * positionMultiplier);
      const gameplayCurrentAbility =
        (Number(candidate.current_ability) || 0) * positionMultiplier;
      return {
        slotId: item.id,
        role: item.effectiveRole,
        line: squadLine(item.effectiveRole),
        isCaptain,
        overall,
        gameplayOverall,
        gameplay_current_ability: gameplayCurrentAbility,
        positionFit: positionFit(candidate, item.effectiveRole).level,
        effectiveOverall: gameplayOverall * (isCaptain ? 2 : 1),
        effective_current_ability: gameplayCurrentAbility * (isCaptain ? 2 : 1),
        player: candidate,
      };
    });
  const lineValues = (line, key) =>
    players.filter((item) => item.line === line).map((item) => item[key]);
  return {
    version: 3,
    teamName: teamNameInput.value.trim() || "Ultimate XI",
    formation: state.formation,
    style: state.style,
    captainSlotId: state.captainSlotId,
    mode: state.mode,
    scenario: state.scenario,
    players,
    overalls: {
      attack: averageOverall(lineValues("attack", "overall")),
      midfield: averageOverall(lineValues("midfield", "overall")),
      defence: averageOverall(lineValues("defence", "overall")),
      team: averageOverall(players.map((item) => item.overall)),
    },
    boostedOveralls: {
      attack: averageOverall(lineValues("attack", "effectiveOverall")),
      midfield: averageOverall(lineValues("midfield", "effectiveOverall")),
      defence: averageOverall(lineValues("defence", "effectiveOverall")),
      team: averageOverall(players.map((item) => item.effectiveOverall)),
    },
  };
}

function persistSquad() {
  if (state.drafted.size !== 11 || !state.captainSlotId) return;
  try {
    localStorage.setItem(
      DRAFT_TEAM_STORAGE_KEY,
      JSON.stringify(squadSnapshot()),
    );
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

function renderScenarioPicker() {
  if (friendSession) {
    scenarioPicker.classList.add("is-friendly");
    scenarioLegend.textContent = "Friendly match";
    scenarioDescription.textContent =
      "Finish your XI and captain, then submit it to the private room.";
    scenarioChoices.hidden = true;
    simulateButton.innerHTML = 'Submit squad <span aria-hidden="true">→</span>';
    return;
  }
  const titanSelected = state.mode === "Titan Fight";
  if (titanSelected) state.scenario = "titan";
  else if (state.scenario === "titan") state.scenario = state.classicScenario;

  scenarioPicker.classList.toggle("is-titan", titanSelected);
  scenarioLegend.textContent = titanSelected
    ? "Titan Fight scenario"
    : "Championship scenario";
  scenarioDescription.textContent = titanSelected
    ? "The eight legendary opponents will be drawn in a random order."
    : "Your group will be drawn when the run begins.";
  scenarioChoices.querySelectorAll("[data-scenario]").forEach((button) => {
    const isTitanScenario = button.dataset.scenario === "titan";
    button.hidden = titanSelected !== isTitanScenario;
    button.classList.toggle("is-selected", button.dataset.scenario === state.scenario);
  });
  simulateButton.innerHTML = titanSelected
    ? 'Start the Titan Fight <span aria-hidden="true">→</span>'
    : 'Simulate the Championship <span aria-hidden="true">→</span>';
}

function renderSquadSummary() {
  const snapshot = squadSnapshot();
  squadPanel.hidden = snapshot.players.length !== 11;
  teamOverall.textContent = snapshot.players.length
    ? snapshot.overalls.team
    : "--";
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
        return (
          order[left.line] - order[right.line] ||
          left.role.localeCompare(right.role)
        );
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

  simulateButton.disabled =
    snapshot.players.length !== 11 || !state.captainSlotId;
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

function positionFit(candidate, role) {
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

function remainingSlots() {
  return currentSlots().filter((item) => !state.drafted.has(item.id));
}

function bestFit(candidate, slots = remainingSlots()) {
  return (
    slots
      .map((item) => ({
        slot: item,
        ...positionFit(candidate, item.effectiveRole),
      }))
      .sort((left, right) => right.score - left.score)[0] || {
      slot: null,
      score: 0,
      level: "none",
      label: "Not rated",
    }
  );
}

function isSupportedPitchFit(fit) {
  return Boolean(
    fit && fit.score > 0 && !["none", "very-awkward"].includes(fit.level),
  );
}

const DISPLAY_POSITION_ROLES = [
  "GK",
  "SW",
  "DL",
  "DC",
  "DR",
  "WBL",
  "WBR",
  "DML",
  "DMC",
  "DMR",
  "ML",
  "MC",
  "MR",
  "AML",
  "AMC",
  "AMR",
  "FL",
  "FC",
  "FR",
];

function positionsFromText(positionText) {
  const text = String(positionText || "")
    .trim()
    .toUpperCase();
  if (!text) return [];
  if (/\s+\/\s+/.test(text)) {
    return text
      .split(/\s+\/\s+/)
      .flatMap((position) => positionsFromText(position));
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

function playerPositionSummary(candidate) {
  const natural = [];
  const secondary = [];
  for (const role of DISPLAY_POSITION_ROLES) {
    const fit = positionFit(candidate, role);
    if (fit.level === "natural") natural.push(role);
    else if (fit.level === "playable" || fit.level === "limited")
      secondary.push(role);
  }
  if (!natural.length && !secondary.length) {
    natural.push(...positionsFromText(candidate.position_text));
  }
  return [...natural, ...secondary].join(" / ") || "—";
}

function playerMainPositionSummary(candidate) {
  const positionText = String(candidate.position_text || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
  if (positionText) {
    const generatedSide = generatedSidePreference(candidate);
    return generatedSide
      ? `${positionText} ${generatedSide.letter}`
      : positionText;
  }
  const natural = DISPLAY_POSITION_ROLES.filter(
    (role) => positionFit(candidate, role).level === "natural",
  );
  return natural.slice(0, 3).join(" / ") || "—";
}

function isExactLateSlotMatch(candidate, role) {
  const mainRoles = new Set(
    positionsFromText(playerMainPositionSummary(candidate)),
  );
  if (mainRoles.has(role)) return true;
  const adjacentRole = {
    AML: "FL",
    AMR: "FR",
    FL: "AML",
    FR: "AMR",
    DL: "WBL",
    DR: "WBR",
    WBL: "DL",
    WBR: "DR",
  }[role];
  return Boolean(adjacentRole && mainRoles.has(adjacentRole));
}

function isTargetPositionMatch(candidate, role, slotCount) {
  return slotCount <= 3
    ? isExactLateSlotMatch(candidate, role)
    : isSupportedPitchFit(positionFit(candidate, role));
}

function poolCoversLateTargets(pool, slots) {
  if (!slots.length || slots.length > 3) return true;
  const draftedIds = draftedCanonicalIds();
  const eligible = pool.filter((candidate) => {
    const identity = candidateIdentity(candidate);
    return (
      Number(candidate.current_ability || 0) >= minimumDraftAbility() &&
      !draftedIds.has(identity) &&
      !state.offeredPlayerIds.has(identity)
    );
  });
  return slots.every((slotItem) =>
    eligible.some((candidate) =>
      isExactLateSlotMatch(candidate, slotItem.effectiveRole),
    ),
  );
}

function draftedCanonicalIds() {
  return new Set([...state.drafted.values()].map(candidateIdentity));
}

function seededRandom(seed) {
  let value = seed || 1;
  return () => {
    value |= 0;
    value = (value + 0x6d2b79f5) | 0;
    let result = Math.imul(value ^ (value >>> 15), 1 | value);
    result =
      (result + Math.imul(result ^ (result >>> 7), 61 | result)) ^ result;
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
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

const ABILITY_DROP_TABLE = [
  { minimum: 185, maximum: Infinity, share: 0.04 },
  { minimum: 170, maximum: 184, share: 0.2 },
  { minimum: 156, maximum: 169, share: 0.4 },
  { minimum: 140, maximum: 155, share: 0.3 },
  { minimum: 120, maximum: 139, share: 0.0 },
  { minimum: -Infinity, maximum: 119, share: 0.0 },
];
const QUALITY_ABILITY_FLOOR = 140;
const MIN_QUALITY_CHOICES_PER_ROLL = 3;
const SUGGESTIONS_PER_ROLL = 5;
const DATABASES_PER_ROLL = 5;
const FULL_DATABASE_POOL_SLOT_THRESHOLD = 4;
const MAX_CHOICES_PER_DATABASE = 1;

function usesFullDatabasePool(openSlots = remainingSlots()) {
  return state.mode === "Titan Fight" || openSlots.length > 0
    && openSlots.length <= FULL_DATABASE_POOL_SLOT_THRESHOLD;
}

function maximumChoicesPerDatabase() {
  return state.mode === "Titan Fight"
    ? SUGGESTIONS_PER_ROLL
    : MAX_CHOICES_PER_DATABASE;
}

function abilityDropTier(candidate) {
  const ability = Number(candidate.current_ability || 0);
  return ABILITY_DROP_TABLE.findIndex(
    (tier) => ability >= tier.minimum && ability <= tier.maximum,
  );
}

function selectRollDatabases(pool, seed) {
  const openSlots = remainingSlots();
  const draftedIds = draftedCanonicalIds();
  const eligible = pool.filter((candidate) => {
    const identity = candidateIdentity(candidate);
    return (
      Number(candidate.current_ability || 0) >= minimumDraftAbility() &&
      !draftedIds.has(identity) &&
      !state.offeredPlayerIds.has(identity) &&
      openSlots.some((slotItem) =>
        isTargetPositionMatch(
          candidate,
          slotItem.effectiveRole,
          openSlots.length,
        ),
      )
    );
  });
  const grouped = new Map();
  for (const candidate of eligible) {
    const database = candidate.database_slug;
    if (!database) continue;
    if (!grouped.has(database)) grouped.set(database, []);
    grouped.get(database).push(candidate);
  }

  const allDatabases = [...grouped.keys()];
  if (state.mode === "Titan Fight") return allDatabases;
  if (allDatabases.length < DATABASES_PER_ROLL) return [];
  if (usesFullDatabasePool(openSlots)) {
    return allDatabases;
  }
  const random = seededRandom(seed + 991);
  const combinations = [];
  const buildCombinations = (start, selection) => {
    if (selection.length === DATABASES_PER_ROLL) {
      combinations.push(selection.slice());
      return;
    }
    for (
      let index = start;
      index <=
      allDatabases.length - (DATABASES_PER_ROLL - selection.length);
      index += 1
    ) {
      selection.push(allDatabases[index]);
      buildCombinations(index + 1, selection);
      selection.pop();
    }
  };
  buildCombinations(0, []);

  const ranked = combinations
    .map((databases) => {
      const candidates = databases.flatMap(
        (database) => grouped.get(database) || [],
      );
      const coveredRoles = new Set(
        openSlots
          .filter((slotItem) =>
            candidates.some((candidate) =>
              isTargetPositionMatch(
                candidate,
                slotItem.effectiveRole,
                openSlots.length,
              ),
            ),
          )
          .map((slotItem) => slotItem.effectiveRole),
      );
      const unseenCount = databases.filter(
        (database) => !state.databasesUsedForCurrentPick.has(database),
      ).length;
      const qualityCapacity = databases.filter((database) =>
        (grouped.get(database) || []).some(
          (candidate) =>
            Number(candidate.current_ability || 0) >= QUALITY_ABILITY_FLOOR,
        ),
      ).length;
      const representedTiers = new Set(
        candidates.map(abilityDropTier).filter((tier) => tier >= 0),
      ).size;
      return {
        databases,
        score:
          coveredRoles.size * 1_000_000_000 +
          unseenCount * 10_000_000 +
          qualityCapacity * 100_000 +
          representedTiers * 1_000 +
          random(),
      };
    })
    .sort((left, right) => right.score - left.score);

  return ranked[0]?.databases || [];
}

function chooseSuggestions(pool, seed) {
  const openSlots = remainingSlots();
  const draftedIds = draftedCanonicalIds();
  const eligible = pool.filter((candidate) => {
    const identity = candidateIdentity(candidate);
    return (
      Number(candidate.current_ability || 0) >= minimumDraftAbility() &&
      !draftedIds.has(identity) &&
      !state.offeredPlayerIds.has(identity) &&
      openSlots.some((slotItem) =>
        isTargetPositionMatch(
          candidate,
          slotItem.effectiveRole,
          openSlots.length,
        ),
      )
    );
  });
  const random = seededRandom(seed);
  const selected = [];
  const databaseCounts = new Map();
  const usedPlayers = new Set();
  const shouldTargetFits = openSlots.length > 0;
  const fitSlotCache = new Map();
  const fittingSlotIds = (candidate) => {
    const identity = candidateIdentity(candidate);
    if (!fitSlotCache.has(identity)) {
      fitSlotCache.set(
        identity,
        openSlots
          .filter((item) =>
            isTargetPositionMatch(
              candidate,
              item.effectiveRole,
              openSlots.length,
            ),
          )
          .map((item) => item.id),
      );
    }
    return fitSlotCache.get(identity);
  };
  const fitsOpenSlot = (candidate) =>
    shouldTargetFits && fittingSlotIds(candidate).length > 0;

  const availableCandidates = () =>
    eligible.filter((candidate) => {
      const identity = candidateIdentity(candidate);
      return (
        (databaseCounts.get(candidate.database_slug) || 0) <
          maximumChoicesPerDatabase() &&
        !usedPlayers.has(identity)
      );
    });

  const weightedPick = (candidates) => {
    if (!candidates.length) return null;
    const tierCounts = ABILITY_DROP_TABLE.map(
      (_, tierIndex) =>
        candidates.filter(
          (candidate) => abilityDropTier(candidate) === tierIndex,
        ).length,
    );
    const weighted = candidates.map((candidate) => {
      const tierIndex = abilityDropTier(candidate);
      return {
        candidate,
        weight:
          ABILITY_DROP_TABLE[tierIndex].share /
          Math.max(1, tierCounts[tierIndex]),
      };
    });
    const totalWeight = weighted.reduce((sum, item) => sum + item.weight, 0);
    let ticket = random() * totalWeight;
    return (
      weighted.find((item) => {
        ticket -= item.weight;
        return ticket <= 0;
      }) || weighted.at(-1)
    ).candidate;
  };

  const addCandidate = (candidate) => {
    if (!candidate) return false;
    selected.push(candidate);
    databaseCounts.set(
      candidate.database_slug,
      (databaseCounts.get(candidate.database_slug) || 0) + 1,
    );
    usedPlayers.add(candidateIdentity(candidate));
    return true;
  };

  const guaranteedFitCount = Math.min(
    SUGGESTIONS_PER_ROLL,
    new Set(openSlots.map((slotItem) => slotItem.effectiveRole)).size,
  );
  const coveredSlotIds = new Set();
  for (let index = 0; index < guaranteedFitCount; index += 1) {
    const fittingCandidates = availableCandidates().filter(fitsOpenSlot);
    if (!fittingCandidates.length) break;
    const addsCoverage = fittingCandidates.filter((candidate) =>
      fittingSlotIds(candidate).some((slotId) => !coveredSlotIds.has(slotId)),
    );
    const candidate = weightedPick(
      addsCoverage.length ? addsCoverage : fittingCandidates,
    );
    addCandidate(candidate);
    const newlyCoveredSlot = fittingSlotIds(candidate).find(
      (slotId) => !coveredSlotIds.has(slotId),
    );
    if (newlyCoveredSlot) coveredSlotIds.add(newlyCoveredSlot);
  }

  while (selected.length < SUGGESTIONS_PER_ROLL) {
    const available = availableCandidates();
    if (!available.length) break;
    addCandidate(weightedPick(available));
  }

  const replaceWith = (candidate, maximumReplacementAbility = Infinity) => {
    const candidateFits = fitsOpenSlot(candidate);
    const sameFitIndexes = selected
      .map((item, index) => ({ item, index }))
      .filter(
        ({ item }) =>
          fitsOpenSlot(item) === candidateFits &&
          Number(item.current_ability || 0) <= maximumReplacementAbility,
      );
    sameFitIndexes.sort(
      (left, right) =>
        Number(left.item.current_ability || 0) -
        Number(right.item.current_ability || 0),
    );
    const sameDatabase = sameFitIndexes.find(
      ({ item }) => item.database_slug === candidate.database_slug,
    );
    const replacement =
      sameDatabase ||
      ((databaseCounts.get(candidate.database_slug) || 0) <
      maximumChoicesPerDatabase()
        ? sameFitIndexes.at(-1)
        : null);
    if (!replacement) return false;
    const replaced = replacement.item;
    selected.splice(replacement.index, 1, candidate);
    usedPlayers.delete(candidateIdentity(replaced));
    usedPlayers.add(candidateIdentity(candidate));
    if (replaced.database_slug !== candidate.database_slug) {
      databaseCounts.set(
        replaced.database_slug,
        Math.max(0, (databaseCounts.get(replaced.database_slug) || 1) - 1),
      );
      databaseCounts.set(
        candidate.database_slug,
        (databaseCounts.get(candidate.database_slug) || 0) + 1,
      );
    }
    return true;
  };

  const ensureRemainingSlotCoverage = () => {
    if (
      !openSlots.length ||
      openSlots.length > 3 ||
      selected.length !== SUGGESTIONS_PER_ROLL
    ) {
      return;
    }
    const coversSlot = (candidate, slotItem) =>
      isTargetPositionMatch(
        candidate,
        slotItem.effectiveRole,
        openSlots.length,
      );
    const coverageCount = (selection) =>
      openSlots.filter((slotItem) =>
        selection.some((candidate) => coversSlot(candidate, slotItem)),
      ).length;

    while (coverageCount(selected) < openSlots.length) {
      const currentCoverage = coverageCount(selected);
      const options = seededShuffle(
        availableCandidates().flatMap((candidate) => {
          const sameDatabaseIndexes = selected
            .map((item, index) => ({ item, index }))
            .filter(
              ({ item }) => item.database_slug === candidate.database_slug,
            )
            .map(({ index }) => index);
          const replacementIndexes = sameDatabaseIndexes.length
            ? sameDatabaseIndexes
            : (databaseCounts.get(candidate.database_slug) || 0) <
                maximumChoicesPerDatabase()
              ? selected.map((_, index) => index)
              : [];
          return replacementIndexes
            .map((index) => {
              const trial = selected.slice();
              trial[index] = candidate;
              return {
                candidate,
                index,
                coverage: coverageCount(trial),
                replacedAbility: Number(selected[index].current_ability || 0),
              };
            })
            .filter((option) => option.coverage > currentCoverage);
        }),
        seed + 2501 + currentCoverage,
      ).sort(
        (left, right) =>
          right.coverage - left.coverage ||
          left.replacedAbility - right.replacedAbility,
      );
      const option = options[0];
      if (!option) break;
      const replaced = selected[option.index];
      selected.splice(option.index, 1, option.candidate);
      usedPlayers.delete(candidateIdentity(replaced));
      usedPlayers.add(candidateIdentity(option.candidate));
      if (replaced.database_slug !== option.candidate.database_slug) {
        databaseCounts.set(
          replaced.database_slug,
          Math.max(0, (databaseCounts.get(replaced.database_slug) || 1) - 1),
        );
        databaseCounts.set(
          option.candidate.database_slug,
          (databaseCounts.get(option.candidate.database_slug) || 0) + 1,
        );
      }
    }
  };

  const ensureQualityChoices = () => {
    while (
      selected.length === SUGGESTIONS_PER_ROLL &&
      selected.filter(
        (candidate) =>
          Number(candidate.current_ability || 0) >= QUALITY_ABILITY_FLOOR,
      ).length < MIN_QUALITY_CHOICES_PER_ROLL
    ) {
      const qualityCandidates = availableCandidates().filter(
        (candidate) =>
          Number(candidate.current_ability || 0) >= QUALITY_ABILITY_FLOOR &&
          selected.some(
            (item) =>
              fitsOpenSlot(item) === fitsOpenSlot(candidate) &&
              Number(item.current_ability || 0) < QUALITY_ABILITY_FLOOR,
          ),
      );
      if (!qualityCandidates.length) break;
      const candidatesToTry = qualityCandidates.slice();
      let replaced = false;
      while (candidatesToTry.length) {
        const replacement = weightedPick(candidatesToTry);
        candidatesToTry.splice(candidatesToTry.indexOf(replacement), 1);
        if (replaceWith(replacement, QUALITY_ABILITY_FLOOR - 1)) {
          replaced = true;
          break;
        }
      }
      if (!replaced) break;
    }
  };

  ensureQualityChoices();

  if (
    state.qualityDrought >= 2 &&
    !selected.some((candidate) => Number(candidate.current_ability || 0) >= 140)
  ) {
    const pityCandidates = seededShuffle(
      eligible.filter((candidate) => {
        const ability = Number(candidate.current_ability || 0);
        const identity = candidateIdentity(candidate);
        return ability >= 140 && ability <= 155 && !usedPlayers.has(identity);
      }),
      seed + 701,
    );
    pityCandidates.some(replaceWith);
  }

  if (
    state.premiumDrought >= 4 &&
    !selected.some((candidate) => Number(candidate.current_ability || 0) >= 170)
  ) {
    const premiumCandidates = seededShuffle(
      eligible.filter((candidate) => {
        const ability = Number(candidate.current_ability || 0);
        const identity = candidateIdentity(candidate);
        return ability >= 170 && ability < 185 && !usedPlayers.has(identity);
      }),
      seed + 1701,
    );
    premiumCandidates.some(replaceWith);
  }

  if (
    state.rerollsRemaining <= 0 &&
    !selected.some((candidate) =>
      openSlots.some((slotItem) =>
        isTargetPositionMatch(
          candidate,
          slotItem.effectiveRole,
          openSlots.length,
        ),
      ),
    )
  ) {
    const emergencyCandidates = eligible
      .filter((candidate) => {
        const identity = candidateIdentity(candidate);
        return (
          Number(candidate.current_ability || 0) < 140 &&
          !usedPlayers.has(identity) &&
          openSlots.some((slotItem) =>
            isTargetPositionMatch(
              candidate,
              slotItem.effectiveRole,
              openSlots.length,
            ),
          )
        );
      })
      .sort(
        (left, right) =>
          bestFit(right, openSlots).score - bestFit(left, openSlots).score ||
          Number(right.current_ability || 0) -
            Number(left.current_ability || 0),
      );
    emergencyCandidates.some(replaceWith);
  }

  ensureRemainingSlotCoverage();

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
  const setupLocked =
    state.rolling || state.rollNumber > 0 || state.drafted.size > 0;
  for (const container of [formationChoices, styleChoices, modeChoices]) {
    container.querySelectorAll("button").forEach((button) => {
      button.disabled = setupLocked;
    });
  }
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
        ? state.captainSlotId
          ? state.selectedDraftSlotId
            ? `${playerName(drafted)} · click to swap positions`
            : `${playerName(drafted)} · select to move`
          : `${playerName(drafted)} · click to select as captain`
        : `${playerName(drafted)} · locked at ${item.effectiveRole}`
      : selected
        ? isSupportedPitchFit(fit)
          ? `${fit.label} at ${item.effectiveRole}`
          : `Emergency cover at ${item.effectiveRole} · severe ability penalty`
        : `Empty ${item.effectiveRole} position`;

    if (drafted) {
      const draftedFit = positionFit(drafted, item.effectiveRole);
      const theme = clubTheme(drafted);
      const isCaptain = state.captainSlotId === item.id;
      marker.classList.add(
        "is-filled",
        `fit-${draftedFit.level}`,
        ...playerCardTier(drafted).split(" "),
      );
      if (draftedFit.level !== "natural")
        marker.classList.add("is-out-of-position");
      if (isCaptain) marker.classList.add("is-captain");
      if (state.selectedDraftSlotId === item.id)
        marker.classList.add("is-swap-source");
      if (state.drafted.size < 11) {
        marker.classList.add("is-locked-position");
        marker.disabled = true;
      }
      marker.style.setProperty("--club-bg", theme.background);
      marker.style.setProperty("--club-secondary", theme.secondary);
      marker.style.setProperty("--club-fg", theme.foreground);
      const season = document.createElement("span");
      season.className = "formation-player-season";
      season.textContent = seasonLabel(drafted);
      marker.append(season);
      if (isCaptain) {
        const captain = document.createElement("span");
        captain.className = "formation-player-captain";
        captain.textContent = "C";
        marker.append(captain);
      }
      const heading = document.createElement("span");
      heading.className = "formation-player-heading";
      const ability = document.createElement("strong");
      ability.className = "formation-player-ability";
      ability.textContent = draftedOverall(drafted);
      const divider = document.createElement("i");
      divider.setAttribute("aria-hidden", "true");
      const role = document.createElement("span");
      role.className = "formation-player-role";
      role.textContent = item.effectiveRole;
      heading.append(ability, divider, role);
      const name = document.createElement("span");
      name.className = "formation-player-name";
      name.textContent = shortPlayerName(drafted).toLocaleUpperCase();
      marker.append(heading, name);
    } else {
      marker.textContent = item.effectiveRole;
      if (isSupportedPitchFit(fit)) {
        marker.classList.add("is-fit-target", `fit-${fit.level}`);
      } else if (selected) {
        marker.classList.add("is-emergency-target", "fit-none");
      }
    }
    pitch.append(marker);
  }

  caption.textContent = `${state.formation} · ${state.style}`;
  summary.textContent = `${state.formation} · ${state.style} · ${state.mode}`;
  const lineupComplete = state.drafted.size >= 11;
  suggestionsPanel.classList.toggle("is-collapsed", lineupComplete);
  captainPrompt.hidden = !lineupComplete;
  if (lineupComplete) {
    captainPrompt.querySelector("span").textContent = state.captainSlotId
      ? "Captain selected"
      : "Starting XI complete";
    captainPrompt.querySelector("strong").textContent = state.captainSlotId
      ? playerName(state.drafted.get(state.captainSlotId))
      : "Select your Captain";
    captainPrompt.querySelector("small").textContent = state.captainSlotId
      ? state.selectedDraftSlotId
        ? "Now select another player to swap their positions."
        : "Select a player, then another player, to swap their positions."
      : "Select one of the eleven players on the pitch.";
  }
  progress.textContent =
    state.drafted.size < 11
      ? `${state.drafted.size} / 11`
      : state.captainSlotId
        ? `11 / 11 · ${playerName(state.drafted.get(state.captainSlotId))} (C)`
        : "11 / 11 · Select captain";
  const isReroll = state.suggestions.length > 0;
  const diceFaces = ["one", "two", "three", "four", "five", "six"];
  const compactDice = Array.from(
    { length: 3 },
    () =>
      `<span class="draft-die">${diceFaces
        .map((face) => `<i class="draft-die-face ${face}"></i>`)
        .join("")}</span>`,
  ).join("");
  const rollButtonContent = state.rolling
    ? `<span class="draft-dice-loader" aria-hidden="true">${compactDice}</span><span>Rolling</span>`
    : isReroll
      ? `Re-roll <span>${state.rerollsRemaining} left</span>`
      : 'Roll the Dice <span aria-hidden="true">🎲</span>';
  const rollDisabled =
    state.rolling ||
    !isDatabaseDraftMode() ||
    state.drafted.size >= 11 ||
    (isReroll && state.rerollsRemaining <= 0);
  rollButton.innerHTML = rollButtonContent;
  rollButton.disabled = rollDisabled;
  mobileRollButton.innerHTML = lineupComplete
    ? state.captainSlotId
      ? 'Captain Selected <span aria-hidden="true">✓</span>'
      : 'Select Captain <span aria-hidden="true">↓</span>'
    : rollButtonContent;
  mobileRollButton.disabled = lineupComplete
    ? Boolean(state.captainSlotId)
    : rollDisabled;
  renderSquadSummary();
}

function renderSuggestions(message = "", reveal = false) {
  suggestions.replaceChildren();
  if (message || !state.suggestions.length) {
    const empty = document.createElement("div");
    empty.className = "draft-suggestions-empty";
    empty.textContent = message || "No players rolled yet.";
    suggestions.append(empty);
    return;
  }

  state.suggestions.forEach((candidate, index) => {
    const fit = bestFit(candidate);
    const button = document.createElement("button");
    button.type = "button";
    button.className = `draft-suggestion-card fit-${fit.level}`;
    button.dataset.candidateKey = candidateKey(candidate);
    button.classList.toggle(
      "is-selected",
      button.dataset.candidateKey === state.selectedCandidateKey,
    );
    if (!fit.slot) {
      button.disabled = true;
      button.classList.add("is-locked");
    }
    const theme = clubTheme(candidate);
    button.style.setProperty("--club-bg", theme.background);
    button.style.setProperty("--club-secondary", theme.secondary);
    button.style.setProperty("--club-fg", theme.foreground);
    if (reveal) {
      button.classList.add("is-revealing");
      button.style.setProperty("--reveal-index", index);
    }

    const heading = document.createElement("span");
    heading.className = "draft-suggestion-name";
    heading.textContent = playerName(candidate);
    const season = document.createElement("span");
    season.className = "draft-suggestion-season";
    season.textContent = seasonLabel(candidate);
    const meta = document.createElement("span");
    meta.className = "draft-suggestion-meta";
    meta.textContent = [
      candidate.canonical_club_name || candidate.club_name,
      candidate.nation_name,
    ]
      .filter(Boolean)
      .join(" · ");
    const ratings = document.createElement("span");
    ratings.className = "draft-suggestion-ratings";
    ratings.innerHTML = `<span>OVR <strong>${draftedOverall(candidate)}</strong></span>`;
    const fitBadge = document.createElement("span");
    fitBadge.className = "draft-fit-badge";
    fitBadge.textContent = playerMainPositionSummary(candidate);
    button.append(heading, season, meta, ratings, fitBadge);
    suggestions.append(button);
  });
}

function resetDraft(message) {
  clearPersistedSquad();
  state.drafted.clear();
  state.captainSlotId = "";
  state.suggestions = [];
  state.selectedCandidateKey = "";
  state.selectedDraftSlotId = "";
  state.rollNumber = 0;
  state.rerollsRemaining = 3;
  state.qualityDrought = 0;
  state.premiumDrought = 0;
  state.offeredPlayerIds.clear();
  state.databasesUsedForCurrentPick.clear();
  rollIntro.textContent = message;
  suggestionHelp.textContent = state.mode === "Titan Fight"
    ? "Every suggestion has CA 165 or higher. Build an XI to face the Titans."
    : "Roll the dice for five database-backed choices.";
  modeKicker.textContent = state.mode === "Titan Fight" ? "Titan roll" : `${state.mode} roll`;
  renderScenarioPicker();
  renderSuggestions();
  renderPitch();
}

async function rollPlayers() {
  if (!isDatabaseDraftMode() || state.rolling || state.drafted.size >= 11)
    return;
  const isReroll = state.suggestions.length > 0;
  if (isReroll && state.rerollsRemaining <= 0) return;
  const previousSuggestions = state.suggestions;
  if (isReroll) state.rerollsRemaining -= 1;
  state.rolling = true;
  state.selectedCandidateKey = "";
  rollIntro.textContent = usesFullDatabasePool()
    ? `Drawing this roll from every eligible ${state.mode === "Titan Fight" ? "elite" : "classic"} season…`
    : `Drawing this roll from five ${state.mode === "Titan Fight" ? "elite" : "classic"} seasons…`;
  suggestionHelp.textContent =
    "Finding choices that fit your unfilled positions.";
  renderSuggestions("Loading player choices…");
  renderPitch();

  try {
    const seed =
      Math.floor(Math.random() * 2_147_000_000) ^
      Date.now() ^
      ((state.rollNumber + 1) * 104729);
    const openSlots = remainingSlots();
    const fullDatabasePool = usesFullDatabasePool(openSlots);
    const openRoles = openSlots.map((item) => item.effectiveRole);
    const targetPositions =
      openRoles.length <= 5 ? [...new Set(openRoles)] : [];
    let rollSeed = seed;
    let rollDatabases = [];
    let rollPool = [];
    const accumulatedPool = new Map();
    const maximumAttempts = state.mode === "Titan Fight" ? 6 : 3;
    for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
      rollSeed = seed + attempt * 1_000_003;
      const payload = await getDraftCandidates({
        seed: rollSeed,
        perDatabase: openSlots.length <= 3 ? 30 : 28,
        positions: targetPositions,
        minAbility: minimumDraftAbility(),
      });
      payload.items.forEach((candidate) => {
        accumulatedPool.set(candidateKey(candidate), candidate);
      });
      const accumulatedItems = [...accumulatedPool.values()];
      rollDatabases = selectRollDatabases(accumulatedItems, rollSeed);
      rollPool = accumulatedItems.filter((candidate) =>
        rollDatabases.includes(candidate.database_slug),
      );
      const hasRequiredDatabaseMix = state.mode === "Titan Fight"
        ? rollDatabases.length > 0
        : rollDatabases.length >= DATABASES_PER_ROLL
          && (fullDatabasePool || rollDatabases.length === DATABASES_PER_ROLL);
      if (hasRequiredDatabaseMix && poolCoversLateTargets(rollPool, openSlots)) break;
    }
    if (state.mode === "Titan Fight" && !rollDatabases.length) {
      throw new Error(
        "No CA 165+ players could be found for the open positions.",
      );
    }
    if (state.mode !== "Titan Fight" && (
      rollDatabases.length < DATABASES_PER_ROLL ||
      (!fullDatabasePool && rollDatabases.length !== DATABASES_PER_ROLL)
    )) {
      throw new Error(
        "Five suitable seasons could not be found for this formation.",
      );
    }
    if (!poolCoversLateTargets(rollPool, openSlots)) {
      throw new Error(
        "Exact choices for the remaining positions could not be found. Please roll again.",
      );
    }
    state.suggestions = chooseSuggestions(rollPool, rollSeed);
    if (state.suggestions.length !== SUGGESTIONS_PER_ROLL) {
      throw new Error(
        "Five formation-compatible players could not be found for this roll.",
      );
    }
    rollDatabases.forEach((database) => {
      state.databasesUsedForCurrentPick.add(database);
    });
    state.suggestions.forEach((candidate) => {
      state.offeredPlayerIds.add(candidateIdentity(candidate));
    });
    state.qualityDrought = state.suggestions.some(
      (candidate) => Number(candidate.current_ability || 0) >= 140,
    )
      ? 0
      : state.qualityDrought + 1;
    state.premiumDrought = state.suggestions.some(
      (candidate) => Number(candidate.current_ability || 0) >= 170,
    )
      ? 0
      : state.premiumDrought + 1;
    state.rollNumber += 1;
    rollIntro.textContent = fullDatabasePool
      ? `${state.suggestions.length} players rolled from all ${rollDatabases.length} eligible ${state.mode === "Titan Fight" ? "elite" : "classic"} seasons.`
      : `${state.suggestions.length} players rolled from five ${state.mode === "Titan Fight" ? "elite" : "classic"} seasons.`;
    suggestionHelp.textContent =
      state.rerollsRemaining > 0
        ? `Select a player and position, or use one of ${state.rerollsRemaining} remaining re-rolls.`
        : "Final choices for this position. Select a player, then choose a highlighted pitch position.";
    renderSuggestions("", true);
  } catch (error) {
    state.suggestions = isReroll ? previousSuggestions : [];
    if (isReroll) state.rerollsRemaining += 1;
    rollIntro.textContent = "The database roll failed.";
    suggestionHelp.textContent = error.message || "Please try rolling again.";
    renderSuggestions(isReroll ? "" : "Could not load player choices.");
  } finally {
    state.rolling = false;
    renderPitch();
    scrollMobileDraftTo(suggestionsPanel);
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
    if (
      !button ||
      button.disabled ||
      state.rolling ||
      state.rollNumber > 0 ||
      state.drafted.size > 0 ||
      state[key] === button.dataset.value
    )
      return;
    state[key] = button.dataset.value;
    container.querySelectorAll("button").forEach((item) => {
      item.classList.toggle("is-selected", item === button);
    });

    if (key === "mode" && state.mode === "From memory") {
      resetDraft(
        "From-memory drafting will use manual player entry; Classic mode uses the database.",
      );
      suggestionHelp.textContent =
        "Switch back to Classic to roll database players.";
      return;
    }
    if (key === "mode" && state.mode === "Titan Fight") {
      resetDraft(
        "Titan Fight selected. Draft only elite players with CA 165 or higher.",
      );
      return;
    }
    resetDraft(
      `${key === "formation" ? "Formation" : key === "style" ? "Style" : "Mode"} changed. Roll a fresh set of players.`,
    );
  });
}

bindChoiceGroup(formationChoices, "formation");
bindChoiceGroup(styleChoices, "style");
bindChoiceGroup(modeChoices, "mode");

suggestions.addEventListener("click", (event) => {
  const card = event.target.closest("[data-candidate-key]");
  if (!card || card.disabled) return;
  state.selectedCandidateKey = card.dataset.candidateKey;
  const candidate = state.suggestions.find(
    (item) => candidateKey(item) === state.selectedCandidateKey,
  );
  const fit = candidate ? bestFit(candidate) : null;
  suggestionHelp.textContent = fit?.slot
    ? isSupportedPitchFit(fit)
      ? `${playerName(candidate)} is ${fit.label.toLowerCase()} at ${fit.slot.effectiveRole}. Choose a highlighted position.`
      : `${playerName(candidate)} has no recognised rating at ${fit.slot.effectiveRole}, but can provide emergency cover with a severe ability penalty.`
    : "This player has no recognised fit in the current formation.";
  renderSuggestions();
  renderPitch();
  scrollMobileDraftTo(pitch, "center");
});

pitch.addEventListener("click", (event) => {
  const marker = event.target.closest("[data-slot-id]");
  if (!marker) return;
  const slotId = marker.dataset.slotId;

  if (state.drafted.has(slotId) && !state.selectedCandidateKey) {
    const drafted = state.drafted.get(slotId);
    if (state.drafted.size >= 11) {
      if (!state.captainSlotId) {
        state.captainSlotId = slotId;
        state.selectedDraftSlotId = "";
        rollIntro.textContent = `${playerName(drafted)} selected as captain. The hidden boost will apply in matches.`;
        suggestionHelp.textContent =
          "Select a player, then another player, to swap their positions.";
        renderPitch();
        scrollMobileDraftTo(scenarioPicker);
        return;
      }
      if (!state.selectedDraftSlotId) {
        state.selectedDraftSlotId = slotId;
        suggestionHelp.textContent = `${playerName(drafted)} selected. Choose another player to swap positions.`;
        renderPitch();
        return;
      }
      if (state.selectedDraftSlotId === slotId) {
        state.selectedDraftSlotId = "";
        suggestionHelp.textContent =
          "Position switch cancelled. Select a player to move.";
        renderPitch();
        return;
      }
      const sourceSlotId = state.selectedDraftSlotId;
      const sourcePlayer = state.drafted.get(sourceSlotId);
      const targetPlayer = state.drafted.get(slotId);
      state.drafted.set(sourceSlotId, targetPlayer);
      state.drafted.set(slotId, sourcePlayer);
      if (state.captainSlotId === sourceSlotId) state.captainSlotId = slotId;
      else if (state.captainSlotId === slotId)
        state.captainSlotId = sourceSlotId;
      state.selectedDraftSlotId = "";
      rollIntro.textContent = `${playerName(sourcePlayer)} and ${playerName(targetPlayer)} switched positions.`;
      suggestionHelp.textContent =
        "Select another pair of players to switch positions.";
      renderPitch();
      return;
    }
    suggestionHelp.textContent = `${playerName(drafted)} is locked at ${currentSlots().find((item) => item.id === slotId)?.effectiveRole || "this position"}.`;
    return;
  }

  const candidate = state.suggestions.find(
    (item) => candidateKey(item) === state.selectedCandidateKey,
  );
  const target = currentSlots().find((item) => item.id === slotId);
  if (!candidate || !target || state.drafted.has(slotId)) return;
  const fit = positionFit(candidate, target.effectiveRole);

  state.drafted.set(slotId, candidate);
  state.suggestions = [];
  state.selectedCandidateKey = "";
  state.selectedDraftSlotId = "";
  state.databasesUsedForCurrentPick.clear();
  rollIntro.textContent = isSupportedPitchFit(fit)
    ? `${playerName(candidate)} drafted at ${target.effectiveRole} (${fit.label.toLowerCase()}).`
    : `${playerName(candidate)} drafted as emergency cover at ${target.effectiveRole}; the severe out-of-position penalty will apply.`;
  suggestionHelp.textContent =
    state.drafted.size >= 11
      ? "Starting XI complete. Select one of the eleven players as your captain."
      : "Signing complete for this roll. Roll again for five fresh choices.";
  renderSuggestions(
    state.drafted.size >= 11
      ? "Choose your captain on the pitch."
      : "Roll again to sign the next player.",
  );
  renderPitch();
  scrollMobileDraftTo(mobileRollButton, "center");
});

rollButton.addEventListener("click", rollPlayers);
mobileRollButton.addEventListener("click", () => {
  if (state.drafted.size >= 11 && !state.captainSlotId) {
    scrollMobileDraftTo(pitch, "center");
    return;
  }
  rollPlayers();
});
teamNameInput.addEventListener("input", persistSquad);
scenarioChoices.addEventListener("click", (event) => {
  const button = event.target.closest("[data-scenario]");
  if (!button || button.dataset.scenario === state.scenario) return;
  state.scenario = button.dataset.scenario;
  if (state.scenario !== "titan") state.classicScenario = state.scenario;
  scenarioChoices.querySelectorAll("[data-scenario]").forEach((item) => {
    item.classList.toggle("is-selected", item === button);
  });
  persistSquad();
});
simulateButton.addEventListener("click", () => {
  persistSquad();
  window.location.href = friendSession
    ? `draft-run.html${window.location.hash}`
    : "draft-run.html";
});

renderSuggestions();
renderPitch();
