import { clamp, playerAttribute } from "./matchEngineCore.js";
import { PITCH_LENGTH_YARDS, PITCH_WIDTH_YARDS } from "./pitchGeometry.js";

// ---------------------------------------------------------------------------
// Corner routines as a manager instruction (2026-09-06).
//
// The previous corner layout was a fixed list of seven named roles per side.
// Everyone it did not name kept their open-play formation anchor, which put
// three attackers and five defenders in the box and left the defending team's
// striker 103 yards away, on the opposite goal line, while a corner was swung
// into their own area.
//
// A management game needs the manager to say who does what and how many do
// it, so a role here is a KIND with a count, not a single slot:
//
//   * counts are set per role; several are unbounded (rest defence, near/
//     central/far post runners, keeper occupiers, markers)
//   * `short-option` is capped at two, which is the one genuine rule
//   * near post and far post cover may be set to zero deliberately
//   * anyone the manager does not assign falls to a default, and the default
//     is to crowd the penalty area rather than to stand where open play left
//     them
//   * on the defending side, unassigned players pick up unmarked attackers
//     before they crowd
//
// Coordinates are authored the way a manager describes them -- yards out from
// the goal line, and yards left/right of the goal's centre, signed toward the
// corner the kick is taken from -- and converted once, here. The old layout
// was written as offsets from the corner flag, which is why a "near post
// runner 8 yards from the flag" ended up 33 yards from the near post.
//
// Pure: no randomness, no roster mutation, no DOM. Consumed by Match Lab and
// by the game.
// ---------------------------------------------------------------------------

/** Attacking role kinds. `max: null` means "as many as the manager wants". */
export const CORNER_ATTACK_ROLES = Object.freeze({
  taker: { max: 1, required: true },
  "short-option": { max: 2 },
  "near-post-runner": { max: null },
  "central-runner": { max: null },
  "far-post-runner": { max: null },
  "keeper-occupier": { max: null },
  "edge-of-area": { max: null },
  "rest-defence": { max: null },
});

/** Defending role kinds. */
export const CORNER_DEFEND_ROLES = Object.freeze({
  keeper: { max: 1, required: true },
  "near-post": { max: 1 },
  "far-post": { max: 1 },
  "mark-aerial": { max: null },
  "mark-runner": { max: null },
  "edge-of-area": { max: null },
  counter: { max: null },
  "short-cover": { max: 2 },
});

/** Where the taker may aim. */
export const CORNER_DELIVERY_TARGETS = Object.freeze([
  "near-post", "far-post", "penalty-area", "six-yard-box", "edge-of-area", "short",
]);

export const CORNER_SWINGS = Object.freeze(["inswinger", "outswinger", "straight"]);

/** Below this difference the two feet are treated as equally good. */
export const FOOT_PREFERENCE_MARGIN = 3;

/**
 * Anchors, in manager units: `out` = yards from the goal line, `lat` = yards
 * from the goal's centre, positive toward the corner the kick comes from.
 *
 * `spread` says how extra players at the same role fan out. "deep" starts
 * each additional runner further from goal, which is what a real routine does
 * -- a second near-post runner attacks from behind the first rather than
 * standing beside him. "wide" fans across the pitch.
 */
const ATTACK_ANCHORS = Object.freeze({
  "short-option": { out: 5, lat: 33, spread: "wide", stepYards: -4.5 },
  "near-post-runner": { out: 5.5, lat: 5, spread: "deep", stepYards: 2.5 },
  "central-runner": { out: 8.5, lat: 0.5, spread: "deep", stepYards: 2.5 },
  "far-post-runner": { out: 6.5, lat: -5.5, spread: "deep", stepYards: 2.5 },
  "keeper-occupier": { out: 4.5, lat: -0.5, spread: "wide", stepYards: 1.6 },
  "edge-of-area": { out: 19, lat: 1.5, spread: "wide", stepYards: -5 },
  "rest-defence": { out: 45, lat: 8, spread: "wide", stepYards: -9 },
  "box-crowd": { out: 11.5, lat: -1, spread: "wide", stepYards: 3.2 },
});

