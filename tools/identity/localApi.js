import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(".");
const source = new DatabaseSync(resolve(root, "db", "retroball.sqlite"), { readOnly: true });
const identity = new DatabaseSync(resolve(root, "identity", "retroball_identity.sqlite"), { readOnly: true });
const leagueMap = JSON.parse(
  readFileSync(resolve(root, "worker", "src", "league-map.json"), "utf8")
);
source.exec("PRAGMA query_only = ON");
identity.exec("PRAGMA query_only = ON");

function canonicalDatabaseSlug(slug) {
  if (slug === "cm0203") return "cm0203_vanilla_original";
  if (slug === "cm0304") return "cm0304_vanilla_original";
  return slug;
}

function clubsForLeague(database, league) {
  const slug = canonicalDatabaseSlug(database);
  const databaseLeagues = slug === "cm0203_vanilla_original"
    ? {
        ...(leagueMap.cm0304_vanilla_original || {}),
        ...(leagueMap.cm0203_vanilla_original || {}),
      }
    : leagueMap[slug] || {};
  return Object.entries(databaseLeagues)
    .filter(([, clubLeague]) => clubLeague === league)
    .map(([club]) => club);
}

const playerColumns = `
  database_slug, source_person_id, display_name, full_name, common_name,
  club_id, club_name, nation_name, date_of_birth, season_age AS age, position_text,
  current_ability, potential_ability, value, wage
`;

function integer(value, fallback, minimum, maximum) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? Math.max(minimum, Math.min(maximum, parsed)) : fallback;
}

function ftsQuery(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .match(/[\p{L}\p{N}_]+/gu)
    ?.slice(0, 10)
    .map((token) => `"${token}"*`)
    .join(" AND ") || "";
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function ratingList(value) {
  const parsed = parseJson(value, []);
  if (Array.isArray(parsed)) return parsed;
  if (parsed && typeof parsed === "object") {
    return Object.entries(parsed).map(([key, itemValue]) => ({
      label: key.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase()),
      value: itemValue
    }));
  }
  return [];
}

const clubColourData = readFileSync(resolve(root, "01-02 dat", "colour.dat"));
const clubColourOverrides = JSON.parse(
  readFileSync(
    resolve(root, "config", "identity", "club_colour_overrides.json"),
    "utf8"
  )
);
const clubColourPalette = Array.from(
  { length: Math.floor(clubColourData.length / 58) },
  (_, index) => {
    const offset = index * 58;
    return `#${[55, 56, 57]
      .map((channel) => clubColourData[offset + channel].toString(16).padStart(2, "0"))
      .join("")}`;
  }
);
const clubSeasonOrder = new Map(
  source.prepare("SELECT slug, season_order FROM cm_databases").all()
    .map((row) => [String(row.slug), Number(row.season_order)])
);
const canonicalClubNameStatement = identity.prepare(`
  SELECT c.preferred_name
  FROM source_players s
  JOIN canonical_clubs c ON c.id = s.canonical_club_id
  WHERE s.database_slug = ?
    AND s.club_name = ?
    AND s.active = 1
  GROUP BY c.id, c.preferred_name
  LIMIT 2
`);
const canonicalClubNameCache = new Map();
const canonicalPlayerStatement = identity.prepare(`
  SELECT c.public_id, c.preferred_name
  FROM player_identity_links l
  JOIN canonical_players c ON c.id = l.canonical_player_id
  WHERE l.database_slug = ? AND l.source_person_id = ?
  LIMIT 1
`);
const canonicalPlayerCache = new Map();
const draftClubColourCache = new Map();
const draftClubColourStatement = source.prepare(`
  SELECT
    coalesce(nullif(fore_colour1, ''), json_extract(raw_json, '$."Home Text Col"')) AS fore_colour1,
    coalesce(nullif(back_colour1, ''), json_extract(raw_json, '$."Home Back Col"')) AS back_colour1,
    nullif(fore_colour2, '') AS fore_colour2,
    nullif(back_colour2, '') AS back_colour2,
    nullif(fore_colour3, '') AS fore_colour3,
    nullif(back_colour3, '') AS back_colour3
  FROM clubs
  WHERE database_slug = ?
    AND (
      cast(source_club_id AS TEXT) = ?
      OR (? <> '' AND name = ?)
    )
  ORDER BY CASE WHEN cast(source_club_id AS TEXT) = ? THEN 0 ELSE 1 END
  LIMIT 1
`);

