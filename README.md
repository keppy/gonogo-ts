# gonogo-eval (TypeScript)

`npm install gonogo-eval`. The name matches the Python package on PyPI.

A TypeScript port of the decision core of [gonogo](https://github.com/keppy/gonogo)
(`gonogo-eval` on PyPI): the verdict on a measured pass rate, and the paired comparison of
two runs. Zero runtime dependencies. ESM only, Node 22.18 or later.

It is pinned to the Python implementation by a fixture table: `fixtures/` holds input files,
the flags they were run with, and what the installed Python CLI printed. The test suite replays
every one. `fixtures/manifest.json` records the gonogo version (`gonogo-eval 0.4.6`) and a
sha256 of the table; `package.json` records the same version under `gonogo.pinnedTo`.

## Use

```ts
import { compare, decide } from "gonogo-eval";

// The rows `gonogo decide RESULTS.jsonl` reads: JSONL text, or an array of objects.
const a = decide(jsonlText, { target: 0.9, groupRule: "none", source: "a.jsonl" });
// deep-equal to: gonogo decide a.jsonl --target 0.9 --json

const c = compare(a, b, { level: 0.95 });
// deep-equal to: gonogo compare a.json b.json --json
```

`decide` options map to the CLI's flags: `target` (`--target`, default 0.95), `level`
(`--level`, 0.95), `minCoverage` (`--min-coverage`, 0.25), `groupRule` (`--group-rule`,
`"none"` or `"all"`), `task` (`--task`). `source` is what the CLI records as
`metadata.source` (the path it was given); leave it out and `metadata` has only `group_rule`.

A row with `error` (a non-empty string) or `action: "error"` is an errored case: it cannot pass,
and when every case errored the verdict is INSUFFICIENT EVIDENCE.

A row gonogo refuses is refused here with the same message, as a `GonogoRowError` carrying
`index` (0-based, among rows) and `line` (the JSONL line, or `index + 1` for an array). Other
refusals are a `GonogoError`.

## The pin

```sh
npm test                 # replay every fixture, plus direct unit tests of the primitives
npm run check-fixtures   # regenerate the table with the installed Python CLI and diff it
npm run gen-fixtures     # rewrite fixtures/ (after a gonogo release that changes a shape)
```

`check-fixtures` and `gen-fixtures` run `~/.local/bin/gonogo` (override with `GONOGO=`).
Every input is synthetic: seeded generators and hand-written edges in `scripts/inputs.mjs`.
Floats are compared at a relative tolerance of 1e-9; every other value, including every
string in `reason` and `notes`, exactly.

## Where it departs from Python

`JSON.parse` cannot tell `1` from `1.0`, so a whole-number float in an `id`, `group` or
`detail`, or in a refused `error`, becomes `"1"` where Python writes `"1.0"`; Python's `NaN`
and `Infinity` JSON literals are refused as invalid JSON; the text after `invalid JSON:` is
JavaScript's; a malformed `cases` value in a compare payload is refused with a `GonogoError`
where Python crashes; and `repr()` of a non-ASCII non-printable character other than C1 controls, U+00A0,
U+2028/9 and lone surrogates is not escaped.

## License

MIT, as gonogo.
