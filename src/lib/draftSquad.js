function playerName(player) {
  return player?.canonical_player_name
    || player?.display_name
    || player?.full_name
    || "Unknown player";
}

function playerSeason(player) {
  const match = String(player?.database_title || "").match(/(\d{2})\/(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : String(player?.database_title || "");
}

function overall(player, fallback = 0) {
  return Math.min(99, Math.max(0, Math.round(
    (Number(player?.current_ability) || Number(fallback) * 2 || 0) / 2,
  )));
}

function hashString(value) {
  let hash = 2166136261;
  for (const character of String(value)) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createDraftSquad(team) {
  const players = (Array.isArray(team?.players) ? team.players : []).map((entry) => ({
    role: String(entry?.role || ""),
    name: playerName(entry?.player),
    overall: overall(entry?.player, entry?.overall),
    season: playerSeason(entry?.player),
    club: String(entry?.player?.canonical_club_name || entry?.player?.club_name || ""),
    database: String(entry?.player?.database_slug || ""),
    sourcePersonId: String(entry?.player?.source_person_id || ""),
    captain: Boolean(entry?.isCaptain),
  }));
  const identity = JSON.stringify({
    teamName: String(team?.teamName || "Ultimate XI"),
    formation: String(team?.formation || ""),
    style: String(team?.style || ""),
    players: players.map((player) => [
      player.role,
      player.database,
      player.sourcePersonId,
      player.captain ? 1 : 0,
    ]),
  });
  const first = hashString(`retroball-squad:${identity}`).toString(36).padStart(7, "0");
  const second = hashString(`${identity}:ultimate-draft`).toString(36).padStart(7, "0");
  return {
    seed: `XI-${first}${second}`.toUpperCase(),
    teamName: String(team?.teamName || "Ultimate XI").slice(0, 60),
    formation: String(team?.formation || "").slice(0, 20),
    style: String(team?.style || "").slice(0, 20),
    players,
  };
}

export function formatDraftSquadText(squad) {
  const heading = [
    squad?.teamName || "Ultimate XI",
    [squad?.formation, squad?.style].filter(Boolean).join(" · "),
    squad?.seed ? `Squad seed: ${squad.seed}` : "",
  ].filter(Boolean);
  const players = (Array.isArray(squad?.players) ? squad.players : []).map(
    (player) => `${player.role} · ${player.name}${player.captain ? " (C)" : ""} · ${player.overall} OVR${player.season ? ` · ${player.season}` : ""}`,
  );
  return [...heading, "", ...players].join("\n");
}
