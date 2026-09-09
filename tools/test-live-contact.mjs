// Kick As Projectile v1 (2026-08-27) -- pure matchPassFlight.js unit tests
// for simulateFlightUntilContact(), no match-lab.js DOM harness needed
// (see MATCH_LAB_PLAN.md's own "Kick as projectile / contact as live
// race" section, and this project's spec's own implementation order:
// "simulateFlightUntilContact() + unit tests with fake players, no DOM,
// FIRST"). Covers the reported bug this slice exists to fix: contact was
// booked in advance against candidates' frozen kick-time poses
// (earliestReachableContact(), still exercised directly by
// test-pass-flight.mjs as a pure oracle) -- "the ball will meet Baggio"
// decided before anyone moved. simulateFlightUntilContact() actually
// ticks every candidate forward from their OWN current position each
// 40ms step and tests contact against where they REALLY are, so an
// overhit ball can be poached, a genuinely well-placed defender can beat
// the named receiver to it, and an unreachable ball goes down as a real
// loose ball at its own true endpoint -- never silently snapped onto
// whoever the passer was aiming for.
import {
  buildPassFlight, simulateFlightUntilContact, playerMaxReachYards,
} from "../src/lib/matchPassFlight.js";
import { movementDistanceYards } from "../src/lib/matchMovementTiming.js";

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} -- ${label}`);
  if (!condition) failures += 1;
}

function attrs(pairs) { return Object.entries(pairs).map(([label, value]) => ({ label, value })); }
function player(name, overrides) { return { canonical_player_name: name, current_ability: 150, attributes: attrs(overrides) }; }
function entry(id, { x, y, playerObj, team = "home" }) { return { id, team, player: playerObj, x, y, zone: 5 }; }

const OWNER = player("Owner", { Passing: 14, Technique: 13 });
const FAST_TEAMMATE = player("Fast Teammate", { Pace: 17, Acceleration: 16, Anticipation: 13 });
const NAMED_RECEIVER = player("Named Receiver", { Pace: 13, Acceleration: 12, Anticipation: 12 });
const AVERAGE_DEFENDER = player("Average Defender", { Pace: 13, Acceleration: 12, Positioning: 13, Anticipation: 12 });

console.log("=== (1) Frozen-vs-live: a teammate starting FURTHER from the passer than the named receiver can still take an overhit ball ===");
{
  // The named receiver sits close to the passer; the ball is struck well
  // past them (an overhit, not a booking) toward a second teammate who
  // starts further from the PASSER but is already sitting right on the
  // ball's own real corridor, close to where it actually ends up. Under
  // the old frozen-pose model this never even got asked -- the race only
  // ever ran `[receiver, ...opponents]`. Here every teammate is a real
  // candidate.
  const owner = entry("owner", { x: 50, y: 0, playerObj: OWNER });
  // Off the corridor, not on it -- a receiver sitting exactly on the
  // ball's own straight path gets found by the ball almost for free
  // (correct physics, but it would make this fixture trivial and not a
  // real test of "further from the passer" at all).
  const receiver = entry("receiver", { x: 30, y: 25, playerObj: NAMED_RECEIVER });
  const poacher = entry("poacher", { x: 50, y: 58, playerObj: FAST_TEAMMATE });
  const actualEndpoint = { x: 50, y: 60 };
  check("sanity: the poacher truly does start further from the passer than the named receiver",
    movementDistanceYards(owner, poacher) > movementDistanceYards(owner, receiver));
  const flight = buildPassFlight({
    owner, receiver, from: { x: owner.x, y: owner.y }, intendedPoint: { x: receiver.x, y: receiver.y },
    actualEndpoint, passType: "driven-ground", durationMs: 2300,
  });
  const contact = simulateFlightUntilContact({ flight, players: [receiver, poacher] });
  check("a real contact is found", Boolean(contact.candidate));
  if (contact.candidate) {
    check("the poacher -- not the named receiver -- gets to the overhit ball",
      contact.candidate.id === poacher.id);
    check("this is reported honestly as NOT the intended receiver",
      contact.isIntendedReceiver === false);
  }
}

console.log("\n=== (2) The named receiver does NOT auto-win against a height-eligible defender already standing on the corridor ===");
{
  // The receiver is named (intendedReceiverId) but starts a long way back;
  // an ordinary defender is already standing directly on the ball's own
  // straight path, much closer to the passer, at foot height (an
  // ordinary ground pass -- no jumping/heading duel to muddy the result).
  // A real geometric contest, decided by who is actually there, not by
  // whose name is on the pass.
  const owner = entry("owner", { x: 50, y: 0, playerObj: OWNER });
  const receiver = entry("receiver", { x: 50, y: 45, playerObj: NAMED_RECEIVER });
  const defender = entry("defender", { x: 50, y: 15, playerObj: AVERAGE_DEFENDER, team: "away" });
  const flight = buildPassFlight({
    owner, receiver, from: { x: owner.x, y: owner.y }, intendedPoint: { x: receiver.x, y: receiver.y },
    actualEndpoint: { x: receiver.x, y: receiver.y }, passType: "ground", durationMs: 900,
  });
  const contact = simulateFlightUntilContact({ flight, players: [receiver, defender] });
  check("a real contact is found", Boolean(contact.candidate));
  if (contact.candidate) {
    check("the defender standing on the corridor gets there first, not the named receiver",
      contact.candidate.id === defender.id);
    check("the intended-receiver flag correctly reads false for a genuinely beaten pass",
      contact.isIntendedReceiver === false);
  }
}

console.log("\n=== (3) Nobody in range -- a real loose ball at the flight's own true endpoint, never snapped to anyone ===");
{
  // Both candidates are placed far enough away, and the flight short
  // enough, that neither can physically arrive -- a genuinely
  // uncontested, unreachable delivery.
  const owner = entry("owner", { x: 50, y: 0, playerObj: OWNER });
  const receiver = entry("receiver", { x: 5, y: 95, playerObj: NAMED_RECEIVER });
  const defender = entry("defender", { x: 95, y: 95, playerObj: AVERAGE_DEFENDER, team: "away" });
  const actualEndpoint = { x: 50, y: 40 };
  const flight = buildPassFlight({
    owner, receiver, from: { x: owner.x, y: owner.y }, intendedPoint: actualEndpoint,
    actualEndpoint, passType: "ground", durationMs: 700,
  });
  const contact = simulateFlightUntilContact({ flight, players: [receiver, defender] });
  check("nobody is a real contact candidate", !contact.candidate);
  check("the loose ball sits at the flight's own true endpoint, not teleported to either player",
    contact.atPoint.x === actualEndpoint.x && contact.atPoint.y === actualEndpoint.y);
  check("the loose ball is timestamped at the flight's own full duration, not an arbitrary cutoff",
    contact.atMs === flight.durationMs);
  check("no contestants are reported for a genuinely uncontested, unreachable ball",
    contact.contestants.length === 0);
}

console.log("\n=== (4) Anti-swarm: teammates far from the corridor hold their own job, they do not all sprint at the ball ===");
{
  // Three teammates scattered well outside CHASE_CORRIDOR_YARDS of the
  // ball's own straight path, each given an ordinary tactical job (a
  // fixed point of their own, mayChase:false) well away from that
  // corridor too. None of them is the intended receiver. If the ticked
  // simulation swarmed the ball, their final positions would drift
  // toward the corridor; if it correctly holds their job, their final
  // positions stay close to their own assigned point.
  const owner = entry("owner", { x: 50, y: 0, playerObj: OWNER });
  const receiver = entry("receiver", { x: 50, y: 60, playerObj: NAMED_RECEIVER });
  const holdWide1 = entry("hold-wide-1", { x: 15, y: 30, playerObj: FAST_TEAMMATE });
  const holdWide2 = entry("hold-wide-2", { x: 85, y: 35, playerObj: FAST_TEAMMATE });
  // Off the corridor (x=50) by a real margin, same as the wide two -- NOT
  // sitting on the straight line near the kick origin, which would let
  // the ball find them almost immediately by pure geometry regardless of
  // job/chase status, the same reason receiver placement matters in (1)
  // above.
  const holdDeep = entry("hold-deep", { x: 25, y: 5, playerObj: FAST_TEAMMATE });
  const jobs = {
    [holdWide1.id]: { point: { x: 15, y: 30 }, mayChase: false },
    [holdWide2.id]: { point: { x: 85, y: 35 }, mayChase: false },
    [holdDeep.id]: { point: { x: 25, y: 5 }, mayChase: false },
  };
  const jobTargetFor = (id) => jobs[id] ?? null;
  const flight = buildPassFlight({
    owner, receiver, from: { x: owner.x, y: owner.y }, intendedPoint: { x: receiver.x, y: receiver.y },
    actualEndpoint: { x: receiver.x, y: receiver.y }, passType: "lofted", durationMs: 2600,
  });
  const contact = simulateFlightUntilContact({
    flight, players: [receiver, holdWide1, holdWide2, holdDeep], jobTargetFor,
  });
  check("the named receiver still gets the ball -- this fixture isn't testing THEM", contact.candidate?.id === receiver.id);
  const finalPositions = contact.positions;
  check("a far-side wide player stays close to their own job point, not dragged toward the corridor",
    movementDistanceYards(finalPositions[holdWide1.id], holdWide1) < 3);
  check("the other wide player does the same",
    movementDistanceYards(finalPositions[holdWide2.id], holdWide2) < 3);
  check("the deep player holding the back line does the same",
    movementDistanceYards(finalPositions[holdDeep.id], holdDeep) < 3);
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
