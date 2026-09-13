# Match Engine Observation and Realism Backlog

**Recorded:** 2026-09-10  
**Target project:** `G:\Workspace\React\cm-db`  
**Intended eventual repository location:** project root, alongside `MATCH_ENGINE_ROADMAP.md`

## Purpose

This note preserves the findings and proposed work arising from Match Lab
playback observations. It is a review backlog, not yet an architectural source
of truth. Accepted work should later be incorporated into
`MATCH_ENGINE_ROADMAP.md`, `MATCH_ENGINE_ARCHITECTURE.md`, and the relevant
acceptance suites.

Match Lab is the simulation sandbox. Behaviours validated here must be
renderer-neutral and suitable for promotion into the eventual game. The Match
Lab must not grow a second, divergent football engine.

## Guiding principles

1. Real match footage is evidence, not a scripted sequence to copy wholesale.
2. Decompose footage into small, reusable actions and coordinated patterns.
3. Manager tactics, formations, roles, duties, and player instructions must
   materially influence which patterns are recognised and attempted.
4. Player attributes and perception determine whether an instruction is
   understood and executed successfully.
5. Current geometry, physical reachability, momentum, pressure, and the laws of
   the game remain authoritative.
6. `worldMotion` remains the only system allowed to convert intentions into
   player movement.
7. Ball movement and contact must come from engine physics, never renderer
   invention.
8. Replays must remain deterministic.
9. Fluidity is a gameplay-data requirement as well as an animation requirement;
   smoothing a frozen or contradictory plan is not an adequate fix.

The desired decision chain is:

> Manager tactics and board shape -> player role and duty -> player awareness
> and attributes -> situational pattern recognition -> action selection ->
> physical execution -> outcome and re-evaluation

## Finding 1: V1-V10 are not ten complete play sets

The current Action Pattern Registry contains six small attacking fragments:

| Runtime fragment | Recorded source |
| --- | --- |
| `vacate-pocket` | V1 |
| `arc-overlap` | V4 |
| `peel-square` | V5 |
| `show-wide` | V7 |
| `check-decel` | V5 |
| `run-off-pass` | V4/V9/V10 |

V2, V3, V6, and V8 do not currently have distinct registered behaviours. V9
and V10 are references attached to the shared `run-off-pass` fragment rather
than separate play systems.

Stage 1 intentionally migrated the old hard-coded special-mover chain with
behavioural parity. Its tests prove that the registry chooses the same player
and target as the old chain. Consequently, Stage 1 improved the architecture
but was deliberately not expected to make play visibly different.

Additional limitations:

- Five fragments share a `special-run` capacity of one per planning call.
- Most fragments influence one player's repositioning rather than a coordinated
  multi-player action.
- `run-off-pass` is still planned separately from the registry in production.
- Pattern targets can contribute a joint pass-and-run meeting point, but this
  coupling is narrow.
- Current tests prove schema validity, determinism, composition, and parity.
  They do not prove that patterns activate frequently or materially change
  full-possession decisions.
- The shipped patterns have little explicit dependence on team style,
  mentality, tactical roles, duties, or individual instructions.

This explains why the player may not perceive V1-V10 as affecting the game.

## Finding 2: Why passages can feel monotonous and rigid

The engine repeatedly allocates a limited set of local jobs such as support,
hold width, pin the line, press, track, screen, and return to shape. These can
be individually reasonable while still failing to express collective intent.

A complete overlap, for example, is not only a full-back target. It includes:

- the winger holding width or moving inside;
- the full-back recognising and timing the overlap;
- the carrier seeing and evaluating the new passing lane;
- a midfielder covering the vacated position;
- defenders deciding whether and when to pass the runner on;
- every participant continuing, checking, or aborting as the picture changes.

Current fragments lack enough multi-player coordination, persistent phases,
commitment, branching, and re-evaluation to express this consistently. Genuine
`check away -> decelerate -> burst` movement also needs temporal and kinematic
phases rather than only an onset delay and destination.

## Finding 3: Tactical features are connected, but their influence is uneven

The current implementation and its tests show that the following inputs reach
real engine behaviour:

| Input | Current effect |
| --- | --- |
| Formation and base board placement | Establish roster positions and persistent formation anchors |
| With-ball/without-ball board positions | Feed phase and ball-zone-specific team-shape targets |
| Tactical role | Changes formation-relative geometry and suitability for selected team jobs |
| Defend/support/attack duty | Changes depth and some team-job suitability |
| Attacking style/directness | Changes passing and progression preferences and some restart choices |
| Mentality, focus, dribbling, creativity, final-third, time-wasting, pass-into-space, play-out-of-defence | Add bounded biases to legal action candidates |
| Team width | Changes coordinated team-shape width |
| Team shooting and tempo | Affect shooting/holding/release utility; individual overrides are supported |
| Marking scheme/tightness | Affect defensive assignment and standoff geometry |
| Pressing, defensive line, engagement line, pressing trap, cross engagement, prevent-short-GK | Alter defensive team-shape targets |
| Tackling | Changes the selected feasible tackle family |
| On-gain/on-loss transition instructions | Change attacking-transition and defensive-transition shape |
| Goalkeeper distribution | Changes short release versus long distribution preferences |
| Goalkeeper sweeping | Changes sweep and close-down willingness while retaining physical arrival checks |
| Paused match tactical changes | Apply at a stoppage to both the live roster and continuation state before resumption |

Current setup, team-shape, spatial-decision, and action-pattern suites pass.
This proves the plumbing and selected directional effects, but not that the
effects are large enough to be visible over many possessions.

### Tactical limitations to investigate

- Tactical roles and duties primarily affect positioning and team-job
  suitability. They do not yet create a sufficiently distinct on-ball decision
  personality.
- Many instructions are small additive utility biases. Base utility, geometry,
  pressure, attributes, and seeded choice variation may overwhelm them.
- Some defensive instructions currently express only a shape offset, not the
  full coordinated behaviour their names imply. An offside trap, pressing trap,
  or stop-crosses instruction should eventually have triggers, participants,
  timing, communication, success/failure, and recovery.
- The pattern registry is not yet strongly conditioned by compatible tactical
  roles, duties, formation relationships, team instructions, or manual board
  anchors.
- Isolated unit tests do not establish visible, match-level tactical separation.

## Proposal 1: Tactical and Pattern Influence Audit

Before broad pattern expansion, add a deterministic audit that compares the
same saved scenario and seed with one controlled change at a time.

### Required comparisons

- Patterns enabled versus disabled.
- One tactical role versus another in the same positional slot.
- Defend versus support versus attack duty.
- Neutral instructions versus each meaningful team instruction.
- Formation A versus formation B with identical players.
- Automatic role positions versus manual with-ball/without-ball positions.
- Before and after a mid-match tactical change at a stoppage.

### Per-pattern telemetry

- Eligible count.
- Triggered count.
- Rejected count and closed rejection reason.
- Selected player or players.
- Proposed targets and temporal phases.
- Whether the pattern changed a pass/carry/cross/shot candidate.
- Whether the pattern changed the final selected action relative to a
  pattern-disabled counterfactual.
- Whether the intended movement began, completed, changed claimant, was
  aborted, or was superseded.
- Time active, distance travelled, target error, and reason for termination.
- Team phase, pitch region, formation, role, duty, and relevant instructions.

### Per-decision instruction telemetry

Show candidate utility before and after every instruction contribution, for
example:

```text
Through ball base utility: 0.62
Pass into space: +0.30
Attacking mentality: +0.08
Tactical role contribution: 0.00
Final utility: 1.00
```

The audit must expose zero or missing contributions rather than suggesting that
a stored control is influential merely because it exists in the UI.

### Aggregate metrics

- Selected action distribution.
- Pattern incidence per possession and per phase.
- Unique player-job sequence count.
- Repeated job and repeated action rates.
- Target-direction and movement-direction diversity.
- Team width, length, line heights, gaps, occupied lanes, and occupied regions.
- Progression speed and field-position gain.
- Passing support and runner availability.
- Pass-run coordination rate.
- Defensive compactness and pressure response.
- Authored stillness, freeze windows, collisions, and target discontinuities.

Run sufficiently large same-seed samples, initially 500-1,000 possessions per
comparison. Establish explicit minimum effect sizes for settings that should be
strongly distinguishable.

## Proposal 2: Footage-derived behaviour workflow

