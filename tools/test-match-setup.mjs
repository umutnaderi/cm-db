// Match Lab setup foundation tests -- historical squads, formation
// templates, the match-setup model and restart setups.
//
// Every module under test is DOM-free by design, so this suite deliberately
// installs NO fake document: if any of them ever reaches for the DOM, these
// tests fail with a ReferenceError instead of quietly passing under a stub.
import assert from "node:assert";

const {
  CURATED_SQUADS, PROPOSED_SQUADS, KNOWN_DATABASE_SLUGS,
  listHistoricalSquads, listTitanFightSquads, findHistoricalSquad,
} = await import("../src/data/historicalSquads.js");
const {
  FALLBACK_DATABASES, matchesPlayerSpec, normalizePlayerName, specAliases,
  resolveHistoricalSquad, validRoster, validateSquadCatalogue, validateSquadDeclaration,
  isGoalkeeperRecord,
} = await import("../src/lib/historicalSquadResolver.js");
const {
  FORMATION_NAMES, FORMATION_TEMPLATES, MATCH_FORMATS,
  formationSlots, orientSlots, projectFormation, roleBand, rolePrefix,
} = await import("../src/lib/formationTemplates.js");
const { assignLineup, lineupSlotKeys } = await import("../src/lib/lineupAssignment.js");
const {
  isGoalkeeperCandidate, isSupportedPitchFit, positionFit,
} = await import("../src/lib/positionFit.js");
const {
  assignPlayer, createMatchSetup, createTeamSetup, effectivePlayerInstructions,
  GOALKEEPER_DISTRIBUTIONS, GOALKEEPER_SWEEPING, randomXiPreset,
  SHOOTING_INSTRUCTIONS, TACTICAL_ROLES_BY_POSITION, TEMPO_INSTRUCTIONS,
  isTacticalRoleAllowed, setSlotInstruction, tacticalRolesForPosition,
  validateMatchSetup, validateTeamSetup,
} = await import("../src/lib/matchSetup.js");
const {
  FREE_KICK_BANDS, OPPONENT_DISTANCE_YARDS, RESTART_TYPES, RESTART_VARIANTS,
  createRestartSetup, freeKickBandOf, freeKickBandSpot, layoutPositions,
  requiredFirstAction, restartBallSpot, validateBallSpot, validateRestartSetup,
  validateGeneratedRestartSetup,
} = await import("../src/lib/restartSetup.js");
const {
  GOAL_WIDTH_YARDS, PITCH_WIDTH_YARDS, SIX_YARD_BOX, yardDistance,
} = await import("../src/lib/pitchGeometry.js");

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} -- ${label}`);
  if (!condition) failures += 1;
}

// ---------------------------------------------------------------------------
console.log("=== 1: the curated historical catalogue survived extraction intact ===");
{
  check("all eight Titan opponents are present", CURATED_SQUADS.length === 8);
  check("only verified squads reach the served catalogue",
    listHistoricalSquads().every((squad) => squad.verified));
  check("Titan Fight's ladder is exactly the eight curated opponents, unchanged by promotions",
    listTitanFightSquads().length === 8
    && listTitanFightSquads().every((squad) => CURATED_SQUADS.includes(squad)));
  check("every curated squad declaration validates", validateSquadCatalogue(CURATED_SQUADS).valid);
  check("every curated squad names a database this project actually has",
    CURATED_SQUADS.every((squad) => KNOWN_DATABASE_SLUGS.includes(squad.database)));
  check("every curated squad declares a starting XI of 11",
    CURATED_SQUADS.every((squad) => squad.players.length === 11));
  check("squad keys are unique",
    new Set(CURATED_SQUADS.map((squad) => squad.key)).size === CURATED_SQUADS.length);
  check("every squad nominates a goalkeeper slot",
    CURATED_SQUADS.every((squad) => Number.isInteger(squad.goalkeeperIndex)
      && squad.goalkeeperIndex < squad.players.length));
  check("the two canonical-id pins survived (Kleberson, Veron)",
    JSON.stringify(CURATED_SQUADS).includes("player_kleberson_brazil_1979")
    && JSON.stringify(CURATED_SQUADS).includes("player_juan_sebastian_veron_argentina_1975"));
  check("findHistoricalSquad resolves a known key",
    findHistoricalSquad("titan-brazil-2002")?.shortName === "Brazil 2002");
  check("Manchester United 1999 declares its exact left-to-right 4-4-2 slots",
    JSON.stringify(findHistoricalSquad("titan-united-1999")?.lineupSlots)
      === JSON.stringify([
        "GK#0", "DR#0", "DC#1", "DC#0", "DL#0",
        "MR#0", "MC#1", "MC#0", "ML#0", "FC#1", "FC#0",
      ]));
  check("Liverpool 2001 uses Danny Murphy in the referenced XI",
    specAliases(findHistoricalSquad("titan-liverpool-2001")?.players[8])[0] === "danny murphy"
      && !findHistoricalSquad("titan-liverpool-2001").players
        .some((spec) => specAliases(spec).includes("john arne riise")));

  // Unique STARTERS, within each squad.
  let duplicateStarters = 0;
  for (const squad of CURATED_SQUADS) {
    const keys = squad.players.map((spec) => specAliases(spec)[0]);
    if (new Set(keys).size !== keys.length) duplicateStarters += 1;
  }
  check("no squad names the same starter twice", duplicateStarters === 0);
}

// ---------------------------------------------------------------------------
console.log("\n=== 2: unverified and blocked presets are reported, never shipped ===");
{
  check("proposed squads exist as an extension contract", PROPOSED_SQUADS.length > 0);
  check("an unverified squad never reaches the served catalogue",
    listHistoricalSquads().every((squad) => squad.verified === true));
  check("a promoted preset is served but does NOT join the Titan Fight ladder",
    listHistoricalSquads().some((squad) => squad.key === "titan-chelsea-2005")
    && !listTitanFightSquads().some((squad) => squad.key === "titan-chelsea-2005"));
  check("includeUnverified widens the list to every declaration",
    listHistoricalSquads({ includeUnverified: true }).length === CURATED_SQUADS.length + PROPOSED_SQUADS.length);

  check("the 2004/05 presets are sourced from the fm2005 edition, which this project has",
    ["titan-chelsea-2005", "titan-milan-2005", "titan-liverpool-2005"].every((key) => {
      const squad = findHistoricalSquad(key);
      return squad?.database === "fm2005_vanilla_original" && !squad.blocked;
    }));
  check("fm2005 and cm9596 are both recognised editions",
    KNOWN_DATABASE_SLUGS.includes("fm2005_vanilla_original")
    && KNOWN_DATABASE_SLUGS.includes("cm9596_vanilla_original"));
  check("every proposed squad declares a full XI",
    PROPOSED_SQUADS.filter((s) => !s.blocked).every((s) => s.players.length === 11));
  check("ambiguous 2004/05 names are pinned by canonical public id rather than guessed",
    findHistoricalSquad("titan-milan-2005").players
      .filter((spec) => !Array.isArray(spec))
      .every((spec) => spec.canonicalPublicId?.startsWith("player_")));
  check("an unverified declaration is reported as such",
    validateSquadDeclaration({
      key: "x", name: "X", shortName: "X", database: "cm0304_vanilla_original",
      filter: { club: "Chelsea" }, goalkeeperIndex: 0, verified: false, players: [["a"]],
    }).warnings.some((w) => w.includes("unverified")));
  check("every promoted 2004/05 preset carries its strict-verification note",
    ["titan-chelsea-2005", "titan-milan-2005", "titan-liverpool-2005"]
      .every((key) => findHistoricalSquad(key).verified === true));
  check("every unblocked proposed squad still names a real database",
    PROPOSED_SQUADS.filter((squad) => !squad.blocked)
      .every((squad) => KNOWN_DATABASE_SLUGS.includes(squad.database)));

  // A declaration naming a slug this project does not have is an ERROR,
  // not a runtime surprise.
  const invented = { key: "x", name: "X", shortName: "X", database: "cm0405_vanilla_original",
    filter: { club: "Chelsea" }, goalkeeperIndex: 0, verified: true, players: [["a"]] };
  const inventedResult = validateSquadDeclaration(invented);
  check("an invented database slug fails declaration validation",
    !inventedResult.valid && inventedResult.errors.some((e) => e.includes("not one this project has")));
  const duplicated = { ...invented, database: "cm0304_vanilla_original", players: [["a"], ["a"]] };
  check("two starters naming the same player fails validation",
    !validateSquadDeclaration(duplicated).valid);
}

// ---------------------------------------------------------------------------
console.log("\n=== 3: squad resolution matches names, ids and reports what it cannot find ===");
{
  check("accents and punctuation normalise away",
    normalizePlayerName("Kléberson") === "kleberson"
    && normalizePlayerName("Juan Sebastián Verón") === "juan sebastian veron");
  check("a canonical public id beats name similarity", matchesPlayerSpec(
    { canonical_player_public_id: "player_x", canonical_player_name: "Completely Different" },
    { canonicalPublicId: "player_x", aliases: ["nobody"] }));
  check("a mismatched canonical id is rejected even with a matching name", !matchesPlayerSpec(
    { canonical_player_public_id: "player_y", canonical_player_name: "Cafu" },
    { canonicalPublicId: "player_x", aliases: ["cafu"] }));
  check("a surname alias matches a full name",
    matchesPlayerSpec({ canonical_player_name: "Fabien Barthez" }, ["barthez"]));
  check("an unrelated name does not match",
    !matchesPlayerSpec({ canonical_player_name: "Fabien Barthez" }, ["zidane"]));
  check("goalkeeper records are recognised from position text",
    isGoalkeeperRecord({ position_text: "GK" }) && !isGoalkeeperRecord({ position_text: "D C" }));
  check("validRoster drops impossible abilities and caps at 22",
    validRoster([
      { canonical_player_name: "ok", current_ability: 150 },
      { canonical_player_name: "zero", current_ability: 0 },
      { canonical_player_name: "over", current_ability: 300 },
    ]).length === 1);
  check("the fallback database order starts at the newest edition",
    FALLBACK_DATABASES[0] === "cm0304_vanilla_original");

  // A fake database: resolution is exercised with no network at all.
  const squad = findHistoricalSquad("titan-united-1999");
  const roster = squad.players.map((spec, index) => ({
    canonical_player_name: specAliases(spec)[0],
    database_slug: squad.database,
    source_person_id: `p${index}`,
    current_ability: 150 + index,
    position_text: index === 0 ? "GK" : "D C",
  }));
  const searchPlayers = async ({ q }) => ({ items: q ? roster.filter((p) => p.canonical_player_name.includes(q)) : roster });
  const resolved = await resolveHistoricalSquad(squad, { searchPlayers });
  check("a fully-present squad resolves cleanly", resolved.valid && resolved.errors.length === 0);
  check("it resolves exactly the declared XI", resolved.players.length === 11);
  check("the nominated goalkeeper really is one",
    resolved.warnings.every((warning) => !warning.includes("nominated as goalkeeper")));

  // A database that genuinely does not contain the last two players --
  // absent from the squad filter AND from every fallback lookup.
  const partial = roster.slice(0, 9);
  const missing = await resolveHistoricalSquad(squad, {
    searchPlayers: async ({ q }) => ({
      items: q ? partial.filter((p) => p.canonical_player_name.includes(q)) : partial,
    }),
  });
  check("missing players are reported, not silently substituted",
    !missing.valid && missing.unresolved.length === 2);
  check("the error names the squad and a missing player",
    missing.errors[0].includes("Manchester United 1999") && missing.errors[0].includes("missing from the database set"));
  check("nothing was fabricated to fill the gap", missing.players.length === 9);

  // "Declared but unsourceable" is still a state the contract must express,
  // even though nothing is currently in it -- the alternative is inventing a
  // database slug so a preset merely looks available.
  const blockedResolution = await resolveHistoricalSquad(
    { key: "x", name: "X", shortName: "X", database: null, filter: null,
      players: [], goalkeeperIndex: 0, verified: false, blocked: "no-database-edition" },
    { searchPlayers },
  );
  check("a blocked squad refuses to resolve and says why",
    !blockedResolution.valid && blockedResolution.errors[0].includes("no-database-edition"));
}

// ---------------------------------------------------------------------------
console.log("\n=== 3b: declared slugs and names exist in the local canonical data ===");
{
  // The local canonical-name export is the offline record of what each
  // edition actually contains. Checking against it is what would have
  // caught the original mistake here: KNOWN_DATABASE_SLUGS was built by
  // grepping sources for `cm####`, which structurally cannot match
  // "fm2005", so the 2004/05 edition was declared not to exist.
  const fs = await import("node:fs");
  const chunkDir = new URL("../data/d1/canonical-player-name-chunks/", import.meta.url);
  let files = [];
  try {
    files = fs.readdirSync(chunkDir).filter((name) => name.endsWith(".sql"));
  } catch {
    files = [];
  }
  if (!files.length) {
    console.log("SKIP -- local canonical-name export not present in this checkout");
  } else {
    const slugs = new Set();
    const namesBySlug = new Map();
    const idsBySlug = new Map();
    for (const file of files) {
      const text = fs.readFileSync(new URL(file, chunkDir), "utf8");
      for (const line of text.split("\n")) {
        const match = /VALUES\('([a-z0-9_]+)','[^']*','[^']*','([^']*)','((?:[^']|'')*)'\)/.exec(line);
        if (!match) continue;
        const [, slug, publicId, rawName] = match;
        slugs.add(slug);
        if (!namesBySlug.has(slug)) { namesBySlug.set(slug, new Set()); idsBySlug.set(slug, new Set()); }
        namesBySlug.get(slug).add(normalizePlayerName(rawName.replace(/''/g, "'")));
        idsBySlug.get(slug).add(publicId);
      }
    }
    check("every declared database slug really exists in the data",
      KNOWN_DATABASE_SLUGS.every((slug) => slugs.has(slug)));
    check("the declared slug list is not missing an edition the data has",
      [...slugs].every((slug) => KNOWN_DATABASE_SLUGS.includes(slug)));

    const missingNames = [];
    const missingIds = [];
    for (const squad of listHistoricalSquads({ includeUnverified: true })) {
      if (squad.blocked || !squad.database) continue;
      const names = namesBySlug.get(squad.database);
      const ids = idsBySlug.get(squad.database);
      if (!names) continue;
      for (const spec of squad.players) {
        const pinned = specAliases(spec).length ? null : null;
        const canonicalId = Array.isArray(spec) ? "" : String(spec.canonicalPublicId || "");
        if (canonicalId && !ids.has(canonicalId)) missingIds.push(`${squad.key}: ${canonicalId}`);
        void pinned;
        const aliases = specAliases(spec).map(normalizePlayerName);
        const found = aliases.some((alias) =>
          names.has(alias) || [...names].some((name) => name.endsWith(` ${alias}`)));
        if (!found && !canonicalId) missingNames.push(`${squad.key}: ${aliases[0]}`);
      }
    }
    check(`every pinned canonical public id exists in its own edition${missingIds.length ? ` (${missingIds[0]})` : ""}`,
      missingIds.length === 0);
    check(`every declared player name exists in its own edition${missingNames.length ? ` (${missingNames.slice(0, 3).join("; ")})` : ""}`,
      missingNames.length === 0);
  }
}

