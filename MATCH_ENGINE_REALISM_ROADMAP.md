# Match Engine Realism Roadmap

Staged prompts for single-match realism, in dependency order. Each stage is
written to be handed over verbatim as a single work instruction, the same
convention `MATCH_ENGINE_ROADMAP.md` uses.

`MATCH_ENGINE_ROADMAP.md` holds the **engine infrastructure** plan (sessions,
playback, physics staging). This file holds the **perceived-realism** plan:
whether a tactical instruction is visible, whether a role feels like that
role, whether a passage of play looks like football. The two are siblings;
neither supersedes the other.

`MATCH_ENGINE_ARCHITECTURE.md` remains the architectural source of truth.
`MATCH_ENGINE_OBSERVATION_BACKLOG.md` holds the evidence these stages answer.

| Stage | Title | Status |
| --- | --- | --- |
| 0 | Tactical influence audit | **Built** (2026-09-13) |
| 1a | First-time play decision model | **Built** (2026-09-13) |
| 1b | First-time play engine integration | **Built** (2026-09-13) — pass/layoff only |
| 1c | First-time target choice through the shared utilities | **Built** (2026-09-14) |
| 2 | Role personality | Planned |
| 3 | Coordination families into complete patterns | Planned |
| 4a | Facing as independent state | Planned |
| 4b | Gait and orientation readout | Planned |
| 4c | Sprites/skeletons | Deferred — needs art direction, not engine work |
| 5 | Action variety beyond the core seven | Planned |

## Why this order

The observation backlog's Finding 3 ends with: *"Isolated unit tests do not
establish visible, match-level tactical separation."* That sentence is the
reason Stage 0 comes first. Every other stage on this list is a claim about
what the player will *perceive*, and none of them can be verified by the
suites the engine currently has. Build the measuring instrument, then build
the things it measures.

Stage 1 is placed ahead of role and pattern work on a deliberate judgement:
the engine has no first-time play at all, so every possession runs
`receive -> control -> decide -> release`. That single fixed rhythm is a more
likely cause of the reported monotony (Finding 2) than the size of the
pattern vocabulary, and it is a smaller change than either Stage 2 or
Stage 3.

## Diagnosis this roadmap answers

Measured against the tree at `f7d79eb` plus the uncommitted coordination work:

| Area | Finding |
| --- | --- |
| Roles | 57 defined in `TACTICAL_ROLES`. `roleOffsets()` in `teamShape.js` implements every one of them as a constant `{x, y}` yard offset. AMC's `attacking-midfielder` and `trequartista` return byte-identical `{x: 0, y: 4}`. Outside that offset, `tacticalRole` is read at runtime in four places, three of which are `/target/i` regex tests. |
| Patterns | Six fragments from V1-V10; V2/V3/V6/V8 unimplemented; one `special-run` per planning call. `coordinationCoordinator.js` (5 attacking + 6 defensive families) is the first real answer and is new. |
| Animation | `facingFromVelocity()` is computed into every motion record and never rendered. Vision cones exist but default to `showVisionCone: false`. Players are CSS circles; only the ball gets curve animation. The kinematics underneath (top speed, braking distance, `turnRetention`, gait-dependent touch thresholds) are strong and entirely invisible. |
| Action variety | Seven on-ball verbs (`pass`, `through`, `cross`, `dribble`, `shoot`, plus hold and carry). Four pass types chosen by **geometry**, not by the player. No first-time, layoff, flick-on, backheel, dummy or volley anywhere in the engine. |

## Cost warning that applies to every stage below

A full 90-minute match currently costs **86 seconds** headless and
single-threaded (459 chunks, measured 2026-09-12 via
`tools/test-match-lab-setup.mjs --full-match`). Stages 1 and 5 both multiply
the on-ball branching factor. Every stage here must report its measured cost
delta on that same fixture, and a stage that raises it materially must say so
in its report rather than letting it accumulate silently.

---

## Standing rules for every stage

These extend `MATCH_ENGINE_ROADMAP.md`'s own standing rules, which continue
to apply in full and are not repeated here. Where the two conflict, the
engine roadmap's rules win.

- **Measure before and after with Stage 0.** A stage that claims to change
  what the player perceives must show a Stage 0 separation report for the
  input it changed, taken before and after. "The suites are green" is not
  evidence that anything became visible.
- **Perceived realism is a distribution claim, not a single-replay claim.**
  One good-looking possession proves nothing; one bad-looking possession
  disproves nothing. Argue from the sweep.
- **Animation is a readout, never an invention.** The renderer may not
  author body state any more than it may author ball movement. If a pose or
  a gait is not derivable from engine state, the engine is what needs the
  change.
- **Report the cost delta** on the 90-minute fixture named above.

---

## Stage 0 — Tactical influence audit (built)

