// Formation templates and the slot-coordinate model.
//
// Extracted verbatim from draft-setup.js (2026-09-04) so Draft's setup
// screen and Match Lab place players from ONE definition. Pure data plus
// pure functions: no DOM, no module state, no imports. Everything that
// used to read draft-setup.js's `state.formation` / `state.style` now
// takes them as arguments.
//
// ---------------------------------------------------------------------------
// The slot model
// ---------------------------------------------------------------------------
//
// A slot is a POSITIONAL SLOT -- where a shirt stands in the shape. It is
// deliberately NOT the same thing as a tactical role or a duty (see
// matchSetup.js, which keeps all three as separate fields):
//
//   role         The slot's declared position ("DC", "MC", "AMR").
//   x            Lateral position, 0-100 percent of pitch width.
//   y            Depth, 0-100 percent of pitch length. Derived from the
//                role's own band (PITCH_ROWS) unless authored explicitly.
//   styleRoles   Per-style overrides: the same slot reads as DMC in a
//                Defensive shape and AMC in an Attacking one.
//   flexible     The slot has no fixed band at all -- its role prefix comes
//                from the style (STYLE_ROLE_PREFIX) and its side from the
//                declared role's own suffix.
//
// Coordinates here are authored in the DRAFT SETUP frame, which draws the
// team attacking "up" the page (y=94 is its own goal, y=14 the opponent's).
// projectFormation()/mirrorSlots() below convert to a given attacking
// direction rather than every caller re-deriving it.

export const PITCH_ROWS = Object.freeze({
  F: 14,
  AM: 30,
  M: 46,
  DM: 62,
  WB: 68,
  D: 78,
  SW: 86,
  GK: 94,
});

export const STYLE_ROLE_PREFIX = Object.freeze({
  Defensive: "DM",
  Balanced: "M",
  Attacking: "AM",
});

export const FORMATION_STYLES = Object.freeze(["Defensive", "Balanced", "Attacking"]);

function slot(role, x, options = {}) {
  return { role, x, ...options };
}

