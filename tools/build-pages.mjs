import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(".");
const output = join(root, "docs");

const frontendFiles = [
  "index.html",
  "database.html",
  "draft.html",
  "draft.js",
  "draft-setup.html",
  "draft-setup.js",
  "draft-run.html",
  "draft-run.js",
  "draft-squad.html",
  "draft-squad.js",
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
  "BaiJamjuree-SemiBold.ttf",
];

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });

for (const file of frontendFiles) {
  await cp(join(root, file), join(output, file));
}

await cp(join(root, "img"), join(output, "img"), { recursive: true });
await cp(join(root, "src"), join(output, "src"), { recursive: true });
// Only the compressed, versioned sample packs -- never sounds/ itself,
// which also holds the raw ~155MB WAV source library this deploy has no
// use for. v1 is tools/convert-sounds.mjs's output; v2 is a second pack
// added directly (see src/lib/matchSound.js's SOUND_BANK header comment).
await cp(join(root, "sounds", "v1"), join(output, "sounds", "v1"), { recursive: true });
await cp(join(root, "sounds", "v2"), join(output, "sounds", "v2"), { recursive: true });

for (const htmlFile of ["database.html", "draft-setup.html"]) {
  const pagesHtmlPath = join(output, htmlFile);
  const html = await readFile(pagesHtmlPath, "utf8");
  await writeFile(
    pagesHtmlPath,
    html.replace(
      '<meta name="retroball-api-url" content="/local-api">',
      '<meta name="retroball-api-url" content="https://retroball-api.umutnaderi.workers.dev">',
    ),
  );
}

await writeFile(join(output, ".nojekyll"), "");

console.log(`GitHub Pages package written to ${output}`);
