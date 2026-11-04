// Regenerates the fixture table into a temp dir with the installed gonogo and
// diffs it against the committed one. Exit 0 means Python still writes this table.
// Another platform's libm can move a float's last digits (math.erfc on Linux vs
// macOS), so a JSON file that differs only within the replay tolerance is reported
// by name and passes; any other difference is drift.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { REL, assertClose } from "../test/close.ts";

const committed = resolve(import.meta.dirname, "..", "fixtures");
const fresh = mkdtempSync(join(tmpdir(), "gonogo-fixtures-"));
try {
  execFileSync("node", [resolve(import.meta.dirname, "gen-fixtures.mjs"), fresh], { stdio: "inherit" });
  const read = (dir, rel) => JSON.parse(readFileSync(join(dir, rel), "utf8"));
  const [c, f] = [read(committed, "manifest.json"), read(fresh, "manifest.json")];
  console.log(`committed: ${c.gonogo}, ${c.files} files, sha256 ${c.sha256}`);
  console.log(`fresh:     ${f.gonogo}, ${f.files} files, sha256 ${f.sha256}`);

  const diff = spawnSync("diff", ["-rq", committed, fresh], { encoding: "utf8" });
  const drift = [];
  const close = [];
  if (c.gonogo !== f.gonogo || c.files !== f.files) drift.push("manifest.json: gonogo version or file count");
  for (const line of diff.stdout.split("\n").filter(Boolean)) {
    const m = line.match(/^Files (.+) and (.+) differ$/);
    const rel = m?.[1].slice(committed.length + 1);
    if (!m || !rel.endsWith(".json")) { drift.push(line); continue; }
    if (rel === "manifest.json") continue; // its sha256 follows the files; version and count checked above
    try {
      assertClose(read(fresh, rel), read(committed, rel));
      close.push(rel);
    } catch (err) {
      drift.push(`${rel}: ${err.message.split("\n")[0]}`);
    }
  }

  if (drift.length) {
    for (const d of drift) console.log(`  ${d}`);
    console.log("check-fixtures: DRIFT, the installed gonogo writes a different table");
    process.exitCode = 1;
  } else if (close.length) {
    console.log(`check-fixtures: OK; ${close.length} file(s) differ only within ${REL} (float digits):`);
    for (const rel of close) console.log(`  ${rel}`);
  } else {
    console.log("check-fixtures: OK, the installed gonogo reproduces the committed table byte for byte");
  }
} finally {
  rmSync(fresh, { recursive: true, force: true });
}
