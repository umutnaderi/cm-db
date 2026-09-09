// Action Pattern Registry v1 -- the declared pattern vocabulary, and the
// deterministic matcher that turns declarations into candidate intentions.
//
// Pure and DOM-free. Consumes NO randomness: the same world always produces
// the same proposals, which is what keeps replay determinism intact.
//
// What this module may do: read a world snapshot, decide which patterns
// fire, assign abstract slots to real players, resolve conflicts, and return
// proposed jobs plus a request for a target derivation.
//
// What it may NOT do, ever: write a roster coordinate, touch ball state,
// author a playback event, call a resolver, or decide whether an action
// succeeds. Geometry stays in spatialDecision.js -- the registry names a
// derivation and the CALLER supplies the same geometric function the
// hard-coded behaviour already used, which is what makes migration a
// provable parity change rather than a rewrite.
//
// ---------------------------------------------------------------------------
// Composition and conflict
// ---------------------------------------------------------------------------
//
// Patterns are small fragments, and several fire in one beat. A passage may
// independently select a passer making `run-off-pass`, a full-back making
// `arc-overlap`, a midfielder giving `support-short` and a forward doing
// `pin-last-line` -- four separate declarations, four separate players.
//
// Two rules keep that sane, and both are enforced here rather than left to
// each caller:
//
//   participant claims  One player may hold at most ONE proposed job per
//                       beat. The first pattern to claim them wins; a later
//                       pattern wanting the same player is rejected with a
//                       reason, never silently overwritten.
//   exclusivity groups  Patterns sharing a group compete for a limited
//                       number of slots. `special-run` has capacity 1,
//                       which is exactly the pre-existing "1 special run"
//                       cap that selectSpecialMover() enforced by falling
//                       out of a fixed if-chain. The cap is preserved, not
//                       replaced.
//
// Ordering is by (group priority, declaration order) -- both static, so the
// outcome never depends on object iteration order or on how the world was
// assembled.

import { normalizeActionPattern } from "./actionPatternSchema.js";

/**
 * Exclusivity group capacities.
 *
 * `special-run` is the pre-existing L3 "1 special run" restriction:
 * vacate-pocket / arc-overlap / peel-square / show-wide / check-decel share
 * ONE slot between them per call. run-off-pass is deliberately not in the
 * group -- it always was a separate, always-eligible job for the passer
 * specifically, and folding it in would change behaviour rather than
 * preserve it.
 */
export const EXCLUSIVITY_CAPACITY = Object.freeze({
  "special-run": 1,
  // Dynamic Ball Claim v2 (2026-09-04) -- exactly ONE player is authorised
  // to go for a given loose ball. This is the same shape of rule as the
  // special-run cap: a real football constraint (a team does not send four
  // players at one rolling ball) expressed as capacity rather than as
  // control flow. Abandonment needs no declaration of its own -- it is
  // simply the complement, which is exactly how shouldChaseLooseBall()
  // answers for everybody who is not the claimant.
  "loose-ball": 1,
});

// ---------------------------------------------------------------------------
// Declared patterns
// ---------------------------------------------------------------------------
//
// Each of these was previously an arm of selectSpecialMover()'s if-chain in
// spatialDecision.js. The order below reproduces that chain's own priority
// exactly, expressed as declaration order inside one exclusivity group
// rather than as control flow. `source.reference` cites the broadcast-still
// pattern each was distilled from -- development traceability only, never
// read at run time.
//
// Note what is NOT here: no coordinates, no named players, no sequence. Each
// declaration says when the picture exists and which primitive it proposes.

