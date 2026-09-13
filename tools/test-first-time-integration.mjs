// Realism Roadmap Stage 1b -- first-time play inside the real engine.
//
// tools/test-first-time-play.mjs covers the pure model with no engine at all.
// This is the other half: it drives the ACTUAL possession runner over a real
// 11v11 and asserts the properties the integration is supposed to hold.
import "./match-lab-test-environment.mjs";
import { resolveCueSequence } from "../src/lib/matchSound.js";
import { findHistoricalSquad } from "../src/data/historicalSquads.js";
import { specAliases } from "../src/lib/historicalSquadResolver.js";

const {
  state, runConstructedPossession, applySetup, setupDraft, reassignSetupTeam, pointOf,
} = await import("../match-lab.js");

let passes = 0;
let failures = 0;
function check(label, condition) {
  if (condition) { passes += 1; console.log(`PASS -- ${label}`); }
  else { failures += 1; console.log(`FAIL -- ${label}`); }
}

const SHAPES = [
  ["GK", { goalkeeper: 20 }],
  ["D R", { defender: 20, "right side": 20, central: 12 }],
  ["D C", { defender: 20, central: 20 }],
  ["D C", { defender: 20, central: 20 }],
  ["D L", { defender: 20, "left side": 20, central: 12 }],
  ["DM C", { "defensive midfielder": 20, midfielder: 18, central: 20 }],
  ["M C", { midfielder: 20, central: 20 }],
  ["M L", { midfielder: 20, "left side": 20 }],
  ["M R", { midfielder: 20, "right side": 20 }],
  ["F C", { attacker: 20, central: 20 }],
  ["F C", { attacker: 20, central: 20 }],
];
function seedSquad(team, squadKey) {
  const squad = findHistoricalSquad(squadKey);
  const players = squad.players.map((spec, index) => {
    const [positionText, ratings] = SHAPES[index] ?? SHAPES[10];
    return {
      database_slug: squad.database,
      source_person_id: `${squadKey}-${index}`,
      canonical_player_name: specAliases(spec)[0] ?? `player-${index}`,
      position_text: positionText,
      current_ability: 160 - index,
      position_ratings: Object.entries(ratings).map(([label, value]) => ({ label, value })),
    };
  });
  state.resolvedSquads.set(squadKey, { players, squad });
  setupDraft()[team].squadKey = squadKey;
  reassignSetupTeam(team);
}

state.mode = "freeplay";
seedSquad("home", "titan-brazil-2002");
seedSquad("away", "titan-france-2000");
if (await applySetup() === false) throw new Error("could not apply a match setup");

const BASE_ROSTER = structuredClone(state.roster);
const STARTERS = BASE_ROSTER.filter((entry) => entry.team === "home" && entry.role !== "keeper").map((entry) => entry.id);

function runPossession(index, { maxActions = 12, matchSession = false } = {}) {
  state.roster = structuredClone(BASE_ROSTER);
  state.pendingRestart = null;
  state.restartSetupDraft = null;
  const owner = state.roster.find((entry) => entry.id === STARTERS[index % STARTERS.length]);
  state.ball = { ...pointOf(owner), ownerId: owner.id };
  return runConstructedPossession(index, { maxActions, matchSession });
}

const runs = [];
for (let index = 0; index < 30; index += 1) runs.push(runPossession(index));
const firstTimeEvents = runs.flatMap((run) => run.trace.filter((event) => event.code === "P.RECEIVE.FIRSTTIME"));

console.log("\n=== 1: first-time releases actually happen ===");
check("a real sweep produces first-time releases", firstTimeEvents.length > 0);
const releaseShare = firstTimeEvents.length / runs.reduce((sum, run) => sum + run.actionsCount, 0);
console.log(`     (${firstTimeEvents.length} releases across ${runs.reduce((s, r) => s + r.actionsCount, 0)} actions = ${(releaseShare * 100).toFixed(1)}%)`);
// Real football plays a substantial minority of balls first time. A rate near
// zero means the feature is inert; a rate near half means nobody ever
// controls the ball, which is not football either.
check("the release rate is a realistic minority, not inert and not constant",
  releaseShare > 0.02 && releaseShare < 0.35);

console.log("\n=== 2: a first-time ball is never controlled ===");
check("no release carries a control contact",
  firstTimeEvents.every((event) => event.contact?.type === "first-time"));
check("a release is a touch, not a reception beat",
  firstTimeEvents.every((event) => event.movement === "touch"));
// The defining property. A settling touch would mean resolveReceive() ran and
// the receiver could have lost it to a control error -- which is exactly the
// outcome a first-time ball does not have.
check("no release emits a settling reception alongside it",
  runs.every((run) => run.trace.every((event, index) =>
    event.code !== "P.RECEIVE.FIRSTTIME"
    || !String(run.trace[index + 1]?.code ?? "").startsWith("P.RECEIVE."))));
check("the ball does not travel during the contact itself",
  firstTimeEvents.every((event) => event.ballFrom && event.ballTo
    && event.ballFrom.x === event.ballTo.x && event.ballFrom.y === event.ballTo.y));

console.log("\n=== 3: the playback reception contract survives ===");
// matchLabPlayback.js keys its kinetics-timed arrival off exactly this shape.
// It does not throw when the shape is wrong -- it silently falls back to a
// generic window, which is the "everybody freezes" regression.
check("every release keeps the receive-pass arrival move",
  firstTimeEvents.every((event) => (event.playerMoves || []).some((move) => move.action === "receive-pass")));
check("every release keeps contact phase start",
  firstTimeEvents.every((event) => event.contact?.phase === "start"));
