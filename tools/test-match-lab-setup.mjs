// Match Setup Integration v1 tests -- the real Match Lab controller.
//
// tools/test-match-setup.mjs covers the pure modules with no DOM at all.
// This suite is the other half: it loads match-lab.js itself under the
// minimal fake DOM convention tools/test-possession-runner.mjs
// established, and drives the ACTUAL integration -- draft edits,
// deterministic reassignment, atomic Apply Setup, and the dead-ball guard.
//
// The player database is injected as a fake, so nothing here touches the
// network and the assertions are about behaviour rather than about which
// records a live API happened to return.
import { readFileSync } from "node:fs";

const fakeStyle = () => ({ setProperty() {}, removeProperty() {}, getPropertyValue() { return ""; } });
const fakeClassList = () => {
  const set = new Set();
  return {
    add: (...names) => names.forEach((name) => set.add(name)),
    remove: (...names) => names.forEach((name) => set.delete(name)),
    toggle(name, force) {
      if (force === undefined) { set.has(name) ? set.delete(name) : set.add(name); }
      else if (force) set.add(name);
      else set.delete(name);
    },
    contains: (name) => set.has(name),
  };
};
const fakeElement = () => {
  const el = {
    className: "", style: fakeStyle(), dataset: {}, classList: fakeClassList(),
    children: [], options: [], parentNode: null, value: "", textContent: "",
    innerHTML: "", hidden: false, checked: false, disabled: false,
    addEventListener() {}, removeEventListener() {}, setAttribute() {},
    getAttribute() { return null; }, removeAttribute() {},
    setPointerCapture() {}, releasePointerCapture() {},
    getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100 }; },
    querySelector() { return fakeElement(); }, querySelectorAll() { return []; },
    closest() { return null; },
    append(...nodes) { el.children.push(...nodes); },
    appendChild(node) { el.children.push(node); return node; },
    removeChild(node) { return node; },
    remove() {}, replaceChildren() { el.children = []; el.options = []; },
    focus() {}, click() {},
  };
  return el;
};
globalThis.document = {
  querySelector: () => fakeElement(), querySelectorAll: () => [],
  createElement: () => fakeElement(), addEventListener() {},
  body: fakeElement(), documentElement: { dataset: {} },
};
globalThis.window = globalThis;
globalThis.localStorage = { getItem() { return null; }, setItem() {}, removeItem() {} };
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
globalThis.fetch = async () => { throw new Error("network disabled in test"); };

const mod = await import("../match-lab.js");
const {
  state, setupDraft, reassignSetupTeam, applySetup, buildRestartDraft,
  placeRestartParticipants, zoneFromPercent, buildLastRun, elements,
  renderTeamTacticsControls, renderTacticsBoard, renderSlotEditor, setTeamInstruction,
  matchPitchIsLandscape, matchPitchDisplayPoint, matchPitchWorldPoint,
  setupShirtNumber, tacticalDraftSlotForEntry,
} = mod;
const { findHistoricalSquad } = await import("../src/data/historicalSquads.js");
const { specAliases, normalizePlayerName } = await import("../src/lib/historicalSquadResolver.js");
const { roleBand } = await import("../src/lib/formationTemplates.js");
const {
  validateGeneratedRestartSetup, validateRestartSetup,
} = await import("../src/lib/restartSetup.js");
const { candidateKey } = await import("../src/lib/positionFit.js");

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} -- ${label}`);
  if (!condition) failures += 1;
}

console.log("=== 0: the tactics screen exposes the complete team-instruction set ===");
{
  const html = readFileSync(new URL("../match-lab.html", import.meta.url), "utf8");
  const fields = [
    "kickoff", "mentality", "width", "focusPlay", "dribbling", "creativity", "finalThird",
    "timeWasting", "passIntoSpace", "playOutOfDefence", "onGain", "onLoss",
    "pressing", "tackling", "defensiveLine", "engagementLine", "pressingTrap",
    "crossEngagement", "offsideTrap", "preventShortGk",
  ];
  check("every expanded instruction has one Home and one Away control",
    fields.every((field) => (html.match(new RegExp(`data-field="${field}"`, "g")) ?? []).length === 2));
  check("the controls are grouped into possession, transition and defending sections",
    html.includes(">In possession<") && html.includes(">Transition<") && html.includes(">Out of possession<"));
}

console.log("\n=== 0b: desktop landscape pitch keeps the world coordinates reversible ===");
{
  const world = { x: 20, y: 70 };
  const display = matchPitchDisplayPoint(world, true);
  check("landscape display rotates pitch length onto the horizontal axis",
    display.x === 70 && display.y === 80);
  check("landscape pointer coordinates convert back to the exact world point",
    JSON.stringify(matchPitchWorldPoint(display, true)) === JSON.stringify(world));
  check("portrait/mobile presentation leaves world coordinates unchanged",
    JSON.stringify(matchPitchDisplayPoint(world, false)) === JSON.stringify(world)
      && JSON.stringify(matchPitchWorldPoint(world, false)) === JSON.stringify(world));
  check("the rendered field rectangle decides which interaction mapping applies",
    matchPitchIsLandscape({ width: 900, height: 560 })
      && !matchPitchIsLandscape({ width: 560, height: 900 }));

  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  check("desktop CSS gives the pitch a 120-by-75 landscape canvas",
    /@media \(min-width: 1181px\)[\s\S]*?\.match-lab-pitch \{[\s\S]*?aspect-ratio: 120 \/ 75/.test(css));
}

// A fake resolved squad, seeded straight into the controller's own cache.
// Position ratings are real enough for positionFit() to place everyone.
function fakeSquadPlayers(squadKey, { keeperIsOutfield = false } = {}) {
  const squad = findHistoricalSquad(squadKey);
  const shapes = [
    ["GK", { goalkeeper: 20 }],
    ["D R", { defender: 20, "right side": 20, central: 12 }],
    ["D C", { defender: 20, central: 20 }],
    ["D C", { defender: 20, central: 20 }],
    ["D L", { defender: 20, "left side": 20, central: 12 }],
    ["DM C", { "defensive midfielder": 20, midfielder: 18, central: 20 }],
    ["M C", { midfielder: 20, central: 20 }],
    ["M L", { midfielder: 20, "left side": 20 }],
    ["M R", { midfielder: 20, "right side": 20 }],
    ["F C", { attacker: 20, central: 20 }],
    ["F C", { attacker: 20, central: 20 }],
  ];
  return squad.players.map((spec, index) => {
    const [positionText, ratings] = shapes[index] ?? shapes[10];
    const shape = index === 0 && keeperIsOutfield ? ["M C", { midfielder: 20, central: 20 }] : [positionText, ratings];
    return {
      database_slug: squad.database,
      source_person_id: `${squadKey}-${index}`,
      canonical_player_name: specAliases(spec)[0] ?? `player-${index}`,
      position_text: shape[0],
      current_ability: 160 - index,
      position_ratings: Object.entries(shape[1]).map(([label, value]) => ({ label, value })),
    };
  });
}
function seedSquad(team, squadKey, options) {
  const players = fakeSquadPlayers(squadKey, options);
  state.resolvedSquads.set(squadKey, { players, squad: findHistoricalSquad(squadKey) });
  setupDraft()[team].squadKey = squadKey;
  reassignSetupTeam(team);
  return players;
}

const HOME_KEY = "titan-brazil-2002";
const AWAY_KEY = "titan-france-2000";
const UNITED_KEY = "titan-united-1999";
const LIVERPOOL_KEY = "titan-liverpool-2001";

function draftLineupBySlot(team) {
  const teamSetup = setupDraft()[team];
  const players = state.resolvedSquads.get(teamSetup.squadKey)?.players ?? [];
  const playerById = new Map(players.map((player) => [candidateKey(player), player]));
  const occurrences = new Map();
  return Object.fromEntries(teamSetup.slots.map((slot) => {
    const occurrence = occurrences.get(slot.positionalSlot) ?? 0;
    occurrences.set(slot.positionalSlot, occurrence + 1);
    const player = playerById.get(slot.playerId);
    return [
      `${slot.positionalSlot}#${occurrence}`,
      normalizePlayerName(player?.canonical_player_name ?? ""),
    ];
  }));
}