function canonicalClubName(database, sourceName) {
  if (!database || !sourceName) return "";
  const key = `${database}\u001f${sourceName}`;
  if (canonicalClubNameCache.has(key)) return canonicalClubNameCache.get(key);
  const rows = canonicalClubNameStatement.all(database, sourceName);
  const name = rows.length === 1 ? String(rows[0].preferred_name) : "";
  canonicalClubNameCache.set(key, name);
  return name;
}

function withCanonicalClubName(row) {
  if (!row) return row;
  return {
    ...row,
    canonical_club_name:
      canonicalClubName(String(row.database_slug), String(row.club_name || ""))
      || null
  };
}

function canonicalPlayer(database, sourcePersonId) {
  if (!database || sourcePersonId === null || sourcePersonId === undefined) return null;
  const key = `${database}\u001f${sourcePersonId}`;
  if (canonicalPlayerCache.has(key)) return canonicalPlayerCache.get(key);
  const row = canonicalPlayerStatement.get(database, String(sourcePersonId));
  const player = row
    ? {
        canonical_player_public_id: String(row.public_id),
        canonical_player_name: String(row.preferred_name)
      }
    : null;
  canonicalPlayerCache.set(key, player);
  return player;
}

function withCanonicalIdentity(row) {
  if (!row) return row;
  return {
    ...withCanonicalClubName(row),
    ...canonicalPlayer(String(row.database_slug), row.source_person_id)
  };
}

function draftClubColours(database, sourceClubId, sourceClubName) {
  const key = `${database}\u001f${sourceClubId || ""}\u001f${sourceClubName || ""}`;
  if (draftClubColourCache.has(key)) return draftClubColourCache.get(key);
  const sourceId = String(sourceClubId || "");
  const sourceName = String(sourceClubName || "");
  const row = draftClubColourStatement.get(
    database,
    sourceId,
    sourceName,
    sourceName,
    sourceId
  );
  let colours = null;
  for (const slot of [1, 2, 3]) {
    const foreground = decodeClubColour(row?.[`fore_colour${slot}`]);
    const background = decodeClubColour(row?.[`back_colour${slot}`]);
    if (background && foreground && background !== foreground) {
      colours = { background_colour: background, foreground_colour: foreground };
      break;
    }
  }
  draftClubColourCache.set(key, colours);
  return colours;
}

function decodeClubColour(value) {
  if (value === null || value === undefined || value === "") return "";
  const text = String(value).trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();

  const numeric = Number(text);
  if (!Number.isInteger(numeric)) return "";
  if (numeric >= 0 && numeric < clubColourPalette.length) {
    return clubColourPalette[numeric];
  }
  const packed = numeric >>> 0;
  if ((packed & 0x00ffffff) !== 0) return "";
  return clubColourPalette[packed >>> 24] || "";
}

function canonicalClubColourOverride(publicId) {
  const override = clubColourOverrides[String(publicId)] || null;
  if (!override) return null;
  const background = decodeClubColour(override.background);
  const foreground = decodeClubColour(override.foreground);
  const third = override.third ? decodeClubColour(override.third) : "";
  return background && foreground && background !== foreground
    ? {
        background_colour: background,
        foreground_colour: foreground,
        third_colour: third || null,
        colour_source_database_slug: "canonical_override",
        colour_source_club_id: String(publicId),
        colour_slot: 0
      }
    : null;
}

