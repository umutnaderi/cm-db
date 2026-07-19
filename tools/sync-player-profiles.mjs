import { createClient } from "../worker/node_modules/@libsql/client/lib-esm/node.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(".");
const varsPath = existsSync(resolve(root, "worker", ".devs.vars"))
  ? resolve(root, "worker", ".devs.vars")
  : resolve(root, "worker", ".dev.vars");
const localDbPath = resolve(root, "db", "retroball.sqlite");
const columns = [
  "database_slug",
  "source_person_id",
  "source_player_id",
  "display_name",
  "full_name",
  "common_name",
  "club_id",
  "club_name",
  "nation_id",
  "nation_name",
  "date_of_birth",
  "age",
  "position_text",
  "current_ability",
  "potential_ability",
  "ratings_json",
  "positions_json",
  "sides_json",
  "attributes_json",
  "raw_json",
];
const batchSize = Number(process.env.BATCH_SIZE || 500);

function readVars(path) {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [
          line.slice(0, index),
          line.slice(index + 1).replace(/^['"]|['"]$/g, ""),
        ];
      }),
  );
}

const vars = readVars(varsPath);

if (!vars.TURSO_DATABASE_URL || !vars.TURSO_AUTH_TOKEN) {
  throw new Error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in worker vars.");
}

const local = createClient({ url: `file:${localDbPath}` });
const remote = createClient({
  url: vars.TURSO_DATABASE_URL,
  authToken: vars.TURSO_AUTH_TOKEN,
});

try {
  const countResult = await local.execute("SELECT count(*) AS count FROM player_profiles");
  const total = Number(countResult.rows[0]?.count || 0);

  console.log(`Syncing ${total.toLocaleString()} player profile rows to Turso...`);

  await remote.batch([
    "DROP TABLE IF EXISTS player_profiles",
    `
      CREATE TABLE player_profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        database_slug TEXT NOT NULL,
        source_person_id TEXT NOT NULL,
        source_player_id TEXT,
        display_name TEXT,
        full_name TEXT,
        common_name TEXT,
        club_id TEXT,
        club_name TEXT,
        nation_id TEXT,
        nation_name TEXT,
        date_of_birth TEXT,
        age INTEGER,
        position_text TEXT,
        current_ability INTEGER,
        potential_ability INTEGER,
        ratings_json TEXT,
        positions_json TEXT,
        sides_json TEXT,
        attributes_json TEXT,
        raw_json TEXT
      )
    `,
  ], "write");

  let lastId = 0;
  let synced = 0;
  const insertSql = `
    INSERT INTO player_profiles (${columns.join(", ")})
    VALUES (${columns.map(() => "?").join(", ")})
  `;

  while (synced < total) {
    const page = await local.execute({
      sql: `
        SELECT id, ${columns.join(", ")}
        FROM player_profiles
        WHERE id > ?
        ORDER BY id
        LIMIT ?
      `,
      args: [lastId, batchSize],
    });

    if (!page.rows.length) {
      break;
    }

    await remote.batch(
      page.rows.map((row) => ({
        sql: insertSql,
        args: columns.map((column) => row[column]),
      })),
      "write",
    );

    lastId = Number(page.rows.at(-1).id);
    synced += page.rows.length;

    if (synced % (batchSize * 10) === 0 || synced === total) {
      console.log(`Synced ${synced.toLocaleString()} / ${total.toLocaleString()}`);
    }
  }

  await remote.batch([
    "CREATE INDEX idx_player_profiles_player ON player_profiles(database_slug, source_person_id)",
  ], "write");

  const remoteCount = await remote.execute("SELECT count(*) AS count FROM player_profiles");
  console.log(`Remote player_profiles rows: ${Number(remoteCount.rows[0]?.count || 0).toLocaleString()}`);
} finally {
  local.close();
  remote.close();
}
