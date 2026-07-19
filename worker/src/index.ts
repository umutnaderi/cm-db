import { createClient } from "@libsql/client/web";
import leagueMapData from "./league-map.json";
import nameTokenIndexData from "./name-token-index.json";

type Env = {
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  ALLOWED_ORIGIN: string;
  ALLOWED_ORIGIN_PROD: string;
  PLAYER_PROFILES_ENABLED?: string;
};

type QueryRow = Record<string, unknown>;
type LeagueMap = Record<string, Record<string, string>>;
type NameTokenIndex = Record<string, Record<string, QueryRow[]>>;

const leagueMap = leagueMapData as LeagueMap;
const nameTokenIndex = nameTokenIndexData as NameTokenIndex;
const resolvedLeagueMap: LeagueMap = {
  ...leagueMap,
  cm0203_vanilla_original: {
    ...leagueMap.cm0304_vanilla_original,
    ...leagueMap.cm0203_vanilla_original,
  },
};

function canonicalDatabaseSlug(slug: string): string {
  if (slug === "cm0203") return "cm0203_vanilla_original";
  if (slug === "cm0304") return "cm0304_vanilla_original";
  return slug;
}

function leagueForClub(database: string, club: unknown): string {
  return resolvedLeagueMap[canonicalDatabaseSlug(database)]?.[String(club || "").trim()] || "";
}

function clubsForLeague(database: string, league: string): string[] {
  return Object.entries(resolvedLeagueMap[canonicalDatabaseSlug(database)] || {})
    .filter(([, clubLeague]) => clubLeague === league)
    .map(([club]) => club);
}

function staticNameFallbackRows(
  database: string,
  tokens: string[],
  filters: {
    club?: string | null;
    nation?: string | null;
    leagueClubs?: string[];
    position?: string | null;
  },
): QueryRow[] {
  const databaseIndex = nameTokenIndex[canonicalDatabaseSlug(database)] || nameTokenIndex[database];
  if (!databaseIndex || !tokens.length) return [];

  let rows = databaseIndex[tokens[0]] || [];
  for (const token of tokens.slice(1)) {
    const keys = new Set((databaseIndex[token] || []).map((row) => `${row.database_slug}:${row.source_person_id}`));
    rows = rows.filter((row) => keys.has(`${row.database_slug}:${row.source_person_id}`));
  }

  if (filters.club) {
    rows = rows.filter((row) => textField(row, "club_name") === filters.club);
  }
  if (filters.nation) {
    rows = rows.filter((row) => textField(row, "nation_name") === filters.nation);
  }
  if (filters.position) {
    const normalizedPosition = filters.position.toLowerCase();
    rows = rows.filter((row) => textField(row, "position_text").toLowerCase().includes(normalizedPosition));
  }
  if (filters.leagueClubs?.length) {
    const clubSet = new Set(filters.leagueClubs);
    rows = rows.filter((row) => clubSet.has(textField(row, "club_name")));
  }

  return rows.slice().sort((left, right) =>
    numberField(right, "current_ability") - numberField(left, "current_ability")
    || numberField(right, "potential_ability") - numberField(left, "potential_ability")
    || textField(left, "full_name").localeCompare(textField(right, "full_name")),
  );
}

function json(data: unknown, env: Env, status = 200, cacheSeconds = 60): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": env.ALLOWED_ORIGIN || env.ALLOWED_ORIGIN_PROD || "*",
      "access-control-allow-methods": "GET, OPTIONS",
      "access-control-allow-headers": "content-type",
      "cache-control": `public, max-age=${cacheSeconds}`,
    },
  });
}

async function cachedJson(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  cacheSeconds: number,
  producer: () => Promise<unknown>,
): Promise<Response> {
  if (request.method !== "GET" || cacheSeconds <= 0) {
    return json(await producer(), env, 200, cacheSeconds);
  }

  const cache = caches.default;
  const cacheKey = new Request(request.url, request);
  const cached = await cache.match(cacheKey);

  if (cached) {
    return cached;
  }

  const response = json(await producer(), env, 200, cacheSeconds);
  ctx.waitUntil(cache.put(cacheKey, response.clone()));
  return response;
}

async function matchEdgeCache(request: Request): Promise<Response | undefined> {
  if (request.method !== "GET") return undefined;
  const cached = await caches.default.match(edgeCacheKey(request));
  if (!cached) return undefined;

  const response = new Response(cached.body, cached);
  response.headers.set("x-retroball-cache", "HIT");
  return response;
}

function storeEdgeCache(
  request: Request,
  response: Response,
  ctx: ExecutionContext,
): Response {
  if (request.method !== "GET" || !response.ok) return response;
  response.headers.set("x-retroball-cache", "MISS");
  ctx.waitUntil(caches.default.put(edgeCacheKey(request), response.clone()));
  return response;
}

