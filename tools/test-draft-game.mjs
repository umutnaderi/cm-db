import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import {
  createDraftSquad,
  formatDraftSquadText,
} from "../src/lib/draftSquad.js";
import {
  MATCH_TIMELINE_VERSION,
  createCanonicalMatchTimeline,
  reduceMatchTimeline,
} from "../src/lib/matchTimeline.js";
import {
  createMatchPlaybackController,
  estimateServerClockOffset,
} from "../src/lib/matchPlayback.js";
import * as matchEngineCore from "../src/lib/matchEngineCore.js";

// The sandboxed draft-run.js tests below inline matchEngineCore.js's source
// into the VM sandbox (see the comment at its runSource construction) so
// cross-realm assert.deepEqual comparisons work -- but that means nothing
// else in this file actually exercises matchEngineCore.js as an ordinary ES
// module import. This does, because that's exactly how match-lab.js will
// consume it (see MATCH_LAB_PLAN.md): a plain `import` in a real browser
// module context, no VM sandbox involved.
{
  const attacker = {
    current_ability: 150,
    attributes: [
      { label: "Composure", value: 14 },
      { label: "Technique", value: 15 },
      { label: "Finishing", value: 16 },
      { label: "Flair", value: 12 },
    ],
  };
  const random = matchEngineCore.seededRandom(matchEngineCore.hashString("module-import-sanity"));
  assert.ok(
    ["calm", "blast", "finesse"].includes(matchEngineCore.selectFinishType(attacker, random)),
  );
  const composureDetail = matchEngineCore.engineAttributeDetail(attacker, "Composure");
  assert.equal(composureDetail.value, 14);
  assert.equal(composureDetail.source, "direct");
  assert.equal(matchEngineCore.MIRRORED_ZONE[0], 11);

  // Free-kick shot-conversion calibration exports (see MATCH_LAB_PLAN.md) --
  // real module resolution, not just node --check, since a missing/
  // misspelled export wouldn't be caught by syntax-checking alone.
  assert.equal(typeof matchEngineCore.freeKickContextMultiplier, "function");
  assert.ok(matchEngineCore.freeKickContextMultiplier(1) > matchEngineCore.freeKickContextMultiplier(10));
  for (const key of ["fk-regular", "fk-hard", "fk-curl"]) {
    assert.ok(matchEngineCore.KEEPER_DUEL_LABELS[key].attack.includes("Free Kick Taking"));
  }
  const fkTaker = {
    current_ability: 177,
    attributes: [{ label: "Free Kick Taking", value: 19 }, { label: "Technique", value: 18 }],
  };
  const fkKeeper = {
    current_ability: 168,
    attributes: [{ label: "Reflexes", value: 17 }, { label: "Positioning", value: 16 }],
  };
  const fkRandom = matchEngineCore.seededRandom(matchEngineCore.hashString("fk-save-sanity"));
  const fkSave = matchEngineCore.resolveKeeperSave(fkTaker, fkKeeper, "fk-regular", 45, fkRandom, 1, 1);
  assert.ok(typeof fkSave.goal === "boolean" && typeof fkSave.code === "string");
  // Open-play/header finish types must be byte-for-byte unaffected by a
  // non-1 contextMultiplier this pass -- confirms resolveKeeperSave()'s
  // branch really is structurally incapable of touching those paths, not
  // just "nobody currently passes anything else."
  const openPlayShooter = {
    current_ability: 150,
    attributes: [{ label: "Composure", value: 14 }, { label: "Technique", value: 14 }, { label: "Finishing", value: 14 }],
  };
  const openPlayKeeper = { current_ability: 150, attributes: [{ label: "Reflexes", value: 13 }, { label: "Positioning", value: 13 }] };
  const neutralRandom1 = matchEngineCore.seededRandom(matchEngineCore.hashString("open-play-context-neutral"));
  const neutralRandom2 = matchEngineCore.seededRandom(matchEngineCore.hashString("open-play-context-neutral"));
  const resultWithDefaultContext = matchEngineCore.resolveKeeperSave(openPlayShooter, openPlayKeeper, "calm", 45, neutralRandom1, 1);
  const resultWithExplicitContext = matchEngineCore.resolveKeeperSave(openPlayShooter, openPlayKeeper, "calm", 45, neutralRandom2, 1, 2.5);
  assert.deepEqual(resultWithDefaultContext, resultWithExplicitContext, "A non-1 contextMultiplier must not change open-play outcomes this pass");
}

const timelineResult = {
  userGoals: 2,
  rivalGoals: 1,
  userWon: true,
  hasExtraTime: true,
  regulationEndSecond: 90 * 60 + 60,
  extraTimeEndSecond: 120 * 60,
  events: [
    {
      minute: 12,
      matchSecond: 12 * 60 + 8,
      side: "user",
      kind: "goal",
      goal: true,
      scorer: "Home Forward",
      text: "Home Forward scores.",
      zoneFrom: 4,
      zoneTo: 1,
      action: "shot",
      possessionAfter: "opponent",
      actionSeconds: 7,
      presentationWeight: 1.65,
    },
    {
      minute: 44,
      matchSecond: 44 * 60 + 20,
      side: "opponent",
      kind: "card",
      card: "yellow",
      scorer: "Away Defender",
      text: "Away Defender is booked.",
      zoneFrom: 7,
      zoneTo: 7,
      action: "card",
      possessionAfter: "user",
      actionSeconds: 5,
      presentationWeight: 1.25,
    },
  ],
  extraTimeEvents: [
    {
      minute: 105,
      matchSecond: 105 * 60 + 2,
      side: "opponent",
      kind: "goal",
      goal: true,
      scorer: "Away Forward",
      text: "Away Forward scores.",
      zoneFrom: 3,
      zoneTo: 1,
      action: "shot",
      possessionAfter: "user",
      actionSeconds: 6,
      presentationWeight: 1.65,
    },
    {
      minute: 118,
      matchSecond: 118 * 60 + 11,
      side: "user",
      kind: "goal",
      goal: true,
      scorer: "Home Midfielder",
      text: "Home Midfielder scores.",
      zoneFrom: 6,
      zoneTo: 1,
      action: "shot",
      possessionAfter: "opponent",
      actionSeconds: 6,
      presentationWeight: 1.65,
    },
  ],
  shootout: null,
  penaltyEvents: [],
};
const canonicalTimeline = createCanonicalMatchTimeline(timelineResult);
assert.equal(canonicalTimeline.version, MATCH_TIMELINE_VERSION);
assert.deepEqual(canonicalTimeline, createCanonicalMatchTimeline(timelineResult));
assert.deepEqual(JSON.parse(JSON.stringify(canonicalTimeline)), canonicalTimeline);
assert.deepEqual(canonicalTimeline.periods.map((period) => period.phase), [
  "regulation",
  "extra-time",
]);
const canonicalMatchEvents = canonicalTimeline.events.filter((event) => event.type === "match-event");
assert.equal(canonicalMatchEvents.length, 4);
const suspenseEvents = canonicalTimeline.events.filter((event) => event.type === "suspense");
assert.equal(suspenseEvents.length, 6);
assert.equal(suspenseEvents[0].endAtMs - suspenseEvents[0].atMs, 1_500);
const suspenseState = reduceMatchTimeline(canonicalTimeline, suspenseEvents[0].atMs + 500);
assert.equal(suspenseState.suspense.label, "CHANCE!");
assert.equal(suspenseEvents[1].kind, "goal");
assert.equal(suspenseEvents[1].label, "GOAL!");
assert.equal(suspenseEvents[1].endAtMs - suspenseEvents[1].atMs, 1_250);
const goalEmphasisState = reduceMatchTimeline(canonicalTimeline, suspenseEvents[1].atMs + 500);
assert.equal(goalEmphasisState.suspense.label, "GOAL!");
assert.equal(goalEmphasisState.userGoals, 1);
const beforeFirstGoal = reduceMatchTimeline(canonicalTimeline, canonicalMatchEvents[0].atMs - 1);
assert.equal(beforeFirstGoal.userGoals, 0);
const afterFirstGoal = reduceMatchTimeline(canonicalTimeline, canonicalMatchEvents[0].atMs);
assert.equal(afterFirstGoal.userGoals, 1);
assert.equal(afterFirstGoal.latestEvent.scorer, "Home Forward");
assert.ok(afterFirstGoal.possession.user > afterFirstGoal.possession.opponent);
assert.equal(afterFirstGoal.possession.windowMinutes, 10);
const finalTimelineState = reduceMatchTimeline(canonicalTimeline, canonicalTimeline.durationMs);
assert.equal(finalTimelineState.userGoals, 2);
assert.equal(finalTimelineState.rivalGoals, 1);
assert.equal(finalTimelineState.cards.length, 1);
assert.equal(finalTimelineState.commentary.length, 4);
assert.equal(finalTimelineState.phase, "complete");
assert.equal(finalTimelineState.completed, true);
assert.equal(finalTimelineState.pitch.possession, "opponent");
const shootoutTimeline = createCanonicalMatchTimeline({
  ...timelineResult,
  shootout: [1, 0],
  penaltyEvents: [{
    round: 1,
    userTaker: "Home Forward",
    opponentTaker: "Away Forward",
    userScored: true,
    opponentScored: false,
  }],
});
const shootoutState = reduceMatchTimeline(shootoutTimeline, shootoutTimeline.durationMs);
assert.equal(shootoutState.penaltyUserGoals, 1);
assert.equal(shootoutState.penaltyRivalGoals, 0);
assert.equal(shootoutState.penalties.length, 1);
assert.equal(estimateServerClockOffset([
  { sentAt: 1_000, serverNow: 1_150, receivedAt: 1_200 },
  { sentAt: 2_000, serverNow: 2_145, receivedAt: 2_190 },
  { sentAt: 3_000, serverNow: 3_400, receivedAt: 2_900 },
]), 50);
let playbackNow = 10_000;
let renderedPlaybackState = null;
const playbackController = createMatchPlaybackController({
  timeline: canonicalTimeline,
  now: () => playbackNow,
  schedule: () => 1,
  cancel: () => {},
  onState: (state) => {
    renderedPlaybackState = state;
  },
});
void playbackController.start({ startAt: playbackNow });
assert.equal(renderedPlaybackState.matchSecond, 0);
playbackNow += canonicalMatchEvents[0].atMs;
playbackController.resync();
assert.equal(renderedPlaybackState.userGoals, 1);
playbackController.seek(canonicalTimeline.durationMs);
assert.equal(renderedPlaybackState.completed, true);
playbackController.stop();

