import { clamp, playerAttribute } from "./matchEngineCore.js";
import {
  fromYardPoint, PITCH_LENGTH_YARDS, PITCH_WIDTH_YARDS, toYardPoint,
} from "./pitchGeometry.js";

export const RESTART_PREPARATION_CODES = Object.freeze({
  place: "RESTART.PLACE_BALL",
  setPosition: "RESTART.SET_POSITION",
  scan: "RESTART.SCAN",
  signal: "RESTART.SIGNAL",
  approach: "RESTART.APPROACH",
  throwCollect: "RESTART.THROW_IN.COLLECT",
  throwHold: "RESTART.THROW_IN.HOLD",
  quick: "RESTART.QUICK",
});

const CEREMONIAL_RESTARTS = new Set(["corner", "free-kick", "goal-kick"]);

function readingScore(player) {
  return (playerAttribute(player, "Decisions") + playerAttribute(player, "Anticipation")) / 2;
}

function quickRestartChance({ type, variant, player, tempo = 3, style = "mixed" }) {
  const tempoLevel = typeof tempo === "number"
    ? tempo
    : ({ slow: 1, balanced: 3, quick: 5 }[tempo] ?? 3);
  if (type === "throw-in") {
    return clamp(0.06, 0.34, 0.12 + (readingScore(player) - 10) * 0.009
      + (tempoLevel - 3) * 0.025 + (["direct", "long-ball"].includes(style) ? 0.04 : 0));
  }
  if (type === "free-kick" && ["short", "play-out"].includes(variant)) {
    return clamp(0.04, 0.27, 0.08 + (readingScore(player) - 10) * 0.007
      + (tempoLevel - 3) * 0.02);
  }
  if (type === "corner" && variant === "short") return 0.08;
  return 0;
}

function backFromBall({ ball, attackingGoalY, type, yards }) {
  const ballYards = toYardPoint(ball);
  let unit;
  if (type === "corner" || type === "goal-kick") {
    unit = { x: 0, y: attackingGoalY === 0 ? 1 : -1 };
  } else {
    const goal = { x: PITCH_WIDTH_YARDS / 2, y: attackingGoalY === 0 ? 0 : PITCH_LENGTH_YARDS };
    const dx = ballYards.x - goal.x;
    const dy = ballYards.y - goal.y;
    const length = Math.hypot(dx, dy) || 1;
    unit = { x: dx / length, y: dy / length };
  }
  const point = fromYardPoint({
    x: clamp(0, PITCH_WIDTH_YARDS, ballYards.x + unit.x * yards),
    y: clamp(0, PITCH_LENGTH_YARDS, ballYards.y + unit.y * yards),
  });
  return { ...point, zone: ball.zone ?? null };
}

/**
 * Pure, seeded restart choreography plan. It decides presentation timing
 * only. A caller still uses the normal motion layer for every player move
 * and the normal resolver for the kick/throw and its football outcome.
 */
