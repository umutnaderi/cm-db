import { createClient } from "../worker/node_modules/@libsql/client/lib-esm/node.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

const root = resolve(".");
const varsPath = existsSync(resolve(root, "worker", ".devs.vars"))
  ? resolve(root, "worker", ".devs.vars")
  : resolve(root, "worker", ".dev.vars");

function readVars(path) {
  return Object.fromEntries(
    readFileSync(path, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        return [line.slice(0, index), line.slice(index + 1).replace(/^[\"']|[\"']$/g, "")];
      }),
  );
}

const vars = readVars(varsPath);
if (!vars.TURSO_DATABASE_URL || !vars.TURSO_AUTH_TOKEN) {
  throw new Error("Missing TURSO_DATABASE_URL or TURSO_AUTH_TOKEN in worker vars.");
}

const db = createClient({
  url: vars.TURSO_DATABASE_URL,
  authToken: vars.TURSO_AUTH_TOKEN,
});

async function timed(label, statement) {
  const started = performance.now();
  const result = await db.execute(statement);
  console.log(`${label}: ${(performance.now() - started).toFixed(0)} ms (${result.rows.length} rows)`);
  return result;
}

try {
  const indexes = await timed("index inventory", `
    SELECT name, tbl_name, sql
    FROM sqlite_master
    WHERE type = 'index'
      AND tbl_name IN ('player_search', 'player_search_terms', 'player_search_fts')
    ORDER BY tbl_name, name
  `);
  console.table(indexes.rows);

  const schemas = await timed("search table schemas", `
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'table'
      AND name IN ('player_search', 'player_search_terms', 'player_search_fts')
    ORDER BY name
  `);
  console.table(schemas.rows);

  const counts = await timed("season counts", `
    SELECT database_slug, count(*) AS players
    FROM player_search
    GROUP BY database_slug
    ORDER BY database_slug
  `);
  console.table(counts.rows);

  const statements = [
    {
      label: "unfiltered first page",
      sql: `SELECT id, full_name FROM player_search
            WHERE database_slug = ?
            ORDER BY full_name
            LIMIT 40`,
      args: ["cm0304"],
    },
    {
      label: "prefix search",
      sql: `SELECT ps.id, ps.full_name
            FROM player_search ps
            JOIN player_search_fts f ON f.rowid = ps.id
            WHERE player_search_fts MATCH ?
              AND ps.database_slug = ?
            ORDER BY coalesce(ps.current_ability, 0) DESC, ps.full_name COLLATE NOCASE
            LIMIT 40`,
      args: ["ronaldo*", "cm0304"],
    },
  ];

  for (const statement of statements) {
    const plan = await timed(`${statement.label} plan`, {
      sql: `EXPLAIN QUERY PLAN ${statement.sql}`,
      args: statement.args,
    });
    console.table(plan.rows);
    await timed(statement.label, statement);
  }

  const ftsCount = await timed("prefix match count", {
    sql: "SELECT count(*) AS count FROM player_search_fts WHERE player_search_fts MATCH ?",
    args: ["ronaldo*"],
  });
  console.table(ftsCount.rows);

  await timed("prefix rowids only", {
    sql: "SELECT rowid FROM player_search_fts WHERE player_search_fts MATCH ? LIMIT 40",
    args: ["ronaldo*"],
  });

  const nameSearch = {
    sql: `SELECT full_name, display_name
          FROM player_search
          WHERE database_slug = ?
            AND lower(coalesce(search_blob, '')) LIKE ?
            AND lower(coalesce(search_blob, '')) LIKE ?
          ORDER BY coalesce(current_ability, 0) DESC, full_name
          LIMIT 40`,
    args: ["cm9900_vanilla_original", "%zinedine%", "%zidane%"],
  };
  const namePlan = await timed("season name search plan", {
    sql: `EXPLAIN QUERY PLAN ${nameSearch.sql}`,
    args: nameSearch.args,
  });
  console.table(namePlan.rows);
  const names = await timed("season name search", nameSearch);
  console.table(names.rows);

} finally {
  db.close();
}
