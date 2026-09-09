import { clamp, playerAttribute } from "./matchEngineCore.js";
import { topSpeed } from "./playerKinetics.js";

// ---------------------------------------------------------------------------
// Stage 5 -- Stamina from real motion (2026-09-06).
//
// Effort used to be looked up from what a move was CALLED.
// `burstJobIntensity(action)` mapped a job name to a number, and the cost was
// `(yards / 40) * intensity * workRateFactor`. Speed appeared nowhere. Three
// things followed, all wrong:
//
//   * The same eight yards cost 0.85 under `run-in-behind` and cost nothing
//     at all under `hold-width`, because `hold-width` was on a refill list.
//     A defender who genuinely sprinted eight yards to hold a line recovered
//     stamina for doing it.
//   * A job nobody had listed silently became 0.5 -- neither a real reading
//     nor an obvious gap.
//   * Whether a player was walking or flat out was invisible. Distance alone
//     decided, so a 10-yard stroll and a 10-yard sprint were identical.
//
// This module derives the same quantity from the motion that actually
// happened. `advanceMotion()` already returns everything needed -- distance
// covered, the window it was covered in, and the speeds entered and left at
// -- so nothing new has to be measured, and no second physics model appears:
// `topSpeed()` from `playerKinetics.js` remains the only speed reference.
//
// It is deliberately pure: no randomness, no roster, no mutation. Callers
// apply the number to a battery; this only says how hard the player worked.
// ---------------------------------------------------------------------------

/**
 * Distance, at full effort, that costs one whole burst tank.
 *
 * Stage 5 kept the label model's own 40 so that pass could change where
 * intensity came from without also re-pricing every action. 40 was far too
 * harsh, and it showed: measured over one 68-second possession a midfielder
 * covered 179 yards -- which is entirely normal running, about 9.5 km over a
 * full match -- and at 40 yards to the tank that is four and a half tanks of
 * effort for a minute's football.
 *
 * Re-priced here against repeated-sprint capacity, which is what a burst tank
 * actually models: roughly seven hard 40-yard sprints before it is empty.
 * (40 / 250) * 0.9 = 0.144 per sprint, so about seven. Ordinary jogging now
 * costs far less than it recovers, which is why a player can jog all match.
 */
export const EFFORT_REFERENCE_YARDS = 250;

/**
 * Metabolic cost does not rise linearly with speed -- a jog is cheap and the
 * last fraction toward top speed is disproportionately expensive -- so the
 * sustained load is convex in the fraction of top speed actually held.
 */
export const EFFORT_SPEED_EXPONENT = 1.6;

/** Floor, so that genuinely moving at all is never completely free. */
export const EFFORT_IDLE_LOAD = 0.04;

/**
 * Changing speed costs beyond holding it. Accelerating and braking are both
 * work -- braking is eccentric loading, not rest -- so this reads the
 * magnitude of the change, not its sign.
 */
export const EFFORT_SPEED_CHANGE_SURCHARGE = 0.18;

/**
 * At or below this fraction of top speed a player is moving, but not working:
 * walking back into shape, jogging across to a covering position. This is
 * what replaces the hand-maintained refill-job list -- recovery now follows
 * from going slowly, which is the actual reason a player recovers.
 *
 * It is a BLEND POINT, not a cliff. See netBurstChange(): recovery fades to
 * nothing as a player approaches it rather than switching off. The first
 * version did switch off, and that was the reported "stamina drains randomly"
 * -- an ordinary jog sits at almost exactly this load, so each of the ~50
 * authored moves in a possession independently landed either side of the
 * threshold and the same player drained or recovered depending on nothing
 * more than how their running happened to be chopped into events.
 */
export const RECOVERY_LOAD_CEILING = 0.28;

/**
 * Tank fractions restored per second at a standstill. A player recovers a
 * full burst tank in about 45 seconds of genuine rest, and proportionally
 * less the harder they are still working.
 */
export const RECOVERY_RATE_PER_SECOND = 0.022;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/** Mean speed actually held across the window, in yards per second. */
export function meanSpeedYps({ distanceYards, durationMs } = {}) {
  const seconds = Math.max(0, finite(durationMs)) / 1000;
  return seconds > 0 ? Math.max(0, finite(distanceYards)) / seconds : 0;
}

/**
 * Fraction of this player's own top speed the move actually held, 0..1.
 *
 * Per player, deliberately: eight yards in a second is a comfortable stride
 * for a quick player and flat out for a slow one, and it should cost them
 * differently.
 */
