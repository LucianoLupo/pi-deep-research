# Next Steps — Implementation Plan

## Phase 1: Chrome Bridge Improvements
**Goal: Make pi-chrome research-grade**

1. Investigate Chrome bridge server setup (how to start, auto-detect)
2. Add higher-level search primitive:
   - `web_search(query)` → navigate to Google, type query, extract structured results
   - Returns: `{ results: [{ title, url, snippet }] }`
3. Add content extraction:
   - `fetch_page(url)` → navigate, wait for load, inject Readability.js, extract markdown
4. Add batch operations:
   - `batch_fetch(urls[])` → open N tabs, extract content from each
5. Better error handling, timeouts, health checks

## Phase 2: Web Research Extension
**Goal: Standalone web research tool for pi**

Build a pi extension that provides:
- `web_search` tool — Chrome-native Google Search → raw results
- `fetch_content` tool — HTTP fetch + Readability + Chrome fallback
- `get_content` tool — Retrieve stored results
- In-memory storage with session persistence
- Activity monitoring widget
- Rate limiting and concurrency control

## Phase 3: Deep Research Skill
**Goal: Full research pipeline using pi teams**

Build a SKILL.md that:
1. Captures research question (Phase 1 scoping)
2. Classifies complexity (Phase 0) and intensity (Phase 1.1)
3. Generates hypotheses (Phase 1.5)
4. Creates pi team with specialized agents:
   - Controller (GoT orchestrator)
   - Search agents (3-5, one per subtopic)
   - Verifier agent
   - Red Team agent
   - Editor agent
5. Agents use web_search + fetch_content from Phase 2
6. File-based coordination (evidence ledger, source catalog, working notes)
7. Graph state management on disk
8. QA gates between phases
9. Final report generation

## Phase 4: Extension Upgrade (Optional)
**Goal: Best-in-class UX**

Upgrade to full pi extension with:
- `/deep-research` command with interactive scoping
- Live progress widget (graph visualization, sources found, claims verified)
- Resumability via `pi.appendEntry` state persistence
- Custom rendering for research tools
- Domain overlay selection

## Open Questions

1. **Chrome bridge**: How does the bridge server start? Is it a Chrome extension that needs to be installed separately? Need to investigate.
2. **Token budget**: How much does a full deep research run cost? Need to estimate based on agent count × context usage.
3. **Google rate limiting**: How many Google searches can we do via Chrome before getting CAPTCHA'd?
4. **Content storage**: File-based (CSV/JSON on disk) vs in-memory vs SQLite for the evidence ledger?
5. **Model selection**: Should search agents use cheaper models (Haiku) while synthesis agents use Opus?

## Priority Order
1. ✅ Research & planning (this document)
2. 🔲 Investigate Chrome bridge setup
3. 🔲 Build Chrome search primitive
4. 🔲 Build web research extension
5. 🔲 Build deep research team skill
6. 🔲 Test end-to-end with a real research topic
7. 🔲 Iterate based on results
