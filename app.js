const TABLE_FILES = {
  index: "index.dat",
  firstNames: "first_names.dat",
  secondNames: "second_names.dat",
  commonNames: "common_names.dat",
  staff: "staff.dat",
  staffHistory: "staff_history.dat",
  clubs: "club.dat",
  leagues: "club_comp.dat",
  nations: "nation.dat"
};

const PLAYER_ATTRIBUTE_LABELS = [
  "Acceleration",
  "Aggression",
  "Agility",
  "Anticipation",
  "Balance",
  "Bravery",
  "Consistency",
  "Corners",
  "Crossing",
  "Decisions",
  "Dirtiness",
  "Dribbling",
  "Finishing",
  "Flair",
  "Free Kicks",
  "Handling",
  "Heading",
  "Important Matches",
  "Injury Proneness",
  "Jumping",
  "Leadership",
  "Left Foot",
  "Long Shots",
  "Marking",
  "Off the Ball",
  "Natural Fitness",
  "One On Ones",
  "Pace",
  "Passing",
  "Penalties",
  "Positioning",
  "Reflexes",
  "Right Foot",
  "Stamina",
  "Strength",
  "Tackling",
  "Teamwork",
  "Technique",
  "Throw Ins",
  "Versatility",
  "Vision",
  "Work Rate"
];

const POSITION_LABELS = [
  "Goalkeeper",
  "Sweeper",
  "Defender",
  "Def Midfielder",
  "Midfielder",
  "Att Midfielder",
  "Attacker",
  "Wing back"
];

const SIDE_LABELS = ["Right side", "Left side", "Central", "Free role"];

const LEGACY_LEAGUE_NAMES = {
  EPR: "English Premier Division",
  ED1: "English First Division",
  ED2: "English Second Division",
  ED3: "English Third Division",
  SPR: "Scottish Premier Division",
  SD1: "Scottish First Division",
  SD2: "Scottish Second Division",
  SD3: "Scottish Third Division",
  ISA: "Italian Serie A",
  ISB: "Italian Serie B",
  ISC: "Italian Serie C",
  SP1: "Spanish First Division",
  SP2: "Spanish Second Division",
  FD1: "French First Division",
  FD2: "French Second Division",
  GD1: "German First Division",
  GD2: "German Second Division",
  HD1: "Dutch First Division",
  HD2: "Dutch Second Division",
  PD1: "Portuguese First Division",
  PD2: "Portuguese Second Division",
  BD1: "Belgian First Division",
  BD2: "Belgian Second Division",
  TR1: "Turkish First Division",
  TR2: "Turkish Second Division",
  DD1: "Danish First Division",
  DD2: "Danish Second Division",
  ND1: "Norwegian First Division",
  ND2: "Norwegian Second Division",
  WD1: "Swedish First Division",
  WD2: "Swedish Second Division"
};

const ATTRIBUTE_GROUPS = [
  {
    title: "Technical",
    labels: [
      "Corners",
      "Crossing",
      "Dribbling",
      "Finishing",
      "Free Kicks",
      "Heading",
      "Long Shots",
      "Marking",
      "Passing",
      "Penalties",
      "Tackling",
      "Technique",
      "Throw Ins"
    ]
  },
  {
    title: "Mental",
    labels: [
      "Aggression",
      "Anticipation",
      "Bravery",
      "Decisions",
      "Flair",
      "Leadership",
      "Off the Ball",
      "Positioning",
      "Teamwork",
      "Vision",
      "Work Rate"
    ]
  },
  {
    title: "Physical / GK",
    labels: [
      "Acceleration",
      "Agility",
      "Balance",
      "Jumping",
      "Natural Fitness",
      "Pace",
      "Stamina",
      "Strength",
      "Handling",
      "One On Ones",
      "Reflexes"
    ]
  }
];

const HIDDEN_ATTRIBUTE_LABELS = [
  "Consistency",
  "Dirtiness",
  "Important Matches",
  "Versatility",
  "Injury Proneness"
];

const PITCH_ROLE_NAMES = {
  GK: "Goalkeeper",
  SW: "Sweeper",
  DL: "Defender - Left",
  DC: "Defender - Centre",
  DR: "Defender - Right",
  WBL: "Wing Back - Left",
  WBR: "Wing Back - Right",
  DML: "Defensive Midfielder - Left",
  DMC: "Defensive Midfielder - Centre",
  DMR: "Defensive Midfielder - Right",
  ML: "Midfielder - Left",
  MC: "Midfielder - Centre",
  MR: "Midfielder - Right",
  AML: "Attacking Midfielder - Left",
  AMC: "Attacking Midfielder - Centre",
  AMR: "Attacking Midfielder - Right",
  ST: "Striker - Centre"
};

const PITCH_LANES = {
  wideLeft: 6,
  left: 20,
  centre: 50,
  right: 80,
  wideRight: 94
};

const PITCH_ROWS = {
  striker: 12,
  attackingMidfield: 26,
  midfield: 40,
  defensiveMidfield: 54,
  defence: 68,
  sweeper: 82,
  goalkeeper: 96
};

const PITCH_SLOTS = [
  { label: "ST", x: PITCH_LANES.centre, y: PITCH_ROWS.striker },
  { label: "AML", x: PITCH_LANES.left, y: PITCH_ROWS.attackingMidfield },
  { label: "AMC", x: PITCH_LANES.centre, y: PITCH_ROWS.attackingMidfield },
  { label: "AMR", x: PITCH_LANES.right, y: PITCH_ROWS.attackingMidfield },
  { label: "ML", x: PITCH_LANES.left, y: PITCH_ROWS.midfield },
  { label: "MC", x: PITCH_LANES.centre, y: PITCH_ROWS.midfield },
  { label: "MR", x: PITCH_LANES.right, y: PITCH_ROWS.midfield },
  { label: "WBL", x: PITCH_LANES.wideLeft, y: PITCH_ROWS.defensiveMidfield },
  { label: "DML", x: PITCH_LANES.left, y: PITCH_ROWS.defensiveMidfield },
  { label: "DMC", x: PITCH_LANES.centre, y: PITCH_ROWS.defensiveMidfield },
  { label: "DMR", x: PITCH_LANES.right, y: PITCH_ROWS.defensiveMidfield },
  { label: "WBR", x: PITCH_LANES.wideRight, y: PITCH_ROWS.defensiveMidfield },
  { label: "DL", x: PITCH_LANES.left, y: PITCH_ROWS.defence },
  { label: "DC", x: PITCH_LANES.centre, y: PITCH_ROWS.defence },
  { label: "DR", x: PITCH_LANES.right, y: PITCH_ROWS.defence },
  { label: "SW", x: PITCH_LANES.centre, y: PITCH_ROWS.sweeper },
  { label: "GK", x: PITCH_LANES.centre, y: PITCH_ROWS.goalkeeper }
];

