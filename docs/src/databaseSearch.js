import {
  API_BASE,
  getDatabases,
  getFilters,
  getPlayer,
  getPlayerHistory,
  getPlayerSeasons,
  searchPlayers,
} from "./lib/retroballApi.js";
import "./pixelCanvas.js?v=20260729-29";

const PAGE_SIZE = 20;
const SEARCH_DEBOUNCE_MS = 300;
const AUTOCOMPLETE_LIMIT = 8;

const ATTRIBUTE_GROUPS = [
  {
    title: "Technical",
    labels: [
      "Corners",
      "Crossing",
      "Dribbling",
      "Finishing",
      "First Touch",
      "Free Kicks",
      "Heading",
      "Long Shots",
      "Marking",
      "Passing",
      "Penalties",
      "Set Pieces",
      "Shooting",
      "Tackling",
      "Technique",
      "Throw Ins",
    ],
  },
  {
    title: "Mental",
    labels: [
      "Adaptability",
      "Aggression",
      "Anticipation",
      "Bravery",
      "Character",
      "Consistency",
      "Creativity",
      "Decisions",
      "Determination",
      "Flair",
      "Important Matches",
      "Leadership",
      "Off the Ball",
      "Positioning",
      "Teamwork",
      "Vision",
      "Work Rate",
    ],
  },
  {
    title: "Physical / GK",
    labels: [
      "Acceleration",
      "Agility",
      "Balance",
      "Handling",
      "Injury Proneness",
      "Jumping",
      "Natural Fitness",
      "One On Ones",
      "Pace",
      "Reflexes",
      "Stamina",
      "Strength",
    ],
  },
];

const HIDDEN_ATTRIBUTE_LABELS = [
  "Dirtiness",
  "Left Foot",
  "Right Foot",
  "Versatility",
];

const PITCH_ROLE_NAMES = {
  GK: "Goalkeeper", SW: "Sweeper", DL: "Defender - Left", DC: "Defender - Centre",
  DR: "Defender - Right", WBL: "Wing Back - Left", WBR: "Wing Back - Right",
  DML: "Defensive Midfielder - Left", DMC: "Defensive Midfielder - Centre",
  DMR: "Defensive Midfielder - Right", ML: "Midfielder - Left", MC: "Midfielder - Centre",
  MR: "Midfielder - Right", AML: "Attacking Midfielder - Left",
  AMC: "Attacking Midfielder - Centre", AMR: "Attacking Midfielder - Right",
  LW: "Left Winger", RW: "Right Winger", ST: "Striker - Centre",
};

const PITCH_LANES = {
  wideLeft: 8,
  left: 17,
  defensiveLeft: 28,
  centre: 50,
  defensiveRight: 74,
  right: 83,
  wideRight: 92,
};
const PITCH_ROWS = {
  striker: 14,
  attackingMidfield: 30,
  midfield: 46,
  defensiveMidfield: 62,
  defence: 78,
  sweeper: 86,
  goalkeeper: 94,
};
const PITCH_SLOTS = [
  ["LW", "left", "striker"],
  ["ST", "centre", "striker"],
  ["RW", "right", "striker"],
  ["AML", "left", "attackingMidfield"],
  ["AMC", "centre", "attackingMidfield"],
  ["AMR", "right", "attackingMidfield"],
  ["ML", "left", "midfield"],
  ["MC", "centre", "midfield"],
  ["MR", "right", "midfield"],
  ["WBL", "wideLeft", "defensiveMidfield"],
  ["DML", "defensiveLeft", "defensiveMidfield"],
  ["DMC", "centre", "defensiveMidfield"],
  ["DMR", "defensiveRight", "defensiveMidfield"],
  ["WBR", "wideRight", "defensiveMidfield"],
  ["DL", "left", "defence"],
  ["DC", "centre", "defence"],
  ["DR", "right", "defence"],
  ["SW", "centre", "sweeper"],
  ["GK", "centre", "goalkeeper"],
].map(([label, lane, row]) => ({
  label,
  x: PITCH_LANES[lane],
  y: PITCH_ROWS[row],
}));

const state = {
  databases: [],
  selectedDatabase: "",
  query: "",
  club: "",
  league: "",
  nation: "",
  page: 1,
  hasMorePlayers: true,
  items: [],
  selectedPlayer: null,
  selectedProfile: null,
  selectedHistory: [],
  selectedSeasonEntries: [],
  activeDetailTab: "profile",
  detailLoading: false,
  detailError: "",
  historyLoading: false,
  historyError: "",
  seasonLoading: false,
  seasonError: "",
  loadingPlayers: false,
  loadingMorePlayers: false,
  playerAbortController: null,
  detailAbortController: null,
  historyAbortController: null,
  seasonAbortController: null,
  detailCache: new Map(),
  historyCache: new Map(),
  seasonCache: new Map(),
  filterOptions: {
    club: [],
    league: [],
    nation: [],
  },
  filterOptionsDatabase: "",
  autocompleteField: "",
  autocompleteIndex: -1,
};

const elements = {
  status: document.querySelector("#status"),
  databaseSelect: document.querySelector("#databaseSelect"),
  nameSearch: document.querySelector("#nameSearch"),
  clubSearch: document.querySelector("#clubSearch"),
  leagueSearch: document.querySelector("#leagueSearch"),
  nationSearch: document.querySelector("#nationSearch"),
  clubSuggestions: document.querySelector("#clubSuggestions"),
  leagueSuggestions: document.querySelector("#leagueSuggestions"),
  nationSuggestions: document.querySelector("#nationSuggestions"),
  activeSearchFilters: document.querySelector("#activeSearchFilters"),
  resultCount: document.querySelector("#resultCount"),
  resultsList: document.querySelector("#resultsList"),
  profile: document.querySelector("#profile"),
};

const autocompleteFields = {
  club: {
    input: elements.clubSearch,
    suggestions: elements.clubSuggestions,
  },
  league: {
    input: elements.leagueSearch,
    suggestions: elements.leagueSuggestions,
  },
  nation: {
    input: elements.nationSearch,
    suggestions: elements.nationSuggestions,
  },
};

let searchTimer = null;

function currentDatabase() {
  return state.databases.find((database) => database.slug === state.selectedDatabase);
}

function databaseTitle(databaseSlug) {
  return state.databases.find((database) => database.slug === databaseSlug)?.title || databaseSlug;
}

function playerKey(player) {
  return `${player.database_slug}:${player.source_person_id}`;
}

function playerDeepLink(player) {
  const url = new URL(window.location.href);
  url.searchParams.set("database", player.database_slug);
  url.searchParams.set("player", player.source_person_id);
  return url;
}

function syncPlayerUrl(player, replace = false) {
  const method = replace ? "replaceState" : "pushState";
  window.history[method]({}, "", playerDeepLink(player));
}

function seasonEntryKey(entry) {
  return `${entry.database_slug}:${entry.source_person_id}`;
}

function playerName(player) {
  return (
    player.canonical_player_name ||
    player.display_name ||
    player.full_name ||
    player.common_name ||
    "Unknown player"
  );
}

function displayClubName(player) {
  return player?.canonical_club_name || player?.club_name || "";
}

function distinctFullName(player) {
  const name = playerName(player);
  return player.full_name && player.full_name !== name ? player.full_name : "";
}

