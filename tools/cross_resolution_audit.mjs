// Cross Resolution telemetry -- see MATCH_LAB_PLAN.md, "Cross Resolution
// and Dynamic Off-Ball Movement." Explicit instruction: report every
// conditional rate separately, do NOT tune the final goal percentage
// until every stage exists and we know which one is actually suppressing
// conversion. This reports exactly the stages Pass A (source contest +
// delivery) and the pre-existing aerial/header/save chain produce today;
// every Pass B/C-only metric (keeper claim decisions, attacker/defender
// arrival, recovery) is listed explicitly as NOT YET BUILT rather than
// silently omitted, so the report's own shape tracks the real engine as
// it grows instead of needing to be redesigned later.
//
// Calls match-lab.js's resolveCross() directly (the same fake-DOM stub
// tools/test-cross-resolution.mjs uses) across many constructed
// geometries -- not a full match simulation, since Cross Resolution Pass
// A isn't wired into draft-run.js at all yet (Match Lab only). Skill-tier
// pairings, not one flat rate: a single aggregate number would hide which
// tier the interesting behavior is actually happening at, the same
// principle tools/keeper_save_audit.mjs and tools/one_on_one_action_audit.mjs
// already established for this codebase.
//
// Usage: node tools/cross_resolution_audit.mjs [runsPerPairing]
//   npm run cross:audit  (defaults to 2000 runs per pairing)

function fakeStyle() {
  return { setProperty() {}, removeProperty() {}, getPropertyValue() { return ""; } };
}
function fakeClassList() {
  const set = new Set();
  return {
    add: (...names) => names.forEach((name) => set.add(name)),
    remove: (...names) => names.forEach((name) => set.delete(name)),
    toggle(name, force) {
      if (force === undefined) { set.has(name) ? set.delete(name) : set.add(name); }
      else if (force) set.add(name);
      else set.delete(name);
    },
    contains: (name) => set.has(name),
  };
}
function fakeElement() {
  const el = {
    className: "", style: fakeStyle(), dataset: {}, classList: fakeClassList(), children: [], parentNode: null,
    value: "", textContent: "", innerHTML: "", hidden: false,
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
    setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; },
    querySelector(selector) {
      const idMatch = /\[data-id="([^"]+)"\]/.exec(selector || "");
      if (idMatch) return el.children.find((child) => child.dataset && child.dataset.id === idMatch[1]) || null;
      return fakeElement();
    },
    querySelectorAll(selector) {
      const classMatch = /^\.([\w-]+)$/.exec(selector || "");
      if (classMatch) return el.children.filter((child) => (child.className || "").split(/\s+/).includes(classMatch[1]));
      return [];
    },
    appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
    removeChild(child) { const i = el.children.indexOf(child); if (i >= 0) el.children.splice(i, 1); return child; },
    remove() { if (el.parentNode) el.parentNode.removeChild(el); },
    replaceChildren() { el.children = []; },
    focus() {}, click() {},
  };
  return el;
}
globalThis.document = {
  querySelector() { return fakeElement(); }, querySelectorAll() { return []; },
  createElement() { return fakeElement(); }, addEventListener() {}, body: fakeElement(),
};
globalThis.window = globalThis;
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = globalThis.requestAnimationFrame || ((fn) => setTimeout(fn, 0));
globalThis.cancelAnimationFrame = globalThis.cancelAnimationFrame || ((id) => clearTimeout(id));
globalThis.fetch = async () => { throw new Error("network disabled in this audit"); };

const { resolveCross, zoneFromPercent } = await import("../match-lab.js");
const { hashString, seededRandom } = await import("../src/lib/matchEngineCore.js");

const runsPerPairing = Number(process.argv[2]) || 2000;

function attrs(pairs) { return Object.entries(pairs).map(([label, value]) => ({ label, value })); }
function player(name, overrides) { return { canonical_player_name: name, current_ability: 150, attributes: attrs(overrides) }; }
function entry(id, { team, x, y, playerObj, role = "player" }) {
  return { id, role, team, player: playerObj, x, y, zone: zoneFromPercent(x, y) };
}