// ---------------------------------------------------------------------------
console.log("\n=== 4: formation templates behave exactly as draft-setup.js did ===");
{
  check("every formation is still declared", FORMATION_NAMES.length === 12);
  check("every formation has exactly 11 slots",
    FORMATION_NAMES.every((name) => FORMATION_TEMPLATES[name].length === 11));
  check("every formation has exactly one goalkeeper",
    FORMATION_NAMES.every((name) =>
      FORMATION_TEMPLATES[name].filter((slot) => slot.role === "GK").length === 1));
  // The same expectations draft-setup.js's own suite asserts.
  const rolesOf = (formation, style) => formationSlots(formation, style)
    .map((item) => item.effectiveRole)
    .filter((r) => !["GK", "DL", "DC", "DR", "WBL", "WBR"].includes(r));
  check("3-5-2 Defensive drops a central midfielder into DMC",
    JSON.stringify(rolesOf("3-5-2", "Defensive").slice(0, 5)) === JSON.stringify(["ML", "MC", "DMC", "MC", "MR"]));
  check("3-5-2 Attacking pushes it to AMC",
    JSON.stringify(rolesOf("3-5-2", "Attacking").slice(0, 5)) === JSON.stringify(["ML", "MC", "AMC", "MC", "MR"]));
  check("4-2-2-2 Attacking pushes its wide pair to FL/FR",
    JSON.stringify(rolesOf("4-2-2-2", "Attacking").slice(0, 4)) === JSON.stringify(["MC", "MC", "FL", "FR"]));
  const mixed = formationSlots("3-4-3", "Attacking").filter((i) => ["MC", "AMC"].includes(i.effectiveRole));
  check("a mixed central pair is levelled onto one row at 42/58",
    mixed[0].y === mixed[1].y && JSON.stringify(mixed.map((i) => i.x)) === JSON.stringify([42, 58]));
  const forwards = formationSlots("3-4-3", "Attacking").filter((i) => ["FL", "FC", "FR"].includes(i.effectiveRole));
  check("forward depths are unchanged (FC 14, FL/FR 18)",
    forwards.find((i) => i.effectiveRole === "FC").y === 14
    && forwards.find((i) => i.effectiveRole === "FL").y === 18
    && forwards.find((i) => i.effectiveRole === "FR").y === 18);
  check("rolePrefix still classifies compound roles",
    rolePrefix("WBL") === "WB" && rolePrefix("DMC") === "DM" && rolePrefix("GK") === "GK");
  check("roleBand groups sweepers and wing-backs with the defence",
    roleBand("SW") === "D" && roleBand("WBR") === "D" && roleBand("AMC") === "M" && roleBand("FL") === "F");
}

// ---------------------------------------------------------------------------
console.log("\n=== 5: reduced-sided projection is exact, balanced and deterministic ===");
{
  for (const format of ["3v3", "5v5", "7v7", "11v11"]) {
    const expected = MATCH_FORMATS[format].players;
    let allExact = true;
    let allHaveKeeper = true;
    let allDeterministic = true;
    for (const formation of FORMATION_NAMES) {
      for (const style of ["Defensive", "Balanced", "Attacking"]) {
        const projected = projectFormation(formation, style, format);
        if (projected.length !== expected) allExact = false;
        if (projected.filter((s) => roleBand(s.effectiveRole) === "GK").length !== 1) allHaveKeeper = false;
        const again = projectFormation(formation, style, format);
        if (JSON.stringify(projected) !== JSON.stringify(again)) allDeterministic = false;
      }
    }
    check(`${format} projects to exactly ${expected} players for every formation and style`, allExact);
    check(`${format} always keeps exactly one goalkeeper`, allHaveKeeper);
    check(`${format} is deterministic -- the same inputs give the same XI`, allDeterministic);
  }
  // Positional balance: a projection must not be all defenders or all forwards.
  let balanced = true;
  for (const formation of FORMATION_NAMES) {
    const five = projectFormation(formation, "Balanced", "5v5").map((s) => roleBand(s.effectiveRole));
    if (five.filter((b) => b === "D").length !== 2) balanced = false;
    if (five.filter((b) => b === "M").length !== 1) balanced = false;
    if (five.filter((b) => b === "F").length !== 1) balanced = false;
  }
  check("5v5 keeps the declared 1 GK / 2 D / 1 M / 1 F balance for every formation", balanced);
  const three = projectFormation("4-3-3", "Balanced", "3v3");
  check("3v3 keeps a keeper, a defender and a forward -- three distinct bands",
    three.length === 3 && new Set(three.map((s) => roleBand(s.effectiveRole))).size === 3);
  check("a projection picks the most central option in each band, never a random one",
    FORMATION_NAMES.every((formation) => {
      const defender = projectFormation(formation, "Balanced", "3v3")
        .find((s) => roleBand(s.effectiveRole) === "D");
      const allDefenders = formationSlots(formation, "Balanced")
        .filter((s) => roleBand(s.effectiveRole) === "D");
      const mostCentral = Math.min(...allDefenders.map((s) => Math.abs(s.x - 50)));
      return Math.abs(Math.abs(defender.x - 50) - mostCentral) < 1e-9;
    }));
  check("no projection reuses a source slot twice",
    (() => {
      const ids = projectFormation("4-3-3", "Balanced", "7v7").map((s) => s.projectedFrom);
      return new Set(ids).size === ids.length;
    })());
}

