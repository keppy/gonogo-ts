// The synthetic inputs behind the fixture table. Every row here is made up:
// seeded generators or hand-written edges. Nothing is read from anywhere else.

function rng(seed) { // mulberry32
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const round3 = (x) => Math.round(x * 1000) / 1000;
const range = (n) => [...Array(n).keys()];
const jsonl = (rows) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

/** n rows whose pass probability rises with confidence (well calibrated when slope = 1). */
function calibrated(seed, n, { slope = 1, offset = 0 } = {}) {
  const r = rng(seed);
  return range(n).map((i) => {
    const confidence = round3(r());
    return { id: `c-${i + 1}`, passed: r() < Math.min(1, offset + slope * confidence), confidence };
  });
}

function actionRows(seed, withConfidence) {
  const r = rng(seed);
  // [expected, taken] pairs covering every grading rule for non-answers.
  const plan = [
    ...Array(12).fill(["answer", "answer"]),
    ["answer", "abstain"], ["answer", "abstain"], ["answer", "wait"], ["answer", "react"],
    ["react", "react"], ["react", "react"], ["react", "answer"], ["react", "quiet"],
    ["quiet", "quiet"], ["quiet", "quiet"], ["quiet", "quiet"], ["quiet", "answer"],
    ["wait", "wait"], ["wait", "wait"], ["wait", "answer"], ["wait", "react"],
    ["abstain", "abstain"], ["abstain", "answer"],
  ];
  return plan.map(([expected, taken], i) => {
    const row = { id: `m-${i + 1}` };
    if (expected !== "answer") row.expected_action = expected;
    if (taken !== "answer") row.action = taken;
    if (expected !== "answer") row.passed = taken === expected;
    else row.passed = taken === "answer" ? r() < 0.85 : false;
    if (withConfidence) row.confidence = round3(0.3 + 0.7 * r());
    return row;
  });
}

function grouped(seed, groups, perGroup, { failGroups = [], confidence = false } = {}) {
  const r = rng(seed);
  return range(groups).flatMap((g) => range(perGroup).map((j) => {
    const row = { id: `check-${j}`, group: `run-${g}`, passed: !(failGroups.includes(g) && j === 1) };
    if (confidence) row.confidence = round3(failGroups.includes(g) ? 0.2 + 0.3 * r() : 0.6 + 0.4 * r());
    return row;
  }));
}

/** Rows with the cases at `at` (0-based) turned into errored ones, as a harness writes a crash. */
function withErrors(rows, at, { keepConfidence = false } = {}) {
  return rows.map((row, i) => {
    if (!at.includes(i)) return row;
    const { confidence, ...rest } = row;
    return { ...rest, passed: false, error: `RuntimeError: upstream timed out (${i + 1})`,
      ...(keepConfidence && confidence !== undefined ? { confidence } : {}) };
  });
}

// Top 25 of 40 at confidence >= 0.625, all passing: the review threshold lands
// on 0.625 and its coverage on 0.625, both exact ties for Python's rounding.
const tieRows = range(40).map((i) => i < 25
  ? { id: `t-${i}`, passed: true, confidence: i === 24 ? 0.625 : round3(0.7 + i / 100) }
  : { id: `t-${i}`, passed: i % 5 === 0, confidence: round3(0.1 + (i - 25) / 50) });

export const decideCases = [
  { name: "automate-no-confidence", flags: ["--target", "0.9"],
    text: jsonl(range(60).map((i) => ({ id: `c-${i + 1}`, passed: true }))) },
  { name: "automate-with-confidence", flags: ["--target", "0.6"], text: jsonl(calibrated(11, 150, { offset: 0.55 })) },
  { name: "review-threshold", flags: ["--target", "0.85"],
    text: jsonl(range(40).map((i) => ({ id: `c-${i + 1}`, passed: i < 30, confidence: round3(1 - i / 50) }))) },
  { name: "review-miscalibrated", flags: ["--target", "0.85"],
    text: jsonl(range(60).map((i) => ({ id: `c-${i + 1}`, passed: i < 45, confidence: round3(0.5 - i / 200) }))) },
  { name: "review-rounding-ties", flags: ["--target", "0.85"], text: jsonl(tieRows) },
  { name: "near-threshold-below-floor", flags: ["--target", "0.9", "--min-coverage", "0.6"],
    text: jsonl(range(100).map((i) => ({ id: `c-${i + 1}`, passed: i < 40 || i % 3 === 0,
      confidence: round3(i < 40 ? 0.99 - i / 1000 : 0.5 - i / 1000) }))) },
  { name: "insufficient-all-pass-small", flags: [],
    text: jsonl(range(10).map((i) => ({ id: `c-${i + 1}`, passed: true }))) },
  { name: "insufficient-one-row", flags: [], text: jsonl([{ id: "only", passed: true }]) },
  // The point equals the target: INSUFFICIENT EVIDENCE with no needed_n, since no n clears it.
  { name: "insufficient-point-at-target", flags: [],
    text: jsonl(range(20).map((i) => ({ id: `c-${i + 1}`, passed: i !== 11 }))) },
  // 0.875 * 4 = 3.5 inside required_n's search: Python's round() goes to even, and needed_n is 112, not 106.
  { name: "insufficient-needed-n-rounding", flags: ["--target", "0.8"],
    text: jsonl(range(8).map((i) => ({ id: `c-${i + 1}`, passed: i !== 3 }))) },
  { name: "insufficient-with-confidence", flags: ["--target", "0.9"],
    text: jsonl(range(50).map((i) => ({ id: `c-${i + 1}`, passed: i !== 7 && i !== 31, confidence: round3(0.4 + (i % 7) / 10) }))) },
  { name: "assist-only", flags: [],
    text: jsonl(range(30).map((i) => ({ id: `c-${i + 1}`, passed: i % 3 !== 0 }))) },
  { name: "do-not-automate", flags: [], text: jsonl(calibrated(23, 30, { slope: 0.6 })) },
  { name: "do-not-automate-one-row", flags: [], text: jsonl([{ id: "only", passed: false }]) },
  { name: "actions-with-confidence", flags: ["--target", "0.8"], text: jsonl(actionRows(31, true)) },
  { name: "actions-without-confidence", flags: ["--target", "0.8"], text: jsonl(actionRows(31, false)) },
  { name: "every-row-action-error", flags: [],
    text: jsonl(range(12).map((i) => ({ id: `e-${i + 1}`, passed: false, action: "error", detail: "agent error: Timeout" }))) },

  // Errored cases: an `error` key, or `action: "error"`; neither can pass.
  { name: "errors-partial-no-confidence", flags: ["--target", "0.85"],
    text: jsonl(withErrors(range(30).map((i) => ({ id: `c-${i + 1}`, passed: i % 11 !== 5 })), [3, 8, 26])) },
  { name: "errors-partial-with-confidence", flags: ["--target", "0.85"],
    text: jsonl(withErrors(calibrated(101, 60, { offset: 0.35 }), [2, 17, 40, 41])) },
  { name: "errors-partial-needed-n", flags: [],
    text: jsonl(withErrors(range(40).map((i) => ({ id: `c-${i + 1}`, passed: true })), [17])) },
  { name: "errors-partial-review", flags: ["--target", "0.85"],
    text: jsonl(withErrors(range(40).map((i) => ({ id: `c-${i + 1}`, passed: i < 30, confidence: round3(1 - i / 50) })),
      [33, 37], { keepConfidence: true })) },
  { name: "errors-own-confidence", flags: ["--target", "0.85"],
    text: jsonl(withErrors(calibrated(103, 40, { offset: 0.35 }), [1, 5, 9, 30], { keepConfidence: true })) },
  { name: "errors-only-errored-confidence", flags: [], text: jsonl([
    ...range(8).map((i) => ({ id: `c-${i + 1}`, passed: i !== 2 })),
    { id: "e-1", passed: false, error: "boom", confidence: 0.2 },
    { id: "e-2", passed: false, action: "error", confidence: 0.6 },
    { id: "e-3", passed: false, error: "boom" }]) },
  { name: "errors-grouped", flags: ["--group-rule", "all", "--target", "0.75"],
    text: jsonl(withErrors(grouped(105, 12, 3, { failGroups: [5], confidence: true }), [4, 13, 14])) },
  { name: "errors-with-actions", flags: ["--target", "0.8"], text: jsonl([
    ...withErrors(actionRows(107, true), [0]),
    { id: "x-wait", expected_action: "wait", passed: false, error: "RuntimeError: tool unavailable" },
    { id: "x-react", expected_action: "react", passed: false, action: "error", confidence: 0.4 },
    { id: "x-both", passed: false, action: "error", error: "ValueError: bad input", detail: "kept" }]) },
  { name: "errors-all-error-key", flags: ["--target", "0.85"],
    text: jsonl(range(30).map((i) => ({ id: `c-${i + 1}`, passed: false, error: "harness down" }))) },
  { name: "errors-all-action-error-with-confidence", flags: [],
    text: jsonl(range(6).map((i) => ({ id: `c-${i + 1}`, passed: false, action: "error", confidence: round3(0.1 + i / 10) }))) },
  { name: "errors-all-grouped", flags: ["--group-rule", "all"],
    text: jsonl(range(4).flatMap((g) => range(3).map((j) => ({ id: `k${j}`, group: `run-${g}`, passed: false, error: "boom" })))) },
  { name: "errors-all-one-row", flags: [], text: jsonl([{ id: "only", passed: false, error: "boom" }]) },
  { name: "errors-null-is-absent", flags: [], text: jsonl([
    { id: "a", passed: true, error: null }, { id: "b", passed: false, error: null, action: "wait" },
    ...range(10).map((i) => ({ id: `c-${i + 1}`, passed: i !== 4 }))]) },
  // A decide output's cases fed back as rows: `casesOf` names the fixture whose expected.json supplies them.
  { name: "errors-round-trip-partial", flags: ["--target", "0.85"], casesOf: "errors-partial-with-confidence" },
  { name: "errors-round-trip-actions", flags: ["--target", "0.8"], casesOf: "errors-with-actions" },
  { name: "errors-round-trip-all", flags: ["--target", "0.85"], casesOf: "errors-all-error-key" },
  { name: "errors-round-trip-grouped", flags: ["--group-rule", "all", "--target", "0.75"], casesOf: "errors-grouped" },

  { name: "grouped-rule-none", flags: ["--group-rule", "none"], text: jsonl(grouped(41, 10, 3, { failGroups: [2] })) },
  { name: "grouped-rule-all", flags: ["--group-rule", "all"], text: jsonl(grouped(41, 10, 3, { failGroups: [2] })) },
  { name: "grouped-rule-all-confidence", flags: ["--group-rule", "all", "--target", "0.75"],
    text: jsonl(grouped(43, 40, 3, { failGroups: [3, 9, 17, 22, 30], confidence: true })) },
  { name: "level-0.80", flags: ["--level", "0.8", "--target", "0.7"], text: jsonl(calibrated(51, 40, { offset: 0.5 })) },
  { name: "level-0.90", flags: ["--level", "0.9", "--target", "0.85"],
    text: jsonl(range(45).map((i) => ({ id: `c-${i + 1}`, passed: i !== 4 }))) },
  { name: "level-0.99", flags: ["--level", "0.99"], text: jsonl(calibrated(53, 80, { offset: 0.3 })) },
  { name: "level-0.85-acklam", flags: ["--level", "0.85", "--target", "0.8"],
    text: jsonl(range(70).map((i) => ({ id: `c-${i + 1}`, passed: i % 9 !== 0 }))) },
  { name: "row-shapes", flags: ["--task", "row shapes"], text: [
    "// comments and blank lines are skipped; default ids use the file line",
    "",
    JSON.stringify({ passed: true }),
    JSON.stringify({ id: 0, passed: true, detail: 7 }),
    JSON.stringify({ id: 7, passed: false, detail: null, score: "0.25" }),
    "   " + JSON.stringify({ id: "", passed: true, score: true, extra: { k: [1, 2] } }) + "   ",
    JSON.stringify({ id: "obj", passed: false, detail: { why: "it's", n: [1, true, null, 1.5] } }),
    JSON.stringify({ id: "café", passed: true, detail: "unicode é 😀" }),
    "",
  ].join("\r\n") },
  { name: "score-infinite", flags: [], text: jsonl([{ id: "a", passed: true, score: "inf" }, { id: "b", passed: true, score: "nan" }]) },

  // Refusals: the same rows Python refuses, with Python's message.
  { name: "refuse-passed-with-wait", flags: [], text: jsonl([{ id: "ok", passed: true }, { passed: true, action: "wait" }]) },
  { name: "refuse-expected-action-mismatch", flags: [],
    text: jsonl([{ id: "ok", passed: true }, { passed: true, expected_action: "quiet", action: "answer" }]) },
  { name: "refuse-passed-not-bool", flags: [], text: jsonl([{ id: "ok", passed: true }, { passed: "yes" }]) },
  { name: "refuse-passed-missing", flags: [], text: jsonl([{ id: "ok" }]) },
  { name: "refuse-confidence-out-of-range", flags: [], text: jsonl([{ passed: true, confidence: 0.5 }, { passed: true, confidence: 1.5 }]) },
  { name: "refuse-confidence-int-out-of-range", flags: [], text: jsonl([{ passed: true, confidence: 2 }]) },
  { name: "refuse-confidence-bool", flags: [], text: jsonl([{ passed: true, confidence: true }]) },
  { name: "refuse-confidence-string", flags: [], text: jsonl([{ passed: true, confidence: "0.5" }]) },
  { name: "refuse-action-empty", flags: [], text: jsonl([{ passed: false, action: "" }]) },
  { name: "refuse-expected-action-null", flags: [], text: jsonl([{ passed: false, expected_action: null }]) },
  { name: "refuse-abstain-passing", flags: [], text: jsonl([{ passed: true, action: "abstain" }]) },
  { name: "refuse-mixed-confidence", flags: [], text: jsonl([{ passed: true, confidence: 0.9 }, { passed: true }]) },
  { name: "refuse-no-results", flags: [], text: "// nothing but a comment\n\n" },
  { name: "refuse-not-object", flags: [], text: jsonl([{ passed: true }, [1, 2]]) },
  { name: "refuse-invalid-json", flags: [], text: '{"passed": true}\n{"passed": tru}\n' },
  { name: "refuse-score-string", flags: [], text: jsonl([{ passed: true, score: "abc" }]) },
  { name: "refuse-group-missing-some", flags: ["--group-rule", "all"],
    text: jsonl([{ id: "a", group: "g", passed: true }, ...range(4).map((i) => ({ id: `u${i}`, passed: true }))]) },
  { name: "refuse-error-passing", flags: [], text: jsonl([{ id: "ok", passed: true }, { passed: true, error: "boom" }]) },
  { name: "refuse-action-error-passing", flags: [], text: jsonl([{ id: "ok", passed: true }, { passed: true, action: "error" }]) },
  { name: "refuse-error-with-action-wait", flags: [],
    text: jsonl([{ id: "ok", passed: true }, { id: "ok2", passed: true }, { passed: false, error: "boom", action: "wait" }]) },
  { name: "refuse-error-with-action-answer", flags: [], text: jsonl([{ passed: false, error: "boom", action: "answer" }]) },
  { name: "refuse-error-with-action-abstain", flags: [], text: jsonl([{ passed: false, error: "it's down", action: "abstain" }]) },
  { name: "refuse-error-empty", flags: [], text: jsonl([{ id: "ok", passed: true }, { passed: false, error: "" }]) },
  { name: "refuse-error-number", flags: [], text: jsonl([{ passed: false, error: 3 }]) },
  { name: "refuse-error-false", flags: [], text: jsonl([{ passed: false, error: false }]) },
  { name: "refuse-error-object", flags: [], text: jsonl([{ passed: false, error: { type: "Timeout", n: [1, 2.5] } }]) },
  { name: "refuse-error-passing-confidence-out-of-range", flags: [], text: jsonl([{ passed: true, error: "boom", confidence: 1.5 }]) },
  { name: "refuse-error-confidence-out-of-range", flags: [], text: jsonl([{ passed: false, error: "boom", confidence: 1.5 }]) },
  { name: "refuse-mixed-confidence-beside-errors", flags: [], text: jsonl([
    { id: "a", passed: true, confidence: 0.9 }, { id: "b", passed: false, error: "boom" }, { id: "e", passed: true }]) },
  { name: "refuse-group-missing-all", flags: ["--group-rule", "all"], text: jsonl([{ id: "a", passed: true }]) },
];

/** A Report.to_dict()-shaped payload with only what compare reads. */
function payload(outcomes, extra = {}) {
  return { ...extra, cases: outcomes.map(([id, passed, group]) => (group === undefined ? { id, passed } : { id, passed, group })) };
}

/** n shared cases split into both-pass, both-fail, only-A and only-B. */
function paired(bothPassed, bothFailed, onlyA, onlyB) {
  const a = [];
  const b = [];
  let i = 0;
  const push = (k, x, y) => { for (let j = 0; j < k; j++, i++) { a.push([`p-${i}`, x]); b.push([`p-${i}`, y]); } };
  push(bothPassed, true, true);
  push(bothFailed, false, false);
  push(onlyA, true, false);
  push(onlyB, false, true);
  return [payload(a), payload(b)];
}

const coin = (seed, n, p) => { const r = rng(seed); return range(n).map((i) => ({ id: `c-${i}`, passed: r() < p })); };
const [borderA, borderB] = paired(200, 8, 14, 28); // the docstring's example: p=0.044, interval includes 0
const [chiA, chiB] = paired(300, 100, 480, 620);
const [zeroA, zeroB] = paired(30, 10, 0, 0);
const [partA] = paired(20, 5, 3, 1);

// Each side is either rows decided by the Python CLI first ({ rows, flags }) or a payload ({ json }).
export const compareCases = [
  { name: "distinguishable-b-better", flags: [],
    a: { rows: coin(61, 80, 0.6) }, b: { rows: coin(61, 80, 0.6).map((r, i) => ({ ...r, passed: r.passed || i % 5 !== 0 })) } },
  { name: "distinguishable-a-better", flags: [],
    a: { rows: range(60).map((i) => ({ id: `c-${i}`, passed: i % 10 !== 0 })) },
    b: { rows: range(60).map((i) => ({ id: `c-${i}`, passed: i % 2 === 0 })) } },
  { name: "borderline", flags: [], a: { json: borderA }, b: { json: borderB } },
  { name: "not-distinguishable", flags: [], a: { rows: coin(71, 50, 0.8) }, b: { rows: coin(72, 50, 0.8) } },
  { name: "zero-discordant", flags: [], a: { json: zeroA }, b: { json: zeroB } },
  { name: "same-report-twice", flags: [], a: { rows: coin(73, 30, 0.7) }, b: { rows: coin(73, 30, 0.7) } },
  { name: "chi-square-approximation", flags: [], a: { json: chiA }, b: { json: chiB } },
  { name: "partial-overlap", flags: [], a: { json: partA },
    b: { json: payload([...partA.cases.slice(5).map((c) => [c.id, !c.passed || c.id.endsWith("7")]), ["new-1", true]]) } },
  { name: "level-0.90", flags: ["--level", "0.9"], a: { rows: coin(81, 120, 0.7) }, b: { rows: coin(82, 120, 0.8) } },
  { name: "grouped", flags: [],
    a: { rows: grouped(91, 20, 3, { failGroups: [1, 4, 8, 11, 15, 19] }), flags: ["--group-rule", "all"] },
    b: { rows: grouped(92, 20, 3, { failGroups: [4] }), flags: ["--group-rule", "all"] } },
  { name: "grouped-implicit", flags: [],
    a: { json: payload([["x", true, "g1"], ["y", false, "g1"], ["x", true, "g2"], ["y", true, "g2"]]) },
    b: { json: payload([["x", true, "g1"], ["y", true, "g1"], ["x", true, "g2"], ["y", true, "g2"]]) } },
  { name: "refuse-ungrouped-decide-of-grouped-rows", flags: [],
    a: { rows: grouped(93, 5, 2, { failGroups: [0] }) }, b: { rows: grouped(93, 5, 2, {}) } },

  { name: "errored-side", flags: [],
    a: { rows: withErrors(coin(111, 60, 0.75), [4, 9, 33, 50]) }, b: { rows: coin(112, 60, 0.85) } },
  { name: "all-errored-side", flags: [],
    a: { rows: range(40).map((i) => ({ id: `c-${i}`, passed: false, error: "harness down" })) }, b: { rows: coin(113, 40, 0.8) } },

  { name: "refuse-not-a-report", flags: [], a: { json: {} }, b: { json: {} } },
  { name: "refuse-top-level-list", flags: [], a: { json: [] }, b: { json: payload([["a", true]]) } },
  { name: "refuse-no-shared-ids", flags: [], a: { json: payload([["a", true]]) }, b: { json: payload([["b", true]]) } },
  { name: "refuse-grouped-vs-ungrouped", flags: [],
    a: { json: payload([["a", true, "g"]]) }, b: { json: payload([["a", true]]) } },
  { name: "refuse-membership-differs", flags: [],
    a: { json: payload([["a", true, "g"], ["b", true, "g"]]) }, b: { json: payload([["a", true, "g"]]) } },
  { name: "refuse-duplicate-id", flags: [], a: { json: payload([["a", true], ["a", false]]) }, b: { json: payload([["a", true]]) } },
  { name: "refuse-duplicate-id-in-group", flags: [],
    a: { json: payload([["a", true, "g"], ["a", false, "g"]]) }, b: { json: payload([["a", true, "g"]]) } },
  { name: "refuse-passed-not-bool", flags: [], a: { json: { cases: [{ id: 3, passed: 1 }] } }, b: { json: payload([["3", true]]) } },
  { name: "refuse-missing-id", flags: [], a: { json: { cases: [{ passed: true }] } }, b: { json: payload([["a", true]]) } },
  { name: "refuse-grouped-missing-group", flags: [],
    a: { json: { n_groups: 1, cases: [{ id: "a", passed: true }] } }, b: { json: payload([["a", true, "g"]]) } },
];
