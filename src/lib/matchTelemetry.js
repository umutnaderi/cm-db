const HEAT_COLUMNS = 8;
const HEAT_ROWS = 12;
const TEN_MINUTES_MS = 10 * 60 * 1000;

const clamp = (min, max, value) => Math.max(min, Math.min(max, value));
const distanceYards = (a, b) => Math.hypot(
  ((Number(b?.x) || 0) - (Number(a?.x) || 0)) * 0.75,
  ((Number(b?.y) || 0) - (Number(a?.y) || 0)) * 1.2,
);

function emptyHeat() {
  return Array.from({ length: HEAT_COLUMNS * HEAT_ROWS }, () => 0);
}

function playerLabel(entry) {
  const player = entry?.player ?? {};
  return player.name || player.displayName || player.Name || player.full_name
    || [player.first_name, player.second_name].filter(Boolean).join(" ")
    || String(entry?.id ?? "Player");
}

function heatIndex(point) {
  const column = clamp(0, HEAT_COLUMNS - 1, Math.floor(clamp(0, 99.999, Number(point?.x) || 0) / 100 * HEAT_COLUMNS));
  const row = clamp(0, HEAT_ROWS - 1, Math.floor(clamp(0, 99.999, Number(point?.y) || 0) / 100 * HEAT_ROWS));
  return row * HEAT_COLUMNS + column;
}

export function createMatchTelemetry(roster = []) {
  return {
    nowMs: 0,
    lastFrameMs: null,
    lastOwnerId: null,
    lastPossessionTeam: null,
    lastFrameInPlay: true,
    lastPositions: {},
    possessionSegments: [],
    seenEvents: new Set(),
    commentary: [],
    players: Object.fromEntries(roster.map((entry) => [String(entry.id), {
      id: String(entry.id),
      team: entry.team,
      name: playerLabel(entry),
      distanceYards: 0,
      passesSuccessful: 0,
      passesTotal: 0,
      keyPasses: 0,
      shotsOnTarget: 0,
      shotsMissed: 0,
      heat: emptyHeat(),
    }])),
  };
}

function appendPossession(telemetry, team, startMs, endMs) {
  if (!team || endMs <= startMs) return;
  const last = telemetry.possessionSegments.at(-1);
  if (last?.team === team && Math.abs(last.endMs - startMs) < 1) last.endMs = endMs;
  else telemetry.possessionSegments.push({ team, startMs, endMs });
  const cutoff = endMs - TEN_MINUTES_MS - 60000;
  while (telemetry.possessionSegments[0]?.endMs < cutoff) telemetry.possessionSegments.shift();
}

export function observeMatchFrame(telemetry, { timeMs, players = {}, ownerId = null, inPlay = true } = {}) {
  if (!telemetry || !Number.isFinite(timeMs)) return telemetry;
  const previousTime = telemetry.lastFrameMs;
  // Playback can be replayed or stepped backward. Match totals follow the
  // furthest match clock reached and must not count the same football twice.
  if (previousTime !== null && timeMs <= telemetry.nowMs) return telemetry;
  const elapsed = previousTime === null ? 0 : Math.max(0, timeMs - previousTime);
  const owner = telemetry.players[String(ownerId ?? "")];
  if (telemetry.lastFrameInPlay) {
    appendPossession(telemetry, telemetry.lastPossessionTeam ?? owner?.team, previousTime ?? timeMs, timeMs);
  }
  for (const [id, point] of Object.entries(players)) {
    const stats = telemetry.players[String(id)];
    if (!stats || !point) continue;
    const previous = telemetry.lastPositions[String(id)];
    if (previous) stats.distanceYards += distanceYards(previous, point);
    if (elapsed > 0) stats.heat[heatIndex(point)] += elapsed;
    telemetry.lastPositions[String(id)] = { ...point };
  }
  telemetry.lastFrameMs = timeMs;
  telemetry.lastOwnerId = ownerId;
  telemetry.lastFrameInPlay = Boolean(inPlay);
  if (owner?.team) telemetry.lastPossessionTeam = owner.team;
  telemetry.nowMs = Math.max(telemetry.nowMs, timeMs);
  return telemetry;
}

function isPass(event) {
  return event?.contact?.type === "pass" && event?.movement === "pass";
}

function isShot(event) {
  return event?.contact?.type === "shot" || event?.movement === "shot";
}

function eventTeam(event, telemetry) {
  return telemetry.players[String(event?.actorId ?? "")]?.team ?? null;
}

