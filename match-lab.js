import { getDatabases, getPlayerMetrics, searchPlayers } from "./src/lib/retroballApi.js?v=20260801-65";
import {
  computePressure,
  contestedRace,
  hashString,
  headerScore,
  localizedDuel,
  playerAttribute,
  playerName,
  poacherScore,
  resolveDelivery,
  resolveEngagement,
  resolveFinishAttempt,
  resolveFoul,
  resolveFreeKickAttempt,
  resolveKeeperSave,
  resolveOneOnOne,
  resolveReceive,
  resolveShotBlock,
  resolveWall,
  seededRandom,
  selectEngagement,
  selectFinishType,
  selectFreeKickShotType,
  selectReceiver,
  transitionShotChance,
  weightedChoice,
  weightedPlayer,
} from "./src/lib/matchEngineCore.js?v=20260811-01";

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
const ROLE_LABELS = {
  attacker: "Attacker",
  receiver: "Receiver",
  defender: "Defender",
  keeper: "Keeper",
  wall: "Wall defender",
  candidate: "Pass candidate",
};

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
function resolveReboundScramble(attacker, defender, keeper, zone, random, trace) {
  const reboundDuel = localizedDuel(
    attacker.player, defender.player,
    ["Anticipation", "Acceleration", "Off the Ball"],
    ["Positioning", "Anticipation", "Strength"],
    FIXED_MINUTE, random, zone,
  );
  trace.push({
    code: reboundDuel.won ? "REBOUND.WON" : "REBOUND.LOST",
    label: reboundDuel.won
      ? `${playerName(attacker.player)} reacts fastest to the loose ball`
      : `${playerName(defender.player)} clears the danger`,
  });
  if (!reboundDuel.won) return { outcome: "NO GOAL", code: "REBOUND.LOST", resolved: true };
  const scored = random() < transitionShotChance(attacker.player, keeper.player, FIXED_MINUTE, 0.32, poacherScore);
  trace.push({
    code: scored ? "REBOUND.GOAL" : "REBOUND.MISS",
    label: scored ? `${playerName(attacker.player)} scrambles it in` : "The rebound is scrambled away",
  });
  return { outcome: scored ? "GOAL" : "NO GOAL", code: scored ? "REBOUND.GOAL" : "REBOUND.MISS", resolved: true };
}

