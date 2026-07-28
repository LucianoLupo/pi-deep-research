# pi-web-access Full Architecture Analysis

*Source: `/tmp/package/` (npm pack pi-web-access 0.10.2)*

## Overview

Most popular web package for pi. 22 source files. Registers 3 tools + 2 keyboard shortcuts + 2 commands.

## Tools Registered

### 1. `web_search`
- Searches via Perplexity or Gemini
- Returns AI-synthesized answer + source citations
- Supports single query or batch queries (`queries: string[]`)
- Multi-query gets browser curator UI (Ctrl+Shift+S) with countdown auto-send
- Auto-condense: LLM call deduplicates/synthesizes multi-query results
- Background content fetching when `includeContent: true`
- Domain filtering, recency filtering, provider selection

### 2. `fetch_content`
- Fetches URLs and extracts readable markdown
- Handles: GitHub repos, YouTube videos, local video files, PDFs, regular pages
- GitHub: clones locally, returns file contents + local path
- YouTube: Gemini Web → Gemini API → Perplexity (with thumbnail)
- Video: Gemini Files API upload → Gemini Web
- PDF: text extraction, saves to ~/Downloads/ as markdown
- Frame extraction: timestamp ranges, sampled frames (requires ffmpeg + yt-dlp)

### 3. `get_search_content`
- Retrieves stored full content from previous searches/fetches
- Content > 30K chars truncated inline but stored in full here

## Search Provider Chain
```
auto mode: Perplexity (API key) → Gemini API (API key) → Gemini Web (Chrome cookies)
```

### Perplexity (`perplexity.ts`)
- API: `https://api.perplexity.ai/chat/completions`
- Model: `sonar`
- Rate limit: 10 req/min (client-side, in-memory timestamps)
- Config: `~/.pi/web-search.json` → `perplexityApiKey`
- Returns: AI answer + citation URLs

### Gemini API (`gemini-api.ts`)
- Uses `google_search` tool in generateContent
- Resolves grounding chunks (Vertex redirect URLs → real URLs)
- Config: `GEMINI_API_KEY` env or `~/.pi/web-search.json`

### Gemini Web (`gemini-web.ts`)
- Reads Chrome cookies from macOS Keychain + SQLite
- Calls Gemini's StreamGenerate endpoint directly
- macOS only for cookie extraction
- Zero config if signed into Chrome

## Content Extraction Fallback Chain (`extract.ts`)
```
extractContent(url):
  → isVideoFile? → Gemini Files API → Gemini Web
  → extractGitHub? → git clone, return contents
  → isYouTubeURL? → Gemini Web → Gemini API → Perplexity
  → extractViaHttp:
      → fetch with browser-like headers
      → PDF? → extractPDFToMarkdown
      → non-HTML? → return raw text
      → HTML? → Readability parse
          → success + >500 chars? → turndown → markdown ✓
          → fail? → extractRSCContent (Next.js flight data)
          → still fail? → extractWithJinaReader (server-side JS rendering)
          → still fail? → extractWithUrlContext (Gemini URL Context API)
          → still fail? → extractWithGeminiWeb
```

## Key Implementation Patterns

### Storage (`storage.ts`)
- In-memory `Map<string, StoredSearchData>`
- Persisted to session via `pi.appendEntry("web-search-results", data)`
- Restored on session start/switch/fork/tree via `restoreFromSession(ctx)`
- 1-hour TTL on cached results
- Types: `StoredSearchData` with `type: "search" | "fetch"`

### Concurrency
- `p-limit(3)` for parallel content fetching
- 10 req/min rate limit for Perplexity (client-side)
- 30s timeout per URL fetch

### Dependencies
- `@mozilla/readability` + `linkedom` — HTML → readable text
- `turndown` — HTML → Markdown
- `p-limit` — concurrency control
- Native `fetch` — HTTP requests
- `ffmpeg` + `yt-dlp` — optional, video frame extraction

### UI Features
- Activity monitor widget (Ctrl+Shift+W) — live request/response tracking
- Curator UI (Ctrl+Shift+S) — browser-based search result review
- Custom `renderCall`/`renderResult` for both tools
- Progress bars during search
- Countdown timer for multi-query curation

### File Structure
```
index.ts              — Extension entry, tool definitions, commands, widget
curator-page.ts       — HTML/CSS/JS for browser curator UI
curator-server.ts     — Ephemeral HTTP server with SSE streaming
search-filter.ts      — Auto-condense pipeline for multi-query results
extract.ts            — URL routing, HTTP extraction, fallback chain
gemini-search.ts      — Search routing (Perplexity → Gemini API → Gemini Web)
gemini-url-context.ts — Gemini URL Context + Web extraction fallbacks
gemini-web.ts         — Gemini Web client (cookie auth, StreamGenerate)
gemini-api.ts         — Gemini REST API client
chrome-cookies.ts     — macOS Chrome cookie extraction
youtube-extract.ts    — YouTube detection, three-tier extraction
video-extract.ts      — Local video detection, Files API upload
github-extract.ts     — GitHub URL parsing, clone cache
github-api.ts         — GitHub API fallback for large repos
perplexity.ts         — Perplexity API client with rate limiting
pdf-extract.ts        — PDF text extraction
rsc-extract.ts        — RSC flight data parser for Next.js
utils.ts              — Formatting and error helpers
storage.ts            — Session-aware result storage
activity.ts           — Activity tracking for widget
skills/librarian/     — Bundled skill for library research
```

## What We Want to Keep
- Content extraction fallback chain (Readability → Jina → Gemini)
- Storage pattern (in-memory + session persistence)
- Activity monitoring
- Custom rendering for tools
- Concurrency control

## What We Want to Replace
- **Perplexity/Gemini as search providers** → Chrome-native Google Search
- **AI-synthesized search results** → Raw search results (title, URL, snippet)
- **External API dependency** → Chrome bridge (already installed)