const state = {
  staff: [],
  clubs: [],
  leagues: [],
  nations: [],
  histories: new Map(),
  filtered: [],
  selectedId: null,
  activeTab: "profile",
  databasePath: "",
  databasePaths: [],
  databaseFormats: new Map(),
  seasonMatches: new Map()
};

const elements = {
  status: document.querySelector("#status"),
  databaseSelect: document.querySelector("#databaseSelect"),
  nameSearch: document.querySelector("#nameSearch"),
  clubFilter: document.querySelector("#clubFilter"),
  leagueFilter: document.querySelector("#leagueFilter"),
  nationFilter: document.querySelector("#nationFilter"),
  playerCount: document.querySelector("#playerCount"),
  clubCount: document.querySelector("#clubCount"),
  leagueCount: document.querySelector("#leagueCount"),
  nationCount: document.querySelector("#nationCount"),
  resultCount: document.querySelector("#resultCount"),
  resultsList: document.querySelector("#resultsList"),
  profile: document.querySelector("#profile")
};

const decoder = new TextDecoder("windows-1252");
const databaseCache = new Map();
const databaseLoadPromises = new Map();
let preloadScheduled = false;

function dataView(buffer) {
  return new DataView(buffer);
}

function readInt(view, offset) {
  return view.getInt32(offset, true);
}

function readShort(view, offset) {
  return view.getInt16(offset, true);
}

function readString(buffer, offset, length) {
  return decoder
    .decode(new Uint8Array(buffer, offset, length))
    .replace(/\xff/g, "")
    .split("\0")[0]
    .trim();
}

function positiveId(value, limit) {
  return Number.isInteger(value) && value >= 0 && value < limit ? value : null;
}

function configureDatabaseLayout(buffer, staffFileSize) {
  const view = dataView(buffer);
  const entries = [];

  for (let offset = 8; offset + 67 <= buffer.byteLength; offset += 67) {
    const name = readString(buffer, offset, 31);

    if (!name) {
      continue;
    }

    entries.push({
      name,
      type: view.getUint8(offset + 51),
      count: readInt(view, offset + 55),
      start: readInt(view, offset + 59)
    });
  }

  const baseStaff = entries.find((entry) => entry.name === "staff.dat" && entry.type === 6);
  const playerSection = entries.find((entry) => entry.name === "staff.dat" && entry.type === 9);
  const detailSection = entries.find((entry) => entry.name === "staff.dat" && entry.type === 10);
  const preferencesSection = entries.find((entry) => entry.name === "staff.dat" && entry.type === 22);

  if (!baseStaff || !playerSection || !detailSection) {
    throw new Error("Unsupported database layout in index.dat");
  }

  const staffRecordSize = Math.round(playerSection.start / baseStaff.count);
  const detailSectionEnd = preferencesSection?.start || staffFileSize;
  const playerDetailOffset = {
    110: 97,
    157: 145
  }[staffRecordSize];

  if (!playerDetailOffset) {
    throw new Error(`Unsupported staff record size: ${staffRecordSize}`);
  }

  return {
    staffSection: {
      count: baseStaff.count,
      size: staffRecordSize
    },
    playerDetailSection: {
      start: detailSection.start,
      count: detailSection.count,
      size: Math.round((detailSectionEnd - detailSection.start) / detailSection.count)
    },
    staffFieldLayout: {
      playerDetailOffset
    }
  };
}

function parseNameTable(buffer) {
  const rows = [];
  const recordSize = 60;

  for (let offset = 0; offset + recordSize <= buffer.byteLength; offset += recordSize) {
    rows.push(readString(buffer, offset, 55));
  }

  return rows;
}

function parseNamedRecords(buffer, recordSize) {
  const view = dataView(buffer);
  const records = [];

  for (let offset = 0; offset + recordSize <= buffer.byteLength; offset += recordSize) {
    const id = readInt(view, offset);
    records[id] = {
      id,
      name: readString(buffer, offset + 4, 51),
      shortName: readString(buffer, offset + 56, 25)
    };
  }

  return records;
}

function parseDb1(buffer) {
  const view = dataView(buffer);
  const fieldCount = view.getUint16(0, true);
  const fields = [];
  let schemaOffset = 2;
  let recordOffset = 0;

  for (let index = 0; index < fieldCount; index += 1) {
    const nameLength = view.getUint8(schemaOffset);
    schemaOffset += 1;
    const name = readString(buffer, schemaOffset, nameLength);
    schemaOffset += nameLength;
    const type = view.getUint8(schemaOffset);
    const length = view.getUint8(schemaOffset + 1);
    schemaOffset += 4;
    fields.push({ name, type, length, offset: recordOffset });
    recordOffset += length;
  }

  return {
    buffer,
    view,
    fieldsByName: new Map(fields.map((field) => [field.name, field])),
    recordStart: schemaOffset + 6,
    recordSize: recordOffset,
    count: Math.floor((buffer.byteLength - schemaOffset - 6) / recordOffset)
  };
}

function readDb1Value(database, rowIndex, fieldName) {
  const field = database.fieldsByName.get(fieldName);

  if (!field) {
    return "";
  }

  const offset = database.recordStart + rowIndex * database.recordSize + field.offset;

  if (field.type === 1) {
    return readString(database.buffer, offset, field.length);
  }

  if (field.length === 1) {
    return database.view.getUint8(offset);
  }

  if (field.length === 2) {
    const value = database.view.getUint8(offset) * 100 + database.view.getUint8(offset + 1);
    return value <= 200 ? value : -1;
  }

  return database.view.getUint32(offset, true);
}

