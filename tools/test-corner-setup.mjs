import assert from "node:assert/strict";
import {
  resolveCornerAttack, resolveCornerDefence, createCornerAttackSpec, createCornerDefendSpec,
  validateCornerSpec, cornerSwing, takerFoot, cornerPoint, cornerUnits, cornerRoleSpots,
  cornerDeliveryAim, aerialThreat, runnerThreat, takerRating,
  createTeamCornerPlan, resolveCornerPlan, cornerOverrideIsMeaningful,
  CORNER_ATTACK_ROLES, CORNER_DEFEND_ROLES, CORNER_DELIVERY_TARGETS,
} from "../src/lib/cornerSetup.js";
import { createTeamSetup } from "../src/lib/matchSetup.js";
import { createRestartSetup } from "../src/lib/restartSetup.js";

const attrs = (o) => Object.entries(o).map(([label, value]) => ({ label, value }));
const mk = (name, o) => ({ canonical_player_name: name, current_ability: 150, attributes: attrs(o) });
const squad = (prefix) => Array.from({ length: 11 }, (_, i) => ({
  id: `${prefix}${i}`, role: i === 0 ? "keeper" : "player",
  player: mk(`${prefix}${i}`, {
    Heading: 6 + ((i * 3) % 15), Jumping: 6 + ((i * 5) % 15), Strength: 8 + ((i * 2) % 12),
    "Off The Ball": 8 + ((i * 7) % 12), Anticipation: 8 + ((i * 4) % 12), Acceleration: 8 + ((i * 6) % 12),
    Corners: 5 + ((i * 9) % 15), Crossing: 5 + ((i * 8) % 15), Technique: 8 + ((i * 3) % 12),
    Passing: 8 + ((i * 5) % 12), Positioning: 8 + ((i * 4) % 12), Concentration: 10, Bravery: 10,
    Pace: 8 + ((i * 3) % 12), "Long Shots": 8 + ((i * 7) % 12),
    "Left Foot": i % 2 ? 20 : 6, "Right Foot": i % 2 ? 6 : 20,
  }),
}));

const ATT = squad("A"), DEF = squad("D"), GOAL_Y = 0, BALL = { x: 100, y: 0 };
let checks = 0;
const check = (label, condition) => { assert(condition, label); checks += 1; };

const attackWith = (counts, side = "right", extra = {}) => {
  const result = resolveCornerAttack({
    entries: ATT, spec: createCornerAttackSpec({ counts, ...extra }), goalY: GOAL_Y, side, ball: BALL,
  });
  for (const spot of result.placements) spot.player = ATT.find((e) => e.id === spot.id)?.player;
  return result;
};
const roleCounts = (result) => result.placements.reduce((acc, spot) => {
  acc[spot.role] = (acc[spot.role] ?? 0) + 1; return acc;
}, {});
const outYards = (spot) => (GOAL_Y === 0 ? spot.y : 100 - spot.y) / 100 * 120;
const latYards = (spot, side = "right") => (side === "left" ? -1 : 1) * (spot.x - 50) / 100 * 75;
const inPenaltyArea = (spot) => Math.abs(spot.x - 50) <= 29.33 && outYards(spot) <= 18;

// ---------------------------------------------------------------------------
console.log("=== 1: the frame is the one a manager describes, and it round-trips ===");
{
  const point = cornerPoint({ out: 12, lat: 6, goalY: 0, side: "right" });
  const back = cornerUnits({ ...point, goalY: 0, side: "right" });
  check("out/lat survive a round trip", Math.abs(back.out - 12) < 1e-9 && Math.abs(back.lat - 6) < 1e-9);
  // Positive lat means "toward the corner the kick is taken from", so the same
  // authored table serves both corners without a mirrored copy.
  const right = cornerPoint({ out: 6, lat: 5, goalY: 0, side: "right" });
  const left = cornerPoint({ out: 6, lat: 5, goalY: 0, side: "left" });
  check("the same table mirrors for the other corner", Math.abs((right.x - 50) + (left.x - 50)) < 1e-9);
  check("both corners keep the same depth", Math.abs(right.y - left.y) < 1e-9);
  // Attacking the other goal flips depth, not the lateral sense.
  const otherEnd = cornerPoint({ out: 6, lat: 5, goalY: 100, side: "right" });
  check("the far goal mirrors depth only", Math.abs(otherEnd.y - (100 - right.y)) < 1e-9 && otherEnd.x === right.x);
}

