// Realism Roadmap Stage 1a -- the first-time play decision model.
//
// Deterministic throughout: the module consumes no RNG, so neither does this.
import assert from "node:assert/strict";
import {
  FIRST_TIME_KINDS, MIN_INCOMING_SPEED_YPS,
  deflectionDegrees, lateralDemandYps, footContactDifficulty01,
  headContactDifficulty01, contactHeightDifficulty01, surfaceFor,
  orientationDifficulty01, firstTimeFeasibility01, firstTimeCompetence01,
  firstTimePreference01, firstTimeAccuracyPenalty, evaluateFirstTimeOptions,
  bearingDegrees, buildFirstTimeCandidates, LAYOFF_MAX_OUTGOING_YPS,
  FIRST_TIME_MIN_RANGE_YARDS, FIRST_TIME_MAX_RANGE_YARDS,
} from "../src/lib/firstTimePlay.js";

let passes = 0;
function check(label, condition) {
  assert.equal(condition, true, label);
  passes += 1;
}
const near = (actual, expected, tolerance = 1e-6) => Math.abs(actual - expected) <= tolerance;

// A player built from flat attribute values, so a test asserts about the
// model rather than about the attribute-generation pipeline.
function playerAt(level, overrides = {}) {
  const labels = [
    "Technique", "Passing", "Composure", "Decisions", "Anticipation",
    "First Touch", "Heading", "Jumping", "Finishing",
  ];
  return {
    database_slug: "test",
    current_ability: 100,
    // playerAttributeEntries() expects a flat {label, value} LIST, not a map.
    attributes: labels.map((label) => ({ label, value: overrides[label] ?? level })),
  };
}
const ELITE = playerAt(19);
const POOR = playerAt(5);

// --- deflection geometry ---------------------------------------------------
{
  check("carrying straight on is zero deflection", near(deflectionDegrees(90, 90), 0));
  check("sending it back is 180 degrees", near(deflectionDegrees(90, 270), 180));
  check("across the body is a right angle", near(deflectionDegrees(0, 90), 90));
  check("deflection is unsigned", near(deflectionDegrees(0, -90), 90));
  check("deflection wraps correctly past 360", near(deflectionDegrees(350, 10), 20));
  check("deflection never exceeds 180",
    FIRST_TIME_KINDS.length > 0 && [0, 45, 90, 135, 180, 225, 315].every(
      (angle) => deflectionDegrees(0, angle) <= 180 + 1e-9,
    ));
}

// --- the lateral-demand curve ----------------------------------------------
{
  // The whole point of the model: the demand is zero at BOTH ends and peaks
  // at the right angle. A naive |dv| model would make 180 the most expensive
  // case, which would make a layoff the hardest first-time action in football.
  check("continuing the ball costs no lateral demand", near(lateralDemandYps(0, 14), 0));
  check("returning the ball costs no lateral demand", near(lateralDemandYps(180, 14), 0, 1e-9));
  check("across the body is the maximum demand", near(lateralDemandYps(90, 14), 14));
  check("the demand curve is symmetric about the right angle",
    near(lateralDemandYps(45, 10), lateralDemandYps(135, 10), 1e-9));
  check("demand scales with outgoing speed", lateralDemandYps(90, 20) > lateralDemandYps(90, 10));
}

// --- contact height --------------------------------------------------------
{
  check("a ball at the ankle is an easy foot contact", footContactDifficulty01(0.1) < 0.15);
  check("hip height is the awkward band", footContactDifficulty01(1.0) > 0.9);
  check("hip height is harder than the ground", footContactDifficulty01(1.0) > footContactDifficulty01(0.1));
  check("hip height is harder than a chest-height volley",
    footContactDifficulty01(1.0) > footContactDifficulty01(1.4));
  check("above the shoulder is out of foot range", footContactDifficulty01(2.3) >= 1);

  check("a ball at the knee cannot be headed", headContactDifficulty01(0.8) >= 1);
  check("head height is the natural heading band", headContactDifficulty01(1.95) < 0.15);
  check("a ball well above the head needs a jump and is harder",
    headContactDifficulty01(2.6) > headContactDifficulty01(1.95));

  check("a flick-on always uses the head", surfaceFor("flick-on", 1.5) === "head");
  check("a low ball is struck with the foot", surfaceFor("first-time-pass", 0.2) === "foot");
  check("a high ball is met with the head", surfaceFor("first-time-pass", 2.1) === "head");
  check("the surface selects the matching curve",
    contactHeightDifficulty01(1.95, "head") === headContactDifficulty01(1.95)
    && contactHeightDifficulty01(0.2, "foot") === footContactDifficulty01(0.2));
}