function parseLegacyDate(value) {
  const match = String(value).match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);

  if (!match) {
    return null;
  }

  const day = Number(match[1]);
  const month = Number(match[2]);
  const yearValue = Number(match[3]);
  const year = yearValue < 100 ? 1900 + yearValue : yearValue;
  const monthLengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const dayOfYear = monthLengths.slice(0, month - 1).reduce((total, days) => total + days, 0) + day - 1;
  return { day, month, year, dayOfYear };
}

function legacyPositionValue(value) {
  return value >= 2 ? 20 : value === 1 ? 14 : 0;
}

function prepareLegacyDatabase(playersBuffer, teamsBuffer) {
  const playersDatabase = parseDb1(playersBuffer);
  const teamsDatabase = parseDb1(teamsBuffer);
  const leaguesByName = new Map();
  const nationsByName = new Map();
  const clubs = [];

  const league = (name) => {
    if (!name) {
      return null;
    }
    if (!leaguesByName.has(name)) {
      leaguesByName.set(name, { id: leaguesByName.size, name });
    }
    return leaguesByName.get(name);
  };
  const nation = (name) => {
    if (!name) {
      return null;
    }
    if (!nationsByName.has(name)) {
      nationsByName.set(name, { id: nationsByName.size, name });
    }
    return nationsByName.get(name);
  };

  for (let index = 0; index < teamsDatabase.count; index += 1) {
    const name = readDb1Value(teamsDatabase, index, "UK Long Name");
    const shortName = readDb1Value(teamsDatabase, index, "UK Short Name");

    if (!name && !shortName) {
      continue;
    }

    const nationRecord = nation(readDb1Value(teamsDatabase, index, "Nation"));
    const divisionCode = readDb1Value(teamsDatabase, index, "Division");
    const leagueRecord = league(LEGACY_LEAGUE_NAMES[divisionCode] || divisionCode);
    clubs.push({
      id: index,
      name: name || shortName,
      shortName: shortName || name,
      nationId: nationRecord?.id ?? null,
      nation: nationRecord?.name || "",
      leagueId: leagueRecord?.id ?? null,
      league: leagueRecord?.name || ""
    });
  }

  const clubsByName = new Map();
  clubs.forEach((club) => {
    [club.name, club.shortName].filter(Boolean).forEach((name) => {
      clubsByName.set(normalizeSearchText(name), club);
    });
  });

  const attributeMap = {
    Aggression: "Aggression",
    "Big-Occasion": "Important Matches",
    Consistency: "Consistency",
    Determination: "Determination",
    Dirtyness: "Dirtiness",
    Dribbling: "Dribbling",
    Flair: "Flair",
    Heading: "Heading",
    Influence: "Leadership",
    "Inj Prone": "Injury Proneness",
    Marking: "Marking",
    "Off the ball": "Off the Ball",
    Pace: "Pace",
    Passing: "Passing",
    Positioning: "Positioning",
    "Set Pieces": "Free Kicks",
    Shooting: "Finishing",
    Stamina: "Stamina",
    Strength: "Strength",
    Tackling: "Tackling",
    Technique: "Technique"
  };
  const staff = [];

  for (let index = 0; index < playersDatabase.count; index += 1) {
    const firstName = readDb1Value(playersDatabase, index, "First Name");
    const secondName = readDb1Value(playersDatabase, index, "Second Name");
    const displayName = [firstName, secondName].filter(Boolean).join(" ");

    if (!displayName) {
      continue;
    }

    const nationName = readDb1Value(playersDatabase, index, "Nation");
    const nationRecord = nation(nationName);
    const clubName = readDb1Value(playersDatabase, index, "Current Club");
    const club = clubsByName.get(normalizeSearchText(clubName));
    const attributes = PLAYER_ATTRIBUTE_LABELS.map((label) => ({ label, value: null }));

    Object.entries(attributeMap).forEach(([legacyLabel, label]) => {
      const attribute = attributes.find((item) => item.label === label);

      if (attribute) {
        attribute.value = readDb1Value(playersDatabase, index, legacyLabel);
      }
    });

    const ratings = {
      squadNumber: 0,
      currentAbility: readDb1Value(playersDatabase, index, "Ability"),
      potentialAbility: readDb1Value(playersDatabase, index, "Potential"),
      homeReputation: readDb1Value(playersDatabase, index, "Reputation"),
      currentReputation: readDb1Value(playersDatabase, index, "Reputation"),
      worldReputation: readDb1Value(playersDatabase, index, "Reputation"),
      positions: [
        ["Goalkeeper", "Goalkeeper"],
        ["Sweeper", "Sweeper"],
        ["Defender", "Defence"],
        ["Def Midfielder", "Anchor"],
        ["Midfielder", "Midfield"],
        ["Att Midfielder", "Support"],
        ["Attacker", "Attack"],
        ["Wing back", null]
      ].map(([label, legacyLabel]) => ({
        label,
        value: legacyLabel ? legacyPositionValue(readDb1Value(playersDatabase, index, legacyLabel)) : 0
      })),
      sides: [
        ["Right side", "Right Sided"],
        ["Left side", "Left Sided"],
        ["Central", "Central"],
        ["Free role", null]
      ].map(([label, legacyLabel]) => ({
        label,
        value: legacyLabel ? legacyPositionValue(readDb1Value(playersDatabase, index, legacyLabel)) : 0
      })),
      attributes
    };

    staff.push({
      id: index,
      firstName,
      secondName,
      commonName: "",
      displayName,
      birthDate: parseLegacyDate(readDb1Value(playersDatabase, index, "Date of Birth")),
      internationalApps: readDb1Value(playersDatabase, index, "Caps"),
      internationalGoals: readDb1Value(playersDatabase, index, "Goals"),
      nationId: nationRecord?.id ?? null,
      nation: nationName,
      clubId: club?.id ?? null,
      club: club?.name || clubName,
      leagueId: club?.leagueId ?? null,
      league: club?.league || "",
      ratings,
      searchText: createSearchText([displayName, club?.name || clubName, club?.league, nationName])
    });
  }

  return {
    staff,
    clubs,
    leagues: [...leaguesByName.values()],
    nations: [...nationsByName.values()],
    histories: new Map()
  };
}

