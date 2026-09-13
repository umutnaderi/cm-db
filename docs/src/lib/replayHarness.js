// Saved Scenario Replay Harness -- schema, capture/apply, checkpoint
// derivation, and regression assertions for reproducing a Match Lab Free
// Play possession outside the browser.
//
// Why this exists: match-lab.js's runConstructedPossession(seed) is
// already FULLY deterministic from two things alone -- the authored setup
// (state.database/roster/ball.ownerId/attackingDirection/marking/attacking)
// and a single `seed`. Every RNG stream it uses is independently derived
// as seededRandom(hashString(`match-lab:freeplay:<purpose>:${seed}:${actionsCount}`))
// (see that function's own header comment) -- a keyed/counter-based
// derivation, not a mutable stream threaded through state, so there is no
// separate "rngStreamStates" to persist: the seed alone reconstructs every
// stream any resolver will ever ask for. That makes a "saved scenario"
// exactly the authored pre-possession setup plus that seed -- nothing
// about a live simulation's current velocity/spin/RNG cursor needs
// capturing, because runConstructedPossession() always starts a possession
// fresh (freshBurst01(), createMotionState()) and re-derives everything
// else from the seed as it goes.
//
// A captured scenario is therefore the AUTHORITATIVE REPLAY INPUT: enough
// to reproduce a reported browser failure byte-for-byte in Node, with no
// dependency on the live player database/API (every roster entry embeds
// its own full player attribute object). This module is intentionally
// DOM-free and does not import match-lab.js itself (match-lab.js imports
// THIS module for capture) -- actually running a possession from a
// captured scenario is done by the caller (the browser page, or
// tools/test-replay-harness.mjs under a fake DOM, the same convention
// tools/test-possession-runner.mjs already established) via
// applyScenarioToState() + runConstructedPossession(scenario.seed).

import { sampleTrack } from "./matchLabPlayback.js";
import { yardDistance } from "./pitchGeometry.js";
import { measurePlaybackFluidity } from "./matchFluidityDiagnostics.js";

// Restart Execution v2 (2026-09-04) bumped this to 2: a scenario may now
// start from a DEAD BALL, which version 1 could not express at all
// (validateScenario() required a ballOwnerId naming a live possessor, and
// the runner had no way to execute a RESTART.*.TAKE). Version 2 adds the
// restart specification, the chosen taker, the concrete restart-role
// assignments, the dead/live starting state and each entry's formation
// anchor. Version 1 fixtures still load unchanged -- see
// applyScenarioToState()'s own version handling.
export const REPLAY_SCHEMA_VERSION = 2;
export const REPLAY_SUPPORTED_SCHEMA_VERSIONS = Object.freeze([1, 2]);
// Bump only when a change to runConstructedPossession()'s own RNG-stream
// derivation, resolver dispatch order, or authored-setup shape could make
// an OLD saved scenario replay differently than it did when captured --
// not for every unrelated engine change. Every captured scenario also
// records the engine build it was captured under (see captureScenario()),
// so a replay drift can be told apart from a genuine regression: same
// engineVersion + different result IS a regression; different
// engineVersion + different result may just mean the scenario needs
// re-capturing against the new build.
export const REPLAY_ENGINE_VERSION = "match-lab-freeplay-v1";

function deepClone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

// Mirrors match-lab.js's own zoneFromPercent() exactly. Duplicated (not
// imported) specifically to keep this module free of any match-lab.js
// dependency -- match-lab.js imports replayHarness.js for capture, so the
// reverse import would be a cycle. Six lines of pure arithmetic; if the
// zone grid ever changes, update both copies (same tolerance this
// codebase already accepts for hashString()'s own couple of duplicates,
// e.g. draftSquad.js).
export function zoneFromPercent(x, y) {
  const column = Math.min(2, Math.max(0, Math.floor(x / (100 / 3))));
  const row = Math.min(3, Math.max(0, Math.floor(y / 25)));
  return row * 3 + column;
}

// ---------------------------------------------------------------------------
// Capture / apply
// ---------------------------------------------------------------------------