export function motionSpeedLoad({ distanceYards, durationMs, player } = {}) {
  const maximum = topSpeed(player);
  if (!(maximum > 0)) return 0;
  return clamp(0, 1, meanSpeedYps({ distanceYards, durationMs }) / maximum);
}

/**
 * How hard the player worked, 0..1, on the same scale the old per-job
 * intensity table used -- so a caller can substitute one for the other
 * without re-pricing anything else.
 */
export function motionEffortLoad({
  distanceYards, durationMs, player, entrySpeedYps = 0, exitSpeedYps = 0,
} = {}) {
  const maximum = topSpeed(player);
  const load = motionSpeedLoad({ distanceYards, durationMs, player });
  const sustained = EFFORT_IDLE_LOAD
    + (1 - EFFORT_IDLE_LOAD) * Math.pow(load, EFFORT_SPEED_EXPONENT);
  const change = maximum > 0
    ? Math.abs(Math.max(0, finite(exitSpeedYps)) - Math.max(0, finite(entrySpeedYps))) / maximum
    : 0;
  return clamp(0, 1, sustained + EFFORT_SPEED_CHANGE_SURCHARGE * clamp(0, 1, change));
}

/**
 * True when this motion is recovery rather than work.
 *
 * A player standing still is also recovering, which is why this reads load
 * rather than distance: zero distance is zero load.
 */
export function isRecoveryMotion({ distanceYards, durationMs, player } = {}) {
  return motionSpeedLoad({ distanceYards, durationMs, player }) <= RECOVERY_LOAD_CEILING;
}

/**
 * Burst cost of a real move, in tank fractions.
 *
 * Work Rate spends slightly less per yard (used to it) -- the same term the
 * label-based model used, kept identical so this substitution does not
 * quietly change how Work Rate reads. Willingness to make the run at all is a
 * separate gate elsewhere and is not this function's business.
 */
export function motionEffortCost({
  distanceYards, durationMs, player, entrySpeedYps = 0, exitSpeedYps = 0, workRate = 10,
} = {}) {
  const yards = Math.max(0, finite(distanceYards));
  if (!(yards > 0)) return 0;
  const load = motionEffortLoad({ distanceYards, durationMs, player, entrySpeedYps, exitSpeedYps });
  return (yards / EFFORT_REFERENCE_YARDS) * load * (1.2 - clamp(0, 20, finite(workRate)) / 50);
}

/**
 * Recovery rate for this player, tank fractions per second at a standstill.
 *
 * Stamina is the attribute that decides how quickly a player gets their
 * breath back, so it scales the rate rather than the tank.
 */
export function burstRecoveryRatePerSecond(player) {
  const stamina = clamp(1, 20, playerAttribute(player, "Stamina"));
  return RECOVERY_RATE_PER_SECOND * (0.6 + stamina / 25);
}

/**
 * The signed change in burst for one real interval of motion: negative when
 * the player worked, positive when they got their breath back.
 *
 * Two properties this has and the old drain/recover branch did not:
 *
 *   1. It is CONTINUOUS. Recovery fades linearly to nothing as load
 *      approaches RECOVERY_LOAD_CEILING instead of switching off at it, so a
 *      player jogging at the boundary gets a small net change either way
 *      rather than a coin flip. That is the fix for the reported random
 *      drain.
 *
 *   2. It is PARTITION-INVARIANT. Splitting an interval in half and applying
 *      it twice gives the same answer as applying it once, because both terms
 *      are rates -- drain per yard at a given load, recovery per second. The
 *      old model's outcome depended on how motion was chopped into events,
 *      which is not a football fact.
 *
 * Both terms always apply. A player is recovering a little even while
 * working, and paying a little even while strolling; the balance is what
 * decides the sign.
 */
export function netBurstChange({
  distanceYards, durationMs, player, entrySpeedYps = 0, exitSpeedYps = 0, workRate = 10,
} = {}) {
  const seconds = Math.max(0, finite(durationMs)) / 1000;
  const load = motionSpeedLoad({ distanceYards, durationMs, player });
  const recovery = seconds * burstRecoveryRatePerSecond(player)
    * clamp(0, 1, 1 - load / RECOVERY_LOAD_CEILING);
  const cost = motionEffortCost({ distanceYards, durationMs, player, entrySpeedYps, exitSpeedYps, workRate });
  return recovery - cost;
}