> Implement Realism Roadmap Stage 0: the tactical influence audit.
>
> Read completely: `MATCH_ENGINE_OBSERVATION_BACKLOG.md` (especially
> Finding 3 and Proposal 1), `MATCH_ENGINE_ARCHITECTURE.md`,
> `src/lib/replayHarness.js`, `src/lib/teamInstructions.js`,
> `src/lib/spatialDecision.js` (`generateFreePlayCandidates`,
> `chooseCandidate`, `decisionOptionMetrics`), the `possessionMetrics` and
> `decisionMetrics` construction in `match-lab.js`,
> `tools/measure-stage4.mjs` for the measurement-tool convention, and
> `package.json`.
>
> The engine's tests prove that tactical inputs *reach* behaviour. They do
> not prove the effects are large enough for a player to see over many
> possessions. Build the instrument that decides that question.
>
> Requirements: a **pure**, engine-independent statistics module that takes
> two samples and reports whether they are separated, and a harness that
> drives the real engine over recorded scenarios to produce those samples.
> The harness must change no engine behaviour and consume no engine RNG of
> its own — it only reads what a possession already returns.
>
> Use a non-parametric test. These distributions are counts and bounded
> ratios, not normal, and the two arms are **not** validly paired: changing a
> tactical setting changes candidate-list length, which re-keys every later
> `decisionRandom()` draw, so the same seed does not produce a matched
> counterfactual. Sweeping many seeds per arm is what sees past that, and the
> harness must default to enough of them to make the verdict mean something.
>
> Report an effect size, not only a p-value. A large sweep will find
> significance in effects far too small to perceive; the question is
> magnitude. Classify each result on a published, documented threshold scale
> and make the "no visible effect" verdict a first-class, clearly-labelled
> outcome rather than a failure to reject.
>
> **Explicitly out of scope:** changing any engine behaviour, tuning any
> instruction, new candidate types, and any change to RNG ordering.
>
> Add deterministic tests proving the statistics against distributions with
> known answers — identical samples, a known shift, a known non-overlap,
> tied data, and degenerate inputs (empty, single-valued, zero variance).
>
> Finish by reporting files changed, the metric set, the measured baseline
> for the tactical inputs swept, test results, and which inputs the baseline
> shows are currently invisible.

### Delivered (2026-09-13)

`src/lib/influenceAudit.js` — pure statistics, no engine import. Mann-Whitney
U with tie-corrected normal approximation, Cohen's d, rank-biserial
correlation, and a documented four-band verdict scale.

`tools/measure-tactical-influence.mjs` — builds one real 11v11 from the
historical-squad catalogue, then sweeps the same list of (starting owner,
seed) pairs under both settings of each tactical input and prints a
per-metric separation table plus an overall verdict.

The recorded `tools/replay-scenarios/` fixtures are deliberately **not** the
sample here: they hold two to six players each, which is the right size for
reproducing a specific physics bug and far too small for a tactical
instruction to have anywhere to express itself.

`tools/test-influence-audit.mjs` — 61 assertions over known distributions.

Run it with `npm run audit:tactical-influence`.

### The verdict scale

Cohen's conventions, applied to the rank-biserial correlation and to `d`:

| Verdict | Threshold | Meaning |
| --- | --- | --- |
| `none` | \|d\| < 0.2 | Not perceptible. The instruction is plumbed but inert. |
| `weak` | 0.2 <= \|d\| < 0.5 | Detectable in aggregate, invisible in a single match. |
| `visible` | 0.5 <= \|d\| < 0.8 | A player watching several possessions would notice. |
| `strong` | \|d\| >= 0.8 | Unmistakable. |

A verdict above `none` additionally requires `p < 0.05`. A significant result
with a small effect is reported as `none` with its p-value attached, which is
the honest reading: real, and too small to see.

### Measured baseline (2026-09-13)

80 possessions per arm, 12 actions each, one real 11v11. Raw output in
`audit/influence/baseline-2026-09-13.{txt,json}` (gitignored — regenerate with
`npm run audit:tactical-influence`).

| Tactical input | Verdict | Strongest metric | d | p |
| --- | --- | --- | ---: | ---: |
| `attacking.style` long-ball vs possession | **strong** | longest pass | 0.897 | <0.0001 |
| `attacking.tempo` quick vs slow | **strong** | pass share | 0.825 | <0.0001 |
| `attacking.directness` 5 vs 1 | **visible** | mean shot distance | 0.742 | 0.0295 |
| `attacking.dribbling` more vs less | weak | pass share | -0.485 | 0.0045 |
| `marking.pressing` high vs low | weak | actions | 0.312 | 0.0239 |
| **role** regista vs ball-winning-midfielder | weak | longest pass | -0.203 | 0.0442 |
| `attacking.passIntoSpace` on vs off | **none** | longest pass | -0.096 | 0.7497 |
| `attacking.shooting` encourage vs discourage | **none** | mean shot distance | 0.104 | 0.8047 |

Three findings worth carrying forward:

**Style, tempo and directness are genuinely visible.** The plumbing works and
the magnitudes are real. This is the control that makes the negative results
below trustworthy rather than an artefact of a blunt instrument.

**Role is the weakest input measured.** Two central-midfield roles a manager
would consider completely different players separate at `d = -0.203`, on one
metric, at the edge of significance. That is the quantified case for Stage 2,
and it is exactly what a 57-role system implemented as a constant `{x, y}`
offset should be expected to produce.

**`attacking.shooting` did not change a single non-shot decision.** Pass
share, carry share, decisions, actions and longest pass all came back at
`d = 0.000, p = 1.0000` — bit-identical across 80 possessions per arm. The
instruction moved only `shotsSelected` (0.138 vs 0.125), which over this
sample is about **one possession in eighty**.

### Known limitation of the current metric set

The sample is shot-poor: roughly 0.13 shots per possession, so ten shots per
arm. Any verdict resting on `shotsSelected` or `meanShotDistanceYards` is
therefore underpowered, and `attacking.shooting`'s `none` should be read as
*"changes nothing outside shooting, and the sweep cannot yet speak to
shooting itself"* rather than as a clean inert verdict.

Fixing this is a small, well-defined addition: sample some possessions from
final-third starting positions so shots are common enough to test. Do that
before using this harness to judge any shooting-related change.

---

## Stage 1a — First-time play decision model (built)

