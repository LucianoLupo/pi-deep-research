# Deep Research V3 Methodology Summary

*Source: `~/.claude/skills/deep-research/Version3/Claude.md` (35KB)*

## The 7-Phase Process (+ Phase 0 and 1.5)

### Phase 0: Question Complexity Classification
Route simple questions to fast paths; reserve full GoT for complex research.

| Type | Characteristics | Process |
|------|-----------------|---------|
| Type A: LOOKUP | Single fact, known source | Direct search → Answer. 1-2 min |
| Type B: SYNTHESIS | Multiple facts, aggregation | Abbreviated GoT: 2-3 agents, depth 2. 15 min |
| Type C: ANALYSIS | Judgment, multiple perspectives | Full 7-phase + standard GoT. 30-60 min |
| Type D: INVESTIGATION | Novel, high uncertainty, conflicts | Extended GoT + hypothesis testing + Red Team. 2-4 hrs |

### Phase 1: Question Scoping
Capture: one-sentence question, decision/use-case, audience, scope, constraints, output format, citation strictness, definition of done.

### Phase 1.1: Research Intensity Classification
| Tier | Agents | GoT Depth | Stop Score |
|------|--------|-----------|------------|
| Quick | 1-2 | Max 1 | > 7 |
| Standard | 3-5 | Max 3 | > 8 |
| Deep | 5-8 | Max 4 | > 9 |
| Exhaustive | 8-12 | Max 5+ | > 9.5 |

Budget defaults: N_search=30, N_fetch=30, N_docs=12, N_iter=6, K=5 (saturation window).

### Phase 1.5: Hypothesis Formation
- Generate 3-5 testable hypotheses with prior probabilities
- Design research to CONFIRM or DISCONFIRM each
- Track probability shifts as evidence accumulates
- Report hypothesis outcomes, not just facts

### Phase 2: Retrieval Planning
- 3-7 subquestions covering whole scope
- Planned source types per subquestion
- Query strategy (broad → narrow, primary-first)
- Stop rules
- Initialize GoT graph

### Phase 3: Iterative Querying (GoT Generate)
- Search → shortlist → fetch → extract
- Never fetch blindly; score first
- **Checkpoint Aggregation at depth 2**: Pause, collect findings, analyze overlap/gaps/contradictions/dead ends, update hypothesis probabilities, resume with adjusted frontier
- Prompt injection firewall rules

### Phase 4: Source Triangulation (GoT Score + GroundTruth)
- Contradiction Triage: Data disagreement | Interpretation | Methodological | Paradigm conflict
- Independence Rule: 2+ independent sources for C1 claims, or explicit "only one origin source" note
- Lineage tracking with independence_group_id

### Phase 5: Knowledge Synthesis (GoT Aggregate)
- Implications Engine: SO WHAT? / NOW WHAT? / WHAT IF? / COMPARED TO?
- **Red Team Agent at depth 3+ when aggregate > 8.0**: Find counter-evidence, present at strongest, include in final report
- Decision options + tradeoffs + "what would change our mind" triggers

### Phase 6: Quality Assurance (GoT Verify + Refine)
- Citation match audit
- Claim coverage check
- Numeric audit (units, denominators, timeframe, currency normalization)
- Scope audit
- Claim Confidence Scoring: HIGH (90%+) | MEDIUM (60-90%) | LOW (30-60%) | SPECULATIVE (<30%)

### Phase 7: Output & Packaging
- Finalized report sections, references, README navigation
- Final graph_state.json + graph_trace.md

## Claim Taxonomy

| Type | Description | Requirements |
|------|-------------|--------------|
| C1 Critical | Numbers, causal claims, key recommendations | Full citation + independence check + confidence tag |
| C2 Supporting | Trends, patterns, non-critical facts | Citation required, lighter format |
| C3 Context | Definitions, background | Cite if non-obvious |

## GoT Implementation

### Graph State Schema
```json
{
  "project": { "name", "question", "scope", "budgets" },
  "hypotheses": [...],
  "nodes": {
    "n1": { "type", "text", "depth", "score", "score_breakdown", "sources", "claims", "status" }
  },
  "edges": [{ "from", "to", "type": "supports|contradicts|refines|derived_from" }],
  "frontier": ["n1"],
  "pruning": { "keep_best_per_depth": 5, "min_score": 7.0 },
  "iteration": 0
}
```

### Scoring Rubric (0-10)
- Relevance (0.25) + Authority (0.20) + Rigor (0.20) + Independence (0.20) + Coherence (0.15)
- Formula: `score = 2 * (0.25*rel + 0.20*auth + 0.20*rigor + 0.20*indep + 0.15*coh)`

### Transformations
| Transform | When |
|-----------|------|
| Generate(k) | Early depth (0-2) |
| Aggregate(k) | Mid/Late depth (2-4) |
| Refine(1) | Score < 7 at any depth |
| Score(1) | After every transformation |
| KeepBestN(n) | After scoring each depth |
| RedTeam(1) | Depth 3+ when aggregate > 8.0 |
| Hypothesis() | Phase 1.5 and checkpoints |
| Contradict() | Phase 4 when conflicts detected |

### Termination Rules
Stop when ANY 2 are true:
1. Coverage achieved (each subquestion meets minimums)
2. Saturation (last K queries yield <10% new info)
3. Confidence achieved (all C1 claims meet independence rule)
4. Budget reached

## Agent Roles
1. Controller (GoT Orchestrator) — graph, budgets, pruning, stop rules
2. Planner — subquestions + query plan
3. Search Agents (per subtopic) — retrieve + summarize
4. Extractor — sources → evidence ledger claims
5. Verifier — C1 claim corroboration + independence
6. Resolver — contradiction resolution, canonical numbers
7. Red Team — counter-evidence
8. Editor — final deliverables

## Output Folder Structure
```
/RESEARCH/[project_name]/
  README.md
  00_research_contract.md
  01_research_plan.md
  02_query_log.csv
  03_source_catalog.csv
  04_evidence_ledger.csv          ← Most important artifact
  05_contradictions_log.md
  06_key_metrics.csv
  07_working_notes/agent_outputs/
  08_report/
    00_executive_summary.md → 09_references.md
  09_qa/
    qa_report.md, citation_audit.md, numeric_audit.md
  10_graph/
    graph_state.json, graph_trace.md
```

## Domain Overlays Available
- `healthcare.md` — PMID, FDA, clinical trials, Cochrane priority
- `financial.md` — SEC filings, EDGAR, Bloomberg
- `legal.md` — Case citations, jurisdiction, Westlaw
- `market.md` — Market sizing, competitive intelligence
