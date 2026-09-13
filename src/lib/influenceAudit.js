// Tactical influence audit -- the instrument that decides whether an
// instruction is VISIBLE, not merely wired up.
//
// MATCH_ENGINE_OBSERVATION_BACKLOG.md, Finding 3, ends with: "Isolated unit
// tests do not establish visible, match-level tactical separation." That is
// exactly right, and it is the reason this module exists. The engine's
// suites prove a setting reaches behaviour; they cannot prove the effect is
// big enough for a person watching to notice. Those are different claims and
// need different evidence.
//
// This file is PURE statistics. It imports nothing from the engine, consumes
// no RNG, mutates nothing, and knows nothing about football. Give it two
// samples of numbers and it tells you whether they are separated and by how
// much. tools/measure-tactical-influence.mjs is what actually drives the
// engine to produce the samples.
//
// Two deliberate methodology choices, both of which matter:
//
// 1. NON-PARAMETRIC. The quantities being compared are counts (passes
//    selected), bounded ratios (pass share) and skewed distances (mean shot
//    distance). None are normal, several are floored at zero, and possession
//    samples are small. Mann-Whitney U asks the question that survives all of
//    that: if you drew one possession from each arm, how often would arm A
//    score higher?
//
// 2. UNPAIRED, even though both arms sweep the same seeds. It is tempting to
//    treat seed N under instruction A and seed N under instruction B as a
//    matched pair and run a signed-rank test for the extra power. That would
//    be wrong here. chooseCandidate() draws exactly one decisionRandom()
//    value per candidate in list order, so changing a tactical setting
//    changes the candidate list and silently re-keys every later draw in the
//    possession. Seed N is therefore NOT a counterfactual of itself -- the
//    two arms diverge for reasons that have nothing to do with the
//    instruction. Sweeping many seeds and comparing distributions is what
//    sees past that; pretending they are paired would manufacture confidence
//    the design cannot support.

/**
 * Effect-size bands, on Cohen's conventions.
 *
 * Reported alongside the p-value rather than instead of it, because a big
 * enough sweep finds significance in effects far too small to perceive. A
 * result can be entirely real and still invisible, and that combination is
 * the single most useful thing this module can tell you about an
 * instruction: the plumbing works, and the player cannot see it.
 */
export const SEPARATION_BANDS = Object.freeze([
  Object.freeze({ verdict: "strong", minEffect: 0.8 }),
  Object.freeze({ verdict: "visible", minEffect: 0.5 }),
  Object.freeze({ verdict: "weak", minEffect: 0.2 }),
  Object.freeze({ verdict: "none", minEffect: 0 }),
]);

/** Conventional two-tailed significance threshold. */
export const SIGNIFICANCE_ALPHA = 0.05;

/**
 * Cohen's d is undefined when both samples have zero variance. Rather than
 * return Infinity -- which does not survive JSON and poisons every average
 * downstream -- a degenerate comparison is clamped here and flagged.
 */
export const MAX_EFFECT_SIZE = 12;

/** Smallest sample either arm may have before a comparison is refused. */
export const MIN_SAMPLE_SIZE = 2;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function finiteValues(values) {
  return (values || []).filter(isFiniteNumber);
}

/**
 * Abramowitz & Stegun 7.1.26. Maximum absolute error 1.5e-7, which is far
 * finer than any decision this module informs -- nothing here turns on the
 * seventh decimal place of a p-value.
 */
function erf(x) {
  const sign = x < 0 ? -1 : 1;
  const absolute = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * absolute);
  const series = t * (0.254829592
    + t * (-0.284496736
      + t * (1.421413741
        + t * (-1.453152027 + t * 1.061405429))));
  return sign * (1 - series * Math.exp(-absolute * absolute));
}

/** Standard normal CDF. */
export function normalCdf(z) {
  return 0.5 * (1 + erf(z / Math.SQRT2));
}