function chooseCanonicalClubColour(keys) {
  const colourStatement = source.prepare(`
    SELECT
      fore_colour1, back_colour1,
      fore_colour2, back_colour2,
      fore_colour3, back_colour3
    FROM clubs
    WHERE database_slug = ? AND cast(source_club_id AS TEXT) = ?
    LIMIT 1
  `);
  for (const slot of [1, 2, 3]) {
    const candidates = keys.flatMap((key) => {
      const row = colourStatement.get(key.database_slug, String(key.source_club_id));
      if (!row) return [];
      const foreground = decodeClubColour(row[`fore_colour${slot}`]);
      const background = decodeClubColour(row[`back_colour${slot}`]);
      if (!background || !foreground || background === foreground) return [];
      return [{
        background_colour: background,
        foreground_colour: foreground,
        colour_source_database_slug: String(key.database_slug),
        colour_source_club_id: String(key.source_club_id),
        colour_slot: slot,
        season_order: clubSeasonOrder.get(String(key.database_slug)) || 0
      }];
    });
    if (candidates.length) {
      return candidates.sort((left, right) =>
        right.season_order - left.season_order
        || right.colour_source_database_slug.localeCompare(left.colour_source_database_slug)
      )[0];
    }
  }
  return null;
}

function canonicalClubColours(database, sourceClubId) {
  const linkStatement = identity.prepare(`
    SELECT
      l.canonical_club_id,
      c.public_id AS canonical_public_id,
      s.normalized_name,
      s.team_type
    FROM club_identity_links l
    JOIN canonical_clubs c ON c.id = l.canonical_club_id
    JOIN source_clubs s
      ON s.database_slug = l.database_slug
     AND s.source_club_id = l.source_club_id
    WHERE l.database_slug = ? AND l.source_club_id = ?
    LIMIT 1
  `);
  linkStatement.setReadBigInts(true);
  const link = linkStatement.get(database, String(sourceClubId));
  if (!link) return null;

  const exactOverride = canonicalClubColourOverride(link.canonical_public_id);
  if (exactOverride) {
    return {
      ...exactOverride,
      canonical_club_id: link.canonical_club_id.toString(),
      colour_canonical_club_id: link.canonical_club_id.toString(),
      colour_resolution_method: "canonical_override"
    };
  }

  const linkedKeysStatement = identity.prepare(`
    SELECT database_slug, source_club_id
    FROM club_identity_links
    WHERE canonical_club_id = ?
  `);
  const exactPair = chooseCanonicalClubColour(
    linkedKeysStatement.all(link.canonical_club_id)
  );
  if (exactPair) {
    return {
      ...exactPair,
      canonical_club_id: link.canonical_club_id.toString(),
      colour_canonical_club_id: link.canonical_club_id.toString(),
      colour_resolution_method: "canonical_link"
    };
  }

  const candidateStatement = identity.prepare(`
    SELECT DISTINCT l.canonical_club_id, c.public_id AS canonical_public_id
    FROM source_clubs s
    JOIN club_identity_links l
      ON l.database_slug = s.database_slug
     AND l.source_club_id = s.source_club_id
    JOIN canonical_clubs c ON c.id = l.canonical_club_id
    WHERE s.normalized_name = ? AND s.team_type = ? AND s.active = 1
  `);
  candidateStatement.setReadBigInts(true);
  const colouredCandidates = candidateStatement
    .all(link.normalized_name, link.team_type)
    .flatMap((candidate) => {
      const pair = canonicalClubColourOverride(candidate.canonical_public_id)
        || chooseCanonicalClubColour(
          linkedKeysStatement.all(candidate.canonical_club_id)
        );
      return pair ? [{ canonicalClubId: candidate.canonical_club_id, pair }] : [];
    });
  const uniqueCandidates = new Map(
    colouredCandidates.map((candidate) => [
      candidate.canonicalClubId.toString(),
      candidate
    ])
  );
  if (uniqueCandidates.size !== 1) return null;

  const fallback = [...uniqueCandidates.values()][0];
  return {
    ...fallback.pair,
    canonical_club_id: link.canonical_club_id.toString(),
    colour_canonical_club_id: fallback.canonicalClubId.toString(),
    colour_resolution_method: "unique_normalized_name"
  };
}