/**
 * Builds a self-contained, JSON-serializable scenario snapshot from a Match
 * Lab-shaped `state` object (or an equivalent fixture with the same
 * fields), taken immediately before a possession is run. This is the
 * authoritative replay input -- everything runConstructedPossession(seed)
 * needs to reproduce the exact same possession again. Nothing
 * presentation-only (camera, CSS, mesh coordinates, easing) belongs here
 * and none is captured.
 *
 * `reason`/`tags` are free-text triage metadata (e.g. reason:
 * "through-ball receiver never reaches the delivery", tags: ["through-ball",
 * "loose-ball"]) -- not consumed by replay itself, only by a human (or a
 * later filter) sorting saved scenarios.
 *
 * `capturedAt` defaults to null, deliberately NOT a fresh wall-clock
 * timestamp: capture is meant to be a pure function of state/seed/reason,
 * reproducing byte-identical output for byte-identical input (match-lab.js's
 * own buildLastRun() relies on exactly this -- see
 * tools/test-possession-runner.mjs's "buildLastRun's stored record is
 * itself reproducible" test, which calls it twice back to back and expects
 * equal JSON). Provenance ("when was this actually saved") is genuinely
 * useful but belongs at the point something is ABOUT to be written to disk
 * once, not baked into every in-memory capture -- pass it explicitly there.
 */
// Match Setup Integration v1 (2026-09-04) -- OPTIONAL PROVENANCE.
//
// `matchSetup` records setup-panel provenance. At schema 2, `restart` is
// authoritative replay input: it restores the dead-ball specification,
// nominated taker and concrete role assignment before the runner executes
// the required first action.
export function captureScenario({
  state, seed, reason = null, tags = [], capturedAt = null,
  matchSetup = null, restart = null,
} = {}) {
  if (!state) throw new Error("captureScenario() requires a state object.");
  const resolvedSeed = seed ?? state.seed;
  if (resolvedSeed === undefined || resolvedSeed === null) {
    throw new Error("captureScenario() requires a seed (pass one explicitly or set state.seed).");
  }
  return {
    schemaVersion: REPLAY_SCHEMA_VERSION,
    engineVersion: REPLAY_ENGINE_VERSION,
    capturedAt,
    reason,
    tags: [...tags],
    seed: resolvedSeed,
    database: state.database ?? "",
    ballOwnerId: state.ball?.ownerId ?? null,
    // Optional provenance -- see captureScenario()'s own header. Present
    // only when the caller authored the setup through Match Lab's setup
    // panel; absent (null) for a hand-placed roster, and ignored entirely
    // by applyScenarioToState().
    matchSetup: matchSetup ? deepClone(matchSetup) : null,
    // Schema 2 -- the authored restart, in full. Unlike matchSetup above
    // this is genuine REPLAY INPUT when present: a dead-ball scenario
    // cannot be reproduced without knowing which restart, who takes it and
    // where every restart role stood.
    restart: restart ? deepClone(restart) : null,
    ballState: {
      phase: state.ball?.deadBall ? "dead" : (state.ball?.phase ?? "live"),
      deadBall: Boolean(state.ball?.deadBall),
      position: {
        x: Number(state.ball?.x) || 0,
        y: Number(state.ball?.y) || 0,
      },
    },
    attackingDirections: deepClone(state.attackingDirection || {}),
    tacticalSettings: {
      marking: deepClone(state.marking || {}),
      attacking: deepClone(state.attacking || {}),
      transition: deepClone(state.transition || {}),
      // A corner is resolved from the taking and defending teams' standing
      // corner plans, so a possession that ends in one cannot replay
      // identically without them. Optional: a scenario captured before this
      // field existed replays exactly as it always did, on the engine's own
      // defaults.
      cornerPlans: deepClone(state.cornerPlans || {}),
    },
    // Per-player authoritative replay input. velocity/facing are always
    // recorded (never omitted) even though a Free Play possession always
    // starts from rest -- runConstructedPossession() seeds its own fresh
    // burst01/match01 and motion state at the top of every call, never
    // carrying live velocity in from whatever state.roster happened to be
    // doing a moment before "Run" was pressed. Keeping the fields present
    // (zeroed) rather than absent means a future live-match capture point
    // (mid-possession, genuinely in motion) can populate them without a
    // breaking schema change -- see this module's header.
    roster: (state.roster || []).map((entry) => ({
      id: entry.id,
      role: entry.role,
      team: entry.team,
      positionalSlot: entry.positionalSlot ?? null,
      tacticalRole: entry.tacticalRole ?? null,
      duty: entry.duty ?? null,
      shootingInstruction: entry.shootingInstruction ?? "inherit",
      tempoInstruction: entry.tempoInstruction ?? "inherit",
      goalkeeperDistribution: entry.goalkeeperDistribution ?? null,
      goalkeeperSweeping: entry.goalkeeperSweeping ?? null,
      position: { x: Number(entry.x) || 0, y: Number(entry.y) || 0 },
      velocity: { x: 0, y: 0 },
      facing: null,
      // Schema 2 -- a restart roster's x/y is a TEMPORARY dead-ball
      // position; the anchor is where that shirt belongs once the ball is
      // live. Both are needed to reproduce a restart scenario.
      formationAnchor: entry.formationAnchor ? { ...entry.formationAnchor } : null,
      withBallAnchor: entry.withBallAnchor ? { ...entry.withBallAnchor } : null,
      withoutBallAnchor: entry.withoutBallAnchor ? { ...entry.withoutBallAnchor } : null,
      withBallAnchors: deepClone(entry.withBallAnchors || {}),
      withoutBallAnchors: deepClone(entry.withoutBallAnchors || {}),
      restartRole: entry.restartRole ?? null,
      restartSubjectId: entry.restartSubjectId ?? null,
      player: deepClone(entry.player),
    })),
  };
}

