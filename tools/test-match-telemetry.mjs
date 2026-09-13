import assert from "node:assert/strict";
import { createMatchTelemetry, observeMatchFrame, observeMatchEvent, lastTenMinutePossession, heatForScope, statsForTeam } from "../src/lib/matchTelemetry.js";

const roster = [
  { id: "h1", team: "home", player: { name: "Home One" } },
  { id: "h2", team: "home", player: { name: "Home Two" } },
  { id: "a1", team: "away", player: { name: "Away One" } },
];
const telemetry = createMatchTelemetry(roster);
observeMatchFrame(telemetry, { timeMs: 0, ownerId: "h1", players: { h1: { x: 10, y: 10 }, h2: { x: 20, y: 20 }, a1: { x: 80, y: 80 } } });
observeMatchFrame(telemetry, { timeMs: 300000, ownerId: "a1", players: { h1: { x: 20, y: 20 }, h2: { x: 20, y: 20 }, a1: { x: 70, y: 70 } } });
observeMatchFrame(telemetry, { timeMs: 600000, ownerId: "a1", players: { h1: { x: 20, y: 20 }, h2: { x: 30, y: 30 }, a1: { x: 60, y: 60 } } });
const possession = lastTenMinutePossession(telemetry, 600000);
assert(Math.abs(possession.home - 50) < 0.001 && Math.abs(possession.away - 50) < 0.001);
assert(telemetry.players.h1.distanceYards > 13 && telemetry.players.h1.distanceYards < 15);
assert(heatForScope(telemetry, "team:home").some(value => value > 0));
const distanceBeforeReplay = telemetry.players.h1.distanceYards;
observeMatchFrame(telemetry, { timeMs: 300000, ownerId: "a1", players: { h1: { x: 10, y: 10 } } });
observeMatchFrame(telemetry, { timeMs: 600000, ownerId: "a1", players: { h1: { x: 20, y: 20 } } });
assert.equal(telemetry.players.h1.distanceYards, distanceBeforeReplay, "replaying elapsed match time must not double-count distance");

const trace = [
  { code: "P.PASS", label: "Home One passes", actorId: "h1", movement: "pass", contact: { type: "pass" } },
  { code: "P.RECEIVE", label: "Home Two receives", actorId: "h2", ownerAfterId: "h2", outcome: "success" },
  { code: "F.SHOT", label: "Home Two shoots", actorId: "h2", movement: "shot", contact: { type: "shot" }, outcome: "success" },
];
observeMatchEvent(telemetry, { trace, eventIndex: 0, chunkIndex: 1, matchTimeMs: 601000 });
observeMatchEvent(telemetry, { trace, eventIndex: 2, chunkIndex: 1, matchTimeMs: 602000 });
assert.deepEqual({ total: telemetry.players.h1.passesTotal, successful: telemetry.players.h1.passesSuccessful, key: telemetry.players.h1.keyPasses }, { total: 1, successful: 1, key: 1 });
assert.equal(telemetry.players.h2.shotsOnTarget, 1);
assert(telemetry.commentary.length >= 2);
const homeTeam = statsForTeam(telemetry, "home");
assert.equal(homeTeam.passesTotal, 1);
assert.equal(homeTeam.passesSuccessful, 1);
assert.equal(homeTeam.keyPasses, 1);
assert.equal(homeTeam.shotsOnTarget, 1);
assert.equal(homeTeam.shotsMissed, 0);
assert.equal(homeTeam.distanceYards, telemetry.players.h1.distanceYards + telemetry.players.h2.distanceYards);
console.log("PASS match telemetry: player and team stats, possession, commentary and heat retained");