const shareTeam = {
  teamName: "Seeded XI",
  formation: "4-3-3",
  style: "Balanced",
  players: Array.from({ length: 11 }, (_, index) => ({
    role: index === 0 ? "GK" : index < 5 ? "DC" : index < 8 ? "MC" : "FC",
    overall: 70 + index,
    isCaptain: index === 7,
    player: {
      database_slug: `db-${index % 4}`,
      source_person_id: `player-${index}`,
      display_name: `Player ${index}`,
      current_ability: 140 + index,
      database_title: "2003/2004",
      club_name: "Example FC",
    },
  })),
};
const sharedSquad = createDraftSquad(shareTeam);
assert.match(sharedSquad.seed, /^XI-[A-Z0-9]{10,18}$/);
assert.equal(sharedSquad.players.length, 11);
assert.equal(sharedSquad.players.filter((player) => player.captain).length, 1);
assert.equal(createDraftSquad(shareTeam).seed, sharedSquad.seed);
assert.match(formatDraftSquadText(sharedSquad), /MC · Player 7 \(C\)/);

const setupSource = fs.readFileSync(new URL("../draft-setup.js", import.meta.url), "utf8")
  .replace(/^(?:import[\s\S]*?;\r?\n)+/, "")
  .split("Object.keys(formations).forEach")[0]
  .concat(`
    const expected = {
      "3-4-3": {
        Defensive: ["ML", "DMC", "MC", "MR"],
      },
      "3-4-1-2": {
        Defensive: ["ML", "DMC", "DMC", "MR", "AMC"],
        Attacking: ["AML", "MC", "MC", "AMR", "AMC"],
      },
      "3-5-2": {
        Defensive: ["ML", "MC", "DMC", "MC", "MR"],
        Balanced: ["ML", "MC", "MC", "MC", "MR"],
        Attacking: ["ML", "MC", "AMC", "MC", "MR"],
      },
      "4-5-1": {
        Defensive: ["ML", "MC", "DMC", "MC", "MR"],
        Attacking: ["ML", "MC", "AMC", "MC", "MR"],
      },
      "4-2-2-2": {
        Defensive: ["DMC", "DMC", "ML", "MR"],
        Attacking: ["MC", "MC", "FL", "FR"],
      },
    };
    for (const [formation, styles] of Object.entries(expected)) {
      for (const [style, roles] of Object.entries(styles)) {
        state.formation = formation;
        state.style = style;
        const actual = currentSlots()
          .map((item) => item.effectiveRole)
          .filter((role) => !["GK", "DL", "DC", "DR", "WBL", "WBR"].includes(role))
          .slice(0, roles.length);
        globalThis.assert.deepEqual(actual, roles, formation + " " + style);
      }
    }
    state.formation = "3-4-3";
    state.style = "Attacking";
    const mixed = currentSlots().filter((item) => ["MC", "AMC"].includes(item.effectiveRole));
    globalThis.assert.equal(mixed[0].y, mixed[1].y);
    globalThis.assert.deepEqual(mixed.map((item) => item.x), [42, 58]);
    const forwards = currentSlots().filter((item) => ["FL", "FC", "FR"].includes(item.effectiveRole));
    globalThis.assert.equal(forwards.find((item) => item.effectiveRole === "FC").y, 14);
    globalThis.assert.equal(forwards.find((item) => item.effectiveRole === "FL").y, 18);
    globalThis.assert.equal(forwards.find((item) => item.effectiveRole === "FR").y, 18);
    globalThis.assert.deepEqual(
      clubTheme({ canonical_club_name: "Fenerbahçe SK", club_colors: {
        background_colour: "#b00000", foreground_colour: "#0030a0",
      } }),
      { background: "#ffd000", secondary: "#0030a0", foreground: "#0030a0" },
    );
    globalThis.assert.deepEqual(
      clubTheme({ canonical_club_name: "F.C. Barcelona", club_colors: {
        background_colour: "#e00000", foreground_colour: "#e00000",
      } }),
      { background: "#0030a0", secondary: "#a50044", foreground: "#a50044" },
    );
    globalThis.assert.equal(draftedOverall({ current_ability: 200 }), 99);
    globalThis.assert.equal(draftedOverall({ current_ability: 178 }), 89);
    const unratedGoalkeeper = {
      database_slug: "keeper-db",
      source_person_id: "keeper-1",
      current_ability: 150,
      position_text: "GK",
      position_ratings: [],
    };
    globalThis.assert.equal(positionFit(unratedGoalkeeper, "GK").level, "natural");
    globalThis.assert.equal(positionFit(unratedGoalkeeper, "MC").level, "very-awkward");
    globalThis.assert.equal(
      isSupportedPitchFit(positionFit(unratedGoalkeeper, "MC")),
      false,
    );
    globalThis.assert.equal(positionAbilityMultiplier(unratedGoalkeeper, "MC"), 0.35);
    const centralDefenderWithoutRightSide = {
      database_slug: "zorc-db",
      source_person_id: "zorc",
      current_ability: 150,
      position_text: "D/DM C",
      position_ratings: [
        { label: "defender", value: 20 },
        { label: "defensive midfielder", value: 20 },
        { label: "central", value: 20 },
        { label: "right side", value: 0 },
      ],
    };
    globalThis.assert.equal(positionFit(centralDefenderWithoutRightSide, "DR").level, "none");
    globalThis.assert.equal(positionAbilityMultiplier(centralDefenderWithoutRightSide, "DR"), 0.25);
    globalThis.assert.equal(
      playerPositionSummary(centralDefenderWithoutRightSide),
      "DC / DMC",
    );
    globalThis.assert.ok(
      !playerPositionSummary(centralDefenderWithoutRightSide).includes("DR"),
      "The card summary must not advertise an unrated leftover position",
    );
    const glonekStyleLegacyDefender = {
      database_slug: "cm9697",
      source_person_id: "glonek",
      current_ability: 130,
      position_text: "SW/D C",
      position_ratings: [
        { label: "sweeper", value: 2 },
        { label: "defender", value: 2 },
        { label: "central", value: 2 },
        { label: "right side", value: 1 },
      ],
    };
    globalThis.assert.equal(
      positionFit(glonekStyleLegacyDefender, "DR").level,
      "limited",
    );
    globalThis.assert.equal(
      isExactLateSlotMatch(glonekStyleLegacyDefender, "DR"),
      false,
      "A hidden legacy side rating must not satisfy an exact late-slot guarantee",
    );
    globalThis.assert.equal(
      isExactLateSlotMatch(glonekStyleLegacyDefender, "DC"),
      true,
    );
    globalThis.assert.equal(
      isExactLateSlotMatch(
        {
          ...glonekStyleLegacyDefender,
          source_person_id: "natural-right-back",
          position_text: "D R",
        },
        "DR",
      ),
      true,
    );
    const morientesSummary = playerPositionSummary({
      position_text: "F C",
      position_ratings: [
        { label: "attacker", value: 20 },
        { label: "central", value: 20 },
      ],
    });
    globalThis.assert.equal(morientesSummary, "FC");
    const leftForward = {
      position_text: "F L",
      position_ratings: [
        { label: "attacker", value: 20 },
        { label: "attacking midfielder", value: 0 },
        { label: "left side", value: 20 },
      ],
    };
    globalThis.assert.equal(positionFit(leftForward, "FL").level, "natural");
    globalThis.assert.equal(positionFit(leftForward, "AML").level, "playable");
    globalThis.assert.equal(playerPositionSummary(leftForward), "FL / AML");
    const rightForward = {
      position_text: "F R",
      position_ratings: [
        { label: "attacker", value: 20 },
        { label: "attacking midfielder", value: 0 },
        { label: "right side", value: 20 },
      ],
    };
    globalThis.assert.equal(positionFit(rightForward, "FR").level, "natural");
    globalThis.assert.equal(positionFit(rightForward, "AMR").level, "playable");
    globalThis.assert.equal(playerPositionSummary(rightForward), "FR / AMR");
    const leftAttackingMidfielder = {
      position_text: "AM L",
      position_ratings: [
        { label: "attacker", value: 0 },
        { label: "attacking midfielder", value: 20 },
        { label: "left side", value: 20 },
      ],
    };
    globalThis.assert.equal(positionFit(leftAttackingMidfielder, "AML").level, "natural");
    globalThis.assert.equal(positionFit(leftAttackingMidfielder, "FL").level, "playable");
    globalThis.assert.equal(playerPositionSummary(leftAttackingMidfielder), "AML / FL");
    const rightAttackingMidfielder = {
      position_text: "AM R",
      position_ratings: [
        { label: "attacker", value: 0 },
        { label: "attacking midfielder", value: 20 },
        { label: "right side", value: 20 },
      ],
    };
    globalThis.assert.equal(positionFit(rightAttackingMidfielder, "AMR").level, "natural");
    globalThis.assert.equal(positionFit(rightAttackingMidfielder, "FR").level, "playable");
    globalThis.assert.equal(playerPositionSummary(rightAttackingMidfielder), "AMR / FR");
    const universalRatings = [
      "goalkeeper", "sweeper", "defender", "defensive midfielder",
      "midfielder", "attacking midfielder", "attacker",
      "left side", "right side", "central",
    ].map((label) => ({ label, value: 20 }));
    const tierAbilities = [190, 175, 162, 150, 130, 105];
    const suggestionPool = tierAbilities.flatMap((ability, tierIndex) => (
      Array.from({ length: 60 }, (_, index) => ({
        database_slug: "db-" + tierIndex + "-" + index,
        source_person_id: tierIndex + "-" + index,
        canonical_player_public_id: "player-" + tierIndex + "-" + index,
        current_ability: ability,
        position_ratings: universalRatings,
      }))
    ));
    const databasePairPool = Array.from({ length: 8 }, (_, databaseIndex) => (
      Array.from({ length: 6 }, (_, playerIndex) => ({
        database_slug: "pair-db-" + databaseIndex,
        source_person_id: "pair-" + databaseIndex + "-" + playerIndex,
        canonical_player_public_id: "pair-player-" + databaseIndex + "-" + playerIndex,
        current_ability: 145,
        position_ratings: universalRatings,
      }))
    )).flat();
    const firstDatabasePair = selectRollDatabases(databasePairPool, 41);
    globalThis.assert.equal(firstDatabasePair.length, 5);
    const pairedRoll = chooseSuggestions(
      databasePairPool.filter((candidate) => firstDatabasePair.includes(candidate.database_slug)),
      41,
    );
    globalThis.assert.equal(pairedRoll.length, 5);
    globalThis.assert.equal(new Set(pairedRoll.map((candidate) => candidate.database_slug)).size, 5);
    for (const database of firstDatabasePair) {
      globalThis.assert.equal(
        pairedRoll.filter((candidate) => candidate.database_slug === database).length,
        1,
      );
    }
    firstDatabasePair.forEach((database) => state.databasesUsedForCurrentPick.add(database));
    const secondDatabasePair = selectRollDatabases(databasePairPool, 42);
    globalThis.assert.equal(secondDatabasePair.length, 5);
    globalThis.assert.equal(
      secondDatabasePair.filter((database) => firstDatabasePair.includes(database)).length,
      2,
      "With eight seasons, a reroll must include all three unseen seasons and two repeats",
    );
    state.databasesUsedForCurrentPick.clear();
    state.drafted.clear();
    const fourSlotFormation = currentSlots();
    for (const item of fourSlotFormation.slice(4)) {
      state.drafted.set(item.id, {
        canonical_player_public_id: "four-slot-drafted-" + item.id,
      });
    }
    const fullLateDatabasePool = Array.from({ length: 8 }, (_, databaseIndex) =>
      Array.from({ length: 5 }, (_, playerIndex) => ({
        database_slug: "late-full-db-" + databaseIndex,
        source_person_id: "late-full-" + databaseIndex + "-" + playerIndex,
        canonical_player_public_id: "late-full-player-" + databaseIndex + "-" + playerIndex,
        current_ability: databaseIndex >= 5 ? 150 + playerIndex : 130 + playerIndex,
        position_ratings: universalRatings,
      })),
    ).flat();
    const fullLateDatabases = selectRollDatabases(fullLateDatabasePool, 45);
    globalThis.assert.equal(
      fullLateDatabases.length,
      8,
      "Four remaining slots must search every eligible database simultaneously",
    );
    const fullLateRoll = chooseSuggestions(fullLateDatabasePool, 45);
    globalThis.assert.equal(fullLateRoll.length, 5);
    globalThis.assert.ok(
      fullLateRoll.filter((candidate) => Number(candidate.current_ability || 0) >= 140).length >= 3,
      "The full late-stage pool must not hide CA 140+ candidates in excluded databases",
    );
    state.drafted.clear();
    const qualityAwarePairPool = [
      "low-a", "low-b", "low-c", "low-d", "low-e",
      "quality-a", "quality-b", "quality-c",
    ]
      .flatMap((database, databaseIndex) => (
        Array.from({ length: 8 }, (_, playerIndex) => ({
          database_slug: database,
          source_person_id: database + "-" + playerIndex,
          canonical_player_public_id: "quality-pair-" + database + "-" + playerIndex,
          current_ability:
            databaseIndex >= 5 && playerIndex < 3 ? 150 : 130,
          position_ratings: universalRatings,
        }))
      ));
    const qualityAwarePair = selectRollDatabases(qualityAwarePairPool, 51);
    globalThis.assert.equal(qualityAwarePair.length, 5);
    for (const database of ["quality-a", "quality-b", "quality-c"]) {
      globalThis.assert.ok(
        qualityAwarePair.includes(database),
        "Database selection should include every quality-capable season when coverage is equal",
      );
    }
    const qualityFloorDatabases = ["floor-a", "floor-b", "floor-c", "floor-d", "floor-e"];
    const qualityFloorPool = qualityFloorDatabases.flatMap((database) => [
      ...Array.from({ length: 8 }, (_, index) => ({
        database_slug: database,
        source_person_id: database + "-low-" + index,
        canonical_player_public_id: database + "-low-player-" + index,
        current_ability: 125 + index,
        position_ratings: universalRatings,
      })),
      ...Array.from({ length: 3 }, (_, index) => ({
        database_slug: database,
        source_person_id: database + "-quality-" + index,
        canonical_player_public_id: database + "-quality-player-" + index,
        current_ability: 145 + index * 8,
        position_ratings: universalRatings,
      })),
    ]);
    for (let seed = 1; seed <= 80; seed += 1) {
      const protectedRoll = chooseSuggestions(qualityFloorPool, seed);
      globalThis.assert.equal(protectedRoll.length, 5);
      globalThis.assert.ok(
        protectedRoll.filter(
          (candidate) => Number(candidate.current_ability || 0) >= 140,
        ).length >= 3,
        "Every full roll should contain at least three CA 140+ choices when available",
      );
      for (const database of qualityFloorDatabases) {
        globalThis.assert.ok(
          protectedRoll.filter(
            (candidate) => candidate.database_slug === database,
          ).length <= 1,
          "Each roll must contain at most one player from each season",
        );
      }
    }
    const belowFloorPool = Array.from({ length: 8 }, (_, index) => ({
      database_slug: "low-db-" + index,
      source_person_id: "low-" + index,
      canonical_player_public_id: "low-player-" + index,
      current_ability: 98,
      position_ratings: universalRatings,
    }));
    globalThis.assert.equal(
      chooseSuggestions(belowFloorPool, 77).length,
      0,
      "Players below CA 100 / OVR 50 must not enter draft rolls",
    );
    state.drafted.clear();
    state.formation = "4-3-3";
    state.style = "Balanced";
    const formationAwarePool = Array.from({ length: 5 }, (_, index) => [
      {
        database_slug: "formation-db-" + index,
        source_person_id: "dmc-only-" + index,
        canonical_player_public_id: "dmc-only-" + index,
        current_ability: 170,
        position_text: "DM C",
        position_ratings: [
          { label: "defensive midfielder", value: 20 },
          { label: "central", value: 20 },
        ],
      },
      {
        database_slug: "formation-db-" + index,
        source_person_id: "fc-fit-" + index,
        canonical_player_public_id: "fc-fit-" + index,
        current_ability: 145,
        position_text: "F C",
        position_ratings: [
          { label: "attacker", value: 20 },
          { label: "central", value: 20 },
        ],
      },
    ]).flat();
    const formationAwareRoll = chooseSuggestions(formationAwarePool, 781);
    globalThis.assert.equal(formationAwareRoll.length, 5);
    globalThis.assert.ok(
      formationAwareRoll.every((candidate) =>
        candidate.canonical_player_public_id.startsWith("fc-fit-"),
      ),
      "A DMC-only player must not be offered when the formation has no DMC slot",
    );
    const tierPulls = [0, 0, 0, 0, 0, 0];
    for (let seed = 1; seed <= 400; seed += 1) {
      for (const candidate of chooseSuggestions(suggestionPool, seed)) {
        tierPulls[abilityDropTier(candidate)] += 1;
      }
    }
    const pullTotal = tierPulls.reduce((sum, count) => sum + count, 0);
    const tierRatios = tierPulls.map((count) => count / pullTotal);
    globalThis.assert.ok(tierRatios[0] > 0.02 && tierRatios[0] < 0.07, JSON.stringify(tierRatios));
    globalThis.assert.ok(tierRatios[1] > 0.15 && tierRatios[1] < 0.27, JSON.stringify(tierRatios));
    globalThis.assert.ok(tierRatios[2] > 0.32 && tierRatios[2] < 0.48, JSON.stringify(tierRatios));
    globalThis.assert.ok(tierRatios[3] > 0.24 && tierRatios[3] < 0.4, JSON.stringify(tierRatios));
    globalThis.assert.equal(tierPulls[4], 0);
    globalThis.assert.equal(tierPulls[5], 0);
    globalThis.assert.ok(tierPulls[2] > tierPulls[1]);
    globalThis.assert.ok(tierPulls[3] > tierPulls[1]);
    state.premiumDrought = 4;
    const protectedPremiumRoll = chooseSuggestions(suggestionPool, 901);
    globalThis.assert.ok(
      protectedPremiumRoll.some((candidate) => {
        const ability = Number(candidate.current_ability || 0);
        return ability >= 170 && ability < 185;
      }),
      "Four premium-free rolls should produce a high-Gold choice",
    );
    state.premiumDrought = 0;
    suggestionPool.slice(0, -1).forEach((candidate) => {
      state.offeredPlayerIds.add(candidateIdentity(candidate));
    });
    const onlyFreshCandidate = suggestionPool.at(-1);
    const freshSuggestions = chooseSuggestions(suggestionPool, 17);
    globalThis.assert.ok(
      freshSuggestions.length === 1
        && candidateIdentity(freshSuggestions[0]) === candidateIdentity(onlyFreshCandidate),
      "Previously offered players must not be repeated",
    );
    state.offeredPlayerIds.clear();

    state.drafted.clear();
    state.formation = "4-3-3";
    state.style = "Balanced";
    const leftBackSlot = currentSlots().find((item) => item.effectiveRole === "DL");
    for (const item of currentSlots()) {
      if (item.id !== leftBackSlot.id) {
        state.drafted.set(item.id, {
          canonical_player_public_id: "drafted-" + item.id,
        });
      }
    }
    const attackerRatings = [
      { label: "attacker", value: 20 },
      { label: "central", value: 20 },
    ];
    const leftBackRatings = [
      { label: "defender", value: 20 },
      { label: "left side", value: 20 },
    ];
    const latePool = Array.from({ length: 30 }, (_, index) => ({
      database_slug: "late-db-" + index,
      source_person_id: "late-" + index,
      canonical_player_public_id: "late-player-" + index,
      current_ability: 110 + index % 30,
      position_ratings: attackerRatings,
    }));
    for (let index = 0; index < 8; index += 1) {
      latePool.push({
        database_slug: "fit-db-" + index,
        source_person_id: "fit-" + index,
        canonical_player_public_id: "fit-left-back-" + index,
        current_ability: 118 + index,
        position_ratings: leftBackRatings,
      });
    }
    state.rerollsRemaining = 3;
    const unprotectedLateRoll = chooseSuggestions(latePool, 91);
    const unprotectedFitCount = unprotectedLateRoll
      .filter((candidate) => isExactLateSlotMatch(candidate, "DL")).length;
    globalThis.assert.ok(
      unprotectedFitCount === unprotectedLateRoll.length,
      "Every late-roll suggestion must fit the final position; got "
        + unprotectedFitCount
        + " from "
        + unprotectedLateRoll.map((candidate) =>
          playerMainPositionSummary(candidate)
        ).join(", "),
    );
    const lateFitCounts = Array.from({ length: 40 }, (_, index) => (
      chooseSuggestions(latePool, index + 1)
        .filter((candidate) => isExactLateSlotMatch(candidate, "DL")).length
    ));
    globalThis.assert.ok(lateFitCounts.every((count) => count === 5));
    state.rerollsRemaining = 0;
    const emergencyLateRoll = chooseSuggestions(latePool, 91);
    globalThis.assert.ok(
      emergencyLateRoll.some(
        (candidate) => isExactLateSlotMatch(candidate, "DL"),
      ),
      "The final reroll should retain a compatible escape route",
    );

    state.drafted.clear();
    const finalSlots = currentSlots();
    const finalLeftBack = finalSlots.find((item) => item.effectiveRole === "DL");
    const finalGoalkeeper = finalSlots.find((item) => item.effectiveRole === "GK");
    for (const item of finalSlots) {
      if (item.id !== finalLeftBack.id && item.id !== finalGoalkeeper.id) {
        state.drafted.set(item.id, {
          canonical_player_public_id: "two-left-drafted-" + item.id,
        });
      }
    }
    const twoRolePool = [
      {
        database_slug: "late-pair-a",
        source_person_id: "late-dl",
        canonical_player_public_id: "late-dl",
        current_ability: 145,
        position_text: "D L",
        position_ratings: leftBackRatings,
      },
      {
        database_slug: "late-pair-b",
        source_person_id: "late-gk",
        canonical_player_public_id: "late-gk",
        current_ability: 145,
        position_text: "GK",
        position_ratings: [],
      },
      ...Array.from({ length: 8 }, (_, index) => ({
        database_slug: index % 2 ? "late-pair-a" : "late-pair-b",
        source_person_id: "late-attacker-" + index,
        canonical_player_public_id: "late-attacker-" + index,
        current_ability: 135 + index,
        position_text: "F C",
        position_ratings: attackerRatings,
      })),
    ];
    const twoRoleRoll = chooseSuggestions(twoRolePool, 73);
    globalThis.assert.ok(
      twoRoleRoll.some((candidate) => isExactLateSlotMatch(candidate, "DL")),
      "The final two-role roll must contain a left-back option",
    );
    globalThis.assert.ok(
      twoRoleRoll.some((candidate) => isExactLateSlotMatch(candidate, "GK")),
      "The final two-role roll must contain a goalkeeper option",
    );

    state.drafted.clear();
    const threeRoleSlots = currentSlots();
    const requiredThreeRoles = new Set(["GK", "DL", "FC"]);
    for (const item of threeRoleSlots) {
      if (!requiredThreeRoles.has(item.effectiveRole)) {
        state.drafted.set(item.id, {
          canonical_player_public_id: "three-left-drafted-" + item.id,
        });
      } else {
        requiredThreeRoles.delete(item.effectiveRole);
      }
    }
    const threeRolePool = [
      {
        database_slug: "three-a",
        source_person_id: "three-gk",
        canonical_player_public_id: "three-gk",
        current_ability: 135,
        position_text: "GK",
        position_ratings: [],
      },
      {
        database_slug: "three-b",
        source_person_id: "three-dl",
        canonical_player_public_id: "three-dl",
        current_ability: 135,
        position_text: "D L",
        position_ratings: leftBackRatings,
      },
      {
        database_slug: "three-c",
        source_person_id: "three-fc",
        canonical_player_public_id: "three-fc",
        current_ability: 135,
        position_text: "F C",
        position_ratings: attackerRatings,
      },
      {
        database_slug: "three-d",
        source_person_id: "three-dl-two",
        canonical_player_public_id: "three-dl-two",
        current_ability: 150,
        position_text: "D L",
        position_ratings: leftBackRatings,
      },
      {
        database_slug: "three-e",
        source_person_id: "three-fc-two",
        canonical_player_public_id: "three-fc-two",
        current_ability: 150,
        position_text: "F C",
        position_ratings: attackerRatings,
      },
    ];
    const threeRoleRoll = chooseSuggestions(threeRolePool, 117);
    for (const slotItem of remainingSlots()) {
      globalThis.assert.ok(
        threeRoleRoll.some((candidate) =>
          isExactLateSlotMatch(candidate, slotItem.effectiveRole),
        ),
        "The final three-role roll must cover " + slotItem.effectiveRole,
      );
    }

    state.drafted.clear();
    const goalkeeperOnlySlots = currentSlots();
    const goalkeeperOnly = goalkeeperOnlySlots.find(
      (item) => item.effectiveRole === "GK",
    );
    for (const item of goalkeeperOnlySlots) {
      if (item.id !== goalkeeperOnly.id) {
        state.drafted.set(item.id, {
          canonical_player_public_id: "keeper-fallback-drafted-" + item.id,
        });
      }
    }
    const rotationFallbackPool = [
      ...["used-gk-a", "used-gk-b", "fresh-gk-c", "fresh-gk-d", "fresh-gk-e"].flatMap((database) => [
        {
          database_slug: database,
          source_person_id: database + "-keeper",
          canonical_player_public_id: database + "-keeper",
          current_ability: 145,
          position_text: "GK",
          position_ratings: [],
        },
        ...Array.from({ length: 5 }, (_, index) => ({
          database_slug: database,
          source_person_id: database + "-player-" + index,
          canonical_player_public_id: database + "-player-" + index,
          current_ability: 145,
          position_text: "F C",
          position_ratings: attackerRatings,
        })),
      ]),
      ...["fresh-no-gk-a", "fresh-no-gk-b"].flatMap((database) =>
        Array.from({ length: 6 }, (_, index) => ({
          database_slug: database,
          source_person_id: database + "-player-" + index,
          canonical_player_public_id: database + "-player-" + index,
          current_ability: 145,
          position_text: "F C",
          position_ratings: attackerRatings,
        })),
      ),
    ];
    state.databasesUsedForCurrentPick.clear();
    state.databasesUsedForCurrentPick.add("used-gk-a");
    state.databasesUsedForCurrentPick.add("used-gk-b");
    const fallbackPair = selectRollDatabases(rotationFallbackPool, 991);
    globalThis.assert.ok(
      fallbackPair.some((database) => database.startsWith("used-gk-")),
      "Final-position coverage must take priority over database rotation",
    );

    state.mode = "Titan Fight";
    state.offeredPlayerIds.clear();
    state.databasesUsedForCurrentPick.clear();
    const singleSeasonElitePool = Array.from({ length: 5 }, (_, index) => ({
      database_slug: "elite-gk-season",
      source_person_id: "elite-keeper-" + index,
      canonical_player_public_id: "elite-keeper-" + index,
      current_ability: 165 + index,
      position_text: "GK",
      position_ratings: [],
    }));
    globalThis.assert.deepEqual(
      selectRollDatabases(singleSeasonElitePool, 1776),
      ["elite-gk-season"],
      "Titan Fight must not require five different seasons",
    );
    globalThis.assert.equal(
      chooseSuggestions(singleSeasonElitePool, 1776).length,
      5,
      "Titan Fight must allow five elite choices from a sparse season pool",
    );
  `);

