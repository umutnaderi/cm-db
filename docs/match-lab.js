import { PENALTY_SPOT_DEPTH_PCT as RESTART_PENALTY_DEPTH } from "./src/lib/pitchGeometry.js";
import { createMatchSession } from "./src/lib/matchSession.js?v=20260909-02";
import {
  createMatchTelemetry,
  observeMatchFrame,
  observeMatchEvent,
  lastTenMinutePossession,
  heatForScope,
  statsForTeam,
} from "./src/lib/matchTelemetry.js?v=20260909-03";
import { buildHighlightWindows, isHighlightTime, advanceHighlightTime } from "./src/lib/matchHighlights.js?v=20260909-01";
import { applyKickoffInstructions } from "./src/lib/kickoffInstructions.js?v=20260909-01";
import {
  applyCoordinationCandidateBiases,
  coordinateInteraction,
  createCoordinationState,
} from "./src/lib/coordinationCoordinator.js?v=20260911-02";
import {
  assessKeeperCloseDown,
  planKeeperResponse,
  chooseGoalCover,
  outfieldPositionAheadOfKeeper,
  observeKeeperMotion,
  executeKeeperSweep,
} from "./src/lib/keeperDecision.js?v=20260911-02";
import {
  getDatabases,
  getDraftCandidates,
  getPlayerMetrics,
  searchPlayers,
} from "./src/lib/retroballApi.js?v=20260818-66";
import {
  clamp,
  computePressure,
  conditionMultiplier,
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
  resolveReceive,
  resolveRoundKeeper,
  resolveSquarePass,
  resolveWall,
  seededRandom,
  selectEngagement,
  selectFinishType,
  selectFreeKickShotType,
  selectReceiver,
  transitionShotChance,
  weightedChoice,
  weightedPlayer,
  ZONE_CENTERS,
} from "./src/lib/matchEngineCore.js?v=20260827-01";
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
  carrySteeringWaypoint,
  chooseCandidate,
  classifyOutfieldBand,
  clearanceDanger,
  crossSourceContestDefender,
  decisionOptionMetrics,
  deliveryLandingPoint,
  determineCarryGait,
  effectiveCarryPressure,
  staminaScaledPlayer,
  DUEL_RANGE_YARDS,
  engagingOpponent,
  heldKeeperStandoffTarget,
  generateClearanceCandidates,
  generateFreePlayCandidates,
  isCrossTargetZone,
  keeperPositioningPoint,
  laneObstruction,
  nearestLaneInterceptor,
  PITCH_LENGTH_YARDS,
  offsideSnapshotForTarget,
  planAttackerRepositioning,
  planCarryDestination,
  planDefensiveRepositioning,
  identifyLineBreakingRunnerId,
  pressureAt,
  progressionYards,
  longRangeShotConfidence,
  shootingInstructionFor,
  CONGESTION_SHORT_PASS_YARDS,
  CONGESTION_MIN_PROGRESSION_YARDS,
  shotAngleTightness,
  distanceToGoalYards,
  effortScaledAdvance,
  fromYardPoint,
  pointAheadYards,
  reflectIntoRange,
  simulateCarryTouches,
  toYardPoint,
  yardDistance,
  classifyPitchExit,
} from "./src/lib/spatialDecision.js?v=20260913-01";
import {
  buildMatchLabPlaybackPlan,
  sampleMatchLabPlaybackPlan,
  createMatchLabPlaybackClock,
  MATCH_LAB_PLAYBACK_BUILD,
} from "./src/lib/matchLabPlayback.js?v=20260908-01";
import {
  contactArrivalTiming,
  sampleContinuousTrajectory,
  earliestReachableInterception,
  CONTACT_REACTION_DELAY_MS,
  movementDistanceYards,
  pointAlongMovement,
} from "./src/lib/matchMovementTiming.js?v=20260827-01";
import {
  rollStopDistanceYards,
  rollStopDurationMs,
  rollTraveledYards,
  rollDurationForDistance,
  buildRollingBallTrajectory,
} from "./src/lib/ballRollPhysics.js?v=20260911-01";
import {
  claimLooseBall,
  CLAIM_MIN_ROLL_SPEED_YPS,
  evaluateLiveClaimantHandoffs,
} from "./src/lib/ballClaim.js?v=20260911-01";
import { timeToReach, topSpeed, reachIn,
} from "./src/lib/playerKinetics.js?v=20260828-01";
import {
  motionEffortCost, isRecoveryMotion, netBurstChange,
} from "./src/lib/motionEffort.js?v=20260906-02";
import { measurePlaybackFluidity, createRendererGapMonitor } from "./src/lib/matchFluidityDiagnostics.js";
const rendererGapMonitor = createRendererGapMonitor();
import { goalFrameContact, reflectBallVelocity, parryBallVelocity, projectRebound, reboundGoalCrossing,
  FRAME_RESTITUTION } from "./src/lib/ballReboundPhysics.js";
import {
  selectPassType,
  passFlightProfile,
  buildPassFlight,
  ballPositionAtElapsed,
  contactBandForHeight,
  earliestReachableContact,
  simulateFlightUntilContact,
  playerMaxReachYards,
  jumpReachYards,
  reactionDelayMsFor,
} from "./src/lib/matchPassFlight.js?v=20260913-01";
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
  GOAL_HEIGHT_YARDS,
  PITCH_WIDTH_YARDS,
  PENALTY_AREA,
  attackingGoalYForDirection,
  defendingGoalYForDirection,
} from "./src/lib/pitchGeometry.js";
import { onsideLineTargetY } from "./src/lib/matchOffside.js";
import { captureScenario } from "./src/lib/replayHarness.js?v=20260908-03";
// World Motion Contract v1 (2026-09-03) -- see MATCH_ENGINE_ARCHITECTURE.md.
// advanceMotion() is the ONLY sanctioned way to turn a tactical target
// into an authoritative position: it moves a player from where they
// actually are, at the speed they are actually carrying, for the window
// they actually get -- never straight onto the target.
import {
  advanceMotion, advanceKeeperSaveMotion, keeperSaveTravel, readMotionRecord, speedYpsFromVelocity, writeMotionRecord, continueMotionIntentions, velocityAlong,
} from "./src/lib/worldMotion.js?v=20260911-01";
// Match Setup Integration v1 (2026-09-04). Every one of these is a pure,
// DOM-free module -- Match Lab is the CONSUMER of the setup model, never a
// second copy of it. In particular the historical squad catalogue is never
// redeclared here; it is read from src/data/historicalSquads.js.
import {
  findHistoricalSquad, listHistoricalSquads,
} from "./src/data/historicalSquads.js?v=20260908-01";
import { resolveHistoricalSquad } from "./src/lib/historicalSquadResolver.js?v=20260904-02";
import {
  FORMATION_NAMES, MATCH_FORMAT_NAMES, orientSlots, projectFormation, roleBand,
} from "./src/lib/formationTemplates.js?v=20260904-01";
import {
  DUTIES, SHOOTING_INSTRUCTIONS, TEMPO_INSTRUCTIONS,
  GOALKEEPER_DISTRIBUTIONS, GOALKEEPER_SWEEPING,
  assignPlayer as assignSetupPlayer, createMatchSetup, createTeamSetup,
  setSlotInstruction, tacticalRoleLabel, tacticalRolesForPosition, validateMatchSetup,
} from "./src/lib/matchSetup.js?v=20260908-05";
import {
  applyTacklingInstruction, DEFAULT_TEAM_ATTACKING, DEFAULT_TEAM_DEFENDING,
  DEFAULT_TEAM_TRANSITION, normalizeTeamAttacking, normalizeTeamDefending,
  normalizeTeamTransition,
} from "./src/lib/teamInstructions.js?v=20260908-02";
import {
  createRestartSetup, validateGeneratedRestartSetup, validateRestartSetup, wallPositions,
} from "./src/lib/restartSetup.js?v=20260904-04";
import { assignLineup } from "./src/lib/lineupAssignment.js?v=20260908-01";
// Action Pattern Schema v1 (2026-09-05) -- read-only diagnostics. The
// registry itself is consumed inside spatialDecision.js; Match Lab only
// displays what the last evaluation decided.
import { lastActionPatternDiagnostics } from "./src/lib/spatialDecision.js?v=20260913-01";
import { executeRestart } from "./src/lib/restartExecution.js?v=20260912-01";
import {
  planRestartPreparation, planRestartSupportMovement, qualifiesForLongThrow,
  restartSupportReactionDelay,
} from "./src/lib/restartPreparation.js?v=20260912-01";
import {
  assignRestartRoles, isWallCandidate, selectRestartTaker, wallSizeFor,
} from "./src/lib/restartRoles.js?v=20260904-04";
import { candidateKey, isGoalkeeperCandidate } from "./src/lib/positionFit.js?v=20260904-01";
import {
  resolveCornerAttack, resolveCornerDefence, resolveCornerPlan, createTeamCornerPlan,
} from "./src/lib/cornerSetup.js?v=20260906-01";
import { resolveBodyOverlaps } from "./src/lib/playerBody.js?v=20260906-01";
import {
  createTeamPhaseState, phaseForTeam, updateTeamPhaseState,
} from "./src/lib/teamPhase.js?v=20260908-02";
import {
  coordinateTeamShape, phaseAnchorSelectionFor, teamShapeMetrics,
} from "./src/lib/teamShape.js?v=20260911-02";
import {
  buildRoleOccupancyMap,
} from "./src/lib/roleOccupancyMap.js?v=20260908-02";
import {
  classifyTacticalRegion, DEPTH_BOUNDARIES_YARDS, LANE_BOUNDARIES_YARDS,
  TACTICAL_DEPTH_BANDS, VERTICAL_LANES, tacticalRegionId,
} from "./src/lib/pitchRegions.js?v=20260904-01";

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
// logic. Continuous `{x,y}` coordinates are the authoritative physics
// world. The legacy 12-zone index remains beside them for unmigrated engine
// lookups, while pitchRegions.js supplies a separate 5x6 tactical diagnostic
// lens; neither classification ever replaces or snaps the real coordinate.
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

// "plays a throw pass" reads oddly for the one passType that isn't
// actually kicked -- a keeper's own hand throw (2026-08-25). Every other
// passType keeps the exact existing phrasing.
function passVerbPhrase(passType, verb) {
  if (!String(passType).includes("throw")) return `${verb} a ${passType.replace("-", " ")} pass`;
  if (passType === "long-throw") return verb === "attempts" ? "attempts a long throw" : "launches a long throw";
  return verb === "attempts" ? "attempts a throw" : "throws it";
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

// CHOICE weight only (2026-08-26, Passing v3) -- picking WHICH of several
// eligible defenders contests an aerial/chest ball, never a second success
// roll (that's contestedRace()/localizedDuel()'s own job once the picked
// pair actually duels).
function sumPlayerAttributes(player, labels) {
  return labels.reduce((sum, label) => sum + playerAttribute(player, label), 0);
}

// The shared transitionShotChance() (matchEngineCore.js) is also used by
// draft-run.js's own counter-attack mechanic, which already compensates
// for what's fixed here with its own local tactical/momentum/man-down
// multiplier stack before re-clamping to a HIGHER ceiling of its own (see
// that file's shotChance() wrapper) -- so this stays LOCAL to Match Lab's
// own uncontested-rebound call sites (resolveReboundScramble and its 4
// near-duplicates below) rather than changing the shared formula itself,
// which stays exactly as draft-run.js's own real-world-benchmarked
// calibration (tools/keeper_save_audit.mjs) expects it.
//
// Every one of those call sites used transitionShotChance()'s raw result
// with no such compensation (2026-08-25 -- reported directly: "the
// subsequent shoot accuracy is too low" for a close-range chance right
// after a keeper parry). The root cause: transitionShotChance()'s own
// internal (0.45 + share*1.1) * 0.4 scaling means its real achievable
// range for a baseChance of 0.32 is only ~5.8%-19.8% -- the 32% figure
// passed in is never actually reachable, even for a fully attacker-
// dominant matchup. REBOUND_SHOT_CHANCE_SCALE (1 / 0.62, the exact
// maximum of that internal scaling factor) restores baseChance as a
// genuinely reachable ceiling again.
const REBOUND_SHOT_CHANCE_SCALE = 1 / 0.62;
function reboundShotChance(shooterPlayer, keeperPlayer) {
  return clamp(
    0.008,
    0.32,
    transitionShotChance(shooterPlayer, keeperPlayer, FIXED_MINUTE, 0.32, poacherScore)
      * REBOUND_SHOT_CHANCE_SCALE,
  );
}

// ---------------------------------------------------------------------------
// Shot As Projectile v1 (2026-08-27) -- the shot-side twin of Kick As
// Projectile v1's own simulateFlightUntilContact() (matchPassFlight.js).
// The old pipeline rolled "is it on target" (resolveFinishAttempt()),
// THEN separately rolled "is the keeper beaten clean" (resolveKeeperSave()'s
// own beatenCleanChance) -- two independent coin flips standing in for
// what is, physically, ONE question: where does the struck ball actually
// cross the goal plane, and can a real body (defender first, keeper
// second) get there before it does. Below: a shot's own aim (still
// brain-driven -- Finishing/Technique/pressure, same skill shape the OLD
// shotPlacementSpread()/shotPlacementQuality() already used) plus a
// genuine geometric error (same "scatter around an intended point" shape
// resolvePassAccuracy()/resolveThroughBallAccuracy() already established
// for the pass side) decide the ACTUAL point in the 8yd x 2.6667yd goal
// mouth the shot is really headed for -- off target is now nothing more
// than that point landing outside the frame, never a separate roll.
// Whether a real body meets it before it gets there is answered by
// genuine reach (a static geometric check for a defender already
// standing on the shot's own line -- a shot is struck too fast for
// meaningful outfield repositioning, so unlike Slice A's receivers,
// defenders here are NOT re-ticked -- and a real, reaction-delayed,
// speed-capped tick for the keeper, who alone has to travel to meet it).
// EXISTING production formulas resolveFinishAttempt()/resolveKeeperSave()/
// resolveShotBlock() (matchEngineCore.js) are explicitly untouched --
// draft-run.js and the remaining deferred Match Lab paths (chip,
// round-keeper and free kicks) keep calling them exactly as before. Crossed
// headers retain those established finish/save rolls, but now use this same
// physical keeper envelope to decide whether the selected save can happen.
// The fully geometric aim/error model itself feeds resolveShoot()'s open-play
// path and resolveFreePlayOneOnOne()'s place-*/blast execution.
//
// Deliberately kept in match-lab.js, not matchPassFlight.js -- every OTHER
// shot-mouth-only geometry helper (shotPlacementSpread/Quality,
// postPointFor, missPointFor, GOAL_LEFT_POST_X, etc, all just above) is
// already local to this file for the same reason: a shot's own "mouth"
// coordinate system (a signed lateral yard offset from goal center, plus
// a height in yards) is not the pitch-plane world matchPassFlight.js
// models, and forcing it in there would blur that file's own scope
// rather than share it.
const SHOT_MOUTH_HALF_WIDTH_YARDS = GOAL_WIDTH_YARDS / 2;
// A short, reactive lunge -- a defender is not chasing the shot the way
// an off-ball teammate chases a pass, they are already standing
// somewhere and either their body is close enough to the shot's own
// line or it isn't. Gameplay v3's own spec figure ("body within ~1.2yd
// of the segment") -- a real body's own effective width/reach, not a
// tactical radius (the same order of magnitude as Slice A's own
// CHASE_INTERCEPT_ALLOWANCE_YARDS, but shots earn their own constant
// rather than sharing that name across two different contexts).
const SHOT_BLOCK_REACH_YARDS = 1.2;
// "1.2yd arm" -- a keeper's own short dive/reach beyond their standing
// body, BEFORE jumpReachYards() (matchPassFlight.js, exported for this)
// adds whatever extra height a real leap contributes. Combined, this is
// the keeper's own save envelope radius, checked against the ball's
// LATERAL gap only (heightReachable below is the separate, existing
// playerMaxReachYards() vertical gate Slice A's own contact bands
// already use) -- two independent gates, not one combined sphere, so a
// keeper standing right under a shot that's sailing in above their own
// max reach can't "borrow" lateral slack to somehow still get there.
const KEEPER_DIVE_ARM_YARDS = 1.2;
// Open-play shot pace, yards/second -- well above any pass type
// (matchPassFlight.js's own fastest, driven-ground, tops out at 26) since
// a struck shot is a fundamentally harder-hit ball than any delivery
// meant to be received. Blast trades placement for genuine extra pace,
// same tradeoff resolvePlacedFinish()'s own power:true branch already
// encodes.
const SHOT_SPEED_YARDS_PER_SECOND = { calm: 27, finesse: 25, blast: 37 };
// A headed finish is slower than a clean foot strike, but its flight still
// has to own real time. The old fixed 350ms header beat completed the ball's
// whole journey before the goalkeeper began a separate save animation. That
// left the ball waiting near the post while the eventual catcher was still
// several yards away. This speed gives the existing header outcome a physical
// flight window without changing the delivery or aerial-contest rolls.
const HEADER_SHOT_SPEED_YARDS_PER_SECOND = 22;
const HEADER_SHOT_HEIGHT_YARDS = 1.35;
// A geometric miss that clips the frame's own bar always reuses
// F.BLAST.OVER -- the one open-play code MISS_BADGE (above) maps to the
// "OVER" badge at all. Its raw string is never rendered to the user
// (traceEvent()'s own label is hardcoded "Off target", not derived from
// the code) so reusing it for a calm/finesse attempt that genuinely
// balloons over is a real accuracy improvement over the OLD flat
// per-finishType table, not a mismatch -- and blast keeps its OLD
// unconditional "F.BLAST.OVER" for ANY off-target result (wide or high),
// exactly matching resolveFinishAttempt()'s own previous behavior for
// blast, since there is no separate "wide" badge scoped to it.
const GEOMETRIC_WIDE_MISS_CODE = { calm: "F.CALM.WEAK", finesse: "F.FINESSE.WIDE" };

function percentXToCenterYards(percentX) {
  return ((percentX - 50) / 100) * PITCH_WIDTH_YARDS;
}
function centerYardsToPercentX(offsetYards) {
  return 50 + (offsetYards / PITCH_WIDTH_YARDS) * 100;
}

// Height component of the shot's own INTENDED aim -- Finishing/Technique
// driven, same skill shape shotPlacementQuality() already uses for the
// lateral side. A weak/rushed effort stays low (an honest, saveable
// height); a composed, technical finisher picks genuine elevation,
// capped well under the bar so INTENTION alone is never what beats it --
// that's what the geometric error below is for.
function shotIntentHeightYards(shooterPlayer, quality, pressure) {
  const composed = clamp(0, 1, quality - pressure * 0.2);
  return clamp(0.2, GOAL_HEIGHT_YARDS * 0.75, 0.25 + composed * 1.55);
}

// Real, non-zero geometric error -- see resolvePassAccuracy()'s own
// comment on the reported bug this same shape fixed for passing (a
// laser-guided delivery every time regardless of skill). Scattered as a
// single radius in the (lateral yards, height yards) plane below, exactly
// like deliveryLandingPoint() already scatters a pass's own landing
// point in the (pitch x, pitch y) plane -- same principle, different
// plane. `power` (blast) both raises the penalty AND is the one case
// that keeps resolveFinishAttempt()'s own real calibration note relevant
// here: "blast sacrifices accuracy for power."
function resolveShotAccuracy(shooterPlayer, { pressureFactor = 0, power = false } = {}, random) {
  const finishing = playerAttribute(shooterPlayer, "Finishing");
  const technique = playerAttribute(shooterPlayer, "Technique");
  const composure = playerAttribute(shooterPlayer, "Composure");
  const skill = (finishing * 0.45 + technique * 0.35 + composure * 0.2) / 20;
  const powerPenalty = power ? 0.24 : 0;
  const pressurePenalty = clamp(0, 0.3, pressureFactor * 0.4);
  const quality = clamp(0.05, 0.95, skill - powerPenalty - pressurePenalty);
  // A real spread even at elite quality -- no two shots, even from a
  // maxed-out finisher, land at exactly the same spot. A base term that
  // never fully vanishes (0.15 + skill-scaled) combined with a genuinely
  // wide random multiplier keeps a real range of outcomes even for the
  // best strikers, rather than every attempt landing within a fraction
  // of a yard of the same point (which made "on target and geometrically
  // reachable" collapse into a near-binary threshold instead of a real
  // distribution).
  const errorYards = clamp(0.2, 4.8, (0.15 + (1 - quality) * 4.3) * (0.35 + random() * 1.15));
  return { quality, errorYards };
}

// The full shot-mouth descriptor: an intended point (brain-driven aim,
// reusing shotPlacementSpread()'s own proven "away from the keeper's
// current x" horizontal logic UNCHANGED, plus the new height term above)
// scattered by a real geometric error into an ACTUAL point -- which may
// or may not still be inside the frame. Consumes exactly 2 random() calls
// beyond shotPlacementSpread()'s own (the error magnitude, then the
// scatter angle), same "one shot, one deterministic draw" contract every
// other accuracy model in this project already holds.
function resolveShotDescriptor(shooterEntry, keeperEntry, finishType, pressure, random) {
  const quality = shotPlacementQuality(shooterEntry.player);
  const intendedSpread = shotPlacementSpread(shooterEntry, keeperEntry, pressure, random);
  const intendedOffsetYards = percentXToCenterYards(intendedSpread.x);
  const intendedHeightYards = shotIntentHeightYards(shooterEntry.player, quality, pressure);
  const accuracy = resolveShotAccuracy(shooterEntry.player, { pressureFactor: pressure, power: finishType === "blast" }, random);
  const angle = random() * Math.PI * 2;
  const actualOffsetYards = intendedOffsetYards + Math.cos(angle) * accuracy.errorYards;
  const actualHeightYards = Math.max(0, intendedHeightYards + Math.sin(angle) * accuracy.errorYards);
  const onTarget = Math.abs(actualOffsetYards) <= SHOT_MOUTH_HALF_WIDTH_YARDS
    && actualHeightYards <= GOAL_HEIGHT_YARDS;
  const goalY = goalLineY(shooterEntry);
  const actualPoint = {
    zone: shooterEntry.zone,
    x: clamp(0, 100, centerYardsToPercentX(actualOffsetYards)),
    y: goalY,
  };
  const missCode = actualHeightYards > GOAL_HEIGHT_YARDS || finishType === "blast"
    ? "F.BLAST.OVER"
    : (GEOMETRIC_WIDE_MISS_CODE[finishType] || "F.CALM.WEAK");
  const speedYardsPerSecond = SHOT_SPEED_YARDS_PER_SECOND[finishType] || SHOT_SPEED_YARDS_PER_SECOND.calm;
  const distanceYards = movementDistanceYards(pointOf(shooterEntry), actualPoint);
  const durationMs = Math.max(80, (distanceYards / speedYardsPerSecond) * 1000);
  return {
    onTarget,
    missCode,
    actualPoint,
    actualHeightYards,
    quality: accuracy.quality,
    flight: {
      from: pointOf(shooterEntry),
      actual: actualPoint,
      peakHeightYards: actualHeightYards,
      speedYardsPerSecond,
      durationMs,
    },
  };
}

// Rises from the shooter's own foot (height 0) to EXACTLY the shot's own
// actual height at the goal line (progress 1) -- deliberately NOT the
// symmetric up-then-down arc buildPassFlight()'s ballHeightAtProgress()
// uses for a pass (which has to come back down to land ON the pitch); a
// shot only ever needs its height AT the goal plane, and a real struck
// ball's height accelerates as it travels rather than peaking partway.
function shotHeightAtProgress(actualHeightYards, progress) {
  const p = clamp(0, 1, progress);
  return Math.max(0, actualHeightYards) * p * p;
}

function shotPositionAtElapsed(flight, elapsedMs) {
  const progress = flight.durationMs > 0 ? clamp(0, 1, elapsedMs / flight.durationMs) : 1;
  const traveled = movementDistanceYards(flight.from, flight.actual) * progress;
  const point = pointAlongMovement(flight.from, flight.actual, traveled);
  return { ...point, height: shotHeightAtProgress(flight.peakHeightYards, progress) };
}

function headerShotFlight(contactPoint, aimPoint) {
  const distanceYards = movementDistanceYards(contactPoint, aimPoint);
  return {
    // The receiver may have moved from their authored setup coordinate to
    // meet the cross. The aerial event's contactPoint is where the header is
    // actually struck and is therefore the only legal flight origin.
    from: { ...contactPoint },
    actual: aimPoint,
    peakHeightYards: HEADER_SHOT_HEIGHT_YARDS,
    speedYardsPerSecond: HEADER_SHOT_SPEED_YARDS_PER_SECOND,
    durationMs: Math.max(
      120,
      (distanceYards / HEADER_SHOT_SPEED_YARDS_PER_SECOND) * 1000,
    ),
  };
}

// A defender is not re-ticked during a shot -- see this section's own
// header comment for why (too fast an event for meaningful outfield
// repositioning). A STATIC check: the closest point on the shot's own
// straight line to where this defender is already standing, and whether
// the ball's real height AT that specific point (not at the goal line --
// a close-range block happens well before the shot has climbed toward
// its own eventual mouth height) is inside their own reach band.
function shotBlockingDefender(flight, defenderEntry) {
  if (!defenderEntry) return null;
  const fromYard = toYardPoint(flight.from);
  const toYard = toYardPoint(flight.actual);
  const defenderYard = toYardPoint(defenderEntry);
  const dx = toYard.x - fromYard.x;
  const dy = toYard.y - fromYard.y;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0
    ? 0
    : clamp(0, 1, ((defenderYard.x - fromYard.x) * dx + (defenderYard.y - fromYard.y) * dy) / lengthSquared);
  const closestX = fromYard.x + t * dx;
  const closestY = fromYard.y + t * dy;
  const lateralGapYards = Math.hypot(defenderYard.x - closestX, defenderYard.y - closestY);
  if (lateralGapYards > SHOT_BLOCK_REACH_YARDS) return null;
  const heightAtPoint = shotHeightAtProgress(flight.peakHeightYards, t);
  if (heightAtPoint > playerMaxReachYards(defenderEntry.player)) return null;
  return { atMs: flight.durationMs * t, atPoint: shotPositionAtElapsed(flight, flight.durationMs * t) };
}

// The keeper alone genuinely travels -- reaction delay
// (reactionDelayMsFor(), the same Anticipation/Decisions-driven term
// Slice A's own race uses) then a physical run or committed dive toward the
// shot's own fixed actual point (known in advance, unlike Slice A's
// evolving job targets -- there is nobody else to race here, only a
// single reach-or-don't question). Ticked in the same 40ms steps as
// every other live contact resolver in this project for one reason: if
// keeper travel time exceeds the flight's own remaining time at every
// tick, they never register as reached, regardless of Reflexes --
// attributes decide the SAVE once reached, never whether they get there
// at all.
function simulateShotKeeperEnvelope(flight, keeperEntry, sampleIntervalMs = 40) {
  if (!keeperEntry) return { reached: false };
  const reactionMs = reactionDelayMsFor(keeperEntry.player);
  // The envelope is body travel plus what the keeper can reach beyond it.
  // Reach used to be static (arm + jump), which meant a keeper facing a shot
  // they had two or three tenths of a second to deal with had an envelope of
  // barely two yards -- reachIn() gives a standing start almost no ground in
  // that time, and the arm allowance does not grow. Measured, that made an
  // isolated one-on-one convert 87.3%, with 1758 of 1758 shots to the
  // keeper's open side scoring because they never physically arrived.
  //
  // worldMotion owns both the run/dive reach query and its authored path.
  // The dive uses the existing playerKinetics action impulse; ordinary
  // travel still uses Pace/Acceleration. Playback must reach this same body
  // point when the hand contact is declared.
  const staticReachYards = KEEPER_DIVE_ARM_YARDS + jumpReachYards(keeperEntry.player);
  const duration = flight.durationMs;
  const steps = Math.max(1, Math.ceil(duration / Math.max(1, sampleIntervalMs)));
  for (let step = 0; step <= steps; step += 1) {
    const tMs = Math.min(duration, step * sampleIntervalMs);
    const ball = shotPositionAtElapsed(flight, tMs);
    const availableSeconds = Math.max(0, (tMs - reactionMs) / 1000);
    // A dive COSTS the time it takes -- it is not free ground on top of a
    // full run. The keeper picks whichever the clock actually allows: stay on
    // their feet the whole window, or run for what is left and commit the
    // last DIVE_COMMIT_SECONDS to a launch. Diving wins when there is too
    // little time to build running speed, which is the case this exists for;
    // staying up wins over a long window, where topSpeed beats a dive.
    const traveledYards = keeperSaveTravel(keeperEntry.player, availableSeconds).distanceYards;
    const keeperPoint = pointAlongMovement(keeperEntry, flight.actual, traveledYards);
    const lateralGapYards = movementDistanceYards(keeperPoint, ball);
    const heightReachable = ball.height <= playerMaxReachYards(keeperEntry.player);
    if (lateralGapYards <= staticReachYards && heightReachable) {
      return { reached: true, atMs: tMs, atPoint: keeperPoint, ballPoint: ball };
    }
    if (tMs >= duration) break;
  }
  return { reached: false };
}

// Kept intentionally PARALLEL to resolveKeeperSave()'s own K.SAVE.1-8
// options table (matchEngineCore.js) -- NOT a refactor of it, and NOT
// called instead of it anywhere production-facing. That function stays
// exactly as draft-run.js and the deferred Match Lab paths still use it,
// untouched. Crossed headers retain it for save flavor only after this file's
// physical envelope confirms contact. This differs in exactly
// one way: no beatenCleanChance/K.SAVE.0 gate -- geometric reachability
// (simulateShotKeeperEnvelope() above) already answered "did the keeper
// even get there" before this is ever called; Handling/Reflexes/
// Positioning only ever decide the FLAVOR of a save that's already
// physically happening, the same two-layer split Slice A's own duels use.
function geometricKeeperSaveFlavor(keeperPlayer, finishType, random) {
  const handling = playerAttribute(keeperPlayer, "Handling");
  const reflexes = playerAttribute(keeperPlayer, "Reflexes");
  const positioning = playerAttribute(keeperPlayer, "Positioning");
  const isPower = finishType === "blast";
  const power = isPower ? 1.4 : 1;
  const postProne = !isPower;
  const options = [
    { value: "K.SAVE.1", weight: handling * 2 },
    { value: "K.SAVE.2", weight: Math.max(1, 20 - handling) * power },
    { value: "K.SAVE.3", weight: reflexes + positioning },
    { value: "K.SAVE.4", weight: Math.max(1, 20 - handling) * 0.6 },
    { value: "K.SAVE.5", weight: Math.max(1, 20 - handling) * 0.5 * power },
  ];
  if (postProne) {
    options.push(
      { value: "K.SAVE.6", weight: Math.max(0.5, 8 - positioning * 0.3) },
      { value: "K.SAVE.7", weight: Math.max(0.5, 6 - positioning * 0.2) },
      { value: "K.SAVE.8", weight: Math.max(0.1, 2 - positioning * 0.15) },
    );
  }
  const code = weightedChoice(options, random);
  const rebound = code === "K.SAVE.2" || code === "K.SAVE.5" || code === "K.SAVE.6";
  const goal = code === "K.SAVE.8";
  return { code, goal, rebound };
}

// Same PARALLEL relationship to resolveShotBlock() -- geometry
// (shotBlockingDefender() above) already decided WHETHER a block
// happens; resolveShotBlock()'s own "behind/loose/safe" outcome table
// has no attribute weighting at all (a flat 3/3/2 split), so reusing it
// here directly, with no gate, is a straight copy of 3 numbers, not a
// calibration this project needs to protect two copies of.
function geometricBlockOutcome(random) {
  return weightedChoice([
    { value: "behind", weight: 3 },
    { value: "loose", weight: 3 },
    { value: "safe", weight: 2 },
  ], random);
}

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

// A parry/rebound/loose ball never teleports to its landing spot -- it
// genuinely travels there, a real (if quick) roll/bounce, not the shot's
// own struck-ball pace. Floored at MOVEMENT_DURATIONS.scramble (the same
// floor every other scramble-for-a-loose-ball beat already uses) --
// anything shorter leaves less real time than CONTACT_REACTION_DELAY_MS
// itself, which would make every close-range rebound structurally
// unreachable (nobody can even finish reacting before the ball "arrives"),
// never a genuine contest.
const LOOSE_BALL_SPEED_YARDS_PER_SECOND = 12;
function looseBallFlightMs(distanceYards) {
  return Math.max(
    MOVEMENT_DURATIONS.scramble,
    Math.round((Math.max(0, distanceYards) / LOOSE_BALL_SPEED_YARDS_PER_SECOND) * 1000),
  );
}

// Real duration + trajectory for a player genuinely moving to meet the
// ball at `to` (2026-08-25) -- traceEvent()'s own mover/moveTo shorthand
// (see its header comment) has no trajectory field and falls back to a
// flat MOVEMENT_DURATIONS[movement] duration regardless of real distance.
// Harmless for a short, local adjustment, but a real browser round
// reported a player visibly TELEPORTING specifically because a genuinely
// long move (a rebound scramble spanning real yards, a knock-forward
// reception that can span up to ~75% of the pitch via
// ZONE_TRANSITION_MATRIX's own "bypass" case) rendered in that same flat,
// distance-blind window with no interpolation to speak of. Returns a
// { duration, playerMoves } pair a caller spreads directly into its own
// trace event options in place of a bare mover/moveTo pair.
// World Motion Contract v1 (2026-09-03) -- reactionDelayMs/initialSpeedYps/
// incomingVelocity are optional and default to today's exact behavior
// (react first, then accelerate from rest). A caller that KNOWS this
// player is already running -- a carry's final leg continuing its own
// touches -- passes their real momentum in instead, so the leg continues
// the stride rather than restarting it.
function realMoverTrajectory(mover, to, {
  from = pointOf(mover), floorMs = MOVEMENT_DURATIONS.reposition, action = "advance",
  reactionDelayMs = CONTACT_REACTION_DELAY_MS, initialSpeedYps = 0, incomingVelocity = null,
  paceToArrival = false,
} = {}) {
  let duration = Math.max(
    floorMs,
    Math.ceil(reactionDelayMs + timeToReach(mover.player, yardDistance(from, to), initialSpeedYps) * 1000),
  );
  const entryVelocity = incomingVelocity ?? velocityAlong(from, to, initialSpeedYps);
  let motion = advanceMotion({ from, intentionTarget: to, player: mover.player,
    elapsedMs: duration, reactionDelayMs,
    incomingVelocity: entryVelocity, paceToArrival,
    intention: action, sampleCount: Math.max(10, Math.min(24, Math.ceil(duration / 160))) });
  // timeToReach() is a straight-ahead lower bound. When the player enters
  // this move facing sharply away from the target, worldMotion correctly
  // spends part of that window braking and planting. Extend the authored
  // interval until the same kinetic path actually arrives instead of
  // committing the tactical endpoint after a physically short trajectory.
  for (let attempt = 0; attempt < 3 && !motion.reachedTarget; attempt += 1) {
    const extraMs = Math.max(250, Math.ceil(timeToReach(
      mover.player,
      motion.remainingYards,
      speedYpsFromVelocity(motion.velocity),
    ) * 1000));
    duration += extraMs;
    motion = advanceMotion({ from, intentionTarget: to, player: mover.player,
      elapsedMs: duration, reactionDelayMs,
      incomingVelocity: entryVelocity, paceToArrival,
      intention: action, sampleCount: Math.max(10, Math.min(32, Math.ceil(duration / 160))) });
  }
  return {
    duration,
    playerMoves: [{
      player: mover,
      from,
      to: motion.position,
      action,
      trajectory: motion.trajectory,
      intention: { action, target: to }, reactionDelayMs,
    }],
  };
}

// Ground Roll v2 follow-up (2026-08-28) -- a real reported bug: a
// P.CARRY/P.PROGRESS.WON leg (the carrier's own continuous run, no
// additional touch) used to leave buildBallTrajectory()'s own default
// "controlled-ground" curve to shape the ball's track independently of
// realMoverTrajectory()'s own hermite-blended carrier path -- two
// separately-shaped curves sharing only their two endpoints. When the
// carrier's own path curves into this leg's heading (inheriting velocity
// from whatever direction the LAST touch happened to exit at -- see
// buildMatchLabPlaybackPlan()'s own zeroVelocityAcrossIdleGaps() comment
// on why that velocity is deliberately carried through, not zeroed), the
// RELATIVE vector between the ball's straight/independent curve and the
// carrier's curving one visibly swings around -- read as "the ball
// rotating in front of him" with no real touch to explain it, because
// there wasn't one: this leg has no new contact.
// Fix: derive the ball's own trajectory FROM the exact same trajectory
// array the carrier's own path already uses (byte-identical shape), offset
// by a small real-world lead in this leg's own FIXED overall direction
// (cursor -> destination, computed once, never re-derived per frame) --
// ramped to exactly zero at both ends so it never disturbs the contact
// pin or the chained continuity check against the previous leg's own real
// endpoint. This ball track is rendered directly now (Ball Realism v1,
// 2026-08-31 -- see renderPlaybackFrame()'s own comment), so a fixed,
// non-rotating heading here is what keeps the lead itself reading as one
// smooth arc rather than swinging direction mid-leg.
const CARRY_BALL_LEAD_YARDS = 1.6;
function carryLegBallTrajectory(playerTrajectory, from, to) {
  const dxYards = ((to.x - from.x) / 100) * PITCH_WIDTH_YARDS;
  const dyYards = ((to.y - from.y) / 100) * PITCH_LENGTH_YARDS;
  const length = Math.hypot(dxYards, dyYards) || 1;
  const unitX = dxYards / length;
  const unitY = dyYards / length;
  // A real reported bug: unitX/unitY above is a pure DIRECTION, full
  // magnitude (1.0) the instant `from`/`to` differ by ANY nonzero amount
  // -- even a leftover residual leg of a few THOUSANDTHS of a yard
  // (simulateCarryTouches()'s own spacing threshold routinely leaves one;
  // a real, common case, not a rare edge). That full-strength direction
  // times the FIXED CARRY_BALL_LEAD_YARDS put a 1.6-yard round-trip
  // swing on a ball whose owner barely moved at all -- visually the ball
  // darting out almost two yards and snapping straight back "into" a
  // carrier who never went anywhere, exactly the reported "goes in front
  // then teleports back inside the circle." The lead itself is now
  // capped at the real distance this leg is actually covering, so a
  // near-stationary leg gets a near-zero lead (nothing to visibly swing),
  // while any ordinary multi-yard carry keeps the full, intended 1.6-yard
  // lead unchanged (length comfortably exceeds it already).
  const leadYards = Math.min(CARRY_BALL_LEAD_YARDS, length);
  const samples = playerTrajectory.map((sample) => {
    const ramp = Math.sin(Math.PI * clamp(0, 1, sample.progress));
    const offsetXPct = ((unitX * leadYards * ramp) / PITCH_WIDTH_YARDS) * 100;
    const offsetYPct = ((unitY * leadYards * ramp) / PITCH_LENGTH_YARDS) * 100;
    return {
      progress: sample.progress,
      position: {
        x: clamp(0, 100, sample.position.x + offsetXPct),
        y: clamp(0, 100, sample.position.y + offsetYPct),
        height: 0,
      },
      velocity: sample.velocity,
      verticalVelocity: 0,
      mode: "controlled-ground",
    };
  });
  if (samples.length) {
    samples[0].position = { ...from, height: 0 };
    samples[samples.length - 1].position = { ...to, height: 0 };
  }
  return samples;
}

// A ball IN A PLAYER'S HANDS has no path of its own: it is wherever he is.
//
// A real reported bug (2026-09-07): during GK.HOLD the keeper walks the ball
// around his box, and the event supplied only ballFrom/ballTo. Playback then
// interpolated the ball along a straight line between those two points while
// the keeper followed his real accelerate-and-settle trajectory over the same
// window, so the two started and finished together and visibly drifted apart
// in between -- the ball outside the keeper's own circle for most of the walk.
//
// This is carryLegBallTrajectory()'s problem without the lead. A carried ball
// is knocked ahead of the carrier and deserves CARRY_BALL_LEAD_YARDS; a held
// ball is not knocked anywhere, so it takes the holder's samples exactly.
// The first sample is pinned to the ball's own previous resting point so the
// ball track stays continuous across the seam (addBallTrajectory() rejects a
// discontinuity outright), and every sample after it is the holder's.
function heldBallTrajectory(playerTrajectory, from) {
  const samples = (playerTrajectory ?? []).map((sample) => ({
    progress: sample.progress,
    position: { x: sample.position.x, y: sample.position.y, height: 0 },
    velocity: sample.velocity,
    verticalVelocity: 0,
    mode: "held",
  }));
  if (samples.length && from) samples[0].position = { x: from.x, y: from.y, height: 0 };
  return samples;
}

// Body Avoidance v1 (2026-08-28) -- a real reported bug: a carrier's own
// body walked straight through an opponent standing directly in the way
// during the FINAL P.CARRY/P.PROGRESS.WON leg (no additional touch left
// to steer with -- simulateCarryTouches()'s own per-touch steering only
// ever reaches as far as the last touch's own contact point). Builds a
// real, momentum-preserving two-segment run through a steering waypoint
// (carrySteeringWaypoint()) when the direct line to `to` would pass
// through someone's body radius, carrying leg 1's own exit velocity into
// leg 2 (sampleContinuousTrajectory()'s own incomingVelocity -- no dead
// stop-then-restart at the steering point). Falls straight through to the
// plain single-leg realMoverTrajectory() when the line is already clear
// -- zero behavior change for the ordinary, unobstructed case.
// World Motion Contract v1 (2026-09-03) -- `entrySpeedYps`/`entryVelocity`
// (both optional, both default to "started from rest", so every existing
// caller keeps identical behavior) let the final leg of a carry continue
// the run the touches before it were already making. Without them this
// leg charged a fresh CONTACT_REACTION_DELAY_MS (a stationary dead zone)
// and re-accelerated from 0 yd/s, which is the second half of the
// reported go-stop-go carry: a player mid-sprint does not stop, wait
// 120ms and set off again just because the touches ran out. A genuine
// new stimulus still gets its reaction delay -- a carrier continuing
// their own run is not one.
function carryLegMoverTrajectory(mover, to, opponents, {
  from = pointOf(mover), action = "advance", entrySpeedYps = 0, entryVelocity = null,
} = {}) {
  const via = carrySteeringWaypoint(from, to, opponents);
  let cursor = from, incomingVelocity = entryVelocity ?? velocityAlong(from, to, entrySpeedYps);
  let elapsedMs = 0;
  const samples = [];
  for (const target of via ? [via, to] : [to]) {
    const initial = advanceMotion({from:cursor,intentionTarget:target,player:mover.player,
      elapsedMs:0,incomingVelocity}).entrySpeedYps;
    const duration = Math.ceil(timeToReach(mover.player, yardDistance(cursor,target), initial) * 1000);
    if (!duration) continue;
    const motion = advanceMotion({from:cursor,intentionTarget:target,player:mover.player,
      elapsedMs:duration,incomingVelocity,continuesAfter:true,paceToArrival:false,intention:"carry"});
    for (const sample of motion.trajectory) samples.push({...sample,timeMs:elapsedMs+sample.progress*duration});
    elapsedMs += duration;
    cursor = motion.position;
    incomingVelocity = motion.velocity;
  }
  const trajectory = elapsedMs ? samples.map(sample=>({...sample,progress:sample.timeMs/elapsedMs}))
    : [{progress:0,position:{...from},velocity:incomingVelocity},{progress:1,position:{...from},velocity:incomingVelocity}];
  return {duration:elapsedMs,playerMoves:[{player:mover,from,to:cursor,action,trajectory,
    reactionDelayMs:0,intention:{action:"carry",target:to}}]};
}

// An executed touch can pass the tactical destination. End there instead of
// reversing the runner to recover a coordinate that was only an intention.
function acceptCarryOvershoot(origin, target, touches) {
  const last = touches.at(-1)?.ballTo;
  if (!last) return;
  const a=toYardPoint(origin), b=toYardPoint(target), c=toYardPoint(last);
  const dx=b.x-a.x, dy=b.y-a.y;
  if ((c.x-a.x)*dx+(c.y-a.y)*dy >= dx*dx+dy*dy) {
    Object.assign(target,last,{zone:zoneFromPercent(last.x,last.y)});
  }
}

// Off-Ball Motion v3 (2026-08-26) -- the WHOLE carry/dribble window's own
// real duration (origin to the final destination, the SAME kinetics
// formula realMoverTrajectory() uses for a single leg), for the ONE
// off-ball reaction call that now covers a multi-touch carry, replacing
// the old per-touch reactOffBall() beat (see resolveCarry()/
// resolveDribble()'s own comment on the reported "go-stop-go" bug this
// fixes).
function carryWindowDurationMs(mover, from, to) {
  return Math.max(
    MOVEMENT_DURATIONS.dribble,
    Math.round(CONTACT_REACTION_DELAY_MS + timeToReach(mover.player, yardDistance(from, to)) * 1000),
  );
}

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
  if (save.reboundTransition) return save.reboundTransition;
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
    // A clean catch holds the ball in the hands (see GK_HOLD_MS / the main
    // loop's own GK.HOLD push) -- never set for a dead-ball restart, where
    // there's no next in-possession decision for it to matter to.
    held: deadBallRestart ? undefined : true,
  };
}

// Contact impulse and airborne evolution are shared physics. Ground motion is
// handed back to the possession runner's Dynamic Ball Claim v2, with its real
// velocity (no delivery attenuation and no preselected rebound shooter).
function pushPhysicalReboundEvent(trace, { shooterEntry, keeperEntry, save, contactPoint, strikeMechanics }) {
  const physicsCode = save.physicsCode ?? save.code;
  const previous = [...trace].reverse().find(event => event.ballFrom && event.ballTo);
  const shotFrom = previous?.ballFrom ?? pointOf(shooterEntry);
  const incomingSample = previous?.ballTrajectory?.at(-1);
  const fallbackMs = previous?.duration || 400;
  const incoming = {
    x: (incomingSample?.velocity?.x ?? (contactPoint.x - shotFrom.x) / fallbackMs) * PITCH_WIDTH_YARDS * 10,
    y: (incomingSample?.velocity?.y ?? (contactPoint.y - shotFrom.y) / fallbackMs) * PITCH_LENGTH_YARDS * 10,
    z: (incomingSample?.verticalVelocity ?? 0) * 1000,
  };
  const goalY = goalLineY(shooterEntry);
  const impact = { ...contactPoint, height: incomingSample?.position?.height ?? contactPoint.height ?? 0 };
  let origin = impact, outgoing, kind, normal = null, incidentVelocity = incoming;
  let tipMs = 0;
  if (physicsCode === "K.SAVE.6") {
    const frame = goalFrameContact({ point: impact, goalY, incomingVelocity: incoming });
    origin = frame.point; normal = frame.normal; kind = frame.kind;
    // The already-selected keeper tip delivers the ball to the closest frame
    // surface. The tip leg has its own direction and impact speed.
    const dx = (origin.x - impact.x) * PITCH_WIDTH_YARDS / 100;
    const dy = (origin.y - impact.y) * PITCH_LENGTH_YARDS / 100;
    const dz = origin.height - impact.height;
    const distance = Math.hypot(dx, dy, dz), speed = Math.hypot(incoming.x, incoming.y, incoming.z);
    const frameIncoming = distance > 0.001 && speed > 0
      ? { x: dx / distance * speed, y: dy / distance * speed, z: dz / distance * speed }
      : incoming;
    tipMs = speed > 0 ? distance / speed * 1000 : 0;
    incidentVelocity = frameIncoming;
    outgoing = reflectBallVelocity(frameIncoming, normal, FRAME_RESTITUTION);
  } else {
    const parry = parryBallVelocity({ incomingVelocity: incoming, point: impact,
      keeperPoint: pointOf(keeperEntry), goalY, handling: playerAttribute(keeperEntry.player, "Handling"),
      spilled: physicsCode === "K.SAVE.5" });
    outgoing = parry.velocity; kind = parry.kind;
  }
  const projection = projectRebound({ from: origin, velocity: outgoing });
  const span = tipMs + projection.rollStartMs;
  let duration = Math.max(1, span);
  let samples = [ { progress: 0, position: impact } ];
  if (tipMs) samples.push({ progress: tipMs / duration, position: origin });
  for (const sample of projection.samples) {
    if (sample.timeMs > projection.rollStartMs + 0.001) break;
    samples.push({ ...sample, progress: (tipMs + sample.timeMs) / duration });
  }
  let endpoint = { ...projection.rollFrom, zone: zoneFromPercent(projection.rollFrom.x, projection.rollFrom.y) };
  const ballVelocity = { x: projection.rollVelocity.x / PITCH_WIDTH_YARDS / 10,
    y: projection.rollVelocity.y / PITCH_LENGTH_YARDS / 10 };
  samples.push({ progress: 1, position: endpoint, velocity: ballVelocity, verticalVelocity: 0, mode: "rolling" });
  let exit = null, goalCrossing = null;
  for (let i = 1; i < samples.length; i++) {
    const a = samples[i - 1], b = samples[i];
    const crossing = classifyPitchExit({ from: a.position, to: b.position,
      lastTouchTeam: keeperEntry.team, attackingDirectionByTeam: state.attackingDirection });
    if (!crossing) continue;
    const ratio = yardDistance(a.position, crossing.ballEnd) / Math.max(0.000001, yardDistance(a.position, b.position));
    const progress = a.progress + (b.progress - a.progress) * ratio;
    endpoint = { ...crossing.ballEnd, height: (a.position.height || 0) + ((b.position.height || 0) - (a.position.height || 0)) * ratio };
    goalCrossing = reboundGoalCrossing(a.position, b.position, goalY);
    exit = { ...crossing, ballEnd: endpoint };
    samples = samples.slice(0, i).map(sample => ({ ...sample, progress: progress > 0 ? sample.progress / progress : 0 }));
    samples.push({ progress: 1, position: endpoint, mode: "out" });
    duration *= progress;
    break;
  }
  trace.push(traceEvent(save.code, `${playerName(keeperEntry.player)}: ${kind}`, {
    actor: shooterEntry, keeper: keeperEntry, movement: "save", outcome: goalCrossing ? "goal" : "save", duration,
    ballFrom: contactPoint, ballTo: endpoint, ballTrajectory: samples,
    keeperAction: KEEPER_SAVE_PRESENTATION[physicsCode].keeperAction,
    ballResult: goalCrossing ? "goal" : kind,
    badge: goalCrossing ? "GOAL" : kind === "crossbar" ? "BAR" : kind === "post" ? "POST" : "PARRIED",
    ...(goalCrossing ? { restart: "kickoff" } : {}),
    ownerBefore: null, ownerAfter: null,
    // The contact is a hand impulse, not a command to relocate the goalkeeper.
    lastTouch: { playerId: keeperEntry.id, team: keeperEntry.team, bodyPart: "hand", deliberate: false },
    metrics: { rebound: { kind, incoming: incidentVelocity, shotIncoming: incoming, outgoing, normal, impactPoint: origin,
      impactMs: tipMs, restitution: physicsCode === "K.SAVE.6" ? FRAME_RESTITUTION : physicsCode === "K.SAVE.5" ? 0.18 : 0.38,
      turfContacts: projection.contacts, rollStartMs: span } },
  }));
  save.reboundTransition = goalCrossing ? {
    outcome: "GOAL", code: save.code, resolved: true, terminal: true, possession: "dead",
    nextOwnerId: null, ballEnd: endpoint, restart: "kickoff", reason: "rebound-goal-plane-crossing",
  } : exit ? pushPitchExitRestart(trace, { actor: keeperEntry,
    ballFrom: endpoint, exit, movement: "save", duration: 0, pinActorToExit: false }) : {
    outcome: "REBOUND", code: save.code, resolved: true, terminal: false, possession: "loose",
    nextOwnerId: null, ballEnd: endpoint, ballVelocity, ballVelocityPhase: "rolling",
    restart: null, reason: `${kind}-loose`,
  };
  return endpoint;
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

// Curved shot -> real ball TRACK, not just the visual guide (2026-08-24) --
// a reported bug: the trail line drawn by showTrail()/applyPlaybackCue()
// (curveControlPoint()'s own quadratic bezier) genuinely curls, but the
// ball marker itself travelled dead straight during playback. Root cause:
// resolvedBallTrajectory below always builds a real ballTrajectory via
// buildBallTrajectory() (matchBallCore.js) for any event with ballFrom/
// ballTo, and matchLabPlayback.js's buildMatchLabPlaybackPlan() always
// prefers a non-empty ballTrajectory over its own curve-aware
// segmentPath()/addBallPath() fallback -- so that fallback's curve code
// was already correct but structurally unreachable; the ball's REAL
// track was always the straight buildBallTrajectory() default (pathSegments
// left at its [] default, which buildBallTrajectory reads as a plain
// [from, to] line). Same control-point math as curveControlPoint() (the
// guide trail), sampled here into real waypoints buildBallTrajectory() can
// walk, so the drawn guide and the actual ball path can never disagree
// again.
function curvedShotPathSegments(ballFrom, ballTo, strikingFoot, contactType) {
  const control = curveControlPoint(ballFrom, ballTo, strikingFoot, contactType);
  return Array.from({ length: 9 }, (_, index) =>
    quadraticBezierPoint(ballFrom, control, ballTo, index / 8),
  );
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
    // Joint Passer/Runner Candidate Generation v1 (Stage 3) -- where the
    // passer AIMED, kept as its own fact alongside where the ball actually
    // ended. Optional and inert: only diagnostics and tests read it.
    intendedPoint = null,
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
    // Coupled attacking/defensive coordination evidence. This is a
    // read-only snapshot of the planner decision; playback never consumes it.
    coordination = null,
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
        motionModel: entry.motionModel ?? "running",
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
          : entry.intentionTarget ? { action: entry.action, target: { ...entry.intentionTarget } } : null,
        teamJob: entry.teamJob ?? null,
        teamPhase: entry.teamPhase ?? null,
        formationAnchor: entry.formationAnchor ? { ...entry.formationAnchor } : null,
        shapeTarget: entry.shapeTarget ? { ...entry.shapeTarget } : null,
        occupiedLane: entry.occupiedLane ?? null,
        occupiedDepthBand: entry.occupiedDepthBand ?? null,
        currentRegion: entry.currentRegion ?? null,
        shapeRegion: entry.shapeRegion ?? null,
        intendedRegion: entry.intendedRegion ?? null,
        regionMove: entry.regionMove ?? null,
        targetRegionOccupancy: entry.targetRegionOccupancy ?? null,
        tacticalRole: entry.tacticalRole ?? null,
        duty: entry.duty ?? null,
        coordinationFamily: entry.coordinationFamily ?? null,
        coordinationResponsibility: entry.coordinationResponsibility ?? null,
        coordinationRelationship: entry.coordinationRelationship ?? null,
        coordinationThreatId: entry.coordinationThreatId ?? null,
        authoritative: entry.authoritative !== false,
        reactionDelayMs: Number.isFinite(entry.reactionDelayMs)
          ? entry.reactionDelayMs
          : null,
        reachAllowanceYards: Number.isFinite(entry.reachAllowanceYards)
          ? entry.reachAllowanceYards
          : 0,
        // Stamina Bars v1 (2026-08-31) -- reads whatever burst01/match01
        // the REAL simulatedRoster entry already carries at this exact
        // instant (drainOnBallAction()/applyBurstOffBallJob() both mutate
        // it in place before their own trace.push()), never recomputed or
        // fabricated. Omitted entirely (not even `undefined`) for any
        // fixture that never carries the battery at all -- buildMatchLabPlaybackPlan()
        // depends on the key's ABSENCE to leave every existing (burst-less)
        // playback plan byte-identical.
        ...(typeof entry.player.burst01 === "number"
          ? { burst01: entry.player.burst01, match01: entry.player.match01 ?? null }
          : {}),
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
  const resolvedPathSegments =
    pathSegments.length >= 2
      ? pathSegments
      : movement === "shot" && strikingFoot && contactType && ballFrom && ballTo
        ? curvedShotPathSegments(ballFrom, ballTo, strikingFoot, contactType)
        : pathSegments;
  const resolvedBallTrajectory =
    ballTrajectory ||
    (!cueOnly && ballFrom && ballTo
      ? buildBallTrajectory({
          from: ballFrom,
          to: ballTo,
          movement,
          durationMs: resolvedDuration,
          pathSegments: resolvedPathSegments,
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
          ...(contact.bodyPoint ? { bodyPoint: { ...contact.bodyPoint }, reachAllowanceYards: contact.reachAllowanceYards ?? 0 } : {}),
          actorId: contact.actor.id,
          type: contact.type,
          // Kick/header/save/clearance contacts begin their outgoing flight;
          // races, recoveries and blocks happen when an incoming flight ends.
          // The producing call site must state which one -- playback never
          // infers it from an event code or label.
          phase: contact.phase,
          // How far into a "start"-phase contact's own event the contact
          // actually happens (2026-08-25) -- see matchLabPlayback.js's own
          // comment on the contact-pin timing bug this fixes. Optional;
          // absent/0 for every caller that doesn't supply one, identical
          // to the original always-at-the-first-instant behavior.
          delayMs: contact.delayMs ?? 0,
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
    intendedPoint,
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
    coordination: coordination ? JSON.parse(JSON.stringify(coordination)) : null,
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
// The ball's own explicit progress-timed path for a save with a genuine
// rebound leg (2026-08-25) -- see pushKeeperSaveEvent()'s own comment on
// the reported bug this fixes. Ordinary pathSegments-based timing
// (addBallPath() in matchLabPlayback.js) is purely distance-proportional
// across the WHOLE event window, so with no way to express "hold here for
// a while, THEN travel," the ball appeared to start bouncing away the
// instant the event began -- before the keeper had even reached it -- and
// crawled through what should be a quick bounce because that instant-start
// travel was stretched across diveMs+bounceMs combined, not just
// bounceMs. This builds real progress/timeMs samples instead: held exactly
// at segments[0] through progress = diveMs/totalMs (matching the contact
// pin's own delayMs below), then distance-proportional across the
// remaining segments for the rest.
function buildSaveBallTrajectory(segments, diveMs, totalMs) {
  if (segments.length <= 1 || totalMs <= 0) return null;
  const holdProgress = clamp(0, 1, diveMs / totalMs);
  const samples = [
    { progress: 0, position: { ...segments[0] } },
    { progress: holdProgress, position: { ...segments[0] } },
  ];
  const lengths = segments.slice(1).map((point, index) => yardDistance(segments[index], point));
  const total = lengths.reduce((sum, value) => sum + value, 0) || lengths.length;
  let elapsed = 0;
  for (let index = 1; index < segments.length; index += 1) {
    elapsed += lengths[index - 1] || 1;
    const localRatio = elapsed / total;
    samples.push({
      progress: index === segments.length - 1 ? 1 : holdProgress + (1 - holdProgress) * localRatio,
      position: { ...segments[index] },
    });
  }
  return samples;
}

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
    keeperContactResolved = false,
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
  if (save.rebound) {
    return pushPhysicalReboundEvent(trace, { shooterEntry, keeperEntry, save, contactPoint, strikeMechanics });
  }
  const side = choosePostSide(
    pointOf(shooterEntry),
    contactPoint,
    strikeMechanics?.strikingFoot,
    strikeMechanics?.contactType,
  );
  let segments = buildKeeperSaveSegments(
    save.code,
    shooterEntry,
    keeperEntry,
    contactPoint,
    side,
  );
  if (keeperContactResolved && presentation.ballResult === "held") {
    segments = [contactPoint, pointOf(keeperEntry)];
  }
  const endpoint = segments[segments.length - 1];
  const defaultLabel = save.goal
    ? `${playerName(shooterEntry.player)} scores`
    : `${playerName(keeperEntry.player)} ${KEEPER_ACTION_PHRASE[presentation.badge] ?? "saves it"}`;
  // A real duration for the whole beat -- the keeper's own dive/reach to
  // contactPoint (Pace/Acceleration-timed, same timeToReach() every other
  // physically-limited move already uses) plus however long the parry/
  // rebound then actually takes to travel its own path afterward. Never
  // an implicit zero -- a save with no explicit duration compresses the
  // dive AND the whole post/net/rebound path into one instant.
  const diveMs = keeperContactResolved ? 0 : Math.max(
    180,
    Math.round(
      timeToReach(keeperEntry.player, yardDistance(pointOf(keeperEntry), contactPoint)) * 1000,
    ),
  );
  let bounceMs = 0;
  for (let index = 1; index < segments.length; index += 1) {
    bounceMs += looseBallFlightMs(yardDistance(segments[index - 1], segments[index]));
  }
  const saveDuration = keeperContactResolved && presentation.ballResult === "held"
    ? 120 : Math.max(120, diveMs + bounceMs);
  // Explicit progress-timed ball path (2026-08-25) -- see
  // buildSaveBallTrajectory()'s own comment for the reported bug this
  // fixes (a keeper that never visibly reacts, plus an artificially slow
  // rebound/parry bounce). null whenever there's no real bounce leg
  // (segments.length <= 1 -- a clean catch/fumble-and-hold), which falls
  // straight back to the original pathSegments-based path unchanged.
  const saveBallTrajectory = buildSaveBallTrajectory(segments, diveMs, saveDuration);
  trace.push(
    traceEvent(save.code, label ?? defaultLabel, {
      actor: shooterEntry,
      keeper: keeperEntry,
      movement,
      outcome: save.goal ? "goal" : "save",
      duration: saveDuration,
      ballFrom: contactPoint,
      ballTo: endpoint,
      pathSegments: segments,
      ballTrajectory: saveBallTrajectory,
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
      mover: keeperContactResolved ? null : keeperEntry,
      moveFrom: keeperContactResolved ? null : pointOf(keeperEntry),
      moveTo: keeperContactResolved ? null : contactPoint,
      contact:
        presentation.keeperAction === "beaten"
          ? null
          : {
              point: contactPoint,
              ...(keeperContactResolved ? { bodyPoint: pointOf(keeperEntry),
                reachAllowanceYards: KEEPER_DIVE_ARM_YARDS + jumpReachYards(keeperEntry.player) } : {}),
              actor: keeperEntry,
              type: presentation.keeperAction,
              phase: "start",
              // delayMs (2026-08-25 fix, matchLabPlayback.js's own
              // contact-pin) -- without this, the pin landed at this
              // event's literal first instant, unconditionally overwriting
              // the keeper's own authored start-of-dive position and
              // collapsing their whole reach to a single frozen frame at
              // the save point for the ENTIRE event -- "the keeper does
              // not even react." Now pinned at however far into the event
              // their own dive actually takes, matching diveMs exactly.
              delayMs: diveMs,
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
// Rebound v2 (2026-08-26, Passing v3) -- distance-tiered conversion,
// see reboundConversionChance()'s own comment.
const REBOUND_CLOSE_RANGE_YARDS = 14;
const REBOUND_MID_RANGE_YARDS = 22;
const REBOUND_CLOSE_RANGE_CHANCE = { floor: 0.5, ceiling: 0.72 };
const REBOUND_MID_RANGE_CHANCE = { floor: 0.28, ceiling: 0.48 };
// A generous outer cap for the initial "who can even physically get
// there" pass ONLY -- never the event's own authored duration (see
// contestDurationMs below, which is the real, earlier arrival time,
// floored at MOVEMENT_DURATIONS.scramble). This just needs to be well
// beyond any realistic box-scramble arrival so contactArrivalTiming()'s
// own naturalEtaMs comes back genuine, not artificially clipped.
const REBOUND_CONTEST_MAX_MS = 3000;
// Genuinely simultaneous arrivals (within about one reaction beat of each
// other) duel for it; a real gap means whoever's there first just takes
// it -- no coin flip for an attacker who arrived a full second later.
const REBOUND_TIE_TOLERANCE_MS = 150;

// Finishing/Composure vs the keeper's own Reflexes, mapped into the
// distance tier's own [floor, ceiling] range -- close-range rebounds in
// real football are tap-ins (a real reported bug: reboundShotChance()'s
// own flat ~0.32 cap made them mostly misses regardless of range), not a
// fixed number regardless of how presentable the chance actually was.
function reboundConversionChance(distanceYards, shooter, keeperPlayer) {
  const tier = distanceYards <= REBOUND_CLOSE_RANGE_YARDS
    ? REBOUND_CLOSE_RANGE_CHANCE
    : REBOUND_MID_RANGE_CHANCE;
  const attackPower = (playerAttribute(shooter, "Finishing") + playerAttribute(shooter, "Composure")) / 2;
  const keeperPower = playerAttribute(keeperPlayer, "Reflexes");
  const share = attackPower / Math.max(1, attackPower + keeperPower);
  return clamp(tier.floor, tier.ceiling, tier.floor + (tier.ceiling - tier.floor) * share);
}

function resolveReboundScramble(
  attacker,
  defender,
  keeper,
  zone,
  random,
  trace,
  originPoint = pointOf(keeper),
) {
  // Real physics, not a teleport (2026-08-23) -- pushKeeperSaveEvent()
  // already gave the ball itself a real bounce duration to REACH
  // originPoint (its own pathSegments/duration fix, immediately before
  // this event on the trace); this function starts from the ball already
  // loose and settled there, and asks who can physically get to it.
  //
  // Real event duration, not a flat REBOUND_SCRAMBLE_WINDOW_MS (2026-08-26
  // fix -- a real reported bug: stretching BOTH chasers across a flat
  // 2200ms even when they started 6-10yd away read as slow motion, and any
  // off-ball ADJUST overlapping that window crawled with them). Both
  // eligible players' own REAL, physical arrival time
  // (contactArrivalTiming(), the same Pace/Acceleration-limited timing
  // every other continuous move in this project already obeys) decides
  // both WHO gets there and HOW LONG this event actually takes -- the
  // earliest genuine arrival, floored at MOVEMENT_DURATIONS.scramble
  // (the same "a loose ball scramble is still a real beat, never an
  // instant snap" floor every other scramble already uses), never the
  // old flat ceiling.
  const arrivalFor = (entry, contactTimeMs) => contactArrivalTiming({
    player: entry.player,
    from: pointOf(entry),
    to: originPoint,
    contactTimeMs,
  });
  const attackerProbe = arrivalFor(attacker, REBOUND_CONTEST_MAX_MS);
  const defenderProbe = arrivalFor(defender, REBOUND_CONTEST_MAX_MS);
  if (!attackerProbe.reachable && !defenderProbe.reachable) {
    const looseDurationMs = MOVEMENT_DURATIONS.scramble;
    trace.push(
      traceEvent(
        "REBOUND.LOOSE",
        "The loose ball drops beyond anyone who can reach it",
        {
          actor: attacker,
          defender,
          movement: "scramble",
          outcome: "loose",
          duration: looseDurationMs,
          ballFrom: originPoint,
          ballTo: originPoint,
          ownerBefore: null,
          ownerAfter: null,
        },
      ),
    );
    return {
      outcome: "NO GOAL",
      code: "REBOUND.LOOSE",
      resolved: true,
      terminal: true,
      possession: "loose",
      nextOwnerId: null,
      ballEnd: originPoint,
      restart: null,
      reason: "rebound-unreachable",
    };
  }
  // Real total wall-clock arrival, not naturalEtaMs alone -- naturalEtaMs is
  // pure locomotion time and excludes the reaction beat contactArrivalTiming()
  // itself charges before a player is judged reachable at all (same
  // CONTACT_REACTION_DELAY_MS + travel-time pattern already used elsewhere in
  // this file, e.g. formationHomePosition's own mover ETA). Leaving the
  // reaction beat out here made contestDurationMs land ~120ms short of what
  // the SAME arrivalFor() call would then require to call the winner
  // "reachable," so even the winner fell short of originPoint on re-probe.
  const attackerEtaMs = attackerProbe.reachable ? CONTACT_REACTION_DELAY_MS + attackerProbe.naturalEtaMs : Infinity;
  const defenderEtaMs = defenderProbe.reachable ? CONTACT_REACTION_DELAY_MS + defenderProbe.naturalEtaMs : Infinity;
  const earliestEtaMs = Math.min(attackerEtaMs, defenderEtaMs);
  const contestDurationMs = Math.max(MOVEMENT_DURATIONS.scramble, Math.round(earliestEtaMs));
  // Re-timed against the REAL, final event duration -- not the generous
  // probe window above -- so each contestant's own authored move/
  // trajectory reflects how far they genuinely got inside the ACTUAL
  // event, never a distance implied by a longer window that was only
  // ever used to decide timing.
  const attackerArrival = arrivalFor(attacker, contestDurationMs);
  const defenderArrival = arrivalFor(defender, contestDurationMs);
  const contestingNow = [
    attackerEtaMs <= earliestEtaMs + REBOUND_TIE_TOLERANCE_MS ? attacker : null,
    defenderEtaMs <= earliestEtaMs + REBOUND_TIE_TOLERANCE_MS ? defender : null,
  ].filter(Boolean);
  let winner;
  if (contestingNow.length > 1) {
    const reboundDuel = localizedDuel(
      attacker.player,
      defender.player,
      ["Anticipation", "Acceleration", "Off the Ball"],
      ["Positioning", "Anticipation", "Strength"],
      FIXED_MINUTE,
      random,
      zone,
    );
    winner = reboundDuel.won ? attacker : defender;
  } else {
    winner = contestingNow[0];
  }
  const contestPoint = originPoint;
  const attackerWon = winner.id === attacker.id;
  const moveFor = (entry, arrival, action) => ({
    player: entry,
    from: pointOf(entry),
    to: arrival.reachablePoint,
    action,
    trajectory: sampleContinuousTrajectory({
      from: pointOf(entry),
      to: arrival.reachablePoint,
      player: entry.player,
      totalMs: contestDurationMs,
      reactionDelayMs: CONTACT_REACTION_DELAY_MS,
      sampleCount: Math.max(6, Math.min(14, Math.ceil(contestDurationMs / 140))),
    }),
  });
  trace.push(
    traceEvent(
      attackerWon ? "REBOUND.WON" : "REBOUND.LOST",
      attackerWon
        ? `${playerName(attacker.player)} reaches the loose ball first`
        : `${playerName(winner.player)} reaches the loose ball first`,
      {
        actor: attacker,
        defender,
        movement: "scramble",
        outcome: attackerWon ? "success" : "turnover",
        // Contact, Ownership & Continuation (2026-08-18) -- explicit
        // loose-ball point, BOTH eligible players shown genuinely
        // converging on it at their own physical pace (not the ball
        // teleporting to whichever one wins), and a named contact/winner --
        // "Every rebound attempt must name who took it." Neither
        // "clears the danger" (defender) nor any destination/flight is
        // claimed here -- reaching the loose ball first isn't itself a
        // clearance (see resolveAerialClearanceContinuation() for the real
        // clearance decision, which the winning DEFENDER never gets here --
        // a genuine gap, this is a rebound scramble, not an aerial win).
        duration: contestDurationMs,
        playerMoves: [
          moveFor(attacker, attackerArrival, "attack-ball"),
          moveFor(defender, defenderArrival, "challenge"),
        ],
        contact: {
          point: contestPoint,
          actor: winner,
          type: "recovery",
          phase: "end",
        },
        ownerBefore: null,
        ownerAfter: winner,
        ballFrom: contestPoint,
        ballTo: contestPoint,
        // A real reported bug (2026-08-28): matchLabPlayback.js's own
        // stationaryContact shortcut ("arrivals at the end of an already-
        // authored incoming flight (block/recovery)") is meant for a
        // contact that happens exactly as an EXISTING flight ends, sharing
        // that flight's own already-claimed timeline slot. This scramble
        // is the opposite: the ball has ALREADY settled (the preceding
        // save/deflection event is fully over), and THIS event is its own
        // genuinely separate contest -- two players physically racing the
        // real contestDurationMs above, not an instant arrival. Without
        // this flag, ballFrom===ballTo (a real, loose, not-yet-owned
        // ball) plus contact.phase:"end" accidentally matched that same
        // shortcut anyway, silently reusing the PRECEDING save event's own
        // already-consumed interval instead of claiming this event's own
        // -- the ball (and both contestants) appeared frozen at the save's
        // own endpoint for the whole scramble, then snapped, exactly the
        // teleport LOOSE.RECOVERED's own contactTiming:"sequential" fix
        // (below in this file) already exists to prevent for a fumbled
        // pass; this resolver's own rebound scramble was simply never
        // given the same flag.
        contactTiming: "sequential",
      },
    ),
  );
  if (!attackerWon) {
    return {
      outcome: "NO GOAL",
      code: "REBOUND.LOST",
      resolved: true,
      terminal: true,
      possession: "turnover",
      nextOwnerId: winner.id,
      ballEnd: contestPoint,
      restart: null,
      reason: "rebound-lost",
    };
  }
  // Conversion v2 -- distance-tiered, and a genuinely far-out win no
  // longer forces a scramble shot at all (2026-08-26 fix: "rebounds never
  // score AND never become play" -- an attacker who wins the ball outside
  // real shooting range just OWNS it, possession continues, exactly like
  // any other loose-ball recovery).
  const distanceToGoal = distanceToGoalYards(contestPoint, state.attackingDirection[attacker.team]);
  if (distanceToGoal > REBOUND_MID_RANGE_YARDS) {
    trace.push(
      traceEvent(
        "REBOUND.CONTROL",
        `${playerName(attacker.player)} controls the loose ball -- too far out for an instinctive shot`,
        {
          actor: attacker,
          movement: "reception",
          outcome: "success",
          ballFrom: contestPoint,
          ballTo: contestPoint,
          contact: { point: contestPoint, actor: attacker, type: "control", phase: "end" },
          ownerBefore: attacker,
          ownerAfter: attacker,
        },
      ),
    );
    return {
      outcome: "CONTROLLED",
      code: "REBOUND.CONTROL",
      resolved: true,
      terminal: false,
      possession: "retained",
      nextOwnerId: attacker.id,
      ballEnd: contestPoint,
      restart: null,
      reason: "rebound-controlled",
    };
  }
  const scored = random() < reboundConversionChance(distanceToGoal, attacker.player, keeper.player);
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
        // Begins exactly at contestPoint -- attacker.moveTo above already
        // put them there; not pointOf(attacker), which (before this fix)
        // reread their stale pre-scramble spot instead of where they
        // actually won the ball.
        ballFrom: contestPoint,
        ballTo: reboundShotEnd,
        contact: {
          point: contestPoint,
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
// Builds the one factual view of an isolated attacker/keeper situation.
// Eligibility is geometry, never reputation: a close, reasonably open
// angle; the keeper genuinely between attacker and goal; and no outfield
// defender close enough to pressure/recover or standing in the shot lane.
function freePlayOneOnOneContext(groups) {
  const shooter = groups?.owner;
  const keeper = groups?.keeper;
  if (!shooter || !keeper || isKeeperBeaten(shooter, keeper)) return null;
  const goalY = goalLineY(shooter);
  const closeDown = assessKeeperCloseDown({
    keeper,
    ball: shooter,
    attacker: shooter,
    defenders: groups.opponents,
    defendingDirection: state.attackingDirection[keeper.team],
  });
  if (!closeDown.isolated) return null;
  const { goalDistanceYards: distanceYards, shotAngleDegrees } = closeDown;

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
    ...observeKeeperMotion(keeper, shooter, keeper.keeperVelocity),
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

// Shot As Projectile v1, Slice B3 (2026-08-27) -- place-left/place-right/
// blast execution migrated onto the SAME geometric mouth-point machinery
// resolveShoot() uses above (resolveShotDescriptor()'s own header
// comment has the full rationale). Stage 1 (chooseOneOnOneAction(),
// oneOnOneDecision.js) is completely untouched -- the BRAIN still picks
// the action from a perceived read; only its EXECUTION, for these three
// actions specifically, is now geometric. chip/round-keeper/square-pass
// deliberately stay on resolveChipAttempt()/resolveRoundKeeper()/
// resolveSquarePass() (matchEngineCore.js) exactly as before -- see this
// file's own executeOneOnOneAction() switch below.
function targetSideOffsetYards(targetSide) {
  if (targetSide === "left") return -SHOT_MOUTH_HALF_WIDTH_YARDS;
  if (targetSide === "right") return SHOT_MOUTH_HALF_WIDTH_YARDS;
  return 0;
}

// "far post height ~0.3-0.8yd" (place-*) / "a corner, faster" (blast) --
// the spec's own aim intention. Placed effort aims 80% of the way to the
// post (a real corner, not the frame's own edge); blast aims fractionally
// tighter to the post still (92%) since it trades the same accuracy for
// genuine extra pace (SHOT_SPEED_YARDS_PER_SECOND.blast below), not for
// an even more extreme angle.
function resolveOneOnOneShotDescriptor(shooterEntry, keeperEntry, targetSide, power, pressure, random) {
  const quality = shotPlacementQuality(shooterEntry.player);
  const intendedOffsetYards = targetSideOffsetYards(targetSide) * (power ? 0.62 : 0.5);
  const intendedHeightYards = power
    ? clamp(0.2, 1.1, 0.35 + (1 - quality) * 0.5)
    : clamp(0.3, 0.8, 0.3 + quality * 0.5);
  const accuracy = resolveShotAccuracy(shooterEntry.player, { pressureFactor: pressure, power }, random);
  const angle = random() * Math.PI * 2;
  const actualOffsetYards = intendedOffsetYards + Math.cos(angle) * accuracy.errorYards;
  const actualHeightYards = Math.max(0, intendedHeightYards + Math.sin(angle) * accuracy.errorYards);
  const onTarget = Math.abs(actualOffsetYards) <= SHOT_MOUTH_HALF_WIDTH_YARDS
    && actualHeightYards <= GOAL_HEIGHT_YARDS;
  const goalY = goalLineY(shooterEntry);
  const actualPoint = {
    zone: shooterEntry.zone,
    x: clamp(0, 100, centerYardsToPercentX(actualOffsetYards)),
    y: goalY,
  };
  const speedYardsPerSecond = power ? SHOT_SPEED_YARDS_PER_SECOND.blast : SHOT_SPEED_YARDS_PER_SECOND.calm;
  const distanceYards = movementDistanceYards(pointOf(shooterEntry), actualPoint);
  const durationMs = Math.max(80, (distanceYards / speedYardsPerSecond) * 1000);
  return {
    onTarget,
    actualPoint,
    actualHeightYards,
    elevation: actualHeightYards > GOAL_HEIGHT_YARDS ? "high" : "low",
    executionQuality: accuracy.quality,
    flight: { from: pointOf(shooterEntry), actual: actualPoint, peakHeightYards: actualHeightYards, speedYardsPerSecond, durationMs },
  };
}

// Same vocabulary resolveTargetedKeeperResponse()'s own TARGETED_RESPONSE_OUTCOMES
// table (matchEngineCore.js) already established -- kept as a LOCAL,
// PARALLEL copy for the same reason geometricKeeperSaveFlavor() keeps
// its own K.SAVE table local: nothing here is a refactor of protected
// production code, and this file's own presentation code (resolveFreePlayOneOnOne(),
// oneOnOneTargetPoint()) already reads these exact keys.
const GEOMETRIC_ONE_V_ONE_OUTCOMES = {
  "ONE_V_ONE.BEATEN": { keeperAction: "beaten", ballResult: "goal", goal: true, rebound: false },
  "ONE_V_ONE.CAUGHT": { keeperAction: "catch", ballResult: "held", goal: false, rebound: false },
  "ONE_V_ONE.PARRIED": { keeperAction: "parry", ballResult: "rebound-in-play", goal: false, rebound: true },
  "ONE_V_ONE.CLEARED": { keeperAction: "tip", ballResult: "corner", goal: false, rebound: false },
  "ONE_V_ONE.POST_REBOUND": { keeperAction: "tip", ballResult: "post-rebound", goal: false, rebound: true },
  "ONE_V_ONE.POST_GOAL": { keeperAction: "tip", ballResult: "post-goal", goal: true, rebound: false },
};

// PARALLEL to resolveTargetedKeeperResponse()'s own post-beaten-gate
// options table (matchEngineCore.js) -- same Handling/Reflexes/
// Positioning-driven weights, same `difficulty` shape, just fed a REAL
// keeperTravelYards (the keeper's own actual starting distance from the
// actual mouth point) instead of the old actualKeeperState.lateralOffsetYards
// abstraction, and with no beatenCleanChance gate -- geometric
// reachability (simulateShotKeeperEnvelope()) already decided that.
function geometricOneOnOneSaveFlavor(keeperEntry, actualPoint, power, random) {
  const keeperTravelYards = movementDistanceYards(keeperEntry, actualPoint);
  const reflexScore = (
    playerAttribute(keeperEntry.player, "Reflexes")
    + playerAttribute(keeperEntry.player, "Positioning")
    + playerAttribute(keeperEntry.player, "One On Ones")
  ) / 3 / 20;
  const speedFactor = power ? 1.25 : 1;
  const difficulty = clamp(0.05, 0.85, (keeperTravelYards / 8) * speedFactor * (1 - reflexScore * 0.5));
  const handling = playerAttribute(keeperEntry.player, "Handling");
  const options = [
    { value: "ONE_V_ONE.CAUGHT", weight: Math.max(1, handling * 2 * (1 - difficulty)) },
    { value: "ONE_V_ONE.PARRIED", weight: Math.max(1, 20 - handling) * (0.6 + difficulty) },
    { value: "ONE_V_ONE.CLEARED", weight: Math.max(0.5, difficulty * 6) },
    { value: "ONE_V_ONE.POST_REBOUND", weight: Math.max(0.3, difficulty * 2.5) },
    { value: "ONE_V_ONE.POST_GOAL", weight: Math.max(0.15, difficulty * 1.2) },
  ];
  const code = weightedChoice(options, random);
  return { code, ...GEOMETRIC_ONE_V_ONE_OUTCOMES[code], keeperTravelYards };
}

// The full place-*/blast execution -- mirrors resolvePlacedFinish() +
// resolveTargetedKeeperResponse()'s own combined return shape exactly
// (code/goal/rebound/keeperAction/ballResult/keeperTravelYards/shot) so
// resolveFreePlayOneOnOne() downstream needs no changes beyond
// oneOnOneTargetPoint()'s own small addition (see its updated comment).
function executeGeometricOneOnOneShot({
  shooter, keeper, targetSide, power, defenderPressure, executionRandom, keeperResponseRandom,
}) {
  const descriptor = resolveOneOnOneShotDescriptor(shooter, keeper, targetSide, power, defenderPressure, executionRandom);
  const shot = {
    onTarget: descriptor.onTarget,
    intendedTarget: targetSide,
    actualTarget: descriptor.onTarget ? targetSide : (descriptor.elevation === "high" ? "over" : "wide"),
    actualPoint: descriptor.onTarget ? descriptor.actualPoint : null,
    targetHeight: descriptor.actualHeightYards > 1.3 ? "high" : "low",
    elevation: descriptor.elevation,
    executionQuality: descriptor.executionQuality,
    shooterAbility: Number(shooter.player?.current_ability) || 100,
    speed: power ? "power" : "placed",
    flight: descriptor.flight,
  };
  if (!descriptor.onTarget) {
    return {
      code: "ONE_V_ONE.OFF_TARGET", goal: false, rebound: false,
      keeperAction: null, ballResult: descriptor.elevation === "high" ? "over" : "wide",
      keeperTravelYards: 0, shot,
    };
  }
  const keeperEnvelope = simulateShotKeeperEnvelope(descriptor.flight, keeper);
  shot.keeperEnvelope = keeperEnvelope;
  if (!keeperEnvelope.reached) {
    return {
      code: "ONE_V_ONE.BEATEN",
      ...GEOMETRIC_ONE_V_ONE_OUTCOMES["ONE_V_ONE.BEATEN"],
      keeperTravelYards: movementDistanceYards(keeper, descriptor.actualPoint),
      shot,
    };
  }
  return { ...geometricOneOnOneSaveFlavor(keeper, descriptor.actualPoint, power, keeperResponseRandom), shot };
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
    executionRandom,
    keeperResponseRandom,
  },
) {
  switch (action) {
    case "place-left":
    case "place-right": {
      const targetSide = action === "place-left" ? "left" : "right";
      return executeGeometricOneOnOneShot({
        shooter, keeper, targetSide, power: false,
        defenderPressure, executionRandom, keeperResponseRandom,
      });
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
      return executeGeometricOneOnOneShot({
        shooter, keeper, targetSide, power: true,
        defenderPressure, executionRandom, keeperResponseRandom,
      });
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
      // Same geometric execution as place-*/blast (mechanically this IS a
      // placed, non-power shot, just under elevated pressure) -- migrated
      // alongside them rather than left as an odd third dice-driven
      // variant of the exact same action shape.
      const targetSide = perceivedKeeperState.exposedSide === "balanced"
        ? "center"
        : perceivedKeeperState.exposedSide;
      const result = executeGeometricOneOnOneShot({
        shooter, keeper, targetSide, power: false,
        defenderPressure: clamp(0, 1, defenderPressure * 0.75 + 0.08),
        executionRandom, keeperResponseRandom,
      });
      result.shot.speed = "early";
      return result;
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
      if (save.reboundTransition || !save.rebound)
        return keeperSaveTransition(
          save,
          keeper,
          saveEndpoint,
          "scenario-shot",
        );
      if (!defender) {
        const scored = random() < reboundShotChance(shooter.player, keeper.player);
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
              ...realMoverTrajectory(shooter, saveEndpoint, { floorMs: MOVEMENT_DURATIONS["rebound-shot"] }),
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
      if (save.reboundTransition || !save.rebound)
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
        const scored = random() < reboundShotChance(taker.player, keeper.player);
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
              ...realMoverTrajectory(taker, saveEndpoint, { floorMs: MOVEMENT_DURATIONS["rebound-shot"] }),
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
// Gameplay v3.2 -- a KNOCK_FORWARD reception's own next zone
// (matchEngineCore.js's ZONE_TRANSITION_MATRIX, production, untouched)
// can legitimately be a "bypass" a whole row away -- realistic as a
// ZONE fact, but zoneCenterPoint(nextZone) is a real-yards point, and a
// player's own first touch after controlling the ball is a knock a few
// yards ahead, never a sprint across most of the pitch. Caps the ACTUAL
// advance distance; the direction (toward that same next zone) is kept.
const KNOCK_FORWARD_MAX_YARDS = 8;
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

// Engagement Breaker v1 (2026-08-28) -- a real reported bug: every duel/
// shield/tackle contest left BOTH players standing at the exact same
// coordinate (ballFrom===ballTo===contactPoint, no movement authored for
// either side). Since "hold" is always a legal next candidate and the new
// owner's own engager then sits at 0 yards -- structurally inside
// DUEL_RANGE_YARDS -- the possession loop could cycle shield/duel/hold
// indefinitely without the ball ever actually going anywhere: wrestling,
// not football. A real contest ends with the winner stepping away WITH
// the ball along a genuine escape line, and the loser left behind with a
// real gap, not glued to the winner's own shoulder.
//
// Reuses carrySteeringWaypoint()'s own "opponent sits exactly on top of
// me" fallback (spatialDecision.js) for the winner's own direction, not a
// new formula: passing the loser's OWN position as the sole "opponent"
// and the escape distance itself as the clearance radius means `from` is
// always inside that circle (the contest just happened AT that shared
// point), which resolves to the SAME deterministic perpendicular-to-
// heading step a dribble touch already uses to route around a body. The
// loser is bumped the OPPOSITE way along that SAME axis -- guaranteed
// genuine separation on both sides, never two independently-computed
// directions that could coincidentally agree. The nominal heading is
// unclamped (a pure direction reference, never an actual destination) so
// a contact right at the edge of the pitch still gets a real forward-
// biased escape instead of a degenerate zero-length one from clamping to
// the boundary.
const ENGAGEMENT_WINNER_ESCAPE_YARDS = 5;
const ENGAGEMENT_LOSER_BUMP_YARDS = 2.5;
function contestSeparationPoints(
  contactPoint, winnerTeam,
  escapeYards = ENGAGEMENT_WINNER_ESCAPE_YARDS, bumpYards = ENGAGEMENT_LOSER_BUMP_YARDS,
) {
  const direction = state.attackingDirection[winnerTeam] === "up" ? -1 : 1;
  const contactYards = toYardPoint(contactPoint);
  const nominalTarget = fromYardPoint({ x: contactYards.x, y: contactYards.y + direction * 20 });
  const rawWinnerPoint = carrySteeringWaypoint(contactPoint, nominalTarget, [contactPoint], escapeYards)
    ?? advanceTowardGoal(contactPoint, winnerTeam, escapeYards);
  const winnerPoint = { ...rawWinnerPoint, zone: zoneFromPercent(rawWinnerPoint.x, rawWinnerPoint.y) };
  const winnerYards = toYardPoint(winnerPoint);
  const dirX = winnerYards.x - contactYards.x;
  const dirY = winnerYards.y - contactYards.y;
  const dirLength = Math.hypot(dirX, dirY) || 1;
  // reflectIntoRange(), not clamp() -- a carrier already right at the
  // touchline/goal-line whose bump direction points further off-pitch
  // would otherwise clamp straight back to the shared contact point
  // (zero real displacement), the exact "degenerate repeat" bug
  // carrySteeringWaypoint()'s own header now documents.
  const rawLoserPoint = fromYardPoint({
    x: reflectIntoRange(contactYards.x - (dirX / dirLength) * bumpYards, 0, PITCH_WIDTH_YARDS),
    y: reflectIntoRange(contactYards.y - (dirY / dirLength) * bumpYards, 0, PITCH_LENGTH_YARDS),
  });
  const loserPoint = { ...rawLoserPoint, zone: zoneFromPercent(rawLoserPoint.x, rawLoserPoint.y) };
  return { winnerPoint, loserPoint };
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

// Joint Passer/Runner Candidate Generation v1 (Stage 3, 2026-09-05) -- the
// pass-flight and lane primitives passRunCandidates.js needs, bound once
// here. That module is a leaf and imports neither matchPassFlight.js nor
// spatialDecision.js (they already import from each other), so this is the
// single place the real engine functions are handed to it. Every one of
// these is the SAME function the resolvers themselves call -- there is no
// parallel model for candidate generation to disagree with.
const JOINT_CANDIDATE_DEPS = {
  selectPassType,
  flightDurationMs: passFlightDurationMsForType,
  laneObstruction,
  nearestLaneInterceptor,
  reactionDelayMs: reactionDelayMsFor,
};

// Lead Into Space v1 (2026-08-26, Passing v3) -- a lofted/driven-aerial ball,
// or a genuinely direct long ball, is real football struck AHEAD of the
// runner, not aimed at their feet; resolvePass()'s own intendedPoint used to
// be pointOf(receiver) unconditionally regardless of pass type. Only the
// pass TYPE (and, separately, a deliberately direct attacking style over
// real range) earns a lead -- an ordinary short ground pass or a keeper's
// throw still finds feet, exactly as before.
const LEAD_PASS_TYPES = new Set(["lofted", "driven-aerial"]);
const LEAD_STYLES = new Set(["long-ball", "direct"]);
const LEAD_STYLE_MIN_DIRECTNESS = 4;
const LEAD_STYLE_MIN_DISTANCE_YARDS = 25;
const LEAD_MIN_YARDS = 4;
const LEAD_MAX_YARDS = 14;

function shouldLeadIntendedPoint(passType, distanceYards, attackingSettings) {
  if (LEAD_PASS_TYPES.has(passType)) return true;
  return (
    LEAD_STYLES.has(attackingSettings.style)
    && attackingSettings.directness >= LEAD_STYLE_MIN_DIRECTNESS
    && distanceYards >= LEAD_STYLE_MIN_DISTANCE_YARDS
  );
}

// Receiver Pace (how fast they can actually run onto it) plus the passer's
// own Vision (how far ahead of the play they see) -- clamped to a sane
// real-football range, and never pushed past the second-last defender's own
// offside line (onsideLineTargetY(), the SAME buffer planAttackerRepositioning()
// already uses for a run-in-behind target) -- leading a player is meant to
// beat the defense to space, never to hand them a free offside call.
function leadIntendedPoint(receiver, passer, offside) {
  const receiverPoint = pointOf(receiver);
  const leadYards = clamp(
    LEAD_MIN_YARDS,
    LEAD_MAX_YARDS,
    playerAttribute(receiver.player, "Pace") * 0.4 + playerAttribute(passer.player, "Vision") * 0.25,
  );
  const leadPercent = (leadYards / PITCH_LENGTH_YARDS) * 100;
  const onsideCapY = onsideLineTargetY(offside);
  const forwardY = offside.attackingDirection === "up"
    ? receiverPoint.y - leadPercent
    : receiverPoint.y + leadPercent;
  const y = clamp(
    0,
    100,
    offside.attackingDirection === "up"
      ? Math.max(forwardY, onsideCapY)
      : Math.min(forwardY, onsideCapY),
  );
  return { x: receiverPoint.x, y, zone: zoneFromPercent(receiverPoint.x, y) };
}

// Bounce On Failed Control v1 (2026-08-26, Passing v3) -- a real reported
// bug: P.RECEIVE.HEAVY (unrecovered) and P.RECEIVE.LOSE handed the ball
// straight to pointOf(pressingOpponent) in the SAME instant, no matter how
// far away that defender actually was -- a bad touch simply teleported
// possession across the pitch. A heavy touch spills a real, short distance
// (never a fixed point), and who actually pounces on it is a genuine race,
// not a foregone conclusion just because someone was pressuring the
// receiver a moment ago.
const RECEPTION_BOUNCE_MIN_YARDS = 4;
const RECEPTION_BOUNCE_MAX_YARDS = 12;
// A real bounce carries on roughly the way the ball was already travelling,
// scattered within +/-60 degrees of that line -- not a perfectly straight
// continuation (a real mis-touch doesn't re-aim itself), and not fully
// random either (it doesn't spill backward off a ball arriving forward).
const RECEPTION_BOUNCE_JITTER_RAD = Math.PI / 3;
// The specific resolveReceive() outcomes Section D actually names -- an
// ordinary KNOCK_FORWARD-lost contested race keeps its own existing,
// unmodified shape (a real footrace decided it outright at contactPoint,
// not a loose spill).
const RECEPTION_BOUNCE_CODES = new Set(["P.RECEIVE.HEAVY", "P.RECEIVE.LOSE"]);

// Ball Out of Bounds v1 (2026-09-01): deliberately UNclamped, same reasoning
// as deliveryLandingPoint()'s own header -- a heavy touch spilling toward
// the touchline/byline must be free to actually go out so callers can
// detect the real exit via classifyPitchExit() instead of the bounce
// silently stopping dead at the edge.
function looseBallBouncePoint(fromPoint, originPoint, random) {
  const distanceYards = RECEPTION_BOUNCE_MIN_YARDS
    + random() * (RECEPTION_BOUNCE_MAX_YARDS - RECEPTION_BOUNCE_MIN_YARDS);
  const fromYard = toYardPoint(fromPoint);
  const originYard = toYardPoint(originPoint);
  const dx = fromYard.x - originYard.x;
  const dy = fromYard.y - originYard.y;
  const baseAngle = (Math.abs(dx) < 1e-6 && Math.abs(dy) < 1e-6)
    ? random() * Math.PI * 2
    : Math.atan2(dy, dx);
  const angle = baseAngle + (random() - 0.5) * 2 * RECEPTION_BOUNCE_JITTER_RAD;
  const rawYard = {
    x: fromYard.x + Math.cos(angle) * distanceYards,
    y: fromYard.y + Math.sin(angle) * distanceYards,
  };
  const xy = fromYardPoint(rawYard);
  return { x: xy.x, y: xy.y, zone: zoneFromPercent(xy.x, xy.y) };
}

// Who -- if anyone -- can genuinely get to a loose ball bouncing from
// fromPoint to bouncePoint, via the SAME buildPassFlight()/
// earliestReachableContact() machinery the main pass race uses (a ground
// bounce is, physically, just an unaimed short ground pass nobody called).
// Computed BEFORE any trace event is authored so the "it spills loose"
// event's own ballTo can be the REAL point the ball gets to before anyone
// touches it (raceContact.atPoint, which can be well short of the full
// bouncePoint) rather than always claiming the full leg -- otherwise the
// very next event's ballFrom would start somewhere the previous event
// never claimed the ball reached, a genuine continuity break.
function latestAuthoredPlayerMove(trace, playerId) {
  return (trace || []).slice().reverse()
    .flatMap((event) => (event.playerMoves || []).slice().reverse())
    .find((move) => String(move.playerId ?? move.player?.id) === String(playerId)) ?? null;
}

function livePlayerMotionStart(entry, motionContext, trace) {
  const record = readMotionRecord(motionContext, entry.id, pointOf(entry));
  const lastMove = latestAuthoredPlayerMove(trace, entry.id);
  return {
    position: lastMove?.to ?? record.position ?? pointOf(entry),
    velocity: lastMove?.trajectory?.at(-1)?.velocity ?? record.velocity ?? { x: 0, y: 0 },
  };
}

function looseBallRaceContact(
  receiver, fromPoint, bouncePoint, bounceDurationMs, groups,
  { motionContext = null, trace = null } = {},
) {
  const bounceFlight = buildPassFlight({
    owner: receiver,
    receiver: null,
    from: fromPoint,
    intendedPoint: bouncePoint,
    actualEndpoint: bouncePoint,
    passType: "ground",
    durationMs: bounceDurationMs,
  });
  // A live bounce happens after the incoming delivery has already moved
  // players. The old frozen oracle below remains useful to standalone
  // resolver fixtures, but a real possession must race from the latest
  // authored body and velocity. The same advanceMotion result is later
  // rendered as the recovery run, so selection and playback cannot disagree
  // about whether the winner was physically within touching distance.
  if (motionContext || trace) {
    const candidates = [receiver, ...groups.opponents].map((candidate) => ({
      candidate,
      ...livePlayerMotionStart(candidate, motionContext, trace),
    }));
    const steps = Math.max(1, Math.ceil(bounceDurationMs / 40));
    for (let step = 0; step <= steps; step += 1) {
      const atMs = Math.min(bounceDurationMs, step * 40);
      const atPoint = ballPositionAtElapsed(bounceFlight, atMs);
      if (movementDistanceYards(fromPoint, atPoint) <= 1.5) continue;
      const eligible = [];
      for (const live of candidates) {
        if (atPoint.height > playerMaxReachYards(live.candidate.player)) continue;
        const reactionDelayMs = reactionDelayMsFor(live.candidate.player, {
          isIntendedReceiver: live.candidate.id === receiver.id,
        });
        const motion = advanceMotion({
          from: live.position,
          intentionTarget: atPoint,
          player: live.candidate.player,
          elapsedMs: atMs,
          incomingVelocity: live.velocity,
          reactionDelayMs,
          intention: "recover",
          paceToArrival: false,
        });
        const neededYards = movementDistanceYards(motion.position, atPoint);
        if (neededYards <= 1.5) eligible.push({ live, motion, neededYards, reactionDelayMs });
      }
      if (eligible.length) {
        eligible.sort((left, right) => left.neededYards - right.neededYards
          || String(left.live.candidate.id).localeCompare(String(right.live.candidate.id)));
        const winner = eligible[0];
        return {
          candidate: winner.live.candidate,
          isIntendedReceiver: winner.live.candidate.id === receiver.id,
          atMs,
          atPoint,
          bodyPoint: winner.motion.position,
          sourceFrom: winner.live.position,
          motion: winner.motion,
          reactionDelayMs: winner.reactionDelayMs,
          reachAllowanceYards: 1.5,
          neededYards: winner.neededYards,
          band: contactBandForHeight(atPoint.height),
          contestants: eligible.map((item) => ({
            candidate: item.live.candidate,
            neededYards: item.neededYards,
            reactionDelayMs: item.reactionDelayMs,
          })),
        };
      }
    }
    return null;
  }
  return earliestReachableContact({
    flight: bounceFlight,
    candidates: [receiver, ...groups.opponents],
  });
}

// Turns an already-computed looseBallRaceContact() result into the
// recovery trace event + resolver return -- shared by both
// resolveLooseBallBounce() (the ordinary HEAVY/LOSE case, which also
// narrates the spill itself) and the chest-duel-lost case (whose own duel
// event already narrates how it came loose, so it calls straight in here).
function resolveLooseBallRaceOutcome(receiver, pressingOpponent, bouncePoint, bounceDurationMs, raceContact, trace, motionContext = null) {
  if (!raceContact) {
    return {
      outcome: "LOOSE",
      code: "P.RECEIVE.BOUNCE.LOOSE",
      resolved: true,
      terminal: true,
      possession: "loose",
      nextOwnerId: null,
      ballEnd: bouncePoint,
      restart: null,
      reason: "pass-reception-loose",
    };
  }
  const winner = raceContact.candidate;
  const recoveredByReceiver = winner.id === receiver.id;
  // The roster entry is the action's opening snapshot. During the incoming
  // pass its owner may already have moved through the shared world-motion
  // context, so starting this overlapping bounce chase from pointOf(winner)
  // can jump them back to that stale snapshot. Continue from the exact live
  // position and velocity carried by the preceding authored movement.
  const recoveryStart = livePlayerMotionStart(winner, motionContext, trace);
  const recoveryFrom = raceContact.sourceFrom ?? recoveryStart.position;
  const recovery = raceContact.motion ?? advanceMotion({from:recoveryFrom,intentionTarget:raceContact.atPoint,
    player:winner.player,elapsedMs:raceContact.atMs,reactionDelayMs:raceContact.reactionDelayMs ?? 0,
    incomingVelocity:recoveryStart.velocity,intention:"recover",paceToArrival:false});
  trace.push(traceEvent("BALL.RECOVERY.RUN", `${playerName(winner.player)} reaches for the loose ball`, {
    actor:winner,movement:"reposition",duration:raceContact.atMs,overlapWithPrevious:true,
    playerMoves:[{player:winner,from:recoveryFrom,to:recovery.position,trajectory:recovery.trajectory,
      action:"recover-loose-ball",reactionDelayMs:raceContact.reactionDelayMs ?? 0}],
  }));
  trace.push(
    traceEvent(
      recoveredByReceiver ? "P.RECEIVE.BOUNCE.WON" : "P.RECEIVE.BOUNCE.LOST",
      recoveredByReceiver
        ? `${playerName(receiver.player)} recovers their own loose touch`
        : `${playerName(winner.player)} pounces on the loose ball`,
      {
        actor: recoveredByReceiver ? receiver : winner,
        defender: recoveredByReceiver ? pressingOpponent : winner,
        movement: "reception",
        outcome: recoveredByReceiver ? "success" : "turnover",
        ballFrom: raceContact.atPoint,
        ballTo: recovery.position,
        contact: { point: raceContact.atPoint, bodyPoint:recovery.position,
          reachAllowanceYards:raceContact.reachAllowanceYards ?? 1.5,
          actor: winner, type: "recovery", phase: "start" },
        ownerBefore: null,
        ownerAfter: winner,
        duration: 120,
      },
    ),
  );
  return {
    outcome: recoveredByReceiver ? "RECOVERED" : "TURNOVER",
    code: recoveredByReceiver ? "P.RECEIVE.BOUNCE.WON" : "P.RECEIVE.BOUNCE.LOST",
    resolved: true,
    terminal: !recoveredByReceiver,
    possession: recoveredByReceiver ? "retained" : "turnover",
    nextOwnerId: winner.id,
    ballEnd: recovery.position,
    restart: null,
    reason: recoveredByReceiver ? "pass-reception-recovered" : "pass-reception-lost",
  };
}

// The bad touch itself (real duration, ownerAfter: null -- the ball is
// genuinely nobody's for this leg, not silently reassigned yet), then
// resolveLooseBallRaceOutcome() above for who actually gets there.
function resolveLooseBallBounce(receiver, pressingOpponent, fromPoint, originPoint, groups, code, status, random, trace, motionContext = null, interleaveOffBall = false) {
  const bouncePoint = looseBallBouncePoint(fromPoint, originPoint, random);
  // Ball Out of Bounds v1 (2026-09-01) -- a heavy touch that spills the
  // ball off the pitch was never a genuine recovery race to begin with;
  // checked before anyone is raced toward what would be an off-pitch
  // target.
  const bouncePitchExit = classifyPitchExit({
    from: fromPoint, to: bouncePoint, lastTouchTeam: receiver.team, attackingDirectionByTeam: state.attackingDirection,
  });
  if (bouncePitchExit) {
    return {
      ...pushPitchExitRestart(trace, {
        actor: receiver, ballFrom: fromPoint, exit: bouncePitchExit, movement: "reception",
        contact: { point: fromPoint, actor: receiver, type: "control", phase: "start" },
      }),
      offBallInterleaved: false,
    };
  }
  const bounceDurationMs = looseBallFlightMs(yardDistance(fromPoint, bouncePoint));
  const raceContact = looseBallRaceContact(
    receiver, fromPoint, bouncePoint, bounceDurationMs, groups, { motionContext, trace },
  );
  trace.push(
    traceEvent(
      code,
      `${playerName(receiver.player)}: ${status} -- it spills loose`,
      {
        actor: receiver,
        defender: pressingOpponent,
        movement: "reception",
        outcome: "turnover",
        playerMoves: [],
        ballFrom: fromPoint,
        ballTo: raceContact ? raceContact.atPoint : bouncePoint,
        // phase:"start", not "end" -- this contact (the bad touch itself)
        // happens at the FRONT of this event's own window; the ball then
        // travels away from it, to ballTo, over the rest of the duration.
        // "end" is for a STATIONARY arrival (ballFrom===ballTo, e.g. the
        // recovery event right above this function) -- using it here,
        // where the ball genuinely moves, told the playback validator to
        // expect the ball already AT fromPoint by this event's own END,
        // which is exactly where it is NOT (a real, caught contact-
        // continuity violation once a possession happened to route
        // through this path with an overlapping off-ball reaction ahead
        // of it).
        contact: { point: fromPoint, actor: receiver, type: "control", phase: "start" },
        ownerBefore: null,
        ownerAfter: null,
        duration: raceContact ? raceContact.atMs : bounceDurationMs,
      },
    ),
  );
  // Gameplay v3.1 -- the flight leading up to this bad touch is already
  // covered by resolvePass()'s own shared reactOffBallContinuous() call
  // (the RECEPTION_BOUNCE_CODES branch just knows it, via
  // offBallInterleaved on the wrapped return below); this is the
  // NARROWER gap -- the spill/recovery race itself, which used to leave
  // everyone but the eventual recoverer frozen for its own duration too.
  // Excludes only raceContact's own winner: they already get a real,
  // specific contact-pinned run from resolveLooseBallRaceOutcome() above
  // (or nobody, if raceContact is null and the ball just dies loose).
  const bounceOffBallInterleaved = interleaveFlightOffBall(
    interleaveOffBall, groups, fromPoint, raceContact ? raceContact.atPoint : bouncePoint,
    raceContact ? raceContact.atMs : bounceDurationMs, trace, motionContext,
    [raceContact?.candidate?.id].filter(Boolean),
  );
  return {
    ...resolveLooseBallRaceOutcome(receiver, pressingOpponent, bouncePoint, bounceDurationMs, raceContact, trace, motionContext),
    offBallInterleaved: bounceOffBallInterleaved,
  };
}

// Gameplay v3.1 (2026-08-29) -- thin, deliberate wrapper so every
// airborne/loose EARLY RETURN in this file calls off-ball interleaving
// through the EXACT same shape, instead of some branches remembering to
// and others silently not. Reported bug: resolvePass() only ever reached
// reactOffBallContinuous() on its own CLEAN fall-through (contact owned,
// falling through to the shared tail) -- every EARLY return before that
// point (nobody reachable, an aerial/chest contest lost, a clean
// interception, a beaten interceptor whose receiver still can't get
// there) left the other 20+ players frozen for the whole flight/bounce/
// chase window, then hit runConstructedPossession()'s own
// POST_ACTION_CONVERGENCE_MS (200ms) reshape afterward -- a statue, then
// a twitch. Not a new mechanism -- reactOffBallContinuous()'s own
// overlapWithPrevious/chaseIntention defaults (true/true) already match
// a live-ball window; this exists so every call site in this file looks
// like every other one, not so the underlying behavior differs.
// Returns whether it actually interleaved, so callers can thread that
// straight into their own `offBallInterleaved` return field (which is
// what tells runConstructedPossession() to skip its own 200ms reshape).
function interleaveFlightOffBall(interleaveOffBall, groups, ballFrom, ballTo, durationMs, trace, motionContext, excludedIds = []) {
  if (!interleaveOffBall) return false;
  reactOffBallContinuous(groups, ballFrom, ballTo, durationMs, trace, {
    motionContext,
    excludedIds,
    overlapWithPrevious: true,
    chaseIntention: true,
  });
  return true;
}

// The intended receiver's own best-effort chase toward a delivery they
// cannot actually reach in time -- contactArrivalTiming() (unchanged
// Match-Lab infrastructure) shows honestly how far they got, never a
// teleport to a reception nobody could physically make. Shared by three
// call sites: resolvePass() (nobody at all being reachable along the
// whole flight, and (2026-08-26, Off-Ball Motion v3 fix -- a real
// reported discontinuity: a beaten lane interceptor let the ball through
// to actualEndpoint unconditionally, without ever checking whether the
// INTENDED receiver -- selected before the flight was even built -- could
// physically get there, a genuine gap Lead Into Space's own longer leads
// made far more likely to actually bite) a lane interceptor being beaten
// but the intended receiver still failing their own arrival race to the
// real, error-affected actualEndpoint) and resolveThroughBall()'s own
// analogous nobody-reachable case. Caller pushes its own "P.PASS"/
// "P.THROUGH" event first (each call site narrates that differently);
// this authors the chase + loose outcome that follows it, PLUS (Gameplay
// v3.1) the rest of the pitch's own off-ball reaction spanning that same
// real flight window -- Costa chasing a loose ball must not pause
// everyone else.
// Loose Ball Momentum v1 (2026-08-31) -- a real reported bug: "the ball
// just stops in the free area... it has momentum, it rolls until its
// momentum dies." ballPositionAtElapsed() (matchPassFlight.js) is
// deliberately a pure position function with no stored velocity ("there
// is nothing to desynchronize") -- exactly correct for the FLIGHT itself,
// but it means nothing downstream ever learns how fast the ball was
// actually moving the instant it touched down with nobody there. A real
// flight's own average velocity (displacement / duration) is a fair,
// honest stand-in for "how fast at touchdown" -- footballs don't
// meaningfully decelerate in the air over a normal pass distance, so a
// constant-velocity model for the FLIGHT portion is physically fine; only
// once it's rolling on the ground does GROUND_FRICTION_YPS2
// (ballRollPhysics.js) apply. Percent-of-pitch-per-ms, the SAME velocity
// unit convention every other trajectory sample in this project already
// uses.
function flightLandingVelocity(flightFrom, landingPoint, durationMs) {
  if (!flightFrom || !landingPoint || durationMs <= 0) return { x: 0, y: 0 };
  return {
    x: (landingPoint.x - flightFrom.x) / durationMs,
    y: (landingPoint.y - flightFrom.y) / durationMs,
  };
}

// Ball Out of Bounds v1 (2026-09-01) -- a real, explicit correction: "the
// boundaries are concrete... the ball should be able to go out of
// bounds." One shared authoring point for every site that used to just
// clamp the ball back onto the pitch: builds the trace event (a real
// RESTART.* code, the ball's own ballFrom carrying real momentum to
// exit.ballEnd -- never a teleport to a fixed flag/box spot) AND the
// dead-ball resolver result every call site would otherwise duplicate.
// runConstructedPossession() consumes that result afterward and executes
// the awarded restart; this helper remains responsible only for the exit.
// playerMoves/ballTrajectory are OPTIONAL and caller-supplied: a carry
// genuinely runs the ball out (the carrier's own real touch/chase
// trajectory), while a pass/cross/clearance/loose-ball roll doesn't move
// the kicker at all -- each call site passes whatever it already
// legitimately has, this never invents movement of its own. No off-ball
// reaction is authored here at all: every OTHER player keeps whatever
// position they last had, exactly as instructed -- nobody teleports into
// a restart shape.
const PITCH_EXIT_CODES = {
  "throw-in": "RESTART.THROW_IN",
  corner: "RESTART.CORNER",
  "goal-kick": "RESTART.GOAL_KICK",
};
const PITCH_EXIT_LABELS = {
  "throw-in": (name) => `${name} puts it out for a throw-in`,
  corner: (name) => `${name} puts it behind for a corner`,
  "goal-kick": (name) => `${name} puts it out for a goal kick`,
};
function pushPitchExitRestart(trace, {
  actor, ballFrom, exit, movement, outcome = "turnover",
  playerMoves = [], ballTrajectory = null, contact = null,
  duration = undefined,
  overlapWithPrevious = undefined, overlapStartOffsetMs = undefined,
  // Dynamic Ball Claim v2 (2026-09-04) -- a real reported bug, and the
  // visible half of "the passer runs after the ball until it goes out."
  // Every OTHER caller here is a genuine touch: somebody actually played
  // the ball and it left the pitch, so pinning them to the contact is
  // correct. A ball that rolls out UNTOUCHED after a delivery nobody
  // reached is not that. There, `actor` is only the last-touch
  // ATTRIBUTION -- whose touch is blamed for the restart -- and they may
  // be forty yards away doing something else entirely. The default
  // contact below names them as the contact actor at the EXIT point, and
  // matchLabPlayback.js's own after-the-fact contact re-pin then drags
  // their track to that point ("makes sure the actor is provably at the
  // ball at the instant contact says they are"), which is literally the
  // passer being teleported after a ball they never chased. That call
  // site passes false; nothing else changes.
  pinActorToExit = true,
} = {}) {
  const code = PITCH_EXIT_CODES[exit.restart];
  trace.push(
    traceEvent(code, PITCH_EXIT_LABELS[exit.restart](playerName(actor.player)), {
      actor,
      movement,
      outcome,
      ballFrom,
      ballTo: exit.ballEnd,
      ...(playerMoves.length ? { playerMoves } : {}),
      ...(ballTrajectory ? { ballTrajectory } : {}),
      ...(contact || pinActorToExit
        ? { contact: contact ?? { point: exit.ballEnd, actor, type: movement, phase: "end" } }
        : {}),
      ownerBefore: actor,
      ownerAfter: null,
      ...(duration !== undefined ? { duration } : {}),
      ...(overlapWithPrevious !== undefined ? { overlapWithPrevious } : {}),
      ...(overlapStartOffsetMs !== undefined ? { overlapStartOffsetMs } : {}),
    }),
  );
  return {
    outcome: exit.restart.toUpperCase().replace("-", "_"),
    code,
    resolved: true,
    terminal: true,
    possession: "dead",
    nextOwnerId: null,
    ballEnd: exit.ballEnd,
    restart: exit.restart,
    // Keep the law decision with the transition. The possession runner
    // needs the awarded side and exit edge to construct the actual restart
    // after this dead-ball event; re-deriving either from a later playback
    // position would be ambiguous.
    restartTakingTeam: exit.possessionTeam ?? null,
    restartEdge: exit.edge ?? null,
    reason: `${movement}-out-of-play`,
  };
}

// Dynamic Ball Claim v2 -- the most recent loose-ball race, kept for the
// read-only Match Lab diagnostics panel and for tests that need to assert
// on WHY a player did or did not chase. Diagnostics only: nothing in the
// engine reads this back, so it can never influence an outcome.
// Joint Passer/Runner Candidate Generation v1 (Stage 3) -- the joint
// candidates behind the most recent decision, for the read-only panel.
// Diagnostics only: nothing in the engine reads this back.
let lastJointCandidates = [];
function recordJointCandidates(candidates) {
  lastJointCandidates = (candidates || [])
    .filter((candidate) => candidate?.joint)
    .map((candidate) => ({ type: candidate.type, ...candidate.joint }))
    .sort((left, right) => right.utility - left.utility);
  return lastJointCandidates;
}
function lastJointCandidateDiagnostics() { return lastJointCandidates; }

let lastBallClaim = null;
function recordBallClaim(claim) { lastBallClaim = claim; return claim; }
function lastBallClaimDiagnostics() { return lastBallClaim; }

function pushLooseDeliveryChase(receiver, actualEndpoint, passDuration, trace, groups = null, motionContext = null, interleaveOffBall = false, flightFrom = null) {
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
  // Gameplay v3.1 -- the rest of the pitch keeps pursuing the jobs
  // they already have for the WHOLE real flight window while the
  // receiver makes their own doomed chase; excluded here since their
  // own ATT.RECEIVER.RUN above already authors a real, specific move.
  const offBallInterleaved = groups
    ? interleaveFlightOffBall(interleaveOffBall, groups, pointOf(groups.owner), actualEndpoint, passDuration, trace, motionContext, [receiver.id])
    : false;
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
    offBallInterleaved,
    // Loose Ball Momentum v1 -- see flightLandingVelocity()'s own header.
    ballVelocity: flightLandingVelocity(flightFrom, actualEndpoint, passDuration),
  };
}

// Kick As Projectile v1 (2026-08-27) -- see matchPassFlight.js's own
// simulateFlightUntilContact() header comment for the full rationale.
// Computes every candidate's ordinary tactical job ONCE per kick (jobs
// persist; only contact goes live) via the SAME planAttackerRepositioning()/
// planDefensiveRepositioning() calls reactOffBall()/reactOffBallContinuous()
// already use for the visual off-ball reaction -- this is the SAME
// question ("where would this player be heading right now") asked once
// more so the live tick has a real answer for "what do I do if I'm not
// chasing this ball." Shared by resolvePass() and resolveThroughBall()
// (the spec's own "MUST use the same helper" requirement) so a through
// ball and an ordinary pass race an identical live world.
//
// `flightDestination` (falls back to `ballOwnerPoint`, the kick origin,
// when the caller has none) is deliberately a SEPARATE point from
// `ballOwnerPoint`: reactOffBallContinuous()'s own last-man-recovery call
// judges ballBeatsADefender()/identifyLineBreakingRunnerId() against
// `ballTo` -- the flight's real destination -- never the kick origin,
// for the obvious reason that a ball sitting at the passer's own foot
// hasn't beaten anybody yet. Using the origin here silently disabled
// last-man recovery for the whole live-tick window (a real, caught bug --
// every defender fell through to ordinary marking, never "recover", no
// matter how clearly a through ball was in behind them). Attacker/keeper
// positioning below intentionally keeps using `ballOwnerPoint` --
// unrelated to this bug and already proven correct this slice.
function buildLiveJobTargets(groups, ballOwnerPoint, motionContext, flightDestination = ballOwnerPoint, passerId = null, flight = null) {
  const jobs = {};
  const owner = groups.owner;
  const previousActionHolderId = (action) => {
    for (const teammate of groups.teammates) {
      if (motionContext?.state?.players?.[teammate.id]?.intention?.action === action) return teammate.id;
    }
    return null;
  };
  const attackDirection = state.attackingDirection[owner.team];
  let markingLookup = {};
  if (groups.opponents.length) {
    const defendingDirection = state.attackingDirection[groups.opponents[0].team];
    const defendingTeamMarking = markingSettingsFor(groups.opponents[0].team);
    const runnerId = groups.teammates.length
      ? identifyLineBreakingRunnerId(groups.teammates, groups.opponents, attackDirection, flightDestination, groups.keeper)
      : null;
    const defenderPlan = planDefensiveRepositioning(
      flightDestination, groups.teammates, groups.opponents, defendingDirection,
      {
        previousMarking: motionContext?.marking || {},
        ownerId: owner.id,
        scheme: defendingTeamMarking.scheme,
        tightness: defendingTeamMarking.tightness,
        runnerId,
      },
    );
    markingLookup = syncMarkingAssignments(defenderPlan, motionContext);
    for (const step of defenderPlan) {
      jobs[step.id] = {
        point: step.intentionTarget,
        // press-ball/recover/delay are jobs that already mean "go get this
        // ball" (delay is still closing the gap, just not yet in real
        // challenge range -- see planDefensiveRepositioning()'s own
        // header); a plain man-mark/zonal job still waives the corridor
        // check once shouldChaseBall() finds them within it on their own.
        mayChase: step.action === "press-ball" || step.action === "recover" || step.action === "delay",
      };
    }
  }
  if (groups.teammates.length || passerId) {
    const attackerPlan = planAttackerRepositioning(
      passerId ? [...groups.teammates, owner] : groups.teammates, groups.opponents, attackDirection,
      {
        ballPoint: ballOwnerPoint,
        keeper: groups.keeper,
        previousSupportId: previousActionHolderId("support-short"),
        previousDropId: previousActionHolderId("drop-deep"),
        previousShowId: previousActionHolderId("show-to-feet"),
        markingLookup,
        ownerBand: classifyOutfieldBand(owner.player),
        passerId,
        passDestination: flightDestination,
      },
    );
    for (const step of attackerPlan) {
      if (step.held) continue;
      jobs[step.id] = {
        point: step.intentionTarget,
        // A line-breaking run is already "go get this ball" -- everyone
        // else's job (support-short, hold-width, pin-last-line, ...) is
        // real tactical shape, not a chase order.
        mayChase: step.action === "run-in-behind",
      };
    }
  }
  if (groups.keeper) {
    jobs[groups.keeper.id] = {
      point: keeperPositioningPoint(ballOwnerPoint, state.attackingDirection[groups.keeper.team]),
      mayChase: false,
    };
    if (flight) {
      const keeper = groups.keeper;
      const attackers = groups.teammates.slice().sort((a, b) => yardDistance(a, flightDestination) - yardDistance(b, flightDestination));
      const response = planKeeperResponse({ keeper, ball: flight.from, attacker: attackers[0] ?? owner,
        defenders: groups.opponents, defendingDirection: state.attackingDirection[keeper.team],
        velocity: motionContext?.state?.players?.[keeper.id]?.velocity,
        attackerVelocity: motionContext?.state?.players?.[attackers[0]?.id]?.velocity,
        ballVelocity: flightLandingVelocity(flight.from, flight.actualEndpoint, flight.durationMs),
        holdTarget: jobs[keeper.id].point,
        random: seededRandom(hashString(`keeper-flight:${motionContext?.seed ?? 0}:${keeper.id}:${flight.from.x}:${flight.from.y}:${flight.actualEndpoint.x}:${flight.actualEndpoint.y}`)),
      });
      if (response.action === "keeper-sweep") {
        jobs[keeper.id] = { point: response.target, action: response.action, authoritativeMotion: true,
          reactionDelayMs: response.reactionDelayMs, velocity: motionContext?.state?.players?.[keeper.id]?.velocity };
        const cover = chooseGoalCover({ keeper, defenders: groups.opponents, ball: flightDestination,
          defendingDirection: state.attackingDirection[keeper.team], keeperAction: response.action });
        if (cover) jobs[cover.id] = { point: cover.target, action: cover.action, authoritativeMotion: true,
          reactionDelayMs: cover.reactionDelayMs, velocity: motionContext?.state?.players?.[cover.id]?.velocity };
      }
    }
  }
  return (playerId) => jobs[playerId] ?? null;
}

function resolveDeliveryWithKeeperMotion(resolver, groups, availability, random, trace, interleaveOffBall, motionContext) {
  const scopedGroups = { ...groups, keeperFlight: null, deliveryTraceStart: trace.length };
  const result = resolver(scopedGroups, availability, random, trace, interleaveOffBall, motionContext);
  flushKeeperFlight(scopedGroups, trace, motionContext);
  return result;
}

function resolvePass(...args) { return resolveDeliveryWithKeeperMotion(resolvePassInternal, ...args); }
function resolveThroughBall(...args) { return resolveDeliveryWithKeeperMotion(resolveThroughBallInternal, ...args); }

function registerKeeperFlight(groups, flight, contact, jobTargetFor) {
  const entries = [...groups.opponents, ...(groups.keeper ? [groups.keeper] : [])];
  const jobs = entries.filter((entry) => jobTargetFor(entry.id)?.authoritativeMotion)
    .map((entry) => ({ entry, from: pointOf(entry), job: jobTargetFor(entry.id), motion: contact.jobMotions[entry.id] }));
  if (jobs.length) groups.keeperFlight = { jobs, flight, contact, done: false };
}

function flushKeeperFlight(groups, trace, motionContext, durationMs = null) {
  const pending = groups.keeperFlight;
  if (!pending || pending.done) return [];
  const producerIndex = trace.findIndex((event, index) => index >= groups.deliveryTraceStart
    && (event.code === "P.PASS" || event.code === "P.THROUGH"));
  if (producerIndex < 0) return [];
  const duration = trace[producerIndex].duration ?? durationMs ?? pending.contact.atMs;
  const moves = pending.jobs.map(({ entry, from, job, motion }) => {
    const actual = Math.abs(duration - pending.contact.atMs) < 1 ? motion : advanceMotion({ from,
      intentionTarget: job.point, player: entry.player, elapsedMs: duration, incomingVelocity: job.velocity,
      reactionDelayMs: job.reactionDelayMs, intention: job.action, paceToArrival: false });
    Object.assign(entry, actual.position, { engineJob: job.action });
    if (entry.role === "keeper") entry.keeperVelocity = actual.velocity;
    writeMotionRecord(motionContext, entry.id, { position: actual.position, velocity: actual.velocity,
      intention: job.action, intentionTarget: job.point, role: entry.role });
    return { player: entry, from, to: actual.position, trajectory: actual.trajectory,
      action: job.action, reactionDelayMs: job.reactionDelayMs };
  });
  const label = moves.length > 1 ? "The keeper attacks the ball; a defender recovers toward goal" : "The keeper attacks the ball";
  trace.splice(producerIndex + 1, 0, traceEvent("GK.RUSH", label, {
    movement: "reposition", duration, overlapWithPrevious: true, playerMoves: moves,
  }));
  pending.done = true;
  return pending.jobs.map(({ entry }) => entry.id);
}

function resolveSweeperContact(groups, flight, contact, trace, motionContext, interleaveOffBall, deliveryCode = "P.PASS") {
  const keeper = contact.candidate;
  const coveringDefender = keeper.role !== "keeper";
  trace.push(traceEvent(deliveryCode, `${playerName(groups.owner.player)} plays into space; ${playerName(keeper.player)} arrives first`, {
    actor: groups.owner, movement: "pass", duration: contact.atMs, ballFrom: flight.from, ballTo: contact.atPoint,
    ownerBefore: groups.owner, ownerAfter: null,
    contact: { actor: groups.owner, point: flight.from, type: "pass", phase: "start" },
  }));
  const excludedIds = flushKeeperFlight(groups, trace, motionContext, contact.atMs);
  if (interleaveOffBall) reactOffBallContinuous(groups, flight.from, contact.atPoint, contact.atMs, trace,
    { motionContext, excludedIds });
  const execution = executeKeeperSweep({ keeper, point: contact.atPoint,
    defendingDirection: state.attackingDirection[keeper.team],
    random: seededRandom(hashString(`keeper-execution:${motionContext?.seed ?? 0}:${keeper.id}:${contact.atMs}:${contact.atPoint.x}:${contact.atPoint.y}`)) });
  const claimed = execution.action === "claim";
  const code = coveringDefender ? "DEF.GOAL_COVER.CLEAR" : claimed ? "GK.SWEEP.CLAIM" : execution.action === "spill" ? "GK.SWEEP.SPILL" : execution.error ? "GK.SWEEP.MISKICK" : "GK.SWEEP.CLEAR";
  trace.push(traceEvent(code, `${playerName(keeper.player)} ${claimed ? "gathers the ball" : execution.error ? "fails to control the ball cleanly" : "clears with his feet"}`, {
    actor: keeper, keeper: coveringDefender ? null : keeper, movement: "touch", duration: 120,
    ballFrom: contact.atPoint, ballTo: claimed ? pointOf(keeper) : contact.atPoint,
    ownerBefore: null, ownerAfter: claimed ? keeper : null,
    contact: { actor: keeper, point: contact.atPoint, bodyPoint: pointOf(keeper),
      reachAllowanceYards: contact.reachAllowanceYards, type: claimed ? "catch" : "clearance", phase: "start" },
  }));
  return { outcome: claimed ? "TURNOVER" : "LOOSE", code, resolved: true, terminal: claimed,
    held: claimed,
    possession: claimed ? "turnover" : "loose", nextOwnerId: claimed ? keeper.id : null,
    ballEnd: claimed ? pointOf(keeper) : contact.atPoint, ballVelocity: execution.velocity,
    ballVelocityPhase: "rolling", restart: null, reason: claimed ? "keeper-sweep-claim" : "keeper-sweep-clearance",
    offBallInterleaved: interleaveOffBall };
}

function resolvePassInternal(
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
    availability?.restartType ?? null,
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
  // Joint Passer/Runner Candidate Generation v1 (Stage 3) -- the delivery is
  // struck toward the AIM point, so distance, pass type and flight duration
  // must all be measured to it. Free Play supplies this even for a pass to
  // feet: current-position is an explicit planned point, not a missing plan.
  const aimPointForDelivery = availability?.plannedMoveTo ?? pointOf(receiver);
  const passDistanceYards = yardDistance(owner, aimPointForDelivery);
  // A forced type (a keeper's own hand throw -- see availability's own
  // comment) always wins outright; selectPassType()'s distance/lane-
  // congestion geometry is for a genuinely kicked ball and has no concept
  // of "this is a throw," so it must never override one.
  const deliveryIntent = availability?.plannedDeliveryIntent
    ?? (availability?.plannedMoveTo ? "planned-space" : "current-position");
  const passType = availability?.forcedPassType || availability?.plannedPassType || selectPassType({
    passer: owner.player,
    from: pointOf(owner),
    to: aimPointForDelivery,
    opponents: groups.opponents,
    deliveryIntent,
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
  // Lead Into Space v1 -- the passer genuinely AIMS at the lead point, so
  // the real accuracy-error scatter (actualEndpoint, the ball's own actual
  // path) must be centered on it too, not on the receiver's raw current
  // spot. intendedPoint isn't just descriptive metadata here: it's the real
  // aim point the whole flight is struck toward.
  // Joint Passer/Runner Candidate Generation v1 (Stage 3) -- when the
  // decision was a joint candidate whose meeting point is genuinely NOT the
  // receiver's feet, that point IS the aim, and it wins outright: the whole
  // idea of the candidate was "play it there while they run onto it."
  // Everything below is unchanged, which matters more than it looks: the
  // accuracy scatter is still applied to the aim point to produce
  // actualEndpoint, and the two are still never reconciled afterwards. The
  // ball does not bend toward the receiver, so a joint candidate can miss
  // its own intended meeting point exactly like any other delivery.
  // A direct resolver caller may still omit a plan and gets the historical
  // lead rule below. Free Play never omits the joint point, including feet.
  const intendedPoint = availability?.plannedMoveTo
    ?? (shouldLeadIntendedPoint(passType, passDistanceYards, attackingSettingsFor(owner.team))
      ? leadIntendedPoint(receiver, owner, offside)
      : pointOf(receiver));
  const actualEndpointXY = deliveryLandingPoint(
    intendedPoint,
    accuracyErrorYards,
    random,
  );
  const passOrigin = pointOf(owner);
  const passDuration = passFlightDurationMsForType(passDistanceYards, passType);
  // Ball Out of Bounds v1 (2026-09-01) -- deliveryLandingPoint() is now
  // deliberately unclamped (see its own header), so a genuinely wild pass
  // can land off-pitch. Checked BEFORE anyone races the flight: an overhit
  // ball that leaves the pitch was never catchable by a real player, so it
  // skips the whole contact/duel simulation below rather than being pulled
  // back in bounds first and resolved as an ordinary reception.
  const passPitchExit = classifyPitchExit({
    from: passOrigin,
    to: actualEndpointXY,
    lastTouchTeam: owner.team,
    attackingDirectionByTeam: state.attackingDirection,
  });
  if (passPitchExit) {
    const fullDistanceYards = yardDistance(passOrigin, actualEndpointXY);
    const exitDistanceYards = yardDistance(passOrigin, passPitchExit.ballEnd);
    const exitDurationMs = fullDistanceYards > 0 ? passDuration * (exitDistanceYards / fullDistanceYards) : 0;
    return pushPitchExitRestart(trace, {
      actor: owner, ballFrom: passOrigin, exit: passPitchExit, movement: "pass", duration: exitDurationMs,
    });
  }
  const actualEndpoint = {
    x: actualEndpointXY.x,
    y: actualEndpointXY.y,
    zone: zoneFromPercent(actualEndpointXY.x, actualEndpointXY.y),
  };
  const flight = buildPassFlight({
    owner,
    receiver,
    from: pointOf(owner),
    intendedPoint,
    actualEndpoint,
    passType,
    durationMs: passDuration,
  });
  const passFlightEvidence = {
    passType,
    deliveryIntent,
    distanceYards: Number(passDistanceYards.toFixed(2)),
    peakHeightYards: Number(flight.peakHeightYards.toFixed(2)),
    speedYardsPerSecond: passFlightProfile(passType, passDistanceYards).speedYardsPerSecond,
  };

  // The unified race -- see matchPassFlight.js's own header comment on
  // earliestReachableContact() for the full rationale. The intended
  // receiver is one candidate among equals here, not a privileged check
  // run separately; this is what makes "meet the ball at the earliest
  // useful point along its trajectory" true for free -- whichever point
  // along the path someone FIRST qualifies for is what wins, never the
  // flight's own endpoint by default.
  // Kick As Projectile v1 (2026-08-27) -- see matchPassFlight.js's own
  // simulateFlightUntilContact() header comment for the full rationale.
  // `receiver` above is INTENTION only from here on (the aim, and a small
  // reaction bias via intendedReceiverId) -- the live tick below races
  // EVERY teammate too, not just the one the passer was aiming for, so an
  // overhit ball, a deflection, or a genuine poach by someone else is a
  // legal outcome, never silently corrected back onto the named receiver.
  // Pattern Vocabulary V1, Step 1 (2026-09-02) -- resolvePass() is also the
  // real resolver behind a keeper's own throw-short/throw-long/punt
  // (FREE_PLAY_RESOLVERS); a goalkeeper distributing the ball never gets a
  // run-off-pass job -- they hold the goalkeeper line (keeperPositioningPoint()
  // already covers this), never join the outfield attacking pool.
  const jobTargetFor = buildLiveJobTargets(groups, pointOf(owner), motionContext, actualEndpoint, owner.role === "keeper" ? null : owner.id, flight);
  const contact = simulateFlightUntilContact({
    flight,
    players: [...groups.teammates, ...groups.opponents, ...(groups.keeper ? [groups.keeper] : [])],
    jobTargetFor,
  });
  registerKeeperFlight(groups, flight, contact, jobTargetFor);
  if (contact.candidate && contact.jobMotions?.[contact.candidate.id] && groups.keeperFlight)
    return resolveSweeperContact(groups, flight, contact, trace, motionContext, interleaveOffBall);
  // passQuality feeds resolveReceive()'s own strain calc -- duel.probability
  // when a real in-flight contest happened, otherwise 1 (an uncontested
  // delivery is honestly high-quality; there was no defender to make it
  // otherwise).
  let passQuality = 1;

  if (!contact.candidate) {
    // Nobody -- not even the intended receiver -- genuinely got there
    // during the live tick. The ball travels its full, independent
    // distance to actualEndpoint and runs loose there.
    trace.push(
      traceEvent(
        "P.PASS",
        `${playerName(owner.player)} ${passVerbPhrase(passType, "plays")} toward ${playerName(receiver.player)}, but it runs away from everyone`,
        {
          actor: owner,
          target: receiver,
          movement: "pass",
          outcome: "neutral",
          ballFrom: pointOf(owner),
          // Joint Passer/Runner Candidate Generation v1 (Stage 3) -- the aim
          // point, recorded alongside the ball's real endpoint so the two stay
          // visibly separate facts. Diagnostics and tests read this; nothing in
          // the engine consumes it, and it never influences the flight.
          intendedPoint: { ...intendedPoint },
          ballTo: actualEndpoint,
          contact: { point: pointOf(owner), actor: owner, type: "pass", phase: "start" },
          ownerBefore: owner,
          ownerAfter: null,
          offside,
          duration: passDuration,
          metrics: { passFlight: passFlightEvidence },
        },
      ),
    );
    return pushLooseDeliveryChase(receiver, actualEndpoint, passDuration, trace, groups, motionContext, interleaveOffBall, pointOf(owner));
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
  // Extra control strain from a genuine aerial/chest contest, added to
  // resolveReceive()'s own strain calc below (2026-08-26, Passing v3) --
  // chest/thigh control off a contested ball is not a clean ground take.
  let contestStrainBonus = 0;
  // Kick As Projectile v1 -- WHO actually ends up controlling the ball,
  // not necessarily `receiver` (the passer's own original intention).
  // Every branch below that falls through to the shared resolveReceive()
  // flow further down assigns this explicitly; every branch with its own
  // early return already names the real winner directly.
  let actualReceiver = receiver;

  // Aerial/Chest Contest v1 (2026-08-26, Passing v3), generalized for Kick
  // As Projectile v1 (2026-08-27): candidates are now every teammate PLUS
  // every opponent (not just [receiver, ...opponents]), so "the attacking
  // side" in this race can genuinely be a different teammate than the one
  // the passer was aiming for -- a deflection/poach at header/chest height
  // is just as legal as one at a clean, ground-level touch. Pick the best
  // attacking-side contestant the SAME way the best defending one is
  // already picked, by team membership rather than a specific hardcoded id.
  const contestants = contact.contestants
    ?? [{ candidate: contact.candidate, isIntendedReceiver: contact.isIntendedReceiver }];
  const attackingContestants = contestants.filter((entry) => entry.candidate.team === owner.team);
  const opposingContestants = contestants.filter((entry) => entry.candidate.team !== owner.team);
  const isAerialOrChestContest = attackingContestants.length > 0 && opposingContestants.length > 0
    && (contact.band === "head" || contact.band === "chest");

  if (isAerialOrChestContest) {
    const isHeader = contact.band === "head";
    const duelDefenceAttrs = isHeader
      ? ["Positioning", "Anticipation", "Marking"]
      : ["Strength", "Balance", "Aggression", "Positioning"];
    const duelAttackAttrs = isHeader
      ? ["Jumping", "Heading", "Strength"]
      : ["Strength", "Balance", "Technique", "Aggression"];
    const aerialDefender = [...opposingContestants].sort(
      (left, right) =>
        sumPlayerAttributes(right.candidate.player, duelDefenceAttrs)
        - sumPlayerAttributes(left.candidate.player, duelDefenceAttrs),
    )[0].candidate;
    // The best-placed attacking contestant, not necessarily the passer's
    // own original intention -- see this branch's own header comment.
    const receiver = [...attackingContestants].sort(
      (left, right) =>
        sumPlayerAttributes(right.candidate.player, duelAttackAttrs)
        - sumPlayerAttributes(left.candidate.player, duelAttackAttrs),
    )[0].candidate;
    const duel = isHeader
      ? contestedRace(receiver.player, aerialDefender.player, FIXED_MINUTE, random, receiver.zone, { aerial: true })
      : localizedDuel(
          receiver.player, aerialDefender.player,
          ["Strength", "Balance", "Aggression", "Technique"],
          ["Strength", "Balance", "Aggression", "Positioning"],
          FIXED_MINUTE, random, receiver.zone,
        );
    const winner = duel.won ? receiver : aerialDefender;
    const wonCode = isHeader ? "P.AERIAL.WON" : "P.CHEST.WON";
    const lostCode = isHeader ? "P.AERIAL.LOST" : "P.CHEST.LOST";
    // The flight is TRUNCATED here -- the ball never keeps travelling to
    // its original actualEndpoint once someone's genuinely got a body
    // part to it in the air (the reported "ball wanders as a loose white
    // dot" symptom was this exact truncation missing).
    trace.push(
      traceEvent(
        "P.PASS",
        `${playerName(owner.player)} ${passVerbPhrase(passType, "plays")} toward ${playerName(receiver.player)}, contested in the air by ${playerName(aerialDefender.player)}`,
        {
          actor: owner,
          target: receiver,
          defender: aerialDefender,
          movement: "pass",
          outcome: "neutral",
          ballFrom: pointOf(owner),
          // Joint Passer/Runner Candidate Generation v1 (Stage 3) -- the aim
          // point, recorded alongside the ball's real endpoint so the two stay
          // visibly separate facts. Diagnostics and tests read this; nothing in
          // the engine consumes it, and it never influences the flight.
          intendedPoint: { ...intendedPoint },
          ballTo: contact.atPoint,
          contact: { point: pointOf(owner), actor: owner, type: "pass", phase: "start" },
          ownerBefore: owner,
          ownerAfter: null,
          offside,
          duration: contact.atMs,
          metrics: { passFlight: passFlightEvidence },
        },
      ),
    );
    trace.push(
      traceEvent(
        duel.won ? wonCode : lostCode,
        duel.won
          ? `${playerName(receiver.player)} wins the ${isHeader ? "header" : "chest ball"} against ${playerName(aerialDefender.player)}`
          : `${playerName(aerialDefender.player)} wins the ${isHeader ? "header" : "chest ball"}`,
        {
          actor: owner,
          target: receiver,
          defender: aerialDefender,
          movement: isHeader ? "header" : "reception",
          outcome: duel.won ? "success" : "turnover",
          playerMoves: [
            { player: receiver, to: contact.atPoint, action: "attack-ball" },
            { player: aerialDefender, to: contact.atPoint, action: "challenge" },
          ],
          contact: {
            point: contact.atPoint,
            actor: winner,
            type: isHeader ? "header" : "chest",
            phase: "end",
          },
          ownerBefore: null,
          // A lost chest duel is genuinely loose here too (2026-08-26,
          // Passing v3) -- not an instant, guaranteed grant to
          // aerialDefender the way it read before (the SAME "instant
          // teleport to the defender" bug Section D reports for
          // HEAVY/LOSE, just via a different code path); the real race for
          // it happens in resolveLooseBallRaceOutcome() just below.
          ownerAfter: null,
          overlapWithPrevious: true,
          duration: contact.atMs,
        },
      ),
    );
    if (!duel.won) {
      // Gameplay v3.1 -- the duel above is a percentage decided at
      // contact.atMs; without this, everyone except the two contestants
      // (already moving to contact.atPoint via the duel event's own
      // playerMoves, just above) stood frozen for the whole flight and
      // only reshaped 200ms after the outcome was already known. Spans
      // the SAME real contest window every clean reception already gets,
      // excluding the two bodies whose own runs are already authored.
      const aerialOffBallInterleaved = interleaveFlightOffBall(
        interleaveOffBall, groups, pointOf(owner), contact.atPoint, contact.atMs, trace, motionContext,
        [receiver.id, aerialDefender.id],
      );
      if (isHeader) {
        // Same real clearance/control decision a lost cross-header
        // contest already goes through -- never just "the ball vanishes,"
        // the defender genuinely has to do something with it.
        return {
          ...resolveAerialClearanceContinuation(aerialDefender, contact.atPoint, groups, receiver, random, trace),
          offBallInterleaved: aerialOffBallInterleaved,
        };
      }
      // The duel names who won the chest contact, but the spill after that
      // contact is a separate physical ball leg. It must be authored before
      // the recovery race; otherwise the resolver returns the later bounce
      // point while playback's ball is still at the aerial contact point.
      const chestBouncePoint = looseBallBouncePoint(contact.atPoint, pointOf(owner), random);
      // Ball Out of Bounds v1 -- see resolveLooseBallBounce()'s own
      // matching comment.
      const chestPitchExit = classifyPitchExit({
        from: contact.atPoint, to: chestBouncePoint, lastTouchTeam: aerialDefender.team, attackingDirectionByTeam: state.attackingDirection,
      });
      if (chestPitchExit) {
        return {
          ...pushPitchExitRestart(trace, {
            actor: aerialDefender, ballFrom: contact.atPoint, exit: chestPitchExit, movement: "reception",
            contact: { point: contact.atPoint, actor: aerialDefender, type: "control", phase: "start" },
          }),
          offBallInterleaved: aerialOffBallInterleaved,
        };
      }
      const chestBounceDurationMs = looseBallFlightMs(yardDistance(contact.atPoint, chestBouncePoint));
      const chestRaceContact = looseBallRaceContact(
        receiver, contact.atPoint, chestBouncePoint, chestBounceDurationMs, groups,
        { motionContext, trace },
      );
      const chestSpillPoint = chestRaceContact?.atPoint ?? chestBouncePoint;
      const chestSpillDurationMs = chestRaceContact?.atMs ?? chestBounceDurationMs;
      trace.push(traceEvent(
        "P.CHEST.SPILL",
        `${playerName(aerialDefender.player)} cannot bring the chest ball under control`,
        {
          actor: aerialDefender,
          movement: "reception",
          outcome: "loose",
          ballFrom: contact.atPoint,
          ballTo: chestSpillPoint,
          contact: { point: contact.atPoint, actor: aerialDefender, type: "control", phase: "start" },
          ownerBefore: null,
          ownerAfter: null,
          duration: chestSpillDurationMs,
        },
      ));
      const chestBounceOffBallInterleaved = interleaveFlightOffBall(
        interleaveOffBall,
        groups,
        contact.atPoint,
        chestSpillPoint,
        chestSpillDurationMs,
        trace,
        motionContext,
        // Both aerial contestants already have contact-pinned movement on
        // P.CHEST.LOST. Do not give either a second generic trajectory from
        // their stale kick-time roster coordinate during this short spill;
        // the eventual recovery winner receives its own BALL.RECOVERY.RUN.
        [receiver.id, aerialDefender.id, chestRaceContact?.candidate?.id].filter(Boolean),
      );
      return {
        ...resolveLooseBallRaceOutcome(
          receiver, aerialDefender, chestBouncePoint, chestBounceDurationMs, chestRaceContact, trace, motionContext,
        ),
        offBallInterleaved: aerialOffBallInterleaved || chestBounceOffBallInterleaved,
      };
    }
    if (isHeader && isCrossTargetZone(contact.atPoint, state.attackingDirection[owner.team])) {
      // A header win close enough to goal gets the SAME real shot/save
      // chain a crossed header always could -- never a smaller, second-
      // class version of the same play just because it arrived via an
      // ordinary lofted pass instead of a cross.
      return resolveHeaderAtGoal(receiver, groups.keeper, contact.atPoint, groups, random, trace, { aerialDefender });
    }
    // Chest/thigh win, or a header win too far out for a shot -- genuine
    // control, not an automatic goal chance. Falls through to the SAME
    // resolveReceive() flow every other contested reception already uses
    // below, just starting from THIS contest's own real point/time, with
    // a real extra strain (chest/head control off a contested ball is not
    // a clean ground take).
    contactPoint = contact.atPoint;
    contactDurationMs = contact.atMs;
    contestingDefenderId = aerialDefender.id;
    contestStrainBonus = isHeader ? 3 : 5;
    // `receiver` here is this block's own shadowed local (the best
    // attacking contestant, see this branch's own header comment) -- NOT
    // necessarily the passer's original intention.
    actualReceiver = { ...receiver, ...contact.atPoint };
    groups = { ...groups,
      teammates: groups.teammates.map(entry => entry.id === receiver.id ? actualReceiver : entry),
      opponents: groups.opponents.map(entry => entry.id === aerialDefender.id ? { ...entry, ...contact.atPoint } : entry),
    };
  } else if (contact.candidate.team !== owner.team) {
    // An opponent physically reached the ball's own independent path
    // before any teammate could -- the SAME two-layer principle already
    // established for lane interceptions: physics decided WHO can contest
    // it (the live tick above), localizedDuel() decides whether that
    // physical win becomes a clean interception or the ball still somehow
    // gets through (to the originally aimed-at receiver, verified against
    // the SAME live-tick physics just below -- re-racing every OTHER
    // teammate after the fact is real scope creep this slice doesn't need;
    // the interceptor's own physical eligibility already means nobody else
    // beat them to it earlier in the flight).
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
        `${playerName(owner.player)} ${passVerbPhrase(passType, "attempts")} to ${playerName(receiver.player)}, contested by ${playerName(interceptor.player)} (${Math.round(duel.probability * 100)}%)`,
        {
          actor: owner,
          target: receiver,
          defender: interceptor,
          movement: "pass",
          outcome: "neutral",
          ballFrom: pointOf(owner),
          // Joint Passer/Runner Candidate Generation v1 (Stage 3) -- the aim
          // point, recorded alongside the ball's real endpoint so the two stay
          // visibly separate facts. Diagnostics and tests read this; nothing in
          // the engine consumes it, and it never influences the flight.
          intendedPoint: { ...intendedPoint },
          ballTo: duel.won ? actualEndpoint : contact.atPoint,
          contact: { point: pointOf(owner), actor: owner, type: "pass", phase: "start" },
          ownerBefore: owner,
          ownerAfter: null,
          offside,
          duration: duel.won ? passDuration : contact.atMs,
          metrics: { passFlight: passFlightEvidence },
        },
      ),
    );
    if (!duel.won) {
      // The interceptor's own real run to the contest point, timed and
      // physically limited exactly like every other continuous move in
      // this model -- never teleported to meet a ball that already
      // decided, independently, that it would be there.
      const interceptionMotion = advanceMotion({ from: pointOf(interceptor), intentionTarget: contact.atPoint,
        player: interceptor.player, elapsedMs: contact.atMs, reactionDelayMs: contact.reactionDelayMs ?? 0,
        intention: "intercept", paceToArrival: false });
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
                to: interceptionMotion.position,
                action: "intercept",
                trajectory: interceptionMotion.trajectory,
              },
            ],
            contact: {
              point: contact.atPoint,
              bodyPoint: interceptionMotion.position,
              reachAllowanceYards: contact.reachAllowanceYards ?? 1.5,
              actor: interceptor,
              type: "interception",
              phase: "end",
            },
            ownerBefore: null,
            ownerAfter: interceptor,
          },
        ),
      );
      // Gameplay v3.1 -- the interceptor's own run is already authored
      // above (playerMoves); everyone else keeps pursuing the job they
      // already had for the SAME real window the interception happened
      // in, instead of standing frozen through the whole flight and
      // then twitching through a 200ms reshape afterward.
      const offBallInterleaved = interleaveFlightOffBall(
        interleaveOffBall, groups, pointOf(owner), contact.atPoint, contact.atMs, trace, motionContext, [interceptor.id],
      );
      // The foot can meet the ball away from the body's centre. Bringing it
      // under the body is a ball touch, never a player teleport into contact.
      trace.push(traceEvent("P.INTERCEPT.CONTROL", `${playerName(interceptor.player)} brings it under control`, {
        actor: interceptor, movement: "touch", outcome: "success", duration: 120,
        ballFrom: contact.atPoint, ballTo: interceptionMotion.position,
        ownerBefore: interceptor, ownerAfter: interceptor,
      }));
      return {
        outcome: "TURNOVER",
        code: "P.PASS.LOST",
        resolved: true,
        terminal: true,
        possession: "turnover",
        nextOwnerId: interceptor.id,
        ballEnd: interceptionMotion.position,
        restart: null,
        reason: "pass-intercepted",
        offBallInterleaved,
      };
    }
    // Off-Ball Motion v3 (2026-08-26) -- a real reported bug (traced to a
    // Timeline Playback regression): a beaten interceptor let the ball
    // through to actualEndpoint UNCONDITIONALLY -- the intended receiver
    // was selected before the flight was even built and never re-verified
    // against the real, error-affected landing point. Lead Into Space's
    // own longer leads made the gap between "where the receiver was
    // standing" and "where the ball actually lands" wide enough to
    // regularly exceed what they can physically cover in passDuration --
    // a straightforward earliestReachableContact()-style check here
    // (reusing the SAME contactArrivalTiming() the `!contact` branch above
    // already relies on) closes it the same honest way: a genuinely
    // unreachable delivery runs loose, never an automatic clean reception.
    const interceptedDeliveryArrival = contactArrivalTiming({
      player: receiver.player, from: pointOf(receiver), to: actualEndpoint,
      flightStartMs: 0, contactTimeMs: passDuration,
    });
    if (!interceptedDeliveryArrival.reachable) {
      return pushLooseDeliveryChase(receiver, actualEndpoint, passDuration, trace, groups, motionContext, interleaveOffBall, pointOf(owner));
    }
    contactPoint = actualEndpoint;
    contactDurationMs = passDuration;
    contestingDefenderId = interceptor.id;
    actualReceiver = receiver;
  } else {
    // A teammate genuinely met it -- the one the passer was aiming for
    // (the common case), or a different teammate entirely: an overhit
    // ball taken by someone else, a knockdown, a poach. That's success of
    // the live-tick model, not a bug -- the flight was never booked to a
    // specific owner, so whoever's body actually gets there first, wins
    // it. `actualReceiver` (not `receiver`) is who resolveReceive() etc.
    // below actually reasons about from here on.
    actualReceiver = contact.candidate;
    const metByIntendedReceiver = actualReceiver.id === receiver.id;
    const aimedIntoSpace = yardDistance(intendedPoint, receiver) >= 1;
    trace.push(
      traceEvent(
        "P.PASS",
        metByIntendedReceiver
          ? `${playerName(owner.player)} ${passVerbPhrase(passType, "plays")} ${aimedIntoSpace ? "into the space ahead of" : "to"} ${playerName(receiver.player)}`
          : `${playerName(owner.player)} ${passVerbPhrase(passType, "plays")} toward ${playerName(receiver.player)}, but ${playerName(actualReceiver.player)} gets to it`,
        {
          actor: owner,
          target: receiver,
          movement: "pass",
          outcome: "success",
          ballFrom: pointOf(owner),
          // Joint Passer/Runner Candidate Generation v1 (Stage 3) -- the aim
          // point, recorded alongside the ball's real endpoint so the two stay
          // visibly separate facts. Diagnostics and tests read this; nothing in
          // the engine consumes it, and it never influences the flight.
          intendedPoint: { ...intendedPoint },
          ballTo: contact.atPoint,
          contact: { point: pointOf(owner), actor: owner, type: "pass", phase: "start" },
          ownerBefore: owner,
          ownerAfter: null,
          offside,
          duration: contact.atMs,
          metrics: { passFlight: passFlightEvidence },
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
          actualReceiver.id,
          receiverPressureDefender?.id,
          contestingDefenderId,
        ].filter(Boolean),
        passerId: owner.role === "keeper" ? null : owner.id,
        passDestination: contactPoint,
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
        `${playerName(actualReceiver.player)} controls it cleanly`,
        {
          actor: actualReceiver,
          movement: "reception",
          outcome: "success",
          playerMoves: [
            {
              player: actualReceiver,
              from: pointOf(actualReceiver),
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
            actor: actualReceiver,
            type: "control",
            phase: "start",
          },
          ownerBefore: null,
          ownerAfter: actualReceiver,
          duration: 160,
        },
      ),
    );
    // Gameplay v3.2 -- "freeze on arrival." The shared flight-off-ball
    // call above (and its own overlapping DEF.PRESS.RECEIVER, if any) is
    // correctly bound to the flight's own window, ending exactly at
    // contactPoint/contactDurationMs -- it cannot reach forward into THIS
    // event's own 160ms (a genuinely new primary interval, since
    // matchLabPlayback.js deliberately excludes movement:"reception" from
    // its stationary-contact overlap shortcut -- a receiver's own control
    // beat is a real, independently-timed action, not a shared arrival).
    // Without this, everyone but the receiver holds their LAST rendered
    // pose for 160ms, then the next action's own off-ball call restarts
    // them -- the reported "every clip ends, film plants the world" bug.
    // A second, short call (same job targets, not a replan -- motionContext
    // already carries each reactor's own real velocity into it, so this
    // continues their run rather than restarting it) closes that gap.
    // chaseIntention: false -- same reason POST_ACTION_CONVERGENCE_MS
    // uses it: 160ms is nowhere near enough real time to chase a far,
    // uncapped tactical target without an impossible burst.
    if (interleaveOffBall) {
      reactOffBallContinuous(groups, contactPoint, contactPoint, 160, trace, {
        motionContext, excludedIds: [actualReceiver.id], overlapWithPrevious: true, chaseIntention: false,
      });
    }
    return {
      outcome: "CLEAN",
      code: "P.RECEIVE.CLEAN",
      resolved: true,
      terminal: false,
      possession: "retained",
      nextOwnerId: actualReceiver.id,
      ballEnd: contactPoint,
      restart: null,
      reason: "pass-reception-clean",
      // Off-Ball Motion v3 -- see resolveDribble()'s own matching field;
      // the shared reactOffBallContinuous() call above already ran.
      offBallInterleaved: interleaveOffBall,
    };
  }

  // contestStrainBonus (2026-08-26, Passing v3) -- folded in via the
  // pressure channel rather than a new resolveReceive() parameter (the
  // spec's own "do not add a new engine resolver" boundary): chest/head
  // control off a genuine aerial contest is measurably harder than a
  // ground take under the same nominal pressure, converted at strain's
  // own pressure*14 weight (matchEngineCore.js) so a bonus of 3 (header)
  // or 5 (chest) lands as the intended real strain points, not a second,
  // differently-scaled term.
  const pressure = computePressure(pressingOpponent.player, contactPoint.zone, 0) + contestStrainBonus / 14;
  const received = resolveReceive(
    actualReceiver.player,
    pressingOpponent.player,
    passQuality,
    pressure,
    false,
    actualReceiver.zone,
    FIXED_MINUTE,
    random,
  );
  // received.status is resolveReceive()'s own real vocabulary --
  // "advance"/"hold"/"turnover" (matchEngineCore.js:1141-1231, read
  // directly, not assumed).
  const receptionLost = received.status === "turnover";
  // Bounce On Failed Control v1 -- HEAVY (unrecovered) and LOSE spill a
  // real, short distance and go through a genuine live race for who
  // actually gets there (see resolveLooseBallBounce()'s own header
  // comment); an ordinary KNOCK_FORWARD-lost contested race already
  // decided things outright at contactPoint and keeps its existing shape
  // below unchanged.
  if (receptionLost && RECEPTION_BOUNCE_CODES.has(received.context.code)) {
    // Gameplay v3.1 -- the flight up to this reception is already covered
    // by the shared reactOffBallContinuous() call above; resolveLooseBallBounce()
    // now separately interleaves off-ball for its OWN bounce/race window
    // (the gap this used to have -- see its own header comment) and
    // reports whether it did on the return, so nothing needs overriding
    // here.
    return resolveLooseBallBounce(
      actualReceiver, pressingOpponent, contactPoint, pointOf(owner), groups,
      received.context.code, received.status, random, trace, motionContext, interleaveOffBall,
    );
  }
  // A KNOCK_FORWARD-advanced reception earns a real forward zone
  // (received.nextZone, resolveReceive's own contested-race result) --
  // genuine progression data for that reception, not the same point twice.
  const advancedReception =
    !receptionLost && received.nextZone !== actualReceiver.zone;
  // Real reported bug (2026-08-31): a lost KNOCK_FORWARD is a genuine
  // contested race for a ball the receiver's own touch just pushed
  // forward (resolveReceive()'s own contestedRace() call, matchEngineCore.js)
  // -- but its nextZone for a LOST race is MIRRORED_ZONE[zone] (a tactical
  // "whose half is it now" label for the NEXT decision, never a real
  // point), so this used to fall back to pointOf(pressingOpponent) --
  // wherever that defender's roster entry happens to be standing on the
  // WHOLE pitch, often nowhere near the reception point at all. Rendered
  // as the ball instantly deflecting across open turf with nobody
  // actually there. Same real, short "how far can one touch travel" cap
  // the WON branch below already uses (KNOCK_FORWARD_MAX_YARDS) -- the
  // defender wins the race TO that near point, not to wherever they
  // started, and is authored a real move there instead of teleporting.
  const knockForwardContestPoint = receptionLost
    ? (() => {
        // approachPoint() returns a bare {x,y}, never a zone -- see the
        // WON branch's own receptionEnd comment just below for the exact
        // matching continuity bug this same omission caused there.
        const raw = approachPoint(
          contactPoint,
          pointAheadYards(contactPoint, state.attackingDirection[actualReceiver.team], KNOCK_FORWARD_MAX_YARDS * 2),
          KNOCK_FORWARD_MAX_YARDS,
        );
        return { ...raw, zone: zoneFromPercent(raw.x, raw.y) };
      })()
    : null;
  const lostRaceMove = receptionLost
    ? realMoverTrajectory(pressingOpponent, knockForwardContestPoint, { floorMs: 280, action: "interception" })
    : null;
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
      `${playerName(actualReceiver.player)}: ${received.status}`,
      {
        actor: actualReceiver,
        defender: pressingOpponent,
        movement: "reception",
        outcome: receptionLost ? "turnover" : "success",
        playerMoves: receptionLost
          ? lostRaceMove.playerMoves
          : [
              {
                player: actualReceiver,
                from: pointOf(actualReceiver),
                to: contactPoint,
                action: "receive-pass",
                reactionDelayMs: contact.reactionDelayMs,
                reachAllowanceYards: contact.reachAllowanceYards,
              },
            ],
        ballFrom: contactPoint,
        ballTo: receptionLost
          ? knockForwardContestPoint
          : contactPoint,
        contact: {
          point: receptionLost
            ? knockForwardContestPoint
            : contactPoint,
          actor: receptionLost ? pressingOpponent : actualReceiver,
          type: receptionLost ? "interception" : "control",
          phase: receptionLost ? "end" : "start",
        },
        ownerBefore: null,
        ownerAfter: receptionLost ? pressingOpponent : actualReceiver,
        duration: receptionLost ? lostRaceMove.duration : 160,
      },
    ),
  );
  // Gameplay v3.2 -- see P.RECEIVE.CLEAN's own matching comment above for
  // the full "freeze on arrival" explanation; this is the SAME gap on
  // this event's own (contested) shape. Covers whichever real duration
  // this event just used, receptionLost included -- a lost reception
  // does not pause the other 21 jobs either.
  if (interleaveOffBall) {
    reactOffBallContinuous(
      groups, contactPoint, receptionLost ? pointOf(pressingOpponent) : contactPoint,
      receptionLost ? 280 : 160, trace,
      { motionContext, excludedIds: [actualReceiver.id, pressingOpponent?.id].filter(Boolean), overlapWithPrevious: true, chaseIntention: false },
    );
  }
  let receptionEnd = contactPoint;
  if (advancedReception) {
    // Gameplay v3.2 -- capped to a real knock-on distance (see
    // KNOCK_FORWARD_MAX_YARDS's own comment); direction toward the real
    // next zone is preserved, only how far in one touch is bounded.
    const approachedReceptionEnd = approachPoint(contactPoint, zoneCenterPoint(received.nextZone), KNOCK_FORWARD_MAX_YARDS);
    // A real reported bug (found via Progression Contest v1's own full-
    // trace continuity search): approachPoint() returns a bare {x,y},
    // never a zone -- this event's own ballTo (and playerMoves `to`)
    // silently carried no zone at all, while the NEXT action's own
    // ballFrom is always built WITH one (pointOf()/zoneFromPercent() on
    // the committed roster entry). x/y matched exactly; zone alone
    // (undefined vs a real number) tripped the "next event starts
    // exactly where the previous one ended" continuity check.
    receptionEnd = { ...approachedReceptionEnd, zone: zoneFromPercent(approachedReceptionEnd.x, approachedReceptionEnd.y) };
    // A real duration, not the implicit zero a missing one defaults to
    // (2026-08-25 fix -- a real browser round reported a receiver visibly
    // TELEPORTING on this exact event: ZONE_TRANSITION_MATRIX's own
    // "bypass" case (matchEngineCore.js) lets a knock-forward reception
    // skip an entire zone row, up to ~75% of the pitch length in one
    // touch, and with zero duration/no trajectory that whole distance
    // rendered as an instant snap instead of a real, timeToReach()-paced
    // sprint onto it). Floored at MOVEMENT_DURATIONS.reception so even a
    // short, ordinary knock-forward still reads as a real touch, not an
    // instant one either.
    const advanceDistanceYards = yardDistance(contactPoint, receptionEnd);
    const advanceDurationMs = Math.max(
      MOVEMENT_DURATIONS.reception,
      Math.round(
        CONTACT_REACTION_DELAY_MS
          + timeToReach(actualReceiver.player, advanceDistanceYards) * 1000,
      ),
    );
    trace.push(
      traceEvent(
        "P.RECEIVE.ADVANCE",
        `${playerName(actualReceiver.player)} knocks it forward`,
        {
          actor: actualReceiver,
          movement: "reception",
          outcome: "success",
          duration: advanceDurationMs,
          playerMoves: [
            {
              player: actualReceiver,
              from: contactPoint,
              to: receptionEnd,
              action: "receive-and-advance",
              trajectory: sampleContinuousTrajectory({
                from: contactPoint,
                to: receptionEnd,
                player: actualReceiver.player,
                totalMs: advanceDurationMs,
                reactionDelayMs: CONTACT_REACTION_DELAY_MS,
                sampleCount: Math.max(10, Math.min(24, Math.ceil(advanceDurationMs / 160))),
              }),
            },
          ],
          ballFrom: contactPoint,
          ballTo: receptionEnd,
          ownerBefore: actualReceiver,
          ownerAfter: actualReceiver,
        },
      ),
    );
    // Gameplay v3.2 -- same gap, the knock-forward's own beat: this used
    // to be its own new primary interval with only actualReceiver moving,
    // the same clock-ownership hole Slice B of Gameplay v3.1 fixed for
    // P.CARRY.TOUCH. A second short off-ball call (chaseIntention:false,
    // same reasoning as the reception beat above) closes it.
    if (interleaveOffBall) {
      reactOffBallContinuous(groups, contactPoint, receptionEnd, advanceDurationMs, trace, {
        motionContext, excludedIds: [actualReceiver.id], overlapWithPrevious: true, chaseIntention: false,
      });
    }
  }
  return {
    outcome: received.status.toUpperCase(),
    code: received.context.code,
    resolved: true,
    terminal: receptionLost,
    possession: receptionLost ? "turnover" : "retained",
    nextOwnerId: receptionLost ? pressingOpponent.id : actualReceiver.id,
    ballEnd: receptionLost ? knockForwardContestPoint : receptionEnd,
    restart: null,
    reason: receptionLost ? "pass-reception-lost" : "pass-reception",
    // Off-Ball Motion v3 -- see resolveDribble()'s own matching field.
    offBallInterleaved: interleaveOffBall,
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
function resolveThroughBallInternal(
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
  // Joint Passer/Runner Candidate Generation v1 (Stage 3, 2026-09-05) --
  // this used to fall back to `pointOf(receiver)` when no planned target
  // arrived, which meant a "through ball" could quietly be delivered to the
  // teammate's current coordinate: the exact thing that makes it NOT a
  // through ball. There is no such fallback now. A through ball requires a
  // real runner and a real meeting point, and the Free Play path always
  // supplies one (generateFreePlayCandidates() only offers this candidate
  // from a joint candidate that already has an intended point).
  //
  // A caller with no meeting point is not describing a through ball at all;
  // it is describing an ordinary pass to feet, so it is resolved as exactly
  // that -- explicitly, and by the resolver that owns that behaviour, not by
  // this one pretending to be it.
  const targetPoint = availability?.plannedMoveTo ?? null;
  if (!targetPoint) {
    return resolvePass(groups, availability, random, trace, interleaveOffBall, motionContext);
  }

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

  // Kick As Projectile v1 (2026-08-27) -- see matchPassFlight.js's own
  // simulateFlightUntilContact() header comment. A through ball already
  // aimed at SPACE, not feet (targetPoint, unchanged above) -- what
  // changes here is HOW contact is resolved: a real flight object (this
  // resolver never built one before -- `landingPoint` was a static
  // accuracy-scattered point with no timeline at all) raced live, tick by
  // tick, the SAME shared helper resolvePass() uses. The old frozen,
  // kick-time-only lane check (resolveCross()'s own interceptor lookup,
  // still used there -- see its own call site) is retired for this
  // resolver -- physics now decides who actually gets there, exactly the
  // Oliveira/Guerrero class of bug this slice exists to answer with
  // geometry instead of a later marking patch.
  const { accuracyErrorYards } = resolveThroughBallAccuracy(
    owner.player,
    {
      distanceYards: yardDistance(owner, targetPoint),
      pressureFactor: passerPressure,
    },
    random,
  );
  const throughDistanceYards = yardDistance(owner, targetPoint);
  const throughPassType = availability?.forcedPassType || availability?.plannedPassType || selectPassType({
    passer: owner.player,
    from: pointOf(owner),
    to: targetPoint,
    opponents: groups.opponents,
    deliveryIntent: "run-in-behind",
  });
  const landingXY = deliveryLandingPoint(
    targetPoint,
    accuracyErrorYards,
    random,
  );
  const throughOrigin = pointOf(owner);
  const throughDuration = passFlightDurationMsForType(throughDistanceYards, throughPassType);
  // Ball Out of Bounds v1 -- see resolvePass()'s own matching comment.
  const throughPitchExit = classifyPitchExit({
    from: throughOrigin,
    to: landingXY,
    lastTouchTeam: owner.team,
    attackingDirectionByTeam: state.attackingDirection,
  });
  if (throughPitchExit) {
    const fullDistanceYards = yardDistance(throughOrigin, landingXY);
    const exitDistanceYards = yardDistance(throughOrigin, throughPitchExit.ballEnd);
    const exitDurationMs = fullDistanceYards > 0 ? throughDuration * (exitDistanceYards / fullDistanceYards) : 0;
    return pushPitchExitRestart(trace, {
      actor: owner, ballFrom: throughOrigin, exit: throughPitchExit, movement: "pass", duration: exitDurationMs,
    });
  }
  const landingPoint = {
    x: landingXY.x,
    y: landingXY.y,
    zone: zoneFromPercent(landingXY.x, landingXY.y),
  };
  const throughFlight = buildPassFlight({
    owner,
    receiver,
    from: pointOf(owner),
    intendedPoint: targetPoint,
    actualEndpoint: landingPoint,
    passType: throughPassType,
    durationMs: throughDuration,
  });
  const jobTargetFor = buildLiveJobTargets(groups, pointOf(owner), motionContext, landingPoint, owner.role === "keeper" ? null : owner.id, throughFlight);
  const contact = simulateFlightUntilContact({
    flight: throughFlight,
    players: [...groups.teammates, ...groups.opponents, ...(groups.keeper ? [groups.keeper] : [])],
    jobTargetFor,
  });
  registerKeeperFlight(groups, throughFlight, contact, jobTargetFor);
  if (contact.candidate && contact.jobMotions?.[contact.candidate.id] && groups.keeperFlight)
    return resolveSweeperContact(groups, throughFlight, contact, trace, motionContext, interleaveOffBall, "P.THROUGH");

  if (!contact.candidate) {
    trace.push(
      traceEvent(
        "P.THROUGH",
        `${playerName(owner.player)} slides a through ball into the space for ${playerName(receiver.player)}, but nobody gets there`,
        {
          actor: owner,
          target: receiver,
          movement: "pass",
          outcome: "neutral",
          ballFrom: pointOf(owner),
          // Joint Passer/Runner Candidate Generation v1 (Stage 3) -- the aim
          // point, recorded alongside the ball's real endpoint so the two stay
          // visibly separate facts. Diagnostics and tests read this; nothing in
          // the engine consumes it, and it never influences the flight.
          intendedPoint: { ...targetPoint },
          ballTo: landingPoint,
          contact: { point: pointOf(owner), actor: owner, type: "pass", phase: "start" },
          ownerBefore: owner,
          ownerAfter: null,
          offside,
          duration: throughDuration,
        },
      ),
    );
    return pushLooseDeliveryChase(receiver, landingPoint, throughDuration, trace, groups, motionContext, interleaveOffBall, pointOf(owner));
  }

  const actualReceiver = contact.candidate;
  let finalReceiver;
  let finalPoint;
  let finalDuration;
  if (actualReceiver.team !== owner.team) {
    // An opponent physically reached the ball's own independent path
    // first -- the SAME two-layer principle resolvePass() already
    // established for its own lane-interception branch: physics decided
    // WHO can contest it (the live tick above), localizedDuel() decides
    // whether that physical win becomes a clean interception or the ball
    // still somehow gets through to its real destination.
    const interceptor = actualReceiver;
    const duel = localizedDuel(
      owner.player,
      interceptor.player,
      ["Passing", "Vision", "Technique", "Decisions"],
      ["Positioning", "Anticipation", "Tackling", "Decisions"],
      FIXED_MINUTE,
      random,
      owner.zone,
    );
    trace.push(
      traceEvent(
        "P.THROUGH",
        `${playerName(owner.player)} slides a through ball for ${playerName(receiver.player)}, cut out by ${playerName(interceptor.player)} (${Math.round(duel.probability * 100)}%)`,
        {
          actor: owner,
          target: receiver,
          defender: interceptor,
          movement: "pass",
          outcome: "neutral",
          ballFrom: pointOf(owner),
          // Joint Passer/Runner Candidate Generation v1 (Stage 3) -- the aim
          // point, recorded alongside the ball's real endpoint so the two stay
          // visibly separate facts. Diagnostics and tests read this; nothing in
          // the engine consumes it, and it never influences the flight.
          intendedPoint: { ...targetPoint },
          ballTo: duel.won ? landingPoint : contact.atPoint,
          contact: { point: pointOf(owner), actor: owner, type: "pass", phase: "start" },
          ownerBefore: owner,
          ownerAfter: null,
          offside,
          duration: duel.won ? throughDuration : contact.atMs,
        },
      ),
    );
    if (!duel.won) {
      trace.push(
        traceEvent(
          "P.THROUGH.LOST",
          `${playerName(interceptor.player)} reads it and cuts the through ball out`,
          {
            actor: owner,
            defender: interceptor,
            movement: "interception",
            outcome: "turnover",
            contact: { point: contact.atPoint, actor: interceptor, type: "interception", phase: "start" },
            ownerBefore: null,
            ownerAfter: interceptor,
          },
        ),
      );
      // Gameplay v3.1 -- same class of gap as resolvePass()'s own
      // P.PASS.LOST branch: the interceptor's own run is already
      // authored above (playerMoves via the duel/contact fields), but
      // everyone else used to stand frozen through the whole flight and
      // only reshape 200ms after the turnover was already decided.
      const throughOffBallInterleaved = interleaveFlightOffBall(
        interleaveOffBall, groups, pointOf(owner), contact.atPoint, contact.atMs, trace, motionContext,
        [interceptor.id],
      );
      return {
        outcome: "TURNOVER",
        code: "P.THROUGH.LOST",
        resolved: true,
        terminal: true,
        possession: "turnover",
        nextOwnerId: interceptor.id,
        ballEnd: contact.atPoint,
        restart: null,
        reason: "through-ball-intercepted",
        offBallInterleaved: throughOffBallInterleaved,
      };
    }
    // Beaten interceptor: the ball still gets through, to its real
    // destination, already described by the "P.THROUGH" event just
    // pushed above -- the shared tail below must NOT push a second one.
    // `actualReceiver` corrected back to the originally aimed-at runner
    // (the live tick's own winner here was the interceptor, not a
    // teammate; there is no OTHER teammate physically vetted as reaching
    // it, so this keeps the ORIGINAL, already-tested "beaten interceptor"
    // contract resolvePass() itself uses -- see its own matching comment).
    finalReceiver = receiver;
    finalPoint = landingPoint;
    finalDuration = throughDuration;
    // The interceptor lost the duel, but accuracy may still have carried
    // the ball several metres away from the intended runner. Candidate
    // generation vetted the intended meeting point, not this scattered
    // landing point, so re-check the receiver's physical reach before the
    // shared tail awards control. A beaten defender does not teleport the
    // attacker onto a ball neither player can reach.
    const receiverArrival = contactArrivalTiming({
      player: receiver.player,
      from: pointOf(receiver),
      to: landingPoint,
      flightStartMs: 0,
      contactTimeMs: throughDuration,
      reactionDelayMs: reactionDelayMsFor(receiver.player, { isIntendedReceiver: true }),
      reachAllowanceYards: 1.5,
    });
    if (!receiverArrival.reachable) {
      return pushLooseDeliveryChase(
        receiver,
        landingPoint,
        throughDuration,
        trace,
        groups,
        motionContext,
        interleaveOffBall,
        pointOf(owner),
      );
    }
  } else {
    finalReceiver = actualReceiver;
    finalPoint = contact.atPoint;
    finalDuration = contact.atMs;
    trace.push(
      traceEvent(
        "P.THROUGH",
        finalReceiver.id === receiver.id
          ? `${playerName(owner.player)} plays a through ball into the space for ${playerName(receiver.player)}`
          : `${playerName(owner.player)} slides a through ball for ${playerName(receiver.player)}, but ${playerName(finalReceiver.player)} gets there`,
        {
          actor: owner,
          target: receiver,
          movement: "pass",
          outcome: "success",
          ballFrom: pointOf(owner),
          // Joint Passer/Runner Candidate Generation v1 (Stage 3) -- the aim
          // point, recorded alongside the ball's real endpoint so the two stay
          // visibly separate facts. Diagnostics and tests read this; nothing in
          // the engine consumes it, and it never influences the flight.
          intendedPoint: { ...targetPoint },
          ballTo: finalPoint,
          contact: { point: pointOf(owner), actor: owner, type: "pass", phase: "start" },
          ownerBefore: owner,
          ownerAfter: null,
          offside,
          duration: finalDuration,
        },
      ),
    );
  }

  const receiverMotion = advanceMotion({from:pointOf(finalReceiver),intentionTarget:finalPoint,
    player:finalReceiver.player,elapsedMs:finalDuration,
    reactionDelayMs:reactionDelayMsFor(finalReceiver.player,{isIntendedReceiver:true}),
    intention:"receive-pass",paceToArrival:false});
  trace.push(traceEvent("ATT.RECEIVER.RUN", `${playerName(finalReceiver.player)} chases the through ball`, {
    actor:finalReceiver,movement:"reposition",duration:finalDuration,overlapWithPrevious:true,
    playerMoves:[{player:finalReceiver,from:pointOf(finalReceiver),to:receiverMotion.position,
      trajectory:receiverMotion.trajectory,action:"chase",reactionDelayMs:receiverMotion.reactionDelayMs}],
  }));
  // Off-Ball Motion v3 -- ONE continuous off-ball reaction spanning the
  // REAL truncated flight (finalDuration -- the beaten-interceptor branch
  // means the ball actually traveled the FULL throughDuration to
  // landingPoint, not just as far as contact.atMs/atPoint, so this must
  // track finalPoint/finalDuration, not the live tick's own raw contact
  // fields), the same shared mechanism resolvePass() uses; never a
  // second, flat post-action nudge on top (offBallInterleaved below is
  // what tells runConstructedPossession() to skip it).
  if (interleaveOffBall) {
    reactOffBallContinuous(
      groups,
      pointOf(owner),
      finalPoint,
      finalDuration,
      trace,
      { motionContext, excludedIds: [finalReceiver.id], passerId: owner.role === "keeper" ? null : owner.id, passDestination: finalPoint },
    );
  }

  trace.push(
    traceEvent(
      "P.THROUGH.RECEIVE",
      `${playerName(finalReceiver.player)} runs onto it, clean through`,
      {
        actor: finalReceiver,
        movement: "reception",
        outcome: "success",
        ballFrom: finalPoint,
        ballTo: receiverMotion.position,
        contact: {
          point: finalPoint,
          bodyPoint:receiverMotion.position,reachAllowanceYards:1.5,
          actor: finalReceiver,
          type: "control",
          phase: "start",
        },
        ownerBefore: null,
        ownerAfter: finalReceiver,
        duration: 160,
      },
    ),
  );
  // Gameplay v3.2 -- same "freeze on arrival" gap as resolvePass()'s own
  // P.RECEIVE.CLEAN (see its comment there for the full explanation): the
  // flight-off-ball call above ends exactly at finalDuration/finalPoint,
  // and this reception's own 160ms is a genuinely new primary interval
  // (movement:"reception" is excluded from playback's stationary-contact
  // overlap shortcut) that only finalReceiver has a move for.
  if (interleaveOffBall) {
    reactOffBallContinuous(groups, finalPoint, finalPoint, 160, trace, {
      motionContext, excludedIds: [finalReceiver.id], overlapWithPrevious: true, chaseIntention: false,
    });
  }
  return {
    outcome: "CLEAN",
    code: "P.THROUGH.RECEIVE",
    resolved: true,
    terminal: false,
    possession: "retained",
    nextOwnerId: finalReceiver.id,
    ballEnd: receiverMotion.position,
    restart: null,
    reason: "through-ball-received",
    offBallInterleaved: interleaveOffBall,
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
    // Ball Out of Bounds v1 (2026-09-01) -- clearanceDestinationPoint() is
    // now genuinely unclamped, so this deliberate "put it out for a
    // corner" choice is checked against REAL geometry instead of assumed:
    // classifyPitchExit() is computed FIRST, nothing pushed to `trace`
    // until it genuinely fires. In the rare case a shallow "behind"
    // clearance doesn't actually reach the byline, it honestly stays in
    // play as a loose ball rather than fabricating a corner.
    const behindExit = classifyPitchExit({
      from: contactPoint,
      to: decision.moveTo,
      lastTouchTeam: defender.team,
      attackingDirectionByTeam: state.attackingDirection,
    });
    if (behindExit) {
      return pushPitchExitRestart(trace, {
        actor: defender, ballFrom: contactPoint, exit: behindExit, movement: "clearance",
        contact: { point: contactPoint, actor: defender, type: "clearance", phase: "start" },
      });
    }
    const endpoint = {
      x: decision.moveTo.x,
      y: decision.moveTo.y,
      zone: zoneFromPercent(decision.moveTo.x, decision.moveTo.y),
    };
    trace.push(
      traceEvent(
        outcome.code,
        `${playerName(defender.player)} clears it behind`,
        {
          actor: defender,
          movement: "clearance",
          outcome: "neutral",
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
      outcome: "LOOSE",
      code: outcome.code,
      resolved: true,
      terminal: true,
      possession: "loose",
      nextOwnerId: null,
      ballEnd: endpoint,
      restart: null,
      reason: "clearance-behind-short",
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
    // second interpolation formula.
    const rawTarget = outcome.clean
      ? decision.moveTo
      : nudgeToward(contactPoint, decision.moveTo, 0.45, 100);
    // Ball Out of Bounds v1 -- see this function's own "clear-behind"
    // comment above for the full reasoning. Whether this genuinely goes
    // out (and for which restart -- almost always a throw-in for a
    // touchline clearance, but a wildly overhit "long" ball down the
    // middle can just as legitimately sail out for a goal-kick) is now
    // decided by real geometry against rawTarget, never by which
    // candidate type the defender happened to choose.
    const clearanceExit = classifyPitchExit({
      from: contactPoint,
      to: rawTarget,
      lastTouchTeam: defender.team,
      attackingDirectionByTeam: state.attackingDirection,
    });
    if (clearanceExit) {
      return pushPitchExitRestart(trace, {
        actor: defender, ballFrom: contactPoint, exit: clearanceExit, movement: "clearance",
        contact: { point: contactPoint, actor: defender, type: "clearance", phase: "start" },
      });
    }
    const endpoint = {
      x: rawTarget.x,
      y: rawTarget.y,
      zone: zoneFromPercent(rawTarget.x, rawTarget.y),
    };
    trace.push(
      traceEvent(
        outcome.code,
        decision.type === "clear-long"
          ? `${playerName(defender.player)} clears it long upfield`
          : `${playerName(defender.player)} clears it toward the touchline`,
        {
          actor: defender,
          movement: "clearance",
          outcome: "neutral",
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
    availability?.restartType ?? null,
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
  const crossOrigin = pointOf(owner);
  // Ball Out of Bounds v1 -- see resolvePass()'s own matching comment. A
  // cross overhit clean out of play never reaches a contest at all.
  const crossPitchExit = classifyPitchExit({
    from: crossOrigin,
    to: landingXY,
    lastTouchTeam: owner.team,
    attackingDirectionByTeam: state.attackingDirection,
  });
  if (crossPitchExit) {
    const fullDistanceYards = yardDistance(crossOrigin, landingXY);
    const exitDistanceYards = yardDistance(crossOrigin, crossPitchExit.ballEnd);
    const exitDurationMs = fullDistanceYards > 0
      ? MOVEMENT_DURATIONS.cross * (exitDistanceYards / fullDistanceYards)
      : 0;
    return pushPitchExitRestart(trace, {
      actor: owner, ballFrom: crossOrigin, exit: crossPitchExit, movement: "cross", duration: exitDurationMs,
    });
  }
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
      passerId: owner.role === "keeper" ? null : owner.id,
      passDestination: landingPoint,
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
  return resolveHeaderAtGoal(receiver, keeper, landingPoint, groups, random, trace, { aerialDefender });
}

// Extracted verbatim from resolveCross()'s own header-finish chain
// (2026-08-26, Passing v3) -- range check, on-target roll, keeper save,
// rebound handoff -- so a header contest reached via an ORDINARY LOFTED
// PASS (Section B, matchPassFlight.js's new height-band contest) finishes
// exactly the same real way a crossed header always could, rather than a
// smaller, second-class version of the same play. resolveCross() itself
// now just calls this too; its own behavior is unchanged, only relocated.
function resolveHeaderAtGoal(receiver, keeper, contactPoint, groups, random, trace, { aerialDefender = null } = {}) {
  // X1 already moved the participants to this authoritative aerial-contact
  // point in playback. Carry that same location into every header/save/
  // rebound calculation; the roster entry still contains its pre-cross
  // coordinate because trace resolution itself is intentionally immutable.
  const receiverAtContact = {
    ...receiver,
    ...contactPoint,
    zone: contactPoint.zone ?? zoneFromPercent(contactPoint.x, contactPoint.y),
  };
  const aerialDefenderAtContact = aerialDefender
    ? {
        ...aerialDefender,
        ...contactPoint,
        zone: contactPoint.zone ?? zoneFromPercent(contactPoint.x, contactPoint.y),
      }
    : null;
  // Range check (2026-08-18, originally resolveCross()'s own) -- a won
  // aerial must never become a header attempt at goal from well outside
  // real headed-effort range. Reuses the identical box-plus-margin
  // definition the candidate gate uses, so the two never silently drift
  // apart.
  if (!isCrossTargetZone(contactPoint, state.attackingDirection[receiver.team])) {
    trace.push(
      traceEvent(
        "X1.CONTROL",
        `${playerName(receiver.player)} controls it -- too far out for a header at goal`,
        {
          actor: receiverAtContact,
          movement: "reception",
          outcome: "success",
          ballFrom: contactPoint,
          ballTo: contactPoint,
          contact: {
            point: contactPoint,
            actor: receiverAtContact,
            type: "touch",
            phase: "end",
          },
          ownerBefore: receiverAtContact,
          ownerAfter: receiverAtContact,
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
      ballEnd: contactPoint,
      restart: null,
      reason: "cross-received-controlled",
    };
  }
  const headerAttempt = resolveFinishAttempt(
    "header",
    receiverAtContact.player,
    random,
    aerialDefenderAtContact ? 1 : 1.15,
  );
  const headerMiss = headerAttempt.onTarget
    ? null
    : missPointFor(receiverAtContact, keeper, null, headerAttempt.code);
  const headerAimPoint = headerAttempt.onTarget
    ? shotPlacementSpread(receiverAtContact, keeper, aerialDefenderAtContact ? 0.35 : 0.1, random)
    : null;
  // Header Save Contact v1 -- an on-target header and the goalkeeper now
  // share one physical interval. Previously F.HEADER moved only the ball to
  // the mouth, then K.SAVE started the keeper's journey afterward. During a
  // declared catch this visibly parked the ball by a post while the keeper
  // was still elsewhere. The same reach envelope used by ordinary shots now
  // decides whether this keeper can make contact, and advanceKeeperSaveMotion
  // authors that exact body movement during the incoming header.
  const keeperBeaten = keeper && isKeeperBeaten(receiverAtContact, keeper);
  const headerFlight = headerAttempt.onTarget
    ? headerShotFlight(contactPoint, headerAimPoint)
    : null;
  const keeperEnvelope = headerFlight && keeper && !keeperBeaten
    ? simulateShotKeeperEnvelope(headerFlight, keeper)
    : { reached: false };
  // Preserve resolveKeeperSave's established header outcome weighting once
  // the body can genuinely reach the ball. Geometry only vetoes an impossible
  // save; it does not invent a second save-flavour distribution.
  const selectedSave = headerAttempt.onTarget && keeper && !keeperBeaten
    ? resolveKeeperSave(
        receiverAtContact.player,
        keeper.player,
        "header",
        FIXED_MINUTE,
        random,
        receiverAtContact.zone,
      )
    : null;
  const save = selectedSave && keeperEnvelope.reached
    ? selectedSave
    : { code: "K.SAVE.0", goal: true, rebound: false };
  // K.SAVE.0 is a clean beat: even if the keeper could get close enough in
  // principle, there is no hand contact, so the ball completes its flight to
  // the goal plane. All actual save/tip outcomes stop at the first reachable
  // ball/body envelope and continue from that one point.
  const keeperMakesContact = Boolean(
    headerAttempt.onTarget
      && keeper
      && !keeperBeaten
      && keeperEnvelope.reached
      && save.code !== "K.SAVE.0",
  );
  const headerDurationMs = headerFlight
    ? (keeperMakesContact ? keeperEnvelope.atMs : headerFlight.durationMs)
    : MOVEMENT_DURATIONS.header;
  const headerEndpoint = headerFlight
    ? shotPositionAtElapsed(headerFlight, headerDurationMs)
    : null;
  const keeperMotion = headerFlight && keeper && !keeperBeaten
    ? advanceKeeperSaveMotion({
        from: pointOf(keeper),
        intentionTarget: headerFlight.actual,
        player: keeper.player,
        elapsedMs: headerDurationMs,
        reactionDelayMs: reactionDelayMsFor(keeper.player),
        intention: "intercept",
        paceToArrival: false,
      })
    : null;
  const keeperAtContact = keeperMotion
    ? { ...keeper, ...keeperMotion.position }
    : keeper;
  trace.push(
    traceEvent(
      headerAttempt.code,
      headerAttempt.onTarget ? "On target" : "Off target",
      {
        actor: receiverAtContact,
        keeper,
        movement: "header",
        duration: headerDurationMs,
        playerMoves: keeperMotion
          ? [{
              player: keeper,
              from: pointOf(keeper),
              to: keeperMotion.position,
              action: "intercept",
              trajectory: keeperMotion.trajectory,
              motionModel: keeperMotion.motionModel,
              reactionDelayMs: reactionDelayMsFor(keeper.player),
              intention: { action: "intercept", target: headerFlight.actual },
            }]
          : null,
        ballTrajectory: headerFlight
          ? Array.from({ length: 13 }, (_, index) => {
              const progress = index / 12;
              return {
                progress,
                position: shotPositionAtElapsed(
                  headerFlight,
                  progress * headerDurationMs,
                ),
                velocity: {
                  x: (headerFlight.actual.x - headerFlight.from.x) / headerFlight.durationMs,
                  y: (headerFlight.actual.y - headerFlight.from.y) / headerFlight.durationMs,
                },
                mode: "airborne",
              };
            })
          : undefined,
        outcome: headerAttempt.onTarget ? "success" : "fail",
        ballFrom: contactPoint,
        ballTo: headerAttempt.onTarget
          ? headerEndpoint
          : headerMiss.point,
        contact: {
          point: contactPoint,
          actor: receiverAtContact,
          type: "header",
          phase: "start",
        },
        ownerBefore: receiverAtContact,
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
  if (!keeper || keeperBeaten) {
    const emptyNetEnd = netPointFor(receiverAtContact, headerAimPoint.x);
    trace.push(
      traceEvent(
        "EMPTY_NET",
        keeperBeaten
          ? `${playerName(receiver.player)} finishes into an empty net -- ${playerName(keeper.player)} is well beaten`
          : `${playerName(receiver.player)} finishes into an empty net -- no goalkeeper placed`,
        {
          actor: receiverAtContact,
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
  const saveEndpoint = pushKeeperSaveEvent(trace, {
    shooterEntry: receiverAtContact,
    keeperEntry: keeperAtContact,
    save,
    contactPoint: headerEndpoint,
    keeperContactResolved: true,
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
  if (save.reboundTransition || !save.rebound) {
    return keeperSaveTransition(save, keeper, saveEndpoint, "header");
  }
  if (!aerialDefenderAtContact) {
    // No opponent placed to contest the loose ball either -- uncontested,
    // same principle as the aerial race above, straight to the shot roll.
    const scored = random() < reboundShotChance(receiverAtContact.player, keeper.player);
    const reboundMiss = scored
      ? null
      : missPointFor(receiverAtContact, keeper, null, null);
    const reboundEnd = scored
      ? netPointFor(receiverAtContact, shotPlacementSpread(receiverAtContact, keeper, REBOUND_SHOT_PRESSURE, random).x)
      : reboundMiss.point;
    trace.push(
      traceEvent(
        scored ? "REBOUND.GOAL" : "REBOUND.MISS",
        scored
          ? `${playerName(receiver.player)} scrambles it in, unchallenged`
          : "The rebound drifts away, unchallenged",
        {
          actor: receiverAtContact,
          keeper,
          movement: "rebound-shot",
          outcome: scored ? "goal" : "fail",
          ...realMoverTrajectory(receiverAtContact, saveEndpoint, { floorMs: MOVEMENT_DURATIONS["rebound-shot"] }),
          ballFrom: saveEndpoint,
          ballTo: reboundEnd,
          badge: scored ? null : reboundMiss.badge,
          contact: {
            point: saveEndpoint,
            actor: receiverAtContact,
            type: "rebound-shot",
            phase: "start",
          },
          ownerBefore: receiverAtContact,
          ownerAfter: null,
        },
      ),
    );
    return {
      outcome: scored ? "GOAL" : "NO GOAL",
      code: scored ? "REBOUND.GOAL" : "REBOUND.MISS",
      resolved: true,
      terminal: true,
      possession: "dead",
      nextOwnerId: null,
      ballEnd: reboundEnd,
      restart: scored ? "kickoff" : "goal-kick",
      reason: scored ? "rebound-goal-uncontested" : "rebound-miss-uncontested",
    };
  }
  return resolveReboundScramble(
    receiverAtContact,
    aerialDefenderAtContact,
    keeperAtContact,
    receiverAtContact.zone,
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
//
// Engagement Breaker v1 (2026-08-28) -- a real reported bug: "won"/
// "beaten" used to nudge the ball just 1.2-1.5yd, still comfortably
// inside DUEL_RANGE_YARDS (6) -- the new owner's very next decision found
// the SAME defender re-engaging at effectively 0 real separation,
// feeding the shield/duel wrestling loop the same way P.HOLD.SHIELD's
// own frozen contactPoint did. Both outcomes now use
// contestSeparationPoints() (this file, see its own header) for a real
// 4-6yd winner escape plus a genuine loser gap -- the winner drives away
// WITH the ball, the loser is left behind, never both still standing at
// the shared contact point.
function duelReaction(owner, defender, outcome) {
  const contactPoint = pointOf(owner);
  if (outcome === "foul")
    return { contactPoint, ballEnd: contactPoint, winner: null, loser: null, code: null };
  if (outcome === "won") {
    const { winnerPoint, loserPoint } = contestSeparationPoints(contactPoint, defender.team);
    return {
      contactPoint,
      ballEnd: winnerPoint,
      winner: defender, winnerPoint,
      loser: owner, loserPoint,
      code: "T.WON.CONTROL",
      label: `${playerName(defender.player)} wins the ball and drives away from the challenge`,
      possession: defender,
    };
  }
  if (outcome === "beaten") {
    const { winnerPoint, loserPoint } = contestSeparationPoints(contactPoint, owner.team);
    return {
      contactPoint,
      ballEnd: winnerPoint,
      winner: owner, winnerPoint,
      loser: defender, loserPoint,
      code: "T.BEATEN.ESCAPE",
      label: `${playerName(owner.player)} rides the challenge and bursts clear`,
      possession: owner,
    };
  }
  // "loose" -- nobody wins a position here, only the ball's own pop
  // direction/distance (reusing contestSeparationPoints() purely for its
  // geometry, biased in the challenging defender's own forward
  // direction -- the same "Strength direction" bias a real knock-on has).
  const { winnerPoint: poppedPoint } = contestSeparationPoints(contactPoint, defender.team, 6);
  // Playback Fluidity v1 (2026-09-05) -- a real reported bug: "players
  // freeze". Nobody winning POSSESSION is not the same as nobody MOVING.
  // This outcome used to author no player positions at all, on the reasoning
  // that there is no winner to place -- so both bodies stood frozen on the
  // contact point for the whole deflection window while only the ball moved.
  // A challenge that knocks the ball loose is two players colliding and
  // carrying through it. `separation` is the physical fact (who ends up
  // where), kept deliberately separate from winner/loser, which remain the
  // POSSESSION fact and stay null here.
  const looseSeparation = contestSeparationPoints(contactPoint, defender.team);
  return {
    contactPoint,
    ballEnd: poppedPoint,
    winner: null, winnerPoint: null,
    loser: null, loserPoint: null,
    separation: [
      { player: defender, point: looseSeparation.winnerPoint, action: "challenge" },
      { player: owner, point: looseSeparation.loserPoint, action: "beaten" },
    ],
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
  const rosterById = new Map(roster.map((entry) => [String(entry.id), entry]));
  const proposalById = new Map(
    proposals.map((proposal) => [proposal.id, proposal]),
  );
  const spaced = proposals.map((proposal) => {
    // Closing a shooting angle is not an outfield spacing job. Pushing the
    // keeper eight yards away from a defender's proposed recovery position
    // can send him back to the line. Body separation still applies below.
    if (proposal.role === "keeper"
      && ["keeper-close-down", "keeper-sweep"].includes(proposal.action)) return proposal;
    const targetYards = toYardPoint(proposal.target);
    let offsetX = 0;
    let offsetY = 0;
    for (const other of roster) {
      if (
        !other ||
        other.id === proposal.id ||
        teamOf.get(other.id) !== teamOf.get(proposal.id) ||
        // Goalkeepers do not participate in the outfield unit's tactical
        // eight-yard repulsion. Real body occupancy is still enforced below.
        // Including them here could push a centre-back toward the goal line.
        other.role === "keeper"
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
  const occupied = applyBodyOccupancy(spaced, roster);
  const keeperByTeam = new Map(
    roster.filter((entry) => entry?.role === "keeper").map((entry) => [entry.team, entry]),
  );
  const proposalByStringId = new Map(occupied.map((entry) => [String(entry.id), entry]));
  return occupied.map((proposal) => {
    if (proposal.role === "keeper" || proposal.action === "cover-goal") return proposal;
    const player = rosterById.get(String(proposal.id));
    const keeper = player ? keeperByTeam.get(player.team) : null;
    if (!keeper) return proposal;
    const keeperTarget = proposalByStringId.get(String(keeper.id))?.target ?? keeper;
    const target = outfieldPositionAheadOfKeeper(
      proposal.target,
      keeper,
      keeperTarget,
      state.attackingDirection[player.team],
    );
    if (target === proposal.target) return proposal;
    return {
      ...proposal,
      target: { ...target, zone: zoneFromPercent(target.x, target.y) },
    };
  });
}

// A successful shield retains control through contact; it is not the same
// event as dribbling past the challenger. Choose a short continuation from
// live momentum and nearby space, then let worldMotion determine how much of
// it the holder can physically cover during the hold beat.
function shieldRetentionMotion(owner, defender, opponents, contactPoint, motionContext) {
  const contactYards = toYardPoint(contactPoint);
  const direction = state.attackingDirection[owner.team] === "up" ? -1 : 1;
  const record = readMotionRecord(motionContext, owner.id, contactPoint);
  const velocity = record.velocity ?? { x: 0, y: 0 };
  const velocityYards = {
    x: (Number(velocity.x) || 0) * PITCH_WIDTH_YARDS,
    y: (Number(velocity.y) || 0) * PITCH_LENGTH_YARDS,
  };
  const velocityLength = Math.hypot(velocityYards.x, velocityYards.y);
  const momentumHeading = velocityLength > 0.15
    ? { x: velocityYards.x / velocityLength, y: velocityYards.y / velocityLength }
    : null;
  const agility = playerAttribute(owner.player, "Agility");
  const balance = playerAttribute(owner.player, "Balance");
  const desiredYards = 1.25 + ((agility + balance) / 40) * 0.65;
  const headings = [
    ...(momentumHeading ? [momentumHeading] : []),
    { x: 0, y: direction },
    { x: -0.48, y: direction * 0.88 },
    { x: 0.48, y: direction * 0.88 },
    { x: -0.7, y: -direction * 0.35 },
    { x: 0.7, y: -direction * 0.35 },
  ];
  const nearby = (opponents ?? []).filter((entry) => String(entry.id) !== String(defender.id));
  const candidates = headings.map((heading, index) => {
    const length = Math.hypot(heading.x, heading.y) || 1;
    const unit = { x: heading.x / length, y: heading.y / length };
    const yards = {
      x: reflectIntoRange(contactYards.x + unit.x * desiredYards, 0, PITCH_WIDTH_YARDS),
      y: reflectIntoRange(contactYards.y + unit.y * desiredYards, 0, PITCH_LENGTH_YARDS),
    };
    const candidate = fromYardPoint(yards);
    const clearance = nearby.length
      ? Math.min(...nearby.map((entry) => yardDistance(candidate, entry)))
      : 8;
    const momentum = momentumHeading
      ? unit.x * momentumHeading.x + unit.y * momentumHeading.y
      : 0;
    const forward = unit.y * direction;
    const boundaryMargin = Math.min(yards.x, PITCH_WIDTH_YARDS - yards.x, yards.y, PITCH_LENGTH_YARDS - yards.y);
    return { candidate, score: clearance * 0.7 + momentum * 1.8 + forward * 0.55 + Math.min(2, boundaryMargin) * 0.2 - index * 0.001 };
  }).sort((a, b) => b.score - a.score);
  const intentionTarget = candidates[0]?.candidate ?? contactPoint;
  const duration = MOVEMENT_DURATIONS.hold;
  const motion = advanceMotion({
    from: contactPoint,
    intentionTarget,
    player: owner.player,
    elapsedMs: duration,
    reactionDelayMs: 0,
    incomingVelocity: velocity,
    paceToArrival: false,
    intention: "shield-retain",
    continuesAfter: true,
    sampleCount: 7,
  });
  return { ...motion, intentionTarget, duration };
}

// Player Body Occupancy v1 (2026-09-06) -- see src/lib/playerBody.js's own
// header for why this is a SECOND, different constraint rather than a
// retuning of the 8-yard tactical spacing above.
//
// This adjusts both teams' proposed destinations before worldMotion limits
// their travel. It does not certify the current bodies or paths as collision
// free, and must never be applied to the sampled positions after movement.
//
// Roster members with no proposal in this batch (whoever the caller
// excluded -- the ball carrier, an interceptor running their own authored
// path) are still real bodies to avoid, so they take part as ANCHORED
// obstacles: they are never displaced by this pass, but proposals yield
// around them.
function applyBodyOccupancy(proposals, roster) {
  const proposalIds = new Set(proposals.map((proposal) => String(proposal.id)));
  const anchors = roster.filter((entry) => entry && !proposalIds.has(String(entry.id)));
  const bodies = [
    ...proposals.map((proposal) => ({
      id: proposal.id, x: proposal.target.x, y: proposal.target.y,
    })),
    ...anchors.map((entry) => ({ id: entry.id, x: entry.x, y: entry.y })),
  ];
  const resolved = resolveBodyOverlaps(bodies, {
    anchoredIds: anchors.map((entry) => entry.id),
  });
  const pointById = new Map(resolved.map((body) => [String(body.id), body]));
  return proposals.map((proposal) => {
    const point = pointById.get(String(proposal.id));
    if (!point) return proposal;
    const unchanged = Math.abs(point.x - proposal.target.x) < 0.001
      && Math.abs(point.y - proposal.target.y) < 0.001;
    if (unchanged) return proposal;
    return {
      ...proposal,
      target: { x: point.x, y: point.y, zone: zoneFromPercent(point.x, point.y) },
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
    "attack-near": "attacks the near post",
    "attack-spot": "attacks the penalty spot",
    "attack-far": "attacks the far post",
    "edge-rebound": "arrives for the edge-of-box rebound",
    "drag-away": "drags a marker away",
    "pin-last-line": "pins the last line",
    overload: "joins the overload",
    "clear-the-zone": "clears the zone",
    // Pattern Vocabulary V1, Step 1 (2026-09-02)
    "vacate-pocket": "vacates the pocket",
    "arc-overlap": "makes an overlapping run",
    "run-off-pass": "runs off the pass",
    "peel-square": "peels square away from the marker",
    "show-wide": "shows wide for the ball",
    "check-decel": "checks, then darts into the gap",
  },
  defender: {
    "cover-goal": "runs back to protect the exposed goal",
    "respect-held-ball": "drops away while the goalkeeper holds the ball",
    "press-ball": "presses the ball",
    mark: "tracks a runner",
    screen: "screens the danger",
    "shift-unit": "shifts with the unit",
    "drop-block": "drops into the block",
    // Pattern Vocabulary V1, Step 1 (2026-09-02)
    delay: "closes the gap, holding the lane",
  },
  keeper: {
    "set-position": "holds the goalkeeper line",
    "keeper-sweep": "rushes to meet the ball",
    "keeper-close-down": "closes down the attacker and narrows the angle",
    "keeper-recover": "scrambles back toward goal",
  },
};

function enforceHeldKeeperDistance(targets, opponents, keeperPoint, keeperId) {
  const opponentById = new Map(opponents.map((entry) => [String(entry.id), entry]));
  for (const target of targets) {
    const opponent = opponentById.get(String(target.id));
    if (!opponent) continue;
    const legalTarget = heldKeeperStandoffTarget(opponent, target.target, keeperPoint);
    Object.assign(target, {
      action: "respect-held-ball",
      target: legalTarget,
      intentionTarget: legalTarget,
      teamJob: "respect-held-ball",
      subjectId: keeperId,
    });
  }
}

function offBallAssignmentsLabel(moves, role) {
  return moves
    .map((move) => {
      const phrase = COORDINATION_RESPONSIBILITY_PHRASE[move.coordinationResponsibility]
        ?? OFF_BALL_ACTION_PHRASE[role]?.[move.action] ?? "repositions";
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
// Off-Ball v2 (2026-08-24) -- rebuilds motionContext.marking from this
// reaction's own planDefensiveRepositioning() results (persisted for the
// NEXT reaction's own stickiness), and inverts it into a per-ATTACKER
// lookup (subjectId -> {tightness, markerRole}) for
// planAttackerRepositioning()'s own tight-mark reaction. Pure bookkeeping
// -- spatialDecision.js itself never mutates anything; this is the one
// place that reads its results and writes them back.
function syncMarkingAssignments(defenderPlan, motionContext) {
  const nextMarking = {};
  const markingLookup = {};
  for (const step of defenderPlan) {
    if (!step.mode) continue;
    nextMarking[step.id] = { subjectId: step.subjectId ?? null, mode: step.mode, tightness: step.tightness };
    if (step.mode === "man" && step.subjectId) {
      markingLookup[step.subjectId] = { tightness: step.tightness, markerRole: step.markerRole ?? null };
    }
  }
  if (motionContext) motionContext.marking = nextMarking;
  return markingLookup;
}

// Team Shape & Phase Intelligence v1. These helpers adapt the pure phase/
// shape modules to Match Lab's existing {owner, teammates, opponents,
// keepers} snapshot. They write only possession-local engine context; the
// authored roster and every DOM node remain outside this path.
function uniqueSnapshotEntries(snapshots) {
  const seen = new Set();
  return [
    snapshots.owner,
    ...snapshots.teammates,
    ...snapshots.opponents,
    ...snapshots.ownKeepers,
    ...snapshots.opposingKeepers,
  ].filter((entry) => {
    if (!entry || seen.has(String(entry.id))) return false;
    seen.add(String(entry.id));
    return true;
  });
}

function teamPhaseFacts(snapshots, ballFrom, ballPoint, motionContext) {
  return {
    possessionTeam: snapshots.owner?.team ?? null,
    owner: snapshots.owner ?? null,
    ballFrom,
    ballPoint,
    attackingDirectionByTeam: state.attackingDirection,
    restartActive: motionContext?.restartContext?.status === "restart",
    restartTaken: false,
    directRestart: Boolean(motionContext?.restartContext?.direct),
  };
}

function ensureTeamPhaseContext(motionContext, snapshots, ballFrom, ballPoint) {
  if (!motionContext) return null;
  if (!motionContext.teamPhase) {
    const teams = [...new Set(uniqueSnapshotEntries(snapshots).map((entry) => entry.team).filter(Boolean))];
    motionContext.teamPhase = createTeamPhaseState({
      teams,
      possessionTeam: snapshots.owner?.team ?? null,
      restartActive: motionContext.restartContext?.status === "restart",
    });
  }
  motionContext.teamPhase = updateTeamPhaseState(
    motionContext.teamPhase,
    teamPhaseFacts(snapshots, ballFrom, ballPoint, motionContext),
    0,
  );
  motionContext.teamShapeJobs ||= {};
  motionContext.shapeSnapshots ||= [];
  motionContext.simulationTimeMs ||= 0;
  return motionContext.teamPhase;
}

function diagnosticShapeAssignment(assignment) {
  const region = (value) => value ? { ...value, flags: { ...value.flags } } : null;
  return {
    id: assignment.id,
    team: assignment.team,
    teamPhase: assignment.teamPhase,
    teamJob: assignment.teamJob,
    positionalSlot: assignment.positionalSlot,
    tacticalRole: assignment.tacticalRole,
    duty: assignment.duty,
    formationAnchor: { ...assignment.formationAnchor },
    shapeTarget: { ...assignment.shapeTarget },
    intentionTarget: { ...assignment.intentionTarget },
    occupiedLane: assignment.occupiedLane,
    occupiedDepthBand: assignment.occupiedDepthBand,
    currentRegion: region(assignment.currentRegion),
    shapeRegion: region(assignment.shapeRegion),
    intendedRegion: region(assignment.intendedRegion),
    regionMove: assignment.regionMove,
    targetRegionOccupancy: assignment.targetRegionOccupancy,
    runIntoOccupiedRegion: assignment.runIntoOccupiedRegion,
    runIntoOpenRegion: assignment.runIntoOpenRegion,
  };
}

function updateLiveCoordination(motionContext, roster, ownerId, ballPoint, nowMs, flags = {}) {
  if (!motionContext || !ownerId || !ballPoint) return null;
  const teams = [...new Set(roster.map((entry) => entry.team).filter(Boolean))];
  const hasAuthoredTeamShape = teams.length >= 2 && teams.every((team) => {
    const entries = roster.filter((entry) => entry.team === team);
    return entries.filter((entry) => entry.formationAnchor).length >= Math.min(3, entries.length);
  });
  // Legacy saved probes and small resolver fixtures can contain only loose
  // coordinates, with no formation relationship for the coordinator to
  // preserve. Their established local planners remain authoritative until a
  // real Match Setup supplies anchors; this also keeps replay compatibility.
  if (!hasAuthoredTeamShape) {
    motionContext.coordination = null;
    return null;
  }
  const tacticsByTeam = Object.fromEntries(teams.map((team) => [team, {
    attacking: attackingSettingsFor(team),
    transition: transitionSettingsFor(team),
    defending: markingSettingsFor(team),
  }]));
  const velocities = Object.fromEntries(roster.map((entry) => [String(entry.id),
    motionContext.state?.players?.[entry.id]?.velocity ?? { x: 0, y: 0 }]));
  const coordinated = coordinateInteraction({
    previous: motionContext.coordination ?? createCoordinationState(motionContext.seed),
    players: roster,
    ownerId,
    ballPoint,
    attackingDirectionByTeam: state.attackingDirection,
    tacticsByTeam,
    velocities,
    nowMs,
    flags,
  });
  motionContext.coordination = coordinated.state;
  motionContext.coordinationSnapshots ||= [];
  if (!motionContext.coordinationSnapshots.length
    || motionContext.coordinationSnapshots.at(-1).timeMs !== coordinated.evidence?.timeMs
    || motionContext.coordinationSnapshots.at(-1).selectedAttack?.family !== coordinated.evidence?.selectedAttack?.family) {
    motionContext.coordinationSnapshots.push(coordinated.evidence);
    if (motionContext.coordinationSnapshots.length > 160) motionContext.coordinationSnapshots.shift();
  }
  return coordinated;
}

function coordinateTargetProposals({
  targets, snapshots, ballPoint, phaseState, motionContext,
  activeOwnerId = snapshots.owner?.id ?? null, recordSnapshot = false,
  simulationTimeMs = motionContext?.simulationTimeMs ?? 0,
  coordinationFlags = {},
}) {
  const roster = uniqueSnapshotEntries(snapshots);
  const possessionTeam = snapshots.owner?.team ?? null;
  const byId = new Map(targets.map((target) => [String(target.id), target]));
  const liveCoordination = updateLiveCoordination(
    motionContext,
    roster,
    snapshots.owner?.id ?? null,
    ballPoint,
    simulationTimeMs,
    { ...coordinationFlags, reason: coordinationFlags.reason ?? (recordSnapshot ? "live-motion-replan" : "off-ball-plan") },
  );
  for (const target of targets) {
    if (!liveCoordination && !target.coordinationBase) continue;
    target.coordinationBase ??= {
      action: target.action,
      target: { ...(target.target ?? target.intentionTarget) },
      intentionTarget: { ...(target.intentionTarget ?? target.target) },
    };
    target.action = target.coordinationBase.action;
    target.target = { ...target.coordinationBase.target };
    target.intentionTarget = { ...target.coordinationBase.intentionTarget };
    target.coordinationResponsibility = null;
    target.coordinationFamily = null;
    target.coordinationRelationship = null;
    target.coordinationThreatId = null;
  }
  const coordinationById = new Map((liveCoordination?.intentions ?? [])
    .map((intent) => [String(intent.playerId), intent]));
  for (const target of targets) {
    const intent = coordinationById.get(String(target.id));
    if (!intent || intent.responsibility === "ball-carrier"
      || intent.responsibility === "goalkeeper-cover-sweeper") continue;
    target.action = intent.action;
    target.intentionTarget = { ...intent.target };
    target.target = { ...intent.target };
    target.coordinationResponsibility = intent.responsibility;
    target.coordinationFamily = intent.family;
    target.coordinationRelationship = intent.relationship;
    target.coordinationThreatId = intent.threatId ?? null;
  }
  const teamDiagnostics = {};
  for (const team of [...new Set(roster.map((entry) => entry.team).filter(Boolean))]) {
    const entries = roster.filter((entry) => entry.team === team);
    // Legacy/sparse resolver fixtures have no authored formation model.
    // Preserve their established local-planner behaviour; coordinated shape
    // becomes authoritative once a real Match Setup supplies anchors.
    if (entries.filter((entry) => entry.formationAnchor).length < Math.min(3, entries.length)) continue;
    const basePlans = targets
      .filter((target) => entries.some((entry) => String(entry.id) === String(target.id)))
      .map((target) => ({
        id: target.id,
        action: target.action,
        intentionTarget: target.intentionTarget ?? target.target,
      }));
    const coordinated = coordinateTeamShape({
      entries,
      ballPoint,
      possessionTeam,
      ownerId: team === possessionTeam ? activeOwnerId : null,
      attackingDirection: state.attackingDirection[team],
      phase: phaseForTeam(phaseState, team)
        ?? (team === possessionTeam ? "progression" : "defensive-block"),
      previousJobs: motionContext?.teamShapeJobs?.[team] || {},
      style: attackingSettingsFor(team).style,
      attacking: attackingSettingsFor(team),
      transition: transitionSettingsFor(team),
      marking: motionContext?.territoryPress?.team === team && motionContext.simulationTimeMs < motionContext.territoryPress.untilMs
        ? { ...markingSettingsFor(team), pressing: "high", engagementLine: "high" }
        : markingSettingsFor(team),
      oppositionOwner: team === possessionTeam ? null : snapshots.owner,
      basePlans,
    });
    if (motionContext) motionContext.teamShapeJobs[team] = coordinated.jobs;
    for (const assignment of coordinated.assignments) {
      const target = byId.get(String(assignment.id));
      if (!target) continue;
      target.target = { ...assignment.intentionTarget };
      target.intentionTarget = { ...assignment.intentionTarget };
      target.shapeTarget = { ...assignment.shapeTarget };
      target.formationAnchor = { ...assignment.formationAnchor };
      target.teamJob = assignment.teamJob;
      target.teamPhase = assignment.teamPhase;
      target.occupiedLane = assignment.occupiedLane;
      target.occupiedDepthBand = assignment.occupiedDepthBand;
      target.currentRegion = assignment.currentRegion;
      target.shapeRegion = assignment.shapeRegion;
      target.intendedRegion = assignment.intendedRegion;
      target.regionMove = assignment.regionMove;
      target.targetRegionOccupancy = assignment.targetRegionOccupancy;
      target.tacticalRole = assignment.tacticalRole;
      target.duty = assignment.duty;
      const intent = coordinationById.get(String(assignment.id));
      if (intent && intent.responsibility !== "ball-carrier"
        && intent.responsibility !== "goalkeeper-cover-sweeper") {
        target.teamJob = intent.responsibility;
        target.coordinationResponsibility = intent.responsibility;
        target.coordinationFamily = intent.family;
        target.coordinationRelationship = intent.relationship;
        target.coordinationThreatId = intent.threatId ?? null;
      } else if (liveCoordination?.evidence?.pressure?.ownerId
        && (assignment.teamJob === "primary-presser" || target.action === "press-ball")) {
        target.action = "shift-unit";
        target.target = { ...assignment.shapeTarget };
        target.intentionTarget = { ...assignment.shapeTarget };
        target.teamJob = "shape-balance";
      }
    }
    teamDiagnostics[team] = {
      phase: phaseForTeam(phaseState, team),
      metrics: coordinated.metrics,
      assignments: coordinated.assignments.map(diagnosticShapeAssignment),
    };
  }
  if (recordSnapshot && motionContext && Object.keys(teamDiagnostics).length) {
    motionContext.shapeSnapshots.push({
      timeMs: simulationTimeMs,
      ball: { ...ballPoint },
      teams: teamDiagnostics,
    });
  }
  // Emergency goalkeeper/goal-cover jobs supersede formation anchors. They
  // remain destinations, subject to the same movement budget as every job.
  for (const keeper of snapshots.opposingKeepers || []) {
    const proposal = byId.get(String(keeper.id));
    if (!proposal) continue;
    const response = planKeeperResponse({ keeper, ball: ballPoint, attacker: snapshots.owner,
      defenders: snapshots.opponents, defendingDirection: state.attackingDirection[keeper.team],
      velocity: motionContext?.state?.players?.[keeper.id]?.velocity ?? keeper.keeperVelocity,
      attackerVelocity: snapshots.owner
        ? motionContext?.state?.players?.[snapshots.owner.id]?.velocity ?? null
        : null,
      holdTarget: keeperPositioningPoint(ballPoint, state.attackingDirection[keeper.team]),
      random: seededRandom(hashString(`keeper-read:${motionContext?.seed ?? 0}:${keeper.id}:${Math.floor(simulationTimeMs / 500)}`)),
    });
    Object.assign(proposal, {
      target: response.target, intentionTarget: response.target,
      action: response.action, teamJob: response.action, reactionDelayMs: response.reactionDelayMs,
    });
    if (response.angleManagement && liveCoordination?.evidence) {
      liveCoordination.evidence.goalkeeper = {
        playerId: keeper.id,
        action: response.action,
        ...response.angleManagement,
      };
      if (motionContext?.coordination?.latestEvidence) {
        motionContext.coordination.latestEvidence.goalkeeper = liveCoordination.evidence.goalkeeper;
      }
    }
    const cover = chooseGoalCover({ keeper, defenders: snapshots.opponents, ball: ballPoint,
      defendingDirection: state.attackingDirection[keeper.team], keeperAction: response.action });
    const defender = cover && byId.get(String(cover.id));
    if (defender) Object.assign(defender, { target: cover.target, intentionTarget: cover.target,
      action: cover.action, teamJob: cover.action, reactionDelayMs: cover.reactionDelayMs });
  }
  return { targets, teamDiagnostics, coordination: liveCoordination };
}

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
    // Pattern Vocabulary V1, Step 1 (2026-09-02) -- see buildLiveJobTargets()'s
    // own matching comment; optional and additive, same convention.
    passerId = null,
    passDestination = null,
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

  // Off-Ball v2 (2026-08-24) -- the defensive plan is computed FIRST here
  // (moved ahead of the attacker plan below) so planAttackerRepositioning()
  // can react to who's actually marking each attacker this step, not the
  // reverse. syncMarkingAssignments() both persists the sticky assignment
  // into motionContext.marking for the NEXT reaction and inverts THIS
  // reaction's own results into a per-attacker lookup.
  //
  // Last-Man / Through-Ball Recovery v1 (2026-08-26, Off-Ball Motion v3) --
  // identifyLineBreakingRunnerId() runs the SAME line-breaking-runner
  // selection planAttackerRepositioning() below will use on its own, cheap
  // enough (pure geometry, no randomness) to run twice per reaction rather
  // than reordering the defense-first pass above and losing the
  // markingLookup feedback loop it depends on. Lets planDefensiveRepositioning()'s
  // own recovery override know WHO is making a real run in behind DURING a
  // through ball's flight, not only once they've already received it.
  const lineBreakingRunnerId = snapshots.teammates.length
    ? identifyLineBreakingRunnerId(snapshots.teammates, snapshots.opponents, attackDirection, ballPoint, snapshots.keeper)
    : null;
  let markingLookup = {};
  let defenderMarkingPlan = [];
  if (snapshots.opponents.length) {
    const defendingDirectionForMarking =
      state.attackingDirection[snapshots.opponents[0].team];
    const defendingTeamMarking = markingSettingsFor(snapshots.opponents[0].team);
    defenderMarkingPlan = planDefensiveRepositioning(
      ballPoint,
      snapshots.teammates,
      snapshots.opponents,
      defendingDirectionForMarking,
      {
        previousMarking: motionContext?.marking || {},
        ownerId: snapshots.owner?.id ?? null,
        scheme: defendingTeamMarking.scheme,
        tightness: defendingTeamMarking.tightness,
        runnerId: lineBreakingRunnerId,
      },
    );
    markingLookup = syncMarkingAssignments(defenderMarkingPlan, motionContext);
  }

  if (snapshots.teammates.length || (passerId && snapshots.owner)) {
    const attackerPlan = planAttackerRepositioning(
      passerId && snapshots.owner ? [...snapshots.teammates, snapshots.owner] : snapshots.teammates,
      snapshots.opponents,
      attackDirection,
      {
        ballPoint: { ...ballPoint },
        keeper: snapshots.keeper,
        previousSupportId: previousActionHolderId("support-short"),
        previousDropId: previousActionHolderId("drop-deep"),
        previousShowId: previousActionHolderId("show-to-feet"),
        markingLookup,
        ownerBand: snapshots.owner ? classifyOutfieldBand(snapshots.owner.player) : null,
        passerId,
        passDestination,
      },
    );
    for (const step of attackerPlan) {
      const attacker = step.id === snapshots.owner?.id
        ? snapshots.owner
        : snapshots.teammates.find((entry) => entry.id === step.id);
      if (!attacker) continue;
      if (step.held) {
        heldAttackerJobs.push({
          player: originals.get(attacker.id),
          action: step.action,
        });
        continue;
      }
      // Always propose, even when this touch's own blended nudge is tiny
      // (2026-08-25 fix -- see the matching comment on the defender loop
      // below for the full "stop-go-stop-go" bug this was the root cause
      // of; identical reasoning applies here).
      const blended = partialPoint(attacker, step.target, fraction);
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

  // "stop-go-stop-go" during a multi-touch carry (2026-08-25) -- a real
  // reported bug. Root cause: this loop used to skip pushing a proposal
  // at all whenever THIS touch's own blended nudge fell under 0.5yd
  // (harmless on its own -- byRole()'s own >0.5yd filter below already
  // decides whether a move is worth animating). But resolveMotionBatch()
  // (matchMotion.js) uses "was this id in THIS batch's proposals" to
  // decide whose carried velocity survives into the NEXT reaction --
  // `velocity: proposalIds.has(id) ? cloneVelocity(value.velocity) :
  // {x:0,y:0}`. Skipping the proposal here didn't just skip ONE touch's
  // visible move; it wiped that defender's momentum memory outright, so
  // the very next touch that DID clear the threshold launched from a cold
  // stop instead of continuing their real run -- a defender who was
  // genuinely still running read as repeatedly braking to a dead halt and
  // relaunching. Every defender with a real target is proposed on every
  // touch now, so resolveMotionBatch() always sees them and their
  // velocity carries through continuously; byRole() below still suppresses
  // authoring a trace event for a move too small to be worth animating.
  for (const step of defenderMarkingPlan) {
    const defender = snapshots.opponents.find(
      (entry) => entry.id === step.id,
    );
    if (!defender) continue;
    const blended = partialPoint(defender, step.target, defensiveFraction);
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

  const coordinatedPhase = ensureTeamPhaseContext(
    motionContext, snapshots, ballPoint, ballPoint,
  );
  coordinateTargetProposals({
    targets: proposals,
    snapshots,
    ballPoint,
    phaseState: coordinatedPhase,
    motionContext,
    activeOwnerId: snapshots.owner?.id,
    recordSnapshot: true,
    simulationTimeMs: motionContext?.simulationTimeMs ?? 0,
  });

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
  if (motionContext) {
    motionContext.state = batch.state;
    for (const proposal of separatedProposals) {
      const record = motionContext.state.players?.[proposal.id];
      if (!record) continue;
      Object.assign(record, {
        teamJob: proposal.teamJob ?? null,
        teamPhase: proposal.teamPhase ?? null,
        formationAnchor: proposal.formationAnchor ?? null,
        shapeTarget: proposal.shapeTarget ?? null,
        occupiedLane: proposal.occupiedLane ?? null,
        occupiedDepthBand: proposal.occupiedDepthBand ?? null,
        currentRegion: proposal.currentRegion ?? null,
        intendedRegion: proposal.intendedRegion ?? null,
        regionMove: proposal.regionMove ?? null,
        tacticalRole: proposal.tacticalRole ?? null,
        duty: proposal.duty ?? null,
        coordinationFamily: proposal.coordinationFamily ?? null,
        coordinationResponsibility: proposal.coordinationResponsibility ?? null,
        coordinationRelationship: proposal.coordinationRelationship ?? null,
        coordinationThreatId: proposal.coordinationThreatId ?? null,
      });
    }
  }
  const beatDurationMs = duration ?? MOVEMENT_DURATIONS.reposition;
  const byRole = (role) =>
    batch.moves
      .filter((move) => move.role === role)
      .map((move) => {
        const proposal = separatedProposals.find((entry) => String(entry.id) === String(move.id));
        // Burst Stamina v1 -- same battery, same convention as
        // reactOffBallContinuous()'s own matching call: every off-ball JOB
        // this discrete-beat sibling actually authors drains/refills
        // burst01 by the real distance covered THIS beat.
        applyBurstOffBallJob(originals.get(move.id), move.action, yardDistance(move.from, move.to), beatDurationMs, move.motion);
        return {
          player: originals.get(move.id),
          from: move.from,
          to: move.to,
          action: move.action,
          role: move.role,
          trajectory: move.trajectory,
          intention: move.intention,
          teamJob: proposal?.teamJob ?? null,
          teamPhase: proposal?.teamPhase ?? null,
          formationAnchor: proposal?.formationAnchor ?? null,
          shapeTarget: proposal?.shapeTarget ?? null,
          occupiedLane: proposal?.occupiedLane ?? null,
          occupiedDepthBand: proposal?.occupiedDepthBand ?? null,
          currentRegion: proposal?.currentRegion ?? null,
          intendedRegion: proposal?.intendedRegion ?? null,
          regionMove: proposal?.regionMove ?? null,
          tacticalRole: proposal?.tacticalRole ?? null,
          duty: proposal?.duty ?? null,
          coordinationFamily: proposal?.coordinationFamily ?? null,
          coordinationResponsibility: proposal?.coordinationResponsibility ?? null,
          coordinationRelationship: proposal?.coordinationRelationship ?? null,
          coordinationThreatId: proposal?.coordinationThreatId ?? null,
        };
      })
      .filter(
        (move) =>
          move.player &&
          (Math.abs(move.from.x - move.to.x) > 0.001 ||
            Math.abs(move.from.y - move.to.y) > 0.001),
      );
  const attackerMoves = byRole("attacker");
  const keeperMoves = byRole("keeper");
  const defenderMoves = byRole("defender");
  let discreteCoordinationAttached = false;
  const discreteCoordination = () => {
    if (discreteCoordinationAttached) return null;
    discreteCoordinationAttached = true;
    return motionContext?.coordination?.latestEvidence ?? null;
  };

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
              coordination: discreteCoordination(),
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
        coordination: discreteCoordination(),
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
          coordination: discreteCoordination(),
        },
      ),
    );
  }

  // Atomic commit: no planner above can observe any of these writes.
  for (const move of [...attackerMoves, ...keeperMoves, ...defenderMoves]) {
    Object.assign(move.player, move.to, { engineJob: move.teamJob ?? move.action });
    if (move.player.role === "keeper") move.player.keeperVelocity = motionContext?.state?.players?.[move.player.id]?.velocity;
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
    // true (default): chase the real, uncapped tactical destination -- for
    // a call that genuinely shares a ball flight's own multi-second window
    // (a pass in the air), stretching to the full intentionTarget over that
    // real time is what reads as natural running, not a slow-motion crawl.
    // false: a short, CAPPED nudge -- for a call given only a brief window
    // (reshaping right after a reception), chasing the same far, uncapped
    // destination in a fraction of the time is a physically-impossible
    // burst. Every off-ball reaction after a reception must pass false.
    chaseIntention = true,
    // Progression Contest v1 (2026-08-28) -- optional and additive, same
    // contract as every other option above. The id of a DEFENDING-side
    // player the caller (a WON dribble/shield/poke resolver) already
    // knows was just beaten by this exact action -- see
    // planDefensiveRepositioning()'s own beatenPresserId comment for what
    // it does downstream.
    beatenPresserId = null,
    // Pattern Vocabulary V1, Step 1 (2026-09-02) -- see buildLiveJobTargets()'s
    // own matching comment; optional and additive, same convention.
    passerId = null,
    passDestination = null,
    // Only GK.HOLD supplies this. Once the ball is released to the feet,
    // the option disappears and ordinary press/delay assignments resume.
    keeperHolding = false,
    coordinationFlags = {},
    ballPointAtElapsed = null,
  } = {},
) {
  const flightMoverIds = flushKeeperFlight(defendingGroups, trace, motionContext, totalMs);
  excludedIds = [...excludedIds, ...flightMoverIds];
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
  const heldKeeper = keeperHolding && snapshots.owner?.role === "keeper"
    ? snapshots.owner
    : null;
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
  const coordinationFlagsAtElapsed = (elapsedMs) => {
    const handoffs = coordinationFlags?.claimantHandoffs;
    if (!handoffs) return coordinationFlags;
    const reached = (handoffs.transfers ?? []).filter((entry) => entry.atMs <= elapsedMs);
    const activeClaimantId = reached.at(-1)?.toId ?? handoffs.initialClaimantId;
    const formerClaimantIds = [...new Set(reached.map((entry) => String(entry.fromId)))]
      .filter((id) => id !== String(activeClaimantId));
    const { claimantHandoffs: _claimantHandoffs, ...baseFlags } = coordinationFlags;
    return {
      ...baseFlags,
      looseBall: true,
      activeClaimantId,
      formerClaimantIds,
      claimantTransferReason: reached.at(-1)?.reason ?? null,
      reason: reached.length ? "loose-ball-claimant-handoff" : "loose-ball-live-chase",
    };
  };

  // Off-Ball v2 (2026-08-24) -- defensive plan first, same reorder and
  // same syncMarkingAssignments() reasoning as reactOffBall()'s own
  // comment above.
  //
  // Last-Man / Through-Ball Recovery v1 (2026-08-26, Off-Ball Motion v3) --
  // see reactOffBall()'s own matching comment. `ballTo` (the flight's own
  // real destination) is what a genuine line-breaking run is judged
  // against here -- the SAME point planDefensiveRepositioning() itself
  // gets below.
  const lineBreakingRunnerId = snapshots.teammates.length
    ? identifyLineBreakingRunnerId(snapshots.teammates, snapshots.opponents, attackDirection, ballTo, snapshots.keeper)
    : null;
  let markingLookup = {};
  let defenderPlan = [];
  if (snapshots.opponents.length) {
    const defendingDirection =
      state.attackingDirection[snapshots.opponents[0].team];
    const defendingTeamMarking = markingSettingsFor(snapshots.opponents[0].team);
    defenderPlan = planDefensiveRepositioning(
      ballTo,
      snapshots.teammates,
      snapshots.opponents,
      defendingDirection,
      {
        previousMarking: motionContext?.marking || {},
        ownerId: snapshots.owner?.id ?? null,
        scheme: defendingTeamMarking.scheme,
        tightness: defendingTeamMarking.tightness,
        runnerId: lineBreakingRunnerId,
        beatenPresserId,
      },
    );
    if (heldKeeper) {
      defenderPlan = defenderPlan.map((step) => {
        const opponent = snapshots.opponents.find((entry) => entry.id === step.id);
        const target = heldKeeperStandoffTarget(
          opponent,
          step.intentionTarget ?? step.target,
          ballTo,
        );
        return {
          ...step,
          action: "respect-held-ball",
          subjectId: heldKeeper.id,
          target,
          intentionTarget: target,
        };
      });
    }
    markingLookup = syncMarkingAssignments(defenderPlan, motionContext);
  }

  if (snapshots.teammates.length || (passerId && snapshots.owner)) {
    const attackerPlan = planAttackerRepositioning(
      passerId && snapshots.owner ? [...snapshots.teammates, snapshots.owner] : snapshots.teammates,
      snapshots.opponents,
      attackDirection,
      {
        ballPoint: { ...ballTo },
        keeper: snapshots.keeper,
        previousSupportId: previousActionHolderId("support-short"),
        previousDropId: previousActionHolderId("drop-deep"),
        previousShowId: previousActionHolderId("show-to-feet"),
        markingLookup,
        ownerBand: snapshots.owner ? classifyOutfieldBand(snapshots.owner.player) : null,
        passerId,
        passDestination: passDestination ?? ballTo,
      },
    );
    for (const step of attackerPlan) {
      const attacker = step.id === snapshots.owner?.id
        ? snapshots.owner
        : snapshots.teammates.find((entry) => entry.id === step.id);
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
        // Continuous flight must chase the UNCAPPED tactical destination.
        // step.target is a per-beat 8-yard shuffle (for short reactOffBall
        // touches); stretching that 8 yards across a 2-4s pass is what
        // made every off-ball run read as slow motion.
        target: chaseIntention ? step.intentionTarget || step.target : step.target,
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
      target: chaseIntention ? step.intentionTarget || step.target : step.target,
      player: defender.player,
    });
  }

  const phaseStateAtStart = ensureTeamPhaseContext(
    motionContext, snapshots, ballFrom, ballTo,
  );
  const initialCoordination = coordinateTargetProposals({
    targets,
    snapshots,
    ballPoint: ballPointAtElapsed ? ballPointAtElapsed(0) : ballTo,
    phaseState: phaseStateAtStart,
    motionContext,
    // During a real delivery the passer is no longer a stationary ball
    // owner: their run-off-pass proposal must be free to claim a support
    // job and leave the centre spot.
    activeOwnerId: passerId ? null : snapshots.owner?.id,
    coordinationFlags: coordinationFlagsAtElapsed(0),
  });
  if (heldKeeper) {
    enforceHeldKeeperDistance(targets, snapshots.opponents, ballTo, heldKeeper.id);
  }

  const excluded = new Set(excludedIds.map(String));
  const eligible = targets.filter((entry) => !excluded.has(String(entry.id)));
  const separated = applyOffBallSeparation(eligible, [...originals.values()]);
  if (heldKeeper) {
    enforceHeldKeeperDistance(separated, snapshots.opponents, ballTo, heldKeeper.id);
  }
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

  // Re-plan inside a real motion window, not merely at its end. Long ball
  // flights get several <=500ms shape beats; every player then advances
  // through those changing targets with their current exit velocity. A
  // short post-contact nudge remains one beat and does not advance the
  // phase clock because it overlaps the producer's own interval.
  const SHAPE_REFRESH_MS = 500;
  const shapeBoundaries = [];
  if (phaseStateAtStart && chaseIntention) {
    if (initialCoordination.coordination) {
      for (let boundary = SHAPE_REFRESH_MS; boundary < effectiveTotalMs; boundary += SHAPE_REFRESH_MS) {
        shapeBoundaries.push(boundary);
      }
    } else {
      // Saved probes without authored formation relationships keep the legacy
      // capped cadence. It avoids manufacturing rapid target reversals from a
      // planner that was designed for a handful of broad flight snapshots.
      const legacyWindowCount = Math.max(1, Math.min(6, Math.ceil(effectiveTotalMs / SHAPE_REFRESH_MS)));
      for (let windowIndex = 1; windowIndex < legacyWindowCount; windowIndex += 1) {
        shapeBoundaries.push(Math.round((effectiveTotalMs * windowIndex) / legacyWindowCount));
      }
    }
  }
  for (const transfer of coordinationFlags?.claimantHandoffs?.transfers ?? []) {
    if (transfer.atMs > 0 && transfer.atMs < effectiveTotalMs) shapeBoundaries.push(transfer.atMs);
  }
  shapeBoundaries.push(effectiveTotalMs);
  const orderedBoundaries = [...new Set(shapeBoundaries.map((entry) => Math.round(entry)))]
    .filter((entry) => entry > 0)
    .sort((left, right) => left - right);
  const targetWindowsById = new Map();
  let phaseCursor = phaseStateAtStart;
  let elapsedShapeMs = 0;
  let previousBallPoint = ballFrom;
  for (const boundaryMs of orderedBoundaries) {
    const windowDurationMs = boundaryMs - elapsedShapeMs;
    const progress = effectiveTotalMs ? boundaryMs / effectiveTotalMs : 1;
    const sampledBallPoint = ballPointAtElapsed
      ? ballPointAtElapsed(boundaryMs)
      : {
          x: ballFrom.x + (ballTo.x - ballFrom.x) * progress,
          y: ballFrom.y + (ballTo.y - ballFrom.y) * progress,
        };
    const liveBallPoint = {
      ...sampledBallPoint,
      zone: sampledBallPoint.zone ?? zoneFromPercent(sampledBallPoint.x, sampledBallPoint.y),
    };
    if (phaseCursor && chaseIntention) {
      phaseCursor = updateTeamPhaseState(
        phaseCursor,
        teamPhaseFacts(snapshots, previousBallPoint, liveBallPoint, motionContext),
        windowDurationMs,
      );
    }
    const windowTargets = targets.map((target) => ({
      ...target,
      target: { ...(target.intentionTarget ?? target.target) },
      intentionTarget: { ...(target.intentionTarget ?? target.target) },
    }));
    coordinateTargetProposals({
      targets: windowTargets,
      snapshots,
      ballPoint: liveBallPoint,
      phaseState: phaseCursor,
      motionContext,
      activeOwnerId: passerId ? null : snapshots.owner?.id,
      recordSnapshot: true,
      simulationTimeMs: (motionContext?.simulationTimeMs ?? 0) + elapsedShapeMs + windowDurationMs,
      coordinationFlags: coordinationFlagsAtElapsed(boundaryMs),
    });
    if (heldKeeper) {
      enforceHeldKeeperDistance(windowTargets, snapshots.opponents, liveBallPoint, heldKeeper.id);
    }
    const eligibleWindow = windowTargets.filter((entry) => !excluded.has(String(entry.id)));
    const separatedWindow = applyOffBallSeparation(eligibleWindow, [...originals.values()]);
    if (heldKeeper) {
      enforceHeldKeeperDistance(separatedWindow, snapshots.opponents, liveBallPoint, heldKeeper.id);
    }
    for (const target of separatedWindow) {
      const windows = targetWindowsById.get(String(target.id)) || [];
      windows.push({
        durationMs: windowDurationMs,
        target: { ...target.target },
        intentionTarget: { ...(target.intentionTarget ?? target.target) },
        shapeTarget: target.shapeTarget ? { ...target.shapeTarget } : null,
        formationAnchor: target.formationAnchor ? { ...target.formationAnchor } : null,
        teamJob: target.teamJob ?? null,
        teamPhase: target.teamPhase ?? null,
        occupiedLane: target.occupiedLane ?? null,
        occupiedDepthBand: target.occupiedDepthBand ?? null,
        currentRegion: target.currentRegion ?? null,
        intendedRegion: target.intendedRegion ?? null,
        regionMove: target.regionMove ?? null,
        tacticalRole: target.tacticalRole ?? null,
        duty: target.duty ?? null,
        coordinationFamily: target.coordinationFamily ?? null,
        coordinationResponsibility: target.coordinationResponsibility ?? null,
        coordinationRelationship: target.coordinationRelationship ?? null,
        coordinationThreatId: target.coordinationThreatId ?? null,
      });
      targetWindowsById.set(String(target.id), windows);
    }
    elapsedShapeMs += windowDurationMs;
    previousBallPoint = liveBallPoint;
  }
  if (motionContext && phaseCursor) {
    motionContext.teamPhase = phaseCursor;
    if (chaseIntention) motionContext.simulationTimeMs += effectiveTotalMs;
  }

  const moves = movingEntries
    .map((entry) => {
      // entry.player is the physics-facing player-attributes object
      // (sampleContinuousTrajectory() reads Pace/Acceleration off it) --
      // NOT the roster entry traceEvent() and the commit loop below both
      // need (playerId derivation, Object.assign(move.player, move.to)).
      // originals.get(entry.id) resolves the real roster entry, same
      // lookup reactOffBall()'s own byRole() helper already does.
      // Off-Ball Motion v3 (2026-08-26) -- a real reported bug: this
      // reaction used to always start from a dead stop, even for a player
      // motionContext already knows was mid-stride a moment ago (from an
      // earlier reaction this SAME possession, or -- once the carry
      // window's own width gets capped against a short producer -- from
      // being cut off mid-run rather than genuinely arriving). Continuing
      // their real tracked velocity instead of zeroing it is what actually
      // reads as one continuous run across action boundaries; a player
      // with no tracked velocity (freshly idle, or motionContext-less test
      // fixture) still gets the honest {0,0} start via
      // sampleContinuousTrajectory()'s own default.
      let incomingVelocity = motionContext?.state?.players?.[entry.id]?.velocity ?? null;
      let cursor = entry.from;
      let elapsedMs = 0;
      const trajectory = [];
      const windows = targetWindowsById.get(String(entry.id)) || [{
        durationMs: effectiveTotalMs,
        target: entry.target,
        intentionTarget: entry.target,
        teamJob: entry.teamJob ?? null,
        teamPhase: entry.teamPhase ?? null,
        shapeTarget: entry.shapeTarget ?? null,
        formationAnchor: entry.formationAnchor ?? null,
        occupiedLane: entry.occupiedLane ?? null,
        occupiedDepthBand: entry.occupiedDepthBand ?? null,
        currentRegion: entry.currentRegion ?? null,
        intendedRegion: entry.intendedRegion ?? null,
        regionMove: entry.regionMove ?? null,
        tacticalRole: entry.tacticalRole ?? null,
        duty: entry.duty ?? null,
        coordinationFamily: entry.coordinationFamily ?? null,
        coordinationResponsibility: entry.coordinationResponsibility ?? null,
        coordinationRelationship: entry.coordinationRelationship ?? null,
        coordinationThreatId: entry.coordinationThreatId ?? null,
      }];
      // Playback Fluidity v1 (2026-09-05) -- a real reported bug: "players
      // freeze". A long producer window (a six-second keeper hold) is split
      // into SHAPE_REFRESH_MS beats so the shape can evolve as the ball
      // moves. When the ball is not moving, every one of those beats
      // resolves to the SAME tactical target -- so the player covered the
      // whole distance flat out inside the first beat or two and then stood
      // still for the rest, with each remaining beat correctly finding
      // nothing left to do. Measured on a real trace: every off-ball mover
      // finished at 33% of a 6000ms window and held for the other 4 seconds.
      //
      // Consecutive beats that share a target are not several decisions, they
      // are one. Merging them back into a single leg lets advanceMotion()
      // pace that leg across its real window (see its own CHASE_INTENTIONS
      // comment) -- a player with seven yards to cover and six seconds to do
      // it jogs, which is both what really happens and what removes the
      // stall. Beats whose target genuinely CHANGES are untouched, so a
      // reshape that responds to a moving ball still re-plans exactly as
      // before.
      const mergedWindows = [];
      for (const window of windows) {
        const previous = mergedWindows[mergedWindows.length - 1];
        const sameTarget = previous
          && Math.abs(previous.target.x - window.target.x) < 0.05
          && Math.abs(previous.target.y - window.target.y) < 0.05
          && (previous.teamJob ?? null) === (window.teamJob ?? null);
        if (sameTarget) previous.durationMs += window.durationMs;
        else mergedWindows.push({ ...window });
      }
      let previousWindowJob = motionContext?.state?.players?.[entry.id]?.teamJob ?? null;
      for (const [index, window] of mergedWindows.entries()) {
        const sameContinuingJob = previousWindowJob && previousWindowJob === window.teamJob;
        const motion = advanceMotion({
          from: cursor,
          intentionTarget: window.target,
          player: entry.player,
          elapsedMs: window.durationMs,
          incomingVelocity,
          reactionDelayMs: index === 0 && !sameContinuingJob ? (entry.reactionDelayMs ?? CONTACT_REACTION_DELAY_MS) : 0,
          sampleCount: Math.max(4, Math.min(10, Math.ceil(window.durationMs / 90))),
          intention: entry.action,
          role: window.teamJob ?? entry.role,
        });
        for (const sample of motion.trajectory) {
          const progressMs = elapsedMs + sample.progress * window.durationMs;
          if (trajectory.length && progressMs <= trajectory[trajectory.length - 1].progress * effectiveTotalMs + 0.001) continue;
          trajectory.push({ ...sample, progress: effectiveTotalMs ? progressMs / effectiveTotalMs : 1 });
        }
        cursor = motion.position;
        incomingVelocity = motion.velocity;
        previousWindowJob = window.teamJob;
        elapsedMs += window.durationMs;
      }
      const finalPosition = cursor;
      const finalWindow = windows[windows.length - 1];
      // Burst Stamina v1 -- every off-ball JOB this planner actually
      // assigns drains/refills the SAME battery an on-ball carry does
      // (drainOnBallAction()'s own matching call in the possession loop),
      // by the real distance just covered. originals.get(entry.id) is the
      // real simulatedRoster entry (has .burst01/.match01) when called
      // from the real possession loop; a no-op (no burst01 at all) for
      // any direct resolver-level test fixture, same convention as
      // drainOnBallAction() itself.
      applyBurstOffBallJob(originals.get(entry.id), entry.action, yardDistance(entry.from, finalPosition), effectiveTotalMs, entry.motion);
      return {
        id: entry.id,
        player: originals.get(entry.id),
        from: entry.from,
        to: finalPosition,
        action: entry.action,
        role: entry.role,
        intentionTarget: finalWindow.intentionTarget ?? finalWindow.target,
        formationAnchor: finalWindow.formationAnchor,
        shapeTarget: finalWindow.shapeTarget,
        teamJob: finalWindow.teamJob,
        teamPhase: finalWindow.teamPhase,
        occupiedLane: finalWindow.occupiedLane,
        occupiedDepthBand: finalWindow.occupiedDepthBand,
        currentRegion: finalWindow.currentRegion,
        intendedRegion: finalWindow.intendedRegion,
        regionMove: finalWindow.regionMove,
        tacticalRole: finalWindow.tacticalRole,
        duty: finalWindow.duty,
        coordinationFamily: finalWindow.coordinationFamily,
        coordinationResponsibility: finalWindow.coordinationResponsibility,
        coordinationRelationship: finalWindow.coordinationRelationship,
        coordinationThreatId: finalWindow.coordinationThreatId,
        velocity: incomingVelocity,
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
  let coordinationEvidenceAttached = false;
  const overlapForThisPush = () => {
    const value = sharedIntervalEstablished ? true : overlapWithPrevious;
    sharedIntervalEstablished = true;
    return value;
  };
  const coordinationForThisPush = () => {
    if (coordinationEvidenceAttached) return null;
    coordinationEvidenceAttached = true;
    return motionContext?.coordination?.latestEvidence ?? null;
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
              coordination: coordinationForThisPush(),
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
        coordination: coordinationForThisPush(),
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
          coordination: coordinationForThisPush(),
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
      // The trajectory's own final sample already carries the honest exit
      // velocity: zero when the run genuinely arrived at its destination
      // (sampleContinuousTrajectory()'s own arrived-within-0.35yd check),
      // but a real, non-zero closing velocity when this reaction's own
      // window got capped short of the real intentionTarget (e.g. a carry
      // window capped against a short producer interval) -- a player cut
      // off mid-stride, not one who calmly arrived. Handing that off
      // (2026-08-26, Off-Ball Motion v3 fix) instead of always forcing
      // zero is what lets the NEXT reaction continue their real run
      // instead of a stop-then-relaunch at every action boundary.
      const exitVelocity = move.trajectory?.[move.trajectory.length - 1]?.velocity ?? { x: 0, y: 0 };
      nextPlayers[move.id] = {
        velocity: exitVelocity,
        intention: {
          action: move.action,
          role: move.role,
          target: move.intentionTarget,
          startedTick: tick,
          age: 0,
          retained: false,
        },
        teamJob: move.teamJob,
        teamPhase: move.teamPhase,
        formationAnchor: move.formationAnchor,
        shapeTarget: move.shapeTarget,
        occupiedLane: move.occupiedLane,
        occupiedDepthBand: move.occupiedDepthBand,
        currentRegion: move.currentRegion,
        intendedRegion: move.intendedRegion,
        regionMove: move.regionMove,
        tacticalRole: move.tacticalRole,
        duty: move.duty,
        lastPosition: { ...move.to },
      };
    }
    motionContext.state = { tick, players: nextPlayers };
  }
  for (const move of moves) {
    Object.assign(move.player, move.to, { engineJob: move.teamJob ?? move.action });
    if (move.role === "keeper") move.player.keeperVelocity = move.velocity;
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
// How long a keeper who's just caught the ball holds it while the side
// settles, before picking a distribution -- a real, visible pause (not the
// instant re-decision every other reception gets), long enough for
// teammates to actually offer themselves as outlets first. Retained as the
// legacy lower bound for callers/tests; GK.HOLD now uses the maximum because
// opponent proximity is not legal pressure while the ball is in the hands.
const GK_HOLD_MS = 1400;
// Keeper Hold & Walk v1 (2026-08-31) -- a real, explicit demand: "he
// should be able to walk freely with the ball in his hands inside the
// penalty box... after 6 seconds he must release it." The real law of
// the game's own outer limit -- never exceeded regardless of how little
// pressure they're under.
const GK_HOLD_MAX_MS = 6000;
// Keeper Hold & Walk v1 -- a real short wander inside the keeper's own
// box while they decide (2-6 real yards, a stroll with the ball tucked
// under an arm, never a sprint), replacing the old single frozen-still
// hold. Deterministic (seeded, same convention as every other
// possession-loop RNG stream) so an identical seed reproduces an
// identical walk. Clamped to the real penalty area (PENALTY_AREA,
// pitchGeometry.js) -- a keeper holding the ball cannot leave their own
// box at all, a real law of the game, not just a tactical preference.
function keeperWalkTarget(keeper, ownGoalDirection, seed, actionsCount) {
  const random = seededRandom(hashString(`match-lab:freeplay:gk-hold-walk:${seed}:${actionsCount}`));
  const angle = random() * Math.PI * 2;
  const distanceYards = 2 + random() * 4;
  const rawYard = toYardPoint(keeper);
  const wandered = fromYardPoint({
    x: rawYard.x + Math.cos(angle) * distanceYards,
    y: rawYard.y + Math.sin(angle) * distanceYards,
  });
  const ownGoalY = defendingGoalYForDirection(ownGoalDirection);
  const clampedX = clamp(50 - PENALTY_AREA.halfWidthPct, 50 + PENALTY_AREA.halfWidthPct, wandered.x);
  const clampedY = ownGoalY === 0
    ? clamp(0, PENALTY_AREA.depthPct, wandered.y)
    : clamp(100 - PENALTY_AREA.depthPct, 100, wandered.y);
  return { x: clampedX, y: clampedY, zone: zoneFromPercent(clampedX, clampedY) };
}
// See reactOffBall()'s own comment on defensiveFraction -- a defender
// scrambling to recover during a live, moving passage of play closes
// ground with real urgency, not at the same measured pace as an
// attacker's own tactical off-ball positioning.
const INTERLEAVED_DEFENSIVE_REACTION_FRACTION = 0.5;

// On-ball gait + possession stamina v1 (2026-08-31) -- "readable film":
// the chosen gait (determineCarryGait(), spatialDecision.js) now shows
// up directly in the trace label, not just the touch spacing/pace
// underneath it, so a browser round can tell "sprinting into space"
// from "shepherding it under pressure" without opening the movement-
// timing detail.
function gaitActionPhrase(gait) {
  switch (gait) {
    case "full-sprint": return "sprints into space";
    case "controlled-sprint": return "drives forward under control";
    case "lateral-control": return "drives down the touchline";
    case "close-control":
    default: return "close-controls it forward";
  }
}
function gaitSetOffPhrase(gait) {
  switch (gait) {
    case "full-sprint": return "sets off at full sprint";
    case "controlled-sprint": return "sets off, pushing into space";
    case "lateral-control": return "sets off down the touchline";
    case "close-control":
    default: return "sets off, tight to the ball";
  }
}

// Burst Stamina v1 (2026-08-31) -- "Trace one line when a gait is denied
// by burst." Re-derives what the gait WOULD have been at a full tank
// (burst01=1) and compares -- the cheapest, most honest way to know
// "was burst actually the reason," since determineCarryGait() itself
// stays a pure function with no diagnostic output of its own. A cue-only
// event (no ballFrom/ballTo/duration) -- pure commentary, never disturbs
// the timeline. Silent whenever burst wasn't the deciding factor (full
// tank would have picked the SAME gait, or something no better).
function pushGaitDenialTrace(trace, owner, opponents, attackingDirection, gait, destination) {
  if (typeof owner.burst01 !== "number" || owner.burst01 >= 1) return;
  const fullTankGait = determineCarryGait(owner, opponents, attackingDirection, 1, destination);
  if (fullTankGait === gait) return;
  const rank = { "full-sprint": 3, "controlled-sprint": 2, "lateral-control": 1, "close-control": 0 };
  if ((rank[fullTankGait] ?? 0) <= (rank[gait] ?? 0)) return;
  trace.push(
    traceEvent(
      "P.CARRY.GAIT",
      `${playerName(owner.player)}: ${fullTankGait} denied (burst ${Math.round(owner.burst01 * 100)}%), ${gait}`,
      { actor: owner, movement: "reposition", outcome: "neutral" },
    ),
  );
}

// Burst Stamina v1 -- "show burst01 live" via the SAME Attribute-influence
// disclosure every other trace event already renders theirs through
// (renderTrace()'s own attributionEntryMarkup()), not a bespoke new
// widget. Reads as a real reading on every on-ball P.CARRY/P.PROGRESS.WON
// this possession produces, not just the rarer moment pushGaitDenialTrace()
// fires -- absent (never a fabricated "100%") for any direct resolver
// call against a hand-built fixture with no burst01 at all.
function burstAttribution(owner) {
  if (typeof owner?.burst01 !== "number") return undefined;
  return [{
    attr: "Stamina",
    value: Math.round(playerAttribute(owner.player, "Stamina")),
    quantity: "burst01 (this possession)",
    baseline: Math.round((owner.match01 ?? 1) * 100),
    actual: Math.round(owner.burst01 * 100),
    unit: "%",
  }];
}

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
    // On-ball gait + possession stamina v1 (2026-08-31) -- see
    // determineCarryGait()'s own header (spatialDecision.js) for the full
    // reported-bug rationale on why this is no longer a bare pressure
    // ternary. owner.burst01 is the possession-local battery
    // (runConstructedPossession()'s own init/drain, never the shared
    // player object) -- absent for a direct resolver call against a
    // hand-built fixture, which correctly reads as a full tank (?? 1).
    const attackingDirection = state.attackingDirection[owner.team];
    const gait = determineCarryGait(owner, groups.opponents, attackingDirection, owner.burst01 ?? 1, advanced);
    pushGaitDenialTrace(trace, owner, groups.opponents, attackingDirection, gait, advanced);
    const carryPressure = effectiveCarryPressure(
      pressureAt(origin, groups.opponents), owner, gait, attackingDirection,
    );
    // A fatigued carrier's own physical ceiling fades for the REST of
    // this possession (staminaScaledPlayer()'s own header) -- scoped to
    // just the trajectory-building calls below, never the shared roster
    // entry itself.
    const staminaPlayer = staminaScaledPlayer(owner.player, owner.burst01);
    const kineticOwner = staminaPlayer === owner.player ? owner : { ...owner, player: staminaPlayer };
    // Ground Roll v2 -- see spatialDecision.js's own header comment on
    // simulateCarryTouches(). Each touch is a live-simulated impulse +
    // independent roll + chase, not a pre-beaded line to `advanced`.
    const carryEntryVelocity = readMotionRecord(motionContext, owner.id, origin).velocity;
    const touches = simulateCarryTouches(origin, advanced, gait, {
      incomingVelocity: carryEntryVelocity,
      player: kineticOwner.player,
      pressure: carryPressure,
      seed: `${owner.id}:dribble:${origin.x}:${origin.y}:${advanced.x}:${advanced.y}`,
      opponents: groups.opponents,
      ignorePokes: true,
    });
    // Ball Out of Bounds v1 (2026-09-01) -- see resolveCarry()'s own
    // matching comment for the full reasoning: classifyPitchExit() is
    // computed FIRST, nothing pushed to `trace` until it genuinely
    // returns a real restart, so a missing team/attacking-direction
    // context falls through to the ordinary completion path with zero
    // risk of double-authoring the same touches.
    const dribbleExitedTouch = touches.at(-1);
    const dribblePitchExit = dribbleExitedTouch?.exitedPitch
      ? classifyPitchExit({
          exit: dribbleExitedTouch.exitedPitch,
          lastTouchTeam: owner.team,
          attackingDirectionByTeam: state.attackingDirection,
        })
      : null;
    if (dribblePitchExit) {
      const priorTouches = touches.slice(0, -1);
      const priorSpanMs = priorTouches.reduce((sum, touch) => sum + touch.durationMs, 0);
      const exitTotalMs = interleaveOffBall ? priorSpanMs + dribbleExitedTouch.durationMs : 0;
      if (interleaveOffBall) {
        trace.push(
          traceEvent(
            "P.PROGRESS.START",
            `${playerName(owner.player)} goes at ${playerName(defender.player)}`,
            { actor: owner, defender, movement: "dribble", outcome: "neutral", duration: exitTotalMs },
          ),
        );
      }
      let exitCursor = origin;
      priorTouches.forEach((touch) => {
        const to = { ...touch.ballTo, zone: zoneFromPercent(touch.ballTo.x, touch.ballTo.y) };
        trace.push(
          traceEvent(
            "P.PROGRESS.TOUCH",
            `${playerName(owner.player)} touches it past ${playerName(defender.player)}`,
            {
              actor: owner,
              defender,
              playerMoves: [{ player: owner, from: exitCursor, to, action: "touch", trajectory: touch.chaseTrajectory }],
              movement: "touch",
              outcome: "success",
              ballFrom: exitCursor,
              ballTo: to,
              ballTrajectory: touch.ballTrajectory,
              duration: touch.durationMs,
              contact: { point: to, actor: owner, type: "touch", phase: "end" },
              ownerBefore: owner,
              ownerAfter: owner,
              attribution: touch.kinetics?.attribution,
              ...(interleaveOffBall ? { overlapWithPrevious: true, overlapStartOffsetMs: touch.startOffsetMs } : null),
            },
          ),
        );
        exitCursor = to;
      });
      const exitTo = { ...dribbleExitedTouch.ballTo, zone: zoneFromPercent(dribbleExitedTouch.ballTo.x, dribbleExitedTouch.ballTo.y) };
      const restartResult = pushPitchExitRestart(trace, {
        actor: owner, ballFrom: exitCursor, exit: dribblePitchExit, movement: "touch",
        playerMoves: [{ player: owner, from: exitCursor, to: exitTo, action: "touch", trajectory: dribbleExitedTouch.chaseTrajectory }],
        ballTrajectory: dribbleExitedTouch.ballTrajectory,
        ...(interleaveOffBall ? { overlapWithPrevious: true, overlapStartOffsetMs: priorSpanMs } : null),
      });
      return { ...restartResult, gait, offBallInterleaved: false };
    }
    // Gameplay v3.1 -- see resolveCarry()'s own matching comment ("Fix
    // the event clock, not hermite"). P.PROGRESS.START owns ONE wide
    // primary interval spanning the real total window up front; every
    // touch and the final P.PROGRESS.WON then overlap INTO it (their own
    // real spacing preserved via overlapStartOffsetMs) instead of each
    // claiming its own fresh slot -- otherwise the off-ball reaction
    // below can only ever reach back to the LAST touch, never the whole
    // carry. Deliberately a NEW marker, not the existing P.PROGRESS event
    // above -- that one's ballFrom===ballTo (stationary) would otherwise
    // add a redundant, conflicting "ball sits still" trajectory spanning
    // the SAME window the touches are genuinely moving the ball through.
    // Ground Roll v1 -- real per-touch roll-to-a-stop timing
    // (simulateCarryTouches()'s own durationMs, ballRollPhysics.js), not a
    // flat MOVEMENT_DURATIONS.touch per touch regardless of distance.
    const progressTouchSpanMs = touches.reduce((sum, touch) => sum + touch.durationMs, 0);
    let progressTotalMs = interleaveOffBall
      ? Math.max(
          carryWindowDurationMs(owner, origin, advanced),
          progressTouchSpanMs + MOVEMENT_DURATIONS.dribble,
        )
      : 0;
    if (interleaveOffBall) {
      trace.push(
        traceEvent(
          "P.PROGRESS.START",
          `${playerName(owner.player)} goes at ${playerName(defender.player)}`,
          { actor: owner, defender, movement: "dribble", outcome: "neutral", duration: progressTotalMs },
        ),
      );
    }
    let cursor = origin;
    touches.forEach((touch) => {
      const to = { ...touch.ballTo, zone: zoneFromPercent(touch.ballTo.x, touch.ballTo.y) };
      trace.push(
        traceEvent(
          "P.PROGRESS.TOUCH",
          `${playerName(owner.player)} touches it past ${playerName(defender.player)}`,
          {
            actor: owner,
            defender,
            // Ground Roll v2 -- the owner's own CHASE, not the ball's
            // path: a real accelerating run behind an independently
            // decelerating ball, sharing only its start/contact points
            // with ballFrom/ballTo, never its shape.
            playerMoves: [{ player: owner, from: cursor, to, action: "touch", trajectory: touch.chaseTrajectory }],
            movement: "touch",
            outcome: "success",
            ballFrom: cursor,
            ballTo: to,
            // Explicit, physically-real ball trajectory (mode "rolling")
            // in place of buildBallTrajectory()'s own generic
            // "touch"->controlled-ground curve -- that mapping is what
            // parented the ball to the owner's own dot every previous
            // pass at this. This ball has left the foot; it is not
            // controlled again until the contact below.
            ballTrajectory: touch.ballTrajectory,
            duration: touch.durationMs,
            // Contact happens at ARRIVAL (the carrier closing the gap on
            // their own rolling touch), not at the kick instant.
            contact: {
              point: to,
              actor: owner,
              type: "touch",
              phase: "end",
            },
            ownerBefore: owner,
            ownerAfter: owner,
            attribution: touch.kinetics?.attribution,
            ...(interleaveOffBall
              ? { overlapWithPrevious: true, overlapStartOffsetMs: touch.startOffsetMs }
              : null),
          },
        ),
      );
      cursor = to;
      // Off-Ball Motion v3 (2026-08-26) -- see this file's own reported-bug
      // comment: a per-touch reactOffBall() call here (the old beat model)
      // meant off-ball players got a full fresh re-plan + a velocity reset
      // to zero every ~220ms, "go-stop-go" for the whole carry. ONE
      // reactOffBallContinuous() call now covers the WHOLE window instead
      // -- see just below, after the touches loop.
    });
    acceptCarryOvershoot(origin, advanced, touches);
    const progressWonMove = carryLegMoverTrajectory(kineticOwner, advanced, groups.opponents, {
      from: cursor, floorMs: MOVEMENT_DURATIONS.dribble,
      // World Motion Contract v1 -- continue the run the touches above
      // were already making, instead of restarting from a standstill.
      entrySpeedYps: touches.at(-1)?.exitSpeedYps ?? speedYpsFromVelocity(carryEntryVelocity),
      entryVelocity: touches.at(-1)?.chaseTrajectory?.at(-1)?.velocity ?? carryEntryVelocity,
    });
    if (interleaveOffBall) {
      // The reservation must end with the actual run. The preliminary
      // estimate includes a fixed dribble beat and acceleration from rest;
      // retaining it makes a moving striker wait before the next shot.
      progressTotalMs = progressTouchSpanMs + progressWonMove.duration;
      const reservation = [...trace].reverse().find(event => event.code === "P.PROGRESS.START");
      reservation.duration = progressTotalMs;
    }
    trace.push(
      traceEvent(
        "P.PROGRESS.WON",
        `${playerName(owner.player)} beats ${playerName(defender.player)} and ${gaitActionPhrase(gait)}`,
        // The carrier moves WITH the ball to its real endpoint (explicit,
        // not inferred from ballFrom/ballTo -- see traceEvent()'s own
        // comment on why shots/passes must never be read this way).
        {
          actor: owner,
          defender,
          ...progressWonMove,
          // Ground Roll v2 follow-up -- the ball's own track mirrors the
          // carrier's real (hermite) path instead of an independently
          // shaped curve; see carryLegBallTrajectory()'s own comment.
          ballTrajectory: carryLegBallTrajectory(progressWonMove.playerMoves[0].trajectory, cursor, advanced),
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
          attribution: burstAttribution(owner),
          ...(interleaveOffBall
            ? { overlapWithPrevious: true, overlapStartOffsetMs: progressTouchSpanMs }
            : null),
        },
      ),
    );
    // ONE continuous off-ball reaction spanning the WHOLE carry window
    // (origin to `advanced`, not touch to touch) -- overlaps the carry's
    // own just-pushed events (whichever is the most recent primary
    // interval on the timeline: the final P.PROGRESS.WON leg for a
    // multi-touch beat, or the SAME event for a distance too short to
    // subdivide into touches at all), chasing the real, uncapped
    // intentionTarget over that real window instead of an 8-yard-capped
    // shuffle repeated on every touch.
    if (interleaveOffBall) {
      reactOffBallContinuous(
        groups, origin, advanced,
        progressTotalMs,
        trace,
        {
          motionContext, excludedIds: [owner.id], overlapWithPrevious: true, chaseIntention: true,
          // Progression Contest v1 -- this branch's own off-ball reaction
          // is the ONLY one that ever runs for a clean P.PROGRESS.WON
          // (offBallInterleaved below skips the generic post-action
          // reshape entirely), so the beaten defender's own cover-shadow
          // must be threaded in here directly.
          beatenPresserId: defender.id,
        },
      );
    }
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
      beatenDefenderId: defender.id,
      gait,
      // Off-Ball Motion v3 -- the WHOLE window already got ONE continuous
      // off-ball reaction just above; runConstructedPossession()'s own
      // post-action convergence must not run a SECOND one on top (a fresh
      // trajectory, velocity reset to zero) for players already mid-run.
      offBallInterleaved: interleaveOffBall,
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
  const feasibleEngagementType =
    rawEngagementType === "D.STAND" && !canStandingTackle(owner, defender)
      ? canSlidingTackle(owner, defender)
        ? "D.SLIDE"
        : "D.DUEL"
      : rawEngagementType === "D.SLIDE" && !canSlidingTackle(owner, defender)
        ? "D.DUEL"
        : rawEngagementType;
  const engagementType = applyTacklingInstruction(
    feasibleEngagementType,
    markingSettingsFor(defender.team).tackling,
    {
      canStand: canStandingTackle(owner, defender),
      canSlide: canSlidingTackle(owner, defender),
    },
  );
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
      ...realMoverTrajectory(defender, reaction.contactPoint, { action: "challenge" }),
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
    // Engagement Breaker v1 -- both the winner (WITH the ball) and the
    // loser (left behind) get a real, Pace-timed escape trajectory; see
    // duelReaction()'s own header for the reported-bug rationale. "loose"
    // has no winner/loser position to author -- only the ball's own real
    // knock-on pop, unchanged from a single ballFrom/ballTo leg.
    // Playback Fluidity v1 (2026-09-05) -- every contest outcome authors
    // real bodies moving, including the ones nobody wins. `reaction.separation`
    // is the physical fact and is present for all of them; winner/loser stay
    // the POSSESSION fact. Previously only a won/beaten outcome moved anybody,
    // so a knocked-loose challenge froze both players for the whole window.
    const separationPairs = reaction.separation
      ?? (reaction.winner && reaction.loser
        ? [
          { player: reaction.winner, point: reaction.winnerPoint, action: "escape" },
          { player: reaction.loser, point: reaction.loserPoint, action: "beaten" },
        ]
        : null);
    let separationMoves = null;
    let separationDurationMs = MOVEMENT_DURATIONS.deflection;
    if (separationPairs) {
      const leadPlayer = separationPairs[0];
      separationDurationMs = Math.max(
        MOVEMENT_DURATIONS.deflection,
        Math.round(CONTACT_REACTION_DELAY_MS + timeToReach(leadPlayer.player.player, yardDistance(reaction.contactPoint, leadPlayer.point)) * 1000),
      );
      separationMoves = separationPairs.map((pair) => ({
        player: pair.player,
        from: reaction.contactPoint,
        to: pair.point,
        action: pair.action,
        trajectory: sampleContinuousTrajectory({
          from: reaction.contactPoint, to: pair.point, player: pair.player.player,
          totalMs: separationDurationMs, reactionDelayMs: CONTACT_REACTION_DELAY_MS,
          sampleCount: Math.max(6, Math.min(14, Math.ceil(separationDurationMs / 140))),
        }),
      }));
    }
    trace.push(
      traceEvent(reaction.code, reaction.label, {
        actor: touchActor,
        duration: separationDurationMs,
        ...(separationMoves ? { playerMoves: separationMoves } : null),
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
    const advantagePlayed = foul.restart === "none";
    let advantageMotion = null;
    let advantageDefenderMotion = null;
    let advantageDefenderTarget = null;
    if (advantagePlayed) {
      advantageMotion = shieldRetentionMotion(owner, defender, groups.opponents, reaction.contactPoint, motionContext);
      const contactYards = toYardPoint(reaction.contactPoint);
      const ownerEndYards = toYardPoint(advantageMotion.position);
      const awayX = contactYards.x - ownerEndYards.x;
      const awayY = contactYards.y - ownerEndYards.y;
      const awayLength = Math.hypot(awayX, awayY) || 1;
      advantageDefenderTarget = fromYardPoint({
        x: reflectIntoRange(contactYards.x + (awayX / awayLength) * 1.1, 0, PITCH_WIDTH_YARDS),
        y: reflectIntoRange(contactYards.y + (awayY / awayLength) * 1.1, 0, PITCH_LENGTH_YARDS),
      });
      advantageDefenderMotion = advanceMotion({
        from: reaction.contactPoint,
        intentionTarget: advantageDefenderTarget,
        player: defender.player,
        elapsedMs: advantageMotion.duration,
        reactionDelayMs: 0,
        intention: "recover-after-foul",
        continuesAfter: true,
        sampleCount: 7,
      });
    }
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
          ballTo: advantageMotion?.position ?? reaction.contactPoint,
          ...(advantageMotion ? {
            duration: advantageMotion.duration,
            playerMoves: [
              {
                player: owner, from: reaction.contactPoint, to: advantageMotion.position,
                action: "play-advantage", trajectory: advantageMotion.trajectory,
                intention: { action: "play-advantage", target: advantageMotion.intentionTarget },
                reactionDelayMs: 0,
              },
              {
                player: defender, from: reaction.contactPoint, to: advantageDefenderMotion.position,
                action: "recover-after-foul", trajectory: advantageDefenderMotion.trajectory,
                intention: { action: "recover-after-foul", target: advantageDefenderTarget },
                reactionDelayMs: 0,
              },
            ],
          } : null),
          ownerBefore: owner,
          ownerAfter: advantagePlayed ? owner : null,
          ownerAfterAt: "end",
          restart: advantagePlayed ? null : foul.restart,
        },
      ),
    );
    // Advantage played (foul.restart === "none") means the ref waved play
    // on -- the fouled side genuinely keeps the ball, this is a
    // CONTINUATION, not a stoppage. Only a real restart (penalty/
    // free-kick) is terminal/dead.
    return {
      outcome: `FOUL/${foul.card.toUpperCase()}`,
      code: `CARD.${foul.card.toUpperCase()}`,
      resolved: true,
      terminal: !advantagePlayed,
      possession: advantagePlayed ? "retained" : "dead",
      nextOwnerId: advantagePlayed ? owner.id : null,
      ballEnd: advantagePlayed ? advantageMotion.position : reaction.contactPoint,
      restart: advantagePlayed ? null : foul.restart,
      restartTakingTeam: owner.team,
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
    // Progression Contest v1 -- only a genuine "beaten" outcome (the
    // attacker escapes despite losing the earlier progression duel,
    // T.BEATEN.ESCAPE) leaves a specific defender behind the play; "won"
    // is the DEFENDER winning (no beaten body to cover for), "loose" has
    // no clear beaten party. No offBallInterleaved field on this return
    // at all, so runConstructedPossession()'s generic post-action
    // reshape always reads this back.
    beatenDefenderId: engagement.outcome === "beaten" ? defender.id : null,
  };
}

function oneOnOneTargetPoint(shooter, execution) {
  // Shot As Projectile v1 -- place-*/blast/shoot-early now carry a REAL
  // geometric point (shot.actualPoint, from resolveOneOnOneShotDescriptor())
  // via executeGeometricOneOnOneShot() -- used directly when present.
  // The fixed "near a post or dead center" 3-way fallback below is what
  // chip/round-keeper/square-pass still produce (unchanged, deferred).
  if (execution?.shot?.actualPoint) return execution.shot.actualPoint;
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
    defenderPressure: clamp(0, 1, context.defenderPressure + (context.actualKeeperState.pressure ?? 0)),
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
        distanceToGoalMetres: context.distanceYards * 0.9144,
        shotAngleDegrees: context.shotAngleDegrees,
        defenderPressure: context.defenderPressure,
      },
    },
  ));

  const ballResult = execution.ballResult;
  const offTarget = ballResult === "wide" || ballResult === "over";
  const shotFlight = execution.shot?.flight;
  const saveEnvelope = execution.shot?.keeperEnvelope;
  const shotDuration = shotFlight
    ? (saveEnvelope?.reached ? saveEnvelope.atMs : shotFlight.durationMs) : null;
  const keeperMotion = shotFlight ? advanceKeeperSaveMotion({
    from: pointOf(keeper), intentionTarget: shotFlight.actual, player: keeper.player,
    elapsedMs: shotDuration, reactionDelayMs: reactionDelayMsFor(keeper.player),
    intention: "intercept", paceToArrival: false,
  }) : null;
  const keeperBodyPoint = keeperMotion?.position ?? pointOf(keeper);
  const aimPoint = shotFlight ? shotPositionAtElapsed(shotFlight, shotDuration) : offTarget
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
      ...(shotFlight ? { duration: shotDuration,
        playerMoves: [{ player: keeper, from: pointOf(keeper), to: keeperBodyPoint,
          action: "intercept", trajectory: keeperMotion.trajectory,
          motionModel: keeperMotion.motionModel, reactionDelayMs: keeperMotion.reactionDelayMs }],
        ballTrajectory: Array.from({ length: 13 }, (_, index) => ({
          progress: index / 12, position: shotPositionAtElapsed(shotFlight, shotDuration * index / 12),
          velocity: { x: (shotFlight.actual.x - shotFlight.from.x) / shotFlight.durationMs,
            y: (shotFlight.actual.y - shotFlight.from.y) / shotFlight.durationMs },
          mode: "airborne",
        })),
      } : {}),
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
  if (ballResult === "rebound-in-play" || ballResult === "post-rebound") {
    const physicalSave = { code: execution.code, physicsCode: ballResult === "post-rebound" ? "K.SAVE.6" : "K.SAVE.2" };
    pushPhysicalReboundEvent(trace, { shooterEntry: shooter, keeperEntry: { ...keeper, ...keeperBodyPoint },
      save: physicalSave, contactPoint: aimPoint });
    return physicalSave.reboundTransition;
  }
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
  if (keeperMotion && keeperContact && ballResult === "held") {
    endpoint = keeperBodyPoint;
    segments = [aimPoint, endpoint];
  }
  const legacyRecoveryMotion = keeperContact && !keeperMotion
    ? realMoverTrajectory(keeper, aimPoint, { action: "recover" }) : null;
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
      ...(legacyRecoveryMotion ?? {}),
      ...(legacyRecoveryMotion ? { contactTiming: "sequential" } : {}),
      ...(keeperMotion && keeperContact ? { duration: 120 } : {}),
      contact: keeperContact ? {
        point: aimPoint,
        ...(keeperMotion ? { bodyPoint: keeperBodyPoint,
          reachAllowanceYards: KEEPER_DIVE_ARM_YARDS + jumpReachYards(keeper.player) } : {}),
        actor: keeper,
        type: execution.keeperAction,
        phase: legacyRecoveryMotion ? "end" : "start",
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

// Gameplay v3 (2026-08-28) -- shared core for "resolve one geometric shot
// attempt from wherever this shooter's own entry says they are right
// now," reused by resolveShoot()'s own initial attempt AND by its
// rebound follow-up below ("Rebound = bounce vector + existing loose
// live race... If someone is actually there, they can shoot through
// this same path" -- not reboundShotChance as a second, separate
// scorer). Returns the raw pieces (descriptor + geometric keeper
// outcome, or save:null for a genuinely off-target attempt) -- callers
// push their OWN trace events, since an initial attempt and a scrambled
// rebound narrate very differently.
function resolveGeometricShotAttempt(shooterEntry, keeperEntry, finishType, pressure, random) {
  const descriptor = resolveShotDescriptor(shooterEntry, keeperEntry, finishType, pressure, random);
  if (!descriptor.onTarget) return { descriptor, save: null };
  if (!keeperEntry) return { descriptor, save: { code: "K.SAVE.0", goal: true, rebound: false } };
  const keeperEnvelope = simulateShotKeeperEnvelope(descriptor.flight, keeperEntry);
  const save = keeperEnvelope.reached
    ? geometricKeeperSaveFlavor(keeperEntry.player, finishType, random)
    : { code: "K.SAVE.0", goal: true, rebound: false };
  return { descriptor, save };
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
  // Bugfix (2026-09-03) -- see selectFinishType()'s own header. A covering
  // defender merely "holding the lane" (outside DUEL_RANGE_YARDS) drops
  // pressure to a near-zero flat default with zero regard for how tight
  // the actual angle is -- this is what makes the real geometry matter.
  const shotAngle = shotAngleTightness(owner, state.attackingDirection[owner.team]);
  const finishType = selectFinishType(owner.player, random, pressure, shotAngle);
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
  // Shot As Projectile v1 (2026-08-27) -- see this file's own
  // resolveShotDescriptor() header comment. Replaces the old two-roll
  // pipeline (resolveFinishAttempt()'s "is it on target," then
  // resolveShotBlock()'s "does a defender get a body on it") with one
  // genuine geometric point, computed ONCE and reused for every
  // downstream reference (on-target event, block's own ballFrom, save's
  // own contact point) -- same "never re-drawn per call site" contract
  // Shot Placement v1 already established for shotAimPoint below.
  const descriptor = resolveShotDescriptor(owner, keeper, finishType, pressure, random);
  const onTargetCode = `F.${finishType.toUpperCase()}`;
  const miss = descriptor.onTarget
    ? null
    : missPointFor(owner, keeper, strikeMechanics, descriptor.missCode);
  const shotKeeperEnvelope = keeper && !isKeeperBeaten(owner, keeper)
    ? simulateShotKeeperEnvelope(descriptor.flight, keeper) : { reached: false };
  const firstBlock = descriptor.onTarget && defender ? shotBlockingDefender(descriptor.flight, defender) : null;
  const shotEndMs = descriptor.onTarget
    ? firstBlock?.atMs ?? (shotKeeperEnvelope.reached ? shotKeeperEnvelope.atMs : descriptor.flight.durationMs)
    : descriptor.flight.durationMs;
  const shotAimPoint = descriptor.onTarget ? shotPositionAtElapsed(descriptor.flight, shotEndMs) : null;
  const keeperMotion = descriptor.onTarget && keeper ? advanceKeeperSaveMotion({
    from: pointOf(keeper), intentionTarget: descriptor.actualPoint, player: keeper.player,
    elapsedMs: shotEndMs, reactionDelayMs: reactionDelayMsFor(keeper.player),
    intention: "intercept", paceToArrival: false,
  }) : null;
  const keeperAtContact = keeperMotion ? { ...keeper, ...keeperMotion.position } : keeper;
  trace.push(
    traceEvent(descriptor.onTarget ? onTargetCode : descriptor.missCode, descriptor.onTarget ? "On target" : "Off target", {
      actor: owner,
      keeper,
      movement: "shot",
      duration: shotEndMs,
      playerMoves: keeperMotion ? [{ player: keeper, from: pointOf(keeper), to: keeperMotion.position,
        action: "intercept", trajectory: keeperMotion.trajectory,
        motionModel: keeperMotion.motionModel, reactionDelayMs: reactionDelayMsFor(keeper.player), intention: { action: "intercept", target: descriptor.actualPoint } }] : null,
      ballTrajectory: descriptor.onTarget ? Array.from({ length: 13 }, (_, index) => {
        const progress = index / 12;
        return { progress, position: shotPositionAtElapsed(descriptor.flight, progress * shotEndMs),
          velocity: { x: (descriptor.flight.actual.x - descriptor.flight.from.x) / descriptor.flight.durationMs,
            y: (descriptor.flight.actual.y - descriptor.flight.from.y) / descriptor.flight.durationMs },
          verticalVelocity: 2 * descriptor.actualHeightYards * progress * shotEndMs / descriptor.flight.durationMs ** 2,
          mode: "airborne" };
      }) : undefined,
      outcome: descriptor.onTarget ? "success" : "fail",
      ballFrom: pointOf(owner),
      ballTo: descriptor.onTarget ? shotAimPoint : miss.point,
      contact: {
        point: pointOf(owner),
        actor: owner,
        type: "shot",
        phase: "start",
      },
      ownerBefore: owner,
      ownerAfter: null,
      badge: descriptor.onTarget ? null : miss.badge,
      heightCue: descriptor.onTarget ? false : miss.heightCue,
      ...strikeMechanics,
    }),
  );
  if (!descriptor.onTarget) {
    return {
      outcome: "NO GOAL",
      code: descriptor.missCode,
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
    const blockContact = shotBlockingDefender(descriptor.flight, defender);
    const block = blockContact
      ? { blocked: true, outcome: geometricBlockOutcome(random), code: "D.BLOCK" }
      : { blocked: false };
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
  // Shot As Projectile v1 -- geometry decides whether the keeper ever
  // gets there at all (simulateShotKeeperEnvelope(), the shot-side twin
  // of Slice A's own simulateFlightUntilContact()); if travel time
  // exceeds the flight's own remaining time at every tick, this is a
  // structural K.SAVE.0 (clean, no-touch beaten goal) regardless of
  // Reflexes -- attributes only ever decide the FLAVOR of a save the
  // keeper's own body genuinely reached (geometricKeeperSaveFlavor()).
  const keeperEnvelope = shotKeeperEnvelope;
  const save = keeperEnvelope.reached
    ? geometricKeeperSaveFlavor(keeper.player, finishType, random)
    : { code: "K.SAVE.0", goal: true, rebound: false };
  const saveEndpoint = pushKeeperSaveEvent(trace, {
    shooterEntry: owner,
    keeperEntry: keeperAtContact,
    keeperContactResolved: true,
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
  if (save.reboundTransition || !save.rebound) {
    return keeperSaveTransition(save, keeper, saveEndpoint, "shot");
  }
  if (!defender) {
    // Gameplay v3 -- "Rebound = bounce vector + existing loose live race
    // (not reboundShotChance as scorer). If someone is actually there,
    // they can shoot through this same path." Reuses the SAME
    // bounce+race primitives Passing v3's own bounce-on-failed-control
    // mechanic established (looseBallBouncePoint/looseBallFlightMs/
    // looseBallRaceContact) instead of a flat probability deciding
    // whether an "unchallenged" rebound goes in -- and races the REAL
    // full opponent list, not just whoever was already marking the
    // original shot (engagingOpponent()'s own DUEL_RANGE_YARDS check,
    // which is exactly why `defender` is null here even when other
    // opponents genuinely exist further out): a spilled ball off a save
    // is a genuinely fresh contest, not still scoped to the original
    // shot's own marker.
    const bouncePoint = looseBallBouncePoint(saveEndpoint, pointOf(owner), random);
    // Ball Out of Bounds v1 -- see resolveLooseBallBounce()'s own matching
    // comment. The keeper's own parry is the last touch here, not the
    // shooter -- a rebound pushed behind is a corner, exactly like any
    // other save sent behind for one.
    const reboundPitchExit = classifyPitchExit({
      from: saveEndpoint, to: bouncePoint, lastTouchTeam: keeper.team, attackingDirectionByTeam: state.attackingDirection,
    });
    if (reboundPitchExit) {
      return pushPitchExitRestart(trace, {
        actor: keeper, ballFrom: saveEndpoint, exit: reboundPitchExit, movement: "clearance",
        contact: { point: saveEndpoint, actor: keeper, type: "parry", phase: "start" },
      });
    }
    const bounceDurationMs = looseBallFlightMs(yardDistance(saveEndpoint, bouncePoint));
    const raceContact = looseBallRaceContact(owner, saveEndpoint, bouncePoint, bounceDurationMs, groups);
    if (!raceContact) {
      trace.push(
        traceEvent(
          "REBOUND.LOOSE",
          "The rebound spills loose, unchallenged",
          {
            actor: owner,
            keeper,
            movement: "rebound-shot",
            outcome: "loose",
            ballFrom: saveEndpoint,
            ballTo: bouncePoint,
            duration: bounceDurationMs,
            contact: { point: saveEndpoint, actor: owner, type: "rebound-shot", phase: "start" },
            ownerBefore: owner,
            ownerAfter: null,
          },
        ),
      );
      return {
        outcome: "NO GOAL",
        code: "REBOUND.LOOSE",
        resolved: true,
        terminal: true,
        possession: "loose",
        nextOwnerId: null,
        ballEnd: bouncePoint,
        restart: null,
        reason: "rebound-loose-uncontested",
      };
    }
    const winner = raceContact.candidate;
    if (winner.id !== owner.id) {
      // A genuinely different body reached the loose ball first -- a
      // real turnover, not a miss.
      trace.push(
        traceEvent(
          "REBOUND.LOST",
          `${playerName(winner.player)} beats ${playerName(owner.player)} to the rebound`,
          {
            actor: winner,
            defender: owner,
            movement: "rebound-shot",
            outcome: "turnover",
            playerMoves: [{ player: winner, from: pointOf(winner), to: raceContact.atPoint, action: "recover-loose-ball" }],
            ballFrom: saveEndpoint,
            ballTo: raceContact.atPoint,
            duration: raceContact.atMs,
            contact: { point: raceContact.atPoint, actor: winner, type: "recovery", phase: "end" },
            ownerBefore: null,
            ownerAfter: winner,
          },
        ),
      );
      return {
        outcome: "NO GOAL",
        code: "REBOUND.LOST",
        resolved: true,
        terminal: true,
        possession: "turnover",
        nextOwnerId: winner.id,
        ballEnd: raceContact.atPoint,
        restart: null,
        reason: "rebound-lost",
      };
    }
    // The shooter themselves gets there first -- a real follow-up shot
    // from the rebound spot, through the SAME geometric mouth tick
    // every other migrated attempt uses (resolveGeometricShotAttempt()),
    // never reboundShotChance as a second, separate scorer.
    trace.push(
      traceEvent(
        "REBOUND.WON",
        `${playerName(owner.player)} reacts first to the loose ball`,
        {
          actor: owner,
          keeper,
          movement: "rebound-shot",
          outcome: "success",
          // realMoverTrajectory()'s own `from` must be the SHOOTER's real
          // last authored position (matching what looseBallRaceContact()
          // itself already raced from -- earliestReachableContact() judges
          // every candidate, owner included, from their own entry
          // position, never saveEndpoint), not the ball's own save/parry
          // point -- those two are close but rarely identical, and the
          // gap is exactly a continuity-chain break (a player who last
          // authored a move ending at their own real spot cannot have
          // this next one silently start from the ball's spot instead).
          ...realMoverTrajectory(owner, raceContact.atPoint, { from: pointOf(owner), floorMs: MOVEMENT_DURATIONS["rebound-shot"] }),
          ballFrom: saveEndpoint,
          ballTo: raceContact.atPoint,
          duration: raceContact.atMs,
          contact: { point: raceContact.atPoint, actor: owner, type: "control", phase: "start" },
          ownerBefore: null,
          ownerAfter: owner,
        },
      ),
    );
    const reboundOwnerEntry = {
      ...owner,
      x: raceContact.atPoint.x,
      y: raceContact.atPoint.y,
      zone: raceContact.atPoint.zone,
    };
    const reboundAttempt = resolveGeometricShotAttempt(reboundOwnerEntry, keeper, finishType, REBOUND_SHOT_PRESSURE, random);
    if (!reboundAttempt.save) {
      const reboundMiss = missPointFor(reboundOwnerEntry, keeper, null, reboundAttempt.descriptor.missCode);
      trace.push(
        traceEvent(reboundAttempt.descriptor.missCode, "The rebound effort goes off target", {
          actor: reboundOwnerEntry,
          keeper,
          movement: "shot",
          outcome: "fail",
          ballFrom: raceContact.atPoint,
          ballTo: reboundMiss.point,
          badge: reboundMiss.badge,
          heightCue: reboundMiss.heightCue,
          contact: { point: raceContact.atPoint, actor: reboundOwnerEntry, type: "shot", phase: "start" },
          ownerBefore: reboundOwnerEntry,
          ownerAfter: null,
        }),
      );
      return {
        outcome: "NO GOAL",
        code: reboundAttempt.descriptor.missCode,
        resolved: true,
        terminal: true,
        possession: "dead",
        nextOwnerId: null,
        ballEnd: reboundMiss.point,
        restart: "goal-kick",
        reason: "rebound-shot-off-target",
      };
    }
    const reboundSaveEndpoint = pushKeeperSaveEvent(trace, {
      shooterEntry: reboundOwnerEntry,
      keeperEntry: keeper,
      save: reboundAttempt.save,
      contactPoint: reboundAttempt.descriptor.actualPoint,
    });
    if (reboundAttempt.save.goal) {
      return {
        outcome: "GOAL",
        code: reboundAttempt.save.code,
        resolved: true,
        terminal: true,
        possession: "dead",
        nextOwnerId: null,
        ballEnd: reboundSaveEndpoint,
        restart: "kickoff",
        reason: "rebound-shot-goal",
      };
    }
    return keeperSaveTransition(reboundAttempt.save, keeper, reboundSaveEndpoint, "rebound-shot");
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
  // Progression Contest v1 (2026-08-28) -- the OTHER beaten-presser
  // trigger this feature names, distinct from an actual duel/shield win:
  // an open carry with nobody in contest range at all can still leave
  // whoever WAS marking the owner at the start of it a real distance
  // behind the ball's own new position. Captured before any poke check
  // below might return early (a poked carry is a turnover, not a beaten
  // defender -- nothing to cover for there).
  const originEngager = engagingOpponent(pointOf(owner), groups.opponents);
  const origin = pointOf(owner);
  // Directional continuity -- see planCarryDestination()'s own comment.
  // Real possession-loop carries only (interleaveOffBall gates every
  // roster write this file makes, same convention as everywhere else) --
  // a direct resolver call against a hand-built test fixture must never
  // pick up this side effect either.
  if (interleaveOffBall) recordCarryDirection(owner, origin, advanced);
  // On-ball gait + possession stamina v1 (2026-08-31) -- see
  // determineCarryGait()'s own header (spatialDecision.js) for the full
  // reported-bug rationale. owner.burst01 is the possession-local
  // battery (runConstructedPossession()'s own init/drain, never the
  // shared player object) -- absent for a direct resolver call against a
  // hand-built fixture, which correctly reads as a full tank (?? 1).
  const attackingDirection = state.attackingDirection[owner.team];
  const gait = determineCarryGait(owner, groups.opponents, attackingDirection, owner.burst01 ?? 1, advanced);
  pushGaitDenialTrace(trace, owner, groups.opponents, attackingDirection, gait, advanced);
  const carryPressure = effectiveCarryPressure(
    pressureAt(origin, groups.opponents), owner, gait, attackingDirection,
  );
  // A fatigued carrier's own physical ceiling fades for the REST of this
  // possession (staminaScaledPlayer()'s own header) -- scoped to just
  // the trajectory-building calls below, never the shared roster entry.
  const staminaPlayer = staminaScaledPlayer(owner.player, owner.burst01);
  const kineticOwner = staminaPlayer === owner.player ? owner : { ...owner, player: staminaPlayer };
  // Ground Roll v2 -- see resolveDribble()'s own matching comment and
  // spatialDecision.js's simulateCarryTouches() header.
  const carryEntryVelocity = readMotionRecord(motionContext, owner.id, origin).velocity;
  let touches = simulateCarryTouches(origin, advanced, gait, {
    incomingVelocity: carryEntryVelocity,
    player: kineticOwner.player,
    pressure: carryPressure,
    seed: `${owner.id}:carry:${origin.x}:${origin.y}:${advanced.x}:${advanced.y}`,
    opponents: groups.opponents,
  });
  // Progression Contest v1 (2026-08-28) -- a real reported bug: "carry is
  // not a contest... 10 yards of immune rolling" -- simulateCarryTouches()
  // now flags AT MOST one genuine poke opportunity (an opponent
  // physically within real standing-tackle range of the LIVE, still-
  // rolling ball -- see its own header), but only reports the geometry;
  // this is the only place that actually rolls the duel, same shape as
  // resolveDribble()'s own progressionDuel just with different labels
  // (poking a rolling ball loose is a snap of Dribbling/Technique/
  // Agility against Tackling/Anticipation/Strength, not a full tackle
  // engagement). The decision layer (spatialDecision.js) never sees or
  // rolls this -- it stays exactly as attribute/RNG-blind as before.
  const pokeIndex = touches.findIndex((touch) => touch.pokeAttempt);
  if (pokeIndex !== -1) {
    const poker = touches[pokeIndex].pokeAttempt.opponent;
    const pokeDuel = localizedDuel(
      owner.player,
      poker.player,
      ["Dribbling", "Technique", "Agility"],
      ["Tackling", "Anticipation", "Strength"],
      FIXED_MINUTE,
      random,
      owner.zone,
    );
    if (!pokeDuel.won) {
      // The carrier rode every touch STRICTLY BEFORE this one exactly as
      // simulated (they had genuinely already controlled the ball
      // there); the poked touch itself never completes to its own
      // natural stop -- the ball is loose from the exact point the
      // defender actually reached it, not wherever the untouched roll
      // would have ended.
      const pokeTouch = touches[pokeIndex];
      const priorTouches = touches.slice(0, pokeIndex);
      const priorSpanMs = priorTouches.reduce((sum, touch) => sum + touch.durationMs, 0);
      const pokeTotalMs = interleaveOffBall
        ? priorSpanMs + pokeTouch.durationMs
        : 0;
      if (interleaveOffBall) {
        trace.push(
          traceEvent(
            "P.CARRY.START",
            `${playerName(owner.player)} ${gaitSetOffPhrase(gait)}`,
            { actor: owner, movement: "dribble", outcome: "neutral", duration: pokeTotalMs },
          ),
        );
      }
      let cursor = origin;
      priorTouches.forEach((touch) => {
        const to = { ...touch.ballTo, zone: zoneFromPercent(touch.ballTo.x, touch.ballTo.y) };
        trace.push(
          traceEvent(
            "P.CARRY.TOUCH",
            `${playerName(owner.player)} touches it forward`,
            {
              actor: owner,
              playerMoves: [{ player: owner, from: cursor, to, action: "touch", trajectory: touch.chaseTrajectory }],
              movement: "touch",
              outcome: "success",
              ballFrom: cursor,
              ballTo: to,
              ballTrajectory: touch.ballTrajectory,
              duration: touch.durationMs,
              contact: { point: to, actor: owner, type: "touch", phase: "end" },
              ownerBefore: owner,
              ownerAfter: owner,
              attribution: touch.kinetics?.attribution,
              ...(interleaveOffBall ? { overlapWithPrevious: true, overlapStartOffsetMs: touch.startOffsetMs } : null),
            },
          ),
        );
        cursor = to;
      });
      const pokePoint = { ...pokeTouch.ballTo, zone: zoneFromPercent(pokeTouch.ballTo.x, pokeTouch.ballTo.y) };
      trace.push(
        traceEvent(
          "T.POKE",
          `${playerName(poker.player)} pokes it away from ${playerName(owner.player)}`,
          {
            actor: owner,
            defender: poker,
            movement: "scramble",
            outcome: "turnover",
            ballFrom: cursor,
            ballTo: pokePoint,
            ballTrajectory: pokeTouch.ballTrajectory,
            duration: pokeTouch.durationMs,
            contact: { point: pokePoint, actor: poker, type: "tackle", phase: "end" },
            ownerBefore: owner,
            ownerAfter: null,
            ...(interleaveOffBall ? { overlapWithPrevious: true, overlapStartOffsetMs: priorSpanMs } : null),
          },
        ),
      );
      return {
        outcome: "POKE",
        code: "T.POKE",
        resolved: true,
        terminal: true,
        possession: "loose",
        nextOwnerId: null,
        ballEnd: pokePoint,
        restart: null,
        reason: "carry-poked",
        gait,
        offBallInterleaved: false,
      };
    }
    // A missed poke does not stop the ball or give the carrier an early
    // touch. Re-run the same deterministic impulses without that attempted
    // contact; obstacle steering is retained and no gameplay RNG is drawn.
    touches = simulateCarryTouches(origin, advanced, gait, {
      player: kineticOwner.player, pressure: carryPressure,
      seed: `${owner.id}:carry:${origin.x}:${origin.y}:${advanced.x}:${advanced.y}`,
      opponents: groups.opponents, ignorePokes: true, incomingVelocity: carryEntryVelocity,
    });
  }
  // Ball Out of Bounds v1 (2026-09-01) -- if the very last touch already
  // carried the ball off the pitch (simulateOneTouch()'s own header), the
  // carry ends exactly there -- no further "drive forward under control"
  // leg, no normal completion. classifyPitchExit() is computed FIRST,
  // with nothing pushed to `trace` yet -- only once it genuinely returns a
  // real restart do we author anything, so a missing team/attacking-
  // direction context (should never happen against a real possession)
  // falls through to the ordinary completion path below with zero risk of
  // double-authoring the same touches.
  const exitedTouch = touches.at(-1);
  const pitchExit = exitedTouch?.exitedPitch
    ? classifyPitchExit({
        exit: exitedTouch.exitedPitch,
        lastTouchTeam: owner.team,
        attackingDirectionByTeam: state.attackingDirection,
      })
    : null;
  if (pitchExit) {
    const priorTouches = touches.slice(0, -1);
    const priorSpanMs = priorTouches.reduce((sum, touch) => sum + touch.durationMs, 0);
    const exitTotalMs = interleaveOffBall ? priorSpanMs + exitedTouch.durationMs : 0;
    if (interleaveOffBall) {
      trace.push(
        traceEvent(
          "P.CARRY.START",
          `${playerName(owner.player)} ${gaitSetOffPhrase(gait)}`,
          { actor: owner, movement: "dribble", outcome: "neutral", duration: exitTotalMs },
        ),
      );
    }
    let exitCursor = origin;
    priorTouches.forEach((touch) => {
      const to = { ...touch.ballTo, zone: zoneFromPercent(touch.ballTo.x, touch.ballTo.y) };
      trace.push(
        traceEvent(
          "P.CARRY.TOUCH",
          `${playerName(owner.player)} touches it forward`,
          {
            actor: owner,
            playerMoves: [{ player: owner, from: exitCursor, to, action: "touch", trajectory: touch.chaseTrajectory }],
            movement: "touch",
            outcome: "success",
            ballFrom: exitCursor,
            ballTo: to,
            ballTrajectory: touch.ballTrajectory,
            duration: touch.durationMs,
            contact: { point: to, actor: owner, type: "touch", phase: "end" },
            ownerBefore: owner,
            ownerAfter: owner,
            attribution: touch.kinetics?.attribution,
            ...(interleaveOffBall ? { overlapWithPrevious: true, overlapStartOffsetMs: touch.startOffsetMs } : null),
          },
        ),
      );
      exitCursor = to;
    });
    const exitTo = { ...exitedTouch.ballTo, zone: zoneFromPercent(exitedTouch.ballTo.x, exitedTouch.ballTo.y) };
    const restartResult = pushPitchExitRestart(trace, {
      actor: owner, ballFrom: exitCursor, exit: pitchExit, movement: "touch",
      playerMoves: [{ player: owner, from: exitCursor, to: exitTo, action: "touch", trajectory: exitedTouch.chaseTrajectory }],
      ballTrajectory: exitedTouch.ballTrajectory,
      ...(interleaveOffBall ? { overlapWithPrevious: true, overlapStartOffsetMs: priorSpanMs } : null),
    });
    return { ...restartResult, gait, offBallInterleaved: false };
  }
  // Gameplay v3.1 -- "Fix the event clock, not hermite." Each
  // P.CARRY.TOUCH below still needs its own real, sequential, chained
  // ballFrom/ballTo -- continuity AND the carrier's own touch-by-touch
  // running both depend on that staying true -- but as independent
  // PRIMARY timeline intervals, only the MOST RECENT one is ever
  // reachable by a later overlapWithPrevious call (matchLabPlayback.js's
  // lastPrimaryInterval is a single slot, not a history), which is
  // exactly why the off-ball reaction below used to only ever cover the
  // last touch's own ~220ms, not the whole carry. P.CARRY.START owns ONE
  // wide primary interval spanning the real total carry time up front;
  // every touch and the final P.CARRY then overlap INTO it (their own
  // real spacing preserved via overlapStartOffsetMs) instead of each
  // claiming a fresh slot, so the off-ball reaction that follows can
  // finally bind to a window wide enough to cover the whole thing. No
  // ballFrom/ballTo/contact of its own -- a pure timing reservation,
  // invisible to the ball/continuity tracks. Gated by interleaveOffBall,
  // same convention as every other side effect in this file -- a direct
  // resolver call against a hand-built test fixture keeps today's exact
  // shape (each touch its own short primary) unchanged.
  // Ground Roll v1 -- real per-touch roll-to-a-stop timing (see
  // resolveDribble()'s own matching comment).
  const carryTouchSpanMs = touches.reduce((sum, touch) => sum + touch.durationMs, 0);
  let carryTotalMs = interleaveOffBall
    ? Math.max(
        carryWindowDurationMs(owner, origin, advanced),
        carryTouchSpanMs + MOVEMENT_DURATIONS.dribble,
      )
    : 0;
  if (interleaveOffBall) {
    trace.push(
      traceEvent(
        "P.CARRY.START",
        `${playerName(owner.player)} ${gaitSetOffPhrase(gait)}`,
        { actor: owner, movement: "dribble", outcome: "neutral", duration: carryTotalMs },
      ),
    );
  }
  let cursor = origin;
  touches.forEach((touch) => {
    const to = { ...touch.ballTo, zone: zoneFromPercent(touch.ballTo.x, touch.ballTo.y) };
    trace.push(
      traceEvent(
        "P.CARRY.TOUCH",
        `${playerName(owner.player)} touches it forward`,
        {
          actor: owner,
          // Ground Roll v2 -- the owner's own chase, distinct from the
          // ball's independent roll (see resolveDribble()'s own comment).
          playerMoves: [{ player: owner, from: cursor, to, action: "touch", trajectory: touch.chaseTrajectory }],
          movement: "touch",
          outcome: "success",
          ballFrom: cursor,
          ballTo: to,
          ballTrajectory: touch.ballTrajectory,
          duration: touch.durationMs,
          contact: {
            point: to,
            actor: owner,
            type: "touch",
            phase: "end",
          },
          ownerBefore: owner,
          ownerAfter: owner,
          attribution: touch.kinetics?.attribution,
          ...(interleaveOffBall
            ? { overlapWithPrevious: true, overlapStartOffsetMs: touch.startOffsetMs }
            : null),
        },
      ),
    );
    cursor = to;
    // Off-Ball Motion v3 (2026-08-26) -- see resolveDribble()'s own
    // matching comment: a per-touch reactOffBall() call here is exactly
    // the reported "go-stop-go" bug. ONE reactOffBallContinuous() call now
    // covers the WHOLE carry window instead -- see just below.
  });
  acceptCarryOvershoot(origin, advanced, touches);
  const carryMove = carryLegMoverTrajectory(kineticOwner, advanced, groups.opponents, {
      from: cursor, floorMs: MOVEMENT_DURATIONS.dribble,
      // World Motion Contract v1 -- continue the run the touches above
      // were already making, instead of restarting from a standstill.
      entrySpeedYps: touches.at(-1)?.exitSpeedYps ?? speedYpsFromVelocity(carryEntryVelocity),
      entryVelocity: touches.at(-1)?.chaseTrajectory?.at(-1)?.velocity ?? carryEntryVelocity,
    });
  if (interleaveOffBall) {
    carryTotalMs = carryTouchSpanMs + carryMove.duration;
    const reservation = [...trace].reverse().find(event => event.code === "P.CARRY.START");
    reservation.duration = carryTotalMs;
  }
  trace.push(
    traceEvent(
      "P.CARRY",
      `${playerName(owner.player)} ${gaitActionPhrase(gait)}`,
      {
        actor: owner,
        ...carryMove,
        // Ground Roll v2 follow-up -- see resolveDribble()'s own matching
        // comment and carryLegBallTrajectory()'s header.
        ballTrajectory: carryLegBallTrajectory(carryMove.playerMoves[0].trajectory, cursor, advanced),
        movement: "dribble",
        outcome: "success",
        ballFrom: cursor,
        ballTo: advanced,
        contact: { point: cursor, actor: owner, type: "touch", phase: "start" },
        ownerBefore: owner,
        ownerAfter: owner,
        attribution: burstAttribution(owner),
        ...(interleaveOffBall
          ? { overlapWithPrevious: true, overlapStartOffsetMs: carryTouchSpanMs }
          : null),
      },
    ),
  );
  // ONE continuous off-ball reaction spanning the WHOLE carry window --
  // see resolveDribble()'s own matching call for the full rationale. Now
  // reaches all the way back to the FIRST touch (via P.CARRY.START's own
  // wide anchor above), not just the final P.CARRY leg.
  // Progression Contest v1 -- a real margin, not the ~1yd noise an
  // ordinary tight carry produces (a marker who was NEVER actually
  // engaging at all reads as null here, same "was there a real
  // engager" gate engagingOpponent()/DUEL_RANGE_YARDS already applies
  // everywhere else).
  const beatenDefenderId = originEngager && yardDistance(originEngager, advanced) > 3
    ? originEngager.id
    : null;
  if (interleaveOffBall) {
    reactOffBallContinuous(
      groups, origin, advanced,
      carryTotalMs,
      trace,
      {
        motionContext, excludedIds: [owner.id], overlapWithPrevious: true, chaseIntention: true,
        // This branch's own off-ball reaction is the ONLY one that ever
        // runs for a normal completed carry (offBallInterleaved below
        // skips the generic post-action reshape entirely).
        beatenPresserId: beatenDefenderId,
      },
    );
  }
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
    beatenDefenderId,
    gait,
    // Off-Ball Motion v3 -- see resolveDribble()'s own matching field.
    offBallInterleaved: interleaveOffBall,
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
// Playback Fluidity v1 (2026-09-05) -- takes the standard resolver tail
// (interleaveOffBall, motionContext) so a hold beat can keep the REST of the
// pitch moving through it. A hold is the one action where the ball genuinely
// does not travel, which is exactly why it used to freeze everything: with no
// ball movement and no off-ball reaction, all 22 players stood still for the
// whole window. Ten outfield players do not stop running because the carrier
// is shielding.
function resolveHold(groups, availability, random, trace, interleaveOffBall = false, motionContext = null) {
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
          ownerBefore: owner,
          ownerAfter: owner,
        },
      ),
    );
    // Playback Fluidity v1 (2026-09-05) -- NOT interleaving an off-ball
    // reaction here, deliberately, and this is the interesting negative
    // result of that pass. Doing so is the obvious fix for the 400ms orphan
    // the harness reports on this beat, and it does remove the freeze -- but
    // moving ten players during a hold changes their positions, which changes
    // the next decision, and it measurably re-broke the recorded
    // congested-pass-loop bug scenario (the possession started hitting the
    // 50-action cap again). The freeze is real and still needs fixing; it
    // needs a change that does not feed back into candidate generation, which
    // is more than a resolver-local edit. Left as reported work rather than
    // traded for a worse regression.
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
        // The challenge approach takes its real ETA. If already engaged,
        // this caption accompanies the following physical shield separation.
        ...(yardDistance(defender, contactPoint) > 0.001
          ? realMoverTrajectory(defender, contactPoint, { action: "challenge" })
          : { duration: 0 }),
      },
    ),
  );
  if (shieldDuel.won) {
    const retained = shieldRetentionMotion(owner, defender, groups.opponents, contactPoint, motionContext);
    trace.push(
      traceEvent(
        "P.HOLD.SHIELD.WON",
        `${playerName(owner.player)} absorbs the challenge and keeps control`,
        {
          actor: owner,
          defender,
          movement: "hold",
          outcome: "success",
          duration: retained.duration,
          playerMoves: [{
            player: owner,
            from: contactPoint,
            to: retained.position,
            action: "shield-retain",
            trajectory: retained.trajectory,
            intention: { action: "shield-retain", target: retained.intentionTarget },
            reactionDelayMs: 0,
          }],
          ballFrom: contactPoint,
          ballTo: retained.position,
          contact: {
            point: contactPoint,
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
      outcome: "HOLD/SHIELDED",
      code: "P.HOLD.SHIELD.WON",
      resolved: true,
      terminal: false,
      possession: "retained",
      nextOwnerId: owner.id,
      ballEnd: retained.position,
      restart: null,
      reason: "hold-shielded",
    };
  }
  // Engagement Breaker v1 -- a lost shield is a knock-on, not an
  // ownership teleport at the same XY: the ball pops loose a real 3-6yd
  // (the defender's own forward direction, same escape geometry as the
  // winning case above), unowned and rolling, and whoever ACTUALLY gets
  // there first owns it next -- reusing the possession loop's own
  // existing loose-ball recovery race (selectLooseBallRecovery(),
  // triggered by possession:"loose"/nextOwnerId:null/ballEnd below),
  // same mechanism T.LOOSE.DEFLECT's own tackle-duel "loose" outcome
  // already relies on. Often the original owner recovers it. Often not.
  const { winnerPoint: poppedPoint } = contestSeparationPoints(contactPoint, defender.team, 4.5);
  // Playback Fluidity v1 (2026-09-05) -- the single worst freeze in the
  // engine, measured at 28 windows of 400ms across 25 possessions. The
  // WINNING branch above already separates both bodies with real, Pace-timed
  // trajectories; this losing branch authored no player movement at all, so
  // the ball popped loose while the two players who just collided stood
  // perfectly still. A shield being lost is a physical event: the defender
  // muscles through and carries on, the dispossessed player is knocked off
  // balance the other way. Same helper, same trajectory sampling, same
  // reaction delay as the winning branch -- this was an omission, not a
  // different mechanic.
  const lostSeparation = contestSeparationPoints(contactPoint, defender.team);
  const shieldLostDurationMs = Math.max(
    MOVEMENT_DURATIONS.scramble,
    Math.round(CONTACT_REACTION_DELAY_MS + timeToReach(defender.player, yardDistance(contactPoint, lostSeparation.winnerPoint)) * 1000),
  );
  // Each body starts from where the timeline last authored it, never from
  // its roster coordinate: the P.HOLD.SHIELD beat immediately above already
  // moved the defender onto the contact point, and starting them anywhere
  // else is a discontinuity the playback validator correctly rejects.
  const shieldLostMoves = [
    { player: defender, from: contactPoint, point: lostSeparation.winnerPoint, action: "challenge" },
    { player: owner, from: pointOf(owner), point: lostSeparation.loserPoint, action: "beaten" },
  ].map((pair) => ({
    player: pair.player,
    from: pair.from,
    to: pair.point,
    action: pair.action,
    trajectory: sampleContinuousTrajectory({
      from: pair.from, to: pair.point, player: pair.player.player,
      totalMs: shieldLostDurationMs, reactionDelayMs: CONTACT_REACTION_DELAY_MS,
      sampleCount: Math.max(6, Math.min(14, Math.ceil(shieldLostDurationMs / 140))),
    }),
  }));
  trace.push(
    traceEvent(
      "P.HOLD.SHIELD.LOST",
      `${playerName(defender.player)} muscles in and knocks the ball loose from ${playerName(owner.player)}`,
      {
        actor: defender,
        defender: owner,
        movement: "scramble",
        outcome: "neutral",
        duration: shieldLostDurationMs,
        playerMoves: shieldLostMoves,
        ballFrom: contactPoint,
        ballTo: poppedPoint,
        contact: {
          point: contactPoint,
          actor: defender,
          type: "touch",
          phase: "start",
        },
        ownerBefore: owner,
        ownerAfter: null,
        ownerAfterAt: "end",
      },
    ),
  );
  return {
    outcome: "LOOSE",
    code: "P.HOLD.SHIELD.LOST",
    resolved: true,
    terminal: true,
    possession: "loose",
    nextOwnerId: null,
    ballEnd: poppedPoint,
    restart: null,
    reason: "hold-shield-loose",
  };
}

// Back-to-Goal Contest v1 (2026-08-24, Off-Ball v2) -- the real duel a
// player holding the ball up with their back to goal actually faces, once
// generateFreePlayCandidates() has already identified the engaging
// defender as genuinely goal-side (between the owner and the goal they're
// attacking) -- distinct from resolveHold()'s own shielding contest (no
// defender in particular, or one not blocking the path forward) and from
// resolveDribble()'s progression duel (the defender ISN'T goal-side
// there). Re-derives the engager/goal-side check itself rather than
// trusting availability.preselectedTargetId, same self-contained
// convention resolveHold() already uses. Strength/Balance decide it, not
// Pace/Acceleration -- a hold-up duel is about who out-muscles whom in a
// tight space, not who's faster.
function resolveBackToGoalContest(groups, availability, random, trace) {
  const owner = groups.owner;
  const attackingDirection = state.attackingDirection[owner.team];
  const defender = engagingOpponent(owner, groups.opponents);
  if (!defender || distanceToGoalYards(defender, attackingDirection) >= distanceToGoalYards(owner, attackingDirection)) {
    // The geometry that earned this candidate no longer holds (defender
    // moved off, or drifted goal-side of nobody in particular) -- an
    // ordinary hold, not a fabricated contest against a defender who
    // isn't actually blocking the path forward.
    return resolveHold(groups, availability, random, trace);
  }
  const contactPoint = pointOf(owner);
  const duel = localizedDuel(
    owner.player, defender.player,
    ["Balance", "Strength"],
    ["Strength", "Tackling", "Aggression"],
    FIXED_MINUTE, random, owner.zone,
  );
  // A clean win splits further into a full turn vs only a half-turn --
  // one extra roll, only ever spent when the attacker actually won the
  // underlying duel, never a second independent contest.
  const outcome = !duel.won ? "pin" : random() < 0.5 ? "turned" : "half-turn";
  const ownerYard = toYardPoint(owner);
  const defenderYard = toYardPoint(defender);
  const forwardSign = attackingDirection === "up" ? -1 : 1;
  const lateralSign = ownerYard.x <= defenderYard.x ? -1 : 1;
  // Engagement Breaker v1 (2026-08-28) -- a real reported bug: a "pin"
  // used to leave the owner frozen at the exact contact point, same
  // shape as P.HOLD.SHIELD's own zero-separation bug. Genuinely pinned
  // (they couldn't turn) still isn't literally glued to the defender's
  // own shoulder -- a modest shuffle, not the full escape distance a
  // clean win gets.
  const endPoint = outcome === "pin"
    ? contestSeparationPoints(contactPoint, owner.team, 2, 1.5).winnerPoint
    : (() => {
        const raw = fromYardPoint({
          x: ownerYard.x + lateralSign * (outcome === "turned" ? 3 : 4),
          y: outcome === "turned" ? ownerYard.y + forwardSign * 4 : ownerYard.y - forwardSign * 2,
        });
        // fromYardPoint() returns a bare {x,y} -- every other resolver's own
        // ballTo carries a real zone (zoneFromPercent()), and the NEXT
        // event's own ballFrom will too; a missing zone here reads as a
        // genuine continuity break even though x/y match exactly.
        return { ...raw, zone: zoneFromPercent(raw.x, raw.y) };
      })();
  // Ball Out of Bounds v1 (2026-09-01) -- a spin/half-turn right next to
  // the touchline/byline can genuinely carry the ball out (contestSeparation-
  // Points()'s own "pin" point already stays in range via reflectIntoRange(),
  // not a clamp, so this only ever fires for the turned/half-turn branch).
  const backToGoalExit = classifyPitchExit({
    from: contactPoint, to: endPoint, lastTouchTeam: owner.team, attackingDirectionByTeam: state.attackingDirection,
  });
  if (backToGoalExit) {
    return pushPitchExitRestart(trace, {
      actor: owner, ballFrom: contactPoint, exit: backToGoalExit, movement: "touch",
      contact: { point: contactPoint, actor: owner, type: "touch", phase: "start" },
    });
  }
  const code = outcome === "pin" ? "B2G.PIN" : outcome === "turned" ? "B2G.TURNED" : "B2G.HALF_TURN";
  const label = outcome === "pin"
    ? `${playerName(defender.player)} pins ${playerName(owner.player)}, who can't turn`
    : outcome === "turned"
      ? `${playerName(owner.player)} spins away from ${playerName(defender.player)} and faces goal`
      : `${playerName(owner.player)} is forced wide, shielding it from ${playerName(defender.player)}`;
  trace.push(
    traceEvent(
      code, label,
      {
        actor: owner,
        defender,
        movement: "hold",
        outcome: outcome === "pin" ? "neutral" : "success",
        mover: owner,
        moveFrom: contactPoint,
        moveTo: endPoint,
        ...realMoverTrajectory(owner, endPoint, { from: contactPoint, action: "shield-turn", reactionDelayMs: 0 }),
        ballFrom: contactPoint,
        ballTo: endPoint,
        contact: { point: contactPoint, actor: owner, type: "touch", phase: "start" },
        ownerBefore: owner,
        ownerAfter: owner,
      },
    ),
  );
  return {
    outcome: outcome === "pin" ? "PINNED" : outcome === "turned" ? "TURNED" : "HALF_TURN",
    code,
    resolved: true,
    terminal: false,
    possession: "retained",
    nextOwnerId: owner.id,
    ballEnd: endPoint,
    restart: null,
    reason: `back-to-goal-${outcome}`,
  };
}

// Keeper Catch & Distribution v1 (2026-08-23) -- the fourth of the four
// legal distribution options once a keeper is genuinely holding the ball
// (see keeperDistributionCandidates()): rather than throwing/punting it
// away, they take a touch and put it down at their own feet. `held: false`
// on the result is the explicit signal transitionBallState() needs (see its
// own heldOverride param) -- they still OWN the ball afterward, they're
// just no longer holding it in their hands, so the NEXT decision offers a
// real pass/carry instead of another throw/punt/release choice.
function resolveKeeperReleaseToFeet(groups, availability, random, trace) {
  const owner = groups.owner;
  const contactPoint = pointOf(owner);
  const drop = projectRebound({ from: { ...contactPoint, height: 1.1 }, velocity: { x: 0, y: 0, z: 0 } });
  const dropMs = drop.contacts[0].timeMs;
  const dropTrajectory = drop.samples.filter(sample => sample.timeMs < dropMs)
    .map(sample => ({ ...sample, progress: sample.timeMs / dropMs }));
  dropTrajectory.push({ progress: 1, position: { ...contactPoint, height: 0 },
    velocity: { x: 0, y: 0 }, verticalVelocity: 0, mode: "controlled-ground" });
  trace.push(
    traceEvent(
      "GK.RELEASE",
      `${playerName(owner.player)} takes a touch, releasing it to feet`,
      {
        actor: owner,
        movement: "reception",
        outcome: "success",
        duration: dropMs,
        ballTrajectory: dropTrajectory,
        ballFrom: contactPoint,
        ballTo: contactPoint,
        contact: {
          point: contactPoint,
          actor: owner,
          type: "control",
          phase: "end",
        },
        ownerBefore: owner,
        ownerAfter: owner,
      },
    ),
  );
  return {
    outcome: "AT FEET",
    code: "GK.RELEASE",
    resolved: true,
    terminal: false,
    possession: "retained",
    nextOwnerId: owner.id,
    ballEnd: contactPoint,
    restart: null,
    reason: "keeper-release-to-feet",
    held: false,
  };
}

const FREE_PLAY_RESOLVERS = {
  pass: resolvePass,
  through: resolveThroughBall,
  cross: resolveCross,
  dribble: resolveDribble,
  shoot: resolveShoot,
  // Direct restarts use the established free-kick pipeline (wall,
  // free-kick strike, keeper and rebound), not the generic open-play shot
  // resolver. restartExecution.js injects this like every other resolver.
  "direct-free-kick": (groups, availability, random, trace) => {
    const scenario = SCENARIOS.find((entry) => entry.id === "free-kick");
    const wall = groups.opponents.filter(
      (entry) => /^wall(?:-\d+)?$/.test(entry.restartRole ?? "") && isWallCandidate(entry),
    );
    const result = scenario.run({
      attacker: [groups.owner],
      keeper: groups.keeper ? [groups.keeper] : [],
      wall,
    }, availability ?? {}, random, trace);
    const lastBallEvent = [...trace].reverse().find((event) => event.ballTo);
    return {
      resolved: true,
      terminal: true,
      possession: result.possession ?? (result.nextOwnerId ? "turnover" : result.restart ? "dead" : "loose"),
      nextOwnerId: result.nextOwnerId ?? null,
      ballEnd: result.ballEnd ?? lastBallEvent?.ballTo ?? pointOf(groups.owner),
      restart: result.restart ?? null,
      reason: result.reason ?? "direct-free-kick-resolved",
      ...result,
    };
  },
  carry: resolveCarry,
  hold: resolveHold,
  "back-to-goal": resolveBackToGoalContest,
  "throw-short": resolvePass,
  "throw-long": resolvePass,
  punt: resolvePass,
  "release-to-feet": resolveKeeperReleaseToFeet,
};

// A possession that's still "retained" after this many actions stops here
// rather than looping forever -- a hard safeguard, not a realistic outcome
// most chains reach (most terminate naturally within a few steps).
const POSSESSION_MAX_ACTIONS = 50;

// Burst Stamina v1 (2026-08-31) -- two independent tanks, not one.
// match01 is conditionMultiplier()'s own real 90-minute curve (matchEngineCore.js,
// unchanged, still keyed off `minute`) -- "how much of him is left
// today." Match Lab resolves everything at FIXED_MINUTE, so this barely
// drains inside a single possession, exactly as the real production
// curve intends; it's read here, never reimplemented. burst01 is the
// NEW tank this feature adds: "how much explosive work he has RIGHT
// NOW" -- the 8-20 seconds of high-intensity running before the legs
// go, independent of the 90-minute clock, drained per action and
// refilled by jogging/standing jobs within the SAME possession. Both
// are possession-local, attached directly to simulatedRoster (same
// place lastCarryDirectionX/Y and engagementHistory already live) --
// never the shared roster/database player object.
const BURST_BASE = 0.5;
const BURST_RANGE = 0.5;
// The ONE formula for "what does this player's burst tank read before
// they've done anything at all" -- conditionMultiplier() at FIXED_MINUTE
// (production's own real 90-minute curve, read never reimplemented) times
// a Stamina-scaled fraction of it. Used identically by
// runConstructedPossession()'s own simulatedRoster init, buildPlaybackPlan()'s
// initialBurst seed for the playback timeline, and renderPitch()'s own
// stamina-bar seed at setup -- one formula, three real readers, never
// three copies that could quietly drift apart.
function freshBurst01(player) {
  const match01 = conditionMultiplier(player, FIXED_MINUTE);
  const burst01 = clamp(0, match01, (BURST_BASE + BURST_RANGE * (playerAttribute(player, "Stamina") / 20)) * match01);
  return { burst01, match01 };
}
// cost = (yards/40) * intensity * (1.20 - WorkRate/50) -- yards-of-effort,
// not a flat per-action tax: a short shuffle costs almost nothing, a
// real 40-yard recovery sprint is the expensive one. High Work Rate
// spends slightly LESS per yard (used to it) -- willingness to make the
// run at all is a completely separate, SEPARATE gate (see
// maybeAssignSupportRun()'s own comment: "Work Rate is willingness to
// spend, not the tank").
function burstEffortCost(yards, intensity, workRate) {
  return (Math.max(0, Number(yards) || 0) / 40) * intensity * (1.20 - (Number(workRate) || 0) / 50);
}
// Per-event recovery while genuinely NOT doing high-intensity work
// (jogging/standing jobs -- see BURST_JOB_INTENSITY's own "recovers"
// entries). Capped at match01 -- jogging never restores match-long
// fitness, only the burst tank, and never past today's own ceiling.
function burstRecoveryTick(stamina, match01, durationMs) {
  return 0.035 * (0.6 + (Number(stamina) || 0) / 50) * match01 * ((Number(durationMs) || 0) / 450);
}
// Named intensities from the spec's own table -- every off-ball JOB
// name this file's own planDefensiveRepositioning()/planAttackerRepositioning()
// results (and the on-ball gaits) ever produce is covered explicitly;
// anything genuinely new defaults to the lightest, most forgiving
// reading (a real, if approximate, job) rather than silently draining
// nothing OR everything.
const BURST_JOB_INTENSITY = {
  "full-sprint": 1.00,
  "run-in-behind": 0.85,
  "recovery-track": 0.90, // 2a -- track-back after a turnover
  "support-run": 0.80, // 2b -- box-to-box support run
  "press-ball": 0.70,
  "respect-held-ball": 0.25,
  "cover-shadow": 0.70,
  "controlled-sprint": 0.45,
  "sliding-tackle": 0.55,
  "aerial-duel": 0.30,
  "close-control": 0.08,
  "lateral-control": 0.08,
  hold: 0.08,
  pass: 0.04,
  shot: 0.04,
  throw: 0.04,
  // Pattern Vocabulary V1, Step 1 (2026-09-02) -- explicit intensities so
  // none of these silently fall to the unlisted 0.5 default. The box-meet
  // slots replace the old shared "attack-box" (itself unlisted before this
  // pass) with a real sprint intensity matching run-in-behind.
  "attack-near": 0.75,
  "attack-spot": 0.75,
  "attack-far": 0.75,
  "edge-rebound": 0.75,
  "run-off-pass": 0.85,
  "arc-overlap": 0.80,
  "vacate-pocket": 0.55,
  "peel-square": 0.55,
  "check-decel": 0.40,
  // Deliberately NOT 0.50 (the unlisted-action default `burstJobIntensity()`
  // itself falls back to) -- a distinct real value so registration is
  // independently testable, not indistinguishable from an unlisted job.
  delay: 0.45,
};
// Jobs planDefensiveRepositioning()/planAttackerRepositioning() actually
// name that count as genuinely low-intensity -- refill-eligible, never
// drained. "recover"/"mark" are deliberately absent: a last-man/beaten-
// presser recovery sprint is real work (folded into recovery-track's own
// intensity below), and marking tracks a live attacker, not a jog.
const BURST_REFILL_JOBS = new Set([
  "hold-width", "pin-last-line", "screen", "shift-unit", "drop-deep",
  "show-to-feet", "set-position", "support-short",
  // Pattern Vocabulary V1, Step 1 -- show-wide is mostly positional (a
  // valve, not a sprint).
  "show-wide",
]);
// BURST_REFILL_JOBS is deliberately not consulted here: applyBurstOffBallJob
// (below) already branches on it FIRST and returns before ever reaching
// this call, so an unlisted action always means genuinely unmodeled
// off-ball work, never a refill job slipping through -- the forgiving,
// middling 0.5 default is for that, and that alone.
function burstJobIntensity(action) {
  return BURST_JOB_INTENSITY[action] ?? 0.5;
}
// Any resolved on-ball action (carry/dribble by GAIT, everything else a
// flat negligible amount) drains the ACTOR only, by the real distance
// they just covered -- never a reactor/off-ball player, see the
// possession loop's own call site.
const ON_BALL_OTHER_ACTION_YARDS = 2; // hold/pass/shot -- a token cost, not zero
// A genuine full-sprint is real match-long wear, not just burst -- almost
// cosmetic at FIXED_MINUTE's own single-possession scale (conditionMultiplier()'s
// own 90-minute curve dwarfs it), but real over a full match's worth of
// possessions. Never applied to any other gait/job -- match01 otherwise
// stays exactly production's own read-only 90-minute number.
const MATCH01_FULL_SPRINT_WEAR = 0.002;
// Stage 5 (2026-09-06) -- a travelling action is priced from the motion it
// actually performed, via motionEffortCost(). The gait name no longer decides
// how hard the player worked; how fast they went does, which is the whole
// point of the stage. Striking the ball (pass/shot/hold) is not travel at all
// and keeps its own explicit token cost.
function drainOnBallAction(owner, gait, yardsCovered, durationMs = 0) {
  if (!owner || typeof owner.burst01 !== "number") return;
  const workRate = playerAttribute(owner.player, "Work Rate");
  if (gait === "full-sprint") {
    owner.match01 = clamp(0, 1, (owner.match01 ?? 1) - MATCH01_FULL_SPRINT_WEAR);
  }
  if (gait && durationMs > 0) {
    recordDistanceCovered(owner, yardsCovered, durationMs);
    owner.burst01 = clamp(0, owner.match01 ?? 1, owner.burst01 + netBurstChange({
      distanceYards: yardsCovered, durationMs, player: owner.player, workRate,
    }));
    return;
  }
  // Striking the ball is not travel: a pass, a shot or a hold keeps its own
  // explicit token cost rather than being priced from a distance nobody moved.
  owner.burst01 = clamp(0, owner.match01 ?? 1, owner.burst01 - burstEffortCost(
    gait ? yardsCovered : ON_BALL_OTHER_ACTION_YARDS,
    burstJobIntensity(gait ?? "pass"), workRate,
  ));
}

// Every off-ball JOB reactOffBall()/reactOffBallContinuous() author a
// real move for -- drains a genuinely high-intensity one (by the REAL
// distance just covered, same yards-of-effort formula as the on-ball
// side above), refills a genuinely low-intensity one (BURST_REFILL_JOBS)
// by how long this beat actually lasted. `entry` is the real
// simulatedRoster reference (originals.get(id) in both callers) --
// absent/no-op for any direct call against a hand-built fixture that
// never wired up the battery, same convention as drainOnBallAction().
// Stage 5 (2026-09-06) -- the job NAME no longer decides anything here.
//
// Recovery used to be a hand-maintained list of job names, so a defender who
// genuinely sprinted eight yards to hold a line recovered stamina for doing
// it, while an unlisted job silently priced at 0.5. Both now follow from the
// motion: a player moving below RECOVERY_LOAD_CEILING of their own top speed
// is walking or jogging and recovers; anyone going faster than that pays for
// the speed they actually held. `action` is retained only for the legacy
// fallback below, which fires when a caller genuinely has no window to
// measure against (a hand-built fixture with durationMs 0).
function applyBurstOffBallJob(entry, action, moveDistanceYards, durationMs, motion = null) {
  if (!entry || typeof entry.burst01 !== "number") return;
  const match01 = entry.match01 ?? 1;
  const stamina = playerAttribute(entry.player, "Stamina");
  const workRate = playerAttribute(entry.player, "Work Rate");
  if (!(durationMs > 0)) {
    if (BURST_REFILL_JOBS.has(action)) {
      entry.burst01 = clamp(0, match01, entry.burst01 + burstRecoveryTick(stamina, match01, durationMs));
      return;
    }
    const intensity = burstJobIntensity(action);
    if (intensity <= 0) return;
    entry.burst01 = clamp(0, match01, entry.burst01 - burstEffortCost(moveDistanceYards, intensity, workRate));
    return;
  }
  recordDistanceCovered(entry, moveDistanceYards, durationMs);
  // One continuous signed change rather than a drain-or-recover branch. See
  // netBurstChange(): the branch had a hard threshold that an ordinary jog
  // sits almost exactly on, which is what made stamina appear to move at
  // random from one beat to the next.
  entry.burst01 = clamp(0, match01, entry.burst01 + netBurstChange({
    distanceYards: moveDistanceYards, durationMs, player: entry.player, workRate,
    entrySpeedYps: motion?.entrySpeedYps ?? 0,
    exitSpeedYps: motion?.exitSpeedYps ?? 0,
  }));
}

// Cumulative distance covered, in real yards, and the real time spent
// covering it. Authoritative match state in its own right -- a manager wants
// to see how far a player has run, and it is the honest basis for match-long
// condition rather than a count of how many events happened to name them.
function recordDistanceCovered(entry, yards, durationMs) {
  if (!entry) return;
  const distance = Math.max(0, Number(yards) || 0);
  entry.distanceCoveredYards = (Number(entry.distanceCoveredYards) || 0) + distance;
  entry.activeMs = (Number(entry.activeMs) || 0) + Math.max(0, Number(durationMs) || 0);
}

// Turnover Stamina Jobs v1 (2026-08-31) -- user's own 2a/2b scenarios.
// Reuses this file's own realMoverTrajectory()/effortScaledAdvance()
// movement primitives -- no new physics, just two dedicated, one-off
// authored moves at the exact instant possession changes hands. AT MOST
// one recovery runner (the team that just lost it) and one support
// runner (the team that just won it) -- never a swarm, never more than
// one body per side per turnover.
// Real reported feedback (2026-09-01): "any role tracking back 10+ yards
// in one beat reads as too sudden -- shorten the cap." TURNOVER_AHEAD_MARGIN_YARDS
// stays the GATING question (is this player genuinely upfield of his own
// side's remaining shape at all) -- a separate concern from how far ONE
// authored beat actually covers, which is TURNOVER_RECOVERY_STRIDE_YARDS
// below. A real recovery run/support run isn't solved in a single
// event anyway: the regular off-ball reshaping keeps repositioning this
// same player every following action for the rest of the possession, so
// a modest first stride here (not the full distance back) reads as a
// real jog getting underway, not a teleporting sprint.
const TURNOVER_RECOVERY_STRIDE_YARDS = 8;
const TURNOVER_JOB_MIN_YARDS = 5;
const TURNOVER_AHEAD_MARGIN_YARDS = 12;
// World Motion Contract v1 (2026-09-03) -- one authored turnover job,
// expressed the way the contract requires: an INTENTION plus the real
// motion it produces this window, never a coordinate write onto the
// tactical target. Returns the trace-ready move (with its intention
// attached for diagnostics) and the authoritative position/velocity to
// commit, or null when the stride is too small to be worth an event.
//
// `motionContext` is optional purely so a direct unit-test call against a
// hand-built fixture still works; when present, the player's own current
// velocity is carried INTO the run (a defender already jogging back does
// not restart from rest) and their exit velocity + intention are carried
// back OUT for whoever moves them next. That hand-off is what stops the
// next beat from re-launching them from a standstill.
function planTurnoverRecoveryMove(entry, intentionTarget, {
  intention, role, minimumYards = TURNOVER_JOB_MIN_YARDS, motionContext = null,
}) {
  const origin = pointOf(entry);
  const record = readMotionRecord(motionContext, entry.id, origin);
  const incomingVelocity = record.velocity;
  // The honest window for this stride: their own reaction to genuinely
  // losing the ball, plus the real time their own Pace/Acceleration need
  // to cover the ground (the SAME kinetics realMoverTrajectory() uses --
  // no second timing model).
  const strideYards = yardDistance(origin, intentionTarget);
  const windowMs = Math.max(
    MOVEMENT_DURATIONS.reposition,
    Math.round(CONTACT_REACTION_DELAY_MS + timeToReach(entry.player, strideYards) * 1000),
  );
  const motion = advanceMotion({
    from: origin,
    intentionTarget,
    player: entry.player,
    elapsedMs: windowMs,
    incomingVelocity,
    // A turnover IS a new stimulus -- they have to register that they
    // lost it before they turn and go. A player already running this
    // same recovery keeps their momentum via incomingVelocity above.
    reactionDelayMs: speedYpsFromVelocity(incomingVelocity) > 0.5 ? 0 : CONTACT_REACTION_DELAY_MS,
    intention,
    role,
  });
  if (motion.distanceYards < minimumYards) return null;
  return {
    motion,
    origin,
    duration: windowMs,
    playerMoves: [{
      player: entry,
      from: origin,
      // The AUTHORITATIVE position genuinely reached in this window --
      // not intentionTarget. These are different things and this is the
      // line where that distinction is enforced.
      to: motion.position,
      action: intention,
      trajectory: motion.trajectory,
      intention: { action: intention, role, target: intentionTarget },
    }],
  };
}

// Commits one planned turnover move: authoritative position onto the
// roster entry, velocity/intention/gait into the shared motion record.
function commitTurnoverRecoveryMove(entry, planned, { intention, role, motionContext }) {
  Object.assign(entry, planned.motion.position);
  writeMotionRecord(motionContext, entry.id, {
    position: planned.motion.position,
    velocity: planned.motion.velocity,
    intention,
    intentionTarget: planned.motion.intentionTarget,
    role,
  });
}

function maybeAssignTurnoverStaminaJobs(previousOwner, losingTeammates, winningGroups, trace, alreadyMovedIds = new Set(), motionContext = null) {
  // Real reported bug (2026-08-31): the regular post-action off-ball
  // reshaping (reactOffBallContinuous(), called right after this returns
  // -- see its own excludedIds comment) doesn't know either of these two
  // players just got a DEDICATED job here, and independently plans its
  // OWN target for them too (planDefensiveRepositioning()/
  // planAttackerRepositioning() see them as ordinary opponents/teammates,
  // nothing about this function is visible to them) -- a genuine SECOND,
  // conflicting move landing on top of this one within the same action,
  // which read as the player teleporting. Returned so the caller can
  // exclude them from that later reshaping entirely for this one action.
  const assignedIds = [];
  // Other direction of the SAME real bug: a resolver that already
  // interleaved its own full off-ball reaction earlier THIS action (the
  // loose-ball recovery race is the concrete case that surfaced it) may
  // have already given previousOwner/deepest a real job of their own --
  // alreadyMovedIds (this action's own trace-so-far) catches that
  // regardless of which specific mechanism moved them first.
  // 2a -- the player who just lost the ball is furthest forward for
  // their OWN side, tracks back if they're genuinely upfield of their
  // own remaining teammates (a real defensive line proxy: the median
  // depth of whoever's left), not just "anyone who had the ball."
  const remainingTeammates = (losingTeammates || []).filter(Boolean);
  if (
    remainingTeammates.length
    && typeof previousOwner?.burst01 === "number"
    && !alreadyMovedIds.has(String(previousOwner.id))
  ) {
    const ownGoalDirection = state.attackingDirection[previousOwner.team] === "up" ? "down" : "up";
    const depths = remainingTeammates.map((entry) => distanceToGoalYards(entry, ownGoalDirection));
    const sorted = [...depths].sort((a, b) => a - b);
    const medianDepth = sorted[Math.floor(sorted.length / 2)];
    const ownDepth = distanceToGoalYards(previousOwner, ownGoalDirection);
    if (ownDepth - medianDepth >= TURNOVER_AHEAD_MARGIN_YARDS) {
      const ownerYard = toYardPoint(previousOwner);
      const recoveryTarget = fromYardPoint({
        x: ownerYard.x,
        y: ownGoalDirection === "up" ? 0 : PITCH_LENGTH_YARDS,
      });
      const origin = pointOf(previousOwner);
      const advanceYards = effortScaledAdvance(TURNOVER_RECOVERY_STRIDE_YARDS, previousOwner.player, previousOwner.burst01);
      // The tactical destination for this stride. Still effort-scaled
      // (a gassed player asks for less ground), but it is now an
      // INTENTION TARGET handed to the motion layer, not a coordinate
      // anybody is about to be teleported onto.
      const intentionTarget = approachPoint(origin, recoveryTarget, advanceYards);
      const planned = planTurnoverRecoveryMove(previousOwner, intentionTarget, {
        intention: "recovery-track", role: "defender", motionContext,
      });
      if (planned) {
        trace.push(
          traceEvent(
            "DEF.ADJUST",
            `${playerName(previousOwner.player)} tracks back after losing it`,
            {
              actor: previousOwner,
              duration: planned.duration,
              playerMoves: planned.playerMoves,
              movement: "reposition",
              outcome: "neutral",
              // Genuinely concurrent with the action that caused it --
              // and, since World Motion Contract v1, no longer
              // time-compressed into that action's window (see
              // matchLabPlayback.js's own overlap comment): the run keeps
              // its real duration and may finish after the triggering
              // action does, exactly as a real recovery run does.
              overlapWithPrevious: true,
            },
          ),
        );
        applyBurstOffBallJob(previousOwner, "recovery-track", planned.motion.distanceYards, planned.duration, planned.motion);
        // Commit the position the motion layer says was actually reached
        // (with velocity/intention handed on) -- any off-ball reaction
        // planned later THIS SAME action (reactOffBall/
        // reactOffBallContinuous, right below) reads pointOf(previousOwner)
        // fresh; leaving the roster entry stale here is what produced a
        // real discontinuity (a later event's own "from" disagreeing with
        // this event's authored "to").
        commitTurnoverRecoveryMove(previousOwner, planned, {
          intention: "recovery-track", role: "defender", motionContext,
        });
        assignedIds.push(previousOwner.id);
      }
    }
  }

  // 2b -- the deepest player on the side that just WON it may support
  // the attack. Willingness (Work Rate) is a SEPARATE gate from ability
  // (burst) -- a low-WR player with plenty of burst left still doesn't
  // fancy the run; a high-WR one drags themselves forward even tired.
  const winningSide = (winningGroups.teammates || []).filter(
    (entry) => !alreadyMovedIds.has(String(entry.id)),
  );
  if (winningSide.length) {
    const attackingDirection = state.attackingDirection[winningGroups.owner.team];
    const deepest = [...winningSide].sort(
      (a, b) => distanceToGoalYards(b, attackingDirection) - distanceToGoalYards(a, attackingDirection),
    )[0];
    if (deepest && typeof deepest.burst01 === "number") {
      const workRate01 = playerAttribute(deepest.player, "Work Rate") / 20;
      const makeTheRun = (deepest.burst01 > 0.15 && workRate01 > 0.35) || workRate01 > 0.75;
      if (makeTheRun) {
        const origin = pointOf(deepest);
        // The target sits comfortably beyond the real advance cap below --
        // approachPoint() should be limited by effortScaledAdvance()'s own
        // real effort/burst math, never by this heading point itself
        // being too close.
        const forwardTarget = pointAheadYards(origin, attackingDirection, TURNOVER_RECOVERY_STRIDE_YARDS * 1.5);
        const advanceYards = effortScaledAdvance(TURNOVER_RECOVERY_STRIDE_YARDS, deepest.player, deepest.burst01);
        const intentionTarget = approachPoint(origin, forwardTarget, advanceYards);
        const planned = planTurnoverRecoveryMove(deepest, intentionTarget, {
          intention: "support-run", role: "attacker", motionContext,
        });
        if (planned) {
          trace.push(
            traceEvent(
              "ATT.ADJUST",
              `${playerName(deepest.player)} joins the attack from deep`,
              {
                actor: deepest,
                duration: planned.duration,
                playerMoves: planned.playerMoves,
                movement: "reposition",
                outcome: "neutral",
                overlapWithPrevious: true,
              },
            ),
          );
          applyBurstOffBallJob(deepest, "support-run", planned.motion.distanceYards, planned.duration, planned.motion);
          // Commit the reached position -- see previousOwner's own matching
          // comment above for why (real discontinuity if this stays stale).
          commitTurnoverRecoveryMove(deepest, planned, {
            intention: "support-run", role: "attacker", motionContext,
          });
          assignedIds.push(deepest.id);
        } else {
          applyBurstOffBallJob(deepest, "hold-width", 0, MOVEMENT_DURATIONS.reposition);
        }
      } else {
        applyBurstOffBallJob(deepest, "hold-width", 0, MOVEMENT_DURATIONS.reposition);
      }
    }
  }
  return assignedIds;
}

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
/**
 * Ends the authored dead ball and says why.
 *
 * A restart stops being a restart the moment the user moves the ball off
 * its legal spot or hands it to somebody: what they have then authored is
 * an ordinary open-play position, and pretending otherwise would either
 * block Resolve & Play for no reason or execute a restart from a spot that
 * is no longer legal for it.
 */
function cancelPendingRestart(reason) {
  if (!state.pendingRestart) return;
  state.pendingRestart = null;
  state.restartSetupDraft = null;
  if (state.ball) {
    state.ball.phase = undefined;
    state.ball.deadBall = false;
  }
  if (typeof renderSetupStatus === "function") {
    renderSetupStatus(`Restart cancelled — ${reason}. This is now an open-play setup.`, "warn");
  }
}

function handleAuthoredBallMove() {
  if (state.pendingRestart && state.restartSetupDraft
    && yardDistance(state.restartSetupDraft.ball, state.ball) > 0.5) {
    cancelPendingRestart("the ball was dragged off its restart spot");
  }
  // A manually separated ball is an authored loose ball. The user can
  // explicitly hand it to a player again from the roster controls.
  if (state.ball.ownerId) {
    state.ball.ownerId = null;
    renderRoster();
    renderActionTable();
  }
}

function pendingRestartIsReady() {
  const pending = state.pendingRestart;
  const restart = state.restartSetupDraft;
  const owner = state.roster.find((entry) => entry.id === state.ball.ownerId) ?? null;
  return Boolean(
    pending
    && restart
    && owner
    && pending.takerId === owner.id
    && restart.takerId === owner.id
    && pending.requiredFirstAction === restart.requiredFirstAction
    && String(pending.requiredFirstAction).startsWith("RESTART.")
    && String(pending.requiredFirstAction).endsWith(".TAKE"),
  );
}

// Restart Execution v2 (2026-09-04) -- commits the authoritative moves an
// event batch authored, the same rule runConstructedPossession()'s own
// action loop applies: an explicit physical move is simulation state, so a
// player who visibly arrived somewhere makes their NEXT decision from
// there. Extracted so the restart step can use the identical rule instead
// of a second, drifting copy.
function commitAuthoritativeMoves(trace, simulatedRoster, motionContext, fromIndex = 0) {
  for (const event of trace.slice(fromIndex)) {
    for (const move of event.playerMoves || []) {
      if (move.authoritative === false) continue;
      const movedEntry = simulatedRoster.find(
        (entry) => String(entry.id) === String(move.playerId),
      );
      if (!movedEntry || !move.to) continue;
      Object.assign(movedEntry, move.to);
    }
  }
}

// Restart Execution v2 -- the ball is live, so the dead-ball shape stops
// being the shape anyone wants. Every player is given their own open-play
// release target and moved there through the ORDINARY off-ball motion
// system (reactOffBallContinuous), so Pace and Acceleration govern the
// travel and nobody teleports from a restart coordinate to a formation dot.
//
// The targets come from the shared team-shape coordinator: the side in
// possession expands into complementary jobs, the other drops into a
// compact block, and both remain relative to authored formation anchors.
function applyRestartRelease(simulatedRoster, possessionTeam, trace, motionContext, ballOwnerId = null) {
  const owner = simulatedRoster.find((entry) => entry.id === ballOwnerId);
  if (!owner) return null;
  // Release is a phase change, never an unopposed scripted carry or a pause
  // for the receiver. The next decision runs immediately; the existing
  // action resolvers move both teams concurrently with its real duration.
  trace.push(traceEvent("RESTART.RELEASE", `${playerName(owner.player)} can choose the next action as both teams release into open play`, {
    actor: owner, outcome: "neutral", duration: 0,
    ownerBefore: owner, ownerAfter: owner,
  }));
  return null;
}

// Live Restart Continuation v1 (2026-09-08) -- a ball leaving the pitch is
// a stoppage, not the end of the simulated passage. The boundary resolver
// supplies the awarded team and edge; this path sets the players for that
// restart, executes the existing restart resolver, releases both shapes,
// and hands its live owner back to the ordinary possession loop.
const AUTOMATIC_RESTART_TYPES = new Set(["throw-in", "corner", "goal-kick"]);
const MAX_AUTOMATIC_RESTARTS = 6;
const THROW_IN_OUT_OF_PLAY_PAUSE_MS = 1000;
const THROW_IN_OUTSIDE_PCT = (1.25 / 75) * 100;

function stationaryRestartBallTrajectory(point, mode = "dead", durationMs = 420) {
  if (mode === "place") {
    return [
      { progress: 0, position: { ...point, height: 0 }, velocity: { x: 0, y: 0 }, verticalVelocity: 0.65 / Math.max(1, durationMs * 0.45), mode: "dead" },
      { progress: 0.45, position: { ...point, height: 0.65 }, velocity: { x: 0, y: 0 }, verticalVelocity: -0.65 / Math.max(1, durationMs * 0.55), mode: "dead" },
      { progress: 1, position: { ...point, height: 0 }, velocity: { x: 0, y: 0 }, verticalVelocity: 0, mode: "dead" },
    ];
  }
  if (mode === "collect") {
    return [
      { progress: 0, position: { ...point, height: 0 }, velocity: { x: 0, y: 0 }, verticalVelocity: 1.1 / Math.max(1, durationMs), mode: "held" },
      { progress: 1, position: { ...point, height: 1.1 }, velocity: { x: 0, y: 0 }, verticalVelocity: 0, mode: "held" },
    ];
  }
  return [
    { progress: 0, position: { ...point, height: mode === "held" ? 1.1 : 0 }, velocity: { x: 0, y: 0 }, verticalVelocity: 0, mode },
    { progress: 1, position: { ...point, height: mode === "held" ? 1.1 : 0 }, velocity: { x: 0, y: 0 }, verticalVelocity: 0, mode },
  ];
}

function restartPreparationLabel(phase, taker) {
  const name = playerName(taker.player);
  switch (phase.code) {
    case "RESTART.PLACE_BALL": return `${name} places the ball and checks its position`;
    case "RESTART.SET_POSITION": return `${name} takes a few steps back from the ball`;
    case "RESTART.SIGNAL": return `${name} looks into the area and signals with ${phase.signalArms === 2 ? "both arms" : "one arm"}`;
    case "RESTART.SCAN": return `${name} looks up and waits for the movement`;
    case "RESTART.APPROACH": return `${name} begins the run-up`;
    case "RESTART.THROW_IN.COLLECT": return `${name} picks up the ball for the throw`;
    case "RESTART.THROW_IN.HOLD": return `${name} holds the ball overhead and scans for a teammate`;
    case "RESTART.QUICK": return `${name} chooses a quick restart`;
    default: return `${name} prepares the restart`;
  }
}

function appendRestartSupportMovement({
  restart, phase, duration, roster, taker, takingTeam, attackingGoalY,
  trace, motionContext,
}) {
  if (!(duration > 0) || !roster?.length) return [];
  const intentions = planRestartSupportMovement({
    restart,
    roster,
    takerId: taker.id,
    takingTeam,
    attackingGoalY,
    phase,
  });
  const moves = [];
  const evidence = [];
  for (const intention of intentions) {
    const entry = roster.find((candidate) => candidate.id === intention.playerId);
    if (!entry) continue;
    const isAttacker = entry.team === takingTeam;
    const reaction = restartSupportReactionDelay(entry.player, {
      isAttacker,
      movementKind: intention.movementKind,
    });
    const live = livePlayerMotionStart(entry, motionContext, trace);
    const target = {
      ...intention.target,
      zone: zoneFromPercent(intention.target.x, intention.target.y),
    };
    const motion = advanceMotion({
      from: live.position,
      intentionTarget: target,
      player: entry.player,
      elapsedMs: duration,
      incomingVelocity: live.velocity,
      reactionDelayMs: reaction.delayMs,
      intention: intention.responsibility,
      role: isAttacker ? "attacker" : "defender",
      paceToArrival: true,
      continuesAfter: phase.action === "restart-approach",
    });
    if (yardDistance(live.position, motion.position) <= 0.01) continue;
    moves.push({
      player: entry,
      from: live.position,
      to: motion.position,
      trajectory: motion.trajectory,
      action: intention.responsibility,
      role: isAttacker ? "attacker" : "defender",
      intention: { action: intention.responsibility, target },
      teamJob: intention.responsibility,
      coordinationThreatId: intention.subjectId ?? null,
    });
    Object.assign(entry, motion.position, {
      zone: zoneFromPercent(motion.position.x, motion.position.y),
    });
    writeMotionRecord(motionContext, entry.id, {
      position: motion.position,
      velocity: motion.velocity,
      intention: intention.responsibility,
      intentionTarget: target,
      role: isAttacker ? "attacker" : "defender",
      simulationTimeMs: (motionContext.simulationTimeMs ?? 0) + duration,
    });
    applyBurstOffBallJob(
      entry,
      intention.responsibility,
      yardDistance(live.position, motion.position),
      duration,
      motion,
    );
    evidence.push({
      playerId: intention.playerId,
      responsibility: intention.responsibility,
      movementKind: intention.movementKind ?? null,
      subjectId: intention.subjectId ?? null,
      deliveryTarget: intention.deliveryTarget ?? null,
      reactionDelayMs: reaction.delayMs,
      attributeInfluence: reaction.values,
    });
  }
  if (!moves.length) return moves;
  const attackingMoves = moves.filter((move) => move.role === "attacker").length;
  const defendingMoves = moves.length - attackingMoves;
  trace.push(traceEvent(
    "RESTART.MOVEMENT",
    String(attackingMoves) + " restart runner" + (attackingMoves === 1 ? "" : "s")
      + " move as " + String(defendingMoves) + " marker" + (defendingMoves === 1 ? "" : "s") + " track",
    {
      movement: "reposition",
      outcome: "neutral",
      duration,
      overlapWithPrevious: true,
      playerMoves: moves,
      restart: restart.type,
      metrics: {
        restartMovement: evidence,
      },
    },
  ));
  return moves;
}

/**
 * Turns a pure preparation plan into authoritative timeline motion. The
 * kick/throw itself remains executeRestart()'s next event and normal resolver.
 */
function appendRestartPreparation({
  restart, taker, trace, motionContext, random, attackingGoalY, attacking,
  roster, takingTeam,
}) {
  const plan = planRestartPreparation({
    restart,
    taker,
    attackingGoalY,
    style: attacking?.style,
    tempo: attacking?.tempo,
    random,
  });
  const ball = { ...restart.ball, zone: restart.ball.zone ?? zoneFromPercent(restart.ball.x, restart.ball.y) };
  for (const phase of plan.phases) {
    const from = pointOf(taker);
    let duration = Math.max(0, Number(phase.durationMs) || 0);
    let playerMoves = [];
    if (phase.target) {
      const movement = realMoverTrajectory(taker, phase.target, {
        from,
        floorMs: phase.action === "restart-approach" ? 420 : 520,
        action: phase.action,
        reactionDelayMs: 0,
        incomingVelocity: phase.action === "restart-approach"
          ? { x: 0, y: 0 }
          : motionContext.state?.players?.[taker.id]?.velocity ?? null,
        paceToArrival: phase.action !== "restart-approach",
      });
      duration = movement.duration;
      playerMoves = movement.playerMoves;
    }
    const held = phase.ballMode === "held" || phase.ballMode === "collect";
    const event = traceEvent(phase.code, restartPreparationLabel(phase, taker), {
      actor: taker,
      movement: held ? "hold" : phase.target ? "reposition" : "hold",
      outcome: "neutral",
      duration,
      playerMoves,
      ballFrom: ball,
      ballTo: ball,
      ballTrajectory: stationaryRestartBallTrajectory(ball, phase.ballMode, duration),
      ballResult: phase.ballMode === "place" ? "dead" : phase.ballMode,
      ownerBefore: held || phase.code === "RESTART.PLACE_BALL" ? taker : null,
      ownerAfter: held ? taker : null,
      contact: phase.code === "RESTART.PLACE_BALL"
        ? { point: ball, actor: taker, type: "placement", phase: "start" }
        : null,
      restart: restart.type,
      metrics: { restartPreparation: { ...plan.evidence, phase: phase.action } },
    });
    trace.push(event);
    if (playerMoves.length) {
      const move = playerMoves[0];
      Object.assign(taker, move.to, { zone: zoneFromPercent(move.to.x, move.to.y) });
      const finalVelocity = move.trajectory?.at(-1)?.velocity ?? { x: 0, y: 0 };
      writeMotionRecord(motionContext, taker.id, {
        position: move.to,
        velocity: finalVelocity,
        intention: phase.action,
        intentionTarget: phase.target,
        simulationTimeMs: (motionContext.simulationTimeMs ?? 0) + duration,
      });
    } else if (phase.action === "scan" || phase.action === "signal-and-scan" || held) {
      writeMotionRecord(motionContext, taker.id, {
        position: pointOf(taker), velocity: { x: 0, y: 0 }, intention: null,
        intentionTarget: pointOf(taker),
        simulationTimeMs: (motionContext.simulationTimeMs ?? 0) + duration,
      });
    }
    appendRestartSupportMovement({
      restart,
      phase,
      duration,
      roster,
      taker,
      takingTeam,
      attackingGoalY,
      trace,
      motionContext,
    });
    motionContext.simulationTimeMs = (motionContext.simulationTimeMs ?? 0) + duration;
  }
  return plan;
}

function otherRosterTeam(team, simulatedRoster) {
  return [...new Set(simulatedRoster.map((entry) => entry.team).filter(Boolean))]
    .find((candidate) => candidate !== team) ?? null;
}

function automaticRestartTakingTeam(result, simulatedRoster, ballState) {
  if (result?.restartTakingTeam) return result.restartTakingTeam;
  if (["kickoff", "goal-kick"].includes(result?.restart) && Number.isFinite(result.ballEnd?.y)) {
    const defendingDirection = result.ballEnd.y < 50 ? "down" : "up";
    return simulatedRoster.find((entry) => state.attackingDirection[entry.team] === defendingDirection)?.team ?? null;
  }
  const lastTouchTeam = ballState?.lastTouch?.team ?? null;
  // A throw-in, corner or goal kick is always awarded to the other side
  // from the last deliberate touch. Returns null rather than guessing when
  // a synthetic/test result carries no law-relevant touch information.
  return lastTouchTeam ? otherRosterTeam(lastTouchTeam, simulatedRoster) : null;
}

function automaticRestartSide(result) {
  if (result?.restartEdge === "left" || result?.restartEdge === "right") {
    return result.restartEdge;
  }
  return Number(result?.ballEnd?.x) < 50 ? "left" : "right";
}

function automaticRestartVariant(type, takingTeam, simulatedRoster) {
  if (type !== "goal-kick") return type === "corner" ? "inswinger" : "short";
  const keeper = simulatedRoster.find(
    (entry) => entry.team === takingTeam && entry.role === "keeper",
  );
  if (keeper?.goalkeeperDistribution === "long") return "long";
  if (keeper?.goalkeeperDistribution === "short") return "short";
  const style = attackingSettingsFor(takingTeam).style;
  return style === "direct" || style === "long-ball" ? "long" : "short";
}

function straightDeadBallTrajectory(from, to, durationMs) {
  const duration = Math.max(1, durationMs);
  const velocity = {
    x: (to.x - from.x) / duration,
    y: (to.y - from.y) / duration,
  };
  return [
    { progress: 0, position: { ...from, height: 0 }, velocity: { ...velocity } },
    { progress: 1, position: { ...to, height: 0 }, velocity: { x: 0, y: 0 } },
  ];
}

function throwInOutsidePoint(point, side) {
  return {
    ...point,
    x: side === "left" ? -THROW_IN_OUTSIDE_PCT : 100 + THROW_IN_OUTSIDE_PCT,
    zone: point.zone,
  };
}

function outOfPlayTrajectory(from, to, durationMs) {
  const duration = Math.max(1, durationMs);
  const travelShare = 0.22;
  return [
    {
      progress: 0,
      position: { ...from, height: 0 },
      velocity: {
        x: (to.x - from.x) / (duration * travelShare),
        y: (to.y - from.y) / (duration * travelShare),
      },
    },
    { progress: travelShare, position: { ...to, height: 0 }, velocity: { x: 0, y: 0 } },
    { progress: 1, position: { ...to, height: 0 }, velocity: { x: 0, y: 0 } },
  ];
}

/** Execute one awarded in-match restart and mutate only the run-local state. */
function executeAutomaticRestart({
  result, simulated, simulatedRoster, trace, motionContext, seed, restartIndex, matchSession = false,
}) {
  if (!AUTOMATIC_RESTART_TYPES.has(result?.restart) && !(matchSession && ["kickoff", "free-kick", "indirect-free-kick", "penalty"].includes(result?.restart))) return null;
  const takingTeam = automaticRestartTakingTeam(result, simulatedRoster, simulated.ballState);
  if (!takingTeam) return null;
  const side = automaticRestartSide(result);
  const type = ["indirect-free-kick", "penalty"].includes(result.restart) ? "free-kick" : result.restart;
  const variant = result.restart === "penalty" ? "direct" : automaticRestartVariant(type, takingTeam, simulatedRoster);
  const restart = createRestartSetup({
    type,
    takingTeam,
    attackingDirectionByTeam: state.attackingDirection,
    side,
    spot: result.restart === "penalty"
      ? { x: 50, y: state.attackingDirection[takingTeam] === "up" ? RESTART_PENALTY_DEPTH : 100 - RESTART_PENALTY_DEPTH }
      : result.ballEnd ?? simulated.ballPoint,
    takerId: "pending",
    variant,
  });
  const teams = Object.fromEntries(
    [...new Set(simulatedRoster.map((entry) => entry.team).filter(Boolean))]
      .map((team) => [team, { entries: simulatedRoster
        .filter((entry) => entry.team === team)
        // Hand-authored probes and legacy saved scenarios may predate
        // positionalSlot. Restart suitability still needs a safe football
        // band; the live entry remains untouched and IDs map assignments
        // back onto the authoritative clone below.
        .map((entry) => ({
          ...entry,
          positionalSlot: entry.positionalSlot ?? (entry.role === "keeper" ? "GK" : "MC"),
        })) }]),
  );
  const cornerPlans = state.cornerPlans ?? Object.fromEntries(
    ["home", "away"]
      .map((team) => [team, state.matchSetupDraft?.[team]?.cornerPlan ?? null])
      .filter(([, plan]) => plan),
  );
  const placed = placeRestartParticipants(restart, teams, { cornerPlans });
  if (!placed.takerId) return null;
  const taker = simulatedRoster.find((entry) => entry.id === placed.takerId) ?? null;
  if (result.restart === "penalty") {
    const up = state.attackingDirection[takingTeam] === "up";
    for (const entry of simulatedRoster) {
      if (entry.id === placed.takerId) continue;
      const point = placed.placements.get(entry.id) ?? pointOf(entry);
      const penaltyPoint = entry.role === "keeper"
        ? { x: 50, y: entry.team === takingTeam ? (up ? 96 : 4) : (up ? 0 : 100) }
        : { x: point.x, y: up ? Math.max(28, point.y) : Math.min(72, point.y) };
      placed.placements.set(entry.id, { ...penaltyPoint, zone: zoneFromPercent(penaltyPoint.x, penaltyPoint.y) });
    }
    placed.wallIds = [];
  }
  const takerSpot = placed.placements.get(placed.takerId) ?? null;
  if (!taker || !takerSpot) return null;
  // Every supported live restart dispatches to a pass/cross resolver. A
  // partial developer probe with only its taker and goalkeeper cannot put
  // that ball into play; leave its dead-ball result intact rather than
  // asking a resolver to invent a receiver.
  const targetExists = simulatedRoster.some((entry) =>
    entry.team === takingTeam && entry.id !== placed.takerId && entry.role !== "keeper");
  if (!targetExists) return null;
  // Use the concrete taker placement as the single canonical ball spot.
  // restartSetup's yard/percent mirror can differ by a few floating-point
  // ulps from layoutPositions; allowing both representations through made
  // the setup's ballTo and the take's ballFrom fail exact continuity.
  const nominatedBall = {
    ...takerSpot,
    zone: zoneFromPercent(takerSpot.x, takerSpot.y),
  };
  const longThrow = type === "throw-in"
    && qualifiesForLongThrow(taker.player)
    && ["direct", "long-ball"].includes(attackingSettingsFor(takingTeam).style);
  const nominated = {
    ...restart,
    ball: nominatedBall,
    takerId: placed.takerId,
    variant: longThrow
      ? "long"
      : placed.corner?.delivery?.target === "short" ? "short" : restart.variant,
    corner: placed.corner ?? null,
  };
  const concrete = simulatedRoster.map((entry) => {
    const point = placed.placements.get(entry.id) ?? pointOf(entry);
    return { ...entry, ...point, required: entry.id === placed.takerId };
  });
  const legality = validateRestartSetup(nominated, {
    taking: concrete.filter((entry) => entry.team === takingTeam),
    defending: concrete.filter((entry) => entry.team !== takingTeam),
  });
  if (!legality.valid) { if (matchSession) throw new Error(`Illegal ${result.restart}: ${legality.errors.join("; ")}`); return null; }

  for (const entry of simulatedRoster) {
    entry.formationAnchor ||= pointOf(entry);
  }
  const setupMoves = simulatedRoster.flatMap((entry) => {
    const destination = placed.placements.get(entry.id) ?? pointOf(entry);
    const to = { ...destination, zone: zoneFromPercent(destination.x, destination.y) };
    if (yardDistance(pointOf(entry), to) <= 0.001) return [];
    return [{ entry, from: pointOf(entry), to }];
  });
  const setupDurationMs = Math.max(
    900,
    ...setupMoves.map(({ entry, from, to }) =>
      Math.ceil(timeToReach(entry.player, yardDistance(from, to)) * 1000)),
  );
  const authoredMoves = setupMoves.map(({ entry, from, to }) => ({
    player: entry,
    from,
    to,
    action: "restart-setup",
    trajectory: sampleContinuousTrajectory({
      from,
      to,
      player: entry.player,
      totalMs: setupDurationMs,
      reactionDelayMs: 0,
      paceToArrival: true,
      sampleCount: Math.max(10, Math.min(48, Math.ceil(setupDurationMs / 180))),
    }),
  }));
  const setupTraceStart = trace.length;
  let deadBallFrom = { ...simulated.ballPoint };
  if (result.restart === "throw-in") {
    const outside = throwInOutsidePoint(deadBallFrom, side);
    trace.push(traceEvent("RESTART.WAIT", "The ball rolls clear before the throw-in is prepared", {
      movement: "roll",
      outcome: "neutral",
      duration: THROW_IN_OUT_OF_PLAY_PAUSE_MS,
      ballFrom: deadBallFrom,
      ballTo: outside,
      ballTrajectory: outOfPlayTrajectory(deadBallFrom, outside, THROW_IN_OUT_OF_PLAY_PAUSE_MS),
      ballResult: "dead",
      ownerBefore: null,
      ownerAfter: null,
      restart: "throw-in",
    }));
    deadBallFrom = outside;
  }
  const deadBallTo = { ...nominated.ball, zone: zoneFromPercent(nominated.ball.x, nominated.ball.y) };
  trace.push(traceEvent(
    "RESTART.SETUP",
    `${takingTeam === "home" ? "Home" : "Away"} prepare the ${nominated.type}`,
    {
      actor: taker,
      movement: "reposition",
      outcome: "neutral",
      duration: setupDurationMs,
      playerMoves: authoredMoves,
      ballFrom: deadBallFrom,
      ballTo: deadBallTo,
      ballTrajectory: straightDeadBallTrajectory(deadBallFrom, deadBallTo, setupDurationMs),
      ballResult: "dead",
      contact: { point: deadBallTo, actor: taker, type: "placement", phase: "end" },
      contactTiming: "sequential",
      ownerBefore: null,
      ownerAfter: taker,
      ownerAfterAt: "end",
      restart: nominated.type,
    },
  ));
  commitAuthoritativeMoves(trace, simulatedRoster, motionContext, setupTraceStart);
  for (const entry of simulatedRoster) {
    entry.restartRole = placed.roles.get(entry.id) ?? null;
    entry.restartSubjectId = placed.subjects?.get(entry.id) ?? null;
    const finalPoint = pointOf(entry);
    writeMotionRecord(motionContext, entry.id, {
      position: finalPoint,
      velocity: { x: 0, y: 0 },
      intention: null,
      intentionTarget: finalPoint,
      simulationTimeMs: (motionContext.simulationTimeMs ?? 0) + setupDurationMs,
    });
  }
  motionContext.simulationTimeMs = (motionContext.simulationTimeMs ?? 0) + setupDurationMs;
  motionContext.marking = {};
  motionContext.teamShapeJobs = {};
  motionContext.restartContext = {
    status: "restart",
    direct: nominated.variant === "long",
    type: nominated.type,
    variant: nominated.variant,
    style: attackingSettingsFor(takingTeam).style,
  };
  motionContext.teamPhase = updateTeamPhaseState(
    motionContext.teamPhase,
    {
      possessionTeam: takingTeam,
      owner: taker,
      ballFrom: deadBallFrom,
      ballPoint: deadBallTo,
      attackingDirectionByTeam: state.attackingDirection,
      restartActive: true,
    },
    setupDurationMs,
  );
  simulated.ownerId = taker.id;
  simulated.ballPoint = deadBallTo;
  simulated.ballState = transitionBallState({
    previous: simulated.ballState,
    endpoint: deadBallTo,
    ownerId: taker.id,
    ownerRole: taker.role,
    restart: nominated.type,
    trajectory: straightDeadBallTrajectory(deadBallFrom, deadBallTo, setupDurationMs),
    lastTouchId: taker.id,
    lastTouch: { playerId: taker.id, team: takingTeam, bodyPart: "unknown", deliberate: false, restart: nominated.type },
  });

  appendRestartPreparation({
    restart: nominated,
    taker,
    trace,
    motionContext,
    random: seededRandom(hashString(
      `match-lab:auto-restart-preparation:${seed}:${restartIndex}:${nominated.type}:${takingTeam}`,
    )),
    attackingGoalY: attackingGoalYForDirection(state.attackingDirection[takingTeam]),
    attacking: attackingSettingsFor(takingTeam),
    roster: simulatedRoster,
    takingTeam,
  });
  const restartGroups = freePlayGroups(taker.id, simulatedRoster, simulated.ballState);
  const openingStyle = attackingSettingsFor(takingTeam).style;
  const directOpening = nominated.variant === "long"
    || openingStyle === "direct" || openingStyle === "long-ball";
  motionContext.restartContext = {
    status: "restart-release", direct: directOpening,
    type: nominated.type, variant: nominated.variant, style: openingStyle,
  };
  motionContext.teamPhase = updateTeamPhaseState(
    motionContext.teamPhase,
    {
      possessionTeam: takingTeam,
      owner: taker,
      ballFrom: deadBallTo,
      ballPoint: deadBallTo,
      attackingDirectionByTeam: state.attackingDirection,
      restartActive: false,
      restartTaken: true,
      directRestart: directOpening,
    },
    0,
  );
  const kickoffInstruction = attackingSettingsFor(takingTeam).kickoff;
  if (nominated.type === "kickoff") motionContext.kickoffPlan = { team: takingTeam, instruction: kickoffInstruction, remaining: 3 };
  const restartTraceStart = trace.length;
  let nextResult = executeRestart({
    restart: { ...nominated, ball: deadBallTo, openingStyle, kickoffInstruction },
    groups: restartGroups,
    resolvers: result.restart === "penalty" ? { ...FREE_PLAY_RESOLVERS, "direct-free-kick": resolveShoot } : FREE_PLAY_RESOLVERS,
    random: seededRandom(hashString(
      `match-lab:auto-restart:${seed}:${restartIndex}:${nominated.type}:${takingTeam}`,
    )),
    trace,
    motionContext,
    traceEvent,
    playerName,
    attackingGoalY: attackingGoalYForDirection(state.attackingDirection[takingTeam]),
  });
  if (result.restart === "penalty") {
    const take = trace.slice(restartTraceStart).find((event) => event.code === "RESTART.FREE_KICK.TAKE");
    if (take) { take.code = "RESTART.PENALTY.TAKE"; take.label = `${playerName(taker.player)} takes the penalty`; }
  }
  commitAuthoritativeMoves(trace, simulatedRoster, motionContext, restartTraceStart);
  const restartTrace = trace.slice(restartTraceStart);
  const lastBallEvent = restartTrace.slice().reverse().find((event) => event.ballTrajectory?.length);
  const lastTouchEvent = restartTrace.slice().reverse().find((event) => event.lastTouch);
  simulated.ballPoint = nextResult.ballEnd ?? simulated.ballPoint;
  const liveOwner = nextResult.nextOwnerId
    ? simulatedRoster.find((entry) => entry.id === nextResult.nextOwnerId) ?? null
    : null;
  simulated.ownerId = nextResult.nextOwnerId ?? null;
  simulated.ballState = transitionBallState({
    previous: simulated.ballState,
    endpoint: simulated.ballPoint,
    ownerId: simulated.ownerId,
    ownerRole: liveOwner?.role ?? null,
    restart: nextResult.restart ?? null,
    trajectory: lastBallEvent?.ballTrajectory ?? [],
    lastTouchId: lastTouchEvent?.lastTouch?.playerId ?? liveOwner?.id ?? null,
    lastTouch: lastTouchEvent?.lastTouch ?? null,
  });
  if (nominated.type === "kickoff" && liveOwner && motionContext.kickoffPlan) motionContext.kickoffPlan.firstSide = liveOwner.x <= 50 ? -1 : 1;
  if (liveOwner && !nextResult.restart) {
    const release = applyRestartRelease(
      simulatedRoster, liveOwner.team, trace, motionContext, liveOwner.id,
    );
    if (release?.ballEnd) {
      simulated.ballPoint = release.ballEnd;
      simulated.ballState = transitionBallState({
        previous: simulated.ballState,
        endpoint: release.ballEnd,
        ownerId: liveOwner.id,
        ownerRole: liveOwner.role,
        trajectory: release.ballTrajectory ?? [],
        lastTouchId: liveOwner.id,
        lastTouch: { playerId: liveOwner.id, team: liveOwner.team, bodyPart: "foot", deliberate: true },
      });
      nextResult = { ...nextResult, ballEnd: release.ballEnd };
    }
  }
  return nextResult;
}

function runConstructedPossession(seed, { continuation = null, maxActions = POSSESSION_MAX_ACTIONS, matchSession = false, stopAtStoppage = false } = {}) {
  const authoredOwner =
    state.roster.find((entry) => entry.id === (continuation?.simulated.ownerId ?? state.ball.ownerId)) || (continuation ? state.roster[0] : null);
  const trace = [];
  const decisionMetrics = [];
  const restartExpected = !continuation && Boolean(
    state.ball?.deadBall || state.pendingRestart || state.restartSetupDraft,
  );
  if (restartExpected && !pendingRestartIsReady()) {
    return {
      result: {
        outcome: "INVALID RESTART",
        code: "RESTART.INVALID",
        resolved: false,
        terminal: true,
        possession: "dead",
        nextOwnerId: null,
        ballEnd: { x: state.ball?.x ?? 50, y: state.ball?.y ?? 50 },
        restart: state.pendingRestart?.type ?? state.restartSetupDraft?.type ?? null,
        reason: "incomplete-authored-restart",
      },
      trace,
      finalOwnerId: null,
      actionsCount: 0,
      finalPositions: state.roster.map((entry) => ({ ...entry })),
      decisionMetrics,
      possessionMetrics: {
        decisions: 0, passesSelected: 0, carriesSelected: 0, shotsSelected: 0,
        meanLegalPassingOptions: 0, minimumLegalPassingOptions: 0,
        meanPressureAtDecision: 0, meanShotDistanceYards: null,
        meanShotDistanceMetres: null,
      },
    };
  }
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
        meanShotDistanceMetres: null,
      },
    };
  }

  const simulatedRoster = (continuation?.roster ?? state.roster).map((entry) => ({ ...entry }));
  // Burst Stamina v1 (2026-08-31) -- see BURST_BASE's own header for the
  // two-tank rationale. match01 is read from the REAL, unchanged
  // conditionMultiplier() curve (matchEngineCore.js) -- Match Lab always
  // resolves at FIXED_MINUTE, so this barely moves within one
  // possession, exactly as intended; burst01 starts at a real,
  // Stamina-scaled fraction of THAT ceiling (a tired match already caps
  // how much burst is even available, before a single action happens)
  // and can never exceed it afterward either. Both are possession-local,
  // attached directly to simulatedRoster -- the SAME per-possession
  // clone lastCarryDirectionX/Y already writes onto -- never the shared
  // roster/database player object.
  for (const entry of simulatedRoster) {
    if (!continuation) Object.assign(entry, freshBurst01(entry.player));
  }
  // marking (2026-08-24, Off-Ball v2) -- sticky man/zonal assignment,
  // { [defenderId]: { subjectId, mode, tightness } }, carried forward the
  // same way motionContext.state already is for previousSupportId/
  // previousDropId. Rebuilt from each reaction's own planDefensiveRepositioning()
  // results (see reactOffBallContinuous()/reactOffBall()'s own persistence
  // block) -- never mutated by spatialDecision.js itself, which stays a
  // pure function throughout.
  const teamIds = [...new Set(simulatedRoster.map((entry) => entry.team).filter(Boolean))];
  const startingPossessionTeam = simulatedRoster.find((entry) => entry.id === authoredOwner.id)?.team ?? null;
  const startsFromRestart = !continuation && Boolean(state.pendingRestart && state.restartSetupDraft);
  const motionContext = continuation?.motionContext ?? {
    seed,
    state: createMotionState(),
    marking: {},
    teamPhase: createTeamPhaseState({
      teams: teamIds,
      possessionTeam: startingPossessionTeam,
      restartActive: startsFromRestart,
    }),
    teamShapeJobs: {},
    shapeSnapshots: [],
    coordination: createCoordinationState(seed),
    coordinationSnapshots: [],
    simulationTimeMs: 0,
    restartContext: startsFromRestart
      ? { status: "restart", direct: false, type: state.pendingRestart.type }
      : null,
  };
  const initialShapeMetrics = Object.fromEntries(teamIds.map((team) => [
    team,
    teamShapeMetrics(simulatedRoster.filter((entry) => entry.team === team), {
      ballPoint: pointOf(authoredOwner),
      ownerId: authoredOwner.id,
      attackingDirection: state.attackingDirection[team],
    }),
  ]));
  // Engagement Breaker v1 (2026-08-28) -- per-possession memory of the
  // last hold/duel engagement, reset fresh for every possession (never
  // persisted across them). See generateFreePlayCandidates()'s own
  // consumption of this (spatialDecision.js) for the full reported-bug
  // rationale: without it, "hold" and dribble/back-to-goal against the
  // SAME just-contested opponent were always legal candidates again on
  // the very next decision, which is how a shield/duel could wrestle
  // indefinitely without the ball ever actually moving on.
  const engagementHistory = continuation?.engagementHistory ?? { consecutiveHoldOwnerId: null, recentPairs: [] };
  // Bugfix slice (2026-09-02) -- a real reported bug: a congested midfield
  // pile could hot-potato short passes/holds among itself indefinitely.
  // engagementHistory above only ever bans the SAME single player from
  // holding twice in a row, or the SAME owner/opponent pair re-engaging --
  // neither notices "this GROUP has been going nowhere for N actions in a
  // row," regardless of who's currently touching it. Reset fresh per
  // possession, same convention as engagementHistory; consumed by
  // passUtility()/holdUtility() (spatialDecision.js) via context.congestionStreak.
  const congestionTracker = continuation?.congestionTracker ?? { lowProgressionStreak: 0 };
  let simulated = continuation?.simulated ?? {
    ownerId: authoredOwner.id,
    ballPoint: pointOf(authoredOwner),
    ballState: createBallState({
      position: pointOf(authoredOwner),
      ownerId: authoredOwner.id,
      ownerRole: authoredOwner.role,
    }),
  };
  let result = continuation?.result ? { ...continuation.result } : null;
  // Match chunks can end while a restart delivery or second ball is still
  // loose. `simulated.ballPoint` is the authoritative sampled position at
  // that boundary; the prior resolver's `result.ballEnd` may still name the
  // later point it would have reached had the chunk continued. Resume the
  // race from the sampled ball, including its live velocity, so the next
  // chunk cannot begin by teleporting the ball to that stale future point.
  if (continuation && !simulated.ownerId && result?.possession === "loose" && simulated.ballPoint) {
    result = {
      ...result,
      ballEnd: { ...simulated.ballPoint },
      ballVelocity: simulated.ballState?.velocity
        ? { ...simulated.ballState.velocity }
        : (result.ballVelocity ?? { x: 0, y: 0 }),
      ballVelocityPhase: simulated.ballState?.phase === "loose" ? "rolling" : result.ballVelocityPhase,
    };
  }
  let actionsCount = 0;
  let endedByStoppage = false;
  let automaticRestartCount = 0;

  // Restart Execution v2 (2026-09-04) -- an authored dead ball must have
  // its own RESTART.*.TAKE resolved BEFORE the possession loop below is
  // allowed to generate a single candidate. This is the boundary Match
  // Setup Integration v1 stopped at: the restart is now executed by the
  // real resolvers (see src/lib/restartExecution.js) and only its OUTCOME
  // feeds the ordinary loop, so a restart can never fall straight into a
  // generic ACTION.CHOICE.
  if (!continuation && state.pendingRestart && state.restartSetupDraft) {
    const restartGroups = freePlayGroups(simulated.ownerId, simulatedRoster, simulated.ballState);
    if (restartGroups.owner) {
      const restartRandom = seededRandom(
        hashString(`match-lab:restart:${state.pendingRestart.type}:${seed}`),
      );
      const restartAttackingGoalY = attackingGoalYForDirection(
        state.attackingDirection[restartGroups.owner.team],
      );
      const kickoffInstruction = attackingSettingsFor(restartGroups.owner.team).kickoff;
      if (state.pendingRestart.type === "kickoff") motionContext.kickoffPlan = {
        team: restartGroups.owner.team, instruction: kickoffInstruction, remaining: 3,
      };
      const openingStyle = attackingSettingsFor(restartGroups.owner.team).style;
      const directOpening = state.restartSetupDraft.variant === "long"
        || openingStyle === "direct" || openingStyle === "long-ball";
      const authoredRestart = {
        ...state.restartSetupDraft,
        ball: simulated.ballPoint,
        openingStyle,
        kickoffInstruction,
      };
      appendRestartPreparation({
        restart: authoredRestart,
        taker: restartGroups.owner,
        trace,
        motionContext,
        random: seededRandom(hashString(
          `match-lab:restart-preparation:${state.pendingRestart.type}:${seed}`,
        )),
        attackingGoalY: restartAttackingGoalY,
        attacking: attackingSettingsFor(restartGroups.owner.team),
        roster: simulatedRoster,
        takingTeam: restartGroups.owner.team,
      });
      motionContext.restartContext = {
        status: "restart-release",
        direct: directOpening,
        type: state.pendingRestart.type,
        variant: state.restartSetupDraft.variant,
        style: openingStyle,
      };
      motionContext.teamPhase = updateTeamPhaseState(
        motionContext.teamPhase,
        {
          possessionTeam: restartGroups.owner.team,
          owner: restartGroups.owner,
          ballFrom: simulated.ballPoint,
          ballPoint: simulated.ballPoint,
          attackingDirectionByTeam: state.attackingDirection,
          restartActive: false,
          restartTaken: true,
          directRestart: directOpening,
        },
        0,
      );
      result = executeRestart({
        restart: authoredRestart,
        groups: restartGroups,
        resolvers: FREE_PLAY_RESOLVERS,
        random: restartRandom,
        trace,
        motionContext,
        traceEvent,
        playerName,
        attackingGoalY: restartAttackingGoalY,
      });
      // Commit the restart's own authoritative moves exactly as the loop
      // below commits an action's, so the next decision reads real
      // positions rather than the dead-ball layout.
      commitAuthoritativeMoves(trace, simulatedRoster, motionContext);
      simulated.ballPoint = result.ballEnd ?? simulated.ballPoint;
      simulated.ballState = transitionBallState({
        previous: simulated.ballState,
        endpoint: simulated.ballPoint,
        ownerId: result.nextOwnerId ?? null,
        ownerRole: simulatedRoster.find((entry) => entry.id === result.nextOwnerId)?.role ?? null,
        restart: result.restart ?? null,
        lastTouch: trace.slice().reverse().find((event) => event.lastTouch)?.lastTouch ?? null,
      });
      simulated.ownerId = result.nextOwnerId;
      // The ball is live now. Release the restart shape: every player heads
      // for their own open-play job through the ordinary motion system, so
      // Pace and Acceleration govern the travel and nobody teleports.
      const liveOwner = simulatedRoster.find((entry) => entry.id === result.nextOwnerId) ?? null;
      if (state.pendingRestart.type === "kickoff" && liveOwner && motionContext.kickoffPlan) motionContext.kickoffPlan.firstSide = liveOwner.x <= 50 ? -1 : 1;
      const release = applyRestartRelease(
        simulatedRoster,
        liveOwner?.team ?? restartGroups.owner.team,
        trace,
        motionContext,
        result.nextOwnerId,
      );
      if (release?.ballEnd && liveOwner) {
        simulated.ballPoint = release.ballEnd;
        simulated.ballState = transitionBallState({
          previous: simulated.ballState,
          endpoint: simulated.ballPoint,
          ownerId: liveOwner.id,
          ownerRole: liveOwner.role,
          trajectory: release.ballTrajectory ?? [],
          lastTouchId: liveOwner.id,
          lastTouch: { playerId: liveOwner.id, team: liveOwner.team, bodyPart: "foot", deliberate: true },
        });
      }
      if (!result.nextOwnerId || result.restart) {
        endedByStoppage = true;
      }
    }
  }

  // An authored restart can itself go out. Continue that award too, using
  // exactly the same dispatch as an exit from ordinary play.
  while (result?.restart && (AUTOMATIC_RESTART_TYPES.has(result.restart) || matchSession) && automaticRestartCount < MAX_AUTOMATIC_RESTARTS) {
    const resumed = executeAutomaticRestart({ result, simulated, simulatedRoster, trace, motionContext, seed, restartIndex: automaticRestartCount, matchSession });
    if (!resumed) break;
    result = resumed;
    automaticRestartCount += 1;
    endedByStoppage = !result.nextOwnerId || Boolean(result.restart);
  }
  if (result?.restart) endedByStoppage = true;
  if (result?.possession === "loose" && !result.restart) {
    endedByStoppage = false;
    if (startsFromRestart) trace.push(traceEvent("RESTART.RELEASE", "The ball is live; both teams contest the loose reception", { duration: 0, outcome: "neutral" }));
  }
  for (; !endedByStoppage && actionsCount < maxActions; actionsCount += 1) {
    const resumingLoose = !simulated.ownerId && !result?.restart && result?.possession === "loose";
    const groups = freePlayGroups(
      simulated.ownerId ?? (resumingLoose ? simulated.ballState?.lastTouch?.playerId ?? simulatedRoster[0]?.id : null),
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
      attackingSettingsFor(groups.owner.team),
      engagementHistory,
      congestionTracker,
      JOINT_CANDIDATE_DEPS,
    );
    if (resumingLoose) candidates.splice(0, candidates.length, { type: "resume-loose", utility: 1 });
    const decisionCoordination = resumingLoose ? null : updateLiveCoordination(
      motionContext,
      simulatedRoster,
      groups.owner.id,
      simulated.ballPoint,
      motionContext.simulationTimeMs ?? 0,
      { reason: "on-ball-decision" },
    );
    if (decisionCoordination) applyCoordinationCandidateBiases(candidates, decisionCoordination);
    if (motionContext.kickoffPlan?.team !== groups.owner.team) motionContext.kickoffPlan = null;
    applyKickoffInstructions(candidates, groups, state.attackingDirection[groups.owner.team], motionContext.kickoffPlan);
    // Joint Passer/Runner Candidate Generation v1 (Stage 3) -- the leading
    // pass/run ideas this decision considered, kept for the read-only
    // diagnostics panel. Recorded BEFORE selection and never read back by
    // the engine, so it cannot influence a choice or consume a draw.
    recordJointCandidates(candidates);
    const decision = chooseCandidate(
      candidates,
      groups.owner.player,
      decisionRandom,
    );
    const distanceToGoal = distanceToGoalYards(
      groups.owner,
      state.attackingDirection[groups.owner.team],
    );
    const optionMetrics = {
      ...decisionOptionMetrics(candidates, groups),
      decisionIndex: actionsCount,
      ownerId: groups.owner.id,
      distanceToGoalYards: distanceToGoal,
      distanceToGoalMetres: distanceToGoal * 0.9144,
      longRangeShotConfidence: longRangeShotConfidence(groups.owner.player),
      shootingInstruction: shootingInstructionFor(
        groups.owner, attackingSettingsFor(groups.owner.team),
      ),
      selectedAction: decision?.type ?? null,
      coordination: decisionCoordination?.evidence ?? null,
    };
    // A continuing loose-ball race has no new owner decision or choice cue.
    // Keep the summary aligned with the actual decisions in the replay.
    if (!resumingLoose) decisionMetrics.push(optionMetrics);
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
    if (!resumingLoose) trace.push(
      traceEvent(
        "ACTION.CHOICE",
        decision.kickoffTerritory
          ? `${playerName(groups.owner.player)} aims for an attacking-third throw-in so the team can press`
          : decision.target
          ? `${playerName(groups.owner.player)} chooses to ${decision.type} to ${playerName(decision.target.player)} · ${optionMetrics.legalPassingOptions} legal pass option${optionMetrics.legalPassingOptions === 1 ? "" : "s"}`
          : decision.type === "shoot"
            ? `${playerName(groups.owner.player)} chooses to shoot from ${optionMetrics.distanceToGoalMetres.toFixed(1)} m (${optionMetrics.shootingInstruction === "encourage" ? "Shoot more" : optionMetrics.shootingInstruction === "discourage" ? "Shoot less" : "Balanced"}) · ${optionMetrics.legalPassingOptions} legal pass option${optionMetrics.legalPassingOptions === 1 ? "" : "s"}`
            : `${playerName(groups.owner.player)} chooses to ${decision.type} · ${optionMetrics.legalPassingOptions} legal pass option${optionMetrics.legalPassingOptions === 1 ? "" : "s"}`,
        {
          actor: groups.owner,
          outcome: "neutral",
          metrics: optionMetrics,
          coordination: decisionCoordination?.evidence ?? null,
        },
      ),
    );
    // Engagement Breaker v1 -- record what THIS decision was, for the
    // NEXT ones' own candidate generation (generateFreePlayCandidates()/
    // holdUtility(), spatialDecision.js). Each entry in recentPairs is
    // UNORDERED (aId/bId, not ownerId/opponentId): a lost shield/duel
    // swaps who owns the ball, so the winner's own very next decision
    // has them as owner and the original holder as engager -- the
    // reverse of this decision's own roles, which an ordered pair would
    // never catch (a real fuzz-test-caught bug; see isSamePair()'s own
    // comment, spatialDecision.js).
    //
    // A real reported bug (2nd fuzz catch): tracking a SINGLE "last pair"
    // slot meant engaging a DIFFERENT opponent in between silently
    // discarded the original pair's own still-active 4-action ban --
    // wrestler A vs B, then a legal beat against C, then A vs B was
    // immediately legal again with no ban in effect. recentPairs is now
    // a list: every entry ages by one on every decision and expires
    // independently once its own actionsAgo reaches 4, so an unrelated
    // engagement in between can no longer erase an older pair's ban.
    engagementHistory.consecutiveHoldOwnerId = decision.type === "hold" ? groups.owner.id : null;
    engagementHistory.recentPairs = engagementHistory.recentPairs
      .map((pair) => ({ ...pair, actionsAgo: pair.actionsAgo + 1 }))
      .filter((pair) => pair.actionsAgo < 4);
    if (decision.type === "hold" || decision.type === "dribble" || decision.type === "back-to-goal") {
      const engagedOpponent = engagingOpponent(groups.owner, groups.opponents);
      if (engagedOpponent) {
        engagementHistory.recentPairs.push({ aId: groups.owner.id, bId: engagedOpponent.id, actionsAgo: 0 });
      }
    }
    const availability = {
      preselectedTargetId: decision.target ? decision.target.id : null,
      plannedMoveTo: decision.moveTo || null,
      offside: decision.offside || null,
      // Keeper Catch & Distribution v1's throw-short/throw-long candidates
      // (spatialDecision.js) name this explicitly -- a hand throw must
      // never be resolved through selectPassType()'s own kicked-ball
      // physics, whatever distance/lane geometry it would otherwise pick.
      forcedPassType: decision.forcedPassType || null,
      // Keep execution on the exact delivery the joint candidate judged.
      // In particular, a controlled ball to a slow receiver's feet must not
      // be reselected as a driven pass after ACTION.CHOICE.
      plannedPassType: decision.joint?.passType || null,
      // A joint candidate always has a planned point, including a genuine
      // pass to the receiver's current feet. Preserve the candidate's own
      // semantic intent so execution and diagnostics do not misclassify
      // every explicit point as a pass into space.
      plannedDeliveryIntent: decision.joint?.meetingPointKind
        ?? (decision.moveTo ? "planned-space" : "current-position"),
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
    if (decision.kickoffTerritory) motionContext.territoryPress = { team: groups.owner.team, untilMs: (motionContext.simulationTimeMs ?? 0) + 20000 };
    if (motionContext.kickoffPlan?.remaining > 0) {
      motionContext.kickoffPlan.firstSide ??= (decision.target?.x ?? groups.owner.x) <= 50 ? -1 : 1;
      motionContext.kickoffPlan.remaining -= 1;
    }
    const actionTraceStart = trace.length;
    result = resumingLoose ? result : FREE_PLAY_RESOLVERS[decision.type](
      groups,
      availability,
      executionRandom,
      trace,
      true,
      motionContext,
    );
    // Burst Stamina v1 -- drains the ACTOR of this decision only (never a
    // reactor/off-ball player) by the REAL distance they just covered.
    // result.gait is only ever set by resolveCarry()/resolveDribble()'s
    // own WON branch; every other resolver (hold/pass/shoot/...) drains
    // a flat, negligible token amount instead (see drainOnBallAction()'s
    // own ON_BALL_OTHER_ACTION_YARDS).
    // Stage 5 -- the real world time this action occupied, so the drain can be
    // priced from speed rather than from the gait's name. Primary intervals
    // only: an overlapping beat shares the same wall clock and would
    // double-count it.
    const onBallSpanMs = trace.slice(actionTraceStart).reduce(
      (total, event) => total + (event.overlapWithPrevious ? 0 : (Number(event.duration) || 0)),
      0,
    );
    drainOnBallAction(
      groups.owner, result.gait,
      result.ballEnd ? yardDistance(simulated.ballPoint, result.ballEnd) : 0,
      onBallSpanMs,
    );
    // Bugfix slice -- see congestionTracker's own header above. Computed
    // from the REAL resolved outcome (ballEnd), not the decision alone --
    // a short pass that's actually intercepted/lost still counts toward
    // the streak (it genuinely went nowhere either way), while any OTHER
    // kind of decision (carry, cross, through, shoot, dribble) resets it
    // outright -- exactly the "raise carry-away/switch/through" half of
    // the fix, achieved by letting THOSE options win on their own merits
    // once hold/short-pass are crushed, never by inventing a bonus for them.
    const congestionNetProgression = result.ballEnd
      ? progressionYards(simulated.ballPoint, result.ballEnd, state.attackingDirection[groups.owner.team])
      : 0;
    const congestionShortStall = decision.type === "hold"
      || (decision.type === "pass" && yardDistance(groups.owner, decision.target ?? groups.owner) < CONGESTION_SHORT_PASS_YARDS);
    congestionTracker.lowProgressionStreak = (congestionShortStall && congestionNetProgression < CONGESTION_MIN_PROGRESSION_YARDS)
      ? congestionTracker.lowProgressionStreak + 1
      : 0;
    // Physical windows continue existing jobs. This never generates a fresh
    // off-ball target or consumes another decision draw during a hold.
    if (!result.offBallInterleaved) {
      const produced = trace.splice(actionTraceStart);
      let continuedIntentions = false;
      const involved = produced.flatMap(event => [event.actorId, event.targetId,
        event.defenderId, event.keeperId, ...(event.playerMoves || []).map(move => move.playerId)]);
      for (const event of produced) {
        trace.push(event);
        if (event.timelineRole === "cue" || event.overlapWithPrevious || !event.duration) continue;
        const moves = continueMotionIntentions(simulatedRoster, motionContext, event.duration, involved);
        if (moves.length) {
          continuedIntentions = true;
          trace.push(traceEvent("MOTION.CONTINUE", "Players continue their committed jobs", {
            movement: "reposition", duration: event.duration, overlapWithPrevious: true, playerMoves: moves,
          }));
        }
      }
      result.intentionsContinued = continuedIntentions;
    }
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
        // Commit the carrier's actual outgoing stride. Previously the roster
        // position changed but its motion record stayed stale, so each fresh
        // carry restarted from rest while pursuing defenders kept momentum.
        if (move.trajectory?.length && String(event.ownerAfterId) === String(move.playerId)
            && ["touch", "dribble"].includes(event.movement)) {
          writeMotionRecord(motionContext, move.playerId, {position:move.to,
            velocity:move.trajectory.at(-1).velocity,intention:"carry",intentionTarget:move.to});
        }
        // Gameplay v3.2 -- this used to zero velocity/intention for EVERY
        // non-reposition move (reception, touch, dribble, tackle,
        // interception, advance...), not just a genuine stand-still. A
        // receiver taking a touch, or a carrier mid-dribble, is not
        // planting -- their next off-ball-style call (a knock-on's own
        // trailing reaction, or simply becoming off-ball themselves later
        // in the possession) inherits this SAME motionContext entry via
        // sampleContinuousTrajectory()'s own incomingVelocity, so zeroing
        // it here restarted their run from rest for no football reason.
        // Contact-pin already wins for the actor's own RENDERED position
        // at the moment of contact (playback's own stationaryContact/
        // contactArrivalTiming paths, unaffected by this). "hold" (Hold-Up
        // Play, GK.HOLD) is the one movement that IS a genuine, deliberate
        // stand-still -- that one still zeroes.
        if (
          event.movement === "hold" &&
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
      const looseReleasePoint = { ...result.ballEnd };
      const looseState = transitionBallState({
        previous: simulated.ballState,
        endpoint: result.ballEnd,
        ownerId: null,
        trajectory: lastBallEvent?.ballTrajectory || [],
        lastTouchId: lastTouchEvent?.lastTouch?.playerId ?? null,
        lastTouch: lastTouchEvent?.lastTouch ?? null,
      });
      // Dynamic Ball Claim v2 (2026-09-04) -- selectLooseBallRecovery() is
      // kept as the STATIC fallback only: it answers "who is nearest" from a
      // 320ms predictBallPosition() look-ahead, which is the right question
      // when there is no real momentum to race (every "possession: loose"
      // producer that carries no ballVelocity) and the wrong one the moment
      // the ball is genuinely rolling. Where there IS real momentum, this is
      // replaced below by claimLooseBall(), which races the ACTUAL
      // decelerating roll across its whole length. Measured, at a real
      // through-ball landing speed of 26 yd/s: the 320ms prediction sees the
      // ball 5.8 yards from where it went loose while it genuinely travels
      // 91 yards over 7 seconds -- so the old claim was effectively always
      // awarded to whoever stood nearest the landing spot, who then chased a
      // ball running away from them until it went out. That is the reported
      // "passer chasing a loose ball" bug, and it was structural.
      let recoveredBy = selectLooseBallRecovery(simulatedRoster, looseState);
      if (recoveredBy) {
        // Loose Ball Momentum v1 (2026-08-31) -- a real reported bug: the
        // ball used to freeze dead at result.ballEnd the instant it went
        // loose, then teleport-adjacent to that SAME static point once
        // recoveredBy arrived -- "stops suddenly like it got stuck in
        // mud." Real ground roll now: the ball keeps traveling in its OWN
        // real landing velocity (flightLandingVelocity()'s own header),
        // decelerating under GROUND_FRICTION_YPS2 (ballRollPhysics.js,
        // the SAME friction model carry touches already roll under), and
        // recoveredBy races the ACTUAL rolling ball, not a stationary
        // target. Falls back to the exact original static-point behavior
        // when there's no real velocity to work with (result.ballVelocity
        // absent -- every OTHER "possession: loose" producer besides
        // pushLooseDeliveryChase -- or negligible).
        const velocity = result.ballVelocity ?? { x: 0, y: 0 };
        const velocityYardPerMs = {
          x: velocity.x * (PITCH_WIDTH_YARDS / 100),
          y: velocity.y * (PITCH_LENGTH_YARDS / 100),
        };
        // Bugfix slice (2026-09-02) -- a real reported bug: flightLandingVelocity()
        // reports the delivery's own RAW AVERAGE flight speed (e.g. ~20-26 yd/s for
        // a ground/driven-ground pass, per matchPassFlight.js's own PASS_TYPE_PROFILE)
        // -- treating that unattenuated as the GROUND ROLL's own launch speed makes
        // rollStopDistanceYards() come out to 34-91 real yards under
        // GROUND_FRICTION_YPS2, almost always enough to reach a boundary from a
        // through ball's own characteristically deep landing spot, regardless of how
        // far that landing spot genuinely was from the actual line. A real ball loses
        // real energy on its own first bounce/skid before it ever settles into a pure
        // ground roll; LOOSE_DELIVERY_ROLL_RETENTION models that (roughly quarters
        // the natural roll distance, since stop distance scales with speed squared),
        // so a miss landing well inside the pitch can genuinely die on the grass or
        // be recovered, instead of a restart being close to guaranteed. Scoped
        // entirely to THIS roll's own launch speed -- the real per-tick race, the
        // genuine-exit check, and result.ballVelocity itself (used elsewhere for
        // reporting) are all untouched.
        const LOOSE_DELIVERY_ROLL_RETENTION = 0.5;
        const speedYps = Math.hypot(velocityYardPerMs.x, velocityYardPerMs.y) * 1000
          * (result.ballVelocityPhase === "rolling" ? 1 : LOOSE_DELIVERY_ROLL_RETENTION);
        let recoveryPoint = result.ballEnd;
        let recoveryDuration = Math.max(
          MOVEMENT_DURATIONS.scramble,
          Math.round(timeToReach(recoveredBy.player, yardDistance(recoveredBy, result.ballEnd)) * 1000),
        );
        let rollTrajectory = null;
        // Ball Out of Bounds v1 (2026-09-01) -- set only when the roll
        // genuinely crosses a touchline/byline before either the natural
        // stop or the recoverer's own arrival; when set, this REPLACES the
        // whole "recovered" outcome below rather than being layered on
        // top of it.
        let genuinePitchExit = null;
        let claimantHandoffs = null;
        let rollPointAtElapsed = null;
        if (speedYps > CLAIM_MIN_ROLL_SPEED_YPS) {
          // A point far along the SAME real heading the ball actually
          // landed with -- pointAlongMovement() only needs a genuine
          // direction, not an exact distant target, so this stays valid
          // for any real rollStopDistanceYards() this speed produces.
          const aimPoint = {
            x: result.ballEnd.x + velocity.x * 100000,
            y: result.ballEnd.y + velocity.y * 100000,
          };
          // A rolling ball heading toward the touchline/byline is a real,
          // finite ray -- pointAlongMovement()'s own interpolation has no
          // notion of the pitch's own edges and will happily walk past
          // them (a real bug this exact fix surfaced: an out-of-bounds
          // recovery point corrupted every downstream pressure/off-ball
          // calculation for the rest of the possession). Still clamped to
          // [0,100] both axes at every RECOVERY sample below -- a genuine
          // exit is handled as its own real restart just below instead,
          // never silently clamped away.
          // Recomputes zone from the CLAMPED coordinate, never just copies
          // whatever pointAlongMovement() attached to the pre-clamp point --
          // the exact "silently carries no zone, or the WRONG one once
          // clamped" bug this project's own history already caught twice.
          const clampToPitch = (point) => {
            const x = clamp(0, 100, point.x);
            const y = clamp(0, 100, point.y);
            return { x, y, zone: zoneFromPercent(x, y) };
          };
          const naturalStopMs = rollStopDurationMs(speedYps);
          const ROLL_SAMPLE_MS = 40;
          // The roll's real last toucher -- whoever's touch actually sent
          // it loose, not the recoverer racing it -- is who a restart
          // gets attributed to. Without real last-touch data, this never
          // fabricates a classification (classifyPitchExit()'s own rule).
          const rollLastTouchId = lastTouchEvent?.lastTouch?.playerId ?? null;
          const rollLastTouchTeam = lastTouchEvent?.lastTouch?.team ?? null;
          const rollLastTouchEntry = rollLastTouchId
            ? simulatedRoster.find((entry) => entry.id === rollLastTouchId) ?? null
            : null;
          const pitchExit = (rollLastTouchEntry && rollLastTouchTeam)
            ? classifyPitchExit({
                from: result.ballEnd,
                to: aimPoint,
                lastTouchTeam: rollLastTouchTeam,
                attackingDirectionByTeam: state.attackingDirection,
              })
            : null;
          const naturalStopDistanceYards = rollStopDistanceYards(speedYps);
          const exitDistanceYards = pitchExit ? yardDistance(result.ballEnd, pitchExit.ballEnd) : null;
          const genuineExit = Boolean(pitchExit) && exitDistanceYards <= naturalStopDistanceYards;
          const exitTimeMs = genuineExit ? rollDurationForDistance(speedYps, exitDistanceYards) : null;
          // Once the ball would genuinely be out, the recovery race never
          // gets to search past that instant -- a ball that's crossed the
          // line can't be recovered, same as real football.
          // Dynamic Ball Claim v2 -- this used to be a one-player search:
          // whoever selectLooseBallRecovery() had already picked was walked
          // along the roll to see when they caught it, and nobody else was
          // ever considered again. The race is now re-run continuously
          // across the whole roll for EVERY player on the pitch, so the
          // claim can genuinely change hands as the ball slows: a player who
          // starts further away but whose path converges on the roll now
          // wins it from someone who was merely closest at the instant it
          // came loose. Same friction model (ballRollPhysics.js), same
          // kinetics (timeToReach), same 40ms cadence, and no RNG at all.
          const initialClaimantId = recoveredBy?.id ?? null;
          const claim = claimLooseBall({
            from: result.ballEnd,
            aim: aimPoint,
            speedYps,
            candidates: simulatedRoster,
            exitDistanceYards: genuineExit ? exitDistanceYards : null,
            sampleMs: ROLL_SAMPLE_MS,
            clampPoint: clampToPitch,
          });
          claimantHandoffs = evaluateLiveClaimantHandoffs({
            roll: claim.roll,
            candidates: simulatedRoster,
            finalClaim: claim,
            initialClaimantId,
            velocities: Object.fromEntries(simulatedRoster.map((entry) => [
              String(entry.id),
              motionContext.state?.players?.[entry.id]?.velocity ?? { x: 0, y: 0 },
            ])),
          });
          recordBallClaim({ ...claim, handoffs: claimantHandoffs });
          // A ball that crosses the line has no winner and no pickup. Any
          // other roll always ends with somebody reaching it, at worst as a
          // standing pickup once it has stopped -- which is exactly the
          // outcome the previous code produced for that case.
          const claimWinner = claim.claimant ?? claim.pickup?.entry ?? null;
          if (claimWinner) recoveredBy = claimWinner;
          const interceptMs = claim.interceptMs;
          if (genuineExit && interceptMs === null) {
            const exitTrajectory = buildRollingBallTrajectory({
              from: result.ballEnd,
              aim: aimPoint,
              launchSpeedYps: speedYps,
              durationMs: exitTimeMs,
              sampleMs: 120,
            });
            exitTrajectory.at(-1).position = { ...pitchExit.ballEnd, height: 0 };
            genuinePitchExit = pushPitchExitRestart(trace, {
              actor: rollLastTouchEntry, ballFrom: result.ballEnd, exit: pitchExit, movement: "touch",
              ballTrajectory: exitTrajectory,
              duration: Math.round(exitTimeMs),
              // Nobody touches this ball. It rolls out on its own, and
              // claim.abandoned says exactly who could not get there and
              // why. rollLastTouchEntry is the restart's ATTRIBUTION, not
              // a player making a contact at the line -- see
              // pushPitchExitRestart()'s own pinActorToExit header.
              pinActorToExit: false,
            });
          } else {
            const realDurationMs = interceptMs ?? Math.max(naturalStopMs, claim.pickup?.arrivalMs ?? 0);
            const realDistanceYards = interceptMs !== null
              ? rollTraveledYards(speedYps, interceptMs)
              : rollStopDistanceYards(speedYps);
            recoveryPoint = clampToPitch(pointAlongMovement(result.ballEnd, aimPoint, realDistanceYards));
            recoveryDuration = Math.ceil(realDurationMs);
            rollTrajectory = buildRollingBallTrajectory({
              from: result.ballEnd,
              aim: aimPoint,
              launchSpeedYps: speedYps,
              durationMs: recoveryDuration,
              sampleMs: 120,
              clampPoint: clampToPitch,
            });
            rollTrajectory.at(-1).position = { ...recoveryPoint, height: 0 };
            rollPointAtElapsed = (elapsedMs) => clampToPitch(pointAlongMovement(
              looseReleasePoint,
              aimPoint,
              rollTraveledYards(speedYps, Math.min(realDurationMs, Math.max(0, elapsedMs))),
            ));
          }
        }
        if (genuinePitchExit) {
          result = genuinePitchExit;
        } else {
        for (const transfer of claimantHandoffs?.transfers ?? []) {
          const from = simulatedRoster.find((entry) => String(entry.id) === String(transfer.fromId));
          const to = simulatedRoster.find((entry) => String(entry.id) === String(transfer.toId));
          trace.push(traceEvent(
            "LOOSE.CLAIM.TRANSFER",
            `${from ? playerName(from.player) : transfer.fromId} leaves the chase to ${to ? playerName(to.player) : transfer.toId}`,
            {
              outcome: "neutral",
              overlapWithPrevious: true,
              overlapStartOffsetMs: transfer.atMs,
              metrics: {
                claimantTransfer: transfer,
                initialClaimantId: claimantHandoffs.initialClaimantId,
                finalClaimantId: claimantHandoffs.finalClaimantId,
              },
              coordination: {
                timeMs: (motionContext.simulationTimeMs ?? 0) + transfer.atMs,
                trigger: "loose-ball-live-replan",
                candidates: [],
                intentions: [],
                pressureCandidates: [],
                transfers: [{ ...transfer, type: "loose-ball-claimant" }],
              },
            },
          ));
        }
        trace.push(
          traceEvent(
            "LOOSE.RECOVERED",
            `${playerName(recoveredBy.player)} reaches the loose ball`,
            {
              actor: recoveredBy,
              mover: recoveredBy,
              moveTo: recoveryPoint,
              movement: "scramble",
              outcome: "success",
              duration: recoveryDuration,
              ballFrom: looseReleasePoint,
              ballTo: recoveryPoint,
              ...(rollTrajectory ? { ballTrajectory: rollTrajectory } : {}),
              contact: {
                point: recoveryPoint,
                actor: recoveredBy,
                type: "recovery",
                phase: "end",
              },
              ownerBefore: null,
              ownerAfter: recoveredBy,
              ownerAfterAt: "end",
              contactTiming: "sequential",
              coordination: claimantHandoffs ? {
                timeMs: motionContext.simulationTimeMs ?? 0,
                trigger: "loose-ball-claim",
                candidates: [],
                intentions: [],
                pressureCandidates: [],
                transfers: claimantHandoffs.transfers.map((entry) => ({ ...entry, type: "loose-ball-claimant" })),
              } : null,
            },
          ),
        );
        // Gameplay v3.1 -- this used to be a sequential scramble for
        // recoveredBy alone: everyone else on the pitch stood frozen for
        // the whole recoveryDuration, then twitched through a 200ms
        // POST_ACTION_CONVERGENCE_MS reshape once the loop noticed
        // possession had settled. The CM 03/04 rule applies here just as
        // much as during the flight itself -- the ball being loose on the
        // ground instead of in the air doesn't pause the other 21 jobs.
        // Queried from recoveredBy's own perspective (they're about to be
        // the next owner) so teammates/opponents split correctly; overlaps
        // the LOOSE.RECOVERED interval just pushed above instead of
        // inserting a new sequential beat.
        const recoveryGroups = freePlayGroups(
          recoveredBy.id,
          simulatedRoster,
          simulated.ballState,
        );
        reactOffBallContinuous(
          recoveryGroups,
          looseReleasePoint,
          recoveryPoint,
          recoveryDuration,
          trace,
          {
            motionContext,
            excludedIds: [recoveredBy.id],
            overlapWithPrevious: true,
            chaseIntention: true,
            coordinationFlags: claimantHandoffs ? { claimantHandoffs } : {},
            ballPointAtElapsed: rollPointAtElapsed,
          },
        );
        result = {
          ...result,
          terminal: false,
          possession:
            recoveredBy.team === groups.owner.team ? "retained" : "turnover",
          nextOwnerId: recoveredBy.id,
          // Loose Ball Momentum v1 -- the real point the ball actually
          // rolled to, never the original static landing spot; the outer
          // loop's own authoritative-move commit (right below) must move
          // recoveredBy HERE, or the trace's own real animation and the
          // simulated roster's own position silently disagree.
          ballEnd: recoveryPoint,
          reason: `${result.reason}-recovered`,
          offBallInterleaved: true,
        };
        }
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
            const convergence = realMoverTrajectory(movedEntry, result.ballEnd, {
              from: pointOf(movedEntry),
              floorMs: MOVEMENT_DURATIONS.reposition,
              action: "control-converge",
              reactionDelayMs: 0,
              incomingVelocity: motionContext.state?.players?.[movedEntry.id]?.velocity ?? null,
              paceToArrival: true,
            });
            trace.push(
              traceEvent(
                "CONTROL.CONVERGE",
                `${playerName(movedEntry.player)} reaches the ball`,
                {
                  actor: movedEntry,
                  ...convergence,
                  movement: "interception",
                  outcome: "success",
                  contactTiming: "sequential",
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
        // Object.hasOwn, not `result.held ?? undefined` -- a resolver that
        // never mentions `held` at all (everything except a keeper catch/
        // release) must fall through to transitionBallState()'s own
        // ownerRole-based default, while resolveKeeperReleaseToFeet()'s
        // explicit `held: false` must actually override it.
        heldOverride: Object.hasOwn(result, "held") ? result.held : undefined,
      });
      // Keeper Catch & Distribution v1 (2026-08-23) -- a catch is not the
      // end of the possession: the side gets a real beat to settle before
      // the keeper picks a distribution (generateFreePlayCandidates() only
      // offers throw-short/throw-long/punt/release-to-feet while
      // ballState.phase === "held", never a shot or a dribble out of their
      // hands).
      // Keeper Hold & Walk v1 (2026-08-31) -- a real reported gap: the
      // keeper used to freeze dead still at the exact catch point for a
      // flat GK_HOLD_MS, then pass "exactly from where he collects the
      // ball." Now a real short walk inside the box (keeperWalkTarget()'s
      // own header) lasts up to GK_HOLD_MAX_MS. Opponent proximity cannot
      // shorten it because they are not allowed to pressure a held ball.
      if (result.held) {
        const keeperGroups = freePlayGroups(nextOwner.id, simulatedRoster, simulated.ballState);
        // Proximity cannot shorten this window: an opponent is not allowed
        // to pressure a goalkeeper while the ball is in his hands. Once the
        // ball is dropped to the feet, the normal pressure model resumes.
        const holdDurationMs = GK_HOLD_MAX_MS;
        const walkTarget = keeperWalkTarget(nextOwner, state.attackingDirection[nextOwner.team], seed, actionsCount);
        const holdMove = realMoverTrajectory(nextOwner, walkTarget, { floorMs: holdDurationMs, action: "hold-walk" });
        const holdBallFrom = simulated.ballPoint;
        trace.push(
          traceEvent(
            "GK.HOLD",
            `${playerName(nextOwner.player)} holds it, walking it around the box`,
            {
              actor: nextOwner,
              ...holdMove,
              movement: "hold",
              outcome: "neutral",
              ballFrom: holdBallFrom,
              ballTo: walkTarget,
              // The ball is in his hands, so it follows HIS path, not a
              // straight line between the same two endpoints.
              ballTrajectory: heldBallTrajectory(holdMove.playerMoves[0].trajectory, holdBallFrom),
              ballResult: "held",
              ownerBefore: nextOwner,
              ownerAfter: nextOwner,
            },
          ),
        );
        // Commit immediately -- the same real-discontinuity reasoning as
        // every other post-actionTrace mutation this file makes (Burst
        // Stamina v1's own turnover jobs, this exact pattern). The ball
        // travels IN HIS HANDS, so its own simulated position/state must
        // move with him too, not linger at the original catch point.
        Object.assign(nextOwner, walkTarget);
        simulated.ballPoint = walkTarget;
        simulated.ballState = { ...simulated.ballState, position: walkTarget };
        // Real reported bug (2026-09-01): "most of the players get
        // frozen and not moving for a time." Only the keeper himself
        // ever got an authored move for this whole window -- harmless
        // at the OLD flat 1.4s GK_HOLD_MS, but Keeper Hold & Walk v1
        // stretched this same window up to a real 6 real seconds
        // (GK_HOLD_MAX_MS) with nobody else on the pitch doing anything
        // the whole time. The other 21 players keep working their own
        // real jobs (shape/marking/support) for the SAME real duration,
        // exactly like every other long window in this file already
        // does (a pass flight, a loose-ball scramble).
        reactOffBallContinuous(
          keeperGroups,
          holdBallFrom,
          walkTarget,
          holdDurationMs,
          trace,
          {
            motionContext,
            excludedIds: [nextOwner.id],
            overlapWithPrevious: true,
            chaseIntention: true,
            keeperHolding: true,
          },
        );
        // A keeper catch/hold never set this before (nothing else here
        // ever interleaved its own reaction) -- forcing it now stops the
        // generic post-action reshape further below from ALSO re-planning
        // everyone a second time on top of the real reaction just
        // authored, the exact double-move conflict Turnover Stamina
        // Jobs v1's own header already documents for this same class of
        // bug.
        result = { ...result, offBallInterleaved: true };
      }
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
      const phaseGroups = freePlayGroups(result.nextOwnerId, simulatedRoster, simulated.ballState);
      if (phaseGroups.owner) {
        const phaseSnapshots = {
          owner: phaseGroups.owner,
          teammates: phaseGroups.teammates,
          opponents: phaseGroups.opponents,
          ownKeepers: phaseGroups.ownKeepers || [],
          opposingKeepers: phaseGroups.opposingKeepers || (phaseGroups.keeper ? [phaseGroups.keeper] : []),
        };
        const elapsedForNonInterleaved = result.offBallInterleaved
          ? 0
          : Math.max(0, ...actionTrace.map((event) => Number(event.duration) || 0));
        motionContext.teamPhase = updateTeamPhaseState(
          motionContext.teamPhase,
          teamPhaseFacts(
            phaseSnapshots,
            groups.owner ? pointOf(groups.owner) : simulated.ballPoint,
            simulated.ballPoint,
            motionContext,
          ),
          elapsedForNonInterleaved,
        );
        if (elapsedForNonInterleaved) motionContext.simulationTimeMs += elapsedForNonInterleaved;
      }
    }
    // Turnover Stamina Jobs v1 -- fires exactly once, at the instant
    // possession genuinely changes TEAM (not merely re-authored to the
    // same side, e.g. a knock-on to a teammate). groups.owner/teammates
    // above are still this action's PRE-resolution snapshot (the side
    // that just lost it); simulated.ballState was already committed
    // above, so freePlayGroups() for the new owner reflects real
    // post-action positions. turnoverJobIds feeds the regular reshaping
    // call further below (its own excludedIds) -- see
    // maybeAssignTurnoverStaminaJobs()'s own header for the real
    // teleport bug this prevents.
    let turnoverJobIds = [];
    if (continuesLive) {
      const newOwnerEntry = simulatedRoster.find((entry) => entry.id === result.nextOwnerId);
      if (newOwnerEntry && groups.owner && newOwnerEntry.team !== groups.owner.team) {
        const winningGroups = freePlayGroups(result.nextOwnerId, simulatedRoster, simulated.ballState);
        // Real reported bug (2026-08-31), other direction: a resolver that
        // ALREADY interleaved its own full off-ball reaction THIS action
        // (result.offBallInterleaved -- the loose-ball recovery race is
        // the concrete case that surfaced it, but any interleaved resolver
        // qualifies) may have already given the exact player this
        // function would pick a real job of their own. Scanning this
        // action's own trace-so-far for who has ALREADY moved is the
        // general fix -- correct regardless of which specific mechanism
        // moved them first, not just the loose-ball case that happened to
        // catch it.
        const alreadyMovedIds = new Set(
          trace.slice(actionTraceStart).flatMap(
            (event) => (event.playerMoves || []).map((move) => String(move.playerId)),
          ),
        );
        turnoverJobIds = maybeAssignTurnoverStaminaJobs(
          groups.owner, groups.teammates, winningGroups, trace, alreadyMovedIds,
          // World Motion Contract v1 -- the shared per-player motion
          // record, so a recovery/support run carries velocity in and
          // hands velocity + its own live intention back out instead of
          // every beat restarting from a standstill.
          motionContext,
        );
      }
    }
    // Off-Ball Motion v3 (2026-08-26) -- a real reported bug: this call ran
    // UNCONDITIONALLY after every continuing action, including one that
    // had already just interleaved a full-window continuous reaction of
    // its own (resolvePass/resolveCarry/resolveDribble, via
    // result.offBallInterleaved -- see each of their own matching return
    // fields). A second reaction on top -- a brand-new trajectory, velocity
    // reset to zero, an 8-yard-capped target -- is the "second hitch"
    // reported both mid-carry AND mid-pass (players visibly freezing then
    // snapping). Skipped ONLY for that case; a short, non-interleaved
    // action (hold, back-to-goal, a failed touch with no flight) still
    // gets this, unchanged, since nothing else moved anyone toward their
    // real spot yet.
    if (continuesLive && !result.offBallInterleaved && !result.intentionsContinued) {
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
        {
          motionContext,
          // Overlap the just-finished reception/touch instead of inserting
          // a sequential dead beat. The ball owner is excluded so a contact
          // keyframe at the same timestamp cannot be replaced. Off-ball
          // players lean toward their next marks DURING the first touch,
          // then the next action starts with no freeze.
          overlapWithPrevious: true,
          // CAPPED, not the uuncapped intentionTarget this same function
          // chases during an actual pass flight (the call above, which
          // genuinely owns a multi-second window) -- POST_ACTION_CONVERGENCE_MS
          // is deliberately short, and asking a short window to cover a
          // far tactical destination is exactly the "2-second reshape
          // squeezed into 160ms" pause-then-burst a real browser round
          // reported. A short nudge toward the SAME direction, capped by
          // this window's own real pace budget, reads as natural instead.
          chaseIntention: false,
          excludedIds: [defendingGroups.owner?.id, result.nextOwnerId, ...turnoverJobIds].filter(Boolean),
          // Progression Contest v1 -- catches every resolver that does
          // NOT interleave its own off-ball reaction (resolveHold's
          // SHIELD.WON, resolveDribble's T.BEATEN.ESCAPE) via whichever
          // one just set beatenDefenderId on its own return; a resolver
          // that already interleaved (resolveDribble's clean P.PROGRESS.WON,
          // resolveCarry's own completion) skipped this whole branch via
          // offBallInterleaved and threaded it directly into its OWN call
          // instead -- see each of their own matching comments.
          beatenPresserId: result.beatenDefenderId || null,
        },
      );
    } else if (result.restart && !AUTOMATIC_RESTART_TYPES.has(result.restart) && groups.owner) {
      // Fouls and other whistle stoppages still allow the players already
      // reacting to the live duel to move up to that whistle. A ball that
      // has crossed a boundary is handled separately: it must not trigger
      // a newly planned open-play shape before the restart setup begins.
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
    // A genuine pitch exit now flows through the same set-piece engine as
    // an authored Match Setup restart. Keep following consecutive awarded
    // restarts (for example a corner immediately headed behind) with a hard
    // chain cap so an adversarial resolver cannot create an infinite loop.
    if (result.restart && AUTOMATIC_RESTART_TYPES.has(result.restart)) {
      if (stopAtStoppage) {
        simulated.ownerId = null;
        endedByStoppage = true;
        break;
      }
      while (
        result.restart
        && AUTOMATIC_RESTART_TYPES.has(result.restart)
        && automaticRestartCount < MAX_AUTOMATIC_RESTARTS
      ) {
        const resumed = executeAutomaticRestart({
          result,
          simulated,
          simulatedRoster,
          trace,
          motionContext,
          seed,
          restartIndex: automaticRestartCount,
        });
        if (!resumed) break;
        automaticRestartCount += 1;
        result = resumed;
      }
    }
    simulated.ownerId = result.nextOwnerId;
    // Direct resolvers still report a clean interception/tackle/keeper catch
    // as terminal for their isolated action contract. The sequence runner is
    // broader: any live result with a real next owner begins another action.
    const sequenceContinuesLive = !result.restart && Boolean(result.nextOwnerId || result.possession === "loose");
    if (!sequenceContinuesLive) {
      endedByStoppage = true;
      break;
    }
  }

  if (result && !endedByStoppage && !matchSession) {
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
    ...(matchSession ? { continuation: {
      roster: simulatedRoster, simulated, result, motionContext, engagementHistory, congestionTracker,
    } } : {}),
    actionsCount,
    finalPositions: simulatedRoster,
    decisionMetrics,
    teamPhase: motionContext.teamPhase,
    phaseTransitions: motionContext.teamPhase?.transitions ?? [],
    shapeSnapshots: motionContext.shapeSnapshots,
    coordinationSnapshots: motionContext.coordinationSnapshots ?? [],
    coordinationHistory: motionContext.coordination?.history ?? [],
    shapeMetrics: {
      before: initialShapeMetrics,
      after: Object.fromEntries(teamIds.map((team) => [
        team,
        teamShapeMetrics(simulatedRoster.filter((entry) => entry.team === team), {
          ballPoint: simulated.ballPoint,
          ownerId: simulated.ownerId,
          attackingDirection: state.attackingDirection[team],
        }),
      ])),
      opening: motionContext.shapeSnapshots.find((snapshot) =>
        Object.values(snapshot.teams || {}).some((value) => value.phase === "build-up"))?.teams
        ?? motionContext.shapeSnapshots[motionContext.shapeSnapshots.length - 1]?.teams
        ?? null,
    },
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
      meanShotDistanceMetres: shotSamples.length
        ? shotSamples.reduce(
            (sum, entry) => sum + entry.distanceToGoalMetres,
            0,
          ) / shotSamples.length
        : null,
    },
  };
}

// Tactics owns a full-width workspace. The controls are authored once in
// HTML and moved into their semantic columns before references are captured,
// avoiding duplicate IDs or a second, drifting set of tactics inputs.
function mountTacticsWorkspace() {
  const teamHost = document.querySelector("#labTeamTacticsHost");
  const shapeHost = document.querySelector("#labShapeTacticsHost");
  const playerHost = document.querySelector("#labPlayerTacticsHost");
  const shapePanel = document.querySelector("#labShapeTacticsPanel");
  const slotEditor = document.querySelector("#labSlotEditor");
  const markingPanel = document.querySelector("#labMarkingTacticsPanel");
  const attackingPanel = document.querySelector("#labAttackingTacticsPanel");
  const transitionPanel = document.querySelector("#labTransitionTacticsPanel");
  if (teamHost && attackingPanel) teamHost.appendChild(attackingPanel);
  if (teamHost && transitionPanel) teamHost.appendChild(transitionPanel);
  if (teamHost && markingPanel) teamHost.appendChild(markingPanel);
  if (shapeHost && shapePanel) shapeHost.appendChild(shapePanel);
  if (playerHost && slotEditor) playerHost.appendChild(slotEditor);
}
mountTacticsWorkspace();

const elements = {
  matchTab: document.querySelector("#labMatchTab"),
  tacticsTab: document.querySelector("#labTacticsTab"),
  matchWorkspace: document.querySelector("#labMatchWorkspace"),
  tacticsWorkspace: document.querySelector("#labTacticsWorkspace"),
  teamTacticsTitle: document.querySelector("#labTeamTacticsTitle"),
  teamTacticGroups: Array.from(document.querySelectorAll(
    ".match-lab-marking-team, .match-lab-attacking-team, .match-lab-transition-team",
  )),
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
  showCoordsCheckbox: document.querySelector("#labShowCoordsCheckbox"),
  showStaminaCheckbox: document.querySelector("#labShowStaminaCheckbox"),
  showTeamShapeCheckbox: document.querySelector("#labShowTeamShapeCheckbox"),
  showTacticalRegionsCheckbox: document.querySelector("#labShowTacticalRegionsCheckbox"),
  tacticalRegionsLayer: document.querySelector("#labTacticalRegionsLayer"),
  tacticalRegionsHud: document.querySelector("#labTacticalRegionsHud"),
  teamShapeLayer: document.querySelector("#labTeamShapeLayer"),
  teamShapeHud: document.querySelector("#labTeamShapeHud"),
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
  stepBackButton: document.querySelector("#labStepBackButton"),
  resetButton: document.querySelector("#labResetButton"),
  saveScenarioButton: document.querySelector("#labSaveScenarioButton"),
  // Match Setup Integration v1 (2026-09-04).
  homeSquadSelect: document.querySelector("#labHomeSquadSelect"),
  awaySquadSelect: document.querySelector("#labAwaySquadSelect"),
  homeSquadStatus: document.querySelector("#labHomeSquadStatus"),
  awaySquadStatus: document.querySelector("#labAwaySquadStatus"),
  formatChoices: document.querySelector("#labFormatChoices"),
  setupHomeTab: document.querySelector("#labSetupHomeTab"),
  setupAwayTab: document.querySelector("#labSetupAwayTab"),
  formationSelect: document.querySelector("#labFormationSelect"),
  formationStyleSelect: document.querySelector("#labFormationStyleSelect"),
  tacticsBoard: document.querySelector("#labTacticsBoard"),
  slotEditorEmpty: document.querySelector("#labSlotEditorEmpty"),
  slotEditorFields: document.querySelector("#labSlotEditorFields"),
  slotPlayer: document.querySelector("#labSlotPlayer"),
  slotPosition: document.querySelector("#labSlotPosition"),
  slotRole: document.querySelector("#labSlotRole"),
  slotRoleNote: document.querySelector("#labSlotRoleNote"),
  slotDuty: document.querySelector("#labSlotDuty"),
  slotShootingInstruction: document.querySelector("#labSlotShootingInstruction"),
  slotShootingField: document.querySelector("#labSlotShootingField"),
  slotTempoInstruction: document.querySelector("#labSlotTempoInstruction"),
  slotTempoField: document.querySelector("#labSlotTempoField"),
  goalkeeperInstructionFields: document.querySelector("#labGoalkeeperInstructionFields"),
  goalkeeperDistribution: document.querySelector("#labGoalkeeperDistribution"),
  goalkeeperSweeping: document.querySelector("#labGoalkeeperSweeping"),
  resetPhasePosition: document.querySelector("#labResetPhasePosition"),
  slotIncluded: document.querySelector("#labSlotIncluded"),
  restartTypeSelect: document.querySelector("#labRestartTypeSelect"),
  restartTeamSelect: document.querySelector("#labRestartTeamSelect"),
  restartSideField: document.querySelector("#labRestartSideField"),
  restartSideSelect: document.querySelector("#labRestartSideSelect"),
  restartNote: document.querySelector("#labRestartNote"),
  restartTakerSelect: document.querySelector("#labRestartTakerSelect"),
  showPatternDiagnosticsCheckbox: document.querySelector("#labShowPatternDiagnosticsCheckbox"),
  patternDiagnostics: document.querySelector("#labPatternDiagnostics"),
  showRestartRolesCheckbox: document.querySelector("#labShowRestartRolesCheckbox"),
  boardViewChoices: document.querySelector("#labBoardViewChoices"),
  boardViewNote: document.querySelector("#labBoardViewNote"),
  showRoleMapCheckbox: document.querySelector("#labShowRoleMap"),
  roleMapNote: document.querySelector("#labRoleMapNote"),
  applySetupButton: document.querySelector("#labApplySetupButton"),
  applyTacticsButton: document.querySelector("#labApplyTacticsButton"),
  resumeMatchButton: document.querySelector("#labResumeMatchButton"),
  matchMinute: document.querySelector("#labMatchMinute"),
  liveCommentary: document.querySelector("#labLiveCommentary"),
  homePossession: document.querySelector("#labHomePossession"),
  awayPossession: document.querySelector("#labAwayPossession"),
  homePossessionBar: document.querySelector("#labHomePossessionBar"),
  awayPossessionBar: document.querySelector("#labAwayPossessionBar"),
  homeTacticsRequest: document.querySelector("#labHomeTacticsRequest"),
  awayTacticsRequest: document.querySelector("#labAwayTacticsRequest"),
  tacticsRequestStatus: document.querySelector("#labTacticsRequestStatus"),
  matchStatsToggle: document.querySelector("#labMatchStatsToggle"),
  matchStatsPanel: document.querySelector("#labMatchStatsPanel"),
  playerStatsTab: document.querySelector("#labPlayerStatsTab"),
  teamStatsTab: document.querySelector("#labTeamStatsTab"),
  statsScope: document.querySelector("#labStatsScope"),
  statsScopeLabel: document.querySelector("#labStatsScopeLabel"),
  statsNameHeading: document.querySelector("#labStatsNameHeading"),
  heatmapGrid: document.querySelector("#labHeatmapGrid"),
  playerStatsBody: document.querySelector("#labPlayerStatsBody"),
  tacticsStatus: document.querySelector("#labTacticsStatus"),
  swapTeamsButton: document.querySelector("#labSwapTeamsButton"),
  setupStatus: document.querySelector("#labSetupStatus"),
  speedSelect: document.querySelector("#labSpeedSelect"),
  speedValue: document.querySelector("#labSpeedValue"),
  attackingDirectionSelect: document.querySelector(
    "#labAttackingDirectionSelect",
  ),
  soundCheckbox: document.querySelector("#labSoundCheckbox"),
  volumeInput: document.querySelector("#labVolumeInput"),
  markingSchemeSelects: Array.from(
    document.querySelectorAll(".match-lab-marking-scheme"),
  ),
  markingBars: Array.from(document.querySelectorAll(".match-lab-marking-bar")),
  markingValues: Array.from(
    document.querySelectorAll(".match-lab-marking-value"),
  ),
  markingStrictnessGroups: Array.from(
    document.querySelectorAll(".match-lab-marking-strictness"),
  ),
  attackingStyleSelects: Array.from(
    document.querySelectorAll(".match-lab-attacking-style"),
  ),
  attackingBars: Array.from(document.querySelectorAll(".match-lab-attacking-bar")),
  attackingValues: Array.from(
    document.querySelectorAll(".match-lab-attacking-value"),
  ),
  attackingStrictnessGroups: Array.from(
    document.querySelectorAll(".match-lab-attacking-strictness"),
  ),
  teamShootingSelects: Array.from(document.querySelectorAll(".match-lab-team-shooting")),
  teamTempoSelects: Array.from(document.querySelectorAll(".match-lab-team-tempo")),
  teamInstructionControls: Array.from(document.querySelectorAll(".match-lab-team-instruction-control")),
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
  // Per-team Marking setup (2026-08-24) -- feeds planDefensiveRepositioning()'s
  // own scheme/tightness options directly (see that function's comment):
  // "man" keeps a defender on their assigned opponent wherever the ball
  // goes, "zonal" holds a strip of the pitch instead; tightness 1 (loose
  // standoff) to 5 (hip-to-hip) sets how tight either scheme actually
  // plays. Independent per team, same as attackingDirection above.
  marking: {
    home: normalizeTeamDefending(DEFAULT_TEAM_DEFENDING),
    away: normalizeTeamDefending(DEFAULT_TEAM_DEFENDING),
  },
  // Per-team Attacking setup (2026-08-25, Attacking-on-the-Ball v2) --
  // feeds generateFreePlayCandidates()'s own attackingSettings option
  // directly (see that function's comment): a bias layered on top of
  // already-legal candidates, never a filter. style is one of
  // "possession"/"direct"/"long-ball"/"wing"; directness 1 (always take
  // the next free man) to 5 (look furthest first) controls how hard an
  // ambitious ball is discouraged while a real simple option exists.
  // counterOnTurnover is deliberately NOT modeled: runConstructedPossession()
  // only ever simulates ONE team's own possession chain end to end (it
  // terminates the instant a turnover happens -- see its own `terminal`
  // handling), so "the next 2 actions after a turnover" has no cheap
  // signal to key off within this architecture. TODO: revisit if/when a
  // caller ever simulates a full alternating-possession match loop.
  attacking: {
    home: normalizeTeamAttacking(DEFAULT_TEAM_ATTACKING),
    away: normalizeTeamAttacking(DEFAULT_TEAM_ATTACKING),
  },
  transition: {
    home: normalizeTeamTransition(DEFAULT_TEAM_TRANSITION),
    away: normalizeTeamTransition(DEFAULT_TEAM_TRANSITION),
  },
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
  // Ball Coordinates HUD v1 (2026-08-30) -- off by default, see
  // updateBallCoordsLabel()'s own comment.
  showBallCoords: false,
  // Stamina Bars v1 (2026-08-31) -- off by default, see updateStaminaBar()'s
  // own comment.
  showStaminaBars: false,
  // Team Shape & Phase Intelligence v1 -- optional, derived developer
  // diagnostics. Never read by a resolver or planner.
  showTeamShapeDiagnostics: false,
  // Tactical Region Foundation v1 -- optional 5x6 classification lens.
  // Derived from coordinates and attacking direction; never engine state.
  showTacticalRegions: false,
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
  // Match Setup Integration v1 (2026-09-04) -- the AUTHORED DRAFT, kept
  // deliberately separate from the live pitch. Editing the tactics board
  // changes only this; nothing reaches state.roster/state.ball until Apply
  // Setup succeeds in full. That separation is what makes a failed apply
  // leave the current pitch exactly as it was.
  matchSetupDraft: null,
  restartSetupDraft: null,
  // squadKey -> { players, roster } for squads that resolved strictly.
  // Cached because strict resolution is several API calls, and a squad's
  // resolved identity does not change between presses.
  resolvedSquads: new Map(),
  // squadKey -> the reason a squad could not be used, so the selector can
  // say WHY rather than silently falling back to a legacy lookup.
  squadFailures: new Map(),
  setupTeamTab: "home",
  // Which authored layer the full tactics board is showing: formation,
  // with-ball, without-ball or restart.
  setupBoardView: "open-play",
  // Classic WIB/WOB authors a response to one of twelve ball areas. This
  // selection belongs only to the editor; live play derives it from the
  // ball's actual continuous coordinate.
  setupPhaseZone: 4,
  selectedSetupSlotId: null,
  showRoleMap: true,
  // Set by Apply Setup when the authored start of play is a dead ball.
  // Resolve & Play dispatches this required action before ordinary
  // possession candidates can be generated.
  pendingRestart: null,
};

function markingSettingsFor(team) {
  const settings = normalizeTeamDefending(state.marking[team] || DEFAULT_TEAM_DEFENDING);
  return { ...settings, tightness: settings.strictness };
}

function attackingSettingsFor(team) {
  return state.attacking[team] || normalizeTeamAttacking(DEFAULT_TEAM_ATTACKING);
}

function transitionSettingsFor(team) {
  return state.transition[team] || normalizeTeamTransition(DEFAULT_TEAM_TRANSITION);
}

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
  if (state.mode !== "freeplay") return scenarioIsReady();
  const hasOwner = Boolean(state.roster.find((entry) => entry.id === state.ball.ownerId));
  const restartExpected = Boolean(
    state.ball?.deadBall || state.pendingRestart || state.restartSetupDraft,
  );
  return restartExpected ? pendingRestartIsReady() : hasOwner;
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
    shootingInstruction: "inherit",
    tempoInstruction: "inherit",
    goalkeeperDistribution: "mixed",
    goalkeeperSweeping: "balanced",
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
  // [defenders, midfielders, attackers], PER TEAM. 11v11 alternates between
  // two real formations, one coin flip per match (same shape for both
  // sides, never mismatched -- same "one flip for the whole match" pattern
  // as 3v3's shared band above): 4-4-2 (flat back four, flat midfield
  // four, front two) or 4-3-3 (back four, midfield three, front three).
  // Both are real band counts, not just a cosmetic label -- a 4-3-3's
  // extra "attacker" genuinely plays and is marked as one (Off-Ball v2's
  // whole marking/off-ball-reaction scheme keys off classifyOutfieldBand,
  // not where the dot happens to be drawn).
  const elevenFormation = Math.random() < 0.5 ? [4, 4, 2] : [4, 3, 3];
  const perTeam = { 5: [1, 2, 1], 7: [2, 2, 2], 9: [3, 3, 2], 11: elevenFormation }[
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

// Width distribution (2026-08-19, centering revised 2026-08-24 for Quick
// Setup's real formation shapes) -- a reported bug: every outfielder's x
// was drawn fully independently (10 + random*80) regardless of how many
// OTHER players shared their band, so multiple defenders/midfielders/
// attackers on the same team had a real (birthday-paradox) chance of
// clustering in the same zone by pure chance, leaving whole flanks empty
// while a single small area got crowded -- exactly what was reported. Each
// player within a band now gets a distinct lateral channel (left-back,
// center-backs, right-back, etc, though not literally labeled as always) --
// the pitch width divided evenly by how many teammates share this band,
// with real jitter inside that channel so it still reads as organic
// placement, not a rigid grid. A lone player in their band (count<=1, e.g.
// 5v5's single defender/forward, 3v3's single attacker/shared) now centers
// instead -- a real formation's lone centre-back or lone striker plays
// central, not wherever a full-width roll happened to land; "channeling a
// group of one is meaningless" no longer holds once a lone band member IS
// the whole formation line.
function lateralChannelX(channel) {
  if (!channel || channel.count <= 1) return 50 + (Math.random() - 0.5) * 30;
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
    // Which of 11v11's two coin-flipped formations outfieldSlotsFor() just
    // picked, purely for the status line below -- read back from the
    // resulting counts rather than threaded through as a separate return
    // value, so outfieldSlotsFor()'s own [band] array return type (and its
    // existing test contract) stays untouched.
    const formationLabel =
      perSide === 11 ? ((neededCounts.attacker || 0) === 6 ? "4-3-3" : "4-4-2") : null;
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
        shootingInstruction: "inherit",
        tempoInstruction: "inherit",
        goalkeeperDistribution: "mixed",
        goalkeeperSweeping: "balanced",
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
      elements.quickSetupStatus.textContent = formationLabel
        ? `${perSide}v${perSide} ready -- ${formationLabel}.`
        : `${perSide}v${perSide} ready.`;
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
  // Deliberately handing a player the ball converts an authored dead ball
  // into ordinary open play, at the user's own request. That is a real
  // choice, unlike Resolve & Play silently doing it for them, so the
  // pending-restart guard is released here rather than fought.
  cancelPendingRestart("the ball was handed to a player");
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
    // Ball Coordinates HUD v1 -- see updateBallCoordsLabel()'s own
    // comment. Real createElement()/appendChild(), not folded into the
    // innerHTML template above, for the same fake-DOM-queryability reason
    // the ball marker's own coords span uses. Only ever shown for the
    // CURRENT ball owner (updatePlayerCoordsLabel() hides every other
    // player's) -- this exists to answer "did the BALL move, or did the
    // PLAYER move to meet it," a real reported ambiguity the ball-only
    // readout alone couldn't settle.
    const playerCoordsLabel = document.createElement("span");
    playerCoordsLabel.className = "match-lab-player-coords";
    playerCoordsLabel.setAttribute("aria-hidden", "true");
    marker.appendChild(playerCoordsLabel);
    // Stamina Bars v1 -- see updateStaminaBar()'s own comment. A nested
    // fill span (not a single element's own width) so CSS can transition
    // the fill smoothly without fighting the bar's own fixed track width.
    const staminaBar = document.createElement("span");
    staminaBar.className = "match-lab-stamina-bar";
    staminaBar.setAttribute("aria-hidden", "true");
    const staminaFill = document.createElement("span");
    staminaFill.className = "match-lab-stamina-bar-fill";
    staminaBar.appendChild(staminaFill);
    marker.appendChild(staminaBar);
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
            // Restart Execution v2 -- the restart taker owns the DEAD ball,
            // so dragging them drags it off its legal spot. That is no
            // longer the authored restart: it is an ordinary open-play
            // position, and executing a corner from the middle of the pitch
            // would be nonsense. Cancel explicitly rather than silently
            // keeping a stale pendingRestart.
            if (state.pendingRestart && state.restartSetupDraft
              && yardDistance(state.restartSetupDraft.ball, entry) > 0.5) {
              cancelPendingRestart("the ball was dragged off its restart spot");
            }
            state.ball.x = entry.x;
            state.ball.y = entry.y;
            state.ball.zone = entry.zone;
            setMarkerPosition("ball", entry.x, entry.y, { animate: false });
          } else if (
            inProbe &&
            entry.role === scenarioPrimaryRoleKey(state.scenario)
          ) {
            setMarkerPosition("ball", entry.x, entry.y, { animate: false });
          }
        },
      ),
    );
    elements.pitch.appendChild(marker);
    updateStaminaBar(entry.id, freshBurst01(entry.player).burst01);
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
  // Ball Realism v1 (2026-08-31) -- the marker's own logical x/y is now
  // the ONLY thing that ever positions it, no separate cosmetic pixel
  // nudge on top (see renderPlaybackFrame()'s own matching comment for
  // the full reported-bug rationale). primaryEntry is still the right
  // fallback here specifically -- setup mode has no live ball track to
  // read, only the roster's own authored positions.
  const primaryEntry = inProbe ? probeEntry : freePlayOwner;
  const ballPoint = primaryEntry || state.ball;
  ballMarker.dataset.held = String(
    Boolean(freePlayOwner && freePlayOwner.role === "keeper"),
  );
  ballMarker.style.setProperty("--marker-x", `${ballPoint.x}%`);
  ballMarker.style.setProperty("--marker-y", `${ballPoint.y}%`);
  ballMarker.hidden = !ballVisible;
  updateVisionCone(primaryEntry);
  ballMarker.innerHTML = `
    <span class="match-lab-marker-dot" aria-hidden="true"></span>
  `;
  // Ball Coordinates HUD v1 -- appended via a real createElement()/
  // appendChild() (never folded into the innerHTML template above like
  // the dot span) so this node is a genuine, queryable DOM child under
  // fake-DOM test harnesses too, not just a real browser's own HTML
  // parser -- innerHTML string assignment is opaque to any stub that
  // doesn't itself re-parse markup.
  const coordsLabel = document.createElement("span");
  coordsLabel.className = "match-lab-ball-coords";
  coordsLabel.setAttribute("aria-hidden", "true");
  ballMarker.appendChild(coordsLabel);
  if (!inProbe) {
    ballMarker.addEventListener("pointerdown", (event) =>
      startDrag(event, state.ball, null, () => {
        handleAuthoredBallMove();
      }),
    );
  }
  elements.pitch.appendChild(ballMarker);
  updateBallCoordsLabel(ballPoint);
  updatePlayerCoordsLabel(primaryEntry?.id ?? null, primaryEntry ? { x: primaryEntry.x, y: primaryEntry.y } : null);
  updateTacticalRegionOverlay(ballPoint, labelOwnerId);
  updateTeamShapeOverlay(0);
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

// The match engine keeps one stable world coordinate system regardless of
// how the pitch is presented: x runs across the 75-yard width and y runs
// along the 120-yard length. On wide desktop screens CSS rotates that world
// counter-clockwise so the goals sit left/right and the pitch can use the
// available screen width. Keep the conversion here at the interaction edge;
// simulation, traces, saves and replays continue to store their original
// coordinates unchanged.
function matchPitchIsLandscape(rect) {
  return Number(rect?.width) > Number(rect?.height);
}

function matchPitchDisplayPoint(point, landscape = false) {
  const x = Number(point?.x) || 0;
  const y = Number(point?.y) || 0;
  return landscape ? { x: y, y: 100 - x } : { x, y };
}

function matchPitchWorldPoint(point, landscape = false) {
  const x = Number(point?.x) || 0;
  const y = Number(point?.y) || 0;
  return landscape ? { x: 100 - y, y: x } : { x, y };
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

// Ball Realism v1 (2026-08-31) -- restingBallOffsetPx()/setBallRestOffset()
// (the synthetic, speed-scaled "--ball-rest-x/y" pixel nudge) were removed
// here -- see renderPlaybackFrame()'s own comment for the full reported-bug
// rationale ("the ball movement... should not be cosmetic"). The marker's
// own --marker-x/y IS the ball's real position now, always, with nothing
// composited on top of it.

// Ball Coordinates HUD v1 (2026-08-30) -- a real, explicit request: precise
// browser-round bug reports were shorthand ("the ball's over there,
// roughly") when what's actually needed for exact debugging is the SAME
// numbers this file's own resolvers/trace already work in. Shows the
// ball's live logical position (--marker-x/y's own 0-100 percent-grid
// value, the exact coordinate space every ballFrom/ballTo/contact.point
// in the trace already uses) plus a real-yard conversion for a human
// reading it off the pitch. Off by default (#labShowCoordsCheckbox);
// updates every rendered frame during playback AND the static authored
// setup, so it's visible whether or not a possession is actually running.
let lastBallDisplayPoint = null;
function ballCoordsLabelText(point) {
  const yard = toYardPoint(point);
  return `${point.x.toFixed(1)}, ${point.y.toFixed(1)} (${yard.x.toFixed(1)}yd, ${yard.y.toFixed(1)}yd)`;
}
function updateBallCoordsLabel(point = lastBallDisplayPoint) {
  lastBallDisplayPoint = point ?? lastBallDisplayPoint;
  const node = markerNode("ball");
  const label = node?.querySelector(".match-lab-ball-coords");
  if (!label) return;
  label.dataset.visible = String(state.showBallCoords);
  if (state.showBallCoords && lastBallDisplayPoint) {
    label.textContent = ballCoordsLabelText(lastBallDisplayPoint);
  }
}

// A real reported ambiguity the ball-only readout above couldn't settle
// on its own: "the ball is pushed away/collapses inward" screenshots
// showed the ball's OWN coordinates barely changing between two frames
// -- proof the discrepancy was the now-removed --ball-rest-x/y cosmetic
// offset (see renderPlaybackFrame()'s own Ball Realism v1 comment), never
// the ball's real position. Shown only for the CURRENT ball owner (every
// other player's own copy stays hidden) -- hides the PREVIOUS owner's the
// instant possession moves on, so a stale reading never lingers on the
// wrong player.
let lastCoordsOwnerId = null;
let lastCoordsOwnerPoint = null;
function updatePlayerCoordsLabel(ownerId = lastCoordsOwnerId, point = lastCoordsOwnerPoint) {
  if (lastCoordsOwnerId && lastCoordsOwnerId !== ownerId) {
    const previousLabel = markerNode(lastCoordsOwnerId)?.querySelector(".match-lab-player-coords");
    if (previousLabel) previousLabel.dataset.visible = "false";
  }
  lastCoordsOwnerId = ownerId;
  lastCoordsOwnerPoint = point ?? lastCoordsOwnerPoint;
  if (!ownerId) return;
  const label = markerNode(ownerId)?.querySelector(".match-lab-player-coords");
  if (!label) return;
  label.dataset.visible = String(state.showBallCoords);
  if (state.showBallCoords && lastCoordsOwnerPoint) {
    label.textContent = ballCoordsLabelText(lastCoordsOwnerPoint);
  }
}

// Stamina Bars v1 (2026-08-31) -- off by default (#labShowStaminaCheckbox).
// Unlike the coordinate HUD above (current owner only), this shows for
// EVERY player at once -- a genuine fitness readout, not a one-owner
// debugging aid. Reads whatever burst01 buildPlaybackPlan()'s own
// initialBurst seed / the live trace's real drain-and-refill produced for
// THAT exact player (matchLabPlayback.js's own playerBurstCursor) --
// never fabricated for a player the current plan happens to say nothing
// about (an unplaced roster slot, say), which renders as a full,
// unlabeled bar rather than a fake reading. lastStaminaByPlayerId
// remembers the last real value per player so toggling the switch back on
// mid-playback (or before any possession has run at all) still shows a
// real number immediately, not a blank bar until the next frame.
const lastStaminaByPlayerId = {};
function updateStaminaBar(id, burst01) {
  if (typeof burst01 === "number") lastStaminaByPlayerId[id] = burst01;
  const marker = markerNode(id);
  const bar = marker?.querySelector(".match-lab-stamina-bar");
  if (!marker || !bar) return;
  marker.dataset.showStamina = String(state.showStaminaBars);
  bar.dataset.visible = String(state.showStaminaBars);
  if (!state.showStaminaBars) return;
  const value = typeof burst01 === "number" ? burst01 : (lastStaminaByPlayerId[id] ?? 1);
  const pct = Math.round(clamp(0, 1, value) * 100);
  bar.dataset.low = String(pct < 35);
  const fill = bar.querySelector(".match-lab-stamina-bar-fill");
  if (fill) fill.style.setProperty("--stamina-pct", `${pct}%`);
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
// aspect ratio). Direction is "toward the center of the goal being
// attacked," computed fresh here in real yard-space (an ANGLE needs true
// yard proportions, not a raw percent-space vector, which the pitch's
// non-square aspect ratio would otherwise distort), plus an optional
// scanOffsetRadians (scanOffsetRad()'s own output) added on top -- see
// that function's comment for what actually drives it.
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
  const landscape = matchPitchIsLandscape(rect);
  const displayFrom = matchPitchDisplayPoint(fromPoint, landscape);
  const displayNudged = matchPitchDisplayPoint(nudged, landscape);
  const dx = ((displayNudged.x - displayFrom.x) / 100) * rect.width;
  const dy = ((displayNudged.y - displayFrom.y) / 100) * rect.height;
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

if (elements.showCoordsCheckbox) {
  elements.showCoordsCheckbox.addEventListener("change", () => {
    state.showBallCoords = elements.showCoordsCheckbox.checked;
    updateBallCoordsLabel();
    updatePlayerCoordsLabel();
  });
}

if (elements.showStaminaCheckbox) {
  elements.showStaminaCheckbox.addEventListener("change", () => {
    state.showStaminaBars = elements.showStaminaCheckbox.checked;
    for (const entry of state.roster) {
      updateStaminaBar(entry.id, lastStaminaByPlayerId[entry.id]);
    }
  });
}

function tacticalBandYRange(index, attackingDirection) {
  const progressStart = DEPTH_BOUNDARIES_YARDS[index];
  const progressEnd = DEPTH_BOUNDARIES_YARDS[index + 1];
  return attackingDirection === "up"
    ? { y: PITCH_LENGTH_YARDS - progressEnd, height: progressEnd - progressStart }
    : { y: progressStart, height: progressEnd - progressStart };
}

// Playback deliberately clears ownerId while the ball is in flight. The
// tactical lens still needs the direction of the side that last possessed it,
// otherwise an away-team pass temporarily flips the grid to Home's direction.
// Read that fact from the playback plan's authoritative owner track so seeking
// and replay stay deterministic; never invent or write gameplay ownership.
function lastKnownOwnerIdAt(timeMs) {
  const ownerTrack = state.lastPlan?.tracks?.owner || [];
  let ownerId = null;
  for (const entry of ownerTrack) {
    if (entry.timeMs > timeMs + 0.001) break;
    if (entry.ownerId != null) ownerId = entry.ownerId;
  }
  return ownerId;
}

function updateTacticalRegionOverlay(
  point = lastBallDisplayPoint ?? state.ball,
  ownerId = currentLabelOwnerId,
  timeMs = state.playbackTimeMs,
) {
  const layer = elements.tacticalRegionsLayer;
  const hud = elements.tacticalRegionsHud;
  if (!layer || !hud) return;
  const visible = Boolean(state.showTacticalRegions && state.mode === "freeplay");
  layer.dataset.visible = String(visible);
  hud.hidden = !visible;
  if (!visible) {
    layer.innerHTML = "";
    return;
  }
  const orientationOwnerId = ownerId ?? lastKnownOwnerIdAt(timeMs);
  const owner = orientationOwnerId
    ? state.roster.find((entry) => String(entry.id) === String(orientationOwnerId)) ?? null
    : null;
  const team = owner?.team ?? "home";
  const attackingDirection = state.attackingDirection[team] ?? "down";
  const svg = [];
  for (let laneIndex = 0; laneIndex < VERTICAL_LANES.length; laneIndex += 1) {
    const lane = VERTICAL_LANES[laneIndex];
    const x = LANE_BOUNDARIES_YARDS[laneIndex];
    const width = LANE_BOUNDARIES_YARDS[laneIndex + 1] - x;
    for (let bandIndex = 0; bandIndex < TACTICAL_DEPTH_BANDS.length; bandIndex += 1) {
      const depthBand = TACTICAL_DEPTH_BANDS[bandIndex];
      const range = tacticalBandYRange(bandIndex, attackingDirection);
      const id = tacticalRegionId(lane, depthBand);
      svg.push(
        `<rect class="ml-tactical-region-cell" data-region-id="${id}" `
        + `data-lane-index="${laneIndex}" data-band-index="${bandIndex}" `
        + `x="${x}" y="${range.y}" width="${width}" height="${range.height}">`
        + `<title>${id}</title></rect>`,
      );
    }
  }
  layer.innerHTML = svg.join("");
  const ballRegion = classifyTacticalRegion(point ?? state.ball, attackingDirection);
  const snapshot = shapeSnapshotAt(state.playbackTimeMs);
  const intention = orientationOwnerId
    ? Object.values(snapshot?.teams || {}).flatMap((entry) => entry.assignments || [])
      .find((assignment) => String(assignment.id) === String(orientationOwnerId))
    : null;
  const intentionText = intention?.intendedRegion
    ? `\n${intention.teamJob}: ${intention.intendedRegion.lane} / ${intention.intendedRegion.depthBand} · ${intention.intendedRegion.id}`
    : "";
  hud.textContent = `${team} attacks ${attackingDirection} · ball: ${ballRegion.lane} / ${ballRegion.depthBand} · ${ballRegion.id}${intentionText}`;
}

if (elements.showTacticalRegionsCheckbox) {
  elements.showTacticalRegionsCheckbox.addEventListener("change", () => {
    state.showTacticalRegions = elements.showTacticalRegionsCheckbox.checked;
    updateTacticalRegionOverlay();
  });
}

function shapeSnapshotAt(timeMs) {
  const snapshots = state.lastRun?.shapeSnapshots || [];
  if (!snapshots.length) return null;
  let selected = snapshots[0];
  for (const snapshot of snapshots) {
    if (snapshot.timeMs <= timeMs + 0.001) selected = snapshot;
    else break;
  }
  return selected;
}

function shapeSvgPoint(point) {
  return { x: (Number(point?.x) || 0) * 0.75, y: (Number(point?.y) || 0) * 1.2 };
}

function escapeShapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}

function updateTeamShapeOverlay(timeMs = state.playbackTimeMs) {
  if (!elements.teamShapeLayer || !elements.teamShapeHud) return;
  const visible = Boolean(state.showTeamShapeDiagnostics && state.mode === "freeplay");
  elements.teamShapeLayer.dataset.visible = String(visible);
  elements.teamShapeHud.hidden = !visible;
  if (!visible) {
    elements.teamShapeLayer.innerHTML = "";
    return;
  }
  const snapshot = shapeSnapshotAt(timeMs);
  if (!snapshot) {
    elements.teamShapeLayer.innerHTML = "";
    elements.teamShapeHud.textContent = "Team shape: resolve a possession to inspect live targets";
    return;
  }
  const svg = [];
  const hud = [];
  for (const [team, diagnostic] of Object.entries(snapshot.teams || {})) {
    const metric = diagnostic.metrics || {};
    const direction = state.attackingDirection[team];
    const lineY = (heightYards) => direction === "up"
      ? 120 - Number(heightYards)
      : Number(heightYards);
    for (const [name, value] of [
      ["defence", metric.defensiveLineHeightYards],
      ["midfield", metric.midfieldLineHeightYards],
      ["forward", metric.forwardLineHeightYards],
    ]) {
      if (!Number.isFinite(value)) continue;
      svg.push(`<line class="ml-shape-line ml-shape-${team}" x1="0" y1="${lineY(value).toFixed(2)}" x2="75" y2="${lineY(value).toFixed(2)}"><title>${escapeShapeText(`${team} ${name} line`)}</title></line>`);
    }
    if (metric.centroid) {
      const centroid = shapeSvgPoint(metric.centroid);
      svg.push(`<circle class="ml-shape-centroid ml-shape-${team}" cx="${centroid.x.toFixed(2)}" cy="${centroid.y.toFixed(2)}" r="1.15"><title>${escapeShapeText(`${team} centroid`)}</title></circle>`);
    }
    for (const assignment of diagnostic.assignments || []) {
      const anchor = shapeSvgPoint(assignment.formationAnchor);
      const shape = shapeSvgPoint(assignment.shapeTarget);
      const intention = shapeSvgPoint(assignment.intentionTarget);
      const title = escapeShapeText(
        `${assignment.positionalSlot || "slot"} · ${assignment.tacticalRole || "role"} (${assignment.duty || "duty"}) · ${assignment.teamJob} · ${assignment.intendedRegion?.id || assignment.occupiedLane}`,
      );
      svg.push(`<g class="ml-shape-assignment ml-shape-${team}"><title>${title}</title><line class="ml-shape-anchor-link" x1="${anchor.x.toFixed(2)}" y1="${anchor.y.toFixed(2)}" x2="${shape.x.toFixed(2)}" y2="${shape.y.toFixed(2)}"/><circle class="ml-shape-anchor" cx="${anchor.x.toFixed(2)}" cy="${anchor.y.toFixed(2)}" r="0.55"/><line class="ml-shape-intention-link" x1="${shape.x.toFixed(2)}" y1="${shape.y.toFixed(2)}" x2="${intention.x.toFixed(2)}" y2="${intention.y.toFixed(2)}"/><rect class="ml-shape-target" x="${(shape.x - 0.65).toFixed(2)}" y="${(shape.y - 0.65).toFixed(2)}" width="1.3" height="1.3"/><circle class="ml-shape-intention" cx="${intention.x.toFixed(2)}" cy="${intention.y.toFixed(2)}" r="0.7"/></g>`);
      const marker = markerNode(assignment.id);
      if (marker) {
        marker.dataset.teamPhase = assignment.teamPhase;
        marker.dataset.teamJob = assignment.teamJob;
        marker.dataset.occupiedLane = assignment.occupiedLane;
        marker.dataset.occupiedDepthBand = assignment.occupiedDepthBand || "";
        marker.dataset.tacticalRegion = assignment.intendedRegion?.id || "";
        marker.title = `${assignment.tacticalRole || assignment.positionalSlot || "player"} (${assignment.duty || "n/a"}) · ${assignment.teamJob} · ${assignment.intendedRegion?.id || assignment.occupiedLane}`;
      }
    }
    hud.push(`${team}: ${diagnostic.phase} · ${Number(metric.widthYards || 0).toFixed(1)}yd W × ${Number(metric.lengthYards || 0).toFixed(1)}yd L · ${metric.occupiedLanes || 0} lanes / ${metric.occupiedDepthBands || 0} bands · ${metric.halfSpacePlayers || 0} half-space · ${metric.runsIntoOpenRegions || 0} open / ${metric.runsIntoOccupiedRegions || 0} occupied runs · ${metric.restDefenceCount || 0} rest defence`);
  }
  elements.teamShapeLayer.innerHTML = svg.join("");
  elements.teamShapeHud.textContent = hud.join("\n");
}

if (elements.showTeamShapeCheckbox) {
  elements.showTeamShapeCheckbox.addEventListener("change", () => {
    state.showTeamShapeDiagnostics = elements.showTeamShapeCheckbox.checked;
    updateTeamShapeOverlay();
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
    const displayX = Math.min(
      100,
      Math.max(0, ((moveEvent.clientX - rect.left) / rect.width) * 100),
    );
    const displayY = Math.min(
      100,
      Math.max(0, ((moveEvent.clientY - rect.top) / rect.height) * 100),
    );
    const { x, y } = matchPitchWorldPoint(
      { x: displayX, y: displayY },
      matchPitchIsLandscape(rect),
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
    attackingSettingsFor(groups.owner.team),
    // Joint Passer/Runner Candidate Generation v1 (Stage 3) -- the SAME deps
    // the real decision uses, so this read-only panel can never silently
    // drift from what the engine actually chooses. engagementHistory and
    // congestionTracker have no meaning for a preview of the CURRENT board,
    // so they stay null exactly as they always were here.
    null,
    null,
    JOINT_CANDIDATE_DEPS,
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
    shoot: "outside credible range (ordinary attempts to 32 m; specialists to 40 m), angle too narrow, or no exposed goal beyond it",
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

// World Motion Contract v1 (2026-09-03) -- development telemetry, not
// game UI. Every number here is read straight off the plan's own
// moveDiagnostics (matchLabPlayback.js), which derives them from state
// the engine already committed; nothing is recomputed or estimated here.
// The point is that the five things the contract separates
// (MATCH_ENGINE_ARCHITECTURE.md -- intention, target, gait, trajectory,
// authoritative position) are individually inspectable for whoever is on
// the ball and whoever is closest to them.
function movementDiagnosticMarkup(item = {}) {
  const rounded = (value, digits = 1) =>
    Number.isFinite(value) ? Number(value.toFixed(digits)) : "unavailable";
  const coordinate = (point) =>
    point ? `(${rounded(point.x, 1)}, ${rounded(point.y, 1)})` : "unavailable";
  const reachability =
    item.reachable === null || item.reachable === undefined
      ? ""
      : ` &middot; ${item.reachable ? "reachable" : "unreachable"}`;
  const contactReach = item.reachAllowanceYards > 0
    ? ` &middot; Contact reach: ${rounded(item.reachAllowanceYards)} yd`
    : "";
  const intention = item.intention
    ? ` &middot; Intention: ${item.intention}${item.intentionTarget ? ` &rarr; ${coordinate(item.intentionTarget)}` : ""}`
    : "";
  const gait = item.gait ? ` &middot; Requested gait: ${item.gait}` : "";
  // The one line that tells you whether this move was physically honest:
  // ground covered versus ground this player could actually have covered
  // in the window it was scheduled into, from the speed they entered at.
  const limit = item.withinPhysicalLimit === false
    ? `<br><strong class="match-lab-move-overrun">Exceeds physical limit by ${rounded(item.overrunYards, 2)} yd` +
      ` (reachable: ${rounded(item.reachableYards, 2)} yd)</strong>`
    : "";
  return (
    `<li><strong>Move: ${item.action}</strong><small>` +
    `${coordinate(item.fromPosition)} &rarr; ${coordinate(item.toPosition)} &middot; ` +
    `Distance: ${rounded(item.distanceYards)} yd &middot; Natural ETA: ${rounded(item.naturalEtaMs, 0)} ms &middot; ` +
    `Scheduled duration: ${rounded(item.scheduledDurationMs, 0)} ms &middot; ` +
    `Start speed: ${rounded(item.startSpeedYardsPerSecond, 2)} yd/s &middot; ` +
    `End speed: ${rounded(item.endSpeedYardsPerSecond, 2)} yd/s &middot; ` +
    `Average speed: ${rounded(item.averageSpeedYardsPerSecond, 2)} yd/s &middot; ` +
    `Player top speed: ${rounded(item.topSpeedYardsPerSecond, 2)} yd/s &middot; ` +
    `Acceleration contribution: ${rounded(item.accelerationContributionYards, 2)} yd` +
    `${gait}${intention}${contactReach}${reachability}${limit}</small></li>`
  );
}

// World Motion Contract v1 (2026-09-03) -- a multi-touch carry is ONE
// continuous run that happens to contain several physical ball contacts;
// listing each P.CARRY.TOUCH as its own top-level headline made an
// ordinary 11-touch carry read as eleven separate major actions and
// buried everything around it. Consecutive touches collapse into one
// group row here.
//
// Purely presentational, and deliberately a PURE function over the trace
// (no DOM, no state) so it is testable and so the grouping can never
// affect anything else: every event keeps its own trace index, its own
// attribution and Movement timing markup (nested one level down), and its
// own place in the playback plan. Stepping, replay, diagnostics and every
// test see exactly the same trace they did before.
//
// Returns a list of rows, each either
//   { type: "event", step, index }
//   { type: "group", code, items: [{ step, index }, ...] }
// A lone touch is never grouped -- a group of one is just noise.
function groupTraceRows(visible = []) {
  const groupable = (candidate) => candidate?.code === "P.CARRY.TOUCH";
  const rows = [];
  let index = 0;
  while (index < visible.length) {
    if (!groupable(visible[index])) {
      rows.push({ type: "event", step: visible[index], index });
      index += 1;
      continue;
    }
    const items = [];
    const code = visible[index].code;
    while (index < visible.length && groupable(visible[index])) {
      items.push({ step: visible[index], index });
      index += 1;
    }
    rows.push(items.length === 1
      ? { type: "event", step: items[0].step, index: items[0].index }
      : { type: "group", code, items });
  }
  return rows;
}

function coordinationDiagnosticMarkup(evidence) {
  if (!evidence) return "";
  const candidateRows = (evidence.candidates ?? []).map((candidate) => {
    const utility = candidate.utility == null ? "ineligible" : Number(candidate.utility).toFixed(1);
    const tactics = (candidate.tacticalContributions ?? [])
      .map((entry) => `${entry.label} ${entry.value >= 0 ? "+" : ""}${Number(entry.value).toFixed(1)}`)
      .join(", ");
    return `<li><strong>${escapeMatchText(candidate.family)}</strong>: ${escapeMatchText(utility)}${tactics ? ` <small>${escapeMatchText(tactics)}</small>` : ""}</li>`;
  }).join("");
  const roleRows = (evidence.intentions ?? []).map((intent) =>
    `<li>${escapeMatchText(intent.playerId)}: <strong>${escapeMatchText(intent.responsibility)}</strong> <small>${escapeMatchText(intent.relationship || "")}</small></li>`).join("");
  const pressureRows = (evidence.pressureCandidates ?? []).slice(0, 4).map((candidate) =>
    `<li>${escapeMatchText(candidate.id)}: ${Math.round(Number(candidate.etaMs) || 0)} ms, angle ${Math.round(Number(candidate.approachAngle) || 0)} degrees</li>`).join("");
  const transferRows = (evidence.transfers ?? []).map((transfer) =>
    `<li>${escapeMatchText(transfer.type)}: ${escapeMatchText(transfer.fromId)} to ${escapeMatchText(transfer.toId)}; ${escapeMatchText(transfer.reason)}</li>`).join("");
  const threatRows = (evidence.threats ?? []).map((threat) =>
    `<li>#${threat.rank} ${escapeMatchText(threat.playerId)}: ${escapeMatchText(threat.responsibility)}, danger ${Number(threat.danger).toFixed(1)}</li>`).join("");
  const attributeRows = Object.entries(evidence.participantAttributes ?? {}).map(([playerId, detail]) => {
    const values = Object.entries(detail.inputs ?? {}).map(([label, value]) => `${label} ${value}`).join(", ");
    return `<li>${escapeMatchText(playerId)} (${escapeMatchText(detail.responsibility)}): ${escapeMatchText(values)}</li>`;
  }).join("");
  const worldRows = Object.entries(evidence.world?.players ?? {}).map(([playerId, snapshot]) =>
    `<li>${escapeMatchText(playerId)}: (${Number(snapshot.position?.x).toFixed(1)}, ${Number(snapshot.position?.y).toFixed(1)}), velocity (${Number(snapshot.velocity?.x || 0).toFixed(4)}, ${Number(snapshot.velocity?.y || 0).toFixed(4)})</li>`).join("");
  const line = evidence.defensiveLine;
  const lineMarkup = line
    ? `<p><strong>Defensive line:</strong> ${Number(line.depthYards).toFixed(1)} yd from goal · ${line.pressureControlled ? "pressure controlled" : "passer has time"}${line.offsideTrapStep ? " · coordinated step" : line.safetyDropYards ? ` · ${Number(line.safetyDropYards).toFixed(1)} yd safety drop` : ""}</p>`
    : "";
  const keeper = evidence.goalkeeper;
  const keeperMarkup = keeper
    ? `<p><strong>Goalkeeper angle:</strong> ${escapeMatchText(keeper.action)} · depth ${Number(keeper.desiredDepthYards).toFixed(1)} yd · cone ${Number(keeper.coneWidthAtTargetYards).toFixed(1)} yd · coverage ${Math.round(Number(keeper.estimatedCoverageRatio) * 100)}%</p>`
    : "";
  const selected = evidence.selectedAttack?.family ?? "none";
  const defence = evidence.selectedDefense?.family ?? "none";
  return `<details class="match-lab-trace-attribution match-lab-coordination-diagnostics"><summary>Coordination</summary>`
    + `<p><strong>${escapeMatchText(selected)}</strong> against <strong>${escapeMatchText(defence)}</strong></p>`
    + (candidateRows ? `<h5>Pattern candidates</h5><ul>${candidateRows}</ul>` : "")
    + (roleRows ? `<h5>Reserved responsibilities</h5><ul>${roleRows}</ul>` : "")
    + (threatRows ? `<h5>Ranked threats</h5><ul>${threatRows}</ul>` : "")
    + (pressureRows ? `<h5>Pressure arrival</h5><ul>${pressureRows}</ul>` : "")
    + (transferRows ? `<h5>Transfers</h5><ul>${transferRows}</ul>` : "")
    + lineMarkup
    + keeperMarkup
    + (attributeRows ? `<h5>Material attribute inputs</h5><ul>${attributeRows}</ul>` : "")
    + (worldRows ? `<h5>World snapshot</h5><ul>${worldRows}</ul>` : "")
    + ((evidence.reservationConflicts ?? []).length
      ? `<p><strong>Reservation conflict:</strong> ${escapeMatchText(JSON.stringify(evidence.reservationConflicts))}</p>` : "")
    + (evidence.aborted ? `<p><strong>Aborted:</strong> ${escapeMatchText(evidence.aborted.reason)}</p>` : "")
    + (evidence.completed ? `<p><strong>Completed:</strong> ${escapeMatchText(evidence.completed.reason)}</p>` : "")
    + (evidence.fallbackReason ? `<p><strong>Fallback:</strong> ${escapeMatchText(evidence.fallbackReason)}</p>` : "")
    + `</details>`;
}

function renderTrace(upToIndex) {
  const trace = state.lastTrace || [];
  const visible = trace.slice(0, upToIndex);
  elements.trace.hidden = visible.length === 0;
  elements.traceSource.textContent =
    state.lastMode === "freeplay"
      ? "action choice: Match Lab experimental sparse-roster model · action resolution: production engine · animation: visual interpolation between engine states"
      : "action resolution: production engine · animation: visual interpolation between engine states";
  const entryMarkup = (step, index, isCurrent) => {
    const attribution = (step.attribution || [])
      .map(attributionEntryMarkup)
      .join("");
    let disclosure = attribution
      ? `<details class="match-lab-trace-attribution"><summary>Attribute influence</summary><ul>${attribution}</ul></details>`
      : "";
    disclosure += coordinationDiagnosticMarkup(step.coordination ?? step.metrics?.coordination ?? null);
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
    return `<li data-current="${isCurrent}"><span class="match-lab-trace-code">${step.code}</span> — ${step.label}${disclosure}</li>`;
  };
  const rows = groupTraceRows(visible).map((row) => {
    if (row.type === "event") {
      return entryMarkup(row.step, row.index, row.index === visible.length - 1);
    }
    const containsCurrent = row.items.some((item) => item.index === visible.length - 1);
    const inner = row.items
      .map((item) => entryMarkup(item.step, item.index, item.index === visible.length - 1))
      .join("");
    return (
      `<li class="match-lab-trace-group" data-current="${containsCurrent}">` +
      `<details${containsCurrent ? " open" : ""}>` +
      `<summary><span class="match-lab-trace-code">${row.code}</span> — ` +
      `${row.items.length} carry touches</summary>` +
      `<ol class="match-lab-trace-sublist">${inner}</ol>` +
      `</details></li>`
    );
  });
  elements.traceList.innerHTML = rows.join("");
  elements.stepButton.hidden = trace.length <= 1;
  elements.stepBackButton.hidden = trace.length <= 1;
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
    node.removeAttribute("data-signal-arms");
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
  if (event.code === "RESTART.SIGNAL" && event.actorId) {
    const signalNode = markerNode(event.actorId);
    if (signalNode) {
      signalNode.dataset.signalArms = String(event.metrics?.restartPreparation?.signalArms ?? 1);
      activeEffectNodes.push(signalNode);
    }
  }
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
let highlightWindows = [];
const highlightModeControl = document.querySelector("#labHighlightMode");
const betweenSpeedControl = document.querySelector("#labBetweenSpeed");
const highlightStatus = document.querySelector("#labHighlightStatus");
const matchInterlude = document.querySelector("#labMatchInterlude");
function refreshHighlights() {
  if (!state.lastPlan) return;
  const mode = highlightModeControl?.value || "full";
  highlightWindows = buildHighlightWindows(state.lastTrace ?? [], state.lastPlan, mode);
  const upcoming = matchSession?.peek();
  if (activeMatchChunk && upcoming && mode !== "full" && mode !== "commentary") {
    const lead = { comprehensive: 12000, extended: 9000, key: 7000 }[mode] ?? 7000;
    const nextWindows = buildHighlightWindows(upcoming.output.trace, upcoming.plan, mode);
    if (nextWindows[0]?.startMs === 0) {
      highlightWindows.push({ startMs: Math.max(0, state.lastPlan.durationMs - lead), endMs: state.lastPlan.durationMs });
      highlightWindows.sort((a, b) => a.startMs - b.startMs);
    }
  }
}
highlightModeControl?.addEventListener("change", refreshHighlights);
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
  matchAutoPlay = false;
  rendererGapMonitor.sample(performance.now(), false);
  const wasPlaying = isPlaying();
  playbackClock?.pause();
  if (wasPlaying) stopAllSound();
  updatePlayPauseButton();
}

function applyPlaybackCue(event, cue = null) {
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
  const hasDeferredTerminalAudio = Boolean(
    cue?.audioMilestone && Number.isFinite(cue.audioTimeMs),
  );
  if (!hasDeferredTerminalAudio) playEvent(event, buildSoundContext(event));
  if (event.code === "RESTART.SIGNAL" && event.actorId) {
    const signalNode = markerNode(event.actorId);
    if (signalNode) {
      signalNode.dataset.signalArms = String(event.metrics?.restartPreparation?.signalArms ?? 1);
      activeEffectNodes.push(signalNode);
    }
  }
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
  if (elements.resultBadge && !hasDeferredTerminalAudio) {
    elements.resultBadge.textContent = event.badge || "";
    elements.resultBadge.dataset.kind = (event.badge || "").toLowerCase();
    elements.resultBadge.dataset.visible = String(Boolean(event.badge));
  }
}

// Timeline playback samples the ball's real trajectory itself, so its
// terminal audio must use that same clock. This deliberately bypasses
// playEvent() only for a plan cue that declares an arrival milestone; the
// ordinary step-animation path still uses its own animation callbacks.
function applyDeferredPlaybackAudio(event, cue) {
  if (!event || !cue?.audioMilestone) return;
  const soundCtx = buildSoundContext(event);
  for (const step of resolveCueSequence(event.code, soundCtx)) {
    if (step.milestone === cue.audioMilestone) fireCueStep(step, soundCtx);
  }
  if (elements.resultBadge) {
    elements.resultBadge.textContent = event.badge || "";
    elements.resultBadge.dataset.kind = (event.badge || "").toLowerCase();
    elements.resultBadge.dataset.visible = String(Boolean(event.badge));
  }
}

function renderPlaybackFrame(snapshot) {
  if (activeMatchChunk && matchTelemetry) {
    observeMatchFrame(matchTelemetry, {
      timeMs: Math.min(activeMatchChunk.endMs, activeMatchChunk.startMs + snapshot.timeMs),
      players: snapshot.players,
      ownerId: snapshot.ownerId ?? null,
      inPlay: snapshot.ball?.mode !== "dead",
    });
    renderMatchTelemetry();
  }
  if (activeMatchChunk && matchStatus) {
    const playedMs = Math.min(activeMatchChunk.endMs, activeMatchChunk.startMs + snapshot.timeMs);
    const minute = Math.floor(playedMs / 60000);
    const second = Math.floor(playedMs / 1000) % 60;
    const score = { ...matchScore };
    for (const interval of state.lastPlan?.intervals ?? []) {
      const event = state.lastTrace[interval.eventIndex];
      if (activeMatchChunk.scoreCommitted || interval.endMs > snapshot.timeMs || (event?.outcome !== "goal" && event?.badge !== "GOAL")) continue;
      const team = state.roster.find((entry) => entry.id === event.actorId)?.team;
      if (team in score) score[team] += 1;
    }
    matchStatus.textContent = `${minute}:${String(second).padStart(2, "0")} | Home ${score.home} - ${score.away} Away | ${activeMatchChunk.secondHalf ? "Second" : "First"} half`;
  }
  const visible = isHighlightTime(highlightWindows, snapshot.timeMs);
  const commentaryOnly = highlightModeControl?.value === "commentary";
  if (highlightStatus) highlightStatus.textContent = commentaryOnly ? "Commentary only" : visible ? "Showing match action" : "Between highlights";
  // Keep commentary/time current while quiet play is accelerated. Suppress
  // the pitch and audio rather than playing every skipped cue in a burst.
  elements.pitch.style.visibility = visible ? "visible" : "hidden";
  if (matchInterlude) {
    matchInterlude.hidden = visible;
    matchInterlude.textContent = commentaryOnly ? "Follow the match in commentary" : "Between highlights";
  }

  if (!state.lastPlan) return;
  rendererGapMonitor.sample(performance.now(), Boolean(playbackClock?.getState?.().playing));
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
    updateStaminaBar(id, typeof point.burst01 === "number" ? point.burst01 : undefined);
  }
  updateLabelVisibility(snapshot.ownerId ?? null);
  const possessionOwner = snapshot.ownerId
    ? state.roster.find((entry) => entry.id === snapshot.ownerId) || null
    : null;
  const possessionOwnerPoint = possessionOwner
    ? snapshot.players[possessionOwner.id]
    : null;
  updatePlayerCoordsLabel(snapshot.ownerId ?? null, possessionOwnerPoint);
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
    // Ball Realism v1 (2026-08-31) -- a real, explicit demand: the ball's
    // OWN authored position (buildBallTrajectory()/carryLegBallTrajectory()/
    // simulateCarryTouches() -- the exact same numbers this file's own
    // Ball Coordinates HUD reads and every ballFrom/ballTo/contact.point
    // in the trace already commits to) is now what gets drawn, always, no
    // exception. The previous design substituted the OWNER's own position
    // plus a synthetic, speed-scaled pixel nudge ("restingBallOffsetPx()")
    // whenever the ball's own mode read "controlled"/"controlled-ground" --
    // a real, deliberate cosmetic override of genuinely-simulated data,
    // and the direct cause of a real reported bug ("the ball looks
    // teleported... should not be cosmetic"): a carry's own real ball
    // track already leads and settles believably (carryLegBallTrajectory()'s
    // own sin() ramp, capped to the leg's real distance), and a live touch
    // already rolls independently under real friction
    // (simulateCarryTouches()) -- neither of those needed a fake overlay,
    // and the overlay's own synthetic speed/direction signal is exactly
    // what produced the "snap" artifacts across several real bug reports.
    // A genuinely stationary ball (a hold, an uncontested pause) already
    // has ballFrom===ballTo===the owner's own position authored directly
    // by the resolver -- rendering that verbatim looks IDENTICAL to "at
    // their feet" with zero synthetic logic required.
    setMarkerPosition("ball", snapshot.ball.x, snapshot.ball.y, {
      animate: false,
      duration: 0,
    });
    updateBallCoordsLabel(snapshot.ball);
    const ballNode = markerNode("ball");
    if (ballNode) {
      ballNode.dataset.held = String(snapshot.ball.mode === "held");
      ballNode.dataset.flight =
        snapshot.ball.mode === "airborne" || snapshot.ball.mode === "bouncing"
          ? "true"
          : "false";
      ballNode.style.setProperty(
        "--ball-lift",
        `${Math.min(26, Math.max(0, snapshot.ball.height || 0) * 4)}px`,
      );
      ballNode.style.setProperty(
        "--ball-flight-scale",
        String(Math.min(1.24, 1 + Math.max(0, snapshot.ball.height || 0) * 0.04)),
      );
    }
  }

  // Visual cues and deferred terminal sounds share one playback-time cursor.
  // Sorting matters when one frame crosses several boundaries (high playback
  // speed or a renderer hitch): every cue still fires in football-time order.
  const dueCues = state.lastPlan.cues.flatMap((cue) => [
    { timeMs: cue.timeMs, kind: "visual", cue },
    ...(Number.isFinite(cue.audioTimeMs)
      ? [{ timeMs: cue.audioTimeMs, kind: "audio", cue }]
      : []),
  ]).sort((left, right) => (
    left.timeMs - right.timeMs
    || Number(left.kind === "audio") - Number(right.kind === "audio")
    || left.cue.eventIndex - right.cue.eventIndex
  ));
  for (const scheduledCue of dueCues) {
    if (
      scheduledCue.timeMs > lastRenderedCueTime + 0.001 &&
      scheduledCue.timeMs <= snapshot.timeMs + 0.001
    ) {
      const cue = scheduledCue.cue;
      state.stepIndex = cue.eventIndex + 1;
      const event = state.lastTrace[cue.eventIndex];
      if (scheduledCue.kind === "visual" && activeMatchChunk && matchTelemetry) {
        observeMatchEvent(matchTelemetry, {
          trace: state.lastTrace,
          eventIndex: cue.eventIndex,
          chunkIndex: activeMatchChunk.index ?? 0,
          matchTimeMs: activeMatchChunk.startMs + scheduledCue.timeMs,
        });
        renderMatchTelemetry(true);
      }
      if (visible && isHighlightTime(highlightWindows, scheduledCue.timeMs)) {
        if (scheduledCue.kind === "audio") applyDeferredPlaybackAudio(event, cue);
        else applyPlaybackCue(event, cue);
      }
    }
  }
  lastRenderedCueTime = snapshot.timeMs;
  if (visibleIndex !== lastRenderedTraceIndex) {
    lastRenderedTraceIndex = visibleIndex;
    state.stepIndex = visibleIndex;
    renderTrace(visibleIndex);
  }
  state.playbackTimeMs = snapshot.timeMs;
  updateTeamShapeOverlay(snapshot.timeMs);
  updateTacticalRegionOverlay(snapshot.ball, snapshot.ownerId, snapshot.timeMs);
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
  // Stamina Bars v1 (2026-08-31) -- the SAME real init formula
  // runConstructedPossession() itself uses (BURST_BASE/BURST_RANGE over
  // conditionMultiplier() at FIXED_MINUTE), computed once here from
  // state.roster so every player's bar reads a real fresh value from
  // frame 0, not just once their first action/job touches the battery.
  const initialBurst = Object.fromEntries(
    state.roster.map((entry) => [String(entry.id), Number.isFinite(entry.burst01) ? { burst01: entry.burst01, match01: entry.match01 } : freshBurst01(entry.player)]),
  );
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
    initialBurst,
  });
}

function createMatchChunkSimulator(seed, { halfDurationMs = 45 * 60 * 1000, initialElapsedMs = 0 } = {}) {
  const keys = ["roster", "ball", "pendingRestart", "restartSetupDraft", "attackingDirection", "attacking", "marking", "transition", "cornerPlans"];
  const input = Object.fromEntries(keys.map((key) => [key, structuredClone(state[key])]));
  const firstTakingTeam = input.pendingRestart?.takingTeam ?? input.roster.find((entry) => entry.id === input.ball.ownerId)?.team ?? "home";
  let secondHalf = initialElapsedMs >= halfDurationMs;
  if (secondHalf) {
    for (const team of Object.keys(input.attackingDirection)) input.attackingDirection[team] = input.attackingDirection[team] === "up" ? "down" : "up";
  }
  return ({ index, continuation, elapsedMs, remainingMs = Infinity }) => {
    const saved = Object.fromEntries(keys.map((key) => [key, state[key]]));
    try {
      Object.assign(state, input);
      if (continuation && !secondHalf && elapsedMs >= halfDurationMs) {
        secondHalf = true;
        for (const team of Object.keys(input.attackingDirection)) input.attackingDirection[team] = input.attackingDirection[team] === "up" ? "down" : "up";
        for (const entry of continuation.roster) {
          if (entry.formationAnchor) entry.formationAnchor = { ...entry.formationAnchor, x: 100 - entry.formationAnchor.x, y: 100 - entry.formationAnchor.y };
        }
        continuation.result = { restart: "kickoff", restartTakingTeam: firstTakingTeam === "home" ? "away" : "home", ballEnd: continuation.simulated.ballPoint };
        continuation.simulated.ownerId = null;
        continuation.motionContext.marking = {};
        continuation.motionContext.teamShapeJobs = {};
      }
      state.roster = continuation?.roster ?? input.roster;
      state.ball = continuation ? { ...continuation.simulated.ballPoint, ownerId: continuation.simulated.ownerId } : input.ball;
      if (continuation) { state.pendingRestart = null; state.restartSetupDraft = null; }
      const initialPositions = Object.fromEntries(state.roster.map((entry) => [entry.id, pointOf(entry)]));
      const initialBall = { ...state.ball };
      const output = runConstructedPossession(seed + index, {
        continuation, maxActions: 8, matchSession: true, stopAtStoppage: true,
      });
      let plan;
      try { plan = buildPlaybackPlan(output); }
      catch (error) {
        error.matchTrace = output.trace;
        error.matchChunkIndex = index;
        throw error;
      }
      const untilBreak = secondHalf ? remainingMs : Math.min(remainingMs, halfDurationMs - elapsedMs);
      if (plan.durationMs > untilBreak) {
        const atBreak = sampleMatchLabPlaybackPlan(plan, untilBreak);
        plan = { ...plan, durationMs: untilBreak, cues: plan.cues.filter((cue) => cue.timeMs <= untilBreak) };
        for (const entry of output.continuation?.roster ?? []) {
          if (atBreak.players[entry.id]) Object.assign(entry, atBreak.players[entry.id]);
        }
        if (output.continuation) {
          output.continuation.simulated.ballPoint = atBreak.ball;
          output.continuation.simulated.ownerId = atBreak.ownerId;
        }
      }
      // Each chunk owns its diagnostics. Persistent jobs, ball state,
      // engagement memory and player stamina continue into the next chunk.
      if (output.continuation) {
        output.continuation.motionContext = { ...output.continuation.motionContext, shapeSnapshots: [] };
      }
      return { output, plan, durationMs: plan.durationMs, continuation: output.continuation, initialPositions, initialBall, secondHalf };
    } finally { Object.assign(state, saved); }
  };
}

let matchSession = null;
let matchAutoPlay = false;
let activeMatchChunk = null;
let matchScore = { home: 0, away: 0 };
let matchTelemetry = null;
let pendingTacticsTeam = null;
let pausedMatch = null;
let pausedTacticsConfirmed = false;
let matchStatsView = "player";
let lastTelemetryRenderMs = -Infinity;
const matchStatus = document.querySelector("#labMatchStatus");
const startMatchButton = document.querySelector("#labStartMatch");
const stopMatchButton = document.querySelector("#labStopMatch");
function renderPausedTacticsActions() {
  if (!elements.resumeMatchButton) return;
  elements.resumeMatchButton.hidden = !pausedMatch;
  elements.resumeMatchButton.disabled = !pausedMatch || !pausedTacticsConfirmed;
  elements.resumeMatchButton.textContent = pausedMatch
    ? `Resume match from ${Math.max(0, Math.ceil(pausedMatch.elapsedMs / 60000))}'`
    : "Resume match";
}

function markPausedTacticsDirty() {
  if (!pausedMatch) return;
  pausedTacticsConfirmed = false;
  renderPausedTacticsActions();
  if (elements.tacticsStatus) elements.tacticsStatus.textContent = "Tactical draft changed. Confirm changes before resuming.";
}

function stopMatchSession() {
  matchAutoPlay = false;
  matchSession?.stop();
  matchSession = null;
  activeMatchChunk = null;
  pendingTacticsTeam = null;
  pausedMatch = null;
  pausedTacticsConfirmed = false;
  renderPausedTacticsActions();
  if (startMatchButton) startMatchButton.disabled = false;
  if (stopMatchButton) stopMatchButton.disabled = true;
  elements.pitch.style.visibility = "visible";
  if (matchInterlude) matchInterlude.hidden = true;
  if (elements.tacticsRequestStatus) elements.tacticsRequestStatus.textContent = "";
}

function commitActiveMatchScore() {
  if (!activeMatchChunk || activeMatchChunk.scoreCommitted) return;
  for (const interval of activeMatchChunk.plan.intervals) {
    const event = activeMatchChunk.output.trace[interval.eventIndex];
    if (interval.endMs > activeMatchChunk.plan.durationMs || (event.outcome !== "goal" && event.badge !== "GOAL")) continue;
    const team = state.roster.find((entry) => entry.id === event.actorId)?.team;
    if (team in matchScore) matchScore[team] += 1;
  }
  activeMatchChunk.scoreCommitted = true;
}

function setTacticsDraftTeam(team) {
  state.setupTeamTab = team === "away" ? "away" : "home";
  state.selectedSetupSlotId = null;
}

function openRequestedTactics() {
  if (!pendingTacticsTeam || !activeMatchChunk?.output?.result?.restart) return false;
  commitActiveMatchScore();
  pausedMatch = {
    elapsedMs: activeMatchChunk.endMs,
    continuation: activeMatchChunk.continuation,
    nextIndex: (activeMatchChunk.index ?? 0) + 1,
  };
  pausedTacticsConfirmed = false;
  renderPausedTacticsActions();
  matchAutoPlay = false;
  matchSession?.stop();
  matchSession = null;
  setTacticsDraftTeam(pendingTacticsTeam);
  if (elements.tacticsRequestStatus) elements.tacticsRequestStatus.textContent = "Play is stopped. Confirm changes, then resume the game.";
  if (elements.tacticsStatus) elements.tacticsStatus.textContent = `${pendingTacticsTeam === "home" ? "Home" : "Away"} changes will take effect after confirmation.`;
  showMainWorkspace("tactics");
  renderMatchSetupPanel();
  return true;
}

function requestTactics(team) {
  setTacticsDraftTeam(team);
  if (pausedMatch) {
    pendingTacticsTeam = team;
    showMainWorkspace("tactics");
    renderMatchSetupPanel();
    return;
  }
  if (!matchSession || !matchAutoPlay) {
    showMainWorkspace("tactics");
    renderMatchSetupPanel();
    return;
  }
  pendingTacticsTeam = team;
  if (elements.tacticsRequestStatus) elements.tacticsRequestStatus.textContent = `${team === "home" ? "Home" : "Away"} tactics will open at the next stoppage.`;
}

function escapeMatchText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[character]));
}

function renderMatchTelemetry(force = false) {
  if (!matchTelemetry) return;
  if (!force && matchTelemetry.nowMs - lastTelemetryRenderMs < 250) return;
  lastTelemetryRenderMs = matchTelemetry.nowMs;
  const possession = lastTenMinutePossession(matchTelemetry);
  const home = Math.round(possession.home);
  const away = 100 - home;
  if (elements.homePossession) elements.homePossession.textContent = `${home}%`;
  if (elements.awayPossession) elements.awayPossession.textContent = `${away}%`;
  if (elements.homePossessionBar) elements.homePossessionBar.style.width = `${home}%`;
  if (elements.awayPossessionBar) elements.awayPossessionBar.style.width = `${away}%`;
  elements.homePossessionBar?.parentElement?.setAttribute("aria-label", `Home ${home} percent, away ${away} percent`);
  const line = matchTelemetry.commentary.at(-1);
  if (elements.matchMinute) elements.matchMinute.textContent = `${Math.max(0, Math.ceil(matchTelemetry.nowMs / 60000))}'`;
  if (elements.liveCommentary && line) {
    elements.liveCommentary.textContent = matchTelemetry.nowMs - line.timeMs <= 15000 ? line.text : "Play continues.";
  }
  if (elements.matchStatsPanel?.hidden) return;
  const stats = matchStatsView === "team"
    ? [statsForTeam(matchTelemetry, "home"), statsForTeam(matchTelemetry, "away")]
    : Object.values(matchTelemetry.players);
  if (elements.playerStatsBody) {
    elements.playerStatsBody.innerHTML = stats.map((entry) => {
      const accuracy = entry.passesTotal ? Math.round(entry.passesSuccessful / entry.passesTotal * 100) : 0;
      return `<tr data-team="${entry.team}"><td>${escapeMatchText(entry.name)}</td><td>${(entry.distanceYards * 0.0009144).toFixed(2)} km</td><td>${entry.passesSuccessful}/${entry.passesTotal}</td><td>${accuracy}%</td><td>${entry.keyPasses}</td><td>${entry.shotsOnTarget}</td><td>${entry.shotsMissed}</td></tr>`;
    }).join("");
  }
  const defaultScope = matchStatsView === "team" ? "team:home" : `player:${stats[0]?.id ?? ""}`;
  const heat = heatForScope(matchTelemetry, elements.statsScope?.value || defaultScope);
  const peak = Math.max(1, ...heat);
  if (elements.heatmapGrid) elements.heatmapGrid.innerHTML = heat.map((value) => `<span style="--heat:${(value / peak * 0.82).toFixed(3)}" class="match-heat-cell"></span>`).join("");
}

function populateStatsScope() {
  const playerView = matchStatsView === "player";
  elements.playerStatsTab?.setAttribute("aria-selected", String(playerView));
  elements.teamStatsTab?.setAttribute("aria-selected", String(!playerView));
  elements.playerStatsTab?.classList.toggle("is-selected", playerView);
  elements.teamStatsTab?.classList.toggle("is-selected", !playerView);
  if (elements.statsScopeLabel) elements.statsScopeLabel.textContent = playerView ? "Player heat map" : "Team heat map";
  if (elements.statsNameHeading) elements.statsNameHeading.textContent = playerView ? "Player" : "Team";
  if (!elements.statsScope) return;
  if (!matchTelemetry) {
    elements.statsScope.innerHTML = '<option value="">No match data</option>';
    return;
  }
  const previous = elements.statsScope.value;
  if (!playerView) {
    elements.statsScope.innerHTML = '<option value="team:home">Home team</option><option value="team:away">Away team</option>';
  } else {
    const teamOptions = (team) => Object.values(matchTelemetry.players)
      .filter((player) => player.team === team)
      .map((player) => `<option value="player:${escapeMatchText(player.id)}">${escapeMatchText(player.name)}</option>`)
      .join("");
    elements.statsScope.innerHTML = `<optgroup label="Home players">${teamOptions("home")}</optgroup><optgroup label="Away players">${teamOptions("away")}</optgroup>`;
  }
  const validPrevious = Array.from(elements.statsScope.options ?? []).some((option) => option.value === previous);
  if (validPrevious) elements.statsScope.value = previous;
}

function setMatchStatsView(view) {
  matchStatsView = view === "team" ? "team" : "player";
  populateStatsScope();
  renderMatchTelemetry(true);
}

function playNextMatchChunk() {
  if (!matchSession || !matchAutoPlay || isPlaying()) return;
  if (activeMatchChunk) commitActiveMatchScore();
  if (pendingTacticsTeam && activeMatchChunk && openRequestedTactics()) return;
  // Keep one following chunk available so highlights include the build-up
  // to a chance that begins across a simulation boundary.
  if (matchSession.getState().buffered < 2 && !matchSession.getState().complete) return;
  const next = matchSession.take();
  if (!next) {
    if (matchSession.getState().complete) {
      if (matchStatus) matchStatus.textContent = `Full time | Home ${matchScore.home} - ${matchScore.away} Away`;
      stopMatchSession();
    }
    return;
  }
  activeMatchChunk = next;
  state.lastTrace = next.output.trace;
  state.lastRun = next.output;
  installPlaybackPlan(next.output, next.plan);
  playbackClock.play();
}
startMatchButton?.addEventListener("click", () => {
  if (state.mode !== "freeplay" || !currentModeIsReady()) {
    if (matchStatus) matchStatus.textContent = "Apply a match setup with both teams before starting.";
    return;
  }
  if (!["home", "away"].every((team) => state.roster.some((entry) => entry.team === team && entry.role === "keeper"))) {
    if (matchStatus) matchStatus.textContent = "Both teams need a goalkeeper for a full match.";
    return;
  }
  stopMatchSession();
  stopPlayback();
  unlockAndPreload();
  matchScore = { home: 0, away: 0 };
  matchTelemetry = createMatchTelemetry(state.roster);
  for (const entry of state.roster) {
    const stats = matchTelemetry.players[String(entry.id)];
    if (stats) stats.name = playerName(entry.player);
  }
  populateStatsScope();
  if (elements.liveCommentary) elements.liveCommentary.textContent = "The teams are ready. Play begins.";
  renderMatchTelemetry(true);
  matchAutoPlay = true;
  startMatchButton.disabled = true;
  if (stopMatchButton) stopMatchButton.disabled = false;
  matchSession = createMatchSession({
    simulate: createMatchChunkSimulator(state.seed),
    onReady: () => { refreshHighlights(); playNextMatchChunk(); },
    onStatus: ({ error }) => {
      if (error) { if (matchStatus) matchStatus.textContent = `Match stopped: ${error.message}`; stopMatchSession(); }
    },
  });
  matchSession.start();
});
stopMatchButton?.addEventListener("click", () => { stopMatchSession(); stopPlayback(); });

function installPlaybackPlan(runOutput, preparedPlan = null) {
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
  const nextPlan = preparedPlan ?? buildPlaybackPlan(runOutput);
  playbackClock?.destroy();
  state.lastPlan = nextPlan;
  refreshHighlights();
  rendererGapMonitor.reset();
  renderFluidityDiagnostics();
  state.playbackTimeMs = 0;
  lastRenderedCueTime = -1;
  lastRenderedTraceIndex = 0;
  playbackClock = createMatchLabPlaybackClock(state.lastPlan, {
    advanceTime: (time, elapsed, rate) => advanceHighlightTime(time, elapsed, state.lastPlan.durationMs, highlightWindows, rate, Number(betweenSpeedControl?.value) || 20),
    onFrame: renderPlaybackFrame,
    onStateChange: ({ playing, timeMs }) => {
      updatePlayPauseButton();
      if (!playing && timeMs >= state.lastPlan.durationMs - 0.001 && matchAutoPlay) setTimeout(playNextMatchChunk, 0);
    },
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
  if (matchSession) { matchAutoPlay = true; if (playbackClock?.getState().timeMs >= (state.lastPlan?.durationMs ?? Infinity)) { playNextMatchChunk(); return; } }
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
    teamPhase: runOutput.teamPhase ?? null,
    phaseTransitions: runOutput.phaseTransitions ?? [],
    shapeSnapshots: runOutput.shapeSnapshots ?? [],
    coordinationSnapshots: runOutput.coordinationSnapshots ?? [],
    coordinationHistory: runOutput.coordinationHistory ?? [],
    shapeMetrics: runOutput.shapeMetrics ?? null,
    trace: runOutput.trace,
    // The possession's own simulated positions at rest (Pass 1) -- the
    // authored setup above never changes; this is where each player and
    // the ball actually ended up once resolution finished.
    finalPositions: runOutput.finalPositions ?? null,
    // Saved Scenario Replay Harness -- a self-contained, JSON-serializable
    // snapshot of exactly what THIS run started from (full embedded player
    // attribute objects, database, attacking directions, tactical
    // settings, and the seed), captured here (not from live state.roster
    // at Save time) so a later drag/reroll can never retroactively change
    // what a saved scenario says it started from. See
    // src/lib/replayHarness.js's own header for why the seed plus this
    // authored setup alone reproduces the whole possession byte-for-byte,
    // and tools/test-replay-harness.mjs for how to replay it in Node.
    scenario: captureScenario({
      state, seed,
      // Provenance only -- what the setup panel authored, when it was used.
      // A restart is recorded for the record, NOT as replayable input; see
      // captureScenario()'s own note on why a dead ball cannot be a
      // scenario at this schema version.
      matchSetup: state.matchSetupDraft
        ? {
            format: state.matchSetupDraft.format,
            home: {
              squadKey: state.matchSetupDraft.home.squadKey,
              formation: state.matchSetupDraft.home.formation,
              style: state.matchSetupDraft.home.style,
            },
            away: {
              squadKey: state.matchSetupDraft.away.squadKey,
              formation: state.matchSetupDraft.away.formation,
              style: state.matchSetupDraft.away.style,
            },
          }
        : null,
      // Schema 2 -- genuine replay input for a dead-ball scenario: which
      // restart, who takes it, where the ball is, and the concrete
      // restart-role assignment every participant was given.
      restart: state.restartSetupDraft
        ? {
            ...state.restartSetupDraft,
            takerId: state.pendingRestart?.takerId ?? state.ball.ownerId ?? null,
            roleAssignments: state.roster
              .filter((entry) => entry.restartRole)
              .map((entry) => ({ id: entry.id, restartRole: entry.restartRole })),
          }
        : null,
    }),
  };
}

/** Serializes state.lastRun's own captured scenario to a downloadable JSON
 * file -- the browser-side half of the Saved Scenario Replay Harness (see
 * src/lib/replayHarness.js). Manual (a "Save Scenario" button) rather than
 * automatic on every run: Free Play is used for many ordinary, unremarkable
 * possessions between reported failures, and downloading a file on every
 * single one of them would be noise, not a feature. */
function downloadCurrentScenario(reason) {
  if (!state.lastRun?.scenario) return;
  // capturedAt is stamped HERE, at the actual moment of saving to disk --
  // not inside captureScenario()/buildLastRun(), which stay pure functions
  // of state/seed (see captureScenario()'s own comment on why: match-lab.js's
  // buildLastRun() must keep producing byte-identical records for a
  // byte-identical run, which a baked-in wall-clock default would break).
  const capturedAt = new Date().toISOString();
  const scenario = {
    ...state.lastRun.scenario,
    capturedAt,
    ...(reason !== undefined ? { reason } : {}),
  };
  const blob = new Blob([JSON.stringify(scenario, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `match-lab-scenario-${scenario.seed}-${capturedAt.replace(/[:.]/g, "-")}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
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
  stopMatchSession();
  // A dead ball can run only when its nominated taker and required action
  // are intact. runConstructedPossession() dispatches that action before
  // the ordinary candidate loop.
  if (state.pendingRestart && !state.ball.ownerId) {
    showPlaybackError(new Error(
      `This ${state.pendingRestart.type} has no nominated taker, so there is nobody `
      + "to put the ball back into play. Re-apply the setup, or choose a taker.",
    ));
    return;
  }
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
  stopMatchSession();
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

// Step Back v1 (2026-08-31) -- a real, explicit request: rewinding to
// re-watch an incident required hitting Replay and sitting through the
// whole trace again. Mirrors the Step button above exactly, just walking
// backward to the PREVIOUS semantic boundary (previousSemanticBoundary(),
// matchLabPlayback.js) instead of the next one -- renderPlaybackFrame()'s
// own existing "timeMs moved backward" detection (its own comment, just
// above) already resets the touch trail/cue timing/trace panel correctly
// for any backward seek, so no special-cased reset is needed here the
// way the forward button's own "wrap past the end" branch needs one.
elements.stepBackButton.addEventListener("click", () => {
  if (!state.lastTrace) return;
  stopPlayback();
  if (!playbackClock) return;
  playbackClock.stepBack();
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
  const draft = setupDraft();
  draft.home.attackingDirection = home;
  draft.away.attackingDirection = home === "up" ? "down" : "up";
  markPausedTacticsDirty();
  reassignSetupTeam("home");
  reassignSetupTeam("away");
  renderMatchSetupPanel();
});

// Marking setup (2026-08-24) -- each team's own scheme select plus a
// five-bar strictness control read straight out of/write straight into
// state.marking[team]; markingSettingsFor() (read by both
// planDefensiveRepositioning() call sites) is the only consumer, so
// nothing else needs to know this UI exists.
function updateMarkingStrictnessDisplay(team) {
  const level = setupDraft()[team].marking.strictness;
  elements.markingBars
    .filter((bar) => bar.dataset.team === team)
    .forEach((bar) => {
      bar.classList.toggle("is-filled", Number(bar.dataset.level) <= level);
    });
  const valueLabel = elements.markingValues.find((el) => el.dataset.team === team);
  if (valueLabel) valueLabel.textContent = String(level);
  const group = elements.markingStrictnessGroups.find((el) => el.dataset.team === team);
  if (group) group.setAttribute("aria-valuenow", String(level));
}
function setMarkingStrictness(team, level) {
  setupDraft()[team].marking.strictness = clamp(1, 5, Math.round(level));
  markPausedTacticsDirty();
  updateMarkingStrictnessDisplay(team);
}
elements.markingSchemeSelects.forEach((select) => {
  const team = select.dataset.team;
  select.value = state.marking[team].scheme;
  select.addEventListener("change", () => {
    setupDraft()[team].marking.scheme = select.value === "zonal" ? "zonal" : "man";
    markPausedTacticsDirty();
  });
});
elements.markingBars.forEach((bar) => {
  bar.addEventListener("click", () => {
    setMarkingStrictness(bar.dataset.team, Number(bar.dataset.level));
  });
});
elements.markingStrictnessGroups.forEach((group) => {
  const team = group.dataset.team;
  group.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      setMarkingStrictness(team, setupDraft()[team].marking.strictness + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      setMarkingStrictness(team, setupDraft()[team].marking.strictness - 1);
    }
  });
});

// Attacking setup (2026-08-25) -- each team's own style select plus a
// five-bar directness control, cloned straight off the Marking wiring
// above, read straight out of/write straight into state.attacking[team];
// attackingSettingsFor() (read by both generateFreePlayCandidates() call
// sites) is the only consumer, so nothing else needs to know this UI
// exists.
function updateAttackingDirectnessDisplay(team) {
  const level = setupDraft()[team].attacking.directness;
  elements.attackingBars
    .filter((bar) => bar.dataset.team === team)
    .forEach((bar) => {
      bar.classList.toggle("is-filled", Number(bar.dataset.level) <= level);
    });
  const valueLabel = elements.attackingValues.find((el) => el.dataset.team === team);
  if (valueLabel) valueLabel.textContent = String(level);
  const group = elements.attackingStrictnessGroups.find((el) => el.dataset.team === team);
  if (group) group.setAttribute("aria-valuenow", String(level));
}
function setAttackingDirectness(team, level) {
  setupDraft()[team].attacking.directness = clamp(1, 5, Math.round(level));
  markPausedTacticsDirty();
  updateAttackingDirectnessDisplay(team);
}
const ATTACKING_STYLES = new Set(["possession", "direct", "long-ball", "wing"]);
elements.attackingStyleSelects.forEach((select) => {
  const team = select.dataset.team;
  select.value = state.attacking[team].style;
  select.addEventListener("change", () => {
    setupDraft()[team].attacking.style = ATTACKING_STYLES.has(select.value) ? select.value : "possession";
    markPausedTacticsDirty();
  });
});
elements.attackingBars.forEach((bar) => {
  bar.addEventListener("click", () => {
    setAttackingDirectness(bar.dataset.team, Number(bar.dataset.level));
  });
});
elements.attackingStrictnessGroups.forEach((group) => {
  const team = group.dataset.team;
  group.addEventListener("keydown", (event) => {
    if (event.key === "ArrowRight" || event.key === "ArrowUp") {
      event.preventDefault();
      setAttackingDirectness(team, setupDraft()[team].attacking.directness + 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
      event.preventDefault();
      setAttackingDirectness(team, setupDraft()[team].attacking.directness - 1);
    }
  });
});
elements.teamShootingSelects.forEach((select) => {
  const team = select.dataset.team;
  select.value = state.attacking[team].shooting;
  select.addEventListener("change", () => {
    setupDraft()[team].attacking.shooting = ["discourage", "balanced", "encourage"].includes(select.value)
      ? select.value : "balanced";
    markPausedTacticsDirty();
    renderSlotEditor();
  });
});
elements.teamTempoSelects.forEach((select) => {
  const team = select.dataset.team;
  select.value = state.attacking[team].tempo;
  select.addEventListener("change", () => {
    setupDraft()[team].attacking.tempo = ["slow", "balanced", "quick"].includes(select.value)
      ? select.value : "balanced";
    markPausedTacticsDirty();
    renderSlotEditor();
  });
});

function setTeamInstruction(team, section, field, value) {
  if (!setupDraft()[team]?.[section] || !field) return false;
  setupDraft()[team][section][field] = value;
  if (section === "attacking") {
    setupDraft()[team].attacking = normalizeTeamAttacking(setupDraft()[team].attacking);
  } else if (section === "transition") {
    setupDraft()[team].transition = normalizeTeamTransition(setupDraft()[team].transition);
  } else if (section === "marking") {
    setupDraft()[team].marking = normalizeTeamDefending(setupDraft()[team].marking);
  }
  markPausedTacticsDirty();
  return true;
}

elements.teamInstructionControls.forEach((control) => {
  control.addEventListener("change", () => {
    const { team, section, field } = control.dataset;
    setTeamInstruction(
      team,
      section,
      field,
      control.type === "checkbox" ? control.checked : control.value,
    );
    renderTacticsBoard();
  });
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
  stopMatchSession();
  elements.pitch.style.visibility = "visible";
  stopPlayback();
  renderPitch();
  clearStepEffects();
  resetTouchTrail();
  renderRoster();
  renderRoleRequirements();
  renderActionTable();
  clearResults();
});

// Saved Scenario Replay Harness -- downloads the LAST run's own captured
// scenario (state.lastRun.scenario, built by buildLastRun() at the moment
// that run happened -- never re-captured from whatever the live roster is
// doing now) as a JSON file. See src/lib/replayHarness.js's own header and
// tools/test-replay-harness.mjs for how to replay it in Node.
elements.saveScenarioButton?.addEventListener("click", () => {
  downloadCurrentScenario();
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
  elements.stepBackButton.hidden = true;
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

// ---------------------------------------------------------------------------
// Match Setup Integration v1 (2026-09-04)
// ---------------------------------------------------------------------------
//
// The Match and Tactics workspaces author one DRAFT: squads, format, shape, per-slot
// instructions and the start of play. Nothing here writes to state.roster,
// state.ball or the pitch -- only applySetup() does, and only once every
// part of the draft has resolved and validated. A failure leaves the
// current pitch untouched, which is the whole reason the draft exists.
//
// Everything below consumes the pure setup modules. No squad declaration,
// no formation template and no restart geometry is re-implemented here.

// The neutral default shape. Deliberately NOT presented as historically
// authentic: the squad catalogue carries no per-squad tactical metadata
// yet, so claiming a 2004/05 side "really played" a given formation would
// be an invention. The user picks whatever they want on top of this.
const DEFAULT_SETUP_FORMATION = "4-4-2";
const DEFAULT_SETUP_STYLE = "Balanced";
const DEFAULT_SETUP_FORMAT = "11v11";

function setupDraft() {
  if (!state.matchSetupDraft) {
    state.matchSetupDraft = createMatchSetup({
      format: DEFAULT_SETUP_FORMAT,
      home: { formation: DEFAULT_SETUP_FORMATION, style: DEFAULT_SETUP_STYLE, attackingDirection: state.attackingDirection.home },
      away: { formation: DEFAULT_SETUP_FORMATION, style: DEFAULT_SETUP_STYLE },
    });
    state.matchSetupDraft.home.squadKey = null;
    state.matchSetupDraft.away.squadKey = null;
  }
  return state.matchSetupDraft;
}

function activeSetupTeam() {
  return setupDraft()[state.setupTeamTab];
}

function setupPlayerFor(teamSetup, slot) {
  if (!slot?.playerId) return null;
  const resolved = state.resolvedSquads.get(teamSetup.squadKey);
  return resolved?.players.find((player) => candidateKey(player) === slot.playerId) ?? null;
}

/** Marker name: surname where there is one, else the whole name. */
function setupMarkerLabel(player) {
  if (!player) return "—";
  const name = playerName(player).trim();
  const parts = name.split(/\s+/).filter(Boolean);
  return parts.length > 1 ? parts.at(-1) : name;
}

/** Prefer the database shirt number; keep a stable XI-order fallback. */
function setupShirtNumber(player, slotIndex) {
  if (!player) return "—";
  const listRating = Array.isArray(player.ratings)
    ? player.ratings.find((item) => /squad[ _-]?number|shirt[ _-]?number/i.test(String(item?.label ?? "")))?.value
    : null;
  const candidates = [
    player.squad_number,
    player.squadNumber,
    player.profile?.squad_number,
    player.profile?.squadNumber,
    !Array.isArray(player.ratings) ? player.ratings?.squad_number : null,
    listRating,
  ];
  const stored = candidates.map(Number).find((value) => Number.isInteger(value) && value >= 1 && value <= 99);
  return String(stored ?? slotIndex + 1);
}

// ---------------------------------------------------------------------------
// Squad resolution -- strict, cached, atomic
// ---------------------------------------------------------------------------

/**
 * Resolves one catalogue squad for Match Lab.
 *
 * STRICT on purpose. The catalogue marks these squads verified, but that
 * flag records a past verification run, not a guarantee about this
 * database right now -- and the legacy fallback exists for Titan Fight's
 * own historical behaviour, not for a setup screen. A squad that cannot be
 * sourced wholly from its own declared database and club is shown as
 * unavailable WITH THE REASON, never quietly filled with a lookalike from
 * a neighbouring edition.
 */
async function resolveSetupSquad(squadKey) {
  if (!squadKey) return { ok: false, reason: "no squad selected" };
  if (state.resolvedSquads.has(squadKey)) {
    return { ok: true, ...state.resolvedSquads.get(squadKey) };
  }
  if (state.squadFailures.has(squadKey)) {
    return { ok: false, reason: state.squadFailures.get(squadKey) };
  }
  const squad = findHistoricalSquad(squadKey);
  if (!squad) return { ok: false, reason: `unknown squad "${squadKey}"` };
  let resolution;
  try {
    resolution = await resolveHistoricalSquad(squad, { searchPlayers, strict: true });
  } catch (error) {
    // Not cached as a failure: a network problem is not a bad declaration,
    // and the next press should try again.
    return { ok: false, reason: `could not reach the player database (${error.message})`, transient: true };
  }
  if (!resolution.valid) {
    const reason = resolution.errors[0] ?? "strict resolution failed";
    state.squadFailures.set(squadKey, reason);
    return { ok: false, reason };
  }
  // Enrich with the same metrics the manual search path uses, so a preset
  // player and a hand-placed one carry identical attribute data.
  let players = resolution.players;
  try {
    const metrics = await getPlayerMetrics(players);
    const byIdentity = new Map((metrics.items ?? []).map((item) => [
      `${item.database_slug}:${item.source_person_id}`, item,
    ]));
    players = players.map((player) => {
      const metric = byIdentity.get(candidateKey(player));
      return metric ? { ...player, ...metric } : player;
    });
  } catch {
    // Falls back to CA-baseline attribute resolution, exactly as addPlayer() does.
  }
  const entry = { players, squad };
  state.resolvedSquads.set(squadKey, entry);
  return { ok: true, ...entry };
}

// ---------------------------------------------------------------------------
// Draft edits
// ---------------------------------------------------------------------------

/**
 * Re-runs deterministic lineup assignment for one team, retaining whatever
 * role/duty/shooting instructions still apply to the slot that keeps the same
 * positional slot. Changing formation rearranges players; it does not
 * silently discard instructions the new shape can still honour.
 */
function reassignSetupTeam(team) {
  const draft = setupDraft();
  const teamSetup = draft[team];
  // Keyed by positional slot AND its occurrence, so a shape with two DCs
  // carries the first DC's instructions to the first DC and the second's to
  // the second -- a plain positionalSlot map silently kept only the last one.
  const seenSlot = new Map();
  const previousBySlot = new Map(teamSetup.slots.map((slot) => {
    const occurrence = seenSlot.get(slot.positionalSlot) ?? 0;
    seenSlot.set(slot.positionalSlot, occurrence + 1);
    return [`${slot.positionalSlot}#${occurrence}`, slot];
  }));
  const rebuilt = createTeamSetup({
    team,
    squadKey: teamSetup.squadKey,
    formation: teamSetup.formation,
    style: teamSetup.style,
    format: draft.format,
    attackingDirection: teamSetup.attackingDirection,
    attacking: teamSetup.attacking,
    transition: teamSetup.transition,
    marking: teamSetup.marking,
    cornerPlan: teamSetup.cornerPlan,
  });
  rebuilt.squadKey = teamSetup.squadKey;
  const seenRebuilt = new Map();
  for (const slot of rebuilt.slots) {
    const occurrence = seenRebuilt.get(slot.positionalSlot) ?? 0;
    seenRebuilt.set(slot.positionalSlot, occurrence + 1);
    const carried = previousBySlot.get(`${slot.positionalSlot}#${occurrence}`);
    if (!carried) continue;
    if (tacticalRolesForPosition(slot.positionalSlot).includes(carried.tacticalRole)) {
      slot.tacticalRole = carried.tacticalRole;
    }
    slot.duty = carried.duty;
    slot.shootingInstruction = carried.shootingInstruction ?? "inherit";
    slot.tempoInstruction = carried.tempoInstruction ?? "inherit";
    slot.goalkeeperDistribution = carried.goalkeeperDistribution ?? "mixed";
    slot.goalkeeperSweeping = carried.goalkeeperSweeping ?? "balanced";
    slot.withBallPosition = carried.withBallPosition ? { ...carried.withBallPosition } : null;
    slot.withoutBallPosition = carried.withoutBallPosition ? { ...carried.withoutBallPosition } : null;
    slot.withBallPositions = Object.fromEntries(Object.entries(carried.withBallPositions ?? {})
      .map(([zone, point]) => [zone, { ...point }]));
    slot.withoutBallPositions = Object.fromEntries(Object.entries(carried.withoutBallPositions ?? {})
      .map(([zone, point]) => [zone, { ...point }]));
    slot.included = carried.included;
  }
  const resolved = state.resolvedSquads.get(teamSetup.squadKey);
  if (resolved) {
    const preferredSlotByPlayer = new Map((resolved.players ?? []).flatMap((player, index) => {
      const slotKey = resolved.squad?.lineupSlots?.[index];
      return slotKey ? [[candidateKey(player), slotKey]] : [];
    }));
    const result = assignLineup(resolved.players, rebuilt.slots.map((slot) => ({
      ...slot, effectiveRole: slot.positionalSlot, id: slot.slotId,
    })), { preferredSlotByPlayer });
    result.assignments.forEach((assignment, index) => {
      rebuilt.slots[index].playerId = assignment.player ? candidateKey(assignment.player) : null;
    });
    rebuilt.lineupWarnings = result.unplaced.map((entry) =>
      `${playerName(entry.player)}: ${entry.reason}`);
  } else {
    rebuilt.lineupWarnings = [];
  }
  draft[team] = rebuilt;
  return rebuilt;
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function renderSquadSelectors() {
  const squads = listHistoricalSquads();
  for (const [team, select, status] of [
    ["home", elements.homeSquadSelect, elements.homeSquadStatus],
    ["away", elements.awaySquadSelect, elements.awaySquadStatus],
  ]) {
    if (!select) continue;
    const current = setupDraft()[team].squadKey ?? "";
    select.replaceChildren();
    const none = document.createElement("option");
    none.value = "";
    none.textContent = "— none —";
    select.appendChild(none);
    for (const squad of squads) {
      const option = document.createElement("option");
      option.value = squad.key;
      const failure = state.squadFailures.get(squad.key);
      option.textContent = failure ? `${squad.name} (unavailable)` : squad.name;
      option.disabled = Boolean(failure);
      select.appendChild(option);
    }
    select.value = current;
    if (status) {
      const failure = current ? state.squadFailures.get(current) : null;
      const resolved = current ? state.resolvedSquads.get(current) : null;
      status.textContent = failure
        ? `Unavailable: ${failure}`
        : resolved
          ? `${resolved.players.length} players resolved from ${resolved.squad.database}`
          : "";
      status.dataset.state = failure ? "error" : resolved ? "ok" : "";
    }
  }
}

function renderFormatChoices() {
  if (!elements.formatChoices) return;
  elements.formatChoices.replaceChildren();
  for (const format of MATCH_FORMAT_NAMES) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.format = format;
    button.textContent = format;
    button.classList.toggle("is-selected", format === setupDraft().format);
    elements.formatChoices.appendChild(button);
  }
}

function renderFormationControls() {
  const teamSetup = activeSetupTeam();
  if (elements.attackingDirectionSelect) {
    elements.attackingDirectionSelect.value = setupDraft().home.attackingDirection;
  }
  if (elements.formationSelect) {
    if (!(elements.formationSelect.options?.length)) {
      for (const name of FORMATION_NAMES) {
        const option = document.createElement("option");
        option.value = name;
        option.textContent = name;
        elements.formationSelect.appendChild(option);
      }
    }
    elements.formationSelect.value = teamSetup.formation;
  }
  if (elements.formationStyleSelect) elements.formationStyleSelect.value = teamSetup.style;
  for (const [tab, team] of [[elements.setupHomeTab, "home"], [elements.setupAwayTab, "away"]]) {
    if (!tab) continue;
    const active = state.setupTeamTab === team;
    tab.setAttribute("aria-selected", String(active));
    tab.classList.toggle("is-selected", active);
  }
}

/**
 * The restart positions the board should draw, materialised through the
 * EXACT same path Apply Setup uses (buildRestartDraft ->
 * placeRestartParticipants). There is deliberately no second, UI-only
 * layout implementation: a preview that disagreed with what Apply Setup
 * produced would be worse than no preview.
 */
function restartPreviewPositions() {
  const draft = setupDraft();
  if (!draft.home.squadKey || !draft.away.squadKey) return null;
  const prepared = {};
  for (const team of ["home", "away"]) {
    prepared[team] = {
      entries: draft[team].slots.filter((slot) => slot.included).map((slot) => ({
        id: `${team}-${slot.slotId}`,
        slotId: slot.slotId,
        role: roleBand(slot.positionalSlot) === "GK" ? "keeper" : "player",
        team,
        player: setupPlayerFor(draft[team], slot),
        positionalSlot: slot.positionalSlot,
        x: slot.x,
        y: slot.y,
      })).filter((entry) => entry.player),
    };
  }
  if (!prepared.home.entries.length || !prepared.away.entries.length) return null;
  const restart = buildRestartDraft();
  const takerOverrides = {};
  const chosen = elements.restartTakerSelect?.value;
  if (chosen) takerOverrides[restart.takingTeam] = chosen;
  const { placements, roles, takerId } = placeRestartParticipants(restart, prepared, { takerOverrides });
  return { restart, placements, roles, takerId, prepared };
}

/**
 * Formation editors use the manager's conventional viewpoint: their own
 * goal is at the bottom and their team attacks toward the top. Runtime
 * coordinates remain in the shared match frame. A team attacking down in
 * that frame is therefore rotated 180 degrees for display. The transform is
 * its own inverse, so it also converts a dragged board point back into the
 * authoritative match frame.
 */
export function tacticsBoardPoint(point, attackingDirection = "up") {
  const source = {
    x: clamp(0, 100, Number(point?.x) || 0),
    y: clamp(0, 100, Number(point?.y) || 0),
    ...(point?.zone == null ? {} : { zone: point.zone }),
  };
  return attackingDirection === "down"
    ? { ...source, x: 100 - source.x, y: 100 - source.y }
    : source;
}

export function tacticsBoardZone(zone, attackingDirection = "up") {
  const normalized = clamp(0, 11, Math.round(Number(zone) || 0));
  return attackingDirection === "down" ? 11 - normalized : normalized;
}

/**
 * Applies one base-formation drag without touching the live match. Dropping
 * on another shirt exchanges the two selected players; dropping on grass
 * moves this slot's formation anchor. Roles and duties stay with their
 * tactical positions, exactly as they do when players are changed in a XI.
 */
export function applyTacticsFormationDrop(teamSetup, draggedSlotId, worldPoint, swapSlotId = null) {
  const dragged = teamSetup?.slots?.find((slot) => slot.slotId === draggedSlotId) ?? null;
  if (!dragged) return { changed: false, kind: "missing" };
  const swap = swapSlotId
    ? teamSetup.slots.find((slot) => slot.slotId === swapSlotId && slot !== dragged) ?? null
    : null;
  if (swap) {
    [dragged.playerId, swap.playerId] = [swap.playerId, dragged.playerId];
    return { changed: true, kind: "swap", draggedSlotId, swapSlotId };
  }
  if (!worldPoint || !Number.isFinite(worldPoint.x) || !Number.isFinite(worldPoint.y)) {
    return { changed: false, kind: "invalid" };
  }
  dragged.x = clamp(2, 98, worldPoint.x);
  dragged.y = clamp(2, 98, worldPoint.y);
  return { changed: true, kind: "move", draggedSlotId, point: { x: dragged.x, y: dragged.y } };
}

function currentSetupPhaseSelection(slot) {
  const inPossession = state.setupBoardView === "with-ball";
  if (!inPossession && state.setupBoardView !== "without-ball") {
    return {
      point: { x: slot?.x ?? 50, y: slot?.y ?? 50 },
      manual: false,
      source: "formation",
    };
  }
  const [x, y] = ZONE_CENTERS[state.setupPhaseZone] ?? ZONE_CENTERS[4];
  return phaseAnchorSelectionFor(slot, {
    inPossession,
    phase: inPossession ? "progression" : "defensive-block",
    ballPoint: { x, y },
  });
}

function renderRoleOccupancyLayer(teamSetup) {
  if (elements.showRoleMapCheckbox) elements.showRoleMapCheckbox.checked = state.showRoleMap;
  if (!state.showRoleMap) {
    if (elements.roleMapNote) elements.roleMapNote.textContent = "Role map hidden.";
    return;
  }
  const slot = teamSetup.slots.find((item) => item.slotId === state.selectedSetupSlotId) ?? null;
  if (!slot) {
    if (elements.roleMapNote) {
      elements.roleMapNote.textContent = "Select a player to display the role's likely operating area.";
    }
    return;
  }
  if (state.setupBoardView === "restart") {
    if (elements.roleMapNote) {
      elements.roleMapNote.textContent = "Role maps describe open play and are hidden in the restart view.";
    }
    return;
  }
  const map = buildRoleOccupancyMap({
    slot,
    attackingDirection: teamSetup.attackingDirection,
    view: state.setupBoardView,
    focusZone: state.setupBoardView === "with-ball" || state.setupBoardView === "without-ball"
      ? state.setupPhaseZone : null,
  });
  const layer = document.createElement("div");
  layer.className = "match-lab-role-map-grid";
  layer.dataset.position = slot.positionalSlot;
  layer.dataset.role = slot.tacticalRole;
  layer.setAttribute("aria-hidden", "true");
  layer.style.setProperty("--role-map-columns", String(map.columns));
  layer.style.setProperty("--role-map-rows", String(map.rows));
  for (const cell of map.cells) {
    if (!cell.level) continue;
    const displayPoint = tacticsBoardPoint(cell, teamSetup.attackingDirection);
    const displayColumn = clamp(0, map.columns - 1, Math.floor(displayPoint.x / 100 * map.columns));
    const displayRow = clamp(0, map.rows - 1, Math.floor(displayPoint.y / 100 * map.rows));
    const pixel = document.createElement("span");
    pixel.className = "match-lab-role-map-cell";
    pixel.dataset.level = String(cell.level);
    pixel.style.gridColumn = String(displayColumn + 1);
    pixel.style.gridRow = String(displayRow + 1);
    layer.appendChild(pixel);
  }
  elements.tacticsBoard.appendChild(layer);
  if (elements.roleMapNote) {
    const viewLabel = state.setupBoardView === "with-ball" ? "with ball"
      : state.setupBoardView === "without-ball" ? "without ball" : "across open play";
    const positionLabel = map.manual
      ? `${slot.positionalSlot} · Manual for ball area ${tacticsBoardZone(state.setupPhaseZone, teamSetup.attackingDirection) + 1}. `
      : `${slot.positionalSlot} · ${tacticalRoleLabel(slot.tacticalRole)} · ${slot.duty}. `;
    elements.roleMapNote.textContent = positionLabel
      + `Likely allocation ${viewLabel}; brighter pixels are more likely. The ${map.columns} × ${map.rows} grid uses `
      + `${map.cellWidthYards.toFixed(0)} × ${map.cellLengthYards.toFixed(0)} yd pixels `
      + `(${(map.cellWidthYards * 0.9144).toFixed(1)} × ${(map.cellLengthYards * 0.9144).toFixed(1)} m).`;
  }
}

function renderTacticsBoard() {
  if (!elements.tacticsBoard) return;
  const teamSetup = activeSetupTeam();
  elements.tacticsBoard.replaceChildren();
  elements.tacticsBoard.dataset.team = teamSetup.team;
  elements.tacticsBoard.dataset.view = state.setupBoardView;
  renderRoleOccupancyLayer(teamSetup);
  const markings = document.createElement("div");
  markings.className = "match-lab-tactics-markings";
  markings.innerHTML = `
    <span class="match-lab-tactics-halfway"></span>
    <span class="match-lab-tactics-centre-circle"></span>
    <span class="match-lab-tactics-spot match-lab-tactics-centre-spot"></span>
    <span class="match-lab-tactics-box match-lab-tactics-box-top"></span>
    <span class="match-lab-tactics-box match-lab-tactics-box-bottom"></span>
    <span class="match-lab-tactics-six-yard match-lab-tactics-six-yard-top"></span>
    <span class="match-lab-tactics-six-yard match-lab-tactics-six-yard-bottom"></span>
    <span class="match-lab-tactics-spot match-lab-tactics-penalty-spot-top"></span>
    <span class="match-lab-tactics-spot match-lab-tactics-penalty-spot-bottom"></span>
    <span class="match-lab-tactics-penalty-arc match-lab-tactics-penalty-arc-top"></span>
    <span class="match-lab-tactics-penalty-arc match-lab-tactics-penalty-arc-bottom"></span>
    <span class="match-lab-tactics-goal match-lab-tactics-goal-top"></span>
    <span class="match-lab-tactics-goal match-lab-tactics-goal-bottom"></span>
    <span class="match-lab-tactics-corner-arc match-lab-tactics-corner-top-left"></span>
    <span class="match-lab-tactics-corner-arc match-lab-tactics-corner-top-right"></span>
    <span class="match-lab-tactics-corner-arc match-lab-tactics-corner-bottom-left"></span>
    <span class="match-lab-tactics-corner-arc match-lab-tactics-corner-bottom-right"></span>`;
  elements.tacticsBoard.appendChild(markings);
  const preview = state.setupBoardView === "restart" ? restartPreviewPositions() : null;
  const phaseKey = state.setupBoardView === "with-ball" ? "withBallPosition"
    : state.setupBoardView === "without-ball" ? "withoutBallPosition" : null;
  const phaseMapKey = state.setupBoardView === "with-ball" ? "withBallPositions"
    : state.setupBoardView === "without-ball" ? "withoutBallPositions" : null;
  for (const option of elements.boardViewChoices?.children ?? []) {
    option.classList?.toggle("is-selected", option.dataset.boardView === state.setupBoardView);
  }
  if (elements.boardViewNote) {
    const displayedZone = tacticsBoardZone(state.setupPhaseZone, teamSetup.attackingDirection);
    elements.boardViewNote.textContent = state.setupBoardView === "restart"
      ? (preview
        ? "Shown with this team attacking upward. Solid markers are the restart positions Apply Setup will use; faint markers are the open-play anchors players release toward once the ball is live."
        : "Choose both squads to preview the restart shape.")
      : phaseMapKey
        ? `Ball area ${displayedZone + 1} of 12, with this team attacking upward. Select another area, then drag players to author the ${state.setupBoardView === "with-ball" ? "with-ball" : "without-ball"} shape. Untouched players inherit the formation.`
        : "The base formation, shown with this team attacking upward. Drag a player onto open grass to reposition them, or onto another shirt to swap the two players.";
  }
  // Ghost markers show the reference formation beneath a restart or an
  // optional phase override.
  if (preview || phaseKey) {
    for (const slot of teamSetup.slots) {
      const ghost = document.createElement("span");
      ghost.className = "match-lab-tactics-ghost";
      const ghostPoint = tacticsBoardPoint(slot, teamSetup.attackingDirection);
      ghost.style.left = `${ghostPoint.x}%`;
      ghost.style.top = `${ghostPoint.y}%`;
      ghost.textContent = slot.positionalSlot;
      elements.tacticsBoard.appendChild(ghost);
    }
  }
  if (phaseMapKey) {
    const zoneGrid = document.createElement("div");
    zoneGrid.className = "match-lab-phase-zone-grid";
    for (let displayZone = 0; displayZone < 12; displayZone += 1) {
      const worldZone = tacticsBoardZone(displayZone, teamSetup.attackingDirection);
      const zoneButton = document.createElement("button");
      zoneButton.type = "button";
      zoneButton.dataset.phaseZone = String(worldZone);
      zoneButton.dataset.selected = String(worldZone === state.setupPhaseZone);
      zoneButton.setAttribute("aria-label", `Edit ball area ${displayZone + 1}`);
      zoneButton.title = `Ball area ${displayZone + 1}`;
      zoneGrid.appendChild(zoneButton);
    }
    elements.tacticsBoard.appendChild(zoneGrid);
  }
  for (const [slotIndex, slot] of teamSetup.slots.entries()) {
    const marker = document.createElement("button");
    marker.type = "button";
    marker.className = "match-lab-tactics-marker";
    marker.dataset.slotId = slot.slotId;
    marker.dataset.team = teamSetup.team;
    marker.dataset.position = slot.positionalSlot;
    marker.dataset.included = String(slot.included);
    marker.dataset.selected = String(slot.slotId === state.selectedSetupSlotId);
    // The setup model owns match-frame coordinates. The tactics board uses
    // the selected team's consistent attacking-up manager view.
    const entryId = `${teamSetup.team}-${slot.slotId}`;
    const previewSpot = preview?.placements.get(entryId);
    const phaseSpot = phaseMapKey
      ? slot[phaseMapKey]?.[String(state.setupPhaseZone)] ?? slot[phaseKey]
      : null;
    const point = tacticsBoardPoint(
      previewSpot ?? phaseSpot ?? { x: slot.x, y: slot.y },
      teamSetup.attackingDirection,
    );
    if (phaseKey) marker.dataset.phaseOverride = String(Boolean(phaseSpot));
    marker.style.left = `${point.x}%`;
    marker.style.top = `${point.y}%`;
    const restartRole = preview?.roles.get(entryId) ?? null;
    if (restartRole) marker.dataset.restartRole = restartRole;
    if (preview && entryId === preview.takerId) marker.dataset.taker = "true";
    const player = setupPlayerFor(teamSetup, slot);
    const phaseSelection = currentSetupPhaseSelection(slot);
    const displayedDuty = phaseSelection.manual ? "manual" : slot.duty;
    marker.dataset.duty = displayedDuty;

    const shirt = document.createElement("span");
    shirt.className = "match-lab-tactics-shirt";
    const numberLabel = document.createElement("span");
    numberLabel.className = "match-lab-tactics-number";
    numberLabel.textContent = setupShirtNumber(player, slotIndex);
    const details = document.createElement("span");
    details.className = "match-lab-tactics-details";
    const slotLabel = document.createElement("span");
    slotLabel.className = "match-lab-tactics-slot";
    slotLabel.textContent = slot.positionalSlot;
    const tacticalRole = document.createElement("span");
    tacticalRole.className = "match-lab-tactics-role-name";
    tacticalRole.textContent = phaseSelection.manual
      ? "Manual"
      : tacticalRoleLabel(slot.tacticalRole);
    details.appendChild(slotLabel);
    details.appendChild(tacticalRole);

    const dutyIndicator = document.createElement("span");
    dutyIndicator.className = "match-lab-duty-indicator";
    dutyIndicator.setAttribute(
      "aria-label",
      displayedDuty === "manual" ? "Duty: Manual" : `Duty: ${displayedDuty}`,
    );
    for (const duty of ["attack", "support", "defend"]) {
      const dot = document.createElement("span");
      dot.className = "match-lab-duty-dot";
      dot.dataset.duty = duty;
      dot.dataset.active = String(displayedDuty === duty);
      dot.title = duty[0].toUpperCase() + duty.slice(1);
      dot.setAttribute("aria-hidden", "true");
      dutyIndicator.appendChild(dot);
    }
    shirt.appendChild(numberLabel);
    shirt.appendChild(details);
    shirt.appendChild(dutyIndicator);

    const nameLabel = document.createElement("span");
    nameLabel.className = "match-lab-tactics-name";
    nameLabel.textContent = setupMarkerLabel(player);
    marker.appendChild(shirt);
    marker.appendChild(nameLabel);
    // "Show restart roles" -- development labelling so wall members, the
    // taker and target runners can be inspected directly.
    if (restartRole && elements.showRestartRolesCheckbox?.checked) {
      const roleLabel = document.createElement("span");
      roleLabel.className = "match-lab-tactics-role";
      roleLabel.textContent = restartRole;
      marker.appendChild(roleLabel);
    }
    const positioningLabel = phaseSelection.manual
      ? "Manual"
      : `${tacticalRoleLabel(slot.tacticalRole)} (${slot.duty})`;
    marker.title = player
      ? `${playerName(player)} — ${slot.positionalSlot}, ${positioningLabel}`
        + (slot.band === "GK"
          ? `, distribution: ${slot.goalkeeperDistribution}, sweeping: ${slot.goalkeeperSweeping}`
          : `, shooting: ${slot.shootingInstruction}, tempo: ${slot.tempoInstruction}`)
      : `${slot.positionalSlot} — no player assigned`;
    elements.tacticsBoard.appendChild(marker);
  }
}

function renderSlotEditor() {
  const teamSetup = activeSetupTeam();
  const slot = teamSetup.slots.find((item) => item.slotId === state.selectedSetupSlotId) ?? null;
  if (elements.slotEditorEmpty) elements.slotEditorEmpty.hidden = Boolean(slot);
  if (elements.slotEditorFields) elements.slotEditorFields.hidden = !slot;
  if (!slot) return;
  const player = setupPlayerFor(teamSetup, slot);
  if (elements.slotPlayer) {
    elements.slotPlayer.textContent = player
      ? `${playerName(player)} · ${player.position_text ?? "position unknown"}`
      : "No player assigned to this slot.";
  }
  if (elements.slotPosition) elements.slotPosition.value = slot.positionalSlot;
  const phaseSelection = currentSetupPhaseSelection(slot);
  const manualPosition = phaseSelection.manual;
  if (elements.slotRole) {
    const editorMode = manualPosition ? "manual" : "role";
    if (elements.slotRole.dataset.position !== slot.positionalSlot
      || elements.slotRole.dataset.editorMode !== editorMode) {
      elements.slotRole.replaceChildren();
      const roles = manualPosition ? ["manual"] : tacticalRolesForPosition(slot.positionalSlot);
      for (const role of roles) {
        const option = document.createElement("option");
        option.value = role;
        option.textContent = role === "manual" ? "Manual" : tacticalRoleLabel(role);
        elements.slotRole.appendChild(option);
      }
      elements.slotRole.dataset.position = slot.positionalSlot;
      elements.slotRole.dataset.editorMode = editorMode;
    }
    elements.slotRole.value = manualPosition ? "manual" : slot.tacticalRole;
    elements.slotRole.disabled = manualPosition;
    elements.slotRole.dataset.manual = String(manualPosition);
  }
  if (elements.slotRoleNote) {
    elements.slotRoleNote.dataset.state = manualPosition ? "manual" : "";
    elements.slotRoleNote.textContent = manualPosition
      ? "This ball-area position is Manual. Reset it to restore tactical role and duty for this view."
      : "The choices follow this exact positional slot.";
  }
  if (elements.slotDuty) {
    const editorMode = manualPosition ? "manual" : "role";
    if (elements.slotDuty.dataset.editorMode !== editorMode) {
      elements.slotDuty.replaceChildren();
      const duties = manualPosition ? [["manual", "Manual"]]
        : [["attack", "Attack"], ["support", "Support"], ["defend", "Defend"]];
      for (const [value, label] of duties) {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = label;
        elements.slotDuty.appendChild(option);
      }
      elements.slotDuty.dataset.editorMode = editorMode;
    }
    elements.slotDuty.value = manualPosition ? "manual" : slot.duty;
    elements.slotDuty.disabled = manualPosition;
    elements.slotDuty.dataset.manual = String(manualPosition);
  }
  const goalkeeper = slot.band === "GK";
  if (elements.slotShootingField) elements.slotShootingField.hidden = goalkeeper;
  if (elements.slotTempoField) elements.slotTempoField.hidden = goalkeeper;
  if (elements.goalkeeperInstructionFields) elements.goalkeeperInstructionFields.hidden = !goalkeeper;
  if (elements.slotShootingInstruction) {
    const inherited = elements.slotShootingInstruction.querySelector('option[value="inherit"]');
    if (inherited) inherited.textContent = `Use team (${teamSetup.attacking.shooting === "encourage" ? "Shoot more" : teamSetup.attacking.shooting === "discourage" ? "Shoot less" : "Balanced"})`;
    elements.slotShootingInstruction.value = slot.shootingInstruction ?? "inherit";
  }
  if (elements.slotTempoInstruction) {
    const inherited = elements.slotTempoInstruction.querySelector('option[value="inherit"]');
    if (inherited) inherited.textContent = `Use team (${teamSetup.attacking.tempo})`;
    elements.slotTempoInstruction.value = slot.tempoInstruction ?? "inherit";
  }
  if (elements.goalkeeperDistribution) elements.goalkeeperDistribution.value = slot.goalkeeperDistribution ?? "mixed";
  if (elements.goalkeeperSweeping) elements.goalkeeperSweeping.value = slot.goalkeeperSweeping ?? "balanced";
  const phaseKey = state.setupBoardView === "with-ball" ? "withBallPosition"
    : state.setupBoardView === "without-ball" ? "withoutBallPosition" : null;
  const phaseMapKey = state.setupBoardView === "with-ball" ? "withBallPositions"
    : state.setupBoardView === "without-ball" ? "withoutBallPositions" : null;
  if (elements.resetPhasePosition) {
    const displayedZone = tacticsBoardZone(state.setupPhaseZone, teamSetup.attackingDirection);
    elements.resetPhasePosition.hidden = !phaseMapKey || !manualPosition;
    elements.resetPhasePosition.textContent = phaseKey === "withBallPosition"
      ? `Reset with-ball position for area ${displayedZone + 1}`
      : `Reset without-ball position for area ${displayedZone + 1}`;
  }
  if (elements.slotIncluded) elements.slotIncluded.checked = slot.included;
}

function renderTakerSelector() {
  const select = elements.restartTakerSelect;
  if (!select) return;
  const draft = setupDraft();
  const team = elements.restartTeamSelect?.value || "home";
  const teamSetup = draft[team];
  const previous = select.value;
  select.replaceChildren();
  const auto = document.createElement("option");
  auto.value = "";
  auto.textContent = "Auto (best suited)";
  select.appendChild(auto);
  for (const slot of teamSetup.slots) {
    if (!slot.included) continue;
    const player = setupPlayerFor(teamSetup, slot);
    if (!player) continue;
    const option = document.createElement("option");
    option.value = `${team}-${slot.slotId}`;
    option.textContent = `${slot.positionalSlot} · ${playerName(player)}`;
    select.appendChild(option);
  }
  // A previously chosen taker survives an unrelated re-render; one that no
  // longer exists falls back to Auto rather than silently pointing at
  // nobody.
  select.value = [...(select.options ?? [])].some((option) => option.value === previous)
    ? previous
    : "";
}

function renderRestartControls() {
  renderTakerSelector();
  const choice = elements.restartTypeSelect?.value || "kickoff";
  // Side only means anything where the restart genuinely has one. A free
  // kick's location comes from its band instead, and a kick-off is always
  // the centre mark.
  const sided = ["corner", "goal-kick", "throw-in"].includes(choice);
  if (elements.restartSideField) elements.restartSideField.hidden = !sided;
  if (elements.restartNote) {
    elements.restartNote.textContent = choice.startsWith("free-kick")
      ? "Attacking and defending free kicks are the same restart type in different location bands, not separate mechanics."
      : sided
        ? "Left and right mirror the whole layout, including the goalkeeper."
        : "A kick-off is always taken from the centre mark, with both teams in their own half.";
  }
}

function renderSetupStatus(message, level = "") {
  for (const status of [elements.setupStatus, elements.tacticsStatus]) {
    if (!status) continue;
    status.textContent = message ?? "";
    status.dataset.level = level;
  }
}

function renderTeamTacticsControls() {
  const draft = setupDraft();
  const activeTeam = state.setupTeamTab;
  if (elements.teamTacticsTitle) {
    elements.teamTacticsTitle.textContent = `${activeTeam === "away" ? "Away" : "Home"} team tactics`;
  }
  for (const group of elements.teamTacticGroups) {
    const active = group.dataset.team === activeTeam;
    group.hidden = !active;
    group.setAttribute("aria-hidden", String(!active));
  }
  for (const select of elements.markingSchemeSelects) {
    select.value = draft[select.dataset.team].marking.scheme;
  }
  for (const select of elements.attackingStyleSelects) {
    select.value = draft[select.dataset.team].attacking.style;
  }
  for (const select of elements.teamShootingSelects) {
    select.value = draft[select.dataset.team].attacking.shooting;
  }
  for (const select of elements.teamTempoSelects) {
    select.value = draft[select.dataset.team].attacking.tempo;
  }
  for (const control of elements.teamInstructionControls) {
    const value = draft[control.dataset.team]?.[control.dataset.section]?.[control.dataset.field];
    if (control.type === "checkbox") control.checked = value === true;
    else if (value != null) control.value = String(value);
  }
  for (const team of ["home", "away"]) {
    updateMarkingStrictnessDisplay(team);
    updateAttackingDirectnessDisplay(team);
  }
}

function renderMatchSetupPanel() {
  renderSquadSelectors();
  renderFormatChoices();
  renderFormationControls();
  renderTeamTacticsControls();
  renderTacticsBoard();
  renderSlotEditor();
  renderRestartControls();
}

// ---------------------------------------------------------------------------
// Restart preview
// ---------------------------------------------------------------------------

function buildRestartDraft() {
  const draft = setupDraft();
  // `||`, not `??`: a select that has not been populated yet reports an
  // empty string rather than null, and an empty restart type is not a
  // restart. Falling back to a real default keeps the draft buildable.
  const choice = elements.restartTypeSelect?.value || "kickoff";
  const takingTeam = elements.restartTeamSelect?.value || "home";
  const side = elements.restartSideSelect?.value || "right";
  const type = choice.startsWith("free-kick") ? "free-kick" : choice;
  const freeKickBand = choice === "free-kick-attacking"
    ? "attacking"
    : choice === "free-kick-defending" ? "defending" : null;
  const attackingDirectionByTeam = {
    home: draft.home.attackingDirection,
    away: draft.away.attackingDirection,
  };
  return createRestartSetup({
    type, takingTeam, attackingDirectionByTeam, side, freeKickBand,
    // The taker is nominated during apply, once the lineup is known.
    takerId: "pending",
  });
}

/**
 * Turns a restart specification into concrete roster placements.
 *
 * Deterministic and one-player-per-role: the real goalkeeper takes any
 * goal-anchored role, the nominated taker takes the required taker role,
 * and every other restart role is filled from the remaining players by
 * football suitability. Anyone left over stands at their normal,
 * already-oriented formation anchor.
 */
/**
 * Where a player who is NOT named in the restart layout may legally stand.
 *
 * Formation anchors are authored for open play. This maps one onto a legal
 * position for the restart in question, preserving the shape's own relative
 * geometry rather than scattering anyone:
 *   kick-off  -- the whole team is compressed into its own half, which is
 *                what Law 8 requires and what a real kick-off shape looks
 *                like.
 *   otherwise -- a defending player inside the restart's own opponent ring
 *                is pushed radially out to its edge; nobody else moves.
 */
function legalRestartAnchor(entry, restart, team) {
  const anchor = { x: entry.x, y: entry.y };
  if (restart.type === "kickoff") {
    const attacking = team === restart.takingTeam ? restart.attackingDirection
      : restart.attackingDirection === "up" ? "down" : "up";
    // Own goal is the end this team is NOT attacking.
    const ownGoalY = attacking === "up" ? 100 : 0;
    const point = { x: anchor.x, y: ownGoalY === 0 ? anchor.y * 0.5 : 50 + anchor.y * 0.5 };
    if (team !== restart.takingTeam && yardDistance(point, restart.ball) < 10.5) {
      point.y = ownGoalY === 0 ? 40 : 60;
    }
    return point;
  }
  const minimum = restart.opponentDistanceYards ?? 0;
  if (!minimum || team === restart.takingTeam) return anchor;
  const distance = yardDistance(restart.ball, anchor);
  if (distance >= minimum) return anchor;
  // Push straight out from the ball to just past the ring's edge. Distance
  // is measured in yards but the offset lives in percent space; scaling the
  // whole offset vector by the ratio works because yardDistance() is linear
  // along a fixed direction. A player standing exactly on the ball has no
  // direction to push along, so they go straight up the pitch instead.
  let dx = anchor.x - restart.ball.x;
  let dy = anchor.y - restart.ball.y;
  if (!dx && !dy) { dx = 0; dy = 1; }
  const scale = (minimum + 0.5) / Math.max(distance, 0.001);
  return {
    x: clamp(0, 100, restart.ball.x + dx * scale),
    y: clamp(0, 100, restart.ball.y + dy * scale),
  };
}

/**
 * Places a corner from the taking and defending teams' corner plans.
 *
 * Resolution order is forced by the football: the attack is set up first,
 * because the defence marks it. `cornerPlans[team]` is that team's standing
 * plan (createTeamSetup()'s own cornerPlan); `restart.cornerOverride` is the
 * partial, this-corner-only change on top of it.
 */
function placeCornerParticipants(restart, teams, { takerOverrides = {}, cornerPlans = {} } = {}) {
  const placements = new Map();
  const roles = new Map();
  const subjects = new Map();
  const takingTeam = restart.takingTeam;
  const defendingTeam = restart.defendingTeam
    ?? Object.keys(teams).find((team) => team !== takingTeam);
  const goalY = attackingGoalYForDirection(restart.attackingDirection);
  const side = restart.side ?? "right";
  const override = restart.cornerOverride ?? null;

  const planFor = (team) => resolveCornerPlan(
    cornerPlans[team] ?? createTeamCornerPlan(),
    team === takingTeam ? { attack: override?.attack } : { defend: override?.defend },
  );

  const attackPlan = planFor(takingTeam);
  const attack = resolveCornerAttack({
    entries: teams[takingTeam]?.entries ?? [],
    spec: { ...attackPlan.attack, takerId: takerOverrides[takingTeam] ?? attackPlan.attack.takerId },
    goalY, side, ball: restart.ball,
  });
  // The defensive resolver scores the attackers it is marking, so it needs
  // the player records, not just the coordinates.
  const attackerById = new Map((teams[takingTeam]?.entries ?? []).map((entry) => [String(entry.id), entry]));
  for (const spot of attack.placements) spot.player = attackerById.get(String(spot.id))?.player ?? null;

  const defence = defendingTeam
    ? resolveCornerDefence({
        entries: teams[defendingTeam]?.entries ?? [],
        spec: planFor(defendingTeam).defend,
        attack, goalY, side,
      })
    : { placements: [], unmarkedCount: 0 };

  for (const spot of [...attack.placements, ...defence.placements]) {
    placements.set(spot.id, { x: spot.x, y: spot.y });
    roles.set(spot.id, spot.role);
    if (spot.marks != null) subjects.set(spot.id, spot.marks);
  }
  // The goalkeeper's corner position is goalkeeping, not a role the manager
  // assigns, so it keeps the existing goal-anchored spot from the restart
  // layout -- which already shades him slightly toward the corner the ball is
  // coming from. Re-deriving it in the role resolver would have quietly lost
  // that shading.
  const anchoredKeeper = (restart.layout?.defending ?? []).find((spot) => spot.anchoredToGoal);
  const defendingKeeper = (teams[defendingTeam]?.entries ?? []).find((entry) => entry.role === "keeper");
  if (anchoredKeeper && defendingKeeper) {
    placements.set(defendingKeeper.id, { x: anchoredKeeper.x, y: anchoredKeeper.y });
    roles.set(defendingKeeper.id, anchoredKeeper.restartRole ?? "keeper");
  }
  return {
    placements, roles, subjects, wallIds: [],
    takerId: attack.takerId ?? null,
    corner: {
      swing: attack.swing,
      delivery: attack.delivery,
      unmarkedCount: defence.unmarkedCount,
      markDistanceYards: defence.markDistanceYards ?? null,
    },
  };
}

function placeRestartParticipants(restart, teams, { takerOverrides = {}, cornerPlans = {} } = {}) {
  const placements = new Map();
  const roles = new Map();
  const subjects = new Map();
  const takerIds = {};
  const wallIds = [];
  // A corner is not a fixed seven-role template any more. It is a manager
  // instruction with per-role counts, resolved against the squad, and the
  // defending side is resolved against the attack that was actually set up
  // -- markers have to know who they are marking. Everything else keeps the
  // existing layout path unchanged.
  if (restart.type === "corner") {
    return placeCornerParticipants(restart, teams, { takerOverrides, cornerPlans });
  }
  for (const [team, prepared] of Object.entries(teams)) {
    const isTaking = team === restart.takingTeam;
    let layout = isTaking ? restart.layout.taking : restart.layout.defending;

    // Restart Execution v2 -- a free kick's defending layout carries ONE
    // abstract "wall" marker, which cannot show whether the near post is
    // actually covered. Expand it into a real, geometric wall of two to
    // five bodies at the required ten yards, perpendicular to the ball-goal
    // line. The goalkeeper is never one of them: they stay separately
    // anchored to the goal (see the layout's own anchoredToGoal role).
    if (!isTaking && restart.type === "free-kick") {
      const wallGoalY = attackingGoalYForDirection(restart.attackingDirection);
      const size = wallSizeFor({
        distanceYards: yardDistance(restart.ball, { x: 50, y: wallGoalY }),
        angleTightness: Math.abs(restart.ball.x - 50) / 50,
      });
      const spots = wallPositions({ ball: restart.ball, attackingGoalY: wallGoalY, size });
      layout = layout.flatMap((spot) => (spot.wall
        ? spots.map((point, index) => ({
            ...spot,
            restartRole: `wall-${index + 1}`,
            wall: true,
            x: point.x,
            y: point.y,
          }))
        : [spot]));
    }

    // Roles are assigned by FOOTBALL SUITABILITY, not by walking the entry
    // list. Consuming entries in formation order is what made Lizarazu take
    // France's kick-off and put centre-halves on near-post runs.
    const takerId = isTaking
      ? (takerOverrides[team]
        ?? selectRestartTaker({
          type: restart.type,
          variant: restart.variant,
          participants: prepared.entries,
          preferredId: takerOverrides[team] ?? null,
        })?.id ?? null)
      : null;
    const assignment = assignRestartRoles({
      layout,
      participants: prepared.entries.filter((entry) =>
        !entry.restartWallExcluded || !layout.some((spot) => spot.wall)),
      takerId,
    });
    for (const [id, spot] of assignment.assignments) {
      placements.set(id, { x: spot.x, y: spot.y });
      roles.set(id, spot.restartRole);
      if (spot.wall) wallIds.push(id);
      if (spot.required && isTaking) takerIds[team] = id;
    }
    // Everyone not named in the layout keeps their formation anchor -- but
    // an anchor is only legal for OPEN PLAY. A kick-off puts every player
    // in their own half (Law 8), and a ringed restart keeps opponents ten
    // yards off the ball, so an untouched 4-4-2 anchor would put forwards
    // across halfway at kick-off and defenders inside the ring at a corner.
    for (const entry of assignment.unassigned) {
      placements.set(entry.id, legalRestartAnchor(entry, restart, team));
      roles.set(entry.id, null);
    }
  }
  return { placements, roles, subjects, wallIds, takerId: takerIds[restart.takingTeam] ?? null };
}

// ---------------------------------------------------------------------------
// Apply
// ---------------------------------------------------------------------------

/**
 * Builds the complete prospective roster, validates everything, and only
 * then replaces the live state. Atomic by construction: every failure
 * returns before a single field of state.roster/state.ball is touched.
 */
async function applySetup() {
  stopMatchSession();
  const draft = setupDraft();
  renderSetupStatus("Resolving squads…");
  const prepared = {};
  for (const team of ["home", "away"]) {
    const teamSetup = draft[team];
    if (!teamSetup.squadKey) {
      renderSetupStatus(`Choose a ${team} squad before applying.`, "error");
      return false;
    }
    const resolution = await resolveSetupSquad(teamSetup.squadKey);
    if (!resolution.ok) {
      renderSquadSelectors();
      renderSetupStatus(`${team === "home" ? "Home" : "Away"} squad unavailable — ${resolution.reason}`, "error");
      return false;
    }
    reassignSetupTeam(team);
    const rebuilt = draft[team];
    const entries = [];
    for (const slot of rebuilt.slots) {
      if (!slot.included) continue;
      const player = setupPlayerFor(rebuilt, slot);
      if (!player) continue;
      entries.push({
        id: `${team}-${slot.slotId}`,
        role: roleBand(slot.positionalSlot) === "GK" ? "keeper" : "player",
        team,
        player,
        x: slot.x,
        y: slot.y,
        zone: zoneFromPercent(slot.x, slot.y),
        positionalSlot: slot.positionalSlot,
        tacticalRole: slot.tacticalRole,
        duty: slot.duty,
        shootingInstruction: slot.shootingInstruction,
        tempoInstruction: slot.tempoInstruction,
        goalkeeperDistribution: slot.goalkeeperDistribution,
        goalkeeperSweeping: slot.goalkeeperSweeping,
        withBallAnchor: slot.withBallPosition ? { ...slot.withBallPosition } : null,
        withoutBallAnchor: slot.withoutBallPosition ? { ...slot.withoutBallPosition } : null,
        withBallAnchors: Object.fromEntries(Object.entries(slot.withBallPositions ?? {})
          .map(([zone, point]) => [zone, { ...point }])),
        withoutBallAnchors: Object.fromEntries(Object.entries(slot.withoutBallPositions ?? {})
          .map(([zone, point]) => [zone, { ...point }])),
        // Restart Execution v2 -- the ORIENTED open-play anchor, kept
        // alongside whatever temporary restart position this entry ends up
        // with. Once the ball is live the release phase heads back toward
        // this rather than teleporting onto it, and it is what stops the
        // ball circulating forever inside a compressed restart shape.
        formationAnchor: { x: slot.x, y: slot.y },
        restartRole: null,
      });
    }
    const keepers = entries.filter((entry) => entry.role === "keeper");
    if (keepers.length !== 1) {
      renderSetupStatus(`${team} has ${keepers.length} goalkeepers — exactly one is required.`, "error");
      return false;
    }
    prepared[team] = { entries };
  }

  const validation = validateMatchSetup(draft);
  if (!validation.valid) {
    renderSetupStatus(`Setup invalid — ${validation.errors[0]}`, "error");
    return false;
  }

  // Restart: build it, place participants, and prove the result is legal
  // BEFORE anything is committed.
  const restart = buildRestartDraft();
  const takerOverrides = {};
  const chosenTaker = elements.restartTakerSelect?.value;
  if (chosenTaker) takerOverrides[restart.takingTeam] = chosenTaker;
  // Each team's standing corner plan travels with its setup, so a corner
  // built here is the tactic the manager set rather than a fixed template.
  const cornerPlans = Object.fromEntries(["home", "away"]
    .map((team) => [team, draft[team]?.cornerPlan ?? null])
    .filter(([, plan]) => plan));
  const { placements, roles, subjects, wallIds, takerId, corner } = placeRestartParticipants(
    restart, prepared, { takerOverrides, cornerPlans },
  );
  // Carried onto the live state so the delivery and swing the plan produced
  // are available to whatever executes the restart, and so a captured
  // scenario can replay the same corner.
  state.cornerPlans = cornerPlans;
  state.lastCorner = corner ?? null;
  if (!takerId) {
    renderSetupStatus("Could not nominate a restart taker from the authored XI.", "error");
    return false;
  }
  const nominated = {
    ...restart,
    takerId,
    variant: corner?.delivery?.target === "short" ? "short" : restart.variant,
    corner: corner ?? null,
  };
  const restartCheck = validateGeneratedRestartSetup(nominated);
  if (!restartCheck.valid) {
    renderSetupStatus(`Restart layout illegal — ${restartCheck.errors[0]}`, "error");
    return false;
  }

  // Everything above succeeded; only now is the live state replaced.
  const roster = [...prepared.home.entries, ...prepared.away.entries].map((entry) => {
    const placed = placements.get(entry.id) ?? { x: entry.x, y: entry.y };
    return {
      ...entry,
      x: placed.x, y: placed.y, zone: zoneFromPercent(placed.x, placed.y),
      restartRole: roles.get(entry.id) ?? null,
      restartSubjectId: subjects?.get(entry.id) ?? null,
    };
  });
  // Validate the concrete players Apply Setup will actually commit, not
  // only restartSetup.js's abstract role template. This catches illegal
  // fallback anchors and assigned opponents inside the required distance.
  const concreteRestartCheck = validateRestartSetup(nominated, {
    taking: roster
      .filter((entry) => entry.team === nominated.takingTeam)
      .map((entry) => ({ ...entry, required: entry.id === takerId })),
    defending: roster.filter((entry) => entry.team === nominated.defendingTeam),
  });
  if (!concreteRestartCheck.valid) {
    renderSetupStatus(`Concrete restart layout illegal: ${concreteRestartCheck.errors[0]}`, "error");
    return false;
  }
  state.roster = roster;
  // Restart Execution v2 -- the taker OWNS the dead ball. "Owns" here means
  // "is the player standing over it", not "open play has started": the ball
  // still carries an explicit dead phase and state.pendingRestart stays
  // authoritative, so Resolve & Play dispatches the restart rather than the
  // open-play chooser. Without an owner the ball had nobody to be kicked BY.
  state.ball = {
    x: nominated.ball.x,
    y: nominated.ball.y,
    zone: zoneFromPercent(nominated.ball.x, nominated.ball.y),
    ownerId: takerId,
    phase: "dead",
    deadBall: true,
  };
  state.attackingDirection = {
    home: draft.home.attackingDirection,
    away: draft.away.attackingDirection,
  };
  state.marking = {
    home: normalizeTeamDefending(draft.home.marking),
    away: normalizeTeamDefending(draft.away.marking),
  };
  state.attacking = {
    home: normalizeTeamAttacking(draft.home.attacking),
    away: normalizeTeamAttacking(draft.away.attacking),
  };
  state.transition = {
    home: normalizeTeamTransition(draft.home.transition),
    away: normalizeTeamTransition(draft.away.transition),
  };
  state.restartSetupDraft = nominated;
  // Ownership means standing over the dead ball; the required action is
  // still the only route into open play.
  state.pendingRestart = {
    type: nominated.type,
    requiredFirstAction: nominated.requiredFirstAction,
    takerId,
    takingTeam: nominated.takingTeam,
  };
  stopPlayback();
  renderPitch();
  renderRoster();
  renderActionTable();
  const warnings = [...(draft.home.lineupWarnings ?? []), ...(draft.away.lineupWarnings ?? [])];
  renderSetupStatus(
    `Applied. ${nominated.type} to ${nominated.takingTeam}; Resolve & Play will execute ${nominated.requiredFirstAction}.`
    + (warnings.length ? ` ${warnings.length} out-of-position note(s).` : ""),
    warnings.length ? "warn" : "ok",
  );
  renderMatchSetupPanel();
  return true;
}

// ---------------------------------------------------------------------------
// Wiring
// ---------------------------------------------------------------------------

elements.homeSquadSelect?.addEventListener("change", async (event) => {
  setupDraft().home.squadKey = event.target.value || null;
  state.selectedSetupSlotId = null;
  if (event.target.value) {
    renderSetupStatus("Resolving home squad…");
    const resolution = await resolveSetupSquad(event.target.value);
    renderSetupStatus(resolution.ok ? "" : `Home squad unavailable — ${resolution.reason}`, resolution.ok ? "" : "error");
    if (resolution.ok) reassignSetupTeam("home");
  }
  renderMatchSetupPanel();
});

elements.awaySquadSelect?.addEventListener("change", async (event) => {
  setupDraft().away.squadKey = event.target.value || null;
  state.selectedSetupSlotId = null;
  if (event.target.value) {
    renderSetupStatus("Resolving away squad…");
    const resolution = await resolveSetupSquad(event.target.value);
    renderSetupStatus(resolution.ok ? "" : `Away squad unavailable — ${resolution.reason}`, resolution.ok ? "" : "error");
    if (resolution.ok) reassignSetupTeam("away");
  }
  renderMatchSetupPanel();
});

elements.formatChoices?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-format]");
  if (!button) return;
  const draft = setupDraft();
  draft.format = button.dataset.format;
  // A format button rearranges the SHAPE deterministically. It never rolls
  // a random side -- Random XI is its own explicit control.
  state.selectedSetupSlotId = null;
  reassignSetupTeam("home");
  reassignSetupTeam("away");
  renderMatchSetupPanel();
});

for (const [tab, team] of [[elements.setupHomeTab, "home"], [elements.setupAwayTab, "away"]]) {
  tab?.addEventListener("click", () => {
    // Each team keeps its own formation, style and per-slot instructions;
    // switching tabs only changes which one is on screen.
    state.setupTeamTab = team;
    state.selectedSetupSlotId = null;
    renderMatchSetupPanel();
  });
}

elements.formationSelect?.addEventListener("change", (event) => {
  activeSetupTeam().formation = event.target.value;
  markPausedTacticsDirty();
  state.selectedSetupSlotId = null;
  reassignSetupTeam(state.setupTeamTab);
  renderMatchSetupPanel();
});

elements.formationStyleSelect?.addEventListener("change", (event) => {
  activeSetupTeam().style = event.target.value;
  markPausedTacticsDirty();
  state.selectedSetupSlotId = null;
  reassignSetupTeam(state.setupTeamTab);
  renderMatchSetupPanel();
});

elements.tacticsBoard?.addEventListener("click", (event) => {
  if (suppressTacticsBoardClick) {
    suppressTacticsBoardClick = false;
    event.preventDefault();
    return;
  }
  const zone = event.target.closest("[data-phase-zone]");
  if (zone) {
    state.setupPhaseZone = clamp(0, 11, Number(zone.dataset.phaseZone) || 0);
    renderTacticsBoard();
    renderSlotEditor();
    return;
  }
  const marker = event.target.closest("[data-slot-id]");
  if (!marker) return;
  state.selectedSetupSlotId = marker.dataset.slotId;
  renderTacticsBoard();
  renderSlotEditor();
});

let tacticsBoardDrag = null;
let suppressTacticsBoardClick = false;
elements.tacticsBoard?.addEventListener("pointerdown", (event) => {
  const marker = event.target.closest("[data-slot-id]");
  if (!marker) return;
  state.selectedSetupSlotId = marker.dataset.slotId;
  const phaseMapKey = state.setupBoardView === "with-ball" ? "withBallPositions"
    : state.setupBoardView === "without-ball" ? "withoutBallPositions" : null;
  const formationDrag = state.setupBoardView === "open-play";
  if (!phaseMapKey && !formationDrag) return;
  event.preventDefault();
  marker.setPointerCapture?.(event.pointerId);
  const slot = activeSetupTeam().slots.find((item) => item.slotId === state.selectedSetupSlotId);
  tacticsBoardDrag = {
    marker, pointerId: event.pointerId, phaseMapKey, formationDrag,
    phaseZone: String(state.setupPhaseZone),
    startClientX: event.clientX, startClientY: event.clientY,
    currentClientX: event.clientX, currentClientY: event.clientY,
    pendingWorldPoint: null, moved: false,
    originalPhasePoint: phaseMapKey
      ? (slot?.[phaseMapKey]?.[String(state.setupPhaseZone)] ? { ...slot[phaseMapKey][String(state.setupPhaseZone)] } : null)
      : null,
    manualStarted: slot ? currentSetupPhaseSelection(slot).manual : false,
  };
  renderSlotEditor();
});

elements.tacticsBoard?.addEventListener("pointermove", (event) => {
  if (!tacticsBoardDrag || event.pointerId !== tacticsBoardDrag.pointerId) return;
  const rect = elements.tacticsBoard.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const point = {
    x: clamp(2, 98, (event.clientX - rect.left) / rect.width * 100),
    y: clamp(2, 98, (event.clientY - rect.top) / rect.height * 100),
  };
  tacticsBoardDrag.currentClientX = event.clientX;
  tacticsBoardDrag.currentClientY = event.clientY;
  tacticsBoardDrag.moved ||= Math.hypot(
    event.clientX - tacticsBoardDrag.startClientX,
    event.clientY - tacticsBoardDrag.startClientY,
  ) >= 4;
  const slot = activeSetupTeam().slots.find((item) => item.slotId === state.selectedSetupSlotId);
  if (!slot) return;
  const worldPoint = tacticsBoardPoint(point, activeSetupTeam().attackingDirection);
  tacticsBoardDrag.pendingWorldPoint = worldPoint;
  if (tacticsBoardDrag.phaseMapKey) {
    slot[tacticsBoardDrag.phaseMapKey] ||= {};
    slot[tacticsBoardDrag.phaseMapKey][tacticsBoardDrag.phaseZone] = worldPoint;
  }
  tacticsBoardDrag.marker.style.left = `${point.x}%`;
  tacticsBoardDrag.marker.style.top = `${point.y}%`;
  if (tacticsBoardDrag.phaseMapKey && !tacticsBoardDrag.manualStarted) {
    tacticsBoardDrag.manualStarted = true;
    renderSlotEditor();
  }
});

function formationSwapTarget(drag) {
  if (!drag?.formationDrag) return null;
  let nearest = null;
  for (const marker of elements.tacticsBoard.querySelectorAll("[data-slot-id]")) {
    if (marker === drag.marker) continue;
    const bounds = marker.getBoundingClientRect();
    const centerX = bounds.left + bounds.width / 2;
    const centerY = bounds.top + bounds.height / 2;
    const distance = Math.hypot(drag.currentClientX - centerX, drag.currentClientY - centerY);
    const hitRadius = Math.max(24, Math.min(42, Math.hypot(bounds.width, bounds.height) * 0.55));
    if (distance <= hitRadius && (!nearest || distance < nearest.distance)) {
      nearest = { slotId: marker.dataset.slotId, distance };
    }
  }
  return nearest?.slotId ?? null;
}

const finishTacticsBoardDrag = (event, cancelled = false) => {
  if (!tacticsBoardDrag || event.pointerId !== tacticsBoardDrag.pointerId) return;
  const drag = tacticsBoardDrag;
  drag.marker.releasePointerCapture?.(event.pointerId);
  if (cancelled && drag.phaseMapKey) {
    const slot = activeSetupTeam().slots.find((item) => item.slotId === drag.marker.dataset.slotId);
    if (slot) {
      slot[drag.phaseMapKey] ||= {};
      if (drag.originalPhasePoint) slot[drag.phaseMapKey][drag.phaseZone] = drag.originalPhasePoint;
      else delete slot[drag.phaseMapKey][drag.phaseZone];
    }
  } else if (drag.formationDrag && drag.moved && drag.pendingWorldPoint) {
    const result = applyTacticsFormationDrop(
      activeSetupTeam(),
      drag.marker.dataset.slotId,
      drag.pendingWorldPoint,
      formationSwapTarget(drag),
    );
    suppressTacticsBoardClick = result.changed;
    if (result.changed) markPausedTacticsDirty();
    if (elements.tacticsStatus && result.changed) {
      elements.tacticsStatus.textContent = result.kind === "swap"
        ? "Players swapped in the tactical draft. Confirm to apply."
        : "Formation position moved in the tactical draft. Confirm to apply.";
    }
  } else if (!cancelled && drag.phaseMapKey && drag.moved) markPausedTacticsDirty();
  tacticsBoardDrag = null;
  renderTacticsBoard();
  renderSlotEditor();
};

const COORDINATION_RESPONSIBILITY_PHRASE = {
  "immediate-outlet": "shows as the immediate outlet",
  "close-support": "supports the ball at close range",
  "central-depth-runner": "attacks central depth",
  "curved-channel-runner": "curves a run into the channel",
  overlap: "overlaps outside",
  underlap: "underlaps into the inside lane",
  "third-man-runner": "continues as the third runner",
  "weak-side-runner": "attacks from the weak side",
  "trailing-arrival": "arrives behind the first wave",
  "recycle-outlet": "drops behind the ball to recycle",
  "switch-receiver": "holds the weak side for the switch",
  "circulation-support": "connects the circulation",
  "near-post-runner": "attacks the near-post lane",
  "central-box-target": "occupies the central finishing lane",
  "far-post-runner": "arrives at the far post",
  "cutback-option": "shows behind the box runs",
  "edge-of-box-arrival": "holds the edge for a rebound",
  "rest-defence": "holds the rest-defence position",
  "primary-pressure": "owns the pressure on the ball",
  "inside-cover": "covers behind the pressure",
  "depth-protector": "protects the space in behind",
  "runner-tracker": "tracks the assigned runner",
  "far-side-balance": "holds the far-side balance",
  "recovery-screen": "recovers into the screen",
  "defensive-line-controller": "controls the defensive line",
  "defensive-line-member": "aligns with the defensive line",
  "shape-recovery": "leaves the chase and recovers shape",
  "loose-ball-claimant": "chases the loose ball",
};
elements.tacticsBoard?.addEventListener("pointerup", finishTacticsBoardDrag);
elements.tacticsBoard?.addEventListener("pointercancel", (event) => finishTacticsBoardDrag(event, true));

const applySlotInstruction = (patch) => {
  if (!state.selectedSetupSlotId) return;
  const draft = setupDraft();
  draft[state.setupTeamTab] = setSlotInstruction(
    draft[state.setupTeamTab], state.selectedSetupSlotId, patch,
  );
  draft[state.setupTeamTab].squadKey = activeSetupTeam().squadKey;
  markPausedTacticsDirty();
  renderTacticsBoard();
  renderSlotEditor();
};
elements.slotRole?.addEventListener("change", (event) => {
  const slot = activeSetupTeam().slots.find((item) => item.slotId === state.selectedSetupSlotId);
  if (!slot || currentSetupPhaseSelection(slot).manual) return renderSlotEditor();
  applySlotInstruction({ tacticalRole: event.target.value });
});
elements.slotDuty?.addEventListener("change", (event) => {
  const slot = activeSetupTeam().slots.find((item) => item.slotId === state.selectedSetupSlotId);
  if (!slot || currentSetupPhaseSelection(slot).manual) return renderSlotEditor();
  applySlotInstruction({ duty: event.target.value });
});
elements.slotShootingInstruction?.addEventListener("change", (event) => {
  const shootingInstruction = SHOOTING_INSTRUCTIONS.includes(event.target.value)
    ? event.target.value
    : "inherit";
  applySlotInstruction({ shootingInstruction });
});
elements.slotTempoInstruction?.addEventListener("change", (event) => {
  const tempoInstruction = TEMPO_INSTRUCTIONS.includes(event.target.value)
    ? event.target.value : "inherit";
  applySlotInstruction({ tempoInstruction });
});
elements.goalkeeperDistribution?.addEventListener("change", (event) => {
  const goalkeeperDistribution = GOALKEEPER_DISTRIBUTIONS.includes(event.target.value)
    ? event.target.value : "mixed";
  applySlotInstruction({ goalkeeperDistribution });
});
elements.goalkeeperSweeping?.addEventListener("change", (event) => {
  const goalkeeperSweeping = GOALKEEPER_SWEEPING.includes(event.target.value)
    ? event.target.value : "balanced";
  applySlotInstruction({ goalkeeperSweeping });
});
elements.resetPhasePosition?.addEventListener("click", () => {
  const phaseKey = state.setupBoardView === "with-ball" ? "withBallPosition"
    : state.setupBoardView === "without-ball" ? "withoutBallPosition" : null;
  const phaseMapKey = state.setupBoardView === "with-ball" ? "withBallPositions"
    : state.setupBoardView === "without-ball" ? "withoutBallPositions" : null;
  if (!phaseMapKey) return;
  const slot = activeSetupTeam().slots.find((item) => item.slotId === state.selectedSetupSlotId);
  const positions = { ...(slot?.[phaseMapKey] ?? {}) };
  const zoned = positions[String(state.setupPhaseZone)];
  if (zoned) {
    delete positions[String(state.setupPhaseZone)];
    applySlotInstruction({ [phaseMapKey]: positions });
  } else if (phaseKey && slot?.[phaseKey]) {
    applySlotInstruction({ [phaseKey]: null });
  }
});
elements.slotIncluded?.addEventListener("change", (event) => applySlotInstruction({ included: event.target.checked }));

elements.boardViewChoices?.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-board-view]");
  if (!button) return;
  state.setupBoardView = button.dataset.boardView;
  for (const option of elements.boardViewChoices.children) {
    option.classList?.toggle("is-selected", option === button);
  }
  renderTacticsBoard();
  renderSlotEditor();
});
elements.showRoleMapCheckbox?.addEventListener("change", (event) => {
  state.showRoleMap = Boolean(event.target.checked);
  renderTacticsBoard();
});
/**
 * Development diagnostics for the action-pattern layer.
 *
 * Strictly read-only: it renders whatever the last evaluation recorded and
 * touches no simulation state, no roster coordinate and no RNG. The panel
 * is optional and off by default.
 */
function renderPatternDiagnostics() {
  const host = elements.patternDiagnostics;
  if (!host) return;
  const visible = Boolean(elements.showPatternDiagnosticsCheckbox?.checked);
  host.hidden = !visible;
  if (!visible) return;
  const diagnostics = lastActionPatternDiagnostics();
  host.replaceChildren();
  if (!diagnostics) {
    const empty = document.createElement("p");
    empty.className = "match-lab-setup-note";
    empty.textContent = "No pattern evaluation yet — run a possession.";
    host.appendChild(empty);
    return;
  }
  const list = document.createElement("ul");
  list.className = "match-lab-pattern-list";
  for (const proposal of diagnostics.proposals ?? []) {
    const item = document.createElement("li");
    item.dataset.state = "matched";
    const slots = Object.entries(proposal.participants ?? {})
      .map(([slot, id]) => `${slot}=${id}`).join(", ");
    item.textContent = `${proposal.patternId} → ${proposal.job} (${proposal.actorId})`
      + (slots ? `  [${slots}]` : "");
    list.appendChild(item);
  }
  for (const rejection of diagnostics.rejections ?? []) {
    const item = document.createElement("li");
    item.dataset.state = "rejected";
    item.textContent = `${rejection.patternId} ✕ ${rejection.stage}: ${rejection.reason}`;
    list.appendChild(item);
  }
  // Dynamic Ball Claim v2 -- the loose-ball race, in the same read-only
  // panel. The abandonment reasons are the point: "why did nobody chase
  // that" used to be unanswerable, because nothing recorded it.
  // Joint pass/run candidates: passer, runner, intended point and region,
  // delivery, the three arrival times that decide it, and the reason a
  // rejected idea was rejected.
  for (const candidate of lastJointCandidateDiagnostics().slice(0, 6)) {
    const item = document.createElement("li");
    item.dataset.state = candidate.viable ? "matched" : "rejected";
    const aim = `(${candidate.intendedPoint.x.toFixed(1)}, ${candidate.intendedPoint.y.toFixed(1)})`;
    const etas = `ball ${Math.round(candidate.ballEtaMs)}ms / runner ${Math.round(candidate.runnerEtaMs)}ms`
      + `${Number.isFinite(candidate.defenderEtaMs) ? ` / def ${Math.round(candidate.defenderEtaMs)}ms` : ""}`;
    const terms = Object.entries(candidate.utilityBreakdown)
      .filter(([, value]) => value !== 0)
      .map(([name, value]) => `${name} ${value >= 0 ? "+" : ""}${value.toFixed(2)}`)
      .join(" ");
    item.textContent = `${candidate.passerId} → ${candidate.runnerId} `
      + `${candidate.meetingPointKind} ${aim} ${candidate.region?.id ?? ""} `
      + `· ${candidate.passType} ${candidate.passDistanceYards.toFixed(0)}yd `
      + `· ${etas} · margin ${Math.round(candidate.arrivalMarginMs)}ms `
      + `· lane ${candidate.laneObstruction.toFixed(2)}`
      + `${candidate.offside?.isOffside ? " · OFFSIDE" : ""}`
      + `${candidate.viable ? ` · u ${candidate.utility.toFixed(2)} [${terms}]` : ` ✕ ${candidate.rejection}`}`;
    list.appendChild(item);
  }
  const claim = lastBallClaimDiagnostics();
  if (claim) {
    const winner = claim.claimant ?? claim.pickup?.entry ?? null;
    const heading = document.createElement("li");
    heading.dataset.state = winner ? "matched" : "rejected";
    heading.textContent = winner
      ? `loose ball → ${winner.id} ${claim.claimant ? `intercepts at ${Math.round(claim.interceptMs)}ms` : "collects it once it stops"}`
      : "loose ball → nobody reaches it";
    list.appendChild(heading);
    for (const entry of claim.abandoned ?? []) {
      const item = document.createElement("li");
      item.dataset.state = "rejected";
      item.textContent = `  ${entry.id} ✕ abandons: ${entry.reason}`
        + (entry.shortfallMs > 0 ? ` (short by ${Math.round(entry.shortfallMs)}ms)` : "");
      list.appendChild(item);
    }
  }
  host.appendChild(list);
}

function renderFluidityDiagnostics() {
  const host = document.querySelector("#labFluidityDiagnostics");
  const visible = Boolean(document.querySelector("#labShowFluidityDiagnostics")?.checked);
  if (!host) return;
  host.hidden = !visible;
  if (!visible) return;
  host.textContent = state.lastPlan ? JSON.stringify({
      ...measurePlaybackFluidity(state.lastPlan, { rendererFrameGaps: rendererGapMonitor.snapshot() }),
      moves: state.lastPlan.intervals.flatMap(interval => interval.moveDiagnostics.map(move => ({
        eventIndex: interval.eventIndex, code: interval.code, ...move,
      }))),
    rebounds: (state.lastTrace || []).filter(event => event.metrics?.rebound).map(event => event.metrics.rebound),
  }, null, 2) : "Resolve a possession, then reopen this disclosure to inspect its timeline.";
}
document.querySelector("#labShowFluidityDiagnostics")?.addEventListener("change", renderFluidityDiagnostics);

elements.showPatternDiagnosticsCheckbox?.addEventListener("change", renderPatternDiagnostics);
elements.showRestartRolesCheckbox?.addEventListener("change", renderTacticsBoard);
elements.restartTakerSelect?.addEventListener("change", renderTacticsBoard);
elements.restartTypeSelect?.addEventListener("change", renderRestartControls);
elements.restartTeamSelect?.addEventListener("change", () => {
  renderRestartControls();
  renderTacticsBoard();
});
elements.restartSideSelect?.addEventListener("change", () => {
  renderRestartControls();
  renderTacticsBoard();
});

elements.swapTeamsButton?.addEventListener("click", () => {
  const draft = setupDraft();
  const home = draft.home;
  const away = draft.away;
  // Swapping means each squad keeps its own shape and instructions but
  // changes ends, so both teams' slot coordinates are rebuilt for their
  // new attacking direction rather than mirrored by hand.
  const homeDirection = away.attackingDirection;
  draft.home = { ...away, team: "home", attackingDirection: homeDirection };
  draft.away = { ...home, team: "away", attackingDirection: home.attackingDirection === homeDirection
    ? (homeDirection === "up" ? "down" : "up")
    : home.attackingDirection };
  state.selectedSetupSlotId = null;
  reassignSetupTeam("home");
  reassignSetupTeam("away");
  renderMatchSetupPanel();
  renderSetupStatus("Teams swapped in the draft. Press Apply Setup to put it on the pitch.");
});

async function applyFromButton(button) {
  button.disabled = true;
  try {
    await applySetup();
  } catch (error) {
    renderSetupStatus(`Apply failed — ${error.message}. The pitch is unchanged.`, "error");
  } finally {
    button.disabled = false;
  }
}

export function tacticalDraftSlotForEntry(teamDraft, entry) {
  if (!teamDraft?.slots?.length || !entry) return null;
  const ownId = String(entry.id).startsWith(`${entry.team}-`)
    ? String(entry.id).slice(entry.team.length + 1)
    : null;
  const playerId = candidateKey(entry.player);
  // Follow the player assignment first. A formation-board shirt swap keeps
  // the live roster IDs stable, but assigns each player the other slot's
  // anchor, role and instructions when the draft is confirmed.
  return teamDraft.slots.find((item) => item.playerId === playerId)
    ?? teamDraft.slots.find((item) => item.slotId === ownId)
    ?? null;
}

function applyTacticalDraftToMatch() {
  const draft = setupDraft();
  state.marking = {
    home: normalizeTeamDefending(draft.home.marking),
    away: normalizeTeamDefending(draft.away.marking),
  };
  state.attacking = {
    home: normalizeTeamAttacking(draft.home.attacking),
    away: normalizeTeamAttacking(draft.away.attacking),
  };
  state.transition = {
    home: normalizeTeamTransition(draft.home.transition),
    away: normalizeTeamTransition(draft.away.transition),
  };
  state.cornerPlans = Object.fromEntries(["home", "away"]
    .map((team) => [team, draft[team]?.cornerPlan ?? null])
    .filter(([, plan]) => plan));
  const updateRoster = (roster = []) => {
    for (const entry of roster) {
      const teamDraft = draft[entry.team];
      if (!teamDraft) continue;
      const slot = tacticalDraftSlotForEntry(teamDraft, entry);
      if (!slot) continue;
      Object.assign(entry, {
        positionalSlot: slot.positionalSlot,
        tacticalRole: slot.tacticalRole,
        duty: slot.duty,
        shootingInstruction: slot.shootingInstruction,
        tempoInstruction: slot.tempoInstruction,
        goalkeeperDistribution: slot.goalkeeperDistribution,
        goalkeeperSweeping: slot.goalkeeperSweeping,
        withBallAnchor: slot.withBallPosition ? { ...slot.withBallPosition } : null,
        withoutBallAnchor: slot.withoutBallPosition ? { ...slot.withoutBallPosition } : null,
        withBallAnchors: Object.fromEntries(Object.entries(slot.withBallPositions ?? {}).map(([zone, point]) => [zone, { ...point }])),
        withoutBallAnchors: Object.fromEntries(Object.entries(slot.withoutBallPositions ?? {}).map(([zone, point]) => [zone, { ...point }])),
        formationAnchor: { x: slot.x, y: slot.y },
      });
    }
  };
  updateRoster(state.roster);
  updateRoster(pausedMatch?.continuation?.roster);
}

function resumeMatchAfterTactics() {
  if (!pausedMatch || !pausedTacticsConfirmed) return;
  const resume = pausedMatch;
  pausedMatch = null;
  pausedTacticsConfirmed = false;
  renderPausedTacticsActions();
  pendingTacticsTeam = null;
  activeMatchChunk = null;
  matchAutoPlay = true;
  showMainWorkspace("match");
  if (startMatchButton) startMatchButton.disabled = true;
  if (stopMatchButton) stopMatchButton.disabled = false;
  if (elements.tacticsRequestStatus) elements.tacticsRequestStatus.textContent = "Tactical changes confirmed. Play resumes from the stoppage.";
  matchSession = createMatchSession({
    simulate: createMatchChunkSimulator(state.seed, { initialElapsedMs: resume.elapsedMs }),
    initialElapsedMs: resume.elapsedMs,
    initialIndex: resume.nextIndex,
    initialContinuation: resume.continuation,
    onReady: () => { refreshHighlights(); playNextMatchChunk(); },
    onStatus: ({ error }) => {
      if (error) { if (matchStatus) matchStatus.textContent = `Match stopped: ${error.message}`; stopMatchSession(); }
    },
  });
  matchSession.start();
}

elements.applySetupButton?.addEventListener("click", () => applyFromButton(elements.applySetupButton));
elements.applyTacticsButton?.addEventListener("click", async () => {
  if (!pausedMatch) {
    await applyFromButton(elements.applyTacticsButton);
    return;
  }
  elements.applyTacticsButton.disabled = true;
  try {
    applyTacticalDraftToMatch();
    pausedTacticsConfirmed = true;
    renderPausedTacticsActions();
    if (elements.tacticsStatus) {
      elements.tacticsStatus.textContent = `Changes confirmed. Resume from ${Math.max(0, Math.ceil(pausedMatch.elapsedMs / 60000))}'.`;
    }
  } finally {
    elements.applyTacticsButton.disabled = false;
  }
});
elements.resumeMatchButton?.addEventListener("click", () => {
  if (!pausedMatch || !pausedTacticsConfirmed) return;
  elements.resumeMatchButton.disabled = true;
  resumeMatchAfterTactics();
});

function showMainWorkspace(workspace) {
  const tactics = workspace === "tactics";
  if (elements.matchWorkspace) elements.matchWorkspace.hidden = tactics;
  if (elements.tacticsWorkspace) elements.tacticsWorkspace.hidden = !tactics;
  elements.matchTab?.setAttribute("aria-selected", String(!tactics));
  elements.tacticsTab?.setAttribute("aria-selected", String(tactics));
  elements.matchTab?.classList.toggle("is-selected", !tactics);
  elements.tacticsTab?.classList.toggle("is-selected", tactics);
  if (tactics) renderMatchSetupPanel();
}
elements.matchTab?.addEventListener("click", () => {
  if (pausedMatch) {
    if (pausedTacticsConfirmed) resumeMatchAfterTactics();
    else if (elements.tacticsStatus) elements.tacticsStatus.textContent = "Confirm tactical changes before returning to the live match.";
    return;
  }
  showMainWorkspace("match");
});
elements.tacticsTab?.addEventListener("click", () => {
  if (matchSession && matchAutoPlay) requestTactics(state.setupTeamTab || "home");
  else showMainWorkspace("tactics");
});
elements.homeTacticsRequest?.addEventListener("click", () => requestTactics("home"));
elements.awayTacticsRequest?.addEventListener("click", () => requestTactics("away"));
elements.matchStatsToggle?.addEventListener("click", () => {
  const expanded = elements.matchStatsToggle.getAttribute("aria-expanded") !== "true";
  elements.matchStatsToggle.setAttribute("aria-expanded", String(expanded));
  if (elements.matchStatsPanel) elements.matchStatsPanel.hidden = !expanded;
  renderMatchTelemetry(true);
});
elements.playerStatsTab?.addEventListener("click", () => setMatchStatsView("player"));
elements.teamStatsTab?.addEventListener("click", () => setMatchStatsView("team"));
elements.statsScope?.addEventListener("change", () => renderMatchTelemetry(true));

renderMatchSetupPanel();
populateStatsScope();
renderPausedTacticsActions();
showMainWorkspace("match");


export {
  createMatchChunkSimulator,
  state,
  runConstructedPossession,
  resolvePass,
  resolveDribble,
  resolveCarry,
  resolveHold,
  updateBallCoordsLabel,
  updateStaminaBar,
  freshBurst01,
  drainOnBallAction,
  burstEffortCost,
  burstRecoveryTick,
  burstJobIntensity,
  applyBurstOffBallJob,
  downloadCurrentScenario,
  groupTraceRows,
  movementDiagnosticMarkup,
  // Match Setup Integration v1 (2026-09-04) -- exported so
  // tools/test-match-setup.mjs can drive the real integration (draft edits,
  // deterministic reassignment, atomic apply) instead of a reimplementation.
  setupDraft,
  reassignSetupTeam,
  renderTeamTacticsControls,
  renderTacticsBoard,
  renderSlotEditor,
  applySetup,
  elements,
  cancelPendingRestart,
  handleAuthoredBallMove,
  selectRestartTaker,
  restartPreviewPositions,
  buildRestartDraft,
  placeRestartParticipants,
  resolveSetupSquad,
  DEFAULT_SETUP_FORMATION,
  maybeAssignTurnoverStaminaJobs,
  BURST_BASE,
  BURST_RANGE,
  keeperWalkTarget,
  GK_HOLD_MS,
  GK_HOLD_MAX_MS,
  flightLandingVelocity,
  // Dynamic Ball Claim v2 (2026-09-04) -- exported so tools/test-ball-claim.mjs
  // can assert on the real race the engine actually ran, rather than
  // re-deriving it.
  lastBallClaimDiagnostics,
  lastJointCandidateDiagnostics,
  recordJointCandidates,
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
  renderPlaybackFrame,
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
  resolveThroughBallAccuracy,
  passFlightDurationMs,
  shotPlacementQuality,
  shotPlacementSpread,
  resolveShotDescriptor,
  simulateShotKeeperEnvelope,
  shotBlockingDefender,
  shotHeightAtProgress,
  SHOT_MOUTH_HALF_WIDTH_YARDS,
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
  // Passing v3 (2026-08-26) -- re-exported so tools/test-possession-runner.mjs
  // and tools/test-contact-continuity.mjs can exercise these directly rather
  // than reverse-engineering them from trace output alone.
  shouldLeadIntendedPoint,
  leadIntendedPoint,
  reboundConversionChance,
  attackingSettingsFor,
  setTeamInstruction,
  setupShirtNumber,
  matchPitchIsLandscape,
  matchPitchDisplayPoint,
  matchPitchWorldPoint,
};