const DEFEND_ANCHORS = Object.freeze({
  "near-post": { out: 1.5, lat: 4, spread: "wide", stepYards: 1.5 },
  "far-post": { out: 1.5, lat: -4, spread: "wide", stepYards: -1.5 },
  "edge-of-area": { out: 18, lat: 1, spread: "wide", stepYards: -5 },
  counter: { out: 38, lat: 12, spread: "wide", stepYards: -8 },
  "short-cover": { out: 11, lat: 32, spread: "wide", stepYards: -3.5 },
  "box-crowd": { out: 9, lat: 0, spread: "wide", stepYards: 3.4 },
});

/** Tightness 1..5 -> how far a marker stands off the player they are marking. */
const MARK_DISTANCE_YARDS = Object.freeze({ 1: 2.6, 2: 2.1, 3: 1.7, 4: 1.3, 5: 0.9 });

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Manager units -> pitch percentages.
 *
 * `goalY` is the attacked goal line (0 or 100). `side` is the corner the kick
 * is taken from, and sets which way positive `lat` points, so one authored
 * table serves both corners without a mirrored copy.
 */
export function cornerPoint({ out, lat, goalY, side = "right" }) {
  const sideSign = side === "left" ? -1 : 1;
  const depth = clamp(0, PITCH_LENGTH_YARDS, finite(out)) / PITCH_LENGTH_YARDS * 100;
  const x = 50 + sideSign * (finite(lat) / PITCH_WIDTH_YARDS * 100);
  return {
    x: clamp(0, 100, x),
    y: clamp(0, 100, goalY === 0 ? depth : 100 - depth),
  };
}

/** The inverse, so a caller can describe an existing point in manager units. */
export function cornerUnits({ x, y, goalY, side = "right" }) {
  const sideSign = side === "left" ? -1 : 1;
  const depthPct = goalY === 0 ? finite(y) : 100 - finite(y);
  return {
    out: depthPct / 100 * PITCH_LENGTH_YARDS,
    lat: sideSign * (finite(x) - 50) / 100 * PITCH_WIDTH_YARDS,
  };
}

