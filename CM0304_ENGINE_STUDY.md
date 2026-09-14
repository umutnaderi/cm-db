# CM 03/04 match engine — a study

**Date:** 2026-09-14
**Purpose:** understand how Championship Manager 03/04's match engine was
built, and identify what transfers to ours.
**Reproduce with:** `npm run study:cm0304`

Nothing from CM is copied into this project. This reads an installed copy,
decodes the numeric model, and reports the *shape* of the design so ours can be
argued about against a known reference. The engine we ship stays original.

## Provenance, stated plainly

The copy on this machine is a cracked build — `deviance.nfo` in the install
directory, a `cm0304.exe` redated 2016, and a warez-site shortcut. That is
worth naming because it changes the legal footing from what was assumed:
studying a **lawfully acquired** copy is a much stronger position than studying
this one, and a legitimate copy is cheap to obtain. The DRM question is moot in
one direction at least — SafeDisc is already absent, so nothing here
circumvents a protection measure.

The activity itself — reading shipped data files to learn how a 22-year-old
engine was designed, in order to build an original one — is the ordinary
reverse-engineering-for-study case and is not the risky part.

## Method

Data-first, not binary-first. `cm0304.exe` is one monolithic MSVC-optimised x86
image with inlined STL, and extracting algorithms from it is a
disproportionate amount of work for what it would return.

The lookup tables and event config **are** the design, sitting in plain files:
they say exactly what the engine treated as primitive enough to precompute, and
exactly what actions it could express. That is the transferable part. Three
sources were used:

1. `data/tables/*.mdt` — eight precomputed tables, fully decoded and verified.
2. `data/match events/events.cfg` — 727 events, the complete action vocabulary.
3. Diagnostic strings in `cm0304.exe` — 333 surviving `CLASS::method()` names.

---

## 1. The numeric model: integer throughout

Every `.mdt` file shares a 12-byte header (UTF-16 `.mdt` tag plus a version
byte); the body is little-endian `int32` unless noted.

| Table | Decoded | Verified |
| --- | --- | --- |
| `direction_table` | 360 entries of (sin, cos) × **16384** (Q14), 1° steps | max error 1 |
| `speed_direction_table` | the same at × **1024** (Q10) | ✓ |
| `si_sqrt_table` | integer `sqrt(0..49999)` → 0..223 | exact |
| `distance_angle_table` | polar → cartesian, 360 angles × 100 radii | `[45°, r50] = (35,35)` |
| `distance_lookup_table` | 400×300 grid centred (200,150), distance stored **×10** | corner = `hypot(200,150)` → 2500 ✓ |
| `angle_lookup_table` | same grid, `atan2(dy,dx)` in whole degrees, 0..359 | corner = 217° ✓ |
| `ball_at_feet_offsets` | 3600 values, ±19, ball offset from the player's centre | partially decoded |

**The headline: there are no floats.** Trig is a Q14 fixed-point table, square
roots are a lookup, polar conversion is a lookup, and even distance carries one
decimal place by being stored ten times too big. The hot path is integer
arithmetic and array indexing.

**Angular resolution is one degree.** 360 discrete directions was judged enough
for football. We use continuous `atan2` in double precision.

**Local geometry is precomputed, pitch geometry is not.** The grid spans
±200 × ±150 units and `distance_angle_table` only reaches radius 99. These are
*neighbourhood* lookups — who is near whom, where does a short ball go — not
pitch-scale ones. The engine optimised the thing it did tens of thousands of
times per match.

---

## 2. Architecture, from surviving symbols

333 `CLASS::method()` strings survive in diagnostics. The match engine's own:

| Class | What the strings show it owns |
| --- | --- |
| `MATCH` | loads all eight tables (`MATCH::direction_table()` etc.), `process_tactical_change()`, `pack()` |
| `MATCH_BALL` | `plot_bounce()`, `set_coords_to_ball_player()` |
| `MATCH_PLAYER` | `action()` — *"No decision found"* |
| `MATCH_CONTROLLER` | `play_one_match_update()`, `receive_server_match_seeds()` |
| `MATCH_SESSION` | `play_match_to_time()`, `calculate_incidents()`, `show_match_seeds_error()` |
| `MATCH_EVENT_HANDLER` | reads `events.cfg` |
| `TACTICS_INFO`, `MATCH_MANAGER` | `load_tactics()`, selected player |

### The determinism discipline — the most useful thing here

Three separate diagnostics exist purely to catch divergence:

```
MATCH_CONTROLLER::play_one_match_update() - match has diverged at time <n> to random index <n> (was <n>)
MATCH_SESSION::play_match_to_time() - time <n>, new final random index (<n>) differs to old (<n>)
MATCH_SESSION::show_match_seeds_error() - match after tactics change differs to match before
```

CM tracked **the RNG draw index** as its divergence signal, and specifically
verified that *a match replayed after a tactics change matches the original up
to that point*.

That is precisely the invariant our own standing rules state in prose —
*"`chooseCandidate()` draws exactly one `decisionRandom()` value per candidate
in list order, so changing the length or order of a candidate list silently
re-keys every later draw"* — and precisely the risk Stage 1b had to reason about
by hand. CM shipped it as a runtime assertion. We check it with a parity sweep
after the fact; they caught it live, with the draw index as the checksum.

---

## 3. The action vocabulary: 727 events, and it is factored

`events.cfg` holds 727 events across 169 families. The largest:

