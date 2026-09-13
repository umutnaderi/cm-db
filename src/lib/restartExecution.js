// Restart Execution v2 -- turning an authored dead ball into live play.
//
// Match Setup Integration v1 stopped at the boundary: a restart was
// authored, the ball sat on its legal spot, and Resolve & Play refused to
// run because nothing could resolve a RESTART.*.TAKE. This module is that
// missing step.
//
// DOM-free and engine-free by construction. Every actual football outcome
// is produced by the REAL resolvers, injected by the caller -- there is no
// Match-Lab-only probability formula here, and no second copy of pass
// flight, aerial contest, wall or keeper logic. What this module owns is
// only the dispatch: which real resolver a given restart runs, what it is
// told, and how the resulting transition is reported back.
//
// The one hard rule: a restart's own RESTART.*.TAKE event must be resolved
// before generic possession candidate generation may produce an
// ACTION.CHOICE. executeRestart() returns the transition that puts the ball
// into play; until it has run, the possession loop must not start.

import { yardDistance } from "./pitchGeometry.js";
import { roleBand } from "./formationTemplates.js";
import { candidateKey } from "./positionFit.js";
import { qualifiesForLongThrow, throwInRangeYards } from "./restartPreparation.js";

/** Restart type -> the required first event code. Mirrors restartSetup.js. */
export const RESTART_ACTION_CODES = Object.freeze({
  kickoff: "RESTART.KICKOFF.TAKE",
  "free-kick": "RESTART.FREE_KICK.TAKE",
  corner: "RESTART.CORNER.TAKE",
  "goal-kick": "RESTART.GOAL_KICK.TAKE",
  "throw-in": "RESTART.THROW_IN.TAKE",
});

/** The human line each restart event carries in the trace. */
function restartLabel(type, variant, takerName, targetName) {
  switch (type) {
    case "kickoff":
      return `${takerName} kicks off${targetName ? ` to ${targetName}` : ""}`;
    case "free-kick":
      return variant === "direct"
        ? `${takerName} strikes the free kick`
        : variant === "cross"
          ? `${takerName} swings the free kick in`
          : `${takerName} plays the free kick short${targetName ? ` to ${targetName}` : ""}`;
    case "corner":
      return variant === "short"
        ? `${takerName} takes the corner short${targetName ? ` to ${targetName}` : ""}`
        : `${takerName} swings the corner in`;
    case "goal-kick":
      return variant === "short"
        ? `${takerName} rolls the goal kick out${targetName ? ` to ${targetName}` : ""}`
        : `${takerName} launches the goal kick`;
    case "throw-in":
      return `${takerName} takes the throw${targetName ? ` to ${targetName}` : ""}`;
    default:
      return `${takerName} restarts play`;
  }
}

/**
 * Which real resolver a restart runs, and how it is configured.
 *
 * Everything here is a mapping decision, not a physics decision:
 *   kick-off        -- a short pass to a supporting teammate. Never a
 *                      50-yard hoof: a kick-off is a controlled touch, so
 *                      the target is the NEAREST sensible teammate rather
 *                      than the best long option.
 *   free kick       -- direct -> the shot resolver (wall + keeper are that
 *                      resolver's own job); crossed -> the cross resolver
 *                      (delivery + aerial contest + keeper); short and
 *                      play-out -> a real pass with real flight.
 *   corner          -- the cross resolver, or a real pass when taken short.
 *   goal kick       -- a real pass. Long uses a lofted profile so it is a
 *                      genuine flighted ball contested on arrival, never an
 *                      instant ground ball handed to a player id.
 *   throw-in        -- a real pass forced to the `throw` pass type, which
 *                      matchPassFlight.js already models as a slower,
 *                      arcing arm throw rather than a kicked ball.
 */
