// `gonogo decide RESULTS.jsonl --json`: outcomes.results_from_jsonl, then
// evaluate.report_from_results, then Report.to_dict(), as one function.

import { cmpStr, floatRepr, repr, str, toFloat, truthy } from "./py.ts";
import type { Trial } from "./stats.ts";
import { decideTrials, MIN_USEFUL_COVERAGE, VERDICTS, type Decision } from "./verdict.ts";

const ANSWER = "answer";
const ABSTAIN = "abstain";
/** The action a report writes for a case that errored: neither acted nor held back. */
const ERROR = "error";
export const GROUP_RULES = ["none", "all"] as const;
export type GroupRule = (typeof GROUP_RULES)[number];

/** Any refusal gonogo would also refuse; the message is gonogo's. */
export class GonogoError extends Error {
  override name = "GonogoError";
}

/** A refused row. `line` is the JSONL line (index + 1 for an array of rows). */
export class GonogoRowError extends GonogoError {
  override name = "GonogoRowError";
  readonly index: number;
  readonly line: number;
  constructor(source: string, index: number, line: number, detail: string) {
    super(`${source}:${line}: ${detail}`);
    this.index = index;
    this.line = line;
  }
}

export interface DecideOptions {
  target?: number;
  level?: number;
  minCoverage?: number;
  groupRule?: GroupRule;
  task?: string;
  /** What the CLI records as `metadata.source` (the file path it was given) and names in errors. */
  source?: string;
}

interface Result {
  id: string;
  group: string | null;
  expectedAction: string;
  action: string;
  confidence: number | null;
  passed: boolean;
  score: number;
  detail: string;
  error: string | null;
}

type Row = Record<string, unknown>;

/** JSONL as `read_jsonl_rows` reads it: blank and `//` lines skipped, line numbers kept. */
export function parseJsonl(text: string, source = "rows"): { line: number; row: Row }[] {
  const out: { line: number; row: Row }[] = [];
  text.split(/\r\n|\r|\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (!line || line.startsWith("//")) return;
    let row: unknown;
    try {
      row = JSON.parse(line);
    } catch (exc) {
      throw new GonogoRowError(source, out.length, i + 1, `invalid JSON: ${(exc as Error).message}`);
    }
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      throw new GonogoRowError(source, out.length, i + 1, "each line must be a JSON object");
    }
    out.push({ line: i + 1, row: row as Row });
  });
  return out;
}

function checkAction(value: unknown, name: string): string {
  if (typeof value !== "string" || !value) throw new GonogoError(`${name} must be a non-empty string, got ${repr(value)}`);
  return value;
}

function loadResults(rows: { line: number; row: Row }[], source: string): Result[] {
  const results = rows.map(({ line, row }, index): Result => {
    const refuse = (detail: string) => new GonogoRowError(source, index, line, detail);
    const passed = row.passed;
    if (typeof passed !== "boolean") throw refuse(`passed must be true or false, got ${repr(passed)}`);
    let expectedAction: string;
    let action: string;
    try {
      expectedAction = checkAction("expected_action" in row ? row.expected_action : ANSWER, "expected_action");
      action = checkAction("action" in row ? row.action : ANSWER, "action");
    } catch (exc) {
      throw refuse((exc as Error).message);
    }
    const rawConfidence = row.confidence ?? null;
    if (rawConfidence !== null && typeof rawConfidence !== "number") {
      throw refuse(`confidence must be a number in [0, 1], got ${repr(rawConfidence)}`);
    }
    let confidence = rawConfidence;
    let error = row.error ?? null;
    if (error !== null) {
      if (typeof error !== "string" || !error) throw refuse(`error must be a non-empty string, got ${repr(error)}`);
      if ("action" in row && action !== ERROR) {
        throw refuse(`error is set, but action is ${repr(action)}; an errored case `
          + `took no action (leave action out, or write ${repr(ERROR)})`);
      }
    } else if (action === ERROR) {
      error = ERROR;
    }
    if (error !== null) {
      if (passed) throw refuse("an errored case cannot pass");
      action = ANSWER; // what evaluate's crash records; the error is what marks it
    } else if (expectedAction !== ANSWER) {
      const expect = action === expectedAction;
      if (passed !== expect) {
        throw refuse(`passed is ${passed}, but action ${repr(action)} against `
          + `expected_action ${repr(expectedAction)} means ${expect}`);
      }
    } else if (action === ABSTAIN) {
      if (passed) throw refuse("an abstention on a case that expects an answer cannot pass");
      confidence = 0.0; // a deferral sits at the bottom of every threshold
    } else if (action !== ANSWER && passed) {
      throw refuse(`action ${repr(action)} on a case that expects an answer cannot pass`);
    }
    if (confidence !== null && !(confidence >= 0 && confidence <= 1)) {
      throw refuse(`confidence must be in [0, 1], got ${floatRepr(confidence)}`);
    }
    const id = truthy(row.id) ? str(row.id) : `case-${line}`;
    let score: number;
    try {
      score = toFloat("score" in row ? row.score : passed ? 1.0 : 0.0);
    } catch (exc) { // Python names no line here (and crashes outright on a TypeError)
      throw new GonogoError((exc as Error).message);
    }
    const group = row.group ?? null;
    return {
      id,
      group: group === null ? null : str(group),
      expectedAction, action, confidence, passed, score,
      detail: str("detail" in row ? row.detail : error !== null ? `agent error: ${error}` : ""),
      error: error as string | null,
    };
  });
  if (results.length === 0) throw new GonogoError(`${source}: no results found`);
  return results;
}