/** Fans `count` players out from a role's anchor without stacking them. */
export function cornerRoleSpots({ role, count, goalY, side = "right", anchors = ATTACK_ANCHORS }) {
  const anchor = anchors[role];
  const total = Math.max(0, Math.trunc(finite(count)));
  if (!anchor || total === 0) return [];
  const spots = [];
  for (let index = 0; index < total; index += 1) {
    // Alternate either side of the anchor so a pair straddles it rather than
    // both drifting the same way off a single reference body.
    const rank = anchor.spread === "deep" ? index : Math.ceil(index / 2) * (index % 2 === 1 ? 1 : -1);
    const offset = rank * anchor.stepYards;
    const out = anchor.spread === "deep" ? anchor.out + offset : anchor.out;
    const lat = anchor.spread === "deep" ? anchor.lat : anchor.lat + offset;
    spots.push({ role, index, out, lat, ...cornerPoint({ out, lat, goalY, side }) });
  }
  return spots;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

/**
 * Which foot the taker favours, and by how much.
 *
 * `Left Foot`/`Right Foot` are real 1-20 attributes in this data. When both
 * are inferred rather than stated they come back equal, which is reported
 * honestly as no preference rather than silently guessing right-footed.
 */
export function takerFoot(player) {
  const left = playerAttribute(player, "Left Foot");
  const right = playerAttribute(player, "Right Foot");
  const margin = Math.abs(left - right);
  if (margin < FOOT_PREFERENCE_MARGIN) return { foot: "either", left, right, margin };
  return { foot: left > right ? "left" : "right", left, right, margin };
}

/**
 * In- or out-swinging, from the foot and the corner taken.
 *
 * A right-footed player taking from the right corner curls the ball AWAY from
 * the goal (out-swinger); from the left corner the same foot curls it in.
 * Left foot mirrors it. No strong foot means a straight delivery rather than
 * an invented curl.
 */
export function cornerSwing({ player, side = "right" } = {}) {
  const { foot } = takerFoot(player);
  if (foot === "either") return "straight";
  const naturalIn = (side === "right" && foot === "left") || (side === "left" && foot === "right");
  return naturalIn ? "inswinger" : "outswinger";
}

/** Where a chosen delivery is aimed, in manager units and pitch percentages. */
export function cornerDeliveryAim({ target, goalY, side = "right" } = {}) {
  const aims = {
    "near-post": { out: 5.5, lat: 4.5 },
    "far-post": { out: 6.5, lat: -5 },
    "penalty-area": { out: 11, lat: 0 },
    "six-yard-box": { out: 5.5, lat: 0 },
    "edge-of-area": { out: 19, lat: 1 },
    short: { out: 5, lat: 32 },
  };
  const aim = aims[target] ?? aims["penalty-area"];
  return { target: target ?? "penalty-area", ...aim, ...cornerPoint({ ...aim, goalY, side }) };
}

// ---------------------------------------------------------------------------
// Player suitability
// ---------------------------------------------------------------------------

/**
 * Aerial threat, which is what "mark their tall players" actually means here.
 *
 * There is no height in this dataset -- `Height` resolves as a baseline
 * inference from current ability, never as stated data -- so keying off it
 * would be inventing a fact. Heading, Jumping and Strength are real, and are
 * what makes a player dangerous in the air regardless of how tall they are.
 */
export function aerialThreat(player) {
  return (playerAttribute(player, "Heading") * 0.45
    + playerAttribute(player, "Jumping") * 0.35
    + playerAttribute(player, "Strength") * 0.20);
}

/** Threat from movement rather than from the air -- the near-post flick, the
 *  late run, the player who gets across his marker. */
export function runnerThreat(player) {
  return (playerAttribute(player, "Off The Ball", "Off the Ball") * 0.4
    + playerAttribute(player, "Anticipation") * 0.3
    + playerAttribute(player, "Acceleration") * 0.3);
}

/** How good a corner this player would actually deliver. */
export function takerRating(player) {
  return (playerAttribute(player, "Corners") * 0.5
    + playerAttribute(player, "Crossing") * 0.3
    + playerAttribute(player, "Technique") * 0.2);
}

// ---------------------------------------------------------------------------
// Specs and validation
// ---------------------------------------------------------------------------

/**
 * A manager's corner instruction. Counts only; `assignments` pins named
 * players to a role, and anything unpinned is filled by suitability.
 */
export function createCornerAttackSpec({
  counts = {}, assignments = {}, delivery = "penalty-area", takerId = null,
} = {}) {
  return {
    counts: {
      "short-option": 1, "near-post-runner": 1, "central-runner": 1,
      "far-post-runner": 1, "keeper-occupier": 1, "edge-of-area": 1,
      "rest-defence": 2, ...counts,
    },
    assignments: { ...assignments },
    delivery, takerId,
  };
}

export function createCornerDefendSpec({
  counts = {}, assignments = {}, marking = "man", tightness = 3,
} = {}) {
  return {
    counts: {
      "near-post": 1, "far-post": 1, "mark-aerial": 2, "mark-runner": 1,
      "edge-of-area": 1, counter: 1, ...counts,
    },
    assignments: { ...assignments },
    marking, tightness,
  };
}

/** Reports what is wrong with a spec rather than silently clamping it. */
export function validateCornerSpec(spec, { roles, outfieldCount = 10 } = {}) {
  const errors = [];
  const warnings = [];
  let assigned = 0;
  for (const [role, count] of Object.entries(spec.counts ?? {})) {
    const definition = roles[role];
    if (!definition) { errors.push(`Unknown corner role "${role}".`); continue; }
    const value = finite(count);
    if (!Number.isInteger(value) || value < 0) { errors.push(`"${role}" needs a whole, non-negative count.`); continue; }
    if (definition.max !== null && value > definition.max) {
      errors.push(`"${role}" allows at most ${definition.max}, got ${value}.`);
      continue;
    }
    assigned += value;
  }
  if (assigned > outfieldCount) {
    errors.push(`${assigned} players assigned but only ${outfieldCount} are available.`);
  } else if (assigned === outfieldCount) {
    warnings.push("Every outfield player is assigned, so nobody is left to crowd the box.");
  }
  return { valid: errors.length === 0, errors, warnings, assignedCount: assigned };
}

// ---------------------------------------------------------------------------
// Team default, overridable per corner
// ---------------------------------------------------------------------------

/**
 * A team's standing corner instruction -- the tactic, set once alongside
 * formation and marking, and used for every corner until it is changed.
 */
export function createTeamCornerPlan({ attack = {}, defend = {} } = {}) {
  return { attack: createCornerAttackSpec(attack), defend: createCornerDefendSpec(defend) };
}

/**
 * Merges a per-corner override onto the team's standing plan.
 *
 * The override is deliberately PARTIAL. A manager changing one thing about
 * one corner -- an extra man on the far post, a short routine, nobody on the
 * near post this time -- states only that, and everything else stays as the
 * team plays it. A full-replacement override would mean re-specifying eleven
 * players to move one, which is not how a manager thinks and is not what an
 * interface can reasonably ask for.
 *
 * `counts` and `assignments` merge key by key so an override can raise one
 * role without disturbing the others; scalars (delivery, taker, marking,
 * tightness) replace outright, because there is no sensible partial version
 * of "aim it at the far post".
 *
 * Returns a NEW plan; neither input is mutated, which matters because the
 * team plan outlives the corner.
 */
export function resolveCornerPlan(teamPlan, override = null) {
  const base = teamPlan ?? createTeamCornerPlan();
  if (!override) {
    return {
      attack: { ...base.attack, counts: { ...base.attack.counts }, assignments: { ...base.attack.assignments } },
      defend: { ...base.defend, counts: { ...base.defend.counts }, assignments: { ...base.defend.assignments } },
    };
  }
  const mergeSide = (side, patch) => {
    if (!patch) return { ...side, counts: { ...side.counts }, assignments: { ...side.assignments } };
    const { counts, assignments, ...scalars } = patch;
    return {
      ...side,
      ...scalars,
      counts: { ...side.counts, ...(counts ?? {}) },
      assignments: { ...side.assignments, ...(assignments ?? {}) },
    };
  };
  return {
    attack: mergeSide(base.attack, override.attack),
    defend: mergeSide(base.defend, override.defend),
  };
}

/** True when an override would actually change anything about this corner. */
export function cornerOverrideIsMeaningful(teamPlan, override) {
  if (!override) return false;
  const before = JSON.stringify(resolveCornerPlan(teamPlan, null));
  const after = JSON.stringify(resolveCornerPlan(teamPlan, override));
  return before !== after;
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

function pickBy(pool, score, count, taken) {
  return pool
    .filter((entry) => !taken.has(entry.id))
    .sort((left, right) => score(right) - score(left) || String(left.id).localeCompare(String(right.id)))
    .slice(0, count);
}

/**
 * Turns an attacking spec into concrete placements.
 *
 * Order matters and is deliberate: explicit manager assignments first, then
 * the taker (by delivery quality unless pinned), then each role filled by the
 * suitability that role actually cares about, then everyone left over crowds
 * the box. Nobody keeps a formation anchor.
 */
export function resolveCornerAttack({ entries = [], spec, goalY, side = "right", ball = null } = {}) {
  const attackSpec = spec ?? createCornerAttackSpec();
  const outfield = entries.filter((entry) => entry.role !== "keeper");
  const keeper = entries.find((entry) => entry.role === "keeper") ?? null;
  const taken = new Set();
  const placements = [];
  const place = (entry, role, point) => {
    taken.add(entry.id);
    placements.push({ id: entry.id, role, ...point });
  };

  const pinned = new Map();
  for (const [id, role] of Object.entries(attackSpec.assignments ?? {})) pinned.set(String(id), role);

  const takerId = attackSpec.takerId
    ?? [...pinned.entries()].find(([, role]) => role === "taker")?.[0]
    ?? pickBy(outfield, (entry) => takerRating(entry.player), 1, taken)[0]?.id;
  const takerEntry = outfield.find((entry) => String(entry.id) === String(takerId)) ?? outfield[0];
  if (takerEntry) place(takerEntry, "taker", ball ? { x: ball.x, y: ball.y } : cornerPoint({ out: 0, lat: 37.5, goalY, side }));

  const roleScore = {
    "near-post-runner": (entry) => aerialThreat(entry.player) * 0.6 + runnerThreat(entry.player) * 0.4,
    "central-runner": (entry) => aerialThreat(entry.player),
    "far-post-runner": (entry) => aerialThreat(entry.player),
    "keeper-occupier": (entry) => playerAttribute(entry.player, "Strength") + playerAttribute(entry.player, "Bravery"),
    "short-option": (entry) => playerAttribute(entry.player, "Technique") + playerAttribute(entry.player, "Passing"),
    "edge-of-area": (entry) => playerAttribute(entry.player, "Long Shots") + playerAttribute(entry.player, "Technique"),
    "rest-defence": (entry) => playerAttribute(entry.player, "Positioning") + playerAttribute(entry.player, "Pace"),
  };

  for (const role of Object.keys(roleScore)) {
    const count = Math.max(0, Math.trunc(finite(attackSpec.counts?.[role])));
    if (count === 0) continue;
    const spots = cornerRoleSpots({ role, count, goalY, side, anchors: ATTACK_ANCHORS });
    const pinnedForRole = outfield.filter((entry) => !taken.has(entry.id) && pinned.get(String(entry.id)) === role);
    const chosen = [...pinnedForRole];
    if (chosen.length < count) {
      chosen.push(...pickBy(outfield, roleScore[role], count - chosen.length, new Set([...taken, ...chosen.map((c) => c.id)])));
    }
    chosen.slice(0, count).forEach((entry, index) => place(entry, role, spots[index] ?? spots[spots.length - 1]));
  }

  // Everyone unassigned crowds the box. This is the default the old layout
  // lacked, and it is why a corner used to have three attackers in the area.
  const leftovers = outfield.filter((entry) => !taken.has(entry.id));
  const crowdSpots = cornerRoleSpots({ role: "box-crowd", count: leftovers.length, goalY, side, anchors: ATTACK_ANCHORS });
  leftovers.forEach((entry, index) => place(entry, "box-crowd", crowdSpots[index]));

  if (keeper) placements.push({ id: keeper.id, role: "keeper-home", ...cornerPoint({ out: PITCH_LENGTH_YARDS - 8, lat: 0, goalY, side }) });
  return {
    placements,
    swing: takerEntry ? cornerSwing({ player: takerEntry.player, side }) : "straight",
    delivery: cornerDeliveryAim({ target: attackSpec.delivery, goalY, side }),
    takerId: takerEntry?.id ?? null,
  };
}

/**
 * Turns a defending spec into concrete placements, against the attack that
 * was actually set up.
 *
 * Marking is the point of this side: `mark-aerial` picks up the attackers
 * with the highest aerial threat, `mark-runner` the most dangerous movers,
 * and every defender the manager did not assign picks up whoever is still
 * unmarked in the box before falling back to crowding. A short option in the
 * attacking setup pulls a defender out to it automatically.
 */
export function resolveCornerDefence({
  entries = [], spec, attack, goalY, side = "right",
} = {}) {
  const defendSpec = spec ?? createCornerDefendSpec();
  const outfield = entries.filter((entry) => entry.role !== "keeper");
  const keeper = entries.find((entry) => entry.role === "keeper") ?? null;
  const taken = new Set();
  const placements = [];
  const markDistance = MARK_DISTANCE_YARDS[clamp(1, 5, Math.round(finite(defendSpec.tightness, 3)))] ?? 1.7;
  const place = (entry, role, point, marks = null) => {
    taken.add(entry.id);
    placements.push({ id: entry.id, role, ...point, ...(marks ? { marks } : {}) });
  };
  const pinned = new Map();
  for (const [id, role] of Object.entries(defendSpec.assignments ?? {})) pinned.set(String(id), role);

  if (keeper) place(keeper, "keeper", cornerPoint({ out: 2.5, lat: -0.5, goalY, side }));

  // Attackers worth marking: in or around the box, never the taker.
  const attackers = (attack?.placements ?? [])
    .filter((spot) => spot.role !== "taker" && spot.role !== "keeper-home" && spot.role !== "rest-defence");
  const shortOptions = attackers.filter((spot) => spot.role === "short-option");
  const markable = attackers.filter((spot) => spot.role !== "short-option");
  const marked = new Set();

  const counts = { ...defendSpec.counts };
  // A short option that exists must be covered, whether or not it was asked for.
  counts["short-cover"] = Math.max(finite(counts["short-cover"]), shortOptions.length);

  const fixedRoles = ["near-post", "far-post", "edge-of-area", "counter", "short-cover"];
  for (const role of fixedRoles) {
    const count = Math.max(0, Math.trunc(finite(counts[role])));
    if (count === 0) continue;
    const spots = cornerRoleSpots({ role, count, goalY, side, anchors: DEFEND_ANCHORS });
    const pinnedForRole = outfield.filter((entry) => !taken.has(entry.id) && pinned.get(String(entry.id)) === role);
    const score = role === "counter"
      ? (entry) => playerAttribute(entry.player, "Pace") + playerAttribute(entry.player, "Acceleration")
      : (entry) => playerAttribute(entry.player, "Positioning") + playerAttribute(entry.player, "Concentration");
    const chosen = [...pinnedForRole];
    if (chosen.length < count) {
      chosen.push(...pickBy(outfield, score, count - chosen.length, new Set([...taken, ...chosen.map((c) => c.id)])));
    }
    chosen.slice(0, count).forEach((entry, index) => place(entry, role, spots[index] ?? spots[spots.length - 1]));
  }

  /** Goal-side of the marked attacker, at the instructed tightness. */
  const markSpot = (target) => {
    const units = cornerUnits({ x: target.x, y: target.y, goalY, side });
    const out = Math.max(0.5, units.out - markDistance);
    return { out, lat: units.lat, ...cornerPoint({ out, lat: units.lat, goalY, side }) };
  };

  // Which attackers each marking role picks up, and what makes a defender
  // suited to that job. An aerial marker is chosen for his own aerial ability;
  // a runner marker is chosen for pace and reading, because the job is to stay
  // with someone who moves, not to out-jump him.
  const markingRoles = [
    { role: "mark-aerial", threat: aerialThreat, suits: (entry) => aerialThreat(entry.player) },
    { role: "mark-runner", threat: runnerThreat, suits: (entry) => runnerThreat(entry.player) },
  ];
  for (const { role, threat, suits } of markingRoles) {
    const count = Math.max(0, Math.trunc(finite(counts[role])));
    if (count === 0) continue;
    const targets = markable
      .filter((spot) => !marked.has(spot.id))
      .sort((a, b) => threat(b.player ?? {}) - threat(a.player ?? {}) || String(a.id).localeCompare(String(b.id)))
      .slice(0, count);
    const pinnedForRole = outfield.filter((entry) => !taken.has(entry.id) && pinned.get(String(entry.id)) === role);
    const chosen = [...pinnedForRole];
    if (chosen.length < targets.length) {
      chosen.push(...pickBy(outfield, suits,
        targets.length - chosen.length, new Set([...taken, ...chosen.map((c) => c.id)])));
    }
    targets.forEach((target, index) => {
      const entry = chosen[index];
      if (!entry) return;
      marked.add(target.id);
      place(entry, role, markSpot(target), target.id);
    });
  }

  // Unassigned defenders mark whoever is still unmarked, nearest threat first.
  const unmarked = markable
    .filter((spot) => !marked.has(spot.id))
    .sort((a, b) => aerialThreat(b.player ?? {}) - aerialThreat(a.player ?? {}) || String(a.id).localeCompare(String(b.id)));
  const spare = outfield.filter((entry) => !taken.has(entry.id));
  spare.forEach((entry, index) => {
    const target = unmarked[index];
    if (target) {
      marked.add(target.id);
      place(entry, "mark-spare", markSpot(target), target.id);
    }
  });

  // Anyone still spare crowds the box rather than standing in open play.
  const crowd = outfield.filter((entry) => !taken.has(entry.id));
  const crowdSpots = cornerRoleSpots({ role: "box-crowd", count: crowd.length, goalY, side, anchors: DEFEND_ANCHORS });
  crowd.forEach((entry, index) => place(entry, "box-crowd", crowdSpots[index]));

  return { placements, markDistanceYards: markDistance, unmarkedCount: markable.length - marked.size };
}