const DECLARATIONS = [
  {
    id: "pattern:vacate-pocket@1",
    version: 1,
    name: "Vacate the pocket",
    description:
      "A teammate standing in the cone directly ahead of the ball clears out of "
      + "the lane the carrier would otherwise have to dribble through.",
    trigger: { possession: "attacking" },
    participants: [
      { slot: "ballOwner", relation: "ball-owner" },
      {
        slot: "pocketOccupant",
        relation: "teammate-of-ball-owner",
        relativeTo: "ballOwner",
        spatial: { kind: "in-cone-ahead-of-ball", aheadYards: 15, radiusYards: 5 },
      },
    ],
    proposal: {
      job: "vacate-pocket",
      actor: "pocketOccupant",
      target: { derivation: "perpendicular-push-from-ball-cone", parameters: { pushYards: 8 } },
    },
    limits: { maxParticipants: 1 },
    exclusivity: { group: "special-run", priority: 100 },
    reevaluate: { on: ["ball-region-change", "possession-change"] },
    source: { reference: "V1", note: "Body in the carrier's cone steps out of the lane." },
  },
  {
    id: "pattern:arc-overlap@1",
    version: 1,
    name: "Arced overlap",
    description:
      "An unmarked runner on the far side from the ball overlaps in their own "
      + "wide channel, staying wide rather than cutting inside.",
    trigger: { possession: "attacking" },
    participants: [
      { slot: "ballOwner", relation: "ball-owner" },
      {
        slot: "wideRunner",
        relation: "teammate-of-ball-owner",
        relativeTo: "ballOwner",
        spatial: { kind: "opposite-lane-to-ball", withinYards: null },
      },
    ],
    proposal: {
      job: "arc-overlap",
      actor: "wideRunner",
      target: {
        derivation: "forward-in-own-channel",
        parameters: { forwardYards: 12, outwardYards: 4 },
      },
    },
    limits: { maxParticipants: 1 },
    exclusivity: { group: "special-run", priority: 90 },
    reevaluate: { on: ["ball-region-change", "possession-change"] },
    source: { reference: "V4", note: "Far-side full-back overlaps into the vacated channel." },
  },
  {
    id: "pattern:peel-square@1",
    version: 1,
    name: "Peel square",
    description:
      "An attacker with a defender nearby, but no formal tight-marking "
      + "assignment, peels into adjacent space near the ball.",
    trigger: { possession: "attacking" },
    participants: [
      { slot: "ballOwner", relation: "ball-owner" },
      {
        slot: "markedAttacker",
        relation: "teammate-of-ball-owner",
        relativeTo: "ballOwner",
        spatial: { kind: "marked-within-yards", withinYards: 15 },
      },
    ],
    proposal: {
      job: "peel-square",
      actor: "markedAttacker",
      target: { derivation: "find-space-for-attack", parameters: {} },
    },
    limits: { maxParticipants: 1 },
    exclusivity: { group: "special-run", priority: 80 },
    reevaluate: { on: ["ball-region-change", "possession-change"] },
    source: { reference: "V5", note: "Loosely-tracked attacker peels off the marker's shoulder." },
  },
  {
    id: "pattern:show-wide@1",
    version: 1,
    name: "Show wide",
    description:
      "With the inside lane clogged, a wide player shows for the ball on the "
      + "touchline to give the carrier a lane that exists.",
    trigger: { possession: "attacking" },
    participants: [
      { slot: "ballOwner", relation: "ball-owner" },
      {
        slot: "wideRunner",
        relation: "teammate-of-ball-owner",
        relativeTo: "ballOwner",
        eligibility: { positionalSlots: [] },
        spatial: { kind: "none" },
      },
    ],
    proposal: {
      job: "show-wide",
      actor: "wideRunner",
      target: { derivation: "hold-width", parameters: {} },
    },
    limits: { maxParticipants: 1 },
    exclusivity: { group: "special-run", priority: 70 },
    reevaluate: { on: ["ball-region-change", "possession-change"] },
    source: { reference: "V7", note: "Inside blocked, so the width is offered instead." },
  },
  {
    id: "pattern:check-decel@1",
    version: 1,
    name: "Check and accelerate",
    description:
      "A loosely-tracked attacker checks their run before darting into a real "
      + "pocket. Shipped as a single delayed-onset dart -- two-phase timing is "
      + "not modelled yet, and that limitation is inherited, not introduced.",
    trigger: { possession: "attacking" },
    participants: [
      { slot: "ballOwner", relation: "ball-owner" },
      {
        slot: "markedAttacker",
        relation: "teammate-of-ball-owner",
        relativeTo: "ballOwner",
        spatial: { kind: "marked-within-yards", withinYards: null },
      },
    ],
    proposal: {
      job: "check-decel",
      actor: "markedAttacker",
      target: { derivation: "find-space-for-attack", parameters: {} },
    },
    limits: { maxParticipants: 1 },
    exclusivity: { group: "special-run", priority: 60 },
    reevaluate: { on: ["ball-region-change", "possession-change"] },
    source: { reference: "V5", note: "Check-away then burst; onset delay only in v1." },
  },
  {
    id: "pattern:run-off-pass@1",
    version: 1,
    name: "Run off the pass",
    description:
      "Whoever just played the ball supports it from the kick, relative to "
      + "where the ball is going rather than where the passer is standing.",
    trigger: { possession: "attacking" },
    participants: [{ slot: "passer", relation: "passer" }],
    proposal: {
      job: "run-off-pass",
      actor: "passer",
      target: { derivation: "run-off-pass-from-destination", parameters: { baseYards: 8 } },
    },
    limits: { maxParticipants: 1 },
    // Deliberately NOT in the special-run group: this was always a separate,
    // always-eligible job for the passer, and the pre-existing cap never
    // applied to it.
    exclusivity: { group: null, priority: 50 },
    reevaluate: { on: ["possession-change"] },
    source: { reference: "V4/V9/V10", note: "Passer supports the ball they just played." },
  },
  {
    id: "pattern:claim-loose-ball@1",
    version: 1,
    name: "Claim the loose ball",
    description:
      "A loose, rolling ball is claimed by the one player who can genuinely "
      + "meet it before it stops or crosses a line. Everybody else abandons.",
    trigger: { possession: "loose" },
    participants: [
      {
        slot: "secondBallPlayer",
        relation: "nearest-to-ball",
        spatial: { kind: "can-reach-rolling-ball" },
      },
    ],
    proposal: {
      job: "claim-loose-ball",
      actor: "secondBallPlayer",
      target: { derivation: "intercept-rolling-ball" },
    },
    limits: { maxParticipants: 1 },
    exclusivity: { group: "loose-ball", priority: 120 },
    // A rolling ball is the one picture that genuinely changes under the
    // players feet, so the claim is re-asked as it slows rather than
    // settled once at the instant it came loose.
    reevaluate: { on: ["ball-region-change", "possession-change"] },
    source: { reference: "new-issues.md", note: "Through ball nobody reaches; the chase must be re-decided, not fixed at the pass." },
  },
];

