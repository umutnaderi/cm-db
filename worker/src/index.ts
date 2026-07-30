import leagueMapData from "./league-map.json";
import nameTokenIndexData from "./name-token-index.json";

type QueryRow = Record<string, unknown>;
type LeagueMap = Record<string, Record<string, string>>;
type NameTokenIndex = Record<string, Record<string, string[]>>;
type QueryInput = string | {
  sql: string;
  args?: Array<string | number | null>;
};

function d1Client(database: D1Database) {
  const prepare = (input: QueryInput) => {
    const sql = typeof input === "string" ? input : input.sql;
    const args = typeof input === "string" ? [] : input.args || [];
    return args.length
      ? database.prepare(sql).bind(...args)
      : database.prepare(sql);
  };

  return {
    async execute(input: QueryInput): Promise<{ rows: QueryRow[] }> {
      const result = await prepare(input).all<QueryRow>();
      return { rows: result.results };
    },
    async batch(inputs: QueryInput[]): Promise<Array<{ rows: QueryRow[] }>> {
      const results = await database.batch<QueryRow>(inputs.map(prepare));
      return results.map((result) => ({ rows: result.results }));
    },
  };
}

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

function staticNameFallbackIds(database: string, tokens: string[]): string[] {
  const databaseIndex = nameTokenIndex[canonicalDatabaseSlug(database)] || nameTokenIndex[database];
  if (!databaseIndex || !tokens.length) return [];

  let sourceIds = databaseIndex[tokens[0]] || [];
  for (const token of tokens.slice(1)) {
    const tokenIds = new Set(databaseIndex[token] || []);
    sourceIds = sourceIds.filter((sourceId) => tokenIds.has(sourceId));
  }

  return [...new Set(sourceIds)];
}

function json(data: unknown, _env: Env, status = 200, cacheSeconds = 60): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, POST, OPTIONS",
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
  const cacheUrl = new URL(request.url);
  cacheUrl.searchParams.set("__retroball_cache", "26");
  const cacheKey = new Request(cacheUrl, request);
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
  url.searchParams.set("__cacheVersion", "34");
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

function normalizeSearchText(input: string, stripDiacritics = true): string {
  let value = input.normalize(stripDiacritics ? "NFKD" : "NFC").toLowerCase();
  if (stripDiacritics) {
    value = value
      .replace(/\p{M}/gu, "")
      // Letters such as Turkish dotless i do not decompose under NFKD.
      .replace(/ı/g, "i")
      .replace(/[ł]/g, "l")
      .replace(/[đð]/g, "d")
      .replace(/þ/g, "th")
      .replace(/æ/g, "ae")
      .replace(/œ/g, "oe")
      .replace(/ø/g, "o");
  }
  return value;
}

function normalizeSearchTokens(input: string, stripDiacritics: boolean): string[] {
  return normalizeSearchText(input, stripDiacritics)
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
  const normalizedQuery = normalizedName(query);
  if (!normalizedQuery) return 4;

  const variants = playerNameVariants(row);
  if (variants.some((variant) => variant === normalizedQuery)) return 0;

  const queryTokens = normalizedQuery.split(" ");
  if (
    variants.some((variant) => {
      const tokens = variant.split(" ");
      return queryTokens.every((queryToken) => tokens.includes(queryToken));
    })
  ) {
    return 1;
  }

  if (variants.some((variant) => variant.startsWith(normalizedQuery))) return 2;
  if (
    variants.some((variant) => {
      const tokens = variant.split(" ");
      return queryTokens.every((queryToken) =>
        tokens.some((token) => token.startsWith(queryToken))
      );
    })
  ) {
    return 3;
  }
  return 4;
}

function sortPlayerSearchRows(rows: QueryRow[], query: string): QueryRow[] {
  return rows.slice().sort((left, right) => {
    const leftRank = searchNameRank(left, query);
    const rightRank = searchNameRank(right, query);
    const abilityDelta = numberField(right, "current_ability") - numberField(left, "current_ability");
    const potentialDelta = numberField(right, "potential_ability") - numberField(left, "potential_ability");
    const nameDelta = textField(left, "full_name").localeCompare(textField(right, "full_name"));

    return leftRank - rightRank || abilityDelta || potentialDelta || nameDelta;
  });
}

