// Historical squad resolution -- turning a declaration in
// src/data/historicalSquads.js into real database players.
//
// Extracted from draft-run.js's own opponentRoster() (2026-09-04) without
// behaviour change, so Draft's Titan Fight and Match Lab resolve squads
// through ONE implementation. DOM-free and network-free by construction:
// the caller injects `searchPlayers`, which is the only outside contact
// this module makes. That is what lets it be tested offline with a fake
// database instead of the live API.
//
// The rule this module exists to enforce: a squad either resolves to real,
// database-qualified identities, or it reports exactly which players did
// not. It never quietly substitutes somebody else and never invents an id.

import { KNOWN_DATABASE_SLUGS } from "../data/historicalSquads.js";

// Tried in order when a player is not in their own squad's filtered search
// results -- a real player can sit in a neighbouring edition (a squad
// assembled from one season's database still contains players whose record
// lives in the adjacent year's file). Order matters: the squad's own
// database is always tried first by resolveHistoricalSquad().
// Deliberately the exact list draft-run.js used inline, unchanged, so
// every existing Titan Fight opponent resolves to precisely the players it
// always did. It is NOT the full edition list: fm2005 and cm9596 are real
// editions (see KNOWN_DATABASE_SLUGS) but adding them here would change
// which record an existing squad's fallback lookup finds, which is a
// behaviour change to a working feature rather than a fix.
//
// A squad sourced FROM one of those editions is unaffected either way:
// resolveHistoricalSquad() always searches the squad's own database first,
// ahead of everything in this list.
export const FALLBACK_DATABASES = Object.freeze([
  "cm0304_vanilla_original",
  "cm0203_vanilla_original",
  "cm0102_vanilla_original",
  "cm0001_vanilla_original",
  "cm9900_vanilla_original",
  "cm9899_vanilla_original",
]);

export const SQUAD_SEARCH_PAGE_SIZE = 100;
export const FALLBACK_SEARCH_PAGE_SIZE = 12;
export const MAX_ROSTER_SIZE = 22;