console.log("\n=== 2: a role is a kind with a count, and extras never stack ===");
{
  const spots = cornerRoleSpots({ role: "near-post-runner", count: 3, goalY: GOAL_Y, side: "right" });
  check("three near-post runners produce three spots", spots.length === 3);
  const depths = spots.map((s) => s.out);
  check("extra runners start deeper rather than beside the first",
    depths[1] > depths[0] && depths[2] > depths[1]);
  for (let i = 0; i < spots.length; i += 1) {
    for (let j = i + 1; j < spots.length; j += 1) {
      const gap = Math.hypot((spots[i].x - spots[j].x) / 100 * 75, (spots[i].y - spots[j].y) / 100 * 120);
      check(`spot ${i} and ${j} are not stacked`, gap > 1);
    }
  }
  const wide = cornerRoleSpots({ role: "keeper-occupier", count: 3, goalY: GOAL_Y, side: "right" });
  check("a 'wide' role straddles its anchor rather than drifting one way",
    Math.sign(wide[1].lat - wide[0].lat) !== Math.sign(wide[2].lat - wide[0].lat));
  check("a zero count places nobody", cornerRoleSpots({ role: "near-post-runner", count: 0, goalY: GOAL_Y }).length === 0);
}

console.log("\n=== 3: the manager sets the counts ===");
{
  const base = roleCounts(attackWith({}));
  check("a default corner still fills the box", attackWith({}).placements.filter(inPenaltyArea).length >= 5);

  for (const role of ["near-post-runner", "central-runner", "far-post-runner", "keeper-occupier"]) {
    const raised = roleCounts(attackWith({ [role]: 3 }));
    check(`"${role}" can be increased at will`, raised[role] === 3 && (base[role] ?? 0) < 3);
  }
  const rest = roleCounts(attackWith({ "short-option": 0, "edge-of-area": 0, "rest-defence": 4 }));
  check("rest defence can be increased at will", rest["rest-defence"] === 4);

  const two = roleCounts(attackWith({ "short-option": 2 }));
  check("two short options are allowed", two["short-option"] === 2);
  const capped = validateCornerSpec(createCornerAttackSpec({ counts: { "short-option": 3 } }),
    { roles: CORNER_ATTACK_ROLES });
  check("a third short option is rejected, not silently clamped",
    !capped.valid && capped.errors.some((e) => e.includes("at most 2")));

  const over = validateCornerSpec(createCornerAttackSpec({ counts: { "near-post-runner": 9 } }),
    { roles: CORNER_ATTACK_ROLES });
  check("assigning more players than exist is an error", !over.valid);
  check("the error says how many were assigned", over.errors.some((e) => /assigned but only/.test(e)));
}

console.log("\n=== 4: unassigned attackers crowd the box, they do not keep a formation anchor ===");
{
  const sparse = attackWith({
    "near-post-runner": 1, "central-runner": 0, "far-post-runner": 0,
    "keeper-occupier": 0, "short-option": 0, "edge-of-area": 0, "rest-defence": 0,
  });
  const counts = roleCounts(sparse);
  check("everyone unassigned becomes box-crowd", counts["box-crowd"] === 8);
  const crowd = sparse.placements.filter((s) => s.role === "box-crowd");
  check("and they are genuinely in the penalty area", crowd.every(inPenaltyArea));
  for (let i = 0; i < crowd.length; i += 1) {
    for (let j = i + 1; j < crowd.length; j += 1) {
      const gap = Math.hypot((crowd[i].x - crowd[j].x) / 100 * 75, (crowd[i].y - crowd[j].y) / 100 * 120);
      check(`crowd ${i}/${j} are not on the same coordinate`, gap > 1);
    }
  }
  check("every outfield player is placed exactly once",
    new Set(sparse.placements.map((s) => s.id)).size === sparse.placements.length);
  check("the attacking keeper stays home, not in the box",
    outYards(sparse.placements.find((s) => s.role === "keeper-home")) > 90);
}

