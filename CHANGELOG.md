# Changelog

All notable changes to this package are documented here. Each release names the gonogo version
its fixture table was generated from (`package.json` `gonogo.pinnedTo`).

## [0.3.0] - 2026-11-06

Pinned to gonogo 0.4.6. Follows the four behaviours this port surfaced and gonogo fixed:

- `compare` pairs a `groupRule: "none"` report of grouped rows on (group, id), one trial per row;
  it refused with `duplicate case id` (fixture renamed `ungrouped-decide-of-grouped-rows`).
- A point estimate exactly at the target says it is *at* the target and why more cases at that
  rate won't settle it (verdict and `needed_n: null` unchanged).
- Thresholds and calibration errors print with 2 to 4 places, the fewest that reproduce them
  (0.625, not "0.62"); coverage prints one decimal when it isn't whole (62.5%).
- A run whose answered rows carry no confidence of their own gets `calibration_error: null` and a
  note; the abstention threshold stays.

Fixture table regenerated from PyPI's gonogo-eval 0.4.6 (97 fixtures, 334 files); `units.json`
also pins gonogo's `fmt_cut` and `fmt_share`.

## [0.2.0] - 2026-11-04

Pinned to gonogo 0.4.5: errored cases (`error`, or `action: "error"`) in `decide`; every case
errored is INSUFFICIENT EVIDENCE; a partial-error note. First release on npm.

## [0.1.0] - 2026-11-04

The port of gonogo's decision core (`decide`, `compare`), pinned to gonogo 0.4.4. Not published.
