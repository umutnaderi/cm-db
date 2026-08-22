import {
  reachIn, reigniteFactor, timeToTopSpeed, topSpeed, touchError,
  touchThreshold, turnRetention,
} from "../src/lib/playerKinetics.js";
import { planCarryTouches, yardDistance } from "../src/lib/spatialDecision.js";

function option(name, fallback = null) {
  const index = process.argv.indexOf(`--${name}`);
  const npmValue = process.env[`npm_config_${name.replaceAll("-", "_")}`];
  return index >= 0
    ? process.argv[index + 1]
    : npmValue && npmValue !== "true" ? npmValue : fallback;
}

// npm 11 on Windows currently rewrites `npm run x -- --runs 50 --attr Pace`
// to positional `50 Pace` arguments while exposing each flag as boolean
// npm_config_* state. Accept both the documented flags and that rewrite.
const positional = process.argv.slice(2).filter((value) => !value.startsWith("--"));
const positionalAttribute = positional.find((value) => [
  "pace", "acceleration", "agility", "dribbling", "technique", "all",
].includes(value.toLowerCase()));
const positionalRuns = positional.find((value) => /^\d+$/.test(value));
const requested = option("attr", positionalAttribute || "all").toLowerCase();
const values = option("values", "1,5,10,15,20").split(",").map(Number).filter(Number.isFinite);
const runs = Math.max(1, Number(option("runs", positionalRuns || "500")) || 500);
const supported = ["pace", "acceleration", "agility", "dribbling", "technique"];
const attributes = requested === "all" ? supported : [requested];
if (attributes.some((name) => !supported.includes(name))) {
  throw new Error(`Unsupported attribute '${requested}'. Use ${supported.join(", ")}, or all.`);
}

function player(overrides = {}) {
  const ratings = { Pace: 10, Acceleration: 10, Agility: 10, Dribbling: 10, Technique: 10, ...overrides };
  return {
    current_ability: 100,
    attributes: Object.entries(ratings).map(([label, value]) => ({ label, value })),
  };
}

function monotonic(rows, key, direction = "up") {
  return rows.slice(1).every((row, index) => direction === "up"
    ? row[key] >= rows[index][key]
    : row[key] <= rows[index][key]);
}

function carryMetrics(candidate, value) {
  const from = { x: 43, y: 72 };
  const to = { x: 62, y: 34 };
  let touches = 0;
  let deviation = 0;
  for (let run = 0; run < runs; run += 1) {
    const path = planCarryTouches(from, to, "jog", {
      player: candidate, pressure: 0.55, seed: `attribute-sweep:${run}`,
    });
    touches += path.length + 1;
    deviation += path.reduce((sum, point) => sum + Math.abs(point.kinetics?.lateralErrorYards || 0), 0);
  }
  return {
    touches: touches / runs,
    touchYards: touchThreshold(candidate, "jog"),
    deviation: deviation / runs,
    distance: yardDistance(from, to),
  };
}

for (const attribute of attributes) {
  const label = attribute[0].toUpperCase() + attribute.slice(1);
  const rows = values.map((value) => {
    const candidate = player({ [label]: value });
    const carry = carryMetrics(candidate, value);
    return {
      value,
      topSpeed: topSpeed(candidate),
      timeToTop: timeToTopSpeed(candidate),
      reach08: reachIn(candidate, 0.8),
      reach4: reachIn(candidate, 4),
      turn90: turnRetention(candidate, 90),
      reignite: reigniteFactor(candidate),
      touches: carry.touches,
      touchYards: carry.touchYards,
      errorDeg: touchError(candidate, 0.55).angleDeg,
      pathError: carry.deviation,
    };
  });
  console.log(`\n${label} sweep — ${runs} fixed-seed carries per value`);
  console.table(rows.map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [
    key, typeof value === "number" ? Number(value.toFixed(3)) : value,
  ]))));
  const check = attribute === "pace"
    ? monotonic(rows, "reach4")
    : attribute === "acceleration"
      ? monotonic(rows, "reach08") && monotonic(rows, "timeToTop", "down")
      : attribute === "agility"
        ? monotonic(rows, "turn90") && monotonic(rows, "reignite")
        : attribute === "dribbling"
          ? monotonic(rows, "touches") && monotonic(rows, "touchYards", "down") && monotonic(rows, "pathError", "down")
          : monotonic(rows, "pathError", "down");
  console.log(`monotonic: ${check ? "yes" : "NO"}`);
  if (!check) process.exitCode = 1;
}