> Implement Realism Roadmap Stage 1a: the first-time play decision model, as
> a pure module, not yet wired into the engine.
>
> Read completely: `src/lib/matchPassFlight.js`, `src/lib/playerKinetics.js`,
> `src/lib/matchEngineCore.js` (`playerAttribute`, the attribute catalogue),
> `src/lib/ballClaim.js` and `src/lib/motionEffort.js` for the pure-module
> convention, `resolvePassAccuracy` and the `P.RECEIVE.*` pipeline in
> `match-lab.js`, and `src/lib/teamInstructions.js`.
>
> The engine has no first-time play. Every possession runs receive ->
> control -> decide -> release, which is the wrong rhythm for roughly a third
> of real football and a strong candidate cause of the monotony recorded as
> Finding 2 in the observation backlog.
>
> Build the model that decides whether a player arriving at a ball may
> release it without controlling it first, and how well. Physical
> feasibility, attribute competence and tactical preference are three
> separate questions and must be three separate outputs — a player can be
> perfectly able to play a first-time ball and have no reason to, and can
> badly want to and be unable.
>
> Ground the difficulty in real geometry, not a table of action names. The
> dominant physical term is the velocity change the contact must impart:
> continuing the ball's existing direction is cheap, turning it through a
> right angle is expensive, and sending it back where it came from is cheap
> again precisely because the outgoing ball is slow. Contact height is a
> second, independent term with a genuine awkward band between the knee and
> the hip.
>
> Introduce no second ball-flight, speed or accuracy model. Express execution
> difficulty as a penalty the **existing** `resolvePassAccuracy` pipeline can
> consume, so first-time error stays one model with one tuning surface.
>
> The module must be pure and deterministic: it consumes no RNG, mutates
> nothing, and returns the same result for the same inputs. The caller rolls.
>
> **Explicitly out of scope:** wiring it into the reception pipeline, any
> change to RNG ordering, new trace events, sound, playback, and the
> aerial/heading duel system.
>
> Add deterministic tests covering each option kind, the deflection-cost
> curve at 0/90/180 degrees, the awkward-height band, attribute sensitivity,
> tactical preference separation, and degenerate inputs.
>
> Finish by reporting files changed, the model and its terms, test results,
> and the exact integration points Stage 1b will need.

### Delivered (2026-09-13)

`src/lib/firstTimePlay.js` — pure, no engine import, no RNG.

Four option kinds: `first-time-pass`, `layoff`, `flick-on`,
`first-time-shot`. Three independent outputs per option:

- `feasibility01` — can this body, at this height, with this deflection, make
  clean contact at all
- `competence01` — attribute competence for this specific kind
- `preference01` — tactical and situational appetite

`firstTimeAccuracyPenalty()` returns a multiplier for the existing
`resolvePassAccuracy` error term. No second accuracy model is introduced.

`tools/test-first-time-play.mjs` — 81 assertions. Run with
`npm run test:first-time-play`.

---

## Stage 1b — First-time play engine integration (built)

### The RNG contract decision (2026-09-13)

The prompt below asks whether the first-time choice should be a new candidate
inside the existing list or a separate decision taken before the list is
built. The answer is **neither**, and the reasoning matters enough to record
before the code lands.

`generateFreePlayCandidates()` builds options for a player who **owns** the
ball. A first-time release is not that decision arriving early — it is a
structurally different decision, taken by a **different player** (the
receiver, not the passer), at a **different instant** (ball contact, not the
on-ball decision beat), about an option that only exists because the ball is
still moving. Folding it into the owner's list would mean building that list
at reception time for a non-owner, which the function does not support.

It also could not be done safely. `chooseCandidate()` draws exactly one
`decisionRandom()` value per candidate in list order, so adding options would
re-key every later draw in the possession and silently invalidate every
recorded replay.

So the first-time choice gets **its own seeded stream**, keyed by the same
`(seed, actionsCount)` pair under a distinct namespace:

```js
firstTimeRandom: seededRandom(hashString(`match-lab:freeplay:first-time:${seed}:${actionsCount}`))
```

This is not a new mechanism. `oneOnOneDecisionRandom` and
`oneOnOneKeeperResponseRandom` are already threaded through `availability`
exactly this way, for exactly this reason. The consequence that matters:
**when no first-time option exists, no draw is taken from any stream, and
every existing possession is bit-identical to today.** That is the property
the acceptance test has to pin down.

### How the release is resolved

A first-time ball is the *absence* of a control touch, so the reception must
not emit one: no `resolveReceive()` roll, no `P.RECEIVE.*` settling beat, and
no time passing between arrival and release.

Rather than recursing into `resolvePassInternal` (1,000 lines, with its own
offside ruling and target selection), the reception returns a
`forcedFirstTime` descriptor and the possession loop resolves the named
delivery on its next iteration **without generating or choosing candidates**.
No `decisionRandom()` draw is consumed for that action.

The receiver's `ownerId` is transiently set between those two trace events.
That is bookkeeping, not a control touch: no reception event is emitted and
no football time elapses, which are the observable properties that actually
define playing the ball first time.

### Scope of the first pass

`first-time-pass` and `layoff` only. Both reuse the existing pass-flight
machinery directly. `first-time-shot` needs the shot resolver and
`flick-on` needs the aerial/heading contest; both are modelled already in
`firstTimePlay.js` and are wired in a follow-up rather than half-built here.

### Delivered (2026-09-13)

Engine changes, all in `match-lab.js` except the cue:

- `maybeReleaseFirstTime()` — asked at the contact, before either reception
  branch. Emits `P.RECEIVE.FIRSTTIME` and returns a `forcedFirstTime`
  descriptor. Returns null, consuming nothing, whenever there is no option.
- The possession loop honours that descriptor on its next action with **no
  candidate generation and no `decisionRandom()` draw**, and only for the
  player who actually made the contact — so a descriptor riding a
  continuation into the next chunk can never fire on somebody else's ball.
- `availability.firstTimeRandom`, a stream of its own keyed exactly like the
  one-on-one streams beside it.
- The accuracy penalty multiplies the **existing** `resolvePassAccuracy`
  error term. No second accuracy model.
- `matchSound.js` maps the release to a strike for a struck ball and a touch
  for a cushioned layoff.

