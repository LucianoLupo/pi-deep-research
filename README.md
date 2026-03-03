# Pi Deep Research Extension — Research Notes

*Research conducted 2026-03-02. Goal: build a Google Deep Research-level system for pi coding agent.*

## What We're Building

A deep research system for pi that:
- Takes 20-60 minutes per research task
- Pulls data from hundreds of pages
- Uses parallel agents with independent context windows
- Produces auditable, citation-backed reports
- Uses Chrome as the native web layer (no API middlemen)

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