function passResolution(trace, index, team, telemetry) {
  let successful = false;
  let keyPass = false;
  for (let cursor = index + 1; cursor < trace.length; cursor += 1) {
    const event = trace[cursor];
    if (isPass(event)) break;
    if (String(event.code || "").includes("LOST") || event.outcome === "turnover") break;
    const receiver = telemetry.players[String(event.ownerAfterId ?? "")];
    if (receiver?.team === team) successful = true;
    if (isShot(event) && eventTeam(event, telemetry) === team) keyPass = true;
    if (event.code === "ACTION.CHOICE") {
      const choiceTeam = eventTeam(event, telemetry);
      if (choiceTeam !== team) break;
      keyPass = event.metrics?.selectedAction === "shoot";
      break;
    }
  }
  return { successful, keyPass: successful && keyPass };
}

function commentaryText(event, telemetry, matchTimeMs) {
  const name = telemetry.players[String(event?.actorId ?? "")]?.name;
  const minute = Math.max(1, Math.ceil(matchTimeMs / 60000));
  const code = String(event?.code || "");
  if (code === "ACTION.CHOICE" || /^(ATT|DEF|GK)\.ADJUST$/.test(code)
    || code.startsWith("MOTION.") || code === "RESTART.WAIT") return null;
  const text = String(event?.label || event?.description || event?.outcome || "").trim();
  if (!text) return null;
  return { minute, timeMs: matchTimeMs, team: eventTeam(event, telemetry), text: name && !text.includes(name) ? `${name}: ${text}` : text };
}

export function observeMatchEvent(telemetry, { trace = [], eventIndex, chunkIndex = 0, matchTimeMs = 0 } = {}) {
  if (!telemetry || !Number.isInteger(eventIndex)) return telemetry;
  const key = `${chunkIndex}:${eventIndex}`;
  if (telemetry.seenEvents.has(key)) return telemetry;
  telemetry.seenEvents.add(key);
  const event = trace[eventIndex];
  const stats = telemetry.players[String(event?.actorId ?? "")];
  if (stats && isPass(event)) {
    const resolution = passResolution(trace, eventIndex, stats.team, telemetry);
    stats.passesTotal += 1;
    if (resolution.successful) stats.passesSuccessful += 1;
    if (resolution.keyPass) stats.keyPasses += 1;
  }
  if (stats && isShot(event)) {
    if (event.outcome === "success" || event.outcome === "goal" || event.onTarget === true) stats.shotsOnTarget += 1;
    else stats.shotsMissed += 1;
  }
  const line = commentaryText(event, telemetry, matchTimeMs);
  if (line) {
    telemetry.commentary.push(line);
    if (telemetry.commentary.length > 8) telemetry.commentary.splice(0, telemetry.commentary.length - 8);
  }
  return telemetry;
}

export function lastTenMinutePossession(telemetry, nowMs = telemetry?.nowMs ?? 0) {
  const startMs = Math.max(0, nowMs - TEN_MINUTES_MS);
  const totals = { home: 0, away: 0 };
  for (const segment of telemetry?.possessionSegments ?? []) {
    const overlap = Math.max(0, Math.min(nowMs, segment.endMs) - Math.max(startMs, segment.startMs));
    if (segment.team in totals) totals[segment.team] += overlap;
  }
  const total = totals.home + totals.away;
  return total > 0
    ? { home: totals.home / total * 100, away: totals.away / total * 100 }
    : { home: 50, away: 50 };
}

export function heatForScope(telemetry, scope) {
  if (!telemetry) return emptyHeat();
  if (scope?.startsWith("player:")) return [...(telemetry.players[scope.slice(7)]?.heat ?? emptyHeat())];
  const team = scope?.startsWith("team:") ? scope.slice(5) : "home";
  const heat = emptyHeat();
  for (const player of Object.values(telemetry.players)) {
    if (player.team !== team) continue;
    player.heat.forEach((value, index) => { heat[index] += value; });
  }
  return heat;
}

export function statsForTeam(telemetry, team) {
  const totals = {
    id: `team:${team}`,
    team,
    name: team === "away" ? "Away team" : "Home team",
    distanceYards: 0,
    passesSuccessful: 0,
    passesTotal: 0,
    keyPasses: 0,
    shotsOnTarget: 0,
    shotsMissed: 0,
  };
  for (const player of Object.values(telemetry?.players ?? {})) {
    if (player.team !== team) continue;
    totals.distanceYards += Number(player.distanceYards) || 0;
    totals.passesSuccessful += Number(player.passesSuccessful) || 0;
    totals.passesTotal += Number(player.passesTotal) || 0;
    totals.keyPasses += Number(player.keyPasses) || 0;
    totals.shotsOnTarget += Number(player.shotsOnTarget) || 0;
    totals.shotsMissed += Number(player.shotsMissed) || 0;
  }
  return totals;
}

export { HEAT_COLUMNS, HEAT_ROWS };
