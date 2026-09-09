import { PITCH_WIDTH_YARDS, PITCH_LENGTH_YARDS, toYardPoint, fromYardPoint } from "./pitchGeometry.js";

// Body separation targets (2026-09-06).
// This pure geometry helper proposes non-overlapping destinations. It does
// not advance bodies, carry velocity, or guarantee collision-free travel.
// Callers must pass its targets through worldMotion in the real available
// interval. Applying the returned points directly to a contact scan or a
// sampled frame creates unauthored movement and hides physical overlaps.
// Unlike the eight-yard same-team spacing preference, these targets account
// for both teams and a 0.9-yard centre separation. Anchored obstacles stay put.

/**
 * Half a player's shoulder width, in yards. A real adult is roughly 0.5
 * yards across the shoulders, so 0.45 leaves two bodies at 0.9 yards
 * centre-to-centre -- touching, which is exactly what a shoulder-to-shoulder
 * duel looks like, without overlapping.
 */
export const PLAYER_BODY_RADIUS_YARDS = 0.45;

/** Closest two player centres may ever be. */
export const BODY_MIN_SEPARATION_YARDS = PLAYER_BODY_RADIUS_YARDS * 2;

/**
 * Maximum relaxation passes.
 *
 * Each pass corrects every pair by exactly its own measured overlap -- no
 * over-relaxation. Pushing harder than the overlap does converge chains far
 * faster, but it overshoots: measured, a simple two-body overlap settled 1.45
 * yards apart instead of 0.9, which would visibly hold a closing defender off
 * their man. Exact geometry is worth more here than worst-case speed.
 *
 * The cost of exactness is that a CHAIN -- a queue of players strung out nose
 * to tail, each overlapping only its neighbours -- propagates one link per
 * pass. Measured worst case, 22 players in a line 0.06 yards apart: 477
 * passes, about a millisecond, and a state that cannot arise once this
 * constraint is actually being applied. Everything realistic settles in one
 * or two: a scattered crowd in 1, a whole squad stacked on one coordinate in
 * 1, a tight 5-wide grid in 2. The loop stops the moment a pass finds nothing
 * to correct, so an already-legal shape costs one pass and no writes at all.
 */
const RELAXATION_PASSES = 512;

/** Below this, two points count as exactly coincident and need a tie-break. */
const COINCIDENT_EPSILON = 1e-3;

/**
 * Correcting a pair sets them exactly on the minimum, which another pair in
 * the same pass can then nudge back inside by a hair. Aiming a few
 * millimetres past the minimum means the solver settles just OUTSIDE the
 * constraint rather than approaching it from the wrong side, so the result
 * genuinely satisfies it rather than very nearly satisfying it.
 */
const SEPARATION_SLACK_YARDS = 5e-3;


function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clampToPitch(yardPoint) {
  return {
    x: Math.min(PITCH_WIDTH_YARDS, Math.max(0, yardPoint.x)),
    y: Math.min(PITCH_LENGTH_YARDS, Math.max(0, yardPoint.y)),
  };
}

/** Deterministic 0..1 from a string. No RNG: the same crowd always resolves
 *  the same way, which is what keeps a replay a replay. */
function hash01(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) % 100000) / 100000;
}

/**
 * Direction to push `a` away from `b` when they are exactly coincident.
 *
 * Exact overlap has no geometric direction, so one has to be chosen. The
 * axis is derived from the PAIR's own ids, not from a fixed axis: a fixed
 * one (the first attempt here) makes every coincident pair separate along
 * the same line, so a genuine pile-up -- 22 players stacked on the centre
 * spot, which is exactly the state that prompted this module -- collapses
 * into a single row and re-collides on every pass instead of dispersing.
 * Ordering by id keeps the push equal and opposite, and free of any
 * dependence on roster order, which is the class of bug this module exists
 * to end.
 */
function tieBreakUnit(idA, idB) {
  const low = String(idA) < String(idB) ? String(idA) : String(idB);
  const high = String(idA) < String(idB) ? String(idB) : String(idA);
  const angle = hash01(`${low}|${high}`) * Math.PI * 2;
  const sign = String(idA) === low ? -1 : 1;
  return { x: Math.cos(angle) * sign, y: Math.sin(angle) * sign };
}

