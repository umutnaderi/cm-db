// A deterministic, pitch-scale occupancy map for one authored tactical role.
//
// The map is derived from the same phaseAdjustedShapeTarget() function used
// by live team shape. It is therefore a readable forecast of where the role
// is likely to operate, rather than a separate hand-painted role graphic.

import { roleBand } from "./formationTemplates.js";
import {
  PITCH_LENGTH_YARDS, PITCH_WIDTH_YARDS,
} from "./pitchGeometry.js";
import { phaseAdjustedShapeTarget, phaseAnchorSelectionFor } from "./teamShape.js";

export const ROLE_MAP_COLUMNS = 15;
export const ROLE_MAP_ROWS = 24;
export const ROLE_MAP_CELL_WIDTH_YARDS = PITCH_WIDTH_YARDS / ROLE_MAP_COLUMNS;
export const ROLE_MAP_CELL_LENGTH_YARDS = PITCH_LENGTH_YARDS / ROLE_MAP_ROWS;

const BALL_SAMPLE_POINTS = Object.freeze(
  [12.5, 37.5, 62.5, 87.5].flatMap((y) => [100 / 6, 50, 500 / 6].map((x) => Object.freeze({ x, y }))),
);

const COMPACT_ROLES = new Set([
  "goalkeeper", "line-holding-goalkeeper", "no-nonsense-goalkeeper",
  "no-nonsense-centre-back", "no-nonsense-full-back", "anchor", "half-back",
  "enganche", "poacher",
]);
const ROAMING_ROLES = new Set([
  "sweeper-keeper", "libero", "complete-wing-back", "playmaking-wing-back",
  "box-to-box", "roaming-playmaker", "regista", "segundo-volante", "mezzala",
  "half-winger", "trequartista", "shadow-striker", "raumdeuter",
  "pressing-forward", "channel-forward",
]);
const WIDE_ROLES = new Set([
  "full-back", "wing-back", "complete-wing-back", "defensive-wing-back",
  "wide-midfielder", "winger", "defensive-winger", "wide-target-player",
  "wide-forward", "channel-forward",
]);

function clamp(minimum, maximum, value) {
  return Math.max(minimum, Math.min(maximum, value));
}

function phaseForBall(ballPoint, attackingDirection) {
  const progress = attackingDirection === "up" ? 100 - ballPoint.y : ballPoint.y;
  if (progress < 30) return "build-up";
  if (progress > 70) return "final-third";
  return "progression";
}

function ballZoneFor(point) {
  const column = clamp(0, 2, Math.floor((Number(point?.x) || 0) / (100 / 3)));
  const row = clamp(0, 3, Math.floor((Number(point?.y) || 0) / 25));
  return row * 3 + column;
}

function contextsFor(view, attackingDirection, focusZone = null) {
  const inPossession = BALL_SAMPLE_POINTS.map((ballPoint) => ({
    ballPoint,
    attackingDirection,
    phase: phaseForBall(ballPoint, attackingDirection),
    inPossession: true,
    weight: 1,
  }));
  const outOfPossession = BALL_SAMPLE_POINTS.map((ballPoint) => ({
    ballPoint,
    attackingDirection,
    phase: "defensive-block",
    inPossession: false,
    weight: 0.72,
  }));
  const focused = (entries) => Number.isInteger(focusZone)
    ? entries.filter((entry) => ballZoneFor(entry.ballPoint) === focusZone)
    : entries;
  if (view === "with-ball") return focused(inPossession);
  if (view === "without-ball") {
    return focused(outOfPossession).map((entry) => ({ ...entry, weight: 1 }));
  }
  return [...inPossession, ...outOfPossession];
}

