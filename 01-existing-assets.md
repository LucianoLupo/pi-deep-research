# Existing Assets Inventory

## 1. Deep Research Skill Repo (`~/.claude/skills/deep-research/`)

Cloned from GitHub (Dec 2025). Three versions of a deep research system prompt:

### V1 (`CLAUDE.md`) — 22KB
- 7-phase process (Scope → Plan → Query → Triangulate → Synthesize → QA → Package)
- Multi-agent deployment strategy with agent templates
- Citation standards with source quality ratings (A-E)
- User interaction protocol with question gathering
- Output folder structure (`/RESEARCH/[topic]/`)
- Designed for Claude Code's `Task` tool (not pi)

### V2 (`Claude2.md`) — 34KB
- Full Graph of Thoughts (GoT) implementation
- Generate/Aggregate/Refine/Score transformations
- Graph state JSON with nodes, edges, frontier, scoring
- Iterative traversal with pruning (KeepBestN)
- Complete execution flow example (4 iterations)
- Agent prompt templates for each transformation type

### V3 (`Version3/Claude.md`) — 35KB — **Best version**
- Phase 0: Question complexity classification (Type A/B/C/D → fast-path routing)
- Phase 1.1: Research intensity tiers (Quick/Standard/Deep/Exhaustive)
- Phase 1.5: Hypothesis formation with testable hypotheses + prior probabilities
- Evidence Ledger: Claim-to-evidence mapping with C1/C2/C3 taxonomy
- Contradiction Triage: 4 conflict types with resolution framework
- Independence Grouping: Anti-citation laundering (tracks source lineage)
- Implications Engine: SO WHAT / NOW WHAT / WHAT IF / COMPARED TO
- Red Team Agent: Devil's advocate at depth 3+ when aggregate > 8.0
- Claim Confidence Scoring: HIGH/MEDIUM/LOW/SPECULATIVE
- Checkpoint Aggregation: Mid-research coordination at depth 2
- QA Gates: Pass/fail criteria for each phase
- Prompt Injection Firewall: Rules for hostile web content
- Domain overlays: healthcare, financial, legal, market (`Version3/DOMAIN_OVERLAYS/`)
- Termination rules: Stop when 2 of 4 conditions met
- Budget defaults: N_search=30, N_fetch=30, N_docs=12, N_iter=6

### Supporting Files
- `deepresearchprocess.md` (134KB) — Full playbook reverse-engineering OpenAI/Google deep research
- `Deep Research Question Generator System Prompt.md` — ChatGPT prompt for crafting research prompts
- `updates/claude_advice.md` — V2→V3 implementation guide (9 critical gaps fixed)
- `updates/chatgpt.md`, `updates/gemini.md` — Feedback from other models

## 2. Pi Infrastructure

### Pi Teams (`npm:pi-teams`, installed)
- tmux/Zellij-based multi-agent coordination
- Shared task board with persistent state
- Agent messaging (send_message, read_inbox, broadcast_message)
- Task lifecycle (create → plan → in_progress → completed)
- Team lead pattern with spawn_teammate

### Pi Extensions API
- Full TypeScript extension system
- Custom tools (`pi.registerTool()`)
- Event lifecycle hooks (session_start, tool_call, tool_result, etc.)
- Custom UI (`ctx.ui.select`, `ctx.ui.confirm`, `ctx.ui.setWidget`, `ctx.ui.setStatus`)
- Commands (`pi.registerCommand()`)
- State persistence (`pi.appendEntry()`)
- Shell execution (`pi.exec()`)
- Message injection (`pi.sendMessage()`)
- Model management (`pi.setModel()`, `pi.setThinkingLevel()`)

### Pi Subagents (built-in)
- `subagent_create(task)` — spawn background subagent
- `subagent_continue(id, prompt)` — follow up
- `subagent_list()` / `subagent_remove(id)`
- Results delivered as follow-up messages

### Pi Chrome Extension (`~/.pi/agent/extensions/pi-chrome/`)
- 10 basic tools: navigate, click, type, extract, screenshot, scroll, get_elements, console, new_tab, list_tabs
- Communicates via HTTP bridge server on localhost:3773
- Bridge server was NOT running during our session
- Basic implementation, no higher-level primitives

### Pi SDK
- `createAgentSession()` for embedding pi in apps
- Full programmatic control (prompt, steer, followUp, subscribe)
- Session management (in-memory or file-based)

## 3. Existing Research Skills

### `plan-research-team` (`~/.pi/agent/skills/`)
- 4-agent parallel research team
- repo-analyst, best-practices-researcher, framework-docs-researcher, spec-gap-analyst
- Consolidates into research brief
- Code/project-focused, not general research

## 4. Obsidian Vault Notes (`30_Resources/AI Engineering/`)
- `Pi Coding Agent - Overview.md` — Full overview with architecture, differentiators
- `Pi Agent - Extension System.md` — Extension development guide
- `Pi Agent - Official Resources.md` — Complete index of docs, examples, community
- `Pi Coding Agent - Deep Research Report.md` — Multi-agent research report
- `Pi Coding Agent - Gemini Deep Research Report.md`
- `Pi Agent - Professional Use Cases.md`
- `Pi Chrome Operator.md`
- `Pi vs Claude Code - Disler Video Analysis.md`