function edgeCacheKey(request: Request | string): Request {
  const url = new URL(typeof request === "string" ? request : request.url);
  url.searchParams.set("__cacheVersion", "13");
  return new Request(url, typeof request === "string" ? undefined : request);
}

function cleanPageSize(value: string | null): number {
  const n = Number(value || 50);
  return Math.min(Math.max(Number.isFinite(n) ? n : 50, 1), 100);
}

function cleanPage(value: string | null): number {
  const n = Number(value || 1);
  return Math.max(Number.isFinite(n) ? n : 1, 1);
}

function normalizeSearchTokens(input: string, stripDiacritics: boolean): string[] {
  const value = stripDiacritics
    ? input.normalize("NFKD").replace(/\p{M}/gu, "")
    : input;

  return value
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter((token) => token.length >= 2)
    .filter(Boolean);
}

function indexedNamePrefix(input: string): string {
  return input
    .normalize("NFC")
    .trim()
    .split(/\s+/)
    .map((part) =>
      part.charAt(0).toLocaleUpperCase("en") + part.slice(1).toLocaleLowerCase("en")
    )
    .join(" ");
}

function textField(row: QueryRow, name: string): string {
  const value = row[name];
  if (value === null || value === undefined) {
    return "";
  }
  return String(value).trim();
}

function numberField(row: QueryRow, name: string): number {
  const value = Number(row[name]);
  return Number.isFinite(value) ? value : 0;
}

function searchResultKey(row: QueryRow): string {
  return `${textField(row, "database_slug")}:${textField(row, "source_person_id")}`;
}

function searchNameRank(row: QueryRow, query: string): number {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) return 2;

  const display = textField(row, "display_name").toLowerCase();
  const full = textField(row, "full_name").toLowerCase();
  const common = textField(row, "common_name").toLowerCase();

  if (display === normalizedQuery || full === normalizedQuery || common === normalizedQuery) {
    return 0;
  }
  if (
    display.startsWith(normalizedQuery)
    || full.startsWith(normalizedQuery)
    || common.startsWith(normalizedQuery)
  ) {
    return 1;
  }
  return 2;
}

function sortPlayerSearchRows(rows: QueryRow[], query: string, isSingleTokenQuery: boolean): QueryRow[] {
  return rows.slice().sort((left, right) => {
    const leftRank = searchNameRank(left, query);
    const rightRank = searchNameRank(right, query);
    const abilityDelta = numberField(right, "current_ability") - numberField(left, "current_ability");
    const potentialDelta = numberField(right, "potential_ability") - numberField(left, "potential_ability");
    const nameDelta = textField(left, "full_name").localeCompare(textField(right, "full_name"));

    if (isSingleTokenQuery) {
      return abilityDelta || leftRank - rightRank || potentialDelta || nameDelta;
    }
    return leftRank - rightRank || abilityDelta || potentialDelta || nameDelta;
  });
}

function playerSearchSelectColumns(alias = "ps"): string {
  return `
    SELECT
      ${alias}.database_slug,
      ${alias}.source_person_id,
      ${alias}.display_name,
      ${alias}.full_name,
      ${alias}.common_name,
      ${alias}.club_name,
      ${alias}.nation_name,
      ${alias}.date_of_birth,
      ${alias}.position_text,
      ${alias}.current_ability,
      ${alias}.potential_ability,
      ${alias}.value,
      ${alias}.wage
    FROM player_search ${alias}
  `;
}

function normalizedName(value: unknown): string {
  return normalizeSearchTokens(String(value || ""), true).join(" ");
}

function playerNameVariants(row: QueryRow): string[] {
  const variants = [
    normalizedName(row.display_name),
    normalizedName(row.full_name),
    normalizedName(row.common_name),
  ].filter(Boolean);
  const expanded = new Set<string>();

  for (const variant of variants) {
    expanded.add(variant);
    const tokens = variant.split(" ");
    if (tokens.length === 2) {
      expanded.add(tokens.slice().reverse().join(" "));
    }
  }

  return [...expanded];
}

function seasonQueryTokens(row: QueryRow): string[] {
  const variants = playerNameVariants(row)
    .map((variant) => variant.split(" ").filter(Boolean))
    .sort((left, right) => {
      const score = (tokens: string[]) => {
        if (tokens.length === 2) {
          return 0;
        }
        if (tokens.length === 3 || tokens.length === 4) {
          return 1;
        }
        if (tokens.length === 1) {
          return 2;
        }
        return 3;
      };
      const leftScore = score(left);
      const rightScore = score(right);
      return leftScore - rightScore || left.length - right.length;
    });

  return variants[0]?.slice(0, 4) || [];
}

function seasonExactNames(row: QueryRow): string[] {
  const names = [row.display_name, row.full_name, row.common_name]
    .map((value) => String(value || "").trim())
    .filter(Boolean);
  const variants = new Set(names);

  for (const name of names) {
    const parts = name.split(/\s+/);
    if (parts.length === 2) variants.add(parts.reverse().join(" "));
  }

  return [...variants];
}