function parseClubs(buffer, leagues, nations) {
  const view = dataView(buffer);
  const clubs = [];
  const recordSize = 581;

  for (let offset = 0; offset + recordSize <= buffer.byteLength; offset += recordSize) {
    const id = readInt(view, offset);
    const nationId = positiveId(readInt(view, offset + 83), nations.length);
    const leagueId = positiveId(readInt(view, offset + 87), leagues.length);

    clubs[id] = {
      id,
      name: readString(buffer, offset + 4, 51),
      shortName: readString(buffer, offset + 56, 25),
      nationId,
      leagueId,
      nation: nationId === null ? "" : nations[nationId]?.name || "",
      league: leagueId === null ? "" : leagues[leagueId]?.name || ""
    };
  }

  return clubs;
}

function parseStaffHistory(buffer, clubs) {
  const view = dataView(buffer);
  const histories = new Map();
  const recordSize = 17;

  for (let offset = 0; offset + recordSize <= buffer.byteLength; offset += recordSize) {
    const staffId = readInt(view, offset + 4);
    const clubId = readInt(view, offset + 10);
    const club = clubs[clubId];
    const row = {
      season: view.getUint16(offset + 8, true),
      club: club?.shortName || club?.name || "Unknown club",
      appearances: view.getUint8(offset + 15),
      goals: view.getUint8(offset + 16),
      loan: view.getInt8(offset + 14)
    };

    if (!histories.has(staffId)) {
      histories.set(staffId, []);
    }

    histories.get(staffId).push(row);
  }

  histories.forEach((rows) => {
    rows.sort((a, b) => b.season - a.season || Number(a.loan !== 0) - Number(b.loan !== 0));
  });

  return histories;
}

function parsePlayerDetails(buffer, playerDetailSection) {
  const view = dataView(buffer);
  const records = [];

  for (let index = 0; index < playerDetailSection.count; index += 1) {
    const offset = playerDetailSection.start + index * playerDetailSection.size;
    const id = readInt(view, offset);
    const attributes = PLAYER_ATTRIBUTE_LABELS.map((label, attributeIndex) => ({
      label,
      value: view.getUint8(offset + 27 + attributeIndex)
    }));
    const positions = POSITION_LABELS.map((label, positionIndex) => ({
      label,
      value: view.getUint8(offset + 15 + positionIndex)
    }));
    const sides = SIDE_LABELS.map((label, sideIndex) => ({
      label,
      value: view.getUint8(offset + 23 + sideIndex)
    }));

    if (id < 0) {
      continue;
    }

    records[id] = {
      id,
      squadNumber: view.getUint8(offset + 4),
      currentAbility: readShort(view, offset + 5),
      potentialAbility: readShort(view, offset + 7),
      homeReputation: readShort(view, offset + 9),
      currentReputation: readShort(view, offset + 11),
      worldReputation: readShort(view, offset + 13),
      positions,
      sides,
      attributes
    };
  }

  return records;
}

function dayOfYearToDate(dayOfYear, year) {
  if (year <= 0 || dayOfYear < 0 || dayOfYear > 365) {
    return null;
  }

  const monthLengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let remainingDays = dayOfYear;
  let month = 1;

  for (const monthLength of monthLengths) {
    if (remainingDays < monthLength) {
      break;
    }

    remainingDays -= monthLength;
    month += 1;
  }

  return {
    day: remainingDays + 1,
    month,
    year,
    dayOfYear
  };
}

function formatDate(date) {
  return date ? `${date.day}.${date.month}.${date.year}` : "Unknown";
}

function normalizeSearchText(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/[łŁ]/g, "l")
    .replace(/[øØ]/g, "o")
    .replace(/[đĐðÐ]/g, "d")
    .replace(/[ıİ]/g, "i")
    .replace(/[æÆ]/g, "ae")
    .replace(/[œŒ]/g, "oe")
    .replace(/[ßẞ]/g, "ss")
    .replace(/[þÞ]/g, "th")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function createSearchText(parts) {
  return normalizeSearchText(parts.filter(Boolean).join(" "));
}

function getFullName(person) {
  return [person.firstName, person.secondName].filter(Boolean).join(" ");
}

function hasDistinctFullName(person) {
  const fullName = getFullName(person);
  return Boolean(person.commonName && fullName &&
    normalizeSearchText(fullName) !== normalizeSearchText(person.displayName));
}

function parseStaff(
  buffer,
  firstNames,
  secondNames,
  commonNames,
  clubs,
  nations,
  playerDetails,
  staffSection,
  staffFieldLayout
) {
  const view = dataView(buffer);
  const staff = [];

  for (let index = 0; index < staffSection.count; index += 1) {
    const offset = index * staffSection.size;
    const id = readInt(view, offset);
    const firstName = firstNames[positiveId(readInt(view, offset + 4), firstNames.length)] || "";
    const secondName = secondNames[positiveId(readInt(view, offset + 8), secondNames.length)] || "";
    const commonNameId = positiveId(readInt(view, offset + 12), commonNames.length);
    const commonName = commonNameId === null ? "" : commonNames[commonNameId] || "";
    const displayName = commonName || [firstName, secondName].filter(Boolean).join(" ");

    if (!displayName) {
      continue;
    }

    const nationId = positiveId(readInt(view, offset + 26), nations.length);
    const clubId = positiveId(readInt(view, offset + 57), clubs.length);
    const club = clubId === null ? null : clubs[clubId];
    const playerDetailId = positiveId(readInt(view, offset + staffFieldLayout.playerDetailOffset), playerDetails.length);
    const ratings = playerDetailId === null ? null : playerDetails[playerDetailId];
    const birthDate = dayOfYearToDate(view.getUint16(offset + 16, true), view.getUint16(offset + 18, true));
    const internationalApps = view.getUint8(offset + 34);
    const internationalGoals = view.getUint8(offset + 35);

    staff.push({
      id,
      firstName,
      secondName,
      commonName,
      displayName,
      birthDate,
      internationalApps,
      internationalGoals,
      nationId,
      nation: nationId === null ? "" : nations[nationId]?.name || "",
      clubId,
      club: club?.name || "",
      leagueId: club?.leagueId ?? null,
      league: club?.league || "",
      ratings,
      searchText: createSearchText([displayName, firstName, secondName, commonName, club?.name, club?.league, nations[nationId]?.name])
    });
  }

  return staff;
}