function canonicalClubColoursByPlayerName(database, sourceClubName) {
  if (!database || !sourceClubName) return null;
  const canonicalStatement = identity.prepare(`
    SELECT c.id AS canonical_club_id, c.public_id AS canonical_public_id
    FROM source_players s
    JOIN canonical_clubs c ON c.id = s.canonical_club_id
    WHERE s.database_slug = ?
      AND s.club_name = ?
      AND s.active = 1
    GROUP BY c.id, c.public_id
    LIMIT 2
  `);
  canonicalStatement.setReadBigInts(true);
  const candidates = canonicalStatement.all(database, sourceClubName);
  if (candidates.length !== 1) return null;

  const candidate = candidates[0];
  const override = canonicalClubColourOverride(candidate.canonical_public_id);
  const linkedKeysStatement = identity.prepare(`
    SELECT database_slug, source_club_id
    FROM club_identity_links
    WHERE canonical_club_id = ?
  `);
  const pair = override || chooseCanonicalClubColour(
    linkedKeysStatement.all(candidate.canonical_club_id)
  );
  if (!pair) return null;

  return {
    ...pair,
    canonical_club_id: candidate.canonical_club_id.toString(),
    colour_canonical_club_id: candidate.canonical_club_id.toString(),
    colour_resolution_method: override
      ? "canonical_override"
      : "canonical_player_club_name"
  };
}

function databases() {
  return {
    items: source.prepare(
      "SELECT slug, title, season_order, status FROM cm_databases ORDER BY season_order"
    ).all()
  };
}

function filters(database) {
  const clubs = source.prepare(`
    SELECT DISTINCT club_name AS name
    FROM player_search
    WHERE database_slug = ? AND club_name IS NOT NULL AND club_name <> ''
    ORDER BY club_name COLLATE NOCASE
  `).all(database);
  const nations = source.prepare(`
    SELECT DISTINCT nation_name AS name
    FROM player_search
    WHERE database_slug = ? AND nation_name IS NOT NULL AND nation_name <> ''
    ORDER BY nation_name COLLATE NOCASE
  `).all(database);
  const databaseLeagues = source.prepare(`
    SELECT name
    FROM (
      SELECT league_name AS name
      FROM player_search
      WHERE database_slug = ? AND league_name IS NOT NULL AND league_name <> ''
      UNION
      SELECT league_name AS name
      FROM person_history
      WHERE database_slug = ? AND league_name IS NOT NULL AND league_name <> ''
    )
    ORDER BY name COLLATE NOCASE
  `).all(database, database).map((row) => String(row.name));
  const leagueDatabase = database === "cm0203"
    ? "cm0203_vanilla_original"
    : database === "cm0304"
      ? "cm0304_vanilla_original"
      : database;
  const leagues = [
    ...new Set([
      ...databaseLeagues,
      ...Object.values(leagueMap[leagueDatabase] || {}),
    ]),
  ].sort((left, right) => left.localeCompare(right)).map((name) => ({ name }));

  return {
    clubs,
    nations,
    leagues,
  };
}

function searchPlayers(params) {
  const database = params.get("database") || "";
  const page = integer(params.get("page"), 1, 1, 100000);
  const pageSize = integer(params.get("pageSize"), 20, 1, 100);
  const query = (params.get("q") || "").trim();
  const league = (params.get("league") || "").trim();
  const leagueClubs = league ? clubsForLeague(database, league) : [];
  const clauses = ["ps.database_slug = ?"];
  const values = [database];
  let join = "";

  if (query) {
    const match = ftsQuery(query);
    if (!match) return { items: [], page, pageSize };
    const result = spawnSync("python", [
      resolve(root, "tools", "identity", "local_search.py"),
      database,
      query,
      String(page),
      String(pageSize),
      params.get("club") || "",
      league,
      params.get("nation") || ""
    ], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
    if (result.status === 0) {
      return {
        items: JSON.parse(result.stdout).map(withCanonicalIdentity),
        page,
        pageSize
      };
    }

    // Some restricted runtimes cannot spawn Python and Node's bundled SQLite
    // omits FTS5. Keep local inspection usable with token containment there.
    for (const token of match.match(/"([^"]+)"/g)?.map((item) => item.slice(1, -1)) || []) {
      clauses.push("instr(lower(ps.search_blob), ?) > 0");
      values.push(token);
    }
  }

  for (const [parameter, column] of [
    ["club", "club_name"], ["nation", "nation_name"]
  ]) {
    const value = (params.get(parameter) || "").trim();
    if (value) {
      clauses.push(`ps.${column} = ?`);
      values.push(value);
    }
  }
  if (league) {
    if (leagueClubs.length) {
      clauses.push(`ps.club_name IN (${leagueClubs.map(() => "?").join(", ")})`);
      values.push(...leagueClubs);
    } else {
      clauses.push("0 = 1");
    }
  }

  const items = source.prepare(`
    SELECT ${playerColumns.split(",").map((column) => `ps.${column.trim()}`).join(", ")}
    FROM player_search ps
    ${join}
    WHERE ${clauses.join(" AND ")}
    ORDER BY
      ps.current_ability DESC,
      ps.potential_ability DESC,
      ps.full_name,
      ps.source_person_id
    LIMIT ? OFFSET ?
  `).all(...values, pageSize, (page - 1) * pageSize).map(withCanonicalIdentity);
  return { items, page, pageSize };
}