const SCENARIOS = [
  {
    id: "cross-header",
    label: "Cross & Header",
    description: "A delivered ball into the box: aerial race, header, keeper save. Calls resolveDelivery() directly.",
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
      const delivery = resolveDelivery(receiver.player, defender.player, keeper.player, FIXED_MINUTE, random, zone);
      trace.push({
        code: delivery.code,
        label: delivery.goal
          ? `${playerName(receiver.player)} scores from the delivery`
          : delivery.rebound
            ? `${playerName(receiver.player)}'s effort spills loose`
            : `No goal -- ${playerName(defender.player)} or ${playerName(keeper.player)} deal with it`,
      });
      if (delivery.goal) return { outcome: "GOAL", code: delivery.code };
      if (!delivery.rebound) return { outcome: "NO GOAL", code: delivery.code };
      return resolveReboundScramble(receiver, defender, keeper, zone, random, trace);
    },
  },
  {
    id: "receive",
    label: "Pass Reception (P.RECEIVE)",
    description: "What a successful pass costs the receiver to control. Calls resolveReceive() directly.",
    roles: [
      { key: "receiver", count: 1 },
      { key: "defender", count: 1 },
    ],
    context: [
      { key: "passQuality", label: "Pass quality", type: "range", min: 0, max: 1, step: 0.01, default: 0.5 },
      { key: "pressure", label: "Pressure", type: "range", min: 0, max: 1, step: 0.01, default: 0.3 },
      { key: "bypass", label: "Fast/direct ball (bypass)", type: "checkbox", default: false },
    ],
    run(byRole, ctx, random, trace) {
      const receiver = byRole.receiver[0];
      const defender = byRole.defender[0];
      const zone = receiver.zone;
      const result = resolveReceive(
        receiver.player, defender.player, ctx.passQuality, ctx.pressure, ctx.bypass, zone, FIXED_MINUTE, random,
      );
      trace.push({
        code: result.context.code,
        label: `${playerName(receiver.player)}: ${result.status} (orientation ${result.context.orientation}, possession ${result.possession})`,
      });
      return { outcome: result.status.toUpperCase(), code: result.context.code };
    },
  },
  {
    id: "tackle-foul",
    label: "Tackle Engagement & Foul",
    description: "An attacker's progression duel with a defender, and -- only if the defender wins it -- the engagement flavor and any foul/card roll. Calls localizedDuel() then selectEngagement()/resolveEngagement()/resolveFoul(), matching the real tick loop's order (see draft-run.js's transitionDuel): engagement only decides the *flavor* of a win the defender has already earned upstream, so skill differences show up mainly in the duel, not the engagement step.",
    roles: [
      { key: "attacker", count: 1 },
      { key: "defender", count: 1 },
    ],
    context: [
      { key: "isLastMan", label: "Defender is the last man back", type: "checkbox", default: false },
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
        attacker.player, defender.player,
        ["Passing", "Technique", "Decisions", "Teamwork"],
        ["Positioning", "Anticipation", "Tackling", "Decisions"],
        FIXED_MINUTE, random, zone,
      );
      trace.push({
        code: "P.PROGRESS",
        label: `${playerName(attacker.player)} looks to get past ${playerName(defender.player)} (${Math.round(progressionDuel.probability * 100)}%)`,
      });
      if (progressionDuel.won) {
        trace.push({ code: "P.PROGRESS.WON", label: `${playerName(attacker.player)} beats ${playerName(defender.player)} and advances cleanly` });
        return { outcome: "ADVANCE", code: "P.PROGRESS.WON" };
      }
      const raceWasClose = progressionDuel.probability > 0.4;
      const engagementType = selectEngagement(defender.player, raceWasClose, random);
      trace.push({ code: engagementType, label: `${playerName(defender.player)} chooses ${engagementType}` });
      const engagement = resolveEngagement(engagementType, defender.player, random, zoneRow);
      trace.push({ code: engagement.code, label: `Outcome: ${engagement.outcome}` });
      if (engagement.outcome !== "foul") {
        return { outcome: engagement.outcome.toUpperCase(), code: engagement.code };
      }
      const foul = resolveFoul(defender.player, engagementType, zone, ctx.isLastMan, FIXED_MINUTE, random);
      trace.push({
        code: `CARD.${foul.card.toUpperCase()}`,
        label: `Restart: ${foul.restart}${foul.advantage ? " (advantage played)" : ""}, card: ${foul.card}`,
      });
      return { outcome: `FOUL/${foul.card.toUpperCase()}`, code: `CARD.${foul.card.toUpperCase()}` };
    },
  },
  {
    id: "shot",
    label: "Shot Resolution",
    description: "Finish type, on-target roll, keeper save -- or a breakaway one-on-one. Calls selectFinishType()/resolveFinishAttempt()/resolveKeeperSave() or resolveOneOnOne(). A placed defender (optional) contests any rebound; without one the rebound is uncontested, not fabricated.",
    roles: [
      { key: "attacker", count: 1 },
      { key: "keeper", count: 1 },
      { key: "defender", count: 0 },
    ],
    context: [
      { key: "pressure", label: "Pressure", type: "range", min: 0, max: 1, step: 0.01, default: 0.3 },
      { key: "breakaway", label: "Breakaway (no defender close)", type: "checkbox", default: false },
    ],
    run(byRole, ctx, random, trace) {
      const shooter = byRole.attacker[0];
      const keeper = byRole.keeper[0];
      const defender = (byRole.defender || [])[0] || null;
      const zone = shooter.zone;
      let save;
      if (ctx.breakaway) {
        save = resolveOneOnOne(shooter.player, keeper.player, FIXED_MINUTE, random, zone);
        trace.push({
          code: save.code,
          label: save.goal ? `${playerName(shooter.player)} finishes coolly` : `${playerName(keeper.player)} deals with it`,
        });
      } else {
        const finishType = selectFinishType(shooter.player, random, ctx.pressure);
        trace.push({ code: finishType.toUpperCase(), label: `${playerName(shooter.player)} goes for a ${finishType} finish` });
        const attempt = resolveFinishAttempt(finishType, shooter.player, random);
        trace.push({ code: attempt.code, label: attempt.onTarget ? "On target" : "Off target" });
        if (!attempt.onTarget) return { outcome: "NO GOAL", code: attempt.code };
        save = resolveKeeperSave(shooter.player, keeper.player, finishType, FIXED_MINUTE, random, zone);
        trace.push({
          code: save.code,
          label: save.goal ? `${playerName(shooter.player)} scores` : `${playerName(keeper.player)} saves it`,
        });
      }
      if (save.goal) return { outcome: "GOAL", code: save.code };
      if (!save.rebound) return { outcome: "NO GOAL", code: save.code };
      if (!defender) {
        const scored = random() < transitionShotChance(shooter.player, keeper.player, FIXED_MINUTE, 0.32, poacherScore);
        trace.push({
          code: scored ? "REBOUND.GOAL" : "REBOUND.MISS",
          label: scored ? `${playerName(shooter.player)} scrambles it in, unchallenged` : "The rebound drifts away, unchallenged",
        });
        return { outcome: scored ? "GOAL" : "NO GOAL", code: scored ? "REBOUND.GOAL" : "REBOUND.MISS" };
      }
      return resolveReboundScramble(shooter, defender, keeper, zone, random, trace);
    },
  },
  {
    id: "free-kick",
    label: "Free Kick",
    description: "Wall contact, the shot if it gets past, and a rebound scramble if the keeper spills it. Calls resolveWall(), selectFreeKickShotType()/resolveFreeKickAttempt()/resolveKeeperSave() -- same as the real tick loop, including its fixed Zone 1 keeper-save call. resolveWall() and resolveFreeKickAttempt() have no distance/angle input at all in production, so the taker's placement on the pitch doesn't change this probe's math; that's not a Match Lab omission, it's faithful to what the live engine does today.",
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
      trace.push({
        code: wall.code,
        label: wall.hit
          ? `Blocked by the wall (${wall.outcome})`
          : wallPlayers.length ? "Clears the wall" : "No wall placed -- nothing to clear",
      });
      if (wall.hit) return { outcome: `WALL/${wall.outcome.toUpperCase()}`, code: wall.code };
      const shotType = selectFreeKickShotType(taker.player, random);
      trace.push({ code: shotType.toUpperCase(), label: `${playerName(taker.player)} goes for a ${shotType} strike` });
      const attempt = resolveFreeKickAttempt(shotType, taker.player, random);
      trace.push({ code: attempt.code, label: attempt.onTarget ? "On target" : "Off target" });
      if (!attempt.onTarget) return { outcome: "NO GOAL", code: attempt.code };
      const keeperFinishType = { regular: "calm", hard: "blast", curl: "finesse" }[shotType] || "calm";
      const save = resolveKeeperSave(taker.player, keeper.player, keeperFinishType, FIXED_MINUTE, random, 1);
      trace.push({
        code: save.code,
        label: save.goal ? `${playerName(taker.player)} scores direct` : `${playerName(keeper.player)} saves it`,
      });
      if (save.goal) return { outcome: "GOAL", code: save.code };
      if (!save.rebound) return { outcome: "NO GOAL", code: save.code };
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
        const scored = random() < transitionShotChance(taker.player, keeper.player, FIXED_MINUTE, 0.32, poacherScore);
        trace.push({
          code: scored ? "REBOUND.GOAL" : "REBOUND.MISS",
          label: scored ? `${playerName(taker.player)} scrambles the rebound in, unchallenged` : "The rebound drifts away, unchallenged",
        });
        return { outcome: scored ? "GOAL" : "NO GOAL", code: scored ? "REBOUND.GOAL" : "REBOUND.MISS" };
      }
      return resolveReboundScramble(taker, reboundDefenderEntry, keeper, 1, random, trace);
    },
  },
];

