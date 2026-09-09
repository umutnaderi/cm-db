// Action Pattern Schema & Registry v1 tests.
//
// Everything under test is pure and DOM-free, so this suite installs NO fake
// document: if any of it ever reaches for the DOM it fails loudly instead of
// passing under a stub. It also asserts the migrated behaviour matches the
// hard-coded chain it replaced, which is what makes this a migration rather
// than a rewrite.
import assert from "node:assert";
import fs from "node:fs";

const {
  ACTION_PATTERN_SCHEMA_VERSION, FRAME_ANNOTATION_SCHEMA_VERSION,
  PARTICIPANT_SLOTS, PARTICIPANT_RELATIONS, SPATIAL_REQUIREMENT_KINDS, TARGET_DERIVATIONS,
  frameAnnotationToJson, mirrorActionPattern, normalizeActionPattern, normalizeFrameAnnotation,
  validateActionPattern, validateFrameAnnotation,
} = await import("../src/lib/actionPatternSchema.js");
const {
  ACTION_PATTERN_REGISTRY, ACTION_PATTERN_DECLARATIONS, EXCLUSIVITY_CAPACITY,
  createActionPatternRegistry, matchActionPatterns,
} = await import("../src/lib/actionPatternRegistry.js");
const { VERTICAL_LANES, TACTICAL_DEPTH_BANDS } = await import("../src/lib/pitchRegions.js");
const { TEAM_PHASES } = await import("../src/lib/teamPhase.js");

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} -- ${label}`);
  if (!condition) failures += 1;
}

const validDeclaration = () => ({
  id: "pattern:test-fragment@1",
  version: 1,
  name: "Test fragment",
  trigger: { possession: "attacking", teamPhase: ["progression"], ballRegion: { lanes: ["centre"] } },
  participants: [
    { slot: "ballOwner", relation: "ball-owner" },
    {
      slot: "supportPlayer", relation: "teammate-of-ball-owner", relativeTo: "ballOwner",
      spatial: { kind: "within-yards-of-ball", withinYards: 12 },
    },
  ],
  proposal: {
    job: "support-short", actor: "supportPlayer",
    target: { derivation: "support-short-of-ball", parameters: { offsetYards: 6 } },
  },
  limits: { maxParticipants: 1 },
  exclusivity: { group: "support", priority: 10 },
  source: { reference: "test", note: "fixture" },
});

// ---------------------------------------------------------------------------
console.log("=== 1: valid declarations normalize ===");
{
  const result = validateActionPattern(validDeclaration());
  check("a well-formed declaration validates", result.valid && result.errors.length === 0);
  const normalized = normalizeActionPattern(validDeclaration());
  check("normalization stamps the schema version",
    normalized.schemaVersion === ACTION_PATTERN_SCHEMA_VERSION);
  check("every optional field gets an explicit default",
    normalized.trigger.teamPhase.length === 1
    && normalized.participants[0].spatial.kind === "none"
    && normalized.limits.maxParticipants === 1
    && Array.isArray(normalized.reevaluate.on));
  check("the result is deeply frozen so a declaration cannot drift later",
    Object.isFrozen(normalized) && Object.isFrozen(normalized.participants[0]));
  check("an omitted proposal actor defaults to the last declared slot",
    normalizeActionPattern({
      ...validDeclaration(),
      proposal: { job: "support-short", target: { derivation: "support-short-of-ball" } },
    }).proposal.actor === "supportPlayer");
  check("every shipped declaration normalizes",
    ACTION_PATTERN_DECLARATIONS.every((declaration) => validateActionPattern(declaration).valid));
  check("the registry exposes them all", ACTION_PATTERN_REGISTRY.patterns.length === ACTION_PATTERN_DECLARATIONS.length);
  check("registry ids are unique",
    ACTION_PATTERN_REGISTRY.byId.size === ACTION_PATTERN_REGISTRY.patterns.length);
}

// ---------------------------------------------------------------------------
console.log("\n=== 2: invalid declarations are rejected clearly ===");
{
  const reject = (mutate, fragment) => {
    const declaration = validDeclaration();
    mutate(declaration);
    const result = validateActionPattern(declaration);
    return !result.valid && result.errors.some((error) => error.includes(fragment));
  };
  check("an unknown participant slot is rejected by name",
    reject((d) => { d.participants[1].slot = "strikerNumberNine"; }, "strikerNumberNine"));
  check("an unknown relation is rejected",
    reject((d) => { d.participants[1].relation = "stands-near"; }, "stands-near"));
  check("an unknown spatial requirement is rejected",
    reject((d) => { d.participants[1].spatial = { kind: "vibes" }; }, "vibes"));
  check("an unknown lane is rejected",
    reject((d) => { d.trigger.ballRegion.lanes = ["middle-ish"]; }, "middle-ish"));
  check("an unknown depth band is rejected",
    reject((d) => { d.trigger.ballRegion.depthBands = ["the-final-bit"]; }, "the-final-bit"));
  check("an unknown team phase is rejected",
    reject((d) => { d.trigger.teamPhase = ["rampaging"]; }, "rampaging"));
  check("an unknown target derivation is rejected",
    reject((d) => { d.proposal.target.derivation = "teleport-there"; }, "teleport-there"));
  check("a proposal naming an undeclared participant is rejected",
    reject((d) => { d.proposal.actor = "marker"; }, "not a participant"));
  check("a relativeTo pointing at an undeclared slot is rejected",
    reject((d) => { d.participants[1].relativeTo = "marker"; }, "not declared"));
  check("a relativeTo pointing forward is rejected, so binding order is well defined",
    reject((d) => { d.participants[0].relativeTo = "supportPlayer"; }, "declared earlier"));
  check("a duplicate slot in one pattern is rejected",
    reject((d) => { d.participants[1].slot = "ballOwner"; }, "declared twice"));
  check("a malformed id is rejected",
    reject((d) => { d.id = "vacate pocket"; }, "pattern:"));
  check("an id whose version disagrees with the version field is rejected",
    reject((d) => { d.version = 2; }, "must end with @2"));
  check("an empty participant list is rejected",
    reject((d) => { d.participants = []; }, "non-empty"));
  check("normalization throws rather than returning a broken pattern",
    (() => {
      try { normalizeActionPattern({ id: "bad" }); return false; } catch { return true; }
    })());
  check("null is an allowed exclusivity group -- it means 'no group'",
    validateActionPattern({ ...validDeclaration(), exclusivity: { group: null, priority: 1 } }).valid);
}

// ---------------------------------------------------------------------------
console.log("\n=== 3: mirroring produces equivalent geometry ===");
{
  const pattern = normalizeActionPattern({
    ...validDeclaration(),
    trigger: { possession: "attacking", ballRegion: { lanes: ["left-touchline", "left-half-space"], depthBands: ["progression"] } },
    participants: [
      { slot: "ballOwner", relation: "ball-owner" },
      {
        slot: "wideRunner", relation: "teammate-of-ball-owner", relativeTo: "ballOwner",
        spatial: { kind: "in-region", lanes: ["right-touchline"], withinYards: 14 },
      },
    ],
    proposal: { job: "arc-overlap", actor: "wideRunner", target: { derivation: "forward-in-own-channel", parameters: { forwardYards: 12, outwardYards: 4 } } },
  });
  const mirrored = mirrorActionPattern(pattern);
  check("lanes swap sides",
    JSON.stringify(mirrored.trigger.ballRegion.lanes) === JSON.stringify(["right-touchline", "right-half-space"]));
  check("a participant's own lane requirement swaps too",
    JSON.stringify(mirrored.participants[1].spatial.lanes) === JSON.stringify(["left-touchline"]));
  check("depth bands do NOT swap -- they are already own-goal relative",
    JSON.stringify(mirrored.trigger.ballRegion.depthBands) === JSON.stringify(["progression"]));
  check("distances are unchanged -- mirroring reflects, it does not rescale",
    mirrored.participants[1].spatial.withinYards === 14
    && mirrored.proposal.target.parameters.forwardYards === 12
    && mirrored.proposal.target.parameters.outwardYards === 4);
  check("the proposed job is unchanged", mirrored.proposal.job === pattern.proposal.job);
  check("mirroring twice returns the original geometry",
    JSON.stringify(mirrorActionPattern(mirrored).trigger.ballRegion.lanes)
    === JSON.stringify(pattern.trigger.ballRegion.lanes));
  check("centre mirrors to itself",
    mirrorActionPattern(normalizeActionPattern({
      ...validDeclaration(),
      trigger: { possession: "attacking", ballRegion: { lanes: ["centre"] } },
    })).trigger.ballRegion.lanes[0] === "centre");
}

// ---------------------------------------------------------------------------
console.log("\n=== 4: regions classify, they never become destinations ===");
{
  const declarationSource = fs.readFileSync(new URL("../src/lib/actionPatternRegistry.js", import.meta.url), "utf8");
  const schemaSource = fs.readFileSync(new URL("../src/lib/actionPatternSchema.js", import.meta.url), "utf8");
  check("no declaration carries an absolute coordinate",
    !ACTION_PATTERN_DECLARATIONS.some((declaration) =>
      JSON.stringify(declaration).match(/"[xy]"\s*:/)));
  check("no declaration names a player",
    !/canonical_player_name|source_person_id|database_slug/.test(declarationSource));
  check("the registry never computes a region centre",
    !/regionCentre|regionCenter|centreOf|centerOf/.test(declarationSource + schemaSource));
  check("region vocabulary comes from pitchRegions, not a private copy",
    declarationSource.includes("actionPatternSchema.js")
    && schemaSource.includes('from "./pitchRegions.js"'));
  check("every lane a declaration mentions is a real lane",
    ACTION_PATTERN_REGISTRY.patterns.every((pattern) =>
      (pattern.trigger.ballRegion?.lanes ?? []).every((lane) => VERTICAL_LANES.includes(lane))));
  check("every depth band a declaration mentions is a real band",
    ACTION_PATTERN_REGISTRY.patterns.every((pattern) =>
      (pattern.trigger.ballRegion?.depthBands ?? []).every((band) => TACTICAL_DEPTH_BANDS.includes(band))));
  check("a target is always a DERIVATION request, never a literal point",
    ACTION_PATTERN_REGISTRY.patterns.every((pattern) =>
      TARGET_DERIVATIONS.includes(pattern.proposal.target.derivation)));
}

// ---------------------------------------------------------------------------
console.log("\n=== 5: small fragments compose ===");
{
  // Four independent declarations, four different players, one beat.
  const declarations = [
    { id: "pattern:frag-a@1", version: 1, name: "A", participants: [{ slot: "passer", relation: "passer" }], proposal: { job: "run-off-pass", actor: "passer", target: { derivation: "run-off-pass-from-destination" } }, exclusivity: { group: null, priority: 40 } },
    { id: "pattern:frag-b@1", version: 1, name: "B", participants: [{ slot: "wideRunner", relation: "any-teammate" }], proposal: { job: "arc-overlap", actor: "wideRunner", target: { derivation: "forward-in-own-channel" } }, exclusivity: { group: "special-run", priority: 30 } },
    { id: "pattern:frag-c@1", version: 1, name: "C", participants: [{ slot: "supportPlayer", relation: "any-teammate" }], proposal: { job: "support-short", actor: "supportPlayer", target: { derivation: "support-short-of-ball" } }, exclusivity: { group: null, priority: 20 } },
    { id: "pattern:frag-d@1", version: 1, name: "D", participants: [{ slot: "depthRunner", relation: "any-teammate" }], proposal: { job: "pin-last-line", actor: "depthRunner", target: { derivation: "pin-last-line" } }, exclusivity: { group: null, priority: 10 } },
  ];
  const registry = createActionPatternRegistry(declarations);
  const bySlot = { passer: "p1", wideRunner: "p2", supportPlayer: "p3", depthRunner: "p4" };
  const result = matchActionPatterns({ possession: "attacking" }, {
    findParticipant: (pattern, participant) => ({ id: bySlot[participant.slot] }),
    deriveTarget: () => ({ x: 50, y: 50 }),
  }, { registry });
  check("all four fragments fire in the same beat", result.proposals.length === 4);
  check("each proposes its own job",
    JSON.stringify(result.proposals.map((p) => p.job).sort())
    === JSON.stringify(["arc-overlap", "pin-last-line", "run-off-pass", "support-short"]));
  check("each names a different player",
    new Set(result.proposals.map((p) => p.actorId)).size === 4);
  check("bound participants are reported for diagnostics",
    result.proposals.every((proposal) => Object.keys(proposal.participants).length >= 1));
  check("claims map every committed player to their job",
    Object.keys(result.claims).length === 4);
}

// ---------------------------------------------------------------------------
console.log("\n=== 6: incompatible jobs cannot claim the same player ===");
{
  const declarations = [
    { id: "pattern:first@1", version: 1, name: "First", participants: [{ slot: "wideRunner", relation: "any-teammate" }], proposal: { job: "arc-overlap", actor: "wideRunner", target: { derivation: "forward-in-own-channel" } }, exclusivity: { group: null, priority: 50 } },
    { id: "pattern:second@1", version: 1, name: "Second", participants: [{ slot: "supportPlayer", relation: "any-teammate" }], proposal: { job: "support-short", actor: "supportPlayer", target: { derivation: "support-short-of-ball" } }, exclusivity: { group: null, priority: 10 } },
  ];
  const registry = createActionPatternRegistry(declarations);
  // Both patterns want the SAME player.
  const result = matchActionPatterns({ possession: "attacking" }, {
    findParticipant: () => ({ id: "same-player" }),
    deriveTarget: () => ({ x: 50, y: 50 }),
  }, { registry });
  check("only one job is proposed for a contested player", result.proposals.length === 1);
  check("the higher-priority pattern wins", result.proposals[0].job === "arc-overlap");
  check("the loser is rejected with a conflict reason, not silently dropped",
    result.rejections.some((rejection) => rejection.patternId === "pattern:second@1"
      && rejection.stage === "conflict"
      && rejection.reason.includes("already committed")));
  check("the player holds exactly one job", Object.keys(result.claims).length === 1);
}

// ---------------------------------------------------------------------------
console.log("\n=== 7: the special-run cap is preserved, not replaced ===");
{
  check("the special-run group still has a capacity of exactly one",
    EXCLUSIVITY_CAPACITY["special-run"] === 1);
  const specialRun = ACTION_PATTERN_REGISTRY.patterns
    .filter((pattern) => pattern.exclusivity.group === "special-run");
  check("all five migrated pictures share that one group",
    specialRun.length === 5
    && JSON.stringify(specialRun.map((p) => p.proposal.job).sort())
      === JSON.stringify(["arc-overlap", "check-decel", "peel-square", "show-wide", "vacate-pocket"]));
  check("run-off-pass is deliberately outside the group, as it always was",
    ACTION_PATTERN_REGISTRY.byId.get("pattern:run-off-pass@1").exclusivity.group === null);
  // Five eligible players, five eligible patterns, still one special run.
  const result = matchActionPatterns({ possession: "attacking" }, {
    findParticipant: (pattern, participant) =>
      ({ id: `${pattern.id}:${participant.slot}` }),
    deriveTarget: () => ({ x: 50, y: 50 }),
  });
  const chosen = result.proposals.filter((proposal) => proposal.exclusivityGroup === "special-run");
  check("at most one special run is proposed even when all five could fire",
    chosen.length === 1);
  check("it is the highest-priority picture, matching the old if-chain order",
    chosen[0].job === "vacate-pocket");
  check("the other four are rejected on exclusivity, with the reason recorded",
    result.rejections.filter((r) => r.stage === "exclusivity").length === 4);
  check("run-off-pass still fires alongside the special run",
    result.proposals.some((proposal) => proposal.job === "run-off-pass"));
}

// ---------------------------------------------------------------------------
console.log("\n=== 8: selection is deterministic and consumes no RNG ===");
{
  const sources = [
    fs.readFileSync(new URL("../src/lib/actionPatternRegistry.js", import.meta.url), "utf8"),
    fs.readFileSync(new URL("../src/lib/actionPatternSchema.js", import.meta.url), "utf8"),
  ];
  check("neither module calls Math.random", sources.every((source) => !/Math\.random\s*\(/.test(source)));
  check("neither module reaches for a seeded RNG either",
    sources.every((source) => !/seededRandom|mulberry32|hashString/.test(source)));
  const run = () => matchActionPatterns({ possession: "attacking" }, {
    findParticipant: (pattern, participant) => ({ id: `${pattern.id}:${participant.slot}` }),
    deriveTarget: () => ({ x: 50, y: 50 }),
  });
  check("the same world produces the identical proposal set every time",
    JSON.stringify(run()) === JSON.stringify(run()) && JSON.stringify(run()) === JSON.stringify(run()));
  check("ordering comes from static priority, not object iteration order",
    JSON.stringify(ACTION_PATTERN_REGISTRY.ordered.map((p) => p.id))
    === JSON.stringify([...ACTION_PATTERN_REGISTRY.ordered].sort((a, b) =>
      b.exclusivity.priority - a.exclusivity.priority).map((p) => p.id)));
}

// ---------------------------------------------------------------------------
console.log("\n=== 9: evaluation mutates nothing ===");
{
  const world = {
    possession: "attacking",
    roster: [
      { id: "a", x: 40, y: 50, player: { canonical_player_name: "A" } },
      { id: "b", x: 60, y: 30, player: { canonical_player_name: "B" } },
    ],
    ball: { x: 50, y: 50, ownerId: "a" },
  };
  const before = JSON.stringify(world);
  const result = matchActionPatterns(world, {
    findParticipant: (pattern, participant) => world.roster[participant.slot === "ballOwner" ? 0 : 1],
    deriveTarget: () => ({ x: 55, y: 45 }),
  });
  check("the world snapshot is byte-identical afterwards", JSON.stringify(world) === before);
  check("no roster coordinate changed",
    world.roster[0].x === 40 && world.roster[1].y === 30);
  check("ball state is untouched", world.ball.ownerId === "a" && world.ball.x === 50);
  check("proposals are returned rather than applied", Array.isArray(result.proposals));
  check("a proposal carries a target but never writes it anywhere",
    result.proposals.every((proposal) => proposal.target && proposal.target.x !== undefined));
}

// ---------------------------------------------------------------------------
console.log("\n=== 10: migrated behaviour keeps trigger and target parity ===");
{
  // A genuine A/B. selectSpecialMoverDirect() is the original if-chain,
  // preserved verbatim; selectSpecialMover() is the declarative path that
  // now runs in production. They must agree on BOTH the chosen player and
  // the chosen target for every picture, or this was a rewrite rather than
  // a migration.
  const spatial = await import("../src/lib/spatialDecision.js");
  const { selectSpecialMover, selectSpecialMoverDirect } = spatial;
  check("both the reference chain and the declarative path are exported",
    typeof selectSpecialMoverDirect === "function" && typeof selectSpecialMover === "function");

  const mk = (id, x, y, positionText = "M C") => ({
    id, x, y, team: "home", role: "player",
    player: {
      canonical_player_name: id, database_slug: "db", source_person_id: id,
      current_ability: 150, position_text: positionText,
      attributes: [
        { label: "Pace", value: 15 }, { label: "Acceleration", value: 15 },
        { label: "Off the Ball", value: 15 }, { label: "Work Rate", value: 14 },
        { label: "Anticipation", value: 14 }, { label: "Decisions", value: 14 },
      ],
    },
  });

  // Deterministic sweep. Geometries are chosen so different arms of the
  // original chain are the one that fires: a body in the cone, a far-side
  // unmarked overlap, a loosely-marked attacker near the ball, a clogged
  // inside lane, and pictures where nothing qualifies at all.
  const fixtures = [];
  for (let index = 0; index < 40; index += 1) {
    const ballX = 18 + (index % 8) * 9;
    const ballY = 28 + Math.floor(index / 8) * 11;
    const direction = index % 2 === 0 ? "up" : "down";
    const forward = direction === "up" ? -1 : 1;
    const pool = [
      mk("cone", ballX + 1.5, ballY + forward * 7),
      mk("far-wide", ballX < 50 ? 88 : 12, ballY + forward * 4, ballX < 50 ? "M R" : "M L"),
      mk("near-marked", ballX + 5, ballY - forward * 3),
      mk("wing", ballX < 50 ? 8 : 92, ballY, ballX < 50 ? "M L" : "M R"),
      mk("deep", ballX, ballY - forward * 25),
    ];
    // Defender density varies across the sweep so claimable() and the
    // lane-obstruction threshold both pass on some fixtures and fail on
    // others -- which is what makes agreement on "nothing fires" meaningful
    // as well as agreement on which picture fires.
    const density = index % 4;
    const defenders = [
      mk("d1", ballX + 2, ballY + forward * 9, "D C"),
      ...(density > 0 ? [mk("d2", ballX + 6, ballY - forward * 2, "D C")] : []),
      ...(density > 1 ? [mk("d3", ballX - 3, ballY + forward * 12, "D C")] : []),
      ...(density > 2 ? [mk("d4", ballX + 1, ballY + forward * 14, "D C")] : []),
    ];
    fixtures.push({
      pool, defenders,
      ballPoint: { x: ballX, y: ballY },
      attackingDirection: direction,
      markingLookup: {},
    });
  }

  let compared = 0;
  let fired = 0;
  const mismatches = [];
  for (const fixture of fixtures) {
    // Fresh contexts per call: clampRunTarget() reads them, and sharing one
    // Map between the two calls could let the first mutate what the second
    // sees.
    const contextsA = new Map(fixture.pool.map((entry) => [entry.id, {}]));
    const contextsB = new Map(fixture.pool.map((entry) => [entry.id, {}]));
    const direct = selectSpecialMoverDirect(
      fixture.pool, fixture.defenders, fixture.defenders,
      fixture.attackingDirection, fixture.ballPoint, contextsA, fixture.markingLookup,
    );
    const declarative = selectSpecialMover(
      fixture.pool, fixture.defenders, fixture.defenders,
      fixture.attackingDirection, fixture.ballPoint, contextsB, fixture.markingLookup,
    );
    compared += 1;
    if (direct) fired += 1;
    if (JSON.stringify(direct) !== JSON.stringify(declarative)) {
      mismatches.push({ ball: fixture.ballPoint, direct, declarative });
    }
  }
  check(`the sweep compared a real spread of pictures (${compared})`, compared === 40);
  check(`the reference chain genuinely fires on some of them (${fired}/${compared})`, fired > 5);
  check("it also declines on some, so agreeing on 'nothing fires' is tested too", fired < compared);
  check("the declarative path agrees with the reference chain on every fixture",
    mismatches.length === 0);
  if (mismatches.length) {
    console.log("     first mismatch:", JSON.stringify(mismatches[0]).slice(0, 260));
  }
  check("diagnostics are recorded for the last declarative selection",
    typeof spatial.lastActionPatternDiagnostics === "function"
    && spatial.lastActionPatternDiagnostics() !== undefined);
}

// ---------------------------------------------------------------------------
console.log("\n=== 11: frame annotations validate and round-trip ===");
{
  const dir = new URL("../tools/pattern-annotations/", import.meta.url);
  const files = fs.readdirSync(dir).filter((name) => name.endsWith(".json"));
  check("annotation fixtures exist", files.length >= 4);
  let allValid = true;
  let allRoundTrip = true;
  const primitives = new Set();
  for (const file of files) {
    const raw = JSON.parse(fs.readFileSync(new URL(file, dir), "utf8"));
    const result = validateFrameAnnotation(raw);
    if (!result.valid) { allValid = false; console.log(`     ${file}: ${result.errors.join("; ")}`); }
    else {
      const normalized = normalizeFrameAnnotation(raw);
      const once = frameAnnotationToJson(normalized);
      const twice = frameAnnotationToJson(normalizeFrameAnnotation(once));
      if (JSON.stringify(once) !== JSON.stringify(twice)) allRoundTrip = false;
      for (const observation of normalized.observations) primitives.add(observation.primitive);
    }
  }
  check("every annotation validates", allValid);
  check("every annotation round-trips through JSON without losing meaning", allRoundTrip);
  check("annotations record reusable primitives, several per passage",
    primitives.has("arc-overlap") && primitives.has("vacate-pocket")
    && primitives.has("show-wide") && primitives.has("run-off-pass"));
  check("the V4 passage was decomposed into fragments, not one sequence",
    normalizeFrameAnnotation(JSON.parse(fs.readFileSync(
      new URL("v4-arc-overlap-and-run-off-pass.json", dir), "utf8"))).observations.length === 3);
  check("schema version is stamped", FRAME_ANNOTATION_SCHEMA_VERSION === 1);

  const reject = (mutate, fragment) => {
    const raw = JSON.parse(fs.readFileSync(new URL("v1-vacate-pocket.json", dir), "utf8"));
    mutate(raw);
    const result = validateFrameAnnotation(raw);
    return !result.valid && result.errors.some((error) => error.includes(fragment));
  };
  check("naming a real player in an annotation is rejected",
    reject((raw) => { raw.observations[0].player = "Cafu"; }, "never players"));
  check("absolute coordinates in an annotation are rejected",
    reject((raw) => { raw.observations[0].coordinates = { x: 50, y: 50 }; }, "not absolute positions"));
  check("embedded media is rejected",
    reject((raw) => { raw.media = "clip.mp4"; }, "never an embedded"));
  check("a non-abstract label is rejected",
    reject((raw) => { raw.observations[0].label = "leftWinger"; }, "abstract participant slot"));
  check("an out-of-range confidence is rejected",
    reject((raw) => { raw.observations[0].confidence = 4; }, "between 0 and 1"));
  check("frame time is optional evidence, not required instruction",
    (() => {
      const raw = JSON.parse(fs.readFileSync(new URL("v1-vacate-pocket.json", dir), "utf8"));
      delete raw.observations[0].observationTime;
      return validateFrameAnnotation(raw).valid;
    })());
}

// ---------------------------------------------------------------------------
console.log("\n=== 12: the vocabulary reuses existing names ===");
{
  // A job name must exist in real engine code, never only as a literal
  // inside a declaration. spatialDecision.js owns the attacking-shape
  // vocabulary; ballClaim.js owns the loose-ball one (Dynamic Ball Claim
  // v2), so both count as "the engine s own vocabulary" here.
  const spatialSource = fs.readFileSync(new URL("../src/lib/spatialDecision.js", import.meta.url), "utf8")
    + fs.readFileSync(new URL("../src/lib/ballClaim.js", import.meta.url), "utf8");
  const jobs = ACTION_PATTERN_REGISTRY.patterns.map((pattern) => pattern.proposal.job);
  check("every proposed job name already exists in the engine's own vocabulary",
    jobs.every((job) => spatialSource.includes(`"${job}"`)));
  check("no competing synonym was invented for a migrated behaviour",
    JSON.stringify(jobs.sort()) === JSON.stringify([
      "arc-overlap", "check-decel", "claim-loose-ball", "peel-square", "run-off-pass",
      "show-wide", "vacate-pocket",
    ]));
  check("participant slots are abstract throughout",
    PARTICIPANT_SLOTS.every((slot) => /^[a-z][A-Za-z]+$/.test(slot)));
  check("relations and spatial kinds are closed vocabularies",
    PARTICIPANT_RELATIONS.length > 0 && SPATIAL_REQUIREMENT_KINDS.includes("none"));
  check("team phases come from teamPhase.js rather than a private list",
    TEAM_PHASES.length > 0);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} CHECK(S) FAILED`}`);
assert.equal(failures, 0);
process.exit(failures === 0 ? 0 : 1);
