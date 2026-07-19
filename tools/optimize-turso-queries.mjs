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

try {
  const started = performance.now();
  await db.batch([
    "DROP INDEX IF EXISTS idx_player_search_name",
    `CREATE INDEX idx_player_search_name
       ON player_search(database_slug, full_name COLLATE NOCASE)`,
  ], "write");
  console.log(`Optimized player name ordering in ${((performance.now() - started) / 1000).toFixed(1)} s.`);
} finally {
  db.close();
}