function draftCandidates(params) {
  const parsedSeed = Number.parseInt(params.get("seed") || "0", 10);
  const seed = Number.isFinite(parsedSeed) ? Math.abs(parsedSeed) : 0;
  const perDatabase = integer(params.get("perDatabase"), 18, 8, 30);
  const minAbility = integer(params.get("minAbility"), 100, 100, 200);
  const supportedPositions = new Set([
    "GK", "SW",
    "DL", "DC", "DR", "WBL", "WBR",
    "DML", "DMC", "DMR",
    "ML", "MC", "MR",
    "AML", "AMC", "AMR",
    "FL", "FC", "FR",
  ]);
  const requestedPositions = [...new Set(
    String(params.get("positions") || "")
      .split(",")
      .map((position) => position.trim().toUpperCase())
      .filter((position) => supportedPositions.has(position)),
  )].slice(0, 5);
  const positionPatterns = new Set();
  for (const position of requestedPositions) {
    if (position === "GK") positionPatterns.add("%GK%");
    else if (position === "SW") positionPatterns.add("%SW%");
    else if (position.startsWith("AM")) {
      positionPatterns.add("%AM%");
      positionPatterns.add("%F%");
    } else if (position.startsWith("F")) {
      positionPatterns.add("%F%");
      positionPatterns.add("%AM%");
    }
    else if (position.startsWith("M")) positionPatterns.add("%M%");
    else {
      positionPatterns.add("%D%");
      if (position.startsWith("WB")) positionPatterns.add("%WB%");
    }
  }
  const priorityPatterns = [...positionPatterns];
  const positionMatchSql = priorityPatterns.length
    ? priorityPatterns.map(
        () => "upper(replace(coalesce(ps.position_text, ''), ' ', '')) LIKE ?"
      ).join(" OR ")
    : "";
  const databases = source.prepare(`
    SELECT slug, title, season_order
    FROM cm_databases
    ORDER BY season_order
  `).all();
  const statement = source.prepare(`
    SELECT
      ${playerColumns.split(",").map((column) => `ps.${column.trim()}`).join(", ")},
      profile.position_ratings_json
    FROM player_search ps
    LEFT JOIN player_profile profile
      ON profile.database_slug = ps.database_slug
     AND profile.source_person_id = ps.source_person_id
    WHERE ps.database_slug = ?
      AND ps.current_ability IS NOT NULL
      AND ps.current_ability BETWEEN 100 AND 200
      AND ps.current_ability >= ?
    ORDER BY
      abs((cast(ps.source_person_id AS INTEGER) * 1103515245 + ?) % 2147483647),
      ps.source_person_id
    LIMIT ?
  `);
  const targetedStatement = priorityPatterns.length
    ? source.prepare(`
        SELECT
          ${playerColumns.split(",").map((column) => `ps.${column.trim()}`).join(", ")},
          profile.position_ratings_json
        FROM player_search ps
        LEFT JOIN player_profile profile
          ON profile.database_slug = ps.database_slug
         AND profile.source_person_id = ps.source_person_id
        WHERE ps.database_slug = ?
          AND ps.current_ability IS NOT NULL
      AND ps.current_ability BETWEEN 100 AND 200
          AND ps.current_ability >= ?
          AND (${positionMatchSql})
        ORDER BY
          abs((cast(ps.source_person_id AS INTEGER) * 1103515245 + ?) % 2147483647),
          ps.source_person_id
        LIMIT 4
      `)
    : null;
  const qualityStatement = source.prepare(`
    SELECT
      ${playerColumns.split(",").map((column) => `ps.${column.trim()}`).join(", ")},
      profile.position_ratings_json
    FROM player_search ps
    LEFT JOIN player_profile profile
      ON profile.database_slug = ps.database_slug
     AND profile.source_person_id = ps.source_person_id
    WHERE ps.database_slug = ?
      AND ps.current_ability BETWEEN 140 AND 200
      AND ps.current_ability >= ?
    ORDER BY
      ps.current_ability DESC,
      ps.source_person_id
    LIMIT 24 OFFSET ?
  `);
  const items = databases.flatMap((database, index) => {
    const databaseSeed = (seed * 31 + (index + 1) * 397) % 2_147_483_647;
    const randomRows = statement.all(
      database.slug,
      minAbility,
      databaseSeed,
      perDatabase,
    );
    const targetedRows = targetedStatement
      ? targetedStatement.all(
          database.slug,
          minAbility,
          ...priorityPatterns,
          (databaseSeed + 8191) % 2_147_483_647,
        )
      : [];
    const qualityRows = qualityStatement.all(
      database.slug,
      minAbility,
      (databaseSeed + 16_381) % 120,
    );
    const rows = [...new Map(
      [...targetedRows, ...qualityRows, ...randomRows]
        .map((row) => [String(row.source_person_id), row])
    ).values()];
    return rows.map((row) => {
      const { position_ratings_json, ...player } = row;
      const clubColors = draftClubColours(
        database.slug,
        player.club_id,
        String(player.club_name || "")
      );
      return {
        ...withCanonicalIdentity(player),
        database_title: database.title,
        season_order: database.season_order,
        position_ratings: ratingList(position_ratings_json),
        club_colors: clubColors
          ? {
              background_colour: clubColors.background_colour,
              foreground_colour: clubColors.foreground_colour,
            }
          : null,
      };
    });
  });
  return { items, databases };
}