const SUMMARY_POSITION_ROLES = {
  GK: "Goalkeeper",
  SW: "Sweeper",
  D: "Defender",
  WB: "Wing Back",
  DM: "Defensive Midfielder",
  M: "Midfielder",
  AM: "Attacking Midfielder",
  F: "Forward",
  S: "Striker",
};

const SUMMARY_POSITION_SIDES = {
  L: "Left",
  C: "Center",
  R: "Right",
};

function summaryPosition(positionText) {
  const rawPosition = String(positionText || "").trim();
  if (!rawPosition) return "No position";

  const parts = rawPosition.split(/\s+/);
  const sideCode = /^[LCR]+$/.test(parts.at(-1)) ? parts.pop() : "";
  const roleCodes = parts
    .join(" ")
    .replace(/,/g, "/")
    .split("/")
    .map((code) => code.trim())
    .filter(Boolean);
  const roles = roleCodes.map((code) => SUMMARY_POSITION_ROLES[code] || code);
  const sides = [...sideCode].map(
    (code) => SUMMARY_POSITION_SIDES[code] || code,
  );

  return [roles.join(" / "), sides.join(" / ")].filter(Boolean).join(" ");
}

function formatValue(value) {
  return value === null || value === undefined || value === "" ? "-" : String(value);
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString() : "-";
}

function formatDate(value) {
  if (!value) {
    return "-";
  }

  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;",
  })[char]);
}

function setStatus(message) {
  elements.status.textContent = message;
}

function renderSummary() {
  // The database selector and results count already expose the useful state.
}

function renderActiveSearchFilters() {
  const filters = [
    ["Name", state.query],
    ["Club", state.club],
    ["League", state.league],
    ["Nation", state.nation],
  ].filter(([, value]) => value);

  elements.activeSearchFilters.replaceChildren(
    ...filters.map(([label, value]) => {
      const chip = document.createElement("span");
      chip.className = "active-search-filter";
      chip.textContent = `${label}: ${value}`;
      chip.title = `${label}: ${value}`;
      return chip;
    }),
  );
}

function normalizeAutocompleteValue(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en");
}

function filterOptionNames(items) {
  return [
    ...new Set(
      (Array.isArray(items) ? items : [])
        .map((item) => (typeof item === "string" ? item : item?.name))
        .map((name) => String(name || "").trim())
        .filter(Boolean),
    ),
  ].sort((left, right) => left.localeCompare(right));
}

function closeAutocomplete(field = "") {
  const fields = field ? [field] : Object.keys(autocompleteFields);
  for (const currentField of fields) {
    const config = autocompleteFields[currentField];
    config.suggestions.hidden = true;
    config.suggestions.replaceChildren();
    config.input.setAttribute("aria-expanded", "false");
    config.input.removeAttribute("aria-activedescendant");
  }

  if (!field || state.autocompleteField === field) {
    state.autocompleteField = "";
    state.autocompleteIndex = -1;
  }
}

function autocompleteMatches(field) {
  const query = normalizeAutocompleteValue(
    autocompleteFields[field].input.value.trim(),
  );
  if (!query || state.filterOptionsDatabase !== state.selectedDatabase)
    return [];

  const startsWith = [];
  const contains = [];
  for (const option of state.filterOptions[field]) {
    const normalizedOption = normalizeAutocompleteValue(option);
    if (normalizedOption.startsWith(query)) {
      startsWith.push(option);
    } else if (normalizedOption.includes(query)) {
      contains.push(option);
    }
  }
  return [...startsWith, ...contains].slice(0, AUTOCOMPLETE_LIMIT);
}

function setAutocompleteIndex(field, index) {
  const config = autocompleteFields[field];
  const options = [
    ...config.suggestions.querySelectorAll("[data-autocomplete-value]"),
  ];
  if (!options.length) return;

  state.autocompleteField = field;
  state.autocompleteIndex = (index + options.length) % options.length;
  options.forEach((option, optionIndex) => {
    const selected = optionIndex === state.autocompleteIndex;
    option.classList.toggle("is-active", selected);
    option.setAttribute("aria-selected", String(selected));
  });
  const activeOption = options[state.autocompleteIndex];
  config.input.setAttribute("aria-activedescendant", activeOption.id);
  activeOption.scrollIntoView({ block: "nearest" });
}

function renderAutocomplete(field) {
  const config = autocompleteFields[field];
  const matches = autocompleteMatches(field);
  if (!matches.length) {
    closeAutocomplete(field);
    return;
  }

  state.autocompleteField = field;
  state.autocompleteIndex = -1;
  config.suggestions.replaceChildren(
    ...matches.map((value, index) => {
      const option = document.createElement("button");
      option.type = "button";
      option.id = `${field}Suggestion-${index}`;
      option.className = "search-suggestion";
      option.dataset.autocompleteValue = value;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.textContent = value;
      return option;
    }),
  );
  config.suggestions.hidden = false;
  config.input.setAttribute("aria-expanded", "true");
  config.input.removeAttribute("aria-activedescendant");
}

function chooseAutocompleteValue(field, value) {
  autocompleteFields[field].input.value = value;
  closeAutocomplete(field);
  scheduleSearch();
}

async function loadFilterOptions() {
  const database = state.selectedDatabase;
  closeAutocomplete();
  state.filterOptions = { club: [], league: [], nation: [] };
  state.filterOptionsDatabase = "";
  if (!database) return;

  try {
    const filters = await getFilters(database);
    if (state.selectedDatabase !== database) return;
    state.filterOptions = {
      club: filterOptionNames(filters.clubs),
      league: filterOptionNames(filters.leagues),
      nation: filterOptionNames(filters.nations),
    };
    state.filterOptionsDatabase = database;
  } catch (error) {
    console.warn(`Could not load search suggestions for ${database}.`, error);
  }
}

function renderResults(message = "") {
  const previousScrollTop = elements.resultsList.scrollTop;
  renderActiveSearchFilters();
  elements.resultCount.textContent = state.loadingPlayers && !state.items.length
    ? "Searching..."
    : state.loadingMorePlayers
      ? `${state.items.length.toLocaleString()} shown · loading...`
    : `${state.items.length.toLocaleString()} shown`;
  elements.resultsList.replaceChildren();

  if (message || !state.items.length) {
    const empty = document.createElement("div");
    empty.className = message && message.startsWith("Error") ? "error-state" : "empty-state";
    empty.textContent = message || "No matching players.";
    elements.resultsList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  state.items.forEach((player) => {
    const row = document.createElement("button");
    const key = playerKey(player);
    const fullName = distinctFullName(player);
    row.type = "button";
    row.className = `result-row player-card${
      state.selectedPlayer && playerKey(state.selectedPlayer) === key ? " is-active" : ""
    }${abilityTierClass(player.current_ability)}`;
    row.dataset.playerKey = key;
    row.innerHTML = `
      <span class="result-name">${escapeHtml(playerName(player))}</span>
      ${fullName ? `<span class="result-full-name">${escapeHtml(fullName)}</span>` : ""}
      <span class="result-meta">
        ${[
          displayClubName(player) || "No club",
          player.nation_name || "Unknown nation",
          player.position_text || "No position",
          formatDate(player.date_of_birth),
        ]
          .map((value) => `<span>${escapeHtml(value)}</span>`)
          .join("")}
      </span>
      <span class="result-stats" aria-label="Player metadata">
        <span>CA <strong>${escapeHtml(formatNumber(player.current_ability))}</strong></span>
        <span>PA <strong>${escapeHtml(formatNumber(player.potential_ability))}</strong></span>
        <span>Value <strong>${escapeHtml(formatNumber(player.value))}</strong></span>
        <span>Wage <strong>${escapeHtml(formatNumber(player.wage))}</strong></span>
      </span>
    `;
    fragment.append(row);
  });

  elements.resultsList.append(fragment);
  elements.resultsList.scrollTop = previousScrollTop;
}

function fact(label, value) {
  return `
    <div class="fact">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(formatValue(value))}</strong>
    </div>
  `;
}

function filterFact(label, value, filter, displayValue = value) {
  if (!value) return fact(label, "-");
  return `
    <div class="fact">
      <span>${escapeHtml(label)}</span>
      <button type="button" class="fact-filter" data-search-filter="${escapeHtml(filter)}" data-search-value="${escapeHtml(value)}">${escapeHtml(displayValue)}</button>
    </div>
  `;
}

function latestLeague() {
  return state.selectedPlayer?.league_name
    || [...state.selectedHistory].reverse().find((row) => row.league_name)?.league_name
    || "";
}

function ratingValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? String(number) : "-";
}

