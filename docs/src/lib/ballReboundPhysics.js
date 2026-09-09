import { GOAL_HEIGHT_YARDS, GOAL_WIDTH_YARDS, PITCH_WIDTH_YARDS, PITCH_LENGTH_YARDS,
  toYardPoint, fromYardPoint } from "./pitchGeometry.js";
import { rollStopDurationMs, rollTraveledYards, GROUND_FRICTION_YPS2 } from "./ballRollPhysics.js";

// Explicit model parameters, awaiting match calibration; no outcome probabilities.
export const FRAME_RESTITUTION = 0.72;
export const PARRY_RESTITUTION = 0.38;
export const TURF_RESTITUTION = 0.32;
export const GRAVITY_YPS2 = 9.80665 / 0.9144;
export const FRAME_CONTACT_RADIUS_YARDS = 0.18; // frame plus ball radius
const length = v => Math.hypot(v.x, v.y, v.z || 0);
const unit = v => { const n = length(v); if (!n) throw new Error("A contact normal must be nonzero");
  return { x: v.x / n, y: v.y / n, z: (v.z || 0) / n }; };

/** Frictionless impact: tangential velocity survives; normal velocity reverses. */
export function reflectBallVelocity(incoming, normal, restitution = FRAME_RESTITUTION) {
  const n = unit(normal);
  const dot = incoming.x * n.x + incoming.y * n.y + (incoming.z || 0) * n.z;
  const impulse = (1 + Math.max(0, Math.min(1, restitution))) * Math.min(0, dot);
  return { x: incoming.x - impulse * n.x, y: incoming.y - impulse * n.y,
    z: (incoming.z || 0) - impulse * n.z };
}

/** Goal-mouth crossing of a physical segment, in the engine's centre-plane convention. */
export function reboundGoalCrossing(from, to, goalY) {
  if (!(goalY === 0 ? from.y > 0 && to.y <= 0 : from.y < 100 && to.y >= 100)) return null;
  const ratio = (goalY - from.y) / (to.y - from.y);
  const point = { x: from.x + (to.x - from.x) * ratio, y: goalY,
    height: (from.height || 0) + ((to.height || 0) - (from.height || 0)) * ratio };
  const xYards = point.x * PITCH_WIDTH_YARDS / 100;
  return Math.abs(xYards - PITCH_WIDTH_YARDS / 2) < GOAL_WIDTH_YARDS / 2
    && point.height >= 0 && point.height < GOAL_HEIGHT_YARDS ? point : null;
}

/** The nearest physical frame surface for a keeper's already-selected frame tip. */
export function goalFrameContact({ point, goalY, incomingVelocity }) {
  const p = toYardPoint(point), height = Number(point.height) || 0;
  const left = PITCH_WIDTH_YARDS / 2 - GOAL_WIDTH_YARDS / 2;
  const right = left + GOAL_WIDTH_YARDS;
  const postX = Math.abs(p.x - left) <= Math.abs(p.x - right) ? left : right;
  const crossbar = Math.abs(height - GOAL_HEIGHT_YARDS) < Math.abs(p.x - postX);
  const sign = goalY === 0 ? 1 : -1;
  const offset = Math.max(-0.9, Math.min(0.9,
    (crossbar ? height - GOAL_HEIGHT_YARDS : p.x - postX) / FRAME_CONTACT_RADIUS_YARDS));
  const front = Math.sqrt(1 - offset * offset);
  const normal = crossbar ? { x: 0, y: sign * front, z: offset }
    : { x: offset, y: sign * front, z: 0 };
  // The selected tip approaches this surface from the field side.
  const surface = { ...fromYardPoint({
    x: crossbar ? Math.max(left, Math.min(right, p.x)) : postX + normal.x * FRAME_CONTACT_RADIUS_YARDS,
    y: goalY / 100 * PITCH_LENGTH_YARDS + normal.y * FRAME_CONTACT_RADIUS_YARDS,
  }), height: crossbar ? GOAL_HEIGHT_YARDS + normal.z * FRAME_CONTACT_RADIUS_YARDS : Math.min(GOAL_HEIGHT_YARDS, height) };
  return { kind: crossbar ? "crossbar" : "post", point: surface, normal,
    incomingVelocity: { ...incomingVelocity } };
}

// How hard a shot has to be struck before pace alone starts taking the
// direction of a parry away from the keeper, and how far they can reach
// before a save becomes a deflection rather than a placement. Both are
// expressed as loads against the keeper's own Handling below rather than as
// separate outcome tables.
export const PARRY_PACE_LOAD_YPS = 45;
export const PARRY_REACH_LOAD_YARDS = 3.5;
/** Directed control at or above this is a save the keeper steers; below it
 *  the ball goes where the collision sends it. */
export const PARRY_CONTROL_THRESHOLD = 0.3;

/**
 * A hand directs the impulse wide when the keeper can genuinely get behind
 * it, and merely deflects it when they cannot.
 *
 * Stage 4 (2026-09-06): this used to be `handling >= 12 && |lateral| < 3`,
 * a step on an attribute. Two problems. It made a Handling-11 keeper never
 * steer a parry and a Handling-12 keeper always steer one, which is not how
 * any other contest in this engine reads an attribute; and measured over
 * 4000 shots against an ordinary Handling-12 keeper it produced 792
 * parry-wide and zero parry-dangerous, so the "dangerous" branch existed in
 * the vocabulary and never once happened. Stage 4 asks for the direction to
 * follow from the save rather than from a table, so it now follows from what
 * the save actually was: the keeper's Handling, discounted by how hard the
 * ball was struck and how far they had to reach to meet it. A comfortable
 * save by a good handler still goes wide; the same keeper at full stretch
 * against a ferociously struck ball palms it back into play.
 *
 * This changes no K.SAVE.* selection weight -- which code is chosen happens
 * upstream and is untouched. Only the physical consequence of the chosen
 * save differs.
 */
