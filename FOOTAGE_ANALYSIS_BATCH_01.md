# Match Engine Footage Analysis — Batch 01

Date: 2026-09-10

## Purpose

This batch is treated as behavioural evidence, not as thirteen complete sequences to copy into the match engine. The objective is to extract small, reusable actions and coordinated multi-player behaviours that the engine can combine, interrupt, re-evaluate, and reuse under different players, tactics, opposition shapes, and match states.

The Match Lab remains the sandbox and evidence environment. Any behaviour promoted from this work must be deterministic under a saved seed, measurable in the replay harness, and suitable for later use by the actual game.

## Method used

- Inspected all 13 clips at half-second intervals.
- Re-inspected representative transition, combination-play, wide-attack, and set-piece clips at quarter-second intervals.
- Separated ball action, carrier movement, supporting movement, defensive response, and shape preservation.
- Looked for behaviours repeated across clips rather than copying a named play.
- Compared the observed behaviours with the current V1–V10/action-fragment vocabulary and the existing team-shape, phase, and loose-ball systems.

These are broadcast-camera clips. Camera pan and zoom make exact metres-per-second measurements unreliable without field-line calibration. Relative order, direction, spacing, phase, and role relationships are still usable. Precise velocity and acceleration targets should come from fixed-camera footage or a later calibrated tracking pass.

## What the clips show collectively

The clips do not contain thirteen fundamentally different attacks. They repeatedly combine a smaller football grammar:

1. Possession is secured or regained.
2. The first player either releases quickly or accelerates into an exposed lane.
3. Teammates allocate different jobs: close outlet, central support, depth runner, opposite-side balance, and rest defence.
4. The defence reacts as a unit: nearest pressure, inside cover, retreating line, runner tracking, and far-side narrowing.
5. The carrier makes another decision from the new geometry rather than completing a pre-scripted sequence.
6. The final action is created by the relationship between ball speed, player momentum, defensive pressure, lane occupation, and arrival timing.

The realism comes from those relationships continuing during ball travel. Players do not wait for the pass event to finish before starting the next movement.

## Clip-by-clip decomposition

| Clip | Observed structure | Reusable atoms | Coordinated behaviour to learn |
|---|---|---|---|
| Center ball won → short pass → long shot | Central regain/second ball, quick safe release, receiver advances into shooting lane, nearby players occupy defenders | `secure-second-ball`, `immediate-layoff`, `receive-forward`, `carry-into-shot-lane`, `long-shot` | Regain does not end the phase; first release and supporting movements begin immediately |
| Central solo dribbling → long shot | Carrier recognises open central grass, increases stride, teammates preserve passing lanes and occupy defenders, carrier shoots before the block resets | `scan-open-lane`, `transition-accelerate`, `progressive-carry`, `decoy-run`, `long-shot` | Low pressure should strongly favour forward acceleration for a capable carrier without forcing it every time |
| Counter attack from right | Regain near defensive third, right-channel carrier accelerates over a long distance, central and far-side players stagger their runs, defenders retreat and narrow, final pass/delivery arrives after the defence is stretched | `release-wide`, `channel-carry`, `stagger-support`, `central-depth-run`, `weak-side-run`, `final-pass` | A counter is a temporary coordinated phase with lane allocation, not one runner plus generic `ADJUST` events |
| Counter to left wing | Ball is moved early into left-side space, wide carrier attacks the exposed lane, central runners fill distinct box lanes, defenders recover goal-side | `diagonal-release`, `wide-carry`, `overlap-or-decoy`, `box-entry`, `cross-or-cutback` | The weak side, central lane, and near/far-post lanes must be allocated before the delivery |
| Diagonal to attack | Diagonal progression changes the defence's facing direction, receiver attacks a new lane while supporting players advance at different depths | `diagonal-pass`, `receive-on-turn`, `third-man-advance`, `far-side-balance` | A diagonal is valuable because it changes pressure and cover geometry, not because it has a fixed bonus |
| Center long through ball | Passer sees space behind the line, runner commits before contact, ball is led into space, defenders turn and chase | `threaten-depth`, `curve-to-stay-onside`, `lead-pass`, `turn-and-chase`, `keeper-sweep-decision` | Passer and runner should be evaluated jointly; travel time and projected interception race determine viability |
| Center short passes | Patient central circulation draws pressure, receiver carries or releases through a narrowing gap, forwards pin/drag defenders, shot emerges at the edge of the block | `show-between-lines`, `short-to-feet`, `bounce-pass`, `pass-and-move`, `pin-defender`, `edge-arrival` | Combination play needs short-term memory across two or three touches so third-man movement is meaningful |
| Left dribbling → cross | Wide/half-space carrier advances, inside runners stagger, defence collapses, delivery targets a dynamically occupied lane | `wide-carry`, `underlap-or-overlap`, `near-post-run`, `penalty-spot-run`, `far-post-run`, `cross` | Crossing targets should come from arrivals and defender positions, not a generic centre-of-box point |
| Left short pass → through pass | Short circulation on the left invites pressure, a new lane opens, through/diagonal release attacks it, central and far-side players continue into finishing positions | `wall-support`, `third-man-run`, `thread-pass`, `square-ball`, `far-post-arrival` | The through pass is the consequence of the preceding movement; it should not be an isolated random action |
| Left → middle short passing | Ball moves inward through close support while defenders compress; receiver chooses between another pass, carry, or shot | `inside-support`, `receive-under-pressure`, `layoff`, `recycle`, `edge-shot` | Multiple legal options must remain alive; the pattern proposes intentions but must allow the carrier to re-evaluate |
| Right short passes | Right-side combination creates width and a delivery lane; attackers occupy separate finishing lanes while defenders hand off runners | `wide-triangle`, `overlap`, `bounce-pass`, `cutback-support`, `box-lane-fill` | The engine needs runner handoff and box-lane ownership on both attack and defence |
| Right → center → left → long shot | Circulation changes the point of attack and shifts the block; a late player remains available outside the crowd for the shot | `switch-through-center`, `move-block`, `late-opposite-arrival`, `edge-space-hold`, `long-shot` | Opposite-side players should not all collapse toward the ball; one can preserve the next attacking lane |
| Long-range set piece | Lofted delivery from distance, attackers and defenders start in layered positions, several players contest or screen, secondary players prepare for the loose ball | `timed-set-piece-run`, `attack-first-contact`, `screen-or-block`, `defend-drop-zone`, `second-ball-edge`, `set-piece-rest-defence` | A set piece requires first-contact and second-ball phases; it must not end at the initial flight/duel |