function playerSearchBaseColumnList(alias = "ps"): string {
  return `
    ${alias}.database_slug,
    ${alias}.source_person_id,
    ${alias}.display_name,
    ${alias}.full_name,
    ${alias}.common_name,
    ${alias}.club_id,
    ${alias}.club_name,
    ${alias}.nation_name,
    ${alias}.date_of_birth,
    ${alias}.position_text,
    ${alias}.current_ability,
    ${alias}.potential_ability,
    ${alias}.value,
    ${alias}.wage
  `;
}

function playerSearchBaseSelectColumns(alias = "ps"): string {
  return `
    SELECT
      ${playerSearchBaseColumnList(alias)}
    FROM player_search ${alias}
  `;
}

function playerSearchSelectColumns(alias = "ps"): string {
  return `
    SELECT
      ${playerSearchBaseColumnList(alias)},
      canonical_player.canonical_player_id,
      canonical_player.canonical_player_public_id,
      canonical_player.canonical_player_name,
      (
        SELECT names.canonical_club_name
        FROM canonical_club_names names
        WHERE names.database_slug = ${alias}.database_slug
          AND names.source_club_name = ${alias}.club_name
        LIMIT 1
      ) AS canonical_club_name
    FROM player_search ${alias}
    LEFT JOIN canonical_player_names canonical_player
      ON canonical_player.database_slug = ${alias}.database_slug
     AND canonical_player.source_person_id = cast(${alias}.source_person_id AS TEXT)
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
    normalizedName(row.canonical_player_name),
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
    canonical_player_public_id: row.canonical_player_public_id ?? null,
    canonical_player_name: row.canonical_player_name ?? null,
    club_name: row.club_name,
    canonical_club_name: row.canonical_club_name ?? null,
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
    clubColors: null as QueryRow | null,
    profile: profileData,
  };
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    if (request.method === "OPTIONS") {
      return json({}, env);
    }

    const url = new URL(request.url);

    const db = d1Client(env.DB);

    try {
      if (url.pathname === "/api/draft-records") {
        if (request.method === "GET") {
          const result = await env.DB.prepare(`
            SELECT
              id, username, team_name, stage, stage_rank, champion,
              captain_name, captain_database, captain_source_person_id,
              top_scorer_name, top_scorer_database, top_scorer_source_person_id,
              top_scorer_goals, played, wins, draws, losses,
              goals_for, goals_against, updated_at
            FROM draft_records
            ORDER BY
              champion DESC, stage_rank DESC, wins DESC,
              (goals_for - goals_against) DESC, goals_for DESC, updated_at ASC
            LIMIT 50
          `).all<QueryRow>();
          return json({ items: result.results }, env, 200, 0);
        }

        if (request.method !== "POST") {
          return json({ error: "Method not allowed." }, env, 405, 0);
        }

        const body = await request.json<Record<string, unknown>>().catch(() => null);
        const text = (key: string, maximum: number) =>
          typeof body?.[key] === "string" ? String(body[key]).trim().slice(0, maximum) : "";
        const integer = (key: string, maximum = 999) =>
          Math.min(maximum, Math.max(0, Math.trunc(Number(body?.[key]) || 0)));
        const username = text("username", 24);
        const usernameKey = username.toLocaleLowerCase("en-US");
        const runId = text("runId", 80);
        const stage = text("stage", 40);
        const captainName = text("captainName", 100);
        const topScorerName = text("topScorerName", 100);

        if (username.length < 2 || !runId || !stage || !captainName || !topScorerName) {
          return json({ error: "Username and run details are required." }, env, 400, 0);
        }

        await env.DB.prepare(`
          INSERT INTO draft_records (
            run_id, username, username_key, team_name, stage, stage_rank, champion,
            captain_name, captain_database, captain_source_person_id,
            top_scorer_name, top_scorer_database, top_scorer_source_person_id,
            top_scorer_goals, played, wins, draws, losses, goals_for, goals_against
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(run_id, username_key) DO UPDATE SET
            username = excluded.username,
            team_name = excluded.team_name,
            stage = excluded.stage,
            stage_rank = excluded.stage_rank,
            champion = excluded.champion,
            captain_name = excluded.captain_name,
            captain_database = excluded.captain_database,
            captain_source_person_id = excluded.captain_source_person_id,
            top_scorer_name = excluded.top_scorer_name,
            top_scorer_database = excluded.top_scorer_database,
            top_scorer_source_person_id = excluded.top_scorer_source_person_id,
            top_scorer_goals = excluded.top_scorer_goals,
            played = excluded.played,
            wins = excluded.wins,
            draws = excluded.draws,
            losses = excluded.losses,
            goals_for = excluded.goals_for,
            goals_against = excluded.goals_against,
            updated_at = CURRENT_TIMESTAMP
        `).bind(
          runId, username, usernameKey, text("teamName", 60) || "Ultimate XI",
          stage, integer("stageRank", 10), integer("champion", 1),
          captainName, text("captainDatabase", 80) || null,
          text("captainSourcePersonId", 80) || null,
          topScorerName, text("topScorerDatabase", 80) || null,
          text("topScorerSourcePersonId", 80) || null,
          integer("topScorerGoals", 99), integer("played", 20),
          integer("wins", 20), integer("draws", 20), integer("losses", 20),
          integer("goalsFor", 99), integer("goalsAgainst", 99),
        ).run();

        return json({ ok: true }, env, 200, 0);
      }

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

      if (url.pathname === "/api/draft-candidates") {
        const parsedSeed = Number.parseInt(url.searchParams.get("seed") || "0", 10);
        const seed = Number.isFinite(parsedSeed) ? Math.abs(parsedSeed) : 0;
        const parsedLimit = Number.parseInt(
          url.searchParams.get("perDatabase") || "18",
          10,
        );
        const perDatabase = Math.min(30, Math.max(8, parsedLimit || 18));

        return cachedJson(request, env, ctx, 300, async () => {
          const databaseResult = await db.execute(`
            SELECT slug, title, season_order
            FROM cm_databases
            ORDER BY season_order
          `);
          const databases = databaseResult.rows;
          const queries = databases.map((database, index) => {
            const offset = (seed * 31 + (index + 1) * 397) % 2500;
            return {
              sql: `
                SELECT
                  candidates.*,
                  canonical_player.canonical_player_id,
                  canonical_player.canonical_player_public_id,
                  canonical_player.canonical_player_name,
                  profile.position_ratings_json
                FROM (
                  ${playerSearchBaseSelectColumns()}
                  WHERE ps.database_slug = ?
                    AND ps.current_ability IS NOT NULL
                    AND ps.current_ability BETWEEN 60 AND 200
                  ORDER BY
                    ps.current_ability DESC,
                    ps.potential_ability DESC,
                    ps.source_person_id
                  LIMIT ? OFFSET ?
                ) candidates
                LEFT JOIN canonical_player_names canonical_player
                  ON canonical_player.database_slug = candidates.database_slug
                 AND canonical_player.source_person_id = cast(candidates.source_person_id AS TEXT)
                LEFT JOIN player_profile profile
                  ON profile.database_slug = candidates.database_slug
                 AND profile.source_person_id = candidates.source_person_id
              `,
              args: [database.slug as string, perDatabase, offset],
            };
          });
          const results = await db.batch(queries);
          const colourQueries = results.map((result, index) => {
            const clubNames = [...new Set(
              result.rows.map((row) => textField(row, "club_name")).filter(Boolean),
            )];
            const placeholders = clubNames.map(() => "?").join(", ");
            return {
              sql: `
                SELECT
                  names.source_club_name,
                  names.canonical_club_name,
                  colours.background_colour,
                  colours.foreground_colour
                FROM canonical_club_names names
                LEFT JOIN canonical_club_colours colours
                  ON colours.canonical_club_id = names.canonical_club_id
                WHERE names.database_slug = ?
                  ${clubNames.length ? `AND names.source_club_name IN (${placeholders})` : "AND 0"}
                ORDER BY
                  names.source_club_name,
                  CASE WHEN colours.database_slug = ? THEN 0 ELSE 1 END,
                  colours.database_slug
              `,
              args: [
                databases[index]?.slug as string,
                ...clubNames,
                databases[index]?.slug as string,
              ],
            };
          });
          const colourResults = await db.batch(colourQueries);
          const clubThemes = colourResults.map((result) => {
            const themes = new Map<string, QueryRow>();
            for (const row of result.rows) {
              const sourceName = textField(row, "source_club_name");
              if (sourceName && !themes.has(sourceName)) themes.set(sourceName, row);
            }
            return themes;
          });
          const items = results.flatMap((result, index) =>
            result.rows.map((row) => {
              const { position_ratings_json, ...player } = row;
              const clubTheme = clubThemes[index]?.get(textField(row, "club_name"));
              const background = clubTheme?.background_colour;
              const foreground = clubTheme?.foreground_colour;
              return {
                ...player,
                canonical_club_name: clubTheme?.canonical_club_name ?? null,
                database_title: databases[index]?.title,
                season_order: databases[index]?.season_order,
                position_ratings: ratingListFromJson(position_ratings_json),
                club_colors: background && foreground
                  ? {
                      background_colour: background,
                      foreground_colour: foreground,
                    }
                  : null,
              };
            }),
          );

          return { items, databases };
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
        let orderBy = `
          ps.current_ability DESC,
          ps.potential_ability DESC,
          ps.full_name
        `;

        if (trimmedQ) {
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
          orderBy = `
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

        const selectColumns = playerSearchBaseSelectColumns();

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

        const buildFtsSearchQuery = (tokens: string[], limit: number) => {
          const ftsQuery = tokens.map((token) => `${token}*`).join(" ");
          const args: Array<string | number> = [ftsQuery, database, database];
          const where: string[] = [
            "player_name_search_fts MATCH ?",
            "f.database_slug = ?",
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
              JOIN player_name_search_fts f
                ON f.database_slug = ps.database_slug
               AND f.source_person_id = ps.source_person_id
              WHERE ${where.join(" AND ")}
              ORDER BY ${orderBy}
              LIMIT ?
            `,
            args: [...args, ...orderArgs, limit],
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

        const buildCanonicalNameQuery = (limit: number): QueryInput => {
          const prefix = indexedNamePrefix(trimmedQ);
          const args: Array<string | number> = [
            database,
            prefix,
            `${prefix}\uffff`,
          ];
          const where = [
            "canonical_player.database_slug = ?",
            "canonical_player.canonical_player_name >= ?",
            "canonical_player.canonical_player_name < ?",
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
              SELECT
                ${playerSearchBaseColumnList()},
                canonical_player.canonical_player_id,
                canonical_player.canonical_player_public_id,
                canonical_player.canonical_player_name
              FROM canonical_player_names canonical_player
              JOIN player_search ps
                ON ps.database_slug = canonical_player.database_slug
               AND ps.source_person_id = canonical_player.source_person_id
              WHERE ${where.join(" AND ")}
              ORDER BY ${orderBy}
              LIMIT ?
            `,
            args: [...args, ...orderArgs, limit],
          };
        };

        const buildStaticTokenQuery = (sourceIds: string[]): QueryInput => {
          const args: Array<string | number> = [database, ...sourceIds];
          const where = [
            "ps.database_slug = ?",
            `ps.source_person_id IN (${sourceIds.map(() => "?").join(", ")})`,
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
              LIMIT ?
            `,
            args: [...args, ...orderArgs, sourceIds.length],
          };
        };

        let result;

        if (trimmedQ) {
          const normalizedTokens = normalizeSearchTokens(trimmedQ, true);

          if (!normalizedTokens.length) {
            return json({ items: [], page, pageSize }, env);
          }

          const mergeLimit = Math.min(Math.max(offset + pageSize, pageSize) * 3, 120);
          const fallbackIds = staticNameFallbackIds(database, normalizedTokens);
          const searchQueries = [
            buildIndexedNameQuery("display_name", mergeLimit),
            buildIndexedNameQuery("full_name", mergeLimit),
            buildCanonicalNameQuery(mergeLimit),
            buildFtsSearchQuery(normalizedTokens, mergeLimit),
            ...(fallbackIds.length ? [buildStaticTokenQuery(fallbackIds)] : []),
          ];
          const [
            displayResult,
            fullResult,
            canonicalResult,
            ftsResult,
            tokenResult = { rows: [] },
          ] = await db.batch(searchQueries);
          const mergedRowsByKey = new Map<string, QueryRow>();
          for (const row of [
            ...displayResult.rows,
            ...fullResult.rows,
            ...canonicalResult.rows,
            ...ftsResult.rows,
            ...tokenResult.rows,
          ]) {
            mergedRowsByKey.set(searchResultKey(row), row);
          }
          const mergedRows = sortPlayerSearchRows([...mergedRowsByKey.values()], trimmedQ);
          result = {
            rows: mergedRows.slice(offset, offset + pageSize),
          };

          if (!result.rows.length && page === 1) {
            result = {
              rows: tokenResult.rows.slice(offset, offset + pageSize),
            };
          }
        } else {
          result = await db.execute(buildLegacySearchQuery([]));
        }

        if (result.rows.length) {
          const hydrationQueries: QueryInput[] = [];
          const hydrationChunkSize = 25;
          for (let index = 0; index < result.rows.length; index += hydrationChunkSize) {
            const chunk = result.rows.slice(index, index + hydrationChunkSize);
            const requestedValues = chunk.map(() => "(?, ?, ?)").join(", ");
            const requestedArgs = chunk.flatMap((row) => [
              textField(row, "database_slug"),
              textField(row, "source_person_id"),
              textField(row, "club_name"),
            ]);
            hydrationQueries.push({
              sql: `
                WITH requested(database_slug, source_person_id, club_name) AS (
                  VALUES ${requestedValues}
                )
                SELECT
                  requested.database_slug,
                  requested.source_person_id,
                  canonical_player.canonical_player_id,
                  canonical_player.canonical_player_public_id,
                  canonical_player.canonical_player_name,
                  canonical_club.canonical_club_name
                FROM requested
                LEFT JOIN canonical_player_names canonical_player
                  ON canonical_player.database_slug = requested.database_slug
                 AND canonical_player.source_person_id = requested.source_person_id
                LEFT JOIN canonical_club_names canonical_club
                  ON canonical_club.database_slug = requested.database_slug
                 AND canonical_club.source_club_name = requested.club_name
              `,
              args: requestedArgs,
            });
          }
          const canonicalResults = await db.batch(hydrationQueries);
          const canonicalBySource = new Map(
            canonicalResults
              .flatMap((canonicalResult) => canonicalResult.rows)
              .map((row) => [searchResultKey(row), row]),
          );
          result.rows = result.rows.map((row) => {
            const canonical = canonicalBySource.get(searchResultKey(row));
            if (!canonical) return row;
            return {
              ...row,
              canonical_player_id:
                canonical.canonical_player_id ?? row.canonical_player_id ?? null,
              canonical_player_public_id:
                canonical.canonical_player_public_id
                ?? row.canonical_player_public_id
                ?? null,
              canonical_player_name:
                canonical.canonical_player_name ?? row.canonical_player_name ?? null,
              canonical_club_name:
                canonical.canonical_club_name ?? row.canonical_club_name ?? null,
            };
          });
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
              SELECT
                ps.*,
                canonical_player.canonical_player_id,
                canonical_player.canonical_player_public_id,
                canonical_player.canonical_player_name,
                (
                  SELECT names.canonical_club_name
                  FROM canonical_club_names names
                  WHERE names.database_slug = ps.database_slug
                    AND names.source_club_name = ps.club_name
                  LIMIT 1
                ) AS canonical_club_name
              FROM player_search ps
              LEFT JOIN canonical_player_names canonical_player
                ON canonical_player.database_slug = ps.database_slug
               AND canonical_player.source_person_id = cast(ps.source_person_id AS TEXT)
              WHERE ps.database_slug = ?
                AND ps.source_person_id = ?
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
            canonical_player.canonical_player_id,
            canonical_player.canonical_player_public_id,
            canonical_player.canonical_player_name,
            ps.club_name,
            (
              SELECT names.canonical_club_name
              FROM canonical_club_names names
              WHERE names.database_slug = ps.database_slug
                AND names.source_club_name = ps.club_name
              LIMIT 1
            ) AS canonical_club_name,
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
          LEFT JOIN canonical_player_names canonical_player
            ON canonical_player.database_slug = ps.database_slug
           AND canonical_player.source_person_id = cast(ps.source_person_id AS TEXT)
          LEFT JOIN cm_databases cd
            ON cd.slug = CASE ps.database_slug
              WHEN 'cm0203' THEN 'cm0203_vanilla_original'
              WHEN 'cm0304' THEN 'cm0304_vanilla_original'
              ELSE ps.database_slug
            END
        `;
        let candidates;
        const canonicalPlayerId = textField(selectedPlayer, "canonical_player_id");
        if (canonicalPlayerId) {
          candidates = await db.execute({
            sql: `
              ${selectSeasonColumns}
              WHERE canonical_player.canonical_player_id = ?
              ORDER BY cd.season_order, ps.source_person_id
            `,
            args: [canonicalPlayerId],
          });
        } else {
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

          candidates = await db.execute({
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
        }

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
          const score = canonicalPlayerId
            ? 1_000
            : seasonCandidateScore(selectedPlayer, row);
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
            canonical_player_id: row.canonical_player_id,
            canonical_player_public_id: row.canonical_player_public_id,
            canonical_player_name: row.canonical_player_name,
            club_name: row.club_name,
            canonical_club_name: row.canonical_club_name,
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
          const clubResult = await db.execute({
            sql: `
              SELECT
                c.source_club_id,
                json_extract(c.raw_json, '$.division_name') AS league_name,
                coalesce(
                  nullif(c.fore_colour1, ''),
                  json_extract(c.raw_json, '$."Home Text Col"'),
                  json_extract(c.raw_json, '$."Home Col 1"')
                ) AS fore_colour1,
                coalesce(
                  nullif(c.back_colour1, ''),
                  json_extract(c.raw_json, '$."Home Back Col"'),
                  json_extract(c.raw_json, '$."Home Col 2"')
                ) AS back_colour1,
                coalesce(
                  nullif(c.fore_colour2, ''),
                  json_extract(c.raw_json, '$."Away Text Col"'),
                  json_extract(c.raw_json, '$."Away Col 1"')
                ) AS fore_colour2,
                coalesce(
                  nullif(c.back_colour2, ''),
                  json_extract(c.raw_json, '$."Away Back Col"'),
                  json_extract(c.raw_json, '$."Away Col 2"')
                ) AS back_colour2,
                nullif(c.fore_colour3, '') AS fore_colour3,
                nullif(c.back_colour3, '') AS back_colour3,
                colours.background_colour,
                colours.foreground_colour,
                colours.canonical_club_id,
                colours.colour_canonical_club_id,
                colours.colour_source_database_slug,
                colours.colour_source_club_id,
                colours.colour_slot,
                colours.resolution_method AS colour_resolution_method
              FROM clubs c
              LEFT JOIN canonical_club_colours colours
                ON colours.database_slug = c.database_slug
               AND colours.source_club_id = cast(c.source_club_id AS TEXT)
              WHERE c.database_slug = ?
                AND (
                  c.source_club_id = ?
                  OR (? <> '' AND c.name = ?)
                )
              ORDER BY
                CASE WHEN c.name = ? THEN 0 ELSE 1 END,
                CASE WHEN c.source_club_id = ? THEN 0 ELSE 1 END
              LIMIT 1
            `,
            args: [
              database,
              textField(item, "club_id"),
              textField(item, "club_name"),
              textField(item, "club_name"),
              textField(item, "club_name"),
              textField(item, "club_id"),
            ],
          });
          const club = clubResult.rows[0] as QueryRow | undefined;
          let canonicalColour = club?.background_colour && club?.foreground_colour
            ? club
            : undefined;
          if (!canonicalColour && textField(item, "club_name")) {
            const canonicalColourResult = await db.execute({
              sql: `
                SELECT
                  colours.background_colour,
                  colours.foreground_colour,
                  colours.canonical_club_id,
                  colours.colour_canonical_club_id,
                  colours.colour_source_database_slug,
                  colours.colour_source_club_id,
                  colours.colour_slot,
                  'canonical_player_club_name' AS colour_resolution_method
                FROM canonical_club_names names
                JOIN canonical_club_colours colours
                  ON colours.canonical_club_id = names.canonical_club_id
                WHERE names.database_slug = ?
                  AND names.source_club_name = ?
                ORDER BY
                  CASE WHEN colours.database_slug = ? THEN 0 ELSE 1 END,
                  colours.database_slug,
                  colours.source_club_id
                LIMIT 1
              `,
              args: [
                database,
                textField(item, "club_name"),
                database,
              ],
            });
            canonicalColour = canonicalColourResult.rows[0] as QueryRow | undefined;
          }
          item.league_name = mappedLeague || club?.league_name || null;
          item.club_colors = club || canonicalColour
            ? {
                fore_colour1: club?.fore_colour1,
                back_colour1: club?.back_colour1,
                fore_colour2: club?.fore_colour2,
                back_colour2: club?.back_colour2,
                fore_colour3: club?.fore_colour3,
                back_colour3: club?.back_colour3,
                background_colour: canonicalColour?.background_colour,
                foreground_colour: canonicalColour?.foreground_colour,
                canonical_club_id: canonicalColour?.canonical_club_id,
                colour_canonical_club_id: canonicalColour?.colour_canonical_club_id,
                colour_source_database_slug: canonicalColour?.colour_source_database_slug,
                colour_source_club_id: canonicalColour?.colour_source_club_id,
                colour_slot: canonicalColour?.colour_slot,
                colour_resolution_method: canonicalColour?.colour_resolution_method,
              }
            : null;

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
          if (profile && item.club_colors) {
            profile.clubColors = item.club_colors as QueryRow;
          }
          if (profile) {
            profile.canonical_club_name =
              textField(item, "canonical_club_name") || null;
            profile.canonical_player_public_id =
              textField(item, "canonical_player_public_id") || null;
            profile.canonical_player_name =
              textField(item, "canonical_player_name") || null;
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
                (
                  SELECT names.canonical_club_name
                  FROM canonical_club_names names
                  WHERE names.database_slug = person_history.database_slug
                    AND names.source_club_name = person_history.club_name
                  LIMIT 1
                ) AS canonical_club_name,
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
                  SELECT names.canonical_club_name
                  FROM canonical_club_names names
                  WHERE names.database_slug = person_history.database_slug
                    AND names.source_club_name = person_history.club_name
                  LIMIT 1
                ) AS canonical_club_name,
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
          const [clubs, nations] = await db.batch([
            {
              sql: `
              SELECT DISTINCT club_name AS name
              FROM player_search
              WHERE database_slug = ?
                AND club_name IS NOT NULL
                AND club_name <> ''
              ORDER BY club_name COLLATE NOCASE
            `,
              args: [database],
            },
            {
              sql: `
              SELECT DISTINCT nation_name AS name
              FROM player_search
              WHERE database_slug = ?
                AND nation_name IS NOT NULL
                AND nation_name <> ''
              ORDER BY nation_name COLLATE NOCASE
            `,
              args: [database],
            },
          ]);
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
          const staticLeagueNames = Object.values(
            resolvedLeagueMap[canonicalDatabaseSlug(database)] || {},
          );
          const leagueNames = [
            ...new Set([
              ...leagueRows.map((row) => textField(row as QueryRow, "name")),
              ...staticLeagueNames,
            ].filter(Boolean)),
          ].sort((left, right) => left.localeCompare(right));

          return {
            clubs: clubs.rows,
            nations: nations.rows,
            leagues: leagueNames.map((name) => ({ name })),
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
      console.error(JSON.stringify({
        message: "request failed",
        path: url.pathname,
        error: error instanceof Error ? error.message : String(error),
      }));
      return json(
        {
          error: error instanceof Error ? error.message : String(error),
        },
        env,
        500,
      );
    }
  },
} satisfies ExportedHandler<Env>;
