# Footage review intake

One clip becomes one reproducible engine case. Copy this file per incident.

Footage is **evidence, not a script**. The goal is never "make the engine
replay this clip"; it is to extract a behaviour the engine can attempt, fail,
abort and re-use under different players, tactics and opposition shapes. A
case that can only be satisfied by reproducing these exact coordinates has
been written wrongly.

Fill in what the clip actually shows. Write `unknown` where the camera does
not tell you — an honest gap is usable evidence, a guess is not.

## How to send a clip

Attach the video and include this short note. Only **Focus** and **Engine
difference** are required; use `unknown` for anything the footage does not
show.

```text
Case: short unique name
Focus: the behaviour to study
Team/direction: who is being studied and which goal they attack
Moment: match clock or timestamp inside the clip
Expected football behaviour: what should normally happen
Engine difference: what Match Lab currently does differently
Context: score, tactics, role or instruction if known
```

Example:

```text
Case: keeper narrows central one-on-one
Focus: goalkeeper depth and striker preparation
Team/direction: defending team protects the left goal
Moment: 00:07 in the clip
Expected football behaviour: keeper advances on the shot cone while staying set
Engine difference: keeper remains near the goal line and the striker pauses
Context: open-play counterattack; other tactical details unknown
```

One message can contain several clips, but give every clip its own case name and
note. If two clips are intended as a comparison, say which behaviour they are
contrasting.

## Preferred footage

- **Length:** usually 10-30 seconds, with at least five seconds before and after
  the incident when available. Longer passages are welcome when team shape is
  the subject.
- **Continuity:** one uninterrupted passage at normal speed. If slow motion is
  useful, include the normal-speed version as well.
- **Format:** MP4/H.264 is preferred; retain the original frame rate and highest
  practical resolution. Do not add interpolated frames or artificial motion
  smoothing.
- **Framing:** avoid tight crops when studying positioning. Pitch markings,
  defenders away from the ball and both goals/lines provide calibration.
- **Clock:** retain the broadcast clock when possible. Otherwise identify the
  relevant timestamp inside the uploaded clip.
- **Camera:** tactical or fixed wide footage is best for coordinated movement;
  broadcast footage is still useful; behind-goal footage is especially useful
  for goalkeeper angles and box occupation; close views are useful for contact,
  body orientation and restart technique.
- **Edits:** avoid cuts, zoom changes and annotations across the decision-to-
  outcome window. A separate marked screenshot can accompany the original clip.
- **Audio:** optional. Keep it when a whistle, referee signal or contact sound
  establishes when play stopped or restarted.

Exact player names and tactical instructions help but are not required. The
clip must never be filled with guesses merely to complete the form.

## Footage that teaches the engine most

Prefer small contrast sets over compilations of spectacular outcomes. A strong
batch normally contains 5-12 cases and includes:

1. the behaviour succeeding;
2. the same idea being delayed, blocked or handed off;
3. the player abandoning it and choosing a safe alternative;
4. a mistake caused by pressure, body shape, timing or ability;
5. a similar geometry producing a different choice because the tactics or
   match state differ.

The most valuable current subjects are:

- receiving and releasing first time, including cushions, layoffs and turns;
- pressure ownership, cover, runner handoffs and a defensive line recovering;
- counters that succeed, slow down, recycle or fail;
- wide attacks with overlaps, underlaps, crosses, blocks and second balls;
- goalkeeper starting depth, narrowing, sweeping, smothering and retreating;
- corners, free kicks, throw-ins and the phase after first contact;
- loose balls, deflections, rebounds, collisions and changes of claimant;
- offside interference by a player who is not the intended receiver;
- fatigue, repeated sprints and late-match support or recovery;
- the same team shape before and after a real tactical adjustment.

Goals alone are weak evidence for decision realism because they omit most
aborts, recoveries and defensive successes. Use goal clips when shot placement,
keeper response, the buildup relationships or the defensive failure is the
actual subject.

## Our shared gameplay language

Every case will be discussed in the same causal order:

```text
CONTEXT -> TRIGGER -> PERCEPTION -> RESPONSIBILITIES -> OPTIONS
        -> CHOICE -> EXECUTION -> RESPONSE -> OUTCOME -> REPLAN
```

- **Context:** score, clock, phase, formations, tactics, roles and current
  physical state.
- **Trigger:** the new fact that makes players react: a regain, pass, bad touch,
  run, whistle, space opening, pressure arriving or ball trajectory changing.
