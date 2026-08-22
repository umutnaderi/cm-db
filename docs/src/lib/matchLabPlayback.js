import {
  contactArrivalTiming, movementDistanceYards,
} from "./matchMovementTiming.js";
import { timeToReach, topSpeed } from "./playerKinetics.js";

const EPSILON = 0.001;
export const MATCH_LAB_PLAYBACK_BUILD = "20260820-05";

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
// genuine idle period (comfortably above a single touch's own ~220ms),
// not at every junction unconditionally. Must run on the SORTED,
// deduped track (post-normalizeTrack) -- the raw append-order array
// can't be walked pairwise for real time gaps.
const IDLE_GAP_THRESHOLD_MS = 60;
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
} = {}) {
  const players = initialPlayerMap(initialPositions);
  const playerTracks = {};
  const playerCursor = {};
  for (const [id, point] of Object.entries(players)) {
    playerTracks[id] = [{ timeMs: 0, position: clonePoint(point), action: "setup", eventIndex: -1, authoritative: true }];
    playerCursor[id] = clonePoint(point);
  }

  const ballTrack = initialBall
    ? [{ timeMs: 0, position: clonePoint(initialBall), state: initialOwnerId ? "controlled" : "loose", eventIndex: -1 }]
    : [];
  const contacts = [];
  const cues = [];
  const intervals = [];
  const ownerTrack = [{ timeMs: 0, ownerId: initialOwnerId ?? null, restart: null }];
  const boundaries = [{ timeMs: 0, eventIndex: -1, type: "start" }];
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
      endMs = Math.min(lastPrimaryInterval.endMs, startMs + durationMs);
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
      if (!playerTracks[id]) {
        const origin = clonePoint(move.from);
        if (!origin) throw new Error(`Missing initial position for player ${id} in event ${eventIndex}`);
        playerTracks[id] = [{ timeMs: 0, position: origin, action: "setup", eventIndex: -1, authoritative: true }];
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
          && samePoint(move.to, event.contact.point) && intervals.length > 1) {
        const previous = intervals[intervals.length - 2];
        moveStart = previous.startMs;
        moveEnd = previous.endMs;
      }
      const moveDistance = movementDistanceYards(from, scheduledTo);
      const locomotionDistanceYards = arrivalTiming?.locomotionDistanceYards ?? moveDistance;
      const naturalEtaMs = arrivalTiming?.naturalEtaMs
        ?? (profile ? timeToReach(profile, locomotionDistanceYards) * 1000 : null);
      const scheduledDurationMs = Math.max(0, moveEnd - moveStart);
      interval.moveDiagnostics.push({
        playerId: id,
        action: move.action ?? "move",
        distanceYards: moveDistance,
        locomotionDistanceYards,
        naturalEtaMs,
        scheduledDurationMs,
        averageSpeedYardsPerSecond: scheduledDurationMs > 0
          ? locomotionDistanceYards / (scheduledDurationMs / 1000)
          : 0,
        topSpeedYardsPerSecond: profile ? topSpeed(profile) : null,
        reactionDelayMs: arrivalTiming?.reactionDelayMs ?? null,
        reachAllowanceYards: arrivalTiming?.reachAllowanceYards ?? 0,
        reachable: arrivalTiming?.reachable ?? null,
      });
      const track = playerTracks[id];
      const sampledStart = sampleTrack(track, moveStart)?.position ?? from;
      const trajectory = (move.trajectory || [])
        .filter((sample) => Number.isFinite(sample.progress) && sample.position)
        .slice()
        .sort((left, right) => left.progress - right.progress);
      if (trajectory.length >= 2) {
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
            velocity: sample.velocity,
            interpolation: "hermite",
            action: move.action ?? "move", eventIndex, authoritative,
            intention: move.intention ?? null,
          });
        }
      } else {
        appendKeyframe(track, { timeMs: moveStart, position: sampledStart, action: move.action ?? "move", eventIndex, authoritative });
        appendKeyframe(track, { timeMs: moveEnd, position: scheduledTo, action: move.action ?? "move", eventIndex, authoritative });
      }
      playerCursor[id] = clonePoint(scheduledTo);
    }

    if (event.contact) {
      const contactTime = event.contact.phase === "end" ? endMs : startMs;
      contacts.push({
        timeMs: contactTime, point: clonePoint(event.contact.point), actorId: String(event.contact.actorId),
        type: event.contact.type, phase: event.contact.phase, eventIndex,
      });
      boundaries.push({ timeMs: contactTime, eventIndex, type: "contact" });
    }
    const cueTime = event.contact?.phase === "end" ? endMs : startMs;
    cues.push({ timeMs: cueTime, code: event.code, label: event.label, eventIndex });
    boundaries.push({ timeMs: endMs, eventIndex, type: "event" });
    if (event.ownerBeforeId !== undefined && ownerTrack[ownerTrack.length - 1].ownerId !== event.ownerBeforeId) {
      ownerTrack.push({ timeMs: startMs, ownerId: event.ownerBeforeId ?? null, restart: null });
    }
    if (event.ownerAfterId !== undefined) {
      const ownerAfterTime = event.ownerAfterAt === "end" || event.contact?.phase === "end" ? endMs : startMs;
      ownerTrack.push({ timeMs: ownerAfterTime, ownerId: event.ownerAfterId ?? null, restart: event.restart ?? null });
    }
  });

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
    finalState: { ownerId: resolvedFinalOwnerId ?? null, restart: resolvedRestart ?? null },
  };
  const continuity = validateMatchLabPlaybackPlan(plan);
  if (!continuity.valid) throw new Error(continuity.errors.join("; "));
  return deepFreeze(plan);
}

export function sampleTrack(track = [], timeMs = 0) {
  if (!track.length) return null;
  if (timeMs <= track[0].timeMs) return { ...track[0], position: clonePoint(track[0].position) };
  for (let index = 1; index < track.length; index += 1) {
    const next = track[index];
    if (timeMs <= next.timeMs + EPSILON) {
      const previous = track[index - 1];
      const span = next.timeMs - previous.timeMs;
      const ratio = span <= EPSILON ? 1 : Math.max(0, Math.min(1, (timeMs - previous.timeMs) / span));
      const useHermite = previous.interpolation === "hermite" && next.interpolation === "hermite"
        && previous.velocity && next.velocity;
      return {
        ...next,
        position: useHermite
          ? hermiteTrackPoint(previous, next, span, ratio)
          : lerpPoint(previous.position, next.position, ratio),
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
    .map(([id, track]) => [id, sampleTrack(track, clampedTime)?.position ?? null]));
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

export function validateMatchLabPlaybackPlan(plan, tolerance = 0.01) {
  const errors = [];
  for (const contact of plan.contacts) {
    const playerTrack = plan.tracks.players[contact.actorId];
    const playerPoint = sampleTrack(playerTrack, contact.timeMs)?.position;
    const ballPoint = sampleTrack(plan.tracks.ball, contact.timeMs)?.position;
    if (!samePoint(playerPoint, contact.point, tolerance)) {
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
    timeMs = Math.min(plan.durationMs, timeMs + Math.max(0, current - lastNow) * rate);
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

export { samePoint };
