# Match Engine Architecture

The architectural source of truth for the match engine. `MATCH_LAB_PLAN.md`
remains the implementation history — what was built, when, and which
reported bug motivated it. This document describes what the pieces *are*
and which of them is allowed to change what.

## The pipeline

```
tactics and roles
  → perception of players, space and ball
    → candidate intentions and coordinated plans
      → continuous world simulation
        → football events
          → 2D (today) or 3D (later) playback
```

Each stage may only read backwards and write forwards. The rules that
follow are the specific consequences of that.

## Product match boundary

`src/lib/productMatchContract.js` is the versioned boundary between a game
mode and this pipeline. Match Lab, the engine-backed draft game and a future
career save must all describe a match through the same renderer-neutral
contracts:

- `retroball.match-input` v1 owns the explicit engine version and seed, both
  teams, player identities and profiles, lineup and substitutes, formation,
  tactical roles/duties/instructions and the opening restart.
- `retroball.match-continuation` v1 owns the resumable clock, score,
  possession, authoritative player/ball state, tactics, stamina-bearing world
  data, discipline, injuries, substitutions, decision memory and RNG state.
- `retroball.match-output` v1 owns the timeline, commentary, player/team
  statistics, heat maps, match events and final continuation.

The envelopes are JSON-safe and deterministically fingerprinted. Continuation
and output state carry the originating input fingerprint so a paused state
cannot silently resume under another lineup, tactic set, seed or engine
version. Fingerprints are deterministic integrity markers rather than
cryptographic signatures.

Adapters may translate an older product save into the current input contract.
They may not infer tactical meaning the old save never stored: the legacy
draft-team-v3 adapter therefore preserves its formation positions while
leaving tactical roles and duties null. The current `matchSetup` adapter can
carry those richer fields because they are authored explicitly.

This contract does not yet make the Match Lab simulator reusable by itself.
The current chunk simulator remains inside `match-lab.js`; extracting that
orchestration into a DOM-free module and proving Match Lab/product trace parity
is the next integration boundary.

## Player trait data boundary

FM 2005 Player Preferred Moves are stored outside the ability attributes in
`player_trait_definition`, `player_trait_source` and `player_trait_import`.
`tools/import_fm2005_player_traits.py` resolves decoded binary record offsets to
source player identities and refuses ambiguous, missing or mismatched joins. The
player-detail API exposes the resulting records as `profile.traits`, including
the stable key, source ID and mapping version.

Traits are personal action tendencies. They enter the engine as bounded,
observable candidate-utility contributions after laws, geometry and physical
reachability establish that an option is valid. Presence in the database or API
does not by itself make a trait influential. Match-engine adoption requires
deterministic counterfactual fixtures and trace evidence for each implemented
trait family.

## World state ownership

There is exactly one authoritative world state per possession: the
per-possession roster clone inside `runConstructedPossession()`
(`match-lab.js`), plus the independent ball state (`matchBallCore.js`) and
the shared motion record (`motionContext.state.players`).

| State | Owner | May be written by |
| --- | --- | --- |
| Authored setup (`state.roster`) | The user | The Match Lab UI only. Never by a resolver, never by playback. |
| Simulated player position | The motion layer | Only a committed, physically-reachable trajectory endpoint. |
| Player velocity / intention | The motion layer | `worldMotion.js` `writeMotionRecord()`, `matchMotion.js` `resolveMotionBatch()`, `reactOffBallContinuous()`. |
| Ball position / trajectory | The ball layer | `matchBallCore.js`, `matchPassFlight.js`, `ballRollPhysics.js`. |
| Events (the trace) | Resolvers | Append-only; an event *describes* state, it does not *create* it. |
| Playback tracks / frames | `matchLabPlayback.js` | Derived. Never read back into gameplay. |

The authored setup is immutable for the duration of a run. A possession
resolves against a clone; a later drag on the pitch must never
retroactively change what an already-finished run says it started from.

## Intentions versus movement

Five things used to be conflated into a single `Object.assign(entry,
target)`. They are now distinct, and `src/lib/worldMotion.js` is the
enforcement point:

1. **Intention** — what the player is trying to do: `"recovery-track"`,
   `"support-run"`, `"press"`, `"run-in-behind"`.
2. **Intention target** — the tactical destination that intention implies.
   This is *not* a position anybody is at. A planner may compute it freely.
3. **Gait / effort** — how hard they are willing to run at it, and what
   that costs (`full-sprint`, `controlled-sprint`, `jog`).
4. **Trajectory** — the real, physically-limited path actually covered in
   one authored window, starting from the player's current position *and
   current velocity*. Produced by `sampleContinuousTrajectory()`
   (`matchMovementTiming.js`) over the `reachIn()` kinematics in
   `playerKinetics.js`. There is no second physics model anywhere.
5. **Authoritative position** — where that trajectory genuinely ended.
   This, and only this, may be written back onto a roster entry, and it is
   what every later decision reads.

> A tactical planner may decide **where a player wants to be**.
> Only the motion layer may decide **where they actually are**.

`advanceMotion()` is the sanctioned way to cross that line. Give it a
position, a velocity, an intention target and an elapsed window; it
returns the position genuinely reached, the velocity still being carried,
and the trajectory to draw. A window too short to reach the target
produces a partial advance and a live exit velocity — never a jump to the
target.

`auditMoveSpeed()` is the check that says whether an authored move was
honest: did it cover more ground than this player could possibly cover in
the window it was scheduled into, given the speed they entered at? A move
that fails this is a teleport, however smoothly it is drawn.

### Arriving is part of the locomotion model

Getting up to speed and coming off it are both physics, and until Stage 4
only the first half existed. `reachIn()` / `speedAtElapsed()` described
acceleration; nothing described braking, so a leg that reached its target
simply had its velocity assigned zero. Measured on the fixture sweep that
was a real discontinuity rather than a rounding artefact — a defender
covering across during a `DEF.ADJUST` window was travelling 3.7 yd/s at one
playback keyframe and 0 at the next.

`playerKinetics.js` now owns the other half:

- `decelerationRate(player)` — yards per second squared, expressed as a
  multiple of that player's **own** acceleration rate rather than as an
  independent constant, so it stays inside the existing Pace/Acceleration
  vocabulary instead of becoming a second speed model. Agility scales it,
  exactly as it already scales `turnRetention()` and `reigniteFactor()`:
  checking your momentum and planting is the same physical quality as
  changing direction on it. Braking is *harder* than acceleration for a
  real athlete, so the multiplier is above 1.
- `brakingDistance()` / `brakingSeconds()` / `speedAfterBraking()` — the
  standard SUVAT queries over that rate.

`matchMovementTiming.js` turns those into a real approach.
`arrivalBrakeProfile()` plans a leg as accelerate → (optionally hold top
speed) → brake to rest exactly **on** the target, with

```
vPeak = min(topSpeed, sqrt((2·a·b·D + b·v0²) / (a + b)))
```

as the fastest this player may travel and still stop in the distance left.
`sampleContinuousTrajectory()` applies it under two conditions, and both
matter:

- **only when the leg genuinely ends there.** A leg carrying
  `continuesAfter` is a waypoint in a longer run — a carry's per-touch
  chase — and braking one to rest would be exactly the go-stop-go bug that
  `paceToArrival` was introduced to remove.
- **only when the whole profile fits inside the window.** The position at
  the window's end is then still the target, so no authoritative coordinate
  moves. Braking reshapes the *approach*; it never shortens the leg, and it
  never changes where the player ends up.

## Action/event versus trajectory

An event (`traceEvent()`) is a *description* of something the engine
decided, carrying the movement that decision produced. It is not itself a
movement instruction, and playback may not infer gameplay from it.

Two timing rules follow, both learned from real reported bugs:

- An event's authored `duration` is its own honest physical duration. It is
  never stretched to fill a longer producing window (that was the 2026-08-20
  "off-ball players move in slow motion during a long pass" bug), and since
  World Motion Contract v1 it is never **compressed** into a shorter one
  either (that was the turnover teleport: a real 7.6-yard, 1930 ms recovery
  run replayed inside a 40 ms interception window, i.e. 189 yd/s for a
  player whose top speed is 8.7 yd/s).
