export const MATCH_TIMELINE_VERSION = 3;

const clamp = (minimum, maximum, value) =>
  Math.max(minimum, Math.min(maximum, Number(value) || 0));

function quietDuration(seconds) {
  return clamp(90, 760, 95 + Math.sqrt(Math.max(0, seconds)) * 18);
}

function actionDuration(event) {
  return 440 + 390 * Number(event?.presentationWeight || 1);
}

function orderedMatchEvents(events = []) {
  return events.slice().sort((left, right) =>
    Number(left.matchSecond || left.minute * 60) -
    Number(right.matchSecond || right.minute * 60));
}

function appendClockSegment(timeline, phase, startAtMs, endAtMs, fromSecond, toSecond, stoppageBase) {
  if (endAtMs <= startAtMs) return;
  timeline.clockSegments.push({
    phase,
    startAtMs: Math.round(startAtMs),
    endAtMs: Math.round(endAtMs),
    fromSecond: Number(fromSecond),
    toSecond: Number(toSecond),
    stoppageBase: Number(stoppageBase),
  });
}

function appendPeriod(timeline, {
  phase,
  events,
  startSecond,
  endSecond,
  stoppageBase,
}) {
  const periodStartAtMs = timeline.durationMs;
  let currentSecond = startSecond;
  let cursor = periodStartAtMs;

  for (const event of orderedMatchEvents(events)) {
    const fallbackSecond = Number(event.minute || 0) * 60;
    const eventSecond = clamp(currentSecond, endSecond, Number(event.matchSecond) || fallbackSecond);
    const quietMs = eventSecond > currentSecond
      ? quietDuration(eventSecond - currentSecond)
      : 0;
    appendClockSegment(
      timeline,
      phase,
      cursor,
      cursor + quietMs,
      currentSecond,
      eventSecond,
      stoppageBase,
    );
    cursor += quietMs;
    if (event.goal) {
      timeline.events.push({
        id: `${phase}-suspense-${timeline.events.length + 1}`,
        type: "suspense",
        phase,
        atMs: Math.round(cursor),
        endAtMs: Math.round(cursor + 1_500),
        label: event.signatureMoment ? "TITAN MOMENT" : "CHANCE!",
        side: event.side,
        matchSecond: eventSecond,
      });
      cursor += 1_500;
    }
    timeline.events.push({
      id: `${phase}-${timeline.events.length + 1}`,
      type: "match-event",
      phase,
      atMs: Math.round(cursor),
      matchSecond: eventSecond,
      event: { ...event, matchSecond: eventSecond },
    });
    if (event.goal) {
      timeline.events.push({
        id: `${phase}-goal-${timeline.events.length + 1}`,
        type: "suspense",
        kind: "goal",
        phase,
        atMs: Math.round(cursor),
        endAtMs: Math.round(cursor + 1_250),
        label: "GOAL!",
        side: event.side,
        matchSecond: eventSecond,
      });
      cursor += 1_250;
    }

    const actionEndSecond = Math.min(
      endSecond,
      Math.max(eventSecond, eventSecond + Number(event.actionSeconds || 6)),
    );
    const actionMs = actionDuration(event);
    appendClockSegment(
      timeline,
      phase,
      cursor,
      cursor + actionMs,
      eventSecond,
      actionEndSecond,
      stoppageBase,
    );
    cursor += actionMs;
    currentSecond = actionEndSecond;
  }

  if (currentSecond < endSecond) {
    const finalMs = clamp(120, 850, 110 + Math.sqrt(endSecond - currentSecond) * 18);
    appendClockSegment(
      timeline,
      phase,
      cursor,
      cursor + finalMs,
      currentSecond,
      endSecond,
      stoppageBase,
    );
    cursor += finalMs;
  }

  timeline.periods.push({
    phase,
    startAtMs: Math.round(periodStartAtMs),
    endAtMs: Math.round(cursor),
    startSecond,
    endSecond,
    stoppageBase,
  });
  timeline.events.push({
    id: `${phase}-end`,
    type: "phase-end",
    phase,
    atMs: Math.round(cursor),
    matchSecond: endSecond,
  });
  timeline.durationMs = Math.round(cursor);
}