## Reusable action vocabulary proposed from this batch

### Individual movement atoms

- `SCAN.OPEN_LANE` — recognise unoccupied forward space and compare it with pressure and cover.
- `RUN.TRANSITION_ACCELERATE` — accelerate into open grass using the player's pace, acceleration, stamina, current velocity, and facing direction.
- `RUN.CURVE_DEPTH` — bend a run to remain onside and preserve a useful passing angle.
- `RUN.CHECK_AND_GO` — decelerate or check away before attacking the next lane.
- `RUN.LATE_ARRIVAL` — hold behind the first wave, then attack edge or box space.
- `RUN.WEAK_SIDE_HOLD` — remain available away from the ball instead of joining the cluster.
- `MOVE.PASS_AND_CONTINUE` — reposition immediately after releasing the ball.
- `MOVE.REST_DEFENCE` — preserve protection behind an attack rather than joining it.

### Ball-action atoms

- `BALL.SECURE_SECOND` — control or deliberately redirect a loose/second ball.
- `PASS.IMMEDIATE_RELEASE` — one- or two-touch release after a regain.
- `PASS.BOUNCE` — return/bounce pass supporting a third player or continued run.
- `PASS.LEAD_CHANNEL` — weight the ball into projected runner space.
- `PASS.DIAGONAL_SWITCH` — change lane and defender orientation.
- `PASS.CUTBACK` — target a trailing or penalty-spot arrival rather than the goal line.
- `CROSS.TARGET_LANE` — choose near, centre, far, or cutback lane from live occupation.

### Defensive atoms

- `DEF.DELAY_CARRIER` — nearest defender controls space and time rather than charging blindly.
- `DEF.COVER_INSIDE` — second defender protects the dangerous inside lane.
- `DEF.RETREAT_AND_NARROW` — back line drops while reducing central gaps.
- `DEF.HANDOFF_RUNNER` — responsibility changes when a runner crosses zones or lines.
- `DEF.RECOVER_CENTRAL` — recovering midfielder protects the highest-value central route.
- `DEF.PROTECT_SECOND_BALL` — position for the drop/clearance after a delivery or duel.

### Coordinated pattern families

Patterns should be coordinators that propose compatible intentions to multiple players. They must never teleport players or guarantee the next action.