// --- orientation -----------------------------------------------------------
{
  check("releasing where you already face is free", near(orientationDifficulty01(90, 90), 0));
  check("releasing directly behind you is maximal", near(orientationDifficulty01(90, 270), 1));
  check("an unknown facing is neutral, not fabricated", orientationDifficulty01(null, 90) === 0.25);
  check("an unknown facing is the same for every direction",
    orientationDifficulty01(null, 0) === orientationDifficulty01(null, 180));
}

// --- feasibility -----------------------------------------------------------
{
  const base = {
    kind: "first-time-pass", incomingSpeedYps: 12, incomingHeightYards: 0.15,
    deflectionDeg: 0, outgoingSpeedYps: 12, outgoingDirectionDeg: 0,
  };
  check("a clean low continuation is highly feasible", firstTimeFeasibility01(base) > 0.6);
  check("the same ball across the body is harder",
    firstTimeFeasibility01({ ...base, deflectionDeg: 90 }) < firstTimeFeasibility01(base));
  check("the same ball at hip height is harder",
    firstTimeFeasibility01({ ...base, incomingHeightYards: 1.0 }) < firstTimeFeasibility01(base));
  check("a faster ball is harder to meet",
    firstTimeFeasibility01({ ...base, incomingSpeedYps: 28 }) < firstTimeFeasibility01(base));

  check("a stationary ball cannot be played first time",
    firstTimeFeasibility01({ ...base, incomingSpeedYps: MIN_INCOMING_SPEED_YPS - 0.1 }) === 0);
  check("an unknown kind is refused", firstTimeFeasibility01({ ...base, kind: "bicycle-kick" }) === 0);

  // Flick-on gates.
  check("a flick-on needs an aerial ball",
    firstTimeFeasibility01({ ...base, kind: "flick-on", incomingHeightYards: 0.6 }) === 0);
  check("a flick-on cannot turn the ball across the body",
    firstTimeFeasibility01({ ...base, kind: "flick-on", incomingHeightYards: 1.9, deflectionDeg: 90 }) === 0);
  check("a genuine flick-on is feasible",
    firstTimeFeasibility01({ ...base, kind: "flick-on", incomingHeightYards: 1.9, deflectionDeg: 20 }) > 0.5);

  // Layoff gates.
  check("a layoff cannot be driven",
    firstTimeFeasibility01({
      ...base, kind: "layoff", deflectionDeg: 170, outgoingSpeedYps: LAYOFF_MAX_OUTGOING_YPS + 1,
    }) === 0);
  check("a layoff must actually go back, not across",
    firstTimeFeasibility01({ ...base, kind: "layoff", deflectionDeg: 90, outgoingSpeedYps: 8 }) === 0);
  const layoff = firstTimeFeasibility01({ ...base, kind: "layoff", deflectionDeg: 170, outgoingSpeedYps: 8 });
  check("a real layoff is comfortably feasible", layoff > 0.6);
  // The headline claim of the lateral-demand model, stated as a test.
  check("a layoff is easier than the same ball turned across the body",
    layoff > firstTimeFeasibility01({ ...base, deflectionDeg: 90, outgoingSpeedYps: 8 }));

  check("facing the wrong way reduces feasibility",
    firstTimeFeasibility01({ ...base, facingDeg: 180 }) < firstTimeFeasibility01({ ...base, facingDeg: 0 }));
  check("feasibility is bounded to 0..1",
    [0, 45, 90, 135, 180].every((deflectionDeg) => {
      const value = firstTimeFeasibility01({ ...base, deflectionDeg });
      return value >= 0 && value <= 1;
    }));
}

