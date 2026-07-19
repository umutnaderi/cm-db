import { createClient } from "../worker/node_modules/@libsql/client/lib-esm/node.js";
import { resolve } from "node:path";

const db = createClient({ url: `file:${resolve("db", "retroball.sqlite")}` });
try {
  const tables = await db.execute(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`);
  console.log(tables.rows.map((row) => row.name).join(", "));
  for (const slug of ["cm0203_vanilla_original", "cm0203", "cm0304_vanilla_original", "cm0304"]) {
    for (const table of ["clubs", "competitions"]) {
      try {
        const result = await db.execute({
          sql: `SELECT * FROM ${table} WHERE database_slug = ? LIMIT 3`,
          args: [slug],
        });
        console.log(slug, table, result.rows.length, result.rows);
      } catch (error) {
        console.log(slug, table, error.message);
      }
    }
  }
} finally {
  db.close();
}
