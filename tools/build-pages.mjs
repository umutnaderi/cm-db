import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

const root = resolve(".");
const output = join(root, "docs");

const databases = [
  {
    name: "96-97 dat",
    path: "96-97 dat",
    format: "cm2early",
    files: ["PLDATA1.DB1", "PLDATA2.DB1", "TMDATA.DB1", "MGDATA.DB1"],
  },
  {
    name: "97-98 dat",
    path: "97-98 dat",
    format: "cm2",
    files: ["PLAYERS.DB1", "TMDATA.DB1"],
  },
  {
    name: "99-00 dat",
    path: "99-00 dat",
    format: "modern",
    files: [
      "index.dat",
      "staff.dat",
      "staff_history.dat",
      "club.dat",
      "club_comp.dat",
      "nation.dat",
      "first_names.dat",
      "second_names.dat",
      "common_names.dat",
    ],
  },
  {
    name: "00-01 dat",
    path: "00-01 dat",
    format: "modern",
    files: [
      "index.dat",
      "staff.dat",
      "staff_history.dat",
      "club.dat",
      "club_comp.dat",
      "nation.dat",
      "first_names.dat",
      "second_names.dat",
      "common_names.dat",
    ],
  },
  {
    name: "01-02 dat",
    path: "01-02 dat",
    format: "modern",
    files: [
      "index.dat",
      "staff.dat",
      "staff_history.dat",
      "club.dat",
      "club_comp.dat",
      "nation.dat",
      "first_names.dat",
      "second_names.dat",
      "common_names.dat",
    ],
  },
  {
    name: "03-04 dat",
    path: "03-04 dat",
    format: "cm4",
    files: ["cm4-cache.json"],
  },
];

const frontendFiles = [
  "index.html",
  "app.js",
  "styles.css",
  "MadeleinaSans.otf",
  "orpheis.regular.otf",
  "Comfortaa-Bold.ttf",
  "Comfortaa-Light.ttf",
  "Comfortaa-Regular.ttf",
  "AgenorNeue-Regular.otf",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of frontendFiles) {
  await cp(join(root, file), join(output, file));
}

for (const database of databases) {
  for (const file of database.files) {
    const destination = join(output, database.path, file);
    await mkdir(dirname(destination), { recursive: true });
    await cp(join(root, database.path, file), destination);
  }
}

await writeFile(
  join(output, "databases.json"),
  `${JSON.stringify(databases.map(({ name, path, format }) => ({ name, path, format })), null, 2)}\n`,
);
await writeFile(join(output, ".nojekyll"), "");

console.log(`GitHub Pages package written to ${output}`);