const confidenceOf = (r: Result) => r.confidence ?? 1.0;

/** The decision and the per-case outcomes, deep-equal to `gonogo decide RESULTS.jsonl --json`. */
export function decide(input: string | Row[], opts: DecideOptions = {}): Record<string, unknown> {
  const { target = 0.95, level = 0.95, minCoverage = MIN_USEFUL_COVERAGE, groupRule = "none", task = "task" } = opts;
  const source = opts.source ?? "rows";
  if (!(target > 0 && target < 1)) throw new GonogoError(`target must be in (0, 1), got ${floatRepr(target)}`);
  if (!(level > 0 && level < 1)) throw new GonogoError(`level must be in (0, 1), got ${floatRepr(level)}`);
  const rows = typeof input === "string" ? parseJsonl(input, source) : input.map((row, i) => {
    if (row === null || typeof row !== "object" || Array.isArray(row)) {
      throw new GonogoRowError(source, i, i + 1, "each line must be a JSON object");
    }
    return { line: i + 1, row };
  });
  const results = loadResults(rows, source);
  if (!(GROUP_RULES as readonly string[]).includes(groupRule)) {
    throw new GonogoError(`group_rule must be one of ('none', 'all'), got ${repr(groupRule)}`);
  }

  // A plain abstention on an answer case carries a synthesized 0.0, and an errored
  // case may carry none, so neither is the agent's own confidence: both sit out the check.
  const own = results.filter((r) => r.error === null && !(r.action === ABSTAIN && r.expectedAction === ANSWER));
  const supplied = own.some((r) => r.confidence !== null);
  if (supplied && own.some((r) => r.confidence === null)) {
    throw new GonogoError("mixed missing and present confidence; supply confidence for every answered case or none");
  }

  const groups = groupRule === "none" ? null : groupResults(results);
  const trials = groups === null
    ? results.map((r): Trial => [confidenceOf(r), r.passed])
    : [...groups.values()].map((rs): Trial => [Math.min(...rs.map(confidenceOf)), rs.every((r) => r.passed)]);
  let decision = decideTrials(trials, target, level, minCoverage, groups === null ? "cases" : "groups", supplied);
  const errored = results.filter((r) => r.error !== null).length;
  if (errored === results.length) {
    // A pass rate of zero here is the harness breaking, not the agent failing.
    decision = {
      verdict: VERDICTS.INSUFFICIENT_EVIDENCE,
      reason: `every case errored (${errored} of ${errored}), so the run measured nothing `
        + "about the agent; fix what crashed and run it again",
      passRate: decision.passRate, target, operatingPoint: null, calibrationError: NaN, neededN: null, notes: [],
    };
  } else if (errored) {
    decision.notes.push(`${errored} of ${results.length} cases errored and count as failures; `
      + "read their detail before reading the pass rate as the agent's.");
  }
  const nGroups = groups === null ? null : groups.size;
  const nGroupsPassed = groups === null ? null : trials.filter(([, p]) => p).length;
  return toDict(task, results, decision, nGroups, nGroupsPassed, { ...(opts.source === undefined ? {} : { source }), group_rule: groupRule });
}