export function restartPlan({ type, variant, openingStyle = "possession", kickoffInstruction = "mixed" }) {
  switch (type) {
    case "kickoff":
      if (kickoffInstruction === "play-backwards") return { resolver: "pass", forcedPassType: null, targetPreference: "backwards" };
      if (kickoffInstruction === "build-midfield") return { resolver: "pass", forcedPassType: null, targetPreference: "midfield" };
      if (["go-wide", "switch-flank"].includes(kickoffInstruction)) return { resolver: "pass", forcedPassType: null, targetPreference: "wide" };
      if (kickoffInstruction === "target-forward") return { resolver: "pass", forcedPassType: "lofted", targetPreference: "target-forward" };
      if (kickoffInstruction === "go-long") return { resolver: "pass", forcedPassType: "lofted", targetPreference: "long" };
      if (kickoffInstruction !== "mixed") return { resolver: "pass", forcedPassType: null, targetPreference: "short" };
      if (variant === "long" || openingStyle === "direct" || openingStyle === "long-ball") {
        return { resolver: "pass", forcedPassType: "lofted", targetPreference: "long" };
      }
      if (openingStyle === "wing") {
        return { resolver: "pass", forcedPassType: null, targetPreference: "wide" };
      }
      return { resolver: "pass", forcedPassType: null, targetPreference: "short" };
    case "free-kick":
      if (variant === "cross") return { resolver: "cross", forcedPassType: null, targetPreference: "box" };
      if (variant === "short" || variant === "play-out") {
        return { resolver: "pass", forcedPassType: null, targetPreference: "short" };
      }
      return { resolver: "direct-free-kick", forcedPassType: null, targetPreference: null };
    case "corner":
      if (variant === "short") return { resolver: "pass", forcedPassType: null, targetPreference: "short" };
      return { resolver: "cross", forcedPassType: null, targetPreference: "box" };
    case "goal-kick":
      return variant === "short"
        ? { resolver: "pass", forcedPassType: null, targetPreference: "short" }
        : { resolver: "pass", forcedPassType: "lofted", targetPreference: "long" };
    case "throw-in":
      return variant === "long"
        ? { resolver: "pass", forcedPassType: "long-throw", targetPreference: "throw-long" }
        : { resolver: "pass", forcedPassType: "throw", targetPreference: "short" };
    default:
      throw new Error(`No restart plan for type "${type}".`);
  }
}

function eventMovesBall(event) {
  if (!event?.ballFrom || !event?.ballTo) return false;
  return yardDistance(event.ballFrom, event.ballTo) > 0.01;
}

/**
 * Promotes the resolver's first real kick/throw into the required restart
 * event. This keeps one physical ball flight in the tape: RESTART.*.TAKE is
 * the actual action that puts the ball in play, not a zero-duration label
 * followed by a duplicate generic pass/cross/shot animation.
 */
export function promoteRestartEvent({ restart, groups, target, events, traceEvent, playerName }) {
  const code = RESTART_ACTION_CODES[restart.type];
  if (restart.requiredFirstAction && restart.requiredFirstAction !== code) {
    throw new Error(
      `Restart ${restart.type} requires ${restart.requiredFirstAction}, not ${code}.`,
    );
  }
  const takerName = playerName(groups.owner.player);
  const targetName = target ? playerName(target.player) : "";
  const label = restartLabel(restart.type, restart.variant, takerName, targetName);
  const resolvedEvents = events ?? [];
  const physicalIndex = resolvedEvents.findIndex(eventMovesBall);

  if (physicalIndex < 0) {
    return [traceEvent(code, label, {
      actor: groups.owner,
      target: target ?? null,
      movement: restart.type === "throw-in" ? "throw" : "pass",
      outcome: "neutral",
      ballFrom: { ...restart.ball },
      ballTo: { ...restart.ball },
      ownerBefore: groups.owner,
      ownerAfter: null,
      contact: {
        point: { ...restart.ball },
        actor: groups.owner,
        type: restart.type === "throw-in" ? "throw" : "pass",
        phase: "start",
      },
      duration: 0,
    }), ...resolvedEvents];
  }

  const source = resolvedEvents[physicalIndex];
  const throwIn = restart.type === "throw-in";
  const contact = source.contact
    ? { ...source.contact, type: throwIn ? "throw" : source.contact.type }
    : {
        point: { ...restart.ball },
        actorId: groups.owner.id,
        type: throwIn ? "throw" : "pass",
        phase: "start",
        delayMs: 0,
      };
  const promoted = {
    ...source,
    code,
    label,
    actorId: groups.owner.id,
    targetId: target?.id ?? source.targetId ?? null,
    movement: throwIn ? "throw" : source.movement,
    contact,
    ownerBeforeId: groups.owner.id,
    ownerAfterId: source.ownerAfterId === undefined ? null : source.ownerAfterId,
    restartSourceCode: source.code,
    lastTouch: source.lastTouch
      ? { ...source.lastTouch, bodyPart: throwIn ? "hand" : source.lastTouch.bodyPart }
      : {
          playerId: groups.owner.id,
          team: groups.owner.team ?? null,
          bodyPart: throwIn ? "hand" : "foot",
          deliberate: true,
          restart: null,
        },
  };
  return [
    promoted,
    ...resolvedEvents.slice(0, physicalIndex),
    ...resolvedEvents.slice(physicalIndex + 1),
  ];
}

