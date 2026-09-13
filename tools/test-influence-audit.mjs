// Realism Roadmap Stage 0 -- the audit statistics, against distributions
// whose answers are known by hand.
//
// Everything here is deterministic and constructed by arithmetic. There is
// deliberately no RNG in this file: a statistics module tested with random
// samples fails intermittently for reasons that have nothing to do with the
// code, which is the opposite of what a test is for.
import assert from "node:assert/strict";
import {
  summarise, rankWithTies, normalCdf, mannWhitneyU, cohensD,
  classifySeparation, compareSamples, auditMetrics,
  MAX_EFFECT_SIZE, SIGNIFICANCE_ALPHA,
} from "../src/lib/influenceAudit.js";

let passes = 0;
function check(label, condition) {
  assert.equal(condition, true, label);
  passes += 1;
}
const near = (actual, expected, tolerance = 1e-9) => Math.abs(actual - expected) <= tolerance;

// --- summarise -------------------------------------------------------------
{
  const stats = summarise([1, 2, 3, 4, 5]);
  check("summarise counts the sample", stats.n === 5);
  check("summarise means correctly", near(stats.mean, 3));
  check("summarise uses the n-1 sample deviation", near(stats.sd, Math.sqrt(2.5)));
  check("summarise medians an odd sample", near(stats.median, 3));
  check("summarise reports the range", stats.min === 1 && stats.max === 5);

  check("summarise medians an even sample", near(summarise([1, 2, 3, 4]).median, 2.5));

  const empty = summarise([]);
  check("an empty sample is zeroed, not NaN", empty.n === 0 && empty.mean === 0 && empty.sd === 0);

  const single = summarise([7]);
  check("a single observation has no deviation", single.n === 1 && single.sd === 0 && single.mean === 7);

  check("non-finite values are discarded", summarise([1, NaN, 3, Infinity, null, "4"]).n === 2);
}

// --- rankWithTies ----------------------------------------------------------
{
  const clean = rankWithTies([30, 10, 20]);
  check("untied ranks follow sorted order", clean.ranks.join(",") === "3,1,2");
  check("untied data needs no tie correction", clean.tieCorrection === 0);

  const tied = rankWithTies([10, 20, 20, 30]);
  check("tied observations share the averaged rank", tied.ranks.join(",") === "1,2.5,2.5,4");
  // One tie group of size 2 contributes 2^3 - 2 = 6.
  check("the tie correction is sum(t^3 - t)", tied.tieCorrection === 6);

  const allTied = rankWithTies([5, 5, 5]);
  check("a wholly tied sample shares one rank", allTied.ranks.join(",") === "2,2,2");
  check("a wholly tied sample corrects by 24", allTied.tieCorrection === 24);
}

// --- normalCdf -------------------------------------------------------------
{
  check("the normal CDF is centred at a half", near(normalCdf(0), 0.5, 1e-7));
  check("the normal CDF is symmetric", near(normalCdf(-1) + normalCdf(1), 1, 1e-6));
  check("1.96 sigma is the 97.5th percentile", near(normalCdf(1.96), 0.975, 1e-4));
  check("the normal CDF is monotonic", normalCdf(-2) < normalCdf(0) && normalCdf(0) < normalCdf(2));
}

// --- mannWhitneyU ----------------------------------------------------------
{
  const identical = mannWhitneyU([1, 2, 3], [1, 2, 3]);
  check("identical samples sit exactly on the null", near(identical.rankBiserial, 0));
  // The erf approximation is accurate to ~1.5e-7, so an exact 1.0 is not on
  // offer here and would be a meaningless thing to demand.
  check("identical samples are not significant", near(identical.pValue, 1, 1e-6));

  // Every observation in A beats every observation in B.
  const disjoint = mannWhitneyU([10, 11, 12], [1, 2, 3]);
  check("complete separation reads +1 rank-biserial", near(disjoint.rankBiserial, 1));
  check("complete separation the other way reads -1",
    near(mannWhitneyU([1, 2, 3], [10, 11, 12]).rankBiserial, -1));
  // Three against three cannot reach p < 0.05 however cleanly it separates.
  // This is the point of reporting effect size alongside significance.
  check("a tiny sample cannot reach significance even when perfectly separated",
    disjoint.pValue > SIGNIFICANCE_ALPHA);

  const wide = mannWhitneyU(
    Array.from({ length: 30 }, (unused, index) => 100 + index),
    Array.from({ length: 30 }, (unused, index) => index),
  );
  check("the same separation at n=30 is significant", wide.pValue < 0.0001);
  check("a wide sweep still reads +1 rank-biserial", near(wide.rankBiserial, 1));

  const constant = mannWhitneyU([4, 4, 4], [4, 4, 4]);
  check("zero variance in both arms is flagged degenerate", constant.degenerate === true);
  check("zero variance yields no separation", constant.rankBiserial === 0 && constant.pValue === 1);

  const short = mannWhitneyU([1], [2, 3, 4]);
  check("an arm below the minimum sample is refused", short.insufficient === true);
  check("a refused comparison reports no p-value", short.pValue === null);
}