/**
 * Writes a captured scenario's authored setup onto a Match Lab-shaped
 * `state` object (or fixture), leaving every other field on it untouched.
 * Returns the scenario's own seed, which the caller then passes to
 * runConstructedPossession(seed) to actually replay it.
 */
export function applyScenarioToState(state, scenario) {
  if (!state || !scenario) throw new Error("applyScenarioToState() requires both a state object and a scenario.");
  if (!REPLAY_SUPPORTED_SCHEMA_VERSIONS.includes(scenario.schemaVersion)) {
    throw new Error(
      `Scenario schemaVersion ${scenario.schemaVersion} is not supported by this build `
      + `(supported: ${REPLAY_SUPPORTED_SCHEMA_VERSIONS.join(", ")}).`,
    );
  }
  state.database = scenario.database ?? "";
  state.attackingDirection = deepClone(scenario.attackingDirections || {});
  if (scenario.tacticalSettings?.marking) state.marking = deepClone(scenario.tacticalSettings.marking);
  if (scenario.tacticalSettings?.attacking) state.attacking = deepClone(scenario.tacticalSettings.attacking);
  if (scenario.tacticalSettings?.transition) state.transition = deepClone(scenario.tacticalSettings.transition);
  if (scenario.tacticalSettings?.cornerPlans) state.cornerPlans = deepClone(scenario.tacticalSettings.cornerPlans);
  state.roster = (scenario.roster || []).map((entry) => ({
    id: entry.id,
    role: entry.role,
    team: entry.team,
    positionalSlot: entry.positionalSlot ?? null,
    tacticalRole: entry.tacticalRole ?? null,
    duty: entry.duty ?? null,
    shootingInstruction: entry.shootingInstruction ?? "inherit",
    tempoInstruction: entry.tempoInstruction ?? "inherit",
    goalkeeperDistribution: entry.goalkeeperDistribution ?? null,
    goalkeeperSweeping: entry.goalkeeperSweeping ?? null,
    x: entry.position.x,
    y: entry.position.y,
    zone: zoneFromPercent(entry.position.x, entry.position.y),
    formationAnchor: entry.formationAnchor ? { ...entry.formationAnchor } : null,
    withBallAnchor: entry.withBallAnchor ? { ...entry.withBallAnchor } : null,
    withoutBallAnchor: entry.withoutBallAnchor ? { ...entry.withoutBallAnchor } : null,
    withBallAnchors: deepClone(entry.withBallAnchors || {}),
    withoutBallAnchors: deepClone(entry.withoutBallAnchors || {}),
    restartRole: entry.restartRole ?? null,
    restartSubjectId: entry.restartSubjectId ?? null,
    player: deepClone(entry.player),
  }));
  const restoredBall = scenario.ballState?.position
    ?? scenario.restart?.ball
    ?? state.roster.find((entry) => entry.id === scenario.ballOwnerId)
    ?? state.ball
    ?? { x: 50, y: 50 };
  state.ball = {
    ...(state.ball || {}),
    x: restoredBall.x,
    y: restoredBall.y,
    zone: zoneFromPercent(restoredBall.x, restoredBall.y),
    ownerId: scenario.ballOwnerId,
    phase: scenario.ballState?.phase ?? "live",
    deadBall: Boolean(scenario.ballState?.deadBall),
  };
  state.restartSetupDraft = scenario.restart ? deepClone(scenario.restart) : null;
  state.pendingRestart = scenario.restart
    ? {
        type: scenario.restart.type,
        requiredFirstAction: scenario.restart.requiredFirstAction,
        takerId: scenario.restart.takerId,
        takingTeam: scenario.restart.takingTeam,
      }
    : null;
  state.seed = scenario.seed;
  return scenario.seed;
}

