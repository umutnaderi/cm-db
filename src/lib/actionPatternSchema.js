// Action Pattern Schema v1 -- the declaration format for reusable off-ball
// pattern fragments, and nothing else.
//
// Pure, DOM-free, data-only. This module validates, normalizes and mirrors
// declarations. It does not match them against a world, does not choose
// participants, and does not know what a resolver is. Matching lives in
// actionPatternRegistry.js; geometry stays in spatialDecision.js; movement
// stays in worldMotion.js.
//
// ---------------------------------------------------------------------------
// Four words that are NOT synonyms
// ---------------------------------------------------------------------------
//
//   observation  A single authored reading of a real passage of play -- one
//                frame set, annotated. Evidence. Lives in a frame-annotation
//                file, never in the runtime.
//   primitive    The small reusable action an observation was distilled
//                into: "arc-overlap", "support-short". A vocabulary word.
//   pattern      A declaration that says WHEN a primitive is worth
//                proposing, WHO fills each abstract slot, and what job it
//                proposes. Composed of fragments; several may fire at once.
//   intention    What the engine actually adopts for one player this beat.
//                Produced by the registry, consumed by the motion layer.
//
// A pattern is never a scripted sequence, never an animation, never a
// predetermined outcome, never a list of absolute coordinates, and never
// tied to a named player. It PROPOSES. The existing spatial, team-shape,
// motion, ball and resolver systems remain authoritative about whether the
// proposal is taken and what happens next.
//
// The prohibition that matters most: a pattern may not write a roster
// coordinate, a ball position, or a playback event. It returns a proposed
// job and a target-derivation request. Nothing else.

import { TACTICAL_DEPTH_BANDS, VERTICAL_LANES } from "./pitchRegions.js";
import { TEAM_PHASES } from "./teamPhase.js";

export const ACTION_PATTERN_SCHEMA_VERSION = 1;

/**
 * Abstract participant slots. A declaration names roles in a passage of
 * play, never a person -- "wideRunner", never "Cafu". Adding a slot here is
 * a deliberate vocabulary change; a declaration referencing an unknown slot
 * is rejected rather than silently ignored.
 */
export const PARTICIPANT_SLOTS = Object.freeze([
  "ballOwner",
  "passer",
  "receiver",
  "supportPlayer",
  "wideRunner",
  "insideRunner",
  "depthRunner",
  "pocketOccupant",
  "markedAttacker",
  "coverDefender",
  "marker",
  "presser",
  "restDefender",
  "aerialTarget",
  "secondBallPlayer",
]);

/**
 * How a participant is defined relative to the ball or another participant.
 * These are RELATIONSHIPS, not positions: "the player being marked" is a
 * relationship the world answers, not a coordinate the pattern asserts.
 */
export const PARTICIPANT_RELATIONS = Object.freeze([
  "ball-owner",
  "teammate-of-ball-owner",
  "opponent-of-ball-owner",
  "passer",
  "intended-receiver",
  "marker-of",
  "marked-by",
  "nearest-to-ball",
  "any-teammate",
  "any-opponent",
]);

/**
 * Spatial requirement kinds. Each names a geometric QUESTION the world
 * answers with real continuous coordinates -- never a region centre used as
 * a destination. `pitchRegions.js` supplies the tactical vocabulary for
 * *classifying* where something is; it never supplies a target.
 */
export const SPATIAL_REQUIREMENT_KINDS = Object.freeze([
  "none",
  "in-cone-ahead-of-ball",
  "within-yards-of-ball",
  "beyond-yards-from-ball",
  "opposite-lane-to-ball",
  "same-lane-as-ball",
  "in-region",
  "marked-within-yards",
  "unmarked-within-yards",
  "ahead-of-ball",
  "behind-ball",
  // Dynamic Ball Claim v2 -- "can this player actually get to the ball
  // before it stops or goes out?" A question about a moving ball and a real
  // acceleration curve, which none of the static distance kinds above can
  // express.
  "can-reach-rolling-ball",
]);

