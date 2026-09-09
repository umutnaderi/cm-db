export const HIGHLIGHT_MODES = ["full", "comprehensive", "extended", "key", "commentary"];

export function highlightImportance(event) {
  const code = String(event.code ?? "");
  if (event.outcome === "goal" || event.badge === "GOAL") return 3;
  if (/GOAL(\.|$)|CARD\.(RED|SECOND_YELLOW)|PENALTY/.test(code) && !/GOAL_KICK/.test(code)) return 3;
  if (event.movement === "shot" || event.movement === "header" || /SAVE|POST|BAR/.test(code)) {
    const distance = event.metrics?.distanceToGoalMetres ?? event.metrics?.distanceMetres
      ?? (event.ballFrom && event.ballTo
        ? Math.hypot((event.ballTo.x - event.ballFrom.x) * 0.75, (event.ballTo.y - event.ballFrom.y) * 1.2) * 0.9144
        : null);
    return distance == null || distance <= 25 || /SAVE|POST|BAR/.test(code) ? 3 : 2;
  }
  if (/THROUGH|CROSS|CARD\.YELLOW/.test(code) || event.movement === "cross") return 2;
  if (/RESTART.*TAKE|D\.DUEL|D\.INTERCEPT/.test(code)) return 1;
  return 0;
}

// Windows point INTO the complete simulation tape. No event is removed and
// no random number is drawn here, so viewing mode cannot affect the match.
export function buildHighlightWindows(trace, plan, mode = "full") {
  if (mode === "full") return [{ startMs: 0, endMs: plan.durationMs }];
  if (mode === "commentary") return [];
  const threshold = { comprehensive: 1, extended: 2, key: 3 }[mode] ?? 3;
  const lead = { comprehensive: 12000, extended: 9000, key: 7000 }[mode] ?? 7000;
  const windows = plan.intervals.filter((interval) => highlightImportance(trace[interval.eventIndex] ?? {}) >= threshold)
    .map((interval) => ({ startMs: Math.max(0, interval.startMs - lead), endMs: Math.min(plan.durationMs, interval.endMs + 3000) }))
    .sort((a, b) => a.startMs - b.startMs);
  const merged = [];
  for (const window of windows) {
    const previous = merged.at(-1);
    if (previous && window.startMs <= previous.endMs + 1000) previous.endMs = Math.max(previous.endMs, window.endMs);
    else merged.push({ ...window });
  }
  return merged;
}

export function isHighlightTime(windows, timeMs) {
  return windows.some((window) => timeMs >= window.startMs && timeMs < window.endMs);
}

// Integrate across boundaries so even a slow browser frame at 40x cannot
// skip the beginning of a chance. Speeds change presentation time only.
export function advanceHighlightTime(timeMs, wallMs, durationMs, windows, during = 1, between = 20) {
  let time = Math.max(0, timeMs), remaining = Math.max(0, wallMs);
  while (remaining > 0 && time < durationMs) {
    const active = windows.find((window) => time >= window.startMs && time < window.endMs);
    const boundary = active?.endMs ?? windows.find((window) => window.startMs > time)?.startMs ?? durationMs;
    const rate = Math.max(0.1, Number(active ? during : between) || 1);
    const cost = (Math.min(durationMs, boundary) - time) / rate;
    if (cost > remaining) return Math.min(durationMs, time + remaining * rate);
    time = Math.min(durationMs, boundary);
    remaining -= cost;
  }
  return time;
}