export function planRestartPreparation({
  restart, taker, attackingGoalY, style = "mixed", tempo = 3,
  random = () => 0.5,
} = {}) {
  if (!restart?.type || !restart?.ball || !taker) {
    throw new Error("Restart preparation requires a restart, ball and taker.");
  }
  const chance = quickRestartChance({
    type: restart.type, variant: restart.variant, player: taker.player, tempo, style,
  });
  const quick = restart.quick === true
    || (restart.quick !== false && chance > 0 && random() < chance);
  const evidence = {
    quick,
    quickChance: Number(chance.toFixed(3)),
    decisions: playerAttribute(taker.player, "Decisions"),
    anticipation: playerAttribute(taker.player, "Anticipation"),
    longThrows: playerAttribute(taker.player, "Long Throws"),
  };

  if (restart.type === "kickoff") return { quick: true, kind: "kickoff", phases: [], evidence };

  if (restart.type === "throw-in") {
    const holdMs = quick ? 280 : Math.round(680 + random() * 520);
    return {
      quick,
      kind: "throw-in",
      phases: [
        {
          code: RESTART_PREPARATION_CODES.throwCollect,
          durationMs: quick ? 260 : 420,
          action: "collect-for-throw",
          ballMode: "collect",
        },
        {
          code: quick ? RESTART_PREPARATION_CODES.quick : RESTART_PREPARATION_CODES.throwHold,
          durationMs: holdMs,
          action: "hold-and-scan",
          ballMode: "held",
        },
      ],
      evidence,
    };
  }

  if (!CEREMONIAL_RESTARTS.has(restart.type)) return { quick: true, kind: restart.type, phases: [], evidence };
  if (quick) {
    return {
      quick: true,
      kind: "quick-set-piece",
      phases: [{
        code: RESTART_PREPARATION_CODES.quick,
        durationMs: 220,
        action: "quick-restart",
        ballMode: "dead",
      }],
      evidence,
    };
  }

  const stepBackYards = 2.2 + random() * 1.25;
  const setPoint = backFromBall({
    ball: restart.ball, attackingGoalY, type: restart.type, yards: stepBackYards,
  });
  const signalRoll = random();
  const signalArms = signalRoll < 0.28 ? 2 : signalRoll < 0.62 ? 1 : 0;
  const scanMs = Math.round(650 + random() * 650);
  return {
    quick: false,
    kind: "set-piece",
    setPoint,
    phases: [
      { code: RESTART_PREPARATION_CODES.place, durationMs: 460, action: "place-ball", ballMode: "place" },
      { code: RESTART_PREPARATION_CODES.setPosition, action: "set-position", target: setPoint, ballMode: "dead" },
      {
        code: signalArms ? RESTART_PREPARATION_CODES.signal : RESTART_PREPARATION_CODES.scan,
        durationMs: scanMs,
        action: signalArms ? "signal-and-scan" : "scan",
        signalArms,
        ballMode: "dead",
      },
      { code: RESTART_PREPARATION_CODES.approach, action: "restart-approach", target: { ...restart.ball }, ballMode: "dead" },
    ],
    evidence: { ...evidence, stepBackYards: Number(stepBackYards.toFixed(2)), signalArms },
  };
}

/** Long-throw range in real yards; weak throwers still retain a legal short option. */
export function throwInRangeYards(player) {
  const longThrows = playerAttribute(player, "Long Throws");
  const strength = playerAttribute(player, "Strength");
  return clamp(14, 35, 10 + longThrows * 0.95 + strength * 0.25);
}

export function qualifiesForLongThrow(player) {
  return playerAttribute(player, "Long Throws") >= 15;
}

/** Attribute evidence and perception delay used before a restart support run. */
export function restartSupportReactionDelay(player, {
  isAttacker = true, movementKind = "support",
} = {}) {
  const values = isAttacker
    ? {
        anticipation: playerAttribute(player, "Anticipation"),
        offTheBall: playerAttribute(player, "Off The Ball", "Off the Ball"),
        workRate: playerAttribute(player, "Work Rate"),
      }
    : {
        anticipation: playerAttribute(player, "Anticipation"),
        positioning: playerAttribute(player, "Positioning"),
        marking: playerAttribute(player, "Marking"),
      };
  const rating = Object.values(values).reduce((sum, value) => sum + value, 0) / 3;
  const base = movementKind === "primary" ? 65 : 125;
  return {
    delayMs: Math.round(clamp(20, 260, base + (16 - rating) * 9)),
    values,
  };
}

const ACTIVE_ATTACK_ROLE = /runner|short-option|down-the-line|inside-option|long-target|second-ball|edge-of-area|second-taker|keeper-occupier|box-crowd/i;
const ACTIVE_DEFENCE_ROLE = /marker|guard|cover|contest|press/i;

function offsetPointYards(point, dxYards, dyYards) {
  const yards = toYardPoint(point);
  return {
    ...fromYardPoint({
      x: clamp(0, PITCH_WIDTH_YARDS, yards.x + dxYards),
      y: clamp(0, PITCH_LENGTH_YARDS, yards.y + dyYards),
    }),
    zone: point.zone ?? null,
  };
}

function towardPointYards(from, to, yards) {
  const source = toYardPoint(from);
  const target = toYardPoint(to);
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const length = Math.hypot(dx, dy) || 1;
  return offsetPointYards(from, dx / length * yards, dy / length * yards);
}

function stableSide(id) {
  const hash = [...String(id)].reduce((sum, character) => sum + character.charCodeAt(0), 0);
  return hash % 2 ? 1 : -1;
}

function cornerDeliveryTarget(restart) {
  return restart?.corner?.delivery?.target
    ?? restart?.deliveryTarget
    ?? (restart?.variant === "short" ? "short" : "penalty-area");
}