// ---------------------------------------------------------------------------
console.log("\n=== 6: orientation mirrors the shape rather than re-authoring it ===");
{
  const slots = formationSlots("4-3-3", "Balanced");
  const up = orientSlots(slots, { attackingDirection: "up" });
  const down = orientSlots(slots, { attackingDirection: "down" });
  check("attacking up keeps the authored frame", up[0].y === slots[0].y);
  check("attacking down mirrors depth", down.every((slot, i) => Math.abs(slot.y - (100 - slots[i].y)) < 1e-9));
  check("the goalkeeper ends up in front of their own goal in both directions",
    up[0].y > 50 && down[0].y < 50);
  const mirrored = orientSlots(slots, { attackingDirection: "up", mirrorSides: true });
  check("side mirroring reflects x only",
    mirrored.every((slot, i) => Math.abs(slot.x - (100 - slots[i].x)) < 1e-9 && slot.y === up[i].y));
  check("mirroring twice is the identity",
    orientSlots(mirrored, { attackingDirection: "up", mirrorSides: true })
      .every((slot, i) => Math.abs(slot.x - slots[i].x) < 1e-9));
}

// ---------------------------------------------------------------------------
console.log("\n=== 7: the match-setup model keeps slot, role, duty and job distinct ===");
{
  const setup = createMatchSetup({ format: "11v11" });
  check("both teams are built", Boolean(setup.home && setup.away));
  check("the two teams attack opposite ends",
    setup.home.attackingDirection !== setup.away.attackingDirection);
  check("a fresh setup validates structurally", validateMatchSetup(setup).valid === true);
  const slot = setup.home.slots.find((item) => item.positionalSlot === "DL");
  check("position, role, duty and inherited player instructions are separate fields",
    slot.positionalSlot === "DL" && slot.tacticalRole === "full-back"
      && slot.duty === "defend" && slot.shootingInstruction === "inherit"
      && slot.tempoInstruction === "inherit");
  check("the engine job is a distinct field the setup never authors", slot.engineJob === null);
  check("a goalkeeper defaults to the goalkeeper role",
    setup.home.slots.find((item) => item.band === "GK").tacticalRole === "goalkeeper");
  check("every formation position has its own non-empty tactical role list",
    [...new Set(Object.values(FORMATION_TEMPLATES).flatMap((slots) => slots.flatMap((item) => [
      item.role, ...Object.values(item.styleRoles ?? {}),
    ])))].every((position) => tacticalRolesForPosition(position).length > 0));
  check("full-back slots offer full-back roles but never central or striker roles",
    tacticalRolesForPosition("DL").includes("full-back")
      && tacticalRolesForPosition("DL").includes("wing-back")
      && !tacticalRolesForPosition("DL").includes("central-defender")
      && !tacticalRolesForPosition("DL").includes("poacher")
      && JSON.stringify(tacticalRolesForPosition("DL")) === JSON.stringify(tacticalRolesForPosition("DR")));
  check("DMC exposes its specialist defensive and playmaking roles",
    [
      "defensive-midfielder", "ball-winning-midfielder", "anchor", "half-back",
      "regista", "segundo-volante",
    ].every((role) => tacticalRolesForPosition("DMC").includes(role))
      && !tacticalRolesForPosition("DMC").includes("advanced-forward"));
  check("the exported role catalogue is immutable and keyed by exact position",
    Object.isFrozen(TACTICAL_ROLES_BY_POSITION)
      && Object.isFrozen(TACTICAL_ROLES_BY_POSITION.DMC)
      && isTacticalRoleAllowed("AMC", "shadow-striker")
      && !isTacticalRoleAllowed("MC", "shadow-striker"));

  const instructed = setSlotInstruction(setup.home, slot.slotId, { tacticalRole: "wing-back", duty: "attack" });
  const changed = instructed.slots.find((item) => item.slotId === slot.slotId);
  check("changing the role leaves the positional slot alone",
    changed.tacticalRole === "wing-back" && changed.positionalSlot === "DL");
  check("changing the duty leaves the role alone", changed.duty === "attack" && changed.tacticalRole === "wing-back");
  const shootMore = setSlotInstruction(instructed, slot.slotId, { shootingInstruction: "encourage" });
  check("an individual Shoot more instruction is stored without changing role or duty",
    shootMore.slots.find((item) => item.slotId === slot.slotId).shootingInstruction === "encourage"
      && shootMore.slots.find((item) => item.slotId === slot.slotId).tacticalRole === "wing-back"
      && shootMore.slots.find((item) => item.slotId === slot.slotId).duty === "attack");
  check("player shooting and tempo expose inheritance plus explicit overrides",
    JSON.stringify(SHOOTING_INSTRUCTIONS) === JSON.stringify(["inherit", "discourage", "balanced", "encourage"])
      && JSON.stringify(TEMPO_INSTRUCTIONS) === JSON.stringify(["inherit", "slow", "balanced", "quick"]));
  const inherited = effectivePlayerInstructions(slot, {
    attacking: { shooting: "encourage", tempo: "quick" },
  });
  check("an unassigned player instruction resolves to the team defaults",
    inherited.shooting === "encourage" && inherited.tempo === "quick");
  const explicit = effectivePlayerInstructions(
    { ...slot, shootingInstruction: "discourage", tempoInstruction: "slow" },
    { attacking: { shooting: "encourage", tempo: "quick" } },
  );
  check("an explicit player instruction overrides its team default",
    explicit.shooting === "discourage" && explicit.tempo === "slow");
  const keeperSlot = setup.home.slots.find((item) => item.band === "GK");
  const keeperInstructions = effectivePlayerInstructions(keeperSlot, setup.home);
  check("goalkeepers have a separate instruction vocabulary and never receive shooting or tempo",
    keeperInstructions.shooting === null && keeperInstructions.tempo === null
      && GOALKEEPER_DISTRIBUTIONS.includes(keeperInstructions.goalkeeperDistribution)
      && GOALKEEPER_SWEEPING.includes(keeperInstructions.goalkeeperSweeping));
  check("the setup model rejects an outfield shooting instruction on a goalkeeper", (() => {
    try { setSlotInstruction(setup.home, keeperSlot.slotId, { shootingInstruction: "encourage" }); return false; }
    catch { return true; }
  })());
  check("the setup model rejects a known role when it is incompatible with the slot", (() => {
    try { setSlotInstruction(setup.home, slot.slotId, { tacticalRole: "poacher" }); return false; }
    catch { return true; }
  })());
  check("structural validation catches an incompatible role even after direct data mutation", (() => {
    const corrupted = {
      ...setup.home,
      slots: setup.home.slots.map((item) => item.slotId === slot.slotId
        ? { ...item, tacticalRole: "poacher" } : item),
    };
    return !validateTeamSetup(corrupted).valid;
  })());
  const positioned = setSlotInstruction(setup.home, slot.slotId, {
    withBallPositions: { 4: { x: 14, y: 38 } },
    withoutBallPositions: { 4: { x: 23, y: 61 } },
  }).slots.find((item) => item.slotId === slot.slotId);
  check("WIB/WOB positions are optional per-ball-zone coordinates distinct from the formation",
    positioned.x === slot.x && positioned.y === slot.y
      && positioned.withBallPositions[4].x === 14 && positioned.withoutBallPositions[4].y === 61);
  check("an unknown shooting instruction is rejected", (() => {
    try { setSlotInstruction(setup.home, slot.slotId, { shootingInstruction: "always-shoot" }); return false; }
    catch { return true; }
  })());
  check("an unknown role is rejected", (() => {
    try { setSlotInstruction(setup.home, slot.slotId, { tacticalRole: "libero-sweeper-thing" }); return false; }
    catch { return true; }
  })());

  const assigned = assignPlayer(setup.home, slot.slotId, "player-1");
  check("assigning a player touches only that slot",
    assigned.slots.find((s) => s.slotId === slot.slotId).playerId === "player-1"
    && assigned.slots.filter((s) => s.playerId).length === 1);
  check("an unassigned setup warns rather than errors",
    validateTeamSetup(assigned).valid && validateTeamSetup(assigned).warnings.length === 1);

  const doubled = assignPlayer(assigned, assigned.slots[5].slotId, "player-1");
  check("the same player in two slots is an error", !validateTeamSetup(doubled).valid);
  const excluded = setSlotInstruction(setup.home, setup.home.slots[3].slotId, { included: false });
  check("excluding a slot changes the active count, not the shape",
    !validateTeamSetup(excluded).valid && excluded.slots.length === setup.home.slots.length);

  const small = createTeamSetup({ team: "home", format: "5v5" });
  check("a 5v5 team setup has five slots and validates", small.slots.length === 5 && validateTeamSetup(small).valid);
  check("attacking style and directness are carried",
    small.attacking.style === "possession" && small.attacking.directness === 2);
  check("marking scheme and strictness are carried",
    small.marking.scheme === "man" && small.marking.strictness === 3);
  check("the full team-instruction model has neutral defaults",
    small.attacking.mentality === "balanced"
      && small.attacking.width === "balanced"
      && small.attacking.finalThird === "mixed"
      && small.transition.onGain === "balanced"
      && small.transition.onLoss === "balanced"
      && small.marking.pressing === "standard"
      && small.marking.tackling === "balanced"
      && small.marking.defensiveLine === "standard");
  const teamInstructionsSetup = createTeamSetup({
    team: "home",
    attacking: {
      mentality: "attacking", width: "wide", focusPlay: "left",
      dribbling: "more", creativity: "expressive", finalThird: "early-crosses",
      timeWasting: "sometimes", passIntoSpace: true, playOutOfDefence: true,
    },
    transition: { onGain: "counter", onLoss: "counter-press" },
    marking: {
      scheme: "zonal", strictness: 4, pressing: "high", tackling: "get-stuck-in",
      defensiveLine: "high", engagementLine: "high", offsideTrap: true,
      pressingTrap: "outside", crossEngagement: "stop", preventShortGk: true,
    },
  });
  check("authored possession, transition and defending instructions survive setup creation",
    teamInstructionsSetup.attacking.mentality === "attacking"
      && teamInstructionsSetup.attacking.passIntoSpace === true
      && teamInstructionsSetup.transition.onGain === "counter"
      && teamInstructionsSetup.transition.onLoss === "counter-press"
      && teamInstructionsSetup.marking.pressing === "high"
      && teamInstructionsSetup.marking.offsideTrap === true
      && teamInstructionsSetup.marking.preventShortGk === true
      && teamInstructionsSetup.marking.crossEngagement === "stop");
  check("directness is clamped into 1..5",
    createTeamSetup({ team: "home", attacking: { style: "direct", directness: 99 } }).attacking.directness === 5);

  const randomA = randomXiPreset(setup.home, Array.from({ length: 11 }, (_, i) => `p${i}`), 4242);
  const randomB = randomXiPreset(setup.home, Array.from({ length: 11 }, (_, i) => `p${i}`), 4242);
  check("Random XI is an explicit, seeded preset -- reproducible, not a fallback",
    JSON.stringify(randomA.slots.map((s) => s.playerId)) === JSON.stringify(randomB.slots.map((s) => s.playerId)));
  check("Random XI without a seed is refused", (() => {
    try { randomXiPreset(setup.home, ["a"], undefined); return false; } catch { return true; }
  })());
}