export const FORMATION_TEMPLATES = {
  "4-3-3": [
    slot("GK", 50),
    slot("DL", 17),
    slot("DC", 39),
    slot("DC", 61),
    slot("DR", 83),
    slot("MC", 28, {
      styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "MC" },
    }),
    slot("MC", 50, {
      styleRoles: { Defensive: "MC", Balanced: "MC", Attacking: "AMC" },
    }),
    slot("MC", 74, {
      styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "MC" },
    }),
    slot("FL", 17),
    slot("FC", 50),
    slot("FR", 83),
  ],
  "4-4-2": [
    slot("GK", 50),
    slot("DL", 17),
    slot("DC", 39),
    slot("DC", 61),
    slot("DR", 83),
    slot("ML", 17, {
      styleRoles: { Defensive: "ML", Balanced: "ML", Attacking: "AML" },
    }),
    slot("MC", 40, {
      styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "MC" },
    }),
    slot("MC", 60, {
      styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "MC" },
    }),
    slot("MR", 83, {
      styleRoles: { Defensive: "MR", Balanced: "MR", Attacking: "AMR" },
    }),
    slot("FC", 39),
    slot("FC", 61),
  ],
  "4-2-3-1": [
    slot("GK", 50),
    slot("DL", 17),
    slot("DC", 39),
    slot("DC", 61),
    slot("DR", 83),
    slot("DMC", 39),
    slot("DMC", 61, {
      styleRoles: { Defensive: "DMC", Balanced: "DMC", Attacking: "MC" },
    }),
    slot("AML", 17, {
      styleRoles: { Defensive: "ML", Balanced: "ML", Attacking: "AML" },
    }),
    slot("AMC", 50, {
      styleRoles: { Defensive: "MC", Balanced: "AMC", Attacking: "AMC" },
    }),
    slot("AMR", 83, {
      styleRoles: { Defensive: "MR", Balanced: "MR", Attacking: "AMR" },
    }),
    slot("FC", 50),
  ],
  "4-1-2-1-2": [
    slot("GK", 50),
    slot("DL", 17),
    slot("DC", 39),
    slot("DC", 61),
    slot("DR", 83),
    slot("DMC", 50),
    slot("MC", 34, { flexible: true }),
    slot("MC", 66, { flexible: true }),
    slot("AMC", 50),
    slot("FC", 39),
    slot("FC", 61),
  ],
  "4-2-2-2": [
    slot("GK", 50),
    slot("DL", 17),
    slot("DC", 39),
    slot("DC", 61),
    slot("DR", 83),
    slot("DMC", 39, {
      styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "MC" },
    }),
    slot("DMC", 61, {
      styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "MC" },
    }),
    slot("AML", 25, {
      styleRoles: { Defensive: "ML", Balanced: "AML", Attacking: "FL" },
    }),
    slot("AMR", 75, {
      styleRoles: { Defensive: "MR", Balanced: "AMR", Attacking: "FR" },
    }),
    slot("FC", 39),
    slot("FC", 61),
  ],
  "4-5-1": [
    slot("GK", 50),
    slot("DL", 17),
    slot("DC", 39),
    slot("DC", 61),
    slot("DR", 83),
    slot("ML", 14),
    slot("MC", 32),
    slot("MC", 50, {
      styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "AMC" },
    }),
    slot("MC", 68),
    slot("MR", 86),
    slot("FC", 50),
  ],
  "3-5-2": [
    slot("GK", 50),
    slot("DC", 28),
    slot("DC", 50),
    slot("DC", 72),
    slot("ML", 10),
    slot("MC", 35),
    slot("MC", 50, {
      styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "AMC" },
    }),
    slot("MC", 65),
    slot("MR", 90),
    slot("FC", 39),
    slot("FC", 61),
  ],
  "3-4-1-2": [
    slot("GK", 50),
    slot("DC", 28),
    slot("DC", 50),
    slot("DC", 72),
    slot("ML", 15, {
      styleRoles: { Defensive: "ML", Balanced: "ML", Attacking: "AML" },
    }),
    slot("MC", 40, {
      styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "MC" },
    }),
    slot("MC", 60, {
      styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "MC" },
    }),
    slot("MR", 85, {
      styleRoles: { Defensive: "MR", Balanced: "MR", Attacking: "AMR" },
    }),
    slot("AMC", 50),
    slot("FC", 39),
    slot("FC", 61),
  ],
  "3-4-3": [
    slot("GK", 50),
    slot("DC", 28),
    slot("DC", 50),
    slot("DC", 72),
    slot("ML", 15),
    slot("MC", 40, {
      styleRoles: { Defensive: "DMC", Balanced: "MC", Attacking: "MC" },
    }),
    slot("MC", 60, {
      styleRoles: { Defensive: "MC", Balanced: "MC", Attacking: "AMC" },
    }),
    slot("MR", 85),
    slot("FL", 17),
    slot("FC", 50),
    slot("FR", 83),
  ],
  "5-2-1-2": [
    slot("GK", 50),
    slot("WBL", 8),
    slot("DC", 31),
    slot("DC", 50),
    slot("DC", 69),
    slot("WBR", 92),
    slot("MC", 39, { flexible: true }),
    slot("MC", 61, { flexible: true }),
    slot("AMC", 50),
    slot("FC", 39),
    slot("FC", 61),
  ],
  "5-2-3": [
    slot("GK", 50),
    slot("WBL", 8),
    slot("DC", 31),
    slot("DC", 50),
    slot("DC", 69),
    slot("WBR", 92),
    slot("MC", 39, { flexible: true }),
    slot("MC", 61, { flexible: true }),
    slot("FL", 17),
    slot("FC", 50),
    slot("FR", 83),
  ],
  "5-3-2": [
    slot("GK", 50),
    slot("WBL", 8),
    slot("DC", 31),
    slot("DC", 50),
    slot("DC", 69),
    slot("WBR", 92),
    slot("MC", 30, { flexible: true }),
    slot("MC", 50, { flexible: true }),
    slot("MC", 70, { flexible: true }),
    slot("FC", 39),
    slot("FC", 61),
  ],
};