Multiple real-life clips can be analysed and converted into reusable engine
behaviour. This is not permanent model training. The durable outputs are
annotations, pattern declarations, decision rules, fixtures, and tests.

### Footage intake

Original video is preferable to screenshots. Useful supporting context:

- which team is being studied;
- attacking direction;
- approximate timestamp of the relevant action;
- expected role or tactical intention, if known;
- whether the example demonstrates correct behaviour or a contrast/failure.

If a decision or animation remains ambiguous, request a narrowly defined clip
from the user. Examples include:

- an overlap against a settled block;
- a striker checking away before running behind;
- third-man movement and the defensive response;
- team shape immediately after possession loss;
- counterpress versus regroup;
- a receiver reacting to an inaccurate or slowing pass;
- a goalkeeper's starting position and decision during a one-on-one;
- tackle, deflection, post, parry, and rebound momentum;
- restart positioning and the first actions after the restart.

### Annotation model

Record observations using abstract football relationships:

- possession and team phase;
- ball state, trajectory, speed, and contact events;
- participant roles rather than player names;
- relative starting geometry and tactical regions;
- trigger and preconditions;
- movement direction, gait, curvature, and timing;
- player perception and body orientation;
- defender reaction and handoff;
- intended choice and available alternatives;
- abort, continuation, and re-evaluation conditions;
- resulting space and team-shape consequences.

Do not store a broadcast clip as one indivisible sequence. Do not encode named
players or fixed absolute coordinates. Patterns must support mirroring, scaling,
different formations, and different player qualities.

### Candidate reusable behaviours

- Third-man combinations.
- Wall passes and give-and-go movement.
- Overlaps and underlaps.
- Check-away and burst runs.
- False-nine drops and rotations.
- Winger isolation and far-side occupation.
- Centre-back splitting and goalkeeper build-up support.
- Switches of play.
- Near-post, penalty-spot, far-post, and edge-of-box occupation.
- Defensive line shifting and runner handoff.
- Cover shadows and pressing traps.
- Counterpressing and regrouping.
- Rest defence and second-ball structure.
- Transition recovery and emergency cover.

### Pattern execution model

A coordinated pattern should be able to propose several compatible intentions
as one football idea while preserving individual responsibility:

1. Recognise a tactical picture.
2. Bind eligible participants by role, position, perception, and reachability.
3. Propose timed, multi-stage intentions.
4. Modify relevant action candidates for the ball carrier.
5. Produce corresponding defensive recognition and response candidates.
6. Execute every movement through attribute-aware motion.
7. Re-evaluate on ball-region, possession, pressure, participant, or trajectory
   changes.
8. Continue, branch, abort, or hand off with a recorded reason.

Manager instructions should influence eligibility and priority without forcing
physically or legally impossible outcomes. Player Vision, Anticipation,
Decisions, Teamwork, Off the Ball, Work Rate, Bravery, role familiarity, and
other appropriate attributes should influence recognition and execution.

## Finding 4: Misplaced-pass and loose-ball claimant lock

### Observed symptom

A player is selected when a pass becomes inaccurate or loose and pursues it for
the entire interval. Another player can later appear better placed or closer to
the ball yet ignore it or move away.

### Structural cause in the current implementation

`evaluateBallClaim()` projects the complete future ball roll once and evaluates
every candidate from their positions at the instant the ball becomes loose.
It then sorts contenders and fixes the first physically predicted interception
as the winner.

The module can calculate changes in the apparent race leader at later samples,
but its own code marks `leaders` and `leadChanges` as pure instrumentation:
no outcome depends on them. Match Lab then authors one `LOOSE.RECOVERED` event
for the fixed winner and assigns ordinary team-shape movement to everyone else
for the same interval.

The current ball-claim suite passes because it proves an up-front projected
race across the entire roll. It does not prove live claimant re-evaluation from
the players' subsequently authored positions, velocities, headings, and
intentions.

### Correct principle

Do not replace this with a nearest-player check. The claimant should be the
player with the best physically reachable interception from the current
authoritative state.

Re-evaluation should consider:

- current ball position, height, velocity, spin when available, and projected
  trajectory;