async function fetchBuffer(path) {
  const response = await fetch(path);
  if (!response.ok) {
    throw new Error(`Could not load ${path}`);
  }
  return response.arrayBuffer();
}

function databaseFileUrl(databasePath, fileName) {
  return `/${databasePath.split("/").map(encodeURIComponent).join("/")}/${encodeURIComponent(fileName)}`;
}

function cacheDatabase(databasePath, database) {
  databaseCache.delete(databasePath);
  databaseCache.set(databasePath, database);

  while (databaseCache.size > 3) {
    const oldestPath = databaseCache.keys().next().value;

    if (oldestPath === state.databasePath) {
      const currentDatabase = databaseCache.get(oldestPath);
      databaseCache.delete(oldestPath);
      databaseCache.set(oldestPath, currentDatabase);
      continue;
    }

    databaseCache.delete(oldestPath);
  }
}

async function prepareDatabase(databasePath) {
  if (databaseCache.has(databasePath)) {
    const database = databaseCache.get(databasePath);
    cacheDatabase(databasePath, database);
    return database;
  }

  if (databaseLoadPromises.has(databasePath)) {
    return databaseLoadPromises.get(databasePath);
  }

  const loadPromise = (async () => {
    if (state.databaseFormats.get(databasePath) === "cm2") {
      const [playersBuffer, teamsBuffer] = await Promise.all([
        fetchBuffer(databaseFileUrl(databasePath, "PLAYERS.DB1")),
        fetchBuffer(databaseFileUrl(databasePath, "TMDATA.DB1"))
      ]);
      const database = prepareLegacyDatabase(playersBuffer, teamsBuffer);
      cacheDatabase(databasePath, database);
      return database;
    }

    const [
      indexBuffer,
      firstNamesBuffer,
      secondNamesBuffer,
      commonNamesBuffer,
      staffBuffer,
      staffHistoryBuffer,
      clubsBuffer,
      leaguesBuffer,
      nationsBuffer
    ] = await Promise.all(Object.values(TABLE_FILES).map((fileName) => fetchBuffer(databaseFileUrl(databasePath, fileName))));

    const layout = configureDatabaseLayout(indexBuffer, staffBuffer.byteLength);
    const firstNames = parseNameTable(firstNamesBuffer);
    const secondNames = parseNameTable(secondNamesBuffer);
    const commonNames = parseNameTable(commonNamesBuffer);
    const leagues = parseNamedRecords(leaguesBuffer, 107);
    const nations = parseNamedRecords(nationsBuffer, 290);
    const clubs = parseClubs(clubsBuffer, leagues, nations);
    const histories = parseStaffHistory(staffHistoryBuffer, clubs);
    const playerDetails = parsePlayerDetails(staffBuffer, layout.playerDetailSection);
    const staff = parseStaff(
      staffBuffer,
      firstNames,
      secondNames,
      commonNames,
      clubs,
      nations,
      playerDetails,
      layout.staffSection,
      layout.staffFieldLayout
    );
    const database = {
      staff,
      clubs: clubs.filter((club) => club?.name),
      leagues: leagues.filter((league) => league?.name),
      nations: nations.filter((nation) => nation?.name),
      histories
    };

    cacheDatabase(databasePath, database);
    return database;
  })();

  databaseLoadPromises.set(databasePath, loadPromise);

  try {
    return await loadPromise;
  } finally {
    databaseLoadPromises.delete(databasePath);
  }
}

async function loadDatabase(databasePath) {
  const database = await prepareDatabase(databasePath);

  state.staff = database.staff;
  state.clubs = database.clubs;
  state.leagues = database.leagues;
  state.nations = database.nations;
  state.histories = database.histories;
  state.filtered = database.staff;
  state.databasePath = databasePath;
}

function preloadDatabases(databasePaths, immediate = false) {
  const pendingPaths = [...new Set(databasePaths)]
    .filter((databasePath) => databasePath !== state.databasePath)
    .filter((databasePath) => !databaseCache.has(databasePath) && !databaseLoadPromises.has(databasePath))
    .slice(0, 2);

  if (!pendingPaths.length || preloadScheduled) {
    return;
  }

  preloadScheduled = true;
  const preload = async () => {
    try {
      for (const databasePath of pendingPaths) {
        await prepareDatabase(databasePath);
      }
    } catch (error) {
      console.warn("Could not preload database", error);
    } finally {
      preloadScheduled = false;
    }
  };

  if (immediate) {
    void preload();
  } else {
    window.setTimeout(preload, 0);
  }
}

function sortByName(rows) {
  return [...rows].sort((a, b) => a.name.localeCompare(b.name));
}

function option(value, label) {
  const element = document.createElement("option");
  element.value = String(value);
  element.textContent = label;
  return element;
}

function hydrateFilters() {
  elements.clubFilter.replaceChildren(option("", "All clubs"));
  elements.leagueFilter.replaceChildren(option("", "All leagues"));
  elements.nationFilter.replaceChildren(option("", "All nations"));
  sortByName(state.clubs).forEach((club) => elements.clubFilter.append(option(club.id, club.name)));
  sortByName(state.leagues).forEach((league) => elements.leagueFilter.append(option(league.id, league.name)));
  sortByName(state.nations).forEach((nation) => elements.nationFilter.append(option(nation.id, nation.name)));
}

async function selectDatabase(databasePath, selectedId = null) {
  elements.status.textContent = "Loading database...";
  elements.databaseSelect.disabled = true;
  elements.databaseSelect.value = databasePath;
  elements.nameSearch.value = "";
  elements.resultsList.innerHTML = '<div class="empty-state">Loading records...</div>';
  elements.profile.innerHTML = '<div class="empty-state">Loading database...</div>';

  try {
    await loadDatabase(databasePath);
    hydrateFilters();
    renderSummary();
    preloadDatabases(state.databasePaths, true);
    state.activeTab = "profile";
    state.selectedId = selectedId !== null && state.staff.some((person) => person.id === selectedId)
      ? selectedId
      : state.staff.find((person) => person.displayName.toLowerCase().includes("francesco totti"))?.id ?? state.staff[0]?.id ?? null;
    applyFilters();
    elements.status.textContent = "Database ready";
  } catch (error) {
    elements.status.textContent = "Load failed";
    elements.profile.innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
    console.error(error);
  } finally {
    elements.databaseSelect.disabled = false;
  }
}