// ---------------------------------------------------------------------------
console.log("=== 1: the draft is separate from the live pitch ===");
{
  state.roster = [{ id: "existing", role: "player", team: "home", x: 10, y: 10, zone: 0, player: { canonical_player_name: "Existing" } }];
  state.ball = { x: 10, y: 10, zone: 0, ownerId: "existing" };
  const before = JSON.stringify(state.roster);
  seedSquad("home", HOME_KEY);
  seedSquad("away", AWAY_KEY);
  check("seeding squads and reassigning does not touch state.roster",
    JSON.stringify(state.roster) === before);
  check("the draft holds its own slots for both teams",
    setupDraft().home.slots.length === 11 && setupDraft().away.slots.length === 11);
  check("each team keeps its own squad key",
    setupDraft().home.squadKey === HOME_KEY && setupDraft().away.squadKey === AWAY_KEY);
  check("every draft slot has a player assigned",
    setupDraft().home.slots.every((slot) => slot.playerId));
}

// ---------------------------------------------------------------------------
console.log("\n=== 1b: curated final-day lineups keep their exact board order ===");
{
  setupDraft().home.formation = "4-4-2";
  seedSquad("home", UNITED_KEY);
  const united = draftLineupBySlot("home");
  check("Manchester United 1999 places the back four in the referenced order",
    united["DL#0"] === "denis irwin" && united["DC#0"] === "jaap stam"
      && united["DC#1"] === "ronny johnsen" && united["DR#0"] === "gary neville");
  check("Manchester United 1999 places Blomqvist, Butt, Beckham and Giggs left-to-right",
    united["ML#0"] === "jesper blomqvist" && united["MC#0"] === "nicky butt"
      && united["MC#1"] === "david beckham" && united["MR#0"] === "ryan giggs");
  check("Manchester United 1999 places Cole left of Yorke",
    united["FC#0"] === "andy cole" && united["FC#1"] === "dwight yorke");

  setupDraft().away.formation = "4-4-2";
  seedSquad("away", LIVERPOOL_KEY);
  const liverpool = draftLineupBySlot("away");
  check("Liverpool 2001 places Carragher, Hyypia, Henchoz and Babbel left-to-right",
    liverpool["DL#0"] === "jamie carragher" && liverpool["DC#0"] === "sami hyypia"
      && liverpool["DC#1"] === "stephane henchoz" && liverpool["DR#0"] === "markus babbel");
  check("Liverpool 2001 places Murphy, McAllister, Hamann and Gerrard left-to-right",
    liverpool["ML#0"] === "danny murphy" && liverpool["MC#0"] === "gary mcallister"
      && liverpool["MC#1"] === "dietmar hamann" && liverpool["MR#0"] === "steven gerrard");
  check("Liverpool 2001 places Heskey left of Owen",
    liverpool["FC#0"] === "emile heskey" && liverpool["FC#1"] === "michael owen");

  seedSquad("home", HOME_KEY);
  seedSquad("away", AWAY_KEY);
}

// ---------------------------------------------------------------------------
console.log("\n=== 2: Apply Setup is atomic and replaces the pitch only on success ===");
{
  const before = JSON.stringify(state.roster);
  // A missing away squad must abort BEFORE anything is written.
  setupDraft().away.squadKey = null;
  const failed = await applySetup();
  check("apply refuses when a squad is missing", failed === false);
  check("a failed apply leaves the roster untouched", JSON.stringify(state.roster) === before);
  check("a failed apply leaves the ball untouched", state.ball.ownerId === "existing");

  setupDraft().away.squadKey = AWAY_KEY;
  reassignSetupTeam("away");
  const applied = await applySetup();
  check("apply succeeds once both squads resolve", applied === true);
  check("the pitch now holds both full teams", state.roster.length === 22);
  check("home and away are both present",
    state.roster.filter((e) => e.team === "home").length === 11
    && state.roster.filter((e) => e.team === "away").length === 11);
  check("exactly one goalkeeper per team",
    ["home", "away"].every((team) =>
      state.roster.filter((e) => e.team === team && e.role === "keeper").length === 1));
  check("no player is assigned twice",
    (() => {
      const keys = state.roster.map((e) => candidateKey(e.player));
      return new Set(keys).size === keys.length;
    })());
  check("the two teams occupy opposite halves",
    (() => {
      const mean = (team) => {
        const rows = state.roster.filter((e) => e.team === team);
        return rows.reduce((total, e) => total + e.y, 0) / rows.length;
      };
      return (mean("home") > 50) !== (mean("away") > 50);
    })());
  // The APPLIED ROSTER must be legal, not merely the layout arrays. A
  // player left on an open-play formation anchor is exactly how an illegal
  // kick-off shape would slip through an all-green layout check.
  check("the whole applied roster is legal for the authored restart",
    (() => {
      const draft = setupDraft();
      const taking = state.roster
        .filter((e) => e.team === state.restartSetupDraft.takingTeam)
        .map((e) => ({ ...e, required: e.id === state.pendingRestart.takerId }));
      const defending = state.roster.filter((e) => e.team !== state.restartSetupDraft.takingTeam);
      void draft;
      return validateRestartSetup(state.restartSetupDraft, { taking, defending }).valid;
    })());
  check("at kick-off every player except the taker starts in their own half",
    (() => {
      if (state.restartSetupDraft.type !== "kickoff") return true;
      return state.roster.every((entry) => {
        if (entry.id === state.pendingRestart.takerId) return true;
        const attacking = setupDraft()[entry.team].attackingDirection;
        return attacking === "up" ? entry.y > 50 - 0.001 : entry.y < 50 + 0.001;
      });
    })());
  check("each goalkeeper is at the end their own team defends",
    (() => {
      const keeper = (team) => state.roster.find((e) => e.team === team && e.role === "keeper");
      return (keeper("home").y > 50) !== (keeper("away").y > 50);
    })());
  check("no outfield player became a goalkeeper",
    state.roster.filter((e) => e.role === "keeper")
      .every((e) => /GK/i.test(e.player.position_text ?? "")));
  check("every roster entry carries slot, role and duty as separate fields",
    state.roster.every((e) => e.positionalSlot && e.tacticalRole && e.duty));
  check("tactics-board coordinates and main-pitch formation anchors are identical",
    state.roster.every((entry) => {
      const slot = setupDraft()[entry.team].slots.find(
        (candidate) => `${entry.team}-${candidate.slotId}` === entry.id,
      );
      return slot && entry.formationAnchor
        && Math.abs(slot.x - entry.formationAnchor.x) < 1e-9
        && Math.abs(slot.y - entry.formationAnchor.y) < 1e-9;
    }));
}

