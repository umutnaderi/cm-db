import { readFileSync } from "node:fs";
import {
  applyCoordinationCandidateBiases,
  coordinateInteraction,
  coordinationCounterfactual,
  createCoordinationState,
  DEFENSIVE_COORDINATION_FAMILIES,
} from "../src/lib/coordinationCoordinator.js";
import { claimLooseBall, evaluateLiveClaimantHandoffs } from "../src/lib/ballClaim.js";
import { advanceMotion } from "../src/lib/worldMotion.js";
import { yardDistance } from "../src/lib/pitchGeometry.js";

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} -- ${label}`);
  if (!condition) failures += 1;
}

function profile(id, supplied = {}) {
  const attributes = {
    Decisions: 13, Anticipation: 13, Teamwork: 13, Positioning: 13, Marking: 13,
    "Off the Ball": 13, Vision: 13, Acceleration: 13, Pace: 13, Agility: 13,
    Balance: 13, Stamina: 13, "Work Rate": 13, Passing: 13, Technique: 13,
    "First Touch": 13, "Long Shots": 13,
    ...supplied,
  };
  return {
    canonical_player_name: id,
    current_ability: 140,
    position_text: "M C",
    attributes: Object.entries(attributes).map(([label, value]) => ({ label, value })),
  };
}

function hydrate(raw) {
  return {
    formationAnchor: { x: raw.x, y: raw.y },
    attackingDirection: raw.team === "home" ? "up" : "down",
    duty: "support",
    ...raw,
    player: profile(raw.id, raw.attributes),
  };
}

const fixtureUrl = new URL("./fixtures/coordination/vertical-slice.json", import.meta.url);
const fixture = JSON.parse(readFileSync(fixtureUrl, "utf8"));
const expansionFixture = JSON.parse(readFileSync(
  new URL("./fixtures/coordination/possession-box-slice.json", import.meta.url), "utf8",
));
const basePlayers = fixture.players.map(hydrate);

function runScenario(name, options = {}) {
  const scenario = fixture.scenarios[name];
  const players = (options.players ?? basePlayers).map((entry) => ({ ...entry }));
  return coordinateInteraction({
    previous: options.previous ?? createCoordinationState(fixture.seed),
    players,
    ownerId: options.ownerId ?? scenario.ownerId ?? fixture.ownerId,
    ballPoint: options.ballPoint ?? scenario.ballPoint ?? fixture.ballPoint,
    attackingDirectionByTeam: fixture.attackingDirectionByTeam,
    tacticsByTeam: options.tacticsByTeam ?? scenario.tacticsByTeam,
    velocities: options.velocities ?? {},
    nowMs: options.nowMs ?? 0,
    flags: { ...scenario.flags, ...options.flags },
  });
}

console.log("=== 1: a central regain coordinates release, support, delay and recovery ===");
{
  const result = runScenario("regain");
  const responsibilities = result.intentions.map((entry) => entry.responsibility);
  check("the footage fixture selects REGAIN_QUICK_RELEASE",
    result.selectedAttack?.family === fixture.scenarios.regain.expectedAttack);
  check("its defence answers with TRANSITION_DELAY_AND_RECOVER",
    result.selectedDefense?.family === fixture.scenarios.regain.expectedDefense);
  check("the ball has an outlet and concurrent close/depth support",
    responsibilities.includes("immediate-outlet")
      && responsibilities.includes("close-support")
      && responsibilities.includes("central-depth-runner"));
  check("the defence owns pressure, cover and recovery concurrently",
    responsibilities.includes("primary-pressure")
      && responsibilities.includes("inside-cover")
      && responsibilities.includes("recovery-screen"));
  check("one player cannot hold two reserved responsibilities",
    Object.keys(result.state.reservations).length === result.intentions.length);
}

console.log("\n=== 2: right and left wide transitions preserve their own flank ===");
{
  for (const name of ["wideRight", "wideLeft"]) {
    const result = runScenario(name);
    const expectedRight = name === "wideRight";
    const channel = result.intentions.find((entry) => entry.responsibility === "curved-channel-runner");
    check(`${name} selects WIDE_TRANSITION`, result.selectedAttack?.family === "WIDE_TRANSITION");
    check(`${name} triggers DEFEND_WIDE_OVERLOAD`, result.selectedDefense?.family === "DEFEND_WIDE_OVERLOAD");
    check(`${name} sends the channel run to the intended flank`,
      Boolean(channel) && (expectedRight ? channel.target.x > 70 : channel.target.x < 30));
  }
  const narrowInside = runScenario("wideRight", {
    tacticsByTeam: {
      ...fixture.scenarios.wideRight.tacticsByTeam,
      home: {
        attacking: {
          ...fixture.scenarios.wideRight.tacticsByTeam.home.attacking,
          width: "narrow",
          focusPlay: "centre",
        },
        transition: { onGain: "counter" },
      },
    },
  });
  check("narrow central focus changes the same flank support from overlap to underlap",
    narrowInside.selectedAttack?.family === "WIDE_TRANSITION"
      && narrowInside.intentions.some((entry) => entry.responsibility === "underlap")
      && !narrowInside.intentions.some((entry) => entry.responsibility === "overlap"));
}

console.log("\n=== 3: a short combination can stay active and complete ===");
{
  const start = runScenario("combination");
  check("settled possession selects SHORT_COMBINATION", start.selectedAttack?.family === "SHORT_COMBINATION");
  const continued = runScenario("combination", {
    previous: start.state, nowMs: 500, flags: { completed: "third player received the return" },
  });
  check("completion is recorded without pre-resolving the football outcome",
    continued.state.history.some((entry) => entry.type === "attack-completed"
      && entry.family === "SHORT_COMBINATION"));
}

console.log("\n=== 4: the same combination aborts when live geometry closes the lane ===");
{
  const start = runScenario("combination");
  const closed = runScenario("combination", {
    previous: start.state, nowMs: 500, flags: { laneClosed: true },
  });
  check("the active combination emits an explicit abort reason",
    closed.evidence.aborted?.reason === "combination lane closed");
  check("the aborted family is not silently kept active",
    closed.selectedAttack?.family !== "SHORT_COMBINATION");
}

console.log("\n=== 5: a counter can be delayed and recycled instead of forced forward ===");
{
  const result = runScenario("delayedCounter");
  const quick = result.attackCandidates.find((entry) => entry.family === "REGAIN_QUICK_RELEASE");
  const combination = result.attackCandidates.find((entry) => entry.family === "SHORT_COMBINATION");
  check("hold-shape and possession tactics reject the quick-release family",
    result.selectedAttack?.family === "SHORT_COMBINATION" && quick.utility < combination.utility);
  const outlet = result.intentions.find((entry) => entry.responsibility === "close-support")?.playerId;
  const candidates = [
    { type: "pass", target: { id: outlet }, utility: 1 },
    { type: "carry", utility: 1 },
    { type: "hold", utility: 1 },
  ];
  applyCoordinationCandidateBiases(candidates, result);
  check("the live decision bias favors a reserved short relationship or hold over a forced carry",
    Math.max(candidates[0].utility, candidates[2].utility) > candidates[1].utility);
}

console.log("\n=== 6: exactly one defender owns pressure with cover behind ===");
{
  const result = runScenario("combination");
  check("there is one and only one primary pressure owner",
    result.intentions.filter((entry) => entry.responsibility === "primary-pressure").length === 1);
  check("the pressure owner and inside cover are different players",
    result.intentions.find((entry) => entry.responsibility === "primary-pressure")?.playerId
      !== result.intentions.find((entry) => entry.responsibility === "inside-cover")?.playerId);
}

console.log("\n=== 7: pressure transfers only after commitment and does not oscillate ===");
{
  const start = runScenario("combination");
  const firstId = start.evidence.pressure.ownerId;
  const challenger = start.evidence.pressureCandidates.find((entry) => entry.id !== firstId)?.id;
  const moved = basePlayers.map((entry) => {
    if (entry.id === firstId) return { ...entry, x: 20, y: 65 };
    if (entry.id === challenger) return { ...entry, x: 50.5, y: 54 };
    return { ...entry };
  });
  const tooSoon = runScenario("combination", { previous: start.state, players: moved, nowMs: 300 });
  const transferred = runScenario("combination", { previous: tooSoon.state, players: moved, nowMs: 900 });
  const slightReturn = moved.map((entry) => entry.id === firstId ? { ...entry, x: 49.7, y: 54.5 } : entry);
  const held = runScenario("combination", { previous: transferred.state, players: slightReturn, nowMs: 1100 });
  check("the minimum commitment window blocks an early switch", tooSoon.evidence.pressure.ownerId === firstId);
  check("a large reachable-arrival advantage eventually transfers pressure",
    transferred.evidence.pressure.ownerId === challenger
      && transferred.evidence.transfers.some((entry) => entry.type === "pressure-handoff"));
  check("a small immediate counter-swing cannot twitch ownership back",
    held.evidence.pressure.ownerId === challenger);
}

console.log("\n=== 8: a depth runner can be handed between marking responsibilities ===");
{
  const start = runScenario("combination", { flags: { depthThreat: true } });
  const runnerId = Object.keys(start.evidence.trackers)[0];
  const firstTracker = start.evidence.trackers[runnerId]?.defenderId;
  const alternative = basePlayers.find((entry) => entry.team === "away"
    && entry.role !== "keeper" && entry.id !== firstTracker && entry.id !== start.evidence.pressure.ownerId)?.id;
  const runnerTarget = start.intentions.find((entry) => String(entry.playerId) === String(runnerId))?.target;
  const moved = basePlayers.map((entry) => {
    if (entry.id === firstTracker) return { ...entry, x: 90, y: 65 };
    if (entry.id === alternative) return { ...entry, x: runnerTarget.x, y: runnerTarget.y + 1 };
    return { ...entry };
  });
  const next = runScenario("combination", { previous: start.state, players: moved, nowMs: 900, flags: { depthThreat: true } });
  check("PROTECT_DEPTH_AND_HANDOFF is an active defensive response",
    start.selectedDefense?.family === "PROTECT_DEPTH_AND_HANDOFF");
  check("the runner changes marker when another defender inherits a clear physical advantage",
    Boolean(runnerId && firstTracker)
      && next.evidence.trackers[runnerId]?.defenderId !== firstTracker
      && next.evidence.transfers.some((entry) => entry.type === "runner-handoff" && String(entry.runnerId) === runnerId));
}

console.log("\n=== 8b: multiple tracker reservations cannot swap owners during a stable replan ===");
{
  const start = runScenario("combination", { flags: { depthThreat: true } });
  const next = runScenario("combination", {
    previous: start.state,
    nowMs: 900,
    flags: { depthThreat: true },
  });
  const priorPairs = Object.entries(start.evidence.trackers)
    .map(([runnerId, assignment]) => `${runnerId}:${assignment.defenderId}`)
    .sort();
  const nextPairs = Object.entries(next.evidence.trackers)
    .map(([runnerId, assignment]) => `${runnerId}:${assignment.defenderId}`)
    .sort();
  const transferPairs = next.evidence.transfers
    .filter((entry) => entry.type === "runner-handoff")
    .map((entry) => `${entry.fromId}>${entry.toId}`);
  check("unchanged geometry preserves every compatible tracker owner",
    JSON.stringify(priorPairs) === JSON.stringify(nextPairs));
  check("one replan cannot emit a pairwise tracker swap",
    !transferPairs.some((pair) => {
      const [from, to] = pair.split(">");
      return transferPairs.includes(`${to}>${from}`);
    }));
}

console.log("\n=== 9: a slow defender pursues an intention without teleporting ===");
{
  const slow = hydrate({
    id: "slow", team: "away", positionalSlot: "DC", duty: "defend", x: 50, y: 70,
    attributes: { Pace: 4, Acceleration: 4, Agility: 4, Balance: 6, Stamina: 8 },
  });
  const target = { x: 50, y: 35 };
  const motion = advanceMotion({
    from: slow, intentionTarget: target, player: slow.player, elapsedMs: 500,
    intention: "coordinate-runner-tracker", continuesAfter: true,
  });
  check("the defender moves but cannot reach a distant marking target in 500ms",
    motion.distanceYards > 0 && !motion.reachedTarget && yardDistance(motion.position, target) > 20);
  check("the authoritative kinetics audit accepts the partial motion", motion.withinPhysicalLimit);
}

console.log("\n=== 10: pace and starting geometry legitimately affect responsibility ===");
{
  const result = runScenario("combination");
  const selected = basePlayers.find((entry) => entry.id === result.evidence.pressure.ownerId);
  const farSlow = basePlayers.map((entry) => entry.team !== "away" || entry.role === "keeper"
    ? entry
    : { ...entry, x: entry.id === "a3" ? 50.5 : 85, y: entry.id === "a3" ? 54 : 70,
      player: entry.id === "a3" ? profile("a3-fast", { Pace: 19, Acceleration: 19, Decisions: 18, Anticipation: 18 })
        : profile(`${entry.id}-slow`, { Pace: 5, Acceleration: 5, Decisions: 8, Anticipation: 8 }) });
  const physical = runScenario("combination", { players: farSlow });
  check("a faster, better-positioned defender inherits primary pressure",
    physical.evidence.pressure.ownerId === "a3" && physical.evidence.pressure.ownerId !== selected?.id);
}

console.log("\n=== 11: a loose-ball claimant changes during travel and the former claimant recovers ===");
{
  const loose = JSON.parse(readFileSync(new URL("./fixtures/coordination/loose-claim-handoff.json", import.meta.url), "utf8"));
  const players = loose.players.map(hydrate);
  const claim = claimLooseBall({ ...loose, candidates: players, withLeaders: true });
  const handoffs = evaluateLiveClaimantHandoffs({
    roll: claim.roll, candidates: players, finalClaim: claim, initialClaimantId: loose.initialClaimantId,
  });
  check("the physical winner is the saved fixture's later, reachable claimant",
    claim.claimant?.id === loose.expectedFinalClaimantId);
  check("the live responsibility transfers with quantified evidence",
    handoffs.finalClaimantId === loose.expectedFinalClaimantId
      && handoffs.transfers.some((entry) => entry.fromId === "near" && entry.toId === "deep"
        && typeof entry.reason === "string"));
  const follow = coordinateInteraction({
    players, ownerId: "deep", ballPoint: claim.interceptPoint,
    attackingDirectionByTeam: { home: "up", away: "down" }, nowMs: claim.interceptMs,
    flags: { formerClaimantId: "near", claimantTransferReason: handoffs.transfers.at(-1)?.reason },
  });
  check("the former opponent claimant leaves the chase and recovers shape",
    follow.intentions.some((entry) => entry.playerId === "near" && entry.responsibility === "shape-recovery"));
}

console.log("\n=== 12: a clearance remains a live second-ball/transition state ===");
{
  const players = basePlayers.filter((entry) => ["h4", "h6", "h8", "a4", "a6", "a8"].includes(entry.id));
  const clearance = claimLooseBall({
    from: { x: 45, y: 25 }, aim: { x: 58, y: 78 }, speedYps: 17, candidates: players,
  });
  const winner = clearance.claimant ?? clearance.pickup?.entry;
  const next = coordinateInteraction({
    previous: { ...createCoordinationState(44), lastPossessionTeam: winner.team === "home" ? "away" : "home" },
    players, ownerId: winner.id, ballPoint: clearance.interceptPoint ?? clearance.pickup.point,
    attackingDirectionByTeam: fixture.attackingDirectionByTeam,
    tacticsByTeam: fixture.scenarios.regain.tacticsByTeam,
    nowMs: clearance.interceptMs ?? clearance.pickup.arrivalMs,
    flags: { reason: "clearance-second-ball" },
  });
  check("the clearance has a real reachable second-ball owner", Boolean(winner));
  check("the next state immediately contains transition responsibilities instead of a dead pause",
    next.state.lastPossessionTeam === winner.team && next.intentions.length > 2
      && next.state.history.some((entry) => entry.type === "attack-selected"));
}

console.log("\n=== 13: identical scenario and seed reproduce responsibility history exactly ===");
{
  const first = runScenario("regain");
  const second = runScenario("regain");
  check("selection, reservations, pressure and history are byte-identical",
    JSON.stringify(first.state) === JSON.stringify(second.state));
}

console.log("\n=== 14: the same geometry produces coherent tactical counterfactuals ===");
{
  const wing = runScenario("wideRight");
  const possession = runScenario("combination", {
    ownerId: fixture.scenarios.wideRight.ownerId,
    ballPoint: fixture.scenarios.wideRight.ballPoint,
    flags: { transition: true },
  });
  const wingSummary = coordinationCounterfactual(wing);
  const possessionSummary = coordinationCounterfactual(possession);
  check("wing/counter tactics select wide transition while possession tactics select combination",
    wingSummary.selectedAttack === "WIDE_TRANSITION"
      && possessionSummary.selectedAttack === "SHORT_COMBINATION");
  check("the counterfactual changes measured utilities, not merely a label",
    wingSummary.candidateUtilities.WIDE_TRANSITION > possessionSummary.candidateUtilities.WIDE_TRANSITION
      && possessionSummary.candidateUtilities.SHORT_COMBINATION > wingSummary.candidateUtilities.SHORT_COMBINATION);
  const highPress = runScenario("combination");
  const lowPressTactics = structuredClone(fixture.scenarios.combination.tacticsByTeam);
  lowPressTactics.away.defending.pressing = "low";
  const lowPress = runScenario("combination", { tacticsByTeam: lowPressTactics });
  check("pressing intensity changes the measured arrival estimate",
    highPress.evidence.pressure.etaMs < lowPress.evidence.pressure.etaMs);
}

console.log("\n=== 15: ball-side congestion produces a real recycle and weak-side switch ===");
let recycleResult = null;
{
  const scenario = expansionFixture.scenarios.recycle;
  const crowdedPlayers = basePlayers.map((entry) => {
    if (scenario.playerPositions[entry.id]) return { ...entry, ...scenario.playerPositions[entry.id] };
    return { ...entry };
  });
  recycleResult = coordinateInteraction({
    previous: { ...createCoordinationState(fixture.seed), lastPossessionTeam: "home", possessionChangedAtMs: 0 },
    players: crowdedPlayers,
    ownerId: scenario.ownerId,
    ballPoint: scenario.ballPoint,
    attackingDirectionByTeam: fixture.attackingDirectionByTeam,
    tacticsByTeam: scenario.tacticsByTeam,
    nowMs: scenario.nowMs,
    flags: scenario.flags,
  });
  const switchReceiver = recycleResult.intentions.find((entry) => entry.responsibility === "switch-receiver");
  check("congestion selects RECYCLE_AND_SWITCH", recycleResult.selectedAttack?.family === scenario.expectedAttack);
  check("circulation reserves a rear outlet, connector and opposite-width receiver",
    recycleResult.intentions.some((entry) => entry.responsibility === "recycle-outlet")
      && recycleResult.intentions.some((entry) => entry.responsibility === "circulation-support")
      && switchReceiver?.target.x > 70);
  const options = [
    { type: "pass", target: { id: switchReceiver?.playerId }, utility: 1 },
    { type: "carry", utility: 1 },
    { type: "hold", utility: 1 },
  ];
  applyCoordinationCandidateBiases(options, recycleResult);
  check("the weak-side pass gains utility while remaining an ordinary legal candidate", options[0].utility > options[1].utility);
}

console.log("\n=== 16: final-third entry coordinates distinct legal box lanes ===");
let boxResult = null;
{
  const scenario = expansionFixture.scenarios.penaltyArea;
  boxResult = coordinateInteraction({
    previous: { ...createCoordinationState(fixture.seed), lastPossessionTeam: "home", possessionChangedAtMs: 0 },
    players: basePlayers,
    ownerId: scenario.ownerId,
    ballPoint: scenario.ballPoint,
    attackingDirectionByTeam: fixture.attackingDirectionByTeam,
    tacticsByTeam: scenario.tacticsByTeam,
    nowMs: scenario.nowMs,
    flags: scenario.flags,
  });
  const boxRoles = ["near-post-runner", "central-box-target", "far-post-runner", "cutback-option", "edge-of-box-arrival"];
  const boxIntentions = boxResult.intentions.filter((entry) => boxRoles.includes(entry.responsibility));
  check("the final corridor selects PENALTY_AREA_OCCUPATION against box protection",
    boxResult.selectedAttack?.family === scenario.expectedAttack
      && boxResult.selectedDefense?.family === scenario.expectedDefense);
  check("near, central, far, cutback and edge responsibilities are reserved to different players",
    boxIntentions.length === 5 && new Set(boxIntentions.map((entry) => entry.playerId)).size === 5);
  const lineY = 14 + 0.8 / 120 * 100; // ball is ahead of the second-last opponent; include the coordinator buffer.
  check("prospective box runners remain onside before the next contact",
    boxIntentions.filter((entry) => entry.threat).every((entry) => entry.target.y >= lineY));
}

console.log("\n=== 17: defensive line depth reacts coherently to pressure and keeper depth ===");
{
  check("line evidence records one shared depth and keeps it ahead of the goalkeeper",
    boxResult.evidence.defensiveLine.memberIds.length >= 2
      && boxResult.evidence.defensiveLine.depthYards >= boxResult.evidence.defensiveLine.keeperDepthYards + 2);
  const lineMoves = boxResult.intentions.filter((entry) => ["defensive-line-controller", "defensive-line-member"].includes(entry.responsibility));
  check("available line members share the controller's depth rather than drifting behind the keeper",
    lineMoves.every((entry) => Math.abs(entry.target.y - boxResult.evidence.defensiveLine.lineY) < 1e-9));
  const controlledPlayers = basePlayers.map((entry) => entry.id === "a6" ? { ...entry, x: 50, y: 54 } : entry);
  const uncontrolledPlayers = basePlayers.map((entry) => entry.team === "away" && entry.role !== "keeper"
    ? { ...entry, x: 90, y: 18 } : entry);
  const lineTactics = {
    home: { attacking: { style: "possession", mentality: "balanced" } },
    away: { defending: { pressing: "high", defensiveLine: "high", offsideTrap: true, scheme: "zonal", strictness: 3 } },
  };
  const controlled = coordinateInteraction({
    players: controlledPlayers, ownerId: "h6", ballPoint: { x: 50, y: 55 },
    attackingDirectionByTeam: fixture.attackingDirectionByTeam, tacticsByTeam: lineTactics, nowMs: 5000,
  });
  const uncontrolled = coordinateInteraction({
    players: uncontrolledPlayers, ownerId: "h6", ballPoint: { x: 50, y: 55 },
    attackingDirectionByTeam: fixture.attackingDirectionByTeam, tacticsByTeam: lineTactics, nowMs: 5000,
  });
  check("controlled pressure permits the instructed offside step",
    controlled.evidence.defensiveLine.offsideTrapStep && !controlled.evidence.defensiveLine.safetyDropYards);
  check("time for the passer makes the same high line drop instead of stepping",
    uncontrolled.evidence.defensiveLine.safetyDropYards > 0
      && uncontrolled.evidence.defensiveLine.depthYards < controlled.evidence.defensiveLine.depthYards);
}

console.log("\n=== 18: the new families preserve seeded determinism ===");
{
  const scenario = expansionFixture.scenarios.penaltyArea;
  const again = coordinateInteraction({
    previous: { ...createCoordinationState(fixture.seed), lastPossessionTeam: "home", possessionChangedAtMs: 0 },
    players: basePlayers,
    ownerId: scenario.ownerId,
    ballPoint: scenario.ballPoint,
    attackingDirectionByTeam: fixture.attackingDirectionByTeam,
    tacticsByTeam: scenario.tacticsByTeam,
    nowMs: scenario.nowMs,
    flags: scenario.flags,
  });
  check("box occupation and defensive ownership reproduce byte-identically",
    JSON.stringify(boxResult.state) === JSON.stringify(again.state));
}

console.log("\n=== registry completeness ===");
{
  const seen = new Set();
  seen.add(runScenario("regain").selectedDefense.family);
  seen.add(runScenario("wideRight").selectedDefense.family);
  seen.add(runScenario("combination").selectedDefense.family);
  seen.add(runScenario("combination", { flags: { depthThreat: true } }).selectedDefense.family);
  seen.add(boxResult.selectedDefense.family);
  const counterpressPrior = { ...createCoordinationState(1), lastPossessionTeam: "away", possessionChangedAtMs: 0 };
  const tactics = structuredClone(fixture.scenarios.regain.tacticsByTeam);
  tactics.away.transition.onLoss = "counter-press";
  seen.add(runScenario("regain", { previous: counterpressPrior, tacticsByTeam: tactics, nowMs: 100 }).selectedDefense.family);
  check("every registered defensive response family is reachable through live inputs",
    DEFENSIVE_COORDINATION_FAMILIES.every((family) => seen.has(family)));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
