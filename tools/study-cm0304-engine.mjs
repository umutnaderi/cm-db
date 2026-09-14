// Study CM 03/04's match engine from its own shipped data files.
//
//   node tools/study-cm0304-engine.mjs [install path] [--json out.json]
//
// Reverse engineering for study, not for reuse. Nothing here copies CM code or
// data into this project: it reads an installed copy, decodes the numeric
// model, and reports the SHAPE of the design so ours can be argued about
// against a known-good reference. See CM0304_ENGINE_STUDY.md for the findings.
//
// Deliberately data-first rather than binary-first. cm0304.exe is one
// monolithic MSVC-optimised x86 image with inlined STL, and pulling algorithms
// out of that is a disproportionate amount of work for what it would return.
// The lookup tables and the event config, by contrast, ARE the design, sitting
// in plain files: they say exactly what the engine treated as primitive.
import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";

const DEFAULT_INSTALL = "C:/Program Files (x86)/Championship Manager 03-04";
const install = process.argv[2] && !process.argv[2].startsWith("--") ? process.argv[2] : DEFAULT_INSTALL;
const jsonIndex = process.argv.indexOf("--json");
const jsonOut = jsonIndex >= 0 ? process.argv[jsonIndex + 1] : "";

if (!existsSync(install)) {
  console.error(`No CM 03/04 install at ${install}`);
  console.error("Pass the install directory as the first argument.");
  process.exit(1);
}

// Every .mdt begins with a 12-byte header: a UTF-16 ".mdt" tag, a version
// byte, then padding. The body is little-endian int32 unless noted.
const MDT_HEADER_BYTES = 12;
function readTable(name, { int16 = false } = {}) {
  const path = join(install, "data", "tables", name);
  if (!existsSync(path)) return null;
  const buffer = readFileSync(path).subarray(MDT_HEADER_BYTES);
  const width = int16 ? 2 : 4;
  const count = Math.floor(buffer.length / width);
  const values = new Array(count);
  for (let index = 0; index < count; index += 1) {
    values[index] = int16 ? buffer.readInt16LE(index * width) : buffer.readInt32LE(index * width);
  }
  return values;
}

const findings = { install, tables: {}, events: {} };
const report = [];

// --- the numeric model ------------------------------------------------------
const direction = readTable("direction_table.mdt");
const speedDirection = readTable("speed_direction_table.mdt");
const sqrtTable = readTable("si_sqrt_table.mdt");
const distanceAngle = readTable("distance_angle_table.mdt");
const distanceLookup = readTable("distance_lookup_table.mdt");
const angleLookup = readTable("angle_lookup_table.mdt", { int16: true });

if (direction) {
  // Verified: entry a is (sin a, cos a) scaled by 2^14, at one-degree steps.
  const scale = Math.max(...direction);
  const error = Math.max(...Array.from({ length: 360 }, (unused, a) => Math.abs(
    direction[a * 2] - Math.round(Math.sin((a * Math.PI) / 180) * scale),
  )));
  findings.tables.direction = { entries: direction.length / 2, scale, maxSinError: error };
  report.push(`direction_table        ${direction.length / 2} angles, (sin,cos) x ${scale} (Q${Math.log2(scale)}), max error ${error}`);
}
if (speedDirection) {
  const scale = Math.max(...speedDirection);
  findings.tables.speedDirection = { entries: speedDirection.length / 2, scale };
  report.push(`speed_direction_table  ${speedDirection.length / 2} angles, (sin,cos) x ${scale} (Q${Math.log2(scale)})`);
}
if (sqrtTable) {
  let exact = true;
  for (const probe of [0, 1, 4, 100, 10000, sqrtTable.length - 1]) {
    if (sqrtTable[probe] !== Math.floor(Math.sqrt(probe))) exact = false;
  }
  findings.tables.sqrt = { entries: sqrtTable.length, max: Math.max(...sqrtTable), integerExact: exact };
  report.push(`si_sqrt_table          ${sqrtTable.length} entries, integer sqrt 0..${Math.max(...sqrtTable)}${exact ? " (exact)" : ""}`);
}
if (distanceAngle) {
  // [angle 0..359][radius 0..99] -> (sin-component, cos-component) * radius
  const probe = (a, r) => distanceAngle.slice((a * 100 + r) * 2, (a * 100 + r) * 2 + 2);
  findings.tables.distanceAngle = { angles: 360, radii: 100, sample: { a45r50: probe(45, 50) } };
  report.push(`distance_angle_table   360 angles x 100 radii -> offset pair; [45deg,r50]=${probe(45, 50)}`);
}
if (distanceLookup && angleLookup) {
  // A 400x300 grid centred at (200,150). distance is stored x10; angle is
  // atan2(dy,dx) in whole degrees.
  const W = 400; const H = 300; const CX = 200; const CY = 150;
  const at = (dx, dy) => (dy + CY) * W + (dx + CX);
  const distanceOk = distanceLookup[at(-CX, -CY)] === Math.round(Math.hypot(CX, CY) * 10);
  const bearing = angleLookup[at(-CX, -CY)];
  findings.tables.grid = {
    width: W, height: H, centre: [CX, CY],
    distanceScale: 10, distanceVerified: distanceOk,
    angleConvention: "atan2(dy,dx) in whole degrees", cornerAngle: bearing,
  };
  report.push(`distance_lookup_table  ${W}x${H} grid centred (${CX},${CY}), distance x10${distanceOk ? " (verified)" : ""}`);
  report.push(`angle_lookup_table     same grid, atan2(dy,dx) whole degrees, 0..359`);
}

