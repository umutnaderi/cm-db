import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(".");
const output = join(root, "docs");

const frontendFiles = [
  "index.html",
  "database.html",
  "draft.html",
  "draft-setup.html",
  "draft-setup.js",
  "styles.css",
  "MadeleinaSans.otf",
  "orpheis.regular.otf",
  "Comfortaa-Bold.ttf",
  "Comfortaa-Light.ttf",
  "Comfortaa-Regular.ttf",
  "AgenorNeue-Regular.otf",
  "Bandung Hardcore GP.otf",
  "TitilliumWeb-SemiBold.ttf",
  "TitilliumWeb-Regular.ttf",
  "TitilliumWeb-SemiBoldItalic.ttf",
  "TitilliumWeb-Bold.ttf",
  "TitilliumWeb-BoldItalic.ttf",
  "BaiJamjuree-Medium.ttf",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of frontendFiles) {
  await cp(join(root, file), join(output, file));
}

await cp(join(root, "img"), join(output, "img"), { recursive: true });
await cp(join(root, "src"), join(output, "src"), { recursive: true });
await writeFile(join(output, ".nojekyll"), "");

console.log(`GitHub Pages package written to ${output}`);