/** Builds a registry from declarations. Throws on any invalid declaration. */
export function createActionPatternRegistry(declarations = DECLARATIONS) {
  const patterns = declarations.map(normalizeActionPattern);
  const byId = new Map(patterns.map((pattern) => [pattern.id, pattern]));
  if (byId.size !== patterns.length) {
    throw new Error("Action pattern registry contains duplicate ids.");
  }
  return {
    patterns,
    byId,
    /** Declaration order within a group is the pre-existing priority chain. */
    ordered: [...patterns].sort((left, right) =>
      right.exclusivity.priority - left.exclusivity.priority
      || patterns.indexOf(left) - patterns.indexOf(right)),
  };
}

export const ACTION_PATTERN_REGISTRY = createActionPatternRegistry();

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

function triggerMatches(pattern, context) {
  if (pattern.trigger.possession !== "either") {
    const possession = context.possession ?? "attacking";
    if (possession !== pattern.trigger.possession) {
      return { ok: false, reason: `possession is "${possession}", pattern wants "${pattern.trigger.possession}"` };
    }
  }
  if (pattern.trigger.teamPhase.length) {
    const phase = context.teamPhase ?? null;
    if (!phase || !pattern.trigger.teamPhase.includes(phase)) {
      return { ok: false, reason: `team phase "${phase}" is not in ${pattern.trigger.teamPhase.join("/")}` };
    }
  }
  const region = pattern.trigger.ballRegion;
  if (region) {
    const ballRegion = context.ballRegion ?? null;
    if (!ballRegion) return { ok: false, reason: "no ball region classified" };
    if (region.lanes.length && !region.lanes.includes(ballRegion.lane)) {
      return { ok: false, reason: `ball lane "${ballRegion.lane}" is not in ${region.lanes.join("/")}` };
    }
    if (region.depthBands.length && !region.depthBands.includes(ballRegion.depthBand)) {
      return { ok: false, reason: `ball band "${ballRegion.depthBand}" is not in ${region.depthBands.join("/")}` };
    }
  }
  return { ok: true, reason: null };
}