function applyFilters() {
  const query = normalizeSearchText(elements.nameSearch.value);
  const clubId = elements.clubFilter.value;
  const leagueId = elements.leagueFilter.value;
  const nationId = elements.nationFilter.value;

  state.filtered = state.staff.filter((person) => {
    return (!query || person.searchText.includes(query)) &&
      (!clubId || String(person.clubId) === clubId) &&
      (!leagueId || String(person.leagueId) === leagueId) &&
      (!nationId || String(person.nationId) === nationId);
  });

  if (!state.filtered.some((person) => person.id === state.selectedId)) {
    state.selectedId = state.filtered[0]?.id ?? null;
    state.activeTab = "profile";
  }

  renderResults();
  renderProfile();
}

function renderSummary() {
  elements.playerCount.textContent = state.staff.length.toLocaleString();
  elements.clubCount.textContent = state.clubs.length.toLocaleString();
  elements.leagueCount.textContent = state.leagues.length.toLocaleString();
  elements.nationCount.textContent = state.nations.length.toLocaleString();
}

function renderResults() {
  const rows = state.filtered.slice(0, 250);
  elements.resultCount.textContent = `${state.filtered.length.toLocaleString()} shown`;
  elements.resultsList.replaceChildren();

  if (!rows.length) {
    const empty = document.createElement("div");
    empty.className = "empty-state";
    empty.textContent = "No matching records.";
    elements.resultsList.append(empty);
    return;
  }

  const fragment = document.createDocumentFragment();

  rows.forEach((person) => {
    const row = document.createElement("button");
    const fullName = getFullName(person);
    const showFullName = hasDistinctFullName(person);
    row.type = "button";
    row.className = `result-row${person.id === state.selectedId ? " is-active" : ""}`;
    row.innerHTML = `
      <span class="result-name">${escapeHtml(person.displayName)}</span>
      ${showFullName ? `<span class="result-full-name">${escapeHtml(fullName)}</span>` : ""}
      <span class="result-meta">${escapeHtml([person.club || "No club", person.league, person.nation].filter(Boolean).join(" | "))}</span>
    `;
    row.addEventListener("click", () => {
      state.selectedId = person.id;
      state.activeTab = "profile";
      renderResults();
      renderProfile();
    });
    fragment.append(row);
  });

  elements.resultsList.append(fragment);
}

function ratingValue(value) {
  if (!Number.isFinite(value) || value < 0) {
    return "-";
  }

  return String(value);
}

function attributeColorClass(value) {
  if (value >= 16) {
    return "attribute-excellent";
  }
  if (value >= 12) {
    return "attribute-good";
  }
  if (value >= 8) {
    return "attribute-average";
  }
  return "attribute-low";
}

function reputationValue(value) {
  if (!Number.isFinite(value) || value < 0) {
    return "-";
  }

  return String(value);
}

function renderProfile() {
  const person = state.staff.find((record) => record.id === state.selectedId);

  if (!person) {
    elements.profile.innerHTML = '<div class="empty-state">Select a record to view the CM-style profile.</div>';
    return;
  }

  const primaryRole = person.ratings ? buildPitchRoles(person.ratings)[0] : null;
  const subtitle = [
    formatDate(person.birthDate),
    person.nation || "Unknown nation",
    primaryRole?.longLabel
  ].filter(Boolean).join(" - ");
  const fullName = getFullName(person);
  const showFullName = hasDistinctFullName(person);

  elements.profile.innerHTML = `
    <div class="profile-banner">
      <div class="profile-title">
        <h2>
          <span class="profile-player-name">${escapeHtml(person.displayName)}</span>
          ${person.club ? `<span class="profile-club-name">(${escapeHtml(person.club)})</span>` : ""}
        </h2>
        <span class="season-links" data-season-links></span>
      </div>
      ${showFullName ? `<p class="profile-full-name">${escapeHtml(fullName)}</p>` : ""}
      <p class="born-line">${escapeHtml(subtitle)}</p>
    </div>
    <div class="tabs" role="tablist" aria-label="Player views">
      <button type="button" data-profile-tab="profile" class="${state.activeTab === "profile" ? "is-active" : ""}" aria-selected="${state.activeTab === "profile"}">Profile</button>
      <button type="button" data-profile-tab="history" class="${state.activeTab === "history" ? "is-active" : ""}" aria-selected="${state.activeTab === "history"}">History</button>
    </div>
    ${state.activeTab === "history" ? renderHistory(person) : `
    <div class="profile-body" role="tabpanel">
      <section class="facts" aria-label="Profile facts">
        ${fact("Club", person.club || "No club")}
        ${fact("League", person.league || "Unknown")}
        ${fact("Nation", person.nation || "Unknown")}
        ${fact("Caps", String(person.internationalApps), "international-fact")}
        ${fact("Goals", String(person.internationalGoals), "international-fact")}
        ${fact("Squad No.", person.ratings?.squadNumber ? String(person.ratings.squadNumber) : "-")}
      </section>
      ${renderReputation(person.ratings)}
      ${renderAttributes(person.ratings)}
      ${renderPositionPanel(person.ratings)}
    </div>
    `}
  `;

  renderSeasonLinks(person);
}

function playerSeasonCacheKey(person) {
  return [
    normalizeSearchText([person.firstName, person.secondName].filter(Boolean).join(" ")),
    normalizeSearchText(person.commonName),
    person.birthDate?.dayOfYear,
    person.birthDate?.year
  ].join("|");
}