/** Accent- and punctuation-insensitive name key. */
export function normalizePlayerName(value) {
  return String(value || "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** The alias list for either spec form (array of names, or identity object). */
export function specAliases(playerSpec) {
  return Array.isArray(playerSpec) ? playerSpec : (playerSpec?.aliases ?? []);
}

/** The canonical public id a spec pins itself to, or "" when it does not. */
export function specCanonicalPublicId(playerSpec) {
  return Array.isArray(playerSpec) ? "" : String(playerSpec?.canonicalPublicId || "");
}

function playerNameOf(player) {
  return player?.canonical_player_name
    || player?.display_name
    || player?.full_name
    || "Unknown player";
}

/**
 * Does this search result satisfy this spec? A spec pinned to a canonical
 * public id matches on that alone when the result carries one -- an exact
 * identity beats any amount of name similarity, which is the whole reason
 * the identity-object form exists (two Ronaldos, two Gilbertos).
 */
export function matchesPlayerSpec(player, playerSpec) {
  const canonicalPublicId = specCanonicalPublicId(playerSpec);
  const returnedCanonicalPublicId = String(player?.canonical_player_public_id || "");
  if (canonicalPublicId && returnedCanonicalPublicId) {
    return returnedCanonicalPublicId === canonicalPublicId;
  }
  const normalizedAliases = specAliases(playerSpec).map(normalizePlayerName);
  const names = [
    playerNameOf(player),
    player?.display_name,
    player?.full_name,
    player?.common_name,
    player?.canonical_player_name,
  ]
    .map(normalizePlayerName)
    .filter(Boolean);
  return normalizedAliases.some((alias) =>
    names.some((name) => name === alias || name.endsWith(` ${alias}`)));
}

/** Stable per-database identity, matching draft-run.js's own playerIdentity(). */
export function playerIdentity(player, fallbackDatabase = "") {
  return `${player?.database_slug || fallbackDatabase}:${player?.source_person_id || playerNameOf(player)}`;
}

/**
 * Playable-roster filter: drops records with an out-of-range current
 * ability, strongest first, capped at MAX_ROSTER_SIZE. Byte-for-byte the
 * rule draft-run.js's validRoster() already applied.
 */
export function validRoster(players) {
  return players
    .filter((player) => {
      const ability = Number(player.current_ability);
      return ability > 0 && ability <= 200;
    })
    .sort((left, right) =>
      Number(right.current_ability) - Number(left.current_ability)
      || playerNameOf(left).localeCompare(playerNameOf(right)))
    .slice(0, MAX_ROSTER_SIZE);
}

// ---------------------------------------------------------------------------
// Declaration validation -- structural problems findable without a database.
// ---------------------------------------------------------------------------

/**
 * Checks a squad declaration on its own terms: real database slug, unique
 * starters, a nominated goalkeeper, a usable filter, well-formed specs.
 * Returns { valid, errors, warnings }. Never touches the network.
 */
export function validateSquadDeclaration(squad) {
  const errors = [];
  const warnings = [];
  if (!squad || typeof squad !== "object") return { valid: false, errors: ["squad is not an object"], warnings };
  if (!squad.key) errors.push("missing key");
  if (!squad.name) errors.push("missing name");

  if (squad.blocked) {
    warnings.push(`squad is blocked: ${squad.blocked}`);
  } else {
    if (!squad.database) errors.push("missing database slug");
    else if (!KNOWN_DATABASE_SLUGS.includes(squad.database)) {
      errors.push(`database slug "${squad.database}" is not one this project has`);
    }
    if (!squad.filter || typeof squad.filter !== "object") errors.push("missing club/nation filter");
    else if (!squad.filter.club && !squad.filter.nation) errors.push("filter names neither a club nor a nation");
    if (!Array.isArray(squad.players) || !squad.players.length) errors.push("no players declared");
  }

  const players = Array.isArray(squad.players) ? squad.players : [];
  if (players.length && players.length !== 11) {
    warnings.push(`declares ${players.length} players, not a starting XI of 11`);
  }
  players.forEach((spec, index) => {
    const aliases = specAliases(spec);
    if (!aliases.length && !specCanonicalPublicId(spec)) {
      errors.push(`player ${index} has neither aliases nor a canonical public id`);
    }
  });

  if (squad.lineupSlots !== undefined) {
    if (!Array.isArray(squad.lineupSlots)) {
      errors.push("lineupSlots is not an array");
    } else {
      if (squad.lineupSlots.length !== players.length) {
        errors.push("lineupSlots must contain one slot key per declared player");
      }
      const validSlotKey = /^(?:GK|SW|DC|DL|DR|WBL|WBR|DMC|MC|ML|MR|AMC|AML|AMR|FC|FL|FR)#(?:0|[1-9]\d*)$/;
      squad.lineupSlots.forEach((slotKey, index) => {
        if (!validSlotKey.test(String(slotKey))) {
          errors.push(`lineup slot ${index} has invalid key "${slotKey}"`);
        }
      });
      if (new Set(squad.lineupSlots).size !== squad.lineupSlots.length) {
        errors.push("lineupSlots contains a duplicate slot key");
      }
    }
  }

  // Unique starters: two specs must not name the same person.
  const seen = new Map();
  players.forEach((spec, index) => {
    const pinned = specCanonicalPublicId(spec);
    const identityKey = pinned || normalizePlayerName(specAliases(spec)[0] || "");
    if (!identityKey) return;
    if (seen.has(identityKey)) {
      errors.push(`players ${seen.get(identityKey)} and ${index} both name "${identityKey}"`);
    } else {
      seen.set(identityKey, index);
    }
  });

  const goalkeeperIndex = Number(squad.goalkeeperIndex);
  if (!Number.isInteger(goalkeeperIndex) || goalkeeperIndex < 0 || (players.length && goalkeeperIndex >= players.length)) {
    if (players.length) errors.push("goalkeeperIndex does not point at a declared player");
  }
  if (Array.isArray(squad.lineupSlots) && Number.isInteger(goalkeeperIndex)
    && squad.lineupSlots[goalkeeperIndex] !== "GK#0") {
    errors.push("the nominated goalkeeper must use lineup slot GK#0");
  }
  if (squad.verified !== true && !squad.blocked) {
    warnings.push("squad is unverified -- not resolved against the live database yet");
  }
  return { valid: errors.length === 0, errors, warnings };
}

/** Same, across a whole catalogue, plus a cross-squad unique-key check. */
export function validateSquadCatalogue(squads = []) {
  const results = squads.map((squad) => ({ key: squad?.key ?? "(unkeyed)", ...validateSquadDeclaration(squad) }));
  const keys = new Map();
  for (const squad of squads) {
    if (!squad?.key) continue;
    if (keys.has(squad.key)) {
      const row = results.find((entry) => entry.key === squad.key);
      row.errors.push(`duplicate squad key "${squad.key}"`);
      row.valid = false;
    }
    keys.set(squad.key, true);
  }
  return { valid: results.every((entry) => entry.valid), results };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

const GOALKEEPER_PATTERN = /(^|\/|\s)GK($|\/|\s)/i;

/** Does this resolved record read as a goalkeeper? */
export function isGoalkeeperRecord(player) {
  if (player?.role) return player.role === "GK";
  return GOALKEEPER_PATTERN.test(String(player?.position_text || ""));
}

/**
 * Resolves a declared squad into real players.
 *
 * `searchPlayers` is injected -- the same ({ database, q, club, nation,
 * pageSize }) => { items } contract retroballApi.js exposes. Nothing here
 * knows about fetch, caching or the DOM; draft-run.js keeps its own cache
 * around this call exactly as before.
 *
 * Returns { squad, players, unresolved, warnings, valid }. `unresolved`
 * names every player that could not be found, with the aliases tried --
 * the caller decides whether that is fatal. draft-run.js throws on it, to
 * preserve Titan Fight's existing all-or-nothing behaviour; a setup screen
 * can instead show which names need fixing.
 */
export async function resolveHistoricalSquad(squad, {
  searchPlayers, fallbackDatabases = FALLBACK_DATABASES, strict = false,
} = {}) {
  if (typeof searchPlayers !== "function") {
    throw new Error("resolveHistoricalSquad() requires a searchPlayers function.");
  }
  const declaration = validateSquadDeclaration(squad);
  if (squad?.blocked) {
    return {
      squad, players: [], unresolved: [], valid: false,
      warnings: [...declaration.warnings],
      errors: [`${squad.shortName || squad.key} is unavailable: ${squad.blocked}`],
    };
  }
  if (!declaration.valid) {
    return { squad, players: [], unresolved: [], valid: false, warnings: declaration.warnings, errors: declaration.errors };
  }

  const database = squad.database;
  const response = await searchPlayers({
    database, q: "", ...squad.filter, pageSize: SQUAD_SEARCH_PAGE_SIZE,
  });
  const available = (response?.items ?? []).slice();
  const selected = [];
  const unresolved = [];
  const warnings = [...declaration.warnings];

  // Squad-filtered results first; the squad's own database leads the
  // fallback order so a near-miss inside the right edition always wins
  // over an exact hit in a neighbouring one.
  //
  // STRICT mode drops the fallbacks entirely. Legacy Titan Fight
  // resolution is allowed to reach into a neighbouring edition to find a
  // player (that behaviour predates this module and is preserved by
  // default), but a squad being PROMOTED to verified -- or served to Match
  // Lab as a historical preset -- must come wholly out of its own declared
  // database and its own declared club/nation. A player who only turns up
  // somewhere else is a declaration that has not been proven, not a
  // near-miss to wave through.
  // Strict mode still LOOKS in the neighbouring editions, but only to
  // report where a missing player actually lives -- "Baros is in cm0304,
  // not fm2005" is an actionable verification failure, where a bare
  // "missing" is not. It never accepts the result.
  const databases = [database, ...fallbackDatabases]
    .filter((slug, index, all) => slug && all.indexOf(slug) === index);

  for (const playerSpec of squad.players) {
    const aliases = specAliases(playerSpec);
    const index = available.findIndex((player) => matchesPlayerSpec(player, playerSpec));
    if (index >= 0) {
      selected.push(available.splice(index, 1)[0]);
      continue;
    }
    const used = new Set(selected.map((player) => playerIdentity(player, database)));
    let found = null;
    let foundIn = "";
    for (const fallbackDatabase of databases) {
      const fallback = await searchPlayers({
        database: fallbackDatabase, q: aliases[0] ?? "", pageSize: FALLBACK_SEARCH_PAGE_SIZE,
      });
      found = (fallback?.items ?? []).find((item) =>
        matchesPlayerSpec(item, playerSpec) && !used.has(playerIdentity(item, fallbackDatabase)));
      if (found) { foundIn = String(found.database_slug || fallbackDatabase); break; }
    }
    if (found) {
      const wrongDatabase = foundIn !== database;
      if (wrongDatabase && strict) {
        unresolved.push({
          aliases, canonicalPublicId: specCanonicalPublicId(playerSpec) || null,
          reason: "wrong-database", foundIn,
        });
        continue;
      }
      if (wrongDatabase) {
        warnings.push(`${aliases[0]} resolved from ${foundIn}, not the declared ${database}`);
      }
      selected.push(found);
      continue;
    }
    unresolved.push({ aliases, canonicalPublicId: specCanonicalPublicId(playerSpec) || null, reason: "not-found" });
  }

  const errors = unresolved.length
    ? [`Could not load ${squad.shortName || squad.key}: `
       + `${unresolved.map((entry) => entry.aliases[0]).join(", ")} missing from the database set.`]
    : [];

  // Strict promotion gates. Each is a failure, not a note: a preset that
  // trips any of them is not ready to be marked verified.
  if (strict) {
    if (selected.length !== squad.players.length) {
      errors.push(
        `only ${selected.length} of ${squad.players.length} declared players resolved`
        + " -- a strict squad must resolve in full",
      );
    }
    // Every resolved record must come from the declared database.
    for (const player of selected) {
      const slug = String(player.database_slug || "");
      if (slug && slug !== database) {
        errors.push(`${playerNameOf(player)} resolved from ${slug}, not the declared ${database}`);
      }
    }
    // Every resolved record must satisfy the squad's own club/nation filter.
    const filterKey = squad.filter?.club ? "club" : squad.filter?.nation ? "nation" : null;
    if (filterKey) {
      const expected = normalizePlayerName(squad.filter[filterKey]);
      for (const player of selected) {
        const actualRaw = filterKey === "club"
          ? (player.canonical_club_name ?? player.club_name ?? player.club ?? "")
          : (player.canonical_nation_name ?? player.nation_name ?? player.nation ?? "");
        const actual = normalizePlayerName(actualRaw);
        // An empty field is not a match -- strict mode cannot confirm what
        // the record does not state.
        if (!actual) {
          errors.push(`${playerNameOf(player)} states no ${filterKey}, so the ${squad.filter[filterKey]} filter cannot be confirmed`);
        } else if (actual !== expected) {
          errors.push(`${playerNameOf(player)} is at ${actualRaw}, not ${squad.filter[filterKey]}`);
        }
      }
    }
    // No person may fill two slots.
    const identities = selected.map((player) => playerIdentity(player, database));
    const seenIdentity = new Set();
    for (const identity of identities) {
      if (seenIdentity.has(identity)) errors.push(`duplicate resolved identity ${identity}`);
      seenIdentity.add(identity);
    }
  }

  // Goalkeeper check, on the RESOLVED record rather than on list order.
  if (!unresolved.length) {
    const keeper = selected[squad.goalkeeperIndex];
    if (!keeper) errors.push("resolved squad has no player at goalkeeperIndex");
    else if (!isGoalkeeperRecord(keeper)) {
      const note = `${playerNameOf(keeper)} is nominated as goalkeeper but reads as `
        + `"${keeper.position_text ?? "unknown position"}"`;
      // Legacy resolution tolerates this; a strict promotion does not.
      if (strict) errors.push(note);
      else warnings.push(note);
    }
  }

  return {
    squad,
    strict,
    players: selected,
    roster: validRoster(selected),
    unresolved,
    warnings,
    errors,
    valid: errors.length === 0,
  };
}