1. `REGAIN_QUICK_RELEASE` — secure → immediate outlet → passer continues → receiver attacks space.
2. `CENTRAL_CARRY_BREAK` — carrier acceleration + decoy/width + late support + defensive delay/cover.
3. `WIDE_TRANSITION` — channel carrier + central depth + weak-side support + rest defence.
4. `SHORT_COMBINATION` — show → feet pass → bounce/third-man option → re-evaluate.
5. `LEAD_BEHIND_LINE` — depth threat + curved run + weighted pass + chase/sweep race.
6. `WIDE_DELIVERY` — progression + overlap/underlap + box-lane allocation + cross/cutback.
7. `LONG_SET_PIECE_SECOND_PHASE` — delivery → first-contact contest → loose-ball claim → continuation or clearance.

## Required coordinator contract

Every pattern family should declare:

- `trigger`: the live geometry and phase that makes it a candidate.
- `participants`: roles to fill, selected from the current players rather than fixed identities.
- `intent proposals`: desired lanes, targets, or ball actions—not final coordinates.
- `constraints`: offside, pressure, separation, visibility, stamina, player speed, and Laws of the Game.
- `tactical biases`: how manager instructions raise or lower its utility.
- `attribute inputs`: which player qualities affect recognition, execution, acceleration, and error.
- `abort conditions`: loss of possession, lane closure, pressure arrival, offside risk, changed claimant, or restart.
- `re-plan cadence`: how often the intentions are reconsidered as geometry changes.
- `fallbacks`: recycle, hold, protect, clear, or switch rather than forcing the original move.
- `observability`: candidates, selected family, participant assignments, utility deltas, and reason for abort/completion.

The coordinator should reserve roles such as carrier support, depth runner, weak-side runner, box lane, and rest defender. The normal decision and motion systems still decide how each player fulfils the intent.

## Comparison with the current engine

### Already present in partial form

- `run-off-pass` resembles pass-and-continue.
- `arc-overlap` resembles one overlap shape.
- `show-wide`, `vacate-pocket`, `peel-square`, and `check-decel` cover useful isolated movements.
- Joint pass/run evaluation provides a base for through balls.
- Team phase and team shape provide broad transition, width, support, recovery, and rest-defence behaviour.
- Box run slots provide a starting point for near/central/far allocation.
- Restart setup provides initial set-piece geometry.

### Missing or too weak to create the footage's effect

- V1–V10 are not yet a convincing family of distinct, observable behaviours; several versions have no unique runtime pattern.
- Existing fragments are predominantly single-player endpoint proposals. The clips rely on two-to-five-player coordination.
- Only one special movement may fire in a planning call, preventing complementary roles from being assigned together.
- There is insufficient memory across consecutive touches for wall passes, third-man combinations, or a pass that is created by the preceding movement.
- Transition lane allocation is generic. Carrier, central depth, weak side, trailer, and rest-defence jobs are not bound as one coordinated response.
- Defensive pressure, cover, narrowing, retreat, and runner handoff are not tightly coupled to the attacking intentions.
- Patterns do not yet expose clear candidate/selection/abort diagnostics, so tactical influence is difficult to prove visually or statistically.
- The loose-ball system predicts a winner too early and keeps that claimant even when another player becomes the best live option.
- Set pieces lack a complete first-contact/second-ball continuation model.

## How tactics and player identity must influence these behaviours

Tactics should bias frequency and role allocation, not select a canned animation:

- Counter/on-gain instructions increase `WIDE_TRANSITION` and `CENTRAL_CARRY_BREAK` when space exists.
- Possession and shorter passing increase `SHORT_COMBINATION`, recycling, and supporting triangles.
- Directness and pass-into-space increase `LEAD_BEHIND_LINE`, conditional on a real runner and viable ball flight.
- Width, focus side, overlaps, and early-cross instructions affect wide-lane occupation and delivery timing.
- Pressing, counter-press/regroup, line height, and marking affect delay, cover, recovery, and handoff behaviour.
- Formation, position, role, and duty determine who is a likely carrier, depth runner, outlet, box arrival, or rest defender.

Player attributes must determine whether the intention is recognised and how well it is executed:

- Decisions, anticipation, teamwork, off the ball, positioning, and vision influence recognition and coordination.
- Acceleration, pace, agility, balance, stamina, and current momentum constrain every movement and adjustment.
- Passing, technique, flair, dribbling, crossing, and finishing affect execution and error.
- No `ATT.ADJUST` or `DEF.ADJUST` may send every player to an endpoint at one constant speed.

## Defensive interpretation of this batch

The defenders are not background animation. Every attacking family must be
resolved together with an opposing defensive response. The successful attacks
in this batch reveal both useful defensive behaviour and the defensive errors
that create the chance.