check("the arrival move lands exactly on the contact point",
  firstTimeEvents.every((event) => {
    const move = (event.playerMoves || []).find((entry) => entry.action === "receive-pass");
    return move?.to && event.contact?.point
      && move.to.x === event.contact.point.x && move.to.y === event.contact.point.y;
  }));
check("the contact actor is the player making the arrival move",
  firstTimeEvents.every((event) => {
    const move = (event.playerMoves || []).find((entry) => entry.action === "receive-pass");
    return String(event.contact?.actorId ?? "") === String(move?.playerId ?? "");
  }));

console.log("\n=== 4: the release is followed by the delivery it chose ===");
let resolvable = 0;
let followed = 0;
let matchedTarget = 0;
let truncated = 0;
for (const run of runs) {
  run.trace.forEach((event, index) => {
    if (event.code !== "P.RECEIVE.FIRSTTIME") return;
    const rest = run.trace.slice(index + 1);
    // A release taken on the possession's very last action has no delivery
    // inside THIS possession. That is the action cap truncating the passage,
    // not a dropped release: the descriptor rides `simulated` into the
    // continuation and resolves in the next chunk. Section 4b pins that down.
    if (rest.some((later) => later.code === "POSSESSION.MAX_ACTIONS") && !rest.some((later) => later.movement === "pass")) {
      truncated += 1;
      return;
    }
    resolvable += 1;
    const nextBall = rest.find((later) => later.movement === "pass");
    if (nextBall) followed += 1;
    if (nextBall && String(nextBall.targetId ?? "") === String(event.metrics?.firstTime?.targetId ?? "")) matchedTarget += 1;
  });
}
console.log(`     (${resolvable} resolvable, ${truncated} truncated by the action cap)`);
check("every resolvable release is followed by a real delivery", followed === resolvable);
check("the delivery goes to the target the release chose", matchedTarget === resolvable);

console.log("\n=== 4b: a release truncated by the action cap survives into the continuation ===");
{
  // Force the truncation deliberately rather than waiting for one: run a
  // possession, find the action count at which a release is pending, and
  // stop exactly there.
  let carried = null;
  for (let index = 0; index < 30 && !carried; index += 1) {
    for (let cap = 2; cap <= 10 && !carried; cap += 1) {
      const run = runPossession(index, { maxActions: cap, matchSession: true });
      const pending = run.continuation?.simulated?.forcedFirstTime
        ?? (run.trace.at(-2)?.code === "P.RECEIVE.FIRSTTIME" ? true : null);
      if (run.trace.some((event) => event.code === "P.RECEIVE.FIRSTTIME") && pending) {
        carried = { run, cap, index };
      }
    }
  }
  check("a truncated possession can be produced at all", Boolean(carried));
  if (carried) {
    check("the pending release rides the continuation rather than vanishing",
      Boolean(carried.run.continuation?.simulated?.forcedFirstTime?.releaseFromId));
  }
}

console.log("\n=== 5: the model's evidence is preserved on the event ===");
check("every release records its kind, geometry and penalty",
  firstTimeEvents.every((event) => {
    const metrics = event.metrics?.firstTime;
    return metrics && ["first-time-pass", "layoff"].includes(metrics.kind)
      && Number.isFinite(metrics.deflectionDeg) && metrics.accuracyPenalty > 1
      && metrics.feasibility01 > 0 && metrics.competence01 > 0 && metrics.preference01 > 0;
  }));
check("a layoff is always a genuine return, never a ball played across",
  firstTimeEvents.every((event) => event.metrics.firstTime.kind !== "layoff"
    || event.metrics.firstTime.deflectionDeg >= 120));
check("only the two wired kinds ever reach the engine",
  firstTimeEvents.every((event) => ["first-time-pass", "layoff"].includes(event.metrics.firstTime.kind)));

console.log("\n=== 6: replay stays deterministic ===");
const repeat = runPossession(0);
const original = runs[0];
check("an identical seed reproduces an identical trace",
  JSON.stringify(repeat.trace.map((event) => [event.code, event.ballTo]))
    === JSON.stringify(original.trace.map((event) => [event.code, event.ballTo])));
check("an identical seed reproduces the same releases",
  repeat.trace.filter((event) => event.code === "P.RECEIVE.FIRSTTIME").length
    === original.trace.filter((event) => event.code === "P.RECEIVE.FIRSTTIME").length);

console.log("\n=== 7: a keeper never flicks the ball on ===");
// A goalkeeper receiving the ball is claiming it. Their distribution is its
// own decision, taken afterwards through keeperDecision.
check("no goalkeeper ever takes a first-time release",
  runs.every((run) => run.trace.every((event) => {
    if (event.code !== "P.RECEIVE.FIRSTTIME") return true;
    return state.roster.find((entry) => String(entry.id) === String(event.actorId))?.role !== "keeper";
  })));

console.log("\n=== 8: the release has its own sound ===");
check("a struck first-time ball sounds like a strike",
  resolveCueSequence("P.RECEIVE.FIRSTTIME", { firstTimeKind: "first-time-pass" })[0]?.cue === "kick");
check("a cushioned layoff sounds like a touch",
  resolveCueSequence("P.RECEIVE.FIRSTTIME", { firstTimeKind: "layoff" })[0]?.cue === "firstTouch");
check("the release never falls through to silence",
  resolveCueSequence("P.RECEIVE.FIRSTTIME", {}).length === 1);

console.log(`\n${failures ? `${failures} CHECK(S) FAILED` : `ALL PASS -- ${passes} first-time integration checks`}`);
if (failures) process.exitCode = 1;