`tools/measure-possession-parity.mjs` — the A/B parity sweep the engine
roadmap's "migrate rather than rewrite" rule asks for. It hashes the full
trace of 40 fixed possessions so a single altered event shows as a changed
digest, and reports the release distribution.

`tools/test-first-time-integration.mjs` — 23 checks against the real engine.

### Measured

**Parity.** 11 of 40 possessions bit-identical; **every one of the other 29
contains a first-time release, and none changed without one.** That is the
property that matters: no unexplained drift anywhere in the engine.

**Cost.** 90-minute fixture **85.9s → 82.6s, a 3.8% speed-up.** A release
replaces a control touch's `resolveReceive()` roll and its off-ball
continuation with a lighter event, so first-time play is cheaper than the
settling touch it displaces rather than more expensive.

**Rate.** 55 releases across 40 possessions — about 12% of all actions.

### What the distribution says, and what it does not

| Split | Result |
| --- | --- |
| By kind | layoff 76%, first-time pass 24% |
| By pressure | free 58%, tight 42% |
| By third | middle 85%, final 7%, defensive 7% |

**The kind mix is wrong and is a real calibration finding.** Real football
plays far more first-time balls forward than it lays off. The cause is
structural rather than a bad constant: a layoff is cheap on every term the
model has — low lateral demand, low outgoing speed, ground height — so it
wins the score product most of the time it is available. Fixing it properly
means making the *value* of the onward ball part of the choice, not only its
difficulty; a layoff into no advantage should lose to a harder pass that
breaks a line.

**The other two splits are confounded and should not be read as findings.**
Every sampled possession starts from a home player's formation position, most
of which sit in the middle third, so "85% middle" largely restates where the
sweep starts. And both splits report *counts*, not rate per opportunity, so
"58% free" may only mean unpressured receptions are more common. Answering
either properly needs a denominator the harness does not yet collect.

The pressure bands also came back empty in the middle — `computePressure()`
returned either below 0.2 or above 0.5 and never between — which is worth a
look on its own.

### Stage 0 before/after — first-time play REDUCED tactical separation

This is the result the standing rule exists to catch, so it is reported first
rather than buried.

| Input | Before | After |
| --- | --- | --- |
| `attacking.style` | strong (d 0.897) | strong (d 0.954) |
| `attacking.tempo` | **strong** (d 0.825) | visible (d 0.748) |
| `attacking.directness` | **visible** (d 0.742) | weak (d 0.313) |
| role | weak (d -0.203) | **none** (d -0.321, p 0.51) |

Three of the four inputs got *less* visible. The cause is structural, and the
pattern of which inputs suffered points straight at it.

**A forced first-time delivery bypasses `generateFreePlayCandidates()`
entirely.** Roughly 12% of all actions are now chosen by
`firstTimePreference01()` instead — and that function reads style, tempo,
creativity and the shooting instruction, and **nothing else**. It does not
read directness. It does not read tactical role.

So the inputs that lost the most separation are exactly the inputs with no
path into the first-time decision, and the one input that held up (style) is
the one weighted most heavily inside it. That is not a coincidence; it is the
mechanism.

**First-time play currently routes around the tactical system.** The fix is
not a bigger constant. The first-time target choice needs to ride the same
utilities the owner's candidate list already uses, so that an instruction
reaching one decision reaches both. That is the first thing Stage 1c should
do, ahead of any new kinds.

### Still to do

- **Route the first-time target choice through the shared tactical
  utilities** (above). This is the highest-priority follow-up, because it is
  a measured regression rather than a missing feature.
- The kind-mix calibration: a layoff into no advantage should lose to a
  harder pass that breaks a line, which means the *value* of the onward ball
  has to enter the choice, not only its difficulty.
- `flick-on` and `first-time-shot`. Both are modelled and tested in
  `firstTimePlay.js`; neither is wired, because one needs the aerial contest
  and the other the shot resolver.
- A rate-per-opportunity denominator in the sweep.

### The original prompt

> Implement Realism Roadmap Stage 1b: wire the first-time play model into the
> reception pipeline.
>
> Read completely: `src/lib/firstTimePlay.js` and its tests, the whole
> `resolvePass` reception path in `match-lab.js` (`P.RECEIVE.CLEAN`,
> `P.RECEIVE.ADVANCE`, `P.RECEIVE.LATE`, `P.RECEIVE.HEAVY`, `P.RECEIVE.LOSE`
> and the bounce continuation), `runConstructedPossession`'s action loop,
> `generateFreePlayCandidates`, `buildMatchLabPlaybackPlan`'s
> `contactArrivalTiming` handling, `src/lib/matchSound.js`, and the
> possession-runner, contact-continuity and timeline-playback suites.
>
> A first-time release is not a fast control touch. It is the **absence** of a
> control touch: the ball never becomes owned, the contact happens at the
> arrival point at arrival time, and the outgoing flight starts from the
> incoming ball's own velocity. Model it that way rather than as a
> zero-duration reception followed by a normal pass.
>
> This stage changes RNG ordering and must say exactly how. Adding options to
> a candidate list re-keys every later `decisionRandom()` draw — the standing
> rules already warn about this. Decide deliberately whether the first-time
> choice is a new candidate inside the existing list or a separate decision
> resolved before the list is built, state the reasoning, and prove the
> chosen contract with a test that would fail if the draw order drifted.
>
> Requirements: preserve every existing reception outcome when no first-time
> option is taken; keep `worldMotion` the only author of movement; keep the
> playback plan's reception-timing contract intact (`action: "receive-pass"`
> plus `contact.phase: "start"` has a dedicated kinetics path that a naive
> new event shape will silently defeat); and add the sound cues for the new
> contacts rather than letting them fall through to the generic kick beat.
>
> **Explicitly out of scope:** role personality, pattern work, backheels,
> dummies, deliberate let-it-run, and any renderer change beyond the new cues.
>
> Measure with Stage 0 before and after. Report the first-time share of all
> releases, by pitch third and by pressure band, against the real-football
> expectation that it is substantial in build-up and the final third and rare
> under no pressure in midfield. Report the cost delta on the 90-minute
> fixture.
>
> Add deterministic tests proving a first-time release never takes ownership,
> that outgoing flight inherits incoming velocity, that the no-option path is
> byte-identical to today's reception, that replay stays deterministic, and
> that the possession-runner, contact-continuity, pass-flight, timeline and
> replay suites remain green.
>
> Finish by reporting files changed, the RNG contract decision and its
> reasoning, before/after Stage 0 separation, the first-time share
> distribution, cost delta, test results, and remaining risks.

