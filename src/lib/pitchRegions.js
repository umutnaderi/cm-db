// Tactical Region Foundation v1 -- a deterministic, DOM-free diagnostic lens
// over the continuous pitch world.
//
// Player and ball `{x, y}` coordinates remain authoritative. These regions do
// not own positions, produce movement targets, or replace the legacy 12-zone
// engine index. In particular, region ids are prefixed strings so they cannot
// be mistaken for a numeric legacy zone.

import {
  PITCH_LENGTH_YARDS,
  PITCH_WIDTH_YARDS,
  attackingGoalYForDirection,
  defendingGoalYForDirection,
  isInsidePenaltyArea,
  toYardPoint,
} from "./pitchGeometry.js";

export const VERTICAL_LANES = Object.freeze([
  "left-touchline",
  "left-half-space",
  "centre",
  "right-half-space",
  "right-touchline",
]);

export const TACTICAL_DEPTH_BANDS = Object.freeze([
  "defensive-box",
  "first-build-up",
  "second-build-up",
  "progression",
  "chance-creation",
  "attacking-box",
]);

// Lane edges preserve teamShape.js's established 16/38/62/84 percent
// contract exactly, expressed here in the canonical 75-yard pitch world.
// The half-spaces sit between the wide channels and the 18-yard-wide central
// corridor. Changing these values is a tactical-model migration, not UI work.
export const LANE_BOUNDARIES_YARDS = Object.freeze([
  0,
  12,
  28.5,
  46.5,
  63,
  PITCH_WIDTH_YARDS,
]);

// Depth is attacking-direction-relative distance from the team's own goal.
// 18yd and 102yd are the two penalty-area edges; 60yd is halfway. The 40yd
// build-up boundary and 84yd progression boundary divide the remaining space
// into stable coaching bands while leaving an 18yd chance-creation band before
// the attacking box. These are classification boundaries only: no coordinate
// is ever snapped to them or to a region centre.
export const DEPTH_BOUNDARIES_YARDS = Object.freeze([
  0,
  18,
  40,
  PITCH_LENGTH_YARDS / 2,
  84,
  PITCH_LENGTH_YARDS - 18,
  PITCH_LENGTH_YARDS,
]);

const REGION_ID_PREFIX = "tactical";
const DEFAULT_LANE_FEATHER_YARDS = 2;
const DEFAULT_BAND_FEATHER_YARDS = 3;
const DEFAULT_LANE_HYSTERESIS_YARDS = 1;
const DEFAULT_BAND_HYSTERESIS_YARDS = 1.5;

function clamp(minimum, maximum, value) {
  return Math.max(minimum, Math.min(maximum, value));
}

function directionOf(attackingDirection) {
  if (attackingDirection !== "up" && attackingDirection !== "down") {
    throw new Error('Tactical regions require attackingDirection "up" or "down".');
  }
  return attackingDirection;
}

function finitePercent(value) {
  const number = Number(value);
  return clamp(0, 100, Number.isFinite(number) ? number : 0);
}

function normalizedPoint(point) {
  return { x: finitePercent(point?.x), y: finitePercent(point?.y) };
}

function progressYards(point, attackingDirection) {
  const direction = directionOf(attackingDirection);
  const y = toYardPoint(normalizedPoint(point)).y;
  return direction === "down" ? y : PITCH_LENGTH_YARDS - y;
}

export function laneForX(xPercent) {
  const x = finitePercent(xPercent);
  // Inclusive comparisons intentionally match the old teamShape helper at
  // the two right-hand boundaries as well as every point between them.
  if (x < 16) return VERTICAL_LANES[0];
  if (x < 38) return VERTICAL_LANES[1];
  if (x <= 62) return VERTICAL_LANES[2];
  if (x <= 84) return VERTICAL_LANES[3];
  return VERTICAL_LANES[4];
}

export function dominantLane(point) {
  return laneForX(point?.x);
}

export function dominantDepthBand(point, attackingDirection) {
  const progress = progressYards(point, attackingDirection);
  for (let index = 1; index < DEPTH_BOUNDARIES_YARDS.length - 1; index += 1) {
    if (progress < DEPTH_BOUNDARIES_YARDS[index]) return TACTICAL_DEPTH_BANDS[index - 1];
  }
  return TACTICAL_DEPTH_BANDS.at(-1);
}