vm.runInNewContext(setupSource, {
  assert,
  document: { querySelector: () => ({}) },
  Map,
  Set,
  console,
  sessionStorage: {
    getItem() { return ""; },
    setItem() {},
  },
  URLSearchParams,
  window: { location: { hash: "" } },
});
const setupSourceText = fs.readFileSync(new URL("../draft-setup.js", import.meta.url), "utf8");
const setupHtml = fs.readFileSync(new URL("../draft-setup.html", import.meta.url), "utf8");
const setupStyles = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");
const draftEntryHtml = fs.readFileSync(new URL("../draft.html", import.meta.url), "utf8");
const draftEntrySource = fs.readFileSync(new URL("../draft.js", import.meta.url), "utf8");
const retroballApiSource = fs.readFileSync(new URL("../src/lib/retroballApi.js", import.meta.url), "utf8");
const localApiSource = fs.readFileSync(new URL("../tools/identity/localApi.js", import.meta.url), "utf8");
assert.ok(
  !setupSourceText.includes("if (!fit.slot || fit.score <= 0)"),
  "Zero-rated suggestions must remain selectable as emergency cover",
);
assert.ok(draftEntryHtml.includes('id="draftHallList"'));
assert.ok(draftEntryHtml.includes('id="draftFriendsModal"'));
assert.ok(draftEntryHtml.includes('id="draftFriendsReady"'));
assert.ok(draftEntryHtml.includes('id="draftFriendsCopy" type="button" disabled'));
assert.ok(draftEntryHtml.includes('content="https://retroball-api.umutnaderi.workers.dev"'));
assert.ok(draftEntryHtml.indexOf('draft-play-friends') < draftEntryHtml.indexOf('draft-entry-hall'));
assert.ok(draftEntrySource.includes("await getDraftRecords()"));
assert.ok(draftEntrySource.includes("records.slice(0, 8)"));
assert.ok(draftEntrySource.includes("createFriendRoom(name)"));
assert.ok(draftEntrySource.includes("if (!invitation) return;"));
assert.ok(draftEntrySource.includes('document.execCommand?.("copy")'));
assert.ok(draftEntrySource.includes("estimateServerClockOffset(clockSamples)"));
assert.ok(draftEntrySource.includes("enterFriendDraft()"));
assert.ok(draftEntrySource.includes("draft-setup.html#"));
assert.ok(draftEntrySource.includes('? "Titan Fight" : "Classic"'));
assert.ok(setupStyles.includes(".draft-entry-hall"));
assert.ok(setupStyles.includes(".draft-friends-room[hidden]"));
assert.ok(setupStyles.includes(".draft-entry-hall {\n    position: static;"));
assert.ok(setupSourceText.includes('"is-emergency-target", "fit-none"'));
assert.ok(setupSourceText.includes("const friendSession = friendSessionFromPage()"));
assert.ok(setupSourceText.includes("Submit squad"));
assert.ok(setupHtml.includes('data-scenario="ucl0203"'));
assert.ok(setupHtml.includes('data-scenario="ucl0304"'));
assert.ok(setupHtml.includes('data-scenario="wc2002"'));
assert.ok(setupHtml.includes('data-scenario="titan" hidden'));
assert.ok(setupHtml.includes('data-value="Titan Fight"'));
assert.ok(
  setupHtml.indexOf('data-value="Classic"') < setupHtml.indexOf('data-value="Titan Fight"')
  && setupHtml.indexOf('data-value="Titan Fight"') < setupHtml.indexOf('data-value="From memory"'),
  "Titan Fight must sit between Classic and From memory",
);
assert.ok(setupHtml.includes('id="draftMobileRollButton"'));
assert.equal((setupHtml.match(/<small>Group Stages<\/small>/g) || []).length, 3);
assert.ok(setupSourceText.includes("scenario: state.scenario"));
assert.ok(setupSourceText.includes("mode: state.mode"));
assert.ok(setupSourceText.includes('scenarioLegend.textContent = titanSelected'));
assert.ok(setupSourceText.includes('Start the Titan Fight <span'));
assert.ok(setupSourceText.includes('if (titanSelected) state.scenario = "titan"'));
assert.ok(setupSourceText.includes('state.mode === "Titan Fight" ? 165 : 100'));
assert.ok(setupSourceText.includes("minAbility: minimumDraftAbility()"));
assert.ok(setupSourceText.includes('if (state.mode === "Titan Fight") return allDatabases;'));
assert.ok(setupSourceText.includes("const accumulatedPool = new Map()"));
assert.ok(setupSourceText.includes('state.mode === "Titan Fight"\n    ? SUGGESTIONS_PER_ROLL'));
assert.ok(setupSourceText.includes("state.rollNumber > 0"));
assert.ok(setupSourceText.includes("selectedDraftSlotId"));
assert.ok(setupSourceText.includes("state.captainSlotId = slotId"));
assert.ok(setupSourceText.includes("state.captainSlotId = sourceSlotId"));
assert.ok(setupSourceText.includes("positions: targetPositions"));
assert.ok(setupSourceText.includes("selectRollDatabases"));
assert.ok(setupSourceText.includes("databasesUsedForCurrentPick"));
assert.ok(setupSourceText.includes("playerMainPositionSummary(candidate)"));
assert.ok(setupSourceText.includes('class="draft-dice-loader"'));
assert.ok(setupSourceText.includes('renderSuggestions("", true)'));
assert.ok(retroballApiSource.includes('searchParams.set("positions"'));
assert.ok(retroballApiSource.includes('minAbility: String(minAbility)'));
assert.ok(setupHtml.includes('<meta name="retroball-api-url" content="https://retroball-api.umutnaderi.workers.dev">'));
assert.ok(setupSourceText.includes("minAbility: minimumDraftAbility()"));
assert.ok(localApiSource.includes("ps.current_ability BETWEEN 100 AND 200"));
assert.ok(localApiSource.includes("LIMIT 4"));
assert.ok(localApiSource.includes("ps.current_ability BETWEEN 140 AND 200"));
assert.ok(localApiSource.includes("qualityRows"));
assert.ok(setupStyles.includes(".formation-player.is-swap-source"));
assert.ok(setupStyles.includes(".draft-suggestion-card > span"));
assert.ok(setupStyles.includes("position: absolute"));
assert.ok(setupStyles.includes(".draft-roll-button-mobile"));
assert.ok(setupStyles.includes(".draft-options > .draft-roll-button"));
assert.ok(setupStyles.includes("@keyframes draft-die-spin"));
assert.ok(setupStyles.includes("@keyframes draft-suggestion-reveal"));
assert.ok(setupStyles.includes(".formation-player:not(.is-filled)"));
assert.ok(!setupStyles.includes("opacity: 0.34"));
assert.ok(setupStyles.includes("border-color: rgba(247, 243, 237, 0.92)"));
assert.ok(setupStyles.includes("background: #49131b"));
assert.ok(!setupStyles.includes('.formation-pitch[data-style="defensive"] .formation-player'));
assert.ok(!setupStyles.includes('.formation-pitch[data-style="attacking"] .formation-player'));
const emptyPositionRules = [...setupStyles.matchAll(/\.formation-player\s*\{[^}]+\}/g)];
assert.ok(emptyPositionRules.length >= 1);
assert.ok(emptyPositionRules.filter((match) => match[0].includes("border: 2px solid")).length >= 2);
assert.ok(emptyPositionRules.every((match) => !match[0].includes("border: 2px dashed")));