function playerDetail(database, personId) {
  const item = withCanonicalIdentity(source.prepare(`
    SELECT ${playerColumns} FROM player_search
    WHERE database_slug = ? AND source_person_id = ?
  `).get(database, personId) || null);
  const row = source.prepare(`
    SELECT * FROM player_profile WHERE database_slug = ? AND source_person_id = ?
  `).get(database, personId);
  if (!row) return { item, profile: null };
  const clubColors = source.prepare(`
    SELECT
      source_club_id,
      coalesce(
        nullif(fore_colour1, ''),
        json_extract(raw_json, '$."Home Text Col"'),
        json_extract(raw_json, '$."Home Col 1"')
      ) AS fore_colour1,
      coalesce(
        nullif(back_colour1, ''),
        json_extract(raw_json, '$."Home Back Col"'),
        json_extract(raw_json, '$."Home Col 2"')
      ) AS back_colour1,
      coalesce(
        nullif(fore_colour2, ''),
        json_extract(raw_json, '$."Away Text Col"'),
        json_extract(raw_json, '$."Away Col 1"')
      ) AS fore_colour2,
      coalesce(
        nullif(back_colour2, ''),
        json_extract(raw_json, '$."Away Back Col"'),
        json_extract(raw_json, '$."Away Col 2"')
      ) AS back_colour2,
      nullif(fore_colour3, '') AS fore_colour3,
      nullif(back_colour3, '') AS back_colour3
    FROM clubs
    WHERE database_slug = ?
      AND (
        source_club_id = ?
        OR (? <> '' AND name = ?)
      )
    ORDER BY
      CASE WHEN name = ? THEN 0 ELSE 1 END,
      CASE WHEN source_club_id = ? THEN 0 ELSE 1 END
    LIMIT 1
  `).get(
    database,
    row.club_id || item?.club_id || "",
    row.club_name || item?.club_name || "",
    row.club_name || item?.club_name || "",
    row.club_name || item?.club_name || "",
    row.club_id || item?.club_id || ""
  ) || null;
  const resolvedClubColors = (
    clubColors
      ? canonicalClubColours(database, String(clubColors.source_club_id))
      : null
  ) || canonicalClubColoursByPlayerName(
    database,
    String(row.club_name || item?.club_name || "")
  );
  const mergedClubColors = clubColors || resolvedClubColors
    ? { ...(clubColors || {}), ...(resolvedClubColors || {}) }
    : null;

  const ratings = Object.fromEntries([
    "current_ability", "potential_ability", "home_reputation", "current_reputation",
    "world_reputation", "caps", "international_goals", "squad_number", "value", "wage"
  ].map((key) => [key, row[key]]));
  const positions = ratingList(row.position_ratings_json);
  const profile = {
    source_person_id: row.source_person_id,
    source_player_id: row.player_id,
    display_name: row.display_name,
    full_name: row.full_name,
    common_name: row.common_name,
    ...canonicalPlayer(String(row.database_slug), row.source_person_id),
    club_name: row.club_name,
    canonical_club_name:
      canonicalClubName(String(row.database_slug), String(row.club_name || ""))
      || null,
    nation_name: row.nation_name,
    date_of_birth: row.date_of_birth,
    age: row.season_age,
    position_text: row.position_text,
    current_ability: row.current_ability,
    potential_ability: row.potential_ability,
    ratings,
    positions,
    sides: [],
    positionRatings: positions,
    attributes: ratingList(row.attributes_json),
    hiddenAttributes: ratingList(row.hidden_attributes_json),
    foot: ratingList(row.foot_json),
    clubColors: mergedClubColors,
    profile: {}
  };
  return { item: item ? { ...item, profile } : null, profile };
}