// --- Free Play: action choice (new, Match-Lab-only) + resolution (real) ---

const FREE_PLAY_ACTIONS = ["pass", "cross", "dribble", "shoot", "carry"];
const FREE_PLAY_ACTION_LABELS = { pass: "Pass", cross: "Cross", dribble: "Dribble", shoot: "Shoot", carry: "Carry" };

function nearestByDistance(fromEntry, candidates) {
  if (!candidates.length) return null;
  let best = candidates[0];
  let bestDistance = Infinity;
  for (const candidate of candidates) {
    const distance = (candidate.x - fromEntry.x) ** 2 + (candidate.y - fromEntry.y) ** 2;
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }
  return best;
}

// The pitch is ~100 units in each dimension (percent). A defender on the
// opposite side of the pitch was still "the nearest" by mere elimination
// with no other opponents placed -- that isn't the same as being close
// enough to actually contest anything. Beyond this radius, treat it the
// same as no opponent being placed at all (uncontested, not fabricated).
const ENGAGEMENT_DISTANCE = 22;

function distanceBetween(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function engagingOpponent(owner, opponents) {
  const nearest = nearestByDistance(owner, opponents);
  if (!nearest) return null;
  return distanceBetween(owner, nearest) <= ENGAGEMENT_DISTANCE ? nearest : null;
}

function freePlayGroups() {
  const owner = state.roster.find((entry) => entry.id === state.ball.ownerId) || null;
  if (!owner) return { owner: null, teammates: [], opponents: [], keeper: null };
  const teammates = state.roster.filter((entry) => entry.id !== owner.id && entry.team === owner.team);
  const opposition = state.roster.filter((entry) => entry.team !== owner.team);
  const keeper = opposition.find((entry) => entry.role === "keeper") || null;
  const opponents = opposition.filter((entry) => entry !== keeper);
  return { owner, teammates, opponents, keeper };
}

// Real target selection, not array-index-zero: reuses selectReceiver() (the
// same function the tick loop uses for P.PASS) when picking among multiple
// placed teammates for a pass, and weightedPlayer()+headerScore() (the same
// pair the tick loop uses for delivery targets) for a cross -- deliberately
// different real functions for the two, since who you'd pass to short and
// who you'd aim a cross at are different questions in the real engine too.
function selectTeammateTarget(teammates, owner, pressure, random, kind) {
  if (teammates.length <= 1) return teammates[0] || null;
  const pool = teammates.map((entry) => entry.player);
  const picked = kind === "cross"
    ? weightedPlayer(pool, random, "attack", headerScore)
    : selectReceiver(pool, owner.zone, playerAttribute(owner.player, "Vision"), pressure, random);
  return teammates.find((entry) => entry.player === picked) || teammates[0];
}

// Structural availability: always computable, even for one player and a
// ball -- that's a valid state to report on, not a degraded one (see
// MATCH_LAB_PLAN.md, Phase 3 review round 6). "Unavailable" here means
// "there is nobody placed for this action to plausibly involve," not
// "the engine forbids it."
function actionAvailability(groups) {
  const { teammates, opponents, owner } = groups;
  const engager = engagingOpponent(owner, opponents);
  return {
    pass: teammates.length ? { available: true } : { available: false, reason: "no teammate" },
    cross: teammates.length ? { available: true } : { available: false, reason: "no target" },
    dribble: engager ? { available: true } : { available: false, reason: "no opponent engaging" },
    shoot: { available: true },
    carry: { available: false, reason: "not implemented in the engine yet" },
  };
}

// New, Match-Lab-only weighting -- there is no unified "which action"
// function in the real engine to call instead (see file header). Uses the
// ball owner's real attributes plus simple zone/pressure multipliers;
// illustrative, not a calibrated formula -- e.g. real crossing chances
// depend on far more than "is this player in a wide final-third zone," but
// that's the coarse signal already available here without inventing a
// geometric model this tool doesn't otherwise have (see MATCH_LAB_PLAN.md,
// "Phase 4" -- Action Geometry is the real fix, later).
function actionWeight(action, owner, info, pressure) {
  if (!info.available) return 0;
  const row = Math.floor(owner.zone / 3);
  const column = owner.zone % 3;
  const wide = column !== 1;
  const passing = playerAttribute(owner.player, "Passing");
  const crossing = playerAttribute(owner.player, "Crossing");
  const dribbling = playerAttribute(owner.player, "Dribbling");
  const finishing = playerAttribute(owner.player, "Finishing");
  const technique = playerAttribute(owner.player, "Technique");
  if (action === "pass") return passing + technique * 0.4;
  if (action === "cross") {
    const zoneFit = wide && row <= 1 ? 1.6 : row <= 1 ? 1 : 0.5;
    return Math.max(0, (crossing + technique * 0.3) * zoneFit * (1 - pressure * 0.3));
  }
  if (action === "dribble") return Math.max(0, (dribbling + technique * 0.3) * (1 - pressure * 0.4));
  if (action === "shoot") {
    const zoneFit = row === 0 ? 1.4 : row === 1 ? 0.7 : row === 2 ? 0.15 : 0.03;
    return Math.max(0, (finishing * 0.8 + technique * 0.2) * zoneFit);
  }
  return 0;
}

function actionWeights(groups) {
  const availability = actionAvailability(groups);
  const engager = groups.owner ? engagingOpponent(groups.owner, groups.opponents) : null;
  const pressure = engager ? computePressure(engager.player, groups.owner.zone, 0) : 0.1;
  const weights = {};
  for (const action of FREE_PLAY_ACTIONS) weights[action] = actionWeight(action, groups.owner, availability[action], pressure);
  return { availability, weights, pressure };
}

function selectPossessionAction(groups, random) {
  const { availability, weights } = actionWeights(groups);
  const options = FREE_PLAY_ACTIONS.map((action) => ({ value: action, weight: weights[action] }));
  const total = options.reduce((sum, option) => sum + option.weight, 0);
  const chosen = total > 0 ? weightedChoice(options, random) : null;
  return { availability, chosen };
}

function resolvePass(groups, availability, random, trace) {
  const owner = groups.owner;
  const engager = engagingOpponent(owner, groups.opponents);
  const pressure = engager ? computePressure(engager.player, owner.zone, 0) : 0.1;
  const receiver = selectTeammateTarget(groups.teammates, owner, pressure, random, "pass");
  if (!engager) {
    trace.push({
      code: "P.PASS",
      label: `${playerName(owner.player)} passes to ${playerName(receiver.player)} -- uncontested, no opponent close enough to engage`,
    });
    trace.push({ code: "P.RECEIVE.CLEAN", label: `${playerName(receiver.player)} controls it cleanly` });
    return { outcome: "CLEAN", code: "P.RECEIVE.CLEAN", resolved: true };
  }
  const duel = localizedDuel(
    owner.player, engager.player,
    ["Passing", "Technique", "Decisions", "Teamwork"],
    ["Positioning", "Anticipation", "Tackling", "Decisions"],
    FIXED_MINUTE, random, owner.zone,
  );
  trace.push({
    code: "P.PASS",
    label: `${playerName(owner.player)} attempts a pass to ${playerName(receiver.player)}, contested by ${playerName(engager.player)} (${Math.round(duel.probability * 100)}%)`,
  });
  if (!duel.won) {
    trace.push({ code: "P.PASS.LOST", label: `${playerName(engager.player)} intercepts` });
    return { outcome: "TURNOVER", code: "P.PASS.LOST", resolved: true };
  }
  const received = resolveReceive(receiver.player, engager.player, duel.probability, pressure, false, receiver.zone, FIXED_MINUTE, random);
  trace.push({ code: received.context.code, label: `${playerName(receiver.player)}: ${received.status}` });
  return { outcome: received.status.toUpperCase(), code: received.context.code, resolved: true };
}

// X1-shaped, not resolveDelivery-shaped: an open-play cross is a
// contestedRace(aerial) -> header finish -> keeper save, same as the real
// engine's X1 open-play mechanic (resolveDelivery is the *corner/set-piece*
// wrapper, with inswing/outswing texture that doesn't apply here). Skips
// the contest step when no defender is close enough to engage -- genuinely
// uncontested, not fabricated -- and reports "unresolved" rather than
// inventing a goalkeeper when the save step has nobody to resolve against.
function resolveCross(groups, availability, random, trace) {
  const owner = groups.owner;
  const defender = engagingOpponent(owner, groups.opponents);
  const pressure = defender ? computePressure(defender.player, owner.zone, 0) : 0.1;
  const receiver = selectTeammateTarget(groups.teammates, owner, pressure, random, "cross");
  const keeper = groups.keeper;
  if (defender) {
    const race = contestedRace(receiver.player, defender.player, FIXED_MINUTE, random, receiver.zone, { aerial: true });
    trace.push({
      code: race.won ? "X1.R" : "X1.D",
      label: race.won
        ? `${playerName(receiver.player)} wins the aerial ball against ${playerName(defender.player)}`
        : `${playerName(defender.player)} wins the aerial ball`,
    });
    if (!race.won) return { outcome: "NO GOAL", code: "X1.D", resolved: true };
  } else {
    trace.push({ code: "X1", label: `${playerName(receiver.player)} rises unchallenged -- no defender close enough to engage` });
  }
  const headerAttempt = resolveFinishAttempt("header", receiver.player, random, defender ? 1 : 1.15);
  trace.push({ code: headerAttempt.code, label: headerAttempt.onTarget ? "On target" : "Off target" });
  if (!headerAttempt.onTarget) return { outcome: "NO GOAL", code: headerAttempt.code, resolved: true };
  if (!keeper) {
    // No keeper placed means an actually empty net, not an ambiguous state
    // -- an on-target effort with nobody in goal is a goal, not something
    // left unresolved. "Unresolved" is for when the engine genuinely can't
    // determine an outcome (see Shoot's own no-keeper case for the same
    // fix), not a stand-in for "nobody's there to stop it."
    trace.push({ code: "EMPTY_NET", label: `${playerName(receiver.player)} finishes into an empty net -- no goalkeeper placed` });
    return { outcome: "GOAL", code: "EMPTY_NET", resolved: true };
  }
  const save = resolveKeeperSave(receiver.player, keeper.player, "header", FIXED_MINUTE, random, receiver.zone);
  trace.push({
    code: save.code,
    label: save.goal ? `${playerName(receiver.player)} scores` : `${playerName(keeper.player)} saves it`,
  });
  if (save.goal) return { outcome: "GOAL", code: save.code, resolved: true };
  if (!save.rebound) return { outcome: "NO GOAL", code: save.code, resolved: true };
  if (!defender) {
    // No opponent placed to contest the loose ball either -- uncontested,
    // same principle as the aerial race above, straight to the shot roll.
    const scored = random() < transitionShotChance(receiver.player, keeper.player, FIXED_MINUTE, 0.32, poacherScore);
    trace.push({
      code: scored ? "REBOUND.GOAL" : "REBOUND.MISS",
      label: scored ? `${playerName(receiver.player)} scrambles it in, unchallenged` : "The rebound drifts away, unchallenged",
    });
    return { outcome: scored ? "GOAL" : "NO GOAL", code: scored ? "REBOUND.GOAL" : "REBOUND.MISS", resolved: true };
  }
  return resolveReboundScramble(receiver, defender, keeper, receiver.zone, random, trace);
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
// Faithful to production, not a genuine dribbling model: this reuses the
// real engine's only generic progression duel, whose labels (Passing,
// Technique, Decisions, Teamwork) are the same ones used for a pass
// attempt too -- the live engine has no separate dribble-specific contest,
// so Dribbling/Flair/Acceleration/Balance are never read here. They ARE
// read by actionWeight()'s "dribble" case above, which decides whether the
// action gets *chosen* -- so choosing to dribble is Dribbling-weighted,
// but the resolution of that choice isn't. Real gap in what "Dribble"
// means in both the live engine and here, not something to invent a fix
// for by deviating from the real formula.
function resolveDribble(groups, availability, random, trace) {
  const owner = groups.owner;
  const defender = engagingOpponent(owner, groups.opponents);
  const progressionDuel = localizedDuel(
    owner.player, defender.player,
    ["Passing", "Technique", "Decisions", "Teamwork"],
    ["Positioning", "Anticipation", "Tackling", "Decisions"],
    FIXED_MINUTE, random, owner.zone,
  );
  trace.push({
    code: "P.PROGRESS",
    label: `${playerName(owner.player)} looks to get past ${playerName(defender.player)} (${Math.round(progressionDuel.probability * 100)}%)`,
  });
  if (progressionDuel.won) {
    trace.push({ code: "P.PROGRESS.WON", label: `${playerName(owner.player)} beats ${playerName(defender.player)} and advances cleanly` });
    return { outcome: "ADVANCE", code: "P.PROGRESS.WON", resolved: true };
  }
  const raceWasClose = progressionDuel.probability > 0.4;
  const engagementType = selectEngagement(defender.player, raceWasClose, random);
  trace.push({ code: engagementType, label: `${playerName(defender.player)} chooses ${engagementType}` });
  const engagement = resolveEngagement(engagementType, defender.player, random, Math.floor(owner.zone / 3));
  trace.push({ code: engagement.code, label: `Outcome: ${engagement.outcome}` });
  if (engagement.outcome === "foul") {
    const foul = resolveFoul(defender.player, engagementType, owner.zone, false, FIXED_MINUTE, random);
    trace.push({
      code: `CARD.${foul.card.toUpperCase()}`,
      label: `Restart: ${foul.restart}, card: ${foul.card}`,
    });
    return { outcome: `FOUL/${foul.card.toUpperCase()}`, code: `CARD.${foul.card.toUpperCase()}`, resolved: true };
  }
  return { outcome: engagement.outcome.toUpperCase(), code: engagement.code, resolved: true };
}

function resolveShoot(groups, availability, random, trace) {
  const owner = groups.owner;
  const defender = engagingOpponent(owner, groups.opponents);
  const keeper = groups.keeper;
  const pressure = defender ? computePressure(defender.player, owner.zone, 0) : 0.1;
  const finishType = selectFinishType(owner.player, random, pressure);
  trace.push({ code: finishType.toUpperCase(), label: `${playerName(owner.player)} goes for a ${finishType} finish` });
  const attempt = resolveFinishAttempt(finishType, owner.player, random);
  trace.push({ code: attempt.code, label: attempt.onTarget ? "On target" : "Off target" });
  if (!attempt.onTarget) return { outcome: "NO GOAL", code: attempt.code, resolved: true };
  if (defender) {
    const block = resolveShotBlock(defender.player, finishType, FIXED_MINUTE, random);
    if (block.blocked) {
      trace.push({ code: "D.BLOCK", label: `${playerName(defender.player)} blocks it (${block.outcome})` });
      return { outcome: `BLOCKED/${block.outcome.toUpperCase()}`, code: "D.BLOCK", resolved: true };
    }
  }
  if (!keeper) {
    // See resolveCross()'s identical fix: no keeper placed is an empty net,
    // not an ambiguous state -- an on-target, unblocked shot with nobody
    // in goal is a goal.
    trace.push({ code: "EMPTY_NET", label: `${playerName(owner.player)} finishes into an empty net -- no goalkeeper placed` });
    return { outcome: "GOAL", code: "EMPTY_NET", resolved: true };
  }
  const save = resolveKeeperSave(owner.player, keeper.player, finishType, FIXED_MINUTE, random, owner.zone);
  trace.push({
    code: save.code,
    label: save.goal ? `${playerName(owner.player)} scores` : `${playerName(keeper.player)} saves it`,
  });
  if (save.goal) return { outcome: "GOAL", code: save.code, resolved: true };
  if (!save.rebound) return { outcome: "NO GOAL", code: save.code, resolved: true };
  if (!defender) {
    const scored = random() < transitionShotChance(owner.player, keeper.player, FIXED_MINUTE, 0.32, poacherScore);
    trace.push({
      code: scored ? "REBOUND.GOAL" : "REBOUND.MISS",
      label: scored ? `${playerName(owner.player)} scrambles it in, unchallenged` : "The rebound drifts away, unchallenged",
    });
    return { outcome: scored ? "GOAL" : "NO GOAL", code: scored ? "REBOUND.GOAL" : "REBOUND.MISS", resolved: true };
  }
  return resolveReboundScramble(owner, defender, keeper, owner.zone, random, trace);
}

const FREE_PLAY_RESOLVERS = { pass: resolvePass, cross: resolveCross, dribble: resolveDribble, shoot: resolveShoot };

function runConstructedPossession(seed) {
  const random = seededRandom(hashString(`match-lab:freeplay:${seed}`));
  const trace = [];
  const groups = freePlayGroups();
  if (!groups.owner) {
    return { result: { outcome: "NO BALL OWNER", code: "NONE", resolved: false }, trace };
  }
  const { availability, chosen } = selectPossessionAction(groups, random);
  if (!chosen) {
    trace.push({ code: "ACTION.CHOICE", label: "No action is available with the current roster" });
    return { result: { outcome: "NO ACTION AVAILABLE", code: "NONE", resolved: false }, trace };
  }
  trace.push({ code: "ACTION.CHOICE", label: `${playerName(groups.owner.player)} chooses to ${chosen}` });
  const result = FREE_PLAY_RESOLVERS[chosen](groups, availability, random, trace);
  return { result, trace };
}

const elements = {
  seed: document.querySelector("#labSeed"),
  databaseSelect: document.querySelector("#labDatabaseSelect"),
  searchInput: document.querySelector("#labSearchInput"),
  searchStatus: document.querySelector("#labSearchStatus"),
  searchResults: document.querySelector("#labSearchResults"),
  pitch: document.querySelector("#labPitch"),
  roster: document.querySelector("#labRoster"),
  freePlayModeButton: document.querySelector("#labFreePlayModeButton"),
  probeModeButton: document.querySelector("#labProbeModeButton"),
  freePlayPanel: document.querySelector("#labFreePlayPanel"),
  probePanel: document.querySelector("#labProbePanel"),
  ballOwnerStatus: document.querySelector("#labBallOwnerStatus"),
  actionTable: document.querySelector("#labActionTable"),
  scenarioSelect: document.querySelector("#labScenarioSelect"),
  scenarioDescription: document.querySelector("#labScenarioDescription"),
  roleRequirements: document.querySelector("#labRoleRequirements"),
  contextControls: document.querySelector("#labContextControls"),
  playButton: document.querySelector("#labPlayButton"),
  replayButton: document.querySelector("#labReplayButton"),
  rerollButton: document.querySelector("#labRerollButton"),
  stepButton: document.querySelector("#labStepButton"),
  resetButton: document.querySelector("#labResetButton"),
  runCountInput: document.querySelector("#labRunCountInput"),
  runNButton: document.querySelector("#labRunNButton"),
  inspector: document.querySelector("#labInspector"),
  inspectorList: document.querySelector("#labInspectorList"),
  trace: document.querySelector("#labTrace"),
  traceSource: document.querySelector("#labTraceSource"),
  traceList: document.querySelector("#labTraceList"),
  distribution: document.querySelector("#labDistribution"),
  distributionCount: document.querySelector("#labDistributionCount"),
  distributionList: document.querySelector("#labDistributionList"),
};

const state = {
  mode: "freeplay", // "freeplay" | "probe"
  database: "",
  roster: [], // { id, role, team, player, x, y, zone }
  ball: { x: 50, y: 50, zone: zoneFromPercent(50, 50), ownerId: null },
  scenario: SCENARIOS[0],
  context: {},
  seed: Math.floor(Math.random() * 1_000_000),
  lastMode: null,
  lastTrace: null,
  stepIndex: 0,
  markerCounter: 0,
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
  return state.scenario.roles.every((role) => (grouped[role.key] || []).length >= role.count);
}

function currentModeIsReady() {
  return state.mode === "freeplay" ? Boolean(state.roster.find((entry) => entry.id === state.ball.ownerId)) : scenarioIsReady();
}

function runOnce(seed) {
  return state.mode === "freeplay" ? runConstructedPossession(seed) : runScenarioOnce(seed);
}

// --- Mode toggle -------------------------------------------------------

function setMode(mode) {
  state.mode = mode;
  elements.freePlayModeButton.setAttribute("aria-selected", String(mode === "freeplay"));
  elements.probeModeButton.setAttribute("aria-selected", String(mode === "probe"));
  elements.freePlayPanel.hidden = mode !== "freeplay";
  elements.probePanel.hidden = mode !== "probe";
  clearResults();
  refreshModePanel();
}

function refreshModePanel() {
  if (state.mode === "freeplay") renderActionTable();
  else renderRoleRequirements();
  elements.playButton.disabled = !currentModeIsReady();
  elements.rerollButton.disabled = !currentModeIsReady();
}

elements.freePlayModeButton.addEventListener("click", () => setMode("freeplay"));
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
      .sort((left, right) => left.season_order - right.season_order || left.title.localeCompare(right.title));
    if (!databases.length) throw new Error("No converted databases are available.");
    elements.databaseSelect.innerHTML = databases
      .map((database) => `<option value="${database.slug}">${database.title}</option>`)
      .join("");
    const latest = databases.reduce((best, database) => database.season_order > best.season_order ? database : best);
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
    const result = await searchPlayers({ database: state.database, q: query, pageSize: 20 });
    elements.searchStatus.textContent = result.items.length ? "" : "No players found.";
    elements.searchResults.innerHTML = result.items.map((item, index) => `
      <li class="match-lab-search-result">
        <span>
          <span class="match-lab-search-result-name">${playerName(item)}</span><br>
          <span class="match-lab-search-result-meta">${item.position_text || item.role || ""} · CA ${item.current_ability ?? "?"}</span>
        </span>
        <button type="button" data-add-index="${index}">Add</button>
      </li>
    `).join("");
    elements.searchResults.querySelectorAll("[data-add-index]").forEach((button) => {
      button.addEventListener("click", () => addPlayer(result.items[Number(button.dataset.addIndex)]));
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
  const grouped = rosterByRole();
  const defaultRole = state.scenario.roles.find((role) => (grouped[role.key] || []).length < role.count);
  const x = 20 + Math.random() * 60;
  const y = 20 + Math.random() * 60;
  const isFirstPlayer = state.roster.length === 0;
  const entry = {
    id: `marker-${state.markerCounter}`,
    role: defaultRole ? defaultRole.key : "candidate",
    team: "home",
    player,
    x,
    y,
    zone: zoneFromPercent(x, y),
  };
  state.roster.push(entry);
  if (isFirstPlayer && !state.ball.ownerId) giveBallTo(entry, { skipRender: true });
  renderRoster();
  renderPitch();
  renderRoleRequirements();
  renderActionTable();
  updateInspector();
}

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

function renderPitch() {
  elements.pitch.querySelectorAll(".match-lab-marker").forEach((node) => node.remove());
  for (const entry of state.roster) {
    const marker = document.createElement("div");
    marker.className = "match-lab-marker";
    marker.dataset.role = entry.role;
    marker.dataset.team = entry.team;
    marker.dataset.id = entry.id;
    marker.style.setProperty("--marker-x", `${entry.x}%`);
    marker.style.setProperty("--marker-y", `${entry.y}%`);
    marker.innerHTML = `
      <span class="match-lab-marker-dot">${initials(playerName(entry.player))}</span>
      <span class="match-lab-marker-label">${playerName(entry.player)} · Z${entry.zone}${entry.id === state.ball.ownerId ? " ⚽" : ""}</span>
    `;
    marker.addEventListener("pointerdown", (event) =>
      startDrag(event, entry, () => `${playerName(entry.player)} · Z${entry.zone}${entry.id === state.ball.ownerId ? " ⚽" : ""}`, () => {
        // Dragging a player who owns the ball carries the ball with them.
        if (entry.id === state.ball.ownerId) {
          state.ball.x = entry.x;
          state.ball.y = entry.y;
          state.ball.zone = entry.zone;
        }
      }));
    elements.pitch.appendChild(marker);
  }

  const ballMarker = document.createElement("div");
  ballMarker.className = "match-lab-marker match-lab-marker-ball";
  ballMarker.style.setProperty("--marker-x", `${state.ball.x}%`);
  ballMarker.style.setProperty("--marker-y", `${state.ball.y}%`);
  ballMarker.innerHTML = `
    <span class="match-lab-marker-dot" aria-hidden="true"></span>
    <span class="match-lab-marker-label">Ball · Z${state.ball.zone}</span>
  `;
  ballMarker.addEventListener("pointerdown", (event) =>
    startDrag(event, state.ball, () => `Ball · Z${state.ball.zone}`, () => {
      // Manually dragging the ball away detaches it -- a loose ball, not
      // still-owned-but-elsewhere.
      if (state.ball.ownerId) {
        state.ball.ownerId = null;
        renderRoster();
        renderActionTable();
      }
    }));
  elements.pitch.appendChild(ballMarker);
}

function initials(name) {
  return name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
}

function startDrag(event, entry, describeLabel, onMove) {
  event.preventDefault();
  const marker = event.currentTarget;
  marker.setPointerCapture(event.pointerId);
  const move = (moveEvent) => {
    const rect = elements.pitch.getBoundingClientRect();
    const x = Math.min(100, Math.max(0, ((moveEvent.clientX - rect.left) / rect.width) * 100));
    const y = Math.min(100, Math.max(0, ((moveEvent.clientY - rect.top) / rect.height) * 100));
    entry.x = x;
    entry.y = y;
    entry.zone = zoneFromPercent(x, y);
    marker.style.setProperty("--marker-x", `${x}%`);
    marker.style.setProperty("--marker-y", `${y}%`);
    marker.querySelector(".match-lab-marker-label").textContent = describeLabel();
    if (onMove) onMove();
    renderRoster();
    updateInspector();
    if (state.mode === "freeplay") renderActionTable();
  };
  const up = () => {
    marker.removeEventListener("pointermove", move);
    marker.removeEventListener("pointerup", up);
  };
  marker.addEventListener("pointermove", move);
  marker.addEventListener("pointerup", up);
}

// --- Roster panel -----------------------------------------------------------

function renderRoster() {
  elements.roster.innerHTML = state.roster.map((entry) => `
    <li class="match-lab-roster-item">
      <span>${playerName(entry.player)} <span class="match-lab-roster-zone">Zone ${entry.zone}</span></span>
      <select data-roster-team="${entry.id}" aria-label="Team">
        <option value="home"${entry.team === "home" ? " selected" : ""}>Home</option>
        <option value="away"${entry.team === "away" ? " selected" : ""}>Away</option>
      </select>
      <select data-roster-role="${entry.id}" aria-label="Role">
        ${Object.entries(ROLE_LABELS).map(([key, label]) =>
          `<option value="${key}"${entry.role === key ? " selected" : ""}>${label}</option>`).join("")}
      </select>
      <button
        type="button"
        class="match-lab-roster-owner-button"
        data-roster-owner="${entry.id}"
        data-owner="${entry.id === state.ball.ownerId}"
        title="Give this player the ball"
      >⚽</button>
      <button type="button" data-roster-remove="${entry.id}">✕</button>
    </li>
  `).join("");
  elements.roster.querySelectorAll("[data-roster-team]").forEach((select) => {
    select.addEventListener("change", () => {
      const entry = state.roster.find((item) => item.id === select.dataset.rosterTeam);
      if (entry) entry.team = select.value;
      renderActionTable();
      updateInspector();
    });
  });
  elements.roster.querySelectorAll("[data-roster-role]").forEach((select) => {
    select.addEventListener("change", () => {
      const entry = state.roster.find((item) => item.id === select.dataset.rosterRole);
      if (entry) entry.role = select.value;
      renderPitch();
      renderRoleRequirements();
      renderActionTable();
      updateInspector();
    });
  });
  elements.roster.querySelectorAll("[data-roster-owner]").forEach((button) => {
    button.addEventListener("click", () => {
      const entry = state.roster.find((item) => item.id === button.dataset.rosterOwner);
      if (entry) giveBallTo(entry);
    });
  });
  elements.roster.querySelectorAll("[data-roster-remove]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.rosterRemove === state.ball.ownerId) state.ball.ownerId = null;
      state.roster = state.roster.filter((item) => item.id !== button.dataset.rosterRemove);
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
  elements.scenarioSelect.innerHTML = SCENARIOS.map((scenario) =>
    `<option value="${scenario.id}">${scenario.label}</option>`).join("");
  elements.scenarioSelect.value = state.scenario.id;
}

elements.scenarioSelect.addEventListener("change", () => {
  state.scenario = SCENARIOS.find((scenario) => scenario.id === elements.scenarioSelect.value) || SCENARIOS[0];
  state.context = {};
  for (const field of state.scenario.context) state.context[field.key] = field.default;
  renderScenarioDetails();
  clearResults();
});

function renderScenarioDetails() {
  elements.scenarioDescription.textContent = state.scenario.description;
  renderRoleRequirements();
  renderContextControls();
}

function renderRoleRequirements() {
  const grouped = rosterByRole();
  elements.roleRequirements.innerHTML = state.scenario.roles.map((role) => {
    const have = (grouped[role.key] || []).length;
    const filled = have >= role.count;
    const countLabel = role.count === 0 ? `${have} (optional)` : `${have}/${role.count}`;
    return `<span class="match-lab-role-chip" data-filled="${filled}">${ROLE_LABELS[role.key]} ${countLabel}</span>`;
  }).join("");
  if (state.mode === "probe") {
    elements.playButton.disabled = !currentModeIsReady();
    elements.rerollButton.disabled = !currentModeIsReady();
  }
}

function renderContextControls() {
  elements.contextControls.innerHTML = state.scenario.context.map((field) => {
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
  }).join("");
  elements.contextControls.querySelectorAll("[data-context-key]").forEach((input) => {
    input.addEventListener("input", () => {
      const key = input.dataset.contextKey;
      state.context[key] = input.type === "checkbox" ? input.checked : Number(input.value);
      const output = elements.contextControls.querySelector(`[data-context-output="${key}"]`);
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
  const { availability, weights } = actionWeights(groups);
  const total = FREE_PLAY_ACTIONS.reduce((sum, action) => sum + weights[action], 0);
  elements.actionTable.innerHTML = FREE_PLAY_ACTIONS.map((action) => {
    const info = availability[action];
    const percent = total > 0 ? Math.round((weights[action] / total) * 100) : 0;
    return `
      <div class="match-lab-action-row" data-available="${info.available}">
        <span class="match-lab-action-row-name">${FREE_PLAY_ACTION_LABELS[action]}</span>
        <span class="match-lab-action-row-reason">${info.available ? "available" : info.reason}</span>
        <span class="match-lab-action-row-weight">${info.available ? percent + "%" : ""}</span>
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
  // Must use the same team+distance filter Free Play's own action
  // availability uses (engagingOpponent(), via freePlayGroups()) -- picking
  // "the first roster entry with role defender" regardless of team or
  // range disagreed with actionAvailability() whenever the "defender" was
  // actually a teammate or too far away to engage, showing pressure that
  // Free Play itself correctly treated as zero.
  const engager = state.mode === "freeplay" ? (() => {
    const groups = freePlayGroups();
    return groups.owner ? engagingOpponent(groups.owner, groups.opponents) : null;
  })() : (grouped.defender || [])[0];
  if (engager) {
    const pressure = computePressure(engager.player, engager.zone, 0);
    rows.push(["Pressure near " + playerName(engager.player), pressure.toFixed(2)]);
  }
  const candidates = grouped.candidate || [];
  if (candidates.length >= 2) {
    // Empirical, not analytic: samples the real selectReceiver() many times
    // rather than re-deriving its internal weight formula here, so this
    // panel can never silently drift from what the engine actually does.
    const random = seededRandom(hashString(`inspector-receiver-weights:${state.seed}`));
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
      const picked = selectReceiver(pool, targetZone, passerVision, pressureValue, random);
      hits.set(picked, (hits.get(picked) || 0) + 1);
    }
    for (const entry of candidates) {
      const share = Math.round(((hits.get(entry.player) || 0) / sampleCount) * 100);
      rows.push([`Receiver suitability sample: ${playerName(entry.player)}`, `${share}%`]);
    }
  }
  elements.inspector.hidden = rows.length === 0;
  elements.inspectorList.innerHTML = rows.map(([label, value]) => `<dt>${label}</dt><dd>${value}</dd>`).join("");
}

// --- Roll / Replay / Reroll / Step / Reset / Run N --------------------------

function runScenarioOnce(seed) {
  const random = seededRandom(hashString(`match-lab:probe:${seed}`));
  const trace = [];
  const grouped = rosterByRole();
  const result = state.scenario.run(grouped, state.context, random, trace);
  return { result, trace };
}

function renderTrace(upToIndex) {
  const trace = state.lastTrace || [];
  const visible = trace.slice(0, upToIndex);
  elements.trace.hidden = visible.length === 0;
  elements.traceSource.textContent = state.lastMode === "freeplay"
    ? "action choice: Match Lab · resolution: production engine"
    : "production engine";
  elements.traceList.innerHTML = visible.map((step) =>
    `<li><span class="match-lab-trace-code">${step.code}</span> — ${step.label}</li>`).join("");
  elements.stepButton.hidden = trace.length <= 1;
}

elements.playButton.addEventListener("click", () => {
  if (!currentModeIsReady()) return;
  elements.seed.textContent = String(state.seed);
  const { trace } = runOnce(state.seed);
  state.lastMode = state.mode;
  state.lastTrace = trace;
  state.stepIndex = trace.length;
  renderTrace(state.stepIndex);
  elements.distribution.hidden = true;
});

elements.replayButton.addEventListener("click", () => {
  if (!state.lastTrace) return;
  state.stepIndex = state.lastTrace.length;
  renderTrace(state.stepIndex);
});

elements.rerollButton.addEventListener("click", () => {
  if (!currentModeIsReady()) return;
  state.seed += 1;
  elements.seed.textContent = String(state.seed);
  const { trace } = runOnce(state.seed);
  state.lastMode = state.mode;
  state.lastTrace = trace;
  state.stepIndex = trace.length;
  renderTrace(state.stepIndex);
  elements.distribution.hidden = true;
});

elements.stepButton.addEventListener("click", () => {
  if (!state.lastTrace) return;
  if (state.stepIndex >= state.lastTrace.length) state.stepIndex = 0;
  else state.stepIndex += 1;
  renderTrace(state.stepIndex);
});

elements.resetButton.addEventListener("click", () => {
  state.roster = [];
  state.ball = { x: 50, y: 50, zone: zoneFromPercent(50, 50), ownerId: null };
  state.lastTrace = null;
  state.stepIndex = 0;
  renderRoster();
  renderPitch();
  renderRoleRequirements();
  renderActionTable();
  clearResults();
});

elements.runNButton.addEventListener("click", () => {
  if (!currentModeIsReady()) return;
  const count = Math.max(2, Math.min(2000, Number(elements.runCountInput.value) || 200));
  const tally = new Map();
  for (let index = 0; index < count; index += 1) {
    const { result } = runOnce(`${state.seed}:run:${index}`);
    tally.set(result.outcome, (tally.get(result.outcome) || 0) + 1);
  }
  const sorted = [...tally.entries()].sort((left, right) => right[1] - left[1]);
  elements.distributionCount.textContent = String(count);
  elements.distribution.hidden = false;
  elements.distributionList.innerHTML = sorted.map(([outcome, hits]) => {
    const percent = Math.round((hits / count) * 100);
    return `
      <li>
        <span>${outcome}</span>
        <span class="match-lab-distribution-bar" style="width:${Math.max(4, percent)}px"></span>
        <span>${percent}% (${hits})</span>
      </li>
    `;
  }).join("");
});

function clearResults() {
  state.lastTrace = null;
  state.stepIndex = 0;
  elements.trace.hidden = true;
  elements.stepButton.hidden = true;
  elements.distribution.hidden = true;
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