/**
 * Pushes overlapping bodies apart.
 *
 * `bodies` is `[{ id, x, y }]` in the usual 0-100 percentage grid the rest of
 * the engine passes points around in; the constraint itself is solved in
 * yards, because the pitch is not square and a percentage-space radius would
 * be a different real distance across than along.
 *
 * `anchoredIds` names bodies that must not be moved -- the player who has
 * just made contact with the ball, a restart taker on a placed spot, a keeper
 * on their line. Anyone overlapping an anchored body yields the full
 * displacement instead of sharing it. Two anchored bodies are left alone:
 * this module never overrides an explicit placement.
 *
 * Returns a NEW array in the input order, each entry `{ id, x, y }` (plus any
 * other fields the input carried, preserved). Nothing is mutated.
 */
export function resolveBodyOverlaps(bodies = [], { anchoredIds = [] } = {}) {
  if (bodies.length < 2) return bodies.map((body) => ({ ...body }));
  const anchored = new Set(anchoredIds.map((id) => String(id)));
  const isAnchored = (body) => anchored.has(String(body.id));
  const points = bodies.map((body) => toYardPoint({ x: finite(body.x), y: finite(body.y) }));
  // Whether this body was ever actually pushed. A body nobody collided with
  // must come back with its ORIGINAL coordinates, not a yard round-trip of
  // them -- otherwise every call rewrites all 22 positions by a float hair,
  // and callers that legitimately compare "did this change?" all see noise.
  const displaced = bodies.map(() => false);

  // Jacobi relaxation, deliberately, rather than a pairwise sweep that
  // updates in place: every pair is measured against the SAME snapshot and
  // all the corrections land together, so the result does not depend on the
  // order the caller happened to list bodies in. An in-place sweep resolves
  // the same crowd differently depending on roster order, and roster order
  // deciding where a player physically stands is the class of bug this
  // module exists to end.
  for (let pass = 0; pass < RELAXATION_PASSES; pass += 1) {
    const offsets = bodies.map(() => ({ x: 0, y: 0 }));
    let moved = false;
    for (let i = 0; i < bodies.length; i += 1) {
      for (let j = i + 1; j < bodies.length; j += 1) {
        const anchoredA = isAnchored(bodies[i]);
        const anchoredB = isAnchored(bodies[j]);
        if (anchoredA && anchoredB) continue;
        const dx = points[i].x - points[j].x;
        const dy = points[i].y - points[j].y;
        const distance = Math.hypot(dx, dy);
        if (distance >= BODY_MIN_SEPARATION_YARDS) continue;
        const separation = BODY_MIN_SEPARATION_YARDS + SEPARATION_SLACK_YARDS;
        const unit = distance > COINCIDENT_EPSILON
          ? { x: dx / distance, y: dy / distance }
          : tieBreakUnit(bodies[i].id, bodies[j].id);
        const overlap = separation - distance;
        // A body pinned in place cannot absorb any of the correction, so the
        // other one takes all of it; otherwise both give half.
        const shareA = anchoredB ? 1 : anchoredA ? 0 : 0.5;
        const shareB = 1 - shareA;
        offsets[i].x += unit.x * overlap * shareA;
        offsets[i].y += unit.y * overlap * shareA;
        offsets[j].x -= unit.x * overlap * shareB;
        offsets[j].y -= unit.y * overlap * shareB;
        moved = true;
      }
    }
    if (!moved) break;
    for (let i = 0; i < bodies.length; i += 1) {
      if (offsets[i].x === 0 && offsets[i].y === 0) continue;
      points[i] = clampToPitch({ x: points[i].x + offsets[i].x, y: points[i].y + offsets[i].y });
      displaced[i] = true;
    }
  }

  return bodies.map((body, index) => (
    displaced[index] ? { ...body, ...fromYardPoint(points[index]) } : { ...body }
  ));
}

/**
 * The in-place twin for the tick loops that keep a `{ [id]: point }` map
 * rather than an array (simulateFlightUntilContact()'s own `positions`, and
 * anything else sampling continuous motion). Returns a NEW map; the caller's
 * is untouched.
 */
export function resolveBodyOverlapsById(positions = {}, options = {}) {
  const entries = Object.entries(positions);
  if (entries.length < 2) {
    return Object.fromEntries(entries.map(([id, point]) => [id, { ...point }]));
  }
  const resolved = resolveBodyOverlaps(
    entries.map(([id, point]) => ({ id, ...point })),
    options,
  );
  return Object.fromEntries(resolved.map((body) => {
    const { id, ...point } = body;
    return [id, point];
  }));
}