// --- competence ------------------------------------------------------------
{
  for (const kind of FIRST_TIME_KINDS) {
    check(`an elite player beats a poor one at ${kind}`,
      firstTimeCompetence01(ELITE, kind) > firstTimeCompetence01(POOR, kind));
    check(`${kind} competence is bounded`,
      firstTimeCompetence01(ELITE, kind) <= 1 && firstTimeCompetence01(POOR, kind) >= 0);
  }
  check("an unknown kind has no competence", firstTimeCompetence01(ELITE, "bicycle-kick") === 0);

  // Each kind must read the attributes it names, or the weights are decoration.
  const header = playerAt(8, { Heading: 20, Jumping: 20 });
  const passer = playerAt(8, { Passing: 20, Technique: 20 });
  check("a header specialist is better at flick-ons than a passer is",
    firstTimeCompetence01(header, "flick-on") > firstTimeCompetence01(passer, "flick-on"));
  check("a passer is better at first-time passes than a header specialist is",
    firstTimeCompetence01(passer, "first-time-pass") > firstTimeCompetence01(header, "first-time-pass"));
  check("First Touch is read by the layoff and by nothing else",
    firstTimeCompetence01(playerAt(8, { "First Touch": 20 }), "layoff")
      > firstTimeCompetence01(playerAt(8), "layoff")
    && firstTimeCompetence01(playerAt(8, { "First Touch": 20 }), "first-time-pass")
      === firstTimeCompetence01(playerAt(8), "first-time-pass"));
}

// --- preference ------------------------------------------------------------
{
  const quick = { style: "possession", tempo: "quick", creativity: "balanced" };
  const slow = { style: "possession", tempo: "slow", creativity: "balanced" };
  check("a quick tempo wants the ball moved on faster",
    firstTimePreference01({ attackingSettings: quick }) > firstTimePreference01({ attackingSettings: slow }));

  // The load-bearing separation: pressure changes appetite, never ability.
  check("pressure raises the appetite to release early",
    firstTimePreference01({ pressure01: 0.9 }) > firstTimePreference01({ pressure01: 0 }));
  const pressured = { kind: "first-time-pass", incomingSpeedYps: 12, incomingHeightYards: 0.2, deflectionDeg: 30, outgoingSpeedYps: 12 };
  check("pressure does not appear in feasibility at all",
    firstTimeFeasibility01(pressured) === firstTimeFeasibility01({ ...pressured, pressure01: 0.9 }));

  check("a direct side wants flick-ons most",
    firstTimePreference01({ kind: "flick-on", attackingSettings: { style: "long-ball" } })
      > firstTimePreference01({ kind: "flick-on", attackingSettings: { style: "possession" } }));
  check("shoot-more raises first-time shooting",
    firstTimePreference01({ kind: "first-time-shot", shootingInstruction: "encourage" })
      > firstTimePreference01({ kind: "first-time-shot", shootingInstruction: "discourage" }));
  check("the shooting instruction does not leak into passing",
    firstTimePreference01({ kind: "first-time-pass", shootingInstruction: "encourage" })
      === firstTimePreference01({ kind: "first-time-pass", shootingInstruction: "discourage" }));
  check("preference is bounded",
    firstTimePreference01({ pressure01: 1, attackingSettings: { style: "long-ball", tempo: "quick", creativity: "expressive" }, kind: "flick-on", targetIsAdvanced: true }) <= 1);
}

// --- accuracy penalty ------------------------------------------------------
{
  const best = firstTimeAccuracyPenalty({ feasibility01: 1, competence01: 1 });
  const worst = firstTimeAccuracyPenalty({ feasibility01: 0, competence01: 0 });
  check("even a perfect first-time ball is less accurate than a settled one", best > 1);
  check("the best case stays close to a settled pass", best < 1.3);
  check("a difficult contact by a poor player is much worse", worst > 2.5);
  check("the penalty falls as feasibility rises",
    firstTimeAccuracyPenalty({ feasibility01: 0.9, competence01: 0.5 })
      < firstTimeAccuracyPenalty({ feasibility01: 0.3, competence01: 0.5 }));
  check("the penalty falls as competence rises",
    firstTimeAccuracyPenalty({ feasibility01: 0.5, competence01: 0.9 })
      < firstTimeAccuracyPenalty({ feasibility01: 0.5, competence01: 0.3 }));
}

