// Regenerates the fixture table into a temp dir with the installed gonogo and
// diffs it against the committed one. Exit 0 means Python still writes this table.
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const committed = resolve(import.meta.dirname, "..", "fixtures");
const fresh = mkdtempSync(join(tmpdir(), "gonogo-fixtures-"));
try {
  execFileSync("node", [resolve(import.meta.dirname, "gen-fixtures.mjs"), fresh], { stdio: "inherit" });
  const diff = spawnSync("diff", ["-rq", committed, fresh], { encoding: "utf8" });
  const read = (dir) => JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const [c, f] = [read(committed), read(fresh)];
  console.log(`committed: ${c.gonogo}, ${c.files} files, sha256 ${c.sha256}`);
  console.log(`fresh:     ${f.gonogo}, ${f.files} files, sha256 ${f.sha256}`);
  if (diff.status === 0) {
    console.log("check-fixtures: OK, the installed gonogo reproduces the committed table byte for byte");
  } else {
    console.log(diff.stdout);
    console.log("check-fixtures: DRIFT, the installed gonogo writes a different table (see diff above)");
    process.exitCode = 1;
  }
} finally {
  rmSync(fresh, { recursive: true, force: true });
}
