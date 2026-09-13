// Passing v3 (2026-08-26) -- pure matchPassFlight.js unit tests, no
// match-lab.js DOM harness needed (see MATCH_LAB_PLAN.md, "Passing v3").
// Covers the reported bug this pass fixes: earliestReachableContact() only
// ever let a touch happen while ball.height <= CONTACT_HEIGHT_YARDS (ankle
// height, 0.6yd), so a lofted/driven-aerial parabola -- which spends most
// of its flight well above that -- was NEVER contact-eligible for anyone,
// including a defender standing right under it. Real per-player height
// bands (contactBandForHeight()/playerMaxReachYards()) replace that single
// flat gate.
import {
  buildPassFlight, earliestReachableContact, contactBandForHeight, playerMaxReachYards,
  selectPassType,
} from "../src/lib/matchPassFlight.js";

let failures = 0;
function check(label, condition) {
  console.log(`${condition ? "PASS" : "FAIL"} -- ${label}`);
  if (!condition) failures += 1;
}

function attrs(pairs) { return Object.entries(pairs).map(([label, value]) => ({ label, value })); }
function player(name, overrides) { return { canonical_player_name: name, current_ability: 150, attributes: attrs(overrides) }; }
function entry(id, { x, y, playerObj, team = "home" }) { return { id, team, player: playerObj, x, y, zone: 5 }; }

const OWNER = player("Owner", { Passing: 14, Technique: 13 });
const RECEIVER_PLAYER = player("Receiver", { Anticipation: 13, Decisions: 13, Pace: 14, Acceleration: 13, Jumping: 12, Heading: 13 });
const JUMPING_DEFENDER = player("Jumping Defender", { Anticipation: 13, Decisions: 13, Pace: 13, Acceleration: 13, Jumping: 15, Heading: 14, Positioning: 14, Marking: 13 });

console.log("=== delivery family follows distance, intention and passer capability ===");
{
  const from = { x: 50, y: 10 };
  const strong = player("Long Passer", { Passing: 19, Technique: 18, Strength: 18 });
  const weak = player("Weak Long Passer", { Passing: 7, Technique: 7, Strength: 7 });
  check("a normal clear 24-yard pass remains driven on the ground",
    selectPassType({ passer: strong, from, to: { x: 50, y: 30 }, opponents: [] }) === "driven-ground");
  check("a clear 30-yard pass into space becomes driven aerial",
    selectPassType({
      passer: strong, from, to: { x: 50, y: 35 }, opponents: [], deliveryIntent: "forward-lead",
    }) === "driven-aerial");
  check("the same exceptional 30-yard lane can still be drilled to feet",
    selectPassType({
      passer: strong, from, to: { x: 50, y: 35 }, opponents: [], deliveryIntent: "current-position",
    }) === "driven-ground");
  check("a clear 40-yard ball from a strong passer is driven aerial, never ground",
    selectPassType({ passer: strong, from, to: { x: 50, y: 43.333333 }, opponents: [] }) === "driven-aerial");
  check("a 40-yard ball from a weak passer is lofted",
    selectPassType({ passer: weak, from, to: { x: 50, y: 43.333333 }, opponents: [] }) === "lofted");
}

console.log("\n=== contactBandForHeight() -- the real per-height band boundaries ===");
{
  check("ankle height reads as the foot band", contactBandForHeight(0.3) === "foot");
  check("exactly the old flat cutoff (0.6yd) still reads as foot", contactBandForHeight(0.6) === "foot");
  check("just above the foot cutoff reads as thigh", contactBandForHeight(0.9) === "thigh");
  check("mid-torso height reads as chest", contactBandForHeight(1.6) === "chest");
  check("above chest height reads as head", contactBandForHeight(2.0) === "head");
}

console.log("\n=== playerMaxReachYards() -- real standing + jump reach, scaled by Jumping ===");
{
  const weakJumper = player("Weak Jumper", { Jumping: 1 });
  const elitejumper = player("Elite Jumper", { Jumping: 20 });
  check("a better jumper has a genuinely higher max reach than a weak one",
    playerMaxReachYards(elitejumper) > playerMaxReachYards(weakJumper));
  check("even a weak jumper's standing reach alone clears ordinary chest height (~1.6yd)",
    playerMaxReachYards(weakJumper) > 1.6);
}

console.log("\n=== Reported bug: a lofted ball over a jumping defender is a real contest ===");
{
  // The receiver and a defender within 3 real yards of each other, both
  // standing under the ball's own climb -- BEFORE this fix, this scenario
  // silently read as "uncontested" no matter how close the defender stood,
  // because ball.height stayed above CONTACT_HEIGHT_YARDS (0.6yd) for
  // almost this entire flight.
  const owner = entry("owner", { x: 50, y: 0, playerObj: OWNER });
  const receiver = entry("receiver", { x: 50, y: 60, playerObj: RECEIVER_PLAYER });
  const defender = entry("defender", { x: 50, y: 62, playerObj: JUMPING_DEFENDER, team: "away" });
  const flight = buildPassFlight({
    owner, receiver, from: { x: owner.x, y: owner.y }, intendedPoint: { x: receiver.x, y: receiver.y },
    actualEndpoint: { x: receiver.x, y: receiver.y }, passType: "lofted", durationMs: 2500,
  });
  const contact = earliestReachableContact({ flight, candidates: [receiver, defender] });
  check("a real contact is found at all (not a clean, nobody-eligible arrival)", Boolean(contact));
  if (contact) {
    check("the contact happens well above ankle height -- a genuine aerial contest, not a ground-level fluke",
      contact.band === "head" || contact.band === "chest");
    check("BOTH the receiver and the nearby jumping defender are eligible at the SAME sample -- never silently just the first candidate",
      contact.contestants.length >= 2
        && contact.contestants.some((c) => c.candidate.id === receiver.id)
        && contact.contestants.some((c) => c.candidate.id === defender.id));
  }
}

console.log("\n=== A short ground pass stays in the foot band, single contestant (no aerial duel) ===");
{
  const owner = entry("owner", { x: 50, y: 0, playerObj: OWNER });
  const receiver = entry("receiver", { x: 50, y: 10, playerObj: RECEIVER_PLAYER });
  const defender = entry("defender", { x: 50, y: 12, playerObj: JUMPING_DEFENDER, team: "away" });
  const flight = buildPassFlight({
    owner, receiver, from: { x: owner.x, y: owner.y }, intendedPoint: { x: receiver.x, y: receiver.y },
    actualEndpoint: { x: receiver.x, y: receiver.y }, passType: "ground", durationMs: 550,
  });
  const contact = earliestReachableContact({ flight, candidates: [receiver, defender] });
  check("a real contact is found", Boolean(contact));
  if (contact) {
    check("a ground pass's own contact is judged in the foot band, never elevated into a chest/head duel",
      contact.band === "foot");
  }
}

console.log(`\n${failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`}`);
process.exit(failures === 0 ? 0 : 1);