function seasonNameTokenCompatible(target: QueryRow, candidate: QueryRow): boolean {
  const targetTokens = new Set(
    playerNameVariants(target)
      .flatMap((name) => name.split(" "))
      .filter((token) => token.length >= 3),
  );
  const candidateTokens = new Set(
    playerNameVariants(candidate)
      .flatMap((name) => name.split(" "))
      .filter((token) => token.length >= 3),
  );

  return [...targetTokens].some((token) => candidateTokens.has(token));
}

function normalizeNation(value: unknown): string {
  const nation = normalizedName(value);
  return nation === "holland" ? "netherlands" : nation;
}

function parsePlayerDate(value: unknown): { time: number; year: number } | null {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  let match = text.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (match) {
    const [, yearText, monthText, dayText] = match;
    const year = Number(yearText);
    const time = Date.UTC(year, Number(monthText) - 1, Number(dayText));
    return Number.isNaN(time) ? null : { time, year };
  }

  match = text.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/);
  if (match) {
    const [, dayText, monthText, yearText] = match;
    const shortYear = Number(yearText);
    const year = yearText.length === 2
      ? (shortYear >= 30 ? 1900 + shortYear : 2000 + shortYear)
      : shortYear;
    const time = Date.UTC(year, Number(monthText) - 1, Number(dayText));
    return Number.isNaN(time) ? null : { time, year };
  }

  return null;
}

function datesCompatible(target: QueryRow, candidate: QueryRow): boolean {
  const targetDate = parsePlayerDate(target.date_of_birth);
  const candidateDate = parsePlayerDate(candidate.date_of_birth);

  if (!targetDate || !candidateDate) {
    return false;
  }

  const day = 24 * 60 * 60 * 1000;
  return targetDate.year === candidateDate.year
    && Math.abs(targetDate.time - candidateDate.time) <= day;
}

function birthYearsCompatible(target: QueryRow, candidate: QueryRow): boolean {
  const targetDate = parsePlayerDate(target.date_of_birth);
  const candidateDate = parsePlayerDate(candidate.date_of_birth);

  return Boolean(targetDate && candidateDate && targetDate.year === candidateDate.year);
}

function seasonCandidateScore(target: QueryRow, candidate: QueryRow): number {
  const sameRow = textField(target, "database_slug") === textField(candidate, "database_slug")
    && textField(target, "source_person_id") === textField(candidate, "source_person_id");
  if (sameRow) {
    return 10_000;
  }

  const targetNames = new Set(playerNameVariants(target));
  const candidateNames = playerNameVariants(candidate);
  const exactName = candidateNames.some((name) => targetNames.has(name));
  const tokenName = seasonNameTokenCompatible(target, candidate);
  if (!exactName && !tokenName) {
    return 0;
  }

  const sameNation = normalizeNation(target.nation_name) === normalizeNation(candidate.nation_name);
  const dateOk = datesCompatible(target, candidate);
  const sameBirthYear = birthYearsCompatible(target, candidate);
  const targetHasDate = Boolean(parsePlayerDate(target.date_of_birth));
  const candidateHasDate = Boolean(parsePlayerDate(candidate.date_of_birth));

  if (dateOk) {
    return (exactName ? 900 : 850) + numberField(candidate, "current_ability");
  }

  if (sameNation && sameBirthYear) {
    return (exactName ? 800 : 750) + numberField(candidate, "current_ability");
  }

  if (exactName && sameNation && (!targetHasDate || !candidateHasDate)) {
    return 700 + numberField(candidate, "current_ability");
  }

  return 0;
}