function ratingsByLabel(ratings) {
  return new Map((ratings || []).map((item) => [item.label, item]));
}

function renderRatingRows(items) {
  return items
    .map((item) => `
      <div class="rating">
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(ratingValue(item.value))}</strong>
      </div>
    `)
    .join("");
}

function seasonBadgeLabel(entry) {
  if (entry.label) {
    return entry.label;
  }

  const title = entry.title || databaseTitle(entry.database_slug);
  const match = String(title).match(/(\d{2})\/(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : title;
}

function renderSeasonLinks(player) {
  if (state.seasonLoading) {
    return `
      <span class="season-links" aria-label="Player entries in other databases">
        <span class="season-link is-loading">...</span>
      </span>
    `;
  }

  if (state.seasonError || !state.selectedSeasonEntries.length) {
    return '<span class="season-links" aria-label="Player entries in other databases"></span>';
  }

  return `
    <span class="season-links" aria-label="Player entries in other databases">
      ${state.selectedSeasonEntries.map((entry) => {
        const isCurrent = seasonEntryKey(entry) === playerKey(player);
        const label = seasonBadgeLabel(entry);
        return `
          <button
            type="button"
            class="season-link${isCurrent ? " is-current" : ""}"
            ${isCurrent ? "disabled aria-current=\"page\"" : ""}
            data-season-key="${escapeHtml(seasonEntryKey(entry))}"
            title="${escapeHtml(isCurrent ? `Currently viewing ${label}` : `View this player in ${label}`)}"
          >${escapeHtml(label)}</button>
        `;
      }).join("")}
    </span>
  `;
}

function attributeProfile(profile) {
  const attributes = Array.isArray(profile?.attributes) ? profile.attributes : [];
  const hiddenAttributes = Array.isArray(profile?.hiddenAttributes)
    ? profile.hiddenAttributes
    : [];

  const byLabel = ratingsByLabel(attributes);
  const usedLabels = new Set();
  const groups = ATTRIBUTE_GROUPS.map((group) => {
    const items = group.labels
      .map((label) => byLabel.get(label))
      .filter(Boolean);
    items.forEach((item) => usedLabels.add(item.label));
    return { title: group.title, items };
  }).filter((group) => group.items.length);
  const hiddenItems = hiddenAttributes.length
    ? hiddenAttributes
    : HIDDEN_ATTRIBUTE_LABELS
      .map((label) => byLabel.get(label))
      .filter(Boolean);
  hiddenItems.forEach((item) => usedLabels.add(item.label));
  const extraItems = attributes.filter((item) => !usedLabels.has(item.label));

  return {
    attributes,
    groups,
    additionalItems: [...hiddenItems, ...extraItems],
  };
}

function renderAttributes(profile) {
  const { attributes, groups } = attributeProfile(profile);
  if (!attributes.length) {
    return '<div class="empty-state compact-empty">No attribute profile available for this database yet.</div>';
  }

  return `
    <section class="profile-section attributes-section" aria-label="Player attributes">
      <div class="attribute-columns">
        ${groups.map((group) => `
          <div class="attribute-group">
            <h4>${escapeHtml(group.title)}</h4>
            ${renderRatingRows(group.items)}
          </div>
        `).join("")}
      </div>
    </section>
  `;
}

function renderMoreAttributes(profile) {
  const { additionalItems } = attributeProfile(profile);
  if (!additionalItems.length) return "";

  return `
    <details class="hidden-attributes" open>
      <summary>More Attributes</summary>
      <div class="hidden-attribute-grid">
        ${renderRatingRows(additionalItems)}
      </div>
    </details>
  `;
}

function positionalRatings(profile) {
  const raw = Array.isArray(profile?.positionRatings)
    ? profile.positionRatings
    : Array.isArray(profile?.positions) ? profile.positions : [];
  const aliases = {
    "Defensive Midfielder": "Def Midfielder", "Attacking Midfielder": "Att Midfielder",
    "Wing Back": "Wing back", "Right Side": "Right side", "Left Side": "Left side",
    "Free Role": "Free role",
  };
  const all = [...raw, ...(Array.isArray(profile?.sides) ? profile.sides : [])]
    .map((item) => ({ ...item, label: aliases[item.label] || item.label }));
  const sideNames = new Set(["Right side", "Left side", "Central", "Free role"]);
  return {
    positions: all.filter((item) => !sideNames.has(item.label)),
    sides: all.filter((item) => sideNames.has(item.label)),
    foot: Array.isArray(profile?.foot) ? profile.foot : [],
  };
}

function pitchRatingLevel(value) {
  if (value >= 18) return { className: "natural", label: "Natural" };
  if (value >= 15) return { className: "accomplished", label: "Playable" };
  if (value >= 12) return { className: "limited", label: "Limited" };
  if (value >= 9) return { className: "weak", label: "Weak" };
  if (value >= 6) return { className: "awkward", label: "Awkward" };
  return { className: "very-awkward", label: "Very awkward" };
}

function usesLegacyPositionScale() {
  return /^cm(?:9596|9697|9798)_/i.test(state.selectedDatabase);
}

function inheritsWingBacksFromFullBacks() {
  return /^cm(?:9596|9697|9798)_/i.test(state.selectedDatabase);
}

function buildPitchRoles(ratings) {
  const legacyScale = usesLegacyPositionScale();
  const pitchValue = (value) => {
    const number = Number(value);
    if (!legacyScale) return number;
    if (number >= 2) return 20;
    if (number === 1) return 12;
    return 0;
  };
  const positions = Object.fromEntries(ratings.positions.map((item) => [item.label, pitchValue(item.value)]));
  const sides = Object.fromEntries(ratings.sides.map((item) => [item.label, pitchValue(item.value)]));
  const roles = [];
  const rated = (value) => Number.isFinite(value) && value >= 2;
  const addRole = (
    label,
    value,
    x,
    y,
    longLabel = null,
    sideUnspecified = false,
  ) => {
    if (!rated(value)) return;
    const level = pitchRatingLevel(value);
    const displayValue = legacyScale ? (value >= 18 ? 2 : 1) : value;
    roles.push({
      label,
      longLabel: longLabel || PITCH_ROLE_NAMES[label] || label,
      value,
      displayValue,
      x,
      y,
      level: level.className,
      levelLabel: level.label,
      sideUnspecified,
    });
  };
  const addSidedRoles = (
    positionLabel,
    labels,
    y,
    genericLabel,
    sideLanes = PITCH_LANES,
  ) => {
    const value = positions[positionLabel];
    if (!rated(value)) return;
    const roleCount = roles.length;
    if (rated(sides["Left side"]))
      addRole(
        labels.left,
        Math.min(value, sides["Left side"]),
        sideLanes.left,
        y,
      );
    if (rated(sides.Central))
      addRole(
        labels.centre,
        Math.min(value, sides.Central),
        PITCH_LANES.centre,
        y,
      );
    if (rated(sides["Right side"]))
      addRole(
        labels.right,
        Math.min(value, sides["Right side"]),
        sideLanes.right,
        y,
      );
    if (roles.length === roleCount) {
      addRole(
        labels.centre,
        value,
        PITCH_LANES.centre,
        y,
        `${genericLabel} — side unspecified`,
        true,
      );
    }
  };

  addRole("GK", positions.Goalkeeper, PITCH_LANES.centre, PITCH_ROWS.goalkeeper);
  addRole("SW", positions.Sweeper, PITCH_LANES.centre, PITCH_ROWS.sweeper);
  addSidedRoles(
    "Defender",
    { left: "DL", centre: "DC", right: "DR" },
    PITCH_ROWS.defence,
    "Defender",
  );
  if (rated(positions["Wing back"])) {
    const roleCount = roles.length;
    if (rated(sides["Left side"])) addRole("WBL", Math.min(positions["Wing back"], sides["Left side"]), PITCH_LANES.wideLeft, PITCH_ROWS.defensiveMidfield);
    if (rated(sides["Right side"])) addRole("WBR", Math.min(positions["Wing back"], sides["Right side"]), PITCH_LANES.wideRight, PITCH_ROWS.defensiveMidfield);
    if (roles.length === roleCount) {
      addRole(
        "DMC",
        positions["Wing back"],
        PITCH_LANES.centre,
        PITCH_ROWS.defensiveMidfield,
        "Wing Back — side unspecified",
        true,
      );
    }
  } else if (inheritsWingBacksFromFullBacks()) {
    const leftBack = roles.find((role) => role.label === "DL");
    const rightBack = roles.find((role) => role.label === "DR");
    if (leftBack) {
      addRole(
        "WBL",
        leftBack.value,
        PITCH_LANES.wideLeft,
        PITCH_ROWS.defensiveMidfield,
      );
    }
    if (rightBack) {
      addRole(
        "WBR",
        rightBack.value,
        PITCH_LANES.wideRight,
        PITCH_ROWS.defensiveMidfield,
      );
    }
  }
  const defensiveMidfield = positions["Def Midfielder"] ?? positions.Anchor;
  const attackingMidfield = positions["Att Midfielder"] ?? positions.Support;
  if (defensiveMidfield !== undefined) positions["Def Midfielder"] = defensiveMidfield;
  if (attackingMidfield !== undefined) positions["Att Midfielder"] = attackingMidfield;
  addSidedRoles(
    "Def Midfielder",
    { left: "DML", centre: "DMC", right: "DMR" },
    PITCH_ROWS.defensiveMidfield,
    "Defensive Midfielder",
    {
      left: PITCH_LANES.defensiveLeft,
      right: PITCH_LANES.defensiveRight,
    },
  );
  addSidedRoles(
    "Midfielder",
    { left: "ML", centre: "MC", right: "MR" },
    PITCH_ROWS.midfield,
    "Midfielder",
  );
  addSidedRoles(
    "Att Midfielder",
    { left: "AML", centre: "AMC", right: "AMR" },
    PITCH_ROWS.attackingMidfield,
    "Attacking Midfielder",
  );
  if (rated(positions.Attacker)) {
    const forward = positions.Attacker >= 18 && positions["Att Midfielder"] >= 18;
    if (rated(sides["Left side"])) addRole("LW", Math.min(positions.Attacker, sides["Left side"]), PITCH_LANES.left, PITCH_ROWS.striker, forward ? "Forward - Left" : null);
    addRole("ST", positions.Attacker, PITCH_LANES.centre, PITCH_ROWS.striker, forward ? "Forward - Centre" : "Striker - Centre");
    if (rated(sides["Right side"])) addRole("RW", Math.min(positions.Attacker, sides["Right side"]), PITCH_LANES.right, PITCH_ROWS.striker, forward ? "Forward - Right" : null);
  }
  return roles.sort((a, b) => b.value - a.value || Number(b.label === "ST") - Number(a.label === "ST") || a.label.localeCompare(b.label));
}

function renderFootStrength(feet) {
  const available = feet.filter((foot) => Number.isFinite(Number(foot.value)));
  if (!available.length) return "";
  return `
    <section class="foot-strength" aria-label="Foot strength">
      <div class="foot-options">
        ${available.map((foot) => {
          const side = /left/i.test(foot.label) ? "left" : "right";
          return `<div class="foot-option ${pitchRatingLevel(Number(foot.value)).className}">
            <div><span>${escapeHtml(foot.label)}</span><strong>${escapeHtml(ratingValue(foot.value))}</strong></div>
            <div class="boot-badge" aria-hidden="true"><div class="boot boot-${side}"><span></span></div></div>
          </div>`;
        }).join("")}
      </div>
    </section>`;
}

function renderPositionPanel(profile) {
  const ratings = positionalRatings(profile);
  const moreAttributes = renderMoreAttributes(profile);
  if (
    !ratings.positions.length &&
    !ratings.sides.length &&
    !ratings.foot.length &&
    !moreAttributes
  ) return "";
  const roles = buildPitchRoles(ratings);
  const occupied = new Set(roles.map((role) => role.label));
  const primary = roles[0];
  const hasUnspecifiedSides = roles.some((role) => role.sideUnspecified);
  return `
    <section class="profile-section positions-section" aria-label="Positions, sides and feet">
      <div class="position-layout">
        <div>
          <div class="position-pitch" aria-label="Playable positions">
            <div class="pitch-halfway"></div><div class="pitch-circle"></div>
            <div class="pitch-box pitch-box-top"></div><div class="pitch-box pitch-box-bottom"></div>
            <div class="pitch-arc pitch-arc-top"></div><div class="pitch-arc pitch-arc-bottom"></div>
            <div class="pitch-spot pitch-spot-top"></div><div class="pitch-spot pitch-spot-bottom"></div>
            ${PITCH_SLOTS.filter((slot) => !occupied.has(slot.label))
              .map(
                (slot) =>
                  `<div class="position-marker ghost" style="--x:${slot.x}%;--y:${slot.y}%" title="${escapeHtml(PITCH_ROLE_NAMES[slot.label])}"></div>`,
              )
              .join("")}
            ${roles.map((role, index) => `<div class="position-marker position-tooltip ${role.level}${role.sideUnspecified ? " side-unspecified" : ""}${index === 0 ? " is-primary" : ""}${role.x <= 20 ? " tooltip-align-left" : ""}${role.x >= 80 ? " tooltip-align-right" : ""}${role.y >= 68 ? " tooltip-above" : ""}" style="--x:${role.x}%;--y:${role.y}%" data-info="${escapeHtml(`${role.longLabel} · ${role.levelLabel} · ${role.displayValue}`)}" aria-label="${escapeHtml(`${role.longLabel}: ${role.levelLabel} (${role.displayValue})`)}" tabindex="0"></div>`).join("")}
          </div>
          <div class="pitch-caption"><strong>${escapeHtml(primary?.longLabel || "No recognised position")}</strong></div>
          <div class="position-legend">${
            usesLegacyPositionScale()
              ? '<span><i class="legend-dot natural"></i>Natural 2</span><span><i class="legend-dot limited"></i>Limited 1</span>'
              : '<span><i class="legend-dot natural"></i>Natural 18-20</span><span><i class="legend-dot accomplished"></i>Playable 15-17</span><span><i class="legend-dot limited"></i>Limited 12-14</span><span><i class="legend-dot weak"></i>Weak 9-11</span><span><i class="legend-dot awkward"></i>Awkward 6-8</span><span><i class="legend-dot very-awkward"></i>Very awkward 2-5</span>'
          }
            ${hasUnspecifiedSides ? '<span><i class="legend-dot side-unspecified"></i>Side unspecified</span>' : ""}</div>
          ${renderFootStrength(ratings.foot)}
        </div>
        <div class="position-details">
          ${moreAttributes}
          <details class="position-ratings-toggle" open><summary>Position ratings</summary><div class="position-values">${renderRatingRows([...ratings.positions, ...ratings.sides])}</div></details>
        </div>
      </div>
    </section>`;
}

function abilityTierClass(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "";
  if (number === -1 || number === -2) {
    return " ability-tier ability-god ability-special-potential ability-animated";
  }
  if (number <= 0) return "";
  if (number >= 185) return " ability-tier ability-god ability-animated";
  if (number >= 170) return " ability-tier ability-gold ability-animated";
  if (number >= 150) return " ability-tier ability-gold";
  if (number >= 140) return " ability-tier ability-silver ability-animated";
  if (number >= 130) return " ability-tier ability-silver";
  return " ability-tier ability-bronze";
}

function abilityPixelOptions(value) {
  const number = Number(value);
  const isSpecialPotential = number === -1 || number === -2;
  const speed = number >= 185 || isSpecialPotential ? 36 : 20;
  const colors = isSpecialPotential
    ? ' data-colors="#e0f2fe, #7dd3fc, #0ea5e9"'
    : "";
  return `data-gap="4" data-speed="${speed}"${colors}`;
}

function renderReputation(player, profile) {
  const ratings = profile?.ratings || {};
  const currentAbility = ratings.current_ability ?? player.current_ability;
  const potentialAbility = ratings.potential_ability ?? player.potential_ability;

  return `
    <section class="reputation api-reputation" aria-label="Ability and finance">
      <div class="rep-box ability-pixel-box${abilityTierClass(currentAbility)}" tabindex="0" aria-label="Current ability ${escapeHtml(formatNumber(currentAbility))}">
        <ability-pixel-canvas class="ability-pixels" ${abilityPixelOptions(currentAbility)} aria-hidden="true"></ability-pixel-canvas>
        <span>Current Ability</span>
        <strong>${escapeHtml(formatNumber(currentAbility))}</strong>
      </div>
      <div class="rep-box ability-pixel-box${abilityTierClass(potentialAbility)}" tabindex="0" aria-label="Potential ability ${escapeHtml(formatNumber(potentialAbility))}">
        <ability-pixel-canvas class="ability-pixels" ${abilityPixelOptions(potentialAbility)} aria-hidden="true"></ability-pixel-canvas>
        <span>Potential Ability</span>
        <strong>${escapeHtml(formatNumber(potentialAbility))}</strong>
      </div>
      <div class="rep-box">
        <span>Home Rep</span>
        <strong>${escapeHtml(formatNumber(ratings.home_reputation))}</strong>
      </div>
      <div class="rep-box">
        <span>World Rep</span>
        <strong>${escapeHtml(formatNumber(ratings.world_reputation))}</strong>
      </div>
      <div class="rep-box">
        <span>Value</span>
        <strong>${escapeHtml(formatNumber(ratings.value ?? player.value))}</strong>
      </div>
      <div class="rep-box">
        <span>Wage</span>
        <strong>${escapeHtml(formatNumber(ratings.wage ?? player.wage))}</strong>
      </div>
    </section>
  `;
}

function renderHistory() {
  if (state.historyLoading) {
    return '<div class="empty-state compact-empty">Loading history...</div>';
  }

  if (state.historyError) {
    return `<div class="error-state compact-empty">${escapeHtml(state.historyError)}</div>`;
  }

  if (!state.selectedHistory.length) {
    return '<div class="empty-state compact-empty">No career history available.</div>';
  }

  const totals = state.selectedHistory.reduce(
    (sum, row) => ({
      apps: sum.apps + (Number(row.apps) || 0),
      goals: sum.goals + (Number(row.goals) || 0),
    }),
    { apps: 0, goals: 0 },
  );
  const showLeague = state.selectedHistory.some((row) => row.league_name);

  return `
    <section class="history-view" aria-label="Career history">
      <div class="history-heading">
        <h3>History</h3>
        <span>${state.selectedHistory.length.toLocaleString()} seasons</span>
      </div>
      <div class="history-table-wrap">
        <table class="history-table">
          <thead>
            <tr>
              <th>Season</th>
              <th>Club</th>
              ${showLeague ? "<th>League</th>" : ""}
              <th class="history-number">Apps</th>
              <th class="history-number">Goals</th>
              <th>Loan</th>
            </tr>
          </thead>
          <tbody>
            ${state.selectedHistory
              .map(
                (row) => `
              <tr>
                <td>${escapeHtml(formatValue(row.season_year))}</td>
                <td>${row.club_name ? `<button type="button" class="fact-filter table-filter" data-search-filter="club" data-search-value="${escapeHtml(row.club_name)}">${escapeHtml(row.canonical_club_name || row.club_name)}</button>` : "-"}</td>
                ${showLeague ? `<td>${row.league_name ? `<button type="button" class="fact-filter table-filter" data-search-filter="league" data-search-value="${escapeHtml(row.league_name)}">${escapeHtml(row.league_name)}</button>` : "-"}</td>` : ""}
                <td class="history-number">${escapeHtml(formatNumber(row.apps))}</td>
                <td class="history-number">${escapeHtml(formatNumber(row.goals))}</td>
                <td>${Number(row.on_loan) ? "Yes" : "-"}</td>
              </tr>
            `,
              )
              .join("")}
          </tbody>
          <tfoot>
            <tr>
              <th colspan="${showLeague ? 3 : 2}">Total</th>
              <td class="history-number">${escapeHtml(formatNumber(totals.apps))}</td>
              <td class="history-number">${escapeHtml(formatNumber(totals.goals))}</td>
              <td></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  `;
}

function renderDetailContent(player, profile) {
  if (state.activeDetailTab === "history") {
    return renderHistory();
  }

  return `
    <div class="profile-body">
      <section class="facts api-profile-facts" aria-label="Player facts">
        ${filterFact("Club", player.club_name, "club", displayClubName(player))}
        ${latestLeague() ? filterFact("League", latestLeague(), "league") : ""}
        ${filterFact("Nation", player.nation_name, "nation")}
        ${fact("Position", player.position_text || "-")}
        ${fact("Born", formatDate(player.date_of_birth))}
      </section>
      ${renderReputation(player, profile)}
      ${
        state.detailLoading
          ? '<div class="empty-state compact-empty">Loading player attributes...</div>'
          : ""
      }
      ${
        state.detailError
          ? `<div class="error-state compact-empty">${escapeHtml(state.detailError)}</div>`
          : ""
      }
      ${!state.detailLoading && !state.detailError ? renderAttributes(profile) : ""}
      ${!state.detailLoading && !state.detailError ? renderPositionPanel(profile) : ""}
    </div>
  `;
}

const CLUB_COLOUR_PALETTE = [
  "#000000",
  "#ffffff",
  "#808080",
  "#707090",
  "#e00000",
  "#b00000",
  "#901000",
  "#ff7000",
  "#e08000",
  "#fff000",
  "#ffd000",
  "#008030",
  "#006030",
  "#002060",
  "#002080",
  "#0030a0",
  "#0050d0",
  "#60c0ff",
  "#800040",
  "#600060",
  "#800020",
  "#804000",
  "#a05000",
  "#ff9595",
  "#d9b128",
  "#c6c6c6",
  "#ce84ce",
  "#008888",
  "#80c848",
  "#ffaa00",
  "#10a8a8",
  "#056161",
  "#df1e7a",
  "#003e30",
];

const CLUB_COLOUR_CODES = {
  BLA: "#000000",
  WHI: "#ffffff",
  GRE: "#808080",
  RED: "#b00000",
  ORA: "#e08000",
  YEL: "#ffd000",
  GRN: "#006030",
  BLU: "#002080",
  PUR: "#600060",
  BRO: "#804000",
  PIN: "#ff9595",
  GOL: "#d9b128",
};

function clubColour(value) {
  if (typeof value === "string" && /^#[0-9a-f]{6}$/i.test(value)) {
    return value.toLowerCase();
  }
  if (value === null || value === undefined || value === "") return "";
  const codeColour = CLUB_COLOUR_CODES[String(value).trim().toUpperCase()];
  if (codeColour) return codeColour;

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  const directIndex =
    Number.isInteger(numeric) &&
    numeric >= 0 &&
    numeric < CLUB_COLOUR_PALETTE.length
      ? numeric
      : numeric >>> 24;
  return CLUB_COLOUR_PALETTE[directIndex] || "";
}

function profileBannerTheme(player, profile) {
  const colours = profile?.clubColors || player?.club_colors;
  if (!colours) return { className: "", style: "" };

  let background = clubColour(colours.background_colour);
  let foreground = clubColour(colours.foreground_colour);

  // Match the CM editor: "fore" is text and "back" is the fill.
  // Prefer the canonical pair from the API, then use the current season.
  if (!background || !foreground || background === foreground) {
    const currentPair = [1, 2, 3]
      .map((index) => ({
        background: clubColour(colours[`back_colour${index}`]),
        foreground: clubColour(colours[`fore_colour${index}`]),
      }))
      .find(
        (pair) =>
          pair.background &&
          pair.foreground &&
          pair.background !== pair.foreground,
      );
    background = currentPair?.background || "";
    foreground = currentPair?.foreground || "";
  }

  if (!background || !foreground) return { className: "", style: "" };

  return {
    className: " has-club-colours",
    style: ` style="--club-banner-bg:${background};--club-banner-fg:${foreground}"`,
  };
}

function renderProfile() {
  const player = state.selectedPlayer;
  document.body.classList.toggle("mobile-profile-open", Boolean(player));

  if (!player) {
    elements.profile.innerHTML = '<div class="empty-state">No player selected.</div>';
    return;
  }

  const profile = state.selectedProfile;
  const fullName = distinctFullName(player);
  const bannerTheme = profileBannerTheme(player, profile);
  elements.profile.innerHTML = `
    <div class="profile-banner${bannerTheme.className}"${bannerTheme.style}>
      <button type="button" class="mobile-profile-back" data-mobile-back>Back to results</button>
      <div class="profile-title">
        <h2 class="profile-player-name">${escapeHtml(playerName(player))}</h2>
      </div>
      ${fullName ? `<p class="profile-full-name">${escapeHtml(fullName)}</p>` : ""}
      <p class="profile-summary">
        ${player.nation_name ? `<button type="button" class="fact-filter inline-filter" data-search-filter="nation" data-search-value="${escapeHtml(player.nation_name)}">${escapeHtml(player.nation_name)}</button>` : "Unknown nation"}
        <span aria-hidden="true">-</span>
        <span>${escapeHtml(summaryPosition(player.position_text))}</span>
        <span aria-hidden="true">-</span>
        ${
          player.club_name
            ? `<button type="button" class="profile-club-name fact-filter inline-filter" data-search-filter="club" data-search-value="${escapeHtml(player.club_name)}">${escapeHtml(displayClubName(player))}</button>`
            : "<span>No club</span>"
        }
      </p>
      ${renderSeasonLinks(player)}
    </div>
    <div class="tabs api-detail-tabs" role="tablist" aria-label="Player detail sections">
      <button
        type="button"
        class="${state.activeDetailTab === "profile" ? "is-active" : ""}"
        data-detail-tab="profile"
      >Profile</button>
      <button
        type="button"
        class="${state.activeDetailTab === "history" ? "is-active" : ""}"
        data-detail-tab="history"
      >History</button>
    </div>
    ${renderDetailContent(player, profile)}
  `;
}

async function loadPlayerDetail(player) {
  if (state.detailAbortController) {
    state.detailAbortController.abort();
  }

  const cacheKey = playerKey(player);
  const cached = state.detailCache.get(cacheKey);
  if (cached) {
    state.selectedPlayer = cached.item || player;
    state.selectedProfile = cached.profile || null;
    state.detailLoading = false;
    state.detailError = "";
    renderResults();
    renderProfile();
    loadPlayerSeasons(player);
    loadPlayerHistory(player);
    return;
  }

  const abortController = new AbortController();
  state.detailAbortController = abortController;
  state.detailLoading = true;
  state.detailError = "";
  state.selectedProfile = null;
  state.selectedHistory = [];
  state.historyError = "";
  state.selectedSeasonEntries = [];
  renderProfile();
  loadPlayerSeasons(player);
  loadPlayerHistory(player);

  try {
    const detail = await getPlayer(player.database_slug, player.source_person_id, {
      signal: abortController.signal,
    });

    if (state.detailAbortController !== abortController) {
      return;
    }

    state.selectedPlayer = detail.item || player;
    state.selectedProfile = detail.profile || null;
    state.detailCache.set(cacheKey, detail);
    state.detailLoading = false;
    renderResults();
    renderProfile();
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }

    state.selectedProfile = null;
    state.detailLoading = false;
    state.detailError = error.message || "Could not load player detail.";
    renderProfile();
    console.error(error);
  } finally {
    if (state.detailAbortController === abortController) {
      state.detailAbortController = null;
    }
  }
}

async function loadPlayerHistory(player) {
  if (state.historyAbortController) {
    state.historyAbortController.abort();
  }

  const cacheKey = playerKey(player);
  const cached = state.historyCache.get(cacheKey);
  if (cached) {
    state.selectedHistory = cached;
    state.historyLoading = false;
    state.historyError = "";
    renderProfile();
    return;
  }

  const abortController = new AbortController();
  state.historyAbortController = abortController;
  state.historyLoading = true;
  state.historyError = "";
  renderProfile();

  try {
    const payload = await getPlayerHistory(player.database_slug, player.source_person_id, {
      signal: abortController.signal,
    });

    if (
      state.historyAbortController !== abortController ||
      !state.selectedPlayer ||
      playerKey(state.selectedPlayer) !== playerKey(player)
    ) {
      return;
    }

    state.selectedHistory = Array.isArray(payload.items) ? payload.items : [];
    state.historyCache.set(cacheKey, state.selectedHistory);
    state.historyLoading = false;
    renderProfile();
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }

    if (state.historyAbortController === abortController) {
      state.selectedHistory = [];
      state.historyLoading = false;
      state.historyError = error.message || "Could not load history.";
      renderProfile();
    }
    console.error(error);
  } finally {
    if (state.historyAbortController === abortController) {
      state.historyAbortController = null;
    }
  }
}