| Family | Count |
| --- | ---: |
| `PASS` | **130** |
| `SHOT` | **79** |
| `PLAYER` | 40 |
| `LONG` | 29 |
| `CROSS` | 26 |
| `FOUL` | 25 |

### Passing is a product, not a list

112 of the 130 pass events are exactly:

```
flight(4)  x  direction(7)  x  first-time(2)  x  into-path(2)
CHIP                FORWARD              yes/no          yes/no
LOB                 LEFT / RIGHT
SHORT               LEFT_WING / RIGHT_WING
MEDIUM              BACK
                    INTO_AREA
```

The remaining 18 are genuine special cases: `PASS_NO_DESTINATION_PLAYER_*`
(seven of them), `PASS_BACK_TO_KEEPER`, `PASS_TO_RUN_ONTO_LOW/HIGH`,
`PASS_BALL_DOWN_LINE`, and weather variants.

Two of those four axes we already have — flight type and to-feet-versus-into-
space (`deliveryIntent`) — and first-time landed in Stage 1b. **The axis we do
not have is direction**, and it is the interesting one: CM's passes are
described *relative to the passer*, with `INTO_AREA` and the two wing channels
as first-class destinations rather than "whichever teammate scored highest".

`PASS_NO_DESTINATION_PLAYER_*` is the sharpest single difference. CM could play
a ball **with no intended receiver at all** — seven directional variants of it.
Our `resolvePass` always selects a teammate first.

### Shooting is also a product

Technique × situation × foot:

- technique: `LOW_DRIVE`, `HIGH_DRIVE`, `CHIP`, `LOB`, `BANANA` (curled),
  `VOLLEY`, `HALF_VOLLEY`, `BICYCLE_KICK`, `HEADER`, `DIVING_HEADER`,
  `FREE_KICK`, and `HOPE` — a hopeful effort, which is a *decision quality*
  encoded as a technique
- situation: plain, `FROM_DISTANCE`, `FROM_ANGLE`
- foot: `LEFT_FOOT` / `RIGHT_FOOT` variants on the drives and volleys

Plus a full outcome vocabulary — `CLIPS_POST`, `HITS_BAR_IN`, `JUST_WIDE`,
`WELL_OVER_HEADER`, `DEFLECTED_WIDE`.

### Pitch and weather cut across everything

`TURN_WET`, `TURN_ICY`, `TURN_OPPONENT_MUDDY`, `BALL_GOES_LOOSE_WATERLOGGED`,
`GOALIE_SPILLS_BALL_WET`, `PASS_MEDIUM_BACK_MUDDY`, `SHOT_LOB_WIND`,
`SHOT_WELL_WIDE_WIND`.

Conditions are not a global modifier bolted on — they appear as **distinct
events for the actions they actually change**: turning, controlling, keeper
handling, loose balls, and ball flight. We have no pitch or weather model.

---

## 4. What transfers, in priority order

**1. An RNG draw-index checksum.** The cheapest and highest-value idea here.
Count draws per stream per action and carry the count in the trace; a replay
that reaches a different count at the same match time has diverged, and says so
immediately instead of being caught by a later parity sweep. This would have
made the Stage 1b RNG-contract question a test rather than an argument.

**2. Direction as a pass axis, and passes with no receiver.** Our
`generateFreePlayCandidates` enumerates *teammates*. CM enumerated *directions*,
with `INTO_AREA` and the wing channels as destinations in their own right. That
is a structural answer to the Stage 5 "action variety" problem, and
`PASS_NO_DESTINATION_PLAYER_*` is a genuinely missing action — clearing your
lines, switching play into a channel, putting it into the corner.

**3. The ball is not at the player's point.** `ball_at_feet_offsets` and
`MATCH_BALL::set_coords_to_ball_player()` show the ball carried at a real
offset from the carrier's centre, by facing. We place it on the player's own
coordinate. An offset ball changes tackling reach, shielding and first-contact
geometry — and it pairs directly with Stage 4a, which is about giving facing
independent existence.

**4. Factor the action space instead of listing it.** 130 pass events from
four small axes. Our seven verbs are a list. Factoring is what makes a
vocabulary both large and tunable, because each axis can be reasoned about and
measured on its own.

**5. Pitch condition as a cross-cutting modifier.** Cheap to add against the
existing accuracy and control models, and it changes what a match *feels* like
more than another coordination family would.

**Not recommended: going fixed-point.** CM's integer model bought bit-exact
determinism across machines, which mattered because they verified matches
against a server. We have no such requirement, and the cost — rewriting every
physics module — is enormous. The lesson to take is the *discipline* (one
degree is enough; precompute what you do ten thousand times a match), not the
representation.

---

## 5. What I could not establish

- **The unit scale.** Ball-at-feet offsets of 14–19 units suggest roughly
  2.5–3 cm per unit, which would make the 400×300 grid about a 10×8 m
  neighbourhood. That is inference from one anchor, not a measurement.
- **`ball_at_feet_offsets` indexing.** 3600 values in five bands of 360 pairs,
  radii 14–19, but the band and angle ordering did not fall out cleanly.
- **The per-event parameter rows.** Each event carries `= <id>, 0, 0, ...` and
  one or more `> <a>, <b>` variant headers. The first number is an event id;
  the rest are undetermined.
- **Any actual algorithm.** Nothing here recovers how CM *decided* anything —
  only what it could express and what it precomputed. The decision model is in
  the binary and would need real decompilation.
