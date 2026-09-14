# Footage review intake

One clip becomes one reproducible engine case. Copy this file per incident.

Footage is **evidence, not a script**. The goal is never "make the engine
replay this clip"; it is to extract a behaviour the engine can attempt, fail,
abort and re-use under different players, tactics and opposition shapes. A
case that can only be satisfied by reproducing these exact coordinates has
been written wrongly.

Fill in what the clip actually shows. Write `unknown` where the camera does
not tell you — an honest gap is usable evidence, a guess is not.

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
