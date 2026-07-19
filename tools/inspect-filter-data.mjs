import { createClient } from "../worker/node_modules/@libsql/client/lib-esm/node.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(".");
const varsPath = existsSync(resolve(root, "worker", ".devs.vars"))
  ? resolve(root, "worker", ".devs.vars")
  : resolve(root, "worker", ".dev.vars");
const vars = Object.fromEntries(
  readFileSync(varsPath, "utf8").split(/\r?\n/)
    .map((line) => line.trim()).filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1).replace(/^[\"']|[\"']$/g, "")];
    }),
);
const db = createClient({ url: vars.TURSO_DATABASE_URL, authToken: vars.TURSO_AUTH_TOKEN });

try {
  const tables = await db.execute(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'table'
      AND (lower(name) LIKE '%league%' OR lower(name) LIKE '%division%' OR lower(name) LIKE '%competition%' OR name IN ('clubs', 'person_history'))
    ORDER BY name
  `);
  console.table(tables.rows);

  const club = await db.execute({
    sql: `SELECT database_slug, name,
                 json_extract(raw_json, '$.division_name') AS division_name
          FROM clubs WHERE name = ? ORDER BY database_slug`,
    args: ["Real Madrid C.F."],
  });
  console.table(club.rows);

  const leaguePlayers = await db.execute({
    sql: `SELECT count(*) AS players
          FROM player_search ps
          WHERE ps.database_slug = ?
            AND ps.club_name IN (
              SELECT c.name FROM clubs c
              WHERE c.database_slug = ?
                AND json_extract(c.raw_json, '$.division_name') = ?
            )`,
    args: ["cm0001_vanilla_original", "cm0001_vanilla_original", "Spanish First Division"],
  });
  console.table(leaguePlayers.rows);
} finally {
  db.close();
}