console.log("\n=== 5: the taker, his foot, and the delivery ===");
{
  const rightFoot = mk("r", { "Left Foot": 6, "Right Foot": 20 });
  const leftFoot = mk("l", { "Left Foot": 20, "Right Foot": 6 });
  const evenFoot = mk("e", { "Left Foot": 14, "Right Foot": 14 });
  check("footedness is read from the real attributes", takerFoot(rightFoot).foot === "right"
    && takerFoot(leftFoot).foot === "left");
  check("two equally good feet are reported as such, not guessed", takerFoot(evenFoot).foot === "either");
  // A right foot from the right corner curls the ball away from goal.
  check("right foot / right corner is an out-swinger", cornerSwing({ player: rightFoot, side: "right" }) === "outswinger");
  check("right foot / left corner is an in-swinger", cornerSwing({ player: rightFoot, side: "left" }) === "inswinger");
  check("left foot / right corner is an in-swinger", cornerSwing({ player: leftFoot, side: "right" }) === "inswinger");
  check("left foot / left corner is an out-swinger", cornerSwing({ player: leftFoot, side: "left" }) === "outswinger");
  check("no strong foot means a straight ball, not an invented curl",
    cornerSwing({ player: evenFoot, side: "right" }) === "straight");

  for (const target of CORNER_DELIVERY_TARGETS) {
    const aim = cornerDeliveryAim({ target, goalY: GOAL_Y, side: "right" });
    check(`"${target}" produces a real aim point`, Number.isFinite(aim.x) && Number.isFinite(aim.y));
  }
  const near = cornerDeliveryAim({ target: "near-post", goalY: GOAL_Y, side: "right" });
  const far = cornerDeliveryAim({ target: "far-post", goalY: GOAL_Y, side: "right" });
  check("near and far post are on opposite sides of the goal's centre", near.lat > 0 && far.lat < 0);
  const six = cornerDeliveryAim({ target: "six-yard-box", goalY: GOAL_Y });
  const edge = cornerDeliveryAim({ target: "edge-of-area", goalY: GOAL_Y });
  check("the six-yard target is nearer the goal than the edge", six.out < edge.out);
  check("a short corner is aimed out by the flag", cornerDeliveryAim({ target: "short", goalY: GOAL_Y }).lat > 25);

  check("the best deliverer takes it when nobody is pinned",
    takerRating(ATT.find((e) => e.id === attackWith({}).takerId).player)
      >= Math.max(...ATT.filter((e) => e.role !== "keeper").map((e) => takerRating(e.player))) - 1e-9);
  const pinned = attackWith({}, "right", { takerId: "A3" });
  check("a manager's nominated taker overrides suitability", pinned.takerId === "A3");
  check("the taker stands on the ball",
    Math.abs(pinned.placements.find((s) => s.role === "taker").x - BALL.x) < 1e-9);
}

