// Deep equality with floats compared at a relative tolerance and everything else exactly.
import assert from "node:assert/strict";

export const REL = 1e-9;

export function assertClose(actual: unknown, expected: unknown, path = "$"): void {
  if (typeof actual === "number" && typeof expected === "number") {
    const ok = actual === expected || Math.abs(actual - expected) <= REL * Math.max(Math.abs(actual), Math.abs(expected));
    assert.ok(ok, `${path}: ${actual} != ${expected}`);
    return;
  }
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `${path}: expected an array, got ${JSON.stringify(actual)}`);
    assert.equal(actual.length, expected.length, `${path}: length`);
    expected.forEach((e, i) => assertClose(actual[i], e, `${path}[${i}]`));
    return;
  }
  if (expected !== null && typeof expected === "object") {
    assert.ok(actual !== null && typeof actual === "object" && !Array.isArray(actual), `${path}: expected an object`);
    const a = actual as Record<string, unknown>;
    const e = expected as Record<string, unknown>;
    assert.deepEqual(Object.keys(a).sort(), Object.keys(e).sort(), `${path}: keys`);
    for (const k of Object.keys(e)) assertClose(a[k], e[k], `${path}.${k}`);
    return;
  }
  assert.equal(actual, expected, path);
}
