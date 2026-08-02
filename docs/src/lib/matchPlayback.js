import { reduceMatchTimeline } from "./matchTimeline.js";

export function estimateServerClockOffset(samples = []) {
  const valid = samples
    .map((sample) => {
      const sentAt = Number(sample?.sentAt);
      const receivedAt = Number(sample?.receivedAt);
      const serverNow = Number(sample?.serverNow);
      const roundTripMs = receivedAt - sentAt;
      if (![sentAt, receivedAt, serverNow, roundTripMs].every(Number.isFinite) || roundTripMs < 0) {
        return null;
      }
      return {
        roundTripMs,
        offsetMs: serverNow - (sentAt + roundTripMs / 2),
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.roundTripMs - right.roundTripMs);
  if (!valid.length) return 0;
  const best = valid.slice(0, Math.min(3, valid.length));
  return best.reduce((total, sample) => total + sample.offsetMs, 0) / best.length;
}

export function createMatchPlaybackController({
  timeline,
  onState,
  now = () => Date.now(),
  schedule = (callback, delayMs) => setTimeout(callback, delayMs),
  cancel = (timer) => clearTimeout(timer),
  tickMs = 120,
  rate = 1,
} = {}) {
  if (!timeline || typeof onState !== "function") {
    throw new Error("A canonical timeline and state renderer are required.");
  }

  let timer = null;
  let running = false;
  let completed = false;
  let playbackRate = Math.max(0.05, Number(rate) || 1);
  let serverOffsetMs = 0;
  let anchorServerMs = 0;
  let anchorElapsedMs = 0;
  let resolveCompletion = null;
  let completionPromise = null;

  const serverNow = () => now() + serverOffsetMs;
  const elapsedAt = (timestamp = serverNow()) => Math.max(
    0,
    Math.min(
      Number(timeline.durationMs || 0),
      anchorElapsedMs + (timestamp - anchorServerMs) * playbackRate,
    ),
  );
  const nextEventDelay = (elapsedMs) => {
    const next = (timeline.events || []).find((event) => event.atMs > elapsedMs);
    if (!next) return tickMs;
    return Math.max(16, Math.min(tickMs, (next.atMs - elapsedMs) / playbackRate));
  };
  const emit = () => {
    const elapsedMs = elapsedAt();
    const state = reduceMatchTimeline(timeline, elapsedMs);
    onState(state);
    if (state.completed || elapsedMs >= timeline.durationMs) {
      running = false;
      completed = true;
      timer = null;
      resolveCompletion?.(state);
      resolveCompletion = null;
      return;
    }
    if (running) timer = schedule(emit, nextEventDelay(elapsedMs));
  };

  return {
    start({ startAt = now(), offsetMs = 0, initialElapsedMs = 0 } = {}) {
      if (timer !== null) cancel(timer);
      serverOffsetMs = Number(offsetMs) || 0;
      anchorServerMs = Number(startAt) || serverNow();
      anchorElapsedMs = Math.max(0, Number(initialElapsedMs) || 0);
      running = true;
      completed = false;
      completionPromise = new Promise((resolve) => {
        resolveCompletion = resolve;
      });
      emit();
      return completionPromise;
    },
    stop() {
      running = false;
      if (timer !== null) cancel(timer);
      timer = null;
    },
    resync({ startAt, offsetMs } = {}) {
      const elapsedMs = elapsedAt();
      if (Number.isFinite(offsetMs)) serverOffsetMs = Number(offsetMs);
      if (Number.isFinite(startAt)) {
        anchorServerMs = Number(startAt);
        anchorElapsedMs = 0;
      } else {
        anchorServerMs = serverNow();
        anchorElapsedMs = elapsedMs;
      }
      if (running) {
        if (timer !== null) cancel(timer);
        emit();
      }
    },
    seek(elapsedMs) {
      anchorElapsedMs = Math.max(0, Math.min(timeline.durationMs, Number(elapsedMs) || 0));
      anchorServerMs = serverNow();
      const state = reduceMatchTimeline(timeline, anchorElapsedMs);
      onState(state);
      return state;
    },
    setRate(nextRate) {
      const elapsedMs = elapsedAt();
      anchorElapsedMs = elapsedMs;
      anchorServerMs = serverNow();
      playbackRate = Math.max(0.05, Number(nextRate) || 1);
      if (running) {
        if (timer !== null) cancel(timer);
        emit();
      }
    },
    getElapsedMs: () => elapsedAt(),
    getRate: () => playbackRate,
    isRunning: () => running,
    isCompleted: () => completed,
  };
}
