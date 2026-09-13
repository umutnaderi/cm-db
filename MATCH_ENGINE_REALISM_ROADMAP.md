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
| 1b | First-time play engine integration | Next |
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

## Stage 1b — First-time play engine integration (next)

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
