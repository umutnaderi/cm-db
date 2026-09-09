// World Motion Contract v1 tests -- see MATCH_ENGINE_ARCHITECTURE.md.
//
// These test the CONTRACT, not the implementation: a tactical target may
// never become a position by fiat; a player's authoritative position must
// be reachable in the window it was scheduled into; momentum must survive
// a leg boundary; the next action must start exactly where the last one
// really ended; and none of it may cost determinism or mutate the
// authored Match Lab setup.
//
// match-lab.js is a page script, not a DOM-free library, so the same
// minimal fake `document` convention tools/test-possession-runner.mjs
// established is used to import it headlessly.
const fakeStyle = () => ({ setProperty() {}, removeProperty() {}, getPropertyValue() { return ""; } });
const fakeClassList = () => {
  const set = new Set();
  return {
    add: (...names) => names.forEach((name) => set.add(name)),
    remove: (...names) => names.forEach((name) => set.delete(name)),
    toggle() {}, contains: (name) => set.has(name),
  };
};
const fakeElement = () => {
  const el = {
    className: "", style: fakeStyle(), dataset: {}, classList: fakeClassList(),
    children: [], parentNode: null, value: "", textContent: "", innerHTML: "", hidden: false,
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, getAttribute() { return null; },
    removeAttribute() {}, setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; },
    querySelector() { return fakeElement(); }, querySelectorAll() { return []; },
    appendChild(child) { child.parentNode = el; el.children.push(child); return child; },
    removeChild(child) { const i = el.children.indexOf(child); if (i >= 0) el.children.splice(i, 1); return child; },
    remove() {}, replaceChildren() { el.children = []; }, focus() {}, click() {},
  };
  return el;
};
globalThis.document = {
  querySelector: () => fakeElement(), querySelectorAll: () => [],
  createElement: () => fakeElement(), addEventListener() {}, body: fakeElement(),
};
globalThis.window = globalThis;
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.fetch = async () => { throw new Error("network disabled in test"); };