---

## Stage 1c — First-time target choice through the shared utilities (built)

> Fix the regression Stage 1b's own measurement found: a forced first-time
> delivery bypasses `generateFreePlayCandidates()`, so roughly an eighth of
> all actions are chosen by a parallel preference function that reads four
> tactical inputs and ignores the rest.
>
> Do not widen `firstTimePreference01()` to cover the missing inputs. That
> builds the second tactical system properly instead of removing it, and it
> has to be kept in sync by hand forever after. Make the shared utilities
> decide **which target**, and leave the first-time model deciding only what
> it uniquely knows: whether the contact is physically makeable, whether this
> player can make it, and whether they want to release at all.
>
> Measure with Stage 0 before and after, and report what actually moved.

### Delivered (2026-09-14)

`maybeReleaseFirstTime()` now builds a synthetic `groups` with the receiver on
the ball at the contact point — the passer included as a teammate, which is
what makes a genuine one-two available — and ranks every first-time target
through `generateFreePlayCandidates()`.

Three decisions worth recording:

**Rank, not raw utility.** The utilities are retuned regularly and their
absolute scale is not a contract. "Did the tactical system rate this target
above the alternatives" survives any retuning, which is the entire point of
not having a second system.

**A target the shared system never offered is refused outright,** rather than
floored. Those are different statements: `FIRST_TIME_TACTICAL_FLOOR` keeps a
low-ranked but genuinely offered option unlikely instead of impossible, while
a target the tactics never put forward is simply not a ball they want played.

**No joint candidate generation.** A joint meeting point times a runner onto
a ball; a first-time release is struck now, from a contact already happening.
There is nothing to time, and skipping it keeps the cost off the hot path.

`engagementHistory` and `congestionTracker` are threaded through
`availability` so the first-time ranking sees the same anti-pass-loop history
the owner's own decision does — without them it could have rebuilt the
low-value loop that logic exists to prevent.

### Measured

| Input | Baseline | After 1b | After 1c |
| --- | --- | --- | --- |
| `attacking.tempo` | strong 0.825 | **visible 0.748** | **strong 1.064** |
| `attacking.style` | strong 0.897 | strong 0.954 | strong 0.855 |
| `attacking.directness` | visible 0.742 | weak 0.313 | none 0.288 |
| role | weak -0.203 | none -0.321 | none -0.286 |

**Tempo is fixed and then some** — past its own pre-first-time baseline.
Style held strong throughout. Release mix also improved: layoff share fell
from 76% to 63% as the tactical ranking pulled choices toward forward passes.

**Directness never had a solid verdict to lose.** Tracking its two metrics
across all three sweeps makes that plain:

| Sweep | `meanShotDistanceYards` | `meanPassDistanceYards` |
| --- | --- | --- |
| baseline | d 0.742, p 0.030 | d 0.338, p 0.041 |
| after 1b | d 0.061, p 0.844 | d 0.264, p 0.090 |
| after 1c | d 0.207, p 0.447 | d 0.288, p 0.059 |

The pass-distance effect is stable at 0.26–0.34 across every sweep. The shot
metric swings 0.742 → 0.061 → 0.207 for the same input, which is not an
effect changing — it is a metric with ten shots per arm reporting noise. The
original "visible" verdict rested entirely on that column, and the Stage 0
delivery note flagged the shot-poverty limitation at the time.

So the honest reading is that directness sits at the weak/none boundary and
has done all along; it neither regressed at 1b nor recovered at 1c.

**Role is untouched, as expected.** Nothing in Stage 1c addresses a role
implemented as a constant positional offset. That is Stage 2's job.

### Harness change this forced, and the new baseline

The Stage 0 sweep now alternates build-up and advanced starting pictures
(`ADVANCE_SHIFT_PERCENT`, both sides shifted together so the defensive
structure stays coherent), because a third of the metric set was untrustworthy
without it. Shots roughly doubled, from 0.10–0.28 per possession to 0.21–0.51.

**The two sampling schemes are not comparable to each other.** The three-way
table above is internally consistent — baseline, after 1b and after 1c all ran
the old sampling — but nothing from it should be set beside a number measured
after 2026-09-14. Any earlier verdict resting on `shotsSelected` or
`meanShotDistanceYards` is void rather than merely uncertain.

New baseline, advanced sampling, 80 possessions per arm:

| Input | Verdict | Strongest metric | d | p |
| --- | --- | --- | ---: | ---: |
| `attacking.tempo` | **strong** | pass share | 0.920 | <0.0001 |
| `attacking.style` | **visible** | longest pass | 0.560 | <0.0001 |
| `attacking.directness` | **none** | legal passing options | -0.247 | 0.0642 |
| role | **none** | shots selected | -0.188 | 0.1244 |

Style reads lower here than under the old sampling. That is the sampling
changing, not the engine: an advanced starting picture gives long-ball and
possession less room to differ in longest-pass terms. It is a more honest
number, not a worse one.

**Directness is now a trustworthy `none`.** That is a genuine, newly
well-founded finding and a candidate for its own stage: an instruction with
five settings that a player cannot see is worth as much as one that does not
exist.

---

## Directness v2 — an instruction with no surface area (built 2026-09-14)

