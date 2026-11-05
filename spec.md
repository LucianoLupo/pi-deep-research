# Spec: one-line error for bad command-line flags (#3)

## Product
Running `node ro/orchestrate.mjs` with a bad flag (unknown option, a numeric flag outside its range or not an integer,
missing value, bad topic/`--resume` combination) or with another failure in `initialise` (e.g. output directory already
exists) now prints exactly one line to stderr, `[deep-research-ro] <message>`, with no stack trace, and exits with
code 1. A failure in the middle of a run keeps its current behaviour (`failed` phase mark, stack printed, exit code 1).
`--help` still prints usage and exits 0.

Out of scope: restructuring `main`, changing the flag set or any validation rule or message, and changes to `SKILL.md`,
`skills/**`, `package.json`, `package-lock.json`.

## Technical
Files:
- `ro/orchestrate.mjs`: replace the final bare `main();` with a single top-level handler:
  ```js
  main().catch((error) => {
    console.error(`[deep-research-ro] ${error?.message ?? error}`);
    process.exitCode = 1;
  });
  ```
  `main`, `parseArgs`, `initialise` and the in-`try` handler (`:1012-1016`) are untouched. `--help` calls
  `process.exit(0)` inside `parseArgs`, so it never reaches the handler.
- `ro/test/orchestrate.test.mjs`: add two cases using the existing `run` helper, `orchestrator` and `fakePi`:
  1. unknown option (e.g. `"topic" --max-workers 3`, with `--dry-run --output <tmp> --pi-bin fakePi`);
  2. bad numeric flag (`--agents 7`).
  Each asserts `code !== 0` (specifically 1), `stderr.split("\n")[0]` matches `/^\[deep-research-ro\] /` (and contains the
  expected message), and `stderr` does not match `/^\s+at /m` (no `    at ` stack lines). Optionally assert stderr is a single
  non-empty line. Optionally a `--help` case asserting exit 0 and usage on stdout.
  The existing "numeric flags reject non-integer values" case stays unchanged.

Verification: `npm test` and `npm run lint` green.

Risk notes:
- The new handler also catches any rejection from `main` that escapes the in-`try` handler, e.g. `mark("failed", ...)`
  itself throwing inside `catch`; these now print one line without stack. Acceptable, and still exit 1.
- Pre-`try` errors that are not validation errors (e.g. a corrupt `config.json` JSON parse error on `--resume`, or an
  fs error in `initialise`) also lose their stack, as the issue requests.
- Non-Error throwables are handled via `error?.message ?? error`.
- No change to public interfaces, data, or validation; exit code stays 1.
