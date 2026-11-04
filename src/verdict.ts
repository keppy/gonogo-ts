// gonogo/decide.py: per-trial (confidence, passed) to a deployment decision.
// The ordering is the judgement: whole task first, then a confident subset,
// then whether the sample is too small, then assist or not at all.

import { fixed, percent } from "./py.ts";
import {
  bestOperatingPoint, expectedCalibrationError, intervalStr, requiredN, wilson,
  type Interval, type OperatingPoint, type Trial,
} from "./stats.ts";

export const VERDICTS = {
  AUTOMATE: "AUTOMATE",
  AUTOMATE_WITH_REVIEW: "AUTOMATE WITH REVIEW",
  ASSIST_ONLY: "ASSIST ONLY",
  DO_NOT_AUTOMATE: "DO NOT AUTOMATE",
  INSUFFICIENT_EVIDENCE: "INSUFFICIENT EVIDENCE",
} as const;
export type Verdict = (typeof VERDICTS)[keyof typeof VERDICTS];

export const ECE_UNUSABLE = 0.15;
export const MIN_USEFUL_COVERAGE = 0.25;
export const ASSIST_FLOOR = 0.5;

export interface Decision {
  verdict: Verdict;
  reason: string;
  passRate: Interval;
  target: number;
  operatingPoint: OperatingPoint | null;
  calibrationError: number;
  neededN: number | null;
  notes: string[];
}

export function decideTrials(
  results: Trial[], target = 0.95, level = 0.95, minCoverage = MIN_USEFUL_COVERAGE, unit = "cases",
): Decision {
  if (!(target > 0 && target < 1)) throw new RangeError(`target must be in (0, 1), got ${target}`);
  const base = { target, operatingPoint: null, calibrationError: NaN, neededN: null };
  const n = results.length;
  if (n === 0) {
    return { ...base, verdict: VERDICTS.INSUFFICIENT_EVIDENCE, reason: "no cases were evaluated",
      passRate: wilson(0, 0, level), notes: [] };
  }
  const rate = wilson(results.filter(([, p]) => p).length, n, level);
  const rateS = intervalStr(rate);
  const pct0 = (x: number) => percent(x, 0);
  const notes: string[] = [];
  const hasConfidence = new Set(results.map(([c]) => c)).size > 1;
  const ece = hasConfidence ? expectedCalibrationError(results) : NaN;
  if (!hasConfidence) {
    notes.push("Every case reported the same confidence, so no abstention threshold "
      + "can be derived. Emit a real per-case confidence to unlock selective automation.");
  }
  const common = { ...base, passRate: rate, calibrationError: ece, notes };

  if (rate.low >= target) {
    return { ...common, verdict: VERDICTS.AUTOMATE,
      reason: `pass rate ${rateS} clears the ${pct0(target)} target across all ${unit} at the ${pct0(level)} level` };
  }

  if (hasConfidence) {
    if (ece > ECE_UNUSABLE) {
      notes.push(`Calibration error ${fixed(ece, 2)} exceeds ${fixed(ECE_UNUSABLE, 2)}: the confidence score `
        + "ranks cases usefully but its scale is not a probability. Treat any threshold "
        + "below as an opaque cut point, and recalibrate before reading it as a percentage.");
    }
    const point = bestOperatingPoint(results, target, minCoverage, level);
    if (point !== null) {
      notes.push(`The ${fixed(point.threshold, 2)} threshold was chosen by searching this same case `
        + "set, so its precision is optimistically biased. Re-measure it on fresh cases "
        + "before relying on it.");
      return { ...common, verdict: VERDICTS.AUTOMATE_WITH_REVIEW, operatingPoint: point,
        reason: `overall pass rate ${rateS} misses the ${pct0(target)} target; `
          + `a candidate threshold at confidence ${fixed(point.threshold, 2)} reaches `
          + `${percent(point.precision.point, 1)} precision on ${pct0(point.coverage)} of ${unit} `
          + "on this selection set, but needs a fresh holdout before deployment" };
    }
    const near = bestOperatingPoint(results, target, 0.0, level);
    if (near !== null) {
      notes.push(`A threshold of ${fixed(near.threshold, 2)} would hit the target but only covers `
        + `${pct0(near.coverage)} of ${unit}, below the ${pct0(minCoverage)} floor.`);
    }
  }

  if (rate.point >= target) {
    const needed = requiredN(rate.point, target, level);
    return { ...common, verdict: VERDICTS.INSUFFICIENT_EVIDENCE, neededN: needed,
      reason: `observed ${percent(rate.point, 1)} on ${n} ${unit} is above the ${pct0(target)} target, `
        + `but the ${pct0(level)} interval reaches down to ${percent(rate.low, 1)}`,
      notes: needed ? [...notes, `At this rate, about ${needed} ${unit} would be needed to claim `
        + `${pct0(target)}; you have ${n}.`] : notes };
  }

  if (rate.point >= ASSIST_FLOOR) {
    return { ...common, verdict: VERDICTS.ASSIST_ONLY,
      reason: `pass rate ${rateS} is below the ${pct0(target)} target and no `
        + "confident subset reaches it; useful as a draft-generator, not as an unattended step" };
  }

  return { ...common, verdict: VERDICTS.DO_NOT_AUTOMATE,
    reason: `pass rate ${rateS} is below ${pct0(ASSIST_FLOOR)}; this workflow is not a fit `
      + "for automation as currently scoped" };
}