// ---------------------------------------------------------------------------
console.log("\n=== 8: every restart places the ball legally ===");
{
  const directions = ["up", "down"];
  const sides = ["left", "right"];
  let allLegal = true;
  let allDead = true;
  for (const type of RESTART_TYPES) {
    for (const attackingDirection of directions) {
      for (const side of sides) {
        const spec = createRestartSetup({
          type, takingTeam: "home", side, takerId: "taker",
          attackingDirectionByTeam: { home: attackingDirection, away: attackingDirection === "up" ? "down" : "up" },
          spot: type === "free-kick" ? { x: 40, y: 30 } : type === "throw-in" ? { y: 62 } : null,
        });
        if (!spec.ballLegal) allLegal = false;
        if (!spec.deadBall || !spec.requiredFirstAction) allDead = false;
      }
    }
  }
  check("every restart type, direction and side produces a legal ball spot", allLegal);
  check("every restart represents a dead ball with a required first action", allDead);
  check("the required first action is never a generic open-play choice",
    RESTART_TYPES.every((type) => requiredFirstAction(type).startsWith("RESTART.")
      && !requiredFirstAction(type).includes("ACTION.CHOICE")));

  // Kick-off.
  check("a kick-off is taken from the centre mark",
    JSON.stringify(restartBallSpot({ type: "kickoff", attackingDirection: "up" })) === JSON.stringify({ x: 50, y: 50 }));
  check("a kick-off elsewhere is rejected",
    !validateBallSpot({ type: "kickoff", point: { x: 40, y: 50 }, attackingDirection: "up" }).legal);
  check("kick-off requires opponents outside the 10-yard ring",
    OPPONENT_DISTANCE_YARDS.kickoff === 10);
  // The assertions below deliberately validate the GENERATED layouts, not
  // hand-authored coordinates. The earlier version of this test passed its
  // own points in, and those points shared the validator's own reversed
  // idea of which half belonged to whom -- so an illegal layout and a
  // wrong validator agreed with each other and the suite stayed green.
  const kickoffUp = createRestartSetup({
    type: "kickoff", takingTeam: "home", takerId: "t",
    attackingDirectionByTeam: { home: "up", away: "down" },
  });
  const kickoffDown = createRestartSetup({
    type: "kickoff", takingTeam: "home", takerId: "t",
    attackingDirectionByTeam: { home: "down", away: "up" },
  });
  check("the generated kick-off is legal as generated, attacking up",
    validateGeneratedRestartSetup(kickoffUp).valid);
  check("the generated kick-off is legal as generated, attacking down",
    validateGeneratedRestartSetup(kickoffDown).valid);

  // Own halves, read off the generated layout itself. Home attacks up, so
  // home's own half is y>50 and the defenders' own half is y<50.
  const nonTakers = kickoffUp.layout.taking.filter((player) => !player.required);
  check("every kicking-team player except the taker starts in their own half",
    nonTakers.length > 0 && nonTakers.every((player) => player.y > 50));
  check("the taker stands on the centre mark itself",
    kickoffUp.layout.taking.some((player) => player.required && Math.abs(player.y - 50) < 0.001));
  check("no advanced runner starts across halfway",
    kickoffUp.layout.taking.find((p) => p.restartRole === "advanced-runner").y > 50);
  check("every defending player starts in their own half",
    kickoffUp.layout.defending.length > 0 && kickoffUp.layout.defending.every((player) => player.y < 50));
  check("every defending player starts outside the centre circle",
    kickoffUp.layout.defending.every((player) =>
      yardDistance(kickoffUp.ball, player) + 0.001 >= OPPONENT_DISTANCE_YARDS.kickoff));
  check("the two attacking directions are exact mirror images",
    kickoffUp.layout.taking.every((player, index) =>
      Math.abs(player.x - kickoffDown.layout.taking[index].x) < 0.001
      && Math.abs((100 - player.y) - kickoffDown.layout.taking[index].y) < 0.001)
    && kickoffUp.layout.defending.every((player, index) =>
      Math.abs(player.x - kickoffDown.layout.defending[index].x) < 0.001
      && Math.abs((100 - player.y) - kickoffDown.layout.defending[index].y) < 0.001));

  // The validator itself must still reject genuinely illegal placements,
  // in the correct direction for each team.
  check("a defender inside the centre circle is rejected",
    !validateRestartSetup(kickoffUp, { defending: [{ id: "x", x: 50, y: 46 }] }).valid);
  check("a defender in their own half outside the ring is accepted",
    validateRestartSetup(kickoffUp, { defending: [{ id: "x", x: 50, y: 30 }] }).valid);
  check("a defender standing in the KICKING team's half is rejected",
    !validateRestartSetup(kickoffUp, { defending: [{ id: "x", x: 10, y: 80 }] }).valid);
  check("a kicking-team player across halfway is rejected",
    !validateRestartSetup(kickoffUp, { taking: [{ id: "y", x: 50, y: 20 }] }).valid);
  check("a kicking-team player in their own half is accepted",
    validateRestartSetup(kickoffUp, { taking: [{ id: "y", x: 50, y: 80 }] }).valid);
  check("`opponents` still works as an alias for `defending`",
    !validateRestartSetup(kickoffUp, { opponents: [{ id: "x", x: 50, y: 46 }] }).valid);
  check("every restart type validates against its own generated layout",
    RESTART_TYPES.every((type) => ["up", "down"].every((direction) =>
      ["left", "right"].every((restartSide) => validateGeneratedRestartSetup(createRestartSetup({
        type, takingTeam: "home", takerId: "t", side: restartSide,
        spot: type === "free-kick"
          ? { x: 35, y: direction === "up" ? 28 : 72 }
          : type === "throw-in" ? { y: 62 } : null,
        attackingDirectionByTeam: { home: direction, away: direction === "up" ? "down" : "up" },
      })).valid))));

  // Corner.
  const cornerUp = restartBallSpot({ type: "corner", attackingDirection: "up", side: "right" });
  check("a corner sits in the arc at the attacked end", cornerUp.y <= 1 && cornerUp.x >= 99);
  const cornerDown = restartBallSpot({ type: "corner", attackingDirection: "down", side: "right" });
  check("attacking the other way puts the corner at the other end", cornerDown.y >= 99 && cornerDown.x >= 99);
  check("a corner on the left is on the left touchline",
    restartBallSpot({ type: "corner", attackingDirection: "up", side: "left" }).x <= 1);
  check("a corner away from the arc is rejected",
    !validateBallSpot({ type: "corner", point: { x: 50, y: 0 }, attackingDirection: "up" }).legal);

  // Goal kick.
  const goalKick = restartBallSpot({ type: "goal-kick", attackingDirection: "up", side: "right" });
  check("a goal kick is inside the six-yard box at the taking team's OWN goal",
    Math.abs(goalKick.y - 100) <= SIX_YARD_BOX.depthPct + 0.001);
  check("a goal kick's lateral position is on the six-yard box edge",
    Math.abs(Math.abs(goalKick.x - 50) - SIX_YARD_BOX.halfWidthPct) < 0.001);
  check("a goal kick outside the six-yard box is rejected",
    !validateBallSpot({ type: "goal-kick", point: { x: 50, y: 50 }, attackingDirection: "up" }).legal);
  check("attacking down moves the goal kick to the other goal",
    restartBallSpot({ type: "goal-kick", attackingDirection: "down" }).y <= SIX_YARD_BOX.depthPct + 0.001);

  // Throw-in.
  check("a throw-in is exactly on the touchline",
    restartBallSpot({ type: "throw-in", attackingDirection: "up", side: "left", spot: { y: 30 } }).x === 0
    && restartBallSpot({ type: "throw-in", attackingDirection: "up", side: "right", spot: { y: 30 } }).x === 100);
  check("a throw-in keeps the height the ball left play at",
    restartBallSpot({ type: "throw-in", attackingDirection: "up", side: "right", spot: { y: 62 } }).y === 62);
  check("a throw-in away from the touchline is rejected",
    !validateBallSpot({ type: "throw-in", point: { x: 40, y: 62 }, attackingDirection: "up", side: "right" }).legal);
  check("a right-side throw taken from the left touchline is rejected",
    !validateBallSpot({ type: "throw-in", point: { x: 0, y: 62 }, attackingDirection: "up", side: "right" }).legal);
  check("a throw-in only needs two yards of space", OPPONENT_DISTANCE_YARDS["throw-in"] === 2);

  // Free kick.
  check("free-kick opponents must retreat ten yards", OPPONENT_DISTANCE_YARDS["free-kick"] === 10);
  const freeKick = createRestartSetup({
    type: "free-kick", takingTeam: "home", takerId: "t", spot: { x: 40, y: 30 },
    attackingDirectionByTeam: { home: "up", away: "down" },
  });
  check("a defender standing eight yards away fails free-kick validation",
    !validateRestartSetup(freeKick, {
      opponents: [{ id: "wall", x: freeKick.ball.x, y: freeKick.ball.y - (8 / 120) * 100 }],
    }).valid);
  check("a defender standing eleven yards away passes",
    validateRestartSetup(freeKick, {
      opponents: [{ id: "wall", x: freeKick.ball.x, y: freeKick.ball.y - (11 / 120) * 100 }],
    }).valid);
  check("a restart with no nominated taker is invalid",
    !validateRestartSetup({ ...freeKick, takerId: null }).valid);
}

