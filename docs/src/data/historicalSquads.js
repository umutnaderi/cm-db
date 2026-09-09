// Curated historical squads -- the declarative catalogue, and nothing else.
//
// Extracted verbatim from draft-run.js's own TITAN_OPPONENTS (2026-09-04)
// so Draft's Titan Fight and Match Lab consume ONE source instead of two
// copies that drift. Resolution (turning these declarations into real
// database players) lives in src/lib/historicalSquadResolver.js; this file
// stays pure data with no imports, no DOM and no network.
//
// ---------------------------------------------------------------------------
// Squad declaration contract
// ---------------------------------------------------------------------------
//
//   key            Stable identifier. Never reused or renamed -- saved runs
//                  and records reference it.
//   name           Full display name ("2002 Brazil NT").
//   shortName      Compact display name, used in error messages.
//   database       Database slug the squad is sourced from. MUST be a slug
//                  that genuinely exists in this project (see
//                  KNOWN_DATABASE_SLUGS below); never invented to make a
//                  preset look available.
//   filter         The squad-wide search filter -- { nation } or { club }.
//   goalkeeperIndex Index into `players` of the goalkeeper. Explicit so
//                  validation can check the resolved player really is one,
//                  rather than trusting list order.
//   verified       true only when this squad has actually been resolved
//                  against the live database. Unverified squads are
//                  excluded from the default catalogue.
//   players        Ordered starting XI. Each entry is either:
//                    - an alias array, most specific first:
//                        ["gilberto silva", "gilberto"]
//                    - or an identity object, when name matching is
//                      ambiguous or the canonical record is known:
//                        { legacyCanonicalId, canonicalPublicId, aliases }
//                  An identity object's canonicalPublicId wins outright
//                  over alias matching when the search result carries one.
//
// To add a preset: append to CURATED_SQUADS with verified:false, run
// `npm run squads:verify` against the live API, fix aliases until every
// player resolves, then flip verified:true. Do not flip it by hand without
// a resolution run -- that is exactly how invented ids get shipped.

// Every database edition this project actually has. A squad naming a slug
// outside this set is a declaration error, not a runtime lookup failure,
// and validateSquadDeclaration() reports it as such.
// Verified against the canonical-name data itself
// (`data/d1/canonical-player-name-chunks/`, distinct database_slug values),
// which is the same set the database picker lists. Note that the newest
// edition is a FOOTBALL Manager one: an earlier version of this list was
// built by grepping sources for `cm####` and so missed both fm2005 and
// cm9596 entirely, which wrongly made every 2004/05 squad look unsourceable.
export const KNOWN_DATABASE_SLUGS = Object.freeze([
  "cm9596_vanilla_original",
  "cm9697_vanilla_original",
  "cm9798_vanilla_original",
  "cm9899_vanilla_original",
  "cm9900_vanilla_original",
  "cm0001_vanilla_original",
  "cm0102_vanilla_original",
  "cm0203_vanilla_original",
  "cm0304_vanilla_original",
  "fm2005_vanilla_original",
]);