async function loadPlayerSeasons(player) {
  if (state.seasonAbortController) {
    state.seasonAbortController.abort();
  }

  const cacheKey = playerKey(player);
  const cached = state.seasonCache.get(cacheKey);
  if (cached) {
    state.selectedSeasonEntries = cached;
    state.seasonLoading = false;
    state.seasonError = "";
    renderProfile();
    return;
  }

  const abortController = new AbortController();
  state.seasonAbortController = abortController;
  state.seasonLoading = true;
  state.seasonError = "";
  renderProfile();

  try {
    const entries = await getPlayerSeasons(player, { signal: abortController.signal });

    if (
      state.seasonAbortController !== abortController ||
      !state.selectedPlayer ||
      playerKey(state.selectedPlayer) !== playerKey(player)
    ) {
      return;
    }

    state.seasonCache.set(cacheKey, entries);
    for (const entry of entries) {
      state.seasonCache.set(seasonEntryKey(entry), entries);
    }
    state.selectedSeasonEntries = entries;
    state.seasonLoading = false;
    renderProfile();
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }

    if (state.seasonAbortController === abortController) {
      state.selectedSeasonEntries = [];
      state.seasonLoading = false;
      state.seasonError = error.message || "Could not load season entries.";
      renderProfile();
    }
    console.error(error);
  } finally {
    if (state.seasonAbortController === abortController) {
      state.seasonAbortController = null;
    }
  }
}