/**
 * Target derivations a proposal may request. The registry never computes a
 * coordinate itself: it names the derivation and the caller supplies the
 * real geometric function, which is the one already used by the existing
 * hard-coded behaviour. That is what makes migration provable rather than
 * a rewrite.
 */
export const TARGET_DERIVATIONS = Object.freeze([
  "perpendicular-push-from-ball-cone",
  "forward-in-own-channel",
  "find-space-for-attack",
  "hold-width",
  "support-short-of-ball",
  "run-off-pass-from-destination",
  "pin-last-line",
  "rest-defence-anchor",
  // Dynamic Ball Claim v2 -- the point on a rolling ball s own real
  // decelerating path where this player genuinely meets it. Derived from
  // ballRollPhysics.js and the player s own kinetics; never a region centre,
  // never the ball s current position, never an authored coordinate.
  "intercept-rolling-ball",
  "custom",
]);

// "loose" is a real third state, not a shade of the other two: nobody owns
// the ball, so "attacking"/"defending" have no referent to be relative to.
export const POSSESSION_STATES = Object.freeze(["attacking", "defending", "loose", "either"]);

/** Deep-frozen structured clone, so a declaration cannot be mutated later. */
function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function validateTrigger(trigger, errors, path) {
  if (trigger === undefined || trigger === null) return;
  if (!isPlainObject(trigger)) { errors.push(`${path} must be an object`); return; }
  if (trigger.possession !== undefined && !POSSESSION_STATES.includes(trigger.possession)) {
    errors.push(`${path}.possession "${trigger.possession}" is not one of ${POSSESSION_STATES.join(", ")}`);
  }
  for (const phase of asArray(trigger.teamPhase)) {
    if (!TEAM_PHASES.includes(phase)) errors.push(`${path}.teamPhase "${phase}" is not a known team phase`);
  }
  const region = trigger.ballRegion;
  if (region !== undefined && region !== null) {
    if (!isPlainObject(region)) { errors.push(`${path}.ballRegion must be an object`); return; }
    for (const lane of asArray(region.lanes)) {
      if (!VERTICAL_LANES.includes(lane)) errors.push(`${path}.ballRegion.lanes "${lane}" is not a known lane`);
    }
    for (const band of asArray(region.depthBands)) {
      if (!TACTICAL_DEPTH_BANDS.includes(band)) {
        errors.push(`${path}.ballRegion.depthBands "${band}" is not a known depth band`);
      }
    }
  }
}

function validateSpatial(spatial, errors, path) {
  if (spatial === undefined || spatial === null) return;
  if (!isPlainObject(spatial)) { errors.push(`${path} must be an object`); return; }
  if (!SPATIAL_REQUIREMENT_KINDS.includes(spatial.kind)) {
    errors.push(`${path}.kind "${spatial.kind}" is not a known spatial requirement`);
  }
  for (const key of ["aheadYards", "radiusYards", "withinYards", "beyondYards"]) {
    if (spatial[key] !== undefined && finiteOrNull(spatial[key]) === null) {
      errors.push(`${path}.${key} must be a finite number`);
    }
  }
  for (const lane of asArray(spatial.lanes)) {
    if (!VERTICAL_LANES.includes(lane)) errors.push(`${path}.lanes "${lane}" is not a known lane`);
  }
  for (const band of asArray(spatial.depthBands)) {
    if (!TACTICAL_DEPTH_BANDS.includes(band)) errors.push(`${path}.depthBands "${band}" is not a known depth band`);
  }
}