// --- evaluateFirstTimeOptions ----------------------------------------------
{
  const incoming = { speedYps: 13, heightYards: 0.2, directionDeg: 0 };
  const evaluation = evaluateFirstTimeOptions({
    player: ELITE,
    incoming,
    pressure01: 0.5,
    attackingSettings: { style: "possession", tempo: "quick", creativity: "balanced" },
    candidates: [
      { kind: "first-time-pass", targetId: "ahead", outgoingDirectionDeg: 10, outgoingSpeedYps: 13 },
      { kind: "layoff", targetId: "behind", outgoingDirectionDeg: 175, outgoingSpeedYps: 8 },
      { kind: "first-time-pass", targetId: "square", outgoingDirectionDeg: 90, outgoingSpeedYps: 15 },
    ],
  });
  check("options are offered", evaluation.available === true);
  check("every offered option is scored", evaluation.options.every(
    (option) => option.score >= 0 && option.feasibility01 > 0 && option.accuracyPenalty > 1,
  ));
  check("options come back sorted best-first", evaluation.options.every(
    (option, index) => index === 0 || evaluation.options[index - 1].score >= option.score,
  ));
  check("the best option is the head of the list", evaluation.best === evaluation.options[0]);
  check("the square ball across the body is not preferred to the one ahead",
    evaluation.options.findIndex((option) => option.targetId === "ahead")
      < evaluation.options.findIndex((option) => option.targetId === "square"));
  check("each option reports the surface it would use",
    evaluation.options.every((option) => option.surface === "foot"));
  check("each option carries its own deflection",
    evaluation.options.find((option) => option.targetId === "behind").deflectionDeg > 170);

  // Determinism: the module must return an identical result for identical
  // input, or Stage 1b cannot use it without re-keying replay.
  const repeat = evaluateFirstTimeOptions({
    player: ELITE, incoming, pressure01: 0.5,
    attackingSettings: { style: "possession", tempo: "quick", creativity: "balanced" },
    candidates: [
      { kind: "first-time-pass", targetId: "ahead", outgoingDirectionDeg: 10, outgoingSpeedYps: 13 },
      { kind: "layoff", targetId: "behind", outgoingDirectionDeg: 175, outgoingSpeedYps: 8 },
      { kind: "first-time-pass", targetId: "square", outgoingDirectionDeg: 90, outgoingSpeedYps: 15 },
    ],
  });
  check("the evaluation is deterministic",
    JSON.stringify(repeat) === JSON.stringify(evaluation));

  const poorEvaluation = evaluateFirstTimeOptions({
    player: POOR, incoming, pressure01: 0.5,
    attackingSettings: { style: "possession", tempo: "quick", creativity: "balanced" },
    candidates: [{ kind: "first-time-pass", targetId: "ahead", outgoingDirectionDeg: 10, outgoingSpeedYps: 13 }],
  });
  check("a poor player scores the same option lower",
    poorEvaluation.best.score < evaluation.options.find((option) => option.targetId === "ahead").score);
  check("a poor player is penalised more heavily on accuracy",
    poorEvaluation.best.accuracyPenalty > evaluation.options.find((option) => option.targetId === "ahead").accuracyPenalty);
}

// --- degenerate input ------------------------------------------------------
{
  check("a still ball offers nothing",
    evaluateFirstTimeOptions({ player: ELITE, incoming: { speedYps: 0 }, candidates: [] }).reason === "ball-not-travelling");
  check("no candidates means nothing is available",
    evaluateFirstTimeOptions({
      player: ELITE, incoming: { speedYps: 12, heightYards: 0.2, directionDeg: 0 }, candidates: [],
    }).available === false);
  check("an entirely infeasible candidate list is reported as such",
    evaluateFirstTimeOptions({
      player: ELITE, incoming: { speedYps: 12, heightYards: 0.5, directionDeg: 0 },
      candidates: [{ kind: "flick-on", outgoingDirectionDeg: 0, outgoingSpeedYps: 10 }],
    }).reason === "no-feasible-option");
  check("unknown kinds are skipped rather than thrown",
    evaluateFirstTimeOptions({
      player: ELITE, incoming: { speedYps: 12, heightYards: 0.2, directionDeg: 0 },
      candidates: [{ kind: "rabona", outgoingDirectionDeg: 0, outgoingSpeedYps: 10 }],
    }).options.length === 0);
  check("missing input does not throw",
    evaluateFirstTimeOptions({}).available === false);
}

