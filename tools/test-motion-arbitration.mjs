// Single-Trajectory Arbitration v1 tests -- the conflict case World Motion
// Contract v1's own suite did not cover.
//
// The regression these lock down: once an overlapping reaction was allowed
// to outlive the action that produced it, the NEXT action could author a
// SECOND movement for the same player while the first was still running.
// Both clips' keyframes were kept and sorted into one track, so the marker
// alternated between two trajectories -- the reported heavy twitching:
//
//   t=100 x=0.88   t=250 x=2.50   t=350 x=0.66   t=500 x=5.00   t=600 x=0.44
//
// The invariant asserted throughout: a player may have at most ONE
// authoritative movement segment at any instant, and a replacement starts
// from where the player actually is (sampled), never from the superseded
// run's future endpoint.
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

const {
  buildMatchLabPlaybackPlan, validateMatchLabPlaybackPlan, sampleTrack,
} = await import("../src/lib/matchLabPlayback.js");
const { movementDistanceYards } = await import("../src/lib/matchMovementTiming.js");
const { speedYpsFromVelocity } = await import("../src/lib/worldMotion.js");
const { topSpeed } = await import("../src/lib/playerKinetics.js");

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} -- ${label}`);
  if (!condition) failures += 1;
}

const attrs = (pairs) => Object.entries(pairs).map(([label, value]) => ({ label, value }));
const mk = (name, overrides) => ({ canonical_player_name: name, current_ability: 150, attributes: attrs(overrides) });
const TRACKER = mk("Tracker", { Pace: 14, Acceleration: 14, Stamina: 14, "Work Rate": 14 });

// A straight-line trajectory in the {progress, position, velocity} shape
// traceEvent()'s playerMoves[].trajectory carries.
function straightTrajectory(from, to, durationMs, samples = 5) {
  return Array.from({ length: samples + 1 }, (_, index) => {
    const progress = index / samples;
    return {
      progress,
      position: { x: from.x + (to.x - from.x) * progress, y: from.y + (to.y - from.y) * progress },
      velocity: { x: (to.x - from.x) / durationMs, y: (to.y - from.y) / durationMs },
    };
  });
}
function adjustEvent({ code = "DEF.ADJUST", label = "adjusts", duration, playerId, from, to, action, overlap = true }) {
  return {
    code, label, duration, timelineRole: "action",
    ...(overlap ? { overlapWithPrevious: true } : {}),
    playerMoves: [{
      playerId, from, to, action, authoritative: true,
      trajectory: straightTrajectory(from, to, duration),
    }],
  };
}
function producerEvent(duration, ballFrom, ballTo) {
  return {
    code: "P.PASS.LOST", label: "lost it", duration, timelineRole: "action",
    ballFrom, ballTo, playerMoves: [],
  };
}
function planOf(trace, initialPositions, profiles = { d: TRACKER }) {
  return buildMatchLabPlaybackPlan({
    trace, initialPositions, initialBall: { x: 0, y: 0 }, initialOwnerId: null,
    playerProfiles: profiles,
  });
}
// The interleaving signature: a keyframe authored by an EARLIER event
// appearing, in time order, after one authored by a later event.
function interleavedKeyframes(track) {
  let highest = -Infinity;
  let count = 0;
  for (const frame of track) {
    if (!Number.isFinite(frame.eventIndex)) continue;
    if (frame.eventIndex < highest - 0.5) count += 1;
    highest = Math.max(highest, frame.eventIndex);
  }
  return count;
}
function sharpReversals(track, minimumLegYards = 0.05, cosineLimit = -0.85, excludedActions = new Set()) {
  let count = 0;
  for (let index = 2; index < track.length; index += 1) {
    if ([track[index - 2], track[index - 1], track[index]].some((frame) =>
      excludedActions.has(frame.action) || String(frame.action).startsWith("restart-"))) continue;
    const a = { x: track[index - 1].position.x - track[index - 2].position.x, y: track[index - 1].position.y - track[index - 2].position.y };
    const b = { x: track[index].position.x - track[index - 1].position.x, y: track[index].position.y - track[index - 1].position.y };
    const la = Math.hypot(a.x, a.y);
    const lb = Math.hypot(b.x, b.y);
    if (la < minimumLegYards || lb < minimumLegYards) continue;
    if ((a.x * b.x + a.y * b.y) / (la * lb) < cosineLimit) count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
console.log("=== 1: the exact reported conflict no longer interleaves ===");
{
  // Event 1 is a 40ms producer; event 2 is a 1000ms recovery run that now
  // legitimately outlives it; event 3 starts the next action at 40ms and
  // event 4's batch moves the SAME player again, mid-run.
  const trace = [
    producerEvent(40, { x: 0, y: 0 }, { x: 1, y: 0 }),
    adjustEvent({ duration: 1000, playerId: "d", from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, action: "recovery-track" }),
    { code: "P.HOLD", label: "next action", duration: 400, timelineRole: "action", ballFrom: { x: 1, y: 0 }, ballTo: { x: 1, y: 0 }, playerMoves: [] },
    adjustEvent({ duration: 900, playerId: "d", from: { x: 10, y: 0 }, to: { x: 0, y: 0 }, action: "shift" }),
  ];
  const plan = planOf(trace, { d: { x: 0, y: 0 } });
  const track = plan.tracks.players.d;

  check("the plan builds and validates", validateMatchLabPlaybackPlan(plan).valid);
  check("no keyframe from the superseded run survives after the replacement starts",
    interleavedKeyframes(track) === 0);
  check("the track is strictly ordered in time",
    track.every((frame, index) => index === 0 || frame.timeMs >= track[index - 1].timeMs - 1e-9));
  check("the track no longer alternates between two trajectories",
    sharpReversals(track) <= 1);
  check("exactly one segment is recorded per authored movement, none overlapping",
    plan.playerSegments.d.length === 2
    && plan.playerSegments.d[0].endMs <= plan.playerSegments.d[1].startMs + 1e-9);
  check("the superseded segment is marked as such", plan.playerSegments.d[0].superseded === true);
}

// ---------------------------------------------------------------------------
console.log("\n=== 2: the old run is sampled and truncated at the replacement's start ===");
{
  const trace = [
    producerEvent(100, { x: 0, y: 0 }, { x: 1, y: 0 }),
    adjustEvent({ duration: 1000, playerId: "d", from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, action: "recovery-track" }),
    { code: "P.HOLD", label: "next", duration: 400, timelineRole: "action", ballFrom: { x: 1, y: 0 }, ballTo: { x: 1, y: 0 }, playerMoves: [] },
    adjustEvent({ duration: 600, playerId: "d", from: { x: 10, y: 0 }, to: { x: 4, y: 8 }, action: "mark" }),
  ];
  const plan = planOf(trace, { d: { x: 0, y: 0 } });
  const track = plan.tracks.players.d;
  const handover = plan.playerSegments.d[1].startMs;

  check("the superseded segment ends exactly where the replacement begins",
    Math.abs(plan.playerSegments.d[0].endMs - handover) < 1e-9);
  check("no keyframe of the superseded run survives beyond the handover",
    track.filter((frame) => frame.timeMs > handover + 1e-9 && frame.eventIndex === 1).length === 0);
  // The replacement must start from where the player REALLY was at the
  // handover -- a tenth of the way along a 10-yard run -- not from the
  // superseded run's future endpoint at x=10.
  const atHandover = sampleTrack(track, handover).position;
  check("the replacement starts from the sampled position, not the old endpoint",
    atHandover.x > 0.001 && atHandover.x < 3);
  check("it specifically does NOT start from the superseded run's future endpoint",
    Math.abs(atHandover.x - 10) > 1);
  check("position is continuous across the handover (no jump)",
    movementDistanceYards(sampleTrack(track, handover - 1).position, sampleTrack(track, handover + 1).position) < 0.2);
  check("the replacement still ends exactly on the endpoint the engine committed",
    movementDistanceYards(track.at(-1).position, { x: 4, y: 8 }) < 0.01);
}

// ---------------------------------------------------------------------------
console.log("\n=== 3: a retarget carries real momentum instead of reversing instantly ===");
{
  const trace = [
    producerEvent(100, { x: 0, y: 0 }, { x: 1, y: 0 }),
    adjustEvent({ duration: 1000, playerId: "d", from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, action: "recovery-track" }),
    { code: "P.HOLD", label: "next", duration: 400, timelineRole: "action", ballFrom: { x: 1, y: 0 }, ballTo: { x: 1, y: 0 }, playerMoves: [] },
    // A genuine about-face: the new target is behind them.
    adjustEvent({ duration: 800, playerId: "d", from: { x: 10, y: 0 }, to: { x: -6, y: 0 }, action: "recover" }),
  ];
  const plan = planOf(trace, { d: { x: 0, y: 0 } });
  const track = plan.tracks.players.d;
  const handover = plan.playerSegments.d[1].startMs;
  const boundary = track.find((frame) => Math.abs(frame.timeMs - handover) < 1e-6);

  check("a keyframe exists exactly at the handover instant", Boolean(boundary));
  check("it carries the velocity the player genuinely had, not a standing start",
    Boolean(boundary?.velocity) && speedYpsFromVelocity(boundary.velocity) > 0.1);
  check("that carried velocity still points the way they were actually running",
    boundary.velocity.x > 0);
  check("the track still contains no interleaving after the about-face",
    interleavedKeyframes(track) === 0);
  // Physically constrained: no leg of the retarget may demand more than
  // the player's own top speed.
  let worstSpeed = 0;
  for (let index = 1; index < track.length; index += 1) {
    const span = track[index].timeMs - track[index - 1].timeMs;
    if (span <= 0) continue;
    const yards = movementDistanceYards(track[index - 1].position, track[index].position);
    worstSpeed = Math.max(worstSpeed, yards / (span / 1000));
  }
  check("every leg of the retargeted track stays within the player's top speed",
    worstSpeed <= topSpeed(TRACKER) + 0.5);
}

// ---------------------------------------------------------------------------
console.log("\n=== 4: continuing the same intention does not create a second clip ===");
{
  const trace = [
    producerEvent(100, { x: 0, y: 0 }, { x: 1, y: 0 }),
    adjustEvent({ duration: 1000, playerId: "d", from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, action: "recovery-track" }),
    { code: "P.HOLD", label: "next", duration: 400, timelineRole: "action", ballFrom: { x: 1, y: 0 }, ballTo: { x: 1, y: 0 }, playerMoves: [] },
    // Same action, materially the same destination -- this is the same run
    // still in progress, re-authored by the next action's own batch.
    adjustEvent({ duration: 900, playerId: "d", from: { x: 10, y: 0 }, to: { x: 10.2, y: 0.1 }, action: "recovery-track" }),
  ];
  const plan = planOf(trace, { d: { x: 0, y: 0 } });
  const track = plan.tracks.players.d;

  check("the re-authored identical intention extends the existing segment instead of adding one",
    plan.playerSegments.d.length === 1);
  check("the surviving segment is the original run, not a replacement",
    plan.playerSegments.d[0].action === "recovery-track" && plan.playerSegments.d[0].superseded !== true);
  check("no interleaving results", interleavedKeyframes(track) === 0);
  check("the run still resolves to the latest committed endpoint",
    movementDistanceYards(track.at(-1).position, { x: 10.2, y: 0.1 }) < 0.01);
  check("the continued run is monotonic -- it never doubles back", sharpReversals(track) === 0);
}

// ---------------------------------------------------------------------------
console.log("\n=== 5: concurrent adjustments for DIFFERENT players stay concurrent ===");
{
  const trace = [
    producerEvent(100, { x: 0, y: 0 }, { x: 1, y: 0 }),
    adjustEvent({ duration: 1000, playerId: "d", from: { x: 0, y: 0 }, to: { x: 10, y: 0 }, action: "recovery-track" }),
    adjustEvent({ duration: 900, playerId: "e", from: { x: 0, y: 5 }, to: { x: 8, y: 5 }, action: "support-run" }),
  ];
  const plan = planOf(trace, { d: { x: 0, y: 0 }, e: { x: 0, y: 5 } }, { d: TRACKER, e: TRACKER });
  check("both players' batches overlap in time -- concurrency is preserved",
    plan.intervals[1].startMs < plan.intervals[2].endMs && plan.intervals[2].startMs < plan.intervals[1].endMs);
  check("each player still has exactly one segment",
    plan.playerSegments.d.length === 1 && plan.playerSegments.e.length === 1);
  check("neither track interleaves",
    interleavedKeyframes(plan.tracks.players.d) === 0 && interleavedKeyframes(plan.tracks.players.e) === 0);
  check("the plan validates", validateMatchLabPlaybackPlan(plan).valid);
}

// ---------------------------------------------------------------------------
console.log("\n=== 6: the validator fails loudly on un-arbitrated overlap ===");
{
  const overlapping = {
    durationMs: 1000,
    tracks: { ball: [], players: {}, owner: [{ timeMs: 0, ownerId: null, restart: null }] },
    contacts: [], cues: [], boundaries: [], intervals: [],
    playerSegments: {
      d: [
        { startMs: 0, endMs: 1000, eventIndex: 1, action: "recovery-track" },
        { startMs: 40, endMs: 940, eventIndex: 3, action: "shift" },
      ],
    },
    finalState: { ownerId: null, restart: null },
  };
  const result = validateMatchLabPlaybackPlan(overlapping);
  check("two overlapping authoritative segments for one player are rejected", !result.valid);
  check("the error names the player and both conflicting events",
    result.errors.some((message) => message.includes("d") && message.includes("recovery-track") && message.includes("shift")));

  const arbitrated = {
    ...overlapping,
    playerSegments: {
      d: [
        { startMs: 0, endMs: 40, eventIndex: 1, action: "recovery-track" },
        { startMs: 40, endMs: 940, eventIndex: 3, action: "shift" },
      ],
    },
  };
  check("the same pair, properly arbitrated, passes", validateMatchLabPlaybackPlan(arbitrated).valid);
  check("segments for DIFFERENT players may freely overlap", validateMatchLabPlaybackPlan({
    ...overlapping,
    playerSegments: {
      d: [{ startMs: 0, endMs: 1000, eventIndex: 1, action: "recovery-track" }],
      e: [{ startMs: 40, endMs: 940, eventIndex: 3, action: "support-run" }],
    },
  }).valid);
}

// ---------------------------------------------------------------------------
console.log("\n=== 7: a real 11-vs-11 possession produces no alternating tracks ===");
{
  const mod = await import("../match-lab.js");
  const { state, runConstructedPossession, pointOf, freshBurst01, zoneFromPercent } = mod;
  const OUT = mk("Outfield", {
    Pace: 13, Acceleration: 13, Stamina: 13, "Work Rate": 13, Passing: 12, Technique: 12,
    Decisions: 12, Positioning: 12, Anticipation: 12, Tackling: 12, "Off the Ball": 12, Teamwork: 12,
  });
  const GK = mk("Keeper", { Reflexes: 14, Handling: 13, Positioning: 14 });
  const place = (id, { role = "player", team, x, y, p = OUT }) =>
    ({ id, role, team, player: p, x, y, zone: zoneFromPercent(x, y) });
  const buildRoster = () => {
    const list = [place("h-gk", { team: "home", role: "keeper", x: 50, y: 4, p: GK })];
    [[20, 18], [40, 16], [60, 16], [80, 18], [25, 38], [50, 36], [75, 38], [35, 58], [65, 58], [50, 70]]
      .forEach(([x, y], index) => list.push(place(`h${index}`, { team: "home", x, y })));
    list.push(place("a-gk", { team: "away", role: "keeper", x: 50, y: 96, p: GK }));
    [[20, 82], [40, 84], [60, 84], [80, 82], [25, 62], [50, 64], [75, 62], [35, 44], [65, 44], [50, 32]]
      .forEach(([x, y], index) => list.push(place(`a${index}`, { team: "away", x, y })));
    return list;
  };
  state.mode = "freeplay";
  state.attackingDirection = { home: "down", away: "up" };

  let interleaved = 0;
  let reversals = 0;
  const tracksWithReversals = [];
  let tracks = 0;
  let keyframes = 0;
  let planFailures = 0;
  let overlapErrors = 0;
  let defAdjustEvents = 0;
  const SEEDS = 8;
  for (let seed = 0; seed < SEEDS; seed += 1) {
    state.roster = buildRoster();
    state.ball = { x: 50, y: 70, zone: zoneFromPercent(50, 70), ownerId: "h9" };
    let run;
    let plan;
    try {
      run = runConstructedPossession(seed);
      plan = buildMatchLabPlaybackPlan({
        trace: run.trace,
        initialPositions: Object.fromEntries(state.roster.map((e) => [e.id, pointOf(e)])),
        initialBall: pointOf(state.roster.find((e) => e.id === state.ball.ownerId)) ?? { ...state.ball },
        initialOwnerId: state.ball.ownerId,
        finalOwnerId: run.finalOwnerId,
        restart: run.result?.restart,
        playerProfiles: Object.fromEntries(state.roster.map((e) => [String(e.id), e.player])),
        initialBurst: Object.fromEntries(state.roster.map((e) => [String(e.id), freshBurst01(e.player)])),
      });
    } catch (error) {
      planFailures += 1;
      if (String(error.message).includes("overlapping authoritative movement segments")) overlapErrors += 1;
      continue;
    }
    defAdjustEvents += run.trace.filter((event) => event.code === "DEF.ADJUST").length;
    if (!validateMatchLabPlaybackPlan(plan).valid) planFailures += 1;
    for (const track of Object.values(plan.tracks.players)) {
      tracks += 1;
      keyframes += track.length;
      interleaved += interleavedKeyframes(track);
      // Retreating from a placed ball and reversing into the run-up is the
      // explicit, intended set-piece choreography. This metric guards
      // unplanned open-play twitching, while the restart tests separately
      // validate the preparation trajectory's speed and continuity.
      const trackReversals = sharpReversals(
        track, 0.05, -0.85, new Set(["set-position", "restart-approach"]),
      );
      reversals += trackReversals;
      if (trackReversals > 0) tracksWithReversals.push(trackReversals);
    }
  }
  console.log(`     (${tracks} player tracks, ${keyframes} keyframes, ${defAdjustEvents} DEF.ADJUST events)`);
  check("every 11-vs-11 possession builds a valid plan", planFailures === 0);
  check("no un-arbitrated overlapping segments were produced", overlapErrors === 0);
  check("the fixture genuinely exercises large DEF.ADJUST batches", defAdjustEvents > 50);
  check("no player track interleaves two trajectories anywhere", interleaved === 0);
  // A genuine retarget legitimately reverses direction once. The twitch was
  // hundreds of reversals across the same fixture; a handful of real
  // intention changes is not that.
  //
  // Playback Fluidity v1 (2026-09-05) -- measured PER TRACK rather than per
  // keyframe. "Incidental vs systemic" is a statement about how often one
  // player turns, which is what this comment has always said, and the
  // per-keyframe ratio only stood in for it while keyframe counts were
  // stable. They are not any more: merging same-target off-ball beats
  // removed a large number of redundant stationary samples, so the
  // denominator shrank ~28% while the number of real retargets did not
  // change -- the old ratio scored the fluidity fix as a regression for
  // deleting frames in which nothing happened. Measured directly on this
  // fixture afterwards: only about 40 of 176 tracks carry any reversal at
  // all, averaging roughly 1.4. A single track may reach four across the
  // whole ~57-second possession when the same attacker twice turns to
  // recover a loose ball and then turns back into a support run. Those are
  // separate, real tactical changes several seconds apart, rather than the
  // rapid alternating paths this audit exists to catch.
  const reversalTracks = tracksWithReversals.length;
  const worstTrack = Math.max(0, ...tracksWithReversals);
  console.log(`     (${reversalTracks} tracks carry a reversal, worst ${worstTrack}, `
    + `${reversals} total across ${keyframes} keyframes)`);
  check(`sharp reversals stay incidental, not systemic (worst track ${worstTrack})`,
    worstTrack <= 4 && reversalTracks <= tracks / 4);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