function clearSelectedPlayer() {
  if (state.detailAbortController) {
    state.detailAbortController.abort();
  }

  if (state.seasonAbortController) {
    state.seasonAbortController.abort();
  }

  if (state.historyAbortController) {
    state.historyAbortController.abort();
  }

  state.selectedPlayer = null;
  state.selectedProfile = null;
  state.selectedHistory = [];
  state.selectedSeasonEntries = [];
  state.activeDetailTab = "profile";
  state.detailLoading = false;
  state.detailError = "";
  state.historyLoading = false;
  state.historyError = "";
  state.seasonLoading = false;
  state.seasonError = "";
}

function selectSeasonEntry(entry) {
  if (state.playerAbortController) {
    state.playerAbortController.abort();
    state.playerAbortController = null;
  }

  state.selectedDatabase = entry.database_slug;
  elements.databaseSelect.value = entry.database_slug;
  state.query = playerName(entry);
  elements.nameSearch.value = state.query;
  state.page = 1;
  state.items = [entry];
  state.loadingPlayers = false;
  state.selectedPlayer = entry;
  state.selectedProfile = null;
  state.selectedHistory = [];
  state.selectedSeasonEntries = [];
  state.activeDetailTab = "profile";
  state.detailError = "";
  state.historyError = "";
  state.seasonError = "";
  renderSummary();
  renderResults();
  syncPlayerUrl(entry);
  loadPlayerDetail(entry);
}

