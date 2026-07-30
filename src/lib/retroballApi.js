const DEFAULT_API_BASE = "https://retroball-api.umutnaderi.workers.dev";

function configuredApiBase() {
  const metaValue =
    typeof document === "undefined"
      ? ""
      : document.querySelector('meta[name="retroball-api-url"]')?.content?.trim();
  const globalValue =
    typeof globalThis.RETROBALL_API_URL === "string"
      ? globalThis.RETROBALL_API_URL.trim()
      : "";

  return (metaValue || globalValue || DEFAULT_API_BASE).replace(/\/+$/, "");
}

export const API_BASE = configuredApiBase();

const responseCache = new Map();
const pendingRequests = new Map();
const MAX_CACHE_ENTRIES = 250;
const PLAYER_CACHE_MS = 24 * 60 * 60 * 1000;

function readCached(key) {
  const entry = responseCache.get(key);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    responseCache.delete(key);
    return undefined;
  }
  // Refresh insertion order so frequently used players survive LRU eviction.
  responseCache.delete(key);
  responseCache.set(key, entry);
  return entry.value;
}

function writeCached(key, value, cacheMs) {
  responseCache.set(key, { value, expiresAt: Date.now() + cacheMs });
  while (responseCache.size > MAX_CACHE_ENTRIES) {
    responseCache.delete(responseCache.keys().next().value);
  }
}

function waitWithSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));

  return new Promise((resolve, reject) => {
    const onAbort = () => reject(new DOMException("Aborted", "AbortError"));
    const cleanup = () => signal.removeEventListener("abort", onAbort);
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/**
 * @typedef {Object} RetroballDatabase
 * @property {string} slug
 * @property {string} title
 * @property {number} season_order
 * @property {string} status
 */

/**
 * @typedef {Object} PlayerSearchRow
 * @property {string} database_slug
 * @property {string} source_person_id
 * @property {string | null} display_name
 * @property {string | null} full_name
 * @property {string | null} common_name
 * @property {string | null} club_name
 * @property {string | null} nation_name
 * @property {number | null} age
 * @property {string | null} date_of_birth
 * @property {string | null} position_text
 * @property {number | null} current_ability
 * @property {number | null} potential_ability
 * @property {number | null} value
 * @property {number | null} wage
 */

/**
 * @typedef {PlayerSearchRow & {
 *   title?: string,
 *   label?: string,
 *   season_order?: number
 * }} PlayerSeasonEntry
 */

/**
 * @typedef {Object} PlayerRating
 * @property {string} label
 * @property {number | null} value
 */

/**
 * @typedef {Object} PlayerProfile
 * @property {string} source_person_id
 * @property {string | null} source_player_id
 * @property {Record<string, number | null>} ratings
 * @property {PlayerRating[]} positions
 * @property {PlayerRating[]} sides
 * @property {PlayerRating[]} positionRatings
 * @property {PlayerRating[]} attributes
 * @property {PlayerRating[]} hiddenAttributes
 * @property {PlayerRating[]} foot
 * @property {Record<string, string | number | null> | null} clubColors
 * @property {Record<string, unknown>} profile
 */

async function requestJson(path, init = {}) {
  const { cacheMs = 0, signal, ...fetchInit } = init;
  const cacheKey = `${API_BASE}${path}`;

  if (cacheMs > 0) {
    const cached = readCached(cacheKey);
    if (cached !== undefined) return cached;

    if (pendingRequests.has(cacheKey)) {
      return waitWithSignal(pendingRequests.get(cacheKey), signal);
    }
  }

  const request = (async () => {
    const response = await fetch(`${API_BASE}${path}`, {
      ...fetchInit,
      signal: cacheMs > 0 ? undefined : signal,
      headers: {
        Accept: "application/json",
        ...fetchInit.headers,
      },
    });

    if (!response.ok) {
      let detail = "";

      try {
        const body = await response.json();
        detail = body.error || body.message || JSON.stringify(body);
      } catch {
        detail = await response.text().catch(() => "");
      }

      throw new Error(
        detail
          ? `${response.status} ${response.statusText}: ${detail}`
          : `${response.status} ${response.statusText}`,
      );
    }

    const value = await response.json();
    if (cacheMs > 0) writeCached(cacheKey, value, cacheMs);
    return value;
  })();

  if (cacheMs <= 0) return request;

  pendingRequests.set(cacheKey, request);
  void request.then(
    () => pendingRequests.delete(cacheKey),
    () => pendingRequests.delete(cacheKey),
  );
  return waitWithSignal(request, signal);
}

/**
 * @returns {Promise<RetroballDatabase[]>}
 */
export async function getDatabases(options = {}) {
  const payload = await requestJson("/api/databases", {
    signal: options.signal,
    cacheMs: PLAYER_CACHE_MS,
  });
  return Array.isArray(payload) ? payload : payload.items ?? [];
}

export async function getFilters(database, options = {}) {
  if (!database) throw new Error("A database slug is required.");
  return requestJson(`/api/filters?database=${encodeURIComponent(database)}`, {
    signal: options.signal,
    cacheMs: PLAYER_CACHE_MS,
  });
}

export async function getDraftCandidates({
  seed = Date.now(),
  perDatabase = 18,
  signal,
} = {}) {
  const searchParams = new URLSearchParams({
    seed: String(seed),
    perDatabase: String(perDatabase),
  });
  const payload = await requestJson(`/api/draft-candidates?${searchParams}`, {
    signal,
  });
  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    databases: Array.isArray(payload.databases) ? payload.databases : [],
  };
}

/**
 * @param {{ database: string, q: string, page?: number, pageSize?: number, signal?: AbortSignal }} params
 * @returns {Promise<{ items: PlayerSearchRow[], page: number, pageSize: number }>}
 */
export async function searchPlayers({
  database,
  q,
  club = "",
  league = "",
  nation = "",
  page = 1,
  pageSize = 20,
  signal,
}) {
  if (!database) {
    throw new Error("A database slug is required.");
  }

  const searchParams = new URLSearchParams({
    database,
    q: q || "",
    club,
    league,
    nation,
    page: String(page),
    pageSize: String(pageSize),
  });
  const payload = await requestJson(`/api/players?${searchParams}`, { signal });

  return {
    items: Array.isArray(payload.items) ? payload.items : [],
    page: Number(payload.page ?? page),
    pageSize: Number(payload.pageSize ?? pageSize),
  };
}

/**
 * @param {string} database
 * @param {string} sourcePersonId
 * @param {{ signal?: AbortSignal }} options
 * @returns {Promise<{ item: PlayerSearchRow | null, profile: PlayerProfile | null }>}
 */
export async function getPlayer(database, sourcePersonId, options = {}) {
  if (!database || !sourcePersonId) {
    throw new Error("A database slug and source person id are required.");
  }

  return requestJson(
    `/api/players/${encodeURIComponent(database)}/${encodeURIComponent(sourcePersonId)}`,
    { signal: options.signal, cacheMs: PLAYER_CACHE_MS },
  );
}

/**
 * @param {PlayerSearchRow} player
 * @param {{ signal?: AbortSignal }} options
 * @returns {Promise<PlayerSeasonEntry[]>}
 */
export async function getPlayerSeasons(player, options = {}) {
  if (!player?.database_slug || !player?.source_person_id) {
    throw new Error("A database slug and source person id are required.");
  }

  const searchParams = new URLSearchParams({
    database: player.database_slug,
    sourcePersonId: player.source_person_id,
  });

  const payload = await requestJson(`/api/player-seasons?${searchParams}`, {
    signal: options.signal,
    cacheMs: PLAYER_CACHE_MS,
  });
  return Array.isArray(payload.items) ? payload.items : [];
}

export async function getPlayerHistory(database, sourcePersonId, options = {}) {
  if (!database || !sourcePersonId) {
    throw new Error("A database slug and source person id are required.");
  }

  return requestJson(
    `/api/players/${encodeURIComponent(database)}/${encodeURIComponent(
      sourcePersonId,
    )}/history`,
    { signal: options.signal, cacheMs: PLAYER_CACHE_MS },
  );
}

export async function getDraftRecords(options = {}) {
  return requestJson("/api/draft-records", {
    signal: options.signal,
  });
}

export async function saveDraftRecord(record, options = {}) {
  return requestJson("/api/draft-records", {
    method: "POST",
    signal: options.signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(record),
  });
}