const CROSSERS = {
  elite: player("Elite Crosser", { Crossing: 18, Technique: 17, Decisions: 16, Composure: 16, Balance: 16 }),
  average: player("Average Crosser", { Crossing: 12, Technique: 12, Decisions: 12, Composure: 12, Balance: 12 }),
  weak: player("Weak Crosser", { Crossing: 6, Technique: 7, Decisions: 6, Composure: 6, Balance: 7 }),
};
const SOURCE_DEFENDERS = {
  elite: player("Elite Source Defender", { Tackling: 17, Positioning: 17, Anticipation: 16, Aggression: 13, Bravery: 15 }),
  average: player("Average Source Defender", { Tackling: 12, Positioning: 12, Anticipation: 12, Aggression: 11, Bravery: 11 }),
  weak: player("Weak Source Defender", { Tackling: 6, Positioning: 6, Anticipation: 6, Aggression: 8, Bravery: 8 }),
};
const RECEIVERS = {
  elite: player("Elite Receiver", { Heading: 17, Jumping: 16, Anticipation: 16, Finishing: 15, "Off the Ball": 16 }),
  average: player("Average Receiver", { Heading: 12, Jumping: 12, Anticipation: 12, Finishing: 12, "Off the Ball": 12 }),
};
const AERIAL_DEFENDERS = {
  elite: player("Elite Aerial Defender", { Heading: 17, Jumping: 17, Positioning: 16, Strength: 16, Anticipation: 16 }),
  average: player("Average Aerial Defender", { Heading: 12, Jumping: 12, Positioning: 12, Strength: 12, Anticipation: 12 }),
};
const KEEPERS = {
  elite: player("Elite Keeper", { Reflexes: 18, Positioning: 17, Handling: 17, Agility: 16, Anticipation: 16 }),
};

function runPairing(sourceDefenderTier, crosserTier, label) {
  const crosser = entry("crosser", { team: "home", x: 85, y: 62, playerObj: CROSSERS[crosserTier] });
  const receiver = entry("receiver", { team: "home", x: 50, y: 90, playerObj: RECEIVERS.average });
  const sourceDefender = entry("source-def", { team: "away", x: 82, y: 65, playerObj: SOURCE_DEFENDERS[sourceDefenderTier] });
  const aerialDefender = entry("aerial-def", { team: "away", x: 49, y: 89, playerObj: AERIAL_DEFENDERS.average });
  const keeper = entry("keeper", { team: "away", role: "keeper", x: 50, y: 97, playerObj: KEEPERS.elite });
  const groups = { owner: crosser, teammates: [receiver], opponents: [sourceDefender, aerialDefender], keeper };

  const tally = {
    crossAttempts: 0, sourceTackled: 0, sourceBlockedBehind: 0, sourceBlockedLoose: 0,
    sourcePressured: 0, sourceClean: 0, deliveriesReachingTarget: 0,
    accurateDeliveries: 0, // quality >= 0.6, a rough illustrative threshold, not a calibrated one
    attackerFirstContact: 0, defenderFirstContact: 0, headerAttempts: 0, headerOnTarget: 0,
    keeperCatches: 0, reboundChances: 0, goals: 0,
  };
  for (let i = 0; i < runsPerPairing; i += 1) {
    const random = seededRandom(hashString(`cross-audit-${label}-${i}`));
    const trace = [];
    const result = resolveCross(groups, {}, random, trace);
    tally.crossAttempts += 1;
    const sourceEvent = trace.find((event) => event.code.startsWith("CROSS.SOURCE."));
    if (sourceEvent) {
      if (sourceEvent.code === "CROSS.SOURCE.TACKLED") tally.sourceTackled += 1;
      else if (sourceEvent.code === "CROSS.SOURCE.BLOCKED_BEHIND") tally.sourceBlockedBehind += 1;
      else if (sourceEvent.code === "CROSS.SOURCE.BLOCKED_LOOSE") tally.sourceBlockedLoose += 1;
      else if (sourceEvent.code === "CROSS.SOURCE.PRESSURED") tally.sourcePressured += 1;
      else if (sourceEvent.code === "CROSS.SOURCE.CLEAN") tally.sourceClean += 1;
    }
    const deliveryEvent = trace.find((event) => event.code === "CROSS.DELIVERY");
    if (deliveryEvent) {
      tally.deliveriesReachingTarget += 1;
      const qualityMatch = /\((\d+)% quality\)/.exec(deliveryEvent.label);
      if (qualityMatch && Number(qualityMatch[1]) >= 60) tally.accurateDeliveries += 1;
    }
    if (trace.some((event) => event.code === "X1.R")) tally.attackerFirstContact += 1;
    if (trace.some((event) => event.code === "X1.D")) tally.defenderFirstContact += 1;
    const headerEvent = trace.find((event) => event.movement === "header");
    if (headerEvent) {
      tally.headerAttempts += 1;
      if (headerEvent.outcome === "success") tally.headerOnTarget += 1;
    }
    if (result.reason === "keeper-catch") tally.keeperCatches += 1;
    if (trace.some((event) => event.code === "REBOUND.WON" || event.code === "REBOUND.LOST")) tally.reboundChances += 1;
    if (result.outcome === "GOAL") tally.goals += 1;
  }
  return tally;
}

