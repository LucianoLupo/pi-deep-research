# Pi Ecosystem — Packages, Extensions, Community

## Official Resources

| Resource | URL |
|----------|-----|
| Package Gallery | https://shittycodingagent.ai/packages (or pi.dev/packages) |
| npm search | `keywords:pi-package` (410+ results) |
| Official Skills | https://github.com/badlogic/pi-skills |
| Awesome List | https://github.com/qualisero/awesome-pi-agent |
| Discord | https://discord.com/invite/3cU7Bz4UPx |
| GitHub | https://github.com/badlogic/pi-mono |
| DeepWiki | https://deepwiki.com/badlogic/pi-mono |

## Web Search Packages (npm)

### Full-Featured
| Package | Version | Description | API/Engine |
|---------|---------|-------------|------------|
| `pi-web-access` | 0.10.2 | Search, fetch, GitHub clone, PDF, YouTube, video | Perplexity + Gemini + Jina |
| `pi-amplike` | 1.2.0 | Amp-like workflows + web search + page fetch | Jina APIs |
| `@ogulcancelik/pi-web-browse` | 1.0.3 | Search + headless browser (CDP) | Real browser |

### Search-Only
| Package | Version | Description | Engine |
|---------|---------|-------------|--------|
| `@yofriadi/pi-web-search` | 1.16.11 | Web search extension | Unknown |
| `pi-brave-search` | 0.2.0 | Brave search + AI grounding | Brave API |
| `pi-perplexity` | 0.1.3 | Perplexity (uses Pro/Max sub) | Perplexity |
| `@aliou/pi-linkup` | 0.7.3 | Search + fetch via Linkup | Linkup |
| `@aemonculaba/pi-search` | 0.2.3 | OpenAI search + Readability | OpenAI |
| `pi-searxng` | 1.0.4 | Self-hosted SearXNG + GitHub clone | SearXNG (free) |
| `pi-parallel-web-search` | 1.0.3 | Web search via Parallel AI | Parallel AI |
| `pi-ollama-web-search` | 0.1.1 | Ollama-based search + fetch | Ollama |

### Multi-Agent / Orchestration
| Package | Version | Description |
|---------|---------|-------------|
| `pi-subagents` | 0.11.0 | Subagent chains, parallel execution, TUI clarification |
| `pi-teams` | 0.8.6 | Agent teams (tmux-based coordination) |
| `pi-messenger` | 0.12.1 | Inter-agent messaging + file reservation |
| `pi-messenger-swarm` | 0.16.0 | Swarm-first multi-agent messaging + task orchestration |
| `@tmustier/pi-agent-teams` | 0.4.0 | Claude Code agent teams style for Pi |
| `pi-planning-with-files` | 1.0.1 | Manus-style file-based planning |

### Research-Adjacent
| Package | Version | Description |
|---------|---------|-------------|
| `pi-librarian` | 1.3.0 | GitHub research subagent |
| `@mjakl/pi-git-research` | 1.0.0 | Git repository research tools |
| `pi-finder-subagent` | 1.4.0 | Read-only local workspace scout |

## Non-Pi Deep Research Tools (for reference)
| Tool | Description |
|------|-------------|
| `gpt-researcher` (Python) | Standalone, popular, autonomous research agent |
| `Alibaba-NLP/DeepResearch` | Open-source deep research agent |
| `SkyworkAI/DeepResearchAgent` | Hierarchical multi-agent system |
| `dzhng/deep-research` | Simple iterative deep research |
| `nickscamara/open-deep-research` | Open source deep research clone using Firecrawl |

## Key Finding
**No existing deep research system built for pi.** The building blocks exist (web access, teams, subagents, extensions API) but nobody has composed them into a research pipeline.

## Official Pi Skills (badlogic/pi-skills)
- brave-search — Web search via Brave API
- browser-tools — Browser automation via Chrome DevTools
- gccli — Google Calendar
- gdcli — Google Drive
- gmcli — Gmail
- transcribe — Speech-to-text via Groq Whisper
- vscode — VS Code integration
- youtube-transcript — YouTube transcripts
