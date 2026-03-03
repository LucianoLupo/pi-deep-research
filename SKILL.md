---
name: deep-research
description: Conduct deep, multi-step web research on any topic. Iteratively searches, reads, and synthesizes information from dozens of sources into comprehensive cited reports. Use when asked to "deep research", "research thoroughly", or when a question requires investigating multiple sources, comparing viewpoints, or producing a detailed analysis.
---

# Deep Research

Conduct thorough, multi-step web research using iterative search and extraction. Produces cited, comprehensive reports.

## Required Extension

This skill requires the `pi-deep-research` extension to be installed and the Chrome bridge connected.

## Available Tools

| Tool | Purpose |
|------|---------|
| `research_search` | Search Google via Chrome. Returns titles, URLs, snippets. |
| `research_fetch` | Fetch and extract full content from URLs. Supports `maxWords` for truncation. |
| `research_get_content` | Retrieve previously fetched content by ID, URL, or query. |
| `research_list` | List all cached results with session summary stats. |

## Research Workspace

Every research session gets a dedicated folder. Create it at the start of Phase 1.

```
~/Documents/Research/
└── YYYY-MM-DD-[topic-slug]/
    ├── report.md              ← final report (always created)
    ├── sources/               ← downloaded PDFs, images, saved pages (created on demand)
    └── findings/              ← analyst subagent outputs in pipeline mode (created on demand)
```

**Naming:** Use `YYYY-MM-DD-` prefix + lowercase hyphenated topic slug. Examples:
- `2026-03-03-gemini-deep-research`
- `2026-03-03-rust-async-ecosystem`

**What goes where:**
- `report.md` — the final synthesized report with citations. Always created.
- `sources/` — only create when the user asks to save PDFs, images, or raw pages. Don't save by default.
- `findings/` — in pipeline mode, save each analyst subagent's structured output here (e.g., `findings/subtopic-a.md`). Useful for auditing the research chain.

Create the base folder and `report.md` at the start. Create `sources/` and `findings/` only when needed.

## Workflow: Plan → Search → Synthesize → Verify

### Phase 1: Plan (1-2 minutes)

When the user asks for research:

1. **Create the research workspace:**
```bash
mkdir -p ~/Documents/Research/YYYY-MM-DD-[topic-slug]
```

2. **Don't ask a barrage of questions.** Instead, propose a research plan:

```
I'll research [topic]. Here's my plan:

📁 Workspace: ~/Documents/Research/YYYY-MM-DD-[topic-slug]/

1. [Subtopic A] — what to investigate
2. [Subtopic B] — what to investigate
3. [Subtopic C] — what to investigate

Estimated: ~X searches across Y subtopics.
Want me to adjust anything, or shall I start?
```

3. Keep the plan to **3-7 subtopics**. Identify which can be searched in parallel vs. which depend on earlier findings.

4. If the user's request is genuinely ambiguous (not just broad), ask **one** clarifying question — not five.

5. Once confirmed, proceed immediately.

### Phase 2: Search Loop (5-20 minutes)

This is the core loop. For each subtopic:

#### Step A: Search
```
research_search({ query: "[specific query for subtopic]", numResults: 10 })
```

Use specific, targeted queries. Vary query formulation:
- Include year for recency: `"topic 2025 2026"`
- Use domain filters for quality: `"topic site:arxiv.org"` or `"topic site:*.gov"`
- Try different angles: technical terms, layperson terms, competitor names