const CURATED_SQUADS = [
  {
    key: "titan-brazil-2002",
    name: "2002 Brazil NT",
    shortName: "Brazil 2002",
    // The first listed player is the goalkeeper in every curated squad.
    // Stated explicitly so validateResolvedSquad() can CHECK it instead of
    // assuming list order stays that way.
    goalkeeperIndex: 0,
    verified: true,
    database: "cm0102_vanilla_original",
    filter: { nation: "Brazil" },
    players: [
      ["marcos"],
      ["lucio"],
      ["edmilson"],
      ["roque junior"],
      ["cafu"],
      ["gilberto silva", "gilberto"],
      {
        legacyCanonicalId: "23678",
        canonicalPublicId: "player_kleberson_brazil_1979",
        aliases: ["Kléberson", "kleberson"],
      },
      ["roberto carlos"],
      ["ronaldinho"],
      ["rivaldo"],
      ["ronaldo"],
    ],
  },
  {
    key: "titan-france-2000",
    name: "2000 France NT",
    shortName: "France 2000",
    // The first listed player is the goalkeeper in every curated squad.
    // Stated explicitly so validateResolvedSquad() can CHECK it instead of
    // assuming list order stays that way.
    goalkeeperIndex: 0,
    verified: true,
    database: "cm0001_vanilla_original",
    filter: { nation: "France" },
    players: [
      ["fabien barthez", "barthez"],
      ["lilian thuram", "thuram"],
      ["marcel desailly", "desailly"],
      ["laurent blanc", "blanc"],
      ["bixente lizarazu", "lizarazu"],
      ["patrick vieira", "vieira"],
      ["didier deschamps", "deschamps"],
      ["youri djorkaeff", "djorkaeff"],
      ["zinedine zidane", "zidane"],
      ["thierry henry", "henry"],
      ["christophe dugarry", "dugarry"],
    ],
  },
  {
    key: "titan-real-2000",
    name: "2000 Real Madrid",
    shortName: "Real Madrid 2000",
    // The first listed player is the goalkeeper in every curated squad.
    // Stated explicitly so validateResolvedSquad() can CHECK it instead of
    // assuming list order stays that way.
    goalkeeperIndex: 0,
    verified: true,
    database: "cm9900_vanilla_original",
    filter: { club: "Real Madrid C.F." },
    players: [
      ["iker casillas", "casillas"],
      ["michel salgado", "salgado"],
      ["aitor karanka", "karanka"],
      ["ivan helguera", "helguera"],
      ["roberto carlos"],
      ["steve mcmanaman", "mcmanaman"],
      ["fernando redondo", "redondo"],
      ["ivan campo", "campo"],
      ["raul"],
      ["fernando morientes", "morientes"],
      ["nicolas anelka", "anelka"],
    ],
  },
  {
    key: "titan-united-1999",
    name: "1999 Manchester United",
    shortName: "Manchester United 1999",
    // The first listed player is the goalkeeper in every curated squad.
    // Stated explicitly so validateResolvedSquad() can CHECK it instead of
    // assuming list order stays that way.
    goalkeeperIndex: 0,
    verified: true,
    database: "cm9899_vanilla_original",
    filter: { club: "Manchester United" },
    // European Cup final XI, expressed in the tactics board's attacking-up
    // left-to-right slot order. The occurrence suffix distinguishes the two
    // centre-backs, central midfielders and forwards.
    lineupSlots: [
      "GK#0", "DR#0", "DC#1", "DC#0", "DL#0",
      "MR#0", "MC#1", "MC#0", "ML#0", "FC#1", "FC#0",
    ],
    players: [
      ["peter schmeichel", "schmeichel"],
      ["gary neville"],
      ["ronny johnsen"],
      ["jaap stam", "stam"],
      ["denis irwin", "irwin"],
      ["ryan giggs", "giggs"],
      ["david beckham", "beckham"],
      ["nicky butt", "butt"],
      ["jesper blomqvist", "blomqvist"],
      ["dwight yorke", "yorke"],
      ["andy cole"],
    ],
  },
  {
    key: "titan-real-2002",
    name: "2002 Real Madrid",
    shortName: "Real Madrid 2002",
    // The first listed player is the goalkeeper in every curated squad.
    // Stated explicitly so validateResolvedSquad() can CHECK it instead of
    // assuming list order stays that way.
    goalkeeperIndex: 0,
    verified: true,
    database: "cm0102_vanilla_original",
    filter: { club: "Real Madrid C.F." },
    players: [
      ["cesar"],
      ["michel salgado", "salgado"],
      ["fernando hierro", "hierro"],
      ["ivan helguera", "helguera"],
      ["roberto carlos"],
      ["claude makelele", "makelele"],
      ["luis figo", "figo"],
      ["santiago solari", "solari"],
      ["zinedine zidane", "zidane"],
      ["raul"],
      ["fernando morientes", "morientes"],
    ],
  },
  {
    key: "titan-portugal-2004",
    name: "2004 Portugal NT",
    shortName: "Portugal 2004",
    // The first listed player is the goalkeeper in every curated squad.
    // Stated explicitly so validateResolvedSquad() can CHECK it instead of
    // assuming list order stays that way.
    goalkeeperIndex: 0,
    verified: true,
    database: "cm0304_vanilla_original",
    filter: { nation: "Portugal" },
    players: [
      ["ricardo"],
      ["miguel"],
      ["jorge andrade"],
      ["ricardo carvalho"],
      ["nuno valente"],
      ["maniche"],
      ["costinha"],
      ["cristiano ronaldo"],
      ["deco"],
      ["luis figo", "figo"],
      ["pauleta"],
    ],
  },
  {
    key: "titan-liverpool-2001",
    name: "2001 Liverpool",
    shortName: "Liverpool 2001",
    // The first listed player is the goalkeeper in every curated squad.
    // Stated explicitly so validateResolvedSquad() can CHECK it instead of
    // assuming list order stays that way.
    goalkeeperIndex: 0,
    verified: true,
    database: "cm0102_vanilla_original",
    filter: { club: "Liverpool" },
    // 2001 cup-final XI in the same attacking-up, left-to-right convention.
    lineupSlots: [
      "GK#0", "DR#0", "DC#0", "DC#1", "DL#0",
      "MC#0", "MR#0", "MC#1", "ML#0", "FC#0", "FC#1",
    ],
    players: [
      ["sander westerveld", "westerveld"],
      ["markus babbel", "babbel"],
      ["sami hyypia", "hyypia"],
      ["stephane henchoz", "henchoz"],
      ["jamie carragher", "carragher"],
      ["gary mcallister", "mcallister"],
      ["steven gerrard", "gerrard"],
      ["dietmar hamann", "hamann"],
      ["danny murphy", "murphy"],
      ["emile heskey", "heskey"],
      ["michael owen", "owen"],
    ],
  },
  {
    key: "titan-lazio-1999",
    name: "1999 Lazio",
    shortName: "Lazio 1999",
    // The first listed player is the goalkeeper in every curated squad.
    // Stated explicitly so validateResolvedSquad() can CHECK it instead of
    // assuming list order stays that way.
    goalkeeperIndex: 0,
    verified: true,
    database: "cm9900_vanilla_original",
    filter: { club: "Lazio" },
    players: [
      ["luca marchegiani", "marchegiani"],
      ["paolo negro", "negro"],
      ["alessandro nesta", "nesta"],
      ["sinisa mihajlovic", "mihajlovic"],
      ["giuseppe pancaro", "pancaro"],
      ["dejan stankovic", "stankovic"],
      {
        legacyCanonicalId: "81217",
        canonicalPublicId: "player_juan_sebastian_veron_argentina_1975",
        aliases: ["Juan Sebastián Verón", "veron"],
      },
      ["matias almeyda", "almeyda"],
      ["pavel nedved", "nedved"],
      ["roberto mancini", "mancini"],
      ["simone inzaghi", "inzaghi"],
    ],
  },
];
// ---------------------------------------------------------------------------
// Proposed squads -- declared, NOT yet verified, deliberately not in the
// default catalogue.
//
// These are the extension contract in use, not decoration. Each one is
// either blocked on a database edition this project does not have, or
// pending a real resolution run. Nothing here is exposed to Titan Fight or
// Match Lab until `verified` flips, so an unverified alias can never
// silently become a fabricated lineup.
// ---------------------------------------------------------------------------