function mapEntry(slot) {
  const band = slot?.band ?? roleBand(slot?.positionalSlot ?? "MC");
  const x = Number(slot?.formationAnchor?.x ?? slot?.x);
  const y = Number(slot?.formationAnchor?.y ?? slot?.y);
  return {
    id: slot?.slotId ?? "role-map",
    team: slot?.team ?? "role-map",
    role: band === "GK" ? "keeper" : "player",
    positionalSlot: slot?.positionalSlot ?? "MC",
    tacticalRole: slot?.tacticalRole ?? null,
    duty: slot?.duty ?? "support",
    formationAnchor: {
      x: Number.isFinite(x) ? x : 50,
      y: Number.isFinite(y) ? y : 50,
    },
    withBallAnchor: slot?.withBallPosition ?? slot?.withBallAnchor ?? null,
    withoutBallAnchor: slot?.withoutBallPosition ?? slot?.withoutBallAnchor ?? null,
    withBallAnchors: slot?.withBallPositions ?? slot?.withBallAnchors ?? {},
    withoutBallAnchors: slot?.withoutBallPositions ?? slot?.withoutBallAnchors ?? {},
  };
}

function mobilityFor(slot) {
  const role = slot?.tacticalRole ?? "";
  const band = slot?.band ?? roleBand(slot?.positionalSlot ?? "MC");
  if (band === "GK") {
    return ROAMING_ROLES.has(role) ? { lateral: 5.5, vertical: 9 } : { lateral: 4.5, vertical: 6.5 };
  }
  let lateral = 6.5;
  let vertical = 9;
  if (COMPACT_ROLES.has(role)) {
    lateral = 5;
    vertical = 7;
  }
  if (WIDE_ROLES.has(role)) {
    lateral = 6.5;
    vertical = 11;
  }
  if (ROAMING_ROLES.has(role)) {
    lateral = 8.5;
    vertical = 13;
  }
  if (slot?.duty === "attack") vertical += 2;
  if (slot?.duty === "defend") vertical = Math.max(6, vertical - 1);
  return { lateral, vertical };
}

function gaussianAt(cell, target, mobility) {
  const dx = (cell.x - target.x) * PITCH_WIDTH_YARDS / 100;
  const dy = (cell.y - target.y) * PITCH_LENGTH_YARDS / 100;
  const exponent = (dx * dx) / (2 * mobility.lateral * mobility.lateral)
    + (dy * dy) / (2 * mobility.vertical * mobility.vertical);
  return Math.exp(-exponent);
}