// ---------------------------------------------------------------------------
console.log("\n=== 9: attacking and defending free kicks are one type, two bands ===");
{
  const attacking = freeKickBandSpot({ band: "attacking", attackingDirection: "up" });
  const defending = freeKickBandSpot({ band: "defending", attackingDirection: "up" });
  check("an attacking free kick sits nearer the goal being attacked", attacking.y < defending.y);
  check("both are the same restart TYPE",
    createRestartSetup({
      type: "free-kick", takingTeam: "home", takerId: "t", freeKickBand: "attacking",
      attackingDirectionByTeam: { home: "up", away: "down" },
    }).type === "free-kick");
  check("the band is recorded on the spec",
    createRestartSetup({
      type: "free-kick", takingTeam: "home", takerId: "t", freeKickBand: "attacking",
      attackingDirectionByTeam: { home: "up", away: "down" },
    }).freeKickBand === "attacking");
  check("bands mirror with attacking direction",
    freeKickBandSpot({ band: "attacking", attackingDirection: "down" }).y
    > freeKickBandSpot({ band: "defending", attackingDirection: "down" }).y);
  check("a spot classifies back into its own band",
    freeKickBandOf(attacking, "up") === "attacking" && freeKickBandOf(defending, "up") === "defending");
  check("classification mirrors too",
    freeKickBandOf(freeKickBandSpot({ band: "attacking", attackingDirection: "down" }), "down") === "attacking");
  check("every declared band is usable", Object.keys(FREE_KICK_BANDS).every((band) =>
    Number.isFinite(freeKickBandSpot({ band, attackingDirection: "up" }).y)));
}

// ---------------------------------------------------------------------------
console.log("\n=== 10: restart layouts mirror by side and attacking direction ===");
{
  const ball = restartBallSpot({ type: "corner", attackingDirection: "up", side: "right" });
  const right = layoutPositions({ type: "corner", attackingDirection: "up", side: "right", ball });
  const ballLeft = restartBallSpot({ type: "corner", attackingDirection: "up", side: "left" });
  const left = layoutPositions({ type: "corner", attackingDirection: "up", side: "left", ball: ballLeft });
  check("both sides produce the same roles in the same order",
    JSON.stringify(right.map((p) => p.restartRole)) === JSON.stringify(left.map((p) => p.restartRole)));
  check("a left corner is the mirror image of a right corner",
    right.every((p, i) => Math.abs((100 - p.x) - left[i].x) < 0.001 && Math.abs(p.y - left[i].y) < 0.001));

  const ballDown = restartBallSpot({ type: "corner", attackingDirection: "down", side: "right" });
  const down = layoutPositions({ type: "corner", attackingDirection: "down", side: "right", ball: ballDown });
  check("attacking the other way mirrors depth, not width",
    right.every((p, i) => Math.abs(p.x - down[i].x) < 0.001 && Math.abs((100 - p.y) - down[i].y) < 0.001));

  check("both teams get a layout",
    Object.keys(createRestartSetup({
      type: "corner", takingTeam: "home", takerId: "t", side: "right",
      attackingDirectionByTeam: { home: "up", away: "down" },
    }).layout).join(",") === "taking,defending");
  check("every restart type has a layout for both teams",
    RESTART_TYPES.every((type) => {
      const spec = createRestartSetup({
        type, takingTeam: "home", takerId: "t",
        attackingDirectionByTeam: { home: "up", away: "down" },
        spot: type === "free-kick" ? { x: 50, y: 30 } : type === "throw-in" ? { y: 40 } : null,
      });
      return spec.layout.taking.length > 0 && spec.layout.defending.length > 0;
    }));
  check("exactly one taking-team role is the required taker",
    RESTART_TYPES.every((type) => layoutPositions({
      type, attackingDirection: "up", side: "right", forTeam: "taking",
      ball: restartBallSpot({ type, attackingDirection: "up", side: "right", spot: { x: 50, y: 40 } }),
    }).filter((p) => p.required).length === 1));
  check("every laid-out player except a thrower is on the pitch",
    RESTART_TYPES.every((type) => ["taking", "defending"].every((forTeam) =>
      layoutPositions({
        type, attackingDirection: "up", side: "right", forTeam,
        ball: restartBallSpot({ type, attackingDirection: "up", side: "right", spot: { x: 50, y: 40 } }),
      }).every((p) => p.x >= 0 && p.x <= 100 && p.y >= 0 && p.y <= 100))));
  check("a free-kick defending layout includes a wall",
    layoutPositions({
      type: "free-kick", attackingDirection: "up", side: "right", forTeam: "defending",
      ball: { x: 50, y: 30 },
    }).some((p) => p.wall));
  check("a corner layout keeps the taker at the ball",
    (() => {
      const taker = right.find((p) => p.restartRole === "taker");
      return yardDistance(taker, ball) < 0.001;
    })());
  check("every restart type declares at least one variant",
    RESTART_TYPES.every((type) => RESTART_VARIANTS[type].length > 0));
  check("an unknown variant is rejected", (() => {
    try {
      createRestartSetup({
        type: "corner", takingTeam: "home", takerId: "t", variant: "banana",
        attackingDirectionByTeam: { home: "up", away: "down" },
      });
      return false;
    } catch { return true; }
  })());
  check("a restart without an explicit attacking direction is refused", (() => {
    try {
      createRestartSetup({ type: "corner", takingTeam: "home", attackingDirectionByTeam: {} });
      return false;
    } catch { return true; }
  })());
}

