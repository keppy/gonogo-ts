// gonogo/stats.py: the interval, the sample size, the risk-coverage curve and
// calibration. Operation order follows the Python so the floats agree.

import { fsum, percent, roundHalfEven } from "./py.ts";

const Z: Record<string, number> = {
  "0.8": 1.2815515655446004, "0.9": 1.6448536269514722, "0.95": 1.959963984540054, "0.99": 2.5758293035489004,
};

/** z for a two-sided interval at `level`: a table, else Acklam's approximation. */
export function zFor(level: number): number {
  const known = Z[String(level)];
  if (known !== undefined) return known;
  if (!(level > 0 && level < 1)) throw new RangeError(`confidence level must be in (0, 1), got ${level}`);
  const p = (1.0 + level) / 2.0;
  const a = [-3.969683028665376e01, 2.209460984245205e02, -2.759285104469687e02,
    1.383577518672690e02, -3.066479806614716e01, 2.506628277459239e00];
  const b = [-5.447609879822406e01, 1.615858368580409e02, -1.556989798598866e02,
    6.680131188771972e01, -1.328068155288572e01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e00,
    -2.549732539343734e00, 4.374664141464968e00, 2.938163982698783e00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e00, 3.754408661907416e00];
  const plow = 0.02425;
  const phigh = 1 - 0.02425;
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (p > phigh) {
    const q = Math.sqrt(-2 * Math.log(1 - p));
    return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) /
      ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  const q = p - 0.5;
  const r = q * q;
  return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q /
    (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
}

export interface Interval { point: number; low: number; high: number; level: number; n: number }

/** `str(Interval)`: "93.3% [81.7%, 97.9%]". */
export function intervalStr(i: Interval): string {
  return `${percent(i.point, 1)} [${percent(i.low, 1)}, ${percent(i.high, 1)}]`;
}

/** Wilson score interval for a binomial proportion. */
export function wilson(successes: number, n: number, level = 0.95): Interval {
  if (n < 0 || successes < 0) throw new RangeError("successes and n must be non-negative");
  if (successes > n) throw new RangeError(`successes (${successes}) cannot exceed n (${n})`);
  if (n === 0) return { point: NaN, low: 0.0, high: 1.0, level, n: 0 };
  const z = zFor(level);
  const p = successes / n;
  const denom = 1.0 + z * z / n;
  const center = (p + z * z / (2 * n)) / denom;
  const half = (z / denom) * Math.sqrt(p * (1 - p) / n + z * z / (4 * n * n));
  return { point: p, low: Math.max(0.0, center - half), high: Math.min(1.0, center + half), level, n };
}

/** Smallest n at which `observedRate` would clear `target` as a lower bound, or null. */
export function requiredN(observedRate: number, target: number, level = 0.95, maxN = 100_000): number | null {
  if (!(observedRate >= 0 && observedRate <= 1)) throw new RangeError("observed_rate must be in [0, 1]");
  if (observedRate <= target) return null;
  const clears = (n: number) => wilson(roundHalfEven(observedRate * n), n, level).low >= target;
  let lo = 1;
  let hi = 1;
  for (;;) {
    if (hi > maxN) return null;
    if (clears(hi)) break;
    [lo, hi] = [hi, hi * 2];
  }
  while (lo < hi) { // not perfectly monotone in n, as in Python: "roughly how many"
    const mid = Math.floor((lo + hi) / 2);
    if (clears(mid)) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export interface OperatingPoint {
  threshold: number; coverage: number; nCovered: number; precision: Interval; nDeferred: number;
}

export type Trial = [confidence: number, passed: boolean];

/** One operating point per distinct confidence, full coverage first. */
export function riskCoverage(results: Trial[], level = 0.95): OperatingPoint[] {
  if (results.length === 0) return [];
  for (const [conf] of results) {
    if (!(conf >= 0 && conf <= 1)) throw new RangeError(`confidence must be in [0, 1], got ${conf}`);
  }
  const n = results.length;
  const thresholds = [...new Set(results.map(([c]) => c))].sort((x, y) => x - y);
  return thresholds.map((threshold) => {
    const covered = results.filter(([c]) => c >= threshold).map(([, p]) => p);
    return {
      threshold,
      coverage: covered.length / n,
      nCovered: covered.length,
      precision: wilson(covered.filter(Boolean).length, covered.length, level),
      nDeferred: n - covered.length,
    };
  });
}

/** Highest-coverage threshold whose precision lower bound clears the target. */
export function bestOperatingPoint(
  results: Trial[], targetPrecision: number, minCoverage = 0.0, level = 0.95,
): OperatingPoint | null {
  let best: OperatingPoint | null = null;
  for (const p of riskCoverage(results, level)) {
    if (p.precision.low >= targetPrecision && p.coverage >= minCoverage && (!best || p.coverage > best.coverage)) {
      best = p; // strictly greater keeps the first maximum, as Python's max() does
    }
  }
  return best;
}

/** Expected calibration error over `bins` equal-width bins; the last bin includes 1.0. */
export function expectedCalibrationError(results: Trial[], bins = 10): number {
  if (results.length === 0) return NaN;
  if (bins < 1) throw new RangeError("bins must be >= 1");
  const n = results.length;
  let total = 0.0;
  for (let b = 0; b < bins; b++) {
    const lo = b / bins;
    const hi = (b + 1) / bins;
    const bucket = results.filter(([c]) => (lo <= c && c < hi) || (b === bins - 1 && c === hi));
    if (bucket.length === 0) continue;
    const acc = bucket.filter(([, p]) => p).length / bucket.length;
    const conf = fsum(bucket.map(([c]) => c)) / bucket.length;
    total += (bucket.length / n) * Math.abs(acc - conf);
  }
  return total;
}