/**
 * Evaluates every declared pattern against one world snapshot.
 *
 * `context` supplies the world; `resolvers` supplies the geometry, injected
 * by the caller so the registry never reimplements it:
 *
 *   resolvers.findParticipant(pattern, participant, context, bound)
 *       -> a real entry, or null. This is where the existing spatial
 *          predicates live; the registry only asks the question.
 *   resolvers.deriveTarget(pattern, actorEntry, context, bound)
 *       -> the proposed intention target, from the SAME geometric function
 *          the hard-coded behaviour used.
 *
 * Returns { proposals, rejections, claims }. Proposals are ordered and
 * conflict-free: one job per player, group capacities respected. Rejections
 * carry a reason for every pattern that did not fire, which is what the
 * Match Lab diagnostics panel shows.
 *
 * Consumes no randomness. Mutates nothing.
 */
export function matchActionPatterns(context, resolvers, { registry = ACTION_PATTERN_REGISTRY } = {}) {
  if (!resolvers?.findParticipant) {
    throw new Error("matchActionPatterns() requires resolvers.findParticipant.");
  }
  const proposals = [];
  const rejections = [];
  const claimedPlayers = new Map();
  const groupUsage = new Map();

  for (const pattern of registry.ordered) {
    const triggered = triggerMatches(pattern, context);
    if (!triggered.ok) {
      rejections.push({ patternId: pattern.id, stage: "trigger", reason: triggered.reason });
      continue;
    }
    const group = pattern.exclusivity.group;
    if (group) {
      const capacity = EXCLUSIVITY_CAPACITY[group] ?? 1;
      if ((groupUsage.get(group) ?? 0) >= capacity) {
        rejections.push({
          patternId: pattern.id, stage: "exclusivity",
          reason: `exclusivity group "${group}" is already at its capacity of ${capacity}`,
        });
        continue;
      }
    }

    // Bind abstract slots to real players, in declaration order so a
    // `relativeTo` reference is always already bound.
    const bound = new Map();
    let failure = null;
    for (const participant of pattern.participants) {
      const entry = resolvers.findParticipant(pattern, participant, context, bound);
      if (!entry) {
        if (participant.required) {
          failure = { stage: "participant", reason: `no player satisfies slot "${participant.slot}"` };
          break;
        }
        continue;
      }
      if (claimedPlayers.has(entry.id) && claimedPlayers.get(entry.id).patternId !== pattern.id) {
        failure = {
          stage: "conflict",
          reason: `slot "${participant.slot}" wanted a player already committed to `
            + `"${claimedPlayers.get(entry.id).job}"`,
        };
        break;
      }
      bound.set(participant.slot, entry);
    }
    if (failure) {
      rejections.push({ patternId: pattern.id, ...failure });
      continue;
    }

    const actor = bound.get(pattern.proposal.actor);
    if (!actor) {
      rejections.push({
        patternId: pattern.id, stage: "actor",
        reason: `proposal actor slot "${pattern.proposal.actor}" was not bound`,
      });
      continue;
    }
    const target = resolvers.deriveTarget
      ? resolvers.deriveTarget(pattern, actor, context, bound)
      : null;
    if (pattern.proposal.target.derivation !== "custom" && !target) {
      rejections.push({
        patternId: pattern.id, stage: "target",
        reason: `target derivation "${pattern.proposal.target.derivation}" produced nothing reachable`,
      });
      continue;
    }

    proposals.push({
      patternId: pattern.id,
      job: pattern.proposal.job,
      actorId: actor.id,
      target,
      participants: Object.fromEntries([...bound].map(([slot, entry]) => [slot, entry.id])),
      exclusivityGroup: group,
      priority: pattern.exclusivity.priority,
    });
    claimedPlayers.set(actor.id, { patternId: pattern.id, job: pattern.proposal.job });
    if (group) groupUsage.set(group, (groupUsage.get(group) ?? 0) + 1);
  }

  return {
    proposals,
    rejections,
    claims: Object.fromEntries([...claimedPlayers].map(([id, claim]) => [id, claim.job])),
  };
}

export { DECLARATIONS as ACTION_PATTERN_DECLARATIONS };
