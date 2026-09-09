// Simulation produces bounded chunks on its own task queue. Playback consumes
// them at any speed; pausing or hiding the pitch never changes simulation RNG.
export function createMatchSession({ simulate, onReady = () => {}, onStatus = () => {},
  durationMs = 90 * 60 * 1000, schedule = (fn) => setTimeout(fn, 0),
  cancel = clearTimeout, maxBuffered = 12, initialElapsedMs = 0,
  initialIndex = 0, initialContinuation = null } = {}) {
  let elapsedMs = initialElapsedMs, index = initialIndex, continuation = initialContinuation, stopped = false, timer = null;
  let complete = false;
  const queue = [];
  function report(error = null) { onStatus({ elapsedMs, complete, stopped, buffered: queue.length, error }); }
  function pump() {
    timer = null;
    if (stopped || complete || queue.length >= maxBuffered) return;
    try {
      const chunk = simulate({ index, continuation, elapsedMs, remainingMs: durationMs - elapsedMs });
      if (!(chunk.durationMs > 0)) throw new Error("The engine produced no elapsed play; match simulation stopped.");
      chunk.startMs = elapsedMs;
      chunk.index = index;
      elapsedMs += Math.min(chunk.durationMs, durationMs - elapsedMs);
      chunk.endMs = elapsedMs;
      continuation = chunk.continuation;
      index += 1;
      complete = elapsedMs >= durationMs;
      queue.push(chunk);
      report();
      onReady();
      if (timer === null && !complete && !stopped && queue.length < maxBuffered) timer = schedule(pump);
    } catch (error) { stopped = true; report(error); }
  }
  return {
    start() { if (timer === null && !stopped && !complete) timer = schedule(pump); },
    take() {
      const chunk = queue.shift() ?? null;
      if (timer === null && !stopped && !complete) timer = schedule(pump);
      return chunk;
    },
    peek() { return queue[0] ?? null; },
    stop() { stopped = true; if (timer !== null) cancel(timer); timer = null; report(); },
    getState() { return { elapsedMs, complete, stopped, buffered: queue.length }; },
  };
}