/**
 * Chooses who the restart is played to.
 *
 * Deterministic: distance-ordered within the preference, with
 * database-qualified identity as the tie-break. A restart target is a
 * football choice about DISTANCE and space, not an attribute contest --
 * the resolver that follows decides whether the ball actually arrives.
 */
export function selectRestartTarget({
  taker, teammates, preference, attackingGoalY, preferredRestartRoles = [],
}) {
  const options = (teammates ?? []).filter((entry) => entry && entry.id !== taker.id);
  if (!options.length) return null;
  const rolePreferred = preferredRestartRoles.length
    ? options.filter((entry) => preferredRestartRoles.includes(entry.restartRole))
    : [];
  const considered = rolePreferred.length ? rolePreferred : options;
  const byDistance = (left, right) =>
    yardDistance(taker, left) - yardDistance(taker, right)
    || candidateKey(left.player).localeCompare(candidateKey(right.player));

  if (preference === "short") {
    // The nearest teammate who is not the goalkeeper, so a kick-off is a
    // controlled roll to a supporting player.
    const outfield = considered.filter((entry) => entry.role !== "keeper");
    return (outfield.length ? outfield : considered).slice().sort(byDistance)[0];
  }
  if (preference === "backwards") {
    const backward = considered.filter((entry) => Math.abs(entry.y - attackingGoalY) > Math.abs(taker.y - attackingGoalY) + 3);
    return (backward.length ? backward : considered).slice().sort(byDistance)[0];
  }
  if (preference === "midfield") {
    const midfield = considered.filter((entry) => /^(DMC|MC|AMC)$/.test(entry.positionalSlot ?? ""));
    return (midfield.length ? midfield : considered).slice().sort(byDistance)[0];
  }
  if (preference === "target-forward") {
    const forwards = considered.filter((entry) => /^(FC|ST)$/.test(entry.positionalSlot ?? "") || /target/i.test(entry.tacticalRole ?? ""));
    return (forwards.length ? forwards : considered.filter((entry) => entry.role !== "keeper")).slice()
      .sort((a, b) => Number(/target/i.test(b.tacticalRole ?? "")) - Number(/target/i.test(a.tacticalRole ?? "")) || Math.abs(a.y - attackingGoalY) - Math.abs(b.y - attackingGoalY) || byDistance(a, b))[0] ?? null;
  }
  if (preference === "box") {
    // Whoever is closest to the goal being attacked -- the delivery target.
    return considered
      .filter((entry) => entry.role !== "keeper")
      .slice()
      .sort((left, right) =>
        Math.abs(left.y - attackingGoalY) - Math.abs(right.y - attackingGoalY)
        || candidateKey(left.player).localeCompare(candidateKey(right.player)))[0] ?? null;
  }
  if (preference === "long") {
    // The furthest forward outfielder: a long goal kick aims at a target
    // man, and the aerial race decides the rest.
    return considered
      .filter((entry) => entry.role !== "keeper")
      .slice()
      .sort((left, right) =>
        Math.abs(left.y - attackingGoalY) - Math.abs(right.y - attackingGoalY)
        || candidateKey(left.player).localeCompare(candidateKey(right.player)))[0] ?? null;
  }
  if (preference === "throw-long") {
    const maximum = throwInRangeYards(taker.player);
    const inRange = considered.filter((entry) => entry.role !== "keeper"
      && yardDistance(taker, entry) <= maximum);
    return (inRange.length ? inRange : considered.filter((entry) => entry.role !== "keeper"))
      .slice()
      .sort((left, right) =>
        Math.abs(left.y - attackingGoalY) - Math.abs(right.y - attackingGoalY)
        || byDistance(left, right))[0] ?? null;
  }
  if (preference === "wide") {
    // Wing opening: the widest sensible outfielder becomes the outlet;
    // stable identity breaks an exactly symmetric left/right shape.
    return considered
      .filter((entry) => entry.role !== "keeper")
      .slice()
      .sort((left, right) =>
        Math.abs(right.x - 50) - Math.abs(left.x - 50)
        || byDistance(left, right))[0] ?? null;
  }
  return considered.slice().sort(byDistance)[0];
}

function preferredRestartTargetRoles(restart) {
  if (restart?.type !== "corner") return [];
  const target = restart.corner?.delivery?.target
    ?? (restart.variant === "short" ? "short" : null);
  return ({
    short: ["short-option"],
    "near-post": ["near-post-runner"],
    "far-post": ["far-post-runner"],
    "penalty-area": ["central-runner", "box-crowd"],
    "six-yard-box": ["keeper-occupier", "central-runner"],
    "edge-of-area": ["edge-of-area"],
  })[target] ?? [];
}