function groupResults(results: Result[]): Map<string, Result[]> {
  const missing = results.filter((r) => r.group === null).map((r) => r.id);
  if (missing.length === results.length) {
    throw new GonogoError("group_rule is set but no case has a group; set Case.group or use group_rule='none'");
  }
  if (missing.length) {
    const shown = missing.slice(0, 3).join(", ") + (missing.length > 3 ? ", ..." : "");
    throw new GonogoError(`group_rule is set but ${missing.length} case(s) have no group: ${shown}`);
  }
  const out = new Map<string, Result[]>();
  for (const r of results) out.set(r.group!, [...(out.get(r.group!) ?? []), r]);
  return out;
}

const finite = (x: number) => (Number.isFinite(x) ? x : null);

function toDict(
  task: string, results: Result[], d: Decision, nGroups: number | null, nGroupsPassed: number | null,
  metadata: Record<string, string>,
): Record<string, unknown> {
  const op = d.operatingPoint;
  const out: Record<string, unknown> = {
    task,
    verdict: d.verdict,
    can_automate: d.verdict === "AUTOMATE",
    reason: d.reason,
    n: results.length,
    n_passed: results.filter((r) => r.passed).length,
    n_groups: nGroups,
    n_groups_passed: nGroupsPassed,
    pass_rate: { point: finite(d.passRate.point), low: d.passRate.low, high: d.passRate.high, level: d.passRate.level },
    target: d.target,
    calibration_error: finite(d.calibrationError),
    needed_n: d.neededN,
    operating_point: op && {
      threshold: op.threshold, coverage: op.coverage, n_covered: op.nCovered,
      precision: op.precision.point, precision_low: op.precision.low, precision_high: op.precision.high,
      n_deferred: op.nDeferred,
    },
    notes: d.notes,
    metadata,
    cases: results.map((r) => ({
      id: r.id, group: r.group, passed: r.passed, score: finite(r.score), confidence: confidenceOf(r), detail: r.detail,
    })),
  };
  const usesActions = results.some((r) => r.expectedAction !== ANSWER || (r.action !== ANSWER && r.action !== ABSTAIN));
  const cases = out.cases as Record<string, unknown>[];
  if (usesActions) { // absent otherwise, so a plain run's payload is unchanged
    out.actions = actions(results);
    cases.forEach((entry, i) => {
      entry.expected_action = results[i].expectedAction;
      entry.action = taken(results[i]);
    });
  }
  cases.forEach((entry, i) => { // only on errored cases, so other payloads are unchanged
    if (results[i].error !== null) entry.error = results[i].error;
  });
  return out;
}

const taken = (r: Result) => (r.error !== null ? ERROR : r.action);

/** Expected x taken action counts, with the two named mistakes. */
function actions(results: Result[]) {
  const counts = new Map<string, { expected: string; taken: string; n: number }>();
  for (const r of results) {
    const key = JSON.stringify([r.expectedAction, taken(r)]);
    const row = counts.get(key) ?? { expected: r.expectedAction, taken: taken(r), n: 0 };
    row.n += 1;
    counts.set(key, row);
  }
  const rows = [...counts.values()];
  const sortKey = (x: { expected: string; taken: string }) =>
    [Number(x.expected !== ANSWER), x.expected, Number(x.taken !== x.expected), x.taken] as const;
  rows.sort((x, y) => {
    const [a, b] = [sortKey(x), sortKey(y)];
    return a[0] - b[0] || cmpStr(a[1], b[1]) || a[2] - b[2] || cmpStr(a[3], b[3]);
  });
  return {
    matrix: rows,
    acted_when_should_hold_back: rows.filter((r) => r.expected !== ANSWER && r.taken === ANSWER)
      .reduce((s, r) => s + r.n, 0),
    // An errored case neither acted nor held back.
    held_back_when_should_act: rows.filter((r) => r.expected === ANSWER && r.taken !== ANSWER && r.taken !== ERROR)
      .reduce((s, r) => s + r.n, 0),
  };
}
