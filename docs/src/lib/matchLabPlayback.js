import {
  contactArrivalTiming, movementDistanceYards,
} from "./matchMovementTiming.js";
import { timeToReach, topSpeed } from "./playerKinetics.js";
import { auditMoveSpeed, speedYpsFromVelocity } from "./worldMotion.js";
import { playerAttribute } from "./matchEngineCore.js";
import { timeToTopSpeed } from "./playerKinetics.js";

const EPSILON = 0.001;
export const MATCH_LAB_PLAYBACK_BUILD = "20260908-01";

function clonePoint(point) {
  return point ? {
    x: Number(point.x), y: Number(point.y), zone: point.zone ?? null,
    ...(point.height !== undefined ? { height: Number(point.height) || 0 } : {}),
  } : null;
}

function samePoint(left, right, tolerance = EPSILON) {
  return Boolean(left && right)
    && Math.abs(left.x - right.x) <= tolerance
    && Math.abs(left.y - right.y) <= tolerance;
}

function lerpPoint(from, to, ratio) {
  if (!from) return clonePoint(to);
  if (!to) return clonePoint(from);
  return {
    x: from.x + ((to.x - from.x) * ratio),
    y: from.y + ((to.y - from.y) * ratio),
    ...(from.height !== undefined || to.height !== undefined
      ? { height: (from.height || 0) + (((to.height || 0) - (from.height || 0)) * ratio) }
      : {}),
    zone: ratio >= 1 ? (to.zone ?? from.zone ?? null) : (from.zone ?? to.zone ?? null),
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

// Single-Trajectory Arbitration v1 (2026-09-04)
// ---------------------------------------------
// A player may have at most ONE authoritative movement segment running at
// any instant. Before this existed, World Motion Contract v1's fix (an
// overlapping reaction is no longer time-compressed into the window it
// overlaps, so a real 1.9s recovery run keeps its 1.9s) had a second-order
// consequence nothing handled: the NEXT action starts while that run is
// still going, its own DEF.ADJUST batch authors ANOTHER movement for the
// same player, and both clips' keyframes were kept and sorted into one
// track. The result is a track that alternates between two trajectories:
//
//   t=100 x=0.88   t=250 x=2.50   t=350 x=0.66   t=500 x=5.00 ...
//
// which renders as the reported heavy twitching -- nudge forward, yank
// back, nudge forward. It is not an easing or CSS problem and must not be
// "fixed" by re-clamping the long clip back into the short window, which
// simply reinstates the 189 yd/s teleport that work removed.
//
// Two outcomes, decided here and nowhere else:
//
//  - CONTINUE: the player is already running this same action to
//    materially the same place. Keep the existing segment; do not author
//    a competing clip.
//  - SUPERSEDE: the intent or the target genuinely changed. Sample where
//    the player actually IS (and how fast they are moving) at the new
//    move's start time, drop every keyframe of the old segment after that
//    instant, and let the replacement start from that sampled state --
//    never from the old segment's future endpoint, which the playback
//    clock had not reached.
//
// This is arbitration of conflicting authoritative segments, not a
// gameplay decision: no randomness, no new targets, no outcome changes.
// The endpoint each clip is asked to reach is still exactly the one the
// engine committed.
const CONTINUE_SAME_TARGET_TOLERANCE = 0.6;

function arbitrateSegment({ segments, track, id, moveStart, moveEnd, scheduledTo, action, eventIndex }) {
  const list = segments[id] || (segments[id] = []);
  const active = list.length ? list[list.length - 1] : null;
  const conflicts = Boolean(active) && moveStart < active.endMs - EPSILON;
  if (!conflicts) {
    list.push({ startMs: moveStart, endMs: moveEnd, eventIndex, action, to: clonePoint(scheduledTo) });
    return { mode: "fresh", segment: list[list.length - 1], sampledPosition: null, sampledVelocity: null };
  }

  const sameIntent = active.action === action;
  const sameTarget = Boolean(active.to) && Boolean(scheduledTo)
    && movementDistanceYards(active.to, scheduledTo) <= CONTINUE_SAME_TARGET_TOLERANCE;
  if (sameIntent && sameTarget) {
    active.endMs = Math.max(active.endMs, moveEnd);
    active.to = clonePoint(scheduledTo);
    return { mode: "continue", segment: active, sampledPosition: null, sampledVelocity: null };
  }

  // Supersede. Sample BEFORE truncating -- this is the player's genuine
  // position and momentum at the instant the new intention takes over.
  const sorted = track.slice().sort((left, right) => left.timeMs - right.timeMs);
  const sampled = sampleTrack(sorted, moveStart);
  const sampledPosition = sampled?.position ? clonePoint(sampled.position) : null;
  const sampledVelocity = sampled?.velocity
    ? { x: Number(sampled.velocity.x) || 0, y: Number(sampled.velocity.y) || 0 }
    : null;
  // Drop the superseded run's future. Re-sorted on the way back in: an
  // overlapping clip can append keyframes EARLIER than ones already in the
  // array, and everything downstream (including the next sampleTrack call)
  // reads this as an ordered track.
  const retained = sorted.filter((frame) => frame.timeMs <= moveStart + EPSILON);
  track.length = 0;
  track.push(...retained);
  active.endMs = moveStart;
  active.superseded = true;
  list.push({
    startMs: moveStart, endMs: moveEnd, eventIndex, action,
    to: clonePoint(scheduledTo), supersededPrevious: true,
  });
  return { mode: "supersede", segment: list[list.length - 1], sampledPosition, sampledVelocity };
}

function appendKeyframe(track, frame) {
  const next = {
    ...frame,
    position: clonePoint(frame.position),
    velocity: frame.velocity ? { x: Number(frame.velocity.x) || 0, y: Number(frame.velocity.y) || 0 } : null,
  };
  const last = track[track.length - 1];
  if (last && Math.abs(last.timeMs - next.timeMs) <= EPSILON) {
    track[track.length - 1] = next;
    return;
  }
  track.push(next);
}

function normalizeTrack(track) {
  track.sort((a, b) => a.timeMs - b.timeMs || a.eventIndex - b.eventIndex);
  const normalized = [];
  for (const frame of track) {
    if (normalized.length && Math.abs(normalized[normalized.length - 1].timeMs - frame.timeMs) <= EPSILON) {
      normalized[normalized.length - 1] = frame;
    } else {
      normalized.push(frame);
    }
  }
  return normalized;
}

// A back-to-back chain of hermite segments for the same player (a
// defender re-adjusting on every touch of a multi-touch carry, say)
// should carry momentum smoothly through each junction -- forcing
// velocity to zero at every single segment boundary made every
// individual touch/reaction visibly decelerate to a full stop and
// re-accelerate from rest, a constant stutter across what should read
// as one continuous run ("stop and play" motion, 2026-08-21). But a
// genuine idle gap -- this player doesn't move again for a while --
// still needs zero velocity on both sides of it: hermite's h10/h11
// terms scale by the SEGMENT'S OWN span, and a real gap (hundreds of ms
// to seconds) combined with a nonzero tangent sized for a much shorter
// original span produces a wild, visible overshoot/"drift" mid-gap even
// when both endpoints sit at the exact same position -- the original
// bug the old unconditional zeroing existed to prevent (see
// buildMatchLabPlaybackPlan()'s own comment on the hermite append
// above). So: zero velocity only across gaps wide enough to be a
// genuine idle period, not at every junction unconditionally. Must run
// on the SORTED, deduped track (post-normalizeTrack) -- the raw
// append-order array can't be walked pairwise for real time gaps.
//
// Gameplay v3 (2026-08-28) -- this constant's own comment already said
// "comfortably above a single touch's own ~220ms," but the number
// itself was still 60: BELOW a single touch, so almost every genuine
// touch-to-touch or action-to-reaction join (all in the 220-700ms range,
// see MOVEMENT_DURATIONS) still tripped it and zeroed anyway -- the
// exact reported "run-go-run-go" strobe, just moved from the resolver
// layer (already fixed -- resolveCarry()/resolveDribble() now emit ONE
// continuous off-ball call per phase, not one per touch) down into this
// one, still-unconditional playback constant. Raised to genuinely sit
// above ordinary action/reaction durations, so consecutive clips for the
// SAME player within one live phase inherit velocity through the join
// (nothing here needs to actively "pass velocity forward" -- not
// zeroing is what lets whatever real tangent each keyframe already
// carries stand). Contact-pin (a receive/tackle/save keyframe that must
// land exactly on the ball) is untouched by this constant -- that's a
// position pin enforced elsewhere, not a velocity decision.
const IDLE_GAP_THRESHOLD_MS = 450;
function zeroVelocityAcrossIdleGaps(track) {
  for (let index = 1; index < track.length; index += 1) {
    const previous = track[index - 1];
    const current = track[index];
    if (!previous.velocity && !current.velocity) continue;
    if (current.timeMs - previous.timeMs > IDLE_GAP_THRESHOLD_MS) {
      if (previous.velocity) previous.velocity = { x: 0, y: 0 };
      if (current.velocity) current.velocity = { x: 0, y: 0 };
    }
  }
  return track;
}

function distance(from, to) {
  return Math.hypot((to?.x ?? 0) - (from?.x ?? 0), (to?.y ?? 0) - (from?.y ?? 0));
}

function hermiteTrackPoint(previous, next, spanMs, ratio) {
  const t2 = ratio * ratio;
  const t3 = t2 * ratio;
  const h00 = 2 * t3 - 3 * t2 + 1;
  const h10 = t3 - 2 * t2 + ratio;
  const h01 = -2 * t3 + 3 * t2;
  const h11 = t3 - t2;
  return {
    x: h00 * previous.position.x + h10 * previous.velocity.x * spanMs
      + h01 * next.position.x + h11 * next.velocity.x * spanMs,
    y: h00 * previous.position.y + h10 * previous.velocity.y * spanMs
      + h01 * next.position.y + h11 * next.velocity.y * spanMs,
    zone: ratio >= 1
      ? (next.position.zone ?? previous.position.zone ?? null)
      : (previous.position.zone ?? next.position.zone ?? null),
  };
}

function segmentPath(event) {
  if (event.pathSegments?.length) return event.pathSegments.map(clonePoint);
  if (event.ballFrom && event.ballTo && event.movement === "shot" && event.strikingFoot && event.contactType) {
    const from = clonePoint(event.ballFrom);
    const to = clonePoint(event.ballTo);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const length = Math.hypot(dx, dy);
    const magnitude = { inside: 0.22, outside: 0.22, laces: 0.05 }[event.contactType] ?? 0;
    const sign = (event.strikingFoot === "right" ? 1 : -1) * (event.contactType === "outside" ? -1 : 1);
    const control = length > 0 ? {
      x: (from.x + to.x) / 2 + (dy / length) * magnitude * sign * length,
      y: (from.y + to.y) / 2 - (dx / length) * magnitude * sign * length,
      zone: from.zone,
    } : from;
    return Array.from({ length: 9 }, (_, index) => {
      const t = index / 8;
      const u = 1 - t;
      return {
        x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
        y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
        zone: index === 8 ? to.zone : from.zone,
      };
    });
  }
  if (event.ballFrom && event.ballTo) return [clonePoint(event.ballFrom), clonePoint(event.ballTo)];
  return [];
}

function addBallPath(track, path, startMs, endMs, eventIndex, state) {
  if (path.length === 0) return;
  if (track.length) {
    const previous = track[track.length - 1];
    if (!samePoint(previous.position, path[0])) {
      throw new Error(`Ball discontinuity before event ${eventIndex}: (${previous.position.x},${previous.position.y}) -> (${path[0].x},${path[0].y})`);
    }
  }
  if (!track.length) appendKeyframe(track, { timeMs: startMs, position: path[0], state, eventIndex });
  else if (track[track.length - 1].timeMs < startMs - EPSILON) {
    appendKeyframe(track, { timeMs: startMs, position: path[0], state: "held", eventIndex });
  }
  if (path.length === 1 || samePoint(path[0], path[path.length - 1]) && path.every((point) => samePoint(point, path[0]))) {
    appendKeyframe(track, { timeMs: endMs, position: path[path.length - 1], state, eventIndex });
    return;
  }
  const lengths = path.slice(1).map((point, index) => distance(path[index], point));
  const total = lengths.reduce((sum, value) => sum + value, 0) || lengths.length;
  let elapsed = 0;
  for (let index = 1; index < path.length; index += 1) {
    elapsed += lengths[index - 1] || 1;
    appendKeyframe(track, {
      timeMs: index === path.length - 1 ? endMs : startMs + ((endMs - startMs) * elapsed / total),
      position: path[index], state, eventIndex,
    });
  }
}

function addBallTrajectory(track, trajectory, startMs, endMs, eventIndex, fallbackState) {
  const samples = trajectory
    .filter((sample) => Number.isFinite(sample.progress) && sample.position)
    .slice()
    .sort((left, right) => left.progress - right.progress);
  if (samples.length < 2) return false;
  if (track.length) {
    const previous = track[track.length - 1];
    if (!samePoint(previous.position, samples[0].position)) {
      throw new Error(`Ball discontinuity before event ${eventIndex}: (${previous.position.x},${previous.position.y}) -> (${samples[0].position.x},${samples[0].position.y})`);
    }
  }
  if (track.length && track[track.length - 1].timeMs < startMs - EPSILON) {
    appendKeyframe(track, {
      timeMs: startMs, position: samples[0].position,
      state: track[track.length - 1].state ?? "resting", eventIndex,
    });
  }
  for (const sample of samples) {
    const progress = Math.max(0, Math.min(1, sample.progress));
    appendKeyframe(track, {
      timeMs: startMs + (endMs - startMs) * progress,
      position: sample.position,
      velocity: sample.velocity,
      verticalVelocity: Number(sample.verticalVelocity) || 0,
      state: sample.mode ?? fallbackState,
      eventIndex,
    });
  }
  return true;
}

function initialPlayerMap(initialPositions) {
  if (initialPositions instanceof Map) return Object.fromEntries([...initialPositions].map(([id, point]) => [id, clonePoint(point)]));
  if (Array.isArray(initialPositions)) {
    return Object.fromEntries(initialPositions.map((entry) => [entry.id, clonePoint(entry.position ?? entry)]));
  }
  return Object.fromEntries(Object.entries(initialPositions || {}).map(([id, point]) => [id, clonePoint(point)]));
}

/**
 * Converts an already-resolved trace into an immutable, renderer-independent
 * timeline. It never calls RNG and never derives contacts or ownership from
 * labels/proximity: those facts must be supplied by the resolver event.
 */
export function buildMatchLabPlaybackPlan({
  trace = [], initialPositions = {}, initialBall = null, initialOwnerId = null,
  finalOwnerId = undefined, restart = undefined, playerProfiles = {},
  // Stamina Bars v1 (2026-08-31) -- optional, additive: a real, already-
  // computed { [id]: { burst01, match01 } } for whoever the caller already
  // knows the fresh battery reading for (runConstructedPossession()'s own
  // init formula, read once at possession start -- never recomputed here).
  // Absent by default, so every existing caller (and every test fixture
  // that predates this feature) produces a byte-identical plan.
  initialBurst = {},
} = {}) {
  const players = initialPlayerMap(initialPositions);
  const playerTracks = {};
  const playerCursor = {};
  // Discrete, "holds until genuinely updated" cursor -- same convention as
  // playerCursor above for position, just for the battery reading instead.
  // Stays undefined for any player this trace never once carries a real
  // burst01 for (an off-ball extra with no jobs at all, or any fixture
  // that never wires the battery up) -- keyframes for that player then
  // never gain the field at all, leaving their track exactly as it was
  // before this feature existed.
  const playerBurstCursor = {};
  for (const [id, point] of Object.entries(players)) {
    const burst = initialBurst[id];
    playerTracks[id] = [{
      timeMs: 0, position: clonePoint(point), action: "setup", eventIndex: -1, authoritative: true,
      ...(burst && typeof burst.burst01 === "number" ? { burst01: burst.burst01, match01: burst.match01 ?? null } : {}),
    }];
    playerCursor[id] = clonePoint(point);
    if (burst && typeof burst.burst01 === "number") {
      playerBurstCursor[id] = { burst01: burst.burst01, match01: burst.match01 ?? null };
    }
  }

  const ballTrack = initialBall
    ? [{ timeMs: 0, position: clonePoint(initialBall), state: initialOwnerId ? "controlled" : "loose", eventIndex: -1 }]
    : [];
  const contacts = [];
  const cues = [];
  const intervals = [];
  const ownerTrack = [{ timeMs: 0, ownerId: initialOwnerId ?? null, restart: null }];
  const boundaries = [{ timeMs: 0, eventIndex: -1, type: "start" }];
  // Single-Trajectory Arbitration v1 (2026-09-04) -- one authoritative
  // movement segment per player at any instant. See arbitrateSegment()
  // below and MATCH_ENGINE_ARCHITECTURE.md; `playerSegments` is exported
  // on the plan so validateMatchLabPlaybackPlan() (and tests) can prove
  // the invariant rather than trust it.
  const playerSegments = {};
  let cursorMs = 0;
  let lastPrimaryInterval = null;

  trace.forEach((event, eventIndex) => {
    const durationMs = Math.max(0, Number(event.duration) || 0);
    const cueOnly = event.timelineRole === "cue";
    const overlapsProducerWindow = event.overlapWithPrevious === true;
    const stationaryContact = event.contact?.phase === "end"
      && event.ballFrom && event.ballTo && samePoint(event.ballFrom, event.ballTo)
      // A standing/sliding tackle is a new physical duel interval. The
      // stationary-contact overlap shortcut is for arrivals at the end of
      // an already-authored incoming flight (block/recovery), not tackles.
      && event.movement !== "tackle" && event.movement !== "foul"
      // A reception is never "arriving to meet an already-authored
      // flight" -- it's its own genuine, independently-timed action
      // (2026-08-20 fix: caught interacting badly with Ball Flight &
      // Arrival v1's own contact.phase:"end" fix just above -- a
      // receiver's own short "meet and control the ball" event has
      // matching ballFrom/ballTo (they're not carrying it anywhere) AND
      // phase:"end" for the SAME reason every other genuine reception
      // does, which made it accidentally match this shortcut and inherit
      // the DELIVERY's own now-potentially-multi-second flight window
      // instead of its own short one -- the exact "everybody freezes/
      // slow motion" symptom shape, just for the receiver specifically).
      && event.movement !== "reception"
      && event.contactTiming !== "sequential"
      && lastPrimaryInterval;
    let startMs;
    let endMs;
    let overlapsPrevious = false;

    if (cueOnly) {
      // Commentary/decision metadata lives at the current clock edge and
      // never replaces lastPrimaryInterval. A following ATT/DEF adjustment
      // can therefore still overlap the real tackle/touch/pass window.
      startMs = cursorMs;
      endMs = cursorMs;
      overlapsPrevious = Boolean(lastPrimaryInterval);
    } else if (stationaryContact && lastPrimaryInterval) {
      startMs = lastPrimaryInterval.startMs;
      endMs = lastPrimaryInterval.endMs;
      overlapsPrevious = true;
    } else if (overlapsProducerWindow && lastPrimaryInterval) {
      // Concurrent with the producing event (normally starts at the same
      // instant; a declared reaction offset can start it later), but bounded
      // by ITS OWN real duration, not stretched to fill
      // whatever the producing event's own duration happens to be (2026-08-20
      // fix -- a real browser round reported off-ball players visibly
      // moving in slow motion, step by step, specifically during a long
      // pass's flight). Before this fix, an off-ball reaction's own
      // `duration` field (durationMs, above) was computed and then
      // silently discarded here -- ANY overlapping event's playerMoves
      // keyframes were unconditionally spread across the FULL producing
      // interval, `lastPrimaryInterval.startMs` to `.endMs`. That was
      // harmless while every MOVEMENT_DURATIONS value sat in the same
      // 300-700ms ballpark (a reaction's own duration and the producing
      // event's duration were interchangeable in practice), but Ball
      // Flight & Arrival v1 (same day) made an ordinary pass's own flight
      // duration scale with real distance -- several seconds for a long
      // ball -- while an interleaved off-ball reaction still only ever
      // covers its own small, capped share of ground. Stretching that
      // small movement's keyframes across a multi-second window is what
      // produced both symptoms reported directly: "slow motion" (the same
      // short walk now taking several real seconds) and "step by step"
      // (the reaction's own sparse hermite trajectory samples, meant to
      // cover ~500ms, spaced far enough apart over that longer window to
      // read as discrete bursts rather than one continuous stride). Capped
      // at the producing interval's own end for a short producer (a quick
      // carry touch, say) -- the original behavior in that case, since
      // startMs + durationMs would already reach past it.
      startMs = Math.min(
        lastPrimaryInterval.endMs,
        lastPrimaryInterval.startMs + Math.max(0, Number(event.overlapStartOffsetMs) || 0),
      );
      // World Motion Contract v1 (2026-09-03) -- this used to also clamp
      // the END to the producing interval (Math.min(lastPrimaryInterval.endMs,
      // ...)), which silently TIME-COMPRESSED any reaction whose own
      // honest duration was longer than whatever window it happened to
      // overlap. That is the measured root cause of the reported
      // "P.THROUGH.LOST -> DEF.ADJUST tracks back after losing it"
      // teleport: the recovery run is authored as a real 7.6-yard,
      // 1930ms stride, but it overlaps a 40ms P.PASS.LOST interval, so
      // its whole trajectory was replayed inside 40ms -- 189 yd/s for a
      // player whose own top speed is 8.7 yd/s. The keyframe loop below
      // maps a trajectory's physical `progress` onto [moveStart, moveEnd],
      // so shrinking that window does not shorten the RUN, it just plays
      // the same ground at whatever speed the window forces.
      //
      // An overlapping reaction now keeps its own real duration and is
      // allowed to run past the end of the action that triggered it --
      // which is what genuinely happens: a defender who starts tracking
      // back as the ball is intercepted is still running while the next
      // action begins. It still never STRETCHES to fill a longer
      // producer window (the 2026-08-20 slow-motion fix, unchanged --
      // that was this same line's other half), and it still never
      // advances cursorMs, so it remains concurrent rather than
      // consuming timeline of its own.
      endMs = startMs + durationMs;
      overlapsPrevious = true;
    } else {
      startMs = cursorMs;
      endMs = startMs + durationMs;
      cursorMs = endMs;
      lastPrimaryInterval = { startMs, endMs, eventIndex };
    }

    const interval = { eventIndex, code: event.code, startMs, endMs, overlapsPrevious, moveDiagnostics: [] };
    intervals.push(interval);
    const path = segmentPath(event);
    if (!cueOnly && !stationaryContact && event.ballTrajectory?.length >= 2) {
      addBallTrajectory(
        ballTrack, event.ballTrajectory, startMs, endMs, eventIndex,
        event.ballResult ?? event.movement ?? "moving",
      );
    } else if (!cueOnly && !stationaryContact && path.length) {
      addBallPath(ballTrack, path, startMs, endMs, eventIndex, event.ballResult ?? event.movement ?? "moving");
    }

    for (const move of event.playerMoves || []) {
      const id = String(move.playerId);
      const authoritative = move.authoritative !== false;
      // Stamina Bars v1 -- only overwrites the cursor when THIS move
      // actually carries a fresh reading (traceEvent()'s own
      // resolvedPlayerMoves omits the key entirely when the source entry
      // has no battery at all); every other move for this same player
      // keeps whatever the cursor already held, never resets to nothing.
      if (typeof move.burst01 === "number") {
        playerBurstCursor[id] = { burst01: move.burst01, match01: move.match01 ?? null };
      }
      const burstFields = playerBurstCursor[id]
        ? { burst01: playerBurstCursor[id].burst01, match01: playerBurstCursor[id].match01 }
        : {};
      if (!playerTracks[id]) {
        const origin = clonePoint(move.from);
        if (!origin) throw new Error(`Missing initial position for player ${id} in event ${eventIndex}`);
        playerTracks[id] = [{ timeMs: 0, position: origin, action: "setup", eventIndex: -1, authoritative: true, ...burstFields }];
        playerCursor[id] = origin;
      }
      const from = playerCursor[id];
      if (move.from && !samePoint(from, move.from)) {
        const previousFrame = playerTracks[id]?.at(-1);
        throw new Error(
          `Player ${id} discontinuity before event ${eventIndex} (${event.code || "unknown"}): `
          + `(${from?.x},${from?.y}) -> (${move.from.x},${move.from.y}); `
          + `last authored by event ${previousFrame?.eventIndex ?? "setup"} (${previousFrame?.action ?? "setup"})`,
        );
      }
      let moveStart = startMs;
      let moveEnd = endMs;
      let scheduledTo = move.to;
      let arrivalTiming = null;
      const profile = playerProfiles instanceof Map ? playerProfiles.get(id) : playerProfiles?.[id];
      // A pass receiver meets the ball at contact time, but does not crawl
      // from kick to reception. Their own Pace/Acceleration determine a
      // natural travel window ending exactly at contact. The older generic
      // shortcut below remains for rebound/aerial participants until those
      // resolvers also expose reachability as gameplay state.
      if (move.action === "receive-pass" && event.contact?.actorId === id
          && samePoint(move.to, event.contact.point) && intervals.length > 1 && profile) {
        const producer = intervals.slice(0, -1)
          .filter((candidate) => candidate.endMs <= startMs + EPSILON && candidate.endMs > candidate.startMs)
          .sort((left, right) => right.endMs - left.endMs || right.startMs - left.startMs)[0];
        if (producer) {
          arrivalTiming = contactArrivalTiming({
            player: profile, from, to: move.to,
            flightStartMs: producer.startMs, contactTimeMs: startMs,
            reactionDelayMs: move.reactionDelayMs ?? undefined,
            reachAllowanceYards: move.reachAllowanceYards ?? 0,
          });
          moveStart = arrivalTiming.moveStartMs;
          moveEnd = arrivalTiming.moveEndMs;
          scheduledTo = arrivalTiming.reachablePoint;
        }
      } else if (event.contact?.phase === "start" && event.contact.actorId === id
          && !event.contact.delayMs && !move.authoredTiming
          && samePoint(move.to, event.contact.point) && intervals.length > 1) {
        const previous = intervals[intervals.length - 2];
        moveStart = previous.startMs;
        moveEnd = previous.endMs;
      }
      const moveDistance = movementDistanceYards(from, scheduledTo);
      const locomotionDistanceYards = arrivalTiming?.locomotionDistanceYards ?? moveDistance;
      const naturalEtaMs = arrivalTiming?.naturalEtaMs
        ?? (profile ? timeToReach(profile, locomotionDistanceYards, speedYpsFromVelocity(move.trajectory?.[0]?.velocity)) * 1000 : null);
      const scheduledDurationMs = Math.max(0, moveEnd - moveStart);
      // World Motion Contract v1 (2026-09-03) -- development telemetry for
      // Match Lab's own "Movement timing" disclosure and for the motion
      // tests. Everything here is DERIVED from state the plan already
      // holds (see MATCH_ENGINE_ARCHITECTURE.md's authoritative/derived
      // split) -- none of it feeds back into gameplay.
      const trajectoryForDiagnostics = move.trajectory || [];
      const entryVelocity = trajectoryForDiagnostics[0]?.velocity ?? null;
      const exitVelocity = trajectoryForDiagnostics[trajectoryForDiagnostics.length - 1]?.velocity ?? null;
      const startSpeedYps = speedYpsFromVelocity(entryVelocity);
      const endSpeedYps = speedYpsFromVelocity(exitVelocity);
      const speedAudit = profile
        ? auditMoveSpeed({
            player: profile,
            distanceYards: locomotionDistanceYards,
            scheduledDurationMs,
            initialSpeedYps: startSpeedYps,
            motionModel: move.motionModel ?? "running",
            reactionDelayMs: arrivalTiming?.reactionDelayMs ?? move.reactionDelayMs ?? 0,
          })
        : null;
      interval.moveDiagnostics.push({
        playerId: id,
        attributes: profile ? { Pace: playerAttribute(profile, "Pace"), Acceleration: playerAttribute(profile, "Acceleration"), Agility: playerAttribute(profile, "Agility") } : null,
        action: move.action ?? "move",
        motionModel: move.motionModel ?? "running",
        ...(move.motionModel === "keeper-dive" && profile
          ? { diveAttributes: { Jumping: playerAttribute(profile, "Jumping"), Agility: playerAttribute(profile, "Agility") } } : {}),
        intention: move.intention?.action ?? move.intention ?? null,
        intentionTarget: move.intention?.target ?? move.to ?? null,
        requestedDistanceYards: movementDistanceYards(from, move.intention?.target ?? move.to),
        reachedTarget: samePoint(scheduledTo, move.intention?.target ?? move.to),
        incomingVelocity: entryVelocity,
        outgoingVelocity: exitVelocity,
        accelerationYardsPerSecondSquared: profile ? topSpeed(profile) / timeToTopSpeed(profile) : null,
        gait: move.gait ?? null,
        fromPosition: clonePoint(from),
        toPosition: clonePoint(scheduledTo),
        distanceYards: moveDistance,
        locomotionDistanceYards,
        naturalEtaMs: move.motionModel === "keeper-dive" ? speedAudit?.naturalEtaMs ?? naturalEtaMs : naturalEtaMs,
        scheduledDurationMs,
        averageSpeedYardsPerSecond: scheduledDurationMs > 0
          ? locomotionDistanceYards / (scheduledDurationMs / 1000)
          : 0,
        startSpeedYardsPerSecond: startSpeedYps,
        endSpeedYardsPerSecond: endSpeedYps,
        // How much of this move's ground the player's own acceleration
        // curve had to buy, versus what they were already carrying: a
        // player entering at pace covers the first yards "for free."
        accelerationContributionYards: speedAudit
          ? Math.max(0, speedAudit.reachableYards - (startSpeedYps * (scheduledDurationMs / 1000)))
          : null,
        topSpeedYardsPerSecond: profile ? topSpeed(profile) : null,
        reachableYards: speedAudit?.reachableYards ?? null,
        withinPhysicalLimit: speedAudit?.withinPhysicalLimit ?? null,
        overrunYards: speedAudit?.overrunYards ?? null,
        reactionDelayMs: arrivalTiming?.reactionDelayMs ?? move.reactionDelayMs ?? 0,
        reachAllowanceYards: arrivalTiming?.reachAllowanceYards ?? 0,
        reachable: arrivalTiming?.reachable ?? null,
      });
      const track = playerTracks[id];
      // Single-Trajectory Arbitration v1 (2026-09-04) -- resolve this move
      // against whatever segment this player is ALREADY running. Must
      // happen before sampleTrack() below, because a supersede truncates
      // the very keyframes that sample would otherwise read.
      const arbitration = arbitrateSegment({
        segments: playerSegments, track, id, moveStart, moveEnd, scheduledTo,
        action: move.action ?? "move", eventIndex,
      });
      const sampledStart = arbitration.sampledPosition
        ?? sampleTrack(track, moveStart)?.position
        ?? from;
      const carriedVelocity = arbitration.sampledVelocity ?? null;
      const trajectory = (move.trajectory || [])
        .filter((sample) => Number.isFinite(sample.progress) && sample.position)
        .slice()
        .sort((left, right) => left.progress - right.progress);
      if (arbitration.mode === "continue") {
        // This player is already running THIS same intention to
        // materially THIS same place. Re-authoring it as a second clip is
        // what produced competing trajectories; the existing segment is
        // simply extended to the later endpoint instead, so exactly one
        // authoritative movement remains.
        appendKeyframe(track, {
          timeMs: Math.max(moveEnd, arbitration.segment.endMs),
          position: clonePoint(scheduledTo),
          velocity: trajectory.at(-1)?.velocity ?? null,
          interpolation: "hermite",
          action: move.action ?? "move", eventIndex, authoritative,
          intention: move.intention ?? null,
          ...burstFields,
        });
      } else if (trajectory.length >= 2) {
        for (const sample of trajectory) {
          const progress = Math.max(0, Math.min(1, sample.progress));
          const baseline = lerpPoint(move.from ?? from, scheduledTo, progress);
          const mapped = lerpPoint(sampledStart, scheduledTo, progress);
          const position = progress <= EPSILON
            ? sampledStart
            : progress >= 1 - EPSILON
              ? clonePoint(scheduledTo)
              : {
                  ...mapped,
                  x: mapped.x + (sample.position.x - baseline.x),
                  y: mapped.y + (sample.position.y - baseline.y),
                };
          appendKeyframe(track, {
            timeMs: moveStart + (moveEnd - moveStart) * progress,
            position,
            // Trust the generator's own boundary velocity here (previously
            // forced to {0,0} at every segment's start/end -- see
            // zeroVelocityAcrossIdleGaps() below for why that's now handled
            // as a separate, gap-aware pass instead of unconditionally on
            // every single segment).
            //
            // Single-Trajectory Arbitration v1 -- on a supersede, the
            // FIRST keyframe keeps the velocity the player genuinely had
            // at this instant (sampled off the run being replaced), not
            // this clip's own from-rest v0. That is what makes a retarget
            // curve out of the old heading instead of snapping into the
            // new one.
            velocity: progress <= EPSILON && carriedVelocity ? carriedVelocity : sample.velocity,
            interpolation: "hermite",
            action: move.action ?? "move", eventIndex, authoritative,
            intention: move.intention ?? null,
            ...burstFields,
          });
        }
      } else {
        appendKeyframe(track, {
          timeMs: moveStart, position: sampledStart, action: move.action ?? "move",
          eventIndex, authoritative, ...(carriedVelocity ? { velocity: carriedVelocity } : {}), ...burstFields,
        });
        appendKeyframe(track, { timeMs: moveEnd, position: scheduledTo, action: move.action ?? "move", eventIndex, authoritative, ...burstFields });
      }
      playerCursor[id] = clonePoint(scheduledTo);
    }

    if (event.contact) {
      // delayMs (2026-08-25) -- optional, additive: a "start"-phase contact
      // normally lands at this event's own startMs (the instant its
      // outgoing flight begins), which is correct for the ordinary case
      // (a kick/header with no real travel beforehand). But an event whose
      // actor genuinely travels TO the contact point first -- a keeper's
      // own dive/reach before parrying a shot, timed by its own
      // playerMoves -- needs contact pinned at however far INTO the event
      // that travel actually takes, not literally its first instant.
      // Without this, the contact-pin below (which wins unconditionally)
      // collapsed the actor's own dive to a single frozen frame at the
      // contact point for the ENTIRE event -- a real reported bug: "the
      // keeper does not even react," since their own authored
      // start-position keyframe at this exact timeMs was silently
      // overwritten. Absent/zero for every existing caller -- identical to
      // the original startMs behavior.
      const startDelayMs = event.contact.phase === "end"
        ? 0
        : Math.max(0, Math.min(endMs - startMs, Number(event.contact.delayMs) || 0));
      const contactTime = event.contact.phase === "end" ? endMs : startMs + startDelayMs;
      contacts.push({
        timeMs: contactTime, point: clonePoint(event.contact.point), actorId: String(event.contact.actorId),
        ...(event.contact.bodyPoint ? { bodyPoint: clonePoint(event.contact.bodyPoint), reachAllowanceYards: event.contact.reachAllowanceYards ?? 0 } : {}),
        type: event.contact.type, phase: event.contact.phase, eventIndex,
      });
      boundaries.push({ timeMs: contactTime, eventIndex, type: "contact" });
    }
    const cueTime = event.contact?.phase === "end" ? endMs : startMs;
    // A failed shot/header is decided at its real trajectory endpoint. Keep
    // the event's visual/contact cue at the strike, but expose a second time
    // on the SAME cue for terminal audio and the result badge. Consumers can
    // therefore fire "miss" exactly when the sampled ball arrives instead
    // of using matchSound's fixed fallback delay from the kick.
    const deferTerminalAudio = event.outcome === "fail"
      && (event.movement === "shot" || event.movement === "header")
      && endMs > cueTime + EPSILON;
    cues.push({
      timeMs: cueTime,
      code: event.code,
      label: event.label,
      eventIndex,
      ...(deferTerminalAudio ? {
        audioTimeMs: endMs,
        audioMilestone: "terminal",
      } : {}),
    });
    boundaries.push({ timeMs: endMs, eventIndex, type: "event" });
    if (event.ownerBeforeId !== undefined && ownerTrack[ownerTrack.length - 1].ownerId !== event.ownerBeforeId) {
      ownerTrack.push({ timeMs: startMs, ownerId: event.ownerBeforeId ?? null, restart: null });
    }
    if (event.ownerAfterId !== undefined) {
      const ownerAfterTime = event.ownerAfterAt === "end" || event.contact?.phase === "end" ? endMs : startMs;
      ownerTrack.push({ timeMs: ownerAfterTime, ownerId: event.ownerAfterId ?? null, restart: event.restart ?? null });
    }
  });

  // Contact keyframes win, unconditionally -- applied last, after every
  // event's own moves are in, rather than trusted to win on eventIndex
  // ordering alone. An off-ball reaction scheduled to overlap and CONCLUDE
  // at that exact same instant (its own window ending at contactTime, same
  // convergence-timing mechanism as reactOffBallContinuous()'s "lean
  // toward the next mark during the first touch") authors a keyframe at
  // the identical timeMs with its own, independently-computed tactical
  // target -- normalizeTrack()'s (timeMs, eventIndex) tie-break would let
  // that LATER event's keyframe silently overwrite the actor's real,
  // authored contact position. Re-pinning here, after the fact, makes sure
  // the actor is provably at the ball at the instant contact says they are,
  // no matter which event's own move happens to land on the same tick.
  for (const contact of contacts) {
    const track = playerTracks[contact.actorId];
    if (!track) continue;
    const cursor = playerBurstCursor[contact.actorId];
    // Stage 4, Playback Fluidity (2026-09-06) -- the pin is a POSITION
    // correction (put the actor's body exactly on the ball at the instant
    // contact says it is there); it is not a statement that the player
    // stopped. It used to carry no velocity at all, which appendKeyframe()
    // stores as null, and a null-tangent keyframe makes hermite decelerate
    // into the pin and re-accelerate out of it -- the same go-stop-go
    // signature this file has fixed twice before, reappearing once per
    // contact. Every carry touch declares a contact, so a five-touch carry
    // planted the carrier five times.
    //
    // Sample the real momentum BEFORE pinning, exactly as arbitrateSegment()
    // already does when one intention supersedes another. The pinned
    // position is unchanged; only the tangent through it is restored.
    const pinned = sampleTrack(
      track.slice().sort((left, right) => left.timeMs - right.timeMs),
      contact.timeMs,
    );
    const pinnedVelocity = pinned?.velocity
      ? { x: Number(pinned.velocity.x) || 0, y: Number(pinned.velocity.y) || 0 }
      : null;
    appendKeyframe(track, {
      timeMs: contact.timeMs,
      position: contact.bodyPoint ?? contact.point,
      action: "contact-pin",
      eventIndex: Number.POSITIVE_INFINITY,
      authoritative: true,
      ...(pinnedVelocity ? { velocity: pinnedVelocity } : {}),
      // Stamina Bars v1 -- carries the cursor through rather than leaving
      // this re-pinned keyframe silently blank (sampleTrack()'s own
      // spread would otherwise read as "unknown" for the instant this
      // exact keyframe wins).
      ...(cursor ? { burst01: cursor.burst01, match01: cursor.match01 } : {}),
    });
  }

  for (const [id, track] of Object.entries(playerTracks)) {
    playerTracks[id] = zeroVelocityAcrossIdleGaps(normalizeTrack(track));
  }
  const normalizedBallTrack = normalizeTrack(ballTrack);
  const semanticBoundaries = [...new Map(boundaries
    .sort((a, b) => a.timeMs - b.timeMs || a.eventIndex - b.eventIndex || (a.type === "contact" ? -1 : 1))
    .map((boundary) => [`${boundary.timeMs}:${boundary.eventIndex}:${boundary.type}`, boundary])).values()];
  const durationMs = Math.max(cursorMs, ...intervals.map((item) => item.endMs), 0);
  if (finalOwnerId !== undefined || restart !== undefined) {
    const requestedOwner = finalOwnerId === undefined ? ownerTrack[ownerTrack.length - 1].ownerId : finalOwnerId;
    if (ownerTrack[ownerTrack.length - 1].ownerId !== requestedOwner || restart) {
      ownerTrack.push({ timeMs: durationMs, ownerId: requestedOwner ?? null, restart: restart ?? null });
    }
  }

  const resolvedFinalOwnerId = finalOwnerId === undefined ? ownerTrack[ownerTrack.length - 1].ownerId : finalOwnerId;
  const resolvedRestart = restart === undefined ? (ownerTrack[ownerTrack.length - 1].restart ?? null) : restart;

  const plan = {
    durationMs,
    tracks: { ball: normalizedBallTrack, players: playerTracks, owner: ownerTrack },
    contacts, cues, boundaries: semanticBoundaries, intervals,
    // Single-Trajectory Arbitration v1 -- every authoritative movement
    // segment this plan scheduled, per player, so the one-segment-at-a-time
    // invariant is provable rather than assumed (see
    // validateMatchLabPlaybackPlan()).
    playerSegments,
    finalState: { ownerId: resolvedFinalOwnerId ?? null, restart: resolvedRestart ?? null },
  };
  const continuity = validateMatchLabPlaybackPlan(plan);
  if (!continuity.valid) throw new Error(continuity.errors.join("; "));
  return deepFreeze(plan);
}

// Ball/Player Teleport Fix v1 (2026-08-28) -- a real reported bug: this
// used to spread `{...next, position: interpolated}` unconditionally, so
// every DISCRETE field (state/mode above all -- the renderer's own
// `atFeet` check reads it directly) came from the UPCOMING keyframe for
// the ENTIRE approach toward it, not just once genuinely arrived. A ball
// track's own `mode` only ever changes at a genuine event boundary (a
// touch's own "rolling" samples vs the next event's "controlled-ground"
// ones), so for the whole final sliver of ANY interpolation window
// leading up to such a boundary, the renderer's atFeet check already
// read the NEXT segment's mode -- true even while `position` was still
// mid-lerp toward it -- and snapped the displayed ball straight to the
// owner's own marker (ownerPoint) before the real, independently-tracked
// position actually got there. Every discrete field now comes from
// `previous` until genuinely arrived (ratio>=1, i.e., timeMs===next.timeMs
// itself); only `position` (and now `velocity`, blended the same way
// instead of also jumping to the next segment's own end speed) ever
// reflects the in-between.
export function sampleTrack(track = [], timeMs = 0) {
  if (!track.length) return null;
  if (timeMs <= track[0].timeMs) return { ...track[0], position: clonePoint(track[0].position) };
  for (let index = 1; index < track.length; index += 1) {
    const next = track[index];
    if (timeMs <= next.timeMs + EPSILON) {
      const previous = track[index - 1];
      const span = next.timeMs - previous.timeMs;
      const ratio = span <= EPSILON ? 1 : Math.max(0, Math.min(1, (timeMs - previous.timeMs) / span));
      const arrived = ratio >= 1 - 1e-9;
      const useHermite = previous.interpolation === "hermite" && next.interpolation === "hermite"
        && previous.velocity && next.velocity;
      const blendedVelocity = !arrived && previous.velocity && next.velocity
        ? {
            x: previous.velocity.x + (next.velocity.x - previous.velocity.x) * ratio,
            y: previous.velocity.y + (next.velocity.y - previous.velocity.y) * ratio,
          }
        : undefined;
      return {
        ...(arrived ? next : previous),
        position: useHermite
          ? hermiteTrackPoint(previous, next, span, ratio)
          : lerpPoint(previous.position, next.position, ratio),
        ...(blendedVelocity ? { velocity: blendedVelocity } : {}),
        progress: ratio,
      };
    }
  }
  const last = track[track.length - 1];
  return { ...last, position: clonePoint(last.position), progress: 1 };
}

export function sampleMatchLabPlaybackPlan(plan, timeMs) {
  const clampedTime = Math.max(0, Math.min(plan.durationMs, Number(timeMs) || 0));
  const players = Object.fromEntries(Object.entries(plan.tracks.players)
    .map(([id, track]) => {
      const sample = sampleTrack(track, clampedTime);
      if (!sample) return [id, null];
      // Stamina Bars v1 -- burst01/match01 only appear here when the
      // track genuinely carries them (buildMatchLabPlaybackPlan()'s own
      // playerBurstCursor); every existing caller/test that predates this
      // feature gets the exact original bare {x,y,zone} point back.
      return [id, sample.burst01 !== undefined
        ? { ...sample.position, burst01: sample.burst01, match01: sample.match01 }
        : sample.position];
    }));
  const owner = plan.tracks.owner.reduce((current, item) => item.timeMs <= clampedTime + EPSILON ? item : current, plan.tracks.owner[0]);
  const ballSample = sampleTrack(plan.tracks.ball, clampedTime);
  return {
    timeMs: clampedTime,
    ball: ballSample ? {
      ...ballSample.position,
      velocity: ballSample.velocity ? { ...ballSample.velocity } : { x: 0, y: 0 },
      verticalVelocity: Number(ballSample.verticalVelocity) || 0,
      mode: ballSample.state ?? "resting",
    } : null,
    players,
    ownerId: owner?.ownerId ?? null,
    restart: owner?.restart ?? null,
  };
}

export function nextSemanticBoundary(plan, timeMs) {
  return plan.boundaries.find((boundary) => boundary.timeMs > timeMs + EPSILON) ?? null;
}

// Step Back v1 (2026-08-31) -- the reverse of nextSemanticBoundary(): the
// LAST boundary strictly before timeMs, not the first one after it.
// plan.boundaries is already sorted ascending (buildMatchLabPlaybackPlan()'s
// own semanticBoundaries construction), so a single forward scan keeping
// the last qualifying entry is enough -- no need to reverse/sort a copy.
export function previousSemanticBoundary(plan, timeMs) {
  let found = null;
  for (const boundary of plan.boundaries) {
    if (boundary.timeMs >= timeMs - EPSILON) break;
    found = boundary;
  }
  return found;
}

export function validateMatchLabPlaybackPlan(plan, tolerance = 0.01) {
  const errors = [];
  for (const contact of plan.contacts) {
    const playerTrack = plan.tracks.players[contact.actorId];
    const playerPoint = sampleTrack(playerTrack, contact.timeMs)?.position;
    const ballPoint = sampleTrack(plan.tracks.ball, contact.timeMs)?.position;
    const bodyPoint = contact.bodyPoint ?? contact.point;
    if (movementDistanceYards(bodyPoint, contact.point) > (contact.reachAllowanceYards ?? 0) + tolerance) {
      errors.push(`Contact ${contact.eventIndex} exceeds the actor's contact reach`);
    }
    if (!samePoint(playerPoint, bodyPoint, tolerance)) {
      errors.push(
        `Contact ${contact.eventIndex} actor ${contact.actorId} is not at the contact point `
        + `at ${contact.timeMs}ms: (${playerPoint?.x},${playerPoint?.y}) vs (${contact.point.x},${contact.point.y})`,
      );
    }
    if (!samePoint(ballPoint, contact.point, tolerance)) {
      errors.push(`Contact ${contact.eventIndex} ball is not at the contact point`);
    }
  }
  for (let index = 1; index < plan.tracks.ball.length; index += 1) {
    const previous = plan.tracks.ball[index - 1];
    const current = plan.tracks.ball[index];
    if (current.timeMs + EPSILON < previous.timeMs) errors.push(`Ball track time reverses at keyframe ${index}`);
  }
  // Single-Trajectory Arbitration v1 (2026-09-04) -- fail loudly if two
  // authoritative movement segments for the SAME player ever overlap in
  // time. An unarbitrated overlap is not a cosmetic issue: both clips'
  // keyframes land in one track and the marker alternates between them,
  // which is the reported twitching. Anything that reintroduces a second
  // concurrent clip for one player should break the build, not degrade
  // quietly.
  for (const [playerId, segments] of Object.entries(plan.playerSegments || {})) {
    const ordered = segments.slice().sort((left, right) => left.startMs - right.startMs);
    for (let index = 1; index < ordered.length; index += 1) {
      const previous = ordered[index - 1];
      const current = ordered[index];
      if (current.startMs + EPSILON < previous.endMs) {
        errors.push(
          `Player ${playerId} has two overlapping authoritative movement segments: `
          + `event ${previous.eventIndex} (${previous.action}) runs ${previous.startMs}..${previous.endMs}ms `
          + `while event ${current.eventIndex} (${current.action}) starts at ${current.startMs}ms`,
        );
      }
    }
  }
  if (plan.finalState.restart && plan.finalState.ownerId !== null) {
    errors.push("An out-of-play final state cannot retain an owner");
  }
  return { valid: errors.length === 0, errors };
}

export function createMatchLabPlaybackClock(plan, {
  now = () => performance.now(),
  requestFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (id) => cancelAnimationFrame(id),
  onFrame = () => {},
  onStateChange = () => {},
  advanceTime = null,
} = {}) {
  let timeMs = 0;
  let rate = 1;
  let playing = false;
  let frameId = null;
  let lastNow = null;

  const emit = () => onFrame(sampleMatchLabPlaybackPlan(plan, timeMs));
  const notify = () => onStateChange({ playing, timeMs, rate });
  const cancel = () => {
    if (frameId !== null) cancelFrame(frameId);
    frameId = null;
  };
  const tick = (timestamp) => {
    if (!playing) return;
    const current = Number.isFinite(timestamp) ? timestamp : now();
    if (lastNow === null) lastNow = current;
    const elapsedMs = Math.max(0, current - lastNow);
    timeMs = advanceTime
      ? Math.min(plan.durationMs, advanceTime(timeMs, elapsedMs, rate))
      : Math.min(plan.durationMs, timeMs + elapsedMs * rate);
    lastNow = current;
    emit();
    if (timeMs >= plan.durationMs - EPSILON) {
      playing = false;
      frameId = null;
      notify();
      return;
    }
    frameId = requestFrame(tick);
  };

  return {
    play() {
      if (timeMs >= plan.durationMs - EPSILON) timeMs = 0;
      if (playing) return;
      playing = true;
      lastNow = now();
      frameId = requestFrame(tick);
      notify();
    },
    pause() {
      if (!playing) return;
      playing = false;
      cancel();
      lastNow = null;
      notify();
    },
    replay() {
      cancel();
      timeMs = 0;
      lastNow = null;
      emit();
      this.play();
    },
    seek(nextTimeMs) {
      timeMs = Math.max(0, Math.min(plan.durationMs, Number(nextTimeMs) || 0));
      lastNow = playing ? now() : null;
      emit();
      notify();
      return timeMs;
    },
    step() {
      this.pause();
      const boundary = nextSemanticBoundary(plan, timeMs);
      return boundary ? this.seek(boundary.timeMs) : this.seek(plan.durationMs);
    },
    // Step Back v1 -- the reverse of step(): go back to re-watch the
    // last incident instead of restarting the whole trace from zero.
    stepBack() {
      this.pause();
      const boundary = previousSemanticBoundary(plan, timeMs);
      return boundary ? this.seek(boundary.timeMs) : this.seek(0);
    },
    setRate(nextRate) {
      rate = Math.max(0.1, Number(nextRate) || 1);
      lastNow = playing ? now() : null;
      notify();
    },
    destroy() { playing = false; cancel(); },
    getState() { return { playing, timeMs, rate }; },
    getPlan() { return plan; },
  };
}

export { samePoint, zeroVelocityAcrossIdleGaps, IDLE_GAP_THRESHOLD_MS };