Not originally a stage. Stage 1c's measurement turned directness from a noisy
verdict into a trustworthy `none`, which made it worth diagnosing properly.

### The diagnosis

`directness` had exactly one real mechanism: `skippedSimplePenalty()`, which
fires only on a punt, an own-half through ball, or a pass of **35 yards or
more**. `tools/report-pass-delivery-mix.mjs` measured how often that is —
**8 of 359 sampled passes**, about 2%.

The instruction was never mis-tuned. It had no surface area. No amount of
adjusting `DIRECTNESS_SKIP_PENALTY` could have made a five-setting control
visible when its only mechanism reaches one decision in fifty.

### The fix

Every progression utility already computes `progressionYards()`. Directness now
scales that existing term, so it reaches every pass, cross, through ball and
carry rather than the long ones alone. This is not a new mechanic layered on
top — it is the instruction finally reaching the quantity it was always about.

`DIRECTNESS_PROGRESSION_WEIGHT` is **centred on directness 2**, because that is
`DEFAULT_TEAM_ATTACKING.directness`. A default side's arithmetic is unchanged,
so every tuned default and every recorded replay that never touched the
Attacking UI keeps its exact behaviour. The parity sweep confirms this
end-to-end: the overall digest is byte-identical across the change.

Because the progression term is signed, this cuts both ways by construction,
which is the football of it — a patient side is content to go backwards and
rates the same twenty yards lower; a direct side hates going backwards and
rates them higher.

### Measured

`attacking.directness` 1 vs 5: **none → visible**, and on four metrics that
agree with one another rather than one that happened to move.

| Metric | direct (5) | patient (1) | d | p |
| --- | ---: | ---: | ---: | ---: |
| pass share | 0.701 | 0.773 | -0.600 | 0.0002 |
| shots selected | 0.450 | 0.175 | 0.513 | 0.0008 |
| carry share | 0.041 | 0.017 | 0.459 | 0.0010 |
| pressure at decision | 0.325 | 0.280 | 0.400 | 0.0065 |

A direct side passes less, carries more, shoots two and a half times as often
and decides under more pressure because it is further up the pitch. That is a
coherent picture, and several agreeing metrics is much stronger evidence than
a single one.

`npm run test:directness-progression` — 28 assertions.

---

## Current Stage 0 baseline (2026-09-14, advanced sampling)

80 possessions per arm. **Comparable only with other post-2026-09-14 sweeps.**

| Input | Verdict |
| --- | --- |
| `attacking.tempo` | **strong** |
| `attacking.directness` | **visible** |
| `attacking.style` | **visible** |
| `attacking.dribbling` | weak |
| `attacking.shooting` | **none** |
| `attacking.passIntoSpace` | **none** |
| `marking.pressing` | **none** |
| role | **none** |

Four of eight reach at least `weak`. `marking.pressing` reads `none` here
where the old sampling gave `weak`; both sides shift together in the advanced
picture, so the pressing contrast has less room to express itself. That is the
sampling changing, not the engine.

The four `none` rows are now the work queue, and Directness v2 is the worked
example of how to approach them: **measure the mechanism's surface area before
touching its constants.** An instruction that reaches 2% of decisions is not a
tuning problem.

---

## Keeper Depth v2 (built 2026-09-14) — and an open diagnosis

Reported off a browser round: *"unnecessary rushing out leaves the goal open"*
and *"he is not on his line"* even while the trace says he holds it.

`tools/diagnose-keeper-and-stillness.mjs` measures it. Sampled over ~7,700
frames, split by how far the ball is from the keeper's **own** goal — an
aggregate over both keepers hides the question, because a keeper whose team is
attacking *should* be sweeping high:

| Ball from own goal | keeper off his line | beyond 12yd |
| --- | ---: | ---: |
| inside 18yd (under threat) | 6.0 | 22% |
| **18–35yd (shot range)** | **11.0** | **49%** |
| 35–60yd (midfield) | 8.1 | 13% |
| 60yd+ (team attacking) | 9.8 | 12% |

### What was fixed

**The depth curve had the wrong shape.** `advance = clamp(2, 12, distance *
0.15)` is monotonic in ball distance, and real keeper depth is not: out to
narrow a one-on-one, *home* for a twenty-yard shot, out again to sweep. The
old formula left a keeper three yards off his line against a one-on-one and
twelve yards off it whenever the ball was merely far away. It is now a curve
through those three regimes.

**Sweep depth is now a property of the block, not the ball.** This is the
"team height" idea applied where it was cheapest: depth is capped against the
keeper's own deepest outfielder, so a deep block pins him to his line and a
high line is what buys the room to sweep. `goalkeeperSweeping` scales it.

**The sweep gate allowed a negative required margin.** `margin > 0.15 -
boldness * 0.3` evaluates to **-0.135** for an elite keeper — he would leave
his line for a ball the attacker reaches *first*. The requirement is now
positive at every boldness and is charged for depth, because a sweep thirty
yards out is a different bet from one on the six-yard line.

`npm run test:keeper-depth` — 22 assertions.

One existing assertion in `test-keeper-awareness.mjs` moved its constant from
12.01 to 15.01 yards. The assertion's intent — a realistic cap, no wandering
into midfield — is unchanged; the number was tuned to the linear formula that
no longer exists.

### What is NOT fixed, and an honest caveat about the measurement

The engine **asks** for the right position and the keeper does not get there.
Instrumented against what `keeperPositioningPoint()` returns at the same
instant: with the ball 18–35 yards out the engine asks for **4.1** yards and
the keeper is at **11.0**.

Two hypotheses were tested and both were wrong: the sweep gate (sweeps only
fell 46 → 44 and the median did not move) and the 0.22 attacker approach
fraction (identical output — that code path does not run in these
possessions). A change to the keeper's approach fraction was written and then
**reverted**, because it could not be shown to do anything.