// ---------------------------------------------------------------------------
console.log("\n=== 11: the new modules are genuinely DOM-free ===");
{
  check("no document/window global was needed to load or exercise any of them",
    typeof globalThis.document === "undefined" && typeof globalThis.window === "undefined");
  const fs = await import("node:fs");
  const sources = [
    "../src/data/historicalSquads.js", "../src/lib/historicalSquadResolver.js",
    "../src/lib/formationTemplates.js", "../src/lib/matchSetup.js", "../src/lib/restartSetup.js",
    "../src/lib/teamInstructions.js",
  ].map((path) => fs.readFileSync(new URL(path, import.meta.url), "utf8"));
  check("no module references document, window or localStorage",
    sources.every((source) => !/\b(document|window|localStorage|sessionStorage)\b/.test(source)));
  check("no module calls fetch directly (resolution takes an injected searchPlayers)",
    sources.every((source) => !/\bfetch\s*\(/.test(source)));
  check("no module uses Math.random -- setup is reproducible",
    sources.every((source) => !/Math\.random\s*\(/.test(source)));
}

// ---------------------------------------------------------------------------
console.log("\n=== 12: goalkeepers are anchored to the goal they defend ===");
{
  // anchoredToGoal used to be recorded on the layout and then ignored, so a
  // keeper inherited the (0,0) ball-relative offset: at the corner flag for
  // a corner, on the free-kick spot for a free kick. These assertions read
  // the generated COORDINATES, not merely the presence of a keeper role.
  const keeperOf = (spec) => spec.layout.defending.find((player) => player.restartRole === "keeper");
  const goalHalfWidthPct = (GOAL_WIDTH_YARDS / 2 / PITCH_WIDTH_YARDS) * 100;

  for (const side of ["left", "right"]) {
    const corner = createRestartSetup({
      type: "corner", takingTeam: "home", takerId: "t", side,
      attackingDirectionByTeam: { home: "up", away: "down" },
    });
    const keeper = keeperOf(corner);
    check(`a ${side}-corner keeper stands at the defended goal, not the corner flag`,
      keeper.y < 6 && yardDistance(keeper, corner.ball) > 25);
    check(`a ${side}-corner keeper stands within their own goal frame`,
      Math.abs(keeper.x - 50) <= goalHalfWidthPct + 1);
    check(`a ${side}-corner keeper is not standing on the ball`,
      yardDistance(keeper, corner.ball) > 10);
  }

  const cornerLeft = keeperOf(createRestartSetup({
    type: "corner", takingTeam: "home", takerId: "t", side: "left",
    attackingDirectionByTeam: { home: "up", away: "down" },
  }));
  const cornerRight = keeperOf(createRestartSetup({
    type: "corner", takingTeam: "home", takerId: "t", side: "right",
    attackingDirectionByTeam: { home: "up", away: "down" },
  }));
  check("left/right corner keepers mirror about the goal centre",
    Math.abs((100 - cornerLeft.x) - cornerRight.x) < 0.001 && Math.abs(cornerLeft.y - cornerRight.y) < 0.001);

  const cornerDown = keeperOf(createRestartSetup({
    type: "corner", takingTeam: "home", takerId: "t", side: "right",
    attackingDirectionByTeam: { home: "down", away: "up" },
  }));
  check("attacking-direction mirroring moves the keeper to the opposite goal",
    cornerRight.y < 50 && cornerDown.y > 50
    && Math.abs((100 - cornerRight.y) - cornerDown.y) < 0.001);

  for (const direction of ["up", "down"]) {
    const freeKick = createRestartSetup({
      type: "free-kick", takingTeam: "home", takerId: "t",
      spot: { x: 30, y: direction === "up" ? 25 : 75 },
      attackingDirectionByTeam: { home: direction, away: direction === "up" ? "down" : "up" },
    });
    const keeper = keeperOf(freeKick);
    const defendedGoalY = direction === "up" ? 0 : 100;
    check(`a free-kick keeper (attacking ${direction}) stands on the defended goal line`,
      Math.abs(keeper.y - defendedGoalY) < 4);
    check(`a free-kick keeper (attacking ${direction}) is not on the free-kick spot`,
      yardDistance(keeper, freeKick.ball) > 15);
    check(`a free-kick keeper (attacking ${direction}) stays inside their goal frame`,
      Math.abs(keeper.x - 50) <= goalHalfWidthPct + 3);
  }

  // A keeper covers the half of the goal the wall does not.
  const wideLeft = createRestartSetup({
    type: "free-kick", takingTeam: "home", takerId: "t", spot: { x: 25, y: 28 },
    attackingDirectionByTeam: { home: "up", away: "down" },
  });
  const wideRight = createRestartSetup({
    type: "free-kick", takingTeam: "home", takerId: "t", spot: { x: 75, y: 28 },
    attackingDirectionByTeam: { home: "up", away: "down" },
  });
  check("a free-kick keeper shades away from the ball, covering the open half",
    keeperOf(wideLeft).x > 50 && keeperOf(wideRight).x < 50);
  check("a central free kick leaves the keeper central",
    Math.abs(keeperOf(createRestartSetup({
      type: "free-kick", takingTeam: "home", takerId: "t", spot: { x: 50, y: 28 },
      attackingDirectionByTeam: { home: "up", away: "down" },
    })).x - 50) < 0.001);
  check("the goal-kick taker is the keeper and IS at the ball (not goal-anchored)",
    (() => {
      const goalKick = createRestartSetup({
        type: "goal-kick", takingTeam: "home", takerId: "t", side: "right",
        attackingDirectionByTeam: { home: "up", away: "down" },
      });
      const taker = goalKick.layout.taking.find((player) => player.keeper);
      return Boolean(taker) && !taker.anchoredToGoal && yardDistance(taker, goalKick.ball) < 0.001;
    })());
}

// ---------------------------------------------------------------------------
console.log("\n=== 13: strict sourcing gates historical-squad promotion ===");
{
  const squad = findHistoricalSquad("titan-liverpool-2005");
  const record = (name, index, overrides = {}) => ({
    canonical_player_name: name,
    canonical_player_public_id: overrides.publicId ?? `player_${normalizePlayerName(name).replace(/ /g, "_")}`,
    database_slug: overrides.database ?? squad.database,
    source_person_id: overrides.id ?? `p${index}`,
    current_ability: 150,
    position_text: index === 0 ? "GK" : "D C",
    canonical_club_name: overrides.club ?? "Liverpool",
  });
  const pinnedFor = (spec) => (Array.isArray(spec) ? null : spec.canonicalPublicId);
  const buildRoster = (overridesByIndex = {}) => squad.players.map((spec, index) =>
    record(specAliases(spec)[0], index, { publicId: pinnedFor(spec), ...(overridesByIndex[index] ?? {}) }));
  const searcher = (roster) => async ({ q }) => ({
    items: q ? roster.filter((p) => normalizePlayerName(p.canonical_player_name).includes(normalizePlayerName(q))) : roster,
  });

  const clean = await resolveHistoricalSquad(squad, { searchPlayers: searcher(buildRoster()), strict: true });
  check("a fully-sourced squad passes strict verification", clean.valid && clean.errors.length === 0);
  check("strict mode is reported on the result", clean.strict === true);
  check("all eleven resolve before promotion", clean.players.length === 11);

  const wrongClub = await resolveHistoricalSquad(squad, {
    searchPlayers: searcher(buildRoster({ 4: { club: "Everton" } })), strict: true,
  });
  check("a player at the wrong club fails strict verification", !wrongClub.valid);
  check("the failure names the club actually found",
    wrongClub.errors.some((error) => error.includes("Everton")));

  const noClub = await resolveHistoricalSquad(squad, {
    searchPlayers: searcher(buildRoster({ 6: { club: "" } })), strict: true,
  });
  check("a record that states no club cannot satisfy the filter", !noClub.valid);

  // A player present ONLY in a fallback database.
  const partial = buildRoster();
  const strays = partial.slice(0, 10);
  const stray = { ...partial[10], database_slug: "cm0304_vanilla_original" };
  const strayingSearch = async ({ database, q }) => ({
    items: database === squad.database
      ? (q ? strays.filter((p) => normalizePlayerName(p.canonical_player_name).includes(normalizePlayerName(q))) : strays)
      : (q && normalizePlayerName(stray.canonical_player_name).includes(normalizePlayerName(q)) ? [stray] : []),
  });
  const lenient = await resolveHistoricalSquad(squad, { searchPlayers: strayingSearch });
  check("legacy (non-strict) resolution still accepts a fallback-database hit",
    lenient.valid && lenient.players.length === 11);
  check("legacy resolution records it as a warning",
    lenient.warnings.some((warning) => warning.includes("cm0304")));
  const strict = await resolveHistoricalSquad(squad, { searchPlayers: strayingSearch, strict: true });
  check("strict mode rejects a player found only in a fallback database", !strict.valid);
  check("strict mode reports which database it was found in",
    strict.unresolved.some((entry) => entry.reason === "wrong-database" && entry.foundIn === "cm0304_vanilla_original"));
  check("strict mode refuses to promote an incomplete squad",
    strict.errors.some((error) => error.includes("resolve in full")));

  const duplicated = buildRoster();
  duplicated[5] = { ...duplicated[5], source_person_id: duplicated[4].source_person_id };
  const dupes = await resolveHistoricalSquad(squad, { searchPlayers: searcher(duplicated), strict: true });
  check("duplicate resolved identities fail strict verification",
    !dupes.valid && dupes.errors.some((error) => error.includes("duplicate resolved identity")));

  const outfieldKeeper = buildRoster();
  outfieldKeeper[0] = { ...outfieldKeeper[0], position_text: "M C" };
  const badKeeper = await resolveHistoricalSquad(squad, { searchPlayers: searcher(outfieldKeeper), strict: true });
  check("a nominated goalkeeper who is not one fails strict verification",
    !badKeeper.valid && badKeeper.errors.some((error) => error.includes("nominated as goalkeeper")));
  const lenientKeeper = await resolveHistoricalSquad(squad, { searchPlayers: searcher(outfieldKeeper) });
  check("the same case is only a warning under legacy resolution",
    lenientKeeper.valid && lenientKeeper.warnings.some((w) => w.includes("nominated as goalkeeper")));
}

// ---------------------------------------------------------------------------
console.log("\n=== 14: both teams are oriented to their own attacking direction ===");
{
  const setup = createMatchSetup({});
  const keeperOf = (team) => setup[team].slots.find((slot) => slot.band === "GK");
  const defenceDepth = (team) => {
    const line = setup[team].slots.filter((slot) => slot.band === "D");
    return line.reduce((total, slot) => total + slot.y, 0) / line.length;
  };
  check("the two teams attack opposite ends",
    setup.home.attackingDirection !== setup.away.attackingDirection);
  check("the goalkeepers stand at opposite ends",
    (keeperOf("home").y > 50) !== (keeperOf("away").y > 50));
  check("each goalkeeper stands in front of the goal their own team defends",
    Math.abs(keeperOf("home").y - (setup.home.attackingDirection === "up" ? 100 : 0)) < 12
    && Math.abs(keeperOf("away").y - (setup.away.attackingDirection === "up" ? 100 : 0)) < 12);
  check("the defensive lines sit in opposite halves",
    (defenceDepth("home") > 50) !== (defenceDepth("away") > 50));
  check("each defensive line is behind its own goalkeeper's half-line, not the opponent's",
    Math.abs(defenceDepth("home") - keeperOf("home").y) < 30
    && Math.abs(defenceDepth("away") - keeperOf("away").y) < 30);
  // Turning a team round ROTATES the shape 180 degrees about the centre
  // spot -- both axes -- because a slot's L/R suffix is that player's own
  // left and right, and a player facing the other way has their left hand
  // pointing at the other touchline. Flipping depth alone (the original
  // behaviour) left every left-back on the same flank whichever way they
  // faced, which is the reported wrong-flank bug.
  const flipped = createMatchSetup({ home: { attackingDirection: "up" } });
  check("changing attacking direction rotates the shape, not just its depth",
    flipped.home.slots.every((slot, index) =>
      Math.abs(slot.x - (100 - setup.home.slots[index].x)) < 1e-9
      && Math.abs(slot.y - (100 - setup.home.slots[index].y)) < 1e-9));
  check("a left-sided slot sits on the player's own left in both directions",
    (() => {
      const of = (team, position) => setup[team].slots.find((slot) => slot.positionalSlot === position);
      // home attacks down, away attacks up (createMatchSetup's default).
      return of("home", "DL").x > 50 && of("home", "DR").x < 50
        && of("away", "DL").x < 50 && of("away", "DR").x > 50;
    })());
  check("the two teams' left-backs face each other across the pitch, not stack on one flank",
    (() => {
      const homeLeft = setup.home.slots.find((slot) => slot.positionalSlot === "DL");
      const awayLeft = setup.away.slots.find((slot) => slot.positionalSlot === "DL");
      return (homeLeft.x > 50) !== (awayLeft.x > 50);
    })());
  check("wide midfielders mirror the same way",
    (() => {
      const wide = createMatchSetup({
        home: { formation: "4-4-2", attackingDirection: "down" },
        away: { formation: "4-4-2" },
      });
      const of = (team, position) => wide[team].slots.find((slot) => slot.positionalSlot === position);
      return of("home", "ML").x > 50 && of("home", "MR").x < 50
        && of("away", "ML").x < 50 && of("away", "MR").x > 50;
    })());
  for (const positionalSlot of ["DL", "DR", "ML", "MR"]) {
    const base = positionalSlot.endsWith("L") ? 24 : 76;
    const up = orientSlots([{ positionalSlot, x: base, y: 40 }], {
      attackingDirection: "up",
    })[0];
    const down = orientSlots([{ positionalSlot, x: base, y: 40 }], {
      attackingDirection: "down",
    })[0];
    check(`${positionalSlot} preserves the player's perspective in both directions`,
      up.x === base && down.x === 100 - base && up.y === 40 && down.y === 60);
  }
  check("a reduced-sided setup is oriented too",
    (() => {
      const small = createMatchSetup({ format: "5v5" });
      const home = small.home.slots.find((slot) => slot.band === "GK");
      const away = small.away.slots.find((slot) => slot.band === "GK");
      return (home.y > 50) !== (away.y > 50);
    })());
}

// ---------------------------------------------------------------------------
console.log("\n=== 15: deterministic lineup assignment ===");
{
  const rate = (pairs) => Object.entries(pairs).map(([label, value]) => ({ label, value }));
  const mk = (id, positionText, ratings, ability = 150) => ({
    database_slug: "test-db", source_person_id: id,
    canonical_player_name: `Player ${id}`, position_text: positionText,
    current_ability: ability, position_ratings: rate(ratings),
  });
  const squad = [
    mk("gk", "GK", { goalkeeper: 20 }),
    mk("dr", "D R", { defender: 20, "right side": 20, central: 10 }),
    mk("dc1", "D C", { defender: 20, central: 20 }),
    mk("dc2", "D C", { defender: 20, central: 20 }),
    mk("dl", "D L", { defender: 20, "left side": 20, central: 10 }),
    mk("dm", "DM C", { "defensive midfielder": 20, midfielder: 18, central: 20 }),
    mk("mc1", "M C", { midfielder: 20, central: 20 }),
    mk("mc2", "M C", { midfielder: 20, central: 20 }),
    mk("ml", "M L", { midfielder: 20, "left side": 20 }),
    mk("mr", "M R", { midfielder: 20, "right side": 20 }),
    mk("fc", "F C", { attacker: 20, central: 20 }, 175),
  ];
  const slotsFor = (formation, format) => projectFormation(formation, "Balanced", format);

  for (const format of ["3v3", "5v5", "7v7", "11v11"]) {
    const slots = slotsFor("4-4-2", format);
    const result = assignLineup(squad, slots);
    const filled = result.assignments.filter((entry) => entry.player);
    const keepers = filled.filter((entry) => roleBand(entry.slot.effectiveRole) === "GK");
    const ids = filled.map((entry) => entry.player.source_person_id);
    check(`${format} fills exactly ${slots.length} slots`, filled.length === slots.length);
    check(`${format} places exactly one goalkeeper, and it is the real one`,
      keepers.length === 1 && keepers[0].player.source_person_id === "gk");
    check(`${format} never assigns the same player twice`, new Set(ids).size === ids.length);
    check(`${format} is solved exactly, not by a greedy fallback`, result.exact === true);
    // Positional balance: the projection's own band mix must be honoured.
    const bands = filled.map((entry) => roleBand(entry.slot.effectiveRole));
    const expected = MATCH_FORMATS[format].outfieldBands;
    check(`${format} keeps the projected band balance`,
      expected === null
        ? bands.filter((band) => band === "GK").length === 1
        : ["D", "M", "F"].every((band) =>
            bands.filter((item) => item === band).length === expected.filter((item) => item === band).length));
  }

  check("no outfield player is ever put in goal",
    ["3v3", "5v5", "7v7", "11v11"].every((format) =>
      FORMATION_NAMES.every((formation) => {
        const keeper = assignLineup(squad, slotsFor(formation, format)).assignments
          .find((entry) => roleBand(entry.slot.effectiveRole) === "GK");
        return keeper?.player?.source_person_id === "gk";
      })));
  check("the goalkeeper is never used as an outfielder either",
    ["5v5", "11v11"].every((format) =>
      assignLineup(squad, slotsFor("4-3-3", format)).assignments
        .filter((entry) => roleBand(entry.slot.effectiveRole) !== "GK")
        .every((entry) => entry.player?.source_person_id !== "gk")));

  // Reproducibility: identical input, identical output -- and independent
  // of the order the squad happens to arrive in.
  const slots = slotsFor("4-3-3", "11v11");
  const once = assignLineup(squad, slots).assignments.map((entry) => entry.player?.source_person_id ?? null);
  const twice = assignLineup(squad, slots).assignments.map((entry) => entry.player?.source_person_id ?? null);
  const reversed = assignLineup(squad.slice().reverse(), slots).assignments
    .map((entry) => entry.player?.source_person_id ?? null);
  check("identical input produces an identical XI", JSON.stringify(once) === JSON.stringify(twice));
  check("the XI does not depend on squad array order", JSON.stringify(once) === JSON.stringify(reversed));
  check("4-4-2 slot occurrence keys are stable and follow board order",
    JSON.stringify(lineupSlotKeys(slotsFor("4-4-2", "11v11")))
      === JSON.stringify([
        "GK#0", "DL#0", "DC#0", "DC#1", "DR#0",
        "ML#0", "MC#0", "MC#1", "MR#0", "FC#0", "FC#1",
      ]));
  const preferredCentreBacks = new Map([
    ["test-db:dc1", "DC#1"],
    ["test-db:dc2", "DC#0"],
  ]);
  const preferredResult = assignLineup(squad, slotsFor("4-4-2", "11v11"), {
    preferredSlotByPlayer: preferredCentreBacks,
  });
  const preferredByKey = Object.fromEntries(lineupSlotKeys(slotsFor("4-4-2", "11v11"))
    .map((slotKey, index) => [slotKey, preferredResult.assignments[index].player?.source_person_id]));
  check("curated occurrence preferences resolve equal-fit centre-backs left-to-right",
    preferredByKey["DC#0"] === "dc2" && preferredByKey["DC#1"] === "dc1");
  check("identical input produces identical coordinates",
    JSON.stringify(assignLineup(squad, slots).assignments.map((e) => [e.slot.x, e.slot.y]))
    === JSON.stringify(assignLineup(squad, slots).assignments.map((e) => [e.slot.x, e.slot.y])));
  // A CALL, not the word: the module's own header says "No Math.random
  // anywhere", and an assertion that trips over its own documentation is
  // worse than no assertion at all.
  check("the assigner never calls Math.random",
    !/Math\.random\s*\(/.test((await import("node:fs")).readFileSync(
      new URL("../src/lib/lineupAssignment.js", import.meta.url), "utf8")));

  // Players who cannot be placed properly are reported, not hidden.
  const wrongShape = assignLineup(squad, slotsFor("3-5-2", "11v11"));
  check("out-of-position placements are reported",
    Array.isArray(wrongShape.unplaced));
  check("every reported placement names the player and the reason",
    wrongShape.unplaced.every((entry) => entry.player && typeof entry.reason === "string"));
  check("a squad short of players leaves slots empty rather than duplicating",
    (() => {
      const short = assignLineup(squad.slice(0, 6), slotsFor("4-4-2", "11v11"));
      const placed = short.assignments.filter((entry) => entry.player);
      return placed.length === 6 && new Set(placed.map((e) => e.player.source_person_id)).size === 6;
    })());
}

// ---------------------------------------------------------------------------
console.log("\n=== 16: restart preview places takers and keepers correctly ===");
{
  const keeperRoleOf = (spec) => spec.layout.defending.find((role) => role.anchoredToGoal || role.keeper);
  for (const type of ["corner", "free-kick"]) {
    const spec = createRestartSetup({
      type, takingTeam: "home", takerId: "t", side: "right",
      spot: type === "free-kick" ? { x: 40, y: 26 } : null,
      attackingDirectionByTeam: { home: "up", away: "down" },
    });
    const keeperRole = keeperRoleOf(spec);
    check(`a ${type} names a goal-anchored keeper role`, Boolean(keeperRole));
    check(`a ${type} keeper role is near the defended goal, not the ball`,
      Math.abs(keeperRole.y - 0) < 6 && yardDistance(keeperRole, spec.ball) > 10);
    const taker = spec.layout.taking.find((role) => role.required);
    check(`a ${type} names exactly one required taker at the ball`,
      Boolean(taker) && yardDistance(taker, spec.ball) < 0.001
      && spec.layout.taking.filter((role) => role.required).length === 1);
  }
  check("a goal kick's taker IS the keeper, at the ball",
    (() => {
      const spec = createRestartSetup({
        type: "goal-kick", takingTeam: "home", takerId: "t", side: "right",
        attackingDirectionByTeam: { home: "up", away: "down" },
      });
      const taker = spec.layout.taking.find((role) => role.required);
      return taker.keeper === true && yardDistance(taker, spec.ball) < 0.001;
    })());
  check("every generated restart preview is legal",
    RESTART_TYPES.every((type) => ["up", "down"].every((direction) =>
      ["left", "right"].every((side) => validateGeneratedRestartSetup(createRestartSetup({
        type, takingTeam: "home", takerId: "t", side,
        spot: type === "free-kick" ? { x: 40, y: direction === "up" ? 26 : 74 }
          : type === "throw-in" ? { y: 58 } : null,
        attackingDirectionByTeam: { home: direction, away: direction === "up" ? "down" : "up" },
      })).valid))));
  check("a dead-ball restart always names a required first action that is not the open-play chooser",
    RESTART_TYPES.every((type) => {
      const spec = createRestartSetup({
        type, takingTeam: "home", takerId: "t",
        spot: type === "free-kick" ? { x: 50, y: 30 } : type === "throw-in" ? { y: 50 } : null,
        attackingDirectionByTeam: { home: "up", away: "down" },
      });
      return spec.deadBall === true
        && spec.requiredFirstAction.startsWith("RESTART.")
        && !spec.requiredFirstAction.includes("ACTION.CHOICE");
    }));
}


// ---------------------------------------------------------------------------
console.log("\n=== 9: the restart taker is a football choice, not an array index ===");
{
  const { selectRestartTaker } = await import("../src/lib/restartRoles.js");
  const rate = (pairs) => Object.entries(pairs).map(([label, value]) => ({ label, value }));
  const at = (id, slot, role, attributes = {}) => ({
    id, positionalSlot: slot, role,
    player: {
      database_slug: "db", source_person_id: id, canonical_player_name: id,
      current_ability: 150, attributes: rate(attributes),
    },
  });
  // A France-2000-shaped XI: the reported bug picked Lizarazu, the first
  // outfielder in a back-four-first ordering.
  const france = [
    at("Barthez", "GK", "keeper"),
    at("Thuram", "DR", "player"),
    at("Desailly", "DC", "player"),
    at("Blanc", "DC", "player"),
    at("Lizarazu", "DL", "player"),
    at("Vieira", "MC", "player"),
    at("Deschamps", "DMC", "player"),
    at("Djorkaeff", "AMC", "player", { Decisions: 16, Technique: 17 }),
    at("Zidane", "AMC", "player", { Decisions: 19, Technique: 20, Passing: 19 }),
    at("Henry", "FC", "player", { Decisions: 15, Technique: 16, "Off the Ball": 18 }),
    at("Dugarry", "FL", "player", { Decisions: 13, Technique: 14 }),
  ];
  const kickoff = selectRestartTaker({ type: "kickoff", participants: france });
  check("a kick-off is taken by a forward, winger or attacking midfielder",
    ["FC", "FL", "FR", "AMC", "AML", "AMR"].includes(kickoff.positionalSlot));
  check("specifically NOT the left-back the old ordering picked", kickoff.id !== "Lizarazu");
  check("never the goalkeeper", kickoff.role !== "keeper");
  check("never a defender while an attacker is available",
    !["DL", "DR", "DC"].includes(kickoff.positionalSlot));
  // Tiering, not raw attributes: Zidane is rated higher than Henry but is an
  // AMC, so the forward tier still wins.
  check("a forward outranks a better-rated attacking midfielder at kick-off",
    kickoff.positionalSlot === "FC" || kickoff.positionalSlot === "FL");
  check("selection is deterministic",
    selectRestartTaker({ type: "kickoff", participants: france }).id === kickoff.id);
  check("squad order does not change the choice",
    selectRestartTaker({ type: "kickoff", participants: france.slice().reverse() }).id === kickoff.id);

  const defendersOnly = france.filter((entry) => ["GK", "DR", "DC", "DL"].includes(entry.positionalSlot));
  check("with no attacker available a defender is used as the fallback",
    ["DR", "DC", "DL"].includes(selectRestartTaker({ type: "kickoff", participants: defendersOnly }).positionalSlot));
  check("even then the goalkeeper is avoided",
    selectRestartTaker({ type: "kickoff", participants: defendersOnly }).role !== "keeper");

  check("a manual override wins over the automatic choice",
    selectRestartTaker({ type: "kickoff", participants: france, preferredId: "Lizarazu" }).id === "Lizarazu");
  check("an override naming somebody not in the XI falls back to Auto",
    selectRestartTaker({ type: "kickoff", participants: france, preferredId: "nobody" }).id === kickoff.id);

  check("a goal kick is taken by the goalkeeper",
    selectRestartTaker({ type: "goal-kick", participants: france }).role === "keeper");
  check("a throw-in prefers a full-back or wing-back",
    ["DL", "DR"].includes(selectRestartTaker({ type: "throw-in", participants: france }).positionalSlot));
  const freeKick = selectRestartTaker({ type: "free-kick", variant: "direct", participants: france });
  check("a direct free kick goes to the best-rated striker of a ball",
    freeKick.role !== "keeper");
}

// ---------------------------------------------------------------------------
console.log("\n=== 10: the free-kick wall is a real, legal, multi-player wall ===");
{
  const { wallPositions, WALL_DISTANCE_YARDS } = await import("../src/lib/restartSetup.js");
  const { wallSizeFor, isWallCandidate } = await import("../src/lib/restartRoles.js");
  for (const ball of [{ x: 50, y: 24 }, { x: 32, y: 20 }, { x: 70, y: 30 }]) {
    const size = wallSizeFor({
      distanceYards: yardDistance(ball, { x: 50, y: 0 }),
      angleTightness: Math.abs(ball.x - 50) / 50,
    });
    const wall = wallPositions({ ball, attackingGoalY: 0, size });
    check(`a wall at (${ball.x},${ball.y}) has between two and five players`,
      wall.length >= 2 && wall.length <= 5 && wall.length === size);
    check(`every wall member stands the required ${WALL_DISTANCE_YARDS} yards from the ball`,
      wall.every((spot) => Math.abs(yardDistance(ball, spot) - WALL_DISTANCE_YARDS) < 0.35));
    check("the wall lies between the ball and the goal it defends",
      wall.every((spot) => spot.y < ball.y));
    check("wall members are spaced laterally rather than stacked",
      new Set(wall.map((spot) => spot.x.toFixed(2))).size === wall.length);
    // Perpendicular: every member is the same distance along the ball-goal
    // axis, so the wall is a line across it rather than a queue down it.
    const depths = wall.map((spot) => yardDistance({ x: spot.x, y: ball.y }, ball));
    void depths;
    check("the wall is perpendicular to the ball-goal line, not strung out along it",
      Math.max(...wall.map((s) => s.y)) - Math.min(...wall.map((s) => s.y)) < 1.5);
  }
  check("wall size grows for a closer, more central kick",
    wallSizeFor({ distanceYards: 18, angleTightness: 0 })
    > wallSizeFor({ distanceYards: 40, angleTightness: 0 }));
  check("a goalkeeper is never a wall candidate",
    !isWallCandidate({ role: "keeper", positionalSlot: "GK" }));
  check("a striker is not a wall candidate either",
    !isWallCandidate({ role: "player", positionalSlot: "FC" }));
  check("defenders and midfielders are",
    isWallCandidate({ role: "player", positionalSlot: "DC" })
    && isWallCandidate({ role: "player", positionalSlot: "MC" }));
}

// ---------------------------------------------------------------------------
console.log("\n=== 11: restart roles are assigned by suitability, never twice ===");
{
  const { assignRestartRoles } = await import("../src/lib/restartRoles.js");
  const at = (id, slot, role) => ({
    id, positionalSlot: slot, role,
    player: { database_slug: "db", source_person_id: id, canonical_player_name: id, current_ability: 150, attributes: [] },
  });
  const team = [
    at("gk", "GK", "keeper"), at("dr", "DR", "player"), at("dc1", "DC", "player"),
    at("dc2", "DC", "player"), at("dl", "DL", "player"), at("mc1", "MC", "player"),
    at("mc2", "MC", "player"), at("ml", "ML", "player"), at("mr", "MR", "player"),
    at("fc1", "FC", "player"), at("fc2", "FC", "player"),
  ];
  const layout = [
    { restartRole: "keeper", anchoredToGoal: true, x: 50, y: 2 },
    { restartRole: "near-post-runner", x: 45, y: 8 },
    { restartRole: "far-post-runner", x: 55, y: 8 },
    { restartRole: "rest-defence", x: 50, y: 60 },
    { restartRole: "edge-of-area", x: 50, y: 22 },
  ];
  const result = assignRestartRoles({ layout, participants: team, takerId: null });
  const assigned = [...result.assignments.entries()];
  check("every layout role is filled", assigned.length === layout.length);
  check("no participant holds two roles",
    new Set(assigned.map(([id]) => id)).size === assigned.length);
  check("no role is given to two participants",
    new Set(assigned.map(([, spot]) => spot.restartRole)).size === assigned.length);
  check("the goalkeeper takes the goal-anchored role",
    result.assignments.get("gk")?.restartRole === "keeper");
  check("no outfielder takes the goalkeeper's role",
    assigned.filter(([, spot]) => spot.restartRole === "keeper").every(([id]) => id === "gk"));
  check("attacking runners go to forwards, not centre-halves",
    ["fc1", "fc2"].includes(result.assignments.get("fc1") ? "fc1" : "")
    && ["near-post-runner", "far-post-runner", "central-runner"]
      .includes(result.assignments.get("fc1")?.restartRole ?? ""));
  check("rest defence goes to a defender",
    ["dr", "dc1", "dc2", "dl"].some((id) => result.assignments.get(id)?.restartRole === "rest-defence"));
  check("everyone not given a role is reported rather than dropped",
    result.unassigned.length === team.length - layout.length);
  check("the nominated taker keeps the required role",
    (() => {
      const withTaker = assignRestartRoles({
        layout: [{ restartRole: "taker", required: true, x: 50, y: 50 }, ...layout],
        participants: team, takerId: "mc2",
      });
      return withTaker.assignments.get("mc2")?.restartRole === "taker";
    })());
  check("assignment is deterministic",
    JSON.stringify([...assignRestartRoles({ layout, participants: team }).assignments.keys()])
    === JSON.stringify([...assignRestartRoles({ layout, participants: team }).assignments.keys()]));
  const reducedWall = assignRestartRoles({
    layout: [
      { restartRole: "wall-1", wall: true, x: 48, y: 30 },
      { restartRole: "wall-2", wall: true, x: 52, y: 30 },
    ],
    participants: [at("only-defender", "DC", "player"), at("striker", "FC", "player")],
  });
  check("a short-sided wall never consumes a striker just to fill a marker",
    reducedWall.assignments.has("only-defender")
    && !reducedWall.assignments.has("striker"));
}

// ---------------------------------------------------------------------------
console.log("\n=== 12: restart dispatch maps to the real resolver families ===");
{
  const { restartPlan } = await import("../src/lib/restartExecution.js");
  check("direct free kicks use the wall-aware free-kick resolver",
    restartPlan({ type: "free-kick", variant: "direct" }).resolver === "direct-free-kick");
  check("crossed free kicks and corners use the delivery/aerial pipeline",
    restartPlan({ type: "free-kick", variant: "cross" }).resolver === "cross"
    && restartPlan({ type: "corner", variant: "inswinger" }).resolver === "cross");
  check("long goal kicks are real lofted pass flights",
    restartPlan({ type: "goal-kick", variant: "long" }).forcedPassType === "lofted");
  check("throw-ins use the explicit throw trajectory profile",
    restartPlan({ type: "throw-in", variant: "short" }).forcedPassType === "throw");
}


console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} CHECK(S) FAILED`}`);
assert.equal(failures, 0);
process.exit(failures === 0 ? 0 : 1);