export function parryBallVelocity({ incomingVelocity, point, keeperPoint, goalY, handling = 10, spilled = false }) {
  const lateral = toYardPoint(point).x - toYardPoint(keeperPoint).x;
  const side = lateral === 0 ? (incomingVelocity.x < 0 ? -1 : 1) : Math.sign(lateral);
  const paceLoad = Math.min(1, length(incomingVelocity) / PARRY_PACE_LOAD_YPS);
  const reachLoad = Math.min(1, Math.abs(lateral) / PARRY_REACH_LOAD_YARDS);
  const control = (Math.max(0, Math.min(20, handling)) / 20)
    * (1 - 0.55 * paceLoad) * (1 - 0.6 * reachLoad);
  const wide = !spilled && control >= PARRY_CONTROL_THRESHOLD;
  const direction = unit({ x: side * (wide ? 0.94 : 0.22), y: (goalY === 0 ? 1 : -1) * (wide ? 0.34 : 0.98), z: -0.12 });
  const speed = length(incomingVelocity) * (spilled ? 0.18 : PARRY_RESTITUTION);
  return { kind: wide ? "parry-wide" : spilled ? "spill-dangerous" : "parry-dangerous",
    velocity: { x: direction.x * speed, y: direction.y * speed, z: direction.z * speed },
    restitution: spilled ? 0.18 : PARRY_RESTITUTION };
}

/** One independent rebound: gravity to turf, diminishing bounces, then shared roll. */
export function projectRebound({ from, velocity, sampleMs = 20 }) {
  if (![from?.x, from?.y, velocity?.x, velocity?.y, velocity?.z ?? 0].every(Number.isFinite)) throw new Error("Rebound inputs must be finite");
  sampleMs = Number.isFinite(sampleMs) ? Math.max(1, sampleMs) : 20;
  let origin = { ...toYardPoint(from), z: Math.max(0, Number(from.height) || 0) };
  let current = { x: velocity.x, y: velocity.y, z: velocity.z || 0 }, elapsedMs = 0;
  const samples = [], contacts = [];
  const append = (timeMs, p, v, mode) => {
    const sample = { timeMs, position: { ...fromYardPoint(p), height: Math.max(0, p.z) },
      velocity: { x: v.x / PITCH_WIDTH_YARDS / 10, y: v.y / PITCH_LENGTH_YARDS / 10 },
      verticalVelocity: v.z / 1000, mode };
    if (samples.at(-1)?.timeMs === timeMs) samples[samples.length - 1] = sample;
    else samples.push(sample);
  };
  for (let bounce = 0; bounce < 8 && (origin.z > 0.001 || current.z > 0.3); bounce++) {
    const seconds = (current.z + Math.sqrt(current.z ** 2 + 2 * GRAVITY_YPS2 * origin.z)) / GRAVITY_YPS2;
    const span = seconds * 1000;
    const at = ms => { const t = ms / 1000;
      return { x: origin.x + current.x * t, y: origin.y + current.y * t,
        z: origin.z + current.z * t - 0.5 * GRAVITY_YPS2 * t * t }; };
    for (let ms = 0; ms < span; ms += sampleMs) append(elapsedMs + ms, at(ms),
      { ...current, z: current.z - GRAVITY_YPS2 * ms / 1000 }, "airborne");
    origin = { ...at(span), z: 0 };
    elapsedMs += span;
    const incoming = { ...current, z: current.z - GRAVITY_YPS2 * seconds };
    current = reflectBallVelocity(incoming, { x: 0, y: 0, z: 1 }, TURF_RESTITUTION);
    contacts.push({ timeMs: elapsedMs, type: "turf", point: { ...fromYardPoint(origin), height: 0 }, incoming, outgoing: { ...current } });
  }
  current.z = 0;
  const rollStartMs = elapsedMs, rollFrom = { ...fromYardPoint(origin), height: 0 };
  const speedYps = Math.hypot(current.x, current.y), stopMs = rollStopDurationMs(speedYps);
  const sampleRoll = ms => {
    const d = rollTraveledYards(speedYps, ms), ratio = speedYps ? d / speedYps : 0;
    const remaining = speedYps ? Math.max(0, speedYps - GROUND_FRICTION_YPS2 * ms / 1000) / speedYps : 0;
    append(elapsedMs + ms, { x: origin.x + current.x * ratio, y: origin.y + current.y * ratio, z: 0 },
      { x: current.x * remaining, y: current.y * remaining, z: 0 }, "rolling");
  };
  for (let ms = 0; ms < stopMs; ms += sampleMs) sampleRoll(ms);
  sampleRoll(stopMs);
  const durationMs = elapsedMs + stopMs;
  return { durationMs, samples: samples.map(s => ({ ...s, progress: durationMs ? s.timeMs / durationMs : 1 })),
    contacts, rollStartMs, rollFrom, rollVelocity: { ...current }, speedYps,
    endpoint: samples.at(-1).position };
}