console.log("\n=== 6: defending -- marking is the point ===");
{
  const attack = attackWith({});
  const defendWith = (counts, opts = {}) => resolveCornerDefence({
    entries: DEF, spec: createCornerDefendSpec({ counts, ...opts }), attack, goalY: GOAL_Y, side: "right",
  });

  const base = defendWith({});
  const baseCounts = base.placements.reduce((a, s) => { a[s.role] = (a[s.role] ?? 0) + 1; return a; }, {});
  check("a default defensive corner fills the box", base.placements.filter(inPenaltyArea).length >= 8);
  check("both posts are covered by default", baseCounts["near-post"] === 1 && baseCounts["far-post"] === 1);
  check("one player stays up for the counter by default", baseCounts.counter === 1);
  check("every outfield defender is placed exactly once",
    new Set(base.placements.map((s) => s.id)).size === base.placements.length);

  // Unassigned defenders mark unmarked attackers before crowding.
  const spare = base.placements.filter((s) => s.role === "mark-spare");
  check("unassigned defenders pick up unmarked attackers", spare.length > 0);
  check("every marker names who it marks", base.placements.filter((s) => /^mark-/.test(s.role)).every((s) => s.marks));
  const markedIds = base.placements.filter((s) => s.marks).map((s) => s.marks);
  check("no two defenders mark the same attacker", new Set(markedIds).size === markedIds.length);

  // A marker stands goal-side of his man.
  for (const marker of base.placements.filter((s) => s.marks)) {
    const target = attack.placements.find((s) => s.id === marker.marks);
    check(`marker on ${marker.marks} is goal-side`, outYards(marker) < outYards(target) + 1e-9);
  }

  // Tightness moves the marker, and nothing else.
  const loose = defendWith({}, { tightness: 1 });
  const tight = defendWith({}, { tightness: 5 });
  const gapAt = (result) => {
    const marker = result.placements.find((s) => s.marks);
    const target = attack.placements.find((s) => s.id === marker.marks);
    return outYards(target) - outYards(marker);
  };
  check("tighter marking stands closer to the man", gapAt(tight) < gapAt(loose));

  check("aerial markers pick the aerial threats",
    base.placements.filter((s) => s.role === "mark-aerial").every((s) => {
      const target = attack.placements.find((a) => a.id === s.marks);
      return aerialThreat(target.player) >= 10;
    }));

  const posts = defendWith({ "near-post": 0, "far-post": 0 });
  const postCounts = posts.placements.reduce((a, s) => { a[s.role] = (a[s.role] ?? 0) + 1; return a; }, {});
  check("post cover can be left empty on purpose", !postCounts["near-post"] && !postCounts["far-post"]);
  check("and those bodies go to marking instead", posts.unmarkedCount <= base.unmarkedCount);

  const aerial = defendWith({ "mark-aerial": 4 });
  check("aerial marking can be increased at will",
    aerial.placements.filter((s) => s.role === "mark-aerial").length === 4);
  const runners = defendWith({ "mark-runner": 3 });
  check("runner marking can be increased at will",
    runners.placements.filter((s) => s.role === "mark-runner").length === 3);

  // The tradeoff is visible rather than hidden: more bodies up the pitch
  // means more attackers left unmarked, and the caller is told the number.
  const counter = defendWith({ counter: 3 });
  check("committing players to the counter leaves attackers unmarked",
    counter.unmarkedCount > base.unmarkedCount);
}

console.log("\n=== 7: a short corner drags a defender out, asked for or not ===");
{
  const withShort = attackWith({ "short-option": 2 });
  const covered = resolveCornerDefence({
    entries: DEF, spec: createCornerDefendSpec({ counts: { "short-cover": 0 } }),
    attack: withShort, goalY: GOAL_Y, side: "right",
  });
  const cover = covered.placements.filter((s) => s.role === "short-cover");
  check("a short option is covered even when the manager asked for none", cover.length === 2);
  check("the cover goes out to the flag", cover.every((s) => latYards(s) > 25));

  const noShort = attackWith({ "short-option": 0 });
  const none = resolveCornerDefence({
    entries: DEF, spec: createCornerDefendSpec({ counts: { "short-cover": 0 } }),
    attack: noShort, goalY: GOAL_Y, side: "right",
  });
  check("with no short option nobody is sent out there",
    none.placements.filter((s) => s.role === "short-cover").length === 0);
}

console.log("\n=== 8: determinism ===");
{
  const a = attackWith({ "near-post-runner": 2 });
  const b = attackWith({ "near-post-runner": 2 });
  check("the same spec resolves identically",
    JSON.stringify(a.placements.map(({ player, ...rest }) => rest))
      === JSON.stringify(b.placements.map(({ player, ...rest }) => rest)));
  const shuffled = resolveCornerAttack({
    entries: [...ATT].reverse(), spec: createCornerAttackSpec(), goalY: GOAL_Y, side: "right", ball: BALL,
  });
  const straight = resolveCornerAttack({
    entries: ATT, spec: createCornerAttackSpec(), goalY: GOAL_Y, side: "right", ball: BALL,
  });
  const key = (r) => JSON.stringify([...r.placements].sort((x, y) => String(x.id).localeCompare(String(y.id)))
    .map((s) => [s.id, s.role, s.x.toFixed(6), s.y.toFixed(6)]));
  check("roster order does not change who does what", key(shuffled) === key(straight));
}