async function renderSeasonLinks(person) {
  const container = elements.profile.querySelector("[data-season-links]");

  if (!container || !person.birthDate) {
    return;
  }

  const cacheKey = playerSeasonCacheKey(person);
  let matches = state.seasonMatches.get(cacheKey);

  if (!matches) {
    try {
      const params = new URLSearchParams({
        fullName: [person.firstName, person.secondName].filter(Boolean).join(" "),
        commonName: person.commonName,
        dayOfYear: String(person.birthDate.dayOfYear),
        year: String(person.birthDate.year)
      });
      const response = await fetch(`/api/player-seasons?${params}`);

      if (!response.ok) {
        return;
      }

      matches = await response.json();
      state.seasonMatches.set(cacheKey, matches);
    } catch {
      return;
    }
  }

  if (state.selectedId !== person.id || state.databasePath !== elements.databaseSelect.value) {
    return;
  }

  const otherSeasons = matches
    .filter((match) => match.database !== state.databasePath)
    .sort((a, b) => seasonStartYear(a.label) - seasonStartYear(b.label));

  container.replaceChildren();
  otherSeasons.forEach((match) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "season-link";
    button.dataset.seasonPath = match.database;
    button.dataset.staffId = String(match.id);
    button.textContent = match.label;
    button.title = `View this player in ${match.label}`;
    container.append(button);
  });

  preloadDatabases(otherSeasons.map((match) => match.database));
}

function seasonStartYear(label) {
  const startYear = Number.parseInt(label, 10);
  return startYear >= 90 ? 1900 + startYear : 2000 + startYear;
}

