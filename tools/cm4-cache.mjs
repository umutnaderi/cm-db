import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";

const databasePath = process.argv[2] || "03-04 dat";
const root = resolve(".");
const databaseRoot = resolve(root, databasePath);
const outputPath = process.argv[3]
  ? resolve(root, process.argv[3])
  : join(databaseRoot, "cm4-cache.json");

if (!existsSync(databaseRoot)) {
  console.error(`Database folder not found: ${databaseRoot}`);
  process.exit(1);
}

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
  stdio: "inherit",
  windowsHide: true
});

process.exit(result.status ?? 1);