function pct(numerator, denominator) {
  return denominator > 0 ? `${((numerator / denominator) * 100).toFixed(1)}%` : "n/a";
}

console.log(`Cross Resolution telemetry -- ${runsPerPairing} runs per pairing\n`);
console.log("Pass A + existing aerial/header/save chain (real, measured below).");
console.log("Pass B (dynamic aerial positioning, defender recovery) and Pass C");
console.log("(goalkeeper command of crosses) are NOT YET BUILT -- their own");
console.log("metrics (keeper claim decisions, clean claims, punches, mishandles,");
console.log("attacker/defender arrival quality) are listed as N/A below, not");
console.log("silently omitted, so this report's shape already matches where");
console.log("those numbers will need to go once those passes land.\n");

for (const sourceTier of ["elite", "average", "weak"]) {
  for (const crosserTier of ["elite", "average", "weak"]) {
    const label = `${sourceTier}-source-def_vs_${crosserTier}-crosser`;
    const t = runPairing(sourceTier, crosserTier, label);
    console.log(`--- Source defender: ${sourceTier} | Crosser: ${crosserTier} ---`);
    console.log(`  cross attempts:              ${t.crossAttempts}`);
    console.log(`  source: tackled before cross: ${pct(t.sourceTackled, t.crossAttempts)}`);
    console.log(`  source: blocked (behind):     ${pct(t.sourceBlockedBehind, t.crossAttempts)}`);
    console.log(`  source: blocked (loose):      ${pct(t.sourceBlockedLoose, t.crossAttempts)}`);
    console.log(`  source: pressured, escapes:   ${pct(t.sourcePressured, t.crossAttempts)}`);
    console.log(`  source: clean (no effect):    ${pct(t.sourceClean, t.crossAttempts)}`);
    console.log(`  deliveries reaching a landing point: ${pct(t.deliveriesReachingTarget, t.crossAttempts)}`);
    console.log(`  accurate deliveries (quality>=60%), of deliveries: ${pct(t.accurateDeliveries, t.deliveriesReachingTarget)}`);
    console.log(`  keeper claim decisions:       N/A -- Pass C not built`);
    console.log(`  clean claims / punches / mishandles: N/A -- Pass C not built`);
    console.log(`  attacker first contact (X1.R), of deliveries: ${pct(t.attackerFirstContact, t.deliveriesReachingTarget)}`);
    console.log(`  defender first contact (X1.D), of deliveries: ${pct(t.defenderFirstContact, t.deliveriesReachingTarget)}`);
    console.log(`  (Pass B note: attacker/defender arrival quality currently NOT modeled -- static authored positions only)`);
    console.log(`  header/shot attempts:         ${t.headerAttempts}`);
    console.log(`  on-target, of attempts:       ${pct(t.headerOnTarget, t.headerAttempts)}`);
    console.log(`  keeper catches, of on-target: ${pct(t.keeperCatches, t.headerOnTarget)}`);
    console.log(`  rebound chances, of on-target: ${pct(t.reboundChances, t.headerOnTarget)}`);
    console.log(`  GOALS, of cross attempts:     ${pct(t.goals, t.crossAttempts)}`);
    console.log("");
  }
}

console.log("Per explicit instruction: do not tune the final goal percentage from");
console.log("this report. Its purpose is to show WHICH stage is suppressing");
console.log("conversion once every stage (including Pass B/C) exists -- reading it");
console.log("as a calibration target before then would be premature.");
