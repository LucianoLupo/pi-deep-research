#!/usr/bin/env node

import { appendFileSync } from "node:fs";

const prompt = process.argv.at(-1) || "";
const phase = prompt.match(/^PHASE: ([^\n]+)/)?.[1] || "unknown";
const source = process.env.FAKE_SOURCE_URL || "https://example.test/source";
if (process.env.FAKE_TRACE) appendFileSync(process.env.FAKE_TRACE, `${phase}\n`);
if (process.env.FAKE_HANG_PHASE === phase) {
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1_000);
}

let response;
if (prompt.startsWith("PHASE: split")) {
  response = {
    angles: [
      { id: "../architecture", angle: "Architecture", focus: "Boundaries and trade-offs", queries: ["architecture evidence"] },
      { id: "data", angle: "Data", focus: "Data consistency", queries: ["data evidence"] },
    ],
  };
} else if (prompt.startsWith("PHASE: research-1")) {
  response = {
    findings: [{ claim: "Round one finding", evidence: "A fetched primary source supports it.", sources: [source] }],
    sources: [source],
    failedSources: [],
    contradictions: [],
    openQuestions: ["What operational constraint remains?"],
  };
} else if (prompt.startsWith("PHASE: coordinate")) {
  response = {
    knownFacts: [{ theme: "Verified evidence", facts: [`The evidence source is ${source}`] }],
    gaps: [{ id: "operations", gap: "Operational impact", why: "Needed for actionability", queries: ["operations evidence"] }],
    contradictions: [],
    coverage: "Core coverage with one material gap.",
  };
} else if (prompt.startsWith("PHASE: research-2")) {
  response = {
    findings: [{ claim: "Round two finding", evidence: "The same fetched source supports the gap analysis.", sources: [source] }],
    sources: [source],
    failedSources: [],
    contradictions: [],
    openQuestions: [],
  };
} else if (prompt.startsWith("PHASE: synthesize")) {
  const invalid = process.env.FAKE_INVALID_SYNTHESIS ? "\n- [Invalid](https://invalid.example/source)" : "";
  response = `# Fixture report\n\n## Executive Summary\n- Evidence supports the fixture conclusion. [Source](${source})${invalid}\n\n## Findings\nThe validated source supports the finding.\n\n## Contradictions & Open Questions\nNone.\n\n## Limitations\nFixture only.\n\n## Sources\n- [Source](${source})${invalid}`;
} else if (prompt.startsWith("PHASE: repair-citations")) {
  response = process.env.FAKE_BAD_REPAIR
    ? "# Broken report\n\n## Sources\n- [Bad](https://invalid.example/source)"
    : `# Fixture report\n\n## Executive Summary\n- Evidence supports the fixture conclusion. [Source](${source})\n\n## Findings\nValidated.\n\n## Contradictions & Open Questions\nNone.\n\n## Limitations\nFixture only.\n\n## Sources\n- [Source](${source})`;
} else if (prompt.startsWith("PHASE: judge")) {
  response = {
    scores: { depth: 8, accuracy: 9, coverage: 8, synthesis: 8, actionability: 8 },
    overall: 8.2,
    strengths: ["Verified citation"],
    weaknesses: [],
    requiredFixes: [],
    verdict: "approve",
  };
} else {
  response = { error: "Unknown fixture phase" };
}

const text = typeof response === "string" ? response : JSON.stringify(response);
const isResearchWorker = phase === "research-1" || phase === "research-2";
if (process.env.FAKE_WAIT_FOR_STDIN_EOF) {
  process.stdin.resume();
  await new Promise((resolveEnd) => process.stdin.once("end", resolveEnd));
}
process.stdout.write(`${JSON.stringify({ type: "session", version: 3, id: "fixture", timestamp: new Date().toISOString(), cwd: process.cwd() })}\n`);
if (isResearchWorker) {
  process.stdout.write(`${JSON.stringify({ type: "tool_execution_start", toolCallId: "fetch-1", toolName: "research_fetch", args: { urls: [source] } })}\n`);
  process.stdout.write(`${JSON.stringify({ type: "tool_execution_end", toolCallId: "fetch-1", toolName: "research_fetch", result: { content: [{ type: "text", text: source }] }, isError: false })}\n`);
}
if (process.env.FAKE_MALFORMED_PHASE === phase) process.stdout.write("not-json\n");
process.stdout.write(`${JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text }], usage: { inputTokens: 1, outputTokens: 1 } } })}\n`);
process.stdout.write(`${JSON.stringify({ type: "agent_end", messages: [] })}\n`);
