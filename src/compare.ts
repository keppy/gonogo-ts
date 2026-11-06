// gonogo/compare.py: McNemar's test on the trials two saved reports share,
// deep-equal to `gonogo compare A.json B.json --json`.

import { GonogoError } from "./decide.ts";
import { cmpStr, repr, str } from "./py.ts";
import { wilson } from "./stats.ts";

const EXACT_LIMIT = 1000;
type Report = Record<string, unknown>;
const isMapping = (v: unknown): v is Report => v !== null && typeof v === "object" && !Array.isArray(v);

function caseEntries(report: unknown): unknown[] {
  const cases = isMapping(report) ? report.cases : undefined;
  if (cases === undefined || cases === null) {
    throw new GonogoError("expected a Report or a Report.to_dict() payload with per-case results");
  }
  // Python iterates whatever `cases` is and crashes on a non-object entry; we refuse it instead.
  if (!Array.isArray(cases) || !cases.every(isMapping)) {
    throw new GonogoError("cases must be a list of objects");
  }
  return cases;
}

function outcomes(entries: Report[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const { id, passed } of entries) {
    if (id === undefined || id === null) throw new GonogoError("every case needs an id to pair on");
    if (typeof passed !== "boolean") throw new GonogoError(`case ${repr(id)}: passed must be a boolean`);
    if (out.has(str(id))) throw new GonogoError(`duplicate case id ${repr(id)}; ids must be unique to pair on`);
    out.set(str(id), passed);
  }
  return out;
}

/** Grouped rows that were not folded (group rule "none"): one trial per row, keyed by (group, id). */
function rowOutcomes(entries: Report[]): Map<string, boolean> {
  const out = new Map<string, boolean>();
  for (const { group, id, passed } of entries) {
    if (id === undefined || id === null) throw new GonogoError("every case needs an id to pair on");
    if (typeof passed !== "boolean") throw new GonogoError(`case ${repr(id)}: passed must be a boolean`);
    const g = group === undefined || group === null ? null : str(group);
    const key = JSON.stringify([g, str(id)]);
    if (out.has(key)) {
      const where = g === null ? "" : ` within group ${repr(g)}`;
      throw new GonogoError(`duplicate case id ${repr(id)}${where}; ids must be unique to pair on`);
    }
    out.set(key, passed);
  }
  return out;
}

/** Fold a grouped run to one trial per group (all must pass), keeping membership. */
function trialOutcomes(report: unknown): [Map<string, boolean>, Map<string, Set<string>> | null] {
  const entries = caseEntries(report) as Report[];
  const r = report as Report;
  const explicit = "n_groups" in r && r.n_groups !== null && r.n_groups !== undefined;
  const implicit = !("n_groups" in r) && entries.some((e) => e.group !== null && e.group !== undefined);
  if (!(explicit || implicit)) {
    // Grouped rows decided with group rule "none": ids repeat across groups by design.
    if (entries.some((e) => e.group !== null && e.group !== undefined)) return [rowOutcomes(entries), null];
    return [outcomes(entries), null];
  }
  const passedByGroup = new Map<string, boolean>();
  const membership = new Map<string, Set<string>>();
  for (const { group, id, passed } of entries) {
    if (group === null || group === undefined || id === null || id === undefined) {
      throw new GonogoError("grouped comparison requires a group and id on every case");
    }
    if (typeof passed !== "boolean") throw new GonogoError(`case ${repr(id)}: passed must be a boolean`);
    const key = str(group);
    const ids = membership.get(key) ?? new Set<string>();
    membership.set(key, ids);
    if (ids.has(str(id))) throw new GonogoError(`duplicate case id ${repr(id)} within group ${repr(key)}`);
    ids.add(str(id));
    passedByGroup.set(key, (passedByGroup.get(key) ?? true) && passed);
  }
  return [passedByGroup, membership];
}

const sameSet = (x: Set<string>, y: Set<string>) => x.size === y.size && [...x].every((v) => y.has(v));

export interface CompareOptions { level?: number }

