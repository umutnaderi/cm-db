# Dribble pace correction (2026-09-07)

The slowdown was in the authored simulation. High Dribbling/Technique made
the ball touches short and soft, but the impulse did not account for the
runner's existing speed. The contact search required substantial separation
and used an absolute, endpoint-clamped gap. It could miss a running touch and
wait for the roll to stop. The carrier was then paced across that long window,
while the reported exit velocity still claimed full running speed. Defenders
used their own normal locomotion over the entire enlarged window.

Two further losses of speed occurred between carries: the runner's actual
outgoing velocity was not committed for the next carry, and a fixed minimum
duration plus stopping at the final leg made the runner linger. These are
fixed without changing defender Pace, player-specific probabilities, or CSS.

## What changed

- `src/lib/playerKinetics.js`: `runningTouchLaunchSpeedYps()` derives a running
  touch from gait/control spacing, incoming speed, the existing arrival
  kinetics and shared roll friction. Error modifies the added forward impulse,
  not the speed already carried by the player.
- `src/lib/spatialDecision.js`: find the first positive-time ball/body meeting
  using signed distance and the same accelerating trajectory. Close running
  touches need no arbitrary 0.6-yard separation. Carry motion is no longer
  stretched to wait for a soft ball; turn retention and actual exit speed agree.
- `match-lab.js`: preserve momentum across carry actions, remove fixed-duration
  final-leg delays, integrate steering legs through worldMotion, and finish at
  an executed overshoot instead of reversing to an old tactical coordinate.
  Two reception paths exposed by changed geometry now author body travel
  during the flight and keep foot reach separate from body displacement.
- `tools/test-dribble-pace.mjs`, `tools/measure-dribble-pace.mjs`, `package.json`:
  repeatable pace, contact, turn, momentum and authored-pursuit checks.
  Existing keeper/reception tests retain their physical assertions while
  following the new event ordering and a seed that still exercises a dive.

## Reproduction and measurements

The screenshots show Anderson Pace 17, Dribbling 20, Technique 19 and Sensini
Pace 12. Acceleration is not shown. This controlled reproduction holds it equal
at 15; it does not claim to recover the exact screenshot scenario or hidden
attributes. The player's speed ceilings remain 9.63 and 8.68 yards/second.

| Measurement | Before | After |
| --- | --- | --- |
| Anderson: same 24-yard authored carry | 6.300 s | 3.344 s |
| Sensini's initial gap | 6 yd | 6 yd |
| Sensini's final gap | 1.50 yd | 9.39 yd |
| Anderson late close-control touch speed | 2.40 yd/s | 9.58 yd/s |
| Anderson late controlled-sprint touch speed | 2.89 yd/s | 9.60 yd/s |
| Anderson late full-sprint touch speed | 3.74 yd/s | 9.61 yd/s |

These speeds come from distance actually covered over elapsed time, not the
velocity label. A placed defender still gets a real poke opportunity, and a
sharp turn still loses momentum. Pace advantage is not guaranteed immunity:
starting position, acceleration, direction, pressure and ball control matter.

Reproduce with `npm run test:dribble-pace`, `npm run measure:dribble-pace --
--baseline`, and `npm run measure:dribble-pace`. The preserved pre-fix engine,
source hashes, before/after JSON and logs are in ignored `audit/dribble-pace/`.

## Validation and limitations

29 of 30 npm test suites pass, including the full possession runner, Stage 4,
Stage 5, physical contacts, keeper calibration, motion arbitration, passes,
ball claims, team shape and the new dribble tests. The 20-run fluidity sweep
has zero fully static intervals over 200 ms, zero physical orphans and zero
endpoint reach violations. Player-only stillness falls from 10.089% in the
previous reviewed tree to 5.050% with the same measurement method.

The replay-harness failure changes: `repeated-carry-burst-drain` now resolves,
but `congested-pass-loop` reaches the 50-action cap. This is a changed failing
fixture, not a claim that the new geometry preserves every prior outcome.
The guard remains unchanged. Its trace includes progression and turnovers;
fixing possession/session termination or decision memory is separate from
restoring honest dribbling speed. No shot/save probabilities or candidate
ordering were tuned to make that seed pass.

The existing no-global-clock, legacy contact/arbitration, and dive recovery
limitations remain. Browser visual verification is unavailable in this
session. Root source and its generated docs mirror are verified by the build
and byte comparison, allowing only the established API-meta rewrite.