/**
 * Validates a scenario's own internal shape (not whether replaying it
 * still reproduces the original failure -- that's runAssertions()'s job).
 * Returns { valid, errors }.
 */
export function validateScenario(scenario) {
  const errors = [];
  if (!scenario || typeof scenario !== "object") return { valid: false, errors: ["scenario is not an object"] };
  if (!REPLAY_SUPPORTED_SCHEMA_VERSIONS.includes(scenario.schemaVersion)) {
    errors.push(`unsupported schemaVersion ${scenario.schemaVersion}`);
  }
  if (scenario.seed === undefined || scenario.seed === null) errors.push("missing seed");
  if (!Array.isArray(scenario.roster) || !scenario.roster.length) errors.push("roster must be a non-empty array");
  // A dead-ball scenario still names a ball owner -- the player standing
  // over it -- so this check holds for both live and restart scenarios.
  if (scenario.ballOwnerId == null) errors.push("missing ballOwnerId");
  else if (!scenario.roster?.some((entry) => entry.id === scenario.ballOwnerId)) {
    errors.push(`ballOwnerId ${scenario.ballOwnerId} is not present in roster`);
  }
  if (scenario.restart) {
    if (!scenario.restart.requiredFirstAction) errors.push("restart is missing requiredFirstAction");
    if (!scenario.restart.takerId) errors.push("restart is missing a taker");
    else if (!scenario.roster?.some((entry) => entry.id === scenario.restart.takerId)) {
      errors.push(`restart taker ${scenario.restart.takerId} is not present in roster`);
    }
    if (!scenario.ballState?.deadBall || scenario.ballState?.phase !== "dead") {
      errors.push("a restart scenario must begin with an explicitly dead ball");
    }
    if (scenario.ballOwnerId !== scenario.restart.takerId) {
      errors.push("the dead-ball owner must be the nominated restart taker");
    }
    if (!Array.isArray(scenario.restart.roleAssignments)) {
      errors.push("restart is missing concrete roleAssignments");
    }
    for (const entry of scenario.roster || []) {
      if (!entry.formationAnchor
        || typeof entry.formationAnchor.x !== "number"
        || typeof entry.formationAnchor.y !== "number") {
        errors.push(`restart roster entry ${entry.id} is missing a formationAnchor`);
      }
    }
  }
  for (const entry of scenario.roster || []) {
    if (!entry.id) errors.push("a roster entry is missing id");
    if (!entry.player) errors.push(`roster entry ${entry.id} is missing an embedded player object`);
    if (!entry.position || typeof entry.position.x !== "number" || typeof entry.position.y !== "number") {
      errors.push(`roster entry ${entry.id} has an invalid position`);
    }
  }
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Checkpoints -- authoritative simulation moments, not rendered frames.
// ---------------------------------------------------------------------------

// Fields the renderer/debugger cares about are DERIVED here (speed, from
// velocity), never re-authored -- see this module's header on the
// authoritative/derived split.
function withSpeed(sample) {
  if (!sample?.velocity) return sample ? { ...sample, speed: null } : null;
  return { ...sample, speed: Math.hypot(sample.velocity.x, sample.velocity.y) };
}

function ownerIdAtTime(ownerTrack, timeMs) {
  let ownerId = null;
  let restart = null;
  for (const frame of ownerTrack || []) {
    if (frame.timeMs > timeMs + 1e-6) break;
    ownerId = frame.ownerId ?? null;
    restart = frame.restart ?? null;
  }
  return { ownerId, restart };
}

/**
 * Turns a matchLabPlayback plan (buildMatchLabPlaybackPlan()'s own return
 * value -- durationMs/tracks/cues/...) into the checkpoint list a debugger
 * or a second (e.g. 3D) renderer should actually consume: one entry per
 * real simulation event (plan.cues, one per trace entry), each carrying
 * every player's and the ball's authoritative position/velocity AT that
 * moment (via matchLabPlayback's own sampleTrack() -- at an exact
 * checkpoint timestamp this always resolves to the real keyframe, never an
 * interpolated in-between), not 60 interpolated visual frames per second.
 */
export function deriveCheckpoints(plan, trace = []) {
  if (!plan) return [];
  return plan.cues.map((cue) => {
    const { ownerId, restart } = ownerIdAtTime(plan.tracks.owner, cue.timeMs);
    const sourceEvent = trace[cue.eventIndex] || null;
    const players = {};
    for (const [id, track] of Object.entries(plan.tracks.players || {})) {
      const sample = sampleTrack(track, cue.timeMs);
      players[id] = sample ? { position: sample.position, velocity: sample.velocity ?? null, speed: withSpeed(sample).speed } : null;
    }
    const ballSample = sampleTrack(plan.tracks.ball, cue.timeMs);
    return {
      timeMs: cue.timeMs,
      eventIndex: cue.eventIndex,
      event: cue.code,
      label: cue.label,
      // The participant(s) this specific event names, straight off the
      // underlying trace entry (never re-derived) -- lets a consumer (e.g.
      // assertNoReceptionCollisions below) tell "the receiver, legitimately
      // standing on the ball's own arrival point" apart from every OTHER
      // player who has no reason to be there too.
      actorId: sourceEvent?.actorId ?? null,
      targetId: sourceEvent?.targetId ?? null,
      possession: ownerId,
      restart,
      players,
      ball: ballSample ? { position: ballSample.position, velocity: ballSample.velocity ?? null, speed: withSpeed(ballSample).speed } : null,
    };
  });
}

// ---------------------------------------------------------------------------
// Assertions -- run against one replayed possession (runOutput from
// runConstructedPossession(), plus the checkpoints derived above). Each
// returns { name, pass, detail }. Thresholds below are a deliberate first
// pass calibrated against the reported failures in new-issues.md, not a
// tuned final spec -- expect to adjust them as real scenarios accumulate.
// ---------------------------------------------------------------------------

const CHASE_CODES = /RECEIVER\.RUN|PURSUE|CHASE/;
const RECEIVE_CODES = /^P\.RECEIVE|^ATT\.RECEIVER/;

/** Passer/receiver does not pursue an unreachable ball indefinitely: the
 * same actor must not repeat the same chase-classified trace code back to
 * back more than twice without an intervening resolution. */
function assertNoStrandedChase(trace) {
  let streak = 0;
  let lastKey = null;
  let worstStreak = 0;
  let worstActor = null;
  for (const event of trace) {
    const isChase = CHASE_CODES.test(event.code || "");
    const key = isChase ? `${event.code}:${event.actorId ?? ""}` : null;
    if (isChase && key === lastKey) {
      streak += 1;
    } else {
      streak = isChase ? 1 : 0;
    }
    if (streak > worstStreak) { worstStreak = streak; worstActor = event.actorId ?? null; }
    lastKey = key;
  }
  return {
    name: "no-stranded-chase",
    pass: worstStreak <= 2,
    detail: worstStreak <= 2
      ? "no actor repeated the same chase action back to back more than twice"
      : `actor ${worstActor} repeated the same chase action ${worstStreak} times in a row without a resolution`,
  };
}

/** Ball decelerates and either stops, exits, or is recovered -- a
 * possession must never simply end with the ball still moving fast,
 * ownerless, and with no restart queued (i.e. resolution left it
 * physically hanging). */
function assertBallComesToRest(result, finalBallState) {
  const settled = Boolean(result?.restart)
    || finalBallState?.ownerId != null
    || finalBallState?.phase === "dead"
    || finalBallState?.phase === "held"
    || finalBallState?.phase === "controlled-ground";
  const speed = finalBallState?.velocity ? Math.hypot(finalBallState.velocity.x, finalBallState.velocity.y) : 0;
  const pass = settled || speed < 0.02;
  return {
    name: "ball-comes-to-rest",
    pass,
    detail: pass
      ? "the ball ended stopped, owned, or queued for a restart"
      : `the ball ended loose at speed ${speed.toFixed(3)} (%pitch/ms) with no owner and no restart`,
  };
}

/** A player must not lose most of their burst tank in the first handful of
 * on-ball actions -- a real reported complaint ("full-sprint denied") was
 * legitimate stamina-gating, but a burst crash this steep this fast is not
 * a realistic reading of the same system. Reads burst01 straight off
 * trace[].playerMoves[] in temporal order (the SAME per-instant reading
 * Stamina Bars v1 already records there -- see traceEvent()'s own
 * comment in match-lab.js), comparing each of a player's own first 4
 * on-ball readings against THEIR OWN first reading -- never against
 * finalPositions (the state at the very END of the whole possession,
 * which for a long possession reflects many more actions than just this
 * player's own opening few) and never against match01 (today's fitness
 * ceiling, not this player's own starting tank). */
function assertNoUnrealisticBurstCrash(trace) {
  const firstBurstByActor = new Map();
  const seenCountByActor = new Map();
  let worstRatio = 0;
  let worstId = null;
  for (const event of trace) {
    for (const move of event.playerMoves || []) {
      if (typeof move.burst01 !== "number") continue;
      const id = String(move.playerId);
      if (!firstBurstByActor.has(id)) firstBurstByActor.set(id, move.burst01);
      const seenCount = (seenCountByActor.get(id) || 0) + 1;
      seenCountByActor.set(id, seenCount);
      if (seenCount > 4) continue; // only this player's own opening handful of touches
      const baseline = firstBurstByActor.get(id);
      if (!baseline) continue;
      const lostRatio = 1 - (move.burst01 / baseline);
      if (lostRatio > worstRatio) { worstRatio = lostRatio; worstId = id; }
    }
  }
  const pass = worstRatio < 0.7;
  return {
    name: "no-unrealistic-burst-crash",
    pass,
    detail: pass
      ? "no player lost most of their own starting burst tank within their first 4 on-ball touches"
      : `player ${worstId} lost ${(worstRatio * 100).toFixed(0)}% of their own starting burst tank within their first 4 on-ball touches`,
  };
}

/** Three (or few) nearby teammates must not exchange low-value passes for
 * the full action cap while the ball remains trapped in the same small
 * area. Reaching the generic cap alone is not enough to diagnose that exact
 * bug: a varied sequence can include carries, duels and large territorial
 * movement yet happen to remain live. */
export function assertNoLowValuePassLoop(result, decisionMetrics, trace = []) {
  if (result?.reason !== "max-actions-reached") {
    return { name: "no-low-value-pass-loop", pass: true, detail: "the possession resolved before hitting the action cap" };
  }
  const metrics = decisionMetrics || [];
  const distinctOwners = new Set(metrics.map((entry) => entry.ownerId)).size;
  const escapeActions = metrics.filter((entry) =>
    ["carry", "dribble", "back-to-goal", "through", "cross", "shoot"].includes(entry.selectedAction)).length;
  const ballPoints = trace.flatMap((event) => [event.ballFrom, event.ballTo]).filter(Boolean);
  const origin = ballPoints[0] || null;
  const maxExcursionYards = origin
    ? Math.max(0, ...ballPoints.map((point) => yardDistance(origin, point)))
    : 0;
  const variedEnough = escapeActions >= Math.max(3, Math.ceil(metrics.length * 0.15));
  const leftTheCluster = maxExcursionYards >= 24;
  const pass = variedEnough && leftTheCluster;
  return {
    name: "no-low-value-pass-loop",
    pass,
    detail: pass
      ? `the cap was reached, but play included ${escapeActions} escape actions and moved ${maxExcursionYards.toFixed(1)}yd from its origin`
      : `the possession hit the ${metrics.length}-action cap around ${distinctOwners} owner(s), with only ${escapeActions} escape actions and ${maxExcursionYards.toFixed(1)}yd maximum displacement`,
  };
}

/** Players do not collide at reception coordinates: scoped to checkpoints
 * whose event is a reception (P.RECEIVE.x / ATT.RECEIVER.x), excluding the
 * event's own actor (who is SUPPOSED to be standing on the ball's arrival
 * point -- that's what a reception is). Any OTHER player found within
 * personal-space distance of someone at that exact moment has no such
 * excuse -- two entities correctly converging on the same football only
 * ever involves the actor (and, for a contest, an explicitly recorded
 * defender/keeper on the SAME event, also excluded). */
function assertNoReceptionCollisions(checkpoints, { minSeparationYards = 0.3 } = {}) {
  let worst = null;
  for (const checkpoint of checkpoints) {
    if (!RECEIVE_CODES.test(checkpoint.event || "")) continue;
    const excluded = new Set([checkpoint.actorId, checkpoint.targetId].filter((id) => id != null));
    const ids = Object.keys(checkpoint.players || {}).filter((id) => !excluded.has(id));
    for (let i = 0; i < ids.length; i += 1) {
      for (let j = i + 1; j < ids.length; j += 1) {
        const a = checkpoint.players[ids[i]]?.position;
        const b = checkpoint.players[ids[j]]?.position;
        if (!a || !b) continue;
        const distance = Math.hypot(a.x - b.x, a.y - b.y);
        if (distance < minSeparationYards && (!worst || distance < worst.distance)) {
          worst = { distance, a: ids[i], b: ids[j], event: checkpoint.event, timeMs: checkpoint.timeMs };
        }
      }
    }
  }
  return {
    name: "no-reception-collisions",
    pass: !worst,
    detail: !worst
      ? "no two players (other than the receiver) ever overlapped at a reception checkpoint"
      : `players ${worst.a} and ${worst.b} were only ${worst.distance.toFixed(2)} yards apart at "${worst.event}" (t=${worst.timeMs}ms), neither of them the receiver`,
  };
}

/**
 * A ball in someone's hands is wherever they are.
 *
 * A real reported bug (2026-09-07): during `GK.HOLD` the keeper walks the ball
 * around his box, and the event supplied only ballFrom/ballTo. Playback then
 * ran the ball along a straight line between those endpoints while the keeper
 * followed his real accelerate-and-settle trajectory over the same window.
 * They started and finished together and came apart in the middle -- measured,
 * over a six-second hold in which the keeper walked 3.29 yards, the ball drifted
 * up to 2.47 yards away from him, three quarters of the whole walk.
 *
 * Stated as an invariant rather than a test of that one event, because the
 * same mistake is available to any future event that moves a ball someone is
 * holding: while the ball's own state says "held", its holder must be within
 * arm's reach of it in every sampled frame.
 */
function assertHeldBallStaysWithHolder(plan, trace = [], { maxHoldGapYards = 2, stepMs = 40 } = {}) {
  let worst = null;
  let sampled = 0;
  // Keyed on the EVENT declaring the ball held, not on the ball track's own
  // state label. The label is written by whatever authored the trajectory, so
  // an event that supplies no trajectory at all -- exactly the bug this
  // guards -- would never carry it, and the assertion would pass by never
  // looking. `ballResult: "held"` is the resolver's own statement that this
  // ball is in someone's hands, and it is there whether or not a path was
  // authored for it.
  for (const interval of plan.intervals ?? []) {
    if (trace[interval.eventIndex]?.ballResult !== "held") continue;
    for (let time = interval.startMs; time <= interval.endMs; time += stepMs) {
      const ball = sampleTrack(plan.tracks.ball, time);
      const { ownerId } = ownerIdAtTime(plan.tracks.owner, time);
      if (!ball || !ownerId) continue;
      const holder = sampleTrack(plan.tracks.players[ownerId], time)?.position;
      if (!holder) continue;
      sampled += 1;
      const gap = yardDistance(holder, ball.position);
      if (gap > maxHoldGapYards && (!worst || gap > worst.gap)) {
        worst = { gap, timeMs: time, holderId: ownerId, code: interval.code };
      }
    }
  }
  return {
    name: "held-ball-stays-with-holder",
    pass: !worst,
    detail: worst
      ? `during ${worst.code} the ball was ${worst.gap.toFixed(2)} yards from ${worst.holderId}, who was holding it, at t=${Math.round(worst.timeMs)}ms`
      : `held-ball frames sampled: ${sampled}; the ball never left its holder`,
  };
}

/** Every possession either progresses, changes phase, produces a contest,
 * shoots, or terminates -- i.e. the resolver loop must always come back
 * with a real, understood outcome, never an unresolved/crashed one. */
function assertPossessionResolves(result) {
  const pass = Boolean(result) && result.terminal === true && typeof result.reason === "string" && result.reason.length > 0;
  return {
    name: "possession-resolves",
    pass,
    detail: pass ? `possession terminated with reason "${result.reason}"` : "possession ended without a real terminal result/reason",
  };
}

/**
 * Runs the full assertion suite against one replayed possession.
 * `runOutput` is runConstructedPossession()'s own return value; `plan` is
 * buildMatchLabPlaybackPlan()'s return value for the same run (the caller
 * builds both -- see tools/test-replay-harness.mjs for the Node
 * convention, or match-lab.js's own buildPlaybackPlan() in the browser).
 */
/**
 * Playback Fluidity v1 (2026-09-05) -- an ORPHANED interval is one that
 * occupies real wall clock, authors no player movement of its own, and has
 * nothing overlapping it that does. It is the precise shape of the reported
 * "players freeze" bug: a contest is resolved, the caption changes, and all
 * 22 players stand perfectly still while it happens.
 *
 * This is deliberately about the AUTHORED timeline, not the renderer. A
 * frozen plan cannot be rescued by smoother interpolation, and a diagnostic
 * that measured rendered frames would hide exactly the defect that matters.
 */
function assertNoOrphanedIntervals(plan, { maxOrphanMs = 200 } = {}) {
  const metrics = measurePlaybackFluidity(plan);
  const worst = metrics.orphanedIntervals.filter(i => i.durationMs > maxOrphanMs)
    .sort((a,b) => b.durationMs-a.durationMs)[0];
  return { name: "no-orphaned-intervals", pass: !worst,
    detail: worst ? `${worst.code}: ${Math.round(worst.durationMs)}ms without ball or player evolution at ${Math.round(worst.startMs)}ms`
      : "every physical interval is covered by ball/player evolution or a legal stoppage" };
}

function assertNoFrozenPlayback(plan, { maxStillMs = 500, stepMs = 20 } = {}) {
  const metrics = measurePlaybackFluidity(plan, { stepMs });
  return { name: "no-frozen-playback", pass: metrics.longestFreezeMs <= maxStillMs,
    detail: `longest fully static live interval: ${Math.round(metrics.longestFreezeMs)}ms; ${metrics.fullyStaticPercent.toFixed(2)}% static; player-only stillness separately: ${Math.round(metrics.playerStaticMs)}ms` };
}

function samplePlanFrame(plan, timeMs) {
  const frame = {};
  for (const [id, track] of Object.entries(plan.tracks.players)) {
    const sample = sampleTrack(track, timeMs);
    if (sample) frame[id] = sample.position;
  }
  return frame;
}

export function runAssertions(runOutput, plan) {
  const checkpoints = deriveCheckpoints(plan, runOutput.trace);
  return {
    checkpoints,
    findings: [
      assertPossessionResolves(runOutput.result),
      assertNoLowValuePassLoop(runOutput.result, runOutput.decisionMetrics, runOutput.trace),
      assertBallComesToRest(runOutput.result, runOutput.finalBallState),
      assertNoStrandedChase(runOutput.trace),
      assertNoUnrealisticBurstCrash(runOutput.trace),
      assertNoReceptionCollisions(checkpoints),
      assertHeldBallStaysWithHolder(plan, runOutput.trace),
      assertNoOrphanedIntervals(plan),
      assertNoFrozenPlayback(plan),
    ],
  };
}