console.log("\n=== 9: a team default, overridable per corner ===");
{
  const team = createTeamSetup({ team: "home" });
  check("a team setup carries a standing corner plan", Boolean(team.cornerPlan?.attack && team.cornerPlan?.defend));
  const custom = createTeamSetup({ team: "home", cornerPlan: {
    attack: { counts: { "far-post-runner": 2 }, delivery: "far-post" },
    defend: { tightness: 4, marking: "zonal" },
  } });
  check("the manager's standing plan is kept", custom.cornerPlan.attack.counts["far-post-runner"] === 2
    && custom.cornerPlan.attack.delivery === "far-post"
    && custom.cornerPlan.defend.tightness === 4);

  // An override is partial: it changes one thing and leaves the rest alone.
  const merged = resolveCornerPlan(custom.cornerPlan, {
    attack: { counts: { "near-post-runner": 3 } },
    defend: { counts: { "near-post": 0 } },
  });
  check("an override raises the role it names", merged.attack.counts["near-post-runner"] === 3);
  check("and leaves the team's other counts alone", merged.attack.counts["far-post-runner"] === 2);
  check("scalars the override does not mention survive", merged.attack.delivery === "far-post"
    && merged.defend.tightness === 4 && merged.defend.marking === "zonal");
  check("a role the override zeroes really is zeroed", merged.defend.counts["near-post"] === 0);

  // There is no partial version of "aim it at the near post".
  check("a scalar override replaces outright",
    resolveCornerPlan(custom.cornerPlan, { attack: { delivery: "near-post" } }).attack.delivery === "near-post");

  check("the team plan is never mutated by an override",
    custom.cornerPlan.attack.counts["near-post-runner"] === 1
    && custom.cornerPlan.attack.delivery === "far-post");
  check("no override means the team plan, unchanged",
    JSON.stringify(resolveCornerPlan(custom.cornerPlan, null).attack.counts)
      === JSON.stringify(custom.cornerPlan.attack.counts));
  check("an empty override changes nothing",
    !cornerOverrideIsMeaningful(custom.cornerPlan, { attack: { counts: {} } }));
  check("a real override is reported as meaningful",
    cornerOverrideIsMeaningful(custom.cornerPlan, { attack: { counts: { "near-post-runner": 3 } } }));

  const corner = createRestartSetup({
    type: "corner", takingTeam: "home", side: "right",
    attackingDirectionByTeam: { home: "up", away: "down" },
    cornerOverride: { attack: { counts: { "near-post-runner": 3 } } },
  });
  check("a corner carries its own override", corner.cornerOverride?.attack?.counts["near-post-runner"] === 3);
  const kickoff = createRestartSetup({
    type: "kickoff", takingTeam: "home",
    attackingDirectionByTeam: { home: "up", away: "down" },
    cornerOverride: { attack: { counts: {} } },
  });
  check("a non-corner restart does not carry a corner override", kickoff.cornerOverride === null);

  // End to end: the merged plan is what actually places the players.
  const resolved = resolveCornerPlan(custom.cornerPlan, { attack: { counts: { "near-post-runner": 3 } } });
  const placed = resolveCornerAttack({ entries: ATT, spec: resolved.attack, goalY: GOAL_Y, side: "right", ball: BALL });
  const counts = placed.placements.reduce((a, s) => { a[s.role] = (a[s.role] ?? 0) + 1; return a; }, {});
  check("the merged plan is what places the players",
    counts["near-post-runner"] === 3 && counts["far-post-runner"] === 2);
  check("and the merged delivery is the one aimed at", placed.delivery.target === "far-post");
}

console.log(`\nCorner setup contracts passed (${checks} checks).`);
