import { createClient } from "../worker/node_modules/@libsql/client/lib-esm/node.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { performance } from "node:perf_hooks";

const root = resolve(".");
const varsPath = existsSync(resolve(root, "worker", ".devs.vars"))
  ? resolve(root, "worker", ".devs.vars")
  : resolve(root, "worker", ".dev.vars");
const vars = Object.fromEntries(
  readFileSync(varsPath, "utf8")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1).replace(/^[\"']|[\"']$/g, "")];
    }),
);
const db = createClient({ url: vars.TURSO_DATABASE_URL, authToken: vars.TURSO_AUTH_TOKEN });

try {
  const slugResult = await db.execute("SELECT DISTINCT database_slug FROM player_search ORDER BY database_slug");
  const slugs = slugResult.rows.map((row) => String(row.database_slug));
  const names = ["Zinedine Zidane"];
  const sql = `
    SELECT ps.database_slug, ps.source_person_id, ps.full_name, ps.display_name,
           ps.date_of_birth, ps.current_ability
    FROM player_search ps NOT INDEXED
    WHERE ps.database_slug IN (${slugs.map(() => "?").join(", ")})
      AND ps.full_name IN (${names.map(() => "?").join(", ")})
    ORDER BY ps.database_slug, coalesce(ps.current_ability, 0) DESC
  `;
  const plan = await db.execute({ sql: `EXPLAIN QUERY PLAN ${sql}`, args: [...slugs, ...names] });
  console.table(plan.rows);
  const started = performance.now();
  const result = await db.execute({ sql, args: [...slugs, ...names] });
  console.log(`Indexed badge candidates: ${(performance.now() - started).toFixed(0)} ms`);
  console.table(result.rows);
} finally {
  db.close();
}
