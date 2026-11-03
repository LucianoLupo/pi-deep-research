## Product
`ro/orchestrate.mjs` will stop silently accepting malformed numeric flags. Today `--agents 3x`, `--agents 2.5` and `--timeout-ms 600000ms` are truncated by `Number.parseInt` and the run proceeds with 3, 2 and 600000. After the change, any value for `--agents`, `--concurrency`, `--timeout-ms`, `--kill-grace-ms` or `--retries` that is not a plain string of decimal digits fails with the existing message `<flag> must be an integer between <min> and <max>`, and the process exits non-zero. Valid values behave exactly as before.

Out of scope: changing the error message format, accepting signs, decimals, exponents or whitespace, changing any flag's min/max, and changing how `main()` reports argument errors. (`parseArgs` runs outside `main`'s try/catch, so it already surfaces as an uncaught rejection with a stack trace and exit code 1. This stays as is.)

## Technical
Files to change:
- `ro/orchestrate.mjs`: `parsePositiveInteger` (lines 72-78).
- `ro/test/orchestrate.test.mjs`: add tests.

Approach:
- In `parsePositiveInteger`, test `/^\d+$/` against `String(raw)` and call `fail` with the unchanged message if it doesn't match. Otherwise set `value = Number(raw)` (or `parseInt(raw, 10)`) and keep the existing `Number.isInteger`, `min` and `max` check. Huge digit strings become large numbers or `Infinity`, which the `max` check already rejects. Use `Number.isSafeInteger` if stricter handling is wanted.
- `\d` in JS without the `u` or `v` flag matches only ASCII 0-9. Leading zeros such as `03` stay accepted, as they are today.
- Every caller shares the helper (`--agents`, `--concurrency`, `--timeout-ms`, `--kill-grace-ms`, `--retries`), so all five get the stricter validation.

Tests (in `ro/test/orchestrate.test.mjs`, using the existing `run` helper, `--dry-run`, `--pi-bin fakePi` and a temp `--output` directory):
- Add a helper that runs `node orchestrate.mjs "fixture topic" <flag args> --dry-run --output <tmp>/run --pi-bin fakePi`.
- Each of these asserts `code !== 0` and that stderr matches the exact message:
  - `--agents 3x` → `/--agents must be an integer between 2 and 6/`
  - `--agents 2.5` → same message
  - `--agents 1` → same message (below min)
  - `--agents 7` → same message (above max)
  - `--timeout-ms 600000ms` → `/--timeout-ms must be an integer between 1000 and 3600000/`
- Control: `--agents 2` exits 0 and stdout parses to JSON with `dryRun: true`.
- Optionally assert that the output directory was not created in the failing cases.
- Verification: `npm test` passes with the fix. Stash the `orchestrate.mjs` change and confirm that the `3x`, `2.5` and `600000ms` tests fail while the `1`, `7` and control tests pass on the old code. `npm run lint` must still pass.

Risk notes:
- Behaviour change for anyone passing values like `3.0`, `+3` or `" 3"` (previously accepted). Scripts that relied on that now fail. This is intended by the issue.
- The shared helper affects all five numeric flags. Reviewers should confirm that no caller passes a non-string. `next()` always returns a string from argv.
- Error output for bad flags is an uncaught-exception stack trace, because `parseArgs` is outside the try/catch. The tests should match on the message text only, not the stack format.
- No data loss, security, migration or public-interface change beyond the stricter CLI validation. Dry-run tests write only to temp directories. A manual check I ran while writing this spec created one stray dry-run directory under the default output root (`~/Documents/Research/ro-runs`, suffix `-x`). The tests must always pass `--output`.