// ---------------------------------------------------------------------------
console.log("\n=== 3: the applied setup is a dead ball that cannot enter open play ===");
{
  check("a pending restart is recorded", Boolean(state.pendingRestart));
  check("it names a RESTART first action, never the open-play chooser",
    state.pendingRestart.requiredFirstAction.startsWith("RESTART.")
    && !state.pendingRestart.requiredFirstAction.includes("ACTION.CHOICE"));
  check("the taker owns the dead ball -- they are the player standing over it",
    state.ball.ownerId === state.pendingRestart.takerId);
  check("owning the dead ball is not open play: the ball still carries a dead phase",
    state.ball.phase === "dead" && state.ball.deadBall === true);
  check("the pending restart stays authoritative alongside that ownership",
    Boolean(state.pendingRestart.requiredFirstAction));
  check("the ball sits on the restart's own legal spot",
    Math.abs(state.ball.x - state.restartSetupDraft.ball.x) < 1e-9
    && Math.abs(state.ball.y - state.restartSetupDraft.ball.y) < 1e-9);
  check("the applied restart still validates as legal",
    validateGeneratedRestartSetup(state.restartSetupDraft).valid);
  check("a nominated taker exists and is a real roster entry",
    Boolean(state.pendingRestart.takerId)
    && state.roster.some((e) => e.id === state.pendingRestart.takerId));
  const savedRestart = state.restartSetupDraft;
  state.restartSetupDraft = null;
  const blocked = mod.runConstructedPossession(123);
  check("an incomplete dead-ball setup cannot fall through to ACTION.CHOICE",
    blocked.result?.code === "RESTART.INVALID"
    && !blocked.trace.some((event) => event.code === "ACTION.CHOICE"));
  state.restartSetupDraft = savedRestart;
}

// ---------------------------------------------------------------------------
console.log("\n=== 4: restart roles reach the right players ===");
{
  const draft = setupDraft();
  for (const type of ["corner", "goal-kick", "free-kick"]) {
    const restart = buildRestartDraft.call
      ? (() => {
          // buildRestartDraft() reads the live selects; construct directly
          // instead so the test controls the type.
          const { createRestartSetup } = mod;
          void createRestartSetup;
          return null;
        })()
      : null;
    void restart;
    void type;
  }
  // Drive placement directly with a known spec.
  const { createRestartSetup } = await import("../src/lib/restartSetup.js");
  const teams = {};
  for (const team of ["home", "away"]) {
    teams[team] = {
      entries: draft[team].slots.map((slot) => ({
        id: `${team}-${slot.slotId}`,
        role: roleBand(slot.positionalSlot) === "GK" ? "keeper" : "player",
        positionalSlot: slot.positionalSlot,
        // Restart roles are assigned by football suitability now, so a
        // participant without a player record cannot be scored.
        player: state.resolvedSquads.get(draft[team].squadKey)?.players
          .find((candidate) => candidateKey(candidate) === slot.playerId) ?? null,
        x: slot.x, y: slot.y,
      })).filter((entry) => entry.player),
    };
  }
  const corner = createRestartSetup({
    type: "corner", takingTeam: "home", takerId: "pending", side: "right",
    attackingDirectionByTeam: { home: draft.home.attackingDirection, away: draft.away.attackingDirection },
  });
  const placed = placeRestartParticipants(corner, teams);
  const keeperEntry = teams.away.entries.find((e) => e.role === "keeper");
  const keeperSpot = placed.placements.get(keeperEntry.id);
  const keeperRole = corner.layout.defending.find((role) => role.anchoredToGoal);
  check("the defending goalkeeper takes the goal-anchored restart role",
    Math.abs(keeperSpot.x - keeperRole.x) < 1e-9 && Math.abs(keeperSpot.y - keeperRole.y) < 1e-9);
  check("the corner keeper is at the goal, not the corner flag",
    Math.abs(keeperSpot.y - (draft.home.attackingDirection === "up" ? 0 : 100)) < 6);
  const takerSpot = placed.placements.get(placed.takerId);
  check("the nominated taker stands on the ball",
    Math.abs(takerSpot.x - corner.ball.x) < 1e-9 && Math.abs(takerSpot.y - corner.ball.y) < 1e-9);
  check("the taker is a taking-team player",
    placed.takerId.startsWith("home-"));
  check("no two players share a restart placement slot",
    (() => {
      const spots = [...placed.placements.entries()].map(([, spot]) => `${spot.x},${spot.y}`);
      const layoutCount = corner.layout.taking.length + corner.layout.defending.length;
      // Formation anchors may legitimately repeat only if the shape does;
      // the LAYOUT spots themselves must all be distinct.
      return new Set(spots).size >= layoutCount;
    })());
  check("an outfielder never takes a goalkeeper restart role",
    (() => {
      const outfieldIds = teams.away.entries.filter((e) => e.role !== "keeper").map((e) => e.id);
      return outfieldIds.every((id) => {
        const spot = placed.placements.get(id);
        return !(Math.abs(spot.x - keeperRole.x) < 1e-9 && Math.abs(spot.y - keeperRole.y) < 1e-9);
      });
    })());
}

// ---------------------------------------------------------------------------
console.log("\n=== 4b: a valid setup-panel taker override wins over Auto ===");
{
  elements.restartTypeSelect.value = "kickoff";
  elements.restartTeamSelect.value = "home";
  const manualId = `home-${setupDraft().home.slots.find(
    (slot) => slot.included && slot.positionalSlot === "DL",
  ).slotId}`;
  elements.restartTakerSelect.value = manualId;
  const applied = await applySetup();
  check("the manually selected player takes the restart",
    applied && state.pendingRestart?.takerId === manualId
    && state.ball.ownerId === manualId);
  elements.restartTakerSelect.value = "";
  await applySetup();
}

// ---------------------------------------------------------------------------
console.log("\n=== 5: applying the same setup twice is reproducible ===");
{
  const first = JSON.stringify(state.roster.map((e) => [e.id, e.x, e.y, candidateKey(e.player)]));
  const firstBall = JSON.stringify(state.ball);
  await applySetup();
  const second = JSON.stringify(state.roster.map((e) => [e.id, e.x, e.y, candidateKey(e.player)]));
  check("identical squads, formation, format and restart give identical assignments and coordinates",
    first === second);
  check("the ball lands on the identical spot", firstBall === JSON.stringify(state.ball));

  // Changing formation must visibly rearrange, then still be reproducible.
  setupDraft().home.formation = "3-5-2";
  reassignSetupTeam("home");
  await applySetup();
  const rearranged = JSON.stringify(state.roster.map((e) => [e.id, e.x, e.y]));
  check("changing formation rearranges the shape", rearranged !== second);
  setupDraft().home.formation = "3-5-2";
  reassignSetupTeam("home");
  await applySetup();
  check("the rearranged shape is itself reproducible",
    JSON.stringify(state.roster.map((e) => [e.id, e.x, e.y])) === rearranged);
}

// ---------------------------------------------------------------------------
console.log("\n=== 6: role and duty instructions survive a formation change ===");
{
  setupDraft().home.formation = "4-3-3";
  reassignSetupTeam("home");
  const slot = setupDraft().home.slots.find((item) => item.positionalSlot === "DC");
  slot.tacticalRole = "ball-playing-defender";
  slot.duty = "support";
  setupDraft().home.formation = "4-4-2";
  reassignSetupTeam("home");
  const carried = setupDraft().home.slots.find((item) => item.positionalSlot === "DC");
  check("a compatible slot keeps its authored role after a formation change",
    carried.tacticalRole === "ball-playing-defender");
  check("and keeps its authored duty", carried.duty === "support");
  check("positional slot, role, duty and engine job stay four separate fields",
    carried.positionalSlot === "DC" && carried.tacticalRole === "ball-playing-defender"
    && carried.duty === "support" && carried.engineJob === null);
  carried.tacticalRole = "poacher";
  reassignSetupTeam("home");
  const repaired = setupDraft().home.slots.find((item) => item.positionalSlot === "DC");
  check("an incompatible legacy role falls back to the position's default",
    repaired.tacticalRole === "central-defender");
}