### What is visible in the clips

- Immediately after losing possession, nearby players either engage briefly or
  turn into recovery runs. They do not all perform the same adjustment.
- The nearest defender usually delays the carrier while a second defender
  protects the inside lane. Winning the ball immediately is not always the
  first defender's job.
- Centre-backs retreat while watching both ball and depth runners. Their drop
  is affected by the runner, ball-carrier pressure, offside line, and goalkeeper
  position rather than a fixed target coordinate.
- Wide defenders must choose between engaging the carrier, following an
  overlap, blocking the cross, and protecting the inside channel.
- Midfield recovery runners protect central passing and cutback lanes. Chasing
  directly toward the ball can make the defence worse.
- The far-side defender narrows toward goal while retaining awareness of the
  weak-side runner.
- Marking responsibility changes as runners cross lanes. The original defender
  should not follow a runner forever if a safe handoff becomes available.
- In the box, defenders allocate the near-post lane, central goal-facing space,
  far-post runner, cutback edge, and second ball.
- On long deliveries, the defensive action continues after first contact:
  challenge, cover the drop, clear, step out, claim the loose ball, or defend
  another delivery.

### Defensive role allocation

For each re-plan tick, the defensive coordinator should assign temporary jobs:

1. **Pressure owner** — the player with the best physically reachable approach
   angle, not merely the smallest current distance.
2. **Inside cover** — protects the direct route toward goal and is prepared to
   inherit the carrier.
3. **Depth protector** — controls the most dangerous run behind the line.
4. **Runner trackers** — track selected runners until a safe handoff condition.
5. **Far-side balance** — narrows enough to protect goal without abandoning the
   opposite attacker unnecessarily.
6. **Recovery screen** — midfielder recovers through the valuable central or
   cutback lane.
7. **Line controller** — coordinates hold, step, or drop using pressure on the
   ball and runner momentum.
8. **Goalkeeper cover** — adjusts depth and lateral position and decides whether
   to sweep, claim, hold, or prepare for the shot.

Assignments must be dynamic. A defender may inherit pressure when the original
presser is beaten; a centre-back may pass a runner to the full-back; a recovering
midfielder may become the inside cover. Use hysteresis and commitment cost so
responsibility does not twitch between players every frame.

### Defensive pattern families

1. `LOSS_COUNTERPRESS_WINDOW` — selected nearby players close ball and immediate
   outlets for a short, bounded window while the rest preserve protection.
2. `TRANSITION_DELAY_AND_RECOVER` — first defender delays; line retreats and
   narrows; midfielders recover into central lanes.
3. `PROTECT_DEPTH_AND_HANDOFF` — line manages run-behind threats, offside risk,
   tracking, and responsibility transfer.
4. `SHIFT_BLOCK_AND_PRESS` — settled block moves with circulation while one
   player presses and neighbours cover the spaces that press opens.
5. `DEFEND_WIDE_OVERLOAD` — allocate carrier pressure, overlap tracking, inside
   cover, cross blocking, and far-side protection.
6. `DEFEND_BOX_LANES` — protect near, central, far, cutback, and rebound spaces
   according to live attacker arrivals.
7. `DEFEND_SET_PIECE_SECOND_PHASE` — challenge first contact, protect the drop,
   clear, step out coherently, and re-form if possession is not secured.

These are not guaranteed defensive moves. They propose responsibilities, after
which player perception, decisions, anticipation, positioning, marking,
acceleration, pace, agility, strength, stamina, current momentum, and facing
determine whether the response succeeds.

### Coupling attack and defence

An attacking pattern must not run against generic defenders. Each attacking
intention generates threats that the defensive coordinator ranks:

- a central carry creates carrier, inside-lane, and late-arrival threats;
- a wide transition creates channel, central-depth, far-side, and cutback
  threats;
- a through ball creates passer-pressure, runner, interception, and goalkeeper
  sweep races;
- a cross creates near, central, far, cutback, and rebound threats.

Defensive choices then change the attacker's next decision. If inside cover
arrives, the carrier may release wide. If the full-back follows the overlap, an
inside lane may open. If the line drops early, the passer may recycle or shoot.
This feedback loop is what prevents the pattern system from becoming a rigid
animation playlist.

### Defensive acceptance evidence

- One and only one defender normally owns primary pressure, with explicit cover
  assignments behind them.
- The pressure owner can change without teleporting or rapid assignment
  oscillation.
- Defenders use individual reachable speed and turning constraints; slower
  players cannot silently match faster runners.