**Caveat on the gap itself.** The diagnostic computes the "asked" position
from the ball's position *at that rendered frame*, while the engine computes
it at decision time. During a long pass flight those differ, so some of the
seven-yard gap is the measurement rather than the engine. The gap should be
re-measured against the target the engine actually held before anyone tunes
against it.

---

## Off-ball stillness — diagnosed, not fixed (2026-09-14)

Reported as *"players freeze except the ball chaser"*.
`tools/diagnose-off-ball-stillness.mjs` separates the two possible causes.

**It is not the job assignment.** The engine authors 2–4 yards of movement per
off-ball job and only **10.2%** of authored moves go nowhere. Players are
being given somewhere to go.

**It is who gets a move at all, and when.** Rendered stillness runs to a
**24.7-second** continuous freeze, with 27% of still stretches lasting a second
or more and 5% over three seconds. And the freezes are not random:

| | mean distance from ball |
| --- | ---: |
| freezes of 2s or more | **36.6 yd** |
| pauses under 1s | 27.2 yd |

By position, 2s+ freezes: **DC 96**, FC 56, DR 46, ML 37, MR 36, MC 36, DL 31.

So players far from the ball freeze, and the back line freezes most. The
likely mechanism is that a shape target is quantised by ball **zone**: a
player whose ball-zone has not changed has a static target and no reason to
move until the ball crosses a boundary.

**Team height was the hypothesised fix and it did not work.** Measured before
and after, stillness was unchanged (1s+ 27% → 31%, total still time 3249s →
3611s). The reason is now obvious in hindsight: at the default height the
correction sits inside its deadband, so by design it does nothing to a default
side. A fix has to make the *target itself* continuous in the ball's position,
which is a change to `phaseAdjustedShapeTarget`'s zone quantisation, not
another instruction layered on top.

---

## Team height (built 2026-09-14)

Requested directly: *"declare a team height, the length from the last
outfielder behind to the outfielder at the top"*, settable by the manager.

`TEAM_HEIGHTS` is `compact` / `balanced` / `stretched`, sitting beside `width`
in the attacking instructions and exposed on the tactics board as **Team
height** for each side.

`applyTeamHeight()` in `teamShape.js` runs once per team after every
individual target is known — it cannot live beside `width` in
`applyTeamShapeInstructions()`, because width scales about a fixed pitch
reference while height is measured against the squad itself.

Three things learned building it:

**Squeeze by unit, not by individual.** Scaling each player's own depth
multiplies the gap between two players who merely differ by a yard, so a back
four stops being a line. `test-team-shape.mjs`'s "controller and member keep
one line depth" check caught exactly this. Corrections are now computed per
band, so lines keep their own shape and the units move relative to each other.

**Not during restarts.** A kickoff cluster is authored deliberately and is not
a block that has drifted. Correcting it broke the authored opening.

**Calibrate against the engine, not a textbook.** The measured natural block
here is ~50 yards across all phases, not the 30–40 metres quoted for a settled
defensive block — that figure describes one phase. `balanced` is therefore set
*at* the natural length, so a manager who never touches the control changes
nothing, and the other two settings span a range the block can actually reach.

### Measured, 30 possessions per arm

| Height | target | median block | yards covered per player |
| --- | ---: | ---: | ---: |
| compact | 40 | 49.1 | 54.9 |
| balanced | 50 | 52.5 | 55.0 |
| stretched | 62 | 55.8 | **66.8** |

**Claim 1 — the declared height governs the block length: holds.**

