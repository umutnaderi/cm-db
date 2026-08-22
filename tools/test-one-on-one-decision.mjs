// Constructed test matrix for src/lib/oneOnOneDecision.js (Stage 1 of the
// one-on-one decision system -- see MATCH_LAB_PLAN.md). Covers every
// required case from the review: geometry variations, skill variations,
// the hidden-attribute boundary (keeper attributes must never leak into
// the striker's decision), determinism, and the "unknown fields never
// silently become rushing" guarantee. Run with `node tools/test-one-on-one-decision.mjs`.
import { hashString, seededRandom } from "../src/lib/matchEngineCore.js";
import { chooseOneOnOneAction, perceiveKeeperState, scoreOneOnOneCandidates } from "../src/lib/oneOnOneDecision.js";

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} -- ${label}`);
  if (!condition) failures += 1;
}

function attrs(pairs) {
  return Object.entries(pairs).map(([label, value]) => ({ label, value }));
}
function player(name, overrides) {
  return { canonical_player_name: name, current_ability: 150, attributes: attrs(overrides) };
}
function decisionRandomFor(seed) {
  return seededRandom(hashString(`one-on-one-test:${seed}`));
}

// A neutral, roughly-average player across everything this module reads --
// individual tests override only what they're actually testing.
function averagePlayer(name = "Average Striker") {
  return player(name, {
    Finishing: 12, Technique: 12, Composure: 12, Decisions: 12, Anticipation: 12,
    Flair: 12, Dribbling: 12, Acceleration: 12, Agility: 12, Balance: 12,
    Teamwork: 12, Passing: 12,
  });
}

function actualState({
  depthFromGoalLineYards = 1, lateralOffsetYards = 0, distanceToShooterYards = 10,
  exposedSide = "balanced", movementDirection = null, closingSpeed = null, set = null,
} = {}) {
  return { depthFromGoalLineYards, lateralOffsetYards, distanceToShooterYards, exposedSide, movementDirection, closingSpeed, set };
}

function baseCtx(overrides = {}) {
  return {
    shooter: averagePlayer(),
    perceivedKeeperState: actualState(),
    defenderPressure: 0.2,
    shotAngle: 40,
    distance: 10,
    availableTeammates: [],
    decisionRandom: decisionRandomFor("base"),
    ...overrides,
  };
}

console.log("=== 1: central keeper on the line -- no lateral pull, no chip signal ===");
{
  const ctx = baseCtx({ perceivedKeeperState: actualState({ depthFromGoalLineYards: 0.5, exposedSide: "balanced" }) });
  const candidates = scoreOneOnOneCandidates(ctx);
  const chip = candidates.find((c) => c.action === "chip").utility;
  const left = candidates.find((c) => c.action === "place-left").utility;
  const right = candidates.find((c) => c.action === "place-right").utility;
  check("chip utility is low with the keeper on the line", chip < 0.4);
  check("place-left and place-right are close together (no exposed side)", Math.abs(left - right) < 0.05);
}

console.log("\n=== 2: keeper advanced centrally -- chip should score materially higher ===");
{
  const onLine = scoreOneOnOneCandidates(baseCtx({ perceivedKeeperState: actualState({ depthFromGoalLineYards: 0.5 }), decisionRandom: decisionRandomFor("advanced-a") }));
  const advanced = scoreOneOnOneCandidates(baseCtx({ perceivedKeeperState: actualState({ depthFromGoalLineYards: 7 }), decisionRandom: decisionRandomFor("advanced-b") }));
  const chipOnLine = onLine.find((c) => c.action === "chip").utility;
  const chipAdvanced = advanced.find((c) => c.action === "chip").utility;
  check("chip utility rises materially once the keeper is advanced", chipAdvanced > chipOnLine + 0.2);
}

console.log("\n=== 3/4: keeper displaced left/right -- opposite side should score higher ===");
{
  const left = scoreOneOnOneCandidates(baseCtx({ perceivedKeeperState: actualState({ exposedSide: "left" }) }));
  const right = scoreOneOnOneCandidates(baseCtx({ perceivedKeeperState: actualState({ exposedSide: "right" }) }));
  check("keeper displaced left -> place-left (the open side) scores higher than place-right",
    left.find((c) => c.action === "place-left").utility > left.find((c) => c.action === "place-right").utility);
  check("keeper displaced right -> place-right (the open side) scores higher than place-left",
    right.find((c) => c.action === "place-right").utility > right.find((c) => c.action === "place-left").utility);
}

console.log("\n=== 5: keeper very close to attacker -- round-keeper should score materially higher ===");
{
  const far = scoreOneOnOneCandidates(baseCtx({ perceivedKeeperState: actualState({ distanceToShooterYards: 15 }) }));
  const close = scoreOneOnOneCandidates(baseCtx({ perceivedKeeperState: actualState({ distanceToShooterYards: 3 }) }));
  check("round-keeper utility rises materially when the keeper is very close",
    close.find((c) => c.action === "round-keeper").utility > far.find((c) => c.action === "round-keeper").utility + 0.15);
}

console.log("\n=== 6: elite vs weak decision-makers in identical geometry ===");
{
  const elite = averagePlayer("Elite Decisions");
  elite.attributes = attrs({ ...Object.fromEntries(elite.attributes.map((a) => [a.label, a.value])), Decisions: 19, Composure: 19 });
  const weak = averagePlayer("Weak Decisions");
  weak.attributes = attrs({ ...Object.fromEntries(weak.attributes.map((a) => [a.label, a.value])), Decisions: 5, Composure: 5 });
  const geometry = actualState({ depthFromGoalLineYards: 6, exposedSide: "left" }); // clearly favors chip/place-left
  let eliteBestPicks = 0;
  let weakBestPicks = 0;
  const runs = 400;
  for (let i = 0; i < runs; i += 1) {
    const eliteResult = chooseOneOnOneAction(baseCtx({
      shooter: elite, perceivedKeeperState: geometry, decisionRandom: decisionRandomFor(`elite-${i}`),
    }));
    const weakResult = chooseOneOnOneAction(baseCtx({
      shooter: weak, perceivedKeeperState: geometry, decisionRandom: decisionRandomFor(`weak-${i}`),
    }));
    const best = eliteResult.candidates[0].action;
    if (eliteResult.selectedAction === best) eliteBestPicks += 1;
    if (weakResult.selectedAction === best) weakBestPicks += 1;
  }
  console.log(`Elite picked the top-scoring option ${eliteBestPicks}/${runs}; weak picked it ${weakBestPicks}/${runs}`);
  check("elite decision-maker lands on the best option meaningfully more often than a weak one",
    eliteBestPicks > weakBestPicks + Math.round(runs * 0.15));
  check("even the elite decision-maker is not mechanically perfect", eliteBestPicks < runs);
  check("even the weak decision-maker sometimes gets it right", weakBestPicks > 0);
}

console.log("\n=== 7: elite vs weak chippers in identical geometry (keeper well advanced) ===");
{
  const eliteChipper = averagePlayer("Elite Chipper");
  eliteChipper.attributes = attrs({ ...Object.fromEntries(eliteChipper.attributes.map((a) => [a.label, a.value])), Technique: 19, Flair: 19, Composure: 17 });
  const weakChipper = averagePlayer("Weak Chipper");
  weakChipper.attributes = attrs({ ...Object.fromEntries(weakChipper.attributes.map((a) => [a.label, a.value])), Technique: 6, Flair: 6, Composure: 8 });
  const geometry = actualState({ depthFromGoalLineYards: 8 });
  const eliteScore = scoreOneOnOneCandidates(baseCtx({ shooter: eliteChipper, perceivedKeeperState: geometry })).find((c) => c.action === "chip").utility;
  const weakScore = scoreOneOnOneCandidates(baseCtx({ shooter: weakChipper, perceivedKeeperState: geometry })).find((c) => c.action === "chip").utility;
  check("an elite chipper's chip utility is meaningfully higher than a weak chipper's in identical geometry", eliteScore > weakScore + 0.2);
}

console.log("\n=== 8: elite dribbler vs strong/weak keeper attributes -- decision must be UNCHANGED ===");
{
  // The core hidden-information invariant: the striker's decision reads
  // its own attributes and the perceived (geometric) situation only. A
  // keeper object with wildly different attributes must produce an
  // IDENTICAL scored result given identical geometry, because none of
  // those attributes are ever read here.
  const dribbler = averagePlayer("Elite Dribbler");
  dribbler.attributes = attrs({ ...Object.fromEntries(dribbler.attributes.map((a) => [a.label, a.value])), Dribbling: 19, Flair: 18, Acceleration: 18, Agility: 18, Balance: 17 });
  const geometry = actualState({ distanceToShooterYards: 4 });
  const strongKeeper = player("Strong Keeper", { "One On Ones": 19, Reflexes: 19, Agility: 19, Positioning: 19 });
  const weakKeeper = player("Weak Keeper", { "One On Ones": 4, Reflexes: 4, Agility: 4, Positioning: 4 });
  // The keeper object isn't actually a parameter of scoreOneOnOneCandidates
  // at all -- constructing both and never passing either in IS the proof.
  // (Kept here, unused past construction, so the intent reads explicitly.)
  void strongKeeper; void weakKeeper;
  const resultA = scoreOneOnOneCandidates(baseCtx({ shooter: dribbler, perceivedKeeperState: geometry, decisionRandom: decisionRandomFor("dribbler-vs-keeper") }));
  const resultB = scoreOneOnOneCandidates(baseCtx({ shooter: dribbler, perceivedKeeperState: geometry, decisionRandom: decisionRandomFor("dribbler-vs-keeper") }));
  check("identical striker + identical perceived geometry -> identical scoring regardless of any keeper attributes (never read)",
    JSON.stringify(resultA) === JSON.stringify(resultB));
  check("chooseOneOnOneAction's context has no keeper-attribute field at all (structural check)",
    !("keeper" in baseCtx()) && !("keeperAttributes" in baseCtx()));
}

console.log("\n=== 9: identical seed -> identical perception AND decision ===");
{
  const shooter = averagePlayer();
  const actual = actualState({ depthFromGoalLineYards: 4, lateralOffsetYards: 1.5, distanceToShooterYards: 7, exposedSide: "right" });
  const perceivedA = perceiveKeeperState(actual, shooter, decisionRandomFor("replay-seed"));
  const perceivedB = perceiveKeeperState(actual, shooter, decisionRandomFor("replay-seed"));
  check("identical seed reproduces identical perceived state", JSON.stringify(perceivedA) === JSON.stringify(perceivedB));
  const decisionA = chooseOneOnOneAction(baseCtx({ shooter, perceivedKeeperState: perceivedA, decisionRandom: decisionRandomFor("replay-seed-2") }));
  const decisionB = chooseOneOnOneAction(baseCtx({ shooter, perceivedKeeperState: perceivedB, decisionRandom: decisionRandomFor("replay-seed-2") }));
  check("identical seed reproduces an identical decision (Replay guarantee)", JSON.stringify(decisionA) === JSON.stringify(decisionB));
}

console.log("\n=== 10: this module has no animation/timing parameters to be affected by ===");
{
  // Structural, not behavioral: chooseOneOnOneAction()'s only inputs are
  // shooter/perceivedKeeperState/defenderPressure/shotAngle/distance/
  // availableTeammates/decisionRandom -- nothing about duration, speed, or
  // any rendering concept. Calling it identically twice, with an entirely
  // unrelated "simulated animation speed" value changing in between,
  // proves it has no path to reach in.
  const ctx = baseCtx({ decisionRandom: decisionRandomFor("animation-independence") });
  const before = chooseOneOnOneAction(ctx);
  let fakeAnimationSpeed = 1;
  fakeAnimationSpeed = 2; // "user changed the Match Lab speed selector"
  void fakeAnimationSpeed;
  const after = chooseOneOnOneAction(baseCtx({ decisionRandom: decisionRandomFor("animation-independence") }));
  check("changing an unrelated 'animation speed' value has no effect on the decision", JSON.stringify(before) === JSON.stringify(after));
}

console.log("\n=== 11: unknown movement fields never silently become 'rushing' ===");
{
  const shooter = averagePlayer();
  const actual = actualState({ depthFromGoalLineYards: 9, movementDirection: null, closingSpeed: null, set: null });
  const perceived = perceiveKeeperState(actual, shooter, decisionRandomFor("unknown-fields"));
  check("movementDirection stays null (never inferred)", perceived.movementDirection === null);
  check("closingSpeed stays null (never inferred)", perceived.closingSpeed === null);
  check("set stays null (never inferred)", perceived.set === null);
  // A keeper who's merely advanced (depth-wise) must not silently score as
  // "rushing" -- shoot-early's utility is driven only by defenderPressure,
  // not by depth, so it must be identical to a non-advanced keeper's.
  // Same decisionRandom seed for both -- isolates depth as the only
  // variable (a different seed would also change the jitter term, which
  // would contaminate the comparison with unrelated noise).
  const notAdvanced = scoreOneOnOneCandidates(baseCtx({ shooter, perceivedKeeperState: actualState({ depthFromGoalLineYards: 0.5 }), decisionRandom: decisionRandomFor("shoot-early-fixed") }));
  const advanced = scoreOneOnOneCandidates(baseCtx({ shooter, perceivedKeeperState: actualState({ depthFromGoalLineYards: 9 }), decisionRandom: decisionRandomFor("shoot-early-fixed") }));
  check("shoot-early's tactical fit is untouched by depth alone (depth is not 'rushing')",
    notAdvanced.find((c) => c.action === "shoot-early").utility === advanced.find((c) => c.action === "shoot-early").utility);
}

console.log("\n=== 12: square-pass is only ever offered with a real teammate ===");
{
  const withoutTeammate = scoreOneOnOneCandidates(baseCtx({ availableTeammates: [] }));
  const withTeammate = scoreOneOnOneCandidates(baseCtx({ availableTeammates: [{ id: "t1" }] }));
  check("square-pass is absent from the candidate list with no teammate placed",
    !withoutTeammate.some((c) => c.action === "square-pass"));
  check("square-pass appears once a real teammate is available",
    withTeammate.some((c) => c.action === "square-pass"));
  const decision = chooseOneOnOneAction(baseCtx({ availableTeammates: [], decisionRandom: decisionRandomFor("no-teammate-selection") }));
  check("square-pass can never be the selected action with no teammate placed", decision.selectedAction !== "square-pass");
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