export function tacticalRegionId(lane, depthBand) {
  if (!VERTICAL_LANES.includes(lane)) throw new Error(`Unknown tactical lane: ${lane}`);
  if (!TACTICAL_DEPTH_BANDS.includes(depthBand)) throw new Error(`Unknown tactical depth band: ${depthBand}`);
  return `${REGION_ID_PREFIX}:${lane}:${depthBand}`;
}

function semanticFlags(point, attackingDirection, lane) {
  const direction = directionOf(attackingDirection);
  const ownPenaltyArea = isInsidePenaltyArea(point, defendingGoalYForDirection(direction));
  const attackingPenaltyArea = isInsidePenaltyArea(point, attackingGoalYForDirection(direction));
  return Object.freeze({
    penaltyArea: ownPenaltyArea || attackingPenaltyArea,
    ownPenaltyArea,
    attackingPenaltyArea,
    wideChannel: lane === "left-touchline" || lane === "right-touchline",
    halfSpace: lane === "left-half-space" || lane === "right-half-space",
    centralCorridor: lane === "centre",
  });
}

function regionFromParts(point, attackingDirection, lane, depthBand) {
  const normalized = normalizedPoint(point);
  const direction = directionOf(attackingDirection);
  return Object.freeze({
    id: tacticalRegionId(lane, depthBand),
    lane,
    laneIndex: VERTICAL_LANES.indexOf(lane),
    depthBand,
    depthBandIndex: TACTICAL_DEPTH_BANDS.indexOf(depthBand),
    attackingDirection: direction,
    attackingProgressYards: progressYards(normalized, direction),
    flags: semanticFlags(normalized, direction, lane),
  });
}

export function classifyTacticalRegion(point, attackingDirection) {
  const normalized = normalizedPoint(point);
  return regionFromParts(
    normalized,
    attackingDirection,
    dominantLane(normalized),
    dominantDepthBand(normalized, attackingDirection),
  );
}

export function mirrorTacticalPoint(point) {
  const normalized = normalizedPoint(point);
  return Object.freeze({ x: normalized.x, y: 100 - normalized.y });
}

// Mirrors a named region end-for-end while keeping screen/pitch left and
// right stable. This is useful for formations stored from one end; changing
// only attacking direction at a fixed physical point is handled directly by
// classifyTacticalRegion().
export function mirrorTacticalRegion(regionOrId) {
  const source = typeof regionOrId === "string"
    ? regionOrId.split(":")
    : null;
  const lane = typeof regionOrId === "string" ? source?.[1] : regionOrId?.lane;
  const depthBand = typeof regionOrId === "string" ? source?.[2] : regionOrId?.depthBand;
  const bandIndex = TACTICAL_DEPTH_BANDS.indexOf(depthBand);
  if (!VERTICAL_LANES.includes(lane) || bandIndex < 0) {
    throw new Error("A tactical region id or classification is required for mirroring.");
  }
  const mirroredDepthBand = TACTICAL_DEPTH_BANDS[TACTICAL_DEPTH_BANDS.length - 1 - bandIndex];
  return Object.freeze({
    id: tacticalRegionId(lane, mirroredDepthBand),
    lane,
    depthBand: mirroredDepthBand,
  });
}

function softAxisWeights(value, names, boundaries, featherYards) {
  const feather = Math.max(0, Number(featherYards) || 0);
  let index = names.length - 1;
  for (let cursor = 1; cursor < boundaries.length - 1; cursor += 1) {
    if (value < boundaries[cursor]) { index = cursor - 1; break; }
  }
  if (!feather) return Object.freeze([{ name: names[index], weight: 1 }]);

  let nearestIndex = -1;
  let nearestDistance = Infinity;
  for (let cursor = 1; cursor < boundaries.length - 1; cursor += 1) {
    const distance = Math.abs(value - boundaries[cursor]);
    if (distance < nearestDistance) {
      nearestDistance = distance;
      nearestIndex = cursor;
    }
  }
  if (nearestDistance >= feather) return Object.freeze([{ name: names[index], weight: 1 }]);
  const boundary = boundaries[nearestIndex];
  const rightWeight = clamp(0, 1, 0.5 + (value - boundary) / (2 * feather));
  return Object.freeze([
    { name: names[nearestIndex - 1], weight: 1 - rightWeight },
    { name: names[nearestIndex], weight: rightWeight },
  ].filter((entry) => entry.weight > 0));
}

