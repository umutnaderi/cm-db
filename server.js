import { createServer } from "node:http";
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";
import { gzipSync } from "node:zlib";

const root = resolve(".");
const port = Number(process.env.PORT || 5173);

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".dat": "application/octet-stream"
};

const requiredDatabaseFiles = [
  "index.dat",
  "staff.dat",
  "staff_history.dat",
  "club.dat",
  "club_comp.dat",
  "nation.dat",
  "first_names.dat",
  "second_names.dat",
  "common_names.dat"
];

const requiredLegacyDatabaseFiles = [
  "PLAYERS.DB1",
  "TMDATA.DB1"
];

const requiredEarlyLegacyDatabaseFiles = [
  "PLDATA1.DB1",
  "PLDATA2.DB1",
  "TMDATA.DB1",
  "MGDATA.DB1"
];

const requiredCm4DatabaseFiles = [
  "db/server_db.dat",
  "db/client_db.dat",
  "db/people_db.dat"
];

const requiredRootCm4DatabaseFiles = [
  "server_db.dat",
  "people_db.dat",
  "lang_db.dat"
];

const decoder = new TextDecoder("windows-1252");
const cm4ResponseCache = new Map();
let playerSeasonCache = {
  signature: "",
  databases: new Map()
};

function listDatabases() {
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const databasePath = join(root, entry.name);
      const format = requiredDatabaseFiles.every((file) => existsSync(join(databasePath, file)))
        ? "modern"
        : requiredLegacyDatabaseFiles.every((file) => existsSync(join(databasePath, file)))
          ? "cm2"
          : requiredEarlyLegacyDatabaseFiles.every((file) => existsSync(join(databasePath, file)))
            ? "cm2early"
          : requiredCm4DatabaseFiles.every((file) => existsSync(join(databasePath, file)))
            ? "cm4"
            : requiredRootCm4DatabaseFiles.every((file) => existsSync(join(databasePath, file))) &&
                existsSync(join(databasePath, "cm4-cache.json"))
              ? "cm4root"
            : null;
      return format ? { name: entry.name, path: entry.name, format } : null;
    })
    .filter(Boolean)
    .sort((a, b) => {
      const parseSeasonStart = (name) => {
        const match = String(name).replace(/\s+dat$/i, "").match(/^(\d{1,4})/);
        if (!match) return Number.MAX_SAFE_INTEGER;
        const n = Number(match[1]);
        if (n < 100) {
          return n >= 90 ? 1900 + n : 2000 + n;
        }
        return n;
      };

      return parseSeasonStart(a.name) - parseSeasonStart(b.name);
    });
}

function readString(buffer, offset, length) {
  return decoder
    .decode(buffer.subarray(offset, offset + length))
    .replace(/\xff/g, "")
    .split("\0")[0]
    .trim();
}