// --- cohensD ---------------------------------------------------------------
{
  // Both arms have sd exactly 1, so the pooled deviation is 1 and d is the
  // raw mean difference.
  check("d is the mean difference over the pooled deviation",
    near(cohensD([10, 11, 12], [1, 2, 3]), 9));
  check("d is signed by which arm leads", cohensD([1, 2, 3], [10, 11, 12]) < 0);
  check("identical arms have no effect", near(cohensD([1, 2, 3], [1, 2, 3]), 0));

  check("two identical constants have no effect", cohensD([5, 5, 5], [5, 5, 5]) === 0);
  check("two different constants clamp rather than diverge",
    cohensD([7, 7, 7], [5, 5, 5]) === MAX_EFFECT_SIZE);
  check("the clamp is signed", cohensD([5, 5, 5], [7, 7, 7]) === -MAX_EFFECT_SIZE);
  check("an undersized arm has no computable effect", cohensD([1], [1, 2, 3]) === null);

  const huge = cohensD(
    Array.from({ length: 20 }, () => 1000),
    Array.from({ length: 20 }, (unused, index) => index * 0.0001),
  );
  check("an extreme separation is clamped to the documented maximum", huge === MAX_EFFECT_SIZE);
}

// --- classifySeparation ----------------------------------------------------
{
  check("0.8 and above is strong", classifySeparation(0.8, 0.001) === "strong");
  check("0.5 to 0.8 is visible", classifySeparation(0.6, 0.001) === "visible");
  check("0.2 to 0.5 is weak", classifySeparation(0.3, 0.001) === "weak");
  check("below 0.2 is none", classifySeparation(0.19, 0.001) === "none");
  check("the bands read the magnitude, not the sign", classifySeparation(-0.9, 0.001) === "strong");

  // The two independent gates. A real-but-tiny effect and a large-but-noisy
  // one both read "none", for different reasons.
  check("a significant but tiny effect is still invisible", classifySeparation(0.05, 1e-12) === "none");
  check("a large effect that misses significance is not claimed",
    classifySeparation(2.5, 0.2) === "none");
  check("the alpha gate is configurable", classifySeparation(2.5, 0.2, 0.5) === "strong");
}

// --- compareSamples --------------------------------------------------------
{
  const a = Array.from({ length: 25 }, (unused, index) => 10 + (index % 5));
  const b = Array.from({ length: 25 }, (unused, index) => index % 5);
  const comparison = compareSamples(a, b, { label: "carries" });
  check("the comparison keeps its label", comparison.label === "carries");
  check("the comparison reports the raw mean difference", near(comparison.meanDifference, 10));
  check("a clean separation reads strong", comparison.verdict === "strong");
  check("both arms are summarised", comparison.a.n === 25 && comparison.b.n === 25);

  // The baseline arm means zero, so a relative change is undefined rather
  // than infinite.
  const zeroBaseline = compareSamples([1, 2, 3, 4], [0, 0, 0, 0]);
  check("a zero baseline yields a null relative difference", zeroBaseline.relativeDifference === null);

  const noEffect = compareSamples([1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6]);
  check("identical arms read none", noEffect.verdict === "none");

  const refused = compareSamples([1], [2]);
  check("an undersized comparison reads insufficient", refused.verdict === "insufficient");
  check("insufficiency is flagged separately from a null result", refused.insufficient === true);
}

// --- auditMetrics ----------------------------------------------------------
{
  const flat = Array.from({ length: 20 }, (unused, index) => index % 4);
  const shifted = Array.from({ length: 20 }, (unused, index) => 20 + (index % 4));
  const audit = auditMetrics(
    { passShare: flat, carryShare: shifted, shotDistance: flat },
    { passShare: flat, carryShare: flat, shotDistance: flat },
  );
  check("every metric is compared", audit.metrics.length === 3);
  check("the headline verdict is the strongest metric, not the average",
    audit.verdict === "strong");
  check("the strongest metric is named", audit.strongest.label === "carryShare");
  check("only genuinely visible metrics are listed as visible",
    audit.visibleMetrics.length === 1 && audit.visibleMetrics[0].label === "carryShare");
  check("metrics are compared in a stable sorted order",
    audit.metrics.map((metric) => metric.label).join(",") === "carryShare,passShare,shotDistance");

  const inert = auditMetrics({ passShare: flat }, { passShare: flat });
  check("an instruction that changes nothing reads none", inert.verdict === "none");

  const missing = auditMetrics({ onlyInA: flat }, {});
  check("a metric present in one arm only is refused, not invented",
    missing.metrics[0].verdict === "insufficient");
}

console.log(`ALL PASS -- ${passes} influence-audit assertions`);
