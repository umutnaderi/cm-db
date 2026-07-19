import { DatabaseSync } from "node:sqlite";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

const root = resolve(".");
const source = new DatabaseSync(resolve(root, "db", "retroball.sqlite"), { readOnly: true });
const identity = new DatabaseSync(resolve(root, "identity", "retroball_identity.sqlite"), { readOnly: true });
source.exec("PRAGMA query_only = ON");
identity.exec("PRAGMA query_only = ON");

const playerColumns = `
  database_slug, source_person_id, display_name, full_name, common_name,
  club_name, nation_name, date_of_birth, season_age AS age, position_text,
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

function databases() {
  return {
    items: source.prepare(
      "SELECT slug, title, season_order, status FROM cm_databases ORDER BY season_order"
    ).all()
  };
}

function searchPlayers(params) {
  const database = params.get("database") || "";
  const page = integer(params.get("page"), 1, 1, 100000);
  const pageSize = integer(params.get("pageSize"), 20, 1, 100);
  const query = (params.get("q") || "").trim();
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
      params.get("league") || "",
      params.get("nation") || ""
    ], { cwd: root, encoding: "utf8", windowsHide: true, timeout: 30_000, maxBuffer: 16 * 1024 * 1024 });
    if (result.status === 0) {
      return { items: JSON.parse(result.stdout), page, pageSize };
    }

    // Some restricted runtimes cannot spawn Python and Node's bundled SQLite
    // omits FTS5. Keep local inspection usable with token containment there.
    for (const token of match.match(/"([^"]+)"/g)?.map((item) => item.slice(1, -1)) || []) {
      clauses.push("instr(lower(ps.search_blob), ?) > 0");
      values.push(token);
    }
  }

  for (const [parameter, column] of [
    ["club", "club_name"], ["league", "league_name"], ["nation", "nation_name"]
  ]) {
    const value = (params.get(parameter) || "").trim();
    if (value) {
      clauses.push(`ps.${column} = ?`);
      values.push(value);
    }
  }

  const items = source.prepare(`
    SELECT ${playerColumns.split(",").map((column) => `ps.${column.trim()}`).join(", ")}
    FROM player_search ps
    ${join}
    WHERE ${clauses.join(" AND ")}
    ORDER BY coalesce(ps.current_ability, 0) DESC, ps.display_name, ps.source_person_id
    LIMIT ? OFFSET ?
  `).all(...values, pageSize, (page - 1) * pageSize);
  return { items, page, pageSize };
}

function playerDetail(database, personId) {
  const item = source.prepare(`
    SELECT ${playerColumns} FROM player_search
    WHERE database_slug = ? AND source_person_id = ?
  `).get(database, personId) || null;
  const row = source.prepare(`
    SELECT * FROM player_profile WHERE database_slug = ? AND source_person_id = ?
  `).get(database, personId);
  if (!row) return { item, profile: null };

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
    club_name: row.club_name,
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
    `).all(database, personId)
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
    .map((item) => ({ ...item, label: seasonLabel(item.title) }))
    .sort((left, right) => left.season_order - right.season_order || left.title.localeCompare(right.title));
  return { items };
}

export function handleLocalApi(requestUrl) {
  const path = requestUrl.pathname.slice("/local-api".length);
  if (path === "/api/databases") return databases();
  if (path === "/api/players") return searchPlayers(requestUrl.searchParams);
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