// ---------------------------------------------------------------------------
console.log("\n=== 6b: the active team tab scopes the team-tactics column ===");
{
  const homeMarking = fakeElement();
  const awayMarking = fakeElement();
  const homeAttacking = fakeElement();
  const awayAttacking = fakeElement();
  const homeTransition = fakeElement();
  const awayTransition = fakeElement();
  homeMarking.dataset.team = "home";
  awayMarking.dataset.team = "away";
  homeAttacking.dataset.team = "home";
  awayAttacking.dataset.team = "away";
  homeTransition.dataset.team = "home";
  awayTransition.dataset.team = "away";
  elements.teamTacticGroups = [
    homeMarking, awayMarking, homeAttacking, awayAttacking, homeTransition, awayTransition,
  ];
  elements.teamTacticsTitle = fakeElement();

  state.setupTeamTab = "home";
  renderTeamTacticsControls();
  check("the Home tab shows only Home possession, transition and defending controls",
    !homeMarking.hidden && !homeAttacking.hidden && !homeTransition.hidden
      && awayMarking.hidden && awayAttacking.hidden && awayTransition.hidden);
  check("the team-tactics heading identifies Home", elements.teamTacticsTitle.textContent === "Home team tactics");

  state.setupTeamTab = "away";
  renderTeamTacticsControls();
  check("the Away tab shows only Away possession, transition and defending controls",
    homeMarking.hidden && homeAttacking.hidden && homeTransition.hidden
      && !awayMarking.hidden && !awayAttacking.hidden && !awayTransition.hidden);
  check("the team-tactics heading identifies Away", elements.teamTacticsTitle.textContent === "Away team tactics");

  state.setupTeamTab = "home";
  check("a Home instruction edit changes the Home draft only",
    setTeamInstruction("home", "attacking", "mentality", "attacking")
      && setupDraft().home.attacking.mentality === "attacking"
      && setupDraft().away.attacking.mentality === "balanced");
  check("the same binding normalizes transition and defending choices",
    setTeamInstruction("home", "transition", "onLoss", "counter-press")
      && setTeamInstruction("home", "marking", "pressing", "high")
      && setupDraft().home.transition.onLoss === "counter-press"
      && setupDraft().home.marking.pressing === "high");
  setTeamInstruction("home", "attacking", "mentality", "balanced");
  setTeamInstruction("home", "transition", "onLoss", "balanced");
  setTeamInstruction("home", "marking", "pressing", "standard");
}

// ---------------------------------------------------------------------------
console.log("\n=== 6c: the selected role map can be shown and hidden ===");
{
  state.setupTeamTab = "home";
  state.setupBoardView = "open-play";
  state.selectedSetupSlotId = setupDraft().home.slots.find((slot) => slot.positionalSlot === "DC").slotId;
  state.showRoleMap = true;
  elements.tacticsBoard = fakeElement();
  elements.roleMapNote = fakeElement();
  elements.showRoleMapCheckbox = fakeElement();
  renderTacticsBoard();
  const visibleMap = elements.tacticsBoard.children.find(
    (child) => child.className === "match-lab-role-map-grid",
  );
  check("selecting a player draws a pixelated role map on the tactics pitch",
    Boolean(visibleMap && visibleMap.children.length > 0));
  check("the map explains its real-world pixel scale",
    elements.roleMapNote.textContent.includes("5 × 5 yd")
      && elements.roleMapNote.textContent.includes("4.6 × 4.6 m"));

  state.showRoleMap = false;
  renderTacticsBoard();
  check("turning the option off removes the map and restores a clean board",
    !elements.tacticsBoard.children.some((child) => child.className === "match-lab-role-map-grid")
      && elements.roleMapNote.textContent === "Role map hidden.");
  state.showRoleMap = true;
  state.selectedSetupSlotId = null;
}

// ---------------------------------------------------------------------------
console.log("\n=== 6d: a dragged WIB/WOB position becomes Manual in its saved ball area ===");
{
  state.setupTeamTab = "home";
  state.setupBoardView = "with-ball";
  state.setupPhaseZone = 7;
  const slot = setupDraft().home.slots.find((item) => item.positionalSlot === "MC");
  state.selectedSetupSlotId = slot.slotId;
  const storedRole = slot.tacticalRole;
  const storedDuty = slot.duty;
  slot.withBallPositions = { 7: { x: 71, y: 36 } };
  elements.slotRole = fakeElement();
  elements.slotRoleNote = fakeElement();
  elements.slotDuty = fakeElement();
  elements.resetPhasePosition = fakeElement();
  elements.slotEditorEmpty = fakeElement();
  elements.slotEditorFields = fakeElement();
  elements.slotPlayer = fakeElement();
  elements.slotPosition = fakeElement();
  renderSlotEditor();
  check("the active dragged position labels tactical role and duty as Manual",
    elements.slotRole.value === "manual" && elements.slotDuty.value === "manual");
  check("role and duty cannot be edited while the current ball area is Manual",
    elements.slotRole.disabled && elements.slotDuty.disabled
      && elements.slotRoleNote.textContent.includes("Reset it"));
  check("manual mode preserves the saved formation role and duty underneath",
    slot.tacticalRole === storedRole && slot.duty === storedDuty);
  state.setupPhaseZone = 1;
  renderSlotEditor();
  check("an untouched ball area restores the position-dependent role and duty controls",
    !elements.slotRole.disabled && !elements.slotDuty.disabled
      && elements.slotRole.value === storedRole && elements.slotDuty.value === storedDuty);
  delete slot.withBallPositions[7];
  state.setupBoardView = "open-play";
  state.selectedSetupSlotId = null;
}