- A reaction that overlaps the action which triggered it stays concurrent
  (it does not consume timeline of its own) but *may* finish after that
  action does — because that is what really happens. A defender who starts
  tracking back as the ball is intercepted is still running when the next
  action begins.

Playback interpolates *between* authoritative positions. It may add
smoothing (hermite tangents from the velocities the engine stated), never
ground.

## One trajectory per player at a time

Letting a reaction outlive its producer created a second-order problem
that nothing handled, and it shipped as a visible regression: the next
action starts while a player is still running, authors *another* movement
for that same player, and both clips' keyframes end up sorted into one
track. The marker then alternates between two trajectories — nudge
forward, yank back, nudge forward. Measured on a 12-possession 11-a-side
fixture, that was 1058 interleaved keyframes and 621 near-180° reversals.

The invariant, enforced in `arbitrateSegment()` (`matchLabPlayback.js`):

> A player may have at most **one** authoritative movement segment at any
> instant.

When a movement is scheduled for a player who is already running one:

- **Continue** — same action, and the new endpoint is within
  `CONTINUE_SAME_TARGET_TOLERANCE` of the active one. This is the same run
  still in progress, re-authored by the next action's batch. Extend the
  existing segment; do not author a competing clip.
- **Supersede** — the intent or target genuinely changed. Sample the
  player's real position *and velocity* at the new movement's start time,
  drop every keyframe of the old segment after that instant, and start the
  replacement from that sampled state. The replacement's first keyframe
  keeps the sampled velocity as its hermite tangent, so a retarget curves
  out of the old heading rather than snapping into the new one.

Two rules this must never be "fixed" by breaking:

- The superseded run's **future endpoint is not a position**. A
  replacement never starts from it, even though the engine has already
  committed the player there — the playback clock had not reached it.
- A long clip is **never re-compressed** back into a short window. That
  reinstates the teleport (189 yd/s) that World Motion Contract v1
  removed.

Concurrency is still normal and desirable: ATT/GK/DEF adjustment batches
run concurrently whenever they name *different* players. Only multiple
clips for the *same* player are arbitrated.

`validateMatchLabPlaybackPlan()` fails the build if two authoritative
segments for one player ever overlap, so a future change that reintroduces
a competing clip breaks loudly instead of degrading into twitching.

## Diagnostics: derived, never authoritative

Match Lab's per-event **Movement timing** disclosure shows start/end
coordinates, distance, natural ETA, scheduled duration, start/end speed,
average speed, top speed, acceleration contribution, requested gait, and
the intention responsible — plus a loud marker when a move exceeded its
physical limit. All of it is derived in `matchLabPlayback.js` from state
the engine already committed. None of it feeds back into gameplay.

Presentation state is never authoritative: camera, CSS durations, mesh
coordinates, easing, label positions, net deformation, particles. The rule
of thumb is the replay harness's: *if changing the value could change who
reaches the ball, what action succeeds, or what happens next, it is
engine state.*

## Setup state versus engine state

Setup is what a person authored *before* anything runs. It is a separate
layer with its own modules, none of which simulate, render, or touch the
DOM:

| Module | Owns |
| --- | --- |
| `src/data/historicalSquads.js` | The declarative squad catalogue. Data only, no imports. |
| `src/lib/historicalSquadResolver.js` | Turning a declaration into real database players. Takes `searchPlayers` injected; never calls the network itself. |
| `src/lib/formationTemplates.js` | Formation templates, the slot-coordinate model, orientation and reduced-sided projection. |
| `src/lib/matchSetup.js` | Format, squads, shape, assignments, instructions. |
| `src/lib/restartSetup.js` | Dead balls and the restart that must end them. |

Three field distinctions the setup model keeps and must not collapse:

- **Positional slot** is where a shirt stands ("DC", "AMR"). It changes
  when the formation changes.
- **Tactical role** is what kind of player they are asked to be in that
  slot. **Duty** is how far they take it. Same slot, different job.
- **Engine job** is what the engine has them doing this instant
  ("recovery-track", "press"). The engine owns it, it changes several
  times a possession, and setup never authors it — it is carried only so a
  debugger can show authored intent beside live behaviour.

Two rules with teeth:

- **Reduced-sided projection is deterministic.** 3v3, 5v5 and 7v7 keep the
  goalkeeper, then fill each band from its own most-central slot outward.
  Same inputs, same XI, every time. "Random XI" exists only as an explicit,
  seeded preset — never as a fallback a projection drifts into.
- **A restart is a dead ball plus a required first action.** Every spec
  from `createRestartSetup()` carries `deadBall: true` and a
  `requiredFirstAction` (`RESTART.CORNER.TAKE` and friends). A restart
  therefore cannot fall straight into a generic open-play `ACTION.CHOICE`.
  Layouts are authored once, in yards relative to the ball, for one
  attacking direction and one side, then mirrored — so no restart
  coordinates get scattered as literals through `match-lab.js`.

"Attacking free kick" and "defending free kick" are UI presets over one
`free-kick` type with different location bands, not separate mechanics.

## Restart execution

A restart is a dead ball plus a **required first action**, and that action
must be resolved before ordinary possession may begin. The rule has teeth:
`runConstructedPossession()` executes the pending restart *before* its own
loop starts, so a restart can never fall through into a generic
`ACTION.CHOICE`.

| Module | Owns |
| --- | --- |
| `src/lib/restartRoles.js` | Who takes a restart, and which player fills each restart role. |
| `src/lib/restartPreparation.js` | Seeded quick/normal preparation phases, set position, signal choice and throw-in range. |
| `src/lib/restartExecution.js` | Which real resolver a restart dispatches to, and the release back into open play. |

Three things this deliberately does **not** own. Every football outcome
comes from the existing resolvers — pass flight, cross delivery, aerial
contest, wall and keeper logic are reused, never re-derived as
Match-Lab-only formulas. The taker is a football choice (tiered by
position, then by the attributes that restart actually needs, then by
database-qualified identity) rather than an array index; picking the first
outfielder in formation order is what made a left-back take a kick-off.
And a restart's roles are filled by suitability, so a striker never ends
up in the wall and the goalkeeper never leaves their goal.

**Ownership of a dead ball** means "the player standing over it", not that
play has started. The taker owns it, `state.ball` still carries a dead
phase, and `state.pendingRestart` stays authoritative. Moving the ball off
its legal spot cancels the restart explicitly and converts the setup into
ordinary open play, because a corner taken from the centre circle is not a
corner.

**Shape survives the transition.** Every roster entry carries both its
temporary restart position and its oriented open-play `formationAnchor`.
Once the ball is live, a short release phase moves players toward their
open-play jobs through the ordinary motion system, so Pace and
Acceleration govern the travel and nobody teleports from a restart
coordinate onto a formation dot. The anchor is a reference for shape, not
a destination everyone is dragged to.

### Forward dependency

Restart execution is complete enough to support later work, but does not
reorder it. The only forward sequence is the six-stage Roadmap below: action
pattern/schema first, Dynamic Ball Claim second, and Match Session fifth.

## Team shape and persistent phase intelligence

`src/lib/teamPhase.js` and `src/lib/teamShape.js` are the coordination
layer between authored tactics and physical motion. They are pure,
DOM-free modules: a formation anchor, tactical role and duty describe the
player's reusable reference shape; the current phase and one reserved
team job describe what that player should try to do now. Neither module
is allowed to place a player directly.

The reference clips were reduced to reusable football primitives rather
than scripted sequences: short kickoff layoff and run-off support, split
centre-backs, a recycle pivot, immediate full-back/wing width, staggered
first and second support, a line pinner/depth runner, two-player rest
defence, one presser plus cover and screens, direct aerial target plus
second-ball support, and wing-oriented outlets with far-side balance.
`coordinateTeamShape()` reserves those complementary jobs once for the
whole team, then blends only genuinely exceptional local intentions such
as an offside recovery or run in behind.