/**
 * Executes one restart.
 *
 * Injected dependencies keep this module free of match-lab.js:
 *   resolvers     the real FREE_PLAY_RESOLVERS table.
 *   traceEvent    the real trace event factory.
 *   playerName    the real name reader.
 *   attackingGoalY the goal the taking team attacks, in percent.
 *
 * `groups` is the standard {owner, teammates, opponents, keeper} shape the
 * resolvers already consume, with the TAKER as owner.
 *
 * Returns the resolver's own transition result, with the restart's own
 * event already pushed to `trace` ahead of whatever the resolver adds. The
 * caller may then run the ordinary possession loop from the returned
 * nextOwnerId -- and only then.
 */
export function executeRestart({
  restart, groups, resolvers, random, trace, motionContext,
  traceEvent, playerName, attackingGoalY,
}) {
  if (!restart?.type) throw new Error("executeRestart() requires a restart specification.");
  if (!groups?.owner) throw new Error("executeRestart() requires the taker as groups.owner.");
  const effectiveRestart = restart.type === "throw-in"
    && restart.variant !== "long"
    && qualifiesForLongThrow(groups.owner.player)
    && ["direct", "long-ball"].includes(restart.openingStyle)
    ? { ...restart, variant: "long" }
    : restart;
  const plan = restartPlan(effectiveRestart);
  const resolver = resolvers[plan.resolver];
  if (!resolver) throw new Error(`Restart resolver "${plan.resolver}" is not available.`);

  const target = plan.targetPreference
    ? selectRestartTarget({
        taker: groups.owner, teammates: groups.teammates,
        preference: plan.targetPreference, attackingGoalY,
        preferredRestartRoles: preferredRestartTargetRoles(effectiveRestart),
      })
    : null;

  const availability = {
    preselectedTargetId: target ? target.id : null,
    plannedMoveTo: null,
    offside: null,
    forcedPassType: plan.forcedPassType,
    restartType: restart.type,
  };
  // The trailing `true` opts into interleaved off-ball motion, exactly as
  // runConstructedPossession()'s own resolver call does, so the restart
  // release is continuous rather than a snap.
  const resolverTrace = [];
  const result = resolver(groups, availability, random, resolverTrace, true, motionContext);
  trace.push(...promoteRestartEvent({
    restart: effectiveRestart, groups, target, events: resolverTrace, traceEvent, playerName,
  }));
  return {
    ...result,
    restartExecuted: {
      type: restart.type,
      variant: effectiveRestart.variant,
      takerId: groups.owner.id,
      targetId: target ? target.id : null,
      code: RESTART_ACTION_CODES[restart.type],
    },
  };
}

/**
 * After the restart has been taken the ball is live, so the shape that was
 * legal for a dead ball stops being the shape anyone wants to hold.
 *
 * This returns each player's RELEASE TARGET: where their open-play job
 * actually wants them, given their formation anchor and which side now has
 * the ball. Nobody is teleported -- the caller feeds these targets to the
 * ordinary off-ball motion system, so Pace and Acceleration govern the
 * travel exactly as they do everywhere else.
 *
 * The attacking side expands forward and wide from the compressed restart
 * layout; the defending side drops into its block. Both are expressed as a
 * blend toward the player's own anchor rather than a jump to it, so the
 * anchor stays a reference for shape rather than a static dot everyone is
 * dragged onto.
 */
export function restartReleaseTargets({ entries, possessionTeam, attackingDirectionByTeam }) {
  return (entries ?? []).map((entry) => {
    const anchor = entry.formationAnchor;
    if (!anchor) return { id: entry.id, target: { x: entry.x, y: entry.y } };
    const attacking = attackingDirectionByTeam?.[entry.team];
    const attackingGoalY = attacking === "up" ? 0 : 100;
    const hasBall = entry.team === possessionTeam;
    const band = roleBand(entry.positionalSlot ?? "MC");
    // The side in possession pushes ON from its anchor; the side without it
    // sits slightly deeper than its anchor. Goalkeepers do neither.
    const push = band === "GK" ? 0 : hasBall ? 0.14 : -0.06;
    const toward = (value, goal) => value + (goal - value) * push;
    return {
      id: entry.id,
      target: {
        x: anchor.x,
        y: Math.max(0, Math.min(100, toward(anchor.y, attackingGoalY))),
      },
    };
  });
}
