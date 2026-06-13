import { createServer } from "node:http";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, normalize, resolve } from "node:path";

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

const decoder = new TextDecoder("windows-1252");
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

  return {
    buffer,
    fields,
    fieldsByName: new Map(fields.map((field) => [field.name, field])),
    recordStart: schemaOffset + 6,
    recordSize: recordOffset,
    count: Math.floor((buffer.length - schemaOffset - 6) / recordOffset)
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
    return database.buffer.readUInt8(offset) * 100 + database.buffer.readUInt8(offset + 1);
  }

  return database.buffer.readUInt32LE(offset);
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
  const players = new Map();

  for (let index = 0; index < playersDatabase.count; index += 1) {
    const firstName = readDb1Value(playersDatabase, index, "First Name");
    const secondName = readDb1Value(playersDatabase, index, "Second Name");
    const birthDate = parseLegacyBirthDate(readDb1Value(playersDatabase, index, "Date of Birth"));

    if (!birthDate) {
      continue;
    }

    const key = identityKey([firstName, secondName].filter(Boolean).join(" "), birthDate.dayOfYear, birthDate.year);

    if (key && !players.has(key)) {
      players.set(key, {
        id: index,
        database: database.path,
        label: database.name.replace(/\s+dat$/i, "")
      });
    }
  }

  return players;
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

  return playerDetailOffset ? {
    count: baseStaff.count,
    recordSize,
    playerDetailOffset,
    playerDetailCount: detailSection.count,
    staffSize
  } : null;
}

function buildDatabasePlayerIndex(database) {
  if (database.format === "cm2") {
    return buildLegacyPlayerIndex(database);
  }

  const databasePath = join(root, database.path);
  const layout = readStaffLayout(databasePath);

  if (!layout) {
    return new Map();
  }

  const firstNames = parseNameTable(join(databasePath, "first_names.dat"));
  const secondNames = parseNameTable(join(databasePath, "second_names.dat"));
  const commonNames = parseNameTable(join(databasePath, "common_names.dat"));
  const staff = readFileSync(join(databasePath, "staff.dat"));
  const players = new Map();

  for (let index = 0; index < layout.count; index += 1) {
    const offset = index * layout.recordSize;
    const playerDetailId = staff.readInt32LE(offset + layout.playerDetailOffset);

    if (playerDetailId < 0 || playerDetailId >= layout.playerDetailCount) {
      continue;
    }

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
    const keys = [
      identityKey([firstName, secondName].filter(Boolean).join(" "), dayOfYear, year),
      identityKey(commonName, dayOfYear, year)
    ].filter(Boolean);

    keys.forEach((key) => {
      if (!players.has(key)) {
        players.set(key, record);
      }
    });
  }

  return players;
}

function databaseSignature(databases) {
  return databases.map((database) => {
    const databasePath = join(root, database.path);
    const signatureFiles = database.format === "cm2"
      ? ["PLAYERS.DB1", "TMDATA.DB1"]
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
  const keys = [
    identityKey(searchParams.get("fullName") || "", dayOfYear, year),
    identityKey(searchParams.get("commonName") || "", dayOfYear, year)
  ].filter(Boolean);

  if (!keys.length) {
    return [];
  }

  return [...getPlayerSeasonIndexes().values()]
    .map((players) => keys.map((key) => players.get(key)).find(Boolean))
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