function playerHistory(database, personId) {
  return {
    items: source.prepare(`
      SELECT season_year, club_id, club_name, league_name, apps, goals, on_loan
      FROM person_history
      WHERE database_slug = ? AND source_person_id = ?
      ORDER BY season_year
    `).all(database, personId).map((row) => ({
      ...row,
      canonical_club_name:
        canonicalClubName(database, String(row.club_name || "")) || null
    }))
  };
}

function seasonLabel(title) {
  const match = String(title || "").match(/(\d{2,4})\s*[-/]\s*(\d{2,4})/);
  return match ? `${match[1]}/${match[2]}` : title || "Database";
}

function playerSeasons(database, personId) {
  const linkStatement = identity.prepare(`
    SELECT canonical_player_id FROM player_identity_links
    WHERE database_slug = ? AND source_person_id = ?
  `);
  linkStatement.setReadBigInts(true);
  const link = linkStatement.get(database, personId);
  const keys = link
    ? identity.prepare(`
        SELECT database_slug, source_person_id FROM player_identity_links
        WHERE canonical_player_id = ? ORDER BY database_slug
      `).all(link.canonical_player_id)
    : [{ database_slug: database, source_person_id: personId }];
  const statement = source.prepare(`
    SELECT ${playerColumns}, cd.title, cd.season_order
    FROM player_search ps JOIN cm_databases cd ON cd.slug = ps.database_slug
    WHERE ps.database_slug = ? AND ps.source_person_id = ?
  `);
  const items = keys
    .map((key) => statement.get(key.database_slug, key.source_person_id))
    .filter(Boolean)
    .map(withCanonicalIdentity)
    .map((item) => ({ ...item, label: seasonLabel(item.title) }))
    .sort((left, right) => left.season_order - right.season_order || left.title.localeCompare(right.title));
  return { items };
}

export function handleLocalApi(requestUrl) {
  const path = requestUrl.pathname.slice("/local-api".length);
  if (path === "/api/databases") return databases();
  if (path === "/api/filters") {
    return filters(requestUrl.searchParams.get("database") || "");
  }
  if (path === "/api/players") return searchPlayers(requestUrl.searchParams);
  if (path === "/api/draft-candidates") return draftCandidates(requestUrl.searchParams);
  if (path === "/api/player-seasons") {
    return playerSeasons(
      requestUrl.searchParams.get("database") || "",
      requestUrl.searchParams.get("sourcePersonId") || ""
    );
  }

  const match = path.match(/^\/api\/players\/([^/]+)\/([^/]+)(\/history)?$/);
  if (match) {
    const database = decodeURIComponent(match[1]);
    const personId = decodeURIComponent(match[2]);
    return match[3] ? playerHistory(database, personId) : playerDetail(database, personId);
  }
  throw new Error(`Unsupported local API route: ${path}`);
}
