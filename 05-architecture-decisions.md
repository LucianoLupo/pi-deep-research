# Architecture Decisions

## Decision 1: Chrome-Native Search (No API Middlemen)

### Problem
pi-web-access uses Perplexity and Gemini as search providers. This means:
- Paying an AI to summarize search results, then feeding that to another AI
- Loss of raw data (pre-filtered by intermediary)
- External API dependency and cost
- No control over what gets filtered out

### How Claude Code Does It
- **WebSearch** → Brave Search API (raw results: titles, URLs, snippets)
- **WebFetch** → direct HTTP fetch + content extraction
- No AI intermediary. Agent gets raw data.

### Our Decision
**Use Chrome browser for Google Search + direct HTTP fetch for content.**

| Task | Tool | Why |
|------|------|-----|
| Google Search | Chrome bridge | Real browser, best results, user's session, no API key |
| Bulk page content | Direct HTTP + Readability (Node.js) | 10-50x faster than Chrome, parallelizable |
| JS-heavy / blocked pages | Chrome (fallback) | Real browser renders everything |

### What This Requires
Improving the current `pi-chrome` extension (`~/.pi/agent/extensions/pi-chrome/`) from basic to research-grade:

**Current State (basic):**
- 10 tools: navigate, click, type, extract, screenshot, scroll, get_elements, console, new_tab, list_tabs
- HTTP bridge on localhost:3773
- No higher-level primitives
- Bridge server must be manually started

**Needed Improvements:**
- `web_search(query)` → navigates Google, extracts structured results in one call
- `fetch_page(url)` → opens tab, runs Readability in-page, returns clean markdown
- `batch_fetch(urls[])` → parallel tab management
- Better content extraction (inject Readability.js into page)
- Auto-scroll for lazy-loaded content
- Auto-start / health check for bridge server
- Reconnection logic, better error handling

## Decision 2: Hybrid Fetch Architecture

Chrome is the most native but also the slowest. For deep research hitting 100+ pages:

```
Search Phase:    Chrome → Google Search → structured results
Content Phase:   Direct HTTP fetch + Readability (fast, parallel)
Fallback:        Chrome for JS-heavy / blocked pages
                 Jina Reader for anti-bot pages
```

This gives us:
- Best search results (real Google via Chrome)
- Fast bulk content extraction (Node.js HTTP, not browser)
- Universal fallback (Chrome renders anything)

## Decision 3: Pi Teams for Parallel Agents

Pi teams give us something the original deep research repo didn't have: **real parallel execution with independent context windows**.

A 5-agent team where each agent has its own 200K context can collectively process far more than a single agent looping. This is fundamentally more powerful than Claude Code's `Task` tool.

### Agent Architecture
| Agent | Role | Context Usage |
|-------|------|---------------|
| Controller | GoT orchestrator, graph state, budgets | Metadata only, stays lean |
| Search Agent 1-N | Subtopic research, Chrome/HTTP fetch | Independent per subtopic |
| Extractor | Sources → evidence ledger claims | Processes fetched content |
| Verifier | C1 claim corroboration | Reads ledger + searches |
| Red Team | Counter-evidence | Reads synthesis + searches |
| Editor | Final report assembly | Reads ledger + working notes |

### Coordination
- Shared task board (pi-teams task system)
- File-based data exchange (evidence ledger CSV, source catalog, working notes)
- Messaging for status updates and coordination
- Controller manages graph state JSON on disk

## Decision 4: Extension vs Skill

### Option A: Skill-based (simplest)
SKILL.md that adapts V3 methodology to pi tools. ~1 day.
- Pro: Fast, no code
- Con: No custom UI, no caching, limited

### Option B: Team-based skill (~2-3 days)
SKILL.md that launches pi team with specialized agents.
- Pro: True parallelism, independent contexts
- Con: More complex, higher token cost

### Option C: Extension + Team hybrid (most powerful, ~1 week)
Pi extension that:
1. Registers `/deep-research` command
2. Runs interactive scoping dialog
3. Spawns pi team with V3 pipeline
4. Provides custom `web_research` tool (Chrome + HTTP hybrid)
5. Shows live progress via `ctx.ui.setWidget`
6. Persists graph state via `pi.appendEntry`
7. Outputs structured folder

### Our Decision
**Start with Option B (team-based skill), upgrade to C later.** Gets us parallel agents quickly without the upfront extension effort. The Chrome improvements can be built incrementally.

## Decision 5: Content Extraction Stack

Keep the proven parts of pi-web-access's extraction chain:
```
HTTP fetch (browser-like headers)
  → PDF? → text extraction
  → non-HTML? → return raw
  → HTML? → Readability parse
      → success? → turndown → markdown ✓
      → fail? → Jina Reader (server-side JS rendering, no key needed)
      → fail? → Chrome fallback (real browser)
```

Drop: Gemini URL Context, Gemini Web extraction, RSC parser
Add: Chrome as final fallback instead of Gemini