function readSearchInputs() {
  state.query = elements.nameSearch.value.trim();
  state.club = elements.clubSearch.value.trim();
  state.league = elements.leagueSearch.value.trim();
  state.nation = elements.nationSearch.value.trim();
}

function scheduleSearch() {
  clearTimeout(searchTimer);
  readSearchInputs();
  renderActiveSearchFilters();
  searchTimer = setTimeout(() => {
    state.page = 1;
    state.hasMorePlayers = true;
    loadPlayers({ append: false });
  }, SEARCH_DEBOUNCE_MS);
}

function bindAutocomplete(field) {
  const config = autocompleteFields[field];

  config.input.addEventListener("input", () => {
    scheduleSearch();
    renderAutocomplete(field);
  });
  config.input.addEventListener("focus", () => {
    if (state.autocompleteField && state.autocompleteField !== field) {
      closeAutocomplete(state.autocompleteField);
    }
    renderAutocomplete(field);
  });
  config.input.addEventListener("blur", () => closeAutocomplete(field));
  config.input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeAutocomplete(field);
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (config.suggestions.hidden) renderAutocomplete(field);
      const nextIndex =
        event.key === "ArrowDown"
          ? state.autocompleteIndex < 0
            ? 0
            : state.autocompleteIndex + 1
          : state.autocompleteIndex < 0
            ? -1
            : state.autocompleteIndex - 1;
      setAutocompleteIndex(field, nextIndex);
      return;
    }

    if (
      event.key === "Enter" &&
      state.autocompleteField === field &&
      state.autocompleteIndex >= 0
    ) {
      const options = config.suggestions.querySelectorAll(
        "[data-autocomplete-value]",
      );
      const activeOption = options[state.autocompleteIndex];
      if (activeOption) {
        event.preventDefault();
        chooseAutocompleteValue(field, activeOption.dataset.autocompleteValue);
      }
    }
  });
  config.suggestions.addEventListener("pointerdown", (event) => {
    const option = event.target.closest("[data-autocomplete-value]");
    if (!option) return;
    event.preventDefault();
    chooseAutocompleteValue(field, option.dataset.autocompleteValue);
  });
}

