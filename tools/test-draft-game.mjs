import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const setupSource = fs.readFileSync(new URL("../draft-setup.js", import.meta.url), "utf8")
  .replace(/^import[\s\S]*?;\r?\n/, "")
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
    globalThis.assert.equal(positionAbilityMultiplier(unratedGoalkeeper, "MC"), 0.35);
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
    const tierPulls = [0, 0, 0, 0, 0, 0];
    for (let seed = 1; seed <= 400; seed += 1) {
      for (const candidate of chooseSuggestions(suggestionPool, seed)) {
        tierPulls[abilityDropTier(candidate)] += 1;
      }
    }
    const pullTotal = tierPulls.reduce((sum, count) => sum + count, 0);
    globalThis.assert.ok(tierPulls[0] > 0 && tierPulls[0] / pullTotal < 0.04);
    globalThis.assert.ok(tierPulls[1] / pullTotal > 0.04 && tierPulls[1] / pullTotal < 0.12);
    globalThis.assert.ok(tierPulls[2] / pullTotal > 0.04 && tierPulls[2] / pullTotal < 0.13);
    globalThis.assert.ok(tierPulls[3] / pullTotal > 0.27 && tierPulls[3] / pullTotal < 0.42);
    globalThis.assert.ok(tierPulls[3] > tierPulls[1] + tierPulls[2]);
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
    latePool.push({
      database_slug: "emergency-db",
      source_person_id: "emergency",
      canonical_player_public_id: "emergency-left-back",
      current_ability: 118,
      position_ratings: leftBackRatings,
    });
    state.rerollsRemaining = 3;
    const unprotectedLateRoll = chooseSuggestions(latePool, 91);
    globalThis.assert.ok(
      unprotectedLateRoll.some((candidate) => bestFit(candidate).score === 0),
      "Late rolls must not automatically fill the final position",
    );
    state.rerollsRemaining = 0;
    const emergencyLateRoll = chooseSuggestions(latePool, 91);
    globalThis.assert.ok(
      emergencyLateRoll.some((candidate) => bestFit(candidate).score > 0),
      "The exhausted final reroll should retain one modest escape route",
    );
  `);

vm.runInNewContext(setupSource, {
  assert,
  document: { querySelector: () => ({}) },
  Map,
  Set,
  console,
});

const runHtml = fs.readFileSync(new URL("../draft-run.html", import.meta.url), "utf8");
const runSourceText = fs.readFileSync(new URL("../draft-run.js", import.meta.url), "utf8");
assert.ok(!runHtml.includes('id="runClock"'), "The match clock must not remain in the sidebar");
assert.ok(runSourceText.includes("data-match-clock"), "Every active match must render its own clock");
assert.ok(
  runSourceText.includes("clockDisplay.textContent = `${minute}'`;"),
  "The active match clock must advance inside its scoreboard",
);

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

const runSource = fs.readFileSync(new URL("../draft-run.js", import.meta.url), "utf8")
  .replace(/^import[\s\S]*?;\r?\n/, "")
  .split("elements.nextButton.addEventListener")[0]
  .concat(`
    (async () => {
      const opponentRoster = globalThis.testOpponentRoster;
      let redCards = 0;
      for (let index = 0; index < 180; index += 1) {
        state.matchNumber = index;
        const result = matchSimulation("milan", opponentRoster, index % 2 ? "Group stage" : "Round of 16");
        const allEvents = [...result.events, ...result.extraTimeEvents];
        globalThis.assert.ok(result.manOfMatch?.name);
        globalThis.assert.ok(result.minuteDelay >= 110 && result.minuteDelay <= 235);
        redCards += allEvents.filter((event) => event.card === "red").length;
        const userGoals = allEvents.filter((event) => event.goal && event.side === "user").length;
        const rivalGoals = allEvents.filter((event) => event.goal && event.side === "opponent").length;
        globalThis.assert.equal(userGoals, result.userGoals);
        globalThis.assert.equal(rivalGoals, result.rivalGoals);
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
      state.groupPlace = 1;
      state.knockoutIndex = 0;
      const firstPlaceRound = currentRoundFixtures();
      globalThis.assert.deepEqual(firstPlaceRound[3], ["milan", "arsenal"]);
      globalThis.assert.deepEqual(firstPlaceRound[6], ["sparta", "user"]);
      state.groupPlace = 2;
      const secondPlaceRound = currentRoundFixtures();
      globalThis.assert.deepEqual(secondPlaceRound[3], ["user", "arsenal"]);
      globalThis.assert.deepEqual(secondPlaceRound[6], ["sparta", "milan"]);
      state.groupCompanion = "ajax";
      globalThis.assert.deepEqual(currentRoundFixtures()[6], ["sparta", "ajax"]);
      state.groupCompanion = "milan";
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
  document: { createElement: fakeElement, querySelector: fakeElement },
  localStorage: {
    getItem(key) {
      return key === "retroball-draft-team-v1" ? JSON.stringify(savedTeam) : "";
    },
    setItem() {},
  },
  testOpponentRoster: opponentRoster,
  setInterval,
  setTimeout,
  window: { clearInterval, setInterval, setTimeout },
});

console.log("Draft formation and simulation checks passed.");
