// Replays every fixture the Python CLI wrote and deep-compares the result.
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { compare, decide, GonogoError, GonogoRowError, type DecideOptions } from "../src/index.ts";
import { tableDigest } from "../scripts/table.mjs";
import { assertClose } from "./close.ts";

const ROOT = join(import.meta.dirname, "..", "fixtures");
const read = (...p: string[]) => readFileSync(join(ROOT, ...p), "utf8");
const json = (...p: string[]) => JSON.parse(read(...p));
const names = (verb: string) => readdirSync(join(ROOT, verb)).sort();

// Python's JSON error text is its own; only the "invalid JSON:" refusal and its line are pinned.
const PREFIX_ONLY = new Set(["decide/refuse-invalid-json"]);

function options(flags: string[]): DecideOptions & { level?: number } {
  const opts: DecideOptions = { source: "input.jsonl" };
  for (let i = 0; i < flags.length; i += 2) {
    const [flag, value] = [flags[i], flags[i + 1]];
    if (flag === "--target") opts.target = Number(value);
    else if (flag === "--level") opts.level = Number(value);
    else if (flag === "--min-coverage") opts.minCoverage = Number(value);
    else if (flag === "--group-rule") opts.groupRule = value as DecideOptions["groupRule"];
    else if (flag === "--task") opts.task = value;
    else throw new Error(`unknown flag ${flag}`);
  }
  return opts;
}

function check(id: string, run: () => unknown, dir: string[]): void {
  if (existsSync(join(ROOT, ...dir, "expected.json"))) {
    assertClose(run(), json(...dir, "expected.json"));
    return;
  }
  const message = read(...dir, "expected-error.txt").trimEnd();
  assert.throws(run, (err: unknown) => {
    assert.ok(err instanceof GonogoError, `${id}: not a GonogoError: ${err}`);
    if (PREFIX_ONLY.has(id)) assert.ok(err.message.startsWith(message.slice(0, message.indexOf("invalid JSON:") + 13)));
    else assert.equal(err.message, message);
    const line = /^input\.jsonl:(\d+): /.exec(message);
    if (line) {
      assert.ok(err instanceof GonogoRowError, `${id}: a row refusal should be a GonogoRowError`);
      assert.equal(err.line, Number(line[1]));
    }
    return true;
  });
}

for (const name of names("decide")) {
  test(`decide/${name}`, () => {
    const dir = ["decide", name];
    check(dir.join("/"), () => decide(read(...dir, "input.jsonl"), options(json(...dir, "flags.json"))), dir);
  });
}

for (const name of names("compare")) {
  test(`compare/${name}`, () => {
    const dir = ["compare", name];
    const { level } = options(json(...dir, "flags.json"));
    check(dir.join("/"), () => compare(json(...dir, "a.json"), json(...dir, "b.json"), level === undefined ? {} : { level }), dir);
  });
}

test("the table matches its manifest, and the package records the same gonogo", () => {
  const manifest = json("manifest.json");
  const digest = tableDigest(ROOT);
  assert.equal(digest.sha256, manifest.sha256);
  assert.equal(digest.files, manifest.files);
  assert.equal(names("decide").length, manifest.decide);
  assert.equal(names("compare").length, manifest.compare);
  const pkg = JSON.parse(readFileSync(join(ROOT, "..", "package.json"), "utf8"));
  assert.equal(manifest.gonogo, `gonogo-eval ${pkg.gonogo.pinnedTo}`);
});

test("an array of rows decides like the file it came from", () => {
  const text = read("decide", "actions-with-confidence", "input.jsonl");
  const rows = text.trim().split("\n").map((l) => JSON.parse(l));
  assertClose(decide(rows, options(["--target", "0.8"])), json("decide", "actions-with-confidence", "expected.json"));
  assert.throws(() => decide([{ passed: true }, { passed: true, action: "wait" }]),
    (e: unknown) => e instanceof GonogoRowError && e.index === 1 && e.line === 2 && e.message.startsWith("rows:2: "));
});