The persistent phases are `restart`, `restart-release`, `build-up`,
`progression`, `final-third`, `attacking-transition`,
`defensive-transition`, and `defensive-block`. They are derived only from
authoritative facts: ownership/team, ball position and travel, owner band,
restart events, attacking direction, and elapsed engine time. Boundary
hysteresis and minimum holds prevent one sample near a third line from
flipping the whole side back and forth. A short restart is guaranteed an
opening build-up hold after release; a direct opening may legitimately
advance immediately.

The state boundary is explicit:

- Match Setup owns `positionalSlot`, `tacticalRole`, `duty`, and the
  oriented `formationAnchor`.
- The possession-local `motionContext` owns phase history, reserved team
  jobs, velocities, intentions, and diagnostic snapshots.
- Team shape produces `shapeTarget` and `intentionTarget`; it never writes
  coordinates onto the roster.
- `worldMotion.advanceMotion()` converts each intention into the position
  actually reachable in that window. Only that reached position is
  committed and authored in the trace; playback merely renders it.

## Three-layer spatial model

Spatial state now has three deliberately different layers. They coexist;
none is a lossy replacement for the layer above it.

| Layer | Representation | Owner | Permitted use |
| --- | --- | --- | --- |
| Continuous physics world | Authoritative `{x, y}` in pitch percent, converted through the canonical 75x120-yard `pitchGeometry.js` world | Motion and ball layers | Movement, contact, interception, distance, trajectories, and committed positions. |
| Tactical-region lens | Five physical left-to-right lanes x six attacking-direction-relative depth bands | `src/lib/pitchRegions.js` | Team-shape diagnostics, occupation, intended-region descriptions, pattern features, and later decision inputs. It classifies; it never places. |
| Legacy execution zones | Numeric 3x4 index, `0..11` | Existing resolver paths (`zoneFromPercent()`, `ZONE_CENTERS`, and their current consumers) | Unmigrated zone-era probability/context lookups only. |

The tactical lanes are `left-touchline`, `left-half-space`, `centre`,
`right-half-space`, and `right-touchline`. Their edges preserve the prior
Team Shape 16/38/62/84-percent convention exactly, centralized as real-yard
boundaries in `pitchRegions.js`. Left and right are physical pitch sides and
therefore do not swap when attacking direction changes.

The depth bands are `defensive-box`, `first-build-up`, `second-build-up`,
`progression`, `chance-creation`, and `attacking-box`. They are measured from
the team's own goal in its current attacking direction. Their canonical
edges are 0/18/40/60/84/102/120 yards: both penalty-area depths and halfway
are physical anchors; the remaining two coaching boundaries divide build-up
and progression without moving a player onto a line.

### Tactical-region API and ownership

`pitchRegions.js` is DOM-free and deterministic. It owns `VERTICAL_LANES`,
`laneForX()`, the depth-band vocabulary/boundaries, stable prefixed region
ids, point classification, mirroring, semantic flags, normalized soft
membership near an edge, and a real-yard hysteresis helper. `teamShape.js`
re-exports its old lane bindings for compatibility; it no longer contains a
second lane table or classifier.

The API returns descriptions such as
`tactical:left-half-space:chance-creation`. A tactical classification carries
no `zone` field and is never numeric, so it cannot accidentally enter legacy
expressions such as `Math.floor(zone / 3)`. Soft membership and hysteresis
return weights/stable labels only. They do not round, snap, clone into, or
write the point being observed.

`teamShape.js` annotates each coordinated assignment with its current,
reference-shape, and intended regions after target separation. It derives
lane/depth occupation, wide-channel and half-space coverage, complementary
job-to-region diagnostics, and whether a run heads into a team-occupied or
open region. Those fields report decisions already made; target coordinates,
roster entries, motion, contacts, and RNG consumption are unchanged.

### Migration boundary

New tactical reasoning may consume the 5x6 lens explicitly, one system at a
time. It must continue to pass the original continuous point to physics.
Existing 12-zone readers remain unchanged until a separately measured
migration removes each one; tactical ids must never be passed as their zone
argument. The Match Lab overlay is likewise a renderer-only inspection of
derived regions and cannot feed gameplay state back into a resolver.

Acceptance is measured by `tools/test-pitch-regions.mjs`: 25/25 checks pass
across all lanes and bands in both directions, mirroring, edge stability,
normalized deterministic soft weights, coordinate immutability, Team Shape
no-mutation/diagnostics, the optional overlay contract, and the unchanged
0..11 legacy mapping. The complete package run is 21/23 commands green. Its
two failures match the pre-implementation baseline: `test:draft` has an
exact-whitespace CSS substring assertion, and `test:replay-harness`'s saved
`repeated-carry-burst-drain` scenario reaches the existing 50-action cap.
Replay determinism and every shape, phase, motion, spatial, Match Setup, and
new tactical-region check are green.

This is also the exact boundary with **Dynamic Ball Claim v2**, now built
(see "Loose-ball claims" below). Team Shape accepts the authoritative
owner/possession team (or no owner) and coordinates everyone around that
fact. It does not decide who should claim a loose ball, repair the
unreachable through-ball claimant, or transfer ownership based on pursuit.
`ballClaim.js` runs the candidate/reach race and reports the claimant; the
possession loop authors the resulting ownership fact and hands it to phase
and shape. No claim heuristic belongs in the shape controller, and the race
itself authors nothing.

## Action patterns

Real-life reference passages are **pattern fixtures**, never runtime
sequences. A pattern proposes; the existing spatial, team-shape, motion,
ball and resolver systems stay authoritative.

| Module | Owns |
| --- | --- |
| `src/lib/actionPatternSchema.js` | The declaration format: validation, normalization, mirroring, and the frame-annotation format. Data only. |
| `src/lib/actionPatternRegistry.js` | The declared vocabulary and the deterministic matcher that turns declarations into candidate intentions. |
| `tools/pattern-annotations/*.json` | Authored observations of real passages. Evidence, not runtime data. |

### Four words that are not synonyms

- **Observation** — one authored reading of a real passage. Evidence. Lives
  in an annotation file; nothing at run time reads it.
- **Primitive** — the small reusable action an observation distils to:
  `arc-overlap`, `support-short`. A vocabulary word.
- **Pattern** — a declaration saying *when* a primitive is worth proposing,
  *who* fills each abstract slot, and what job it proposes.
- **Intention** — what the engine adopts for one player this beat. Produced
  by the registry, consumed by the motion layer.

### What a pattern may never be

Not a scripted sequence, not an animation, not a predetermined outcome, not
a list of absolute coordinates, and never tied to a named player. A pattern
may not write a roster coordinate, touch ball state, author a playback
event, call a resolver, or decide whether an action succeeds. It returns a
proposed job and a *target-derivation request*; the caller supplies the
geometric function, which is the same one the behaviour already used.

Participants are abstract slots — `ballOwner`, `passer`, `wideRunner`,
`coverDefender`, `marker` — validated against a closed list. A declaration
naming a player, or an annotation carrying coordinates or embedded media,
is rejected rather than ignored.

### Composition and conflict

Fragments are small and several fire per beat: a passer taking
`run-off-pass`, a full-back on `arc-overlap`, a midfielder giving
`support-short`, a forward on `pin-last-line`. Two rules keep that sane,
both enforced in the registry rather than by each caller:

- **Participant claims** — one player holds at most one proposed job per
  beat. The first pattern to claim them wins; a later pattern wanting the
  same player is rejected *with a reason*, never silently overwritten.
- **Exclusivity groups** — patterns sharing a group compete for limited
  capacity. `special-run` has capacity **1**, which is exactly the
  pre-existing "1 special run" cap that `selectSpecialMover()` enforced by
  falling out of a fixed if-chain. The cap is preserved, not replaced.
  `run-off-pass` sits deliberately outside the group, as it always did.

Ordering is by (group priority, declaration order) — both static, so the
outcome never depends on object iteration order. The matcher consumes no
randomness at all.

### Mirroring

