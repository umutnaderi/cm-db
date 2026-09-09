// Verifies historical squad declarations against the live player database.
//
// This is the promotion path the extension contract in
// src/data/historicalSquads.js refers to: a squad stays `verified: false`
// until this tool resolves every one of its declared players for real. It
// is the ONLY sanctioned way to flip that flag -- editing it by hand is
// how invented ids get shipped.
//
//   node tools/verify-historical-squads.mjs                # every squad
//   node tools/verify-historical-squads.mjs titan-porto-2004
//   node tools/verify-historical-squads.mjs --unverified   # candidates only
//
// Needs network access to the retroball API. Offline it reports the
// failure honestly rather than pretending the squads are fine.
import { listHistoricalSquads } from "../src/data/historicalSquads.js";
import {
  isGoalkeeperRecord, resolveHistoricalSquad, specAliases, validateSquadDeclaration,
} from "../src/lib/historicalSquadResolver.js";
import { searchPlayers } from "../src/lib/retroballApi.js";

const args = process.argv.slice(2);
const unverifiedOnly = args.includes("--unverified");
const keys = args.filter((arg) => !arg.startsWith("--"));

const all = listHistoricalSquads({ includeUnverified: true });
const targets = all.filter((squad) =>
  (keys.length ? keys.includes(squad.key) : true)
  && (unverifiedOnly ? squad.verified !== true : true));

if (!targets.length) {
  console.log("No squads matched.");
  process.exit(0);
}

let failed = 0;
for (const squad of targets) {
  console.log(`\n=== ${squad.key} -- ${squad.name} ===`);
  const declaration = validateSquadDeclaration(squad);
  for (const error of declaration.errors) console.log(`  DECLARATION ERROR: ${error}`);
  for (const warning of declaration.warnings) console.log(`  note: ${warning}`);
  if (squad.blocked) {
    console.log(`  SKIPPED -- blocked: ${squad.blocked}`);
    failed += 1;
    continue;
  }
  if (!declaration.valid) { failed += 1; continue; }

  // STRICT: every player must come out of the squad's OWN declared
  // database and satisfy its OWN club/nation filter. A fallback-database
  // hit is a failure here, not a note -- promotion has to mean the
  // declaration was proven, not that something plausible turned up.
  let resolution;
  try {
    resolution = await resolveHistoricalSquad(squad, { searchPlayers, strict: true });
  } catch (error) {
    const offline = /fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|network/i.test(String(error.message));
    console.log(`  ${offline ? "API UNREACHABLE" : "RESOLUTION FAILED"}: ${error.message}`);
    if (offline) console.log("  RESULT: cannot verify offline -- squad left unverified");
    failed += 1;
    continue;
  }
  for (const warning of resolution.warnings) console.log(`  note: ${warning}`);
  for (const entry of resolution.unresolved) {
    console.log(`  UNRESOLVED: ${entry.aliases.join(" / ")}`
      + `${entry.canonicalPublicId ? ` (pinned ${entry.canonicalPublicId})` : ""}`
      + `${entry.reason === "wrong-database" ? `  [found only in ${entry.foundIn}]` : ""}`);
  }

  // Provenance for every player that DID resolve, printed whether or not
  // the squad passed -- it is what makes a failure diagnosable.
  const clubOf = (player) => player?.canonical_club_name ?? player?.club_name ?? player?.club ?? "?";
  const nationOf = (player) => player?.canonical_nation_name ?? player?.nation_name ?? player?.nation ?? "?";
  const wanted = squad.filter?.club ? `club=${squad.filter.club}` : `nation=${squad.filter.nation}`;
  console.log(`  declared source: ${squad.database}  ${wanted}`);
  console.log(`  resolved ${resolution.players.length}/${squad.players.length} players`);
  resolution.players.forEach((player, index) => {
    const slug = player.database_slug ?? "?";
    const wrongDatabase = slug !== squad.database;
    console.log(`    ${String(index + 1).padStart(2)}. ${String(player.canonical_player_name).padEnd(26)}`
      + ` db=${String(slug).padEnd(24)}`
      + ` club=${String(clubOf(player)).padEnd(22)}`
      + ` nation=${String(nationOf(player)).padEnd(18)}`
      + ` pos=${String(player.position_text ?? "?").padEnd(10)}`
      + `  <- ${specAliases(squad.players[index])[0]}`
      + `${wrongDatabase ? "   <-- WRONG DATABASE" : ""}`);
  });
  const keeper = resolution.players[squad.goalkeeperIndex];
  if (keeper) {
    console.log(`  goalkeeper: ${keeper.canonical_player_name} (${keeper.position_text ?? "?"})`
      + `${isGoalkeeperRecord(keeper) ? "" : "  <-- NOT a goalkeeper record"}`);
  }

  if (!resolution.valid) {
    for (const error of resolution.errors) console.log(`  STRICT FAILURE: ${error}`);
    console.log("  RESULT: not promotable -- leave verified: false");
    failed += 1;
    continue;
  }
  console.log(squad.verified
    ? "  RESULT: still resolves cleanly under strict sourcing"
    : "  RESULT: strict verification passed -- safe to set verified: true");
}

console.log(`\n${failed === 0 ? "All squads resolved." : `${failed} squad(s) need attention.`}`);
process.exit(failed === 0 ? 0 : 1);