export function createCanonicalMatchTimeline(result) {
  const timeline = {
    version: MATCH_TIMELINE_VERSION,
    durationMs: 0,
    periods: [],
    clockSegments: [],
    events: [],
    final: {
      userGoals: Number(result?.userGoals || 0),
      rivalGoals: Number(result?.rivalGoals || 0),
      shootout: Array.isArray(result?.shootout) ? result.shootout.map(Number) : null,
      userWon: Boolean(result?.userWon),
    },
  };

  appendPeriod(timeline, {
    phase: "regulation",
    events: result?.events,
    startSecond: 0,
    endSecond: Number(result?.regulationEndSecond) || 90 * 60,
    stoppageBase: 90 * 60,
  });

  if (result?.hasExtraTime) {
    appendPeriod(timeline, {
      phase: "extra-time",
      events: result.extraTimeEvents,
      startSecond: 90 * 60,
      endSecond: Number(result.extraTimeEndSecond) || 120 * 60,
      stoppageBase: 120 * 60,
    });
  }

  if (Array.isArray(result?.penaltyEvents) && result.penaltyEvents.length) {
    const startAtMs = timeline.durationMs;
    result.penaltyEvents.forEach((attempt) => {
      timeline.events.push({
        id: `penalty-suspense-${timeline.events.length + 1}`,
        type: "suspense",
        phase: "penalties",
        atMs: timeline.durationMs,
        endAtMs: timeline.durationMs + 900,
        label: "PENALTY",
        side: "",
        matchSecond: null,
      });
      timeline.durationMs += 900;
      timeline.durationMs += 260;
      timeline.events.push({
        id: `penalty-${timeline.events.length + 1}`,
        type: "penalty",
        phase: "penalties",
        atMs: timeline.durationMs,
        attempt: { ...attempt },
      });
    });
    timeline.periods.push({
      phase: "penalties",
      startAtMs,
      endAtMs: timeline.durationMs,
      startSecond: null,
      endSecond: null,
      stoppageBase: null,
    });
  }

  timeline.events.push({
    id: "match-complete",
    type: "complete",
    phase: "complete",
    atMs: timeline.durationMs,
  });
  return timeline;
}

export function createInitialMatchState() {
  return {
    elapsedMs: 0,
    matchSecond: 0,
    stoppageBase: 90 * 60,
    phase: "regulation",
    userGoals: 0,
    rivalGoals: 0,
    penaltyUserGoals: 0,
    penaltyRivalGoals: 0,
    commentary: [],
    cards: [],
    penalties: [],
    latestEvent: null,
    suspense: null,
    possession: { user: 50, opponent: 50, windowMinutes: 10, dominantSide: "" },
    pitch: null,
    completed: false,
  };
}

function rollingPossession(events, matchSecond, windowSeconds = 10 * 60) {
  const startSecond = Math.max(0, Number(matchSecond) - windowSeconds);
  const recent = events.filter((event) =>
    !event.card && Number(event.matchSecond) >= startSecond &&
    Number(event.matchSecond) <= Number(matchSecond));
  let user = 1;
  let opponent = 1;
  for (const event of recent) {
    const weight = (event.goal ? 2.8 : event.kind === "chance" ? 2 : 1)
      * (event.pressureWave ? 1.35 : 1)
      * (event.signatureMoment ? 1.12 : 1);
    if (event.side === "user") user += weight;
    else opponent += weight;
  }
  const total = user + opponent;
  const userPercent = Math.round(user / total * 100);
  const clampedUser = clamp(8, 92, userPercent);
  return {
    user: clampedUser,
    opponent: 100 - clampedUser,
    windowMinutes: windowSeconds / 60,
    dominantSide: clampedUser >= 58 ? "user" : clampedUser <= 42 ? "opponent" : "",
  };
}

function clockStateAt(timeline, elapsedMs) {
  let latest = { matchSecond: 0, stoppageBase: 90 * 60, phase: "regulation" };
  for (const segment of timeline.clockSegments || []) {
    if (elapsedMs < segment.startAtMs) break;
    if (elapsedMs >= segment.endAtMs) {
      latest = {
        matchSecond: segment.toSecond,
        stoppageBase: segment.stoppageBase,
        phase: segment.phase,
      };
      continue;
    }
    const progress = clamp(
      0,
      1,
      (elapsedMs - segment.startAtMs) / Math.max(1, segment.endAtMs - segment.startAtMs),
    );
    const eased = 1 - (1 - progress) ** 2;
    return {
      matchSecond: segment.fromSecond + (segment.toSecond - segment.fromSecond) * eased,
      stoppageBase: segment.stoppageBase,
      phase: segment.phase,
    };
  }
  return latest;
}

export function reduceMatchTimeline(timeline, elapsedMs) {
  const state = createInitialMatchState();
  state.elapsedMs = clamp(0, Number(timeline?.durationMs || 0), elapsedMs);
  Object.assign(state, clockStateAt(timeline || {}, state.elapsedMs));

  for (const entry of timeline?.events || []) {
    if (entry.atMs > state.elapsedMs) break;
    if (entry.type === "match-event") {
      const event = {
        ...entry.event,
        timelineId: entry.id,
        timelineAtMs: entry.atMs,
        timelinePhase: entry.phase,
      };
      state.latestEvent = event;
      state.commentary.push(event);
      if (event.goal) {
        if (event.side === "user") state.userGoals += 1;
        else state.rivalGoals += 1;
      }
      if (event.card) state.cards.push(event);
      state.pitch = {
        side: event.side,
        zoneFrom: event.zoneFrom,
        zoneTo: event.zoneTo,
        action: event.action || event.kind,
        possession: event.possessionAfter || event.side,
      };
    } else if (entry.type === "suspense") {
      if (state.elapsedMs < entry.endAtMs) state.suspense = entry;
    } else if (entry.type === "penalty") {
      state.phase = "penalties";
      state.penalties.push(entry.attempt);
      if (entry.attempt.userScored) state.penaltyUserGoals += 1;
      if (entry.attempt.opponentScored) state.penaltyRivalGoals += 1;
    } else if (entry.type === "complete") {
      state.phase = "complete";
      state.completed = true;
    }
  }
  state.possession = rollingPossession(state.commentary, state.matchSecond);
  return state;
}