`mirrorActionPattern()` reflects a declaration across the long axis. Lanes
swap; depth bands do **not**, because a band is already expressed relative
to the team's own goal. Distances, angles and yard parameters are
unchanged — mirroring reflects, it does not rescale. One declaration
therefore describes both flanks with no second copy to drift.

### Regions classify; they never become destinations

`pitchRegions.js` supplies the tactical vocabulary a trigger is expressed
in. It never supplies a target: a region centre is not a destination, and
no coordinate is ever snapped to a boundary. Exact geometry stays
continuous and stays in `spatialDecision.js`.

### How V1–V10 decompose

A reference passage containing four useful actions becomes **four reusable
fragments**, not one indivisible sequence. The shipped V4 annotation is the
worked example: one passage, three independent observations
(`run-off-pass`, `support-short`, `arc-overlap`), each of which can fire
alone in a completely different phase of play.

### Migrated in this pass

Six declarations, all reusing the engine's existing job names rather than
inventing synonyms:

| Pattern | Source | Group |
| --- | --- | --- |
| `pattern:vacate-pocket@1` | V1 | `special-run` |
| `pattern:arc-overlap@1` | V4 | `special-run` |
| `pattern:peel-square@1` | V5 | `special-run` |
| `pattern:show-wide@1` | V7 | `special-run` |
| `pattern:check-decel@1` | V5 | `special-run` |
| `pattern:run-off-pass@1` | V4/V9/V10 | none |

`selectSpecialMover()` now routes through the registry. The original
if-chain is preserved verbatim as `selectSpecialMoverDirect()` and is the
**parity reference**: a 40-fixture A/B sweep asserts the two agree on both
the chosen player and the chosen target, including on the fixtures where
neither fires. Anything the declarations do not cover falls back to it.

## Loose-ball claims

A loose ball is claimed by **one** player, and that claim is decided against
the ball's own real decelerating roll rather than against a snapshot of
where it happened to be when it came loose.

| Module | Owns |
| --- | --- |
| `src/lib/ballRollPhysics.js` | The friction model. One deceleration constant for the whole engine. |
| `src/lib/ballClaim.js` | Projecting the roll, racing every candidate against it, and saying who cannot get there and why. Pure, RNG-free, writes nothing. |
| `src/lib/matchBallCore.js` | `selectLooseBallRecovery()`, now the **static fallback only** — the right answer when there is no real momentum to race. |

### The defect this replaced

The claim used to come from `selectLooseBallRecovery()`, which asks
`predictBallPosition()` where the ball will be in 320 ms under an
exponential drag constant that is a **different friction model** from the
one the ball then actually rolls under. Measured, at a real through-ball
landing speed of 26 yd/s:

| | Distance |
| --- | --- |
| What the 320 ms prediction saw | 5.8 yd |
| What the ball genuinely travelled | 91.4 yd over 7.0 s |

So the claim was effectively awarded to whoever stood nearest the landing
spot, who then chased a ball running away from them for the rest of its
roll. That is the reported "passer chasing a loose ball" bug, and it was
structural rather than a tuning error. Both numbers are pinned as tests, so
the two models cannot silently diverge again.

### The race

Every player on the pitch is raced against the roll, sampled at 40 ms. A
candidate claims the ball at the earliest instant their own real arrival
time — `timeToReach()` plus the shared contact reaction delay, the same
kinetics everything else uses — is no later than the ball's own arrival at
that same point. Three outcomes, and only three:

- **intercept** — meets the moving ball. This is the claim.
- **pickup** — nobody intercepts, the ball finishes rolling, and whoever
  reaches the resting point first collects it.
- **abandon** — provably cannot get there. A ball that crosses a line has
  no claimant *and* no pickup: it is a restart, not a recovery.

Abandonment is the part that did not exist before.
`selectLooseBallRecovery()` always returns the least-bad candidate however
hopeless, which is why nothing ever pulled up. Every abandonment now carries
a reason and a shortfall, which is what the diagnostics panel shows.

`leadChanges` records how often the best-placed racer changed identity as
the ball slowed — the observable evidence that this is a continuous race and
not a single up-front decision. It is pure instrumentation, off by default
in the engine's hot path, and no outcome depends on it.

### Nobody is dragged after a ball they never touched