/** Whether B differs from A on their shared trials. */
export function compare(reportA: unknown, reportB: unknown, opts: CompareOptions = {}): Record<string, unknown> {
  const level = opts.level ?? 0.95;
  if (!(level > 0 && level < 1)) throw new GonogoError(`level must be in (0, 1), got ${level}`);
  const [a, groupsA] = trialOutcomes(reportA);
  const [b, groupsB] = trialOutcomes(reportB);
  if ((groupsA === null) !== (groupsB === null)) {
    throw new GonogoError("cannot compare grouped trials with ungrouped cases");
  }
  const unit = groupsA !== null ? "groups" : "cases";
  const shared = [...a.keys()].filter((k) => b.has(k)).sort(cmpStr);
  if (shared.length === 0) throw new GonogoError(`the two reports share no ${unit.slice(0, -1)} ids; nothing to compare`);
  if (groupsA && groupsB) {
    for (const g of shared) {
      if (!sameSet(groupsA.get(g)!, groupsB.get(g)!)) {
        throw new GonogoError(`group ${repr(g)} has different case membership across runs`);
      }
    }
  }
  const count = (f: (x: boolean, y: boolean) => boolean) => shared.filter((i) => f(a.get(i)!, b.get(i)!)).length;
  const bothPassed = count((x, y) => x && y);
  const bothFailed = count((x, y) => !x && !y);
  const onlyA = count((x, y) => x && !y);
  const onlyB = count((x, y) => y && !x);
  const n = shared.length;
  const rateA = (bothPassed + onlyA) / n;
  const rateB = (bothPassed + onlyB) / n;
  const difference = rateB - rateA;
  const [pValue, exact] = mcnemar(onlyA, onlyB);

  // Simultaneous (Bonferroni) Wilson bounds on P(B-only) and P(A-only).
  const componentLevel = 1.0 - (1.0 - level) / 2.0;
  const aOnly = wilson(onlyA, n, componentLevel);
  const bOnly = wilson(onlyB, n, componentLevel);
  const low = Math.max(-1.0, bOnly.low - aOnly.high);
  const high = Math.min(1.0, bOnly.high - aOnly.low);

  const testSignificant = pValue < 1.0 - level;
  const intervalExcludesZero = low > 0.0 || high < 0.0;
  // A winner only when the test and the printed interval agree.
  const significant = testSignificant && intervalExcludesZero;
  const borderline = testSignificant !== intervalExcludesZero;
  return {
    n_shared: n, unit, both_passed: bothPassed, both_failed: bothFailed, only_a: onlyA, only_b: onlyB,
    discordant: onlyA + onlyB, rate_a: rateA, rate_b: rateB, difference, low, high, level,
    p_value: pValue, exact, test_significant: testSignificant, interval_excludes_zero: intervalExcludesZero,
    significant, borderline,
    verdict: significant ? "distinguishable" : borderline ? "borderline" : "not distinguishable",
    better: significant ? (difference > 0 ? "B" : "A") : null,
  };
}

/** Two-sided McNemar p-value: exact binomial up to 1000 disagreements, chi-square above. */
export function mcnemar(onlyA: number, onlyB: number): [pValue: number, exact: boolean] {
  const n = onlyA + onlyB;
  if (n === 0) return [1.0, true]; // the agents agreed on every case
  if (n <= EXACT_LIMIT) {
    const k = Math.max(onlyA, onlyB);
    let comb = 1n; // C(n, 0), stepped up to C(n, k)
    for (let i = 0; i < k; i++) comb = (comb * BigInt(n - i)) / BigInt(i + 1);
    let tail = 0n;
    for (let i = k; i <= n; i++) {
      tail += comb;
      comb = (comb * BigInt(n - i)) / BigInt(i + 1);
    }
    // Number(bigint) rounds to nearest, and the power-of-two divide is exact,
    // which is Python's correctly rounded int / int.
    return [Math.min(1.0, 2 * (Number(tail) / 2 ** n)), true];
  }
  const chi = (Math.abs(onlyA - onlyB) - 1) ** 2 / n;
  return [erfc(Math.sqrt(chi / 2)), false];
}

/** Complementary error function for x >= 0, to about 1e-15 relative. */
export function erfc(x: number): number {
  if (x < 2) { // 1 - erf by the all-positive series exp(-x^2) * sum 2^k x^(2k+1) / (2k+1)!!
    let term = x;
    let sum = x;
    for (let k = 1; term > sum * 1e-17; k++) {
      term *= (2 * x * x) / (2 * k + 1);
      sum += term;
    }
    return 1 - (2 / Math.sqrt(Math.PI)) * Math.exp(-x * x) * sum;
  }
  // Continued fraction x + (1/2)/(x + 1/(x + (3/2)/(x + ...))), by modified Lentz.
  const tiny = 1e-300;
  let f = x;
  let c = x;
  let d = 0;
  for (let k = 1; k < 500; k++) {
    const ak = k / 2;
    d = x + ak * d;
    d = 1 / (Math.abs(d) < tiny ? tiny : d);
    c = x + ak / c;
    if (Math.abs(c) < tiny) c = tiny;
    const delta = c * d;
    f *= delta;
    if (Math.abs(delta - 1) < 1e-16) break;
  }
  return Math.exp(-x * x) / (f * Math.sqrt(Math.PI));
}