function cornerPrimaryRole(target) {
  return ({
    short: "short-option",
    "near-post": "near-post-runner",
    "far-post": "far-post-runner",
    "six-yard-box": "keeper-occupier",
    "edge-of-area": "edge-of-area",
    "penalty-area": "central-runner",
  })[target] ?? "central-runner";
}

function attackingPreparationIntent(entry, restart, attackingGoalY, scale) {
  const role = String(entry.restartRole ?? "");
  if (!ACTIVE_ATTACK_ROLE.test(role)) return null;
  const forward = attackingGoalY === 0 ? -1 : 1;
  if (restart.type === "corner") {
    const deliveryTarget = cornerDeliveryTarget(restart);
    const primaryRole = cornerPrimaryRole(deliveryTarget);
    const deliveryPoint = restart.corner?.delivery?.x != null
      ? restart.corner.delivery
      : null;
    if (role === primaryRole) {
      return {
        target: deliveryPoint && deliveryTarget !== "short"
          ? towardPointYards(entry, deliveryPoint, 2.35 * scale)
          : towardPointYards(entry, restart.ball, 1.65 * scale),
        responsibility: deliveryTarget === "short" ? "show-for-restart" : "primary-restart-run",
        movementKind: "primary",
        deliveryTarget,
      };
    }
    if (/short-option/i.test(role)) {
      return {
        target: offsetPointYards(entry, Math.sign(50 - entry.x) * 0.85 * scale, 0.25 * forward * scale),
        responsibility: "decoy-restart-run",
        movementKind: "decoy",
        deliveryTarget,
      };
    }
    if (/edge-of-area|second-ball/i.test(role)) {
      return {
        target: offsetPointYards(entry, stableSide(entry.id) * 0.8 * scale, 0.25 * forward * scale),
        responsibility: "second-ball-restart-position",
        movementKind: "second-ball",
        deliveryTarget,
      };
    }
    // Non-targeted box players pull in different directions. That occupies
    // markers and opens the selected lane without prescribing who reaches
    // the subsequent delivery.
    const awayFromAim = deliveryPoint
      ? Math.sign(entry.x - deliveryPoint.x || stableSide(entry.id))
      : stableSide(entry.id);
    return {
      target: offsetPointYards(entry, awayFromAim * 1.15 * scale, 0.65 * forward * scale),
      responsibility: "decoy-restart-run",
      movementKind: "decoy",
      deliveryTarget,
    };
  }
  if (/short-option|second-taker/i.test(role)) {
    const short = restart.type !== "free-kick" || ["short", "play-out"].includes(restart.variant);
    return {
      target: short
        ? towardPointYards(entry, restart.ball, 0.9 * scale)
        : offsetPointYards(entry, stableSide(entry.id) * 0.65 * scale, 0),
      responsibility: short ? "show-for-restart" : "decoy-restart-run",
      movementKind: short ? "short-option" : "decoy",
    };
  }
  if (/inside-option/i.test(role)) {
    return {
      target: offsetPointYards(entry, Math.sign(50 - entry.x) * 1.2 * scale, 0.25 * forward * scale),
      responsibility: "show-for-restart",
      movementKind: "support",
    };
  }
  if (/edge-of-area|second-ball/i.test(role)) {
    return {
      target: offsetPointYards(entry, stableSide(entry.id) * 0.7 * scale, 0.45 * forward * scale),
      responsibility: "second-ball-restart-position",
      movementKind: "second-ball",
    };
  }
  // A free-kick runner checks laterally before contact so this preparation
  // layer cannot silently move them beyond the kick-time offside line.
  if (restart.type === "free-kick") {
    const crossed = restart.variant === "cross";
    const primary = crossed && /near-post-runner/i.test(role);
    return {
      target: offsetPointYards(entry, stableSide(entry.id) * (primary ? 1.55 : 1.1) * scale, 0),
      responsibility: primary ? "primary-restart-run" : "decoy-restart-run",
      movementKind: primary ? "primary" : "decoy",
      deliveryTarget: crossed ? "cross" : restart.variant,
    };
  }
  return {
    target: offsetPointYards(entry, stableSide(entry.id) * 0.35 * scale, 1.6 * forward * scale),
    responsibility: "initiate-restart-run",
    movementKind: "support",
  };
}

