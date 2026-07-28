---
name: deep-research-ro
description: "Run auditable, multi-session deep research through the Deep Research RO pipeline: topic decomposition, parallel Pi researchers, gap-driven second round, deterministic citation verification, synthesis, and an independent judge. Use when the user asks for orchestrated, parallel, thorough, or multi-session research and accepts the cost/time of multiple Pi workers."
---

# Deep Research RO

Use the package-root script at `ro/orchestrate.mjs`. It launches isolated **headless Pi processes**, not Pi Teams, so it does not require a tmux/Zellij terminal adapter. Invoke it from the target project directory: workers inherit that directory so project-local Pi extensions remain discoverable, and they run with built-in mutation tools disabled.

## Before running

State the research topic, scope, and mode. Do not claim to search every page on the internet; define credible source families and the decision the report should support.

| Mode | Command flags | Use for |
|---|---|---|
| Quick | `--agents 2 --single-round` | bounded comparison or scan |
| Standard | `--agents 3` | default deep research |
| Deep | `--agents 5` | broad/high-stakes research |

Each worker consumes model quota. Run the script in the background for long requests.

## Run

From this skill directory, resolve the package root two levels up, then run:

```bash
node <package-root>/ro/orchestrate.mjs "TOPIC" --agents 3
```

Optional model and output location:

```bash
node <package-root>/ro/orchestrate.mjs "TOPIC" \
  --agents 5 \
  --model "anthropic/claude-sonnet-4-6" \
  --output "$HOME/Documents/Research/ro-runs/YYYY-MM-DD-topic"
```

For a safe shape check, use `--dry-run`. To continue an interrupted run, use the returned directory:

```bash
node <package-root>/ro/orchestrate.mjs --resume <run-directory>
```

## Pipeline contract

The orchestrator owns files and state. Workers return structured JSON only.

1. **Split** — non-overlapping research angles.
2. **Round 1** — isolated evidence researchers run in parallel.
3. **Coordinate** — consolidate known facts, gaps, and contradictions.
4. **Round 2** — isolated workers fill only material gaps.
5. **Verify** — retain only URLs submitted to completed non-error worker fetch/extract calls, then run bounded URL-reachability checks classifying them as `OK`, `BLOCKED`, or `DEAD`.
6. **Synthesize** — report may cite only URLs submitted to completed non-error worker fetch/extract calls and confirmed reachable; a repair pass removes invalid citations. URL reachability does not independently prove each claim's semantic accuracy.
7. **Judge** — independent score for depth, accuracy, coverage, synthesis, and actionability.

## Deliver

Read `report.md`, `judge.json`, and `citation-audit.json` from the returned run directory before summarizing. Report the judge verdict, material weaknesses, source-verification limits, and the report path. Never dump individual worker output into the conversation unless requested.
