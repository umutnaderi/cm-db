import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const INPUTS = [
  resolve(".tmp-search-index/audited/player_search.csv"),
  resolve(".tmp-search-index/cm4/retroball_cm0203_0304_profile_ready_v2/player_search.csv"),
];
const OUTPUT = resolve("worker/src/name-token-index.json");
const MANUAL_ALIASES = resolve("config/identity/player_search_aliases.csv");
const MAX_PER_TOKEN = 8;
const MIN_CURRENT_ABILITY = 145;
const MIN_POTENTIAL_ABILITY = 170;

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }

  const [headers, ...records] = rows;
  return records
    .filter((record) => record.length > 1)
    .map((record) =>
      Object.fromEntries(headers.map((header, index) => [header, record[index] ?? ""])),
    );
}

function normalizeTokens(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 3);
}

function rowScore(row) {
  return Number(row.current_ability || 0) * 10_000
    + Number(row.potential_ability || 0) * 100
    + Number(row.value || 0) / 1_000_000;
}

const buckets = new Map();
const availableInputs = INPUTS.filter((input) => existsSync(input));

for (const input of availableInputs) {
  for (const row of parseCsv(readFileSync(input, "utf8"))) {
    const database = row.database_slug;
    if (!database || !row.source_person_id) continue;
    if (
      Number(row.current_ability || 0) < MIN_CURRENT_ABILITY
      && Number(row.potential_ability || 0) < MIN_POTENTIAL_ABILITY
    ) {
      continue;
    }

    const tokens = new Set([
      ...normalizeTokens(row.display_name),
      ...normalizeTokens(row.full_name),
      ...normalizeTokens(row.common_name),
    ]);

    for (const token of tokens) {
      const key = `${database}\t${token}`;
      const bucket = buckets.get(key) || [];
      bucket.push(row);
      buckets.set(key, bucket);
    }
  }
}

const index = availableInputs.length
  ? {}
  : existsSync(OUTPUT)
    ? JSON.parse(readFileSync(OUTPUT, "utf8"))
    : {};

for (const [key, rows] of buckets) {
  const [database, token] = key.split("\t");
  rows.sort((left, right) =>
    rowScore(right) - rowScore(left)
    || String(left.full_name || left.display_name || "").localeCompare(
      String(right.full_name || right.display_name || ""),
    ),
  );

  index[database] ||= {};
  index[database][token] = rows
    .slice(0, MAX_PER_TOKEN)
    .map((row) => String(row.source_person_id));
}

if (existsSync(MANUAL_ALIASES)) {
  for (const alias of parseCsv(readFileSync(MANUAL_ALIASES, "utf8"))) {
    const database = String(alias.database_slug || "").trim();
    const sourcePersonId = String(alias.source_person_id || "").trim();
    if (!database || !sourcePersonId) continue;

    index[database] ||= {};
    for (const token of new Set(normalizeTokens(alias.search_text))) {
      const existing = index[database][token] || [];
      index[database][token] = [
        sourcePersonId,
        ...existing.filter((candidate) => candidate !== sourcePersonId),
      ].slice(0, MAX_PER_TOKEN);
    }
  }
}

mkdirSync(dirname(OUTPUT), { recursive: true });
writeFileSync(OUTPUT, `${JSON.stringify(index)}\n`);

const sizeKb = Math.round(readFileSync(OUTPUT).length / 1024);
console.log(`Wrote ${OUTPUT} (${sizeKb} KiB, ${Object.keys(index).length} databases).`);
