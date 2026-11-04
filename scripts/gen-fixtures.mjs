// Runs the INSTALLED gonogo CLI over the synthetic inputs and writes the fixture
// table to the directory given (default: fixtures/). GONOGO overrides the CLI path.
//   node scripts/gen-fixtures.mjs [out-dir]
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { compareCases, decideCases } from "./inputs.mjs";
import { MANIFEST, tableDigest } from "./table.mjs";

const GONOGO = process.env.GONOGO ?? join(homedir(), ".local/bin/gonogo");
const out = resolve(process.argv[2] ?? "fixtures");

/** One CLI run in `cwd`: the raw stdout on success, or the argparse error message. */
function run(cwd, args) {
  const r = spawnSync(GONOGO, args, { cwd, encoding: "utf8" });
  if (r.status === 0) return { stdout: r.stdout };
  const prefix = "gonogo: error: ";
  const line = r.stderr.split("\n").find((l) => l.startsWith(prefix));
  if (r.status !== 2 || !line) throw new Error(`${cwd}: gonogo ${args.join(" ")} exited ${r.status}:\n${r.stderr}`);
  return { error: line.slice(prefix.length) };
}

function record(dir, result) {
  if (result.stdout !== undefined) writeFileSync(join(dir, "expected.json"), result.stdout);
  else writeFileSync(join(dir, "expected-error.txt"), result.error + "\n");
}

const version = execFileSync(GONOGO, ["--version"], { encoding: "utf8" }).trim();
rmSync(out, { recursive: true, force: true });

for (const c of decideCases) {
  const dir = join(out, "decide", c.name);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "input.jsonl"), c.text);
  writeFileSync(join(dir, "flags.json"), JSON.stringify(c.flags) + "\n");
  record(dir, run(dir, ["decide", "input.jsonl", ...c.flags, "--json"]));
}

for (const c of compareCases) {
  const dir = join(out, "compare", c.name);
  mkdirSync(dir, { recursive: true });
  for (const [side, spec] of [["a", c.a], ["b", c.b]]) {
    if (spec.json !== undefined) {
      writeFileSync(join(dir, `${side}.json`), JSON.stringify(spec.json) + "\n");
      continue;
    }
    // A side that is a decide run: keep the rows, and let Python write the report.
    writeFileSync(join(dir, `${side}.jsonl`), spec.rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
    const decided = run(dir, ["decide", `${side}.jsonl`, ...(spec.flags ?? []), "--json"]);
    if (decided.stdout === undefined) throw new Error(`${dir}: side ${side} did not decide: ${decided.error}`);
    writeFileSync(join(dir, `${side}.json`), decided.stdout);
  }
  writeFileSync(join(dir, "flags.json"), JSON.stringify(c.flags) + "\n");
  record(dir, run(dir, ["compare", "a.json", "b.json", ...c.flags, "--json"]));
}

// Direct unit-test values, from the Python the CLI itself runs on (its shebang).
const python = readFileSync(GONOGO, "utf8").split("\n")[0].replace(/^#!/, "").trim();
const units = execFileSync(python, ["-I", resolve(import.meta.dirname, "units.py")], { encoding: "utf8" });
writeFileSync(join(out, "units.json"), units);

const digest = tableDigest(out);
const manifest = {
  gonogo: version,
  generator: "scripts/gen-fixtures.mjs over scripts/inputs.mjs (synthetic, seeded)",
  decide: decideCases.length,
  compare: compareCases.length,
  files: digest.files,
  sha256: digest.sha256,
};
writeFileSync(join(out, MANIFEST), JSON.stringify(manifest, null, 2) + "\n");
console.log(`${version}: ${decideCases.length} decide + ${compareCases.length} compare fixtures, sha256 ${digest.sha256}`);