- current player positions and velocities;
- Pace, Acceleration, and Agility;
- turning angle, body orientation, and current momentum;
- Anticipation, Decisions, Work Rate, and appropriate bravery/commitment;
- transition instruction, role, and duty as secondary willingness factors;
- obstacles, opponents, goalkeeper permissions, pitch boundaries, and laws.

The obvious nearby player must not ignore a clearly winnable ball merely because
another teammate was nominated earlier. Conversely, a temporarily closer but
slow or badly oriented player must not steal a claim they cannot actually win.

### Claimant handoff

Re-run the arrival race at bounded simulation checkpoints using authoritative
sampled player state. Transfer responsibility when:

- the incumbent can no longer reach the ball;
- another player gains a meaningful interception-time advantage;
- a deflection or contact changes the ball trajectory;
- current momentum makes another player the genuine winner;
- an intended receiver overruns or cannot control a misplaced delivery.

Use deterministic hysteresis to prevent claimant flicker. A challenger should
hold a meaningful ETA advantage for a small, defined period, or the incumbent
must become unreachable, before the handoff occurs.

When responsibility changes:

- the new claimant receives a real reaction delay and physically turns/runs;
- the old claimant decelerates and returns to an appropriate support or shape
  job;
- neither player teleports or instantaneously reverses velocity;
- ball ownership remains unset until actual contact;
- the handoff reason and ETA advantage are recorded in telemetry.

This must cover the full lifecycle: inaccurate pass flight, deflection,
subsequent ground roll, player contact, pitch exit, and restart.

### Required claimant-handoff acceptance cases

1. The initial favourite is overtaken after current player momentum is sampled.
2. A closer but slower or badly oriented player does not incorrectly steal the
   claim.
3. A small alternating ETA advantage does not cause claimant thrashing.
4. A decisive advantage transfers the claim exactly once.
5. The former claimant visibly decelerates instead of teleporting or continuing
   a pointless chase.
6. The new claimant reaches the same point and time that authoritative ball and
   player trajectories report.
7. An in-flight inaccurate pass can be adopted by a better-positioned teammate.
8. A deflection immediately invalidates and recomputes the previous claim.
9. A ball crossing the line ends all claims and produces the correct restart.
10. Same scenario and seed reproduce byte-identical claim history and playback.
11. Replay serialization preserves the player and ball motion state required to
    reproduce the handoff.

The user-provided incident should be preserved as a Saved Scenario regression
fixture whenever the video, seed, scenario, and action trace are available.

## Recommended execution order

1. Preserve a Saved Scenario and trace for the reported claimant-lock incident.
2. Build the Tactical and Pattern Influence Audit, including same-seed
   counterfactuals and contribution telemetry.
3. Correct claimant re-evaluation and handoff across inaccurate pass flight and
   loose-ball roll.
4. Establish current full-possession baselines with patterns and tactics on/off.
5. Analyse an initial diverse footage set and author normalized observations.
6. Expand the registry from single-player fragments to coordinated,
   multi-participant, multi-stage proposals.
7. Couple compatible pattern proposals to ball-carrier choices and defensive
   recognition without guaranteeing outcomes.
8. Add decision memory and anti-repetition rules using evidence from the audit.
9. Validate patterns against video-derived shape, timing, and trajectory metrics
   rather than pixel-perfect reproduction.
10. Promote stable, shared behaviour from Match Lab into the actual game's
    engine contract.
11. Keep the current 2D renderer and future Three.js renderer as consumers of
    the same authoritative timeline. Three.js may add presentation, skeletal
    animation, cameras, lighting, and net deformation, but must not invent
    football outcomes or physics.

## Definition of progress

Progress is not the number of new controls, labels, or pattern declarations.
A feature counts as influential only when a same-seed counterfactual proves a
measurable and football-coherent change while preserving legality, physical
reachability, replay determinism, and renderer independence.

## Footage evidence batches

- Batch 01 (13 attacking clips, analysed 2026-09-10): see
  [FOOTAGE_ANALYSIS_BATCH_01.md](./FOOTAGE_ANALYSIS_BATCH_01.md). It decomposes
  the clips into reusable movement and ball-action atoms, seven coordinated
  pattern families, current engine coverage/gaps, implementation order, and
  acceptance evidence. The next evidence request is deliberately failure-heavy
  so abort, recycle, defensive success, and live claimant-handoff behaviour can
  be learned rather than inferred from goals alone.