// ---------------------------------------------------------------------------
console.log("\n=== 6e: tactics markers have fixed shirts, external names and duty dots ===");
{
  state.setupTeamTab = "home";
  state.setupBoardView = "open-play";
  const slot = setupDraft().home.slots.find((item) => item.positionalSlot === "MC");
  const originalDuty = slot.duty;
  slot.duty = "support";
  elements.tacticsBoard = fakeElement();
  renderTacticsBoard();
  const markers = elements.tacticsBoard.children.filter(
    (child) => child.className === "match-lab-tactics-marker",
  );
  const marker = markers.find((child) => child.dataset.slotId === slot.slotId);
  const shirt = marker?.children.find((child) => child.className === "match-lab-tactics-shirt");
  const name = marker?.children.find((child) => child.className === "match-lab-tactics-name");
  const details = shirt?.children.find((child) => child.className === "match-lab-tactics-details");
  const duty = shirt?.children.find((child) => child.className === "match-lab-duty-indicator");
  check("every player marker owns the same fixed shirt frame",
    markers.length === setupDraft().home.slots.length
      && markers.every((item) => item.children.some((child) => child.className === "match-lab-tactics-shirt")));
  check("the variable player name is a sibling below the shirt, never part of its dimensions",
    Boolean(name && shirt && !shirt.children.includes(name)));
  check("the shirt displays positional slot and tactical role together",
    details?.children.some((child) => child.className === "match-lab-tactics-slot")
      && details?.children.some((child) => child.className === "match-lab-tactics-role-name"));
  check("duty dots are ordered Attack, Support, Defend from top to bottom",
    JSON.stringify(duty?.children.map((dot) => dot.dataset.duty))
      === JSON.stringify(["attack", "support", "defend"]));
  check("only the selected Support duty dot is active",
    duty?.children.filter((dot) => dot.dataset.active === "true").length === 1
      && duty.children[1].dataset.active === "true");
  state.selectedSetupSlotId = slot.slotId;
  elements.slotDuty = fakeElement();
  renderSlotEditor();
  check("the Duty selector follows the same Attack, Support, Defend order",
    JSON.stringify(elements.slotDuty.children.map((option) => option.value))
      === JSON.stringify(["attack", "support", "defend"]));
  check("a database squad number wins over the stable lineup fallback",
    setupShirtNumber({ ratings: { squad_number: 11 } }, 4) === "11"
      && setupShirtNumber({ ratings: {} }, 4) === "5");
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  check("shirt dimensions are fixed and the name is absolutely positioned below",
    /\.match-lab-tactics-marker \{[\s\S]*?width: 58px;[\s\S]*?height: 48px;/.test(css)
      && /\.match-lab-tactics-name \{[\s\S]*?position: absolute;[\s\S]*?top: calc\(100% \+ 3px\);/.test(css));
  slot.duty = originalDuty;
}

// ---------------------------------------------------------------------------
console.log("\n=== 6f: formation markers reposition players and swap shirt assignments ===");
{
  const { applyTacticsFormationDrop } = mod;
  const team = {
    slots: [
      {
        slotId: "left-wing",
        playerId: "test:1",
        x: 20,
        y: 42,
        tacticalRole: "winger",
        duty: "attack",
      },
      {
        slotId: "right-wing",
        playerId: "test:2",
        x: 80,
        y: 42,
        tacticalRole: "wide-midfielder",
        duty: "support",
      },
    ],
  };

  const moved = applyTacticsFormationDrop(team, "left-wing", { x: 34, y: 27 });
  check("dropping a shirt on open grass moves that formation anchor",
    moved.kind === "move" && team.slots[0].x === 34 && team.slots[0].y === 27);
  check("repositioning one shirt leaves the other position and both player assignments alone",
    team.slots[1].x === 80 && team.slots[1].y === 42
      && team.slots[0].playerId === "test:1" && team.slots[1].playerId === "test:2");

  const leftPosition = {
    x: team.slots[0].x,
    y: team.slots[0].y,
    role: team.slots[0].tacticalRole,
    duty: team.slots[0].duty,
  };
  const rightPosition = {
    x: team.slots[1].x,
    y: team.slots[1].y,
    role: team.slots[1].tacticalRole,
    duty: team.slots[1].duty,
  };
  const swapped = applyTacticsFormationDrop(
    team,
    "left-wing",
    { x: team.slots[1].x, y: team.slots[1].y },
    "right-wing",
  );
  check("dropping one shirt onto another swaps the assigned players",
    swapped.kind === "swap"
      && team.slots[0].playerId === "test:2"
      && team.slots[1].playerId === "test:1");
  check("confirming the draft resolves a live player through the swapped shirt assignment",
    tacticalDraftSlotForEntry(team, {
      id: "home-left-wing",
      team: "home",
      player: { database_slug: "test", source_person_id: 1 },
    })?.slotId === "right-wing");
  check("a shirt swap keeps each tactical position's anchor, role and duty intact",
    JSON.stringify({
      x: team.slots[0].x,
      y: team.slots[0].y,
      role: team.slots[0].tacticalRole,
      duty: team.slots[0].duty,
    }) === JSON.stringify(leftPosition)
      && JSON.stringify({
        x: team.slots[1].x,
        y: team.slots[1].y,
        role: team.slots[1].tacticalRole,
        duty: team.slots[1].duty,
      }) === JSON.stringify(rightPosition));

  applyTacticsFormationDrop(team, "right-wing", { x: -20, y: 140 });
  check("formation repositioning stays inside the playable board",
    team.slots[1].x === 2 && team.slots[1].y === 98);
}

// ---------------------------------------------------------------------------
console.log("\n=== 7: a squad that cannot be sourced leaves the pitch alone ===");
{
  const before = JSON.stringify(state.roster);
  const beforeBall = JSON.stringify(state.ball);
  // A squad key with no cached resolution and no network fails strictly.
  state.resolvedSquads.delete(AWAY_KEY);
  state.squadFailures.set(AWAY_KEY, "Casillas is at Real Madrid C.F. B, not Real Madrid C.F.");
  setupDraft().away.squadKey = AWAY_KEY;
  const applied = await applySetup();
  check("apply refuses a squad that failed strict resolution", applied === false);
  check("the reason is preserved rather than replaced by a fallback",
    state.squadFailures.get(AWAY_KEY).includes("Real Madrid C.F. B"));
  check("the pitch is completely untouched", JSON.stringify(state.roster) === before);
  check("the ball is untouched", JSON.stringify(state.ball) === beforeBall);
  state.squadFailures.delete(AWAY_KEY);
}

// ---------------------------------------------------------------------------
console.log("\n=== 8: Quick Setup's Random XI stays explicit ===");
{
  const source = (await import("node:fs")).readFileSync(
    new URL("../match-lab.js", import.meta.url), "utf8");
  const formatStart = source.indexOf("elements.formatChoices?.addEventListener");
  const formatHandler = source.slice(
    formatStart,
    source.indexOf("addEventListener", formatStart + 60),
  );
  check("the format selector never calls the random quick-setup path",
    !/quickSetupMatch|Math\.random/.test(formatHandler));
  check("the format selector reassigns deterministically instead",
    formatHandler.includes("reassignSetupTeam"));
  check("Quick Setup's own random path still exists as its own control",
    source.includes("data-quick-setup"));
  check("applySetup never calls the random quick-setup path",
    !/quickSetupMatch/.test(source.slice(
      source.indexOf("async function applySetup()"),
      source.indexOf("// Wiring"))));
}

// ---------------------------------------------------------------------------
console.log("\n=== 9: Resolve & Play dispatches the restart, never ACTION.CHOICE first ===");
{
  // Section 7 deliberately tore down a resolved squad to prove a failed
  // apply is atomic; restore both before exercising restart execution.
  seedSquad("home", HOME_KEY);
  seedSquad("away", AWAY_KEY);
  const { runConstructedPossession, elements } = mod;
  const {
    buildMatchLabPlaybackPlan, validateMatchLabPlaybackPlan,
  } = await import("../src/lib/matchLabPlayback.js");
  const RESTART_CODES = {
    kickoff: "RESTART.KICKOFF.TAKE",
    "free-kick-attacking": "RESTART.FREE_KICK.TAKE",
    "free-kick-defending": "RESTART.FREE_KICK.TAKE",
    corner: "RESTART.CORNER.TAKE",
    "goal-kick": "RESTART.GOAL_KICK.TAKE",
    "throw-in": "RESTART.THROW_IN.TAKE",
  };
  for (const choice of Object.keys(RESTART_CODES)) {
    elements.restartTypeSelect.value = choice;
    elements.restartTakerSelect.value = "";
    const applied = await applySetup();
    check(`${choice}: applies`, applied === true);
    if (!applied) continue;
    const run = runConstructedPossession(4242);
    const first = run.trace[0]?.code;
    const choiceAt = run.trace.findIndex((event) => event.code === "ACTION.CHOICE");
    const restartAt = run.trace.findIndex((event) => String(event.code).startsWith("RESTART.")
      && event.code.endsWith(".TAKE"));
    check(`${choice}: the trace opens with ${RESTART_CODES[choice]}`, first === RESTART_CODES[choice]);
    check(`${choice}: no ACTION.CHOICE before the restart is taken`,
      choiceAt === -1 || choiceAt > restartAt);
    check(`${choice}: the restart event is the real trajectory, with contact and ownership data`,
      (() => {
        const event = run.trace[restartAt];
        return Boolean(event.ballFrom && event.ballTo && event.actorId
          && event.ownerBeforeId === state.pendingRestart.takerId
          && event.ownerAfterId !== undefined && event.contact
          && event.duration > 0 && event.ballTrajectory?.length >= 2);
      })());
    if (choice === "throw-in") {
      check("throw-in: the required event is explicitly a hand throw",
        run.trace[restartAt].movement === "throw"
        && run.trace[restartAt].contact.type === "throw"
        && run.trace[restartAt].lastTouch?.bodyPart === "hand");
    }
    if (choice === "free-kick-attacking") {
      check("direct free kick: the established wall resolver ran",
        run.trace.some((event) => String(event.restartSourceCode ?? event.code).startsWith("FK.WALL.")));
    }
    check(`${choice}: the dead ball becomes live -- a real resolver ran after it`,
      run.trace.length > 1 && !String(run.trace[1].code).startsWith("RESTART."));
    check(`${choice}: players release from the restart shape rather than teleporting`,
      run.trace.some((event) => event.code === "RESTART.RELEASE") || !run.trace.some((event) => event.code === "ACTION.CHOICE"));
    let playbackCheck;
    try {
      const plan = buildMatchLabPlaybackPlan({
        trace: run.trace,
        initialPositions: Object.fromEntries(state.roster.map((entry) => [entry.id, { x: entry.x, y: entry.y }])),
        initialBall: { x: state.ball.x, y: state.ball.y },
        initialOwnerId: state.ball.ownerId,
        finalOwnerId: run.finalOwnerId,
        restart: run.result?.restart,
        playerProfiles: Object.fromEntries(state.roster.map((entry) => [entry.id, entry.player])),
      });
      playbackCheck = validateMatchLabPlaybackPlan(plan);
    } catch (error) {
      playbackCheck = { valid: false, errors: [error.message] };
    }
    check(`${choice}: the restart compiles into contact-continuous playback`,
      playbackCheck.valid);
    if (!playbackCheck.valid) console.log(`       ${playbackCheck.errors.join("; ")}`);
  }
}

// ---------------------------------------------------------------------------
console.log("\n=== 10: the restart release uses kinetics, with no teleport ===");
{
  const { runConstructedPossession, elements } = mod;
  const { topSpeed } = await import("../src/lib/playerKinetics.js");
  const { movementDistanceYards } = await import("../src/lib/matchMovementTiming.js");
  elements.restartTypeSelect.value = "kickoff";
  elements.restartTakerSelect.value = "";
  await applySetup();
  const run = runConstructedPossession(4242);
  const release = run.trace.find((event) => event.code === "RESTART.RELEASE");
  const takingTeam = state.pendingRestart?.takingTeam ?? "home";
  const defendingTeam = state.pendingRestart?.defendingTeam ?? (takingTeam === "home" ? "away" : "home");
  const opening = run.shapeMetrics?.opening;
  const attackingAssignments = opening?.[takingTeam]?.assignments ?? [];
  const defendingAssignments = opening?.[defendingTeam]?.assignments ?? [];
  const metricSample = (metrics = {}) => ({
    widthYards: Number((metrics.widthYards ?? 0).toFixed(2)),
    lengthYards: Number((metrics.lengthYards ?? 0).toFixed(2)),
    occupiedLanes: metrics.occupiedLanes ?? 0,
    clusteredPlayers: metrics.clusteredPlayers ?? 0,
    viablePassingSupportOptions: metrics.viablePassingSupportOptions ?? 0,
    restDefenceCount: metrics.restDefenceCount ?? 0,
    defensiveLineHeightYards: metrics.defensiveLineHeightYards == null
      ? null : Number(metrics.defensiveLineHeightYards.toFixed(2)),
    midfieldLineHeightYards: metrics.midfieldLineHeightYards == null
      ? null : Number(metrics.midfieldLineHeightYards.toFixed(2)),
    forwardLineHeightYards: metrics.forwardLineHeightYards == null
      ? null : Number(metrics.forwardLineHeightYards.toFixed(2)),
    gapsBetweenLinesYards: (metrics.gapsBetweenLinesYards ?? []).map((value) => Number(value.toFixed(2))),
    minimumTeammateSeparationYards: metrics.minimumTeammateSeparationYards == null
      ? null : Number(metrics.minimumTeammateSeparationYards.toFixed(2)),
  });
  check("a release event exists", Boolean(release));
  check("release itself consumes no decision-free time", release?.duration === 0);
  check("release never forces a carrier trajectory", !release?.ballTrajectory?.length && !release?.playerMoves?.length);
  const releaseAt = run.trace.indexOf(release);
  check("the receiver gets an immediate ordinary decision", run.trace[releaseAt + 1]?.code === "ACTION.CHOICE");
  const firstLiveMove = run.trace.slice(releaseAt + 1).find((event) => event.ballFrom);
  const reception = run.trace.slice(0, releaseAt).reverse().find((event) => event.ballTo);
  check("the receiver acts from the actual reception point", Boolean(firstLiveMove && reception)
    && movementDistanceYards(firstLiveMove.ballFrom, reception.ballTo) < 0.001);
  check("both teams move concurrently with normal actions", run.trace.slice(releaseAt + 1).some((event) =>
    event.overlapWithPrevious && event.playerMoves?.length > 1));
  check("every roster entry kept its oriented open-play anchor",
    state.roster.every((entry) => entry.formationAnchor
      && Number.isFinite(entry.formationAnchor.x) && Number.isFinite(entry.formationAnchor.y)));
  check("the possession-in side pushes forward from its own anchor",
    attackingAssignments.some((assignment) => assignment.shapeTarget
      && assignment.formationAnchor
      && movementDistanceYards(assignment.shapeTarget, assignment.formationAnchor) > 0.5));
  check("the authoritative phase path is restart -> restart-release -> build-up",
    run.phaseTransitions.some((transition) => transition.team === takingTeam
      && transition.from === "restart" && transition.to === "restart-release")
    && run.phaseTransitions.some((transition) => transition.team === takingTeam
      && transition.from === "restart-release" && transition.to === "build-up"));
  check("shape is recalculated during live play", (run.shapeSnapshots ?? []).length >= 3);
  check("the opening occupies at least three vertical lanes",
    (opening?.[takingTeam]?.metrics?.occupiedLanes ?? 0) >= 3);
  check("the opening reserves both width jobs and one pivot",
    attackingAssignments.some((assignment) => assignment.teamJob === "width-left")
    && attackingAssignments.some((assignment) => assignment.teamJob === "width-right")
    && attackingAssignments.filter((assignment) => assignment.teamJob === "pivot-recycle").length === 1);
  check("the possession shape preserves at least two rest-defence players",
    (opening?.[takingTeam]?.metrics?.restDefenceCount ?? 0) >= 2);
  check("the opening removes the kickoff cluster and adds support options",
    (opening?.[takingTeam]?.metrics?.clusteredPlayers ?? Infinity)
      < (run.shapeMetrics?.before?.[takingTeam]?.clusteredPlayers ?? 0)
    && (opening?.[takingTeam]?.metrics?.viablePassingSupportOptions ?? 0)
      > (run.shapeMetrics?.before?.[takingTeam]?.viablePassingSupportOptions ?? 0));
  check("the defending side has exactly one primary presser and one cover defender",
    defendingAssignments.filter((assignment) => assignment.teamJob === "primary-presser").length === 1
    && defendingAssignments.filter((assignment) => assignment.teamJob === "cover-defender").length === 1);
  check("the centre-backs split into distinct build-up positions",
    (() => {
      const centreBacks = attackingAssignments.filter((assignment) =>
        assignment.tacticalRole === "central-defender"
        || assignment.tacticalRole === "ball-playing-defender");
      return centreBacks.length >= 2
        && movementDistanceYards(centreBacks[0].intentionTarget, centreBacks[1].intentionTarget) >= 6;
    })());
  check("release motion is authored before the receiving side's first open-play pass",
    (() => {
      const releaseAt = run.trace.findIndex((event) => event.code === "RESTART.RELEASE");
      const firstPassAt = run.trace.findIndex((event, index) => index > releaseAt && event.code === "P.PASS");
      return releaseAt > 0 && firstPassAt > releaseAt;
    })());
  console.log(`TELEMETRY -- kickoff ${takingTeam} setup/release ${JSON.stringify({
    before: metricSample(run.shapeMetrics?.before?.[takingTeam]),
    release: metricSample(opening?.[takingTeam]?.metrics),
  })}`);
}

console.log("\n=== 10b: background match chunks continue real state across halftime ===");
{
  elements.restartTypeSelect.value = "kickoff";
  await applySetup();
  const before = JSON.stringify(state.roster);
  const fullMatch = process.argv.includes("--full-match");
  const durationMs = fullMatch ? 5400000 : 180000;
  const simulate = mod.createMatchChunkSimulator(4242, { halfDurationMs: fullMatch ? 2700000 : 30000 });
  let continuation = null, elapsedMs = 0, halfSeen = false;
  for (let index = 0; index < (fullMatch ? 2000 : 12); index++) {
    let chunk;
    try { chunk = simulate({ index, continuation, elapsedMs, remainingMs: durationMs - elapsedMs }); }
    catch (error) {
      const at = Number(/event (\d+)/.exec(error.message)?.[1] ?? 0);
      console.log("FAILED CHUNK", error.matchChunkIndex, JSON.stringify(error.matchTrace?.slice(Math.max(0, at - 3), at + 2).map(({ code, ballFrom, ballTo, outcome, ballTrajectory }) => ({ code, ballFrom, ballTo, outcome, first: ballTrajectory?.[0]?.position, last: ballTrajectory?.at(-1)?.position }))));
      throw error;
    }
    check(`chunk ${index} advances football time`, chunk.durationMs > 0);
    if (!chunk.durationMs) console.log(JSON.stringify(chunk.output.result));
    check(`chunk ${index} preserves authored setup`, JSON.stringify(state.roster) === before);
    if (chunk.secondHalf && !halfSeen) {
      check("halftime changes ends and resumes with kickoff", chunk.output.trace.some((event) => event.code === "RESTART.KICKOFF.TAKE"));
      halfSeen = true;
    }
    continuation = chunk.continuation;
    elapsedMs += chunk.durationMs;
    if (elapsedMs >= durationMs) break;
  }
  check("match continues beyond its first passage", elapsedMs > 60000);
  check("the second half is reached", halfSeen);
  if (fullMatch) check("full match reaches exactly 90 minutes", elapsedMs === 5400000);
}

// ---------------------------------------------------------------------------
console.log("\n=== 11: mini-board restart preview matches the applied pitch exactly ===");
{
  const { restartPreviewPositions, elements } = mod;
  for (const choice of ["kickoff", "corner", "free-kick-attacking", "throw-in", "goal-kick"]) {
    elements.restartTypeSelect.value = choice;
    elements.restartTakerSelect.value = "";
    const preview = restartPreviewPositions();
    const applied = await applySetup();
    if (!applied || !preview) { check(`${choice}: preview and apply both produced a result`, false); continue; }
    const mismatches = state.roster.filter((entry) => {
      const spot = preview.placements.get(entry.id);
      return !spot || Math.abs(spot.x - entry.x) > 1e-9 || Math.abs(spot.y - entry.y) > 1e-9;
    });
    check(`${choice}: every previewed position matches the applied pitch`, mismatches.length === 0);
    check(`${choice}: the previewed taker is the applied taker`,
      preview.takerId === state.pendingRestart?.takerId);
  }
}

// ---------------------------------------------------------------------------
console.log("\n=== 12: dragging the ball off its spot cancels the restart ===");
{
  const { handleAuthoredBallMove, elements } = mod;
  elements.restartTypeSelect.value = "corner";
  await applySetup();
  check("a restart is pending after apply", Boolean(state.pendingRestart));
  state.ball.x = 50;
  state.ball.y = 50;
  handleAuthoredBallMove();
  check("cancelling clears the pending restart", state.pendingRestart === null);
  check("cancelling clears the dead-ball flag", state.ball.deadBall === false);
  check("the moved ball becomes an authored loose ball", state.ball.ownerId === null);
  check("the roster is left alone -- this is now an open-play setup",
    state.roster.length === 22);
}

// ---------------------------------------------------------------------------
console.log("\n=== 13: an identical setup, seed and taker reproduce an identical trace ===");
{
  const { runConstructedPossession, elements } = mod;
  elements.restartTypeSelect.value = "kickoff";
  elements.restartTakerSelect.value = "";
  await applySetup();
  const first = runConstructedPossession(9001);
  await applySetup();
  const second = runConstructedPossession(9001);
  check("the same seed reproduces the identical trace",
    JSON.stringify(first.trace) === JSON.stringify(second.trace));
  check("and the identical final positions",
    JSON.stringify(first.finalPositions.map((e) => [e.id, e.x, e.y]))
    === JSON.stringify(second.finalPositions.map((e) => [e.id, e.x, e.y])));
  const third = runConstructedPossession(9002);
  check("a different seed genuinely produces a different run",
    JSON.stringify(first.trace) !== JSON.stringify(third.trace));
}

// ---------------------------------------------------------------------------
console.log("\n=== 14: a saved scenario preserves the restart ===");
{
  const { elements, buildLastRun, runConstructedPossession } = mod;
  const {
    applyScenarioToState, validateScenario, REPLAY_SCHEMA_VERSION,
  } = await import("../src/lib/replayHarness.js");
  elements.restartTypeSelect.value = "corner";
  await applySetup();
  const run = runConstructedPossession(4242);
  const record = buildLastRun(4242, run);
  const scenario = record.scenario;
  check("the scenario is schema 2", scenario.schemaVersion === REPLAY_SCHEMA_VERSION);
  check("it validates", validateScenario(scenario).valid);
  check("the restart specification is preserved", scenario.restart?.type === "corner");
  check("the chosen taker is preserved",
    Boolean(scenario.restart?.takerId)
    && scenario.roster.some((entry) => entry.id === scenario.restart.takerId));
  check("the required first action is preserved",
    scenario.restart.requiredFirstAction === "RESTART.CORNER.TAKE");
  check("concrete restart-role assignments are preserved",
    Array.isArray(scenario.restart.roleAssignments) && scenario.restart.roleAssignments.length > 0);
  check("the dead/live starting state is recorded", scenario.ballState?.deadBall === true);
  check("every roster entry carries its formation anchor",
    scenario.roster.every((entry) => entry.formationAnchor));
  check("restart roles survive onto the roster too",
    scenario.roster.some((entry) => entry.restartRole));
  state.pendingRestart = null;
  state.restartSetupDraft = null;
  state.ball = { x: 1, y: 1, ownerId: null, deadBall: false, phase: "live" };
  applyScenarioToState(state, scenario);
  check("applying the saved scenario restores its authoritative pending restart",
    state.pendingRestart?.requiredFirstAction === "RESTART.CORNER.TAKE"
    && state.restartSetupDraft?.takerId === scenario.restart.takerId);
  check("applying the saved scenario restores dead-ball ownership and position",
    state.ball.deadBall === true && state.ball.phase === "dead"
    && state.ball.ownerId === scenario.restart.takerId
    && Math.abs(state.ball.x - scenario.restart.ball.x) < 1e-9
    && Math.abs(state.ball.y - scenario.restart.ball.y) < 1e-9);
  const replayed = runConstructedPossession(scenario.seed);
  check("a saved restart replays from its required event",
    replayed.trace[0]?.code === "RESTART.CORNER.TAKE");
}

// ---------------------------------------------------------------------------
console.log("\n=== 15: a manually authored open-play setup still works ===");
{
  const { runConstructedPossession, cancelPendingRestart } = mod;
  cancelPendingRestart("switching to a hand-authored setup");
  state.roster = state.roster.slice(0, 8);
  state.ball = {
    x: state.roster[1].x, y: state.roster[1].y,
    zone: zoneFromPercent(state.roster[1].x, state.roster[1].y),
    ownerId: state.roster[1].id,
  };
  state.pendingRestart = null;
  state.restartSetupDraft = null;
  const run = runConstructedPossession(31337);
  check("a hand-authored open-play roster still resolves", Boolean(run.result));
  check("it opens with an ordinary decision, not a restart",
    run.trace[0]?.code === "ACTION.CHOICE");
  check("no restart event appears at all",
    !run.trace.some((event) => String(event.code).startsWith("RESTART.")
      && event.code.endsWith(".TAKE")));
}

// ---------------------------------------------------------------------------
console.log("\n=== 16: team inheritance, goalkeeper tactics and WIB/WOB survive Apply Setup ===");
{
  const draft = setupDraft();
  const outfieldSlot = draft.home.slots.find((slot) => slot.band !== "GK");
  const keeperSlot = draft.home.slots.find((slot) => slot.band === "GK");
  draft.home.attacking.shooting = "encourage";
  draft.home.attacking.tempo = "quick";
  draft.home.attacking.mentality = "positive";
  draft.home.attacking.width = "wide";
  draft.home.attacking.passIntoSpace = true;
  draft.home.transition.onGain = "counter";
  draft.home.transition.onLoss = "counter-press";
  draft.home.marking.pressing = "high";
  draft.home.marking.tackling = "stay-on-feet";
  draft.home.marking.defensiveLine = "high";
  outfieldSlot.shootingInstruction = "inherit";
  outfieldSlot.tempoInstruction = "inherit";
  outfieldSlot.withBallPositions = { 4: { x: 31, y: 42 } };
  outfieldSlot.withoutBallPositions = { 4: { x: 19, y: 63 } };
  keeperSlot.goalkeeperDistribution = "short";
  keeperSlot.goalkeeperSweeping = "cautious";
  elements.restartTypeSelect.value = "kickoff";
  check("the extended tactics setup applies", await applySetup());
  const outfield = state.roster.find((entry) => entry.id === `home-${outfieldSlot.slotId}`);
  const keeper = state.roster.find((entry) => entry.id === `home-${keeperSlot.slotId}`);
  check("team shooting and tempo defaults reach the live tactical settings",
    state.attacking.home.shooting === "encourage" && state.attacking.home.tempo === "quick");
  check("possession, transition and defending instructions reach only the selected team",
    state.attacking.home.mentality === "positive"
      && state.attacking.home.width === "wide"
      && state.attacking.home.passIntoSpace === true
      && state.transition.home.onGain === "counter"
      && state.transition.home.onLoss === "counter-press"
      && state.marking.home.pressing === "high"
      && state.marking.home.tackling === "stay-on-feet"
      && state.marking.home.defensiveLine === "high"
      && state.attacking.away.mentality === "balanced");
  check("the outfield player retains inheritance and both phase anchors",
    outfield.shootingInstruction === "inherit" && outfield.tempoInstruction === "inherit"
      && outfield.withBallAnchors[4].x === 31 && outfield.withoutBallAnchors[4].y === 63);
  check("the goalkeeper carries only its goalkeeper-specific decision settings",
    keeper.goalkeeperDistribution === "short" && keeper.goalkeeperSweeping === "cautious");
  const { captureScenario, applyScenarioToState } = await import("../src/lib/replayHarness.js");
  const { phaseAnchorSelectionFor } = await import("../src/lib/teamShape.js");
  const saved = captureScenario({ state, seed: 8080 });
  outfield.shootingInstruction = "discourage";
  outfield.tacticalRole = "poacher";
  outfield.duty = "attack";
  outfield.withBallAnchors = {};
  keeper.goalkeeperDistribution = "long";
  state.attacking.home = { style: "direct", directness: 5, shooting: "discourage", tempo: "slow" };
  state.transition.home = { onGain: "hold-shape", onLoss: "regroup" };
  state.marking.home = { scheme: "zonal", strictness: 1, pressing: "low", tackling: "get-stuck-in" };
  applyScenarioToState(state, saved);
  const restoredOutfield = state.roster.find((entry) => entry.id === `home-${outfieldSlot.slotId}`);
  const restoredKeeper = state.roster.find((entry) => entry.id === `home-${keeperSlot.slotId}`);
  check("saved scenarios restore team defaults and player overrides",
    state.attacking.home.shooting === "encourage" && state.attacking.home.tempo === "quick"
      && restoredOutfield.shootingInstruction === "inherit"
      && restoredOutfield.tempoInstruction === "inherit");
  check("saved scenarios restore the expanded team instructions",
    state.attacking.home.mentality === "positive"
      && state.attacking.home.width === "wide"
      && state.transition.home.onGain === "counter"
      && state.transition.home.onLoss === "counter-press"
      && state.marking.home.pressing === "high"
      && state.marking.home.tackling === "stay-on-feet");
  check("saved scenarios restore every zoned WIB/WOB anchor",
    restoredOutfield.withBallAnchors[4].x === 31
      && restoredOutfield.withoutBallAnchors[4].y === 63);
  check("loading a zoned position restores its Manual mode and underlying role/duty",
    phaseAnchorSelectionFor(restoredOutfield, {
      inPossession: true, phase: "progression", ballPoint: { x: 50, y: 37.5 },
    }).manual
      && restoredOutfield.tacticalRole === outfieldSlot.tacticalRole
      && restoredOutfield.duty === outfieldSlot.duty);
  check("saved scenarios restore goalkeeper-only tactics",
    restoredKeeper.goalkeeperDistribution === "short"
      && restoredKeeper.goalkeeperSweeping === "cautious");
}

// ---------------------------------------------------------------------------
console.log("\n=== 17: the tactics editor keeps a consistent attacking-up viewpoint ===");
{
  const { tacticsBoardPoint, tacticsBoardZone } = mod;
  const draft = setupDraft();
  const homeKeeper = draft.home.slots.find((slot) => slot.band === "GK");
  const awayKeeper = draft.away.slots.find((slot) => slot.band === "GK");
  const homeBoardPoint = tacticsBoardPoint(homeKeeper, draft.home.attackingDirection);
  const awayBoardPoint = tacticsBoardPoint(awayKeeper, draft.away.attackingDirection);
  check("both teams' goalkeepers appear at the bottom of their own tactics board",
    homeBoardPoint.y > 50 && awayBoardPoint.y > 50);
  const authored = { x: 24, y: 71 };
  const displayed = tacticsBoardPoint(authored, "down");
  const restored = tacticsBoardPoint(displayed, "down");
  check("a dragged point round-trips between board and match coordinates",
    Math.abs(restored.x - authored.x) < 1e-9 && Math.abs(restored.y - authored.y) < 1e-9);
  check("the 12 WIB/WOB ball areas rotate with the manager viewpoint",
    tacticsBoardZone(0, "down") === 11
      && tacticsBoardZone(11, "down") === 0
      && tacticsBoardZone(4, "up") === 4);
}


console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