function startFilterSearch(filter, value) {
  elements.nameSearch.value = "";
  elements.clubSearch.value = filter === "club" ? value : "";
  elements.leagueSearch.value = filter === "league" ? value : "";
  elements.nationSearch.value = filter === "nation" ? value : "";
  readSearchInputs();
  state.page = 1;
  state.hasMorePlayers = true;
  clearSelectedPlayer();
  renderProfile();
  loadPlayers({ append: false });
}

function currentSearchSignature() {
  return JSON.stringify([
    state.selectedDatabase,
    state.query,
    state.club,
    state.league,
    state.nation,
  ]);
}

async function loadPlayers({ append = false } = {}) {
  if (append && (
    state.loadingPlayers
    || state.loadingMorePlayers
    || !state.hasMorePlayers
  )) {
    return;
  }

  if (!append && state.playerAbortController) {
    state.playerAbortController.abort();
  }

  if (state.query && state.query.length < 2) {
    state.items = [];
    state.hasMorePlayers = false;
    clearSelectedPlayer();
    state.loadingPlayers = false;
    state.loadingMorePlayers = false;
    state.playerAbortController = null;
    setStatus("Ready");
    renderResults("Type at least 2 characters.");
    renderProfile();
    renderSummary();
    return;
  }

  const requestedPage = append ? state.page + 1 : 1;
  const searchSignature = currentSearchSignature();
  const abortController = new AbortController();
  state.playerAbortController = abortController;
  state.loadingPlayers = !append;
  state.loadingMorePlayers = append;
  setStatus(append ? "Loading more players..." : "Searching...");
  renderResults(append ? "" : "Searching...");

  try {
    const result = await searchPlayers({
      database: state.selectedDatabase,
      q: state.query,
      club: state.club,
      league: state.league,
      nation: state.nation,
      page: requestedPage,
      pageSize: PAGE_SIZE,
      signal: abortController.signal,
    });

    if (
      state.playerAbortController !== abortController
      || currentSearchSignature() !== searchSignature
    ) {
      return;
    }

    const incomingItems = result.items;
    if (append) {
      const itemsByKey = new Map(state.items.map((item) => [playerKey(item), item]));
      incomingItems.forEach((item) => itemsByKey.set(playerKey(item), item));
      state.items = [...itemsByKey.values()];
    } else {
      state.items = incomingItems;
      clearSelectedPlayer();
    }
    state.page = result.page || requestedPage;
    state.hasMorePlayers = incomingItems.length >= result.pageSize;
    state.loadingPlayers = false;
    state.loadingMorePlayers = false;
    setStatus(state.items.length ? "Results loaded" : "No results");
    renderResults();
    if (!append) renderProfile();
  } catch (error) {
    if (error.name === "AbortError") {
      return;
    }

    if (!append) {
      state.items = [];
      clearSelectedPlayer();
    }
    state.loadingPlayers = false;
    state.loadingMorePlayers = false;
    setStatus("Search failed");
    renderResults(append ? "" : `Error: ${error.message}`);
    if (!append) renderProfile();
    console.error(error);
  } finally {
    if (state.playerAbortController === abortController) {
      state.loadingPlayers = false;
      state.loadingMorePlayers = false;
      state.playerAbortController = null;
      renderSummary();
    }
  }
}

