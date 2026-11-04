// The primitives against values the installed gonogo's Python computed (fixtures/units.json).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { erfc, mcnemar } from "../src/compare.ts";
import { fixed, percent } from "../src/py.ts";
import { requiredN, wilson, zFor } from "../src/stats.ts";
import { assertClose } from "./close.ts";

const units = JSON.parse(readFileSync(join(import.meta.dirname, "..", "fixtures", "units.json"), "utf8"));

test("wilson", () => {
  for (const [s, n, level, low, high] of units.wilson) {
    const i = wilson(s, n, level);
    assertClose([i.low, i.high], [low, high], `wilson(${s}, ${n}, ${level})`);
  }
  assert.ok(Number.isNaN(wilson(0, 0).point));
});

test("required_n", () => {
  for (const [rate, target, level, n] of units.required_n) assert.equal(requiredN(rate, target, level), n);
});

test("z_for off the table (Acklam)", () => {
  for (const [level, z] of units.z_for) assertClose(zFor(level), z, `z_for(${level})`);
});

test("McNemar, exact and chi-square", () => {
  for (const [a, b, p, exact] of units.mcnemar) assertClose(mcnemar(a, b), [p, exact], `mcnemar(${a}, ${b})`);
});

test("erfc", () => {
  for (const [x, y] of units.erfc) assertClose(erfc(x), y, `erfc(${x})`);
});

test("Python's fixed and percent formatting, ties to even", () => {
  for (const [x, d, f, pct] of units.format) {
    assert.equal(fixed(x, d), f, `format(${x}, '.${d}f')`);
    assert.equal(percent(x, d), pct, `format(${x}, '.${d}%')`);
  }
});