- **Perception:** which players can notice the trigger, when they notice it and
  which attributes affect that delay.
- **Responsibilities:** temporary jobs such as ball carrier, outlet, runner,
  presser, cover, tracker, line controller, claimant or sweeper.
- **Options:** physically reachable and legally available actions or movements.
- **Choice:** the selected option and the tactical, attribute and geometric
  reasons that raised or lowered it.
- **Execution:** the actual acceleration, turn, contact, pass, shot, tackle or
  handling action. Intention and execution are kept separate.
- **Response:** what teammates and opponents do while the action is happening.
- **Outcome:** the contact or state change that actually occurs, including
  failure, deflection, loose ball, restart or retained possession.
- **Replan:** who continues, aborts, changes job or takes over after the picture
  changes.

Use these optional namespaces when naming a case or observation:

| Namespace | Examples |
| --- | --- |
| `PHASE` | `BUILD_UP`, `SETTLED_ATTACK`, `TRANSITION_IN`, `TRANSITION_OUT` |
| `BALL` | `CONTROLLED`, `ROLLING`, `AIRBORNE`, `LOOSE`, `DEAD` |
| `ATT` | `OUTLET`, `OVERLAP`, `UNDERLAP`, `THIRD_MAN`, `RUN_BEHIND`, `REST_DEFENCE` |
| `DEF` | `PRESSURE`, `INSIDE_COVER`, `TRACK`, `HANDOFF`, `DROP`, `STEP`, `RECOVERY_SCREEN` |
| `GK` | `HOLD_LINE`, `NARROW`, `RUSH`, `SWEEP`, `SMOTHER`, `RETREAT` |
| `CONTACT` | `CONTROL`, `FIRST_TIME`, `DUEL`, `BLOCK`, `DEFLECTION`, `REBOUND` |
| `RESTART` | `THROW_IN`, `CORNER`, `FREE_KICK`, `GOAL_KICK`, `KICK_OFF` |
| `LAW` | `OFFSIDE_POSITION`, `INTERFERENCE`, `FOUL`, `ADVANTAGE`, `BALL_OUT` |
| `MOTION` | `ACCELERATE`, `BRAKE`, `TURN`, `CHECK`, `SPRINT`, `RECOVER` |
| `OUTCOME` | `COMPLETE`, `FAIL`, `ABORT`, `RECYCLE`, `HANDOFF`, `SECOND_BALL` |

A useful one-line observation therefore looks like:

```text
TRANSITION_IN: the inside cover arrives before the carrier can release, so the
carrier aborts RUN_BEHIND, recycles, and the weak-side runner recovers shape.
```

These terms describe relationships rather than fixed player names or exact
coordinates, which lets one observation apply to different teams, formations
and ability levels.

## What the review will return

For each submitted case, the review will provide:

1. what the clip demonstrates and what the camera cannot establish;
2. the normalized causal description using the shared language above;
3. the current engine behaviour and verified structural difference;
4. whether the case is a missing behaviour, incorrect rule, tuning question,
   renderer problem or insufficient evidence;
5. the reusable rule, responsibility, pattern or physical invariant proposed;
6. the attributes and tactics that should influence it;
7. a deterministic fixture, counterfactual and acceptance measurement when the
   evidence is sufficient;
8. any narrowly defined comparison footage still needed.

Footage does not automatically train or overwrite the engine. It becomes durable
only after it is translated into an engine-neutral observation, implemented
through the shared simulation path and proven through deterministic tests and
distribution-level measurements.

---

## 1. Source

| Field | Value |
| --- | --- |
| Clip id / filename | |
| Fixture, date | |
| Match clock at incident | |
| Clip covers | `mm:ss.d` to `mm:ss.d` |
| Seconds before / after incident | *(five each minimum where available)* |
| Reviewer, review date | |

**Camera limits.** Broadcast pan and zoom make absolute metres per second
unreliable without field-line calibration. Record what this clip can and
cannot support.

| Field | Value |
| --- | --- |
| Camera type | broadcast / fixed / tactical / unknown |
| Field lines visible for calibration | yes / partial / no |
| Off-screen players at the decision point | |
| Cuts or replays inside the window | |
| Usable for absolute speed? | yes / relative-only |

---

## 2. Match state at the decision point