**Claim 2 — height costs stamina: holds in one direction only.** Stretching
costs **21.7% more ground per player**, which flows straight into drain
because `motionEffort.js` already prices distance actually covered — the cost
emerges from the movement rather than being asserted. But **compacting does
not save anything** (54.9 against balanced's 55.0). The original expectation
was that a compact side moving together would spend less; measured, holding a
block tighter than its natural shape takes about as much work as the shape
costs anyway. Worth knowing before anyone tunes on the assumption.

---

## Team height — original design notes

Requested directly, and the right organising idea for several symptoms at
once: **declare a team's height — the distance from the deepest outfielder to
the highest — and make the side hold it.**

Why it is worth doing properly rather than as another offset:

- **It is how real teams stay compact.** A block with a declared height moves
  as one unit; gaps that open get closed because closing them is what holding
  the height means.
- **It prices stamina honestly.** A low height means the team moves together
  and covers less ground individually. A high one means large gaps, and
  players spending real distance closing them — which `motionEffort.js`
  already converts into genuine drain. The instruction would then cost
  something, which is what makes it a decision rather than a free choice.
- **It subsumes the keeper fix above.** Keeper Depth v2 caps sweeping against
  the deepest defender; that is team height applied to one player. The general
  form replaces the special case.
- **It is a candidate answer to "players freeze except the ball chaser".**
  Measured, 12.9 of 20 outfielders are in motion during live play — about a
  third standing still at any instant. A team holding a height has a reason to
  move when the ball moves, whether or not it is near them.

Open design questions to settle before building: whether height is authored
(a slider) or derived from the existing defensive-line and engagement-line
instructions; whether it is a target with a tolerance band or a hard
constraint; and how it interacts with `teamShape.js`'s existing
`defensiveLineHeightYards`, which already measures the thing.

---

## Stage 2 — Role personality (planned)

> Implement Realism Roadmap Stage 2: give the 57 tactical roles a decision
> personality.
>
> Read completely: `roleOffsets()` in `src/lib/teamShape.js`,
> `src/lib/matchSetup.js` (`TACTICAL_ROLES`, `TACTICAL_ROLES_BY_POSITION`),
> `generateFreePlayCandidates` and the utility terms in
> `src/lib/spatialDecision.js`, `src/lib/teamInstructions.js`,
> `src/lib/roleOccupancyMap.js`, and `src/lib/influenceAudit.js`.
>
> A tactical role is currently one constant `{x, y}` yard offset and nothing
> else. Two AMC roles that a manager would consider completely different
> players — `attacking-midfielder` and `trequartista` — return identical
> offsets and are therefore the same footballer in every respect the engine
> can express.
>
> Give each role a small, declared vector of decision biases riding on the
> existing utility plumbing: release latency, risk appetite, carry-versus-
> pass, shot-distance threshold, preferred run type, receiving orientation,
> and defensive aggression. Do not add a parallel decision system; these are
> terms in the utilities that already exist.
>
> The hard part is magnitude, not wiring. The observation backlog already
> warns that instruction biases are small additive terms that base utility,
> geometry, pressure and seeded noise may overwhelm. The Stage 0 baseline
> puts a number on it: `regista` versus `ball-winning-midfielder` currently
> separates at `d = -0.203` on one metric at `p = 0.0442` — the weakest of
> the eight inputs measured, and barely distinguishable from no effect at
> all. **Tune against Stage 0 until the separation verdict for role is at
> least `visible`** on the metrics the role claims to change, and report the
> verdicts you reached rather than asserting the feature works.
>
> For calibration, `attacking.style` and `attacking.tempo` already reach
> `strong` (d = 0.897 and 0.825). Those are what a working input looks like
> on this instrument.
>
> A role whose biases cannot be made visible without distorting play is a
> finding worth reporting, not a failure to hide. Say which roles those are.
>
> **Explicitly out of scope:** new roles, the role editor UI, positioning
> offsets (they already exist and are not the problem), and pattern gating.

---

## Stage 3 — Coordination families into complete patterns (planned)

> Implement Realism Roadmap Stage 3: complete the coordination families.
>
> Read completely: `src/lib/coordinationCoordinator.js`,
> `src/lib/actionPatternSchema.js`, `src/lib/actionPatternRegistry.js`,
> `MATCH_ENGINE_OBSERVATION_BACKLOG.md` Findings 1 and 2 and Proposal 2,
> `FOOTAGE_ANALYSIS_BATCH_01.md`, and `src/lib/teamShape.js`.
>
> `coordinationCoordinator.js` introduced eleven families. A family is not yet
> a pattern: the backlog's worked example is that a complete overlap needs the
> winger holding or moving inside, the full-back timing the run, the carrier
> re-reading the lane, **a midfielder covering the vacated position**, and
> every participant continuing, checking or aborting as the picture changes.
> The cover behaviour is the part that makes an overlap read as an overlap
> rather than as one player running forward.
>
> Add persistent phases, commitment, branching, abort and re-evaluation to
> the families. Gate family eligibility on tactical role, duty and team
> instruction so that tactics decide which patterns are even attempted —
> Finding 1 records that the shipped fragments have almost no such
> dependence, which is why V1-V10 are imperceptible.
>
> Measure with Stage 0. A pattern that never activates, or that activates
> identically under opposite instructions, has not been delivered.

---

## Stage 4a — Facing as independent state (planned)

> Implement Realism Roadmap Stage 4a: separate facing from velocity.
>
> Read completely: `src/lib/worldMotion.js` (`facingFromVelocity`,
> `createMotionRecord`, `writeMotionRecord`, `advanceMotion`),
> `src/lib/playerKinetics.js` (`turnRetention`), and the vision-cone helpers
> in `match-lab.js`.
>
> `facingFromVelocity()` derives facing from the direction of travel and
> returns null when standing still. A player therefore cannot backpedal,
> shield, or receive half-turned, and cannot be caught facing the wrong way —
> which removes a real and important defensive weakness from the game.
>
> Make facing its own state with its own turn rate, advanced by
> `worldMotion` alongside position. Feed it from intention (where the player
> wants to look) constrained by physical turn rate, not from velocity.
> Velocity-derived facing becomes the fallback for the case where there is no
> separate intent.
>
> This is a gameplay change before it is a visual one: once facing is real,
> it belongs in reception quality, first-time feasibility (Stage 1a already
> takes a body-orientation term), pressing angles and beaten-defender checks.
> Open those consumers deliberately and one at a time, each with its own
> measurement, the way Stage 5b opened condition into locomotion.

---

## Stage 4b — Gait and orientation readout (planned)

> Implement Realism Roadmap Stage 4b: render what the engine already knows.
>
> The kinematics layer already distinguishes walking, jogging, running,
> sprinting, braking, turning and planting — `topSpeed`, `speedAtElapsed`,
> `brakingSeconds`, `turnRetention` and the gait-dependent touch thresholds
> are all live and none of it reaches the screen. Players are direction-less
> circles.
>
> Derive a gait state and a facing indicator **entirely from existing engine
> state** and render them. No new engine quantity, no renderer-authored
> motion. The acceptance question is whether a viewer can tell a sprint from
> a jog, and a player receiving half-turned from one receiving square, with
> the sound off and no labels.

---

## Stage 5 — Action variety beyond the core seven (planned)

> Implement Realism Roadmap Stage 5: widen the on-ball vocabulary.
>
> Pass type is currently an **output of geometry**: `passTypeFor()` picks
> ground, driven-ground, driven-aerial or lofted from distance, obstruction
> and power. The player has no say. Real players choose weight and flight and
> disguise, constrained by geometry rather than dictated by it.
>
> Invert that: geometry constrains the legal set, the player chooses from it,
> and attributes decide how well the choice executes. Then add the receiving
> vocabulary (set, half-turn, shield, deliberate let-it-run) and the
> defensive vocabulary (block, shepherd, interception step, the deliberate
> foul).
>
> This stage multiplies the branching factor more than any other on this
> list. Report the cost delta on the 90-minute fixture prominently, and do
> not start it before the engine extraction in the gameplay roadmap has
> landed.
