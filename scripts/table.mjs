// The fixture table's digest: sha256 over every file's path and sha256, sorted by path.
import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const MANIFEST = "manifest.json";

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

export function tableDigest(root) {
  const files = walk(root).map((p) => relative(root, p).split("\\").join("/")).filter((p) => p !== MANIFEST).sort();
  const h = createHash("sha256");
  for (const f of files) h.update(`${f}\n${createHash("sha256").update(readFileSync(join(root, f))).digest("hex")}\n`);
  return { files: files.length, sha256: h.digest("hex") };
}