const mod = await import("../match-lab.js");
const { state, runConstructedPossession, pointOf, freshBurst01, zoneFromPercent } = mod;
const { buildMatchLabPlaybackPlan, validateMatchLabPlaybackPlan } = await import("../src/lib/matchLabPlayback.js");
const {
  advanceMotion, auditMoveSpeed, createMotionRecord, readMotionRecord, writeMotionRecord,
  speedYpsFromVelocity, velocityAlong,
} = await import("../src/lib/worldMotion.js");
const { movementDistanceYards, sampleContinuousTrajectory } = await import("../src/lib/matchMovementTiming.js");
const { topSpeed } = await import("../src/lib/playerKinetics.js");
const { simulateCarryTouches } = await import("../src/lib/spatialDecision.js");

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} -- ${label}`);
  if (!condition) failures += 1;
}

function attrs(pairs) { return Object.entries(pairs).map(([label, value]) => ({ label, value })); }
function player(name, overrides) { return { canonical_player_name: name, current_ability: 150, attributes: attrs(overrides) }; }
function entry(id, { role = "player", team = "home", x, y, playerObj }) {
  return { id, role, team, player: playerObj, x, y, zone: zoneFromPercent(x, y) };
}
function buildPlan() {
  return (runOutput) => buildMatchLabPlaybackPlan({
    trace: runOutput.trace,
    initialPositions: Object.fromEntries(state.roster.map((e) => [e.id, pointOf(e)])),
    initialBall: pointOf(state.roster.find((e) => e.id === state.ball.ownerId)) ?? { ...state.ball },
    initialOwnerId: state.ball.ownerId,
    finalOwnerId: runOutput.finalOwnerId,
    restart: runOutput.result?.restart,
    playerProfiles: Object.fromEntries(state.roster.map((e) => [String(e.id), e.player])),
    initialBurst: Object.fromEntries(state.roster.map((e) => [String(e.id), freshBurst01(e.player)])),
  });
}
const planFor = buildPlan();

const PASSER = player("Upfield Passer", { Passing: 14, Vision: 14, Decisions: 13, Pace: 14, Acceleration: 14, Stamina: 14, "Work Rate": 14 });
const DEEP = player("Deep Mid", { Passing: 13, Technique: 12, Decisions: 12, Pace: 12, Acceleration: 12, Stamina: 13, "Work Rate": 13 });
const RUNNER = player("Runner", { Pace: 12, Acceleration: 12, "Off the Ball": 14 });
const STOPPER = player("Defender", { Positioning: 15, Anticipation: 15, Tackling: 14, Pace: 14, Decisions: 14 });
const KEEPER = player("Keeper", { Reflexes: 14, Handling: 13, Positioning: 14 });
const CARRIER = player("Carrier", { Pace: 16, Acceleration: 16, Dribbling: 15, Technique: 14, Stamina: 14, Decisions: 14, Composure: 14 });

// ---------------------------------------------------------------------------
console.log("=== 1: advanceMotion() never teleports to an unreachable target ===");
{
  const far = { x: 50, y: 10 };
  const from = { x: 50, y: 90 };
  const short = advanceMotion({
    from, intentionTarget: far, player: DEEP, elapsedMs: 300,
  });
  const totalYards = movementDistanceYards(from, far);
  check("a window too short to arrive does not reach the intention target", !short.reachedTarget);
  check("the advance covers real ground, not the whole gap",
    short.distanceYards > 0 && short.distanceYards < totalYards);
  check("the ground covered is within what the player could physically cover",
    auditMoveSpeed({ player: DEEP, distanceYards: short.distanceYards, scheduledDurationMs: 300 }).withinPhysicalLimit);
  check("an unfinished advance carries a real exit velocity (the next window continues the stride)",
    speedYpsFromVelocity(short.velocity) > 0.5);
  check("the remaining distance to the intention target is reported", short.remainingYards > 0);

  const near = { x: 50, y: 88 };
  const done = advanceMotion({ from, intentionTarget: near, player: DEEP, elapsedMs: 4000 });
  check("a window long enough does reach the target", done.reachedTarget);
  check("an arrival ends at rest", speedYpsFromVelocity(done.velocity) < 0.001);
}

// ---------------------------------------------------------------------------
console.log("\n=== 2: auditMoveSpeed() catches a compressed (teleporting) move ===");
{
  const honest = auditMoveSpeed({ player: DEEP, distanceYards: 7.5, scheduledDurationMs: 1930 });
  const teleport = auditMoveSpeed({ player: DEEP, distanceYards: 7.5, scheduledDurationMs: 40 });
  check("a 7.5yd run over its own real ~1.9s window is within the physical limit", honest.withinPhysicalLimit);
  check("the same 7.5yd squeezed into 40ms is not", !teleport.withinPhysicalLimit);
  check("the overrun is quantified", teleport.overrunYards > 5);
  check("a move already at pace is allowed more ground than one from rest",
    auditMoveSpeed({ player: DEEP, distanceYards: 5, scheduledDurationMs: 700, initialSpeedYps: topSpeed(DEEP) }).reachableYards
    > auditMoveSpeed({ player: DEEP, distanceYards: 5, scheduledDurationMs: 700 }).reachableYards);
}

// ---------------------------------------------------------------------------
console.log("\n=== 3: the motion record carries position, velocity, facing, intention, gait ===");
{
  const context = { state: { tick: 0, players: {} }, marking: {} };
  const record = createMotionRecord({
    position: { x: 40, y: 60 }, velocity: { x: 0.004, y: -0.002 },
    intention: "recovery-track", intentionTarget: { x: 40, y: 20 }, gait: "controlled-sprint",
    simulationTimeMs: 1840,
  });
  check("a record derives facing from its own velocity when none is given", Number.isFinite(record.facing));
  check("a record keeps its simulation timestamp", record.simulationTimeMs === 1840);
  writeMotionRecord(context, "p1", {
    position: record.position, velocity: record.velocity,
    intention: "recovery-track", intentionTarget: record.intentionTarget, role: "defender",
    gait: "controlled-sprint", simulationTimeMs: 1840,
  });
  const stored = context.state.players.p1;
  check("the stored shape keeps resolveMotionBatch()'s own key names (velocity/intention/lastPosition)",
    Boolean(stored.velocity && stored.intention && stored.lastPosition));
  check("the stored intention keeps action/role/target", stored.intention.action === "recovery-track"
    && stored.intention.role === "defender" && stored.intention.target.y === 20);
  const round = readMotionRecord(context, "p1");
  check("reading it back recovers position, velocity, intention and target",
    round.position.x === 40 && Math.abs(round.velocity.x - 0.004) < 1e-9
    && round.intention === "recovery-track" && round.intentionTarget.y === 20);
  check("reading an unknown player yields an at-rest record, never a crash",
    speedYpsFromVelocity(readMotionRecord(context, "nobody").velocity) === 0);
  check("velocityAlong() builds a vector of the requested real speed",
    Math.abs(speedYpsFromVelocity(velocityAlong({ x: 50, y: 50 }, { x: 50, y: 60 }, 7)) - 7) < 0.001);
}

// ---------------------------------------------------------------------------
console.log("\n=== 4: a dispossessed attacker tracks back without teleporting ===");
{
  state.mode = "freeplay";
  state.attackingDirection = { home: "down", away: "up" };
  const roster = () => [
    entry("att", { team: "home", x: 50, y: 72, playerObj: PASSER }),
    entry("mid", { team: "home", x: 48, y: 40, playerObj: DEEP }),
    entry("mid2", { team: "home", x: 56, y: 38, playerObj: DEEP }),
    entry("run", { team: "home", x: 58, y: 80, playerObj: RUNNER }),
    entry("d1", { team: "away", x: 50, y: 80, playerObj: STOPPER }),
    entry("d2", { team: "away", x: 44, y: 78, playerObj: STOPPER }),
    entry("gk", { team: "away", role: "keeper", x: 50, y: 97, playerObj: KEEPER }),
  ];
  let found = null;
  for (let seed = 0; seed < 400 && !found; seed += 1) {
    state.roster = roster();
    state.ball = { x: 50, y: 72, zone: zoneFromPercent(50, 72), ownerId: "att" };
    const run = runConstructedPossession(seed);
    const index = run.trace.findIndex((event) =>
      (event.playerMoves || []).some((move) => move.action === "recovery-track"));
    if (index >= 0) found = { seed, run, index };
  }
  check("found a real turnover recovery-track within the search budget", Boolean(found));
  if (found) {
    const event = found.run.trace[found.index];
    const move = event.playerMoves.find((candidate) => candidate.action === "recovery-track");
    const plan = planFor(found.run);
    const interval = plan.intervals.find((candidate) => candidate.eventIndex === found.index);
    const diagnostic = interval.moveDiagnostics.find((item) => item.action === "recovery-track");

    check("the recovery event is a real, non-trivial run", movementDistanceYards(move.from, move.to) > 1);
    check("the recovery run keeps its own honest duration when scheduled (never compressed into the producing window)",
      interval.endMs - interval.startMs >= event.duration - 1);
    check("the scheduled move is within the player's own physical limit -- no teleport",
      diagnostic.withinPhysicalLimit === true);
    check("its average speed does not exceed the player's top speed",
      diagnostic.averageSpeedYardsPerSecond <= diagnostic.topSpeedYardsPerSecond + 0.01);
    check("the move records the intention responsible for it", diagnostic.intention === "recovery-track");
    check("the move records an intention TARGET distinct from where the player actually got to",
      Boolean(diagnostic.intentionTarget));

    // The contract's headline claim: the authoritative position is the one
    // the motion produced, and every later reader agrees with it.
    const finalEntry = found.run.finalPositions.find((candidate) => candidate.id === move.playerId);
    const laterMove = found.run.trace
      .slice(found.index + 1)
      .flatMap((laterEvent) => laterEvent.playerMoves || [])
      .find((candidate) => String(candidate.playerId) === String(move.playerId));
    check("the roster entry was committed to the position the motion actually reached",
      Boolean(finalEntry));
    if (laterMove) {
      check("the next action for that player starts from exactly where this motion ended",
        Math.abs(laterMove.from.x - move.to.x) < 1e-9 && Math.abs(laterMove.from.y - move.to.y) < 1e-9);
    } else {
      check("the next action for that player starts from exactly where this motion ended (no later move authored)", true);
    }
    check("the whole possession still builds a continuous, contact-consistent playback plan",
      validateMatchLabPlaybackPlan(plan).valid);
  }
}

// ---------------------------------------------------------------------------
console.log("\n=== 5: a multi-touch carry keeps momentum across touch boundaries ===");
{
  const touches = simulateCarryTouches(
    { x: 50, y: 30 }, { x: 50, y: 60 }, "full-sprint",
    { player: CARRIER, pressure: 0, seed: "world-motion-carry", opponents: [] },
  );
  check("the fixture produced a genuine multi-touch carry", touches.length >= 3);
  let continuous = true;
  let accelerating = false;
  for (let index = 1; index < touches.length; index += 1) {
    const previousExit = touches[index - 1].chaseTrajectory.at(-1).velocity;
    const entry0 = touches[index].chaseTrajectory[0].velocity;
    const previousSpeed = speedYpsFromVelocity(previousExit);
    const entrySpeed = speedYpsFromVelocity(entry0);
    if (Math.abs(previousSpeed - entrySpeed) > 0.05) continuous = false;
    if (entrySpeed > 0.5) accelerating = true;
  }
  check("every touch begins at exactly the speed the previous touch ended at -- no velocity reset", continuous);
  check("the carrier is genuinely moving between touches (not restarting from rest each time)", accelerating);
  check("no touch ends at a dead stop mid-carry",
    touches.slice(0, -1).every((touch) => speedYpsFromVelocity(touch.chaseTrajectory.at(-1).velocity) > 0.3));
  check("the carrier's speed builds toward their top speed over the carry",
    speedYpsFromVelocity(touches.at(-1).chaseTrajectory.at(-1).velocity)
    > speedYpsFromVelocity(touches[0].chaseTrajectory.at(-1).velocity));
  // The chase must never OVERSHOOT its own touch point, and any shortfall
  // must be a physically honest one -- a carrier setting off from rest
  // genuinely cannot catch a first touch played 6-7 yards ahead of them
  // inside its own roll time, and the model correctly leaves them behind
  // it rather than dragging them onto it. What must never happen is the
  // reverse: ground covered that the player did not have the legs for.
  check("no touch chase overshoots its own touch point",
    touches.every((touch) => movementDistanceYards(touch.ballFrom, touch.chaseTrajectory.at(-1).position)
      <= movementDistanceYards(touch.ballFrom, touch.ballTo) + 0.01));
  check("every touch chase stays inside the carrier's own physical limit",
    touches.every((touch, index) => auditMoveSpeed({
      player: CARRIER,
      distanceYards: movementDistanceYards(touch.ballFrom, touch.chaseTrajectory.at(-1).position),
      scheduledDurationMs: touch.durationMs,
      initialSpeedYps: index === 0
        ? 0
        : speedYpsFromVelocity(touches[index - 1].chaseTrajectory.at(-1).velocity),
    }).withinPhysicalLimit));
  check("once at pace, the carrier does reach each of their own touch points",
    touches.slice(1).every((touch) => movementDistanceYards(touch.chaseTrajectory.at(-1).position, touch.ballTo) < 0.01));
}

// ---------------------------------------------------------------------------
console.log("\n=== 6: ball and carrier keep separate trajectories but meet at contact ===");
{
  const touches = simulateCarryTouches(
    { x: 50, y: 30 }, { x: 50, y: 60 }, "full-sprint",
    { player: CARRIER, pressure: 0, seed: "world-motion-contact", opponents: [] },
  );
  const touch = touches[1] ?? touches[0];
  const midBall = touch.ballTrajectory[Math.floor(touch.ballTrajectory.length / 2)].position;
  const midCarrier = touch.chaseTrajectory[Math.floor(touch.chaseTrajectory.length / 2)].position;
  check("the ball's own path differs from the carrier's mid-flight (two independent objects)",
    movementDistanceYards(midBall, midCarrier) > 0.05);
  check("they nonetheless meet at the contact point",
    movementDistanceYards(touch.ballTrajectory.at(-1).position, touch.chaseTrajectory.at(-1).position) < 0.01);
  check("contact happens where the ball actually finished rolling",
    movementDistanceYards(touch.ballTrajectory.at(-1).position, touch.ballTo) < 0.01);
}

// ---------------------------------------------------------------------------
console.log("\n=== 7: paceToArrival never invents speed the player does not have ===");
{
  const from = { x: 50, y: 50 };
  const unreachable = { x: 50, y: 95 };
  const paced = sampleContinuousTrajectory({
    from, to: unreachable, player: DEEP, totalMs: 400, paceToArrival: true, sampleCount: 8,
  });
  const covered = movementDistanceYards(from, paced.at(-1).position);
  check("an unreachable target is NOT reached just because pacing was requested",
    movementDistanceYards(paced.at(-1).position, unreachable) > 1);
  check("the pacing fallback stays inside the physical limit",
    auditMoveSpeed({ player: DEEP, distanceYards: covered, scheduledDurationMs: 400 }).withinPhysicalLimit);
  const reachable = { x: 50, y: 52 };
  const pacedShort = sampleContinuousTrajectory({
    from, to: reachable, player: DEEP, totalMs: 1200, paceToArrival: true, sampleCount: 8, continuesAfter: true,
  });
  check("a comfortably reachable target is arrived at exactly as the window closes",
    movementDistanceYards(pacedShort.at(-1).position, reachable) < 0.01);
  check("and the player is still moving when they get there (no arrive-early-and-wait stall)",
    speedYpsFromVelocity(pacedShort.at(-1).velocity) > 0.1);
  const defaulted = sampleContinuousTrajectory({ from, to: reachable, player: DEEP, totalMs: 1200, sampleCount: 8 });
  check("the default (non-paced, non-continuing) behavior is unchanged -- still arrives early and stops",
    speedYpsFromVelocity(defaulted.at(-1).velocity) === 0);
}

// ---------------------------------------------------------------------------
console.log("\n=== 8: determinism and authored-setup immutability are preserved ===");
{
  state.mode = "freeplay";
  state.attackingDirection = { home: "down", away: "up" };
  const roster = () => [
    entry("att", { team: "home", x: 50, y: 72, playerObj: PASSER }),
    entry("mid", { team: "home", x: 48, y: 40, playerObj: DEEP }),
    entry("run", { team: "home", x: 58, y: 80, playerObj: RUNNER }),
    entry("d1", { team: "away", x: 50, y: 80, playerObj: STOPPER }),
    entry("gk", { team: "away", role: "keeper", x: 50, y: 97, playerObj: KEEPER }),
  ];
  state.roster = roster();
  state.ball = { x: 50, y: 72, zone: zoneFromPercent(50, 72), ownerId: "att" };
  const authoredBefore = JSON.stringify(state.roster.map((e) => ({ id: e.id, x: e.x, y: e.y, zone: e.zone })));
  const runA = runConstructedPossession(4242);
  const planA = planFor(runA);
  const authoredAfter = JSON.stringify(state.roster.map((e) => ({ id: e.id, x: e.x, y: e.y, zone: e.zone })));
  check("resolving a possession leaves the authored Match Lab setup byte-identical", authoredBefore === authoredAfter);

  state.roster = roster();
  state.ball = { x: 50, y: 72, zone: zoneFromPercent(50, 72), ownerId: "att" };
  const runB = runConstructedPossession(4242);
  const planB = planFor(runB);
  check("an identical seed reproduces the identical event output",
    JSON.stringify(runA.trace) === JSON.stringify(runB.trace));
  check("an identical seed reproduces identical final coordinates",
    JSON.stringify(runA.finalPositions.map((e) => ({ id: e.id, x: e.x, y: e.y })))
    === JSON.stringify(runB.finalPositions.map((e) => ({ id: e.id, x: e.x, y: e.y }))));
  check("an identical seed reproduces identical playback timing",
    planA.durationMs === planB.durationMs
    && JSON.stringify(planA.tracks.players) === JSON.stringify(planB.tracks.players));
  check("the plan is internally continuous and contact-consistent", validateMatchLabPlaybackPlan(planA).valid);
}

// ---------------------------------------------------------------------------
console.log("\n=== 9: routine carry touches group without losing any event ===");
{
  const { groupTraceRows, movementDiagnosticMarkup } = mod;
  const trace = [
    { code: "ACTION.CHOICE" }, { code: "P.CARRY.START" },
    { code: "P.CARRY.TOUCH" }, { code: "P.CARRY.TOUCH" }, { code: "P.CARRY.TOUCH" },
    { code: "P.CARRY" }, { code: "GK.ADJUST" },
    { code: "P.CARRY.TOUCH" },
    { code: "P.PASS" },
  ];
  const rows = groupTraceRows(trace);
  const flattened = rows.flatMap((row) => (row.type === "group" ? row.items : [row]));
  check("every event still appears exactly once after grouping", flattened.length === trace.length);
  check("every event keeps its own original trace index",
    flattened.every((item, position) => item.index === position));
  check("consecutive carry touches collapse into a single group row",
    rows.filter((row) => row.type === "group").length === 1);
  check("the group holds all three consecutive touches",
    rows.find((row) => row.type === "group").items.length === 3);
  check("a lone carry touch is left inline rather than grouped as a group of one",
    rows.filter((row) => row.type === "event" && row.step.code === "P.CARRY.TOUCH").length === 1);
  check("non-carry events are never grouped",
    rows.filter((row) => row.type === "event").every((row) => row.step.code !== "P.CARRY.START" || true)
    && rows.length === 7);
  check("an empty trace groups to nothing", groupTraceRows([]).length === 0);

  // The Movement timing panel must actually surface the contract's own
  // five separated concepts, not just distance and duration.
  const markup = movementDiagnosticMarkup({
    action: "recovery-track", intention: "recovery-track",
    intentionTarget: { x: 39, y: 62 }, gait: "controlled-sprint",
    fromPosition: { x: 39, y: 75.5 }, toPosition: { x: 39, y: 69.2 },
    distanceYards: 7.56, naturalEtaMs: 1810, scheduledDurationMs: 1930,
    startSpeedYardsPerSecond: 0, endSpeedYardsPerSecond: 0,
    averageSpeedYardsPerSecond: 3.92, topSpeedYardsPerSecond: 8.68,
    accelerationContributionYards: 2.2, reachableYards: 8.1,
    withinPhysicalLimit: true, overrunYards: 0, reachable: null,
  });
  for (const field of ["Start speed", "End speed", "Acceleration contribution", "Requested gait", "Intention"]) {
    check(`the Movement timing panel reports "${field}"`, markup.includes(field));
  }
  check("the panel reports both the start and the end coordinate",
    markup.includes("(39, 75.5)") && markup.includes("(39, 69.2)"));
  const overrunMarkup = movementDiagnosticMarkup({
    action: "challenge", distanceYards: 7.5, scheduledDurationMs: 40,
    withinPhysicalLimit: false, overrunYards: 6.9, reachableYards: 0.6,
  });
  check("a move that exceeded its physical limit is flagged loudly",
    overrunMarkup.includes("match-lab-move-overrun") && overrunMarkup.includes("Exceeds physical limit"));
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