/** Mean, sample standard deviation (n-1), median and range. */
export function summarise(values) {
  const sample = finiteValues(values);
  const n = sample.length;
  if (!n) {
    return { n: 0, mean: 0, sd: 0, median: 0, min: 0, max: 0 };
  }
  const mean = sample.reduce((sum, value) => sum + value, 0) / n;
  // n-1 in the denominator: these are samples drawn from the space of
  // possible possessions, never the whole population of them.
  const variance = n > 1
    ? sample.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (n - 1)
    : 0;
  const sorted = sample.slice().sort((left, right) => left - right);
  const middle = Math.floor(n / 2);
  return {
    n,
    mean,
    sd: Math.sqrt(variance),
    median: n % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    min: sorted[0],
    max: sorted[n - 1],
  };
}

/**
 * Ranks with ties averaged, plus the tie-correction term Mann-Whitney's
 * variance needs.
 *
 * Ties are not an edge case here: several audit metrics are small integers
 * (shots selected in one possession is very often 0 or 1), so a sweep
 * produces heavily tied data as a matter of course. Ignoring the correction
 * would overstate the variance and systematically understate significance.
 */
export function rankWithTies(values) {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((left, right) => left.value - right.value);
  const ranks = new Array(values.length);
  let tieCorrection = 0;
  let position = 0;
  while (position < indexed.length) {
    let end = position;
    while (end + 1 < indexed.length && indexed[end + 1].value === indexed[position].value) end += 1;
    const groupSize = end - position + 1;
    // Ranks are 1-based; the shared rank is the average of the positions the
    // tied group occupies.
    const sharedRank = (position + end + 2) / 2;
    for (let cursor = position; cursor <= end; cursor += 1) ranks[indexed[cursor].index] = sharedRank;
    if (groupSize > 1) tieCorrection += groupSize ** 3 - groupSize;
    position = end + 1;
  }
  return { ranks, tieCorrection };
}

/**
 * Mann-Whitney U with the tie-corrected normal approximation.
 *
 * `rankBiserial` is the non-parametric effect size and is the more honest of
 * the two this module reports: it is exactly "P(a > b) - P(b > a)", runs from
 * -1 to 1, and needs no distributional assumption at all. It is reported
 * alongside Cohen's d rather than instead of it because d is what the
 * published band scale is defined on.
 */
export function mannWhitneyU(sampleA, sampleB) {
  const a = finiteValues(sampleA);
  const b = finiteValues(sampleB);
  const nA = a.length;
  const nB = b.length;
  if (nA < MIN_SAMPLE_SIZE || nB < MIN_SAMPLE_SIZE) {
    return { nA, nB, u: null, z: null, pValue: null, rankBiserial: null, insufficient: true };
  }
  const { ranks, tieCorrection } = rankWithTies([...a, ...b]);
  const rankSumA = ranks.slice(0, nA).reduce((sum, rank) => sum + rank, 0);
  const uA = rankSumA - (nA * (nA + 1)) / 2;
  const product = nA * nB;
  const total = nA + nB;
  const mean = product / 2;
  const variance = (product / 12) * ((total + 1) - tieCorrection / (total * (total - 1)));
  if (!(variance > 0)) {
    // Every observation in both arms is the same number. There is no
    // separation to detect and no variance to divide by.
    return { nA, nB, u: uA, z: 0, pValue: 1, rankBiserial: 0, degenerate: true };
  }
  // Continuity correction: U is discrete, the normal approximating it is not.
  // Shrinking the deviation by half a unit keeps small samples from reading
  // as more significant than they are.
  const deviation = Math.max(0, Math.abs(uA - mean) - 0.5);
  const z = (uA >= mean ? deviation : -deviation) / Math.sqrt(variance);
  return {
    nA,
    nB,
    u: uA,
    z,
    pValue: 2 * (1 - normalCdf(Math.abs(z))),
    rankBiserial: (2 * uA) / product - 1,
  };
}