function bindEvents() {
  elements.databaseSelect.addEventListener("change", () => {
    state.selectedDatabase = elements.databaseSelect.value;
    state.page = 1;
    state.hasMorePlayers = true;
    clearSelectedPlayer();
    renderSummary();
    void loadFilterOptions();
    loadPlayers({ append: false });
  });

  elements.nameSearch.addEventListener("input", scheduleSearch);
  bindAutocomplete("club");
  bindAutocomplete("league");
  bindAutocomplete("nation");

  elements.resultsList.addEventListener("click", (event) => {
    const row = event.target.closest("[data-player-key]");

    if (!row) {
      return;
    }

    const player = state.items.find((item) => playerKey(item) === row.dataset.playerKey);

    if (!player) {
      return;
    }

    state.selectedPlayer = player;
    state.selectedProfile = null;
    state.detailError = "";
    renderResults();
    syncPlayerUrl(player);
    loadPlayerDetail(player);
    if (window.matchMedia("(max-width: 640px)").matches) {
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  });
  elements.resultsList.addEventListener("scroll", () => {
    const remaining =
      elements.resultsList.scrollHeight
      - elements.resultsList.scrollTop
      - elements.resultsList.clientHeight;
    if (remaining <= 120) {
      void loadPlayers({ append: true });
    }
  });

  elements.profile.addEventListener("click", (event) => {
    if (event.target.closest("[data-mobile-back]")) {
      clearSelectedPlayer();
      renderResults();
      renderProfile();
      window.scrollTo({ top: 0, behavior: "auto" });
      return;
    }

    const filter = event.target.closest("[data-search-filter]");
    if (filter) {
      startFilterSearch(filter.dataset.searchFilter, filter.dataset.searchValue);
      return;
    }

    const tab = event.target.closest("[data-detail-tab]");
    if (tab) {
      state.activeDetailTab = tab.dataset.detailTab;
      renderProfile();
      return;
    }

    const button = event.target.closest("[data-season-key]");

    if (!button || button.disabled) {
      return;
    }

    const entry = state.selectedSeasonEntries.find(
      (item) => seasonEntryKey(item) === button.dataset.seasonKey,
    );

    if (entry) {
      selectSeasonEntry(entry);
    }
  });
}

async function init() {
  bindEvents();
  setStatus("Loading databases...");
  elements.databaseSelect.disabled = true;
  elements.nameSearch.disabled = true;
  elements.clubSearch.disabled = true;
  elements.leagueSearch.disabled = true;
  elements.nationSearch.disabled = true;
  renderProfile();

  try {
    const databases = await getDatabases();
    state.databases = databases
      .slice()
      .sort((left, right) => left.season_order - right.season_order || left.title.localeCompare(right.title));

    if (!state.databases.length) {
      throw new Error("No converted databases are available.");
    }

    const latestDatabase = state.databases.reduce((latest, database) =>
      database.season_order > latest.season_order ? database : latest,
    );

    elements.databaseSelect.replaceChildren(
      ...state.databases.map((database) => {
        const option = document.createElement("option");
        option.value = database.slug;
        option.textContent = database.title;
        return option;
      }),
    );
    const deepLink = new URLSearchParams(window.location.search);
    const requestedDatabase = deepLink.get("database") || "";
    const requestedPlayer = deepLink.get("player") || "";
    state.selectedDatabase = state.databases.some((database) => database.slug === requestedDatabase)
      ? requestedDatabase
      : latestDatabase.slug;
    elements.databaseSelect.value = state.selectedDatabase;
    elements.databaseSelect.disabled = false;
    elements.nameSearch.disabled = false;
    elements.clubSearch.disabled = false;
    elements.leagueSearch.disabled = false;
    elements.nationSearch.disabled = false;
    setStatus("Ready");
    renderSummary();
    state.page = 1;
    state.hasMorePlayers = true;
    void loadFilterOptions();
    if (requestedPlayer && state.selectedDatabase === requestedDatabase) {
      const detail = await getPlayer(state.selectedDatabase, requestedPlayer);
      if (!detail.item) throw new Error("The linked player could not be found.");
      state.items = [detail.item];
      state.selectedPlayer = detail.item;
      state.selectedProfile = detail.profile || null;
      state.detailCache.set(playerKey(detail.item), detail);
      renderResults();
      renderProfile();
      syncPlayerUrl(detail.item, true);
      void loadPlayerSeasons(detail.item);
      void loadPlayerHistory(detail.item);
    } else {
      void loadPlayers({ append: false });
    }
  } catch (error) {
    setStatus("Load failed");
    renderResults(`Error: ${error.message}`);
    elements.profile.innerHTML = `<div class="error-state">API unavailable: ${escapeHtml(API_BASE)}</div>`;
    console.error(error);
  }
}

init();