// Optional feathered membership for diagnostics/learning. Lane and band
// weights are crossed, so the final region weights always sum to one even at
// a two-axis boundary. No RNG, history, or caller state is read.
export function tacticalRegionMembership(point, attackingDirection, {
  laneFeatherYards = DEFAULT_LANE_FEATHER_YARDS,
  bandFeatherYards = DEFAULT_BAND_FEATHER_YARDS,
} = {}) {
  const normalized = normalizedPoint(point);
  const yard = toYardPoint(normalized);
  const laneWeights = softAxisWeights(
    yard.x, VERTICAL_LANES, LANE_BOUNDARIES_YARDS, laneFeatherYards,
  );
  const bandWeights = softAxisWeights(
    progressYards(normalized, attackingDirection),
    TACTICAL_DEPTH_BANDS,
    DEPTH_BOUNDARIES_YARDS,
    bandFeatherYards,
  );
  const regions = laneWeights.flatMap((lane) => bandWeights.map((band) => ({
    id: tacticalRegionId(lane.name, band.name),
    lane: lane.name,
    depthBand: band.name,
    weight: lane.weight * band.weight,
  })));
  const total = regions.reduce((sum, entry) => sum + entry.weight, 0) || 1;
  return Object.freeze({
    laneWeights,
    depthBandWeights: bandWeights,
    regions: Object.freeze(regions.map((entry) => Object.freeze({
      ...entry,
      weight: entry.weight / total,
    }))),
  });
}

function parsedPreviousRegion(previous) {
  if (!previous) return null;
  if (typeof previous === "string") {
    const [prefix, lane, depthBand] = previous.split(":");
    return prefix === REGION_ID_PREFIX ? { lane, depthBand, attackingDirection: null } : null;
  }
  return previous.lane && previous.depthBand ? previous : null;
}

function retainedAxisName(value, previousName, names, boundaries, marginYards) {
  const index = names.indexOf(previousName);
  if (index < 0) return null;
  const margin = Math.max(0, Number(marginYards) || 0);
  const minimum = boundaries[index] - margin;
  const maximum = boundaries[index + 1] + margin;
  return value >= minimum && value <= maximum ? previousName : null;
}

// Schmitt-trigger-style stabilization for consumers sampling live movement.
// A previous lane/band is retained just beyond its edge, then released once
// the configured real-yard margin is crossed. The point itself is never
// changed and the raw classification remains available for inspection.
export function stabilizeTacticalRegion(previous, point, attackingDirection, {
  laneMarginYards = DEFAULT_LANE_HYSTERESIS_YARDS,
  bandMarginYards = DEFAULT_BAND_HYSTERESIS_YARDS,
} = {}) {
  const normalized = normalizedPoint(point);
  const direction = directionOf(attackingDirection);
  const rawRegion = classifyTacticalRegion(normalized, direction);
  const parsed = parsedPreviousRegion(previous);
  if (!parsed || (parsed.attackingDirection && parsed.attackingDirection !== direction)) {
    return Object.freeze({ ...rawRegion, rawRegion, stabilized: false });
  }
  const yard = toYardPoint(normalized);
  const lane = retainedAxisName(
    yard.x, parsed.lane, VERTICAL_LANES, LANE_BOUNDARIES_YARDS, laneMarginYards,
  ) ?? rawRegion.lane;
  const depthBand = retainedAxisName(
    progressYards(normalized, direction), parsed.depthBand,
    TACTICAL_DEPTH_BANDS, DEPTH_BOUNDARIES_YARDS, bandMarginYards,
  ) ?? rawRegion.depthBand;
  const stableRegion = regionFromParts(normalized, direction, lane, depthBand);
  return Object.freeze({
    ...stableRegion,
    rawRegion,
    stabilized: stableRegion.id !== rawRegion.id,
  });
}

