import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const sources = {
  cm0203_vanilla_original: resolve("02-03 dat", "cm4-metadata.json"),
  cm0304_vanilla_original: resolve("03-04 dat", "cm4-cache.json"),
};
const output = {};

for (const [slug, path] of Object.entries(sources)) {
  const data = JSON.parse(readFileSync(path, "utf8"));
  output[slug] = Object.fromEntries(
    data.clubs
      .filter((club) => club?.[1] && club?.[3])
      .map((club) => [String(club[1]), String(club[3])]),
  );
}

writeFileSync(
  resolve("worker", "src", "league-map.json"),
  `${JSON.stringify(output)}\n`,
  "utf8",
);

console.log(
  Object.entries(output)
    .map(([slug, clubs]) => `${slug}: ${Object.keys(clubs).length} mapped clubs`)
    .join("\n"),
);
