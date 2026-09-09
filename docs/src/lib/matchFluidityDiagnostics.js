import { sampleMatchLabPlaybackPlan } from "./matchLabPlayback.js";
import { yardDistance } from "./pitchGeometry.js";
import { speedYpsFromVelocity } from "./worldMotion.js";

const distance = (a, b) => a && b ? Math.hypot(yardDistance(a, b), (a.height || 0) - (b.height || 0)) : 0;

/** Measure authored world time; renderer wall-clock hitches are a separate input. */
export function measurePlaybackFluidity(plan, { stepMs = 20, epsilonYards = 0.001, rendererFrameGaps = [] } = {}) {
  const freezes = [], massFreezes = [], orphanedIntervals = [], earlyFinishes = [], velocitySeams = [];
  let liveMs = 0, fullyStaticMs = 0, playerStaticMs = 0, open = null, massOpen = null;
  let previous = sampleMatchLabPlaybackPlan(plan, 0);
  for (let t = stepMs; t < plan.durationMs + stepMs; t += stepMs) {
    const time = Math.min(t, plan.durationMs), frame = sampleMatchLabPlaybackPlan(plan, time);
    const dt = time - previous.timeMs;
    const live = !previous.restart;
    const moving = Object.keys(frame.players).filter(id => distance(previous.players[id], frame.players[id]) > epsilonYards).length;
    const still = moving === 0 && distance(previous.ball, frame.ball) <= epsilonYards;
    const massStill = moving <= Math.floor(Object.keys(frame.players).length * 0.1);
    if (live) {
      liveMs += dt;
      if (!moving) playerStaticMs += dt;
      if (still) fullyStaticMs += dt;
    }
    if (live && still) { if (open === null) open = previous.timeMs; }
    else if (open !== null) { freezes.push({ startMs: open, durationMs: previous.timeMs - open }); open = null; }
    if (live && massStill) { if (massOpen === null) massOpen = previous.timeMs; }
    else if (massOpen !== null) { massFreezes.push({ startMs: massOpen, durationMs: previous.timeMs - massOpen }); massOpen = null; }
    previous = frame;
  }
  if (open !== null) freezes.push({ startMs: open, durationMs: plan.durationMs - open });
  if (massOpen !== null) massFreezes.push({ startMs: massOpen, durationMs: plan.durationMs - massOpen });
  // Coverage comes from actual adjacent samples, including the independent ball.
  const movingSpans = [];
  for (const track of [plan.tracks.ball, ...Object.values(plan.tracks.players)]) {
    for (let i = 1; i < track.length; i++) {
      const a = track[i - 1], b = track[i];
      if (b.timeMs > a.timeMs && distance(a.position, b.position) > epsilonYards) movingSpans.push([a.timeMs, b.timeMs]);
    }
  }
  movingSpans.sort((a, b) => a[0] - b[0]);
  for (const interval of plan.intervals) {
    if (interval.endMs - interval.startMs <= 200) continue;
    if (sampleMatchLabPlaybackPlan(plan, interval.startMs).restart) continue;
    let cursor = interval.startMs;
    for (const [start, end] of movingSpans) {
      if (end <= cursor || start >= interval.endMs) continue;
      if (start - cursor > 200) orphanedIntervals.push({ code: interval.code, startMs: cursor, durationMs: start - cursor });
      cursor = Math.max(cursor, Math.min(end, interval.endMs));
    }
    if (interval.endMs - cursor > 200) orphanedIntervals.push({ code: interval.code, startMs: cursor, durationMs: interval.endMs - cursor });
  }
  for (const [id, track] of Object.entries(plan.tracks.players)) {
    for (let i = 1; i < track.length; i++) {
      const a = track[i - 1], b = track[i];
      if (a.eventIndex !== b.eventIndex) {
        const jump = speedYpsFromVelocity({ x: (b.velocity?.x || 0) - (a.velocity?.x || 0), y: (b.velocity?.y || 0) - (a.velocity?.y || 0) });
        if (jump > 1) velocitySeams.push({ playerId: id, timeMs: b.timeMs, gapMs: b.timeMs - a.timeMs, velocityChangeYps: jump });
      }
      if (b.timeMs - a.timeMs > 200 && distance(a.position, b.position) <= epsilonYards
          && speedYpsFromVelocity(a.velocity) > 0.5) earlyFinishes.push({ playerId: id, startMs: a.timeMs, durationMs: b.timeMs - a.timeMs });
    }
  }
  const movementViolations = plan.intervals.flatMap(i => i.moveDiagnostics.filter(d => d.withinPhysicalLimit === false).map(d => ({ code: i.code, ...d })));
  return { liveMs, fullyStaticMs, fullyStaticPercent: liveMs ? 100 * fullyStaticMs / liveMs : 0,
    playerStaticMs, longestFreezeMs: Math.max(0, ...freezes.map(f => f.durationMs)),
    freezesOver200Ms: freezes.filter(f => f.durationMs > 200).length,
    freezesOver300Ms: freezes.filter(f => f.durationMs > 300).length,
    longestMassFreezeMs: Math.max(0, ...massFreezes.map(f => f.durationMs)), freezes, massFreezes,
    orphanedIntervals, movementViolations, earlyFinishes, velocitySeams,
    rendererFrameGaps: [...rendererFrameGaps] };
}

export function createRendererGapMonitor({ thresholdMs = 100 } = {}) {
  let previous = null;
  const gaps = [];
  return { sample(now, playing) {
    if (playing && previous !== null && now - previous > thresholdMs) gaps.push({ atMs: now, durationMs: now - previous });
    previous = playing ? now : null;
  }, reset() { previous = null; gaps.length = 0; }, snapshot() { return gaps.map(g => ({ ...g })); } };
}
