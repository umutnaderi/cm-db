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

const MODERN_PLAYER_ATTRIBUTE_LABELS = [
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

const CM4_EXTRA_ATTRIBUTE_LABELS = [
  "First Touch",
  "Eccentricity"
];

const PLAYER_ATTRIBUTE_LABELS = [
  ...MODERN_PLAYER_ATTRIBUTE_LABELS,
  ...CM4_EXTRA_ATTRIBUTE_LABELS,
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
      "First Touch",
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
      "Eccentricity",
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
  "Injury Proneness",
  "Adaptability",
  "Ambition",
  "Determination",
  "Controversy",
  "Loyalty",
  "Pressure",
  "Professionalism",
  "Sportsmanship",
  "Temperament",
];

const CM4_MENTAL_ATTRIBUTE_LABELS = [
  "Adaptability",
  "Ambition",
  "Controversy",
  "Loyalty",
  "Pressure",
  "Professionalism",
  "Sportsmanship",
  "Temperament",
];

const MODERN_MENTAL_ATTRIBUTE_LABELS = [
  "Adaptability",
  "Ambition",
  "Determination",
  "Loyalty",
  "Pressure",
  "Professionalism",
  "Sportsmanship",
  "Temperament",
];

const NON_PLAYING_ATTRIBUTE_LABELS = [
  "Attacking",
  "Business",
  "Coaching",
  "Coaching Goalkeepers",
  "Coaching Technique",
  "Directness",
  "Discipline",
  "Free Roles",
  "Interference",
  "Judging Ability",
  "Judging Potential",
  "Man Handling",
  "Marking",
  "Motivating",
  "Offside",
  "Patience",
  "Physiotherapy",
  "Pressing",
  "Resources",
  "Tactics",
  "Youngsters",
];

const STAFF_JOB_LABELS = [
  "Not set",
  "Chairman",
  "Managing Director",
  "General Manager",
  "Director of Football",
  "Manager",
  "Assistant Manager",
  "Coach",
  "Scout",
  "Physio",
  "Player",
  "Player/Manager",
  "Player/Assistant Manager",
  "Player/Coach",
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
  LW: "Left Winger",
  RW: "Right Winger",
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
  goalkeeper: 94
};

const PITCH_SLOTS = [
  { label: "LW", x: PITCH_LANES.left, y: PITCH_ROWS.striker },
  { label: "ST", x: PITCH_LANES.centre, y: PITCH_ROWS.striker },
  { label: "RW", x: PITCH_LANES.right, y: PITCH_ROWS.striker },
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
  const nonPlayingDetailOffset = {
    110: 105,
    157: 153,
  }[staffRecordSize];

  if (!playerDetailOffset || !nonPlayingDetailOffset) {
    throw new Error(`Unsupported staff record size: ${staffRecordSize}`);
  }

  return {
    staffSection: {
      count: baseStaff.count,
      size: staffRecordSize
    },
    nonPlayingDetailSection: {
      start: playerSection.start,
      count: playerSection.count,
      size: Math.round(
        (detailSection.start - playerSection.start) / playerSection.count,
      ),
    },
    playerDetailSection: {
      start: detailSection.start,
      count: detailSection.count,
      size: Math.round((detailSectionEnd - detailSection.start) / detailSection.count)
    },
    staffFieldLayout: {
      playerDetailOffset,
      nonPlayingDetailOffset,
      jobOffset: 61,
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

  const recordStarts = [schemaOffset + 6, schemaOffset + 2];
  const recordStart = recordStarts.find(
    (candidate) => (buffer.byteLength - candidate) % recordOffset === 0,
  ) ?? schemaOffset + 6;

  return {
    buffer,
    view,
    fieldsByName: new Map(fields.map((field) => [field.name, field])),
    recordStart,
    recordSize: recordOffset,
    count: Math.floor((buffer.byteLength - recordStart) / recordOffset)
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
    const value = database.view.getUint8(offset) * 128 + database.view.getUint8(offset + 1);
    return value <= 200 ? value : -1;
  }

  return database.view.getUint32(offset, true);
}

function readDb1Base128Value(database, rowIndex, fieldName) {
  const field = database.fieldsByName.get(fieldName);

  if (!field) {
    return null;
  }

  const offset = database.recordStart + rowIndex * database.recordSize + field.offset;
  let value = 0;

  for (let index = 0; index < field.length; index += 1) {
    value = value * 128 + database.view.getUint8(offset + index);
  }

  return value;
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

function prepareLegacyDatabase(playersBuffers, teamsBuffer, managersBuffer = null) {
  const playerBuffers = Array.isArray(playersBuffers) ? playersBuffers : [playersBuffers];
  const playerDatabases = playerBuffers.map(parseDb1);
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
    const name =
      readDb1Value(teamsDatabase, index, "UK Long Name") ||
      readDb1Value(teamsDatabase, index, "Long Name");
    const shortName =
      readDb1Value(teamsDatabase, index, "UK Short Name") ||
      readDb1Value(teamsDatabase, index, "Short Name");

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
    Adaptability: ["Adaptability"],
    Aggression: ["Aggression"],
    "Big-Occasion": ["Important Matches"],
    Character: ["Ambition", "Professionalism", "Sportsmanship"],
    Consistency: ["Consistency"],
    Creativity: ["Vision"],
    Determination: ["Determination"],
    Dirtyness: ["Dirtiness"],
    Dribbling: ["Dribbling"],
    Flair: ["Flair"],
    Heading: ["Heading", "Jumping"],
    Influence: ["Leadership"],
    "Inj Prone": ["Injury Proneness"],
    Intelligence: ["Decisions"],
    Marking: ["Marking"],
    "Off the ball": ["Off the Ball"],
    Pace: ["Pace", "Acceleration"],
    Passing: ["Passing"],
    Positioning: ["Positioning"],
    "Set Pieces": ["Free Kicks", "Corners"],
    Shooting: ["Finishing", "Long Shots"],
    Stamina: ["Stamina"],
    Strength: ["Strength"],
    Tackling: ["Tackling"],
    Technique: ["Technique"],
  };
  const staff = [];

  for (const playersDatabase of playerDatabases) {
    for (let index = 0; index < playersDatabase.count; index += 1) {
      const firstName = readDb1Value(playersDatabase, index, "First Name");
      const secondName = readDb1Value(playersDatabase, index, "Second Name");
      const displayName = [firstName, secondName].filter(Boolean).join(" ");

      if (!displayName) {
        continue;
      }

      const nationName = readDb1Value(playersDatabase, index, "Nation");
      const nationRecord = nation(nationName);
      const clubName =
        readDb1Value(playersDatabase, index, "Current Club") ||
        readDb1Value(playersDatabase, index, "Club");
      const club = clubsByName.get(normalizeSearchText(clubName));
      const attributes = [
        ...PLAYER_ATTRIBUTE_LABELS,
        "Adaptability",
        "Ambition",
        "Determination",
        "Professionalism",
        "Sportsmanship",
      ].map((label) => ({ label, value: null }));

      Object.entries(attributeMap).forEach(([legacyLabel, labels]) => {
        const value = readDb1Value(playersDatabase, index, legacyLabel);

        labels.forEach((label) => {
          const attribute = attributes.find((item) => item.label === label);

          if (attribute) {
            attribute.value = value;
          }
        });
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
          ["Wing back", null],
        ].map(([label, legacyLabel]) => ({
          label,
          value: legacyLabel
            ? legacyPositionValue(
                readDb1Value(playersDatabase, index, legacyLabel),
              )
            : 0,
        })),
        sides: [
          ["Right side", "Right Sided"],
          ["Left side", "Left Sided"],
          ["Central", "Central"],
          ["Free role", null],
        ].map(([label, legacyLabel]) => ({
          label,
          value: legacyLabel
            ? legacyPositionValue(
                readDb1Value(playersDatabase, index, legacyLabel),
              )
            : 0,
        })),
        attributes,
      };

      staff.push({
        id: staff.length,
        stableId: readDb1Base128Value(playersDatabase, index, "Unique ID"),
        firstName,
        secondName,
        commonName: "",
        displayName,
        birthDate: parseLegacyDate(
          readDb1Value(playersDatabase, index, "Date of Birth") ||
            readDb1Value(playersDatabase, index, "Birth Date"),
        ),
        internationalApps: readDb1Value(playersDatabase, index, "Caps"),
        internationalGoals: readDb1Value(playersDatabase, index, "Goals"),
        nationId: nationRecord?.id ?? null,
        nation: nationName,
        clubId: club?.id ?? null,
        club: club?.name || clubName,
        leagueId: club?.leagueId ?? null,
        league: club?.league || "",
        ratings,
        searchText: createSearchText([
          displayName,
          club?.name || clubName,
          club?.league,
          nationName,
        ]),
      });
    }
  }

  if (managersBuffer) {
    const managersDatabase = parseDb1(managersBuffer);

    for (let index = 0; index < managersDatabase.count; index += 1) {
      const firstName = readDb1Value(managersDatabase, index, "First Name");
      const secondName = readDb1Value(managersDatabase, index, "Second Name");
      const displayName = [firstName, secondName].filter(Boolean).join(" ");

      if (!displayName) {
        continue;
      }

      const nationName = readDb1Value(managersDatabase, index, "Nation");
      const nationRecord = nation(nationName);
      const clubName =
        readDb1Value(managersDatabase, index, "M/Club") ||
        readDb1Value(managersDatabase, index, "M/Int");
      const club = clubsByName.get(normalizeSearchText(clubName));

      staff.push({
        id: staff.length,
        stableId: null,
        firstName,
        secondName,
        commonName: "",
        displayName,
        birthDate: null,
        internationalApps: 0,
        internationalGoals: 0,
        nationId: nationRecord?.id ?? null,
        nation: nationName,
        clubId: club?.id ?? null,
        club: club?.name || clubName,
        leagueId: club?.leagueId ?? null,
        league: club?.league || "",
        jobId: 5,
        job: "Manager",
        ratings: null,
        nonPlayingRatings: {
          currentAbility: readDb1Value(managersDatabase, index, "Ability"),
          potentialAbility: readDb1Value(managersDatabase, index, "Ability"),
          homeReputation: readDb1Value(managersDatabase, index, "Reputation"),
          currentReputation: readDb1Value(managersDatabase, index, "Reputation"),
          worldReputation: readDb1Value(managersDatabase, index, "Reputation"),
          attributes: [],
        },
        mentalAttributes: [],
        searchText: createSearchText([
          displayName,
          club?.name || clubName,
          club?.league,
          nationName,
          "manager",
        ]),
      });
    }
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
    const attributes = MODERN_PLAYER_ATTRIBUTE_LABELS.map((label, attributeIndex) => ({
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

function parseNonPlayingDetails(buffer, section) {
  const view = dataView(buffer);
  const records = [];

  for (let index = 0; index < section.count; index += 1) {
    const offset = section.start + index * section.size;
    const id = readInt(view, offset);

    if (id < 0) {
      continue;
    }

    records[id] = {
      id,
      currentAbility: view.getUint16(offset + 4, true),
      potentialAbility: view.getUint16(offset + 6, true),
      homeReputation: view.getUint16(offset + 8, true),
      currentReputation: view.getUint16(offset + 10, true),
      worldReputation: view.getUint16(offset + 12, true),
      attributes: NON_PLAYING_ATTRIBUTE_LABELS.map((label, attributeIndex) => ({
        label,
        value: view.getUint8(offset + 14 + attributeIndex),
      })),
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
  nonPlayingDetails,
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
    const nonPlayingDetailId = positiveId(
      readInt(view, offset + staffFieldLayout.nonPlayingDetailOffset),
      nonPlayingDetails.length,
    );
    const playerRatings =
      playerDetailId === null ? null : playerDetails[playerDetailId];
    const nonPlayingRatings =
      nonPlayingDetailId === null ? null : nonPlayingDetails[nonPlayingDetailId];
    const mentalAttributes = MODERN_MENTAL_ATTRIBUTE_LABELS.map(
      (label, mentalIndex) => ({
        label,
        value: view.getUint8(offset + 86 + mentalIndex),
      }),
    );
    const ratings = playerRatings
      ? {
          ...playerRatings,
          attributes: [...playerRatings.attributes, ...mentalAttributes],
        }
      : null;
    const birthDate = dayOfYearToDate(view.getUint16(offset + 16, true), view.getUint16(offset + 18, true));
    const internationalApps = view.getUint8(offset + 34);
    const internationalGoals = view.getUint8(offset + 35);
    const jobId = view.getUint8(offset + staffFieldLayout.jobOffset);

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
      jobId,
      job: STAFF_JOB_LABELS[jobId] || `Job ${jobId}`,
      ratings,
      nonPlayingRatings,
      mentalAttributes,
      searchText: createSearchText([
        displayName,
        firstName,
        secondName,
        commonName,
        club?.name,
        club?.league,
        nations[nationId]?.name,
        STAFF_JOB_LABELS[jobId],
      ])
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

function prepareCm4Database(payload) {
  const clubs = payload.clubs.map(([id, name, leagueId, league]) => ({
    id,
    name,
    shortName: name,
    nationId: null,
    leagueId: leagueId || null,
    nation: "",
    league: league || "",
  }));
  const leagues = (payload.leagues || []).map(([id, name]) => ({ id, name }));
  const nations = payload.nations.map(([id, name]) => ({
    id,
    name,
    shortName: name,
  }));
  const clubsById = new Map(clubs.map((club) => [club.id, club]));
  const nationsById = new Map(nations.map((nation) => [nation.id, nation]));
  const isVersionTwo = payload.version >= 2;
  const staff = payload.staff.map((row) => {
    const clubId = row[10] || null;
    const nationId = row[9] || null;
    const club = clubsById.get(clubId);
    const nation = nationsById.get(nationId);
    const flags = isVersionTwo ? row[11] : 1;
    const jobCode = isVersionTwo ? row[12] : -1;
    const playerRow = isVersionTwo ? row[13] : row.slice(11);
    const nonPlayingRow = isVersionTwo ? row[14] : null;
    const hasPlayerRatings = Boolean(flags & 1) && playerRow;
    const hasNonPlayingRatings = Boolean(flags & 2) && nonPlayingRow;
    const person = {
      id: row[0],
      stableId: row[0],
      firstName: row[1],
      secondName: row[2],
      commonName: row[3],
      displayName: row[4],
      birthDate: dayOfYearToDate(row[5], row[6]),
      internationalApps: row[7],
      internationalGoals: row[8],
      nationId,
      nation: nation?.name || "",
      clubId,
      club: club?.name || "",
      leagueId: club?.leagueId ?? null,
      league: club?.league || "",
      jobId: hasNonPlayingRatings ? jobCode : 10,
      job: hasNonPlayingRatings ? "Non-player" : "Player",
      searchText: createSearchText([
        row[4],
        row[1],
        row[2],
        row[3],
        club?.name,
        club?.league,
        nation?.name,
        hasNonPlayingRatings ? "non-player staff manager coach scout physio" : "player",
      ]),
    };

    if (hasPlayerRatings) {
      Object.defineProperty(person, "ratings", {
        configurable: true,
        get() {
          const baseIndex = 5;
          const ratings = {
            squadNumber: 0,
            currentAbility: playerRow[0],
            potentialAbility: playerRow[1],
            homeReputation: playerRow[2],
            currentReputation: playerRow[3],
            worldReputation: playerRow[4],
            positions: POSITION_LABELS.map((label, index) => ({
              label,
              value: playerRow[baseIndex + index],
            })),
            sides: SIDE_LABELS.map((label, index) => ({
              label,
              value: playerRow[baseIndex + POSITION_LABELS.length + index],
            })),
            attributes: [
              ...PLAYER_ATTRIBUTE_LABELS.map((label, index) => ({
                label,
                value:
                  playerRow[
                    baseIndex + POSITION_LABELS.length + SIDE_LABELS.length + index
                  ],
              })),
              ...CM4_MENTAL_ATTRIBUTE_LABELS.map((label, index) => ({
                label,
                value:
                  playerRow[
                    baseIndex +
                      POSITION_LABELS.length +
                      SIDE_LABELS.length +
                      PLAYER_ATTRIBUTE_LABELS.length +
                      index
                  ],
              })),
            ],
          };

          Object.defineProperty(person, "ratings", {
            value: ratings,
            enumerable: true,
          });
          return ratings;
        },
      });
    } else {
      person.ratings = null;
    }

    if (hasNonPlayingRatings) {
      person.nonPlayingRatings = {
        currentAbility: nonPlayingRow[0],
        potentialAbility: nonPlayingRow[1],
        homeReputation: nonPlayingRow[2],
        currentReputation: nonPlayingRow[3],
        worldReputation: nonPlayingRow[4],
        attributes: NON_PLAYING_ATTRIBUTE_LABELS.map((label, index) => ({
          label,
          value: nonPlayingRow[5 + index],
        })),
      };
      person.mentalAttributes = CM4_MENTAL_ATTRIBUTE_LABELS.map(
        (label, index) => ({
          label,
          value: nonPlayingRow[5 + NON_PLAYING_ATTRIBUTE_LABELS.length + index],
        }),
      );
    } else {
      person.nonPlayingRatings = null;
      person.mentalAttributes = [];
    }

    return person;
  });

  return {
    staff,
    clubs,
    leagues,
    nations,
    histories: new Map(),
  };
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
    if (
      state.databaseFormats.get(databasePath) === "cm4" ||
      state.databaseFormats.get(databasePath) === "cm4root"
    ) {
      const response = await fetch(
        `/api/cm4?database=${encodeURIComponent(databasePath)}`,
      );

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        throw new Error(payload?.error || `Could not load ${databasePath}`);
      }

      const database = prepareCm4Database(await response.json());
      cacheDatabase(databasePath, database);
      return database;
    }

    if (state.databaseFormats.get(databasePath) === "cm2") {
      const [playersBuffer, teamsBuffer] = await Promise.all([
        fetchBuffer(databaseFileUrl(databasePath, "PLAYERS.DB1")),
        fetchBuffer(databaseFileUrl(databasePath, "TMDATA.DB1"))
      ]);
      const database = prepareLegacyDatabase(playersBuffer, teamsBuffer);
      cacheDatabase(databasePath, database);
      return database;
    }

    if (state.databaseFormats.get(databasePath) === "cm2early") {
      const [playersOneBuffer, playersTwoBuffer, teamsBuffer, managersBuffer] =
        await Promise.all([
          fetchBuffer(databaseFileUrl(databasePath, "PLDATA1.DB1")),
          fetchBuffer(databaseFileUrl(databasePath, "PLDATA2.DB1")),
          fetchBuffer(databaseFileUrl(databasePath, "TMDATA.DB1")),
          fetchBuffer(databaseFileUrl(databasePath, "MGDATA.DB1")),
        ]);
      const database = prepareLegacyDatabase(
        [playersOneBuffer, playersTwoBuffer],
        teamsBuffer,
        managersBuffer,
      );
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
    const nonPlayingDetails = parseNonPlayingDetails(
      staffBuffer,
      layout.nonPlayingDetailSection,
    );
    const playerDetails = parsePlayerDetails(staffBuffer, layout.playerDetailSection);
    const staff = parseStaff(
      staffBuffer,
      firstNames,
      secondNames,
      commonNames,
      clubs,
      nations,
      playerDetails,
      nonPlayingDetails,
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
  const queryTokens = query.split(" ").filter(Boolean);
  const clubId = elements.clubFilter.value;
  const leagueId = elements.leagueFilter.value;
  const nationId = elements.nationFilter.value;

  state.filtered = state.staff.filter((person) => {
    return (
      (!queryTokens.length ||
        queryTokens.every((token) => person.searchText.includes(token))) &&
      (!clubId || String(person.clubId) === clubId) &&
      (!leagueId || String(person.leagueId) === leagueId) &&
      (!nationId || String(person.nationId) === nationId)
    );
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
      <span class="result-meta">${escapeHtml(
        [
          person.club || "No club",
          person.nonPlayingRatings ? person.job : "",
          person.league,
          person.nation,
        ]
          .filter(Boolean)
          .join(" | "),
      )}</span>
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

function abilityTierClass(value) {
  if (!Number.isFinite(value) || value < 0) {
    return "";
  }
  if (value >= 185) {
    return " ability-tier ability-god ability-animated";
  }
  if (value >= 170) {
    return " ability-tier ability-gold ability-animated";
  }
  if (value >= 150) {
    return " ability-tier ability-gold";
  }
  if (value >= 140) {
    return " ability-tier ability-silver ability-animated";
  }
  if (value >= 130) {
    return " ability-tier ability-silver";
  }
  return " ability-tier ability-bronze";
}

function renderProfile() {
  const person = state.staff.find((record) => record.id === state.selectedId);

  if (!person) {
    elements.profile.innerHTML = '<div class="empty-state">Select a record to view the CM-style profile.</div>';
    return;
  }

  const showNonPlayingProfile = Boolean(
    person.nonPlayingRatings && (!person.ratings || person.jobId !== 10),
  );
  const primaryRole =
    !showNonPlayingProfile && person.ratings
      ? buildPitchRoles(person.ratings)[0]
      : null;
  const subtitle = [
    formatDate(person.birthDate),
    person.nation || "Unknown nation",
    showNonPlayingProfile ? person.job : primaryRole?.longLabel
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
    ${
      showNonPlayingProfile
        ? `
    <div class="tabs staff-tabs" role="tablist" aria-label="Staff view">
      <button type="button" class="is-active" aria-selected="true">Staff Profile</button>
    </div>
    `
        : `
    <div class="tabs" role="tablist" aria-label="Player views">
      <button type="button" data-profile-tab="profile" class="${state.activeTab === "profile" ? "is-active" : ""}" aria-selected="${state.activeTab === "profile"}">Profile</button>
      <button type="button" data-profile-tab="history" class="${state.activeTab === "history" ? "is-active" : ""}" aria-selected="${state.activeTab === "history"}">History</button>
    </div>
    `
    }
    ${
      showNonPlayingProfile
        ? renderNonPlayingProfile(person)
        : state.activeTab === "history"
        ? renderHistory(person)
        : `
    <div class="profile-body" role="tabpanel">
      <section class="facts" aria-label="Profile facts">
        ${filterFact("Club", person.club || "No club", "club", person.club ? person.clubId : null)}
        ${filterFact("League", person.league || "Unknown", "league", person.league ? person.leagueId : null)}
        ${filterFact("Nation", person.nation || "Unknown", "nation", person.nation ? person.nationId : null)}
        ${fact("Caps", String(person.internationalApps), "international-fact")}
        ${fact("Goals", String(person.internationalGoals), "international-fact")}
        ${fact(
          "Squad No.",
          person.ratings?.squadNumber
            ? String(person.ratings.squadNumber)
            : "-",
          "international-fact",
        )}
      </section>
      ${renderReputation(person.ratings)}
      ${renderAttributes(person.ratings)}
      ${renderPositionPanel(person.ratings)}
    </div>
    `
    }
  `;

  renderSeasonLinks(person);
}

function renderNonPlayingProfile(person) {
  const ratings = person.nonPlayingRatings;

  if (!ratings) {
    return '<div class="empty-state">No non-playing ability record.</div>';
  }

  const baseMentalValues = person.mentalAttributes || [];

  return `
    <div class="profile-body staff-profile-body" role="tabpanel">
      <section class="facts staff-facts" aria-label="Staff facts">
        ${filterFact("Club", person.club || "No club", "club", person.club ? person.clubId : null)}
        ${filterFact("League", person.league || "Unknown", "league", person.league ? person.leagueId : null)}
        ${filterFact("Nation", person.nation || "Unknown", "nation", person.nation ? person.nationId : null)}
        ${fact("Job", person.job || "Not set")}
      </section>
      ${renderReputation(ratings)}
      ${
        ratings.attributes.length
          ? `
      <section class="profile-section staff-attributes-section" aria-label="Non-playing attributes">
        <div class="staff-attribute-grid">
          ${ratings.attributes
            .map(
              (item) => `
            <div class="rating">
              <span>${escapeHtml(item.label)}</span>
              <strong class="${attributeColorClass(item.value)}">${escapeHtml(
                ratingValue(item.value),
              )}</strong>
            </div>
          `,
            )
            .join("")}
        </div>
      </section>
      `
          : ""
      }
      ${
        baseMentalValues.some((item) => Number.isFinite(item.value))
          ? `
      <details class="hidden-attributes">
        <summary>Mental Traits</summary>
        <div class="hidden-attribute-grid">
          ${baseMentalValues
            .map(
              (item) => `
            <div class="rating">
              <span>${escapeHtml(item.label)}</span>
              <strong class="${attributeColorClass(item.value)}">${escapeHtml(
                ratingValue(item.value),
              )}</strong>
            </div>
          `,
            )
            .join("")}
        </div>
      </details>
      `
          : ""
      }
    </div>
  `;
}

function playerSeasonCacheKey(person) {
  return [
    person.stableId ?? "",
    normalizeSearchText([person.firstName, person.secondName].filter(Boolean).join(" ")),
    normalizeSearchText(person.commonName),
    person.birthDate?.dayOfYear,
    person.birthDate?.year
  ].join("|");
}

async function renderSeasonLinks(person) {
  const container = elements.profile.querySelector("[data-season-links]");

  if (!container) {
    return;
  }

  const cacheKey = playerSeasonCacheKey(person);
  let matches = state.seasonMatches.get(cacheKey);

  if (!matches) {
    try {
      const params = new URLSearchParams({
        fullName: [person.firstName, person.secondName].filter(Boolean).join(" "),
        commonName: person.commonName,
        dayOfYear: String(person.birthDate?.dayOfYear ?? -1),
        year: String(person.birthDate?.year ?? 0)
      });
      if (Number.isInteger(person.stableId)) {
        params.set("stableId", String(person.stableId));
      }
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

  const seasons = matches
    .concat(
      matches.some((match) => match.database === state.databasePath)
        ? []
        : [{
            id: person.id,
            database: state.databasePath,
            label: state.databasePath.replace(/\s+dat$/i, ""),
          }],
    )
    .sort((a, b) => seasonStartYear(a.label) - seasonStartYear(b.label));

  container.replaceChildren();
  seasons.forEach((match) => {
    const isCurrent = match.database === state.databasePath;
    const button = document.createElement("button");
    button.type = "button";
    button.className = `season-link${isCurrent ? " is-current" : ""}`;

    if (isCurrent) {
      button.disabled = true;
      button.setAttribute("aria-current", "page");
    } else {
      button.dataset.seasonPath = match.database;
      button.dataset.staffId = String(match.id);
    }

    button.textContent = match.label;
    button.title = isCurrent
      ? `Currently viewing ${match.label}`
      : `View this person in ${match.label}`;
    container.append(button);
  });

  preloadDatabases(
    seasons
      .filter((match) => match.database !== state.databasePath)
      .map((match) => match.database),
  );
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

function filterFact(label, value, filterType, filterValue) {
  if (filterValue === null || filterValue === undefined || !value) {
    return fact(label, value);
  }

  return `
    <div class="fact">
      <span>${escapeHtml(label)}</span>
      <button
        type="button"
        class="fact-filter"
        data-fact-filter="${escapeHtml(filterType)}"
        data-filter-value="${escapeHtml(filterValue)}"
        title="Filter results by ${escapeHtml(value)}"
      >${escapeHtml(value)}</button>
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
    ["Current", ratings.currentAbility, true],
    ["Potential", ratings.potentialAbility, true],
    ["Home Rep", ratings.homeReputation, false],
    ["Current Rep", ratings.currentReputation, false],
    ["World Rep", ratings.worldReputation, false],
  ];

  return `
    <section class="reputation" aria-label="Ability and reputation">
      ${items
        .map(
          ([label, value, isAbility]) => `
        <div class="rep-box${isAbility ? abilityTierClass(value) : ""}">
          <span>${escapeHtml(label)}</span>
          <strong>${escapeHtml(reputationValue(value))}</strong>
        </div>
      `,
        )
        .join("")}
    </section>
  `;
}

function pitchRatingLevel(value) {
  if (value >= 18) {
    return { className: "natural", label: "Natural" };
  }
  if (value >= 15) {
    return { className: "accomplished", label: "Playable" };
  }
  if (value >= 12) {
    return { className: "limited", label: "Limited" };
  }
  if (value >= 9) {
    return { className: "weak", label: "Weak" };
  }
  if (value >= 6) {
    return { className: "awkward", label: "Awkward" };
  }
  return { className: "very-awkward", label: "Very awkward" };
}

function buildPitchRoles(ratings) {
  const positions = Object.fromEntries(ratings.positions.map((item) => [item.label, item.value]));
  const sides = Object.fromEntries(ratings.sides.map((item) => [item.label, item.value]));
  const roles = [];
  const useDefenderWingBackFallback = /^97-98(?:\s+dat)?$/i.test(
    state.databasePath.trim(),
  );
  const rated = (value) => value >= 2;
  const addRole = (label, value, x, y, derived = false, longLabel = null) => {
    if (!rated(value)) {
      return;
    }

    const level = pitchRatingLevel(value);
    roles.push({
      label,
      longLabel: longLabel || PITCH_ROLE_NAMES[label] || label,
      value,
      x,
      y,
      level: level.className,
      levelLabel: level.label,
      derived,
    });
  };
  const addSidedRoles = (positionLabel, roleLabels, y) => {
    const positionValue = positions[positionLabel];

    if (!rated(positionValue)) {
      return;
    }

    if (rated(sides["Left side"])) {
      addRole(
        roleLabels.left,
        Math.min(positionValue, sides["Left side"]),
        PITCH_LANES.left,
        y,
      );
    }
    if (rated(sides.Central)) {
      addRole(
        roleLabels.centre,
        Math.min(positionValue, sides.Central),
        PITCH_LANES.centre,
        y,
      );
    }
    if (rated(sides["Right side"])) {
      addRole(
        roleLabels.right,
        Math.min(positionValue, sides["Right side"]),
        PITCH_LANES.right,
        y,
      );
    }
  };

  addRole("GK", positions.Goalkeeper, PITCH_LANES.centre, PITCH_ROWS.goalkeeper);
  addRole("SW", positions.Sweeper, PITCH_LANES.centre, PITCH_ROWS.sweeper);
  addSidedRoles("Defender", { left: "DL", centre: "DC", right: "DR" }, PITCH_ROWS.defence);

  const nativeWingBackValue = positions["Wing back"];
  const wingBackValue = rated(nativeWingBackValue)
    ? nativeWingBackValue
    : useDefenderWingBackFallback
      ? positions.Defender
      : nativeWingBackValue;
  const derivedWingBack =
    !rated(nativeWingBackValue) && useDefenderWingBackFallback;

  if (rated(wingBackValue)) {
    if (rated(sides["Left side"])) {
      addRole(
        "WBL",
        Math.min(wingBackValue, sides["Left side"]),
        PITCH_LANES.wideLeft,
        PITCH_ROWS.defensiveMidfield,
        derivedWingBack,
      );
    }
    if (rated(sides["Right side"])) {
      addRole(
        "WBR",
        Math.min(wingBackValue, sides["Right side"]),
        PITCH_LANES.wideRight,
        PITCH_ROWS.defensiveMidfield,
        derivedWingBack,
      );
    }
  }

  addSidedRoles("Def Midfielder", { left: "DML", centre: "DMC", right: "DMR" }, PITCH_ROWS.defensiveMidfield);
  addSidedRoles("Midfielder", { left: "ML", centre: "MC", right: "MR" }, PITCH_ROWS.midfield);
  addSidedRoles("Att Midfielder", { left: "AML", centre: "AMC", right: "AMR" }, PITCH_ROWS.attackingMidfield);

  if (rated(positions.Attacker)) {
    const isForward =
      positions.Attacker >= 18 && positions["Att Midfielder"] >= 18;

    if (rated(sides["Left side"])) {
      addRole(
        "LW",
        Math.min(positions.Attacker, sides["Left side"]),
        PITCH_LANES.left,
        PITCH_ROWS.striker,
        false,
        isForward ? "Forward - Left" : null,
      );
    }
    addRole(
      "ST",
      positions.Attacker,
      PITCH_LANES.centre,
      PITCH_ROWS.striker,
      false,
      isForward ? "Forward - Centre" : "Striker - Centre",
    );
    if (rated(sides["Right side"])) {
      addRole(
        "RW",
        Math.min(positions.Attacker, sides["Right side"]),
        PITCH_LANES.right,
        PITCH_ROWS.striker,
        false,
        isForward ? "Forward - Right" : null,
      );
    }
  }

  return roles.sort(
    (a, b) =>
      b.value - a.value ||
      Number(b.label === "ST") - Number(a.label === "ST") ||
      a.label.localeCompare(b.label),
  );
}

function renderPositionPanel(ratings) {
  if (!ratings) {
    return "";
  }

  const roles = buildPitchRoles(ratings);
  const occupiedRoles = new Set(roles.map((role) => role.label));
  const ghostRoles = PITCH_SLOTS.filter((slot) => !occupiedRoles.has(slot.label));
  const primaryRole = roles[0];
  const freeRoleValue =
    ratings.sides.find((item) => item.label === "Free role")?.value ?? 0;
  const freeRoleLevel = pitchRatingLevel(freeRoleValue);

  return `
    <section class="profile-section positions-section" aria-label="Positions and sides">
      <div class="position-layout">
        <div>
          <div class="position-pitch" aria-label="Playable positions">
            <div class="pitch-halfway"></div>
            <div class="pitch-circle"></div>
            <div class="pitch-box pitch-box-top"></div>
            <div class="pitch-box pitch-box-bottom"></div>
            ${ghostRoles
              .map(
                (role) => `
              <div
                class="position-marker ghost"
                style="--x: ${role.x}%; --y: ${role.y}%"
                title="${escapeHtml(PITCH_ROLE_NAMES[role.label])}"
              ></div>
            `,
              )
              .join("")}
            ${roles
              .map(
                (role, index) => `
              <div
                class="position-marker position-tooltip ${role.level}${
                  index === 0 ? " is-primary" : ""
                }${role.x <= 20 ? " tooltip-align-left" : ""}${
                  role.x >= 80 ? " tooltip-align-right" : ""
                }${role.y >= 68 ? " tooltip-above" : ""}"
                style="--x: ${role.x}%; --y: ${role.y}%"
                data-info="${escapeHtml(
                  `${role.longLabel} · ${role.levelLabel} · ${role.value}${
                    role.derived ? " · Derived from Defender rating" : ""
                  }`,
                )}"
                aria-label="${escapeHtml(
                  `${role.longLabel}: ${role.levelLabel} (${role.value})`,
                )}"
                tabindex="0"
              ></div>
            `,
              )
              .join("")}
            ${
              freeRoleValue > 10
                ? `
              <div
                class="position-marker position-tooltip free-role-marker tooltip-align-right ${freeRoleLevel.className}"
                style="--x: 94%; --y: 8%"
                data-info="${escapeHtml(
                  `Free Role · ${freeRoleLevel.label} · ${freeRoleValue}`,
                )}"
                aria-label="${escapeHtml(`Free Role ${freeRoleValue}`)}"
                tabindex="0"
              >${escapeHtml("10")}</div>
            `
                : ""
            }
          </div>
          <div class="pitch-caption">
            <strong>${escapeHtml(
              primaryRole
                ? `${primaryRole.longLabel}${
                    primaryRole.value <= 5 ? ` - ${primaryRole.levelLabel}` : ""
                  }`
                : "No recognised position",
            )}</strong>
          </div>
          <div class="position-legend">
            <span><i class="legend-dot natural"></i>Natural 18-20</span>
            <span><i class="legend-dot accomplished"></i>Playable 15-17</span>
            <span><i class="legend-dot limited"></i>Limited 12-14</span>
            <span><i class="legend-dot weak"></i>Weak 9-11</span>
            <span><i class="legend-dot awkward"></i>Awkward 6-8</span>
            <span><i class="legend-dot very-awkward"></i>Very awkward 2-5</span>
          </div>
        </div>
        <div class="position-details">
          <details class="position-ratings-toggle">
            <summary>Position ratings</summary>
            <div class="position-values">
              ${[...ratings.positions, ...ratings.sides]
                .map(
                  (item) => `
                <div class="rating">
                  <span>${escapeHtml(item.label)}</span>
                  <strong>${escapeHtml(ratingValue(item.value))}</strong>
                </div>
              `,
                )
                .join("")}
            </div>
          </details>
          ${renderFootStrength(ratings)}
        </div>
      </div>
    </section>
  `;
}

function footStrengthLevel(value) {
  return pitchRatingLevel(value).className;
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
        <span><i class="foot-swatch natural"></i>Natural 18-20</span>
        <span><i class="foot-swatch accomplished"></i>Playable 15-17</span>
        <span><i class="foot-swatch limited"></i>Limited 12-14</span>
        <span><i class="foot-swatch weak"></i>Weak 9-11</span>
        <span><i class="foot-swatch awkward"></i>Awkward 6-8</span>
        <span><i class="foot-swatch very-awkward"></i>Very awkward 2-5</span>
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
    const factFilter = event.target.closest("[data-fact-filter]");

    if (factFilter) {
      const filterElements = {
        club: elements.clubFilter,
        league: elements.leagueFilter,
        nation: elements.nationFilter,
      };
      const targetFilter = filterElements[factFilter.dataset.factFilter];

      if (targetFilter) {
        elements.nameSearch.value = "";
        elements.clubFilter.value = "";
        elements.leagueFilter.value = "";
        elements.nationFilter.value = "";
        targetFilter.value = factFilter.dataset.filterValue;
        applyFilters();
      }
      return;
    }

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