function seasonLabelFromTitle(title: unknown): string {
  const text = String(title || "");
  const match = text.match(/(\d{2})\/(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : text;
}

function parseJsonField(value: unknown, fallback: unknown): unknown {
  if (typeof value !== "string" || !value) {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const RATING_LABELS: Record<string, string> = {
  aerial_ability: "Aerial Ability",
  command_of_area: "Command Of Area",
  communication: "Communication",
  free_kicks: "Free Kicks",
  important_matches: "Important Matches",
  injury_proneness: "Injury Proneness",
  left_foot: "Left Foot",
  long_shots: "Long Shots",
  long_throws: "Long Throws",
  natural_fitness: "Natural Fitness",
  off_the_ball: "Off the Ball",
  one_on_ones: "One On Ones",
  right_foot: "Right Foot",
  set_pieces: "Free Kicks",
  tendency_to_punch: "Tendency To Punch",
  throw_ins: "Throw Ins",
  work_rate: "Work Rate",
  creativity: "Vision",
  influence: "Leadership",
  loyality: "Loyalty",
};

const POSITION_LABELS: Record<string, string> = {
  goalkeeper: "Goalkeeper",
  sweeper: "Sweeper",
  defender: "Defender",
  defensive_midfielder: "Def Midfielder",
  midfielder: "Midfielder",
  attacking_midfielder: "Att Midfielder",
  attacker: "Attacker",
  wing_back: "Wing back",
  free_role: "Free role",
  right_side: "Right side",
  left_side: "Left side",
  central: "Central",
};

function humanRatingLabel(key: string, labels: Record<string, string>): string {
  if (labels[key]) {
    return labels[key];
  }

  return key
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function ratingListFromJson(value: unknown, labels: Record<string, string> = RATING_LABELS) {
  const parsed = parseJsonField(value, []);

  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (!parsed || typeof parsed !== "object") {
    return [];
  }

  return Object.entries(parsed as Record<string, unknown>).map(([key, itemValue]) => ({
    label: humanRatingLabel(key, labels),
    value: itemValue,
  }));
}

function playerProfileFromRow(row: Record<string, unknown> | undefined) {
  if (!row) {
    return null;
  }

  const profileData = parseJsonField(row.profile_json, {}) as Record<string, unknown>;
  const ratingsFromColumns = {
    current_ability: row.current_ability,
    potential_ability: row.potential_ability,
    home_reputation: row.home_reputation,
    current_reputation: row.current_reputation,
    world_reputation: row.world_reputation,
    caps: row.caps,
    international_goals: row.international_goals,
    squad_number: row.squad_number,
    value: row.value,
    wage: row.wage,
  };
  const profileRatings =
    typeof profileData.ratings === "object" && profileData.ratings !== null
      ? profileData.ratings
      : Object.keys(ratingsFromColumns).some((key) => row[key] !== null && row[key] !== undefined)
        ? ratingsFromColumns
        : parseJsonField(row.ratings_json, {});
  const positionRatings = parseJsonField(
    row.position_ratings_json ?? row.positions_json,
    [],
  );
  const foot = ratingListFromJson(row.foot_json);

  return {
    source_person_id: row.source_person_id,
    source_player_id: row.source_player_id ?? row.player_id,
    display_name: row.display_name,
    full_name: row.full_name,
    common_name: row.common_name,
    club_name: row.club_name,
    nation_name: row.nation_name,
    date_of_birth: row.date_of_birth,
    age: row.season_age ?? row.age,
    position_text: row.position_text,
    current_ability: row.current_ability,
    potential_ability: row.potential_ability,
    ratings: profileRatings,
    positions: Array.isArray(positionRatings)
      ? positionRatings
      : ratingListFromJson(row.position_ratings_json ?? row.positions_json, POSITION_LABELS),
    sides: parseJsonField(row.sides_json, []),
    positionRatings: Array.isArray(positionRatings)
      ? positionRatings
      : ratingListFromJson(row.position_ratings_json ?? row.positions_json, POSITION_LABELS),
    attributes: ratingListFromJson(row.attributes_json),
    hiddenAttributes: ratingListFromJson(row.hidden_attributes_json),
    foot,
    profile: profileData,
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return json({}, env);
    }

    const url = new URL(request.url);

    if (!env.TURSO_DATABASE_URL) {
      return json(
        {
          error: "Missing TURSO_DATABASE_URL. Add it to worker/.dev.vars",
        },
        env,
        500,
      );
    }

    if (!env.TURSO_AUTH_TOKEN) {
      return json(
        {
          error: "Missing TURSO_AUTH_TOKEN. Add it to worker/.dev.vars",
        },
        env,
        500,
      );
    }

    const db = createClient({
      url: env.TURSO_DATABASE_URL,
      authToken: env.TURSO_AUTH_TOKEN,
    });

    try {
      if (url.pathname === "/api/databases") {
        return cachedJson(request, env, ctx, 86_400, async () => {
          const result = await db.execute(`
            SELECT slug, title, season_order, status
            FROM cm_databases
            ORDER BY season_order
          `);

          return { items: result.rows };
        });
      }

      if (url.pathname === "/api/players") {
        const database = url.searchParams.get("database");
        const q = url.searchParams.get("q") || "";
        const trimmedQ = q.trim();
        const club = url.searchParams.get("club");
        const nation = url.searchParams.get("nation");
        const league = url.searchParams.get("league");
        const leagueClubs = league ? clubsForLeague(database || "", league) : [];
        const position = url.searchParams.get("position");
        const page = cleanPage(url.searchParams.get("page"));
        const pageSize = cleanPageSize(url.searchParams.get("pageSize"));
        const offset = (page - 1) * pageSize;

        if (!database) {
          return json({ error: "database is required" }, env, 400);
        }

        const cachedSearch = await matchEdgeCache(request);
        if (cachedSearch) return cachedSearch;

        const orderArgs: Array<string | number> = [];
        // Match idx_player_search_name's BINARY collation so SQLite can stream
        // the first page from the index instead of sorting an entire season.
        let orderBy = "ps.full_name";

        if (trimmedQ) {
          const isSingleTokenQuery = normalizeSearchTokens(trimmedQ, true).length === 1;
          const nameRank = `
            CASE
              WHEN lower(coalesce(ps.display_name, '')) = lower(?) THEN 0
              WHEN lower(coalesce(ps.full_name, '')) = lower(?) THEN 0
              WHEN lower(coalesce(ps.display_name, '')) LIKE lower(?) THEN 1
              WHEN lower(coalesce(ps.full_name, '')) LIKE lower(?) THEN 1
              WHEN lower(coalesce(ps.common_name, '')) LIKE lower(?) THEN 1
              ELSE 2
            END
          `;
          orderBy = isSingleTokenQuery
            ? `
              coalesce(ps.current_ability, 0) DESC,
              ${nameRank},
              ps.full_name
            `
            : `
              ${nameRank},
              coalesce(ps.current_ability, 0) DESC,
              ps.full_name
            `;
          orderArgs.push(
            trimmedQ,
            trimmedQ,
            `${trimmedQ}%`,
            `${trimmedQ}%`,
            `${trimmedQ}%`,
          );
        }

        const selectColumns = playerSearchSelectColumns();

        const buildTermSearchQuery = (tokens: string[]) => {
          const termSql = tokens
            .map((_, index) => `
              SELECT player_search_id, ${index} AS token_index
              FROM player_search_terms
              WHERE database_slug = ?
                AND term >= ?
                AND term < ?
            `)
            .join(" UNION ");
          const termArgs = tokens.flatMap((token) => [
            database,
            token,
            `${token}\uffff`,
          ]);
          const args: Array<string | number> = [database, ...termArgs, tokens.length];
          const where: string[] = [
            "ps.database_slug = ?",
            `
              ps.id IN (
                SELECT player_search_id
                FROM (${termSql}) token_matches
                GROUP BY player_search_id
                HAVING count(DISTINCT token_index) = ?
              )
            `,
          ];

          if (club) {
            where.push("ps.club_name = ?");
            args.push(club);
          }

          if (nation) {
            where.push("ps.nation_name = ?");
            args.push(nation);
          }

          if (position) {
            where.push("ps.position_text LIKE ?");
            args.push(`%${position}%`);
          }
          if (league) {
            if (leagueClubs.length) {
              where.push(`ps.club_name IN (${leagueClubs.map(() => "?").join(", ")})`);
              args.push(...leagueClubs);
            } else {
              where.push("0 = 1");
            }
          }

          return {
            sql: `
              ${selectColumns}
              WHERE ${where.join(" AND ")}
              ORDER BY ${orderBy}
              LIMIT ? OFFSET ?
            `,
            args: [...args, ...orderArgs, pageSize, offset],
          };
        };

        const buildFtsSearchQuery = (tokens: string[]) => {
          const ftsQuery = tokens.map((token) => `${token}*`).join(" ");
          const args: Array<string | number> = [ftsQuery, database];
          const where: string[] = [
            "player_search_fts MATCH ?",
            "ps.database_slug = ?",
          ];

          if (club) {
            where.push("ps.club_name = ?");
            args.push(club);
          }

          if (nation) {
            where.push("ps.nation_name = ?");
            args.push(nation);
          }

          if (position) {
            where.push("ps.position_text LIKE ?");
            args.push(`%${position}%`);
          }
          if (league) {
            if (leagueClubs.length) {
              where.push(`ps.club_name IN (${leagueClubs.map(() => "?").join(", ")})`);
              args.push(...leagueClubs);
            } else {
              where.push("0 = 1");
            }
          }

          return {
            sql: `
              ${selectColumns}
              JOIN player_search_fts f
                ON f.rowid = ps.rowid
              WHERE ${where.join(" AND ")}
              ORDER BY ${orderBy}
              LIMIT ? OFFSET ?
            `,
            args: [...args, ...orderArgs, pageSize, offset],
          };
        };

        const buildLegacySearchQuery = (tokens: string[]) => {
          const args: Array<string | number> = [database];
          const where: string[] = ["ps.database_slug = ?"];

          for (const token of tokens) {
            where.push("lower(ps.search_blob) LIKE ?");
            args.push(`%${token}%`);
          }

          if (club) {
            where.push("ps.club_name = ?");
            args.push(club);
          }

          if (nation) {
            where.push("ps.nation_name = ?");
            args.push(nation);
          }

          if (position) {
            where.push("ps.position_text LIKE ?");
            args.push(`%${position}%`);
          }
          if (league) {
            if (leagueClubs.length) {
              where.push(`ps.club_name IN (${leagueClubs.map(() => "?").join(", ")})`);
              args.push(...leagueClubs);
            } else {
              where.push("0 = 1");
            }
          }

          return {
            sql: `
              ${selectColumns}
              WHERE ${where.join(" AND ")}
              ORDER BY ${orderBy}
              LIMIT ? OFFSET ?
            `,
            args: [...args, ...orderArgs, pageSize, offset],
          };
        };

        const buildIndexedNameQuery = (
          field: "display_name" | "full_name",
          limit: number,
          queryOffset = 0,
        ) => {
          const prefix = indexedNamePrefix(trimmedQ);
          const args: Array<string | number> = [database, prefix, `${prefix}\uffff`];
          const where = [
            "ps.database_slug = ?",
            `ps.${field} >= ?`,
            `ps.${field} < ?`,
          ];

          if (club) {
            where.push("ps.club_name = ?");
            args.push(club);
          }
          if (nation) {
            where.push("ps.nation_name = ?");
            args.push(nation);
          }
          if (position) {
            where.push("ps.position_text LIKE ?");
            args.push(`%${position}%`);
          }
          if (league) {
            if (leagueClubs.length) {
              where.push(`ps.club_name IN (${leagueClubs.map(() => "?").join(", ")})`);
              args.push(...leagueClubs);
            } else {
              where.push("0 = 1");
            }
          }

          return {
            sql: `
              ${selectColumns}
              WHERE ${where.join(" AND ")}
              ORDER BY ${orderBy}
              LIMIT ? OFFSET ?
            `,
            args: [...args, ...orderArgs, limit, queryOffset],
          };
        };

        let result;

        if (trimmedQ) {
          const normalizedTokens = normalizeSearchTokens(trimmedQ, true);

          if (!normalizedTokens.length) {
            return json({ items: [], page, pageSize }, env);
          }

          const isSingleTokenQuery = normalizedTokens.length === 1;
          const mergeLimit = Math.min(Math.max(offset + pageSize, pageSize) * 3, 120);
          const [displayResult, fullResult] = await Promise.all([
            db.execute(buildIndexedNameQuery("display_name", mergeLimit)),
            db.execute(buildIndexedNameQuery("full_name", mergeLimit)),
          ]);

          const mergedRowsByKey = new Map<string, QueryRow>();
          for (const row of [...displayResult.rows, ...fullResult.rows]) {
            mergedRowsByKey.set(searchResultKey(row), row);
          }
          const fallbackRows = staticNameFallbackRows(database, normalizedTokens, {
            club,
            nation,
            leagueClubs,
            position,
          });
          for (const row of fallbackRows) {
            mergedRowsByKey.set(searchResultKey(row), row);
          }
          const mergedRows = sortPlayerSearchRows([...mergedRowsByKey.values()], trimmedQ, isSingleTokenQuery);
          result = {
            rows: mergedRows.slice(offset, offset + pageSize),
          };

          if (!result.rows.length && page === 1) {
            result = {
              rows: fallbackRows.slice(offset, offset + pageSize),
            };
          }
        } else {
          result = await db.execute(buildLegacySearchQuery([]));
        }

        return storeEdgeCache(request, json(
          {
            items: result.rows,
            page,
            pageSize,
          },
          env,
          200,
          3_600,
        ), ctx);
      }

      if (url.pathname === "/api/player-seasons") {
        const database = url.searchParams.get("database");
        const sourcePersonId = url.searchParams.get("sourcePersonId");

        if (!database || !sourcePersonId) {
          return json({ error: "database and sourcePersonId are required" }, env, 400);
        }

        const cached = await matchEdgeCache(request);
        if (cached) return cached;

        const selectedResult = await db.execute({
          sql: `
              SELECT *
              FROM player_search
              WHERE database_slug = ?
                AND source_person_id = ?
              LIMIT 1
            `,
          args: [database, sourcePersonId],
        });
        const selectedPlayer = selectedResult.rows[0] as QueryRow | undefined;

        if (!selectedPlayer) {
          return json({ items: [] }, env);
        }

        const exactNames = seasonExactNames(selectedPlayer);
        const queryTokens = seasonQueryTokens(selectedPlayer);
        if (!exactNames.length && !queryTokens.length) {
          return json({ items: [] }, env);
        }

        const selectSeasonColumns = `
          SELECT
            ps.database_slug,
            ps.source_person_id,
            ps.display_name,
            ps.full_name,
            ps.common_name,
            ps.club_name,
            ps.nation_name,
            ps.date_of_birth,
            ps.position_text,
            ps.current_ability,
            ps.potential_ability,
            ps.value,
            ps.wage,
            cd.title,
            cd.season_order
          FROM player_search ps
          LEFT JOIN cm_databases cd
            ON cd.slug = CASE ps.database_slug
              WHEN 'cm0203' THEN 'cm0203_vanilla_original'
              WHEN 'cm0304' THEN 'cm0304_vanilla_original'
              ELSE ps.database_slug
            END
        `;
        const exactNameClauses = exactNames.length
          ? [
            `ps.full_name IN (${exactNames.map(() => "?").join(", ")})`,
            `ps.display_name IN (${exactNames.map(() => "?").join(", ")})`,
            `ps.common_name IN (${exactNames.map(() => "?").join(", ")})`,
          ]
          : [];
        const exactNameArgs = exactNames.length
          ? [...exactNames, ...exactNames, ...exactNames]
          : [];
        const candidateClauses = [...exactNameClauses];
        const candidateArgs: Array<string | number> = [...exactNameArgs];

        if (queryTokens.length && textField(selectedPlayer, "nation_name")) {
          candidateClauses.push(`
            (
              ps.nation_name = ?
              ${queryTokens.map(() => "AND lower(ps.search_blob) LIKE ?").join("\n")}
            )
          `);
          candidateArgs.push(
            textField(selectedPlayer, "nation_name"),
            ...queryTokens.map((token) => `%${token}%`),
          );
        }

        const candidates = await db.execute({
          sql: `
            ${selectSeasonColumns}
            WHERE ps.database_slug IN (
              SELECT slug FROM cm_databases
              UNION ALL SELECT 'cm0203'
              UNION ALL SELECT 'cm0304'
            )
              AND (${candidateClauses.join(" OR ")})
            ORDER BY cd.season_order, coalesce(ps.current_ability, 0) DESC
            LIMIT 500
          `,
          args: candidateArgs,
        });

        const selectedDatabaseResult = await db.execute({
          sql: `
            SELECT title, season_order
            FROM cm_databases
            WHERE slug = ?
            LIMIT 1
          `,
          args: [database],
        });
        const selectedDatabase = selectedDatabaseResult.rows[0] as QueryRow | undefined;
        const currentEntry = {
          ...selectedPlayer,
          title: selectedDatabase?.title,
          season_order: selectedDatabase?.season_order,
        };
        const bestByDatabase = new Map<string, { row: QueryRow; score: number }>();

        for (const row of [currentEntry, ...(candidates.rows as QueryRow[])]) {
          const score = seasonCandidateScore(selectedPlayer, row);
          const slug = textField(row, "database_slug");
          if (!score || !slug) {
            continue;
          }

          const previous = bestByDatabase.get(slug);
          if (!previous || score > previous.score) {
            bestByDatabase.set(slug, { row, score });
          }
        }

        const items = [...bestByDatabase.values()]
          .map(({ row }) => ({
            database_slug: row.database_slug,
            source_person_id: row.source_person_id,
            display_name: row.display_name,
            full_name: row.full_name,
            common_name: row.common_name,
            club_name: row.club_name,
            nation_name: row.nation_name,
            age: row.age ?? row.season_age,
            date_of_birth: row.date_of_birth,
            position_text: row.position_text,
            current_ability: row.current_ability,
            potential_ability: row.potential_ability,
            value: row.value,
            wage: row.wage,
            title: row.title,
            label: seasonLabelFromTitle(row.title),
            season_order: row.season_order,
          }))
          .sort((left, right) =>
            Number(left.season_order || 0) - Number(right.season_order || 0)
            || String(left.title || "").localeCompare(String(right.title || "")),
          );

        const response = storeEdgeCache(
          request,
          json({ items }, env, 200, 86_400),
          ctx,
        );
        const aliasWrites = items.map((item) => {
          const aliasUrl = new URL("/api/player-seasons", request.url);
          aliasUrl.searchParams.set("database", String(item.database_slug));
          aliasUrl.searchParams.set("sourcePersonId", String(item.source_person_id));
          return caches.default.put(edgeCacheKey(aliasUrl.toString()), response.clone());
        });
        if (aliasWrites.length) ctx.waitUntil(Promise.all(aliasWrites));
        return response;
      }

      const playerMatch = url.pathname.match(
        /^\/api\/players\/([^/]+)\/([^/]+)$/,
      );

      if (playerMatch) {
        const [, database, sourcePersonId] = playerMatch;

        const cached = await matchEdgeCache(request);
        if (cached) return cached;

        const result = await db.execute({
          sql: `
              ${playerSearchSelectColumns()}
              WHERE ps.database_slug = ?
                AND ps.source_person_id = ?
              LIMIT 1
            `,
          args: [database, sourcePersonId],
        });

        const item = result.rows[0] as QueryRow | undefined;
        let profile = null;

        if (item) {
          const mappedLeague = leagueForClub(database, item.club_name);
          if (mappedLeague) {
            item.league_name = mappedLeague;
          } else {
            const leagueResult = await db.execute({
              sql: `
                SELECT json_extract(raw_json, '$.division_name') AS league_name
                FROM clubs
                WHERE database_slug = ? AND name = ?
                LIMIT 1
              `,
              args: [database, textField(item, "club_name")],
            });
            item.league_name = leagueResult.rows[0]?.league_name ?? null;
          }

          try {
            const profileResult = await db.execute({
              sql: `
                SELECT *
                FROM player_profile
                WHERE database_slug = ?
                  AND source_person_id = ?
                LIMIT 1
              `,
              args: [database, sourcePersonId],
            });
            profile = playerProfileFromRow(
              profileResult.rows[0] as Record<string, unknown> | undefined,
            );
          } catch (error) {
            if (
              !(error instanceof Error) ||
              !/no such table: player_profile/i.test(error.message)
            ) {
              throw error;
            }

            try {
              const legacyProfileResult = await db.execute({
                sql: `
                  SELECT *
                  FROM player_profiles
                  WHERE database_slug = ?
                    AND source_person_id = ?
                  LIMIT 1
                `,
                args: [database, sourcePersonId],
              });
              profile = playerProfileFromRow(
                legacyProfileResult.rows[0] as Record<string, unknown> | undefined,
              );
            } catch (legacyError) {
              if (
                !(legacyError instanceof Error) ||
                !/no such table: player_profiles/i.test(legacyError.message)
              ) {
                throw legacyError;
              }
            }
          }
        }

        return storeEdgeCache(request, json(
          {
            item: item ? { ...item, profile } : null,
            profile,
          },
          env,
          200,
          item ? 86_400 : 60,
        ), ctx);
      }

      const historyMatch = url.pathname.match(
        /^\/api\/players\/([^/]+)\/([^/]+)\/history$/,
      );

      if (historyMatch) {
        const [, database, sourcePersonId] = historyMatch;

        const cached = await matchEdgeCache(request);
        if (cached) return cached;

        let result;

        try {
          result = await db.execute({
            sql: `
              SELECT
                season_year,
                club_id,
                club_name,
                league_name,
                apps,
                goals,
                on_loan
              FROM person_history
              WHERE database_slug = ?
                AND source_person_id = ?
              ORDER BY season_year
            `,
            args: [database, sourcePersonId],
          });
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !/no such column: league_name/i.test(error.message)
          ) {
            throw error;
          }

          result = await db.execute({
            sql: `
              SELECT
                season_year,
                club_id,
                club_name,
                (
                  SELECT json_extract(c.raw_json, '$.division_name')
                  FROM clubs c
                  WHERE c.database_slug = person_history.database_slug
                    AND c.name = person_history.club_name
                  LIMIT 1
                ) AS league_name,
                apps,
                goals,
                on_loan
              FROM person_history
              WHERE database_slug = ?
                AND source_person_id = ?
              ORDER BY season_year
            `,
            args: [database, sourcePersonId],
          });
        }

        const historyRows = result.rows.map((row) => ({
          ...row,
          league_name: row.league_name || leagueForClub(database, row.club_name) || null,
        }));

        return storeEdgeCache(
          request,
          json({ items: historyRows }, env, 200, 86_400),
          ctx,
        );
      }

      if (url.pathname === "/api/filters") {
        const database = url.searchParams.get("database");

        if (!database) {
          return json({ error: "database is required" }, env, 400);
        }

        const cached = await matchEdgeCache(request);
        if (cached) return cached;

        return cachedJson(request, env, ctx, 86_400, async () => {
          const clubs = await db.execute({
            sql: `
              SELECT name, nation_name
              FROM (
                SELECT club_name AS name, nation_name
                FROM player_search
                WHERE database_slug = ?
                  AND club_name IS NOT NULL
                  AND club_name <> ''
                UNION
                SELECT name, nation_name
                FROM clubs
                WHERE database_slug = ?
                  AND name IS NOT NULL
                  AND name <> ''
              )
              ORDER BY name COLLATE NOCASE
            `,
            args: [database, database],
          });
          const nations = await db.execute({
            sql: `
              SELECT name
              FROM (
                SELECT nation_name AS name
                FROM player_search
                WHERE database_slug = ?
                  AND nation_name IS NOT NULL
                  AND nation_name <> ''
                UNION
                SELECT name
                FROM nations
                WHERE database_slug = ?
                  AND name IS NOT NULL
                  AND name <> ''
              )
              ORDER BY name COLLATE NOCASE
            `,
            args: [database, database],
          });
          let leagueRows: unknown[] = [];
          try {
            const leagues = await db.execute({
              sql: `
                SELECT DISTINCT league_name AS name
                FROM person_history
                WHERE database_slug = ?
                  AND league_name IS NOT NULL
                  AND league_name <> ''
                ORDER BY league_name COLLATE NOCASE
              `,
              args: [database],
            });
            leagueRows = [...leagues.rows];
          } catch (error) {
            if (
              !(error instanceof Error) ||
              !/no such column: league_name/i.test(error.message)
            ) {
              throw error;
            }
          }

          return {
            clubs: clubs.rows,
            nations: nations.rows,
            leagues: leagueRows,
          };
        });
      }

      if (url.pathname === "/api/clubs") {
        const database = url.searchParams.get("database");

        if (!database) {
          return json({ error: "database is required" }, env, 400);
        }

        const result = await db.execute({
          sql: `
            SELECT DISTINCT name, nation_name
            FROM clubs
            WHERE database_slug = ?
              AND name IS NOT NULL
            ORDER BY name
          `,
          args: [database],
        });

        return json({ items: result.rows }, env);
      }

      return json({ error: "not found" }, env, 404);
    } catch (error) {
      return json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        env,
        500,
      );
    }
  },
};