The visible half of the same bug lived in playback, not in the race. A ball
rolling out untouched authored a restart naming the last toucher as the
**contact actor at the exit point**, and `matchLabPlayback.js` re-pins every
contact actor onto its contact point ("makes sure the actor is provably at
the ball at the instant contact says they are"). The passer was therefore
teleported after a ball they never chased.

`actor` on such a restart is an **attribution** — whose touch is blamed —
not a player making a contact. That one call site now authors no contact.
Every other pitch-exit caller is a genuine touch and is unchanged.
Measured over a 120-fixture sweep of unreached deliveries: **9 of 9** balls
that rolled out pinned the passer to the exit point before, **0 of 9**
after.

### Claiming as declared vocabulary

`pattern:claim-loose-ball@1` states the conflict rule that matters: the
exclusivity group `loose-ball` has capacity **1**, so exactly one player is
authorised to go for a given ball. That is the same shape of rule as the
`special-run` cap — a real football constraint expressed as capacity rather
than as control flow. Abandonment needs no declaration of its own; it is
simply the complement, which is exactly how `shouldChaseLooseBall()` answers
for everybody who is not the claimant.

`"loose"` is a real third possession state, not a shade of
attacking/defending: nobody owns the ball, so those two have no referent.

Migration follows the same discipline Stage 1 established.
`selectLooseBallClaimantDirect()` is the physics answer and the **parity
reference**; `selectLooseBallClaimant()` routes through the registry and
must agree with it. A 48-fixture sweep asserts they do, including on the
fixtures where nobody claims at all.

### What this does not do

It does not decide whether an action succeeds, write a roster coordinate,
author a playback event, or consume a single unit of randomness — all four
are asserted, not assumed. `worldMotion` remains the only system that turns
a claim into movement.


## Joint pass/run candidates

A pass candidate used to mean one thing:

> play the ball from the owner to a teammate's current coordinate.

It now means:

> this passer attempts this delivery toward this spatial point while this
> teammate makes a physically reachable run to meet it there.

The passer, the runner, the intended point and the delivery are generated
and scored as **one** object.

| Module | Owns |
| --- | --- |
| `src/lib/passRunCandidates.js` | Meeting-point generation, the joint candidate contract, viability and deterministic scoring. Pure, RNG-free, writes nothing. |
| `src/lib/spatialDecision.js` | Integration: one joint candidate per teammate, one through-ball candidate, in the existing Free Play list. |
| `match-lab.js` | Binds the real engine functions the candidate module needs, and executes whatever is chosen. |

### The candidate contract

Every candidate carries the passer and runner ids, the source point, the
runner's start point, the intended meeting point and its kind, the pattern
job behind it, the pass type and distance, whether receiver mobility changed
that type, the runner's distance, reaction and ETA, the ball ETA, the nearest defender's ETA and id, the arrival and
contest margins, lane obstruction and any lane interceptor, the kick-time
offside snapshot, the tactical region, progression gained, the passer's
credible range, viability, a rejection reason from a closed list, the
utility and a term-by-term breakdown.

A rejected candidate is still returned with its reason. "Why was this not
offered" is exactly what the diagnostics panel has to answer.

### How the three arrival times are compared

Everything is expressed in milliseconds from the kick, which is the only
reason this belongs in one module rather than three:

- **ball** — `passFlightProfile()` speed for the chosen type over the
  distance to the *intended point*, through the same duration helper the
  resolvers use.
- **runner** — the per-player reaction delay plus travel time on the
  `reachIn()` curve. A runner who already holds a forward intention carries
  real momentum into that curve rather than starting from rest.
- **defenders** — every opponent, and the keeper when supplied, racing the
  same point from their own pose.

`arrivalMargin` is runner minus ball; `contestMargin` is quickest defender
minus runner. Negative arrival means the runner is there waiting.

### Meeting-point generation

Seven kinds: current position, short support, forward lead, diagonal lead,
run in behind, wide release, and a pattern-proposed point from the off-ball
planner. Each names a *picture*; the coordinate is derived from live
geometry every time. `pitchRegions.js` describes where a point landed and
never supplies one.

Two filters keep the set honest. Lead distances are scaled by what the
runner can genuinely cover while the ball is travelling, and a point closer
than four yards to the teammate's own position is not generated at all — a
"lead" of a yard or two is that teammate's feet with rounding on top.

### Selection versus execution

Candidate generation decides whether an idea is *worth attempting*. It
never decides whether it works. Execution error, the actual endpoint,
interception, first contact, control, turnover and loose-ball continuation
all stay in the resolvers.

The intended point is where the passer **aims**. Accuracy scatter is applied
to it to produce the actual endpoint, and the two are never reconciled: the
ball does not bend toward the receiver, so a joint candidate can and does
miss its own meeting point. Both are recorded on the delivery event, so the
aim can be drawn separately from where the ball actually went. During the
flight every candidate races the real trajectory; if nobody reaches it, the
resulting ball state is handed to Dynamic Ball Claim v2 exactly as before.

The chosen point and pass type are both carried through `ACTION.CHOICE` into
the resolver. A current-position candidate therefore remains a pass to feet;
the resolver cannot replace it with its older generic lead rule. This fixes
the planner/execution disagreement where a legal to-feet option was judged
with one endpoint and then struck faster and farther toward another.

### Receiver-aware delivery weight

For a safe current-position option no longer than 28 yards, a receiver below
a 13-point blend of Pace (70%) and Acceleration (30%) is preferred at their
feet. A medium-range driven-ground baseline is weighted down to the more
controlled ground profile, which travels more slowly and has less accuracy
scatter. A quicker receiver keeps the driven delivery. If the feet option is
not viable, the slower player may still attack a viable lead point; the rule
does not erase runs into genuinely better space. That receiver adjustment is
bounded to controlled passing range and can never turn a long aerial delivery
back into a ground pass.

### Unrealistic long ground passes

`selectPassType()` supplies an intent-aware geometric baseline. Passes through
15 yards stay on the ground. Clear passes under 30 yards may be driven on the
ground. From 30 to 35 yards, that delivery survives only for an unusually
clear pass to feet from a sufficiently powerful technician. Passes into space
from that range and every pass beyond 35 yards use an aerial family: driven
aerial when power and lane geometry support it, lofted otherwise.

The joint-candidate layer retains a 35-yard ground-family credibility ceiling
as a defensive invariant for forced or stale inputs. A pass explicitly forced
to stay on the ground beyond it is rejected as `ground-pass-too-long`. A long
pass is never rejected merely for being long; it is rejected for being longer
than the passer can credibly strike, which is a separate test against their
own range. Each executed `P.PASS` records type, semantic intent, distance,
peak height and launch speed in `metrics.passFlight`.

A failed chest control has two physical ball legs. The incoming aerial pass
ends at the chest-contact point; `P.CHEST.SPILL` then carries the loose ball
from that point to the reachable recovery or resting point. The spill owns a
real duration and trajectory, while the winner's body races it independently.
This prevents the ball from jumping between the two points and keeps the
defender who made the last chest contact authoritative for any resulting
restart.

### Preserving the RNG contract

`chooseCandidate()` draws exactly one `decisionRandom()` value per
candidate, in list order, so a list of a different length silently re-keys
every later draw. One teammate therefore still yields exactly one pass
candidate, and there is still exactly one through-ball candidate. Candidate
generation itself consumes no randomness at all.

The through-ball candidate keeps its pre-existing gate: the off-ball planner
must have assigned that teammate a genuine run in behind. Stage 3's
contribution is that the delivery is now jointly evaluated — real meeting
point, real arrival race, real defender ETA, real kick-time offside — not
that the gate is looser. Dropping it was measurably wrong: a congested
cluster began offering itself a through ball on every decision and the
recorded `congested-pass-loop` bug scenario started looping again.

### Not re-tuning ordinary passing

A pass to a teammate's own feet scores **exactly** what it always scored.
Every joint term is zero for that case, because the existing pass utility
already describes it completely: distance, lane, receiver pressure, result
position, congestion and style. The joint model only speaks about what the
old model structurally could not see, which is a run to somewhere the
teammate is not yet standing. Scoring arrival and contest there as well
double-counts lane and pressure, and an early version of this module did
exactly that: marked teammates were penalised twice, passing collapsed, and
possessions degenerated into hold and dribble streaks.

### Integration with the other stages

Action patterns supply compatible runner intentions and the
pattern-proposed meeting point. Dynamic Ball Claim v2 takes over whenever a
delivery is not met. Team Shape is unchanged and still owns where everyone
else stands. `worldMotion` remains the only system that turns any intention
into movement.

## Roadmap

Staged prompts and current status live in [`MATCH_ENGINE_ROADMAP.md`](MATCH_ENGINE_ROADMAP.md), which is the planning source of truth. Summary:

1. ~~**Parameterized action vocabulary and frame-annotation format**~~ — **built** (see "Action patterns" above). Was: the
   schema patterns are authored in.
2. ~~**Dynamic Ball Claim v2**~~ — **built** (see "Loose-ball claims"
   above). Was: claimant selection and unreachable through-ball pursuit,
   feeding authoritative ownership into the formation/role/duty/phase
   layer.
3. ~~**Joint passer/runner candidate generation**~~ — **built** (see
   "Joint pass/run candidates" above). Was: time-to-arrival and pitch
   control, so a pass and the run that makes it possible are chosen
   together rather than independently.
4. ~~**Playback fluidity and rebound realism**~~ — **built** (see
   "Arriving is part of the locomotion model" above and "Rebounds are
   collisions" below). Was: continuous motion with no frozen beats, and
   parries/post rebounds as real physical events.
5. ~~**Stamina from real motion**~~ — **built** (see "Effort follows motion,
   not labels" above). Was: drain computed from actual speed, acceleration,
   distance and elapsed time rather than from event labels and job names.
   The condition-into-locomotion feedback path is deliberately still closed.
6. **Match-session state machine** — play continuing through throw-ins,
   corners, goal kicks, free kicks, goals and kickoffs until the user
   stops it, instead of one possession at a time.
7. **Renderer-neutral playback** — a Three.js renderer consuming the same
   authoritative timeline the 2D renderer does, with no engine changes.

### A dive is a committed action, not locomotion

`reachIn()` models a runner building speed from a standstill. Over the two or
three tenths of a second a goalkeeper actually has, that is almost no ground
at all — measured, an elite keeper covered 0.15 yd in the first 250 ms — so a
save envelope built from running plus a *static* arm allowance left keepers
physically unable to reach shots they should comfortably save. An isolated
one-on-one converted 87.3%, with 1758 of 1758 shots to the keeper's open side
scoring because the keeper never arrived and the save-flavour roll was never
even consulted.

The answer is not a faster travel constant. A constant speed removes
Acceleration from goalkeeping entirely, which is why the earlier
`KEEPER_LOCOMOTION_FACTOR` was removed and why `test-stage4-review.mjs`
asserts that two keepers differing only in Acceleration reach different
points. The answer is that a dive is a **different action**: one explosive
push off one leg, launching the body sideways at close to full speed
immediately.

`playerKinetics.js` owns it — `diveLaunchSpeedYps()` from Agility and Jumping
together (the same two attributes that already decide changing direction on
momentum and getting off the floor), and `diveReachYards(player, seconds)`
capped at `DIVE_COMMIT_SECONDS`. The cap is the point: a player cannot dive
continuously, and this must never be used as a second locomotion model.
`diveReachYards()` over its whole window is deliberately smaller than
`reachIn()` over a real running window, and there is a test asserting it.

`simulateShotKeeperEnvelope()` makes the keeper *choose*, because a dive costs
the time it takes rather than being free ground on top of a full run:

```
travel = max( run(available),
              run(available − dive) + diveGround(dive) )
```

Diving wins when there is too little time to build running speed — the case
this exists for. Staying on their feet wins over a long window, where topSpeed
beats a dive, which is what keeps Acceleration decisive there.

Calibrated against the recorded Ronaldo-vs-Stensgaard fixture, which brackets
an elite striker clean through on a mid keeper at 51–75%: **87.3% → 65.2%**,
mid-band rather than on either edge. Full-stretch reach is now 3.9 yd for an
elite keeper and 2.8 for a poor one, against a flat 2.1 and 1.7 before.

## Effort follows motion, not labels

Stamina used to be priced from what a move was **called**.
`burstJobIntensity(action)` mapped a job name to a number and the cost was
`(yards / 40) × intensity × workRateFactor`. Speed appeared nowhere in that
formula. Three consequences, all wrong:

- The same eight yards cost 0.85 under `run-in-behind` and cost **nothing** under
  `hold-width`, because `hold-width` sat on a hand-maintained refill list. A
  defender who genuinely sprinted eight yards to hold a line *recovered*
  stamina for doing it.
- A job nobody had listed silently priced at 0.5 — neither a real reading nor
  a visible gap.
- Walking and sprinting the same distance were identical.

`src/lib/motionEffort.js` derives the same quantity from the motion that
actually happened. Nothing new has to be measured: `advanceMotion()` already
returns distance covered, the window it was covered in, and the speeds entered
and left at. `topSpeed()` stays the only speed reference, so no second physics
model appears.

- `motionSpeedLoad()` — the fraction of **this player's own** top speed the
  move held. Deliberately per-player: six yards in a second is a comfortable
  stride for a quick player and flat out for a slow one, and it should cost
  them differently.
- `motionEffortLoad()` — that load made convex (`EFFORT_SPEED_EXPONENT`,
  because a jog is cheap and the last fraction toward top speed is
  disproportionately expensive), plus a surcharge for *changing* speed. The
  surcharge reads magnitude, not sign: braking is eccentric loading, not rest.
- `isRecoveryMotion()` — below `RECOVERY_LOAD_CEILING` of top speed the player
  is moving but not working. This is what replaces the refill-job list:
  recovery now follows from going slowly, which is the actual reason a player
  recovers.
- `motionEffortCost()` — the burst cost. `EFFORT_REFERENCE_YARDS` is
  deliberately kept at the label model's own 40, so this stage changes where
  intensity *comes from* without simultaneously re-pricing every action.

The job name survives in `applyBurstOffBallJob()` only as a fallback for a
caller with no window to measure against (a hand-built fixture with
`durationMs` 0). Every real call site now passes the motion.

Measured on the recorded `repeated-carry-burst-drain` scenario — the fixture
captured for the reported "full speed denied a few touches in" bug: the
attacker used to be refused full sprint after about four carries at 6% burst.
It now sustains **26 carry actions with zero full-sprint denials**, because a
carry is priced from the speed it was actually run at rather than from the
word "full-sprint".

### Distance covered, and why stamina looked random

Two reported symptoms, one measurement each.

**"Drains too quickly."** Stage 5 kept the label model's `EFFORT_REFERENCE_YARDS
= 40` so that pass could change where intensity came from without also
re-pricing every action. Measured over one 68-second possession, a midfielder
covered **179 yards** — entirely normal running, about 9.5 km over a full
match — which at 40 yards to the tank is four and a half tanks for a minute of
football. Re-priced to **250**, calibrated against what a burst tank actually
models: roughly seven hard 40-yard sprints before empty, refilling in about 40
seconds of rest.

**"Drains randomly."** Recovery was an all-or-nothing branch on
`RECOVERY_LOAD_CEILING`. An ordinary jog sits at load 0.29 and the ceiling is
0.28, so each of the ~50 authored moves in a possession independently landed
either side of that threshold, and the same player drained or recovered
depending on nothing but how their running happened to be chopped into events.

`netBurstChange()` replaces the branch with one continuous signed rate, and it
has two properties the branch did not:

- **Continuous.** Recovery fades linearly to nothing as load approaches the
  ceiling rather than switching off at it. Both terms always apply — a player
  recovers a little while working and pays a little while strolling — and the
  balance decides the sign.
- **Partition-invariant.** Splitting an interval and applying it twice equals
  applying it once, because both terms are rates. The old model's outcome
  depended on how the timeline was cut, which is not a football fact.

`distanceCoveredYards` and `activeMs` are now accumulated per player as real
match state, not derived from a count of how many events happened to name
them. Measured after: players cover **6.4–11.7 km per 90-minute equivalent**
against a real-world 9–12, and burst moves by −0.07 to +0.12 over a 70-second
possession instead of emptying.

Condition still does **not** feed back into locomotion. That is a separate,
deliberate step and must be opened through one sanctioned path;
`test-stage4.mjs` and `test-stage5.mjs` both assert that an ad hoc
`burst01`/`match01` field cannot silently change kinetics until it is.

## Corners are a manager instruction

The corner layout used to be a fixed list of seven named roles per side, and
`placeRestartParticipants()` left everyone it did not name on their open-play
formation anchor. Measured on a real 22, that produced **three attackers and
five defenders in the penalty area**, with the defending team's striker
standing 103 yards away on the opposite goal line while a corner was swung
into his own box.

`src/lib/cornerSetup.js` replaces it. A role is a **kind with a count**, not a
slot:

- Near-post, central and far-post runners, keeper occupiers, rest defence and
  the marking roles are all unbounded — the manager sets how many.
- `short-option` is capped at two, the one genuine rule.
- Near-post and far-post cover may be set to zero deliberately.
- Extra players at the same role never stack. A "deep" role (the runners)
  starts each additional man further out, because a second near-post runner
  attacks from behind the first rather than standing beside him; a "wide" role
  straddles its anchor.
- **Anyone unassigned crowds the penalty area.** Nobody keeps a formation
  anchor. That single default is what fixes the three-in-the-box problem.

Coordinates are authored the way a manager describes them — yards out from the
goal line, yards left or right of the goal's centre, signed toward the corner
the kick is taken from — and converted once. The old table was written as
offsets from the corner flag, which is how a "near-post runner 8 yards from
the flag" ended up 33 yards from the near post.

### Delivery

`Left Foot` and `Right Foot` are real 1–20 attributes here, so the swing
follows from the foot and the corner rather than from a setting:

| | right corner | left corner |
| --- | --- | --- |
| left-footed | inswinger | outswinger |
| right-footed | outswinger | inswinger |
| two equal feet | straight | straight |

Two good feet gives a straight ball rather than a guessed curl. The taker aims
at one of near post, far post, penalty area, six-yard box, edge of area or
short.

### Defending, and what "mark their tall players" has to mean

The defence is resolved **against the attack that was actually set up**,
because markers have to know who they are marking. Aerial markers take the
biggest aerial threats, runner markers the most dangerous movers, and every
defender the manager did not assign picks up whoever is still unmarked before
falling back to crowding. Each marker stands goal-side of his man at a
distance set by `tightness` (1 → 2.6 yd, 5 → 0.9 yd). A short option in the
attacking setup pulls a defender out to it **whether or not one was asked
for**.

There is no height in this dataset — `Height` resolves as a baseline inference
from current ability, never as stated data — so keying "tall player" off it
would be inventing a fact. `aerialThreat()` uses Heading, Jumping and
Strength, which are real and are what actually makes a player dangerous in the
air. `runnerThreat()` uses Off The Ball, Anticipation and Acceleration.

The resolver returns `unmarkedCount`, so the tradeoff is a number rather than a
surprise: committing three players to the counter leaves three attackers
unmarked, and the interface can say so.

### Team default, overridable per corner

Two layers, because that is how a manager works:

- **The team's standing plan** lives on `createTeamSetup()` as `cornerPlan`,
  beside formation and marking. It is the tactic, and it is what the side
  plays until it is changed.
- **A per-corner override** rides on `createRestartSetup()` as
  `cornerOverride`, and is dropped for any restart that is not a corner.

`resolveCornerPlan()` merges them, and the override is deliberately
**partial**. `counts` and `assignments` merge key by key, so an extra man on
the far post for this one corner does not disturb the other ten; scalars
(delivery, taker, marking, tightness) replace outright, because there is no
partial version of "aim it at the far post". Neither input is mutated — the
team plan outlives the corner.

Both plans are recorded in the replay scenario's `tacticalSettings`, so a
possession that ends in a corner replays identically. A scenario captured
before the field existed replays exactly as it always did.

The goalkeeper is the one exception: his corner position is goalkeeping, not a
role the manager assigns, so he keeps the existing goal-anchored spot from the
restart layout, which already shades him slightly toward the corner the ball is
coming from.

## Rebounds are collisions

A parry, a post rebound and a crossbar rebound used to be the same authored
mechanic: an endpoint offset by a flat `REBOUND_INSET`, reached at a flat
12 yd/s however the shot was struck. There was no angle of incidence, no
reflection off the frame, and no crossbar in the vocabulary at all.

`src/lib/ballReboundPhysics.js` owns the collision half, and hands the ball
straight back to systems that already exist:

- `goalFrameContact()` classifies the surface (**post** or **crossbar** —
  the bar is now in the vocabulary) and returns its outward normal, derived
  from where on the frame's radius the ball actually struck.
- `reflectBallVelocity(v, normal, restitution)` is a genuine reflection,
  `v − (1 + e)(v·n)n`, so the rebound direction follows from the incoming
  velocity and the surface, and the rebound *speed* follows from the impact
  speed. Measured over 4000 shots, outgoing speed now correlates with
  incoming speed at r = 0.686, against a flat constant before.
- `parryBallVelocity()` decides **wide** versus **dangerous** from the save
  rather than from a table — see below.
- `projectRebound()` integrates gravity, diminishing turf bounces, and then
  hands the ball to `ballRollPhysics.js`, the same roll every other loose
  ball in the engine already performs. It does not implement its own
  friction.
- The resulting loose ball is handed to **Dynamic Ball Claim v2**, so a
  rebound is contested by whoever can genuinely get to it, with no
  preselected rebound shooter.

### A parry follows from the save

`parryBallVelocity()` originally branched on `handling >= 12 && |lateral| < 3`.
That is a step on an attribute — a Handling-11 keeper never steered a parry
and a Handling-12 keeper always did — and measured across 4000 shots at an
ordinary Handling-12 keeper it produced 792 `parry-wide` and **zero**
`parry-dangerous`: the dangerous branch existed in the vocabulary and never
once happened.

The direction now follows from what the save actually was. The keeper's
Handling is discounted by two loads — how hard the ball was struck
(`PARRY_PACE_LOAD_YPS`) and how far they had to reach to meet it
(`PARRY_REACH_LOAD_YARDS`) — and a directed save is one where enough control
survives both:

```
control = (Handling / 20) · (1 − 0.55·paceLoad) · (1 − 0.6·reachLoad)
```

A comfortable save by a good handler still goes wide; the same keeper at
full stretch, or against a ferociously struck ball, palms it back into play.
The same 4000 shots now produce 432 wide and 360 dangerous.

**No `K.SAVE.*` selection weight changed.** Which save code is chosen happens
upstream and is untouched; only the physical consequence of the chosen save
differs.

## Known limitations of World Motion Contract v1

- **There is no global simulation clock.** A possession is a sequence of
  authored windows, not a fixed-tick loop. "The authoritative position at
  the appropriate simulation time" therefore means *at the end of the
  window that authored it*. A run that genuinely overlaps into the next
  action is drawn correctly, but the next action's decisions read the
  runner at that run's endpoint. Closing this properly needs the
  match-session state machine and a real tick, which is roadmap item 5.
- **Arbitration papers over that gap; it does not close it.** When a run
  is superseded, the engine had already committed the player to that run's
  full endpoint and planned the next movement *from* it, while playback
  correctly shows them starting from where they had actually got to. End
  states agree — every clip still finishes on the endpoint the engine
  committed — but the intermediate committed point is one the player never
  visibly reached. The honest fix is the same one: a real tick, so the
  engine only ever commits positions the clock has passed.
- **Not every authored move is inside its physical limit yet.** The
  turnover recovery is fixed and covered by tests; a duel challenge beat
  and some fixed-duration off-ball adjustments can still exceed
  `reachIn()`. They are now *visible* — `withinPhysicalLimit` on every move
  diagnostic, flagged in the Movement timing panel — rather than silently
  smoothed over. Fixing them means giving those beats honest durations,
  which changes timing broadly and belongs in its own pass.
- **Carry pacing is a chase model, not a dribbling model.** A carrier
  paces a touch they will comfortably reach, and honestly falls short of a
  first touch played too far ahead from a standing start. Real dribbling
  (touch size chosen from the space available and the defender's distance)
  is a separate piece of work.

## Related documents

- `MATCH_ENGINE_ROADMAP.md` — staged plan and the full prompt for each
  remaining stage. The planning source of truth.
- `MATCH_LAB_PLAN.md` — implementation history, in order, with the reported
  bug behind each change.
- `MATCH_ENGINE_SCENARIOS.md` — the scenario/resolver tree.
- `GAMEPLAY_ROADMAP.md` — gameplay-facing feature roadmap.
- `src/lib/replayHarness.js` — saved-scenario replay contract (what counts
  as authoritative replay input).


## Reviewed motion/contact contract (2026-09-07)

`worldMotion.advanceKeeperSaveMotion()` authors the same body travel used by
`keeperSaveTravel()` in the shot contact race. Ordinary travel uses the
player's Pace/Acceleration curve. A committed dive replaces the last at
most 0.52 seconds of running with `diveReachYards()` from playerKinetics;
it is not added to a full-window run. Its attribute-derived launch is an
explicit action impulse, not a general constant-speed adjustment rule.
The trajectory includes reaction and run/dive boundaries. Shot events
carry `motionModel` through the adapter and into playback diagnostics,
whose reach and ETA audits use that action's bound. A caught ball returns
from the hand contact to the reached body point; the next event cannot
move the keeper a second time to make the save true.

Body overlap separation is a tactical target proposal. Neither playback
sampling nor replay checkpoints relocate players to conceal overlaps.
Pass-contact scans also leave idle bodies untouched and allow genuine
post-release blocks; they exclude the departing kicker. Contact and
collision checks must inspect the authoritative positions.

`STAGE4_REPORT.md` contains the current matched-fixture measurements and
qualifies older claims above. Zero endpoint reach violations in that sweep
is not a proof of bounded instantaneous acceleration on every legacy path.
The global-clock/arbitration limitations remain. The braking profile is
used only when it fits; positional pacing and sharp turns still need a
complete bounded steering/braking treatment. Dive landing/recovery and
incoming keeper momentum also need richer action state.

Stage 5's claim of partition invariance applies to constant-load intervals
with equivalent speed-change inputs. Averaging a changing speed profile,
and applying the endpoint speed-change surcharge per segment, does not
prove invariance under arbitrary time slicing. This remains a specific
follow-up for measured motion effort, not a second locomotion model.


## Carry speed follows the running stride (2026-09-07)

A touch is struck relative to the runner's current momentum. Gait/control
choose intended spacing; playerKinetics arrival timing and shared ball-roll
friction determine the impulse. Execution error applies to the added impulse.
The first positive-time signed ball-minus-body distance crossing determines
contact. Do not pace the player across a ball's unnecessarily long stop time.
The physical trajectory's exit velocity is committed into the carrier's next
motion record; a carry boundary is not a standstill. See DRIBBLE_PACE_REPORT.md
for measured Anderson/Sensini reproduction, tests and remaining replay failure.

## Keeper rush and exposed-goal cover (2026-09-07)

`keeperDecision.js` proposes sweep, close-down, set and recovery intentions
from bounded perception and own attributes. A defender's visible goal-cover
opportunity may override formation shape. These targets do not relocate
anyone. Committed pass-race jobs use worldMotion; their actual trajectories
and reached bodies also supply playback and contact. A missed rush leaves
the goal exposed. Clearance/spill impulses continue through the loose-ball
race, with no recipient booked in advance. Striker urgency reads actual
keeper velocity; unchanged save-flavor weights apply after physical reach.

Continuing keeper possession at the feet must remain controlled-ground.
Keeper role alone cannot restore held possession after a carry. Explicit
catch/release signals remain authoritative. See KEEPER_RUSH_REPORT.md for
validation and the remaining perception/legacy one-on-one limits.

While ball state is `held`, opponents receive a `respect-held-ball` intent.
Their coordinated targets and straight movement paths stay outside the
9.15m exclusion after any necessary physical retreat. This is a temporary
constraint on tactical targets, not an ownership or collision shortcut.
The next controlled-ground state removes it, allowing normal pressure.

## Header/save contact timing (2026-09-07)

An on-target header owns a distance-based ball-flight interval from the
authoritative aerial contact point. During that same interval the goalkeeper
uses `simulateShotKeeperEnvelope()` and `advanceKeeperSaveMotion()` to react,
run or dive toward the fixed ball path. A save flavor selected by the existing
header resolver is legal only when that physical envelope reaches the ball.
An unreachable goalkeeper is beaten; the result cannot award a catch, parry
or tip to a body that remains elsewhere.

The `F.HEADER` event ends at the first reachable ball/body envelope when a
real contact occurs. Its goalkeeper move ends at the recorded `bodyPoint`, and
the following `K.SAVE.*` event begins at that same ball point. A held result
uses only the short hand-to-body settling motion; it never starts a second
goalkeeper journey after the ball has already reached the frame. The aerial
contact point also replaces the receiver's stale pre-cross roster coordinate
for shot, save and rebound geometry.

## Coupled coordination slice (2026-09-11)

`src/lib/coordinationCoordinator.js` is the renderer-neutral responsibility
layer between action candidates and Team Shape. It ranks five attacking
families (`REGAIN_QUICK_RELEASE`, `WIDE_TRANSITION`, and
`SHORT_COMBINATION`, `RECYCLE_AND_SWITCH`, and
`PENALTY_AREA_OCCUPATION`) and pairs them with one of six defensive responses.
Its output is a set of temporary responsibilities and intention targets. It
does not move players or resolve a pass, shot, cross, duel, or pattern ending.

`runConstructedPossession()` asks the coordinator to re-evaluate at each
on-ball choice and at intervals of at most 500 ms during live travel.
`coordinateTargetProposals()` merges those intentions into the existing Team
Shape pass. `worldMotion.advanceMotion()` remains the only layer that commits
reachable positions and velocities. Action candidate order and resolver
probabilities are unchanged; selected responsibilities add utility only to
legal candidates that already exist.

The coupled coordinator activates when both sides carry authored formation
relationships. Sparse legacy resolver probes keep their established local
planners, which preserves saved-fixture compatibility instead of inventing a
formation from a few loose coordinates.

The defensive contract reserves one primary pressure owner, inside cover,
depth protection, runner tracking, recovery screen, far-side balance, a line
controller, and goalkeeper cover. Pressure ETA includes current speed, facing,
approach angle, physical reach, perception attributes, danger and cover cost.
Pressure and tracker ownership use a 650 ms commitment plus a minimum ETA
advantage before transfer. Existing tracker owners are reserved across a
replan so two simultaneous threats cannot exchange markers merely because the
allocator visited them in a different order.

Loose-ball claim ownership is re-ranked along the authoritative decelerating
roll. Transfer boundaries become motion replan boundaries; the current
claimant chases the sampled ball point, while previous claimants recover shape
or support the new owner. Every transfer, ETA advantage, abort, completion,
fallback, reservation, tactical contribution, material attribute input and
world position/velocity snapshot is stored in coordination diagnostics and
saved-run history.

A won shielding duel now retains pressure and uses a short momentum/space
target through `worldMotion`. The old fixed five-yard perpendicular escape and
`beatenDefenderId` handoff were removed from this outcome. The duel probability
is unchanged.

Large live retargets no longer reverse the current velocity vector in one
rendered beat. `worldMotion` spends real time decelerating at the existing
attribute-derived braking rate, adds a short planted-turn footwork arc, and
then accelerates toward the new intention. A body that must still converge on
a ball after a touch receives a sequential world-motion interval long enough
to reach it; the possession loop does not commit the tactical endpoint ahead
of the physical trajectory.

The second slice adds ball-side congestion recognition and reserves a rear
recycle outlet, circulation connector, and weak-side switch receiver. Final-
third entry reserves distinct near-post, central, far-post, cutback and edge-
of-box lanes. Prospective runners stay behind the effective ball/second-last-
opponent line until the next contact; the pass resolver still takes the
authoritative law snapshot at the kick.

The defending side now records a shared line depth. Controlled pressure and
an enabled offside trap permit a coordinated step; time for the passer causes
a safety drop. The line remains at least two yards ahead of the goalkeeper,
and available back-line members align to the controller rather than drifting
independently. `PROTECT_PENALTY_AREA` adds the sixth defensive response.

`keeperDecision.keeperAngleManagementPlan()` constructs the two post-to-ball
rays, sets the keeper on their angle bisector, and records the cone width,
estimated body coverage, cover and lob exposure. A genuine close-down uses
that destination through worldMotion. Cover can temper the advance. The plan
does not modify shot or save probability.

Current limits: the registry contains the first five attacking families;
pattern completion is inferred from later live events rather than a richer
multi-touch phase model; ordinary turns and pressure approaches still use
point targets rather than full steering/orientation envelopes; and the 2D Match Lab remains the only
diagnostic renderer.

## Restart preparation and continuous ground momentum (2026-09-11)

`restartPreparation.js` adds a seeded presentation plan in front of the
existing restart resolver. It cannot choose the football outcome. A normal
corner, free kick or goal kick records ball placement, a 2.2-3.45 yard retreat,
a scan with an optional one/two-arm signal, and a run-up. The retreat and
approach are committed by `worldMotion`; the following
`RESTART.*.TAKE` remains the first touch that makes the ball live. Eligible
short free kicks, short corners and throw-ins can choose a separately recorded
quick restart, biased by tempo, Decisions and Anticipation through a dedicated
seed that does not consume resolver RNG.

A throw-in holds the ball through an explicit scan interval before the hand
release. `Long Throws` and Strength determine reach; a high Long Throws
specialist in a direct/long-ball side may select a farther legal teammate.
The `long-throw` flight has a higher hand arc but remains slower than every
ground kick. Throw-in contact and last-touch metadata continue to identify the
hand, and the offside restart exemption is unchanged.

During the scan and approach, `planRestartSupportMovement()` proposes a small
set of simultaneous runner checks and one-to-one defensive tracking responses.
These moves use the same `worldMotion.advanceMotion()` path as open play and
overlap the taker's preparation interval. Walls and goal-kick opponents hold;
opponent-distance constraints remain enforced; free-kick runners check
laterally until contact so preparation cannot create an unobserved offside run.
For corners, the resolved manager delivery target selects one primary lane;
other box players make decoy runs, a short option shows only when the short
routine is selected, and the defensive marking subjects resolved during setup
remain attached to their markers. Anticipation, Off the Ball and Work Rate set
attacking reaction delay; Anticipation, Positioning and Marking do the same for
defenders. Pace, acceleration and momentum still determine the distance each
body can actually cover. The delivery target also biases the real cross/pass
resolver toward the matching restart role, while that resolver retains every
execution, interception, contest and outcome decision.

`ballRollPhysics.buildRollingBallTrajectory()` now derives every sampled
position and velocity from the same constant-friction equation used by loose
ball claims. An ownerless ball intercepted before its natural stop retains
non-zero incoming velocity at the contact. Velocity reaches zero only when
turf friction reaches the calculated stopping time, or when a later player,
boundary or dead-ball event supplies a real opposing interaction.

Failed-control bounce races now start from each candidate's latest authored
position and incoming velocity. Candidate selection and the recovery trace
share the exact same kinetic result, preventing a stale kick-time race from
awarding a contact the live body cannot reach.