export const FORMATION_NAMES = Object.freeze(Object.keys(FORMATION_TEMPLATES));

export function rolePrefix(role) {
  return (
    ["GK", "SW", "WB", "DM", "AM", "D", "M", "F"].find((prefix) => role.startsWith(prefix))
    || role
  );
}

export function pitchRow(role) {
  if (role === "FL" || role === "FR") return 18;
  return PITCH_ROWS[rolePrefix(role)] || 50;
}

/** The role a slot actually reads as under a given style. */
export function effectiveRole(item, style) {
  if (item.styleRoles) return item.styleRoles[style] || item.role;
  if (!item.flexible) return item.role;
  const side = item.role.endsWith("L") ? "L" : item.role.endsWith("R") ? "R" : "C";
  return `${STYLE_ROLE_PREFIX[style]}${side}`;
}

function averageRounded(values) {
  return values.length
    ? Math.round(values.reduce((total, value) => total + value, 0) / values.length)
    : 0;
}

/**
 * The resolved slots for a formation under a style: ids, effective roles
 * and coordinates. Byte-for-byte what draft-setup.js's own currentSlots()
 * produced, including the mixed central-pair levelling below.
 */
export function formationSlots(formationName, style) {
  const template = FORMATION_TEMPLATES[formationName];
  if (!template) throw new Error(`Unknown formation "${formationName}".`);
  const slots = template.map((item, index) => ({
    ...item,
    id: `slot-${index}`,
    effectiveRole: effectiveRole(item, style),
    y: item.y ?? pitchRow(effectiveRole(item, style)),
  }));
  // A central pair that reads as MIXED depth (an AMC beside an MC, or a
  // DMC beside an MC) is really one two-man band drawn at two heights.
  // Levelled onto a shared row and pulled to a fixed 42/58 split so the
  // shape reads as a pair rather than a stagger.
  const central = slots.filter((item) => ["DMC", "MC", "AMC"].includes(item.effectiveRole));
  if (central.length === 2) {
    const roles = new Set(central.map((item) => item.effectiveRole));
    const isMixedPair =
      (roles.has("AMC") && roles.has("MC")) || (roles.has("DMC") && roles.has("MC"));
    if (isMixedPair) {
      const sharedY = averageRounded(central.map((item) => item.y));
      central
        .sort((left, right) => left.x - right.x)
        .forEach((item, index) => {
          item.x = index === 0 ? 42 : 58;
          item.y = sharedY;
        });
    }
  }
  return slots;
}

// ---------------------------------------------------------------------------
// Frame conversion
// ---------------------------------------------------------------------------

/**
 * Converts slots from the authoring frame (attacking "up" the page, own
 * goal at y=94) into a given attacking direction, optionally mirrored
 * left/right. Written once here so no caller scatters `100 - y` literals.
 *
 * attackingDirection "up"   -> attacking y=0, own goal y=100 (as authored)
 * attackingDirection "down" -> attacking y=100, own goal y=0 (mirrored)
 */
export function orientSlots(slots, { attackingDirection = "up", mirrorSides = false } = {}) {
  if (attackingDirection !== "up" && attackingDirection !== "down") {
    throw new Error('orientSlots() requires an attackingDirection of "up" or "down".');
  }
  // Turning a team round is a 180-degree ROTATION of the shape about the
  // centre spot, not a flip of depth alone.
  //
  // A slot's L/R suffix is that PLAYER'S OWN left and right, and a player
  // attacking the other way is facing the other way: their left hand now
  // points at the other touchline. Flipping only y (the original bug) kept
  // every left-back on screen-left regardless of which way they faced, so
  // one team's DL and the other team's DL ended up on the same flank and
  // both teams' wide players were mirrored wrong relative to each other.
  //
  //   attacking "up"   -> DL on screen-left, DR on screen-right
  //   attacking "down" -> DL on screen-RIGHT, DR on screen-LEFT
  //
  // `mirrorSides` is a further, explicit flip on top of that, for a caller
  // that genuinely wants the shape reflected (a left-side restart against a
  // right-side template).
  const rotated = attackingDirection === "down";
  return slots.map((item) => {
    const x = rotated ? 100 - item.x : item.x;
    return {
      ...item,
      x: mirrorSides ? 100 - x : x,
      y: rotated ? 100 - item.y : item.y,
    };
  });
}