| Field | Value |
| --- | --- |
| Phase | build-up / progression / final third / transition-in / transition-out / settled defence |
| Open play or restart | open play / kick-off / throw-in / corner / free kick / goal kick / drop ball |
| If restart: taker, type, where awarded | |
| Score, and minute | |
| Attacking direction on screen | left-to-right / right-to-left |
| Team in possession | |

---

## 3. Ball state

| Field | Value |
| --- | --- |
| Position at the decision point | |
| Height band | ground / shin / knee / hip / chest / head / above |
| Motion | rolling / airborne / held / dead |
| Direction of travel | |
| Relative pace | slow / firm / driven / dropping |
| Spin, if visible | |
| Last contact: player, body part, deliberate? | |

---

## 4. Players

Every visible player. Positions relative to pitch landmarks (penalty spot,
edge of the box, halfway line, touchline) rather than guessed coordinates.

| # | Team | Role on the pitch | Position | Moving toward | Relative speed | Body orientation | Watching ball / man / space |
| --- | --- | --- | --- | --- | --- | --- | --- |
| | | | | | still / walk / jog / run / sprint | | |

Note separately:

- who is **off screen** and roughly where they must be;
- who **changes intention** inside the window, and at what timestamp;
- the defensive line height and its shape;
- any handoff between markers.

---

## 5. Tactical context

| Field | Value |
| --- | --- |
| Shape in possession / out of possession | |
| Apparent team instruction (tempo, width, directness, pressing) | |
| The actor's apparent role and duty | |
| What the manager would have asked for here | |

This section is what makes a case reusable. A behaviour that no tactical
setting would ever select is not a behaviour the engine should learn.

---

## 6. The decision point

| Field | Value |
| --- | --- |
| Timestamp | |
| Actor | |
| Options genuinely available | |
| Option taken | |
| Why it was available *(space, timing, body shape, pressure)* | |
| What made the alternatives worse | |

---

## 7. Contact and outcome

| Timestamp | Event | Actor | Body part | Ball result |
| --- | --- | --- | --- | --- |
| | | | | |

| Field | Value |
| --- | --- |
| Outcome | |
| Elapsed decision → contact | |
| Elapsed contact → next contact | |
| Did the phase continue or end? | |

---

## 8. Case taxonomy

Tag every category the incident genuinely exercises. Multiple tags are normal;
tagging everything is not.

- [ ] **Pass height** — ground versus driven versus lofted for the distance and lane
- [ ] **Receiving body shape** — open, half-turned, back-to-goal, shielding
- [ ] **Pressure and handoffs** — who presses, who passes the runner on, when
- [ ] **Keeper angle** — positioning, narrowing, sweeping, claim decisions
- [ ] **Restarts** — setup, roles, delivery, second phase
- [ ] **Loose balls** — claim races and who genuinely wins them
- [ ] **Second balls** — what happens after a knockdown, header or rebound
- [ ] **Offside interference** — active or not, and why
- [ ] **Collisions and body contact** — shoulder duels, blocks, obstruction
- [ ] **Momentum continuity** — whether motion carries through the event

---

## 9. Engine discrepancy

Be specific. "Looks wrong" is not a case.

| Field | Value |
| --- | --- |
| What the engine does today, in this situation | |
| What the footage shows instead | |
| The exact difference, stated as one sentence | |
| Suspected system | e.g. `matchPassFlight`, `spatialDecision`, `worldMotion`, `teamShape` |
| Is this a missing behaviour, a mis-tuned one, or a wrong one? | |

If the engine cannot currently express the behaviour at all, say so — that is
a roadmap item, not a bug.

---

## 10. Acceptance evidence

A case is not complete until it can fail on demand.

| Field | Value |
| --- | --- |
| Saved seed / scenario file | |
| Reproduction command | |
| **Counterfactual** — the change to inputs that should produce the other outcome | |
| **Expected invariant** — the property that must hold afterwards, stated so it is checkable | |
| Trace fields that carry the evidence | e.g. `metrics.passFlight.passType`, `contact.phase` |
| Renderer observation — what a viewer should see | |
| Suite this belongs in | |

The invariant must be a **distribution or property claim**, not a
single-replay claim. One good-looking possession proves nothing and one bad
one disproves nothing; state the acceptance so a sweep can decide it.

---

## 11. Review outcome

| Field | Value |
| --- | --- |
| Accepted / deferred / rejected | |
| If deferred or rejected, why | |
| Linked roadmap stage | |
| Linked fixture committed at | |