/** Standardised mean difference, pooled. Positive when A exceeds B. */
export function cohensD(sampleA, sampleB) {
  const a = summarise(sampleA);
  const b = summarise(sampleB);
  if (a.n < MIN_SAMPLE_SIZE || b.n < MIN_SAMPLE_SIZE) return null;
  const pooledVariance = ((a.n - 1) * a.sd ** 2 + (b.n - 1) * b.sd ** 2) / (a.n + b.n - 2);
  const pooledSd = Math.sqrt(pooledVariance);
  const difference = a.mean - b.mean;
  if (!(pooledSd > 0)) {
    // Both arms are constant. Either they are the same constant (no effect
    // at all) or different constants (a perfectly clean separation that the
    // standardised form cannot express, because the denominator is zero).
    if (difference === 0) return 0;
    return difference > 0 ? MAX_EFFECT_SIZE : -MAX_EFFECT_SIZE;
  }
  const d = difference / pooledSd;
  return Math.max(-MAX_EFFECT_SIZE, Math.min(MAX_EFFECT_SIZE, d));
}

/**
 * The band an effect falls in, given significance.
 *
 * An effect below the `weak` floor reads `none` however small its p-value
 * gets, and a result that misses significance reads `none` however large its
 * effect looks -- a big effect measured on eleven possessions is noise with
 * good PR.
 */
export function classifySeparation(effectSize, pValue, alpha = SIGNIFICANCE_ALPHA) {
  if (!isFiniteNumber(effectSize)) return "none";
  if (isFiniteNumber(pValue) && pValue >= alpha) return "none";
  const magnitude = Math.abs(effectSize);
  return SEPARATION_BANDS.find((band) => magnitude >= band.minEffect)?.verdict ?? "none";
}

/** Full two-sample comparison for one metric. */
export function compareSamples(sampleA, sampleB, { label = "", alpha = SIGNIFICANCE_ALPHA } = {}) {
  const a = summarise(sampleA);
  const b = summarise(sampleB);
  const test = mannWhitneyU(sampleA, sampleB);
  const effectSize = cohensD(sampleA, sampleB);
  const insufficient = Boolean(test.insufficient);
  return {
    label,
    a,
    b,
    meanDifference: a.mean - b.mean,
    // Relative change is what reads naturally in a report ("18% more carries")
    // but is meaningless when the baseline is zero, so it is null rather than
    // Infinity in that case.
    relativeDifference: b.mean === 0 ? null : (a.mean - b.mean) / Math.abs(b.mean),
    effectSize,
    rankBiserial: test.rankBiserial,
    pValue: test.pValue,
    z: test.z,
    verdict: insufficient ? "insufficient" : classifySeparation(effectSize, test.pValue, alpha),
    insufficient,
  };
}

/** Rank order of the bands, strongest first, for picking a headline verdict. */
const VERDICT_STRENGTH = Object.freeze({
  insufficient: -1, none: 0, weak: 1, visible: 2, strong: 3,
});

/**
 * Compare every metric captured for two arms of a sweep.
 *
 * `samplesA`/`samplesB` are `{ [metricName]: number[] }`. The headline
 * verdict is the STRONGEST per-metric verdict, not the average: an
 * instruction only has to move one thing visibly to be a visible
 * instruction. "Play more direct" that changes nothing but pass length is
 * still working.
 */
export function auditMetrics(samplesA, samplesB, { alpha = SIGNIFICANCE_ALPHA } = {}) {
  const names = [...new Set([...Object.keys(samplesA || {}), ...Object.keys(samplesB || {})])].sort();
  const metrics = names.map((name) => compareSamples(
    samplesA?.[name] ?? [], samplesB?.[name] ?? [], { label: name, alpha },
  ));
  const ranked = metrics
    .filter((metric) => !metric.insufficient)
    .sort((left, right) => VERDICT_STRENGTH[right.verdict] - VERDICT_STRENGTH[left.verdict]
      || Math.abs(right.effectSize) - Math.abs(left.effectSize));
  return {
    metrics,
    strongest: ranked[0] ?? null,
    verdict: ranked[0]?.verdict ?? "insufficient",
    visibleMetrics: metrics.filter((metric) => VERDICT_STRENGTH[metric.verdict] >= VERDICT_STRENGTH.visible),
  };
}