const runHtml = fs.readFileSync(new URL("../draft-run.html", import.meta.url), "utf8");
const runSourceText = fs.readFileSync(new URL("../draft-run.js", import.meta.url), "utf8");
assert.ok(!/[âÃÂ]/.test(runSourceText), "Draft match UI must not contain mojibake characters");
assert.ok(!runHtml.includes('id="runClock"'), "The match clock must not remain in the sidebar");
assert.ok(runSourceText.includes("data-match-clock"), "Every active match must render its own clock");
assert.ok(
  runSourceText.includes("async function animateClockRange("),
  "The active match clock must advance through its event-driven timeline",
);
assert.ok(runSourceText.includes("data-match-pace"), "A live match must expose commentary pace");
assert.ok(runSourceText.includes("data-mini-pitch"), "A live match must render its spatial mini-pitch");
assert.ok(runSourceText.includes("MIRRORED_ZONE"), "Opponent zones must be mirrored into the user perspective");
assert.ok(runSourceText.includes("calculateStoppageSeconds"));
assert.ok(runSourceText.includes("regulationEndSecond"));
assert.ok(runSourceText.includes("zoneFrom"));
assert.ok(runSourceText.includes("zoneTo"));
assert.ok(runSourceText.includes("data-share-squad"), "Finished runs must offer squad sharing");
assert.ok(runSourceText.includes("squadSeed: sharedSquad.seed"), "Records must carry the squad seed");
assert.ok(runSourceText.includes("const TITAN_OPPONENTS = ["));
assert.equal((runSourceText.match(/key: "titan-/g) || []).length, 8);
assert.ok(runSourceText.includes('legacyCanonicalId: "23678"'));
assert.ok(runSourceText.includes('legacyCanonicalId: "81217"'));
assert.ok(runSourceText.includes('canonicalPublicId: "player_kleberson_brazil_1979"'));
assert.ok(runSourceText.includes('canonicalPublicId: "player_juan_sebastian_veron_argentina_1975"'));
assert.ok(runSourceText.includes("returnedCanonicalPublicId === canonicalPublicId"));
assert.ok(runSourceText.includes('mode: isTitanFight ? "Titan Fight" : team.mode || "Classic"'));
assert.ok(runSourceText.includes('? "Titan Fight"\n      : "Classic"'));
assert.ok(runSourceText.includes('label: `${state.userRecord.played}/${TITAN_OPPONENTS.length}`'));
assert.ok(runHtml.includes('id="runRecordsPanel" role="dialog"'));
assert.ok(runHtml.includes('id="runRecordsClose"'));
assert.ok(runSourceText.includes('recordFormSlot.append(elements.recordForm)'));
assert.ok(!runSourceText.includes("renderRecordOpportunity"));
assert.ok(runSourceText.includes("titan-order"), "Titan opponents must be shuffled by the run seed");
assert.ok(runSourceText.includes("group-draw"), "The run must seed a random group draw");
assert.ok(runSourceText.includes("scenario.database"), "Opponent searches must use the selected season");
assert.ok(runSourceText.includes("ZONE_TRANSITION_MATRIX"));
assert.ok(runSourceText.includes("buildTransitionTimeline"));
assert.ok(runSourceText.includes("renderCanonicalMatchSnapshot"));
assert.ok(runSourceText.includes("createMatchPlaybackController"));
const animateMatchSource = runSourceText.slice(
  runSourceText.indexOf("async function animateMatch("),
  runSourceText.indexOf("function currentFixture("),
);
assert.ok(!animateMatchSource.includes("await animatePeriod("));
assert.ok(animateMatchSource.includes('document.addEventListener("visibilitychange"'));
const playedMatchSource = runSourceText.slice(
  runSourceText.indexOf("function matchSimulation("),
  runSourceText.indexOf("function attributeValue("),
);
assert.ok(!playedMatchSource.includes("poisson("), "Played match scores must emerge from transitions");

const sharedSquadHtml = fs.readFileSync(new URL("../draft-squad.html", import.meta.url), "utf8");
const sharedSquadSource = fs.readFileSync(new URL("../draft-squad.js", import.meta.url), "utf8");
const workerSource = fs.readFileSync(new URL("../worker/src/index.ts", import.meta.url), "utf8");
const friendRoomSource = fs.readFileSync(new URL("../worker/src/friend-room.ts", import.meta.url), "utf8");
const workerConfig = fs.readFileSync(new URL("../worker/wrangler.jsonc", import.meta.url), "utf8");
assert.ok(sharedSquadHtml.includes('id="sharedSquadList"'));
assert.ok(sharedSquadSource.includes("getDraftSquad(seed)"));
assert.ok(workerSource.includes("ps.current_ability BETWEEN 100 AND 200"));
assert.ok(workerSource.includes("ps.current_ability BETWEEN 140 AND 200"));
assert.ok(workerSource.includes("qualityQueries"));
assert.ok(workerSource.includes("draftPositionPatterns"));
assert.ok(workerSource.includes('url.searchParams.get("minAbility")'));
assert.ok(workerSource.includes("mode = excluded.mode"));
assert.ok(workerSource.includes("LIMIT 4"));
assert.ok(workerSource.includes('url.pathname === "/api/draft-squads"'));
assert.ok(workerSource.includes("squad_seed = excluded.squad_seed"));
assert.ok(workerSource.includes('url.pathname === "/api/friend-rooms"'));
assert.ok(workerSource.includes("FRIEND_MATCH_ROOMS.getByName(code)"));
assert.ok(friendRoomSource.includes("this.ctx.acceptWebSocket(server)"));
assert.ok(friendRoomSource.includes('payload.type === "ping"'));
assert.ok(friendRoomSource.includes("Date.now() + 5_000"));
assert.ok(friendRoomSource.includes('payload.type === "submit-squad"'));
assert.ok(friendRoomSource.includes("Date.now() + 12_000"));
assert.ok(friendRoomSource.includes("host_squad_json"));
assert.ok(runSourceText.includes("startFriendlyRoom()"));
assert.ok(runSourceText.includes('type: "submit-squad", squad: draftedTeam'));
assert.ok(runSourceText.includes("lockPace: true"));
assert.ok(runSourceText.includes("renderSquad(draftedTeam)"));
assert.ok(runSourceText.includes('friendSession.role === "host" ? result.userWon : !result.userWon'));
assert.ok(runSourceText.includes("annotatePressureWaves"));
assert.ok(runSourceText.includes("signatureMoment"));
assert.ok(runSourceText.includes("tacticalMultiplier"));
assert.ok(runSourceText.includes('data-match-possession'));
assert.ok(runSourceText.includes('data-match-suspense'));
assert.ok(runSourceText.includes('classList.toggle("is-goal", goalEmphasis)'));
assert.ok(runSourceText.includes('goalEmphasis ? "Scored" : "Danger"'));
assert.ok(workerConfig.includes('"new_sqlite_classes": ["FriendMatchRoom"]'));

const player = (name, role, line, currentAbility, id) => ({
  canonical_player_name: name,
  source_person_id: String(id),
  database_slug: "test",
  role,
  line,
  position_text: role,
  current_ability: currentAbility,
});
const userRoster = [
  player("User Keeper", "GK", "defence", 170, 1),
  player("Left Back", "DL", "defence", 150, 2),
  player("Centre Back One", "DC", "defence", 160, 3),
  player("Centre Back Two", "DC", "defence", 155, 4),
  player("Right Back", "DR", "defence", 150, 5),
  player("Mid One", "MC", "midfield", 170, 6),
  player("Mid Two", "MC", "midfield", 165, 7),
  player("Mid Three", "AMC", "midfield", 175, 8),
  player("Forward One", "FL", "attack", 180, 9),
  player("Forward Two", "FC", "attack", 185, 10),
  player("Forward Three", "FR", "attack", 178, 11),
];
const opponentRoster = [
  player("Opponent Keeper", "GK", "defence", 165, 101),
  ...Array.from({ length: 17 }, (_, index) => player(
    `Opponent ${index + 1}`,
    index < 5 ? "DC" : index < 11 ? "MC" : "FC",
    index < 5 ? "defence" : index < 11 ? "midfield" : "attack",
    145 + index,
    102 + index,
  )),
];
const savedTeam = {
  teamName: "Test XI",
  scenario: "ucl0203",
  captainSlotId: "slot-9",
  overalls: { team: 85, attack: 90, midfield: 84, defence: 78 },
  players: userRoster.map((item, index) => ({
    player: item,
    role: item.role,
    line: item.line,
    overall: Math.round(item.current_ability / 2),
    isCaptain: index === 9,
  })),
};

// draft-run.js now imports its scenario resolvers/attribute system from
// src/lib/matchEngineCore.js (see MATCH_LAB_PLAN.md). vm.runInNewContext
// evaluates a plain string, not a real module graph, so that import gets
// stripped by the regex below same as draft-run.js's other imports --
// inlining matchEngineCore's source (with `export` stripped) ahead of it
// keeps every function/constant in the *same* sandbox realm. Injecting the
// real (outer-realm) functions into the context object instead would work
// for calls, but any assert.deepEqual comparing their return value against
// an object literal written in the sandboxed test code fails with "same
// structure but not reference-equal" -- a cross-realm Object.prototype
// mismatch, not an actual behavior difference.
const matchEngineCoreSource = fs.readFileSync(new URL("../src/lib/matchEngineCore.js", import.meta.url), "utf8")
  .replace(/^export (function|const)/gm, "$1");
const runSource = matchEngineCoreSource + "\n"
  + fs.readFileSync(new URL("../draft-run.js", import.meta.url), "utf8")
  .replace(/^(?:import[\s\S]*?;\r?\n)+/, "")
  .split("elements.nextButton.addEventListener")[0]
  .concat(`
    (async () => {
      const opponentRoster = globalThis.testOpponentRoster;
      let redCards = 0;
      let throughBallCount = 0;
      let simulatedGoals = 0;
      let signatureMoments = 0;
      let pressureWaves = 0;
      let allInGoals = 0;
      const organicGoalTypes = new Set();
      // Reachability audit (see MATCH_ENGINE_SCENARIOS.md, "Observed
      // Scenario Graph") -- reuses these same 180 match runs rather than a
      // separate pass, tallying every scenarioType/kind that actually fired
      // so dead or structurally-starved branches (like the corner and
      // free-kick bugs) show up as a failing assertion instead of needing
      // to be found by manually tracing a live match.
      const scenarioTally = new Map();
      for (let index = 0; index < 180; index += 1) {
        state.matchNumber = index;
        const result = matchSimulation("milan", opponentRoster, index % 2 ? "Group stage" : "Round of 16");
        finalizeMatchResult(result);
        const allEvents = [...result.events, ...result.extraTimeEvents];
        signatureMoments += allEvents.filter((event) => event.signatureMoment).length;
        pressureWaves += allEvents.filter((event) => event.pressureWave).length;
        allInGoals += allEvents.filter((event) => event.goal && event.allIn).length;
        globalThis.assert.equal(
          result.timeline.events.filter((entry) => entry.type === "match-event").length,
          allEvents.length,
        );
        if (index === 0) {
          const reconstructed = globalThis.reduceMatchTimeline(
            result.timeline,
            result.timeline.durationMs,
          );
          globalThis.assert.equal(reconstructed.userGoals, result.userGoals);
          globalThis.assert.equal(reconstructed.rivalGoals, result.rivalGoals);
          globalThis.assert.equal(reconstructed.completed, true);
        }
        globalThis.assert.ok(result.manOfMatch?.name);
        globalThis.assert.ok(result.minuteDelay >= 110 && result.minuteDelay <= 235);
        globalThis.assert.ok(result.regulationStoppageSeconds >= 0);
        globalThis.assert.ok(result.regulationStoppageSeconds <= 360);
        globalThis.assert.equal(
          result.regulationEndSecond,
          90 * 60 + result.regulationStoppageSeconds,
        );
        redCards += allEvents.filter((event) => event.card === "red").length;
        const userGoals = allEvents.filter((event) => event.goal && event.side === "user").length;
        const rivalGoals = allEvents.filter((event) => event.goal && event.side === "opponent").length;
        simulatedGoals += userGoals + rivalGoals;
        allEvents.filter((event) => event.goal).forEach((event) => organicGoalTypes.add(event.goalType));
        globalThis.assert.equal(userGoals, result.userGoals);
        globalThis.assert.equal(rivalGoals, result.rivalGoals);
        for (const event of allEvents) {
          const scenarioKey = event.card
            ? "CARD." + String(event.card).toUpperCase()
            : (event.scenarioType || event.kind);
          scenarioTally.set(scenarioKey, (scenarioTally.get(scenarioKey) || 0) + 1);
          globalThis.assert.ok(event.matchSecond >= 0);
          globalThis.assert.ok(event.zoneFrom >= 0 && event.zoneFrom <= 11);
          globalThis.assert.ok(event.zoneTo >= 0 && event.zoneTo <= 11);
          globalThis.assert.ok(event.actionSeconds >= 4);
          globalThis.assert.ok(event.presentationWeight > 0);
          globalThis.assert.ok(["user", "opponent"].includes(event.possessionAfter));
          if (event.kind === "through-ball") {
            throughBallCount += 1;
            globalThis.assert.ok(["through-ball", "interception"].includes(event.action));
            globalThis.assert.ok(event.bypassedZone >= 3 && event.bypassedZone <= 5);
            globalThis.assert.ok(event.duelProbability > 0 && event.duelProbability < 1);
            globalThis.assert.equal(typeof event.duelWon, "boolean");
          }
        }
        for (const event of allEvents.filter((item) => item.text.includes(" tests "))) {
          globalThis.assert.ok(
            event.text.includes(event.side === "user" ? "Opponent Keeper" : "User Keeper"),
            event.text,
          );
        }
        for (let eventIndex = 0; eventIndex < allEvents.length; eventIndex += 1) {
          const event = allEvents[eventIndex];
          if (event.card !== "red") continue;
          const laterAction = allEvents.slice(eventIndex + 1).find((item) =>
            item.side === event.side && item.scorer === event.scorer);
          globalThis.assert.equal(laterAction, undefined, event.scorer + " acted after a red card");
        }
      }
      globalThis.assert.ok(redCards <= 12, "Red cards are too frequent: " + redCards);
      globalThis.assert.ok(throughBallCount > 0, "The timeline should generate zonal bypass attempts");
      globalThis.assert.ok(signatureMoments > 0, "Elite players should generate signature moments");
      globalThis.assert.ok(pressureWaves > 0, "Sustained attacks should generate pressure waves");
      globalThis.assert.ok(allInGoals > 0, "Late trailing teams should create all-in goal events");
      globalThis.assert.ok(
        simulatedGoals >= 180 && simulatedGoals <= 900,
        "Organic scoring rate is outside the expected range: " + simulatedGoals + " goals in 180 matches",
      );
      globalThis.assert.ok(
        organicGoalTypes.size >= 5,
        "Transition play should produce varied causal goals: " + [...organicGoalTypes].join(", "),
      );
      // Reachability audit (see MATCH_ENGINE_SCENARIOS.md, "Observed Scenario
      // Graph") -- required/rare-but-required scenario codes must actually
      // fire across these same 180 match runs, not just exist in the source.
      // This is the tier of test that would have caught the corner and
      // free-kick reachability bugs automatically instead of needing a
      // manually-patched trace to find them.
      const tally = (key) => scenarioTally.get(key) || 0;
      globalThis.assert.ok(
        tally("K.ONEONONE.1") > 30,
        "Breakaway goals should be common: " + tally("K.ONEONONE.1"),
      );
      globalThis.assert.ok(
        tally("K.SAVE.0") + tally("K.SAVE.1") + tally("K.SAVE.3") + tally("K.SAVE.4") > 80,
        "Keeper saves should be common",
      );
      globalThis.assert.ok(tally("D.BLOCK") > 10, "Shot-blocking should be reachable: " + tally("D.BLOCK"));
      // Note: foul-D.SLIDE/foul-D.STAND/foul-D.DUEL scenarioType values only
      // ever ride along on card events (applyFoulOutcome only pushes an
      // event when foul.card !== "none"), so the tally key computed above
      // (event.card overrides scenarioType) resolves those to CARD.* -- the
      // card tally is therefore the correct proxy for "tackle-engagement
      // fouls are reachable", not the raw foul-D.* scenario codes.
      globalThis.assert.ok(
        tally("CARD.YELLOW") + tally("CARD.RED") > 15,
        "Fouls from tackle engagements should be reachable",
      );
      globalThis.assert.ok(
        tally("corner-header") > 0,
        "Corners should produce header chances -- this is the exact bug that went unreachable before",
      );
      globalThis.assert.ok(
        tally("DELIVERY.CLEARED") + tally("F.HEADER.OFF") + tally("corner-header") + tally("set-piece-scramble") > 20,
        "Delivery/corner outcomes should be reachable",
      );
      globalThis.assert.ok(tally("K.SAVE.7") > 0, "Post-and-out saves should occur");
      // FK.WALL.HIT is thin even at 400 matches (see MATCH_ENGINE_SCENARIOS.md
      // baseline: ~9/400) -- thin enough that adding P.RECEIVE's extra
      // random() calls upstream shifted this exact 180-match deterministic
      // run to zero occurrences, even though the mechanism itself stayed
      // fully reachable (confirmed via scenario_telemetry.mjs). That's the
      // "RNG call order can shift outcomes" risk the engine-hygiene review
      // warned about -- the fix isn't to chase the count back up, it's to
      // stop depending on this specific match sequence for a rare-tier
      // check. See the constructed-state FK.WALL test below instead.
      globalThis.assert.equal(displayZone(0, "user"), 0);
      globalThis.assert.equal(displayZone(0, "opponent"), 11);
      globalThis.assert.equal(displayZone(5, "opponent"), 6);
      globalThis.assert.equal(formatMatchClock(90 * 60 + 1, 90 * 60), "90+1'");
      globalThis.assert.equal(formatMatchClock(90 * 60 + 61, 90 * 60), "90+2'");
      globalThis.assert.equal(formatMatchClock(91 * 60, 120 * 60), "91'");
      const visibleRatings = visibleSquadRatings();
      globalThis.assert.equal(visibleRatings.attack, 91);
      globalThis.assert.ok(boostedSquadOverall() > visibleRatings.team);
      const eliteAttributes = (values) => Object.entries(values).map(([label, value]) => ({ label, value }));
      const weakKeeper = {
        current_ability: 120,
        role: "GK",
        attributes: eliteAttributes({ Handling: 6, Reflexes: 7, "One On Ones": 5, Positioning: 6, Agility: 7, Jumping: 6 }),
      };
      const eliteKeeper = {
        ...weakKeeper,
        current_ability: 175,
        attributes: eliteAttributes({ Handling: 19, Reflexes: 19, "One On Ones": 18, Positioning: 18, Agility: 17, Jumping: 18 }),
      };
      globalThis.assert.ok(goalkeeperScore(eliteKeeper) > goalkeeperScore(weakKeeper) + 25);
      const ordinaryForward = {
        current_ability: 135,
        role: "FC",
        line: "attack",
        attributes: eliteAttributes({ Finishing: 11, "Off the Ball": 10, Heading: 10, Technique: 11, Pace: 12, Creativity: 8, Passing: 9 }),
      };
      const eliteForward = {
        ...ordinaryForward,
        current_ability: 185,
        attributes: eliteAttributes({ Finishing: 19, "Off the Ball": 19, Heading: 18, Technique: 18, Pace: 17, Creativity: 16, Passing: 16 }),
      };
      globalThis.assert.ok(attackerScore(eliteForward) > attackerScore(ordinaryForward) + 20);
      const lowEngine = {
        ...eliteForward,
        attributes: eliteAttributes({
          Dribbling: 18, Technique: 18, Agility: 18, Stamina: 5, "Work Rate": 5,
          Tackling: 8, Positioning: 8, Strength: 9,
        }),
      };
      const tirelessEngine = {
        ...lowEngine,
        attributes: eliteAttributes({
          Dribbling: 18, Technique: 18, Agility: 18, Stamina: 19, "Work Rate": 19,
          Tackling: 8, Positioning: 8, Strength: 9,
        }),
      };
      globalThis.assert.equal(conditionMultiplier(lowEngine, 15), 1);
      globalThis.assert.ok(conditionMultiplier(tirelessEngine, 88) > conditionMultiplier(lowEngine, 88));
      const freshDuel = localizedDuel(
        lowEngine,
        ordinaryForward,
        ["Dribbling", "Technique", "Agility"],
        ["Tackling", "Positioning", "Strength"],
        15,
        seededRandom(55),
      );
      const tiredDuel = localizedDuel(
        lowEngine,
        ordinaryForward,
        ["Dribbling", "Technique", "Agility"],
        ["Tackling", "Positioning", "Strength"],
        88,
        seededRandom(55),
      );
      globalThis.assert.ok(freshDuel.probability > tiredDuel.probability);
      const specialistRoster = [
        {
          ...ordinaryForward,
          canonical_player_name: "Corner Expert",
          source_person_id: "corner-expert",
          role: "MR",
          attributes: eliteAttributes({ Corners: 20, "Set Pieces": 18, "Free Kicks": 11 }),
        },
        {
          ...ordinaryForward,
          canonical_player_name: "Free Kick Expert",
          source_person_id: "free-kick-expert",
          role: "MC",
          attributes: eliteAttributes({ Corners: 10, "Set Pieces": 16, "Free Kicks": 20 }),
        },
        {
          ...eliteForward,
          canonical_player_name: "Aerial Expert",
          source_person_id: "aerial-expert",
          attributes: eliteAttributes({ Heading: 20, Jumping: 20, "Off the Ball": 19, Strength: 19, Anticipation: 18 }),
        },
      ];
      // Constructed-state coverage for the free-kick-gate fix: resolveFoul's
      // own restart logic (penalty only in the box, free-kick everywhere
      // else) must hold at every zone row, independent of whether the tick
      // loop's gate around it happens to reach that row in a given match.
      // isLastMan=true skips the RNG-driven "advantage" branch so the
      // restart type is deterministic here.
      const foulDefender = {
        current_ability: 140,
        position_text: "DC",
        attributes: eliteAttributes({ Aggression: 12, Bravery: 11, Composure: 10 }),
      };
      const foulRandom = seededRandom(777);
      const restartByZone = [1, 4, 7, 10].map(
        (zone) => resolveFoul(foulDefender, "D.STAND", zone, true, 10, foulRandom).restart,
      );
      globalThis.assert.deepEqual(
        restartByZone,
        ["penalty", "free-kick", "free-kick", "free-kick"],
        "Fouls should award a penalty only in the box (row 0) and a free-kick elsewhere",
      );
      // Constructed-state coverage for FK.WALL.HIT -- deliberately isolated
      // from the live 180-match loop (see the comment above where that
      // assertion used to live) so this can't be broken by unrelated RNG
      // consumption shifting elsewhere in the tick.
      const wallTaker = {
        current_ability: 150,
        position_text: "MC",
        attributes: eliteAttributes({ "Free Kick Taking": 12, Technique: 12 }),
      };
      const wallDefenders = [
        foulDefender, { ...foulDefender, source_person_id: "wall-2" }, { ...foulDefender, source_person_id: "wall-3" },
      ];
      const wallRandom = seededRandom(4242);
      let wallHits = 0;
      for (let attempt = 0; attempt < 200; attempt += 1) {
        if (resolveWall(wallTaker, wallDefenders, wallRandom).code === "FK.WALL.HIT") wallHits += 1;
      }
      globalThis.assert.ok(wallHits > 0, "FK.WALL.HIT should be reachable in isolation");
      // Constructed-state coverage for resolveKeeperSave()'s free-kick
      // branch and its contextMultiplier/fk-* label wiring (see
      // MATCH_LAB_PLAN.md, shot-conversion calibration) -- relative
      // assertions (skill tiers must separate in the right order) rather
      // than pinned absolute rates, so this survives future constant
      // nudges without becoming exactly the kind of brittle, RNG-order-
      // sensitive assertion the K.SAVE.7 comment above already warns
      // about; isolates the keeper-beating stage only (not the full
      // wall+on-target chain, which belongs in tools/keeper_save_audit.mjs).
      // (No template literals in this block: it's itself embedded inside
      // an outer template literal that builds the sandboxed script.)
      const fkKeeperSaveRate = (label, takerAttrs, keeperAttrs, runs) => {
        const taker = { current_ability: 160, attributes: eliteAttributes(takerAttrs) };
        const keeper = { current_ability: 160, attributes: eliteAttributes(keeperAttrs) };
        const random = seededRandom(hashString("fk-keeper-save-tier:" + label));
        let goals = 0;
        for (let i = 0; i < runs; i += 1) {
          if (resolveKeeperSave(taker, keeper, "fk-regular", 45, random, 1, freeKickContextMultiplier(4)).goal) goals += 1;
        }
        return goals / runs;
      };
      const ordinaryKeeperAttrs = { Reflexes: 12, Positioning: 12 };
      const weakTakerRate = fkKeeperSaveRate("weak-vs-ordinary", { "Free Kick Taking": 8, Technique: 10 }, ordinaryKeeperAttrs, 4000);
      const ordinaryTakerRate = fkKeeperSaveRate("ordinary-vs-ordinary", { "Free Kick Taking": 13, Technique: 13 }, ordinaryKeeperAttrs, 4000);
      const eliteTakerRate = fkKeeperSaveRate("elite-vs-ordinary", { "Free Kick Taking": 19, Technique: 17 }, ordinaryKeeperAttrs, 4000);
      globalThis.assert.ok(
        eliteTakerRate > ordinaryTakerRate && ordinaryTakerRate > weakTakerRate,
        "Free-kick specialist skill should separate the keeper-beating rate: weak=" + weakTakerRate + " ordinary=" + ordinaryTakerRate + " elite=" + eliteTakerRate,
      );
      const eliteTakerVsWeakKeeper = fkKeeperSaveRate("elite-vs-weak-keeper", { "Free Kick Taking": 19, Technique: 17 }, { Reflexes: 7, Positioning: 7 }, 4000);
      const eliteTakerVsEliteKeeper = fkKeeperSaveRate("elite-vs-elite-keeper", { "Free Kick Taking": 19, Technique: 17 }, { Reflexes: 18, Positioning: 17 }, 4000);
      globalThis.assert.ok(
        eliteTakerVsWeakKeeper > eliteTakerVsEliteKeeper,
        "Keeper quality should still suppress an elite taker's rate: vs-weak=" + eliteTakerVsWeakKeeper + " vs-elite=" + eliteTakerVsEliteKeeper,
      );
      globalThis.assert.ok(
        eliteTakerRate > 0.04 && eliteTakerRate < 0.35,
        "Elite specialist's isolated keeper-beating rate should be plausible, not near-zero or near-certain: got " + eliteTakerRate,
      );
      // Constructed-state coverage for P.RECEIVE (see MATCH_ENGINE_SCENARIOS.md,
      // "Promoted: P.RECEIVE") -- confirms all five outcomes are reachable
      // and that a clearly-mismatched pairing (elite receiver, low pressure,
      // high pass quality vs. a poor one, high pressure, low pass quality)
      // actually shifts the distribution the direction it should, rather
      // than relying on a live match to happen to exercise both ends.
      const sharpReceiver = {
        current_ability: 180,
        attributes: eliteAttributes({
          "First Touch": 18, Technique: 17, Composure: 17, Anticipation: 17, Balance: 16, Strength: 13,
        }),
      };
      const clumsyReceiver = {
        current_ability: 120,
        attributes: eliteAttributes({
          "First Touch": 6, Technique: 7, Composure: 7, Anticipation: 7, Balance: 7, Strength: 8,
        }),
      };
      const receiveDefender = {
        current_ability: 150,
        attributes: eliteAttributes({ Tackling: 14, Aggression: 13, Anticipation: 13 }),
      };
      const tallyReceiveCodes = (receiver, passQuality, pressureValue, bypassValue, seed) => {
        const receiveRandom = seededRandom(seed);
        const counts = {};
        for (let attempt = 0; attempt < 300; attempt += 1) {
          const result = resolveReceive(receiver, receiveDefender, passQuality, pressureValue, bypassValue, 4, 10, receiveRandom);
          counts[result.context.code] = (counts[result.context.code] || 0) + 1;
          globalThis.assert.ok(["advance", "hold", "turnover"].includes(result.status));
          globalThis.assert.equal(result.nextScenario, "P.SELECT");
          globalThis.assert.ok(["retained", "opponent"].includes(result.possession));
        }
        return counts;
      };
      const favorable = tallyReceiveCodes(sharpReceiver, 0.85, 0.1, false, 111);
      const hostile = tallyReceiveCodes(clumsyReceiver, 0.2, 0.85, true, 222);
      globalThis.assert.ok(
        (favorable["P.RECEIVE.CLEAN"] || 0) > (hostile["P.RECEIVE.CLEAN"] || 0),
        "A sharp receiver under low pressure with a good pass should control it cleanly far more often",
      );
      globalThis.assert.ok(
        (hostile["P.RECEIVE.LOSE"] || 0) + (hostile["P.RECEIVE.HEAVY"] || 0)
          > (favorable["P.RECEIVE.LOSE"] || 0) + (favorable["P.RECEIVE.HEAVY"] || 0),
        "A clumsy receiver under heavy pressure with a poor pass should lose or mishit it far more often",
      );
      globalThis.assert.equal(playerName(setPieceTaker(specialistRoster, "corner")), "Corner Expert");
      globalThis.assert.equal(playerName(setPieceTaker(specialistRoster, "free-kick")), "Free Kick Expert");
      globalThis.assert.ok(headerScore(specialistRoster[2]) > headerScore(ordinaryForward));
      const intelligentAttacker = {
        ...eliteForward,
        canonical_player_name: "Intelligent Runner",
        attributes: eliteAttributes({
          "Off the Ball": 19, Anticipation: 18, Acceleration: 17,
          "First Touch": 17, Finishing: 18,
        }),
      };
      const eliteCreator = {
        ...ordinaryForward,
        canonical_player_name: "Elite Creator",
        role: "MC",
        line: "midfield",
        attributes: eliteAttributes({
          Passing: 19, Vision: 19, Creativity: 18, Technique: 18, Decisions: 17,
        }),
      };
      const finesseSpecialist = {
        ...eliteForward,
        canonical_player_name: "Finesse Specialist",
        attributes: eliteAttributes({
          Technique: 19, "Long Shots": 19, Shooting: 18, Finishing: 18, Composure: 17,
        }),
      };
      const keeperDribbler = {
        ...eliteForward,
        canonical_player_name: "Keeper Dribbler",
        attributes: eliteAttributes({
          Dribbling: 20, Technique: 19, Flair: 18, Composure: 18, Acceleration: 18,
        }),
      };
      globalThis.assert.ok(finesseLongShotScore(finesseSpecialist) > finesseLongShotScore(ordinaryForward));
      globalThis.assert.ok(deliveryScore(eliteCreator) > deliveryScore(ordinaryForward));
      globalThis.assert.ok(offBallRunScore(intelligentAttacker) > offBallRunScore(ordinaryForward));
      globalThis.assert.ok(keeperDribbleScore(keeperDribbler) > keeperDribbleScore(ordinaryForward));
      globalThis.assert.ok(switchPlayScore(eliteCreator) > switchPlayScore(ordinaryForward));
      globalThis.assert.ok(lateBoxRunScore(intelligentAttacker) > lateBoxRunScore(ordinaryForward));
      const finesseGoal = goalEvent(
        { minute: 24, matchSecond: 1440, side: "user", kind: "goal" },
        [finesseSpecialist],
        opponentRoster,
        seededRandom(812),
        "finesse-long-range",
        { scorer: finesseSpecialist, zoneFrom: 3, zoneTo: 1, action: "shot" },
      );
      globalThis.assert.equal(finesseGoal.zoneFrom, 3);
      globalThis.assert.equal(finesseGoal.zoneTo, 1);
      globalThis.assert.ok(
        counterRunnerScore({ ...eliteForward, role: "FR" })
          > counterRunnerScore({ ...eliteForward, role: "FC" }),
        "A fast wide player should receive a flank counter bonus",
      );
      const forcedGoalTypes = [
        "open-play", "corner-header", "corner-volley", "direct-free-kick",
        "free-kick-cross", "long-range", "counter", "own-goal", "high-press",
        "rebound", "cut-back", "set-piece-scramble", "finesse-long-range",
        "off-ball-run", "offside-break", "round-keeper", "late-run",
      ];
      for (const [index, goalType] of forcedGoalTypes.entries()) {
        const event = goalEvent(
          { minute: 20, matchSecond: 1200, side: "user", kind: "goal" },
          specialistRoster,
          opponentRoster,
          seededRandom(9000 + index),
          goalType,
        );
        globalThis.assert.equal(event.goalType, goalType);
        globalThis.assert.ok(event.text.length > 35, event.text);
        if (["own-goal", "set-piece-scramble"].includes(goalType)) {
          globalThis.assert.equal(event.goalCredit, false);
          globalThis.assert.equal(event.actorSide, "opponent");
        }
      }
      const cornerGoal = goalEvent(
        { minute: 22, matchSecond: 1320, side: "user", kind: "goal" },
        specialistRoster,
        opponentRoster,
        seededRandom(42),
        "corner-header",
      );
      globalThis.assert.equal(cornerGoal.provider, "Corner Expert");
      const legacyZidane = {
        current_ability: 168,
        database_slug: "cm9697_vanilla_original",
        role: "AMC",
        line: "midfield",
        position_text: "D/M/AM LC",
        attributes: eliteAttributes({
          Dribbling: 14,
          Finishing: 12,
          Heading: 14,
          Passing: 16,
          Shooting: 12,
          Technique: 16,
          Consistency: 12,
          Creativity: 18,
          Flair: 16,
          Positioning: 12,
          Pace: 13,
          Stamina: 14,
        }),
      };
      const inferredOffBall = engineAttributeDetail(legacyZidane, "Off the Ball");
      globalThis.assert.equal(inferredOffBall.source, "inferred");
      globalThis.assert.ok(inferredOffBall.value >= 13 && inferredOffBall.value <= 18);
      globalThis.assert.ok(inferredOffBall.confidence < 0.7);
      const directHiddenOffBall = engineAttributeDetail({
        ...legacyZidane,
        hiddenAttributes: eliteAttributes({ "Off the Ball": 17 }),
      }, "Off the Ball");
      globalThis.assert.deepEqual(directHiddenOffBall, {
        value: 17,
        source: "direct",
        confidence: 1,
      });
      const unsetAttribute = engineAttributeDetail({
        ...legacyZidane,
        attributes: eliteAttributes({ Handling: 0 }),
      }, "Handling");
      globalThis.assert.notEqual(unsetAttribute.value, 0);
      globalThis.assert.equal(unsetAttribute.source, "baseline");
      const normalizedLegacy = normalizedEngineRatings(legacyZidane);
      globalThis.assert.equal(normalizedLegacy.legacy, true);
      globalThis.assert.ok(normalizedLegacy.confidence > 0.35 && normalizedLegacy.confidence < 1);
      playerMetricCache.set(playerIdentity(team.players[9].player), {
        hiddenAttributes: eliteAttributes({ "Off the Ball": 19 }),
      });
      globalThis.assert.equal(
        engineAttributeDetail(userPlayers()[9], "Off the Ball").value,
        19,
        "Hydrated metrics must be applied to the user's drafted players",
      );
      playerMetricCache.delete(playerIdentity(team.players[9].player));
      const weakKeeperRoster = opponentRoster.map((player) =>
        isGoalkeeper(player) ? { ...player, ...weakKeeper, source_person_id: player.source_person_id } : player);
      const eliteKeeperRoster = opponentRoster.map((player) =>
        isGoalkeeper(player) ? { ...player, ...eliteKeeper, source_person_id: player.source_person_id } : player);
      let goalsAgainstWeakKeeper = 0;
      let goalsAgainstEliteKeeper = 0;
      for (let index = 0; index < 80; index += 1) {
        state.matchNumber = 600 + index;
        goalsAgainstWeakKeeper += matchSimulation("milan", weakKeeperRoster, "Group stage").userGoals;
        goalsAgainstEliteKeeper += matchSimulation("milan", eliteKeeperRoster, "Group stage").userGoals;
      }
      globalThis.assert.ok(
        goalsAgainstWeakKeeper > goalsAgainstEliteKeeper,
        "Elite goalkeeping should reduce goals conceded across the same seeded matches",
      );
      const captainLineup = userPlayers();
      const withCaptain = teamModel(captainLineup).overall;
      const withoutCaptain = teamModel(captainLineup.map((player) => ({ ...player, isCaptain: false }))).overall;
      globalThis.assert.ok(withCaptain > withoutCaptain && withCaptain - withoutCaptain < 2);
      globalThis.assert.equal(SCENARIOS.ucl0203.database, "cm0203_vanilla_original");
      globalThis.assert.equal(SCENARIOS.ucl0304.database, "cm0304_vanilla_original");
      globalThis.assert.deepEqual(
        Object.fromEntries(Object.entries(SCENARIOS.ucl0203.groups).map(([key, value]) => [key, value.replace])),
        { A: "newcastle", B: "roma", C: "lokomotiv", D: "basel" },
      );
      globalThis.assert.deepEqual(
        Object.fromEntries(Object.entries(SCENARIOS.ucl0304.groups).map(([key, value]) => [key, value.replace])),
        {
          A: "anderlecht", B: "dynamo", C: "aek", D: "olympiacos",
          E: "rangers", F: "partizan", G: "lazio", H: "celta",
        },
      );
      globalThis.assert.equal(SCENARIOS.ucl0203.entryPairs.length, 4);
      globalThis.assert.equal(SCENARIOS.ucl0304.entryPairs.length, 8);
      for (const config of Object.values(SCENARIOS)) {
        const pairedSeeds = config.entryPairs.flat().slice().sort();
        const availableSeeds = Object.keys(config.seeds).sort();
        globalThis.assert.deepEqual(
          pairedSeeds,
          availableSeeds,
          config.key + " must place every group winner and runner-up exactly once",
        );
        globalThis.assert.equal(
          config.stages.length,
          Math.log2(config.entryPairs.length) + 1,
          config.key + " must have one named stage per knockout round",
        );
      }
      state.groupPlace = 1;
      state.groupCompanion = groupOpponents[0];
      initializeKnockoutBracket();
      const firstPlaceRound = currentRoundFixtures();
      globalThis.assert.equal(firstPlaceRound.flat().filter((key) => key === "user").length, 1);
      globalThis.assert.equal(firstPlaceRound.flat().filter((key) => key === state.groupCompanion).length, 1);
      globalThis.assert.ok(currentKnockoutOpponent());
      state.groupPlace = 2;
      initializeKnockoutBracket();
      const secondPlaceRound = currentRoundFixtures();
      globalThis.assert.equal(secondPlaceRound.flat().filter((key) => key === "user").length, 1);
      globalThis.assert.equal(secondPlaceRound.flat().filter((key) => key === state.groupCompanion).length, 1);
      const openingFixtureCount = secondPlaceRound.length;
      globalThis.assert.ok(advanceKnockoutBracket());
      globalThis.assert.equal(currentRoundFixtures().length, openingFixtureCount / 2);
      const takers = await penaltyTakers(userPlayers(), new Set(), "user");
      globalThis.assert.ok(takers.length > 0);
      globalThis.assert.ok(takers.slice(0, 5).every((item) => !item.defender));
      globalThis.assert.ok(takers.every((item) => !isGoalkeeper(item.player)));
      let tied;
      for (let index = 200; index < 500 && !tied; index += 1) {
        state.matchNumber = index;
        const candidate = matchSimulation("milan", opponentRoster, "Round of 16");
        if (candidate.needsPenalties) tied = candidate;
      }
      globalThis.assert.ok(tied, "Expected at least one tied knockout simulation");
      await preparePenaltyShootout(tied, opponentRoster);
      globalThis.assert.ok(tied.shootout[0] !== tied.shootout[1]);
      globalThis.assert.ok(tied.penaltyEvents.length >= 3);
    })()
  `);

const fakeElement = () => ({
  addEventListener() {},
  append() {},
  appendChild() {},
  classList: { add() {}, remove() {} },
  querySelector() { return fakeElement(); },
  replaceChildren() {},
  setAttribute() {},
  style: {},
});
await vm.runInNewContext(runSource, {
  assert,
  console,
  Date,
  Map,
  Math,
  Promise,
  Set,
  clearInterval,
  createCanonicalMatchTimeline,
  createDraftSquad,
  document: { createElement: fakeElement, querySelector: fakeElement },
  formatDraftSquadText,
  localStorage: {
    getItem(key) {
      return key === "retroball-draft-team-v1" ? JSON.stringify(savedTeam) : "";
    },
    setItem() {},
  },
  sessionStorage: {
    getItem() { return ""; },
    setItem() {},
  },
  reduceMatchTimeline,
  testOpponentRoster: opponentRoster,
  URLSearchParams,
  setInterval,
  setTimeout,
  saveDraftSquad: async () => ({ ok: true }),
  window: {
    clearInterval,
    location: { hash: "" },
    setInterval,
    setTimeout,
  },
});

console.log("Draft formation and simulation checks passed.");