// ---------------------------------------------------------------------------
// Reduced-sided projection
// ---------------------------------------------------------------------------

// Which bands a reduced-sided game keeps, in the order they are filled.
// Never random: a 5v5 always keeps the same shape for the same formation,
// which is what makes a projected setup reproducible and comparable.
// Player counts are per SIDE and include the goalkeeper, so a 3v3 is a
// keeper plus two outfielders -- not a keeper plus three.
export const MATCH_FORMATS = Object.freeze({
  "3v3": { players: 3, outfieldBands: ["D", "F"] },
  "5v5": { players: 5, outfieldBands: ["D", "D", "M", "F"] },
  "7v7": { players: 7, outfieldBands: ["D", "D", "M", "M", "F", "F"] },
  "11v11": { players: 11, outfieldBands: null },
});

export const MATCH_FORMAT_NAMES = Object.freeze(Object.keys(MATCH_FORMATS));

/** Coarse band for a role: "GK", "D", "M" or "F". */
export function roleBand(role) {
  const prefix = rolePrefix(role);
  if (prefix === "GK") return "GK";
  if (prefix === "D" || prefix === "SW" || prefix === "WB") return "D";
  if (prefix === "F") return "F";
  return "M";
}

/**
 * Projects a full formation down to a reduced-sided shape.
 *
 * Deterministic and positionally balanced by construction:
 *  - the goalkeeper is always kept, first;
 *  - each remaining place is filled from its band's own slots, taking the
 *    most central first so a 3v3 keeps the spine rather than a wing;
 *  - a band that runs out of slots falls back to the nearest band, in a
 *    fixed order, never to a random pick.
 *
 * There is no random XI here on purpose. "Random XI" is a preset a caller
 * may choose explicitly (see matchSetup.js), never the behaviour a
 * projection falls back into.
 */
export function projectFormation(formationName, style, format) {
  const spec = MATCH_FORMATS[format];
  if (!spec) throw new Error(`Unknown match format "${format}".`);
  const slots = formationSlots(formationName, style);
  if (format === "11v11") return slots;

  const keeper = slots.find((item) => roleBand(item.effectiveRole) === "GK");
  if (!keeper) throw new Error(`Formation "${formationName}" has no goalkeeper slot.`);

  // Most central first, then left-to-right for a stable tie-break -- the
  // ordering is what makes this reproducible.
  const byCentrality = (left, right) =>
    Math.abs(left.x - 50) - Math.abs(right.x - 50) || left.x - right.x;
  const pools = { D: [], M: [], F: [] };
  for (const item of slots) {
    const band = roleBand(item.effectiveRole);
    if (band === "GK") continue;
    pools[band].push(item);
  }
  for (const band of Object.keys(pools)) pools[band].sort(byCentrality);

  const NEAREST_BANDS = { D: ["D", "M", "F"], M: ["M", "D", "F"], F: ["F", "M", "D"] };
  const chosen = [keeper];
  for (const band of spec.outfieldBands) {
    let picked = null;
    for (const candidateBand of NEAREST_BANDS[band]) {
      picked = pools[candidateBand].shift() ?? null;
      if (picked) break;
    }
    if (!picked) throw new Error(`Formation "${formationName}" cannot fill a ${format} shape.`);
    chosen.push(picked);
  }
  if (chosen.length !== spec.players) {
    throw new Error(`Projection produced ${chosen.length} players for ${format}, expected ${spec.players}.`);
  }
  // Returned in shape order (back to front, then left to right) rather than
  // pick order, so a projected XI reads like a team sheet.
  return chosen
    .slice()
    .sort((left, right) => right.y - left.y || left.x - right.x)
    .map((item, index) => ({ ...item, id: `slot-${index}`, projectedFrom: item.id }));
}