function fact(label, value, className = "") {
  return `
    <div class="fact${className ? ` ${className}` : ""}">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

function renderHistory(person) {
  const rows = state.histories.get(person.id) || [];

  if (!rows.length) {
    return '<div class="history-view empty-state" role="tabpanel">No career history records.</div>';
  }

  const totalAppearances = rows.reduce((total, row) => total + row.appearances, 0);
  const totalGoals = rows.reduce((total, row) => total + row.goals, 0);

  return `
    <div class="history-view" role="tabpanel">
      <div class="history-heading">
        <h3>Career History</h3>
        <span>${rows.length} records</span>
      </div>
      <div class="history-table-wrap">
        <table class="history-table">
          <thead>
            <tr>
              <th>Season</th>
              <th>Club</th>
              <th class="history-number">Apps</th>
              <th class="history-number">Goals</th>
              <th class="history-number">Loan</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map((row) => `
              <tr>
                <td>${escapeHtml(row.season)}</td>
                <td>${escapeHtml(row.club)}</td>
                <td class="history-number">${escapeHtml(row.appearances)}</td>
                <td class="history-number">${escapeHtml(row.goals)}</td>
                <td class="history-number">${escapeHtml(row.loan)}</td>
              </tr>
            `).join("")}
          </tbody>
          <tfoot>
            <tr>
              <th colspan="2">Total</th>
              <td class="history-number">${escapeHtml(totalAppearances)}</td>
              <td class="history-number">${escapeHtml(totalGoals)}</td>
              <td class="history-number"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  `;
}

function renderReputation(ratings) {
  if (!ratings) {
    return "";
  }

  const items = [
    ["Current", ratings.currentAbility],
    ["Potential", ratings.potentialAbility],
    ["Home Rep", ratings.homeReputation],
    ["Current Rep", ratings.currentReputation],
    ["World Rep", ratings.worldReputation]
  ];

  return `
    <section class="reputation" aria-label="Ability and reputation">
      ${items.map(([label, value]) => `
        <div class="rep-box">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(reputationValue(value))}</strong>
        </div>
      `).join("")}
    </section>
  `;
}

function buildPitchRoles(ratings) {
  const positions = Object.fromEntries(ratings.positions.map((item) => [item.label, item.value]));
  const sides = Object.fromEntries(ratings.sides.map((item) => [item.label, item.value]));
  const roles = [];
  const usable = (value) => value >= 10;
  const addRole = (label, value, x, y) => {
    if (!usable(value)) {
      return;
    }

    roles.push({
      label,
      longLabel: PITCH_ROLE_NAMES[label] || label,
      value,
      x,
      y,
      level: value >= 20 ? "natural" : value >= 15 ? "accomplished" : "limited"
    });
  };
  const addSidedRoles = (positionLabel, roleLabels, y) => {
    const positionValue = positions[positionLabel];

    if (!usable(positionValue)) {
      return;
    }

    if (usable(sides["Left side"])) {
      addRole(roleLabels.left, Math.min(positionValue, sides["Left side"]), PITCH_LANES.left, y);
    }
    if (usable(sides.Central)) {
      addRole(roleLabels.centre, Math.min(positionValue, sides.Central), PITCH_LANES.centre, y);
    }
    if (usable(sides["Right side"])) {
      addRole(roleLabels.right, Math.min(positionValue, sides["Right side"]), PITCH_LANES.right, y);
    }
  };

  addRole("GK", positions.Goalkeeper, PITCH_LANES.centre, PITCH_ROWS.goalkeeper);
  addRole("SW", positions.Sweeper, PITCH_LANES.centre, PITCH_ROWS.sweeper);
  addSidedRoles("Defender", { left: "DL", centre: "DC", right: "DR" }, PITCH_ROWS.defence);

  if (usable(positions["Wing back"])) {
    if (usable(sides["Left side"])) {
      addRole("WBL", Math.min(positions["Wing back"], sides["Left side"]), PITCH_LANES.wideLeft, PITCH_ROWS.defensiveMidfield);
    }
    if (usable(sides["Right side"])) {
      addRole("WBR", Math.min(positions["Wing back"], sides["Right side"]), PITCH_LANES.wideRight, PITCH_ROWS.defensiveMidfield);
    }
  }

  addSidedRoles("Def Midfielder", { left: "DML", centre: "DMC", right: "DMR" }, PITCH_ROWS.defensiveMidfield);
  addSidedRoles("Midfielder", { left: "ML", centre: "MC", right: "MR" }, PITCH_ROWS.midfield);
  addSidedRoles("Att Midfielder", { left: "AML", centre: "AMC", right: "AMR" }, PITCH_ROWS.attackingMidfield);

  if (usable(positions.Attacker)) {
    addRole("ST", positions.Attacker, PITCH_LANES.centre, PITCH_ROWS.striker);
  }

  return roles.sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

function renderPositionPanel(ratings) {
  if (!ratings) {
    return "";
  }

  const roles = buildPitchRoles(ratings);
  const occupiedRoles = new Set(roles.map((role) => role.label));
  const ghostRoles = PITCH_SLOTS.filter((slot) => !occupiedRoles.has(slot.label));
  const primaryRole = roles[0];

  return `
    <section class="profile-section positions-section" aria-label="Positions and sides">
      <div class="position-layout">
        <div>
          <div class="position-pitch" aria-label="Playable positions">
            <div class="pitch-halfway"></div>
            <div class="pitch-circle"></div>
            <div class="pitch-box pitch-box-top"></div>
            <div class="pitch-box pitch-box-bottom"></div>
            ${ghostRoles.map((role) => `
              <div
                class="position-marker ghost"
                style="--x: ${role.x}%; --y: ${role.y}%"
                title="${escapeHtml(PITCH_ROLE_NAMES[role.label])}"
              ></div>
            `).join("")}
            ${roles.map((role, index) => `
              <div
                class="position-marker ${role.level}${index === 0 ? " is-primary" : ""}"
                style="--x: ${role.x}%; --y: ${role.y}%"
                title="${escapeHtml(`${role.longLabel}: ${role.value}`)}"
              ></div>
            `).join("")}
          </div>
          <div class="pitch-caption">
            <strong>${escapeHtml(primaryRole ? primaryRole.longLabel : "No recognised position")}</strong>
          </div>
          <div class="position-legend">
            <span><i class="legend-dot natural"></i>Natural 20</span>
            <span><i class="legend-dot accomplished"></i>Playable 15-19</span>
            <span><i class="legend-dot limited"></i>Limited 10-14</span>
          </div>
        </div>
        <div class="position-details">
          <details class="position-ratings-toggle">
            <summary>Position ratings</summary>
            <div class="position-values">
              ${[...ratings.positions, ...ratings.sides].map((item) => `
                <div class="rating">
                  <span>${escapeHtml(item.label)}</span>
                  <strong>${escapeHtml(ratingValue(item.value))}</strong>
                </div>
              `).join("")}
            </div>
          </details>
          ${renderFootStrength(ratings)}
        </div>
      </div>
    </section>
  `;
}

function footStrengthLevel(value) {
  if (value >= 15) {
    return "strong";
  }
  if (value >= 10) {
    return "usable";
  }
  return "weak";
}

function renderFootStrength(ratings) {
  const valuesByLabel = new Map(ratings.attributes.map((item) => [item.label, item.value]));
  const feet = [
    { label: "Left Foot", value: valuesByLabel.get("Left Foot"), side: "left" },
    { label: "Right Foot", value: valuesByLabel.get("Right Foot"), side: "right" }
  ];

  return `
    <div class="foot-strength" aria-label="Foot strength">
      <div class="foot-options">
        ${feet.map((foot) => `
          <div class="foot-option ${footStrengthLevel(foot.value)}">
            <div>
              <span>${escapeHtml(foot.label)}</span>
              <strong>${escapeHtml(ratingValue(foot.value))}</strong>
            </div>
            <div class="boot-badge" aria-hidden="true">
              <div class="boot boot-${foot.side}">
                <span></span>
              </div>
            </div>
          </div>
        `).join("")}
      </div>
      <div class="foot-legend">
        <span><i class="foot-swatch strong"></i>Strong 15-20</span>
        <span><i class="foot-swatch usable"></i>Usable 10-14</span>
        <span><i class="foot-swatch weak"></i>Weak 0-9</span>
      </div>
    </div>
  `;
}

function renderAttributes(ratings) {
  if (!ratings) {
    return "";
  }

  const valuesByLabel = new Map(ratings.attributes.map((item) => [item.label, item.value]));

  return `
    <section class="profile-section attributes-section" aria-label="Player attributes">
      <div class="attribute-columns">
        ${ATTRIBUTE_GROUPS.map((group) => `
          <div class="attribute-group">
            <h4>${escapeHtml(group.title)}</h4>
            ${group.labels.map((label) => `
              <div class="rating">
                <span>${escapeHtml(label)}</span>
                <strong class="${attributeColorClass(valuesByLabel.get(label))}">${escapeHtml(ratingValue(valuesByLabel.get(label)))}</strong>
              </div>
            `).join("")}
          </div>
        `).join("")}
      </div>
      <details class="hidden-attributes">
        <summary>Hidden Attributes</summary>
        <div class="hidden-attribute-grid">
          ${HIDDEN_ATTRIBUTE_LABELS.map((label) => `
            <div class="rating">
              <span>${escapeHtml(label)}</span>
              <strong class="${attributeColorClass(valuesByLabel.get(label))}">${escapeHtml(ratingValue(valuesByLabel.get(label)))}</strong>
            </div>
          `).join("")}
        </div>
      </details>
    </section>
  `;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#039;"
  })[char]);
}

function bindEvents() {
  [elements.nameSearch, elements.clubFilter, elements.leagueFilter, elements.nationFilter].forEach((element) => {
    element.addEventListener("input", applyFilters);
  });

  elements.profile.addEventListener("click", (event) => {
    const seasonLink = event.target.closest("[data-season-path]");

    if (seasonLink) {
      selectDatabase(seasonLink.dataset.seasonPath, Number(seasonLink.dataset.staffId));
      return;
    }

    const tab = event.target.closest("[data-profile-tab]");

    if (!tab || tab.disabled || tab.dataset.profileTab === state.activeTab) {
      return;
    }

    state.activeTab = tab.dataset.profileTab;
    renderProfile();
  });

  elements.databaseSelect.addEventListener("change", () => {
    selectDatabase(elements.databaseSelect.value);
  });
}

async function init() {
  try {
    bindEvents();
    const response = await fetch("/api/databases");

    if (!response.ok) {
      throw new Error("Could not discover database folders");
    }

    const databases = await response.json();

    if (!databases.length) {
      throw new Error("No compatible database folders found");
    }

    elements.databaseSelect.replaceChildren(
      ...databases.map((database) => option(database.path, database.name.replace(/\s+dat$/i, "")))
    );
    state.databasePaths = databases.map((database) => database.path);
    state.databaseFormats = new Map(databases.map((database) => [database.path, database.format || "modern"]));
    await selectDatabase(databases[0].path);
  } catch (error) {
    elements.status.textContent = "Load failed";
    elements.profile.innerHTML = `<div class="error-state">${escapeHtml(error.message)}</div>`;
    console.error(error);
  }
}

init();
