# Pi Deep Research

Chrome-native research tools plus an auditable, multi-session research workflow for Pi.

## Requirements

- Node.js 18+ and an authenticated `pi` CLI.
- This package loaded by Pi (the current global setup includes it in `~/.pi/agent/settings.json` under `packages`). Run `/reload` after adding the package or skill.
- A web-research extension. `research_search`/`research_fetch` use the Chrome bridge when available; workers can fall back to other installed custom web tools. Without a usable search/fetch tool, the workflow fails closed with no verified evidence.

The workflow launches headless Pi processes directly; it does **not** use Pi Teams, tmux, or Zellij. Each worker inherits the directory from which the command is invoked so project-local Pi resources remain discoverable. Workers receive no built-in write/edit/bash tools.

## Workflow modes

| Mode | Command | Shape |
|---|---|---|
| Quick | `node ro/orchestrate.mjs "Topic" --agents 2 --single-round` | Bounded scan |
| Standard | `node ro/orchestrate.mjs "Topic" --agents 3` | Default two-round research |
| Deep | `node ro/orchestrate.mjs "Topic" --agents 5` | Broad/high-stakes investigation |

Every worker is a separate model call. Expect costs and elapsed time to scale with worker count and source availability; use `--concurrency N` to cap simultaneous calls.

## Documents

| File | Contents |
|------|----------|
| [01-existing-assets.md](01-existing-assets.md) | What we already have (skills, repos, extensions) |
| [02-pi-ecosystem.md](02-pi-ecosystem.md) | Pi packages, community extensions, official resources |
| [03-pi-web-access-analysis.md](03-pi-web-access-analysis.md) | Full architecture analysis of the best existing web package |
| [04-v3-methodology.md](04-v3-methodology.md) | Deep research V3 methodology (GoT, 7 phases, agent templates) |
| [05-architecture-decisions.md](05-architecture-decisions.md) | Key decisions: Chrome-native, hybrid fetch, parallel agents |
| [06-next-steps.md](06-next-steps.md) | Implementation plan |

## Key Decision

**Chrome-native search + direct HTTP fetch hybrid** — no Perplexity/Gemini middleman. The agent gets raw search results and raw page content, then does its own analysis. This matches how Claude Code works (Brave Search + WebFetch) but uses the user's own Chrome browser instead.

## Deep Research RO

`skills/deep-research-ro` adds an auditable multi-session workflow modeled on the Claude Code research orchestrator:

```text
split → parallel round 1 → coordinate gaps → parallel round 2
     → worker-fetch evidence + URL reachability → synthesis → independent judge
```

It launches isolated headless Pi CLI processes rather than Pi Teams, so it works without a tmux/Zellij terminal adapter. Run it through the `deep-research-ro` skill or directly:

```bash
node ro/orchestrate.mjs "Topic" --agents 3
```

Every run is resumable and writes a timestamped artifact directory with raw worker logs, Pi sessions, structured findings, worker-fetch evidence, URL-reachability results, citation audit, report, judge result, and metrics:

```text
<run>/
├── round-1/ and round-2/        # normalized worker findings
├── shared/source-evidence.json  # URLs submitted to completed non-error fetch/extract calls
├── citation-verification.json   # reachability: OK / BLOCKED / DEAD
├── citation-audit.json          # report URLs checked against the evidence chain
├── report.md and judge.json
├── state.json and metrics.json  # resumability and timings
└── logs/ and sessions/          # raw audit trail
```

Resume an interrupted run with `node ro/orchestrate.mjs --resume <run-directory>`. Use `--dry-run` to create only `config.json`, `plan.md`, and `state.json`.

`OK` means the URL was submitted to a completed non-error worker fetch/extract call and returned a bounded successful HTTP response during verification; it does **not** prove that the worker received useful page content or that every claim is semantically correct. The independent judge and final human review remain necessary. Private/loopback targets are blocked during verification unless the explicit testing-only `--allow-private-sources` flag is used.

See `skills/deep-research-ro/SKILL.md` for invocation and delivery behavior.