/** A preset that cannot be sourced at all yet, and why. Nothing currently
 * needs it -- kept because "declared but unsourceable" is a real state the
 * contract has to be able to express, and the alternative (inventing a
 * database slug so the preset looks available) is what this whole module
 * exists to prevent. */
function blockedSquad(key, name, shortName, season, blocked) {
  return {
    key, name, shortName, season,
    database: null, filter: null, players: [], goalkeeperIndex: 0,
    verified: false, blocked,
  };
}
void blockedSquad;

export const PROPOSED_SQUADS = Object.freeze([
  // 2004/05 squads resolve against fm2005_vanilla_original (Football
  // Manager 2005), the newest edition this project has. Every name below
  // was checked to exist in that edition's own canonical-name data before
  // being declared; where the plain name is ambiguous in fm2005, the entry
  // pins canonicalPublicId so resolution can never pick the wrong person.
  // They stay verified:false until a live `npm run squads:verify` run
  // confirms end-to-end resolution, including club membership.
  {
    key: "titan-chelsea-2005",
    name: "2004/05 Chelsea",
    shortName: "Chelsea 2005",
    season: "2004/05",
    database: "fm2005_vanilla_original",
    filter: { club: "Chelsea" },
    goalkeeperIndex: 0,
    // Promoted 2026-09-04 by a strict live run of `npm run squads:verify`:
    // all 11 resolved from fm2005_vanilla_original with the declared club.
    verified: true,
    blocked: null,
    players: [
      ["petr cech", "cech"],
      // Two Paulo Ferreiras in fm2005 (1973 and 1979); Chelsea's is 1979.
      { canonicalPublicId: "player_paulo_ferreira_portugal_1979", aliases: ["paulo ferreira"] },
      ["john terry"],
      ["ricardo carvalho"],
      ["william gallas", "gallas"],
      ["claude makelele", "makelele"],
      ["frank lampard", "lampard"],
      // Tiago Mendes is deliberately NOT declared: fm2005 holds four
      // Portugal-1981 records all displayed simply as "Tiago", and nothing
      // in the offline data distinguishes them. Guessing one would be
      // exactly the invented-id failure this contract forbids. Gudjohnsen
      // started plenty of this season and is unambiguous.
      ["eidur gudjohnsen", "gudjohnsen"],
      ["arjen robben", "robben"],
      ["damien duff", "duff"],
      ["didier drogba", "drogba"],
    ],
  },
  {
    key: "titan-milan-2005",
    name: "2004/05 Milan",
    shortName: "Milan 2005",
    season: "2004/05",
    database: "fm2005_vanilla_original",
    filter: { club: "AC Milan" },
    goalkeeperIndex: 0,
    // Promoted 2026-09-04 by a strict live run of `npm run squads:verify`:
    // all 11 resolved from the declared database with the declared club.
    verified: true,
    blocked: null,
    players: [
      // Ten "Dida" records in fm2005; Milan's keeper is the 1973 one.
      { canonicalPublicId: "player_dida_brazil_1973", aliases: ["dida"] },
      // Seven "Cafu"/"Cafú" records; Milan's right back is Brazil 1970.
      { canonicalPublicId: "player_cafu_brazil_1970_f21997d4", aliases: ["cafu"] },
      ["alessandro nesta", "nesta"],
      ["jaap stam", "stam"],
      ["paolo maldini", "maldini"],
      ["gennaro ivan gattuso", "gattuso"],
      ["andrea pirlo", "pirlo"],
      ["clarence seedorf", "seedorf"],
      // Three "Kaká"-shaped records; Milan's is Brazil 1982.
      { canonicalPublicId: "player_kaka_brazil_1982", aliases: ["kaka"] },
      ["andriy shevchenko", "shevchenko"],
      // Not Crespo: fm2005 records him as a Chelsea player (he was at
      // Milan on loan that season), so a club-filtered squad cannot
      // contain him. Inzaghi is Milan-registered in the same edition.
      ["filippo inzaghi", "inzaghi"],
    ],
  },
  {
    key: "titan-liverpool-2005",
    name: "2004/05 Liverpool",
    shortName: "Liverpool 2005",
    season: "2004/05",
    database: "fm2005_vanilla_original",
    filter: { club: "Liverpool" },
    goalkeeperIndex: 0,
    // Promoted 2026-09-04 by a strict live run of `npm run squads:verify`:
    // all 11 resolved from fm2005_vanilla_original with the declared club.
    verified: true,
    blocked: null,
    players: [
      ["jerzy dudek", "dudek"],
      ["steve finnan", "finnan"],
      ["jamie carragher", "carragher"],
      ["sami hyypia", "hyypia"],
      ["djimi traore", "traore"],
      ["steven gerrard", "gerrard"],
      // Two Xabi Alonsos in fm2005 (1981 and 1985); Liverpool's is 1981.
      { canonicalPublicId: "player_xabi_alonso_spain_1981", aliases: ["xabi alonso"] },
      ["john arne riise", "riise"],
      // Six "Luis Garcia" records; Liverpool's is the Spain 1978 one.
      { canonicalPublicId: "player_luis_garcia_spain_1978", aliases: ["luis garcia"] },
      ["harry kewell", "kewell"],
      ["milan baros", "baros"],
    ],
  },
  // These two also have a matching edition. Player aliases below are the
  // real historical line-ups, but they have not been resolved against the
  // database yet, so they stay verified:false until a resolution run
  // confirms every one of them matches. Promote by running
  // `npm run squads:verify`, not by editing this flag.
  {
    key: "titan-porto-2004",
    name: "2003/04 Porto",
    shortName: "Porto 2004",
    season: "2003/04",
    database: "cm0304_vanilla_original",
    filter: { club: "Futebol Clube do Porto" },
    goalkeeperIndex: 0,
    // Promoted 2026-09-04 by a strict live run of `npm run squads:verify`:
    // all 11 resolved from the declared database with the declared club.
    verified: true,
    blocked: null,
    players: [
      ["vitor baia", "baia"],
      ["paulo ferreira"],
      ["jorge costa"],
      ["ricardo carvalho"],
      ["nuno valente"],
      ["costinha"],
      ["maniche"],
      ["pedro mendes"],
      ["deco"],
      ["derlei"],
      ["benni mccarthy", "mccarthy"],
    ],
  },
  {
    key: "titan-galatasaray-2000",
    name: "1999/2000 Galatasaray",
    shortName: "Galatasaray 2000",
    season: "1999/2000",
    database: "cm9900_vanilla_original",
    filter: { club: "Galatasaray" },
    goalkeeperIndex: 0,
    // Promoted 2026-09-04 by a strict live run of `npm run squads:verify`:
    // all 11 resolved from the declared database with the declared club.
    verified: true,
    blocked: null,
    players: [
      ["claudio taffarel", "taffarel"],
      // Not "Capone": the only Capone in cm9900 is a Juventude player.
      // Fatih Akyel is Galatasaray-registered in that edition.
      ["fatih akyel", "akyel"],
      ["gheorghe popescu", "popescu"],
      ["bulent korkmaz", "korkmaz"],
      ["ergun penbe", "penbe"],
      ["okan buruk", "okan"],
      ["suat kaya", "suat"],
      // Not Ayhan Akman: he was at Besiktas in 1999/2000 and only joined
      // Galatasaray later. Umit Davala played in this side.
      ["umit davala", "davala"],
      ["gheorghe hagi", "hagi"],
      ["arif erdem", "arif"],
      ["hakan sukur", "sukur"],
    ],
  },
]);

/** The catalogue callers should use. Unverified squads stay out by default. */
export function listHistoricalSquads({ includeUnverified = false } = {}) {
  const all = [...CURATED_SQUADS, ...PROPOSED_SQUADS];
  return includeUnverified ? all : all.filter((squad) => squad.verified);
}

/**
 * Titan Fight's own opponent rotation -- deliberately NOT the same list.
 *
 * `verified` gates whether a squad may be SERVED at all; it does not decide
 * whether that squad is part of Draft's Titan Fight ladder. Promoting a new
 * preset (Chelsea and Liverpool 2004/05, verified 2026-09-04) makes it
 * available to Match Lab without silently lengthening a Titan Fight run or
 * changing the "played N of M" counter mid-ladder. Adding one to the ladder
 * is a deliberate product decision, made by setting titanFight: true.
 */
export function listTitanFightSquads() {
  return CURATED_SQUADS.filter((squad) => squad.verified && squad.titanFight !== false);
}

export function findHistoricalSquad(key, { includeUnverified = true } = {}) {
  return listHistoricalSquads({ includeUnverified }).find((squad) => squad.key === key) ?? null;
}

export { CURATED_SQUADS };
export const HISTORICAL_SQUADS = CURATED_SQUADS;