function validateParticipant(participant, index, declaredSlots, errors) {
  const path = `participants[${index}]`;
  if (!isPlainObject(participant)) { errors.push(`${path} must be an object`); return; }
  if (!PARTICIPANT_SLOTS.includes(participant.slot)) {
    errors.push(`${path}.slot "${participant.slot}" is not a known participant slot`);
  }
  if (declaredSlots.has(participant.slot)) {
    errors.push(`${path}.slot "${participant.slot}" is declared twice in one pattern`);
  }
  declaredSlots.add(participant.slot);
  if (participant.relation !== undefined && !PARTICIPANT_RELATIONS.includes(participant.relation)) {
    errors.push(`${path}.relation "${participant.relation}" is not a known relation`);
  }
  // A relation naming another participant must name one this pattern
  // actually declares -- a dangling reference is a declaration bug, not a
  // runtime miss.
  if (participant.relativeTo !== undefined) {
    if (!PARTICIPANT_SLOTS.includes(participant.relativeTo)) {
      errors.push(`${path}.relativeTo "${participant.relativeTo}" is not a known participant slot`);
    }
  }
  const eligibility = participant.eligibility;
  if (eligibility !== undefined && eligibility !== null) {
    if (!isPlainObject(eligibility)) errors.push(`${path}.eligibility must be an object`);
    else {
      for (const band of asArray(eligibility.bands)) {
        if (!["GK", "D", "M", "F"].includes(band)) {
          errors.push(`${path}.eligibility.bands "${band}" is not a known band`);
        }
      }
    }
  }
  validateSpatial(participant.spatial, errors, path);
}

function validateProposal(proposal, declaredSlots, errors) {
  if (!isPlainObject(proposal)) { errors.push("proposal must be an object"); return; }
  if (typeof proposal.job !== "string" || !proposal.job) {
    errors.push("proposal.job must be a non-empty job name");
  }
  if (proposal.actor !== undefined && !declaredSlots.has(proposal.actor)) {
    errors.push(`proposal.actor "${proposal.actor}" is not a participant this pattern declares`);
  }
  const target = proposal.target;
  if (target !== undefined && target !== null) {
    if (!isPlainObject(target)) { errors.push("proposal.target must be an object"); return; }
    if (!TARGET_DERIVATIONS.includes(target.derivation)) {
      errors.push(`proposal.target.derivation "${target.derivation}" is not a known derivation`);
    }
    for (const [key, value] of Object.entries(target.parameters ?? {})) {
      if (typeof value !== "number" && typeof value !== "string" && typeof value !== "boolean") {
        errors.push(`proposal.target.parameters.${key} must be a number, string or boolean`);
      }
    }
  }
}

/**
 * Validates one declaration. Returns { valid, errors } -- every problem at
 * once, named by path, so a bad declaration is fixable in one pass rather
 * than one error at a time.
 */
