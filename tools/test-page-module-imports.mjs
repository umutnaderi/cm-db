// Catch a page module calling a library helper it never imported.
//
//   npm run test:page-imports
//
// This is a class of bug the whole existing suite cannot see. The page modules
// (draft-setup.js, match-lab.js, ...) only ever run in a browser, so a missing
// import is not a build error and not a test failure -- it is a ReferenceError
// thrown at the moment the feature is used, in production.
//
// It shipped exactly that way: draft-setup.js called generatedSidePreference()
// while the function was still module-private inside positionFit.js, and the
// whole dice roll died with "generatedSidePreference is not defined" as soon as
// a candidate carrying a position_text was rendered.
//
// The check is deliberately narrow, because a general "is this identifier
// defined" pass over untyped JS is a linter and would be noisy. It asks one
// precise question: does this page CALL a name that one of our own src/lib
// modules exports, without importing it and without declaring it locally?
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const LIB_DIR = join(ROOT, "src", "lib");
const PAGE_MODULES = [
  "draft-setup.js", "draft-run.js", "draft-squad.js", "draft.js",
  "match-lab.js", "app.js",
];

const NEWLINE = String.fromCharCode(10);

/**
 * Blank out comments and string/template literals, preserving line numbers.
 *
 * Without this the scan reads prose. match-lab.js documents its own
 * collaborators in comments -- "the real arrival race (claimable(), ..." --
 * and the first version of this tool reported fifteen of those as missing
 * imports. A checker that cries wolf on comments is worse than no checker.
 */
function stripNonCode(source) {
  const blank = (text) => text.split("").map((ch) => (ch === NEWLINE ? ch : " ")).join("");
  let out = "";
  let index = 0;
  while (index < source.length) {
    const two = source.slice(index, index + 2);
    if (two === "//") {
      const end = source.indexOf(NEWLINE, index);
      const stop = end === -1 ? source.length : end;
      out += blank(source.slice(index, stop));
      index = stop;
    } else if (two === "/*") {
      const end = source.indexOf("*/", index + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += blank(source.slice(index, stop));
      index = stop;
    } else if (source[index] === '"' || source[index] === "'" || source[index] === "`") {
      const quote = source[index];
      let cursor = index + 1;
      while (cursor < source.length) {
        if (source[cursor] === "\\") { cursor += 2; continue; }
        if (source[cursor] === quote) { cursor += 1; break; }
        cursor += 1;
      }
      out += blank(source.slice(index, cursor));
      index = cursor;
    } else {
      out += source[index];
      index += 1;
    }
  }
  return out;
}

/** Every name exported by our own library modules, and which file owns it. */
function libraryExports() {
  const owners = new Map();
  for (const file of readdirSync(LIB_DIR).filter((name) => name.endsWith(".js"))) {
    const source = readFileSync(join(LIB_DIR, file), "utf8");
    const named = [
      ...source.matchAll(/^export\s+(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm),
      ...source.matchAll(/^export\s+(?:const|let|class)\s+([A-Za-z_$][\w$]*)/gm),
    ].map((match) => match[1]);
    for (const name of named) if (!owners.has(name)) owners.set(name, file);
  }
  return owners;
}

/** Names this module pulls in through any import statement. */
function importedNames(source) {
  const names = new Set();
  for (const match of source.matchAll(/import\s*\{([^}]*)\}\s*from/g)) {
    for (const part of match[1].split(",")) {
      const cleaned = part.trim().split(/\s+as\s+/).pop()?.trim();
      if (cleaned) names.add(cleaned);
    }
  }
  for (const match of source.matchAll(/import\s+(?:\*\s+as\s+)?([A-Za-z_$][\w$]*)\s*(?:,|from)/g)) {
    names.add(match[1]);
  }
  return names;
}

/** Names this module declares itself, at any nesting depth. */
function declaredNames(source) {
  const names = new Set();
  for (const pattern of [
    /(?:^|[^.\w$])(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/g,
    /(?:^|[^.\w$])(?:const|let|var|class)\s+([A-Za-z_$][\w$]*)/g,
  ]) {
    for (const match of source.matchAll(pattern)) names.add(match[1]);
  }
  return names;
}

const owners = libraryExports();
let failures = 0;
let checked = 0;

console.log(`Page module import check -- ${owners.size} library exports, ${PAGE_MODULES.length} pages`);
console.log("");

for (const page of PAGE_MODULES) {
  let source;
  try { source = readFileSync(join(ROOT, page), "utf8"); }
  catch { console.log(`  SKIP  ${page} (not present)`); continue; }
  checked += 1;

  const code = stripNonCode(source);
  const imported = importedNames(source);
  const declared = declaredNames(code);
  const problems = [];
  for (const match of code.matchAll(/(?<![.\w$])([A-Za-z_$][\w$]*)\s*\(/g)) {
    const name = match[1];
    if (!owners.has(name) || imported.has(name) || declared.has(name)) continue;
    if (problems.some((problem) => problem.name === name)) continue;
    problems.push({
      name,
      line: code.slice(0, match.index).split(NEWLINE).length,
      owner: owners.get(name),
    });
  }

  if (!problems.length) { console.log(`  PASS  ${page}`); continue; }
  failures += problems.length;
  console.log(`  FAIL  ${page}`);
  for (const problem of problems) {
    console.log(`          ${page}:${problem.line} calls ${problem.name}() `
      + `-- exported by src/lib/${problem.owner}, never imported here`);
  }
}

console.log("");
console.log(failures
  ? `${failures} missing import(s) across ${checked} page module(s)`
  : `ALL PASS -- ${checked} page modules import everything they call`);
if (failures) process.exitCode = 1;