function meanPoint(points, fallback) {
  if (!points.length) return { ...fallback };
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function authoredAnchorsForView(entry, view) {
  if (view !== "with-ball" && view !== "without-ball") return [];
  const zoned = view === "with-ball" ? entry.withBallAnchors : entry.withoutBallAnchors;
  const broad = view === "with-ball" ? entry.withBallAnchor : entry.withoutBallAnchor;
  const points = [...Object.values(zoned ?? {}), ...(broad ? [broad] : [])]
    .filter((point) => Number.isFinite(Number(point?.x)) && Number.isFinite(Number(point?.y)))
    .map((point) => ({ x: Number(point.x), y: Number(point.y) }));
  const seen = new Set();
  return points.filter((point) => {
    const key = `${point.x.toFixed(4)},${point.y.toFixed(4)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * Builds a 15 x 24 grid: each pixel represents an exact 5 x 5 yard
 * (4.57 x 4.57 metre) patch of the 75 x 120 yard tactics pitch.
 */
export function buildRoleOccupancyMap({
  slot,
  attackingDirection = "up",
  view = "open-play",
  focusZone = null,
  columns = ROLE_MAP_COLUMNS,
  rows = ROLE_MAP_ROWS,
} = {}) {
  const safeColumns = Math.max(3, Math.round(Number(columns) || ROLE_MAP_COLUMNS));
  const safeRows = Math.max(4, Math.round(Number(rows) || ROLE_MAP_ROWS));
  const normalizedView = view === "with-ball" || view === "without-ball" ? view : "open-play";
  const normalizedFocusZone = focusZone != null && Number.isInteger(Number(focusZone))
    && Number(focusZone) >= 0 && Number(focusZone) < 12
    ? Number(focusZone) : null;
  const entry = mapEntry(slot);
  const mobility = mobilityFor(slot);
  const contexts = contextsFor(normalizedView, attackingDirection, normalizedFocusZone);
  const targetSamples = contexts.map((context) => {
    const selection = normalizedView === "open-play"
      ? { point: { ...entry.formationAnchor }, manual: false, source: "formation" }
      : phaseAnchorSelectionFor(entry, context);
    const effectiveEntry = {
      ...entry,
      formationAnchor: selection.point,
      manualPhasePosition: selection.manual,
      tacticalRole: selection.manual ? null : entry.tacticalRole,
      duty: selection.manual ? null : entry.duty,
    };
    return {
      ...phaseAdjustedShapeTarget(effectiveEntry, context),
      weight: context.weight,
      phase: context.phase,
      inPossession: context.inPossession,
      manual: selection.manual,
      anchor: selection.point,
    };
  });
  const activeManualAnchors = targetSamples.filter((target) => target.manual).map((target) => target.anchor);
  const manualAnchors = authoredAnchorsForView(entry, normalizedView);
  const referenceAnchor = normalizedView === "open-play"
    ? { ...entry.formationAnchor }
    : meanPoint(
      activeManualAnchors.length
        ? activeManualAnchors
        : normalizedFocusZone == null && manualAnchors.length
          ? manualAnchors
          : targetSamples.map((target) => target.anchor),
      entry.formationAnchor,
    );
  const targetWeight = targetSamples.reduce((sum, target) => sum + target.weight, 0) || 1;
  const anchorWeight = slot?.duty === "support"
    ? Math.max(3, targetWeight * 1.35)
    : Math.max(1.8, targetWeight * 0.62);
  // The compact core keeps the most opaque pixel at the authored rectangle,
  // especially for support duty. The live target cloud remains as a softer
  // tail that shows the role's movement around that reference position.
  const targets = [
    ...targetSamples,
    ...manualAnchors
      .filter((point) => Math.abs(point.x - referenceAnchor.x) > 1e-6
        || Math.abs(point.y - referenceAnchor.y) > 1e-6)
      .map((point) => ({ ...point, anchor: point, weight: 0.35, manualTrail: true })),
    {
      ...referenceAnchor,
      anchor: referenceAnchor,
      weight: anchorWeight,
      core: true,
      manual: activeManualAnchors.length > 0,
    },
  ];
  const coreMobility = slot?.duty === "support"
    ? { lateral: 3.8, vertical: 5.2 }
    : { lateral: 4.6, vertical: 6.4 };
  const rawCells = [];
  let maximum = 0;
  for (let row = 0; row < safeRows; row += 1) {
    for (let column = 0; column < safeColumns; column += 1) {
      const cell = {
        column,
        row,
        x: (column + 0.5) / safeColumns * 100,
        y: (row + 0.5) / safeRows * 100,
      };
      const score = targets.reduce(
        (sum, target) => sum + target.weight * gaussianAt(
          cell, target, target.core ? coreMobility : mobility,
        ),
        0,
      );
      maximum = Math.max(maximum, score);
      rawCells.push({ ...cell, score });
    }
  }
  const cells = rawCells.map((cell) => {
    const intensity = maximum > 0 ? clamp(0, 1, cell.score / maximum) : 0;
    return {
      ...cell,
      intensity,
      level: intensity < 0.09 ? 0 : Math.max(1, Math.ceil(intensity * 6)),
    };
  });
  const weighted = cells.reduce((sum, cell) => sum + cell.intensity, 0) || 1;
  return {
    columns: safeColumns,
    rows: safeRows,
    cellWidthYards: PITCH_WIDTH_YARDS / safeColumns,
    cellLengthYards: PITCH_LENGTH_YARDS / safeRows,
    cells,
    targets,
    anchor: referenceAnchor,
    manual: activeManualAnchors.length > 0,
    manualAnchorAverage: manualAnchors.length ? meanPoint(manualAnchors, referenceAnchor) : null,
    manualAnchorCount: manualAnchors.length,
    activeCells: cells.filter((cell) => cell.level > 0).length,
    centroid: {
      x: cells.reduce((sum, cell) => sum + cell.x * cell.intensity, 0) / weighted,
      y: cells.reduce((sum, cell) => sum + cell.y * cell.intensity, 0) / weighted,
    },
  };
}