// --- the action vocabulary ---------------------------------------------------
const eventsPath = join(install, "data", "match events", "events.cfg");
if (existsSync(eventsPath)) {
  const text = readFileSync(eventsPath).toString("utf16le");
  const names = text.split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith("#") && line.slice(1).trim().startsWith("EVENT_"))
    .map((line) => line.slice(1).trim().replace(/^EVENT_/, ""));

  // The pass vocabulary is not 130 hand-written actions -- it is a product.
  const FLIGHT = ["CHIP", "LOB", "SHORT", "MEDIUM"];
  const DIRECTION = ["FORWARD", "LEFT_WING", "RIGHT_WING", "LEFT", "RIGHT", "BACK", "INTO_AREA"];
  const factored = new Set();
  for (const flight of FLIGHT) {
    for (const dir of DIRECTION) {
      for (const firstTime of ["", "_FIRST_TIME"]) {
        for (const intoPath of ["", "_INTO_PATH"]) {
          factored.add(`PASS_${flight}_${dir}${firstTime}${intoPath}`);
        }
      }
    }
  }
  const passes = names.filter((name) => name.startsWith("PASS_"));
  const explained = passes.filter((name) => factored.has(name));
  const families = {};
  for (const name of names) {
    const key = name.split("_")[0];
    (families[key] ??= []).push(name);
  }
  findings.events = {
    total: names.length,
    families: Object.fromEntries(Object.entries(families)
      .sort((a, b) => b[1].length - a[1].length).map(([k, v]) => [k, v.length])),
    passFactorisation: {
      flight: FLIGHT, direction: DIRECTION, modifiers: ["FIRST_TIME", "INTO_PATH"],
      product: factored.size, explained: explained.length, total: passes.length,
      unexplained: passes.filter((name) => !factored.has(name)),
    },
    names,
  };
  report.push("");
  report.push(`events.cfg             ${names.length} events in ${Object.keys(families).length} families`);
  report.push(`  pass vocabulary      ${passes.length} total; ${explained.length} are exactly`);
  report.push(`                       flight(${FLIGHT.length}) x direction(${DIRECTION.length}) x first-time(2) x into-path(2)`);
  const top = Object.entries(families).sort((a, b) => b[1].length - a[1].length).slice(0, 8);
  report.push(`  largest families     ${top.map(([k, v]) => `${k} ${v.length}`).join(", ")}`);
}

console.log(`CM 03/04 match engine study -- ${install}\n`);
for (const line of report) console.log(line ? `  ${line}` : "");

if (jsonOut) {
  mkdirSync(dirname(jsonOut), { recursive: true });
  writeFileSync(jsonOut, `${JSON.stringify(findings, null, 2)}\n`);
  console.log(`\nWrote ${jsonOut}`);
}