export function validateActionPattern(declaration) {
  const errors = [];
  if (!isPlainObject(declaration)) return { valid: false, errors: ["declaration must be an object"] };
  if (typeof declaration.id !== "string" || !/^pattern:[a-z0-9-]+@\d+$/.test(declaration.id)) {
    errors.push('id must look like "pattern:<name>@<version>"');
  }
  if (!Number.isInteger(declaration.version) || declaration.version < 1) {
    errors.push("version must be a positive integer");
  }
  if (declaration.id && Number.isInteger(declaration.version)) {
    const suffix = `@${declaration.version}`;
    if (!declaration.id.endsWith(suffix)) errors.push(`id must end with ${suffix} to match version`);
  }
  if (typeof declaration.name !== "string" || !declaration.name) errors.push("name must be a non-empty string");

  validateTrigger(declaration.trigger, errors, "trigger");

  const participants = declaration.participants;
  if (!Array.isArray(participants) || !participants.length) {
    errors.push("participants must be a non-empty array");
  } else {
    const declaredSlots = new Set();
    participants.forEach((participant, index) => validateParticipant(participant, index, declaredSlots, errors));
    // relativeTo must point at a slot declared BEFORE it, so resolution
    // order is always well defined and never circular.
    const order = participants.map((participant) => participant?.slot);
    participants.forEach((participant, index) => {
      if (participant?.relativeTo === undefined) return;
      const referenced = order.indexOf(participant.relativeTo);
      if (referenced < 0) {
        errors.push(`participants[${index}].relativeTo "${participant.relativeTo}" is not declared by this pattern`);
      } else if (referenced >= index) {
        errors.push(`participants[${index}].relativeTo "${participant.relativeTo}" must be declared earlier`);
      }
    });
    validateProposal(declaration.proposal, declaredSlots, errors);
  }

  const limits = declaration.limits;
  if (limits !== undefined && limits !== null) {
    if (!isPlainObject(limits)) errors.push("limits must be an object");
    else if (limits.maxParticipants !== undefined
      && (!Number.isInteger(limits.maxParticipants) || limits.maxParticipants < 1)) {
      errors.push("limits.maxParticipants must be a positive integer");
    }
  }
  const exclusivity = declaration.exclusivity;
  if (exclusivity !== undefined && exclusivity !== null) {
    if (!isPlainObject(exclusivity)) errors.push("exclusivity must be an object");
    else {
      // null is meaningful and allowed: it says "this pattern belongs to no
      // exclusivity group", which is exactly run-off-pass's case -- it was
      // always a separate, always-eligible job outside the special-run cap.
      if (exclusivity.group !== undefined && exclusivity.group !== null
        && typeof exclusivity.group !== "string") {
        errors.push("exclusivity.group must be a string or null");
      }
      if (exclusivity.priority !== undefined && finiteOrNull(exclusivity.priority) === null) {
        errors.push("exclusivity.priority must be a finite number");
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

// ---------------------------------------------------------------------------
// Normalization
// ---------------------------------------------------------------------------

/**
 * Fills every optional field with its explicit default and freezes the
 * result, so the matcher never has to ask "was this omitted or false?".
 * Throws on an invalid declaration: a registry built from bad data should
 * fail loudly at load, not silently propose nothing at run time.
 */
export function normalizeActionPattern(declaration) {
  const { valid, errors } = validateActionPattern(declaration);
  if (!valid) {
    throw new Error(`Invalid action pattern ${declaration?.id ?? "(unknown)"}: ${errors.join("; ")}`);
  }
  const trigger = declaration.trigger ?? {};
  const region = trigger.ballRegion ?? null;
  return deepFreeze({
    schemaVersion: ACTION_PATTERN_SCHEMA_VERSION,
    id: declaration.id,
    version: declaration.version,
    name: declaration.name,
    description: declaration.description ?? "",
    trigger: {
      possession: trigger.possession ?? "attacking",
      teamPhase: asArray(trigger.teamPhase),
      ballRegion: region
        ? { lanes: asArray(region.lanes), depthBands: asArray(region.depthBands) }
        : null,
    },
    participants: declaration.participants.map((participant) => ({
      slot: participant.slot,
      relation: participant.relation ?? "any-teammate",
      relativeTo: participant.relativeTo ?? null,
      required: participant.required !== false,
      eligibility: {
        bands: asArray(participant.eligibility?.bands),
        positionalSlots: asArray(participant.eligibility?.positionalSlots),
        tacticalRoles: asArray(participant.eligibility?.tacticalRoles),
        duties: asArray(participant.eligibility?.duties),
      },
      spatial: participant.spatial
        ? {
            kind: participant.spatial.kind,
            aheadYards: finiteOrNull(participant.spatial.aheadYards),
            radiusYards: finiteOrNull(participant.spatial.radiusYards),
            withinYards: finiteOrNull(participant.spatial.withinYards),
            beyondYards: finiteOrNull(participant.spatial.beyondYards),
            lanes: asArray(participant.spatial.lanes),
            depthBands: asArray(participant.spatial.depthBands),
          }
        : { kind: "none", aheadYards: null, radiusYards: null, withinYards: null, beyondYards: null, lanes: [], depthBands: [] },
    })),
    proposal: {
      job: declaration.proposal.job,
      actor: declaration.proposal.actor ?? declaration.participants.at(-1).slot,
      target: declaration.proposal.target
        ? {
            derivation: declaration.proposal.target.derivation,
            parameters: { ...(declaration.proposal.target.parameters ?? {}) },
          }
        : { derivation: "custom", parameters: {} },
    },
    limits: { maxParticipants: declaration.limits?.maxParticipants ?? 1 },
    exclusivity: {
      group: declaration.exclusivity?.group ?? null,
      priority: finiteOrNull(declaration.exclusivity?.priority) ?? 0,
    },
    // When the proposal stops being worth holding. Advisory metadata for the
    // caller's own re-evaluation; the schema does not enforce it.
    reevaluate: {
      on: asArray(declaration.reevaluate?.on),
      terminateOn: asArray(declaration.reevaluate?.terminateOn),
    },
    // Development traceability ONLY. Never read at run time, never used to
    // choose anything. No copyrighted media -- a citation, not an asset.
    source: declaration.source
      ? {
          reference: declaration.source.reference ?? null,
          note: declaration.source.note ?? "",
          confidence: finiteOrNull(declaration.source.confidence),
        }
      : null,
  });
}

// ---------------------------------------------------------------------------
// Mirroring
// ---------------------------------------------------------------------------

const MIRRORED_LANE = Object.freeze({
  "left-touchline": "right-touchline",
  "left-half-space": "right-half-space",
  centre: "centre",
  "right-half-space": "left-half-space",
  "right-touchline": "left-touchline",
});

/**
 * Mirrors a declaration across the pitch's long axis.
 *
 * Lanes swap; depth bands do NOT, because a depth band is already expressed
 * relative to the team's own goal and is therefore direction-independent.
 * Distances, angles and yard parameters are unchanged: mirroring is a
 * reflection, not a rescale. A pattern authored for one flank therefore
 * describes the other flank exactly, with no second declaration to drift.
 */
export function mirrorActionPattern(pattern) {
  const mirrorLanes = (lanes) => lanes.map((lane) => MIRRORED_LANE[lane] ?? lane);
  return deepFreeze({
    ...pattern,
    id: pattern.id,
    trigger: {
      ...pattern.trigger,
      ballRegion: pattern.trigger.ballRegion
        ? {
            lanes: mirrorLanes(pattern.trigger.ballRegion.lanes),
            depthBands: [...pattern.trigger.ballRegion.depthBands],
          }
        : null,
    },
    participants: pattern.participants.map((participant) => ({
      ...participant,
      eligibility: { ...participant.eligibility },
      spatial: { ...participant.spatial, lanes: mirrorLanes(participant.spatial.lanes) },
    })),
    proposal: { ...pattern.proposal, parameters: undefined, target: { ...pattern.proposal.target } },
    mirrored: !pattern.mirrored,
  });
}

// ---------------------------------------------------------------------------
// Frame annotations
// ---------------------------------------------------------------------------

export const FRAME_ANNOTATION_SCHEMA_VERSION = 1;

/**
 * Validates one frame-annotation document -- the JSON-compatible format a
 * real passage of play is authored into before any pattern is written.
 *
 * An annotation is EVIDENCE. `observationTime` records when in the passage
 * something was seen so two observations can be ordered; it is explicitly
 * not an instruction to reproduce the clip's timing, and nothing at run
 * time reads it. `primitive` is the reusable vocabulary word the observer
 * concluded, which is the only field the registry cares about.
 */
export function validateFrameAnnotation(document) {
  const errors = [];
  if (!isPlainObject(document)) return { valid: false, errors: ["annotation must be an object"] };
  if (document.schemaVersion !== FRAME_ANNOTATION_SCHEMA_VERSION) {
    errors.push(`schemaVersion must be ${FRAME_ANNOTATION_SCHEMA_VERSION}`);
  }
  if (typeof document.id !== "string" || !document.id) errors.push("id must be a non-empty string");
  if (!["up", "down"].includes(document.attackingDirection)) {
    errors.push('attackingDirection must be "up" or "down"');
  }
  const ball = document.ball;
  if (!isPlainObject(ball)) errors.push("ball must be an object");
  else {
    if (ball.state !== undefined && typeof ball.state !== "string") errors.push("ball.state must be a string");
    for (const lane of asArray(ball.lanes)) {
      if (!VERTICAL_LANES.includes(lane)) errors.push(`ball.lanes "${lane}" is not a known lane`);
    }
    for (const band of asArray(ball.depthBands)) {
      if (!TACTICAL_DEPTH_BANDS.includes(band)) errors.push(`ball.depthBands "${band}" is not a known depth band`);
    }
  }
  const observations = document.observations;
  if (!Array.isArray(observations) || !observations.length) {
    errors.push("observations must be a non-empty array");
  } else {
    observations.forEach((observation, index) => {
      const path = `observations[${index}]`;
      if (!isPlainObject(observation)) { errors.push(`${path} must be an object`); return; }
      if (!PARTICIPANT_SLOTS.includes(observation.label)) {
        errors.push(`${path}.label "${observation.label}" is not an abstract participant slot`);
      }
      if (observation.player !== undefined) {
        errors.push(`${path}.player is not allowed -- annotations name abstract slots, never players`);
      }
      if (typeof observation.primitive !== "string" || !observation.primitive) {
        errors.push(`${path}.primitive must name the reusable primitive inferred`);
      }
      if (observation.observationTime !== undefined && finiteOrNull(observation.observationTime) === null) {
        errors.push(`${path}.observationTime must be a finite number when present`);
      }
      if (observation.confidence !== undefined) {
        const confidence = finiteOrNull(observation.confidence);
        if (confidence === null || confidence < 0 || confidence > 1) {
          errors.push(`${path}.confidence must be between 0 and 1`);
        }
      }
      for (const relationship of asArray(observation.relationships)) {
        if (!PARTICIPANT_RELATIONS.includes(relationship?.relation)) {
          errors.push(`${path}.relationships relation "${relationship?.relation}" is not known`);
        }
        if (relationship?.to !== undefined && !PARTICIPANT_SLOTS.includes(relationship.to)) {
          errors.push(`${path}.relationships.to "${relationship?.to}" is not an abstract slot`);
        }
      }
      if (observation.coordinates !== undefined) {
        errors.push(`${path}.coordinates is not allowed -- an annotation records relationships, not absolute positions`);
      }
    });
  }
  if (document.media !== undefined) {
    errors.push("media is not allowed -- store an authored reference, never an embedded image or video");
  }
  return { valid: errors.length === 0, errors };
}

/** Normalizes an annotation, filling defaults and freezing it. */
export function normalizeFrameAnnotation(document) {
  const { valid, errors } = validateFrameAnnotation(document);
  if (!valid) throw new Error(`Invalid frame annotation ${document?.id ?? "(unknown)"}: ${errors.join("; ")}`);
  return deepFreeze({
    schemaVersion: FRAME_ANNOTATION_SCHEMA_VERSION,
    id: document.id,
    name: document.name ?? document.id,
    attackingDirection: document.attackingDirection,
    ball: {
      state: document.ball.state ?? "in-play",
      lanes: asArray(document.ball.lanes),
      depthBands: asArray(document.ball.depthBands),
    },
    observations: document.observations.map((observation) => ({
      label: observation.label,
      primitive: observation.primitive,
      trigger: observation.trigger ?? null,
      intention: observation.intention ?? observation.primitive,
      relationships: asArray(observation.relationships).map((relationship) => ({
        relation: relationship.relation,
        to: relationship.to ?? null,
      })),
      evidence: asArray(observation.evidence),
      observationTime: finiteOrNull(observation.observationTime),
      confidence: finiteOrNull(observation.confidence) ?? 1,
    })),
    source: document.source
      ? { reference: document.source.reference ?? null, note: document.source.note ?? "" }
      : null,
  });
}

/** Round-trips an annotation through JSON without losing meaning. */
export function frameAnnotationToJson(annotation) {
  return JSON.parse(JSON.stringify(annotation));
}

export { deepFreeze as freezeDeeply };