function normalizeIdentityName(value) {
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

function identityKey(name, dayOfYear, year) {
  const normalizedName = normalizeIdentityName(name);
  return normalizedName && year > 0 ? `${normalizedName}|${dayOfYear}|${year}` : "";
}

function nameYearKey(name, year) {
  const normalizedName = normalizeIdentityName(name);
  return normalizedName && year > 0 ? `${normalizedName}|${year}` : "";
}

function createSeasonIndex() {
  return {
    byIdentity: new Map(),
    byNameYear: new Map(),
    byName: new Map(),
    byStableId: new Map(),
    records: [],
    allowNameOnly: false
  };
}

function addUniqueIndexRecord(index, key, record) {
  if (!key) {
    return;
  }

  if (!index.has(key)) {
    index.set(key, record);
    return;
  }

  const existing = index.get(key);

  if (existing && existing.id !== record.id) {
    index.set(key, null);
  }
}

function addSeasonRecord(index, record, names, dayOfYear, year, stableId = null) {
  const normalizedNames = names
    .filter(Boolean)
    .map(normalizeIdentityName)
    .filter(Boolean);

  names.filter(Boolean).forEach((name) => {
    addUniqueIndexRecord(index.byIdentity, identityKey(name, dayOfYear, year), record);
    addUniqueIndexRecord(index.byNameYear, nameYearKey(name, year), record);
    addUniqueIndexRecord(index.byName, normalizeIdentityName(name), record);
  });
  index.records.push({ record, names: normalizedNames, year });

  if (Number.isInteger(stableId) && stableId >= 0) {
    addUniqueIndexRecord(index.byStableId, stableId, record);
  }
}

function isOneEditApart(left, right) {
  if (left === right || Math.abs(left.length - right.length) > 1) {
    return false;
  }

  let leftIndex = 0;
  let rightIndex = 0;
  let edits = 0;

  while (leftIndex < left.length && rightIndex < right.length) {
    if (left[leftIndex] === right[rightIndex]) {
      leftIndex += 1;
      rightIndex += 1;
      continue;
    }

    edits += 1;

    if (edits > 1) {
      return false;
    }

    if (left.length > right.length) {
      leftIndex += 1;
    } else if (right.length > left.length) {
      rightIndex += 1;
    } else {
      leftIndex += 1;
      rightIndex += 1;
    }
  }

  edits += left.length - leftIndex + right.length - rightIndex;
  return edits === 1;
}

function findUniqueMisspellingMatch(index, names, year) {
  if (year <= 0 || !names.length) {
    return null;
  }

  const matches = index.records
    .filter((item) => item.year === year)
    .filter((item) =>
      names.some((name) =>
        item.names.some((candidateName) => isOneEditApart(name, candidateName))
      )
    )
    .map((item) => item.record);
  const uniqueMatches = [...new Map(matches.map((record) => [record.id, record])).values()];

  return uniqueMatches.length === 1 ? uniqueMatches[0] : null;
}

function parseNameTable(filePath) {
  const buffer = readFileSync(filePath);
  const rows = [];

  for (let offset = 0; offset + 60 <= buffer.length; offset += 60) {
    rows.push(readString(buffer, offset, 55));
  }

  return rows;
}

function readDb1Schema(filePath) {
  const buffer = readFileSync(filePath);
  const fieldCount = buffer.readUInt16LE(0);
  const fields = [];
  let schemaOffset = 2;
  let recordOffset = 0;

  for (let index = 0; index < fieldCount; index += 1) {
    const nameLength = buffer.readUInt8(schemaOffset);
    schemaOffset += 1;
    const name = readString(buffer, schemaOffset, nameLength);
    schemaOffset += nameLength;
    const type = buffer.readUInt8(schemaOffset);
    const length = buffer.readUInt8(schemaOffset + 1);
    schemaOffset += 4;
    fields.push({ name, type, length, offset: recordOffset });
    recordOffset += length;
  }

  const recordStarts = [schemaOffset + 6, schemaOffset + 2];
  const recordStart = recordStarts.find(
    (candidate) => (buffer.length - candidate) % recordOffset === 0
  ) ?? schemaOffset + 6;

  return {
    buffer,
    fields,
    fieldsByName: new Map(fields.map((field) => [field.name, field])),
    recordStart,
    recordSize: recordOffset,
    count: Math.floor((buffer.length - recordStart) / recordOffset)
  };
}

function readDb1Value(database, rowIndex, fieldName) {
  const field = database.fieldsByName.get(fieldName);

  if (!field) {
    return field?.type === 1 ? "" : 0;
  }

  const offset = database.recordStart + rowIndex * database.recordSize + field.offset;

  if (field.type === 1) {
    return readString(database.buffer, offset, field.length);
  }

  if (field.length === 1) {
    return database.buffer.readUInt8(offset);
  }

  if (field.length === 2) {
    return database.buffer.readUInt8(offset) * 128 + database.buffer.readUInt8(offset + 1);
  }

  return database.buffer.readUInt32LE(offset);
}

function readDb1Base128Value(database, rowIndex, fieldName) {
  const field = database.fieldsByName.get(fieldName);

  if (!field) {
    return null;
  }

  const offset = database.recordStart + rowIndex * database.recordSize + field.offset;
  let value = 0;

  for (let index = 0; index < field.length; index += 1) {
    value = value * 128 + database.buffer.readUInt8(offset + index);
  }

  return value;
}

function parseLegacyBirthDate(value) {
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
  return { dayOfYear, year };
}

function buildLegacyPlayerIndex(database) {
  const playersDatabase = readDb1Schema(join(root, database.path, "PLAYERS.DB1"));
  const players = createSeasonIndex();

  for (let index = 0; index < playersDatabase.count; index += 1) {
    const firstName = readDb1Value(playersDatabase, index, "First Name");
    const secondName = readDb1Value(playersDatabase, index, "Second Name");
    const birthDate = parseLegacyBirthDate(readDb1Value(playersDatabase, index, "Date of Birth"));

    if (!birthDate) {
      continue;
    }

    addSeasonRecord(
      players,
      {
        id: index,
        database: database.path,
        label: database.name.replace(/\s+dat$/i, "")
      },
      [[firstName, secondName].filter(Boolean).join(" ")],
      birthDate.dayOfYear,
      birthDate.year,
      readDb1Base128Value(playersDatabase, index, "Unique ID")
    );
  }

  return players;
}

function buildEarlyLegacyPlayerIndex(database) {
  const index = createSeasonIndex();
  index.allowNameOnly = true;
  let recordId = 0;

  for (const fileName of ["PLDATA1.DB1", "PLDATA2.DB1"]) {
    const playersDatabase = readDb1Schema(join(root, database.path, fileName));

    for (let rowIndex = 0; rowIndex < playersDatabase.count; rowIndex += 1) {
      const firstName = readDb1Value(playersDatabase, rowIndex, "First Name");
      const secondName = readDb1Value(playersDatabase, rowIndex, "Second Name");
      const birthDate = parseLegacyBirthDate(
        readDb1Value(playersDatabase, rowIndex, "Birth Date")
      );
      const record = {
        id: recordId,
        database: database.path,
        label: database.name.replace(/\s+dat$/i, "")
      };
      addSeasonRecord(
        index,
        record,
        [[firstName, secondName].filter(Boolean).join(" ")],
        birthDate?.dayOfYear ?? -1,
        birthDate?.year ?? 0
      );
      recordId += 1;
    }
  }

  const managersDatabase = readDb1Schema(join(root, database.path, "MGDATA.DB1"));

  for (let rowIndex = 0; rowIndex < managersDatabase.count; rowIndex += 1) {
    const firstName = readDb1Value(managersDatabase, rowIndex, "First Name");
    const secondName = readDb1Value(managersDatabase, rowIndex, "Second Name");
    addSeasonRecord(
      index,
      {
        id: recordId,
        database: database.path,
        label: database.name.replace(/\s+dat$/i, "")
      },
      [[firstName, secondName].filter(Boolean).join(" ")],
      -1,
      0
    );
    recordId += 1;
  }

  return index;
}

function readStaffLayout(databasePath) {
  const index = readFileSync(join(databasePath, "index.dat"));
  const staffSize = statSync(join(databasePath, "staff.dat")).size;
  const entries = [];

  for (let offset = 8; offset + 67 <= index.length; offset += 67) {
    const name = readString(index, offset, 31);

    if (name) {
      entries.push({
        name,
        type: index.readUInt8(offset + 51),
        count: index.readUInt32LE(offset + 55),
        start: index.readUInt32LE(offset + 59)
      });
    }
  }

  const baseStaff = entries.find((entry) => entry.name === "staff.dat" && entry.type === 6);
  const playerSection = entries.find((entry) => entry.name === "staff.dat" && entry.type === 9);
  const detailSection = entries.find((entry) => entry.name === "staff.dat" && entry.type === 10);

  if (!baseStaff || !playerSection || !detailSection) {
    return null;
  }

  const recordSize = Math.round(playerSection.start / baseStaff.count);
  const playerDetailOffset = {
    110: 97,
    157: 145
  }[recordSize];
  const nonPlayingDetailOffset = {
    110: 105,
    157: 153
  }[recordSize];

  return playerDetailOffset ? {
    count: baseStaff.count,
    recordSize,
    playerDetailOffset,
    nonPlayingDetailOffset,
    playerDetailCount: detailSection.count,
    staffSize
  } : null;
}

function buildDatabasePlayerIndex(database) {
  if (database.format === "cm2") {
    return buildLegacyPlayerIndex(database);
  }

  if (database.format === "cm2early") {
    return buildEarlyLegacyPlayerIndex(database);
  }

  if (database.format === "cm4" || database.format === "cm4root") {
    const cachePath = join(root, database.path, "cm4-cache.json");

    if (!existsSync(cachePath)) {
      return createSeasonIndex();
    }

    const payload = JSON.parse(readFileSync(cachePath, "utf8"));
    const players = createSeasonIndex();

    payload.staff.forEach((row) => {
      const record = {
        id: row[0],
        database: database.path,
        label: database.name.replace(/\s+dat$/i, "")
      };
      addSeasonRecord(
        players,
        record,
        [[row[1], row[2]].filter(Boolean).join(" "), row[3]],
        row[5],
        row[6],
        row[0]
      );
    });

    return players;
  }

  const databasePath = join(root, database.path);
  const layout = readStaffLayout(databasePath);

  if (!layout) {
    return createSeasonIndex();
  }

  const firstNames = parseNameTable(join(databasePath, "first_names.dat"));
  const secondNames = parseNameTable(join(databasePath, "second_names.dat"));
  const commonNames = parseNameTable(join(databasePath, "common_names.dat"));
  const staff = readFileSync(join(databasePath, "staff.dat"));
  const players = createSeasonIndex();

  for (let index = 0; index < layout.count; index += 1) {
    const offset = index * layout.recordSize;
    const firstName = firstNames[staff.readInt32LE(offset + 4)] || "";
    const secondName = secondNames[staff.readInt32LE(offset + 8)] || "";
    const commonName = commonNames[staff.readInt32LE(offset + 12)] || "";
    const dayOfYear = staff.readUInt16LE(offset + 16);
    const year = staff.readUInt16LE(offset + 18);
    const record = {
      id: staff.readInt32LE(offset),
      database: database.path,
      label: database.name.replace(/\s+dat$/i, "")
    };
    addSeasonRecord(
      players,
      record,
      [[firstName, secondName].filter(Boolean).join(" "), commonName],
      dayOfYear,
      year
    );
  }

  return players;
}

function databaseSignature(databases) {
  return databases.map((database) => {
    const databasePath = join(root, database.path);
    const signatureFiles = database.format === "cm2"
      ? ["PLAYERS.DB1", "TMDATA.DB1"]
      : database.format === "cm2early"
        ? requiredEarlyLegacyDatabaseFiles
      : database.format === "cm4" || database.format === "cm4root"
        ? ["cm4-cache.json"].filter((file) => existsSync(join(databasePath, file)))
        : ["staff.dat", "first_names.dat", "second_names.dat", "common_names.dat"];
    return [
      database.path,
      ...signatureFiles.map((file) => statSync(join(databasePath, file)).mtimeMs)
    ].join(":");
  }).join("|");
}

function getPlayerSeasonIndexes() {
  const databases = listDatabases();
  const signature = databaseSignature(databases);

  if (playerSeasonCache.signature !== signature) {
    playerSeasonCache = {
      signature,
      databases: new Map(databases.map((database) => [
        database.path,
        buildDatabasePlayerIndex(database)
      ]))
    };
  }

  return playerSeasonCache.databases;
}

function findPlayerSeasons(searchParams) {
  const dayOfYear = Number(searchParams.get("dayOfYear"));
  const year = Number(searchParams.get("year"));
  const stableIdValue = searchParams.get("stableId");
  const stableId = stableIdValue === null ? null : Number(stableIdValue);
  const identityKeys = [
    identityKey(searchParams.get("fullName") || "", dayOfYear, year),
    identityKey(searchParams.get("commonName") || "", dayOfYear, year)
  ].filter(Boolean);
  const nameYearKeys = [
    nameYearKey(searchParams.get("fullName") || "", year),
    nameYearKey(searchParams.get("commonName") || "", year)
  ].filter(Boolean);
  const nameKeys = [
    normalizeIdentityName(searchParams.get("fullName") || ""),
    normalizeIdentityName(searchParams.get("commonName") || "")
  ].filter(Boolean);

  if (
    !identityKeys.length &&
    !nameYearKeys.length &&
    !nameKeys.length &&
    !Number.isInteger(stableId)
  ) {
    return [];
  }

  return [...getPlayerSeasonIndexes().values()]
    .map((players) =>
      (Number.isInteger(stableId) ? players.byStableId.get(stableId) : null) ||
      identityKeys.map((key) => players.byIdentity.get(key)).find(Boolean) ||
      nameYearKeys.map((key) => players.byNameYear.get(key)).find(Boolean) ||
      (players.allowNameOnly || year <= 0
        ? nameKeys.map((key) => players.byName.get(key)).find(Boolean)
        : null) ||
      findUniqueMisspellingMatch(players, nameKeys, year)
    )
    .filter(Boolean)
    .sort((a, b) => seasonStartYear(a.label) - seasonStartYear(b.label));
}

function seasonStartYear(label) {
  const startYear = Number.parseInt(label, 10);
  return startYear >= 90 ? 1900 + startYear : 2000 + startYear;
}

function resolveRequestPath(url) {
  const pathname = decodeURIComponent(new URL(url, `http://localhost:${port}`).pathname);
  const cleanPath = normalize(pathname === "/" ? "/index.html" : pathname).replace(/^(\.\.[/\\])+/, "");
  const filePath = resolve(join(root, cleanPath));
  return filePath.startsWith(root) ? filePath : null;
}

function getCm4Response(databasePath) {
  ensureCm4Cache(databasePath);
  const cachePath = join(root, databasePath, "cm4-cache.json");
  const modified = statSync(cachePath).mtimeMs;
  const cached = cm4ResponseCache.get(databasePath);

  if (cached?.modified === modified) {
    return cached.body;
  }

  const body = gzipSync(readFileSync(cachePath), { level: 6 });
  cm4ResponseCache.set(databasePath, { modified, body });
  return body;
}

function needsCm4Cache(databasePath) {
  const databaseRoot = join(root, databasePath);
  const cachePath = join(databaseRoot, "cm4-cache.json");
  const sourceFiles = existsSync(join(databaseRoot, "db", "server_db.dat"))
    ? requiredCm4DatabaseFiles
    : requiredRootCm4DatabaseFiles;

  if (!existsSync(cachePath)) {
    return true;
  }

  try {
    const payload = JSON.parse(readFileSync(cachePath, "utf8"));

    if (payload.version < 4) {
      return true;
    }
  } catch {
    return true;
  }

  const cacheTime = statSync(cachePath).mtimeMs;
  return sourceFiles.some((file) => statSync(join(databaseRoot, file)).mtimeMs > cacheTime);
}

function ensureCm4Cache(databasePath) {
  if (!needsCm4Cache(databasePath)) {
    return;
  }

  const databaseRoot = join(root, databasePath);
  const outputPath = join(databaseRoot, "cm4-cache.json");
  const result = spawnSync("dotnet", [
    "run",
    "-c",
    "Release",
    "--project",
    join(root, "tools", "cm4-extract", "cm4-extract.csproj"),
    "--",
    databaseRoot,
    outputPath
  ], {
    cwd: root,
    encoding: "utf8",
    timeout: 180_000,
    windowsHide: true
  });

  if (result.status !== 0 || !existsSync(outputPath)) {
    const details = [result.stderr, result.stdout]
      .filter(Boolean)
      .join("\n")
      .trim();
    const loaderInstruction = existsSync(join(databaseRoot, "db", "client_db.dat"))
      ? "Open CM Data Editor and load this database's server_db.dat."
      : "Open Championship Manager 4 and load or start a game using this database.";
    throw new Error(
      `Could not build the CM4-family cache. ${loaderInstruction} Then select the database again.` +
      (details ? `\n\n${details}` : "")
    );
  }

  cm4ResponseCache.delete(databasePath);
}

createServer((request, response) => {
  const requestUrl = new URL(request.url || "/", `http://localhost:${port}`);
  const pathname = requestUrl.pathname;

  if (pathname === "/api/databases") {
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(JSON.stringify(listDatabases()));
    return;
  }

  if (pathname === "/api/player-seasons") {
    response.writeHead(200, {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    });
    response.end(JSON.stringify(findPlayerSeasons(requestUrl.searchParams)));
    return;
  }

  if (pathname === "/api/cm4") {
    const databasePath = requestUrl.searchParams.get("database") || "";
    const database = listDatabases().find(
      (item) =>
        item.path === databasePath &&
        (item.format === "cm4" || item.format === "cm4root")
    );

    if (!database) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("CM4 database not found");
      return;
    }

    try {
      const payload = getCm4Response(database.path);
      response.writeHead(200, {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Encoding": "gzip",
        "Cache-Control": "no-store"
      });
      response.end(payload);
    } catch (error) {
      response.writeHead(409, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store"
      });
      response.end(JSON.stringify({ error: error.message }));
    }
    return;
  }

  const filePath = resolveRequestPath(request.url || "/");

  if (!filePath || !existsSync(filePath) || !statSync(filePath).isFile()) {
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  response.writeHead(200, {
    "Content-Type": mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream",
    "Cache-Control": "no-store"
  });

  createReadStream(filePath).pipe(response);
}).listen(port, () => {
  console.log(`CM DB browser running at http://localhost:${port}`);
});