// --- bearingDegrees --------------------------------------------------------
{
  // Percent space is not square (1% of x is 0.75 yards, 1% of y is 1.2), so
  // an angle taken naively off percent coordinates is wrong. A move of equal
  // PERCENT in both axes is therefore not 45 degrees on the real pitch.
  check("a pure +x move bears zero", near(bearingDegrees({ x: 50, y: 50 }, { x: 60, y: 50 }), 0));
  check("a pure +y move bears ninety", near(bearingDegrees({ x: 50, y: 50 }, { x: 50, y: 60 }), 90));
  check("a pure -y move bears minus ninety", near(bearingDegrees({ x: 50, y: 50 }, { x: 50, y: 40 }), -90));
  check("equal percent steps are not forty-five degrees on a 75x120 pitch",
    Math.abs(bearingDegrees({ x: 50, y: 50 }, { x: 60, y: 60 }) - 45) > 5);
  // 10% of x is 7.5 yards, 10% of y is 12 yards -> atan2(12, 7.5).
  check("the bearing is taken in real yards",
    near(bearingDegrees({ x: 50, y: 50 }, { x: 60, y: 60 }),
      (Math.atan2(12, 7.5) * 180) / Math.PI, 1e-9));
}

// --- buildFirstTimeCandidates ----------------------------------------------
{
  // Ball travelling in +y ("down", toward the attacked goal at y=100).
  const contactPoint = { x: 50, y: 50 };
  const ballFrom = { x: 50, y: 30 };
  const teammates = [
    { id: "ahead", x: 50, y: 62 },      // further on, small deflection
    { id: "behind", x: 50, y: 38 },     // back where the ball came from
    { id: "square", x: 62, y: 50 },     // across the body
    { id: "self", x: 50, y: 50 },       // the receiver
    { id: "onTop", x: 50, y: 50.5 },    // too close to be a pass
    { id: "miles", x: 50, y: 98 },      // beyond first-time range
  ];
  const built = buildFirstTimeCandidates({
    contactPoint, ballFrom, receiverId: "self", teammates, attackingDirection: "down",
  });
  const byId = Object.fromEntries(built.map((candidate) => [candidate.targetId, candidate]));

  check("the receiver is not a target for their own release", !byId.self);
  check("a teammate on top of the receiver is not a pass", !byId.onTop);
  check("a target beyond first-time range is excluded", !byId.miles);
  check("the reachable targets are offered", Boolean(byId.ahead && byId.behind && byId.square));

  check("a ball sent back the way it came is a layoff", byId.behind.kind === "layoff");
  check("a ball carried onward is a first-time pass", byId.ahead.kind === "first-time-pass");
  check("a ball played square is a first-time pass", byId.square.kind === "first-time-pass");

  check("a layoff is cushioned rather than driven",
    byId.behind.outgoingSpeedYps <= LAYOFF_MAX_OUTGOING_YPS);
  check("a struck pass uses the engine's own ground-flight pace",
    byId.ahead.outgoingSpeedYps > LAYOFF_MAX_OUTGOING_YPS);
  check("every candidate carries its real distance",
    built.every((candidate) => candidate.distanceYards >= FIRST_TIME_MIN_RANGE_YARDS
      && candidate.distanceYards <= FIRST_TIME_MAX_RANGE_YARDS));

  check("a target nearer the attacked goal is marked advanced", byId.ahead.targetIsAdvanced === true);
  check("a target behind the ball is not marked advanced", byId.behind.targetIsAdvanced === false);
  // Attacking the other way must invert which target counts as advanced,
  // or the term would encode a screen direction rather than football.
  const flipped = buildFirstTimeCandidates({
    contactPoint, ballFrom, receiverId: "self", teammates, attackingDirection: "up",
  });
  check("advancement follows the direction of attack",
    flipped.find((candidate) => candidate.targetId === "ahead").targetIsAdvanced === false
    && flipped.find((candidate) => candidate.targetId === "behind").targetIsAdvanced === true);

  check("no contact point means no candidates",
    buildFirstTimeCandidates({ ballFrom, teammates }).length === 0);
  check("no teammates means no candidates",
    buildFirstTimeCandidates({ contactPoint, ballFrom, teammates: [] }).length === 0);
  check("missing input does not throw", buildFirstTimeCandidates({}).length === 0);

  // The kind each candidate is built as must be a kind feasibility will
  // accept, or the builder and the scorer disagree and options vanish.
  const scored = evaluateFirstTimeOptions({
    player: ELITE,
    incoming: { speedYps: 14, heightYards: 0.2, directionDeg: bearingDegrees(ballFrom, contactPoint) },
    candidates: built,
    pressure01: 0.4,
  });
  check("every built candidate survives its own kind's feasibility gates",
    scored.options.length === built.length);
  check("the layoff is scored as a genuine return",
    scored.options.find((option) => option.targetId === "behind").deflectionDeg >= 120);
}

console.log(`ALL PASS -- ${passes} first-time-play assertions`);