#### Step B: Evaluate Snippets (this IS your scan mode)
Review the returned titles and snippets. **Don't fetch everything.** Select the 3-5 most relevant, authoritative-looking results based on:
- Domain reputation (gov, edu, established publications > random blogs)
- Snippet relevance to your specific subtopic
- Source diversity (don't fetch 3 articles from the same site)
- Recency (prefer recent sources unless historical context needed)

#### Step C: Fetch Best Sources
```
research_fetch({ urls: ["url1", "url2", "url3"], maxWords: 3000 })
```

Use `maxWords: 3000` for initial reads. This gives enough content to assess value without blowing context. If a source proves critical, re-fetch without maxWords later.

#### Step D: Reason About Gaps
After each fetch round, ask yourself:
- What did I learn that's new?
- What questions remain unanswered?
- Do sources agree or contradict each other?
- Is there a perspective I'm missing?

#### Step E: Iterate or Move On
- **If gaps remain** → formulate a refined query based on what you learned → search again
- **If saturated** (last 2-3 searches mostly returned already-seen URLs or repeated information) → move to next subtopic
- **If sources conflict** → search specifically for resolution (e.g., primary data, meta-analyses, official sources)

#### Saturation Rule
Stop searching a subtopic when: recent searches yield mostly URLs you've already seen, or new sources repeat what you already know. Don't chase diminishing returns — move to synthesis.

### Phase 3: Synthesize (5-10 minutes)

Once all subtopics are covered:

1. **Review what you have**: Call `research_list` to see your full research inventory
2. **Re-read key sources**: Use `research_get_content` to revisit the most important sources
3. **Write the report** to the workspace (`~/Documents/Research/YYYY-MM-DD-[topic-slug]/report.md`):
   - Start with an executive summary (key findings in 3-5 bullets)
   - Organize by theme/subtopic, not by source
   - Every factual claim gets a citation `[Source Title](url)`
   - Note where sources disagree — don't silently pick one
   - Include a "Limitations" section for what you couldn't find or verify
   - Include a "Sources" section at the end with full bibliography
4. **Be opinionated**: Don't just list facts. Synthesize patterns, identify trends, highlight what matters most. Say "the evidence suggests X" not just "Source A says X, Source B says Y."

### Phase 4: Verify (2-3 minutes)

Before delivering:

1. **Citation spot-check**: Pick 3-5 key claims. Does the cited source actually support the claim? Use `research_get_content` to verify.
2. **Coverage check**: Does the report address all subtopics from the plan?
3. **Freshness check**: Are sources reasonably current for the topic?
4. **Contradiction check**: Did you note all significant disagreements between sources?

If verification reveals a problem, do a targeted search to fix it — don't re-do the whole research.

## Research Quality Guidelines

### Source Selection
- Prefer primary sources over secondary reporting
- Academic papers, official docs, and established publications over blog posts
- Check publication dates — stale sources on fast-moving topics are misleading
- Multiple independent sources for critical claims

### Context Management
- Use `maxWords: 3000` for initial reads, full content only for critical sources
- Don't fetch more than 5-7 URLs per search round
- Call `research_list` periodically to track your progress
- If context feels bloated, use `research_get_content` to re-read specific sources rather than re-fetching

### Report Structure
Adapt to the topic, but good defaults:
- **Executive Summary** — key findings, 3-5 bullets
- **Background/Context** — what the reader needs to know
- **Findings** — organized by theme, with citations
- **Analysis** — patterns, trends, implications
- **Limitations** — what you couldn't determine
- **Sources** — full bibliography with URLs

### What NOT to Do
- Don't fetch every search result — be selective
- Don't ask 5+ clarifying questions before starting — propose a plan
- Don't report raw source content — synthesize
- Don't ignore contradictions — acknowledge them
- Don't skip verification — always spot-check key claims

## Scaling with Agent Pipelines

For non-trivial research (3+ subtopics), use a **pipeline of specialized agents** instead of doing everything in a single context. Each stage has a focused role and passes structured output to the next. This keeps context clean — the main agent never sees raw page content, only distilled findings.

### Pipeline Architecture

```
Stage 1: Scout (1 subagent)
    → Stage 2: Analysts (N subagents in parallel)
        → Stage 3: Synthesizer (main agent)
            → Stage 4: Reviewer (1 subagent)
```

### Stage 1: Scout

One subagent searches all subtopics and produces a ranked source map.

```
subagent_create({ task: `
You are a research scout. Your job is to find the best sources for a research project.

Topic: [topic]
Subtopics to investigate:
1. [subtopic A]
2. [subtopic B]
3. [subtopic C]

For EACH subtopic:
1. Run 2-3 searches using research_search with varied query formulations
2. Review the returned snippets carefully
3. Select the 3-5 most relevant, authoritative URLs per subtopic

Return a structured source map in this exact format:

## Subtopic: [name]
- [URL 1] — [why this source matters, based on snippet]
- [URL 2] — [why]
- [URL 3] — [why]
Suggested follow-up queries: [any refined queries worth trying]

## Subtopic: [name]
...

Do NOT fetch any URLs. Only search and evaluate snippets.
Do NOT write analysis. Just find and rank sources.
` })
```

### Stage 2: Analysts (parallel)

Once the scout returns, spawn one subagent per subtopic. Each analyst fetches and extracts findings from its assigned URLs.

```
# Spawn these in parallel — one per subtopic
subagent_create({ task: `
You are a research analyst for one specific subtopic.

Subtopic: [subtopic A]
URLs to investigate:
- [url1]
- [url2]
- [url3]
- [url4]

Instructions:
1. Fetch all URLs using research_fetch with maxWords: 3000
2. Read each source carefully
3. If a source is critical and was truncated, re-fetch it without maxWords
4. If sources reveal important follow-up questions, run 1-2 additional searches

Write your findings to: ~/Documents/Research/YYYY-MM-DD-[topic-slug]/findings/[subtopic-slug].md

Use this exact format:

## Key Findings
- [finding 1 with specific data/quotes] (source: [url])
- [finding 2] (source: [url])
- [finding 3] (source: [url])

## Contradictions or Debates
- [any disagreements between sources]

## Gaps
- [what you couldn't find or verify]

## Sources Used
- [url1] — [title, date if available, 1-line summary]
- [url2] — ...

Do NOT write prose or a report. Return structured findings only.
` })
```

### Stage 3: Synthesizer (main agent)

The main agent receives structured findings from all analysts. It never saw the raw page content — only distilled bullets, contradictions, and gaps. This means the main agent's context is clean and focused.

At this stage, the main agent:
1. Reads all analyst findings from `findings/*.md` in the research workspace
2. Identifies cross-cutting themes and patterns
3. Resolves contradictions (or flags them)
4. Fills any critical gaps with targeted searches
5. Writes the final report to `report.md` in the research workspace

### Stage 4: Reviewer (optional subagent)

For high-stakes research, spawn a reviewer to audit the draft.

```
subagent_create({ task: `
You are a research reviewer. Audit this report for accuracy and completeness.

Research plan was:
[paste original subtopic plan]

Report to review:
[paste draft report]

Check:
1. Pick 5 key factual claims. Use research_get_content to verify each against its cited source.
2. Are all subtopics from the plan covered?
3. Are contradictions between sources acknowledged?
4. Are there unsupported claims (no citation)?
5. Is any important context missing?

Return:
## Verified Claims
- [claim] ✅ supported by [source]

## Issues Found
- [claim] ❌ [problem: misquoted / unsupported / source says opposite]

## Missing Coverage
- [any gaps]

## Verdict
[PASS / NEEDS FIXES with specific fix list]
` })
```

### When to Use Pipelines vs. Single-Agent

| Research Size | Approach |
|--------------|----------|
| Quick question (1-2 searches) | Single agent, no subagents |
| Medium (2-3 subtopics) | Single agent with Phase 1-4 workflow |
| Large (4-7 subtopics) | Full pipeline: scout → analysts → synthesize → review |
| Massive (8+ subtopics) | Pipeline with multiple scout passes and analyst batches |

### Pipeline Rules

- **Subagents deliver structured data, not prose.** Bullets, source lists, and verdicts — never paragraphs.
- **The main agent owns the narrative.** Only the synthesizer writes the final report.
- **Each subagent gets a bounded, specific task.** Never ask one subagent to "research everything."
- **Use `maxWords: 3000` in analyst agents.** Re-fetch without limit only for critical sources.
- **Scout never fetches, analysts never synthesize, reviewer never rewrites.** Strict role separation.

## Quick Reference

| Situation | Action |
|-----------|--------|
| User says "research X" | Propose 3-7 subtopic plan, get confirmation, start |
| Need to scout results | Review `research_search` snippets — they're your previews |
| Initial source read | `research_fetch` with `maxWords: 3000` |
| Source proves critical | Re-fetch without `maxWords` for full content |
| Losing track of progress | Call `research_list` for session summary |
| Need to re-read a source | `research_get_content` by URL or ID |
| Sources conflict | Search for primary data or meta-analyses to resolve |
| Searches returning same URLs | Saturation — move to next subtopic or synthesis |
| Quick research (1-3 subtopics) | Single agent, 4-phase workflow |
| Large research (4+ subtopics) | Pipeline: scout → analysts → synthesize → review |