function enforceOpponentDistance(point, ball, minimumYards) {
  const distance = Math.hypot(
    (point.x - ball.x) * PITCH_WIDTH_YARDS / 100,
    (point.y - ball.y) * PITCH_LENGTH_YARDS / 100,
  );
  if (distance >= minimumYards || distance <= 1e-9) return point;
  const ballYards = toYardPoint(ball);
  const pointYards = toYardPoint(point);
  const scale = minimumYards / distance;
  return {
    ...fromYardPoint({
      x: clamp(0, PITCH_WIDTH_YARDS, ballYards.x + (pointYards.x - ballYards.x) * scale),
      y: clamp(0, PITCH_LENGTH_YARDS, ballYards.y + (pointYards.y - ballYards.y) * scale),
    }),
    zone: point.zone ?? null,
  };
}

/**
 * Pure restart-time movement intentions for everyone except the taker.
 * Runs are deliberately small: they animate checks, feints and marking
 * handoffs before contact without resolving the set play in advance.
 */
export function planRestartSupportMovement({
  restart, roster = [], takerId, takingTeam, attackingGoalY, phase,
} = {}) {
  if (!restart?.ball || !phase || restart.penalty) return [];
  const activePhase = ["scan", "signal-and-scan", "hold-and-scan", "restart-approach"].includes(phase.action);
  if (!activePhase) return [];
  const scale = phase.action === "restart-approach" ? 1 : 0.55;
  const attackers = roster
    .filter((entry) => entry.id !== takerId && entry.team === takingTeam && entry.role !== "keeper")
    .map((entry) => ({ entry, intent: attackingPreparationIntent(entry, restart, attackingGoalY, scale) }))
    .filter((item) => item.intent?.target);
  const assignments = attackers.map(({ entry, intent }) => ({
    playerId: entry.id,
    target: intent.target,
    responsibility: intent.responsibility,
    movementKind: intent.movementKind,
    deliveryTarget: intent.deliveryTarget ?? null,
  }));

  // Goal-kick opponents must wait for the ball to be put into play. Other
  // set pieces permit tracking movement, subject to the restart distance.
  if (restart.type === "goal-kick") return assignments;
  const defenders = roster
    .filter((entry) => entry.team !== takingTeam && entry.role !== "keeper"
      && ACTIVE_DEFENCE_ROLE.test(String(entry.restartRole ?? "")));
  const available = [...attackers];
  for (const defender of defenders) {
    if (!available.length || /^wall(?:-|$)/i.test(defender.restartRole ?? "")) continue;
    const assignedIndex = defender.restartSubjectId == null
      ? -1
      : available.findIndex(({ entry }) => String(entry.id) === String(defender.restartSubjectId));
    const assigned = assignedIndex >= 0 ? available.splice(assignedIndex, 1)[0] : null;
    available.sort((left, right) => {
      const leftDistance = Math.hypot(
        (left.entry.x - defender.x) * PITCH_WIDTH_YARDS / 100,
        (left.entry.y - defender.y) * PITCH_LENGTH_YARDS / 100,
      );
      const rightDistance = Math.hypot(
        (right.entry.x - defender.x) * PITCH_WIDTH_YARDS / 100,
        (right.entry.y - defender.y) * PITCH_LENGTH_YARDS / 100,
      );
      return leftDistance - rightDistance || String(left.entry.id).localeCompare(String(right.entry.id));
    });
    const subject = assigned ?? available.shift();
    if (!subject) continue;
    const goalSide = offsetPointYards(
      subject.intent.target,
      stableSide(defender.id) * 0.25,
      (attackingGoalY === 0 ? -1 : 1) * 0.85,
    );
    const minimum = restart.type === "throw-in" ? 2.2 : 10;
    assignments.push({
      playerId: defender.id,
      target: enforceOpponentDistance(goalSide, restart.ball, minimum),
      subjectId: subject.entry.id,
      responsibility: subject.intent.movementKind === "primary"
        ? "track-primary-restart-run"
        : subject.intent.movementKind === "short-option"
          ? "cover-short-restart-option"
          : "track-decoy-restart-run",
      movementKind: "defensive-track",
      deliveryTarget: subject.intent.deliveryTarget ?? null,
    });
  }
  return assignments;
}
