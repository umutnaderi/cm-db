import {
  getDatabases,
  getDraftCandidates,
  getPlayerMetrics,
  searchPlayers,
} from "./src/lib/retroballApi.js?v=20260818-66";
import {
  clamp,
  computePressure,
  contestedRace,
  engineAttributeDetail,
  freeKickContextMultiplier,
  hashString,
  headerScore,
  isGoalkeeper,
  localizedDuel,
  playerAttribute,
  playerName,
  normalizedAttributeLabel,
  rawPlayerAttributeMap,
  poacherScore,
  resolveDelivery,
  resolveEngagement,
  resolveFinishAttempt,
  resolveFoul,
  resolveFreeKickAttempt,
  resolveChipAttempt,
  resolveClearanceAttempt,
  resolveCrossDelivery,
  resolveCrossSourceContest,
  resolveKeeperSave,
  resolveOneOnOne,
  resolvePlacedFinish,
  resolveReceive,
  resolveRoundKeeper,
  resolveShotBlock,
  resolveSquarePass,
  resolveTargetedKeeperResponse,
  resolveWall,
  seededRandom,
  selectEngagement,
  selectFinishType,
  selectFreeKickShotType,
  selectReceiver,
  transitionShotChance,
  weightedPlayer,
  ZONE_CENTERS,
} from "./src/lib/matchEngineCore.js?v=20260820-02";
import {
  getMasterVolume,
  isSoundEnabled,
  playCue,
  playEvent,
  preloadCore,
  resolveCueSequence,
  setEnabled as setSoundEnabled,
  setMasterVolume,
  setTrainingMode,
  stopAll as stopAllSound,
  unlock as unlockSound,
} from "./src/lib/matchSound.js?v=20260821-02";
import {
  chooseOneOnOneAction,
  perceiveKeeperState,
} from "./src/lib/oneOnOneDecision.js?v=20260820-02";
import {
  approachPoint,
  canSlidingTackle,
  canStandingTackle,
  chooseCandidate,
  classifyOutfieldBand,
  clearanceDanger,
  crossSourceContestDefender,
  decisionOptionMetrics,
  deliveryLandingPoint,
  determineCarryGait,
  DUEL_RANGE_YARDS,
  engagingOpponent,
  generateClearanceCandidates,
  generateFreePlayCandidates,
  isCrossTargetZone,
  keeperPositioningPoint,
  nearestLaneInterceptor,
  PITCH_LENGTH_YARDS,
  offsideSnapshotForTarget,
  planAttackerRepositioning,
  planCarryDestination,
  planCarryTouches,
  planDefensiveRepositioning,
  pressureAt,
  distanceToGoalYards,
  fromYardPoint,
  toYardPoint,
  yardDistance,
} from "./src/lib/spatialDecision.js?v=20260819-06";
import {
  buildMatchLabPlaybackPlan,
  createMatchLabPlaybackClock,
  MATCH_LAB_PLAYBACK_BUILD,
} from "./src/lib/matchLabPlayback.js?v=20260820-05";
import {
  contactArrivalTiming,
  sampleContinuousTrajectory,
  earliestReachableInterception,
  CONTACT_REACTION_DELAY_MS,
} from "./src/lib/matchMovementTiming.js?v=20260820-03";
import { timeToReach } from "./src/lib/playerKinetics.js?v=20260820-01";
import {
  selectPassType,
  passFlightProfile,
  buildPassFlight,
  earliestReachableContact,
} from "./src/lib/matchPassFlight.js?v=20260820-03";
import {
  createMotionState,
  resolveMotionBatch,
} from "./src/lib/matchMotion.js?v=20260818-02";
import {
  buildBallTrajectory,
  createBallState,
  selectLooseBallRecovery,
  transitionBallState,
} from "./src/lib/matchBallCore.js?v=20260818-06";
import {
  GOAL_WIDTH_YARDS,
  PITCH_WIDTH_YARDS,
} from "./src/lib/pitchGeometry.js";

if (document.documentElement)
  document.documentElement.dataset.matchLabPlaybackBuild =
    MATCH_LAB_PLAYBACK_BUILD;

// Match Lab is a training ground, not a live match -- see the file-level
// call sites of setTrainingMode() and applyStepAnimation()'s cueSequence
// comment for what this actually changes (no crowd-bus cues, ever, plus a
// couple of individual samples that were fine for a live match but wrong
// here -- see matchSound.js's TRAINING_EXCLUDED_VARIANTS).
setTrainingMode(true);

// Match Lab -- a probe for the real match engine (see MATCH_LAB_PLAN.md).
// Every scenario/resolution below calls the exact resolver functions
// draft-run.js itself calls; nothing here re-derives or approximates engine
// logic. The pitch is a 12-zone grid because that's genuinely all the
// engine reasons about today -- placement is free-dragged for a natural
// feel, but every marker's engine zone is shown right alongside its visual
// position rather than implying precision the engine doesn't have.
//
// Two modes:
// - Free Play: given a constructed roster, a new Match-Lab-only chooser
//   decides which action to attempt (there's no callable "what would the
//   engine try" function -- see MATCH_LAB_PLAN.md, Phase 3), then the real
//   engine resolves whatever was chosen.
// - Scenario Probe: you pick the scenario, supply its actors, and the real
//   engine resolves the outcome directly -- no choice layer at all.

const FIXED_MINUTE = 45;
// Scenario Probe still needs every one of these typed slots -- each
// scenario's own run() reads byRole.attacker[0]/byRole.defender/
// byRole.wall/etc directly (see SCENARIOS below), so none of them can be
// removed. "player" is the one addition, Free-Play-only (see
// FREE_PLAY_ROLE_KEYS below): Free Play never reads entry.role for
// anything except distinguishing the keeper from everyone else
// (freePlayGroups()'s own `entry.role === "keeper"` check) -- who's an
// "attacker," a "receiver," or a "pass candidate" is entirely a function
// of who currently has the ball and which team they're on, not a label
// assigned ahead of time (see generateFreePlayCandidates()/
// freePlayGroups()). Assigning Attacker/Receiver/Defender/Pass-candidate
// in Free Play was always cosmetic noise inherited from this same
// dropdown being shared with Probe mode, never actually read by any
// Free Play resolver.
const ROLE_LABELS = {
  attacker: "Attacker",
  receiver: "Receiver",
  defender: "Defender",
  keeper: "Keeper",
  wall: "Wall defender",
  candidate: "Pass candidate",
  player: "Player",
};
// The only two roles Free Play's own dropdown ever offers -- see the
// comment on ROLE_LABELS above for why the rest are Probe-only.
const FREE_PLAY_ROLE_KEYS = ["player", "keeper"];

// --- Animation v0: trace-event enrichment -----------------------------
// Every resolver below already fully computes its outcome via real engine
// calls before any of this runs (see file header). traceEvent() only
// *reads* id/x/y/zone off roster entries already in scope at each push
// site and repackages them into the flat shape the animation renderer
// consumes -- it never calls random() or affects which branch a resolver
// takes. Movement is illustrative, not a physics model: see nudgeToward()
// below for the one arithmetic rule every marker move goes through.
const MOVEMENT_DURATIONS = {
  pass: 550,
  cross: 700,
  dribble: 500,
  shot: 400,
  header: 350,
  save: 350,
  interception: 400,
  duel: 450,
  tackle: 400,
  foul: 400,
  reception: 300,
  block: 350,
  "rebound-shot": 450,
  scramble: 400,
  clearance: 500,
  reposition: 450,
  deflection: 260,
  // A single real touch (Touches Per Carry, 2026-08-18) covers far less
  // ground than the full carry/dribble-advance it's a leg of -- a flat
  // 500ms per touch would make a 5-6-touch nimble carry crawl on screen;
  // this is deliberately quick and snappy instead.
  touch: 220,
  // Hold-Up Play v1 (2026-08-18) -- a real "shield/assess" beat, closer to
  // the pace of a duel/tackle than a single touch (nobody is sprinting).
  hold: 400,
};
const DEFAULT_DURATION = 400;

function pointOf(entry) {
  return entry ? { zone: entry.zone, x: entry.x, y: entry.y } : null;
}

function zoneCenterPoint(zone) {
  const [x, y] = ZONE_CENTERS[zone] || ZONE_CENTERS[7];
  return { zone, x, y };
}

// A keeper who is further from their OWN goal line than the shooter is
// no longer positioned to make a save at all -- the shooter has
// genuinely gotten past/round them, not just "shooting near them." Off-
// Ball Goalkeeper Awareness (2026-08-18) -- a real browser round caught a
// shot animating straight at a keeper who'd been left behind the play
// entirely (goalPointFor() blindly aimed at pointOf(keeperEntry)
// regardless of relative position, which visually read as a backward
// pass to the keeper). Treated exactly like "no keeper placed" -- see
// goalPointFor()/resolveShoot()/resolveCross()'s own EMPTY_NET branches
// -- rather than a new probability formula: this only decides WHEN it's
// structurally honest to even call resolveKeeperSave() at all, the same
// "genuinely nobody there" principle the no-keeper case already uses.
function isKeeperBeaten(shooterEntry, keeperEntry) {
  if (!keeperEntry) return false;
  const goalY = goalLineY(shooterEntry);
  return Math.abs(shooterEntry.y - goalY) < Math.abs(keeperEntry.y - goalY);
}

// No keeper placed (or a keeper who's been beaten/rounded -- see
// isKeeperBeaten() above): aim at the near goal's center (x:50, y:0 or
// y:100) rather than fabricating a target -- same "real players, not
// invented ones" rule as everywhere else in this file, just applied to a
// visual endpoint instead of a resolver input. That point is no longer
// purely implied: the pitch now draws an actual goal marker centered at
// x:50 at both y:0 and y:100 (.ml-pitch-goal-top/-bottom in styles.css,
// an 8-yard-wide frame matching regulation width), so this always aims at
// a real, visible goal, whichever end the shooter is attacking.
function goalPointFor(shooterEntry, keeperEntry) {
  if (keeperEntry && !isKeeperBeaten(shooterEntry, keeperEntry))
    return pointOf(keeperEntry);
  return { zone: shooterEntry.zone, x: 50, y: goalLineY(shooterEntry) };
}

// --- Outcome-presentation geometry ---------------------------------------
// Everything below turns "which K.SAVE.*/off-target code fired" into a
// specific, distinct endpoint -- previously every keeper result collapsed
// onto goalPointFor()'s single "keeper's own position" point regardless of
// whether the ball was caught, parried, tipped for a corner, or hit the
// post, and every miss collapsed onto one generic near-miss offset. None of
// this affects resolveKeeperSave()/resolveFinishAttempt()/etc.'s actual
// probabilities -- it only decides where an already-decided outcome is
// drawn, same "engine decides, animation only visualizes" rule as the
// curved-trail feature above.
//
// Regulation goal width (8yd) on the 0-100 horizontal grid the pitch
// already uses for .ml-pitch-goal-top/-bottom: posts at x=44.67/55.33.
const GOAL_HALF_WIDTH_PCT = (GOAL_WIDTH_YARDS / 2 / PITCH_WIDTH_YARDS) * 100;
const GOAL_LEFT_POST_X = 50 - GOAL_HALF_WIDTH_PCT;
const GOAL_RIGHT_POST_X = 50 + GOAL_HALF_WIDTH_PCT;

// Shot Placement v1 (2026-08-20) -- see MATCH_LAB_PLAN.md and
// resolvePassAccuracy()'s own comment on the same round's pass-side twin.
// This function's own header comment (goalPointFor(), above, unrelated
// code that predates this pass) already named the exact gap: "the real
// fix is giving the shot descriptor its own aimErrorYards/missSeverity so
// execution quality can drive how far a miss actually lands -- not built
// yet." goalPointFor() always aimed a contested, on-target shot at
// EXACTLY the keeper's own standing position -- every on-target effort,
// from a scuffed tap to a screamer, looked pixel-identical until a save's
// own presentation chain (postPointFor()/netPointFor()) took over. This
// is the safe, Match-Lab-only lever the deferred note already scoped:
// WHERE an already-on-target shot lands within the frame, not WHETHER
// it's on target (resolveFinishAttempt()'s own probability, production-
// faithful, stays completely untouched).
//
// Deliberately biased AWAY from the keeper's own current x -- the side
// that's actually hard to save, not a coin flip aimed at their body --
// with the offset's own magnitude scaled by real finishing execution
// quality (Finishing/Technique/Composure, the same skill shape
// resolvePlacedFinish() already uses for its own placement roll) and
// reduced under pressure. A weak, rushed effort still converges back
// toward the keeper's own position (the OLD default, and an honestly easy
// save); a composed, technical finisher genuinely picks a corner.
function shotPlacementQuality(shooterPlayer) {
  const finishing = playerAttribute(shooterPlayer, "Finishing");
  const technique = playerAttribute(shooterPlayer, "Technique");
  const composure = playerAttribute(shooterPlayer, "Composure");
  return (finishing + technique + composure) / 3 / 20;
}
const SHOT_PLACEMENT_MAX_OFFSET_PCT = GOAL_HALF_WIDTH_PCT * 1.05;
// No-keeper-to-beat case (empty net, or a keeper already rounded --
// isKeeperBeaten()) added 2026-08-21: this used to fall straight back to
// goalPointFor()'s fixed x:50, which is exactly the "every goal scored in
// the same spot" gap a real browser round reported -- REBOUND.GOAL and
// EMPTY_NET (below) both only ever had that fixed point to reuse, since
// this function itself offered no alternative. There's no keeper position
// to aim AWAY from here, so the offset spreads around true goal center
// instead -- still genuine, quality-scaled placement variety, not a fixed
// point, just anchored differently than the "beat a real keeper" case.
function shotPlacementSpread(shooterEntry, keeperEntry, pressure, random) {
  const hasKeeperToBeat = Boolean(keeperEntry) && !isKeeperBeaten(shooterEntry, keeperEntry);
  const quality = clamp(
    0,
    1,
    shotPlacementQuality(shooterEntry.player) - pressure * 0.25,
  );
  const side = random() < 0.5 ? -1 : 1;
  const offsetPct =
    SHOT_PLACEMENT_MAX_OFFSET_PCT * quality * (0.4 + random() * 0.6);
  const anchorX = hasKeeperToBeat ? keeperEntry.x : 50;
  const x = clamp(GOAL_LEFT_POST_X, GOAL_RIGHT_POST_X, anchorX + side * offsetPct);
  return { zone: shooterEntry.zone, x, y: goalLineY(shooterEntry) };
}
// A scrambled rebound finish is instinctive, not a composed set shot --
// meaningfully reduced placement quality (see shotPlacementQuality()'s own
// pressure term), but still genuine per-shot variety, not the flat x:50
// every REBOUND.GOAL site below used to share.
const REBOUND_SHOT_PRESSURE = 0.5;

// How far past the goal line a net/corner endpoint travels, in the same
// 0-100 units -- stays inside .ml-pitch-field's 4% outer margin (see
// .match-lab-pitch/.ml-pitch-field in styles.css) so it's still visible,
// not clipped by the pitch wrapper's own overflow:hidden.
const BEYOND_LINE_MARGIN = 3;
// A scored ball is trapped in the goal rather than travelling to the back
// edge of the pitch wrapper. This depth sits visibly behind the line but
// inside the 10px goal/net element; ordinary misses and corners retain the
// larger out-of-play margin above.
const GOAL_NET_DEPTH_MARGIN = 1.15;
// x for a corner/wide-of-the-frame endpoint -- clearly wide of either post
// without pinning it to the exact corner flag (this file has no notion of
// exact touchline-crossing geometry, just "gone out wide").
const WIDE_OF_POST_X = { left: 8, right: 92 };
// How far inside the goal line a loose-ball rebound settles.
const REBOUND_INSET = 7;

// A player's frame of reference comes from the team's declared attacking
// direction, never from where the marker happens to be standing. Inferring
// "forward" from y<50 was only valid for attackers already in the final
// third; a keeper carrying out of their own box consequently aimed at their
// own goal. Keeping both ends in one frame also gives every downstream
// shot/save helper one source of truth.
function goalFrameFor(entry, world = state) {
  const direction = world.attackingDirection?.[entry?.team];
  if (direction !== "up" && direction !== "down") {
    throw new Error(
      `Missing attacking direction for team ${entry?.team ?? "unknown"}.`,
    );
  }
  const attackingGoalY = direction === "up" ? 0 : 100;
  return {
    direction,
    attackingGoalY,
    defendingGoalY: attackingGoalY === 0 ? 100 : 0,
  };
}
function attackingGoalY(entry, world = state) {
  return goalFrameFor(entry, world).attackingGoalY;
}
function defendingGoalY(entry, world = state) {
  return goalFrameFor(entry, world).defendingGoalY;
}
function goalLineY(shooterEntry) {
  return attackingGoalY(shooterEntry);
}
function beyondLineY(goalY, margin = BEYOND_LINE_MARGIN) {
  return goalY === 0 ? -margin : 100 + margin;
}
function postPointFor(shooterEntry, side) {
  return {
    zone: shooterEntry.zone,
    x: side === "left" ? GOAL_LEFT_POST_X : GOAL_RIGHT_POST_X,
    y: goalLineY(shooterEntry),
  };
}
function netPointFor(shooterEntry, x) {
  return {
    zone: shooterEntry.zone,
    x,
    y: beyondLineY(goalLineY(shooterEntry), GOAL_NET_DEPTH_MARGIN),
  };
}
function outsideCornerPointFor(shooterEntry, side) {
  return {
    zone: shooterEntry.zone,
    x: WIDE_OF_POST_X[side],
    y: beyondLineY(goalLineY(shooterEntry)),
  };
}
function reboundInBoxPointFor(shooterEntry, keeperEntry) {
  const x = clamp(
    GOAL_LEFT_POST_X,
    GOAL_RIGHT_POST_X,
    keeperEntry ? keeperEntry.x : 50,
  );
  const goalY = goalLineY(shooterEntry);
  return {
    zone: shooterEntry.zone,
    x,
    y: goalY === 0 ? REBOUND_INSET : 100 - REBOUND_INSET,
  };
}
// How far past a post an ORDINARY wide miss lands -- narrow on purpose.
// Deliberately a separate point from outsideCornerPointFor() above:
// x=8/92 is correct for a genuine corner-bound save outcome (K.SAVE.3/.7),
// but was also being reused for every plain missed shot, which is why
// ordinary misses were animating almost all the way to the corner arc.
// This is the immediate presentation fix (no new randomness, no new
// resolver data); the real fix is giving the shot descriptor its own
// aimErrorYards/missSeverity so execution quality can drive how far a
// miss actually lands -- not built yet, see MATCH_LAB_PLAN.md.
const NARROW_MISS_MARGIN_X = 4;
function narrowMissPointFor(shooterEntry, side) {
  const post = postPointFor(shooterEntry, side);
  const x =
    side === "left"
      ? post.x - NARROW_MISS_MARGIN_X
      : post.x + NARROW_MISS_MARGIN_X;
  return { zone: shooterEntry.zone, x: clamp(0, 100, x), y: post.y };
}

// Deterministic left/right-post choice for a save/miss endpoint -- reuses
// the EXACT perpendicular-bend math curveControlPoint() already draws a
// visible curve with (same rightX/rightY, same strikingFoot/contactType
// directionSign), so a save's post choice always agrees with whichever way
// the shot's own trail is already bending. Never a fresh random() call:
// with no curve data at all (a header has no strikingFoot/contactType,
// "there's no foot concept for those, not a missing case" -- see
// selectStrikeMechanics()'s own comment), it falls back to the shooter's
// own side of the pitch, the single most common real near-post situation.
function choosePostSide(ballFrom, aimPoint, strikingFoot, contactType) {
  if (strikingFoot && contactType && ballFrom && aimPoint) {
    const dx = aimPoint.x - ballFrom.x;
    const dy = aimPoint.y - ballFrom.y;
    const distance = Math.hypot(dx, dy);
    if (distance > 0) {
      const rightX = dy / distance;
      const sign =
        (strikingFoot === "right" ? 1 : -1) *
        (contactType === "outside" ? -1 : 1);
      return rightX * sign < 0 ? "left" : "right";
    }
  }
  return ballFrom && ballFrom.x < 50 ? "left" : "right";
}

// One centralized mapping from every K.SAVE.* code to its presentation --
// the whole point being that this same table drives every caller
// (resolveShoot, resolveCross, Scenario Probe "shot", the free-kick
// scenario), so the same engine code always ends the same visible way
// instead of each call site inventing its own generic "save" event.
// keeperAction/ballResult/restart mirror resolveKeeperSave()'s own
// documented code table exactly (matchEngineCore.js:503-552) -- rebound:
// true only for .2/.5/.6, goal: true only for .8 (.0 is a clean, no-touch
// beaten goal, tracked separately by resolveKeeperSave itself).
const KEEPER_SAVE_PRESENTATION = {
  "K.SAVE.0": {
    keeperAction: "beaten",
    ballResult: "goal",
    restart: "kickoff",
    badge: "GOAL",
  },
  "K.SAVE.1": {
    keeperAction: "catch",
    ballResult: "held",
    restart: "keeper-possession",
    badge: "CAUGHT",
  },
  "K.SAVE.2": {
    keeperAction: "parry",
    ballResult: "rebound-in-play",
    restart: "in-play",
    badge: "PARRIED",
  },
  "K.SAVE.3": {
    keeperAction: "tip",
    ballResult: "corner",
    restart: "corner",
    badge: "CORNER",
  },
  "K.SAVE.4": {
    keeperAction: "fumble",
    ballResult: "held",
    restart: "keeper-possession",
    badge: "SPILLED",
  },
  "K.SAVE.5": {
    keeperAction: "fumble",
    ballResult: "rebound-in-play",
    restart: "in-play",
    badge: "SPILLED",
  },
  "K.SAVE.6": {
    keeperAction: "tip",
    ballResult: "post-rebound",
    restart: "in-play",
    badge: "POST",
  },
  "K.SAVE.7": {
    keeperAction: "tip",
    ballResult: "post-out",
    restart: "corner",
    badge: "POST",
  },
  "K.SAVE.8": {
    keeperAction: "tip",
    ballResult: "post-goal",
    restart: "kickoff",
    badge: "GOAL",
  },
};

// The same semantic table that presents a save must also decide what play
// does next. Previously K.SAVE.3/.7 visibly said CORNER while four resolver
// branches silently handed the live ball to the keeper. Centralizing the
// transition makes that contradiction impossible at those call sites.
function keeperSaveTransition(save, keeperEntry, ballEnd, context = "shot") {
  const presentation = KEEPER_SAVE_PRESENTATION[save.code];
  if (save.goal || presentation?.ballResult === "goal") {
    return {
      outcome: "GOAL",
      code: save.code,
      resolved: true,
      terminal: true,
      possession: "dead",
      nextOwnerId: null,
      ballEnd,
      restart: "kickoff",
      reason: `${context}-save-goal`,
    };
  }
  if (save.rebound || presentation?.restart === "in-play") {
    return {
      outcome: "NO GOAL",
      code: save.code,
      resolved: true,
      terminal: false,
      possession: "loose",
      nextOwnerId: null,
      ballEnd,
      restart: null,
      reason: `${context}-save-rebound`,
    };
  }
  const restart = presentation?.restart;
  const deadBallRestart =
    restart && restart !== "keeper-possession" ? restart : null;
  return {
    outcome: "NO GOAL",
    code: save.code,
    resolved: true,
    terminal: true,
    possession: deadBallRestart ? "dead" : "turnover",
    nextOwnerId: deadBallRestart ? null : keeperEntry.id,
    ballEnd,
    restart: deadBallRestart,
    reason: deadBallRestart
      ? `${context}-save-${deadBallRestart}`
      : "keeper-catch",
  };
}

// Per-code path from the keeper/ball contact point onward (the leg BEFORE
// contact is the shot event that already exists -- see pushKeeperSaveEvent).
// Deliberately one case per code, not a shared ballResult-keyed branch:
// each of the 9 codes has genuinely distinct geometry (K.SAVE.2 and .5
// share a ballResult but not a keeperAction; .6/.7/.8 share a post contact
// but diverge after it), and spelling out all 9 keeps that traceable
// instead of re-deriving it from two smaller tables.
function buildKeeperSaveSegments(
  code,
  shooterEntry,
  keeperEntry,
  contactPoint,
  side,
) {
  const post = postPointFor(shooterEntry, side);
  switch (code) {
    case "K.SAVE.0":
      return [contactPoint, netPointFor(shooterEntry, contactPoint.x)];
    case "K.SAVE.1":
      return [contactPoint];
    case "K.SAVE.2":
      return [contactPoint, reboundInBoxPointFor(shooterEntry, keeperEntry)];
    case "K.SAVE.3":
      return [contactPoint, outsideCornerPointFor(shooterEntry, side)];
    case "K.SAVE.4":
      return [contactPoint];
    case "K.SAVE.5":
      return [contactPoint, reboundInBoxPointFor(shooterEntry, keeperEntry)];
    case "K.SAVE.6":
      return [
        contactPoint,
        post,
        reboundInBoxPointFor(shooterEntry, keeperEntry),
      ];
    case "K.SAVE.7":
      return [contactPoint, post, outsideCornerPointFor(shooterEntry, side)];
    case "K.SAVE.8":
      return [contactPoint, post, netPointFor(shooterEntry, post.x)];
    default:
      return [contactPoint];
  }
}

// An off-target attempt must NOT land at the same point an on-target one
// does -- that was the "off-target and the goal animation go to the same
// place" bug: both reused goalPointFor() unconditionally. Now code-aware:
// a crossbar-clearing miss (F.BLAST.OVER/FK.SHOT.HARD.OVER) goes out
// centrally with heightCue:true (an OVER needs a height cue precisely
// because it's the one miss whose x/y alone looks identical to a shot on
// frame -- see the height-cue CSS), every other miss code goes out wide of
// a post, deterministically chosen the same way a save's post is (curve
// direction if this shot has one, otherwise the shooter's own near side).
const MISS_BADGE = {
  "F.CALM.WEAK": "WIDE",
  "FK.SHOT.REGULAR.WEAK": "WIDE",
  "F.BLAST.OVER": "OVER",
  "FK.SHOT.HARD.OVER": "OVER",
  "F.FINESSE.WIDE": "WIDE",
  "FK.SHOT.CURL.WIDE": "WIDE",
  "F.HEADER.OFF": "WIDE",
};
function missPointFor(shooterEntry, keeperEntry, curveHint, missCode) {
  const badge = MISS_BADGE[missCode] || "WIDE";
  if (badge === "OVER") {
    return { point: netPointFor(shooterEntry, 50), badge, heightCue: true };
  }
  const aimPoint = goalPointFor(shooterEntry, keeperEntry);
  const side = choosePostSide(
    pointOf(shooterEntry),
    aimPoint,
    curveHint?.strikingFoot,
    curveHint?.contactType,
  );
  return {
    point: narrowMissPointFor(shooterEntry, side),
    badge,
    heightCue: false,
  };
}

function traceEvent(code, label, opts = {}) {
  const {
    actor = null,
    target = null,
    defender = null,
    keeper = null,
    movement = null,
    outcome = "neutral",
    ballFrom = null,
    ballTo = null,
    duration,
    // Explicit participant-movement data -- which ENTITY (if any) actually
    // relocates to which point, stated directly by the call site that
    // knows it, never inferred from ballFrom/ballTo + movement type. A
    // shot's/pass's/cross's ballFrom/ballTo describes the BALL's own
    // flight away from an actor who stays put; that must never be
    // mistaken for the actor moving there too. moverId/moveTo exist
    // specifically for the two cases where a participant genuinely does
    // relocate: a successful dribble (the carrier moves with the ball)
    // and a reception that advances the receiver's zone (they meet the
    // ball at its real arrival point). null/null everywhere else --
    // "not a missing case," same convention as strikingFoot/contactType.
    // `mover` is an entry (like actor/target/defender/keeper above), not
    // a bare id -- traceEvent() derives moverId the same way it derives
    // every other *Id field.
    mover = null,
    moveFrom = null,
    moveTo = null,
    // playerMoves -- Contact, Ownership & Continuation pass (see
    // MATCH_LAB_PLAN.md, 2026-08-18). mover/moveTo above can only ever
    // name ONE relocating participant; a real cross/header contest or a
    // rebound scramble needs to move TWO (the attacker AND the defender
    // converging on the same contact/loose-ball point) without one of
    // them silently overwriting the other. Each entry is
    // { player: <roster entry>, to: <point>, action: <string> } -- an
    // entry, not a bare id, matching every other participant field here.
    // Explicitly stated by the call site that knows a real relocation
    // happened, same "never inferred" rule mover/moveTo already
    // documents -- the renderer (applyStepAnimation) only ever plays
    // this back, it never guesses who moved from ballFrom/ballTo.
    // When omitted but mover/moveTo ARE given, this is derived as a
    // single-entry array from them, so every event has one consistent
    // `playerMoves` shape to read regardless of which shorthand the call
    // site used.
    playerMoves = null,
    // contact -- the ONE authoritative point + who touched the ball there
    // + what kind of touch it was ("header"/"parry"/"rebound-shot"/
    // "clearance"/"recovery"), for events where that's a meaningful,
    // distinct fact from ballFrom/ballTo/moveTo (a header/rebound/
    // clearance's contact point IS also its ballTo/moveTo in practice,
    // but naming it explicitly is what lets a test assert "the
    // contacting actor's position equals the contact point" without
    // re-deriving that from three other fields). null for events that
    // don't have a distinct contact moment (a pass, a bare shot-type
    // beat) -- not a missing case, same convention as strikingFoot/
    // contactType.
    contact = null,
    // Ownership is resolver data, never a renderer proximity guess. These
    // are intentionally optional because neutral/action-selection beats do
    // not change possession. null is meaningful (loose/dead); undefined
    // means this event makes no ownership assertion.
    ownerBefore = undefined,
    ownerAfter = undefined,
    ownerAfterAt = null,
    overlapWithPrevious = false,
    overlapStartOffsetMs = 0,
    // "sequential" means a dead/loose-ball recovery starts only after the
    // preceding flight has ended. It prevents playback from mistaking that
    // later race for an arrival authored during the incoming flight.
    contactTiming = null,
    offside = null,
    strikingFoot = null,
    contactType = null,
    footSource = null,
    // Outcome-presentation adapter fields (see KEEPER_SAVE_PRESENTATION /
    // MISS_BADGE above) -- populated only for keeper-save and off-target
    // events; null/[]/false everywhere else, same "not a missing case"
    // rule as strikingFoot/contactType above.
    keeperAction = null,
    ballResult = null,
    restart = null,
    pathSegments = [],
    badge = null,
    heightCue = false,
    ballTrajectory = null,
    // Quantified physical influence carried by the producer that applied
    // it. Playback never recomputes attributes; inspectors/tests can compare
    // the recorded actual value with the same quantity at rating 10.
    attribution = [],
    // Decision/off-ball observability. Produced at ACTION.CHOICE from the
    // same legal candidate list the chooser consumes; never reconstructed by
    // playback from where markers happen to be drawn later.
    metrics = null,
    // Optional override for the law-relevant touch descriptor. Ordinarily
    // contact already states the actor and touch type explicitly, allowing
    // this producer adapter to normalize that data once for ball state.
    lastTouch = null,
    // Only field the audio hook needs that nothing else already carries --
    // resolveShotBlock()'s own outcome ("behind"/"loose"/"safe"), read
    // straight off the D.BLOCK push site, distinguishing a decisive
    // clearance-flavored block from a plain one for cue selection.
    blockOutcome = null,
  } = opts;
  // Resolved once, here, so both the legacy single moverId/moveTo fields
  // AND the new playerMoves[] array are always mutually consistent --
  // never two independent sources of truth about who moved where. An
  // explicit playerMoves[] wins outright; mover/moveTo (when playerMoves
  // wasn't given) becomes its own one-entry array so every event has the
  // same shape to read.
  const resolvedPlayerMoves = playerMoves
    ? playerMoves.map((entry) => ({
        playerId: entry.player.id,
        from: entry.from ?? pointOf(entry.player),
        to: entry.to,
        action: entry.action,
        role: entry.role ?? null,
        trajectory: entry.trajectory
          ? entry.trajectory.map((sample) => ({
              progress: sample.progress,
              position: { ...sample.position },
              velocity: sample.velocity ? { ...sample.velocity } : null,
            }))
          : null,
        intention: entry.intention
          ? {
              ...entry.intention,
              target: entry.intention.target
                ? { ...entry.intention.target }
                : null,
            }
          : null,
        authoritative: entry.authoritative !== false,
        reactionDelayMs: Number.isFinite(entry.reactionDelayMs)
          ? entry.reactionDelayMs
          : null,
        reachAllowanceYards: Number.isFinite(entry.reachAllowanceYards)
          ? entry.reachAllowanceYards
          : 0,
      }))
    : mover && moveTo
      ? [
          {
            playerId: mover.id,
            from: moveFrom ?? pointOf(mover),
            to: moveTo,
            action: "advance",
          },
        ]
      : [];
  const singleMove =
    resolvedPlayerMoves.length === 1 ? resolvedPlayerMoves[0] : null;
  const stationaryBall =
    Boolean(ballFrom && ballTo) &&
    Math.abs(ballFrom.x - ballTo.x) <= 0.001 &&
    Math.abs(ballFrom.y - ballTo.y) <= 0.001;
  // A declaration/decision is commentary attached to the next physical
  // interval, not an animation beat of its own. Explicit duration always
  // wins, allowing a caller to deliberately author a held pause.
  const cueOnly =
    duration === undefined &&
    outcome === "neutral" &&
    !contact &&
    resolvedPlayerMoves.length === 0 &&
    ((!ballFrom && !ballTo) || stationaryBall);
  const resolvedDuration =
    duration ??
    (cueOnly
      ? 0
      : ((movement ? MOVEMENT_DURATIONS[movement] : undefined) ??
        DEFAULT_DURATION));
  const resolvedBallTrajectory =
    ballTrajectory ||
    (!cueOnly && ballFrom && ballTo
      ? buildBallTrajectory({
          from: ballFrom,
          to: ballTo,
          movement,
          durationMs: resolvedDuration,
          pathSegments,
          ballResult,
          keeperAction,
          heightCue,
        })
      : []);
  const contactBodyPart =
    {
      header: "head",
      catch: "hand",
      parry: "hand",
      tip: "hand",
      fumble: "hand",
      save: "hand",
      pass: "foot",
      cross: "foot",
      shot: "foot",
      clearance: "foot",
    }[contact?.type] ?? "unknown";
  const resolvedLastTouch = lastTouch
    ? {
        playerId: lastTouch.playerId ?? lastTouch.actor?.id ?? null,
        team: lastTouch.team ?? lastTouch.actor?.team ?? null,
        bodyPart: lastTouch.bodyPart ?? "unknown",
        deliberate: Boolean(lastTouch.deliberate),
        restart: lastTouch.restart ?? restart ?? null,
      }
    : contact
      ? {
          playerId: contact.actor.id,
          team: contact.actor.team ?? null,
          bodyPart: contactBodyPart,
          deliberate: ["pass", "cross", "shot", "clearance"].includes(
            contact.type,
          ),
          restart: restart ?? null,
        }
      : null;
  return {
    code,
    label,
    actorId: actor ? actor.id : null,
    targetId: target ? target.id : null,
    defenderId: defender ? defender.id : null,
    keeperId: keeper ? keeper.id : null,
    moverId: mover ? mover.id : singleMove ? singleMove.playerId : null,
    moveTo: moveTo ?? (singleMove ? singleMove.to : null),
    playerMoves: resolvedPlayerMoves,
    contact: contact
      ? {
          point: contact.point,
          actorId: contact.actor.id,
          type: contact.type,
          // Kick/header/save/clearance contacts begin their outgoing flight;
          // races, recoveries and blocks happen when an incoming flight ends.
          // The producing call site must state which one -- playback never
          // infers it from an event code or label.
          phase: contact.phase,
        }
      : null,
    ownerBeforeId:
      ownerBefore === undefined
        ? undefined
        : (ownerBefore?.id ?? ownerBefore ?? null),
    ownerAfterId:
      ownerAfter === undefined
        ? undefined
        : (ownerAfter?.id ?? ownerAfter ?? null),
    ownerAfterAt,
    overlapWithPrevious,
    overlapStartOffsetMs,
    contactTiming,
    timelineRole: cueOnly ? "cue" : "action",
    offside,
    ballFrom,
    ballTo,
    movement,
    outcome,
    duration: resolvedDuration,
    blockOutcome,
    // Which foot/contact struck the ball -- Match-Lab-only (the production
    // engine has no concept of this at all, confirmed directly against
    // matchEngineCore.js's own comment on DELIVERY.SWING: foot preference
    // "isn't currently plumbed into match players"). Populated only for
    // events selectStrikeMechanics() actually ran for (foot-struck shots);
    // null everywhere else (headers, passes, tackles, rebounds -- there's
    // no "foot" concept for those, not a missing case).
    strikingFoot,
    contactType,
    footSource,
    keeperAction,
    ballResult,
    restart,
    pathSegments,
    badge,
    heightCue,
    lastTouch: resolvedLastTouch,
    ballTrajectory: resolvedBallTrajectory,
    attribution: attribution.map((entry) => ({ ...entry })),
    metrics: metrics ? { ...metrics } : null,
  };
}

// Decides which foot/contact type struck the ball, for animation purposes
// only -- never affects finishType/shotType or any resolver's actual
// outcome, and consumes the SAME seeded random() sequence already resolving
// the rest of this event, at the exact point finishType is already known.
// That's what makes this a recorded engine-adjacent DECISION rather than a
// cosmetic guess made after the fact: Replay never re-invokes any resolver,
// so it reproduces the identical foot/contact/curve every time by reading
// this back from the stored trace, not by rolling anything fresh.
//
// Rules (see MATCH_LAB_PLAN.md for the full spec this implements):
// 1. Stronger foot by default.
// 2/3. A weaker-foot strike is gated (usable rating + situational pull via
//    pressure -- the closest real signal Match Lab has to "shooting
//    angle/body position"), not a flat chance rolled on every shot.
// 4. Outside-foot contact only offered on the PRIMARY foot, for placed
//    (non-power) attempts, gated on technique/flair -- this database has
//    no PPM data ("Avoids Using Weaker Foot" etc.) to gate on directly,
//    so technique/flair is the honest available proxy for "a deliberate
//    technique choice," not just "reverse curl would look good."
// 5/6. Power finishes (blast/fk-hard) default to laces contact (minimal
//    curl); placed finishes (finesse/curl types) default to inside contact.
function selectStrikeMechanics(shooterEntry, finishType, pressure, random) {
  const player = shooterEntry.player;
  const leftFootDetail = engineAttributeDetail(player, "Left Foot");
  const rightFootDetail = engineAttributeDetail(player, "Right Foot");
  const isPower = finishType === "blast" || finishType === "fk-hard";
  const preferredFoot =
    leftFootDetail.value >= rightFootDetail.value ? "left" : "right";

  // Neither foot has real (non-baseline) data -- not enough information to
  // make an honest choice about weaker-foot or outside-foot nuance. The
  // documented fallback: primary foot by whatever value is available, a
  // conventional contact type matching the finish's power/placement split.
  if (
    leftFootDetail.source === "baseline" &&
    rightFootDetail.source === "baseline"
  ) {
    return {
      strikingFoot: preferredFoot,
      contactType: isPower ? "laces" : "inside",
      footSource: "fallback",
    };
  }

  const weakerFoot = preferredFoot === "left" ? "right" : "left";
  const strongerRating = Math.max(leftFootDetail.value, rightFootDetail.value);
  const weakerRating = Math.min(leftFootDetail.value, rightFootDetail.value);

  const weakerFootUsable = weakerRating >= 11; // "limited" or better on the 20-point scale
  const weakerFootChance = weakerFootUsable
    ? clamp(
        0,
        0.3,
        (weakerRating / strongerRating - 0.4) * 0.5 * (0.6 + pressure * 0.8),
      )
    : 0;
  const usesWeakerFoot = weakerFootChance > 0 && random() < weakerFootChance;
  const strikingFoot = usesWeakerFoot ? weakerFoot : preferredFoot;

  // A weaker-foot strike stays conventional (inside/laces) -- no outside-
  // foot contact stacked on top of an already-uncomfortable weaker-foot
  // strike.
  let contactType = isPower ? "laces" : "inside";
  if (!usesWeakerFoot && !isPower) {
    const technique = playerAttribute(player, "Technique");
    const flair = playerAttribute(player, "Flair");
    const outsideFootChance = clamp(
      0,
      0.16,
      ((technique + flair) / 2 - 13) / 45,
    );
    if (outsideFootChance > 0 && random() < outsideFootChance)
      contactType = "outside";
  }

  return { strikingFoot, contactType, footSource: "resolver" };
}

// Centralized keeper-save presentation adapter -- every K.SAVE.* call site
// (resolveShoot, resolveCross, Scenario Probe "shot", the free-kick
// scenario) pushes its save event through this one function instead of
// each hand-building its own generic {movement:"save", outcome} event, so
// the same engine code always produces the same semantic ending (see
// KEEPER_SAVE_PRESENTATION above). contactPoint is always
// pointOf(keeperEntry) -- the shot event pushed just before this one
// already delivered the ball there (goalPointFor(shooter, keeper) IS
// pointOf(keeper) whenever a keeper's placed), so this never re-travels
// the shooter-to-keeper leg, only whatever happens after contact. Returns
// the actual final endpoint so callers chaining a rebound scramble or an
// uncontested follow-up shot continue from where the ball really ended up
// -- not pointOf(keeper), which is wrong the moment the outcome is a parry
// or a post rebound.
// Natural-language phrasing per badge -- badge.toLowerCase() alone reads
// fine for CAUGHT/PARRIED/SPILLED but not for CORNER/POST as bare words
// ("Smith corner" isn't a sentence), so this spells out the actual phrase
// rather than mechanically lowercasing the badge text.
const KEEPER_ACTION_PHRASE = {
  CAUGHT: "catches it",
  PARRIED: "parries it away",
  CORNER: "turns it behind for a corner",
  SPILLED: "spills it",
  POST: "turns it against the post",
};
function pushKeeperSaveEvent(
  trace,
  {
    shooterEntry,
    keeperEntry,
    save,
    strikeMechanics = null,
    movement = "save",
    label,
    contactPoint: contactPointOverride = null,
  },
) {
  const presentation =
    KEEPER_SAVE_PRESENTATION[save.code] || KEEPER_SAVE_PRESENTATION["K.SAVE.1"];
  // contactPointOverride (Shot Placement v1, 2026-08-20) -- the SAME real
  // aim point resolveShoot() already computed for its own on-target event,
  // so a save's own visual chain (post/net/rebound, all derived FROM this
  // point below) picks up genuinely, not the keeper's own static standing
  // spot every time -- a real keeper reaches to where the shot is
  // actually going, they don't just let it arrive at their own feet.
  // Defaults to the OLD exact behavior for any caller that doesn't supply
  // one (header/rebound/free-kick save paths, not upgraded this round).
  const contactPoint = contactPointOverride || pointOf(keeperEntry);
  const side = choosePostSide(
    pointOf(shooterEntry),
    contactPoint,
    strikeMechanics?.strikingFoot,
    strikeMechanics?.contactType,
  );
  const segments = buildKeeperSaveSegments(
    save.code,
    shooterEntry,
    keeperEntry,
    contactPoint,
    side,
  );
  const endpoint = segments[segments.length - 1];
  const defaultLabel = save.goal
    ? `${playerName(shooterEntry.player)} scores`
    : `${playerName(keeperEntry.player)} ${KEEPER_ACTION_PHRASE[presentation.badge] ?? "saves it"}`;
  trace.push(
    traceEvent(save.code, label ?? defaultLabel, {
      actor: shooterEntry,
      keeper: keeperEntry,
      movement,
      outcome: save.goal ? "goal" : "save",
      ballFrom: contactPoint,
      ballTo: endpoint,
      pathSegments: segments,
      // The keeper genuinely dives/reaches to the real contact point,
      // never merely asserted to be there (2026-08-20 fix -- a real
      // contact-continuity violation caught by the full-possession fuzz
      // suite: contactPointOverride (Shot Placement v1) can genuinely
      // differ from wherever the keeper's own last-authored position was,
      // but nothing previously moved their own MARKER to meet it, so the
      // save's own `contact` field claimed they were somewhere their own
      // track never actually reached). A no-op when contactPoint already
      // equals their current position (every pre-existing caller that
      // doesn't supply contactPointOverride).
      mover: keeperEntry,
      moveFrom: pointOf(keeperEntry),
      moveTo: contactPoint,
      contact:
        presentation.keeperAction === "beaten"
          ? null
          : {
              point: contactPoint,
              actor: keeperEntry,
              type: presentation.keeperAction,
              phase: "start",
            },
      ownerBefore: null,
      ownerAfter: presentation.ballResult === "held" ? keeperEntry : null,
      keeperAction: presentation.keeperAction,
      ballResult: presentation.ballResult,
      restart: presentation.restart,
      badge: presentation.badge,
      // Carried over from the shot that led to this save (same strike, not
      // a new decision) so the audio hook can tell a power shot's save
      // apart from a placed one (keeperPowerSave vs keeperCatch/Parry)
      // without re-deriving it. null for headers, same as the shot event.
      strikingFoot: strikeMechanics?.strikingFoot ?? null,
      contactType: strikeMechanics?.contactType ?? null,
    }),
  );
  return endpoint;
}

// The real tick loop never treats a rebound-flagged save/delivery as the
// end of the phase -- it always continues into a second contested race for
// the loose ball plus a shot chance (see draft-run.js's corner/delivery
// handling; confirmed by reading it directly, not assumed). Both Cross &
// Header and Free Play's cross missed this at first and reported "no goal"
// the moment a delivery came back rebound-flagged, which understated the
// real goal rate and is exactly the kind of gap this tool exists to catch.
// There's no separate poacher/reboundDefender pool in Match Lab (no full
// attacking/defending pool to pick a *different* player from), so this
// reuses the same attacker/defender already involved -- a simplification
// (real players, real attributes, real functions), not a fabrication.
function resolveReboundScramble(
  attacker,
  defender,
  keeper,
  zone,
  random,
  trace,
  originPoint = pointOf(keeper),
) {
  const reboundDuel = localizedDuel(
    attacker.player,
    defender.player,
    ["Anticipation", "Acceleration", "Off the Ball"],
    ["Positioning", "Anticipation", "Strength"],
    FIXED_MINUTE,
    random,
    zone,
  );
  const winner = reboundDuel.won ? attacker : defender;
  trace.push(
    traceEvent(
      reboundDuel.won ? "REBOUND.WON" : "REBOUND.LOST",
      reboundDuel.won
        ? `${playerName(attacker.player)} reacts fastest and reaches the loose ball first`
        : `${playerName(defender.player)} reaches the loose ball first`,
      {
        actor: attacker,
        defender,
        movement: "scramble",
        outcome: reboundDuel.won ? "success" : "turnover",
        // Contact, Ownership & Continuation (2026-08-18) -- explicit
        // loose-ball point (originPoint, the preceding save event's own
        // real endpoint, not a zone-center approximation), BOTH eligible
        // players shown genuinely converging on it (not the ball
        // teleporting to whichever one wins), and a named contact/winner --
        // "Every rebound attempt must name who took it." Neither
        // "clears the danger" (defender) nor any destination/flight is
        // claimed here -- reaching the loose ball first isn't itself a
        // clearance (see resolveAerialClearanceContinuation() for the real
        // clearance decision, which the winning DEFENDER never gets here --
        // a genuine gap, this is a rebound scramble, not an aerial win).
        playerMoves: [
          { player: attacker, to: originPoint, action: "attack-ball" },
          { player: defender, to: originPoint, action: "challenge" },
        ],
        contact: {
          point: originPoint,
          actor: winner,
          type: "recovery",
          phase: "end",
        },
        ownerBefore: null,
        ownerAfter: winner,
        ballFrom: originPoint,
        ballTo: originPoint,
      },
    ),
  );
  if (!reboundDuel.won) {
    return {
      outcome: "NO GOAL",
      code: "REBOUND.LOST",
      resolved: true,
      terminal: true,
      possession: "turnover",
      nextOwnerId: defender.id,
      ballEnd: originPoint,
      restart: null,
      reason: "rebound-lost",
    };
  }
  const scored =
    random() <
    transitionShotChance(
      attacker.player,
      keeper.player,
      FIXED_MINUTE,
      0.32,
      poacherScore,
    );
  const reboundShotMiss = scored ? null : missPointFor(attacker, keeper, null);
  const reboundShotEnd = scored
    ? netPointFor(attacker, shotPlacementSpread(attacker, keeper, REBOUND_SHOT_PRESSURE, random).x)
    : reboundShotMiss.point;
  trace.push(
    traceEvent(
      scored ? "REBOUND.GOAL" : "REBOUND.MISS",
      scored
        ? `${playerName(attacker.player)} scrambles it in`
        : "The rebound is scrambled away",
      {
        actor: attacker,
        keeper,
        movement: "shot",
        outcome: scored ? "goal" : "fail",
        // Begins exactly at originPoint -- attacker.moveTo above already put
        // them there; not pointOf(attacker), which (before this fix) reread
        // their stale pre-scramble spot instead of where they actually won
        // the ball.
        ballFrom: originPoint,
        ballTo: reboundShotEnd,
        contact: {
          point: originPoint,
          actor: attacker,
          type: "rebound-shot",
          phase: "start",
        },
        ownerBefore: attacker,
        ownerAfter: null,
      },
    ),
  );
  return {
    outcome: scored ? "GOAL" : "NO GOAL",
    code: scored ? "REBOUND.GOAL" : "REBOUND.MISS",
    resolved: true,
    terminal: true,
    // A miss here is the ball genuinely leaving play (wide/over), same as
    // any other off-target attempt -- NOT a keeper catch. Assigning
    // nextOwnerId: keeper.id while ballEnd sits at an off-target miss
    // point was the exact "keeper owns a ball at an out-of-play endpoint"
    // bug this pass fixes; a keeper only ever owns the ball at their OWN
    // real position, never at a wide/over miss point nobody is standing
    // at.
    possession: "dead",
    nextOwnerId: null,
    ballEnd: reboundShotEnd,
    restart: scored ? "kickoff" : "goal-kick",
    reason: scored ? "rebound-scramble-goal" : "rebound-scramble-miss",
  };
}

// Stage 2 dispatch: turns a Stage 1 selectedAction into a real execution
// result via matchEngineCore.js's action-specific resolvers. Lives here
// (not in oneOnOneDecision.js) because it's the same kind of caller-side
// wiring as the geometry conversion above -- oneOnOneDecision.js only ever
// decides WHICH action; this decides how match-lab.js's own roster
// entries/RNG streams map onto the resolvers that execute it.
const ONE_ON_ONE_MAX_GOAL_DISTANCE_YARDS = 24;
const ONE_ON_ONE_MIN_GOAL_ANGLE_DEGREES = 16;
const ONE_ON_ONE_DEFENDER_RECOVERY_YARDS = 9;

function goalMouthAngleDegrees(shooterEntry) {
  const goalY = goalLineY(shooterEntry);
  const shooterYards = toYardPoint(shooterEntry);
  const goalYards = goalY === 0 ? 0 : PITCH_LENGTH_YARDS;
  const vertical = Math.max(0.01, Math.abs(shooterYards.y - goalYards));
  const leftPost = (GOAL_LEFT_POST_X / 100) * PITCH_WIDTH_YARDS;
  const rightPost = (GOAL_RIGHT_POST_X / 100) * PITCH_WIDTH_YARDS;
  return Math.abs(
    Math.atan2(rightPost - shooterYards.x, vertical)
      - Math.atan2(leftPost - shooterYards.x, vertical),
  ) * 180 / Math.PI;
}

// Builds the one factual view of an isolated attacker/keeper situation.
// Eligibility is geometry, never reputation: a close, reasonably open
// angle; the keeper genuinely between attacker and goal; and no outfield
// defender close enough to pressure/recover or standing in the shot lane.
function freePlayOneOnOneContext(groups) {
  const shooter = groups?.owner;
  const keeper = groups?.keeper;
  if (!shooter || !keeper || isKeeperBeaten(shooter, keeper)) return null;
  const attackingDirection = state.attackingDirection[shooter.team];
  const goalY = goalLineY(shooter);
  const distanceYards = distanceToGoalYards(shooter, attackingDirection);
  const shotAngleDegrees = goalMouthAngleDegrees(shooter);
  const keeperBetween = attackingDirection === "up"
    ? keeper.y < shooter.y
    : keeper.y > shooter.y;
  const goalCenter = { x: 50, y: goalY, zone: shooter.zone };
  const laneDefender = nearestLaneInterceptor(
    shooter,
    goalCenter,
    groups.opponents,
  );
  const recoveryDefender = groups.opponents.find(
    (entry) => yardDistance(shooter, entry) <= ONE_ON_ONE_DEFENDER_RECOVERY_YARDS,
  ) || null;
  if (
    !keeperBetween
    || distanceYards > ONE_ON_ONE_MAX_GOAL_DISTANCE_YARDS
    || shotAngleDegrees < ONE_ON_ONE_MIN_GOAL_ANGLE_DEGREES
    || laneDefender
    || recoveryDefender
  ) return null;

  const keeperPoint = toYardPoint(keeper);
  const shooterPoint = toYardPoint(shooter);
  const goalLineYards = goalY === 0 ? 0 : PITCH_LENGTH_YARDS;
  const keeperDepthYards = Math.abs(keeperPoint.y - goalLineYards);
  const keeperLateralYards = keeperPoint.x - PITCH_WIDTH_YARDS / 2;
  const actualKeeperState = {
    depthFromGoalLineYards: keeperDepthYards,
    lateralOffsetYards: keeperLateralYards,
    distanceToShooterYards: Math.hypot(
      keeperPoint.x - shooterPoint.x,
      keeperPoint.y - shooterPoint.y,
    ),
    exposedSide: keeperLateralYards < -1
      ? "right"
      : keeperLateralYards > 1
        ? "left"
        : "balanced",
    movementDirection: null,
    closingSpeed: null,
    set: null,
  };
  return {
    actualKeeperState,
    distanceYards,
    shotAngleDegrees,
    // No defender passed the two structural gates above. Keep the smooth
    // value for borderline geometry/tests, but a truly empty setup is 0 --
    // never the old fabricated 0.1/0.15 pressure.
    defenderPressure: pressureAt(shooter, groups.opponents),
  };
}

function executeOneOnOneAction(
  action,
  {
    shooter,
    keeper,
    defender,
    teammates,
    actualKeeperState,
    perceivedKeeperState,
    defenderPressure,
    chanceContext = null,
    executionRandom,
    keeperResponseRandom,
  },
) {
  switch (action) {
    case "place-left":
    case "place-right": {
      const targetSide = action === "place-left" ? "left" : "right";
      const shot = resolvePlacedFinish({
        shooter: shooter.player,
        targetSide,
        power: false,
        pressure: defenderPressure,
        random: executionRandom,
      });
      return {
        ...resolveTargetedKeeperResponse({
          shot,
          keeper: keeper.player,
          actualKeeperState,
          chanceContext,
          random: keeperResponseRandom,
        }),
        shot,
      };
    }
    case "blast": {
      // Explicit target, not implicitly central -- carries Stage 1's own
      // PERCEIVED exposed side into execution; power trades placement
      // accuracy for pace, so the actual target can still drift centrally,
      // wide, or over regardless of what was intended.
      const targetSide =
        perceivedKeeperState.exposedSide === "balanced"
          ? "center"
          : perceivedKeeperState.exposedSide;
      const shot = resolvePlacedFinish({
        shooter: shooter.player,
        targetSide,
        power: true,
        pressure: defenderPressure,
        random: executionRandom,
      });
      return {
        ...resolveTargetedKeeperResponse({
          shot,
          keeper: keeper.player,
          actualKeeperState,
          chanceContext,
          random: keeperResponseRandom,
        }),
        shot,
      };
    }
    case "chip":
      return resolveChipAttempt({
        shooter: shooter.player,
        keeper: keeper.player,
        actualKeeperDepthYards: actualKeeperState.depthFromGoalLineYards,
        random: executionRandom,
      });
    case "round-keeper":
      return resolveRoundKeeper({
        shooter: shooter.player,
        keeper: keeper.player,
        defender: defender?.player || null,
        actualDistanceYards: actualKeeperState.distanceToShooterYards,
        random: executionRandom,
      });
    case "square-pass": {
      const teammate = teammates[0];
      if (!teammate) {
        // Should be unreachable -- Stage 1 only ever offers square-pass
        // when a real teammate is placed -- but this stays honest instead
        // of silently inventing a recipient if it somehow is reached.
        return {
          code: "ONE_V_ONE.SQUARE.NO_TEAMMATE",
          goal: false,
          rebound: false,
          keeperAction: null,
          ballResult: "turnover",
          keeperTravelYards: 0,
        };
      }
      return resolveSquarePass({
        shooter: shooter.player,
        teammate: teammate.player,
        keeper: keeper.player,
        defender: defender?.player || null,
        actualKeeperState,
        random: executionRandom,
        keeperResponseRandom,
      });
    }
    case "shoot-early": {
      // A quick attempt does not need us to fabricate that a static keeper
      // is rushing or unset. It simply gives up a little placement time and
      // strikes toward the side the attacker currently perceives as open.
      // The real keeper response still reads ground-truth geometry.
      const targetSide = perceivedKeeperState.exposedSide === "balanced"
        ? "center"
        : perceivedKeeperState.exposedSide;
      const shot = resolvePlacedFinish({
        shooter: shooter.player,
        targetSide,
        power: false,
        pressure: clamp(0, 1, defenderPressure * 0.75 + 0.08),
        random: executionRandom,
      });
      shot.speed = "early";
      return {
        ...resolveTargetedKeeperResponse({
          shot,
          keeper: keeper.player,
          actualKeeperState,
          chanceContext,
          random: keeperResponseRandom,
        }),
        shot,
      };
    }
    default:
      return {
        code: "ONE_V_ONE.UNKNOWN",
        goal: false,
        rebound: false,
        keeperAction: null,
        ballResult: null,
        keeperTravelYards: 0,
      };
  }
}

const SCENARIOS = [
  {
    id: "cross-header",
    label: "Cross & Header",
    description:
      "A delivered ball into the box: aerial race, header, keeper save. Calls resolveDelivery() directly.",
    roles: [
      { key: "receiver", count: 1 },
      { key: "defender", count: 1 },
      { key: "keeper", count: 1 },
    ],
    context: [],
    run(byRole, ctx, random, trace) {
      const receiver = byRole.receiver[0];
      const defender = byRole.defender[0];
      const keeper = byRole.keeper[0];
      const zone = receiver.zone;
      const delivery = resolveDelivery(
        receiver.player,
        defender.player,
        keeper.player,
        FIXED_MINUTE,
        random,
        zone,
      );
      // resolveDelivery() is monolithic (aerial race + header + save all
      // inside one function call, see MATCH_LAB_PLAN.md) -- this probe
      // structurally can't show the 4-beat Cross->Aerial->Header->Save/Goal
      // sequence Free Play's resolveCross() can; one collapsed event is
      // the honest representation here, not a missing step.
      trace.push(
        traceEvent(
          delivery.code,
          delivery.goal
            ? `${playerName(receiver.player)} scores from the delivery`
            : delivery.rebound
              ? `${playerName(receiver.player)}'s effort spills loose`
              : `No goal -- ${playerName(defender.player)} or ${playerName(keeper.player)} deal with it`,
          {
            actor: receiver,
            defender,
            keeper,
            movement: "header",
            outcome: delivery.goal
              ? "goal"
              : delivery.rebound
                ? "neutral"
                : "fail",
            ballFrom: pointOf(receiver),
            ballTo: goalPointFor(receiver, keeper),
            contact: {
              point: pointOf(receiver),
              actor: receiver,
              type: "header",
              phase: "start",
            },
            ownerBefore: receiver,
            ownerAfter: null,
          },
        ),
      );
      if (delivery.goal)
        return {
          outcome: "GOAL",
          code: delivery.code,
          nextOwnerId: null,
          restart: "kickoff",
        };
      if (!delivery.rebound)
        return {
          outcome: "NO GOAL",
          code: delivery.code,
          nextOwnerId: null,
          restart: null,
        };
      return resolveReboundScramble(
        receiver,
        defender,
        keeper,
        zone,
        random,
        trace,
      );
    },
  },
  {
    id: "receive",
    label: "Pass Reception (P.RECEIVE)",
    description:
      "What a successful pass costs the receiver to control. Calls resolveReceive() directly.",
    roles: [
      { key: "receiver", count: 1 },
      { key: "defender", count: 1 },
    ],
    context: [
      {
        key: "passQuality",
        label: "Pass quality",
        type: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.5,
      },
      {
        key: "pressure",
        label: "Pressure",
        type: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.3,
      },
      {
        key: "bypass",
        label: "Fast/direct ball (bypass)",
        type: "checkbox",
        default: false,
      },
    ],
    run(byRole, ctx, random, trace) {
      const receiver = byRole.receiver[0];
      const defender = byRole.defender[0];
      const zone = receiver.zone;
      const result = resolveReceive(
        receiver.player,
        defender.player,
        ctx.passQuality,
        ctx.pressure,
        ctx.bypass,
        zone,
        FIXED_MINUTE,
        random,
      );
      trace.push(
        traceEvent(
          result.context.code,
          `${playerName(receiver.player)}: ${result.status} (orientation ${result.context.orientation}, possession ${result.possession})`,
          {
            actor: receiver,
            defender,
            movement: "reception",
            outcome:
              String(result.status).toLowerCase() === "lose"
                ? "turnover"
                : "success",
            ballFrom: pointOf(receiver),
            ballTo: pointOf(receiver),
          },
        ),
      );
      return {
        outcome: result.status.toUpperCase(),
        code: result.context.code,
      };
    },
  },
  {
    id: "tackle-foul",
    label: "Tackle Engagement & Foul",
    description:
      "An attacker's progression duel with a defender, and -- only if the defender wins it -- the engagement flavor and any foul/card roll. Calls localizedDuel() then selectEngagement()/resolveEngagement()/resolveFoul(), matching the real tick loop's order (see draft-run.js's transitionDuel): engagement only decides the *flavor* of a win the defender has already earned upstream, so skill differences show up mainly in the duel, not the engagement step.",
    roles: [
      { key: "attacker", count: 1 },
      { key: "defender", count: 1 },
    ],
    context: [
      {
        key: "isLastMan",
        label: "Defender is the last man back",
        type: "checkbox",
        default: false,
      },
    ],
    run(byRole, ctx, random, trace) {
      const attacker = byRole.attacker[0];
      const defender = byRole.defender[0];
      // Canonical zone is the attacker's, not the defender's -- matching
      // every other probe in this file (receiver.zone, shooter.zone) and
      // resolveDribble()'s owner.zone in Free Play. The real tick loop has
      // no separate "attacker zone"/"defender zone" concept at all (one
      // shared zone for the whole passage of play); of the two placed
      // markers, the attacker's position is the more faithful stand-in --
      // it's also who a foul in the box actually benefits.
      const zone = attacker.zone;
      const zoneRow = Math.floor(zone / 3);
      const progressionDuel = localizedDuel(
        attacker.player,
        defender.player,
        ["Passing", "Technique", "Decisions", "Teamwork"],
        ["Positioning", "Anticipation", "Tackling", "Decisions"],
        FIXED_MINUTE,
        random,
        zone,
      );
      trace.push(
        traceEvent(
          "P.PROGRESS",
          `${playerName(attacker.player)} looks to get past ${playerName(defender.player)} (${Math.round(progressionDuel.probability * 100)}%)`,
          {
            actor: attacker,
            defender,
            movement: "dribble",
            outcome: "neutral",
            ballFrom: pointOf(attacker),
            ballTo: pointOf(attacker),
          },
        ),
      );
      if (progressionDuel.won) {
        trace.push(
          traceEvent(
            "P.PROGRESS.WON",
            `${playerName(attacker.player)} beats ${playerName(defender.player)} and advances cleanly`,
            {
              actor: attacker,
              defender,
              movement: "dribble",
              outcome: "success",
              ballFrom: pointOf(attacker),
              ballTo: pointOf(attacker),
            },
          ),
        );
        return { outcome: "ADVANCE", code: "P.PROGRESS.WON" };
      }
      const raceWasClose = progressionDuel.probability > 0.4;
      const engagementType = selectEngagement(
        defender.player,
        raceWasClose,
        random,
      );
      trace.push(
        traceEvent(
          engagementType,
          `${playerName(defender.player)} chooses ${engagementType}`,
          {
            actor: attacker,
            defender,
            movement: "tackle",
            outcome: "neutral",
            ballFrom: pointOf(attacker),
            ballTo: pointOf(attacker),
          },
        ),
      );
      const engagement = resolveEngagement(
        engagementType,
        defender.player,
        random,
        zoneRow,
      );
      trace.push(
        traceEvent(engagement.code, `Outcome: ${engagement.outcome}`, {
          actor: attacker,
          defender,
          movement: "tackle",
          outcome: engagementOutcomeLabel(engagement.outcome),
          ballFrom: pointOf(attacker),
          ballTo: pointOf(attacker),
        }),
      );
      if (engagement.outcome !== "foul") {
        return {
          outcome: engagement.outcome.toUpperCase(),
          code: engagement.code,
        };
      }
      const foul = resolveFoul(
        defender.player,
        engagementType,
        zone,
        ctx.isLastMan,
        FIXED_MINUTE,
        random,
      );
      trace.push(
        traceEvent(
          `CARD.${foul.card.toUpperCase()}`,
          `Restart: ${foul.restart}${foul.advantage ? " (advantage played)" : ""}, card: ${foul.card}`,
          {
            actor: attacker,
            defender,
            movement: "foul",
            outcome: "neutral",
            ballFrom: pointOf(attacker),
            ballTo: pointOf(attacker),
          },
        ),
      );
      return {
        outcome: `FOUL/${foul.card.toUpperCase()}`,
        code: `CARD.${foul.card.toUpperCase()}`,
      };
    },
  },
  {
    id: "shot",
    label: "Shot Resolution",
    description:
      "Finish type, on-target roll, keeper save -- or a breakaway one-on-one. Calls selectFinishType()/resolveFinishAttempt()/resolveKeeperSave() or resolveOneOnOne(). A placed defender (optional) contests any rebound; without one the rebound is uncontested, not fabricated.",
    roles: [
      { key: "attacker", count: 1 },
      { key: "keeper", count: 1 },
      { key: "defender", count: 0 },
    ],
    context: [
      {
        key: "pressure",
        label: "Pressure",
        type: "range",
        min: 0,
        max: 1,
        step: 0.01,
        default: 0.3,
      },
      {
        key: "breakaway",
        label: "Breakaway (no defender close)",
        type: "checkbox",
        default: false,
      },
    ],
    run(byRole, ctx, random, trace) {
      const shooter = byRole.attacker[0];
      const keeper = byRole.keeper[0];
      const defender = (byRole.defender || [])[0] || null;
      const zone = shooter.zone;
      let save;
      let saveEndpoint;
      if (ctx.breakaway) {
        // resolveOneOnOne() produces its own K.ONEONONE.* codes, a
        // different resolver with no post/corner distinction modeled at
        // all -- deliberately left outside the K.SAVE.* presentation
        // adapter below rather than inventing badge/path semantics the
        // engine doesn't actually support for a breakaway.
        save = resolveOneOnOne(
          shooter.player,
          keeper.player,
          FIXED_MINUTE,
          random,
          zone,
        );
        saveEndpoint = pointOf(keeper);
        trace.push(
          traceEvent(
            save.code,
            save.goal
              ? `${playerName(shooter.player)} finishes coolly`
              : `${playerName(keeper.player)} deals with it`,
            {
              actor: shooter,
              keeper,
              movement: "save",
              outcome: save.goal ? "goal" : "save",
              ballFrom: pointOf(shooter),
              ballTo: saveEndpoint,
            },
          ),
        );
      } else {
        const finishType = selectFinishType(
          shooter.player,
          random,
          ctx.pressure,
        );
        trace.push(
          traceEvent(
            finishType.toUpperCase(),
            `${playerName(shooter.player)} goes for a ${finishType} finish`,
            { actor: shooter, outcome: "neutral" },
          ),
        );
        const strikeMechanics = selectStrikeMechanics(
          shooter,
          finishType,
          ctx.pressure,
          random,
        );
        const attempt = resolveFinishAttempt(
          finishType,
          shooter.player,
          random,
        );
        const miss = attempt.onTarget
          ? null
          : missPointFor(shooter, keeper, strikeMechanics, attempt.code);
        trace.push(
          traceEvent(
            attempt.code,
            attempt.onTarget ? "On target" : "Off target",
            {
              actor: shooter,
              keeper,
              movement: "shot",
              outcome: attempt.onTarget ? "success" : "fail",
              ballFrom: pointOf(shooter),
              ballTo: attempt.onTarget
                ? goalPointFor(shooter, keeper)
                : miss.point,
              contact: {
                point: pointOf(shooter),
                actor: shooter,
                type: "shot",
                phase: "start",
              },
              ownerBefore: shooter,
              ownerAfter: null,
              badge: attempt.onTarget ? null : miss.badge,
              heightCue: attempt.onTarget ? false : miss.heightCue,
              ...strikeMechanics,
            },
          ),
        );
        if (!attempt.onTarget)
          return {
            outcome: "NO GOAL",
            code: attempt.code,
            nextOwnerId: null,
            restart: "goal-kick",
          };
        save = resolveKeeperSave(
          shooter.player,
          keeper.player,
          finishType,
          FIXED_MINUTE,
          random,
          zone,
        );
        saveEndpoint = pushKeeperSaveEvent(trace, {
          shooterEntry: shooter,
          keeperEntry: keeper,
          save,
          strikeMechanics,
        });
      }
      if (save.goal)
        return keeperSaveTransition(
          save,
          keeper,
          saveEndpoint,
          "scenario-shot",
        );
      if (!save.rebound)
        return keeperSaveTransition(
          save,
          keeper,
          saveEndpoint,
          "scenario-shot",
        );
      if (!defender) {
        const scored =
          random() <
          transitionShotChance(
            shooter.player,
            keeper.player,
            FIXED_MINUTE,
            0.32,
            poacherScore,
          );
        const reboundMiss = scored
          ? null
          : missPointFor(shooter, keeper, null, null);
        trace.push(
          traceEvent(
            scored ? "REBOUND.GOAL" : "REBOUND.MISS",
            scored
              ? `${playerName(shooter.player)} scrambles it in, unchallenged`
              : "The rebound drifts away, unchallenged",
            {
              actor: shooter,
              keeper,
              movement: "rebound-shot",
              outcome: scored ? "goal" : "fail",
              // Continues from saveEndpoint -- the breakaway branch ends at
              // pointOf(keeper); the K.SAVE.* branch only reaches here when
              // save.rebound is true, so saveEndpoint is a real rebound spot.
              ballFrom: saveEndpoint,
              ballTo: scored
                ? goalPointFor(shooter, keeper)
                : reboundMiss.point,
              badge: scored ? null : reboundMiss.badge,
              mover: shooter,
              moveTo: saveEndpoint,
              contact: {
                point: saveEndpoint,
                actor: shooter,
                type: "rebound-shot",
                phase: "start",
              },
              ownerBefore: shooter,
              ownerAfter: null,
            },
          ),
        );
        return {
          outcome: scored ? "GOAL" : "NO GOAL",
          code: scored ? "REBOUND.GOAL" : "REBOUND.MISS",
          nextOwnerId: null,
          restart: scored ? "kickoff" : "goal-kick",
        };
      }
      return resolveReboundScramble(
        shooter,
        defender,
        keeper,
        zone,
        random,
        trace,
        saveEndpoint,
      );
    },
  },
  {
    id: "free-kick",
    label: "Free Kick",
    description:
      "Wall contact, the shot if it gets past, and a rebound scramble if the keeper spills it. Calls resolveWall(), selectFreeKickShotType()/resolveFreeKickAttempt()/resolveKeeperSave() -- same as the real tick loop, including its fixed Zone 1 keeper-save call (zone there only ever gates an unrelated central-congestion variance term, not distance -- see MATCH_LAB_PLAN.md). resolveWall() and resolveFreeKickAttempt() still have no distance/angle input in production, but the keeper-beating stage now retains Free Kick Taking (instead of reverting to generic open-play labels) and uses the taker's actual placement as a coarse dead-ball-distance signal.",
    roles: [
      { key: "attacker", count: 1 },
      { key: "keeper", count: 1 },
      { key: "wall", count: 0 },
    ],
    context: [],
    run(byRole, ctx, random, trace) {
      const taker = byRole.attacker[0];
      const keeper = byRole.keeper[0];
      const wallEntries = byRole.wall || [];
      const wallPlayers = wallEntries.map((entry) => entry.player);
      const wall = resolveWall(taker.player, wallPlayers, random);
      // Only wallEntries[0] visually reacts even with multiple wall
      // players placed -- the schema's defenderId is singular, and this
      // keeps that honest rather than picking one arbitrarily each step.
      const wallRepresentative = wallEntries[0] || null;
      trace.push(
        traceEvent(
          wall.code,
          wall.hit
            ? `Blocked by the wall (${wall.outcome})`
            : wallPlayers.length
              ? "Clears the wall"
              : "No wall placed -- nothing to clear",
          wall.hit
            ? // A wall hit IS the shot's one flight in this branch (it
              // returns immediately after) -- taker to wherever it was
              // blocked.
              {
                actor: taker,
                defender: wallRepresentative,
                movement: "shot",
                outcome: "block",
                ballFrom: pointOf(taker),
                ballTo: pointOf(wallRepresentative),
              }
            : // Clearing the wall isn't a flight of its own -- the ball
              // hasn't gone anywhere yet, the actual strike happens below.
              // Giving this its own ballFrom/ballTo (as an earlier pass did)
              // made the ball visibly travel twice for one kick: once here,
              // then again for the real shot.
              {
                actor: taker,
                defender: wallRepresentative,
                outcome: "success",
              },
        ),
      );
      if (wall.hit)
        return {
          outcome: `WALL/${wall.outcome.toUpperCase()}`,
          code: wall.code,
        };
      const shotType = selectFreeKickShotType(taker.player, random);
      trace.push(
        traceEvent(
          shotType.toUpperCase(),
          `${playerName(taker.player)} goes for a ${shotType} strike`,
          { actor: taker, outcome: "neutral" },
        ),
      );
      const keeperFinishType =
        { regular: "fk-regular", hard: "fk-hard", curl: "fk-curl" }[shotType] ||
        "fk-regular";
      // Fixed, low pressure -- this scenario has no ctx.pressure field
      // (a stationary dead ball genuinely isn't under the same in-the-
      // moment pressure an open-play shot is), so a small constant is the
      // honest stand-in rather than fabricating a computed value.
      const strikeMechanics = selectStrikeMechanics(
        taker,
        keeperFinishType,
        0.2,
        random,
      );
      const attempt = resolveFreeKickAttempt(shotType, taker.player, random);
      const miss = attempt.onTarget
        ? null
        : missPointFor(taker, keeper, strikeMechanics, attempt.code);
      trace.push(
        traceEvent(
          attempt.code,
          attempt.onTarget ? "On target" : "Off target",
          {
            actor: taker,
            keeper,
            movement: "shot",
            outcome: attempt.onTarget ? "success" : "fail",
            ballFrom: pointOf(taker),
            ballTo: attempt.onTarget ? goalPointFor(taker, keeper) : miss.point,
            contact: {
              point: pointOf(taker),
              actor: taker,
              type: "shot",
              phase: "start",
            },
            ownerBefore: taker,
            ownerAfter: null,
            badge: attempt.onTarget ? null : miss.badge,
            heightCue: attempt.onTarget ? false : miss.heightCue,
            ...strikeMechanics,
          },
        ),
      );
      if (!attempt.onTarget)
        return {
          outcome: "NO GOAL",
          code: attempt.code,
          nextOwnerId: null,
          restart: "goal-kick",
        };
      const save = resolveKeeperSave(
        taker.player,
        keeper.player,
        keeperFinishType,
        FIXED_MINUTE,
        random,
        1,
        freeKickContextMultiplier(taker.zone),
      );
      const saveEndpoint = pushKeeperSaveEvent(trace, {
        shooterEntry: taker,
        keeperEntry: keeper,
        save,
        strikeMechanics,
      });
      if (save.goal)
        return keeperSaveTransition(save, keeper, saveEndpoint, "free-kick");
      if (!save.rebound)
        return keeperSaveTransition(save, keeper, saveEndpoint, "free-kick");
      // The real tick loop doesn't stop at a spilled save -- it picks a
      // poacher from the whole attacking pool for the loose-ball scramble
      // (localizedDuel at zone 1, same as the save call above). Match Lab
      // has no separate poacher pool for a free kick (only the taker is
      // placed as attacker), so this reuses the taker for the scramble
      // too, and reuses a placed wall defender as the contesting defender
      // if one exists -- uncontested otherwise, same "real players, not
      // fabricated" rule used everywhere else in this file.
      const reboundDefenderEntry = wallEntries[0] || null;
      if (!reboundDefenderEntry) {
        const scored =
          random() <
          transitionShotChance(
            taker.player,
            keeper.player,
            FIXED_MINUTE,
            0.32,
            poacherScore,
          );
        const reboundMiss = scored
          ? null
          : missPointFor(taker, keeper, null, null);
        trace.push(
          traceEvent(
            scored ? "REBOUND.GOAL" : "REBOUND.MISS",
            scored
              ? `${playerName(taker.player)} scrambles the rebound in, unchallenged`
              : "The rebound drifts away, unchallenged",
            {
              actor: taker,
              keeper,
              movement: "rebound-shot",
              outcome: scored ? "goal" : "fail",
              // Continues from saveEndpoint -- the save's own real endpoint
              // (a parry/post-rebound spot), not pointOf(keeper), since this
              // branch only runs when save.rebound is true (K.SAVE.2/.5/.6).
              ballFrom: saveEndpoint,
              ballTo: scored
                ? netPointFor(taker, shotPlacementSpread(taker, keeper, REBOUND_SHOT_PRESSURE, random).x)
                : reboundMiss.point,
              badge: scored ? null : reboundMiss.badge,
              mover: taker,
              moveTo: saveEndpoint,
              contact: {
                point: saveEndpoint,
                actor: taker,
                type: "rebound-shot",
                phase: "start",
              },
              ownerBefore: taker,
              ownerAfter: null,
            },
          ),
        );
        return {
          outcome: scored ? "GOAL" : "NO GOAL",
          code: scored ? "REBOUND.GOAL" : "REBOUND.MISS",
          nextOwnerId: null,
          restart: scored ? "kickoff" : "goal-kick",
        };
      }
      return resolveReboundScramble(
        taker,
        reboundDefenderEntry,
        keeper,
        1,
        random,
        trace,
        saveEndpoint,
      );
    },
  },
  {
    id: "one-on-one-decision",
    label: "One-on-One Decision (Experimental)",
    description:
      "EXPERIMENTAL scenario probe -- resolves for real via matchEngineCore.js's Stage 2 action-specific resolvers (resolvePlacedFinish/resolveChipAttempt/resolveRoundKeeper/resolveSquarePass + the shared resolveTargetedKeeperResponse). Free Play now uses the same ONE_V_ONE.* path for genuine isolated chances; draft-run's production engine remains untouched. Converts the placed marker positions into a striker/keeper decision context, shows what src/lib/oneOnOneDecision.js's Stage 1 selector chose and why, then shows how it actually resolved. Optional Defender contests for pressure; optional Candidates are treated as real square-pass recipients (never invented).",
    roles: [
      { key: "attacker", count: 1 },
      { key: "keeper", count: 1 },
      { key: "defender", count: 0 },
      { key: "candidate", count: 0 },
    ],
    context: [],
    run(byRole, ctx, random, trace, seed) {
      const shooter = byRole.attacker[0];
      const keeper = byRole.keeper[0];
      const defender = (byRole.defender || [])[0] || null;
      const teammates = byRole.candidate || [];

      // Pitch-relative yards from the same 75x120 grid the outcome-
      // presentation adapter above already uses (GOAL_LEFT_POST_X/
      // GOAL_RIGHT_POST_X, goalLineY()) -- this scenario is the ONE place
      // match-lab.js converts constructed marker positions into the
      // shared decision context; oneOnOneDecision.js itself never sees a
      // marker or a percentage coordinate.
      const toYardsX = (x) => (x / 100) * 75;
      const toYardsY = (y) => (y / 100) * 120;
      const goalY = goalLineY(shooter);
      const keeperDepthYards = Math.abs(toYardsY(keeper.y) - toYardsY(goalY));
      const keeperLateralYards = toYardsX(keeper.x) - toYardsX(50);
      const distanceToShooterYards = Math.hypot(
        toYardsX(keeper.x) - toYardsX(shooter.x),
        toYardsY(keeper.y) - toYardsY(shooter.y),
      );
      // Which side of goal has more room, from the shooter's own
      // perspective: keeper displaced toward lower x leaves the higher-x
      // (right) side more open, and vice versa.
      const exposedSide =
        keeperLateralYards < -1
          ? "right"
          : keeperLateralYards > 1
            ? "left"
            : "balanced";
      const shooterDistanceToGoalYards = Math.abs(
        toYardsY(shooter.y) - toYardsY(goalY),
      );
      const postLeftX = toYardsX(GOAL_LEFT_POST_X);
      const postRightX = toYardsX(GOAL_RIGHT_POST_X);
      const shooterXYards = toYardsX(shooter.x);
      const verticalToGoal = Math.max(
        0.01,
        Math.abs(toYardsY(shooter.y) - toYardsY(goalY)),
      );
      const angleToLeftPost = Math.atan2(
        postLeftX - shooterXYards,
        verticalToGoal,
      );
      const angleToRightPost = Math.atan2(
        postRightX - shooterXYards,
        verticalToGoal,
      );
      const shotAngleDegrees =
        Math.abs((angleToRightPost - angleToLeftPost) * 180) / Math.PI;

      const actualKeeperState = {
        depthFromGoalLineYards: keeperDepthYards,
        lateralOffsetYards: keeperLateralYards,
        distanceToShooterYards,
        exposedSide,
        // Genuinely not derivable from a static marker snapshot -- see
        // oneOnOneDecision.js's own comment on why these stay null rather
        // than being guessed from depth/proximity.
        movementDirection: null,
        closingSpeed: null,
        set: null,
      };

      // A separate, independently-seeded stream -- deliberately NOT the
      // `random` this run() was given (that stays untouched, satisfying
      // "do not consume calls from the existing resolver's sequential
      // random stream" even though this scenario doesn't resolve a real
      // outcome at all yet). Keyed off the per-call `seed` (not
      // state.seed, which stays constant across every Run N iteration) --
      // otherwise every single Run N roll would hash to the exact same
      // decision instead of showing a real distribution.
      const decisionRandom = seededRandom(
        hashString(`match-lab:one-on-one-decision:${seed}`),
      );
      const perceivedKeeperState = perceiveKeeperState(
        actualKeeperState,
        shooter.player,
        decisionRandom,
      );
      const defenderPressure = defender
        ? computePressure(defender.player, shooter.zone, 0)
        : 0.15;
      const decision = chooseOneOnOneAction({
        shooter: shooter.player,
        perceivedKeeperState,
        defenderPressure,
        shotAngle: shotAngleDegrees,
        distance: shooterDistanceToGoalYards,
        availableTeammates: teammates,
        decisionRandom,
      });

      // Stage 2: two more independently-seeded streams, neither continuing
      // decisionRandom's own sequence -- changing Stage 1's scoring (or
      // adding a new candidate, which changes how many times decisionRandom
      // gets called before a pick is made) can never silently change what
      // an otherwise-identical selected action executes to.
      const executionRandom = seededRandom(
        hashString(`match-lab:one-on-one-execution:${seed}`),
      );
      const keeperResponseRandom = seededRandom(
        hashString(`match-lab:one-on-one-keeper-response:${seed}`),
      );
      const execution = executeOneOnOneAction(decision.selectedAction, {
        shooter,
        keeper,
        defender,
        teammates,
        actualKeeperState,
        perceivedKeeperState,
        defenderPressure,
        chanceContext: {
          distanceYards: shooterDistanceToGoalYards,
          shotAngleDegrees,
          defenderPressure,
        },
        executionRandom,
        keeperResponseRandom,
      });

      state.lastOneOnOneDiagnostic = {
        ...decision,
        actualKeeperState,
        perceivedKeeperState,
        execution,
      };

      // No ballFrom/ballTo/movement -- Stage 2 resolves for real now, but
      // visualizing that (reusing/extending the pathSegments+badge system
      // built for K.SAVE.*) is deliberately its own follow-up, not bundled
      // into this pass. The full result renders in the diagnostic panel.
      trace.push(
        traceEvent(
          execution.code,
          `${playerName(shooter.player)} attempts "${decision.selectedAction}" -- ${execution.deferred ? "deferred (no keeper-set state yet)" : execution.code} -- see the diagnostic panel below (not yet animated)`,
          {
            actor: shooter,
            keeper,
            outcome: execution.goal ? "goal" : "neutral",
          },
        ),
      );
      // outcome stays the selected action (not the execution result) --
      // Run N's existing tally-by-outcome view shows the real
      // selected-action distribution this way; per-action conversion
      // telemetry belongs to the audit tool, not this quick view.
      return { outcome: decision.selectedAction, code: execution.code };
    },
  },
];

// --- Free Play: action choice (new, Match-Lab-only) + resolution (real) ---

const FREE_PLAY_ACTIONS = [
  "pass",
  "through",
  "cross",
  "dribble",
  "shoot",
  "carry",
  "hold",
];
const FREE_PLAY_ACTION_LABELS = {
  pass: "Pass",
  through: "Through Ball",
  cross: "Cross",
  dribble: "Dribble",
  shoot: "Shoot",
  carry: "Carry",
  hold: "Hold",
};

// engagingOpponent() itself now lives in spatialDecision.js (real yard-
// based DUEL_RANGE_YARDS, replacing the old mixed-percentage-unit
// ENGAGEMENT_DISTANCE=22 that could treat a defender 20+ real yards away
// as "the nearest, therefore engaging" -- see the import above and
// MATCH_LAB_PLAN.md's correctness-pass section). Same (entry, entries[])
// -> entry-or-null shape every existing call site below already expects,
// so this was a drop-in swap, not a call-site rewrite.

// How far a successful dribble advances the ball -- a fixed distance, not
// a probability, and deliberately not tuned/randomized this pass. Uses
// the EXPLICIT attacking-direction setting, never re-inferred from the
// player's current half (see state.attackingDirection's own comment) --
// that inference stops being reliable the moment a possession can advance
// across zones over several steps, which is exactly what the possession
// runner below does.
const DRIBBLE_PROGRESS_YARDS = 8;
// Carry's own destination is decided entirely by Directional Carry
// Planning (spatialDecision.js's planCarryDestination(), with its own
// CARRY_FORWARD_YARDS/CARRY_SHORT_YARDS constants) -- resolveCarry() no
// longer computes a fixed-distance advance here at all.
// PITCH_LENGTH_YARDS (120, from canonical pitchGeometry.js through
// spatialDecision.js) is the SAME explicit yard dimension the CSS/SVG
// pitch and every yard-based pressure/radius calculation use.
function advanceTowardGoal(fromPoint, team, yards) {
  const direction = state.attackingDirection[team] === "up" ? -1 : 1;
  const y = clamp(
    0,
    100,
    fromPoint.y + direction * (yards / PITCH_LENGTH_YARDS) * 100,
  );
  return { x: fromPoint.x, y, zone: zoneFromPercent(fromPoint.x, y) };
}

// ownerId defaults to Free Play's own ball-ownership field (the FIRST
// step of a possession), but the possession runner passes its own
// simulated current owner for every step after that -- who has the ball
// changes across a possession; state.ball.ownerId is only ever the
// AUTHORED starting point, never mutated mid-resolution (see
// runConstructedPossession()).
// roster defaults to state.roster (every non-possession-loop caller: the
// action table, the live inspector, etc, all want the authored setup),
// but runConstructedPossession() passes its own per-possession simulated
// clone instead -- so every resolver's pointOf(owner)/pointOf(teammate)/
// etc reads wherever a player's possession has actually progressed them
// to, never their stale authored starting spot (see that function's own
// header comment).
function freePlayGroups(
  ownerId = state.ball.ownerId,
  roster = state.roster,
  ballState = null,
) {
  const owner = roster.find((entry) => entry.id === ownerId) || null;
  const empty = {
    owner: null,
    teammates: [],
    opponents: [],
    ownKeepers: [],
    opposingKeepers: [],
    keeper: null,
    ballState,
    ballPoint: ballState?.position ?? null,
  };
  if (!owner) return empty;
  const isKeeper = (entry) => entry.role === "keeper";
  const ownSide = roster.filter(
    (entry) => entry.id !== owner.id && entry.team === owner.team,
  );
  const opposition = roster.filter((entry) => entry.team !== owner.team);
  const teammates = ownSide.filter((entry) => !isKeeper(entry));
  const opponents = opposition.filter((entry) => !isKeeper(entry));
  const ownKeepers = ownSide.filter(isKeeper);
  const opposingKeepers = opposition.filter(isKeeper);
  return {
    owner,
    teammates,
    opponents,
    ownKeepers,
    opposingKeepers,
    // Backward-compatible shot/save target while resolvers migrate to the
    // array contract. Crucially, every additional keeper remains a keeper;
    // none can fall through into `opponents` as an outfield duel target.
    keeper: opposingKeepers[0] ?? null,
    ballState,
    ballPoint: ballState?.position ?? pointOf(owner),
  };
}

// Real target selection, not array-index-zero: reuses selectReceiver() (the
// same function the tick loop uses for P.PASS) when picking among multiple
// placed teammates for a pass, and weightedPlayer()+headerScore() (the same
// pair the tick loop uses for delivery targets) for a cross -- deliberately
// different real functions for the two, since who you'd pass to short and
// who you'd aim a cross at are different questions in the real engine too.
// preselectedId (optional): the Possession Runner's Spatial Decision
// Intelligence layer already picked a SPECIFIC teammate as part of
// choosing the concrete candidate ("pass to Aimar," not just "pass") --
// when present, that choice wins outright and no random() call happens
// here at all (nothing left to decide). Falls back to the pre-existing
// selection for any caller that hasn't picked a target already (Scenario
// Probe has none of these candidates -- it never passes preselectedId).
function selectTeammateTarget(
  teammates,
  owner,
  pressure,
  random,
  kind,
  preselectedId = null,
) {
  if (preselectedId) {
    const preselected = teammates.find((entry) => entry.id === preselectedId);
    if (preselected) return preselected;
  }
  if (teammates.length <= 1) return teammates[0] || null;
  const pool = teammates.map((entry) => entry.player);
  const picked =
    kind === "cross"
      ? weightedPlayer(pool, random, "attack", headerScore)
      : selectReceiver(
          pool,
          owner.zone,
          playerAttribute(owner.player, "Vision"),
          pressure,
          random,
        );
  return teammates.find((entry) => entry.player === picked) || teammates[0];
}

// Best (highest-utility) candidate per action type, for renderActionTable()
// -- a display-only reduction of generateFreePlayCandidates()'s full
// concrete list (pass-to-A, pass-to-B, ... all individually scored) down
// to the single ~5-row shape the table already has. The REAL decision
// (chooseCandidate(), in runConstructedPossession()) still sees and
// scores every individual candidate; this never re-derives or
// approximates that, it just picks what to show per type.
function bestCandidateByType(candidates) {
  const best = {};
  for (const candidate of candidates) {
    if (
      !best[candidate.type] ||
      candidate.utility > best[candidate.type].utility
    )
      best[candidate.type] = candidate;
  }
  return best;
}

// Every Free Play resolver below returns the standardized possession-
// transition contract the runner (runConstructedPossession()) drives on,
// alongside the existing {outcome, code, resolved} shape (kept for
// backward compatibility, and "resolved" never meant "the attack ended" --
// only that this one action was):
//   terminal    -- true if the possession sequence stops here
//   possession  -- "retained" | "turnover" | "loose" | "dead"
//   nextOwnerId -- who has the ball for the NEXT step (null if none/dead)
//   ballEnd     -- {x,y,zone} where the ball actually ended up
//   restart     -- e.g. a foul's restart type, else null
//   reason      -- short machine-readable cause, for tests/telemetry
// Three spatially DISTINCT roles, previously collapsed into one
// `engager` (found near the PASSER, then reused for the interception
// duel AND the reception's own contest) -- the exact same category of
// bug resolveCross() had for the crosser/aerial-defender split, now
// fixed here too:
//   - passerPressureDefender: near the PASSER -- affects target
//     selection only (unchanged from before).
//   - laneInterceptor: whoever is genuinely positioned to cut the ball
//     out of the air, found by proximity to the STRAIGHT LINE from
//     passer to receiver, not proximity to the passer. Can be the same
//     defender as passerPressureDefender, or a completely different one
//     sitting further from the passer but directly in the flight path.
//   - receiverPressureDefender: near the RECEIVER -- affects reception
//     quality. Found independently of the other two, so a marked
//     receiver genuinely matters even when nobody is within duel range
//     of the passer at all (a real gap before this: the fully-
//     uncontested branch skipped resolveReceive() entirely, so a heavily
//     marked receiver off an unpressured pass got a hardcoded clean
//     reception no matter what).
function resolveOffsideAtKick(owner, receiver, kind, offside, trace) {
  const endpoint = pointOf(receiver);
  trace.push(
    traceEvent(
      "P.OFFSIDE.FLAG",
      `${playerName(receiver.player)} is offside when ${playerName(owner.player)} plays the ball`,
      {
        actor: owner,
        target: receiver,
        movement: kind,
        outcome: "turnover",
        ballFrom: pointOf(owner),
        ballTo: endpoint,
        contact: {
          point: pointOf(owner),
          actor: owner,
          type: kind,
          phase: "start",
        },
        ownerBefore: owner,
        ownerAfter: null,
        restart: "indirect-free-kick",
        offside,
      },
    ),
  );
  return {
    outcome: "OFFSIDE",
    code: "P.OFFSIDE.FLAG",
    resolved: true,
    terminal: true,
    possession: "dead",
    nextOwnerId: null,
    ballEnd: endpoint,
    restart: "indirect-free-kick",
    reason: `${kind}-offside`,
    offside,
  };
}

// Ball Flight & Arrival v1 (2026-08-20) -- see MATCH_LAB_PLAN.md. A real
// browser round asked directly why every uncontested pass, however far,
// arrived bang-on-target with zero error, in a fixed 550ms regardless of
// real distance: "we should make error rates on where the ball drops...
// it also is accurate when the ball goes somewhere, and the player
// arrives to that point." resolveThroughBallAccuracy() already proved the
// right SHAPE for this (skill vs. distance/pressure -> a bounded landing
// error) but not the right SCALE for an ordinary pass -- a through ball is
// an ambitious ball into space where skill dominates even at short range;
// a routine pass to a teammate who's already standing there should stay
// essentially automatic at 5-10 yards for anyone, and only really test
// technique once it gets genuinely long. So error here is DISTANCE-FIRST
// (baseErrorYards grows with the pass's own length) with skill/pressure
// as a MULTIPLIER on that base, rather than skill being the dominant term
// throughout -- confirmed directly: a 10-yard pass from an average passer
// wobbles by well under a yard, a 60-yard ball by several.
function resolvePassAccuracy(
  passer,
  { distanceYards = 15, pressureFactor = 0 } = {},
  random,
) {
  const passing = playerAttribute(passer, "Passing");
  const technique = playerAttribute(passer, "Technique");
  const decisions = playerAttribute(passer, "Decisions");
  const composure = playerAttribute(passer, "Composure");
  const vision = playerAttribute(passer, "Vision");
  const skill =
    (passing * 0.4 +
      technique * 0.25 +
      decisions * 0.15 +
      composure * 0.1 +
      vision * 0.1) /
    20;
  const quality = clamp(0.1, 0.99, skill - pressureFactor * 0.35);
  const baseErrorYards = clamp(0, 6, distanceYards * 0.05);
  const accuracyErrorYards = clamp(
    0,
    9,
    baseErrorYards * (1.4 - quality) * (0.6 + random() * 0.8),
  );
  return { quality, accuracyErrorYards };
}

// A ball struck along the ground doesn't arrive in a fixed beat regardless
// of distance -- the exact "60-metre bullet pass in 550ms" gap reported
// directly. PASS_FLIGHT_BASE_MS covers the strike/backswing beat (keeps a
// near-zero-distance pass from snapping instantly); everything past that
// scales with real distance at a brisk, deliberately simple constant pace
// (no per-player pace read here -- see this comment's own note in
// MATCH_LAB_PLAN.md on why player attributes don't touch the flight-speed
// side of this v1, only the landing-error side above). Calibrated so a
// routine ~10-yard pass lands almost exactly where the OLD fixed 550ms
// default already did (550 = 50 + 10/20*1000) -- short exchanges keep
// their existing feel; only genuinely long balls now take meaningfully
// longer, not shorter passes suddenly feeling sluggish.
const PASS_FLIGHT_PACE_YARDS_PER_SECOND = 20;
const PASS_FLIGHT_BASE_MS = 50;
function passFlightDurationMs(distanceYards) {
  return Math.round(
    PASS_FLIGHT_BASE_MS +
      (Math.max(0, distanceYards) / PASS_FLIGHT_PACE_YARDS_PER_SECOND) * 1000,
  );
}
// Ball Flight v2, Vertical Slice 1 (2026-08-20) -- same shape as
// passFlightDurationMs() above (still used unmodified by
// resolveThroughBall()), but reads the real per-pass-type ground speed
// (matchPassFlight.js's own PASS_TYPE_PROFILE) instead of the flat 20yd/s
// every pass used regardless of type. A driven ball arrives faster than a
// lofted one over the identical distance; this is the ONE place that
// difference is felt as real flight duration.
function passFlightDurationMsForType(distanceYards, passType) {
  const { speedYardsPerSecond } = passFlightProfile(passType, distanceYards);
  return Math.round(
    PASS_FLIGHT_BASE_MS + (Math.max(0, distanceYards) / speedYardsPerSecond) * 1000,
  );
}
function resolvePass(
  groups,
  availability,
  random,
  trace,
  interleaveOffBall = false,
  motionContext = null,
) {
  const owner = groups.owner;
  const passerPressureDefender = engagingOpponent(owner, groups.opponents);
  const passerPressure = passerPressureDefender
    ? computePressure(passerPressureDefender.player, owner.zone, 0)
    : 0.1;
  const receiver = selectTeammateTarget(
    groups.teammates,
    owner,
    passerPressure,
    random,
    "pass",
    availability?.preselectedTargetId,
  );
  // Candidate generation carries an advisory snapshot so illegal targets
  // can be removed before selection, but the resolver never trusts that
  // earlier view. This fresh snapshot is the authoritative kick-time ruling
  // and remains correct once future run/trap timing can move the line between
  // choosing the pass and actually contacting the ball.
  const offside = offsideSnapshotForTarget(
    groups,
    receiver,
    state.attackingDirection[owner.team],
  );
  if (offside.isOffside)
    return resolveOffsideAtKick(owner, receiver, "pass", offside, trace);

  const receiverPressureDefender = engagingOpponent(receiver, groups.opponents);

  // Ball Flight v2, Vertical Slice 1 (2026-08-20) -- see MATCH_LAB_PLAN.md's
  // "Ball Flight v2 Architecture" section for the full design. Retires the
  // flat, always-ground, always-aimed-at-the-receiver's-exact-spot delivery
  // model this file used until now: the pass now has a real TYPE (chosen
  // from distance/lane congestion/the passer's own attributes, not always
  // "ground"), a real independent flight (intendedPoint vs. actualEndpoint
  // -- the two are never reconciled, the ball never bends toward the
  // receiver afterward), and BOTH the receiver and every opponent race
  // that SAME trajectory as equals -- "the earliest eligible arrival makes
  // contact," not the receiver evaluated on a separate, privileged path
  // the way the old contactArrivalTiming()-only check worked.
  const passDistanceYards = yardDistance(owner, receiver);
  const passType = selectPassType({
    passer: owner.player,
    from: pointOf(owner),
    to: pointOf(receiver),
    opponents: groups.opponents,
  });
  const { accuracyErrorYards: baseAccuracyErrorYards } = resolvePassAccuracy(
    owner.player,
    { distanceYards: passDistanceYards, pressureFactor: passerPressure },
    random,
  );
  const { accuracyMultiplier } = passFlightProfile(passType, passDistanceYards);
  // A driven/lofted/aerial ball is genuinely harder to place precisely
  // than a simple ground pass -- resolvePassAccuracy() itself stays
  // unmodified (its own already-tuned ground-pass curve), this multiplier
  // is a new dimension layered on top, not an edit to its internals.
  const accuracyErrorYards = baseAccuracyErrorYards * accuracyMultiplier;
  const actualEndpointXY = deliveryLandingPoint(
    pointOf(receiver),
    accuracyErrorYards,
    random,
  );
  const actualEndpoint = {
    x: actualEndpointXY.x,
    y: actualEndpointXY.y,
    zone: zoneFromPercent(actualEndpointXY.x, actualEndpointXY.y),
  };
  const passDuration = passFlightDurationMsForType(passDistanceYards, passType);
  const flight = buildPassFlight({
    owner,
    receiver,
    from: pointOf(owner),
    intendedPoint: pointOf(receiver),
    actualEndpoint,
    passType,
    durationMs: passDuration,
  });

  // The unified race -- see matchPassFlight.js's own header comment on
  // earliestReachableContact() for the full rationale. The intended
  // receiver is one candidate among equals here, not a privileged check
  // run separately; this is what makes "meet the ball at the earliest
  // useful point along its trajectory" true for free -- whichever point
  // along the path someone FIRST qualifies for is what wins, never the
  // flight's own endpoint by default.
  const contact = earliestReachableContact({
    flight,
    candidates: [receiver, ...groups.opponents],
  });

  // passQuality feeds resolveReceive()'s own strain calc -- duel.probability
  // when a real in-flight contest happened, otherwise 1 (an uncontested
  // delivery is honestly high-quality; there was no defender to make it
  // otherwise).
  let passQuality = 1;

  if (!contact) {
    // Nobody -- not even the intended receiver -- could physically reach
    // ANY point along the whole flight in time. The ball travels its
    // full, independent distance to actualEndpoint and runs loose there.
    // The receiver's own best-effort chase is still shown honestly, via
    // contactArrivalTiming() (unchanged Match-Lab infrastructure -- still
    // the right tool for "how far did they actually get," now used only
    // for this one visual, not for the reachability GATE itself anymore).
    trace.push(
      traceEvent(
        "P.PASS",
        `${playerName(owner.player)} plays a ${passType.replace("-", " ")} pass toward ${playerName(receiver.player)}, but it runs away from everyone`,
        {
          actor: owner,
          target: receiver,
          movement: "pass",
          outcome: "neutral",
          ballFrom: pointOf(owner),
          ballTo: actualEndpoint,
          contact: { point: pointOf(owner), actor: owner, type: "pass", phase: "start" },
          ownerBefore: owner,
          ownerAfter: null,
          offside,
          duration: passDuration,
        },
      ),
    );
    const receiverArrival = contactArrivalTiming({
      player: receiver.player,
      from: pointOf(receiver),
      to: actualEndpoint,
      flightStartMs: 0,
      contactTimeMs: passDuration,
    });
    trace.push(
      traceEvent(
        "ATT.RECEIVER.RUN",
        `${playerName(receiver.player)} chases the delivery`,
        {
          actor: receiver,
          movement: "reposition",
          outcome: "neutral",
          duration: receiverArrival.availableMs,
          overlapWithPrevious: true,
          overlapStartOffsetMs: receiverArrival.reactionDelayMs,
          playerMoves: [
            {
              player: receiver,
              from: pointOf(receiver),
              to: receiverArrival.reachablePoint,
              action: "receive-pass-late",
            },
          ],
        },
      ),
    );
    trace.push(
      traceEvent(
        "P.RECEIVE.LATE",
        `${playerName(receiver.player)} cannot reach the delivery before it runs loose`,
        {
          actor: receiver,
          movement: "reception",
          outcome: "loose",
          duration: 0,
          ballFrom: actualEndpoint,
          ballTo: actualEndpoint,
          ownerBefore: null,
          ownerAfter: null,
          attribution: [
            {
              attr: "Pace + Acceleration",
              value: `${Math.round(playerAttribute(receiver.player, "Pace"))}/${Math.round(playerAttribute(receiver.player, "Acceleration"))}`,
              quantity: "arrival time",
              baseline: receiverArrival.availableMs / 1000,
              actual: receiverArrival.naturalEtaMs / 1000,
              unit: "s",
            },
          ],
        },
      ),
    );
    return {
      outcome: "LOOSE",
      code: "P.RECEIVE.LATE",
      resolved: true,
      terminal: false,
      possession: "loose",
      nextOwnerId: null,
      ballEnd: actualEndpoint,
      restart: null,
      reason: "pass-receiver-late",
    };
  }

  // contactPoint/contactDurationMs are the ball's REAL, resolved endpoint
  // and duration -- contact.atPoint/atMs when the receiver wins the race
  // outright (which may be well BEFORE the flight's own full endpoint --
  // meeting the ball early, not running to where it would have landed),
  // or the flight's own full actualEndpoint/passDuration when an opponent
  // contested it but the duel below still lets it through (the contest
  // didn't meaningfully redirect a ball that got through).
  let contactPoint;
  let contactDurationMs;
  let contestingDefenderId = null;

  if (!contact.isIntendedReceiver) {
    // An opponent physically reached the ball's own independent path
    // before the intended receiver could -- the SAME two-layer principle
    // already established for lane interceptions: physics decided WHO can
    // contest it (the race above), localizedDuel() decides whether that
    // physical win becomes a clean interception or the ball still somehow
    // gets through.
    const interceptor = contact.candidate;
    const duel = localizedDuel(
      owner.player,
      interceptor.player,
      ["Passing", "Technique", "Decisions", "Teamwork"],
      ["Positioning", "Anticipation", "Tackling", "Decisions"],
      FIXED_MINUTE,
      random,
      owner.zone,
    );
    passQuality = duel.probability;
    trace.push(
      traceEvent(
        "P.PASS",
        `${playerName(owner.player)} attempts a ${passType.replace("-", " ")} pass to ${playerName(receiver.player)}, contested by ${playerName(interceptor.player)} (${Math.round(duel.probability * 100)}%)`,
        {
          actor: owner,
          target: receiver,
          defender: interceptor,
          movement: "pass",
          outcome: "neutral",
          ballFrom: pointOf(owner),
          ballTo: duel.won ? actualEndpoint : contact.atPoint,
          contact: { point: pointOf(owner), actor: owner, type: "pass", phase: "start" },
          ownerBefore: owner,
          ownerAfter: null,
          offside,
          duration: duel.won ? passDuration : contact.atMs,
        },
      ),
    );
    if (!duel.won) {
      // The interceptor's own real run to the contest point, timed and
      // physically limited exactly like every other continuous move in
      // this model -- never teleported to meet a ball that already
      // decided, independently, that it would be there.
      trace.push(
        traceEvent(
          "P.PASS.LOST",
          `${playerName(interceptor.player)} intercepts`,
          {
            actor: owner,
            defender: interceptor,
            movement: "interception",
            outcome: "turnover",
            overlapWithPrevious: true,
            duration: contact.atMs,
            playerMoves: [
              {
                player: interceptor,
                from: pointOf(interceptor),
                to: contact.atPoint,
                action: "intercept",
                trajectory: sampleContinuousTrajectory({
                  from: pointOf(interceptor),
                  to: contact.atPoint,
                  player: interceptor.player,
                  totalMs: contact.atMs,
                  reactionDelayMs: CONTACT_REACTION_DELAY_MS,
                  sampleCount: 8,
                }),
              },
            ],
            contact: {
              point: contact.atPoint,
              actor: interceptor,
              type: "interception",
              phase: "end",
            },
            ownerBefore: null,
            ownerAfter: interceptor,
          },
        ),
      );
      return {
        outcome: "TURNOVER",
        code: "P.PASS.LOST",
        resolved: true,
        terminal: true,
        possession: "turnover",
        nextOwnerId: interceptor.id,
        ballEnd: contact.atPoint,
        restart: null,
        reason: "pass-intercepted",
      };
    }
    contactPoint = actualEndpoint;
    contactDurationMs = passDuration;
    contestingDefenderId = interceptor.id;
  } else {
    trace.push(
      traceEvent(
        "P.PASS",
        `${playerName(owner.player)} plays a ${passType.replace("-", " ")} pass to ${playerName(receiver.player)} -- uncontested`,
        {
          actor: owner,
          target: receiver,
          movement: "pass",
          outcome: "success",
          ballFrom: pointOf(owner),
          ballTo: contact.atPoint,
          contact: { point: pointOf(owner), actor: owner, type: "pass", phase: "start" },
          ownerBefore: owner,
          ownerAfter: null,
          offside,
          duration: contact.atMs,
        },
      ),
    );
    contactPoint = contact.atPoint;
    contactDurationMs = contact.atMs;
  }

  // Continuous World Motion During Ball Flight v1 (2026-08-20) -- see
  // reactOffBallContinuous()'s own header comment for the full
  // background. A real browser round reported everyone else freezing
  // solid/stopping-and-restarting for the pass's entire travel time; two
  // rounds of duration/overlap patches on the OLD discrete-beat model
  // (reactOffBall(), several fixed-duration ATT/DEF/GK.ADJUST events)
  // improved but never actually fixed it, because the beats themselves
  // -- not their timing parameters -- were the problem: velocity reset
  // to zero at every beat boundary is a stop, no matter how many beats or
  // how they're spaced. ONE continuous, physically-limited trajectory per
  // off-ball player for the WHOLE flight replaces that model outright.
  // excludedIds keeps the receiver (own arrival timed separately below,
  // against real contact time) and any identified interceptor (their own
  // run is authored on the P.PASS.LOST event itself, ending exactly at
  // the real contest point/time, not this call's own tactical target) OUT
  // of this pass -- otherwise a generic off-ball move could relocate
  // either of them before the reception/interception event reads their
  // position, breaking real ball-continuity.
  if (interleaveOffBall) {
    reactOffBallContinuous(
      groups,
      pointOf(owner),
      contactPoint,
      contactDurationMs,
      trace,
      {
        motionContext,
        excludedIds: [
          receiver.id,
          receiverPressureDefender?.id,
          contestingDefenderId,
        ].filter(Boolean),
      },
    );
  }

  // The marking defender's own real, physically-limited approach toward
  // the contest point -- the SAME "no static teleport, no distance-blind
  // snap" principle already applied to a lane interception, applied here
  // to the reception-contest defender too. A separate event, not folded
  // into the reception outcome below, for the same reason the pass
  // interceptor's own run lives on its own P.PASS.LOST event: the
  // receiver's own `receive-pass` move on that event has its own fragile,
  // specially-cased arrival timing (buildMatchLabPlaybackPlan()'s own
  // contactArrivalTiming()/preceding-interval lookup) that a shared
  // `duration`/`overlapWithPrevious` change on the SAME event would
  // silently break. Targets contactPoint/contactDurationMs -- the ball's
  // REAL resolved arrival, which can be earlier than the flight's own
  // full endpoint when the receiver met it early -- not the old flat
  // passLandingPoint/passDuration.
  if (receiverPressureDefender) {
    const pressureDefenderTrajectory = sampleContinuousTrajectory({
      from: pointOf(receiverPressureDefender), to: contactPoint, player: receiverPressureDefender.player,
      totalMs: contactDurationMs, reactionDelayMs: CONTACT_REACTION_DELAY_MS, sampleCount: 10,
    });
    const pressureDefenderPoint = pressureDefenderTrajectory[pressureDefenderTrajectory.length - 1].position;
    trace.push(traceEvent(
      "DEF.PRESS.RECEIVER", `${playerName(receiverPressureDefender.player)} closes down ${playerName(receiver.player)}`,
      {
        actor: receiverPressureDefender, movement: "reposition", outcome: "neutral",
        duration: contactDurationMs, overlapWithPrevious: true,
        playerMoves: [{
          player: receiverPressureDefender, from: pointOf(receiverPressureDefender), to: pressureDefenderPoint,
          action: "press-receiver", trajectory: pressureDefenderTrajectory,
        }],
      },
    ));
    // Atomic commit, same convention as reactOffBallContinuous()'s own --
    // the FRESH pressingOpponent lookup just below must see where they
    // REALLY ended up, not their frozen kick-time start.
    Object.assign(receiverPressureDefender, pressureDefenderPoint);
  }

  // Real pressure on the touch itself -- whoever is actually closest to
  // the REAL contact point (after any closing-down run just above), not a
  // kick-time guess. This can genuinely differ from receiverPressureDefender
  // (the kick-time engaging opponent, kept above only to give ONE specific
  // defender a visible closing-down run): a receiver who moved to meet the
  // ball early may find a DIFFERENT opponent now nearest the real contact
  // point, or nobody at all.
  const pressingOpponent = engagingOpponent(contactPoint, groups.opponents);

  if (!pressingOpponent) {
    // Nobody near the real contact point -- a genuinely clean reception
    // (no resolveReceive() roll needed when there's truly nobody around to
    // contest it). contact.phase stays "start" (NOT "end" -- reverted
    // 2026-08-20, see MATCH_LAB_PLAN.md for the full story):
    // buildMatchLabPlaybackPlan() already has a dedicated mechanism for
    // exactly this shape -- action==="receive-pass" + contact.phase==="start"
    // + move.to matching contact.point reuses the PRECEDING interval's own
    // [start,end] window for this move (or, when playerProfiles is
    // supplied -- the real live app always does -- a genuine kinetics-
    // timed arrival via contactArrivalTiming(), which also targets
    // contactTimeMs = startMs). Both paths require phase:"start"; setting
    // it to "end" here would silently defeat the kinetics path (a real
    // regression in the live app, caught by the user's own dedicated
    // reception-timing test) while only fixing the profile-less fallback
    // this file's own test harnesses happen to exercise.
    trace.push(
      traceEvent(
        "P.RECEIVE.CLEAN",
        `${playerName(receiver.player)} controls it cleanly`,
        {
          actor: receiver,
          movement: "reception",
          outcome: "success",
          playerMoves: [
            {
              player: receiver,
              from: pointOf(receiver),
              to: contactPoint,
              action: "receive-pass",
              reactionDelayMs: contact.reactionDelayMs,
              reachAllowanceYards: contact.reachAllowanceYards,
            },
          ],
          ballFrom: contactPoint,
          ballTo: contactPoint,
          contact: {
            point: contactPoint,
            actor: receiver,
            type: "control",
            phase: "start",
          },
          ownerBefore: null,
          ownerAfter: receiver,
        },
      ),
    );
    return {
      outcome: "CLEAN",
      code: "P.RECEIVE.CLEAN",
      resolved: true,
      terminal: false,
      possession: "retained",
      nextOwnerId: receiver.id,
      ballEnd: contactPoint,
      restart: null,
      reason: "pass-reception-clean",
    };
  }

  const pressure = computePressure(pressingOpponent.player, contactPoint.zone, 0);
  const received = resolveReceive(
    receiver.player,
    pressingOpponent.player,
    passQuality,
    pressure,
    false,
    receiver.zone,
    FIXED_MINUTE,
    random,
  );
  // received.status is resolveReceive()'s own real vocabulary --
  // "advance"/"hold"/"turnover" (matchEngineCore.js:1141-1231, read
  // directly, not assumed).
  const receptionLost = received.status === "turnover";
  // A KNOCK_FORWARD-advanced reception earns a real forward zone
  // (received.nextZone, resolveReceive's own contested-race result) --
  // genuine progression data for that reception, not the same point twice.
  const advancedReception =
    !receptionLost && received.nextZone !== receiver.zone;
  // Split into two events for a genuine advance -- an ADVANCING reception
  // needs the ball to keep moving AFTER contact, to receptionEnd -- a real
  // intermediate waypoint traceEvent()'s contact.phase (start/end only, no
  // "middle") cannot express within a single event. Splitting into
  // "control it at the real landing point" (this event) then "knock it
  // forward" (a plain following move, no contact of its own -- contact
  // already happened) is the same shape resolveDribble()'s own
  // touch-then-touch chain already uses for a multi-leg action, not new.
  // contact.phase stays "start" for the successful case -- see
  // P.RECEIVE.CLEAN's own comment just above on why
  // (buildMatchLabPlaybackPlan()'s existing receive-pass/
  // contactArrivalTiming mechanism specifically expects it).
  trace.push(
    traceEvent(
      received.context.code,
      `${playerName(receiver.player)}: ${received.status}`,
      {
        actor: receiver,
        defender: pressingOpponent,
        movement: "reception",
        outcome: receptionLost ? "turnover" : "success",
        playerMoves: receptionLost
          ? []
          : [
              {
                player: receiver,
                from: pointOf(receiver),
                to: contactPoint,
                action: "receive-pass",
                reactionDelayMs: contact.reactionDelayMs,
                reachAllowanceYards: contact.reachAllowanceYards,
              },
            ],
        ballFrom: contactPoint,
        ballTo: receptionLost
          ? pointOf(pressingOpponent)
          : contactPoint,
        contact: {
          point: receptionLost
            ? pointOf(pressingOpponent)
            : contactPoint,
          actor: receptionLost ? pressingOpponent : receiver,
          type: receptionLost ? "interception" : "control",
          phase: receptionLost ? "end" : "start",
        },
        ownerBefore: null,
        ownerAfter: receptionLost ? pressingOpponent : receiver,
      },
    ),
  );
  let receptionEnd = contactPoint;
  if (advancedReception) {
    receptionEnd = zoneCenterPoint(received.nextZone);
    trace.push(
      traceEvent(
        "P.RECEIVE.ADVANCE",
        `${playerName(receiver.player)} knocks it forward`,
        {
          actor: receiver,
          movement: "reception",
          outcome: "success",
          playerMoves: [
            {
              player: receiver,
              from: contactPoint,
              to: receptionEnd,
              action: "receive-and-advance",
            },
          ],
          ballFrom: contactPoint,
          ballTo: receptionEnd,
          ownerBefore: receiver,
          ownerAfter: receiver,
        },
      ),
    );
  }
  return {
    outcome: received.status.toUpperCase(),
    code: received.context.code,
    resolved: true,
    terminal: receptionLost,
    possession: receptionLost ? "turnover" : "retained",
    nextOwnerId: receptionLost ? pressingOpponent.id : receiver.id,
    ballEnd: receptionLost ? pointOf(pressingOpponent) : receptionEnd,
    restart: null,
    reason: receptionLost ? "pass-reception-lost" : "pass-reception",
  };
}

// Through Ball v1's own delivery accuracy (2026-08-19) -- a real browser
// round reported the ball landing "right into the mouth" every single
// time, with zero spatial error regardless of distance or pressure --
// unrealistic for a first-time, driven ball threaded into a channel under
// real conditions. Mirrors matchEngineCore.js's own resolveCrossDelivery()
// in SHAPE (skill vs. distance/pressure penalties -> a bounded accuracy
// error), but with passing-appropriate attributes -- a through ball is a
// driven/lofted PASS, not an aerial cross, so Crossing has no business
// being read here. Match-Lab-only, same as resolveThroughBall() itself
// (no production twin to stay faithful to -- this is genuinely new
// ground).
function resolveThroughBallAccuracy(
  passer,
  { distanceYards = 20, pressureFactor = 0 } = {},
  random,
) {
  const passing = playerAttribute(passer, "Passing");
  const vision = playerAttribute(passer, "Vision");
  const technique = playerAttribute(passer, "Technique");
  const decisions = playerAttribute(passer, "Decisions");
  const skill =
    (passing * 0.4 + vision * 0.3 + technique * 0.2 + decisions * 0.1) / 20;
  const distancePenalty = clamp(0, 0.3, (distanceYards - 15) / 70);
  const pressurePenalty = clamp(0, 0.35, pressureFactor * 0.5);
  const quality = clamp(0.05, 0.98, skill - distancePenalty - pressurePenalty);
  const accuracyErrorYards = clamp(
    0,
    10,
    (1 - quality) * 10 * (0.5 + random() * 0.5),
  );
  return { quality, accuracyErrorYards };
}

// Through Ball v1 (2026-08-18) -- see spatialDecision.js's
// throughBallUtility() for why this exists (reported bug: a ball owner
// shot from distance instead of feeding a teammate breaking forward on a
// central, onside run). The one real difference from resolvePass(): the
// ball is played to `availability.plannedMoveTo` -- the SPACE the runner
// is moving into (spatialDecision.js's planAttackerRepositioning(), "run-
// in-behind" job) -- never the receiver's own current position, which is
// what makes this a through ball rather than an ordinary pass. Because
// generateFreePlayCandidates() only ever offers this candidate when
// planAttackerRepositioning() has independently confirmed the runner wins
// the real arrival race (claimable(), the same Pace/Acceleration/
// Anticipation kinetics check driving ATT.ADJUST), this resolver doesn't
// re-run a foot race of its own once the ball arrives -- the only open
// question is whether a defender sitting in the passing LANE (between the
// passer and the target space, not at the target itself) can cut it out.
function resolveThroughBall(
  groups,
  availability,
  random,
  trace,
  interleaveOffBall = false,
  motionContext = null,
) {
  const owner = groups.owner;
  const passerPressureDefender = engagingOpponent(owner, groups.opponents);
  const passerPressure = passerPressureDefender
    ? computePressure(passerPressureDefender.player, owner.zone, 0)
    : 0.1;
  const receiver = selectTeammateTarget(
    groups.teammates,
    owner,
    passerPressure,
    random,
    "pass",
    availability?.preselectedTargetId,
  );
  // Defensive fallback only -- the real Free Play path always supplies a
  // planned target (the run-in-behind job's own intentionTarget); without
  // one there is no "space" to distinguish this from an ordinary pass.
  const targetPoint = availability?.plannedMoveTo || pointOf(receiver);

  // Offside is judged at the instant of the kick, against the runner's
  // CURRENT position -- correct in law (a player's own position when the
  // ball is played is what's judged, never where the ball ends up) and
  // the same "recalculate rather than trust candidate-generation state"
  // contract every other resolver here already follows.
  const offside = offsideSnapshotForTarget(
    groups,
    receiver,
    state.attackingDirection[owner.team],
  );
  if (offside.isOffside)
    return resolveOffsideAtKick(owner, receiver, "pass", offside, trace);

  // Real delivery error -- see resolveThroughBallAccuracy()'s own comment.
  // The lane-interceptor geometry below still reads off the ORIGINAL
  // intended targetPoint (a defender reacts to where the ball is AIMED as
  // it's struck, not to a resting spot that doesn't exist yet); only the
  // ball's own real destination -- and the runner adjusting to meet it --
  // uses the error-affected landing point.
  const { accuracyErrorYards } = resolveThroughBallAccuracy(
    owner.player,
    {
      distanceYards: yardDistance(owner, targetPoint),
      pressureFactor: passerPressure,
    },
    random,
  );
  const landingXY = deliveryLandingPoint(
    targetPoint,
    accuracyErrorYards,
    random,
  );
  const landingPoint = {
    x: landingXY.x,
    y: landingXY.y,
    zone: zoneFromPercent(landingXY.x, landingXY.y),
  };

  const laneInterceptor = nearestLaneInterceptor(
    owner,
    targetPoint,
    groups.opponents,
  );
  if (laneInterceptor) {
    const duel = localizedDuel(
      owner.player,
      laneInterceptor.player,
      ["Passing", "Vision", "Technique", "Decisions"],
      ["Positioning", "Anticipation", "Tackling", "Decisions"],
      FIXED_MINUTE,
      random,
      owner.zone,
    );
    trace.push(
      traceEvent(
        "P.THROUGH",
        `${playerName(owner.player)} slides a through ball for ${playerName(receiver.player)}, cut out by ${playerName(laneInterceptor.player)} (${Math.round(duel.probability * 100)}%)`,
        {
          actor: owner,
          target: receiver,
          defender: laneInterceptor,
          movement: "pass",
          outcome: "neutral",
          ballFrom: pointOf(owner),
          ballTo: duel.won ? landingPoint : pointOf(laneInterceptor),
          contact: {
            point: pointOf(owner),
            actor: owner,
            type: "pass",
            phase: "start",
          },
          ownerBefore: owner,
          ownerAfter: null,
          offside,
        },
      ),
    );
    if (!duel.won) {
      trace.push(
        traceEvent(
          "P.THROUGH.LOST",
          `${playerName(laneInterceptor.player)} reads it and cuts the through ball out`,
          {
            actor: owner,
            defender: laneInterceptor,
            movement: "interception",
            outcome: "turnover",
            contact: {
              point: pointOf(laneInterceptor),
              actor: laneInterceptor,
              type: "interception",
              phase: "start",
            },
            ownerBefore: null,
            ownerAfter: laneInterceptor,
          },
        ),
      );
      return {
        outcome: "TURNOVER",
        code: "P.THROUGH.LOST",
        resolved: true,
        terminal: true,
        possession: "turnover",
        nextOwnerId: laneInterceptor.id,
        ballEnd: pointOf(laneInterceptor),
        restart: null,
        reason: "through-ball-intercepted",
      };
    }
  } else {
    trace.push(
      traceEvent(
        "P.THROUGH",
        `${playerName(owner.player)} plays a through ball into the space for ${playerName(receiver.player)}`,
        {
          actor: owner,
          target: receiver,
          movement: "pass",
          outcome: "success",
          ballFrom: pointOf(owner),
          ballTo: landingPoint,
          contact: {
            point: pointOf(owner),
            actor: owner,
            type: "pass",
            phase: "start",
          },
          ownerBefore: owner,
          ownerAfter: null,
          offside,
        },
      ),
    );
  }

  // Fluid off-ball movement DURING the flight (2026-08-19) -- see
  // resolvePass()'s own comment on why this exists (both the "why", and
  // why the receiver must be excluded below -- they're already committed
  // to meeting the ball at landingPoint just below). A through ball is
  // usually the LONGEST-flight pass type of all, so freezing the rest of
  // the pitch for its whole travel was the most visible case of this bug.
  if (interleaveOffBall) {
    reactOffBall(groups, landingPoint, trace, {
      fraction: INTERLEAVED_REACTION_FRACTION,
      defensiveFraction: INTERLEAVED_DEFENSIVE_REACTION_FRACTION,
      duration: MOVEMENT_DURATIONS.pass,
      motionContext,
      excludedIds: [receiver.id],
    });
  }

  // The runner adjusts to meet the ball wherever it ACTUALLY lands -- an
  // explicit mover (never inferred from ballFrom/ballTo -- see
  // traceEvent()'s own comment), and still a clean touch: claimable()
  // already verified a genuine arrival-time margin against the ORIGINAL
  // target, and the bounded accuracy error above isn't large enough to
  // erase that margin outright -- see MATCH_LAB_PLAN.md for why a full
  // re-run of the arrival race against the corrected point is deliberately
  // NOT built here.
  trace.push(
    traceEvent(
      "P.THROUGH.RECEIVE",
      `${playerName(receiver.player)} runs onto it, clean through`,
      {
        actor: receiver,
        mover: receiver,
        moveFrom: pointOf(receiver),
        moveTo: landingPoint,
        movement: "reception",
        outcome: "success",
        ballFrom: landingPoint,
        ballTo: landingPoint,
        contact: {
          point: landingPoint,
          actor: receiver,
          type: "control",
          phase: "start",
        },
        ownerBefore: null,
        ownerAfter: receiver,
      },
    ),
  );
  return {
    outcome: "CLEAN",
    code: "P.THROUGH.RECEIVE",
    resolved: true,
    terminal: false,
    possession: "retained",
    nextOwnerId: receiver.id,
    ballEnd: landingPoint,
    restart: null,
    reason: "through-ball-received",
  };
}

// X1-shaped, not resolveDelivery-shaped: an open-play cross is a
// contestedRace(aerial) -> header finish -> keeper save, same as the real
// engine's X1 open-play mechanic (resolveDelivery is the *corner/set-piece*
// wrapper, with inswing/outswing texture that doesn't apply here). Skips
// the contest step when no defender is close enough to engage -- genuinely
// uncontested, not fabricated -- and reports "unresolved" rather than
// inventing a goalkeeper when the save step has nobody to resolve against.
// Codes produced by resolveCrossSourceContest() (matchEngineCore.js) that
// end the cross before it's even delivered, and how each maps onto the
// standardized transition contract -- one shared table so the dispatch
// below doesn't repeat this per code.
const CROSS_SOURCE_STOP_LABEL = {
  "CROSS.SOURCE.TACKLED": (crosserName, defenderName) =>
    `${defenderName} tackles ${crosserName} before the cross goes in`,
  "CROSS.SOURCE.BLOCKED_BEHIND": (crosserName, defenderName) =>
    `${defenderName} blocks the cross behind for a corner`,
  "CROSS.SOURCE.BLOCKED_LOOSE": (crosserName, defenderName) =>
    `${defenderName} blocks the cross, but it stays loose`,
};

// Contact, Ownership & Continuation (2026-08-18), point 4 -- replaces
// X1.D's old flat terminal turnover. A defender who has just won a header
// at contactPoint makes a real decision (spatialDecision.js's
// generateClearanceCandidates(), the same candidate-list + noisy-argmax
// shape Free Play's own action choice already uses) and that decision
// gets a real, attribute-driven execution (matchEngineCore.js's
// resolveClearanceAttempt()) -- never an instant, costless turnover.
// `groups` is resolveCross()'s OWN groups (the ATTACKING side's
// perspective) -- this function reverses the relevant parts of it for the
// defender's own decision: groups.opponents (minus this defender) are
// their own teammates, groups.keeper is their own keeper, and
// groups.owner + groups.teammates (the crosser and everyone on their
// side, receiver included) are who they need to get the ball away from.
// All new randomness comes from the SAME `random` stream already
// threaded through resolveCross() for every other roll in this
// possession step -- deterministic and isolated by construction (keyed
// off this step's own seed, per runConstructedPossession()), not a fresh
// or shared stream.
function resolveAerialClearanceContinuation(
  defender,
  contactPoint,
  groups,
  receiver,
  random,
  trace,
) {
  const defendingDirection = state.attackingDirection[defender.team];
  const defenderTeammates = groups.opponents.filter(
    (entry) => entry.id !== defender.id,
  );
  const attackers = [groups.owner, ...groups.teammates];
  const danger = clearanceDanger(contactPoint, attackers, defendingDirection);
  const candidates = generateClearanceCandidates(contactPoint, {
    attackers,
    teammates: defenderTeammates,
    keeper: groups.keeper,
    defenderPlayer: defender.player,
    defendingDirection,
    danger,
  });
  const decision = chooseCandidate(candidates, defender.player, random);
  const pressureFactor = pressureAt(contactPoint, attackers);

  if (decision.type === "clear-behind") {
    const outcome = resolveClearanceAttempt(
      defender.player,
      "clear-behind",
      {
        pressureFactor,
        distanceYards: yardDistance(contactPoint, decision.moveTo),
      },
      random,
    );
    const endpoint = {
      x: decision.moveTo.x,
      y: decision.moveTo.y,
      zone: zoneFromPercent(decision.moveTo.x, decision.moveTo.y),
    };
    trace.push(
      traceEvent(
        outcome.code,
        `${playerName(defender.player)} clears it behind for a corner`,
        {
          actor: defender,
          movement: "clearance",
          outcome: "turnover",
          ballFrom: contactPoint,
          ballTo: endpoint,
          contact: {
            point: contactPoint,
            actor: defender,
            type: "clearance",
            phase: "start",
          },
          ownerBefore: defender,
          ownerAfter: null,
        },
      ),
    );
    return {
      outcome: "BLOCKED/BEHIND",
      code: outcome.code,
      resolved: true,
      terminal: true,
      possession: "dead",
      nextOwnerId: null,
      ballEnd: endpoint,
      restart: "corner",
      reason: "clearance-behind",
    };
  }

  if (decision.type === "clear-long" || decision.type === "clear-touchline") {
    const outcome = resolveClearanceAttempt(
      defender.player,
      decision.type,
      {
        pressureFactor,
        distanceYards: yardDistance(contactPoint, decision.moveTo),
      },
      random,
    );
    // A CLEAN clearance travels the full intended distance; one that
    // comes up short (poor Heading/Composure, or under real pressure) is
    // nudged only PART of the way there instead -- reuses nudgeToward()'s
    // exact "never extrapolate past a real point" arithmetic, not a
    // second interpolation formula. A clear toward the touchline that
    // DOES come off clean genuinely goes out of play (a real, deliberate
    // touchline clearance almost always does) -- a throw-in for the
    // attacking side, not a contestable loose ball; a short one stays
    // in play as a genuinely loose ball (no recontest modeled, same
    // documented simplification every other "loose" outcome here
    // carries).
    const landing = outcome.clean
      ? decision.moveTo
      : nudgeToward(contactPoint, decision.moveTo, 0.45, 100);
    const endpoint = {
      x: landing.x,
      y: landing.y,
      zone: zoneFromPercent(landing.x, landing.y),
    };
    const wentOut = decision.type === "clear-touchline" && outcome.clean;
    trace.push(
      traceEvent(
        outcome.code,
        decision.type === "clear-long"
          ? `${playerName(defender.player)} clears it long upfield`
          : `${playerName(defender.player)} clears it toward the touchline`,
        {
          actor: defender,
          movement: "clearance",
          outcome: wentOut ? "turnover" : "neutral",
          ballFrom: contactPoint,
          ballTo: endpoint,
          contact: {
            point: contactPoint,
            actor: defender,
            type: "clearance",
            phase: "start",
          },
          ownerBefore: defender,
          ownerAfter: null,
        },
      ),
    );
    if (wentOut) {
      return {
        outcome: "TURNOVER",
        code: outcome.code,
        resolved: true,
        terminal: true,
        possession: "dead",
        nextOwnerId: null,
        ballEnd: endpoint,
        restart: "throw-in",
        reason: "clearance-touchline-out",
      };
    }
    return {
      outcome: "LOOSE",
      code: outcome.code,
      resolved: true,
      terminal: true,
      possession: "loose",
      nextOwnerId: null,
      ballEnd: endpoint,
      restart: null,
      reason: `clearance-${decision.type}`,
    };
  }

  if (decision.type === "pass-teammate" || decision.type === "pass-keeper") {
    const target = decision.target;
    const outcome = resolveClearanceAttempt(
      defender.player,
      decision.type,
      { pressureFactor, distanceYards: yardDistance(contactPoint, target) },
      random,
    );
    const endpoint = pointOf(target);
    trace.push(
      traceEvent(
        outcome.code,
        decision.type === "pass-teammate"
          ? `${playerName(defender.player)} finds ${playerName(target.player)}`
          : `${playerName(defender.player)} plays it back to ${playerName(target.player)}`,
        {
          actor: defender,
          target,
          movement: "pass",
          outcome: outcome.complete ? "success" : "turnover",
          ballFrom: contactPoint,
          ballTo: outcome.complete ? endpoint : contactPoint,
          contact: {
            point: contactPoint,
            actor: defender,
            type: "clearance",
            phase: "start",
          },
          ownerBefore: defender,
          ownerAfter: outcome.complete ? target : null,
          ownerAfterAt: "end",
        },
      ),
    );
    if (outcome.complete) {
      return {
        outcome: "RETAINED",
        code: outcome.code,
        resolved: true,
        terminal: true,
        possession: "turnover",
        nextOwnerId: target.id,
        ballEnd: endpoint,
        restart: null,
        reason: `clearance-${decision.type}-complete`,
      };
    }
    // Intercepted right at the source -- honestly reported as a
    // genuinely loose ball rather than inventing which specific attacker
    // recovers it (same "no fabricated recontest" rule as every other
    // "loose" outcome in this file).
    return {
      outcome: "TURNOVER",
      code: outcome.code,
      resolved: true,
      terminal: true,
      possession: "loose",
      nextOwnerId: null,
      ballEnd: contactPoint,
      restart: null,
      reason: `clearance-${decision.type}-intercepted`,
    };
  }

  // control -- brings it down, no ball flight at all (ballFrom === ballTo,
  // same convention P.RECEIVE.CLEAN already uses for a genuinely
  // stationary first touch). Success keeps this labeled "secures"/
  // "controls," never "clears" -- there is no clearance destination or
  // flight here at all (Contact, Ownership & Continuation, point 5).
  const outcome = resolveClearanceAttempt(
    defender.player,
    "control",
    { pressureFactor, distanceYards: 0 },
    random,
  );
  trace.push(
    traceEvent(
      outcome.code,
      outcome.controlled
        ? `${playerName(defender.player)} brings it under control`
        : `${playerName(defender.player)} is dispossessed under pressure`,
      {
        actor: defender,
        movement: "reception",
        outcome: outcome.controlled ? "success" : "turnover",
        ballFrom: contactPoint,
        ballTo: contactPoint,
        contact: {
          point: contactPoint,
          actor: defender,
          type: "control",
          phase: "start",
        },
        ownerBefore: defender,
        ownerAfter: outcome.controlled ? defender : receiver,
      },
    ),
  );
  if (outcome.controlled) {
    return {
      outcome: "CONTROLLED",
      code: outcome.code,
      resolved: true,
      terminal: true,
      possession: "turnover",
      nextOwnerId: defender.id,
      ballEnd: contactPoint,
      restart: null,
      reason: "clearance-control",
    };
  }
  // Dispossessed right at the contact point -- the receiver (the one
  // attacker who was genuinely right there contesting the same header) is
  // the one honest, already-established recipient to name, not a
  // fabricated third party.
  return {
    outcome: "TURNOVER",
    code: outcome.code,
    resolved: true,
    terminal: true,
    possession: "turnover",
    nextOwnerId: receiver.id,
    ballEnd: contactPoint,
    restart: null,
    reason: "clearance-control-dispossessed",
  };
}

function resolveCross(
  groups,
  availability,
  random,
  trace,
  interleaveOffBall = false,
  motionContext = null,
) {
  const owner = groups.owner;
  // Two spatially DIFFERENT questions, previously conflated into one
  // `defender` variable: who's pressuring the CROSSER (affects target
  // selection, out near the touchline) versus who's actually there to
  // contest the AERIAL ball at the RECEIVER's landing spot (near the far
  // post). A defender closing down the crosser isn't necessarily
  // anywhere near where the header actually happens -- selecting the
  // aerial contestant relative to the receiver, not the crosser, is what
  // stops a crosser-side defender from "automatically" winning a header
  // they were never actually near (see MATCH_LAB_PLAN.md correctness
  // pass, 2026-08-16).
  const crosserPressureDefender = engagingOpponent(owner, groups.opponents);
  const pressure = crosserPressureDefender
    ? computePressure(crosserPressureDefender.player, owner.zone, 0)
    : 0.1;
  const receiver = selectTeammateTarget(
    groups.teammates,
    owner,
    pressure,
    random,
    "cross",
    availability?.preselectedTargetId,
  );
  const keeper = groups.keeper;
  // Recalculate at contact rather than trusting candidate-generation state;
  // see resolvePass() for the authoritative kick-time contract.
  const offside = offsideSnapshotForTarget(
    groups,
    receiver,
    state.attackingDirection[owner.team],
  );

  // Cross Resolution Pass A -- source contest, before the ball is struck
  // at all. A THIRD spatial role, distinct from both of the above:
  // crossSourceContestDefender() requires real position AND a reachable
  // path toward the intended delivery (never proximity alone -- see that
  // function's own comment) -- a defender standing behind the crosser
  // relative to the kicking direction cannot contest this no matter how
  // close they stand.
  const sourceDefender = crossSourceContestDefender(
    owner,
    receiver,
    groups.opponents,
  );
  let deliveryPressureFactor = 0;
  if (sourceDefender) {
    const contest = resolveCrossSourceContest(
      owner.player,
      sourceDefender.player,
      FIXED_MINUTE,
      random,
    );
    trace.push(
      traceEvent(
        contest.code,
        contest.delivered
          ? contest.outcome === "pressured"
            ? `${playerName(sourceDefender.player)} closes down ${playerName(owner.player)}, but the cross gets away`
            : `${playerName(sourceDefender.player)} fails to affect the delivery`
          : CROSS_SOURCE_STOP_LABEL[contest.code](
              playerName(owner.player),
              playerName(sourceDefender.player),
            ),
        {
          actor: owner,
          defender: sourceDefender,
          movement: "cross",
          outcome: contest.delivered ? "neutral" : "turnover",
          ballFrom: pointOf(owner),
          ballTo: contest.delivered ? pointOf(owner) : pointOf(sourceDefender),
        },
      ),
    );
    if (!contest.delivered) {
      // TACKLED: a clean turnover, the cross never happened. BLOCKED_BEHIND:
      // dead, out for a corner (no next owner, matching D.BLOCK's own
      // "behind" handling in resolveShoot()). BLOCKED_LOOSE: the ball is
      // still live and physically with the blocking defender -- a real
      // loose-ball re-contest isn't modeled this pass (same documented
      // simplification resolveShoot()'s own blocked/loose case already
      // carries), reported as an honest turnover to them rather than a
      // fabricated recontest.
      if (contest.outcome === "tackled" || contest.blockOutcome === "loose") {
        return {
          outcome:
            contest.outcome === "tackled"
              ? "TURNOVER"
              : `BLOCKED/${contest.blockOutcome.toUpperCase()}`,
          code: contest.code,
          resolved: true,
          terminal: true,
          possession: "turnover",
          nextOwnerId: sourceDefender.id,
          ballEnd: pointOf(sourceDefender),
          restart: null,
          reason:
            contest.outcome === "tackled"
              ? "cross-source-tackled"
              : "cross-source-blocked-loose",
        };
      }
      return {
        outcome: "BLOCKED/BEHIND",
        code: contest.code,
        resolved: true,
        terminal: true,
        possession: "dead",
        nextOwnerId: null,
        ballEnd: pointOf(sourceDefender),
        restart: "corner",
        reason: "cross-source-blocked-behind",
      };
    }
    deliveryPressureFactor = contest.pressureFactor;
  }

  // Offside is judged when the cross is actually played. A source tackle
  // or block above means no delivery happened, so it must resolve before
  // this check rather than being overwritten by a flag for a ball that was
  // never kicked.
  if (offside.isOffside)
    return resolveOffsideAtKick(owner, receiver, "cross", offside, trace);

  // Delivery quality + a REAL landing point -- not always exactly the
  // intended receiver's own position. Cross Resolution Pass A's other
  // headline requirement: the ball must not automatically travel through
  // a defender marker to a fixed point regardless of how the delivery
  // actually went; a real accuracy error (from resolveCrossDelivery(),
  // driven by Crossing/Technique/Decisions/Composure, the delivery
  // distance, and any source pressure above) now genuinely moves where
  // the ball ends up.
  const delivery = resolveCrossDelivery(
    owner.player,
    {
      pressureFactor: deliveryPressureFactor,
      distanceYards: yardDistance(owner, receiver),
    },
    random,
  );
  const landingXY = deliveryLandingPoint(
    pointOf(receiver),
    delivery.accuracyErrorYards,
    random,
  );
  const landingPoint = {
    x: landingXY.x,
    y: landingXY.y,
    zone: zoneFromPercent(landingXY.x, landingXY.y),
  };
  trace.push(
    traceEvent(
      delivery.code,
      deliveryPressureFactor > 0
        ? `${playerName(owner.player)} delivers a cross under pressure (${Math.round(delivery.quality * 100)}% quality)`
        : `${playerName(owner.player)} delivers a cross (${Math.round(delivery.quality * 100)}% quality)`,
      {
        actor: owner,
        target: receiver,
        movement: "cross",
        outcome: "neutral",
        ballFrom: pointOf(owner),
        ballTo: landingPoint,
        contact: {
          point: pointOf(owner),
          actor: owner,
          type: "cross",
          phase: "start",
        },
        ownerBefore: owner,
        ownerAfter: null,
        offside,
      },
    ),
  );

  // Fluid off-ball movement DURING the flight (2026-08-19) -- see
  // resolvePass()'s own comment on why this exists. The receiver is
  // excluded for the same reason as there -- engagingOpponent(receiver,
  // ...) just below reads their CURRENT position to find the aerial
  // contestant; a generic off-ball nudge relocating them first would
  // change who that even is, not just when they get there.
  if (interleaveOffBall) {
    reactOffBall(groups, landingPoint, trace, {
      fraction: INTERLEAVED_REACTION_FRACTION,
      defensiveFraction: INTERLEAVED_DEFENSIVE_REACTION_FRACTION,
      duration: MOVEMENT_DURATIONS.cross,
      motionContext,
      excludedIds: [receiver.id],
    });
  }

  // The AERIAL contest itself (who wins the header at the landing point)
  // is still engagingOpponent(receiver, ...) against the receiver's own
  // authored position, and still the same attribute-only contestedRace()
  // -- real arrival-time modeling (Ronaldo and Stam actually MOVING to
  // contest the LANDING point rather than starting from it) is Cross
  // Resolution Pass B, deliberately not built here. What Contact,
  // Ownership & Continuation (2026-08-18) DOES fix: both the receiver AND
  // the aerial defender are now shown genuinely converging on the ONE
  // authoritative contact point (landingPoint) via playerMoves -- neither
  // one just teleports there, and the header/clearance that follows
  // begins from that exact point, never from either player's own static
  // pre-contest spot (the previous X1.D bug: a defender who won the
  // header was credited with owning the ball at pointOf(aerialDefender),
  // their ORIGINAL position, even though the contest genuinely happened
  // at landingPoint).
  const aerialDefender = engagingOpponent(receiver, groups.opponents);
  if (aerialDefender) {
    const race = contestedRace(
      receiver.player,
      aerialDefender.player,
      FIXED_MINUTE,
      random,
      receiver.zone,
      { aerial: true },
    );
    const contactPoint = landingPoint;
    const winner = race.won ? receiver : aerialDefender;
    trace.push(
      traceEvent(
        race.won ? "X1.R" : "X1.D",
        race.won
          ? `${playerName(receiver.player)} wins the aerial ball against ${playerName(aerialDefender.player)}`
          : `${playerName(aerialDefender.player)} wins the aerial ball`,
        {
          actor: owner,
          target: receiver,
          defender: aerialDefender,
          movement: "cross",
          outcome: race.won ? "success" : "turnover",
          playerMoves: [
            { player: receiver, to: contactPoint, action: "attack-ball" },
            { player: aerialDefender, to: contactPoint, action: "challenge" },
          ],
          contact: {
            point: contactPoint,
            actor: winner,
            type: "header",
            phase: "end",
          },
          ownerBefore: null,
          ownerAfter: winner,
          ballFrom: landingPoint,
          ballTo: contactPoint,
        },
      ),
    );
    if (!race.won) {
      return resolveAerialClearanceContinuation(
        aerialDefender,
        contactPoint,
        groups,
        receiver,
        random,
        trace,
      );
    }
  } else {
    trace.push(
      traceEvent(
        "X1",
        `${playerName(receiver.player)} rises unchallenged -- no defender close enough to engage`,
        {
          actor: owner,
          target: receiver,
          movement: "cross",
          outcome: "success",
          playerMoves: [
            { player: receiver, to: landingPoint, action: "attack-ball" },
          ],
          contact: {
            point: landingPoint,
            actor: receiver,
            type: "header",
            phase: "end",
          },
          ownerBefore: null,
          ownerAfter: receiver,
          ballFrom: landingPoint,
          ballTo: landingPoint,
        },
      ),
    );
  }
  // Range check (2026-08-18) -- a won aerial used to become a header
  // attempt at goal unconditionally, regardless of how far the contact
  // point actually was from goal (reported bug: a header from ~35+ yards
  // out, well beyond where a headed effort at goal is realistic). This is
  // a defensive backstop, not the primary fix -- generateFreePlayCandidates()
  // now only offers "cross" to a teammate already inside isCrossTargetZone(),
  // so Free Play itself shouldn't reach this branch with a distant receiver
  // any more -- but resolveCross() is also reachable from Scenario Probe
  // and any other caller that stages its own geometry directly, so the
  // resolver enforces the same real-football boundary itself rather than
  // trusting an upstream candidate list it can't see. Reuses the identical
  // box-plus-margin definition the candidate gate uses, so the two never
  // silently drift apart.
  if (!isCrossTargetZone(landingPoint, state.attackingDirection[owner.team])) {
    trace.push(
      traceEvent(
        "X1.CONTROL",
        `${playerName(receiver.player)} controls it -- too far out for a header at goal`,
        {
          actor: receiver,
          movement: "reception",
          outcome: "success",
          ballFrom: landingPoint,
          ballTo: landingPoint,
          contact: {
            point: landingPoint,
            actor: receiver,
            type: "touch",
            phase: "end",
          },
          ownerBefore: receiver,
          ownerAfter: receiver,
        },
      ),
    );
    return {
      outcome: "CONTROLLED",
      code: "X1.CONTROL",
      resolved: true,
      terminal: false,
      possession: "retained",
      nextOwnerId: receiver.id,
      ballEnd: landingPoint,
      restart: null,
      reason: "cross-received-controlled",
    };
  }
  const headerAttempt = resolveFinishAttempt(
    "header",
    receiver.player,
    random,
    aerialDefender ? 1 : 1.15,
  );
  const headerMiss = headerAttempt.onTarget
    ? null
    : missPointFor(receiver, keeper, null, headerAttempt.code);
  // Shot Placement v1 (2026-08-20) never reached headers -- this stayed on
  // goalPointFor()'s flat keeper-position/x:50 aim the whole time, unlike
  // resolveShoot()'s own on-target event (shotAimPoint). Given the same
  // treatment here now, computed ONCE and reused for both this event's own
  // ballTo and the EMPTY_NET branch's ballFrom below -- same "never
  // re-derive" rule as shotAimPoint (a second independent goalPointFor()
  // call in EMPTY_NET is exactly the bug that produced a real ball
  // discontinuity there, caught by Timeline Playback v1's continuity
  // validation, 2026-08-21). A contested aerial header is a rushed, less
  // composed connection than an uncontested free header -- aerialDefender
  // sets the pressure term the same way it already scales
  // resolveFinishAttempt()'s own quality multiplier just above.
  const headerAimPoint = headerAttempt.onTarget
    ? shotPlacementSpread(receiver, keeper, aerialDefender ? 0.35 : 0.1, random)
    : null;
  trace.push(
    traceEvent(
      headerAttempt.code,
      headerAttempt.onTarget ? "On target" : "Off target",
      {
        actor: receiver,
        keeper,
        movement: "header",
        outcome: headerAttempt.onTarget ? "success" : "fail",
        ballFrom: landingPoint,
        ballTo: headerAttempt.onTarget
          ? headerAimPoint
          : headerMiss.point,
        contact: {
          point: landingPoint,
          actor: receiver,
          type: "header",
          phase: "start",
        },
        ownerBefore: receiver,
        ownerAfter: null,
        badge: headerAttempt.onTarget ? null : headerMiss.badge,
        heightCue: headerAttempt.onTarget ? false : headerMiss.heightCue,
      },
    ),
  );
  if (!headerAttempt.onTarget) {
    return {
      outcome: "NO GOAL",
      code: headerAttempt.code,
      resolved: true,
      terminal: true,
      possession: "dead",
      nextOwnerId: null,
      ballEnd: headerMiss.point,
      restart: "goal-kick",
      reason: "header-off-target",
    };
  }
  const keeperBeaten = keeper && isKeeperBeaten(receiver, keeper);
  if (!keeper || keeperBeaten) {
    // No keeper placed means an actually empty net, not an ambiguous state
    // -- an on-target effort with nobody in goal is a goal, not something
    // left unresolved. A keeper who's been rounded (see isKeeperBeaten())
    // is the SAME structural situation -- there's genuinely nobody
    // positioned to make the save, whether or not a keeper marker happens
    // to be placed somewhere else on the pitch. "Unresolved" is for when
    // the engine genuinely can't determine an outcome, not a stand-in for
    // "nobody's there to stop it."
    // ballFrom chains from the header event's own real endpoint --
    // headerAimPoint, already the on-target header's ballTo one event up
    // (Shot Placement v1 now reaches headers too, see headerAimPoint's own
    // comment) -- not pointOf(receiver) (would re-travel from the
    // receiver's own position a second time) and not a fresh goalPointFor()/
    // shotPlacementSpread() call (would independently redraw random() and
    // silently land a DIFFERENT point than the header actually flew to --
    // a real ball discontinuity, caught by Timeline Playback v1's own
    // continuity validation, 2026-08-21). emptyNetEnd reuses that same x,
    // just pushed to net depth for the "ball trapped in the net" landing
    // spot.
    const emptyNetEnd = netPointFor(receiver, headerAimPoint.x);
    trace.push(
      traceEvent(
        "EMPTY_NET",
        keeperBeaten
          ? `${playerName(receiver.player)} finishes into an empty net -- ${playerName(keeper.player)} is well beaten`
          : `${playerName(receiver.player)} finishes into an empty net -- no goalkeeper placed`,
        {
          actor: receiver,
          movement: "shot",
          outcome: "goal",
          ballFrom: headerAimPoint,
          ballTo: emptyNetEnd,
          badge: "GOAL",
        },
      ),
    );
    return {
      outcome: "GOAL",
      code: "EMPTY_NET",
      resolved: true,
      terminal: true,
      possession: "dead",
      nextOwnerId: null,
      ballEnd: emptyNetEnd,
      restart: "kickoff",
      reason: keeperBeaten ? "keeper-beaten-goal" : "empty-net-goal",
    };
  }
  const save = resolveKeeperSave(
    receiver.player,
    keeper.player,
    "header",
    FIXED_MINUTE,
    random,
    receiver.zone,
  );
  const saveEndpoint = pushKeeperSaveEvent(trace, {
    shooterEntry: receiver,
    keeperEntry: keeper,
    save,
  });
  if (save.goal) {
    return {
      outcome: "GOAL",
      code: save.code,
      resolved: true,
      terminal: true,
      possession: "dead",
      nextOwnerId: null,
      ballEnd: saveEndpoint,
      restart: "kickoff",
      reason: "header-save-goal",
    };
  }
  if (!save.rebound) {
    return keeperSaveTransition(save, keeper, saveEndpoint, "header");
  }
  if (!aerialDefender) {
    // No opponent placed to contest the loose ball either -- uncontested,
    // same principle as the aerial race above, straight to the shot roll.
    const scored =
      random() <
      transitionShotChance(
        receiver.player,
        keeper.player,
        FIXED_MINUTE,
        0.32,
        poacherScore,
      );
    const reboundMiss = scored
      ? null
      : missPointFor(receiver, keeper, null, null);
    const reboundEnd = scored
      ? netPointFor(receiver, shotPlacementSpread(receiver, keeper, REBOUND_SHOT_PRESSURE, random).x)
      : reboundMiss.point;
    trace.push(
      traceEvent(
        scored ? "REBOUND.GOAL" : "REBOUND.MISS",
        scored
          ? `${playerName(receiver.player)} scrambles it in, unchallenged`
          : "The rebound drifts away, unchallenged",
        {
          actor: receiver,
          keeper,
          movement: "rebound-shot",
          outcome: scored ? "goal" : "fail",
          // Continues from saveEndpoint -- the save's real endpoint, only
          // reachable when save.rebound is true (K.SAVE.2/.5/.6).
          // mover/moveTo: the receiver genuinely moves to meet the ball at
          // the rebound spot -- see resolveShoot()'s identical fix.
          mover: receiver,
          moveTo: saveEndpoint,
          ballFrom: saveEndpoint,
          ballTo: reboundEnd,
          badge: scored ? null : reboundMiss.badge,
          contact: {
            point: saveEndpoint,
            actor: receiver,
            type: "rebound-shot",
            phase: "start",
          },
          ownerBefore: receiver,
          ownerAfter: null,
        },
      ),
    );
    return {
      outcome: scored ? "GOAL" : "NO GOAL",
      code: scored ? "REBOUND.GOAL" : "REBOUND.MISS",
      resolved: true,
      // A miss here is the ball genuinely going out of play (wide/over) --
      // NOT a keeper catch. The old nextOwnerId: keeper.id claimed the
      // keeper owned the ball at reboundEnd (an off-target miss point
      // nobody, keeper included, is actually standing at) -- the exact
      // "keeper ownership at an out-of-play endpoint" bug this pass
      // fixes.
      terminal: true,
      possession: "dead",
      nextOwnerId: null,
      ballEnd: reboundEnd,
      restart: scored ? "kickoff" : "goal-kick",
      reason: scored ? "rebound-goal-uncontested" : "rebound-miss-uncontested",
    };
  }
  return resolveReboundScramble(
    receiver,
    aerialDefender,
    keeper,
    receiver.zone,
    random,
    trace,
    saveEndpoint,
  );
}

// The real tick loop never lets selectEngagement()/resolveEngagement() fire
// on their own -- they only decide the *flavor* of a win the defender has
// already earned in an upstream progression duel (see resolveEngagement's
// own comment in matchEngineCore.js, and draft-run.js's transitionDuel).
// That duel -- localizedDuel() with these exact attacker/defender labels --
// is where skill actually differentiates a good dribbler from a bad one; a
// version of this function that skipped straight to engagement (as this one
// used to) tests a narrower question than "can this player beat a
// defender," and understated how much defender quality matters as a result.
//
// UPDATED 2026-08-18, a deliberate, EXPLICIT divergence from production
// (not an oversight): this used to reuse draft-run.js's own transitionDuel
// attribute lists byte-for-byte ("faithful to production, not a genuine
// dribbling model"). A real browser round asked directly whether Agility/
// Dribbling/Strength matter for "a low-strength, high-agility, high-
// Dribbling player... nimble and able to exit tight spaces against bigger,
// chunkier opponents" -- and under the OLD lists, they genuinely didn't: a
// nimble lightweight and a big, clumsy attacker had identical odds here.
// localizedDuel() itself (matchEngineCore.js) is fully attribute-agnostic
// -- it just averages whichever labels it's handed -- so extending the
// list at THIS Match-Lab-only call site changes nothing about the shared
// function or about draft-run.js's own transitionDuel, which keeps the
// original narrower lists unchanged; live production match outcomes are
// unaffected. Agility/Dribbling now read on the attacker's side (the
// nimble-in-tight-spaces case); Strength now reads on the defender's side
// (the "bigger, chunkier" advantage) -- deliberately NOT added to the
// attacker's own side, so the trade-off the user described (nimble beats
// bulk, bulk doesn't cancel out being outmuscled) is real, not symmetric.
// Execution attributes still don't drive whether "dribble" gets *chosen*
// (that's still Spatial Decision Intelligence v1's ability-blind decision
// layer, unchanged, see spatialDecision.js's own header) -- only whether a
// chosen dribble actually succeeds.
// engagement.outcome mapping (resolveEngagement returns exactly one of
// "foul"|"beaten"|"loose"|"won" -- matchEngineCore.js): "won" is the
// defender winning the ball outright (turnover for the attacker); "beaten"
// is the defender losing the challenge despite the aggregate favoring them
// (attacker escapes -- a success, not a turnover); "loose"/"foul" are both
// transitional/mixed rather than a clean success or fail for either side.
function engagementOutcomeLabel(outcome) {
  if (outcome === "won") return "turnover";
  if (outcome === "beaten") return "success";
  return "neutral";
}

// A tackle is two physical beats: both players first meet at the ball, then
// the ball reacts to the outcome. Keeping those beats separate lets the
// contact validator assert the tackler really arrived without pretending a
// contact and its post-contact deflection happened at the same coordinate.
function duelReaction(owner, defender, outcome) {
  const contactPoint = pointOf(owner);
  if (outcome === "foul")
    return { contactPoint, ballEnd: contactPoint, mover: null, code: null };
  if (outcome === "won") {
    return {
      contactPoint,
      ballEnd: advanceTowardGoal(contactPoint, defender.team, 1.2),
      mover: defender,
      code: "T.WON.CONTROL",
      label: `${playerName(defender.player)} takes the ball away from the challenge`,
      possession: defender,
    };
  }
  if (outcome === "beaten") {
    return {
      contactPoint,
      ballEnd: advanceTowardGoal(contactPoint, owner.team, 1.5),
      mover: owner,
      code: "T.BEATEN.ESCAPE",
      label: `${playerName(owner.player)} nudges the ball clear of the challenge`,
      possession: owner,
    };
  }
  let looseEnd = approachPoint(contactPoint, pointOf(defender), 1.4);
  if (yardDistance(contactPoint, looseEnd) < 0.15) {
    const yard = toYardPoint(contactPoint);
    looseEnd = fromYardPoint({
      x: clamp(
        0,
        PITCH_WIDTH_YARDS,
        yard.x + (String(owner.id) < String(defender.id) ? -1.4 : 1.4),
      ),
      y: yard.y,
    });
  }
  return {
    contactPoint,
    ballEnd: { ...looseEnd, zone: zoneFromPercent(looseEnd.x, looseEnd.y) },
    mover: null,
    code: "T.LOOSE.DEFLECT",
    label: "The challenge knocks the ball loose",
    possession: null,
  };
}

// Blends toward `to` by `fraction` (0-100% grid units, a cosmetic-scale
// interpolation -- not the yard-space approachPoint() spatialDecision.js
// itself already exports for AUTHORITATIVE per-step caps). fraction >= 1
// arrives exactly at `to`, matching the previous unconditional-jump
// behavior exactly.
function partialPoint(from, to, fraction) {
  if (fraction >= 1) return { x: to.x, y: to.y };
  return {
    x: from.x + (to.x - from.x) * fraction,
    y: from.y + (to.y - from.y) * fraction,
  };
}

const OFF_BALL_MIN_SPACING_YARDS = 8;

// Resolve spacing from the same proposed-target snapshot the motion batch
// consumes. Comparing current positions would always react one beat late.
// Only same-team players repel one another; opponents remain free to converge
// for tackles, blocks and contested contacts.
function applyOffBallSeparation(proposals, roster) {
  if (proposals.length < 1) return proposals;
  const teamOf = new Map(roster.map((entry) => [entry.id, entry.team]));
  const proposalById = new Map(
    proposals.map((proposal) => [proposal.id, proposal]),
  );
  return proposals.map((proposal) => {
    const targetYards = toYardPoint(proposal.target);
    let offsetX = 0;
    let offsetY = 0;
    for (const other of roster) {
      if (
        !other ||
        other.id === proposal.id ||
        teamOf.get(other.id) !== teamOf.get(proposal.id)
      )
        continue;
      const otherProposal = proposalById.get(other.id);
      const otherYards = toYardPoint(otherProposal?.target ?? other);
      const dx = targetYards.x - otherYards.x;
      const dy = targetYards.y - otherYards.y;
      const distance = Math.hypot(dx, dy);
      if (distance >= OFF_BALL_MIN_SPACING_YARDS) continue;
      // Exact overlap has no geometric direction. Stable id ordering creates
      // equal-and-opposite horizontal separation without RNG or roster-order
      // dependence.
      const unitX =
        distance > 0.001
          ? dx / distance
          : String(proposal.id) < String(other.id)
            ? -1
            : 1;
      const unitY = distance > 0.001 ? dy / distance : 0;
      const missing = OFF_BALL_MIN_SPACING_YARDS - distance;
      const share = otherProposal ? 0.55 : 1;
      offsetX += unitX * missing * share;
      offsetY += unitY * missing * share;
    }
    if (Math.abs(offsetX) < 0.001 && Math.abs(offsetY) < 0.001) return proposal;
    const separated = fromYardPoint({
      x: clamp(0, PITCH_WIDTH_YARDS, targetYards.x + offsetX),
      y: clamp(0, PITCH_LENGTH_YARDS, targetYards.y + offsetY),
    });
    return {
      ...proposal,
      target: { ...separated, zone: zoneFromPercent(separated.x, separated.y) },
    };
  });
}

const OFF_BALL_ACTION_PHRASE = {
  attacker: {
    "run-in-behind": "runs in behind",
    "recover-onside": "checks back onside",
    "support-short": "offers a short passing lane",
    "hold-width": "holds the width",
    "diagonal-inside": "moves diagonally inside",
    "drop-deep": "drops deep to offer a link",
    "drag-away": "drags a marker away",
    "pin-last-line": "pins the last line",
    overload: "joins the overload",
    "clear-the-zone": "clears the zone",
  },
  defender: {
    "press-ball": "presses the ball",
    cover: "drops into cover",
    mark: "tracks a runner",
    "screen-lane": "screens a passing lane",
    "shift-unit": "shifts with the unit",
    "drop-block": "drops into the block",
  },
  keeper: {
    "set-position": "holds the goalkeeper line",
  },
};

function offBallAssignmentsLabel(moves, role) {
  return moves
    .map((move) => {
      const phrase =
        OFF_BALL_ACTION_PHRASE[role]?.[move.action] ?? "repositions";
      return `${playerName(move.player.player)} ${phrase}`;
    })
    .join("; ");
}

// Off-Ball Attacker/Defender/Goalkeeper Awareness, factored into ONE
// shared function so it can be called both ways: once per whole action
// (the possession loop's own post-action step, fraction 1 -- the
// existing, unchanged full reposition, guaranteeing real convergence by
// the time an action concludes) AND interleaved PARTIALLY mid-carry (see
// resolveCarry()/resolveDribble()'s own calls, fraction < 1). A real
// browser round reported the consequence of only ever doing the former:
// on-ball movement happened smoothly across several real touches (Touches
// Per Carry) while every off-ball player stood frozen for the ENTIRE
// span, then all jumped to their final spot the instant the action
// concluded -- "it looks like non-ball-carriers wait for their turn to
// move." Same three codes as before (ATT.ADJUST/GK.ADJUST/DEF.ADJUST,
// same playerMoves[] shape) -- existing tests/consumers keyed off those
// codes are unaffected; only WHEN and how far each call moves things
// changed. `duration` overrides the default "reposition" pacing (450ms)
// -- interleaved calls pass a shorter one so adding these doesn't blow up
// how long a single carry action takes to fully animate.
// Defensive recovery urgency (2026-08-19) -- a real browser round reported
// a "massive gap inside the defensive line" behind a long, fast carry,
// with defenders left far out of position -- a real consequence of every
// interleaved reaction (attacker AND defender alike) sharing the exact
// same modest `fraction`, tuned for a carrier's own measured, tactical
// off-ball movement. A defender scrambling to recover behind a live break
// is not making the same kind of considered positional choice -- they're
// sprinting back at real urgency. `defensiveFraction` (defaults to
// `fraction`, so every OTHER existing caller -- the full post-action
// reposition at fraction 1, chief among them -- is entirely unaffected)
// lets a caller give defenders a distinctly larger share of their own
// already-capped advance per interleaved reaction than attackers get,
// without changing attacking off-ball movement's own pacing at all.
function reactOffBall(
  defendingGroups,
  ballPoint,
  trace,
  {
    fraction = 1,
    defensiveFraction = fraction,
    duration,
    motionContext = null,
    excludedIds = [],
    overlapStartOffsetMs = 0,
  } = {},
) {
  // Motion v1: every tactical target is calculated against ONE immutable
  // world snapshot. Attackers no longer mutate first and hand defenders a
  // partially-updated reality; all roles decide, then all destinations are
  // applied atomically after their trace events have been authored.
  const snapshotEntry = (entry) =>
    entry ? { ...entry, player: entry.player } : null;
  const snapshots = {
    owner: snapshotEntry(defendingGroups.owner),
    teammates: defendingGroups.teammates.map(snapshotEntry),
    opponents: defendingGroups.opponents.map(snapshotEntry),
    ownKeepers: (defendingGroups.ownKeepers || []).map(snapshotEntry),
    opposingKeepers: (
      defendingGroups.opposingKeepers ||
      (defendingGroups.keeper ? [defendingGroups.keeper] : [])
    ).map(snapshotEntry),
  };
  snapshots.keeper = snapshots.opposingKeepers[0] ?? null;
  const originals = new Map(
    [
      defendingGroups.owner,
      ...defendingGroups.teammates,
      ...defendingGroups.opponents,
      ...(defendingGroups.ownKeepers || []),
      ...(defendingGroups.opposingKeepers ||
        (defendingGroups.keeper ? [defendingGroups.keeper] : [])),
    ]
      .filter(Boolean)
      .map((entry) => [entry.id, entry]),
  );
  const proposals = [];
  const heldAttackerJobs = [];
  const attackDirection = state.attackingDirection[snapshots.owner.team];
  // Role stickiness (2026-08-19) -- see planAttackerRepositioning()'s own
  // comment on previousSupportId/previousDropId for the full bug this
  // fixes (two teammates visibly swapping places every reaction). Read
  // straight out of motionContext's own carried-forward state -- the SAME
  // per-player "what were they just doing" record resolveMotionBatch()
  // already keeps for its own target-smoothing, not a new piece of state.
  const previousActionHolderId = (action) => {
    for (const teammate of snapshots.teammates) {
      if (
        motionContext?.state?.players?.[teammate.id]?.intention?.action ===
        action
      )
        return teammate.id;
    }
    return null;
  };

  if (snapshots.teammates.length) {
    const attackerPlan = planAttackerRepositioning(
      snapshots.teammates,
      snapshots.opponents,
      attackDirection,
      {
        ballPoint: { ...ballPoint },
        keeper: snapshots.keeper,
        previousSupportId: previousActionHolderId("support-short"),
        previousDropId: previousActionHolderId("drop-deep"),
      },
    );
    for (const step of attackerPlan) {
      const attacker = snapshots.teammates.find(
        (entry) => entry.id === step.id,
      );
      if (!attacker) continue;
      const blended = partialPoint(attacker, step.target, fraction);
      if (
        Math.abs(attacker.x - blended.x) <= 0.5 &&
        Math.abs(attacker.y - blended.y) <= 0.5
      ) {
        if (step.held)
          heldAttackerJobs.push({
            player: originals.get(attacker.id),
            action: step.action,
          });
        continue;
      }
      proposals.push({
        id: attacker.id,
        from: pointOf(attacker),
        target: {
          x: blended.x,
          y: blended.y,
          zone: zoneFromPercent(blended.x, blended.y),
        },
        intentionTarget: {
          x: step.intentionTarget.x,
          y: step.intentionTarget.y,
          zone: zoneFromPercent(step.intentionTarget.x, step.intentionTarget.y),
        },
        action: step.action,
        role: "attacker",
        attackingDirection: attackDirection,
        player: attacker.player,
      });
    }
  }

  for (const keeper of [
    ...snapshots.ownKeepers,
    ...snapshots.opposingKeepers,
  ]) {
    const ideal = keeperPositioningPoint(
      ballPoint,
      state.attackingDirection[keeper.team],
    );
    const blended = partialPoint(keeper, ideal, fraction);
    if (
      Math.abs(keeper.x - blended.x) > 0.5 ||
      Math.abs(keeper.y - blended.y) > 0.5
    ) {
      proposals.push({
        id: keeper.id,
        from: pointOf(keeper),
        target: {
          x: blended.x,
          y: blended.y,
          zone: zoneFromPercent(blended.x, blended.y),
        },
        intentionTarget: {
          x: ideal.x,
          y: ideal.y,
          zone: zoneFromPercent(ideal.x, ideal.y),
        },
        action: "set-position",
        role: "keeper",
        player: keeper.player,
      });
    }
  }

  if (snapshots.opponents.length) {
    const defendingDirection =
      state.attackingDirection[snapshots.opponents[0].team];
    const defenderPlan = planDefensiveRepositioning(
      ballPoint,
      snapshots.teammates,
      snapshots.opponents,
      defendingDirection,
    );
    for (const step of defenderPlan) {
      const defender = snapshots.opponents.find(
        (entry) => entry.id === step.id,
      );
      if (!defender) continue;
      const blended = partialPoint(defender, step.target, defensiveFraction);
      if (
        Math.abs(defender.x - blended.x) <= 0.5 &&
        Math.abs(defender.y - blended.y) <= 0.5
      )
        continue;
      proposals.push({
        id: defender.id,
        from: pointOf(defender),
        target: {
          x: blended.x,
          y: blended.y,
          zone: zoneFromPercent(blended.x, blended.y),
        },
        intentionTarget: {
          x: step.intentionTarget.x,
          y: step.intentionTarget.y,
          zone: zoneFromPercent(step.intentionTarget.x, step.intentionTarget.y),
        },
        action: step.action,
        role: "defender",
        player: defender.player,
      });
    }
  }

  const excluded = new Set(excludedIds.map(String));
  const eligibleProposals = proposals.filter(
    (proposal) => !excluded.has(String(proposal.id)),
  );
  const separatedProposals = applyOffBallSeparation(eligibleProposals, [
    ...originals.values(),
  ]);
  const previousMotionState = motionContext?.state || createMotionState();
  const batch = resolveMotionBatch(separatedProposals, previousMotionState, {
    durationMs: duration ?? MOVEMENT_DURATIONS.reposition,
  });
  if (motionContext) motionContext.state = batch.state;
  const byRole = (role) =>
    batch.moves
      .filter((move) => move.role === role)
      .map((move) => ({
        player: originals.get(move.id),
        from: move.from,
        to: move.to,
        action: move.action,
        role: move.role,
        trajectory: move.trajectory,
        intention: move.intention,
      }))
      .filter(
        (move) =>
          move.player &&
          (Math.abs(move.from.x - move.to.x) > 0.5 ||
            Math.abs(move.from.y - move.to.y) > 0.5),
      );
  const attackerMoves = byRole("attacker");
  const keeperMoves = byRole("keeper");
  const defenderMoves = byRole("defender");

  if (attackerMoves.length || heldAttackerJobs.length) {
    const allAttackerAssignments = [...attackerMoves, ...heldAttackerJobs];
    trace.push(
      traceEvent(
        "ATT.ADJUST",
        offBallAssignmentsLabel(allAttackerAssignments, "attacker"),
        attackerMoves.length
          ? {
              movement: "reposition",
              outcome: "neutral",
              playerMoves: attackerMoves,
              duration,
              overlapWithPrevious: true,
              overlapStartOffsetMs,
            }
          : { outcome: "neutral" },
      ),
    );
  }
  if (keeperMoves.length) {
    trace.push(
      traceEvent("GK.ADJUST", offBallAssignmentsLabel(keeperMoves, "keeper"), {
        actor: keeperMoves[0].player,
        movement: "reposition",
        outcome: "neutral",
        playerMoves: keeperMoves,
        duration,
        overlapWithPrevious: true,
        overlapStartOffsetMs,
      }),
    );
  }
  if (defenderMoves.length) {
    trace.push(
      traceEvent(
        "DEF.ADJUST",
        offBallAssignmentsLabel(defenderMoves, "defender"),
        {
          movement: "reposition",
          outcome: "neutral",
          playerMoves: defenderMoves,
          duration,
          overlapWithPrevious: true,
          overlapStartOffsetMs,
        },
      ),
    );
  }

  // Atomic commit: no planner above can observe any of these writes.
  for (const move of [...attackerMoves, ...keeperMoves, ...defenderMoves]) {
    Object.assign(move.player, move.to);
  }
}

// Continuous World Motion During Ball Flight v1 (2026-08-20) -- see
// MATCH_LAB_PLAN.md for the full architectural background. Directly
// requested after two rounds of duration/overlap patches on the OLD
// discrete-beat reactOffBall() still left everyone visibly stopping and
// restarting during a pass: "the previous fixes addressed individual
// symptoms while preserving the underlying stop-start movement model."
//
// This is reactOffBall()'s replacement for two call sites: off-ball
// movement during a PASS's own flight, AND the unconditional post-action
// convergence that runs once any live action concludes (runConstructedPossession's
// own `continuesLive` branch) -- reactOffBall(fraction:1) forced that
// second one through the SAME hermite full-snap beat, which is what made
// "reception -> sudden burst" visible even after the flight itself got
// fixed: a fixed-duration 0%->100% traverse of whatever distance the
// freshly-recomputed post-reception tactical shape happened to need,
// however far that was. reactOffBall() itself is still correct and
// untouched for every OTHER resolver's own interleaved reactions (cross,
// dribble, carry, through-ball -- none of those were reported broken).
// Every tactical target is computed ONCE, exactly as reactOffBall()
// already does (same planAttackerRepositioning()/
// planDefensiveRepositioning()/keeperPositioningPoint() calls, same
// role-stickiness read from motionContext, same off-ball separation on
// the final destinations) -- what's DIFFERENT is what happens between
// "here" and "there": instead of resolveMotionBatch()'s hermite curve
// (which explicitly zeroes velocity at both ends of every short beat,
// see matchMotion.js's own comment on why), each player gets ONE
// continuous, physically-limited trajectory (sampleContinuousTrajectory(),
// matchMovementTiming.js) spanning the WHOLE flight -- monotonic ground
// covered, a real reaction delay, never exceeding their own topSpeed(),
// no artificial deceleration at an arbitrary beat boundary because there
// ARE no more beat boundaries mid-flight.
//
// Mid-flight tactical retargeting is deliberately NOT built here (a
// player's own ideal spot is fixed for the whole flight, same as the ball
// itself never changing its own path) -- see this file's own header
// comment in matchMovementTiming.js on why that's a real v1 boundary, not
// an oversight.
function reactOffBallContinuous(
  defendingGroups,
  ballFrom,
  ballTo,
  totalMs,
  trace,
  {
    motionContext = null,
    excludedIds = [],
    // A pass-flight reaction genuinely shares the producer's clock window.
    // A tactical reshaping requested AFTER an action must instead occupy its
    // own interval; otherwise its endpoint overwrites the preceding contact
    // keyframe at the same timestamp and the actor appears away from the ball.
    overlapWithPrevious = true,
  } = {},
) {
  const snapshotEntry = (entry) =>
    entry ? { ...entry, player: entry.player } : null;
  const snapshots = {
    owner: snapshotEntry(defendingGroups.owner),
    teammates: defendingGroups.teammates.map(snapshotEntry),
    opponents: defendingGroups.opponents.map(snapshotEntry),
    ownKeepers: (defendingGroups.ownKeepers || []).map(snapshotEntry),
    opposingKeepers: (
      defendingGroups.opposingKeepers ||
      (defendingGroups.keeper ? [defendingGroups.keeper] : [])
    ).map(snapshotEntry),
  };
  snapshots.keeper = snapshots.opposingKeepers[0] ?? null;
  const originals = new Map(
    [
      defendingGroups.owner,
      ...defendingGroups.teammates,
      ...defendingGroups.opponents,
      ...(defendingGroups.ownKeepers || []),
      ...(defendingGroups.opposingKeepers ||
        (defendingGroups.keeper ? [defendingGroups.keeper] : [])),
    ]
      .filter(Boolean)
      .map((entry) => [entry.id, entry]),
  );
  const attackDirection = state.attackingDirection[snapshots.owner.team];
  const previousActionHolderId = (action) => {
    for (const teammate of snapshots.teammates) {
      if (
        motionContext?.state?.players?.[teammate.id]?.intention?.action ===
        action
      )
        return teammate.id;
    }
    return null;
  };

  const targets = [];
  const heldAttackerJobs = [];
  if (snapshots.teammates.length) {
    const attackerPlan = planAttackerRepositioning(
      snapshots.teammates,
      snapshots.opponents,
      attackDirection,
      {
        ballPoint: { ...ballTo },
        keeper: snapshots.keeper,
        previousSupportId: previousActionHolderId("support-short"),
        previousDropId: previousActionHolderId("drop-deep"),
      },
    );
    for (const step of attackerPlan) {
      const attacker = snapshots.teammates.find(
        (entry) => entry.id === step.id,
      );
      if (!attacker) continue;
      if (step.held) {
        heldAttackerJobs.push({
          player: originals.get(attacker.id),
          action: step.action,
        });
        continue;
      }
      targets.push({
        id: attacker.id,
        role: "attacker",
        action: step.action,
        from: pointOf(attacker),
        target: step.target,
        player: attacker.player,
      });
    }
  }
  for (const keeper of [
    ...snapshots.ownKeepers,
    ...snapshots.opposingKeepers,
  ]) {
    const ideal = keeperPositioningPoint(
      ballTo,
      state.attackingDirection[keeper.team],
    );
    targets.push({
      id: keeper.id,
      role: "keeper",
      action: "set-position",
      from: pointOf(keeper),
      target: ideal,
      player: keeper.player,
    });
  }
  if (snapshots.opponents.length) {
    const defendingDirection =
      state.attackingDirection[snapshots.opponents[0].team];
    const defenderPlan = planDefensiveRepositioning(
      ballTo,
      snapshots.teammates,
      snapshots.opponents,
      defendingDirection,
    );
    for (const step of defenderPlan) {
      const defender = snapshots.opponents.find(
        (entry) => entry.id === step.id,
      );
      if (!defender) continue;
      targets.push({
        id: defender.id,
        role: "defender",
        action: step.action,
        from: pointOf(defender),
        target: step.target,
        player: defender.player,
      });
    }
  }

  const excluded = new Set(excludedIds.map(String));
  const eligible = targets.filter((entry) => !excluded.has(String(entry.id)));
  const separated = applyOffBallSeparation(eligible, [...originals.values()]);
  const movingEntries = separated.filter((entry) => yardDistance(entry.from, entry.target) > 0.5);

  // Post-action convergence (overlapWithPrevious:false -- "occupy its own
  // interval" per this function's own params comment) used to always run
  // the caller's flat totalMs (MOVEMENT_DURATIONS.reposition, 450ms) no
  // matter how far anyone actually had to go. Measured directly against
  // real Free Play traces (2026-08-21): typical post-carry keeper/defender
  // moves cover under half a yard of REAL ground in that window -- not
  // because the target was close (movingEntries' own >0.5yd filter already
  // guarantees it wasn't), but because reachIn()'s realistic acceleration
  // curve means a player barely gets going in the first ~300ms after
  // CONTACT_REACTION_DELAY_MS. The ball carrier -- the actual visual focus
  // -- has NO movement of their own scheduled anywhere in this window
  // regardless (this call only ever moves attacker/keeper/defender
  // reactions, never the carrier), so the full 450ms reads as dead time
  // even though the physics inside it are individually correct. Pass-
  // flight calls (overlapWithPrevious:true, the default) are UNCHANGED --
  // there totalMs is the ball's own real flight duration, not a flat
  // "reposition" constant, and that case was never reported broken.
  // Scoped fix: cap the window at how long the SLOWEST real mover
  // genuinely needs (timeToReach(), the same acceleration-aware physics
  // reachIn() itself already uses, just inverted -- distance to time
  // instead of time to distance), never the caller's flat totalMs when
  // everyone would naturally arrive sooner. Only ever SHRINKS the window
  // (Math.min against the original totalMs), never lengthens it, and only
  // applies to the "own interval" case -- zero behavior change for the
  // case that already works.
  let effectiveTotalMs = totalMs;
  if (!overlapWithPrevious && movingEntries.length) {
    const slowestNaturalMs = Math.max(
      ...movingEntries.map(
        (entry) => CONTACT_REACTION_DELAY_MS + timeToReach(entry.player, yardDistance(entry.from, entry.target)) * 1000,
      ),
    );
    effectiveTotalMs = Math.min(totalMs, Math.max(150, slowestNaturalMs));
  }

  const moves = movingEntries
    .map((entry) => {
      // entry.player is the physics-facing player-attributes object
      // (sampleContinuousTrajectory() reads Pace/Acceleration off it) --
      // NOT the roster entry traceEvent() and the commit loop below both
      // need (playerId derivation, Object.assign(move.player, move.to)).
      // originals.get(entry.id) resolves the real roster entry, same
      // lookup reactOffBall()'s own byRole() helper already does.
      const trajectory = sampleContinuousTrajectory({
        from: entry.from,
        to: entry.target,
        player: entry.player,
        totalMs: effectiveTotalMs,
        reactionDelayMs: CONTACT_REACTION_DELAY_MS,
        sampleCount: 10,
      });
      const finalPosition = trajectory[trajectory.length - 1].position;
      return {
        id: entry.id,
        player: originals.get(entry.id),
        from: entry.from,
        to: finalPosition,
        action: entry.action,
        role: entry.role,
        intentionTarget: entry.target,
        trajectory,
      };
    });
  const attackerMoves = moves.filter((move) => move.role === "attacker");
  const keeperMoves = moves.filter((move) => move.role === "keeper");
  const defenderMoves = moves.filter((move) => move.role === "defender");

  // A single call here can push up to three real (non-cueOnly) events --
  // ATT/GK/DEF.ADJUST -- one per role that actually has a move. All three
  // are the SAME reaction to the SAME just-concluded action; they belong
  // in ONE shared window, not one after another. But `overlapWithPrevious`
  // was being passed through unchanged to EVERY push -- harmless when it's
  // already `true` (the pass-flight case, where all three correctly share
  // the PRODUCER's window either way), but a real bug when it's `false`
  // (the post-action "own interval" case, see this function's own params
  // comment): buildMatchLabPlaybackPlan() gives an `overlapWithPrevious:
  // false` event its own PRIMARY, SEQUENTIAL interval -- so three such
  // pushes from one call became three separate back-to-back intervals
  // (keeper adjusts, THEN defender adjusts, THEN...) instead of one
  // shared one, multiplying a single `totalMs` reaction into up to
  // 3x`totalMs` of real time where the ball carrier -- the actual visual
  // focus -- has nothing scheduled and simply doesn't move. Found
  // 2026-08-21: a THIRD "the game freezes" report, precisely reproduced
  // (RAF/longtask tracing showed zero real stalls; the gap was genuine
  // dead time in the timeline itself, not a rendering problem) traced
  // this to the post-action convergence call specifically (2 roles ->
  // 900ms of carrier-does-nothing after every single carry action).
  // Fix: only the FIRST real push of this call establishes a new
  // interval (honoring the caller's own `overlapWithPrevious`); every
  // push after that joins it (`true`), regardless of what the caller
  // originally asked for -- correct either way, since a `true` caller
  // already wanted every push concurrent with the SAME producer window.
  let sharedIntervalEstablished = false;
  const overlapForThisPush = () => {
    const value = sharedIntervalEstablished ? true : overlapWithPrevious;
    sharedIntervalEstablished = true;
    return value;
  };

  if (attackerMoves.length || heldAttackerJobs.length) {
    trace.push(
      traceEvent(
        "ATT.ADJUST",
        offBallAssignmentsLabel(
          [...attackerMoves, ...heldAttackerJobs],
          "attacker",
        ),
        attackerMoves.length
          ? {
              movement: "reposition",
              outcome: "neutral",
              playerMoves: attackerMoves,
              duration: effectiveTotalMs,
              overlapWithPrevious: overlapForThisPush(),
            }
          : { outcome: "neutral" },
      ),
    );
  }
  if (keeperMoves.length) {
    trace.push(
      traceEvent("GK.ADJUST", offBallAssignmentsLabel(keeperMoves, "keeper"), {
        actor: keeperMoves[0].player,
        movement: "reposition",
        outcome: "neutral",
        playerMoves: keeperMoves,
        duration: effectiveTotalMs,
        overlapWithPrevious: overlapForThisPush(),
      }),
    );
  }
  if (defenderMoves.length) {
    trace.push(
      traceEvent(
        "DEF.ADJUST",
        offBallAssignmentsLabel(defenderMoves, "defender"),
        {
          movement: "reposition",
          outcome: "neutral",
          playerMoves: defenderMoves,
          duration: effectiveTotalMs,
          overlapWithPrevious: overlapForThisPush(),
        },
      ),
    );
  }

  // Atomic commit, same rule as reactOffBall(): no planner above observed
  // these writes while deciding. Also refreshes motionContext's own
  // per-player intention record (role stickiness, read by
  // previousActionHolderId above) in the SAME shape resolveMotionBatch()
  // already produces, so a LATER action's own reactOffBall() call (a
  // different resolver, or this pass's own full post-action reposition)
  // reads consistent state regardless of which of the two movement
  // models actually produced it.
  if (motionContext) {
    const tick = (motionContext.state?.tick || 0) + 1;
    const nextPlayers = { ...(motionContext.state?.players || {}) };
    for (const move of moves) {
      // A continuous run naturally arrives at (or near) rest relative to
      // its own destination -- zero end velocity is the honest state to
      // hand off to whatever movement model reacts next (this pass's own
      // full post-action reposition, or a later action's reactOffBall()),
      // same convention resolveMotionBatch() already uses for a completed
      // tactical move.
      nextPlayers[move.id] = {
        velocity: { x: 0, y: 0 },
        intention: {
          action: move.action,
          role: move.role,
          target: move.intentionTarget,
          startedTick: tick,
          age: 0,
          retained: false,
        },
        lastPosition: { ...move.to },
      };
    }
    motionContext.state = { tick, players: nextPlayers };
  }
  for (const move of moves) {
    Object.assign(move.player, move.to);
  }
}

// How far each per-touch off-ball update pulls toward its full ideal spot
// (vs. 1/fraction=1 for the full post-action reposition), and how fast
// those interleaved nudges animate -- short, matching a single touch's
// own pace (see MOVEMENT_DURATIONS.touch), not the slower full-reposition
// default.
const INTERLEAVED_REACTION_FRACTION = 0.22;
const INTERLEAVED_REACTION_DURATION = MOVEMENT_DURATIONS.touch;
// Post-action convergence's OWN budget (runConstructedPossession's
// continuesLive branch, below) -- deliberately NOT MOVEMENT_DURATIONS.
// reposition (450ms). Measured directly against real Free Play traces
// (2026-08-21, see MATCH_LAB_PLAN.md): even the full 450ms was only ever
// buying ~0.3 real yards of progress for a keeper/defender reacting from
// a standing start -- CONTACT_REACTION_DELAY_MS (120ms) plus reachIn()'s
// realistic acceleration ramp already consumes nearly the whole budget
// regardless of how far the real target is, so "give it more time" (or
// even a target-distance-aware cap -- tried first, made no measurable
// difference for exactly this reason) doesn't buy any real convergence
// accuracy that was actually being achieved before. Meanwhile the ball
// carrier -- the entire visual focus -- has zero movement of their own
// scheduled anywhere in this window (this call only ever moves attacker/
// keeper/defender reactions, never the carrier), so every one of those
// 450ms reads as dead time to a viewer regardless of the real physics
// happening underneath. Shortened outright: costs no REAL convergence
// this step wasn't already failing to deliver, cuts the visible pause.
const POST_ACTION_CONVERGENCE_MS = 200;
// See reactOffBall()'s own comment on defensiveFraction -- a defender
// scrambling to recover during a live, moving passage of play closes
// ground with real urgency, not at the same measured pace as an
// attacker's own tactical off-ball positioning.
const INTERLEAVED_DEFENSIVE_REACTION_FRACTION = 0.5;

// interleaveOffBall (default false): OFF by default because
// reactOffBall() mutates whatever roster entries groups.teammates/
// .opponents/.keeper actually point to -- correct and intended for
// runConstructedPossession()'s own simulatedRoster clone (a disposable,
// per-possession copy meant to be progressively mutated), but WRONG for
// any other caller, including every test in this project that calls
// resolveDribble()/resolveCarry() directly against a hand-built, REUSED
// fixture (many search loops call these hundreds of times against the
// SAME owner/defender objects) -- a real bug caught building this: those
// shared fixtures were silently drifting position between trials.
// runConstructedPossession() is the ONE caller that opts in.
function resolveDribble(
  groups,
  availability,
  random,
  trace,
  interleaveOffBall = false,
  motionContext = null,
) {
  const owner = groups.owner;
  const defender = engagingOpponent(owner, groups.opponents);
  const progressionDuel = localizedDuel(
    owner.player,
    defender.player,
    ["Passing", "Technique", "Decisions", "Teamwork", "Agility", "Dribbling"],
    ["Positioning", "Anticipation", "Tackling", "Decisions", "Strength"],
    FIXED_MINUTE,
    random,
    owner.zone,
  );
  trace.push(
    traceEvent(
      "P.PROGRESS",
      `${playerName(owner.player)} looks to get past ${playerName(defender.player)} (${Math.round(progressionDuel.probability * 100)}%)`,
      {
        actor: owner,
        defender,
        movement: "dribble",
        outcome: "neutral",
        ballFrom: pointOf(owner),
        ballTo: pointOf(owner),
      },
    ),
  );
  if (progressionDuel.won) {
    // Genuine progression, not the same point twice -- a fixed-distance
    // advance (DRIBBLE_PROGRESS_YARDS, not a probability) toward whichever
    // goal state.attackingDirection says this player's team is attacking.
    // This is what a successful dribble was missing entirely before: the
    // trace showed a "win" with no actual movement for the animation to
    // consume, only the cosmetic nudge applied to every dribble/tackle
    // event regardless of outcome.
    //
    // Touches Per Carry (2026-08-18) -- same treatment as resolveCarry():
    // the run to `advanced` is broken into real intermediate touches
    // (spatialDecision.js's determineCarryGait()/planCarryTouches()), not
    // covered in one big touch. Beating a defender this close (they're
    // within DUEL_RANGE_YARDS by construction -- see engagingOpponent())
    // almost always reads as real pressure, so gait comes out "nimble"
    // here far more often than not -- several small, close touches to
    // actually get past someone, not one long stride, which is exactly
    // the real-football shape this was missing.
    const origin = pointOf(owner);
    // Beating a defender creates an escape lane, not a compulsory vertical
    // rail. Reuse the same concrete destination planner as an open carry,
    // then cap this duel's exit to its shorter eight-yard advance. This keeps
    // one source of directional geometry while preserving dribble's own
    // distance contract.
    const escapePlan = planCarryDestination(
      owner,
      groups.opponents,
      state.attackingDirection[owner.team],
    );
    const escapePoint = approachPoint(
      origin,
      escapePlan.point,
      DRIBBLE_PROGRESS_YARDS,
    );
    const advanced = {
      ...escapePoint,
      zone: zoneFromPercent(escapePoint.x, escapePoint.y),
    };
    // Directional continuity -- see resolveCarry()'s own recordCarryDirection()
    // comment.
    if (interleaveOffBall) recordCarryDirection(owner, origin, advanced);
    const carryPressure = pressureAt(origin, groups.opponents);
    const gait = determineCarryGait(origin, groups.opponents);
    const touches = planCarryTouches(origin, advanced, gait, {
      player: owner.player,
      pressure: carryPressure,
      seed: `${owner.id}:dribble:${origin.x}:${origin.y}:${advanced.x}:${advanced.y}`,
    });
    let cursor = origin;
    touches.forEach((waypoint, index) => {
      const to = {
        x: waypoint.x,
        y: waypoint.y,
        zone: zoneFromPercent(waypoint.x, waypoint.y),
      };
      trace.push(
        traceEvent(
          "P.PROGRESS.TOUCH",
          `${playerName(owner.player)} touches it past ${playerName(defender.player)}`,
          {
            actor: owner,
            defender,
            mover: owner,
            moveFrom: cursor,
            moveTo: to,
            movement: "touch",
            outcome: "success",
            ballFrom: cursor,
            ballTo: to,
            contact: {
              point: cursor,
              actor: owner,
              type: "touch",
              phase: "start",
            },
            ownerBefore: owner,
            ownerAfter: owner,
            attribution: waypoint.kinetics?.attribution,
          },
        ),
      );
      cursor = to;
      // Every physical touch interval gets a concurrent off-ball update.
      // These overlap the touch, so coverage improves without adding time
      // or asking playback to extrapolate beyond an authored endpoint.
      if (interleaveOffBall) {
        reactOffBall(groups, cursor, trace, {
          fraction: INTERLEAVED_REACTION_FRACTION,
          defensiveFraction: INTERLEAVED_DEFENSIVE_REACTION_FRACTION,
          duration: INTERLEAVED_REACTION_DURATION,
          motionContext,
        });
      }
    });
    trace.push(
      traceEvent(
        "P.PROGRESS.WON",
        `${playerName(owner.player)} beats ${playerName(defender.player)} and advances cleanly`,
        // mover: owner -- the carrier moves WITH the ball to its real
        // endpoint (explicit, not inferred from ballFrom/ballTo -- see
        // traceEvent()'s own comment on why shots/passes must never be
        // read this way).
        {
          actor: owner,
          defender,
          mover: owner,
          moveFrom: cursor,
          moveTo: advanced,
          movement: "dribble",
          outcome: "success",
          ballFrom: cursor,
          ballTo: advanced,
          contact: {
            point: cursor,
            actor: owner,
            type: "touch",
            phase: "start",
          },
          ownerBefore: owner,
          ownerAfter: owner,
        },
      ),
    );
    return {
      outcome: "ADVANCE",
      code: "P.PROGRESS.WON",
      resolved: true,
      terminal: false,
      possession: "retained",
      nextOwnerId: owner.id,
      ballEnd: advanced,
      restart: null,
      reason: "dribble-advance",
    };
  }
  const raceWasClose = progressionDuel.probability > 0.4;
  // selectEngagement() (matchEngineCore.js -- the real, shared engine
  // function, also used by the live match tick loop) picks purely off
  // attributes; it has no distance concept at all, so left alone it can
  // return D.SLIDE/D.STAND for a defender who's within DUEL_RANGE_YARDS
  // (close enough to contest SOMETHING) but still physically too far for
  // that SPECIFIC tackle type -- a real gap a spatial-radii audit caught:
  // the six radii spatialDecision.js exports were being unit-tested but
  // never actually consulted by any resolver. Fixed here, Match-Lab-side
  // ONLY (never touching the shared production engine function itself,
  // which draft-run.js's real matches also call) -- a real distance
  // check downgrades the engine's own attribute-driven preference to
  // whatever's actually plausible from here, never invents a MORE
  // aggressive tackle than the engine chose, only ever a more honest one.
  // D.DUEL is always plausible whenever this function runs at all, since
  // engagingOpponent() already guarantees the defender is within
  // DUEL_RANGE_YARDS -- the largest of the three -- so there's always a
  // safe fallback.
  const rawEngagementType = selectEngagement(
    defender.player,
    raceWasClose,
    random,
  );
  const engagementType =
    rawEngagementType === "D.STAND" && !canStandingTackle(owner, defender)
      ? canSlidingTackle(owner, defender)
        ? "D.SLIDE"
        : "D.DUEL"
      : rawEngagementType === "D.SLIDE" && !canSlidingTackle(owner, defender)
        ? "D.DUEL"
        : rawEngagementType;
  trace.push(
    traceEvent(
      engagementType,
      `${playerName(defender.player)} chooses ${engagementType}`,
      {
        actor: owner,
        defender,
        movement: "tackle",
        outcome: "neutral",
        ballFrom: pointOf(owner),
        ballTo: pointOf(owner),
      },
    ),
  );
  const engagement = resolveEngagement(
    engagementType,
    defender.player,
    random,
    Math.floor(owner.zone / 3),
  );
  const reaction = duelReaction(owner, defender, engagement.outcome);
  trace.push(
    traceEvent(engagement.code, `Outcome: ${engagement.outcome}`, {
      actor: owner,
      defender,
      movement: "tackle",
      outcome: engagementOutcomeLabel(engagement.outcome),
      ballFrom: reaction.contactPoint,
      ballTo: reaction.contactPoint,
      playerMoves: [
        {
          player: defender,
          from: pointOf(defender),
          to: reaction.contactPoint,
          action: "challenge",
        },
      ],
      // The duel result is revealed at the END of its physical interval.
      // On a won tackle the defender makes the decisive contact; otherwise
      // the carrier remains the last verified player at this ball point.
      contact: {
        point: reaction.contactPoint,
        actor: engagement.outcome === "won" ? defender : owner,
        type: "tackle",
        phase: "end",
      },
      ownerBefore: owner,
      ownerAfter:
        engagement.outcome === "won"
          ? defender
          : engagement.outcome === "loose"
            ? null
            : owner,
      ownerAfterAt: "end",
    }),
  );
  if (reaction.code) {
    const touchActor = engagement.outcome === "beaten" ? owner : defender;
    trace.push(
      traceEvent(reaction.code, reaction.label, {
        actor: touchActor,
        mover: reaction.mover,
        moveFrom: reaction.mover ? reaction.contactPoint : null,
        moveTo: reaction.mover ? reaction.ballEnd : null,
        movement: "deflection",
        outcome:
          engagement.outcome === "won"
            ? "turnover"
            : engagement.outcome === "beaten"
              ? "success"
              : "neutral",
        ballFrom: reaction.contactPoint,
        ballTo: reaction.ballEnd,
        contact: {
          point: reaction.contactPoint,
          actor: touchActor,
          type: "tackle",
          phase: "start",
        },
        ownerBefore: reaction.possession,
        ownerAfter: reaction.possession,
      }),
    );
  }
  if (engagement.outcome === "foul") {
    const foul = resolveFoul(
      defender.player,
      engagementType,
      owner.zone,
      false,
      FIXED_MINUTE,
      random,
    );
    trace.push(
      traceEvent(
        `CARD.${foul.card.toUpperCase()}`,
        `Restart: ${foul.restart}, card: ${foul.card}`,
        {
          actor: owner,
          defender,
          movement: "foul",
          outcome: "neutral",
          ballFrom: reaction.ballEnd,
          ballTo: reaction.contactPoint,
          ownerBefore: owner,
          ownerAfter: foul.restart === "none" ? owner : null,
          ownerAfterAt: "end",
          restart: foul.restart === "none" ? null : foul.restart,
        },
      ),
    );
    // Advantage played (foul.restart === "none") means the ref waved play
    // on -- the fouled side genuinely keeps the ball, this is a
    // CONTINUATION, not a stoppage. Only a real restart (penalty/
    // free-kick) is terminal/dead.
    const advantagePlayed = foul.restart === "none";
    return {
      outcome: `FOUL/${foul.card.toUpperCase()}`,
      code: `CARD.${foul.card.toUpperCase()}`,
      resolved: true,
      terminal: !advantagePlayed,
      possession: advantagePlayed ? "retained" : "dead",
      nextOwnerId: advantagePlayed ? owner.id : null,
      ballEnd: advantagePlayed ? reaction.ballEnd : reaction.contactPoint,
      restart: advantagePlayed ? null : foul.restart,
      reason: advantagePlayed ? "foul-advantage-played" : "foul",
    };
  }
  // "beaten" (attacker escapes the challenge despite losing the earlier
  // progression duel) keeps the ball and continues; "won" (defender wins
  // the tackle) is a turnover; "loose" is a genuinely contestable ball
  // this pass doesn't model a re-contest for (see MATCH_LAB_PLAN.md) --
  // reported as terminal/loose rather than guessing who ends up with it.
  const terminal = engagement.outcome !== "beaten";
  return {
    outcome: engagement.outcome.toUpperCase(),
    code: engagement.code,
    resolved: true,
    terminal,
    possession:
      engagement.outcome === "won"
        ? "turnover"
        : engagement.outcome === "loose"
          ? "loose"
          : "retained",
    nextOwnerId:
      engagement.outcome === "won"
        ? defender.id
        : engagement.outcome === "loose"
          ? null
          : owner.id,
    ballEnd: reaction.ballEnd,
    restart: null,
    reason: `tackle-${engagement.outcome}`,
  };
}

function oneOnOneTargetPoint(shooter, execution) {
  const target = execution?.shot?.actualTarget;
  const goalY = goalLineY(shooter);
  if (target === "left") {
    return { x: GOAL_LEFT_POST_X + 0.8, y: goalY, zone: shooter.zone };
  }
  if (target === "right") {
    return { x: GOAL_RIGHT_POST_X - 0.8, y: goalY, zone: shooter.zone };
  }
  return { x: 50, y: goalY, zone: shooter.zone };
}

function resolveFreePlayOneOnOne(
  groups,
  context,
  {
    decisionRandom,
    executionRandom,
    keeperResponseRandom,
  },
  trace,
) {
  const shooter = groups.owner;
  const keeper = groups.keeper;
  const perceivedKeeperState = perceiveKeeperState(
    context.actualKeeperState,
    shooter.player,
    decisionRandom,
  );
  const decision = chooseOneOnOneAction({
    shooter: shooter.player,
    perceivedKeeperState,
    defenderPressure: context.defenderPressure,
    shotAngle: context.shotAngleDegrees,
    distance: context.distanceYards,
    availableTeammates: groups.teammates,
    decisionRandom,
  });
  const execution = executeOneOnOneAction(decision.selectedAction, {
    shooter,
    keeper,
    defender: null,
    teammates: groups.teammates,
    actualKeeperState: context.actualKeeperState,
    perceivedKeeperState,
    defenderPressure: context.defenderPressure,
    chanceContext: context,
    executionRandom,
    keeperResponseRandom,
  });
  const actionLabel = {
    "place-left": "places it to the left",
    "place-right": "places it to the right",
    blast: "drives it with power",
    chip: "tries to lift it over the goalkeeper",
    "round-keeper": "tries to round the goalkeeper",
    "square-pass": "squares it to a teammate",
  }[decision.selectedAction] || decision.selectedAction;
  trace.push(traceEvent(
    "ONE_V_ONE.CHOICE",
    `${playerName(shooter.player)} is clean through and ${actionLabel}`,
    {
      actor: shooter,
      keeper,
      outcome: "neutral",
      metrics: {
        oneOnOne: true,
        selectedAction: decision.selectedAction,
        distanceToGoalYards: context.distanceYards,
        shotAngleDegrees: context.shotAngleDegrees,
        defenderPressure: context.defenderPressure,
      },
    },
  ));

  const ballResult = execution.ballResult;
  const offTarget = ballResult === "wide" || ballResult === "over";
  const aimPoint = offTarget
    ? missPointFor(
        shooter,
        keeper,
        null,
        ballResult === "over" ? "F.BLAST.OVER" : "F.FINESSE.WIDE",
      ).point
    : oneOnOneTargetPoint(shooter, execution);
  const contactType = decision.selectedAction === "blast" ? "laces" : "inside";
  trace.push(traceEvent(
    offTarget ? execution.code : "ONE_V_ONE.ATTEMPT",
    offTarget
      ? `${playerName(shooter.player)} sends the one-on-one ${ballResult}`
      : `${playerName(shooter.player)} gets the attempt away`,
    {
      actor: shooter,
      keeper,
      movement: "shot",
      outcome: offTarget ? "fail" : "success",
      ballFrom: pointOf(shooter),
      ballTo: aimPoint,
      contact: {
        point: pointOf(shooter),
        actor: shooter,
        type: "shot",
        phase: "start",
      },
      ownerBefore: shooter,
      ownerAfter: null,
      contactType,
      strikingFoot: null,
      badge: ballResult === "over" ? "OVER" : ballResult === "wide" ? "WIDE" : null,
      heightCue: ballResult === "over",
    },
  ));
  if (offTarget) {
    return {
      outcome: "NO GOAL",
      code: execution.code,
      resolved: true,
      terminal: true,
      possession: "dead",
      nextOwnerId: null,
      ballEnd: aimPoint,
      restart: "goal-kick",
      reason: "one-on-one-off-target",
    };
  }

  const side = aimPoint.x < 50 ? "left" : "right";
  const post = postPointFor(shooter, side);
  let endpoint = aimPoint;
  let segments = [aimPoint];
  let restart = null;
  let possession = "turnover";
  let nextOwnerId = keeper.id;
  let badge = "CAUGHT";
  if (execution.goal) {
    endpoint = netPointFor(shooter, aimPoint.x);
    segments = ballResult === "post-goal"
      ? [aimPoint, post, endpoint]
      : [aimPoint, endpoint];
    restart = "kickoff";
    possession = "dead";
    nextOwnerId = null;
    badge = "GOAL";
  } else if (ballResult === "corner") {
    endpoint = outsideCornerPointFor(shooter, side);
    segments = [aimPoint, endpoint];
    restart = "corner";
    possession = "dead";
    nextOwnerId = null;
    badge = "CORNER";
  } else if (ballResult === "rebound-in-play" || ballResult === "post-rebound") {
    endpoint = reboundInBoxPointFor(shooter, keeper);
    segments = ballResult === "post-rebound"
      ? [aimPoint, post, endpoint]
      : [aimPoint, endpoint];
    possession = "loose";
    nextOwnerId = null;
    badge = ballResult === "post-rebound" ? "POST" : "PARRIED";
  }

  const keeperContact = !execution.goal && execution.keeperAction;
  trace.push(traceEvent(
    execution.code,
    execution.goal
      ? `${playerName(shooter.player)} scores the one-on-one`
      : ballResult === "corner"
        ? `${playerName(keeper.player)} turns it behind`
        : ballResult === "rebound-in-play" || ballResult === "post-rebound"
          ? `${playerName(keeper.player)} keeps it out but the ball stays loose`
          : `${playerName(keeper.player)} saves the one-on-one`,
    {
      actor: shooter,
      keeper,
      movement: execution.goal ? "shot" : "save",
      outcome: execution.goal ? "goal" : "save",
      ballFrom: aimPoint,
      ballTo: endpoint,
      pathSegments: segments,
      mover: keeperContact ? keeper : null,
      moveFrom: keeperContact ? pointOf(keeper) : null,
      moveTo: keeperContact ? aimPoint : null,
      contact: keeperContact ? {
        point: aimPoint,
        actor: keeper,
        type: execution.keeperAction,
        phase: "start",
      } : null,
      ownerBefore: null,
      ownerAfter: nextOwnerId ? keeper : null,
      keeperAction: execution.keeperAction,
      ballResult,
      restart,
      badge,
      contactType,
    },
  ));
  return {
    outcome: execution.goal ? "GOAL" : "NO GOAL",
    code: execution.code,
    resolved: true,
    terminal: true,
    possession,
    nextOwnerId,
    ballEnd: endpoint,
    restart,
    reason: execution.goal
      ? "one-on-one-goal"
      : restart === "corner"
        ? "one-on-one-corner"
        : possession === "loose"
          ? "one-on-one-rebound"
          : "one-on-one-saved",
  };
}

function resolveShoot(groups, availability, random, trace) {
  const owner = groups.owner;
  const defender = engagingOpponent(owner, groups.opponents);
  const keeper = groups.keeper;
  const oneOnOne = freePlayOneOnOneContext(groups);
  if (oneOnOne) {
    return resolveFreePlayOneOnOne(groups, oneOnOne, {
      decisionRandom: availability.oneOnOneDecisionRandom || random,
      executionRandom: random,
      keeperResponseRandom: availability.oneOnOneKeeperResponseRandom || random,
    }, trace);
  }
  const pressure = defender
    ? computePressure(defender.player, owner.zone, 0)
    : 0.1;
  const finishType = selectFinishType(owner.player, random, pressure);
  trace.push(
    traceEvent(
      finishType.toUpperCase(),
      `${playerName(owner.player)} goes for a ${finishType} finish`,
      { actor: owner, outcome: "neutral" },
    ),
  );
  const strikeMechanics = selectStrikeMechanics(
    owner,
    finishType,
    pressure,
    random,
  );
  const attempt = resolveFinishAttempt(finishType, owner.player, random);
  const miss = attempt.onTarget
    ? null
    : missPointFor(owner, keeper, strikeMechanics, attempt.code);
  // Shot Placement v1 (2026-08-20) -- computed ONCE, right where the shot
  // is confirmed on target, and reused for every downstream reference to
  // "where this shot is actually going" (the on-target event itself, a
  // block's own ballFrom, and the save's own contact point below) --
  // never re-drawn per call site, which would consume random() again and
  // silently produce a DIFFERENT point for the same shot at each
  // reference (breaking the exact continuity this project's own contact-
  // continuity regression suite specifically exists to catch).
  const shotAimPoint = attempt.onTarget
    ? shotPlacementSpread(owner, keeper, pressure, random)
    : null;
  trace.push(
    traceEvent(attempt.code, attempt.onTarget ? "On target" : "Off target", {
      actor: owner,
      keeper,
      movement: "shot",
      outcome: attempt.onTarget ? "success" : "fail",
      ballFrom: pointOf(owner),
      ballTo: attempt.onTarget ? shotAimPoint : miss.point,
      contact: {
        point: pointOf(owner),
        actor: owner,
        type: "shot",
        phase: "start",
      },
      ownerBefore: owner,
      ownerAfter: null,
      badge: attempt.onTarget ? null : miss.badge,
      heightCue: attempt.onTarget ? false : miss.heightCue,
      ...strikeMechanics,
    }),
  );
  if (!attempt.onTarget) {
    return {
      outcome: "NO GOAL",
      code: attempt.code,
      resolved: true,
      terminal: true,
      possession: "dead",
      nextOwnerId: null,
      ballEnd: miss.point,
      restart: "goal-kick",
      reason: "shot-off-target",
    };
  }
  if (defender) {
    const block = resolveShotBlock(
      defender.player,
      finishType,
      FIXED_MINUTE,
      random,
    );
    if (block.blocked) {
      // Chains from the on-target event's own endpoint (the ball already
      // heading goalward) redirected to the defender, instead of resetting
      // ballFrom back to the shooter -- that reset was the "ball travels
      // twice" bug for this exact sequence.
      trace.push(
        traceEvent(
          "D.BLOCK",
          `${playerName(defender.player)} blocks it (${block.outcome})`,
          {
            actor: owner,
            defender,
            movement: "block",
            outcome: "block",
            ballFrom: shotAimPoint,
            ballTo: pointOf(defender),
            blockOutcome: block.outcome,
            contact: {
              point: pointOf(defender),
              actor: defender,
              type: "block",
              phase: "end",
            },
            ownerBefore: null,
            ownerAfter: block.outcome === "behind" ? null : defender,
          },
        ),
      );
      // "behind" -- a clean block that goes out (dead, corner-ish); "loose"
      // /"safe" -- stays close to the defender, who's the honest next
      // owner (a genuine loose-ball re-contest isn't modeled this pass,
      // see MATCH_LAB_PLAN.md -- not treated as a clean turnover-and-done
      // either, since physically the ball is right there with them).
      const blockedOut = block.outcome === "behind";
      return {
        outcome: `BLOCKED/${block.outcome.toUpperCase()}`,
        code: "D.BLOCK",
        resolved: true,
        terminal: true,
        possession: blockedOut ? "dead" : "turnover",
        nextOwnerId: blockedOut ? null : defender.id,
        ballEnd: pointOf(defender),
        restart: blockedOut ? "corner" : null,
        reason: `shot-blocked-${block.outcome}`,
      };
    }
  }
  const keeperBeaten = keeper && isKeeperBeaten(owner, keeper);
  if (!keeper || keeperBeaten) {
    // See resolveCross()'s identical fix: no keeper placed, OR one who's
    // been rounded (isKeeperBeaten()) -- both are the same structural
    // situation, nobody genuinely positioned to save it. An on-target,
    // unblocked shot against either is a goal. Reuses shotAimPoint --
    // the on-target event above's own already-computed placement (Shot
    // Placement v1) -- as ballFrom, never goalPointFor(owner, null) fresh
    // (found 2026-08-21: since Shot Placement v1 gave the on-target event
    // itself a real, varied aim point, a fresh goalPointFor() call here
    // landed at a DIFFERENT, stale x:50 -- a genuine ball discontinuity,
    // caught by Timeline Playback v1's own continuity validation).
    const emptyNetContact = shotAimPoint;
    const emptyNetEnd = netPointFor(owner, emptyNetContact.x);
    trace.push(
      traceEvent(
        "EMPTY_NET",
        keeperBeaten
          ? `${playerName(owner.player)} finishes into an empty net -- ${playerName(keeper.player)} is well beaten`
          : `${playerName(owner.player)} finishes into an empty net -- no goalkeeper placed`,
        {
          actor: owner,
          movement: "shot",
          outcome: "goal",
          ballFrom: emptyNetContact,
          ballTo: emptyNetEnd,
          pathSegments: [emptyNetContact, emptyNetEnd],
          badge: "GOAL",
          contactType: strikeMechanics.contactType,
        },
      ),
    );
    return {
      outcome: "GOAL",
      code: "EMPTY_NET",
      resolved: true,
      terminal: true,
      possession: "dead",
      nextOwnerId: null,
      ballEnd: emptyNetEnd,
      restart: "kickoff",
      reason: keeperBeaten ? "keeper-beaten-goal" : "empty-net-goal",
    };
  }
  const save = resolveKeeperSave(
    owner.player,
    keeper.player,
    finishType,
    FIXED_MINUTE,
    random,
    owner.zone,
  );
  const saveEndpoint = pushKeeperSaveEvent(trace, {
    shooterEntry: owner,
    keeperEntry: keeper,
    save,
    strikeMechanics,
    contactPoint: shotAimPoint,
  });
  if (save.goal) {
    return {
      outcome: "GOAL",
      code: save.code,
      resolved: true,
      terminal: true,
      possession: "dead",
      nextOwnerId: null,
      ballEnd: saveEndpoint,
      restart: "kickoff",
      reason: "shot-save-goal",
    };
  }
  if (!save.rebound) {
    return keeperSaveTransition(save, keeper, saveEndpoint, "shot");
  }
  if (!defender) {
    const scored =
      random() <
      transitionShotChance(
        owner.player,
        keeper.player,
        FIXED_MINUTE,
        0.32,
        poacherScore,
      );
    const reboundMiss = scored ? null : missPointFor(owner, keeper, null, null);
    const reboundEnd = scored
      ? netPointFor(owner, shotPlacementSpread(owner, keeper, REBOUND_SHOT_PRESSURE, random).x)
      : reboundMiss.point;
    trace.push(
      traceEvent(
        scored ? "REBOUND.GOAL" : "REBOUND.MISS",
        scored
          ? `${playerName(owner.player)} scrambles it in, unchallenged`
          : "The rebound drifts away, unchallenged",
        {
          actor: owner,
          keeper,
          movement: "rebound-shot",
          outcome: scored ? "goal" : "fail",
          // Continues from saveEndpoint -- the save's real endpoint (a
          // parry/post-rebound spot), only reachable when save.rebound is
          // true (K.SAVE.2/.5/.6), not back from the original shooter.
          // mover/moveTo: the scorer genuinely moves to the rebound spot to
          // meet the ball there -- a real browser round caught this being
          // missing (the "contact" record already named them as the
          // contacting actor, but nothing ever moved their own MARKER
          // there, so a scored rebound visually looked like the ball never
          // left the keeper).
          mover: owner,
          moveTo: saveEndpoint,
          ballFrom: saveEndpoint,
          ballTo: reboundEnd,
          badge: scored ? null : reboundMiss.badge,
          contact: {
            point: saveEndpoint,
            actor: owner,
            type: "rebound-shot",
            phase: "start",
          },
          ownerBefore: owner,
          ownerAfter: null,
        },
      ),
    );
    return {
      outcome: scored ? "GOAL" : "NO GOAL",
      code: scored ? "REBOUND.GOAL" : "REBOUND.MISS",
      resolved: true,
      // A miss is the ball genuinely leaving play, not a keeper catch --
      // see resolveCross()'s identical fix and resolveReboundScramble()'s
      // own comment on this exact bug.
      terminal: true,
      possession: "dead",
      nextOwnerId: null,
      ballEnd: reboundEnd,
      restart: scored ? "kickoff" : "goal-kick",
      reason: scored ? "rebound-goal-uncontested" : "rebound-miss-uncontested",
    };
  }
  return resolveReboundScramble(
    owner,
    defender,
    keeper,
    owner.zone,
    random,
    trace,
    saveEndpoint,
  );
}

// Open-space progression -- only ever chosen when generateFreePlayCandidates()
// found no defender in genuine duel range (spatialDecision.js's
// engagingOpponent()/DUEL_RANGE_YARDS), which is exactly what makes this
// resolver honest as an unconditional success: there is nobody placed
// close enough to contest it. resolveDribble() is the contested twin --
// a real duel, genuinely possible to lose -- for when a defender IS in
// range; this one never rolls a duel at all, since by construction
// there's nothing to duel against.
// The destination is decided ENTIRELY by Directional Carry Planning
// (spatialDecision.js's planCarryDestination(), called once inside
// generateFreePlayCandidates() and threaded through here via
// availability.plannedMoveTo) -- this never recomputes its own endpoint
// via advanceTowardGoal(). That was the exact bug a real browser round
// caught: the OLD resolveCarry() always advanced straight toward the
// byline regardless of what the decision layer had actually reasoned
// about (cutting inside, a shorter controlled advance, etc), because it
// silently ignored the chosen candidate's own destination and recomputed
// a generic one instead.
// Touches Per Carry (2026-08-18) -- the straight-line run from the
// carrier's current spot to the already-planned destination above is
// broken into real intermediate touches (spatialDecision.js's
// determineCarryGait()/planCarryTouches()) instead of covering the whole
// distance in one resolved touch. The DESTINATION itself is completely
// unchanged (still exactly availability.plannedMoveTo, still ballEnd) --
// this only decides how many genuine touches lie along the way there,
// each one a real playerMoves-style advance the touch-path visualization
// (recordTouch(), keyed off ballFrom) and the renderer both already
// handle via the EXISTING single-mover mechanism, zero renderer changes
// needed. Every intermediate touch chains ballFrom/ballTo exactly (each
// one's ballFrom is the previous one's own ballTo, by construction) --
// the same continuity invariant every other multi-event resolver in this
// file already holds. Deterministic: gait/spacing consume no random()
// call at all, so this never perturbs the existing RNG stream any other
// part of this resolver (or resolveDribble()'s own WON branch) relies on.
// interleaveOffBall (default false) -- see resolveDribble()'s identical
// param and its own comment on why this must default OFF.
//
// Directional continuity (2026-08-19) -- a real browser round reported a
// long carry visibly shuffling side to side rather than committing to a
// direction. planCarryDestination() (spatialDecision.js) reads
// owner.lastCarryDirectionX/Y as a pure, tie-breaking scoring bonus; this
// is the ONLY place that ever WRITES it, right after a real advance is
// finalized, so the NEXT decision (a fresh planCarryDestination() call,
// same possession) can read it back.
function recordCarryDirection(owner, origin, destination) {
  const originYard = toYardPoint(origin);
  const destYard = toYardPoint(destination);
  const dx = destYard.x - originYard.x;
  const dy = destYard.y - originYard.y;
  const length = Math.hypot(dx, dy) || 1;
  owner.lastCarryDirectionX = dx / length;
  owner.lastCarryDirectionY = dy / length;
}

function resolveCarry(
  groups,
  availability,
  random,
  trace,
  interleaveOffBall = false,
  motionContext = null,
) {
  const owner = groups.owner;
  const point = availability.plannedMoveTo;
  const advanced = {
    x: point.x,
    y: point.y,
    zone: zoneFromPercent(point.x, point.y),
  };
  const origin = pointOf(owner);
  // Directional continuity -- see planCarryDestination()'s own comment.
  // Real possession-loop carries only (interleaveOffBall gates every
  // roster write this file makes, same convention as everywhere else) --
  // a direct resolver call against a hand-built test fixture must never
  // pick up this side effect either.
  if (interleaveOffBall) recordCarryDirection(owner, origin, advanced);
  const carryPressure = pressureAt(origin, groups.opponents);
  const gait = determineCarryGait(origin, groups.opponents);
  const touches = planCarryTouches(origin, advanced, gait, {
    player: owner.player,
    pressure: carryPressure,
    seed: `${owner.id}:carry:${origin.x}:${origin.y}:${advanced.x}:${advanced.y}`,
  });
  let cursor = origin;
  touches.forEach((waypoint, index) => {
    const to = {
      x: waypoint.x,
      y: waypoint.y,
      zone: zoneFromPercent(waypoint.x, waypoint.y),
    };
    trace.push(
      traceEvent(
        "P.CARRY.TOUCH",
        `${playerName(owner.player)} touches it forward`,
        {
          actor: owner,
          mover: owner,
          moveFrom: cursor,
          moveTo: to,
          movement: "touch",
          outcome: "success",
          ballFrom: cursor,
          ballTo: to,
          contact: {
            point: cursor,
            actor: owner,
            type: "touch",
            phase: "start",
          },
          ownerBefore: owner,
          ownerAfter: owner,
          attribution: waypoint.kinetics?.attribution,
        },
      ),
    );
    cursor = to;
    // Same continuous coverage as a successful dribble: every touch gets
    // a concurrent off-ball reaction rather than one midpoint burst.
    if (interleaveOffBall) {
      reactOffBall(groups, cursor, trace, {
        fraction: INTERLEAVED_REACTION_FRACTION,
        defensiveFraction: INTERLEAVED_DEFENSIVE_REACTION_FRACTION,
        duration: INTERLEAVED_REACTION_DURATION,
        motionContext,
      });
    }
  });
  trace.push(
    traceEvent(
      "P.CARRY",
      `${playerName(owner.player)} carries it forward into space`,
      {
        actor: owner,
        mover: owner,
        moveFrom: cursor,
        moveTo: advanced,
        movement: "dribble",
        outcome: "success",
        ballFrom: cursor,
        ballTo: advanced,
        contact: { point: cursor, actor: owner, type: "touch", phase: "start" },
        ownerBefore: owner,
        ownerAfter: owner,
      },
    ),
  );
  return {
    outcome: "CARRY",
    code: "P.CARRY",
    resolved: true,
    terminal: false,
    possession: "retained",
    nextOwnerId: owner.id,
    ballEnd: advanced,
    restart: null,
    reason: "carry-advance",
  };
}

// Hold-Up Play v1 (2026-08-18) -- see spatialDecision.js's holdUtility()
// for why this is offered at all. Two shapes, not one: uncontested (no
// real defender close enough to challenge -- a genuine, costless "assess
// and wait" beat) versus a real Strength-driven SHIELDING contest when
// someone is. Shielding is a deliberately NEW contest, not a reuse of
// resolveDribble()'s own progression duel -- "can I keep the ball
// standing still" and "can I get past this defender" are different real-
// football questions, so this earns its own localizedDuel() call rather
// than borrowing one built for a different question. No equivalent exists
// in draft-run.js's own tick loop to stay "faithful to" here -- this is
// genuinely new, Match-Lab-only ground, same as the two "no such thing as"
// concepts (holding, shielding) the user asked for by name.
function resolveHold(groups, availability, random, trace) {
  const owner = groups.owner;
  const defender = engagingOpponent(owner, groups.opponents);
  if (!defender) {
    // Nobody close enough to challenge -- a real, uncontested pause, not a
    // resolver stand-in for "nothing happened." The ball never leaves the
    // carrier's feet (ballFrom === ballTo), same "stationary, decision-
    // shaped beat" convention P.PROGRESS's own neutral event already uses.
    trace.push(
      traceEvent(
        "P.HOLD",
        `${playerName(owner.player)} holds the ball, looking for support`,
        {
          actor: owner,
          movement: "hold",
          outcome: "neutral",
          ballFrom: pointOf(owner),
          ballTo: pointOf(owner),
          contact: {
            point: pointOf(owner),
            actor: owner,
            type: "touch",
            phase: "start",
          },
          ownerBefore: owner,
          ownerAfter: owner,
        },
      ),
    );
    return {
      outcome: "HOLD",
      code: "P.HOLD",
      resolved: true,
      terminal: false,
      possession: "retained",
      nextOwnerId: owner.id,
      ballEnd: pointOf(owner),
      restart: null,
      reason: "hold-uncontested",
    };
  }
  // Shielding -- Strength/Balance/Composure protecting the ball vs. the
  // challenger's own Strength/Aggression/Tackling trying to muscle them
  // off it. The defender genuinely closes to the contact point (the same
  // "challenger comes to the ball" pattern resolveDribble()'s own tackle
  // event already uses) -- the carrier never teleports, they were already
  // there.
  const contactPoint = pointOf(owner);
  const shieldDuel = localizedDuel(
    owner.player,
    defender.player,
    ["Strength", "Balance", "Composure"],
    ["Strength", "Aggression", "Tackling"],
    FIXED_MINUTE,
    random,
    owner.zone,
  );
  trace.push(
    traceEvent(
      "P.HOLD.SHIELD",
      `${playerName(owner.player)} shields the ball from ${playerName(defender.player)} (${Math.round(shieldDuel.probability * 100)}%)`,
      {
        actor: owner,
        defender,
        movement: "hold",
        outcome: "neutral",
        ballFrom: contactPoint,
        ballTo: contactPoint,
        playerMoves: [
          {
            player: defender,
            from: pointOf(defender),
            to: contactPoint,
            action: "challenge",
          },
        ],
      },
    ),
  );
  if (shieldDuel.won) {
    trace.push(
      traceEvent(
        "P.HOLD.SHIELD.WON",
        `${playerName(owner.player)} holds off ${playerName(defender.player)} and keeps the ball`,
        {
          actor: owner,
          defender,
          movement: "hold",
          outcome: "success",
          ballFrom: contactPoint,
          ballTo: contactPoint,
          contact: {
            point: contactPoint,
            actor: owner,
            type: "touch",
            phase: "end",
          },
          ownerBefore: owner,
          ownerAfter: owner,
          ownerAfterAt: "end",
        },
      ),
    );
    return {
      outcome: "HOLD/SHIELDED",
      code: "P.HOLD.SHIELD.WON",
      resolved: true,
      terminal: false,
      possession: "retained",
      nextOwnerId: owner.id,
      ballEnd: contactPoint,
      restart: null,
      reason: "hold-shielded",
    };
  }
  trace.push(
    traceEvent(
      "P.HOLD.SHIELD.LOST",
      `${playerName(defender.player)} muscles the ball away from ${playerName(owner.player)}`,
      {
        actor: defender,
        defender: owner,
        movement: "hold",
        outcome: "turnover",
        ballFrom: contactPoint,
        ballTo: contactPoint,
        contact: {
          point: contactPoint,
          actor: defender,
          type: "touch",
          phase: "end",
        },
        ownerBefore: owner,
        ownerAfter: defender,
        ownerAfterAt: "end",
      },
    ),
  );
  return {
    outcome: "DISPOSSESSED",
    code: "P.HOLD.SHIELD.LOST",
    resolved: true,
    terminal: true,
    possession: "turnover",
    nextOwnerId: defender.id,
    ballEnd: contactPoint,
    restart: null,
    reason: "hold-dispossessed",
  };
}

const FREE_PLAY_RESOLVERS = {
  pass: resolvePass,
  through: resolveThroughBall,
  cross: resolveCross,
  dribble: resolveDribble,
  shoot: resolveShoot,
  carry: resolveCarry,
  hold: resolveHold,
};

// A possession that's still "retained" after this many actions stops here
// rather than looping forever -- a hard safeguard, not a realistic outcome
// most chains reach (most terminate naturally within a few steps).
const POSSESSION_MAX_ACTIONS = 50;

// Possession Runner v1. Free Play used to resolve exactly one action and
// stop -- a successful pass or dribble had nowhere to go, which is why
// those specifically (unlike Cross/Shoot, which already contain their own
// internal chains: aerial race -> header -> save, or shot -> block/save ->
// rebound) never felt like a complete attack. This loops through
// FREE_PLAY_RESOLVERS, following each one's standardized transition
// contract ({terminal, possession, nextOwnerId, ballEnd, restart, reason}
// -- see resolvePass()'s own comment for the full shape), until a
// terminal result or the action cap.
//
// The AUTHORED roster (state.roster) is never touched here -- only a
// mutable per-possession CLONE (simulatedRoster: same entries, own
// x/y/zone, shared `player` reference since attributes are never
// written) does. Every resolver is handed entries from that clone (via
// freePlayGroups()'s second parameter), and after each transition the
// entry that now controls the ball is moved to the resolver's own
// ballEnd -- so a later step's pointOf(owner) reads wherever that
// player's possession has actually progressed them to, not their
// authored starting spot. This is the fix for a real browser-caught bug:
// a shot animating from a point no player was standing at, because only
// the ball's conceptual position used to advance across steps, never the
// player who'd just carried it there (see MATCH_LAB_PLAN.md, "Possession
// Runner v1 -- Pass 1").
function runConstructedPossession(seed) {
  const authoredOwner =
    state.roster.find((entry) => entry.id === state.ball.ownerId) || null;
  const trace = [];
  const decisionMetrics = [];
  if (!authoredOwner) {
    const result = {
      outcome: "NO BALL OWNER",
      code: "NONE",
      resolved: false,
      terminal: true,
      possession: "dead",
      nextOwnerId: null,
      ballEnd: null,
      restart: null,
      reason: "no-ball-owner",
    };
    return {
      result,
      trace,
      finalOwnerId: null,
      actionsCount: 0,
      finalPositions: state.roster.map((entry) => ({ ...entry })),
      decisionMetrics,
      possessionMetrics: {
        decisions: 0,
        passesSelected: 0,
        carriesSelected: 0,
        shotsSelected: 0,
        meanLegalPassingOptions: 0,
        minimumLegalPassingOptions: 0,
        meanPressureAtDecision: 0,
        meanShotDistanceYards: null,
      },
    };
  }

  const simulatedRoster = state.roster.map((entry) => ({ ...entry }));
  const motionContext = { state: createMotionState() };
  let simulated = {
    ownerId: authoredOwner.id,
    ballPoint: pointOf(authoredOwner),
    ballState: createBallState({
      position: pointOf(authoredOwner),
      ownerId: authoredOwner.id,
      ownerRole: authoredOwner.role,
    }),
  };
  let result = null;
  let actionsCount = 0;
  let endedByStoppage = false;

  for (; actionsCount < POSSESSION_MAX_ACTIONS; actionsCount += 1) {
    const groups = freePlayGroups(
      simulated.ownerId,
      simulatedRoster,
      simulated.ballState,
    );
    if (!groups.owner) {
      result = {
        outcome: "NO BALL OWNER",
        code: "NONE",
        resolved: false,
        terminal: true,
        possession: "dead",
        nextOwnerId: null,
        ballEnd: simulated.ballPoint,
        restart: null,
        reason: "owner-missing-mid-possession",
      };
      break;
    }
    // Independently-keyed per step AND per stream: decisionRandom (which
    // action gets chosen) never shares a sequence with executionRandom
    // (resolving it), so changing candidate scoring -- or this roster
    // simply having a different number of placed players to weigh -- can
    // never perturb what an otherwise-identical execution roll produces.
    // Both are keyed off this possession's own seed AND the step index,
    // so an identical seed reproduces the entire possession, not just its
    // first action.
    const decisionRandom = seededRandom(
      hashString(`match-lab:freeplay:decision:${seed}:${actionsCount}`),
    );
    const executionRandom = seededRandom(
      hashString(`match-lab:freeplay:execution:${seed}:${actionsCount}`),
    );
    // Spatial Decision Intelligence v1 (spatialDecision.js): concrete,
    // individually-scored candidates -- pass to THIS teammate, cross to
    // THAT one, shoot, carry/dribble -- chosen via noisy-argmax keyed off
    // decisionRandom and the owner's own perception sharpness (Decisions/
    // Vision/Anticipation/Composure). Never touches executionRandom --
    // the resolver below still independently rolls whatever the chosen
    // candidate actually does.
    const candidates = generateFreePlayCandidates(
      groups,
      state.attackingDirection[groups.owner.team],
    );
    const decision = chooseCandidate(
      candidates,
      groups.owner.player,
      decisionRandom,
    );
    const optionMetrics = {
      ...decisionOptionMetrics(candidates, groups),
      decisionIndex: actionsCount,
      ownerId: groups.owner.id,
      distanceToGoalYards: distanceToGoalYards(
        groups.owner,
        state.attackingDirection[groups.owner.team],
      ),
      selectedAction: decision?.type ?? null,
    };
    decisionMetrics.push(optionMetrics);
    if (!decision) {
      trace.push(
        traceEvent(
          "ACTION.CHOICE",
          "No action is available with the current roster",
          {
            actor: groups.owner,
            outcome: "neutral",
            metrics: optionMetrics,
          },
        ),
      );
      result = {
        outcome: "NO ACTION AVAILABLE",
        code: "NONE",
        resolved: false,
        terminal: true,
        possession: "dead",
        nextOwnerId: null,
        ballEnd: simulated.ballPoint,
        restart: null,
        reason: "no-action-available",
      };
      break;
    }
    trace.push(
      traceEvent(
        "ACTION.CHOICE",
        decision.target
          ? `${playerName(groups.owner.player)} chooses to ${decision.type} to ${playerName(decision.target.player)} · ${optionMetrics.legalPassingOptions} legal pass option${optionMetrics.legalPassingOptions === 1 ? "" : "s"}`
          : `${playerName(groups.owner.player)} chooses to ${decision.type} · ${optionMetrics.legalPassingOptions} legal pass option${optionMetrics.legalPassingOptions === 1 ? "" : "s"}`,
        { actor: groups.owner, outcome: "neutral", metrics: optionMetrics },
      ),
    );
    const availability = {
      preselectedTargetId: decision.target ? decision.target.id : null,
      plannedMoveTo: decision.moveTo || null,
      offside: decision.offside || null,
      oneOnOneDecisionRandom: seededRandom(
        hashString(`match-lab:freeplay:one-on-one-decision:${seed}:${actionsCount}`),
      ),
      oneOnOneKeeperResponseRandom: seededRandom(
        hashString(`match-lab:freeplay:one-on-one-keeper:${seed}:${actionsCount}`),
      ),
    };
    // The trailing `true` opts INTO interleaved off-ball reactions --
    // only meaningful for resolveCarry()/resolveDribble() (the other
    // resolvers ignore a 5th argument entirely); safe here specifically
    // because `groups` was built from THIS run's own disposable
    // simulatedRoster clone, never a shared/reused fixture -- see
    // resolveDribble()'s own signature comment on why this must default
    // OFF everywhere else.
    const actionTraceStart = trace.length;
    result = FREE_PLAY_RESOLVERS[decision.type](
      groups,
      availability,
      executionRandom,
      trace,
      true,
      motionContext,
    );
    const actionTrace = trace.slice(actionTraceStart);
    // Every explicit physical move is authoritative simulation state, not
    // animation metadata. Previously only the next ball owner was committed,
    // so an aerial contestant/challenger could visibly arrive somewhere and
    // then make their next tactical decision from an older coordinate.
    for (const event of actionTrace) {
      for (const move of event.playerMoves || []) {
        if (move.authoritative === false) continue;
        const movedEntry = simulatedRoster.find(
          (entry) => String(entry.id) === String(move.playerId),
        );
        if (!movedEntry || !move.to) continue;
        Object.assign(movedEntry, move.to);
        if (
          event.movement !== "reposition" &&
          motionContext.state.players?.[move.playerId]
        ) {
          motionContext.state.players[move.playerId] = {
            ...motionContext.state.players[move.playerId],
            velocity: { x: 0, y: 0 },
            intention: null,
            lastPosition: { ...move.to },
          };
        }
      }
    }
    const lastBallEvent = actionTrace
      .slice()
      .reverse()
      .find((event) => event.ballTrajectory?.length);
    const lastTouchEvent = actionTrace
      .slice()
      .reverse()
      .find((event) => event.lastTouch);

    // A loose ball is still live. Resolve the race from ball geometry and
    // player Pace/Anticipation instead of ending the animation on an ownerless
    // tackle/deflection. This consumes no gameplay RNG and produces an
    // explicit recovery contact for playback.
    if (
      !result.nextOwnerId &&
      !result.restart &&
      result.possession === "loose" &&
      result.ballEnd
    ) {
      const looseState = transitionBallState({
        previous: simulated.ballState,
        endpoint: result.ballEnd,
        ownerId: null,
        trajectory: lastBallEvent?.ballTrajectory || [],
        lastTouchId: lastTouchEvent?.lastTouch?.playerId ?? null,
        lastTouch: lastTouchEvent?.lastTouch ?? null,
      });
      const recoveredBy = selectLooseBallRecovery(simulatedRoster, looseState);
      if (recoveredBy) {
        const recoveryDuration = Math.max(
          MOVEMENT_DURATIONS.scramble,
          Math.round(
            timeToReach(
              recoveredBy.player,
              yardDistance(recoveredBy, result.ballEnd),
            ) * 1000,
          ),
        );
        trace.push(
          traceEvent(
            "LOOSE.RECOVERED",
            `${playerName(recoveredBy.player)} reaches the loose ball`,
            {
              actor: recoveredBy,
              mover: recoveredBy,
              moveTo: result.ballEnd,
              movement: "scramble",
              outcome: "success",
              duration: recoveryDuration,
              ballFrom: result.ballEnd,
              ballTo: result.ballEnd,
              contact: {
                point: result.ballEnd,
                actor: recoveredBy,
                type: "recovery",
                phase: "end",
              },
              ownerBefore: null,
              ownerAfter: recoveredBy,
              ownerAfterAt: "end",
              contactTiming: "sequential",
            },
          ),
        );
        result = {
          ...result,
          terminal: false,
          possession:
            recoveredBy.team === groups.owner.team ? "retained" : "turnover",
          nextOwnerId: recoveredBy.id,
          reason: `${result.reason}-recovered`,
        };
      }
    }
    // Atomic transition: ball position, the simulated position of whoever
    // controls it next, and who owns it next all update together, every
    // step -- terminal or not, so finalOwnerId/finalPositions always
    // reflect the true resting state (e.g. the keeper who just caught it)
    // rather than a stale pre-transition snapshot. Moving nextOwnerId's
    // entry to ballEnd is correct for every resolver return observed:
    // a dribbler carries the ball to its real advance point, a receiver
    // meets it at its real arrival point (possibly zone-advanced), an
    // interceptor/tackler/keeper is already standing at ballEnd (their
    // own point), so this is a real move in the first two cases and a
    // harmless no-op in the rest -- never wrong.
    if (result.ballEnd) {
      simulated.ballPoint = result.ballEnd;
      if (result.nextOwnerId) {
        const movedEntry = simulatedRoster.find(
          (entry) => entry.id === result.nextOwnerId,
        );
        if (movedEntry) {
          const alreadyAuthored = trace
            .slice(actionTraceStart)
            .some((event) =>
              (event.playerMoves || []).some(
                (move) =>
                  move.playerId === movedEntry.id &&
                  Math.abs(move.to.x - result.ballEnd.x) <= 0.001 &&
                  Math.abs(move.to.y - result.ballEnd.y) <= 0.001,
              ),
            );
          const mustConverge =
            !alreadyAuthored &&
            (Math.abs(movedEntry.x - result.ballEnd.x) > 0.001 ||
              Math.abs(movedEntry.y - result.ballEnd.y) > 0.001);
          if (mustConverge) {
            // A tackle/interception can transfer ownership at the ball's
            // contact point after that defender previously repositioned.
            // Author the convergence explicitly; silently teleporting the
            // new owner here broke both playback continuity and the premise
            // that players react to the independent ball.
            trace.push(
              traceEvent(
                "CONTROL.CONVERGE",
                `${playerName(movedEntry.player)} reaches the ball`,
                {
                  actor: movedEntry,
                  mover: movedEntry,
                  moveFrom: pointOf(movedEntry),
                  moveTo: result.ballEnd,
                  movement: "interception",
                  outcome: "success",
                  overlapWithPrevious: true,
                },
              ),
            );
          }
          Object.assign(movedEntry, result.ballEnd);
        }
      }
      const nextOwner = result.nextOwnerId
        ? simulatedRoster.find((entry) => entry.id === result.nextOwnerId) ||
          null
        : null;
      simulated.ballState = transitionBallState({
        previous: simulated.ballState,
        endpoint: result.ballEnd,
        ownerId: result.nextOwnerId,
        ownerRole: nextOwner?.role ?? null,
        restart: result.restart,
        trajectory: lastBallEvent?.ballTrajectory || [],
        lastTouchId:
          lastTouchEvent?.lastTouch?.playerId ?? nextOwner?.id ?? null,
        lastTouch: lastTouchEvent?.lastTouch ?? null,
      });
    }
    // Off-Ball Goalkeeper Awareness (2026-08-18) -- only while the
    // possession CONTINUES: a dead ball has no next decision for this to
    // matter to, so there's nothing to react ahead of. Reacts to where
    // the ball actually ended up this step (narrows the angle -- see
    // keeperPositioningPoint()), which is what stops the keeper from
    // being left standing behind an attacker who's carried straight past
    // them over several steps (a real browser-caught bug: the shot's own
    // aim point then had nothing sane to target). A small movement
    // threshold (0.5% of the pitch) skips pushing a no-op event when the
    // ideal spot barely changed. Pure geometry, no randomness -- this
    // never consumes decisionRandom or executionRandom.
    const continuesLive = Boolean(result.nextOwnerId && !result.restart);
    if (continuesLive) {
      // Off-Ball Attacker/Defender/Goalkeeper Awareness -- the full,
      // guaranteed-convergence reaction at the end of every action. Motion
      // v1 plans every role from one snapshot and commits them atomically;
      // the following reaction observes the completed run rather than a
      // defender reading a partially-mutated same-tick world.
      // Carry/dribble-advance actions ALSO get smaller, interleaved
      // reactions mid-action (see resolveCarry()/resolveDribble()'s own
      // calls) -- this call still runs unconditionally afterward
      // regardless, since it's what guarantees everyone's actually
      // arrived by the time the action concludes, not just approximately
      // close.
      //
      // Continuous World Motion During Ball Flight v1 (2026-08-20) -- this
      // was the OTHER half of "the previous fixes... preserved the
      // underlying stop-start movement model": reactOffBall(fraction:1)'s
      // own resolveMotionBatch()/hermite beat forced a full 0%->100% snap
      // to the freshly-recomputed post-reception tactical shape inside one
      // FIXED duration (MOVEMENT_DURATIONS.reposition), regardless of how
      // far that genuinely was -- "a larger 'converge to position' movement
      // after reception," the exact sudden burst reported. reactOffBallContinuous()
      // already does the identical target planning (same planAttackerRepositioning/
      // planDefensiveRepositioning/keeperPositioningPoint calls -- ballFrom
      // is unused by either caller) but moves everyone along ONE
      // continuous, reachIn()-limited trajectory instead: physically
      // capped, no beat-boundary velocity reset, no distance-blind snap.
      const defendingGroups = freePlayGroups(
        result.nextOwnerId,
        simulatedRoster,
        simulated.ballState,
      );
      reactOffBallContinuous(
        defendingGroups,
        simulated.ballPoint,
        simulated.ballPoint,
        POST_ACTION_CONVERGENCE_MS,
        trace,
        { motionContext, overlapWithPrevious: false },
      );
    } else if (result.restart && groups.owner) {
      // Motion continues until the whistle/ball-out instant. A terminal
      // outcome used to skip this entire batch, freezing every uninvolved
      // player throughout the final tackle or ball flight. Keep the direct
      // participants on their resolver-authored tracks, while the remaining
      // players carry their real tactical intentions through that interval.
      const directParticipants = actionTrace
        .flatMap((event) => [
          event.actorId,
          event.targetId,
          event.defenderId,
          event.keeperId,
          event.contact?.actorId,
        ])
        .filter(Boolean);
      const terminalGroups = freePlayGroups(
        groups.owner.id,
        simulatedRoster,
        simulated.ballState,
      );
      reactOffBall(
        terminalGroups,
        pointOf(terminalGroups.owner) || simulated.ballPoint,
        trace,
        {
          fraction: 0.5,
          duration: Math.min(400, lastBallEvent?.duration || 400),
          motionContext,
          excludedIds: directParticipants,
        },
      );
    }
    simulated.ownerId = result.nextOwnerId;
    // Direct resolvers still report a clean interception/tackle/keeper catch
    // as terminal for their isolated action contract. The sequence runner is
    // broader: any live result with a real next owner begins another action.
    if (!continuesLive) {
      endedByStoppage = true;
      break;
    }
  }

  if (result && !endedByStoppage) {
    trace.push(
      traceEvent(
        "POSSESSION.MAX_ACTIONS",
        `Live sequence capped at ${POSSESSION_MAX_ACTIONS} actions`,
        { outcome: "neutral" },
      ),
    );
    result = { ...result, terminal: true, reason: "max-actions-reached" };
  }

  const legalOptionCounts = decisionMetrics.map(
    (entry) => entry.legalPassingOptions,
  );
  const meanLegalPassingOptions = legalOptionCounts.length
    ? legalOptionCounts.reduce((sum, value) => sum + value, 0) /
      legalOptionCounts.length
    : 0;
  const shotSamples = decisionMetrics.filter(
    (entry) => entry.selectedAction === "shoot",
  );
  return {
    result,
    trace,
    finalOwnerId: simulated.ownerId,
    finalBallState: simulated.ballState,
    actionsCount,
    finalPositions: simulatedRoster,
    decisionMetrics,
    possessionMetrics: {
      decisions: decisionMetrics.length,
      passesSelected: decisionMetrics.filter(
        (entry) => entry.selectedAction === "pass",
      ).length,
      carriesSelected: decisionMetrics.filter(
        (entry) => entry.selectedAction === "carry",
      ).length,
      shotsSelected: shotSamples.length,
      meanLegalPassingOptions,
      minimumLegalPassingOptions: legalOptionCounts.length
        ? Math.min(...legalOptionCounts)
        : 0,
      meanPressureAtDecision: decisionMetrics.length
        ? decisionMetrics.reduce(
            (sum, entry) => sum + entry.pressureAtDecision,
            0,
          ) / decisionMetrics.length
        : 0,
      meanShotDistanceYards: shotSamples.length
        ? shotSamples.reduce(
            (sum, entry) => sum + entry.distanceToGoalYards,
            0,
          ) / shotSamples.length
        : null,
    },
  };
}

const elements = {
  seed: document.querySelector("#labSeed"),
  databaseSelect: document.querySelector("#labDatabaseSelect"),
  searchInput: document.querySelector("#labSearchInput"),
  searchStatus: document.querySelector("#labSearchStatus"),
  searchResults: document.querySelector("#labSearchResults"),
  pitch: document.querySelector("#labPitch"),
  trailPath: document.querySelector("#labTrailPath"),
  touchLayer: document.querySelector("#labTouchLayer"),
  touchLine: document.querySelector("#labTouchLine"),
  touchMarks: document.querySelector("#labTouchMarks"),
  showTouchesCheckbox: document.querySelector("#labShowTouchesCheckbox"),
  showLabelsCheckbox: document.querySelector("#labShowLabelsCheckbox"),
  showVisionCheckbox: document.querySelector("#labShowVisionCheckbox"),
  visionLayer: document.querySelector("#labVisionLayer"),
  visionConeCurrent: document.querySelector("#labVisionConeCurrent"),
  visionConeFading: document.querySelector("#labVisionConeFading"),
  visionConeAnticipating: document.querySelector("#labVisionConeAnticipating"),
  quickSetupStatus: document.querySelector("#labQuickSetupStatus"),
  resultBadge: document.querySelector("#labResultBadge"),
  roster: document.querySelector("#labRoster"),
  freePlayModeButton: document.querySelector("#labFreePlayModeButton"),
  probeModeButton: document.querySelector("#labProbeModeButton"),
  freePlayPanel: document.querySelector("#labFreePlayPanel"),
  probePanel: document.querySelector("#labProbePanel"),
  ballOwnerStatus: document.querySelector("#labBallOwnerStatus"),
  probeShooterStatus: document.querySelector("#labProbeShooterStatus"),
  actionTable: document.querySelector("#labActionTable"),
  scenarioSelect: document.querySelector("#labScenarioSelect"),
  scenarioDescription: document.querySelector("#labScenarioDescription"),
  roleRequirements: document.querySelector("#labRoleRequirements"),
  contextControls: document.querySelector("#labContextControls"),
  playButton: document.querySelector("#labPlayButton"),
  playPauseButton: document.querySelector("#labPlayPauseButton"),
  replayButton: document.querySelector("#labReplayButton"),
  rerollButton: document.querySelector("#labRerollButton"),
  stepButton: document.querySelector("#labStepButton"),
  resetButton: document.querySelector("#labResetButton"),
  speedSelect: document.querySelector("#labSpeedSelect"),
  speedValue: document.querySelector("#labSpeedValue"),
  attackingDirectionSelect: document.querySelector(
    "#labAttackingDirectionSelect",
  ),
  soundCheckbox: document.querySelector("#labSoundCheckbox"),
  volumeInput: document.querySelector("#labVolumeInput"),
  runCountInput: document.querySelector("#labRunCountInput"),
  runNButton: document.querySelector("#labRunNButton"),
  inspector: document.querySelector("#labInspector"),
  inspectorList: document.querySelector("#labInspectorList"),
  trace: document.querySelector("#labTrace"),
  traceSource: document.querySelector("#labTraceSource"),
  traceStatus: document.querySelector("#labTraceStatus"),
  traceList: document.querySelector("#labTraceList"),
  distribution: document.querySelector("#labDistribution"),
  distributionCount: document.querySelector("#labDistributionCount"),
  distributionList: document.querySelector("#labDistributionList"),
  oneOnOneDiagnostic: document.querySelector("#labOneOnOneDiagnostic"),
  oneOnOneSelected: document.querySelector("#labOneOnOneSelected"),
  oneOnOneReasons: document.querySelector("#labOneOnOneReasons"),
  oneOnOneCandidates: document.querySelector("#labOneOnOneCandidates"),
  oneOnOneResult: document.querySelector("#labOneOnOneResult"),
  oneOnOneExecution: document.querySelector("#labOneOnOneExecution"),
  oneOnOneActualState: document.querySelector("#labOneOnOneActualState"),
  oneOnOnePerceivedState: document.querySelector("#labOneOnOnePerceivedState"),
};

const state = {
  mode: "freeplay", // "freeplay" | "probe"
  database: "",
  roster: [], // { id, role, team, player, x, y, zone }
  ball: { x: 50, y: 50, zone: zoneFromPercent(50, 50), ownerId: null },
  scenario: SCENARIOS[0],
  context: {},
  seed: Math.floor(Math.random() * 1_000_000),
  // Explicit, not inferred per-action from whichever half a player
  // currently occupies -- inferring "the target goal" from position alone
  // stops being reliable the moment a possession can advance across zones
  // (the Possession Runner's whole point). "down" = attacks toward y:100;
  // "up" = attacks toward y:0. Linked, not independent per team: this is a
  // single pitch with two ends, so one team's direction always implies
  // the other's.
  attackingDirection: { home: "down", away: "up" },
  lastMode: null,
  lastTrace: null,
  lastPlan: null,
  playbackTimeMs: 0,
  stepIndex: 0,
  markerCounter: 0,
  speed: 1,
  // Label decluttering (2026-08-19) -- off by default: only the current
  // ball owner's name label stays visible, see updateLabelVisibility()'s
  // own comment.
  showAllLabels: false,
  // Vision cone (2026-08-19) -- off by default, see updateVisionCone()'s
  // own comment.
  showVisionCone: false,
  // Set only by the "one-on-one-decision" scenario's run(); rendered by
  // renderOneOnOneDiagnostic() into its own panel, never through the trace/
  // animation path (see that scenario's own comment on why).
  lastOneOnOneDiagnostic: null,
  // Free Play's complete Possession Runner record -- seed, an explicit
  // SNAPSHOT of the authored setup this run actually used (not a live
  // reference to state.roster; a later drag must not retroactively change
  // what an already-completed run says it started from), the terminal
  // result, the final simulated state, and the full trace. Distinct from
  // lastTrace/lastMode (which drive animation playback and stay as they
  // are) -- this is the complete record requirement 7 asked for, null in
  // Scenario Probe mode (which has no possession concept).
  lastRun: null,
};

function zoneFromPercent(x, y) {
  const column = Math.min(2, Math.max(0, Math.floor(x / (100 / 3))));
  const row = Math.min(3, Math.max(0, Math.floor(y / 25)));
  return row * 3 + column;
}

function rosterByRole() {
  const grouped = {};
  for (const entry of state.roster) {
    (grouped[entry.role] ||= []).push(entry);
  }
  return grouped;
}

function scenarioIsReady() {
  const grouped = rosterByRole();
  // role.count is the real declared minimum, including 0 for genuinely
  // optional roles (e.g. Free Kick's wall) -- do not clamp it to 1, that
  // silently turns "optional" into "required."
  return state.scenario.roles.every(
    (role) => (grouped[role.key] || []).length >= role.count,
  );
}

function currentModeIsReady() {
  return state.mode === "freeplay"
    ? Boolean(state.roster.find((entry) => entry.id === state.ball.ownerId))
    : scenarioIsReady();
}

// Scenario Probe has no ball-ownership concept at all -- every scenario's
// run() reads its own declared roles directly (byRole.attacker[0], etc),
// never state.ball.ownerId (confirmed by reading every scenario's run()
// above). "Whoever's the shooter" is whichever placed entry fills the
// scenario's own primary role, not whoever holds the ball -- whoever that
// bug's screenshot showed (ball icon on one player, "Attacker" on another)
// is exactly the confusion this exists to remove. Every current scenario
// declares either "attacker" or "receiver" as its actual first mover;
// falling back to whatever role is declared first covers any future one
// that uses neither without guessing.
function scenarioPrimaryRoleKey(scenario) {
  if (scenario.roles.some((role) => role.key === "attacker")) return "attacker";
  if (scenario.roles.some((role) => role.key === "receiver")) return "receiver";
  return scenario.roles[0]?.key || null;
}

function probePrimaryEntry() {
  const roleKey = scenarioPrimaryRoleKey(state.scenario);
  if (!roleKey) return null;
  return rosterByRole()[roleKey]?.[0] || null;
}

function runOnce(seed) {
  return state.mode === "freeplay"
    ? runConstructedPossession(seed)
    : runScenarioOnce(seed);
}

// --- Mode toggle -------------------------------------------------------

function setMode(mode) {
  state.mode = mode;
  elements.freePlayModeButton.setAttribute(
    "aria-selected",
    String(mode === "freeplay"),
  );
  elements.probeModeButton.setAttribute(
    "aria-selected",
    String(mode === "probe"),
  );
  elements.freePlayPanel.hidden = mode !== "freeplay";
  elements.probePanel.hidden = mode !== "probe";
  clearResults();
  refreshModePanel();
}

function refreshModePanel() {
  // Ownership controls/dimming/ball placement/"Shooter:" status all
  // depend on which mode is active -- both need a fresh render on every
  // mode switch, not just whichever panel's own content changed.
  renderRoster();
  renderPitch();
  if (state.mode === "freeplay") renderActionTable();
  else renderRoleRequirements();
  elements.playButton.disabled = !currentModeIsReady();
  elements.rerollButton.disabled = !currentModeIsReady();
}

elements.freePlayModeButton.addEventListener("click", () =>
  setMode("freeplay"),
);
elements.probeModeButton.addEventListener("click", () => setMode("probe"));

// --- Player search --------------------------------------------------------

let searchTimer = null;
elements.searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(runSearch, 260);
});
elements.databaseSelect.addEventListener("change", () => {
  state.database = elements.databaseSelect.value;
  runSearch();
});

async function loadDatabases() {
  try {
    const databases = (await getDatabases())
      .slice()
      .sort(
        (left, right) =>
          left.season_order - right.season_order ||
          left.title.localeCompare(right.title),
      );
    if (!databases.length)
      throw new Error("No converted databases are available.");
    elements.databaseSelect.innerHTML = databases
      .map(
        (database) =>
          `<option value="${database.slug}">${database.title}</option>`,
      )
      .join("");
    const latest = databases.reduce((best, database) =>
      database.season_order > best.season_order ? database : best,
    );
    state.database = latest.slug;
    elements.databaseSelect.value = state.database;
  } catch (error) {
    elements.searchStatus.textContent = `Could not load databases: ${error.message}`;
  }
}

async function runSearch() {
  const query = elements.searchInput.value.trim();
  if (query.length < 2 || !state.database) {
    elements.searchStatus.textContent = "Type at least 2 characters.";
    elements.searchResults.innerHTML = "";
    return;
  }
  elements.searchStatus.textContent = "Searching…";
  try {
    const result = await searchPlayers({
      database: state.database,
      q: query,
      pageSize: 20,
    });
    elements.searchStatus.textContent = result.items.length
      ? ""
      : "No players found.";
    elements.searchResults.innerHTML = result.items
      .map(
        (item, index) => `
      <li class="match-lab-search-result">
        <span>
          <span class="match-lab-search-result-name">${playerName(item)}</span><br>
          <span class="match-lab-search-result-meta">${item.position_text || item.role || ""} · CA ${item.current_ability ?? "?"}</span>
        </span>
        <button type="button" data-add-index="${index}">Add</button>
      </li>
    `,
      )
      .join("");
    elements.searchResults
      .querySelectorAll("[data-add-index]")
      .forEach((button) => {
        button.addEventListener("click", () =>
          addPlayer(result.items[Number(button.dataset.addIndex)]),
        );
      });
  } catch (error) {
    elements.searchStatus.textContent = `Search failed: ${error.message}`;
  }
}

async function addPlayer(candidate) {
  let player = candidate;
  try {
    const metrics = await getPlayerMetrics([candidate]);
    const metric = metrics.items?.[0];
    if (metric) player = { ...candidate, ...metric };
  } catch {
    // Falls back to CA-baseline attribute resolution if metrics are unavailable.
  }
  state.markerCounter += 1;
  // Free Play only ever needs "player" (a newly-added player is never
  // assumed to be the keeper -- see ROLE_LABELS' own comment); Probe
  // still fills whichever of the current scenario's declared role slots
  // is emptiest first, same as before.
  let defaultRoleKey = "player";
  if (state.mode === "probe") {
    const grouped = rosterByRole();
    const defaultRole = state.scenario.roles.find(
      (role) => (grouped[role.key] || []).length < role.count,
    );
    defaultRoleKey = defaultRole ? defaultRole.key : "candidate";
  }
  const x = 20 + Math.random() * 60;
  const y = 20 + Math.random() * 60;
  const isFirstPlayer = state.roster.length === 0;
  const entry = {
    id: `marker-${state.markerCounter}`,
    role: defaultRoleKey,
    team: "home",
    player,
    x,
    y,
    zone: zoneFromPercent(x, y),
  };
  state.roster.push(entry);
  if (isFirstPlayer && !state.ball.ownerId)
    giveBallTo(entry, { skipRender: true });
  stopPlayback();
  renderRoster();
  renderPitch();
  renderRoleRequirements();
  renderActionTable();
  updateInspector();
}

// --- Quick setup (2v2/3v3/5v5/7v7/9v9/11v11) --------------------------------
// Free-Play-only (forces the mode, same as clicking the tab): clears the
// current roster and fills both sides with genuinely random players --
// getDraftCandidates(), the same seeded random pool the draft flow
// itself already uses, not a fixed/curated list -- one real goalkeeper per
// side (fetched with positions:["GK"], so the keeper slot is filled by an
// actual keeper, never an outfielder standing in, and outfielders are
// filtered against isGoalkeeper() below so a natural keeper can't
// accidentally land an outfield slot either -- neither direction). A fresh
// seed every click, so repeated clicks of the same preset give a genuinely
// different matchup.
function ownGoalYFor(direction) {
  return direction === "up" ? 100 : 0;
}

function mergeMetrics(candidates, metricsPayload) {
  const byIdentity = new Map(
    (metricsPayload.items || []).map((item) => [
      `${item.database_slug}:${item.source_person_id}`,
      item,
    ]),
  );
  return candidates.map((candidate) => {
    const metric = byIdentity.get(
      `${candidate.database_slug}:${candidate.source_person_id}`,
    );
    return metric ? { ...candidate, ...metric } : candidate;
  });
}

// Formation composition (2026-08-19) -- explicit per-format role counts, as
// specified directly: every non-2v2/3v3 entry below is TWO numbers per role
// (2 defenders means 1 per team), always split evenly between the two
// sides. 2v2 has no room for a real D/M/A split (1 outfielder/team) so
// stays genuinely random, matching its original behavior exactly. 3v3 (2
// outfielders/team) keeps one attacker per team always -- even the
// smallest format keeps a real goal threat -- and a single shared coin
// flip decides whether the OTHER outfielder per team is a defender or a
// midfielder (applied once, not per team, so both sides get the same
// shape and neither is structurally favored).
function outfieldSlotsFor(perSide) {
  if (perSide === 2) return ["random", "random"];
  if (perSide === 3) {
    const shared = Math.random() < 0.5 ? "defender" : "midfielder";
    return ["attacker", "attacker", shared, shared];
  }
  // [defenders, midfielders, attackers], PER TEAM.
  const perTeam = { 5: [1, 2, 1], 7: [2, 2, 2], 9: [3, 3, 2], 11: [4, 4, 2] }[
    perSide
  ];
  if (!perTeam) return null;
  const [defenders, midfielders, attackers] = perTeam;
  return [
    ...Array(defenders * 2).fill("defender"),
    ...Array(midfielders * 2).fill("midfielder"),
    ...Array(attackers * 2).fill("attacker"),
  ];
}

// Depth from the player's OWN goal line, in percent -- mirrored below via
// ownGoalYFor() so it's correct for either attacking direction. Deliberate
// small gaps between bands (30-34, 60-62) keep them visually distinct
// rather than blurring into one continuous spread; "random" (2v2) keeps
// the ORIGINAL, unchanged [10,80] depth range this format has always used.
const OUTFIELD_BAND_DEPTH_RANGES = {
  defender: [12, 30],
  midfielder: [34, 60],
  attacker: [62, 85],
  random: [10, 80],
};

// Width distribution (2026-08-19) -- a reported bug: every outfielder's x
// was drawn fully independently (10 + random*80) regardless of how many
// OTHER players shared their band, so multiple defenders/midfielders/
// attackers on the same team had a real (birthday-paradox) chance of
// clustering in the same zone by pure chance, leaving whole flanks empty
// while a single small area got crowded -- exactly what was reported. Each
// player within a band now gets a distinct lateral channel (left-back,
// center-backs, right-back, etc, though not literally labeled as such) --
// the pitch width divided evenly by how many teammates share this band,
// with real jitter inside that channel so it still reads as organic
// placement, not a rigid grid. A lone player in their band (count<=1, e.g.
// 2v2's single "random" outfielder, or any band with just one per team)
// keeps the ORIGINAL fully-free spread -- channeling a group of one is
// meaningless.
function lateralChannelX(channel) {
  if (!channel || channel.count <= 1) return 10 + Math.random() * 80;
  const channelWidth = 100 / channel.count;
  const center = channelWidth * (channel.index + 0.5);
  const jitter = (Math.random() - 0.5) * channelWidth * 0.6;
  return Math.min(94, Math.max(6, center + jitter));
}

async function quickSetupMatch(perSide) {
  const buttons = document.querySelectorAll("[data-quick-setup]");
  buttons.forEach((button) => {
    button.disabled = true;
  });
  if (elements.quickSetupStatus)
    elements.quickSetupStatus.textContent = "Loading…";
  try {
    const slots = outfieldSlotsFor(perSide);
    if (!slots) throw new Error(`Unsupported format: ${perSide}v${perSide}.`);
    const outfieldNeeded = slots.length;
    const seed = Date.now() ^ Math.floor(Math.random() * 1_000_000);
    const candidateKey = (candidate) =>
      `${candidate.database_slug}:${candidate.source_person_id}`;
    const [gkPool, outfieldPool] = await Promise.all([
      getDraftCandidates({
        seed,
        perDatabase: 12,
        positions: ["GK"],
        minAbility: 110,
      }),
      // A generous multiplier, not just outfieldNeeded itself -- these get
      // BUCKETED into defender/midfielder/attacker groups below, so the
      // raw pool needs real headroom in every bucket, not just enough
      // bodies overall.
      getDraftCandidates({
        seed: seed + 1,
        perDatabase: Math.max(36, outfieldNeeded * 4),
        positions: [],
        minAbility: 110,
      }),
    ]);
    const gkKeys = new Set();
    const gkCandidates = [];
    for (const candidate of gkPool.items) {
      const key = candidateKey(candidate);
      if (gkKeys.has(key)) continue;
      gkKeys.add(key);
      gkCandidates.push(candidate);
      if (gkCandidates.length >= 2) break;
    }
    if (gkCandidates.length < 2) {
      throw new Error(
        "Not enough players available for this format -- try again or pick a smaller one.",
      );
    }
    // Real outfielders only: never the same real player used twice (against
    // the keeper pool above, or a duplicate within this pool itself), and
    // never a natural keeper standing in for an outfield slot -- the other
    // half of "do not put outfielders as GKs or vice versa."
    const seenKeys = new Set(gkKeys);
    const outfieldPoolClean = [];
    for (const candidate of outfieldPool.items) {
      const key = candidateKey(candidate);
      if (seenKeys.has(key) || isGoalkeeper(candidate)) continue;
      seenKeys.add(key);
      outfieldPoolClean.push({
        candidate,
        band: classifyOutfieldBand(candidate),
      });
    }
    function takeForBand(band, count, assignedKeys) {
      const taken = [];
      for (const item of outfieldPoolClean) {
        if (taken.length >= count) break;
        const key = candidateKey(item.candidate);
        if (assignedKeys.has(key)) continue;
        if (band !== "random" && item.band !== band) continue;
        assignedKeys.add(key);
        taken.push(item.candidate);
      }
      return taken;
    }
    const neededCounts = slots.reduce((acc, band) => {
      acc[band] = (acc[band] || 0) + 1;
      return acc;
    }, {});
    const assignedKeys = new Set();
    const drawnByBand = {};
    for (const [band, count] of Object.entries(neededCounts)) {
      drawnByBand[band] = takeForBand(band, count, assignedKeys);
      if (drawnByBand[band].length < count) {
        throw new Error(
          "Not enough players available for this format -- try again or pick a smaller one.",
        );
      }
    }
    // Split each band evenly (every count above is even by construction --
    // outfieldSlotsFor() only ever builds N*2 per band), then flatten into
    // one ordered list per side, remembering which band each entry came
    // from for placement below, AND this player's own index/count within
    // that band on their OWN team -- see lateralChannelX()'s own comment
    // on why (a reported bug: several same-band players landing in the
    // same zone by pure chance, leaving whole flanks empty).
    const homeOutfield = [];
    const awayOutfield = [];
    const homeBands = [];
    const awayBands = [];
    const homeChannels = [];
    const awayChannels = [];
    for (const [band, list] of Object.entries(drawnByBand)) {
      const half = list.length / 2;
      homeOutfield.push(...list.slice(0, half));
      awayOutfield.push(...list.slice(half));
      homeBands.push(...Array(half).fill(band));
      awayBands.push(...Array(half).fill(band));
      for (let index = 0; index < half; index += 1) {
        homeChannels.push({ index, count: half });
        awayChannels.push({ index, count: half });
      }
    }

    const allCandidates = [...gkCandidates, ...homeOutfield, ...awayOutfield];
    let enriched = allCandidates;
    try {
      const metrics = await getPlayerMetrics(allCandidates);
      enriched = mergeMetrics(allCandidates, metrics);
    } catch {
      // Falls back to CA-baseline attribute resolution, same as addPlayer().
    }
    const [homeKeeperPlayer, awayKeeperPlayer] = enriched.slice(0, 2);
    const homeOutfieldPlayers = enriched.slice(2, 2 + homeOutfield.length);
    const awayOutfieldPlayers = enriched.slice(2 + homeOutfield.length);

    state.roster = [];
    state.ball.ownerId = null;
    state.markerCounter = 0;
    // Placement: each band gets its OWN depth range (defenders deep,
    // midfielders central, attackers advanced), mirrored for whichever
    // goal this team actually defends right now (state.attackingDirection)
    // -- a reasonable starting SHAPE for a possession runner, not an
    // authored tactical formation with real width/channel assignments.
    function place(player, team, { keeper, band = "random", channel = null }) {
      state.markerCounter += 1;
      const direction = state.attackingDirection[team];
      const nearOwnGoal = ownGoalYFor(direction) === 0;
      const x = keeper ? 45 + Math.random() * 10 : lateralChannelX(channel);
      let y;
      if (keeper) {
        y = nearOwnGoal ? 3 + Math.random() * 6 : 91 + Math.random() * 6;
      } else {
        const [lo, hi] =
          OUTFIELD_BAND_DEPTH_RANGES[band] || OUTFIELD_BAND_DEPTH_RANGES.random;
        const depth = lo + Math.random() * (hi - lo);
        y = nearOwnGoal ? depth : 100 - depth;
      }
      const entry = {
        id: `marker-${state.markerCounter}`,
        role: keeper ? "keeper" : "player",
        team,
        player,
        x,
        y,
        zone: zoneFromPercent(x, y),
      };
      state.roster.push(entry);
      return entry;
    }
    place(homeKeeperPlayer, "home", { keeper: true });
    place(awayKeeperPlayer, "away", { keeper: true });
    const homeEntries = homeOutfieldPlayers.map((player, index) =>
      place(player, "home", {
        keeper: false,
        band: homeBands[index],
        channel: homeChannels[index],
      }),
    );
    awayOutfieldPlayers.forEach((player, index) =>
      place(player, "away", {
        keeper: false,
        band: awayBands[index],
        channel: awayChannels[index],
      }),
    );
    if (homeEntries.length) giveBallTo(homeEntries[0], { skipRender: true });

    // setMode() itself calls clearResults() (stops playback, clears the
    // trace) and refreshModePanel() (re-renders the roster/pitch/action
    // table for the now-active Free Play mode) -- only resetTouchTrail()
    // and updateInspector() aren't already covered by that.
    setMode("freeplay");
    resetTouchTrail();
    updateInspector();
    if (elements.quickSetupStatus)
      elements.quickSetupStatus.textContent = `${perSide}v${perSide} ready.`;
  } catch (error) {
    if (elements.quickSetupStatus)
      elements.quickSetupStatus.textContent = `Quick setup failed: ${error.message}`;
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
    });
  }
}

document.querySelectorAll("[data-quick-setup]").forEach((button) => {
  button.addEventListener("click", () => {
    const perSide = Number(button.dataset.quickSetup);
    if (perSide > 0) quickSetupMatch(perSide);
  });
});

// --- Ball ownership ---------------------------------------------------

function giveBallTo(entry, { skipRender = false } = {}) {
  state.ball.ownerId = entry.id;
  state.ball.x = entry.x;
  state.ball.y = entry.y;
  state.ball.zone = entry.zone;
  if (!skipRender) {
    renderPitch();
    renderRoster();
    renderActionTable();
    updateInspector();
  }
}

// --- Pitch + markers --------------------------------------------------------

// The RENDERING-layer twin of runConstructedPossession()'s simulatedRoster
// (see that function's own header comment) -- authoritative RESOLVED
// player positions, keyed by roster id, for the playback controller to
// read instead of the authored state.roster. Two are needed because they
// answer different questions: simulatedRoster is resolution's memory
// (computed once, ahead of any rendering); playbackPositions is
// playback's memory (advances incrementally, in step with the visible
// marker, across Step/Play/Replay). Before this existed,
// applyStepAnimation()'s duel/contest nudge read state.roster directly --
// stale the moment a real advance had already moved a marker past its
// authored spot, which pulled the marker back toward its start before the
// next advance moved it forward again (a real, reported browser bug; see
// MATCH_LAB_PLAN.md, "Possession Runner v1 -- Pass 1.1").
//
// Strict split, by design: this map is updated ONLY when a trace event
// carries genuine, resolver-produced movement for its actor (a successful
// dribble's real advance, today's only such case -- see
// applyStepAnimation()). Cosmetic reactions -- closing down, a duel lean,
// a beaten defender's lunge -- are a transient visual offset
// (applyCosmeticOffset()) that never writes here and never touches a
// marker's own logical --marker-x/--marker-y. Blurring that line would
// let ordinary animation flourish quietly become "resolved" positions no
// resolver ever produced -- exactly the kind of invented state this
// project has held the line against everywhere else (see e.g.
// oneOnOneDecision.js's perceived/actual split, or missPointFor()'s
// "animation must consume resolver data, never invent it").
let playbackPositions = {};
// Tracks whichever owner id the label-visibility pass most recently used
// (renderPitch()'s static setup, or renderPlaybackFrame()'s own sampled
// owner track) -- the #labShowLabelsCheckbox toggle reads this directly so
// it reflects labels correctly regardless of whether playback is running,
// paused, or hasn't started yet, without re-deriving ownership from
// scratch or importing a whole extra sampling function just for this.
let currentLabelOwnerId = null;

function seedPlaybackPositions() {
  playbackPositions = {};
  for (const rosterEntry of state.roster)
    playbackPositions[rosterEntry.id] = pointOf(rosterEntry);
}

// Falls back to the authored roster only as defensive insurance (e.g. a
// lookup that somehow runs before the very first renderPitch() seeds this
// map) -- every real playback path already guarantees this map is fresh,
// since renderPitch() (called at Resolve & Play/New Outcome/Replay/Back
// to Setup, and at every roster edit) reseeds it every single time.
function playbackPointFor(id) {
  if (playbackPositions[id]) return playbackPositions[id];
  const entry = state.roster.find((item) => item.id === id);
  return entry ? pointOf(entry) : null;
}

function renderPitch() {
  seedPlaybackPositions();
  elements.pitch
    .querySelectorAll(".match-lab-marker")
    .forEach((node) => node.remove());
  const inProbe = state.mode === "probe";
  const scenarioRoleKeys = inProbe
    ? new Set(state.scenario.roles.map((role) => role.key))
    : null;
  // Probe has no ball-ownership concept -- the ⚽ label suffix and the
  // owner-follows-drag wiring below are Free Play-only concerns; showing
  // them in Probe implied ball possession meant something there when the
  // scenario never reads it at all (see scenarioPrimaryRoleKey()).
  const describeLabel = (entry) =>
    `${playerName(entry.player)} · Z${entry.zone}${!inProbe && entry.id === state.ball.ownerId ? " ⚽" : ""}`;
  const probeEntry = inProbe ? probePrimaryEntry() : null;
  const labelOwnerId = inProbe ? (probeEntry?.id ?? null) : state.ball.ownerId;
  currentLabelOwnerId = labelOwnerId;
  for (const entry of state.roster) {
    const marker = document.createElement("div");
    marker.className = "match-lab-marker";
    marker.dataset.role = entry.role;
    marker.dataset.team = entry.team;
    marker.dataset.id = entry.id;
    marker.dataset.unused = String(
      inProbe && !scenarioRoleKeys.has(entry.role),
    );
    marker.dataset.labelVisible = String(
      labelVisibleFor(entry.id, labelOwnerId),
    );
    marker.style.setProperty("--marker-x", `${entry.x}%`);
    marker.style.setProperty("--marker-y", `${entry.y}%`);
    marker.innerHTML = `
      <span class="match-lab-marker-dot">${initials(playerName(entry.player))}</span>
      <span class="match-lab-marker-label">${describeLabel(entry)}</span>
    `;
    marker.addEventListener("pointerdown", (event) =>
      startDrag(
        event,
        entry,
        () => describeLabel(entry),
        () => {
          // Dragging a player who owns the ball carries the ball with them
          // -- Free Play only; Probe positions the ball off the scenario's
          // own primary-role entry instead (see below).
          if (!inProbe && entry.id === state.ball.ownerId) {
            state.ball.x = entry.x;
            state.ball.y = entry.y;
            state.ball.zone = entry.zone;
            setMarkerPosition("ball", entry.x, entry.y, { animate: false });
            setBallRestOffset(
              restingBallOffsetPx(
                entry,
                state.attackingDirection[entry.team],
                entry.role,
              ),
            );
          } else if (
            inProbe &&
            entry.role === scenarioPrimaryRoleKey(state.scenario)
          ) {
            setMarkerPosition("ball", entry.x, entry.y, { animate: false });
            setBallRestOffset(
              restingBallOffsetPx(
                entry,
                state.attackingDirection[entry.team],
                entry.role,
              ),
            );
          }
        },
      ),
    );
    elements.pitch.appendChild(marker);
  }

  const ballMarker = document.createElement("div");
  ballMarker.className = "match-lab-marker match-lab-marker-ball";
  ballMarker.dataset.id = "ball";
  // Probe: the ball is drawn at whichever placed entry fills the
  // scenario's own primary role (its actual shooter/receiver), never
  // state.ball.x/y -- that field is a Free Play-only concept the scenario
  // itself never reads. Hidden entirely if that role isn't filled yet
  // (nothing to honestly place it at). probeEntry itself is computed once,
  // above, and reused for the label pass too.
  const ballVisible = !inProbe || Boolean(probeEntry);
  const freePlayOwner = !inProbe
    ? state.roster.find((entry) => entry.id === state.ball.ownerId)
    : null;
  // Ball independence, visually (2026-08-19) -- the marker's own logical
  // x/y stays exactly on the controlling entry (concentric with their
  // dot); restingBallOffsetPx() below is what actually pushes the ball to
  // their outer edge, in real screen pixels, not percent (see that
  // function's own comment).
  const primaryEntry = inProbe ? probeEntry : freePlayOwner;
  const ballPoint = primaryEntry || state.ball;
  const restOffset = primaryEntry
    ? restingBallOffsetPx(
        primaryEntry,
        state.attackingDirection[primaryEntry.team],
        primaryEntry.role,
      )
    : { x: 0, y: 0 };
  ballMarker.dataset.held = String(
    Boolean(freePlayOwner && freePlayOwner.role === "keeper"),
  );
  ballMarker.style.setProperty("--marker-x", `${ballPoint.x}%`);
  ballMarker.style.setProperty("--marker-y", `${ballPoint.y}%`);
  ballMarker.style.setProperty("--ball-rest-x", `${restOffset.x}px`);
  ballMarker.style.setProperty("--ball-rest-y", `${restOffset.y}px`);
  ballMarker.hidden = !ballVisible;
  updateVisionCone(primaryEntry);
  ballMarker.innerHTML = `
    <span class="match-lab-marker-dot" aria-hidden="true"></span>
  `;
  if (!inProbe) {
    ballMarker.addEventListener("pointerdown", (event) =>
      startDrag(event, state.ball, null, () => {
        // Manually dragging the ball away detaches it -- a loose ball, not
        // still-owned-but-elsewhere.
        if (state.ball.ownerId) {
          state.ball.ownerId = null;
          renderRoster();
          renderActionTable();
        }
      }),
    );
  }
  elements.pitch.appendChild(ballMarker);
  renderProbeShooterStatus();
}

// "Shooter: <name>" (or "Receiver: <name>" etc, matching the scenario's
// own primary role) -- the plain-text confirmation that the visually
// placed ball above genuinely corresponds to who the scenario will treat
// as its shooter, not a guess the user has to make from role dropdowns.
function renderProbeShooterStatus() {
  if (!elements.probeShooterStatus) return;
  if (state.mode !== "probe") {
    elements.probeShooterStatus.textContent = "";
    return;
  }
  const roleKey = scenarioPrimaryRoleKey(state.scenario);
  const entry = probePrimaryEntry();
  const roleLabel = roleKey ? ROLE_LABELS[roleKey] || roleKey : "Shooter";
  elements.probeShooterStatus.textContent = entry
    ? `${roleLabel}: ${playerName(entry.player)}`
    : `${roleLabel}: none placed yet`;
}

function initials(name) {
  return name
    .split(/\s+/)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

// --- Animation v0: marker movement --------------------------------------
// setMarkerPosition() generalizes what startDrag() already does (targeted
// custom-property mutation on an existing node) with an animate flag drag
// never sets. Must never call renderPitch() mid-sequence -- a freshly
// rebuilt node has no "old" left/top to transition from, so playback would
// jump instead of animate.
function markerNode(id) {
  return elements.pitch.querySelector(`[data-id="${id}"]`);
}

function setMarkerPosition(
  id,
  x,
  y,
  { animate = false, duration = DEFAULT_DURATION } = {},
) {
  const node = markerNode(id);
  if (!node) return;
  node.style.setProperty("--marker-duration", `${duration}ms`);
  node.dataset.animating = String(animate);
  node.style.setProperty("--marker-x", `${x}%`);
  node.style.setProperty("--marker-y", `${y}%`);
}

// Ball independence, visually (2026-08-19) -- a real browser round reported
// the ball marker reading as "inside the player circle," most visible right
// at a possession change (a tackle won at close range moved the ball only a
// few PERCENT of pitch width/length, invisible next to a fixed 22px player
// dot). --marker-x/y stays exactly on the controlling player -- concentric
// with their own dot -- and this fixed PIXEL nudge (see styles.css's own
// comment on --ball-rest-x/y) does 100% of the visual separation instead,
// so it clears the same real 22px circle regardless of how large the pitch
// happens to be rendered at any given viewport width.
//
// Direction (2026-08-19 fix) -- a first version borrowed
// controlledBallPosition()'s own static-fallback direction (velocity-based
// in motion, attackingDirection-based at rest), but that fallback is
// deliberately axis-only for ITS purpose (a single dribble touch's forward
// nudge, matchBallCore.js's own concern) -- reused here, it made the ball
// move ONLY vertically on every possession change regardless of where the
// two players actually stood, which read as mechanical/buggy (reported
// directly). Computed fresh here instead: a real 2D vector from the
// player's own position toward the CENTER of the goal they're attacking --
// varies by where the player actually is (a wide player's vector angles
// sharply inward, a central player's stays close to vertical), not just by
// which team they're on.
const RESTING_BALL_OFFSET_PX = 18;
function restingBallOffsetPx(ownerPoint, attackingDirection, ownerRole) {
  // Goalkeepers holding it, and any ball genuinely in the air (a header is
  // contested at head height, directly on the player, not off to one side)
  // are both real exceptions, not oversights -- see this function's own
  // callers, which only ever invoke it for a ball at an outfield player's
  // feet in the first place.
  if (!ownerPoint || ownerRole === "keeper") return { x: 0, y: 0 };
  const goalY = attackingDirection === "up" ? 0 : 100;
  const dx = 50 - ownerPoint.x;
  const dy = goalY - ownerPoint.y;
  const length = Math.hypot(dx, dy) || 1;
  return {
    x: (dx / length) * RESTING_BALL_OFFSET_PX,
    y: (dy / length) * RESTING_BALL_OFFSET_PX,
  };
}

function setBallRestOffset({ x, y }) {
  const node = markerNode("ball");
  if (!node) return;
  node.style.setProperty("--ball-rest-x", `${x}px`);
  node.style.setProperty("--ball-rest-y", `${y}px`);
}

// Vision cone (2026-08-19) -- a real browser round asked directly for a
// toggled field-of-view overlay for the current ball owner, scaled by
// their own Vision rating (1-20 in this database): a higher rating covers
// a genuinely bigger area (both a wider angle AND a longer reach), and
// when possession moves on, the outgoing owner's own picture of the pitch
// fades away over time rather than vanishing instantly -- slower for a
// higher-Vision player, faster for a lower one. Pure geometry/scaling
// here, same "reasonable, round, not clinically calibrated" philosophy as
// every other v1 heuristic in this project. This is a diagnostic/
// explanatory overlay only -- nothing here is ever read by a resolver or
// a decision function; it never influences which pass gets chosen or how
// it resolves, only what the browser round can SEE about why.
const VISION_CONE_MIN_RADIUS_YARDS = 25;
const VISION_CONE_MAX_RADIUS_YARDS = 60;
const VISION_CONE_MIN_HALF_ANGLE_DEG = 20;
const VISION_CONE_MAX_HALF_ANGLE_DEG = 60;
const VISION_FADE_MIN_MS = 500;
const VISION_FADE_MAX_MS = 3000;

function visionQuality(player) {
  return clamp(0, 1, (playerAttribute(player, "Vision") - 1) / 19);
}
function visionConeRadiusYards(player) {
  return (
    VISION_CONE_MIN_RADIUS_YARDS +
    visionQuality(player) *
      (VISION_CONE_MAX_RADIUS_YARDS - VISION_CONE_MIN_RADIUS_YARDS)
  );
}
function visionConeHalfAngleRad(player) {
  const degrees =
    VISION_CONE_MIN_HALF_ANGLE_DEG +
    visionQuality(player) *
      (VISION_CONE_MAX_HALF_ANGLE_DEG - VISION_CONE_MIN_HALF_ANGLE_DEG);
  return (degrees * Math.PI) / 180;
}
function visionFadeDurationMs(player) {
  return (
    VISION_FADE_MIN_MS +
    visionQuality(player) * (VISION_FADE_MAX_MS - VISION_FADE_MIN_MS)
  );
}

// A real SVG pie-slice path in the SAME 75x120-yard coordinate space the
// touch/trail layers already draw into (see styles.css's own comment on
// why -- undistorted angles, not stretched by the pitch's own non-square
// aspect ratio). Direction is the same "toward the center of the goal
// being attacked" convention restingBallOffsetPx() uses, computed fresh
// here in real yard-space (not reused from that function directly -- an
// ANGLE needs true yard proportions, not a percent-space unit vector,
// which the pitch's non-square aspect ratio would otherwise distort),
// plus an optional scanOffsetRadians (scanOffsetRad()'s own output) added
// on top -- see that function's comment for what actually drives it.
function buildVisionConePath(
  ownerPoint,
  attackingDirection,
  player,
  scanOffsetRadians = 0,
) {
  const originYard = {
    x: (ownerPoint.x / 100) * PITCH_WIDTH_YARDS,
    y: (ownerPoint.y / 100) * PITCH_LENGTH_YARDS,
  };
  const goalY = attackingDirection === "up" ? 0 : PITCH_LENGTH_YARDS;
  const baseAngle =
    Math.atan2(goalY - originYard.y, PITCH_WIDTH_YARDS / 2 - originYard.x) +
    scanOffsetRadians;
  const halfAngle = visionConeHalfAngleRad(player);
  const radius = visionConeRadiusYards(player);
  const leftAngle = baseAngle - halfAngle;
  const rightAngle = baseAngle + halfAngle;
  const left = {
    x: originYard.x + Math.cos(leftAngle) * radius,
    y: originYard.y + Math.sin(leftAngle) * radius,
  };
  const right = {
    x: originYard.x + Math.cos(rightAngle) * radius,
    y: originYard.y + Math.sin(rightAngle) * radius,
  };
  const largeArcFlag = halfAngle * 2 > Math.PI ? 1 : 0;
  return `M ${originYard.x} ${originYard.y} L ${left.x} ${left.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${right.x} ${right.y} Z`;
}

// Scanning (2026-08-19) -- a real browser round asked directly for this,
// naming Riquelme/Ronaldinho/Pirlo: elite Vision/Decisions players don't
// hold one fixed gaze -- they check their shoulder before the ball even
// arrives, and keep sweeping their head while they're on it, reading
// support runs, runs in behind, and an approaching opponent. Both
// Vision AND Decisions drive it (named together explicitly), not Vision
// alone -- seeing an option and actually recognizing it's worth checking
// are treated as one combined "reading" quality, the same pairing
// lineBreakingScore()/attackingHeadStartSeconds() already use elsewhere
// in this project for a comparable "reads the game early" trait.
// Amplitude scales continuously with quality (a weak scanner's cone still
// technically sweeps, just imperceptibly) rather than a hard on/off gate,
// matching every other attribute-scaled heuristic this session -- the
// one deliberate exception is the ANTICIPATION cone below, which DOES
// gate entirely, because "scans before it even arrives" reads as a
// genuinely distinctive trait of the named players, not a universal one.
const SCAN_MAX_AMPLITUDE_DEG = 45;
const SCAN_MIN_PERIOD_MS = 900;
const SCAN_MAX_PERIOD_MS = 2600;
const ANTICIPATION_SCAN_THRESHOLD = 0.55;

function scanQuality(player) {
  const vision = playerAttribute(player, "Vision");
  const decisions = playerAttribute(player, "Decisions");
  return clamp(0, 1, ((vision + decisions) / 2 - 1) / 19);
}
function scanAmplitudeRad(player) {
  return (SCAN_MAX_AMPLITUDE_DEG * scanQuality(player) * Math.PI) / 180;
}
function scanPeriodMs(player) {
  // Higher quality -> FASTER, more frequent checks (a sharper player scans
  // more often, not more slowly) -- inverted from amplitude's own scale.
  return (
    SCAN_MAX_PERIOD_MS -
    scanQuality(player) * (SCAN_MAX_PERIOD_MS - SCAN_MIN_PERIOD_MS)
  );
}
// A smooth back-and-forth sweep, driven by the SAMPLED playback clock
// (timeMs) rather than wall-clock time -- keeps this cosmetic-only
// animation's phase tied to playback position (pausing genuinely pauses
// it, Replay reproduces the identical sweep), never real elapsed browser
// time. Amplitude 0 (a non-scanning player) always returns exactly 0,
// not an imperceptibly-tiny sine wave -- a real, checkable "off" state.
function scanOffsetRad(player, timeMs) {
  const amplitude = scanAmplitudeRad(player);
  if (amplitude <= 0.0001) return 0;
  const period = scanPeriodMs(player);
  return Math.sin((timeMs / period) * Math.PI * 2) * amplitude;
}

// Tracks whichever player the vision layer's own #labVisionConeCurrent
// path currently represents, so a genuine ownership change can park that
// EXACT shape into #labVisionConeFading (frozen at the outgoing owner's
// last real position/direction) before replacing it, and so the fade-out
// duration can use the OUTGOING owner's own Vision, never the incoming
// one's.
let currentVisionOwnerId = null;
let currentVisionOwnerPlayer = null;
function updateVisionCone(ownerEntry, timeMs = 0) {
  const currentNode = elements.visionConeCurrent;
  const fadingNode = elements.visionConeFading;
  if (!currentNode || !fadingNode) return;
  const ownerId = ownerEntry?.id ?? null;
  if (ownerId !== currentVisionOwnerId) {
    const previousD = currentNode.getAttribute("d");
    if (previousD && currentVisionOwnerPlayer) {
      fadingNode.style.setProperty(
        "--vision-fade-ms",
        `${visionFadeDurationMs(currentVisionOwnerPlayer)}ms`,
      );
      fadingNode.setAttribute("d", previousD);
      // Snap to fully visible synchronously, THEN fade to 0 on the next
      // frame -- a CSS transition only animates a change it can observe
      // across a real frame boundary; writing both values in the same
      // tick would just coalesce to "already 0," never animating at all.
      fadingNode.style.opacity = "1";
      requestAnimationFrame(() => {
        fadingNode.style.opacity = "0";
      });
    }
    currentVisionOwnerId = ownerId;
    currentVisionOwnerPlayer = ownerEntry?.player ?? null;
  }
  currentNode.setAttribute(
    "d",
    ownerEntry
      ? buildVisionConePath(
          ownerEntry,
          state.attackingDirection[ownerEntry.team],
          ownerEntry.player,
          scanOffsetRad(ownerEntry.player, timeMs),
        )
      : "",
  );
}

// The anticipation cone -- "before the ball comes to them." Shown ONLY
// while the ball is genuinely still in flight toward this specific
// receiver (never once they've actually taken control -- at that instant
// updateVisionCone() above takes over identically) AND their own combined
// Vision/Decisions quality clears ANTICIPATION_SCAN_THRESHOLD -- a real,
// named trait of a specific caliber of player, not something every
// receiver does. A simple opacity toggle, not a multi-stage fade
// sequence like the outgoing-owner memory above -- the moment they
// actually receive it, this cone and the CURRENT cone occupy the exact
// same spot, so there is nothing visually jarring left for a fade to
// smooth over.
function updateAnticipationCone(receiverEntry, timeMs) {
  const node = elements.visionConeAnticipating;
  if (!node) return;
  if (
    !receiverEntry ||
    scanQuality(receiverEntry.player) < ANTICIPATION_SCAN_THRESHOLD
  ) {
    node.style.opacity = "0";
    return;
  }
  node.setAttribute(
    "d",
    buildVisionConePath(
      receiverEntry,
      state.attackingDirection[receiverEntry.team],
      receiverEntry.player,
      scanOffsetRad(receiverEntry.player, timeMs),
    ),
  );
  node.style.opacity = "1";
}

// Label decluttering (2026-08-19) -- a real browser round asked directly
// for a toggle to manage a crowded roster's labels, defaulting to "only
// the current ball owner's label is open," fading away the instant
// ownership moves on. #labShowLabelsCheckbox (state.showAllLabels)
// overrides this and keeps every label visible unconditionally. The fade
// itself is pure CSS (opacity + transition on [data-label-visible] --
// see styles.css's own comment); this only ever writes the data
// attribute, once per marker, whenever the relevant owner id changes.
function labelVisibleFor(entryId, ownerId) {
  return state.showAllLabels || entryId === ownerId;
}
function updateLabelVisibility(ownerId) {
  currentLabelOwnerId = ownerId;
  for (const entry of state.roster) {
    const node = markerNode(entry.id);
    if (node)
      node.dataset.labelVisible = String(labelVisibleFor(entry.id, ownerId));
  }
}

// The one arithmetic rule every animated marker move goes through --
// travel is capped and always toward an existing, real point (another
// entry's position, a midpoint of two entries, or a zone center), never
// extrapolated past it. This is what keeps "small receiver movement" and
// "engaging defender movement" from becoming actual off-ball AI: nothing
// here decides *where a player should run to* in any tactical sense, it
// only nudges toward a point the event already names.
function nudgeToward(entry, target, fraction, capPercent) {
  const dx = target.x - entry.x;
  const dy = target.y - entry.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return { x: entry.x, y: entry.y };
  const travel = Math.min(distance * fraction, capPercent);
  const ratio = travel / distance;
  return { x: entry.x + dx * ratio, y: entry.y + dy * ratio };
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

// Cosmetic-only reaction (closing down, a duel lean, a beaten defender's
// lunge) -- reuses nudgeToward()'s exact same math (same "never
// extrapolate past a real point" guarantee), but applies the result as a
// transient CSS `translate` offset on the marker's inner dot instead of
// writing it to the marker's own logical --marker-x/--marker-y. That's
// the whole point: this can never become an authoritative position no
// resolver produced (see playbackPositions's own header comment) --
// data-cosmetic's keyframe (styles.css) animates out to this offset and
// explicitly back to (0,0) before it ends, so nothing is left for the
// next step to build on.
function applyCosmeticOffset(
  id,
  fromPoint,
  towardPoint,
  fraction,
  capPercent,
  duration,
) {
  const node = markerNode(id);
  if (!node) return;
  const nudged = nudgeToward(fromPoint, towardPoint, fraction, capPercent);
  const rect = elements.pitch.getBoundingClientRect();
  const dx = ((nudged.x - fromPoint.x) / 100) * rect.width;
  const dy = ((nudged.y - fromPoint.y) / 100) * rect.height;
  node.style.setProperty("--cosmetic-x", `${dx}px`);
  node.style.setProperty("--cosmetic-y", `${dy}px`);
  node.style.setProperty("--cosmetic-duration", `${duration}ms`);
  node.dataset.cosmetic = "true";
  activeEffectNodes.push(node);
}

// --- Curved shot trail (strikingFoot/contactType -> visible bend) -------
// The direction/magnitude below are read straight off the stored trace
// event (strikingFoot/contactType, set once by selectStrikeMechanics() at
// resolution time) -- never re-decided here. That's what makes Replay
// reproduce the identical curve every time: it re-renders the same stored
// event, so this always computes the same control point from it.
const CURVE_MAGNITUDE = { inside: 0.22, outside: 0.22, laces: 0.05 };

// Control point for a quadratic bezier from ballFrom to ballTo, offset
// perpendicular to the shot by a signed fraction of the shot's own
// distance. The perpendicular used is the striker's OWN right-hand side as
// they face the target -- not a fixed screen direction -- so this reads
// correctly regardless of which way the shot is actually aimed. Verified
// against the worked example (a striker facing "down" the pitch, i.e.
// dx=0/dy>0): this resolves to screen-right, matching how a real strike's
// curl direction reads on a top-down/broadcast-style view.
function curveControlPoint(ballFrom, ballTo, strikingFoot, contactType) {
  const mid = midpoint(ballFrom, ballTo);
  if (!strikingFoot || !contactType) return mid;
  const dx = ballTo.x - ballFrom.x;
  const dy = ballTo.y - ballFrom.y;
  const distance = Math.hypot(dx, dy);
  if (distance === 0) return mid;
  const rightX = dy / distance;
  const rightY = -dx / distance;
  const magnitude = CURVE_MAGNITUDE[contactType] ?? 0;
  if (magnitude === 0) return mid;
  const directionSign =
    (strikingFoot === "right" ? 1 : -1) * (contactType === "outside" ? -1 : 1);
  const offset = magnitude * directionSign * distance;
  return { x: mid.x + rightX * offset, y: mid.y + rightY * offset };
}

function quadraticBezierPoint(p0, p1, p2, t) {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * p1.x + t * t * p2.x,
    y: u * u * p0.y + 2 * u * t * p1.y + t * t * p2.y,
  };
}

// Percentage (0-100, the coordinate system every other pitch element uses)
// -> yards, matching .ml-pitch-trail-layer's viewBox="0 0 75 120".
function toTrailPoint(point) {
  return `${((point.x / 100) * 75).toFixed(2)},${((point.y / 100) * 120).toFixed(2)}`;
}

let trailFadeTimer = null;

function hideTrail() {
  clearTimeout(trailFadeTimer);
  trailFadeTimer = null;
  if (elements.trailPath) elements.trailPath.dataset.visible = "false";
}

function showTrail(ballFrom, controlPoint, ballTo) {
  if (!elements.trailPath) return;
  clearTimeout(trailFadeTimer);
  elements.trailPath.setAttribute(
    "d",
    `M ${toTrailPoint(ballFrom)} Q ${toTrailPoint(controlPoint)} ${toTrailPoint(ballTo)}`,
  );
  elements.trailPath.dataset.visible = "true";
}

// --- Ball-owner touch path -------------------------------------------------
// A separate, ACCUMULATING record of every real touch on the ball across
// the currently displayed trace -- not the single-shot curved trail above
// (that one is cleared/redrawn per event; this one only resets at the
// start of a fresh Play/Reroll/Replay/Reset, see those handlers). A
// "touch" is honestly whatever the engine's own trace already says it is:
// any event carrying a real ballFrom -- no invented intermediate touches
// (a single carry/dribble action is genuinely ONE resolved touch in this
// engine today, even though a real player would take several; showing
// that plainly, not smoothing it away, is the whole point of this
// feature -- see MATCH_LAB_PLAN.md). Toggled by #labShowTouchesCheckbox;
// keeps recording regardless of the checkbox state, so checking it mid-
// playback immediately reveals the full history so far, not just future
// touches.
let touchPoints = [];

function resetTouchTrail() {
  touchPoints = [];
  renderTouchTrail();
}

function renderTouchTrail() {
  if (!elements.touchLayer) return;
  const visible = Boolean(
    elements.showTouchesCheckbox && elements.showTouchesCheckbox.checked,
  );
  elements.touchLayer.dataset.visible = String(visible);
  if (!visible) return;
  if (elements.touchLine) {
    elements.touchLine.setAttribute(
      "d",
      touchPoints.length
        ? `M ${touchPoints.map(toTrailPoint).join(" L ")}`
        : "",
    );
  }
  if (elements.touchMarks) {
    const markSize = 0.9; // yards, in the same 75x120 viewBox as toTrailPoint()
    elements.touchMarks.innerHTML = touchPoints
      .map((point) => {
        const cx = (point.x / 100) * 75;
        const cy = (point.y / 100) * 120;
        return `<path class="ml-pitch-touch-mark" d="M ${(cx - markSize).toFixed(2)},${(cy - markSize).toFixed(2)} L ${(cx + markSize).toFixed(2)},${(cy + markSize).toFixed(2)} M ${(cx - markSize).toFixed(2)},${(cy + markSize).toFixed(2)} L ${(cx + markSize).toFixed(2)},${(cy - markSize).toFixed(2)}"></path>`;
      })
      .join("");
  }
}

// Only ever called from applyStepAnimation() -- never from clearStepEffects()
// itself, which runs on every single step to clear transient per-step
// effects; recording touches there would wipe this on every step instead
// of letting it accumulate across a whole playback.
function recordTouch(point) {
  if (!point) return;
  const last = touchPoints[touchPoints.length - 1];
  if (last && last.x === point.x && last.y === point.y) return;
  touchPoints.push({ x: point.x, y: point.y });
  renderTouchTrail();
}

if (elements.showTouchesCheckbox) {
  elements.showTouchesCheckbox.addEventListener("change", renderTouchTrail);
}

if (elements.showLabelsCheckbox) {
  elements.showLabelsCheckbox.addEventListener("change", () => {
    state.showAllLabels = elements.showLabelsCheckbox.checked;
    // Never renderPitch() here -- it tears down and rebuilds every marker,
    // which would sever whatever's mid-animation (see renderPitch()'s own
    // "must never be called mid-sequence" rule). Only the label attribute
    // needs to change; currentLabelOwnerId already holds the right owner
    // regardless of whether playback is running, paused, or hasn't
    // started.
    updateLabelVisibility(currentLabelOwnerId);
  });
}

if (elements.showVisionCheckbox) {
  elements.showVisionCheckbox.addEventListener("change", () => {
    state.showVisionCone = elements.showVisionCheckbox.checked;
    if (elements.visionLayer)
      elements.visionLayer.dataset.visible = String(state.showVisionCone);
  });
}

// requestAnimationFrame, not a CSS transition: CSS can't interpolate along
// a curved path via left/top alone, and this stays in the exact same 0-100
// percentage coordinate system every other marker already uses (no unit
// conversion, no offset-path browser-support surface to worry about).
function animateBallAlongCurve(
  ballFrom,
  controlPoint,
  ballTo,
  duration,
  onDone,
) {
  const node = markerNode("ball");
  if (!node) {
    if (onDone) onDone();
    return;
  }
  node.dataset.animating = "false"; // driving position manually, not via CSS transition
  const start = performance.now();
  function frame(now) {
    const t = duration > 0 ? Math.min(1, (now - start) / duration) : 1;
    const point = quadraticBezierPoint(ballFrom, controlPoint, ballTo, t);
    node.style.setProperty("--marker-x", `${point.x}%`);
    node.style.setProperty("--marker-y", `${point.y}%`);
    if (t < 1) {
      requestAnimationFrame(frame);
    } else if (onDone) {
      onDone();
    }
  }
  requestAnimationFrame(frame);
}

let segmentLegTimer = null;

// Multi-leg straight-line playback for a keeper-save event's own path
// (contact -> post -> outcome, etc, from buildKeeperSaveSegments()) --
// deliberately NOT curved like animateBallAlongCurve(): the curve is a
// property of the shot itself (strikingFoot/contactType, already drawn by
// the preceding shot event), not of a post deflection, so each leg here is
// a plain CSS transition via setMarkerPosition(), chained with setTimeout.
// duration is split evenly across legs rather than per-leg tuned -- this is
// presentation, not physics; even spacing reads fine for 1-2 extra legs.
// onLegArrive(legIndex), if given, fires each time a leg completes --
// legIndex 0 means "just arrived at segments[1]", etc. This is what lets
// the audio hook play a post sound exactly when the ball reaches the post
// waypoint instead of guessing a fixed delay (see applyStepAnimation()).
function animateBallAlongSegments(
  segments,
  totalDuration,
  animate,
  onDone,
  onLegArrive,
) {
  clearTimeout(segmentLegTimer);
  if (segments.length < 2) {
    setMarkerPosition("ball", segments[0].x, segments[0].y, { animate: false });
    if (onDone) onDone();
    return;
  }
  if (!animate) {
    const last = segments[segments.length - 1];
    setMarkerPosition("ball", last.x, last.y, { animate: false });
    if (onDone) onDone();
    return;
  }
  const legDuration = Math.max(1, totalDuration / (segments.length - 1));
  setMarkerPosition("ball", segments[0].x, segments[0].y, { animate: false });
  let i = 0;
  function nextLeg() {
    if (i >= segments.length - 1) {
      if (onDone) onDone();
      return;
    }
    const to = segments[i + 1];
    setMarkerPosition("ball", to.x, to.y, {
      animate: true,
      duration: legDuration,
    });
    const arrivedLegIndex = i;
    i += 1;
    segmentLegTimer = setTimeout(() => {
      if (onLegArrive) onLegArrive(arrivedLegIndex);
      nextLeg();
    }, legDuration);
  }
  nextLeg();
}

function startDrag(event, entry, describeLabel, onMove) {
  event.preventDefault();
  const marker = event.currentTarget;
  marker.setPointerCapture(event.pointerId);
  const move = (moveEvent) => {
    const rect = elements.pitch.getBoundingClientRect();
    const x = Math.min(
      100,
      Math.max(0, ((moveEvent.clientX - rect.left) / rect.width) * 100),
    );
    const y = Math.min(
      100,
      Math.max(0, ((moveEvent.clientY - rect.top) / rect.height) * 100),
    );
    entry.x = x;
    entry.y = y;
    entry.zone = zoneFromPercent(x, y);
    marker.style.setProperty("--marker-x", `${x}%`);
    marker.style.setProperty("--marker-y", `${y}%`);
    // The ball marker has no label (see renderPitch()) and passes
    // describeLabel: null -- every other marker still has one.
    const labelNode = marker.querySelector(".match-lab-marker-label");
    if (labelNode && describeLabel) labelNode.textContent = describeLabel();
    if (onMove) onMove();
    renderRoster();
    updateInspector();
    if (state.mode === "freeplay") renderActionTable();
  };
  const up = () => {
    marker.removeEventListener("pointermove", move);
    marker.removeEventListener("pointerup", up);
    // A drag directly changes the authored setup -- whatever trace/result
    // was last resolved no longer corresponds to it, so it stops being
    // something Play/Pause/Replay/Step can honestly keep showing.
    // clearResults() is a no-op if nothing had been resolved yet.
    clearResults();
  };
  marker.addEventListener("pointermove", move);
  marker.addEventListener("pointerup", up);
}

// --- Roster panel -----------------------------------------------------------

function findKeeperConflict(roster, entryId, team) {
  return (
    roster.find(
      (entry) =>
        entry.id !== entryId && entry.team === team && entry.role === "keeper",
    ) || null
  );
}

// Roster hover attributes + database deep link (2026-08-20) -- requested
// directly: clicking a roster player should open their real Database Page
// (database.html, the same page draft-run.js's own playerHref() links to),
// and hovering should surface a handful of position-relevant attributes.
//
// "Relevant" is genuinely generation-aware, not a single fixed list: CM's
// attribute set grew across editions (confirmed directly against
// db/retroball.sqlite -- cm9596 has no Anticipation/Decisions/Jumping/
// Vision at all, only "Creativity"/"Positioning"/etc; cm0304/fm2005 add
// Anticipation, Decisions, Jumping, Bravery, Balance, First Touch...).
// Each list below is the union of what's relevant across old/mid/new CM
// eras, ordered old-first; relevantHoverAttributes() below filters it down
// to whichever of these a given player's OWN data genuinely has a value
// for (worker/src/index.ts's RATING_LABELS already renames historical
// synonyms like "Creativity"->"Vision"/"Influence"->"Leadership" before
// this data ever reaches the client, so a plain label match is enough --
// no separate alias table needed here).
const POSITION_HOVER_ATTRIBUTES = {
  goalkeeper: [
    "Positioning",
    "Reflexes",
    "One On Ones",
    "Handling",
    "Jumping",
    "Strength",
    "Anticipation",
    "Rushing Out",
    "Throwing",
    "Communication",
    "Aerial Ability",
    "Tendency To Punch",
    "Command Of Area",
  ],
  defender: [
    "Heading",
    "Tackling",
    "Marking",
    "Positioning",
    "Aggression",
    "Strength",
    "Intelligence",
    "Determination",
    "Dirtiness",
    "Anticipation",
    "Jumping",
    "Bravery",
    "Pace",
    "Decisions",
    "Balance",
  ],
  midfielder: [
    "Dribbling",
    "Passing",
    "Technique",
    "Shooting",
    "Stamina",
    "Vision",
    "Leadership",
    "Intelligence",
    "Long Shots",
    "Anticipation",
    "Flair",
    "Work Rate",
    "Agility",
    "Decisions",
    "Off the Ball",
    "Positioning",
    "First Touch",
  ],
  attacker: [
    "Finishing",
    "Heading",
    "Shooting",
    "Technique",
    "Off the Ball",
    "Pace",
    "Strength",
    "Dribbling",
    "Crossing",
    "Flair",
    "Acceleration",
    "Decisions",
    "First Touch",
    "Jumping",
  ],
};
const HOVER_ATTRIBUTE_COUNT = 10;

function positionGroupFor(entry) {
  if (entry.role === "keeper") return "goalkeeper";
  return classifyOutfieldBand(entry.player);
}

function relevantHoverAttributes(entry) {
  const raw = rawPlayerAttributeMap(entry.player);
  const candidates =
    POSITION_HOVER_ATTRIBUTES[positionGroupFor(entry)] ||
    POSITION_HOVER_ATTRIBUTES.midfielder;
  const found = [];
  for (const label of candidates) {
    if (found.length >= HOVER_ATTRIBUTE_COUNT) break;
    const value = raw.get(normalizedAttributeLabel(label));
    if (value) found.push({ label, value });
  }
  return found;
}

function rosterHoverTitle(entry) {
  const attributes = relevantHoverAttributes(entry);
  if (!attributes.length) return "";
  return attributes.map(({ label, value }) => `${label}: ${value}`).join("\n");
}

// Same URL shape draft-run.js's own playerHref() links to -- Match Lab
// doesn't import draft-run.js (off-limits, see this file's own header),
// so this is a small, independent equivalent built from the identical
// database_slug/source_person_id identity fields both files' players
// already carry, not a copy of any production logic.
function playerDatabaseHref(player) {
  const database = player?.database_slug || player?.database;
  const sourcePersonId = player?.source_person_id || player?.sourcePersonId;
  if (!database || !sourcePersonId) return "";
  const params = new URLSearchParams({
    database: String(database),
    player: String(sourcePersonId),
  });
  return `database.html?${params}`;
}

function reportKeeperConflict(select, existing) {
  const message = `${existing.team === "home" ? "Home" : "Away"} already has a goalkeeper (${playerName(existing.player)}).`;
  select.setCustomValidity?.(message);
  select.reportValidity?.();
}

function renderRoster() {
  const inProbe = state.mode === "probe";
  // Probe has no ball-ownership concept (every scenario reads its own
  // declared roles directly, never state.ball.ownerId -- see
  // scenarioPrimaryRoleKey()'s comment), so that control is actively
  // misleading there, not just unused -- hidden, not merely disabled.
  const scenarioRoleKeys = inProbe
    ? new Set(state.scenario.roles.map((role) => role.key))
    : null;
  elements.roster.innerHTML = state.roster
    .map((entry) => {
      const unused = inProbe && !scenarioRoleKeys.has(entry.role);
      const href = playerDatabaseHref(entry.player);
      const hoverTitle = rosterHoverTitle(entry);
      const nameMarkup = href
        ? `<a href="${href}" target="_blank" rel="noopener noreferrer" title="${hoverTitle}">${playerName(entry.player)}</a>`
        : `<span title="${hoverTitle}">${playerName(entry.player)}</span>`;
      return `
    <li class="match-lab-roster-item" data-unused="${unused}">
      <span>${nameMarkup} <span class="match-lab-roster-zone">Zone ${entry.zone}</span>${unused ? ' <span class="match-lab-roster-unused-tag">Unused</span>' : ""}</span>
      <select data-roster-team="${entry.id}" aria-label="Team">
        <option value="home"${entry.team === "home" ? " selected" : ""}>Home</option>
        <option value="away"${entry.team === "away" ? " selected" : ""}>Away</option>
      </select>
      <select data-roster-role="${entry.id}" aria-label="Role">
        ${(inProbe ? Object.keys(ROLE_LABELS) : FREE_PLAY_ROLE_KEYS)
          .map((key) => {
            // Free Play only ever distinguishes keeper vs. everyone else
            // (see ROLE_LABELS' own comment) -- an entry carrying a
            // Probe-only role value (leftover from a mode switch, or a
            // roster built before this change) still reads correctly as
            // "Player" here rather than matching nothing.
            const selected = inProbe
              ? entry.role === key
              : key === "keeper"
                ? entry.role === "keeper"
                : entry.role !== "keeper";
            return `<option value="${key}"${selected ? " selected" : ""}>${ROLE_LABELS[key]}</option>`;
          })
          .join("")}
      </select>
      ${
        inProbe
          ? ""
          : `
      <button
        type="button"
        class="match-lab-roster-owner-button"
        data-roster-owner="${entry.id}"
        data-owner="${entry.id === state.ball.ownerId}"
        title="Give this player the ball"
      >⚽</button>`
      }
      <button type="button" data-roster-remove="${entry.id}">✕</button>
    </li>
  `;
    })
    .join("");
  elements.roster.querySelectorAll("[data-roster-team]").forEach((select) => {
    select.addEventListener("change", () => {
      const entry = state.roster.find(
        (item) => item.id === select.dataset.rosterTeam,
      );
      if (entry?.role === "keeper") {
        const conflict = findKeeperConflict(
          state.roster,
          entry.id,
          select.value,
        );
        if (conflict) {
          select.value = entry.team;
          reportKeeperConflict(select, conflict);
          return;
        }
      }
      select.setCustomValidity?.("");
      if (entry) entry.team = select.value;
      renderActionTable();
      updateInspector();
    });
  });
  elements.roster.querySelectorAll("[data-roster-role]").forEach((select) => {
    select.addEventListener("change", () => {
      const entry = state.roster.find(
        (item) => item.id === select.dataset.rosterRole,
      );
      if (entry && !inProbe && select.value === "keeper") {
        const conflict = findKeeperConflict(state.roster, entry.id, entry.team);
        if (conflict) {
          select.value = entry.role === "keeper" ? "keeper" : "player";
          reportKeeperConflict(select, conflict);
          return;
        }
      }
      select.setCustomValidity?.("");
      if (entry) entry.role = select.value;
      stopPlayback();
      renderPitch();
      renderRoleRequirements();
      renderActionTable();
      updateInspector();
    });
  });
  elements.roster.querySelectorAll("[data-roster-owner]").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = state.roster.find(
        (item) => item.id === button.dataset.rosterOwner,
      );
      if (entry) giveBallTo(entry);
    });
  });
  elements.roster.querySelectorAll("[data-roster-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.rosterRemove === state.ball.ownerId)
        state.ball.ownerId = null;
      state.roster = state.roster.filter(
        (item) => item.id !== button.dataset.rosterRemove,
      );
      stopPlayback();
      renderRoster();
      renderPitch();
      renderRoleRequirements();
      renderActionTable();
      updateInspector();
    });
  });
}

// --- Scenario + context controls --------------------------------------------

function renderScenarioOptions() {
  elements.scenarioSelect.innerHTML = SCENARIOS.map(
    (scenario) => `<option value="${scenario.id}">${scenario.label}</option>`,
  ).join("");
  elements.scenarioSelect.value = state.scenario.id;
}

elements.scenarioSelect.addEventListener("change", () => {
  state.scenario =
    SCENARIOS.find(
      (scenario) => scenario.id === elements.scenarioSelect.value,
    ) || SCENARIOS[0];
  state.context = {};
  for (const field of state.scenario.context)
    state.context[field.key] = field.default;
  renderScenarioDetails();
  // Which roles are "used"/dimmed, and who the ball is drawn on, both
  // depend on the SELECTED scenario's own role list -- must refresh on
  // every scenario switch, not just the description/role-chip panel.
  renderRoster();
  renderPitch();
  clearResults();
});

function renderScenarioDetails() {
  elements.scenarioDescription.textContent = state.scenario.description;
  renderRoleRequirements();
  renderContextControls();
}

function renderRoleRequirements() {
  const grouped = rosterByRole();
  elements.roleRequirements.innerHTML = state.scenario.roles
    .map((role) => {
      const have = (grouped[role.key] || []).length;
      const filled = have >= role.count;
      const countLabel =
        role.count === 0 ? `${have} (optional)` : `${have}/${role.count}`;
      return `<span class="match-lab-role-chip" data-filled="${filled}">${ROLE_LABELS[role.key]} ${countLabel}</span>`;
    })
    .join("");
  if (state.mode === "probe") {
    elements.playButton.disabled = !currentModeIsReady();
    elements.rerollButton.disabled = !currentModeIsReady();
  }
}

function renderContextControls() {
  elements.contextControls.innerHTML = state.scenario.context
    .map((field) => {
      if (field.type === "checkbox") {
        return `
        <label class="match-lab-checkbox">
          <input type="checkbox" data-context-key="${field.key}"${state.context[field.key] ? " checked" : ""}>
          ${field.label}
        </label>
      `;
      }
      return `
      <label>
        ${field.label}
        <input type="range" data-context-key="${field.key}" min="${field.min}" max="${field.max}" step="${field.step}" value="${state.context[field.key]}">
        <output data-context-output="${field.key}">${Number(state.context[field.key]).toFixed(2)}</output>
      </label>
    `;
    })
    .join("");
  elements.contextControls
    .querySelectorAll("[data-context-key]")
    .forEach((input) => {
      input.addEventListener("input", () => {
        const key = input.dataset.contextKey;
        state.context[key] =
          input.type === "checkbox" ? input.checked : Number(input.value);
        const output = elements.contextControls.querySelector(
          `[data-context-output="${key}"]`,
        );
        if (output) output.textContent = Number(input.value).toFixed(2);
      });
    });
}

// --- Free Play action-availability table -------------------------------

function renderActionTable() {
  const groups = freePlayGroups();
  elements.ballOwnerStatus.textContent = groups.owner
    ? `${playerName(groups.owner.player)} has the ball (${groups.owner.team}, Zone ${groups.owner.zone}).`
    : 'No ball owner assigned yet -- click "⚽" on a placed player.';
  if (!groups.owner) {
    elements.actionTable.innerHTML = "";
    if (state.mode === "freeplay") {
      elements.playButton.disabled = true;
      elements.rerollButton.disabled = true;
    }
    return;
  }
  // Real candidates, the same generateFreePlayCandidates() the possession
  // loop itself decides from -- this display must never drift from what
  // the engine will actually do (see spatialDecision.js's own header
  // comment on why the old generic per-type weighting was replaced).
  // bestCandidateByType() reduces potentially-several pass/cross
  // candidates (one per placed teammate) down to the ~5-row shape this
  // table already has; softmax turns the best utilities into an
  // intuitive "relative attractiveness" percentage -- explicitly NOT the
  // literal selection probability (chooseCandidate()'s noisy-argmax has
  // no simple closed form for that), just a readable approximation.
  const candidates = generateFreePlayCandidates(
    groups,
    state.attackingDirection[groups.owner.team],
  );
  const best = bestCandidateByType(candidates);
  const availableTypes = Object.keys(best);
  const maxUtility = availableTypes.length
    ? Math.max(...availableTypes.map((type) => best[type].utility))
    : 0;
  const expValues = availableTypes.map((type) =>
    Math.exp(best[type].utility - maxUtility),
  );
  const expTotal = expValues.reduce((sum, value) => sum + value, 0);
  const UNAVAILABLE_REASON = {
    pass: "no onside teammate",
    cross: "no onside teammate close to a wide, advanced position",
    dribble: "no opponent within duel range",
    carry: "an opponent is in duel range -- dribble instead",
  };
  elements.actionTable.innerHTML = FREE_PLAY_ACTIONS.map((action) => {
    const candidate = best[action];
    const index = availableTypes.indexOf(action);
    const percent =
      candidate && expTotal > 0
        ? Math.round((expValues[index] / expTotal) * 100)
        : 0;
    const label = candidate?.target
      ? `${FREE_PLAY_ACTION_LABELS[action]} -> ${playerName(candidate.target.player)}`
      : FREE_PLAY_ACTION_LABELS[action];
    return `
      <div class="match-lab-action-row" data-available="${Boolean(candidate)}">
        <span class="match-lab-action-row-name">${label}</span>
        <span class="match-lab-action-row-reason">${candidate ? "available" : UNAVAILABLE_REASON[action] || "unavailable"}</span>
        <span class="match-lab-action-row-weight">${candidate ? percent + "%" : ""}</span>
      </div>
    `;
  }).join("");
  if (state.mode === "freeplay") {
    elements.playButton.disabled = false;
    elements.rerollButton.disabled = false;
  }
}

// --- Live inspector (pressure / receiver weights) ---------------------------

function updateInspector() {
  const rows = [];
  const grouped = rosterByRole();
  // Must use the same team+distance filter Free Play's own candidate
  // generation uses (engagingOpponent(), via freePlayGroups()) -- picking
  // "the first roster entry with role defender" regardless of team or
  // range disagreed with generateFreePlayCandidates() whenever the
  // "defender" was actually a teammate or too far away (real yards,
  // DUEL_RANGE_YARDS) to engage, showing pressure that Free Play itself
  // correctly treated as zero.
  const engager =
    state.mode === "freeplay"
      ? (() => {
          const groups = freePlayGroups();
          return groups.owner
            ? engagingOpponent(groups.owner, groups.opponents)
            : null;
        })()
      : (grouped.defender || [])[0];
  if (engager) {
    const pressure = computePressure(engager.player, engager.zone, 0);
    rows.push([
      "Pressure near " + playerName(engager.player),
      pressure.toFixed(2),
    ]);
  }
  const candidates = grouped.candidate || [];
  if (candidates.length >= 2) {
    // Empirical, not analytic: samples the real selectReceiver() many times
    // rather than re-deriving its internal weight formula here, so this
    // panel can never silently drift from what the engine actually does.
    const random = seededRandom(
      hashString(`inspector-receiver-weights:${state.seed}`),
    );
    const targetZone = candidates[0].zone;
    const owner = state.roster.find((entry) => entry.id === state.ball.ownerId);
    // Uses the real ball owner's Vision once one's assigned; falls back to
    // a representative placeholder only when nobody has the ball yet.
    const passerVision = owner ? playerAttribute(owner.player, "Vision") : 14;
    const pressureValue = state.context.pressure ?? 0.3;
    const pool = candidates.map((entry) => entry.player);
    const hits = new Map();
    const sampleCount = 300;
    for (let index = 0; index < sampleCount; index += 1) {
      const picked = selectReceiver(
        pool,
        targetZone,
        passerVision,
        pressureValue,
        random,
      );
      hits.set(picked, (hits.get(picked) || 0) + 1);
    }
    for (const entry of candidates) {
      const share = Math.round(
        ((hits.get(entry.player) || 0) / sampleCount) * 100,
      );
      rows.push([
        `Receiver suitability sample: ${playerName(entry.player)}`,
        `${share}%`,
      ]);
    }
  }
  elements.inspector.hidden = rows.length === 0;
  elements.inspectorList.innerHTML = rows
    .map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`)
    .join("");
}

// --- Roll / Replay / Reroll / Step / Reset / Run N --------------------------

function runScenarioOnce(seed) {
  const random = seededRandom(hashString(`match-lab:probe:${seed}`));
  const trace = [];
  const grouped = rosterByRole();
  // seed passed through as a 5th arg -- existing scenarios simply don't
  // reference it (no signature change needed for them). One-on-One
  // Decision needs it directly: its own decisionRandom must vary per Run N
  // iteration the same way the main `random` stream does, or every
  // iteration would hash to the exact same decision (see that scenario's
  // own comment on why it can't just reuse state.seed for this).
  const result = state.scenario.run(
    grouped,
    state.context,
    random,
    trace,
    seed,
  );
  return { result, trace };
}

function attributionEntryMarkup(item = {}) {
  const attribute = item.attr ?? item.attribute ?? item.name ?? "Attribute";
  const rating = item.value ?? item.rating ?? "?";
  const quantity = item.quantity ?? item.metric ?? "measured effect";
  const actualValue = item.actual ?? item.result;
  const baselineValue = item.baseline ?? item.average;
  const actual = Number.isFinite(actualValue)
    ? Math.round(actualValue * 100) / 100
    : (actualValue ?? "unavailable");
  const baseline = Number.isFinite(baselineValue)
    ? Math.round(baselineValue * 100) / 100
    : (baselineValue ?? "unavailable");
  const unit = item.unit ? ` ${item.unit}` : "";
  return `<li><strong>${attribute} ${rating}</strong> → ${quantity}: ${actual}${unit} <small>(rating-10 baseline ${baseline}${unit})</small></li>`;
}

function movementDiagnosticMarkup(item = {}) {
  const rounded = (value, digits = 1) =>
    Number.isFinite(value) ? Number(value.toFixed(digits)) : "unavailable";
  const reachability =
    item.reachable === null
      ? ""
      : ` &middot; ${item.reachable ? "reachable" : "unreachable"}`;
  const contactReach = item.reachAllowanceYards > 0
    ? ` &middot; Contact reach: ${rounded(item.reachAllowanceYards)} yd`
    : "";
  return (
    `<li><strong>Move: ${item.action}</strong><small>` +
    `Distance: ${rounded(item.distanceYards)} yd &middot; Natural ETA: ${rounded(item.naturalEtaMs, 0)} ms &middot; ` +
    `Scheduled duration: ${rounded(item.scheduledDurationMs, 0)} ms &middot; ` +
    `Average speed: ${rounded(item.averageSpeedYardsPerSecond, 2)} yd/s &middot; ` +
    `Player top speed: ${rounded(item.topSpeedYardsPerSecond, 2)} yd/s${contactReach}${reachability}</small></li>`
  );
}

function renderTrace(upToIndex) {
  const trace = state.lastTrace || [];
  const visible = trace.slice(0, upToIndex);
  elements.trace.hidden = visible.length === 0;
  elements.traceSource.textContent =
    state.lastMode === "freeplay"
      ? "action choice: Match Lab experimental sparse-roster model · action resolution: production engine · animation: visual interpolation between engine states"
      : "action resolution: production engine · animation: visual interpolation between engine states";
  elements.traceList.innerHTML = visible
    .map((step, index) => {
      const attribution = (step.attribution || [])
        .map(attributionEntryMarkup)
        .join("");
      let disclosure = attribution
        ? `<details class="match-lab-trace-attribution"><summary>Attribute influence</summary><ul>${attribution}</ul></details>`
        : "";
      const interval = state.lastPlan?.intervals?.find(
        (candidate) => candidate.eventIndex === index,
      );
      const movementDiagnostics = (interval?.moveDiagnostics || [])
        .filter((item) => item.distanceYards > 0.01)
        .map(movementDiagnosticMarkup)
        .join("");
      if (movementDiagnostics) {
        disclosure += `<details class="match-lab-trace-attribution match-lab-move-diagnostics"><summary>Movement timing</summary><ul>${movementDiagnostics}</ul></details>`;
      }
      return `<li data-current="${index === visible.length - 1}"><span class="match-lab-trace-code">${step.code}</span> — ${step.label}${disclosure}</li>`;
    })
    .join("");
  elements.stepButton.hidden = trace.length <= 1;
}

// --- Animation v0: playback controller ----------------------------------
// One function drives marker movement/effects for a single event; Step,
// Play's timer tick, and Replay's timer tick all call it identically --
// only whether the move is animated and who advances stepIndex differs.
// The engine has already fully resolved the trace by the time any of this
// runs (see runOnce()/runScenarioOnce()/runConstructedPossession() above)
// -- nothing here calls random() or can change which branch fired.
// Movement types that represent a duel/contest beat between an actor and
// a defender (a "looks to get past"/"chooses tackle"/outcome/foul-card
// beat). These get a non-positional CONTEST indicator (data-contest) when
// the beat carries no genuine mover -- see applyStepAnimation()'s own
// comment for why a coordinate nudge was removed from this case entirely
// (it visually implied real engagement that never happened -- a browser
// round correctly called this out as still misleading even as a
// "cosmetic-only, never authoritative" offset, since it still LOOKED like
// two players physically closing distance).
const DUEL_CONTEST_MOVEMENTS = new Set(["dribble", "tackle", "foul"]);
let activeEffectNodes = [];

// Visual-only reset (marker effect attributes, goal flash, result badge,
// trail) -- deliberately does NOT touch sound. Split out from
// clearStepEffects() (2026-08-21) because applyPlaybackCue() -- the
// continuous-playback per-EVENT renderer, called once per state.lastPlan.cues
// entry as the clock advances, often several times in the same synchronous
// batch when adjacent events have ~0 duration (GK.ADJUST/DEF.ADJUST/
// P.CARRY.TOUCH are typical) -- needs the visual cleanup on every event but
// must NOT cancel sound here: playEvent() schedules each event's cue via
// setTimeout, and calling stopAllSound() (which clears pendingTimers) from
// the VERY NEXT event's cleanup -- often microtasks later, same tick --
// was cancelling almost every cue before its own timer ever got to fire.
// That's a real, confirmed bug (verified with direct instrumentation): a
// shot's "kick" cue, scheduled at atMs:0, was reliably killed by the
// following event's cleanup before the 0ms timeout macrotask ran. Only a
// handful of single-step cues without any next-event neighbor in the same
// batch ever survived -- matching exactly the "some sounds work, mostly
// silent" symptom. See clearStepEffects() below for where sound-stopping
// actually belongs.
function clearStepVisualEffects() {
  for (const node of activeEffectNodes) {
    node.removeAttribute("data-pulse");
    node.removeAttribute("data-dive");
    node.removeAttribute("data-celebrate");
    node.removeAttribute("data-held");
    node.removeAttribute("data-height");
    node.removeAttribute("data-cosmetic");
    node.removeAttribute("data-contest");
    node.removeAttribute("data-net-impact");
    node.removeAttribute("data-impact-side");
    node.removeAttribute("data-impact-power");
  }
  activeEffectNodes = [];
  elements.pitch.removeAttribute("data-goal-flash");
  if (elements.resultBadge) elements.resultBadge.dataset.visible = "false";
  clearTimeout(segmentLegTimer);
  hideTrail();
}

function clearStepEffects() {
  clearStepVisualEffects();
  // Every OTHER caller of clearStepEffects() (a fresh Roll, Reroll, Replay
  // restart, Reset, and the top of applyStepAnimation() itself before
  // scheduling this step's own cues -- Step is user-paced, one click per
  // event, so there's no same-tick neighbor to race against) is exactly
  // the set of moments a still-playing or still-scheduled sound from the
  // PREVIOUS action must not bleed into -- stopAll() cancels matchSound's
  // own pending timers and active buffer sources. applyPlaybackCue()
  // deliberately does NOT call this -- see clearStepVisualEffects()'s own
  // comment just above.
  stopAllSound();
}

function triggerGoalNet(event) {
  if (event?.outcome !== "goal") return;
  const path = event.pathSegments?.length
    ? event.pathSegments
    : [event.ballFrom, event.ballTo].filter(Boolean);
  const endpoint = path.at(-1);
  if (!endpoint || (endpoint.y >= 0 && endpoint.y <= 100)) return;
  const selector = endpoint.y < 0
    ? ".ml-pitch-goal-top"
    : ".ml-pitch-goal-bottom";
  const net = elements.pitch.querySelector(selector);
  if (!net) return;
  const normalizedX = clamp(
    0,
    1,
    (endpoint.x - GOAL_LEFT_POST_X) / (GOAL_RIGHT_POST_X - GOAL_LEFT_POST_X),
  );
  net.dataset.impactSide = normalizedX < 0.34
    ? "left"
    : normalizedX > 0.66
      ? "right"
      : "center";
  net.dataset.impactPower = event.contactType === "laces" ? "power" : "placed";
  net.style.setProperty("--net-impact-x", `${Math.round(normalizedX * 100)}%`);
  // Reflow makes Replay/New Outcome restart the same one-shot animation
  // even when the same goal and same net occur consecutively.
  net.removeAttribute("data-net-impact");
  void net.offsetWidth;
  net.dataset.netImpact = "true";
  activeEffectNodes.push(net);
}

// Playback-only visual movement -- deliberately never touches the roster
// entry's own x/y/zone (the AUTHORED position). Only the DOM moves here,
// via setMarkerPosition(); state.roster stays exactly as placed until the
// user drags a marker directly (see startDrag()), so a fresh renderPitch()
// always snaps every marker back to what was actually authored, no matter
// how far mid-playback nudging (dribble/tackle duels, a receiver drifting
// toward a cross) had moved it visually. This is what used to be missing:
// Reroll/Replay/Step wrapping had to snapshot-and-restore positions
// because animation was corrupting the authored setup it needed to
// restore FROM; now there's nothing to corrupt.
function moveRosterEntry(id, point, animate, duration) {
  setMarkerPosition(id, point.x, point.y, { animate, duration });
}

// Everything the shared audio director needs that isn't already sitting on
// the event object -- see matchSound.js's resolveCueSequence(). playbackId
// ties variant selection to the current roll (state.seed); eventId adds
// the step index so two different events in the same roll never collide
// on the same hash input, and Replay -- same seed, same trace, same
// indices -- reproduces the identical variant every time.
function buildSoundContext(event) {
  return {
    isPower: event.contactType === "laces",
    blockOutcome: event.blockOutcome,
    wallHit: event.code?.startsWith("FK.WALL.") && event.outcome === "block",
    playbackId: state.seed,
    eventId: `${state.lastMode || state.mode}:${state.stepIndex}:${event.code}`,
  };
}

function fireCueStep(step, soundCtx) {
  playCue(step.cue, {
    playbackId: soundCtx.playbackId,
    eventId: `${soundCtx.eventId}:${step.milestone}:${step.cue}`,
  });
}

function applyStepAnimation(event, { animate }) {
  if (!event) return;
  clearStepEffects();
  if (event.ballFrom) recordTouch(event.ballFrom);
  const duration = event.duration ?? DEFAULT_DURATION;
  // Set unconditionally, before any branch below -- animateBallAlongCurve()
  // drives the ball's position directly (rAF, not a CSS transition) and
  // never touches this property itself, so without this line a held/OVER
  // CSS keyframe applied later in this function could read a stale
  // --marker-duration left over from a previous, differently-timed event.
  const ballNodeForDuration = markerNode("ball");
  if (ballNodeForDuration)
    ballNodeForDuration.style.setProperty("--marker-duration", `${duration}ms`);

  // Sound is tied to the SAME animation milestones the visuals below key
  // off, not to "this event object got rendered" -- a multi-leg keeper-save
  // path fires its keeper-contact cue immediately, its post cue exactly
  // when the ball's own animation arrives at the post waypoint, and its
  // net/reaction cue exactly on final arrival, all driven by the real
  // animation callbacks (onLegArrive/onDone) below, not a guessed delay.
  // Events with no fine-grained waypoints of their own (a pass, a bare
  // shot-start "kick" beat, a block) fall through to playEvent(), the same
  // fixed-delay scheduler draft-run.js uses for its own (non-animated)
  // timeline -- see matchSound.js's resolveCueSequence() doc comment.
  const soundCtx = buildSoundContext(event);
  // Match Lab is a training ground, not a live match -- it rolls the same
  // isolated scenario over and over, so a crowd goal-reaction cheer or a
  // missed-chance groan firing on every repeated test roll would read as
  // noise, not signal. matchSound.js itself drops every crowd-bus cue here
  // (see setTrainingMode(true) at init), so no per-cue filtering is needed
  // in this file -- the physical contact cues (kick/keeper/post/net) still
  // play normally.
  const cueSequence = resolveCueSequence(event.code, soundCtx);

  const isCurvedShot =
    event.movement === "shot" &&
    event.strikingFoot &&
    event.contactType &&
    event.ballFrom &&
    event.ballTo;
  if (isCurvedShot && animate) {
    const controlPoint = curveControlPoint(
      event.ballFrom,
      event.ballTo,
      event.strikingFoot,
      event.contactType,
    );
    showTrail(event.ballFrom, controlPoint, event.ballTo);
    animateBallAlongCurve(
      event.ballFrom,
      controlPoint,
      event.ballTo,
      duration,
      () => {
        trailFadeTimer = setTimeout(hideTrail, 350);
        for (const step of cueSequence)
          if (step.milestone === "terminal") fireCueStep(step, soundCtx);
      },
    );
  } else if (event.pathSegments && event.pathSegments.length > 1) {
    // A keeper-save event's own multi-leg path (contact -> post -> outcome,
    // etc, from buildKeeperSaveSegments()) -- straight legs, not the curved
    // bezier above, since a post deflection isn't a foot-struck curl.
    hideTrail();
    for (const step of cueSequence)
      if (step.milestone === "keeperContact") fireCueStep(step, soundCtx);
    animateBallAlongSegments(
      event.pathSegments,
      duration,
      animate,
      () => {
        for (const step of cueSequence)
          if (step.milestone === "net" || step.milestone === "terminal")
            fireCueStep(step, soundCtx);
      },
      (legIndex) => {
        if (legIndex === 0)
          for (const step of cueSequence)
            if (step.milestone === "post") fireCueStep(step, soundCtx);
      },
    );
  } else if (event.ballFrom && event.ballTo) {
    hideTrail();
    setMarkerPosition("ball", event.ballTo.x, event.ballTo.y, {
      animate,
      duration,
    });
    // No fine-grained waypoints (a single straight hop -- pass, cross,
    // block, rebound, etc, or a single-point keeper hold/recovery like
    // K.SAVE.1/.4 where ballFrom===ballTo). playEvent()'s own fixed-delay
    // scheduling is the honest degrade for these.
    playEvent(event, soundCtx);
  } else {
    hideTrail();
    // Movement-less events -- the bare shot-type-selection beat ("CALM"/
    // "BLAST"/etc) is where the kick cue actually lives; see
    // resolveCueSequence()'s SHOT_START_CODES.
    playEvent(event, soundCtx);
  }

  // Strict authoritative/cosmetic split (see playbackPositions's own
  // header comment). event.moverId/moveTo is EXPLICIT participant-
  // movement data, stated directly by the resolver call site that knows
  // a real relocation happened (a successful dribble's carrier, a
  // knock-forward reception's receiver -- see traceEvent()'s own
  // comment) -- never re-derived from ballFrom/ballTo, since a shot or
  // pass has a real, distinct ballFrom/ballTo too without its actor
  // moving anywhere. Only this branch (and the multi-mover one right
  // below it) ever writes playbackPositions.
  //
  // Contact, Ownership & Continuation (2026-08-18) -- a real cross/
  // header contest or a rebound scramble needs TWO participants to move
  // at once (the attacker AND the defender converging on one real
  // contact/loose-ball point), which moverId/moveTo alone can never
  // express. event.playerMoves carries all of them explicitly (see
  // traceEvent()'s own comment); every entry here is stated by the
  // resolver that produced this event, never guessed from ballFrom/
  // ballTo -- nobody NOT listed gets any movement invented for them (the
  // keeper's own positioning during a cross, for instance, is real
  // future work -- Cross Resolution Pass C -- not something this
  // renderer approximates by inference).
  if (event.playerMoves && event.playerMoves.length > 1) {
    for (const move of event.playerMoves) {
      moveRosterEntry(move.playerId, move.to, animate, duration);
      playbackPositions[move.playerId] = move.to;
    }
  } else if (event.moverId && event.moveTo) {
    moveRosterEntry(event.moverId, event.moveTo, animate, duration);
    playbackPositions[event.moverId] = event.moveTo;
    // The engine gives the defender no destination of their own here
    // (see resolveDribble()'s P.PROGRESS.WON) -- a real, separately-
    // scoped match-engine-awareness gap (recovery time, being wrong-
    // footed), not something this visualization pass invents. What CAN
    // be shown honestly with data already in hand: a deterministic,
    // direction-grounded cosmetic reaction toward the real advance.
    if (event.defenderId && event.defenderId !== event.moverId) {
      const defenderPoint = playbackPointFor(event.defenderId);
      if (defenderPoint)
        applyCosmeticOffset(
          event.defenderId,
          defenderPoint,
          event.moveTo,
          0.35,
          10,
          duration,
        );
    }
  } else if (
    DUEL_CONTEST_MOVEMENTS.has(event.movement) &&
    event.actorId &&
    event.defenderId
  ) {
    // A movement-LESS contest beat (no mover -- nothing has actually
    // moved yet, e.g. "looks to get past"/"chooses tackle"/a foul-card
    // beat). This USED to nudge both markers a short distance toward
    // each other -- even purely as a cosmetic, non-authoritative offset,
    // that still visually read as real engagement (two players closing
    // distance) for something the engine hadn't actually resolved yet.
    // Removed per explicit instruction: a non-positional CONTEST
    // indicator (data-contest, styles.css) marks both participants as
    // actively engaged without ever implying movement that doesn't
    // exist -- honest until the engine supplies genuine duel movement
    // (see MATCH_LAB_PLAN.md correctness pass).
    for (const id of [event.actorId, event.defenderId]) {
      const node = markerNode(id);
      if (node) {
        node.dataset.contest = "true";
        activeEffectNodes.push(node);
      }
    }
  } else if (event.ballFrom && event.ballTo) {
    const mid = midpoint(event.ballFrom, event.ballTo);
    for (const [id, fraction, cap] of [
      [event.targetId, 0.18, 6],
      [event.defenderId, 0.22, 8],
      [event.keeperId, 0.22, 8],
    ]) {
      if (!id) continue;
      const point = playbackPointFor(id);
      if (point) applyCosmeticOffset(id, point, mid, fraction, cap, duration);
    }
  }

  for (const id of [
    event.actorId,
    event.targetId,
    event.defenderId,
    event.keeperId,
  ]) {
    if (!id) continue;
    const node = markerNode(id);
    if (node) {
      node.dataset.pulse = "true";
      activeEffectNodes.push(node);
    }
  }
  if (event.movement === "save" && event.keeperId) {
    const node = markerNode(event.keeperId);
    if (node) {
      node.dataset.dive = "true";
      activeEffectNodes.push(node);
    }
  }
  if (event.outcome === "goal") {
    elements.pitch.dataset.goalFlash = "true";
    triggerGoalNet(event);
    if (event.actorId) {
      const node = markerNode(event.actorId);
      if (node) {
        node.dataset.celebrate = "true";
        activeEffectNodes.push(node);
      }
    }
  }

  // Caught/recovered -- visually tuck the ball onto the keeper marker
  // (it's already sitting exactly at the keeper's own point, see
  // pushKeeperSaveEvent()) rather than leaving it floating as a distinct
  // dot the same size as a live, in-flight ball.
  if (event.ballResult === "held") {
    const ballNode = markerNode("ball");
    if (ballNode) {
      ballNode.dataset.held = "true";
      activeEffectNodes.push(ballNode);
    }
  }
  // Top-down view has no z-axis: x/y alone can't tell an over-the-bar miss
  // apart from one that's on frame, so a shot flagged heightCue gets an
  // explicit visual cue (scale/shadow) on top of the OVER badge below.
  if (event.heightCue) {
    const ballNode = markerNode("ball");
    if (ballNode) {
      ballNode.dataset.height = "over";
      activeEffectNodes.push(ballNode);
    }
  }
  // Synchronized result badge -- movement/position alone reads as
  // ambiguous for several of these (a catch and a parry both just move the
  // ball to roughly the same spot on-screen), so every keeper-save/miss
  // event carries an explicit text badge in addition to its visual.
  if (elements.resultBadge) {
    if (event.badge) {
      elements.resultBadge.textContent = event.badge;
      elements.resultBadge.dataset.kind = event.badge.toLowerCase();
      elements.resultBadge.dataset.visible = "true";
    } else {
      elements.resultBadge.dataset.visible = "false";
    }
  }
}

let playbackClock = null;
let lastRenderedCueTime = -1;
let lastRenderedTraceIndex = 0;

function isPlaying() {
  return Boolean(playbackClock?.getState().playing);
}

function updatePlayPauseButton() {
  elements.playPauseButton.textContent = isPlaying() ? "⏸ Pause" : "▶ Play";
  elements.playPauseButton.disabled =
    !state.lastTrace || state.lastTrace.length === 0;
  elements.traceStatus.textContent = isPlaying() ? "playing" : "";
}

function stopPlayback() {
  const wasPlaying = isPlaying();
  playbackClock?.pause();
  if (wasPlaying) stopAllSound();
  updatePlayPauseButton();
}

function applyPlaybackCue(event) {
  if (!event) return;
  clearStepVisualEffects();
  if (event.contact?.point) recordTouch(event.contact.point);
  else if (event.ballFrom) recordTouch(event.ballFrom);
  if (
    event.movement === "shot" &&
    event.strikingFoot &&
    event.contactType &&
    event.ballFrom &&
    event.ballTo
  ) {
    showTrail(
      event.ballFrom,
      curveControlPoint(
        event.ballFrom,
        event.ballTo,
        event.strikingFoot,
        event.contactType,
      ),
      event.ballTo,
    );
  }
  playEvent(event, buildSoundContext(event));
  for (const id of [
    event.actorId,
    event.targetId,
    event.defenderId,
    event.keeperId,
  ]) {
    const node = id ? markerNode(id) : null;
    if (!node) continue;
    node.dataset.pulse = "true";
    activeEffectNodes.push(node);
  }
  if (event.movement === "save" && event.keeperId) {
    const node = markerNode(event.keeperId);
    if (node) {
      node.dataset.dive = "true";
      activeEffectNodes.push(node);
    }
  }
  if (event.outcome === "goal") {
    elements.pitch.dataset.goalFlash = "true";
    triggerGoalNet(event);
  }
  if (elements.resultBadge) {
    elements.resultBadge.textContent = event.badge || "";
    elements.resultBadge.dataset.kind = (event.badge || "").toLowerCase();
    elements.resultBadge.dataset.visible = String(Boolean(event.badge));
  }
}

function renderPlaybackFrame(snapshot) {
  if (!state.lastPlan) return;
  if (snapshot.timeMs + 0.001 < state.playbackTimeMs) {
    clearStepEffects();
    resetTouchTrail();
    lastRenderedCueTime = -1;
    lastRenderedTraceIndex = 0;
  }
  for (const [id, point] of Object.entries(snapshot.players)) {
    if (!point) continue;
    setMarkerPosition(id, point.x, point.y, { animate: false, duration: 0 });
    playbackPositions[id] = point;
  }
  updateLabelVisibility(snapshot.ownerId ?? null);
  const possessionOwner = snapshot.ownerId
    ? state.roster.find((entry) => entry.id === snapshot.ownerId) || null
    : null;
  const possessionOwnerPoint = possessionOwner
    ? snapshot.players[possessionOwner.id]
    : null;
  updateVisionCone(
    possessionOwner && possessionOwnerPoint
      ? { ...possessionOwner, ...possessionOwnerPoint }
      : null,
    snapshot.timeMs,
  );
  // Computed here (not just once, further down, where it ALSO decides
  // when to advance the trace panel) because the anticipation cone needs
  // it too -- "who is this delivery's own targetId, and have they
  // actually received it yet" (see updateAnticipationCone()'s own
  // comment on why ownerId being null throughout the flight is exactly
  // what makes this check correct).
  const visibleIndex = state.lastPlan.intervals.reduce(
    (highest, interval) =>
      interval.startMs <= snapshot.timeMs + 0.001
        ? Math.max(highest, interval.eventIndex + 1)
        : highest,
    0,
  );
  const currentEvent = state.lastTrace?.[visibleIndex] ?? null;
  const isDeliveryInFlight = Boolean(
    currentEvent &&
    (currentEvent.movement === "pass" || currentEvent.movement === "cross") &&
    currentEvent.targetId &&
    currentEvent.targetId !== snapshot.ownerId,
  );
  const anticipatingEntry = isDeliveryInFlight
    ? state.roster.find((entry) => entry.id === currentEvent.targetId) || null
    : null;
  const anticipatingPoint = anticipatingEntry
    ? snapshot.players[anticipatingEntry.id]
    : null;
  updateAnticipationCone(
    anticipatingEntry && anticipatingPoint
      ? { ...anticipatingEntry, ...anticipatingPoint }
      : null,
    snapshot.timeMs,
  );
  if (snapshot.ball) {
    const speed = Math.hypot(
      snapshot.ball.velocity?.x || 0,
      snapshot.ball.velocity?.y || 0,
    );
    const restingOwner = possessionOwner;
    const ownerPoint = possessionOwnerPoint;
    const atFeet = Boolean(
      restingOwner &&
      ownerPoint &&
      (snapshot.ball.mode === "controlled" ||
        snapshot.ball.mode === "controlled-ground") &&
      speed < 0.0001,
    );
    // Ball independence, visually (2026-08-19) -- at rest with an outfield
    // player, the marker's logical position stays exactly on them (never
    // "swallowed" into their own dot visually -- restingBallOffsetPx()'s
    // fixed-pixel nudge is what draws it at their outer edge instead, see
    // that function's own comment). In genuine flight (a real pass/shot/
    // cross/header trajectory) or held by a keeper, the ball keeps its own
    // real track position, offset reset to zero -- a flying or held ball
    // must never be pulled toward anyone.
    const displayBall = atFeet ? ownerPoint : snapshot.ball;
    setMarkerPosition("ball", displayBall.x, displayBall.y, {
      animate: false,
      duration: 0,
    });
    setBallRestOffset(
      atFeet
        ? restingBallOffsetPx(
            ownerPoint,
            state.attackingDirection[restingOwner.team],
            restingOwner.role,
          )
        : { x: 0, y: 0 },
    );
    const ballNode = markerNode("ball");
    if (ballNode) {
      ballNode.dataset.held = String(snapshot.ball.mode === "held");
      ballNode.dataset.flight =
        snapshot.ball.mode === "airborne" || snapshot.ball.mode === "bouncing"
          ? "true"
          : "false";
      ballNode.style.setProperty(
        "--ball-lift",
        `${Math.min(12, Math.max(0, snapshot.ball.height || 0) * 2)}px`,
      );
    }
  }

  for (const cue of state.lastPlan.cues) {
    if (
      cue.timeMs > lastRenderedCueTime + 0.001 &&
      cue.timeMs <= snapshot.timeMs + 0.001
    ) {
      state.stepIndex = cue.eventIndex + 1;
      applyPlaybackCue(state.lastTrace[cue.eventIndex]);
    }
  }
  lastRenderedCueTime = snapshot.timeMs;
  if (visibleIndex !== lastRenderedTraceIndex) {
    lastRenderedTraceIndex = visibleIndex;
    state.stepIndex = visibleIndex;
    renderTrace(visibleIndex);
  }
  state.playbackTimeMs = snapshot.timeMs;
}

function buildPlaybackPlan(runOutput) {
  const initialPositions = Object.fromEntries(
    state.roster.map((entry) => [entry.id, pointOf(entry)]),
  );
  const initialOwner =
    state.mode === "freeplay"
      ? state.roster.find((entry) => entry.id === state.ball.ownerId)
      : probePrimaryEntry();
  const initialBall = initialOwner ? pointOf(initialOwner) : { ...state.ball };
  const finalOwnerId = Object.prototype.hasOwnProperty.call(
    runOutput,
    "finalOwnerId",
  )
    ? runOutput.finalOwnerId
    : Object.prototype.hasOwnProperty.call(
          runOutput.result || {},
          "nextOwnerId",
        )
      ? runOutput.result.nextOwnerId
      : undefined;
  const restart = Object.prototype.hasOwnProperty.call(
    runOutput.result || {},
    "restart",
  )
    ? runOutput.result.restart
    : undefined;
  return buildMatchLabPlaybackPlan({
    trace: runOutput.trace,
    initialPositions,
    initialBall,
    initialOwnerId:
      state.mode === "freeplay"
        ? state.ball.ownerId
        : (initialOwner?.id ?? null),
    finalOwnerId,
    restart,
    playerProfiles: Object.fromEntries(
      state.roster.map((entry) => [String(entry.id), entry.player]),
    ),
  });
}

function installPlaybackPlan(runOutput) {
  // Build the NEW plan before touching anything about the current one
  // (2026-08-21 fix) -- this used to destroy playbackClock FIRST, so a
  // buildPlaybackPlan() failure (an occasional real one, see
  // MATCH_LAB_PLAN.md -- contact-point validation on some small fraction
  // of rolls) left no clock running at all, not just this call's own
  // failure to show something new. Building first means a failed roll
  // leaves the PREVIOUS roll's plan/clock fully intact and still
  // playable -- a caller with no try/catch of its own (there was
  // exactly one, rerollButton's, also fixed the same day) degrades to
  // "Reroll silently did nothing new," not "the pitch stops animating
  // at all."
  const nextPlan = buildPlaybackPlan(runOutput);
  playbackClock?.destroy();
  state.lastPlan = nextPlan;
  state.playbackTimeMs = 0;
  lastRenderedCueTime = -1;
  lastRenderedTraceIndex = 0;
  playbackClock = createMatchLabPlaybackClock(state.lastPlan, {
    onFrame: renderPlaybackFrame,
    onStateChange: updatePlayPauseButton,
  });
  playbackClock.setRate(state.speed);
  renderPlaybackFrame({
    timeMs: 0,
    ball: state.lastPlan.tracks.ball[0]?.position ?? null,
    players: Object.fromEntries(
      Object.entries(state.lastPlan.tracks.players).map(([id, track]) => [
        id,
        track[0]?.position ?? null,
      ]),
    ),
  });
}

function startPlayback() {
  if (!playbackClock || !state.lastTrace?.length) return;
  playbackClock.play();
  updatePlayPauseButton();
}

// Only ever called from inside a real click handler (Roll/Play/Reroll/
// Replay below) -- browser autoplay policy requires unlock() to happen
// synchronously inside a user gesture, never from a timer or a resolved
// promise. preloadCore() is fire-and-forget: the first cue or two of a
// roll might fire before it resolves, which just means playCue() waits on
// the same in-flight fetch rather than starting a redundant one.
function unlockAndPreload() {
  unlockSound();
  preloadCore();
}

// Resolve & Play: resolve the current AUTHORED setup, get a new result,
// autoplay it. renderPitch() before resolving guarantees every marker is
// visually where state.roster/state.ball actually say it is -- normally a
// no-op (nothing mutates those between rolls anymore), but cheap
// insurance against any future stray write, and it's what replaces the
// old snapshot-capture this handler used to need.
// Builds state.lastRun (requirement 7) from runOnce()'s output -- Free
// Play only (Scenario Probe has no possession/authored-setup concept to
// snapshot here). The authored-setup snapshot is a real copy, not a live
// reference: a later drag mutates state.roster going forward, but must
// never retroactively change what an already-finished run recorded as its
// own starting point.
function buildLastRun(seed, runOutput) {
  if (state.mode !== "freeplay") return null;
  return {
    seed,
    authoredSetup: {
      roster: state.roster.map((entry) => ({
        id: entry.id,
        role: entry.role,
        team: entry.team,
        x: entry.x,
        y: entry.y,
        zone: entry.zone,
      })),
      ball: { ...state.ball },
    },
    result: runOutput.result,
    finalOwnerId: runOutput.finalOwnerId ?? null,
    actionsCount: runOutput.actionsCount ?? null,
    decisionMetrics: runOutput.decisionMetrics ?? [],
    possessionMetrics: runOutput.possessionMetrics ?? null,
    trace: runOutput.trace,
    // The possession's own simulated positions at rest (Pass 1) -- the
    // authored setup above never changes; this is where each player and
    // the ball actually ended up once resolution finished.
    finalPositions: runOutput.finalPositions ?? null,
  };
}

function showPlaybackError(error) {
  console.error("Resolve & Play failed", error);
  elements.trace.hidden = false;
  elements.traceStatus.textContent = "Resolution failed";
  elements.traceList.replaceChildren();
  const item = document.createElement("li");
  item.className = "match-lab-trace-error";
  item.textContent = `Could not build playback: ${error?.message || "Unknown error"}`;
  elements.traceList.appendChild(item);
}

elements.playButton.addEventListener("click", () => {
  if (!currentModeIsReady()) return;
  unlockAndPreload();
  stopPlayback();
  try {
    elements.seed.textContent = String(state.seed);
    renderPitch();
    const runOutput = runOnce(state.seed);
    state.lastMode = state.mode;
    state.lastTrace = runOutput.trace;
    state.lastRun = buildLastRun(state.seed, runOutput);
    state.stepIndex = 0;
    clearStepEffects();
    resetTouchTrail();
    renderTrace(0);
    renderOneOnOneDiagnostic();
    elements.distribution.hidden = true;
    installPlaybackPlan(runOutput);
    startPlayback();
  } catch (error) {
    showPlaybackError(error);
  }
});

elements.playPauseButton.addEventListener("click", () => {
  unlockAndPreload();
  if (isPlaying()) stopPlayback();
  else startPlayback();
});

// Replay: same seed, same already-resolved result -- just re-plays
// state.lastTrace from the top. renderPitch() puts every marker back at
// its authored position first (undoing whatever the previous playback's
// nudging left on screen -- the DOM only, never state.roster itself, so
// this is always a correct, complete reset).
elements.replayButton.addEventListener("click", () => {
  if (!state.lastTrace) return;
  unlockAndPreload();
  stopPlayback();
  state.stepIndex = 0;
  renderPitch();
  clearStepEffects();
  resetTouchTrail();
  renderTrace(0);
  renderOneOnOneDiagnostic();
  lastRenderedCueTime = -1;
  lastRenderedTraceIndex = 0;
  state.playbackTimeMs = 0;
  playbackClock?.replay();
});

// New Outcome: new seed, but the CURRENT authored setup -- no snapshot
// capture/restore branching needed anymore (that existed only because
// animation used to corrupt the authored positions it needed to restore
// from; it no longer touches them at all, so they're always already
// correct).
elements.rerollButton.addEventListener("click", () => {
  if (!currentModeIsReady()) return;
  unlockAndPreload();
  stopPlayback();
  state.seed += 1;
  elements.seed.textContent = String(state.seed);
  renderPitch();
  const runOutput = runOnce(state.seed);
  state.lastMode = state.mode;
  state.lastTrace = runOutput.trace;
  state.lastRun = buildLastRun(state.seed, runOutput);
  state.stepIndex = 0;
  clearStepEffects();
  resetTouchTrail();
  renderTrace(0);
  renderOneOnOneDiagnostic();
  elements.distribution.hidden = true;
  // Unlike playButton's own handler just above, this had no try/catch at
  // all (2026-08-21 fix) -- installPlaybackPlan() had already destroyed
  // the OLD playbackClock (its very first line) by the time a validation
  // throw aborted it, so a failure here left NO clock running at all
  // while state.lastTrace/renderTrace() above had already updated to the
  // NEW roll's content -- the log/inspector text visibly advances to a
  // real, correct trace while the pitch itself never animates again,
  // reading exactly as "the game froze" with no visible cause. The
  // underlying validation failure (contact-point precision drift on some
  // small fraction of rolls, see MATCH_LAB_PLAN.md) is a separate,
  // deeper, pre-existing issue this doesn't fix -- this only ensures a
  // failure surfaces as the same visible, recoverable error playButton's
  // handler already shows, instead of a silent, unrecoverable freeze.
  try {
    installPlaybackPlan(runOutput);
    startPlayback();
  } catch (error) {
    showPlaybackError(error);
  }
});

elements.stepButton.addEventListener("click", () => {
  if (!state.lastTrace) return;
  stopPlayback();
  if (!playbackClock) return;
  if (playbackClock.getState().timeMs >= state.lastPlan.durationMs - 0.001) {
    renderPitch();
    clearStepEffects();
    lastRenderedCueTime = -1;
    lastRenderedTraceIndex = 0;
    state.stepIndex = 0;
    playbackClock.seek(0);
    return;
  }
  playbackClock.step();
});

// Three fixed speed steps for now, addressed by the range input's index
// (0/1/2) rather than its value directly -- keeps the bar's native step
// snapping while the actual playback rate stays whatever's in this array.
const SPEED_STEPS = [0.5, 1, 2];
function updateSpeedValue() {
  state.speed = SPEED_STEPS[Number(elements.speedSelect.value)] ?? 1;
  if (elements.speedValue) elements.speedValue.textContent = `${state.speed}×`;
}
elements.speedSelect.addEventListener("input", () => {
  updateSpeedValue();
  playbackClock?.setRate(state.speed);
});
updateSpeedValue();

elements.attackingDirectionSelect.value = state.attackingDirection.home;
elements.attackingDirectionSelect.addEventListener("change", () => {
  const home = elements.attackingDirectionSelect.value === "up" ? "up" : "down";
  state.attackingDirection = { home, away: home === "up" ? "down" : "up" };
});

function updateSoundToggle() {
  elements.soundCheckbox.checked = isSoundEnabled();
}
elements.soundCheckbox.addEventListener("change", () => {
  // A direct click, same as Roll/Play/Replay/Reroll -- also a valid place
  // to unlock the AudioContext (turning sound ON is itself a user gesture).
  unlockSound();
  setSoundEnabled(elements.soundCheckbox.checked);
  updateSoundToggle();
});
elements.volumeInput.addEventListener("input", () => {
  setMasterVolume(Number(elements.volumeInput.value));
});
elements.volumeInput.value = String(getMasterVolume());
updateSoundToggle();

// Back to Setup: stop playback, clear the result, show the authored
// setup -- never wipes the roster (the authored setup IS whatever's
// currently placed; there's no separate "before the roll" state to fall
// back to anymore, since nothing mutates it). To clear the pitch
// entirely, remove players individually (the existing per-row ✕ button).
elements.resetButton.addEventListener("click", () => {
  stopPlayback();
  renderPitch();
  clearStepEffects();
  resetTouchTrail();
  renderRoster();
  renderRoleRequirements();
  renderActionTable();
  clearResults();
});

elements.runNButton.addEventListener("click", () => {
  if (!currentModeIsReady()) return;
  // Run N shows a distribution instead -- a lingering single-roll
  // diagnostic panel from a previous Roll would be stale/misleading here.
  // Saved and restored (not just cleared) around the loop below: each of
  // the N iterations calls the one-on-one scenario's run(), which sets
  // state.lastOneOnOneDiagnostic as a side effect every time -- without
  // restoring it, whichever iteration happened to run last would silently
  // overwrite the diagnostic belonging to the actual last single Roll, and
  // a subsequent Replay (which replays that old trace, untouched by Run N)
  // would show a mismatched panel once re-shown.
  const savedDiagnostic = state.lastOneOnOneDiagnostic;
  state.lastOneOnOneDiagnostic = null;
  renderOneOnOneDiagnostic();
  const count = Math.max(
    2,
    Math.min(2000, Number(elements.runCountInput.value) || 200),
  );
  const tally = new Map();
  for (let index = 0; index < count; index += 1) {
    const { result } = runOnce(`${state.seed}:run:${index}`);
    tally.set(result.outcome, (tally.get(result.outcome) || 0) + 1);
  }
  state.lastOneOnOneDiagnostic = savedDiagnostic;
  const sorted = [...tally.entries()].sort((left, right) => right[1] - left[1]);
  elements.distributionCount.textContent = String(count);
  elements.distribution.hidden = false;
  elements.distributionList.innerHTML = sorted
    .map(([outcome, hits]) => {
      const percent = Math.round((hits / count) * 100);
      return `
      <li>
        <span>${outcome}</span>
        <span class="match-lab-distribution-bar" style="width:${Math.max(4, percent)}px"></span>
        <span>${percent}% (${hits})</span>
      </li>
    `;
    })
    .join("");
});

function renderOneOnOneDiagnostic() {
  const diagnostic = state.lastOneOnOneDiagnostic;
  if (
    !diagnostic ||
    state.lastMode !== "probe" ||
    state.scenario.id !== "one-on-one-decision"
  ) {
    elements.oneOnOneDiagnostic.hidden = true;
    return;
  }
  elements.oneOnOneDiagnostic.hidden = false;
  elements.oneOnOneSelected.textContent = diagnostic.selectedAction;
  elements.oneOnOneReasons.textContent = diagnostic.reasons.length
    ? diagnostic.reasons.join(", ")
    : "(none)";
  elements.oneOnOneCandidates.innerHTML = diagnostic.candidates
    .map(
      (candidate) => `
    <li${candidate.action === diagnostic.selectedAction ? ' data-selected="true"' : ""}>
      <span>${candidate.action}</span>
      <span class="match-lab-one-on-one-bar" style="width:${Math.max(4, Math.round((candidate.utility + 1) * 40))}px"></span>
      <span>${candidate.utility.toFixed(3)}</span>
    </li>
  `,
    )
    .join("");
  const execution = diagnostic.execution;
  elements.oneOnOneResult.textContent = execution
    ? `${execution.code}${execution.goal ? " -- GOAL" : execution.deferred ? " -- deferred" : ""}`
    : "(none)";
  const EXECUTION_FIELDS = [
    ["Keeper action", "keeperAction", ""],
    ["Ball result", "ballResult", ""],
    ["Keeper travel", "keeperTravelYards", "yd"],
    ["Execution quality", "executionQuality", ""],
    ["Pass completed", "passCompleted", ""],
    ["Duel won", "won", ""],
  ];
  elements.oneOnOneExecution.innerHTML = execution
    ? EXECUTION_FIELDS.filter(([, key]) => execution[key] !== undefined)
        .map(([label, key, suffix]) => {
          const value = execution[key];
          const display =
            value === null
              ? "unknown"
              : typeof value === "number"
                ? `${Math.round(value * 1000) / 1000}${suffix}`
                : String(value);
          return `<dt>${label}</dt><dd>${display}</dd>`;
        })
        .join("")
    : "";
  const STATE_FIELDS = [
    ["Depth from goal line", "depthFromGoalLineYards", "yd"],
    ["Lateral offset", "lateralOffsetYards", "yd"],
    ["Distance to shooter", "distanceToShooterYards", "yd"],
    ["Exposed side", "exposedSide", ""],
    ["Movement direction", "movementDirection", ""],
    ["Closing speed", "closingSpeed", ""],
    ["Set", "set", ""],
  ];
  const renderState = (source) =>
    STATE_FIELDS.map(([label, key, suffix]) => {
      const value = source[key];
      const display =
        value === null || value === undefined
          ? "unknown"
          : typeof value === "number"
            ? `${Math.round(value * 10) / 10}${suffix}`
            : String(value);
      return `<dt>${label}</dt><dd>${display}</dd>`;
    }).join("");
  elements.oneOnOneActualState.innerHTML = renderState(
    diagnostic.actualKeeperState,
  );
  elements.oneOnOnePerceivedState.innerHTML = renderState(
    diagnostic.perceivedKeeperState,
  );
}

function clearResults() {
  stopPlayback();
  clearStepEffects();
  state.lastTrace = null;
  state.lastPlan = null;
  state.playbackTimeMs = 0;
  playbackClock?.destroy();
  playbackClock = null;
  state.stepIndex = 0;
  state.lastOneOnOneDiagnostic = null;
  elements.trace.hidden = true;
  elements.stepButton.hidden = true;
  elements.distribution.hidden = true;
  renderOneOnOneDiagnostic();
  // stopPlayback() above already calls this, but BEFORE lastTrace is
  // nulled out just below it -- called again here so Play/Pause's
  // disabled state actually reflects the now-cleared trace.
  updatePlayPauseButton();
}

// --- Init ---------------------------------------------------------------

elements.seed.textContent = String(state.seed);
renderScenarioOptions();
renderScenarioDetails();
renderRoster();
renderPitch();
renderActionTable();
updateInspector();
setMode("freeplay");
loadDatabases().then(runSearch);

// Test-only export surface (tools/test-possession-runner.mjs). Inert in the
// browser: the page loads this file via a plain <script type="module">
// with no import of it anywhere, so these exports have zero consumers and
// zero runtime effect there -- this is what lets the Possession Runner's
// own resolvers/loop be exercised directly with hand-built rosters and
// controlled RNG streams, the same way matchEngineCore.js's resolvers
// already are in tools/test-one-on-one-execution.mjs, instead of only
// being verifiable by hand-inspection in a real browser.
export {
  state,
  runConstructedPossession,
  resolvePass,
  resolveDribble,
  resolveCross,
  resolveShoot,
  resolveReboundScramble,
  resolveAerialClearanceContinuation,
  freePlayGroups,
  buildLastRun,
  FREE_PLAY_RESOLVERS,
  POSSESSION_MAX_ACTIONS,
  pointOf,
  zoneFromPercent,
  moveRosterEntry,
  nudgeToward,
  playbackPositions,
  playbackPointFor,
  applyStepAnimation,
  renderPitch,
  seedPlaybackPositions,
  markerNode,
  engagingOpponent,
  DUEL_RANGE_YARDS,
  traceEvent,
  goalFrameFor,
  attackingGoalY,
  defendingGoalY,
  goalLineY,
  goalPointFor,
  isKeeperBeaten,
  keeperSaveTransition,
  applyOffBallSeparation,
  findKeeperConflict,
  attributionEntryMarkup,
  outfieldSlotsFor,
  classifyOutfieldBand,
  restingBallOffsetPx,
  lateralChannelX,
  labelVisibleFor,
  visionConeRadiusYards,
  visionConeHalfAngleRad,
  visionFadeDurationMs,
  buildVisionConePath,
  scanQuality,
  scanAmplitudeRad,
  scanPeriodMs,
  scanOffsetRad,
  INTERLEAVED_REACTION_FRACTION,
  INTERLEAVED_DEFENSIVE_REACTION_FRACTION,
  playerDatabaseHref,
  relevantHoverAttributes,
  positionGroupFor,
  resolvePassAccuracy,
  passFlightDurationMs,
  shotPlacementQuality,
  shotPlacementSpread,
  freePlayOneOnOneContext,
  resolveFreePlayOneOnOne,
  executeOneOnOneAction,
  netPointFor,
  GOAL_NET_DEPTH_MARGIN,
  GOAL_LEFT_POST_X,
  GOAL_RIGHT_POST_X,
  // Continuous World Motion During Ball Flight v1 (2026-08-20) -- re-exported
  // so tools/test-possession-runner.mjs's own acceptance tests can inspect
  // the same physics primitives resolvePass()/reactOffBallContinuous()
  // actually use, instead of re-deriving expected values by hand.
  reactOffBallContinuous,
  sampleContinuousTrajectory,
  earliestReachableInterception,
  CONTACT_REACTION_DELAY_MS,
};