- The back line holds, drops, or steps for a traceable reason linked to pressure,
  threats, tactics, and player attributes.
- Runner handoffs preserve coverage and appear in the replay trace.
- When a defender leaves the line, another defender covers the exposed lane or
  the trace records why no cover was possible.
- Wide defending changes when an overlap, underlap, or inside cut is introduced.
- Box defenders select live threats instead of converging on the ball.
- A clearance creates a new loose-ball race and team transition rather than
  ending in a dead interval.
- Counterpress, regroup, line height, width, marking, and player roles produce
  measurable same-seed differences without overriding live geometry.

### Defensive footage still required

Because this batch contains successful attacks, it mainly shows defences being
stretched or beaten. A balanced evidence set should add:

- a counter stopped by a defender delaying until support recovers;
- a clean centre-back/full-back runner handoff;
- an organised block shifting through several switches of play;
- a successful counterpress and an unsuccessful counterpress followed by
  regrouping;
- an overlap defended without conceding the inside lane;
- a cross defended at near post, far post, and cutback edge;
- a high line stepping successfully and a high line forced to turn and recover;
- goalkeeper sweeping behind the line;
- set-piece first contact plus defensive second-ball recovery;
- a defender abandoning an old loose-ball claim because a teammate becomes the
  physically superior claimant.

## Immediate implementation order

1. **Make influence observable.** Record pattern candidates, chosen family, participant roles, tactical utility deltas, player-attribute inputs, abort reason, and completion reason in the replay trace.
2. **Fix live loose-ball ownership.** Re-evaluate arrival time during the race; transfer claimant only after a clear hysteresis margin and commitment check. Supporting players must update when the claimant changes.
3. **Allow simultaneous compatible intentions.** Replace the one-special-run-per-call restriction with role reservations and conflict arbitration.
4. **Implement the first three coordinators.** Start with `REGAIN_QUICK_RELEASE`, `WIDE_TRANSITION`, and `SHORT_COMBINATION`; together they cover most of this batch without becoming goal scripts.
5. **Bind defensive response.** Add nearest delay, inside cover, retreat/narrow, and runner handoff as live reactions to the chosen attacking intentions.
6. **Implement lane-aware final-third occupation.** Near post, central/penalty spot, far post, cutback edge, and rest-defence lanes should be assigned dynamically.
7. **Add set-piece second phase.** Continue after first contact into deflection, claim, shot, recycle, clearance, or another restart.
8. **Only then tune rendering.** Three.js should render authoritative engine state, momentum, gait, contact, ball flight, and net response; it must not conceal frozen or discontinuous simulation states.

## Acceptance evidence

- Same seed and players, different tactical instructions: trace shows meaningful candidate/selection/role changes over many possessions.
- Same tactics, players with different attributes: recognition, acceleration, arrival timing, execution, and error change without changing the laws of motion.
- During a counter, carrier, central runner, weak-side runner, and defenders move concurrently while the ball moves.
- Patterns can abort or recycle when a lane closes; they do not force the named ending.
- No teleporting and no constant-speed mass adjustments.
- A new player can take over a loose-ball chase when projected arrival advantage becomes decisive; the old claimant transitions to support/cover.
- Crosses choose from live box-lane occupation and can miss, be blocked, cleared, caught, or create a second ball.
- Set-piece play continues coherently after the initial aerial contact.
- Replay output remains deterministic and captures positions, velocities, ball state, current intentions, chosen pattern, phase, tactics, stamina, and random seed.

## Evidence still needed

This batch is strongly success-biased. Before probability tuning, collect failed or interrupted examples of the same families:

- a counter that is delayed and recycled;
- a wide attack whose cross is blocked or cleared;
- a through ball that is abandoned, intercepted, or swept by the goalkeeper;
- a dribbler who accelerates, meets cover, and passes or turns back;
- short combination play that loses the ball;
- a long set piece won cleanly by the defence and one producing a genuine second-ball scramble;
- a misplaced pass where the most likely ball claimant changes during flight or roll.

Those clips will define abort, fallback, and claimant-handoff behaviour. Without them, successful examples risk becoming deterministic scoring recipes.

## Working conclusion

The footage validates the project's direction but also explains why current play can feel rigid: the engine has several useful isolated movement fragments, yet realistic attacks are produced by concurrent, conditional intentions shared across attackers and defenders. The next step is not to add thirteen more whole sequences. It is to introduce a small pattern coordinator layer, prove tactical and attribute influence in the replay trace, and let normal decisions continuously re-evaluate each proposed movement.
