# Draft engine migration baseline

Recorded: 2026-09-14

## Purpose

The existing `draft-setup` and `draft-run` form a complete short game. They
remain runnable while a separate product runner is built over the Match Lab
engine. This document records what the new route must preserve and which match
implementation it is intended to replace.

The executable characterization is
`tools/fixtures/gameplay/legacy-draft-baseline.json`, verified by
`npm run test:product-match-contract` and the existing `npm run test:draft`.

## Existing persisted inputs

### Completed drafted team

- Storage key: `retroball-draft-team-v1`.
- Payload version: 3.
- Team fields: name, formation, formation style, captain slot, mode and
  competition scenario.
- Player fields: stable slot, pitch position, line, captain flag, displayed and
  gameplay ability, position fit and the complete source player profile.
- A completed team contains eleven distinct slots and one captain.

### Draft in progress

- Storage key: `retroball-draft-progress-v1`.
- Payload version: 1.
- Restores formation, style, mode, scenario, captain, roll count, rerolls,
  quality/premium drought state, offered identities and drafted slot entries.
- Invalid or unavailable browser storage does not prevent an in-memory game.

## Existing game flow to preserve

- Classic, Titan Fight, From memory and Generative draft modes.
- The UCL 2002/03, UCL 2003/04, World Cup 2002 and Titan routes.
- Formation selection, player rolls, positional suitability, emergency cover,
  captain selection, player swapping and completed-team persistence.
- Group and knockout progression, extra time, penalties, result presentation,
  man of the match, records, squad sharing and friendly matches.
- The active match clock, commentary pacing, spatial mini-pitch, score, event
  timeline and final result navigation.
- Canonical/source player references and the existing historical-squad
  catalogue.

These behaviours are product requirements, not an instruction to reuse DOM
code. The new route may present them through new components as long as the
observable flow and saved-team compatibility remain intact.

## Match implementation to replace in the new route

The existing `draft-run.js` keeps its current `matchSimulation()` and remains
untouched. The new route replaces that simplified simulator with the shared
authoritative match session proven in Match Lab.

The new runner therefore replaces:

- aggregate team-line match resolution;
- zone/tick event generation;
- the page-owned simulation loop;
- implicit `Date.now()` / `Math.random()` run-seed creation;
- result-only persistence that cannot resume authoritative player and ball
  state.

It replaces them only in the new route. It must not gradually mix Match Lab
resolvers into the old `draft-run.js`, because that would leave two partially
shared engines and remove the stable comparison target.

## Shared product contract introduced

`src/lib/productMatchContract.js` defines three JSON-safe envelopes:

1. `retroball.match-input` v1 — engine version, explicit seed, format, teams,
   full player identities/profiles, lineup, substitutes, formation, roles,
   duties, individual instructions, team tactics, kickoff and metadata.
2. `retroball.match-continuation` v1 — input fingerprint, clock, period, score,
   possession, authoritative world state, current tactics, discipline, injuries,
   substitutions, decision memory and RNG state.
3. `retroball.match-output` v1 — input fingerprint, status, clock, score,
   timeline, commentary, player/team statistics, heat maps, discipline,
   injuries, substitutions and final continuation.

Every envelope is renderer-neutral, serializable and deterministically
fingerprinted. A continuation or output cannot be attached to a different
match input. The module also provides explicit adapters for the legacy
draft-team-v3 payload and the current DOM-free `matchSetup` model.

## Promotion evidence still required

- Move the Match Lab chunk simulator out of `match-lab.js` into a shared,
  DOM-free orchestration module.
- Make Match Lab consume that shared orchestrator without changing a saved
  scenario's trace.
- Make the new draft runner consume the same orchestrator.
- Prove identical input, seed and engine version yield identical action,
  responsibility, motion and result history in both consumers.
- Add product UI and persistence only after this engine parity holds.
